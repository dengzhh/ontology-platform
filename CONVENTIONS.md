# OntoOS 页面开发规范

> 本项目为企业本体智能平台（v1.0.0 基线）。**42 个应用页面全部 `live`**（0 partial / 0 mock），
> 全部通过 `src/lib/api.ts` / `useApi` 打真实 `/api` 并读写 SQLite；状态以 `src/config/status.ts` 为单一事实来源。
> 调度优化 / 部署发布为本地真实引擎（真实落库），页面如实标注能力边界（非 COPT/OR-Tools、非 K8s/CI-CD）；
> 个别子能力（实时脱敏管道、自动归档调度器、Git PR 集成等）仍待后续接入，均带醒目标注，
> 且所有交互按钮必须给出明确反馈，禁止假装成功、禁止把演示态虚标为 live。

## 技术栈与约束

- 前端：React 18 + TypeScript(strict) + Vite + TailwindCSS + react-router-dom + lucide-react + recharts
- 后端：Hono + @hono/node-server + better-sqlite3 + Drizzle ORM；`server/routes/*` 分组挂载于 `server/index.ts`
- **接真约定**：数据读写走 `api()`（`src/lib/api.ts`，自动带 JWT 与 `x-space-id`）；查询用 `useApi()`（`src/lib/useApi.ts`）
- **禁止**：使用 `any`；把写死数据伪装成真实功能；把 `mock` 页虚标为 `live`
- 所有文案为简体中文，示例企业为「星辰智造集团」（设备制造：客户/订单/产品/设备/工单/员工/工厂/供应商）
- 路径别名 `@/` = `src/`
- 样式：浅色企业风。卡片用全局 class `card`；主色 `brand-600`；中性色 `slate`；画布底纹 `canvas-grid`
- 每完成一项功能，同步更新 `src/config/status.ts`（PageShell 徽章 / Launcher 圆点 / 实现进度页全站即时同步）

## 页面骨架（必须使用）

每个页面一个文件，`export default function XxxPage()`，用 `PageShell` 包裹：

```tsx
import PageShell from '@/components/ui/PageShell'
import { Boxes } from 'lucide-react'

export default function XxxPage() {
  return (
    <PageShell
      icon={Boxes}                    // lucide 图标组件
      title="页面名"
      subtitle="一句话说明该应用做什么"
      benchmark="能力域标签（如：本体建模 / 探索分析 / AI 工作流）"
      features={['特性1（一句话）', '特性2', ...]}   // 4-7 条
      actions={<>按钮…</>}            // 可选：页面右上角操作按钮
    >
      {/* 页面主体：统计卡 / 表格 / 画布 / 图表等 */}
    </PageShell>
  )
}
```

## 可用共享组件（全部已实现，直接用，勿改）

### ui/PageShell —— 见上

### ui/Card —— `import { Card, CardHeader } from '@/components/ui/Card'`
- `<Card padding? className?>{children}</Card>` 白卡片
- `<CardHeader title desc? actions? />` 卡片头

### ui/StatCard —— `import StatCard from '@/components/ui/StatCard'`
- `{ label, value, unit?, delta?, deltaUp?=true, icon: LucideIcon, iconClass?, footer? }`

### ui/DataTable —— `import DataTable, { type Column } from '@/components/ui/DataTable'`
- `{ columns: Column<T>[], rows: T[], rowKey?, onRowClick?, maxHeight?, dense? }`
- `Column<T> = { key, header, width?, align?: 'left'|'right'|'center', cell?: (row, i) => ReactNode }`
- rows 直接传类型化对象数组，**不要加类型断言**

### ui/Badge —— `import { Badge, StatusDot } from '@/components/ui/Badge'`
- `<Badge color="blue|green|amber|red|slate|violet|cyan" dot?>{text}</Badge>`

### ui/Tabs —— `import Tabs from '@/components/ui/Tabs'`
- `{ tabs: {key,label,count?}[], active, onChange, size? }` 胶囊选项卡

### ui/Btn —— `import Btn from '@/components/ui/Btn'`
- `<Btn variant="primary|secondary|ghost|danger" size="sm|md">内容</Btn>`

### ui/Form —— `import { Input, SearchInput, Select, Field } from '@/components/ui/Form'`

### ui/Timeline —— `import Timeline, { type TimelineItem } from '@/components/ui/Timeline'`
- `TimelineItem = { time, title, desc?, icon?, color? }`

### ui/Misc —— `import { KVList, ProgressBar, Avatar, SectionTitle } from '@/components/ui/Misc'`
- `KVList { items: {k,v}[], cols? }` 键值描述；`ProgressBar { pct, color? }`；`Avatar { name }`；`SectionTitle`

### canvas/FlowCanvas —— `import FlowCanvas, { type FlowNode, type FlowEdge } from '@/components/canvas/FlowCanvas'`
- `{ nodes: FlowNode[], edges: FlowEdge[], width?=1100, height?=420, className? }`（SVG viewBox 尺寸）
- `FlowNode = { id, x, y, w?=176, h?=60, title, subtitle?, icon?: LucideIcon, accent?（图标底色类名，如 'bg-brand-50 text-brand-600'）, status?: 'ok'|'warn'|'err'|'run', badge? }`
- `FlowEdge = { from, to, label?, dashed? }`；节点坐标以左上角为准，自己排版（横向流 x 间隔约 240）

### canvas/GraphCanvas —— `import GraphCanvas, { type GraphNode, type GraphLink } from '@/components/canvas/GraphCanvas'`
- `{ nodes: GraphNode[], links: GraphLink[], width?=1000, height?=520, legend?: {label,color}[] }`
- `GraphNode = { id, x, y, label, sub?, color?（十六进制）, size?=26 }`

### canvas/GanttView —— `import GanttView, { type GanttRow, type GanttBar } from '@/components/canvas/GanttView'`
- `{ rows: GanttRow[], timeline: string[] }`；`GanttRow = { name, sub?, bars: GanttBar[] }`；`GanttBar = { start, span（均为 0-100 百分比）, label, color（tailwind bg 类）, progress? }`

### canvas/MapView —— `import MapView, { type MapPoint, type MapArc } from '@/components/canvas/MapView'`
- `{ points: MapPoint[], arcs: MapArc[], width?=1000, height?=460 }`；`MapPoint = { x, y, label, value?, color?, hot? }`

### canvas/SpreadsheetGrid —— `import SpreadsheetGrid from '@/components/canvas/SpreadsheetGrid'`
- `{ headers: string[], rows: string[][], formula?, highlight?: string[]（如 'B3'）, onCellEdit?: (row, col, value) => void }`
- 传入 `onCellEdit` 后双击单元格可编辑（Fusion 页用其写回本体对象）

### canvas/CodeBlock —— `import { CodeBlock, DiffView, type DiffLine } from '@/components/canvas/CodeBlock'`
- `CodeBlock { code, title?, maxLines? }`；`DiffView { file, lines: {type:'add'|'del'|'ctx', text}[] }`

## 示例数据（仅限 seed，页面禁止运行时引用）

- `src/mocks/*` **仅供 `server/seed.ts` 灌初始数据使用**；新页面一律通过 `useApi/api` 打真实接口，不要 import mocks
- 唯一运行时例外：无（原 `Topbar` 的 `USERS` 已改 `/users` 接口）
- 页面专属的静态展示常量（如图例颜色）可在页面文件内定义，但**业务数据必须来自 API**

## 工具函数

- `import { cn } from '@/lib/utils'` 拼接类名；`seeded(n)` 确定性伪随机

## 风格基准

以 `src/pages/ontology/OntologyManager.tsx`（列表+详情+表格布局）与 `src/pages/apps/Workshop.tsx`（多栏画布布局）为风格基准：密度适中、留白克制、badge/彩色圆点表达状态、图表用 recharts（Tooltip 样式 `contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}`）。

## 自检

- 前端：`npm run build`（Vite 构建，含 TS 转译）
- 后端：`npm run typecheck:server`（`tsc -p server`）
- 接真后务必浏览器走查 + `curl` 冒烟对应 `/api` 端点，并同步 `src/config/status.ts`。
