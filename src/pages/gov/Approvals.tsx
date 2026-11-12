import { useState } from 'react'
import { ClipboardCheck, Loader2, Check, X, RefreshCw, Clock3, ShieldAlert } from 'lucide-react'
import PageShell from '@/components/ui/PageShell'
import Tabs from '@/components/ui/Tabs'
import Btn from '@/components/ui/Btn'
import DataTable from '@/components/ui/DataTable'
import { Badge, type BadgeColor } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import { KVList } from '@/components/ui/Misc'
import { Avatar } from '@/components/ui/Misc'
import { useUI } from '@/store/ui'
import { api } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'

interface ApprovalRow {
  id: string
  title: string
  kind: string
  requester: string
  risk: string
  status: string
  payload: { actionName?: string; spaceName?: string; params?: Record<string, unknown>; effect?: { kind: string } }
  decidedBy: string
  createdAt: string
}

const RISK_COLOR: Record<string, BadgeColor> = { 低: 'green', 中: 'amber', 高: 'red' }
const STATUS_COLOR: Record<string, BadgeColor> = { 待审批: 'amber', 已通过: 'green', 已驳回: 'slate' }

/** 审批中心（P4）：动作审批真实流转——发起→待审批→通过(执行)/驳回，全程审计 */
export default function Approvals() {
  const { currentUser } = useUI()
  const [tab, setTab] = useState('pending')
  const listQ = useApi<{ approvals: ApprovalRow[]; canApprove: boolean }>('/actions/approvals/list')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [comment, setComment] = useState('')
  const [toast, setToast] = useState('')

  const all = listQ.data?.approvals ?? []
  const rows = tab === 'pending' ? all.filter((r) => r.status === '待审批') : tab === 'done' ? all.filter((r) => r.status !== '待审批') : all.filter((r) => r.requester === currentUser?.name)
  const selected = all.find((r) => r.id === selectedId) ?? rows[0]
  const canApprove = listQ.data?.canApprove ?? false

  async function decide(decision: 'approve' | 'reject') {
    if (!selected) return
    setBusy(true)
    try {
      const res = await api<{ status: string }>(`/actions/approvals/${selected.id}/decide`, { method: 'POST', body: { decision, comment } })
      notify(`${selected.id} ${res.status}${decision === 'approve' ? '（效果已写回并留痕）' : ''}`)
      setComment('')
      listQ.reload()
    } catch (e) {
      notify(e instanceof Error ? e.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }
  function notify(m: string) { setToast(m); setTimeout(() => setToast(''), 2800) }

  return (
    <PageShell
      icon={ClipboardCheck}
      title="审批中心"
      subtitle="需审批动作的流转中心：通过即执行写回、驳回即关闭，每一步审计留痕"
      benchmark="审批流转"
      features={[
        '动作审批：needsApproval 的动作执行自动进入此处（含参数与效果预览）',
        '审批权限：平台管理员或空间所有者；其他用户可见自己发起的单据',
        '通过即执行：审批通过后动作效果立即写回对象数据（创建/更新/删除）',
        '全程留痕：发起/通过/驳回均写入审计日志与动作日志',
      ]}
      actions={<Btn size="sm" onClick={() => listQ.reload()}><RefreshCw size={13} /> 刷新</Btn>}
    >
      {toast && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">{toast}</div>}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_360px]">
        <div className="min-w-0 space-y-3">
          <Tabs
            tabs={[
              { key: 'pending', label: '待审批', count: all.filter((r) => r.status === '待审批').length },
              { key: 'done', label: '已处理', count: all.filter((r) => r.status !== '待审批').length },
              { key: 'mine', label: '我发起的', count: all.filter((r) => r.requester === currentUser?.name).length },
            ]}
            active={tab}
            onChange={setTab}
          />
          {listQ.loading ? (
            <div className="flex items-center justify-center gap-2 py-14 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" /> 加载审批…</div>
          ) : rows.length === 0 ? (
            <Card className="py-12 text-center text-sm text-slate-400">暂无{tab === 'pending' ? '待审批' : tab === 'done' ? '已处理' : '发起'}单据——执行「需审批」动作后会出现在这里</Card>
          ) : (
            <DataTable
              rows={rows}
              rowKey={(r) => r.id}
              onRowClick={(r) => setSelectedId(r.id)}
              columns={[
                { key: 'title', header: '单据', cell: (r) => <span className="font-medium text-slate-800">{r.title}<span className="block text-[11px] font-normal text-slate-400">{r.id}</span></span> },
                { key: 'space', header: '空间', cell: (r) => <Badge color="blue">{r.payload?.spaceName ?? '—'}</Badge> },
                { key: 'requester', header: '发起人', cell: (r) => <span className="flex items-center gap-1.5"><Avatar name={r.requester} className="h-5 w-5 text-[9px]" />{r.requester}</span> },
                { key: 'risk', header: '风险', cell: (r) => <Badge color={RISK_COLOR[r.risk] ?? 'slate'}>{r.risk}</Badge> },
                { key: 'status', header: '状态', cell: (r) => <Badge color={STATUS_COLOR[r.status] ?? 'slate'} dot>{r.status}</Badge> },
                { key: 'createdAt', header: '发起时间', align: 'right', cell: (r) => <span className="text-xs text-slate-500">{r.createdAt}</span> },
              ]}
            />
          )}
        </div>

        {/* 详情与决策 */}
        <div className="min-w-0">
          {selected ? (
            <Card>
              <CardHeader
                title={<span className="flex items-center gap-2">{selected.title}</span>}
                desc={`${selected.id} · 发起 ${selected.createdAt}`}
                actions={<Badge color={STATUS_COLOR[selected.status] ?? 'slate'} dot>{selected.status}</Badge>}
              />
              <div className="mb-3 rounded-lg border border-slate-100 bg-slate-50/60 p-3">
                <KVList
                  cols={1}
                  items={[
                    { k: '发起人', v: selected.requester },
                    { k: '所在空间', v: selected.payload?.spaceName ?? '—' },
                    { k: '动作', v: selected.payload?.actionName ?? selected.kind },
                    { k: '效果', v: `effect: ${selected.payload?.effect?.kind ?? '—'}` },
                    { k: '风险等级', v: <Badge color={RISK_COLOR[selected.risk] ?? 'slate'}>{selected.risk}</Badge> },
                    { k: '决策', v: selected.decidedBy ? `${selected.decidedBy} ${selected.status}` : '—' },
                  ]}
                />
              </div>
              {selected.payload?.params && Object.keys(selected.payload.params).length > 0 && (
                <>
                  <div className="mb-1.5 text-[13px] font-semibold text-slate-700">参数</div>
                  <div className="mb-3 rounded-lg border border-slate-100 p-2.5 font-mono text-[11px] leading-5 text-slate-600">
                    {Object.entries(selected.payload.params).map(([k, v]) => (
                      <div key={k}><span className="text-slate-400">{k}</span> = {String(v)}</div>
                    ))}
                  </div>
                </>
              )}
              {selected.status === '待审批' && canApprove && (
                <div className="space-y-2.5 border-t border-slate-100 pt-3">
                  <input
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="审批意见（可选，将写入审计）"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                  />
                  <div className="flex gap-2">
                    <Btn variant="primary" className="flex-1" disabled={busy} onClick={() => decide('approve')}>
                      {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />} 通过并执行
                    </Btn>
                    <Btn variant="danger" className="flex-1" disabled={busy} onClick={() => decide('reject')}>
                      <X size={14} /> 驳回
                    </Btn>
                  </div>
                </div>
              )}
              {selected.status === '待审批' && !canApprove && (
                <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  <ShieldAlert size={13} /> 等待平台管理员或空间所有者审批
                </div>
              )}
            </Card>
          ) : (
            <Card className="flex h-full min-h-[240px] flex-col items-center justify-center gap-2 text-center">
              <Clock3 size={24} className="text-slate-200" />
              <div className="text-sm text-slate-400">选择左侧单据查看详情</div>
            </Card>
          )}
        </div>
      </div>
    </PageShell>
  )
}
