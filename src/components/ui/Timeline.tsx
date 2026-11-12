import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BadgeColor } from './Badge'

export interface TimelineItem {
  time: string
  title: string
  desc?: string
  icon?: LucideIcon
  color?: BadgeColor
}

const DOT: Record<BadgeColor, string> = {
  blue: 'bg-brand-500',
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
  slate: 'bg-slate-400',
  violet: 'bg-violet-500',
  cyan: 'bg-cyan-500',
}

/** 垂直时间线 */
export default function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <div className="relative pl-4">
      <div className="absolute bottom-1 left-[7px] top-1 w-px bg-slate-200" />
      {items.map((it, i) => {
        const Icon = it.icon
        return (
          <div key={i} className="relative pb-4 last:pb-0">
            <span className={cn('absolute -left-4 top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white', DOT[it.color ?? 'slate'])} />
            <div className="text-[11px] text-slate-400">{it.time}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[13px] font-medium text-slate-700">
              {Icon && <Icon size={13} className="text-slate-400" />}
              {it.title}
            </div>
            {it.desc && <div className="mt-0.5 text-xs leading-5 text-slate-500">{it.desc}</div>}
          </div>
        )
      })}
    </div>
  )
}
