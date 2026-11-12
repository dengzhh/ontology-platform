import { useEffect, useMemo, useState } from 'react'
import {
  Route, Zap, RefreshCw, Loader2, UserRound, ClipboardCheck, Clock,
  CheckCircle2, AlertTriangle, XCircle, ArrowRight, Activity, FileText,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import PageShell from '@/components/ui/PageShell'
import { Badge, type BadgeColor } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import { KVList, SectionTitle } from '@/components/ui/Misc'
import Btn from '@/components/ui/Btn'
import FlowCanvas, { type FlowNode, type FlowEdge, type FlowStatus } from '@/components/canvas/FlowCanvas'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'

/* ---------------- 类型（与后端返回结构对齐） ---------------- */

interface RecentExec { actor: string; status: string; target: string; time: string }
interface Flow {
  id: string
  name: string
  desc: string
  needsApproval: boolean
  targetTypeName: string
  execCount: number
  pendingCount: number
  recentExecs: RecentExec[]
}
interface RecentLog { actionName: string; status: string; actor: string; target: string; time: string }
interface MachineryResp { flows: Flow[]; recentLogs: RecentLog[] }

/* ---------------- 状态 → 展示映射（非业务数据） ---------------- */

const STATUS_LABEL: Record<string, string> = {
  done: '已完成', pending_approval: '待审批', rejected: '已驳回', failed: '失败',
}
const STATUS_BADGE: Record<string, BadgeColor> = {
  done: 'green', pending_approval: 'amber', rejected: 'red', failed: 'red',
}
const STATUS_FLOW: Record<string, FlowStatus> = {
  done: 'ok', pending_approval: 'warn', rejected: 'err', failed: 'err',
}

function statusText(s: string): string { return STATUS_LABEL[s] ?? s }
function statusBadge(s: string): BadgeColor { return STATUS_BADGE[s] ?? 'slate' }
function statusFlow(s: string): FlowStatus { return STATUS_FLOW[s] ?? 'run' }

/** 流程编排：动作链列表、执行统计与最近日志均来自服务端真实数据 */
export default function Machinery() {
  const q = useApi<MachineryResp>('/p10plus/machinery')
  const flows = q.data?.flows ?? []
  const recentLogs = q.data?.recentLogs ?? []

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null)
  function notify(text: string, error = false) {
    setToast({ text, error })
    setTimeout(() => setToast(null), 2800)
  }
  useEffect(() => {
    if (q.error) notify(q.error, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.error])

  const flow = flows.find((f) => f.id === selectedId) ?? flows[0] ?? null

  /* 画布：由选中动作链的真实字段 + 其近期执行记录生成 */
  const { nodes, edges } = useMemo(() => {
    const nodes: FlowNode[] = []
    const edges: FlowEdge[] = []
    if (!flow) return { nodes, edges }

    nodes.push({
      id: 'action',
      x: 40, y: 90,
      title: flow.name,
      subtitle: flow.desc || `目标类型：${flow.targetTypeName}`,
      icon: Zap,
      accent: 'bg-brand-50 text-brand-600',
      badge: flow.needsApproval ? '需审批' : undefined,
      status: flow.pendingCount > 0 ? 'warn' : 'ok',
    })

    flow.recentExecs.slice(0, 3).forEach((ex, i) => {
      const id = `ex${i}`
      nodes.push({
        id,
        x: 40 + (i + 1) * 250,
        y: 90,
        title: `${statusText(ex.status)} · ${ex.actor || '系统'}`,
        subtitle: `${ex.target} · ${ex.time}`,
        icon: ex.status === 'done' ? CheckCircle2 : ex.status === 'pending_approval' ? ClipboardCheck : XCircle,
        accent: ex.status === 'done' ? 'bg-emerald-50 text-emerald-600' : ex.status === 'pending_approval' ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500',
        status: statusFlow(ex.status),
      })
      edges.push({ from: i === 0 ? 'action' : `ex${i - 1}`, to: id, label: i === 0 ? '执行' : undefined })
    })

    return { nodes, edges }
  }, [flow])

  const totalExec = flows.reduce((s, f) => s + f.execCount, 0)
  const totalPending = flows.reduce((s, f) => s + f.pendingCount, 0)

  return (
    <PageShell
      icon={Route}
      title="流程编排"
      subtitle="理解、管理与观测跨对象的动作链：执行统计、待审批与近期执行均来自真实动作日志"
      benchmark="流程编排"
      features={[
        '动作链列表：每个本体动作类型即一条流程，来自服务端 actionTypes',
        '执行统计：已完成次数 / 待审批次数由真实动作日志聚合',
        '近期执行：每条动作链最近的真实执行记录（操作人 / 状态 / 对象 / 时间）',
        '审批标识：需人工审批的动作链明确标注，待审批数量实时可见',
        '最近日志：全局动作执行日志（动作名 / 状态 / 操作人 / 对象 / 时间）',
        '刷新：重新拉取服务端数据，不做本地假状态切换',
      ]}
      actions={
        <Btn size="sm" variant="primary" onClick={() => { notify('正在刷新流程数据…'); q.reload() }}><RefreshCw size={13} /> 刷新</Btn>
      }
    >
      {toast && (
        <div className={cn('rounded-lg border px-4 py-2.5 text-sm font-medium', toast.error ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700')}>
          {toast.text}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)_320px]">
        {/* 左：流程列表（真实 flows） */}
        <Card padding={false} className="h-fit">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2.5">
            <span className="text-xs font-semibold text-slate-500">动作链 / 流程</span>
            <Badge color="slate">{flows.length} 条</Badge>
          </div>
          <div className="p-2">
            {q.loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-xs text-slate-400"><Loader2 size={13} className="animate-spin" /> 加载流程…</div>
            ) : q.error ? (
              <div className="m-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-2 text-[11px] text-amber-700">{q.error}</div>
            ) : flows.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">当前空间暂无动作类型</div>
            ) : flows.map((f) => (
              <button
                key={f.id}
                onClick={() => setSelectedId(f.id)}
                className={cn(
                  'mb-1 flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2.5 text-left',
                  flow?.id === f.id ? 'bg-brand-50' : 'hover:bg-slate-50',
                )}
              >
                <div className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', flow?.id === f.id ? 'bg-brand-100 text-brand-600' : 'bg-slate-100 text-slate-400')}>
                  <Zap size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className={cn('text-[13px] font-semibold', flow?.id === f.id ? 'text-brand-700' : 'text-slate-700')}>{f.name}</div>
                  <div className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-slate-400">{f.desc || '（无描述）'}</div>
                  <div className="mt-1 flex items-center gap-1.5">
                    {f.needsApproval && <Badge color="amber">需审批</Badge>}
                    <span className="text-[10px] text-slate-400">完成 {f.execCount} · 待审批 {f.pendingCount}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </Card>

        {/* 中：选中流程详情 + 真实执行画布 */}
        <Card>
          {!flow ? (
            <div className="flex min-h-[280px] items-center justify-center text-sm text-slate-400">暂无动作链数据</div>
          ) : (
            <>
              <CardHeader
                title={<span className="flex items-center gap-2">{flow.name} · 动作链 <Badge color="blue">{flow.recentExecs.length} 条近期执行</Badge></span>}
                desc={flow.desc || `目标类型：${flow.targetTypeName}`}
                actions={flow.needsApproval ? <Badge color="amber" dot>需审批</Badge> : <Badge color="green" dot>自动执行</Badge>}
              />
              <FlowCanvas nodes={nodes} edges={edges} width={1100} height={220} />
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { label: '目标对象类型', value: flow.targetTypeName },
                  { label: '已完成执行', value: flow.execCount },
                  { label: '待审批', value: flow.pendingCount },
                  { label: '近期执行记录', value: flow.recentExecs.length },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg bg-slate-50 px-3 py-2">
                    <div className="text-[11px] text-slate-400">{s.label}</div>
                    <div className="mt-0.5 truncate text-base font-bold text-slate-800" title={String(s.value)}>{s.value}</div>
                  </div>
                ))}
              </div>

              {/* 该流程的 recentExecs 明细 */}
              <div className="mt-4">
                <SectionTitle>近期执行（{flow.name}）</SectionTitle>
                {flow.recentExecs.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-200 p-3 text-center text-xs text-slate-400">该动作链暂无执行记录</div>
                ) : (
                  <div className="space-y-1.5">
                    {flow.recentExecs.map((ex, i) => (
                      <div key={i} className="flex items-center gap-2.5 rounded-lg border border-slate-100 px-3 py-2">
                        <UserRound size={13} className="shrink-0 text-slate-300" />
                        <span className="w-20 shrink-0 truncate text-xs text-slate-600" title={ex.actor}>{ex.actor || '系统'}</span>
                        <Badge color={statusBadge(ex.status)} dot>{statusText(ex.status)}</Badge>
                        <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500" title={ex.target}>{ex.target}</span>
                        <span className="shrink-0 text-[11px] text-slate-400">{ex.time}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </Card>

        {/* 右：全局最近日志（recentLogs） */}
        <Card className="h-fit">
          <CardHeader
            title={<span className="flex items-center gap-1.5"><Activity size={14} className="text-cyan-500" />最近日志</span>}
            desc="全部动作链的真实执行日志（最近 8 条）"
            actions={<Badge color="slate">{recentLogs.length} 条</Badge>}
          />
          <div className="mb-3 grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-emerald-50 px-3 py-2">
              <div className="text-[11px] text-emerald-600">累计完成</div>
              <div className="text-lg font-bold text-emerald-700">{totalExec}</div>
            </div>
            <div className="rounded-lg bg-amber-50 px-3 py-2">
              <div className="text-[11px] text-amber-600">累计待审批</div>
              <div className="text-lg font-bold text-amber-700">{totalPending}</div>
            </div>
          </div>

          <SectionTitle>执行明细</SectionTitle>
          {recentLogs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 p-3 text-center text-xs text-slate-400">暂无动作执行日志</div>
          ) : (
            <div className="space-y-1.5">
              {recentLogs.map((l, i) => (
                <div key={i} className="rounded-lg border border-slate-100 px-2.5 py-2">
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="flex min-w-0 items-center gap-1.5 text-[12px] font-semibold text-slate-700">
                      <FileText size={12} className="shrink-0 text-slate-300" />
                      <span className="truncate" title={l.actionName}>{l.actionName}</span>
                    </span>
                    <Badge color={statusBadge(l.status)}>{statusText(l.status)}</Badge>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 pl-4 text-[11px] text-slate-400">
                    <span className="shrink-0">{l.actor || '系统'}</span>
                    <ArrowRight size={10} className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate" title={l.target}>{l.target}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1 pl-4 text-[10px] text-slate-300"><Clock size={10} /> {l.time}</div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 flex items-start gap-1.5 rounded-lg border border-slate-100 bg-slate-50/70 p-2.5 text-[11px] leading-5 text-slate-400">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            日志与统计均来自服务端动作日志表；动作编排 / 步骤编辑暂未接入后端写接口，故不提供对应操作按钮。
          </div>
        </Card>
      </div>
    </PageShell>
  )
}
