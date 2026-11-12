import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { db, tables } from '../db'
import { requireAuth } from '../auth'
import { resolveSpace, spacePerm, type SpaceInfo } from '../space'
import type { SessionUser } from '../../shared/types'

/** 看板分析聚合 API（P9）：真实数据统计、类型分布、趋势、枚举分布 */

type Ctx = { Variables: { user: SessionUser; space: SpaceInfo } }

export const dashboardRoutes = new Hono<Ctx>()
dashboardRoutes.use('*', requireAuth)
dashboardRoutes.use('*', async (c, next) => {
  const user = c.get('user')
  const space = resolveSpace(c, user)
  if (!space) return c.json({ error: '尚无可访问的本体空间' }, 403)
  c.set('space', space)
  await next()
})

/** 平台仪表盘总览（systemHealth 的 AI 网关为真实探测：可达性 + 响应码，2.5s 超时） */
async function probeGateway(endpoint: string): Promise<{ ok: boolean; metric: string }> {
  if (!endpoint) return { ok: false, metric: '未配置' }
  const t0 = Date.now()
  try {
    const res = await fetch(endpoint.replace(/\/$/, '') + '/models', { signal: AbortSignal.timeout(2500) })
    // 任何 HTTP 响应都证明网关可达（含 401/404）；只有网络异常才算不可达
    return { ok: true, metric: `可达 · HTTP ${res.status} · ${Date.now() - t0}ms` }
  } catch {
    return { ok: false, metric: `不可达（${Date.now() - t0}ms 超时或拒绝）` }
  }
}

dashboardRoutes.get('/overview', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const types = db.select().from(tables.objectTypes).all().filter((t) => t.spaceId === space.id)
  const objs = db.select().from(tables.objects).all().filter((o) => o.spaceId === space.id)
  const links = db.select().from(tables.objectLinks).all().filter((l) => l.spaceId === space.id)
  const actions = db.select().from(tables.actionTypes).all().filter((a) => a.spaceId === space.id)
  const logs = db.select().from(tables.actionLogs).all()
  const docs = db.select().from(tables.documents).all().filter((d) => d.spaceId === space.id)
  const chunks = db.select().from(tables.docChunks).all().filter((ch) => docs.some((d) => d.id === ch.docId))
  const rules = db.select().from(tables.automationRules).all().filter((r) => r.spaceId === space.id && r.enabled === 1)
  const approvals = db.select().from(tables.approvals).all()
  const audit = db.select().from(tables.auditEvents).all().sort((a, b) => b.createdAt - a.createdAt)
  const aiMsgs = db.select().from(tables.aiMessages).all()
  const notifications = db.select().from(tables.notifications).all()

  // 对象类型分布（按类型着色）
  const typeDist = types.map((t) => ({
    name: t.name,
    color: t.color,
    typeId: t.id,
    count: objs.filter((o) => o.typeId === t.id).length,
  })).sort((a, b) => b.count - a.count)

  // 近 7 天审计趋势（本体查询 + AI 调用）
  const now = Date.now()
  const days: { day: string; queries: number; ai: number; actions: number }[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now - i * 24 * 3600_000)
    const label = `${d.getMonth() + 1}/${d.getDate()}`
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    const end = start + 24 * 3600_000
    const dayAudit = audit.filter((a) => a.createdAt >= start && a.createdAt < end)
    days.push({
      day: label,
      queries: dayAudit.filter((a) => a.action.includes('查询') || a.action.includes('浏览')).length,
      ai: dayAudit.filter((a) => a.action.includes('AI') || a.action.includes('Agent')).length,
      actions: dayAudit.filter((a) => a.action.includes('动作') || a.action.includes('审批')).length,
    })
  }

  // 枚举字段分布（取第一个有枚举的类型）
  const enumDist: { typeName: string; field: string; items: { name: string; count: number; color?: string }[] }[] = []
  for (const t of types) {
    const enumProp = (t.properties as { key: string; name: string; type: string; enumValues?: string[] }[]).find((p) => p.type === 'enum' && p.enumValues?.length)
    if (!enumProp) continue
    const items = (enumProp.enumValues ?? []).map((v) => ({
      name: v,
      count: objs.filter((o) => o.typeId === t.id && (o.values as Record<string, unknown>)[enumProp.key] === v).length,
    })).filter((x) => x.count > 0)
    if (items.length > 0) enumDist.push({ typeName: t.name, field: enumProp.name, items })
    if (enumDist.length >= 3) break
  }

  // AI 网关真实可达性探测（未配置/不可达如实显示，不再恒「已连接」）
  const aiSetting = db.select().from(tables.settings).where(eq(tables.settings.key, 'ai')).get()
  const aiEndpoint = String(((aiSetting?.value ?? {}) as Record<string, unknown>).endpoint ?? '')
  const aiProbe = aiEndpoint ? await probeGateway(aiEndpoint) : { ok: false, metric: '未配置' }

  return c.json({
    space: { id: space.id, name: space.name, kind: space.kind },
    stats: {
      objectInstances: objs.length,
      typeCount: types.length,
      linkInstances: links.length,
      actionTypes: actions.length,
      documents: docs.length,
      chunks: chunks.length,
      activeRules: rules.length,
      pendingApprovals: approvals.filter((a) => a.status === '待审批').length,
      aiCalls: aiMsgs.length,
      unreadNotifications: notifications.filter((n) => n.read === 0).length,
      auditToday: audit.filter((a) => a.createdAt > now - 24 * 3600_000).length,
    },
    typeDist,
    trend: days,
    enumDist,
    recentAudit: audit.slice(0, 5).map((a) => ({
      actor: a.actor, action: a.action, target: a.target.slice(0, 40),
      createdAt: new Date(a.createdAt).toLocaleString('zh-CN', { hour12: false }),
    })),
    systemHealth: [
      { name: '本体服务', metric: `${objs.length} 对象 · ${types.length} 类型 · 运行中`, ok: true },
      { name: 'AI 网关', metric: aiProbe.metric, ok: aiProbe.ok },
      { name: '知识索引', metric: chunks.length > 0 ? `${chunks.length} 向量` : '无数据', ok: chunks.length > 0 },
      { name: '自动化引擎', metric: rules.length > 0 ? `${rules.length} 条启用规则运行中` : '无启用规则', ok: true },
    ],
  })
})

/** 对象字段聚合分析（Contour/Quiver 用） */
/**
 * 通用分组聚合（P9 增强）：支持
 *  - groupBy + metric(sum/avg/count)
 *  - bucket=day|week|month|quarter：当 groupBy 是日期字段时按时间分桶（消费趋势）
 *  - from/to：时间范围筛选（YYYY-MM-DD，按 groupBy 的日期字段或对象 updatedAt）
 *  - sort=count|sum|avg + order=desc|asc：默认按 sum 降序（金额最大优先，而非笔数）
 */
dashboardRoutes.get('/aggregate', (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const { typeId, groupBy, metric, bucket, from, to, sort, order } = c.req.query()
  if (!typeId || !groupBy) return c.json({ error: '请指定 typeId 与 groupBy' }, 400)

  const t = db.select().from(tables.objectTypes).all().find((x) => x.id === typeId && x.spaceId === space.id)
  if (!t) return c.json({ error: '类型不存在' }, 404)
  if (spacePerm(user, space, t.id) === 'none') return c.json({ error: '无权访问' }, 403)

  const props = t.properties as { key: string; name: string; type: string }[]
  const groupProp = props.find((p) => p.key === groupBy || p.name === groupBy)
  if (!groupProp) return c.json({ error: `分组字段「${groupBy}」不存在。该类型可用字段：${props.map((p) => `${p.name}(${p.key})`).join('、')}` }, 400)
  const metricProp = metric ? props.find((p) => p.key === metric || p.name === metric) : undefined
  if (metric && !metricProp) return c.json({ error: `指标字段「${metric}」不存在。该类型数值字段：${props.filter((p) => p.type === 'number').map((p) => `${p.name}(${p.key})`).join('、')}` }, 400)
  const isDateGroup = groupProp.type === 'date' || /date|time|day|month/i.test(groupProp.key)
  // 日期字段：用于时间范围筛选与分桶
  const dateKey = isDateGroup ? groupProp.key : (props.find((p) => p.type === 'date')?.key ?? '')

  /** 把日期值规范为 YYYY-MM-DD（兼容 "2026年11月08日" / 时间戳 / 带时分秒） */
  function normalizeDate(v: unknown): string {
    if (v == null || v === '') return ''
    const s = String(v).trim()
    let m = s.match(/^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/)
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
    const n = Number(s)
    if (!Number.isNaN(n) && n > 1e11) return new Date(n).toISOString().slice(0, 10)
    return s.slice(0, 10)
  }
  /** 时间分桶键 */
  function bucketOf(iso: string): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || '未设置'
    const [y, mo, d] = iso.split('-').map(Number)
    if (bucket === 'day') return iso
    if (bucket === 'week') {
      const dt = new Date(Date.UTC(y, mo - 1, d))
      const day = dt.getUTCDay() || 7
      dt.setUTCDate(dt.getUTCDate() - day + 1)
      return dt.toISOString().slice(0, 10) + ' 周'
    }
    if (bucket === 'quarter') return `${y}-Q${Math.ceil(mo / 3)}`
    return `${y}-${String(mo).padStart(2, '0')}` // month（默认）
  }

  // 空间/类型过滤下推到 SQL（命中 idx_objects_space_type），避免全表读进内存
  let objs = db.select().from(tables.objects)
    .where(and(eq(tables.objects.spaceId, space.id), eq(tables.objects.typeId, typeId)))
    .all()
  // 时间范围筛选
  if ((from || to) && dateKey) {
    objs = objs.filter((o) => {
      const iso = normalizeDate((o.values as Record<string, unknown>)[dateKey])
      if (!iso) return false
      if (from && iso < from) return false
      if (to && iso > to) return false
      return true
    })
  }

  // 按分组字段聚合
  const groups = new Map<string, { count: number; sum: number; avg: number }>()
  for (const o of objs) {
    const raw = (o.values as Record<string, unknown>)[groupProp.key]
    const gv = isDateGroup && bucket ? bucketOf(normalizeDate(raw)) : String(raw ?? '未设置')
    if (!groups.has(gv)) groups.set(gv, { count: 0, sum: 0, avg: 0 })
    const g = groups.get(gv)!
    g.count++
    if (metricProp) {
      const mv = Number((o.values as Record<string, unknown>)[metricProp.key])
      if (!Number.isNaN(mv)) g.sum += mv
    }
  }
  for (const [, g] of groups) g.avg = g.count > 0 ? Math.round((g.sum / g.count) * 10) / 10 : 0

  const sortKey = sort === 'count' ? 'count' : sort === 'avg' ? 'avg' : 'sum'
  const direction = order === 'asc' ? 1 : -1
  const sorted = Array.from(groups.entries()).map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => (a[sortKey] - b[sortKey]) * direction)

  return c.json({
    type: { id: t.id, name: t.name, color: t.color },
    groupBy: { key: groupProp.key, name: groupProp.name },
    metric: metricProp ? { key: metricProp.key, name: metricProp.name } : null,
    total: objs.length,
    applied: { bucket: bucket || null, from: from || null, to: to || null, sort: sortKey, order: order === 'asc' ? 'asc' : 'desc' },
    groups: sorted,
  })
})

/** 对象详情时间线（Quiver 用） */
dashboardRoutes.get('/timeline', (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const id = c.req.query('id') ?? ''
  if (!id) return c.json({ error: '缺少 id 参数' }, 400)
  const o = db.select().from(tables.objects).where(eq(tables.objects.id, id)).get()
  if (!o || o.spaceId !== space.id) return c.json({ error: '对象不存在' }, 404)
  const t = db.select().from(tables.objectTypes).all().find((x) => x.id === o.typeId)
  const audit = db.select().from(tables.auditEvents).all().filter((a) => a.target.includes(id)).sort((a, b) => b.createdAt - a.createdAt).slice(0, 10)
  return c.json({
    object: { id: o.id, values: o.values, createdAt: new Date(o.createdAt).toLocaleString('zh-CN', { hour12: false }), updatedAt: new Date(o.updatedAt).toLocaleString('zh-CN', { hour12: false }) },
    type: t ? { name: t.name, color: t.color, properties: t.properties } : null,
    timeline: audit.map((a) => ({
      time: new Date(a.createdAt).toLocaleString('zh-CN', { hour12: false }),
      actor: a.actor, action: a.action, detail: a.target.slice(0, 60),
    })),
  })
})
