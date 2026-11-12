import { useState } from 'react'
import {
  CalendarClock, Gauge, PackageCheck, TriangleAlert, Cog, Star, Lightbulb,
  CheckCircle2, RefreshCw, Loader2, Play, Plus, Trash2, X, Wrench, Layers3,
  Sparkles, Database, ListChecks, Ban, Info, Clock,
} from 'lucide-react'
import PageShell from '@/components/ui/PageShell'
import Btn from '@/components/ui/Btn'
import StatCard from '@/components/ui/StatCard'
import { Badge } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import DataTable, { type Column } from '@/components/ui/DataTable'
import Tabs from '@/components/ui/Tabs'
import { Input, Select, Field } from '@/components/ui/Form'
import GanttView, { type GanttRow } from '@/components/canvas/GanttView'
import { api } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'

/* ---------------- 类型（与 server/routes/scheduling.ts 返回结构对齐） ---------------- */

interface ScheduleTask {
  id: string
  line: string
  batch: string
  product: string
  customer: string
  priority: number
  qty: number
  durationH: number
  startDay: number
  startHour: number
  status: string // 已排 / 建议 / 已应用 / 已归档
  planId: string
  spaceId: string
  createdAt: number
}
interface Constraints {
  engine: string
  method: string
  capacityHoursPerLineDay: number
  horizonDays: number
  dayStartHour: number
  maintenance: { line: string; day: number; hours: number; effect: string }
  softRules: string[]
  aCustomers: string[]
  dueDayByPriority: Record<number, number>
}
interface Metrics {
  utilization: number
  onTimeRate: number
  lateCount: number
  taskCount: number
  placedHours: number
}
interface TasksResp { tasks: ScheduleTask[]; constraints: Constraints }
interface Suggestion {
  taskId: string; batch: string; line: string
  startDay: number; startHour: number; durationH: number; reason: string
}
interface Conflict {
  taskId: string; batch: string; line: string; durationH: number; reason: string
}
interface SolveResp {
  planId: string
  placed: number
  conflicts: Conflict[]
  suggestions: Suggestion[]
  metrics: { utilization: number; onTimeRate: number }
  constraints: Constraints
}
interface SeedResp { count: number; lines: string[] }
interface ApplyResp { planId: string; applied: number; archived: number }
interface TaskResp { task: ScheduleTask }

interface NewTaskForm {
  line: string; batch: string; product: string; customer: string
  priority: number; qty: number; durationH: number
}
const EMPTY_FORM: NewTaskForm = {
  line: '', batch: '', product: '', customer: '', priority: 2, qty: 0, durationH: 8,
}

/* ---------------- 展示常量（非业务数据） ---------------- */

const TIMELINE = Array.from({ length: 7 }, (_, i) => `第${i + 1}天`)
const STATUS_COLOR: Record<string, 'blue' | 'green' | 'amber' | 'slate'> = {
  已排: 'blue', 建议: 'amber', 已应用: 'green', 已归档: 'slate',
}
const PRIORITY_COLOR: Record<number, 'red' | 'amber' | 'slate'> = { 1: 'red', 2: 'amber', 3: 'slate' }
const LINE_OPTIONS = ['F1 注塑 A 线', 'F1 注塑 B 线', 'F2 精密线', 'SZ 组装线', 'NB 冲压线']

/** 按 status / priority 给甘特条配色（颜色仅作视觉区分，非业务数据） */
function barColor(t: ScheduleTask): string {
  if (t.status === '建议') return 'bg-amber-500'
  if (t.status === '已应用') return 'bg-emerald-500'
  if (t.priority === 1) return 'bg-brand-500'
  if (t.priority === 2) return 'bg-violet-500'
  return 'bg-cyan-500'
}

/**
 * 真实任务 → GanttRow：按 line 分组；startDay/startHour/durationH 映射为 0-100 百分比。
 * 7 天等分（每天 100/7%），每天 24h 容量，startHour 以 8:00 为基准。
 */
function toGanttRows(rows: ScheduleTask[], capacityH: number): GanttRow[] {
  const dayPct = 100 / 7
  const lines = Array.from(new Set(rows.map((r) => r.line))).sort((a, b) => a.localeCompare(b, 'zh'))
  return lines.map((line) => {
    const inLine = rows.filter((r) => r.line === line)
    return {
      name: line,
      sub: `${inLine.length} 个批次 · 日产能上限 ${capacityH}h`,
      bars: inLine.map((r) => {
        const rawStart = (r.startDay + (r.startHour - 8) / 24) * dayPct
        // 预留 1.5% 最小条宽，避免 start + span 超过 100% 冲出行
        const start = Math.max(0, Math.min(rawStart, 98.5))
        const span = Math.max(1.5, Math.min((r.durationH / 24) * dayPct, 100 - start))
        return {
          start, span,
          label: `${r.batch} · ${r.product || '未命名'}${r.customer ? ` · ${r.customer}` : ''}（${r.durationH}h / P${r.priority}）`,
          color: barColor(r),
        }
      }),
    }
  })
}

/** 动态调度：真实任务 CRUD + 本地启发式贪心求解（非 COPT/OR-Tools），结果全部来自 /scheduling API */
export default function Scheduling() {
  const q = useApi<TasksResp>('/scheduling/tasks')
  const m = useApi<Metrics>('/scheduling/metrics')

  const tasks = q.data?.tasks ?? []
  const constraints = q.data?.constraints ?? null
  const metrics = m.data
  const activeTasks = tasks.filter((t) => t.status === '已排' || t.status === '已应用')
  const suggestionTasks = tasks.filter((t) => t.status === '建议')

  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null)
  function notify(text: string, error = false) {
    setToast({ text, error })
    setTimeout(() => setToast(null), 3200)
  }
  function reloadAll() { q.reload(); m.reload() }

  const [busy, setBusy] = useState<string | null>(null)
  const [solveResult, setSolveResult] = useState<SolveResp | null>(null)
  const [ganttView, setGanttView] = useState<'active' | 'suggestion'>('active')
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<NewTaskForm>(EMPTY_FORM)
  const [formErr, setFormErr] = useState('')

  /** 当前可应用的方案：本次求解结果，或库里遗留的未应用建议批次（刷新后仍可应用） */
  const currentPlanId = solveResult?.planId || suggestionTasks[0]?.planId || ''
  const patchForm = (p: Partial<NewTaskForm>) => setForm((f) => ({ ...f, ...p }))

  /* ---------------- 顶部三大操作 ---------------- */

  async function seedTasks() {
    setBusy('seed')
    try {
      const r = await api<SeedResp>('/scheduling/seed', { method: 'POST' })
      setSolveResult(null)
      setGanttView('active')
      reloadAll()
      notify(`已生成 ${r.count} 条演示排程任务（${r.lines.length} 条产线）`)
    } catch (e) {
      notify(e instanceof Error ? e.message : '生成失败', true)
    } finally {
      setBusy(null)
    }
  }

  async function runSolve() {
    setBusy('solve')
    try {
      const r = await api<SolveResp>('/scheduling/solve', { method: 'POST' })
      setSolveResult(r)
      setGanttView('suggestion')
      reloadAll()
      notify(`求解完成：落位 ${r.placed} 个批次，冲突 ${r.conflicts.length} 个`)
    } catch (e) {
      notify(e instanceof Error ? e.message : '求解失败', true)
    } finally {
      setBusy(null)
    }
  }

  async function applyPlan() {
    if (!currentPlanId) { notify('暂无可应用的建议方案，请先运行求解', true); return }
    setBusy('apply')
    try {
      const r = await api<ApplyResp>(`/scheduling/apply/${encodeURIComponent(currentPlanId)}`, { method: 'POST' })
      setSolveResult(null)
      setGanttView('active')
      reloadAll()
      notify(`已应用 ${r.applied} 条建议，归档原排程 ${r.archived} 条，列表已刷新`)
    } catch (e) {
      notify(e instanceof Error ? e.message : '应用失败', true)
    } finally {
      setBusy(null)
    }
  }

  /* ---------------- 任务新建 / 删除 ---------------- */

  function openModal() {
    setForm(EMPTY_FORM)
    setFormErr('')
    setModalOpen(true)
  }

  async function createTask() {
    if (!form.line.trim() || !form.batch.trim()) {
      setFormErr('产线与批次为必填项')
      return
    }
    setFormErr('')
    setBusy('create')
    try {
      await api<TaskResp>('/scheduling/tasks', {
        method: 'POST',
        body: {
          line: form.line.trim(), batch: form.batch.trim(),
          product: form.product.trim(), customer: form.customer.trim(),
          priority: form.priority, qty: form.qty, durationH: form.durationH,
        },
      })
      setModalOpen(false)
      reloadAll()
      notify('排程任务已创建（待求解）')
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : '创建失败')
    } finally {
      setBusy(null)
    }
  }

  async function deleteTask(id: string) {
    setBusy(`del:${id}`)
    try {
      await api(`/scheduling/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' })
      setConfirmDelId(null)
      reloadAll()
      notify('排程任务已删除')
    } catch (e) {
      notify(e instanceof Error ? e.message : '删除失败', true)
    } finally {
      setBusy(null)
    }
  }

  /* ---------------- 甘特（真实任务） ---------------- */

  const capacityH = constraints?.capacityHoursPerLineDay ?? 24
  const ganttRows = toGanttRows(ganttView === 'active' ? activeTasks : suggestionTasks, capacityH)
  const ganttEmpty = ganttRows.length === 0

  const taskColumns: Column<ScheduleTask>[] = [
    { key: 'batch', header: '批次', cell: (r) => <span className="font-semibold text-slate-800">{r.batch}</span> },
    { key: 'line', header: '产线', cell: (r) => <span className="text-xs text-slate-600">{r.line}</span> },
    { key: 'product', header: '产品 / 客户', cell: (r) => (
      <div className="text-xs text-slate-600">{r.product || '—'}{r.customer && <span className="text-slate-400"> · {r.customer}</span>}</div>
    ) },
    { key: 'priority', header: '优先级', align: 'center', cell: (r) => <Badge color={PRIORITY_COLOR[r.priority] ?? 'slate'}>P{r.priority}</Badge> },
    { key: 'qty', header: '数量', align: 'right', cell: (r) => <span className="text-xs text-slate-600">{r.qty}</span> },
    { key: 'durationH', header: '时长', align: 'right', cell: (r) => <span className="text-xs text-slate-600">{r.durationH}h</span> },
    { key: 'window', header: '排程窗口', cell: (r) => <span className="text-[11px] text-slate-500">第{r.startDay + 1}天 {r.startHour}:00</span> },
    { key: 'status', header: '状态', cell: (r) => <Badge color={STATUS_COLOR[r.status] ?? 'slate'} dot>{r.status}</Badge> },
    {
      key: 'ops', header: '操作', align: 'right', cell: (r) => (
        <div className="flex items-center justify-end gap-1.5">
          {confirmDelId === r.id ? (
            <>
              <Btn size="sm" variant="danger" disabled={busy === `del:${r.id}`} onClick={() => deleteTask(r.id)}>
                {busy === `del:${r.id}` ? <Loader2 size={12} className="animate-spin" /> : null} 确认删除
              </Btn>
              <Btn size="sm" variant="ghost" onClick={() => setConfirmDelId(null)}>取消</Btn>
            </>
          ) : (
            <button
              onClick={() => setConfirmDelId(r.id)}
              className="rounded-lg border border-slate-200 p-2 text-slate-400 transition-colors hover:border-red-200 hover:text-red-500"
              title="删除该任务"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      ),
    },
  ]

  return (
    <PageShell
      icon={CalendarClock}
      title="动态调度"
      subtitle="本地启发式求解（贪心 + 约束校验），可升级为 COPT/OR-Tools 精确求解器"
      benchmark="调度优化"
      features={[
        '真实排程任务：/scheduling/tasks 读写 SQLite，按空间隔离并全量留审计',
        '本地启发式求解：按 (priority 升序 → A级客户优先 → qty 降序) 贪心寻找最早可用窗口',
        '硬约束校验：每产线每日产能上限 24h、F2 精密线第 3 天 4h 检修窗口',
        '冲突如实列出：7 天内无法落位的任务不假装排下，单独列为冲突',
        '方案闭环：生成「建议」批次 → 应用方案（建议转已应用、原排程归档）→ 刷新真实指标',
        '升级路径：接口形状不变前提下可替换为 COPT/OR-Tools 精确求解器',
      ]}
      actions={
        <>
          <Btn size="sm" onClick={() => reloadAll()} disabled={busy !== null}><RefreshCw size={13} /> 刷新</Btn>
          <Btn size="sm" onClick={seedTasks} disabled={busy !== null}>
            {busy === 'seed' ? <Loader2 size={13} className="animate-spin" /> : <Database size={13} />} 生成演示任务
          </Btn>
          <Btn size="sm" variant="primary" onClick={runSolve} disabled={busy !== null}>
            {busy === 'solve' ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} 运行求解
          </Btn>
          <Btn size="sm" variant="secondary" onClick={applyPlan} disabled={busy !== null || !currentPlanId} title={currentPlanId ? `应用方案 ${currentPlanId}` : '请先运行求解'}>
            {busy === 'apply' ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} 应用方案
          </Btn>
        </>
      }
    >
      {toast && (
        <div className={cn('rounded-lg border px-4 py-2.5 text-sm font-medium', toast.error ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700')}>
          {toast.text}
        </div>
      )}

      {/* 统计卡：全部来自 GET /scheduling/metrics 真实计算 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="设备利用率" value={metrics?.utilization ?? 0} unit="%" icon={Gauge} footer="已占用工时 / 已用产线日可用产能" />
        <StatCard label="准时交付率" value={metrics?.onTimeRate ?? 0} unit="%" icon={PackageCheck} iconClass="bg-emerald-50 text-emerald-600" footer="按优先级承诺日判定（P1≤第2天 / P2≤第4天 / P3≤第6天）" />
        <StatCard label="延期任务" value={metrics?.lateCount ?? 0} icon={TriangleAlert} iconClass="bg-amber-50 text-amber-600" footer="开工日晚于承诺日的生效任务数" />
        <StatCard label="任务总数" value={metrics?.taskCount ?? 0} icon={Layers3} iconClass="bg-violet-50 text-violet-600" footer={`已排 / 已应用合计 · 累计 ${metrics?.placedHours ?? 0}h`} />
      </div>

      {/* 甘特图：真实任务按 line / startDay / startHour 映射 */}
      <Card>
        <CardHeader
          title="排程甘特（7 天视界）"
          desc="产线 × 时间维度可视化，数据来自当前空间真实排程任务；颜色区分状态与优先级"
          actions={
            <Tabs
              size="sm"
              active={ganttView}
              onChange={(k) => setGanttView(k as 'active' | 'suggestion')}
              tabs={[
                { key: 'active', label: '当前排程', count: activeTasks.length },
                { key: 'suggestion', label: '建议方案', count: suggestionTasks.length },
              ]}
            />
          }
        />
        <div className="mb-3 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
          {[
            { c: 'bg-brand-500', t: '已排 P1' },
            { c: 'bg-violet-500', t: '已排 P2' },
            { c: 'bg-cyan-500', t: '已排 P3' },
            { c: 'bg-amber-500', t: '建议' },
            { c: 'bg-emerald-500', t: '已应用' },
          ].map((l) => (
            <span key={l.t} className="flex items-center gap-1"><span className={cn('h-2 w-2 rounded-sm', l.c)} />{l.t}</span>
          ))}
          <span className="ml-auto text-slate-400">横轴刻度 = 日（每天 24h 产能，8:00 起排）</span>
        </div>
        {q.loading ? (
          <div className="flex items-center justify-center gap-2 py-14 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" /> 加载排程任务…</div>
        ) : q.error ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">{q.error}</div>
        ) : ganttEmpty ? (
          <div className="py-12 text-center text-sm text-slate-400">
            {ganttView === 'suggestion' ? '暂无建议方案，请点击「运行求解」生成' : '暂无排程任务，请点击「生成演示任务」或「新建任务」'}
          </div>
        ) : (
          <GanttView rows={ganttRows} timeline={TIMELINE} />
        )}
      </Card>

      {/* 约束条件（后端真实约束） + 优化建议（solve 结果） */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="约束条件"
            desc="求解器实际执行的硬/软约束（来自后端，非演示数据）"
            actions={<Badge color="amber">{constraints?.engine ?? '本地启发式求解（非 COPT/OR-Tools）'}</Badge>}
          />
          {constraints ? (
            <div className="space-y-2">
              <div className="flex items-start gap-3 rounded-lg border border-slate-100 px-3 py-2.5">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500"><Cog size={14} /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold text-slate-700">设备产能上限</span>
                    <Badge color="red">硬约束</Badge>
                  </div>
                  <div className="mt-0.5 text-[11px] leading-5 text-slate-500">
                    每条产线每日总时长 ≤ {constraints.capacityHoursPerLineDay}h；排程视界 {constraints.horizonDays} 天，每日 {constraints.dayStartHour}:00 起按累计占用小时顺延。
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-lg border border-slate-100 px-3 py-2.5">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500"><Wrench size={14} /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold text-slate-700">检修窗口</span>
                    <Badge color="red">硬约束</Badge>
                  </div>
                  <div className="mt-0.5 text-[11px] leading-5 text-slate-500">{constraints.maintenance.effect}</div>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-lg border border-slate-100 px-3 py-2.5">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500"><Star size={14} /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold text-slate-700">排产优先级 / A 级客户</span>
                    <Badge color="blue">软约束</Badge>
                  </div>
                  <ul className="mt-1 space-y-0.5 text-[11px] leading-5 text-slate-500">
                    {constraints.softRules.map((s) => <li key={s}>· {s}</li>)}
                  </ul>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-lg border border-slate-100 px-3 py-2.5">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500"><Clock size={14} /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold text-slate-700">交付承诺日</span>
                    <Badge color="blue">软约束</Badge>
                  </div>
                  <div className="mt-0.5 text-[11px] leading-5 text-slate-500">P1 ≤ 第2天、P2 ≤ 第4天、P3 ≤ 第6天开工；用于准时交付率与延期数计算。</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-slate-400">约束信息加载中…</div>
          )}
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-brand-100 bg-brand-50/60 p-3 text-[11px] leading-5 text-brand-800">
            <Info size={14} className="mt-0.5 shrink-0" />
            当前为<strong>本地启发式求解（非 COPT/OR-Tools）</strong>：贪心 + 约束校验，保证给出可行解但不保证全局最优；接口形状不变即可升级为精确求解器。
          </div>
        </Card>

        <Card>
          <CardHeader
            title="优化建议"
            desc="POST /scheduling/solve 返回的落位建议与真实冲突"
            actions={
              solveResult ? (
                <div className="flex items-center gap-1.5">
                  <Badge color="green">落位 {solveResult.placed}</Badge>
                  <Badge color={solveResult.conflicts.length ? 'red' : 'slate'}>冲突 {solveResult.conflicts.length}</Badge>
                </div>
              ) : <Badge color="slate">尚未求解</Badge>
            }
          />
          {!solveResult ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Sparkles size={22} className="text-slate-300" />
              <div className="text-sm font-medium text-slate-500">暂无候选方案</div>
              <div className="max-w-xs text-[12px] leading-5 text-slate-400">点击右上角「运行求解」，本地启发式引擎会基于真实「已排 / 已应用」任务生成建议批次与冲突清单。</div>
              <Btn size="sm" variant="primary" className="mt-1" disabled={busy !== null} onClick={runSolve}>
                {busy === 'solve' ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} 运行求解
              </Btn>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-xl border border-brand-100 bg-brand-50/50 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <Lightbulb size={15} className="text-brand-500" />
                  <span className="text-sm font-bold text-slate-800">方案 {solveResult.planId.slice(0, 14)}…</span>
                  <Badge color="blue">建议批次已写入库</Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-white/70 py-2">
                    <div className="text-lg font-bold text-slate-800">{solveResult.placed}</div>
                    <div className="text-[10px] text-slate-500">落位批次</div>
                  </div>
                  <div className="rounded-lg bg-white/70 py-2">
                    <div className="text-lg font-bold text-emerald-600">{solveResult.metrics.utilization}%</div>
                    <div className="text-[10px] text-slate-500">设备利用率</div>
                  </div>
                  <div className="rounded-lg bg-white/70 py-2">
                    <div className="text-lg font-bold text-emerald-600">{solveResult.metrics.onTimeRate}%</div>
                    <div className="text-[10px] text-slate-500">准时交付率</div>
                  </div>
                </div>
                <div className="mt-2.5 flex items-center gap-2">
                  <Btn size="sm" variant="primary" disabled={busy !== null} onClick={applyPlan}>
                    {busy === 'apply' ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} 应用方案并刷新
                  </Btn>
                  <span className="text-[11px] text-slate-400">应用后建议转「已应用」，原排程归档</span>
                </div>
              </div>

              {solveResult.conflicts.length > 0 && (
                <div>
                  <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-red-600"><Ban size={13} /> 冲突（7 天内无法落位，如实列出）</div>
                  <div className="space-y-1.5">
                    {solveResult.conflicts.map((cf) => (
                      <div key={cf.taskId} className="rounded-lg border border-red-100 bg-red-50/60 px-3 py-2">
                        <div className="flex items-center gap-2 text-[12px] font-semibold text-slate-700">
                          {cf.batch} <span className="font-normal text-slate-400">· {cf.line} · {cf.durationH}h</span>
                        </div>
                        <div className="mt-0.5 text-[11px] leading-5 text-red-600">{cf.reason}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-600"><ListChecks size={13} /> 落位建议（{solveResult.suggestions.length}）</div>
                {solveResult.suggestions.length === 0 ? (
                  <div className="py-3 text-center text-xs text-slate-400">无落位建议</div>
                ) : (
                  <div className="max-h-64 space-y-1.5 overflow-auto pr-1">
                    {solveResult.suggestions.map((s) => (
                      <div key={s.taskId} className="flex items-start gap-2 rounded-lg border border-slate-100 px-3 py-2 text-[12px]">
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />
                        <div className="min-w-0 flex-1">
                          <span className="font-semibold text-slate-700">{s.batch}</span>
                          <span className="text-slate-400"> · 第{s.startDay + 1}天 {s.startHour}:00 · {s.durationH}h</span>
                          <div className="mt-0.5 text-[11px] leading-5 text-slate-500">{s.reason}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* 真实任务列表：新建 + 删除确认/取消 */}
      <Card>
        <CardHeader
          title={`排程任务列表（${tasks.length}）`}
          desc={`当前空间全部任务（含建议 / 已归档）· 生效 ${activeTasks.length} 条 · 建议 ${suggestionTasks.length} 条`}
          actions={
            <Btn size="sm" variant="primary" onClick={openModal}><Plus size={13} /> 新建任务</Btn>
          }
        />
        {q.loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" /> 加载任务…</div>
        ) : (
          <DataTable<ScheduleTask>
            columns={taskColumns}
            rows={tasks}
            rowKey={(r) => r.id}
            dense
            maxHeight="max-h-[420px]"
          />
        )}
      </Card>

      {/* 新建任务弹层 */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={() => setModalOpen(false)}>
          <div className="w-[560px] max-w-[96vw] rounded-2xl border border-slate-200 bg-white p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div className="text-base font-bold text-slate-900">新建排程任务</div>
              <button onClick={() => setModalOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={16} /></button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="产线" required>
                <Select className="w-full" value={form.line} onChange={(e) => patchForm({ line: e.target.value })}>
                  <option value="">请选择产线</option>
                  {LINE_OPTIONS.map((l) => <option key={l} value={l}>{l}</option>)}
                </Select>
              </Field>
              <Field label="批次号" required>
                <Input value={form.batch} onChange={(e) => patchForm({ batch: e.target.value })} placeholder="如 BT-2701" />
              </Field>
              <Field label="产品">
                <Input value={form.product} onChange={(e) => patchForm({ product: e.target.value })} placeholder="如 外壳" />
              </Field>
              <Field label="客户">
                <Input value={form.customer} onChange={(e) => patchForm({ customer: e.target.value })} placeholder="如 广州鹏程（A 级）" />
              </Field>
              <Field label="优先级">
                <Select className="w-full" value={form.priority} onChange={(e) => patchForm({ priority: Number(e.target.value) })}>
                  <option value={1}>P1（最高）</option>
                  <option value={2}>P2</option>
                  <option value={3}>P3</option>
                </Select>
              </Field>
              <Field label="数量">
                <Input type="number" min={0} value={form.qty} onChange={(e) => patchForm({ qty: Number(e.target.value) })} />
              </Field>
              <Field label="时长（h）" hint="超过单日产能 24h 的任务求解时会如实列为冲突">
                <Input type="number" min={1} value={form.durationH} onChange={(e) => patchForm({ durationH: Number(e.target.value) })} />
              </Field>
            </div>
            {formErr && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{formErr}</div>}
            <div className="mt-5 flex items-center justify-between">
              <span className="text-[11px] text-slate-400">新任务默认落在第 1 天 8:00，运行求解后重新落位</span>
              <div className="flex gap-2">
                <Btn onClick={() => setModalOpen(false)}>取消</Btn>
                <Btn variant="primary" disabled={busy === 'create'} onClick={createTask}>
                  {busy === 'create' ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} 创建
                </Btn>
              </div>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}
