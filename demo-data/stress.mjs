/**
 * 10 万行压力验证数据集 + 延迟基准
 *
 * 用法（先 npm run db:migrate 建索引）：
 *   node demo-data/stress.mjs           # 灌入 10 万行 → 测延迟 → 自动清理
 *   node demo-data/stress.mjs --keep    # 灌入后保留（供手动翻页体验）
 *   node demo-data/stress.mjs --clean  # 只清理
 */
import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'

const ROOT = path.resolve(process.cwd())
const db = new Database(path.join(ROOT, 'data', 'ontoos.db'))
db.pragma('journal_mode = WAL')
const TAG = 'STRESS_'
const SPACE = 'sp-org-default'
const TYPE = 'device'
const N = 100000
const KEEP = process.argv.includes('--keep')
const CLEAN_ONLY = process.argv.includes('--clean')

function clean() {
  const r = db.prepare('DELETE FROM objects WHERE id LIKE ?').run(`${TYPE}:${TAG}%`)
  db.prepare("DELETE FROM audit_events WHERE action='压力测试灌入'").run()
  console.log(`已清理 ${r.changes} 行压力数据`)
}
if (CLEAN_ONLY) { clean(); db.close(); process.exit(0) }

clean()

// 用原生 prepared statement + 事务灌入，保证 10 万行秒级完成
const now = Date.now()
const insert = db.prepare('INSERT OR IGNORE INTO objects (id, type_id, "values", created_by, created_at, updated_at, space_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
const t0 = Date.now()
const statuses = ['运行', '待机', '维修', '停机']
const bulk = db.transaction(() => {
  for (let i = 0; i < N; i++) {
    const values = JSON.stringify({
      code: `${TAG}EQ-${String(i).padStart(6, '0')}`,
      name: `压力设备 ${i}`,
      type: i % 5 === 0 ? '注塑机' : i % 5 === 1 ? 'CNC' : '检测仪',
      health: 40 + (i % 60),
      status: statuses[i % 4],
      downtime: (i % 50) * 0.7,
      factory: `佛山 ${(i % 5) + 1} 厂`,
    })
    insert.run(`${TYPE}:${TAG}${String(i).padStart(6, '0')}`, TYPE, values, 'stress', now + i, now + i, SPACE)
  }
})
bulk()
const loadMs = Date.now() - t0
const count = db.prepare('SELECT count(*) c FROM objects WHERE id LIKE ?').get(`${TYPE}:${TAG}%`).c
console.log(`灌入 ${count} 行，耗时 ${loadMs}ms（${Math.round(count / Math.max(1, loadMs / 1000))} 行/秒，事务+预编译）`)

// 延迟基准：模拟 /objects 列表的 SQL 下推查询
const idx = (db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_objects_space_type'").get() ? '有' : '无')
console.log(`索引 idx_objects_space_type: ${idx}`)
function bench(label, fn) {
  const s = performance.now()
  const r = fn()
  console.log(`  ${label}: ${(performance.now() - s).toFixed(1)}ms | 返回 ${Array.isArray(r) ? r.length : r} 行`)
  return r
}
const q = db.prepare("SELECT id, \"values\" FROM objects WHERE space_id=? AND type_id=? ORDER BY updated_at DESC LIMIT 200")
const qCount = db.prepare('SELECT count(*) c FROM objects WHERE space_id=? AND type_id=?')
const qKeyword = db.prepare("SELECT id FROM objects WHERE space_id=? AND type_id=? AND lower(\"values\") LIKE ? LIMIT 50")
console.log('SQL 下推基准（10 万行中）：')
bench('列表 200 条（带索引 + 排序）', () => q.all(SPACE, TYPE))
bench('总数 count', () => qCount.get(SPACE, TYPE).c)
bench('关键词过滤', () => qKeyword.all(SPACE, TYPE, '%STRESS_EQ-000099%'))

if (!KEEP) clean()
else console.log('已保留压力数据（可用 /objects?type=device&limit=200 翻页体验；清理用 --clean）')
db.close()
