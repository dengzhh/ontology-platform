import { useEffect, useState } from 'react'
import { GitBranch, GitPullRequest, Folder, FileCode, FileText, CheckCircle2, Plus, Trash2, Save, Loader2 } from 'lucide-react'
import PageShell from '@/components/ui/PageShell'
import Btn from '@/components/ui/Btn'
import { Badge } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import { CodeBlock } from '@/components/canvas/CodeBlock'
import { api } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'

interface RepoFile { id: string; path: string; lang: string; branch: string; updatedBy: string; updatedAt: string }
interface FileDetail extends RepoFile { content: string }

/** 代码资产（真实登记，非 Git 集成） */
export default function CodeRepo() {
  const q = useApi<{ files: RepoFile[] }>('/data-layer/repo')
  const files = q.data?.files ?? []
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<FileDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2600) }
  const [newOpen, setNewOpen] = useState(false)
  const [newForm, setNewForm] = useState({ path: '', lang: 'typescript', content: '' })

  useEffect(() => {
    if (!selected && files.length) setSelected(files[0].id)
  }, [files, selected])

  useEffect(() => {
    if (!selected) return
    setLoading(true)
    api<{ file: FileDetail }>(`/data-layer/repo/${selected}`).then((r) => {
      setDetail(r.file)
      setDraft(r.file.content)
    }).catch(() => setDetail(null)).finally(() => setLoading(false))
  }, [selected])

  async function save() {
    if (!detail) return
    setBusy(true)
    try {
      await api(`/data-layer/repo/${detail.id}`, { method: 'PATCH', body: { content: draft } })
      notify('文件已保存')
      setEditing(false)
      setDetail({ ...detail, content: draft })
      q.reload()
    } catch (e) { notify(e instanceof Error ? e.message : '保存失败') }
    finally { setBusy(false) }
  }

  async function remove() {
    if (!detail) return
    setBusy(true)
    try {
      await api(`/data-layer/repo/${detail.id}`, { method: 'DELETE' })
      notify('已删除')
      setSelected(null); setDetail(null)
      q.reload()
    } catch (e) { notify(e instanceof Error ? e.message : '删除失败') }
    finally { setBusy(false) }
  }

  async function create() {
    if (!newForm.path.trim()) return notify('请填写路径')
    setBusy(true)
    try {
      const r = await api<{ id: string }>('/data-layer/repo', { method: 'POST', body: newForm })
      notify('文件已创建')
      setNewOpen(false)
      setNewForm({ path: '', lang: 'typescript', content: '' })
      q.reload()
      setSelected(r.id)
    } catch (e) { notify(e instanceof Error ? e.message : '创建失败') }
    finally { setBusy(false) }
  }

  // 按路径前缀生成树
  const roots = Array.from(new Set(files.map((f) => f.path.split('/')[0])))

  return (
    <PageShell
      icon={GitBranch}
      title="代码资产"
      subtitle="登记空间内的转换脚本与 SQL 资产（轻量代码库，非 Git 集成）"
      benchmark="代码工程"
      features={[
        '文件登记：按路径/语言/分支登记代码资产，服务端持久化',
        '在线查看与编辑：点击文件读取真实内容，可编辑保存',
        '新建/删除：创建或移除代码资产',
        '分支标识：显示文件所属分支',
        'Git PR 流程（审查/合并）尚未接入，相关入口明确禁用',
      ]}
      actions={<Btn size="sm" variant="primary" onClick={() => setNewOpen(true)}><Plus size={14} /> 新建文件</Btn>}
    >
      {toast && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">{toast}</div>}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[280px_minmax(0,1fr)_260px]">
        {/* 文件树 */}
        <Card className="h-fit">
          <CardHeader title="文件" desc={`${files.length} 个资产`} />
          {q.loading && <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400"><Loader2 size={14} className="animate-spin" /> 加载…</div>}
          {!q.loading && files.length === 0 && <div className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-xs text-slate-400">暂无代码资产，点击右上新建</div>}
          <div className="space-y-0.5">
            {roots.map((root) => (
              <div key={root}>
                <div className="flex items-center gap-1.5 px-2 py-1.5 text-[12px] font-semibold text-slate-600"><Folder size={13} className="text-slate-400" /> {root}/</div>
                {files.filter((f) => f.path.startsWith(root + '/')).map((f) => (
                  <button
                    key={f.id}
                    onClick={() => { setSelected(f.id); setEditing(false) }}
                    className={cn('flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 pl-6 text-left text-[12px]', selected === f.id ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50')}
                  >
                    {f.path.endsWith('.sql') ? <FileText size={12} className="text-slate-400" /> : <FileCode size={12} className="text-slate-400" />}
                    <span className="truncate">{f.path.split('/').slice(1).join('/')}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </Card>

        {/* 代码区 */}
        <Card className="min-w-0">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" /> 读取文件…</div>
          ) : detail ? (
            <>
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-800">{detail.path}</span>
                  <Badge color="blue">{detail.branch}</Badge>
                  <Badge color="slate">{detail.lang}</Badge>
                </div>
                <div className="flex gap-1.5">
                  {editing ? (
                    <>
                      <Btn size="sm" variant="primary" disabled={busy} onClick={save}><Save size={12} /> 保存</Btn>
                      <Btn size="sm" onClick={() => { setEditing(false); setDraft(detail.content) }}>取消</Btn>
                    </>
                  ) : (
                    <>
                      <Btn size="sm" onClick={() => setEditing(true)}>编辑</Btn>
                      <Btn size="sm" variant="ghost" disabled={busy} onClick={remove}><Trash2 size={13} /></Btn>
                    </>
                  )}
                </div>
              </div>
              {editing ? (
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="h-[420px] w-full resize-none rounded-lg border border-slate-200 bg-slate-900 p-3 font-mono text-[12px] leading-5 text-slate-100 focus:border-brand-400 focus:outline-none"
                />
              ) : (
                <CodeBlock code={detail.content || '（空文件）'} title={detail.path} />
              )}
              <div className="mt-2 text-[11px] text-slate-400">最后更新：{detail.updatedAt} · 由 {detail.updatedBy || '—'}</div>
            </>
          ) : (
            <div className="py-16 text-center text-sm text-slate-400">选择左侧文件查看内容</div>
          )}
        </Card>

        {/* 侧栏 */}
        <div className="space-y-4">
          <Card>
            <CardHeader title="分支" />
            <div className="space-y-1.5">
              {Array.from(new Set(files.map((f) => f.branch))).map((b) => (
                <div key={b} className="flex items-center gap-2 rounded-lg border border-slate-100 px-2.5 py-2 text-[12px]">
                  <GitBranch size={13} className="text-brand-500" /> {b}
                  <Badge color="slate" className="ml-auto">{files.filter((f) => f.branch === b).length}</Badge>
                </div>
              ))}
              {files.length === 0 && <div className="text-xs text-slate-400">暂无分支</div>}
            </div>
          </Card>
          <Card>
            <CardHeader title="Git 协作" desc="PR / 审查 / 合并" />
            <div className="space-y-2">
              <div className="flex items-center gap-2 rounded-lg border border-slate-100 px-2.5 py-2 text-[12px] text-slate-500"><GitPullRequest size={13} /> 新建 PR</div>
              <div className="flex items-center gap-2 rounded-lg border border-slate-100 px-2.5 py-2 text-[12px] text-slate-500"><CheckCircle2 size={13} /> CI 检查</div>
              <p className="text-[11px] leading-5 text-slate-400">
                Git 平台集成（PR 审查、分支合并、CI 状态）尚未接入，当前为轻量代码资产登记与在线编辑。
              </p>
            </div>
          </Card>
        </div>
      </div>

      {/* 新建文件弹层 */}
      {newOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={() => setNewOpen(false)}>
          <div className="w-[480px] max-w-[92vw] rounded-2xl border border-slate-200 bg-white p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 text-base font-bold text-slate-900">新建代码资产</div>
            <div className="space-y-3">
              <label className="block"><div className="mb-1 text-xs font-medium text-slate-600">文件路径 *</div><input value={newForm.path} onChange={(e) => setNewForm({ ...newForm, path: e.target.value })} placeholder="src/transforms/my_job.ts" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none" /></label>
              <label className="block"><div className="mb-1 text-xs font-medium text-slate-600">语言</div><select value={newForm.lang} onChange={(e) => setNewForm({ ...newForm, lang: e.target.value })} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"><option value="typescript">TypeScript</option><option value="python">Python</option><option value="sql">SQL</option><option value="markdown">Markdown</option></select></label>
              <label className="block"><div className="mb-1 text-xs font-medium text-slate-600">初始内容</div><textarea value={newForm.content} onChange={(e) => setNewForm({ ...newForm, content: e.target.value })} rows={6} className="w-full rounded-lg border border-slate-200 p-3 font-mono text-xs focus:border-brand-400 focus:outline-none" /></label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Btn onClick={() => setNewOpen(false)}>取消</Btn>
              <Btn variant="primary" disabled={busy} onClick={create}>{busy ? '创建中…' : '创建'}</Btn>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}
