import { useState } from 'react'
import { MessagesSquare, Plus, Trash2, X, Loader2, Send, Play, FileText, Clock3 } from 'lucide-react'
import PageShell from '@/components/ui/PageShell'
import Btn from '@/components/ui/Btn'
import { Badge } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import { Input, Field, Select } from '@/components/ui/Form'
import { api } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'

interface ThreadRow { id: string; title: string; messageCount: number; createdAt: string }
interface ThreadsResp { threads: ThreadRow[] }
interface ThreadDetail {
  thread: { id: string; title: string; createdAt: string }
  messages: { role: string; content: string }[]
}

/** AIP Threads（P6 真实）：文档任务流 —— 选文档→写任务→LLM 运行→查看结果 */
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

  const docsQ = useApi<{ docs: { id: string; title: string; category: string }[] }>('/knowledge/docs')

  async function run() {
    if (!form.title.trim() || !form.taskPrompt.trim()) return notify('请填写任务标题与描述')
    setBusy(true)
    try {
      const res = await api<{ id: string; result: string }>('/aip/threads', { method: 'POST', body: { title: form.title, taskPrompt: form.taskPrompt, documentIds: docIds } })
      notify(`任务「${form.title}」已完成`)
      setOpen(false)
      setForm({ title: '', taskPrompt: '' })
      setDocIds([])
      q.reload()
      setSelected(res.id)
      setDetail({ thread: { id: res.id, title: form.title, createdAt: new Date().toLocaleString('zh-CN', { hour12: false }) }, messages: [{ role: 'assistant', content: res.result }] })
    } catch (e) { notify(e instanceof Error ? e.message : '运行失败') }
    finally { setBusy(false) }
  }

  async function view(id: string) {
    setSelected(id)
    try {
      const r = await api<ThreadDetail>(`/aip/threads/${id}`)
      setDetail(r)
    } catch { setDetail(null) }
  }

  async function remove(id: string) {
    try {
      await api(`/aip/threads/${id}`, { method: 'DELETE' })
      notify('任务已删除')
      setConfirmDel(null)
      if (selected === id) { setSelected(null); setDetail(null) }
      q.reload()
    } catch (e) { notify(e instanceof Error ? e.message : '删除失败') }
  }

  return (
    <PageShell
      icon={MessagesSquare}
      title="AIP Threads"
      subtitle="面向文档的 AI 任务流：选文档→写任务→LLM 分析→查看结果"
      benchmark="AI 任务流"
      features={[
        '文档任务：选择知识库文档 + 编写任务描述 → 调用真实 LLM 分析',
        '结果持久化：任务与结果存储在数据库，可随时回看',
        '多文档引用：可同时选择多篇文档作为分析上下文',
        '任务管理：查看历史任务、删除不需要的记录',
      ]}
      actions={<Btn size="sm" variant="primary" onClick={() => setOpen(true)}><Plus size={14} /> 新建任务</Btn>}
    >
      {toast && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">{toast}</div>}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        {/* 任务列表 */}
        <div className="space-y-2">
          {q.loading && <Card className="flex items-center justify-center py-10"><Loader2 size={15} className="animate-spin text-slate-400" /></Card>}
          {threads.length === 0 && !q.loading && (
            <Card className="py-10 text-center text-sm text-slate-400">
              暂无任务，点击「新建任务」运行第一个文档分析
            </Card>
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
                    <div className="flex items-center gap-1 text-[11px] text-slate-400"><Clock3 size={10} /> {t.createdAt}</div>
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

        {/* 结果查看 */}
        <div className="min-w-0">
          {detail ? (
            <Card>
              <CardHeader
                title={detail.thread.title}
                desc={`运行于 ${detail.thread.createdAt}`}
              />
              <div className="space-y-3">
                {detail.messages.filter((m) => m.role === 'assistant').map((m, i) => (
                  <div key={i} className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
                    <pre className="whitespace-pre-wrap font-sans text-[13px] leading-7 text-slate-700">{m.content}</pre>
                  </div>
                ))}
              </div>
            </Card>
          ) : (
            <Card className="flex h-full min-h-[300px] flex-col items-center justify-center gap-2 text-center">
              <FileText size={28} className="text-slate-200" />
              <div className="text-sm text-slate-400">选择左侧任务查看结果</div>
              <div className="text-[11px] text-slate-400">或创建新任务分析文档</div>
            </Card>
          )}
        </div>
      </div>

      {/* 新建任务弹层 */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div className="w-[560px] max-w-[94vw] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-pop" style={{ maxHeight: '88vh' }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div className="text-base font-bold text-slate-900">新建文档任务</div>
              <button onClick={() => setOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={16} /></button>
            </div>
            <div className="space-y-3.5">
              <Field label="任务标题" required><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="如：分析维修手册中的备件需求" /></Field>
              <Field label="任务描述" required hint="告诉 LLM 要做什么分析">
                <textarea
                  value={form.taskPrompt}
                  onChange={(e) => setForm({ ...form, taskPrompt: e.target.value })}
                  placeholder="如：提取文档中提到的所有备件件号，列出建议库存数量与存放地点，并按重要性排序"
                  className="h-28 w-full resize-none rounded-lg border border-slate-200 p-3 text-[13px] focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                />
              </Field>
              <Field label="引用文档（可选）" hint="选择作为分析上下文的知识库文档">
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
                {busy ? <><Loader2 size={14} className="animate-spin" /> LLM 分析中…</> : <><Play size={14} /> 运行任务</>}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}
