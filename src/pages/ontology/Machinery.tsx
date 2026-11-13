import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Route, Zap, RefreshCw, Loader2, UserRound, ClipboardCheck, Clock,
  CheckCircle2, AlertTriangle, XCircle, ArrowRight, Activity, FileText,
  Play, Bell, Undo2, Redo2, Link2, Trash2, Save, Plus, X,
} from 'lucide-react'
import PageShell from '@/components/ui/PageShell'
import { Badge, type BadgeColor } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import { KVList, SectionTitle } from '@/components/ui/Misc'
import Btn from '@/components/ui/Btn'
import Tabs from '@/components/ui/Tabs'
import { Input, Field, Select } from '@/components/ui/Form'
import FlowCanvas, { type FlowNode, type FlowEdge, type FlowStatus } from '@/components/canvas/FlowCanvas'
import { api } from '@/lib/api'
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

/** 自定义流程（可编辑持久化） */
interface MachNode {
  id: string
  type: 'start' | 'action' | 'approval' | 'notify' | 'end'
  label: string
  actionId?: string
  x?: number
  y?: number
  next?: string
}
interface MachFlow { id: string; name: string; nodes: MachNode[]; updatedAt: number }
interface ActionItem { id: string; name: string; needsApproval: boolean }

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

/* 流程编排节点元信息 */
const NODE_META: Record<MachNode['type'], { icon: typeof Zap; accent: string; label: string }> = {
  start: { icon: Play, accent: 'bg-emerald-50 text-emerald-600', label: '开始' },
  action: { icon: Zap, accent: 'bg-brand-50 text-brand-600', label: '执行动作' },
  approval: { icon: ClipboardCheck, accent: 'bg-amber-50 text-amber-600', label: '人工审批' },
  notify: { icon: Bell, accent: 'bg-cyan-50 text-cyan-600', label: '发送通知' },
  end: { icon: CheckCircle2, accent: 'bg-slate-100 text-slate-500', label: '结束' },
}

function defaultMachNodes(): MachNode[] {
  return [
    { id: 's1', type: 'start', label: '发起申请', x: 40, y: 80, next: 's2' },
    { id: 's2', type: 'approval', label: '主管审批', x: 280, y: 80, next: 's3' },
    { id: 's3', type: 'action', label: '执行动作', x: 520, y: 80, next: 's4' },
    { id: 's4', type: 'notify', label: '结果通知', x: 760, y: 80, next: 's5' },
    { id: 's5', type: 'end', label: '流程结束', x: 820, y: 80 },
  ]
}
function toEditorNodes(raw: MachNode[]): MachNode[] {
  return (raw ?? []).map((n, i) => ({ ...n, x: n.x ?? 40 + (i % 3) * 250, y: n.y ?? 40 + Math.floor(i / 3) * 150 }))
}

/** 通用确认弹层 */
function ConfirmModal({ title, desc, onCancel, onConfirm }: { title: string; desc: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={onCancel}>
      <div className="w-[400px] max-w-[94vw] rounded-2xl border border-slate-200 bg-white p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-bold text-slate-900">{title}</div>
          <button aria-label="关闭" onClick={onCancel} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={16} /></button>
        </div>
        <div className="text-[12px] leading-5 text-slate-500">{desc}</div>
        <div className="mt-4 flex justify-end gap-2">
          <Btn size="sm" onClick={onCancel}>取消</Btn>
          <Btn size="sm" variant="danger" onClick={onConfirm}>确认删除</Btn>
        </div>
      </div>
    </div>
  )
}

/** 流程编排页：自定义流程编辑器（点选/添加/拖拽/连线/undo/缩放/保存）+ 动作链执行观测 */
export default function Machinery() {
  const q = useApi<MachineryResp>('/p10plus/machinery')
  const flows = q.data?.flows ?? []
  const recentLogs = q.data?.recentLogs ?? []

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null)
  const [tab, setTab] = useState<'editor' | 'observe'>('editor')
  function notify(text: string, error = false) {
    setToast({ text, error })
    setTimeout(() => setToast(null), 2800)
  }
  useEffect(() => {
    if (q.error) notify(q.error, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.error])

  const flow = flows.find((f) => f.id === selectedId) ?? flows[0] ?? null

  /* ================= 流程编辑器状态 ================= */
  const mfQ = useApi<{ flows: MachFlow[] }>('/p10plus/machinery/flows')
  const myFlows = mfQ.data?.flows ?? []
  const actsQ = useApi<{ actions: ActionItem[] }>('/actions')
  const actions = actsQ.data?.actions ?? []

  const [mfId, setMfId] = useState<string | null>(null)
  const [mfName, setMfName] = useState('设备检修申请流程')
  const [nodes, setNodes] = useState<MachNode[]>(toEditorNodes(defaultMachNodes()))
  const [history, setHistory] = useState<MachNode[][]>([])
  const [histIdx, setHistIdx] = useState(-1)
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  const [selNodeId, setSelNodeId] = useState<string | null>(null)
  const [connectMode, setConnectMode] = useState(false)
  const [connectFrom, setConnectFrom] = useState<string | null>(null)
  const [pendingEdge, setPendingEdge] = useState<FlowEdge | null>(null)
  const [pendingDelNode, setPendingDelNode] = useState<string | null>(null)
  const [pendingDelFlow, setPendingDelFlow] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const dragSnap = useRef(false)

  // 初始化历史（首帧）
  useEffect(() => {
    if (histIdx === -1) {
      const snap = nodes.map((n) => ({ ...n }))
      setHistory([snap]); setHistIdx(0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 首次加载：已有保存的流程则自动选中第一个（否则显示默认示例流程）
  useEffect(() => {
    if (!mfId && !mfQ.loading && myFlows.length > 0) loadMyFlow(myFlows[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mfQ.loading, myFlows.length])

  function commit(next: MachNode[]) {
    setNodes(next)
    setHistory((h) => [...h.slice(0, histIdx + 1), next.map((n) => ({ ...n }))].slice(-50))
    setHistIdx((i) => Math.min(i + 1, 49))
    setDirty(true)
  }
  function commitCurrent() {
    const snap = nodesRef.current.map((n) => ({ ...n }))
    setHistory((h) => [...h.slice(0, histIdx + 1), snap].slice(-50))
    setHistIdx((i) => Math.min(i + 1, 49))
    setDirty(true)
  }
  function undo() { if (histIdx <= 0) return; const i = histIdx - 1; setHistIdx(i); setNodes(history[i].map((n) => ({ ...n }))); setDirty(true) }
  function redo() { if (histIdx >= history.length - 1) return; const i = histIdx + 1; setHistIdx(i); setNodes(history[i].map((n) => ({ ...n }))); setDirty(true) }
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

  function loadMyFlow(id: string) {
    const f = myFlows.find((x) => x.id === id)
    if (!f) return
    setMfId(f.id); setMfName(f.name)
    const init = toEditorNodes(f.nodes)
    setNodes(init); setHistory([init.map((n) => ({ ...n }))]); setHistIdx(0)
    setSelNodeId(null); setConnectMode(false); setConnectFrom(null); setDirty(false)
  }
  function newFlow() {
    setMfId(null); setMfName('新建业务流程')
    const init = toEditorNodes(defaultMachNodes())
    setNodes(init); setHistory([init.map((n) => ({ ...n }))]); setHistIdx(0)
    setSelNodeId(null); setStepResultsNull()
  }
  function setStepResultsNull() { setConnectFrom(null); setDirty(false) }

  function addNode(type: MachNode['type']) {
    const id = `n${Date.now().toString(36)}`
    const maxX = Math.max(0, ...nodes.map((n) => n.x ?? 0))
    const node: MachNode = {
      id, type, label: NODE_META[type].label,
      x: Math.min(780, maxX + 240), y: 60 + (nodes.length % 2) * 140,
      ...(type === 'action' && actions[0] ? { actionId: actions[0].id } : {}),
    }
    commit([...nodes, node])
    setSelNodeId(id)
  }
  function handleNodeClick(id: string) {
    if (connectMode) {
      if (!connectFrom) { setConnectFrom(id); notify('已选起点，请点目标节点'); return }
      if (connectFrom === id) { setConnectFrom(null); return }
      commit(nodes.map((n) => (n.id === connectFrom ? { ...n, next: id } : n)))
      notify('已建立连线')
      setConnectFrom(null); setConnectMode(false); return
    }
    setSelNodeId(id)
  }
  function removeEdge(edge: FlowEdge) {
    commit(nodes.map((n) => (n.id === edge.from ? { ...n, next: undefined } : n)))
    setPendingEdge(null); notify('连线已删除（该节点将按顺序连接）')
  }
  function removeNode(id: string) {
    commit(nodes.filter((n) => n.id !== id).map((n) => (n.next === id ? { ...n, next: undefined } : n)))
    if (selNodeId === id) setSelNodeId(null)
    setPendingDelNode(null); notify('节点已删除')
  }
  async function saveFlow() {
    if (!mfName.trim()) return notify('请填写流程名称', true)
    setSaving(true)
    try {
      const r = await api<{ id: string }>('/p10plus/machinery/flows', { method: 'POST', body: { id: mfId ?? undefined, name: mfName, nodes } })
      setMfId(r.id); setDirty(false)
      notify('流程已保存（节点/坐标/连线/动作绑定持久化）')
      mfQ.reload()
    } catch (e) { notify(e instanceof Error ? e.message : '保存失败', true) }
    finally { setSaving(false) }
  }
  async function deleteFlow() {
    if (!mfId) { setPendingDelFlow(false); return }
    setSaving(true)
    try {
      await api(`/p10plus/machinery/flows/${mfId}`, { method: 'DELETE' })
      notify('流程已删除'); newFlow(); mfQ.reload()
    } catch (e) { notify(e instanceof Error ? e.message : '删除失败', true) }
    finally { setSaving(false); setPendingDelFlow(false) }
  }

  // 编辑器 → 画布
  const editorCanvasNodes: FlowNode[] = nodes.map((n) => {
    const m = NODE_META[n.type]
    const bound = n.type === 'action' && n.actionId ? actions.find((a) => a.id === n.actionId)?.name : undefined
    return {
      id: n.id, x: n.x ?? 40, y: n.y ?? 60,
      title: n.label, subtitle: bound ? `绑定：${bound}` : m.label,
      icon: m.icon, accent: m.accent, badge: m.label,
    }
  })
  const editorCanvasEdges: FlowEdge[] = []
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    if (n.next) editorCanvasEdges.push({ from: n.id, to: n.next, label: '连线' })
    else if (i < nodes.length - 1) editorCanvasEdges.push({ from: n.id, to: nodes[i + 1].id })
  }
  const selNode = nodes.find((n) => n.id === selNodeId)

  /* ================= 动作链观测画布（原有） ================= */
  const { nodes: observeNodes, edges: observeEdges } = useMemo(() => {
    const ns: FlowNode[] = []
    const es: FlowEdge[] = []
    if (!flow) return { nodes: ns, edges: es }
    ns.push({
      id: 'action', x: 40, y: 90, title: flow.name,
      subtitle: flow.desc || `目标类型：${flow.targetTypeName}`,
      icon: Zap, accent: 'bg-brand-50 text-brand-600',
      badge: flow.needsApproval ? '需审批' : undefined,
      status: flow.pendingCount > 0 ? 'warn' : 'ok',
    })
    flow.recentExecs.slice(0, 3).forEach((ex, i) => {
      const id = `ex${i}`
      ns.push({
        id, x: 40 + (i + 1) * 250, y: 90,
        title: `${statusText(ex.status)} · ${ex.actor || '系统'}`,
        subtitle: `${ex.target} · ${ex.time}`,
        icon: ex.status === 'done' ? CheckCircle2 : ex.status === 'pending_approval' ? ClipboardCheck : XCircle,
        accent: ex.status === 'done' ? 'bg-emerald-50 text-emerald-600' : ex.status === 'pending_approval' ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500',
        status: statusFlow(ex.status),
      })
      es.push({ from: i === 0 ? 'action' : `ex${i - 1}`, to: id, label: i === 0 ? '执行' : undefined })
    })
    return { nodes: ns, edges: es }
  }, [flow])

  const totalExec = flows.reduce((s, f) => s + f.execCount, 0)
  const totalPending = flows.reduce((s, f) => s + f.pendingCount, 0)

  return (
    <PageShell
      icon={Route}
      title="流程编排"
      subtitle="可视化编排业务流程（点选节点/添加节点/拖拽/连线/撤销/缩放，保存持久化）+ 动作链执行观测"
      benchmark="流程编排"
      features={[
        '流程编辑器：开始/执行动作/人工审批/发送通知/结束五类节点，点选编辑、拖拽布局、连接模式建线、点连线删除',
        '动作绑定：执行动作节点可绑定本体中已登记的真实动作类型（审批标识同步显示）',
        'undo/redo：按钮 + Ctrl+Z / Ctrl+Shift+Z；保存后节点/坐标/连线/绑定随流程持久化',
        '动作链观测：每个本体动作类型的执行统计、待审批与近期执行记录（真实动作日志聚合）',
        '最近日志：全局动作执行日志；刷新重新拉取服务端数据，不做本地假状态',
      ]}
      actions={
        <>
          <Tabs
            tabs={[{ key: 'editor', label: '流程编辑器' }, { key: 'observe', label: '动作链观测' }]}
            active={tab}
            onChange={(k) => setTab(k as 'editor' | 'observe')}
          />
          <Btn size="sm" variant="primary" onClick={() => { notify('正在刷新流程数据…'); q.reload(); mfQ.reload() }}><RefreshCw size={13} /> 刷新</Btn>
        </>
      }
    >
      {toast && (
        <div className={cn('rounded-lg border px-4 py-2.5 text-sm font-medium', toast.error ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700')}>
          {toast.text}
        </div>
      )}

      {tab === 'editor' ? (
        /* ================= Tab 1：流程编辑器 ================= */
        <div className="grid gap-4 xl:grid-cols-[190px_minmax(0,1fr)_300px]">
          {/* 添加节点面板 */}
          <div className="card h-fit p-3">
            <div className="mb-2 text-xs font-semibold text-slate-500">添加节点</div>
            {(Object.keys(NODE_META) as MachNode['type'][]).map((t) => {
              const m = NODE_META[t]
              return (
                <button key={t} onClick={() => addNode(t)} className="mb-1.5 flex w-full items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-2 text-[12px] text-slate-600 hover:border-brand-300 hover:bg-brand-50/50 hover:text-brand-700">
                  <m.icon size={13} className="text-slate-400" /> {m.label}
                </button>
              )
            })}
            <div className="mt-3 rounded-lg bg-slate-50 p-2 text-[10px] leading-4 text-slate-400">
              点节点编辑；拖拽布局；「连线」点两节点连接；点连线删除；Ctrl+Z 撤销。
            </div>
          </div>

          {/* 画布 + 工具栏 */}
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <select
                value={mfId ?? ''}
                onChange={(e) => (e.target.value ? loadMyFlow(e.target.value) : newFlow())}
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700"
              >
                <option value="">（新建流程）</option>
                {myFlows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
              <input value={mfName} onChange={(e) => { setMfName(e.target.value); setDirty(true) }} className="w-40 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs" placeholder="流程名称" />
              <Btn size="sm" onClick={newFlow}><Plus size={13} /> 新建</Btn>
              <Btn size="sm" variant="ghost" onClick={undo} disabled={histIdx <= 0} title="撤销 Ctrl+Z"><Undo2 size={13} /></Btn>
              <Btn size="sm" variant="ghost" onClick={redo} disabled={histIdx >= history.length - 1} title="重做 Ctrl+Shift+Z"><Redo2 size={13} /></Btn>
              <Btn size="sm" variant={connectMode ? 'primary' : 'ghost'} onClick={() => { setConnectMode(!connectMode); setConnectFrom(null) }}><Link2 size={13} /> 连线</Btn>
              <Btn size="sm" variant="primary" onClick={saveFlow} disabled={saving || !dirty}><Save size={13} /> 保存{dirty ? ' ·' : ''}</Btn>
              {mfId && <Btn size="sm" variant="ghost" onClick={() => setPendingDelFlow(true)}><Trash2 size={12} /></Btn>}
            </div>
            <FlowCanvas
              nodes={editorCanvasNodes}
              edges={editorCanvasEdges}
              width={1000}
              height={420}
              zoomable
              selectedId={selNodeId}
              onNodeClick={handleNodeClick}
              onNodeMove={(id, x, y) => setNodes((list) => list.map((n) => (n.id === id ? { ...n, x, y } : n)))}
              onNodeDragStart={() => { dragSnap.current = true }}
              onNodeDragEnd={() => { if (dragSnap.current) { dragSnap.current = false; commitCurrent() } }}
              onEdgeClick={(e) => setPendingEdge(e)}
              connectMode={connectMode}
              connectFrom={connectFrom}
            />
            <div className="mt-2 flex items-center justify-center gap-3 text-[11px] text-slate-400">
              <span>{connectMode ? `连接模式：${connectFrom ? '请点目标节点' : '请点起点节点'}` : `${nodes.length} 个节点 · 点节点编辑 / 滚轮缩放 / 点连线删除`}</span>
            </div>
          </div>

          {/* 属性面板 */}
          <div className="card h-fit p-3.5">
            <div className="mb-2.5 flex items-center justify-between">
              <div className="text-xs font-semibold text-slate-600">节点配置</div>
              {selNode && <Badge color={selNode.type === 'approval' ? 'amber' : selNode.type === 'action' ? 'blue' : 'slate'}>{NODE_META[selNode.type].label}</Badge>}
            </div>
            {selNode ? (
              <div className="space-y-3">
                <Field label="节点名称"><Input value={selNode.label} onChange={(e) => setNodes((l) => l.map((n) => (n.id === selNode.id ? { ...n, label: e.target.value } : n)))} onBlur={commitCurrent} /></Field>
                {selNode.type === 'action' && (
                  <Field label="绑定动作类型" hint="选择本体中已登记的真实动作">
                    <Select className="w-full" value={selNode.actionId ?? ''} onChange={(e) => commit(nodes.map((n) => (n.id === selNode.id ? { ...n, actionId: e.target.value || undefined } : n)))}>
                      <option value="">（未绑定）</option>
                      {actions.map((a) => <option key={a.id} value={a.id}>{a.name}{a.needsApproval ? '（需审批）' : ''}</option>)}
                    </Select>
                  </Field>
                )}
                <Field label="后继节点（连线）" hint="留空按画布顺序连接">
                  <Select className="w-full" value={selNode.next ?? ''} onChange={(e) => commit(nodes.map((n) => (n.id === selNode.id ? { ...n, next: e.target.value || undefined } : n)))}>
                    <option value="">（按顺序连接）</option>
                    {nodes.filter((n) => n.id !== selNode.id).map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
                  </Select>
                </Field>
                <button onClick={() => setPendingDelNode(selNode.id)} className="w-full rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-500 hover:bg-red-50">删除节点</button>
              </div>
            ) : (
              <div className="space-y-2 text-center text-xs text-slate-400">
                <div>点击画布中的节点进行配置</div>
                <div className="text-[11px]">当前共 {nodes.length} 个节点，可从左侧添加</div>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ================= Tab 2：动作链观测（原有） ================= */
        <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)_320px]">
          {/* 左：动作链列表 */}
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
                  className={cn('mb-1 flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2.5 text-left', flow?.id === f.id ? 'bg-brand-50' : 'hover:bg-slate-50')}
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

          {/* 中：观测画布 */}
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
                <FlowCanvas nodes={observeNodes} edges={observeEdges} width={1100} height={220} zoomable />
                <div className="mt-1 text-[10px] text-slate-400">执行链观测画布（滚轮缩放 / 空白拖拽平移）；可编辑流程请切到「流程编辑器」Tab</div>
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

          {/* 右：最近日志 */}
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
              观测数据均来自服务端动作日志表；流程的节点编排请使用「流程编辑器」Tab。
            </div>
          </Card>
        </div>
      )}

      {/* 删除确认弹层 */}
      {pendingDelNode && (
        <ConfirmModal
          title="删除节点？"
          desc={`节点「${nodes.find((n) => n.id === pendingDelNode)?.label}」及其连线将移除，保存后生效。`}
          onCancel={() => setPendingDelNode(null)}
          onConfirm={() => removeNode(pendingDelNode)}
        />
      )}
      {pendingEdge && (
        <ConfirmModal
          title="删除连线？"
          desc={`「${pendingEdge.from} → ${pendingEdge.to}」；该节点随后按顺序连接。`}
          onCancel={() => setPendingEdge(null)}
          onConfirm={() => removeEdge(pendingEdge)}
        />
      )}
      {pendingDelFlow && (
        <ConfirmModal
          title="删除流程？"
          desc={`流程「${mfName}」删除后不可恢复。`}
          onCancel={() => setPendingDelFlow(false)}
          onConfirm={deleteFlow}
        />
      )}
    </PageShell>
  )
}
