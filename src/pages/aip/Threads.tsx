import { useEffect, useRef, useState } from 'react'
import { MessagesSquare, Plus, Trash2, X, Loader2, Send, Play, FileText, Clock3, BookOpen } from 'lucide-react'
import PageShell from '@/components/ui/PageShell'
import Btn from '@/components/ui/Btn'
import { Badge } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import { Input, Field } from '@/components/ui/Form'
import { api } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'

interface ThreadRow { id: string; title: string; messageCount: number; createdAt: string }
interface ThreadsResp { threads: ThreadRow[] }
interface ThreadDetail {
  thread: { id: string; title: string; createdAt: string }
  documentTitles?: string[]
  pendingRetry?: boolean
  messages: { role: string; content: string }[]
}

/** 文档分析（P6 真实）：选文档→AI 分析→带上下文多轮追问，结果持久化 */
export default function Threads() {
  const q = useApi<ThreadsResp>('/aip/threads')
  const threads = q.data?.threads ?? []
  const [toast, setToast] = useState('')
  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3000) }

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ title: '', taskPrompt: '' })
  const [docIds, setDocIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<ThreadDetail | null>(null)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [followup, setFollowup] = useState('')
  const [asking, setAsking] = useState(false)
  const [askError, setAskError] = useState('')
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const docsQ = useApi<{ docs: { id: string; title: string; category: string }[] }>('/knowledge/docs')

  // 新消息到达时滚到对话底部
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [detail?.messages.length, asking])

  async function run() {
    if (!form.title.trim() || !form.taskPrompt.trim()) return notify('请填写分析标题与任务描述')
    setBusy(true)
    const title = form.title, taskPrompt = form.taskPrompt, titles = docIds.length
      ? (docsQ.data?.docs ?? []).filter((d) => docIds.includes(d.id)).map((d) => d.title) : []
    try {
      const res = await api<{ id: string; result: string; documentTitles?: string[] }>('/aip/threads', { method: 'POST', body: { title, taskPrompt, documentIds: docIds } })
      notify(`分析「${title}」已完成，可继续追问`)
      setOpen(false)
      setForm({ title: '', taskPrompt: '' })
      setDocIds([])
      q.reload()
      setSelected(res.id)
      setDetail({
        thread: { id: res.id, title, createdAt: new Date().toLocaleString('zh-CN', { hour12: false }) },
        documentTitles: res.documentTitles ?? titles,
        messages: [{ role: 'user', content: taskPrompt }, { role: 'assistant', content: res.result }],
      })
      setFollowup(''); setAskError('')
    } catch (e) {
      // 网关失败时后端保留草稿会话；前端引导重试，不丢用户输入
      const msg = e instanceof Error ? e.message : '运行失败'
      setOpen(false); q.reload()
      notify(`${msg}（可稍后点「重试分析」）`)
    } finally { setBusy(false) }
  }

  async function retry() {
    if (!selected || busy) return
    setBusy(true); setAskError('')
    try {
      const r = await api<{ result: string }>(`/aip/threads/${selected}/retry`, { method: 'POST', body: {} })
      setDetail((d) => d ? { ...d, pendingRetry: false, messages: [...d.messages, { role: 'assistant', content: r.result }] } : d)
      notify('重试成功，分析已完成')
    } catch (e) { setAskError(e instanceof Error ? e.message : '重试失败，草稿继续保留') }
    finally { setBusy(false) }
  }

  async function view(id: string) {
    setSelected(id); setAskError(''); setFollowup('')
    try {
      const r = await api<ThreadDetail>(`/aip/threads/${id}`)
      setDetail(r)
    } catch { setDetail(null) }
  }

  async function ask() {
    const question = followup.trim()
    if (!question || !selected || asking) return
    setAsking(true); setAskError('')
    // 乐观追加用户消息，失败时回滚并给出明确反馈
    const snapshot = detail
    setDetail((d) => d ? { ...d, messages: [...d.messages, { role: 'user', content: question }] } : d)
    setFollowup('')
    try {
      const r = await api<{ result: string }>(`/aip/threads/${selected}/followup`, { method: 'POST', body: { question } })
      setDetail((d) => d ? { ...d, messages: [...d.messages, { role: 'assistant', content: r.result }] } : d)
    } catch (e) {
      setDetail(snapshot)
      setAskError(e instanceof Error ? e.message : '追问失败，请重试')
      setFollowup(question)
    } finally { setAsking(false) }
  }

  async function remove(id: string) {
    try {
      await api(`/aip/threads/${id}`, { method: 'DELETE' })
      notify('分析已删除')
      setConfirmDel(null)
      if (selected === id) { setSelected(null); setDetail(null) }
      q.reload()
    } catch (e) { notify(e instanceof Error ? e.message : '删除失败') }
  }

  const visibleMsgs = (detail?.messages ?? []).filter((m) => m.role !== 'system')

  return (
    <PageShell
      icon={MessagesSquare}
      title="文档分析"
      subtitle="带着知识库文档与 AI 对话：选文档→发起分析→持续追问→结果留痕"
      benchmark="文档分析"
      features={[
        '文档分析：选择知识库文档 + 描述任务 → 调用真实 AI 生成结构化结果',
        '多轮追问：带着文档上下文与历史问答继续对话，引用出处可溯源',
        '结果持久化：每次分析与追问都存库，随时回看完整对话',
        '分工明确：一次性/可复用的多步处理请到「工作流编排」用预设模板',
      ]}
      actions={<><a href="/aip/logic" className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] text-slate-600 hover:bg-slate-50">工作流预设 →</a><Btn size="sm" variant="primary" onClick={() => setOpen(true)}><Plus size={14} /> 新建分析</Btn></>}
    >
      {toast && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">{toast}</div>}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        {/* 分析列表 */}
        <div className="space-y-2">
          {q.loading && <Card className="flex items-center justify-center py-10"><Loader2 size={15} className="animate-spin text-slate-400" /></Card>}
          {threads.length === 0 && !q.loading && (
            <Card className="py-10 text-center text-sm text-slate-400">暂无分析，点击「新建分析」开始</Card>
          )}
          {threads.map((t) => (
            <div
              key={t.id}
              onClick={() => view(t.id)}
              className={cn('group cursor-pointer rounded-xl border p-3.5 transition-colors', selected === t.id ? 'border-brand-300 bg-brand-50/40' : 'border-slate-200 hover:border-brand-200')}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-500"><MessagesSquare size={15} /></div>
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-bold text-slate-800">{t.title}</div>
                    <div className="flex items-center gap-1 text-[11px] text-slate-400"><Clock3 size={10} /> {t.createdAt} · {t.messageCount} 条消息</div>
                  </div>
                </div>
                <button onClick={(e) => { e.stopPropagation(); setConfirmDel(confirmDel === t.id ? null : t.id) }} className="shrink-0 text-slate-200 opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-500">
                  <Trash2 size={13} />
                </button>
              </div>
              {confirmDel === t.id && (
                <div className="mt-2 flex gap-2">
                  <button onClick={(e) => { e.stopPropagation(); remove(t.id) }} className="rounded bg-red-500 px-2 py-1 text-[10px] text-white">确认删除</button>
                  <button onClick={(e) => { e.stopPropagation(); setConfirmDel(null) }} className="text-[10px] text-slate-400">取消</button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* 对话区 */}
        <div className="min-w-0">
          {detail ? (
            <Card className="flex h-[620px] flex-col p-0">
              <div className="border-b border-slate-100 px-4 py-3">
                <CardHeader title={detail.thread.title} desc={`创建于 ${detail.thread.createdAt}`} />
                {detail.documentTitles && detail.documentTitles.length > 0 && (
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <BookOpen size={12} className="text-slate-400" />
                    <span className="text-[11px] text-slate-400">引用文档：</span>
                    {detail.documentTitles.map((t) => <Badge key={t} color="violet">{t}</Badge>)}
                  </div>
                )}
              </div>
              <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
                {visibleMsgs.map((m, i) => (
                  <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                    <div className={cn(
                      'max-w-[85%] whitespace-pre-wrap rounded-xl px-3.5 py-2.5 text-[13px] leading-6',
                      m.role === 'user' ? 'bg-brand-600 text-white' : 'border border-slate-100 bg-slate-50 font-sans text-slate-700',
                    )}>
                      {m.content}
                    </div>
                  </div>
                ))}
                {asking && (
                  <div className="flex justify-start">
                    <div className="flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3.5 py-2.5 text-[12px] text-slate-400">
                      <Loader2 size={13} className="animate-spin" /> 正在结合文档与历史回答…
                    </div>
                  </div>
                )}
                {detail.pendingRetry && !asking && (
                  <div className="flex flex-col items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-[12px] text-amber-700">
                    <div>AI 服务暂不可用，任务已保留为草稿。恢复后可一键重试，无需重新填写。</div>
                    <button onClick={retry} disabled={busy} className="flex items-center gap-1 rounded-lg bg-amber-500 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-amber-600 disabled:opacity-50">
                      {busy ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} 重试分析
                    </button>
                  </div>
                )}
              </div>
              {askError && <div className="mx-4 mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600">{askError}</div>}
              <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-3">
                <input
                  value={followup}
                  onChange={(e) => setFollowup(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask() } }}
                  placeholder="继续追问，例如：把建议按优先级排成表格…"
                  className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-[13px] focus:border-brand-400 focus:outline-none"
                  disabled={asking || !!detail.pendingRetry}
                />
                <Btn size="sm" variant="primary" onClick={ask} disabled={asking || !!detail.pendingRetry || !followup.trim()}>
                  {asking ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} 发送追问
                </Btn>
              </div>
            </Card>
          ) : (
            <Card className="flex h-full min-h-[300px] flex-col items-center justify-center gap-2 text-center">
              <FileText size={28} className="text-slate-200" />
              <div className="text-sm text-slate-400">选择左侧分析查看对话</div>
              <div className="text-[11px] text-slate-400">或新建分析：选文档、写任务、持续追问</div>
            </Card>
          )}
        </div>
      </div>

      {/* 新建分析弹层 */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div className="w-[560px] max-w-[94vw] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-pop" style={{ maxHeight: '88vh' }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div className="text-base font-bold text-slate-900">新建文档分析</div>
              <button onClick={() => setOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={16} /></button>
            </div>
            <div className="space-y-3.5">
              <Field label="分析标题" required><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="如：维修手册备件需求分析" /></Field>
              <Field label="分析任务" required hint="告诉 AI 要做什么分析">
                <textarea
                  value={form.taskPrompt}
                  onChange={(e) => setForm({ ...form, taskPrompt: e.target.value })}
                  placeholder="如：提取文档中提到的所有备件件号，列出建议库存数量与存放地点，并按重要性排序"
                  className="h-28 w-full resize-none rounded-lg border border-slate-200 p-3 text-[13px] focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                />
              </Field>
              <Field label="引用文档（可选）" hint="作为分析上下文，后续所有追问都会带着这些文档">
                <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-lg border border-slate-100 p-2">
                  {(docsQ.data?.docs ?? []).map((d) => (
                    <label key={d.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={docIds.includes(d.id)}
                        onChange={(e) => setDocIds(e.target.checked ? [...docIds, d.id] : docIds.filter((x) => x !== d.id))}
                      />
                      <FileText size={12} className="text-slate-400" />
                      {d.title}
                      <Badge color="violet" className="ml-auto">{d.category}</Badge>
                    </label>
                  ))}
                  {(docsQ.data?.docs ?? []).length === 0 && <div className="py-3 text-center text-xs text-slate-400">暂无已入库文档</div>}
                </div>
              </Field>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Btn onClick={() => setOpen(false)}>取消</Btn>
              <Btn variant="primary" disabled={busy} onClick={run}>
                {busy ? <><Loader2 size={14} className="animate-spin" /> AI 分析中…</> : <><Play size={14} /> 开始分析</>}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}
