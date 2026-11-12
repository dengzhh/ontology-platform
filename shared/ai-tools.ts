/** AIP 助手工具契约：前后端共享（前端执行，服务端生成/校验） */

export interface AiToolDef {
  name: string
  description: string
  parameters: { name: string; type: 'string' | 'number' | 'boolean'; desc: string; required: boolean; enumValues?: string[] }[]
}

export const AI_TOOLS: AiToolDef[] = [
  {
    name: 'navigate',
    description: '跳转到平台的某个页面/应用。当用户要求打开、进入、查看某个页面时调用',
    parameters: [
      { name: 'page', type: 'string', desc: '页面名称，如「对象浏览器」「用户与权限」「本体管理器」', required: true },
    ],
  },
  {
    name: 'query_objects',
    description: '查询某类业务对象的实例列表（设备/工单/客户/订单/工厂/产品/供应商/知识文档等）',
    parameters: [
      { name: 'type', type: 'string', desc: '对象类型中文名，如「生产设备」', required: true },
      { name: 'keyword', type: 'string', desc: '可选，按关键词过滤任意字段', required: false },
    ],
  },
  {
    name: 'ontology_overview',
    description: '获取本体概览：全部对象类型及其实例数、链接类型与动作类型',
    parameters: [],
  },
  {
    name: 'list_users',
    description: '列出平台用户（姓名/账号/角色/状态）。仅管理员可用',
    parameters: [],
  },
  {
    name: 'invite_user',
    description: '邀请新用户入驻平台（生成邀请链接，账号初始为待激活）。仅管理员可用',
    parameters: [
      { name: 'name', type: 'string', desc: '姓名，如「张三」', required: true },
      { name: 'account', type: 'string', desc: '拼音账号，如 zhang.san', required: true },
      { name: 'role', type: 'string', desc: '角色中文名', required: true },
    ],
  },
  {
    name: 'execute_action',
    description: '执行当前空间的业务动作（如「记一笔支出」「完成日程」）。动作名与参数以 ontology_overview 或动作列表为准；需审批的动作会返回进入审批中心',
    parameters: [
      { name: 'action', type: 'string', desc: '动作名称，如「记一笔支出」', required: true },
      { name: 'params', type: 'string', desc: '参数键值对，JSON 字符串，如 {"title":"午饭","amount":28}', required: false },
    ],
  },
  {
    name: 'list_actions',
    description: '列出当前空间可执行的动作及其参数定义',
    parameters: [],
  },
  {
    name: 'search_knowledge',
    description: '检索企业知识库（SOP/手册/合同/案例等文档），返回最相关的文档片段与来源。回答制度、流程、故障处理等"文档里怎么写"的问题时必须先调用',
    parameters: [
      { name: 'query', type: 'string', desc: '检索问题或关键词', required: true },
    ],
  },
  {
    name: 'analyze_objects',
    description: 'ChatBI：对业务对象做分组聚合分析（按类别/时间/商户等维度统计求和、均值、笔数，可时间分桶与范围筛选），返回各组数值并渲染图表。当用户问「各/按…统计、多少、占比、趋势、最多/最大、平均、分布」等分析类问题时调用，不要只列原始对象',
    parameters: [
      { name: 'typeId', type: 'string', desc: '对象类型 id 或中文名，如 expense / 支出 / device / 生产设备', required: true },
      { name: 'groupBy', type: 'string', desc: '分组维度（属性 key 或名称），如 category / 类别 / date / 日期 / merchant / 商户', required: true },
      { name: 'metric', type: 'string', desc: '数值指标属性 key，如 amount / 金额；留空则按笔数统计', required: false },
      { name: 'bucket', type: 'string', desc: '按日期分组时的时间分桶：day / week / month / quarter', required: false },
      { name: 'from', type: 'string', desc: '起始日期 YYYY-MM-DD（可选）', required: false },
      { name: 'to', type: 'string', desc: '结束日期 YYYY-MM-DD（可选）', required: false },
    ],
  },
  {
    name: 'run_function',
    description: '执行一个已发布的本体函数（真实沙箱运行）。当用户要求「运行/测试某函数」或业务逻辑需要函数计算（如算指标、格式化）时调用',
    parameters: [
      { name: 'name', type: 'string', desc: '函数名，如「computeOee」或中文名', required: true },
      { name: 'input', type: 'string', desc: '函数入参 JSON 字符串，如 {"a":1,"b":2}', required: false },
    ],
  },
  {
    name: 'run_pipeline',
    description: '运行一条数据管道（真实执行并写运行记录）。当用户说「跑一下管道 / 同步数据」时调用',
    parameters: [
      { name: 'name', type: 'string', desc: '管道名称', required: true },
    ],
  },
  {
    name: 'get_schedule',
    description: '查看排程任务与求解指标（利用率/准时率/延期数），或运行求解生成新排产方案。当用户问排产/排程相关时调用',
    parameters: [
      { name: 'action', type: 'string', desc: 'view（查看当前排程与指标）或 solve（重新求解）', required: true },
    ],
  },
  {
    name: 'governance_scan',
    description: '对当前空间执行敏感数据扫描 / 脱敏预览 / 生命周期检查（真实执行并留痕）。当用户要求合规检查、扫描敏感数据时调用',
    parameters: [
      { name: 'kind', type: 'string', desc: 'scan（扫描敏感数据）/ mask（脱敏预览）/ lifecycle（生命周期检查）', required: true },
    ],
  },
  {
    name: 'manage_scenario',
    description: '本体场景分支：新建场景、查看列表、合并（真实把变更写入对象）或放弃。当用户说「建个场景 / 合并场景 / 场景分支」时调用',
    parameters: [
      { name: 'action', type: 'string', desc: 'list（列表）/ create（新建）/ merge（合并）/ discard（放弃）', required: true },
      { name: 'name', type: 'string', desc: '场景名称（create 时必填）', required: false },
      { name: 'id', type: 'string', desc: '场景 id（merge/discard 时必填，可从 list 结果取）', required: false },
    ],
  },
  {
    name: 'compare_objects',
    description: '对象集比较：比较两组对象 id 集合，返回仅 A / 仅 B / 交集。当用户要求「比较两组对象/对象集」时调用',
    parameters: [
      { name: 'a', type: 'string', desc: 'A 组对象 id，逗号分隔', required: true },
      { name: 'b', type: 'string', desc: 'B 组对象 id，逗号分隔', required: true },
    ],
  },
  {
    name: 'eval_derived',
    description: '派生属性：列出已定义的派生属性，或对指定属性真实计算当前空间对象的值。当用户说「算一下派生属性 / 派生属性」时调用',
    parameters: [
      { name: 'action', type: 'string', desc: 'list（列表）或 eval（计算）', required: true },
      { name: 'name', type: 'string', desc: '派生属性名称或 id（eval 时必填）', required: false },
    ],
  },
  {
    name: 'apollo_deploy',
    description: 'Apollo 部署编排：查看部署记录/集群，或新建部署、晋升版本、回滚。当用户说「部署 / 晋升 / 回滚 / 发布版本」时调用',
    parameters: [
      { name: 'action', type: 'string', desc: 'view（记录）/ clusters（集群）/ deploy（新建）/ promote（晋升）/ rollback（回滚）', required: true },
      { name: 'version', type: 'string', desc: '版本号（deploy 时必填，如 v3.0.0）', required: false },
      { name: 'id', type: 'string', desc: '部署记录 id（promote/rollback 时必填，可从 view 结果取）', required: false },
    ],
  },
  {
    name: 'collect_timeseries',
    description: '真实时序采集：从当前空间对象按数值字段批量生成 ts_points 采样点，或查看真实序列。当用户说「采集时序 / 采样 / 真实曲线」时调用',
    parameters: [
      { name: 'valueKey', type: 'string', desc: '数值属性 key，如 health / amount', required: true },
    ],
  },
  {
    name: 'sync_source',
    description: '外部数据源：列出已登记连接，或对某连接真实探测/同步为对象。当用户说「同步外部数据 / 数据源」时调用',
    parameters: [
      { name: 'action', type: 'string', desc: 'list（列出连接）/ test（探测）/ sync（同步为对象）', required: true },
      { name: 'name', type: 'string', desc: '连接名称（test/sync 时必填）', required: false },
      { name: 'typeId', type: 'string', desc: '目标对象类型（sync 时必填）', required: false },
    ],
  },
  {
    name: 'decide_approval',
    description: '审批操作：查看待审批单，或对指定审批单通过/驳回（真实写回并留痕）。当用户说「审批 / 通过审批 / 驳回」时调用',
    parameters: [
      { name: 'action', type: 'string', desc: 'list（列出待审批）/ approve（通过）/ reject（驳回）', required: true },
      { name: 'id', type: 'string', desc: '审批单 id（approve/reject 时必填，可从 list 取）', required: false },
    ],
  },
  {
    name: 'space_action',
    description: '多空间：列出空间、导出当前空间包。当用户说「有哪些空间 / 导出空间」时调用',
    parameters: [
      { name: 'action', type: 'string', desc: 'list（列出空间）/ export（导出当前空间包）', required: true },
    ],
  },
]

/** 页面路由提示（服务端意图匹配用；前端以 config/nav.ts 为准） */
export const NAV_HINTS: { path: string; name: string; keywords: string[] }[] = [
  { path: '/launcher', name: '应用中心', keywords: ['应用中心', 'launcher', '首页应用'] },
  { path: '/overview', name: '平台仪表盘', keywords: ['仪表盘', '总览', 'dashboard'] },
  { path: '/data/connections', name: '数据连接', keywords: ['数据连接', '连接器'] },
  { path: '/data/pipelines', name: '管道构建', keywords: ['管道', 'pipeline'] },
  { path: '/data/code', name: '代码仓库', keywords: ['代码仓库', '代码'] },
  { path: '/data/datasets', name: '数据集', keywords: ['数据集'] },
  { path: '/data/lineage', name: '数据血缘', keywords: ['血缘'] },
  { path: '/ontology/manager', name: '本体管理器', keywords: ['本体管理', '建模', '对象类型管理'] },
  { path: '/ontology/explorer', name: '对象浏览器', keywords: ['对象浏览器', '对象列表', '浏览对象'] },
  { path: '/ontology/views', name: '对象视图', keywords: ['对象视图'] },
  { path: '/ontology/graph', name: '关系图谱', keywords: ['图谱', '关系图', 'vertex'] },
  { path: '/ontology/rules', name: '规则引擎', keywords: ['规则'] },
  { path: '/ontology/machinery', name: '流程编排', keywords: ['流程编排', 'machinery'] },
  { path: '/ontology/scheduling', name: '调度优化', keywords: ['调度', '排产'] },
  { path: '/ontology/timeseries', name: '时序与告警', keywords: ['时序', '告警'] },
  { path: '/knowledge/library', name: '知识库', keywords: ['知识库', '文档库'] },
  { path: '/knowledge/search', name: '知识检索', keywords: ['知识检索', '搜知识'] },
  { path: '/knowledge/extract', name: '知识抽取', keywords: ['知识抽取'] },
  { path: '/analytics/contour', name: 'Contour 分析', keywords: ['contour', '数据分析'] },
  { path: '/analytics/quiver', name: 'Quiver 分析', keywords: ['quiver'] },
  { path: '/analytics/insight', name: 'Insight 路径', keywords: ['insight'] },
  { path: '/analytics/map', name: '地理空间', keywords: ['地图', '地理'] },
  { path: '/analytics/notepad', name: 'Notepad 报告', keywords: ['报告', 'notepad'] },
  { path: '/analytics/fusion', name: 'Fusion 表格', keywords: ['fusion', '电子表格'] },
  { path: '/apps/workshop', name: 'Workshop 搭建', keywords: ['workshop', '应用搭建', '搭建器'] },
  { path: '/apps/automate', name: 'Automate 自动化', keywords: ['自动化', 'automate'] },
  { path: '/apps/carbon', name: 'Carbon 工作区', keywords: ['工作区', 'carbon'] },
  { path: '/apps/marketplace', name: 'Marketplace', keywords: ['市场', 'marketplace'] },
  { path: '/aip/logic', name: 'AIP Logic', keywords: ['aip logic', 'llm工作流', '工作流编排'] },
  { path: '/aip/agents', name: 'Agent Studio', keywords: ['agent', '智能体'] },
  { path: '/aip/threads', name: 'AIP Threads', keywords: ['threads'] },
  { path: '/aip/evals', name: 'AIP Evals', keywords: ['evals', '评测'] },
  { path: '/aip/models', name: '模型管理', keywords: ['模型', 'byom'] },
  { path: '/aip/developers', name: '开发者工具', keywords: ['开发者', 'osdk', 'mcp'] },
  { path: '/gov/approvals', name: '审批中心', keywords: ['审批'] },
  { path: '/gov/audit', name: '审计日志', keywords: ['审计', '日志查询'] },
  { path: '/gov/security', name: '安全与标记', keywords: ['安全', '权限标记', '标记'] },
  { path: '/admin/users', name: '用户与权限', keywords: ['用户管理', '用户与权限', '人员管理'] },
  { path: '/admin/roadmap', name: '实现进度', keywords: ['实现进度', '路线图', 'roadmap'] },
  { path: '/admin/control', name: '控制面板', keywords: ['控制面板', '系统设置'] },
  { path: '/admin/apollo', name: 'Apollo 部署', keywords: ['部署', 'apollo'] },
]

/** 对象类型中文别名 → typeId */
export const TYPE_ALIASES: Record<string, string> = {
  设备: 'device', 生产设备: 'device', 机器: 'device',
  工单: 'ticket', 维修工单: 'ticket',
  客户: 'customer',
  订单: 'order', 销售订单: 'order',
  工厂: 'factory',
  产品: 'product',
  供应商: 'supplier',
  知识文档: 'document', 文档: 'document',
}
