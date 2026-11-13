import { useState } from 'react'
import { UsersRound, ShieldCheck, UserPlus, Check, EyeOff, Clock3, RotateCcw, X, Loader2, Power, Copy, Mail, Link2, CircleCheck, Send, Pencil, Trash2, Plus } from 'lucide-react'
import PageShell from '@/components/ui/PageShell'
import DataTable from '@/components/ui/DataTable'
import Tabs from '@/components/ui/Tabs'
import Btn from '@/components/ui/Btn'
import { Badge, type BadgeColor } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import { Avatar, KVList, SectionTitle } from '@/components/ui/Misc'
import Timeline from '@/components/ui/Timeline'
import { Select, Input, Field } from '@/components/ui/Form'
import { useUI } from '@/store/ui'
import { api } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import type { UserRow, RoleRow, GroupRow } from '../../../shared/types'
import { cn } from '@/lib/utils'

interface InviteResult {
  invitation: { link: string; subject: string; body: string; email: string; mailto: string; sent: boolean; sendError?: string }
}

interface InvitationRow {
  id: string
  name: string
  account: string
  email: string
  channel: string
  status: string
  link: string
  createdAt: string
  expiresAt: string
  userStatus: string
}

function copyText(text: string) {
  return navigator.clipboard?.writeText(text).catch(() => {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  })
}

/** 用户组表单（新建 / 编辑共用） */
interface GroupFormState { name: string; desc: string; defaultApp: string }
const EMPTY_GROUP_FORM: GroupFormState = { name: '', desc: '', defaultApp: '' }

const PERM_VIEW: Record<string, { label: string; color: BadgeColor; icon: typeof Check }> = {
  full: { label: '读写', color: 'green', icon: Check },
  read: { label: '只读', color: 'blue', icon: Clock3 },
  none: { label: '无', color: 'slate', icon: EyeOff },
}

/** 用户与权限管理（P1：真实读写） */
export default function UsersAdmin() {
  const [tab, setTab] = useState('users')
  const { currentUser } = useUI()
  const usersQ = useApi<{ users: UserRow[] }>('/users')
  const rolesQ = useApi<{ roles: RoleRow[] }>('/roles')
  const groupsQ = useApi<{ groups: GroupRow[] }>('/roles/groups')
  const invitationsQ = useApi<{ invitations: InvitationRow[] }>(tab === 'invites' ? '/users/invitations/list' : null)
  const typesQ = useApi<{ types: { id: string; name: string; color: string }[] }>(tab === 'roles' ? '/ontology/types' : null)
  const matrixTypes = typesQ.data?.types ?? []

  const users = usersQ.data?.users ?? []
  const roles = rolesQ.data?.roles ?? []
  const groups = groupsQ.data?.groups ?? []

  const [selected, setSelected] = useState<string | null>(null)
  const selectedUser = users.find((u) => u.id === selected) ?? users[0]
  // 最近活动：按选中用户姓名过滤真实审计日志
  const activityQ = useApi<{ events: { id: string; action: string; target: string; createdAt: string }[] }>(
    selectedUser ? `/admin/audit?actor=${encodeURIComponent(selectedUser.name)}&limit=5` : null,
  )
  const activityEvents = activityQ.data?.events ?? []

  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteForm, setInviteForm] = useState({ name: '', account: '', email: '', dept: '', roleId: 'analyst', channel: 'email' as 'email' | 'link' })
  const [busy, setBusy] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [inviteResult, setInviteResult] = useState<InviteResult['invitation'] | null>(null)
  const [toast, setToast] = useState('')

  function notify(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2500)
  }

  async function invite() {
    if (!inviteForm.name || !inviteForm.account || !inviteForm.roleId) {
      setInviteError('请填写姓名、账号与角色')
      return
    }
    if (inviteForm.channel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteForm.email)) {
      setInviteError('邮件邀请必须填写有效的收件邮箱（对方真实邮箱地址）')
      return
    }
    setBusy(true)
    setInviteError('')
    try {
      const res = await api<InviteResult>('/users/invite', { method: 'POST', body: inviteForm })
      setInviteResult(res.invitation)
      usersQ.reload()
      invitationsQ.reload()
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : '创建邀请失败')
    } finally {
      setBusy(false)
    }
  }

  function closeInvite() {
    setInviteOpen(false)
    setInviteResult(null)
    setInviteError('')
    setInviteForm({ name: '', account: '', email: '', dept: '', roleId: 'analyst', channel: 'email' })
  }

  async function patchUser(id: string, patch: Record<string, unknown>, msg: string) {
    try {
      await api(`/users/${id}`, { method: 'PATCH', body: patch })
      notify(msg)
      usersQ.reload()
      rolesQ.reload()
    } catch (e) {
      notify(e instanceof Error ? e.message : '更新失败')
    }
  }

  const [selRole, setSelRole] = useState<string | null>(null)
  const selectedRole = roles.find((r) => r.id === selRole) ?? roles[0]

  /* 用户组：新建 / 编辑 / 删除 / 成员管理 */
  const [groupModal, setGroupModal] = useState<'create' | 'edit' | null>(null)
  const [groupForm, setGroupForm] = useState<GroupFormState>(EMPTY_GROUP_FORM)
  const [editingGroup, setEditingGroup] = useState<GroupRow | null>(null)
  const [groupBusy, setGroupBusy] = useState(false)
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState<GroupRow | null>(null)
  const [addMemberGroup, setAddMemberGroup] = useState<GroupRow | null>(null)
  const [addMemberId, setAddMemberId] = useState('')

  function closeGroupModal() {
    setGroupModal(null)
    setEditingGroup(null)
    setGroupForm(EMPTY_GROUP_FORM)
    setGroupBusy(false)
  }

  function openGroupCreate() {
    setEditingGroup(null)
    setGroupForm(EMPTY_GROUP_FORM)
    setGroupModal('create')
  }

  function openGroupEdit(g: GroupRow) {
    setEditingGroup(g)
    setGroupForm({ name: g.name, desc: g.desc, defaultApp: g.defaultApp })
    setGroupModal('edit')
  }

  async function submitGroup() {
    if (!groupForm.name.trim()) return notify('请填写用户组名称')
    setGroupBusy(true)
    try {
      if (groupModal === 'edit' && editingGroup) {
        await api(`/roles/groups/${editingGroup.id}`, { method: 'PATCH', body: groupForm })
        notify(`已更新「${groupForm.name.trim()}」`)
      } else {
        await api('/roles/groups', { method: 'POST', body: groupForm })
        notify(`已新建「${groupForm.name.trim()}」`)
      }
      closeGroupModal()
      groupsQ.reload()
    } catch (e) {
      notify(e instanceof Error ? e.message : '保存失败')
    } finally { setGroupBusy(false) }
  }

  async function deleteGroup(g: GroupRow) {
    try {
      await api(`/roles/groups/${g.id}`, { method: 'DELETE' })
      notify(`已删除「${g.name}」`)
      setConfirmDeleteGroup(null)
      groupsQ.reload()
    } catch (e) { notify(e instanceof Error ? e.message : '删除失败') }
  }

  async function addMember(g: GroupRow) {
    if (!addMemberId) return notify('请选择要添加的成员')
    try {
      await api(`/roles/groups/${g.id}/members`, { method: 'POST', body: { userId: addMemberId } })
      notify('成员已添加')
      setAddMemberGroup(null)
      setAddMemberId('')
      groupsQ.reload()
    } catch (e) { notify(e instanceof Error ? e.message : '添加失败') }
  }

  async function removeMember(g: GroupRow, userId: string) {
    try {
      await api(`/roles/groups/${g.id}/members/${userId}`, { method: 'DELETE' })
      notify('成员已移除')
      groupsQ.reload()
    } catch (e) { notify(e instanceof Error ? e.message : '移除失败') }
  }

  return (
    <PageShell
      icon={UsersRound}
      title="用户与权限"
      subtitle="用户、角色与用户组管理：真实数据库读写，应用可见性与对象权限由服务端会话驱动"
      benchmark="身份权限"
      features={[
        '用户全生命周期：邀请建号（初始密码 ontos@2026）、角色调整、停用/启用、重置密码',
        '角色权限双维度：可见应用（导航）+ 对象类型读写权限（读写/只读/无）',
        '数据标记（Markings）随人走：敏感数据仅对持标记用户可见',
        '用户组批量视图：按部门/岗位组织的成员与默认工作区',
        '所有变更写入审计日志（可在审计页追溯）',
      ]}
      actions={<Btn size="sm" variant="primary" onClick={() => setInviteOpen(true)}><UserPlus size={14} /> 邀请用户</Btn>}
    >
      {toast && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">{toast}</div>
      )}

      <Card padding={false}>
        <div className="border-b border-slate-100 p-3">
          <Tabs
            tabs={[
              { key: 'users', label: '用户', count: users.length },
              { key: 'invites', label: '邀请记录', count: invitationsQ.data?.invitations.length },
              { key: 'roles', label: '角色', count: roles.length },
              { key: 'groups', label: '用户组', count: groups.length },
            ]}
            active={tab}
            onChange={setTab}
          />
        </div>

        {/* 用户 */}
        {tab === 'users' && (
          <div className="grid grid-cols-1 gap-0 xl:grid-cols-[minmax(0,1.6fr)_320px]">
            <div className="p-4">
              {(usersQ.loading || rolesQ.loading) && users.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" /> 加载用户数据…</div>
              ) : (
                <DataTable
                  rows={users}
                  onRowClick={(u) => setSelected(u.id)}
                  rowKey={(u) => u.id}
                  columns={[
                    {
                      key: 'name', header: '用户', cell: (u) => (
                        <span className="flex items-center gap-2.5">
                          <Avatar name={u.name} />
                          <span>
                            <span className="block font-semibold text-slate-800">{u.name}{u.id === currentUser?.id && <span className="ml-1 text-[10px] text-brand-500">(我)</span>}</span>
                            <span className="block text-[11px] text-slate-400">{u.account}@xingchen-mfg</span>
                          </span>
                        </span>
                      ),
                    },
                    { key: 'dept', header: '部门', cell: (u) => <span className="text-xs">{u.dept}</span> },
                    { key: 'roleName', header: '角色', cell: (u) => <Badge color="blue">{u.roleName}</Badge> },
                    {
                      key: 'markings', header: '数据标记', cell: (u) => (
                        <span className="flex flex-wrap gap-1">
                          {u.markings.map((m) => <Badge key={m} color="violet">{m}</Badge>)}
                        </span>
                      ),
                    },
                    { key: 'status', header: '状态', cell: (u) => <Badge color={u.status === '在职' ? 'green' : u.status === '待激活' ? 'amber' : 'slate'} dot>{u.status}</Badge> },
                    { key: 'lastLoginAt', header: '最后登录', align: 'right', cell: (u) => <span className="text-xs text-slate-500">{u.lastLoginAt || '—'}</span> },
                  ]}
                />
              )}
            </div>

            {/* 用户详情 */}
            <div className="border-t border-slate-100 p-4 xl:border-l xl:border-t-0">
              {selectedUser ? (
                <>
                  <CardHeader title={<span className="flex items-center gap-2"><Avatar name={selectedUser.name} />{selectedUser.name}</span>} desc={`${selectedUser.dept} · ${selectedUser.account}`} />
                  <div className="mb-3 rounded-lg border border-slate-100 bg-slate-50/60 p-3">
                    <KVList
                      cols={1}
                      items={[
                        { k: '角色', v: <Badge color="blue">{selectedUser.roleName}</Badge> },
                        { k: '数据标记', v: selectedUser.markings.join(' / ') },
                        { k: '可见应用', v: `${roles.find((r) => r.id === selectedUser.roleId)?.apps.includes('*') ? '全部' : roles.find((r) => r.id === selectedUser.roleId)?.apps.length ?? 0} 个` },
                        { k: '状态', v: selectedUser.status },
                        { k: '最后登录', v: selectedUser.lastLoginAt || '从未登录' },
                      ]}
                    />
                  </div>
                  <div className="mb-3 space-y-2">
                    <div className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
                      <span className="text-xs font-medium text-slate-600">调整角色</span>
                      <Select
                        value={selectedUser.roleId}
                        onChange={(e) => patchUser(selectedUser.id, { roleId: e.target.value }, `已将 ${selectedUser.name} 角色调整为 ${roles.find((r) => r.id === e.target.value)?.name}`)}
                      >
                        {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </Select>
                    </div>
                    <div className="flex gap-2">
                      <Btn size="sm" className="flex-1" onClick={() => patchUser(selectedUser.id, { status: selectedUser.status === '在职' ? '停用' : '在职' }, selectedUser.status === '在职' ? '已停用（无法登录）' : '已恢复在职')}>
                        <Power size={12} /> {selectedUser.status === '在职' ? '停用账号' : '恢复在职'}
                      </Btn>
                      <Btn size="sm" className="flex-1" onClick={() => patchUser(selectedUser.id, { resetPassword: true }, '密码已重置为 ontos@2026')}>
                        <RotateCcw size={12} /> 重置密码
                      </Btn>
                    </div>
                  </div>
                  <SectionTitle>最近活动（真实审计）</SectionTitle>
                  {activityEvents.length ? (
                    <Timeline items={[
                      { time: selectedUser.lastLoginAt || '—', title: '登录平台', color: 'blue' },
                      ...activityEvents.map((e) => ({ time: e.createdAt, title: e.action, desc: e.target, color: 'slate' as const })),
                    ]} />
                  ) : (
                    <Timeline items={[{ time: selectedUser.lastLoginAt || '—', title: '登录平台', color: 'blue' }, { time: '—', title: '暂无该用户的审计活动记录', color: 'slate' as const }]} />
                  )}
                </>
              ) : (
                <div className="py-12 text-center text-sm text-slate-400">选择左侧用户查看详情</div>
              )}
            </div>
          </div>
        )}

        {/* 邀请记录 */}
        {tab === 'invites' && (
          <div className="p-4">
            {invitationsQ.loading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" /> 加载邀请记录…</div>
            ) : (invitationsQ.data?.invitations.length ?? 0) === 0 ? (
              <div className="py-12 text-center text-sm text-slate-400">暂无邀请记录，点击右上角「邀请用户」创建第一条</div>
            ) : (
              <DataTable
                rows={invitationsQ.data!.invitations}
                rowKey={(r) => r.id}
                columns={[
                  { key: 'name', header: '被邀请人', cell: (r) => <span className="font-medium text-slate-800">{r.name}<span className="ml-1.5 text-[11px] font-normal text-slate-400">{r.account}</span></span> },
                  { key: 'email', header: '收件邮箱', cell: (r) => <span className={cn('text-xs', r.email ? 'text-slate-600' : 'text-slate-300')}>{r.email || '—（链接邀请）'}</span> },
                  { key: 'channel', header: '渠道', cell: (r) => <Badge color={r.channel === 'email' ? 'blue' : 'slate'}>{r.channel === 'email' ? '邮件邀请' : '链接邀请'}</Badge> },
                  { key: 'status', header: '邀请状态', cell: (r) => <Badge color={r.status === '已激活' ? 'green' : r.status === '已过期' ? 'red' : 'amber'} dot>{r.status}</Badge> },
                  { key: 'createdAt', header: '创建时间' },
                  { key: 'expiresAt', header: '失效日期' },
                  {
                    key: 'op', header: '操作', align: 'right', cell: (r) => (
                      <span className="flex items-center justify-end gap-3">
                        {r.channel === 'email' && r.status !== '已激活' && (
                          <button
                            onClick={async () => {
                              try {
                                await api(`/users/invitations/${r.id}/resend`, { method: 'POST' })
                                notify(`重发成功：邮件已发送至 ${r.email}`)
                                invitationsQ.reload()
                              } catch (e) {
                                notify(e instanceof Error ? e.message : '重发失败')
                              }
                            }}
                            className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
                          >
                            <Send size={11} /> 重新发送
                          </button>
                        )}
                        <button
                          onClick={() => copyText(r.link).then(() => notify('邀请链接已复制'))}
                          className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-brand-600"
                        >
                          <Copy size={11} /> 复制链接
                        </button>
                      </span>
                    ),
                  },
                ]}
              />
            )}
          </div>
        )}

        {/* 角色 */}
        {tab === 'roles' && (
          <div className="grid grid-cols-1 gap-0 xl:grid-cols-[300px_minmax(0,1fr)]">
            <div className="space-y-2 border-slate-100 p-4 xl:border-r">
              {roles.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setSelRole(r.id)}
                  className={cn(
                    'flex w-full items-start gap-2.5 rounded-xl border p-3 text-left transition-colors',
                    selectedRole?.id === r.id ? 'border-brand-300 bg-brand-50/60' : 'border-slate-200 hover:border-brand-200',
                  )}
                >
                  <div className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', selectedRole?.id === r.id ? 'bg-brand-100 text-brand-600' : 'bg-slate-100 text-slate-500')}>
                    <ShieldCheck size={15} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-bold text-slate-800">{r.name}</span>
                      <span className="text-[11px] text-slate-400">{r.members} 人</span>
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-slate-400">{r.desc}</div>
                  </div>
                </button>
              ))}
            </div>
            <div className="p-4">
              {selectedRole && (
                <>
                  <CardHeader
                    title={`${selectedRole.name} · 权限矩阵`}
                    desc={`可见应用 ${selectedRole.apps.includes('*') ? '全部' : selectedRole.apps.length} 个（保存于服务端，登录即生效） · 对象级权限如下`}
                  />
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {matrixTypes.map((t) => {
                      const perm = (selectedRole.objectPerms[t.id] ?? (selectedRole.id === 'admin' || selectedRole.id === 'data-eng' ? 'full' : 'read')) as 'full' | 'read' | 'none'
                      const P = PERM_VIEW[perm] ?? PERM_VIEW.none
                      return (
                        <button
                          key={t.id}
                          onClick={() => {
                            const order: Record<string, string> = { full: 'read', read: 'none', none: 'full' }
                            const next = order[perm] ?? 'full'
                            const objectPerms = { ...selectedRole.objectPerms, [t.id]: next }
                            api(`/roles/${selectedRole.id}`, { method: 'PATCH', body: { objectPerms } })
                              .then(() => { notify(`${selectedRole.name} · ${t.name} → ${PERM_VIEW[next].label}`); rolesQ.reload() })
                              .catch((e) => notify(e instanceof Error ? e.message : '更新失败'))
                          }}
                          className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2.5 hover:border-brand-200"
                          title="点击切换：读写 → 只读 → 无"
                        >
                          <span className="flex items-center gap-2 text-[13px] font-medium text-slate-700">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.color }} />
                            {t.name}
                          </span>
                          <Badge color={P.color}><P.icon size={10} className="mr-0.5" />{P.label}</Badge>
                        </button>
                      )
                    })}
                  </div>
                  <div className="mt-4 rounded-lg border border-dashed border-slate-200 p-3 text-[11px] leading-5 text-slate-400">
                    权限三档：<b className="text-emerald-600">读写</b> 可查看并执行动作写回；<b className="text-brand-600">只读</b> 仅查看；<b className="text-slate-500">无</b> 对象不可见。点击卡片可循环切换（写库即时生效）。
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* 用户组 */}
        {tab === 'groups' && (
          <div className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[13px] font-semibold text-slate-700">用户组（{groups.length}）</span>
              <Btn size="sm" variant="primary" onClick={openGroupCreate}><Plus size={13} /> 新建用户组</Btn>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {groups.map((g) => {
                const memberIds = new Set(g.members.map((m) => m.id))
                const candidates = users.filter((u) => !memberIds.has(u.id))
                return (
                  <div key={g.id} className="rounded-xl border border-slate-200 p-4">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-[14px] font-bold text-slate-800">{g.name}</span>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Badge color="blue">{g.members.length} 人</Badge>
                        <button onClick={() => openGroupEdit(g)} className="text-slate-400 hover:text-brand-600" title="编辑"><Pencil size={13} /></button>
                        <button onClick={() => setConfirmDeleteGroup(g)} className="text-slate-300 hover:text-red-500" title="删除"><Trash2 size={13} /></button>
                      </div>
                    </div>
                    <div className="mb-3 text-xs leading-5 text-slate-500">{g.desc || '（无说明）'}</div>
                    <div className="mb-3 flex flex-wrap items-center gap-1.5">
                      {g.members.length === 0 && <span className="text-[11px] text-slate-400">暂无成员</span>}
                      {g.members.map((m) => (
                        <button key={m.id} onClick={() => removeMember(g, m.id)} className="group relative" title={`移除 ${m.name}`}>
                          <Avatar name={m.name} />
                          <span className="absolute -right-1 -top-1 hidden h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 text-[9px] text-white group-hover:flex">×</span>
                        </button>
                      ))}
                    </div>
                    <div className="mb-3 text-[11px] text-slate-400">默认工作区：{g.defaultApp || '—'}</div>
                    {addMemberGroup?.id === g.id ? (
                      <div className="flex items-center gap-1.5">
                        <Select className="min-w-0 flex-1" value={addMemberId} onChange={(e) => setAddMemberId(e.target.value)}>
                          <option value="">选择成员…</option>
                          {candidates.map((u) => <option key={u.id} value={u.id}>{u.name}（{u.account}）</option>)}
                        </Select>
                        <Btn size="sm" variant="primary" onClick={() => addMember(g)}>添加</Btn>
                        <Btn size="sm" onClick={() => { setAddMemberGroup(null); setAddMemberId('') }}>取消</Btn>
                      </div>
                    ) : (
                      <Btn size="sm" className="w-full" onClick={() => { setAddMemberGroup(g); setAddMemberId('') }} disabled={candidates.length === 0}>
                        <UserPlus size={12} /> {candidates.length ? '添加成员' : '已包含全部用户'}
                      </Btn>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </Card>

      {/* 邀请用户弹层（两步：表单 → 成功态） */}
      {inviteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={closeInvite}>
          <div className="w-[480px] max-w-[92vw] rounded-2xl border border-slate-200 bg-white p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
            {!inviteResult ? (
              <>
                <div className="mb-4 flex items-center justify-between">
                  <div className="text-base font-bold text-slate-900">邀请用户</div>
                  <button onClick={closeInvite} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={16} /></button>
                </div>
                <div className="space-y-3.5">
                  <Field label="姓名" required><Input value={inviteForm.name} onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })} placeholder="如：王新员" /></Field>
                  <Field label="账号" required hint="登录用拼音账号，如 wang.xinyuan"><Input value={inviteForm.account} onChange={(e) => setInviteForm({ ...inviteForm, account: e.target.value })} placeholder="如 wang.xinyuan" /></Field>
                  <Field label="收件邮箱" required={inviteForm.channel === 'email'} hint={inviteForm.channel === 'email' ? '对方真实邮箱，邀请邮件发送到此地址' : '链接邀请可不填'}>
                    <Input type="email" value={inviteForm.email} onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })} placeholder="如 wang.xinyuan@company.com" />
                  </Field>
                  <Field label="部门"><Input value={inviteForm.dept} onChange={(e) => setInviteForm({ ...inviteForm, dept: e.target.value })} placeholder="如：佛山二厂 · 设备科" /></Field>
                  <Field label="角色">
                    <Select className="w-full" value={inviteForm.roleId} onChange={(e) => setInviteForm({ ...inviteForm, roleId: e.target.value })}>
                      {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="邀请方式" hint="邮件邀请：生成含激活链接的邮件（打开邮件客户端发送）；链接邀请：仅生成链接自行传达">
                    <div className="flex gap-2">
                      {([['email', '邮件邀请', Mail], ['link', '仅生成链接', Link2]] as const).map(([val, label, Ico]) => (
                        <button
                          key={val}
                          onClick={() => setInviteForm({ ...inviteForm, channel: val })}
                          className={cn(
                            'flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] font-medium',
                            inviteForm.channel === val ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-500 hover:border-brand-200',
                          )}
                        >
                          <Ico size={14} /> {label}
                        </button>
                      ))}
                    </div>
                  </Field>
                  {inviteError && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{inviteError}</div>}
                </div>
                <div className="mt-5 flex justify-end gap-2">
                  <Btn onClick={closeInvite}>取消</Btn>
                  <Btn variant="primary" disabled={busy} onClick={invite}>
                    {busy ? <><Loader2 size={13} className="animate-spin" /> 创建中…</> : <><Send size={13} /> 创建并发送邀请</>}
                  </Btn>
                </div>
              </>
            ) : (
              <>
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-500"><CircleCheck size={24} /></div>
                  <div>
                    <div className="text-base font-bold text-slate-900">邀请已创建</div>
                    <div className="text-xs text-slate-400">账号「{inviteForm.name || '新用户'}」已建立，状态：待激活（7 天内有效）</div>
                  </div>
                  <button onClick={closeInvite} className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={16} /></button>
                </div>

                <div className="mb-3 rounded-lg border border-slate-100 bg-slate-50/70 p-3">
                  <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-slate-400"><Link2 size={11} /> 激活链接（收件人点击后设置密码即完成激活）</div>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded border border-slate-200 bg-white px-2 py-1.5 font-mono text-[11px] text-brand-700">{inviteResult.link}</code>
                    <Btn size="sm" onClick={() => copyText(inviteResult.link).then(() => notify('链接已复制'))}><Copy size={12} /> 复制</Btn>
                  </div>
                </div>

                {inviteForm.channel === 'email' && inviteResult.sent && (
                  <div className="mb-3 flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50/70 p-3">
                    <Send size={14} className="mt-0.5 shrink-0 text-emerald-600" />
                    <div className="text-xs leading-5 text-emerald-700">
                      邮件已由系统直接发送至 <b>{inviteResult.email}</b>（发件人：系统配置的邮件服务）。对方点击邮件中的链接设置密码即完成激活，进度可在「邀请记录」跟踪。
                    </div>
                  </div>
                )}

                {inviteForm.channel === 'email' && !inviteResult.sent && (
                  <div className="mb-3 space-y-2 rounded-lg border border-slate-100 p-3">
                    <div className="text-[11px] font-semibold text-amber-600">邮件服务未配置——系统暂不能直接发送，以下为降级方式</div>
                    <div className="text-[11px] text-slate-400">收件人：{inviteResult.email}。可到「管理 → 控制面板 → 邮件服务」配置 SMTP 后，在邀请记录中一键重发。</div>
                    <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded border border-slate-100 bg-slate-50 p-2.5 text-[11px] leading-5 text-slate-600">{inviteResult.subject + '\n\n' + inviteResult.body}</pre>
                    <div className="flex gap-2">
                      <Btn size="sm" variant="primary" onClick={() => window.open(inviteResult.mailto, '_blank')}>
                        <Mail size={12} /> 打开邮件客户端发送
                      </Btn>
                      <Btn size="sm" onClick={() => copyText(`主题：${inviteResult.subject}\n\n${inviteResult.body}`).then(() => notify('邮件全文已复制'))}>
                        <Copy size={12} /> 复制邮件全文
                      </Btn>
                    </div>
                    <div className="text-[11px] leading-4 text-slate-400">提示：邮件经本机邮件客户端发出；发送状态可在「邀请记录」中跟踪激活情况。</div>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <div className="text-[11px] text-slate-400">演示提示：初始密码 ontos@2026 也可直接登录（未激活时不可用）</div>
                  <Btn variant="primary" onClick={closeInvite}>完成</Btn>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 新建 / 编辑用户组弹层 */}
      {groupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={closeGroupModal}>
          <div className="w-[460px] max-w-[92vw] rounded-2xl border border-slate-200 bg-white p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div className="text-base font-bold text-slate-900">{groupModal === 'edit' ? '编辑用户组' : '新建用户组'}</div>
              <button onClick={closeGroupModal} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={16} /></button>
            </div>
            <div className="space-y-3.5">
              <Field label="名称" required><Input value={groupForm.name} onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })} placeholder="如：设备运维组" /></Field>
              <Field label="说明"><Input value={groupForm.desc} onChange={(e) => setGroupForm({ ...groupForm, desc: e.target.value })} placeholder="组的用途描述" /></Field>
              <Field label="默认工作区" hint="成员登录后的默认落地页/工作区名称"><Input value={groupForm.defaultApp} onChange={(e) => setGroupForm({ ...groupForm, defaultApp: e.target.value })} placeholder="如：设备运维工作台" /></Field>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Btn onClick={closeGroupModal}>取消</Btn>
              <Btn variant="primary" disabled={groupBusy} onClick={submitGroup}>{groupBusy ? '保存中…' : groupModal === 'edit' ? '保存修改' : '创建用户组'}</Btn>
            </div>
          </div>
        </div>
      )}

      {/* 删除用户组确认弹层 */}
      {confirmDeleteGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={() => setConfirmDeleteGroup(null)}>
          <div className="w-[380px] max-w-[92vw] rounded-2xl border border-slate-200 bg-white p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1.5 text-base font-bold text-slate-900">删除用户组</div>
            <div className="mb-4 text-[13px] leading-5 text-slate-500">
              确定删除「{confirmDeleteGroup.name}」吗？该组的成员关系将一并清除，删除后不可恢复。
            </div>
            <div className="flex justify-end gap-2">
              <Btn onClick={() => setConfirmDeleteGroup(null)}>取消</Btn>
              <Btn variant="danger" onClick={() => deleteGroup(confirmDeleteGroup)}><Trash2 size={13} /> 确认删除</Btn>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}
