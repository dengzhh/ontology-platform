import { useState } from 'react'
import { Bot, Plus, Trash2, X, Loader2, Send, Save, Pencil, ShieldAlert, EyeOff, RefreshCw, Wrench, Sparkles } from 'lucide-react'
import PageShell from '@/components/ui/PageShell'
import Btn from '@/components/ui/Btn'
import { Badge } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import { Input, Field, Select } from '@/components/ui/Form'
import { Avatar } from '@/components/ui/Misc'
import { useUI } from '@/store/ui'
import { api } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'

interface Guardrail { maskSensitive: boolean; requireApprovalForActions: boolean }
interface AgentRow {
  id: string
  name: string
  desc: string
  tools: string[]
  systemPrompt: string
  guardrail: Guardrail
  model: string
  messageCount: number
  createdAt: string
}
interface AgentsResp { space: { name: string }; agents: AgentRow[] }
interface ChatMsg { role: 'user' | 'assistant'; content: string; createdAt?: string }

const AVAILABLE_TOOLS = [
  { key: 'query_objects', label: '查询对象' },
  { key: 'execute_action', label: '执行动作' },
  { key: 'search_knowledge', label: '检索知识库' },
  { key: 'ontology_overview', label: '本体概览' },
  { key: 'list_users', label: '用户管理' },
  { key: 'send_notification', label: '发送通知' },
]

/** Agent Studio（P6 真实）：Agent CRUD + 工具/护栏配置 + LLM 对话测试 */
export default function AgentStudio() {
  const { currentUser } = useUI()
  const canEdit = currentUser?.role.id === 'admin' || currentUser?.role.id === 'data-eng'
  const q = useApi<AgentsResp>('/aip/agents')
  const agents = q.data?.agents ?? []

  const [toast, setToast] = useState('')
  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2800) }
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const sel = agents.find((a) => a.id === selectedId) ?? agents[0]

  /* 编辑表单 */
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ name: '', desc: '', systemPrompt: '', model: '', tools: [] as string[], maskSensitive: true, requireApproval: true })
  const [busy, setBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)

  /* 对话测试 */
  const [chatOpen, setChatOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [chatBusy, setChatBusy] = useState(false)

  function startEdit(a: AgentRow | null) {
    if (a) {
      setForm({ name: a.name, desc: a.desc, systemPrompt: a.systemPrompt, model: a.model, tools: [...a.tools], maskSensitive: a.guardrail.maskSensitive, requireApproval: a.guardrail.requireApprovalForActions })
      setSelectedId(a.id)
    } else {
      setForm({ name: '', desc: '', systemPrompt: '', model: '', tools: ['query_objects', 'search_knowledge'], maskSensitive: true, requireApproval: true })
      setSelectedId(null)
    }
    setEditing(true)
  }

  async function save() {
    if (!form.name.trim()) return notify('请填写 Agent 名称')
    setBusy(true)
    try {
      const body = {
        id: selectedId ?? undefined,
        name: form.name,
        desc: form.desc,
        systemPrompt: form.systemPrompt,
        model: form.model,
        tools: form.tools,
        guardrail: { maskSensitive: form.maskSensitive, requireApprovalForActions: form.requireApproval } as Guardrail,
      }
      const res = await api<{ id: string }>('/aip/agents', { method: 'POST', body })
      notify(selectedId ? 'Agent 已更新' : 'Agent 已创建')
      setEditing(false)
      setSelectedId(res.id)
      q.reload()
    } catch (e) { notify(e instanceof Error ? e.message : '保存失败') }
    finally { setBusy(false) }
  }

  async function remove() {
    if (!sel) return
    try {
      await api(`/aip/agents/${sel.id}`, { method: 'DELETE' })
      notify('Agent 已删除')
      setConfirmDel(false)
      setSelectedId(null)
      q.reload()
    } catch (e) { notify(e instanceof Error ? e.message : '删除失败') }
  }

  async function openChat() {
    if (!sel) return
    setChatOpen(true)
    try {
      const r = await api<{ messages: ChatMsg[] }>(`/aip/agents/${sel.id}/messages`)
      setMessages(r.messages)
    } catch { setMessages([]) }
  }

  async function sendMsg() {
    if (!input.trim() || !sel || chatBusy) return
    const msg = input.trim()
    setInput('')
    setMessages((m) => [...m, { role: 'user', content: msg }])
    setChatBusy(true)
    try {
      const r = await api<{ reply: string; toolCalls?: { name: string; result: string }[] }>(`/aip/agents/${sel.id}/chat`, { method: 'POST', body: { message: msg } })
      const toolLine = r.toolCalls?.length
        ? '\n\n—— 工具执行 ——\n' + r.toolCalls.map((t) => `· ${t.name}: ${t.result}`).join('\n')
        : ''
      setMessages((m) => [...m, { role: 'assistant', content: r.reply + toolLine }])
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: `出错了：${e instanceof Error ? e.message : '请求失败'}` }])
    } finally { setChatBusy(false) }
  }

  return (
    <PageShell
      icon={Bot}
      title="Agent Studio"
      subtitle="构建可调用工具与知识的智能体 —— 配置、测试、持久化"
      benchmark="智能体构建"
      features={[
        'Agent 管理：创建/编辑/删除，配置持久化到数据库',
        '工具配置：勾选 Agent 可用的工具（查询/执行/检索等）',
        '护栏设置：敏感数据脱敏开关、动作执行需人工确认开关',
        '对话测试：直接与 Agent 对话（真实 LLM），历史消息持久化',
        '空间隔离：Agent 归属当前本体空间',
      ]}
      actions={
        <>
          {sel && <Btn size="sm" onClick={openChat}><Send size={13} /> 测试对话</Btn>}
          {canEdit && <Btn size="sm" variant="primary" onClick={() => startEdit(null)}><Plus size={14} /> 新建 Agent</Btn>}
        </>
      }
    >
      {toast && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">{toast}</div>}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        {/* Agent 列表 */}
        <div className="space-y-2">
          {q.loading && <Card className="flex items-center justify-center py-10"><Loader2 size={15} className="animate-spin text-slate-400" /></Card>}
          {agents.length === 0 && !q.loading && (
            <Card className="py-10 text-center text-sm text-slate-400">
              暂无 Agent，点击右上「新建 Agent」创建第一个
            </Card>
          )}
          {agents.map((a) => (
            <button
              key={a.id}
              onClick={() => { setSelectedId(a.id); setEditing(false); setChatOpen(false) }}
              className={cn('w-full rounded-xl border p-3.5 text-left transition-colors', sel?.id === a.id ? 'border-brand-300 bg-brand-50/50' : 'border-slate-200 hover:border-brand-200')}
            >
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-500 text-white"><Bot size={16} /></div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-bold text-slate-800">{a.name}</div>
                  <div className="truncate text-[11px] text-slate-400">{a.tools.length} 个工具 · {a.messageCount} 条对话</div>
                </div>
              </div>
              {a.desc && <div className="mt-1.5 line-clamp-1 text-xs text-slate-500">{a.desc}</div>}
              <div className="mt-1.5 flex flex-wrap gap-1">
                {a.tools.slice(0, 3).map((t) => <Badge key={t} color="blue">{AVAILABLE_TOOLS.find((x) => x.key === t)?.label ?? t}</Badge>)}
                {a.tools.length > 3 && <Badge color="slate">+{a.tools.length - 3}</Badge>}
                {a.guardrail.maskSensitive && <Badge color="violet">脱敏</Badge>}
              </div>
            </button>
          ))}
        </div>

        {/* 详情/编辑 */}
        <div className="min-w-0">
          {sel && !editing ? (
            <Card>
              <CardHeader
                title={<span className="flex items-center gap-2"><Avatar name={sel.name} />{sel.name}</span>}
                desc={sel.desc || '暂无描述'}
                actions={
                  canEdit && (
                    <div className="flex gap-2">
                      <Btn size="sm" onClick={() => startEdit(sel)}><Pencil size={12} /> 编辑</Btn>
                      {confirmDel ? (
                        <>
                          <Btn size="sm" variant="danger" onClick={remove}>确认删除</Btn>
                          <Btn size="sm" variant="ghost" onClick={() => setConfirmDel(false)}>取消</Btn>
                        </>
                      ) : (
                        <Btn size="sm" variant="ghost" onClick={() => setConfirmDel(true)}><Trash2 size={12} /></Btn>
                      )}
                    </div>
                  )
                }
              />

              {/* 工具 */}
              <div className="mb-3">
                <div className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-slate-700"><Wrench size={13} className="text-brand-500" /> 可用工具</div>
                <div className="flex flex-wrap gap-1.5">
                  {sel.tools.length === 0 && <span className="text-xs text-slate-400">未配置（Agent 无法操作数据）</span>}
                  {sel.tools.map((t) => (
                    <span key={t} className="inline-flex items-center gap-1 rounded-lg border border-brand-200 bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700">
                      <Wrench size={10} /> {AVAILABLE_TOOLS.find((x) => x.key === t)?.label ?? t}
                    </span>
                  ))}
                </div>
              </div>

              {/* 护栏 */}
              <div className="mb-3">
                <div className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-slate-700"><ShieldAlert size={13} className="text-amber-500" /> 护栏</div>
                <div className="flex gap-2">
                  <Badge color={sel.guardrail.maskSensitive ? 'green' : 'red'} dot>{sel.guardrail.maskSensitive ? '敏感数据脱敏' : '脱敏已关闭'}</Badge>
                  <Badge color={sel.guardrail.requireApprovalForActions ? 'green' : 'red'} dot>{sel.guardrail.requireApprovalForActions ? '动作需人工确认' : '动作自动执行'}</Badge>
                </div>
              </div>

              {/* 系统提示词 */}
              {sel.systemPrompt && (
                <div className="mb-3">
                  <div className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-slate-700"><Sparkles size={13} className="text-violet-500" /> 系统提示词</div>
                  <pre className="whitespace-pre-wrap rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs leading-5 text-slate-600">{sel.systemPrompt}</pre>
                </div>
              )}

              <div className="border-t border-slate-50 pt-2 text-[11px] text-slate-400">创建于 {sel.createdAt} · 空间：{q.data?.space.name}</div>
            </Card>
          ) : editing ? (
            <Card>
              <CardHeader title={selectedId ? '编辑 Agent' : '新建 Agent'} desc="配置 Agent 的工具、护栏与提示词" />
              <div className="space-y-3.5">
                <Field label="Agent 名称" required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：设备故障诊断专家" /></Field>
                <Field label="描述"><Input value={form.desc} onChange={(e) => setForm({ ...form, desc: e.target.value })} placeholder="一句话说明 Agent 用途" /></Field>
                <Field label="系统提示词" hint="定义 Agent 的角色、能力边界与回答风格">
                  <textarea value={form.systemPrompt} onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })} placeholder="你是设备故障诊断专家，基于本体中的设备、工单和知识库回答问题…" className="h-28 w-full resize-none rounded-lg border border-slate-200 p-3 text-[13px] focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100" />
                </Field>
                <Field label="可用工具">
                  <div className="grid grid-cols-2 gap-2">
                    {AVAILABLE_TOOLS.map((t) => (
                      <label key={t.key} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-[13px] hover:border-brand-200">
                        <input
                          type="checkbox"
                          checked={form.tools.includes(t.key)}
                          onChange={(e) => setForm({ ...form, tools: e.target.checked ? [...form.tools, t.key] : form.tools.filter((x) => x !== t.key) })}
                        />
                        {t.label}
                      </label>
                    ))}
                  </div>
                </Field>
                <Field label="护栏设置">
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-[13px]">
                      <input type="checkbox" checked={form.maskSensitive} onChange={(e) => setForm({ ...form, maskSensitive: e.target.checked })} />
                      <EyeOff size={13} className="text-violet-500" /> 敏感数据脱敏（手机号/身份证自动掩码）
                    </label>
                    <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-[13px]">
                      <input type="checkbox" checked={form.requireApproval} onChange={(e) => setForm({ ...form, requireApproval: e.target.checked })} />
                      <ShieldAlert size={13} className="text-amber-500" /> 动作执行需人工确认
                    </label>
                  </div>
                </Field>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <Btn onClick={() => setEditing(false)}>取消</Btn>
                <Btn variant="primary" disabled={busy} onClick={save}>{busy ? '保存中…' : '保存 Agent'}</Btn>
              </div>
            </Card>
          ) : (
            <Card className="flex h-full min-h-[300px] flex-col items-center justify-center gap-2 text-center">
              <Bot size={28} className="text-slate-200" />
              <div className="text-sm text-slate-400">选择或创建一个 Agent</div>
            </Card>
          )}
        </div>
      </div>

      {/* 对话测试弹层 */}
      {chatOpen && sel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={() => setChatOpen(false)}>
          <div className="flex h-[80vh] w-[560px] max-w-[94vw] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-pop" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-500 text-white"><Bot size={16} /></div>
                <div>
                  <div className="text-sm font-bold text-slate-900">{sel.name}</div>
                  <div className="text-[10px] text-slate-400">对话测试 · 真实 LLM</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => openChat()} className="text-slate-400 hover:text-brand-600"><RefreshCw size={14} /></button>
                <button onClick={() => setChatOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={16} /></button>
              </div>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {messages.length === 0 && <div className="py-8 text-center text-xs text-slate-400">发送消息测试 Agent（使用其配置的提示词与工具）</div>}
              {messages.map((m, i) => (
                <div key={i} className={cn('flex gap-2.5', m.role === 'user' && 'flex-row-reverse')}>
                  <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', m.role === 'assistant' ? 'bg-gradient-to-br from-brand-500 to-violet-500 text-white' : 'bg-slate-200 text-slate-600')}>
                    {m.role === 'assistant' ? <Bot size={16} /> : <Avatar name={currentUser?.name ?? '我'} className="h-8 w-8" />}
                  </div>
                  <div className="max-w-[80%] whitespace-pre-wrap rounded-xl px-3.5 py-2.5 text-[13px] leading-6 text-slate-700 bg-slate-50">
                    {m.content}
                  </div>
                </div>
              ))}
              {chatBusy && <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 size={13} className="animate-spin" /> 思考中…</div>}
            </div>
            <div className="border-t border-slate-100 p-3">
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) sendMsg() }}
                  placeholder="输入消息测试…"
                  className="flex-1 bg-transparent text-[13px] text-slate-800 placeholder:text-slate-400 focus:outline-none"
                />
                <button onClick={sendMsg} disabled={chatBusy || !input.trim()} className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-white disabled:opacity-40"><Send size={13} /></button>
              </div>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}
