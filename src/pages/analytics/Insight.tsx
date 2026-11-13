import { useState, type ReactNode } from 'react'
import { Filter, Lightbulb, Power, Share2, Sigma, UserRound, Wrench, type LucideIcon, Loader2 } from 'lucide-react'
import PageShell from '@/components/ui/PageShell'
import Btn from '@/components/ui/Btn'
import { Badge } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'

interface Step1 { type: string; count: number; avgHealth: number }
interface Step2 { code: string; type: string; downtime: number }
interface Step3 { no: string; priority: string; fault: string; status: string }
interface Step4 { name: string; skill: string; role: string }
interface InsightResp {
  spaceName: string
  generatedAt: string
  step1: Step1[]
  step2: Step2[]
  step3: Step3[]
  step4: Step4[]
  summary: { downtime: number; tickets: number; staff: number; devices: number; worst: string }
  totalDevices: number
}

/** Insight：路径式洞察分析（P5 接真）—— 五步路径基于当前空间真实对象聚合 */
export default function InsightPage() {
  const [step, setStep] = useState(4)
  const q = useApi<InsightResp>('/p10long/insight')
  const [toast, setToast] = useState('')
  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2600) }
  const data = q.data

  const STEPS: { icon: LucideIcon; title: string; desc: string }[] = [
    { icon: Filter, title: '筛选设备', desc: `当前空间 ${data?.totalDevices ?? 0} 台设备按类型分组` },
    { icon: Power, title: '筛选状态', desc: '状态 = 停机 / 维修' },
    { icon: Wrench, title: '关联工单', desc: '优先级 P0 / P1' },
    { icon: UserRound, title: '关联员工', desc: '参与处理工单的员工' },
    { icon: Sigma, title: '汇总影响', desc: '停机时长与影响面' },
  ]

  return (
    <PageShell
      icon={Lightbulb}
      title="路径分析"
      subtitle="多步筛选与跨对象关联自动汇总为结构化结论（真实本体对象）"
      benchmark="路径分析"
      features={[
        '路径式分析：以五步路径表达「筛选 → 关联 → 汇总」的完整分析逻辑',
        '真实数据：设备/工单/员工均来自当前空间的本体对象实例',
        '对象数徽章：每一步输出的对象集合规模一目了然，点击步骤即可回溯',
        '汇总结论：终点自动聚合停机时长、影响工单、涉及员工',
      ]}
      actions={
        <Btn size="sm" disabled={q.loading} onClick={() => { q.reload(); notify('已按最新本体数据重跑分析路径') }}>重新运行路径</Btn>
      }
    >
      {toast && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">{toast}</div>}
      {q.loading && <div className="flex items-center gap-2 py-10 text-sm text-slate-400"><Loader2 size={14} className="animate-spin" /> 正在对本体对象跑分析路径…</div>}

      {!q.loading && data && (
        <>
          {/* 顶部横向步骤条 */}
          <Card>
            <div className="flex items-start">
              {STEPS.map((s, i) => (
                <div key={s.title} className="flex flex-1 items-start last:flex-none">
                  <button onClick={() => setStep(i)} className="flex w-28 shrink-0 flex-col items-center gap-1.5">
                    <span className={cn('flex h-9 w-9 items-center justify-center rounded-full border transition-colors', i === step ? 'border-brand-600 bg-brand-600 text-white shadow-card' : i < step ? 'border-brand-200 bg-brand-50 text-brand-600' : 'border-slate-200 bg-white text-slate-400')}>
                      <s.icon size={15} />
                    </span>
                    <span className={cn('text-[12px] font-semibold', i === step ? 'text-brand-700' : 'text-slate-500')}>{i + 1}. {s.title}</span>
                    <span className="text-center text-[10px] leading-3 text-slate-400">{s.desc}</span>
                  </button>
                  {i < STEPS.length - 1 && <div className={cn('mt-[17px] h-0.5 flex-1 rounded', i < step ? 'bg-brand-300' : 'bg-slate-200')} />}
                </div>
              ))}
            </div>
          </Card>

          {/* 每步结果卡 */}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {/* 步骤1：设备类型分组 */}
            <Card className={cn('transition-colors', step === 0 && 'ring-2 ring-brand-200')}>
              <CardHeader title="步骤 1 · 筛选设备" desc="按设备类型分组，附平均健康度" actions={<Badge color="blue" dot>{data.totalDevices} 台设备</Badge>} />
              <MiniTable head={['设备类型', '数量', '平均健康度']} rows={data.step1.length ? data.step1.map((r) => [r.type, String(r.count), String(r.avgHealth)]) : [['（无设备对象）', '0', '—']]} />
            </Card>

            {/* 步骤2：停机设备 */}
            <Card className={cn('transition-colors', step === 1 && 'ring-2 ring-brand-200')}>
              <CardHeader title="步骤 2 · 筛选状态" desc="状态 = 停机 / 维修" actions={<Badge color="amber" dot>{data.step2.length} 台停机</Badge>} />
              <MiniTable head={['设备编号', '类型', '累计停机(h)']} rows={data.step2.length ? data.step2.map((r) => [r.code, r.type, <span key={r.code} className="font-semibold text-red-500">{r.downtime}</span>]) : [['（无停机设备）', '—', '—']]} />
            </Card>

            {/* 步骤3：关联工单 */}
            <Card className={cn('transition-colors', step === 2 && 'ring-2 ring-brand-200')}>
              <CardHeader title="步骤 3 · 关联工单" desc="优先级 P0 / P1" actions={<Badge color="red" dot>{data.step3.length} 张工单</Badge>} />
              <MiniTable head={['工单号', '优先级', '故障', '状态']} rows={data.step3.length ? data.step3.map((r) => [r.no, <Badge key={r.no} color={r.priority === 'P0' ? 'red' : 'amber'}>{r.priority}</Badge>, r.fault, r.status]) : [['（无紧急工单）', '—', '—', '—']]} />
            </Card>

            {/* 步骤4：关联员工 */}
            <Card className={cn('transition-colors', step === 3 && 'ring-2 ring-brand-200')}>
              <CardHeader title="步骤 4 · 关联员工" desc="参与处理工单的员工" actions={<Badge color="violet" dot>{data.step4.length} 名员工</Badge>} />
              <MiniTable head={['姓名', '技能等级', '岗位']} rows={data.step4.length ? data.step4.map((r) => [r.name, r.skill || '—', r.role || '—']) : [['（无员工对象）', '—', '—']]} />
            </Card>

            {/* 步骤5：汇总结论 */}
            <Card className={cn('bg-gradient-to-br from-brand-50/80 to-cyan-50/60', step === 4 && 'ring-2 ring-brand-200')}>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-800">步骤 5 · 汇总影响</span>
                <Badge color="green" dot>分析完成</Badge>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg bg-white/80 p-2.5 text-center">
                  <div className="text-lg font-black text-brand-700">{data.summary.downtime}<span className="text-[11px] font-medium text-slate-400"> h</span></div>
                  <div className="mt-0.5 text-[11px] text-slate-500">停机时长</div>
                </div>
                <div className="rounded-lg bg-white/80 p-2.5 text-center">
                  <div className="text-lg font-black text-brand-700">{data.summary.tickets}<span className="text-[11px] font-medium text-slate-400"> 张</span></div>
                  <div className="mt-0.5 text-[11px] text-slate-500">影响工单</div>
                </div>
                <div className="rounded-lg bg-white/80 p-2.5 text-center">
                  <div className="text-lg font-black text-brand-700">{data.summary.staff}<span className="text-[11px] font-medium text-slate-400"> 名</span></div>
                  <div className="mt-0.5 text-[11px] text-slate-500">涉及员工</div>
                </div>
              </div>
              <div className="mt-3 rounded-lg border-l-4 border-brand-400 bg-white/80 p-3 text-[12px] leading-5 text-slate-600">
                <span className="flex gap-1.5 font-semibold text-slate-700"><Lightbulb size={13} className="mt-0.5 shrink-0 text-amber-500" />结论：</span>
                当前空间共 {data.summary.devices} 台设备，其中停机/维修设备累计停机 {data.summary.downtime}h；停机最久的设备为 <span className="font-semibold">{data.summary.worst}</span>。关联紧急工单 {data.summary.tickets} 张，涉及 {data.summary.staff} 名处理员工。建议优先安排高停机设备的检修排程。
              </div>
            </Card>
          </div>

          {/* 底部操作 */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-slate-400">路径运行于 {data.generatedAt} · 数据源：本体对象 设备 / 工单 / 员工 · 空间：{data.spaceName}</span>
            <div className="flex gap-2">
              <Btn size="sm" onClick={() => notify('当前路径为实时聚合，无需另存模板')}>保存为分析模板</Btn>
              <Btn size="sm" variant="primary" onClick={() => { navigator.clipboard?.writeText(window.location.href); notify('已复制当前分析路径链接') }}><Share2 size={13} /> 分享路径</Btn>
            </div>
          </div>
        </>
      )}
    </PageShell>
  )
}

/** 页内简表 */
function MiniTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <table className="w-full text-[12px]">
      <thead>
        <tr className="border-b border-slate-100 text-left text-[11px] text-slate-400">
          {head.map((h) => <th key={h} className="px-1 py-1.5 font-medium">{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-slate-50 last:border-0">
            {r.map((c, j) => <td key={j} className="px-1 py-1.5 text-slate-600">{c}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
