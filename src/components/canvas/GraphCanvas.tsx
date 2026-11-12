import { cn } from '@/lib/utils'
import ZoomableCanvas from './ZoomableCanvas'

export interface GraphNode {
  id: string
  x: number
  y: number
  label: string
  sub?: string
  /** 十六进制颜色 */
  color?: string
  size?: number
}

export interface GraphLink {
  source: string
  target: string
  label?: string
}

/**
 * 关系图谱画布（SVG）：彩色节点 + 连线。
 * 用于 Vertex 关系图谱、血缘等页面。节点坐标由页面给定（静态布局示意）。
 *
 * zoomable=true 时用 ZoomableCanvas 包裹，支持滚轮缩放 / 拖拽平移 / 复位，
 * 解决节点密集时文字重叠、看不清的问题。
 */
export default function GraphCanvas({
  nodes,
  links,
  width = 1000,
  height = 520,
  legend,
  zoomable = false,
  viewportHeight,
  className,
}: {
  nodes: GraphNode[]
  links: GraphLink[]
  width?: number
  height?: number
  legend?: { label: string; color: string }[]
  /** 开启缩放/平移（密集图谱建议开启） */
  zoomable?: boolean
  /** 缩放模式下的容器可视高度（px） */
  viewportHeight?: number
  className?: string
}) {
  const map = new Map(nodes.map((n) => [n.id, n]))

  const svgContent = (
    <>
      {links.map((l, i) => {
        const a = map.get(l.source)
        const b = map.get(l.target)
        if (!a || !b) return null
        const mx = (a.x + b.x) / 2
        const my = (a.y + b.y) / 2
        return (
          <g key={i}>
            <path d={`M ${a.x} ${a.y} Q ${mx + (a.y - b.y) * 0.12} ${my}, ${b.x} ${b.y}`} fill="none" stroke="#cbd5e1" strokeWidth={1.5} />
            {l.label && (
              <text x={mx} y={my - 4} textAnchor="middle" fontSize={9.5} fill="#94a3b8" paintOrder="stroke" stroke="#fff" strokeWidth={3}>
                {l.label}
              </text>
            )}
          </g>
        )
      })}
      {nodes.map((n) => {
        const r = n.size ?? 26
        // 长标签截断，避免跨列文字互相压盖
        const label = n.label.length > 12 ? n.label.slice(0, 11) + '…' : n.label
        return (
          <g key={n.id} data-node={n.id}>
            <circle cx={n.x} cy={n.y} r={r} fill={n.color ?? '#3b82f6'} fillOpacity={0.14} />
            <circle cx={n.x} cy={n.y} r={r * 0.55} fill={n.color ?? '#3b82f6'} stroke="#fff" strokeWidth={2} />
            {/* 白底描边 halo：文字压在连线/相邻节点上时仍清晰 */}
            <text x={n.x} y={n.y + r + 15} textAnchor="middle" fontSize={11.5} fontWeight={600} fill="#334155" paintOrder="stroke" stroke="#fff" strokeWidth={3.5}>
              {label}
            </text>
            {n.sub && (
              <text x={n.x} y={n.y + r + 28} textAnchor="middle" fontSize={9.5} fill="#94a3b8" paintOrder="stroke" stroke="#fff" strokeWidth={3}>
                {n.sub}
              </text>
            )}
          </g>
        )
      })}
    </>
  )

  if (zoomable) {
    return (
      <div className={cn('relative', className)}>
        <ZoomableCanvas width={width} height={height} viewportHeight={viewportHeight ?? 560} className="canvas-grid">
          {svgContent}
        </ZoomableCanvas>
        {legend && (
          <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-col gap-1.5 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 shadow-card">
            {legend.map((l, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[11px] text-slate-600">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: l.color }} />
                {l.label}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={cn('canvas-grid relative overflow-hidden rounded-lg border border-slate-200 bg-white', className)}>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" style={{ minHeight: 240 }}>
        {svgContent}
      </svg>
      {legend && (
        <div className="absolute left-3 top-3 flex flex-col gap-1.5 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 shadow-card">
          {legend.map((l, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[11px] text-slate-600">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: l.color }} />
              {l.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
