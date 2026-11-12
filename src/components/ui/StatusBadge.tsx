import { cn } from '@/lib/utils'
import type { PageStatusInfo } from '@/config/status'

const META = {
  live: { label: '已实现', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500', icon: '●' },
  partial: { label: '部分实现', cls: 'border-amber-200 bg-amber-50 text-amber-700', dot: 'bg-amber-500', icon: '◐' },
  mock: { label: '原型演示', cls: 'border-slate-200 bg-slate-50 text-slate-500', dot: 'bg-slate-300', icon: '○' },
}

/** 页面实现状态徽章（阶段 + 状态） */
export function StatusBadge({ info, showPhase = true }: { info: PageStatusInfo; showPhase?: boolean }) {
  const m = META[info.status]
  return (
    <span
      title={info.note ?? `${m.label} · ${info.phase}`}
      className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium', m.cls)}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', m.dot)} />
      {m.label}
      {showPhase && <span className="opacity-70">{info.phase}</span>}
    </span>
  )
}

/** 状态小圆点（Launcher 卡片用） */
export function StatusDot({ info }: { info: PageStatusInfo }) {
  const m = META[info.status]
  return <span title={`${m.label} · ${info.phase}`} className={cn('inline-block h-2 w-2 rounded-full', m.dot)} />
}
