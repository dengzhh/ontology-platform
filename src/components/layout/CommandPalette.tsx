import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CornerDownLeft, Search, Boxes, FileText, Bot, LayoutGrid, Loader2 } from 'lucide-react'
import { ALL_NAV_ITEMS } from '@/config/nav'
import { useUI } from '@/store/ui'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

interface DataResult { id: string; label: string; typeName?: string; color?: string; category?: string }
interface SearchResp { objects: DataResult[]; documents: DataResult[]; agents: DataResult[]; apps: DataResult[] }

type Item =
  | { kind: 'app'; path: string; name: string; desc: string; benchmark: string }
  | { kind: 'object' | 'document' | 'agent' | 'app-data'; id: string; label: string; sub: string; color: string }

const GROUP_LABEL: Record<string, string> = { app: '应用', object: '对象', document: '文档', agent: 'Agent', 'app-data': '看板' }

/** Ctrl+K 全局命令面板：应用 + 对象 + 文档 + Agent + 看板 */
export default function CommandPalette() {
  const { paletteOpen, setPaletteOpen } = useUI()
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const [data, setData] = useState<SearchResp | null>(null)
  const [searching, setSearching] = useState(false)
  const navigate = useNavigate()

  // 数据搜索（防抖 300ms）
  useEffect(() => {
    if (!paletteOpen || !q.trim()) { setData(null); setSearching(false); return }
    setSearching(true)
    const t = setTimeout(() => {
      api<SearchResp>(`/objects/global-search?q=${encodeURIComponent(q.trim())}`)
        .then(setData)
        .catch(() => setData(null))
        .finally(() => setSearching(false))
    }, 300)
    return () => clearTimeout(t)
  }, [q, paletteOpen])

  const items: Item[] = useMemo(() => {
    const kw = q.trim().toLowerCase()
    const apps: Item[] = (kw
      ? ALL_NAV_ITEMS.filter((i) => i.name.toLowerCase().includes(kw) || i.desc.toLowerCase().includes(kw) || i.benchmark.toLowerCase().includes(kw) || i.path.includes(kw))
      : ALL_NAV_ITEMS
    ).map((i) => ({ kind: 'app' as const, path: i.path, name: i.name, desc: i.desc, benchmark: i.benchmark }))

    if (!data) return apps
    const out: Item[] = [...apps]
    for (const o of data.objects) out.push({ kind: 'object', id: o.id, label: o.label, sub: o.typeName ?? '', color: o.color ?? '#3b82f6' })
    for (const d of data.documents) out.push({ kind: 'document', id: d.id, label: d.label, sub: d.category ?? '', color: '#0ea5e9' })
    for (const a of data.agents) out.push({ kind: 'agent', id: a.id, label: a.label, sub: 'Agent', color: '#8b5cf6' })
    for (const a of data.apps) out.push({ kind: 'app-data', id: a.id, label: a.label, sub: '看板', color: '#10b981' })
    return out
  }, [q, data])

  useEffect(() => setIdx(0), [q])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen(true)
      }
      if (e.key === 'Escape') setPaletteOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setPaletteOpen])

  if (!paletteOpen) return null

  function go(item: Item) {
    setPaletteOpen(false)
    setQ('')
    setData(null)
    if (item.kind === 'app') navigate(item.path)
    else if (item.kind === 'object') navigate(`/ontology/explorer?q=${encodeURIComponent(item.label)}`)
    else if (item.kind === 'document') navigate(`/knowledge/search?q=${encodeURIComponent(item.label)}`)
    else if (item.kind === 'agent') navigate('/aip/agents')
    else navigate('/apps/workshop')
  }

  const ICONS: Record<string, typeof Boxes> = { app: LayoutGrid, object: Boxes, document: FileText, agent: Bot, 'app-data': LayoutGrid }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/30 pt-[12vh] backdrop-blur-sm" onClick={() => setPaletteOpen(false)}>
      <div className="w-[560px] max-w-[92vw] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 border-b border-slate-100 px-4 py-3">
          <Search size={16} className="text-slate-400" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, items.length - 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)) }
              if (e.key === 'Enter' && items[idx]) go(items[idx])
            }}
            placeholder="搜索应用、对象、文档、Agent、看板…"
            className="flex-1 bg-transparent text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
          />
          {searching && <Loader2 size={13} className="animate-spin text-slate-400" />}
          <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-400">ESC</kbd>
        </div>
        <div className="max-h-[46vh] overflow-y-auto p-2">
          {items.length === 0 && !searching && <div className="px-4 py-8 text-center text-sm text-slate-400">未找到匹配结果</div>}
          {items.map((it, i) => {
            const Icon = ICONS[it.kind] ?? LayoutGrid
            const name = it.kind === 'app' ? it.name : it.label
            const sub = it.kind === 'app' ? it.desc : it.sub
            const tag = it.kind === 'app' ? it.benchmark : GROUP_LABEL[it.kind]
            const color = it.kind === 'app' ? '#3b82f6' : it.color
            return (
              <button
                key={`${it.kind}-${it.kind === 'app' ? it.path : it.id}-${i}`}
                onClick={() => go(it)}
                onMouseEnter={() => setIdx(i)}
                className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left', i === idx ? 'bg-brand-50' : 'hover:bg-slate-50')}
              >
                <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', i === idx ? 'bg-brand-100 text-brand-600' : 'bg-slate-100 text-slate-500')}>
                  <Icon size={15} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-800">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
                    <span className="truncate">{name}</span>
                  </div>
                  <div className="truncate text-[11px] text-slate-400">{sub}</div>
                </div>
                <span className="shrink-0 rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-400">{tag}</span>
                {i === idx && <CornerDownLeft size={13} className="shrink-0 text-brand-500" />}
              </button>
            )
          })}
        </div>
        <div className="border-t border-slate-100 px-4 py-1.5 text-[10px] text-slate-400">
          ↑↓ 选择 · Enter 跳转 · Esc 关闭 · 数据来自当前本体空间
        </div>
      </div>
    </div>
  )
}
