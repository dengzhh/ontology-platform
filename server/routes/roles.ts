import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { db, tables } from '../db'
import { requireAuth, requireAdmin } from '../auth'
import type { SessionUser, RoleRow, GroupRow } from '../../shared/types'

/** 角色与用户组 */
export const roleRoutes = new Hono<{ Variables: { user: SessionUser } }>()
roleRoutes.use('*', requireAuth)

/** 用户组写操作审计留痕 */
function groupAudit(actor: string, action: string, target: string, detail?: Record<string, unknown>) {
  db.insert(tables.auditEvents).values({
    id: `AE-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    actor, action, target, detail, ip: '本地', createdAt: Date.now(),
  }).run()
}

/** 角色列表（含成员数） */
roleRoutes.get('/', (c) => {
  const roles = db.select().from(tables.roles).all()
  const users = db.select().from(tables.users).all()
  const rows: RoleRow[] = roles.map((r) => ({
    id: r.id, name: r.name, desc: r.desc,
    apps: r.apps, objectPerms: r.objectPerms as Record<string, string>,
    members: users.filter((u) => u.roleId === r.id && u.status === '在职').length,
  }))
  return c.json({ roles: rows })
})

/** 更新角色（应用可见性 / 对象权限） */
roleRoutes.patch('/:id', requireAdmin, async (c) => {
  const id = c.req.param('id') as string
  const patch = await c.req.json<{ apps?: string[]; objectPerms?: Record<string, string> }>()
  const set: Partial<typeof tables.roles.$inferInsert> = {}
  if (patch.apps) set.apps = patch.apps
  if (patch.objectPerms) set.objectPerms = patch.objectPerms
  if (Object.keys(set).length === 0) return c.json({ error: '无更新内容' }, 400)
  db.update(tables.roles).set(set).where(eq(tables.roles.id, id)).run()
  const actor = c.get('user')
  db.insert(tables.auditEvents).values({
    id: `AE-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    actor: actor.name, action: '更新角色权限', target: id, detail: { patch }, ip: '本地', createdAt: Date.now(),
  }).run()
  return c.json({ ok: true })
})

/** 用户组列表 */
roleRoutes.get('/groups', (c) => {
  const groups = db.select().from(tables.userGroups).all()
  const members = db.select().from(tables.groupMembers).all()
  const users = db.select().from(tables.users).all()
  const userMap = new Map(users.map((u) => [u.id, u.name]))
  const rows: GroupRow[] = groups.map((g) => ({
    id: g.id, name: g.name, desc: g.desc, defaultApp: g.defaultApp,
    members: members.filter((m) => m.groupId === g.id).map((m) => ({ id: m.userId, name: userMap.get(m.userId) ?? m.userId })),
  }))
  return c.json({ groups: rows })
})

/** 新建用户组 */
roleRoutes.post('/groups', requireAdmin, async (c) => {
  const body = await c.req.json<{ name?: string; desc?: string; defaultApp?: string }>()
  const name = body.name?.trim()
  if (!name) return c.json({ error: '请填写用户组名称' }, 400)
  const id = `G-${Date.now().toString(36).toUpperCase()}`
  db.insert(tables.userGroups).values({
    id, name, desc: body.desc?.trim() ?? '', defaultApp: body.defaultApp?.trim() ?? '', createdAt: Date.now(),
  }).run()
  groupAudit(c.get('user').name, '新建用户组', name)
  return c.json({ ok: true, id })
})

/** 编辑用户组（名称 / 说明 / 默认工作区） */
roleRoutes.patch('/groups/:id', requireAdmin, async (c) => {
  const id = c.req.param('id') as string
  const prev = db.select().from(tables.userGroups).where(eq(tables.userGroups.id, id)).get()
  if (!prev) return c.json({ error: '用户组不存在' }, 404)
  const patch = await c.req.json<{ name?: string; desc?: string; defaultApp?: string }>()
  const set: Partial<typeof tables.userGroups.$inferInsert> = {}
  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (!name) return c.json({ error: '用户组名称不能为空' }, 400)
    set.name = name
  }
  if (patch.desc !== undefined) set.desc = patch.desc
  if (patch.defaultApp !== undefined) set.defaultApp = patch.defaultApp
  if (Object.keys(set).length === 0) return c.json({ error: '无更新内容' }, 400)
  db.update(tables.userGroups).set(set).where(eq(tables.userGroups.id, id)).run()
  groupAudit(c.get('user').name, '更新用户组', prev.name, { patch })
  return c.json({ ok: true })
})

/** 删除用户组（连带清理成员关系） */
roleRoutes.delete('/groups/:id', requireAdmin, (c) => {
  const id = c.req.param('id') as string
  const prev = db.select().from(tables.userGroups).where(eq(tables.userGroups.id, id)).get()
  if (!prev) return c.json({ error: '用户组不存在' }, 404)
  db.delete(tables.groupMembers).where(eq(tables.groupMembers.groupId, id)).run()
  db.delete(tables.userGroups).where(eq(tables.userGroups.id, id)).run()
  groupAudit(c.get('user').name, '删除用户组', prev.name)
  return c.json({ ok: true })
})

/** 添加组成员 */
roleRoutes.post('/groups/:id/members', requireAdmin, async (c) => {
  const id = c.req.param('id') as string
  const group = db.select().from(tables.userGroups).where(eq(tables.userGroups.id, id)).get()
  if (!group) return c.json({ error: '用户组不存在' }, 404)
  const { userId } = await c.req.json<{ userId?: string }>()
  if (!userId) return c.json({ error: '请选择成员' }, 400)
  const user = db.select().from(tables.users).where(eq(tables.users.id, userId)).get()
  if (!user) return c.json({ error: '用户不存在' }, 404)
  const exists = db.select().from(tables.groupMembers).all().find((m) => m.groupId === id && m.userId === userId)
  if (exists) return c.json({ error: '该用户已是组成员' }, 400)
  db.insert(tables.groupMembers).values({ groupId: id, userId }).run()
  groupAudit(c.get('user').name, '添加组成员', `${group.name} ← ${user.name}`)
  return c.json({ ok: true })
})

/** 移除组成员 */
roleRoutes.delete('/groups/:id/members/:userId', requireAdmin, (c) => {
  const id = c.req.param('id') as string
  const userId = c.req.param('userId') as string
  const group = db.select().from(tables.userGroups).where(eq(tables.userGroups.id, id)).get()
  if (!group) return c.json({ error: '用户组不存在' }, 404)
  const user = db.select().from(tables.users).where(eq(tables.users.id, userId)).get()
  db.delete(tables.groupMembers).where(and(eq(tables.groupMembers.groupId, id), eq(tables.groupMembers.userId, userId))).run()
  groupAudit(c.get('user').name, '移除组成员', `${group.name} ← ${user?.name ?? userId}`)
  return c.json({ ok: true })
})
