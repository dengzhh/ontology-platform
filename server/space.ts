import type { Context } from 'hono'
import { db, tables } from './db'
import type { SessionUser } from '../shared/types'

/** 空间模型：org=组织（走角色对象权限） personal/family=成员全权限 */

export interface SpaceInfo {
  id: string
  name: string
  kind: 'org' | 'personal' | 'family'
  ownerId: string
}

export const DEFAULT_SPACE_ID = 'sp-org-default'

export function listUserSpaces(userId: string): (SpaceInfo & { role: string; memberCount: number })[] {
  const rows = db.select().from(tables.spaceMembers).all().filter((m) => m.userId === userId)
  const spaces = db.select().from(tables.spaces).all()
  const all = db.select().from(tables.spaceMembers).all()
  return rows
    .map((m) => {
      const sp = spaces.find((s) => s.id === m.spaceId)
      if (!sp) return null
      return {
        id: sp.id,
        name: sp.name,
        kind: sp.kind as SpaceInfo['kind'],
        ownerId: sp.ownerId,
        role: m.role,
        memberCount: all.filter((x) => x.spaceId === sp.id).length,
      }
    })
    .filter(Boolean) as (SpaceInfo & { role: string; memberCount: number })[]
}

export function isMember(spaceId: string, userId: string): boolean {
  return db.select().from(tables.spaceMembers).all().some((m) => m.spaceId === spaceId && m.userId === userId)
}

/** 从请求解析当前空间：x-space-id 头 → 校验成员资格；缺失时回退用户首个空间 */
export function resolveSpace(c: Context, user: SessionUser): SpaceInfo | null {
  const wanted = c.req.header('x-space-id') || ''
  const mine = listUserSpaces(user.id)
  if (!mine.length) return null
  const hit = wanted ? mine.find((s) => s.id === wanted) : null
  const sp = hit ?? mine[0]
  return { id: sp.id, name: sp.name, kind: sp.kind, ownerId: sp.ownerId }
}

/** 确保用户拥有个人空间（幂等） */
export function ensurePersonalSpace(userId: string): SpaceInfo {
  const id = `sp-personal-${userId}`
  const existing = db.select().from(tables.spaces).where(eqId(id)).get()
  if (existing) return { id, name: existing.name, kind: 'personal', ownerId: userId }
  const user = db.select().from(tables.users).all().find((u) => u.id === userId)
  const name = `${user?.name ?? '我的'}的个人空间`
  db.insert(tables.spaces).values({ id, name, kind: 'personal', ownerId: userId, templatePack: '', createdAt: Date.now() }).run()
  db.insert(tables.spaceMembers).values({ spaceId: id, userId, role: 'owner' }).run()
  return { id, name, kind: 'personal', ownerId: userId }
}

/** 空间内对象类型权限：org 走角色配置；personal/family 成员全权限 */
export function spacePerm(user: SessionUser, space: SpaceInfo, typeId: string): 'full' | 'read' | 'none' {
  if (space.kind === 'org') {
    const explicit = user.role.objectPerms[typeId]
    if (explicit) return explicit as 'full' | 'read' | 'none'
    return user.role.id === 'admin' || user.role.id === 'data-eng' ? 'full' : 'read'
  }
  // 个人/家庭空间：成员即全权限
  return isMember(space.id, user.id) ? 'full' : 'none'
}

/** 空间内建模权限：org 限管理员/数据工程师；personal/family 任意成员 */
export function spaceCanModel(user: SessionUser, space: SpaceInfo): boolean {
  if (space.kind === 'org') return user.role.id === 'admin' || user.role.id === 'data-eng'
  return isMember(space.id, user.id)
}

// 小工具（避免多处 import eq）
import { eq } from 'drizzle-orm'
function eqId(id: string) {
  return eq(tables.spaces.id, id)
}
