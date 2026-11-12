import { Link } from 'react-router-dom'
import { Gauge, Boxes, Link2, Zap, FileText, Activity, ShieldAlert, Sparkles, Bell, ArrowRight, Loader2, Database, GitBranch, Clock3, RefreshCw } from 'lucide-react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import PageShell from '@/components/ui/PageShell'
import StatCard from '@/components/ui/StatCard'
import { Badge, type BadgeColor } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import { Avatar, ProgressBar } from '@/components/ui/Misc'
import Timeline from '@/components/ui/Timeline'
import Btn from '@/components/ui/Btn'
import { useApi } from '@/lib/useApi'
import { useUI } from '@/store/ui'
import { cn } from '@/lib/utils'

interface OverviewResp {
  space: { id: string; name: string; kind: string }
  stats: {
    objectInstances: number
    typeCount: number
    linkInstances: number
    actionTypes: number
    documents: number
    chunks: number
    activeRules: number
    pendingApprovals: number
    aiCalls: number
    unreadNotifications: number
    auditToday: number
  }
  typeDist: { name: string; color: string; typeId: string; count: number }[]
  trend: { day: string; queries: number; ai: number; actions: number }[]
  enumDist: { typeName: string; field: string; items: { name: string; count: number }[] }[]
  recentAudit: { actor: string; action: string; target: string; createdAt: string }[]
  systemHealth: { name: string; metric: string; ok: boolean }[]
}

const QUICK_LINKS = [
  { to: '/apps/workshop', icon: Sparkles, label: '搭建看板' },
  { to: '/ontology/manager', icon: Boxes, label: '建模' },
  { to: '/knowledge/library', icon: FileText, label: '入库文档' },
  { to: '/aip/agents', icon: Zap, label: 'Agent' },
  { to: '/gov/audit', icon: Activity, label: '审计' },
  { to: '/admin/roadmap', icon: Clock3, label: '进度' },
]

/** 平台仪表盘（P9 真实数据）：空间统计、类型分布、趋势、枚举分析、系统健康 */
export default function Overview() {
  const { setNotifOpen } = useUI()
  const q = useApi<OverviewResp>('/dashboard/overview')
  const d = q.data
  const s = d?.stats
  const healthColor = (v: number, total: number) => (total === 0 ? 0 : Math.round((v / total) * 100))

  if (q.loading) {
    return (
      <div className="flex min-h-full items-center justify-center gap-2 text-sm text-slate-400">
        <Loader2 size={16} className="animate-spin" /> 加载仪表盘数据…
      </div>
    )
  }
  if (!d) return null

  const totalTypes = d.typeDist.reduce((sum, t) => sum + t.count, 0)

  return (
    <PageShell
      icon={Gauge}
      title="平台仪表盘"
      subtitle={`空间「${d.space.name}」的实时运行概览 —— 对象、知识、AI 与治理全打通`}
      benchmark="运行总览"
      features={['空间统计卡：对象/链接/动作/知识/AI/审计六维指标', '近7天趋势：查询/AI/动作活动量', '对象类型分布：按类型着色的横向条形图', '枚举字段分析：状态/类别等维度的值分布', '系统健康：本体/知识/自动化来自真实数据，AI 网关为真实可达性探测']}
      actions={<Btn size="sm" onClick={() => q.reload()}><RefreshCw size={13} /> 刷新</Btn>}
    >
      {/* 统计卡 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="对象实例" value={s!.objectInstances.toLocaleString()} icon={Boxes} footer={`${s!.typeCount} 个类型`} />
        <StatCard label="链接实例" value={s!.linkInstances} icon={Link2} iconClass="bg-violet-50 text-violet-600" footer="对象关联网络" />
        <StatCard label="动作类型" value={s!.actionTypes} icon={Zap} iconClass="bg-amber-50 text-amber-600" footer={`${s!.pendingApprovals} 待审批`} />
        <StatCard label="知识文档" value={s!.documents} icon={FileText} iconClass="bg-cyan-50 text-cyan-600" footer={`${s!.chunks} 个分块`} />
        <StatCard label="AI 调用" value={s!.aiCalls} icon={Sparkles} iconClass="bg-violet-50 text-violet-500" footer={`${s!.activeRules} 条规则运行中`} />
        <StatCard label="今日审计" value={s!.auditToday} icon={Activity} iconClass="bg-emerald-50 text-emerald-600" footer={`${s!.unreadNotifications} 未读通知`} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        {/* 左列 */}
        <div className="min-w-0 space-y-4">
          {/* 近 7 天趋势 */}
          <Card>
            <CardHeader title="近 7 天活动趋势" desc="本体查询 / AI 调用 / 动作执行（审计日志统计）" />
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={d.trend} margin={{ top: 5, right: 12, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gQ" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gA" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                  <Area type="monotone" dataKey="queries" stroke="#3b82f6" fill="url(#gQ)" strokeWidth={1.5} name="查询" />
                  <Area type="monotone" dataKey="ai" stroke="#8b5cf6" fill="url(#gA)" strokeWidth={1.5} name="AI" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* 对象类型分布 */}
          <Card>
            <CardHeader title="对象类型分布" desc="当前空间的对象实例统计" actions={<Link to="/ontology/explorer" className="text-xs font-medium text-brand-600 hover:text-brand-700">对象浏览器 →</Link>} />
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.typeDist.slice(0, 10)} layout="vertical" margin={{ top: 0, right: 12, left: 40, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#475569' }} axisLine={false} tickLine={false} width={80} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={16}>
                    {d.typeDist.slice(0, 10).map((t, i) => <Cell key={i} fill={t.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* 枚举分布分析 */}
          {d.enumDist.length > 0 && (
            <Card>
              <CardHeader title="字段分布分析" desc="枚举字段的值分布（真实数据统计）" />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {d.enumDist.map((e, i) => (
                  <div key={i}>
                    <div className="mb-2 text-xs font-semibold text-slate-600">{e.typeName} · {e.field}</div>
                    <div className="space-y-1.5">
                      {e.items.map((item, j) => {
                        const total = e.items.reduce((s2, x) => s2 + x.count, 0)
                        const pct = total > 0 ? Math.round((item.count / total) * 100) : 0
                        return (
                          <div key={j} className="flex items-center gap-2">
                            <span className="w-16 shrink-0 truncate text-[11px] text-slate-500">{item.name}</span>
                            <ProgressBar pct={pct} color={pct > 60 ? 'bg-emerald-500' : pct > 30 ? 'bg-brand-500' : 'bg-slate-300'} className="flex-1" />
                            <span className="w-8 shrink-0 text-right text-[11px] text-slate-400">{item.count}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* 右列 */}
        <div className="min-w-0 space-y-4">
          {/* 系统健康 */}
          <Card>
            <CardHeader title="系统健康" desc="本体/索引/规则来自真实数据 · AI 网关按需探测（2.5s 超时）" />
            <div className="space-y-2.5">
              {d.systemHealth.map((h, i) => (
                <div key={i} className="flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2.5">
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', h.ok ? 'bg-emerald-500' : 'bg-amber-500')} />
                  <span className="flex-1 text-[13px] font-medium text-slate-700">{h.name}</span>
                  <span className="text-[11px] text-slate-400">{h.metric}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* 待处理审批 */}
          <Card>
            <CardHeader
              title="待处理审批"
              desc={`${s!.pendingApprovals} 条待审批`}
              actions={s!.pendingApprovals > 0 && <Link to="/gov/approvals" className="text-xs font-medium text-brand-600">去审批 →</Link>}
            />
            <div className="space-y-2">
              {s!.pendingApprovals === 0 && <div className="rounded-lg border border-dashed border-slate-200 p-3 text-center text-xs text-slate-400">暂无待审批</div>}
              {s!.pendingApprovals > 0 && (
                <Link to="/gov/approvals" className="flex items-center gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 hover:bg-amber-100/60">
                  <ShieldAlert size={16} className="shrink-0 text-amber-500" />
                  <span className="text-[13px] font-medium text-amber-700">{s!.pendingApprovals} 条审批等待处理</span>
                </Link>
              )}
            </div>
          </Card>

          {/* 最近审计 */}
          <Card>
            <CardHeader title="最近操作" desc="审计日志最新 5 条" actions={<Link to="/gov/audit" className="text-xs font-medium text-brand-600">全部 →</Link>} />
            <Timeline
              items={d.recentAudit.map((a, i) => ({
                time: a.createdAt,
                title: a.action,
                desc: a.target,
                color: (i % 3 === 0 ? 'blue' : i % 3 === 1 ? 'green' : 'slate') as BadgeColor,
              }))}
            />
          </Card>

          {/* 快捷入口 */}
          <Card>
            <CardHeader title="快捷操作" />
            <div className="grid grid-cols-3 gap-2">
              {QUICK_LINKS.map((l) => (
                <Link key={l.to} to={l.to} className="flex flex-col items-center gap-1.5 rounded-xl border border-slate-200 p-3 transition-colors hover:border-brand-300 hover:bg-brand-50/40">
                  <l.icon size={18} className="text-brand-600" />
                  <span className="text-[11px] font-medium text-slate-600">{l.label}</span>
                </Link>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </PageShell>
  )
}
