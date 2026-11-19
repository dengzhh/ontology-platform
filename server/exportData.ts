import fs from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { db, sqlite, tables } from './db'

/**
 * 全量数据导出桥（SQLite → JSON Lines），供 PostgreSQL 迁移或离线归档
 *
 * 输出：data/export/ontoos-export-<时间戳>/
 *   manifest.json    表清单、行数、schema 版本、导出时间
 *   <table>.jsonl    每行一个 JSON 对象（保留原字段名 snake_case，便于 COPY 到 PG）
 *
 * 用法：
 *   npx tsx server/exportData.ts               # 导出全部表
 *   npx tsx server/exportData.ts --tables objects,object_links   # 指定表
 *   npx tsx server/exportData.ts --space sp-org-default          # 只导出某空间数据
 *
 * 迁移到 PG 时的推荐流程见 docs/PG-MIGRATION.md
 */

const OUT_ROOT = path.resolve(process.cwd(), 'data', 'export')

/** 空间隔离表（带 space_id 列，可按空间过滤） */
const SPACE_SCOPED = new Set([
  'object_types', 'link_types', 'action_types', 'objects', 'object_links',
  'documents', 'doc_chunks', 'doc_links', 'automation_rules', 'workshop_apps',
  'extract_candidates', 'ontology_functions', 'ontology_terms',
])

function stamp() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export interface ExportResult {
  dir: string
  tables: { name: string; rows: number; bytes: number }[]
  totalRows: number
}

export function exportAll(opts: { tables?: string[]; spaceId?: string } = {}): ExportResult {
  const allTables = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[])
    .map((r) => r.name)
  const targets = opts.tables?.length ? allTables.filter((t) => opts.tables!.includes(t)) : allTables

  const dir = path.join(OUT_ROOT, `ontoos-export-${stamp()}`)
  fs.mkdirSync(dir, { recursive: true })

  const summary: ExportResult['tables'] = []
  let totalRows = 0

  for (const name of targets) {
    // 表名来自 sqlite_master（非用户输入），已用白名单过滤
    const cols = (sqlite.prepare(`PRAGMA table_info("${name}")`).all() as { name: string }[]).map((c) => c.name)
    const useSpaceFilter = opts.spaceId && SPACE_SCOPED.has(name) && cols.includes('space_id')
    const rows = useSpaceFilter
      ? (sqlite.prepare(`SELECT * FROM "${name}" WHERE space_id = ?`).all(opts.spaceId) as Record<string, unknown>[])
      : (sqlite.prepare(`SELECT * FROM "${name}"`).all() as Record<string, unknown>[])

    const file = path.join(dir, `${name}.jsonl`)
    // JSON 字段在库内是文本列：导出时尝试解析成对象，便于 PG 用 jsonb 承接
    const lines = rows.map((r) => {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(r)) {
        if (typeof v === 'string' && (v.startsWith('{') || v.startsWith('['))) {
          try { out[k] = JSON.parse(v) } catch { out[k] = v }
        } else {
          out[k] = v
        }
      }
      return JSON.stringify(out)
    })
    fs.writeFileSync(file, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8')
    const bytes = fs.statSync(file).size
    summary.push({ name, rows: rows.length, bytes })
    totalRows += rows.length
  }

  const manifest = {
    product: 'OntoOS',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    source: { engine: 'sqlite', file: path.join(process.cwd(), 'data', 'ontoos.db') },
    filter: { spaceId: opts.spaceId ?? null },
    tables: summary,
    totalRows,
    notes: [
      '每行一条 JSON；JSON 文本列已解析为对象，PG 侧可用 jsonb 承接。',
      '布尔字段在 SQLite 为 0/1，导入 PG 时需转换为 boolean。',
      '时间字段为毫秒时间戳（integer），非 ISO 字符串。',
      '导入顺序须遵守外键：roles → users → spaces → space_members → 其它。',
    ],
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
  return { dir, tables: summary, totalRows }
}

// CLI
if (process.argv[1]?.includes('exportData')) {
  const args = process.argv.slice(2)
  const ti = args.indexOf('--tables')
  const si = args.indexOf('--space')
  const r = exportAll({
    tables: ti >= 0 ? args[ti + 1]?.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    spaceId: si >= 0 ? args[si + 1] : undefined,
  })
  console.log(`[export] 输出目录：${r.dir}`)
  console.log(`[export] 共 ${r.tables.length} 张表 / ${r.totalRows} 行`)
  for (const t of r.tables) console.log(`  ${t.name.padEnd(24)} ${String(t.rows).padStart(7)} 行  ${(t.bytes / 1024).toFixed(0)} KB`)
}
