import { Hono } from 'hono'
import { and, eq, desc } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { db, tables } from '../db'
import { requireAuth } from '../auth'
import { resolveSpace, type SpaceInfo } from '../space'
import type { SessionUser } from '../../shared/types'

/**
 * 真实时序采集 + 治理执行引擎。
 * 所有端点 requireAuth + resolveSpace + 空间隔离；每次真实动作写 audit_events 留痕。
 * 路由由 index.ts 统一挂载于 /api/ops，文件内路径均为相对形态（/timeseries/...、/governance/...）。
 */
type Ctx = { Variables: { user: SessionUser; space: SpaceInfo } }
export const platformOpsRoutes = new Hono<Ctx>()

platformOpsRoutes.use('*', requireAuth)
platformOpsRoutes.use('*', async (c, next) => {
  const space = resolveSpace(c, c.get('user'))
  if (!space) return c.json({ error: '尚无可访问的本体空间' }, 403)
  c.set('space', space)
  await next()
})

function audit(actor: string, action: string, target: string, detail?: Record<string, unknown>) {
  db.insert(tables.auditEvents).values({
    id: `AE-${randomUUID()}`,
    actor, action, target, detail, ip: '本地', createdAt: Date.now(),
  }).run()
}

/** 写一条治理执行记录，返回其 id */
function writeRun(spaceId: string, kind: 'scan' | 'mask' | 'lifecycle', target: string, result: string, count: number): string {
  const id = `GR-${randomUUID()}`
  db.insert(tables.governanceRuns).values({
    id, kind, target, result, count, spaceId, createdAt: Date.now(),
  }).run()
  return id
}

/** 当前空间全部对象 id 集合（ts_points 没有 space_id，空间隔离靠关联 objects.object_id） */
function objectIdsOfSpace(spaceId: string): Set<string> {
  return new Set(
    db.select().from(tables.objects).all()
      .filter((o) => o.spaceId === spaceId)
      .map((o) => o.id),
  )
}

function clampLimit(raw: string | undefined, fallback = 100, max = 1000): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(Math.floor(n), max)
}

/* ============================================================================
 * 真实时序采集（ts_points 真实写入 / 查询，替代纯模拟曲线）
 * ==========================================================================*/

/** GET /timeseries/points?metric=&objectId=&limit= 读真实采样点（按 t 降序，空间经 objectId 关联 objects.spaceId 过滤） */
platformOpsRoutes.get('/timeseries/points', (c) => {
  const space = c.get('space')
  const metric = (c.req.query('metric') ?? '').trim()
  const objectId = (c.req.query('objectId') ?? '').trim()
  const limit = clampLimit(c.req.query('limit'))
  const allowedIds = objectIdsOfSpace(space.id)

  const where = metric ? eq(tables.tsPoints.metric, metric) : undefined
  const rows = db.select().from(tables.tsPoints)
    .where(where)
    .orderBy(desc(tables.tsPoints.t))
    .all()
    .filter((p) => allowedIds.has(p.objectId) && (!objectId || p.objectId === objectId))
    .slice(0, limit)

  return c.json({
    points: rows.map((p) => ({
      id: p.id,
      metric: p.metric,
      objectId: p.objectId,
      t: p.t,
      value: p.value,
      time: new Date(p.t).toLocaleString('zh-CN', { hour12: false }),
    })),
    total: rows.length,
    real: true,
  })
})

/** POST /timeseries/collect 校验对象属于当前空间 → 真实插入 ts_points（唯一冲突 INSERT OR IGNORE） */
platformOpsRoutes.post('/timeseries/collect', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  type Body = { metric?: string; objectId?: string; value?: number; t?: number }
  const b = await c.req.json<Body>().catch((): Body => ({}))

  const metric = String(b.metric ?? '').trim()
  const objectId = String(b.objectId ?? '').trim()
  const value = Number(b.value)
  if (!metric) return c.json({ error: '请填写指标名 metric' }, 400)
  if (!objectId) return c.json({ error: '请填写对象 id objectId' }, 400)
  if (!Number.isFinite(value)) return c.json({ error: 'value 必须为有效数值' }, 400)

  const obj = db.select().from(tables.objects).where(eq(tables.objects.id, objectId)).get()
  if (!obj || obj.spaceId !== space.id) return c.json({ error: '对象不存在或不属于当前空间' }, 404)

  const t = Number.isFinite(Number(b.t)) && Number(b.t) > 0 ? Math.floor(Number(b.t)) : Date.now()
  const id = `TS-${randomUUID()}`

  // INSERT OR IGNORE 等价：唯一索引 (metric, objectId, t) 冲突时静默跳过
  const result = db.insert(tables.tsPoints)
    .values({ id, metric, objectId, t, value })
    .onConflictDoNothing({ target: [tables.tsPoints.metric, tables.tsPoints.objectId, tables.tsPoints.t] })
    .run()
  const inserted = result.changes > 0

  audit(user.name, '真实时序采集', `指标 ${metric} · 对象 ${objectId}`, { value, t, inserted })
  return c.json({ inserted, id, metric, objectId, t, value, real: true })
})

/** POST /timeseries/collect-from-objects 按 valueKey 从当前空间对象批量生成真实采样（t 按小时对齐） */
platformOpsRoutes.post('/timeseries/collect-from-objects', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  type Body = { metric?: string; valueKey?: string }
  const b = await c.req.json<Body>().catch((): Body => ({}))

  const metric = String(b.metric ?? '').trim() || 'health'
  const valueKey = String(b.valueKey ?? '').trim() || 'health'
  const now = Date.now()
  const t = Math.floor(now / 3_600_000) * 3_600_000 // 当前按小时对齐

  const objects = db.select().from(tables.objects).all().filter((o) => o.spaceId === space.id)
  let insertedCount = 0
  let skipped = 0
  for (const o of objects) {
    const raw = (o.values as Record<string, unknown>)[valueKey]
    const value = Number(raw)
    if (raw === undefined || raw === null || raw === '' || !Number.isFinite(value)) {
      skipped++
      continue
    }
    const result = db.insert(tables.tsPoints)
      .values({ id: `TS-${randomUUID()}`, metric, objectId: o.id, t, value })
      .onConflictDoNothing({ target: [tables.tsPoints.metric, tables.tsPoints.objectId, tables.tsPoints.t] })
      .run()
    if (result.changes > 0) insertedCount++
    else skipped++
  }

  audit(user.name, '批量真实采集', `指标 ${metric} · 字段 ${valueKey}`, { t, objectCount: objects.length, insertedCount, skipped })
  return c.json({
    metric, valueKey, t,
    time: new Date(t).toLocaleString('zh-CN', { hour12: false }),
    objectCount: objects.length,
    inserted: insertedCount,
    skipped,
    real: true,
  })
})

/** GET /timeseries/series?metric=&limit= 按 metric 返回真实点序列（升序，供前端画真实曲线） */
platformOpsRoutes.get('/timeseries/series', (c) => {
  const space = c.get('space')
  const metric = (c.req.query('metric') ?? '').trim() || 'health'
  const limit = clampLimit(c.req.query('limit'), 200, 2000)
  const allowedIds = objectIdsOfSpace(space.id)

  const rows = db.select().from(tables.tsPoints)
    .where(eq(tables.tsPoints.metric, metric))
    .orderBy(desc(tables.tsPoints.t))
    .all()
    .filter((p) => allowedIds.has(p.objectId))
    .slice(0, limit)
    .reverse() // 时间升序，便于画曲线

  const byObject = new Map<string, { objectId: string; points: { t: number; value: number }[] }>()
  for (const p of rows) {
    const g = byObject.get(p.objectId) ?? { objectId: p.objectId, points: [] }
    g.points.push({ t: p.t, value: p.value })
    byObject.set(p.objectId, g)
  }

  return c.json({
    metric,
    count: rows.length,
    points: rows.map((p) => ({
      t: p.t,
      time: new Date(p.t).toLocaleString('zh-CN', { hour12: false }),
      objectId: p.objectId,
      value: p.value,
    })),
    series: Array.from(byObject.values()),
    real: true,
  })
})

/* ============================================================================
 * 治理执行引擎（真实计算 / 预览 + 执行记录）
 * ==========================================================================*/

/** 敏感样式：手机号 / 邮箱 / 身份证 */
const SENSITIVE_PATTERNS: { type: string; re: RegExp }[] = [
  { type: '手机号', re: /1[3-9]\d{9}/ },
  { type: '邮箱', re: /[\w.+-]+@[\w-]+\.[\w.-]+/ },
  { type: '身份证', re: /\d{17}[\dXx]/ },
]

/** 按 cipherRules 的 pattern 编译正则；pattern 为空或非法时回退为字段名大小写不敏感匹配 */
function compilePattern(pattern: string): RegExp | null {
  const p = pattern.trim()
  if (!p) return null
  try {
    return new RegExp(p, 'i')
  } catch {
    return null
  }
}

function spaceObjects(spaceId: string) {
  return db.select().from(tables.objects).all().filter((o) => o.spaceId === spaceId)
}

/** POST /governance/scan 真实扫描对象 values（手机号/邮箱/身份证样式），可选写回 scanFindings */
platformOpsRoutes.post('/governance/scan', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  type Body = { writeBack?: boolean }
  const b = await c.req.json<Body>().catch((): Body => ({}))
  const writeBack = b.writeBack === true

  const registered = db.select().from(tables.scanFindings).all()
    .filter((r) => r.spaceId === space.id)
    .map((r) => r.field.trim())
    .filter(Boolean)
  const objects = spaceObjects(space.id)

  interface Hit { objectId: string; field: string; sensitiveType: string; sample: string }
  const hits: Hit[] = []
  for (const o of objects) {
    const values = o.values as Record<string, unknown>
    for (const [field, raw] of Object.entries(values)) {
      // 仅检查已登记字段；若无登记则全字段扫描
      if (registered.length > 0 && !registered.includes(field)) continue
      const text = String(raw ?? '')
      if (!text) continue
      for (const { type, re } of SENSITIVE_PATTERNS) {
        if (re.test(text)) {
          hits.push({ objectId: o.id, field, sensitiveType: type, sample: text.length > 40 ? `${text.slice(0, 40)}…` : text })
          break
        }
      }
    }
  }

  let written = 0
  const now = Date.now()
  if (writeBack) {
    for (const h of hits) {
      const exists = db.select().from(tables.scanFindings).all()
        .some((r) => r.spaceId === space.id && r.table === 'objects' && r.field === h.field && r.sensitiveType === h.sensitiveType)
      if (exists) continue
      db.insert(tables.scanFindings).values({
        id: `SF-${randomUUID()}`,
        table: 'objects', field: h.field, sensitiveType: h.sensitiveType,
        status: '待处置', spaceId: space.id, createdAt: now,
      }).run()
      written++
    }
  }

  const result = `扫描 ${objects.length} 个对象，命中 ${hits.length} 个敏感值${writeBack ? `，写回 ${written} 条新发现` : '（仅返回，未写回）'}`
  const runId = writeRun(space.id, 'scan', 'objects.values', result, hits.length)
  audit(user.name, '执行敏感扫描', result, { hitCount: hits.length, written, writeBack })

  return c.json({
    runId, scannedObjects: objects.length, hitCount: hits.length, written,
    registeredFields: registered,
    hits: hits.slice(0, 50),
    result,
    real: true,
  })
})

/** POST /governance/mask 按 cipherRules 对当前空间对象做真实脱敏预览（不改库，明确标注预览） */
platformOpsRoutes.post('/governance/mask', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const rules = db.select().from(tables.cipherRules).all()
    .filter((r) => r.spaceId === space.id && r.enabled === 1)
  const objects = spaceObjects(space.id)

  interface Match { ruleName: string; action: string; objectId: string; field: string; original: string; masked: string }
  const matches: Match[] = []
  const matchedFields = new Set<string>()

  for (const r of rules) {
    const re = compilePattern(r.pattern)
    for (const o of objects) {
      const values = o.values as Record<string, unknown>
      for (const [field, raw] of Object.entries(values)) {
        const text = String(raw ?? '')
        if (!text) continue
        const byName = !r.pattern.trim() || (re === null && r.pattern.toLowerCase() === field.toLowerCase())
        const hit = re ? re.test(text) || re.test(field) : byName
        if (!hit) continue
        matchedFields.add(`${o.id}::${field}`)
        if (matches.length < 50) {
          matches.push({
            ruleName: r.name, action: r.action, objectId: o.id, field,
            original: text.length > 30 ? `${text.slice(0, 30)}…` : text,
            masked: maskValue(text, r.action),
          })
        }
      }
    }
  }

  const fieldCount = matchedFields.size
  const result = `脱敏预览（未改库）：按 ${rules.length} 条启用规则命中 ${fieldCount} 个字段`
  const runId = writeRun(space.id, 'mask', 'objects.values（预览）', result, fieldCount)
  audit(user.name, '执行脱敏预览', result, { ruleCount: rules.length, fieldCount, preview: true })

  return c.json({
    runId, ruleCount: rules.length, fieldCount,
    samples: matches,
    result,
    preview: true,
    note: '仅为预览：返回按规则会被掩码的字段数与样例，不会修改数据库对象值。',
    real: true,
  })
})

function maskValue(text: string, action: string): string {
  if (action.includes('哈希')) return `sha256(${text.slice(0, 6)}…)` // 预览示意：哈希动作标注
  if (action.includes('截断') || action.includes('置空')) return text.length > 2 ? `${text.slice(0, 1)}****` : '****'
  // 默认掩码：保留首尾，中间打星
  if (text.length <= 2) return '*'.repeat(text.length)
  return `${text.slice(0, 1)}${'*'.repeat(Math.max(1, text.length - 2))}${text.slice(-1)}`
}

/** 解析「180 天 / 3 年 / 永久」等保留期限为毫秒；无法解析返回 null */
function parseRetention(retention: string): number | null {
  const s = retention.trim()
  if (!s || s.includes('永久') || s.includes('长期') || s.includes('无限')) return null
  const n = Number((s.match(/\d+/) ?? [])[0])
  if (!Number.isFinite(n) || n <= 0) return null
  const DAY = 86_400_000
  if (s.includes('年')) return n * 365 * DAY
  if (s.includes('月')) return n * 30 * DAY
  if (s.includes('小时')) return n * 3_600_000
  return n * DAY // 默认按天
}

/** POST /governance/lifecycle 按 lifecyclePolicies 真实计算到期审计事件数 */
platformOpsRoutes.post('/governance/lifecycle', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const policies = db.select().from(tables.lifecyclePolicies).all()
    .filter((r) => r.spaceId === space.id)
  const objects = spaceObjects(space.id)
  const now = Date.now()

  interface PolicyResult { policy: string; retention: string; expiresAt: number | null; expiredObjectCount: number; note: string }
  interface Event { policy: string; objectId: string; createdAt: number; dueAt: number; legal: string }
  const policyResults: PolicyResult[] = []
  const events: Event[] = []

  for (const p of policies) {
    const duration = parseRetention(p.retention)
    if (duration === null) {
      policyResults.push({ policy: p.name, retention: p.retention, expiresAt: null, expiredObjectCount: 0, note: '永久/长期保留或期限无法解析，不计到期' })
      continue
    }
    let expiredCount = 0
    for (const o of objects) {
      const dueAt = o.createdAt + duration
      if (now >= dueAt) {
        expiredCount++
        if (events.length < 200) {
          events.push({ policy: p.name, objectId: o.id, createdAt: o.createdAt, dueAt, legal: p.legal })
        }
      }
    }
    policyResults.push({ policy: p.name, retention: p.retention, expiresAt: now - duration, expiredObjectCount: expiredCount, note: `按对象 createdAt + ${p.retention} 计算到期` })
  }

  const expiredCount = policyResults.reduce((s, p) => s + p.expiredObjectCount, 0)
  const result = `生命周期检查：${policies.length} 条策略，${objects.length} 个对象，计算得到 ${expiredCount} 个到期审计事件`
  const runId = writeRun(space.id, 'lifecycle', 'objects.createdAt', result, expiredCount)
  audit(user.name, '执行生命周期检查', result, { policyCount: policies.length, objectCount: objects.length, expiredCount, preview: true })

  return c.json({
    runId, policyCount: policies.length, objectCount: objects.length, expiredCount,
    policies: policyResults,
    events: events.slice(0, 50),
    result,
    note: '按策略保留期限与对象创建时间计算到期审计事件（预览，不实际归档或删除数据）。',
    real: true,
  })
})

/** GET /governance/runs 执行记录列表（仅当前空间，按时间降序） */
platformOpsRoutes.get('/governance/runs', (c) => {
  const space = c.get('space')
  const limit = clampLimit(c.req.query('limit'), 50, 500)
  const rows = db.select().from(tables.governanceRuns)
    .where(and(eq(tables.governanceRuns.spaceId, space.id)))
    .orderBy(desc(tables.governanceRuns.createdAt))
    .all()
    .slice(0, limit)

  return c.json({
    runs: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      kindLabel: r.kind === 'scan' ? '敏感扫描' : r.kind === 'mask' ? '脱敏预览' : '生命周期检查',
      target: r.target,
      result: r.result,
      count: r.count,
      time: new Date(r.createdAt).toLocaleString('zh-CN', { hour12: false }),
      createdAt: r.createdAt,
    })),
    total: rows.length,
    real: true,
  })
})
