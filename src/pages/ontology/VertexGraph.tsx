import { useMemo, useState } from 'react'
import { Share2, Loader2, RefreshCw, Info } from 'lucide-react'
import PageShell from '@/components/ui/PageShell'
import Btn from '@/components/ui/Btn'
import { Badge, type BadgeColor } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import { SearchInput } from '@/components/ui/Form'
import { KVList } from '@/components/ui/Misc'
import ZoomableCanvas from '@/components/canvas/ZoomableCanvas'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'

interface GraphNode { id: string; typeId: string; typeName: string; color: string; label: string; badgeKey: string; badge: string }
interface GraphEdge { id: string; source: string; target: string; linkTypeId: string; label: string }
interface GraphResp {
  space: { id: string; name: string; kind: string }
  types: { id: string; name: string; color: string; count: number }[]
  nodes: GraphNode[]
  edges: GraphEdge[]
  totalObjects: number
  truncated: boolean
}
/** 对象详情（/objects/:id 真实结构）：全量属性 + 结构化关联 */
interface ObjectDetail {
  object: { id: string; typeId: string; values: Record<string, unknown> }
  links: { id: string; linkTypeName: string; direction: 'out' | 'in'; otherId: string; otherType: string; otherTypeColor: string; otherName: string }[]
}

/**
 * 力导向布局（确定性，无随机）
 * 优化：① 节点间最小间距约束（防堆叠）② 斥力随节点数自适应 ③ 边弹簧更强
 */
function layout(nodes: GraphNode[], edges: GraphEdge[], width: number, height: number) {
  const n = nodes.length
  const pos = new Map<string, { x: number; y: number }>()
  if (n === 0) return pos

  const types = Array.from(new Set(nodes.map((x) => x.typeId)))
  const cx = width / 2
  const cy = height / 2
  // 类型簇半径随类型数扩展
  const R = Math.min(width, height) * (types.length <= 2 ? 0.24 : types.length <= 4 ? 0.31 : 0.36)
  const centers = new Map<string, { x: number; y: number }>()
  types.forEach((t, i) => {
    const a = (i / Math.max(types.length, 1)) * Math.PI * 2 - Math.PI / 2
    centers.set(t, { x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R })
  })
  // 同类型节点按簇半径分散
  const perType = new Map<string, GraphNode[]>()
  nodes.forEach((nd) => {
    if (!perType.has(nd.typeId)) perType.set(nd.typeId, [])
    perType.get(nd.typeId)!.push(nd)
  })
  perType.forEach((group, typeId) => {
    const c = centers.get(typeId)!
    const ringR = 22 + Math.min(group.length, 12) * 5.5
    group.forEach((nd, i) => {
      const a = (i / group.length) * Math.PI * 2
      pos.set(nd.id, { x: c.x + Math.cos(a) * ringR, y: c.y + Math.sin(a) * ringR })
    })
  })

  // 度数（用于给中心节点更多空间）
  const degree = new Map<string, number>()
  nodes.forEach((nd) => degree.set(nd.id, 0))
  edges.forEach((e) => {
    if (degree.has(e.source)) degree.set(e.source, degree.get(e.source)! + 1)
    if (degree.has(e.target)) degree.set(e.target, degree.get(e.target)! + 1)
  })

  const adj = edges.map((e) => [e.source, e.target] as const)
  // 理想边长：随节点数略增；斥力强度也相应提高，保证节点间距
  const idealLen = 96 + Math.min(n, 60) * 1.6
  const repulsion = idealLen * idealLen * 0.85
  const minDist = 46 // 最小节点间距（防重叠）
  const iterations = 260

  for (let it = 0; it < iterations; it++) {
    const disp = new Map<string, { x: number; y: number }>()
    for (const nd of nodes) disp.set(nd.id, { x: 0, y: 0 })

    // 斥力（Fruchterman-Reingold）
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = pos.get(nodes[i].id)!
        const b = pos.get(nodes[j].id)!
        let dx = a.x - b.x
        let dy = a.y - b.y
        let d2 = dx * dx + dy * dy
        if (d2 < 1) { dx = (i % 2 ? 1 : -1) * 0.8; dy = (j % 2 ? 1 : -1) * 0.8; d2 = 1.28 }
        const d = Math.sqrt(d2)
        const f = repulsion / d2
        const da = disp.get(nodes[i].id)!
        const db = disp.get(nodes[j].id)!
        da.x += (dx / d) * f
        da.y += (dy / d) * f
        db.x -= (dx / d) * f
        db.y -= (dy / d) * f
      }
    }
    // 引力（边弹簧）
    for (const [s, t] of adj) {
      const a = pos.get(s)
      const b = pos.get(t)
      if (!a || !b) continue
      const dx = a.x - b.x
      const dy = a.y - b.y
      const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1)
      const f = ((d * d) / idealLen) * 0.75
      const da = disp.get(s)!
      const db = disp.get(t)!
      da.x -= (dx / d) * f
      da.y -= (dy / d) * f
      db.x += (dx / d) * f
      db.y += (dy / d) * f
    }
    // 向类型中心聚拢（弱） + 位移限幅
    const temp = 14 * (1 - it / iterations) + 1.6
    for (const nd of nodes) {
      const p = pos.get(nd.id)!
      const c = centers.get(nd.typeId)!
      const dp = disp.get(nd.id)!
      const deg = degree.get(nd.id) ?? 0
      dp.x += (c.x - p.x) * 0.022
      dp.y += (c.y - p.y) * 0.022
      const len = Math.max(Math.sqrt(dp.x * dp.x + dp.y * dp.y), 0.01)
      p.x += (dp.x / len) * Math.min(len, temp)
      p.y += (dp.y / len) * Math.min(len, temp)
      p.x = Math.min(Math.max(p.x, 70), width - 70)
      p.y = Math.min(Math.max(p.y, 60), height - 60)
      void deg
    }
    // 硬性最小间距分离（防堆叠）
    if (it > iterations * 0.45) {
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = pos.get(nodes[i].id)!
          const b = pos.get(nodes[j].id)!
          const dx = b.x - a.x
          const dy = b.y - a.y
          const d = Math.sqrt(dx * dx + dy * dy) || 0.01
          if (d < minDist) {
            const push = (minDist - d) / 2
            const ux = dx / d
            const uy = dy / d
            a.x -= ux * push
            a.y -= uy * push
            b.x += ux * push
            b.y += uy * push
          }
        }
      }
    }
  }
  return pos
}

function badgeColor(v: string): BadgeColor {
  if (/运行|正常|完成|活跃|在职|在用|已审批/.test(v)) return 'green'
  if (/维修|待机|处理中|待审核|观察/.test(v)) return 'amber'
  if (/停机|失败|已取消|流失|报废/.test(v)) return 'red'
  return 'blue'
}

const W = 1600
const H = 1000

/** 关系图谱（Vertex，P3 真实数据）：对象节点 + 链接边 + 力导向布局 */
export default function VertexGraph() {
  const q = useApi<GraphResp>('/objects/graph?limit=60')
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set())
  const [keyword, setKeyword] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  // 选中节点时拉真实对象详情（全量属性 + 结构化关联），不再只靠图谱缓存
  const detailQ = useApi<ObjectDetail>(selected ? `/objects/${encodeURIComponent(selected)}` : null)

  const data = q.data
  const visibleNodes = useMemo(
    () => (data?.nodes ?? []).filter((n) => !hiddenTypes.has(n.typeId) && (!keyword || n.label.toLowerCase().includes(keyword.toLowerCase()))),
    [data, hiddenTypes, keyword],
  )
  const visibleIds = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes])
  const visibleEdges = useMemo(() => (data?.edges ?? []).filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target)), [data, visibleIds])
  const pos = useMemo(() => layout(visibleNodes, visibleEdges, W, H), [visibleNodes, visibleEdges])

  const selNode = visibleNodes.find((n) => n.id === selected)
  const selEdges = visibleEdges.filter((e) => e.source === selected || e.target === selected)
  const nodeMap = useMemo(() => new Map(visibleNodes.map((n) => [n.id, n])), [visibleNodes])

  function toggleType(id: string) {
    const next = new Set(hiddenTypes)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setHiddenTypes(next)
  }

  return (
    <PageShell
      icon={Share2}
      title="关系图谱"
      subtitle="当前本体空间的对象关系网络 —— 节点为真实对象，连线为真实链接实例"
      benchmark="关系网络"
      features={[
        '真实数据：节点与边来自当前空间的对象与链接实例（非演示数据）',
        '力导向布局：按类型分簇 + 弹簧-排斥迭代，含最小间距约束防堆叠',
        '可缩放画布：滚轮以光标为中心缩放、拖拽平移、右上控件复位（30%–400%）',
        '类型筛选：点击类型标签显隐该类节点，边随之收敛；搜索按名称定位',
      ]}
      actions={<Btn size="sm" onClick={() => q.reload()}><RefreshCw size={13} /> 刷新</Btn>}
    >
      {q.loading ? (
        <div className="flex items-center justify-center gap-2 py-14 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" /> 加载图谱数据…</div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {(data?.types ?? []).map((t) => {
              const hidden = hiddenTypes.has(t.id)
              return (
                <button
                  key={t.id}
                  onClick={() => toggleType(t.id)}
                  className={cn('flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px] font-medium transition-opacity', hidden ? 'border-slate-200 bg-white text-slate-400 opacity-60' : 'border-brand-200 bg-brand-50 text-brand-700')}
                  title={hidden ? '点击显示' : '点击隐藏'}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: hidden ? '#cbd5e1' : t.color }} />
                  {t.name}
                  <span className="text-[11px] opacity-70">{t.count}</span>
                </button>
              )
            })}
            <div className="ml-auto w-56"><SearchInput value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜索节点名称…" /></div>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="relative">
              <ZoomableCanvas width={W} height={H} className="h-[620px]">
                {visibleEdges.map((e) => {
                  const a = pos.get(e.source)
                  const b = pos.get(e.target)
                  if (!a || !b) return null
                  const isSel = selected === e.source || selected === e.target
                  return (
                    <line
                      key={e.id}
                      x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                      stroke={isSel ? '#3b82f6' : '#cbd5e1'}
                      strokeWidth={isSel ? 2 : 1.2}
                      opacity={isSel ? 1 : 0.65}
                    />
                  )
                })}
                {visibleNodes.map((n) => {
                  const p = pos.get(n.id)
                  if (!p) return null
                  const isSel = selected === n.id
                  const r = isSel ? 11 : 8
                  return (
                    <g key={n.id} data-node className="cursor-pointer" onClick={() => setSelected(isSel ? null : n.id)}>
                      {isSel && <circle cx={p.x} cy={p.y} r={r + 9} fill={n.color} opacity={0.15} />}
                      <circle cx={p.x} cy={p.y} r={r} fill={n.color} stroke="#fff" strokeWidth={2.5} />
                      <text x={p.x} y={p.y + r + 13} textAnchor="middle" fontSize={12} fontWeight={isSel ? 700 : 500} fill={isSel ? '#1e3a8a' : '#475569'}>
                        {n.label.slice(0, 14)}
                      </text>
                    </g>
                  )
                })}
              </ZoomableCanvas>
              <div className="absolute bottom-3 left-3 rounded-lg border border-slate-200 bg-white/95 px-2.5 py-1.5 text-[11px] text-slate-500 shadow-card">
                {visibleNodes.length} 节点 · {visibleEdges.length} 连线
                {data?.truncated && <span className="ml-1 text-amber-600">· 仅显示前 60 个对象</span>}
              </div>
            </div>

            <div className="min-w-0">
              {selNode ? (
                <Card>
                  <CardHeader
                    title={<span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: selNode.color }} />{selNode.label}</span>}
                    desc={`类型：${selNode.typeName}`}
                    actions={selNode.badge && <Badge color={badgeColor(selNode.badge)} dot>{selNode.badge}</Badge>}
                  />
                  {/* 全量属性：来自 /objects/:id 真实对象详情 */}
                  <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
                    {detailQ.loading && <div className="flex items-center gap-1.5 text-xs text-slate-400"><Loader2 size={12} className="animate-spin" /> 加载对象属性…</div>}
                    {!detailQ.loading && (
                      <KVList cols={1} items={[
                        { k: '对象类型', v: selNode.typeName },
                        { k: '对象 ID', v: <code className="font-mono text-[11px]">{selNode.id}</code> },
                        ...Object.entries(detailQ.data?.object.values ?? {}).map(([k, v]) => ({
                          k, v: <span className="text-xs">{v === null || v === undefined || v === '' ? '—' : String(v)}</span>,
                        })),
                        { k: '关联数', v: `${detailQ.data?.links.length ?? selEdges.length} 条` },
                      ]} />
                    )}
                  </div>
                  <div className="mb-1.5 mt-3 flex items-center justify-between text-[13px] font-semibold text-slate-700">
                    <span>关联对象</span>
                    <span className="text-[10px] font-normal text-slate-400">{detailQ.data ? '来自 /objects/:id' : '来自图谱缓存'}</span>
                  </div>
                  <div className="space-y-1.5">
                    {/* 优先用真实详情的结构化关联；详情未就绪时回退到图谱边 */}
                    {detailQ.data ? (
                      detailQ.data.links.length === 0
                        ? <div className="rounded-lg border border-dashed border-slate-200 p-3 text-center text-xs text-slate-400">该对象暂无关联</div>
                        : detailQ.data.links.map((l) => (
                          <button
                            key={l.id}
                            onClick={() => setSelected(l.otherId)}
                            className="flex w-full items-center gap-2 rounded-lg border border-slate-100 px-2.5 py-2 text-left hover:border-brand-300 hover:bg-brand-50/40"
                          >
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: l.otherTypeColor }} />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[13px] font-medium text-slate-700">{l.otherName}</div>
                              <div className="text-[11px] text-slate-400">{l.direction === 'out' ? '→' : '←'} {l.linkTypeName} · {l.otherType}</div>
                            </div>
                          </button>
                        ))
                    ) : (
                      <>
                        {selEdges.length === 0 && <div className="rounded-lg border border-dashed border-slate-200 p-3 text-center text-xs text-slate-400">该对象暂无关联</div>}
                        {selEdges.map((e) => {
                          const otherId = e.source === selNode.id ? e.target : e.source
                          const other = nodeMap.get(otherId)
                          return (
                            <button
                              key={e.id}
                              onClick={() => setSelected(otherId)}
                              className="flex w-full items-center gap-2 rounded-lg border border-slate-100 px-2.5 py-2 text-left hover:border-brand-300 hover:bg-brand-50/40"
                            >
                              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: other?.color ?? '#94a3b8' }} />
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[13px] font-medium text-slate-700">{other?.label ?? otherId}</div>
                                <div className="text-[11px] text-slate-400">{e.label} · {other?.typeName ?? ''}</div>
                              </div>
                            </button>
                          )
                        })}
                      </>
                    )}
                  </div>
                </Card>
              ) : (
                <Card className="flex h-full min-h-[240px] flex-col items-center justify-center gap-2 text-center">
                  <Info size={24} className="text-slate-200" />
                  <div className="text-sm text-slate-400">点击图中任意节点查看详情</div>
                  <div className="text-[11px] text-slate-400">显示类型、状态徽章与关联对象（可点击跳转）</div>
                </Card>
              )}
            </div>
          </div>
        </>
      )}
    </PageShell>
  )
}
