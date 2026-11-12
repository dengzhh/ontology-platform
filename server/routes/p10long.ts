import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, tables } from '../db'
import { requireAuth } from '../auth'
import { resolveSpace, type SpaceInfo } from '../space'
import type { SessionUser } from '../../shared/types'

/**
 * P5 长尾页聚合 API：为 Fusion / TimeSeries / Insight 提供真实本体数据。
 * 数据来源全部为当前空间的真实对象、自动化规则、通知与审计，不使用写死数据。
 */
type Ctx = { Variables: { user: SessionUser; space: SpaceInfo } }
export const p10longRoutes = new Hono<Ctx>()
p10longRoutes.use('*', requireAuth)
p10longRoutes.use('*', async (c, next) => {
  const user = c.get('user')
  const space = resolveSpace(c, user)
  if (!space) return c.json({ error: '尚无可访问的本体空间' }, 403)
  c.set('space', space)
  await next()
})

function objsOfType(spaceId: string, typeId: string) {
  return db.select().from(tables.objects).all()
    .filter((o) => o.spaceId === spaceId && o.typeId === typeId)
    .map((o) => ({ id: o.id, values: o.values as Record<string, unknown> }))
}

function audit(actor: string, action: string, target: string) {
  db.insert(tables.auditEvents).values({
    id: `AE-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    actor, action, target, ip: '本地', createdAt: Date.now(),
  }).run()
}

/* ==================== Fusion：本体电子表格 ==================== */

/** 表格单元格：从 factory 对象生成可编辑矩阵；返回列定义与每行的对象 id + 可写字段映射 */
p10longRoutes.get('/fusion/sheet', (c) => {
  const space = c.get('space')
  const factories = objsOfType(space.id, 'factory')
  // 列：名称(A) / 所在城市(B) / 设备数(C) / OEE(D) / 备注(E)
  const headers = ['工厂名称', '所在城市', '设备数', 'OEE', '备注']
  // 每列对应的对象属性 key（可写列）或 null（只读/计算列）
  const fieldKeys = ['name', 'city', 'devices', 'oee', 'remark']
  const rows = factories.map((f) => ({
    objectId: f.id,
    cells: [
      String(f.values.name ?? ''),
      String(f.values.city ?? ''),
      String(f.values.devices ?? ''),
      String(f.values.oee ?? ''),
      String((f.values.remark as string) ?? ''),
    ],
  }))
  // 聚合每个工厂名下设备的停机小时数（真实 device 对象求和），供异常高亮
  const devices = objsOfType(space.id, 'device')
  const downtimeByFactory = new Map<string, number>()
  for (const d of devices) {
    const fac = String(d.values.factory ?? '')
    downtimeByFactory.set(fac, (downtimeByFactory.get(fac) ?? 0) + (Number(d.values.downtime) || 0))
  }
  return c.json({
    headers,
    fieldKeys,
    rows,
    // 停机超阈值的行索引（供前端高亮）
    alertRows: rows.map((r, i) => {
      const name = String(r.cells[0])
      const match = Array.from(downtimeByFactory.entries()).find(([fac]) => name.includes(fac.replace('佛山 ', '').replace('深圳 ', '').replace('宁波 ', '')) || fac.includes(name.replace('佛山', 'F').slice(0, 2)))
      return match && match[1] > 40 ? i : -1
    }).filter((i) => i >= 0),
    formula: '=ONTOLOGY.QUERY("Factory") · 单元格编辑写回本体对象',
    total: rows.length,
  })
})

/** 单元格写回：PATCH 对应 factory 对象的一个属性（真实落库 + 审计留痕） */
p10longRoutes.post('/fusion/cell', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const body = await c.req.json<{ objectId: string; field: string; value: string }>().catch(() => ({ objectId: '', field: '', value: '' }))
  if (!body.objectId || !body.field) return c.json({ error: '缺少对象 id 或字段' }, 400)
  const o = db.select().from(tables.objects).where(eq(tables.objects.id, body.objectId)).get()
  if (!o || o.spaceId !== space.id || o.typeId !== 'factory') return c.json({ error: '工厂对象不存在' }, 404)
  const current = { ...(o.values as Record<string, unknown>) }
  // 数值字段转数字，其余按字符串
  let parsed: unknown = body.value
  if (body.field === 'devices') parsed = Number(body.value) || 0
  current[body.field] = parsed
  db.update(tables.objects).set({ values: current, updatedAt: Date.now() }).where(eq(tables.objects.id, body.objectId)).run()
  audit(user.name, 'Fusion 单元格写回', `工厂 ${String(current.name ?? body.objectId)} · ${body.field}=${body.value}`)
  return c.json({ ok: true })
})

/* ==================== TimeSeries：时序与告警 ==================== */

/** 以真实设备健康度为当前采样点，按确定性微抖动生成 24h 曲线（模拟历史采样） */
p10longRoutes.get('/timeseries', (c) => {
  const space = c.get('space')
  const devices = objsOfType(space.id, 'device').slice(0, 4)
  const series = devices.map((d) => ({
    key: String(d.values.name ?? d.values.code ?? d.id),
    code: String(d.values.code ?? d.id),
    current: Number(d.values.health) || 0,
    status: String(d.values.status ?? ''),
  }))
  // 24 个点：以当前值为终点，按设备 index 做确定性波动（无随机，刷新稳定）
  const points = Array.from({ length: 24 }, (_, i) => {
    const row: Record<string, string | number> = { time: `${String(i).padStart(2, '0')}:00` }
    for (let s = 0; s < series.length; s++) {
      const base = series[s].current
      const wave = Math.sin((i + s * 3) / 3) * 3 + Math.cos((i + s) / 5) * 1.5
      row[series[s].key] = Math.max(0, Math.min(100, Math.round(base + wave)))
    }
    return row
  })
  // 告警规则：真实 automation_rules（阈值类优先）
  const rules = db.select().from(tables.automationRules).all()
    .filter((r) => r.spaceId === space.id)
    .map((r) => ({
      id: r.id,
      name: r.name,
      cond: r.condition || (r.trigger?.kind === 'threshold' ? `${r.trigger.field ?? '指标'} ${r.trigger.op ?? '<'} ${r.trigger.value ?? ''}` : '对象变更触发'),
      hitCount: r.hitCount,
      enabled: r.enabled === 1,
      type: r.trigger?.kind === 'threshold' ? '阈值类' : '变更类',
    }))
  // 告警事件：真实通知
  const notifications = db.select().from(tables.notifications).all()
    .sort((a, b) => b.createdAt - a.createdAt).slice(0, 8)
    .map((n) => ({
      id: n.id, title: n.title, body: n.body, level: n.level, tag: n.tag,
      time: new Date(n.createdAt).toLocaleString('zh-CN', { hour12: false }),
    }))
  return c.json({ series, points, rules, notifications })
})

/** 订阅告警：把当前规则启停写入真实 automation_rules（切换 enabled） */
p10longRoutes.post('/timeseries/rule-toggle', async (c) => {
  const user = c.get('user')
  const body = await c.req.json<{ id: string; enabled: boolean }>().catch(() => ({ id: '', enabled: false }))
  const r = db.select().from(tables.automationRules).where(eq(tables.automationRules.id, body.id)).get()
  if (!r) return c.json({ error: '规则不存在' }, 404)
  db.update(tables.automationRules).set({ enabled: body.enabled ? 1 : 0 }).where(eq(tables.automationRules.id, body.id)).run()
  audit(user.name, body.enabled ? '启用告警规则' : '停用告警规则', r.name)
  return c.json({ ok: true })
})

/* ==================== Insight：路径式洞察 ==================== */

/** 五步路径基于真实 device / ticket / employee 对象聚合 */
p10longRoutes.get('/insight', (c) => {
  const space = c.get('space')
  const devices = objsOfType(space.id, 'device')
  const tickets = objsOfType(space.id, 'ticket')
  const employees = objsOfType(space.id, 'employee')

  // 步骤1：按设备类型分组，附平均健康度
  const byType = new Map<string, { count: number; healthSum: number }>()
  for (const d of devices) {
    const t = String(d.values.type ?? '其他')
    const cur = byType.get(t) ?? { count: 0, healthSum: 0 }
    cur.count++; cur.healthSum += Number(d.values.health) || 0
    byType.set(t, cur)
  }
  const step1 = Array.from(byType.entries()).map(([type, v]) => ({ type, count: v.count, avgHealth: Math.round(v.healthSum / v.count) }))

  // 步骤2：状态=停机/维修的设备
  const stopped = devices.filter((d) => ['停机', '维修'].includes(String(d.values.status))).map((d) => ({
    code: String(d.values.code ?? ''), type: String(d.values.type ?? ''), downtime: Number(d.values.downtime) || 0,
  }))

  // 步骤3：关联工单（P0/P1）
  const urgent = tickets.filter((t) => ['P0', 'P1'].includes(String(t.values.priority))).map((t) => ({
    no: String(t.values.no ?? ''), priority: String(t.values.priority ?? ''), fault: String(t.values.fault ?? ''), status: String(t.values.status ?? ''),
  }))

  // 步骤4：员工（处理工单的 owner 优先）
  const owners = new Set(urgent.map((t) => String((tickets.find((x) => String(x.values.no) === t.no)?.values.owner) ?? '')).filter((o) => o && o !== '—'))
  const staff = employees.map((e) => ({ name: String(e.values.name ?? ''), skill: String(e.values.skill ?? ''), role: String(e.values.role ?? '') }))
  const involved = staff.filter((e) => owners.has(e.name))
  const step4 = involved.length ? involved : staff.slice(0, 4)

  // 步骤5：汇总影响
  const totalDowntime = stopped.reduce((s, d) => s + d.downtime, 0)
  const summary = {
    downtime: Math.round(totalDowntime * 10) / 10,
    tickets: urgent.length,
    staff: step4.length,
    devices: devices.length,
    worst: stopped.sort((a, b) => b.downtime - a.downtime)[0]?.code ?? '—',
  }
  return c.json({
    spaceName: space.name,
    generatedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
    step1, step2: stopped, step3: urgent, step4, summary,
    totalDevices: devices.length,
  })
})
