import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Boxes, Loader2, UserPlus, AlertCircle } from 'lucide-react'
import { api, setToken, setSpaceId } from '@/lib/api'

/**
 * 自助注册页（SaaS 模式）：仅当管理员在控制面板开启「自助注册」时可用
 * 注册成功后自动登录并创建组织空间 + 免费套餐配额
 */
export default function Register() {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [name, setName] = useState('')
  const [account, setAccount] = useState('')
  const [orgName, setOrgName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<{ enabled: boolean }>('/auth/register-status')
      .then((r) => setEnabled(r.enabled))
      .catch(() => setEnabled(false))
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password !== confirm) return setError('两次输入的密码不一致')
    setBusy(true)
    try {
      const r = await api<{ token: string; space: { id: string } }>('/auth/register', {
        method: 'POST',
        body: { name, account, password, orgName: orgName || undefined },
      })
      setToken(r.token)
      if (r.space?.id) setSpaceId(r.space.id)
      // 整页跳转：让 App 重新拉取会话用户与空间列表（注册即登录）
      location.href = '/launcher'
    } catch (e) {
      setError(e instanceof Error ? e.message : '注册失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-card">
        <div className="mb-5 flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-violet-500 text-white"><Boxes size={20} /></div>
          <div>
            <div className="text-lg font-bold text-slate-900">注册 OntoOS</div>
            <div className="text-[11px] text-slate-400">创建你的组织空间，立即可用</div>
          </div>
        </div>

        {enabled === null ? (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-slate-400"><Loader2 size={14} className="animate-spin" /> 检查注册状态…</div>
        ) : !enabled ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-[12px] leading-6 text-amber-700">
            当前为邀请制，未开放自助注册。请联系平台管理员为你开通账号，
            或在已有账号的邀请链接中完成激活。
            <div className="mt-3"><Link to="/login" className="font-semibold text-brand-700 hover:underline">返回登录</Link></div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            {[
              { label: '你的姓名', value: name, set: setName, ph: '如：张三' },
              { label: '登录账号', value: account, set: setAccount, ph: '3-32 位字母数字，如 zhangsan' },
              { label: '组织名称（可选）', value: orgName, set: setOrgName, ph: '如：某某科技' },
            ].map((f) => (
              <div key={f.label}>
                <div className="mb-1 text-[11px] font-medium text-slate-600">{f.label}</div>
                <input
                  value={f.value}
                  onChange={(e) => f.set(e.target.value)}
                  placeholder={f.ph}
                  className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-[13px] focus:border-brand-400 focus:outline-none"
                />
              </div>
            ))}
            <div>
              <div className="mb-1 text-[11px] font-medium text-slate-600">密码</div>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="至少 8 位，含字母与数字"
                className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-[13px] focus:border-brand-400 focus:outline-none" />
            </div>
            <div>
              <div className="mb-1 text-[11px] font-medium text-slate-600">确认密码</div>
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-[13px] focus:border-brand-400 focus:outline-none" />
            </div>
            {error && (
              <div className="flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] text-red-600">
                <AlertCircle size={12} className="mt-0.5 shrink-0" /> {error}
              </div>
            )}
            <button type="submit" disabled={busy}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />} 创建账号
            </button>
            <div className="text-center text-[11px] text-slate-400">
              已有账号？<Link to="/login" className="text-brand-600 hover:underline">直接登录</Link>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
