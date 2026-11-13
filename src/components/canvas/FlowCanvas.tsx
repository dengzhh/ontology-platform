import { useRef } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export type FlowStatus = 'ok' | 'warn' | 'err' | 'run'

export interface FlowNode {
  id: string
  x: number
  y: number
  w?: number
  h?: number
  title: string
  subtitle?: string
  icon?: LucideIcon
  /** 图标底色，如 'bg-brand-50 text-brand-600' */
  accent?: string
  status?: FlowStatus
  badge?: string
}

export interface FlowEdge {
  from: string
  to: string
  label?: string
  dashed?: boolean
  /** 连线端点类型（条件分支 yes/no），供执行引擎与画布着色 */
  kind?: 'yes' | 'no'
}

const STATUS_COLOR: Record<FlowStatus, string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  err: 'bg-red-500',
  run: 'bg-brand-500 animate-pulse',
}

/**
 * 通用流程画布（SVG）：节点卡片 + 贝塞尔连线。
 * 用于管道构建 / AIP Logic / 血缘 / 流程编排等页面。
 * 可选交互（不传则纯展示，向后兼容）：selectedId 高亮选中、onNodeClick 点击选中、onNodeMove 拖拽位移。
 */
export default function FlowCanvas({
  nodes,
  edges,
  width = 1100,
  height = 420,
  className,
  selectedId,
  onNodeClick,
  onNodeMove,
}: {
  nodes: FlowNode[]
  edges: FlowEdge[]
  width?: number
  height?: number
  className?: string
  selectedId?: string | null
  onNodeClick?: (id: string) => void
  onNodeMove?: (id: string, x: number, y: number) => void
}) {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  const svgRef = useRef<SVGSVGElement | null>(null)
  const dragRef = useRef<{ id: string; startX: number; startY: number; ox: number; oy: number; moved: boolean } | null>(null)

  /** 把浏览器坐标换算为 viewBox 坐标（兼容 SVG 缩放） */
  function toViewBox(e: React.PointerEvent | React.MouseEvent): { x: number; y: number } {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    return { x: ((e.clientX - rect.left) / rect.width) * width, y: ((e.clientY - rect.top) / rect.height) * height }
  }

  function edgePath(from: FlowNode, to: FlowNode) {
    const fw = from.w ?? 176
    const fh = from.h ?? 60
    const tw = to.w ?? 176
    const x1 = from.x + fw
    const y1 = from.y + fh / 2
    const x2 = to.x
    const y2 = to.y + (to.h ?? 60) / 2
    const mx = (x1 + x2) / 2
    return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`
  }

  return (
    <div className={cn('canvas-grid overflow-hidden rounded-lg border border-slate-200 bg-slate-50/50', className)}>
      <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" style={{ minHeight: 200 }}>
        <defs>
          <marker id="flow-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 8 4 L 0 8 z" fill="#94a3b8" />
          </marker>
        </defs>
        {edges.map((e, i) => {
          const from = nodeMap.get(e.from)
          const to = nodeMap.get(e.to)
          if (!from || !to) return null
          return (
            <g key={i}>
              <path
                d={edgePath(from, to)}
                fill="none"
                stroke={e.kind === 'yes' ? '#10b981' : e.kind === 'no' ? '#f59e0b' : '#94a3b8'}
                strokeWidth={e.kind ? 2 : 1.5}
                strokeDasharray={e.dashed || e.kind === 'no' ? '5 4' : undefined}
                markerEnd="url(#flow-arrow)"
              />
              {e.label && (
                <>
                  <rect x={(from.x + (from.w ?? 176) + to.x) / 2 - e.label.length * 5 - 6} y={(from.y + to.y) / 2 + 22} rx={4} width={e.label.length * 10 + 12} height={18} fill="#fff" stroke="#e2e8f0" />
                  <text x={(from.x + (from.w ?? 176) + to.x) / 2} y={(from.y + to.y) / 2 + 34} textAnchor="middle" fontSize={10} fill="#64748b">
                    {e.label}
                  </text>
                </>
              )}
            </g>
          )
        })}
        {nodes.map((n) => {
          const w = n.w ?? 176
          const h = n.h ?? 60
          const Icon = n.icon
          const selected = selectedId === n.id
          const interactive = !!(onNodeClick || onNodeMove)
          return (
            <foreignObject key={n.id} x={n.x} y={n.y} width={w} height={h}>
              <div
                onPointerDown={(e) => {
                  if (!onNodeMove) return
                  const p = toViewBox(e)
                  dragRef.current = { id: n.id, startX: p.x, startY: p.y, ox: n.x, oy: n.y, moved: false }
                  ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
                }}
                onPointerMove={(e) => {
                  const d = dragRef.current
                  if (!d || d.id !== n.id || !onNodeMove) return
                  const p = toViewBox(e)
                  const dx = p.x - d.startX
                  const dy = p.y - d.startY
                  if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
                  if (d.moved) onNodeMove(n.id, Math.max(0, Math.round(d.ox + dx)), Math.max(0, Math.round(d.oy + dy)))
                }}
                onPointerUp={() => { dragRef.current = null }}
                onClick={(e) => {
                  if (!onNodeClick) return
                  e.stopPropagation()
                  // 拖拽结束时抑制误触选中
                  const d = dragRef.current
                  if (d?.moved) return
                  onNodeClick(n.id)
                }}
                className={cn(
                  'relative flex h-full items-center gap-2.5 rounded-xl border bg-white px-3 shadow-card transition-shadow',
                  selected ? 'border-brand-500 ring-2 ring-brand-200' : n.status === 'err' ? 'border-red-300' : n.status === 'warn' ? 'border-amber-300' : 'border-slate-200',
                  interactive && 'cursor-pointer select-none hover:shadow-md',
                  onNodeMove && 'cursor-grab active:cursor-grabbing',
                )}
              >
                {Icon && (
                  <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', n.accent ?? 'bg-slate-100 text-slate-500')}>
                    <Icon size={16} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-slate-800">{n.title}</div>
                  {n.subtitle && <div className="truncate text-[11px] text-slate-400">{n.subtitle}</div>}
                </div>
                {n.badge && <span className="absolute -top-2 right-2 rounded bg-slate-700 px-1.5 py-px text-[10px] font-medium text-white">{n.badge}</span>}
                {n.status && <span className={cn('absolute right-2 top-2 h-2 w-2 rounded-full', STATUS_COLOR[n.status])} />}
              </div>
            </foreignObject>
          )
        })}
      </svg>
    </div>
  )
}
