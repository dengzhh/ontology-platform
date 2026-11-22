import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ZoomIn, ZoomOut, Maximize2, Move } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * 可缩放平移的画布容器（SVG 图谱/拓扑通用）
 * - 滚轮缩放（以光标为中心）· 拖拽平移 · 控件放大/缩小/复位
 * 使用原生事件监听，避免 React 合成事件在 SVG 上冒泡丢失。
 */
export default function ZoomableCanvas({
  width,
  height,
  children,
  minScale = 0.3,
  maxScale = 4,
  className,
  viewportHeight,
  initialScale = 1,
}: {
  width: number
  height: number
  children: ReactNode
  minScale?: number
  maxScale?: number
  className?: string
  /** 容器可视高度（px）。不传则由 className 控制（如 h-[620px]） */
  viewportHeight?: number
  /** 初始缩放（复位也回到该值）。节点多的小图建议 >1，保证节点/标签可读 */
  initialScale?: number
}) {
  const initS = Math.min(maxScale, Math.max(minScale, initialScale))
  /** 以画布中心为锚点应用初始缩放（内容居中放大，而不是放大到左上角） */
  const centerT = (s: number) => ({ tx: (width / 2) * (1 - s), ty: (height / 2) * (1 - s) })
  const [scale, setScale] = useState(initS)
  const [tx, setTx] = useState(() => centerT(initS).tx)
  const [ty, setTy] = useState(() => centerT(initS).ty)
  const [panning, setPanning] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef({ scale, tx, ty, dragging: false, sx: 0, sy: 0 })

  // 同步最新状态供原生事件读取
  useEffect(() => {
    stateRef.current.scale = scale
    stateRef.current.tx = tx
    stateRef.current.ty = ty
  }, [scale, tx, ty])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return

    function clamp(s: number) {
      return Math.min(maxScale, Math.max(minScale, s))
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const st = stateRef.current
      const next = clamp(st.scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12))
      const rect = el!.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      const k = next / st.scale
      setTx(px - (px - st.tx) * k)
      setTy(py - (py - st.ty) * k)
      setScale(next)
    }

    function onDown(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (target.closest('[data-node]') || target.closest('button')) return
      stateRef.current.dragging = true
      stateRef.current.sx = e.clientX
      stateRef.current.sy = e.clientY
      setPanning(true)
    }

    function onMove(e: MouseEvent) {
      const st = stateRef.current
      if (!st.dragging) return
      const dx = e.clientX - st.sx
      const dy = e.clientY - st.sy
      if (dx === 0 && dy === 0) return
      st.sx = e.clientX
      st.sy = e.clientY
      setTx((v) => v + dx)
      setTy((v) => v + dy)
    }

    function onUp() {
      if (!stateRef.current.dragging) return
      stateRef.current.dragging = false
      setPanning(false)
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('mousedown', onDown)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('mousedown', onDown)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [minScale, maxScale])

  function zoomBy(factor: number) {
    setScale((s) => Math.min(maxScale, Math.max(minScale, s * factor)))
  }
  function reset() {
    setScale(initS)
    setTx(centerT(initS).tx)
    setTy(centerT(initS).ty)
  }

  const wrapStyle: CSSProperties | undefined = viewportHeight ? { height: viewportHeight } : undefined
  return (
    <div
      ref={wrapRef}
      style={wrapStyle}
      className={cn('relative select-none overflow-hidden rounded-xl border border-slate-200 bg-white', panning ? 'cursor-grabbing' : 'cursor-grab', className)}
    >
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${width} ${height}`}
        style={{ display: 'block' }}
      >
        <g transform={`translate(${tx} ${ty}) scale(${scale})`}>{children}</g>
      </svg>

      <div className="absolute right-3 top-3 z-20 flex flex-col gap-1 rounded-lg border border-slate-200 bg-white/95 p-1 shadow-card">
        <button onClick={() => zoomBy(1.25)} className="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-brand-600" title="放大">
          <ZoomIn size={15} />
        </button>
        <button onClick={() => zoomBy(1 / 1.25)} className="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-brand-600" title="缩小">
          <ZoomOut size={15} />
        </button>
        <button onClick={reset} className="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-brand-600" title="重置视图">
          <Maximize2 size={14} />
        </button>
      </div>

      <div className="absolute bottom-3 right-3 z-20 rounded-md border border-slate-200 bg-white/95 px-2 py-1 text-[11px] text-slate-500 shadow-card">
        {Math.round(scale * 100)}%
      </div>

      <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-1 rounded-md bg-white/85 px-2 py-1 text-[11px] text-slate-400">
        <Move size={11} /> 拖拽平移 · 滚轮缩放
      </div>
    </div>
  )
}
