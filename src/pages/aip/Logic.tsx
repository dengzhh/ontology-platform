import { useEffect, useState } from 'react'
import { Sparkles, Plus, Trash2, X, Loader2, Play, Save, RefreshCw, Search, GitBranch, ArrowRight } from 'lucide-react'
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
}

/** AIP Logic（P6 真实）：工作流持久化 + 真实分支执行引擎 */
export default function AipLogic() {
  const wfQ = useApi<{ workflows: { id: string; name: string; steps: WorkflowStep[]; updatedAt: number }[] }>('/logic/workflows')
  const workflows = wfQ.data?.workflows ?? []
  const [wfId, setWfId] = useState<string | null>(null)
  const [wfName, setWfName] = useState('设备停机归因分析')
  const [steps, setSteps] = useState<WorkflowStep[]>([
    { id: 's1', type: 'input', label: '输入数据', outputFormat: '对象集/文本' },
    { id: 's2', type: 'llm', label: 'LLM 分析', prompt: '分析给定的设备数据，识别异常并给出建议', model: 'auto' },
    { id: 's3', type: 'condition', label: '置信度判断', condition: '置信度 > 0.8' },
    { id: 's4', type: 'output', label: '输出结果', outputFormat: '结构化 JSON' },
  ])
  const [selectedStep, setSelectedStep] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [stepResults, setStepResults] = useState<{ step: string; type: string; output: string; branch?: string }[]>([])
  const [testResult, setTestResult] = useState<string>('')
  const [testInput, setTestInput] = useState('设备 F2-IM-2041 健康度 62，已停机 47.5 小时，关联工单 GD-2291')
  const [toast, setToast] = useState('')
  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3000) }
  const sel = steps.find((s) => s.id === selectedStep)

  // 首次加载选中第一个工作流
  useEffect(() => {
    if (!wfId && workflows.length) {
      const w = workflows[0]
      setWfId(w.id); setWfName(w.name); setSteps(w.steps)
    }
  }, [workflows, wfId])

  async function selectWorkflow(id: string) {
    const w = workflows.find((x) => x.id === id)
    if (!w) return
    setWfId(w.id); setWfName(w.name); setSteps(w.steps); setStepResults([]); setTestResult('')
  }

  async function saveWorkflow() {
    if (!wfName.trim()) return notify('请填写工作流名称')
    setBusy(true)
    try {
      const r = await api<{ id: string }>('/logic/workflows', { method: 'POST', body: { id: wfId ?? undefined, name: wfName, steps } })
      setWfId(r.id)
      notify('工作流已保存（服务端持久化）')
      wfQ.reload()
    } catch (e) { notify(e instanceof Error ? e.message : '保存失败') }
    finally { setBusy(false) }
  }

  async function newWorkflow() {
    setWfId(null); setWfName('新建工作流'); setSteps([{ id: 's1', type: 'input', label: '输入数据' }]); setStepResults([]); setTestResult('')
  }

  async function deleteWorkflow() {
    if (!wfId) return
    setBusy(true)
    try {
      await api(`/logic/workflows/${wfId}`, { method: 'DELETE' })
      notify('工作流已删除'); setWfId(null); newWorkflow(); wfQ.reload()
    } catch (e) { notify(e instanceof Error ? e.message : '删除失败') }
    finally { setBusy(false) }
  }

  function updateStep(id: string, patch: Partial<WorkflowStep>) {
    setSteps(steps.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }

  function addStep(type: WorkflowStep['type']) {
    const labels: Record<string, string> = { input: '输入', llm: 'LLM 节点', condition: '条件分支', output: '输出' }
    const id = `s${Date.now().toString(36)}`
    setSteps([...steps, { id, type, label: labels[type] }])
    setSelectedStep(id)
  }

  async function runTest() {
    setBusy(true); setTestResult(''); setStepResults([])
    try {
      // 先保存工作流，再走真实逐步执行引擎
      const r = await api<{ id: string }>('/logic/workflows', { method: 'POST', body: { id: wfId ?? undefined, name: wfName, steps } })
      setWfId(r.id)
      const res = await api<{ final: string; results: { step: string; type: string; output: string; branch?: string }[] }>(`/logic/workflows/${r.id}/run`, { method: 'POST', body: { input: testInput } })
      setStepResults(res.results ?? [])
      setTestResult(res.final || '（无输出）')
      wfQ.reload()
    } catch (e) {
      setTestResult(`执行失败：${e instanceof Error ? e.message : '未知错误'}`)
    } finally { setBusy(false) }
  }

  // 生成画布节点坐标
  const canvasNodes: FlowNode[] = steps.map((s, i) => {
    const meta: Record<string, { icon: typeof Sparkles; accent: string; badge?: string }> = {
      input: { icon: Search, accent: 'bg-brand-50 text-brand-600' },
      llm: { icon: Sparkles, accent: 'bg-violet-50 text-violet-600' },
      condition: { icon: GitBranch, accent: 'bg-amber-50 text-amber-600' },
      output: { icon: ArrowRight, accent: 'bg-emerald-50 text-emerald-600' },
    }
    const m = meta[s.type]
    return {
      id: s.id,
      x: 40 + (i % 3) * 240,
      y: 40 + Math.floor(i / 3) * 140,
      title: s.label,
      subtitle: s.type === 'llm' ? (s.model ?? 'auto') : s.type === 'condition' ? s.condition : '',
      icon: m.icon,
      accent: m.accent,
      badge: s.type,
    }
  })
  const canvasEdges: FlowEdge[] = steps.slice(0, -1).map((s, i) => ({ from: s.id, to: steps[i + 1].id }))

  return (
    <PageShell
      icon={Sparkles}
      title="AIP Logic 工作流编排"
      subtitle="可视化编排 LLM 工作流：输入→LLM→条件→输出，可测试运行"
      benchmark="AI 工作流"
      features={[
        '工作流持久化：服务端保存/加载/删除多个工作流',
        'LLM 节点配置：系统提示词 + 模型选择，指导 LLM 如何处理数据',
        '条件节点：真实解析条件表达式或由 LLM 判定，分支结果影响后续节点',
        '逐步执行引擎：按节点顺序执行，展示每步输入/输出/分支走向',
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
          <Btn size="sm" variant="primary" onClick={saveWorkflow} disabled={busy}><Save size={13} /> 保存</Btn>
          {wfId && <Btn size="sm" variant="ghost" onClick={deleteWorkflow}><Trash2 size={12} /></Btn>}
        </>
      }
    >
      {toast && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">{toast}</div>}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[200px_minmax(0,1fr)_280px]">
        {/* 节点面板 */}
        <div className="card h-fit p-3">
          <div className="mb-2 text-xs font-semibold text-slate-500">添加节点</div>
          {([
            { type: 'input' as const, label: '输入', icon: Search },
            { type: 'llm' as const, label: 'LLM 节点', icon: Sparkles },
            { type: 'condition' as const, label: '条件分支', icon: GitBranch },
            { type: 'output' as const, label: '输出', icon: ArrowRight },
          ]).map((n) => (
            <button key={n.type} onClick={() => addStep(n.type)} className="mb-1.5 flex w-full items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-2 text-[12px] text-slate-600 hover:border-brand-300 hover:bg-brand-50/50 hover:text-brand-700">
              <n.icon size={13} className="text-slate-400" /> {n.label}
            </button>
          ))}
        </div>

        {/* 画布 */}
        <div className="canvas-grid min-h-[400px] rounded-xl border border-slate-200 bg-white p-2">
          <FlowCanvas nodes={canvasNodes} edges={canvasEdges} width={720} height={400} />
          <div className="mt-2 text-center text-[11px] text-slate-400">{steps.length} 个节点 · 点击右侧面板配置选中节点</div>
        </div>

        {/* 属性面板 */}
        <div className="card h-fit p-3.5">
          <div className="mb-2.5 text-xs font-semibold text-slate-600">节点配置</div>
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
                <Field label="条件表达式" hint="输出路由规则">
                  <Input value={sel.condition ?? ''} onChange={(e) => updateStep(sel.id, { condition: e.target.value })} placeholder="如：置信度 > 0.8" />
                </Field>
              )}
              {(sel.type === 'input' || sel.type === 'output') && (
                <Field label="格式说明"><Input value={sel.outputFormat ?? ''} onChange={(e) => updateStep(sel.id, { outputFormat: e.target.value })} placeholder="如：对象集/JSON" /></Field>
              )}
              <button onClick={() => { setSteps(steps.filter((s) => s.id !== sel.id)); setSelectedStep(null) }} className="w-full rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-500 hover:bg-red-50">删除节点</button>
            </div>
          ) : (
            <div className="text-center text-xs text-slate-400">点击画布中的节点进行配置</div>
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
    </PageShell>
  )
}
