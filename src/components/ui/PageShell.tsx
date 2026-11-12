import { useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { ChevronDown, CheckCircle2, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { statusOf } from '@/config/status'
import { StatusBadge } from './StatusBadge'

interface PageShellProps {
  icon: LucideIcon
  title: string
  subtitle: string
  benchmark: string
  features: string[]
  actions?: ReactNode
  children: ReactNode
}

/**
 * 统一页面骨架：标题区 + 能力域标识 + 可折叠功能特性 + 内容区。
 * 全站页面必须使用该组件作为页面根。
 */
export default function PageShell({ icon: Icon, title, subtitle, benchmark, features, actions, children }: PageShellProps) {
  const [open, setOpen] = useState(true)
  const { pathname } = useLocation()
  const status = statusOf(pathname)
  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1440px] flex-col gap-4 p-6">
      {/* 标题区 */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-card">
            <Icon size={22} strokeWidth={2} />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900">{title}</h1>
              <span className="rounded-md border border-brand-200 bg-brand-50 px-1.5 py-0.5 text-[11px] font-medium text-brand-700">
                {benchmark}
              </span>
              {status && <StatusBadge info={status} />}
            </div>
            <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>

      {/* 功能特性（可折叠） */}
      <div className="card overflow-hidden">
        <button
          onClick={() => setOpen(!open)}
          className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-slate-50"
        >
          <span className="text-sm font-semibold text-slate-700">功能特性介绍（{features.length}）</span>
          <ChevronDown size={16} className={cn('text-slate-400 transition-transform', !open && '-rotate-90')} />
        </button>
        {open && (
          <div className="grid grid-cols-1 gap-x-6 gap-y-2 border-t border-slate-100 px-4 py-3 md:grid-cols-2 xl:grid-cols-3">
            {features.map((f, i) => (
              <div key={i} className="flex items-start gap-2 text-[13px] leading-5 text-slate-600">
                <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-500" />
                <span>{f}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 内容区 */}
      <div className="flex flex-1 flex-col gap-4 pb-4">{children}</div>
    </div>
  )
}
