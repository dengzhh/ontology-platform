import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, tables } from '../db'
import { requireAuth } from '../auth'
import { resolveSpace, spaceCanModel, type SpaceInfo } from '../space'
import type { SessionUser } from '../../shared/types'

/** 自动化规则 CRUD + 通知中心（P7） */

interface Trigger { kind: 'object_change' | 'threshold'; typeId?: string; field?: string; op?: string; value?: number }

type Ctx = { Variables: { user: SessionUser; space: SpaceInfo } }

function audit(user: SessionUser, action: string, target: string) {
  db.insert(tables.auditEvents).values({
    id: `AE-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    actor: user.name, action, target, ip: '本地', createdAt: Date.now(),
  }).run()
}

export const automationRoutes = new Hono<Ctx>()
automationRoutes.use('*', requireAuth)
automationRoutes.use('*', async (c, next) => {
  const user = c.get('user')
  const space = resolveSpace(c, user)
  if (!space) return c.json({ error: '尚无可访问的本体空间' }, 403)
  c.set('space', space)
  await next()
})

/** 规则列表（当前空间） */
automationRoutes.get('/rules', (c) => {
  const space = c.get('space')
  const rows = db.select().from(tables.automationRules).all().filter((r) => r.spaceId === space.id).sort((a, b) => b.createdAt - a.createdAt)
  const types = db.select().from(tables.objectTypes).all().filter((t) => t.spaceId === space.id)
  const typeMap = new Map(types.map((t) => [t.id, t.name]))
  return c.json({
    space: { id: space.id, name: space.name },
    types: types.map((t) => ({ id: t.id, name: t.name, properties: t.properties })),
    rules: rows.map((r) => ({
      id: r.id, name: r.name, trigger: r.trigger, condition: r.condition, actions: r.actions,
      enabled: r.enabled === 1, hitCount: r.hitCount,
      lastTriggeredAt: r.lastTriggeredAt ? new Date(r.lastTriggeredAt).toLocaleString('zh-CN', { hour12: false }) : '',
      triggerTypeName: r.trigger.typeId ? typeMap.get(r.trigger.typeId) ?? r.trigger.typeId : '任意类型',
    })),
  })
})

/** 新建规则 */
automationRoutes.post('/rules', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  if (!spaceCanModel(user, space)) return c.json({ error: '需要空间管理权限' }, 403)
  const body = await c.req.json<{ name: string; trigger: Trigger; condition?: string; actions: { kind: string; config?: Record<string, unknown> }[] }>()
  if (!body.name?.trim() || !body.trigger?.kind || !body.actions?.length) return c.json({ error: '请填写名称、触发条件与至少一个执行动作' }, 400)
  const id = `AR-${Date.now().toString(36).toUpperCase()}`
  db.insert(tables.automationRules).values({
    id, name: body.name.trim(), trigger: body.trigger, condition: body.condition ?? '',
    actions: body.actions, enabled: 1, hitCount: 0, owner: user.name, spaceId: space.id, createdAt: Date.now(),
  }).run()
  audit(user, '新建自动化规则', `${body.name}@${space.name}`)
  return c.json({ ok: true, id })
})

/** 启停 / 重命名 / 编辑触发器、条件表达式、执行动作 */
automationRoutes.patch('/rules/:id', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  if (!spaceCanModel(user, space)) return c.json({ error: '需要空间管理权限' }, 403)
  const id = c.req.param('id') as string
  const prev = db.select().from(tables.automationRules).all().find((r) => r.id === id && r.spaceId === space.id)
  if (!prev) return c.json({ error: '规则不存在（当前空间）' }, 404)
  const body = await c.req.json<{
    enabled?: boolean; name?: string; trigger?: Trigger; condition?: string
    actions?: { kind: string; config?: Record<string, unknown> }[]
  }>()
  const set: Partial<typeof tables.automationRules.$inferInsert> = {}
  if (body.enabled !== undefined) set.enabled = body.enabled ? 1 : 0
  if (body.name !== undefined) set.name = body.name
  if (body.trigger !== undefined) set.trigger = body.trigger
  if (body.condition !== undefined) set.condition = body.condition
  if (body.actions !== undefined) set.actions = body.actions
  if (Object.keys(set).length === 0) return c.json({ error: '无更新内容' }, 400)
  db.update(tables.automationRules).set(set).where(eq(tables.automationRules.id, id)).run()
  audit(user, body.enabled === false ? '停用自动化规则' : '更新自动化规则', prev.name)
  return c.json({ ok: true })
})

/** 删除 */
automationRoutes.delete('/rules/:id', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  if (!spaceCanModel(user, space)) return c.json({ error: '需要空间管理权限' }, 403)
  const id = c.req.param('id') as string
  const prev = db.select().from(tables.automationRules).all().find((r) => r.id === id && r.spaceId === space.id)
  if (!prev) return c.json({ error: '规则不存在' }, 404)
  db.delete(tables.automationRules).where(eq(tables.automationRules.id, id)).run()
  audit(user, '删除自动化规则', prev.name)
  return c.json({ ok: true })
})

/* ---------------- 通知中心 ---------------- */

automationRoutes.get('/notifications', (c) => {
  const rows = db.select().from(tables.notifications).all().sort((a, b) => b.createdAt - a.createdAt).slice(0, 30)
  return c.json({
    unread: rows.filter((r) => r.read === 0).length,
    notifications: rows.map((r) => ({
      id: r.id, title: r.title, body: r.body, level: r.level, tag: r.tag, read: r.read === 1,
      createdAt: new Date(r.createdAt).toLocaleString('zh-CN', { hour12: false }),
    })),
  })
})

automationRoutes.post('/notifications/read', async (c) => {
  const { id } = await c.req.json<{ id?: string }>()
  if (id) db.update(tables.notifications).set({ read: 1 }).where(eq(tables.notifications.id, id)).run()
  else db.update(tables.notifications).set({ read: 1 }).run()
  return c.json({ ok: true })
})
