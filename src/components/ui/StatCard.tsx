import type { LucideIcon } from 'lucide-react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { cn } from '@/lib/utils'

interface StatCardProps {
  label: string
  value: string | number
  unit?: string
  delta?: string
  deltaUp?: boolean
  icon: LucideIcon
  iconClass?: string
  footer?: string
}

/** 指标统计卡 */
export default function StatCard({ label, value, unit, delta, deltaUp = true, icon: Icon, iconClass = 'bg-brand-50 text-brand-600', footer }: StatCardProps) {
  return (
    <div className="card flex items-center gap-3 p-4">
      <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', iconClass)}>
        <Icon size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-slate-400">{label}</div>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1 gap-y-0.5">
          <span className="text-xl font-bold text-slate-900">{value}</span>
          {unit && <span className="text-xs text-slate-400">{unit}</span>}
          {delta && (
            <span className={cn('ml-1 inline-flex items-center gap-0.5 text-[11px] font-medium', deltaUp ? 'text-emerald-600' : 'text-red-500')}>
              {deltaUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              {delta}
            </span>
          )}
        </div>
        {footer && <div className="mt-0.5 truncate text-[11px] text-slate-400">{footer}</div>}
      </div>
    </div>
  )
}
