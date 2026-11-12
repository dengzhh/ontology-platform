import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CheckCircle2, Database, Loader2, RefreshCw, ShieldCheck, ShieldAlert, Tag, Clock3, Plus, Trash2, X, Play, ScanSearch, Eye, CalendarClock, History } from 'lucide-react'
import PageShell from '@/components/ui/PageShell'
import Tabs from '@/components/ui/Tabs'
import Btn from '@/components/ui/Btn'
import DataTable, { type Column } from '@/components/ui/DataTable'
import { Badge } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import StatCard from '@/components/ui/StatCard'
import { ProgressBar } from '@/components/ui/Misc'
import { Input, Field } from '@/components/ui/Form'
import { api } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'

/* ---------- 真实接口返回结构（server/routes/p10.ts） ---------- */
type Access = 'full' | 'read' | 'none'
interface RoleItem {
  id: string
  name: string
  desc: string
  memberCount: number
  objectPerms: Record<string, string>
}
interface TypeItem { id: string; name: string; color: string }
interface MarkingStats { total: number; marked: number; internal: number; confidential: number }
interface LifecyclePolicy { name: string; retention: string; legal: string }
interface AuditStats {
  checkpointCount: number
  cipherRules: number | null
  scanResults: { totalTables: number; hits: number; resolved: number } | null
  lifecyclePolicies: LifecyclePolicy[]
  governance?: { enabled: boolean; note: string }
}
interface SecurityResp {
  roles: RoleItem[]
  types: TypeItem[]
  markingStats: MarkingStats
  auditStats: AuditStats
}

/* ---------- 治理三表（server/routes/governance.ts：/api/gov/*） ---------- */
interface CipherRule { id: string; name: string; pattern: string; action: string; enabled: boolean }
interface CipherRulesResp { rules: CipherRule[] }
interface ScanFinding { id: string; table: string; field: string; sensitiveType: string; status: string }
interface ScanFindingsResp {
  findings: ScanFinding[]
  stats: { total: number; pending: number; resolved: number }
}
interface LifecyclePolicyRow { id: string; name: string; retention: string; legal: string }
interface LifecyclePoliciesResp { policies: LifecyclePolicyRow[] }

/* ---------- 治理执行引擎（server/routes/platformOps.ts：/api/ops/governance/*） ---------- */
interface ExecResult {
  runId: string
  real: boolean
  result: string
  [key: string]: unknown
}
interface GovRun {
  id: string
  kind: string
  kindLabel: string
  target: string
  result: string
  count: number
  time: string
  createdAt: number
}
interface GovRunsResp { runs: GovRun[]; total: number; real: boolean }
type ExecKind = 'scan' | 'mask' | 'lifecycle'

function AccessCell({ v }: { v: string }) {
  if (v === 'full') return <span className="text-base font-bold text-emerald-600">✓</span>
  if (v === 'read') return <Badge color="blue">只读</Badge>
  return <span className="text-slate-300">—</span>
}

function pct(part: number, total: number): number {
  if (!total) return 0
  return Math.round((part / total) * 1000) / 10
}

/** 通用弹层：点击遮罩或右上角关闭按钮均关闭 */
function Modal({ title, desc, onClose, children }: { title: string; desc?: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <div className="w-[480px] max-w-[94vw] rounded-2xl border border-slate-200 bg-white p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-sm font-bold text-slate-900">{title}</div>
            {desc && <div className="mt-0.5 text-[11px] text-slate-400">{desc}</div>}
          </div>
          <button aria-label="关闭" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** 带确认/取消的删除按钮单元格：confirmId 命中时显示「确认删除？+ 确认/取消」 */
function DeleteCell({ id, confirmId, setConfirmId, deletingId, onConfirm }: {
  id: string
  confirmId: string | null
  setConfirmId: (id: string | null) => void
  deletingId: string | null
  onConfirm: (id: string) => void
}) {
  if (confirmId === id) {
    return (
      <span className="inline-flex items-center justify-end gap-1.5 whitespace-nowrap text-[11px]">
        <span className="text-red-600">确认删除？</span>
        <Btn size="sm" variant="danger" disabled={deletingId === id} onClick={() => onConfirm(id)}>
          {deletingId === id ? <Loader2 size={12} className="animate-spin" /> : '确认'}
        </Btn>
        <Btn size="sm" variant="ghost" onClick={() => setConfirmId(null)}>取消</Btn>
      </span>
    )
  }
  return (
    <button onClick={() => setConfirmId(id)} className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-red-500" title="删除">
      <Trash2 size={12} /> 删除
    </button>
  )
}

/** 安全与标记：权限/标记/Checkpoint 来自 /api/p10/security；治理三表来自 /api/gov/* 真实 CRUD */
export default function SecurityPage() {
  const [tab, setTab] = useState('markings')
  const q = useApi<SecurityResp>('/p10/security')
  const cipherQ = useApi<CipherRulesResp>('/gov/cipher-rules')
  const findingsQ = useApi<ScanFindingsResp>('/gov/scan-findings')
  const policiesQ = useApi<LifecyclePoliciesResp>('/gov/lifecycle-policies')
  const runsQ = useApi<GovRunsResp>('/ops/governance/runs')
  const [toast, setToast] = useState<{ msg: string; err: boolean } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /* 治理执行引擎状态 */
  const [execKind, setExecKind] = useState<ExecKind | null>(null)
  const [execBusy, setExecBusy] = useState(false)
  const [execResult, setExecResult] = useState<{ kind: ExecKind; data: ExecResult } | null>(null)
  const [writeBack, setWriteBack] = useState(false)

  /* 治理三表：新建弹层状态 */
  const [cipherModal, setCipherModal] = useState(false)
  const [cipherForm, setCipherForm] = useState({ name: '', pattern: '', action: '掩码' })
  const [findingModal, setFindingModal] = useState(false)
  const [findingForm, setFindingForm] = useState({ table: '', field: '', sensitiveType: '' })
  const [policyModal, setPolicyModal] = useState(false)
  const [policyForm, setPolicyForm] = useState({ name: '', retention: '', legal: '' })

  /* 删除确认（三类共用 confirmId，各自删除中状态用 deletingId） */
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [patchingId, setPatchingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function notify(msg: string, err = false) {
    setToast({ msg, err })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3200)
  }

  /* 执行扫描 / 执行掩码预览 / 执行生命周期检查：真实调用治理执行引擎，结果有明确反馈 */
  async function runExec(kind: ExecKind) {
    setExecBusy(true)
    setExecKind(kind)
    setExecResult(null)
    try {
      const endpoint = kind === 'scan' ? '/ops/governance/scan' : kind === 'mask' ? '/ops/governance/mask' : '/ops/governance/lifecycle'
      const body = kind === 'scan' ? { writeBack } : {}
      const data = await api<ExecResult>(endpoint, { method: 'POST', body })
      setExecResult({ kind, data })
      notify(`✓ ${data.result}`)
      runsQ.reload()
      if (kind === 'scan' && writeBack) findingsQ.reload()
    } catch (e) {
      notify(e instanceof Error ? e.message : '执行失败', true)
    } finally {
      setExecBusy(false)
      setExecKind(null)
    }
  }

  useEffect(() => {
    if (q.error) notify(`加载失败：${q.error}`, true)
  }, [q.error])
  useEffect(() => {
    if (cipherQ.error) notify(`脱敏规则加载失败：${cipherQ.error}`, true)
  }, [cipherQ.error])
  useEffect(() => {
    if (findingsQ.error) notify(`扫描发现加载失败：${findingsQ.error}`, true)
  }, [findingsQ.error])
  useEffect(() => {
    if (policiesQ.error) notify(`生命周期策略加载失败：${policiesQ.error}`, true)
  }, [policiesQ.error])
  useEffect(() => {
    if (runsQ.error) notify(`执行记录加载失败：${runsQ.error}`, true)
  }, [runsQ.error])

  const roles = q.data?.roles ?? []
  const types = q.data?.types ?? []
  const marking = q.data?.markingStats
  const audit = q.data?.auditStats
  const legacyPolicies = audit?.lifecyclePolicies ?? []

  const cipherRules = cipherQ.data?.rules ?? []
  const findings = findingsQ.data?.findings ?? []
  const stats = findingsQ.data?.stats
  const policies = policiesQ.data?.policies ?? []
  const runs = runsQ.data?.runs ?? []

  const coverage = marking ? pct(marking.marked, marking.total) : 0

  // 权限矩阵列按真实对象类型动态生成
  const matrixColumns: Column<RoleItem>[] = [
    {
      key: 'role', header: '角色 / 成员', cell: (r) => (
        <span>
          <span className="font-semibold text-slate-800">{r.name}</span>
          <span className="ml-2 text-[11px] text-slate-400">{r.desc} · {r.memberCount} 人</span>
        </span>
      ),
    },
    ...types.map<Column<RoleItem>>((t) => ({
      key: `type:${t.name}`,
      header: (
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: t.color }} />
          {t.name}
        </span>
      ),
      align: 'center',
      cell: (r) => <AccessCell v={r.objectPerms[t.name] ?? 'none'} />,
    })),
  ]

  /* ---------- 治理三表写操作（成功/失败均有反馈，统一刷新对应列表） ---------- */
  function openCipherModal() {
    setCipherForm({ name: '', pattern: '', action: '掩码' })
    setCipherModal(true)
  }
  async function createCipherRule() {
    if (!cipherForm.name.trim()) return notify('请填写规则名称', true)
    setSaving(true)
    try {
      await api('/gov/cipher-rules', {
        method: 'POST',
        body: {
          name: cipherForm.name.trim(),
          pattern: cipherForm.pattern.trim() || undefined,
          action: cipherForm.action.trim() || undefined,
        },
      })
      notify('✓ 脱敏规则已新建')
      setCipherModal(false)
      cipherQ.reload()
    } catch (e) {
      notify(e instanceof Error ? e.message : '新建失败', true)
    } finally {
      setSaving(false)
    }
  }
  async function removeCipherRule(id: string) {
    setDeletingId(id)
    try {
      await api(`/gov/cipher-rules/${id}`, { method: 'DELETE' })
      notify('✓ 脱敏规则已删除')
      setConfirmId(null)
      cipherQ.reload()
    } catch (e) {
      notify(e instanceof Error ? e.message : '删除失败', true)
    } finally {
      setDeletingId(null)
    }
  }

  function openFindingModal() {
    setFindingForm({ table: '', field: '', sensitiveType: '' })
    setFindingModal(true)
  }
  async function createFinding() {
    if (!findingForm.table.trim()) return notify('请填写表名', true)
    setSaving(true)
    try {
      await api('/gov/scan-findings', {
        method: 'POST',
        body: {
          table: findingForm.table.trim(),
          field: findingForm.field.trim() || undefined,
          sensitiveType: findingForm.sensitiveType.trim() || undefined,
        },
      })
      notify('✓ 发现项已新建')
      setFindingModal(false)
      findingsQ.reload()
    } catch (e) {
      notify(e instanceof Error ? e.message : '新建失败', true)
    } finally {
      setSaving(false)
    }
  }
  async function markResolved(f: ScanFinding) {
    setPatchingId(f.id)
    try {
      await api(`/gov/scan-findings/${f.id}`, { method: 'PATCH', body: { status: '已处置' } })
      notify('✓ 已标记为已处置')
      findingsQ.reload()
    } catch (e) {
      notify(e instanceof Error ? e.message : '处置失败', true)
    } finally {
      setPatchingId(null)
    }
  }

  function openPolicyModal() {
    setPolicyForm({ name: '', retention: '', legal: '' })
    setPolicyModal(true)
  }
  async function createPolicy() {
    if (!policyForm.name.trim()) return notify('请填写策略名称', true)
    setSaving(true)
    try {
      await api('/gov/lifecycle-policies', {
        method: 'POST',
        body: {
          name: policyForm.name.trim(),
          retention: policyForm.retention.trim() || undefined,
          legal: policyForm.legal.trim() || undefined,
        },
      })
      notify('✓ 生命周期策略已新建')
      setPolicyModal(false)
      policiesQ.reload()
    } catch (e) {
      notify(e instanceof Error ? e.message : '新建失败', true)
    } finally {
      setSaving(false)
    }
  }
  async function removePolicy(id: string) {
    setDeletingId(id)
    try {
      await api(`/gov/lifecycle-policies/${id}`, { method: 'DELETE' })
      notify('✓ 生命周期策略已删除')
      setConfirmId(null)
      policiesQ.reload()
    } catch (e) {
      notify(e instanceof Error ? e.message : '删除失败', true)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <PageShell
      icon={ShieldCheck}
      title="安全与标记"
      subtitle="以标记为中心的数据安全治理 —— 标记/权限/Checkpoint 为真实统计，治理三表为本地轻量规则表管理"
      benchmark="数据安全"
      features={[
        '数据标记：基于真实用户标记统计的覆盖率与分级分布',
        '权限矩阵：真实角色 × 真实对象类型的读写边界，遵循最小权限原则',
        'Checkpoint：来自审计统计的真实触发次数',
        '治理三表：脱敏规则 / 扫描发现 / 生命周期策略真实落库，支持新建 / 删除 / 处置',
        '覆盖率与处置率：全部由接口返回数值实时计算',
      ]}
      actions={
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-400">新建标记需后端支持</span>
          <Btn size="sm" variant="primary" disabled title="新建标记需后端支持">新建标记</Btn>
          <Btn size="sm" onClick={q.reload} disabled={q.loading}><RefreshCw size={13} /> 刷新</Btn>
        </div>
      }
    >
      {toast && (
        <div className={cn('rounded-lg border px-4 py-2.5 text-sm font-medium',
          toast.err ? 'border-red-200 bg-red-50 text-red-600' : 'border-emerald-200 bg-emerald-50 text-emerald-700')}>
          {toast.msg}
        </div>
      )}

      {/* 能力状态说明：规则表 CRUD + 真实治理执行引擎 */}
      <div className="flex items-start gap-2.5 rounded-xl border border-brand-200 bg-brand-50/60 px-4 py-3 text-[12px] leading-5 text-brand-800">
        <span className="mt-0.5 shrink-0 font-semibold">能力状态说明：</span>
        <span>
          Cipher 脱敏规则、敏感扫描发现、生命周期策略为<strong>本地轻量规则表管理</strong>：条目真实落库，支持新建 / 删除 / 处置与统计。
          下方<strong>治理执行引擎</strong>现已接入：执行扫描（遍历当前空间对象 values 匹配敏感样式）、执行掩码预览（按规则预览会被掩码的字段，不直接改库）、执行生命周期检查（按保留期限计算到期审计事件）均为真实计算并写执行记录与审计日志。
          查询时实时脱敏管道 + 到期自动归档删除的调度器仍属后续规划，当前不会自动改动数据。
          {q.data?.auditStats.governance && !q.data.auditStats.governance.enabled && (
            <span className="mt-1 block text-[11px] text-brand-600">另：Markings 标记统计、权限矩阵、Checkpoint 计数为平台真实数据（/api/p10/security）。</span>
          )}
        </span>
      </div>

      {/* 治理执行引擎：三个执行按钮 + 结果反馈 + 最近执行记录 */}
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <Play size={14} className="text-brand-600" /> 治理执行引擎
              <Badge color="green" dot>真实执行 · 写执行记录</Badge>
            </span>
          }
          desc="调用 /ops/governance/*：真实计算当前空间对象，结果写入 governanceRuns 并审计留痕"
          actions={<Badge color="slate">共 {runsQ.data?.total ?? 0} 条执行记录</Badge>}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Btn size="sm" variant="primary" disabled={execBusy} onClick={() => runExec('scan')}>
            {execBusy && execKind === 'scan' ? <Loader2 size={13} className="animate-spin" /> : <ScanSearch size={13} />} 执行扫描
          </Btn>
          <Btn size="sm" disabled={execBusy} onClick={() => runExec('mask')}>
            {execBusy && execKind === 'mask' ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />} 执行掩码预览
          </Btn>
          <Btn size="sm" disabled={execBusy} onClick={() => runExec('lifecycle')}>
            {execBusy && execKind === 'lifecycle' ? <Loader2 size={13} className="animate-spin" /> : <CalendarClock size={13} />} 执行生命周期检查
          </Btn>
          <label className="ml-1 flex items-center gap-1.5 text-[11px] text-slate-500">
            <input type="checkbox" checked={writeBack} onChange={(e) => setWriteBack(e.target.checked)} className="accent-brand-600" />
            扫描新发现写回 scanFindings
          </label>
          <span className="text-[11px] text-slate-400">掩码为预览（不改库）；扫描默认仅返回命中，勾选后才写回登记</span>
        </div>

        {/* 执行结果：明确反馈 */}
        {execResult && (
          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
            <div className="mb-1.5 flex items-center gap-2 text-[12px] font-semibold text-emerald-700">
              <CheckCircle2 size={14} />
              {execResult.kind === 'scan' ? '执行扫描' : execResult.kind === 'mask' ? '执行掩码预览' : '执行生命周期检查'} · 执行结果
              <Badge color="green" dot>{execResult.data.real ? '真实计算' : '结果'}</Badge>
            </div>
            <div className="text-[12px] text-emerald-800">{execResult.data.result}</div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-slate-600 md:grid-cols-4">
              {execResult.kind === 'scan' && (
                <>
                  <span>扫描对象：<b>{Number(execResult.data.scannedObjects ?? 0)}</b></span>
                  <span>命中敏感值：<b>{Number(execResult.data.hitCount ?? 0)}</b></span>
                  <span>写回新发现：<b>{Number(execResult.data.written ?? 0)}</b></span>
                </>
              )}
              {execResult.kind === 'mask' && (
                <>
                  <span>启用规则：<b>{Number(execResult.data.ruleCount ?? 0)}</b></span>
                  <span>命中字段：<b>{Number(execResult.data.fieldCount ?? 0)}</b></span>
                  <span className="col-span-2 text-amber-700">仅预览，不会修改数据库对象值</span>
                </>
              )}
              {execResult.kind === 'lifecycle' && (
                <>
                  <span>策略数：<b>{Number(execResult.data.policyCount ?? 0)}</b></span>
                  <span>对象数：<b>{Number(execResult.data.objectCount ?? 0)}</b></span>
                  <span>到期事件：<b>{Number(execResult.data.expiredCount ?? 0)}</b></span>
                </>
              )}
              <span>记录 id：<code className="font-mono text-[10px]">{execResult.data.runId}</code></span>
            </div>
            {Array.isArray(execResult.data.hits) && (execResult.data.hits as { field: string; sensitiveType: string; objectId: string }[]).length > 0 && (
              <div className="mt-2 text-[11px] text-slate-500">
                命中样例：{(execResult.data.hits as { field: string; sensitiveType: string; objectId: string }[]).slice(0, 3).map((h) => `${h.field}(${h.sensitiveType})`).join('、')}
              </div>
            )}
            {Array.isArray(execResult.data.samples) && (execResult.data.samples as { field: string; original: string; masked: string }[]).length > 0 && (
              <div className="mt-2 text-[11px] text-slate-500">
                掩码样例：{(execResult.data.samples as { field: string; original: string; masked: string }[]).slice(0, 2).map((s) => `${s.field}: ${s.original} → ${s.masked}`).join('；')}
              </div>
            )}
          </div>
        )}

        {/* 最近执行记录列表 */}
        <div className="mt-3 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-700"><History size={13} /> 最近执行记录</span>
          <Btn size="sm" onClick={runsQ.reload} disabled={runsQ.loading}><RefreshCw size={12} /> 刷新</Btn>
        </div>
        {runsQ.loading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-xs text-slate-400"><Loader2 size={13} className="animate-spin" /> 加载执行记录…</div>
        ) : runs.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-400">暂无执行记录，点击上方按钮执行一次治理动作</div>
        ) : (
          <DataTable
            dense
            rows={runs.slice(0, 12)}
            rowKey={(r) => r.id}
            columns={[
              { key: 'time', header: '时间', width: '150px', cell: (r) => <span className="text-[11px] text-slate-500">{r.time}</span> },
              { key: 'kind', header: '类型', align: 'center', cell: (r) => <Badge color={r.kind === 'scan' ? 'blue' : r.kind === 'mask' ? 'violet' : 'cyan'}>{r.kindLabel}</Badge> },
              { key: 'count', header: '数量', align: 'center', cell: (r) => <span className="font-semibold text-slate-700">{r.count}</span> },
              { key: 'result', header: '结果', cell: (r) => <span className="text-[11px] text-slate-500">{r.result}</span> },
            ]}
          />
        )}
      </Card>

      {q.loading ? (
        <Card className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
          <Loader2 size={15} className="animate-spin" /> 加载安全数据…
        </Card>
      ) : q.error ? (
        <Card className="flex flex-col items-center gap-3 py-14 text-center">
          <div className="text-sm text-red-600">加载失败：{q.error}</div>
          <Btn size="sm" onClick={q.reload}><RefreshCw size={13} /> 重试</Btn>
        </Card>
      ) : (
        <Card padding={false}>
          <div className="border-b border-slate-100 p-3">
            <Tabs
              tabs={[
                { key: 'markings', label: '数据标记' },
                { key: 'permissions', label: '权限矩阵', count: roles.length },
                { key: 'checkpoint', label: 'Checkpoint' },
                { key: 'cipher', label: '数据脱敏', count: cipherRules.length },
                { key: 'scan', label: '敏感扫描', count: findings.length },
                { key: 'lifetime', label: '生命周期', count: policies.length },
              ]}
              active={tab}
              onChange={setTab}
            />
          </div>

          {/* 数据标记：markingStats */}
          {tab === 'markings' && (
            <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <StatCard label="纳入统计总数" value={marking?.total ?? '—'} icon={Tag} footer="当前空间用户对象总数" />
                <StatCard label="已标记" value={marking?.marked ?? '—'} icon={CheckCircle2} iconClass="bg-emerald-50 text-emerald-600" footer={`覆盖率 ${coverage}%`} />
                <StatCard label="内部标记" value={marking?.internal ?? '—'} icon={ShieldCheck} iconClass="bg-blue-50 text-blue-600" footer="含「内部」标记的对象" />
                <StatCard label="机密标记" value={marking?.confidential ?? '—'} icon={ShieldAlert} iconClass="bg-amber-50 text-amber-600" footer="含「机密」标记的对象" />
              </div>
              <Card className="h-fit border border-slate-100 shadow-none">
                <CardHeader title="对象打标覆盖率" desc="由真实 markingStats 计算" />
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-slate-500">已标记 / 总数</span>
                  <span className="text-xl font-bold text-slate-900">{coverage}%</span>
                </div>
                <ProgressBar pct={coverage} color="bg-emerald-500" className="mt-1.5" />
                <div className="mt-1 text-[11px] text-slate-400">
                  共 {marking?.total ?? 0} 个对象 · 已标记 {marking?.marked ?? 0} 个 · 未标记 {(marking?.total ?? 0) - (marking?.marked ?? 0)} 个
                </div>
                <div className="mt-4 space-y-3">
                  {[
                    { label: '内部标记占比', value: marking ? pct(marking.internal, marking.total) : 0, color: 'bg-brand-400' },
                    { label: '机密标记占比', value: marking ? pct(marking.confidential, marking.total) : 0, color: 'bg-amber-400' },
                  ].map((row) => (
                    <div key={row.label}>
                      <div className="mb-1 flex items-center justify-between text-[11px]">
                        <span className="font-medium text-slate-600">{row.label}</span>
                        <span className="text-slate-400">{row.value}%</span>
                      </div>
                      <ProgressBar pct={row.value} color={row.color} />
                    </div>
                  ))}
                </div>
                <div className="mt-4 rounded-lg border border-dashed border-slate-200 p-2.5 text-[11px] leading-5 text-slate-400">
                  标记体系的建立与编辑需要后端数据标记能力，当前仅展示来自真实接口的统计结果。
                </div>
              </Card>
            </div>
          )}

          {/* 权限矩阵：roles[].objectPerms × types */}
          {tab === 'permissions' && (
            <div className="p-4">
              <DataTable columns={matrixColumns} rows={roles} rowKey={(r) => r.id} />
              <div className="mt-3 flex flex-wrap items-center gap-4 rounded-lg border border-dashed border-slate-200 p-3 text-[11px] text-slate-500">
                <span className="flex items-center gap-1.5"><span className="text-base font-bold leading-none text-emerald-600">✓</span>读写（可执行动作）</span>
                <span className="flex items-center gap-1.5"><Badge color="blue">只读</Badge>仅查看，不可写回</span>
                <span className="flex items-center gap-1.5"><span className="font-semibold text-slate-300">—</span>无权限（对象不可见）</span>
                <span className="ml-auto">列按当前空间真实对象类型生成（{types.length} 类）</span>
              </div>
            </div>
          )}

          {/* Checkpoint：auditStats.checkpointCount */}
          {tab === 'checkpoint' && (
            <div className="p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <StatCard label="Checkpoint 触发次数" value={audit?.checkpointCount ?? '—'} icon={ShieldCheck} footer="审计日志中 Checkpoint / 查看敏感 类事件" />
                <StatCard label="统计来源" value="审计日志" icon={Database} iconClass="bg-violet-50 text-violet-600" footer="server/routes/p10.ts 实时聚合" />
              </div>
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-slate-200 p-3 text-xs text-slate-400">
                <ShieldAlert size={14} /> 触发时将弹出理由确认气泡，理由与操作上下文一并写入不可篡改的审计日志；具体规则明细需后端提供接口后展示。
              </div>
            </div>
          )}

          {/* 数据脱敏：真实规则表 CRUD（GET/POST/DELETE /api/gov/cipher-rules） */}
          {tab === 'cipher' && (
            <div className="p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="text-[12px] text-slate-500">本地轻量规则表管理 · 真实落库，规则条目支持新建 / 删除</div>
                <div className="flex items-center gap-2">
                  <Btn size="sm" onClick={cipherQ.reload}><RefreshCw size={12} /> 刷新</Btn>
                  <Btn size="sm" variant="primary" onClick={openCipherModal}><Plus size={12} /> 新建规则</Btn>
                </div>
              </div>
              {cipherQ.loading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400"><Loader2 size={14} className="animate-spin" /> 加载脱敏规则…</div>
              ) : cipherQ.error ? (
                <div className="flex flex-col items-center gap-2 py-10 text-center">
                  <div className="text-xs text-red-600">加载失败：{cipherQ.error}</div>
                  <Btn size="sm" onClick={cipherQ.reload}><RefreshCw size={12} /> 重试</Btn>
                </div>
              ) : (
                <DataTable
                  dense
                  rows={cipherRules}
                  rowKey={(r) => r.id}
                  columns={[
                    { key: 'name', header: '规则名称', cell: (r) => <span className="font-semibold text-slate-800">{r.name}</span> },
                    { key: 'pattern', header: '匹配模式', cell: (r) => <code className="font-mono text-[11px] text-slate-600">{r.pattern || '—'}</code> },
                    { key: 'action', header: '动作', align: 'center', cell: (r) => <Badge color="violet">{r.action || '—'}</Badge> },
                    { key: 'enabled', header: '状态', align: 'center', cell: (r) => <Badge color={r.enabled ? 'green' : 'slate'} dot>{r.enabled ? '已启用' : '已禁用'}</Badge> },
                    { key: 'op', header: '操作', align: 'right', width: '130px', cell: (r) => (
                      <DeleteCell id={r.id} confirmId={confirmId} setConfirmId={setConfirmId} deletingId={deletingId} onConfirm={removeCipherRule} />
                    ) },
                  ]}
                />
              )}
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-[11px] leading-5 text-slate-500">
                <ShieldCheck size={13} className="mt-0.5 shrink-0 text-brand-500" />
                此处仅管理规则条目本身（编目用途）；查询时实时应用规则 + Checkpoint 明文确认的真实脱敏管道尚未接入，属后续规划。
              </div>
            </div>
          )}

          {/* 敏感扫描：真实发现表 CRUD + stats 统计卡 + 标记已处置（PATCH /api/gov/scan-findings/:id） */}
          {tab === 'scan' && (
            <div className="flex flex-col gap-4 p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <StatCard label="发现项总数" value={stats?.total ?? '—'} icon={Database} footer="来自 /api/gov/scan-findings" />
                <StatCard label="待处置" value={stats?.pending ?? '—'} icon={ShieldAlert} iconClass="bg-amber-50 text-amber-600" footer="status = 待处置" />
                <StatCard label="已处置" value={stats?.resolved ?? '—'} icon={CheckCircle2} iconClass="bg-emerald-50 text-emerald-600" footer="status = 已处置" />
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="text-[12px] text-slate-500">发现项清单 · 支持新建与标记已处置</div>
                <div className="flex items-center gap-2">
                  <Btn size="sm" onClick={findingsQ.reload}><RefreshCw size={12} /> 刷新</Btn>
                  <Btn size="sm" variant="primary" onClick={openFindingModal}><Plus size={12} /> 新建发现项</Btn>
                </div>
              </div>
              {findingsQ.loading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400"><Loader2 size={14} className="animate-spin" /> 加载扫描发现…</div>
              ) : findingsQ.error ? (
                <div className="flex flex-col items-center gap-2 py-10 text-center">
                  <div className="text-xs text-red-600">加载失败：{findingsQ.error}</div>
                  <Btn size="sm" onClick={findingsQ.reload}><RefreshCw size={12} /> 重试</Btn>
                </div>
              ) : (
                <DataTable
                  dense
                  rows={findings}
                  rowKey={(r) => r.id}
                  columns={[
                    { key: 'table', header: '表', cell: (r) => <code className="font-mono text-[12px] font-semibold text-slate-800">{r.table}</code> },
                    { key: 'field', header: '字段', cell: (r) => <code className="font-mono text-[11px] text-slate-600">{r.field || '—'}</code> },
                    { key: 'sensitiveType', header: '敏感类型', cell: (r) => <span className="text-xs text-slate-600">{r.sensitiveType || '—'}</span> },
                    { key: 'status', header: '状态', align: 'center', cell: (r) => <Badge color={r.status === '已处置' ? 'green' : 'amber'} dot>{r.status}</Badge> },
                    { key: 'op', header: '操作', align: 'right', width: '130px', cell: (r) => (
                      r.status === '已处置' ? (
                        <span className="text-[11px] text-slate-400">已处置</span>
                      ) : (
                        <Btn size="sm" disabled={patchingId === r.id} onClick={() => markResolved(r)}>
                          {patchingId === r.id ? <><Loader2 size={12} className="animate-spin" /> 处置中…</> : <><CheckCircle2 size={12} /> 标记已处置</>}
                        </Btn>
                      )
                    ) },
                  ]}
                />
              )}
              <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-[11px] leading-5 text-slate-500">
                <ShieldAlert size={13} className="mt-0.5 shrink-0 text-brand-500" />
                此处管理手动登记的发现项与处置状态；自动识别表/字段敏感类型的扫描器尚未接入，不会自动产出命中明细，属后续规划。
              </div>
            </div>
          )}

          {/* 生命周期：真实策略表 CRUD（GET/POST/DELETE /api/gov/lifecycle-policies） */}
          {tab === 'lifetime' && (
            <div className="p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="text-[12px] text-slate-500">本地轻量策略表管理 · 真实落库，支持新建 / 删除</div>
                <div className="flex items-center gap-2">
                  <Btn size="sm" onClick={policiesQ.reload}><RefreshCw size={12} /> 刷新</Btn>
                  <Btn size="sm" variant="primary" onClick={openPolicyModal}><Plus size={12} /> 新建策略</Btn>
                </div>
              </div>
              {policiesQ.loading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400"><Loader2 size={14} className="animate-spin" /> 加载生命周期策略…</div>
              ) : policiesQ.error ? (
                <div className="flex flex-col items-center gap-2 py-10 text-center">
                  <div className="text-xs text-red-600">加载失败：{policiesQ.error}</div>
                  <Btn size="sm" onClick={policiesQ.reload}><RefreshCw size={12} /> 重试</Btn>
                </div>
              ) : (
                <DataTable
                  dense
                  rows={policies}
                  rowKey={(r) => r.id}
                  columns={[
                    { key: 'name', header: '策略名称', cell: (r) => <span className="font-semibold text-slate-800">{r.name}</span> },
                    { key: 'retention', header: '保留期限', cell: (r) => <span className="text-xs text-slate-600">{r.retention || '—'}</span> },
                    { key: 'legal', header: '法律依据', cell: (r) => <span className="text-xs text-slate-600">{r.legal || '—'}</span> },
                    { key: 'op', header: '操作', align: 'right', width: '130px', cell: (r) => (
                      <DeleteCell id={r.id} confirmId={confirmId} setConfirmId={setConfirmId} deletingId={deletingId} onConfirm={removePolicy} />
                    ) },
                  ]}
                />
              )}
              {legacyPolicies.length > 0 && (
                <div className="mt-3 rounded-lg border border-dashed border-slate-200 p-2.5 text-[11px] leading-5 text-slate-400">
                  另：/api/p10/security 返回 {legacyPolicies.length} 条只读示意策略（未落库），与上方真实策略表相互独立。
                </div>
              )}
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-[11px] leading-5 text-slate-500">
                <Clock3 size={13} className="mt-0.5 shrink-0 text-brand-500" />
                此处仅管理策略条目本身（保留期限 / 法律依据的编目）；按到期时间自动归档删除并写审计日志的调度器尚未接入，属后续规划。
              </div>
            </div>
          )}
        </Card>
      )}

      {/* 新建脱敏规则弹层 */}
      {cipherModal && (
        <Modal title="新建脱敏规则" desc="POST /api/gov/cipher-rules · 写入本地规则表" onClose={() => setCipherModal(false)}>
          <div className="space-y-3">
            <Field label="规则名称" required hint="如「手机号掩码」">
              <Input value={cipherForm.name} onChange={(e) => setCipherForm({ ...cipherForm, name: e.target.value })} placeholder="手机号掩码" />
            </Field>
            <Field label="匹配模式（pattern）" hint="可选，如正则 / 字段名">
              <Input value={cipherForm.pattern} onChange={(e) => setCipherForm({ ...cipherForm, pattern: e.target.value })} placeholder="^1[3-9]\d{9}$" />
            </Field>
            <Field label="脱敏动作（action）" hint="可选，默认「掩码」">
              <Input value={cipherForm.action} onChange={(e) => setCipherForm({ ...cipherForm, action: e.target.value })} placeholder="掩码 / 哈希 / 截断" />
            </Field>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Btn size="sm" onClick={() => setCipherModal(false)}>取消</Btn>
            <Btn size="sm" variant="primary" onClick={createCipherRule} disabled={saving}>
              {saving ? <><Loader2 size={13} className="animate-spin" /> 新建中…</> : '确认新建'}
            </Btn>
          </div>
        </Modal>
      )}

      {/* 新建扫描发现项弹层 */}
      {findingModal && (
        <Modal title="新建扫描发现项" desc="POST /api/gov/scan-findings · 初始状态为「待处置」" onClose={() => setFindingModal(false)}>
          <div className="space-y-3">
            <Field label="表名" required hint="如 customers / orders">
              <Input value={findingForm.table} onChange={(e) => setFindingForm({ ...findingForm, table: e.target.value })} placeholder="customers" />
            </Field>
            <Field label="字段" hint="可选">
              <Input value={findingForm.field} onChange={(e) => setFindingForm({ ...findingForm, field: e.target.value })} placeholder="phone" />
            </Field>
            <Field label="敏感类型" hint="可选，如「手机号 / 身份证 / 邮箱」">
              <Input value={findingForm.sensitiveType} onChange={(e) => setFindingForm({ ...findingForm, sensitiveType: e.target.value })} placeholder="手机号" />
            </Field>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Btn size="sm" onClick={() => setFindingModal(false)}>取消</Btn>
            <Btn size="sm" variant="primary" onClick={createFinding} disabled={saving}>
              {saving ? <><Loader2 size={13} className="animate-spin" /> 新建中…</> : '确认新建'}
            </Btn>
          </div>
        </Modal>
      )}

      {/* 新建生命周期策略弹层 */}
      {policyModal && (
        <Modal title="新建生命周期策略" desc="POST /api/gov/lifecycle-policies · 写入本地策略表" onClose={() => setPolicyModal(false)}>
          <div className="space-y-3">
            <Field label="策略名称" required hint="如「订单数据保留 3 年」">
              <Input value={policyForm.name} onChange={(e) => setPolicyForm({ ...policyForm, name: e.target.value })} placeholder="订单数据保留 3 年" />
            </Field>
            <Field label="保留期限（retention）" hint="可选">
              <Input value={policyForm.retention} onChange={(e) => setPolicyForm({ ...policyForm, retention: e.target.value })} placeholder="3 年" />
            </Field>
            <Field label="法律依据（legal）" hint="可选">
              <Input value={policyForm.legal} onChange={(e) => setPolicyForm({ ...policyForm, legal: e.target.value })} placeholder="网络安全法 / 内部审计要求" />
            </Field>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Btn size="sm" onClick={() => setPolicyModal(false)}>取消</Btn>
            <Btn size="sm" variant="primary" onClick={createPolicy} disabled={saving}>
              {saving ? <><Loader2 size={13} className="animate-spin" /> 新建中…</> : '确认新建'}
            </Btn>
          </div>
        </Modal>
      )}
    </PageShell>
  )
}
