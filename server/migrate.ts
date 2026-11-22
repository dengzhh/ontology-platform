/** 编程式迁移：npx tsx server/migrate.ts（含空间地基回填，幂等）
 *  同时导出 ensureMigrated() 供服务启动时调用——新部署首次启动自动建表，
 *  避免「启动后查询 settings 表报 no such table」。
 */
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { db, sqlite, tables } from './db'

/** 默认组织空间（空间隔离地基） */
export const DEFAULT_SPACE_ID = 'sp-org-default'

/** 迁移后处理：drizzle 迁移 + 空间地基回填 + 第 2/4 批建表与索引（全部幂等） */
function runPostMigrations() {
  migrate(db, { migrationsFolder: './drizzle' })
  /* ---- 空间地基回填（幂等）：默认组织空间 + 历史数据归属 + 成员 ----
   * 空库（尚未 seed）时跳过本段：spaces.owner_id 外键依赖 users，
   * 但**不能** return——后面的第 2/4 批建表与索引必须始终执行。 */
  const now = Date.now()
  const userCount = (sqlite.prepare('SELECT count(*) AS c FROM users').get() as { c: number }).c
  if (userCount === 0) {
    console.log('[migrate] 空库（无用户），跳过空间地基回填；请执行 npm run seed 初始化')
  } else {
    const defaultSpace = sqlite.prepare('SELECT id FROM spaces WHERE id = ?').get(DEFAULT_SPACE_ID)
    if (!defaultSpace) {
      sqlite.prepare('INSERT INTO spaces (id, name, kind, owner_id, template_pack, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(DEFAULT_SPACE_ID, '星辰智造集团', 'org', 'U-0001', 'manufacturing-demo', now)
      console.log('[migrate] 已创建默认组织空间:', DEFAULT_SPACE_ID)
    }

    // 全部现有用户 → 默认空间成员（陈星野为 owner）
    const users = sqlite.prepare('SELECT id, account FROM users').all() as { id: string; account: string }[]
    for (const u of users) {
      const role = u.account === 'chen.xingye' ? 'owner' : 'member'
      sqlite.prepare('INSERT OR IGNORE INTO space_members (space_id, user_id, role) VALUES (?, ?, ?)').run(DEFAULT_SPACE_ID, u.id, role)
    }

    // 历史域数据回填归属
    const domainTables = [
      'object_types', 'link_types', 'action_types', 'ontology_functions',
      'objects', 'object_links', 'documents', 'doc_chunks', 'doc_links',
      'extract_candidates', 'automation_rules', 'workshop_apps',
    ]
    for (const t of domainTables) {
      const r = sqlite.prepare(`UPDATE ${t} SET space_id = ? WHERE space_id = ''`).run(DEFAULT_SPACE_ID)
      if (r.changes > 0) console.log(`[migrate] 回填 ${t}: ${r.changes} 行 → 默认空间`)
    }
  }

  /* ---- 第 2 批新表：幂等 CREATE TABLE IF NOT EXISTS（不依赖 drizzle journal，避免破坏既有迁移链） ---- */
  sqlite.exec(`
  CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft', aip_result TEXT NOT NULL DEFAULT '',
  owner_id TEXT NOT NULL DEFAULT '', space_id TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS marketplace_products (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, "desc" TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '模板包', ref_id TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL DEFAULT '1.0.0', publisher TEXT NOT NULL DEFAULT '',
  install_count INTEGER NOT NULL DEFAULT 0, space_id TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS model_registrations (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, provider TEXT NOT NULL DEFAULT '自定义',
  type TEXT NOT NULL DEFAULT '对话', endpoint TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1, quota INTEGER NOT NULL DEFAULT 0,
  space_id TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, key_hash TEXT NOT NULL, prefix TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL DEFAULT 'read', owner_id TEXT NOT NULL DEFAULT '', space_id TEXT NOT NULL DEFAULT '',
  last_used_at INTEGER, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS pipelines (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, "desc" TEXT NOT NULL DEFAULT '',
  nodes TEXT NOT NULL DEFAULT '[]', schedule TEXT NOT NULL DEFAULT '手动',
  status TEXT NOT NULL DEFAULT '草稿', version INTEGER NOT NULL DEFAULT 1,
  owner_id TEXT NOT NULL DEFAULT '', space_id TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS pipeline_runs (
  id TEXT PRIMARY KEY, pipeline_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT '运行中',
  trigger TEXT NOT NULL DEFAULT '手动', duration_ms INTEGER NOT NULL DEFAULT 0,
  rows_processed INTEGER NOT NULL DEFAULT 0, message TEXT NOT NULL DEFAULT '',
  operator TEXT NOT NULL DEFAULT '', space_id TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS cipher_rules (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, pattern TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT '掩码', enabled INTEGER NOT NULL DEFAULT 1,
  space_id TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS scan_findings (
  id TEXT PRIMARY KEY, table_name TEXT NOT NULL, field TEXT NOT NULL DEFAULT '',
  sensitive_type TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '待处置',
  space_id TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS lifecycle_policies (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, retention TEXT NOT NULL DEFAULT '',
  legal TEXT NOT NULL DEFAULT '', space_id TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS interface_types (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, "desc" TEXT NOT NULL DEFAULT '',
  properties TEXT NOT NULL DEFAULT '[]', implemented_by TEXT NOT NULL DEFAULT '[]',
  space_id TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ontology_terms (
  id TEXT PRIMARY KEY, term TEXT NOT NULL, synonyms TEXT NOT NULL DEFAULT '[]',
  type_id TEXT NOT NULL DEFAULT '', property_key TEXT NOT NULL DEFAULT '',
  definition TEXT NOT NULL DEFAULT '', metric_expr TEXT NOT NULL DEFAULT '',
  certified INTEGER NOT NULL DEFAULT 0, space_id TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS function_versions (
  id TEXT PRIMARY KEY, function_id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  lang TEXT NOT NULL DEFAULT 'javascript', body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '草稿', test_input TEXT NOT NULL DEFAULT '{}',
  test_output TEXT NOT NULL DEFAULT '', published_at INTEGER,
  space_id TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS saved_explorations (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, type_id TEXT NOT NULL,
  filters TEXT NOT NULL DEFAULT '[]', sort TEXT NOT NULL DEFAULT '',
  owner_id TEXT NOT NULL DEFAULT '', space_id TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS derived_properties (
  id TEXT PRIMARY KEY, type_id TEXT NOT NULL, "key" TEXT NOT NULL, name TEXT NOT NULL,
  expr TEXT NOT NULL DEFAULT '', space_id TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ontology_scenarios (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, "desc" TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '进行中', changes TEXT NOT NULL DEFAULT '[]',
  owner_id TEXT NOT NULL DEFAULT '', space_id TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL, merged_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS governance_runs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, target TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL DEFAULT '', count INTEGER NOT NULL DEFAULT 0,
  space_id TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS schedule_tasks (
  id TEXT PRIMARY KEY, line TEXT NOT NULL, batch TEXT NOT NULL, product TEXT NOT NULL DEFAULT '',
  customer TEXT NOT NULL DEFAULT '', priority INTEGER NOT NULL DEFAULT 2, qty INTEGER NOT NULL DEFAULT 0,
  duration_h INTEGER NOT NULL DEFAULT 8, start_day INTEGER NOT NULL DEFAULT 0,
  start_hour INTEGER NOT NULL DEFAULT 8, status TEXT NOT NULL DEFAULT '已排',
  plan_id TEXT NOT NULL DEFAULT '', space_id TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY, version TEXT NOT NULL, env TEXT NOT NULL, status TEXT NOT NULL DEFAULT '构建中',
  "commit" TEXT NOT NULL DEFAULT '', message TEXT NOT NULL DEFAULT '', operator TEXT NOT NULL DEFAULT '',
  previous_id TEXT NOT NULL DEFAULT '', duration_ms INTEGER NOT NULL DEFAULT 0,
  space_id TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS llm_calls (
  id TEXT PRIMARY KEY, scene TEXT NOT NULL DEFAULT '',
  user_id TEXT NOT NULL DEFAULT '', user_name TEXT NOT NULL DEFAULT '',
  space_id TEXT NOT NULL DEFAULT '', conversation_id TEXT NOT NULL DEFAULT '',
  round INTEGER NOT NULL DEFAULT 0,
  endpoint TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', engine TEXT NOT NULL DEFAULT 'llm',
  request_messages TEXT NOT NULL DEFAULT '[]', tool_names TEXT NOT NULL DEFAULT '[]',
  reply TEXT NOT NULL DEFAULT '', tool_calls TEXT NOT NULL DEFAULT '[]',
  input_tokens INTEGER, output_tokens INTEGER,
  duration_ms INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'ok',
  error TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_llm_calls_created ON llm_calls (created_at DESC);
  `)
  console.log('[migrate] 第 2 批新表已就绪（幂等）')

  /* ---- 第 4 批：热点列索引（幂等）。为 SQL 下推与分页提供支撑，10 万级对象仍保持毫秒级过滤 ---- */
  sqlite.exec(`
  CREATE INDEX IF NOT EXISTS idx_objects_space_type ON objects(space_id, type_id);
  CREATE INDEX IF NOT EXISTS idx_objects_space_updated ON objects(space_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_object_links_space_source ON object_links(space_id, source_id);
  CREATE INDEX IF NOT EXISTS idx_object_links_space_target ON object_links(space_id, target_id);
  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_doc_chunks_doc ON doc_chunks(doc_id);
  CREATE INDEX IF NOT EXISTS idx_ts_points_metric_t ON ts_points(metric, t DESC);
  `)
  console.log('[migrate] 热点索引已就绪（幂等）')

}

/** 幂等迁移入口：服务启动与 CLI 共用 */
export function ensureMigrated() {
  runPostMigrations()
}

if (process.argv[1]?.includes('migrate')) {
  ensureMigrated()
  console.log('[migrate] 数据库迁移完成')
}
