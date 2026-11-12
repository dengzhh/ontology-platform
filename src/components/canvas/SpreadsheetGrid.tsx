import { useState } from 'react'
import { cn } from '@/lib/utils'

/** 电子表格视图：列字母表头 + 行号 + 公式栏，用于 Fusion 等页面。
 *  传入 onCellEdit 后双击单元格可编辑（真实双向同步场景）。 */
export default function SpreadsheetGrid({
  headers,
  rows,
  formula = '=ONTOLOGY.LINK(A2, "客户")',
  highlight = [],
  onCellEdit,
  className,
}: {
  headers: string[]
  rows: string[][]
  formula?: string
  /** 高亮单元格，格式 "B3" */
  highlight?: string[]
  /** 单元格编辑回调：(行索引, 列索引, 新值) → 是否成功 */
  onCellEdit?: (row: number, col: number, value: string) => void | Promise<void>
  className?: string
}) {
  const letters = headers.map((_, i) => String.fromCharCode(65 + i))
  const highSet = new Set(highlight)
  const [editing, setEditing] = useState<{ row: number; col: number } | null>(null)
  const [draft, setDraft] = useState('')

  function startEdit(ri: number, ci: number) {
    if (!onCellEdit) return
    setEditing({ row: ri, col: ci })
    setDraft(rows[ri]?.[ci] ?? '')
  }

  async function commit() {
    if (!editing) return
    const { row, col } = editing
    setEditing(null)
    if (draft !== rows[row]?.[col] && onCellEdit) await onCellEdit(row, col, draft)
  }

  return (
    <div className={cn('overflow-hidden rounded-lg border border-slate-200 bg-white', className)}>
      {/* 工具栏与公式栏 */}
      <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div className="flex gap-1 text-slate-400">
          <span className="text-xs font-semibold">fx</span>
        </div>
        <div className="flex-1 rounded border border-slate-200 bg-white px-2 py-1 font-mono text-xs text-brand-700">{formula}</div>
        {onCellEdit && <span className="shrink-0 text-[10px] text-slate-400">双击单元格可编辑并写回本体</span>}
      </div>
      <div className="overflow-auto">
        <table className="min-w-max border-collapse text-xs">
          <thead>
            <tr className="bg-slate-50 text-slate-500">
              <th className="w-10 border border-slate-200 px-2 py-1.5 text-center font-medium"></th>
              {letters.map((l, i) => (
                <th key={l} className={cn('min-w-[130px] border border-slate-200 px-2 py-1.5 text-center font-medium', highSet.has(`${l}1`) && 'bg-brand-50 text-brand-700')}>
                  {l}
                </th>
              ))}
            </tr>
            <tr className="bg-white">
              <td className="border border-slate-200 bg-slate-50"></td>
              {headers.map((h) => (
                <td key={h} className="border border-slate-200 px-2 py-1.5 font-semibold text-slate-700">
                  {h}
                </td>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                <td className="border border-slate-200 bg-slate-50 px-2 py-1.5 text-center text-slate-400">{ri + 2}</td>
                {r.map((c, ci) => {
                  const key = `${letters[ci]}${ri + 2}`
                  const isEditing = editing?.row === ri && editing?.col === ci
                  return (
                    <td
                      key={ci}
                      onDoubleClick={() => startEdit(ri, ci)}
                      className={cn('border border-slate-200 px-2 py-1.5 text-slate-600', highSet.has(key) && 'bg-brand-50 font-medium text-brand-700', onCellEdit && 'cursor-text hover:bg-brand-50/40')}
                    >
                      {isEditing ? (
                        <input
                          autoFocus
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onBlur={commit}
                          onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(null) }}
                          className="w-full rounded border border-brand-400 bg-white px-1 py-0.5 text-xs outline-none"
                        />
                      ) : c}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
