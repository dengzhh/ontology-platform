import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Sparkles, Plus, Trash2, X, Loader2, Play, Save, Search, GitBranch, ArrowRight, ArrowUp, ArrowDown, Copy, Link2, Wand2, Zap, Undo2, Redo2 } from 'lucide-react'
import PageShell from '@/components/ui/PageShell'
import Btn from '@/components/ui/Btn'
import { Badge } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import { Input, Field, Select } from '@/components/ui/Form'
import FlowCanvas, { type FlowNode, type FlowEdge } from '@/components/canvas/FlowCanvas'
import { api } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'
import { WORKFLOW_PRESETS, type WorkflowStep, type WorkflowPreset } from '../../../shared/workflowTemplates'

interface Workflow { id: string; name: string; steps: WorkflowStep[]; updatedAt: number; desc?: string; tag?: string; sampleInput?: string; needsLlm?: boolean; preset?: boolean }

const TYPE_META: Record<WorkflowStep['type'], { icon: typeof Sparkles; accent: string; label: string }> = {
  input: { icon: Search, accent: 'bg-brand-50 text-brand-600', label: '输入' },
  llm: { icon: Sparkles, accent: 'bg-violet-50 text-violet-600', label: 'LLM 节点' },
  condition: { icon: GitBranch, accent: 'bg-amber-50 text-amber-600', label: '条件分支' },
  transform: { icon: Wand2, accent: 'bg-cyan-50 text-cyan-600', label: '转换节点' },
  output: { icon: ArrowRight, accent: 'bg-emerald-50 text-emerald-600', label: '输出' },
}

/** 默认示例工作流（首次进入/新建时的起点） */
function defaultSteps(): WorkflowStep[] {
  return [
    { id: 's1', type: 'input', label: '输入数据', outputFormat: '对象集/文本', x: 40, y: 60 },
    { id: 's2', type: 'llm', label: 'LLM 分析', prompt: '分析给定的设备数据，识别异常并给出建议（含置信度）', model: 'auto', x: 270, y: 60 },
    { id: 's3', type: 'condition', label: '置信度判断', condition: '置信度 > 0.8', x: 500, y: 60, nextYes: 's4', nextNo: 's5' },
    { id: 's4', type: 'output', label: '自动输出结果', outputFormat: '结构化 JSON', x: 730, y: 20 },
    { id: 's5', type: 'output', label: '人工复核结果', outputFormat: '待复核清单', x: 730, y: 150 },
  ]
}

/** 通用确认弹层：删除/取消类操作统一走这里，避免误删 */
function ConfirmModal({ title, desc, onCancel, onConfirm, children }: { title: string; desc?: string; onCancel: () => void; onConfirm: () => void; children?: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={onCancel}>
      <div className="w-[420px] max-w-[94vw] rounded-2xl border border-slate-200 bg-white p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-bold text-slate-900">{title}</div>
            {desc && <div className="mt-0.5 text-[11px] text-slate-400">{desc}</div>}
          </div>
          <button aria-label="关闭" onClick={onCancel} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={16} /></button>
        </div>
        {children}
        <div className="mt-4 flex justify-end gap-2">
          <Btn size="sm" onClick={onCancel}>取消</Btn>
          <Btn size="sm" variant="danger" onClick={onConfirm}>确认删除</Btn>
        </div>
      </div>
    </div>
  )
}

/** 工作流编排：工作流可视化编排（节点可点选编辑/拖拽/排序/复制/连线）+ 服务端持久化 + 真实分支执行引擎 */
export default function AipLogic() {
  const wfQ = useApi<{ workflows: Workflow[] }>('/logic/workflows')
  const workflows = wfQ.data?.workflows ?? []
  const [wfId, setWfId] = useState<string | null>(null)
  const [wfName, setWfName] = useState('设备停机归因分析')
  const [steps, setSteps] = useState<WorkflowStep[]>(defaultSteps())
  /** undo/redo：每次离散编辑提交一个快照；拖拽只在结束时提交一次 */
  const [history, setHistory] = useState<WorkflowStep[][]>([defaultSteps()])
  const [histIdx, setHistIdx] = useState(0)
  const stepsRef = useRef(steps)
  stepsRef.current = steps
  const dragSnapshot = useRef<WorkflowStep[] | null>(null)
  const [connectMode, setConnectMode] = useState(false)
  const [connectFrom, setConnectFrom] = useState<string | null>(null)
  /** 连线删除确认 */
  const [pendingEdge, setPendingEdge] = useState<FlowEdge | null>(null)
  /** 运行预览（dry-run）与确认 */
  const [runPreview, setRunPreview] = useState<{ actions: { step: string; action: string; title: string; detail: string }[]; final: string; results: { step: string; type: string; output: string; branch?: string }[] } | null>(null)
  const [appliedActions, setAppliedActions] = useState<{ step: string; action: string; title: string; status: string; detail: string; refId?: string }[]>([])
  const [selectedStep, setSelectedStep] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [stepResults, setStepResults] = useState<{ step: string; type: string; output: string; branch?: string }[]>([])
  const [testResult, setTestResult] = useState<string>('')
  const [testInput, setTestInput] = useState('设备 F2-IM-2041 健康度 62，已停机 47.5 小时，关联工单 GD-2291')
  const [toast, setToast] = useState('')
  /** 待确认的删除目标：节点 id 或 'workflow'（删除工作流） */
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3000) }
  const sel = steps.find((s) => s.id === selectedStep)

  /** 提交一次编辑快照：截断 redo 分支、最多保留 50 步 */
  function commitSteps(next: WorkflowStep[]) {
    const snap = next.map((s) => ({ ...s }))
    setSteps(snap)
    setHistory((h) => [...h.slice(0, histIdx + 1), snap.map((s) => ({ ...s }))].slice(-50))
    setHistIdx((i) => Math.min(i + 1, 49))
  }
  function undo() { if (histIdx <= 0) return; const i = histIdx - 1; setHistIdx(i); setSteps(history[i].map((s) => ({ ...s }))); notify('已撤销') }
  function redo() { if (histIdx >= history.length - 1) return; const i = histIdx + 1; setHistIdx(i); setSteps(history[i].map((s) => ({ ...s }))); notify('已重做') }
  /** 键盘 Ctrl+Z / Ctrl+Shift+Z（输入框内不拦截，保证正常文本编辑） */
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

  // 首次加载：有用户工作流则选第一个，否则默认载入「设备健康分诊」预设（开箱即用）
  useEffect(() => {
    if (!wfId && workflows.length) {
      const w = workflows.find((x) => !x.preset) ?? workflows.find((x) => x.preset)
      if (!w) return
      if (w.preset) {
        const p = WORKFLOW_PRESETS.find((x) => x.id === w.id)
        if (p) { loadPreset(p); return }
      }
      setWfId(w.id); setWfName(w.name); resetSteps(w.steps)
    }
  }, [workflows, wfId])

  /** 把后端返回的旧工作流补齐坐标（兼容历史数据，避免节点全部叠在原点） */
  function normalizeSteps(raw: WorkflowStep[]): WorkflowStep[] {
    return (raw ?? []).map((s, i) => ({ ...s, x: s.x ?? 40 + (i % 3) * 240, y: s.y ?? 40 + Math.floor(i / 3) * 140 }))
  }
  /** 载入新工作流时重置 undo/redo 历史（避免撤销回退到上一个工作流） */
  function resetSteps(raw: WorkflowStep[]) {
    const snap = normalizeSteps(raw)
    setSteps(snap)
    setHistory([snap.map((s) => ({ ...s }))])
    setHistIdx(0)
    setConnectMode(false); setConnectFrom(null)
  }

  async function selectWorkflow(id: string) {
    const w = workflows.find((x) => x.id === id)
    if (!w) return
    if (w.preset) {
      const p = WORKFLOW_PRESETS.find((x) => x.id === id)
      if (p) { loadPreset(p); return }
    }
    setWfId(w.id); setWfName(w.name); resetSteps(w.steps); setSelectedStep(null); setStepResults([]); setTestResult('')
  }

  /** 一键载入预设模板：填入节点与示例输入，直接可点运行；保存时自动另存为副本 */
  function loadPreset(p: WorkflowPreset) {
    setWfId(p.id)
    setWfName(p.name)
    resetSteps(p.steps)
    setTestInput(p.sampleInput)
    setSelectedStep(null)
    setStepResults([])
    setTestResult('')
    notify(`已载入预设「${p.name}」，示例输入已填好，直接点击运行即可`)
  }

  function validate(): string | null {
    if (!wfName.trim()) return '请填写工作流名称'
    if (steps.length === 0) return '至少需要一个节点'
    if (new Set(steps.map((s) => s.id)).size !== steps.length) return '节点 id 重复，请刷新后重试'
    for (const s of steps) {
      if (s.type === 'condition') {
        for (const target of [s.nextYes, s.nextNo]) {
          if (target && !steps.some((x) => x.id === target)) return `节点「${s.label}」的分支目标 ${target} 不存在`
        }
      }
    }
    return null
  }

  async function saveWorkflow(): Promise<string | null> {
    const err = validate()
    if (err) { notify(err); return null }
    setBusy(true)
    try {
      // 预设模板保存时后端会「另存为副本」并返回新 id，用新 id 运行
      const r = await api<{ id: string }>('/logic/workflows', { method: 'POST', body: { id: wfId ?? undefined, name: wfName, steps } })
      setWfId(r.id)
      wfQ.reload()
      return r.id
    } catch (e) { notify(e instanceof Error ? e.message : '保存失败'); return null }
    finally { setBusy(false) }
  }

  function newWorkflow() {
    setWfId(null); setWfName('新建工作流'); resetSteps(defaultSteps()); setSelectedStep(null); setStepResults([]); setTestResult('')
  }

  /** 文字/字段编辑：实时更新但不记历史；失焦时 commitCurrent() 记一次快照 */
  function updateStep(id: string, patch: Partial<WorkflowStep>) {
    setSteps((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }
  /** 把当前最新状态提交为一次 undo 快照（用于字段编辑失焦、拖拽结束） */
  function commitCurrent() {
    const snap = stepsRef.current.map((s) => ({ ...s }))
    setHistory((h) => [...h.slice(0, histIdx + 1), snap.map((s) => ({ ...s }))].slice(-50))
    setHistIdx((i) => Math.min(i + 1, 49))
  }

  function addStep(type: WorkflowStep['type']) {
    const id = `s${Date.now().toString(36)}`
    const maxX = Math.max(0, ...steps.map((s) => s.x ?? 0))
    const step: WorkflowStep = {
      id, type, label: TYPE_META[type].label,
      x: steps.length ? Math.min(760, maxX + 230) : 40,
      y: 60 + (steps.length % 2) * 110,
      ...(type === 'llm' ? { prompt: '处理输入并输出结构化结果', model: 'auto' } : {}),
      ...(type === 'condition' ? { condition: '置信度 > 0.8' } : {}),
      ...(type === 'transform' ? { transform: 'extract' as const, field: '健康度' } : {}),
    }
    commitSteps([...steps, step])
    setSelectedStep(id)
  }

  function duplicateStep(id: string) {
    const s = steps.find((x) => x.id === id)
    if (!s) return
    const newId = `s${Date.now().toString(36)}`
    commitSteps([...steps, { ...s, id: newId, label: `${s.label} 副本`, x: (s.x ?? 40) + 30, y: (s.y ?? 60) + 90 }])
    setSelectedStep(newId)
  }

  function moveStep(id: string, dir: -1 | 1) {
    const i = steps.findIndex((s) => s.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= steps.length) return
    const next = [...steps]
    ;[next[i], next[j]] = [next[j], next[i]]
    commitSteps(next)
  }

  /** 连线控制：连接模式下点两节点建立连线；点已有连线弹确认删除 */
  function handleNodeClick(id: string) {
    if (connectMode) {
      if (!connectFrom) { setConnectFrom(id); notify(`已选起点「${steps.find((s) => s.id === id)?.label}」，请点目标节点`); return }
      if (connectFrom === id) { setConnectFrom(null); return }
      const src = steps.find((s) => s.id === connectFrom)
      const next = steps.map((s) => s.id === connectFrom ? { ...s, next: id } : s)
      commitSteps(next)
      notify(`已建立连线：${src?.label} → ${steps.find((s) => s.id === id)?.label}`)
      setConnectFrom(null); setConnectMode(false)
      return
    }
    setSelectedStep(id)
  }

  function removeEdge(edge: FlowEdge) {
    const next = steps.map((s) => {
      if (s.id !== edge.from) return s
      if (edge.kind === 'yes') return { ...s, nextYes: undefined }
      if (edge.kind === 'no') return { ...s, nextNo: undefined }
      return { ...s, next: undefined }
    })
    commitSteps(next)
    setPendingEdge(null)
    notify('连线已删除（该节点将按数组顺序继续）')
  }

  function doDelete() {
    if (!pendingDelete) return
    if (pendingDelete === 'workflow') {
      const id = wfId
      setPendingDelete(null)
      if (!id) return
      setBusy(true)
      api(`/logic/workflows/${id}`, { method: 'DELETE' })
        .then(() => { notify('工作流已删除'); newWorkflow(); wfQ.reload() })
        .catch((e) => notify(e instanceof Error ? e.message : '删除失败'))
        .finally(() => setBusy(false))
      return
    }
    const id = pendingDelete
    commitSteps(steps.filter((s) => s.id !== id).map((s) => ({
      ...s,
      next: s.next === id ? undefined : s.next,
      nextYes: s.nextYes === id ? undefined : s.nextYes,
      nextNo: s.nextNo === id ? undefined : s.nextNo,
    })))
    if (selectedStep === id) setSelectedStep(null)
    setPendingDelete(null)
    notify('节点已删除')
  }

  /** 第一步：dry-run 预览（不产生任何业务副作用），弹确认层 */
  async function runTest() {
    setBusy(true); setTestResult(''); setStepResults([]); setAppliedActions([])
    try {
      const id = await saveWorkflow()
      if (!id) { setBusy(false); return }
      const res = await api<{
        final: string
        results: { step: string; type: string; output: string; branch?: string }[]
        actions: { step: string; action: string; title: string; status: string; detail: string; refId?: string }[]
      }>(`/logic/workflows/${id}/run`, { method: 'POST', body: { input: testInput, mode: 'preview' } })
      setStepResults(res.results ?? [])
      setTestResult(res.final || '（无输出）')
      setRunPreview({ actions: (res.actions ?? []).map((a) => ({ step: a.step, action: a.action, title: a.title, detail: a.detail })), final: res.final || '', results: res.results ?? [] })
    } catch (e) {
      setTestResult(`预览失败：${e instanceof Error ? e.message : '未知错误'}`)
    } finally { setBusy(false) }
  }

  /** 第二步：用户确认后 apply，真实执行动作并展示结果 */
  async function applyRun() {
    if (!runPreview || !wfId) return
    setBusy(true)
    try {
      const res = await api<{
        final: string
        results: { step: string; type: string; output: string; branch?: string }[]
        actions: { step: string; action: string; title: string; status: string; detail: string; refId?: string }[]
      }>(`/logic/workflows/${wfId}/run`, { method: 'POST', body: { input: testInput, mode: 'apply' } })
      setStepResults(res.results ?? [])
      setTestResult(res.final || '（无输出）')
      setAppliedActions(res.actions ?? [])
      notify(res.actions?.length ? `已实际执行 ${res.actions.length} 个动作（对象/通知/审批已落库）` : '已运行（本次无业务动作）')
      wfQ.reload()
    } catch (e) {
      notify(`应用失败：${e instanceof Error ? e.message : '未知错误'}`)
    } finally { setBusy(false); setRunPreview(null) }
  }

  // 生成画布节点坐标（拖拽位置优先，缺省按序号排布）
  const canvasNodes: FlowNode[] = steps.map((s, i) => {
    const m = TYPE_META[s.type]
    return {
      id: s.id,
      x: s.x ?? 40 + (i % 3) * 240,
      y: s.y ?? 40 + Math.floor(i / 3) * 140,
      title: s.label,
      subtitle: s.type === 'llm' ? (s.model ?? 'auto') : s.type === 'condition' ? s.condition : s.type === 'transform' ? (s.transform === 'keyword' ? (s.words ?? '') : s.transform === 'extract' ? `提取 ${s.field ?? ''}` : '格式化') : '',
      icon: m.icon,
      accent: m.accent,
      badge: s.type,
    }
  })

  // 连线：条件节点按 nextYes/nextNo 分支线；显式 next 覆盖顺序；无连线时按数组顺序串联
  const canvasEdges: FlowEdge[] = []
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]
    if (s.type === 'condition') {
      if (s.nextYes) canvasEdges.push({ from: s.id, to: s.nextYes, label: '是', kind: 'yes' })
      if (s.nextNo) canvasEdges.push({ from: s.id, to: s.nextNo, label: '否', kind: 'no', dashed: true })
    } else if (s.next) {
      canvasEdges.push({ from: s.id, to: s.next, label: '连线' })
    } else if (i < steps.length - 1) {
      const next = steps[i + 1]
      // 若下一个节点是某条件分支的目标，则不画顺序线（由分支线覆盖）
      const isBranchTarget = steps.some((x) => x.type === 'condition' && (x.nextYes === next.id || x.nextNo === next.id))
      if (!isBranchTarget) canvasEdges.push({ from: s.id, to: next.id })
    }
  }

  const pendingName = pendingDelete === 'workflow' ? wfName : steps.find((s) => s.id === pendingDelete)?.label ?? ''

  return (
    <PageShell
      icon={Sparkles}
      title="工作流编排"
      subtitle="可视化编排 LLM 工作流：点击节点编辑、拖拽布局、调整顺序与分支连线，可测试运行"
      benchmark="AI 工作流"
      features={[
        '节点编辑：点击画布节点即选中，右侧配置名称/提示词/模型/条件/输出动作',
        '画布交互：滚轮缩放、空白拖拽平移、节点拖拽布局；undo/redo（Ctrl+Z / Ctrl+Shift+Z）',
        '连线控制：「连接模式」点两节点建立连线、点连线删除；一般节点可设 next，条件节点可设「是/否」目标',
        '删除确认：删除节点/连线/工作流均弹层确认，可取消；节点可复制',
        '真实闭环：运行先 dry-run 预览动作 → 确认后 apply 真实落库（工单对象/通知/审批单），结果可查',
      ]}
      actions={
        <>
          <select value={wfId ?? ''} onChange={(e) => e.target.value ? selectWorkflow(e.target.value) : newWorkflow()} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700">
            <option value="">（新建工作流）</option>
            <optgroup label="预设模板">
              {workflows.filter((w) => w.preset).map((w) => <option key={w.id} value={w.id}>★ {w.name}</option>)}
            </optgroup>
            <optgroup label="我的工作流">
              {workflows.filter((w) => !w.preset).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </optgroup>
          </select>
          <input value={wfName} onChange={(e) => setWfName(e.target.value)} className="w-36 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs" placeholder="工作流名称" />
          <Btn size="sm" onClick={newWorkflow}>新建</Btn>
          <Btn size="sm" variant="ghost" onClick={undo} disabled={histIdx <= 0} title="撤销 Ctrl+Z"><Undo2 size={13} /></Btn>
          <Btn size="sm" variant="ghost" onClick={redo} disabled={histIdx >= history.length - 1} title="重做 Ctrl+Shift+Z"><Redo2 size={13} /></Btn>
          <Btn size="sm" variant={connectMode ? 'primary' : 'ghost'} onClick={() => { setConnectMode(!connectMode); setConnectFrom(null); notify(connectMode ? '已退出连接模式' : '连接模式：先点起点节点，再点目标节点建立连线') }} title="连接模式"><Link2 size={13} /> 连线</Btn>
          <Btn size="sm" onClick={runTest} disabled={busy}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} 预览运行</Btn>
          <Btn size="sm" variant="primary" onClick={() => saveWorkflow().then((id) => id && notify(wfId && wfId.startsWith('PRESET-') ? '已另存为我的工作流副本（模板保持不变）' : '工作流已保存（服务端持久化）'))} disabled={busy}><Save size={13} /> 保存</Btn>
          {wfId && <Btn size="sm" variant="ghost" onClick={() => setPendingDelete('workflow')}><Trash2 size={12} /></Btn>}
        </>
      }
    >
      {toast && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">{toast}</div>}

      {/* 预设工作流模板库：一键载入，示例输入自动填好，直接可运行 */}
      <Card>
        <CardHeader
          title="常用工作流预设"
          desc="开箱即用的模板：点击卡片即载入节点与示例输入，直接点「运行」即可看到真实结果；需要带文档多轮对话请去「文档分析」页"
          actions={<div className="flex items-center gap-2"><a href="/aip/threads" className="text-[11px] font-medium text-brand-600 hover:underline">去文档分析 →</a><Badge color="violet">{WORKFLOW_PRESETS.length} 个模板</Badge></div>}
        />
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-6">
          {WORKFLOW_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => loadPreset(p)}
              className={cn(
                'group rounded-xl border p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-card',
                wfId === p.id ? 'border-brand-400 bg-brand-50/60' : 'border-slate-200 bg-white hover:border-brand-300',
              )}
            >
              <div className="mb-1.5 flex items-center justify-between gap-1">
                <span className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-800">
                  {p.needsLlm ? <Sparkles size={13} className="text-violet-500" /> : <Zap size={13} className="text-amber-500" />}
                  {p.name}
                </span>
                <Badge color={p.needsLlm ? 'violet' : 'green'}>{p.needsLlm ? 'AI 增强' : '离线可跑'}</Badge>
              </div>
              <div className="mb-2 line-clamp-2 text-[10px] leading-4 text-slate-500">{p.desc}</div>
              <div className="flex items-center justify-between">
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{p.tag}</span>
                <span className="flex items-center gap-0.5 text-[10px] font-medium text-brand-600 opacity-0 transition-opacity group-hover:opacity-100"><Play size={10} /> 一键载入</span>
              </div>
            </button>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[180px_minmax(0,1fr)_300px]">
        {/* 节点面板 */}
        <div className="card h-fit p-3">
          <div className="mb-2 text-xs font-semibold text-slate-500">添加节点</div>
          {(Object.keys(TYPE_META) as WorkflowStep['type'][]).map((type) => {
            const m = TYPE_META[type]
            return (
              <button key={type} onClick={() => addStep(type)} className="mb-1.5 flex w-full items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-2 text-[12px] text-slate-600 hover:border-brand-300 hover:bg-brand-50/50 hover:text-brand-700">
                <m.icon size={13} className="text-slate-400" /> {m.label}
              </button>
            )
          })}
          <div className="mt-3 rounded-lg bg-slate-50 p-2 text-[10px] leading-4 text-slate-400">
            提示：点节点编辑；拖拽调布局；「连线」按钮进入连接模式点两节点建线，点已有连线可删除；Ctrl+Z 撤销。
          </div>
        </div>

        {/* 画布：支持滚轮缩放 / 空白拖拽平移 / 控件复位，节点点选与拖拽在任意缩放下均准确 */}
        <div className="min-h-[440px]">
          <FlowCanvas
            nodes={canvasNodes}
            edges={canvasEdges}
            width={1000}
            height={420}
            zoomable
            selectedId={selectedStep}
            onNodeClick={handleNodeClick}
            onNodeMove={(id, x, y) => updateStep(id, { x, y })}
            onNodeDragStart={() => { dragSnapshot.current = stepsRef.current.map((s) => ({ ...s })) }}
            onNodeDragEnd={() => { if (dragSnapshot.current) { dragSnapshot.current = null; commitCurrent() } }}
            onEdgeClick={(edge) => setPendingEdge(edge)}
            connectMode={connectMode}
            connectFrom={connectFrom}
          />
          <div className="mt-2 flex items-center justify-center gap-3 text-[11px] text-slate-400">
            <span>{connectMode ? `连接模式：${connectFrom ? '请点目标节点' : '请点起点节点'}` : `${steps.length} 个节点 · 点节点编辑 / 滚轮缩放 / 点连线删除`}</span>
            <span className="flex items-center gap-1"><span className="h-0.5 w-4 bg-emerald-500" />是</span>
            <span className="flex items-center gap-1"><span className="h-0.5 w-4 border-t-2 border-dashed border-amber-500" />否</span>
          </div>
        </div>

        {/* 属性面板 */}
        <div className="card h-fit p-3.5">
          <div className="mb-2.5 flex items-center justify-between">
            <div className="text-xs font-semibold text-slate-600">节点配置</div>
            {sel && <Badge color={sel.type === 'condition' ? 'amber' : sel.type === 'llm' ? 'violet' : 'slate'}>{TYPE_META[sel.type].label}</Badge>}
          </div>
          {sel ? (
            <div className="space-y-3">
              <Field label="节点名称"><Input value={sel.label} onChange={(e) => updateStep(sel.id, { label: e.target.value })} onBlur={commitCurrent} /></Field>
              {sel.type === 'llm' && (
                <>
                  <Field label="系统提示词" hint="指导 LLM 如何处理数据">
                    <textarea
                      value={sel.prompt ?? ''}
                      onChange={(e) => updateStep(sel.id, { prompt: e.target.value })}
                      onBlur={commitCurrent}
                      placeholder="分析给定的设备数据…"
                      className="h-24 w-full resize-none rounded-lg border border-slate-200 p-2.5 text-xs focus:border-brand-400 focus:outline-none"
                    />
                  </Field>
                  <Field label="模型">
                    <Select className="w-full" value={sel.model ?? 'auto'} onChange={(e) => updateStep(sel.id, { model: e.target.value })} onBlur={commitCurrent}>
                      <option value="auto">自动（用平台配置）</option>
                      <option value="deepseek-v4.1-flash">deepseek-v4.1-flash</option>
                      <option value="glm-5.3-flash">glm-5.3-flash</option>
                    </Select>
                  </Field>
                </>
              )}
              {sel.type === 'transform' && (
                <>
                  <Field label="转换方式" hint="本地确定性执行，无需 AI 网关">
                    <Select className="w-full" value={sel.transform ?? 'extract'} onChange={(e) => updateStep(sel.id, { transform: e.target.value as WorkflowStep['transform'] })} onBlur={commitCurrent}>
                      <option value="extract">提取数值字段（供条件判断）</option>
                      <option value="keyword">关键词命中标记</option>
                      <option value="format">格式化输出</option>
                    </Select>
                  </Field>
                  {sel.transform !== 'keyword' && sel.transform !== 'format' && (
                    <Field label="字段名" hint="如：健康度 / 金额"><Input value={sel.field ?? ''} onChange={(e) => updateStep(sel.id, { field: e.target.value })} onBlur={commitCurrent} placeholder="健康度" /></Field>
                  )}
                  {sel.transform === 'keyword' && (
                    <Field label="关键词" hint="逗号分隔，命中任一即标记"><Input value={sel.words ?? ''} onChange={(e) => updateStep(sel.id, { words: e.target.value })} onBlur={commitCurrent} placeholder="紧急,停机,故障" /></Field>
                  )}
                </>
              )}
              {sel.type === 'condition' && (
                <>
                  <Field label="条件表达式" hint="如：置信度 > 0.8 / 金额 >= 100 / 包含 命中">
                    <Input value={sel.condition ?? ''} onChange={(e) => updateStep(sel.id, { condition: e.target.value })} onBlur={commitCurrent} placeholder="如：置信度 > 0.8" />
                  </Field>
                  <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-2.5">
                    <div className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold text-slate-600"><Link2 size={12} /> 分支连线</div>
                    <Field label="是 → 目标节点">
                      <Select className="w-full" value={sel.nextYes ?? ''} onChange={(e) => updateStep(sel.id, { nextYes: e.target.value || undefined })} onBlur={commitCurrent}>
                        <option value="">（按顺序继续）</option>
                        {steps.filter((s) => s.id !== sel.id).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                      </Select>
                    </Field>
                    <Field label="否 → 目标节点">
                      <Select className="w-full" value={sel.nextNo ?? ''} onChange={(e) => updateStep(sel.id, { nextNo: e.target.value || undefined })} onBlur={commitCurrent}>
                        <option value="">（按顺序继续）</option>
                        {steps.filter((s) => s.id !== sel.id).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                      </Select>
                    </Field>
                  </div>
                </>
              )}
              {(sel.type === 'input' || sel.type === 'output') && (
                <Field label="格式说明"><Input value={sel.outputFormat ?? ''} onChange={(e) => updateStep(sel.id, { outputFormat: e.target.value })} onBlur={commitCurrent} placeholder="如：对象集/JSON" /></Field>
              )}
              {/* 一般节点连线：显式 next 覆盖数组顺序 */}
              {sel.type !== 'condition' && (
                <Field label="后继节点（连线）" hint="留空则按画布顺序继续；也可在「连线」模式点两节点建立">
                  <Select className="w-full" value={sel.next ?? ''} onChange={(e) => updateStep(sel.id, { next: e.target.value || undefined })} onBlur={commitCurrent}>
                    <option value="">（按顺序继续）</option>
                    {steps.filter((s) => s.id !== sel.id).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </Select>
                </Field>
              )}
              {/* output 节点的真实业务动作（apply 模式落库） */}
              {sel.type === 'output' && (
                <div className="rounded-lg border border-emerald-100 bg-emerald-50/50 p-2.5">
                  <div className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold text-emerald-700"><Zap size={12} /> 运行动作</div>
                  <Field label="动作类型">
                    <Select className="w-full" value={sel.action ?? 'none'} onChange={(e) => updateStep(sel.id, { action: e.target.value as WorkflowStep['action'] })} onBlur={commitCurrent}>
                      <option value="none">不产生动作（仅输出文本）</option>
                      <option value="create_object">创建对象/工单（落 objects）</option>
                      <option value="send_notification">发送通知（落 notifications）</option>
                      <option value="create_approval">创建待审批单（落 approvals）</option>
                    </Select>
                  </Field>
                  {sel.action && sel.action !== 'none' && (
                    <Field label="动作标题"><Input value={sel.actionTitle ?? ''} onChange={(e) => updateStep(sel.id, { actionTitle: e.target.value })} onBlur={commitCurrent} placeholder="如：生成维修工单" /></Field>
                  )}
                  <div className="mt-1 text-[10px] leading-4 text-emerald-700/70">预览运行只显示将执行的动作，确认后才会真实写入业务数据。</div>
                </div>
              )}
              {/* 顺序操作 */}
              <div className="flex items-center gap-1.5">
                <button onClick={() => moveStep(sel.id, -1)} disabled={steps.findIndex((s) => s.id === sel.id) === 0} className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-40"><ArrowUp size={12} /> 上移</button>
                <button onClick={() => moveStep(sel.id, 1)} disabled={steps.findIndex((s) => s.id === sel.id) === steps.length - 1} className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-40"><ArrowDown size={12} /> 下移</button>
                <button onClick={() => duplicateStep(sel.id)} title="复制节点" className="flex items-center justify-center rounded-lg border border-slate-200 px-2 py-1.5 text-slate-600 hover:bg-slate-50"><Copy size={12} /></button>
              </div>
              <button onClick={() => setPendingDelete(sel.id)} className="w-full rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-500 hover:bg-red-50">删除节点</button>
            </div>
          ) : (
            <div className="space-y-2 text-center text-xs text-slate-400">
              <div>点击画布中的节点进行配置</div>
              <div className="text-[11px]">当前共 {steps.length} 个节点，可从左侧添加</div>
            </div>
          )}
        </div>
      </div>

      {/* 测试运行区 */}
      <Card>
        <CardHeader title="测试运行" desc="输入数据 → 按工作流步骤调用 LLM → 查看输出" />
        <div className="space-y-3">
          <Field label="输入数据">
            <textarea
              value={testInput}
              onChange={(e) => setTestInput(e.target.value)}
              className="h-20 w-full resize-none rounded-lg border border-slate-200 p-3 text-[13px] focus:border-brand-400 focus:outline-none"
            />
          </Field>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-slate-400">工作流：{steps.map((s) => s.label).join(' → ')}</span>
            <Btn size="sm" variant="primary" onClick={runTest} disabled={busy}>
              {busy ? '预览中…' : '预览运行（dry-run）'}
            </Btn>
          </div>
          {stepResults.length > 0 && (
            <Card className="bg-slate-50/60">
              <div className="mb-2 text-xs font-semibold text-slate-700">逐步执行记录（真实引擎）</div>
              <div className="space-y-1.5">
                {stepResults.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-lg border border-slate-100 bg-white px-2.5 py-2">
                    <span className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold text-white', r.branch === 'no' ? 'bg-amber-500' : 'bg-brand-500')}>{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[12px] font-medium text-slate-700">
                        {r.step}
                        <Badge color={r.type === 'condition' ? 'amber' : r.type === 'llm' ? 'violet' : 'slate'}>{r.type}</Badge>
                        {r.branch && <Badge color={r.branch === 'yes' ? 'green' : 'amber'}>{r.branch === 'yes' ? '主分支' : '人工复核'}</Badge>}
                      </div>
                      <div className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">{r.output}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
          {testResult && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-emerald-700"><Play size={12} /> 最终输出</div>
              <pre className="whitespace-pre-wrap font-sans text-[13px] leading-7 text-slate-700">{testResult}</pre>
            </div>
          )}
        </div>
      </Card>

      {/* 已执行的真实动作（apply 后展示，带落库 id） */}
      {appliedActions.length > 0 && (
        <Card>
          <CardHeader title="已执行的业务动作" desc="以下数据已真实落库，可在对应模块查询" />
          <div className="space-y-1.5">
            {appliedActions.map((a, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50/40 px-3 py-2">
                <Badge color="green">{a.status === 'done' ? '已执行' : a.status}</Badge>
                <span className="text-[12px] font-medium text-slate-700">{a.title}</span>
                <span className="text-[11px] text-slate-500">{a.detail}</span>
                {a.refId && <code className="ml-auto font-mono text-[10px] text-slate-400">{a.refId}</code>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {pendingDelete && (
        <ConfirmModal
          title={pendingDelete === 'workflow' ? '删除工作流？' : '删除节点？'}
          desc={`「${pendingName}」删除后不可恢复，可在确认前取消。`}
          onCancel={() => setPendingDelete(null)}
          onConfirm={doDelete}
        />
      )}

      {/* dry-run 预览确认：明确列出将产生的业务动作，可取消 */}
      {runPreview && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={() => setRunPreview(null)}>
          <div className="w-[520px] max-w-[94vw] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-pop" style={{ maxHeight: '86vh' }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-slate-900">确认运行：将产生 {runPreview.actions.length} 个业务动作</div>
                <div className="mt-0.5 text-[11px] text-slate-400">预览阶段未写入任何业务数据；确认后才会真实落库</div>
              </div>
              <button aria-label="关闭" onClick={() => setRunPreview(null)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={16} /></button>
            </div>
            {runPreview.actions.length > 0 ? (
              <div className="space-y-1.5">
                {runPreview.actions.map((a, i) => (
                  <div key={i} className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2">
                    <div className="flex items-center gap-2"><Badge color="amber">{a.action}</Badge><span className="text-[12px] font-semibold text-slate-800">{a.title}</span></div>
                    <div className="mt-1 text-[11px] text-slate-600">{a.detail}</div>
                    <div className="mt-0.5 text-[10px] text-slate-400">来自节点：{a.step}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-4 text-center text-[12px] text-slate-500">本次运行没有配置业务动作，仅输出文本，不会产生业务数据。</div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Btn size="sm" onClick={() => setRunPreview(null)}>取消</Btn>
              <Btn size="sm" variant="primary" onClick={applyRun} disabled={busy}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} 确认执行</Btn>
            </div>
          </div>
        </div>
      )}

      {/* 连线删除确认 */}
      {pendingEdge && (
        <ConfirmModal
          title="删除连线？"
          desc={`将移除「${steps.find((s) => s.id === pendingEdge.from)?.label} → ${steps.find((s) => s.id === pendingEdge.to)?.label}」的连线；该节点随后按数组顺序继续。`}
          onCancel={() => setPendingEdge(null)}
          onConfirm={() => removeEdge(pendingEdge)}
        />
      )}
    </PageShell>
  )
}
