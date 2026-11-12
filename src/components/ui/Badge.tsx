import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type BadgeColor = 'blue' | 'green' | 'amber' | 'red' | 'slate' | 'violet' | 'cyan'

const COLOR_MAP: Record<BadgeColor, string> = {
  blue: 'bg-brand-50 text-brand-700 border-brand-200',
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  red: 'bg-red-50 text-red-600 border-red-200',
  slate: 'bg-slate-100 text-slate-600 border-slate-200',
  violet: 'bg-violet-50 text-violet-700 border-violet-200',
  cyan: 'bg-cyan-50 text-cyan-700 border-cyan-200',
}

const DOT_MAP: Record<BadgeColor, string> = {
  blue: 'bg-brand-500',
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
  slate: 'bg-slate-400',
  violet: 'bg-violet-500',
  cyan: 'bg-cyan-500',
}

interface BadgeProps {
  color?: BadgeColor
  dot?: boolean
  children: ReactNode
  className?: string
}

/** 彩色小标签 */
export function Badge({ color = 'slate', dot, children, className }: BadgeProps) {
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium', COLOR_MAP[color], className)}>
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', DOT_MAP[color])} />}
      {children}
    </span>
  )
}

/** 状态圆点 */
export function StatusDot({ color = 'slate' }: { color?: BadgeColor }) {
  return <span className={cn('inline-block h-2 w-2 rounded-full', DOT_MAP[color])} />
}
