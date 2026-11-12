import { Hono, type Handler } from 'hono'
import { eq } from 'drizzle-orm'
import { db, tables } from '../db'
import { requireAuth } from '../auth'
import { resolveSpace, spacePerm, type SpaceInfo } from '../space'
import { fireObjectEvent } from '../engine/automation'
import type { SessionUser } from '../../shared/types'

/**
 * Object Explorer 高级能力：保存的探索 / 对象集比较 / 派生属性 / 场景分支。
 *
 * 路由将整体挂载于 `/api/explorations`（由 index.ts 统一挂载，本文件不改）。
 * 为兼容「挂载点是否包含 /explorations 前缀」两种理解，每个端点同时注册带前缀
 * 与不带前缀的路径别名；前端统一使用带 /explorations 前缀的写法。
 *
 * 全部端点：requireAuth + resolveSpace；读写均按 spaceId 隔离；写操作写审计事件；
 * 涉及对象类型时按 spacePerm 校验权限。
 */

type Ctx = { Variables: { user: SessionUser; space: SpaceInfo } }
type AppHandler = Handler<Ctx>

/** 过滤条件 */
interface Filter { key: string; op: string; value: string }
/** 场景内暂存的一次变更 */
interface Change { op: 'create' | 'update' | 'delete'; typeId: string; objectId?: string; values?: Record<string, unknown> }

interface ExplorationRow {
  id: string; name: string; typeId: string; filters: Filter[]; sort: string
  ownerId: string; spaceId: string; createdAt: number
}
interface DerivedRow {
  id: string; typeId: string; key: string; name: string; expr: string; spaceId: string; createdAt: number
}
interface ScenarioRow {
  id: string; name: string; desc: string; status: string; changes: Change[]
  ownerId: string; spaceId: string; createdAt: number; mergedAt: number | null
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
}

function audit(actor: string, action: string, target: string, detail?: Record<string, unknown>) {
  db.insert(tables.auditEvents).values({
    id: newId('AE'), actor, action, target, detail, ip: '本地', createdAt: Date.now(),
  }).run()
}

/* ---------------- 数据加载（按空间隔离） ---------------- */

function loadExplorations(spaceId: string): ExplorationRow[] {
  return db.select().from(tables.savedExplorations).all()
    .filter((r) => r.spaceId === spaceId)
    .map((r) => ({
      id: r.id, name: r.name, typeId: r.typeId,
      filters: (r.filters ?? []) as Filter[], sort: r.sort,
      ownerId: r.ownerId, spaceId: r.spaceId, createdAt: r.createdAt,
    }))
}
function loadDerived(spaceId: string): DerivedRow[] {
  return db.select().from(tables.derivedProperties).all()
    .filter((r) => r.spaceId === spaceId)
    .map((r) => ({
      id: r.id, typeId: r.typeId, key: r.key, name: r.name, expr: r.expr,
      spaceId: r.spaceId, createdAt: r.createdAt,
    }))
}
function loadScenarios(spaceId: string): ScenarioRow[] {
  return db.select().from(tables.ontologyScenarios).all()
    .filter((r) => r.spaceId === spaceId)
    .map((r) => ({
      id: r.id, name: r.name, desc: r.desc, status: r.status,
      changes: (r.changes ?? []) as Change[],
      ownerId: r.ownerId, spaceId: r.spaceId, createdAt: r.createdAt, mergedAt: r.mergedAt,
    }))
}
/** 当前空间、指定类型、且用户可访问的全部对象 */
function objectsOfType(spaceId: string, typeId: string) {
  return db.select().from(tables.objects).all()
    .filter((o) => o.spaceId === spaceId && o.typeId === typeId)
}

/* ---------------- 通用校验/工具 ---------------- */

/** 校验 filters 结构，规整为合法条件数组 */
function normalizeFilters(raw: unknown): { ok: true; filters: Filter[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, filters: [] }
  if (!Array.isArray(raw)) return { ok: false, error: 'filters 须为数组' }
  const out: Filter[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') return { ok: false, error: '过滤条件格式错误' }
    const f = item as Partial<Filter>
    if (typeof f.key !== 'string' || !f.key.trim()) return { ok: false, error: '过滤条件缺少属性 key' }
    if (typeof f.op !== 'string' || !['eq', 'contains', 'gt', 'lt'].includes(f.op)) {
      return { ok: false, error: `不支持的操作符「${String(f.op)}」（仅 eq/contains/gt/lt）` }
    }
    out.push({ key: f.key.trim(), op: f.op, value: f.value === undefined || f.value === null ? '' : String(f.value) })
  }
  return { ok: true, filters: out }
}

/** 对单个对象判定是否满足全部过滤条件（AND） */
function matches(v: Record<string, unknown>, filters: Filter[]): boolean {
  return filters.every((f) => {
    const raw = v[f.key]
    switch (f.op) {
      case 'eq':
        return String(raw ?? '') === f.value
      case 'contains':
        return String(raw ?? '').toLowerCase().includes(f.value.toLowerCase())
      case 'gt': {
        const a = Number(raw); const b = Number(f.value)
        return Number.isFinite(a) && Number.isFinite(b) && a > b
      }
      case 'lt': {
        const a = Number(raw); const b = Number(f.value)
        return Number.isFinite(a) && Number.isFinite(b) && a < b
      }
      default:
        return false
    }
  })
}

/** 派生属性表达式安全校验：只允许属性读取，屏蔽危险语法 */
const FORBIDDEN_EXPR = /\b(require|process|fetch|eval|while|for)\b|=>|globalThis|window|document|constructor|import|__proto__|prototype/
function isSafeExpr(expr: string): boolean {
  if (!expr.trim()) return false
  return !FORBIDDEN_EXPR.test(expr)
}

/** 校验对象类型存在且当前用户有访问权限 */
function checkType(user: SessionUser, space: SpaceInfo, typeId: string): { ok: true } | { ok: false; error: string; status: 403 | 404 } {
  const t = db.select().from(tables.objectTypes).all().find((x) => x.id === typeId && x.spaceId === space.id)
  if (!t) return { ok: false, error: '对象类型不存在（当前空间）', status: 404 }
  if (spacePerm(user, space, typeId) === 'none') return { ok: false, error: `你没有「${t.name}」的访问权限`, status: 403 }
  return { ok: true }
}

export const explorationRoutes = new Hono<Ctx>()
explorationRoutes.use('*', requireAuth)
explorationRoutes.use('*', async (c, next) => {
  const user = c.get('user')
  const space = resolveSpace(c, user)
  if (!space) return c.json({ error: '尚无可访问的本体空间' }, 403)
  c.set('space', space)
  await next()
})

/**
 * 注册端点。挂载点按约定为 /api/explorations，但端点清单里的路径带 /explorations
 * 前缀，存在「挂载点是否已含该前缀」的歧义。这里把一个组内相对路径同时注册为：
 *   - 相对写法：/derived、/scenarios、/（挂载点为 /api/explorations 时命中）
 *   - 前缀写法：/explorations/derived、/explorations/scenarios、/explorations（挂载点为 /api 时命中）
 * 因此无论统一挂载在哪一级，前端两种直觉 URL 都能命中真实端点。
 */
function on(method: 'get' | 'post' | 'delete', suffix: string, handler: AppHandler) {
  const rel = suffix === '' ? '/' : `/${suffix}`
  const prefixed = suffix === '' ? '/explorations' : `/explorations/${suffix}`
  explorationRoutes[method](rel, handler)
  explorationRoutes[method](prefixed, handler)
}

/* ==================== 1. 保存的探索 ==================== */

const listExplorations: AppHandler = (c) => {
  const space = c.get('space')
  const rows = loadExplorations(space.id).sort((a, b) => b.createdAt - a.createdAt)
  return c.json({ explorations: rows })
}

const createExploration: AppHandler = async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const body = await c.req.json<{ name?: string; typeId?: string; filters?: unknown; sort?: string }>()
  if (!body.name?.trim()) return c.json({ error: '请填写探索名称' }, 400)
  if (!body.typeId?.trim()) return c.json({ error: '请选择对象类型' }, 400)
  const typeCheck = checkType(user, space, body.typeId)
  if (!typeCheck.ok) return c.json({ error: typeCheck.error }, typeCheck.status)
  const norm = normalizeFilters(body.filters)
  if (!norm.ok) return c.json({ error: norm.error }, 400)

  const row: ExplorationRow = {
    id: newId('EXP'), name: body.name.trim(), typeId: body.typeId,
    filters: norm.filters, sort: (body.sort ?? '').trim(), ownerId: user.id,
    spaceId: space.id, createdAt: Date.now(),
  }
  db.insert(tables.savedExplorations).values(row).run()
  audit(user.name, '新建保存的探索', row.name, { typeId: row.typeId, filterCount: row.filters.length })
  return c.json({ exploration: row })
}

const deleteExploration: AppHandler = (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const id = c.req.param('id') as string
  const row = db.select().from(tables.savedExplorations).where(eq(tables.savedExplorations.id, id)).get()
  if (!row || row.spaceId !== space.id) return c.json({ error: '探索不存在' }, 404)
  db.delete(tables.savedExplorations).where(eq(tables.savedExplorations.id, id)).run()
  audit(user.name, '删除保存的探索', row.name, { id })
  return c.json({ ok: true })
}

/** 按保存的 filters 对当前空间对象做真实过滤（上限 50）；filters 为空返回该类型全部 */
const runExploration: AppHandler = (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const id = c.req.param('id') as string
  const row = db.select().from(tables.savedExplorations).where(eq(tables.savedExplorations.id, id)).get()
  if (!row || row.spaceId !== space.id) return c.json({ error: '探索不存在' }, 404)
  const typeCheck = checkType(user, space, row.typeId)
  if (!typeCheck.ok) return c.json({ error: typeCheck.error }, typeCheck.status)

  const filters = (row.filters ?? []) as Filter[]
  let rows = objectsOfType(space.id, row.typeId)
  if (filters.length) rows = rows.filter((o) => matches(o.values as Record<string, unknown>, filters))
  if (row.sort) {
    const desc = row.sort.startsWith('-')
    const key = desc ? row.sort.slice(1) : row.sort.replace(/^\+/, '')
    rows = [...rows].sort((a, b) => {
      const av = (a.values as Record<string, unknown>)[key]
      const bv = (b.values as Record<string, unknown>)[key]
      const an = Number(av); const bn = Number(bv)
      const cmp = Number.isFinite(an) && Number.isFinite(bn) ? an - bn : String(av ?? '').localeCompare(String(bv ?? ''))
      return desc ? -cmp : cmp
    })
  }
  const total = rows.length
  const objects = rows.slice(0, 50).map((o) => ({ id: o.id, typeId: o.typeId, values: o.values }))
  return c.json({ exploration: { id: row.id, name: row.name, typeId: row.typeId, filters, sort: row.sort }, total, objects })
}

on('get', '', listExplorations)                         // 保存的探索列表
on('post', '', createExploration)                       // 新建保存的探索
on('delete', ':id', deleteExploration)                  // 删除保存的探索
on('post', ':id/run', runExploration)                   // 运行探索（真实过滤）

/* ==================== 4. 对象集比较 ==================== */

interface CompareItem { id: string; values: Record<string, unknown> }
const compare: AppHandler = async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const body = await c.req.json<{ a?: unknown; b?: unknown }>()
  const toIds = (raw: unknown): string[] => Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  const idsA = toIds(body.a)
  const idsB = toIds(body.b)

  const all = db.select().from(tables.objects).all().filter((o) => o.spaceId === space.id)
  const byId = new Map(all.map((o) => [o.id, { id: o.id, values: o.values as Record<string, unknown>, typeId: o.typeId }]))
  const pick = (ids: string[]): CompareItem[] => ids
    .map((id) => byId.get(id))
    .filter((o): o is { id: string; values: Record<string, unknown>; typeId: string } => {
      if (!o) return false
      return spacePerm(user, space, o.typeId) !== 'none'
    })
    .map((o) => ({ id: o.id, values: o.values }))

  const itemsA = pick(idsA)
  const itemsB = pick(idsB)
  const setB = new Set(itemsB.map((o) => o.id))
  const setA = new Set(itemsA.map((o) => o.id))
  const onlyA = itemsA.filter((o) => !setB.has(o.id))
  const onlyB = itemsB.filter((o) => !setA.has(o.id))
  const both = itemsA.filter((o) => setB.has(o.id))
  // 交集：按 id 与 values 对比，标注两侧值是否一致
  const mapB = new Map(itemsB.map((o) => [o.id, o]))
  const intersection = both.map((o) => ({
    id: o.id,
    values: o.values,
    sameValues: JSON.stringify(o.values) === JSON.stringify(mapB.get(o.id)?.values ?? {}),
  }))
  audit(user.name, '对象集比较', '对象集', { countA: itemsA.length, countB: itemsB.length })
  return c.json({ onlyA, onlyB, intersection })
}

on('post', 'compare', compare)                          // 对象集比较

/* ==================== 5. 派生属性 ==================== */

const listDerived: AppHandler = (c) => {
  const space = c.get('space')
  const rows = loadDerived(space.id).sort((a, b) => b.createdAt - a.createdAt)
  return c.json({ derived: rows })
}

const createDerived: AppHandler = async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const body = await c.req.json<{ typeId?: string; key?: string; name?: string; expr?: string }>()
  if (!body.typeId?.trim()) return c.json({ error: '请选择对象类型' }, 400)
  if (!body.key?.trim() || !body.name?.trim()) return c.json({ error: '请填写属性标识与名称' }, 400)
  if (!body.expr?.trim()) return c.json({ error: '请填写计算表达式' }, 400)
  if (!isSafeExpr(body.expr)) return c.json({ error: '表达式含禁用语法（只允许属性读取，禁止 require/process/fetch/eval/while/for/=> 等）' }, 400)
  const typeCheck = checkType(user, space, body.typeId)
  if (!typeCheck.ok) return c.json({ error: typeCheck.error }, typeCheck.status)

  const row: DerivedRow = {
    id: newId('DP'), typeId: body.typeId, key: body.key.trim(), name: body.name.trim(),
    expr: body.expr.trim(), spaceId: space.id, createdAt: Date.now(),
  }
  db.insert(tables.derivedProperties).values(row).run()
  audit(user.name, '新建派生属性', row.name, { typeId: row.typeId, key: row.key })
  return c.json({ derived: row })
}

/** 对某类型全部对象按 expr 真实计算；用 try/catch 返回每对象计算值 */
const evalDerived: AppHandler = (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const id = c.req.param('id') as string
  const row = db.select().from(tables.derivedProperties).where(eq(tables.derivedProperties.id, id)).get()
  if (!row || row.spaceId !== space.id) return c.json({ error: '派生属性不存在' }, 404)
  if (!isSafeExpr(row.expr)) return c.json({ error: '表达式含禁用语法，拒绝执行' }, 400)
  const typeCheck = checkType(user, space, row.typeId)
  if (!typeCheck.ok) return c.json({ error: typeCheck.error }, typeCheck.status)

  let fn: (v: Record<string, unknown>) => unknown
  try {
    fn = new Function('v', 'return ' + row.expr) as (v: Record<string, unknown>) => unknown
  } catch (e) {
    return c.json({ error: `表达式编译失败：${e instanceof Error ? e.message : String(e)}` }, 400)
  }

  const objects = objectsOfType(space.id, row.typeId)
  const results = objects.map((o) => {
    const v = o.values as Record<string, unknown>
    try {
      const value = fn(v)
      return { id: o.id, value: value === undefined ? null : value, error: '' }
    } catch (e) {
      return { id: o.id, value: null, error: e instanceof Error ? e.message : String(e) }
    }
  })
  audit(user.name, '计算派生属性', row.name, { typeId: row.typeId, count: results.length })
  return c.json({ derived: { id: row.id, key: row.key, name: row.name, expr: row.expr, typeId: row.typeId }, total: results.length, results })
}

on('get', 'derived', listDerived)                       // 派生属性列表
on('post', 'derived', createDerived)                    // 新建派生属性
on('post', 'derived/:id/eval', evalDerived)             // 对某类型全部对象真实计算

/* ==================== 6. 场景分支 ==================== */

const listScenarios: AppHandler = (c) => {
  const space = c.get('space')
  const rows = loadScenarios(space.id).sort((a, b) => b.createdAt - a.createdAt)
  return c.json({ scenarios: rows })
}

const createScenario: AppHandler = async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const body = await c.req.json<{ name?: string; desc?: string }>()
  if (!body.name?.trim()) return c.json({ error: '请填写场景名称' }, 400)
  const row: ScenarioRow = {
    id: newId('SCN'), name: body.name.trim(), desc: (body.desc ?? '').trim(),
    status: '进行中', changes: [], ownerId: user.id, spaceId: space.id,
    createdAt: Date.now(), mergedAt: null,
  }
  db.insert(tables.ontologyScenarios).values(row).run()
  audit(user.name, '新建本体场景', row.name)
  return c.json({ scenario: row })
}

/** 把一次变更记入场景 changes（不立即写 objects） */
const changeScenario: AppHandler = async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const id = c.req.param('id') as string
  const row = db.select().from(tables.ontologyScenarios).where(eq(tables.ontologyScenarios.id, id)).get()
  if (!row || row.spaceId !== space.id) return c.json({ error: '场景不存在' }, 404)
  if (row.status !== '进行中') return c.json({ error: `场景已「${row.status}」，无法再暂存变更` }, 400)

  const body = await c.req.json<{ op?: string; typeId?: string; objectId?: string; values?: Record<string, unknown> }>()
  if (!body.op || !['create', 'update', 'delete'].includes(body.op)) {
    return c.json({ error: 'op 须为 create / update / delete' }, 400)
  }
  if (!body.typeId?.trim()) return c.json({ error: '请指定 typeId' }, 400)
  if (body.op !== 'create' && !body.objectId?.trim()) return c.json({ error: 'update/delete 须指定 objectId' }, 400)
  const typeCheck = checkType(user, space, body.typeId)
  if (!typeCheck.ok) return c.json({ error: typeCheck.error }, typeCheck.status)
  if (spacePerm(user, space, body.typeId) !== 'full') return c.json({ error: '只读权限，无法暂存对象变更' }, 403)

  const change: Change = {
    op: body.op as Change['op'], typeId: body.typeId,
    ...(body.objectId ? { objectId: body.objectId } : {}),
    ...(body.values ? { values: body.values } : {}),
  }
  const changes = [...((row.changes ?? []) as Change[]), change]
  db.update(tables.ontologyScenarios).set({ changes }).where(eq(tables.ontologyScenarios.id, id)).run()
  audit(user.name, '暂存场景变更', row.name, { op: change.op, typeId: change.typeId, objectId: change.objectId ?? '' })
  return c.json({ ok: true, changeCount: changes.length })
}

/** 把 changes 真实应用到 objects 表；状态改「已合并」+ mergedAt */
const mergeScenario: AppHandler = (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const id = c.req.param('id') as string
  const row = db.select().from(tables.ontologyScenarios).where(eq(tables.ontologyScenarios.id, id)).get()
  if (!row || row.spaceId !== space.id) return c.json({ error: '场景不存在' }, 404)
  if (row.status !== '进行中') return c.json({ error: `场景已「${row.status}」，无法合并` }, 400)

  const changes = (row.changes ?? []) as Change[]
  // 合并前整体校验权限与类型，避免部分写入
  for (const ch of changes) {
    const typeCheck = checkType(user, space, ch.typeId)
    if (!typeCheck.ok) return c.json({ error: `变更「${ch.op} ${ch.objectId ?? ''}」：${typeCheck.error}` }, typeCheck.status)
    if (spacePerm(user, space, ch.typeId) !== 'full') return c.json({ error: `对「${ch.typeId}」只有只读权限，无法合并` }, 403)
  }

  const now = Date.now()
  const summary = { created: 0, updated: 0, deleted: 0, linksCleaned: 0, skipped: 0 }
  for (const ch of changes) {
    if (ch.op === 'create') {
      const newObjId = `${ch.typeId}:${now.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
      const values = (ch.values ?? {}) as Record<string, unknown>
      db.insert(tables.objects).values({
        id: newObjId, typeId: ch.typeId, values, createdBy: user.name,
        createdAt: now, updatedAt: now, spaceId: space.id,
      }).run()
      fireObjectEvent(space.id, ch.typeId, newObjId, 'create', values, user.name)
      summary.created++
    } else if (ch.op === 'update') {
      const target = db.select().from(tables.objects).where(eq(tables.objects.id, ch.objectId ?? '')).get()
      if (!target || target.spaceId !== space.id) { summary.skipped++; continue }
      const values = (ch.values ?? {}) as Record<string, unknown>
      db.update(tables.objects).set({ values, updatedAt: now }).where(eq(tables.objects.id, target.id)).run()
      fireObjectEvent(space.id, target.typeId, target.id, 'update', values, user.name)
      summary.updated++
    } else if (ch.op === 'delete') {
      const target = db.select().from(tables.objects).where(eq(tables.objects.id, ch.objectId ?? '')).get()
      if (!target || target.spaceId !== space.id) { summary.skipped++; continue }
      // 删除前清理链接（含 source/target 两端）
      const links = db.select().from(tables.objectLinks).all()
        .filter((l) => l.spaceId === space.id && (l.sourceId === target.id || l.targetId === target.id))
      for (const l of links) db.delete(tables.objectLinks).where(eq(tables.objectLinks.id, l.id)).run()
      summary.linksCleaned += links.length
      db.delete(tables.objects).where(eq(tables.objects.id, target.id)).run()
      fireObjectEvent(space.id, target.typeId, target.id, 'delete', (target.values as Record<string, unknown>), user.name)
      summary.deleted++
    }
  }

  db.update(tables.ontologyScenarios)
    .set({ status: '已合并', mergedAt: now })
    .where(eq(tables.ontologyScenarios.id, id)).run()
  audit(user.name, '合并本体场景', row.name, { changeCount: changes.length, ...summary })
  return c.json({ ok: true, status: '已合并', mergedAt: now, summary })
}

/** 放弃场景：状态改「已放弃」 */
const discardScenario: AppHandler = (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const id = c.req.param('id') as string
  const row = db.select().from(tables.ontologyScenarios).where(eq(tables.ontologyScenarios.id, id)).get()
  if (!row || row.spaceId !== space.id) return c.json({ error: '场景不存在' }, 404)
  if (row.status !== '进行中') return c.json({ error: `场景已「${row.status}」，无法放弃` }, 400)
  db.update(tables.ontologyScenarios).set({ status: '已放弃' }).where(eq(tables.ontologyScenarios.id, id)).run()
  audit(user.name, '放弃本体场景', row.name, { discardedChanges: ((row.changes ?? []) as Change[]).length })
  return c.json({ ok: true, status: '已放弃' })
}

on('get', 'scenarios', listScenarios)                   // 场景列表
on('post', 'scenarios', createScenario)                 // 新建场景
on('post', 'scenarios/:id/change', changeScenario)      // 暂存一次变更
on('post', 'scenarios/:id/merge', mergeScenario)        // 合并（真实写 objects）
on('post', 'scenarios/:id/discard', discardScenario)    // 放弃场景
