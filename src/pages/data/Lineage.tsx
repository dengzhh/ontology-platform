import { useEffect, useMemo, useState } from 'react'
import { Waypoints, AlertTriangle, Database, Boxes, LayoutDashboard, Bot, Loader2, RefreshCw } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import PageShell from '@/components/ui/PageShell'
import { Badge } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import { KVList } from '@/components/ui/Misc'
import Btn from '@/components/ui/Btn'
import GraphCanvas, { type GraphNode, type GraphLink } from '@/components/canvas/GraphCanvas'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'

/* ---------------- 类型（与后端返回结构对齐） ---------------- */

interface SourceNode { id: string; name: string; type: string; count: number; color: string }
interface ProcessNode { id: string; name: string; type: string; sourceId: string; targetId: string }
interface OutputNode { id: string; name: string; type: string; widgetCount: number }
interface ConsumerNode { id: string; name: string; type: string; chunks: number }
interface Layers {
  sources: SourceNode[]
  processes: ProcessNode[]
  outputs: OutputNode[]
  consumers: ConsumerNode[]
}
interface DependentType { typeId: string; typeName: string; objectCount: number }
interface AppDependency { appName: string; dependentTypes: DependentType[] }
interface LineageResp { layers: Layers; appDependencies: AppDependency[] }

/** 四层配色（与图谱图例一致） */
const COLORS = {
  source: '#64748b',   // 数据源 / 对象类型 slate
  process: '#3b82f6',  // 链接处理 blue
  output: '#10b981',   // 下游应用 emerald
  consumer: '#8b5cf6', // 知识消费 violet
}

const LAYER_LABELS: Record<string, string> = {
  source: '数据源 / 对象类型', process: '链接处理', output: '下游应用', consumer: '知识消费',
}

/** 统一节点用于选中/详情：由 layers 四类节点汇总而来 */
interface FlatNode {
  id: string
  label: string
  kind: 'source' | 'process' | 'output' | 'consumer'
  meta: string
  /** 关联的对象实例数 / 组件数 / 分块数，用于影响分析规模 */
  size: number
}

const APP_ICON_FALLBACK: LucideIcon = LayoutDashboard
function appIcon(name: string): LucideIcon {
  if (/看板|仪表|dashboard/i.test(name)) return LayoutDashboard
  if (/bot|agent|智能|助手/i.test(name)) return Bot
  return APP_ICON_FALLBACK
}

/* ---------------- 规模控制 ---------------- */
/** 每层默认展示的代表性节点数（按实例规模降序）；完整视图也设硬上限，防止大空间把画布拉爆 */
const DEFAULT_PER_LAYER = 8
const MAX_PER_LAYER = 40
const MIN_GAP = 76 // 节点最小垂直间距（圆 ~26 + 两行文字 ~40 + 余量）
const TOP = 60

/** 数据血缘：端到端影响分析（图谱默认聚焦代表性节点，规模数据保留在右侧列表） */
export default function Lineage() {
  const q = useApi<LineageResp>('/p10plus/lineage')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [fullView, setFullView] = useState(false)
  /** 展开全部的四层开关（精简视图下单独展开某一层） */
  const [expandedLayers, setExpandedLayers] = useState<Record<string, boolean>>({})
  function toggleLayer(k: string) { setExpandedLayers((m) => ({ ...m, [k]: !m[k] })) }

  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null)
  function notify(text: string, error = false) {
    setToast({ text, error })
    setTimeout(() => setToast(null), 2800)
  }
  useEffect(() => {
    if (q.error) notify(q.error, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.error])

  const layers = q.data?.layers
  const appDeps = q.data?.appDependencies ?? []

  /* 由真实 layers 生成图节点与连线：四层按列排布。
   * 规模控制：默认每层只画代表性节点（按实例规模降序），其余聚合为一个「+N」汇总节点；
   * 「完整视图」或单层「展开」时也设 MAX_PER_LAYER 硬上限，超出部分只在右侧列表/详情里检索。
   * 画布高度按实际绘制行数计算，不再被某一层上百个分块拉爆。 */
  const { nodes, links, flatNodes, canvasW, canvasH, hiddenCounts } = useMemo(() => {
    const nodes: GraphNode[] = []
    const links: GraphLink[] = []
    const flat: FlatNode[] = []
    const hiddenCounts = { source: 0, process: 0, output: 0, consumer: 0 }
    if (!layers) return { nodes, links, flatNodes: flat, canvasW: 1160, canvasH: 560, hiddenCounts }

    const { sources, processes, outputs, consumers } = layers
    const colX = { source: 150, process: 460, output: 800, consumer: 1080 }
    const canvasW = 1230

    /** 该层允许绘制的数量：完整视图/展开→上限，精简→默认前 N */
    function cap(kind: string, total: number): number {
      const limit = (fullView || expandedLayers[kind]) ? MAX_PER_LAYER : DEFAULT_PER_LAYER
      return Math.min(total, limit)
    }
    /** 按规模降序取前 cap 个；同时把全量登记进 flat（右侧列表仍可检索所有节点） */
    function pick<T>(kind: string, list: T[], sizeOf: (x: T) => number): T[] {
      const sorted = [...list].sort((a, b) => sizeOf(b) - sizeOf(a))
      hiddenCounts[kind as keyof typeof hiddenCounts] = Math.max(0, sorted.length - cap(kind, sorted.length))
      return sorted.slice(0, cap(kind, sorted.length))
    }

    const shownSources = pick('source', sources, (s) => s.count)
    const shownProcesses = pick('process', processes, () => 0)
    const shownOutputs = pick('output', outputs, (o) => o.widgetCount)
    const shownConsumers = pick('consumer', consumers, (c) => c.chunks)

    const shownCount = Math.max(shownSources.length, shownProcesses.length, shownOutputs.length, shownConsumers.length, 1)
    const canvasH = Math.max(560, TOP * 2 + (shownCount - 1) * MIN_GAP)
    // 节点在画布垂直方向居中铺开，行数少时不会全部挤在顶部
    const spread = (count: number, i: number) => {
      if (count <= 1) return canvasH / 2
      const used = (count - 1) * MIN_GAP
      const start = (canvasH - used) / 2
      return start + i * MIN_GAP
    }

    // 全量登记（右侧「选择节点」列表与影响分析始终覆盖所有数据）
    sources.forEach((s) => flat.push({ id: s.id, label: s.name, kind: 'source', meta: `${s.count} 个对象实例`, size: s.count }))
    processes.forEach((p) => flat.push({ id: p.id, label: p.name, kind: 'process', meta: `链接：${p.sourceId} → ${p.targetId}`, size: 0 }))
    outputs.forEach((o) => flat.push({ id: o.id, label: o.name, kind: 'output', meta: `${o.widgetCount} 个组件`, size: o.widgetCount }))
    consumers.forEach((c) => flat.push({ id: c.id, label: c.name, kind: 'consumer', meta: `${c.chunks} 个文本分块`, size: c.chunks }))

    // 只画代表性节点
    shownSources.forEach((s, i) => nodes.push({ id: s.id, x: colX.source, y: spread(shownSources.length, i), label: s.name, sub: `${s.count} 个实例`, color: s.color || COLORS.source }))
    shownProcesses.forEach((p, i) => {
      const y = spread(shownProcesses.length, i)
      nodes.push({ id: p.id, x: colX.process, y, label: p.name, sub: '链接类型', color: COLORS.process, size: 22 })
      if (nodes.some((n) => n.id === p.sourceId)) links.push({ source: p.sourceId, target: p.id })
      if (nodes.some((n) => n.id === p.targetId)) links.push({ source: p.id, target: p.targetId, label: '关联' })
    })
    shownOutputs.forEach((o, i) => nodes.push({ id: o.id, x: colX.output, y: spread(shownOutputs.length, i), label: o.name, sub: `${o.widgetCount} 个组件`, color: COLORS.output, size: 24 }))
    shownConsumers.forEach((c, i) => nodes.push({ id: c.id, x: colX.consumer, y: spread(shownConsumers.length, i), label: c.name, sub: `${c.chunks} 个分块`, color: COLORS.consumer, size: 22 }))

    // 每层折叠的「+N」汇总节点（点击可展开该层）
    const summaryNodes: { kind: string; x: number; hidden: number; list: { length: number }; color: string }[] = [
      { kind: 'source', x: colX.source, hidden: hiddenCounts.source, list: shownSources, color: COLORS.source },
      { kind: 'process', x: colX.process, hidden: hiddenCounts.process, list: shownProcesses, color: COLORS.process },
      { kind: 'output', x: colX.output, hidden: hiddenCounts.output, list: shownOutputs, color: COLORS.output },
      { kind: 'consumer', x: colX.consumer, hidden: hiddenCounts.consumer, list: shownConsumers, color: COLORS.consumer },
    ]
    for (const s of summaryNodes) {
      if (s.hidden <= 0) continue
      nodes.push({
        id: `more:${s.kind}`,
        x: s.x, y: canvasH - 42,
        label: `+${s.hidden} 个${LAYER_LABELS[s.kind]}…`,
        sub: '点击展开',
        color: s.color,
        size: 18,
      })
    }

    // 应用 → 其依赖的对象类型（真实 appDependencies）
    for (const app of appDeps) {
      const appNode = shownOutputs.find((o) => o.name === app.appName)
      if (!appNode) continue
      for (const t of app.dependentTypes) {
        if (nodes.some((n) => n.id === t.typeId)) links.push({ source: t.typeId, target: appNode.id, label: 'OSDK' })
      }
    }
    // 输出应用 → 知识文档消费（示意层间连线，均基于真实节点）
    if (shownOutputs.length > 0 && shownConsumers.length > 0) {
      shownConsumers.forEach((c, i) => links.push({ source: shownOutputs[i % shownOutputs.length].id, target: c.id, label: '引用' }))
    }

    return { nodes, links, flatNodes: flat, canvasW, canvasH, hiddenCounts }
  }, [layers, appDeps, fullView, expandedLayers])

  // 选中节点：默认第一个，数据变化时纠正
  const selected = flatNodes.find((n) => n.id === selectedId) ?? flatNodes[0] ?? null

  /* 影响分析：基于真实 appDependencies 计算，完全不写死 */
  const impact = useMemo(() => {
    if (!selected || !layers) return { apps: [] as { appName: string; types: DependentType[] }[], dependentTypes: [] as DependentType[], processes: [] as ProcessNode[] }
    const { processes } = layers

    if (selected.kind === 'source') {
      // 对象类型节点：哪些应用依赖它，以及涉及它的链接处理
      const apps = appDeps
        .map((a) => ({ appName: a.appName, types: a.dependentTypes.filter((t) => t.typeId === selected.id) }))
        .filter((a) => a.types.length > 0)
      const dependentTypes = appDeps.flatMap((a) => a.dependentTypes).filter((t) => t.typeId === selected.id)
      const relProcesses = processes.filter((p) => p.sourceId === selected.id || p.targetId === selected.id)
      return { apps, dependentTypes, processes: relProcesses }
    }
    if (selected.kind === 'output') {
      // 应用节点：它依赖的对象类型
      const dep = appDeps.find((a) => a.appName === selected.label)
      const apps = dep && dep.dependentTypes.length > 0 ? [{ appName: dep.appName, types: dep.dependentTypes }] : []
      return { apps, dependentTypes: dep?.dependentTypes ?? [], processes: [] }
    }
    if (selected.kind === 'process') {
      const p = processes.find((x) => x.id === selected.id)
      const related = p ? processes.filter((x) => x.sourceId === p.sourceId || x.targetId === p.targetId || x.id === p.id) : []
      return { apps: [], dependentTypes: [], processes: related }
    }
    return { apps: [], dependentTypes: [], processes: [] }
  }, [selected, layers, appDeps])

  const downstreamApps = impact.apps
  const totalAffectedObjects = impact.dependentTypes.reduce((s, t) => s + t.objectCount, 0)
  const critical = selected?.kind === 'source' && downstreamApps.length >= 2

  const layerCounts = layers
    ? { s: layers.sources.length, p: layers.processes.length, o: layers.outputs.length, c: layers.consumers.length }
    : { s: 0, p: 0, o: 0, c: 0 }

  return (
    <PageShell
      icon={Waypoints}
      title="数据血缘"
      subtitle="从对象类型到下游应用的全链路血缘图谱，变更前基于真实依赖完成影响分析"
      benchmark="血缘分析"
      features={[
        '四层血缘图谱：对象类型 → 链接处理 → 下游应用 → 知识消费，由服务端 layers 动态生成',
        '真实依赖：应用与对象类型的依赖关系来自 appDependencies，图谱连线据此计算',
        '影响分析：选中任一节点，查看依赖它的应用、被依赖类型与相关链接处理',
        '实例规模：对象实例数 / 组件数 / 分块数均取自真实数据',
        '规模控制：默认每层只画规模最大的 8 个代表性节点，其余聚合为「+N」节点可点击展开；完整视图每层上限 40，超出部分保留在右侧列表检索，避免节点过多拖慢页面',
        '节点切换：点击节点按钮查看对应详情与影响范围',
      ]}
      actions={
        <>
          <Btn size="sm" variant={fullView ? 'primary' : 'ghost'} onClick={() => setFullView(!fullView)}>
            {fullView ? '切换精简视图' : '完整视图'}
          </Btn>
          <Btn size="sm" variant="primary" onClick={() => { notify('正在刷新血缘数据…'); q.reload() }}><RefreshCw size={13} /> 刷新</Btn>
        </>
      }
    >
      {toast && (
        <div className={cn('rounded-lg border px-4 py-2.5 text-sm font-medium', toast.error ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700')}>
          {toast.text}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card padding={false}>
          <div className="border-b border-slate-100 px-4 py-3">
            <CardHeader
              className="mb-0"
              title="全链路血缘图谱"
              desc={`${layerCounts.s} 个对象类型 · ${layerCounts.p} 条链接处理 · ${layerCounts.o} 个下游应用 · ${layerCounts.c} 个知识消费 · ${links.length} 条血缘边`}
              actions={<Badge color="blue" dot>实时同步</Badge>}
            />
          </div>
          <div className="p-4">
            {q.loading ? (
              <div className="flex h-[320px] items-center justify-center gap-2 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" /> 加载血缘数据…</div>
            ) : q.error ? (
              <div className="m-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">{q.error}</div>
            ) : nodes.length === 0 ? (
              <div className="flex h-[320px] items-center justify-center text-sm text-slate-400">当前空间暂无血缘节点数据</div>
            ) : (
              <>
                {/* 点击「+N」聚合节点展开该层（GraphCanvas 的 data-node 事件委托） */}
                <div onClick={(e) => {
                  const g = (e.target as Element).closest('[data-node^="more:"]') as SVGGElement | null
                  const kind = g?.getAttribute('data-node')?.slice(5)
                  if (kind) { toggleLayer(kind); notify(`已展开「${LAYER_LABELS[kind]}」层全部节点`) }
                }}>
                  <GraphCanvas
                    nodes={nodes}
                    links={links}
                    width={canvasW}
                    height={canvasH}
                    zoomable
                    viewportHeight={Math.min(760, Math.max(560, Math.round(canvasH * 0.6)))}
                    legend={[
                      { label: '对象类型 / 数据源', color: COLORS.source },
                      { label: '链接处理', color: COLORS.process },
                      { label: '下游应用', color: COLORS.output },
                      { label: '知识消费', color: COLORS.consumer },
                    ]}
                  />
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-1 px-1 text-[11px] text-slate-400">
                  <span>
                    画布 {nodes.length} 个节点 · {fullView ? '完整视图（每层上限 40）' : '精简视图（每层前 8 个代表性节点）'} · 行距 {MIN_GAP}px
                    {Object.values(hiddenCounts).some((n) => n > 0) && (
                      <span className="ml-1 text-amber-600">
                        · 未在图上的：对象类型 {hiddenCounts.source} / 链接 {hiddenCounts.process} / 应用 {hiddenCounts.output} / 知识消费 {hiddenCounts.consumer}（点「+N」展开或右侧列表检索）
                      </span>
                    )}
                  </span>
                  <span>可滚轮缩放 / 拖拽平移查看密集区域</span>
                </div>
              </>
            )}
          </div>
        </Card>

        {/* 右：选中节点详情 + 真实影响分析 */}
        <div className="flex flex-col gap-4">
          <Card>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500">选择节点</span>
              <span className="text-[11px] text-slate-400">共 {flatNodes.length} 个</span>
            </div>
            <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
              {flatNodes.map((n) => (
                <button
                  key={n.id}
                  onClick={() => setSelectedId(n.id)}
                  className={cn(
                    'rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors',
                    selected?.id === n.id ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600 hover:border-brand-200 hover:text-brand-600',
                  )}
                >
                  {n.label}
                </button>
              ))}
              {flatNodes.length === 0 && <span className="text-xs text-slate-400">暂无节点</span>}
            </div>
          </Card>

          {selected ? (
            <Card>
              <CardHeader
                title={<span className="flex items-center gap-1.5">
                  {selected.kind === 'source' ? <Database size={14} className="text-brand-600" /> : selected.kind === 'output' ? <LayoutDashboard size={14} className="text-emerald-600" /> : <Boxes size={14} className="text-brand-600" />}
                  {selected.label}
                </span>}
                desc={LAYER_LABELS[selected.kind]}
                actions={<Badge color={selected.kind === 'output' ? 'green' : selected.kind === 'process' ? 'blue' : selected.kind === 'consumer' ? 'violet' : 'slate'}>{LAYER_LABELS[selected.kind]}</Badge>}
              />
              <KVList
                cols={1}
                items={[
                  { k: '节点类型', v: LAYER_LABELS[selected.kind] },
                  { k: '规模 / 说明', v: selected.meta },
                  { k: '关联下游应用', v: selected.kind === 'output' ? '—（本节点即应用）' : `${downstreamApps.length} 个` },
                  { k: '关联链接处理', v: `${impact.processes.length} 条` },
                ]}
              />
            </Card>
          ) : (
            <Card className="flex min-h-[120px] items-center justify-center text-xs text-slate-400">暂无节点详情</Card>
          )}

          {/* 影响分析：基于真实 appDependencies 计算 */}
          <div className={cn('rounded-xl border p-4', critical ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50')}>
            <div className="mb-2 flex items-center gap-2">
              <AlertTriangle size={16} className={critical ? 'text-red-500' : 'text-amber-500'} />
              <span className={cn('text-sm font-bold', critical ? 'text-red-600' : 'text-amber-600')}>影响分析</span>
              <Badge color={critical ? 'red' : 'amber'}>{downstreamApps.length} 个下游应用</Badge>
            </div>
            <p className={cn('text-[13px] font-medium leading-5', critical ? 'text-red-600' : 'text-amber-700')}>
              {selected
                ? selected.kind === 'output'
                  ? `应用「${selected.label}」依赖 ${impact.dependentTypes.length} 类对象类型，涉及 ${totalAffectedObjects} 个对象实例。`
                  : selected.kind === 'source'
                    ? `变更对象类型「${selected.label}」将影响 ${downstreamApps.length} 个下游应用，波及 ${totalAffectedObjects} 个对象实例与 ${impact.processes.length} 条链接处理。`
                    : `节点「${selected.label}」关联 ${impact.processes.length || downstreamApps.length} 项上下游血缘。`
                : '选择一个节点后查看影响范围。'}
            </p>

            {downstreamApps.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {downstreamApps.map((a) => {
                  const Icon = appIcon(a.appName)
                  return (
                    <span key={a.appName} className="inline-flex items-center gap-1 rounded-md border border-white bg-white/80 px-2 py-1 text-[11px] font-medium text-slate-700 shadow-sm">
                      <Icon size={11} className="text-emerald-600" />
                      {a.appName}
                    </span>
                  )
                })}
              </div>
            )}

            {impact.dependentTypes.length > 0 && (
              <div className="mt-3 rounded-lg bg-white/70 px-2.5 py-2">
                <div className="mb-1 text-[11px] font-medium text-slate-500">被依赖的对象类型</div>
                <div className="space-y-1">
                  {impact.dependentTypes.map((t) => (
                    <div key={t.typeId} className="flex items-center justify-between text-[11px] text-slate-600">
                      <span>{t.typeName}</span>
                      <span className="font-semibold">{t.objectCount} 个实例</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {impact.processes.length > 0 && (
              <div className="mt-2 rounded-lg bg-white/70 px-2.5 py-2">
                <div className="mb-1 text-[11px] font-medium text-slate-500">相关链接处理</div>
                <div className="flex flex-wrap gap-1">
                  {impact.processes.map((p) => <span key={p.id} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{p.name}</span>)}
                </div>
              </div>
            )}
            <div className="mt-3 text-[11px] leading-4 text-slate-500">
              依赖关系与实例计数均来自服务端 appDependencies 与对象类型真实数据。
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  )
}
