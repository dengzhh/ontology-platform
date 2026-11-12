import { useState } from 'react'
import { ScanText, Boxes, GitBranch, Check, X, Loader2, RefreshCw, FileText, Play, ArrowDownToLine, CircleCheck } from 'lucide-react'
import PageShell from '@/components/ui/PageShell'
import StatCard from '@/components/ui/StatCard'
import DataTable from '@/components/ui/DataTable'
import Btn from '@/components/ui/Btn'
import { Badge } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import { Select } from '@/components/ui/Form'
import { api } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'

/* ---------------- 类型 ---------------- */

interface Candidate {
  id: string
  kind: '实体' | '关系'
  content: string
  source: string
  confidence: number
  status: string
  materializedInto: string
  materializedKind: 'objectType' | 'linkType' | null
  createdAt: string
}
interface CandidatesResp {
  candidates: Candidate[]
  stats: { total: number; pending: number; accepted: number; rejected: number; materialized: number }
}
interface IndexInfo { name: string; source: string; vectors: number; dim: number; engine: string }
interface IndexesResp { indexes: IndexInfo[]; docs: { id: string; title: string; category: string; chunkCount: number }[] }
interface MaterializeResp {
  ok: boolean
  duplicate: boolean
  message: string
  kind: 'objectType' | 'linkType'
  name: string
  typeId: string
  createdTypes: string[]
  status: string
}

/** 知识抽取（P5）：向量索引管理 + 从文档抽取本体候选 + 审核 → 落地为本体类型 */
export default function Extract() {
  const candQ = useApi<CandidatesResp>('/extract/candidates')
  const idxQ = useApi<IndexesResp>('/extract/indexes')
  const [toast, setToast] = useState('')
  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3500) }
  const [selectedDoc, setSelectedDoc] = useState('')
  const [running, setRunning] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [materializingId, setMaterializingId] = useState<string | null>(null)
  const [materialized, setMaterialized] = useState<Record<string, MaterializeResp>>({})

  const stats = candQ.data?.stats ?? { total: 0, pending: 0, accepted: 0, rejected: 0, materialized: 0 }
  const cands = candQ.data?.candidates ?? []
  const docs = idxQ.data?.docs ?? []
  const indexes = idxQ.data?.indexes ?? []

  async function runExtract() {
    if (!selectedDoc) return notify('请选择要抽取的文档')
    setRunning(true)
    try {
      const res = await api<{ candidates: unknown[] }>('/extract/run', { method: 'POST', body: { docId: selectedDoc } })
      notify(`抽取完成：${res.candidates.length} 个候选（真实 LLM）`)
      candQ.reload()
    } catch (e) {
      notify(e instanceof Error ? e.message : '抽取失败')
    } finally { setRunning(false) }
  }

  async function decide(id: string, accept: boolean) {
    try {
      await api(`/extract/candidates/${id}/${accept ? 'accept' : 'reject'}`, { method: 'POST' })
      notify(accept ? '已接受，可点「落地为本体类型」正式入库' : '已拒绝')
      setConfirmId(null)
      candQ.reload()
    } catch (e) { notify(e instanceof Error ? e.message : '操作失败') }
  }

  async function materialize(c: Candidate) {
    setMaterializingId(c.id)
    try {
      const res = await api<MaterializeResp>(`/extract/candidates/${c.id}/materialize`, { method: 'POST' })
      setMaterialized((m) => ({ ...m, [c.id]: res }))
      notify(res.message)
      candQ.reload()
      idxQ.reload()
    } catch (e) {
      notify(`落地失败：${e instanceof Error ? e.message : '未知错误'}`)
    } finally { setMaterializingId(null) }
  }

  return (
    <PageShell
      icon={ScanText}
      title="知识抽取"
      subtitle="从文档中抽取本体候选（真实 LLM），审核后一键落地为正式对象/链接类型；向量索引管理"
      benchmark="知识抽取"
      features={[
        '文档抽取：选择已入库文档 → 调用真实 LLM → 识别候选实体/关系 → 人工审核',
        '向量索引管理：查看当前空间的向量统计（引擎类型/维度/向量数）',
        '审核 → 落地：已接受或待审核候选可一键落地为真实对象类型 / 链接类型，同名自动跳过、重复落地幂等',
        '落地结果：直接写入本体库并审计留痕，候选状态更新为「已落地」，无需再到本体管理器手工重建',
        '嵌入引擎可视化：显示当前用的是远程 embedding 还是本地哈希（控制面板可切换）',
      ]}
      actions={<Btn size="sm" onClick={() => { candQ.reload(); idxQ.reload() }}><RefreshCw size={13} /> 刷新</Btn>}
    >
      {toast && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">{toast}</div>}

      {/* 统计 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="累计候选" value={stats.total} icon={ScanText} footer="LLM 从文档中识别" />
        <StatCard label="待审核" value={stats.pending} icon={Boxes} iconClass="bg-amber-50 text-amber-600" footer="人工确认后入库" />
        <StatCard label="已接受" value={stats.accepted} icon={Check} iconClass="bg-emerald-50 text-emerald-600" footer="待落地为本体类型" />
        <StatCard label="已落地" value={stats.materialized} icon={CircleCheck} iconClass="bg-cyan-50 text-cyan-600" footer="已写入本体库" />
        <StatCard label="已拒绝" value={stats.rejected} icon={X} iconClass="bg-slate-100 text-slate-400" footer="过滤噪音" />
      </div>

      {/* 向量索引 */}
      <Card>
        <CardHeader title="向量索引" desc="当前空间的知识向量化状态（嵌入引擎可在控制面板配置）" />
        <DataTable
          dense
          rows={indexes}
          columns={[
            { key: 'name', header: '索引', cell: (r) => <code className="rounded bg-cyan-50 px-1.5 py-0.5 font-mono text-xs font-semibold text-cyan-700">{r.name}</code> },
            { key: 'source', header: '数据来源' },
            { key: 'vectors', header: '向量数', align: 'right' },
            { key: 'dim', header: '维度', align: 'right' },
            {
              key: 'engine', header: '引擎', cell: (r) => (
                <Badge color={r.engine.includes('远程') ? 'green' : 'amber'} dot>{r.engine}</Badge>
              ),
            },
          ]}
        />
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        {/* 候选列表 */}
        <Card padding={false}>
          <div className="border-b border-slate-100 p-4"><CardHeader className="mb-0" title="抽取的本体候选" desc="LLM 识别的候选实体与关系，审核后一键「落地为本体类型」正式写入本体库" /></div>
          <div className="space-y-2.5 p-4">
            {candQ.loading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" /> 加载候选…</div>
            ) : cands.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 py-12 text-center text-sm text-slate-400">
                暂无抽取候选，选择下方文档运行 LLM 抽取
              </div>
            ) : (
              cands.map((c) => {
                const done = c.status === '已落地'
                const rejected = c.status === '已拒绝'
                const canMaterialize = !done && !rejected
                const busy = materializingId === c.id
                const result = materialized[c.id]
                const landed = done ? (c.materializedInto || result?.name) : ''
                const landedKind = done ? (c.materializedKind || result?.kind) : null
                return (
                  <div key={c.id} className={cn('rounded-xl border p-3.5', done ? 'border-cyan-200 bg-cyan-50/30' : c.status === '待审核' ? 'border-slate-200' : 'border-slate-100', rejected && 'opacity-60')}>
                    <div className="flex items-start gap-3">
                      <div className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', c.kind === '实体' ? 'bg-brand-50 text-brand-600' : 'bg-emerald-50 text-emerald-600')}>
                        {c.kind === '实体' ? <Boxes size={14} /> : <GitBranch size={14} />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge color={c.kind === '实体' ? 'blue' : 'green'}>{c.kind}</Badge>
                          <span className="text-[13px] font-medium leading-5 text-slate-700">{c.content}</span>
                          <span className={cn('text-[11px] font-medium', c.confidence >= 0.9 ? 'text-emerald-600' : c.confidence >= 0.7 ? 'text-amber-600' : 'text-red-500')}>
                            置信度 {c.confidence}
                          </span>
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-400">来源：{c.source} · {c.createdAt}</div>
                        {done && landed && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-cyan-700">
                            <CircleCheck size={12} />
                            已落地为{landedKind === 'linkType' ? '链接类型' : '对象类型'}
                            <code className="rounded bg-cyan-100 px-1.5 py-0.5 font-mono font-semibold">{landed}</code>
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        {c.status === '待审核' ? (
                          confirmId === c.id ? (
                            <div className="flex gap-1.5">
                              <button onClick={() => decide(c.id, true)} className="rounded bg-emerald-500 px-2 py-1 text-[11px] text-white">确认接受</button>
                              <button onClick={() => setConfirmId(null)} className="text-[11px] text-slate-400">取消</button>
                            </div>
                          ) : (
                            <div className="flex gap-1">
                              <button onClick={() => setConfirmId(c.id)} className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100" title="接受"><Check size={14} /></button>
                              <button onClick={() => decide(c.id, false)} className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:border-red-200 hover:text-red-500" title="拒绝"><X size={14} /></button>
                            </div>
                          )
                        ) : (
                          <Badge color={done ? 'cyan' : c.status === '已接受' ? 'green' : 'slate'}>{c.status}</Badge>
                        )}
                        {canMaterialize && (
                          <button
                            onClick={() => materialize(c)}
                            disabled={busy}
                            className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {busy ? <><Loader2 size={12} className="animate-spin" /> 落地中…</> : <><ArrowDownToLine size={12} /> 落地为本体类型</>}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </Card>

        {/* 运行抽取 */}
        <div className="space-y-4">
          <Card>
            <CardHeader title="运行知识抽取" desc="选择已入库文档，调用真实 LLM 识别本体候选" />
            <div className="space-y-3">
              <Select className="w-full" value={selectedDoc} onChange={(e) => setSelectedDoc(e.target.value)}>
                <option value="">选择文档…</option>
                {docs.map((d) => (
                  <option key={d.id} value={d.id}>{d.title}（{d.category}，{d.chunkCount} 块）</option>
                ))}
              </Select>
              {docs.length === 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-700">
                  当前空间暂无已入库文档。先到「知识库」页入库文档，再回来运行抽取。
                </div>
              )}
              <Btn variant="primary" className="w-full" disabled={!selectedDoc || running} onClick={runExtract}>
                {running ? <><Loader2 size={14} className="animate-spin" /> LLM 抽取中…</> : <><Play size={14} /> 运行 LLM 抽取</>}
              </Btn>
              <div className="text-[11px] leading-5 text-slate-400">
                使用当前配置的 LLM（控制面板→AI 服务）分析文档内容，识别文档中提到但本体尚未覆盖的实体与关系。
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="空间文档列表" desc="已入库并索引的文档" />
            <div className="max-h-56 space-y-1.5 overflow-y-auto">
              {docs.length === 0 && <div className="py-4 text-center text-xs text-slate-400">暂无文档</div>}
              {docs.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setSelectedDoc(d.id)}
                  className={cn('flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px]', selectedDoc === d.id ? 'bg-brand-50 text-brand-700' : 'hover:bg-slate-50')}
                >
                  <FileText size={13} className="shrink-0 text-slate-400" />
                  <span className="flex-1 truncate">{d.title}</span>
                  <span className="text-[11px] text-slate-400">{d.chunkCount} 块</span>
                </button>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </PageShell>
  )
}
