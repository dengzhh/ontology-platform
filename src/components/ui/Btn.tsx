import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  children: ReactNode
}

/** 通用按钮 */
export default function Btn({ variant = 'secondary', size = 'md', className, children, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors',
        size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-[13px]',
        variant === 'primary' && 'bg-brand-600 text-white hover:bg-brand-700',
        variant === 'secondary' && 'border border-slate-200 bg-white text-slate-700 hover:border-brand-300 hover:text-brand-700',
        variant === 'ghost' && 'text-slate-500 hover:bg-slate-100 hover:text-slate-700',
        variant === 'danger' && 'bg-red-500 text-white hover:bg-red-600',
        className,
      )}
    >
      {children}
    </button>
  )
}
