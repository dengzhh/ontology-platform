import { useState } from 'react'
import { LineChart, Loader2, RefreshCw, ArrowRight, User } from 'lucide-react'
import { CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import PageShell from '@/components/ui/PageShell'
import Btn from '@/components/ui/Btn'
import { Badge, type BadgeColor } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import { Select, SearchInput } from '@/components/ui/Form'
import { KVList, Avatar } from '@/components/ui/Misc'
import Timeline from '@/components/ui/Timeline'
import { api } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'

interface TypeBrief { id: string; name: string; color: string; count: number }
interface ListResp { types: TypeBrief[] }
interface SearchResp { groups: { type: { id: string; name: string; color: string }; objects: { id: string; values: Record<string, unknown> }[] }[]; total: number }
interface TimelineResp {
  object: { id: string; values: Record<string, unknown>; createdAt: string; updatedAt: string }
  type: { name: string; color: string; properties: { key: string; name: string; type: string }[] } | null
  timeline: { time: string; actor: string; action: string; detail: string }[]
}

function badgeColor(v: string): BadgeColor {
  if (/运行|正常|完成|活跃|在职|在用/.test(v)) return 'green'
  if (/维修|待机|处理中|待审核/.test(v)) return 'amber'
  if (/停机|失败|已取消|流失/.test(v)) return 'red'
  return 'blue'
}

/** Quiver 对象分析（P9 真实数据）：从对象出发的分析路径 + 属性下钻 + 时间线 */
export default function Quiver() {
  const typesQ = useApi<ListResp>('/objects/types')
  const types = typesQ.data?.types ?? []
  const [typeId, setTypeId] = useState('')
  const [keyword, setKeyword] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<TimelineResp | null>(null)

  // 类型筛选进 API（服务端过滤），typeId 变化即重新查询；不再做前端过滤
  const searchQ = useApi<SearchResp>(query ? `/objects/search?q=${encodeURIComponent(query)}&type=${encodeURIComponent(typeId)}&limit=50` : null)
  const results = (searchQ.data?.groups ?? []).flatMap((g) => g.objects.map((o) => ({ ...o, typeName: g.type.name, typeColor: g.type.color })))

  async function openDetail(id: string) {
    setSelected(id)
    try {
      const r = await api<TimelineResp>(`/dashboard/timeline?id=${encodeURIComponent(id)}`)
      setDetail(r)
    } catch { setDetail(null) }
  }

  return (
    <PageShell
      icon={LineChart}
      title="Quiver 对象分析"
      subtitle="从业务对象出发的分析路径：搜索→选择→属性下钻→变更时间线"
      benchmark="联动分析"
      features={['对象搜索：跨类型关键词搜索', '属性下钻：选中对象显示全部属性与枚举徽章', '变更时间线：审计日志中的对象操作记录', '类型筛选：按对象类型过滤搜索结果']}
      actions={<Btn size="sm" onClick={() => { setQuery(keyword); setSelected(null); setDetail(null) }}><RefreshCw size={13} /> 搜索</Btn>}
    >
      {/* 搜索区 */}
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <Select value={typeId} onChange={(e) => setTypeId(e.target.value)} className="w-48">
            <option value="">全部类型</option>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}({t.count})</option>)}
          </Select>
          <div className="min-w-64 flex-1">
            <SearchInput
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { setQuery(keyword); setSelected(null); setDetail(null) } }}
              placeholder="搜索对象名称、编号…"
            />
          </div>
          <Btn variant="primary" onClick={() => { setQuery(keyword); setSelected(null); setDetail(null) }}>分析</Btn>
        </div>
        {query && (
          <div className="mt-2 text-xs text-slate-400">
            「{query}」命中 {searchQ.data?.total ?? 0} 个对象{searchQ.loading ? ' · 搜索中…' : ''}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        {/* 左：搜索结果 */}
        <div className="min-w-0 space-y-3">
          {!query ? (
            <Card className="py-14 text-center text-sm text-slate-400">
              输入关键词搜索对象开始分析
            </Card>
          ) : searchQ.loading ? (
            <div className="flex items-center justify-center gap-2 py-14 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" /> 搜索中…</div>
          ) : results.length === 0 ? (
            <Card className="py-14 text-center text-sm text-slate-400">没有匹配「{query}」的对象</Card>
          ) : (
            <>
              <CardHeader title="搜索结果" desc="点击对象查看分析详情" />
              <div className="space-y-2">
                {results.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => openDetail(r.id)}
                    className={cn('flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors', selected === r.id ? 'border-brand-300 bg-brand-50/40' : 'border-slate-200 hover:border-brand-200')}
                  >
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.typeColor }} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-slate-800">
                        {String(r.values.name ?? r.values.title ?? r.values.code ?? r.id)}
                      </div>
                      <div className="text-[11px] text-slate-400">{r.typeName}</div>
                    </div>
                    <ArrowRight size={14} className="shrink-0 text-slate-300" />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* 右：对象详情 */}
        <div className="min-w-0">
          {detail && detail.type ? (
            <Card>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ background: detail.type.color }} />
                    {String(detail.object.values[detail.type.properties[0]?.key ?? ''] ?? detail.object.id)}
                  </span>
                }
                desc={`${detail.type.name} · 对象分析`}
              />

              {/* 属性 */}
              <div className="mb-3 rounded-lg border border-slate-100 bg-slate-50/60 p-3">
                <KVList
                  cols={2}
                  items={detail.type.properties.slice(0, 8).map((p) => ({
                    k: p.name,
                    v: detail.object.values[p.key] !== undefined
                      ? p.type === 'enum'
                        ? <Badge color={badgeColor(String(detail.object.values[p.key]))}>{String(detail.object.values[p.key])}</Badge>
                        : String(detail.object.values[p.key])
                      : '—',
                  }))}
                />
                <div className="mt-2 border-t border-slate-100 pt-2 text-[11px] text-slate-400">
                  创建：{detail.object.createdAt} · 更新：{detail.object.updatedAt}
                </div>
              </div>

              {/* 变更时间线 */}
              <CardHeader title="变更时间线" desc="该对象的审计留痕（最近 10 条）" />
              {detail.timeline.length > 0 ? (
                <Timeline
                  items={detail.timeline.map((t, i) => ({
                    time: t.time,
                    title: t.action,
                    desc: t.detail,
                    color: (i % 3 === 0 ? 'blue' : i % 3 === 1 ? 'green' : 'slate') as BadgeColor,
                  }))}
                />
              ) : (
                <div className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">
                  该对象暂无变更记录（新创建或未被操作过）
                </div>
              )}
            </Card>
          ) : (
            <Card className="flex h-full min-h-[300px] flex-col items-center justify-center gap-2 text-center">
              <User size={28} className="text-slate-200" />
              <div className="text-sm text-slate-400">搜索并选择对象查看分析</div>
              <div className="text-[11px] text-slate-400">属性下钻、状态徽章、变更时间线</div>
            </Card>
          )}
        </div>
      </div>
    </PageShell>
  )
}
