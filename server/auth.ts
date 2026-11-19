import { Context } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { sign, verify } from 'hono/jwt'
import bcrypt from 'bcryptjs'
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db, tables } from './db'
import type { SessionUser, SessionRole } from '../shared/types'

const DEV_JWT_SECRET = 'ontoos-dev-secret-change-in-prod'
const JWT_SECRET = process.env.ONTOOS_JWT_SECRET || DEV_JWT_SECRET
const TOKEN_TTL = 7 * 24 * 3600 // 7 天
const COOKIE = 'ontoos_token'

/**
 * 生产模式必须显式配置 JWT 签名密钥：默认值公开在仓库里，任何人都能伪造管理员令牌。
 * （启动早期调用，缺失直接退出，避免“能跑但等于没有鉴权”）
 */
export function assertJwtSecret(isProd: boolean) {
  if (!isProd) return
  if (!process.env.ONTOOS_JWT_SECRET || process.env.ONTOOS_JWT_SECRET === DEV_JWT_SECRET) {
    console.error('[ontoos] 启动中止：生产模式必须设置环境变量 ONTOOS_JWT_SECRET（≥32 位随机串，且不能使用默认开发值）')
    process.exit(1)
  }
}

/**
 * 令牌世代（token epoch）：JWT 内嵌 `ep`，与用户当前世代比对。
 * 登出 / 改密 / 停用 / 重置密码时递增世代 → 该用户名下所有已签发令牌立即失效。
 * 存储复用 settings 表（key=`token_epoch:<userId>`），不引入主表迁移。
 */
function epochKey(userId: string) {
  return `token_epoch:${userId}`
}

export function tokenEpoch(userId: string): number {
  const row = db.select().from(tables.settings).where(eq(tables.settings.key, epochKey(userId))).get()
  const v = row?.value as { epoch?: number } | undefined
  return Number(v?.epoch ?? 0)
}

/** 递增世代：使该用户已签发的所有 JWT 失效（返回新世代） */
export function bumpTokenEpoch(userId: string): number {
  const next = tokenEpoch(userId) + 1
  const key = epochKey(userId)
  const now = Date.now()
  const existing = db.select().from(tables.settings).where(eq(tables.settings.key, key)).get()
  if (existing) {
    db.update(tables.settings).set({ value: { epoch: next }, updatedAt: now }).where(eq(tables.settings.key, key)).run()
  } else {
    db.insert(tables.settings).values({ key, value: { epoch: next }, updatedAt: now }).run()
  }
  return next
}

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10)
}

export function verifyPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash)
}

export async function issueToken(userId: string): Promise<string> {
  return sign(
    { sub: userId, ep: tokenEpoch(userId), exp: Math.floor(Date.now() / 1000) + TOKEN_TTL },
    JWT_SECRET,
    'HS256',
  )
}

/** 邀请令牌（7 天有效，仅用于激活） */
export async function issueInviteToken(userId: string): Promise<string> {
  return sign({ sub: userId, scope: 'invite', exp: Math.floor(Date.now() / 1000) + 7 * 24 * 3600 }, JWT_SECRET, 'HS256')
}

export async function verifyInviteToken(token: string): Promise<string | null> {
  try {
    const payload = (await verify(token, JWT_SECRET, 'HS256')) as { sub?: string; scope?: string }
    if (payload?.sub && payload.scope === 'invite') return payload.sub
    return null
  } catch {
    return null
  }
}

/** 按用户 ID 构建会话用户（不含鉴权逻辑） */
export function buildSessionUser(userId: string): SessionUser | null {
  const row = db.select().from(tables.users).where(eq(tables.users.id, userId)).get()
  if (!row) return null
  const role = db.select().from(tables.roles).where(eq(tables.roles.id, row.roleId)).get()
  if (!role) return null
  return {
    id: row.id,
    name: row.name,
    account: row.account,
    dept: row.dept,
    markings: row.markings,
    status: row.status,
    lastLoginAt: row.lastLoginAt,
    role: {
      id: role.id,
      name: role.name,
      desc: role.desc,
      apps: role.apps,
      objectPerms: role.objectPerms as SessionRole['objectPerms'],
    },
  }
}

/**
 * API 密钥鉴权：`ontoos_` 前缀的密钥按 SHA-256 哈希比对 api_keys 表。
 * 身份映射到密钥 ownerId 对应的用户（复用其角色/权限体系）；
 * scope 约束：read 仅允许 GET/HEAD，write/admin 允许全部方法。
 * 命中即更新 lastUsedAt。返回 null 表示密钥无效或越权。
 */
function loadApiKeyUser(rawKey: string, method: string): SessionUser | null {
  const keyHash = createHash('sha256').update(rawKey).digest('hex')
  const row = db.select().from(tables.apiKeys).where(eq(tables.apiKeys.keyHash, keyHash)).get()
  if (!row) return null
  const isWriteMethod = !/^(GET|HEAD|OPTIONS)$/i.test(method)
  if (isWriteMethod && row.scope === 'read') return null
  const user = buildSessionUser(row.ownerId)
  if (!user || user.status !== '在职') return null
  db.update(tables.apiKeys).set({ lastUsedAt: Date.now() }).where(eq(tables.apiKeys.id, row.id)).run()
  return user
}

/** 从 Authorization: Bearer 或 cookie 解析并加载会话用户（JWT 或 ontoos_ API 密钥） */
export async function loadSessionUser(c: Context): Promise<SessionUser | null> {
  const bearer = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') || getCookie(c, COOKIE) || ''
  if (!bearer) return null
  // API 密钥（JWT 不可能以 ontoos_ 开头）
  if (bearer.startsWith('ontoos_')) return loadApiKeyUser(bearer, c.req.method)
  try {
    const payload = (await verify(bearer, JWT_SECRET, 'HS256')) as { sub?: string; ep?: number }
    if (!payload?.sub) return null
    // 世代校验：登出/改密/停用后旧令牌立即失效（历史令牌无 ep 视为 0，与初始世代一致）
    const ep = Number(payload.ep ?? 0)
    if (ep !== tokenEpoch(payload.sub)) return null
    const user = buildSessionUser(payload.sub)
    if (!user || user.status !== '在职') return null
    return user
  } catch {
    return null
  }
}

export function setSessionCookie(c: Context, token: string) {
  setCookie(c, COOKIE, token, { httpOnly: false, sameSite: 'Lax', path: '/', maxAge: TOKEN_TTL })
}

export function clearSessionCookie(c: Context) {
  setCookie(c, COOKIE, '', { httpOnly: false, sameSite: 'Lax', path: '/', maxAge: 0 })
}

/** 要求已登录；把 user 挂到 context */
export async function requireAuth(c: Context, next: () => Promise<void>) {
  const user = await loadSessionUser(c)
  if (!user) return c.json({ error: '未登录或会话已失效' }, 401)
  c.set('user', user)
  await next()
}

/** 要求管理员角色 */
export async function requireAdmin(c: Context, next: () => Promise<void>) {
  const user = c.get('user') as SessionUser | undefined
  if (!user || user.role.id !== 'admin') return c.json({ error: '需要平台管理员权限' }, 403)
  await next()
}
