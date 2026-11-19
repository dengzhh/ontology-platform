import { useState } from 'react'
import { KeyRound, Loader2, X, Check, AlertCircle } from 'lucide-react'
import { api } from '@/lib/api'
import { setToken } from '@/lib/api'

/**
 * 自助修改密码：校验原密码 + 强度（≥8 位含字母与数字）+ 二次确认
 * 改密成功后服务端吊销该用户所有旧令牌，并返回新令牌供当前会话续用
 */
export default function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const [oldPassword, setOld] = useState('')
  const [newPassword, setNew] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (newPassword !== confirm) return setError('两次输入的新密码不一致')
    if (newPassword.length < 8) return setError('新密码至少 8 位')
    if (!/[a-zA-Z]/.test(newPassword) || !/\d/.test(newPassword)) return setError('新密码需同时包含字母与数字')
    setBusy(true)
    try {
      const r = await api<{ ok: boolean; token: string }>('/auth/password', {
        method: 'POST',
        body: { oldPassword, newPassword },
      })
      // 服务端已吊销旧令牌：换用新令牌，其他设备会话随之失效
      if (r.token) setToken(r.token)
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '修改失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-[400px] max-w-[92vw] rounded-2xl border border-slate-200 bg-white p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><KeyRound size={16} /></div>
            <div>
              <div className="text-base font-bold text-slate-900">修改密码</div>
              <div className="text-[11px] text-slate-400">修改后其他设备的登录将立即失效</div>
            </div>
          </div>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={15} /></button>
        </div>

        {done ? (
          <div className="py-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-500"><Check size={24} /></div>
            <div className="text-sm font-bold text-slate-900">密码已修改</div>
            <div className="mt-1 text-xs text-slate-500">当前会话已自动续用，其他设备需重新登录</div>
            <button onClick={onClose} className="mt-5 w-full rounded-lg bg-brand-600 py-2.5 text-[13px] font-semibold text-white">完成</button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div>
              <div className="mb-1 text-[11px] font-medium text-slate-600">原密码</div>
              <input
                type="password"
                value={oldPassword}
                onChange={(e) => setOld(e.target.value)}
                autoFocus
                className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-[13px] focus:border-brand-400 focus:outline-none"
              />
            </div>
            <div>
              <div className="mb-1 text-[11px] font-medium text-slate-600">新密码</div>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNew(e.target.value)}
                placeholder="至少 8 位，含字母与数字"
                className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-[13px] focus:border-brand-400 focus:outline-none"
              />
            </div>
            <div>
              <div className="mb-1 text-[11px] font-medium text-slate-600">确认新密码</div>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-[13px] focus:border-brand-400 focus:outline-none"
              />
            </div>
            {error && (
              <div className="flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] text-red-600">
                <AlertCircle size={12} className="mt-0.5 shrink-0" /> {error}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-[12px] font-medium text-slate-600">取消</button>
              <button type="submit" disabled={busy} className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-60">
                {busy && <Loader2 size={12} className="animate-spin" />} 确认修改
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
