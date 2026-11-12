import { Flag, CircleCheck, CircleDashed, Clock3 } from 'lucide-react'
import PageShell from '@/components/ui/PageShell'
import { Card, CardHeader } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { ProgressBar } from '@/components/ui/Misc'
import DataTable from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { NAV_GROUPS } from '@/config/nav'
import { PHASES, statusOf, statusCount, computePhaseProgress, PAGE_STATUS, type PageStatusInfo } from '@/config/status'
import { cn } from '@/lib/utils'

/**
 * 升级触发条件：架构演进的交付文档 / 规划清单（含预估工时），
 * 非运行时指标、非实时统计；仅作选型参考，不随系统状态变化。
 */
const UPGRADE_TRIGGERS = [
  { scene: '≥3 人并发写 / 多实例部署', action: 'SQLite → PostgreSQL', cost: '1-2 天' },
  { scene: '知识分块 >20 万 / 检索 P95>200ms', action: '内存向量 → sqlite-vec / pgvector', cost: '1 天' },
  { scene: '接企业统一登录', action: 'JWT → OIDC/LDAP + 会话表', cost: '1-2 天' },
  { scene: '正式多人上线', action: '单进程 → PM2 / Docker', cost: '0.5-1 天' },
  { scene: '文档高保真解析', action: '引入 Tika / 云解析适配层', cost: '1 天' },
]

interface RoadRow {
  path: string
  name: string
  group: string
  benchmark: string
  status: PageStatusInfo | undefined
}

/** 实现进度：各功能阶段与状态的总路线图（随 status.ts 自动更新） */
export default function Roadmap() {
  const cnt = statusCount()
  const progress = computePhaseProgress()
  const rows: RoadRow[] = NAV_GROUPS.flatMap((g) =>
    g.items.map((it) => ({ path: it.path, name: it.name, group: g.group, benchmark: it.benchmark, status: statusOf(it.path) })),
  )
  const livePct = Math.round((cnt.live / cnt.total) * 100)
  // 阶段绿标按真实进度派生：done 的判定与 status.ts 的 computePhaseProgress() 完全一致（该阶段页面全部为 live）
  const donePhases = PHASES.filter((p) => progress.get(p.id)?.done)
  const uncoveredRows = rows.filter((r) => !r.status)
  const uncovered = uncoveredRows.length

  return (
    <PageShell
      icon={Flag}
      title="实现进度"
      subtitle="第二阶段功能实现的总路线图：每个页面的阶段与状态在此汇总，并同步显示在各页徽章上"
      benchmark="交付管理"
      features={[
        '状态单一事实来源：src/config/status.ts，改一处全站同步（页面徽章/应用中心圆点/本页）',
        '三态标记：已实现（真实读写）/ 部分实现 / 原型演示（含目标阶段）',
        '阶段推进：P0 基建 → P1 身份权限 → … → P10 长尾，每阶段可独立验收',
        '升级触发条件公示（升级规划 / 预估，非运行时指标）：数据库 / 向量 / 认证 / 部署的演进路线与预估成本',
      ]}
    >
      {/* 总览统计 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="flex flex-col justify-between">
          <div className="text-xs text-slate-400">总体进度（已实现页面）</div>
          <div className="mt-2 text-2xl font-bold text-slate-900">{livePct}%</div>
          <ProgressBar pct={livePct} className="mt-2" />
          <div className="mt-1.5 text-[11px] text-slate-400">{cnt.live} / {cnt.total} 个页面已接入真实逻辑</div>
        </Card>
        <Card>
          <div className="text-xs text-slate-400">已实现</div>
          <div className="mt-1 flex items-baseline gap-1"><span className="text-2xl font-bold text-emerald-600">{cnt.live}</span><span className="text-xs text-slate-400">页</span></div>
          <div className="mt-2 flex flex-wrap gap-1">
            {donePhases.length > 0 ? (
              donePhases.map((p) => <Badge key={p.id} color="green">{p.id} {p.name}</Badge>)
            ) : (
              <span className="text-[11px] text-slate-400">暂无全部完成的阶段</span>
            )}
          </div>
        </Card>
        <Card>
          <div className="text-xs text-slate-400">部分实现</div>
          <div className="mt-1 flex items-baseline gap-1"><span className="text-2xl font-bold text-amber-500">{cnt.partial}</span><span className="text-xs text-slate-400">页</span></div>
          <div className="mt-2 text-[11px] text-slate-400">功能可用但尚未全量接真</div>
        </Card>
        <Card>
          <div className="text-xs text-slate-400">原型演示</div>
          <div className="mt-1 flex items-baseline gap-1"><span className="text-2xl font-bold text-slate-500">{cnt.mock}</span><span className="text-xs text-slate-400">页</span></div>
          <div className="mt-2 text-[11px] text-slate-400">已标注目标阶段，按计划逐页接入</div>
        </Card>
      </div>

      {/* 阶段计划 */}
      <Card>
        <CardHeader title="分阶段计划" desc="每阶段 = 可独立验收的闭环；完成后该阶段页面状态自动更新（进度与绿标均由 computePhaseProgress() 实时派生）" />
        {uncovered > 0 ? (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] leading-5 text-amber-700">
            <Flag size={14} className="mt-0.5 shrink-0" />
            有 {uncovered} 个导航页面尚未在本表登记状态：{uncoveredRows.map((r) => r.name).join('、')}。请在 src/config/status.ts 补齐，避免阶段进度统计遗漏。
          </div>
        ) : (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-[12px] text-emerald-700">
            <CircleCheck size={14} /> 导航中全部 {rows.length} 个页面均已在状态表登记，阶段进度统计无遗漏。
          </div>
        )}
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
          {PHASES.map((p) => {
            const pages = rows.filter((r) => r.status?.phase === p.id)
            const pr = progress.get(p.id)
            return (
              <div key={p.id} className={cn('rounded-xl border p-3.5', pr?.done ? 'border-emerald-200 bg-emerald-50/40' : pr && pr.live > 0 ? 'border-amber-200 bg-amber-50/30' : 'border-slate-200')}>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {pr?.done ? <CircleCheck size={15} className="text-emerald-500" /> : pr && pr.live > 0 ? <CircleDashed size={15} className="text-amber-500" /> : <CircleDashed size={15} className="text-slate-300" />}
                    <span className="text-[13px] font-bold text-slate-800">{p.id} {p.name}</span>
                  </div>
                  {pr?.done ? (
                    <Badge color="green">全部已实现</Badge>
                  ) : pr && pr.live + pr.partial > 0 ? (
                    <Badge color="amber">{pr.pct}%</Badge>
                  ) : (
                    <Badge color="slate"><Clock3 size={10} className="mr-0.5" />待开始</Badge>
                  )}
                </div>
                <div className="text-[11px] leading-5 text-slate-500">{p.goal}</div>
                {pr && pr.total > 0 && (
                  <div className="mt-2">
                    <ProgressBar pct={pr.pct} color={pr.done ? 'bg-emerald-500' : pr.live > 0 ? 'bg-amber-400' : 'bg-slate-200'} />
                    <div className="mt-1 text-[10px] text-slate-400">
                      已实现 {pr.live} / 部分 {pr.partial} / 演示 {pr.mock}（共 {pr.total} 页）
                    </div>
                  </div>
                )}
                {pages.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {pages.map((r) => (
                      <span
                        key={r.path}
                        className={cn(
                          'rounded border px-1.5 py-0.5 text-[10px]',
                          r.status?.status === 'live' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : r.status?.status === 'partial' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-slate-200 bg-white text-slate-500',
                        )}
                      >
                        {r.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </Card>

      {/* 全量状态表 */}
      <Card padding={false}>
        <div className="border-b border-slate-100 p-4">
          <CardHeader className="mb-0" title="全部页面状态" desc="与各页徽章同源同步" />
        </div>
        <div className="p-4">
          <DataTable
            rows={rows}
            rowKey={(r) => r.path}
            columns={[
              { key: 'group', header: '分组', cell: (r) => <Badge color="slate">{r.group}</Badge> },
              { key: 'name', header: '页面', cell: (r) => <span className="font-medium text-slate-800">{r.name}</span> },
              { key: 'benchmark', header: '能力域', cell: (r) => <span className="text-xs text-slate-400">{r.benchmark}</span> },
              { key: 'path', header: '路由', cell: (r) => <code className="font-mono text-[11px] text-slate-400">{r.path}</code> },
              { key: 'status', header: '状态', cell: (r) => (r.status ? <StatusBadge info={r.status} /> : <span className="text-slate-300">—</span>) },
              { key: 'note', header: '说明', cell: (r) => <span className="text-xs text-slate-400">{r.status?.note ?? (r.status?.status === 'mock' ? '按计划接入' : '')}</span> },
            ]}
          />
        </div>
      </Card>

      {/* 升级路径 */}
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2">支持系统升级触发条件 <Badge color="amber">升级规划 / 预估 · 非运行时指标</Badge></span>}
          desc="以下为架构演进的交付文档（规划清单，非实时统计）：选型以本地零运维优先，出现相应场景时按此升级，成本为预估工时"
        />
        <DataTable
          dense
          rows={UPGRADE_TRIGGERS}
          columns={[
            { key: 'scene', header: '触发场景', cell: (r) => <span className="text-[13px] font-medium text-slate-700">{r.scene}</span> },
            { key: 'action', header: '升级动作', cell: (r) => <Badge color="blue">{r.action}</Badge> },
            { key: 'cost', header: '预估成本', align: 'right' },
          ]}
        />
      </Card>
    </PageShell>
  )
}
