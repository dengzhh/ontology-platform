import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, tables } from '../db'
import { requireAuth } from '../auth'
import { resolveSpace, spaceCanModel, type SpaceInfo } from '../space'
import { llmComplete } from './ai'
import type { SessionUser } from '../../shared/types'

/** 知识抽取 API（P5 补完）：从已入库文档中抽取本体候选 + 向量索引管理 */

interface Candidate {
  kind: '实体' | '关系'
  content: string
  source: string
  confidence: number
  status: string
}

type Ctx = { Variables: { user: SessionUser; space: SpaceInfo } }

function audit(user: SessionUser, action: string, target: string, detail?: Record<string, unknown>) {
  db.insert(tables.auditEvents).values({
    id: `AE-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    actor: user.name, action, target, detail, ip: '本地', createdAt: Date.now(),
  }).run()
}

export const extractRoutes = new Hono<Ctx>()
extractRoutes.use('*', requireAuth)
extractRoutes.use('*', async (c, next) => {
  const user = c.get('user')
  const space = resolveSpace(c, user)
  if (!space) return c.json({ error: '尚无可访问的本体空间' }, 403)
  c.set('space', space)
  await next()
})

/** 生成稳定的类型标识：中文名会被 slug 清空，故统一加 ec- 前缀 + 随机后缀保证唯一 */
function typeId(name: string): string {
  const s = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '')
  return `ec-${s || Date.now().toString(36)}-${Math.floor(Math.random() * 100000).toString(36)}`
}

/** 从自由文本候选中提取一个简洁、可复用的类型名（content 是自然语言建议，不是 JSON） */
function deriveName(content: string, kind: '实体' | '关系'): string {
  let s = content.trim()
    .replace(/[（(][^）)]*[）)]/g, ' ') // 去掉括号内的解释性文字
    .replace(/(枚举新增值|属性候选|类型候选|新链接|候选|新增值|疑似新建|建议新增|新建类型|新增|新类型)/g, ' ')
  // 箭头右侧通常是「建议落地成什么」，取最后一段
  if (s.includes('→')) s = s.split('→').pop() ?? s
  s = s.replace(/[→↔⇄<>]/g, ' ')
    .replace(/[\s,，。;；:：、|｜/\\·]+/g, ' ')
    .trim()
  // 优先取「」或引号中的专名
  const quoted = s.match(/[「"“']([^」"”']{1,20})[」"”']/)
  if (quoted) s = quoted[1]
  s = s.trim().slice(0, 20).trim()
  // 关系名里残留的多词用短横线连接，避免出现「设备 知识文档」这种带空格的类型名
  if (kind === '关系' && /\s/.test(s)) s = s.replace(/\s+/g, '-')
  return s || (kind === '实体' ? '抽取实体' : '抽取关系')
}

/** 关系候选：解析 A ↔ B 两端名称；解析不到时回退为基于候选名派生的两端 */
function deriveEndpoints(content: string, linkName: string, spaceTypes: { name: string }[]): [string, string] {
  const sides = content.split(/[↔⇄]/)
  const names: string[] = []
  if (sides.length >= 2) {
    const left = sides[0].trim().split(/[\s→,，、]+/).filter(Boolean).pop() ?? ''
    const right = sides[1].trim().split(/[\s→,，、]+/).filter(Boolean)[0] ?? ''
    names.push(left, right)
  } else {
    names.push(...spaceTypes.filter((t) => content.includes(t.name)).slice(0, 2).map((t) => t.name))
  }
  const clean = (v: string) => v.trim()
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/(新链接|候选|新增)/g, '')
    .replace(/[→↔⇄]/g, '')
    .trim().slice(0, 20).trim()
  const a = clean(names[0] ?? '')
  const b = clean(names[1] ?? '')
  return [a || `${linkName}源`, b || `${linkName}目标`]
}

/** 最简对象类型定义：content 仅为自由文本，不臆造复杂字段，只建一个 string 名称属性 */
function minimalProperties() {
  return [{ key: 'name', name: '名称', type: 'string', required: true }]
}

/** 向量索引统计 */
extractRoutes.get('/indexes', (c) => {
  const space = c.get('space')
  const docs = db.select().from(tables.documents).all().filter((d) => d.spaceId === space.id)
  const chunks = db.select().from(tables.docChunks).all().filter((ch) => docs.some((d) => d.id === ch.docId))
  // 推断向量模式（远程 dim 通常 1024/1536，本地 256）
  const dims = Array.from(new Set(chunks.filter((ch) => ch.dim > 0).map((ch) => ch.dim)))
  return c.json({
    indexes: [{
      name: 'kb_main',
      source: `当前空间 ${docs.length} 篇文档`,
      vectors: chunks.length,
      dim: dims[0] ?? 0,
      engine: (dims[0] ?? 0) > 300 ? '远程 embedding' : '本地哈希',
    }],
    docs: docs.map((d) => ({ id: d.id, title: d.title, category: d.category, chunkCount: d.chunkCount, content: d.content.slice(0, 200) })),
  })
})

/** 抽取候选列表 */
extractRoutes.get('/candidates', (c) => {
  const space = c.get('space')
  const rows = db.select().from(tables.extractCandidates).all()
    .filter((r) => docs_in_space(r.source, space.id))
    .sort((a, b) => b.createdAt - a.createdAt)
  // 落地结果不新增表字段，复用审计日志（detail JSON）持久化「建成了什么」
  const materialized = new Map<string, { name: string; kind: 'objectType' | 'linkType'; id: string }>()
  for (const ev of db.select().from(tables.auditEvents).all()) {
    if (ev.action !== '落地本体候选') continue
    const d = ev.detail
    if (!d || typeof d.candidateId !== 'string' || typeof d.name !== 'string') continue
    if (d.kind !== 'objectType' && d.kind !== 'linkType') continue
    materialized.set(d.candidateId, { name: d.name, kind: d.kind, id: typeof d.typeId === 'string' ? d.typeId : '' })
  }
  return c.json({
    candidates: rows.map((r) => {
      const m = materialized.get(r.id)
      return {
        id: r.id, kind: r.kind, content: r.content, source: r.source,
        confidence: r.confidence, status: r.status,
        materializedInto: m ? m.name : '',
        materializedKind: m ? m.kind : null,
        createdAt: new Date(r.createdAt).toLocaleString('zh-CN', { hour12: false }),
      }
    }),
    stats: {
      total: rows.length,
      pending: rows.filter((r) => r.status === '待审核').length,
      accepted: rows.filter((r) => r.status === '已接受').length,
      rejected: rows.filter((r) => r.status === '已拒绝').length,
      materialized: rows.filter((r) => r.status === '已落地').length,
    },
  })
})

/** 判断候选来源是否在空间内 */
function docs_in_space(source: string, spaceId: string): boolean {
  const docs = db.select().from(tables.documents).all().filter((d) => d.spaceId === spaceId)
  return docs.some((d) => source.includes(d.title) || source.includes(d.id))
}

const EXTRACT_SYSTEM = `你是企业本体建模专家。从给定的企业文档中识别候选实体（对象类型的新属性值或新实体）和关系（对象间的新关联），输出严格的 JSON（不要输出任何其他文字）。

输出格式：
{"candidates":[{"kind":"实体|关系","content":"具体建议","confidence":0.95}]}

要求：候选 3-8 个，选文档中最有价值的结构化信息；confidence 为 0-1 的置信度；不要重复已有类型，重点找"文档中提到了但本体还没有覆盖"的信息。`

/** 从指定文档抽取本体候选（调用 LLM） */
extractRoutes.post('/run', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  if (!spaceCanModel(user, space)) return c.json({ error: '需要空间管理权限' }, 403)
  const { docId } = await c.req.json<{ docId: string }>()
  const doc = db.select().from(tables.documents).all().find((d) => d.id === docId && d.spaceId === space.id)
  if (!doc) return c.json({ error: '文档不存在（当前空间）' }, 404)
  if (doc.content.trim().length < 20) return c.json({ error: '文档内容太短（<20字）' }, 400)

  let reply: string
  try {
    reply = await llmComplete(EXTRACT_SYSTEM, doc.content.slice(0, 6000))
  } catch (e) {
    if (e instanceof Error && e.message === 'AI_NOT_CONFIGURED') {
      return c.json({ error: 'AI_NOT_CONFIGURED', hint: '知识抽取需先在「控制面板→AI 服务」配置大模型' }, 400)
    }
    return c.json({ error: `模型调用失败：${e instanceof Error ? e.message : '未知'}` }, 502)
  }

  // 解析
  const cleaned = reply.replace(/```json|```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return c.json({ error: '模型未返回有效结构' }, 502)
  let parsed: { candidates?: { kind?: string; content?: string; confidence?: number }[] }
  try { parsed = JSON.parse(cleaned.slice(start, end + 1)) }
  catch { return c.json({ error: 'JSON 解析失败' }, 502) }

  // 存入候选表
  const inserted: Candidate[] = []
  for (const cd of (parsed.candidates ?? []).slice(0, 8)) {
    if (!cd.content) continue
    const kind = cd.kind === '关系' ? '关系' : '实体'
    const id = `EC-${Date.now().toString(36)}${Math.floor(Math.random() * 100).toString(36)}`
    const conf = Math.min(1, Math.max(0, Number(cd.confidence) || 0.5))
    db.insert(tables.extractCandidates).values({
      id, kind, content: String(cd.content).slice(0, 200),
      source: `${doc.title}(${doc.id})`, confidence: conf, status: '待审核', createdAt: Date.now(),
      spaceId: space.id,
    }).run()
    inserted.push({ kind: kind as '实体' | '关系', content: String(cd.content).slice(0, 200), source: `${doc.title}(${doc.id})`, confidence: conf, status: '待审核' })
  }
  audit(user, '知识抽取', `${doc.title} → ${inserted.length} 个候选`)
  return c.json({ candidates: inserted })
})

/**
 * 落地本体候选：把候选真正建成对象类型 / 链接类型（真实 drizzle 写库）。
 * content 是自由文本建议（见 EXTRACT_SYSTEM），因此只生成最简类型：
 *   - 实体 → 一个对象类型（一个 string「名称」属性）
 *   - 关系 → 一条链接类型（两端缺失时自动补齐为两个对象类型）
 * 幂等：按候选 id 查审计留痕、按名称查已有类型，重复落地不重复建。
 */
extractRoutes.post('/candidates/:id/materialize', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  if (!spaceCanModel(user, space)) return c.json({ error: '需要空间管理权限' }, 403)
  const id = c.req.param('id') as string
  const row = db.select().from(tables.extractCandidates).where(eq(tables.extractCandidates.id, id)).get()
  if (!row) return c.json({ error: '候选不存在' }, 404)
  // 空间归属：新候选带 spaceId；历史/种子候选靠来源文档判定
  const inSpace = row.spaceId === space.id || (row.spaceId === '' && docs_in_space(row.source, space.id))
  if (!inSpace) return c.json({ error: '候选不属于当前空间' }, 403)
  const kind: '实体' | '关系' = row.kind === '关系' ? '关系' : '实体'

  // 幂等一：本候选已落地过 → 直接返回既有结果（不因后续状态变更而重复创建）
  const prior = db.select().from(tables.auditEvents).all()
    .filter((ev) => ev.action === '落地本体候选'
      && ev.detail && ev.detail.candidateId === id)
    .pop()
  if (prior && prior.detail && typeof prior.detail.name === 'string') {
    const d = prior.detail
    return c.json({
      ok: true, duplicate: true, message: '该候选此前已落地，未重复创建',
      kind: d.kind === 'linkType' ? 'linkType' : 'objectType',
      name: d.name, typeId: typeof d.typeId === 'string' ? d.typeId : '',
      status: row.status,
    })
  }
  // 已拒绝的候选不允许直接落地；待审核 / 已接受允许「审核 + 落地」一步完成
  if (row.status === '已拒绝') return c.json({ error: '已拒绝的候选不能落地' }, 400)

  const now = Date.now()
  const props = minimalProperties()
  const spaceTypes = db.select().from(tables.objectTypes).all().filter((t) => t.spaceId === space.id)
  const spaceLinks = db.select().from(tables.linkTypes).all().filter((l) => l.spaceId === space.id)
  const name = deriveName(row.content, kind)

  /** 幂等二：同名已存在则不建，返回其标识；否则新建最简对象类型 */
  const ensureType = (n: string): { id: string; created: boolean } => {
    const exists = spaceTypes.find((t) => t.name === n)
    if (exists) return { id: exists.id, created: false }
    const tid = typeId(n)
    db.insert(tables.objectTypes).values({
      id: tid, apiName: tid, name: n,
      desc: `由知识抽取候选落地（${row.source}）`,
      color: '#3b82f6', icon: 'Box', primaryKey: 'name', properties: props,
      viewTemplate: { titleKey: 'name' }, spaceId: space.id, createdAt: now, updatedAt: now,
    }).run()
    return { id: tid, created: true }
  }

  let resultKind: 'objectType' | 'linkType'
  let resultId: string
  let createdTypes: string[] = []

  if (kind === '实体') {
    // 幂等：同名对象类型已存在 → 不重复建，直接把候选标记为已落地
    const existing = spaceTypes.find((t) => t.name === name)
    if (existing) {
      db.update(tables.extractCandidates).set({ status: '已落地' }).where(eq(tables.extractCandidates.id, id)).run()
      audit(user, '落地本体候选', `${name}@${space.name}`, {
        candidateId: id, kind: 'objectType', name, typeId: existing.id, duplicate: true,
      })
      return c.json({
        ok: true, duplicate: true, message: `同名对象类型「${name}」已存在，未重复创建`,
        kind: 'objectType', name, typeId: existing.id, status: '已落地',
      })
    }
    const tid = typeId(name)
    db.insert(tables.objectTypes).values({
      id: tid, apiName: tid, name, desc: `由知识抽取候选落地（${row.source}）`,
      color: '#3b82f6', icon: 'Box', primaryKey: 'name', properties: props,
      viewTemplate: { titleKey: 'name' }, spaceId: space.id, createdAt: now, updatedAt: now,
    }).run()
    resultKind = 'objectType'; resultId = tid; createdTypes = [name]
  } else {
    // 幂等：同名链接类型已存在 → 不重复建
    const existingLink = spaceLinks.find((l) => l.name === name)
    if (existingLink) {
      db.update(tables.extractCandidates).set({ status: '已落地' }).where(eq(tables.extractCandidates.id, id)).run()
      audit(user, '落地本体候选', `${name}@${space.name}`, {
        candidateId: id, kind: 'linkType', name, typeId: existingLink.id, duplicate: true,
      })
      return c.json({
        ok: true, duplicate: true, message: `同名链接类型「${name}」已存在，未重复创建`,
        kind: 'linkType', name, typeId: existingLink.id, status: '已落地',
      })
    }
    const [srcName, dstName] = deriveEndpoints(row.content, name, spaceTypes)
    const src = ensureType(srcName)
    const dst = ensureType(dstName === srcName ? `${dstName}关联` : dstName)
    if (src.created) createdTypes.push(srcName)
    if (dst.created) createdTypes.push(dstName === srcName ? `${dstName}关联` : dstName)
    const lid = typeId(name)
    db.insert(tables.linkTypes).values({
      id: lid, name, sourceTypeId: src.id, targetTypeId: dst.id,
      cardinality: '1:N', desc: `由知识抽取候选落地（${row.source}）`,
      spaceId: space.id, createdAt: now,
    }).run()
    resultKind = 'linkType'; resultId = lid
  }

  db.update(tables.extractCandidates).set({ status: '已落地' }).where(eq(tables.extractCandidates.id, id)).run()
  audit(user, '落地本体候选', `${name}(${resultId})@${space.name}`, {
    candidateId: id, kind: resultKind, name, typeId: resultId,
    createdTypes, fromStatus: row.status,
  })
  return c.json({
    ok: true, duplicate: false,
    message: resultKind === 'objectType'
      ? `已落地为对象类型「${name}」`
      : `已落地为链接类型「${name}」${createdTypes.length ? `（并补齐端点类型：${createdTypes.join('、')}）` : ''}`,
    kind: resultKind, name, typeId: resultId, createdTypes, status: '已落地',
  })
})

/** 接受候选（进入本体） */
extractRoutes.post('/candidates/:id/accept', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  if (!spaceCanModel(user, space)) return c.json({ error: '需要空间管理权限' }, 403)
  const id = c.req.param('id') as string
  const row = db.select().from(tables.extractCandidates).where(eq(tables.extractCandidates.id, id)).get()
  if (!row) return c.json({ error: '候选不存在' }, 404)
  db.update(tables.extractCandidates).set({ status: '已接受' }).where(eq(tables.extractCandidates.id, id)).run()
  audit(user, '接受本体候选', row.content.slice(0, 50))
  return c.json({ ok: true })
})

/** 拒绝候选 */
extractRoutes.post('/candidates/:id/reject', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  if (!spaceCanModel(user, space)) return c.json({ error: '需要空间管理权限' }, 403)
  const id = c.req.param('id') as string
  const row = db.select().from(tables.extractCandidates).where(eq(tables.extractCandidates.id, id)).get()
  if (!row) return c.json({ error: '候选不存在' }, 404)
  db.update(tables.extractCandidates).set({ status: '已拒绝' }).where(eq(tables.extractCandidates.id, id)).run()
  audit(user, '拒绝本体候选', row.content.slice(0, 50))
  return c.json({ ok: true })
})
