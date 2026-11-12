import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, tables } from '../db'
import { requireAuth } from '../auth'
import { resolveSpace, spaceCanModel, type SpaceInfo } from '../space'
import { llmComplete } from './ai'
import { listTerms, resolveTerms } from '../engine/semantic'
import { runFunction } from '../engine/functionSandbox'
import type { SessionUser } from '../../shared/types'

/** 本体建模 CRUD（P2，空间感知）：对象/链接/动作/函数类型 + 文档智能识别，变更全量留痕 */

interface PropertyDef {
  key: string
  name: string
  type: string
  required?: boolean
  enumValues?: string[]
}

type Ctx = { Variables: { user: SessionUser; space: SpaceInfo } }

function audit(user: SessionUser, action: string, target: string, detail?: Record<string, unknown>) {
  db.insert(tables.auditEvents).values({
    id: `AE-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    actor: user.name, action, target, detail, ip: '本地', createdAt: Date.now(),
  }).run()
}

function slug(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '') || `t_${Date.now().toString(36)}`
}

export const ontologyRoutes = new Hono<Ctx>()
ontologyRoutes.use('*', requireAuth)
ontologyRoutes.use('*', async (c, next) => {
  const user = c.get('user')
  const space = resolveSpace(c, user)
  if (!space) return c.json({ error: '尚无可访问的本体空间' }, 403)
  c.set('space', space)
  await next()
})

function canModel(user: SessionUser, space: SpaceInfo): boolean {
  return spaceCanModel(user, space)
}

/** 空间内类型集合 */
function spaceTypes(spaceId: string) {
  return db.select().from(tables.objectTypes).all().filter((t) => t.spaceId === spaceId)
}

/* ---------------- 对象类型 ---------------- */

ontologyRoutes.get('/types', (c) => {
  const space = c.get('space')
  const types = spaceTypes(space.id)
  const objs = db.select().from(tables.objects).all().filter((o) => o.spaceId === space.id)
  return c.json({
    space: { id: space.id, name: space.name, kind: space.kind },
    types: types
      .map((t) => ({ ...t, count: objs.filter((o) => o.typeId === t.id).length }))
      .sort((a, b) => a.createdAt - b.createdAt),
  })
})

ontologyRoutes.post('/types', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  if (!canModel(user, space)) return c.json({ error: '当前空间需要建模权限（管理员/数据工程师，或个人空间的成员）' }, 403)
  const body = await c.req.json<{
    name: string; apiName?: string; desc?: string; color?: string; icon?: string
    primaryKey?: string; properties?: PropertyDef[]; viewTemplate?: { titleKey?: string; subKey?: string; badgeKey?: string }
  }>()
  if (!body.name?.trim()) return c.json({ error: '请填写类型名称' }, 400)
  const id = slug(body.apiName || body.name)
  if (spaceTypes(space.id).some((t) => t.id === id)) return c.json({ error: `标识「${id}」已存在` }, 409)
  const props = (body.properties ?? []).filter((p) => p.key && p.name)
  const now = Date.now()
  db.insert(tables.objectTypes).values({
    id, apiName: body.apiName?.trim() || id, name: body.name.trim(), desc: body.desc ?? '',
    color: body.color || '#3b82f6', icon: body.icon || 'Box',
    primaryKey: body.primaryKey || props[0]?.name || 'id', properties: props,
    viewTemplate: body.viewTemplate ?? { titleKey: props[0]?.key, subKey: props[1]?.key },
    spaceId: space.id, createdAt: now, updatedAt: now,
  }).run()
  audit(user, '新建对象类型', `${body.name}(${id})@${space.name}`, { properties: props.length })
  return c.json({ type: db.select().from(tables.objectTypes).where(eq(tables.objectTypes.id, id)).get() })
})

ontologyRoutes.patch('/types/:id', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  if (!canModel(user, space)) return c.json({ error: '无建模权限' }, 403)
  const id = c.req.param('id') as string
  const prev = spaceTypes(space.id).find((t) => t.id === id)
  if (!prev) return c.json({ error: '类型不存在（当前空间）' }, 404)
  const body = await c.req.json<{
    name?: string; desc?: string; color?: string; icon?: string; primaryKey?: string; properties?: PropertyDef[]
    viewTemplate?: { titleKey?: string; subKey?: string; badgeKey?: string }
  }>()
  const set: Record<string, unknown> = { updatedAt: Date.now() }
  if (body.name !== undefined) set.name = body.name
  if (body.desc !== undefined) set.desc = body.desc
  if (body.color !== undefined) set.color = body.color
  if (body.icon !== undefined) set.icon = body.icon
  if (body.primaryKey !== undefined) set.primaryKey = body.primaryKey
  if (body.viewTemplate !== undefined) set.viewTemplate = body.viewTemplate
  if (body.properties !== undefined) set.properties = body.properties.filter((p) => p.key && p.name)
  db.update(tables.objectTypes).set(set).where(eq(tables.objectTypes.id, id)).run()
  audit(user, '更新对象类型', `${prev.name}(${id})@${space.name}`, { changed: Object.keys(body) })
  return c.json({ type: db.select().from(tables.objectTypes).where(eq(tables.objectTypes.id, id)).get() })
})

ontologyRoutes.delete('/types/:id', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  if (!canModel(user, space)) return c.json({ error: '无建模权限' }, 403)
  const id = c.req.param('id') as string
  const t = spaceTypes(space.id).find((x) => x.id === id)
  if (!t) return c.json({ error: '类型不存在' }, 404)
  const instCount = db.select().from(tables.objects).all().filter((o) => o.typeId === id && o.spaceId === space.id).length
  if (instCount > 0) return c.json({ error: `存在 ${instCount} 个实例，请先清理数据后再删除类型` }, 409)
  const linkRefs = db.select().from(tables.linkTypes).all().filter((l) => l.spaceId === space.id && (l.sourceTypeId === id || l.targetTypeId === id)).length
  if (linkRefs > 0) return c.json({ error: `被 ${linkRefs} 个链接类型引用，请先删除相关链接类型` }, 409)
  db.delete(tables.objectTypes).where(eq(tables.objectTypes.id, id)).run()
  audit(user, '删除对象类型', `${t.name}(${id})@${space.name}`)
  return c.json({ ok: true })
})

/* ---------------- 链接类型 ---------------- */

ontologyRoutes.get('/links', (c) => {
  const space = c.get('space')
  const links = db.select().from(tables.linkTypes).all().filter((l) => l.spaceId === space.id)
  const allLinks = db.select().from(tables.objectLinks).all().filter((l) => l.spaceId === space.id)
  const types = spaceTypes(space.id)
  const typeMap = new Map(types.map((t) => [t.id, t]))
  return c.json({
    links: links.map((l) => ({
      ...l,
      count: allLinks.filter((il) => il.linkTypeId === l.id).length,
      sourceName: typeMap.get(l.sourceTypeId)?.name ?? l.sourceTypeId,
      targetName: typeMap.get(l.targetTypeId)?.name ?? l.targetTypeId,
    })),
  })
})

ontologyRoutes.post('/links', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  if (!canModel(user, space)) return c.json({ error: '无建模权限' }, 403)
  const body = await c.req.json<{ name: string; sourceTypeId: string; targetTypeId: string; cardinality?: string; desc?: string }>()
  if (!body.name?.trim() || !body.sourceTypeId || !body.targetTypeId) return c.json({ error: '请填写名称与两端类型' }, 400)
  const id = slug(body.name)
  if (db.select().from(tables.linkTypes).all().some((l) => l.id === id && l.spaceId === space.id)) return c.json({ error: `链接类型「${id}」已存在` }, 409)
  db.insert(tables.linkTypes).values({
    id, name: body.name.trim(), sourceTypeId: body.sourceTypeId, targetTypeId: body.targetTypeId,
    cardinality: body.cardinality ?? '1:N', desc: body.desc ?? '', spaceId: space.id, createdAt: Date.now(),
  }).run()
  audit(user, '新建链接类型', `${body.name}(${id})@${space.name}`)
  return c.json({ ok: true })
})

ontologyRoutes.delete('/links/:id', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  if (!canModel(user, space)) return c.json({ error: '无建模权限' }, 403)
  const id = c.req.param('id') as string
  const l = db.select().from(tables.linkTypes).all().find((x) => x.id === id && x.spaceId === space.id)
  if (!l) return c.json({ error: '链接类型不存在' }, 404)
  const instCount = db.select().from(tables.objectLinks).all().filter((il) => il.linkTypeId === id && il.spaceId === space.id).length
  if (instCount > 0) return c.json({ error: `存在 ${instCount} 条链接实例，请先清理` }, 409)
  db.delete(tables.linkTypes).where(eq(tables.linkTypes.id, id)).run()
  audit(user, '删除链接类型', `${l.name}(${id})`)
  return c.json({ ok: true })
})

/* ---------------- 动作类型 ---------------- */

ontologyRoutes.get('/actions', (c) => {
  const space = c.get('space')
  const actions = db.select().from(tables.actionTypes).all().filter((a) => a.spaceId === space.id)
  const logs = db.select().from(tables.actionLogs).all()
  const typeMap = new Map(spaceTypes(space.id).map((t) => [t.id, t.name]))
  return c.json({
    actions: actions.map((a) => ({
      ...a,
      targetName: typeMap.get(a.targetTypeId) ?? a.targetTypeId,
      execCount: logs.filter((lg) => lg.actionTypeId === a.id).length,
    })),
  })
})

ontologyRoutes.post('/actions', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  if (!canModel(user, space)) return c.json({ error: '无建模权限' }, 403)
  const body = await c.req.json<{
    name: string; targetTypeId: string; params?: PropertyDef[]; needsApproval?: boolean; desc?: string
    effect?: { kind: 'create' | 'update' | 'delete' | 'link'; setValues?: Record<string, string> }
  }>()
  if (!body.name?.trim() || !body.targetTypeId) return c.json({ error: '请填写名称与目标对象类型' }, 400)
  const id = slug(body.name)
  if (db.select().from(tables.actionTypes).all().some((a) => a.id === id && a.spaceId === space.id)) return c.json({ error: `动作类型「${id}」已存在` }, 409)
  db.insert(tables.actionTypes).values({
    id, name: body.name.trim(), targetTypeId: body.targetTypeId,
    params: body.params ?? [], effect: body.effect ?? { kind: 'update', setValues: {} },
    needsApproval: body.needsApproval ? 1 : 0, desc: body.desc ?? '', spaceId: space.id, createdAt: Date.now(),
  }).run()
  audit(user, '新建动作类型', `${body.name}(${id})@${space.name}`, { needsApproval: !!body.needsApproval })
  return c.json({ ok: true })
})

ontologyRoutes.patch('/actions/:id', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  if (!canModel(user, space)) return c.json({ error: '无建模权限' }, 403)
  const id = c.req.param('id') as string
  const prev = db.select().from(tables.actionTypes).all().find((a) => a.id === id && a.spaceId === space.id)
  if (!prev) return c.json({ error: '动作类型不存在' }, 404)
  const body = await c.req.json<{ name?: string; desc?: string; needsApproval?: boolean; params?: PropertyDef[] }>()
  const set: Partial<typeof tables.actionTypes.$inferInsert> = {}
  if (body.name !== undefined) set.name = body.name
  if (body.desc !== undefined) set.desc = body.desc
  if (body.needsApproval !== undefined) set.needsApproval = body.needsApproval ? 1 : 0
  if (body.params !== undefined) set.params = body.params
  if (Object.keys(set).length === 0) return c.json({ error: '无更新内容' }, 400)
  db.update(tables.actionTypes).set(set).where(eq(tables.actionTypes.id, id)).run()
  audit(user, '更新动作类型', `${prev.name}(${id})@${space.name}`, body as Record<string, unknown>)
  return c.json({ ok: true })
})

ontologyRoutes.delete('/actions/:id', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  if (!canModel(user, space)) return c.json({ error: '无建模权限' }, 403)
  const id = c.req.param('id') as string
  const a = db.select().from(tables.actionTypes).all().find((x) => x.id === id && x.spaceId === space.id)
  if (!a) return c.json({ error: '动作类型不存在' }, 404)
  const used = db.select().from(tables.actionLogs).all().filter((l) => l.actionTypeId === id).length
  if (used > 0) return c.json({ error: `已有 ${used} 条执行记录，为保留审计不建议删除` }, 409)
  db.delete(tables.actionTypes).where(eq(tables.actionTypes.id, id)).run()
  audit(user, '删除动作类型', `${a.name}(${id})`)
  return c.json({ ok: true })
})

/* ---------------- 函数 ---------------- */

ontologyRoutes.get('/functions', (c) => {
  const space = c.get('space')
  const fns = db.select().from(tables.ontologyFunctions).all().filter((f) => f.spaceId === space.id)
  const typeMap = new Map(spaceTypes(space.id).map((t) => [t.id, t.name]))
  const allVersions = db.select().from(tables.functionVersions).all().filter((v) => v.spaceId === space.id)
  return c.json({
    functions: fns.map((f) => {
      const vers = allVersions.filter((v) => v.functionId === f.id)
      const published = vers.find((v) => v.status === '已发布')
      return {
        ...f,
        linkedNames: f.linkedTypeIds.map((id) => typeMap.get(id) ?? id),
        versionCount: vers.length,
        publishedVersion: published ? published.version : null,
      }
    }),
  })
})

ontologyRoutes.post('/functions', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  if (!canModel(user, space)) return c.json({ error: '无建模权限' }, 403)
  const body = await c.req.json<{ name: string; desc?: string; lang?: string; linkedTypeIds?: string[]; body?: string; testInput?: unknown }>()
  if (!body.name?.trim()) return c.json({ error: '请填写函数名' }, 400)
  const id = slug(body.name)
  if (db.select().from(tables.ontologyFunctions).all().some((f) => f.id === id && f.spaceId === space.id)) return c.json({ error: '函数已存在' }, 409)
  db.insert(tables.ontologyFunctions).values({
    id, name: body.name.trim(), desc: body.desc ?? '', lang: body.lang ?? 'TypeScript',
    linkedTypeIds: body.linkedTypeIds ?? [], body: '// P6：可被 AIP 工具调用', spaceId: space.id, createdAt: Date.now(),
  }).run()
  audit(user, '新建函数', `${body.name}(${id})@${space.name}`)
  // 兼容旧行为：仅登记函数；若前端同时提交了可执行代码，顺带创建 v1 草稿并自动跑一次测试
  const code = typeof body.body === 'string' ? body.body.trim() : ''
  if (code) {
    const input = typeof body.testInput === 'string' ? body.testInput.trim() || '{}' : body.testInput ?? {}
    let parsedInput: unknown = input
    if (typeof parsedInput === 'string') {
      try { parsedInput = JSON.parse(parsedInput) as unknown } catch { /* 保留为普通字符串 */ }
    }
    const test = runFunction(code, parsedInput)
    const vid = `FV-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000)}`
    db.insert(tables.functionVersions).values({
      id: vid, functionId: id, version: 1, lang: 'javascript', body: code,
      status: '草稿', testInput: JSON.stringify(parsedInput), testOutput: JSON.stringify(test),
      spaceId: space.id, createdAt: Date.now(),
    }).run()
  }
  return c.json({ ok: true })
})

/** 函数版本列表（按 version 降序；供 GET /functions 之外的版本面板使用） */
ontologyRoutes.get('/functions/:fnId/versions', (c) => {
  const space = c.get('space')
  const fnId = c.req.param('fnId') as string
  const fn = db.select().from(tables.ontologyFunctions).all().find((f) => f.id === fnId && f.spaceId === space.id)
  if (!fn) return c.json({ error: '函数不存在（当前空间）' }, 404)
  const versions = db.select().from(tables.functionVersions).all()
    .filter((v) => v.functionId === fnId && v.spaceId === space.id)
    .sort((a, b) => b.version - a.version)
  return c.json({ versions })
})

/** 直接运行函数：执行已发布版本（或 versionId 指定版本），真实沙箱 + 留审计 */
ontologyRoutes.post('/functions/:fnId/run', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const fnId = c.req.param('fnId') as string
  const fn = db.select().from(tables.ontologyFunctions).all().find((f) => f.id === fnId && f.spaceId === space.id)
  if (!fn) return c.json({ error: '函数不存在（当前空间）' }, 404)
  const body = await c.req.json<{ input?: unknown; versionId?: string }>().catch(() => ({}) as { input?: unknown; versionId?: string })
  const all = db.select().from(tables.functionVersions).all().filter((v) => v.functionId === fnId && v.spaceId === space.id)
  const v = body.versionId
    ? all.find((x) => x.id === body.versionId)
    : all.find((x) => x.status === '已发布')
  if (!v) return c.json({ error: body.versionId ? '指定版本不存在（当前空间）' : '该函数尚无已发布版本，请先发布或用 versionId 指定版本' }, 404)
  let input: unknown = body.input ?? {}
  if (typeof input === 'string') {
    try { input = JSON.parse(input) as unknown } catch { /* 保留为普通字符串 */ }
  }
  const test = runFunction(v.body, input)
  audit(user, '运行本体函数', `${fn.name} v${v.version}@${space.name}`, {
    functionId: fnId, versionId: v.id, version: v.version, ok: test.ok, durationMs: test.durationMs, specified: !!body.versionId,
  })
  return c.json({ ...test, functionId: fnId, versionId: v.id, version: v.version })
})

/* ---------------- 接口（Interface） ---------------- */

interface InterfaceProp { key: string; name: string; type: string; required?: boolean }

ontologyRoutes.get('/interfaces', (c) => {
  const space = c.get('space')
  const rows = db.select().from(tables.interfaceTypes).all().filter((i) => i.spaceId === space.id)
  const typeMap = new Map(spaceTypes(space.id).map((t) => [t.id, t.name]))
  return c.json({
    interfaces: rows.map((i) => ({
      id: i.id, name: i.name, desc: i.desc,
      properties: i.properties, propCount: i.properties.length,
      implementedBy: i.implementedBy,
      implementedNames: i.implementedBy.map((id) => typeMap.get(id) ?? id),
      updatedAt: new Date(i.updatedAt).toLocaleString('zh-CN', { hour12: false }),
    })),
  })
})

/** 新建接口：name 必填；properties 为契约属性；implementedBy 校验必须是本空间已有对象类型 */
ontologyRoutes.post('/interfaces', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  if (!canModel(user, space)) return c.json({ error: '无建模权限' }, 403)
  type IfaceBody = { id?: string; name: string; desc?: string; properties?: InterfaceProp[]; implementedBy?: string[] }
  const body = await c.req.json<IfaceBody>().catch((): IfaceBody => ({ name: '' }))
  if (!body.name?.trim()) return c.json({ error: '请填写接口名称' }, 400)
  const known = new Set(spaceTypes(space.id).map((t) => t.id))
  const implementedBy = (body.implementedBy ?? []).filter((id) => known.has(id))
  const props = (body.properties ?? []).filter((p) => p.key?.trim() && p.name?.trim())
  const now = Date.now()
  if (body.id) {
    const prev = db.select().from(tables.interfaceTypes).where(eq(tables.interfaceTypes.id, body.id)).get()
    if (!prev) return c.json({ error: '接口不存在' }, 404)
    db.update(tables.interfaceTypes).set({ name: body.name.trim(), desc: body.desc ?? prev.desc, properties: props, implementedBy, updatedAt: now }).where(eq(tables.interfaceTypes.id, body.id)).run()
    audit(user, '更新接口', `${body.name}(${body.id})@${space.name}`)
    return c.json({ id: body.id })
  }
  const id = slug(body.name)
  // 中文名会被 slug 剔成空（走 t_ 时间戳兜底），因此查重按 name 而非 id
  if (db.select().from(tables.interfaceTypes).all().some((i) => i.name === body.name.trim() && i.spaceId === space.id)) return c.json({ error: '同名接口已存在' }, 409)
  db.insert(tables.interfaceTypes).values({ id, name: body.name.trim(), desc: body.desc ?? '', properties: props, implementedBy, spaceId: space.id, createdAt: now, updatedAt: now }).run()
  audit(user, '新建接口', `${body.name}(${id})@${space.name}`)
  return c.json({ id })
})

/** 接口符合性校验：检查每个实现类型是否真的具备契约属性 */
ontologyRoutes.get('/interfaces/:id/check', (c) => {
  const space = c.get('space')
  const iface = db.select().from(tables.interfaceTypes).where(eq(tables.interfaceTypes.id, c.req.param('id') as string)).get()
  if (!iface || iface.spaceId !== space.id) return c.json({ error: '接口不存在' }, 404)
  const types = spaceTypes(space.id)
  const results = iface.implementedBy.map((tid) => {
    const t = types.find((x) => x.id === tid)
    const tProps = new Set(((t?.properties ?? []) as PropertyDef[]).map((p) => p.key))
    const missing = iface.properties.filter((p) => !tProps.has(p.key)).map((p) => p.name)
    return { typeId: tid, typeName: t?.name ?? tid, ok: missing.length === 0, missing }
  })
  return c.json({ results: results.length ? results : null, propCount: iface.properties.length })
})

ontologyRoutes.delete('/interfaces/:id', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  if (!canModel(user, space)) return c.json({ error: '无建模权限' }, 403)
  const id = c.req.param('id') as string
  const i = db.select().from(tables.interfaceTypes).where(eq(tables.interfaceTypes.id, id)).get()
  if (!i || i.spaceId !== space.id) return c.json({ error: '接口不存在' }, 404)
  db.delete(tables.interfaceTypes).where(eq(tables.interfaceTypes.id, id)).run()
  audit(user, '删除接口', `${i.name}(${id})@${space.name}`)
  return c.json({ ok: true })
})

/* ---------------- 文档智能识别 → 本体候选 ---------------- */

const EXTRACT_SYSTEM = [
  '你是企业本体建模专家。从给定的文档中识别核心业务实体（对象类型）及其关系（链接类型），输出严格的 JSON（不要输出任何其他文字、不要代码块标记）。',
  '',
  '输出格式：',
  '{"objectTypes":[{"name":"类型名(2-6字)","desc":"一句话说明","properties":[{"name":"属性名","key":"英文key","type":"string|number|date|boolean|enum","required":true,"enumValues":["...仅enum时"]}]}],"linkTypes":[{"name":"关系名","source":"源类型name","target":"目标类型name","cardinality":"1:1|1:N|N:1|N:N","desc":"说明"}]}',
  '',
  '要求：对象类型 2-6 个；每个类型属性 3-8 个（第一个属性应是业务主键）；链接 0-4 条且 source/target 必须是已识别的类型名；不要臆造文档中没有的实体。',
].join('\n')

ontologyRoutes.post('/extract', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  if (!canModel(user, space)) return c.json({ error: '无建模权限' }, 403)
  const { text } = await c.req.json<{ text: string }>()
  if (!text?.trim() || text.trim().length < 20) return c.json({ error: '请提供至少 20 字的文档内容' }, 400)

  let reply: string
  try {
    reply = await llmComplete(EXTRACT_SYSTEM, text.slice(0, 8000))
  } catch (e) {
    if (e instanceof Error && e.message === 'AI_NOT_CONFIGURED') {
      return c.json({ error: 'AI_NOT_CONFIGURED', hint: '文档智能识别需要先在「控制面板 → AI 服务」配置大模型接口；也可以使用 JSON 导入' }, 400)
    }
    return c.json({ error: `模型调用失败：${e instanceof Error ? e.message : '未知错误'}` }, 502)
  }
  const cleaned = reply.replace(/```json|```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return c.json({ error: '模型未返回有效结构，请重试或改用 JSON 导入' }, 502)
  let parsed: { objectTypes?: unknown[]; linkTypes?: unknown[] }
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return c.json({ error: '模型返回的 JSON 解析失败，请重试' }, 502)
  }

  const PROP_TYPES_SET = new Set(['string', 'number', 'date', 'boolean', 'enum'])
  const objectTypes = (parsed.objectTypes ?? [])
    .filter((t): t is Record<string, unknown> => !!t && typeof (t as Record<string, unknown>).name === 'string')
    .slice(0, 8)
    .map((t) => ({
      name: String(t.name).slice(0, 20),
      desc: String(t.desc ?? '').slice(0, 80),
      properties: Array.isArray(t.properties)
        ? (t.properties as Record<string, unknown>[])
            .filter((p) => typeof p?.name === 'string' && typeof p?.key === 'string')
            .slice(0, 10)
            .map((p) => ({
              name: String(p.name).slice(0, 20),
              key: String(p.key).replace(/[^\w]/g, '').slice(0, 30) || 'field',
              type: PROP_TYPES_SET.has(String(p.type)) ? String(p.type) : 'string',
              required: !!p.required,
              enumValues: Array.isArray(p.enumValues) ? (p.enumValues as unknown[]).map(String).slice(0, 10) : undefined,
            }))
        : [],
    }))
  const known = new Set(objectTypes.map((t) => t.name))
  const linkTypes = (parsed.linkTypes ?? [])
    .filter((l): l is Record<string, unknown> => !!l && typeof (l as Record<string, unknown>).name === 'string')
    .slice(0, 6)
    .filter((l) => known.has(String(l.source)) && known.has(String(l.target)))
    .map((l) => ({
      name: String(l.name).slice(0, 20), source: String(l.source), target: String(l.target),
      cardinality: ['1:1', '1:N', 'N:1', 'N:N'].includes(String(l.cardinality)) ? String(l.cardinality) : '1:N',
      desc: String(l.desc ?? '').slice(0, 80),
    }))

  audit(user, '文档智能识别', `@${space.name} 识别出 ${objectTypes.length} 个候选类型 / ${linkTypes.length} 条候选链接`)
  return c.json({ candidates: { objectTypes, linkTypes } })
})


/* ---------------- 业务术语 / 认证指标（语义层，解析引擎见 engine/semantic.ts） ---------------- */

/** 术语列表 */
ontologyRoutes.get('/terms', (c) => {
  const space = c.get('space')
  return c.json({ terms: listTerms(space.id) })
})

/** 新建/编辑术语（建模权限）；typeId/propertyKey 会校验属于当前空间 */
type TermBody = {
  id?: string; term: string; synonyms?: string[]; typeId?: string; propertyKey?: string
  definition?: string; metricExpr?: string; certified?: boolean
}
ontologyRoutes.post('/terms', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  if (!canModel(user, space)) return c.json({ error: '无建模权限' }, 403)
  const body = await c.req.json<TermBody>().catch((): TermBody => ({ term: '' }))
  if (!body.term?.trim()) return c.json({ error: '请填写术语名称' }, 400)
  // 校验 typeId / propertyKey 合法性
  const types = spaceTypes(space.id)
  const t = body.typeId ? types.find((x) => x.id === body.typeId) : null
  if (body.typeId && !t) return c.json({ error: '对象类型不存在（当前空间）' }, 400)
  if (body.propertyKey && !t) return c.json({ error: '指定属性前请先选择对象类型' }, 400)
  if (body.propertyKey && !(t?.properties as { key: string }[] ?? []).some((p) => p.key === body.propertyKey)) {
    return c.json({ error: `属性 ${body.propertyKey} 不属于该对象类型` }, 400)
  }
  const now = Date.now()
  const values = {
    term: body.term.trim(),
    synonyms: (body.synonyms ?? []).map((s) => s.trim()).filter(Boolean),
    typeId: body.typeId ?? '', propertyKey: body.propertyKey ?? '',
    definition: body.definition ?? '', metricExpr: body.metricExpr ?? '',
    certified: body.certified ? 1 : 0,
  }
  if (body.id) {
    const prev = db.select().from(tables.ontologyTerms).where(eq(tables.ontologyTerms.id, body.id)).get()
    if (!prev || prev.spaceId !== space.id) return c.json({ error: '术语不存在' }, 404)
    db.update(tables.ontologyTerms).set({ ...values, updatedAt: now }).where(eq(tables.ontologyTerms.id, body.id)).run()
    audit(user, '更新业务术语', `${values.term}@${space.name}`, { certified: values.certified })
    return c.json({ id: body.id })
  }
  if (listTerms(space.id).some((x) => x.term === values.term)) return c.json({ error: '同名术语已存在' }, 409)
  const id = `TERM-${now.toString(36).toUpperCase()}`
  db.insert(tables.ontologyTerms).values({ id, ...values, spaceId: space.id, createdAt: now, updatedAt: now }).run()
  audit(user, '新建业务术语', `${values.term}@${space.name}`)
  return c.json({ id })
})

/** 认证/取消认证（独立操作，便于快速审核） */
ontologyRoutes.patch('/terms/:id/certify', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  if (!canModel(user, space)) return c.json({ error: '无建模权限' }, 403)
  const id = c.req.param('id') as string
  const row = db.select().from(tables.ontologyTerms).where(eq(tables.ontologyTerms.id, id)).get()
  if (!row || row.spaceId !== space.id) return c.json({ error: '术语不存在' }, 404)
  const body = await c.req.json<{ certified?: boolean }>().catch((): { certified?: boolean } => ({}))
  const next = body.certified === false ? 0 : 1
  db.update(tables.ontologyTerms).set({ certified: next, updatedAt: Date.now() }).where(eq(tables.ontologyTerms.id, id)).run()
  audit(user, next ? '认证业务术语' : '撤销术语认证', `${row.term}@${space.name}`)
  return c.json({ ok: true, certified: next === 1 })
})

ontologyRoutes.delete('/terms/:id', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  if (!canModel(user, space)) return c.json({ error: '无建模权限' }, 403)
  const id = c.req.param('id') as string
  const row = db.select().from(tables.ontologyTerms).where(eq(tables.ontologyTerms.id, id)).get()
  if (!row || row.spaceId !== space.id) return c.json({ error: '术语不存在' }, 404)
  db.delete(tables.ontologyTerms).where(eq(tables.ontologyTerms.id, id)).run()
  audit(user, '删除业务术语', `${row.term}@${space.name}`)
  return c.json({ ok: true })
})

/** 术语解析（供前端/外部 Agent 调试查看，返回命中与覆盖度） */
ontologyRoutes.get('/terms/resolve', (c) => {
  const space = c.get('space')
  const q = c.req.query('q') ?? ''
  const hits = resolveTerms(q, space.id)
  const total = listTerms(space.id).filter((r) => r.certified).length
  return c.json({
    hits, total,
    answerable: q.trim() === '' ? true : hits.length > 0 || total === 0,
    note: total === 0 ? '当前空间尚无已认证术语（不启用不可回答拦截）' : undefined,
  })
})
