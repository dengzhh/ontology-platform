import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { createHash, randomBytes } from 'node:crypto'
import { db, tables } from '../db'
import { requireAuth, requireAdmin } from '../auth'
import { resolveSpace, type SpaceInfo } from '../space'
import type { SessionUser } from '../../shared/types'

/** 第 2 批：多模型注册 / API 密钥 / 治理三表 CRUD（真实落库，替代写死常量） */
type Ctx = { Variables: { user: SessionUser; space: SpaceInfo } }
export const govRoutes = new Hono<Ctx>()
govRoutes.use('*', requireAuth)
govRoutes.use('*', async (c, next) => {
  const space = resolveSpace(c, c.get('user'))
  if (!space) return c.json({ error: '尚无可访问的本体空间' }, 403)
  c.set('space', space)
  await next()
})

function audit(actor: string, action: string, target: string) {
  db.insert(tables.auditEvents).values({ id: `AE-${Date.now()}-${Math.floor(Math.random()*1000)}`, actor, action, target, createdAt: Date.now(), ip: '本地' }).run()
}

/* ==================== 多模型注册（BYOM） ==================== */
govRoutes.get('/models', (c) => {
  const space = c.get('space')
  const rows = db.select().from(tables.modelRegistrations).all().filter((m) => m.spaceId === space.id || m.spaceId === '')
  return c.json({ models: rows.map((m) => ({ id: m.id, name: m.name, provider: m.provider, type: m.type, endpoint: m.endpoint, model: m.model, enabled: m.enabled === 1, quota: m.quota })) })
})

govRoutes.post('/models', requireAdmin, async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  type ModelBody = { id?: string; name: string; provider?: string; type?: string; endpoint?: string; model?: string; enabled?: boolean; quota?: number }
  const b = await c.req.json<ModelBody>().catch((): ModelBody => ({ name: '' }))
  if (!b.name?.trim()) return c.json({ error: '请填写模型名称' }, 400)
  const now = Date.now()
  if (b.id) {
    const prev = db.select().from(tables.modelRegistrations).where(eq(tables.modelRegistrations.id, b.id)).get()
    if (!prev) return c.json({ error: '模型不存在' }, 404)
    db.update(tables.modelRegistrations).set({ name: b.name.trim(), provider: b.provider ?? prev.provider, type: b.type ?? prev.type, endpoint: b.endpoint ?? prev.endpoint, model: b.model ?? prev.model, enabled: b.enabled === false ? 0 : 1, quota: b.quota ?? prev.quota, updatedAt: now }).where(eq(tables.modelRegistrations.id, b.id)).run()
    audit(user.name, '更新模型注册', b.name)
    return c.json({ id: b.id })
  }
  const id = `MDL-${now.toString(36).toUpperCase()}`
  db.insert(tables.modelRegistrations).values({ id, name: b.name.trim(), provider: b.provider ?? '自定义', type: b.type ?? '对话', endpoint: b.endpoint ?? '', model: b.model ?? '', enabled: 1, quota: b.quota ?? 0, spaceId: space.id, createdAt: now, updatedAt: now }).run()
  audit(user.name, '注册模型', b.name)
  return c.json({ id })
})

govRoutes.delete('/models/:id', requireAdmin, async (c) => {
  const id = c.req.param('id') as string
  const m = db.select().from(tables.modelRegistrations).where(eq(tables.modelRegistrations.id, id)).get()
  if (!m) return c.json({ error: '模型不存在' }, 404)
  db.delete(tables.modelRegistrations).where(eq(tables.modelRegistrations.id, id)).run()
  audit(c.get('user').name, '删除模型注册', m.name)
  return c.json({ ok: true })
})

/* ==================== API 密钥（哈希存储，不回传明文） ==================== */
govRoutes.get('/keys', requireAdmin, (c) => {
  const space = c.get('space')
  const rows = db.select().from(tables.apiKeys).all().filter((k) => k.spaceId === space.id || k.spaceId === '')
  return c.json({ keys: rows.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, scope: k.scope, lastUsedAt: k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString('zh-CN', { hour12: false }) : '从未使用', createdAt: new Date(k.createdAt).toLocaleString('zh-CN', { hour12: false }) })) })
})

govRoutes.post('/keys', requireAdmin, async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  type KeyBody = { name: string; scope?: string }
  const b = await c.req.json<KeyBody>().catch((): KeyBody => ({ name: '' }))
  if (!b.name?.trim()) return c.json({ error: '请填写密钥名称' }, 400)
  const raw = `ontoos_${randomBytes(24).toString('hex')}`
  const id = `KEY-${Date.now().toString(36).toUpperCase()}`
  db.insert(tables.apiKeys).values({
    id, name: b.name.trim(), keyHash: createHash('sha256').update(raw).digest('hex'),
    prefix: raw.slice(0, 12), scope: b.scope ?? 'read', ownerId: user.id,
    spaceId: space.id, createdAt: Date.now(),
  }).run()
  audit(user.name, '创建 API 密钥', b.name)
  // 明文仅在创建时返回一次
  return c.json({ id, key: raw, name: b.name })
})

govRoutes.delete('/keys/:id', requireAdmin, async (c) => {
  const id = c.req.param('id') as string
  const k = db.select().from(tables.apiKeys).where(eq(tables.apiKeys.id, id)).get()
  if (!k) return c.json({ error: '密钥不存在' }, 404)
  db.delete(tables.apiKeys).where(eq(tables.apiKeys.id, id)).run()
  audit(c.get('user').name, '删除 API 密钥', k.name)
  return c.json({ ok: true })
})

/* ==================== 治理三表：脱敏规则 / 扫描发现 / 生命周期策略 ==================== */
govRoutes.get('/cipher-rules', (c) => {
  const space = c.get('space')
  const rows = db.select().from(tables.cipherRules).all().filter((r) => r.spaceId === space.id)
  return c.json({ rules: rows.map((r) => ({ id: r.id, name: r.name, pattern: r.pattern, action: r.action, enabled: r.enabled === 1 })) })
})
govRoutes.post('/cipher-rules', requireAdmin, async (c) => {
  const space = c.get('space')
  type CipherBody = { name: string; pattern?: string; action?: string }
  const b = await c.req.json<CipherBody>().catch((): CipherBody => ({ name: '' }))
  if (!b.name?.trim()) return c.json({ error: '请填写规则名称' }, 400)
  const id = `CR-${Date.now().toString(36).toUpperCase()}`
  db.insert(tables.cipherRules).values({ id, name: b.name.trim(), pattern: b.pattern ?? '', action: b.action ?? '掩码', enabled: 1, spaceId: space.id, createdAt: Date.now() }).run()
  audit(c.get('user').name, '新建脱敏规则', b.name)
  return c.json({ id })
})
govRoutes.delete('/cipher-rules/:id', requireAdmin, async (c) => {
  db.delete(tables.cipherRules).where(eq(tables.cipherRules.id, c.req.param('id') as string)).run()
  return c.json({ ok: true })
})

govRoutes.get('/scan-findings', (c) => {
  const space = c.get('space')
  const rows = db.select().from(tables.scanFindings).all().filter((r) => r.spaceId === space.id)
  return c.json({
    findings: rows.map((r) => ({ id: r.id, table: r.table, field: r.field, sensitiveType: r.sensitiveType, status: r.status })),
    stats: { total: rows.length, pending: rows.filter((r) => r.status === '待处置').length, resolved: rows.filter((r) => r.status === '已处置').length },
  })
})
govRoutes.post('/scan-findings', requireAdmin, async (c) => {
  const space = c.get('space')
  type FindingBody = { table: string; field?: string; sensitiveType?: string }
  const b = await c.req.json<FindingBody>().catch((): FindingBody => ({ table: '' }))
  if (!b.table?.trim()) return c.json({ error: '请填写表名' }, 400)
  const id = `SF-${Date.now().toString(36).toUpperCase()}`
  db.insert(tables.scanFindings).values({ id, table: b.table.trim(), field: b.field ?? '', sensitiveType: b.sensitiveType ?? '', status: '待处置', spaceId: space.id, createdAt: Date.now() }).run()
  return c.json({ id })
})
govRoutes.patch('/scan-findings/:id', requireAdmin, async (c) => {
  type StatusBody = { status?: string }
  const b = await c.req.json<StatusBody>().catch((): StatusBody => ({}))
  db.update(tables.scanFindings).set({ status: b.status ?? '已处置' }).where(eq(tables.scanFindings.id, c.req.param('id') as string)).run()
  return c.json({ ok: true })
})
govRoutes.delete('/scan-findings/:id', requireAdmin, async (c) => {
  const id = c.req.param('id') as string
  const r = db.select().from(tables.scanFindings).where(eq(tables.scanFindings.id, id)).get()
  if (!r) return c.json({ error: '发现项不存在' }, 404)
  db.delete(tables.scanFindings).where(eq(tables.scanFindings.id, id)).run()
  return c.json({ ok: true })
})

govRoutes.get('/lifecycle-policies', (c) => {
  const space = c.get('space')
  const rows = db.select().from(tables.lifecyclePolicies).all().filter((r) => r.spaceId === space.id)
  return c.json({ policies: rows.map((r) => ({ id: r.id, name: r.name, retention: r.retention, legal: r.legal })) })
})
govRoutes.post('/lifecycle-policies', requireAdmin, async (c) => {
  const space = c.get('space')
  type PolicyBody = { name: string; retention?: string; legal?: string }
  const b = await c.req.json<PolicyBody>().catch((): PolicyBody => ({ name: '' }))
  if (!b.name?.trim()) return c.json({ error: '请填写策略名称' }, 400)
  const id = `LP-${Date.now().toString(36).toUpperCase()}`
  db.insert(tables.lifecyclePolicies).values({ id, name: b.name.trim(), retention: b.retention ?? '', legal: b.legal ?? '', spaceId: space.id, createdAt: Date.now() }).run()
  return c.json({ id })
})
govRoutes.delete('/lifecycle-policies/:id', requireAdmin, async (c) => {
  db.delete(tables.lifecyclePolicies).where(eq(tables.lifecyclePolicies.id, c.req.param('id') as string)).run()
  return c.json({ ok: true })
})
