import { useEffect, useRef, useState } from 'react'
import {
  Workflow, ShieldCheck, Database, Download, Brush, Terminal, Code2, Table2, Boxes,
  RefreshCw, Loader2, FileText, Layers, Activity, GitCommit, GitBranch, Plus, Play, X,
  Undo2, Redo2, Link2, Trash2, Save,
} from 'lucide-react'
import PageShell from '@/components/ui/PageShell'
import Btn from '@/components/ui/Btn'
import { Badge, type BadgeColor } from '@/components/ui/Badge'
import StatCard from '@/components/ui/StatCard'
import DataTable from '@/components/ui/DataTable'
import { Card, CardHeader } from '@/components/ui/Card'
import { Input, Select, Field } from '@/components/ui/Form'
import FlowCanvas, { type FlowNode, type FlowEdge } from '@/components/canvas/FlowCanvas'
import { api } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'

/* ---------------- 类型（与后端返回结构对齐） ---------------- */

/** 管道节点：坐标/连线存在 config 里（x/y/next），随管道定义一起持久化 */
interface PipeNode {
  id: string
  type: string
  config: Record<string, unknown> & { x?: number; y?: number; next?: string }
}
interface PipelineDef {
  id: string
  name: string
  desc: string
  schedule: string
  status: string
  version: number
  nodeCount: number
  nodes?: PipeNode[]
}
interface PipelineRun {
  id: string
  pipelineId: string
  name: string
  schedule: string
  status: string
  duration: string
  rows: number
  detail: string
  time: string
}
interface KnowledgePipeline { docs: number; chunks: number; status: string }
interface PipelinesResp { pipelines: PipelineDef[]; runs: PipelineRun[]; knowledgePipeline: KnowledgePipeline }

/* 写操作响应类型 */
interface CreateResp { id: string }
interface PublishResp { ok: boolean; version: number }
interface ValidateResp { ok: boolean; errors: string[]; nodeCount: number }
interface RunResp { ok: boolean; runId: string; rowsProcessed: number }

interface PipelineForm { name: string; desc: string; schedule: string }
interface ActionOutcome { text: string; error?: boolean }
type ActionKey = 'create' | 'validate' | 'publish' | 'run'

const EMPTY_FORM: PipelineForm = { name: '', desc: '', schedule: '手动' }
const SCHEDULE_OPTIONS = ['手动', '实时', '每小时', '每天', '每周']
/* 新建管道默认节点：source + output，满足后端校验规则 */
const DEFAULT_NODES: { id: string; type: string; config: Record<string, unknown> }[] = [
  { id: 'src', type: 'source', config: { x: 40, y: 60 } },
  { id: 'out', type: 'output', config: { x: 300, y: 60, next: undefined } },
]
const DEF_STATUS_COLOR: Record<string, BadgeColor> = { 草稿: 'slate', 已发布: 'green', 运行中: 'blue' }
function defStatusColor(s: string): BadgeColor { return DEF_STATUS_COLOR[s] ?? 'amber' }

/* ---------------- 管道节点元信息（真实节点渲染，替代旧固定拓扑） ---------------- */

const NODE_META: Record<string, { icon: typeof Database; accent: string; label: string }> = {
  source: { icon: Database, accent: 'bg-brand-50 text-brand-600', label: '数据源' },
  extract: { icon: Download, accent: 'bg-cyan-50 text-cyan-600', label: '抽取' },
  transform: { icon: Terminal, accent: 'bg-slate-100 text-slate-600', label: '转换' },
  clean: { icon: Brush, accent: 'bg-amber-50 text-amber-600', label: '清洗' },
  join: { icon: GitBranch, accent: 'bg-amber-50 text-amber-600', label: '关联' },
  python: { icon: Code2, accent: 'bg-emerald-50 text-emerald-600', label: 'Python' },
  output: { icon: Table2, accent: 'bg-violet-50 text-violet-600', label: '输出' },
  sink: { icon: Boxes, accent: 'bg-violet-50 text-violet-600', label: '落库' },
}
function nodeMeta(type: string) { return NODE_META[type] ?? { icon: Boxes, accent: 'bg-slate-100 text-slate-600', label: type } }

/** 把管道 nodes 转为编辑器节点（缺坐标自动网格布局，缺 id 补 id） */
function toEditorNodes(raw: PipeNode[] | undefined): PipeNode[] {
  return (raw ?? []).map((n, i) => ({
    ...n,
    id: n.id || `n${i + 1}`,
    config: { ...n.config, x: n.config?.x ?? 40 + (i % 4) * 250, y: n.config?.y ?? 40 + Math.floor(i / 4) * 150 },
  }))
}

/** 管道构建器：可视化编排数据管道；定义、校验、发布、运行与运行历史均来自服务端真实数据 */
export default function Pipelines() {
  const q = useApi<PipelinesResp>('/p10plus/pipelines')
  const pipelines = q.data?.pipelines ?? []
  const runs = q.data?.runs ?? []
  const kp = q.data?.knowledgePipeline
  const totalRows = runs.reduce((s, r) => s + r.rows, 0)
  const status = kp?.status ?? '—'
  const running = status === '运行中'

  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null)
  function notify(text: string, error = false) {
    setToast({ text, error })
    setTimeout(() => setToast(null), 2800)
  }

  // 加载/刷新失败时用 toast 提示
  useEffect(() => {
    if (q.error) notify(q.error, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.error])

  function refresh() {
    notify('正在刷新运行数据…')
    q.reload()
  }

  /* 选中管道：数据到达后自动选中首个定义，选择失效时回退 */
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = pipelines.find((p) => p.id === selectedId) ?? null
  useEffect(() => {
    const list = q.data?.pipelines ?? []
    setSelectedId((cur) => (cur && list.some((p) => p.id === cur) ? cur : (list[0]?.id ?? null)))
  }, [q.data])

  /* ---------------- 管道节点编辑器（真实 nodes：拖拽/连线/undo/缩放/保存） ---------------- */
  const [editorNodes, setEditorNodes] = useState<PipeNode[]>([])
  const [history, setHistory] = useState<PipeNode[][]>([[]])
  const [histIdx, setHistIdx] = useState(0)
  const nodesRef = useRef(editorNodes)
  nodesRef.current = editorNodes
  const [selNodeId, setSelNodeId] = useState<string | null>(null)
  const [connectMode, setConnectMode] = useState(false)
  const [connectFrom, setConnectFrom] = useState<string | null>(null)
  const [pendingEdge, setPendingEdge] = useState<FlowEdge | null>(null)
  const [pendingDelNode, setPendingDelNode] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [savingLayout, setSavingLayout] = useState(false)
  const dragSnap = useRef(false)

  // 切换管道 → 重置编辑器为其真实 nodes 与历史
  useEffect(() => {
    const init = toEditorNodes(selected?.nodes ?? [])
    setEditorNodes(init)
    setHistory([init.map((n) => ({ ...n, config: { ...n.config } }))])
    setHistIdx(0)
    setSelNodeId(null); setConnectMode(false); setConnectFrom(null); setDirty(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selected?.version])

  function commitNodes(next: PipeNode[]) {
    setEditorNodes(next)
    setHistory((h) => [...h.slice(0, histIdx + 1), next.map((n) => ({ ...n, config: { ...n.config } }))].slice(-50))
    setHistIdx((i) => Math.min(i + 1, 49))
    setDirty(true)
  }
  function commitCurrent() {
    const snap = nodesRef.current.map((n) => ({ ...n, config: { ...n.config } }))
    setHistory((h) => [...h.slice(0, histIdx + 1), snap].slice(-50))
    setHistIdx((i) => Math.min(i + 1, 49))
    setDirty(true)
  }
  function undo() { if (histIdx <= 0) return; const i = histIdx - 1; setHistIdx(i); setEditorNodes(history[i].map((n) => ({ ...n, config: { ...n.config } }))); setDirty(true) }
  function redo() { if (histIdx >= history.length - 1) return; const i = histIdx + 1; setHistIdx(i); setEditorNodes(history[i].map((n) => ({ ...n, config: { ...n.config } }))); setDirty(true) }
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return
      e.preventDefault()
      e.shiftKey ? redo() : undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function addPipeNode(type: string) {
    const id = `n${Date.now().toString(36)}`
    const maxX = Math.max(0, ...editorNodes.map((n) => n.config.x ?? 0))
    commitNodes([...editorNodes, { id, type, config: { x: Math.min(760, maxX + 250), y: 60 + (editorNodes.length % 2) * 150 } }])
    setSelNodeId(id)
  }
  function handleNodeClick(id: string) {
    if (connectMode) {
      if (!connectFrom) { setConnectFrom(id); notify('已选起点，请点目标节点'); return }
      if (connectFrom === id) { setConnectFrom(null); return }
      commitNodes(editorNodes.map((n) => (n.id === connectFrom ? { ...n, config: { ...n.config, next: id } } : n)))
      notify(`已建立连线：${nodeMeta(editorNodes.find((n) => n.id === connectFrom)?.type ?? '').label} → ${nodeMeta(editorNodes.find((n) => n.id === id)?.type ?? '').label}`)
      setConnectFrom(null); setConnectMode(false); return
    }
    setSelNodeId(id)
  }
  function removePipeEdge(edge: FlowEdge) {
    commitNodes(editorNodes.map((n) => (n.id === edge.from ? { ...n, config: { ...n.config, next: undefined } } : n)))
    setPendingEdge(null)
    notify('连线已删除（该节点将按顺序连接）')
  }
  function removePipeNode(id: string) {
    commitNodes(editorNodes.filter((n) => n.id !== id).map((n) => (n.config.next === id ? { ...n, config: { ...n.config, next: undefined } } : n)))
    if (selNodeId === id) setSelNodeId(null)
    setPendingDelNode(null)
    notify('节点已删除')
  }
  async function saveLayout() {
    if (!selected) return
    setSavingLayout(true)
    try {
      await api('/p10plus/pipelines', {
        method: 'POST',
        body: { id: selected.id, name: selected.name, desc: selected.desc, schedule: selected.schedule, nodes: editorNodes },
      })
      setDirty(false)
      notify('管道拓扑已保存（节点坐标与连线随定义持久化）')
      q.reload()
    } catch (e) { notify(e instanceof Error ? e.message : '保存失败', true) }
    finally { setSavingLayout(false) }
  }

  // 编辑器节点 → 画布
  const editorCanvasNodes: FlowNode[] = editorNodes.map((n) => {
    const m = nodeMeta(n.type)
    return {
      id: n.id, x: n.config.x ?? 40, y: n.config.y ?? 60,
      title: String(n.config.name ?? m.label), subtitle: m.label, icon: m.icon, accent: m.accent, badge: n.type,
    }
  })
  const editorCanvasEdges: FlowEdge[] = []
  for (let i = 0; i < editorNodes.length; i++) {
    const n = editorNodes[i]
    if (n.config.next) editorCanvasEdges.push({ from: n.id, to: n.config.next, label: '连线' })
    else if (i < editorNodes.length - 1) editorCanvasEdges.push({ from: n.id, to: editorNodes[i + 1].id })
  }
  const selEditorNode = editorNodes.find((n) => n.id === selNodeId)

  /* 新建管道弹层 */
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState<PipelineForm>(EMPTY_FORM)
  const [formErr, setFormErr] = useState('')
  function openCreate() { setForm(EMPTY_FORM); setFormErr(''); setCreateOpen(true) }

  /* 写操作 busy：同一时刻仅进行一个动作 */
  const [busy, setBusy] = useState<ActionKey | null>(null)
  const opsBusy = busy !== null
  const noSelection = !selectedId
  const selTip = noSelection ? '请先在「管道列表」中选择或新建一个管道' : undefined

  async function createPipeline() {
    if (!form.name.trim()) { setFormErr('请填写管道名称'); return }
    setBusy('create'); setFormErr('')
    try {
      const res = await api<CreateResp>('/p10plus/pipelines', {
        method: 'POST',
        body: { name: form.name.trim(), desc: form.desc.trim(), schedule: form.schedule, nodes: DEFAULT_NODES },
      })
      setCreateOpen(false)
      setSelectedId(res.id)
      q.reload()
      notify(`管道「${form.name.trim()}」已创建（默认含数据源与输出节点）`)
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : '创建失败')
    } finally {
      setBusy(null)
    }
  }

  /** 对选中管道执行校验 / 发布 / 运行，完成后统一刷新 + toast 反馈 */
  async function execAction<T>(key: ActionKey, path: string, outcome: (d: T) => ActionOutcome) {
    if (!selectedId) return
    setBusy(key)
    try {
      const data = await api<T>(path, { method: 'POST' })
      const r = outcome(data)
      q.reload()
      notify(r.text, r.error ?? false)
    } catch (e) {
      notify(e instanceof Error ? e.message : '操作失败', true)
    } finally {
      setBusy(null)
    }
  }

  function validatePipeline() {
    if (!selectedId) return
    execAction<ValidateResp>('validate', `/p10plus/pipelines/${selectedId}/validate`, (d) =>
      d.ok
        ? { text: `校验通过：${d.nodeCount} 个节点，包含数据源与输出节点` }
        : { text: `校验未通过：${d.errors.join('；')}`, error: true })
  }
  function publishPipeline() {
    if (!selectedId) return
    execAction<PublishResp>('publish', `/p10plus/pipelines/${selectedId}/publish`, (d) =>
      ({ text: `已发布 ${selected?.name ?? '管道'} 新版本 v${d.version}（写入审计）` }))
  }
  function runPipeline() {
    if (!selectedId) return
    execAction<RunResp>('run', `/p10plus/pipelines/${selectedId}/run`, (d) =>
      ({ text: `运行完成：${d.runId}，处理 ${d.rowsProcessed} 行，运行历史已更新` }))
  }

  return (
    <PageShell
      icon={Workflow}
      title="管道构建器"
      subtitle="可视化编排数据管道，管道定义、校验、发布、运行与运行历史均直接来自服务端真实数据"
      benchmark="数据管道"
      features={[
        '管道列表：展示真实管道定义（状态 / 版本 / 节点数 / 调度），可选中并新建管道（默认含数据源与输出节点）',
        '管道操作：对选中管道执行真实校验、发布（草稿→已发布，版本 +1）、运行（统计对象数并写运行记录）',
        '可视化拓扑：数据源 → 抽取 → 清洗 → 转换 → 输出 → 对象索引的链路结构示意（固定拓扑，非实时节点状态）',
        '运行历史：来自 pipeline_runs 真实运行记录（状态 / 时长 / 处理行数 / 明细 / 时间，最近 10 次）',
        '知识管道指标：文档数、文本分块数与运行状态来自真实知识层数据',
        '刷新：重新拉取服务端数据；写操作均真实落库并留审计痕迹',
      ]}
      actions={
        <>
          <Btn size="sm" variant="primary" onClick={refresh}><RefreshCw size={13} /> 刷新数据</Btn>
        </>
      }
    >
      {toast && (
        <div className={cn('rounded-lg border px-4 py-2.5 text-sm font-medium', toast.error ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700')}>
          {toast.text}
        </div>
      )}

      {/* 统计卡：knowledgePipeline 真实值 + runs 真实聚合 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="知识文档" value={kp?.docs ?? 0} icon={FileText} iconClass="bg-brand-50 text-brand-600" footer="当前空间已入库文档数" />
        <StatCard label="文本分块" value={kp?.chunks ?? 0} icon={Layers} iconClass="bg-violet-50 text-violet-600" footer="向量化 / 索引分块数" />
        <StatCard label="知识管道状态" value={status} icon={Activity} iconClass={running ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'} footer="由分块数量判定（运行中 / 空闲）" />
        <StatCard label="运行记录 / 累计行数" value={`${runs.length} / ${totalRows}`} icon={Database} iconClass="bg-cyan-50 text-cyan-600" footer="来自真实 pipeline_runs 运行记录" />
      </div>

      {/* 管道列表：真实管道定义，可选中 / 新建 */}
      <Card padding={false}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-slate-800">管道列表</span>
            <Badge color="slate">{pipelines.length} 个</Badge>
            <span className="text-xs text-slate-400">
              当前选中：<span className="font-medium text-slate-600">{selected?.name ?? '无'}</span>
              {noSelection && '（请选择或新建管道后再执行校验 / 发布 / 运行）'}
            </span>
          </div>
          <Btn size="sm" variant="primary" onClick={openCreate} disabled={opsBusy}><Plus size={13} /> 新建管道</Btn>
        </div>
        <div className="p-4">
          {q.loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" /> 加载管道定义…</div>
          ) : q.error ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">{q.error}</div>
          ) : pipelines.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">暂无管道定义，点击「新建管道」创建（默认含数据源与输出节点）</div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {pipelines.map((p) => {
                const active = p.id === selectedId
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelectedId(p.id)}
                    className={cn(
                      'rounded-xl border p-3 text-left transition-colors',
                      active ? 'border-brand-400 bg-brand-50/40 ring-1 ring-brand-200' : 'border-slate-200 hover:border-brand-300 hover:bg-brand-50/30',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="truncate text-[13.5px] font-bold text-slate-800">{p.name}</span>
                      <Badge color={defStatusColor(p.status)} dot>{p.status}</Badge>
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-slate-400">{p.desc || '—'}</div>
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
                      <span>版本 <b className="font-semibold text-slate-700">v{p.version}</b></span>
                      <span>节点 <b className="font-semibold text-slate-700">{p.nodeCount}</b></span>
                      <span>调度 <b className="font-semibold text-slate-700">{p.schedule}</b></span>
                      <code className="ml-auto truncate font-mono text-[10.5px] text-slate-400">{p.id}</code>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </Card>

      <Card padding={false}>
        {/* 顶部工具栏：状态来自真实 knowledgePipeline.status，写操作接后端 */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-slate-800">数据同步管道</span>
            <Badge color="blue">实时</Badge>
            <Badge color={running ? 'green' : 'slate'} dot>{status}</Badge>
            <Badge color={selected ? 'violet' : 'slate'}>{selected ? `当前：${selected.name}` : '未选择管道'}</Badge>
            <span className="text-xs text-slate-400">
              调度：{selected?.schedule ?? '—'} · 最近 {runs.length} 次运行记录
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Btn size="sm" onClick={refresh} disabled={opsBusy}><RefreshCw size={12} /> 刷新</Btn>
            <Btn size="sm" disabled={noSelection || opsBusy} title={selTip} onClick={validatePipeline}>
              {busy === 'validate' ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />} 校验管道
            </Btn>
            <Btn size="sm" variant="primary" disabled={noSelection || opsBusy} title={selTip} onClick={publishPipeline}>
              {busy === 'publish' ? <Loader2 size={12} className="animate-spin" /> : <GitCommit size={12} />} 发布
            </Btn>
            <Btn size="sm" disabled={noSelection || opsBusy} title={selTip} onClick={runPipeline}>
              {busy === 'run' ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} 运行
            </Btn>
          </div>
        </div>

        {/* 管道画布：真实节点编辑器（选中管道的 nodes；拖拽布局/连线/undo/缩放，保存随定义持久化） */}
        <div className="p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <CardHeader
              className="mb-0"
              title="管道拓扑"
              desc={selected ? `「${selected.name}」的真实节点（v${selected.version} · ${editorNodes.length} 节点）；拖拽/连线/撤销编辑后点「保存布局」持久化` : '暂无管道定义'}
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <select
                onChange={(e) => { if (e.target.value) addPipeNode(e.target.value); e.target.value = '' }}
                disabled={!selected}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-600 disabled:opacity-50"
                value=""
              >
                <option value="">＋ 添加节点…</option>
                {Object.entries(NODE_META).map(([t, m]) => <option key={t} value={t}>{m.label}</option>)}
              </select>
              <Btn size="sm" variant="ghost" onClick={undo} disabled={histIdx <= 0} title="撤销 Ctrl+Z"><Undo2 size={13} /></Btn>
              <Btn size="sm" variant="ghost" onClick={redo} disabled={histIdx >= history.length - 1} title="重做 Ctrl+Shift+Z"><Redo2 size={13} /></Btn>
              <Btn size="sm" variant={connectMode ? 'primary' : 'ghost'} onClick={() => { setConnectMode(!connectMode); setConnectFrom(null) }} title="连接模式"><Link2 size={13} /> 连线</Btn>
              {selNodeId && <Btn size="sm" variant="ghost" onClick={() => setPendingDelNode(selNodeId)} title="删除选中节点"><Trash2 size={13} /></Btn>}
              <Btn size="sm" variant="primary" onClick={saveLayout} disabled={!selected || savingLayout || !dirty} title={dirty ? '保存节点坐标与连线' : '无未保存修改'}>
                {savingLayout ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} 保存布局{dirty ? ' ·' : ''}
              </Btn>
              <span className="flex items-center gap-1 text-[11px] text-slate-400"><GitBranch size={12} /> {editorCanvasNodes.length} 节点 · {editorCanvasEdges.length} 链路</span>
            </div>
          </div>
          <FlowCanvas
            nodes={editorCanvasNodes}
            edges={editorCanvasEdges}
            width={1100}
            height={372}
            zoomable
            selectedId={selNodeId}
            onNodeClick={handleNodeClick}
            onNodeMove={(id, x, y) => setEditorNodes((list) => list.map((n) => (n.id === id ? { ...n, config: { ...n.config, x, y } } : n)))}
            onNodeDragStart={() => { dragSnap.current = true }}
            onNodeDragEnd={() => { if (dragSnap.current) { dragSnap.current = false; commitCurrent() } }}
            onEdgeClick={(e) => setPendingEdge(e)}
            connectMode={connectMode}
            connectFrom={connectFrom}
          />
          <div className="mt-2 rounded-lg border border-dashed border-slate-200 px-3 py-2 text-[11px] leading-5 text-slate-400">
            {connectMode
              ? `连接模式：${connectFrom ? '请点目标节点建立连线' : '请点起点节点'}（再次点「连线」退出）`
              : `节点拖拽布局 · 「连线」模式点两节点连接 · 点连线删除 · Ctrl+Z 撤销 · 滚轮缩放/空白拖拽平移。校验规则：至少一个 source 与一个 output/sink。`}
          </div>
          {/* 选中节点信息条 */}
          {selEditorNode && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
              <Badge color="blue">{nodeMeta(selEditorNode.type).label}</Badge>
              <span className="font-medium">{selEditorNode.id}</span>
              <span className="text-slate-400">后继：</span>
              <select
                value={selEditorNode.config.next ?? ''}
                onChange={(e) => commitNodes(editorNodes.map((n) => (n.id === selEditorNode.id ? { ...n, config: { ...n.config, next: e.target.value || undefined } } : n)))}
                className="rounded border border-slate-200 px-1.5 py-1 text-[11px]"
              >
                <option value="">（按顺序连接）</option>
                {editorNodes.filter((n) => n.id !== selEditorNode.id).map((n) => <option key={n.id} value={n.id}>{n.id} · {nodeMeta(n.type).label}</option>)}
              </select>
            </div>
          )}
        </div>

        {/* 运行历史：真实 pipeline_runs 记录 */}
        <div className="border-t border-slate-100 p-4">
          <CardHeader title="运行历史" desc="来自 pipeline_runs 真实运行记录（状态 / 时长 / 处理行数 / 明细 / 时间，最近 10 次）" actions={<Badge color="slate">{runs.length} 条</Badge>} />
          {q.loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" /> 加载运行历史…</div>
          ) : q.error ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">{q.error}</div>
          ) : (
            <DataTable<PipelineRun>
              dense
              columns={[
                { key: 'name', header: '管道', cell: (r: PipelineRun) => <span className="font-medium text-slate-800">{r.name}</span> },
                { key: 'schedule', header: '调度策略', cell: (r: PipelineRun) => <Badge color="slate">{r.schedule}</Badge> },
                { key: 'duration', header: '运行时长', align: 'right', cell: (r: PipelineRun) => <span className="text-slate-600">{r.duration}</span> },
                { key: 'rows', header: '处理行数', align: 'right', cell: (r: PipelineRun) => <span className="font-semibold text-slate-700">{r.rows}</span> },
                { key: 'detail', header: '变更明细', cell: (r: PipelineRun) => <span className="text-[11px] text-slate-500">{r.detail}</span> },
                {
                  key: 'status', header: '状态', cell: (r: PipelineRun) => (
                    <Badge color={r.status === '成功' ? 'green' : r.status === '运行中' ? 'blue' : 'amber'} dot>{r.status}</Badge>
                  ),
                },
                { key: 'time', header: '运行日期', cell: (r: PipelineRun) => <span className="text-[11px] text-slate-400">{r.time}</span> },
              ]}
              rows={runs}
              rowKey={(r) => r.id}
            />
          )}
        </div>
      </Card>

      {/* 新建管道弹层（真实 POST 提交） */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={() => setCreateOpen(false)}>
          <div className="w-[480px] max-w-[94vw] rounded-2xl border border-slate-200 bg-white p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div className="text-base font-bold text-slate-900">新建管道</div>
              <button onClick={() => setCreateOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={16} /></button>
            </div>
            <div className="grid gap-3.5">
              <Field label="管道名称" required>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如 订单对象同步管道" />
              </Field>
              <Field label="说明">
                <Input value={form.desc} onChange={(e) => setForm({ ...form, desc: e.target.value })} placeholder="管道用途描述（可选）" />
              </Field>
              <Field label="调度策略" hint="新建管道默认含「数据源 source」与「输出 output」两个节点，初始状态为草稿">
                <Select className="w-full" value={form.schedule} onChange={(e) => setForm({ ...form, schedule: e.target.value })}>
                  {SCHEDULE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
              </Field>
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-[11.5px] leading-5 text-slate-500">
                将向 <code className="font-mono">POST /api/p10plus/pipelines</code> 写入管道定义。创建后可「校验」结构、「发布」生成新版本，或「运行」统计当前空间对象数并写入真实运行记录。
              </div>
            </div>
            {formErr && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{formErr}</div>}
            <div className="mt-5 flex justify-end gap-2">
              <Btn onClick={() => setCreateOpen(false)}>取消</Btn>
              <Btn variant="primary" disabled={busy === 'create'} onClick={createPipeline}>
                {busy === 'create' ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} 确认创建
              </Btn>
            </div>
          </div>
        </div>
      )}

      {/* 删除节点确认 */}
      {pendingDelNode && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={() => setPendingDelNode(null)}>
          <div className="w-[400px] max-w-[94vw] rounded-2xl border border-slate-200 bg-white p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-bold text-slate-900">删除节点？</div>
            <div className="mt-1 text-[12px] text-slate-500">节点「{pendingDelNode} · {nodeMeta(editorNodes.find((n) => n.id === pendingDelNode)?.type ?? '').label}」及其连线将移除，保存布局后生效。</div>
            <div className="mt-4 flex justify-end gap-2">
              <Btn size="sm" onClick={() => setPendingDelNode(null)}>取消</Btn>
              <Btn size="sm" variant="danger" onClick={() => removePipeNode(pendingDelNode)}>确认删除</Btn>
            </div>
          </div>
        </div>
      )}
      {/* 删除连线确认 */}
      {pendingEdge && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={() => setPendingEdge(null)}>
          <div className="w-[400px] max-w-[94vw] rounded-2xl border border-slate-200 bg-white p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-bold text-slate-900">删除连线？</div>
            <div className="mt-1 text-[12px] text-slate-500">「{pendingEdge.from} → {pendingEdge.to}」；该节点随后按顺序连接。</div>
            <div className="mt-4 flex justify-end gap-2">
              <Btn size="sm" onClick={() => setPendingEdge(null)}>取消</Btn>
              <Btn size="sm" variant="danger" onClick={() => removePipeEdge(pendingEdge)}>确认删除</Btn>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}
