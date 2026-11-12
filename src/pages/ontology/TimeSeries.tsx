import { useState } from 'react'
import { Activity, BellRing, TriangleAlert, Sparkles, Gauge, ShieldCheck, Loader2, Radio, PencilLine, Database } from 'lucide-react'
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import PageShell from '@/components/ui/PageShell'
import Btn from '@/components/ui/Btn'
import { Badge } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import { api } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'

interface Series { key: string; code: string; current: number; status: string }
interface Rule { id: string; name: string; cond: string; hitCount: number; enabled: boolean; type: string }
interface Notif { id: string; title: string; body: string; level: string; tag: string; time: string }
interface TsResp {
  series: Series[]
  points: Record<string, string | number>[]
  rules: Rule[]
  notifications: Notif[]
}

/* ---------- 真实时序采集（server/routes/platformOps.ts：/api/ops/timeseries/*） ---------- */
interface CollectResp {
  metric: string; valueKey: string; t: number; time: string
  objectCount: number; inserted: number; skipped: number; real: boolean
}
interface WriteResp {
  inserted: boolean; id: string; metric: string; objectId: string; t: number; value: number; real: boolean
}
interface RealPoint { t: number; time: string; objectId: string; value: number }
interface RealSeriesResp {
  metric: string
  count: number
  points: RealPoint[]
  series: { objectId: string; points: { t: number; value: number }[] }[]
  real: boolean
}

const RANGES = ['24h', '7d', '30d']
const LINE_COLORS = ['#f59e0b', '#3b82f6', '#10b981', '#8b5cf6']

function levelColor(level: string): 'red' | 'amber' | 'blue' | 'green' {
  if (level === 'error') return 'red'
  if (level === 'warn') return 'amber'
  if (level === 'success') return 'green'
  return 'blue'
}

/** 把真实采样点按时间聚合成一条均值曲线（每小时一个点），供 LineChart 使用 */
function buildRealChart(points: RealPoint[]): { t: number; time: string; real: number }[] {
  const byT = new Map<number, { sum: number; n: number; time: string }>()
  for (const p of points) {
    const cur = byT.get(p.t) ?? { sum: 0, n: 0, time: p.time }
    cur.sum += p.value
    cur.n += 1
    byT.set(p.t, cur)
  }
  return Array.from(byT.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([t, v]) => ({ t, time: v.time, real: Math.round((v.sum / v.n) * 10) / 10 }))
}

/**
 * 时序与告警。
 * 模拟曲线：/p10long/timeseries（基于设备健康度的确定性模拟，非真实采集）。
 * 真实曲线：/ops/timeseries/series + /ops/timeseries/collect[-from-objects]（读写 ts_points 真实采样）。
 */
export default function TimeSeries() {
  const [range, setRange] = useState('24h')
  const q = useApi<TsResp>('/p10long/timeseries')
  const [toast, setToast] = useState('')
  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2600) }
  const data = q.data

  /* 真实采集状态 */
  const [showReal, setShowReal] = useState(false)
  const [collectMetric, setCollectMetric] = useState('health')
  const [valueKey, setValueKey] = useState('health')
  const [collecting, setCollecting] = useState(false)
  const [collectResult, setCollectResult] = useState<CollectResp | null>(null)
  const realQ = useApi<RealSeriesResp>(showReal ? `/ops/timeseries/series?metric=${encodeURIComponent(collectMetric)}&limit=200` : null)

  /* 真实单条写入 */
  const [showWrite, setShowWrite] = useState(false)
  const [writing, setWriting] = useState(false)
  const [writeForm, setWriteForm] = useState({ objectId: '', value: '' })

  const realChart = buildRealChart(realQ.data?.points ?? [])

  async function toggleRule(r: Rule) {
    try {
      await api('/p10long/timeseries/rule-toggle', { method: 'POST', body: { id: r.id, enabled: !r.enabled } })
      notify(`已${r.enabled ? '停用' : '启用'}规则：${r.name}`)
      q.reload()
    } catch (e) { notify(e instanceof Error ? e.message : '操作失败') }
  }

  /** 从当前空间对象按 valueKey 批量生成真实采样点（写 ts_points） */
  async function collectFromObjects() {
    setCollecting(true)
    try {
      const r = await api<CollectResp>('/ops/timeseries/collect-from-objects', {
        method: 'POST',
        body: { metric: collectMetric.trim() || 'health', valueKey: valueKey.trim() || 'health' },
      })
      setCollectResult(r)
      notify(`✓ 真实采集完成：扫描 ${r.objectCount} 个对象，写入 ${r.inserted} 条采样点`)
      if (showReal) realQ.reload()
    } catch (e) {
      notify(e instanceof Error ? e.message : '采集失败')
    } finally {
      setCollecting(false)
    }
  }

  /** 写入单个真实采样点（写 ts_points，唯一冲突 INSERT OR IGNORE） */
  async function writePoint() {
    if (!writeForm.objectId.trim()) return notify('请填写对象 id')
    const value = Number(writeForm.value)
    if (!Number.isFinite(value)) return notify('value 必须为有效数值')
    setWriting(true)
    try {
      const r = await api<WriteResp>('/ops/timeseries/collect', {
        method: 'POST',
        body: { metric: collectMetric.trim() || 'health', objectId: writeForm.objectId.trim(), value },
      })
      notify(r.inserted ? `✓ 已写入真实采样点：${r.objectId} = ${r.value}` : '该时间点已存在采样，已跳过（INSERT OR IGNORE）')
      setWriteForm({ objectId: '', value: '' })
      if (showReal) realQ.reload()
    } catch (e) {
      notify(e instanceof Error ? e.message : '写入失败')
    } finally {
      setWriting(false)
    }
  }

  const enabledCount = (data?.rules ?? []).filter((r) => r.enabled).length

  return (
    <PageShell
      icon={Activity}
      title="时序与告警"
      subtitle="对象时序指标监控（真实采集写入 ts_points）+ 模拟曲线 + 告警规则统一管理"
      benchmark="时序监控"
      features={[
        '真实采集：从当前空间对象按字段批量生成真实采样点，落库 ts_points',
        '真实写入：支持单条采样点写入，唯一冲突用 INSERT OR IGNORE 跳过',
        '真实序列：/ops/timeseries/series 读真实点绘制曲线，明确区分模拟',
        '模拟曲线：基于设备当前健康度的确定性历史模拟（非真实采集）',
        '阈值告警：告警规则来自真实自动化规则引擎，可启停',
        '数据刷新：重新拉取本体对象最新数值',
      ]}
      actions={
        <>
          <Btn size="sm" variant="primary" onClick={collectFromObjects} disabled={collecting}>
            {collecting ? <Loader2 size={13} className="animate-spin" /> : <Radio size={13} />} 从对象采集真实采样
          </Btn>
          <Btn size="sm" variant={showReal ? 'primary' : 'secondary'} onClick={() => setShowReal((v) => !v)}>
            <Database size={13} /> {showReal ? '隐藏真实序列' : '查看真实序列'}
          </Btn>
          <Btn size="sm" onClick={() => { q.reload(); notify('已刷新设备健康度') }}><BellRing size={13} /> 刷新数据</Btn>
          <Btn size="sm" variant="primary" onClick={() => window.location.assign('/ontology/rules')}>新建告警规则</Btn>
        </>
      }
    >
      {toast && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">{toast}</div>}
      {q.loading && <div className="flex items-center gap-2 py-10 text-sm text-slate-400"><Loader2 size={14} className="animate-spin" /> 加载时序数据…</div>}

      {/* 真实采集 / 写入 面板：明确标注「真实采集」与「模拟」 */}
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              真实时序采集
              <Badge color="green" dot>真实采集 · 落库 ts_points</Badge>
            </span>
          }
          desc="采集与写入均读取/写入真实 ts_points；下方「设备健康度」曲线为模拟，二者独立"
          actions={
            <Btn size="sm" variant={showWrite ? 'primary' : 'secondary'} onClick={() => setShowWrite((v) => !v)}>
              <PencilLine size={13} /> {showWrite ? '收起写入' : '写入单点采样'}
            </Btn>
          }
        />
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[11px] text-slate-500">
            指标 metric
            <input value={collectMetric} onChange={(e) => setCollectMetric(e.target.value)} placeholder="health"
              className="w-36 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:border-brand-400" />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-slate-500">
            取值字段 valueKey
            <input value={valueKey} onChange={(e) => setValueKey(e.target.value)} placeholder="health"
              className="w-36 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:border-brand-400" />
          </label>
          <Btn size="sm" onClick={collectFromObjects} disabled={collecting}>
            {collecting ? <Loader2 size={13} className="animate-spin" /> : <Radio size={13} />} 从对象采集真实采样
          </Btn>
          <span className="text-[11px] text-slate-400">按 valueKey 读当前空间对象数值，t 按小时对齐，批量写真实采样点</span>
        </div>

        {collectResult && (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-[11px] text-emerald-700">
            <Badge color="green">最近采集（真实）</Badge>
            <span>指标 <b>{collectResult.metric}</b> · 字段 <b>{collectResult.valueKey}</b></span>
            <span>扫描对象 <b>{collectResult.objectCount}</b></span>
            <span>写入采样点 <b>{collectResult.inserted}</b></span>
            <span>跳过 <b>{collectResult.skipped}</b>（无数值或同小时已存在）</span>
            <span className="text-slate-400">对齐时间 {collectResult.time}</span>
          </div>
        )}

        {/* 单条写入表单 */}
        {showWrite && (
          <div className="mt-3 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <span className="text-[11px] font-semibold text-slate-600">写入单点采样（metric = {collectMetric || 'health'}）</span>
            <label className="flex flex-col gap-1 text-[11px] text-slate-500">
              对象 id objectId
              <input value={writeForm.objectId} onChange={(e) => setWriteForm({ ...writeForm, objectId: e.target.value })} placeholder="device:1"
                className="w-44 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:border-brand-400" />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-slate-500">
              数值 value
              <input value={writeForm.value} onChange={(e) => setWriteForm({ ...writeForm, value: e.target.value })} placeholder="88.5" type="number"
                className="w-28 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-700 outline-none focus:border-brand-400" />
            </label>
            <Btn size="sm" variant="primary" onClick={writePoint} disabled={writing}>
              {writing ? <Loader2 size={13} className="animate-spin" /> : <PencilLine size={13} />} 写入真实点
            </Btn>
            <span className="text-[11px] text-slate-400">校验对象属于当前空间；同 (metric, objectId, t) 已存在则跳过</span>
          </div>
        )}

        {/* 真实序列曲线（切换显示），与模拟曲线并列且明确标注 */}
        {showReal && (
          <div className="mt-4 rounded-lg border border-emerald-200 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-[12px] font-semibold text-slate-700">
                <Database size={13} className="text-emerald-600" /> 真实采集序列 · 指标「{collectMetric || 'health'}」
                <Badge color="green" dot>真实数据</Badge>
              </span>
              <span className="flex items-center gap-2 text-[11px] text-slate-400">
                <Btn size="sm" onClick={() => realQ.reload()}><BellRing size={12} /> 刷新真实序列</Btn>
                {realQ.data && <span>共 {realQ.data.count} 个真实采样点 · {realQ.data.series.length} 个对象</span>}
              </span>
            </div>
            {realQ.loading && <div className="flex items-center gap-2 py-8 text-xs text-slate-400"><Loader2 size={13} className="animate-spin" /> 加载真实序列…</div>}
            {realQ.error && <div className="py-6 text-center text-xs text-red-600">真实序列加载失败：{realQ.error}</div>}
            {!realQ.loading && !realQ.error && realQ.data && realQ.data.count === 0 && (
              <div className="py-8 text-center text-xs text-slate-400">
                暂无真实采样点：先点「从对象采集真实采样」或写入单点采样，再刷新真实序列。
              </div>
            )}
            {!realQ.loading && !realQ.error && realChart.length > 0 && (
              <div className="h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={realChart} margin={{ top: 8, right: 12, left: -14, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} interval="preserveStart" />
                    <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="real" name="真实采集·各对象均值" stroke="#10b981" strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="mt-2 text-[11px] leading-5 text-slate-400">
              数据来自 GET /ops/timeseries/series（读 ts_points 真实采样，按 t 聚合均值）。
              <span className="ml-1 rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700">下方「设备健康度」曲线为模拟，非真实采集</span>
            </div>
          </div>
        )}
      </Card>

      {!q.loading && data && (
        <>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            {/* 折线图（模拟） */}
            <Card>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    设备健康度（{range === '24h' ? '24 小时' : range === '7d' ? '近 7 天' : '近 30 天'}）
                    <Badge color="amber">模拟曲线</Badge>
                    <Badge color="slate">当前空间 {data.series.length} 台设备</Badge>
                  </span>
                }
                desc="以各设备当前健康度为基准生成的确定性模拟曲线（非真实采集）；红色虚线为告警阈值 60"
                actions={
                  <div className="flex items-center gap-1.5">
                    {RANGES.map((r) => (
                      <button key={r} onClick={() => setRange(r)} className={cn('rounded-full border px-3 py-1 text-xs font-medium transition-colors', range === r ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300')}>{r}</button>
                    ))}
                  </div>
                }
              />
              <div className="h-[320px] rounded-lg border border-slate-200 p-3">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.points} margin={{ top: 8, right: 12, left: -14, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} interval={2} />
                    <YAxis domain={[40, 100]} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <ReferenceLine y={60} stroke="#ef4444" strokeDasharray="6 4" label={{ value: '阈值 60', position: 'insideTopRight', fontSize: 10, fill: '#ef4444' }} />
                    {data.series.map((s, i) => (
                      <Line key={s.key} type="monotone" dataKey={s.key} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
                {data.series.map((s, i) => (
                  <div key={s.key} className="rounded-lg bg-slate-50 px-3 py-2">
                    <div className="truncate text-[11px] text-slate-400" title={s.key}>{s.key}</div>
                    <div className={cn('mt-0.5 text-base font-bold', s.current < 60 ? 'text-red-500' : s.current < 75 ? 'text-amber-600' : 'text-emerald-600')} style={{ color: s.current >= 60 && s.current >= 75 ? LINE_COLORS[i % LINE_COLORS.length] : undefined }}>{s.current}</div>
                    <div className="text-[10px] text-slate-400">{s.status} · {s.code}</div>
                  </div>
                ))}
              </div>
            </Card>

            {/* 告警规则（真实 automation_rules，可启停） */}
            <Card className="h-fit">
              <CardHeader
                title="告警规则"
                desc="来自真实自动化规则引擎，点击切换启停"
                actions={<Badge color="green" dot>{enabledCount} / {data.rules.length} 启用</Badge>}
              />
              <div className="space-y-2">
                {data.rules.length === 0 && <div className="py-6 text-center text-xs text-slate-400">暂无告警规则，可前往「规则引擎」创建</div>}
                {data.rules.map((r) => (
                  <div key={r.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', r.enabled ? 'bg-brand-50 text-brand-600' : 'bg-slate-100 text-slate-400')}>
                          {r.type === '阈值类' ? <Gauge size={14} /> : <Activity size={14} />}
                        </div>
                        <span className="truncate text-[13px] font-semibold text-slate-800">{r.name}</span>
                      </div>
                      <button onClick={() => toggleRule(r)} className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[10px]', r.enabled ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : 'border-slate-200 text-slate-400')}>
                        {r.enabled ? '启用' : '停用'}
                      </button>
                    </div>
                    <div className="space-y-1 text-[11px] leading-5 text-slate-500">
                      <div>条件：<code className="rounded bg-slate-50 px-1 py-0.5 font-mono text-[10px] text-slate-600">{r.cond || '—'}</code></div>
                    </div>
                    <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2">
                      <Badge color={r.type === '阈值类' ? 'blue' : 'violet'}>{r.type}</Badge>
                      <span className="text-[10px] text-slate-400">累计命中 {r.hitCount} 次</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* 告警事件（真实通知） */}
          <Card>
            <CardHeader
              title="近期告警事件"
              desc="来自平台真实通知中心"
              actions={<span className="flex items-center gap-1 text-[11px] text-slate-400"><ShieldCheck size={12} /> 共 {data.notifications.length} 条</span>}
            />
            {data.notifications.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">暂无告警事件</div>
            ) : (
              <div className="space-y-2">
                {data.notifications.map((n) => (
                  <div key={n.id} className="flex items-start gap-3 rounded-lg border border-slate-100 px-3 py-2.5">
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                      {n.level === 'error' ? <TriangleAlert size={14} className="text-red-500" /> : n.level === 'warn' ? <Sparkles size={14} className="text-amber-500" /> : <BellRing size={14} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-semibold text-slate-700">{n.title}</span>
                        <Badge color={levelColor(n.level)}>{n.tag}</Badge>
                      </div>
                      {n.body && <div className="mt-0.5 text-[11px] text-slate-500">{n.body}</div>}
                    </div>
                    <span className="shrink-0 text-[10px] text-slate-400">{n.time}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </PageShell>
  )
}
