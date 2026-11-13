import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  PanelsTopLeft,
  LayoutGrid,
  Pencil,
  Plus,
  Loader2,
  ArrowRight,
  Clock3,
  Info,
  RefreshCw,
} from 'lucide-react'
import PageShell from '@/components/ui/PageShell'
import Tabs from '@/components/ui/Tabs'
import Btn from '@/components/ui/Btn'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'

/** GET /api/p10/carbon 的真实看板列表（当前空间内的 Workshop 应用） */
interface CarbonApp {
  id: string
  name: string
  desc: string
  widgetCount: number
  updatedAt: string
}
interface CarbonResp { apps: CarbonApp[] }

/** 禁用按钮统一视觉：明显不可点，避免「看着能点实际没反应」的死按钮 */
const DISABLED_CLS = 'disabled:cursor-not-allowed disabled:opacity-50'

/** 按组件数量把真实看板分组（Tab 过滤条件） */
function bucketOf(n: number): string {
  return n <= 2 ? 'lite' : n <= 5 ? 'standard' : 'rich'
}

const BUCKETS: { key: string; label: string }[] = [
  { key: 'all', label: '全部看板' },
  { key: 'lite', label: '精简 · ≤2 组件' },
  { key: 'standard', label: '标准 · 3-5 组件' },
  { key: 'rich', label: '丰富 · ≥6 组件' },
]

/** 磁贴：一条真实 Workshop 看板 */
function AppTile({ app }: { app: CarbonApp }) {
  return (
    <Link
      to="/apps/workshop"
      className="group flex flex-col rounded-xl border border-slate-200 bg-white p-4 transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-card"
    >
      <div className="flex items-start justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-violet-500 text-white">
          <LayoutGrid size={19} />
        </div>
        <Badge color="blue">{app.widgetCount} 组件</Badge>
      </div>
      <div className="mt-3 truncate text-[14px] font-bold text-slate-800 group-hover:text-brand-700">{app.name}</div>
      <div className="mt-1 line-clamp-2 min-h-[32px] text-xs leading-4 text-slate-400">{app.desc || '暂无描述'}</div>
      <div className="mt-2 flex items-center gap-1 text-[11px] text-slate-400"><Clock3 size={11} /> 更新于 {app.updatedAt}</div>
      <div className="mt-2 flex items-center gap-1 text-[12px] font-medium text-brand-600">
        打开看板 <ArrowRight size={13} />
      </div>
    </Link>
  )
}

/** Carbon 工作区：聚合当前空间的真实 Workshop 看板 */
export default function Carbon() {
  const q = useApi<CarbonResp>('/p10/carbon')
  const apps = q.data?.apps ?? []
  const [tab, setTab] = useState('all')

  // Tab 与计数均由真实数据派生；只展示非空分组
  const tabs = useMemo(() => {
    return BUCKETS
      .map((b) => ({
        key: b.key,
        label: b.label,
        count: b.key === 'all' ? apps.length : apps.filter((a) => bucketOf(a.widgetCount) === b.key).length,
      }))
      .filter((b) => b.key === 'all' || b.count > 0)
  }, [apps])

  // 数据变化后若原分组已消失，回退到「全部」
  const active = tabs.some((t) => t.key === tab) ? tab : 'all'
  const shown = active === 'all' ? apps : apps.filter((a) => bucketOf(a.widgetCount) === active)

  return (
    <PageShell
      icon={PanelsTopLeft}
      title="岗位工作区"
      subtitle="把当前空间的 Workshop 看板聚合为一屏工作台 —— 真实应用、真实组件数、即时直达"
      benchmark="岗位工作区"
      features={[
        '真实看板：工作区磁贴直接取自当前本体空间的 Workshop 应用列表',
        '组件分组：按每个应用挂载的组件数量自动归类，Tab 实时过滤',
        '一屏直达：点击磁贴进入 Workshop 打开对应看板',
        '同步更新：名称、说明、组件数与更新时间随后端数据刷新',
        '空间隔离：仅展示当前空间可见的应用，不掺杂演示数据',
      ]}
      actions={
        <>
          <Btn size="sm" disabled className={DISABLED_CLS} title="编辑布局需要工作区布局存储接口，后端暂未提供"><Pencil size={13} /> 编辑布局</Btn>
          <Btn size="sm" variant="primary" disabled className={DISABLED_CLS} title="新建工作区需要工作区元数据写入接口，后端暂未提供"><Plus size={14} /> 新建工作区</Btn>
        </>
      }
    >
      {/* 加载失败：错误提示 + 重试 */}
      {q.error && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700">
          <span>看板加载失败：{q.error}</span>
          <Btn size="sm" variant="ghost" onClick={q.reload}><RefreshCw size={13} /> 重试</Btn>
        </div>
      )}

      <Card padding={false}>
        {/* 分组切换（全部由真实数据派生） */}
        <div className="border-b border-slate-100 p-3">
          <Tabs tabs={tabs} active={active} onChange={setTab} />
        </div>

        {/* 当前空间概览 */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/50 px-4 py-3">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-500 text-white">
              <PanelsTopLeft size={17} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[15px] font-bold text-slate-900">当前空间看板</span>
                <Badge color="blue">{apps.length} 个应用</Badge>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">共 {apps.reduce((s, a) => s + a.widgetCount, 0)} 个组件 · 数据来自 GET /api/p10/carbon</p>
            </div>
          </div>
        </div>

        {/* 磁贴网格 */}
        <div className="p-4">
          {q.loading && apps.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-slate-400"><Loader2 size={18} className="mr-2 animate-spin" /> 正在加载看板…</div>
          ) : shown.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {shown.map((a) => <AppTile key={a.id} app={a} />)}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-16 text-center text-slate-400">
              <LayoutGrid size={28} />
              <span className="text-sm">{apps.length === 0 ? '当前空间暂无 Workshop 看板' : '该分组下暂无看板'}</span>
              <Link to="/apps/workshop" className="text-xs font-medium text-brand-600 hover:underline">前往 Workshop 创建应用 →</Link>
            </div>
          )}

          <div className={cn('mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-slate-200 p-3 text-[11px] text-slate-400')}>
            <span className="flex items-center gap-1.5"><Info size={13} /> 编辑布局 / 新建工作区暂不可用：后端尚未提供工作区布局与元数据的写入接口</span>
            <span>磁贴均为真实应用，点击后在 Workshop 中打开</span>
          </div>
        </div>
      </Card>
    </PageShell>
  )
}
