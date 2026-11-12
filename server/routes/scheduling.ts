import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { db, tables } from '../db'
import { requireAuth } from '../auth'
import { resolveSpace, type SpaceInfo } from '../space'
import type { SessionUser } from '../../shared/types'

/**
 * 动态调度 · 本地启发式求解引擎。
 *
 * 由 index.ts 统一挂载于 /api/scheduling，文件内路径均为相对形态
 * （/tasks、/solve、/seed、/apply/:planId、/metrics），最终 URL 形如 /api/scheduling/tasks。
 *
 * 【诚实说明】本引擎为本地单进程「贪心 + 约束校验」启发式求解，不依赖 COPT / OR-Tools，
 * 也不接入外部排产主数据；可在此接口形状不变的前提下替换为精确求解器。
 * 所有端点 requireAuth + resolveSpace，按 spaceId 强隔离，写操作全量留审计。
 */
type Ctx = { Variables: { user: SessionUser; space: SpaceInfo } }
type TaskRow = typeof tables.scheduleTasks.$inferSelect

/* ============================================================================
 * 约束定义（求解器与前端「约束条件」卡的单一事实来源）
 * ==========================================================================*/

/** 排程视界：7 天（startDay 0..6） */
const HORIZON_DAYS = 7
/** 每产线每自然日总时长上限（硬约束） */
const CAPACITY_H = 24
/** 每日排产起始钟点；任务按累计占用小时顺延 */
const DAY_START_HOUR = 8
/** 检修窗口：F2 精密线第 3 天（day=2）4h 不可排 → 当日可用产能降为 20h */
const MAINTENANCE = { line: 'F2 精密线', day: 2, hours: 4 }
/** A 级客户（软约束：优先保障产能） */
const A_CUSTOMERS = ['广州鹏程', '苏州林德']
/** 交付承诺日（按优先级，day index）：用于准时交付率 / 延期数的真实计算 */
const DUE_DAY_BY_PRIORITY: Record<number, number> = { 1: 1, 2: 3, 3: 5 }

function capacityFor(line: string, day: number): number {
  return CAPACITY_H - (line === MAINTENANCE.line && day === MAINTENANCE.day ? MAINTENANCE.hours : 0)
}
function isACustomer(customer: string): boolean {
  return A_CUSTOMERS.some((n) => customer.includes(n))
}
function dueDayOf(priority: number): number {
  return DUE_DAY_BY_PRIORITY[priority] ?? 5
}
/** 任务是否在承诺期内开工（startDay ≤ 承诺日即视为准时） */
function isOnTime(t: { startDay: number; priority: number }): boolean {
  return t.startDay <= dueDayOf(t.priority)
}
function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** 面向前端的约束描述（纯数据，不含函数） */
function publicConstraints() {
  return {
    engine: '本地启发式求解（非 COPT/OR-Tools）',
    method: '按 (priority 升序 → A级客户优先 → qty 降序) 贪心，逐任务寻找最早可用窗口',
    capacityHoursPerLineDay: CAPACITY_H,
    horizonDays: HORIZON_DAYS,
    dayStartHour: DAY_START_HOUR,
    maintenance: {
      line: MAINTENANCE.line,
      day: MAINTENANCE.day,
      hours: MAINTENANCE.hours,
      effect: `第 ${MAINTENANCE.day + 1} 天 4h 检修窗口不可排，当日可用产能降为 ${capacityFor(MAINTENANCE.line, MAINTENANCE.day)}h`,
    },
    softRules: [
      'priority 升序优先排产（P1 最高）',
      `A 级客户（${A_CUSTOMERS.join(' / ')}）优先保障产能`,
      '同优先级按 qty 降序排产',
    ],
    aCustomers: A_CUSTOMERS,
    dueDayByPriority: DUE_DAY_BY_PRIORITY,
  }
}

/** 设备利用率：已占用小时 / 已使用 (产线, 天) 单元格的可用产能之和 */
function utilizationOf(rows: { line: string; startDay: number; durationH: number }[]): number {
  const used = new Map<string, number>()
  for (const r of rows) {
    const key = `${r.line}||${r.startDay}`
    used.set(key, (used.get(key) ?? 0) + r.durationH)
  }
  let usedH = 0
  let capH = 0
  for (const [key, h] of used) {
    const split = key.lastIndexOf('||')
    const line = key.slice(0, split)
    const day = Number(key.slice(split + 2))
    usedH += h
    capH += capacityFor(line, day)
  }
  return capH === 0 ? 0 : round1((usedH / capH) * 100)
}

function audit(actor: string, action: string, target: string, detail?: Record<string, unknown>) {
  db.insert(tables.auditEvents).values({
    id: `AE-${randomUUID()}`,
    actor, action, target, detail, ip: '本地', createdAt: Date.now(),
  }).run()
}

/** 当前空间的全部排程任务 */
function tasksOf(spaceId: string): TaskRow[] {
  return db.select().from(tables.scheduleTasks).where(eq(tables.scheduleTasks.spaceId, spaceId)).all()
}
/** 排序：planId → startDay → startHour → createdAt */
function sortedTasks(spaceId: string): TaskRow[] {
  return tasksOf(spaceId).sort(
    (a, b) =>
      a.planId.localeCompare(b.planId) ||
      a.startDay - b.startDay ||
      a.startHour - b.startHour ||
      a.createdAt - b.createdAt,
  )
}

/* ============================================================================
 * 演示数据集（仅由 POST /seed 写入，页面运行时不引用）
 * ==========================================================================*/

interface SeedTask {
  line: string; batch: string; product: string; customer: string
  priority: number; qty: number; durationH: number; startDay: number; startHour: number
}
const L1 = 'F1 注塑 A 线'
const L2 = 'F1 注塑 B 线'
const L3 = 'F2 精密线'
const L4 = 'SZ 组装线'
const L5 = 'NB 冲压线'

/** as-is 排程刻意混杂：多批次挤在头几天、F2 落在检修日、存在超单日产能任务 */
const SEED_TASKS: SeedTask[] = [
  { line: L1, batch: 'BT-2611', product: '外壳',   customer: '广州鹏程', priority: 1, qty: 1200, durationH: 8,  startDay: 0, startHour: 8 },
  { line: L1, batch: 'BT-2608', product: '支架',   customer: '苏州林德', priority: 1, qty: 900,  durationH: 6,  startDay: 0, startHour: 8 },
  { line: L1, batch: 'BT-2615', product: '面板框', customer: '深圳蓝湾', priority: 2, qty: 600,  durationH: 8,  startDay: 0, startHour: 8 },
  { line: L2, batch: 'BT-2612', product: '面板',   customer: '常州沃特', priority: 2, qty: 800,  durationH: 8,  startDay: 0, startHour: 8 },
  { line: L2, batch: 'BT-2622', product: '外壳B',  customer: '广州鹏程', priority: 1, qty: 700,  durationH: 8,  startDay: 1, startHour: 8 },
  { line: L2, batch: 'BT-2609', product: '卡扣',   customer: '东莞凯越', priority: 3, qty: 500,  durationH: 6,  startDay: 1, startHour: 8 },
  { line: L3, batch: 'BT-2610', product: '结构件', customer: '广州鹏程', priority: 1, qty: 400,  durationH: 8,  startDay: 2, startHour: 8 },
  { line: L3, batch: 'BT-2606', product: '导轨',   customer: '上海康桥', priority: 2, qty: 350,  durationH: 8,  startDay: 2, startHour: 8 },
  { line: L3, batch: 'BT-2620', product: '精密轴', customer: '苏州林德', priority: 1, qty: 300,  durationH: 10, startDay: 2, startHour: 16 },
  { line: L3, batch: 'BT-2623', product: '轴承座', customer: '恒达五金', priority: 3, qty: 280,  durationH: 8,  startDay: 1, startHour: 8 },
  { line: L4, batch: 'AS-118',  product: '模组',   customer: '苏州林德', priority: 1, qty: 600,  durationH: 8,  startDay: 0, startHour: 8 },
  { line: L4, batch: 'AS-115',  product: '整机',   customer: '宁波海视', priority: 2, qty: 200,  durationH: 8,  startDay: 1, startHour: 8 },
  { line: L4, batch: 'AS-121',  product: '控制器', customer: '恒达五金', priority: 3, qty: 400,  durationH: 6,  startDay: 1, startHour: 8 },
  { line: L5, batch: 'ST-330',  product: '端子',   customer: '深圳蓝湾', priority: 2, qty: 2000, durationH: 8,  startDay: 0, startHour: 8 },
  { line: L5, batch: 'ST-328',  product: '屏蔽罩', customer: '东莞凯越', priority: 3, qty: 1500, durationH: 8,  startDay: 0, startHour: 8 },
  { line: L5, batch: 'ST-325',  product: '弹片',   customer: '常州沃特', priority: 2, qty: 1000, durationH: 6,  startDay: 2, startHour: 8 },
  // 时长 26h > 单日产能上限 24h：真实冲突，用于验证「不假装全部排下」
  { line: L5, batch: 'ST-9901', product: '大型机架', customer: '宁波海视', priority: 3, qty: 50, durationH: 26, startDay: 3, startHour: 8 },
]

/* ============================================================================
 * 响应类型（供前端对齐）
 * ==========================================================================*/

interface Suggestion {
  taskId: string
  batch: string
  line: string
  startDay: number
  startHour: number
  durationH: number
  reason: string
}
interface Conflict {
  taskId: string
  batch: string
  line: string
  durationH: number
  reason: string
}

/* ============================================================================
 * 路由
 * ==========================================================================*/

export const schedulingRoutes = new Hono<Ctx>()

schedulingRoutes.use('*', requireAuth)
schedulingRoutes.use('*', async (c, next) => {
  const space = resolveSpace(c, c.get('user'))
  if (!space) return c.json({ error: '尚无可访问的本体空间' }, 403)
  c.set('space', space)
  await next()
})

/** GET /tasks → 当前空间任务列表（按 planId/startDay/startHour 排序）+ 后端真实约束 */
schedulingRoutes.get('/tasks', (c) => {
  const space = c.get('space')
  return c.json({ tasks: sortedTasks(space.id), constraints: publicConstraints() })
})

/** POST /tasks → 新建任务（校验必填、写库、留审计） */
schedulingRoutes.post('/tasks', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const body = await c.req.json<Record<string, unknown>>().catch(() => null)
  if (!body || typeof body !== 'object') return c.json({ error: '请求体格式错误' }, 400)
  const line = typeof body.line === 'string' ? body.line.trim() : ''
  const batch = typeof body.batch === 'string' ? body.batch.trim() : ''
  if (!line || !batch) return c.json({ error: 'line（产线）与 batch（批次）为必填项' }, 400)

  const num = (v: unknown, def: number) => (typeof v === 'number' && Number.isFinite(v) ? v : def)
  const priority = Math.min(3, Math.max(1, Math.floor(num(body.priority, 2))))
  const qty = Math.max(0, Math.floor(num(body.qty, 0)))
  const durationH = Math.max(1, Math.floor(num(body.durationH, 8)))
  const product = typeof body.product === 'string' ? body.product.trim() : ''
  const customer = typeof body.customer === 'string' ? body.customer.trim() : ''

  const id = `ST-${randomUUID()}`
  db.insert(tables.scheduleTasks).values({
    id, line, batch, product, customer, priority, qty, durationH,
    startDay: 0, startHour: DAY_START_HOUR, status: '已排', planId: '',
    spaceId: space.id, createdAt: Date.now(),
  }).run()
  audit(user.name, '新建排程任务', `${batch}@${line}`, { taskId: id, priority, qty, durationH })
  const row = tasksOf(space.id).find((t) => t.id === id)
  return c.json({ task: row }, 201)
})

/** DELETE /tasks/:id → 删除（空间校验 + 审计） */
schedulingRoutes.delete('/tasks/:id', (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const id = c.req.param('id')
  const row = tasksOf(space.id).find((t) => t.id === id)
  if (!row) return c.json({ error: '任务不存在（当前空间）' }, 404)
  db.delete(tables.scheduleTasks).where(and(eq(tables.scheduleTasks.id, id), eq(tables.scheduleTasks.spaceId, space.id))).run()
  audit(user.name, '删除排程任务', `${row.batch}@${row.line}`, { taskId: id, status: row.status })
  return c.json({ deleted: 1, id })
})

/** POST /seed → 重建演示数据集（清空当前空间旧数据后写入），返回条数 */
schedulingRoutes.post('/seed', (c) => {
  const user = c.get('user')
  const space = c.get('space')
  db.delete(tables.scheduleTasks).where(eq(tables.scheduleTasks.spaceId, space.id)).run()
  const now = Date.now()
  for (const t of SEED_TASKS) {
    db.insert(tables.scheduleTasks).values({
      id: `ST-${randomUUID()}`,
      line: t.line, batch: t.batch, product: t.product, customer: t.customer,
      priority: t.priority, qty: t.qty, durationH: t.durationH,
      startDay: t.startDay, startHour: t.startHour,
      status: '已排', planId: '', spaceId: space.id, createdAt: now,
    }).run()
  }
  audit(user.name, '生成演示排程任务', space.name, { count: SEED_TASKS.length, lines: [L1, L2, L3, L4, L5] })
  return c.json({ count: SEED_TASKS.length, lines: [L1, L2, L3, L4, L5] })
})

/**
 * POST /solve → 本地启发式贪心求解。
 *
 * 生效基线 = 状态「已排」∪「已应用」（二者均为当前已落位的排程，支持重复求解优化）；
 * 每次求解先清空尚未应用的「建议」批次，保证只保留最新一份候选方案。
 * 贪心顺序：priority 升序 → A 级客户优先 → qty 降序；逐任务在 0..6 天、8 点起找最早可用窗口，
 * 硬约束「同产线同天累计时长 + 本任务时长 ≤ 当日产能上限」满足即落位，否则顺延至下一天；
 * 7 天内仍无法落位的任务如实列入 conflicts。
 */
schedulingRoutes.post('/solve', (c) => {
  const user = c.get('user')
  const space = c.get('space')

  // 清空上一份未应用的建议方案
  db.delete(tables.scheduleTasks)
    .where(and(eq(tables.scheduleTasks.spaceId, space.id), eq(tables.scheduleTasks.status, '建议')))
    .run()

  const baseline = tasksOf(space.id).filter((t) => t.status === '已排' || t.status === '已应用')
  const planId = `PLAN-${randomUUID()}`

  // 贪心排序
  const ordered = [...baseline].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority
    const aA = isACustomer(a.customer) ? 0 : 1
    const bA = isACustomer(b.customer) ? 0 : 1
    if (aA !== bA) return aA - bA
    return b.qty - a.qty
  })

  // 每 (产线, 天) 已占用小时
  const used = new Map<string, number>()
  const usedKey = (line: string, day: number) => `${line}||${day}`

  const suggestions: Suggestion[] = []
  const conflicts: Conflict[] = []
  const placedRows: { line: string; startDay: number; startHour: number; durationH: number; priority: number }[] = []

  for (const t of ordered) {
    let placed: { day: number; hour: number; cap: number; usedBefore: number } | null = null
    for (let day = 0; day < HORIZON_DAYS; day++) {
      const cap = capacityFor(t.line, day)
      const usedBefore = used.get(usedKey(t.line, day)) ?? 0
      if (usedBefore + t.durationH <= cap) {
        placed = { day, hour: DAY_START_HOUR + usedBefore, cap, usedBefore }
        break
      }
    }

    if (!placed) {
      const reason = t.durationH > CAPACITY_H
        ? `任务时长 ${t.durationH}h 超过单日产能上限 ${CAPACITY_H}h，7 天内无可用窗口`
        : `7 天内 ${t.line} 各日剩余产能均不足（含 F2 检修窗口），无法落位`
      conflicts.push({ taskId: t.id, batch: t.batch, line: t.line, durationH: t.durationH, reason })
      continue
    }

    const key = usedKey(t.line, placed.day)
    used.set(key, placed.usedBefore + t.durationH)
    const tag = isACustomer(t.customer) ? ' · A级客户' : ''
    const reason = `P${t.priority}${tag} → 最早可用窗口：${t.line} 第 ${placed.day + 1} 天 ${placed.hour}:00（已占用 ${placed.usedBefore}h/${placed.cap}h）`
    suggestions.push({
      taskId: t.id, batch: t.batch, line: t.line,
      startDay: placed.day, startHour: placed.hour, durationH: t.durationH, reason,
    })
    placedRows.push({ line: t.line, startDay: placed.day, startHour: placed.hour, durationH: t.durationH, priority: t.priority })

    // 写入「建议」批次（新 planId，status='建议'）
    db.insert(tables.scheduleTasks).values({
      id: `ST-${randomUUID()}`,
      line: t.line, batch: t.batch, product: t.product, customer: t.customer,
      priority: t.priority, qty: t.qty, durationH: t.durationH,
      startDay: placed.day, startHour: placed.hour,
      status: '建议', planId, spaceId: space.id, createdAt: Date.now(),
    }).run()
  }

  const onTimeCount = placedRows.filter(isOnTime).length
  const total = baseline.length
  const metrics = {
    utilization: utilizationOf(placedRows),
    onTimeRate: total === 0 ? 0 : round1((onTimeCount / total) * 100),
  }

  audit(user.name, '运行本地启发式排程求解', planId, {
    planId, baseline: total, placed: suggestions.length, conflicts: conflicts.length, metrics,
  })

  return c.json({
    planId,
    placed: suggestions.length,
    conflicts,
    suggestions,
    metrics,
    constraints: publicConstraints(),
  })
})

/** POST /apply/:planId → 应用方案：建议→已应用、原生效基线归档、写审计 */
schedulingRoutes.post('/apply/:planId', (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const planId = c.req.param('planId')
  const rows = tasksOf(space.id)
  const suggestions = rows.filter((t) => t.status === '建议' && t.planId === planId)
  if (suggestions.length === 0) return c.json({ error: '该方案无待应用建议（可能已被应用或不存在）' }, 400)

  // 记录应用前的生效基线 id，避免把刚提升的建议一并归档
  const baselineIds = rows
    .filter((t) => t.status === '已排' || t.status === '已应用')
    .map((t) => t.id)

  for (const s of suggestions) {
    db.update(tables.scheduleTasks).set({ status: '已应用' }).where(eq(tables.scheduleTasks.id, s.id)).run()
  }
  for (const id of baselineIds) {
    db.update(tables.scheduleTasks).set({ status: '已归档' }).where(eq(tables.scheduleTasks.id, id)).run()
  }

  audit(user.name, '应用排程方案', planId, {
    planId, applied: suggestions.length, archived: baselineIds.length,
  })
  return c.json({ planId, applied: suggestions.length, archived: baselineIds.length })
})

/** GET /metrics → 基于已应用 / 已排任务真实计算 */
schedulingRoutes.get('/metrics', (c) => {
  const space = c.get('space')
  const active = tasksOf(space.id).filter((t) => t.status === '已排' || t.status === '已应用')
  const taskCount = active.length
  const lateCount = active.filter((t) => !isOnTime(t)).length
  const onTimeRate = taskCount === 0 ? 0 : round1(((taskCount - lateCount) / taskCount) * 100)
  const utilization = utilizationOf(active)
  const placedHours = active.reduce((s, t) => s + t.durationH, 0)
  return c.json({ utilization, onTimeRate, lateCount, taskCount, placedHours })
})
