import { Hono } from 'hono'
import { and, desc, eq, like } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { db, tables } from '../db'
import { requireAuth } from '../auth'
import { resolveSpace, type SpaceInfo } from '../space'
import type { SessionUser } from '../../shared/types'

/**
 * Apollo 本地部署编排状态机。
 *
 * 路由由 index.ts 统一挂载于 /api/apollo，文件内路径均为相对形态
 * （/deployments、/promote/:id ...），前端一律调 /apollo/...。
 *
 * 【诚实边界】本模块是「本地编排状态机」：确定性状态流转、环境门禁、
 * 冻结窗口、版本晋升 / 回滚、审计与派生统计全部真实读写 SQLite，
 * 但不执行真实 K8s / CI-CD 任务，也不连接外部集群（升级时可对接）。
 */
type Ctx = { Variables: { user: SessionUser; space: SpaceInfo } }
export const apolloRoutes = new Hono<Ctx>()

type Env = 'dev' | 'staging' | 'prod'
type DeployStatus = '构建中' | '成功' | '失败' | '已回滚'
type VersionRelation = '同步' | '版本滞后' | '预发领先' | '未部署'
type Deployment = typeof tables.deployments.$inferSelect
type NewDeployment = typeof tables.deployments.$inferInsert
type BuildInput = Omit<NewDeployment, 'id' | 'status' | 'durationMs' | 'createdAt'> & { createdAt?: number }

const ENVS: Env[] = ['dev', 'staging', 'prod']
const ENV_LABEL: Record<Env, string> = { dev: '开发环境', staging: '预发环境', prod: '生产环境' }
const NEXT_ENV: Record<'dev' | 'staging', Env> = { dev: 'staging', staging: 'prod' }
/** 冻结窗口：每月 8 / 9 日（集团季度结算）暂停一切生产发布 */
const FREEZE_DAYS = [8, 9]
const FREEZE_REASON = '集团季度结算'
const DAY = 86_400_000
/** 演示历史标记，便于 demo-data/load.mjs --clean 精确清理（message LIKE 'DEMO_%'） */
const SEED_TAG = 'DEMO_APOLLO_'

function isEnv(v: string): v is Env {
  return ENVS.includes(v as Env)
}

function isFrozenProdDay(now = new Date()): boolean {
  return FREEZE_DAYS.includes(now.getDate())
}

/** 种子历史落在 8 / 9 日时顺延一天，避免与冻结窗口规则自相矛盾 */
function safeProdTime(t: number): number {
  let x = t
  while (isFrozenProdDay(new Date(x))) x += DAY
  return x
}

function dateStr(t: number): string {
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 确定性耗时：环境基线 + 版本号哈希抖动（无真实 CI 计时，同输入同输出） */
function durationOf(version: string, env: Env): number {
  let h = 0
  for (const ch of version) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const base = env === 'dev' ? 180_000 : env === 'staging' ? 260_000 : 340_000
  return base + (h % 90_000)
}

/** 回滚动作确定性耗时（比完整构建短） */
function rollbackDuration(version: string): number {
  let h = 0
  for (const ch of version) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return 45_000 + (h % 25_000)
}

/** 版本数值化：v2.8.1 → 2_008_001，用于版本差异与滞后计算 */
function versionScore(v: string): number {
  const [a = 0, b = 0, c = 0] = (v.match(/\d+/g) ?? []).map(Number)
  return a * 1_000_000 + b * 1_000 + c
}

function audit(actor: string, action: string, target: string, detail?: Record<string, unknown>) {
  db.insert(tables.auditEvents).values({
    id: `AE-${randomUUID()}`,
    actor, action, target, detail, ip: '本地', createdAt: Date.now(),
  }).run()
}

/** 当前空间全部部署记录，按 createdAt 降序（id 兜底同毫秒排序） */
function allOf(spaceId: string): Deployment[] {
  return db.select().from(tables.deployments)
    .where(eq(tables.deployments.spaceId, spaceId))
    .orderBy(desc(tables.deployments.createdAt), desc(tables.deployments.id))
    .all()
}

function byId(spaceId: string, id: string): Deployment | undefined {
  return db.select().from(tables.deployments)
    .where(and(eq(tables.deployments.spaceId, spaceId), eq(tables.deployments.id, id)))
    .get()
}

/** 某环境上一条成功记录（rows 已按时间降序） */
function lastSuccess(rows: Deployment[], env: Env): Deployment | undefined {
  return rows.find((r) => r.env === env && r.status === '成功')
}

/** 某环境当前生效版本：最新一条已收敛记录（成功 / 已回滚），回滚后即为回退目标版本 */
function activeVersion(rows: Deployment[], env: Env): string {
  const r = rows.find((x) => x.env === env && (x.status === '成功' || x.status === '已回滚'))
  return r?.version ?? ''
}

function fmtTime(t: number): string {
  return new Date(t).toLocaleString('zh-CN', { hour12: false })
}

function fmtDuration(ms: number): string {
  if (ms <= 0) return '—'
  const s = Math.round(ms / 1000)
  return s >= 60 ? `${Math.floor(s / 60)}分${String(s % 60).padStart(2, '0')}秒` : `${s}秒`
}

function toDto(r: Deployment) {
  return {
    id: r.id, version: r.version, env: r.env, status: r.status,
    commit: r.commit, message: r.message, operator: r.operator,
    previousId: r.previousId, durationMs: r.durationMs, spaceId: r.spaceId,
    createdAt: r.createdAt, time: fmtTime(r.createdAt),
    duration: fmtDuration(r.durationMs),
    envLabel: ENV_LABEL[r.env as Env] ?? r.env,
  }
}

/** 本地状态机：先落「构建中」，再按确定性规则收敛为「成功」；返回最终记录（真实写库） */
function runBuild(spaceId: string, input: BuildInput): Deployment {
  const id = `DP-${randomUUID()}`
  const createdAt = input.createdAt ?? Date.now()
  const durationMs = durationOf(input.version, input.env as Env)
  db.insert(tables.deployments).values({
    ...input, id, status: '构建中', durationMs: 0, createdAt,
  }).run()
  db.update(tables.deployments)
    .set({ status: '成功', durationMs })
    .where(eq(tables.deployments.id, id))
    .run()
  return db.select().from(tables.deployments).where(eq(tables.deployments.id, id)).get()!
}

/* ============================ 鉴权 + 空间隔离 ============================ */

apolloRoutes.use('*', requireAuth)
apolloRoutes.use('*', async (c, next) => {
  const space = resolveSpace(c, c.get('user'))
  if (!space) return c.json({ error: '尚无可访问的本体空间' }, 403)
  c.set('space', space)
  await next()
})

/* ============================ 1. 部署记录 + 派生统计 ============================ */

/** GET /deployments 当前空间部署记录（createdAt 降序）+ 各环境最新成功版本 / 成功率 */
apolloRoutes.get('/deployments', (c) => {
  const space = c.get('space')
  const rows = allOf(space.id)
  const count = (s: DeployStatus) => rows.filter((r) => r.status === s).length
  const success = count('成功')
  const failed = count('失败')
  const finished = success + failed
  const successRate = finished === 0 ? 0 : Math.round((success / finished) * 1000) / 10

  const latest = (env: Env) => lastSuccess(rows, env) ?? null
  const brief = (r: Deployment | null) => r ? { id: r.id, version: r.version, createdAt: r.createdAt, time: fmtTime(r.createdAt) } : null

  return c.json({
    deployments: rows.map(toDto),
    total: rows.length,
    stats: {
      total: rows.length,
      success, failed,
      building: count('构建中'),
      rolledBack: count('已回滚'),
      finished,
      successRate,
      /** 当前生产版本 = 生产环境最新已收敛记录版本（回滚后为回退目标版本） */
      currentProdVersion: activeVersion(rows, 'prod') || '—',
      latestProdSuccessVersion: latest('prod')?.version ?? '—',
      latestSuccess: { dev: brief(latest('dev')), staging: brief(latest('staging')), prod: brief(latest('prod')) },
      byEnv: ENVS.map((env) => ({
        env, label: ENV_LABEL[env], total: rows.filter((r) => r.env === env).length,
        success: rows.filter((r) => r.env === env && r.status === '成功').length,
        activeVersion: activeVersion(rows, env) || '—',
      })),
    },
    note: '本地编排状态机：记录真实写库；派生统计按当前空间全部部署记录实时计算。',
    real: true,
  })
})

/* ============================ 2. 新建部署 ============================ */

type DeployBody = { version?: string; env?: string; commit?: string; message?: string }

/** POST /deploy {version, env, commit?, message?} 构建中→成功；prod 需 staging 同版本成功 + 冻结窗口校验 */
apolloRoutes.post('/deploy', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const b = await c.req.json<DeployBody>().catch((): DeployBody => ({}))

  const version = String(b.version ?? '').trim()
  const envRaw = String(b.env ?? '').trim()
  const commit = String(b.commit ?? '').trim()
  const message = String(b.message ?? '').trim()
  if (!version) return c.json({ error: '请填写版本号 version' }, 400)
  if (!isEnv(envRaw)) return c.json({ error: 'env 必须为 dev / staging / prod' }, 400)
  const env: Env = envRaw

  const rows = allOf(space.id)
  if (env === 'prod') {
    if (isFrozenProdDay()) {
      return c.json({ error: `冻结窗口：每月 ${FREEZE_DAYS.join(' / ')} 日（${FREEZE_REASON}）暂停生产发布，请改期或改投 dev / staging` }, 409)
    }
    const staged = rows.find((r) => r.env === 'staging' && r.status === '成功' && r.version === version)
    if (!staged) {
      return c.json({ error: `未通过 staging：版本 ${version} 需先在 staging 成功部署（或使用版本晋升）` }, 409)
    }
  }

  const previousId = lastSuccess(rows, env)?.id ?? ''
  const created = runBuild(space.id, {
    version, env, commit,
    message: message || `新建部署 ${version} · ${ENV_LABEL[env]}`,
    operator: user.name, previousId, spaceId: space.id,
  })
  audit(user.name, '新建部署', `${env} · ${version}`, {
    deploymentId: created.id, version, env, previousId,
    stateFlow: ['构建中', '成功'], durationMs: created.durationMs,
  })

  return c.json({
    deployment: toDto(created),
    stateFlow: ['构建中', '成功'],
    previousId,
    real: true,
  })
})

/* ============================ 3. 版本晋升 ============================ */

/** POST /promote/:id dev→staging→prod；prod 需 staging 同版本成功；返回新记录 */
apolloRoutes.post('/promote/:id', (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const id = c.req.param('id')
  const rows = allOf(space.id)
  const src = rows.find((r) => r.id === id)
  if (!src) return c.json({ error: '部署记录不存在或不属于当前空间' }, 404)
  if (src.status !== '成功') return c.json({ error: `仅「成功」记录可晋升，当前状态为「${src.status}」` }, 409)
  if (src.env === 'prod') return c.json({ error: '生产环境已是流水线终点，无可晋升的下一环境' }, 409)

  const nextEnv = NEXT_ENV[src.env as 'dev' | 'staging']
  if (nextEnv === 'prod') {
    if (isFrozenProdDay()) {
      return c.json({ error: `冻结窗口：每月 ${FREEZE_DAYS.join(' / ')} 日（${FREEZE_REASON}）暂停生产发布，晋升至 prod 已被拦截` }, 409)
    }
    const staged = rows.find((r) => r.env === 'staging' && r.status === '成功' && r.version === src.version)
    if (!staged) return c.json({ error: `未通过 staging：版本 ${src.version} 尚无 staging 成功记录` }, 409)
  }

  const previousId = lastSuccess(rows, nextEnv)?.id ?? ''
  const created = runBuild(space.id, {
    version: src.version, env: nextEnv, commit: src.commit,
    message: `版本晋升 ${src.env} → ${nextEnv}（源自 ${src.id}）`,
    operator: user.name, previousId, spaceId: space.id,
  })
  audit(user.name, '版本晋升', `${src.env} → ${nextEnv} · ${src.version}`, {
    sourceId: src.id, newId: created.id, from: src.env, to: nextEnv,
    version: src.version, previousId, stateFlow: ['构建中', '成功'],
  })

  return c.json({
    deployment: toDto(created),
    from: src.env, to: nextEnv, version: src.version, previousId,
    real: true,
  })
})

/* ============================ 4. 回滚 ============================ */

/** POST /rollback/:id 回退到该记录 previousId 指向的版本，新建 status='已回滚' 记录；返回回滚目标版本 */
apolloRoutes.post('/rollback/:id', (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const id = c.req.param('id')
  const rows = allOf(space.id)
  const src = rows.find((r) => r.id === id)
  if (!src) return c.json({ error: '部署记录不存在或不属于当前空间' }, 404)
  if (src.status !== '成功') return c.json({ error: `仅「成功」记录可回滚，当前状态为「${src.status}」` }, 409)
  if (!src.previousId) return c.json({ error: '该记录没有可回退的上一条成功版本（previousId 为空）' }, 409)

  const target = byId(space.id, src.previousId)
  if (!target) return c.json({ error: `回退目标记录 ${src.previousId} 不存在` }, 409)
  if (target.env !== src.env) return c.json({ error: '回退目标与当前记录不属于同一环境，拒绝回滚' }, 409)

  const env = src.env as Env
  const newId = `DP-${randomUUID()}`
  const durationMs = rollbackDuration(target.version)
  db.insert(tables.deployments).values({
    id: newId, version: target.version, env, status: '已回滚',
    commit: target.commit,
    message: `回滚 ${src.version} → ${target.version}（源自 ${src.id}）`,
    operator: user.name, previousId: src.id, durationMs,
    spaceId: space.id, createdAt: Date.now(),
  }).run()
  const created = byId(space.id, newId)!
  audit(user.name, '部署回滚', `${env} · 回退至 ${target.version}`, {
    sourceId: src.id, targetId: target.id, newId,
    fromVersion: src.version, toVersion: target.version, env,
    /** 冻结窗口仅限制生产「发布」，紧急回滚不受限 */
    duringFreezeWindow: isFrozenProdDay(),
  })

  return c.json({
    deployment: toDto(created),
    rollbackToVersion: target.version,
    fromVersion: src.version,
    env,
    note: '已新建「已回滚」记录，当前生效版本回退至目标版本；紧急回滚不受冻结窗口限制。',
    real: true,
  })
})

/* ============================ 5. 冻结窗口 ============================ */

/** GET /freeze-windows 冻结窗口规则（每月 8 / 9 日 · 季度结算） */
apolloRoutes.get('/freeze-windows', (c) => {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  const windows = FREEZE_DAYS.map((day) => ({ day, date: dateStr(new Date(y, m, day).getTime()) }))
  return c.json({
    rule: {
      days: FREEZE_DAYS,
      period: '每月',
      scope: 'prod（dev / staging 不受限）',
      reason: FREEZE_REASON,
      description: `每月 ${FREEZE_DAYS.join(' / ')} 日为${FREEZE_REASON}冻结窗口，暂停一切生产（prod）发布与晋升至生产；紧急回滚不受限。`,
    },
    days: FREEZE_DAYS,
    reason: FREEZE_REASON,
    scopeEnvs: ['prod'],
    month: `${y}-${String(m + 1).padStart(2, '0')}`,
    windows,
    today: {
      date: dateStr(now.getTime()),
      day: now.getDate(),
      isFrozen: isFrozenProdDay(now),
      affectedEnvs: isFrozenProdDay(now) ? ['prod'] : [],
    },
    real: true,
  })
})

/* ============================ 6. 演示历史种子 ============================ */

interface SeedItem {
  version: string; env: Env; status: DeployStatus; commit: string
  message: string; t: number; durationMs: number
}

/** POST /seed 生成一组 dev / staging / prod 多版本演示历史（幂等：先清本模块旧种子），返回条数 */
apolloRoutes.post('/seed', (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const now = Date.now()

  // 幂等：仅清理本模块产生的种子，不动用户真实部署记录
  db.delete(tables.deployments)
    .where(and(eq(tables.deployments.spaceId, space.id), like(tables.deployments.message, `${SEED_TAG}%`)))
    .run()

  const plan: { version: string; commit: string; daysAgo: number; envs: Env[] }[] = [
    { version: 'v2.6.0', commit: 'c1a0f42', daysAgo: 36, envs: ['dev', 'staging', 'prod'] },
    { version: 'v2.7.0', commit: 'd2b1e53', daysAgo: 29, envs: ['dev', 'staging', 'prod'] },
    { version: 'v2.7.5', commit: 'e3c2f64', daysAgo: 22, envs: ['dev', 'staging', 'prod'] },
    { version: 'v2.8.0', commit: 'f4d3a75', daysAgo: 15, envs: ['dev', 'staging', 'prod'] },
    { version: 'v2.8.1', commit: 'a3f9c21', daysAgo: 8, envs: ['dev', 'staging', 'prod'] },
  ]

  const items: SeedItem[] = []
  for (const p of plan) {
    p.envs.forEach((env, i) => {
      const raw = now - p.daysAgo * DAY + i * 6 * 3_600_000
      const t = env === 'prod' ? safeProdTime(raw) : raw
      items.push({
        version: p.version, env, status: '成功', commit: p.commit,
        message: `${SEED_TAG}${p.version} ${ENV_LABEL[env]}部署成功`,
        t, durationMs: durationOf(p.version, env),
      })
    })
  }
  // 一条失败构建（拉低成功率）+ 一条进行中构建（体现构建中数量）
  items.push({
    version: 'v2.7.4-rc1', env: 'dev', status: '失败', commit: 'b0ad1c9',
    message: `${SEED_TAG}v2.7.4-rc1 依赖校验未通过`, t: now - 23 * DAY, durationMs: 95_000,
  })
  items.push({
    version: 'v2.8.2-rc1', env: 'dev', status: '构建中', commit: 'e55b1c0',
    message: `${SEED_TAG}v2.8.2-rc1 新版本构建中`, t: now, durationMs: 0,
  })
  items.sort((a, b) => a.t - b.t)

  const lastSuccessByEnv: Record<Env, string> = { dev: '', staging: '', prod: '' }
  for (const it of items) {
    const id = `DP-${randomUUID()}`
    db.insert(tables.deployments).values({
      id, version: it.version, env: it.env, status: it.status,
      commit: it.commit, message: it.message,
      operator: it.status === '构建中' ? '周计划' : '陈星野',
      previousId: lastSuccessByEnv[it.env], durationMs: it.durationMs,
      spaceId: space.id, createdAt: it.t,
    }).run()
    if (it.status === '成功') lastSuccessByEnv[it.env] = id
  }

  audit(user.name, '载入 Apollo 演示历史', `生成 ${items.length} 条部署记录`, {
    created: items.length, versions: plan.map((p) => p.version), spaceId: space.id,
  })

  return c.json({
    created: items.length,
    total: allOf(space.id).length,
    versions: plan.map((p) => p.version),
    note: '演示历史真实写库（message 带 DEMO_APOLLO_ 前缀可被验证脚本清理）；重复调用会先清理旧种子，不会叠加。',
    real: true,
  })
})

/* ============================ 7. 集群视图（真实派生） ============================ */

/** GET /clusters 生产 / 灾备 / 海外 / 边缘 4 个集群，版本差异与滞后状态按真实记录计算 */
apolloRoutes.get('/clusters', (c) => {
  const space = c.get('space')
  const rows = allOf(space.id)
  const prodVersion = activeVersion(rows, 'prod')
  const stagingVersion = activeVersion(rows, 'staging')
  const devVersion = activeVersion(rows, 'dev')

  /** 生产环境历史成功版本（新→旧），用于计算滞后版本数 */
  const prodSuccessVersions = Array.from(new Set(
    rows.filter((r) => r.env === 'prod' && r.status === '成功').map((r) => r.version),
  )).sort((a, b) => versionScore(b) - versionScore(a))
  const overseasVersion = prodSuccessVersions[1] ?? prodVersion
  const edgeVersion = devVersion ? `${devVersion}-edge` : ''

  const prodScore = prodVersion ? versionScore(prodVersion) : 0
  function relation(version: string): { versionRelation: VersionRelation; diffFromProd: number; lagVersions: string[] } {
    if (!version || !prodVersion) return { versionRelation: '未部署', diffFromProd: 0, lagVersions: [] }
    const base = version.replace(/-edge$/, '')
    const score = versionScore(base)
    const diff = prodScore - score
    const lagVersions = prodSuccessVersions.filter((v) => versionScore(v) > score)
    const versionRelation: VersionRelation = diff > 0 ? '版本滞后' : diff < 0 ? '预发领先' : '同步'
    return { versionRelation, diffFromProd: diff, lagVersions }
  }

  interface Def {
    name: string; region: string; version: string; nodes: number
    sourceEnv: string; derivation: string; desc: string
    mode: '健康' | '受限模式' | '未部署'
  }
  const defs: Def[] = [
    {
      name: '华东生产集群', region: 'cn-east-1 · 上海', version: prodVersion, nodes: 6,
      sourceEnv: 'prod', derivation: '生产环境最新生效版本',
      mode: prodVersion ? '健康' : '未部署', desc: '承载全部生产流量，3 可用区高可用',
    },
    {
      name: '华北灾备集群', region: 'cn-north-1 · 北京', version: prodVersion, nodes: 2,
      sourceEnv: 'prod', derivation: '与生产集群保持同版本（策略：一致）',
      mode: prodVersion ? '健康' : '未部署', desc: '每日增量同步，故障可 15 分钟接管',
    },
    {
      name: '法兰克福集群', region: 'eu-central-1 · 法兰克福', version: overseasVersion, nodes: 2,
      sourceEnv: 'prod · 上一成功版本', derivation: '海外数据驻留策略：允许滞后一个生产版本',
      mode: overseasVersion ? '健康' : '未部署', desc: '海外客户数据驻留，按策略滞后灰度升级',
    },
    {
      name: '边缘 · 佛山车间', region: 'edge · F2 车间', version: edgeVersion, nodes: 1,
      sourceEnv: 'dev', derivation: '开发环境版本裁剪为 edge 构建',
      mode: edgeVersion ? '受限模式' : '未部署', desc: '断网自治运行，每小时回传数据',
    },
  ]

  const clusters = defs.map((d) => {
    const r = relation(d.version)
    return {
      ...d,
      version: d.version || '—',
      ...r,
      status: d.mode,
      tag: r.versionRelation === '版本滞后' ? `滞后 ${r.lagVersions.length} 个版本`
        : r.versionRelation === '预发领先' ? '预发领先' : undefined,
    }
  })

  return c.json({
    clusters,
    prodVersion: prodVersion || '—',
    stagingVersion: stagingVersion || '—',
    devVersion: devVersion || '—',
    prodSuccessVersions,
    note: '集群视图由部署记录真实派生：版本差异按版本号数值化比较，滞后状态按生产历史成功版本数计算；不连接外部 K8s 集群。',
    real: true,
  })
})
