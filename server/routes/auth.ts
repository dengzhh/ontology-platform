import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, tables } from '../db'
import { loadSessionUser, issueToken, setSessionCookie, verifyPassword, buildSessionUser, verifyInviteToken, hashPassword } from '../auth'

export const authRoutes = new Hono()

/** 激活账号（邀请链接落地页调用，公开） */
authRoutes.post('/activate', async (c) => {
  const { token, password } = await c.req.json<{ token: string; password: string }>()
  if (!token || !password || password.length < 6) return c.json({ error: '请设置至少 6 位密码' }, 400)
  const userId = await verifyInviteToken(token)
  if (!userId) return c.json({ error: '邀请链接无效或已过期，请联系管理员重新邀请' }, 400)
  const row = db.select().from(tables.users).where(eq(tables.users.id, userId)).get()
  if (!row) return c.json({ error: '邀请对应的账号不存在' }, 404)
  db.update(tables.users).set({ passwordHash: hashPassword(password), status: '在职' }).where(eq(tables.users.id, userId)).run()
  db.update(tables.invitations).set({ status: '已激活', activatedAt: Date.now() }).where(eq(tables.invitations.userId, userId)).run()
  db.insert(tables.auditEvents).values({
    id: `AE-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    actor: row.name, action: '激活账号（邀请链接）', target: row.account, ip: '本地', createdAt: Date.now(),
  }).run()
  return c.json({ ok: true, account: row.account })
})

/** 登录：返回 JWT + 会话用户 */
authRoutes.post('/login', async (c) => {
  const { account, password } = await c.req.json<{ account: string; password: string }>()
  if (!account || !password) return c.json({ error: '请输入账号与密码' }, 400)
  const row = db.select().from(tables.users).where(eq(tables.users.account, account)).get()
  if (!row || !verifyPassword(password, row.passwordHash)) {
    return c.json({ error: '账号或密码错误' }, 401)
  }
  if (row.status === '待激活') return c.json({ error: '账号尚未激活，请先通过邀请邮件中的链接设置密码' }, 403)
  if (row.status !== '在职') return c.json({ error: '账号已停用，请联系管理员' }, 403)
  db.update(tables.users).set({ lastLoginAt: new Date().toLocaleString('zh-CN', { hour12: false }) }).where(eq(tables.users.id, row.id)).run()
  const token = await issueToken(row.id)
  setSessionCookie(c, token)
  // audit
  db.insert(tables.auditEvents).values({
    id: `AE-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    actor: row.name, action: '登录平台', target: row.account, ip: '本地',
    createdAt: Date.now(),
  }).run()
  const user = buildSessionUser(row.id)
  return c.json({ token, user })
})

/** 当前会话用户 */
authRoutes.get('/me', async (c) => {
  const user = await loadSessionUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)
  return c.json({ user })
})

/** 登出（JWT 无状态，前端清除 token；记录审计） */
authRoutes.post('/logout', async (c) => {
  const user = await loadSessionUser(c)
  if (user) {
    db.insert(tables.auditEvents).values({
      id: `AE-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      actor: user.name, action: '退出登录', target: user.account, ip: '本地',
      createdAt: Date.now(),
    }).run()
  }
  return c.json({ ok: true })
})
