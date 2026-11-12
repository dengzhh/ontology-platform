import { useMemo, useState } from 'react'
import { BarChart3, Loader2 } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts'
import PageShell from '@/components/ui/PageShell'
import StatCard from '@/components/ui/StatCard'
import Btn from '@/components/ui/Btn'
import { Badge } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import { Select, Input } from '@/components/ui/Form'
import DataTable from '@/components/ui/DataTable'
import { api } from '@/lib/api'
import { useApi } from '@/lib/useApi'

interface TypeBrief { id: string; name: string; color: string; count: number; properties: { key: string; name: string; type: string; enumValues?: string[] }[] }
interface AggGroup { name: string; count: number; sum: number; avg: number }
interface AggResp {
  type: { id: string; name: string; color: string }
  groupBy: { key: string; name: string }
  metric: { key: string; name: string } | null
  total: number
  applied: { bucket: string | null; from: string | null; to: string | null; sort: string; order: string }
  groups: AggGroup[]
}
interface ListResp { types: TypeBrief[] }

const PIE_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#6366f1', '#0ea5e9', '#84cc16']

/** Contour 分析（P9 真实数据）：按字段分组聚合，图表+表格联动 */
export default function Contour() {
  // 必须用 /ontology/types：/objects/types 是精简列表，不含 properties，分组/指标下拉会为空
  const typesQ = useApi<ListResp>('/ontology/types')
  const types = typesQ.data?.types ?? []

  const [typeId, setTypeId] = useState('')
  const [groupBy, setGroupBy] = useState('')
  const [metric, setMetric] = useState('')
  const [bucket, setBucket] = useState('')      // 时间分桶：'' | day | week | month | quarter
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [sort, setSort] = useState('sum')       // 默认按金额（求和）排序，而非笔数
  const [result, setResult] = useState<AggResp | null>(null)
  const [loading, setLoading] = useState(false)

  const selType = types.find((t) => t.id === typeId)
  // 分组维度：枚举 + 日期 + 文本（商户/来源等），不再只限枚举
  const groupProps = useMemo(() => (selType?.properties ?? []).filter((p) => ['enum', 'date', 'string'].includes(p.type)), [selType])
  const numProps = useMemo(() => (selType?.properties ?? []).filter((p) => p.type === 'number'), [selType])
  const groupIsDate = useMemo(() => (selType?.properties ?? []).find((p) => p.key === groupBy)?.type === 'date', [selType, groupBy])

  async function runAnalysis() {
    if (!typeId || !groupBy) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ typeId, groupBy, sort })
      if (metric) params.set('metric', metric)
      if (groupIsDate && bucket) params.set('bucket', bucket)
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      const r = await api<AggResp>(`/dashboard/aggregate?${params}`)
      setResult(r)
    } finally { setLoading(false) }
  }

  return (
    <PageShell
      icon={BarChart3}
      title="Contour 数据分析"
      subtitle="按字段分组聚合分析真实对象数据 —— 维度选择→分组统计→图表联动"
      benchmark="探索分析"
      features={[
        '维度选择：对象类型→枚举/日期/文本字段分组→数值指标（可选）',
        '消费趋势：按日期分组时支持日/周/月/季度分桶，并可按时间范围筛选',
        '金额优先：默认按指标求和降序，最大花费排在前面（可切笔数/均值）',
        '图表联动：柱状图+饼图+明细表同一数据源，全部来自当前空间真实对象',
      ]}
      actions={<Btn size="sm" onClick={runAnalysis} disabled={!typeId || !groupBy || loading}>{loading ? <Loader2 size={13} className="animate-spin" /> : '运行分析'}</Btn>}
    >
      {/* 分析步骤条 */}
      <Card>
        <CardHeader title="分析配置" desc="选择维度 → 运行 → 查看结果；个人消费分析可对「支出」按类别/日期/商户分组" />
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-4">
          <div>
            <div className="mb-1.5 text-xs font-medium text-slate-600">1. 对象类型</div>
            <Select className="w-full" value={typeId} onChange={(e) => { setTypeId(e.target.value); setGroupBy(''); setMetric(''); setBucket(''); setResult(null) }}>
              <option value="">选择…</option>
              {types.map((t) => <option key={t.id} value={t.id}>{t.name}({t.count})</option>)}
            </Select>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-slate-600">2. 分组维度</div>
            <Select className="w-full" value={groupBy} onChange={(e) => setGroupBy(e.target.value)} disabled={!selType}>
              <option value="">选择…</option>
              {groupProps.map((p) => <option key={p.key} value={p.key}>{p.name}（{p.type === 'date' ? '日期' : p.type === 'enum' ? '枚举' : '文本'}）</option>)}
            </Select>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-slate-600">3. 指标（可选，数值字段）</div>
            <Select className="w-full" value={metric} onChange={(e) => setMetric(e.target.value)} disabled={!selType}>
              <option value="">仅计数</option>
              {numProps.map((p) => <option key={p.key} value={p.key}>{p.name}（求和/均值）</option>)}
            </Select>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-slate-600">4. 排序依据</div>
            <Select className="w-full" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="sum">指标总和（金额最大优先）</option>
              <option value="count">实例数</option>
              <option value="avg">指标均值</option>
            </Select>
          </div>
        </div>
        {/* 时间维度：仅当分组字段是日期时显示分桶，时间范围始终可用 */}
        <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 md:grid-cols-3 xl:grid-cols-4">
          {groupIsDate && (
            <div>
              <div className="mb-1.5 text-xs font-medium text-slate-600">时间分桶</div>
              <Select className="w-full" value={bucket} onChange={(e) => setBucket(e.target.value)}>
                <option value="">按原始日期（每天一组）</option>
                <option value="day">按日</option>
                <option value="week">按周</option>
                <option value="month">按月（推荐）</option>
                <option value="quarter">按季度</option>
              </Select>
            </div>
          )}
          <div>
            <div className="mb-1.5 text-xs font-medium text-slate-600">起始日期（可选）</div>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-slate-600">结束日期（可选）</div>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Btn variant="primary" className="w-full" onClick={runAnalysis} disabled={!typeId || !groupBy || loading}>
              {loading ? '分析中…' : '运行分析'}
            </Btn>
          </div>
        </div>
      </Card>

      {loading && (
        <div className="flex items-center justify-center gap-2 py-14 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" /> 聚合分析中…</div>
      )}

      {result && !loading && (
        <>
          {/* 已应用条件：让用户明确看到分桶/筛选/排序生效 */}
          {result.applied && (result.applied.bucket || result.applied.from || result.applied.to) && (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
              <span className="font-medium text-slate-600">已应用：</span>
              {result.applied.bucket && <Badge color="violet">按{({ day: '日', week: '周', month: '月', quarter: '季度' } as Record<string, string>)[result.applied.bucket] || result.applied.bucket}分桶</Badge>}
              {result.applied.from && <Badge color="blue">起 {result.applied.from}</Badge>}
              {result.applied.to && <Badge color="blue">止 {result.applied.to}</Badge>}
              <Badge color="slate">按{({ sum: '金额总和', count: '笔数', avg: '均值' } as Record<string, string>)[result.applied.sort] || result.applied.sort}排序</Badge>
            </div>
          )}

          {/* 结果统计 */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="总实例" value={result.total} icon={BarChart3} footer={result.type.name} />
            <StatCard label="分组数" value={result.groups.length} icon={BarChart3} iconClass="bg-violet-50 text-violet-600" footer={`按${result.groupBy.name}分组`} />
            {result.metric && <StatCard label={`${result.metric.name}总和`} value={Math.round(result.groups.reduce((s, g) => s + g.sum, 0))} icon={BarChart3} iconClass="bg-amber-50 text-amber-600" />}
            {result.metric && <StatCard label={`${result.metric.name}均值`} value={Math.round((result.groups.reduce((s, g) => s + g.avg, 0) / result.groups.length) * 10) / 10} icon={BarChart3} iconClass="bg-emerald-50 text-emerald-600" />}
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {/* 柱状图 */}
            <Card>
              <CardHeader title={`${result.groupBy.name}分布`} desc={result.metric ? `各组${result.metric.name}总和` : '各组实例数'} />
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={result.groups} margin={{ top: 5, right: 12, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                    <Bar dataKey={result.metric ? 'sum' : 'count'} radius={[4, 4, 0, 0]}>
                      {result.groups.map((_, i) => <Cell key={i} fill={result.type.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* 饼图：选了数值指标时按金额占比（消费分析更关心钱花在哪），否则按笔数 */}
            <Card>
              <CardHeader title={`${result.groupBy.name}占比`} desc={result.metric ? `按${result.metric.name}总和占比` : '按实例数占比'} />
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={result.groups.filter((g) => g.count > 0)} dataKey={result.metric ? 'sum' : 'count'} nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                      {result.groups.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          {/* 明细表 */}
          <Card>
            <CardHeader title="分组明细" desc={`${result.type.name} 按 ${result.groupBy.name} 分组`} />
            <DataTable
              dense
              rows={result.groups}
              columns={[
                { key: 'name', header: result.groupBy.name, cell: (g) => <Badge color="blue">{g.name}</Badge> },
                { key: 'count', header: '实例数', align: 'right' },
                ...(result.metric ? [
                  { key: 'sum', header: `${result.metric.name}总和`, align: 'right' as const, cell: (g: AggGroup) => <span className="font-medium">{Math.round(g.sum)}</span> },
                  { key: 'avg', header: `${result.metric.name}均值`, align: 'right' as const, cell: (g: AggGroup) => <span className="text-slate-500">{g.avg}</span> },
                ] : []),
                {
                  key: 'pct', header: result.metric ? '金额占比' : '笔数占比', cell: (g) => {
                    const total = result.metric ? result.groups.reduce((s, x) => s + x.sum, 0) : result.total
                    const part = result.metric ? g.sum : g.count
                    const pct = total > 0 ? Math.round((part / total) * 100) : 0
                    return <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-16 rounded-full bg-slate-100"><span className="block h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} /></span>{pct}%</span>
                  },
                },
              ]}
            />
          </Card>
        </>
      )}

      {!result && !loading && (
        <Card className="py-14 text-center text-sm text-slate-400">
          选择维度并点击「运行分析」，查看真实数据聚合结果
        </Card>
      )}
    </PageShell>
  )
}
