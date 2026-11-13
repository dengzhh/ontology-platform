import { useEffect, useState, type ReactNode } from 'react'
import { Sparkles, Plus, Trash2, X, Loader2, Play, Save, Search, GitBranch, ArrowRight, ArrowUp, ArrowDown, Copy, Link2 } from 'lucide-react'
import PageShell from '@/components/ui/PageShell'
import Btn from '@/components/ui/Btn'
import { Badge } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import { Input, Field, Select } from '@/components/ui/Form'
import FlowCanvas, { type FlowNode, type FlowEdge } from '@/components/canvas/FlowCanvas'
import { api } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'

interface WorkflowStep {
  id: string
  type: 'input' | 'llm' | 'condition' | 'output'
  label: string
  prompt?: string
  model?: string
  condition?: string
  outputFormat?: string
  /** 画布坐标（可拖拽调整，保存后持久化） */
  x?: number
  y?: number
  /** 条件节点分支目标：命中走 nextYes，否则走 nextNo；留空则按数组顺序继续 */
  nextYes?: string
  nextNo?: string
}
interface Workflow { id: string; name: string; steps: WorkflowStep[]; updatedAt: number }

const TYPE_META: Record<WorkflowStep['type'], { icon: typeof Sparkles; accent: string; label: string }> = {
  input: { icon: Search, accent: 'bg-brand-50 text-brand-600', label: '输入' },
  llm: { icon: Sparkles, accent: 'bg-violet-50 text-violet-600', label: 'LLM 节点' },
  condition: { icon: GitBranch, accent: 'bg-amber-50 text-amber-600', label: '条件分支' },
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

/** AIP Logic：工作流可视化编排（节点可点选编辑/拖拽/排序/复制/连线）+ 服务端持久化 + 真实分支执行引擎 */
export default function AipLogic() {
  const wfQ = useApi<{ workflows: Workflow[] }>('/logic/workflows')
  const workflows = wfQ.data?.workflows ?? []
  const [wfId, setWfId] = useState<string | null>(null)
  const [wfName, setWfName] = useState('设备停机归因分析')
  const [steps, setSteps] = useState<WorkflowStep[]>(defaultSteps())
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

  // 首次加载选中第一个工作流
  useEffect(() => {
    if (!wfId && workflows.length) {
      const w = workflows[0]
      setWfId(w.id); setWfName(w.name); setSteps(w.steps)
    }
  }, [workflows, wfId])

  /** 把后端返回的旧工作流补齐坐标（兼容历史数据，避免节点全部叠在原点） */
  function normalizeSteps(raw: WorkflowStep[]): WorkflowStep[] {
    return (raw ?? []).map((s, i) => ({ ...s, x: s.x ?? 40 + (i % 3) * 240, y: s.y ?? 40 + Math.floor(i / 3) * 140 }))
  }

  async function selectWorkflow(id: string) {
    const w = workflows.find((x) => x.id === id)
    if (!w) return
    setWfId(w.id); setWfName(w.name); setSteps(normalizeSteps(w.steps)); setSelectedStep(null); setStepResults([]); setTestResult('')
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
      const r = await api<{ id: string }>('/logic/workflows', { method: 'POST', body: { id: wfId ?? undefined, name: wfName, steps } })
      setWfId(r.id)
      wfQ.reload()
      return r.id
    } catch (e) { notify(e instanceof Error ? e.message : '保存失败'); return null }
    finally { setBusy(false) }
  }

  function newWorkflow() {
    setWfId(null); setWfName('新建工作流'); setSteps(defaultSteps()); setSelectedStep(null); setStepResults([]); setTestResult('')
  }

  function updateStep(id: string, patch: Partial<WorkflowStep>) {
    setSteps((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)))
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
    }
    setSteps((list) => [...list, step])
    setSelectedStep(id)
  }

  function duplicateStep(id: string) {
    const s = steps.find((x) => x.id === id)
    if (!s) return
    const newId = `s${Date.now().toString(36)}`
    setSteps((list) => [...list, { ...s, id: newId, label: `${s.label} 副本`, x: (s.x ?? 40) + 30, y: (s.y ?? 60) + 90 }])
    setSelectedStep(newId)
  }

  function moveStep(id: string, dir: -1 | 1) {
    setSteps((list) => {
      const i = list.findIndex((s) => s.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= list.length) return list
      const next = [...list]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
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
    setSteps((list) => list.filter((s) => s.id !== id).map((s) => ({
      ...s,
      nextYes: s.nextYes === id ? undefined : s.nextYes,
      nextNo: s.nextNo === id ? undefined : s.nextNo,
    })))
    if (selectedStep === id) setSelectedStep(null)
    setPendingDelete(null)
    notify('节点已删除')
  }

  async function runTest() {
    setBusy(true); setTestResult(''); setStepResults([])
    try {
      const id = await saveWorkflow()
      if (!id) { setBusy(false); return }
      const res = await api<{ final: string; results: { step: string; type: string; output: string; branch?: string }[] }>(`/logic/workflows/${id}/run`, { method: 'POST', body: { input: testInput } })
      setStepResults(res.results ?? [])
      setTestResult(res.final || '（无输出）')
      wfQ.reload()
    } catch (e) {
      setTestResult(`执行失败：${e instanceof Error ? e.message : '未知错误'}`)
    } finally { setBusy(false) }
  }

  // 生成画布节点坐标（拖拽位置优先，缺省按序号排布）
  const canvasNodes: FlowNode[] = steps.map((s, i) => {
    const m = TYPE_META[s.type]
    return {
      id: s.id,
      x: s.x ?? 40 + (i % 3) * 240,
      y: s.y ?? 40 + Math.floor(i / 3) * 140,
      title: s.label,
      subtitle: s.type === 'llm' ? (s.model ?? 'auto') : s.type === 'condition' ? s.condition : '',
      icon: m.icon,
      accent: m.accent,
      badge: s.type,
    }
  })

  // 连线：条件节点按 nextYes/nextNo 生成两条带标签的分支线，其余按数组顺序串联
  const canvasEdges: FlowEdge[] = []
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]
    if (s.type === 'condition') {
      if (s.nextYes) canvasEdges.push({ from: s.id, to: s.nextYes, label: '是', kind: 'yes' })
      if (s.nextNo) canvasEdges.push({ from: s.id, to: s.nextNo, label: '否', kind: 'no', dashed: true })
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
      title="AIP Logic 工作流编排"
      subtitle="可视化编排 LLM 工作流：点击节点编辑、拖拽布局、调整顺序与分支连线，可测试运行"
      benchmark="AI 工作流"
      features={[
        '节点编辑：点击画布节点即选中，右侧配置名称/提示词/模型/条件/输出格式',
        '画布交互：拖拽节点调整位置（坐标随工作流保存）、选中节点高亮描边',
        '顺序与分支：上移/下移改变执行顺序；条件节点可指定「是/否」分支目标并着色连线',
        '删除确认：删除节点或工作流均弹层确认，可取消；节点可复制',
        '真实闭环：服务端持久化 + 按连线逐步执行引擎（LLM/条件分支真实生效）',
      ]}
      actions={
        <>
          <select value={wfId ?? ''} onChange={(e) => e.target.value ? selectWorkflow(e.target.value) : newWorkflow()} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700">
            <option value="">（新建工作流）</option>
            {workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <input value={wfName} onChange={(e) => setWfName(e.target.value)} className="w-36 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs" placeholder="工作流名称" />
          <Btn size="sm" onClick={newWorkflow}>新建</Btn>
          <Btn size="sm" onClick={runTest} disabled={busy}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} 运行</Btn>
          <Btn size="sm" variant="primary" onClick={() => saveWorkflow().then((id) => id && notify('工作流已保存（服务端持久化）'))} disabled={busy}><Save size={13} /> 保存</Btn>
          {wfId && <Btn size="sm" variant="ghost" onClick={() => setPendingDelete('workflow')}><Trash2 size={12} /></Btn>}
        </>
      }
    >
      {toast && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">{toast}</div>}

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
            提示：点击画布节点进行编辑；拖拽可调整布局；连线由节点顺序与条件分支目标自动生成。
          </div>
        </div>

        {/* 画布 */}
        <div className="canvas-grid min-h-[440px] rounded-xl border border-slate-200 bg-white p-2">
          <FlowCanvas
            nodes={canvasNodes}
            edges={canvasEdges}
            width={1000}
            height={420}
            selectedId={selectedStep}
            onNodeClick={(id) => setSelectedStep(id)}
            onNodeMove={(id, x, y) => updateStep(id, { x, y })}
          />
          <div className="mt-2 flex items-center justify-center gap-3 text-[11px] text-slate-400">
            <span>{steps.length} 个节点 · 点击节点编辑 / 拖拽调整布局</span>
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
              <Field label="节点名称"><Input value={sel.label} onChange={(e) => updateStep(sel.id, { label: e.target.value })} /></Field>
              {sel.type === 'llm' && (
                <>
                  <Field label="系统提示词" hint="指导 LLM 如何处理数据">
                    <textarea
                      value={sel.prompt ?? ''}
                      onChange={(e) => updateStep(sel.id, { prompt: e.target.value })}
                      placeholder="分析给定的设备数据…"
                      className="h-24 w-full resize-none rounded-lg border border-slate-200 p-2.5 text-xs focus:border-brand-400 focus:outline-none"
                    />
                  </Field>
                  <Field label="模型">
                    <Select className="w-full" value={sel.model ?? 'auto'} onChange={(e) => updateStep(sel.id, { model: e.target.value })}>
                      <option value="auto">自动（用平台配置）</option>
                      <option value="deepseek-v4.1-flash">deepseek-v4.1-flash</option>
                      <option value="glm-5.3-flash">glm-5.3-flash</option>
                    </Select>
                  </Field>
                </>
              )}
              {sel.type === 'condition' && (
                <>
                  <Field label="条件表达式" hint="如：置信度 > 0.8 / 金额 >= 100">
                    <Input value={sel.condition ?? ''} onChange={(e) => updateStep(sel.id, { condition: e.target.value })} placeholder="如：置信度 > 0.8" />
                  </Field>
                  <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-2.5">
                    <div className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold text-slate-600"><Link2 size={12} /> 分支连线</div>
                    <Field label="是 → 目标节点">
                      <Select className="w-full" value={sel.nextYes ?? ''} onChange={(e) => updateStep(sel.id, { nextYes: e.target.value || undefined })}>
                        <option value="">（按顺序继续）</option>
                        {steps.filter((s) => s.id !== sel.id).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                      </Select>
                    </Field>
                    <Field label="否 → 目标节点">
                      <Select className="w-full" value={sel.nextNo ?? ''} onChange={(e) => updateStep(sel.id, { nextNo: e.target.value || undefined })}>
                        <option value="">（按顺序继续）</option>
                        {steps.filter((s) => s.id !== sel.id).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                      </Select>
                    </Field>
                  </div>
                </>
              )}
              {(sel.type === 'input' || sel.type === 'output') && (
                <Field label="格式说明"><Input value={sel.outputFormat ?? ''} onChange={(e) => updateStep(sel.id, { outputFormat: e.target.value })} placeholder="如：对象集/JSON" /></Field>
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
              {busy ? '执行中…' : '运行工作流'}
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

      {pendingDelete && (
        <ConfirmModal
          title={pendingDelete === 'workflow' ? '删除工作流？' : '删除节点？'}
          desc={`「${pendingName}」删除后不可恢复，可在确认前取消。`}
          onCancel={() => setPendingDelete(null)}
          onConfirm={doDelete}
        />
      )}
    </PageShell>
  )
}
