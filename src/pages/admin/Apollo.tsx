import { useRef, useState } from 'react'
import {
  Rocket, RotateCcw, Server, ArrowUpRight, Plus, X, Loader2,
  CheckCircle2, Layers, Sparkles, RefreshCw, Info, ShieldAlert, Database,
} from 'lucide-react'
import PageShell from '@/components/ui/PageShell'
import Tabs from '@/components/ui/Tabs'
import Btn from '@/components/ui/Btn'
import DataTable, { type Column } from '@/components/ui/DataTable'
import { Badge, StatusDot, type BadgeColor } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import StatCard from '@/components/ui/StatCard'
import { Field, Input, Select } from '@/components/ui/Form'
import GanttView, { type GanttRow } from '@/components/canvas/GanttView'
import { api } from '@/lib/api'
import { useApi } from '@/lib/useApi'

/* ================================ 契约类型（对应 server/routes/apollo.ts） ================================ */

type Env = 'dev' | 'staging' | 'prod'
type DeployStatus = '构建中' | '成功' | '失败' | '已回滚'

interface Deployment {
  id: string
  version: string
  env: Env
  status: DeployStatus
  commit: string
  message: string
  operator: string
  previousId: string
  durationMs: number
  spaceId: string
  createdAt: number
  time: string
  duration: string
  envLabel: string
}

interface DeploymentsResp {
  deployments: Deployment[]
  total: number
  stats: {
    total: number
    success: number
    failed: number
    building: number
    rolledBack: number
    finished: number
    successRate: number
    currentProdVersion: string
    latestProdSuccessVersion: string
    latestSuccess: Record<Env, { id: string; version: string; createdAt: number; time: string } | null>
    byEnv: { env: Env; label: string; total: number; success: number; activeVersion: string }[]
  }
  note: string
  real: boolean
}

interface FreezeResp {
  rule: { days: number[]; period: string; scope: string; reason: string; description: string }
  days: number[]
  reason: string
  scopeEnvs: string[]
  month: string
  windows: { day: number; date: string }[]
  today: { date: string; day: number; isFrozen: boolean; affectedEnvs: string[] }
  real: boolean
}

interface Cluster {
  name: string
  region: string
  version: string
  nodes: number
  sourceEnv: string
  derivation: string
  desc: string
  mode: string
  versionRelation: string
  diffFromProd: number
  lagVersions: string[]
  status: string
  tag?: string
}

interface ClustersResp {
  clusters: Cluster[]
  prodVersion: string
  stagingVersion: string
  devVersion: string
  prodSuccessVersions: string[]
  note: string
  real: boolean
}

interface NewDeployResp { deployment: Deployment; stateFlow: string[] }
interface PromoteResp { deployment: Deployment; from: string; to: string; version: string }
interface RollbackResp { deployment: Deployment; rollbackToVersion: string; fromVersion: string; env: Env }
interface SeedResp { created: number; total: number }

/* ================================ 展示常量（仅配色 / 文案） ================================ */

const ENVS: Env[] = ['dev', 'staging', 'prod']
const ENV_LABEL: Record<Env, string> = { dev: '开发环境', staging: '预发环境', prod: '生产环境' }
const ENV_COLOR: Record<Env, BadgeColor> = { dev: 'blue', staging: 'amber', prod: 'red' }
const STATUS_COLOR: Record<DeployStatus, BadgeColor> = { '构建中': 'amber', '成功': 'green', '失败': 'red', '已回滚': 'violet' }
const STATUS_BG: Record<DeployStatus, string> = {
  '构建中': 'bg-amber-500', '成功': 'bg-emerald-500', '失败': 'bg-red-500', '已回滚': 'bg-violet-500',
}
const STATUS_LEGEND: { label: DeployStatus; color: string }[] = [
  { label: '成功', color: 'bg-emerald-500' },
  { label: '构建中', color: 'bg-amber-500' },
  { label: '失败', color: 'bg-red-500' },
  { label: '已回滚', color: 'bg-violet-500' },
]
const DAY = 86_400_000

const TABS = [
  { key: 'deploys', label: '部署记录' },
  { key: 'plan', label: '发布计划' },
  { key: 'clusters', label: '集群', count: 4 },
]

/* ================================ 发布计划：由真实部署记录派生甘特图 ================================ */

function shortDate(t: number): string {
  const d = new Date(t)
  return `${d.getMonth() + 1}/${d.getDate()}`
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

/** 把真实部署记录映射为甘特图：每行一个版本，条形按 createdAt 落在时间轴上 */
function buildPlan(deployments: Deployment[]): { rows: GanttRow[]; timeline: string[] } {
  const now = Date.now()
  const times = deployments.map((d) => d.createdAt)
  let start = times.length ? Math.min(...times) : now - 7 * DAY
  let end = Math.max(now, times.length ? Math.max(...times) : now)
  if (end - start < 3 * DAY) start = end - 7 * DAY
  const span = end - start || 1
  const timeline = Array.from({ length: 5 }, (_, i) => shortDate(start + (span * i) / 5))

  if (deployments.length === 0) {
    return { rows: [{ name: '暂无部署记录', sub: '新建部署或载入演示历史后自动生成时间线', bars: [] }], timeline }
  }

  const byVersion = new Map<string, Deployment[]>()
  for (const d of deployments) {
    const arr = byVersion.get(d.version) ?? []
    arr.push(d)
    byVersion.set(d.version, arr)
  }
  const versions = Array.from(byVersion.entries())
    .sort((a, b) => Math.max(...b[1].map((x) => x.createdAt)) - Math.max(...a[1].map((x) => x.createdAt)))
    .slice(0, 8)

  const rows: GanttRow[] = versions.map(([version, ds]) => ({
    name: version,
    sub: `${ds.length} 次部署 · ${Array.from(new Set(ds.map((d) => d.env))).join(' / ')}`,
    bars: [...ds].sort((a, b) => a.createdAt - b.createdAt).map((d) => ({
      start: clamp(((d.createdAt - start) / span) * 100, 0, 78),
      span: 20,
      label: `${d.env} · ${d.status}`,
      color: STATUS_BG[d.status],
      progress: d.status === '构建中' ? 35 : 100,
    })),
  }))
  return { rows, timeline }
}

/* ================================ 页面 ================================ */

type ToastKind = 'success' | 'error' | 'info'
interface Toast { text: string; kind: ToastKind }

/**
 * Apollo 本地部署编排状态机。
 * 部署记录 / 晋升 / 回滚 / 冻结窗口 / 集群视图均真实读写 SQLite；
 * 但不执行真实 K8s/CI-CD 任务 —— 状态机升级后可对接外部执行器。
 */
export default function ApolloPage() {
  const deployQ = useApi<DeploymentsResp>('/apollo/deployments')
  const freezeQ = useApi<FreezeResp>('/apollo/freeze-windows')
  const clustersQ = useApi<ClustersResp>('/apollo/clusters')

  const [tab, setTab] = useState('deploys')
  const [toast, setToast] = useState<Toast | null>(null)
  const toastTimer = useRef<number | null>(null)
  function notify(text: string, kind: ToastKind = 'success') {
    setToast({ text, kind })
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 3600)
  }

  /* ---- 新建部署弹层 ---- */
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ version: '', env: 'dev' as Env, commit: '', message: '' })
  const [busy, setBusy] = useState(false)
  /* ---- 行内动作：pending = `${id}:${op}`；confirmRollback = 待确认记录 id ---- */
  const [pending, setPending] = useState<string | null>(null)
  const [confirmRollback, setConfirmRollback] = useState<string | null>(null)

  const deployments = deployQ.data?.deployments ?? []
  const stats = deployQ.data?.stats
  const frozen = freezeQ.data?.today.isFrozen ?? false
  const freezeDays = freezeQ.data?.days ?? [8, 9]
  const freezeReason = freezeQ.data?.reason ?? '集团季度结算'

  function reloadAll() {
    deployQ.reload()
    clustersQ.reload()
  }

  /* ---- 新建部署 ---- */
  function openCreate() {
    setForm({ version: '', env: 'dev', commit: '', message: '' })
    setCreating(true)
  }

  async function submitCreate() {
    if (!form.version.trim()) return notify('请填写版本号，如 v2.9.0', 'error')
    setBusy(true)
    try {
      const r = await api<NewDeployResp>('/apollo/deploy', {
        method: 'POST',
        body: {
          version: form.version.trim(), env: form.env,
          commit: form.commit.trim(), message: form.message.trim(),
        },
      })
      notify(`部署已创建：${r.deployment.version} · ${ENV_LABEL[form.env]}（${r.stateFlow.join(' → ')}）`)
      setCreating(false)
      reloadAll()
    } catch (e) {
      notify(e instanceof Error ? e.message : '创建部署失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  /* ---- 版本晋升 ---- */
  async function promote(row: Deployment) {
    setPending(`${row.id}:promote`)
    try {
      const r = await api<PromoteResp>(`/apollo/promote/${encodeURIComponent(row.id)}`, { method: 'POST' })
      notify(`晋升成功：${r.version} · ${r.from} → ${r.to}，生成新部署 ${r.deployment.id}`)
      reloadAll()
    } catch (e) {
      notify(e instanceof Error ? e.message : '版本晋升失败', 'error')
    } finally {
      setPending(null)
    }
  }

  /* ---- 回滚 ---- */
  async function rollback(row: Deployment) {
    setPending(`${row.id}:rollback`)
    try {
      const r = await api<RollbackResp>(`/apollo/rollback/${encodeURIComponent(row.id)}`, { method: 'POST' })
      notify(`回滚完成：${r.env} 由 ${r.fromVersion} 回退至 ${r.rollbackToVersion}`)
      setConfirmRollback(null)
      reloadAll()
    } catch (e) {
      notify(e instanceof Error ? e.message : '回滚失败', 'error')
    } finally {
      setPending(null)
    }
  }

  /* ---- 载入演示历史 ---- */
  async function seed() {
    setBusy(true)
    try {
      const r = await api<SeedResp>('/apollo/seed', { method: 'POST' })
      notify(`已载入 ${r.created} 条演示部署历史（当前空间共 ${r.total} 条）`)
      reloadAll()
      freezeQ.reload()
    } catch (e) {
      notify(e instanceof Error ? e.message : '载入演示历史失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const plan = buildPlan(deployments)
  const isBusy = busy || pending !== null

  /* ---- 部署记录表格列 ---- */
  const columns: Column<Deployment>[] = [
    {
      key: 'version', header: '版本',
      cell: (r) => <code className="rounded bg-brand-50 px-1.5 py-0.5 font-mono text-xs font-semibold text-brand-700">{r.version}</code>,
    },
    { key: 'env', header: '环境', cell: (r) => <Badge color={ENV_COLOR[r.env] ?? 'slate'} dot>{r.env}</Badge> },
    { key: 'status', header: '状态', cell: (r) => <Badge color={STATUS_COLOR[r.status] ?? 'slate'} dot>{r.status}</Badge> },
    { key: 'commit', header: '提交', cell: (r) => <span className="font-mono text-[11px] text-slate-500">{r.commit || '—'}</span> },
    { key: 'message', header: '说明', cell: (r) => <span className="text-xs text-slate-500">{r.message || '—'}</span> },
    { key: 'duration', header: '耗时', cell: (r) => <span className="text-xs text-slate-500">{r.duration}</span> },
    { key: 'operator', header: '操作人' },
    { key: 'time', header: '部署时间', cell: (r) => <span className="text-xs text-slate-500">{r.time}</span> },
    {
      key: 'op', header: '操作', align: 'right',
      cell: (r) => {
        const canPromote = r.status === '成功' && (r.env === 'dev' || r.env === 'staging')
        const canRollback = r.status === '成功' && !!r.previousId
        if (!canPromote && !canRollback) return <span className="text-xs text-slate-300">—</span>
        return (
          <span className="inline-flex items-center justify-end gap-1.5">
            {canPromote && (
              <Btn size="sm" disabled={isBusy} onClick={() => promote(r)}>
                {pending === `${r.id}:promote` ? <Loader2 size={12} className="animate-spin" /> : <ArrowUpRight size={12} />} 晋升
              </Btn>
            )}
            {canRollback && (
              confirmRollback === r.id ? (
                <>
                  <span className="text-[11px] text-slate-500">确认回退？</span>
                  <Btn size="sm" variant="danger" disabled={isBusy} onClick={() => rollback(r)}>
                    {pending === `${r.id}:rollback` ? <Loader2 size={12} className="animate-spin" /> : null} 确认
                  </Btn>
                  <Btn size="sm" variant="ghost" disabled={isBusy} onClick={() => setConfirmRollback(null)}>取消</Btn>
                </>
              ) : (
                <Btn size="sm" disabled={isBusy} onClick={() => setConfirmRollback(r.id)}>
                  <RotateCcw size={12} /> 回滚
                </Btn>
              )
            )}
          </span>
        )
      },
    },
  ]

  return (
    <PageShell
      icon={Rocket}
      title="Apollo 部署"
      subtitle="多环境持续交付编排（本地状态机 · 真实读写库）"
      benchmark="部署发布"
      features={[
        '确定性状态流转：新建部署真实写库，按「构建中 → 成功」收敛并写审计',
        '环境门禁：prod 部署需 staging 已有同版本成功记录，否则拒绝（409）',
        '冻结窗口：每月 8 / 9 日季度结算暂停生产发布与晋升至生产',
        '版本晋升：dev → staging → prod，同版本在下一环境生成新成功记录',
        '回滚闭环：按 previousId 回退目标版本，新建「已回滚」记录并写审计',
        '派生视图：成功率、集群版本差异与滞后状态由部署记录实时计算',
        '升级路径：状态机可对接外部 K8s / CI-CD 执行器与真实集群',
      ]}
      actions={
        <>
          <Btn size="sm" disabled={isBusy} onClick={() => { reloadAll(); freezeQ.reload() }}>
            <RefreshCw size={13} /> 刷新
          </Btn>
          <Btn size="sm" disabled={isBusy} onClick={seed}>
            <Sparkles size={13} /> 载入演示历史
          </Btn>
          <Btn size="sm" variant="primary" disabled={isBusy} onClick={openCreate}>
            <Plus size={13} /> 新建部署
          </Btn>
        </>
      }
    >
      {/* 诚实标注：本地状态机，非真实 K8s/CI-CD 执行 */}
      <div className="flex items-start gap-2.5 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-[12px] leading-5 text-brand-800">
        <Info size={16} className="mt-0.5 shrink-0 text-brand-500" />
        <div>
          <span className="font-semibold">本地编排状态机</span>（非真实 K8s/CI-CD 执行；升级可对接外部系统）：
          部署、晋升、回滚、冻结窗口与审计均真实读写数据库并按确定性规则流转，
          但不下发真实构建任务、不连接外部集群。集群视图由部署记录派生。
        </div>
      </div>

      {/* 提示 / 反馈条 */}
      {toast && (
        <div className={`rounded-lg border px-4 py-2.5 text-sm font-medium ${
          toast.kind === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : toast.kind === 'error' ? 'border-red-200 bg-red-50 text-red-600'
              : 'border-brand-200 bg-brand-50 text-brand-700'
        }`}>{toast.text}</div>
      )}
      {deployQ.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600">
          加载部署记录失败：{deployQ.error}
        </div>
      )}

      {/* 统计卡（真实派生） */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="当前生产版本" value={stats?.currentProdVersion ?? '—'}
          icon={Rocket} iconClass="bg-brand-50 text-brand-600"
          footer={`最新成功版本 ${stats?.latestProdSuccessVersion ?? '—'}`}
        />
        <StatCard
          label="部署成功率" value={stats?.successRate ?? 0} unit="%"
          icon={CheckCircle2} iconClass="bg-emerald-50 text-emerald-600"
          footer={`成功 ${stats?.success ?? 0} / 已完成 ${stats?.finished ?? 0}`}
        />
        <StatCard
          label="构建中数量" value={stats?.building ?? 0}
          icon={Loader2} iconClass="bg-amber-50 text-amber-600"
          footer="状态机进行中记录数"
        />
        <StatCard
          label="部署总数" value={stats?.total ?? 0}
          icon={Layers} iconClass="bg-violet-50 text-violet-600"
          footer={`已回滚 ${stats?.rolledBack ?? 0} · 失败 ${stats?.failed ?? 0}`}
        />
      </div>

      <Card padding={false}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-3">
          <Tabs
            tabs={TABS.map((t) => t.key === 'deploys' ? { ...t, count: deployQ.data?.total } : t)}
            active={tab} onChange={setTab}
          />
          {frozen && (
            <span className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-amber-700">
              <ShieldAlert size={13} /> 今日冻结窗口 · 暂停生产发布
            </span>
          )}
        </div>

        {/* ============ Tab 1：部署记录 ============ */}
        {tab === 'deploys' && (
          <div className="p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-slate-500">
                共 <b className="text-slate-700">{deployQ.data?.total ?? 0}</b> 条部署记录 · 按时间降序 ·
                生产发布需 staging 同版本成功
              </div>
              <Btn size="sm" variant="primary" disabled={isBusy} onClick={openCreate}>
                <Plus size={12} /> 新建部署
              </Btn>
            </div>

            {/* 冻结窗口提示 */}
            <div className={`mb-3 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[11px] leading-5 ${
              frozen ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 bg-slate-50 text-slate-500'
            }`}>
              <ShieldAlert size={13} className="mt-0.5 shrink-0" />
              <span>
                <b>冻结窗口：</b>每月 {freezeDays.join(' / ')} 日（{freezeReason}）暂停一切生产（prod）发布与晋升至生产；
                dev / staging 不受限，紧急回滚不受限。
                {freezeQ.data && ` 今日 ${freezeQ.data.today.date} ${frozen ? '处于冻结窗口' : '不在冻结窗口'}。`}
              </span>
            </div>

            {deployQ.loading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400">
                <Loader2 size={15} className="animate-spin" /> 加载部署记录…
              </div>
            ) : (
              <DataTable columns={columns} rows={deployments} rowKey={(r) => r.id} />
            )}

            {stats && (
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-dashed border-slate-200 p-3 text-[11px] text-slate-500">
                <Database size={13} className="text-slate-400" />
                <span>各环境最新成功版本：</span>
                {ENVS.map((env) => (
                  <span key={env}>
                    <Badge color={ENV_COLOR[env]}>{env}</Badge>{' '}
                    <code className="font-mono text-slate-700">{stats.latestSuccess[env]?.version ?? '—'}</code>
                  </span>
                ))}
                <span className="ml-auto">当前生效生产版本：<b className="text-brand-700">{stats.currentProdVersion}</b></span>
              </div>
            )}
          </div>
        )}

        {/* ============ Tab 2：发布计划（真实部署时间线） ============ */}
        {tab === 'plan' && (
          <div className="p-4">
            <CardHeader
              title="部署时间线（真实记录派生）"
              desc={`基于 ${deployments.length} 条部署记录按 createdAt 生成 · 每行一个版本，条形位置即部署时间`}
              className="mb-3"
              actions={<Btn size="sm" disabled={isBusy} onClick={openCreate}><Plus size={12} /> 新建部署</Btn>}
            />
            {deployQ.loading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400">
                <Loader2 size={15} className="animate-spin" /> 生成时间线…
              </div>
            ) : (
              <GanttView rows={plan.rows} timeline={plan.timeline} />
            )}
            <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-slate-500">
              {STATUS_LEGEND.map((l) => (
                <span key={l.label} className="flex items-center gap-1.5">
                  <span className={`h-2.5 w-2.5 rounded ${l.color}`} /> {l.label}
                </span>
              ))}
              <span className="ml-auto">
                冻结窗口：每月 {freezeDays.join(' / ')} 日（{freezeReason}）暂停生产发布
                {frozen && <b className="ml-1 text-amber-700">· 今日生效</b>}
              </span>
            </div>
            {deployments.length === 0 && (
              <div className="mt-3 rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">
                暂无部署记录，点击「新建部署」或右上角「载入演示历史」后即可生成时间线。
              </div>
            )}
          </div>
        )}

        {/* ============ Tab 3：集群（真实派生） ============ */}
        {tab === 'clusters' && (
          <div className="p-4">
            <div className="mb-3 text-xs text-slate-500">
              生产 <code className="font-mono text-brand-700">{clustersQ.data?.prodVersion ?? '—'}</code>
              {' · '}预发 <code className="font-mono text-slate-700">{clustersQ.data?.stagingVersion ?? '—'}</code>
              {' · '}开发 <code className="font-mono text-slate-700">{clustersQ.data?.devVersion ?? '—'}</code>
              {' · '}版本差异与滞后状态由部署记录实时计算
            </div>
            {clustersQ.loading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400">
                <Loader2 size={15} className="animate-spin" /> 计算集群视图…
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {(clustersQ.data?.clusters ?? []).map((c) => {
                  const color: BadgeColor = c.versionRelation === '版本滞后' ? 'amber'
                    : c.versionRelation === '预发领先' ? 'violet'
                      : c.versionRelation === '未部署' ? 'slate' : 'green'
                  return (
                    <Card key={c.name} className="flex flex-col">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 text-[14px] font-bold text-slate-800">
                            <Server size={14} className="shrink-0 text-slate-400" /> {c.name}
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-400">{c.region}</div>
                        </div>
                        <StatusDot color={color} />
                      </div>
                      <div className="mt-3 flex items-center gap-2">
                        <code className="rounded bg-slate-50 px-1.5 py-0.5 font-mono text-xs text-brand-700">{c.version}</code>
                        <span className="text-[11px] text-slate-400">· {c.nodes} 节点</span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Badge color={c.mode === '受限模式' ? 'amber' : c.mode === '未部署' ? 'slate' : 'green'} dot>{c.status}</Badge>
                        {c.tag && <Badge color="amber">{c.tag}</Badge>}
                      </div>
                      <div className="mt-2.5 text-[11px] leading-4 text-slate-500">{c.desc}</div>
                      <div className="mt-auto pt-2.5 text-[10px] leading-4 text-slate-400">
                        {c.derivation}（来源 {c.sourceEnv}）
                      </div>
                    </Card>
                  )
                })}
              </div>
            )}
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-slate-200 p-3 text-xs text-slate-400">
              <Server size={14} /> 版本策略：生产与灾备保持一致；海外允许滞后一个生产版本；边缘节点仅接收开发环境裁剪的 edge 版本。
            </div>
          </div>
        )}
      </Card>

      {/* ============ 新建部署弹层 ============ */}
      {creating && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm"
          onClick={() => { if (!busy) setCreating(false) }}
        >
          <div
            className="w-[480px] max-w-[94vw] rounded-2xl border border-slate-200 bg-white p-5 shadow-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="text-base font-bold text-slate-900">新建部署</div>
              <button
                onClick={() => setCreating(false)} disabled={busy}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 disabled:opacity-50"
              ><X size={16} /></button>
            </div>
            <div className="space-y-3.5">
              <Field label="版本号" required hint="如 v2.9.0；本地状态机按「构建中 → 成功」确定性收敛">
                <Input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} placeholder="v2.9.0" />
              </Field>
              <Field label="目标环境" required>
                <Select value={form.env} onChange={(e) => setForm({ ...form, env: e.target.value as Env })} className="w-full">
                  <option value="dev">dev · 开发环境</option>
                  <option value="staging">staging · 预发环境</option>
                  <option value="prod">prod · 生产环境</option>
                </Select>
              </Field>
              <Field label="提交号（可选）"><Input value={form.commit} onChange={(e) => setForm({ ...form, commit: e.target.value })} placeholder="a3f9c21" /></Field>
              <Field label="说明（可选）"><Input value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="本次发布内容" /></Field>

              {form.env === 'prod' && (
                <div className={`rounded-lg border px-3 py-2.5 text-[11px] leading-5 ${
                  frozen ? 'border-red-200 bg-red-50 text-red-700' : 'border-brand-200 bg-brand-50 text-brand-700'
                }`}>
                  <b>生产门禁：</b>需先在 staging 成功部署同版本；每月 {freezeDays.join(' / ')} 日冻结窗口内禁止生产发布。
                  {frozen && <b className="ml-1">今日处于冻结窗口，prod 部署将被拒绝（409）。</b>}
                </div>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Btn disabled={busy} onClick={() => setCreating(false)}>取消</Btn>
              <Btn variant="primary" disabled={busy} onClick={submitCreate}>
                {busy ? <><Loader2 size={13} className="animate-spin" /> 提交中…</> : <><Plus size={13} /> 创建部署</>}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}
