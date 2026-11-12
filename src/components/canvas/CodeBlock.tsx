import { cn } from '@/lib/utils'

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const KEYWORDS =
  /\b(import|from|const|let|var|function|return|if|else|for|while|class|new|async|await|export|default|def|SELECT|FROM|WHERE|JOIN|ON|GROUP|BY|ORDER|AS|with|print|for|in|range|None|True|False|null|true|false|interface|type|enum)\b/

/** 简易语法高亮：关键字 / 字符串 / 注释 / 数字 */
function highlight(line: string): string {
  let out = ''
  let rest = esc(line)
  const commentIdx = rest.search(/(\/\/|#|--)/)
  let comment = ''
  if (commentIdx >= 0) {
    comment = rest.slice(commentIdx)
    rest = rest.slice(0, commentIdx)
  }
  out += rest
    .replace(/(&quot;.*?&quot;|'[^']*'|`[^`]*`|"[^"]*")/g, '<span style="color:#fbbf24">$1</span>')
    .replace(KEYWORDS, (m) => `<span style="color:#c084fc">${m}</span>`)
    .replace(/\b(\d+(\.\d+)?)\b/g, '<span style="color:#22d3ee">$1</span>')
  if (comment) out += `<span style="color:#64748b;font-style:italic">${comment}</span>`
  return out
}

/** 深色代码块：行号 + 简易高亮 */
export function CodeBlock({ code, title, className, maxLines }: { code: string; title?: string; className?: string; maxLines?: number }) {
  const lines = code.replace(/\n$/, '').split('\n').slice(0, maxLines ?? 400)
  return (
    <div className={cn('overflow-hidden rounded-lg border border-slate-700 bg-slate-900', className)}>
      {title && (
        <div className="flex items-center gap-2 border-b border-slate-700 px-4 py-2">
          <span className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
          <span className="ml-2 font-mono text-xs text-slate-400">{title}</span>
        </div>
      )}
      <pre className="overflow-auto p-3 font-mono text-[12px] leading-5 text-slate-200">
        {lines.map((l, i) => (
          <div key={i} className="flex">
            <span className="mr-3 w-7 shrink-0 select-none text-right text-slate-600">{i + 1}</span>
            <span className="whitespace-pre" dangerouslySetInnerHTML={{ __html: highlight(l) || '&nbsp;' }} />
          </div>
        ))}
      </pre>
    </div>
  )
}

export interface DiffLine {
  type: 'add' | 'del' | 'ctx'
  text: string
}

/** 代码差异视图 */
export function DiffView({ file, lines, className }: { file: string; lines: DiffLine[]; className?: string }) {
  const added = lines.filter((l) => l.type === 'add').length
  const deleted = lines.filter((l) => l.type === 'del').length
  return (
    <div className={cn('overflow-hidden rounded-lg border border-slate-200 bg-white', className)}>
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-600">
        <span>{file}</span>
        <span className="flex gap-2">
          <span className="text-emerald-600">+{added}</span>
          <span className="text-red-500">-{deleted}</span>
        </span>
      </div>
      <div className="overflow-auto font-mono text-[12px] leading-5">
        {lines.map((l, i) => (
          <div
            key={i}
            className={cn(
              'flex whitespace-pre px-3',
              l.type === 'add' && 'bg-emerald-50 text-emerald-800',
              l.type === 'del' && 'bg-red-50 text-red-700',
              l.type === 'ctx' && 'text-slate-600',
            )}
          >
            <span className="mr-2 w-3 shrink-0 select-text text-slate-400">{l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' '}</span>
            <span>{l.text || ' '}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
