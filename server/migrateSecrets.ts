import { eq } from 'drizzle-orm'
import { db, tables } from './db'
import { encodeCfg, SECRET_PREFIX } from './secretbox'

/**
 * 一次性迁移：把 settings 表中历史明文密钥加密回写
 * - 覆盖 ai / vision / embedding 三张配置卡
 * - 幂等：已加密的字段跳过（不重复加密）
 * - 服务启动时自动调用；也可手动 `npx tsx server/migrateSecrets.ts`
 */
export function migrateSecrets(): { scanned: number; encrypted: number } {
  const keys = ['ai', 'vision', 'embedding']
  let scanned = 0
  let encrypted = 0
  for (const key of keys) {
    const row = db.select().from(tables.settings).where(eq(tables.settings.key, key)).get()
    if (!row) continue
    scanned++
    const before = JSON.stringify(row.value ?? {})
    if (before.includes(SECRET_PREFIX)) continue
    db.update(tables.settings)
      .set({ value: encodeCfg({ ...(row.value as Record<string, unknown>) }), updatedAt: Date.now() })
      .where(eq(tables.settings.key, key))
      .run()
    encrypted++
  }
  return { scanned, encrypted }
}

// 直接执行时：迁移并打印结果
if (process.argv[1]?.includes('migrateSecrets')) {
  const r = migrateSecrets()
  console.log(`[secretbox] 扫描配置 ${r.scanned} 张，加密 ${r.encrypted} 张`)
}
