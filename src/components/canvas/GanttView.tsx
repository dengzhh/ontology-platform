import { cn } from '@/lib/utils'

export interface GanttBar {
  /** 0-100 百分比起点 */
  start: number
  /** 0-100 百分比长度 */
  span: number
  label: string
  color: string
  progress?: number
}

export interface GanttRow {
  name: string
  sub?: string
  bars: GanttBar[]
}

/** 甘特图视图：用于调度优化、Apollo 发布计划等 */
export default function GanttView({ rows, timeline, className }: { rows: GanttRow[]; timeline: string[]; className?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-lg border border-slate-200 bg-white', className)}>
      <div className="min-w-max">
        {/* 时间轴表头 */}
        <div className="flex border-b border-slate-200 bg-slate-50">
          <div className="w-44 shrink-0 px-3 py-2 text-xs font-medium text-slate-500">资源 / 任务</div>
          <div className="relative flex-1">
            <div className="flex">
              {timeline.map((t, i) => (
                <div key={i} className="flex-1 border-l border-slate-200 px-2 py-2 text-center text-[11px] text-slate-500 first:border-l-0">
                  {t}
                </div>
              ))}
            </div>
          </div>
        </div>
        {rows.map((r, i) => (
          <div key={i} className="flex border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
            <div className="w-44 shrink-0 px-3 py-2.5">
              <div className="text-[13px] font-medium text-slate-700">{r.name}</div>
              {r.sub && <div className="text-[11px] text-slate-400">{r.sub}</div>}
            </div>
            <div className="relative flex-1 py-2.5">
              <div className="absolute inset-0 flex">
                {timeline.map((_, j) => (
                  <div key={j} className="flex-1 border-l border-slate-100 first:border-l-0" />
                ))}
              </div>
              {r.bars.map((b, j) => (
                <div
                  key={j}
                  className="relative mb-1.5 h-6 last:mb-0"
                  style={{ marginLeft: `${b.start}%`, width: `${b.span}%` }}
                >
                  <div className={cn('flex h-full items-center overflow-hidden rounded-md px-2 text-[11px] font-medium text-white shadow-card', b.color)}>
                    <span className="truncate">{b.label}</span>
                    {b.progress !== undefined && (
                      <div className="absolute inset-0 rounded-md bg-white/25" style={{ width: `${b.progress}%` }} />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
