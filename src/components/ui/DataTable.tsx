import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface Column<T> {
  key: string
  header: ReactNode
  width?: string
  align?: 'left' | 'right' | 'center'
  cell?: (row: T, index: number) => ReactNode
}

interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey?: (row: T, index: number) => string
  onRowClick?: (row: T, index: number) => void
  maxHeight?: string
  dense?: boolean
}

/** 通用数据表格：rows 为对象数组，未指定 cell 时直接渲染 row[key] */
export default function DataTable<T extends object>({ columns, rows, rowKey, onRowClick, maxHeight, dense }: DataTableProps<T>) {
  return (
    <div className={cn('overflow-auto rounded-lg border border-slate-200 bg-white', maxHeight)}>
      <table className="w-full min-w-max text-[13px]">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
            {columns.map((c) => (
              <th key={c.key} className={cn('whitespace-nowrap px-3 py-2.5 font-medium', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center')} style={c.width ? { width: c.width } : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={rowKey ? rowKey(row, i) : i}
              onClick={onRowClick ? () => onRowClick(row, i) : undefined}
              className={cn('border-b border-slate-100 last:border-0', onRowClick && 'cursor-pointer hover:bg-brand-50/60')}
            >
              {columns.map((c) => (
                <td key={c.key} className={cn(dense ? 'px-3 py-1.5' : 'px-3 py-2.5', 'text-slate-700', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center')}>
                  {c.cell ? c.cell(row, i) : ((row as Record<string, ReactNode>)[c.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-3 py-10 text-center text-sm text-slate-400">
                暂无数据
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
