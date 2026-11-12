import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, tables } from '../db'
import { requireAuth } from '../auth'
import { resolveSpace, isMember, type SpaceInfo } from '../space'
import type { SessionUser } from '../../shared/types'

/** Workshop 应用搭建 API（P8）：应用 CRUD + widgets 配置持久化（空间隔离） */

interface WidgetConfig {
  typeId?: string
  title?: string
  metricKey?: string
  aggregation?: 'count' | 'sum' | 'avg'
  chartType?: 'bar' | 'line' | 'pie'
  [k: string]: unknown
}
interface Widget { id: string; type: string; config: WidgetConfig }
interface Variable { name: string; type: string; bound?: string }

type Ctx = { Variables: { user: SessionUser; space: SpaceInfo } }

function audit(user: SessionUser, action: string, target: string) {
  db.insert(tables.auditEvents).values({
    id: `AE-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    actor: user.name, action, target, ip: '本地', createdAt: Date.now(),
  }).run()
}

export const workshopRoutes = new Hono<Ctx>()
workshopRoutes.use('*', requireAuth)
workshopRoutes.use('*', async (c, next) => {
  const user = c.get('user')
  const space = resolveSpace(c, user)
  if (!space) return c.json({ error: '尚无可访问的本体空间' }, 403)
  c.set('space', space)
  await next()
})

/** 应用列表（当前空间） */
workshopRoutes.get('/', (c) => {
  const space = c.get('space')
  const apps = db.select().from(tables.workshopApps).all().filter((a) => a.spaceId === space.id).sort((a, b) => b.updatedAt - a.updatedAt)
  const types = db.select().from(tables.objectTypes).all().filter((t) => t.spaceId === space.id)
  const typeMap = new Map(types.map((t) => [t.id, t.name]))
  return c.json({
    space: { id: space.id, name: space.name },
    types: types.map((t) => ({ id: t.id, name: t.name, color: t.color, count: db.select().from(tables.objects).all().filter((o) => o.typeId === t.id && o.spaceId === space.id).length, properties: t.properties })),
    apps: apps.map((a) => ({
      id: a.id, name: a.name, desc: a.desc,
      widgetCount: (a.widgets as Widget[]).length,
      updatedAt: new Date(a.updatedAt).toLocaleString('zh-CN', { hour12: false }),
      ownerId: a.ownerId,
    })),
  })
})

/** 单个应用详情（含完整 widgets 配置） */
workshopRoutes.get('/:id', (c) => {
  const space = c.get('space')
  const app = db.select().from(tables.workshopApps).all().find((a) => a.id === c.req.param('id') && a.spaceId === space.id)
  if (!app) return c.json({ error: '应用不存在（当前空间）' }, 404)
  return c.json({ app: { ...app, updatedAt: new Date(app.updatedAt).toLocaleString('zh-CN', { hour12: false }) } })
})

/** 新建应用 */
workshopRoutes.post('/', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  if (!isMember(space.id, user.id)) return c.json({ error: '非空间成员' }, 403)
  const body = await c.req.json<{ name: string; desc?: string; widgets?: Widget[]; variables?: Variable[] }>()
  if (!body.name?.trim()) return c.json({ error: '请填写应用名称' }, 400)
  const id = `WA-${Date.now().toString(36).toUpperCase()}`
  db.insert(tables.workshopApps).values({
    id, name: body.name.trim(), desc: body.desc ?? '',
    widgets: body.widgets ?? [], variables: body.variables ?? [],
    ownerId: user.id, spaceId: space.id, createdAt: Date.now(), updatedAt: Date.now(),
  }).run()
  audit(user, '新建 Workshop 应用', `${body.name}@${space.name}`)
  return c.json({ id, name: body.name })
})

/** 更新（重命名/保存 widgets） */
workshopRoutes.patch('/:id', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const id = c.req.param('id') as string
  const prev = db.select().from(tables.workshopApps).all().find((a) => a.id === id && a.spaceId === space.id)
  if (!prev) return c.json({ error: '应用不存在' }, 404)
  if (prev.ownerId !== user.id && user.role.id !== 'admin') return c.json({ error: '仅应用创建者可编辑' }, 403)
  const body = await c.req.json<{ name?: string; desc?: string; widgets?: Widget[]; variables?: Variable[] }>()
  const set: Record<string, unknown> = { updatedAt: Date.now() }
  if (body.name !== undefined) set.name = body.name
  if (body.desc !== undefined) set.desc = body.desc
  if (body.widgets !== undefined) set.widgets = body.widgets
  if (body.variables !== undefined) set.variables = body.variables
  db.update(tables.workshopApps).set(set).where(eq(tables.workshopApps.id, id)).run()
  audit(user, '保存 Workshop 应用', prev.name)
  return c.json({ ok: true })
})

/** 删除 */
workshopRoutes.delete('/:id', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const id = c.req.param('id') as string
  const prev = db.select().from(tables.workshopApps).all().find((a) => a.id === id && a.spaceId === space.id)
  if (!prev) return c.json({ error: '应用不存在' }, 404)
  if (prev.ownerId !== user.id && user.role.id !== 'admin') return c.json({ error: '仅应用创建者可删除' }, 403)
  db.delete(tables.workshopApps).where(eq(tables.workshopApps.id, id)).run()
  audit(user, '删除 Workshop 应用', prev.name)
  return c.json({ ok: true })
})
