import { sqlite } from './db'
import path from 'node:path'
import fs from 'node:fs'
import Database from 'better-sqlite3'

/**
 * SQLite 在线备份：
 * - 用 VACUUM INTO 生成一致性快照（WAL 模式下安全，无需停服）
 * - 备份到 data/backups/ontoos-YYYYMMDD-HHmmss.db
 * - 保留最近 N 份（默认 14），更早的删除
 * - 可选 --verify：备份后打开校验完整性 + 关键表行数
 *
 * 用法：
 *   npx tsx server/backup.ts            # 备份
 *   npx tsx server/backup.ts --verify   # 备份并校验
 *   npx tsx server/backup.ts --list     # 列出已有备份
 *   npx tsx server/backup.ts --restore <file>  # 恢复（需先停服）
 */

const BACKUP_DIR = path.resolve(process.cwd(), 'data', 'backups')
const KEEP = Number(process.env.BACKUP_KEEP || 14)
const DB_FILE = path.resolve(process.cwd(), 'data', 'ontoos.db')

function stamp() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function listBackups(): string[] {
  if (!fs.existsSync(BACKUP_DIR)) return []
  return fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('ontoos-') && f.endsWith('.db'))
    .sort()
    .map((f) => path.join(BACKUP_DIR, f))
}

export function backup(opts: { verify?: boolean } = {}): { file: string; bytes: number; pruned: number } {
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
  const file = path.join(BACKUP_DIR, `ontoos-${stamp()}.db`)
  // VACUUM INTO：生成不含 WAL 的一致性副本
  sqlite.prepare('VACUUM INTO ?').run(file)
  const bytes = fs.statSync(file).size

  if (opts.verify) {
    const check = new Database(file, { readonly: true })
    const integrity = check.pragma('integrity_check', { simple: true })
    const objects = (check.prepare('SELECT count(*) c FROM objects').get() as { c: number }).c
    const users = (check.prepare('SELECT count(*) c FROM users').get() as { c: number }).c
    check.close()
    if (integrity !== 'ok') throw new Error(`备份校验失败：integrity_check=${integrity}`)
    console.log(`[backup] 校验通过：objects=${objects} users=${users}`)
  }

  // 保留最近 KEEP 份
  let pruned = 0
  const all = listBackups()
  for (const old of all.slice(0, Math.max(0, all.length - KEEP))) {
    fs.unlinkSync(old)
    pruned++
  }
  return { file, bytes, pruned }
}

function restore(file: string) {
  if (!fs.existsSync(file)) throw new Error(`备份文件不存在：${file}`)
  // 恢复前把当前库另存一份，避免误恢复丢数据
  const safety = path.join(BACKUP_DIR, `ontoos-before-restore-${stamp()}.db`)
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
  sqlite.prepare('VACUUM INTO ?').run(safety)
  sqlite.close()
  // 移除 WAL/SHM，避免旧日志污染恢复后的库
  for (const suffix of ['-wal', '-shm']) {
    const f = DB_FILE + suffix
    if (fs.existsSync(f)) fs.unlinkSync(f)
  }
  fs.copyFileSync(file, DB_FILE)
  console.log(`[backup] 已恢复 ${file} → ${DB_FILE}`)
  console.log(`[backup] 恢复前快照已保存：${safety}`)
}

// CLI
const args = process.argv.slice(2)
if (process.argv[1]?.includes('backup')) {
  if (args.includes('--list')) {
    const files = listBackups()
    if (!files.length) console.log('[backup] 暂无备份')
    for (const f of files) console.log(`${(fs.statSync(f).size / 1024).toFixed(0)} KB\t${f}`)
    process.exit(0)
  } else if (args.includes('--restore')) {
    const idx = args.indexOf('--restore')
    const f = args[idx + 1]
    if (!f) { console.error('用法：--restore <备份文件路径>'); process.exit(1) }
    restore(path.resolve(f))
    process.exit(0)
  } else {
    const r = backup({ verify: args.includes('--verify') })
    console.log(`[backup] 完成：${r.file}（${(r.bytes / 1024).toFixed(0)} KB）`)
    if (r.pruned) console.log(`[backup] 清理旧备份 ${r.pruned} 份（保留 ${KEEP} 份）`)
  }
}

// 供服务内定时备份使用
export { listBackups, DB_FILE }
