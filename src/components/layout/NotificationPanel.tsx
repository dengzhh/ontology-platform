import { Bell, Check, Zap, ShieldAlert, CheckCircle2, Info, Trash2 } from 'lucide-react'
import { useUI } from '@/store/ui'
import { api } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'

interface NotifRow {
  id: string
  title: string
  body: string
  level: string
  tag: string
  read: boolean
  createdAt: string
}

const LEVEL_META: Record<string, { icon: typeof Info; cls: string }> = {
  info: { icon: Info, cls: 'bg-brand-50 text-brand-500' },
  warn: { icon: ShieldAlert, cls: 'bg-amber-50 text-amber-500' },
  error: { icon: ShieldAlert, cls: 'bg-red-50 text-red-500' },
  success: { icon: CheckCircle2, cls: 'bg-emerald-50 text-emerald-500' },
}

/** 通知中心浮层（真实数据，P7） */
export default function NotificationPanel() {
  const { notifOpen, setNotifOpen } = useUI()
  const q = useApi<{ unread: number; notifications: NotifRow[] }>(notifOpen ? '/automations/notifications' : null)

  if (!notifOpen) return null
  const notifs = q.data?.notifications ?? []
  const unread = q.data?.unread ?? 0

  return (
    <div className="fixed inset-0 z-40" onClick={() => setNotifOpen(false)}>
      <div className="absolute right-4 top-14 w-[380px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
            <Bell size={15} className="text-brand-600" />
            通知中心
            {unread > 0 && <span className="rounded-full bg-red-500 px-1.5 py-px text-[10px] font-semibold text-white">{unread}</span>}
          </div>
          <div className="flex gap-1">
            <button onClick={() => api('/automations/notifications/read', { method: 'POST', body: {} }).then(() => q.reload())} className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
              <Check size={12} /> 全部已读
            </button>
            <button onClick={() => setNotifOpen(false)} className="ml-1 text-slate-300 hover:text-slate-500"><Trash2 size={0} className="hidden" /><span className="text-slate-400">✕</span></button>
          </div>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {q.loading ? (
            <div className="px-4 py-8 text-center text-sm text-slate-400">加载通知…</div>
          ) : notifs.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-400">暂无通知——自动化规则触发后会出现在这里</div>
          ) : (
            notifs.map((n) => {
              const M = LEVEL_META[n.level] ?? LEVEL_META.info
              return (
                <div key={n.id} className={cn('flex cursor-pointer items-start gap-3 border-b border-slate-50 px-4 py-3 hover:bg-slate-50', !n.read && 'bg-brand-50/40')} onClick={() => api('/automations/notifications/read', { method: 'POST', body: { id: n.id } }).then(() => q.reload())}>
                  <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', M.cls)}>
                    <M.icon size={15} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium leading-5 text-slate-700">{n.title}</div>
                    {n.body && <div className="mt-0.5 text-[11px] leading-4 text-slate-400">{n.body}</div>}
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
                      <span>{n.createdAt}</span>
                      <span className="rounded bg-slate-100 px-1.5 py-px">{n.tag}</span>
                    </div>
                  </div>
                  {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" />}
                </div>
              )
            })
          )}
        </div>
        <div className="border-t border-slate-100 px-4 py-2 text-center text-[11px] text-slate-400">
          通知由自动化规则与平台事件实时生成 · 自动化引擎
        </div>
      </div>
    </div>
  )
}
