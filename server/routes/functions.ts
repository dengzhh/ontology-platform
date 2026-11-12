import { Hono, type Handler } from 'hono'
import { eq } from 'drizzle-orm'
import { db, tables } from '../db'
import { requireAuth } from '../auth'
import { resolveSpace, type SpaceInfo } from '../space'
import { runFunction, type FunctionRunResult } from '../engine/functionSandbox'
import type { SessionUser } from '../../shared/types'

/**
 * 本体函数可执行化路由（由 index.ts 统一挂载到 /api/functions）。
 *
 * 为兼容两种挂载方式（挂到 /api 或 /api/functions），每个端点同时登记
 * 「/functions/…」与「/:fnId/…」两种相对路径，二者复用同一处理逻辑。
 * 所有端点 requireAuth + resolveSpace，按 spaceId 强隔离，写操作全量留审计。
 */

type Ctx = { Variables: { user: SessionUser; space: SpaceInfo } }

/** 双路径登记：Hono 的 on/get/post 只接受单个路径字符串，不能用数组 */
function reg(method: 'GET' | 'POST', suffix: string, handler: Handler<Ctx>) {
  const path = `/functions/${suffix}`
  if (method === 'GET') functionRoutes.get(path, handler)
  else functionRoutes.post(path, handler)
}

function audit(user: SessionUser, action: string, target: string, detail?: Record<string, unknown>) {
  db.insert(tables.auditEvents).values({
    id: `AE-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    actor: user.name, action, target, detail, ip: '本地', createdAt: Date.now(),
  }).run()
}

/** 空间内的函数登记行 */
function findFunction(fnId: string, spaceId: string) {
  return db.select().from(tables.ontologyFunctions).all()
    .find((f) => f.id === fnId && f.spaceId === spaceId)
}

/** 某函数的全部版本（按 version 降序） */
function versionsOf(fnId: string, spaceId: string) {
  return db.select().from(tables.functionVersions).all()
    .filter((v) => v.functionId === fnId && v.spaceId === spaceId)
    .sort((a, b) => b.version - a.version)
}

/** 某函数下的指定版本（含空间校验） */
function findVersion(fnId: string, versionId: string, spaceId: string) {
  return db.select().from(tables.functionVersions).all()
    .find((v) => v.id === versionId && v.functionId === fnId && v.spaceId === spaceId)
}

/**
 * 规整测试输入：字符串按 JSON 解析（失败则当作普通字符串），对象/数值原样使用；缺省 {}。
 * 沙箱接收的是规整后的值，避免把「JSON 文本」误当成业务入参。
 */
function parseInput(raw: unknown): unknown {
  if (raw === undefined || raw === null) return {}
  if (typeof raw === 'string') {
    const t = raw.trim()
    if (!t) return {}
    try { return JSON.parse(t) as unknown } catch { return t }
  }
  return raw
}

/** 把发布指针移动到指定版本：该版本设为已发布，同函数其余版本回落草稿（真实写库） */
function setPublished(fnId: string, versionId: string, spaceId: string): void {
  const all = db.select().from(tables.functionVersions).all()
    .filter((v) => v.functionId === fnId && v.spaceId === spaceId)
  const now = Date.now()
  for (const v of all) {
    const published = v.id === versionId
    db.update(tables.functionVersions).set({
      status: published ? '已发布' : '草稿',
      publishedAt: published ? now : v.publishedAt,
    }).where(eq(tables.functionVersions.id, v.id)).run()
  }
}

export const functionRoutes = new Hono<Ctx>()
functionRoutes.use('*', requireAuth)
functionRoutes.use('*', async (c, next) => {
  const user = c.get('user')
  const space = resolveSpace(c, user)
  if (!space) return c.json({ error: '尚无可访问的本体空间' }, 403)
  c.set('space', space)
  await next()
})

/* ---------------- 版本列表 ---------------- */

reg('GET', ':fnId/versions', (c) => {
  const space = c.get('space')
  const fnId = c.req.param('fnId') as string
  const fn = findFunction(fnId, space.id)
  if (!fn) return c.json({ error: '函数不存在（当前空间）' }, 404)
  return c.json({ versions: versionsOf(fnId, space.id) })
})

/* ---------------- 新建草稿版本（version=max+1，自动跑一次测试） ---------------- */

reg('POST', ':fnId/versions', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const fnId = c.req.param('fnId') as string
  const fn = findFunction(fnId, space.id)
  if (!fn) return c.json({ error: '函数不存在（当前空间）' }, 404)
  const body = await c.req.json<{ body: string; lang?: string; testInput?: unknown }>().catch(() => null)
  if (!body || typeof body.body !== 'string' || !body.body.trim()) {
    return c.json({ error: '请提供函数体（形如 function main(input) { … }）' }, 400)
  }
  const version = Math.max(0, ...versionsOf(fnId, space.id).map((v) => v.version)) + 1
  const input = parseInput(body.testInput)
  const test = runFunction(body.body, input)
  const id = `FV-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000)}`
  db.insert(tables.functionVersions).values({
    id, functionId: fnId, version, lang: body.lang ?? 'javascript', body: body.body,
    status: '草稿', testInput: JSON.stringify(input), testOutput: JSON.stringify(test),
    spaceId: space.id, createdAt: Date.now(),
  }).run()
  audit(user, '新建函数版本', `${fn.name} v${version}@${space.name}`, { functionId: fnId, versionId: id, version, testOk: test.ok })
  const row = findVersion(fnId, id, space.id)
  return c.json({ version: row, test })
})

/* ---------------- 测试某个版本（真实沙箱，回写 testOutput） ---------------- */

reg('POST', ':fnId/versions/:id/test', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const fnId = c.req.param('fnId') as string
  const id = c.req.param('id') as string
  const fn = findFunction(fnId, space.id)
  if (!fn) return c.json({ error: '函数不存在（当前空间）' }, 404)
  const v = findVersion(fnId, id, space.id)
  if (!v) return c.json({ error: '版本不存在（当前空间）' }, 404)
  const body = await c.req.json<{ input?: unknown }>().catch(() => ({}) as { input?: unknown })
  const test: FunctionRunResult = runFunction(v.body, parseInput(body.input))
  db.update(tables.functionVersions).set({ testOutput: JSON.stringify(test) }).where(eq(tables.functionVersions.id, id)).run()
  audit(user, '测试函数版本', `${fn.name} v${v.version}@${space.name}`, { functionId: fnId, versionId: id, ok: test.ok, durationMs: test.durationMs })
  return c.json(test)
})

/* ---------------- 发布：目标版本已发布，其余版本回落草稿 ---------------- */

reg('POST', ':fnId/versions/:id/publish', (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const fnId = c.req.param('fnId') as string
  const id = c.req.param('id') as string
  const fn = findFunction(fnId, space.id)
  if (!fn) return c.json({ error: '函数不存在（当前空间）' }, 404)
  const v = findVersion(fnId, id, space.id)
  if (!v) return c.json({ error: '版本不存在（当前空间）' }, 404)
  setPublished(fnId, id, space.id)
  audit(user, '发布函数版本', `${fn.name} v${v.version}@${space.name}`, { functionId: fnId, versionId: id, version: v.version })
  return c.json({ ok: true, version: findVersion(fnId, id, space.id) })
})

/* ---------------- 回滚：把指定版本重新设为已发布 ---------------- */

reg('POST', ':fnId/versions/:id/rollback', (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const fnId = c.req.param('fnId') as string
  const id = c.req.param('id') as string
  const fn = findFunction(fnId, space.id)
  if (!fn) return c.json({ error: '函数不存在（当前空间）' }, 404)
  const v = findVersion(fnId, id, space.id)
  if (!v) return c.json({ error: '版本不存在（当前空间）' }, 404)
  setPublished(fnId, id, space.id)
  audit(user, '回滚函数版本', `${fn.name} v${v.version}@${space.name}`, { functionId: fnId, versionId: id, version: v.version })
  return c.json({ ok: true, version: findVersion(fnId, id, space.id) })
})

/* ---------------- 运行入口：执行已发布版本（或指定版本），支撑动作/查询 ---------------- */

reg('POST', ':fnId/run', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const fnId = c.req.param('fnId') as string
  const fn = findFunction(fnId, space.id)
  if (!fn) return c.json({ error: '函数不存在（当前空间）' }, 404)
  const body = await c.req.json<{ input?: unknown; versionId?: string }>().catch(() => ({}) as { input?: unknown; versionId?: string })
  const v = body.versionId
    ? findVersion(fnId, body.versionId, space.id)
    : versionsOf(fnId, space.id).find((x) => x.status === '已发布')
  if (!v) {
    return c.json({ error: body.versionId ? '指定版本不存在（当前空间）' : '该函数尚无已发布版本，请先发布或用 versionId 指定版本' }, 404)
  }
  const test: FunctionRunResult = runFunction(v.body, parseInput(body.input))
  audit(user, '运行本体函数', `${fn.name} v${v.version}@${space.name}`, {
    functionId: fnId, versionId: v.id, version: v.version, ok: test.ok, durationMs: test.durationMs, specified: !!body.versionId,
  })
  return c.json({ ...test, functionId: fnId, versionId: v.id, version: v.version })
})
