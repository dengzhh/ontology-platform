import { NavLink } from 'react-router-dom'
import { ChevronLeft, Boxes } from 'lucide-react'
import { useState } from 'react'
import { NAV_GROUPS } from '@/config/nav'
import { useUI } from '@/store/ui'
import { cn } from '@/lib/utils'

/** 左侧分组导航（按当前用户角色的可见应用过滤，来自服务端会话） */
export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const { currentUser } = useUI()
  const apps = currentUser?.role.apps ?? []
  const groups = NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((it) => apps.includes('*') || apps.includes(it.path)) })).filter((g) => g.items.length > 0)
  return (
    <aside
      className={cn(
        'relative z-20 flex shrink-0 flex-col border-r border-slate-200 bg-white transition-all duration-200',
        collapsed ? 'w-14' : 'w-56',
      )}
    >
      {/* Logo */}
      <div className="flex h-14 items-center gap-2.5 border-b border-slate-100 px-3.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-600 text-white">
          <Boxes size={18} />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="truncate text-[15px] font-bold leading-tight text-slate-900">OntoOS</div>
            <div className="truncate text-[10px] text-slate-400">企业本体智能平台</div>
          </div>
        )}
      </div>

      {/* 导航 */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {groups.map((g) => (
          <div key={g.group} className="mb-3 last:mb-0">
            {!collapsed && <div className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{g.group}</div>}
            {collapsed && <div className="mx-auto mb-2 mt-1 h-px w-6 bg-slate-100" />}
            {g.items.map((it) => (
              <NavLink
                key={it.path}
                to={it.path}
                title={it.name}
                className={({ isActive }) =>
                  cn(
                    'group mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors',
                    isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <it.icon size={16} className={cn('shrink-0', isActive ? 'text-brand-600' : 'text-slate-400 group-hover:text-slate-600')} />
                    {!collapsed && <span className="truncate">{it.name}</span>}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {/* 折叠按钮 */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="absolute -right-3 top-16 z-30 flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 shadow-card hover:text-brand-600"
      >
        <ChevronLeft size={13} className={cn('transition-transform', collapsed && 'rotate-180')} />
      </button>
    </aside>
  )
}
