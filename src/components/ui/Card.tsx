import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface CardProps {
  children: ReactNode
  className?: string
  padding?: boolean
}

/** 通用白卡片 */
export function Card({ children, className, padding = true }: CardProps) {
  return <div className={cn('card', padding && 'p-4', className)}>{children}</div>
}

interface CardHeaderProps {
  title: ReactNode
  desc?: ReactNode
  actions?: ReactNode
  className?: string
}

/** 卡片头：标题 + 说明 + 右侧操作 */
export function CardHeader({ title, desc, actions, className }: CardHeaderProps) {
  return (
    <div className={cn('mb-3 flex items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-slate-800">{title}</div>
        {desc && <div className="mt-0.5 text-xs text-slate-400">{desc}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}
