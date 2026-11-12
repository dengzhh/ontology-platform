import { useState } from 'react'
import { ScrollText, Loader2, RefreshCw, Search } from 'lucide-react'
import PageShell from '@/components/ui/PageShell'
import Btn from '@/components/ui/Btn'
import DataTable from '@/components/ui/DataTable'
import { Badge, type BadgeColor } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { SearchInput } from '@/components/ui/Form'
import { Avatar } from '@/components/ui/Misc'
import { api } from '@/lib/api'
import { useApi } from '@/lib/useApi'

interface AuditRow {
  id: string
  actor: string
  action: string
  target: string
  result: string
  detail: Record<string, unknown> | null
  createdAt: string
}

function resultColor(r: string): BadgeColor {
  if (r.includes('成功') || r.includes('done')) return 'green'
  if (r.includes('待审批')) return 'amber'
  if (r.includes('失败') || r.includes('驳回') || r.includes('拒绝')) return 'red'
  return 'blue'
}

/** 审计日志（P4）：平台全部真实留痕——登录/建模/数据/动作/审批/空间/配置 */
export default function Audit() {
  const [actor, setActor] = useState('')
  const [action, setAction] = useState('')
  const [query, setQuery] = useState('')
  const auditQ = useApi<{ total: number; events: AuditRow[] }>(`/admin/audit?actor=${encodeURIComponent(actor)}&action=${encodeURIComponent(action)}&limit=100`)
  const [expanded, setExpanded] = useState<string | null>(null)

  const rows = (auditQ.data?.events ?? []).filter((e) => !query || JSON.stringify(e).toLowerCase().includes(query.toLowerCase()))

  return (
    <PageShell
      icon={ScrollText}
      title="审计日志"
      subtitle="平台全部真实留痕：登录、建模、数据变更、动作执行、审批决策、空间与配置操作"
      benchmark="审计合规"
      features={[
        '全量留痕：所有写操作（对象/本体/动作/审批/空间/用户/配置）自动记录，无法绕过',
        '多维检索：按操作人、动作类型、关键词实时过滤',
        '详情展开：每条记录可查看完整参数（detail）',
        '动作链路：发起→审批→执行在动作日志与审计中双向可查',
      ]}
      actions={
        <>
          <Btn size="sm" onClick={() => auditQ.reload()}><RefreshCw size={13} /> 刷新</Btn>
          <Btn size="sm" onClick={() => {
            const text = JSON.stringify(rows, null, 2)
            const blob = new Blob([text], { type: 'application/json' })
            const a = document.createElement('a')
            a.href = URL.createObjectURL(blob)
            a.download = `ontoos-audit-${Date.now()}.json`
            a.click()
            URL.revokeObjectURL(a.href)
          }}>导出当前结果</Btn>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-44"><SearchInput value={actor} onChange={(e) => setActor(e.target.value)} placeholder="按操作人过滤…" /></div>
        <div className="w-44"><SearchInput value={action} onChange={(e) => setAction(e.target.value)} placeholder="按动作类型过滤…" /></div>
        <div className="w-52"><SearchInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="全局关键词…" /></div>
        <span className="ml-auto text-xs text-slate-400">共 {auditQ.data?.total ?? 0} 条 / 显示 {rows.length} 条</span>
      </div>

      {auditQ.loading ? (
        <div className="flex items-center justify-center gap-2 py-14 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" /> 加载审计日志…</div>
      ) : (
        <DataTable
          rows={rows}
          rowKey={(r) => r.id}
          onRowClick={(r) => setExpanded(expanded === r.id ? null : r.id)}
          columns={[
            { key: 'createdAt', header: '时间', width: '150px', cell: (r) => <span className="font-mono text-xs text-slate-500">{r.createdAt}</span> },
            { key: 'actor', header: '操作人', cell: (r) => <span className="flex items-center gap-1.5"><Avatar name={r.actor} className="h-5 w-5 text-[9px]" /><span className="font-medium">{r.actor}</span></span> },
            { key: 'action', header: '动作', cell: (r) => <Badge color="blue">{r.action}</Badge> },
            { key: 'target', header: '对象', cell: (r) => <span className="max-w-xs truncate text-xs text-slate-600" title={r.target}>{r.target || '—'}</span> },
            { key: 'result', header: '结果', cell: (r) => <Badge color={resultColor(r.result)}>{r.result}</Badge> },
            {
              key: 'detail', header: '', align: 'right', cell: (r) => r.detail && Object.keys(r.detail).length > 0 ? (
                <span className="text-[11px] text-slate-400">{expanded === r.id ? '收起 ▲' : '详情 ▼'}</span>
              ) : null,
            },
          ]}
        />
      )}

      {expanded && rows.find((r) => r.id === expanded)?.detail && (
        <Card>
          <div className="mb-1.5 text-xs font-semibold text-slate-500">记录详情 · {expanded}</div>
          <pre className="overflow-auto rounded-lg border border-slate-100 bg-slate-50 p-3 font-mono text-[11px] leading-5 text-slate-600">
            {JSON.stringify(rows.find((r) => r.id === expanded)?.detail, null, 2)}
          </pre>
        </Card>
      )}
    </PageShell>
  )
}
