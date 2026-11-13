/**
 * OntoOS 全功能验证数据集 · 一键装载
 *
 * 用法（先 npm run dev 启动服务）：
 *   node demo-data/load.mjs            # 装载（幂等：重复运行不会产生重复数据）
 *   node demo-data/load.mjs --clean    # 仅清理本脚本产生的 DEMO_ 数据
 *
 * 通过真实 HTTP API 装载（与用户操作路径一致）；无 API 的实体（通知/审批/术语认证等）
 * 用只读直连主库补充。所有数据统一 DEMO_ 前缀，便于识别与清理。
 * 覆盖模块：对象/本体/动作审批/知识/分析/应用/AIP/治理/管理/外部数据源/扫描。
 */
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

const BASE = process.env.BASE_URL || 'http://localhost:5000'
const ACCOUNT = process.env.ACCOUNT || 'chen.xingye'
const PASSWORD = process.env.PASSWORD || 'ontos@2026'
const TAG = 'DEMO_'
const CLEAN = process.argv.includes('--clean')
const ROOT = path.resolve(process.cwd())
const db = new Database(path.join(ROOT, 'data', 'ontoos.db'))
const ORG = 'sp-org-default'
const PERSONAL = 'sp-personal-U-0001'

let token = ''
const summary = []
function H(space = ORG) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-space-id': space }
}
async function api(method, url, body, space = ORG, expect = 200) {
  try {
    const r = await fetch(BASE + url, {
      method, headers: H(space),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    })
    const j = await r.json().catch(() => ({}))
    return { ok: r.status === expect, status: r.status, data: j }
  } catch (e) { return { ok: false, status: 0, data: { error: e.message } } }
}
function ok(label, r, extra = '') { summary.push({ label, ok: r.ok, detail: r.ok ? extra : `HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 120)}` }) }
function raw(sql, ...args) { return db.prepare(sql).all(...args) }
function run(sql, ...args) { return db.prepare(sql).run(...args) }

/* ---------------- 清理 ---------------- */
function cleanData() {
  const before = raw(`SELECT count(*) c FROM objects WHERE "values" LIKE ?`, `%${TAG}%`)[0].c
  // 对象
  const ids = raw(`SELECT id FROM objects WHERE "values" LIKE ?`, `%${TAG}%`).map((r) => r.id)
  for (const id of ids) {
    run('DELETE FROM object_links WHERE source_id=? OR target_id=?', id, id)
    run('DELETE FROM doc_links WHERE object_id=?', id)
    run('DELETE FROM objects WHERE id=?', id)
  }
  // 函数版本先按 DEMO_ 函数的 id 清理（版本表自身 name 无前缀，须在函数删除前查）
  const demoFnIds = raw(`SELECT id FROM ontology_functions WHERE name LIKE ?`, `${TAG}%`).map((r) => r.id)
  for (const fid of demoFnIds) { try { run('DELETE FROM function_versions WHERE function_id=?', fid) } catch { /* ignore */ } }
  // 模块 3-6：真实时序点 / 治理执行记录 / 排程任务 / 部署记录（本脚本产生）
  try { run(`DELETE FROM ts_points WHERE metric LIKE ?`, `${TAG}%`) } catch { /* ignore */ }
  try { run(`DELETE FROM governance_runs`) } catch { /* ignore */ }
  try { run(`DELETE FROM schedule_tasks`) } catch { /* ignore */ }
  try { run(`DELETE FROM deployments WHERE message LIKE ?`, `${TAG}%`) } catch { /* ignore */ }
  // 其它 DEMO_ 实体（注意顺序：先删引用方，再删被引用的类型/链接，避免外键约束阻止删除）
  for (const [table, col] of [
    ['documents', 'title'], ['approvals', 'title'], ['automation_rules', 'name'],
    ['workshop_apps', 'name'], ['reports', 'title'], ['pipelines', 'name'],
    ['interface_types', 'name'], ['ontology_terms', 'term'],
    ['data_connections', 'name'], ['scan_templates', 'name'], ['cipher_rules', 'name'],
    ['scan_findings', 'table_name'], ['lifecycle_policies', 'name'],
    ['model_registrations', 'name'], ['api_keys', 'name'], ['marketplace_products', 'name'],
    ['repo_files', 'path'], ['pipeline_runs', 'operator'],
    ['ontology_functions', 'name'], ['action_types', 'name'], ['link_types', 'name'],
    ['object_types', 'name'], ['notifications', 'title'],
    // 第 3 批新表：函数版本按 functionId 关联、探索/派生/场景/治理/排程/部署按 name 或 target 清
    ['saved_explorations', 'name'], ['derived_properties', 'name'], ['ontology_scenarios', 'name'],
    ['governance_runs', 'target'], ['schedule_tasks', 'batch'], ['deployments', 'message'],
  ]) {
    try { run(`DELETE FROM ${table} WHERE ${col} LIKE ?`, `${TAG}%`) } catch { /* 表/列不存在则跳过 */ }
  }
  // 兜底：按 id 精确清掉 DEMO_ 类型的残留引用（链接/动作/函数可能以 sourceTypeId 引用它，name 不带前缀）
  const demoTypeIds = raw(`SELECT id FROM object_types WHERE name LIKE ?`, `${TAG}%`).map((r) => r.id)
  for (const tid of demoTypeIds) {
    try { run('DELETE FROM action_types WHERE target_type_id=?', tid) } catch { /* ignore */ }
    try { run('DELETE FROM link_types WHERE source_type_id=? OR target_type_id=?', tid, tid) } catch { /* ignore */ }
    try { run('DELETE FROM objects WHERE type_id=?', tid) } catch { /* ignore */ }
    try { run('DELETE FROM object_types WHERE id=?', tid) } catch { /* ignore */ }
  }
  run(`DELETE FROM audit_events WHERE target LIKE ? AND created_at > ?`, `${TAG}%`, Date.now() - 30 * 86400_000)
  // AIP Logic 历史同名工作流去重（旧版每次装载都新建，界面下拉曾堆积 20+ 同名项）
  try {
    for (const row of raw(`SELECT key, value FROM settings WHERE key LIKE 'logic_workflows_%'`)) {
      const data = (() => { try { return JSON.parse(String(row.value)) } catch { return {} } })()
      const list = Array.isArray(data.workflows) ? data.workflows : []
      const seen = new Map()
      for (const w of list) { if (w && w.name) seen.set(w.name, w) } // 同名保留最后一条
      const merged = Array.from(seen.values())
      if (merged.length !== list.length) {
        run('UPDATE settings SET value=? WHERE key=?', JSON.stringify({ workflows: merged }), row.key)
        console.log(`  AIP Logic 工作流去重: ${list.length} → ${merged.length}`)
      }
    }
  } catch { /* 表不存在则跳过 */ }
  console.log(`清理完成：DEMO_ 对象 ${before} 条及其它实体`)
  return before
}
if (CLEAN) { cleanData(); db.close(); process.exit(0) }
// 装载前先清理，保证幂等（重复运行不叠加）
cleanData()

/* ---------------- 0. 登录 ---------------- */
{
  const r = await api('POST', '/api/auth/login', { account: ACCOUNT, password: PASSWORD }, ORG, 200)
  if (!r.data?.token) { console.error('登录失败：', r.data); db.close(); process.exit(1) }
  token = r.data.token
  console.log(`登录成功：${r.data.user?.name} / 默认空间 ${ORG}`)
}

/* ---------------- 1. 本体建模（对象/链接/动作/函数/接口/术语） ---------------- */
{
  // 新建一个演示对象类型（带 4 种属性 + enum）
  const t = await api('POST', '/api/ontology/types', {
    name: `${TAG}演示资产`, apiName: 'DemoAsset', desc: '全功能验证数据集专用类型',
    color: '#0ea5e9', icon: 'Boxes',
    properties: [
      { key: 'title', name: '名称', type: 'string', required: true },
      { key: 'value', name: '价值', type: 'number' },
      { key: 'level', name: '等级', type: 'enum', enumValues: ['A', 'B', 'C'] },
      { key: 'memo', name: '备注', type: 'string' },
    ],
  })
  // POST /ontology/types 返回 { type: {...} }；409（同名已存在）时复用已有类型，保证幂等
  let typeId = t.data?.type?.id
  if (!t.ok && t.status === 409) {
    const list = (await api('GET', '/api/ontology/types')).data?.types ?? []
    typeId = list.find((x) => x.name === `${TAG}演示资产`)?.id
  }
  ok('本体·新建/复用对象类型', { ok: !!typeId, status: t.status, data: t.data }, typeId || '')

  // 链接类型 + 动作类型 + 函数 + 接口
  ok('本体·新建链接类型', await api('POST', '/api/ontology/links', {
    name: `${TAG}资产关联工单`, sourceTypeId: typeId || 'device', targetTypeId: 'ticket', cardinality: '1:N', desc: '演示链接',
  }))
  ok('本体·新建动作类型', await api('POST', '/api/ontology/actions', {
    name: `${TAG}登记资产`, targetTypeId: typeId || 'device', needsApproval: false, desc: '演示动作',
    params: [{ key: 'objectId', name: '目标对象', type: 'string', required: true }, { key: 'comment', name: '说明', type: 'string' }],
    effect: { kind: 'update', setValues: {} },
  }))
  ok('本体·新建函数', await api('POST', '/api/ontology/functions', {
    name: `${TAG}演示计算`, desc: '演示用函数登记', lang: 'TypeScript', linkedTypeIds: [typeId || 'device'],
  }))
  const iface = await api('POST', '/api/ontology/interfaces', {
    name: `${TAG}可估值资产`, desc: '演示接口契约',
    properties: [{ key: 'title', name: '名称', type: 'string' }, { key: 'value', name: '价值', type: 'number' }],
    implementedBy: [typeId || 'device'],
  })
  ok('本体·新建接口', iface, iface.data?.id || '')
  if (iface.data?.id) ok('本体·接口符合性校验', await api('GET', `/api/ontology/interfaces/${iface.data.id}/check`))

  // 业务术语（同义词 + 认证指标）
  const term = await api('POST', '/api/ontology/terms', {
    term: `${TAG}资产总值`, synonyms: [`${TAG}资产总额`, `${TAG}家底`],
    typeId: typeId || 'device', propertyKey: 'value',
    definition: '演示资产的价值合计', metricExpr: 'SUM(DemoAsset.value)', certified: true,
  })
  ok('语义层·认证术语', term, term.data?.id || '')
  ok('语义层·解析预检', await api('GET', `/api/ontology/terms/resolve?q=${encodeURIComponent(TAG + '家底')}`))
}

/* ---------------- 2. 对象数据（每个主要类型补几行 DEMO_ 数据） ---------------- */
{
  const types = (await api('GET', '/api/ontology/types')).data?.types ?? []
  const plan = [
    ['device', (i) => ({ code: `${TAG}EQ-${i}`, name: `${TAG}设备 ${i}`, type: '注塑机', health: 50 + i * 7, status: i % 2 ? '运行' : '停机', downtime: i * 3.5, factory: '佛山 F2' })],
    ['ticket', (i) => ({ no: `${TAG}GD-${3000 + i}`, device: `${TAG}EQ-1`, priority: ['P0', 'P1', 'P2'][i % 3], fault: '演示故障', status: ['待派单', '处理中', '已关闭'][i % 3], owner: '李维修', hours: i * 2 })],
    ['customer', (i) => ({ code: `${TAG}CU-${i}`, name: `${TAG}客户 ${i}`, industry: ['汽车', '医疗器械', '新能源'][i % 3], grade: '优选', contact: '陈星野', phone: '138****0000' })],
    ['order', (i) => ({ no: `${TAG}SO-${2700 + i}`, customer: `${TAG}客户 1`, amount: 10000 * (i + 1), status: '已付款', date: `2026-11-0${(i % 9) + 1}`, owner: '周计划' })],
    ['factory', (i) => ({ code: `${TAG}F${i}`, name: `${TAG}工厂 ${i}`, city: '广东·佛山', devices: 100 + i * 10, oee: `${80 + i}%` })],
  ]
  let created = 0
  for (const [tid, gen] of plan) {
    if (!types.some((t) => t.id === tid)) continue
    for (let i = 1; i <= 4; i++) {
      const r = await api('POST', '/api/objects', { typeId: tid, values: gen(i) })
      if (r.ok) created++
    }
  }
  ok('对象数据·批量实例', { ok: created >= 15 }, `新增 ${created} 个实例`)

  // 个人空间支出数据（消费分析）
  const expenses = [
    ['午餐', 28, '2026-11-01', '餐饮', '星辰便利店', '微信'],
    ['地铁', 6, '2026-11-02', '交通', '广佛地铁', '支付宝'],
    ['房租', 3200, '2026-11-05', '居住', '自如公寓', '银行卡'],
    ['超市采购', 155, '2026-11-08', '购物', '星辰超市', '支付宝'],
    ['电影', 45, '2026-10-25', '娱乐', '万达影城', '微信'],
    ['体检', 560, '2026-09-20', '医疗', '美年健康', '银行卡'],
  ]
  let pc = 0
  for (const [title, amount, date, category, merchant, payment] of expenses) {
    const r = await api('POST', '/api/objects', { typeId: 'expense', values: { title: `${TAG}${title}`, amount, date, category, merchant, payment } }, PERSONAL)
    if (r.ok) pc++
  }
  ok('个人空间·消费数据', { ok: pc === 6 }, `${pc} 条`)
  // 消费明细（expense_item）+ 链接
  const items = await api('POST', '/api/scan/commit', {
    typeId: 'expense',
    values: { title: `${TAG}扫描小票`, amount: 40, date: '2026-11-08', category: '餐饮', merchant: '星辰便利店', payment: '微信',
      items: [{ name: `${TAG}可乐`, qty: 2, unitPrice: 6, amount: 12, category: '餐饮' }, { name: `${TAG}盒饭`, qty: 1, unitPrice: 28, amount: 28, category: '餐饮' }] },
    itemTypeId: 'expense_item',
  }, PERSONAL)
  ok('扫描·明细落地', items, `itemCount=${items.data?.itemCount}`)
}

/* ---------------- 3. 动作 / 审批 / 审计 ---------------- */
{
  // 用一个需审批动作发起（找现有 needsApproval 动作）
  const acts = (await api('GET', '/api/actions')).data?.actions ?? []
  const target = (await api('GET', '/api/objects?type=device&limit=1')).data?.objects?.[0]
  const need = acts.find((a) => a.needsApproval)
  if (need && target) {
    const ex = await api('POST', `/api/actions/${encodeURIComponent(need.id)}/execute`, { params: { objectId: target.id, comment: `${TAG}演示审批` } })
    ok('动作·发起需审批动作', ex, ex.data?.status || '')
    if (ex.data?.approvalId) {
      const d = await api('POST', `/api/actions/approvals/${encodeURIComponent(ex.data.approvalId)}/decide`, { decision: 'approve', comment: `${TAG}通过` })
      ok('审批·通过并写回', d, d.data?.status || '')
    }
  } else ok('动作·发起需审批动作', { ok: false, status: 0, data: { error: '无可用需审批动作或目标对象' } })
  ok('审计·留痕可查', await api('GET', '/api/admin/audit?limit=5'))
}

/* ---------------- 4. 知识层（文档入库 / 检索 / 抽取候选） ---------------- */
{
  const d = await api('POST', '/api/knowledge/docs', {
    title: `${TAG}设备维护手册`, category: '设备手册', format: 'TXT',
    content: '注塑机 F2-IM-2041 的液压系统每 2000 小时需更换油封 HS-2041-03；油温超过 55 摄氏度时必须检查冷却系统。维修工单 GD-2291 记录了该设备的液压泄漏处置流程，责任人是李维修。',
  })
  ok('知识·文档入库分块', d, `chunks=${d.data?.chunks} mode=${d.data?.mode}`)
  ok('知识·混合检索', await api('GET', `/api/knowledge/search?q=${encodeURIComponent('液压系统')}`))
  ok('知识·抽取候选', await api('GET', '/api/extract/candidates'))
}

/* ---------------- 5. 自动化 / 通知 ---------------- */
{
  const r = await api('POST', '/api/automations/rules', {
    name: `${TAG}设备健康度告警`, trigger: { kind: 'threshold', typeId: 'device', field: 'health', op: '<', value: 60 },
    condition: '健康度 < 60', actions: [{ kind: 'notify', config: { message: `${TAG}健康度低于阈值` } }],
  })
  ok('自动化·规则（含条件表达式）', r, r.data?.id || '')
  ok('通知中心·真实列表', await api('GET', '/api/automations/notifications'))
}

/* ---------------- 6. 应用：Workshop / 报告 / 管道 / 市场 ---------------- */
{
  const w = await api('POST', '/api/workshop', { name: `${TAG}演示看板`, desc: '全功能验证', widgets: [{ id: 'w1', type: 'stat', config: { typeId: 'device', title: '设备数', aggregation: 'count' } }] })
  ok('Workshop·应用与组件绑定', w, w.data?.id || '')
  const rep = await api('POST', '/api/p10/notepad/reports', { title: `${TAG}运营月报`, content: '本月设备运行平稳，注塑机 F2-IM-2041 完成液压系统检修，累计停机 47.5 小时，已生成维修工单并闭环。', status: 'published' })
  ok('Notepad·发布报告', rep, rep.data?.status || '')
  const pl = await api('POST', '/api/p10plus/pipelines', { name: `${TAG}演示管道`, nodes: [{ id: 'n1', type: 'source', config: {} }, { id: 'n2', type: 'output', config: {} }] })
  ok('管道·新建', pl, pl.data?.id || '')
  if (pl.data?.id) {
    ok('管道·校验', await api('POST', `/api/p10plus/pipelines/${pl.data.id}/validate`))
    ok('管道·发布', await api('POST', `/api/p10plus/pipelines/${pl.data.id}/publish`))
    ok('管道·运行', await api('POST', `/api/p10plus/pipelines/${pl.data.id}/run`))
  }
  ok('Marketplace·上架产品', await api('POST', '/api/p10plus/marketplace/products', { name: `${TAG}演示模板包`, category: '模板包', version: '1.0.0' }))
}

/* ---------------- 7. AIP：Logic 工作流 / Agent / 会话 ---------------- */
{
  // 工作流 1：线性四节点（旧版兼容形态），带坐标
  const linearSteps = [
    { id: 's1', type: 'input', label: '输入数据', outputFormat: '对象集/文本', x: 40, y: 60 },
    { id: 's2', type: 'llm', label: 'LLM 分析', prompt: '分析设备数据并给出置信度', model: 'auto', x: 270, y: 60 },
    { id: 's3', type: 'condition', label: '置信度判断', condition: '置信度 > 0.8', x: 500, y: 60 },
    { id: 's4', type: 'output', label: '输出结果', outputFormat: '结构化 JSON', x: 730, y: 60 },
  ]
  const wf1 = await api('POST', '/api/logic/workflows', { name: `${TAG}线性分析工作流`, steps: linearSteps })
  ok('AIP Logic·线性工作流持久化', wf1, wf1.data?.id || '')

  // 工作流 2：条件分支双出口（nextYes / nextNo 指向不同节点，画布自动画两条着色连线）
  const branchSteps = [
    { id: 's1', type: 'input', label: '输入数据', outputFormat: '设备告警文本', x: 40, y: 60 },
    { id: 's2', type: 'condition', label: '健康度判断', condition: '健康度 > 60', x: 280, y: 60, nextYes: 's3', nextNo: 's4' },
    { id: 's3', type: 'output', label: '自动归档', outputFormat: '正常设备清单', x: 540, y: 20 },
    { id: 's4', type: 'output', label: '人工复核', outputFormat: '待复核工单', x: 540, y: 150 },
  ]
  const wf2 = await api('POST', '/api/logic/workflows', { name: `${TAG}分支复核工作流`, steps: branchSteps })
  ok('AIP Logic·分支工作流持久化(含 nextYes/nextNo)', wf2, wf2.data?.id || '')

  // 幂等校验：重复 POST 同名工作流不新增（后端按同名合并）
  const before = (await api('GET', '/api/logic/workflows')).data?.workflows ?? []
  await api('POST', '/api/logic/workflows', { name: `${TAG}分支复核工作流`, steps: branchSteps })
  const after = (await api('GET', '/api/logic/workflows')).data?.workflows ?? []
  const nameCount = after.filter((w) => w.name === `${TAG}分支复核工作流`).length
  const idempotent = wf2.ok && before.length === after.length && nameCount === 1
  ok('AIP Logic·同名装载幂等(不叠加)', { ok: idempotent, status: idempotent ? 200 : 500, data: {} }, `before=${before.length} after=${after.length} 同名=${nameCount}`)

  // 保存校验：空节点 / 分支目标不存在 → 400
  ok('AIP Logic·空节点保存被拒(400)', await api('POST', '/api/logic/workflows', { name: `${TAG}非法工作流`, steps: [] }, ORG, 400))
  ok('AIP Logic·分支目标不存在被拒(400)', await api('POST', '/api/logic/workflows', { name: `${TAG}非法工作流`, steps: [{ id: 's1', type: 'condition', label: '条件', condition: 'x > 1', nextYes: 'NO_SUCH_NODE' }] }, ORG, 400))

  // 分支执行：健康度 62 > 60 → 走「自动归档」（结果里出现该节点，不出现人工复核）
  if (wf2.data?.id) {
    const run = await api('POST', `/api/logic/workflows/${wf2.data.id}/run`, { input: '设备 F2-IM-2041 健康度 62' })
    const stepsRun = (run.data?.results ?? []).map((r) => r.step)
    const branchOk = run.ok && stepsRun.includes('自动归档') && !stepsRun.includes('人工复核')
    ok('AIP Logic·分支执行(健康度62→自动归档)', { ok: branchOk, status: branchOk ? 200 : run.status, data: run.data }, stepsRun.join('→'))
  }
  // 预设模板：产品内置、列表可见、离线确定性模板直接跑出结果
  const allWf = (await api('GET', '/api/logic/workflows')).data?.workflows ?? []
  const presets = allWf.filter((w) => w.preset)
  ok('AIP Logic·预设模板库可见(5 个)', { ok: presets.length === 5, status: presets.length === 5 ? 200 : 500, data: {} }, `presets=${presets.length}`)

  // 逐个运行 3 个离线模板（不依赖 AI 网关，确定性结果）
  const presetCases = [
    { id: 'PRESET-DEVICE-TRIAGE', input: '设备 F2-IM-2041 健康度 42，已停机 47.5 小时', expect: '转维修复核', notExpect: '自动归档' },
    { id: 'PRESET-TICKET-ROUTE', input: '紧急：注塑机主轴故障停机，需立即处理', expect: '优先处理', notExpect: '常规排队' },
    { id: 'PRESET-ORDER-TIER', input: '订单 SO-2026-1188 金额 820000 元', expect: '大客户跟进', notExpect: '常规履约' },
  ]
  for (const pc of presetCases) {
    const run = await api('POST', `/api/logic/workflows/${pc.id}/run`, { input: pc.input }, ORG, 200, 20000)
    const stepsRun = (run.data?.results ?? []).map((r) => r.step)
    const okRun = run.ok && stepsRun.includes(pc.expect) && !stepsRun.includes(pc.notExpect)
    ok(`AIP Logic·预设直接运行「${pc.id}」`, { ok: okRun, status: okRun ? 200 : run.status, data: run.data }, stepsRun.join('→'))
  }

  const ag = await api('POST', '/api/aip/agents', { name: `${TAG}演示助手`, desc: '全功能验证 Agent', tools: ['ontology_overview', 'query_objects'], guardrail: { maskSensitive: true, requireApprovalForActions: true } })
  ok('Agent Studio·新建 Agent', ag, ag.data?.id || '')
  ok('AIP·助手会话', await api('POST', '/api/ai/conversations', { title: `${TAG}演示会话` }))
}

/* ---------------- 8. 治理 / 管理 ---------------- */
{
  ok('治理·脱敏规则', await api('POST', '/api/gov/cipher-rules', { name: `${TAG}手机号掩码`, pattern: '1[3-9]\\d{9}', action: '掩码' }))
  ok('治理·扫描发现', await api('POST', '/api/gov/scan-findings', { table: `${TAG}_mock_table`, field: 'phone', sensitiveType: '手机号' }))
  ok('治理·生命周期策略', await api('POST', '/api/gov/lifecycle-policies', { name: `${TAG}日志保留`, retention: '180 天', legal: '合规要求' }))
  ok('模型·多模型注册', await api('POST', '/api/gov/models', { name: `${TAG}演示模型`, type: '对话', quota: 10000 }))
  ok('用户组·新建', await api('POST', '/api/roles/groups', { name: `${TAG}演示组`, desc: '全功能验证' }))
  ok('代码资产·登记', await api('POST', '/api/data-layer/repo', { path: `${TAG}demo.ts`, lang: 'typescript', content: 'export const demo = 1', branch: 'main' }))
  ok('识别模板·自定义', await api('POST', '/api/scan/templates', { name: `${TAG}演示模板`, fieldMapping: { 合计: 'amount' }, matchKeywords: ['演示'] }))
}

/* ---------------- 9. 外部数据源（真实连接 + 同步） ---------------- */
{
  const c = await api('POST', '/api/data-layer/connections', {
    name: `${TAG}外部企业库`, type: 'SQLite', database: 'demo-data/external/enterprise.db',
  })
  ok('外部数据源·登记连接', c, c.data?.id || '')
  if (c.data?.id) {
    const t = await api('POST', `/api/data-layer/connections/${c.data.id}/test`)
    ok('外部数据源·真实探测', t, `tables=${t.data?.tableCount}`)
    ok('外部数据源·表预览', await api('GET', `/api/data-layer/connections/${c.data.id}/tables/equipment/preview`))
    const s = await api('POST', `/api/data-layer/connections/${c.data.id}/sync`, { table: 'equipment', typeId: 'device' })
    ok('外部数据源·同步为对象', s, `created=${s.data?.created} skipped=${s.data?.skipped}`)
  }
}

/* ---------------- 10. 扫描素材（复制一份到 files/ 便于上传） ---------------- */
{
  const src = path.join(ROOT, 'tests', 'fixtures', 'images', '01-receipt-convenience.png')
  const dst = path.join(ROOT, 'demo-data', 'files', 'receipt-demo.png')
  if (fs.existsSync(src)) { fs.copyFileSync(src, dst); ok('扫描素材·示例小票', { ok: true }, 'demo-data/files/receipt-demo.png') }
  else ok('扫描素材·示例小票', { ok: false, status: 0, data: {} })
}

/* ---------------- 11. 本体函数可执行化（模块1） ---------------- */
{
  // 复用第 1 节已建的 DEMO_ 函数（slug 同名会 409，不再新建），走完整版本闭环
  const fnList = (await api('GET', '/api/ontology/functions')).data?.functions ?? []
  const fn = fnList.find((f) => f.name?.startsWith(TAG))?.id
  if (fn) {
    const body = 'function main(input) { return { sum: (input.a || 0) + (input.b || 0), label: "DEMO_OK" } }'
    const v = await api('POST', `/api/fn/functions/${fn}/versions`, { body, testInput: { a: 3, b: 4 } })
    ok('函数·新建版本（自动测试）', v, v.data?.version?.version ? `v${v.data.version.version} testOutput=${String(v.data.version.testOutput).slice(0, 60)}` : '')
    const vers = await api('GET', `/api/fn/functions/${fn}/versions`)
    const v1 = (vers.data?.versions ?? [])[0]
    if (v1) {
      ok('函数·版本列表', vers, `${vers.data.versions.length} 个版本`)
      ok('函数·发布版本', await api('POST', `/api/fn/functions/${fn}/versions/${v1.id}/publish`))
      const run = await api('POST', `/api/fn/functions/${fn}/run`, { input: { a: 10, b: 20 } })
      ok('函数·沙箱真实执行 run', { ok: run.ok && run.data?.ok === true && run.data?.result?.sum === 30 }, `sum=${run.data?.result?.sum} dur=${run.data?.durationMs}ms`)
    } else ok('函数·版本列表', { ok: false, status: 0, data: {} }, '未取到版本')
  } else ok('函数·新建', { ok: false, status: 0, data: {} }, '未取到函数 id')
}

/* ---------------- 12. Object Explorer 高级（模块2） ---------------- */
{
  const EX = '/api/explorations/explorations'   // 前端/后端约定的 prefixed 路径
  const exp = await api('POST', EX, { name: `${TAG}高价值设备探索`, typeId: 'device', filters: [{ key: 'health', op: 'gt', value: '80' }], sort: 'health' })
  ok('探索·新建保存的探索', exp, exp.data?.exploration?.id || '')
  if (exp.data?.exploration?.id) {
    ok('探索·运行真实过滤', await api('POST', `${EX}/${exp.data.exploration.id}/run`))
  }
  // 对象集比较
  const devs = (await api('GET', '/api/objects?type=device&limit=5')).data?.objects ?? []
  const ids = devs.map((o) => o.id)
  const cmp = await api('POST', '/api/explorations/compare', { a: ids.slice(0, 2), b: ids.slice(1, 3) })
  ok('探索·对象集比较', cmp, `onlyA=${cmp.data?.onlyA?.length} both=${cmp.data?.both?.length}`)
  // 派生属性
  const dp = await api('POST', '/api/explorations/derived', { typeId: 'device', key: 'healthPct', name: '健康度百分比', expr: 'v.health' })
  ok('探索·新建派生属性', dp, dp.data?.derived?.id || '')
  if (dp.data?.derived?.id) ok('探索·派生属性真实计算', await api('POST', `/api/explorations/derived/${dp.data.derived.id}/eval`))
  // 场景：新建 → 暂存 → 合并（真实写 objects）
  const scn = await api('POST', '/api/explorations/scenarios', { name: `${TAG}演示场景`, desc: '暂存一次新建再合并' })
  ok('场景·新建', scn, scn.data?.scenario?.id || '')
  if (scn.data?.scenario?.id) {
    const sid = scn.data.scenario.id
    ok('场景·暂存变更', await api('POST', `/api/explorations/scenarios/${sid}/change`, { op: 'create', typeId: 'device', values: { code: `${TAG}SCN-001`, name: `${TAG}场景设备`, type: '注塑机', health: 92, status: '运行', downtime: 0 } }))
    ok('场景·合并真实写对象', await api('POST', `/api/explorations/scenarios/${sid}/merge`))
  }
}

/* ---------------- 13. 模块3：真实时序采集 + 治理执行 ---------------- */
{
  // 从对象批量采集真实 ts_points（health 值）
  const c = await api('POST', '/api/ops/timeseries/collect-from-objects', { metric: 'DEMO_health', valueKey: 'health' })
  ok('时序·从对象批量真实采集', c, `collected=${c.data?.collected ?? c.data?.inserted ?? '?'}`)
  ok('时序·真实序列查询', await api('GET', '/api/ops/timeseries/series?metric=DEMO_health'))
  // 治理执行三件套
  ok('治理·真实敏感扫描', await api('POST', '/api/ops/governance/scan', { writeBack: true }))
  ok('治理·脱敏预览', await api('POST', '/api/ops/governance/mask'))
  ok('治理·生命周期到期检查', await api('POST', '/api/ops/governance/lifecycle'))
  ok('治理·执行记录', await api('GET', '/api/ops/governance/runs'))
}

/* ---------------- 14. 模块4：CSV/JSON 文件型外部数据源 ---------------- */
{
  // CSV → 支出在个人空间，整段用个人空间头（连接与同步须同空间）
  const pcall = (method, url, body) => fetch(BASE + url, {
    method, headers: { ...H(PERSONAL), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (x) => ({ ok: x.status === 200, status: x.status, data: await x.json().catch(() => ({})) })).catch(() => ({ ok: false, status: 0, data: {} }))
  const c = await pcall('POST', '/api/data-layer/connections', { name: `${TAG}CSV数据源`, type: 'CSV', database: 'demo-data/files/expenses.csv' })
  ok('文件源·登记 CSV 连接', c, c.data?.id || '')
  if (c.data?.id) {
    const id = c.data.id
    ok('文件源·真实解析', await pcall('POST', `/api/data-layer/connections/${id}/test-file`))
    ok('文件源·列与样本预览', await pcall('GET', `/api/data-layer/connections/${id}/file-preview`))
    ok('文件源·CSV 同步为支出对象', await pcall('POST', `/api/data-layer/connections/${id}/sync-file`, { table: 'csv', typeId: 'expense' }))
  }
  const j = await api('POST', '/api/data-layer/connections', { name: `${TAG}JSON数据源`, type: 'JSON', database: 'demo-data/files/devices.json' })
  ok('文件源·登记 JSON 连接', j, j.data?.id || '')
  if (j.data?.id) ok('文件源·JSON 多表清单', await api('GET', `/api/data-layer/connections/${j.data.id}/file-tables`))
}

/* ---------------- 15. 模块5：动态调度本地求解 ---------------- */
{
  ok('调度·生成演示任务', await api('POST', '/api/scheduling/seed'))
  const solve = await api('POST', '/api/scheduling/solve')
  ok('调度·真实启发式求解', solve, `placed=${solve.data?.placed} conflicts=${solve.data?.conflicts?.length}`)
  if (solve.data?.planId) ok('调度·应用方案', await api('POST', `/api/scheduling/apply/${solve.data.planId}`))
  ok('调度·真实指标', await api('GET', '/api/scheduling/metrics'))
  ok('调度·任务列表', await api('GET', '/api/scheduling/tasks'))
}

/* ---------------- 16. 模块6：Apollo 本地部署编排 ---------------- */
{
  ok('Apollo·生成部署历史', await api('POST', '/api/apollo/seed'))
  ok('Apollo·部署记录与统计', await api('GET', '/api/apollo/deployments'))
  ok('Apollo·冻结窗口规则', await api('GET', '/api/apollo/freeze-windows'))
  ok('Apollo·集群派生', await api('GET', '/api/apollo/clusters'))
  // 真实晋升与回滚（用列表里一条 dev 成功记录）
  const list = (await api('GET', '/api/apollo/deployments')).data?.deployments ?? []
  const dev = list.find((d) => d.env === 'dev' && d.status === '成功')
  if (dev) ok('Apollo·版本晋升', await api('POST', `/api/apollo/promote/${dev.id}`))
  const prod = list.find((d) => d.env === 'prod' && d.status === '成功')
  if (prod) ok('Apollo·回滚', await api('POST', `/api/apollo/rollback/${prod.id}`))
}

/* ---------------- 17. ChatBI v2 验证数据集：24 个月订单时序（季节波动 + 年增 18%） ---------------- */
{
  // 生成最近 24 个完整月（上个月往回推），每月 10-14 笔订单
  const SEASON = [0.85, 0.8, 0.95, 1.0, 1.05, 1.0, 0.9, 0.95, 1.1, 1.15, 1.3, 1.45] // 1-12 月季节因子（Q4 旺）
  const nowD = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const months = []
  for (let i = 24; i >= 1; i--) months.push(new Date(nowD.getFullYear(), nowD.getMonth() - i, 1)) // 24 个月前 → 上个月
  const insOrder = db.prepare('INSERT OR IGNORE INTO objects (id, type_id, "values", created_by, created_at, updated_at, space_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
  let inserted = 0
  const fill = db.transaction(() => {
    months.forEach((m, mi) => {
      const y = m.getFullYear(), mo = m.getMonth()
      const growth = Math.pow(1.18, mi / 12) // 年增 18%：最近月 vs 24 个月前 ≈ ×1.39，同比恒 +18%
      const total = Math.round(520000 * SEASON[mo] * growth * (0.97 + ((y * 12 + mo) % 7) / 100))
      const cnt = 10 + ((y * 12 + mo) % 5)
      let used = 0
      for (let s = 1; s <= cnt; s++) {
        const isLast = s === cnt
        const amt = isLast ? total - used : Math.round((total / cnt) * (0.72 + ((y * 12 + mo + s) % 7) * 0.09))
        if (!isLast) used += amt
        const day = 1 + (s * 7) % 25
        const date = `${y}-${pad(mo + 1)}-${pad(day)}`
        const dueMs = m.getTime() + (day - 1 + 30) * 86400_000
        const status = mi >= 22 ? (s % 3 === 0 ? '生产中' : '已发货') : '已完成'
        const id = `order:DEMO_SO_${y}${pad(mo + 1)}_${pad(s)}`
        inserted += insOrder.run(id, 'order', JSON.stringify({ no: `DEMO_SO_${y}${pad(mo + 1)}_${pad(s)}`, amount: amt, date, due: iso(new Date(dueMs)), status }), 'DEMO_ChatBI', m.getTime() + s * 3600_000, m.getTime() + s * 3600_000, ORG).changes
      }
    })
  })
  fill()
  summary.push({ label: 'ChatBI·24个月订单灌入(事务)', ok: inserted >= 24 * 10, detail: `${inserted} 条` })

  // ① 按月趋势：时间序列默认升序（趋势折线图数据）
  const trend = await api('GET', '/api/dashboard/aggregate?typeId=order&groupBy=date&metric=amount&bucket=month')
  const tg = trend.data?.groups ?? []
  const ascOk = tg.length >= 20 && tg.every((g, i) => i === 0 || g.name > tg[i - 1].name)
  summary.push({ label: 'ChatBI·按月趋势(时间升序)', ok: trend.ok && ascOk, detail: `groups=${tg.length}` })

  // ② 同比：上月 vs 去年同月（数据内置 +18% 增长，应显著为正）
  const mStart = new Date(nowD.getFullYear(), nowD.getMonth() - 1, 1)
  const mEnd = new Date(nowD.getFullYear(), nowD.getMonth(), 0)
  const win = `from=${iso(mStart)}&to=${iso(mEnd)}`
  const yoy = await api('GET', `/api/dashboard/aggregate?typeId=order&groupBy=date&metric=amount&bucket=month&${win}&compare=yoy`)
  const yc = yoy.data?.compare
  summary.push({ label: 'ChatBI·同比对比(+18%增长)', ok: yoy.ok && yc?.mode === 'yoy' && typeof yc.deltaPct === 'number' && yc.deltaPct > 5, detail: `本期${yc?.current?.sum} vs 去年同期${yc?.previous?.sum} = ${yc?.deltaPct}%` })

  // ③ 环比：上月 vs 上上月（紧邻等长窗口）
  const prev = await api('GET', `/api/dashboard/aggregate?typeId=order&groupBy=date&metric=amount&bucket=month&${win}&compare=prev`)
  const pc = prev.data?.compare
  summary.push({ label: 'ChatBI·环比对比(紧邻上期)', ok: prev.ok && pc?.mode === 'prev' && typeof pc.deltaPct === 'number', detail: `本期${pc?.current?.sum} vs 上一期${pc?.previous?.sum} = ${pc?.deltaPct}%` })

  // ④ TOP-N：按订单状态取金额前 3
  const top = await api('GET', '/api/dashboard/aggregate?typeId=order&groupBy=status&metric=amount&top=3')
  const tpg = top.data?.groups ?? []
  const topOk = top.ok && tpg.length >= 1 && tpg.length <= 3 && Number(top.data?.applied?.top) === 3 && tpg.every((g, i) => i === 0 || tpg[i - 1].sum >= g.sum)
  summary.push({ label: 'ChatBI·TOP-N 截取(按金额降序)', ok: topOk, detail: `top=${tpg.length} 组` })

  // ⑤ 二维交叉：订单 月份 × 状态 金额矩阵（单元格求和应等于行合计）
  const cross = await api('GET', `/api/dashboard/aggregate?typeId=order&groupBy=date&metric=amount&bucket=month&crossBy=status&from=${iso(new Date(nowD.getFullYear(), nowD.getMonth() - 24, 1))}&to=${iso(mEnd)}`)
  const cr = cross.data?.cross
  const rowCheck = cr ? cr.rows.every((row) => Math.abs(cr.columns.reduce((s, c2) => s + (row.cells[c2]?.sum ?? 0), 0) - row.rowSum) < 0.01) : false
  summary.push({ label: 'ChatBI·二维交叉矩阵(月×状态)', ok: cross.ok && !!cr && cr.rows.length >= 20 && cr.columns.includes('已完成') && rowCheck, detail: `${cr?.rows?.length} 行 × ${cr?.columns?.length} 列，单元格=行合计校验${rowCheck ? '通过' : '失败'}` })

  // ⑥ 设备类型 × 状态交叉（seed 数据即可验证）
  const cross2 = await api('GET', '/api/dashboard/aggregate?typeId=device&groupBy=type&crossBy=status')
  const cr2 = cross2.data?.cross
  summary.push({ label: 'ChatBI·设备类型×状态交叉', ok: cross2.ok && !!cr2 && cr2.rows.length >= 3 && cr2.columns.length >= 3, detail: `${cr2?.rows?.length} 行 × ${cr2?.columns?.length} 列` })
}

/* ---------------- 汇总 ---------------- */
console.log('\n=== 装载结果 ===')
for (const s of summary) console.log(`  ${s.ok ? '✓' : '✗'} ${s.label}${s.detail ? ' — ' + s.detail : ''}`)
const passed = summary.filter((s) => s.ok).length
console.log(`\n通过 ${passed}/${summary.length}`)
console.log('\n下一步：打开浏览器按 demo-data/FEATURE-MATRIX.md 逐项体验；')
console.log('       清理命令：node demo-data/load.mjs --clean')
db.close()
process.exit(passed === summary.length ? 0 : 1)
