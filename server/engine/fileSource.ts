import path from 'node:path'
import fs from 'node:fs'
import { db, tables } from '../db'

/**
 * 文件型外部数据源（CSV / JSON / TXT / MD，只读消费）
 *
 * 安全：源文件路径必须解析到 demo-data/files/ 目录内，防止任意文件读取；
 *       全程只读源文件（仅 fs.readFileSync），不写、不创建目录；
 *       同步动作写入的是平台自身的 objects / audit_events，与源文件无关。
 *
 * 数据模型：无论哪种格式，统一抽象成「若干张表」，每张表 = 列定义 + 行数组，
 *           便于 testFile / previewFile / syncFile 共用同一套解析结果。
 *           - CSV / TXT / MD：单表，表名取文件名（去扩展名）
 *           - JSON：顶层数组 → 单表；顶层对象里每个数组键 → 一张表（多表清单）
 */

const FILES_DIR = path.resolve(process.cwd(), 'demo-data', 'files')

export type FileFormat = 'CSV' | 'JSON' | 'TXT' | 'MD'
export interface FileColumn { name: string; type: string }
export interface FileTable { name: string; columns: FileColumn[]; rows: Record<string, unknown>[] }

interface ParsedFile {
  format: FileFormat
  tables: string[]                       // 有序表名
  data: Record<string, FileTable>        // 表名 → 表数据
  primary: string                        // 默认/概览用表
}

type ParseOutcome = { ok: true; parsed: ParsedFile } | { ok: false; error: string }

export interface TestFileResult {
  ok: boolean
  columns?: FileColumn[]
  rows?: Record<string, unknown>[]
  total?: number
  format?: FileFormat
  table?: string
  tables?: string[]
  error?: string
}
export interface PreviewFileResult {
  ok: boolean
  columns?: FileColumn[]
  rows?: Record<string, unknown>[]
  total?: number
  format?: FileFormat
  table?: string
  tables?: string[]
  error?: string
}
export interface SyncFileResult { ok: boolean; created?: number; skipped?: number; error?: string }

/** 路径白名单：resolve 后必须落在 demo-data/files/ 内（含子目录），且必须是已存在的文件 */
function safeResolve(dbPath: string): string | null {
  if (!dbPath) return null
  const inDir = (p: string) => p !== FILES_DIR && p.startsWith(FILES_DIR + path.sep)
  // 约定：database 存相对项目根的路径（同 SQLite 外部库）；也兼容只填文件名的情况
  const cwdResolved = path.resolve(process.cwd(), dbPath)
  const candidates = [cwdResolved, path.resolve(FILES_DIR, dbPath)]
  for (const resolved of candidates) {
    if (!inDir(resolved)) continue
    try {
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved
    } catch { /* 忽略不可达候选 */ }
  }
  return null
}

/** 读文件头判断类型：扩展名优先，扩展名缺失/未知时按内容首字符启发 */
function detectFormat(resolved: string, text: string): FileFormat {
  const ext = path.extname(resolved).toLowerCase()
  const head = text.replace(/^\uFEFF/, '').trimStart()
  if (ext === '.json' || head.startsWith('{') || head.startsWith('[')) return 'JSON'
  if (ext === '.csv') return 'CSV'
  if (ext === '.md' || head.startsWith('#')) return 'MD'
  if (ext === '.txt') return 'TXT'
  const firstLine = text.split(/\r?\n/)[0] ?? ''
  if (firstLine.split(',').length > 1) return 'CSV'
  return 'TXT'
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

/** 由行数组推导列（并集）与列类型（首个非空值推断） */
function makeTable(name: string, rows: Record<string, unknown>[]): FileTable {
  const keys: string[] = []
  for (const r of rows) {
    for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k)
  }
  const columns: FileColumn[] = keys.map((k) => {
    const sample = rows.map((r) => r[k]).find((v) => v !== null && v !== undefined)
    const type = typeof sample === 'number' ? 'number' : typeof sample === 'boolean' ? 'boolean' : 'string'
    return { name: k, type }
  })
  return { name, columns, rows }
}

/** 轻量 CSV 解析：支持 BOM、CRLF、引号字段、逗号/换行转义、"" 转义 */
function csvRecords(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '')
  const out: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += ch
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      row.push(field); field = ''
    } else if (ch === '\n') {
      row.push(field); out.push(row); row = []; field = ''
    } else if (ch === '\r') {
      if (clean[i + 1] !== '\n') { row.push(field); out.push(row); row = []; field = '' }
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length) { row.push(field); out.push(row) }
  return out
}

function parseCsv(text: string): FileTable {
  const records = csvRecords(text).filter((r) => r.length && r.some((c) => c.trim() !== ''))
  if (!records.length) return { name: '', columns: [], rows: [] }
  const header = records[0].map((h, i) => h.trim() || `col${i + 1}`)
  const rows: Record<string, unknown>[] = records.slice(1).map((rec) => {
    const o: Record<string, unknown> = {}
    header.forEach((h, i) => { o[h] = rec[i] ?? '' })
    return o
  })
  const columns: FileColumn[] = header.map((h) => {
    const vals = rows.map((r) => String(r[h])).filter((v) => v !== '')
    const numeric = vals.length > 0 && vals.every((v) => !Number.isNaN(Number(v)))
    return { name: h, type: numeric ? 'number' : 'string' }
  })
  return { name: '', columns, rows }
}

/** JSON：顶层数组 → 单表；顶层对象的每个数组键 → 一张表（多表清单） */
function parseJson(text: string, stem: string): FileTable[] {
  const parsed: unknown = JSON.parse(text.replace(/^\uFEFF/, ''))
  const out: FileTable[] = []
  if (Array.isArray(parsed)) {
    const arr = parsed as unknown[]
    out.push(makeTable(stem, arr.map((x) => (isObj(x) ? x : { value: x }))))
  } else if (isObj(parsed)) {
    for (const [k, v] of Object.entries(parsed)) {
      if (!Array.isArray(v)) continue
      const arr = v as unknown[]
      out.push(makeTable(k, arr.map((x) => (isObj(x) ? x : { value: x }))))
    }
    if (!out.length) out.push(makeTable('objects', [parsed]))
  } else {
    out.push(makeTable('objects', [{ value: parsed }]))
  }
  return out.map((t, i) => (t.name ? t : { ...t, name: `table${i + 1}` }))
}

/** 纯文本：按非空行拆成单列 content */
function parseText(text: string): FileTable {
  const rows: Record<string, unknown>[] = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((content) => ({ content }))
  return { name: '', columns: [{ name: 'content', type: 'string' }], rows }
}

/** 读取并归一化文件（唯一的真实 I/O 入口） */
function readParsed(dbPath: string): ParseOutcome {
  const resolved = safeResolve(dbPath)
  if (!resolved) return { ok: false, error: '文件不存在或不在允许目录（demo-data/files/）内' }
  let text: string
  try {
    text = fs.readFileSync(resolved, 'utf-8')
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '文件读取失败' }
  }
  const format = detectFormat(resolved, text)
  try {
    const stem = path.basename(resolved, path.extname(resolved)) || 'data'
    let tbls: FileTable[]
    if (format === 'CSV') {
      tbls = [parseCsv(text)]
    } else if (format === 'JSON') {
      tbls = parseJson(text, stem)
    } else {
      tbls = [parseText(text)]
    }
    // 单表格式（CSV/TXT/MD，以及 JSON 顶层数组）用文件名兜底表名
    tbls = tbls.map((t, i) => (t.name ? t : { ...t, name: stem || `table${i + 1}` }))
    const data: Record<string, FileTable> = {}
    for (const t of tbls) data[t.name] = t
    const primary = data['objects'] ? 'objects' : (tbls[0]?.name ?? 'data')
    return { ok: true, parsed: { format, tables: tbls.map((t) => t.name), data, primary } }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '文件解析失败' }
  }
}

/** 选定一张表：指定表名优先；缺省取概览表；单表格式对任意表名容错 */
function resolveTable(parsed: ParsedFile, table?: string): FileTable | null {
  const name = table?.trim()
  if (name && parsed.data[name]) return parsed.data[name]
  if (!name) return parsed.data[parsed.primary] ?? null
  if (parsed.tables.length === 1) return parsed.data[parsed.tables[0]] ?? null
  return null
}

/** 真实解析探测：读文件头判断格式，返回列 / 行 / 总行数 / 多表清单 */
export function testFile(dbPath: string): TestFileResult {
  const outcome = readParsed(dbPath)
  if (!outcome.ok) return { ok: false, error: outcome.error }
  const { parsed } = outcome
  const tbl = parsed.data[parsed.primary]
  return {
    ok: true,
    columns: tbl?.columns ?? [],
    rows: tbl?.rows ?? [],
    total: tbl?.rows.length ?? 0,
    format: parsed.format,
    table: parsed.primary,
    tables: parsed.tables,
  }
}

/** 表结构 + 最多 20 行样本（只读） */
export function previewFile(dbPath: string, table?: string): PreviewFileResult {
  const outcome = readParsed(dbPath)
  if (!outcome.ok) return { ok: false, error: outcome.error }
  const { parsed } = outcome
  const tbl = resolveTable(parsed, table)
  if (!tbl) return { ok: false, error: `表 ${table ?? ''} 不存在` }
  return {
    ok: true,
    columns: tbl.columns,
    rows: tbl.rows.slice(0, 20),
    total: tbl.rows.length,
    format: parsed.format,
    table: tbl.name,
    tables: parsed.tables,
  }
}

/** 把文件表行同步为当前空间本体对象（列名 ↔ 属性 key 同名映射，幂等，留审计） */
export function syncFile(dbPath: string, table: string, typeId: string, spaceId: string, actor: string): SyncFileResult {
  const outcome = readParsed(dbPath)
  if (!outcome.ok) return { ok: false, error: outcome.error }
  const { parsed } = outcome
  const tbl = resolveTable(parsed, table)
  if (!tbl) return { ok: false, error: `表 ${table} 不存在` }
  const t = db.select().from(tables.objectTypes).all().find((x) => x.id === typeId && x.spaceId === spaceId)
  if (!t) return { ok: false, error: '目标对象类型不存在（当前空间）' }
  const props = (t.properties ?? []) as { key: string; type: string; required?: boolean; enumValues?: string[] }[]
  const valid = new Set(props.map((p) => p.key))
  const rows = tbl.rows.slice(0, 500)
  const now = Date.now()
  let created = 0, skipped = 0
  const seen = new Set(db.select().from(tables.objects).all()
    .filter((o) => o.spaceId === spaceId && o.typeId === typeId)
    .map((o) => JSON.stringify(o.values)))
  for (const row of rows) {
    const values: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(row)) {
      if (!valid.has(k) || v === null || v === undefined || v === '') continue
      const p = props.find((x) => x.key === k)!
      // 与 syncExternal 一致的数字 / enum 归一思路
      if (p.type === 'number') {
        const n = Number(v)
        if (Number.isNaN(n)) continue
        values[k] = n
      } else if (p.type === 'enum' && p.enumValues?.length) {
        values[k] = p.enumValues.includes(String(v)) ? String(v) : p.enumValues[0]
      } else {
        values[k] = typeof v === 'object' ? JSON.stringify(v) : String(v)
      }
    }
    // 必填校验 + 去重（幂等：重复同步不产生重复对象）
    if (props.filter((p) => p.required).some((p) => values[p.key] === undefined)) { skipped++; continue }
    const sig = JSON.stringify(values)
    if (seen.has(sig)) { skipped++; continue }
    seen.add(sig)
    const id = `${typeId}:FILE-${now.toString(36)}-${created.toString(36)}`
    db.insert(tables.objects).values({
      id, typeId, values, createdBy: actor, createdAt: now, updatedAt: now, spaceId,
    }).run()
    created++
  }
  db.insert(tables.auditEvents).values({
    id: `AE-${now}-${Math.floor(Math.random() * 1000)}`, actor,
    action: '同步文件型数据源', target: `${tbl.name}（${parsed.format}）→ ${t.name}（新增 ${created} 行）`, ip: '本地', createdAt: now,
  }).run()
  return { ok: true, created, skipped }
}
