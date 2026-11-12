import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, tables } from '../db'
import { requireAuth } from '../auth'
import { resolveSpace, type SpaceInfo } from '../space'
import type { SessionUser } from '../../shared/types'

/** P10 批量聚合 API：为多个长尾页面提供真实数据 */

function getSetting(key: string) {
  return db.select().from(tables.settings).where(eq(tables.settings.key, key)).get()
}

type Ctx = { Variables: { user: SessionUser; space: SpaceInfo } }

export const p10Routes = new Hono<Ctx>()
p10Routes.use('*', requireAuth)
p10Routes.use('*', async (c, next) => {
  const user = c.get('user')
  const space = resolveSpace(c, user)
  if (!space) return c.json({ error: '尚无可访问的本体空间' }, 403)
  c.set('space', space)
  await next()
})

/** 安全与标记：真实角色权限矩阵 + 标记统计 */
p10Routes.get('/security', (c) => {
  const space = c.get('space')
  const roles = db.select().from(tables.roles).all()
  const types = db.select().from(tables.objectTypes).all().filter((t) => t.spaceId === space.id)
  const users = db.select().from(tables.users).all()
  const audit = db.select().from(tables.auditEvents).all()

  return c.json({
    roles: roles.map((r) => ({
      id: r.id, name: r.name, desc: r.desc,
      memberCount: users.filter((u) => u.roleId === r.id && u.status === '在职').length,
      objectPerms: Object.fromEntries(types.map((t) => [t.name, r.objectPerms[t.id] ?? (r.id === 'admin' || r.id === 'data-eng' ? 'full' : 'read')])),
    })),
    types: types.map((t) => ({ id: t.id, name: t.name, color: t.color })),
    markingStats: {
      total: users.length,
      marked: users.filter((u) => u.markings.length > 0).length,
      internal: users.filter((u) => u.markings.includes('内部')).length,
      confidential: users.filter((u) => u.markings.some((m) => m.includes('机密'))).length,
    },
    auditStats: {
      // 真实：来自审计日志的 Checkpoint 类事件计数
      checkpointCount: audit.filter((a) => a.action.includes('Checkpoint') || a.action.includes('查看敏感')).length,
      // 以下三项治理引擎（脱敏规则/敏感扫描/生命周期）本地版本尚未接入：
      // 明确标记 enabled=false + demo 说明，前端据此显示「示意值·未启用」而非冒充真实统计。
      cipherRules: null as number | null,
      scanResults: null as { totalTables: number; hits: number; resolved: number } | null,
      lifecyclePolicies: [] as { name: string; retention: string; legal: string }[],
      governance: {
        enabled: false,
        note: 'Markings 标记统计为真实数据；脱敏规则、敏感扫描结果、生命周期策略为产品示意，本地版本尚未接入对应引擎（规则表 / 扫描器 / 到期调度器），不展示虚构数字。',
      },
    },
  })
})

/** 模型管理：真实 AI/嵌入配置 + 真实 AI 调用量（按消息数聚合，非网关 token） */
p10Routes.get('/models', (c) => {
  const ai = getSetting('ai')
  const emb = getSetting('embedding')
  const aiVal = (ai?.value ?? {}) as Record<string, unknown>
  const embVal = (emb?.value ?? {}) as Record<string, unknown>

  const models: { id: string; name: string; provider: string; type: string; status: string; configured: boolean; endpoint?: string }[] = []

  if (aiVal.endpoint) {
    models.push({
      id: 'chat', name: String(aiVal.model || 'default'), provider: 'AI 网关', type: '对话/函数调用',
      status: '已连接', configured: true, endpoint: String(aiVal.endpoint),
    })
  }
  if (embVal.endpoint || aiVal.endpoint) {
    models.push({
      id: 'embedding', name: String(embVal.model || 'embedding-2'), provider: '嵌入网关', type: '向量化',
      status: embVal.enabled === false ? '已禁用' : '已连接', configured: embVal.enabled !== false,
      endpoint: String(embVal.endpoint || aiVal.endpoint || ''),
    })
  }
  models.push({ id: 'local', name: '本地哈希向量', provider: '内置', type: '向量化（降级）', status: '备用', configured: true })

  // 真实调用量：统计 ai_messages 中 role=assistant 的消息数（按 createdAt 聚合）。
  // 口径明确为「AI 回复次数」，不是网关 token —— 不伪造随机数，也不冒充 token 计量。
  const now = Date.now()
  const day = 86400_000
  const aiMsgs = db.select().from(tables.aiMessages).all().filter((m) => m.role === 'assistant')
  const countSince = (from: number) => aiMsgs.filter((m) => m.createdAt >= from).length
  return c.json({
    models,
    tokenUsage: {
      today: countSince(now - day),
      week: countSince(now - 7 * day),
      month: countSince(now - 30 * day),
      unit: '次 AI 回复',
      // 供前端标注口径，避免被误读为 token
      note: '按本平台 AI 回复消息数真实聚合；网关 token 计量（需接入 usage 埋点）尚未实现',
    },
  })
})

/** Carbon：真实 Workshop 应用列表 */
p10Routes.get('/carbon', (c) => {
  const space = c.get('space')
  const apps = db.select().from(tables.workshopApps).all().filter((a) => a.spaceId === space.id)
  return c.json({
    apps: apps.map((a) => ({
      id: a.id, name: a.name, desc: a.desc,
      widgetCount: (a.widgets as unknown[]).length,
      updatedAt: new Date(a.updatedAt).toLocaleString('zh-CN', { hour12: false }),
    })),
  })
})

/** Notepad：真实数据报告（统计+类型分布+趋势） */
p10Routes.get('/notepad-data', (c) => {
  const space = c.get('space')
  const types = db.select().from(tables.objectTypes).all().filter((t) => t.spaceId === space.id)
  const objs = db.select().from(tables.objects).all().filter((o) => o.spaceId === space.id)
  const links = db.select().from(tables.objectLinks).all().filter((l) => l.spaceId === space.id)
  const docs = db.select().from(tables.documents).all().filter((d) => d.spaceId === space.id)
  const audit = db.select().from(tables.auditEvents).all().sort((a, b) => b.createdAt - a.createdAt)
  return c.json({
    space: { name: space.name },
    stats: {
      types: types.length, objects: objs.length, links: links.length, docs: docs.length,
      auditToday: audit.filter((a) => a.createdAt > Date.now() - 86400_000).length,
    },
    typeDist: types.map((t) => ({ name: t.name, color: t.color, count: objs.filter((o) => o.typeId === t.id).length })).sort((a, b) => b.count - a.count),
    recentActions: audit.slice(0, 8).map((a) => ({ actor: a.actor, action: a.action, target: a.target.slice(0, 30), time: new Date(a.createdAt).toLocaleString('zh-CN', { hour12: false }) })),
  })
})

/** 开发者工具：真实端点与配置 */
p10Routes.get('/developers', (c) => {
  const ai = getSetting('ai')
  const aiVal = (ai?.value ?? {}) as Record<string, unknown>
  return c.json({
    endpoints: [
      { name: 'REST API', base: '/api', auth: 'Bearer JWT', desc: '全部平台能力（对象/本体/动作/知识/AI）' },
      { name: 'AI Chat', base: '/api/ai/chat', auth: 'Bearer JWT', desc: '多轮对话（含工具调用协议）' },
      { name: 'Object Query', base: '/api/objects', auth: 'Bearer JWT', desc: '对象 CRUD + 搜索 + 图谱' },
      { name: 'Knowledge Search', base: '/api/knowledge/search', auth: 'Bearer JWT', desc: '混合检索（BM25+语义）' },
    ],
    aiConfig: { endpoint: aiVal.endpoint ?? '(未配置)', model: aiVal.model ?? '(未配置)' },
    tools: [
      { name: 'navigate', desc: '页面导航', params: 'page: string' },
      { name: 'query_objects', desc: '查询对象', params: 'type, keyword' },
      { name: 'execute_action', desc: '执行动作', params: 'action, params' },
      { name: 'search_knowledge', desc: '知识检索', params: 'query' },
      { name: 'ontology_overview', desc: '本体概览', params: '无' },
      { name: 'list_actions', desc: '动作列表', params: '无' },
    ],
  })
})

/* ---------- Notepad AIP 写作助手（真实 LLM；追加端点，不改动上方已有代码） ---------- */
p10Routes.post('/notepad/aip', async (c) => {
  const body = await c.req.json<{ action?: string; text?: string }>().catch(() => ({} as { action?: string; text?: string }))
  const action = body.action ?? ''
  const text = (body.text ?? '').slice(0, 8000)
  if (!text.trim()) return c.json({ error: '请提供待处理的报告文本' }, 400)

  const systems: Record<string, string> = {
    polish: '你是企业报告写作助手。在不改变事实与数据的前提下润色以下中文报告文本，使其更专业、通顺、精炼。只返回润色后的正文，不要输出任何解释或前后缀。',
    continue: '你是企业报告写作助手。延续以下中文报告文本的语气与主题，自然地续写一段（100-200 字），补充合理的分析或建议。不要虚构具体数字。只返回续写的正文，不要输出任何解释或前后缀。',
    translate: '你是专业翻译。将以下中文报告文本翻译为通顺、正式的英文，保留数字与专有名词。只返回译文，不要输出任何解释或前后缀。',
  }
  const system = systems[action]
  if (!system) return c.json({ error: '不支持的写作操作（仅 polish / continue / translate）' }, 400)

  try {
    // 动态导入，避免在文件头部新增 import 而改动既有代码
    const { llmComplete } = await import('./ai')
    const result = await llmComplete(system, text)
    return c.json({ action, result })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg === 'AI_NOT_CONFIGURED') return c.json({ error: 'AI 模型未配置，请先在「模型管理」中配置 AI 网关' }, 503)
    return c.json({ error: `写作助手调用失败：${msg}` }, 502)
  }
})

/* ---------- Notepad 报告存储（真实落库，取代禁用的保存/发布按钮） ---------- */

/** 报告列表（当前空间，最近在前） */
p10Routes.get('/notepad/reports', (c) => {
  const space = c.get('space')
  const rows = db.select().from(tables.reports).all()
    .filter((r) => r.spaceId === space.id)
    .sort((a, b) => b.updatedAt - a.updatedAt)
  return c.json({
    reports: rows.map((r) => ({
      id: r.id, title: r.title, status: r.status,
      preview: r.content.slice(0, 60),
      updatedAt: new Date(r.updatedAt).toLocaleString('zh-CN', { hour12: false }),
    })),
  })
})

/** 单个报告详情 */
p10Routes.get('/notepad/reports/:id', (c) => {
  const r = db.select().from(tables.reports).where(eq(tables.reports.id, c.req.param('id'))).get()
  if (!r) return c.json({ error: '报告不存在' }, 404)
  return c.json({ report: r })
})

/** 保存草稿 / 发布（body.status = draft | published）；带 id 则更新 */
p10Routes.post('/notepad/reports', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  type ReportBody = { id?: string; title?: string; content?: string; status?: 'draft' | 'published'; aipResult?: string }
  const body = await c.req.json<ReportBody>().catch((): ReportBody => ({}))
  const now = Date.now()
  const status = body.status === 'published' ? 'published' : 'draft'
  if (body.id) {
    const prev = db.select().from(tables.reports).where(eq(tables.reports.id, body.id)).get()
    if (!prev) return c.json({ error: '报告不存在' }, 404)
    db.update(tables.reports).set({
      title: body.title ?? prev.title, content: body.content ?? prev.content,
      status, aipResult: body.aipResult ?? prev.aipResult, updatedAt: now,
    }).where(eq(tables.reports.id, body.id)).run()
    db.insert(tables.auditEvents).values({ id: `AE-${now}`, actor: user.name, action: status === 'published' ? '发布报告' : '保存报告草稿', target: body.title ?? prev.title, createdAt: now, ip: '本地' }).run()
    return c.json({ id: body.id, status })
  }
  const id = `RPT-${now.toString(36).toUpperCase()}`
  db.insert(tables.reports).values({
    id, title: body.title?.trim() || '未命名报告', content: body.content ?? '',
    status, aipResult: body.aipResult ?? '', ownerId: user.id, spaceId: space.id,
    createdAt: now, updatedAt: now,
  }).run()
  db.insert(tables.auditEvents).values({ id: `AE-${now}-1`, actor: user.name, action: status === 'published' ? '发布报告' : '保存报告草稿', target: body.title ?? '未命名报告', createdAt: now, ip: '本地' }).run()
  return c.json({ id, status })
})

/** 删除报告 */
p10Routes.delete('/notepad/reports/:id', async (c) => {
  const id = c.req.param('id')
  const r = db.select().from(tables.reports).where(eq(tables.reports.id, id)).get()
  if (!r) return c.json({ error: '报告不存在' }, 404)
  db.delete(tables.reports).where(eq(tables.reports.id, id)).run()
  return c.json({ ok: true })
})
