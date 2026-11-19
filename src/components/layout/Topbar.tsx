import { useEffect, useRef, useState } from 'react'
import { Bell, ChevronDown, Command, Building2, Sparkles, BadgeCheck, UserRoundCog, LogOut, UserRound, UsersRound, Plus, Loader2, Download, Upload, X, Camera, KeyRound } from 'lucide-react'
import { useUI } from '@/store/ui'
import { Avatar } from '@/components/ui/Misc'
import { Badge } from '@/components/ui/Badge'
import ScanCapture from '@/components/ScanCapture'
import ChangePasswordDialog from '@/components/ChangePasswordDialog'
import { api, getToken, getSpaceId, setSpaceId } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'

interface SpaceRow {
  id: string
  name: string
  kind: 'org' | 'personal' | 'family'
  role: string
  memberCount: number
}

const KIND_META: Record<string, { label: string; icon: typeof Building2; color: string }> = {
  org: { label: '组织', icon: Building2, color: 'text-brand-600' },
  personal: { label: '个人', icon: UserRound, color: 'text-violet-500' },
  family: { label: '家庭', icon: UsersRound, color: 'text-emerald-500' },
}

/** 顶部全局栏（含本体空间切换器） */
export default function Topbar() {
  const { setPaletteOpen, setAssistOpen, setNotifOpen, notifOpen, currentUser, login, logout } = useUI()
  // 通知红点反映真实未读数（通知面板打开/关闭后重新拉取）
  const notifQ = useApi<{ unread: number }>(currentUser ? '/automations/notifications' : null)
  const unread = notifQ.data?.unread ?? 0
  useEffect(() => { notifQ.reload() }, [notifOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [pwdOpen, setPwdOpen] = useState(false)
  // 身份快切用真实用户名单（替代写死 mock：新建用户也会出现）
  const usersQ = useApi<{ users: { id: string; name: string; account: string; status: string }[] }>(userMenuOpen ? '/users' : null)
  const switchableUsers = (usersQ.data?.users ?? []).filter((u) => u.status === '在职')
  const [spaceMenuOpen, setSpaceMenuOpen] = useState(false)
  const [newSpaceOpen, setNewSpaceOpen] = useState(false)
  const [newSpace, setNewSpace] = useState({ name: '', kind: 'family' as 'family' | 'org' })
  const [spaceBusy, setSpaceBusy] = useState(false)
  const [spaceMsg, setSpaceMsg] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importPreview, setImportPreview] = useState<{ name: string; kinds: string; types: number; objects: number; links: number } | null>(null)
  const [importErr, setImportErr] = useState('')
  const [scanOpen, setScanOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const role = currentUser?.role

  const spacesQ = useApi<{ spaces: SpaceRow[] }>('/spaces')
  const spaces = spacesQ.data?.spaces ?? []
  const currentSpace = spaces.find((s) => s.id === getSpaceId()) ?? spaces[0]
  const hasPersonal = spaces.some((s) => s.kind === 'personal')

  function switchSpace(id: string) {
    setSpaceMenuOpen(false)
    if (getSpaceId() === id) return
    setSpaceId(id)
    location.reload() // 全量刷新确保所有查询切换空间
  }

  async function openPersonal() {
    setSpaceBusy(true)
    try {
      const res = await api<{ space: SpaceRow; installed: number }>('/spaces/ensure-personal', {
        method: 'POST',
        body: { installPack: 'personal-life' },
      })
      setSpaceMenuOpen(false)
      setSpaceId(res.space.id)
      location.reload()
    } catch (e) {
      setSpaceMsg(e instanceof Error ? e.message : '开通失败')
    } finally {
      setSpaceBusy(false)
    }
  }

  async function createSpace() {
    if (!newSpace.name.trim()) return setSpaceMsg('请填写空间名称')
    setSpaceBusy(true)
    try {
      const res = await api<{ space: SpaceRow }>('/spaces', { method: 'POST', body: newSpace })
      setNewSpaceOpen(false)
      setNewSpace({ name: '', kind: 'family' })
      setSpaceId(res.space.id)
      location.reload()
    } catch (e) {
      setSpaceMsg(e instanceof Error ? e.message : '创建失败')
    } finally {
      setSpaceBusy(false)
    }
  }

  /** 导出当前空间为可移植 bundle 文件 */
  async function exportSpace() {
    if (!currentSpace) return
    setSpaceBusy(true)
    setSpaceMenuOpen(false)
    try {
      const res = await fetch(`/api/spaces/${currentSpace.id}/export`, { headers: { Authorization: `Bearer ${getToken()}` } })
      if (!res.ok) throw new Error('导出失败')
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${currentSpace.name}.ontoos.json`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (e) {
      setSpaceMsg(e instanceof Error ? e.message : '导出失败')
    } finally {
      setSpaceBusy(false)
    }
  }

  /** 解析粘贴/上传的 bundle → 预览 */
  function previewBundle(text: string) {
    setImportText(text)
    setImportErr('')
    setImportPreview(null)
    try {
      const b = JSON.parse(text)
      if (b.format !== 'ontoos.space.bundle') return setImportErr('不是有效的空间包（缺少 ontoos.space.bundle 标识）')
      setImportPreview({
        name: b.space?.name ?? '未命名空间',
        kinds: b.space?.kind ?? '?',
        types: (b.objectTypes ?? []).length,
        objects: (b.objects ?? []).length,
        links: (b.objectLinks ?? []).length,
      })
    } catch {
      setImportErr('JSON 解析失败')
    }
  }

  async function importSpace() {
    setSpaceBusy(true)
    setImportErr('')
    try {
      const res = await api<{ space: SpaceRow; counts: { types: number; objects: number } }>('/spaces/import', {
        method: 'POST',
        body: { bundle: JSON.parse(importText) },
      })
      setImportOpen(false)
      setImportText('')
      setImportPreview(null)
      setSpaceId(res.space.id)
      location.reload()
    } catch (e) {
      setImportErr(e instanceof Error ? e.message : '导入失败')
    } finally {
      setSpaceBusy(false)
    }
  }

  return (
    <header className="relative z-30 flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4">
      {/* 本体空间切换器 */}
      <div className="relative">
        <button onClick={() => setSpaceMenuOpen(!spaceMenuOpen)} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
          {(() => {
            const M = currentSpace ? KIND_META[currentSpace.kind] : KIND_META.org
            return <M.icon size={16} className={M.color} />
          })()}
          <span className="max-w-[160px] truncate text-[13px] font-semibold text-slate-800">{currentSpace?.name ?? '加载中…'}</span>
          <Badge color={currentSpace?.kind === 'org' ? 'blue' : currentSpace?.kind === 'personal' ? 'violet' : 'green'}>
            {currentSpace ? KIND_META[currentSpace.kind].label : ''}
          </Badge>
          <ChevronDown size={13} className="text-slate-400" />
        </button>
        {spaceMenuOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setSpaceMenuOpen(false)} />
            <div className="absolute left-0 top-11 z-50 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-pop">
              <div className="border-b border-slate-100 px-3 py-2 text-[11px] font-semibold text-slate-400">切换本体空间</div>
              {spaces.map((s) => {
                const M = KIND_META[s.kind]
                return (
                  <button
                    key={s.id}
                    onClick={() => switchSpace(s.id)}
                    className={cn('flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-brand-50', currentSpace?.id === s.id && 'bg-brand-50/70')}
                  >
                    <M.icon size={15} className={M.color} />
                    <span className="flex-1 truncate text-[13px] font-medium text-slate-700">{s.name}</span>
                    <Badge color={s.kind === 'org' ? 'blue' : s.kind === 'personal' ? 'violet' : 'green'}>{M.label}</Badge>
                  </button>
                )
              })}
              <div className="border-t border-slate-100 p-2">
                {!hasPersonal && (
                  <button onClick={openPersonal} disabled={spaceBusy} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-medium text-violet-600 hover:bg-violet-50">
                    {spaceBusy ? <Loader2 size={13} className="animate-spin" /> : <UserRound size={13} />}
                    开通个人空间（自动安装「个人生活管理」模板包）
                  </button>
                )}
                <button onClick={() => { setNewSpaceOpen(true); setSpaceMenuOpen(false) }} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-medium text-slate-500 hover:bg-slate-50">
                  <Plus size={13} /> 新建空间（家庭 / 组织）
                </button>
                <div className="mt-1 border-t border-slate-100 pt-1">
                  <button onClick={exportSpace} disabled={spaceBusy || !currentSpace} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-medium text-slate-500 hover:bg-slate-50">
                    <Download size={13} /> 导出当前空间（可移植包）
                  </button>
                  <button onClick={() => { setImportOpen(true); setSpaceMenuOpen(false) }} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-medium text-slate-500 hover:bg-slate-50">
                    <Upload size={13} /> 导入空间包（来自其他实例）
                  </button>
                </div>
                {spaceMsg && <div className="px-2 py-1 text-[11px] text-red-500">{spaceMsg}</div>}
              </div>
            </div>
          </>
        )}
      </div>

      {/* 新建空间弹层 */}
      {newSpaceOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={() => setNewSpaceOpen(false)}>
          <div className="w-[400px] max-w-[92vw] rounded-2xl border border-slate-200 bg-white p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 text-base font-bold text-slate-900">新建本体空间</div>
            <div className="space-y-3.5">
              <div className="flex gap-2">
                {(['family', 'org'] as const).map((k) => {
                  const M = KIND_META[k]
                  return (
                    <button key={k} onClick={() => setNewSpace({ ...newSpace, kind: k })}
                      className={cn('flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5 text-[13px] font-medium', newSpace.kind === k ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-500')}>
                      <M.icon size={14} /> {k === 'family' ? '家庭空间' : '组织空间'}
                    </button>
                  )
                })}
              </div>
              <input
                value={newSpace.name}
                onChange={(e) => setNewSpace({ ...newSpace, name: e.target.value })}
                placeholder={newSpace.kind === 'family' ? '如：我的家' : '如：新公司/新事业部'}
                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
              />
              <div className="rounded-lg bg-slate-50 p-2.5 text-[11px] leading-5 text-slate-400">
                新空间是空白的本体容器，可在其中手动建模，或稍后通过「本体管理器 → 导入本体」安装模板包。
              </div>
              {spaceMsg && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{spaceMsg}</div>}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setNewSpaceOpen(false)} className="rounded-lg border border-slate-200 px-3.5 py-2 text-[13px] font-medium text-slate-700 hover:border-brand-300">取消</button>
              <button onClick={createSpace} disabled={spaceBusy} className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-[13px] font-medium text-white hover:bg-brand-700 disabled:opacity-60">
                {spaceBusy && <Loader2 size={13} className="animate-spin" />} 创建并进入
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 导入空间弹层 */}
      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={() => setImportOpen(false)}>
          <div className="w-[520px] max-w-[94vw] rounded-2xl border border-slate-200 bg-white p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center justify-between">
              <div className="text-base font-bold text-slate-900">导入空间包</div>
              <button onClick={() => setImportOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={16} /></button>
            </div>
            <div className="mb-3 text-xs text-slate-400">选择从其他实例导出的 <code className="rounded bg-slate-50 px-1 font-mono">.ontoos.json</code> 空间包，将创建为新空间（ID 自动重映射，导入者即所有者）</div>
            <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={(e) => {
              const f = e.target.files?.[0]
              if (!f) return
              const reader = new FileReader()
              reader.onload = () => previewBundle(String(reader.result ?? ''))
              reader.readAsText(f, 'utf-8')
            }} />
            <div className="mb-3 flex gap-2">
              <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:border-brand-300">
                <Upload size={13} /> 选择 .json 文件
              </button>
              <span className="self-center text-[11px] text-slate-400">或直接粘贴包内容 ↓</span>
            </div>
            <textarea
              value={importText}
              onChange={(e) => previewBundle(e.target.value)}
              placeholder='{"format": "ontoos.space.bundle", ...}'
              className="h-32 w-full resize-none rounded-lg border border-slate-200 p-3 font-mono text-[11px] focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
            />
            {importPreview && (
              <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-700">
                <b>{importPreview.name}</b>（{importPreview.kinds}）· {importPreview.types} 个类型 / {importPreview.objects} 个对象 / {importPreview.links} 条关联
              </div>
            )}
            {importErr && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{importErr}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setImportOpen(false)} className="rounded-lg border border-slate-200 px-3.5 py-2 text-[13px] font-medium text-slate-700 hover:border-brand-300">取消</button>
              <button onClick={importSpace} disabled={!importPreview || spaceBusy} className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-[13px] font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                {spaceBusy && <Loader2 size={13} className="animate-spin" />} 导入并进入
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 全局搜索 */}
      <button
        onClick={() => setPaletteOpen(true)}
        className="group flex h-9 w-full max-w-md items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-left text-[13px] text-slate-400 transition-colors hover:border-brand-300 hover:bg-white"
      >
        <Command size={14} className="text-slate-400 group-hover:text-brand-500" />
        <span className="flex-1">搜索应用、对象、数据集、Agent…</span>
        <kbd className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-400">Ctrl K</kbd>
      </button>

      <div className="ml-auto flex items-center gap-1">
        {/* 全局扫描录入：任何页面均可调起 */}
        <button
          onClick={() => setScanOpen(true)}
          title="扫描小票/单据录入"
          className="mr-1 flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 hover:border-brand-300 hover:text-brand-700"
        >
          <Camera size={14} className="text-brand-500" />
          <span className="hidden lg:inline">扫描录入</span>
        </button>
        {/* 智能助手 */}
        <button
          onClick={() => setAssistOpen(true)}
          className="mr-1 flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-brand-500 to-violet-500 px-3 py-1.5 text-xs font-semibold text-white shadow-card transition-opacity hover:opacity-90"
        >
          <Sparkles size={14} />
          智能助手
        </button>
        {/* 通知 */}
        <button onClick={() => setNotifOpen(true)} title={unread ? `${unread} 条未读通知` : '通知中心'} className="relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50">
          <Bell size={17} />
          {unread > 0 && <span className="absolute right-1 top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-500 px-0.5 text-[9px] font-bold text-white ring-2 ring-white">{unread > 9 ? '9+' : unread}</span>}
        </button>
        {/* 用户菜单 */}
        <div className="relative">
          <button onClick={() => setUserMenuOpen(!userMenuOpen)} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
            {currentUser && <Avatar name={currentUser.name} />}
            <div className="hidden text-left md:block">
              <div className="text-xs font-semibold text-slate-800">{currentUser?.name}</div>
              <div className="text-[10px] text-slate-400">{role?.name}</div>
            </div>
            <ChevronDown size={13} className="text-slate-400" />
          </button>
          {userMenuOpen && currentUser && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
              <div className="absolute right-0 top-11 z-50 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-pop">
                <div className="border-b border-slate-100 px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={currentUser.name} className="h-9 w-9 text-sm" />
                    <div>
                      <div className="text-[13px] font-bold text-slate-800">{currentUser.name}</div>
                      <div className="text-[11px] text-slate-400">{currentUser.account}@example.com</div>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Badge color="blue">{role?.name}</Badge>
                    {currentUser.markings.map((m) => (
                      <Badge key={m} color="violet">{m}</Badge>
                    ))}
                  </div>
                </div>
                <div className="border-b border-slate-100 px-3 py-2">
                  <div className="mb-1 flex items-center gap-1.5 px-1 text-[11px] font-semibold text-slate-400">
                    <UserRoundCog size={12} /> 切换身份（真实登录 · 名单来自 /users）
                  </div>
                  {switchableUsers.map((u) => (
                    <button
                      key={u.id}
                      title={`以 ${u.account} 重新登录（演示快切仅对默认密码账号有效）`}
                      onClick={async () => {
                        const r = await login(u.account, 'ontos@2026')
                        if (!r.ok) { setSpaceMsg(r.error ?? '登录失败'); return }
                        setUserMenuOpen(false)
                      }}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-brand-50',
                        u.id === currentUser.id && 'bg-brand-50/70',
                      )}
                    >
                      <Avatar name={u.name} className="h-6 w-6 text-[10px]" />
                      <span className="flex-1 text-xs font-medium text-slate-700">{u.name}</span>
                    </button>
                  ))}
                  {usersQ.loading && <div className="px-2 py-1.5 text-[11px] text-slate-400">加载用户…</div>}
                </div>
                <button
                  onClick={() => { setUserMenuOpen(false); setPwdOpen(true) }}
                  className="flex w-full items-center gap-2 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-600 hover:bg-slate-50"
                >
                  <KeyRound size={13} /> 修改密码
                </button>
                <button onClick={logout} className="flex w-full items-center gap-2 px-4 py-2.5 text-xs text-slate-500 hover:bg-slate-50">
                  <LogOut size={13} /> 退出登录
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {pwdOpen && <ChangePasswordDialog onClose={() => setPwdOpen(false)} />}

      {/* 全局扫描录入弹层：不指定类型，由用户在识别后选择 */}
      {scanOpen && <ScanCapture onClose={() => setScanOpen(false)} onCommitted={() => { /* 入库后各页自行刷新 */ }} />}
    </header>
  )
}
