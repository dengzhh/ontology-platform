import { useState } from 'react'
import { AlertTriangle, Building2, Factory, Flame, Loader2, Map, MapPin, Plus, RefreshCw, Route, Truck, type LucideIcon } from 'lucide-react'
import PageShell from '@/components/ui/PageShell'
import Btn from '@/components/ui/Btn'
import { Card, CardHeader } from '@/components/ui/Card'
import MapView, { type MapArc, type MapPoint } from '@/components/canvas/MapView'
import { cn } from '@/lib/utils'
import { useApi } from '@/lib/useApi'

/** GET /api/p10plus/map 的真实返回（坐标来自 objects.values.city，弧线来自 objectLinks） */
interface ApiPoint {
  x: number
  y: number
  label: string
  value: string
  color: string
  typeName: string
  hot?: boolean
}
interface MapResp {
  points: ApiPoint[]
  links: { from: string; to: string }[]
  typeCount: number
  objectCount: number
}

/** MapView 的 viewBox 尺寸，用于把真实点位坐标换算成热力层的百分比位置 */
const MAP_W = 1100
const MAP_H = 480

const FLOW_KEY = 'flow'
const HEAT_KEY = 'heat'
const typeKey = (name: string) => `type:${name}`

/** 按真实对象类型名挑选一个图标（仅用于图层列表的视觉表达，不参与数据） */
function layerIcon(name: string): LucideIcon {
  if (name.includes('工厂') || name.includes('设备') || name.includes('生产')) return Factory
  if (name.includes('客户')) return Building2
  if (name.includes('供应商') || name.includes('物料') || name.includes('物流')) return Truck
  return MapPin
}

interface LayerRow {
  key: string
  label: string
  icon: LucideIcon
  count: number
}

/** Map：地理空间分析—— 点位/流向/热力/统计全部来自真实接口 */
export default function MapPage() {
  const mapQ = useApi<MapResp>('/p10plus/map')
  const data = mapQ.data
  const points = data?.points ?? []
  const links = data?.links ?? []

  // off[key] = true 表示该图层关闭；未出现的 key 默认开启。heat 默认关闭。
  const [off, setOff] = useState<Record<string, boolean>>({ [HEAT_KEY]: true })
  const isOn = (key: string) => !off[key]
  const toggle = (key: string) => setOff((prev) => ({ ...prev, [key]: !prev[key] }))

  const [toast, setToast] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null)
  const notify = (text: string, kind: 'ok' | 'err' = 'ok') => {
    setToast({ text, kind })
    setTimeout(() => setToast(null), 2800)
  }

  function reload() {
    mapQ.reload()
    notify('已重新拉取 /p10plus/map 真实数据')
  }

  // 图层按真实数据动态生成：每个对象类型一个图层 + 物流流向 + 热力
  const typeNames = Array.from(new Set(points.map((p) => p.typeName)))
  const layers: LayerRow[] = [
    ...typeNames.map((name) => ({
      key: typeKey(name),
      label: name,
      icon: layerIcon(name),
      count: points.filter((p) => p.typeName === name).length,
    })),
    { key: FLOW_KEY, label: '物流流向', icon: Route, count: links.length },
    { key: HEAT_KEY, label: '热力', icon: Flame, count: points.filter((p) => p.hot).length },
  ]

  // 当前显示的点位（按图层过滤）；热力层开启时 hot 点位才带 hot 标记 → MapView 才发光
  const heatOn = isOn(HEAT_KEY)
  const visiblePoints: MapPoint[] = points
    .filter((p) => isOn(typeKey(p.typeName)))
    .map((p) => ({
      x: p.x,
      y: p.y,
      label: p.label,
      value: p.value,
      color: p.color,
      hot: p.hot && heatOn,
    }))
  const visibleArcs: MapArc[] = isOn(FLOW_KEY) ? links.map((l) => ({ from: l.from, to: l.to })) : []

  // 统计联动：全部由「当前显示图层」实时计算，勾选任一层数字即变化
  const labelSet = new Set(visiblePoints.map((p) => p.label))
  const arcCount = visibleArcs.filter((a) => labelSet.has(a.from) && labelSet.has(a.to)).length
  const anomalyCount = points.filter((p) => isOn(typeKey(p.typeName)) && p.hot).length
  const stats = [
    { icon: MapPin, label: '显示点位', value: visiblePoints.length, accent: 'bg-brand-50 text-brand-600' },
    { icon: Route, label: '显示流向', value: arcCount, accent: 'bg-amber-50 text-amber-600' },
    { icon: AlertTriangle, label: '异常点位(hot)', value: anomalyCount, accent: 'bg-red-50 text-red-500' },
  ]

  // 热力层只由 hot 点位生成光晕，位置取真实点位坐标（不再写死渐变位置）
  const hotPoints = points.filter((p) => p.hot)
  const heatBackground = visiblePoints
    .filter((p) => p.hot)
    .map((p) => `radial-gradient(circle at ${((p.x / MAP_W) * 100).toFixed(1)}% ${((p.y / MAP_H) * 100).toFixed(1)}%, rgba(239,68,68,0.18), transparent 12%)`)
    .join(', ')

  return (
    <PageShell
      icon={Map}
      title="Map 地理空间分析"
      subtitle="在地理画布中查看真实对象的城市分布、关联流向与异常点位 —— 数据来自 /p10plus/map"
      benchmark="地理空间"
      features={[
        '真实数据：点位按 objects.values.city 映射坐标，弧线由 objectLinks 生成',
        '图层管理：按真实对象类型动态生成图层，叠加物流流向 / 热力开关',
        '流向弧线：对象关联生成弧线，端点随所属图层显隐联动',
        '热力叠加：仅 hot 异常点位发光，光晕按真实点位坐标渲染',
        '统计联动：显示点位 / 显示流向 / 异常点位随勾选图层实时重算',
      ]}
      actions={
        <>
          <Btn size="sm" onClick={reload} disabled={mapQ.loading}><RefreshCw size={13} /> 刷新数据</Btn>
          <Btn
            size="sm"
            variant="primary"
            disabled
            title="新建分析视图待后续版本（当前无对应后端接口）"
          >
            <Plus size={14} /> 新建分析视图
          </Btn>
        </>
      }
    >
      {/* 错误 toast */}
      {mapQ.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700">
          加载失败：{mapQ.error}
        </div>
      )}
      {toast && (
        <div className={cn('rounded-lg border px-4 py-2.5 text-sm font-medium', toast.kind === 'err' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700')}>
          {toast.text}
        </div>
      )}

      {mapQ.loading && !data ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" /> 加载真实地图数据…</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[228px_minmax(0,1fr)]">
          {/* 左侧图层面板 */}
          <div className="flex flex-col gap-4">
            <Card className="h-fit">
              <CardHeader title="图层" desc="勾选控制地图叠加内容" />
              <div className="space-y-0.5">
                {layers.map((l) => (
                  <label key={l.key} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={isOn(l.key)}
                      onChange={() => toggle(l.key)}
                      className="h-3.5 w-3.5 rounded border-slate-300 accent-brand-600"
                    />
                    <l.icon size={14} className="text-slate-400" />
                    <span className={cn('flex-1 text-[13px] font-medium', isOn(l.key) ? 'text-slate-700' : 'text-slate-400')}>
                      {l.label}
                    </span>
                    <span className="text-[11px] text-slate-400">{isOn(l.key) ? l.count : '—'}</span>
                  </label>
                ))}
              </div>
              <div className="mt-2 border-t border-slate-100 pt-2.5 text-[11px] leading-4 text-slate-400">
                当前空间共 {data?.typeCount ?? 0} 类对象 / {data?.objectCount ?? 0} 个实例，其中 {points.length} 个含地理坐标、{links.length} 条对象关联。
              </div>
              <div className="mt-1.5 text-[11px] leading-4 text-slate-400">
                热力图层仅对 hot 异常点位发光，光晕位置取自真实点位坐标。
              </div>
              <div className="mt-1.5 text-[11px] leading-4 text-slate-400">
                说明：「新建分析视图」待后续版本（暂无创建接口）。
              </div>
            </Card>

            <Card className="h-fit border-red-100 bg-red-50/50">
              <div className="flex items-center gap-1.5 text-[12px] font-semibold text-red-600">
                <AlertTriangle size={13} /> 异常点位（{hotPoints.length}）
              </div>
              {hotPoints.length === 0 ? (
                <div className="mt-1.5 text-[11px] leading-4 text-slate-500">当前接口返回的地理点位中暂无 hot 异常点位。</div>
              ) : (
                <div className="mt-1.5 space-y-1">
                  {hotPoints.map((p) => (
                    <div key={p.label} className="text-[11px] leading-4 text-slate-500">
                      <span className="font-medium text-slate-700">{p.label}</span>（{p.typeName}）{p.value ? ` · ${p.value}` : ''}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* 主区：地图 + 统计条 */}
          <div className="flex min-w-0 flex-col gap-4">
            <div className="relative">
              <MapView points={visiblePoints} arcs={visibleArcs} width={MAP_W} height={MAP_H} />
              {heatOn && heatBackground && (
                <div
                  className="pointer-events-none absolute inset-0 rounded-lg"
                  style={{ background: heatBackground }}
                />
              )}
            </div>

            {/* 底部统计条：数值随当前显示图层实时计算 */}
            <Card padding={false}>
              <div className="grid grid-cols-3 divide-x divide-slate-100">
                {stats.map((s) => (
                  <div key={s.label} className="flex items-center gap-3 p-3.5">
                    <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', s.accent)}>
                      <s.icon size={16} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-lg font-bold leading-6 text-slate-900">{s.value}</div>
                      <div className="text-[11px] text-slate-400">{s.label}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}
    </PageShell>
  )
}
