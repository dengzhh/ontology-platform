import { cn } from '@/lib/utils'

export interface MapPoint {
  x: number
  y: number
  label: string
  value?: string
  /** 十六进制颜色 */
  color?: string
  hot?: boolean
}

export interface MapArc {
  from: string
  to: string
}

/**
 * 地理空间示意画布：抽象区域 + 城市节点 + 流向弧线。
 * 用于地理空间分析（Map）等页面。
 */
export default function MapView({
  points,
  arcs,
  width = 1000,
  height = 460,
  className,
}: {
  points: MapPoint[]
  arcs: MapArc[]
  width?: number
  height?: number
  className?: string
}) {
  const map = new Map(points.map((p) => [p.label, p]))
  return (
    <div className={cn('relative overflow-hidden rounded-lg border border-slate-200 bg-gradient-to-br from-brand-50/80 via-white to-cyan-50/60', className)}>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" style={{ minHeight: 260 }}>
        {/* 抽象区域块 */}
        <path d="M 90 90 Q 220 30 380 80 Q 500 40 620 95 Q 700 70 760 130 L 700 210 Q 560 190 430 225 Q 300 260 180 220 Q 80 180 90 90 Z" fill="#dbeafe" fillOpacity={0.55} stroke="#93c5fd" strokeDasharray="4 3" />
        <path d="M 240 300 Q 400 260 580 300 Q 700 330 720 400 Q 600 450 430 435 Q 280 420 220 380 Q 190 330 240 300 Z" fill="#cffafe" fillOpacity={0.5} stroke="#67e8f9" strokeDasharray="4 3" />
        <text x="420" y="150" fontSize="12" fill="#60a5fa">华东供应链圈</text>
        <text x="450" y="375" fontSize="12" fill="#22d3ee">华南制造带</text>

        {/* 流向弧线 */}
        {arcs.map((a, i) => {
          const f = map.get(a.from)
          const t = map.get(a.to)
          if (!f || !t) return null
          const mx = (f.x + t.x) / 2
          const my = Math.min(f.y, t.y) - 60
          return <path key={i} d={`M ${f.x} ${f.y} Q ${mx} ${my}, ${t.x} ${t.y}`} fill="none" stroke="#f59e0b" strokeWidth={1.6} strokeDasharray="6 4" />
        })}

        {/* 节点 */}
        {points.map((p, i) => (
          <g key={i}>
            {p.hot && <circle cx={p.x} cy={p.y} r={18} fill={p.color ?? '#ef4444'} fillOpacity={0.12} className="animate-pulse" />}
            <circle cx={p.x} cy={p.y} r={6} fill={p.color ?? '#3b82f6'} stroke="#fff" strokeWidth={2} />
            <text x={p.x} y={p.y - 11} textAnchor="middle" fontSize={11} fontWeight={600} fill="#334155">
              {p.label}
            </text>
            {p.value && (
              <text x={p.x} y={p.y + 19} textAnchor="middle" fontSize={9.5} fill={p.hot ? '#ef4444' : '#64748b'}>
                {p.value}
              </text>
            )}
          </g>
        ))}
      </svg>
      <div className="absolute bottom-3 right-3 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 shadow-card">
        <div className="mb-1 text-[11px] font-semibold text-slate-600">图例</div>
        <div className="flex flex-col gap-1 text-[11px] text-slate-500">
          <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-brand-500" />工厂 / 仓库</div>
          <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-red-500" />告警点位</div>
          <div className="flex items-center gap-1.5"><span className="h-0.5 w-4 border-t-2 border-dashed border-amber-500" />物流流向</div>
        </div>
      </div>
    </div>
  )
}
