import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** 键值描述列表 */
export function KVList({ items, cols = 2 }: { items: { k: string; v: ReactNode }[]; cols?: number }) {
  return (
    <div className={cn('grid gap-x-6 gap-y-2.5', cols === 1 ? 'grid-cols-1' : cols === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3')}>
      {items.map((it, i) => (
        <div key={i} className="flex items-start gap-2 text-[13px]">
          <span className="w-24 shrink-0 text-slate-400">{it.k}</span>
          <span className="min-w-0 flex-1 font-medium text-slate-700">{it.v}</span>
        </div>
      ))}
    </div>
  )
}

/** 进度条 */
export function ProgressBar({ pct, color = 'bg-brand-500', className }: { pct: number; color?: string; className?: string }) {
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-slate-100', className)}>
      <div className={cn('h-full rounded-full', color)} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </div>
  )
}

/** 头像（姓名首字） */
export function Avatar({ name, className }: { name: string; className?: string }) {
  const palette = ['bg-brand-500', 'bg-violet-500', 'bg-emerald-500', 'bg-amber-500', 'bg-cyan-500', 'bg-rose-500']
  const color = palette[name.charCodeAt(0) % palette.length]
  return (
    <span className={cn('inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white', color, className)}>
      {name.slice(0, 1)}
    </span>
  )
}

/** 区块小标题 */
export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h3 className="text-sm font-semibold text-slate-800">{children}</h3>
      {right}
    </div>
  )
}
