import {
  Activity,
  BarChart3,
  BookOpen,
  Bot,
  Boxes,
  CalendarClock,
  ClipboardCheck,
  Code,
  Cpu,
  Database,
  FileSearch,
  FileText,
  Flag,
  Footprints,
  Gauge,
  Grid3x3,
  LayoutGrid,
  LayoutTemplate,
  LineChart,
  Map,
  MessagesSquare,
  MousePointerClick,
  Network,
  PanelsTopLeft,
  Plug,
  Rocket,
  Route,
  Scale,
  ScanLine,
  ScanText,
  ScrollText,
  Search,
  UsersRound,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Store,
  Table2,
  Terminal,
  TestTube2,
  Workflow,
  Zap,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  path: string
  name: string
  icon: LucideIcon
  desc: string
  benchmark: string
}

export interface NavGroup {
  group: string
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    group: '概览',
    items: [
      { path: '/launcher', name: '应用中心', icon: LayoutGrid, desc: '平台全部应用的入口与产品矩阵总览', benchmark: '应用门户' },
      { path: '/overview', name: '平台仪表盘', icon: Gauge, desc: '数据、本体、AI 与治理的全局运行概览', benchmark: '运行总览' },
    ],
  },
  {
    group: '数据',
    items: [
      { path: '/data/connections', name: '数据连接', icon: Plug, desc: '连接数据库、API、文件等企业数据源并同步', benchmark: '数据集成' },
      { path: '/data/pipelines', name: '管道构建', icon: Workflow, desc: '无代码拖拽构建端到端数据加工管道', benchmark: '数据管道' },
      { path: '/data/code', name: '代码仓库', icon: Code, desc: '在线 IDE 编写生产级转换代码与协作评审', benchmark: '代码工程' },
      { path: '/data/datasets', name: '数据集', icon: Database, desc: '数据集浏览、预览与数据质量健康管理', benchmark: '数据资产' },
      { path: '/data/lineage', name: '数据血缘', icon: Network, desc: '跨应用的数据流转全景血缘图谱', benchmark: '血缘分析' },
    ],
  },
  {
    group: '本体',
    items: [
      { path: '/ontology/manager', name: '本体管理器', icon: Boxes, desc: '定义对象、链接、动作、函数与接口', benchmark: '本体建模' },
      { path: '/ontology/explorer', name: '对象浏览器', icon: Search, desc: '单类型表格工作台：增删改查与关联管理', benchmark: '对象工作台' },
      { path: '/ontology/views', name: '对象视图', icon: LayoutTemplate, desc: '跨类型全局搜索 + 卡片画廊 + 展示模板配置', benchmark: '对象视图' },
      { path: '/ontology/graph', name: '关系图谱', icon: Share2, desc: '对象关系网络探索与业务仿真', benchmark: '关系网络' },
      { path: '/ontology/rules', name: '规则引擎', icon: Scale, desc: '面向对象与时序的复杂业务规则管理', benchmark: '规则引擎' },
      { path: '/ontology/machinery', name: '流程编排', icon: Route, desc: '理解、管理与编排多步业务流程', benchmark: '流程编排' },
      { path: '/ontology/scheduling', name: '调度优化', icon: CalendarClock, desc: '资源调度与排程的约束求解优化', benchmark: '调度优化' },
      { path: '/ontology/timeseries', name: '时序与告警', icon: Activity, desc: '时序指标监控、异常检测与告警订阅', benchmark: '时序监控' },
    ],
  },
  {
    group: '知识',
    items: [
      { path: '/knowledge/library', name: '知识库', icon: BookOpen, desc: '企业文档知识统一入库、解析分块与向量化', benchmark: '知识工程' },
      { path: '/knowledge/search', name: '知识检索', icon: FileSearch, desc: '语义 + 关键词混合检索，结果带引用可溯源', benchmark: '混合检索' },
      { path: '/knowledge/extract', name: '知识抽取', icon: ScanText, desc: '从文档抽取实体关系反哺本体，向量索引管理', benchmark: '知识抽取' },
    ],
  },
  {
    group: '分析',
    items: [
      { path: '/analytics/contour', name: '探索分析', icon: BarChart3, desc: '面向数据集的点击式探索分析与看板', benchmark: '探索分析' },
      { path: '/analytics/quiver', name: '联动分析', icon: LineChart, desc: '面向本体对象与时序的联动分析', benchmark: '联动分析' },
      { path: '/analytics/insight', name: '路径分析', icon: Footprints, desc: '基于对象的分步点击式分析路径', benchmark: '路径分析' },
      { path: '/analytics/map', name: '地理空间', icon: Map, desc: '地理空间数据可视化与图层分析', benchmark: '地理空间' },
      { path: '/analytics/notepad', name: '智能报告', icon: FileText, desc: '富文本协作报告，数据组件实时联动', benchmark: '智能报告' },
      { path: '/analytics/fusion', name: '智能表格', icon: Grid3x3, desc: '双向同步的智能电子表格', benchmark: '智能表格' },
    ],
  },
  {
    group: '应用',
    items: [
      { path: '/apps/workshop', name: '应用搭建', icon: MousePointerClick, desc: '拖拽组件搭建运营应用，变量联动本体', benchmark: '低代码搭建' },
      { path: '/apps/automate', name: '自动化引擎', icon: Zap, desc: '数据变化触发通知与动作的自动化', benchmark: '自动化引擎' },
      { path: '/apps/carbon', name: '岗位工作区', icon: PanelsTopLeft, desc: '将多个应用组合为岗位专属工作台', benchmark: '岗位工作区' },
      { path: '/apps/marketplace', name: '应用市场', icon: Store, desc: '发现、安装与发布可复用产品', benchmark: '应用市场' },
    ],
  },
  {
    group: '智能能力',
    items: [
      { path: '/aip/logic', name: '工作流编排', icon: Sparkles, desc: '无代码编排 LLM 工作流：提示、工具与分支', benchmark: 'AI 工作流' },
      { path: '/aip/agents', name: '智能体构建', icon: Bot, desc: '构建可调用工具与检索的智能体', benchmark: '智能体构建' },
      { path: '/aip/threads', name: 'AI 任务流', icon: MessagesSquare, desc: '面向文档与数据的免配置 AI 任务流', benchmark: 'AI 任务流' },
      { path: '/aip/evals', name: '模型评估', icon: TestTube2, desc: 'LLM 输出的测试用例评估与模型对比', benchmark: '模型评估' },
      { path: '/aip/models', name: '模型管理', icon: Cpu, desc: '多模型接入、注册与用量治理', benchmark: '模型接入' },
      { path: '/aip/developers', name: '开发者工具', icon: Terminal, desc: 'OSDK / Ontology MCP 示例与密钥管理', benchmark: '开发者生态' },
    ],
  },
  {
    group: '治理',
    items: [
      { path: '/gov/approvals', name: '审批中心', icon: ClipboardCheck, desc: '变更请求的审批流与合规处理', benchmark: '审批流转' },
      { path: '/gov/audit', name: '审计日志', icon: ScrollText, desc: '全平台操作的检索与合规审计', benchmark: '审计合规' },
      { path: '/gov/security', name: '安全与标记', icon: ShieldCheck, desc: '权限、数据标记、脱敏与敏感数据扫描', benchmark: '数据安全' },
    ],
  },
  {
    group: '管理',
    items: [
      { path: '/admin/users', name: '用户与权限', icon: UsersRound, desc: '用户、角色与用户组，应用与数据权限按角色收敛', benchmark: '身份权限' },
      { path: '/admin/roadmap', name: '实现进度', icon: Flag, desc: '各功能实现阶段与状态的总路线图', benchmark: '交付管理' },
      { path: '/admin/control', name: '控制面板', icon: SlidersHorizontal, desc: '功能开关、用量监控与可观测性', benchmark: '平台运维' },
      { path: '/admin/scan-templates', name: '识别模板', icon: ScanLine, desc: '扫描识别提示词模板：内置自动匹配 + 自定义', benchmark: '识别模板' },
      { path: '/admin/apollo', name: '部署发布', icon: Rocket, desc: '多环境持续交付与多集群发布管理', benchmark: '部署发布' },
    ],
  },
]

export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items)

export function findNav(path: string): NavItem | undefined {
  return ALL_NAV_ITEMS.find((i) => i.path === path)
}
