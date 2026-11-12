import { useRef, useState } from 'react'
import { BookOpen, FileUp, FileText, Link2, Loader2, RefreshCw, Trash2, X, CircleCheck } from 'lucide-react'
import PageShell from '@/components/ui/PageShell'
import StatCard from '@/components/ui/StatCard'
import DataTable from '@/components/ui/DataTable'
import Tabs from '@/components/ui/Tabs'
import Btn from '@/components/ui/Btn'
import { Badge, type BadgeColor } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import { Input, Select, Field } from '@/components/ui/Form'
import { api } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'

interface LinkedObj { objectId: string; typeName: string; label: string }
interface DocRow {
  id: string
  title: string
  category: string
  format: string
  size: string
  status: string
  owner: string
  chunkCount: number
  updatedAt: string
  linked: LinkedObj[]
}
interface DocsResp {
  space: { name: string }
  stats: { total: number; indexed: number; chunks: number; categories: number }
  docs: DocRow[]
}

const STATUS_COLOR: Record<string, BadgeColor> = { 已索引: 'green', 解析中: 'blue', 待审核: 'amber', 已过期: 'red' }
const CATEGORIES = ['SOP', '设备手册', '合同', '维修案例', '培训材料', '会议纪要', '制度', '其他']

/** 知识库（P5 真实）：文档入库 → 分块 → 向量化(远程/本地降级) → 索引 */
export default function Library() {
  const q = useApi<DocsResp>('/knowledge/docs')
  const [cat, setCat] = useState('all')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  const [form, setForm] = useState({ title: '', category: 'SOP', content: '', objectIds: [] as string[] })
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [linkFor, setLinkFor] = useState<string | null>(null)
  const [linkObjId, setLinkObjId] = useState('')
  const objsQ = useApi<{ groups: { type: { name: string }; objects: { id: string; values: Record<string, unknown> }[] }[] }>(linkFor ? '/objects/search?q=' : null)

  const docs = q.data?.docs ?? []
  const rows = cat === 'all' ? docs : docs.filter((d) => d.category === cat)
  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3000) }

  async function submit() {
    if (!form.title.trim()) return notify('请填写文档标题')
    if (form.content.trim().length < 10) return notify('请粘贴至少 10 字的文档内容')
    setBusy(true)
    try {
      const res = await api<{ chunks: number; mode: string }>('/knowledge/docs', { method: 'POST', body: form })
      notify(`「${form.title}」已入库：${res.chunks} 个分块（${res.mode === 'remote' ? '远程向量' : '本地向量'}）`)
      setOpen(false)
      setForm({ title: '', category: 'SOP', content: '', objectIds: [] })
      q.reload()
    } catch (e) {
      notify(e instanceof Error ? e.message : '入库失败')
    } finally { setBusy(false) }
  }

  async function reindex(d: DocRow) {
    try {
      const res = await api<{ chunks: number; mode: string }>(`/knowledge/docs/${d.id}/reindex`, { method: 'POST' })
      notify(`「${d.title}」重建索引：${res.chunks} 块（${res.mode}）`)
      q.reload()
    } catch (e) { notify(e instanceof Error ? e.message : '重建失败') }
  }

  async function remove(d: DocRow) {
    try {
      await api(`/knowledge/docs/${d.id}`, { method: 'DELETE' })
      notify(`已删除「${d.title}」`)
      setConfirmDel(null)
      q.reload()
    } catch (e) { notify(e instanceof Error ? e.message : '删除失败') }
  }

  async function linkDoc() {
    if (!linkFor || !linkObjId) return
    try {
      await api(`/knowledge/docs/${linkFor}/links`, { method: 'POST', body: { objectId: linkObjId } })
      notify('已挂接业务对象')
      setLinkFor(null)
      setLinkObjId('')
      q.reload()
    } catch (e) { notify(e instanceof Error ? e.message : '挂接失败') }
  }

  function readFile(f: File) {
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      setForm((v) => ({ ...v, title: v.title || f.name.replace(/\.[^.]+$/, ''), content: text }))
    }
    reader.readAsText(f, 'utf-8')
  }

  return (
    <PageShell
      icon={BookOpen}
      title="知识库"
      subtitle="文档入库 → 语义分块 → 向量化 → 索引，供 AI 检索并带引用回答"
      benchmark="知识工程"
      features={[
        '文档入库：粘贴文本或读取 .txt/.md，按段落与句子边界语义分块（带重叠）',
        '向量化：优先调用已配置的 embedding 接口（OpenAI 兼容），未配置自动降级本地哈希向量',
        '对象挂接：文档可挂接到任意业务对象，形成「知识与业务」的连接',
        '重建索引：更换 embedding 模型或修改内容后可一键重算',
      ]}
      actions={
        <>
          <Btn size="sm" onClick={() => q.reload()}><RefreshCw size={13} /> 刷新</Btn>
          <Btn size="sm" variant="primary" onClick={() => setOpen(true)}><FileUp size={14} /> 新建文档</Btn>
        </>
      }
    >
      {toast && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">{toast}</div>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="文档总数" value={q.data?.stats.total ?? 0} icon={BookOpen} footer="当前本体空间" />
        <StatCard label="已索引" value={q.data?.stats.indexed ?? 0} icon={CircleCheck} iconClass="bg-emerald-50 text-emerald-600" footer="可被检索" />
        <StatCard label="分块总数" value={q.data?.stats.chunks ?? 0} icon={FileText} iconClass="bg-cyan-50 text-cyan-600" footer="语义分块（带重叠）" />
        <StatCard label="知识分类" value={q.data?.stats.categories ?? 0} icon={Link2} iconClass="bg-violet-50 text-violet-600" footer="SOP/手册/合同等" />
      </div>

      <Card padding={false}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-3">
          <Tabs
            size="sm"
            tabs={[{ key: 'all', label: '全部' }, ...CATEGORIES.map((c) => ({ key: c, label: c }))]}
            active={cat}
            onChange={setCat}
          />
          <span className="text-xs text-slate-400">共 {rows.length} 篇</span>
        </div>
        <div className="p-4">
          {q.loading ? (
            <div className="flex items-center justify-center gap-2 py-14 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" /> 加载文档…</div>
          ) : rows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 py-12 text-center text-sm text-slate-400">
              该分类暂无文档，点击右上「新建文档」入库第一篇
            </div>
          ) : (
            <DataTable
              rows={rows}
              rowKey={(d) => d.id}
              columns={[
                {
                  key: 'title', header: '文档', cell: (d) => (
                    <span className="flex items-center gap-2">
                      <FileText size={14} className="shrink-0 text-brand-400" />
                      <span>
                        <span className="block font-medium text-slate-800">{d.title}</span>
                        <span className="block text-[11px] text-slate-400">{d.id} · {d.format} · {d.size} · {d.chunkCount} 块</span>
                      </span>
                    </span>
                  ),
                },
                { key: 'category', header: '分类', cell: (d) => <Badge color="violet">{d.category}</Badge> },
                {
                  key: 'linked', header: '挂接对象', cell: (d) => (
                    <span className="flex flex-wrap items-center gap-1">
                      {d.linked.length === 0 && <span className="text-slate-300">—</span>}
                      {d.linked.slice(0, 2).map((l) => (
                        <span key={l.objectId} className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-600">
                          <Link2 size={9} />{l.label}
                        </span>
                      ))}
                      {d.linked.length > 2 && <span className="text-[11px] text-slate-400">+{d.linked.length - 2}</span>}
                    </span>
                  ),
                },
                { key: 'status', header: '状态', cell: (d) => <Badge color={STATUS_COLOR[d.status] ?? 'slate'} dot>{d.status}</Badge> },
                { key: 'owner', header: '负责人' },
                { key: 'updatedAt', header: '更新', align: 'right', cell: (d) => <span className="text-xs text-slate-500">{d.updatedAt}</span> },
                {
                  key: 'op', header: '操作', align: 'right', cell: (d) => (
                    <span className="flex items-center justify-end gap-2 text-[11px]">
                      <button onClick={() => { setLinkFor(d.id); setLinkObjId('') }} className="text-slate-500 hover:text-brand-600">挂接</button>
                      <button onClick={() => reindex(d)} className="text-slate-500 hover:text-brand-600">重建</button>
                      {confirmDel === d.id ? (
                        <>
                          <button onClick={() => remove(d)} className="rounded bg-red-500 px-1.5 py-0.5 text-white">确认</button>
                          <button onClick={() => setConfirmDel(null)} className="text-slate-400">取消</button>
                        </>
                      ) : (
                        <button onClick={() => setConfirmDel(d.id)} className="text-slate-300 hover:text-red-500"><Trash2 size={12} /></button>
                      )}
                    </span>
                  ),
                },
              ]}
            />
          )}
        </div>
      </Card>

      {/* 新建文档弹层 */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div className="max-h-[88vh] w-[640px] max-w-[94vw] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div className="text-base font-bold text-slate-900">新建文档</div>
              <button onClick={() => setOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={16} /></button>
            </div>
            <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
              <Field label="文档标题" required><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="如：注塑机液压系统维修手册" /></Field>
              <Field label="分类">
                <Select className="w-full" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </Field>
            </div>
            <div className="mt-3">
              <Field label="文档内容" required hint="按段落自动语义分块；.txt/.md 可直接读取">
                <textarea
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  placeholder="粘贴文档正文……"
                  className="h-56 w-full resize-none rounded-lg border border-slate-200 p-3 text-[13px] leading-6 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                />
              </Field>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input ref={fileRef} type="file" accept=".txt,.md,.markdown" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f) }} />
              <Btn size="sm" onClick={() => fileRef.current?.click()}><FileUp size={12} /> 读取 .txt / .md</Btn>
              <span className="text-[11px] text-slate-400">{form.content.length} 字 · 预计 {Math.max(1, Math.ceil(form.content.length / 400))} 个分块</span>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Btn onClick={() => setOpen(false)}>取消</Btn>
              <Btn variant="primary" disabled={busy} onClick={submit}>{busy ? <><Loader2 size={13} className="animate-spin" /> 入库中…</> : '入库并索引'}</Btn>
            </div>
          </div>
        </div>
      )}

      {/* 挂接对象弹层 */}
      {linkFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={() => setLinkFor(null)}>
          <div className="w-[480px] max-w-[92vw] rounded-2xl border border-slate-200 bg-white p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 text-base font-bold text-slate-900">挂接业务对象</div>
            <Field label="选择对象" required>
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-slate-100 p-1.5">
                {(objsQ.data?.groups ?? []).flatMap((g) =>
                  g.objects.map((o) => (
                    <button
                      key={o.id}
                      onClick={() => setLinkObjId(o.id)}
                      className={cn('block w-full rounded-lg px-2.5 py-2 text-left text-[13px]', linkObjId === o.id ? 'bg-brand-50 text-brand-700' : 'hover:bg-slate-50')}
                    >
                      {String(o.values.name ?? o.values.title ?? o.values.code ?? o.id)}
                      <span className="ml-1.5 text-[11px] text-slate-400">{g.type.name}</span>
                    </button>
                  )),
                )}
              </div>
            </Field>
            <div className="mt-4 flex justify-end gap-2">
              <Btn onClick={() => setLinkFor(null)}>取消</Btn>
              <Btn variant="primary" disabled={!linkObjId} onClick={linkDoc}>挂接</Btn>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}
