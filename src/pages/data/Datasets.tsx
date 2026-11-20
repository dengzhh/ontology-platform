import { useState } from 'react'
import { Table2, HeartPulse, Braces, KeyRound, Database, Loader2, RefreshCw } from 'lucide-react'
import PageShell from '@/components/ui/PageShell'
import Tabs from '@/components/ui/Tabs'
import DataTable, { type Column } from '@/components/ui/DataTable'
import { Badge } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import { ProgressBar } from '@/components/ui/Misc'
import Btn from '@/components/ui/Btn'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'

/* ---------------- 类型 ---------------- */

interface Dataset {
  id: string
  name: string
  typeName: string
  color: string
  rowCount: number
  propertyCount: number
  updatedAt: string
}
interface HealthCheck { name: string; result: string; detail: string }
interface Health { nullRate: number; dupRate: number; freshnessMinutes: number; checks: HealthCheck[] }
interface DatasetsResp { datasets: Dataset[]; health: Health }

interface PreviewColumn { key: string; name: string; type: string }
interface PreviewResp { typeName: string; columns: PreviewColumn[]; rows: Record<string, unknown>[]; total: number }

interface SchemaField { name: string; label: string; type: string; primaryKey: boolean; required: boolean }
interface SchemaResp { schema: SchemaField[] }

const TABS = [
  { key: 'preview', label: '预览' },
  { key: 'health', label: '健康' },
  { key: 'schema', label: 'Schema' },
]

function budget(v: number, limit: number) { return limit <= 0 ? 0 : Math.min(100, Math.round((v / limit) * 100)) }
function fmtValue(v: unknown) {
  if (v === undefined || v === null || v === '') return <span className="text-slate-300">—</span>
  if (typeof v === 'boolean') return v ? '✓' : '—'
  return String(v)
}

/** 数据集：预览、健康度与 Schema 管理 */
export default function Datasets() {
  const listQ = useApi<DatasetsResp>('/data-layer/datasets')
  const datasets = listQ.data?.datasets ?? []
  const health = listQ.data?.health

  const [selected, setSelected] = useState<string | null>(null)
  // 默认选中第一个数据集；切换数据集时重新触发详情请求
  const currentId = selected ?? datasets[0]?.id ?? null
  const ds = datasets.find((d) => d.id === currentId) ?? datasets[0]
  const [tab, setTab] = useState('preview')

  const previewQ = useApi<PreviewResp>(currentId ? `/data-layer/datasets/${currentId}/preview` : null)
  const schemaQ = useApi<SchemaResp>(currentId ? `/data-layer/datasets/${currentId}/schema` : null)

  const previewCols = previewQ.data?.columns ?? []
  const previewRows = previewQ.data?.rows ?? []
  const schemaRows = schemaQ.data?.schema ?? []

  function choose(id: string) { setSelected(id) }

  return (
    <PageShell
      icon={Database}
      title="数据集"
      subtitle="管道产出的数据集统一编目：预览样例数据、监控健康度、管理 Schema 变更（对象类型即数据集）"
      benchmark="数据资产"
      features={[
        '数据集目录：由本体对象类型实时编目，含行数、属性数与最近更新时间',
        '数据预览：按对象属性定义动态生成列，抽样浏览真实实例数据',
        'Data Health 健康度：空值率、重复率、新鲜度三色监控，超阈值自动告警',
        '检查规则：基于真实实例与审计留痕计算的规则化校验（主键 / 枚举 / 空值 / 留痕）',
        'Schema 管理：字段类型、主键与必填标记直接来自对象类型属性定义',
      ]}
      actions={<Btn size="sm" onClick={() => { listQ.reload(); previewQ.reload(); schemaQ.reload() }}><RefreshCw size={13} /> 刷新</Btn>}
    >
      <Card padding={false}>
        <div className="flex min-h-[520px] flex-col lg:flex-row">
          {/* 左：数据集列表（真实） */}
          <div className="w-full shrink-0 border-b border-slate-100 p-2 lg:w-64 lg:border-b-0 lg:border-r">
            <div className="px-2 pb-2 pt-1 text-xs font-semibold text-slate-500">数据集（{datasets.length}）</div>
            {listQ.loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-xs text-slate-400"><Loader2 size={14} className="animate-spin" /> 加载中…</div>
            ) : listQ.error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-3 text-xs text-red-700">{listQ.error}</div>
            ) : datasets.length === 0 ? (
              <div className="px-2 py-8 text-center text-xs text-slate-400">当前空间暂无对象类型，请先到本体管理建模</div>
            ) : datasets.map((d) => (
              <button
                key={d.id}
                onClick={() => choose(d.id)}
                className={cn('mb-1 flex w-full flex-col rounded-lg px-2.5 py-2 text-left', d.id === currentId ? 'bg-brand-50' : 'hover:bg-slate-50')}
              >
                <span className="flex w-full items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: d.color }} />
                  <code className={cn('flex-1 truncate font-mono text-[13px] font-semibold', d.id === currentId ? 'text-brand-700' : 'text-slate-700')}>{d.name}</code>
                  <Badge color="slate">{d.typeName}</Badge>
                </span>
                <span className="mt-1 flex w-full items-center justify-between text-[11px] text-slate-400">
                  <span>{d.rowCount} 行 · {d.propertyCount} 字段</span>
                  <span>{d.updatedAt}</span>
                </span>
              </button>
            ))}
          </div>

          {/* 右：预览 / 健康 / Schema */}
          <div className="min-w-0 flex-1 p-4">
            {!ds ? (
              <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-200 text-slate-400">
                <Table2 size={22} />
                <span className="text-[13px]">暂无数据集可展示</span>
              </div>
            ) : (
              <>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: ds.color }} />
                    <code className="font-mono text-[15px] font-bold text-slate-900">{ds.name}</code>
                    <Badge color="violet" dot>{ds.typeName}</Badge>
                    <span className="text-xs text-slate-400">{ds.rowCount} 行 · {ds.propertyCount} 字段 · {ds.updatedAt}更新</span>
                  </div>
                  <Tabs tabs={TABS} active={tab} onChange={setTab} size="sm" />
                </div>

                {/* 预览：动态列（来自 /preview） */}
                {tab === 'preview' && (previewQ.loading ? (
                  <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" /> 加载预览数据…</div>
                ) : previewQ.error ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{previewQ.error}</div>
                ) : (
                  <>
                    <CardHeader title={`${previewQ.data?.typeName ?? ds.typeName} · 实例预览`} desc={`抽样最多 20 行 · 共 ${previewQ.data?.total ?? 0} 行 · 列由对象属性定义动态生成`} />
                    <DataTable
                      dense
                      maxHeight="440px"
                      columns={previewCols.map<Column<Record<string, unknown>>>((c) => ({
                        key: c.key,
                        header: <span>{c.name}<span className="ml-1 text-[10px] font-normal text-slate-400">{c.type}</span></span>,
                        cell: (r) => fmtValue(r[c.key]),
                      }))}
                      rows={previewRows}
                    />
                  </>
                ))}

                {/* 健康：来自 /datasets 的 health */}
                {tab === 'health' && (health ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Btn size="sm" onClick={() => listQ.reload()}><RefreshCw size={12} /> 重算健康度</Btn>
                      <span className="text-[11px] text-slate-400">空值率 / 检查规则基于当前空间真实实例与审计留痕计算</span>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div className="rounded-xl border border-slate-200 p-3.5">
                        <div className="mb-1.5 flex items-center justify-between">
                          <span className="text-xs font-medium text-slate-500">空值率</span>
                          <Badge color={health.nullRate > 5 ? 'amber' : 'green'}>阈值 5%</Badge>
                        </div>
                        <div className="text-xl font-bold text-slate-900">{health.nullRate.toFixed(1)}%</div>
                        <ProgressBar className="mt-2" pct={budget(health.nullRate, 5)} color="bg-amber-500" />
                        <div className="mt-1.5 text-[11px] text-slate-400">存在空值字段的实例占比</div>
                      </div>
                      <div className="rounded-xl border border-slate-200 p-3.5">
                        <div className="mb-1.5 flex items-center justify-between">
                          <span className="text-xs font-medium text-slate-500">重复率</span>
                          <Badge color="green">阈值 0.5%</Badge>
                        </div>
                        <div className="text-xl font-bold text-slate-900">{health.dupRate.toFixed(1)}%</div>
                        <ProgressBar className="mt-2" pct={budget(health.dupRate, 0.5)} color="bg-emerald-500" />
                        <div className="mt-1.5 text-[11px] text-slate-400">主键唯一约束保障</div>
                      </div>
                      <div className="rounded-xl border border-slate-200 p-3.5">
                        <div className="mb-1.5 flex items-center justify-between">
                          <span className="text-xs font-medium text-slate-500">新鲜度</span>
                          <Badge color="blue">SLA 30 分钟</Badge>
                        </div>
                        <div className="text-xl font-bold text-slate-900">{health.freshnessMinutes} 分钟</div>
                        <ProgressBar className="mt-2" pct={budget(health.freshnessMinutes, 30)} color="bg-brand-500" />
                        <div className="mt-1.5 text-[11px] text-slate-400">已用 SLA 预算 {budget(health.freshnessMinutes, 30)}%</div>
                      </div>
                    </div>

                    <div>
                      <CardHeader title={<span className="flex items-center gap-1.5"><HeartPulse size={14} className="text-red-400" />检查规则（{health.checks.length}）</span>} desc="规则由服务端基于真实数据质量计算，未通过项以告警标记" />
                      <DataTable
                        dense
                        columns={[
                          { key: 'name', header: '规则', cell: (r: HealthCheck) => <span className="font-medium text-slate-800">{r.name}</span> },
                          { key: 'detail', header: '检查明细', cell: (r: HealthCheck) => <span className="text-xs text-slate-600">{r.detail}</span> },
                          { key: 'result', header: '状态', cell: (r: HealthCheck) => <Badge color={r.result === '通过' ? 'green' : 'amber'} dot>{r.result}</Badge> },
                        ]}
                        rows={health.checks}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex h-64 items-center justify-center text-sm text-slate-400">健康度数据加载中…</div>
                ))}

                {/* Schema：来自 /datasets/:id/schema */}
                {tab === 'schema' && (schemaQ.loading ? (
                  <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" /> 加载 Schema…</div>
                ) : schemaQ.error ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{schemaQ.error}</div>
                ) : (
                  <>
                    <CardHeader title={<span className="flex items-center gap-1.5"><Braces size={14} className="text-violet-400" />Schema（{schemaRows.length} 字段）</span>} desc="字段、类型、主键与必填标记直接来自对象类型属性定义" />
                    <DataTable
                      dense
                      columns={[
                        { key: 'name', header: '字段键', cell: (r: SchemaField) => <code className="font-mono text-xs font-semibold text-slate-700">{r.name}</code> },
                        { key: 'label', header: '名称', cell: (r: SchemaField) => <span className="text-xs text-slate-700">{r.label}</span> },
                        { key: 'type', header: '类型', cell: (r: SchemaField) => <Badge color={r.type === 'enum' ? 'violet' : r.type === 'number' || r.type === 'integer' ? 'cyan' : 'slate'}>{r.type}</Badge> },
                        { key: 'mark', header: '标记', cell: (r: SchemaField) => (
                          <span className="flex flex-wrap gap-1">
                            {r.primaryKey && <Badge color="amber">{<KeyRound size={10} />}主键</Badge>}
                            {r.required && <Badge color="blue">必填</Badge>}
                            {!r.primaryKey && !r.required && <span className="text-slate-300">—</span>}
                          </span>
                        ) },
                      ]}
                      rows={schemaRows}
                    />
                  </>
                ))}
              </>
            )}
          </div>
        </div>
      </Card>
    </PageShell>
  )
}
