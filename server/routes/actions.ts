import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, tables } from '../db'
import { requireAuth } from '../auth'
import { resolveSpace, spacePerm, isMember, type SpaceInfo } from '../space'
import { fireObjectEvent } from '../engine/automation'
import type { SessionUser } from '../../shared/types'

/**
 * 动作执行引擎（P4）：校验 → 审批分流 → 写回 → 全程留痕
 * effect: create / update / delete / link
 */

interface ParamDef {
  key: string
  name: string
  type: string
  required?: boolean
  enumValues?: string[]
}
interface Effect {
  kind: 'create' | 'update' | 'delete' | 'link'
  setValues?: Record<string, string>
  linkTypeId?: string
}

type Ctx = { Variables: { user: SessionUser; space: SpaceInfo } }

function audit(user: SessionUser, action: string, target: string, detail?: Record<string, unknown>) {
  db.insert(tables.auditEvents).values({
    id: `AE-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    actor: user.name, action, target, detail, ip: '本地', createdAt: Date.now(),
  }).run()
}

function logAction(actionTypeId: string, objectId: string, params: Record<string, unknown>, status: string, result: Record<string, unknown>, actor: string): string {
  const id = `AL-${Date.now().toString(36)}${Math.floor(Math.random() * 100).toString(36)}`
  db.insert(tables.actionLogs).values({ id, actionTypeId, objectId, params, status, result, actor, createdAt: Date.now() }).run()
  return id
}

/** 参数校验（按动作参数定义；未声明的键原样透传，供效果使用） */
function validateParams(defs: ParamDef[], input: Record<string, unknown>): { ok: true; values: Record<string, unknown> } | { ok: false; error: string } {
  const out: Record<string, unknown> = {}
  const defKeys = new Set(defs.map((d) => d.key))
  for (const p of defs) {
    const v = input[p.key]
    if (v === undefined || v === null || v === '') {
      if (p.required) return { ok: false, error: `缺少参数「${p.name}」` }
      continue
    }
    if (p.type === 'number') {
      const n = Number(v)
      if (Number.isNaN(n)) return { ok: false, error: `参数「${p.name}」应为数值` }
      out[p.key] = n
    } else if (p.type === 'enum' && p.enumValues?.length) {
      const s = String(v)
      if (!p.enumValues.includes(s)) return { ok: false, error: `参数「${p.name}」须为：${p.enumValues.join('/')}` }
      out[p.key] = s
    } else {
      out[p.key] = String(v)
    }
  }
  // 未声明的键透传（动作效果如 create 需要目标类型的完整字段）
  for (const [k, v] of Object.entries(input)) {
    if (!defKeys.has(k) && v !== undefined && v !== null && v !== '') out[k] = v
  }
  return { ok: true, values: out }
}

/** 执行效果写回（执行与审批通过共用） */
function applyEffect(spaceId: string, actionTypeId: string, effect: Effect, targetTypeRow: { id: string; properties: ParamDef[] }, params: Record<string, unknown>, actor: string): { ok: true; result: Record<string, unknown> } | { ok: false; error: string } {
  const { objectId, comment: _c, ...values } = params
  const now = Date.now()
  if (effect.kind === 'create') {
    // 按目标类型属性校验合并值（effect.setValues 为默认值）
    const merged = { ...(effect.setValues ?? {}), ...values }
    const defs = targetTypeRow.properties
    const checked: Record<string, unknown> = {}
    for (const p of defs) {
      const v = merged[p.key]
      if (v === undefined || v === null || v === '') {
        if (p.required) return { ok: false, error: `缺少必填属性「${p.name}」` }
        continue
      }
      if (p.type === 'number') {
        const n = Number(v)
        if (Number.isNaN(n)) return { ok: false, error: `属性「${p.name}」应为数值` }
        checked[p.key] = n
      } else if (p.type === 'enum' && p.enumValues?.length) {
        const s = String(v)
        if (!p.enumValues.includes(s)) return { ok: false, error: `属性「${p.name}」须为：${p.enumValues.join('/')}` }
        checked[p.key] = s
      } else if (p.type === 'boolean') {
        checked[p.key] = v === true || v === 'true'
      } else {
        checked[p.key] = String(v)
      }
    }
    const id = `${targetTypeRow.id}:${now.toString(36)}${Math.floor(Math.random() * 100).toString(36)}`
    db.insert(tables.objects).values({ id, typeId: targetTypeRow.id, values: checked, createdBy: actor, createdAt: now, updatedAt: now, spaceId }).run()
    fireObjectEvent(spaceId, targetTypeRow.id, id, 'create', checked, actor)
    return { ok: true, result: { createdObjectId: id } }
  }
  if (effect.kind === 'update') {
    if (!objectId) return { ok: false, error: '缺少参数 objectId' }
    const o = db.select().from(tables.objects).where(eq(tables.objects.id, String(objectId))).get()
    if (!o || o.spaceId !== spaceId) return { ok: false, error: '目标对象不存在（当前空间）' }
    const next = { ...(o.values as Record<string, unknown>), ...(effect.setValues ?? {}), ...values }
    db.update(tables.objects).set({ values: next, updatedAt: now }).where(eq(tables.objects.id, o.id)).run()
    fireObjectEvent(spaceId, o.typeId, o.id, 'update', next, actor)
    return { ok: true, result: { updatedObjectId: o.id, setKeys: Object.keys({ ...(effect.setValues ?? {}), ...values }) } }
  }
  if (effect.kind === 'delete') {
    if (!objectId) return { ok: false, error: '缺少参数 objectId' }
    const o = db.select().from(tables.objects).where(eq(tables.objects.id, String(objectId))).get()
    if (!o || o.spaceId !== spaceId) return { ok: false, error: '目标对象不存在' }
    const links = db.select().from(tables.objectLinks).all().filter((l) => (l.sourceId === o.id || l.targetId === o.id) && l.spaceId === spaceId)
    for (const l of links) db.delete(tables.objectLinks).where(eq(tables.objectLinks.id, l.id)).run()
    db.delete(tables.objects).where(eq(tables.objects.id, o.id)).run()
    fireObjectEvent(spaceId, o.typeId, o.id, 'delete', (o.values as Record<string, unknown>), actor)
    return { ok: true, result: { deletedObjectId: o.id, cascadedLinks: links.length } }
  }
  if (effect.kind === 'link') {
    if (!objectId || !values.targetId) return { ok: false, error: '缺少参数 objectId / targetId' }
    if (!effect.linkTypeId) return { ok: false, error: '动作未定义 linkTypeId' }
    const lt = db.select().from(tables.linkTypes).all().find((l) => l.id === effect.linkTypeId && l.spaceId === spaceId)
    if (!lt) return { ok: false, error: '链接类型不存在' }
    const id = `L-${now.toString(36)}${Math.floor(Math.random() * 100).toString(36)}`
    db.insert(tables.objectLinks).values({ id, linkTypeId: effect.linkTypeId, sourceId: String(objectId), targetId: String(values.targetId), createdBy: actor, createdAt: now, spaceId }).run()
    return { ok: true, result: { createdLinkId: id } }
  }
  return { ok: false, error: `未知效果类型 ${effect.kind}` }
}

export const actionRoutes = new Hono<Ctx>()
actionRoutes.use('*', requireAuth)
actionRoutes.use('*', async (c, next) => {
  const user = c.get('user')
  const space = resolveSpace(c, user)
  if (!space) return c.json({ error: '尚无可访问的本体空间' }, 403)
  c.set('space', space)
  await next()
})

/** 动作列表（当前空间，含执行次数） */
actionRoutes.get('/', (c) => {
  const space = c.get('space')
  const actions = db.select().from(tables.actionTypes).all().filter((a) => a.spaceId === space.id)
  const logs = db.select().from(tables.actionLogs).all()
  const typeMap = new Map(db.select().from(tables.objectTypes).all().filter((t) => t.spaceId === space.id).map((t) => [t.id, t.name]))
  return c.json({
    space: { id: space.id, name: space.name, kind: space.kind },
    actions: actions.map((a) => ({
      id: a.id, name: a.name, desc: a.desc, targetTypeId: a.targetTypeId, targetName: typeMap.get(a.targetTypeId) ?? a.targetTypeId,
      params: a.params, needsApproval: a.needsApproval === 1, effect: a.effect,
      execCount: logs.filter((l) => l.actionTypeId === a.id && l.status === 'done').length,
    })),
  })
})

/** 执行动作：校验 →（需审批则入队）→ 写回 → 留痕 */
actionRoutes.post('/:actionId/execute', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const actionId = c.req.param('actionId') as string
  const a = db.select().from(tables.actionTypes).all().find((x) => x.id === actionId && x.spaceId === space.id)
  if (!a) return c.json({ error: `动作「${actionId}」不存在（当前空间）` }, 404)
  if (spacePerm(user, space, a.targetTypeId) !== 'full') return c.json({ error: `你对目标对象「${a.targetTypeId}」无写权限` }, 403)

  const body = await c.req.json<{ params?: Record<string, unknown> }>()
  const checked = validateParams(a.params as ParamDef[], body.params ?? {})
  if (!checked.ok) return c.json({ error: checked.error }, 400)

  const targetType = db.select().from(tables.objectTypes).all().find((t) => t.id === a.targetTypeId && t.spaceId === space.id)
  if (!targetType) return c.json({ error: '目标对象类型不存在' }, 404)

  // 需审批 → 入审批队列
  if (a.needsApproval === 1) {
    const invId = `AP-${Date.now().toString(36).toUpperCase()}`
    const targetLabel = String(checked.values.objectId ?? '新对象')
    db.insert(tables.approvals).values({
      id: invId,
      title: `执行动作「${a.name}」${targetLabel !== '新对象' ? ` · 目标 ${String(checked.values.objectId).slice(0, 24)}` : ''}`,
      kind: '动作执行',
      payload: { actionTypeId: a.id, actionName: a.name, spaceId: space.id, spaceName: space.name, params: checked.values, effect: a.effect, targetTypeId: a.targetTypeId },
      requester: user.name,
      risk: a.effect.kind === 'delete' ? '高' : '中',
      status: '待审批', createdAt: Date.now(),
    }).run()
    logAction(a.id, String(checked.values.objectId ?? ''), checked.values, 'pending_approval', { approvalId: invId }, user.name)
    audit(user, '发起动作（待审批）', `${a.name}@${space.name}`, { params: checked.values, approvalId: invId })
    return c.json({ status: 'pending_approval', approvalId: invId, message: '该动作需审批，已进入审批中心' })
  }

  // 直接执行
  const res = applyEffect(space.id, a.id, a.effect as Effect, targetType as { id: string; properties: ParamDef[] }, checked.values, user.name)
  if (!res.ok) {
    logAction(a.id, String(checked.values.objectId ?? ''), checked.values, 'failed', { error: res.error }, user.name)
    return c.json({ error: res.error }, 400)
  }
  logAction(a.id, String(checked.values.objectId ?? ''), checked.values, 'done', res.result, user.name)
  audit(user, `执行动作·${a.name}`, `@${space.name}`, { params: checked.values, result: res.result })
  return c.json({ status: 'done', result: res.result })
})

/* ---------------- 审批中心 ---------------- */

function canApprove(user: SessionUser, payload: { spaceId?: string }): boolean {
  if (user.role.id === 'admin') return true
  const sp = payload.spaceId ? db.select().from(tables.spaces).all().find((s) => s.id === payload.spaceId) : undefined
  return !!sp && sp.ownerId === user.id
}

/** 审批列表（管理员/空间所有者见全部；其他用户见自己发起的） */
actionRoutes.get('/approvals/list', (c) => {
  const user = c.get('user')
  const rows = db.select().from(tables.approvals).all().sort((a, b) => b.createdAt - a.createdAt).slice(0, 100)
  const visible = rows.filter((r) => {
    const payload = r.payload as { spaceId?: string }
    return canApprove(user, payload) || r.requester === user.name
  })
  return c.json({
    approvals: visible.map((r) => ({
      id: r.id, title: r.title, kind: r.kind, requester: r.requester, risk: r.risk, status: r.status,
      payload: r.payload, decidedBy: r.decidedBy,
      createdAt: new Date(r.createdAt).toLocaleString('zh-CN', { hour12: false }),
    })),
    canApprove: canApprove(user, {}),
  })
})

/** 审批决策：通过 → 执行效果；驳回 → 关闭 */
actionRoutes.post('/approvals/:id/decide', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id') as string
  const inv = db.select().from(tables.approvals).where(eq(tables.approvals.id, id)).get()
  if (!inv) return c.json({ error: '审批单不存在' }, 404)
  if (inv.status !== '待审批') return c.json({ error: `该单已${inv.status}` }, 409)
  const payload = inv.payload as { actionTypeId: string; spaceId: string; params: Record<string, unknown>; effect: Effect; targetTypeId: string; spaceName?: string }
  if (!canApprove(user, payload)) return c.json({ error: '无审批权限（平台管理员或空间所有者）' }, 403)

  const { decision, comment } = await c.req.json<{ decision: 'approve' | 'reject'; comment?: string }>()
  if (decision === 'reject') {
    db.update(tables.approvals).set({ status: '已驳回', decidedBy: user.name, decidedAt: Date.now() }).where(eq(tables.approvals.id, id)).run()
    logAction(payload.actionTypeId, String(payload.params?.objectId ?? ''), payload.params ?? {}, 'rejected', { rejectedBy: user.name }, user.name)
    audit(user, '驳回审批', inv.title, { comment })
    return c.json({ ok: true, status: '已驳回' })
  }

  const targetType = db.select().from(tables.objectTypes).all().find((t) => t.id === payload.targetTypeId && t.spaceId === payload.spaceId)
  if (!targetType) return c.json({ error: '目标类型已不存在，无法执行' }, 409)
  const res = applyEffect(payload.spaceId, payload.actionTypeId, payload.effect, targetType as { id: string; properties: ParamDef[] }, payload.params ?? {}, user.name)
  if (!res.ok) return c.json({ error: `执行失败：${res.error}` }, 400)

  db.update(tables.approvals).set({ status: '已通过', decidedBy: user.name, decidedAt: Date.now() }).where(eq(tables.approvals.id, id)).run()
  logAction(payload.actionTypeId, String(payload.params?.objectId ?? ''), payload.params ?? {}, 'done', { ...res.result, viaApproval: id }, user.name)
  audit(user, '通过审批并执行', inv.title, { result: res.result, comment })
  return c.json({ ok: true, status: '已通过', result: res.result })
})

/* ---------------- 动作日志 ---------------- */

actionRoutes.get('/logs/list', (c) => {
  const rows = db.select().from(tables.actionLogs).all().sort((a, b) => b.createdAt - a.createdAt).slice(0, 100)
  const actionMap = new Map(db.select().from(tables.actionTypes).all().map((a) => [a.id, a.name]))
  return c.json({
    logs: rows.map((l) => ({
      id: l.id, actionName: actionMap.get(l.actionTypeId) ?? l.actionTypeId, objectId: l.objectId,
      status: l.status, actor: l.actor, result: l.result,
      createdAt: new Date(l.createdAt).toLocaleString('zh-CN', { hour12: false }),
    })),
  })
})
