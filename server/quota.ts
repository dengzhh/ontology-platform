import { eq, and, sql } from 'drizzle-orm'
import { db, tables } from './db'

/**
 * 资源配额与计量（SaaS 收费与私有化容量管理的基础）
 *
 * 配额按「空间」计量，存 settings（key=`quota:<spaceId>`），缺省用套餐默认值：
 *   objects   对象条数上限
 *   members   成员数上限
 *   storageMB 附件/文档存储上限（按 documents 表字符量估算）
 *   aiCalls   每月 AI 调用次数上限
 *
 * 计量：AI 调用次数按月累计（key=`usage:ai:<spaceId>:<YYYY-MM>`），
 * 超限时调用方返回 402，并给出可读的升级提示。
 */

export interface Quota {
  objects: number
  members: number
  storageMB: number
  aiCalls: number
}

/** 套餐预设（私有化部署可整包放开） */
export const PLANS: Record<'free' | 'team' | 'enterprise' | 'unlimited', Quota> = {
  free: { objects: 1_000, members: 5, storageMB: 200, aiCalls: 500 },
  team: { objects: 50_000, members: 30, storageMB: 5_000, aiCalls: 20_000 },
  enterprise: { objects: 500_000, members: 200, storageMB: 50_000, aiCalls: 200_000 },
  unlimited: { objects: Number.MAX_SAFE_INTEGER, members: Number.MAX_SAFE_INTEGER, storageMB: Number.MAX_SAFE_INTEGER, aiCalls: Number.MAX_SAFE_INTEGER },
}

const DEFAULT_PLAN: keyof typeof PLANS = (process.env.ONTOOS_DEFAULT_PLAN as keyof typeof PLANS) || 'unlimited'

function quotaKey(spaceId: string) {
  return `quota:${spaceId}`
}

/** 读取空间配额：显式配置优先，否则取默认套餐 */
export function getQuota(spaceId: string): Quota {
  const row = db.select().from(tables.settings).where(eq(tables.settings.key, quotaKey(spaceId))).get()
  const v = row?.value as { plan?: keyof typeof PLANS; override?: Partial<Quota> } | undefined
  const base = PLANS[v?.plan ?? DEFAULT_PLAN] ?? PLANS.unlimited
  return { ...base, ...(v?.override ?? {}) }
}

export function setQuota(spaceId: string, plan: keyof typeof PLANS, override?: Partial<Quota>) {
  const key = quotaKey(spaceId)
  const value = { plan, override: override ?? {} }
  const now = Date.now()
  const existing = db.select().from(tables.settings).where(eq(tables.settings.key, key)).get()
  if (existing) db.update(tables.settings).set({ value, updatedAt: now }).where(eq(tables.settings.key, key)).run()
  else db.insert(tables.settings).values({ key, value, updatedAt: now }).run()
}

/** 当前用量 */
export function getUsage(spaceId: string): { objects: number; members: number; storageMB: number; aiCalls: number } {
  const objects = (db.select({ c: sql<number>`count(*)` }).from(tables.objects).where(eq(tables.objects.spaceId, spaceId)).get()?.c ?? 0)
  const members = (db.select({ c: sql<number>`count(*)` }).from(tables.spaceMembers).where(eq(tables.spaceMembers.spaceId, spaceId)).get()?.c ?? 0)
  // 存储按文档正文字符量估算（1 字符 ≈ 1 字节；含分块冗余 ×1.3）
  const docChars = (db.select({ c: sql<number>`coalesce(sum(length(content)), 0)` }).from(tables.documents).where(eq(tables.documents.spaceId, spaceId)).get()?.c ?? 0)
  const storageMB = Math.round((Number(docChars) * 1.3) / 1024 / 1024 * 10) / 10
  return { objects: Number(objects), members: Number(members), storageMB, aiCalls: aiCallsThisMonth(spaceId) }
}

/** 配额检查：ok=false 时带上人类可读原因，调用方返回 402 */
export function checkQuota(spaceId: string, kind: 'objects' | 'members' | 'storageMB' | 'aiCalls'): { ok: boolean; reason?: string; limit: number; used: number } {
  const q = getQuota(spaceId)
  const u = getUsage(spaceId)
  const limit = q[kind]
  const used = u[kind]
  if (used < limit) return { ok: true, limit, used }
  const label: Record<typeof kind, string> = {
    objects: '对象条数',
    members: '成员数',
    storageMB: '文档存储',
    aiCalls: '本月 AI 调用次数',
  }
  const unit = kind === 'storageMB' ? ' MB' : kind === 'aiCalls' ? ' 次' : ' 个'
  return {
    ok: false,
    limit,
    used,
    reason: `已达当前套餐上限：${label[kind]} ${used}/${limit}${unit}。请联系管理员升级套餐或清理数据。`,
  }
}

function aiUsageKey(spaceId: string, month = new Date()) {
  const ym = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`
  return `usage:ai:${spaceId}:${ym}`
}

export function aiCallsThisMonth(spaceId: string): number {
  const row = db.select().from(tables.settings).where(eq(tables.settings.key, aiUsageKey(spaceId))).get()
  return Number((row?.value as { count?: number } | undefined)?.count ?? 0)
}

/** 记一次 AI 调用（按月累计；失败不阻断业务） */
export function recordAiCall(spaceId: string) {
  const key = aiUsageKey(spaceId)
  const now = Date.now()
  const row = db.select().from(tables.settings).where(eq(tables.settings.key, key)).get()
  const cur = Number((row?.value as { count?: number } | undefined)?.count ?? 0)
  if (row) db.update(tables.settings).set({ value: { count: cur + 1 }, updatedAt: now }).where(eq(tables.settings.key, key)).run()
  else db.insert(tables.settings).values({ key, value: { count: 1 }, updatedAt: now }).run()
}

/** 空间概览：配额 + 用量 + 剩余（供管理页展示） */
export function quotaReport(spaceId: string) {
  const quota = getQuota(spaceId)
  const usage = getUsage(spaceId)
  const pct = (a: number, b: number) => (b === Number.MAX_SAFE_INTEGER ? 0 : Math.min(100, Math.round((a / b) * 100)))
  return {
    quota,
    usage,
    pct: {
      objects: pct(usage.objects, quota.objects),
      members: pct(usage.members, quota.members),
      storageMB: pct(usage.storageMB, quota.storageMB),
      aiCalls: pct(usage.aiCalls, quota.aiCalls),
    },
  }
}

/* ---------------- SaaS 自助注册（邀请制开关） ---------------- */

/** 是否开放自助注册（默认关闭：企业私有化部署不应允许陌生人注册） */
export function selfSignupEnabled(): boolean {
  const row = db.select().from(tables.settings).where(eq(tables.settings.key, 'self_signup')).get()
  return Boolean((row?.value as { enabled?: boolean } | undefined)?.enabled ?? false)
}

export function setSelfSignup(enabled: boolean) {
  const now = Date.now()
  const existing = db.select().from(tables.settings).where(eq(tables.settings.key, 'self_signup')).get()
  if (existing) db.update(tables.settings).set({ value: { enabled }, updatedAt: now }).where(eq(tables.settings.key, 'self_signup')).run()
  else db.insert(tables.settings).values({ key: 'self_signup', value: { enabled }, updatedAt: now }).run()
}

/** 新注册用户的空间初始配额（免费套餐，可被管理员调整） */
export function initTenantQuota(spaceId: string) {
  const already = db.select().from(tables.settings).where(and(eq(tables.settings.key, quotaKey(spaceId)))).get()
  if (!already) setQuota(spaceId, (process.env.ONTOOS_SIGNUP_PLAN as keyof typeof PLANS) || 'free')
}
