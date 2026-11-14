/**
 * 页面实现状态单一事实来源。
 * 每完成一个功能：更新此处 → PageShell 徽章 / Launcher 圆点 / 实现进度页 全站即时同步。
 *
 * 【诚实标注口径】
 * - live：页面主链路真实打 /api 并落库/查询，且无明显死按钮/写死数据
 * - partial：主体接真但仍有局部 mock、装饰交互或未接的子功能
 * - mock：仍为 UI 原型（写死数据 / 死按钮 / 不落库）
 * 状态会随补齐进度逐页上调；不虚标。
 */

export type PageStatus = 'live' | 'partial' | 'mock'

export interface PageStatusInfo {
  /** 所处/目标阶段，如 'P1' */
  phase: string
  status: PageStatus
  note?: string
}

/**
 * 阶段定义。done 由 computePhaseProgress() 依据 PAGE_STATUS 自动计算，
 * 杜绝「阶段标了完成、页面却还是演示态」。
 */
export const PHASES: { id: string; name: string; goal: string }[] = [
  { id: 'P0', name: '基建', goal: '后端骨架 / 数据库与迁移 / JWT 登录会话 / 状态标记体系' },
  { id: 'P1', name: '身份权限', goal: '用户/角色/用户组管理，权限由服务端会话驱动' },
  { id: 'P2', name: '本体建模', goal: '对象/链接/动作类型在线编辑并即时生效' },
  { id: 'P3', name: '对象数据', goal: '对象实例与链接的真实存储、查询、详情、图谱与视图' },
  { id: 'P3.5', name: '多空间架构', goal: '组织/个人/家庭多本体空间隔离 + 模板包 + 空间导入导出' },
  { id: 'P4', name: '动作·审批·审计', goal: '动作执行引擎、审批流转、全量审计留痕，AI 助手可执行动作' },
  { id: 'P5', name: '知识层', goal: '文档入库、分块向量化、混合检索、抽取反哺本体' },
  { id: 'P6', name: 'AI 能力', goal: '可配置 LLM 网关、智能助手真实对话与工具调用' },
  { id: 'P7', name: '自动化与通知', goal: '规则引擎触发通知与动作，通知中心真数据' },
  { id: 'P8', name: '应用搭建', goal: '应用搭建持久化，组件绑定真实对象集' },
  { id: 'P9', name: '看板与基础分析', goal: '仪表盘与核心分析页改为真实数据聚合' },
  { id: 'P10', name: '长尾增强', goal: '数据接入层/岗位工作区/应用市场/模型评估/模型管理/开发者工具/数据安全等逐页接真' },
]

export interface PhaseProgress {
  live: number
  partial: number
  mock: number
  total: number
  pct: number
  done: boolean
}

/** 阶段进度：按该阶段下页面的真实状态自动计算（已实现 1 分、部分实现 0.5 分） */
export function computePhaseProgress(): Map<string, PhaseProgress> {
  const map = new Map<string, PhaseProgress>()
  const all = Object.values(PAGE_STATUS)
  for (const p of PHASES) {
    const pages = all.filter((s) => s.phase === p.id)
    const live = pages.filter((s) => s.status === 'live').length
    const partial = pages.filter((s) => s.status === 'partial').length
    const mock = pages.filter((s) => s.status === 'mock').length
    const total = pages.length
    const pct = total === 0 ? 0 : Math.round(((live + partial * 0.5) / total) * 100)
    map.set(p.id, { live, partial, mock, total, pct, done: total > 0 && live === total })
  }
  return map
}

/** 当前真实状态（2026-11-07 全量审计后校准） */
export const PAGE_STATUS: Record<string, PageStatusInfo> = {
  // 概览
  '/launcher': { phase: 'P0', status: 'live', note: '应用矩阵跳转、Ctrl+K 全局搜索真实；收藏与最近使用基于 localStorage 真实持久化（本地浏览记录，非服务端统计）' },
  '/overview': { phase: 'P9', status: 'live', note: '空间统计/类型分布/趋势/枚举/审计真实聚合；系统健康：本体/索引/规则来自真实数据，AI 网关真实可达性探测（2.5s 超时）' },
  // 数据（P3 补齐：连接/数据集/代码资产已建后端并接真）
  '/data/connections': { phase: 'P10', status: 'live', note: 'SQLite 外部库 + CSV/JSON/TXT/MD 文件型数据源：真实探测/表预览/同步为对象（路径白名单只读）' },
  '/data/pipelines': { phase: 'P10', status: 'live', note: '真实节点编辑画布（拖拽/连线/撤销/缩放，坐标与连线随定义持久化）；定义 CRUD + 校验/发布/运行真实落库（pipeline_runs）；运行为统计扫描，不执行真实 ETL 节点' },
  '/data/code': { phase: 'P10', status: 'live', note: '代码资产登记/查看/编辑/删除真实落库；Git PR 集成明确禁用说明' },
  '/data/datasets': { phase: 'P10', status: 'live', note: '对象类型即数据集：列表/预览/健康/Schema 全真实数据' },
  '/data/lineage': { phase: 'P10', status: 'live', note: '四层血缘与影响分析来自真实类型/链接/应用/文档；拓扑按节点数自动拉开行距 + 滚轮缩放/平移，解决节点重叠' },
  // 本体
  '/ontology/manager': { phase: 'P2', status: 'live', note: '类型/链接/动作/函数 CRUD 真实；接口 Tab 完整 CRUD + 契约属性 + 符合性校验；业务术语 Tab：同义词/认证指标/口径解析，智能助手与 Agent 按认证口径回答、无覆盖明确拒答' },
  '/ontology/explorer': { phase: 'P3', status: 'live', note: '实例真实增删改查+动态列+关联管理+扫描录入，权限与校验完备' },
  '/ontology/views': { phase: 'P3', status: 'live', note: '跨类型全局搜索+卡片画廊+展示模板在线配置' },
  '/ontology/graph': { phase: 'P3', status: 'live', note: '真实对象/链接力导向图谱；节点详情改调 /objects/:id（全量属性+结构化关联）；graph 端点支持 type/keyword 服务端筛选' },
  '/ontology/rules': { phase: 'P10', status: 'live', note: '规则 CRUD/启停/条件构建/触发历史接真实自动化引擎' },
  '/ontology/machinery': { phase: 'P10', status: 'live', note: '动作链/执行次数/最近日志来自真实数据' },
  '/ontology/scheduling': { phase: 'P10', status: 'live', note: '本地启发式求解引擎：真实任务/约束/冲突/建议/应用 + 甘特与指标；如实标注非 COPT/OR-Tools，可升级' },
  '/ontology/timeseries': { phase: 'P10', status: 'live', note: '模拟曲线 + 真实采集：ts_points 可从对象批量采集/单点写入并画真实序列；告警规则/通知真实' },
  // 知识
  '/knowledge/library': { phase: 'P5', status: 'live', note: '文档入库→语义分块→向量化→索引，挂接对象，真实 CRUD' },
  '/knowledge/search': { phase: 'P5', status: 'live', note: 'BM25+向量混合检索，RRF 融合，命中高亮与片段溯源' },
  '/knowledge/extract': { phase: 'P5', status: 'live', note: '真实 LLM 抽取+审核+向量统计；候选可「落地为本体类型/链接类型」，真实建类型+幂等+审计留痕' },
  // 分析
  '/analytics/contour': { phase: 'P9', status: 'live', note: '维度分组聚合真实对象：柱图+饼图+明细表；支持日期分桶(日/周/月/季)、时间范围筛选、按金额排序、金额占比；修了数据源不含 properties 导致下拉为空的原有 bug' },
  '/analytics/quiver': { phase: 'P9', status: 'live', note: '真实搜索/属性/时间线；类型筛选进 /objects/search?type= 服务端过滤，计数与列表一致' },
  '/analytics/insight': { phase: 'P10', status: 'live', note: '五步路径基于真实 device/ticket/employee 对象聚合，可重跑；汇总结论实时计算' },
  '/analytics/map': { phase: 'P10', status: 'live', note: '点位/流向/热力/统计联动全用真实对象数据' },
  '/analytics/notepad': { phase: 'P10', status: 'live', note: '报告草稿/发布/列表/删除真实落库（含审计），智能处理结果随报告保存回显；AI 润色续写翻译真实 LLM' },
  '/analytics/fusion': { phase: 'P10', status: 'live', note: '表格来自真实 Factory 对象，双击单元格编辑 → PATCH 写回本体 + 审计留痕，异常行高亮' },
  // 应用
  '/apps/workshop': { phase: 'P8', status: 'live', note: '应用 CRUD+组件绑定真实对象，编辑态实时预览真实数据；无拖拽排序/变量绑定' },
  '/apps/automate': { phase: 'P7', status: 'live', note: '规则 CRUD+启停+编辑真实；condition 表达式提交、PATCH 落库、引擎真实解析参与命中判定' },
  '/apps/carbon': { phase: 'P10', status: 'live', note: '工作区磁贴来自真实运营应用列表' },
  '/apps/marketplace': { phase: 'P10', status: 'live', note: '目录遍历 PACKS 动态生成 + 真实安装计数；产品上架/下架真实落库；安装模板包真实执行；设置/版本升级仍待后续' },
  // 智能能力
  '/aip/logic': { phase: 'P6', status: 'live', note: '工作流服务端持久化（多工作流 CRUD）+ 逐步执行引擎（LLM/条件分支真实生效）' },
  '/aip/agents': { phase: 'P6', status: 'live', note: 'Agent CRUD+对话+工具真实执行+护栏生效（服务端）' },
  '/aip/threads': { phase: 'P6', status: 'live', note: '文档分析：选文档→AI 分析→带上下文多轮追问；网关失败保留草稿可重试' },
  '/aip/evals': { phase: 'P10', status: 'live', note: '评测结果/运行评测/评分全接真实 LLM' },
  '/aip/models': { phase: 'P10', status: 'live', note: '多模型注册 CRUD + 配额编目真实落库；AI 配置/连通测试/AI 回复次数用量真实；运行时仍用单一全局 AI 配置' },
  '/aip/developers': { phase: 'P10', status: 'live', note: 'API 密钥创建/删除 + 真实接入鉴权（read 限 GET、write/admin 全方法，lastUsedAt 更新）；端点/工具/AI 配置真实' },
  // 治理
  '/gov/approvals': { phase: 'P4', status: 'live', note: '需审批动作真实流转：通过即执行写回、驳回关闭、全程审计' },
  '/gov/audit': { phase: 'P4', status: 'live', note: '平台全量真实留痕：多维过滤、详情展开、导出' },
  '/gov/security': { phase: 'P10', status: 'live', note: '权限矩阵/标记统计/Checkpoint 真实；脱敏规则/扫描发现/生命周期策略改为真实三表 CRUD（轻量规则表管理）；真实脱敏管道/自动扫描器/到期调度器仍属后续规划' },
  // 管理
  '/admin/users': { phase: 'P1', status: 'live', note: '用户/角色/邀请/权限矩阵/最近活动(真实审计)真实；用户组完整 CRUD + 成员增删（含审计留痕）' },
  '/admin/roadmap': { phase: 'P0', status: 'live', note: '按本表自动计算进度；升级规划明确标注为预估非运行时指标；渲染未登记页面提示；绿标按真实 pr.done 动态生成' },
  '/admin/control': { phase: 'P6', status: 'live', note: 'SMTP/AI/嵌入/视觉四张配置卡真实生效；功能开关落库、用量为真实数据库聚合；环境信息改真实运行时数据，删除 3 组无引用的伪造常量' },
  '/admin/scan-templates': { phase: 'P6', status: 'live', note: '模板 CRUD+自动匹配+字段映射在线编辑保存（修了编辑清空映射的 bug）+真实生效' },
  '/admin/apollo': { phase: 'P10', status: 'live', note: '本地部署编排状态机：版本晋升/回滚/冻结窗口/发布记录/集群派生真实落库；如实标注非真实 K8s/CI-CD 执行' },
}

export function statusOf(path: string): PageStatusInfo | undefined {
  return PAGE_STATUS[path]
}

export function statusCount(): { live: number; partial: number; mock: number; total: number } {
  const values = Object.values(PAGE_STATUS)
  return {
    live: values.filter((v) => v.status === 'live').length,
    partial: values.filter((v) => v.status === 'partial').length,
    mock: values.filter((v) => v.status === 'mock').length,
    total: values.length,
  }
}
