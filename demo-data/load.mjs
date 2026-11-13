/**
 * OntoOS 全功能验证数据集 · 一键装载（真实业务命名）
 *
 * 用法（先 npm run dev 启动服务）：
 *   node demo-data/load.mjs            # 装载（幂等：重复运行不会产生重复数据）
 *   node demo-data/load.mjs --clean    # 仅清理本脚本产生的数据
 *
 * 场景：虚构企业「星辰智造集团」（珠三角注塑/CNC 制造，顺德/南海/禅城三大基地）。
 * 所有数据使用真实业务命名（SO- 订单号 / GD- 工单号 / 真实公司名 / 真实规程标题），
 * 不带演示前缀；清理依赖两重机制：
 *   ① settings 表的 load_manifest（本脚本写入：对象 id / 各实体名称 / 指标名）
 *   ② 静态名称清单 NAMES（与创建点共用，兜底清掉无 manifest 的历史装载）
 * 另保留 DEMO_ 前缀兜底清理，用于一次性迁出旧版演示数据。
 */
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

const BASE = process.env.BASE_URL || 'http://localhost:5000'
const ACCOUNT = process.env.ACCOUNT || 'chen.xingye'
const PASSWORD = process.env.PASSWORD || 'ontos@2026'
const TAG = 'DEMO_' // 仅用于清理历史旧数据，新数据不再使用该前缀
const CLEAN = process.argv.includes('--clean')
const ROOT = path.resolve(process.cwd())
const db = new Database(path.join(ROOT, 'data', 'ontoos.db'))
const ORG = 'sp-org-default'
const PERSONAL = 'sp-personal-U-0001'

/** 本脚本创建的全部实体名称（装载与清理共用同一份清单） */
const NAMES = {
  objectTypes: ['供应商评估记录'],
  linkTypes: ['评估记录关联工单'],
  actionTypes: ['登记供应商档案'],
  functions: ['设备OEE计算'],
  interfaces: ['可估值资产契约'],
  terms: ['设备资产总值'],
  documents: ['注塑机液压系统维护规程', 'CNC 主轴保养手册', '设备点检作业指导书', '车间安全生产条例', '模具入库验收规范'],
  automationRules: ['设备健康度低阈值告警'],
  workshopApps: ['设备运维监控台'],
  reports: ['2026年10月设备运营月报'],
  pipelines: ['ERP备件库存同步'],
  marketplace: ['连锁门店库存管理包'],
  workflows: ['设备停机标准处置流程', '采购申请分级审批流程'],
  machineryFlows: ['设备检修申请流程'],
  conversations: ['设备运维助理', '设备巡检问答'],
  cipherRules: ['客户手机号脱敏'],
  lifecyclePolicies: ['操作日志180天保留'],
  modelRegistrations: ['GLM-4-Flash对话模型'],
  userGroups: ['华南区设备运维组'],
  repoFiles: ['oeeCalculator.ts'],
  scanTemplates: ['快递面单识别'],
  connections: ['集团ERP备件库存库', '财务报销流水CSV', '设备台账导出JSON'],
  explorations: ['健康度80+优秀设备清单'],
  scenarios: ['Q4新增注塑机上线'],
  scanFindingTables: ['crm_customers'],
  metrics: ['health_daily'],
  /** 对象 id 前缀（ChatBI 订单直插用真实单号前缀） */
  objectIdPrefixes: ['order:SO-2'],
  /** 对象 values 包含标记（用于清掉随机 id 的 API 创建对象） */
  objectMarkers: ['F1-IM-210', 'F1-CN-210', 'F2-IM-210', 'F2-CN-210', 'F2-CN-220', 'F3-IM-3001', 'GD-2026-30', 'CU-080', 'SO-2026-27', '顺德注塑基地', '南海精密加工基地', '禅城装配基地', '东莞市瑞泰精密模具', '深圳市康诺电子科技', '惠州市联翔五金制品', '广州鹏程汽车零部件', '佛山恒力液压', '中山金鑫轴承', '东莞广泰密封件', '广州华顺电气'],
  /** 个人空间消费标题（重复装载幂等清理） */
  personalTitles: ['午餐', '地铁', '房租', '超市采购', '电影', '体检', '巡检便利店小票'],
}
/** 装载期动态收集的对象 id（写入 settings.load_manifest，供 --clean 精确清理） */
const createdObjectIds = []
const MANIFEST_KEY = 'load_manifest'

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

/* ---------------- 清理（manifest 精确清理 + 静态名称清单 + 旧 DEMO_ 兜底） ---------------- */
function readManifest() {
  const row = raw('SELECT value FROM settings WHERE key = ?', MANIFEST_KEY)[0]
  try { return row ? JSON.parse(String(row.value)) : {} } catch { return {} }
}
function writeManifest() {
  const m = { objectIds: createdObjectIds, ...NAMES }
  const existing = raw('SELECT key FROM settings WHERE key = ?', MANIFEST_KEY)[0]
  if (existing) run('UPDATE settings SET value = ? WHERE key = ?', JSON.stringify(m), MANIFEST_KEY)
  else run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)', MANIFEST_KEY, JSON.stringify(m), Date.now())
}
function deleteObjectsByIds(ids) {
  for (const id of ids) {
    run('DELETE FROM object_links WHERE source_id=? OR target_id=?', id, id)
    run('DELETE FROM doc_links WHERE object_id=?', id)
    run('DELETE FROM objects WHERE id=?', id)
  }
}
function cleanData() {
  let removed = 0
  // ① 按 manifest 精确清理（上一轮装载记录的对象 id）
  const m = readManifest()
  if (m.objectIds?.length) { removed += m.objectIds.length; deleteObjectsByIds(m.objectIds) }
  // ② 按静态名称清单清理（覆盖无 manifest 的历史装载；名称固定所以可靠）
  for (const [sql, args] of [
    ['DELETE FROM objects WHERE type_id IN (SELECT id FROM object_types WHERE name IN (' + NAMES.objectTypes.map(() => '?').join(',') + '))', NAMES.objectTypes],
    // ChatBI 订单 + 场景合并对象 + 组织/个人 API 创建对象（按 id 前缀与 values 标记）
    ...NAMES.objectIdPrefixes.map((p) => ['DELETE FROM objects WHERE id LIKE ?', [p + '%']]),
    ...NAMES.objectMarkers.map((mk) => ['DELETE FROM objects WHERE "values" LIKE ?', ['%' + mk + '%']]),
    ...NAMES.personalTitles.map((t) => ['DELETE FROM objects WHERE "values" LIKE ?', ['%"title":"' + t + '"%']]),
    ['DELETE FROM objects WHERE "values" LIKE ?', ['%巡检便利店小票%']],
    // 各业务表按名称
    ['DELETE FROM documents WHERE title IN (' + NAMES.documents.map(() => '?').join(',') + ')', NAMES.documents],
    ['DELETE FROM automation_rules WHERE name IN (' + NAMES.automationRules.map(() => '?').join(',') + ')', NAMES.automationRules],
    ['DELETE FROM workshop_apps WHERE name IN (' + NAMES.workshopApps.map(() => '?').join(',') + ')', NAMES.workshopApps],
    ['DELETE FROM reports WHERE title IN (' + NAMES.reports.map(() => '?').join(',') + ')', NAMES.reports],
    ['DELETE FROM pipelines WHERE name IN (' + NAMES.pipelines.map(() => '?').join(',') + ')', NAMES.pipelines],
    ['DELETE FROM marketplace_products WHERE name IN (' + NAMES.marketplace.map(() => '?').join(',') + ')', NAMES.marketplace],
    ['DELETE FROM interface_types WHERE name IN (' + NAMES.interfaces.map(() => '?').join(',') + ')', NAMES.interfaces],
    ['DELETE FROM ontology_terms WHERE term IN (' + NAMES.terms.map(() => '?').join(',') + ')', NAMES.terms],
    ['DELETE FROM data_connections WHERE name IN (' + NAMES.connections.map(() => '?').join(',') + ')', NAMES.connections],
    ['DELETE FROM scan_templates WHERE name IN (' + NAMES.scanTemplates.map(() => '?').join(',') + ')', NAMES.scanTemplates],
    ['DELETE FROM cipher_rules WHERE name IN (' + NAMES.cipherRules.map(() => '?').join(',') + ')', NAMES.cipherRules],
    ['DELETE FROM lifecycle_policies WHERE name IN (' + NAMES.lifecyclePolicies.map(() => '?').join(',') + ')', NAMES.lifecyclePolicies],
    ['DELETE FROM model_registrations WHERE name IN (' + NAMES.modelRegistrations.map(() => '?').join(',') + ')', NAMES.modelRegistrations],
    ['DELETE FROM user_groups WHERE name IN (' + NAMES.userGroups.map(() => '?').join(',') + ')', NAMES.userGroups],
    ['DELETE FROM repo_files WHERE path IN (' + NAMES.repoFiles.map(() => '?').join(',') + ')', NAMES.repoFiles],
    ['DELETE FROM saved_explorations WHERE name IN (' + NAMES.explorations.map(() => '?').join(',') + ')', NAMES.explorations],
    ['DELETE FROM ontology_scenarios WHERE name IN (' + NAMES.scenarios.map(() => '?').join(',') + ')', NAMES.scenarios],
    ['DELETE FROM scan_findings WHERE table_name IN (' + NAMES.scanFindingTables.map(() => '?').join(',') + ')', NAMES.scanFindingTables],
    ['DELETE FROM ai_conversations WHERE title IN (' + NAMES.conversations.map(() => '?').join(',') + ')', NAMES.conversations],
    ['DELETE FROM ts_points WHERE metric IN (' + NAMES.metrics.map(() => '?').join(',') + ')', NAMES.metrics],
  ]) {
    try { run(sql, ...args) } catch (e) { /* 表/列不存在则跳过 */ }
  }
  // 函数版本须在函数删除前按 function_id 清
  const fnIds = raw('SELECT id FROM ontology_functions WHERE name IN (' + NAMES.functions.map(() => '?').join(',') + ')', ...NAMES.functions).map((r) => r.id)
  for (const fid of fnIds) { try { run('DELETE FROM function_versions WHERE function_id=?', fid) } catch { /* ignore */ } }
  run('DELETE FROM ontology_functions WHERE name IN (' + NAMES.functions.map(() => '?').join(',') + ')', ...NAMES.functions)
  run('DELETE FROM action_types WHERE name IN (' + NAMES.actionTypes.map(() => '?').join(',') + ')', ...NAMES.actionTypes)
  run('DELETE FROM link_types WHERE name IN (' + NAMES.linkTypes.map(() => '?').join(',') + ')', ...NAMES.linkTypes)
  // 删除类型前先清其引用（链接/动作/对象/术语）
  const typeIds = raw('SELECT id FROM object_types WHERE name IN (' + NAMES.objectTypes.map(() => '?').join(',') + ')', ...NAMES.objectTypes).map((r) => r.id)
  for (const tid of typeIds) {
    try { run('DELETE FROM action_types WHERE target_type_id=?', tid) } catch { /* ignore */ }
    try { run('DELETE FROM link_types WHERE source_type_id=? OR target_type_id=?', tid, tid) } catch { /* ignore */ }
    try { run('DELETE FROM ontology_terms WHERE type_id=?', tid) } catch { /* ignore */ }
    try { run('DELETE FROM objects WHERE type_id=?', tid) } catch { /* ignore */ }
    try { run('DELETE FROM object_types WHERE id=?', tid) } catch { /* ignore */ }
  }
  // 工作流按名称从 settings 移除
  try {
    for (const row of raw(`SELECT key, value FROM settings WHERE key LIKE 'logic_workflows_%'`)) {
      const data = (() => { try { return JSON.parse(String(row.value)) } catch { return {} } })()
      const list = Array.isArray(data.workflows) ? data.workflows : []
      const kept = list.filter((w) => !NAMES.workflows.includes(w.name) && !String(w.name ?? '').startsWith(TAG))
      // 同名去重（旧版重复装载堆积）
      const seen = new Map()
      for (const w of kept) { if (w && w.name) seen.set(w.name, w) }
      const merged = Array.from(seen.values())
      if (merged.length !== list.length) run('UPDATE settings SET value=? WHERE key=?', JSON.stringify({ workflows: merged }), row.key)
    }
  } catch { /* ignore */ }
  // 自定义流程（machinery flows）按名称从 settings 移除
  try {
    for (const row of raw(`SELECT key, value FROM settings WHERE key LIKE 'machinery_flows_%'`)) {
      const data = (() => { try { return JSON.parse(String(row.value)) } catch { return {} } })()
      const list = Array.isArray(data.flows) ? data.flows : []
      const kept = list.filter((f) => !NAMES.machineryFlows.includes(f.name) && f.name !== '设备检修申请流程')
      if (kept.length !== list.length) run('UPDATE settings SET value=? WHERE key=?', JSON.stringify({ flows: kept }), row.key)
    }
  } catch { /* ignore */ }
  // 模块 3-6 产生的执行类数据（全量清：治理执行/排程/部署为本脚本主要来源）
  try { run('DELETE FROM governance_runs') } catch { /* ignore */ }
  try { run('DELETE FROM schedule_tasks') } catch { /* ignore */ }
  // ③ 旧版 DEMO_ 数据一次性兜底清理（历史迁移）
  const demoIds = raw(`SELECT id FROM objects WHERE "values" LIKE ?`, `%${TAG}%`).map((r) => r.id)
  deleteObjectsByIds(demoIds)
  for (const fid of raw(`SELECT id FROM ontology_functions WHERE name LIKE ?`, `${TAG}%`).map((r) => r.id)) {
    try { run('DELETE FROM function_versions WHERE function_id=?', fid) } catch { /* ignore */ }
  }
  try { run(`DELETE FROM ts_points WHERE metric LIKE ?`, `${TAG}%`) } catch { /* ignore */ }
  try { run(`DELETE FROM ai_conversations WHERE title LIKE ?`, `${TAG}%`) } catch { /* ignore */ }
  try { run(`DELETE FROM user_groups WHERE name LIKE ?`, `${TAG}%`) } catch { /* ignore */ }
  // 文档删除前先删其分块/挂接（doc_chunks 外键引用 documents，直接删会被约束阻止并静默失败）
  for (const docId of raw(`SELECT id FROM documents WHERE title LIKE ?`, `${TAG}%`).map((r) => r.id)) {
    try { run('DELETE FROM doc_chunks WHERE doc_id=?', docId) } catch { /* ignore */ }
    try { run('DELETE FROM doc_links WHERE doc_id=?', docId) } catch { /* ignore */ }
    try { run('DELETE FROM documents WHERE id=?', docId) } catch { /* ignore */ }
  }
  for (const [table, col] of [
    ['approvals', 'title'], ['automation_rules', 'name'],
    ['workshop_apps', 'name'], ['reports', 'title'], ['pipelines', 'name'],
    ['interface_types', 'name'], ['ontology_terms', 'term'],
    ['data_connections', 'name'], ['scan_templates', 'name'], ['cipher_rules', 'name'],
    ['scan_findings', 'table_name'], ['lifecycle_policies', 'name'],
    ['model_registrations', 'name'], ['marketplace_products', 'name'],
    ['repo_files', 'path'], ['ontology_functions', 'name'], ['action_types', 'name'], ['link_types', 'name'],
    ['object_types', 'name'], ['notifications', 'title'],
    ['saved_explorations', 'name'], ['ontology_scenarios', 'name'],
  ]) {
    try { run(`DELETE FROM ${table} WHERE ${col} LIKE ?`, `${TAG}%`) } catch { /* 表/列不存在则跳过 */ }
  }
  run(`DELETE FROM audit_events WHERE target LIKE ? AND created_at > ?`, `${TAG}%`, Date.now() - 30 * 86400_000)
  // ④ 清掉 manifest 自身
  run('DELETE FROM settings WHERE key = ?', MANIFEST_KEY)
  console.log(`清理完成：manifest 对象 ${m.objectIds?.length ?? 0} 条 + 静态清单实体 + 旧 DEMO_ 兜底 ${demoIds.length} 条`)
  return removed + demoIds.length
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
  // 新建一个业务对象类型（带 4 种属性 + enum）
  const t = await api('POST', '/api/ontology/types', {
    name: `供应商评估记录`, apiName: 'SupplierAudit', desc: '供应商季度评估档案：得分、等级与评估日期',
    color: '#0ea5e9', icon: 'Boxes',
    properties: [
      { key: 'supplier', name: '供应商名称', type: 'string', required: true },
      { key: 'score', name: '评估得分', type: 'number' },
      { key: 'grade', name: '合作等级', type: 'enum', enumValues: ['A', 'B', 'C'] },
      { key: 'date', name: '评估日期', type: 'date' },
    ],
  })
  // POST /ontology/types 返回 { type: {...} }；409（同名已存在）时复用已有类型，保证幂等
  let typeId = t.data?.type?.id
  if (!t.ok && t.status === 409) {
    const list = (await api('GET', '/api/ontology/types')).data?.types ?? []
    typeId = list.find((x) => x.name === `供应商评估记录`)?.id
  }
  globalThis.__supplierTypeId = typeId
  ok('本体·新建/复用对象类型', { ok: !!typeId, status: t.status, data: t.data }, typeId || '')

  // 链接类型 + 动作类型 + 函数 + 接口
  ok('本体·新建链接类型', await api('POST', '/api/ontology/links', {
    name: `评估记录关联工单`, sourceTypeId: typeId || 'device', targetTypeId: 'ticket', cardinality: '1:N', desc: '供应商季度评估关联其产生的维修工单',
  }))
  ok('本体·新建动作类型', await api('POST', '/api/ontology/actions', {
    name: `登记供应商档案`, targetTypeId: typeId || 'device', needsApproval: false, desc: '录入新的供应商评估档案',
    params: [{ key: 'objectId', name: '目标对象', type: 'string', required: true }, { key: 'comment', name: '说明', type: 'string' }],
    effect: { kind: 'update', setValues: {} },
  }))
  ok('本体·新建函数', await api('POST', '/api/ontology/functions', {
    name: `设备OEE计算`, desc: '按可用率×性能率×合格率计算设备综合效率', lang: 'TypeScript', linkedTypeIds: [typeId || 'device'],
  }))
  const iface = await api('POST', '/api/ontology/interfaces', {
    name: `可估值资产契约`, desc: '可估值资产需实现的属性契约',
    properties: [{ key: 'supplier', name: '供应商名称', type: 'string' }, { key: 'score', name: '评估得分', type: 'number' }],
    implementedBy: [typeId || 'device'],
  })
  ok('本体·新建接口', iface, iface.data?.id || '')
  if (iface.data?.id) ok('本体·接口符合性校验', await api('GET', `/api/ontology/interfaces/${iface.data.id}/check`))

  // 业务术语（同义词 + 认证指标）
  const term = await api('POST', '/api/ontology/terms', {
    term: `设备资产总值`, synonyms: [`设备总原值`, `固定资产总值`],
    typeId: typeId || 'device', propertyKey: 'score',
    definition: '集团在册设备的资产原值合计', metricExpr: 'AVG(score)', certified: true,
  })
  ok('语义层·认证术语', term, term.data?.id || '')
  ok('语义层·解析预检', await api('GET', `/api/ontology/terms/resolve?q=${encodeURIComponent('固定资产总值')}`))
}

/* ---------------- 2. 对象数据（真实业务实例：设备/工单/客户/订单/工厂） ---------------- */
{
  const types = (await api('GET', '/api/ontology/types')).data?.types ?? []
  const DEVICE_NAMES = ['海天 MA1600 注塑机', '震雄 SM280 注塑机', '发那科 ROBODRILL CNC', '兄弟 TD-4C 钻攻中心', '基恩士 CV-X 检测仪', '汇川 AGV-200 搬运机器人']
  const FAULTS = ['液压油温过高报警', '主轴异响，疑似轴承磨损', '机械手卡滞，复位异常', '导轨润滑不足报警', '视觉镜头标定偏移', '伺服驱动器过载跳闸']
  const CUSTOMERS = [
    ['CU-0801', '东莞市瑞泰精密模具有限公司', '模具加工'],
    ['CU-0802', '深圳市康诺电子科技有限公司', '消费电子'],
    ['CU-0803', '惠州市联翔五金制品有限公司', '五金制品'],
    ['CU-0804', '广州鹏程汽车零部件有限公司', '汽车零部件'],
  ]
  const ORDERS = [
    ['SO-2026-2701', 'CU-0801', 286000, '已付款', '2026-11-02'],
    ['SO-2026-2702', 'CU-0802', 158000, '已审批', '2026-11-05'],
    ['SO-2026-2703', 'CU-0803', 92000, '生产中', '2026-11-08'],
    ['SO-2026-2704', 'CU-0804', 520000, '已付款', '2026-11-10'],
  ]
  const FACTORIES = [
    ['F1', '顺德注塑基地', '广东·顺德', 128, '86%'],
    ['F2', '南海精密加工基地', '广东·南海', 96, '82%'],
    ['F3', '禅城装配基地', '广东·禅城', 64, '91%'],
    ['F4', '江门注塑分厂', '广东·江门', 42, '78%'],
  ]
  const plan = [
    ['device', (i) => ({ code: `F${Math.ceil(i / 2)}-${i % 2 ? 'IM' : 'CN'}-21${String(i).padStart(2, '0')}`, name: DEVICE_NAMES[i - 1], type: i <= 2 ? '注塑机' : i === 3 || i === 4 ? 'CNC' : i === 5 ? '检测仪' : 'AGV', health: 95 - i * 4, status: i % 2 ? '运行' : i === 4 ? '维修' : '待机', downtime: i * 3.5, factory: FACTORIES[Math.ceil(i / 2) - 1]?.[1] ?? '顺德注塑基地' })],
    ['ticket', (i) => ({ no: `GD-2026-${3000 + i}`, device: `F1-IM-2101`, priority: ['P1', 'P2', 'P0'][i % 3], fault: FAULTS[i - 1], status: ['待派单', '处理中', '已关闭'][i % 3], owner: '李维修', hours: i * 2.5 })],
    ['customer', (i) => ({ code: CUSTOMERS[i - 1]?.[0] ?? `CU-08${String(i).padStart(2, '0')}`, name: CUSTOMERS[i - 1]?.[1] ?? `客户 ${i}`, industry: CUSTOMERS[i - 1]?.[2] ?? '机械制造', grade: i === 4 ? '战略' : '优选', contact: '陈星野', phone: '138****0000' })],
    ['order', (i) => { const o = ORDERS[i - 1]; return { no: o[0], customer: CUSTOMERS.find((c) => c[0] === o[1])?.[1] ?? o[1], amount: o[2], status: o[3], date: o[4], owner: '周计划' } }],
    ['factory', (i) => { const f = FACTORIES[i - 1]; return { code: f[0], name: f[1], city: f[2], devices: f[3], oee: f[4] } }],
  ]
  // 供应商评估记录实例（新类型；真实供应商与得分）
  const SUPPLIERS = [
    ['佛山恒力液压科技有限公司', 92, 'A'],
    ['中山金鑫轴承制造有限公司', 85, 'A'],
    ['东莞广泰密封件有限公司', 74, 'B'],
    ['广州华顺电气设备有限公司', 61, 'C'],
  ]
  const supplierTid = globalThis.__supplierTypeId
  if (supplierTid) {
    for (let i = 1; i <= 4; i++) {
      const [name, score, grade] = SUPPLIERS[i - 1]
      const r = await api('POST', '/api/objects', { typeId: supplierTid, values: { supplier: name, score, grade, date: '2026-10-15' } })
      if (r.ok) createdObjectIds.push(r.data?.object?.id ?? r.data?.id)
    }
  }
  let created = 0
  for (const [tid, gen] of plan) {
    if (!types.some((t) => t.id === tid)) continue
    for (let i = 1; i <= 4; i++) {
      const r = await api('POST', '/api/objects', { typeId: tid, values: gen(i) })
      if (r.ok) { created++; createdObjectIds.push(r.data?.object?.id ?? r.data?.id) }
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
    const r = await api('POST', '/api/objects', { typeId: 'expense', values: { title, amount, date, category, merchant, payment } }, PERSONAL)
    if (r.ok) { pc++; createdObjectIds.push(r.data?.object?.id ?? r.data?.id) }
  }
  ok('个人空间·消费数据', { ok: pc === 6 }, `${pc} 条`)
  // 消费明细（expense_item）+ 链接
  const items = await api('POST', '/api/scan/commit', {
    typeId: 'expense',
    values: { title: `巡检便利店小票`, amount: 40, date: '2026-11-08', category: '餐饮', merchant: '星辰便利店', payment: '微信',
      items: [{ name: `冰红茶`, qty: 2, unitPrice: 6, amount: 12, category: '餐饮' }, { name: `招牌鸡腿饭`, qty: 1, unitPrice: 28, amount: 28, category: '餐饮' }] },
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
    const ex = await api('POST', `/api/actions/${encodeURIComponent(need.id)}/execute`, { params: { objectId: target.id, comment: `设备F1-IM-2103检修申请` } })
    ok('动作·发起需审批动作', ex, ex.data?.status || '')
    if (ex.data?.approvalId) {
      const d = await api('POST', `/api/actions/approvals/${encodeURIComponent(ex.data.approvalId)}/decide`, { decision: 'approve', comment: `同意检修` })
      ok('审批·通过并写回', d, d.data?.status || '')
    }
  } else ok('动作·发起需审批动作', { ok: false, status: 0, data: { error: '无可用需审批动作或目标对象' } })
  ok('审计·留痕可查', await api('GET', '/api/admin/audit?limit=5'))
}

/* ---------------- 4. 知识层（5 篇真实规程入库 / 检索 / 抽取候选） ---------------- */
{
  const DOCS = [
    ['注塑机液压系统维护规程', '设备手册', '注塑机 F2-IM-2041 的液压系统每 2000 小时需更换油封 HS-2041-03；油温超过 55 摄氏度时必须检查冷却系统。维修工单 GD-2291 记录了该设备的液压泄漏处置流程，责任人是李维修。'],
    ['CNC 主轴保养手册', '设备手册', '发那科 ROBODRILL CNC 主轴每 3000 小时做一次精度校准；主轴异响时应停机检查轴承磨损，备件型号 BT30-6804。点检记录由当班机长签字确认，异常项须在 4 小时内报修。'],
    ['设备点检作业指导书', '作业指导', '每日班前按点检表执行：油位、气压（0.6-0.8MPa）、安全门联锁、急停按钮。点检数据录入系统后自动同步至设备健康度指标；连续两次未点检的设备自动生成提醒通知给车间主任。'],
    ['车间安全生产条例', '安全制度', '进入车间必须佩戴安全帽与防砸鞋；检修设备前须挂牌上锁（LOTO）并断开主电源。危险作业（动火、受限空间、高处）须提前一天在平台提交审批单，经安全主管批准后方可施工。'],
    ['模具入库验收规范', '质量规范', '新模具入库前由质检科按《模具验收细则》检查：型腔尺寸公差 ±0.02mm、顶针配合、冷却水路保压 30 分钟无泄漏。验收合格的模具贴绿色标签并登记台账，不合格的退回供应商并在评估记录中扣分。'],
  ]
  let dc = 0
  for (const [title, category, content] of DOCS) {
    const r = await api('POST', '/api/knowledge/docs', { title, category, format: 'TXT', content })
    if (r.ok) dc++
  }
  ok('知识·5 篇规程入库分块', { ok: dc === 5 }, `${dc}/5 篇`)
  ok('知识·混合检索（液压）', await api('GET', `/api/knowledge/search?q=${encodeURIComponent('液压系统')}`))
  ok('知识·混合检索（点检）', await api('GET', `/api/knowledge/search?q=${encodeURIComponent('点检要求')}`))
  ok('知识·抽取候选', await api('GET', '/api/extract/candidates'))
}

/* ---------------- 5. 自动化 / 通知 ---------------- */
{
  const r = await api('POST', '/api/automations/rules', {
    name: `设备健康度低阈值告警`, trigger: { kind: 'threshold', typeId: 'device', field: 'health', op: '<', value: 60 },
    condition: '健康度 < 60', actions: [{ kind: 'notify', config: { message: `设备健康度低于60，请安排检修` } }],
  })
  ok('自动化·规则（含条件表达式）', r, r.data?.id || '')
  ok('通知中心·真实列表', await api('GET', '/api/automations/notifications'))
}

/* ---------------- 6. 应用：Workshop / 报告 / 管道 / 市场 ---------------- */
{
  const w = await api('POST', '/api/workshop', { name: `设备运维监控台`, desc: '设备健康度与停机时长日常监控', widgets: [{ id: 'w1', type: 'stat', config: { typeId: 'device', title: '设备数', aggregation: 'count' } }] })
  ok('Workshop·应用与组件绑定', w, w.data?.id || '')
  const rep = await api('POST', '/api/p10/notepad/reports', { title: `2026年10月设备运营月报`, content: '本月设备运行平稳，注塑机 F2-IM-2041 完成液压系统检修，累计停机 47.5 小时，已生成维修工单并闭环。', status: 'published' })
  ok('Notepad·发布报告', rep, rep.data?.status || '')
  const pl = await api('POST', '/api/p10plus/pipelines', { name: `ERP备件库存同步`, nodes: [{ id: 'n1', type: 'source', config: {} }, { id: 'n2', type: 'output', config: {} }] })
  ok('管道·新建', pl, pl.data?.id || '')
  if (pl.data?.id) {
    ok('管道·校验', await api('POST', `/api/p10plus/pipelines/${pl.data.id}/validate`))
    ok('管道·发布', await api('POST', `/api/p10plus/pipelines/${pl.data.id}/publish`))
    ok('管道·运行', await api('POST', `/api/p10plus/pipelines/${pl.data.id}/run`))
  }
  ok('Marketplace·上架产品', await api('POST', '/api/p10plus/marketplace/products', { name: `连锁门店库存管理包`, category: '模板包', version: '1.0.0' }))
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
  const wf1 = await api('POST', '/api/logic/workflows', { name: `设备停机标准处置流程`, steps: linearSteps })
  ok('AIP Logic·线性工作流持久化', wf1, wf1.data?.id || '')

  // 工作流 2：条件分支双出口（nextYes / nextNo 指向不同节点，画布自动画两条着色连线）
  const branchSteps = [
    { id: 's1', type: 'input', label: '输入数据', outputFormat: '设备告警文本', x: 40, y: 60 },
    { id: 's2', type: 'condition', label: '健康度判断', condition: '健康度 > 60', x: 280, y: 60, nextYes: 's3', nextNo: 's4' },
    { id: 's3', type: 'output', label: '自动归档', outputFormat: '正常设备清单', x: 540, y: 20 },
    { id: 's4', type: 'output', label: '人工复核', outputFormat: '待复核工单', x: 540, y: 150 },
  ]
  const wf2 = await api('POST', '/api/logic/workflows', { name: `采购申请分级审批流程`, steps: branchSteps })
  ok('AIP Logic·分支工作流持久化(含 nextYes/nextNo)', wf2, wf2.data?.id || '')

  // 幂等校验：重复 POST 同名工作流不新增（后端按同名合并）
  const before = (await api('GET', '/api/logic/workflows')).data?.workflows ?? []
  await api('POST', '/api/logic/workflows', { name: `采购申请分级审批流程`, steps: branchSteps })
  const after = (await api('GET', '/api/logic/workflows')).data?.workflows ?? []
  const nameCount = after.filter((w) => w.name === `采购申请分级审批流程`).length
  const idempotent = wf2.ok && before.length === after.length && nameCount === 1
  ok('AIP Logic·同名装载幂等(不叠加)', { ok: idempotent, status: idempotent ? 200 : 500, data: {} }, `before=${before.length} after=${after.length} 同名=${nameCount}`)

  // 保存校验：空节点 / 分支目标不存在 → 400
  ok('AIP Logic·空节点保存被拒(400)', await api('POST', '/api/logic/workflows', { name: `测试非法流程`, steps: [] }, ORG, 400))
  ok('AIP Logic·分支目标不存在被拒(400)', await api('POST', '/api/logic/workflows', { name: `测试非法流程`, steps: [{ id: 's1', type: 'condition', label: '条件', condition: 'x > 1', nextYes: 'NO_SUCH_NODE' }] }, ORG, 400))

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
  ok('AIP Logic·预设模板库可见(6 个)', { ok: presets.length === 6, status: presets.length === 6 ? 200 : 500, data: {} }, `presets=${presets.length}`)

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

  const ag = await api('POST', '/api/aip/agents', { name: `设备运维助理`, desc: '面向设备运维的智能问答与工具助手', tools: ['ontology_overview', 'query_objects'], guardrail: { maskSensitive: true, requireApprovalForActions: true } })
  ok('Agent Studio·新建 Agent', ag, ag.data?.id || '')
  ok('AIP·助手会话', await api('POST', '/api/ai/conversations', { title: `设备巡检问答` }))

  // 流程编排：真实流程定义（节点画布可编辑持久化）
  {
    const acts = (await api('GET', '/api/actions')).data?.actions ?? []
    const act = acts.find((a) => !a.needsApproval) ?? acts[0]
    const flowNodes = [
      { id: 's1', type: 'start', label: '车间发起检修申请', x: 40, y: 80, next: 's2' },
      { id: 's2', type: 'approval', label: '设备主管审批', x: 280, y: 80, next: 's3' },
      { id: 's3', type: 'action', label: '执行登记供应商档案', x: 520, y: 80, next: 's4', ...(act ? { actionId: act.id } : {}) },
      { id: 's4', type: 'notify', label: '通知发起人结果', x: 760, y: 80, next: 's5' },
      { id: 's5', type: 'end', label: '流程归档', x: 900, y: 80 },
    ]
    const mf = await api('POST', '/api/p10plus/machinery/flows', { name: '设备检修申请流程', nodes: flowNodes })
    ok('流程编排·流程定义持久化', mf, mf.data?.id || '')
    const mfl = (await api('GET', '/api/p10plus/machinery/flows')).data?.flows ?? []
    const saved = mfl.find((f) => f.name === '设备检修申请流程')
    ok('流程编排·节点与连线回读', { ok: !!saved && saved.nodes.length === 5 && saved.nodes[0].next === 's2' && (saved.nodes[2].actionId ?? '') === (act?.id ?? ''), status: 200, data: {} }, `nodes=${saved?.nodes?.length} 绑定动作=${saved?.nodes?.[2]?.actionId ? '是' : '否'}`)
    const badFlow = await api('POST', '/api/p10plus/machinery/flows', { name: '测试非法流程', nodes: [{ id: 'a', type: 'start', label: 'a', next: 'NOPE' }] }, ORG, 400)
    ok('流程编排·断链保存被拒(400)', badFlow)
  }
}

/* ---------------- 8. 治理 / 管理 ---------------- */
{
  ok('治理·脱敏规则', await api('POST', '/api/gov/cipher-rules', { name: `客户手机号脱敏`, pattern: '1[3-9]\\d{9}', action: '掩码' }))
  ok('治理·扫描发现', await api('POST', '/api/gov/scan-findings', { table: `crm_customers`, field: 'phone', sensitiveType: '手机号' }))
  ok('治理·生命周期策略', await api('POST', '/api/gov/lifecycle-policies', { name: `操作日志180天保留`, retention: '180 天', legal: '合规要求' }))
  ok('模型·多模型注册', await api('POST', '/api/gov/models', { name: `GLM-4-Flash对话模型`, type: '对话', quota: 10000 }))
  ok('用户组·新建', await api('POST', '/api/roles/groups', { name: `华南区设备运维组`, desc: '设备健康度与停机时长日常监控' }))
  ok('代码资产·登记', await api('POST', '/api/data-layer/repo', { path: `oeeCalculator.ts`, lang: 'typescript', content: 'export function computeOee(a, p, q) { return a * p * q }', branch: 'main' }))
  ok('识别模板·自定义', await api('POST', '/api/scan/templates', { name: `快递面单识别`, fieldMapping: { 合计: 'amount' }, matchKeywords: ['快递','运单','顺丰'] }))
}

/* ---------------- 9. 外部数据源（真实连接 + 同步） ---------------- */
{
  const c = await api('POST', '/api/data-layer/connections', {
    name: `集团ERP备件库存库`, type: 'SQLite', database: 'demo-data/external/enterprise.db',
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
  // 复用第 1 节已建的「设备OEE计算」函数（同名会 409，不再新建），走完整版本闭环
  const fnList = (await api('GET', '/api/ontology/functions')).data?.functions ?? []
  const fn = fnList.find((f) => f.name === '设备OEE计算')?.id
  if (fn) {
    const body = 'function main(input) { return { oee: Math.round(((input.availability || 0) * (input.performance || 0) * (input.quality || 0)) * 1000) / 10, grade: (input.availability || 0) * (input.performance || 0) * (input.quality || 0) >= 0.85 ? "优秀" : "待改进" } }'
    const v = await api('POST', `/api/fn/functions/${fn}/versions`, { body, testInput: { availability: 0.9, performance: 0.95, quality: 0.98 } })
    ok('函数·新建版本（自动测试）', v, v.data?.version?.version ? `v${v.data.version.version} testOutput=${String(v.data.version.testOutput).slice(0, 60)}` : '')
    const vers = await api('GET', `/api/fn/functions/${fn}/versions`)
    const v1 = (vers.data?.versions ?? [])[0]
    if (v1) {
      ok('函数·版本列表', vers, `${vers.data.versions.length} 个版本`)
      ok('函数·发布版本', await api('POST', `/api/fn/functions/${fn}/versions/${v1.id}/publish`))
      const run = await api('POST', `/api/fn/functions/${fn}/run`, { input: { availability: 0.9, performance: 0.95, quality: 0.98 } })
      ok('函数·沙箱真实执行 run', { ok: run.ok && run.data?.ok === true && run.data?.result?.oee === 83.8 }, `oee=${run.data?.result?.oee} dur=${run.data?.durationMs}ms`)
    } else ok('函数·版本列表', { ok: false, status: 0, data: {} }, '未取到版本')
  } else ok('函数·新建', { ok: false, status: 0, data: {} }, '未取到函数 id')
}

/* ---------------- 12. Object Explorer 高级（模块2） ---------------- */
{
  const EX = '/api/explorations/explorations'   // 前端/后端约定的 prefixed 路径
  const exp = await api('POST', EX, { name: `健康度80+优秀设备清单`, typeId: 'device', filters: [{ key: 'health', op: 'gt', value: '80' }], sort: 'health' })
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
  const scn = await api('POST', '/api/explorations/scenarios', { name: `Q4新增注塑机上线`, desc: '暂存一次新建再合并' })
  ok('场景·新建', scn, scn.data?.scenario?.id || '')
  if (scn.data?.scenario?.id) {
    const sid = scn.data.scenario.id
    ok('场景·暂存变更', await api('POST', `/api/explorations/scenarios/${sid}/change`, { op: 'create', typeId: 'device', values: { code: `F3-IM-3001`, name: `三期车间注塑机`, type: '注塑机', health: 92, status: '运行', downtime: 0 } }))
    ok('场景·合并真实写对象', await api('POST', `/api/explorations/scenarios/${sid}/merge`))
  }
}

/* ---------------- 13. 模块3：真实时序采集 + 治理执行 ---------------- */
{
  // 从对象批量采集真实 ts_points（health 值）
  const c = await api('POST', '/api/ops/timeseries/collect-from-objects', { metric: 'health_daily', valueKey: 'health' })
  ok('时序·从对象批量真实采集', c, `collected=${c.data?.collected ?? c.data?.inserted ?? '?'}`)
  ok('时序·真实序列查询', await api('GET', '/api/ops/timeseries/series?metric=health_daily'))
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
  const c = await pcall('POST', '/api/data-layer/connections', { name: `财务报销流水CSV`, type: 'CSV', database: 'demo-data/files/expenses.csv' })
  ok('文件源·登记 CSV 连接', c, c.data?.id || '')
  if (c.data?.id) {
    const id = c.data.id
    ok('文件源·真实解析', await pcall('POST', `/api/data-layer/connections/${id}/test-file`))
    ok('文件源·列与样本预览', await pcall('GET', `/api/data-layer/connections/${id}/file-preview`))
    ok('文件源·CSV 同步为支出对象', await pcall('POST', `/api/data-layer/connections/${id}/sync-file`, { table: 'csv', typeId: 'expense' }))
  }
  const j = await api('POST', '/api/data-layer/connections', { name: `设备台账导出JSON`, type: 'JSON', database: 'demo-data/files/devices.json' })
  ok('文件源·登记 JSON 连接', j, j.data?.id || '')
  if (j.data?.id) ok('文件源·JSON 多表清单', await api('GET', `/api/data-layer/connections/${j.data.id}/file-tables`))
}

/* ---------------- 15. 模块5：动态调度本地求解 ---------------- */
{
  ok('调度·生成基准排程任务', await api('POST', '/api/scheduling/seed'))
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
        const id = `order:SO-${y}${pad(mo + 1)}-${pad(s)}`
        inserted += insOrder.run(id, 'order', JSON.stringify({ no: `SO-${y}${pad(mo + 1)}-${pad(s)}`, amount: amt, date, due: iso(new Date(dueMs)), status }), '数据组', m.getTime() + s * 3600_000, m.getTime() + s * 3600_000, ORG).changes
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
// 把本轮创建的对象 id 与静态名称清单写入 manifest，供 --clean 精确清理（幂等基石）
writeManifest()
console.log(`\n装载清单已写入（对象 id ${createdObjectIds.length} 个 + 实体名称清单）`)
console.log('\n=== 装载结果 ===')
for (const s of summary) console.log(`  ${s.ok ? '✓' : '✗'} ${s.label}${s.detail ? ' — ' + s.detail : ''}`)
const passed = summary.filter((s) => s.ok).length
console.log(`\n通过 ${passed}/${summary.length}`)
console.log('\n下一步：打开浏览器按 demo-data/FEATURE-MATRIX.md 逐项体验；')
console.log('       清理命令：node demo-data/load.mjs --clean')
db.close()
process.exit(passed === summary.length ? 0 : 1)
