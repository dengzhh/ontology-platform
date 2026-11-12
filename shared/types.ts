/** 前后端共享契约类型 */

export interface SessionRole {
  id: string
  name: string
  desc: string
  /** 可见应用路径；["*"] 表示全部 */
  apps: string[]
  objectPerms: Record<string, 'full' | 'read' | 'none'>
}

export interface SessionUser {
  id: string
  name: string
  account: string
  dept: string
  markings: string[]
  status: string
  lastLoginAt: string
  role: SessionRole
}

export interface UserRow {
  id: string
  name: string
  account: string
  dept: string
  roleId: string
  roleName: string
  markings: string[]
  status: string
  lastLoginAt: string
}

export interface RoleRow {
  id: string
  name: string
  desc: string
  apps: string[]
  objectPerms: Record<string, string>
  members: number
}

export interface GroupRow {
  id: string
  name: string
  desc: string
  defaultApp: string
  members: { id: string; name: string }[]
}

export interface LoginRequest {
  account: string
  password: string
}

export interface LoginResponse {
  token: string
  user: SessionUser
}
