import { useMemo, useState } from 'react'
import { Activity, BarChart3, Boxes, FileText, Link2, ListTree, Loader2, Layers, RefreshCw, Save, Share2, Sparkles, Table2, Trash2 } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import PageShell from '@/components/ui/PageShell'
import Btn from '@/components/ui/Btn'
import StatCard from '@/components/ui/StatCard'
import DataTable from '@/components/ui/DataTable'
import { Badge } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import { Avatar, ProgressBar } from '@/components/ui/Misc'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { useApi } from '@/lib/useApi'

/** GET /api/p10/notepad-data 的真实返回结构 */
interface TypeDistItem { name: string; color: string; count: number }
interface RecentAction { actor: string; action: string; target: string; time: string }
interface NotepadResp {
  space: { name: string }
  stats: { types: number; objects: number; links: number; docs: number; auditToday: number }
  typeDist: TypeDistItem[]
  recentActions: RecentAction[]
}

interface AipResp { action: string; result: string }

type AipAction = 'polish' | 'continue' | 'translate'
const AIP_ACTIONS: { key: AipAction; label: string }[] = [
  { key: 'polish', label: '润色' },
  { key: 'continue', label: '续写' },
  { key: 'translate', label: '翻译' },
]

/** 报告存储接口（/p10/notepad/reports）的返回结构 */
type ReportStatus = 'draft' | 'published'
interface ReportItem {
  id: string
  title: string
  status: ReportStatus
  preview: string
  updatedAt: string
}
interface ReportsResp { reports: ReportItem[] }
interface ReportDetail {
  id: string
  title: string
  content: string
  status: ReportStatus
  aipResult: string
}
interface ReportDetailResp { report: ReportDetail }
interface SaveReportBody {
  id?: string
  title: string
  content: string
  status: ReportStatus
  aipResult?: string
}
interface SaveResp { id: string; status: ReportStatus }

type AipData = { label: string; result: string }

/** 报告标题默认值：月度运营报告 + 日期 */
function defaultTitle(): string {
  return `月度运营报告 ${new Date().toLocaleDateString('zh-CN')}`
}

/** 反序列化随报告落库的 智能处理结果（JSON 或旧纯文本），用于载入时回显 */
function parseAip(raw: string): AipData | null {
  if (!raw) return null
  try {
    const v: unknown = JSON.parse(raw)
    if (v !== null && typeof v === 'object' && 'label' in v && 'result' in v) {
      const o = v as Record<string, unknown>
      if (typeof o.label === 'string' && typeof o.result === 'string') {
        return { label: o.label, result: o.result }
      }
    }
  } catch { /* 兼容纯文本 */ }
  return { label: 'AI 结果', result: raw }
}

/** 章节 id 与大纲对应，点击大纲用 scrollIntoView 定位 */
const OUTLINE = [
  { id: 'np-overview', label: '一、总体概览' },
  { id: 'np-typedist', label: '二、对象类型明细' },
  { id: 'np-chart', label: '三、实例分布分析' },
  { id: 'np-conclusion', label: '四、结论与建议' },
  { id: 'np-appendix', label: '五、附录：数据口径与最近操作' },
]

const TOOLTIP_STYLE = { fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }

/** Notepad：数据智能报告—— 统计/表格/图表/最近操作全部来自真实接口 */
export default function NotepadPage() {
  const dataQ = useApi<NotepadResp>('/p10/notepad-data')
  const reportsQ = useApi<ReportsResp>('/p10/notepad/reports')
  const data = dataQ.data
  const stats = data?.stats
  const typeDist = data?.typeDist ?? []
  const recentActions = data?.recentActions ?? []
  const totalInstances = typeDist.reduce((s, t) => s + t.count, 0)
  const topType = typeDist[0]

  const [section, setSection] = useState('np-overview')
  const [toast, setToast] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null)
  const notify = (text: string, kind: 'ok' | 'err' = 'ok') => {
    setToast({ text, kind })
    setTimeout(() => setToast(null), 2800)
  }

  const [aipBusy, setAipBusy] = useState<AipAction | null>(null)
  const [aipResult, setAipResult] = useState<AipData | null>(null)
  const [aipErr, setAipErr] = useState('')

  /** 报告编辑 / 存储状态：editorContent 为 null 时正文跟随实时拼装的 reportText */
  const [title, setTitle] = useState(defaultTitle)
  const [editorContent, setEditorContent] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState<ReportStatus | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [reportErr, setReportErr] = useState('')

  /** 报告全文（纯由真实数据拼装），作为 智能写作助手的输入与默认保存正文 */
  const reportText = useMemo(() => {
    if (!data) return ''
    const s = data.stats
    const dist = data.typeDist.map((t) => `${t.name} ${t.count} 个`).join('、')
    return [
      `${data.space.name} · 本体数据报告`,
      `当前空间共定义 ${s.types} 类对象类型、${s.objects} 个对象实例、${s.links} 条对象关联与 ${s.docs} 篇知识文档，今日审计操作 ${s.auditToday} 次。`,
      `对象类型分布：${dist}。`,
      `实例数量最多的类型为${topType ? `${topType.name}（${topType.count} 个）` : '暂无'}。`,
      `最近操作：${data.recentActions.map((a) => `${a.actor} ${a.action} ${a.target}`).join('；')}。`,
    ].join('\n')
  }, [data, topType])

  /** 当前可保存的正文：载入历史报告用其内容，否则用实时数据拼装的 reportText */
  const currentContent = editorContent ?? reportText

  function reload() {
    dataQ.reload()
    notify('已重新拉取 /p10/notepad-data 真实数据')
  }

  /** 大纲：滚动并高亮到对应章节 */
  function goTo(id: string) {
    setSection(id)
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  /** 智能写作助手：接真实 LLM（POST /api/p10/notepad/aip），成功/失败均刷新数据 */
  async function runAip(action: AipAction, label: string) {
    if (!reportText.trim()) return
    setAipBusy(action)
    setAipErr('')
    setAipResult(null)
    try {
      const r = await api<AipResp>('/p10/notepad/aip', { method: 'POST', body: { action, text: reportText } })
      setAipResult({ label, result: r.result })
      notify(`「${label}」完成（真实 LLM）`)
      dataQ.reload()
    } catch (e) {
      const msg = e instanceof Error ? e.message : '写作助手调用失败'
      setAipErr(msg)
      notify(msg, 'err')
      dataQ.reload()
    } finally {
      setAipBusy(null)
    }
  }

  /** 保存草稿 / 发布月报：POST /p10/notepad/reports，正文 + 智能处理结果一起落库 */
  async function saveReport(status: ReportStatus) {
    const content = currentContent
    if (!content.trim()) {
      notify('报告正文为空，无法保存', 'err')
      return
    }
    setSaving(status)
    setReportErr('')
    try {
      const body: SaveReportBody = {
        title: title.trim() || defaultTitle(),
        content,
        status,
        ...(aipResult ? { aipResult: JSON.stringify(aipResult) } : {}),
      }
      if (editingId) body.id = editingId
      const r = await api<SaveResp>('/p10/notepad/reports', { method: 'POST', body })
      setEditingId(r.id)
      notify(status === 'published' ? '月报已发布（真实落库 + 审计留痕）' : '草稿已保存（真实落库 + 审计留痕）')
      reportsQ.reload()
    } catch (e) {
      const msg = e instanceof Error ? e.message : '报告保存失败'
      setReportErr(msg)
      notify(msg, 'err')
    } finally {
      setSaving(null)
    }
  }

  /** 载入历史报告详情：回填标题 / 正文 / 智能处理结果 */
  async function loadReport(id: string) {
    setLoadingId(id)
    setReportErr('')
    setDeleteId(null)
    try {
      const r = await api<ReportDetailResp>(`/p10/notepad/reports/${id}`)
      setEditingId(r.report.id)
      setTitle(r.report.title)
      setEditorContent(r.report.content)
      setAipResult(parseAip(r.report.aipResult))
      notify('已载入报告，正文与 智能处理结果已回填')
    } catch (e) {
      const msg = e instanceof Error ? e.message : '报告载入失败'
      setReportErr(msg)
      notify(msg, 'err')
    } finally {
      setLoadingId(null)
    }
  }

  /** 删除报告（带确认 / 取消） */
  async function deleteReport(id: string) {
    setDeletingId(id)
    setReportErr('')
    try {
      await api<{ ok: boolean }>(`/p10/notepad/reports/${id}`, { method: 'DELETE' })
      notify('报告已删除')
      if (editingId === id) resetEditor()
      setDeleteId(null)
      reportsQ.reload()
    } catch (e) {
      const msg = e instanceof Error ? e.message : '报告删除失败'
      setReportErr(msg)
      notify(msg, 'err')
    } finally {
      setDeletingId(null)
    }
  }

  /** 新建报告：清空编辑态，正文重新跟随实时数据 */
  function resetEditor() {
    setEditingId(null)
    setTitle(defaultTitle())
    setEditorContent(null)
    setAipResult(null)
    setDeleteId(null)
    setReportErr('')
    notify('已新建报告（正文跟随实时数据）')
  }

  const chartData = typeDist.map((t) => ({ name: t.name, count: t.count, color: t.color }))
  const reports = reportsQ.data?.reports ?? []

  return (
    <PageShell
      icon={ListTree}
      title="智能报告"
      subtitle="富文本 + 嵌入式数据组件 + 智能写作助手，报告随本体真实数据实时保鲜"
      benchmark="智能报告"
      features={[
        '真实数据：统计/表格/图表/最近操作全部来自 /p10/notepad-data',
        '嵌入数据组件：对象类型分布表与实例分布图随本体数据实时刷新',
        '智能写作助手：润色 / 续写 / 翻译接入真实 LLM（POST /p10/notepad/aip）',
        '大纲导航：点击目录滚动定位到对应章节（scrollIntoView）',
        '报告真实存储：保存草稿 / 发布月报写入 /p10/notepad/reports（含审计留痕），支持列表 / 载入 / 删除',
        '正文可编辑：默认由真实数据拼装，载入历史报告回填正文与 智能处理结果',
      ]}
      actions={
        <>
          <Btn size="sm" onClick={reload} disabled={dataQ.loading}><RefreshCw size={13} /> 刷新数据</Btn>
          <Btn size="sm" onClick={() => saveReport('draft')} disabled={saving !== null || !currentContent.trim()}>
            {saving === 'draft' ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} 保存草稿
          </Btn>
          <Btn size="sm" variant="primary" onClick={() => saveReport('published')} disabled={saving !== null || !currentContent.trim()}>
            {saving === 'published' ? <Loader2 size={13} className="animate-spin" /> : <Share2 size={13} />} 发布月报
          </Btn>
        </>
      }
    >
      {/* 错误 toast */}
      {dataQ.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700">
          加载失败：{dataQ.error}
        </div>
      )}
      {toast && (
        <div className={cn('rounded-lg border px-4 py-2.5 text-sm font-medium', toast.kind === 'err' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700')}>
          {toast.text}
        </div>
      )}

      {dataQ.loading && !data ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" /> 加载报告真实数据…</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          {/* 报告编辑区（可编辑正文 + 真实数据组件） */}
          <Card className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-4">
              <div className="flex items-center gap-2.5">
                <h2 className="text-lg font-bold text-slate-900">{data?.space.name ?? '本体空间'} · 本体数据报告</h2>
                <Badge color="green" dot>实时数据</Badge>
              </div>
              <span className="text-[11px] text-slate-400">数据来源：/p10/notepad-data（当前空间实时数据）</span>
            </div>

            {/* 真实存储横幅 */}
            <div className="mt-2 rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-[11px] leading-4 text-emerald-700">
              草稿保存与月报发布已接入后端 /p10/notepad/reports（真实落库 + 审计留痕）；报告列表支持载入 / 编辑 / 删除，智能处理结果随报告保存并可回显。
            </div>

            {/* 报告正文编辑（标题 + 可编辑 textarea） */}
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-slate-700">
                  <FileText size={13} /> 报告正文（可编辑 · 保存后真实落库）
                </span>
                <div className="flex items-center gap-2">
                  {editingId && <Badge color="violet">编辑中 · {editingId}</Badge>}
                  <Btn size="sm" variant="ghost" onClick={resetEditor}>新建（回到实时数据）</Btn>
                </div>
              </div>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="报告标题"
                className="mb-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-medium text-slate-800 outline-none focus:border-brand-400"
              />
              <textarea
                value={currentContent}
                onChange={(e) => setEditorContent(e.target.value)}
                rows={6}
                placeholder="报告正文（默认由 /p10/notepad-data 真实数据拼装）"
                className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px] leading-5 text-slate-700 outline-none focus:border-brand-400"
              />
              <p className="mt-1.5 text-[11px] leading-4 text-slate-500">
                标题与正文均可编辑；默认正文由本页真实统计拼装，载入列表中的报告后回填其正文与 智能处理结果。下方统计卡、明细表与分布图仍为实时数据只读呈现。
              </p>
            </div>

            {/* 一、总体概览 */}
            <section id="np-overview" className="scroll-mt-4 pt-4">
              <h3 className="mb-3 text-sm font-bold text-slate-800">一、总体概览</h3>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                <StatCard label="对象类型" value={stats?.types ?? 0} icon={Layers} footer="本体定义" />
                <StatCard label="对象实例" value={stats?.objects ?? 0} icon={Boxes} iconClass="bg-violet-50 text-violet-600" footer="当前空间" />
                <StatCard label="对象关联" value={stats?.links ?? 0} icon={Link2} iconClass="bg-amber-50 text-amber-600" footer="objectLinks" />
                <StatCard label="知识文档" value={stats?.docs ?? 0} icon={FileText} iconClass="bg-cyan-50 text-cyan-600" footer="documents" />
                <StatCard label="今日审计" value={stats?.auditToday ?? 0} icon={Activity} iconClass="bg-emerald-50 text-emerald-600" footer="近 24 小时" />
              </div>
              <p className="mt-4 text-[13px] leading-6 text-slate-700">
                本报告基于本体空间「{data?.space.name ?? '—'}」的实时数据生成。当前空间共定义 {stats?.types ?? 0} 类对象类型、
                {stats?.objects ?? 0} 个对象实例、{stats?.links ?? 0} 条对象关联与 {stats?.docs ?? 0} 篇知识文档，
                今日产生 {stats?.auditToday ?? 0} 次审计操作。以下明细表、分布图与最近操作均从 /p10/notepad-data 实时拉取，随本体数据刷新。
              </p>
            </section>

            {/* 二、对象类型明细（原「工厂 OEE 表」→ 真实对象类型分布） */}
            <section id="np-typedist" className="scroll-mt-4 pt-4">
              <h3 className="mb-1 text-sm font-bold text-slate-800">二、对象类型明细</h3>
              <p className="mb-1 text-[11px] leading-4 text-slate-400">实时统计各对象类型的实例数量（来源：typeDist）</p>
              <EmbeddedBlock label="嵌入 · 对象类型分布（实时）" icon={<Table2 size={10} />}>
                <DataTable
                  dense
                  rows={typeDist}
                  rowKey={(r) => r.name}
                  columns={[
                    {
                      key: 'name', header: '对象类型',
                      cell: (r) => (
                        <span className="inline-flex items-center gap-2 font-medium text-slate-800">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.color }} />
                          {r.name}
                        </span>
                      ),
                    },
                    { key: 'count', header: '实例数', align: 'right', cell: (r) => <span className="font-semibold">{r.count}</span> },
                    {
                      key: 'pct', header: '占比',
                      cell: (r) => {
                        const pct = totalInstances > 0 ? Math.round((r.count / totalInstances) * 100) : 0
                        return (
                          <span className="inline-flex items-center gap-2">
                            <ProgressBar pct={pct} className="w-20" color="bg-brand-500" />
                            <span className="text-[11px] text-slate-500">{pct}%</span>
                          </span>
                        )
                      },
                    },
                  ]}
                />
              </EmbeddedBlock>
            </section>

            {/* 三、实例分布分析（原「停机图表」→ 真实对象类型实例数） */}
            <section id="np-chart" className="scroll-mt-4 pt-4">
              <h3 className="mb-1 text-sm font-bold text-slate-800">三、实例分布分析</h3>
              <p className="mb-1 text-[11px] leading-4 text-slate-400">各对象类型实例数对比（来源：typeDist，颜色取本体类型色）</p>
              <EmbeddedBlock label="嵌入 · 属性图表（各对象类型实例数）" icon={<BarChart3 size={10} />}>
                {chartData.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-400">暂无对象类型分布数据</div>
                ) : (
                  <div className="h-[190px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
                        <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={TOOLTIP_STYLE} />
                        <Bar dataKey="count" name="实例数" radius={[4, 4, 0, 0]} maxBarSize={44}>
                          {chartData.map((d) => <Cell key={d.name} fill={d.color} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </EmbeddedBlock>
            </section>

            {/* 四、结论与建议（文字由真实数据拼装，不虚构数字） */}
            <section id="np-conclusion" className="scroll-mt-4 pt-4">
              <h3 className="mb-2 text-sm font-bold text-slate-800">四、结论与建议</h3>
              <blockquote className="border-l-4 border-brand-500 bg-brand-50/50 py-3 pl-4 pr-3 text-[13px] leading-6 text-slate-700">
                <span className="font-semibold text-brand-700">结论：</span>
                当前空间对象实例集中于{topType ? `「${topType.name}」（${topType.count} 个，占比 ${totalInstances > 0 ? Math.round((topType.count / totalInstances) * 100) : 0}%）` : '暂无实例'}等类型，
                合计 {typeDist.length} 类对象类型、{stats?.objects ?? 0} 个实例。当新增实例或关联时，本页统计卡、明细表与分布图将同步刷新。
                建议持续关注实例数较少的对象类型，结合今日 {stats?.auditToday ?? 0} 次审计操作完善本体覆盖与数据质量。
              </blockquote>
            </section>

            {/* 五、附录：数据口径与最近操作（原写死 COMMENTS → 真实 recentActions） */}
            <section id="np-appendix" className="scroll-mt-4 pt-4">
              <h3 className="mb-2 text-sm font-bold text-slate-800">五、附录：数据口径与最近操作</h3>
              <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-[11px] leading-5 text-slate-500">
                数据口径：stats 取当前空间的 objectTypes / objects / objectLinks / documents 与近 24 小时审计事件计数；
                typeDist 按对象类型统计实例数并降序排列；recentActions 取审计日志最近 8 条。所有数据均来自 GET /api/p10/notepad-data。
              </div>
              {recentActions.length === 0 ? (
                <div className="rounded-lg border border-slate-200 py-8 text-center text-xs text-slate-400">暂无最近操作</div>
              ) : (
                <div className="space-y-2.5">
                  {recentActions.map((a, i) => (
                    <div key={i} className="flex items-start gap-2.5 rounded-lg border border-slate-100 bg-white px-3 py-2">
                      <Avatar name={a.actor} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-[12px]">
                          <span className="font-semibold text-slate-700">{a.actor}</span>
                          <span className="text-slate-600">{a.action}</span>
                          <span className="text-[11px] text-slate-400">{a.target}</span>
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-400">{a.time}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </Card>

          {/* 右侧面板：报告列表 / 大纲 / 智能写作 / 最近操作摘要 */}
          <div className="flex flex-col gap-4">
            {/* 报告列表（真实存储：载入 / 编辑 / 删除） */}
            <Card className="h-fit">
              <CardHeader
                title={<span>报告列表（{reports.length}）</span>}
                desc="草稿 / 已发布 · 点击载入编辑"
                actions={<Btn size="sm" variant="ghost" onClick={() => reportsQ.reload()} disabled={reportsQ.loading}><RefreshCw size={12} /> 刷新</Btn>}
              />
              {reportErr && (
                <div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] leading-4 text-red-700">{reportErr}</div>
              )}
              {reportsQ.loading && !reportsQ.data ? (
                <div className="flex items-center justify-center gap-2 py-6 text-[11px] text-slate-400"><Loader2 size={13} className="animate-spin" /> 加载报告列表…</div>
              ) : reports.length === 0 ? (
                <div className="rounded-lg border border-slate-200 py-6 text-center text-[11px] text-slate-400">暂无已保存报告，点击「保存草稿」或「发布月报」创建</div>
              ) : (
                <div className="space-y-2">
                  {reports.map((r) => (
                    <div key={r.id} className={cn('rounded-lg border p-2.5', editingId === r.id ? 'border-brand-300 bg-brand-50/50' : 'border-slate-100 bg-white')}>
                      <button
                        type="button"
                        onClick={() => loadReport(r.id)}
                        disabled={loadingId === r.id}
                        className="w-full text-left disabled:opacity-60"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[12px] font-semibold text-slate-700">{r.title}</span>
                          <Badge color={r.status === 'published' ? 'green' : 'amber'}>{r.status === 'published' ? '已发布' : '草稿'}</Badge>
                        </div>
                        {r.preview && <div className="mt-1 truncate text-[11px] text-slate-400">{r.preview}</div>}
                        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-400">
                          {loadingId === r.id ? <><Loader2 size={10} className="animate-spin" /> 载入中…</> : r.updatedAt}
                        </div>
                      </button>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        {deleteId === r.id ? (
                          <>
                            <span className="mr-auto text-[11px] font-medium text-red-600">确认删除？</span>
                            <Btn size="sm" variant="danger" disabled={deletingId === r.id} onClick={() => deleteReport(r.id)}>
                              {deletingId === r.id ? <Loader2 size={12} className="animate-spin" /> : null} 确认
                            </Btn>
                            <Btn size="sm" variant="ghost" onClick={() => setDeleteId(null)}>取消</Btn>
                          </>
                        ) : (
                          <Btn size="sm" variant="ghost" onClick={() => setDeleteId(r.id)}><Trash2 size={12} /> 删除</Btn>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card className="h-fit">
              <CardHeader title="大纲目录" desc={`${OUTLINE.length} 个章节 · 点击滚动定位`} />
              <div className="space-y-0.5">
                {OUTLINE.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => goTo(s.id)}
                    className={cn(
                      'w-full rounded-md px-2 py-1.5 text-left text-[13px]',
                      section === s.id ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-600 hover:bg-slate-50',
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </Card>

            <Card className="h-fit">
              <CardHeader
                title={<span className="flex items-center gap-1.5"><Sparkles size={13} className="text-violet-500" /> 智能写作助手</span>}
                desc="基于全文真实数据 · 接入真实 LLM"
              />
              <div className="flex flex-wrap gap-2">
                {AIP_ACTIONS.map((a) => (
                  <Btn
                    key={a.key}
                    size="sm"
                    variant={a.key === 'polish' ? 'primary' : 'secondary'}
                    disabled={aipBusy !== null || !reportText}
                    onClick={() => runAip(a.key, a.label)}
                  >
                    {aipBusy === a.key ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} {a.label}
                  </Btn>
                ))}
              </div>

              {aipErr && (
                <div className="mt-2.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[11px] leading-4 text-red-700">{aipErr}</div>
              )}
              {aipResult && (
                <div className="mt-2.5 rounded-lg border border-violet-200 bg-violet-50/60 p-2.5">
                  <div className="mb-1 text-[11px] font-semibold text-violet-700">{aipResult.label}结果</div>
                  <div className="max-h-56 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-slate-600">{aipResult.result}</div>
                </div>
              )}
              {!aipResult && !aipErr && (
                <div className="mt-2.5 rounded-lg bg-violet-50/60 p-2.5 text-[11px] leading-4 text-slate-500">
                  智能写作依据本页真实统计与分布拼装全文后调用 LLM。未配置 AI 网关时会提示错误（不会伪造结果）。
                </div>
              )}
            </Card>

            <Card className="h-fit">
              <CardHeader title={<span>最近操作（{recentActions.length}）</span>} desc="点击大纲「附录」查看全文" />
              <div className="space-y-2.5">
                {recentActions.slice(0, 3).map((a, i) => (
                  <div key={i} className="flex gap-2.5">
                    <Avatar name={a.actor} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[12px]">
                        <span className="font-semibold text-slate-700">{a.actor}</span>
                        <span className="text-[11px] text-slate-400">{a.time}</span>
                      </div>
                      <div className="mt-0.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[12px] leading-5 text-slate-600">
                        {a.action} · {a.target}
                      </div>
                    </div>
                  </div>
                ))}
                {recentActions.length === 0 && <div className="text-[11px] text-slate-400">暂无最近操作</div>}
              </div>
            </Card>
          </div>
        </div>
      )}
    </PageShell>
  )
}

/** 嵌入数据组件容器：标签 + 内容 */
function EmbeddedBlock({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="my-3 rounded-lg border border-slate-200 bg-slate-50/50 p-3">
      <span className="mb-2 inline-flex items-center gap-1 rounded border border-brand-100 bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700">
        {icon}
        {label}
      </span>
      {children}
    </div>
  )
}
