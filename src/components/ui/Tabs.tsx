import { cn } from '@/lib/utils'

export interface TabItem {
  key: string
  label: string
  count?: number
}

interface TabsProps {
  tabs: TabItem[]
  active: string
  onChange: (key: string) => void
  className?: string
  size?: 'sm' | 'md'
}

/** 胶囊式选项卡 */
export default function Tabs({ tabs, active, onChange, className, size = 'md' }: TabsProps) {
  return (
    <div className={cn('inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1', className)}>
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            'flex items-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-[13px]',
            active === t.key ? 'bg-white text-brand-700 shadow-card' : 'text-slate-500 hover:text-slate-700',
          )}
        >
          {t.label}
          {t.count !== undefined && (
            <span className={cn('rounded px-1 text-[10px]', active === t.key ? 'bg-brand-100 text-brand-700' : 'bg-slate-200 text-slate-500')}>{t.count}</span>
          )}
        </button>
      ))}
    </div>
  )
}
