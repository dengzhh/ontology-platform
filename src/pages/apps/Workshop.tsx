import { useEffect, useMemo, useState } from 'react'
import { MousePointerClick, Plus, Pencil, Trash2, X, Play, Save, Loader2, RefreshCw, Table2, Gauge, BarChart3, Type, FileText } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import PageShell from '@/components/ui/PageShell'
import Btn from '@/components/ui/Btn'
import { Badge, type BadgeColor } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { Input, Select, Field } from '@/components/ui/Form'
import DataTable from '@/components/ui/DataTable'
import { api } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'

/* ---------------- 类型 ---------------- */

interface WidgetConfig { typeId?: string; title?: string; metricKey?: string; aggregation?: string; [k: string]: unknown }
interface Widget { id: string; type: string; config: WidgetConfig }
interface Variable { name: string; type: string; bound?: string }
interface AppRow { id: string; name: string; desc: string; widgetCount: number; updatedAt: string; ownerId: string }
interface AppDetail { id: string; name: string; desc: string; widgets: Widget[]; variables: Variable[] }
interface TypeBrief { id: string; name: string; color: string; count: number; properties: { key: string; name: string; type: string }[] }
interface ListResp { space: { name: string }; types: TypeBrief[]; apps: AppRow[] }

const WIDGET_TYPES = [
  { key: 'stat', label: '统计卡', icon: Gauge },
  { key: 'table', label: '对象表格', icon: Table2 },
  { key: 'chart', label: '柱状图', icon: BarChart3 },
  { key: 'text', label: '文本块', icon: Type },
]

function badgeColor(v: string): BadgeColor {
  if (/运行|正常|完成|活跃|在职|在用|已审批/.test(v)) return 'green'
  if (/维修|待机|处理中|待审核|观察/.test(v)) return 'amber'
  if (/停机|失败|已取消|流失|报废/.test(v)) return 'red'
  return 'blue'
}

/** 运行态组件渲染器（绑定真实对象集） */
function WidgetRunner({ w, types, data }: { w: Widget; types: TypeBrief[]; data: Map<string, { objects: { id: string; values: Record<string, unknown> }[]; total: number }> }) {
  const t = types.find((x) => x.id === w.config.typeId)
  const d = w.config.typeId ? data.get(w.config.typeId) : undefined

  if (w.type === 'stat') {
    let value: string | number = '—'
    if (d && t) {
      if (w.config.aggregation === 'count' || !w.config.aggregation) value = d.total
      else if (w.config.metricKey && d.objects.length > 0) {
        const nums = d.objects.map((o) => Number(o.values[w.config.metricKey!])).filter((x) => !Number.isNaN(x))
        if (nums.length) {
          const sum = nums.reduce((s, x) => s + x, 0)
          value = w.config.aggregation === 'sum' ? Math.round(sum) : Math.round((sum / nums.length) * 10) / 10
        }
      }
    }
    return (
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ background: (t?.color ?? '#3b82f6') + '18' }}>
          <Gauge size={18} style={{ color: t?.color ?? '#3b82f6' }} />
        </div>
        <div>
          <div className="text-xs text-slate-400">{w.config.title || t?.name || '统计'}</div>
          <div className="text-xl font-bold text-slate-900">{value}</div>
        </div>
      </div>
    )
  }

  if (w.type === 'table' && t && d) {
    const cols = t.properties.slice(0, 5)
    return (
      <div>
        <div className="mb-2 text-sm font-semibold text-slate-700">{w.config.title || t.name}</div>
        <DataTable
          dense
          rows={d.objects.slice(0, 8)}
          columns={cols.map((p) => ({
            key: p.key,
            header: p.name,
            cell: (o: { values: Record<string, unknown> }) => {
              const v = o.values[p.key]
              if (v === undefined) return <span className="text-slate-300">—</span>
              if (p.type === 'enum') return <Badge color={badgeColor(String(v))}>{String(v)}</Badge>
              return String(v)
            },
          }))}
        />
      </div>
    )
  }

  if (w.type === 'chart' && t && d && w.config.metricKey) {
    const chartData = d.objects.slice(0, 10).map((o) => ({
      name: String(o.values[t.properties[0]?.key ?? 'id'] ?? o.id).slice(0, 8),
      value: Number(o.values[w.config.metricKey!]) || 0,
    }))
    return (
      <div>
        <div className="mb-2 text-sm font-semibold text-slate-700">{w.config.title || `${t.name}·${w.config.metricKey}`}</div>
        <div className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 5, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {chartData.map((_, i) => <Cell key={i} fill={t.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    )
  }

  if (w.type === 'text') {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
        <FileText size={15} className="mb-1.5 text-slate-400" />
        <div className="text-[13px] leading-6 text-slate-600">{w.config.title || '文本内容……'}</div>
      </div>
    )
  }

  return <div className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-xs text-slate-400">组件未配置或数据源缺失</div>
}

/* ---------------- 主页面 ---------------- */

export default function Workshop() {
  const listQ = useApi<ListResp>('/workshop')
  const types = listQ.data?.types ?? []
  const apps = listQ.data?.apps ?? []
  const [toast, setToast] = useState('')
  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2600) }

  const [view, setView] = useState<'list' | 'edit' | 'run'>('list')
  const [appId, setAppId] = useState<string | null>(null)
  const [appName, setAppName] = useState('')
  const [appDesc, setAppDesc] = useState('')
  const [widgets, setWidgets] = useState<Widget[]>([])
  const [selWidget, setSelWidget] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [runData, setRunData] = useState<Map<string, { objects: { id: string; values: Record<string, unknown> }[]; total: number }>>(new Map())

  const needTypes = useMemo(() => Array.from(new Set(widgets.map((w) => w.config.typeId).filter(Boolean))) as string[], [widgets])

  async function loadRunData(typeIds: string[] = needTypes) {
    const m = new Map<string, { objects: { id: string; values: Record<string, unknown> }[]; total: number }>()
    for (const tid of typeIds) {
      try {
        const r = await api<{ objects: { id: string; values: Record<string, unknown> }[]; total: number }>(`/objects?type=${tid}&limit=20`)
        m.set(tid, r)
      } catch { /* 类型可能不可见 */ }
    }
    setRunData((prev) => {
      const merged = new Map(prev)
      for (const [k, v] of m) merged.set(k, v)
      return merged
    })
  }

  // 编辑态：数据源变化时自动拉取真实数据，实现「配置即所见」的实时预览
  useEffect(() => {
    if (view !== 'edit' && view !== 'run') return
    loadRunData(needTypes)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needTypes.join(','), view])

  async function openApp(id: string, mode: 'edit' | 'run') {
    try {
      const r = await api<{ app: AppDetail }>(`/workshop/${id}`)
      setAppId(id)
      setAppName(r.app.name)
      setAppDesc(r.app.desc)
      setWidgets(r.app.widgets)
      setRunData(new Map())
      setView(mode)
    } catch (e) { notify(e instanceof Error ? e.message : '加载失败') }
  }

  async function saveApp() {
    if (!appId || !appName.trim()) return notify('请填写应用名称')
    setBusy(true)
    try {
      await api(`/workshop/${appId}`, { method: 'PATCH', body: { name: appName, desc: appDesc, widgets } })
      notify('应用已保存')
      listQ.reload()
    } catch (e) { notify(e instanceof Error ? e.message : '保存失败') }
    finally { setBusy(false) }
  }

  async function createApp() {
    setBusy(true)
    try {
      const r = await api<{ id: string }>('/workshop', { method: 'POST', body: { name: `新看板${apps.length + 1}`, desc: '', widgets: [] } })
      notify('应用已创建')
      listQ.reload()
      await openApp(r.id, 'edit')
    } catch (e) { notify(e instanceof Error ? e.message : '创建失败') }
    finally { setBusy(false) }
  }

  async function deleteApp(id: string) {
    try {
      await api(`/workshop/${id}`, { method: 'DELETE' })
      notify('应用已删除')
      setConfirmDel(null)
      listQ.reload()
    } catch (e) { notify(e instanceof Error ? e.message : '删除失败') }
  }

  function addWidget(type: string) {
    const w: Widget = { id: `w-${Date.now().toString(36)}`, type, config: {} }
    setWidgets([...widgets, w])
    setSelWidget(w.id)
  }

  function updateWidget(id: string, patch: Partial<WidgetConfig>) {
    setWidgets(widgets.map((w) => (w.id === id ? { ...w, config: { ...w.config, ...patch } } : w)))
  }

  const sel = widgets.find((w) => w.id === selWidget)

  /* ---------- 列表视图 ---------- */
  if (view === 'list') {
    return (
      <PageShell
        icon={MousePointerClick}
        title="Workshop 应用搭建"
        subtitle="拖拽组件搭建运营看板，组件绑定当前空间的真实对象集"
        benchmark="低代码搭建"
        features={[
          '可视化搭建：统计卡/对象表格/柱状图/文本块四种组件，配置即所见',
          '真实数据绑定：组件从当前空间的对象类型拉取实时数据（含聚合：计数/求和/均值）',
          '编辑/运行双模式：编辑态配置组件参数，运行态渲染看板',
          '空间隔离：应用归属当前本体空间，成员可编辑自己的应用',
        ]}
        actions={<Btn size="sm" variant="primary" disabled={busy} onClick={createApp}><Plus size={14} /> 新建看板</Btn>}
      >
        {toast && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">{toast}</div>}

        {listQ.loading ? (
          <div className="flex items-center justify-center gap-2 py-14 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" /> 加载应用列表…</div>
        ) : apps.length === 0 ? (
          <Card className="py-14 text-center text-sm text-slate-400">
            暂无看板应用，点击右上「新建看板」搭建第一个
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {apps.map((a) => (
              <Card key={a.id} className="group cursor-pointer transition-colors hover:border-brand-300">
                <div onClick={() => openApp(a.id, 'run')} className="mb-2 flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-500 text-white"><MousePointerClick size={16} /></div>
                    <div>
                      <div className="text-[14px] font-bold text-slate-800">{a.name}</div>
                      <div className="text-[11px] text-slate-400">{a.widgetCount} 个组件 · {a.updatedAt}</div>
                    </div>
                  </div>
                  <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button onClick={(e) => { e.stopPropagation(); openApp(a.id, 'edit') }} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-brand-600"><Pencil size={13} /></button>
                    {confirmDel === a.id ? (
                      <>
                        <button onClick={(e) => { e.stopPropagation(); deleteApp(a.id) }} className="rounded bg-red-500 px-1.5 text-[10px] text-white">确认</button>
                        <button onClick={(e) => { e.stopPropagation(); setConfirmDel(null) }} className="text-[10px] text-slate-400">取消</button>
                      </>
                    ) : (
                      <button onClick={(e) => { e.stopPropagation(); setConfirmDel(a.id) }} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 hover:text-red-500"><Trash2 size={13} /></button>
                    )}
                  </div>
                </div>
                {a.desc && <div className="text-xs text-slate-500">{a.desc}</div>}
                <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                  <span>空间：{listQ.data?.space.name}</span>
                  <span className="flex items-center gap-1 text-brand-600">打开看板 →</span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </PageShell>
    )
  }

  /* ---------- 编辑视图 ---------- */
  if (view === 'edit') {
    return (
      <PageShell
        icon={MousePointerClick}
        title="编辑看板"
        subtitle={`${appName} · 配置组件参数，下方画布实时预览真实数据`}
        benchmark="低代码搭建"
        features={['配置组件的数据源与参数', '编辑态画布实时预览真实对象数据（配置即所见）', '切到「运行」查看完整看板布局', '保存后应用归属当前空间']}
        actions={
          <>
            <Btn size="sm" onClick={() => setView('list')}><X size={13} /> 返回列表</Btn>
            <Btn size="sm" onClick={() => setView('run')}><Play size={13} /> 运行</Btn>
            <Btn size="sm" variant="primary" disabled={busy} onClick={saveApp}>{busy ? <><Loader2 size={13} className="animate-spin" /> 保存中…</> : <><Save size={13} /> 保存</>}</Btn>
          </>
        }
      >
        {toast && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">{toast}</div>}

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[200px_minmax(0,1fr)_280px]">
          <div className="card h-fit p-3">
            <div className="mb-2 text-xs font-semibold text-slate-500">添加组件</div>
            {WIDGET_TYPES.map((w) => (
              <button key={w.key} onClick={() => addWidget(w.key)} className="mb-1.5 flex w-full items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-2 text-[12px] text-slate-600 hover:border-brand-300 hover:bg-brand-50/50 hover:text-brand-700">
                <w.icon size={13} className="text-slate-400" /> {w.label}
              </button>
            ))}
          </div>

          <div className="canvas-grid min-h-[400px] rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2 text-[11px] text-emerald-700">
              <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> 实时预览 · 组件绑定真实对象数据，右侧改配置此处即时变化</span>
              <button onClick={() => loadRunData()} className="flex items-center gap-1 font-medium hover:underline"><RefreshCw size={11} /> 刷新数据</button>
            </div>
            <Field label="应用名称" required><Input value={appName} onChange={(e) => setAppName(e.target.value)} /></Field>
            <div className="mt-2"><Field label="描述"><Input value={appDesc} onChange={(e) => setAppDesc(e.target.value)} placeholder="一句话说明看板用途" /></Field></div>

            <div className="mt-4 space-y-3">
              {widgets.length === 0 && (
                <div className="rounded-xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-400">
                  点击左侧组件添加到看板
                </div>
              )}
              {widgets.map((w) => (
                <div key={w.id} onClick={() => setSelWidget(w.id)} className={cn('cursor-pointer rounded-xl border-2 p-3 transition-colors', selWidget === w.id ? 'border-brand-400 bg-brand-50/20' : 'border-transparent hover:border-brand-200')}>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-400">{WIDGET_TYPES.find((x) => x.key === w.type)?.label}</span>
                    <div className="flex gap-1">
                      <button onClick={(e) => { e.stopPropagation(); setSelWidget(w.id) }} className="text-[10px] text-brand-600">配置</button>
                      <button onClick={(e) => { e.stopPropagation(); setWidgets(widgets.filter((x) => x.id !== w.id)) }} className="text-[10px] text-slate-300 hover:text-red-500">删除</button>
                    </div>
                  </div>
                  <WidgetRunner w={w} types={types} data={runData} />
                </div>
              ))}
            </div>
          </div>

          <div className="card h-fit p-3.5">
            <div className="mb-2.5 text-xs font-semibold text-slate-600">组件配置</div>
            {sel ? (
              <div className="space-y-3">
                <Field label="标题"><Input value={sel.config.title ?? ''} onChange={(e) => updateWidget(sel.id, { title: e.target.value })} placeholder="组件标题（可选）" /></Field>
                <Field label="数据源（对象类型）">
                  <Select className="w-full" value={sel.config.typeId ?? ''} onChange={(e) => updateWidget(sel.id, { typeId: e.target.value, metricKey: '' })}>
                    <option value="">选择…</option>
                    {types.map((t) => <option key={t.id} value={t.id}>{t.name}({t.count})</option>)}
                  </Select>
                </Field>
                {sel.type === 'stat' && (
                  <>
                    <Field label="聚合方式">
                      <Select className="w-full" value={sel.config.aggregation ?? 'count'} onChange={(e) => updateWidget(sel.id, { aggregation: e.target.value })}>
                        <option value="count">计数（实例总数）</option>
                        <option value="sum">求和</option>
                        <option value="avg">均值</option>
                      </Select>
                    </Field>
                    {(sel.config.aggregation === 'sum' || sel.config.aggregation === 'avg') && (
                      <Field label="指标字段（数值）">
                        <Select className="w-full" value={sel.config.metricKey ?? ''} onChange={(e) => updateWidget(sel.id, { metricKey: e.target.value })}>
                          <option value="">选择…</option>
                          {(types.find((t) => t.id === sel.config.typeId)?.properties ?? []).filter((p) => p.type === 'number').map((p) => (
                            <option key={p.key} value={p.key}>{p.name}</option>
                          ))}
                        </Select>
                      </Field>
                    )}
                  </>
                )}
                {sel.type === 'chart' && (
                  <Field label="Y 轴字段（数值）">
                    <Select className="w-full" value={sel.config.metricKey ?? ''} onChange={(e) => updateWidget(sel.id, { metricKey: e.target.value })}>
                      <option value="">选择…</option>
                      {(types.find((t) => t.id === sel.config.typeId)?.properties ?? []).filter((p) => p.type === 'number').map((p) => (
                        <option key={p.key} value={p.key}>{p.name}</option>
                      ))}
                    </Select>
                  </Field>
                )}
              </div>
            ) : (
              <div className="text-center text-xs text-slate-400">点击画布中的组件进行配置</div>
            )}
          </div>
        </div>
      </PageShell>
    )
  }

  /* ---------- 运行视图 ---------- */
  return (
    <PageShell
      icon={Play}
      title={appName}
      subtitle={appDesc || '运行中的看板 · 组件绑定真实对象集'}
      benchmark="低代码搭建"
      features={['组件绑定当前空间真实对象集', '点击刷新重新拉取数据']}
      actions={
        <>
          <Btn size="sm" onClick={() => { loadRunData(); notify('数据已刷新') }}><RefreshCw size={13} /> 刷新</Btn>
          <Btn size="sm" onClick={() => setView('edit')}><Pencil size={13} /> 编辑</Btn>
          <Btn size="sm" onClick={() => setView('list')}><X size={13} /> 关闭</Btn>
        </>
      }
    >
      {toast && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">{toast}</div>}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {widgets.map((w) => (
          <div key={w.id} className={cn(w.type === 'table' && 'md:col-span-2 xl:col-span-2')}>
            <WidgetRunner w={w} types={types} data={runData} />
          </div>
        ))}
        {widgets.length === 0 && <Card className="py-14 text-center text-sm text-slate-400 md:col-span-3">此看板暂无组件</Card>}
      </div>
    </PageShell>
  )
}
