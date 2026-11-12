import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Boxes, KeyRound, CircleCheck, Loader2, ShieldCheck } from 'lucide-react'
import { api } from '@/lib/api'

/** 账号激活页（邀请邮件链接落地，公开） */
export default function Invite() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ account: string } | null>(null)

  async function activate(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 6) return setError('密码至少 6 位')
    if (password !== confirm) return setError('两次输入的密码不一致')
    setBusy(true)
    setError('')
    try {
      const res = await api<{ ok: boolean; account: string }>('/auth/activate', { method: 'POST', body: { token, password } })
      setDone({ account: res.account })
    } catch (err) {
      setError(err instanceof Error ? err.message : '激活失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-brand-600 via-brand-700 to-violet-800 p-6">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-3 text-white">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 backdrop-blur"><Boxes size={22} /></div>
          <div>
            <div className="text-lg font-bold">OntoOS</div>
            <div className="text-xs text-white/60">企业本体智能平台 · 账号激活</div>
          </div>
        </div>

        <div className="card p-8">
          {!token && !done && (
            <div className="text-center">
              <div className="text-base font-bold text-slate-800">链接无效</div>
              <div className="mt-1.5 text-sm text-slate-500">邀请链接缺少有效参数，请通过邮件中的完整链接打开。</div>
            </div>
          )}

          {done ? (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-500"><CircleCheck size={30} /></div>
              <div className="text-lg font-bold text-slate-900">激活成功</div>
              <div className="mt-1.5 text-sm text-slate-500">账号 <b className="text-slate-700">{done.account}</b> 已就绪，使用新密码登录即可。</div>
              <button
                onClick={() => navigate(`/login?account=${encodeURIComponent(done.account)}`)}
                className="mt-5 w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
              >
                前往登录
              </button>
            </div>
          ) : token ? (
            <>
              <div className="mb-6 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600"><KeyRound size={24} /></div>
                <h1 className="text-lg font-bold text-slate-900">设置密码并激活账号</h1>
                <p className="mt-1 text-sm text-slate-500">你收到来自星辰智造集团的平台邀请</p>
              </div>
              <form onSubmit={activate} className="space-y-4">
                <label className="block">
                  <div className="mb-1.5 text-xs font-medium text-slate-600">设置密码（至少 6 位）</div>
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100" />
                </label>
                <label className="block">
                  <div className="mb-1.5 text-xs font-medium text-slate-600">确认密码</div>
                  <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100" />
                </label>
                {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}
                <button type="submit" disabled={busy}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
                  {busy ? '激活中…' : '激活账号'}
                </button>
              </form>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
