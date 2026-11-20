import { Hono } from 'hono'
import { eq, and, desc, lt, sql } from 'drizzle-orm'
import { db, sqlite, tables } from '../db'
import type Database from 'better-sqlite3'
import { requireAuth } from '../auth'
import { resolveSpace, spacePerm, spaceCanModel, type SpaceInfo } from '../space'
import { fireObjectEvent } from '../engine/automation'
import { checkQuota } from '../quota'
import { TYPE_ALIASES } from '../../shared/ai-tools'
import type { SessionUser } from '../../shared/types'

/** 对象数据 API（P3，空间感知）：实例 CRUD + 链接实例 + 跨类型搜索 */

interface PropDef {
  key: string
  name: string
  type: string
  required?: boolean
  enumValues?: string[]
}

type Ctx = { Variables: { user: SessionUser; space: SpaceInfo } }
export const objectRoutes = new Hono<Ctx>()
objectRoutes.use('*', requireAuth)
objectRoutes.use('*', async (c, next) => {
  const user = c.get('user')
  const space = resolveSpace(c, user)
  if (!space) return c.json({ error: '尚无可访问的本体空间' }, 403)
  c.set('space', space)
  await next()
})

function audit(user: SessionUser, action: string, target: string, detail?: Record<string, unknown>) {
  db.insert(tables.auditEvents).values({
    id: `AE-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    actor: user.name, action, target, detail, ip: '本地', createdAt: Date.now(),
  }).run()
}

function permOf(user: SessionUser, space: SpaceInfo, typeId: string) {
  return spacePerm(user, space, typeId)
}

/** 属性值校验与规范化 */
function validateValues(props: PropDef[], input: Record<string, unknown>): { ok: true; values: Record<string, unknown> } | { ok: false; error: string } {
  const out: Record<string, unknown> = {}
  for (const p of props) {
    const v = input[p.key]
    if (v === undefined || v === null || v === '') {
      if (p.required) return { ok: false, error: `缺少必填属性「${p.name}」` }
      continue
    }
    if (p.type === 'number') {
      const n = Number(v)
      if (Number.isNaN(n)) return { ok: false, error: `属性「${p.name}」应为数值` }
      out[p.key] = n
    } else if (p.type === 'boolean') {
      out[p.key] = v === true || v === 'true' || v === 1
    } else if (p.type === 'enum') {
      const s = String(v)
      if (p.enumValues?.length && !p.enumValues.includes(s)) {
        return { ok: false, error: `属性「${p.name}」的值须为：${p.enumValues.join(' / ')}` }
      }
      out[p.key] = s
    } else {
      out[p.key] = String(v)
    }
  }
  return { ok: true, values: out }
}

/** 按类型的展示模板/属性序取对象显示名 */
function displayName(values: Record<string, unknown>, type?: { viewTemplate?: { titleKey?: string } | null; properties: PropDef[] }): string {
  const v = values ?? {}
  const titleKey = type?.viewTemplate?.titleKey ?? type?.properties?.[0]?.key
  const candidates = [titleKey, 'name', 'title', 'code', 'no', type?.properties?.[0]?.key].filter(Boolean) as string[]
  for (const k of candidates) {
    if (v[k] !== undefined && v[k] !== null && v[k] !== '') return String(v[k])
  }
  return ''
}

/* ---------------- 查询 ---------------- */

/** 本体概览（当前空间，按权限过滤）
 *  计数用 SQL 聚合，不把整空间对象读进内存——10 万行时该接口从 327ms 降到毫秒级 */
objectRoutes.get('/types', (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const types = db.select().from(tables.objectTypes).all().filter((t) => t.spaceId === space.id)
  const counts = new Map<string, number>(
    db.select({ typeId: tables.objects.typeId, c: sql<number>`count(*)` })
      .from(tables.objects)
      .where(eq(tables.objects.spaceId, space.id))
      .groupBy(tables.objects.typeId)
      .all()
      .map((r) => [r.typeId, Number(r.c)]),
  )
  const links = db.select().from(tables.linkTypes).all().filter((l) => l.spaceId === space.id)
  const actions = db.select().from(tables.actionTypes).all().filter((a) => a.spaceId === space.id)
  return c.json({
    space: { id: space.id, name: space.name, kind: space.kind },
    types: types
      .filter((t) => permOf(user, space, t.id) !== 'none')
      .map((t) => ({ id: t.id, name: t.name, color: t.color, count: counts.get(t.id) ?? 0, desc: t.desc })),
    linkTypes: links.map((l) => l.name),
    actionTypes: actions.map((a) => ({ name: a.name, needsApproval: a.needsApproval === 1 })),
  })
})

/** 对象列表：?type=&keyword=&limit= */
objectRoutes.get('/', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const typeArg = c.req.query('type') ?? ''
  const keyword = (c.req.query('keyword') ?? '').trim()
  const limit = Math.min(Number(c.req.query('limit')) || 8, 200)
  // 游标分页：cursor 为上一页最后一条的 updatedAt，避免 OFFSET 在大表上的线性退化
  const cursor = Number(c.req.query('cursor')) || 0

  const types = db.select().from(tables.objectTypes).all().filter((t) => t.spaceId === space.id)
  let t = types.find((x) => x.id === typeArg || x.name === typeArg)
  if (!t) t = types.find((x) => x.id === (TYPE_ALIASES[typeArg] ?? '') || x.name.includes(typeArg) || typeArg.includes(x.name))
  if (!t) return c.json({ error: `未找到对象类型「${typeArg}」`, known: types.map((x) => x.name) }, 404)
  if (permOf(user, space, t.id) === 'none') return c.json({ error: `你没有「${t.name}」的访问权限` }, 403)

  // SQL 下推：空间/类型/游标/关键词过滤都在数据库侧执行，不再把整表读进 Node 内存
  const conds = [eq(tables.objects.spaceId, space.id), eq(tables.objects.typeId, t.id)]
  if (cursor > 0) conds.push(lt(tables.objects.updatedAt, cursor))
  // values 是 JSON 文本列，用 EXISTS-like 的 LIKE 下推（大小写不敏感：SQLite LIKE 默认 ASCII 不敏感）
  if (keyword) conds.push(sql`lower(${tables.objects.values}) like ${'%' + keyword.toLowerCase() + '%'}`)

  const rows = db.select().from(tables.objects)
    .where(and(...conds))
    .orderBy(desc(tables.objects.updatedAt))
    .limit(limit + 1)   // 多取一条判断是否有下一页
    .all()
  const hasMore = rows.length > limit
  const shown = hasMore ? rows.slice(0, limit) : rows
  // total 用不含游标/分页的全量条件（但含关键词），供前端显示总数
  const totalConds = [eq(tables.objects.spaceId, space.id), eq(tables.objects.typeId, t.id)]
  if (keyword) totalConds.push(sql`lower(${tables.objects.values}) like ${'%' + keyword.toLowerCase() + '%'}`)
  const total = (db.select({ c: sql<number>`count(*)` }).from(tables.objects)
    .where(and(...totalConds))
    .get()?.c) ?? 0

  // 关联查询也下推：只查当前页对象 id 相关的链接
  const ids = new Set(shown.map((o) => o.id))
  const allLinks = db.select().from(tables.objectLinks).all().filter((l) => l.spaceId === space.id && (ids.has(l.sourceId) || ids.has(l.targetId)))
  const otherIds = new Set(allLinks.map((l) => (ids.has(l.sourceId) ? l.targetId : l.sourceId)))
  const objsMap = otherIds.size
    ? new Map(db.select().from(tables.objects).all().filter((o) => otherIds.has(o.id)).map((o) => [o.id, o]))
    : new Map<string, typeof tables.objects.$inferSelect>()

  return c.json({
    type: { id: t.id, name: t.name, color: t.color, properties: t.properties, viewTemplate: t.viewTemplate, primaryKey: t.primaryKey },
    total,
    hasMore,
    nextCursor: hasMore ? shown[shown.length - 1]?.updatedAt ?? null : null,
    objects: shown.map((o) => ({
      id: o.id,
      values: o.values,
      updatedAt: o.updatedAt,
      links: allLinks
        .filter((l) => l.sourceId === o.id || l.targetId === o.id)
        .slice(0, 5)
        .map((l) => {
          const other = l.sourceId === o.id ? l.targetId : l.sourceId
          const otherObj = objsMap.get(other)
          const otherType = types.find((x) => x.id === otherObj?.typeId)
          const name = displayName((otherObj?.values ?? {}) as Record<string, unknown>, otherType as { viewTemplate?: { titleKey?: string } | null; properties: PropDef[] } | undefined) || other
          return `${otherType?.name ?? '?'}·${name}`
        }),
    })),
  })
})

/** 图谱数据：当前空间的类型 + 对象节点 + 链接边（供关系图谱渲染） */
objectRoutes.get('/graph', (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const limit = Math.min(Number(c.req.query('limit')) || 40, 120)
  // 服务端筛选：type 支持逗号分隔多类型；keyword 匹配对象 values
  const typeFilter = (c.req.query('type') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const keyword = (c.req.query('keyword') ?? '').trim().toLowerCase()

  const allTypes = db.select().from(tables.objectTypes).all().filter((t) => t.spaceId === space.id && permOf(user, space, t.id) !== 'none')
  const types = typeFilter.length ? allTypes.filter((t) => typeFilter.includes(t.id)) : allTypes
  const typeIds = new Set(types.map((t) => t.id))
  const allObjs = db.select().from(tables.objects).all().filter((o) => o.spaceId === space.id && typeIds.has(o.typeId))
  const matched = keyword ? allObjs.filter((o) => JSON.stringify(o.values).toLowerCase().includes(keyword)) : allObjs
  const objs = matched.slice(0, limit)
  const objIds = new Set(objs.map((o) => o.id))
  const links = db.select().from(tables.objectLinks).all().filter((l) => l.spaceId === space.id && objIds.has(l.sourceId) && objIds.has(l.targetId))
  const linkTypes = db.select().from(tables.linkTypes).all().filter((l) => l.spaceId === space.id)
  const linkTypeMap = new Map(linkTypes.map((l) => [l.id, l]))

  const nodes = objs.map((o) => {
    const t = types.find((x) => x.id === o.typeId)!
    const v = o.values as Record<string, unknown>
    const titleKey = (t.viewTemplate as { titleKey?: string } | null)?.titleKey ?? t.properties?.[0]?.key
    const label = String(v[titleKey ?? ''] ?? v.name ?? v.title ?? v.code ?? v.no ?? o.id)
    return { id: o.id, typeId: o.typeId, typeName: t.name, color: t.color, label, badgeKey: (t.viewTemplate as { badgeKey?: string } | null)?.badgeKey ?? '', badge: String(v[((t.viewTemplate as { badgeKey?: string } | null)?.badgeKey) ?? ''] ?? '') }
  })

  return c.json({
    space: { id: space.id, name: space.name, kind: space.kind },
    // 类型计数基于筛选后的全量对象（不受 limit 截断），供前端图例/筛选展示
    types: types.map((t) => ({ id: t.id, name: t.name, color: t.color, count: allObjs.filter((o) => o.typeId === t.id).length })),
    nodes,
    edges: links.map((l) => ({
      id: l.id,
      source: l.sourceId,
      target: l.targetId,
      linkTypeId: l.linkTypeId,
      label: linkTypeMap.get(l.linkTypeId)?.name ?? '',
    })),
    totalObjects: matched.length,
    truncated: matched.length > objs.length,
  })
})

/** 全局搜索（Ctrl+K）：跨类型对象 + 文档 + Agent + 应用 */
objectRoutes.get('/global-search', (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const q = (c.req.query('q') ?? '').trim().toLowerCase()
  if (!q) return c.json({ objects: [], documents: [], agents: [], apps: [] })

  const types = db.select().from(tables.objectTypes).all().filter((t) => t.spaceId === space.id && spacePerm(user, space, t.id) !== 'none')
  const typeMap = new Map(types.map((t) => [t.id, t]))
  const objects = db.select().from(tables.objects).all()
    .filter((o) => o.spaceId === space.id && JSON.stringify(o.values).toLowerCase().includes(q))
    .slice(0, 8)
    .map((o) => {
      const t = typeMap.get(o.typeId)
      const v = o.values as Record<string, unknown>
      return { id: o.id, label: String(v.name ?? v.title ?? v.code ?? v.no ?? o.id), typeName: t?.name ?? o.typeId, color: t?.color ?? '#94a3b8' }
    })

  const documents = db.select().from(tables.documents).all()
    .filter((d) => d.spaceId === space.id && (d.title.toLowerCase().includes(q) || d.content.toLowerCase().includes(q)))
    .slice(0, 5)
    .map((d) => ({ id: d.id, label: d.title, category: d.category }))

  const agents = db.select().from(tables.aiConversations).all()
    .filter((a) => a.spaceId === space.id && a.scene === 'agent' && a.title.toLowerCase().includes(q))
    .slice(0, 5)
    .map((a) => ({ id: a.id, label: a.title }))

  const apps = db.select().from(tables.workshopApps).all()
    .filter((a) => a.spaceId === space.id && a.name.toLowerCase().includes(q))
    .slice(0, 5)
    .map((a) => ({ id: a.id, label: a.name }))

  return c.json({ objects, documents, agents, apps })
})

/** 跨类型全局搜索（当前空间） */
objectRoutes.get('/search', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const q = (c.req.query('q') ?? '').trim().toLowerCase()
  const typeFilter = (c.req.query('type') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const maxPerType = Math.min(Number(c.req.query('limit')) || (q ? 8 : 4), 50)
  const allTypes = db.select().from(tables.objectTypes).all().filter((t) => t.spaceId === space.id && permOf(user, space, t.id) !== 'none')
  const types = typeFilter.length ? allTypes.filter((t) => typeFilter.includes(t.id)) : allTypes
  const objs = db.select().from(tables.objects).all().filter((o) => o.spaceId === space.id)

  const groups = types
    .map((t) => {
      let rows = objs.filter((o) => o.typeId === t.id)
      if (q) rows = rows.filter((o) => JSON.stringify(o.values).toLowerCase().includes(q))
      return {
        type: { id: t.id, name: t.name, color: t.color, desc: t.desc, properties: t.properties, viewTemplate: t.viewTemplate },
        total: rows.length,
        objects: rows.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, maxPerType).map((o) => ({ id: o.id, values: o.values })),
      }
    })
    .filter((g) => g.objects.length > 0)

  return c.json({ q, space: { name: space.name, kind: space.kind }, groups, total: groups.reduce((s, g) => s + g.total, 0) })
})

/** 对象详情（含结构化链接） */
objectRoutes.get('/:id', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const id = c.req.param('id') as string
  const o = db.select().from(tables.objects).where(eq(tables.objects.id, id)).get()
  if (!o || o.spaceId !== space.id) return c.json({ error: '对象不存在' }, 404)
  if (permOf(user, space, o.typeId) === 'none') return c.json({ error: '无权访问该对象' }, 403)

  const types = db.select().from(tables.objectTypes).all().filter((t) => t.spaceId === space.id)
  const allLinks = db.select().from(tables.objectLinks).all().filter((l) => l.spaceId === space.id)
  const objsMap = new Map(db.select().from(tables.objects).all().filter((x) => x.spaceId === space.id).map((x) => [x.id, x]))
  const linkTypeMap = new Map(db.select().from(tables.linkTypes).all().filter((l) => l.spaceId === space.id).map((l) => [l.id, l]))

  const links = allLinks
    .filter((l) => l.sourceId === id || l.targetId === id)
    .map((l) => {
      const other = l.sourceId === id ? objsMap.get(l.targetId) : objsMap.get(l.sourceId)
      const otherType = types.find((t) => t.id === other?.typeId)
      const name = displayName((other?.values ?? {}) as Record<string, unknown>, otherType as { viewTemplate?: { titleKey?: string } | null; properties: PropDef[] } | undefined) || other?.id || '?'
      return {
        id: l.id, linkTypeId: l.linkTypeId, linkTypeName: linkTypeMap.get(l.linkTypeId)?.name ?? '',
        direction: l.sourceId === id ? 'out' : 'in', otherId: other?.id ?? '',
        otherType: otherType?.name ?? '?', otherTypeColor: otherType?.color ?? '#94a3b8', otherName: name,
      }
    })
  return c.json({ object: o, links })
})

/* ---------------- 实例 CRUD ---------------- */

objectRoutes.post('/', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const body = await c.req.json<{ typeId: string; values: Record<string, unknown> }>()
  const t = db.select().from(tables.objectTypes).all().find((x) => x.id === body.typeId && x.spaceId === space.id)
  if (!t) return c.json({ error: '对象类型不存在（当前空间）' }, 404)
  if (permOf(user, space, t.id) !== 'full') return c.json({ error: `你对「${t.name}」只有只读权限` }, 403)

  const checked = validateValues(t.properties as PropDef[], body.values ?? {})
  if (!checked.ok) return c.json({ error: checked.error }, 400)
  // 套餐配额：对象条数超限返回 402（私有化默认无限套餐不触发）
  const quota = checkQuota(space.id, 'objects')
  if (!quota.ok) return c.json({ error: quota.reason, code: 'QUOTA_EXCEEDED', quota: { used: quota.used, limit: quota.limit } }, 402)

  const id = `${t.id}:${Date.now().toString(36)}${Math.floor(Math.random() * 100).toString(36)}`
  const now = Date.now()
  db.insert(tables.objects).values({
    id, typeId: t.id, values: checked.values, createdBy: user.name, createdAt: now, updatedAt: now, spaceId: space.id,
  }).run()
  audit(user, '新建对象', `${t.name} ${JSON.stringify(checked.values).slice(0, 80)}`)
  fireObjectEvent(space.id, t.id, id, 'create', checked.values, user.name)
  return c.json({ object: { id, typeId: t.id, values: checked.values } })
})

/** 批量导入（事务 + 预处理语句，供大数据量灌入；逐行校验，冲突跳过） */
objectRoutes.post('/bulk', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const body = await c.req.json<{ typeId: string; rows: Record<string, unknown>[] }>().catch(() => ({ typeId: '', rows: [] }))
  if (!Array.isArray(body.rows) || body.rows.length === 0) return c.json({ error: 'rows 不能为空' }, 400)
  if (body.rows.length > 200000) return c.json({ error: '单次最多 20 万行' }, 400)
  const t = db.select().from(tables.objectTypes).all().find((x) => x.id === body.typeId && x.spaceId === space.id)
  if (!t) return c.json({ error: '对象类型不存在（当前空间）' }, 404)
  if (permOf(user, space, t.id) !== 'full') return c.json({ error: `你对「${t.name}」只有只读权限` }, 403)
  const props = t.properties as PropDef[]
  const now = Date.now()
  let created = 0, skipped = 0
  const seen = new Set(db.select({ v: tables.objects.values }).from(tables.objects)
    .where(and(eq(tables.objects.spaceId, space.id), eq(tables.objects.typeId, t.id))).all().map((r) => JSON.stringify(r.v)))
  const insert = (sqlite as Database.Database).prepare(
    'INSERT OR IGNORE INTO objects (id, type_id, "values", created_by, created_at, updated_at, space_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  const run = (sqlite as Database.Database).transaction((items: { id: string; v: string }[]) => {
    for (const it of items) insert.run(it.id, t.id, it.v, user.name, now, now, space.id)
  })
  const batch: { id: string; v: string }[] = []
  for (let i = 0; i < body.rows.length; i++) {
    const checked = validateValues(props, body.rows[i] ?? {})
    if (!checked.ok) { skipped++; continue }
    const v = JSON.stringify(checked.values)
    if (seen.has(v)) { skipped++; continue }
    seen.add(v)
    batch.push({ id: `${t.id}:B-${now.toString(36)}-${i.toString(36)}`, v })
    created++
  }
  run(batch)
  audit(user, '批量导入对象', `${t.name} 新增 ${created} 行`, { created, skipped })
  return c.json({ created, skipped, total: body.rows.length })
})

objectRoutes.patch('/:id', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const id = c.req.param('id') as string
  const o = db.select().from(tables.objects).where(eq(tables.objects.id, id)).get()
  if (!o || o.spaceId !== space.id) return c.json({ error: '对象不存在' }, 404)
  if (permOf(user, space, o.typeId) !== 'full') return c.json({ error: '只读权限，无法编辑' }, 403)
  const t = db.select().from(tables.objectTypes).all().find((x) => x.id === o.typeId && x.spaceId === space.id)!
  const patch = await c.req.json<{ values: Record<string, unknown> }>()
  const checked = validateValues(t.properties as PropDef[], { ...(o.values as Record<string, unknown>), ...(patch.values ?? {}) })
  if (!checked.ok) return c.json({ error: checked.error }, 400)
  db.update(tables.objects).set({ values: checked.values, updatedAt: Date.now() }).where(eq(tables.objects.id, id)).run()
  audit(user, '更新对象', `${t.name} ${id}`)
  fireObjectEvent(space.id, o.typeId, id, 'update', checked.values, user.name)
  return c.json({ ok: true })
})

objectRoutes.delete('/:id', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const id = c.req.param('id') as string
  const o = db.select().from(tables.objects).where(eq(tables.objects.id, id)).get()
  if (!o || o.spaceId !== space.id) return c.json({ error: '对象不存在' }, 404)
  if (permOf(user, space, o.typeId) !== 'full') return c.json({ error: '只读权限，无法删除' }, 403)
  const t = db.select().from(tables.objectTypes).all().find((x) => x.id === o.typeId && x.spaceId === space.id)!
  const allLinks = db.select().from(tables.objectLinks).all().filter((l) => (l.sourceId === id || l.targetId === id) && l.spaceId === space.id)

  // 组合关系级联：「包含明细」链接（如 支出→消费明细）指向的子对象随主对象一并删除，
  // 否则残留孤儿明细会污染按商品的统计；其他关联（如 支出账户）仅断开不删对端
  const itemLinkTypeIds = new Set(
    db.select().from(tables.linkTypes).all()
      .filter((lt) => lt.spaceId === space.id && /item|detail|明细/i.test(lt.id + lt.name))
      .map((lt) => lt.id)
  )
  const childIds = allLinks.filter((l) => l.sourceId === id && itemLinkTypeIds.has(l.linkTypeId)).map((l) => l.targetId)
  let cascadedItems = 0
  for (const childId of childIds) {
    const child = db.select().from(tables.objects).where(eq(tables.objects.id, childId)).get()
    if (!child || child.spaceId !== space.id) continue
    for (const cl of db.select().from(tables.objectLinks).all().filter((l) => (l.sourceId === childId || l.targetId === childId) && l.spaceId === space.id)) {
      db.delete(tables.objectLinks).where(eq(tables.objectLinks.id, cl.id)).run()
    }
    db.delete(tables.objects).where(eq(tables.objects.id, childId)).run()
    fireObjectEvent(space.id, child.typeId, childId, 'delete', (child.values as Record<string, unknown>), user.name)
    cascadedItems++
  }

  for (const l of allLinks) db.delete(tables.objectLinks).where(eq(tables.objectLinks.id, l.id)).run()
  db.delete(tables.objects).where(eq(tables.objects.id, id)).run()
  audit(user, '删除对象', `${t.name} ${id}`, { cascadedLinks: allLinks.length, cascadedItems })
  fireObjectEvent(space.id, o.typeId, id, 'delete', (o.values as Record<string, unknown>), user.name)
  return c.json({ ok: true, cascadedLinks: allLinks.length, cascadedItems })
})

/* ---------------- 链接实例 ---------------- */

objectRoutes.post('/:id/links', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const id = c.req.param('id') as string
  const { linkTypeId, targetId, direction = 'out' } = await c.req.json<{ linkTypeId: string; targetId: string; direction?: 'out' | 'in' }>()

  const src = db.select().from(tables.objects).where(eq(tables.objects.id, id)).get()
  const dst = db.select().from(tables.objects).where(eq(tables.objects.id, targetId)).get()
  if (!src || !dst || src.spaceId !== space.id || dst.spaceId !== space.id) return c.json({ error: '对象不存在（当前空间）' }, 404)
  const lt = db.select().from(tables.linkTypes).all().find((l) => l.id === linkTypeId && l.spaceId === space.id)
  if (!lt) return c.json({ error: '链接类型不存在' }, 404)

  const source = direction === 'out' ? src : dst
  const target = direction === 'out' ? dst : src
  if (source.typeId !== lt.sourceTypeId || target.typeId !== lt.targetTypeId) {
    return c.json({ error: `链接类型「${lt.name}」要求两端类型不匹配` }, 400)
  }
  if (permOf(user, space, src.typeId) !== 'full') return c.json({ error: '只读权限，无法建立链接' }, 403)

  const dup = db.select().from(tables.objectLinks).all().find((l) => l.linkTypeId === linkTypeId && l.sourceId === source.id && l.targetId === target.id && l.spaceId === space.id)
  if (dup) return c.json({ error: '链接已存在' }, 409)

  const lid = `L-${Date.now().toString(36)}${Math.floor(Math.random() * 100).toString(36)}`
  db.insert(tables.objectLinks).values({
    id: lid, linkTypeId, sourceId: source.id, targetId: target.id, createdBy: user.name, createdAt: Date.now(), spaceId: space.id,
  }).run()
  audit(user, '新建链接', `${lt.name}: ${source.id} → ${target.id}`)
  return c.json({ ok: true, linkId: lid })
})

objectRoutes.delete('/links/:linkId', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const linkId = c.req.param('linkId') as string
  const l = db.select().from(tables.objectLinks).where(eq(tables.objectLinks.id, linkId)).get()
  if (!l || l.spaceId !== space.id) return c.json({ error: '链接不存在' }, 404)
  const srcObj = db.select().from(tables.objects).where(eq(tables.objects.id, l.sourceId)).get()
  if (permOf(user, space, srcObj?.typeId ?? '') !== 'full') return c.json({ error: '只读权限，无法删除链接' }, 403)
  db.delete(tables.objectLinks).where(eq(tables.objectLinks.id, linkId)).run()
  audit(user, '删除链接', `${linkId}`)
  return c.json({ ok: true })
})
