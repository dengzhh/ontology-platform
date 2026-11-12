import { useState } from 'react'
import {
  Scale, Plus, Trash2, X, Zap, GitBranch, RefreshCw, Loader2,
  BarChart3, History, Power, PowerOff, CheckCircle2,
} from 'lucide-react'
import PageShell from '@/components/ui/PageShell'
import Btn from '@/components/ui/Btn'
import DataTable from '@/components/ui/DataTable'
import { Badge } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import { Input, Select, Field } from '@/components/ui/Form'
import { ProgressBar, KVList } from '@/components/ui/Misc'
import { api } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'

/* ---------------- 类型（与后端返回结构对齐） ---------------- */

interface PropDef { key: string; name: string; type: string; required?: boolean; enumValues?: string[] }
interface TypeBrief { id: string; name: string; properties: PropDef[] }
interface TriggerCfg {
  kind: 'object_change' | 'threshold' | 'schedule'
  typeId?: string
  field?: string
  op?: string
  value?: number
  cron?: string
}
interface RuleAction { kind: string; config?: Record<string, unknown> }
interface Rule {
  id: string
  name: string
  enabled: boolean
  hitCount: number
  trigger: TriggerCfg
  condition: string
  actions: RuleAction[]
  triggerTypeName: string
  owner: string
  lastTriggeredAt: string
}
interface TriggerEvent { actor: string; action: string; target: string; time: string }
interface RulesResp { rules: Rule[]; triggerHistory: TriggerEvent[]; types: TypeBrief[] }

/* ---------------- 编辑态 ---------------- */

interface CondRow { id: number; attr: string; op: string; value: string }
interface ActionRow { id: number; kind: string; actionId: string }

let condSeq = 100
let actionSeq = 100

/** 操作符 / 动作种类为控件的固定枚举（非展示数据） */
const COND_OPS = ['<', '<=', '>', '>=', '=', '≠', '包含']
const TRIGGER_OPS = ['>', '<', '>=', '<=', '=']
const ACTION_KINDS: { kind: string; label: string }[] = [
  { kind: 'notify', label: '发送通知' },
  { kind: 'create_action', label: '执行本体动作' },
  { kind: 'hold_approval', label: '暂存审批' },
]
const ACTION_LABEL: Record<string, string> = {
  notify: '通知', create_action: '执行动作', hold_approval: '暂存审批',
}

function serializeCondition(rows: CondRow[]): string {
  return rows.filter((r) => r.value.trim() !== '').map((r) => `${r.attr} ${r.op} ${r.value}`).join(' AND ')
}

function triggerText(r: Rule): string {
  const t = r.trigger
  if (t.kind === 'threshold') return `${t.field ?? '?'} ${t.op ?? ''} ${t.value ?? ''}`
  if (t.kind === 'schedule') return '定时调度'
  return '对象创建 / 变更'
}

/** 规则引擎：面向对象与时序数据编写业务规则，命中即触发动作与通知 */
export default function Rules() {
  const q = useApi<RulesResp>('/p10plus/rules')
  const rules = q.data?.rules ?? []
  const history = q.data?.triggerHistory ?? []
  const types = q.data?.types ?? []

  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null)
  function notify(text: string, error = false) {
    setToast({ text, error })
    setTimeout(() => setToast(null), 2800)
  }

  const [showAnalysis, setShowAnalysis] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null)

  /* 新建规则弹层 */
  const [modalOpen, setModalOpen] = useState(false)
  const [formName, setFormName] = useState('')
  const [formKind, setFormKind] = useState<'object_change' | 'threshold'>('threshold')
  const [formTypeId, setFormTypeId] = useState('')
  const [formField, setFormField] = useState('')
  const [formOp, setFormOp] = useState('>')
  const [formValue, setFormValue] = useState('')
  const [condRows, setCondRows] = useState<CondRow[]>([])
  const [actionRows, setActionRows] = useState<ActionRow[]>([])
  const [busy, setBusy] = useState(false)
  const [formErr, setFormErr] = useState('')

  function propsOf(tid: string): PropDef[] {
    return types.find((t) => t.id === tid)?.properties ?? []
  }

  function openModal() {
    const tid = types[0]?.id ?? ''
    const props = propsOf(tid)
    setFormName('')
    setFormKind('threshold')
    setFormTypeId(tid)
    setFormField(props[0]?.key ?? '')
    setFormOp('>')
    setFormValue('')
    setCondRows([{ id: ++condSeq, attr: props[0]?.name ?? '属性', op: '<', value: '' }])
    setActionRows([{ id: ++actionSeq, kind: 'notify', actionId: '' }])
    setFormErr('')
    setModalOpen(true)
  }

  function changeType(tid: string) {
    const props = propsOf(tid)
    setFormTypeId(tid)
    setFormField(props[0]?.key ?? '')
    setCondRows((rs) => rs.map((r) => ({ ...r, attr: props[0]?.name ?? '属性' })))
  }

  const updateCond = (id: number, patch: Partial<CondRow>) =>
    setCondRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const updateAction = (id: number, patch: Partial<ActionRow>) =>
    setActionRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))

  /* 实时预览：将要提交给后端的请求体（condition 与 trigger 均来自构建器） */
  const previewActions = actionRows.map((r) =>
    r.kind === 'create_action' ? { kind: r.kind, config: { actionId: r.actionId.trim() } } : { kind: r.kind },
  )
  const previewTrigger: Record<string, unknown> = { kind: formKind, typeId: formTypeId || undefined }
  if (formKind === 'threshold') {
    previewTrigger.field = formField
    previewTrigger.op = formOp
    previewTrigger.value = formValue === '' ? null : Number(formValue)
  }
  const previewBody = {
    name: formName.trim() || '（未填写）',
    trigger: previewTrigger,
    condition: serializeCondition(condRows),
    actions: previewActions,
  }

  async function submitRule() {
    setFormErr('')
    const name = formName.trim()
    if (!name) { setFormErr('请填写规则名称'); return }
    if (actionRows.length === 0) { setFormErr('请至少添加一个命中后执行动作'); return }
    const actions = previewActions
    const trigger: Record<string, unknown> = { kind: formKind, typeId: formTypeId || undefined }
    if (formKind === 'threshold') {
      const num = Number(formValue)
      if (!formField || formValue.trim() === '' || Number.isNaN(num)) {
        setFormErr('阈值触发需选择监控字段并填写数值阈值'); return
      }
      trigger.field = formField
      trigger.op = formOp
      trigger.value = num
    }
    const condition = serializeCondition(condRows)
    setBusy(true)
    try {
      await api('/automations/rules', { method: 'POST', body: { name, trigger, condition, actions } })
      setModalOpen(false)
      notify('规则已创建并启用')
      q.reload()
    } catch (e) {
      notify(e instanceof Error ? e.message : '创建失败', true)
    } finally {
      setBusy(false)
    }
  }

  async function toggleRule(r: Rule) {
    setBusyId(r.id)
    try {
      await api(`/automations/rules/${r.id}`, { method: 'PATCH', body: { enabled: !r.enabled } })
      notify(r.enabled ? '规则已停用' : '规则已启用')
      q.reload()
    } catch (e) {
      notify(e instanceof Error ? e.message : '操作失败', true)
    } finally {
      setBusyId(null)
    }
  }

  async function deleteRule(id: string) {
    setBusyId(id)
    try {
      await api(`/automations/rules/${id}`, { method: 'DELETE' })
      setConfirmDelId(null)
      notify('规则已删除')
      q.reload()
    } catch (e) {
      notify(e instanceof Error ? e.message : '删除失败', true)
    } finally {
      setBusyId(null)
    }
  }

  /* 命中分析（全部基于真实 hitCount） */
  const totalHits = rules.reduce((s, r) => s + r.hitCount, 0)
  const maxHits = Math.max(1, ...rules.map((r) => r.hitCount))
  const enabledCount = rules.filter((r) => r.enabled).length
  const sortedByHits = [...rules].sort((a, b) => b.hitCount - a.hitCount)

  return (
    <PageShell
      icon={Scale}
      title="规则引擎"
      subtitle="面向对象与时序数据编写业务规则，命中即触发动作与通知"
      benchmark="规则引擎"
      features={[
        '规则列表：作用对象、触发条件、执行动作与累计命中量来自自动化引擎真实数据',
        '条件构建器：属性 + 操作符 + 值组合多行条件，序列化后写入规则 condition',
        '触发配置：对象变更 / 属性阈值写入 trigger，由自动化引擎解释执行',
        '启停与删除：规则卡直接调用后端 PATCH / DELETE 并即时刷新',
        '触发历史：来自审计日志中与自动化相关的真实事件',
        '命中分析：按真实命中数排序，识别规则风暴与高频告警',
      ]}
      actions={
        <>
          <Btn size="sm" onClick={() => q.reload()}><RefreshCw size={13} /> 刷新</Btn>
          <Btn size="sm" onClick={() => setShowAnalysis((v) => !v)}><BarChart3 size={13} /> {showAnalysis ? '收起命中分析' : '命中分析'}</Btn>
          <Btn size="sm" variant="primary" onClick={openModal}><Plus size={14} /> 新建规则</Btn>
        </>
      }
    >
      {toast && (
        <div className={cn('rounded-lg border px-4 py-2.5 text-sm font-medium', toast.error ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700')}>
          {toast.text}
        </div>
      )}

      {/* 规则列表 */}
      <Card>
        <CardHeader
          title={`规则列表（${rules.length}）`}
          desc={`启用 ${enabledCount} 条 · 停用 ${rules.length - enabledCount} 条 · 累计命中 ${totalHits} 次`}
          actions={<Badge color="green" dot>引擎运行中</Badge>}
        />
        {q.loading ? (
          <div className="flex items-center justify-center gap-2 py-14 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" /> 加载规则数据…</div>
        ) : q.error ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">{q.error}</div>
        ) : (
          <DataTable<Rule>
            columns={[
              { key: 'name', header: '规则名称', cell: (r: Rule) => <span className="font-semibold text-slate-800">{r.name}</span> },
              { key: 'target', header: '作用对象', cell: (r: Rule) => <Badge color="blue">{r.triggerTypeName}</Badge> },
              {
                key: 'cond', header: '触发条件', cell: (r: Rule) => (
                  <div className="max-w-[220px]">
                    <code className="rounded bg-slate-50 px-1.5 py-0.5 font-mono text-xs text-slate-600">{triggerText(r)}</code>
                    {r.condition && <div className="mt-1 truncate text-[11px] text-slate-400" title={r.condition}>{r.condition}</div>}
                  </div>
                ),
              },
              {
                key: 'actions', header: '执行动作', cell: (r: Rule) => (
                  <span className="flex items-center gap-1.5 text-xs text-slate-600">
                    <Zap size={12} className="text-amber-500" />
                    {r.actions.map((a) => ACTION_LABEL[a.kind] ?? a.kind).join('、') || '—'}
                  </span>
                ),
              },
              { key: 'owner', header: '负责人', cell: (r: Rule) => <span className="text-xs text-slate-500">{r.owner || '—'}</span> },
              { key: 'last', header: '最近触发', cell: (r: Rule) => <span className="text-[11px] text-slate-400">{r.lastTriggeredAt || '从未触发'}</span> },
              { key: 'hits', header: '累计命中', align: 'right', cell: (r: Rule) => <span className={cn('font-semibold', r.hitCount > 50 ? 'text-amber-600' : 'text-slate-700')}>{r.hitCount}</span> },
              {
                key: 'status', header: '状态 / 操作', cell: (r: Rule) => (
                  <div className="flex items-center justify-end gap-1.5">
                    {r.enabled ? <Badge color="green" dot>启用</Badge> : <Badge color="slate" dot>停用</Badge>}
                    <Btn size="sm" disabled={busyId === r.id} onClick={() => toggleRule(r)} title={r.enabled ? '停用该规则' : '启用该规则'}>
                      {r.enabled ? <PowerOff size={12} /> : <Power size={12} />}
                      {r.enabled ? '停用' : '启用'}
                    </Btn>
                    {confirmDelId === r.id ? (
                      <>
                        <Btn size="sm" variant="danger" disabled={busyId === r.id} onClick={() => deleteRule(r.id)}>确认删除</Btn>
                        <Btn size="sm" variant="ghost" onClick={() => setConfirmDelId(null)}>取消</Btn>
                      </>
                    ) : (
                      <button onClick={() => setConfirmDelId(r.id)} className="rounded-lg border border-slate-200 p-2 text-slate-400 transition-colors hover:border-red-200 hover:text-red-500" title="删除该规则">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                ),
              },
            ]}
            rows={rules}
            rowKey={(r) => r.id}
          />
        )}
      </Card>

      {/* 命中分析：真实 hitCount */}
      {showAnalysis && (
        <Card>
          <CardHeader title="命中分析" desc="按规则累计命中数排序，数据来自自动化引擎 hitCount" actions={<Badge color="blue">累计 {totalHits} 次</Badge>} />
          {sortedByHits.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-400">暂无规则数据</div>
          ) : (
            <div className="space-y-2.5">
              {sortedByHits.map((r) => (
                <div key={r.id} className="flex items-center gap-3">
                  <span className="w-44 shrink-0 truncate text-[13px] font-medium text-slate-700" title={r.name}>{r.name}</span>
                  <ProgressBar className="min-w-0 flex-1" pct={Math.round((r.hitCount / maxHits) * 100)} color={r.hitCount > 50 ? 'bg-amber-500' : 'bg-brand-500'} />
                  <span className="w-10 shrink-0 text-right text-xs font-semibold text-slate-600">{r.hitCount}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* 触发历史 + 说明 */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader title="触发历史" desc="来自审计日志的自动化相关事件（最近 10 条）" actions={<Badge color="slate">{history.length} 条</Badge>} />
          {history.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">暂无自动化触发记录</div>
          ) : (
            <div className="space-y-1.5">
              {history.map((h, i) => (
                <div key={i} className="flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2">
                  <History size={13} className="shrink-0 text-slate-300" />
                  <span className="w-20 shrink-0 text-[11px] text-slate-400">{h.actor}</span>
                  <span className="shrink-0 text-[12px] font-medium text-slate-700">{h.action}</span>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500" title={h.target}>{h.target}</span>
                  <span className="shrink-0 text-[11px] text-slate-400">{h.time}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card className="h-fit">
          <CardHeader title="规则引擎说明" desc="条件与触发如何进入请求体" />
          <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-slate-500"><GitBranch size={12} /> POST /automations/rules</div>
            <KVList
              cols={1}
              items={[
                { k: 'trigger', v: '触发方式 / 对象类型 / 阈值字段与数值' },
                { k: 'condition', v: '条件构建器多行内容以 AND 连接' },
                { k: 'actions', v: 'notify / create_action / hold_approval' },
              ]}
            />
          </div>
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-100 bg-emerald-50/60 p-3 text-[11px] leading-5 text-emerald-700">
            <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
            新建规则默认启用；每次写操作后自动刷新列表与命中统计。
          </div>
        </Card>
      </div>

      {/* 新建规则弹层：条件行编辑 + 触发配置 + 动作 + 请求预览 */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={() => setModalOpen(false)}>
          <div className="max-h-[90vh] w-[720px] max-w-[96vw] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div className="text-base font-bold text-slate-900">新建规则</div>
              <button onClick={() => setModalOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={16} /></button>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Field label="规则名称" required>
                <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="如：设备健康骤降预警" />
              </Field>
              <Field label="作用对象类型" hint="来自本体真实对象类型">
                <Select className="w-full" value={formTypeId} onChange={(e) => changeType(e.target.value)}>
                  {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  {types.length === 0 && <option value="">（当前空间无对象类型）</option>}
                </Select>
              </Field>
            </div>

            {/* 触发配置 → trigger */}
            <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/50 p-3">
              <div className="mb-2.5 text-xs font-semibold text-slate-600">触发配置（写入 trigger）</div>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="触发方式">
                  <Select className="w-full" value={formKind} onChange={(e) => setFormKind(e.target.value as 'object_change' | 'threshold')}>
                    <option value="threshold">属性阈值（数值比较）</option>
                    <option value="object_change">对象创建 / 变更</option>
                  </Select>
                </Field>
                {formKind === 'threshold' && (
                  <>
                    <Field label="监控字段">
                      <Select className="w-full" value={formField} onChange={(e) => setFormField(e.target.value)}>
                        {propsOf(formTypeId).map((p) => <option key={p.key} value={p.key}>{p.name}（{p.key}）</option>)}
                        {propsOf(formTypeId).length === 0 && <option value="">（无属性）</option>}
                      </Select>
                    </Field>
                    <Field label="比较操作">
                      <Select className="w-full" value={formOp} onChange={(e) => setFormOp(e.target.value)}>
                        {TRIGGER_OPS.map((o) => <option key={o} value={o}>{o}</option>)}
                      </Select>
                    </Field>
                    <Field label="阈值（数值）" required>
                      <Input type="number" value={formValue} onChange={(e) => setFormValue(e.target.value)} placeholder="如 60" />
                    </Field>
                  </>
                )}
              </div>
            </div>

            {/* 条件构建器 → condition（保留条件行编辑体验） */}
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xs font-semibold text-slate-600">条件构建器（写入 condition）</div>
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400"><GitBranch size={12} /> 条件间逻辑：满足全部（AND）</div>
              </div>
              <div className="space-y-2">
                {condRows.map((r, i) => (
                  <div key={r.id} className="flex items-center gap-2">
                    <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold', i === 0 ? 'bg-slate-100 text-slate-400' : 'bg-brand-50 text-brand-600')}>
                      {i === 0 ? 'IF' : 'AND'}
                    </span>
                    <Select value={r.attr} onChange={(e) => updateCond(r.id, { attr: e.target.value })} className="min-w-0 flex-1">
                      {propsOf(formTypeId).map((p) => <option key={p.key} value={p.name}>{p.name}</option>)}
                      {propsOf(formTypeId).length === 0 && <option value={r.attr}>{r.attr}</option>}
                    </Select>
                    <Select value={r.op} onChange={(e) => updateCond(r.id, { op: e.target.value })} className="w-20">
                      {COND_OPS.map((o) => <option key={o}>{o}</option>)}
                    </Select>
                    <Input value={r.value} onChange={(e) => updateCond(r.id, { value: e.target.value })} className="w-24" placeholder="值" />
                    <button
                      onClick={() => setCondRows((rs) => rs.filter((x) => x.id !== r.id))}
                      disabled={condRows.length <= 1}
                      className="shrink-0 rounded-lg border border-slate-200 p-2 text-slate-400 transition-colors hover:border-red-200 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-30"
                      title={condRows.length <= 1 ? '至少保留一个条件' : '删除该条件'}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => setCondRows((rs) => [...rs, { id: ++condSeq, attr: propsOf(formTypeId)[0]?.name ?? '属性', op: '<', value: '' }])}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-200 py-2 text-xs font-medium text-slate-400 transition-colors hover:border-brand-300 hover:text-brand-600"
                >
                  <Plus size={13} /> 添加条件行
                </button>
              </div>
            </div>

            {/* 命中后执行动作 → actions */}
            <div className="mt-4">
              <div className="mb-2 text-xs font-semibold text-slate-600">命中后执行动作（写入 actions，至少 1 条）</div>
              <div className="space-y-2">
                {actionRows.map((a) => (
                  <div key={a.id} className="flex items-center gap-2">
                    <Zap size={14} className="shrink-0 text-amber-500" />
                    <Select value={a.kind} onChange={(e) => updateAction(a.id, { kind: e.target.value })} className="min-w-0 flex-1">
                      {ACTION_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
                    </Select>
                    {a.kind === 'create_action' && (
                      <Input value={a.actionId} onChange={(e) => updateAction(a.id, { actionId: e.target.value })} className="w-40" placeholder="动作类型 ID" />
                    )}
                    <button
                      onClick={() => setActionRows((rs) => rs.filter((x) => x.id !== a.id))}
                      disabled={actionRows.length <= 1}
                      className="shrink-0 rounded-lg border border-slate-200 p-2 text-slate-400 transition-colors hover:border-red-200 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-30"
                      title={actionRows.length <= 1 ? '至少保留一个动作' : '删除该动作'}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => setActionRows((rs) => [...rs, { id: ++actionSeq, kind: 'notify', actionId: '' }])}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-200 py-2 text-xs font-medium text-slate-400 transition-colors hover:border-brand-300 hover:text-brand-600"
                >
                  <Plus size={13} /> 添加动作
                </button>
              </div>
            </div>

            {/* 请求体预览（替代原假测试面板，展示真正提交的内容） */}
            <div className="mt-4">
              <div className="mb-1.5 text-[11px] font-medium text-slate-400">请求体预览 · POST /automations/rules</div>
              <pre className="max-h-44 overflow-auto rounded-lg border border-slate-100 bg-slate-900 p-3 font-mono text-[11px] leading-4 text-slate-100">{JSON.stringify(previewBody, null, 2)}</pre>
            </div>

            {formErr && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{formErr}</div>}
            <div className="mt-5 flex justify-end gap-2">
              <Btn onClick={() => setModalOpen(false)}>取消</Btn>
              <Btn variant="primary" disabled={busy || types.length === 0} onClick={submitRule}>{busy ? '创建中…' : '创建并启用'}</Btn>
            </div>
            {types.length === 0 && <div className="mt-2 text-right text-[11px] text-amber-600">当前空间无对象类型，无法新建规则</div>}
          </div>
        </div>
      )}
    </PageShell>
  )
}
