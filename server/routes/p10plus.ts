import { Hono } from 'hono'
import { db, tables } from '../db'
import { requireAuth } from '../auth'
import { resolveSpace, spacePerm, type SpaceInfo } from '../space'
import { llmComplete } from '../routes/ai'
import { PACKS } from '../templates/packs'
import { eq } from 'drizzle-orm'
import type { SessionUser } from '../../shared/types'

/** P10 增强 API：规则引擎/评测/地图/流程/管道/血缘/Marketplace 接真 */

type Ctx = { Variables: { user: SessionUser; space: SpaceInfo } }

export const p10plusRoutes = new Hono<Ctx>()
p10plusRoutes.use('*', requireAuth)
p10plusRoutes.use('*', async (c, next) => {
  const user = c.get('user')
  const space = resolveSpace(c, user)
  if (!space) return c.json({ error: '尚无可访问的本体空间' }, 403)
  c.set('space', space)
  await next()
})

/* ---------- 规则引擎（复用真实自动化规则） ---------- */
p10plusRoutes.get('/rules', (c) => {
  const space = c.get('space')
  const rules = db.select().from(tables.automationRules).all().filter((r) => r.spaceId === space.id)
  const audit = db.select().from(tables.auditEvents).all().filter((a) => a.action.includes('自动化'))
  const types = db.select().from(tables.objectTypes).all().filter((t) => t.spaceId === space.id)
  const typeMap = new Map(types.map((t) => [t.id, t.name]))

  return c.json({
    rules: rules.map((r) => ({
      id: r.id, name: r.name, enabled: r.enabled === 1, hitCount: r.hitCount,
      trigger: r.trigger, condition: r.condition, actions: r.actions,
      triggerTypeName: r.trigger.typeId ? typeMap.get(r.trigger.typeId) ?? r.trigger.typeId : '任意',
      owner: r.owner,
      lastTriggeredAt: r.lastTriggeredAt ? new Date(r.lastTriggeredAt).toLocaleString('zh-CN', { hour12: false }) : '',
    })),
    triggerHistory: audit.slice(0, 10).map((a) => ({
      actor: a.actor, action: a.action, target: a.target.slice(0, 50),
      time: new Date(a.createdAt).toLocaleString('zh-CN', { hour12: false }),
    })),
    types: types.map((t) => ({ id: t.id, name: t.name, properties: t.properties })),
  })
})

/* ---------- 模型评估（真实 LLM 评测） ---------- */
interface EvalCase { id: string; input: string; expected: string; category: string }

p10plusRoutes.get('/evals', (c) => {
  // 从 AI 消息中提取历史评测（简化存储：用 ai_messages 标记 scene=eval）
  const space = c.get('space')
  const msgs = db.select().from(tables.aiMessages).all().filter((m) => m.conversationId.startsWith('EVAL-'))
  const evalResults = msgs.filter((m) => m.role === 'assistant').map((m) => {
    try {
      return JSON.parse(m.content) as { input: string; expected: string; actual: string; score: number; model: string; time: string }
    } catch { return null }
  }).filter(Boolean)

  return c.json({
    results: evalResults.reverse(),
    stats: {
      total: evalResults.length,
      avgScore: evalResults.length > 0 ? Math.round((evalResults.reduce((s, r) => s + (r?.score ?? 0), 0) / evalResults.length) * 100) / 100 : 0,
    },
  })
})

p10plusRoutes.post('/evals/run', async (c) => {
  const { cases } = await c.req.json<{ cases: EvalCase[] }>()
  if (!cases?.length) return c.json({ error: '请提供测试用例' }, 400)
  const results: { input: string; expected: string; actual: string; score: number; model: string; time: string }[] = []

  for (const tc of cases.slice(0, 10)) {
    try {
      const reply = await llmComplete(
        '你是企业智能助手。请准确、简洁地回答问题。',
        tc.input,
      )
      // 简单评分：比较关键词重叠度
      const expectedWords = tc.expected.split(/[，。、\s]+/).filter((w) => w.length > 1)
      const actualWords = reply.split(/[，。、\s]+/).filter((w) => w.length > 1)
      const overlap = expectedWords.filter((w) => actualWords.some((a) => a.includes(w) || w.includes(a))).length
      const score = expectedWords.length > 0 ? Math.round((overlap / expectedWords.length) * 100) / 100 : 0.5
      results.push({ input: tc.input, expected: tc.expected, actual: reply.slice(0, 200), score, model: 'LLM', time: new Date().toLocaleString('zh-CN', { hour12: false }) })
    } catch {
      results.push({ input: tc.input, expected: tc.expected, actual: '调用失败', score: 0, model: 'LLM', time: new Date().toLocaleString('zh-CN', { hour12: false }) })
    }
  }
  return c.json({ results })
})

/* ---------- 地理空间（真实工厂/客户坐标） ---------- */
p10plusRoutes.get('/map', (c) => {
  const space = c.get('space')
  const types = db.select().from(tables.objectTypes).all().filter((t) => t.spaceId === space.id)
  const objs = db.select().from(tables.objects).all().filter((o) => o.spaceId === space.id)

  // 城市坐标映射
  const cityCoords: Record<string, { x: number; y: number }> = {
    '广东·佛山': { x: 400, y: 320 }, '佛山': { x: 400, y: 320 },
    '广东·深圳': { x: 480, y: 360 }, '深圳': { x: 480, y: 360 },
    '浙江·宁波': { x: 620, y: 220 }, '宁波': { x: 620, y: 220 },
    '重庆': { x: 330, y: 340 }, '上海': { x: 640, y: 250 },
    '广州': { x: 420, y: 350 }, '北京': { x: 500, y: 130 },
  }

  const points: { x: number; y: number; label: string; value: string; color: string; typeName: string; hot?: boolean }[] = []
  const links: { from: string; to: string }[] = []

  for (const o of objs) {
    const t = types.find((x) => x.id === o.typeId)
    if (!t) continue
    const v = o.values as Record<string, unknown>
    const city = String(v.city ?? v.location ?? '')
    const coord = cityCoords[city] ?? cityCoords[city.replace(/\s/g, '')]
    if (!coord) continue
    const label = String(v.name ?? v.title ?? v.code ?? o.id)
    const typeName = t.name
    let value = ''
    let hot = false
    if (v.status === '停机' || v.health !== undefined && Number(v.health) < 60) hot = true
    if (v.count !== undefined) value = `${v.count} 台`
    else if (v.devices !== undefined) value = `${v.devices} 台`
    else if (v.revenue !== undefined) value = String(v.revenue)
    points.push({ ...coord, label, value, color: t.color, typeName, hot })
  }

  // 对象链接 → 地图弧线
  const objLinks = db.select().from(tables.objectLinks).all().filter((l) => l.spaceId === space.id)
  const labelMap = new Map(points.map((p) => [p.label, p]))
  for (const l of objLinks.slice(0, 10)) {
    const src = db.select().from(tables.objects).all().find((o) => o.id === l.sourceId)
    const dst = db.select().from(tables.objects).all().find((o) => o.id === l.targetId)
    if (!src || !dst) continue
    const srcP = points.find((p) => p.label === String((src.values as Record<string, unknown>).name ?? src.id))
    const dstP = points.find((p) => p.label === String((dst.values as Record<string, unknown>).name ?? dst.id))
    if (srcP && dstP) links.push({ from: srcP.label, to: dstP.label })
  }

  return c.json({ points, links, typeCount: types.length, objectCount: objs.length })
})

/* ---------- 流程编排（动作链） ---------- */
p10plusRoutes.get('/machinery', (c) => {
  const space = c.get('space')
  const logs = db.select().from(tables.actionLogs).all().sort((a, b) => b.createdAt - a.createdAt).slice(0, 30)
  const actionTypes = db.select().from(tables.actionTypes).all().filter((a) => a.spaceId === space.id)
  const atm = new Map(actionTypes.map((a) => [a.id, a.name]))
  const objs = db.select().from(tables.objects).all().filter((o) => o.spaceId === space.id)
  const objMap = new Map(objs.map((o) => [o.id, String((o.values as Record<string, unknown>).name ?? o.id)]))

  return c.json({
    flows: actionTypes.map((a) => {
      const flowLogs = logs.filter((l) => l.actionTypeId === a.id)
      return {
        id: a.id, name: a.name, desc: a.desc, needsApproval: a.needsApproval === 1,
        targetTypeName: objMap.get(a.targetTypeId) ?? a.targetTypeId,
        execCount: flowLogs.filter((l) => l.status === 'done').length,
        pendingCount: flowLogs.filter((l) => l.status === 'pending_approval').length,
        recentExecs: flowLogs.slice(0, 3).map((l) => ({
          actor: l.actor, status: l.status,
          target: objMap.get(l.objectId) ?? l.objectId,
          time: new Date(l.createdAt).toLocaleString('zh-CN', { hour12: false }),
        })),
      }
    }),
    recentLogs: logs.slice(0, 8).map((l) => ({
      actionName: atm.get(l.actionTypeId) ?? l.actionTypeId,
      status: l.status, actor: l.actor,
      target: objMap.get(l.objectId) ?? l.objectId,
      time: new Date(l.createdAt).toLocaleString('zh-CN', { hour12: false }),
    })),
  })
})

/* ---------- 流程编排（自定义流程定义 CRUD：节点画布可编辑并持久化） ---------- */

/** 流程节点：action 节点可绑定真实动作类型（actionId 指向 actionTypes） */
interface MachNode {
  id: string
  type: 'start' | 'action' | 'approval' | 'notify' | 'end'
  label: string
  actionId?: string
  x?: number
  y?: number
  next?: string
}
interface MachFlow { id: string; name: string; nodes: MachNode[]; updatedAt: number }

function readMachFlows(spaceId: string): MachFlow[] {
  const row = db.select().from(tables.settings).where(eq(tables.settings.key, `machinery_flows_${spaceId}`)).get()
  return (row?.value as unknown as { flows?: MachFlow[] })?.flows ?? []
}
function writeMachFlows(spaceId: string, flows: MachFlow[]) {
  const key = `machinery_flows_${spaceId}`
  const value = { flows }
  const now = Date.now()
  const existing = db.select().from(tables.settings).where(eq(tables.settings.key, key)).get()
  if (existing) db.update(tables.settings).set({ value, updatedAt: now }).where(eq(tables.settings.key, key)).run()
  else db.insert(tables.settings).values({ key, value, updatedAt: now }).run()
}

p10plusRoutes.get('/machinery/flows', (c) => {
  return c.json({ flows: readMachFlows(c.get('space').id) })
})

p10plusRoutes.post('/machinery/flows', async (c) => {
  const space = c.get('space')
  const body = await c.req.json<{ id?: string; name: string; nodes: MachNode[] }>().catch((): { id?: string; name: string; nodes: MachNode[] } => ({ name: '', nodes: [] }))
  if (!body.name?.trim()) return c.json({ error: '请填写流程名称' }, 400)
  const nodes = body.nodes ?? []
  if (!Array.isArray(nodes) || nodes.length === 0) return c.json({ error: '至少需要一个节点' }, 400)
  if (new Set(nodes.map((n) => n.id)).size !== nodes.length) return c.json({ error: '节点 id 重复' }, 400)
  const validTypes = new Set(['start', 'action', 'approval', 'notify', 'end'])
  if (nodes.some((n) => !validTypes.has(n.type))) return c.json({ error: '存在未知节点类型' }, 400)
  for (const n of nodes) {
    if (n.next && !nodes.some((x) => x.id === n.next)) return c.json({ error: `节点「${n.label}」的连线目标 ${n.next} 不存在` }, 400)
    if (n.type === 'action' && n.actionId) {
      const at = db.select().from(tables.actionTypes).all().find((a) => a.id === n.actionId && a.spaceId === space.id)
      if (!at) return c.json({ error: `节点「${n.label}」绑定的动作类型不存在` }, 400)
    }
  }
  const list = readMachFlows(space.id)
  const id = body.id ?? `MF-${Date.now().toString(36).toUpperCase()}`
  const sameName = list.find((f) => f.name === body.name!.trim() && f.id !== id)
  const finalId = !body.id && sameName ? sameName.id : id
  const flow: MachFlow = { id: finalId, name: body.name.trim(), nodes, updatedAt: Date.now() }
  const next = list.some((f) => f.id === finalId) ? list.map((f) => (f.id === finalId ? flow : f)) : [...list, flow]
  writeMachFlows(space.id, next)
  return c.json({ id: finalId })
})

p10plusRoutes.delete('/machinery/flows/:id', (c) => {
  const space = c.get('space')
  writeMachFlows(space.id, readMachFlows(space.id).filter((f) => f.id !== c.req.param('id')))
  return c.json({ ok: true })
})

/* ---------- 管道（审计日志→数据同步记录） ---------- */
p10plusRoutes.get('/pipelines', (c) => {
  const space = c.get('space')
  const docs = db.select().from(tables.documents).all().filter((d) => d.spaceId === space.id)
  const chunks = db.select().from(tables.docChunks).all().filter((ch) => docs.some((d) => d.id === ch.docId))
  // 真实管道定义 + 运行记录（不再用审计伪造 duration/status）
  const defs = db.select().from(tables.pipelines).all().filter((p) => p.spaceId === space.id)
  const runs = db.select().from(tables.pipelineRuns).all()
    .filter((r) => r.spaceId === space.id)
    .sort((a, b) => b.createdAt - a.createdAt).slice(0, 10)
    .map((r) => ({
      id: r.id, pipelineId: r.pipelineId, name: defs.find((d) => d.id === r.pipelineId)?.name ?? r.pipelineId,
      schedule: r.trigger, status: r.status,
      duration: `${(r.durationMs / 1000).toFixed(2)}秒`,
      rows: r.rowsProcessed, detail: r.message,
      time: new Date(r.createdAt).toLocaleString('zh-CN', { hour12: false }),
    }))
  return c.json({
    pipelines: defs.map((d) => ({ id: d.id, name: d.name, desc: d.desc, schedule: d.schedule, status: d.status, version: d.version, nodeCount: (d.nodes as unknown[]).length, nodes: d.nodes })),
    runs,
    knowledgePipeline: {
      docs: docs.length, chunks: chunks.length,
      status: chunks.length > 0 ? '运行中' : '空闲',
    },
  })
})

/** 新建/编辑管道定义（真实落库） */
p10plusRoutes.post('/pipelines', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const body = await c.req.json<{ id?: string; name: string; desc?: string; nodes?: { id: string; type: string; config: Record<string, unknown> }[]; schedule?: string }>().catch((): { id?: string; name: string; desc?: string; nodes?: { id: string; type: string; config: Record<string, unknown> }[]; schedule?: string } => ({ name: '' }))
  if (!body.name?.trim()) return c.json({ error: '请填写管道名称' }, 400)
  const now = Date.now()
  if (body.id) {
    const prev = db.select().from(tables.pipelines).where(eq(tables.pipelines.id, body.id)).get()
    if (!prev) return c.json({ error: '管道不存在' }, 404)
    db.update(tables.pipelines).set({ name: body.name.trim(), desc: body.desc ?? '', nodes: body.nodes ?? prev.nodes, schedule: body.schedule ?? prev.schedule, updatedAt: now }).where(eq(tables.pipelines.id, body.id)).run()
    return c.json({ id: body.id })
  }
  const id = `PL-${now.toString(36).toUpperCase()}`
  db.insert(tables.pipelines).values({
    id, name: body.name.trim(), desc: body.desc ?? '', nodes: body.nodes ?? [],
    schedule: body.schedule ?? '手动', status: '草稿', version: 1,
    ownerId: user.id, spaceId: space.id, createdAt: now, updatedAt: now,
  }).run()
  return c.json({ id })
})

/** 发布管道（草稿→已发布，版本 +1） */
p10plusRoutes.post('/pipelines/:id/publish', async (c) => {
  const user = c.get('user')
  const p = db.select().from(tables.pipelines).where(eq(tables.pipelines.id, c.req.param('id'))).get()
  if (!p) return c.json({ error: '管道不存在' }, 404)
  db.update(tables.pipelines).set({ status: '已发布', version: p.version + 1, updatedAt: Date.now() }).where(eq(tables.pipelines.id, p.id)).run()
  db.insert(tables.auditEvents).values({ id: `AE-${Date.now()}`, actor: user.name, action: '发布数据管道', target: p.name, createdAt: Date.now(), ip: '本地' }).run()
  return c.json({ ok: true, version: p.version + 1 })
})

/** 校验管道：检查节点配置完整性（真实规则，不伪造） */
p10plusRoutes.post('/pipelines/:id/validate', async (c) => {
  const p = db.select().from(tables.pipelines).where(eq(tables.pipelines.id, c.req.param('id'))).get()
  if (!p) return c.json({ error: '管道不存在' }, 404)
  const nodes = (p.nodes ?? []) as { id: string; type: string }[]
  const errors: string[] = []
  if (nodes.length === 0) errors.push('管道没有节点')
  if (!nodes.some((n) => n.type === 'source')) errors.push('缺少数据源节点')
  if (!nodes.some((n) => n.type === 'output' || n.type === 'sink')) errors.push('缺少输出节点')
  return c.json({ ok: errors.length === 0, errors, nodeCount: nodes.length })
})

/** 删除管道（连带清理其运行记录） */
p10plusRoutes.delete('/pipelines/:id', async (c) => {
  const id = c.req.param('id') as string
  const p = db.select().from(tables.pipelines).where(eq(tables.pipelines.id, id)).get()
  if (!p) return c.json({ error: '管道不存在' }, 404)
  const runs = db.select().from(tables.pipelineRuns).all().filter((r) => r.pipelineId === id)
  for (const r of runs) db.delete(tables.pipelineRuns).where(eq(tables.pipelineRuns.id, r.id)).run()
  db.delete(tables.pipelines).where(eq(tables.pipelines.id, id)).run()
  return c.json({ ok: true, deletedRuns: runs.length })
})

/** 运行管道：真实执行（统计对象数作为处理行数）+ 写运行记录 */
p10plusRoutes.post('/pipelines/:id/run', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const p = db.select().from(tables.pipelines).where(eq(tables.pipelines.id, c.req.param('id'))).get()
  if (!p) return c.json({ error: '管道不存在' }, 404)
  const t0 = Date.now()
  const rows = db.select().from(tables.objects).all().filter((o) => o.spaceId === space.id).length
  const runId = `RUN-${t0.toString(36).toUpperCase()}`
  db.insert(tables.pipelineRuns).values({
    id: runId, pipelineId: p.id, status: '成功', trigger: user.name === 'system' ? '定时' : '手动',
    durationMs: Date.now() - t0, rowsProcessed: rows, message: `扫描当前空间 ${rows} 个对象实例`,
    operator: user.name, spaceId: space.id, createdAt: t0,
  }).run()
  db.update(tables.pipelines).set({ status: '运行中', updatedAt: Date.now() }).where(eq(tables.pipelines.id, p.id)).run()
  return c.json({ ok: true, runId, rowsProcessed: rows })
})

/* ---------- 血缘（类型→对象→应用链路） ---------- */
p10plusRoutes.get('/lineage', (c) => {
  const space = c.get('space')
  const types = db.select().from(tables.objectTypes).all().filter((t) => t.spaceId === space.id)
  const linkTypes = db.select().from(tables.linkTypes).all().filter((l) => l.spaceId === space.id)
  const apps = db.select().from(tables.workshopApps).all().filter((a) => a.spaceId === space.id)
  const docs = db.select().from(tables.documents).all().filter((d) => d.spaceId === space.id)
  const objs = db.select().from(tables.objects).all().filter((o) => o.spaceId === space.id)

  return c.json({
    // 层次：数据源(对象类型) → 处理(链接类型) → 输出(Workshop应用) → 消费(知识文档)
    layers: {
      sources: types.map((t) => ({ id: t.id, name: t.name, type: 'source', count: objs.filter((o) => o.typeId === t.id).length, color: t.color })),
      processes: linkTypes.map((l) => ({ id: l.id, name: l.name, type: 'process', sourceId: l.sourceTypeId, targetId: l.targetTypeId })),
      outputs: apps.map((a) => ({ id: a.id, name: a.name, type: 'output', widgetCount: (a.widgets as unknown[]).length })),
      consumers: docs.map((d) => ({ id: d.id, name: d.title, type: 'consumer', chunks: d.chunkCount })),
    },
    // 应用依赖的对象类型
    appDependencies: apps.map((a) => {
      const widgets = a.widgets as { config?: { typeId?: string } }[]
      const typeIds = Array.from(new Set(widgets.map((w) => w.config?.typeId).filter(Boolean))) as string[]
      return {
        appName: a.name,
        dependentTypes: typeIds.map((tid) => ({
          typeId: tid,
          typeName: types.find((t) => t.id === tid)?.name ?? tid,
          objectCount: objs.filter((o) => o.typeId === tid).length,
        })),
      }
    }),
  })
})

/* ---------- Marketplace：目录由 PACKS 动态生成 + 真实安装计数 + 用户上架产品 ---------- */
p10plusRoutes.get('/marketplace', (c) => {
  const space = c.get('space')
  const allSpaces = db.select().from(tables.spaces).all()
  // 真实安装次数：某模板包被多少个空间作为 templatePack 采用（不再写死 128/356）
  const installCountOf = (packId: string) => allSpaces.filter((s) => s.templatePack === packId).length
  const installedPackIds = new Set(allSpaces.map((s) => s.templatePack).filter(Boolean))

  // 1. 内置模板包：全部从 PACKS 派生，字段真实计数
  const builtins = PACKS.map((p) => ({
    id: p.id, name: p.name, category: p.suitKinds.includes('personal') || p.suitKinds.includes('family') ? '个人' : '行业模板',
    desc: p.desc, typeCount: p.types.length, linkCount: p.links.length, actionCount: p.actions.length,
    installed: installedPackIds.has(p.id), installCount: installCountOf(p.id), builtin: true, version: '1.0.0',
  }))
  // 2. 用户上架产品（marketplace_products 表，真实落库）
  const listed = db.select().from(tables.marketplaceProducts).all()
    .filter((p) => p.spaceId === space.id || p.spaceId === '')
    .map((p) => ({
      id: p.id, name: p.name, category: p.category, desc: p.desc,
      typeCount: 0, linkCount: 0, actionCount: 0,
      installed: false, installCount: p.installCount, builtin: false, version: p.version,
    }))
  return c.json({ products: [...builtins, ...listed], installed: installedPackIds.size })
})

/** 上架产品（真实写 marketplace_products 表） */
p10plusRoutes.post('/marketplace/products', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const body = await c.req.json<{ name: string; desc?: string; category?: string; refId?: string; version?: string }>().catch((): { name: string; desc?: string; category?: string; refId?: string; version?: string } => ({ name: '' }))
  if (!body.name?.trim()) return c.json({ error: '请填写产品名称' }, 400)
  const now = Date.now()
  const id = `MP-${now.toString(36).toUpperCase()}`
  db.insert(tables.marketplaceProducts).values({
    id, name: body.name.trim(), desc: body.desc ?? '', category: body.category ?? '模板包',
    refId: body.refId ?? '', version: body.version ?? '1.0.0', publisher: user.name,
    installCount: 0, spaceId: space.id, createdAt: now, updatedAt: now,
  }).run()
  return c.json({ id })
})

/** 删除已上架产品 */
p10plusRoutes.delete('/marketplace/products/:id', async (c) => {
  const id = c.req.param('id')
  const row = db.select().from(tables.marketplaceProducts).where(eq(tables.marketplaceProducts.id, id)).get()
  if (!row) return c.json({ error: '产品不存在' }, 404)
  db.delete(tables.marketplaceProducts).where(eq(tables.marketplaceProducts.id, id)).run()
  return c.json({ ok: true })
})
