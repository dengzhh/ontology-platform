import { useState } from 'react'
import { ArrowLeftRight, FunctionSquare, Plus, RefreshCw, Table2, Loader2 } from 'lucide-react'
import PageShell from '@/components/ui/PageShell'
import Btn from '@/components/ui/Btn'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { Select } from '@/components/ui/Form'
import SpreadsheetGrid from '@/components/canvas/SpreadsheetGrid'
import { api } from '@/lib/api'
import { useApi } from '@/lib/useApi'

interface SheetResp {
  headers: string[]
  fieldKeys: string[]
  rows: { objectId: string; cells: string[] }[]
  alertRows: number[]
  formula: string
  total: number
}

const FORMULA_OPTIONS = [
  '=ONTOLOGY.QUERY("Factory")',
  '=ONTOLOGY.PROP(对象, 属性)',
  '=ONTOLOGY.AGG(对象集, 聚合, 属性)',
  '=ONTOLOGY.LINK(单元格, 链接类型)',
]

/** Fusion：与本体双向同步的电子表格（P5 接真）—— 单元格来自真实 Factory 对象，编辑写回本体 */
export default function FusionPage() {
  const q = useApi<SheetResp>('/p10long/fusion/sheet')
  const [toast, setToast] = useState('')
  const [busy, setBusy] = useState(false)
  const [formula, setFormula] = useState(FORMULA_OPTIONS[0])
  const [version, setVersion] = useState(0)
  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2600) }
  const data = q.data

  const headers = data?.headers ?? []
  const fieldKeys = data?.fieldKeys ?? []
  const rows = (data?.rows ?? []).map((r) => r.cells)
  const objectIds = (data?.rows ?? []).map((r) => r.objectId)
  // 超停机阈值行的 C 列（第 3 列）高亮
  const highlight = (data?.alertRows ?? []).map((ri) => `C${ri + 2}`)

  async function onCellEdit(row: number, col: number, value: string) {
    const objectId = objectIds[row]
    const field = fieldKeys[col]
    if (!objectId || !field) return
    setBusy(true)
    try {
      await api('/p10long/fusion/cell', { method: 'POST', body: { objectId, field, value } })
      notify(`已写回本体：${headers[col]} = ${value}（已留审计）`)
      setVersion((v) => v + 1)
      q.reload()
    } catch (e) { notify(e instanceof Error ? e.message : '写回失败') }
    finally { setBusy(false) }
  }

  return (
    <PageShell
      icon={Table2}
      title="智能表格"
      subtitle="公式引用本体对象，表格单元格与本体双向同步（编辑即写回对象属性）"
      benchmark="智能表格"
      features={[
        '真实数据：表格行来自当前空间的 Factory 对象，列映射对象属性',
        '双向同步：双击单元格编辑 → 真实 PATCH 写回本体对象 + 审计留痕',
        '异常高亮：设备停机时长超阈值的工厂行自动高亮',
        '函数模板：内置查询、取属性、聚合、链接四类本体函数示意',
      ]}
      actions={
        <>
          <Btn size="sm" disabled={q.loading} onClick={() => { q.reload(); setVersion((v) => v + 1); notify('已从本体重新同步') }}><RefreshCw size={13} /> 立即同步</Btn>
          <Btn size="sm" variant="primary" onClick={() => {
            // 导出当前工作表为 CSV（真实产物，而非仅弹提示）
            const headers = ['工厂名称', '所在城市', '设备数', 'OEE', '备注']
            const rows = (data?.rows ?? []).map((r) => (r.cells ?? []).map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
            const csv = '\uFEFF' + [headers.join(','), ...rows].join('\n')
            const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
            const a = document.createElement('a'); a.href = url; a.download = '设备工作表.csv'; a.click(); URL.revokeObjectURL(url)
            notify(`已导出工作表（${rows.length} 行）为 CSV`)
          }}><Plus size={13} /> 导出工作表</Btn>
        </>
      }
    >
      {toast && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">{toast}</div>}
      {q.loading && <div className="flex items-center gap-2 py-8 text-sm text-slate-400"><Loader2 size={14} className="animate-spin" /> 从本体加载对象集…</div>}

      {/* 顶部工具栏 */}
      {!q.loading && data && (
        <>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <Badge color="green" dot>双向同步 · 已开启</Badge>
                <span className="text-[11px] text-slate-400">{data.total} 个 Factory 对象 · 双击单元格编辑并写回</span>
                {busy && <Loader2 size={12} className="animate-spin text-brand-500" />}
              </div>
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-xs text-slate-500">本体函数</span>
                <Select value={formula} onChange={(e) => setFormula(e.target.value)}>
                  {FORMULA_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
                </Select>
                <span className="text-[11px] text-slate-400">变更已计入审计日志</span>
              </div>
            </div>
          </Card>

          {/* 表格主体（真实对象 + 可写回） */}
          <SpreadsheetGrid
            key={version}
            headers={headers}
            rows={rows}
            formula={formula}
            highlight={highlight}
            onCellEdit={onCellEdit}
          />

          {/* 说明卡片 */}
          <div className="grid gap-3 md:grid-cols-3">
            {[
              { icon: FunctionSquare, title: '本体函数', desc: '表格由 =ONTOLOGY.QUERY("Factory") 拉取真实对象集，列直接映射对象属性。' },
              { icon: ArrowLeftRight, title: '双向同步', desc: '双击单元格编辑后回车/失焦，即写回对应 Factory 对象属性，并自动留痕审计。' },
              { icon: RefreshCw, title: '异常高亮', desc: '设备停机时长累计超 40h 的工厂，其设备数列自动高亮提示。' },
            ].map((e) => (
              <div key={e.title} className="card flex items-start gap-2.5 p-3.5">
                <e.icon size={15} className="mt-0.5 shrink-0 text-brand-600" />
                <div>
                  <div className="text-[13px] font-semibold text-slate-800">{e.title}</div>
                  <div className="mt-0.5 text-[11px] leading-4 text-slate-400">{e.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </PageShell>
  )
}
