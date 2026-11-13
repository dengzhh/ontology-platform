import { useState } from 'react'
import { FileSearch, Search, Loader2, X, Link2, Quote } from 'lucide-react'
import PageShell from '@/components/ui/PageShell'
import Tabs from '@/components/ui/Tabs'
import { Badge } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import { api } from '@/lib/api'

interface Hit {
  chunkId: string
  docId: string
  docTitle: string
  docCategory: string
  idx: number
  text: string
  score: number
  source: 'kw' | 'vec' | 'both'
}
interface SearchResp { q: string; mode: string; total: number; results: Hit[]; engine?: string; hint?: string }

const SUGGESTIONS = ['液压泄漏怎么处理', '点检要求', '备件库存', '供应商评级标准']

/** 知识检索（P5 真实）：BM25 关键词 + 向量语义，RRF 融合 */
export default function KnowledgeSearch() {
  const [q, setQ] = useState('')
  const [mode, setMode] = useState<'hybrid' | 'keyword' | 'semantic'>('hybrid')
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<SearchResp | null>(null)
  const [err, setErr] = useState('')
  const [selected, setSelected] = useState<Hit | null>(null)

  async function search(text?: string, m?: typeof mode) {
    const kw = (text ?? q).trim()
    const md = m ?? mode
    if (!kw) return
    setQ(kw)
    setMode(md)
    setLoading(true)
    setErr('')
    try {
      const res = await api<SearchResp>(`/knowledge/search?q=${encodeURIComponent(kw)}&mode=${md}&limit=12`)
      setData(res)
      setSelected(res.results[0] ?? null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '检索失败')
    } finally { setLoading(false) }
  }

  /** 高亮命中词（中文按 2 字滑窗，英文按词） */
  function highlight(text: string): { __html: string } {
    const kw = data?.q ?? ''
    if (!kw) return { __html: escapeHtml(text) }
    const terms = new Set<string>()
    for (const w of kw.toLowerCase().split(/[^\w\u4e00-\u9fa5]+/).filter((x) => x.length > 1)) terms.add(w)
    const cjk = kw.toLowerCase().match(/[\u4e00-\u9fa5]+/g) ?? []
    for (const seg of cjk) {
      if (seg.length <= 2) terms.add(seg)
      else for (let i = 0; i < seg.length - 1; i++) terms.add(seg.slice(i, i + 2))
    }
    let html = escapeHtml(text)
    for (const t of Array.from(terms).sort((a, b) => b.length - a.length)) {
      if (t.length < 2) continue
      const re = new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
      html = html.replace(re, '<mark class="rounded bg-amber-200/70 px-0.5 text-slate-900">$1</mark>')
    }
    return { __html: html }
  }

  function escapeHtml(s: string) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  return (
    <PageShell
      icon={FileSearch}
      title="知识检索"
      subtitle="BM25 关键词 + 向量语义双路召回，RRF 融合排序，结果可溯源到文档分块"
      benchmark="混合检索"
      features={[
        '混合检索：关键词精确匹配（BM25）+ 语义相似（向量余弦）双路召回并融合',
        '模式切换：混合 / 纯关键词 / 纯语义，便于对比召回差异',
        '结果溯源：每条结果标注来源文档、分块序号、命中方式与相关度',
        '关键词高亮：结果片段中命中词直接标出，便于快速判断相关性',
      ]}
    >
      <Card>
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
          <Search size={17} className="shrink-0 text-brand-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) search() }}
            placeholder="搜索知识库：设备故障处理、SOP 要求、合同条款……"
            className="flex-1 bg-transparent text-[14px] text-slate-800 placeholder:text-slate-400 focus:outline-none"
          />
          {q && <button onClick={() => { setQ(''); setData(null) }} className="text-slate-300 hover:text-slate-500"><X size={15} /></button>}
          <button onClick={() => search()} className="rounded-lg bg-brand-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-brand-700">检索</button>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <Tabs
            size="sm"
            tabs={[{ key: 'hybrid', label: '混合检索' }, { key: 'keyword', label: '关键词' }, { key: 'semantic', label: '语义' }]}
            active={mode}
            onChange={(m) => { setMode(m as typeof mode); if (data) search(q, m as typeof mode) }}
          />
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => search(s)} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-500 hover:border-brand-300 hover:text-brand-600">{s}</button>
            ))}
          </div>
        </div>
      </Card>

      {err && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-600">{err}</div>}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-14 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" /> 检索中…</div>
      ) : data ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>「{data.q}」命中 {data.total} 个片段 · 模式：{data.mode === 'hybrid' ? '混合' : data.mode === 'keyword' ? '关键词' : '语义'}{data.engine && ` · 向量引擎：${data.engine === 'remote' ? '远程' : '本地'}`}</span>
            </div>
            {data.hint && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">{data.hint}</div>}
            {data.results.length === 0 && !data.hint && (
              <Card className="py-12 text-center text-sm text-slate-400">没有匹配的知识片段，试试换个说法或切换检索模式</Card>
            )}
            {data.results.map((r) => (
              <button
                key={r.chunkId}
                onClick={() => setSelected(r)}
                className={`block w-full rounded-xl border p-3.5 text-left transition-colors ${selected?.chunkId === r.chunkId ? 'border-brand-300 bg-brand-50/40' : 'border-slate-200 bg-white hover:border-brand-200'}`}
              >
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-bold text-slate-800">{r.docTitle}</span>
                  <Badge color="violet">{r.docCategory}</Badge>
                  <span className="text-[11px] text-slate-400">第 {r.idx + 1} 块</span>
                  <span className="ml-auto flex items-center gap-1.5">
                    <Badge color={r.source === 'both' ? 'green' : r.source === 'kw' ? 'blue' : 'cyan'}>
                      {r.source === 'both' ? '关键词+语义' : r.source === 'kw' ? '关键词' : '语义'}
                    </Badge>
                    <Badge color="slate">相关度 {r.score}</Badge>
                  </span>
                </div>
                <div className="line-clamp-3 text-[13px] leading-6 text-slate-600" dangerouslySetInnerHTML={highlight(r.text)} />
              </button>
            ))}
          </div>

          <div className="min-w-0">
            {selected ? (
              <Card>
                <CardHeader
                  title={<span className="flex items-center gap-2"><Quote size={13} className="text-brand-500" />片段原文</span>}
                  desc={`${selected.docTitle} · 第 ${selected.idx + 1} 块`}
                />
                <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3 text-[13px] leading-6 text-slate-700" dangerouslySetInnerHTML={highlight(selected.text)} />
                <div className="mt-3 space-y-1.5 text-[11px] text-slate-400">
                  <div className="flex items-center gap-1.5"><Link2 size={11} />片段 ID：<code className="font-mono">{selected.chunkId}</code></div>
                  <div>文档 ID：<code className="font-mono">{selected.docId}</code></div>
                  <div>该片段可直接作为 智能助手回答的引用来源</div>
                </div>
              </Card>
            ) : (
              <Card className="flex h-full min-h-[200px] items-center justify-center text-sm text-slate-400">选择左侧结果查看完整片段</Card>
            )}
          </div>
        </div>
      ) : (
        <Card className="py-14 text-center">
          <FileSearch size={28} className="mx-auto mb-2 text-slate-200" />
          <div className="text-sm text-slate-400">输入关键词检索知识库，或点击上方建议词体验</div>
          <div className="mt-1 text-[11px] text-slate-400">检索结果可追溯到具体文档分块，用于支撑 AI 回答</div>
        </Card>
      )}
    </PageShell>
  )
}
