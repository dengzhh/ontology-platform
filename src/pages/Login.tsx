import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Boxes, Sparkles, Database, ShieldCheck, LogIn, Loader2 } from 'lucide-react'
import { useUI } from '@/store/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

const DEMO_ACCOUNTS = [
  { account: 'chen.xingye', name: '陈星野', role: '平台管理员' },
  { account: 'li.weixiu', name: '李维修', role: '维修工程师' },
  { account: 'zhou.jihua', name: '周计划', role: '生产计划员' },
  { account: 'zheng.shenji', name: '郑审计', role: '合规审计员' },
]

/** 登录页（真实 JWT 会话） */
export default function Login() {
  const { login, currentUser } = useUI()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [account, setAccount] = useState(params.get('account') ?? 'chen.xingye')
  const [password, setPassword] = useState(params.get('account') ? '' : 'ontos@2026')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  /** 是否开放自助注册（默认关闭；登录页据此决定是否显示注册入口） */
  const [signupEnabled, setSignupEnabled] = useState(false)

  useEffect(() => {
    api<{ enabled: boolean }>('/auth/register-status').then((r) => setSignupEnabled(r.enabled)).catch(() => {})
  }, [])
  /** 会话失效跳转标记：401 时 api.ts 会带上 expired=1，这里给出明确原因 */
  const expired = params.get('expired') === '1'
  const nextPath = params.get('next') || ''

  // 已有会话（如从其他标签页登录）时直接进入
  useEffect(() => {
    if (currentUser) navigate(nextPath || '/launcher', { replace: true })
  }, [currentUser, navigate, nextPath])

  async function submit(e?: React.FormEvent) {
    e?.preventDefault()
    setBusy(true)
    setError('')
    const res = await login(account, password)
    if (!res.ok) {
      setError(res.error ?? '登录失败')
      setBusy(false)
    }
    // 成功时由上方 useEffect 完成跳转
  }

  function quickFill(acc: string) {
    setAccount(acc)
    setPassword('ontos@2026')
    setError('')
  }

  return (
    <div className="flex min-h-full">
      {/* 品牌区 */}
      <div className="relative hidden w-[46%] flex-col justify-between overflow-hidden bg-gradient-to-br from-brand-600 via-brand-700 to-violet-800 p-10 text-white lg:flex">
        <div className="canvas-grid absolute inset-0 opacity-20" />
        <div className="relative flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
            <Boxes size={22} />
          </div>
          <div>
            <div className="text-lg font-bold">OntoOS</div>
            <div className="text-xs text-white/60">企业本体智能平台</div>
          </div>
        </div>
        <div className="relative space-y-6">
          <div className="text-3xl font-bold leading-snug">
            数据、本体、知识与 AI
            <br />
            在一个语义层上运转
          </div>
          <div className="space-y-3.5 text-sm text-white/80">
            <div className="flex items-center gap-2.5">
              <Database size={16} className="shrink-0 text-white/70" />
              把企业业务实体建模为对象、链接与动作的统一本体
            </div>
            <div className="flex items-center gap-2.5">
              <Sparkles size={16} className="shrink-0 text-white/70" />
              AI 助手基于本体检索知识、执行动作，全程引用可溯源
            </div>
            <div className="flex items-center gap-2.5">
              <ShieldCheck size={16} className="shrink-0 text-white/70" />
              角色权限与数据标记控制每个人（和 AI）可见与可做的边界
            </div>
          </div>
        </div>
        <div className="relative text-xs text-white/40">星辰智造集团 · 数字化转型部 部署</div>
      </div>

      {/* 登录表单 */}
      <div className="flex flex-1 items-center justify-center bg-slate-100 p-6">
        <div className="card w-full max-w-md p-8">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-violet-600 text-white">
              <Boxes size={20} />
            </div>
            <div className="text-lg font-bold text-slate-900">OntoOS</div>
          </div>
          <h1 className="text-xl font-bold text-slate-900">登录平台</h1>
          <p className="mt-1 text-sm text-slate-500">使用企业账号进入你的工作台</p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <label className="block">
              <div className="mb-1.5 text-xs font-medium text-slate-600">账号</div>
              <input
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                placeholder="如 chen.xingye"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
              />
            </label>
            <label className="block">
              <div className="mb-1.5 text-xs font-medium text-slate-600">密码</div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
              />
            </label>
            {expired && !error && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                会话已失效（登录过期、已在别处登出，或账号状态变更），请重新登录
              </div>
            )}
            {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}
            <button
              type="submit"
              disabled={busy || !!currentUser}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <LogIn size={15} />}
              {busy ? '登录中…' : '登 录'}
            </button>
          </form>

          {signupEnabled && (
            <div className="mt-3 text-center text-[11px] text-slate-400">
              还没有账号？
              <Link to="/register" className="ml-1 font-medium text-brand-600 hover:underline">注册新组织</Link>
            </div>
          )}

          <div className="mt-6 border-t border-slate-100 pt-4">
            <div className="mb-2 text-[11px] font-semibold text-slate-400">演示账号（密码均为 ontos@2026，点击快速填入）</div>
            <div className="grid grid-cols-2 gap-2">
              {DEMO_ACCOUNTS.map((d) => (
                <button
                  key={d.account}
                  onClick={() => quickFill(d.account)}
                  className={cn(
                    'rounded-lg border px-2.5 py-2 text-left text-xs transition-colors',
                    account === d.account ? 'border-brand-300 bg-brand-50' : 'border-slate-200 hover:border-brand-200 hover:bg-slate-50',
                  )}
                >
                  <div className="font-semibold text-slate-700">{d.name}</div>
                  <div className="text-[10px] text-slate-400">{d.role}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
