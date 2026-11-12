import { Context } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { sign, verify } from 'hono/jwt'
import bcrypt from 'bcryptjs'
import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db, tables } from './db'
import type { SessionUser, SessionRole } from '../shared/types'

const JWT_SECRET = process.env.ONTOOS_JWT_SECRET || 'ontoos-dev-secret-change-in-prod'
const TOKEN_TTL = 7 * 24 * 3600 // 7 天
const COOKIE = 'ontoos_token'

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10)
}

export function verifyPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash)
}

export async function issueToken(userId: string): Promise<string> {
  return sign({ sub: userId, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL }, JWT_SECRET, 'HS256')
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
    const payload = (await verify(bearer, JWT_SECRET, 'HS256')) as { sub?: string }
    if (!payload?.sub) return null
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
