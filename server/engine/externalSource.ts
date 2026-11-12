import path from 'node:path'
import fs from 'node:fs'
import Database from 'better-sqlite3'
import { db, tables } from '../db'

/**
 * 外部 SQLite 数据源（只读消费）
 * 安全：路径必须解析到 demo-data/external/ 目录内，防止任意文件读取；
 *       只读打开、行数上限、表名白名单（sqlite_master 里已存在的普通表）。
 */
const EXTERNAL_DIR = path.resolve(process.cwd(), 'demo-data', 'external')
fs.mkdirSync(EXTERNAL_DIR, { recursive: true })

function safeOpen(dbPath: string): Database.Database | null {
  if (!dbPath) return null
  const resolved = path.resolve(process.cwd(), dbPath)
  // 目录白名单：必须是 EXTERNAL_DIR 内的文件（含子目录）
  if (resolved !== EXTERNAL_DIR && !resolved.startsWith(EXTERNAL_DIR + path.sep)) return null
  if (!fs.existsSync(resolved)) return null
  try {
    return new Database(resolved, { readonly: true, fileMustExist: true })
  } catch {
    return null
  }
}

function tableNames(conn: Database.Database): string[] {
  return (conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[])
    .map((r) => r.name)
    .sort()
}

/** 真实连通性探测：返回真实表数，并回写连接状态/时间（替代客户端自报） */
export function testExternal(dbPath: string): { ok: boolean; tables?: string[]; error?: string } {
  const conn = safeOpen(dbPath)
  if (!conn) return { ok: false, error: '外部库不存在或不在允许目录（demo-data/external/）内' }
  try {
    const tablesFound = tableNames(conn)
    return { ok: true, tables: tablesFound }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '探测失败' }
  } finally {
    conn.close()
  }
}

/** 表结构 + 数据预览（只读，最多 20 行） */
export function previewExternal(dbPath: string, table: string): { ok: boolean; columns?: { name: string; type: string }[]; rows?: Record<string, unknown>[]; total?: number; error?: string } {
  const conn = safeOpen(dbPath)
  if (!conn) return { ok: false, error: '外部库不存在或不在允许目录内' }
  try {
    if (!tableNames(conn).includes(table)) return { ok: false, error: `表 ${table} 不存在` }
    const cols = conn.prepare(`PRAGMA table_info("${table.replace(/"/g, '""')}")`).all() as { name: string; type: string }[]
    const total = (conn.prepare(`SELECT count(*) c FROM "${table.replace(/"/g, '""')}"`).get() as { c: number }).c
    const rows = conn.prepare(`SELECT * FROM "${table.replace(/"/g, '""')}" LIMIT 20`).all() as Record<string, unknown>[]
    return { ok: true, columns: cols.map((c) => ({ name: c.name, type: c.type })), rows, total }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '预览失败' }
  } finally {
    conn.close()
  }
}

export interface SyncResult { ok: boolean; created?: number; skipped?: number; error?: string }

/** 把外部表行同步为当前空间的本体对象（列名 ↔ 对象属性 key 同名即映射） */
export function syncExternal(dbPath: string, table: string, typeId: string, spaceId: string, actor: string): SyncResult {
  const conn = safeOpen(dbPath)
  if (!conn) return { ok: false, error: '外部库不存在或不在允许目录内' }
  try {
    if (!tableNames(conn).includes(table)) return { ok: false, error: `表 ${table} 不存在` }
    const t = db.select().from(tables.objectTypes).all().find((x) => x.id === typeId && x.spaceId === spaceId)
    if (!t) return { ok: false, error: '目标对象类型不存在（当前空间）' }
    const props = (t.properties ?? []) as { key: string; type: string; required?: boolean; enumValues?: string[] }[]
    const valid = new Set(props.map((p) => p.key))
    const rows = conn.prepare(`SELECT * FROM "${table.replace(/"/g, '""')}" LIMIT 500`).all() as Record<string, unknown>[]
    const now = Date.now()
    let created = 0, skipped = 0
    const seen = new Set(db.select().from(tables.objects).all()
      .filter((o) => o.spaceId === spaceId && o.typeId === typeId)
      .map((o) => JSON.stringify(o.values)))
    for (const row of rows) {
      const values: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(row)) {
        if (!valid.has(k) || v === null || v === '') continue
        const p = props.find((x) => x.key === k)!
        if (p.type === 'number') {
          const n = Number(v)
          if (Number.isNaN(n)) continue
          values[k] = n
        } else if (p.type === 'enum' && p.enumValues?.length) {
          values[k] = p.enumValues.includes(String(v)) ? String(v) : p.enumValues[0]
        } else values[k] = String(v)
      }
      // 必填校验 + 去重（幂等：重复同步不产生重复对象）
      if (props.filter((p) => p.required).some((p) => values[p.key] === undefined)) { skipped++; continue }
      const sig = JSON.stringify(values)
      if (seen.has(sig)) { skipped++; continue }
      seen.add(sig)
      const id = `${typeId}:EXT-${now.toString(36)}-${created.toString(36)}`
      db.insert(tables.objects).values({
        id, typeId, values, createdBy: actor, createdAt: now, updatedAt: now, spaceId,
      }).run()
      created++
    }
    db.insert(tables.auditEvents).values({
      id: `AE-${now}-${Math.floor(Math.random() * 1000)}`, actor,
      action: '同步外部数据源', target: `${table} → ${t.name}（新增 ${created} 行）`, ip: '本地', createdAt: now,
    }).run()
    return { ok: true, created, skipped }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '同步失败' }
  } finally {
    conn.close()
  }
}
