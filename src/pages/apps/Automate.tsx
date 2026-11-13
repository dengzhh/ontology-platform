import { useState } from 'react'
import { Zap, Bell, Send, Plus, Trash2, Loader2, X, Clock3, Pencil } from 'lucide-react'
import PageShell from '@/components/ui/PageShell'
import Btn from '@/components/ui/Btn'
import { Badge } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import StatCard from '@/components/ui/StatCard'
import { Input, Select, Field } from '@/components/ui/Form'
import { api } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { useUI } from '@/store/ui'
import { cn } from '@/lib/utils'

interface Trigger { kind: 'object_change' | 'threshold'; typeId?: string; field?: string; op?: string; value?: number }
interface RuleAction { kind: string; config?: Record<string, unknown> }
interface RuleRow {
  id: string; name: string; trigger: Trigger; condition: string; actions: RuleAction[]
  enabled: boolean; hitCount: number; lastTriggeredAt: string; triggerTypeName: string
}
interface TypeBrief { id: string; name: string; properties: { key: string; name: string; type: string }[] }
interface ActionBrief { id: string; name: string; needsApproval: boolean }

const ACTION_LABEL: Record<string, string> = { notify: '发通知', create_action: '执行动作', hold_approval: '暂存审批' }

interface RuleForm {
  name: string; condition: string; kind: 'object_change' | 'threshold'; typeId: string; field: string; op: string; value: string
  doNotify: boolean; doAction: string; doHold: boolean
}
const EMPTY_FORM: RuleForm = { name: '', condition: '', kind: 'object_change', typeId: '', field: '', op: '>', value: '', doNotify: true, doAction: '', doHold: false }

/** 由表单构造 trigger / actions，供新建与编辑复用 */
function buildPayload(form: RuleForm): { name: string; condition: string; trigger: Trigger; actions: RuleAction[] } {
  const acts: RuleAction[] = []
  if (form.doNotify) acts.push({ kind: 'notify' })
  if (form.doAction) acts.push({ kind: 'create_action', config: { actionId: form.doAction } })
  if (form.doHold && form.doAction) acts.push({ kind: 'hold_approval', config: { actionId: form.doAction } })
  return {
    name: form.name.trim(),
    condition: form.condition.trim(),
    trigger: form.kind === 'threshold'
      ? { kind: 'threshold', typeId: form.typeId, field: form.field, op: form.op, value: Number(form.value) }
      : { kind: 'object_change', typeId: form.typeId },
    actions: acts,
  }
}

function validate(form: RuleForm): string {
  if (!form.name.trim()) return '请填写规则名称'
  if (form.kind === 'threshold' && (!form.typeId || !form.field || !form.value)) return '阈值触发需要类型、字段与阈值'
  if (form.kind === 'object_change' && !form.typeId) return '请选择监听的对象类型'
  return ''
}

/** Automate 自动化（P7 真实）：对象变更/阈值 → 通知/执行动作/暂存审批 */
export default function Automate() {
  const { setNotifOpen } = useUI()
  const q = useApi<{ space: { name: string }; types: TypeBrief[]; rules: RuleRow[] }>('/automations/rules')
  const actionsQ = useApi<{ actions: ActionBrief[] }>('/actions')
  const rules = q.data?.rules ?? []
  const types = q.data?.types ?? []
  const actions = actionsQ.data?.actions ?? []
  const [toast, setToast] = useState('')
  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2600) }

  /* 新建 / 编辑规则向导状态 */
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<RuleRow | null>(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<RuleForm>(EMPTY_FORM)
  const selType = types.find((t) => t.id === form.typeId)

  function closeModal() {
    setOpen(false)
    setEditing(null)
    setForm(EMPTY_FORM)
  }

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setOpen(true)
  }

  function openEdit(r: RuleRow) {
    setEditing(r)
    const createAction = r.actions.find((a) => a.kind === 'create_action')
    const holdAction = r.actions.find((a) => a.kind === 'hold_approval')
    const t = r.trigger
    setForm({
      name: r.name, condition: r.condition ?? '',
      kind: t.kind === 'threshold' ? 'threshold' : 'object_change',
      typeId: t.typeId ?? '', field: t.field ?? '', op: t.op ?? '>', value: t.value !== undefined ? String(t.value) : '',
      doNotify: r.actions.some((a) => a.kind === 'notify'),
      doAction: String(createAction?.config?.actionId ?? holdAction?.config?.actionId ?? ''),
      doHold: !!holdAction,
    })
    setOpen(true)
  }

  async function submit() {
    const err = validate(form)
    if (err) return notify(err)
    const payload = buildPayload(form)
    if (payload.actions.length === 0) return notify('至少选择一个执行动作')
    setBusy(true)
    try {
      if (editing) {
        await api(`/automations/rules/${editing.id}`, { method: 'PATCH', body: payload })
        notify(`规则「${payload.name}」已更新`)
      } else {
        await api('/automations/rules', { method: 'POST', body: payload })
        notify(`规则「${payload.name}」已创建并启用`)
      }
      closeModal()
      q.reload()
    } catch (e) {
      notify(e instanceof Error ? e.message : '保存失败')
    } finally { setBusy(false) }
  }

  async function toggle(r: RuleRow) {
    try {
      await api(`/automations/rules/${r.id}`, { method: 'PATCH', body: { enabled: !r.enabled } })
      q.reload()
    } catch (e) { notify(e instanceof Error ? e.message : '操作失败') }
  }
  async function remove(r: RuleRow) {
    try {
      await api(`/automations/rules/${r.id}`, { method: 'DELETE' })
      notify(`已删除「${r.name}」`)
      q.reload()
    } catch (e) { notify(e instanceof Error ? e.message : '删除失败') }
  }

  return (
    <PageShell
      icon={Zap}
      title="自动化引擎"
      subtitle="对象变更与阈值规则驱动通知、动作执行与暂存审批 —— 与顶栏通知中心联动"
      benchmark="自动化引擎"
      features={[
        '触发器：对象任何变化（新增/更新/删除）或数值字段阈值（> < >= <= =）',
        '条件表达式：如「健康度 < 60」「名称 包含 异常」，命中对象时按 values 求值',
        '执行动作：发通知（进通知中心）/ 执行动作（复用动作引擎）/ 暂存审批（转人工确认）',
        '空间隔离：规则只监听当前本体空间内的对象事件',
        '全程留痕：触发即审计，命中次数与最近触发时间可查',
      ]}
      actions={
        <>
          <Btn size="sm" onClick={() => setNotifOpen(true)}><Bell size={13} /> 通知中心</Btn>
          <Btn size="sm" variant="primary" onClick={openCreate}><Plus size={14} /> 新建规则</Btn>
        </>
      }
    >
      {toast && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">{toast}</div>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="规则总数" value={rules.length} icon={Zap} footer={`空间「${q.data?.space.name ?? '…'}」`} />
        <StatCard label="启用中" value={rules.filter((r) => r.enabled).length} icon={Clock3} iconClass="bg-emerald-50 text-emerald-600" footer="实时监听对象事件" />
        <StatCard label="累计触发" value={rules.reduce((s, r) => s + r.hitCount, 0)} icon={Send} iconClass="bg-amber-50 text-amber-600" footer="命中即审计留痕" />
        <StatCard label="可执行动作" value={actions.length} icon={Plus} iconClass="bg-violet-50 text-violet-600" footer="动作引擎提供" />
      </div>

      <Card padding={false}>
        <div className="border-b border-slate-100 p-4"><CardHeader className="mb-0" title="自动化规则" desc="开关即时生效；触发记录见审计日志" /></div>
        <div className="p-4">
          {q.loading ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" /> 加载规则…</div>
          ) : rules.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 py-12 text-center text-sm text-slate-400">
              当前空间暂无自动化规则，点击右上「新建规则」创建第一条（如：支出金额超过 500 时通知我）
            </div>
          ) : (
            <div className="space-y-2.5">
              {rules.map((r) => (
                <div key={r.id} className={cn('flex items-center gap-3 rounded-xl border p-3.5', r.enabled ? 'border-brand-200 bg-brand-50/30' : 'border-slate-200 opacity-70')}>
                  <button
                    onClick={() => toggle(r)}
                    className={cn('relative h-5 w-9 shrink-0 rounded-full transition-colors', r.enabled ? 'bg-brand-600' : 'bg-slate-200')}
                    title={r.enabled ? '点击停用' : '点击启用'}
                  >
                    <span className={cn('absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', r.enabled && 'left-[18px]')} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-bold text-slate-800">{r.name}</span>
                      <Badge color={r.trigger.kind === 'threshold' ? 'amber' : 'blue'}>
                        {r.trigger.kind === 'threshold' ? `${r.triggerTypeName}.${r.trigger.field} ${r.trigger.op ?? '>'} ${r.trigger.value}` : `${r.triggerTypeName} 任何变化`}
                      </Badge>
                      {r.condition && <Badge color="violet">条件 · {r.condition}</Badge>}
                      {r.actions.map((a, i) => (
                        <span key={i} className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-600">
                          {a.kind === 'notify' ? <Bell size={10} /> : a.kind === 'create_action' ? <Zap size={10} /> : <Clock3 size={10} />}
                          {ACTION_LABEL[a.kind] ?? a.kind}{a.config?.actionId ? `·${actions.find((x) => x.id === a.config?.actionId)?.name ?? ''}` : ''}
                        </span>
                      ))}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-400">
                      命中 {r.hitCount} 次{r.lastTriggeredAt ? ` · 最近 ${r.lastTriggeredAt}` : ' · 未触发过'}
                    </div>
                  </div>
                  <button onClick={() => openEdit(r)} className="shrink-0 text-slate-400 hover:text-brand-600" title="编辑规则"><Pencil size={14} /></button>
                  <button onClick={() => remove(r)} className="shrink-0 text-slate-300 hover:text-red-500" title="删除规则"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* 新建 / 编辑规则弹层 */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={closeModal}>
          <div className="w-[520px] max-w-[94vw] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-pop" style={{ maxHeight: '88vh' }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div className="text-base font-bold text-slate-900">{editing ? '编辑自动化规则' : '新建自动化规则'}</div>
              <button onClick={closeModal} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={16} /></button>
            </div>
            <div className="space-y-3.5">
              <Field label="规则名称" required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：大额支出提醒" /></Field>
              <Field label="条件表达式" hint="命中对象时按其字段值求值，留空表示不限制；支持 > >= < <= == = 包含 不包含，如：健康度 < 60">
                <Input value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })} placeholder="如：健康度 < 60" />
              </Field>
              <Field label="触发方式">
                <div className="flex gap-2">
                  {([['object_change', '对象任何变化'], ['threshold', '数值阈值']] as const).map(([v, label]) => (
                    <button key={v} onClick={() => setForm({ ...form, kind: v })}
                      className={cn('flex-1 rounded-lg border px-3 py-2 text-[13px] font-medium', form.kind === v ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-500')}>
                      {label}
                    </button>
                  ))}
                </div>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="监听对象类型" required>
                  <Select className="w-full" value={form.typeId} onChange={(e) => setForm({ ...form, typeId: e.target.value, field: '', doAction: '' })}>
                    <option value="">选择…</option>
                    {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </Select>
                </Field>
                {form.kind === 'threshold' && selType && (
                  <Field label="字段" required>
                    <Select className="w-full" value={form.field} onChange={(e) => setForm({ ...form, field: e.target.value })}>
                      <option value="">选择数值字段…</option>
                      {selType.properties.filter((p) => p.type === 'number').map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
                    </Select>
                  </Field>
                )}
              </div>
              {form.kind === 'threshold' && (
                <div className="grid grid-cols-[100px_1fr] gap-3">
                  <Field label="比较">
                    <Select className="w-full" value={form.op} onChange={(e) => setForm({ ...form, op: e.target.value })}>
                      {['>', '>=', '<', '<=', '='].map((o) => <option key={o} value={o}>{o}</option>)}
                    </Select>
                  </Field>
                  <Field label="阈值" required><Input type="number" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder="如 500" /></Field>
                </div>
              )}
              <Field label="执行动作（可多选）">
                <div className="space-y-2">
                  <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-[13px]">
                    <input type="checkbox" checked={form.doNotify} onChange={(e) => setForm({ ...form, doNotify: e.target.checked })} />
                    <Bell size={13} className="text-brand-500" /> 发通知（进入通知中心）
                  </label>
                  <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-[13px]">
                    <input type="checkbox" checked={!!form.doAction} onChange={(e) => setForm({ ...form, doAction: e.target.checked ? '占位' : '' })} />
                    <Zap size={13} className="text-amber-500" />
                    <Select className="flex-1" value={form.doAction === '占位' ? '' : form.doAction} onChange={(e) => setForm({ ...form, doAction: e.target.value })} disabled={!form.doAction}>
                      <option value="">选择动作…</option>
                      {actions.filter((a) => !a.needsApproval).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </Select>
                  </div>
                  <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-[13px]">
                    <input type="checkbox" checked={form.doHold} onChange={(e) => setForm({ ...form, doHold: e.target.checked })} />
                    <Clock3 size={13} className="text-violet-500" /> 需审批的动作转暂存审批（人工确认后执行）
                  </label>
                </div>
              </Field>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Btn onClick={closeModal}>取消</Btn>
              <Btn variant="primary" disabled={busy} onClick={submit}>{busy ? '保存中…' : editing ? '保存修改' : '创建并启用'}</Btn>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}
