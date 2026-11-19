import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, tables } from '../db'
import { requireAuth, requireAdmin, hashPassword, issueInviteToken, bumpTokenEpoch } from '../auth'
import { isSmtpConfigured, sendMail } from '../mailer'
import type { SessionUser, UserRow } from '../../shared/types'

export const userRoutes = new Hono<{ Variables: { user: SessionUser } }>()
userRoutes.use('*', requireAuth)

function toUserRow(u: typeof tables.users.$inferSelect, roleName: string): UserRow {
  return {
    id: u.id, name: u.name, account: u.account, dept: u.dept,
    roleId: u.roleId, roleName, markings: u.markings, status: u.status, lastLoginAt: u.lastLoginAt,
  }
}

/** 用户列表 */
userRoutes.get('/', requireAdmin, (c) => {
  const roles = db.select().from(tables.roles).all()
  const roleMap = new Map(roles.map((r) => [r.id, r.name]))
  const rows = db.select().from(tables.users).all().map((u) => toUserRow(u, roleMap.get(u.roleId) ?? ''))
  return c.json({ users: rows })
})

/** 创建用户（邀请）：建号（待激活）+ 生成邀请链接与邮件内容 */
userRoutes.post('/invite', requireAdmin, async (c) => {
  const { name, account, roleId, dept, channel = 'email', email = '' } = await c.req.json<{
    name: string; account: string; roleId: string; dept?: string; channel?: 'email' | 'link'; email?: string
  }>()
  if (!name || !account || !roleId) return c.json({ error: '请填写姓名、账号与角色' }, 400)
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  if (channel === 'email' && !emailOk) return c.json({ error: '邮件邀请必须填写有效的收件邮箱' }, 400)
  const exists = db.select().from(tables.users).where(eq(tables.users.account, account)).get()
  if (exists) return c.json({ error: '账号已存在' }, 409)

  const actor = c.get('user')
  const id = `U-${Date.now().toString(36).toUpperCase()}`
  const role = db.select().from(tables.roles).where(eq(tables.roles.id, roleId)).get()
  db.insert(tables.users).values({
    id, name, account, passwordHash: hashPassword('ontos@2026'), dept: dept ?? '',
    roleId, markings: ['内部'], status: '待激活', lastLoginAt: '', createdAt: Date.now(),
  }).run()

  // 邀请令牌与链接
  const token = await issueInviteToken(id)
  const origin = c.req.header('Origin') || 'http://localhost:5174'
  const link = `${origin}/invite?token=${token}`
  const subject = `【OntoOS】${name}，欢迎加入星辰智造集团企业本体智能平台`
  const body = [
    `${name}，你好：`,
    '',
    `你已被邀请加入 OntoOS 企业本体智能平台（邀请人：${actor.name}）。`,
    '',
    '请点击以下链接，设置密码并激活账号（7 天内有效）：',
    link,
    '',
    `登录账号：${account}`,
    '如链接无法点击，请复制到浏览器地址栏打开。',
    '',
    '—— 星辰智造集团 数字化转型部',
  ].join('\n')

  const invId = `INV-${Date.now().toString(36).toUpperCase()}`
  db.insert(tables.invitations).values({
    id: invId, userId: id, account, name, email: emailOk ? email : '', channel,
    subject, body, link, status: '待发送',
    createdAt: Date.now(), expiresAt: Date.now() + 7 * 24 * 3600 * 1000,
  }).run()

  // 已配置邮件服务 → 系统直接发送（发件人为系统身份，收件人为真实邮箱）
  let sent = false
  let sendError = ''
  if (channel === 'email') {
    if (isSmtpConfigured()) {
      const res = await sendMail(email, subject, body)
      if (res.ok) {
        sent = true
        db.update(tables.invitations).set({ status: '已发送' }).where(eq(tables.invitations.id, invId)).run()
      } else {
        sendError = res.error ?? '发送失败'
      }
    } else {
      sendError = 'SMTP_NOT_CONFIGURED'
    }
  }

  db.insert(tables.auditEvents).values({
    id: `AE-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    actor: actor.name, action: '邀请用户', target: `${name}(${account})`,
    detail: { channel, roleId, sent, email: emailOk ? email : undefined }, ip: '本地', createdAt: Date.now(),
  }).run()

  return c.json({
    user: toUserRow(db.select().from(tables.users).where(eq(tables.users.id, id)).get()!, role?.name ?? ''),
    invitation: {
      id: invId, link, subject, body, email: emailOk ? email : '', sent, sendError,
      mailto: emailOk ? `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` : '',
    },
  })
})

/** 重发邀请邮件（需已配置 SMTP，且邀请记录含真实邮箱） */
userRoutes.post('/invitations/:id/resend', requireAdmin, async (c) => {
  const id = c.req.param('id') as string
  const inv = db.select().from(tables.invitations).where(eq(tables.invitations.id, id)).get()
  if (!inv) return c.json({ error: '邀请记录不存在' }, 404)
  if (!isSmtpConfigured()) return c.json({ error: '尚未配置邮件服务，无法直接发送；请到控制面板配置后重试' }, 400)
  if (!inv.email) return c.json({ error: '该邀请未登记真实收件邮箱（历史数据），请复制链接手动传达或重新邀请' }, 400)
  const res = await sendMail(inv.email, inv.subject, inv.body)
  if (!res.ok) return c.json({ error: `发送失败：${res.error}` }, 502)
  db.update(tables.invitations).set({ status: '已发送' }).where(eq(tables.invitations.id, id)).run()
  const actor = c.get('user')
  db.insert(tables.auditEvents).values({
    id: `AE-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    actor: actor.name, action: '重发邀请邮件', target: `${inv.name}(${inv.account})`, ip: '本地', createdAt: Date.now(),
  }).run()
  return c.json({ ok: true })
})

/** 邀请记录列表 */
userRoutes.get('/invitations/list', requireAdmin, (c) => {
  const rows = db.select().from(tables.invitations).all().sort((a, b) => b.createdAt - a.createdAt)
  const usersAll = db.select().from(tables.users).all()
  const userMap = new Map(usersAll.map((u) => [u.id, u]))
  return c.json({
    invitations: rows.map((r) => ({
      id: r.id, name: r.name, account: r.account, email: r.email, channel: r.channel, status: r.status,
      link: r.link, createdAt: new Date(r.createdAt).toLocaleString('zh-CN', { hour12: false }),
      expiresAt: new Date(r.expiresAt).toLocaleDateString('zh-CN'),
      userStatus: userMap.get(r.userId)?.status ?? '',
    })),
  })
})

/** 更新用户（角色/状态/标记/重置密码） */
userRoutes.patch('/:id', requireAdmin, async (c) => {
  const id = c.req.param('id') as string
  const patch = await c.req.json<{ roleId?: string; status?: string; markings?: string[]; resetPassword?: boolean; dept?: string }>()
  const target = db.select().from(tables.users).where(eq(tables.users.id, id)).get()
  if (!target) return c.json({ error: '用户不存在' }, 404)
  const set: Partial<typeof tables.users.$inferInsert> = {}
  if (patch.roleId) set.roleId = patch.roleId
  if (patch.status) set.status = patch.status
  if (patch.markings) set.markings = patch.markings
  if (patch.dept !== undefined) set.dept = patch.dept
  if (patch.resetPassword) set.passwordHash = hashPassword('ontos@2026')
  if (Object.keys(set).length > 0) db.update(tables.users).set(set).where(eq(tables.users.id, id)).run()
  // 重置密码或停用账号：吊销该用户所有已签发令牌（旧会话立即失效）
  if (patch.resetPassword || (patch.status && patch.status !== '在职')) bumpTokenEpoch(id)

  const actor = c.get('user')
  db.insert(tables.auditEvents).values({
    id: `AE-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    actor: actor.name, action: '更新用户', target: `${target.name}(${target.account})`,
    detail: { patch: { ...patch, resetPassword: patch.resetPassword ? '是' : undefined } },
    ip: '本地', createdAt: Date.now(),
  }).run()
  const u = db.select().from(tables.users).where(eq(tables.users.id, id)).get()!
  const role = db.select().from(tables.roles).where(eq(tables.roles.id, u.roleId)).get()
  return c.json({ user: toUserRow(u, role?.name ?? '') })
})
