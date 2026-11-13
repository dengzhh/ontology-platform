import { useEffect, useRef, useState } from 'react'
import { ZoomIn, ZoomOut, Maximize2, Move } from 'lucide-react'
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
 * 用于管道构建 / 工作流编排 / 血缘 / 流程编排等页面。
 * 可选交互（不传则纯展示，向后兼容）：selectedId 高亮、onNodeClick 点选、onNodeMove 拖拽位移。
 * zoomable=true 时启用滚轮缩放（以光标为中心）、空白拖拽平移、右上角控件与百分比；
 * 节点点击/拖拽的坐标会反算缩放与平移，保证任意缩放下操作准确。
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
  onNodeDragStart,
  onNodeDragEnd,
  onEdgeClick,
  connectMode = false,
  connectFrom,
  zoomable = false,
}: {
  nodes: FlowNode[]
  edges: FlowEdge[]
  width?: number
  height?: number
  className?: string
  selectedId?: string | null
  onNodeClick?: (id: string) => void
  onNodeMove?: (id: string, x: number, y: number) => void
  /** 拖拽开始（记 undo 快照用）/ 结束（提交一次历史） */
  onNodeDragStart?: (id: string) => void
  onNodeDragEnd?: (id: string) => void
  /** 点击连线（删除连线）/ 连接模式下点节点 */
  onEdgeClick?: (edge: FlowEdge) => void
  /** 连接模式：点第一个节点为起点、点第二个节点建立连线 */
  connectMode?: boolean
  connectFrom?: string | null
  zoomable?: boolean
}) {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  const svgRef = useRef<SVGSVGElement | null>(null)
  const dragRef = useRef<{ id: string; startX: number; startY: number; ox: number; oy: number; moved: boolean } | null>(null)
  const [scale, setScale] = useState(1)
  const [tx, setTx] = useState(0)
  const [ty, setTy] = useState(0)
  const [panning, setPanning] = useState(false)
  const viewRef = useRef({ scale: 1, tx: 0, ty: 0, dragging: false, sx: 0, sy: 0 })
  useEffect(() => { viewRef.current.scale = scale; viewRef.current.tx = tx; viewRef.current.ty = ty }, [scale, tx, ty])

  /** 浏览器坐标 → viewBox 坐标（兼容 SVG 缩放） */
  function toViewBox(e: React.PointerEvent | React.MouseEvent): { x: number; y: number } {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    return { x: ((e.clientX - rect.left) / rect.width) * width, y: ((e.clientY - rect.top) / rect.height) * height }
  }
  /** 视图坐标 → 画布内容坐标（反算 translate + scale） */
  function toContent(vx: number, vy: number): { x: number; y: number } {
    const v = viewRef.current
    return { x: (vx - v.tx) / v.scale, y: (vy - v.ty) / v.scale }
  }
  function clamp(s: number) { return Math.min(4, Math.max(0.3, s)) }

  // zoomable：原生 wheel/mouse 监听（SVG 上 React 合成事件易丢），空白区域按下才平移
  useEffect(() => {
    if (!zoomable) return
    const svg = svgRef.current
    if (!svg) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const v = viewRef.current
      const next = clamp(v.scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12))
      const rect = svg!.getBoundingClientRect()
      const px = ((e.clientX - rect.left) / rect.width) * width
      const py = ((e.clientY - rect.top) / rect.height) * height
      const k = next / v.scale
      setTx(px - (px - v.tx) * k)
      setTy(py - (py - v.ty) * k)
      setScale(next)
    }
    function onDown(e: MouseEvent) {
      const t = e.target as Element
      // 节点、按钮、控件不触发平移
      if (t.closest('[data-flow-node]') || t.closest('button')) return
      viewRef.current.dragging = true
      viewRef.current.sx = e.clientX
      viewRef.current.sy = e.clientY
      setPanning(true)
    }
    function onMove(e: MouseEvent) {
      const v = viewRef.current
      if (!v.dragging) return
      const dx = e.clientX - v.sx
      const dy = e.clientY - v.sy
      if (!dx && !dy) return
      v.sx = e.clientX; v.sy = e.clientY
      // 屏幕像素 → viewBox 单位
      const rect = svg!.getBoundingClientRect()
      setTx((val) => val + (dx / rect.width) * width)
      setTy((val) => val + (dy / rect.height) * height)
    }
    function onUp() {
      if (!viewRef.current.dragging) return
      viewRef.current.dragging = false
      setPanning(false)
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    svg.addEventListener('mousedown', onDown)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      svg.removeEventListener('wheel', onWheel)
      svg.removeEventListener('mousedown', onDown)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [zoomable, width, height])

  function zoomBy(factor: number) { setScale((s) => clamp(s * factor)) }
  function resetView() { setScale(1); setTx(0); setTy(0) }

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
    <div className={cn('canvas-grid relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50/50', zoomable && (panning ? 'cursor-grabbing' : 'cursor-grab'), className)}>
      <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" style={{ minHeight: 200, display: 'block' }}>
        <defs>
          <marker id="flow-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 8 4 L 0 8 z" fill="#94a3b8" />
          </marker>
        </defs>
        <g transform={`translate(${tx} ${ty}) scale(${scale})`}>
          {edges.map((e, i) => {
            const from = nodeMap.get(e.from)
            const to = nodeMap.get(e.to)
            if (!from || !to) return null
            return (
              <g key={i} className={onEdgeClick ? 'cursor-pointer' : undefined}>
                <path
                  d={edgePath(from, to)}
                  fill="none"
                  stroke={e.kind === 'yes' ? '#10b981' : e.kind === 'no' ? '#f59e0b' : '#94a3b8'}
                  strokeWidth={e.kind ? 2 : 1.5}
                  strokeDasharray={e.dashed || e.kind === 'no' ? '5 4' : undefined}
                  markerEnd="url(#flow-arrow)"
                />
                {onEdgeClick && (
                  <path
                    d={edgePath(from, to)}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={14}
                    onClick={(ev) => { ev.stopPropagation(); onEdgeClick(e) }}
                  >
                    <title>点击删除此连线</title>
                  </path>
                )}
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
                  data-flow-node
                  onPointerDown={(e) => {
                    if (!onNodeMove) return
                    const p = toViewBox(e)
                    const c = toContent(p.x, p.y)
                    dragRef.current = { id: n.id, startX: c.x, startY: c.y, ox: n.x, oy: n.y, moved: false }
                    onNodeDragStart?.(n.id)
                    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
                  }}
                  onPointerMove={(e) => {
                    const d = dragRef.current
                    if (!d || d.id !== n.id || !onNodeMove) return
                    const p = toViewBox(e)
                    const c = toContent(p.x, p.y)
                    const dx = c.x - d.startX
                    const dy = c.y - d.startY
                    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
                    if (d.moved) onNodeMove(n.id, Math.max(0, Math.round(d.ox + dx)), Math.max(0, Math.round(d.oy + dy)))
                  }}
                  onPointerUp={() => {
                    const d = dragRef.current
                    if (d?.moved) onNodeDragEnd?.(n.id)
                    dragRef.current = null
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    const d = dragRef.current
                    if (d?.moved) return
                    // 连接模式：点节点作为连线起点/终点（由页面处理），不进入属性编辑
                    if (connectMode) { onNodeClick?.(n.id); return }
                    onNodeClick?.(n.id)
                  }}
                  className={cn(
                    'relative flex h-full items-center gap-2.5 rounded-xl border bg-white px-3 shadow-card transition-shadow',
                    selected ? 'border-brand-500 ring-2 ring-brand-200' : n.status === 'err' ? 'border-red-300' : n.status === 'warn' ? 'border-amber-300' : 'border-slate-200',
                    connectMode && 'ring-2 ring-violet-300',
                    connectFrom === n.id && 'border-violet-500 ring-2 ring-violet-400',
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
        </g>
      </svg>

      {zoomable && (
        <>
          <div className="absolute right-2 top-2 z-20 flex flex-col gap-1 rounded-lg border border-slate-200 bg-white/95 p-1 shadow-card">
            <button onClick={() => zoomBy(1.25)} title="放大" className="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-brand-600"><ZoomIn size={15} /></button>
            <button onClick={() => zoomBy(1 / 1.25)} title="缩小" className="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-brand-600"><ZoomOut size={15} /></button>
            <button onClick={resetView} title="重置视图" className="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-brand-600"><Maximize2 size={14} /></button>
          </div>
          <div className="absolute bottom-2 right-2 z-20 rounded-md border border-slate-200 bg-white/95 px-2 py-1 text-[11px] text-slate-500 shadow-card">{Math.round(scale * 100)}%</div>
          <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-1 rounded-md bg-white/85 px-2 py-1 text-[11px] text-slate-400">
            <Move size={11} /> 滚轮缩放 · 空白拖拽平移 · 节点可点选/拖动
          </div>
        </>
      )}
    </div>
  )
}
