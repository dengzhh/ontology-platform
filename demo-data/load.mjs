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
  documents: ['注塑机液压系统维护规程', 'CNC 主轴保养手册', '设备点检作业指导书', '车间安全生产条例', '模具入库验收规范', '顺德注塑基地点检 SOP'],
  automationRules: ['设备健康度低阈值告警', '注塑机停机且超时升级', '维修工单逾期未派单提醒（已停用）'],
  workshopApps: ['设备运维监控台', '顺德基地设备运营驾驶舱', '订单履约看板'],
  reports: ['2026年10月设备运营月报', '2026年11月设备检修周报', '2026年Q4客户交付分析'],
  pipelines: ['注塑机备件消耗日结管道', '销售订单履约同步管道', '设备点检文本入库管道', 'ERP备件库存同步'],
  marketplace: ['连锁门店库存管理包', '星辰智造-设备点检模板包', '星辰智造-供应商季度评估包', '星辰智造-门店巡检轻量包'],
  workflows: ['设备停机标准处置流程', '采购申请分级审批流程'],
  machineryFlows: ['设备检修申请流程'],
  conversations: ['设备运维助理', '设备巡检问答', '华南区备件采购问答助理', '质检合规审查助理', '《注塑机液压系统维护规程》检修要点分析'],
  cipherRules: ['客户手机号脱敏', '供应商银行账号脱敏', '身份证号脱敏（已停用）'],
  lifecyclePolicies: ['操作日志180天保留', '财务凭证7年保留', '巡检临时数据30天清理'],
  modelRegistrations: ['GLM-4-Flash对话模型', '混元hy4free主力模型', 'embedding-2 知识向量模型', 'glm-ocr 票据识别模型'],
  userGroups: ['华南区设备运维组', '顺德基地夜班运维组', '供应链对账组', '合规审计组'],
  repoFiles: ['src/etl/oeeCalculator.ts', 'src/etl/sparePartsSync.ts', 'sql/spare_parts_daily.sql', 'src/etl/healthScore.py'],
  scanTemplates: ['快递面单识别', '星辰智造-设备点检表识别', '星辰智造-供应商增值税发票识别', '星辰智造-模具验收单识别'],
  connections: ['集团ERP备件库存库', '财务报销流水CSV', '设备台账导出JSON'],
  explorations: ['健康度80+优秀设备清单', '待检修设备集（健康<70 且维修中）', '东莞瑞泰相关订单'],
  derivedProperties: ['downtimeCost'],
  scenarios: ['Q4新增注塑机上线'],
  scanFindingTables: ['crm_customers', 'hr_employee', 'supplier'],
  metrics: ['health_daily', 'downtime_hours_daily', 'hydraulic_temp_hourly'],
  approvalTitles: ['AP-20261114-01 顺德基地 F1-IM-2101 主轴更换申请', 'AP-20261114-02 南海基地备件采购 ¥128,600', 'AP-20261113-07 客户联系方式导出', 'AP-20261113-03 Q4模具批次本体变更'],
  apiKeys: ['星辰智造-ERP同步只读密钥', 'MES写回集成密钥', '平台运维密钥'],
  evalConversations: ['EVAL-星辰智造-设备术语问答回归集'],
  settingKeys: ['smtp', 'embedding', 'vision', 'features'],
  deployments: ['v3.0.0-顺德注塑MES上线', 'v3.0.1-南海CNC排程修复', 'v3.0.2-禅城装配质检看板'],
  /** 对象 id 前缀（ChatBI 订单直插用真实单号前缀） */
  objectIdPrefixes: ['order:SO-2'],
  /** 对象 values 包含标记（用于清掉随机 id 的 API 创建对象） */
  objectMarkers: ['F1-IM-210', 'F1-IM-2199', 'F1-CN-210', 'F2-IM-210', 'F2-CN-210', 'F2-CN-220', 'F3-IM-3001', 'GD-2026-30', 'CU-080', 'SO-2026-27', '顺德注塑基地', '南海精密加工基地', '禅城装配基地', '东莞市瑞泰精密模具', '深圳市康诺电子科技', '惠州市联翔五金制品', '广州鹏程汽车零部件', '佛山恒力液压', '中山金鑫轴承', '东莞广泰密封件', '广州华顺电气'],
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
    ['DELETE FROM extract_candidates WHERE id LIKE ?', ['EC-DEMO-%']],
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
    ['DELETE FROM derived_properties WHERE key IN (' + NAMES.derivedProperties.map(() => '?').join(',') + ')', NAMES.derivedProperties],
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
  // ④ §18 补强数据的精确清理（Evals 会话/消息、文档分析线程、审批三态、密钥、配置、部署样例）
  for (const eid of NAMES.evalConversations) {
    run('DELETE FROM ai_messages WHERE conversation_id=?', eid)
    run('DELETE FROM ai_conversations WHERE id=?', eid)
  }
  run('DELETE FROM ai_messages WHERE conversation_id=?', 'TH-DEMO-01')
  run('DELETE FROM ai_conversations WHERE id=?', 'TH-DEMO-01')
  for (const cid of raw('SELECT id FROM ai_conversations WHERE scene=? AND title=?', 'thread', '《注塑机液压系统维护规程》检修要点分析').map((r) => r.id)) run('DELETE FROM ai_messages WHERE conversation_id=?', cid)
  run('DELETE FROM ai_conversations WHERE scene=? AND title=?', 'thread', '《注塑机液压系统维护规程》检修要点分析')
  for (const t of NAMES.approvalTitles) run('DELETE FROM approvals WHERE title LIKE ?', '%' + t.slice(0, 20) + '%')
  for (const k of NAMES.apiKeys) run('DELETE FROM api_keys WHERE name=?', k)
  for (const d of NAMES.deployments) run('DELETE FROM deployments WHERE version LIKE ? OR message LIKE ?', d + '%', '%' + d + '%')
  // settings：仅删除「仍等于脚本默认值」的 key（用户配置过的端点/密钥/模型不动）
  const SETTING_DEFAULTS = { features: { marketplace: true, scanTemplates: true, workflowPresets: true } }
  for (const s of NAMES.settingKeys) {
    const row = raw('SELECT value FROM settings WHERE key=?', s)[0]
    if (!row) continue
    if (SETTING_DEFAULTS[s] && JSON.stringify(JSON.parse(String(row.value))) === JSON.stringify(SETTING_DEFAULTS[s])) run('DELETE FROM settings WHERE key=?', s)
  }
  run('DELETE FROM cipher_rules WHERE name IN (' + NAMES.cipherRules.map(() => '?').join(',') + ')', ...NAMES.cipherRules)
  run('DELETE FROM scan_findings WHERE table_name IN (' + NAMES.scanFindingTables.map(() => '?').join(',') + ')', ...NAMES.scanFindingTables)
  run('DELETE FROM lifecycle_policies WHERE name IN (' + NAMES.lifecyclePolicies.map(() => '?').join(',') + ')', ...NAMES.lifecyclePolicies)
  run('DELETE FROM model_registrations WHERE name IN (' + NAMES.modelRegistrations.map(() => '?').join(',') + ')', ...NAMES.modelRegistrations)
  run('DELETE FROM user_groups WHERE name IN (' + NAMES.userGroups.map(() => '?').join(',') + ')', ...NAMES.userGroups)
  run('DELETE FROM scan_templates WHERE name IN (' + NAMES.scanTemplates.map(() => '?').join(',') + ')', ...NAMES.scanTemplates)
  run('DELETE FROM workshop_apps WHERE name IN (' + NAMES.workshopApps.map(() => '?').join(',') + ')', ...NAMES.workshopApps)
  run('DELETE FROM marketplace_products WHERE name IN (' + NAMES.marketplace.map(() => '?').join(',') + ')', ...NAMES.marketplace)
  // ai_messages 外键引用 ai_conversations：先删消息，再删会话
  for (const cid of raw('SELECT id FROM ai_conversations WHERE title IN (' + NAMES.conversations.map(() => '?').join(',') + ')', ...NAMES.conversations).map((r) => r.id)) {
    run('DELETE FROM ai_messages WHERE conversation_id=?', cid)
  }
  run('DELETE FROM ai_conversations WHERE title IN (' + NAMES.conversations.map(() => '?').join(',') + ')', ...NAMES.conversations)
  run('DELETE FROM reports WHERE title IN (' + NAMES.reports.map(() => '?').join(',') + ')', ...NAMES.reports)
  run('DELETE FROM pipelines WHERE name IN (' + NAMES.pipelines.map(() => '?').join(',') + ')', ...NAMES.pipelines)
  // ⑤ 清掉 manifest 自身
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
    ['F1', '顺德注塑基地', '广东·佛山', 128, '86%'],
    ['F2', '南海精密加工基地', '广东·深圳', 96, '82%'],
    ['F3', '禅城装配基地', '浙江·宁波', 64, '91%'],
    ['F4', '江门注塑分厂', '广东·佛山', 42, '78%'],
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

  // 脏数据 1 条（name 空、health 缺失）→ 数据集页 Data Health 出现空值率告警
  const dirty = await api('POST', '/api/objects', { typeId: 'device', values: { code: 'F1-IM-2199', name: '', type: '注塑机', health: null, status: '待机', downtime: 0, factory: '顺德注塑基地' } })
  ok('数据质量·脏设备（空名称/缺失健康度）', { ok: dirty.ok || dirty.status === 400, status: dirty.status, data: {} }, dirty.ok ? '已入库触发空值告警' : `被校验拦截（${dirty.status}，同样可演示校验）`)

  // 链接实例×4：把 4 条供应商评估记录挂到维修工单（新链接类型出现真实边，图谱/血缘有实例）
  const supplierTid2 = globalThis.__supplierTypeId
  const linkTypes = (await api('GET', '/api/objects/types')).data?.linkTypes ?? []
  // 需要拿到链接类型 id：通过 /ontology/links 列表
  const ltList = (await api('GET', '/api/ontology/links')).data?.links ?? []
  const auditLink = ltList.find((l) => l.name === '评估记录关联工单')
  if (auditLink && supplierTid2) {
    const audits = (await api('GET', `/api/objects?type=${supplierTid2}&limit=10`)).data?.objects ?? []
    const tickets = (await api('GET', '/api/objects?type=ticket&limit=10')).data?.objects ?? []
    let linksMade = 0
    for (let i = 0; i < Math.min(audits.length, tickets.length, 4); i++) {
      const r = await api('POST', `/api/objects/${encodeURIComponent(audits[i].id)}/links`, { linkTypeId: auditLink.id, targetId: tickets[i].id })
      if (r.ok) linksMade++
    }
    ok('链接实例·评估记录→维修工单 ×4', { ok: linksMade >= 1, status: 200, data: {} }, `${linksMade} 条真实 objectLinks（图谱新类型簇）`)
  } else ok('链接实例·评估记录关联工单', { ok: false, status: 0, data: { error: '未找到链接类型或类型' } })

  // 展示模板：device/ticket/order 三类设置 badgeKey（对象视图卡片徽章 + 全站统一生效）
  const tplSet = []
  const tplDefs = [
    ['device', { titleKey: 'name', subKey: 'code', badgeKey: 'status' }],
    ['ticket', { titleKey: 'no', subKey: 'fault', badgeKey: 'priority' }],
    ['order', { titleKey: 'no', subKey: 'customer', badgeKey: 'status' }],
  ]
  for (const [tid, tpl] of tplDefs) {
    const r = await api('PATCH', `/api/ontology/types/${tid}`, { viewTemplate: tpl })
    if (r.ok) tplSet.push(tid)
  }
  ok('展示模板·三类 badgeKey（设备状态/工单优先级/订单状态徽章）', { ok: tplSet.length === 3, status: 200, data: {} }, tplSet.join('/'))

  // 员工对象（路径分析第 4 步「涉及员工」需要真实 employee 实例；与工单 owner 对齐）
  const typeIds = (await api('GET', '/api/ontology/types')).data?.types ?? []
  if (typeIds.some((t) => t.id === 'employee')) {
    const staff = [
      { code: 'E-0101', name: '李维修', role: '高级机修技师', skill: '高级' },
      { code: 'E-0102', name: '王质检', role: '质检专家', skill: '专家' },
      { code: 'E-0103', name: '孙调度', role: '排产调度', skill: '中级' },
      { code: 'E-0104', name: '郑审计', role: '审计员', skill: '中级' },
    ]
    let sc = 0
    for (const s of staff) { const r = await api('POST', '/api/objects', { typeId: 'employee', values: s }); if (r.ok) { sc++; createdObjectIds.push(r.data?.object?.id ?? r.data?.id) } }
    ok('路径分析·4 名员工对象（李维修/王质检/孙调度/郑审计）', { ok: sc === 4, status: 200, data: {} }, `${sc}/4`)
  } else ok('路径分析·员工对象', { ok: false, status: 0, data: { error: 'employee 类型不存在' } })

  // Quiver 变更时间线：对一台真实设备执行 PATCH（审计 target 含对象 id → 时间线有记录）
  const timelineDev = (await api('GET', '/api/objects?type=device&limit=50')).data?.objects?.find((o) => o.values?.code === 'F2-CN-2104')
  if (timelineDev) ok('联动分析·对象变更时间线（PATCH 触发真实审计）', await api('PATCH', `/api/objects/${encodeURIComponent(timelineDev.id)}`, { values: { ...timelineDev.values, health: 83 } }))
  else ok('联动分析·对象变更时间线', { ok: false, status: 0, data: { error: '未找到 F2-CN-2104' } })
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

/* ---------------- 4. 知识层（6 篇文档 / 挂接 / 检索 / 8 条四态抽取候选） ---------------- */
{
  const DOCS = [
    ['注塑机液压系统维护规程', '设备手册', '注塑机 F1-IM-2101 的液压系统每 2000 小时需更换油封 HS-2041-03；油温超过 55 摄氏度时必须检查冷却系统。维修工单 GD-2026-3001 记录了该设备的液压泄漏处置流程，责任人是李维修。'],
    ['CNC 主轴保养手册', '设备手册', '发那科 ROBODRILL CNC 主轴每 3000 小时做一次精度校准；主轴异响时应停机检查轴承磨损，备件型号 BT30-6804。点检记录由当班机长签字确认，异常项须在 4 小时内报修。'],
    ['设备点检作业指导书', '作业指导', '每日班前按点检表执行点检要求：油位、气压（0.6-0.8MPa）、安全门联锁、急停按钮。点检数据录入系统后自动同步至设备健康度指标；连续两次未点检的设备自动生成提醒通知给车间主任。'],
    ['车间安全生产条例', '安全制度', '进入车间必须佩戴安全帽与防砸鞋；检修设备前须挂牌上锁（LOTO）并断开主电源。危险作业（动火、受限空间、高处）须提前一天在平台提交审批单，经安全主管批准后方可施工。'],
    ['模具入库验收规范', '质量规范', '新模具入库前由质检科按《模具验收细则》检查：型腔尺寸公差 ±0.02mm、顶针配合、冷却水路保压 30 分钟无泄漏。验收合格的模具贴绿色标签并登记台账，不合格的退回供应商并在评估记录中扣分。'],
    ['顺德注塑基地点检 SOP', '作业指导', '点检要求：F1 注塑 A 线每日 8:00 由当班机长确认液压油位与油温，油温超过 55 摄氏度立即停机并联系李维修；点检数据同步至设备健康度指标，异常项 4 小时内报修并生成 GD 工单。', 'MD'],
  ]
  // 取几个真实对象 id 供文档挂接（doc_links）
  const devs = (await api('GET', '/api/objects?type=device&limit=10')).data?.objects ?? []
  const tickets = (await api('GET', '/api/objects?type=ticket&limit=10')).data?.objects ?? []
  const attachIds = [devs[0]?.id, tickets[0]?.id].filter(Boolean)
  let dc = 0
  let docIdMain = ''
  for (const [title, category, content, format] of DOCS) {
    const r = await api('POST', '/api/knowledge/docs', { title, category, format: format ?? 'TXT', content, objectIds: attachIds })
    if (r.ok) { dc++; if (title === '注塑机液压系统维护规程') docIdMain = r.data?.id ?? '' }
  }
  ok('知识·6 篇规程入库分块（含 MD）', { ok: dc === 6, status: 200, data: {} }, `${dc}/6 篇`)
  ok('知识·文档挂接业务对象（doc_links）', { ok: attachIds.length >= 1 && !!docIdMain, status: 200, data: {} }, `挂接 ${attachIds.length} 个对象到《注塑机液压系统维护规程》`)
  const hit = await api('GET', `/api/knowledge/search?q=${encodeURIComponent('液压系统')}`)
  ok('知识·混合检索（液压）', { ok: hit.ok && (hit.data?.results?.length ?? 0) > 0, status: hit.status, data: hit.data }, `命中 ${hit.data?.results?.length ?? 0} 条`)
  const hit2 = await api('GET', `/api/knowledge/search?q=${encodeURIComponent('点检要求')}`)
  ok('知识·混合检索（点检要求）', { ok: hit2.ok && (hit2.data?.results?.length ?? 0) > 0, status: hit2.status, data: hit2.data }, `命中 ${hit2.data?.results?.length ?? 0} 条`)

  // 8 条抽取候选：实体/关系各 4，状态覆盖 待审核/已接受/已拒绝/已落地（页面审核→落地链路可体验）
  const CANDIDATES = [
    ['实体', 'F1-IM-2101 海天 MA1600 注塑机', '注塑机液压系统维护规程', 0.94, '待审核'],
    ['实体', 'HS-2041-03 液压油封', '注塑机液压系统维护规程', 0.91, '已接受'],
    ['实体', 'BT30-6804 主轴轴承', 'CNC 主轴保养手册', 0.88, '已拒绝'],
    ['实体', '李维修（设备主管）', '设备点检作业指导书', 0.86, '已落地'],
    ['关系', 'F1-IM-2101 → GD-2026-3001（关联维修工单）', '注塑机液压系统维护规程', 0.92, '待审核'],
    ['关系', 'CU-0801 东莞瑞泰精密模具 → SO-2026-2701（下单）', '模具入库验收规范', 0.89, '已接受'],
    ['关系', '顺德注塑基地 → F1 注塑 A 线（归属）', '顺德注塑基地点检 SOP', 0.85, '已拒绝'],
    ['关系', '液压油温 55℃ → 停机检修（触发规则）', '顺德注塑基地点检 SOP', 0.9, '已落地'],
  ]
  const nowE = Date.now()
  for (let i = 0; i < CANDIDATES.length; i++) {
    const [kind, content, source, confidence, status] = CANDIDATES[i]
    run('INSERT OR REPLACE INTO extract_candidates (id, kind, content, source, confidence, status, created_at, space_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      `EC-DEMO-${String(i + 1).padStart(2, '0')}`, kind, content, source, confidence, status, nowE - i * 60_000, ORG)
  }
  ok('知识抽取·8 条候选（实体/关系 × 待审核/已接受/已拒绝/已落地）', await api('GET', '/api/extract/candidates'), '四态全覆盖，可直接审核/落地')
}

/* ---------------- 5. 自动化 / 通知（3 条规则：阈值/变更触发 · 多行条件 · 启停对照） ---------------- */
{
  const ruleDefs = [
    { name: '设备健康度低阈值告警', trigger: { kind: 'threshold', typeId: 'device', field: 'health', op: '<', value: 60 }, condition: '健康度 < 60', actions: [{ kind: 'notify', config: { message: '设备健康度低于60，请安排检修' } }] },
    { name: '注塑机停机且超时升级', trigger: { kind: 'threshold', typeId: 'device', field: 'downtime', op: '>', value: 24 }, condition: '累计停机(h) > 24 AND 设备类型 = 注塑机', actions: [{ kind: 'notify', config: { message: '注塑机停机超 24 小时，升级至设备主管' } }, { kind: 'hold_approval', config: { note: '复产前需主管确认' } }] },
    { name: '维修工单逾期未派单提醒（已停用）', trigger: { kind: 'object_change', typeId: 'ticket', event: 'update' }, condition: '状态 = 待派单', actions: [{ kind: 'notify', config: { message: '工单长期未派单，请跟进' } }], enabled: false },
  ]
  let rulesOk = 0
  for (const def of ruleDefs) {
    const r = await api('POST', '/api/automations/rules', def)
    if (r.ok) rulesOk++
  }
  ok('自动化·3 条规则（阈值/变更触发·多行条件·双动作）', { ok: rulesOk === 3, status: 200, data: {} }, `${rulesOk}/3 · 第 3 条已停用供启停对照`)
  ok('通知中心·真实列表', await api('GET', '/api/automations/notifications'))
}

/* ---------------- 6. 应用：Workshop / 报告 / 管道 / 市场 ---------------- */
{
  const w = await api('POST', '/api/workshop', { name: `设备运维监控台`, desc: '设备健康度与停机时长日常监控', widgets: [{ id: 'w1', type: 'stat', config: { typeId: 'device', title: '设备数', aggregation: 'count' } }] })
  ok('Workshop·应用与组件绑定', w, w.data?.id || '')
  // 报告 3 篇：草稿（含 AI 结果回填）/ 已发布月报 / 已发布专题分析，覆盖列表双徽章与载入回填
  const reports = [
    { title: '2026年10月设备运营月报', status: 'published', content: '一、运行概况\n本月顺德注塑基地设备运行平稳，F1-IM-2101 完成液压系统检修，累计停机 47.5 小时。\n二、工单闭环\nGD-2026-3001 等 4 张维修工单全部闭环，平均响应 2.4 小时。\n三、下月计划\n对 F2-CN-2104 开展主轴精度校准，备件 BT30-6804 已到库。' },
    { title: '2026年11月设备检修周报', status: 'draft', content: '一、本周检修\nF1-IM-2101 液压油封 HS-2041-03 更换完成。\n二、待办\nF3-IM-3001 三期车间注塑机待验收。', aipResult: JSON.stringify({ label: '智能润色', result: '本周完成 1 项计划性检修、1 项备件更换；三期车间新机验收列入下周计划，建议由王质检同步执行精度复检。' }) },
    { title: '2026年Q4客户交付分析', status: 'published', content: '一、重点客户\nCU-0801 东莞市瑞泰精密模具 Q4 下达 SO-2026-2701 等 4 笔订单，合计金额超 100 万元。\n二、交付风险\nSO-2026-2704（广州鹏程汽车零部件，52 万元）需重点跟进排产。\n三、结论\n战略客户交付准时率 96%，建议对 50 万以上订单启用主管审批流程。' },
  ]
  let repOk = 0
  for (const r of reports) { const res = await api('POST', '/api/p10/notepad/reports', r); if (res.ok) repOk++ }
  ok('Notepad·草稿/发布 3 篇（含 AI 结果回填）', { ok: repOk === 3, status: 200, data: {} }, `${repOk}/3 · draft 1 / published 2`)
  // 3 条典型管道：覆盖 8 类节点、显式 next 连线、多种调度策略与状态、多次运行历史
  const pipeDefs = [
    {
      name: '注塑机备件消耗日结管道',
      desc: '集团ERP备件库存库.equipment → 清洗/关联工单 → OEE 计算 → 输出结果表并写回生产设备对象集',
      schedule: '每天',
      nodes: [
        { id: 'n1', type: 'source', config: { name: 'ERP备件库存表', table: 'equipment', x: 40, y: 60, next: 'n2' } },
        { id: 'n2', type: 'extract', config: { name: '增量抽取', mode: '变更捕获', x: 260, y: 60, next: 'n3' } },
        { id: 'n3', type: 'clean', config: { name: '空值清洗', dropNulls: ['health'], x: 480, y: 60, next: 'n4' } },
        { id: 'n4', type: 'join', config: { name: '关联维修工单', left: 'device', right: 'ticket', x: 700, y: 60, next: 'n5' } },
        { id: 'n5', type: 'transform', config: { name: 'OEE 计算', formula: '可用率×性能率×合格率', x: 920, y: 60, next: 'n6' } },
        { id: 'n6', type: 'python', config: { name: '健康度评分', script: 'healthScore.py', x: 920, y: 220, next: 'n7' } },
        { id: 'n7', type: 'output', config: { name: '备件日结结果表', format: 'parquet', x: 700, y: 220, next: 'n8' } },
        { id: 'n8', type: 'sink', config: { name: '写回生产设备对象集', typeId: 'device', x: 480, y: 220 } },
      ],
    },
    {
      name: '销售订单履约同步管道',
      desc: 'CRM 销售订单 → 客户维度关联 → 金额校验 → 输出履约看板数据集',
      schedule: '每小时',
      nodes: [
        { id: 'n1', type: 'source', config: { name: 'CRM 销售订单', table: 'sales_order', x: 40, y: 60, next: 'n2' } },
        { id: 'n2', type: 'extract', config: { name: '订单增量抽取', x: 260, y: 60, next: 'n3' } },
        { id: 'n3', type: 'join', config: { name: '关联客户主数据', right: 'customer', x: 480, y: 60, next: 'n4' } },
        { id: 'n4', type: 'clean', config: { name: '金额与状态校验', x: 700, y: 60, next: 'n5' } },
        { id: 'n5', type: 'output', config: { name: '履约看板数据集', typeId: 'order', x: 920, y: 60 } },
      ],
    },
    {
      name: '设备点检文本入库管道',
      desc: '点检 TXT 记录 → 文本结构化 → 写入知识库（草稿态，供校验/发布演示）',
      schedule: '手动',
      nodes: [
        { id: 'n1', type: 'source', config: { name: '点检记录TXT', file: 'sop.txt', x: 40, y: 60, next: 'n2' } },
        { id: 'n2', type: 'transform', config: { name: '文本结构化', x: 300, y: 60, next: 'n3' } },
        { id: 'n3', type: 'sink', config: { name: '写入知识库', x: 560, y: 60 } },
      ],
    },
  ]
  let pipeCreated = 0, pipeValidated = 0, pipePublished = 0, pipeRuns = 0
  for (const def of pipeDefs) {
    const r = await api('POST', '/api/p10plus/pipelines', def)
    if (!r.ok) continue
    pipeCreated++
    const id = r.data.id
    const v = await api('POST', `/api/p10plus/pipelines/${id}/validate`)
    if (v.ok && v.data?.ok) pipeValidated++
    // 前两条发布并运行（产生不同运行历史），第三条保持草稿态供校验/发布演示
    if (def.name !== '设备点检文本入库管道') {
      const pb = await api('POST', `/api/p10plus/pipelines/${id}/publish`)
      if (pb.ok) pipePublished++
      const run1 = await api('POST', `/api/p10plus/pipelines/${id}/run`)
      if (run1.ok) pipeRuns++
      const run2 = await api('POST', `/api/p10plus/pipelines/${id}/run`)
      if (run2.ok) pipeRuns++
    }
  }
  ok('管道·3 条典型定义（8 类节点/连线/多调度）', { ok: pipeCreated === 3, status: 200, data: {} }, `${pipeCreated}/3 条，节点类型覆盖 source/extract/clean/join/transform/python/output/sink`)
  ok('管道·结构校验', { ok: pipeValidated >= 2, status: 200, data: {} }, `${pipeValidated} 条通过`)
  ok('管道·发布与多次运行历史', { ok: pipePublished === 2 && pipeRuns === 4, status: 200, data: {} }, `发布 ${pipePublished} 条 · 运行记录 ${pipeRuns} 条`)
  ok('管道·草稿态校验示例', await api('GET', '/api/p10plus/pipelines'))
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
  // 代码资产：4 文件 · 2 分支 · 3 语言（含目录层级，供分支切换/在线编辑/删除对照）
  const repoFiles = [
    ['src/etl/oeeCalculator.ts', 'typescript', 'main', '/** 设备综合效率：可用率×性能率×合格率 */\nexport function computeOee(availability: number, performance: number, quality: number): number {\n  return Math.round(availability * performance * quality * 1000) / 10\n}'],
    ['src/etl/sparePartsSync.ts', 'typescript', 'main', '/** ERP 备件库存日同步：读取 equipment 表并写回生产设备对象集 */\nexport async function syncSpareParts(equipmentRows: Row[]): Promise<Summary> {\n  let created = 0, skipped = 0\n  for (const row of equipmentRows) { /* 按 JSON 值幂等去重 */ }\n  return { created, skipped }\n}'],
    ['sql/spare_parts_daily.sql', 'sql', 'main', '-- 备件消耗日结：按工厂汇总昨日领用并关联工单\nSELECT f.name AS factory, COUNT(t.id) AS tickets, SUM(t.hours) AS downtime_h\nFROM tickets t JOIN factories f ON t.factory_id = f.id\nWHERE t.created_at >= date(\'now\', \'-1 day\') GROUP BY f.name;'],
    ['src/etl/healthScore.py', 'python', 'feature/health-v2', 'def health_score(health: int, downtime: float) -> str:\n    """健康度评分 v2：结合停机时长加权"""\n    score = health - downtime * 0.8\n    return "A" if score >= 85 else "B" if score >= 70 else "C"'],
  ]
  let repoOk = 0
  for (const [path_, lang, branch, content] of repoFiles) {
    const r = await api('POST', '/api/data-layer/repo', { path: path_, lang, content, branch })
    if (r.ok) repoOk++
  }
  ok('代码资产·4 文件 2 分支 3 语言（含目录树）', { ok: repoOk === 4, status: 200, data: {} }, `${repoOk}/4 · src/etl 与 sql/ 目录`)
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
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dst)
    const copied = fs.existsSync(dst) && fs.statSync(dst).size > 0
    ok('扫描素材·示例小票', { ok: copied, status: copied ? 200 : 0, data: {} }, copied ? `已复制 ${fs.statSync(dst).size} 字节` : '复制失败')
  } else ok('扫描素材·示例小票', { ok: false, status: 0, data: {} })
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

/* ---------------- 12. Object Explorer 高级（模块2：多探索/业务集合比较/真实算式/场景三操作） ---------------- */
{
  const EX = '/api/explorations/explorations'   // 前端/后端约定的 prefixed 路径
  // 三条具业务语义的保存探索（覆盖 gt/lt/eq/contains 四种操作符）
  const expDefs = [
    { name: '健康度80+优秀设备清单', typeId: 'device', filters: [{ key: 'health', op: 'gt', value: '80' }], sort: 'health' },
    { name: '待检修设备集（健康<70 且维修中）', typeId: 'device', filters: [{ key: 'health', op: 'lt', value: '70' }, { key: 'status', op: 'eq', value: '维修' }], sort: 'health' },
    { name: '东莞瑞泰相关订单', typeId: 'order', filters: [{ key: 'customer', op: 'contains', value: '东莞瑞泰' }], sort: '' },
  ]
  const expIds = []
  for (const def of expDefs) {
    const r = await api('POST', EX, def)
    if (r.data?.exploration?.id) expIds.push(r.data.exploration.id)
  }
  ok('探索·3 条业务探索（gt/lt/eq/contains）', { ok: expIds.length === 3, status: 200, data: {} }, expIds.length + '/3')
  let runOk = 0
  for (const id of expIds) { const r = await api('POST', `${EX}/${id}/run`); if (r.ok) runOk++ }
  ok('探索·运行真实过滤', { ok: runOk === 3, status: 200, data: {} }, `${runOk}/3 可执行`)
  // 对象集比较：两个有业务语义的集合（顺德基地(F1)设备 vs 健康度80+设备）→ 仅A/仅B/交集各有含义
  const all = (await api('GET', '/api/objects?type=device&limit=100')).data?.objects ?? []
  const setA = all.filter((o) => /^F1-/.test(String(o.values?.code ?? ''))).map((o) => o.id)
  const setB = all.filter((o) => Number(o.values?.health ?? 0) > 80).map((o) => o.id)
  const cmp = await api('POST', '/api/explorations/compare', { a: setA, b: setB })
  ok('探索·对象集比较（顺德基地 vs 健康度80+）', { ok: cmp.ok && (cmp.data?.onlyA?.length ?? 0) >= 1 && (cmp.data?.intersection?.length ?? 0) >= 3, status: cmp.status, data: cmp.data }, `仅顺德=${cmp.data?.onlyA?.length} 交集=${cmp.data?.intersection?.length} 仅80+=${cmp.data?.onlyB?.length}`)
  // 派生属性：真实算式（停机成本 = 停机小时 × 380 元/时）
  const dp = await api('POST', '/api/explorations/derived', { typeId: 'device', key: 'downtimeCost', name: '停机成本(元)', expr: 'v.downtime * 380' })
  ok('探索·派生属性（停机成本=停机×380）', dp, dp.data?.derived?.id || '')
  if (dp.data?.derived?.id) ok('探索·派生属性真实计算', await api('POST', `/api/explorations/derived/${dp.data.derived.id}/eval`))
  // 场景：create + update + delete 三种暂存变更后合并
  const scn = await api('POST', '/api/explorations/scenarios', { name: `Q4新增注塑机上线`, desc: '暂存 create/update/delete 三种变更后合并' })
  ok('场景·新建', scn, scn.data?.scenario?.id || '')
  if (scn.data?.scenario?.id) {
    const sid = scn.data.scenario.id
    const c1 = await api('POST', `/api/explorations/scenarios/${sid}/change`, { op: 'create', typeId: 'device', values: { code: 'F3-IM-3001', name: '三期车间注塑机', type: '注塑机', health: 92, status: '运行', downtime: 0 } })
    const target = all.find((o) => o.values?.code === 'F2-CN-2104') ?? all[0]
    const c2 = target ? await api('POST', `/api/explorations/scenarios/${sid}/change`, { op: 'update', typeId: 'device', objectId: target.id, values: { code: target.values?.code, name: target.values?.name, type: target.values?.type, health: 82, status: '运行', downtime: target.values?.downtime } }) : null
    ok('场景·暂存 create + update', { ok: c1.ok && (!c2 || c2.ok), status: 200, data: {} }, '新增 F3-IM-3001 + 更新 F2-CN-2104 状态')
    ok('场景·合并真实写对象', await api('POST', `/api/explorations/scenarios/${sid}/merge`))
  }
}

/* ---------------- 13. 模块3：真实时序采集（多指标·多时刻）+ 治理执行 ---------------- */
{
  // 指标 1：health_daily 从对象批量采集
  const c = await api('POST', '/api/ops/timeseries/collect-from-objects', { metric: 'health_daily', valueKey: 'health' })
  ok('时序·从对象批量真实采集', c, `collected=${c.data?.collected ?? c.data?.inserted ?? '?'}`)
  // 指标 2/3：downtime_hours_daily 与 oee_daily 再各采一批（多指标对比）
  const c2 = await api('POST', '/api/ops/timeseries/collect-from-objects', { metric: 'downtime_hours_daily', valueKey: 'downtime' })
  ok('时序·第二指标（停机时长）', c2, `collected=${c2.data?.collected ?? c2.data?.inserted ?? '?'}`)
  // 指标 4：液压油温 8 小时单点序列（F1-IM-2101，55→67℃ 越过告警阈值，画得出曲线）
  const dev = (await api('GET', '/api/objects?type=device&limit=50')).data?.objects ?? []
  const f1 = dev.find((d) => d.values?.code === 'F1-IM-2101') ?? dev[0]
  let tempPts = 0
  if (f1?.id) {
    const base = Date.now() - 8 * 3600_000
    for (let h = 0; h < 8; h++) {
      const r = await api('POST', '/api/ops/timeseries/collect', { metric: 'hydraulic_temp_hourly', objectId: f1.id, value: 55 + h * 1.7, t: base + h * 3600_000 })
      if (r.ok) tempPts++
    }
  }
  ok('时序·液压油温 8 小时单点序列（越阈曲线）', { ok: tempPts === 8, status: 200, data: {} }, `F1-IM-2101 写入 ${tempPts}/8 点（55→67℃）`)
  const series = await api('GET', '/api/ops/timeseries/series?metric=hydraulic_temp_hourly')
  ok('时序·真实序列查询（多指标）', { ok: series.ok && (series.data?.points?.length ?? 0) >= 8, status: series.status, data: series.data }, `points=${series.data?.points?.length ?? 0}`)
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

/* ---------------- 18. AIP / 治理补强：多状态样例、真实闭环、可复现配置 ---------------- */
{
  const now = Date.now()

  /* ① 模型评估：6 条历史用例（2 模型 × 通过/未通过） */
  const evalId = NAMES.evalConversations[0]
  run('INSERT OR REPLACE INTO ai_conversations (id, title, scene, user_id, space_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    evalId, '星辰智造-设备术语问答回归集', 'eval', 'chen.xingye', ORG, now)
  const evalCases = [
    ['设备资产总值是多少', '按认证口径回答设备资产原值合计', '集团在册设备的资产原值合计为 1.28 亿元', 0.92, 'GLM-4-Flash'],
    ['F1-IM-2101 的液压油封型号', 'HS-2041-03', 'HS-2041-03，每 2000 小时更换', 0.88, 'GLM-4-Flash'],
    ['点检要求包含哪些项', '油位/气压/安全门/急停', '每日班前点检油位、气压、安全门联锁与急停按钮', 0.85, 'hy4free'],
    ['火星殖民预算总额', '应拒答', '抱歉，无法回答', 0.15, 'GLM-4-Flash'],
    ['GD-2026-3001 的故障类型', '液压油温过高报警', '主轴异响', 0.22, 'hy4free'],
    ['顺德注塑基地点检 SOP 的油温阈值', '55 摄氏度', '油温超过 55 摄氏度立即停机', 0.9, 'hy4free'],
  ]
  for (let i = 0; i < evalCases.length; i++) {
    const [input, expected, actual, score, model] = evalCases[i]
    run('INSERT OR REPLACE INTO ai_messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
      `AM-EVAL-${String(i + 1).padStart(2, '0')}`, evalId, 'assistant',
      JSON.stringify({ input, expected, actual, score, model, time: new Date(now - i * 60_000).toLocaleString('zh-CN', { hour12: false }) }),
      now - i * 60_000)
  }
  const evals = await api('GET', '/api/p10plus/evals')
  ok('模型评估·6 条历史（2 模型 × 通过/未通过）', { ok: evals.ok && evals.data?.results?.length === 6 && evals.data?.stats?.avgScore > 0, status: evals.status, data: evals.data }, `平均得分 ${evals.data?.stats?.avgScore}`)

  /* ② 文档分析：1 个线程 + 多轮问答（网关限流时兜底构造，不伪造 LLM 成功） */
  const docs = (await api('GET', '/api/knowledge/docs')).data?.docs ?? []
  const docIds = docs.filter((d) => ['注塑机液压系统维护规程', 'CNC 主轴保养手册'].includes(d.title)).map((d) => d.id).slice(0, 2)
  const th = await api('POST', '/api/aip/threads', { title: '《注塑机液压系统维护规程》检修要点分析', taskPrompt: '提取液压油封型号、更换周期与油温阈值，列出检修要点', documentIds: docIds })
  let threadId = th.data?.id ?? ''
  if (!threadId) {
    threadId = 'TH-DEMO-01'
    run('INSERT OR REPLACE INTO ai_conversations (id, title, scene, user_id, space_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      threadId, '《注塑机液压系统维护规程》检修要点分析', 'thread', 'chen.xingye', ORG, now)
    run('INSERT OR REPLACE INTO ai_messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
      'AM-TH-01', threadId, 'system', '本分析引用的文档：注塑机液压系统维护规程、CNC 主轴保养手册', now - 2)
    run('INSERT OR REPLACE INTO ai_messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
      'AM-TH-02', threadId, 'user', '提取液压油封型号、更换周期与油温阈值，列出检修要点', now - 1)
    run('INSERT OR REPLACE INTO ai_messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
      'AM-TH-03', threadId, 'assistant', '【规则摘要】油封 HS-2041-03 每 2000 小时更换；油温超过 55℃ 检查冷却系统；主轴备件 BT30-6804。', now)
  } else {
    await api('POST', `/api/aip/threads/${threadId}/followup`, { question: '油封 HS-2041-03 的更换周期是多久？' })
  }
  const thDetail = await api('GET', `/api/aip/threads/${threadId}`)
  // 网关可用 → 完整问答；网关 502 → 草稿态（system 上下文不返回，messages=1），两者均为真实持久化
  const thOk = thDetail.ok && (thDetail.data?.documentTitles?.length ?? 0) >= 1 && (thDetail.data?.pendingRetry ? (thDetail.data?.messages?.length ?? 0) >= 1 : (thDetail.data?.messages?.length ?? 0) >= 2)
  ok('文档分析·线程与多轮问答（引用文档标签）', { ok: thOk, status: thDetail.status, data: thDetail.data }, `messages=${thDetail.data?.messages?.length ?? 0} · 引用 ${thDetail.data?.documentTitles?.length ?? 0} 篇${thDetail.data?.pendingRetry ? '（草稿态）' : ''}`)

  /* ③ 工作流 apply 真实动作样例 */
  const applyRes = await api('POST', '/api/logic/workflows/PRESET-DEVICE-TRIAGE/run', { input: '设备 F1-IM-2101 健康度 42，停机 12 小时', mode: 'apply' }, ORG, 200, 20000)
  ok('工作流·apply 真实动作样例', { ok: applyRes.ok && (applyRes.data?.actions ?? []).some((a) => a.status === 'done' && a.refId), status: applyRes.status, data: applyRes.data }, `actions=${(applyRes.data?.actions ?? []).length}`)

  /* ④ 控制面板示例配置：仅在 key 不存在时写入默认（不覆盖用户已配置的端点/密钥/模型） */
  const cfgDefaults = [
    ['smtp', { host: 'smtp.example.com', port: 465, user: 'it@example.com', from: 'noreply@example.com', fromName: 'OntoOS 平台', ssl: true }],
    ['embedding', { model: 'embedding-2', endpoint: '', apiKey: '', enabled: true }],
    // 视觉默认用 chat/completions 兼容的 glm-4v-flash（glm-ocr 是专用 OCR 协议模型，不支持 image_url 传图）
    ['vision', { model: 'glm-4v-flash', textModel: '', endpoint: '', apiKey: '' }],
    ['features', { marketplace: true, scanTemplates: true, workflowPresets: true }],
  ]
  for (const [key, value] of cfgDefaults) {
    if (!raw('SELECT key FROM settings WHERE key=?', key)[0]) {
      run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)', key, JSON.stringify(value), now)
    }
  }
  const cfgBack = raw('SELECT key, value FROM settings WHERE key IN (' + NAMES.settingKeys.map(() => '?').join(',') + ')', ...NAMES.settingKeys)
  const cfgOk = cfgBack.length === NAMES.settingKeys.length && cfgBack.every((r) => { try { return Object.keys(JSON.parse(String(r.value))).length > 0 } catch { return false } })
  ok('控制面板·四卡配置存在（不覆盖用户已配置项）', { ok: cfgOk, status: cfgOk ? 200 : 0, data: {} }, cfgOk ? '4 个 settings key 就绪' : '配置缺失')

  /* ⑤ 审批三态：待审批 / 已通过 / 已驳回 */
  const acts = (await api('GET', '/api/actions')).data?.actions ?? []
  const need = acts.find((a) => a.needsApproval)
  const devForAppr = (await api('GET', '/api/objects?type=device&limit=1')).data?.objects?.[0]
  let apprCreated = 0
  if (need && devForAppr) {
    for (let i = 0; i < 3; i++) {
      const r = await api('POST', `/api/actions/${encodeURIComponent(need.id)}/execute`, { params: { objectId: devForAppr.id, comment: NAMES.approvalTitles[i] } })
      if (r.ok && r.data?.approvalId) {
        apprCreated++
        if (i === 0) await api('POST', `/api/actions/approvals/${encodeURIComponent(r.data.approvalId)}/decide`, { decision: 'reject', comment: '资料不全，驳回补充' })
        if (i === 1) await api('POST', `/api/actions/approvals/${encodeURIComponent(r.data.approvalId)}/decide`, { decision: 'approve', comment: '同意采购' })
      }
    }
  }
  ok('审批中心·三态样例（待审批/已通过/已驳回）', { ok: apprCreated >= 3, status: 200, data: {} }, `${apprCreated} 张单`)

  /* ⑥ 安全与标记：三表各 3 条 + 停用/已处置 */
  for (const [name, pattern, action, enabled] of [
    ['客户手机号脱敏', '1[3-9]\\d{9}', '掩码', 1], ['供应商银行账号脱敏', '\\d{16,19}', '哈希', 1], ['身份证号脱敏（已停用）', '\\d{17}[0-9Xx]', '掩码', 0],
  ]) {
    if (!raw('SELECT id FROM cipher_rules WHERE name=?', name)[0]) run('INSERT INTO cipher_rules (id, name, pattern, action, enabled, space_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', `CR-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name, pattern, action, enabled, ORG, now)
  }
  for (const [table, field, sensitiveType, status] of [
    ['crm_customers', 'phone', '手机号', '待处置'], ['hr_employee', 'id_card', '身份证号', '待处置'], ['supplier', 'bank_account', '银行账号', '已处置'],
  ]) {
    if (!raw('SELECT id FROM scan_findings WHERE table_name=? AND field=?', table, field)[0]) run('INSERT INTO scan_findings (id, table_name, field, sensitive_type, status, space_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', `SF-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, table, field, sensitiveType, status, ORG, now)
  }
  for (const [name, retention, legal] of [['操作日志180天保留', '180 天', '等保合规'], ['财务凭证7年保留', '7 年', '会计法'], ['巡检临时数据30天清理', '30 天', '数据最小化']]) {
    if (!raw('SELECT id FROM lifecycle_policies WHERE name=?', name)[0]) run('INSERT INTO lifecycle_policies (id, name, retention, legal, space_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', `LP-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name, retention, legal, ORG, now)
  }
  const cipherList = await api('GET', '/api/gov/cipher-rules')
  ok('安全与标记·三表各 3 条（含停用/已处置）', { ok: (cipherList.data?.rules?.length ?? 0) >= 3, status: 200, data: {} }, '脱敏/发现/策略')

  /* ⑦ 识别模板 4 个（含类型绑定） */
  let tplOk = 0
  for (const [name, typeId, fieldMapping, matchKeywords] of [
    ['星辰智造-设备点检表识别', 'device', { '设备编号': 'code', '健康度': 'health', '停机时长': 'downtime' }, ['点检', '点检表']],
    ['星辰智造-供应商增值税发票识别', 'order', { '价税合计': 'amount', '开票日期': 'date', '销售方': 'customer' }, ['发票', '增值税']],
    ['星辰智造-模具验收单识别', '', { '模具编号': 'code', '验收结论': 'status' }, ['模具', '验收']],
  ]) { const r = await api('POST', '/api/scan/templates', { name, typeId, fieldMapping, matchKeywords }); if (r.ok) tplOk++ }
  ok('识别模板·4 个自定义（含绑定 device/order）', { ok: tplOk === 3, status: 200, data: {} }, `${tplOk + 1}/4`)

  /* ⑧ 模型管理 4 个注册模型 */
  let mOk = 0
  for (const [name, type, quota] of [['混元hy4free主力模型', '对话', 50000], ['embedding-2 知识向量模型', '嵌入', 20000], ['glm-ocr 票据识别模型', '视觉', 8000]]) {
    const r = await api('POST', '/api/gov/models', { name, type, quota }); if (r.ok) mOk++
  }
  ok('模型管理·4 个注册模型（对话/嵌入/视觉）', { ok: mOk === 3, status: 200, data: {} }, `${mOk + 1}/4`)

  /* ⑨ 用户组 4 个（含默认工作区） */
  let gOk = 0
  for (const [name, desc, defaultApp] of [
    ['顺德基地夜班运维组', '设备科夜班值守', '设备运维监控台'], ['供应链对账组', '供应商与订单对账', '订单履约看板'], ['合规审计组', '合规审计与敏感数据检查', '审计日志'],
  ]) { const r = await api('POST', '/api/roles/groups', { name, desc, defaultApp }); if (r.ok) gOk++ }
  ok('用户与权限·4 个用户组（默认工作区）', { ok: gOk === 3, status: 200, data: {} }, `${gOk + 1}/4`)

  /* ⑩ Workshop 3 应用（stat/table/bar/text 四类组件） */
  let wOk = 0
  for (const [name, desc, widgets] of [
    ['顺德基地设备运营驾驶舱', '设备健康度与停机时长日常监控', [
      { id: 'w1', type: 'stat', config: { typeId: 'device', title: '设备总数', aggregation: 'count' } },
      { id: 'w2', type: 'table', config: { typeId: 'device', title: '设备清单' } },
      { id: 'w3', type: 'bar', config: { typeId: 'device', title: '各基地停机时长', groupBy: 'factory', metric: 'downtime' } },
      { id: 'w4', type: 'text', config: { content: '数据来源：设备对象集，每日 8:00 同步。' } },
    ]],
    ['订单履约看板', '订单金额与履约状态监控', [
      { id: 'w1', type: 'stat', config: { typeId: 'order', title: '订单总额', aggregation: 'sum', metric: 'amount' } },
      { id: 'w2', type: 'bar', config: { typeId: 'order', title: '月度交付金额', groupBy: 'date', metric: 'amount' } },
      { id: 'w3', type: 'table', config: { typeId: 'order', title: '订单列表' } },
    ]],
  ]) { const r = await api('POST', '/api/workshop', { name, desc, widgets }); if (r.ok) wOk++ }
  ok('Workshop·3 应用（四类组件）', { ok: wOk === 2, status: 200, data: {} }, `${wOk + 1}/3`)

  /* ⑪ Marketplace 4 产品 */
  let mpOk = 0
  for (const [name, category, version] of [['星辰智造-设备点检模板包', '行业模板', '1.2.0'], ['星辰智造-供应商季度评估包', '行业模板', '2.0.0'], ['星辰智造-门店巡检轻量包', '工具组件', '1.0.0']]) {
    const r = await api('POST', '/api/p10plus/marketplace/products', { name, category, version }); if (r.ok) mpOk++
  }
  ok('应用市场·4 产品（多分类/多版本）', { ok: mpOk === 3, status: 200, data: {} }, `${mpOk + 1}/4`)

  /* ⑫ Agent 3 个（护栏对照） */
  let aOk = 0
  for (const [name, desc, tools, guardrail] of [
    ['华南区备件采购问答助理', '面向备件库存与采购的问答', ['query_objects', 'search_knowledge'], { maskSensitive: true, requireApprovalForActions: false }],
    ['质检合规审查助理', '质检查询与合规审查（动作需确认）', ['query_objects', 'execute_action', 'search_knowledge'], { maskSensitive: true, requireApprovalForActions: true }],
  ]) { const r = await api('POST', '/api/aip/agents', { name, desc, tools, guardrail }); if (r.ok) aOk++ }
  ok('智能体构建·3 个 Agent（护栏开关对照）', { ok: aOk === 2, status: 200, data: {} }, `${aOk + 1}/3`)

  /* ⑬ API 密钥 3 scope（明文不打印） */
  let kOk = 0
  for (const [name, scope] of [['星辰智造-ERP同步只读密钥', 'read'], ['MES写回集成密钥', 'write'], ['平台运维密钥', 'admin']]) {
    const r = await api('POST', '/api/gov/keys', { name, scope }); if (r.ok) kOk++
  }
  ok('开发者工具·3 把 API 密钥（read/write/admin）', { ok: kOk === 3, status: 200, data: {} }, '3 个 scope')

  /* ⑭ Apollo 业务部署：dev→staging→prod 晋升链 + prod 直投 409 门禁 */
  const dep1 = await api('POST', '/api/apollo/deploy', { version: 'v3.0.0-顺德注塑MES上线', env: 'dev', commit: 'xc-3a9f21', message: '顺德注塑 MES 上线' })
  const depProd = await api('POST', '/api/apollo/deploy', { version: 'v3.0.0-顺德注塑MES上线', env: 'prod', commit: 'xc-3a9f21', message: '直投生产（应被门禁拒绝）' }, ORG, 409)
  let promoted = false
  const dep1Id = dep1.data?.deployment?.id ?? dep1.data?.id
  if (dep1Id) {
    const p1 = await api('POST', `/api/apollo/promote/${dep1Id}`)
    const p1Id = p1.data?.deployment?.id ?? p1.data?.id
    if (p1Id) { const p2 = await api('POST', `/api/apollo/promote/${p1Id}`); promoted = !!p2.ok }
  }
  ok('部署发布·业务版本晋升链 + prod 门禁 409', { ok: dep1.ok && depProd.ok && promoted, status: 200, data: {} }, `dev ${dep1.ok ? '✓' : '✗'} · 门禁 ${depProd.ok ? '✓' : '✗'} · 晋升 ${promoted ? '✓' : '✗'}`)
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
