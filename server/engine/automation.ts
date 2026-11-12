import { db, tables } from '../db'

/**
 * 自动化引擎（P7）：对象变更事件 → 匹配空间内启用规则 → 执行动作
 * 动作类型：notify 通知 / create_action 执行动作 / hold_approval 暂存审批
 */

export interface Trigger {
  kind: 'object_change' | 'threshold'
  typeId?: string
  field?: string
  op?: '>' | '<' | '>=' | '<=' | '='
  value?: number
}

interface RuleRow {
  id: string
  name: string
  trigger: Trigger
  condition: string
  actions: { kind: string; config?: Record<string, unknown> }[]
  enabled: number
  hitCount: number
  owner: string
  spaceId: string
}

function notify(title: string, body: string, level: string, tag: string) {
  db.insert(tables.notifications).values({
    id: `NT-${Date.now().toString(36)}${Math.floor(Math.random() * 1000).toString(36)}`,
    title, body, level, tag, read: 0, createdAt: Date.now(),
  }).run()
}

function matchThreshold(t: Trigger, values: Record<string, unknown>): boolean {
  const v = Number(values[t.field ?? ''])
  const target = Number(t.value)
  if (Number.isNaN(v) || Number.isNaN(target)) return false
  switch (t.op) {
    case '>': return v > target
    case '<': return v < target
    case '>=': return v >= target
    case '<=': return v <= target
    case '=': return v === target
    default: return false
  }
}

/** 条件里的字段既可能是属性 key，也可能是属性显示名（如「健康度」） */
function resolveFieldValue(field: string, values: Record<string, unknown>, properties: { key: string; name: string }[]): unknown {
  if (Object.prototype.hasOwnProperty.call(values, field)) return values[field]
  const prop = properties.find((p) => p.name === field || p.key === field)
  return prop ? values[prop.key] : undefined
}

/**
 * 解释 condition 表达式：形如「字段 操作符 值」，支持 > >= < <= == = 包含 不包含。
 * 写法参考 routes/logic.ts 的条件节点。解析失败/字段无法求值时按「满足」处理，避免规则整体失效。
 */
function matchCondition(condition: string, values: Record<string, unknown>, properties: { key: string; name: string }[]): boolean {
  const expr = (condition ?? '').trim()
  if (!expr) return true
  const m = expr.match(/^(.+?)\s*(>=|<=|==|不包含|包含|>|<|=)\s*(.+)$/)
  if (!m) return true
  const field = m[1].trim()
  const op = m[2]
  const right = m[3].trim().replace(/^['"“”「」]+|['"“”「」]+$/g, '')
  const raw = resolveFieldValue(field, values, properties)
  if (raw === undefined || raw === null) return true
  const left = String(raw)
  if (op === '包含') return left.includes(right)
  if (op === '不包含') return !left.includes(right)

  const lv = Number(left)
  const rv = Number(right)
  // 两侧都是有效数字时按数值比较，否则退化为字符串比较（== / = 可用于文本相等）
  if (left.trim() !== '' && right !== '' && !Number.isNaN(lv) && !Number.isNaN(rv)) {
    switch (op) {
      case '>': return lv > rv
      case '<': return lv < rv
      case '>=': return lv >= rv
      case '<=': return lv <= rv
      case '==': case '=': return lv === rv
      default: return true
    }
  }
  switch (op) {
    case '>': return left > right
    case '<': return left < right
    case '>=': return left >= right
    case '<=': return left <= right
    case '==': case '=': return left === right
    default: return true
  }
}

/** 对象变更事件入口（objects CRUD 后调用；内部 try/catch 不阻断主流程） */
export function fireObjectEvent(spaceId: string, typeId: string, objectId: string, event: 'create' | 'update' | 'delete', values: Record<string, unknown>, actorName: string) {
  try {
    const rules = (db.select().from(tables.automationRules).all() as unknown as RuleRow[]).filter((r) => r.spaceId === spaceId && r.enabled === 1)
    const typeRow = db.select().from(tables.objectTypes).all().find((x) => x.id === typeId && x.spaceId === spaceId)
    const typeName = typeRow?.name ?? typeId
    const properties = (typeRow?.properties ?? []) as { key: string; name: string }[]
    for (const rule of rules) {
      const t = rule.trigger
      if (t.typeId && t.typeId !== typeId) continue
      let hit = false
      if (t.kind === 'object_change') hit = true
      else if (t.kind === 'threshold') hit = matchThreshold(t, values)
      if (!hit) continue
      // condition 参与判定：不满足则不触发动作（安全起见，无法求值时按满足处理）
      if (!matchCondition(rule.condition, values, properties)) continue

      const label = String(values.name ?? values.title ?? values.code ?? objectId)

      for (const act of rule.actions ?? []) {
        if (act.kind === 'notify') {
          notify(
            `自动化「${rule.name}」：${typeName} ${label} ${event === 'create' ? '新增' : event === 'update' ? '变更' : '删除'}`,
            t.kind === 'threshold' ? `${t.field} ${t.op} ${t.value} 触发（当前值 ${values[t.field ?? '']}）` : `对象${event === 'create' ? '新增' : '变更'}触发`,
            t.kind === 'threshold' ? 'warn' : 'info',
            '自动化',
          )
        } else if (act.kind === 'create_action') {
          // 事件驱动执行动作（复用动作引擎的效果写回；不做审批分流，需审批的动作用 hold_approval）
          const actionId = String(act.config?.actionId ?? '')
          const a = db.select().from(tables.actionTypes).all().find((x) => x.id === actionId && x.spaceId === spaceId)
          if (!a) { notify(`自动化「${rule.name}」执行失败`, `动作 ${actionId} 不存在`, 'error', '自动化'); continue }
          if (a.needsApproval === 1) {
            notify(`自动化「${rule.name}」跳过执行`, `动作「${a.name}」需审批，已转为待办提示`, 'warn', '自动化')
            continue
          }
          const params = { ...(act.config?.params as Record<string, unknown> ?? {}), objectId }
          const { applyEffectDeps } = getDeps()
          const res = applyEffectDeps(spaceId, a.id, a.effect as { kind: string; setValues?: Record<string, string>; linkTypeId?: string }, a.targetTypeId, params, `自动化:${rule.name}`)
          if (res.ok) {
            db.insert(tables.actionLogs).values({
              id: `AL-${Date.now().toString(36)}${Math.floor(Math.random() * 100).toString(36)}`,
              actionTypeId: a.id, objectId, params, status: 'done', result: { ...res.result, via: `automation:${rule.id}` }, actor: `自动化:${rule.name}`, createdAt: Date.now(),
            }).run()
          } else {
            notify(`自动化「${rule.name}」执行失败`, res.error, 'error', '自动化')
          }
        } else if (act.kind === 'hold_approval') {
          const actionId = String(act.config?.actionId ?? '')
          db.insert(tables.approvals).values({
            id: `AP-${Date.now().toString(36).toUpperCase()}`,
            title: `自动化「${rule.name}」暂存审批：执行动作 ${actionId}`,
            kind: '自动化暂存', payload: { actionTypeId: actionId, spaceId, spaceName: '', params: { objectId }, source: `automation:${rule.id}` },
            requester: `自动化:${rule.name}`, risk: '中', status: '待审批', createdAt: Date.now(),
          }).run()
          notify(`自动化「${rule.name}」已暂存审批`, `事件触发的动作待人工确认`, 'warn', '审批')
        }
      }

      db.update(tables.automationRules).set({ hitCount: rule.hitCount + 1, lastTriggeredAt: Date.now() }).run()
      db.insert(tables.auditEvents).values({
        id: `AE-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        actor: actorName, action: '自动化规则触发', target: `${rule.name}（${typeName}·${label}）`, ip: '内部', createdAt: Date.now(),
      }).run()
    }
  } catch {
    // 引擎异常不阻断对象写入
  }
}

/** 延迟依赖注入：applyEffect 定义在 routes/actions.ts，这里用轻量等价实现避免循环引用 */
import { eq } from 'drizzle-orm'
function getDeps() {
  return {
    applyEffectDeps(spaceId: string, _actionId: string, effect: { kind: string; setValues?: Record<string, string>; linkTypeId?: string }, targetTypeId: string, params: Record<string, unknown>, actor: string): { ok: true; result: Record<string, unknown> } | { ok: false; error: string } {
      const now = Date.now()
      const { objectId: _o, comment: _c, ...values } = params
      if (effect.kind === 'update') {
        const o = db.select().from(tables.objects).where(eq(tables.objects.id, String(params.objectId ?? ''))).get()
        if (!o || o.spaceId !== spaceId) return { ok: false, error: '目标对象不存在' }
        const next = { ...(o.values as Record<string, unknown>), ...(effect.setValues ?? {}), ...values }
        db.update(tables.objects).set({ values: next, updatedAt: now }).where(eq(tables.objects.id, o.id)).run()
        return { ok: true, result: { updatedObjectId: o.id } }
      }
      // 与动作引擎对齐：删除对象（连带清理其链接实例）
      if (effect.kind === 'delete') {
        const o = db.select().from(tables.objects).where(eq(tables.objects.id, String(params.objectId ?? ''))).get()
        if (!o || o.spaceId !== spaceId) return { ok: false, error: '目标对象不存在' }
        const links = db.select().from(tables.objectLinks).all().filter((l) => (l.sourceId === o.id || l.targetId === o.id) && l.spaceId === spaceId)
        for (const l of links) db.delete(tables.objectLinks).where(eq(tables.objectLinks.id, l.id)).run()
        db.delete(tables.objects).where(eq(tables.objects.id, o.id)).run()
        return { ok: true, result: { deletedObjectId: o.id, cascadedLinks: links.length } }
      }
      // 与动作引擎对齐：创建链接实例（objectId 为源，params.targetId 为目标）
      if (effect.kind === 'link') {
        if (!params.objectId || !params.targetId) return { ok: false, error: '缺少参数 objectId / targetId' }
        if (!effect.linkTypeId) return { ok: false, error: '动作未定义 linkTypeId' }
        const lt = db.select().from(tables.linkTypes).all().find((l) => l.id === effect.linkTypeId && l.spaceId === spaceId)
        if (!lt) return { ok: false, error: '链接类型不存在' }
        const id = `OL-${now.toString(36)}${Math.floor(Math.random() * 100).toString(36)}`
        db.insert(tables.objectLinks).values({ id, linkTypeId: effect.linkTypeId, sourceId: String(params.objectId), targetId: String(params.targetId), createdBy: actor, createdAt: now, spaceId }).run()
        return { ok: true, result: { createdLinkId: id } }
      }
      if (effect.kind === 'create') {
        const id = `${targetTypeId}:${now.toString(36)}${Math.floor(Math.random() * 100).toString(36)}`
        db.insert(tables.objects).values({ id, typeId: targetTypeId, values: { ...(effect.setValues ?? {}), ...values }, createdBy: actor, createdAt: now, updatedAt: now, spaceId }).run()
        return { ok: true, result: { createdObjectId: id } }
      }
      return { ok: false, error: `自动化暂不支持效果 ${effect.kind}` }
    },
  }
}
