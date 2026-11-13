import { useMemo, useState } from 'react'
import {
  FlaskConical, Play, Plus, RotateCw, Loader2, X, Trash2, RefreshCw,
  BarChart3, Info, Timer,
} from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import PageShell from '@/components/ui/PageShell'
import Btn from '@/components/ui/Btn'
import { Badge } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import DataTable, { type Column } from '@/components/ui/DataTable'
import Tabs from '@/components/ui/Tabs'
import { Input, Field } from '@/components/ui/Form'
import { KVList } from '@/components/ui/Misc'
import { api } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'

/** GET /api/p10plus/evals 的真实历史评测结果 */
interface EvalResult {
  input: string
  expected: string
  actual: string
  score: number
  model: string
  time: string
}
interface EvalsResp {
  results: EvalResult[]
  stats: { total: number; avgScore: number }
}
/** POST /api/p10plus/evals/run 的用例与返回 */
interface EvalCase { id: string; input: string; expected: string; category: string }
interface RunResp { results: EvalResult[] }

/** 达标线：关键词重叠得分 ≥ 0.6 视为通过（与后端评分口径一致，供 Tab 过滤） */
const PASS_LINE = 0.6
const MODEL_PALETTE = ['#2563eb', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#94a3b8']

const blankCase = (): EvalCase => ({ id: `case-${Date.now()}-${Math.floor(Math.random() * 1000)}`, input: '', expected: '', category: '通用' })

/** 模型评估：真实 LLM 关键词重叠评分 */
export default function EvalsPage() {
  const q = useApi<EvalsResp>('/p10plus/evals')
  const results = q.data?.results ?? []
  const stats = q.data?.stats

  const [tab, setTab] = useState<'all' | 'pass' | 'fail'>('all')
  const [modal, setModal] = useState(false)
  const [cases, setCases] = useState<EvalCase[]>([blankCase()])
  const [runResults, setRunResults] = useState<EvalResult[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  const [errToast, setErrToast] = useState('')
  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3000) }
  const notifyErr = (m: string) => { setErrToast(m); setTimeout(() => setErrToast(''), 4000) }

  /** Tab 计数与过滤全部基于真实 results */
  const passCount = results.filter((r) => r.score >= PASS_LINE).length
  const failCount = results.length - passCount
  const shown = useMemo(() => {
    if (tab === 'pass') return results.filter((r) => r.score >= PASS_LINE)
    if (tab === 'fail') return results.filter((r) => r.score < PASS_LINE)
    return results
  }, [results, tab])

  /** 模型对比：按真实 model 字段分组求平均（不再写死模型名） */
  const modelStats = useMemo(() => {
    const m = new Map<string, { sum: number; n: number }>()
    for (const r of results) {
      const e = m.get(r.model) ?? { sum: 0, n: 0 }
      e.sum += r.score
      e.n++
      m.set(r.model, e)
    }
    return Array.from(m.entries()).map(([name, v]) => ({ name, score: Math.round((v.sum / v.n) * 100) / 100, count: v.n }))
  }, [results])

  /** 得分分布 / 方差：全部由真实 results.score 计算 */
  const scoreStats = useMemo(() => {
    const s = results.map((r) => r.score)
    if (!s.length) return null
    const mean = s.reduce((a, b) => a + b, 0) / s.length
    const std = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length)
    return {
      scores: s.slice(-12),
      min: Math.min(...s),
      max: Math.max(...s),
      mean: Math.round(mean * 100) / 100,
      std: Math.round(std * 100) / 100,
      n: s.length,
    }
  }, [results])

  /** 执行真实评测：POST 用例 → 展示结果 → reload 历史 */
  async function doRun(list: EvalCase[]): Promise<boolean> {
    const valid = list.filter((c) => c.input.trim() && c.expected.trim())
    if (!valid.length) { notifyErr('请至少填写一条用例的输入与期望输出'); return false }
    setBusy(true)
    try {
      const res = await api<RunResp>('/p10plus/evals/run', { method: 'POST', body: { cases: valid } })
      setRunResults(res.results)
      notify(`已完成 ${res.results.length} 条用例的真实 LLM 评分`)
      q.reload()
      return true
    } catch (e) {
      notifyErr(e instanceof Error ? e.message : '运行评测失败')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function runFromModal() {
    if (await doRun(cases)) setModal(false)
  }

  /** 重跑全部：把历史 results 重新作为用例 POST */
  async function rerunAll() {
    const hist = q.data?.results ?? []
    if (!hist.length) return notifyErr('暂无历史评测结果可重跑')
    await doRun(hist.map((r, i) => ({ id: `rerun-${i}`, input: r.input, expected: r.expected, category: '历史回归' })))
  }

  function openComposer(fresh: boolean) {
    if (fresh) setCases([blankCase()])
    else if (!cases.length) setCases([blankCase()])
    setModal(true)
  }

  function updateCase(id: string, patch: Partial<EvalCase>) {
    setCases((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  const columns: Column<EvalResult>[] = [
    { key: 'input', header: '输入摘要', width: '190px', cell: (r) => <span className="font-mono text-[12px] text-slate-500">{r.input || '—'}</span> },
    { key: 'expected', header: '期望输出', cell: (r) => <span className="text-slate-600">{r.expected || '—'}</span> },
    { key: 'actual', header: '实际输出（LLM）', cell: (r) => <span className="text-slate-600">{r.actual || '—'}</span> },
    {
      key: 'score', header: '得分', align: 'center', width: '110px',
      cell: (r) => <Badge color={r.score >= PASS_LINE ? 'green' : 'red'} className="font-mono">{r.score.toFixed(2)} · {r.score >= PASS_LINE ? '通过' : '未通过'}</Badge>,
    },
    { key: 'model', header: '模型', width: '90px', cell: (r) => <span className="text-xs text-slate-500">{r.model}</span> },
    { key: 'time', header: '运行时间', width: '150px', cell: (r) => <span className="text-[11px] text-slate-400">{r.time}</span> },
  ]

  return (
    <PageShell
      icon={FlaskConical}
      title="模型评估中心"
      subtitle="用真实 LLM 对测试用例做关键词重叠评分：输入用例→调用评测→查看得分与回归"
      benchmark="模型评估"
      features={[
        '真实评测：POST /p10plus/evals/run 调用 LLM 并按关键词重叠度打分',
        '用例编排：运行评测弹层自由增删测试用例（输入 / 期望输出 / 类别）',
        '结果过滤：全部 / 通过 / 未通过 Tab 基于真实得分实时筛选',
        '重跑回归：把历史结果重新提交为用例，一键复测',
        '统计计算：模型对比与得分方差均由真实评分结果聚合，不写死',
      ]}
      actions={
        <>
          <Btn size="sm" disabled={busy || results.length === 0} onClick={rerunAll} title={results.length === 0 ? '暂无历史结果' : '将历史用例重新提交评测'}>
            <RotateCw size={13} /> 重跑全部
          </Btn>
          <Btn size="sm" variant="primary" onClick={() => openComposer(true)}><Plus size={13} /> 新建测试集</Btn>
        </>
      }
    >
      {toast && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">{toast}</div>}
      {errToast && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700">{errToast}</div>}
      {q.error && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700">
          <span>评测结果加载失败：{q.error}</span>
          <Btn size="sm" variant="ghost" onClick={q.reload}><RefreshCw size={13} /> 重试</Btn>
        </div>
      )}

      {/* 本次运行结果：POST 返回的真实评分（后端未持久化，单独展示） */}
      {runResults && (
        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2">本次运行结果 <Badge color="blue">{runResults.length} 条</Badge></span>}
            desc={`平均得分 ${runResults.length ? (runResults.reduce((s, r) => s + r.score, 0) / runResults.length).toFixed(2) : '0.00'} · 真实 LLM 关键词重叠评分`}
            actions={<button onClick={() => setRunResults(null)} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={15} /></button>}
          />
          <DataTable dense columns={columns} rows={runResults} rowKey={(r, i) => `run-${r.time}-${i}`} maxHeight="220px" />
          <div className="mt-2 flex items-start gap-2 rounded-lg bg-brand-50/60 px-3 py-2 text-[11px] leading-5 text-slate-500">
            <Info size={13} className="mt-0.5 shrink-0" /> 该结果为本次 POST 直接返回；历史列表来自 GET /p10plus/evals，已自动刷新。
          </div>
        </Card>
      )}

      {/* 历史评测结果表格 */}
      <Card>
        <CardHeader
          title="评测结果 · GET /api/p10plus/evals"
          desc={stats ? `共 ${stats.total} 条 · 平均得分 ${stats.avgScore.toFixed(2)} · 达标线 ${PASS_LINE.toFixed(2)}` : '加载中…'}
          actions={
            <>
              <Tabs
                size="sm"
                tabs={[
                  { key: 'all', label: '全部', count: results.length },
                  { key: 'pass', label: '通过', count: passCount },
                  { key: 'fail', label: '未通过', count: failCount },
                ]}
                active={tab}
                onChange={(k) => setTab(k as 'all' | 'pass' | 'fail')}
              />
              <Btn size="sm" variant="primary" disabled={busy} onClick={() => openComposer(false)}>
                <Play size={12} /> 运行评测
              </Btn>
            </>
          }
        />
        <DataTable dense columns={columns} rows={shown} rowKey={(r, i) => `${r.time}-${i}`} maxHeight="280px" />
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
        {/* 模型对比：由真实 results.model 分组平均 */}
        <Card>
          <CardHeader title="模型对比 · 真实平均得分" desc="按评测结果的 model 字段分组求平均分" actions={<Badge color="blue">{modelStats.length} 模型</Badge>} />
          {modelStats.length > 0 ? (
            <>
              <div className="h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={modelStats} layout="vertical" margin={{ top: 8, right: 48, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" domain={[0, 1]} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
                    <YAxis type="category" dataKey="name" width={78} tick={{ fontSize: 11, fill: '#475569' }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                    <Bar dataKey="score" name="平均得分" barSize={18} radius={[0, 4, 4, 0]}>
                      {modelStats.map((m, i) => <Cell key={m.name} fill={MODEL_PALETTE[i % MODEL_PALETTE.length]} />)}
                      <LabelList dataKey="score" position="right" formatter={(v: number) => Number(v).toFixed(2)} style={{ fontSize: 11, fill: '#475569' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 space-y-1">
                {modelStats.map((m, i) => (
                  <div key={m.name} className="flex items-center justify-between text-[11px] text-slate-500">
                    <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: MODEL_PALETTE[i % MODEL_PALETTE.length] }} />{m.name}</span>
                    <span className="font-mono">{m.count} 次评测 · 均分 {m.score.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex h-[240px] flex-col items-center justify-center gap-2 text-slate-400">
              <BarChart3 size={28} /> <span className="text-sm">暂无评测数据，运行评测后生成</span>
            </div>
          )}
        </Card>

        {/* 得分分布 / 方差：由真实 results.score 计算 */}
        <Card>
          <CardHeader
            title="得分分布 · 基于真实评测"
            desc={scoreStats ? `最近 ${scoreStats.scores.length} 条结果（共 ${scoreStats.n} 条）` : '暂无数据'}
            actions={<Badge color="amber">达标线 {PASS_LINE.toFixed(2)}</Badge>}
          />
          {scoreStats ? (
            <>
              <div className="mb-3 flex items-end gap-1.5" style={{ height: 84 }}>
                {scoreStats.scores.map((s, i) => (
                  <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1">
                    <span className="text-[10px] font-medium text-slate-500">{s.toFixed(2)}</span>
                    <div className="flex h-16 w-full items-end rounded-md bg-slate-100">
                      <div
                        className={cn('w-full rounded-md', s >= PASS_LINE ? 'bg-emerald-500' : 'bg-amber-500')}
                        style={{ height: `${Math.max(6, Math.round(s * 100))}%` }}
                        title={`第 ${i + 1} 条 · ${s.toFixed(2)}`}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <KVList
                cols={1}
                items={[
                  { k: '得分区间', v: <span className="font-mono">{scoreStats.min.toFixed(2)} – {scoreStats.max.toFixed(2)}</span> },
                  { k: '均值 / 标准差', v: <span className="font-mono">{scoreStats.mean.toFixed(2)} / {scoreStats.std.toFixed(2)}</span> },
                  { k: '通过 / 未通过', v: <span className="font-mono">{passCount} / {failCount}（共 {scoreStats.n} 条）</span> },
                ]}
              />
              <div className="mt-3 flex items-start gap-2 rounded-lg bg-slate-50 p-2.5 text-[11px] leading-5 text-slate-500">
                <Timer size={13} className="mt-0.5 shrink-0 text-amber-500" />
                以上区间、均值、标准差与分布均由 GET /p10plus/evals 返回的真实得分计算。
              </div>
            </>
          ) : (
            <div className="flex h-[240px] flex-col items-center justify-center gap-2 text-slate-400">
              <BarChart3 size={28} /> <span className="text-sm">暂无评测数据，运行评测后生成</span>
            </div>
          )}
        </Card>
      </div>

      {/* 运行评测 / 新建测试集弹层：输入用例 → POST 运行 */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={() => setModal(false)}>
          <div className="w-[640px] max-w-[94vw] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-pop" style={{ maxHeight: '88vh' }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-base font-bold text-slate-900">编辑测试集并运行评测</div>
                <div className="mt-0.5 text-[11px] text-slate-400">用例将提交至 POST /p10plus/evals/run，由真实 LLM 回答并按关键词重叠度评分</div>
              </div>
              <button onClick={() => setModal(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={16} /></button>
            </div>

            <div className="space-y-2.5">
              {cases.map((c, i) => (
                <div key={c.id} className="rounded-xl border border-slate-200 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-700">用例 #{i + 1}</span>
                    <button onClick={() => setCases((prev) => prev.filter((x) => x.id !== c.id))} className="text-slate-300 hover:text-red-500" title="删除用例"><Trash2 size={14} /></button>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_100px]">
                    <Field label="输入（提问）"><Input value={c.input} onChange={(e) => updateCase(c.id, { input: e.target.value })} placeholder="如：设备 GD-2291 停机的根因是什么" /></Field>
                    <Field label="期望输出"><Input value={c.expected} onChange={(e) => updateCase(c.id, { expected: e.target.value })} placeholder="如：液压系统密封老化" /></Field>
                    <Field label="类别"><Input value={c.category} onChange={(e) => updateCase(c.id, { category: e.target.value })} placeholder="通用" /></Field>
                  </div>
                </div>
              ))}
            </div>

            <button onClick={() => setCases((prev) => [...prev, blankCase()])} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-2 text-xs font-medium text-slate-500 hover:border-brand-400 hover:text-brand-600">
              <Plus size={13} /> 添加用例
            </button>

            <div className="mt-5 flex justify-end gap-2">
              <Btn onClick={() => setModal(false)}>取消</Btn>
              <Btn variant="primary" disabled={busy} onClick={runFromModal}>
                {busy ? <><Loader2 size={14} className="animate-spin" /> LLM 评测中…</> : <><Play size={14} /> 运行评测（{cases.filter((c) => c.input.trim() && c.expected.trim()).length} 条）</>}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}
