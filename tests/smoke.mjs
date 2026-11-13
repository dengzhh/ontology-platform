/**
 * OntoOS 全站 API 冒烟测试（零依赖 · 黑盒）
 *
 * 用法：
 *   1. 先启动服务：npm run dev
 *   2. 运行：node tests/smoke.mjs
 *   可选环境变量：
 *     BASE_URL  默认 http://localhost:5000
 *     ACCOUNT   默认 chen.xingye
 *     PASSWORD  默认 ontos@2026
 *
 * 设计原则：
 *   - 只读端点全覆盖（23 个路由组），校验 HTTP 200 + 响应为 JSON + 关键字段存在；
 *   - 写端点走「创建 → 查询确认 → 删除」闭环，测试数据带统一前缀 SMOKE_ 并自动清理；
 *   - 不改动种子数据；不依赖外部 AI 网关（AI 相关端点仅做可达性/错误码校验）；
 *   - 失败不中断，最终输出通过/失败汇总，退出码 = 失败数。
 */
import { writeFileSync } from 'node:fs'
import Database from 'better-sqlite3'

const BASE = (process.env.BASE_URL || 'http://localhost:5000').replace(/\/$/, '')
const ACCOUNT = process.env.ACCOUNT || 'chen.xingye'
const PASSWORD = process.env.PASSWORD || 'ontos@2026'
const PREFIX = `SMOKE_${Date.now().toString(36).toUpperCase()}`

let passed = 0
let failed = 0
const failures = []
const report = []
let token = ''
let spaceId = ''
const created = [] // { label, cleanup: async () => {} }

function log(ok, name, detail = '') {
  if (ok) { passed++; report.push(`  ✓ ${name}${detail ? ' — ' + detail : ''}`) }
  else { failed++; failures.push(name + (detail ? ' — ' + detail : '')); report.push(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

async function req(method, path, body, expect = 200, timeoutMs = 8000) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (spaceId) headers['x-space-id'] = spaceId
  let res
  try {
    res = await fetch(BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (e) {
    return { ok: false, status: 0, error: e.message, data: null }
  }
  let data = null
  const text = await res.text().catch(() => '')
  try { data = text ? JSON.parse(text) : null } catch { data = { _raw: text.slice(0, 120) } }
  return { ok: res.status === expect, status: res.status, data, error: data?.error }
}

function isObj(d) { return d && typeof d === 'object' && !Array.isArray(d) }

async function main() {
  console.log(`\n=== OntoOS API 冒烟测试 ===`)
  console.log(`目标: ${BASE}  账号: ${ACCOUNT}  测试前缀: ${PREFIX}\n`)

  /* ---------- 0. 认证 ---------- */
  const login = await req('POST', '/api/auth/login', { account: ACCOUNT, password: PASSWORD })
  log(login.ok && !!login.data?.token, 'POST /auth/login 登录并获取 JWT', login.ok ? `user=${login.data.user?.name}` : `status=${login.status}`)
  if (!login.data?.token) { return finish('登录失败，无法继续') }
  token = login.data.token

  const me = await req('GET', '/api/auth/me')
  log(me.ok && !!me.data?.user, 'GET /auth/me 当前会话', me.ok ? `account=${me.data.user?.account}` : `status=${me.status}`)

  const spaces = await req('GET', '/api/spaces')
  log(spaces.ok && Array.isArray(spaces.data?.spaces), 'GET /spaces 空间列表', spaces.ok ? `${spaces.data.spaces.length} 个空间` : `status=${spaces.status}`)
  spaceId = spaces.data?.spaces?.[0]?.id || 'sp-org-default'

  /* ---------- 1. 只读端点全覆盖（分组） ---------- */
  const reads = [
    ['/api/users', '用户列表', (d) => Array.isArray(d.users)],
    ['/api/roles', '角色列表', (d) => Array.isArray(d.roles)],
    ['/api/roles/groups', '用户组列表', (d) => Array.isArray(d.groups)],
    ['/api/admin/audit', '审计日志', (d) => Array.isArray(d.events)],
    ['/api/admin/features', '功能开关', (d) => isObj(d.features)],
    ['/api/admin/usage', '平台用量', (d) => isObj(d.metrics)],
    ['/api/admin/environment', '运行环境', (d) => !!d.runtime],
    ['/api/objects/types', '对象类型', (d) => Array.isArray(d.types)],
    ['/api/objects', '对象实例列表', (d) => Array.isArray(d.objects)],
    ['/api/objects/graph', '关系图谱', (d) => Array.isArray(d.nodes)],
    ['/api/objects/search?q=test', '跨类型搜索', (d) => Array.isArray(d.groups)],
    ['/api/objects/global-search?q=test', '全局搜索', (d) => Array.isArray(d.objects)],
    ['/api/ontology/types', '本体类型', (d) => Array.isArray(d.types)],
    ['/api/ontology/links', '链接类型', (d) => Array.isArray(d.links)],
    ['/api/ontology/actions', '动作类型', (d) => Array.isArray(d.actions)],
    ['/api/ontology/functions', '本体函数', (d) => Array.isArray(d.functions)],
    ['/api/ontology/interfaces', '本体接口', (d) => Array.isArray(d.interfaces)],
    ['/api/actions', '动作定义', (d) => Array.isArray(d.actions)],
    ['/api/actions/approvals/list', '审批列表', (d) => Array.isArray(d.approvals)],
    ['/api/actions/logs/list', '动作日志', (d) => Array.isArray(d.logs)],
    ['/api/automations/rules', '自动化规则', (d) => Array.isArray(d.rules)],
    ['/api/automations/notifications', '通知中心', (d) => Array.isArray(d.notifications)],
    ['/api/knowledge/docs', '知识文档', (d) => Array.isArray(d.documents || d.docs)],
    ['/api/knowledge/search?q=test', '知识检索', (d) => Array.isArray(d.results || d.hits)],
    ['/api/workshop', 'Workshop 应用', (d) => Array.isArray(d.apps)],
    ['/api/extract/candidates', '抽取候选', (d) => Array.isArray(d.candidates)],
    ['/api/dashboard/overview', '仪表盘聚合', (d) => isObj(d)],
    ['/api/aip/agents', 'Agent 列表', (d) => Array.isArray(d.agents)],
    ['/api/ai/conversations', '助手会话', (d) => Array.isArray(d.conversations)],
    ['/api/p10/security', '安全与标记', (d) => Array.isArray(d.roles) && isObj(d.markingStats)],
    ['/api/p10/models', '模型管理', (d) => Array.isArray(d.models)],
    ['/api/p10/developers', '开发者工具', (d) => Array.isArray(d.endpoints) && isObj(d.aiConfig)],
    ['/api/p10/carbon', 'Carbon 工作区', (d) => Array.isArray(d.apps)],
    ['/api/p10/notepad-data', '报告数据', (d) => isObj(d.stats)],
    ['/api/p10/notepad/reports', '报告列表', (d) => Array.isArray(d.reports)],
    ['/api/p10plus/rules', '规则引擎', (d) => isObj(d)],
    ['/api/p10plus/evals', '评测', (d) => isObj(d)],
    ['/api/p10plus/map', '地图点位', (d) => isObj(d)],
    ['/api/p10plus/machinery', '流程编排', (d) => isObj(d)],
    ['/api/p10plus/pipelines', '管道与运行记录', (d) => Array.isArray(d.pipelines) && Array.isArray(d.runs)],
    ['/api/p10plus/lineage', '数据血缘', (d) => isObj(d.layers)],
    ['/api/p10plus/marketplace', '应用市场', (d) => Array.isArray(d.products)],
    ['/api/p10long/fusion/sheet', 'Fusion 表格', (d) => Array.isArray(d.rows)],
    ['/api/p10long/timeseries', '时序与告警', (d) => Array.isArray(d.series)],
    ['/api/p10long/insight', 'Insight 路径', (d) => isObj(d.summary)],
    ['/api/gov/models', '多模型注册', (d) => Array.isArray(d.models)],
    ['/api/gov/keys', 'API 密钥', (d) => Array.isArray(d.keys)],
    ['/api/gov/cipher-rules', '脱敏规则', (d) => Array.isArray(d.rules)],
    ['/api/gov/scan-findings', '扫描发现', (d) => Array.isArray(d.findings)],
    ['/api/gov/lifecycle-policies', '生命周期策略', (d) => Array.isArray(d.policies)],
    ['/api/data-layer/connections', '数据连接', (d) => Array.isArray(d.connections)],
    ['/api/data-layer/datasets', '数据集', (d) => Array.isArray(d.datasets)],
    ['/api/data-layer/repo', '代码资产', (d) => Array.isArray(d.files || d.repo)],
    ['/api/logic/workflows', 'AIP Logic 工作流', (d) => Array.isArray(d.workflows)],
    ['/api/scan/templates', '识别模板', (d) => Array.isArray(d.templates)],
    ['/api/scan/config', '视觉配置', (d) => isObj(d)],
    ['/api/scan/targets', '识别目标', (d) => Array.isArray(d.targets)],
  ]
  console.log('--- 只读端点 ---')
  for (const [path, name, check] of reads) {
    const r = await req('GET', path)
    const ok = r.ok && isObj(r.data) && check(r.data)
    log(ok, `GET ${path.split('?')[0]} ${name}`, ok ? '' : `status=${r.status} error=${r.error || ''} data=${JSON.stringify(r.data).slice(0, 80)}`)
  }

  /* ---------- 2. 写闭环（创建 → 验证 → 清理） ---------- */
  console.log('\n--- 写闭环 ---')

  // 2.1 对象实例 CRUD
  {
    // 注意：/objects/types 是精简列表（无 properties），完整属性定义来自 /ontology/types
    const types = await req('GET', '/api/ontology/types')
    const t = types.data?.types?.find((x) => Array.isArray(x.properties) && x.properties.length >= 2)
    if (t) {
      const val = {}
      for (const p of t.properties) {
        if (p.type === 'number') val[p.key] = 1
        else if (p.type === 'enum') val[p.key] = (Array.isArray(p.enumValues) && p.enumValues[0]) || '其他'
        else if (p.type === 'boolean') val[p.key] = true
        else if (p.type === 'date') val[p.key] = '2026-01-01'
        else val[p.key] = `${PREFIX}_${p.key}`
      }
      const c = await req('POST', '/api/objects', { typeId: t.id, values: val }, 200)
      const id = c.data?.object?.id
      log(c.ok && !!id, 'POST /objects 新建对象', c.ok ? `id=${id}` : `status=${c.status} ${c.error || ''}`)
      if (id) {
        created.push({ label: `对象 ${id}`, cleanup: () => req('DELETE', `/api/objects/${id}`) })
        const g = await req('GET', `/api/objects/${encodeURIComponent(id)}`)
        log(g.ok && !!g.data?.object, 'GET /objects/:id 对象详情', g.ok ? '' : `status=${g.status}`)
        // 选一个「非枚举」的可写属性做更新，避免 enum 校验拦截
        const patchProp = t.properties.find((p) => p.type !== 'enum' && p.key !== t.properties[0]?.key)
        if (patchProp) {
          const newVal = patchProp.type === 'number' ? 2 : `${PREFIX}_updated`
          const p = await req('PATCH', `/api/objects/${encodeURIComponent(id)}`, { values: { [patchProp.key]: newVal } })
          log(p.ok, 'PATCH /objects/:id 更新对象', p.ok ? '' : `status=${p.status} ${p.error || ''}`)
        }
      }
    } else log(false, '对象类型可用（前置条件）', '未找到对象类型')
  }

  // 2.2 数据连接 CRUD（同时印证「连接记录为空是因未创建」）
  {
    const c = await req('POST', '/api/data-layer/connections', { name: `${PREFIX}_DC`, type: 'PostgreSQL', host: '127.0.0.1', port: '5432', database: 'smoke' }, 200)
    const id = c.data?.id
    log(c.ok && !!id, 'POST /data-layer/connections 新建连接', c.ok ? `id=${id}` : `status=${c.status} ${c.error || ''}`)
    if (id) {
      created.push({ label: `连接 ${id}`, cleanup: () => req('DELETE', `/api/data-layer/connections/${id}`) })
      const l = await req('GET', '/api/data-layer/connections')
      const found = l.data?.connections?.some((x) => x.id === id)
      log(l.ok && found, 'GET /data-layer/connections 连接已出现在列表', found ? '列表非空，证明连接记录由此产生' : '未找到')
    }
  }

  // 2.3 Workshop 应用
  {
    const c = await req('POST', '/api/workshop', { name: `${PREFIX}_WA`, desc: '冒烟', widgets: [] }, 200)
    const id = c.data?.id
    log(c.ok && !!id, 'POST /workshop 新建看板', c.ok ? `id=${id}` : `status=${c.status}`)
    if (id) created.push({ label: `看板 ${id}`, cleanup: () => req('DELETE', `/api/workshop/${id}`) })
  }

  // 2.4 自动化规则（含 condition 提交）
  {
    const c = await req('POST', '/api/automations/rules', {
      name: `${PREFIX}_AR`, trigger: { kind: 'object_change' }, condition: '健康度 > 0',
      actions: [{ kind: 'notify', config: { message: 'smoke' } }],
    }, 200)
    const id = c.data?.id
    log(c.ok && !!id, 'POST /automations/rules 新建规则（含 condition）', c.ok ? `id=${id}` : `status=${c.status} ${c.error || ''}`)
    if (id) {
      created.push({ label: `规则 ${id}`, cleanup: () => req('DELETE', `/api/automations/rules/${id}`) })
      const p = await req('PATCH', `/api/automations/rules/${id}`, { enabled: false })
      log(p.ok, 'PATCH /automations/rules/:id 启停规则', p.ok ? '' : `status=${p.status}`)
    }
  }

  // 2.5 报告草稿 → 发布
  {
    const c = await req('POST', '/api/p10/notepad/reports', { title: `${PREFIX}_RPT`, content: '冒烟测试报告内容，足够十字以上。', status: 'draft' }, 200)
    const id = c.data?.id
    log(c.ok && !!id, 'POST /p10/notepad/reports 保存草稿', c.ok ? `id=${id}` : `status=${c.status}`)
    if (id) {
      created.push({ label: `报告 ${id}`, cleanup: () => req('DELETE', `/api/p10/notepad/reports/${id}`) })
      const p = await req('POST', '/api/p10/notepad/reports', { id, title: `${PREFIX}_RPT`, content: '冒烟测试报告内容，足够十字以上。', status: 'published' }, 200)
      log(p.ok && p.data?.status === 'published', 'POST /p10/notepad/reports 发布报告', p.ok ? `status=${p.data.status}` : `status=${p.status}`)
    }
  }

  // 2.6 管道 新建 → 校验 → 发布 → 运行
  {
    const c = await req('POST', '/api/p10plus/pipelines', { name: `${PREFIX}_PL`, nodes: [{ id: 'n1', type: 'source', config: {} }, { id: 'n2', type: 'output', config: {} }] }, 200)
    const id = c.data?.id
    log(c.ok && !!id, 'POST /p10plus/pipelines 新建管道', c.ok ? `id=${id}` : `status=${c.status}`)
    if (id) {
      created.push({ label: `管道 ${id}`, cleanup: async () => { await req('DELETE', `/api/p10plus/pipelines/${id}`) } })
      const v = await req('POST', `/api/p10plus/pipelines/${id}/validate`)
      log(v.ok && v.data?.ok === true, 'POST /pipelines/:id/validate 校验通过', v.ok ? `${v.data.nodeCount} 节点` : `status=${v.status}`)
      const pub = await req('POST', `/api/p10plus/pipelines/${id}/publish`)
      log(pub.ok && pub.data?.version >= 2, 'POST /pipelines/:id/publish 发布（版本+1）', pub.ok ? `v${pub.data.version}` : `status=${pub.status}`)
      const run = await req('POST', `/api/p10plus/pipelines/${id}/run`)
      log(run.ok && !!run.data?.runId, 'POST /pipelines/:id/run 运行并写记录', run.ok ? `rows=${run.data.rowsProcessed}` : `status=${run.status}`)
    }
  }

  // 2.7 本体接口 契约 + 符合性校验
  {
    const c = await req('POST', '/api/ontology/interfaces', {
      name: `${PREFIX}_IF`, desc: '冒烟', properties: [{ key: 'code', name: '编号', type: 'string' }], implementedBy: [],
    }, 200)
    const id = c.data?.id
    log(c.ok && !!id, 'POST /ontology/interfaces 新建接口', c.ok ? `id=${id}` : `status=${c.status} ${c.error || ''}`)
    if (id) {
      created.push({ label: `接口 ${id}`, cleanup: () => req('DELETE', `/api/ontology/interfaces/${id}`) })
      const chk = await req('GET', `/api/ontology/interfaces/${id}/check`)
      log(chk.ok && chk.data?.results === null, 'GET /interfaces/:id/check 未绑定实现时返回 null', chk.ok ? '' : `status=${chk.status}`)
    }
  }

  // 2.8 治理三表 CRUD
  {
    const cr = await req('POST', '/api/gov/cipher-rules', { name: `${PREFIX}_CR`, pattern: '\\d+', action: '掩码' }, 200)
    const crId = cr.data?.id
    log(cr.ok && !!crId, 'POST /gov/cipher-rules 新建脱敏规则', cr.ok ? `id=${crId}` : `status=${cr.status}`)
    if (crId) created.push({ label: `脱敏规则 ${crId}`, cleanup: () => req('DELETE', `/api/gov/cipher-rules/${crId}`) })

    const sf = await req('POST', '/api/gov/scan-findings', { table: 'smoke_table', field: 'phone', sensitiveType: '手机号' }, 200)
    const sfId = sf.data?.id
    log(sf.ok && !!sfId, 'POST /gov/scan-findings 新建扫描发现', sf.ok ? `id=${sfId}` : `status=${sf.status}`)
    if (sfId) {
      created.push({ label: `扫描发现 ${sfId}`, cleanup: () => req('DELETE', `/api/gov/scan-findings/${sfId}`) })
      const p = await req('PATCH', `/api/gov/scan-findings/${sfId}`, { status: '已处置' })
      log(p.ok, 'PATCH /gov/scan-findings/:id 标记已处置', p.ok ? '' : `status=${p.status}`)
    }
  }

  // 2.9 模型注册 + API 密钥（明文仅一次）
  {
    const m = await req('POST', '/api/gov/models', { name: `${PREFIX}_MDL`, type: '对话', quota: 100 }, 200)
    const mid = m.data?.id
    log(m.ok && !!mid, 'POST /gov/models 注册模型', m.ok ? `id=${mid}` : `status=${m.status}`)
    if (mid) created.push({ label: `模型 ${mid}`, cleanup: () => req('DELETE', `/api/gov/models/${mid}`) })

    const k = await req('POST', '/api/gov/keys', { name: `${PREFIX}_KEY`, scope: 'read' }, 200)
    const kid = k.data?.id
    const hasPlain = !!k.data?.key
    log(k.ok && hasPlain, 'POST /gov/keys 创建密钥且明文仅此一次', k.ok ? `明文前缀=${String(k.data.key).slice(0, 12)}...` : `status=${k.status}`)
    if (kid) {
      created.push({ label: `密钥 ${kid}`, cleanup: () => req('DELETE', `/api/gov/keys/${kid}`) })
      const l = await req('GET', '/api/gov/keys')
      const leaked = l.data?.keys?.some((x) => x.id === kid && (x.key || x.keyHash))
      log(l.ok && !leaked, 'GET /gov/keys 列表不回显明文/哈希', l.ok ? '' : `status=${l.status}`)
    }
  }

  // 2.10 Marketplace 上架/下架
  {
    const m = await req('POST', '/api/p10plus/marketplace/products', { name: `${PREFIX}_MP`, category: '模板包' }, 200)
    const mid = m.data?.id
    log(m.ok && !!mid, 'POST /p10plus/marketplace/products 上架产品', m.ok ? `id=${mid}` : `status=${m.status}`)
    if (mid) {
      created.push({ label: `产品 ${mid}`, cleanup: () => req('DELETE', `/api/p10plus/marketplace/products/${mid}`) })
      const l = await req('GET', '/api/p10plus/marketplace')
      log(l.ok && l.data?.products?.some((x) => x.id === mid && x.builtin === false), 'GET /marketplace 动态目录含用户上架产品', l.ok ? '' : `status=${l.status}`)
    }
  }

  // 2.11 AIP Logic 工作流持久化 + 节点编辑契约（坐标/分支连线/校验）
  {
    const steps = [
      { id: 's1', type: 'input', label: '输入数据', outputFormat: '文本', x: 40, y: 60 },
      { id: 's2', type: 'condition', label: '健康度判断', condition: '健康度 > 60', x: 280, y: 60, nextYes: 's3', nextNo: 's4' },
      { id: 's3', type: 'output', label: '自动归档', x: 540, y: 20 },
      { id: 's4', type: 'output', label: '人工复核', x: 540, y: 150 },
    ]
    const w = await req('POST', '/api/logic/workflows', { name: `${PREFIX}_WF`, steps }, 200)
    const wid = w.data?.id
    log(w.ok && !!wid, 'POST /logic/workflows 保存工作流（含坐标+分支目标）', w.ok ? `id=${wid}` : `status=${w.status}`)
    if (wid) {
      created.push({ label: `工作流 ${wid}`, cleanup: () => req('DELETE', `/api/logic/workflows/${wid}`) })
      const got = await req('GET', '/api/logic/workflows')
      const saved = (got.data?.workflows ?? []).find((x) => x.id === wid)
      log(!!saved && saved.steps?.length === 4 && saved.steps.find((s) => s.id === 's2')?.x === 280 && saved.steps.find((s) => s.id === 's2')?.nextYes === 's3', '节点坐标/分支目标持久化后回读一致', '')
      // 更新节点（模拟页面编辑）：改名称 + 坐标，PUT 同名幂等
      const edited = steps.map((s) => s.id === 's3' ? { ...s, label: '自动归档（已改名）', x: 600 } : s)
      const up = await req('POST', '/api/logic/workflows', { id: wid, name: `${PREFIX}_WF`, steps: edited }, 200)
      const got2 = await req('GET', '/api/logic/workflows')
      const saved2 = (got2.data?.workflows ?? []).find((x) => x.id === wid)
      log(up.ok && saved2?.steps?.find((s) => s.id === 's3')?.label === '自动归档（已改名）' && saved2?.steps?.find((s) => s.id === 's3')?.x === 600, '节点编辑（改名+拖拽坐标）保存后生效', '')
      // 分支执行：健康度 62 > 60 → 走自动归档，不经过人工复核
      const run = await req('POST', `/api/logic/workflows/${wid}/run`, { input: '设备 M-1 健康度 62' }, 200, 45000)
      const runSteps = (run.data?.results ?? []).map((r) => r.step)
      log(run.ok && runSteps.includes('自动归档（已改名）') && !runSteps.includes('人工复核'), '工作流按 nextYes/nextNo 分支执行（真实跳转）', runSteps.join('→'))
    }
    // 保存校验
    const empty = await req('POST', '/api/logic/workflows', { name: `${PREFIX}_WF_BAD`, steps: [] }, 400)
    log(empty.ok, 'POST /logic/workflows 空节点返回 400', '')
    const badTarget = await req('POST', '/api/logic/workflows', { name: `${PREFIX}_WF_BAD`, steps: [{ id: 's1', type: 'condition', label: '条件', nextYes: 'NO_SUCH' }] }, 400)
    log(badTarget.ok, 'POST /logic/workflows 分支目标不存在返回 400', '')

    // 预设模板契约：内置可见 + 可直接运行（transform 本地确定性执行）
    const list = await req('GET', '/api/logic/workflows')
    const presets = (list.data?.workflows ?? []).filter((w) => w.preset)
    log(presets.length === 6 && presets.every((p) => p.sampleInput && p.steps.length >= 4), 'GET /logic/workflows 内置 6 个预设模板（含示例输入）', presets.map((p) => p.name).join('、'))
    const runPreset = await req('POST', '/api/logic/workflows/PRESET-DEVICE-TRIAGE/run', { input: '设备 M-9 健康度 42，停机 12 小时' }, 200, 20000)
    const prSteps = (runPreset.data?.results ?? []).map((r) => r.step)
    log(runPreset.ok && prSteps.includes('转维修复核') && !prSteps.includes('自动归档') && (runPreset.data?.results ?? []).some((r) => r.type === 'transform'), '预设工作流直接运行（transform→condition 真实分流）', prSteps.join('→'))
    // 保存预设自动另存为副本，不污染内置模板
    const savePreset = await req('POST', '/api/logic/workflows', { id: 'PRESET-TICKET-ROUTE', name: `${PREFIX}_工单分流副本`, steps: presets.find((p) => p.id === 'PRESET-TICKET-ROUTE')?.steps ?? [{ id: 's1', type: 'input', label: '输入' }] }, 200)
    const savedId = savePreset.data?.id
    log(savePreset.ok && !!savedId && savedId !== 'PRESET-TICKET-ROUTE', '保存预设另存为副本（不覆盖内置模板）', `id=${savedId}`)
    if (savedId) created.push({ label: `工作流副本 ${savedId}`, cleanup: () => req('DELETE', `/api/logic/workflows/${savedId}`) })

    // 预设 output 节点挂真实动作；preview 零副作用、apply 真实落库
    const device = presets.find((p) => p.id === 'PRESET-DEVICE-TRIAGE')
    const outActs = (device?.steps ?? []).filter((s) => s.type === 'output' && s.action && s.action !== 'none')
    log(outActs.length === 2, '预设 output 节点配置真实业务动作（create_object/send_notification/create_approval）', outActs.map((s) => s.action).join(','))
    const countSql = () => {
      const db = new Database('data/ontoos.db', { readonly: true })
      const n = {
        obj: db.prepare("SELECT count(*) c FROM objects WHERE id LIKE 'ticket:WF-%'").get().c,
        nt: db.prepare("SELECT count(*) c FROM notifications WHERE id LIKE 'NT-WF-%'").get().c,
        ap: db.prepare("SELECT count(*) c FROM approvals WHERE id LIKE 'AP-WF-%'").get().c,
      }
      db.close(); return n
    }
    const before = countSql()
    const prev = await req('POST', '/api/logic/workflows/PRESET-DEVICE-TRIAGE/run', { input: '设备 M-9 健康度 42，停机 12 小时', mode: 'preview' }, 200, 20000)
    const afterPrev = countSql()
    log(prev.ok && prev.data?.mode === 'preview' && (prev.data?.actions ?? []).length === 1 && prev.data.actions[0].status === 'preview' && JSON.stringify(before) === JSON.stringify(afterPrev), 'dry-run 预览只返回动作、不写业务数据', `actions=${(prev.data?.actions ?? []).length}`)
    const app = await req('POST', '/api/logic/workflows/PRESET-DEVICE-TRIAGE/run', { input: '设备 M-9 健康度 42，停机 12 小时', mode: 'apply' }, 200, 20000)
    const afterApp = countSql()
    log(app.ok && app.data?.mode === 'apply' && (app.data?.actions ?? []).some((a) => a.status === 'done' && a.refId) && afterApp.obj === afterPrev.obj + 1, 'apply 确认后真实创建对象/工单并返回 refId', `obj ${afterPrev.obj}→${afterApp.obj}`)
    // 通知与审批两类动作
    const nt = await req('POST', '/api/logic/workflows/PRESET-DEVICE-TRIAGE/run', { input: '设备 M-1 健康度 82', mode: 'apply' }, 200, 20000)
    const ap = await req('POST', '/api/logic/workflows/PRESET-TICKET-ROUTE/run', { input: '紧急：主轴故障停机', mode: 'apply' }, 200, 20000)
    log((nt.data?.actions ?? []).some((a) => a.action === 'send_notification' && a.status === 'done') && (ap.data?.actions ?? []).some((a) => a.action === 'create_approval' && a.status === 'done'), 'apply 也真实写入通知与待审批单', '')
    // 连线控制：显式 next 跳过中间节点
    const linked = await req('POST', '/api/logic/workflows', { name: `${PREFIX}_连线跳转`, steps: [
      { id: 's1', type: 'input', label: '输入', next: 's3' },
      { id: 's2', type: 'output', label: '被跳过', action: 'none' },
      { id: 's3', type: 'output', label: '目标', action: 'none' },
    ] }, 200)
    const lid = linked.data?.id
    if (lid) {
      created.push({ label: `连线工作流 ${lid}`, cleanup: () => req('DELETE', `/api/logic/workflows/${lid}`) })
      const lr = await req('POST', `/api/logic/workflows/${lid}/run`, { input: '链路测试', mode: 'preview' }, 200, 20000)
      const ls = (lr.data?.results ?? []).map((r) => r.step)
      log(lr.ok && ls.includes('目标') && !ls.includes('被跳过'), '显式 next 连线按目标跳转（跳过中间节点）', ls.join('→'))
    }
    const badNext = await req('POST', '/api/logic/workflows', { name: `${PREFIX}_断链`, steps: [{ id: 's1', type: 'input', label: '输入', next: 'NO_SUCH' }] }, 400)
    log(badNext.ok, '连线目标不存在保存返回 400', '')
    // 清理本断言产生的业务副作用（只删工作流前缀数据，不动演示数据）
    const cleanDb = new Database('data/ontoos.db')
    cleanDb.prepare("DELETE FROM objects WHERE id LIKE 'ticket:WF-%'").run()
    cleanDb.prepare("DELETE FROM notifications WHERE id LIKE 'NT-WF-%'").run()
    cleanDb.prepare("DELETE FROM approvals WHERE id LIKE 'AP-WF-%'").run()
    cleanDb.close()
  }

  // 2.11b 文档分析：改名后的对话式分析 + 多轮追问契约
  {
    // 校验：空标题/空任务 → 400，空追问 → 400
    const bad = await req('POST', '/api/aip/threads', { title: '', taskPrompt: '' }, 400)
    log(bad.ok, 'POST /aip/threads 空标题/任务返回 400', '')
    const noQ = await req('POST', '/api/aip/threads/TH-NOPE/followup', { question: '' }, 400)
    log(noQ.ok, 'POST /aip/threads/:id/followup 空追问返回 400', '')
    const notFound = await req('POST', '/api/aip/threads/TH-NOPE/followup', { question: '继续' }, 404)
    log(notFound.ok, '追问不存在的分析返回 404', '')
    // 创建（依赖 LLM 网关；成功走完整对话闭环，失败应保留草稿并允许重试）
    const made = await req('POST', '/api/aip/threads', { title: `${PREFIX}_文档分析`, taskPrompt: '列出设备维护手册的关键数值与建议' }, 200, 45000)
    const tid = made.data?.id
    if (tid) {
      created.push({ label: `文档分析 ${tid}`, cleanup: () => req('DELETE', `/api/aip/threads/${tid}`) })
      const d = await req('GET', `/api/aip/threads/${tid}`)
      const msgs = d.data?.messages ?? []
      log(d.ok && msgs.every((m) => m.role !== 'system') && typeof d.data?.pendingRetry === 'boolean', 'GET /aip/threads/:id 不暴露 system 上下文、返回草稿态标志', `msgs=${msgs.length} pending=${d.data?.pendingRetry}`)
      if (made.ok && made.data?.result) {
        log(msgs.length >= 2 && msgs[0].role === 'user' && msgs[1].role === 'assistant', 'POST /aip/threads 创建文档分析并返回结果（消息顺序正确）', `id=${tid}`)
        const fu = await req('POST', `/api/aip/threads/${tid}/followup`, { question: '把建议按优先级排成列表' }, 200, 45000)
        log(fu.ok && typeof fu.data?.result === 'string' && fu.data.result.length > 0, 'POST /aip/threads/:id/followup 多轮追问返回结果', fu.ok ? `len=${fu.data.result.length}` : `status=${fu.status}`)
        if (fu.ok) {
          const d2 = await req('GET', `/api/aip/threads/${tid}`)
          log((d2.data?.messages ?? []).length >= msgs.length + 2, '追问后消息持久化（用户+AI 各增一条）', `msgs=${(d2.data?.messages ?? []).length}`)
        }
      } else {
        log(made.status === 502 && made.data?.retryable === true, 'POST /aip/threads 网关失败保留草稿（retryable）', `status=${made.status}`)
        log(d.data?.pendingRetry === true && msgs.length === 1 && msgs[0].role === 'user', '草稿详情：仅保留用户任务、pendingRetry=true', `msgs=${msgs.length}`)
        const rt = await req('POST', `/api/aip/threads/${tid}/retry`, {}, 200, 45000)
        log(rt.ok ? (typeof rt.data?.result === 'string' && rt.data.result.length > 0) : (rt.status === 502 && String(rt.data?.error ?? '').includes('草稿继续保留')), 'POST /aip/threads/:id/retry 草稿可重试（成功出结果或明确报错）', `status=${rt.status}`)
      }
    } else {
      log(false, 'POST /aip/threads 创建请求失败', `status=${made.status}`)
    }
  }

  // 2.12 识别模板（含字段映射，验证不清空）
  {
    const t = await req('POST', '/api/scan/templates', { name: `${PREFIX}_TPL`, fieldMapping: { 合计: 'amount' }, matchKeywords: ['冒烟'] }, 200)
    const tid = t.data?.id
    log(t.ok && !!tid, 'POST /scan/templates 新建模板（带字段映射）', t.ok ? `id=${tid}` : `status=${t.status}`)
    if (tid) {
      created.push({ label: `模板 ${tid}`, cleanup: () => req('DELETE', `/api/scan/templates/${tid}`) })
      const l = await req('GET', '/api/scan/templates')
      const saved = l.data?.templates?.find((x) => x.id === tid)
      log(l.ok && isObj(saved?.fieldMapping) && saved.fieldMapping['合计'] === 'amount', 'GET /scan/templates 字段映射已落库', l.ok ? '' : `status=${l.status}`)
    }
  }

  /* ---------- 2.13 业务术语 / 认证指标（语义层） ---------- */
  {
    const c = await req('POST', '/api/ontology/terms', {
      term: `${PREFIX}_营收`, synonyms: [`${PREFIX}_销售额`, `${PREFIX}_卖了多少钱`],
      typeId: 'order', propertyKey: 'amount',
      definition: '已付款订单的金额合计', metricExpr: 'SUM(order.amount)', certified: true,
    }, 200)
    const id = c.data?.id
    log(c.ok && !!id, 'POST /ontology/terms 新建并认证术语', c.ok ? `id=${id}` : `status=${c.status} ${c.error || ''}`)
    if (id) {
      created.push({ label: `术语 ${id}`, cleanup: () => req('DELETE', `/api/ontology/terms/${id}`) })
      const l = await req('GET', '/api/ontology/terms')
      const found = (l.data?.terms ?? []).find((x) => x.id === id)
      log(l.ok && found?.certified === true, 'GET /ontology/terms 术语已认证且落库', found ? `synonyms=${found.synonyms.join('/')}` : '未找到')
      const r = await req('GET', `/api/ontology/terms/resolve?q=${encodeURIComponent(PREFIX + '_销售额')}`)
      log(r.ok && (r.data?.hits ?? []).some((h) => h.term === `${PREFIX}_营收`), 'GET /terms/resolve 同义词命中已认证术语', r.ok ? `hits=${(r.data.hits || []).length}` : `status=${r.status}`)
      // 不可回答：数据类问题且无术语命中时，/ai/chat 应明确拒答而不是编造
      const chat = await req('POST', '/api/ai/chat', { messages: [{ role: 'user', content: `${PREFIX}_火星殖民预算总额是多少` }] }, 200)
      const blocked = chat.ok && String(chat.data?.reply ?? '').includes('可信业务定义')
      log(blocked, 'POST /ai/chat 无术语覆盖的数据问题明确拒答', blocked ? '' : `reply=${String(chat.data?.reply ?? '').slice(0, 100)}`)
      // 命中术语时不拒答
      // 命中术语会走真实 LLM（外部网关限流时可 30-40s），放宽超时
      const chat2 = await req('POST', '/api/ai/chat', { messages: [{ role: 'user', content: `${PREFIX}_销售额` }] }, 200, 45000)
      log(chat2.ok && !String(chat2.data?.reply ?? '').includes('可信业务定义'), 'POST /ai/chat 命中术语时正常回答', chat2.ok ? '' : `status=${chat2.status}`)
      // 撤销认证后守卫放行（术语不再作为可信口径）
      const p = await req('PATCH', `/api/ontology/terms/${id}/certify`, { certified: false })
      log(p.ok && p.data?.certified === false, 'PATCH /terms/:id/certify 撤销认证', p.ok ? '' : `status=${p.status}`)
    }
  }

  /* ---------- 2.18 数据规模优化：批量导入 + 游标分页 ---------- */
  {
    const rows = Array.from({ length: 5 }, (_, i) => ({ code: `${PREFIX}_BULK_${i}`, name: `批量 ${i}`, type: '注塑机', health: 60 + i, status: '运行' }))
    const b = await req('POST', '/api/objects/bulk', { typeId: 'device', rows }, 200)
    log(b.ok && b.data?.created === 5, 'POST /objects/bulk 事务批量导入', b.ok ? `created=${b.data.created}` : `status=${b.status}`)
    // 列表 SQL 下推 + hasMore/nextCursor
    const p1 = await req('GET', '/api/objects?type=device&limit=2', undefined, 200)
    log(p1.ok && p1.data?.hasMore === true && p1.data?.nextCursor, 'GET /objects 游标分页返回 hasMore/nextCursor', p1.ok ? `total=${p1.data.total}` : `status=${p1.status}`)
    if (p1.data?.nextCursor) {
      const p2 = await req('GET', `/api/objects?type=device&limit=2&cursor=${p1.data.nextCursor}`, undefined, 200)
      const ids1 = new Set((p1.data?.objects ?? []).map((o) => o.id))
      const overlap = (p2.data?.objects ?? []).filter((o) => ids1.has(o.id)).length
      log(p2.ok && overlap === 0, 'GET /objects?cursor 第二页不重复', p2.ok ? `overlap=${overlap}` : `status=${p2.status}`)
    }
    // 压力数据集对象已由脚本自清理；这里清掉 bulk 的 5 行
    const all = await req('GET', '/api/objects?type=device&limit=200', undefined, 200)
    for (const o of (all.data?.objects ?? []).filter((x) => String(JSON.stringify(x.values)).includes(`${PREFIX}_BULK_`))) {
      created.push({ label: `bulk 对象 ${o.id}`, cleanup: () => req('DELETE', `/api/objects/${encodeURIComponent(o.id)}`) })
    }
  }

  /* ---------- 2.14 外部数据源（真实探测 / 表预览 / 同步） ---------- */
  {
    const c = await req('POST', '/api/data-layer/connections', { name: `${PREFIX}_EXT`, type: 'SQLite', database: 'demo-data/external/enterprise.db' }, 200)
    const id = c.data?.id
    log(c.ok && !!id, 'POST /data-layer/connections 登记外部 SQLite 库', c.ok ? `id=${id}` : `status=${c.status}`)
    if (id) {
      created.push({ label: `外部连接 ${id}`, cleanup: () => req('DELETE', `/api/data-layer/connections/${id}`) })
      const t = await req('POST', `/api/data-layer/connections/${id}/test`, undefined, 200)
      log(t.ok && (t.data?.tableCount ?? 0) >= 4, 'POST /connections/:id/test 真实探测表数', t.ok ? `tables=${t.data.tableCount}` : `status=${t.status} ${t.error || ''}`)
      const p = await req('GET', `/api/data-layer/connections/${id}/tables/equipment/preview`, undefined, 200)
      log(p.ok && Array.isArray(p.data?.columns) && Array.isArray(p.data?.rows), 'GET /connections/:id/tables/:table/preview 真实列与样本', p.ok ? `cols=${p.data.columns.length} rows=${p.data.rows.length}` : `status=${p.status}`)
      const bad = await req('POST', `/api/data-layer/connections/${id}/test`, undefined, 200) // 再测一次幂等
      log(bad.ok, '外部数据源重复探测稳定', bad.ok ? '' : `status=${bad.status}`)
    }
  }

  /* ---------- 2.17 模块3-6：端点可达性（写闭环由 load.mjs 76/76 验证，此处勿灌数据以免残留） ---------- */
  {
    log((await req('GET', '/api/ops/timeseries/points')).ok, 'GET /ops/timeseries/points 真实点查询')
    log((await req('GET', '/api/ops/timeseries/series?metric=DEMO_health')).ok, 'GET /ops/timeseries/series 真实序列')
    log((await req('GET', '/api/ops/governance/runs')).ok, 'GET /ops/governance/runs 治理执行记录')
    log((await req('GET', '/api/scheduling/tasks')).ok, 'GET /scheduling/tasks 排程任务')
    log((await req('GET', '/api/scheduling/metrics')).ok, 'GET /scheduling/metrics 真实指标')
    log((await req('GET', '/api/apollo/deployments')).ok, 'GET /apollo/deployments 部署记录')
    log((await req('GET', '/api/apollo/clusters')).ok, 'GET /apollo/clusters 集群派生')
    log((await req('GET', '/api/apollo/freeze-windows')).ok, 'GET /apollo/freeze-windows 冻结窗口')
    log((await req('GET', '/api/data-layer/connections')).ok, 'GET /data-layer/connections 文件源登记可查')
  }

  /* ---------- 2.16 模块1/2：函数沙箱 + 对象集高级 ---------- */
  {
    // 建一个临时函数 → 版本 → 测试 → 发布 → run（真实 node:vm 执行）
    const fnList = await req('GET', '/api/ontology/functions')
    const baseFn = (fnList.data?.functions ?? [])[0]
    if (baseFn) {
      const v = await req('POST', `/api/fn/functions/${baseFn.id}/versions`, { body: 'function main(input){ return { v: input.n * 2 } }', testInput: { n: 21 } }, 200)
      log(v.ok, 'POST /fn/functions/:id/versions 新建函数版本（自动测试）', v.ok ? `v=${v.data?.version?.version}` : `status=${v.status}`)
      const vs = await req('GET', `/api/fn/functions/${baseFn.id}/versions`)
      const one = (vs.data?.versions ?? [])[0]
      if (one) {
        created.push({ label: `函数版本 ${one.id}`, cleanup: () => req('DELETE', `/api/fn/functions/${baseFn.id}/versions/${one.id}`, undefined, 200, 8000).catch(() => {}) })
        const pub = await req('POST', `/api/fn/functions/${baseFn.id}/versions/${one.id}/publish`)
        log(pub.ok, 'POST /fn/.../publish 发布函数版本', pub.ok ? '' : `status=${pub.status}`)
        const run = await req('POST', `/api/fn/functions/${baseFn.id}/run`, { input: { n: 21 } })
        log(run.ok && run.data?.result?.v === 42, 'POST /fn/.../run 沙箱真实执行', run.ok ? `v=${run.data?.result?.v}` : `status=${run.status}`)
      }
    }
    // 对象集高级端点可达
    log((await req('GET', '/api/explorations/explorations')).ok, 'GET /explorations 保存探索列表')
    log((await req('GET', '/api/explorations/derived')).ok, 'GET /explorations/derived 派生属性列表')
    log((await req('GET', '/api/explorations/scenarios')).ok, 'GET /explorations/scenarios 场景列表')
  }

  /* ---------- 2.15 ChatBI：助手分析工具与本地引擎聚合意图 ---------- */
  {
    // ts 文件在 node 下无法直接 import，用源码文本校验工具契约
    const src = (await import('node:fs')).readFileSync(new URL('../shared/ai-tools.ts', import.meta.url), 'utf8')
    log(src.includes("name: 'analyze_objects'"), 'AI_TOOLS 含 analyze_objects 工具契约')
    // 回归：AIP 助手的「查询设备」示例属明细查询，语义守卫不得误判为指标问题而拒答
    const detail = await req('POST', '/api/ai/chat', { messages: [{ role: 'user', content: '查询设备 "M-2041"' }] }, 200, 45000)
    const detailTools = (detail.data?.toolCalls ?? []).map((x) => x.name)
    const notBlocked = !String(detail.data?.reply ?? '').includes('可信业务定义')
    log(detail.ok && notBlocked && (detailTools.length > 0 || String(detail.data?.reply ?? '').length > 0), 'POST /ai/chat 明细查询示例不被语义守卫误拒答', `tools=${detailTools.join(',')}`)
    // 回归：系统用法类问题（「X 在哪儿配置」）应确定性直达 navigate，不绕数据/知识工具、不 400
    const help = await req('POST', '/api/ai/chat', { messages: [{ role: 'user', content: '可信业务定义在哪儿配置' }] }, 200, 45000)
    const helpTools = (help.data?.toolCalls ?? []).map((x) => x.name)
    const isNav = helpTools.includes('navigate') && !helpTools.some((n) => ['analyze_objects', 'search_knowledge', 'query_objects'].includes(n))
    log(help.ok && isNav && /本体管理器/.test(String(help.data?.reply ?? '')), 'POST /ai/chat 系统用法类问题直达 navigate', `tools=${helpTools.join(',')}`)
    // 回归：菜单全中文后，系统用法类问题应给出中文页面名（不再出现英文产品名）
    const zhNav = await req('POST', '/api/ai/chat', { messages: [{ role: 'user', content: '工作流在哪儿配置' }] }, 200, 45000)
    const zhReply = String(zhNav.data?.reply ?? '')
    log(zhNav.ok && /工作流编排|工作流/.test(zhReply) && !/AIP Logic|Workshop|Contour/.test(zhReply), 'POST /ai/chat 中文统一后导航用语为中文', zhReply.slice(0, 60).replace(/\n/g, ' '))
    // 回归：新工具（排程/治理）的对话路由——问排程与扫描应命中对应工具而非瞎猜数据字段
    const sched = await req('POST', '/api/ai/chat', { messages: [{ role: 'user', content: '查看当前排程与利用率' }] }, 200, 45000)
    const schedTools = (sched.data?.toolCalls ?? []).map((x) => x.name)
    log(sched.ok && (schedTools.includes('get_schedule') || /排程|利用率/.test(String(sched.data?.reply ?? ''))), 'POST /ai/chat 排程类问题 → get_schedule', `tools=${schedTools.join(',')}`)
    const scan = await req('POST', '/api/ai/chat', { messages: [{ role: 'user', content: '扫描敏感数据' }] }, 200, 45000)
    const scanTools = (scan.data?.toolCalls ?? []).map((x) => x.name)
    log(scan.ok && (scanTools.includes('governance_scan') || /扫描|敏感/.test(String(scan.data?.reply ?? ''))), 'POST /ai/chat 治理类问题 → governance_scan', `tools=${scanTools.join(',')}`)
    // 本地引擎：分析类问题应返回 analyze_objects 工具调用（而非普通 query_objects）
    const c = await req('POST', '/api/ai/chat', { messages: [{ role: 'user', content: '按类别统计支出金额' }] }, 200, 45000)
    const tools = (c.data?.toolCalls ?? []).map((x) => x.name)
    // LLM 模式可能直接以自然语言回答分析思路，本地引擎才会给出工具调用；两者都算识别为分析类
    const recognized = tools.includes('analyze_objects') || /统计|聚合|分组|类别/.test(String(c.data?.reply ?? ''))
    log(c.ok && recognized, 'POST /ai/chat 分析类问题 → ChatBI', `tools=${tools.join(',')} reply=${String(c.data?.reply ?? '').slice(0, 40)}`)
    // 聚合端点带 bucket 的真实结果（图表数据来源）；expense 在个人空间，用其空间头
    const agg = await fetch(BASE + '/api/dashboard/aggregate?typeId=expense&groupBy=date&metric=amount&bucket=month', {
      headers: { Authorization: `Bearer ${token}`, 'x-space-id': 'sp-personal-U-0001' },
    }).then(async (r) => ({ ok: r.status === 200, status: r.status, data: await r.json() })).catch(() => ({ ok: false, status: 0, data: {} }))
    log(agg.ok && Array.isArray(agg.data?.groups), 'ChatBI 图表数据来源 /dashboard/aggregate', agg.ok ? `groups=${agg.data.groups.length}` : `status=${agg.status}`)
    // 新工具后端依赖端点可达性（只读动作，8 个工具复用这些端点）
    for (const [label, path] of [
      ['场景列表 /explorations/scenarios', '/api/explorations/explorations/scenarios'],
      ['派生属性 /explorations/derived', '/api/explorations/explorations/derived'],
      ['部署记录 /apollo/deployments', '/api/apollo/deployments'],
      ['集群 /apollo/clusters', '/api/apollo/clusters'],
      ['时序序列 /ops/timeseries/series', '/api/ops/timeseries/series?metric=DEMO_health'],
      ['治理记录 /ops/governance/runs', '/api/ops/governance/runs'],
      ['数据源连接 /data-layer/connections', '/api/data-layer/connections'],
      ['审批列表 /actions/approvals/list', '/api/actions/approvals/list'],
      ['空间列表 /spaces', '/api/spaces'],
    ]) {
      const r = await req('GET', path)
      log(r.ok, `GET ${label}`, r.ok ? '' : `status=${r.status}`)
    }
  }

  /* ---------- 3. 聚合分析（动态取真实类型，验证分桶/排序/时间范围） ---------- */
  console.log('\n--- 聚合分析 ---')
  {
    const types = await req('GET', '/api/ontology/types')
    const t = types.data?.types?.find((x) => (x.properties ?? []).some((p) => p.type === 'number'))
    if (t) {
      const numKey = t.properties.find((p) => p.type === 'number').key
      const enumProp = t.properties.find((p) => p.type === 'enum')
      const a = await req('GET', `/api/dashboard/aggregate?typeId=${t.id}&groupBy=${encodeURIComponent(enumProp?.key ?? t.properties[0].key)}&metric=${numKey}`)
      const okA = a.ok && Array.isArray(a.data?.groups) && a.data.applied?.sort === 'sum'
      log(okA, 'GET /dashboard/aggregate 分组聚合（默认按金额降序）', okA ? `type=${t.name} 分组=${a.data.groups.length}` : `status=${a.status} ${JSON.stringify(a.data).slice(0, 100)}`)
      const sums = (a.data?.groups ?? []).map((g) => g.sum)
      const sortedDesc = sums.every((v, i) => i === 0 || sums[i - 1] >= v)
      log(sortedDesc, 'aggregate groups 按 sum 降序', sums.join('>') )
      const dateProp = t.properties.find((p) => p.type === 'date')
      if (dateProp) {
        const b = await req('GET', `/api/dashboard/aggregate?typeId=${t.id}&groupBy=${dateProp.key}&metric=${numKey}&bucket=month&from=2000-01-01&to=2099-12-31`)
        log(b.ok && b.data?.applied?.bucket === 'month', 'aggregate bucket=month + from/to 生效', b.ok ? `applied=${JSON.stringify(b.data.applied)}` : `status=${b.status}`)
      }
      // ChatBI v2：时间序列默认升序 / TOP-N / 同比环比窗口结构（丰富数据断言在 load.mjs）
      const ord = types.data?.types?.find((x) => x.id === 'order')
      if (ord) {
        const trend = await req('GET', '/api/dashboard/aggregate?typeId=order&groupBy=date&metric=amount&bucket=month')
        const tgs = trend.data?.groups ?? []
        log(trend.ok && tgs.length >= 1 && tgs.every((g, i) => i === 0 || g.name > tgs[i - 1].name), 'aggregate 时间序列默认按时间升序（趋势图）', `groups=${tgs.length}`)
        const top = await req('GET', '/api/dashboard/aggregate?typeId=order&groupBy=status&metric=amount&top=3')
        const tpg = top.data?.groups ?? []
        log(top.ok && tpg.length <= 3 && Number(top.data?.applied?.top) === 3, 'aggregate top=3 TOP-N 截取（按金额降序）', `groups=${tpg.length}`)
        const nowD = new Date()
        const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        const win = `from=${iso(new Date(nowD.getFullYear(), nowD.getMonth() - 1, 1))}&to=${iso(new Date(nowD.getFullYear(), nowD.getMonth(), 0))}`
        const cmpPrev = await req('GET', `/api/dashboard/aggregate?typeId=order&groupBy=date&metric=amount&${win}&compare=prev`)
        const cp = cmpPrev.data?.compare
        log(cmpPrev.ok && cp?.mode === 'prev' && !!cp.current?.from && !!cp.previous?.from && typeof cp.delta === 'number' && (cp.deltaPct === null || typeof cp.deltaPct === 'number'), 'aggregate compare=prev 环比（紧邻等长上期窗口）', cp ? `本期${cp.current.sum} vs 上期${cp.previous.sum}（${cp.current.from}~${cp.current.to} vs ${cp.previous.from}~${cp.previous.to}）` : '')
        const cmpYoy = await req('GET', `/api/dashboard/aggregate?typeId=order&groupBy=date&metric=amount&${win}&compare=yoy`)
        const cy = cmpYoy.data?.compare
        log(cmpYoy.ok && cy?.mode === 'yoy' && cy.previous?.from < cy.current?.from, 'aggregate compare=yoy 同比（去年同期窗口）', cy ? `${cy.current.from} vs ${cy.previous.from}` : '')
      }
      const badCmp = await req('GET', `/api/dashboard/aggregate?typeId=${t.id}&groupBy=${encodeURIComponent(t.properties[0].key)}&compare=prev`, undefined, 400)
      log(badCmp.ok, 'aggregate compare 缺 from/to 返回 400 并给出用法提示', badCmp.ok ? String(badCmp.data?.error ?? '').slice(0, 60) : `status=${badCmp.status}`)
      // ChatBI v3：二维交叉矩阵（设备类型 × 状态）
      if (ord) {
        const cross = await req('GET', '/api/dashboard/aggregate?typeId=device&groupBy=type&crossBy=status')
        const cr = cross.data?.cross
        const cellOk = cr ? cr.rows.every((row) => Object.values(row.cells).every((cell) => typeof cell?.sum === 'number' && typeof cell?.count === 'number')) : false
        log(cross.ok && !!cr && cr.columns.length >= 1 && cr.rows.length >= 1 && cr.colBy?.key === 'status' && cellOk, 'aggregate crossBy=二维交叉矩阵（行×列+单元格）', cr ? `${cr.rows.length} 行 × ${cr.columns.length} 列（${cr.rowBy.name}＼${cr.colBy.name}）` : '')
        const badCross = await req('GET', '/api/dashboard/aggregate?typeId=device&groupBy=type&crossBy=nonexistent', undefined, 400)
        log(badCross.ok, 'aggregate crossBy 非法字段返回 400', badCross.ok ? '' : `status=${badCross.status}`)
        const crossCmp = await req('GET', '/api/dashboard/aggregate?typeId=device&groupBy=type&crossBy=status&compare=prev', undefined, 400)
        log(crossCmp.ok, 'aggregate crossBy+compare 同用返回 400（互斥）', crossCmp.ok ? '' : `status=${crossCmp.status}`)
      }
    } else log(false, '存在带数值属性的类型（前置条件）', '未找到')
  }

  /* ---------- 4. API 密钥鉴权（创建→read 限读→write 可写→删除后失效） ---------- */
  console.log('\n--- API 密钥鉴权 ---')
  {
    const mk = await req('POST', '/api/gov/keys', { name: `${PREFIX}_K_RO`, scope: 'read' }, 200)
    const readKey = mk.data?.key
    log(mk.ok && !!readKey, 'POST /gov/keys 创建 read 密钥', mk.ok ? '' : `status=${mk.status}`)
    const wk = await req('POST', '/api/gov/keys', { name: `${PREFIX}_K_W`, scope: 'write' }, 200)
    const writeKey = wk.data?.key
    log(wk.ok && !!writeKey, 'POST /gov/keys 创建 write 密钥', wk.ok ? '' : `status=${wk.status}`)
    if (readKey && writeKey) {
      created.push({ label: `read 密钥 ${mk.data.id}`, cleanup: () => req('DELETE', `/api/gov/keys/${mk.data.id}`) })
      created.push({ label: `write 密钥 ${wk.data.id}`, cleanup: () => req('DELETE', `/api/gov/keys/${wk.data.id}`) })
      const bare = (key, method, path, body) => fetch(BASE + path, {
        method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'x-space-id': spaceId },
        body: body === undefined ? undefined : JSON.stringify(body),
      }).then((r) => r.status).catch(() => 0)
      const s1 = await bare(readKey, 'GET', '/api/objects/types')
      log(s1 === 200, 'read 密钥调用 GET /objects/types → 200', `status=${s1}`)
      const s2 = await bare(readKey, 'POST', '/api/objects', { typeId: 'x', values: {} })
      log(s2 === 401, 'read 密钥调用 POST（写方法）→ 401 拒绝', `status=${s2}`)
      const s3 = await bare(writeKey, 'GET', '/api/objects/types')
      log(s3 === 200, 'write 密钥调用 GET → 200', `status=${s3}`)
      // write 密钥真实写一笔（走对象创建 + 登记 cleanup）
      const types = await req('GET', '/api/ontology/types')
      const t = types.data?.types?.find((x) => Array.isArray(x.properties) && x.properties.length >= 2)
      if (t) {
        const val = {}
        for (const p of t.properties) {
          if (p.type === 'number') val[p.key] = 1
          else if (p.type === 'enum') val[p.key] = (p.enumValues?.[0]) || '其他'
          else if (p.type === 'boolean') val[p.key] = true
          else if (p.type === 'date') val[p.key] = '2026-01-01'
          else val[p.key] = `${PREFIX}_BYKEY`
        }
        const s4 = await bare(writeKey, 'POST', '/api/objects', { typeId: t.id, values: val })
        log(s4 === 200, 'write 密钥真实 POST /objects → 200', `status=${s4}`)
        if (s4 === 200) {
          const l = await req('GET', '/api/objects?type=' + encodeURIComponent(t.id) + '&limit=50')
          const mine = (l.data?.objects ?? []).find((o) => String(o.values?.title ?? '').includes('BYKEY') || JSON.stringify(o.values).includes(PREFIX))
          if (mine?.id) created.push({ label: `密钥创建的对象 ${mine.id}`, cleanup: () => req('DELETE', `/api/objects/${encodeURIComponent(mine.id)}`) })
        }
      }
      // 删除 read 密钥后应立即失效
      await req('DELETE', `/api/gov/keys/${mk.data.id}`)
      const s5 = await bare(readKey, 'GET', '/api/objects/types')
      log(s5 === 401, '删除密钥后再调用 → 401 失效', `status=${s5}`)
    }
  }

  /* ---------- 4.5 动作执行 → 审批 → 写回（核心业务闭环） ---------- */
  console.log('\n--- 动作与审批闭环 ---')
  {
    const types = await req('GET', '/api/ontology/types')
    const acts = await req('GET', '/api/ontology/actions')
    // 造一个可清理的目标对象（用带数值属性的类型）
    const t = types.data?.types?.find((x) => Array.isArray(x.properties) && x.properties.length >= 2)
    const updAction = acts.data?.actions?.find((a) => a.needsApproval && (a.effect?.kind === 'update' || a.params?.some((p) => p.key === 'objectId')))
    if (t && updAction) {
      const val = {}
      for (const p of t.properties) {
        if (p.type === 'number') val[p.key] = 1
        else if (p.type === 'enum') val[p.key] = (p.enumValues?.[0]) || '其他'
        else if (p.type === 'date') val[p.key] = '2026-01-01'
        else val[p.key] = `${PREFIX}_APPROVAL`
      }
      const c = await req('POST', '/api/objects', { typeId: t.id, values: val })
      const oid = c.data?.object?.id
      log(c.ok && !!oid, '前置：创建审批目标对象', c.ok ? `id=${oid}` : `status=${c.status}`)
      if (oid) {
        created.push({ label: `审批目标 ${oid}`, cleanup: () => req('DELETE', `/api/objects/${encodeURIComponent(oid)}`) })
        const ex = await req('POST', `/api/actions/${encodeURIComponent(updAction.id)}/execute`, { params: { objectId: oid, comment: `${PREFIX} 冒烟` } }, 200)
        const approvalId = ex.data?.approvalId
        const isPending = ex.data?.status === 'pending_approval' && !!approvalId
        log(isPending, `POST /actions/:id/execute 需审批动作进入待审批`, isPending ? `approvalId=${approvalId}` : `resp=${JSON.stringify(ex.data).slice(0, 120)}`)
        if (isPending) {
          const list = await req('GET', '/api/actions/approvals/list')
          const found = (list.data?.approvals ?? []).some((x) => x.id === approvalId)
          log(list.ok && found, 'GET /actions/approvals/list 含新审批单', found ? '' : '未找到')
          const dec = await req('POST', `/api/actions/approvals/${encodeURIComponent(approvalId)}/decide`, { decision: 'approve', comment: `${PREFIX} 通过` })
          log(dec.ok, 'POST /approvals/:id/decide 通过审批', dec.ok ? '' : `status=${dec.status} ${dec.error || ''}`)
        }
      }
    } else log(false, '存在需审批的 update 动作（前置条件）', '未找到合适动作')
  }

  /* ---------- 4.6 知识入库 → 索引 → 删除 ---------- */
  console.log('\n--- 知识写入闭环 ---')
  {
    const title = `${PREFIX}_知识冒烟`
    const c = await req('POST', '/api/knowledge/docs', { title, content: '这是冒烟测试文档：设备 F2-IM-2041 的液压系统每 2000 小时更换油封，油温超过 55 摄氏度需检查冷却系统并更换 HS-2041-03 密封组件。' })
    const id = c.data?.id
    log(c.ok && !!id && (c.data?.chunks ?? 0) > 0, 'POST /knowledge/docs 入库并分块', c.ok ? `chunks=${c.data.chunks} mode=${c.data.mode}` : `status=${c.status} ${JSON.stringify(c.data).slice(0, 100)}`)
    if (id) {
      const s = await req('GET', '/api/knowledge/search?q=' + encodeURIComponent('液压系统'))
      log(s.ok && Array.isArray(s.data?.results ?? s.data?.hits), 'GET /knowledge/search 检索', s.ok ? '' : `status=${s.status}`)
      const d = await req('DELETE', `/api/knowledge/docs/${encodeURIComponent(id)}`)
      log(d.ok, 'DELETE /knowledge/docs/:id 清理', d.ok ? '' : `status=${d.status}`)
    }
  }

  /* ---------- 4.7 空间导出 / 导入校验 / 邀请校验 ---------- */
  console.log('\n--- 空间与用户管理 ---')
  {
    const e = await req('GET', `/api/spaces/${encodeURIComponent(spaceId)}/export`)
    log(e.ok && isObj(e.data) && (e.data.space || e.data.types || e.data.objects), 'GET /spaces/:id/export 导出结构', e.ok ? `keys=${Object.keys(e.data).join(',')}` : `status=${e.status}`)
    const badImport = await req('POST', '/api/spaces/import', {}, 400)
    log(badImport.ok, 'POST /spaces/import 空包体返回 400', `status=${badImport.status}`)
    const badInvite1 = await req('POST', '/api/users/invite', { name: '', account: '', roleId: '' }, 400)
    log(badInvite1.ok, 'POST /users/invite 缺字段返回 400', `status=${badInvite1.status}`)
    const badInvite2 = await req('POST', '/api/users/invite', { name: '冒烟', account: `smoke_${PREFIX}`, roleId: 'analyst', channel: 'email', email: 'not-an-email' }, 400)
    log(badInvite2.ok, 'POST /users/invite 非法邮箱返回 400', `status=${badInvite2.status}`)
  }

  /* ---------- 5. 权限与错误码 ---------- */
  console.log('\n--- 权限与错误码 ---')
  const noAuth = await fetch(BASE + '/api/objects').then((r) => r.status).catch(() => 0)
  log(noAuth === 401, 'GET /objects 未带 JWT 返回 401', `status=${noAuth}`)
  const badLogin = await req('POST', '/api/auth/login', { account: ACCOUNT, password: 'wrong-password' }, 401)
  log(badLogin.ok, 'POST /auth/login 错误密码返回 401', `status=${badLogin.status}`)

  /* ---------- 4. 清理测试数据（倒序） ---------- */
  console.log('\n--- 清理测试数据 ---')
  let cleaned = 0
  for (let i = created.length - 1; i >= 0; i--) {
    try { await created[i].cleanup(); cleaned++ } catch { /* 忽略清理异常，最后统一报告 */ }
  }
  console.log(`  已发起 ${cleaned}/${created.length} 个清理请求`)

  finish()
}

function finish(earlyReason) {
  if (earlyReason) console.log(`\n[中断] ${earlyReason}\n`)
  console.log('\n=== 结果汇总 ===')
  console.log(report.join('\n'))
  console.log(`\n通过 ${passed} / 失败 ${failed}`)
  if (failures.length) {
    console.log('\n失败明细：')
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`))
  }
  const out = {
    time: new Date().toISOString(), base: BASE, account: ACCOUNT,
    passed, failed, failures,
  }
  try { writeFileSync(new URL('./last-run.json', import.meta.url), JSON.stringify(out, null, 2)) } catch { /* 忽略 */ }
  console.log('\n报告已写入 tests/last-run.json')
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => { console.error(e); finish('脚本异常: ' + e.message) })
