import { Hono } from 'hono'
import { db, tables } from '../db'
import { requireAuth } from '../auth'
import { listUserSpaces, ensurePersonalSpace, isMember } from '../space'
import { PACKS } from '../templates/packs'
import type { SessionUser } from '../../shared/types'

/* ============ 空间导出 / 导入（可移植 bundle） ============ */

interface SpaceBundle {
  format: 'ontoos.space.bundle'
  version: 1
  exportedAt: number
  space: { name: string; kind: string }
  objectTypes: unknown[]
  linkTypes: unknown[]
  actionTypes: unknown[]
  ontologyFunctions: unknown[]
  objects: unknown[]
  objectLinks: unknown[]
}

/** 空间管理：列表 / 开通个人 / 新建(家庭/组织) / 成员 / 模板包安装 */

function audit(user: SessionUser, action: string, target: string) {
  db.insert(tables.auditEvents).values({
    id: `AE-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    actor: user.name, action, target, ip: '本地', createdAt: Date.now(),
  }).run()
}

export const spaceRoutes = new Hono<{ Variables: { user: SessionUser } }>()
spaceRoutes.use('*', requireAuth)

/** 我的空间列表 */
spaceRoutes.get('/', (c) => {
  const user = c.get('user')
  return c.json({ spaces: listUserSpaces(user.id) })
})

/** 可安装的模板包 */
spaceRoutes.get('/templates', (c) => {
  return c.json({
    packs: PACKS.map((p) => ({ id: p.id, name: p.name, desc: p.desc, suitKinds: p.suitKinds, typeCount: p.types.length, linkCount: p.links.length, actionCount: p.actions.length })),
  })
})

/** 开通个人空间（幂等），可选立即安装个人生活模板包 */
spaceRoutes.post('/ensure-personal', async (c) => {
  const user = c.get('user')
  const { installPack } = await c.req.json<{ installPack?: string }>().catch(() => ({ installPack: undefined as string | undefined }))
  const sp = ensurePersonalSpace(user.id)
  let installed = 0
  if (installPack) installed = installPackTo(user, sp.id, installPack)
  audit(user, '开通个人空间', sp.name)
  return c.json({ space: sp, installed })
})

/** 新建空间（family/org） */
spaceRoutes.post('/', async (c) => {
  const user = c.get('user')
  const { name, kind } = await c.req.json<{ name: string; kind: 'family' | 'org' }>()
  if (!name?.trim()) return c.json({ error: '请填写空间名称' }, 400)
  if (!['family', 'org'].includes(kind)) return c.json({ error: '空间类型须为 family 或 org' }, 400)
  const id = `sp-${kind}-${Date.now().toString(36)}`
  db.insert(tables.spaces).values({ id, name: name.trim(), kind, ownerId: user.id, templatePack: '', createdAt: Date.now() }).run()
  db.insert(tables.spaceMembers).values({ spaceId: id, userId: user.id, role: 'owner' }).run()
  audit(user, '新建空间', `${name}(${kind})`)
  return c.json({ space: { id, name: name.trim(), kind, ownerId: user.id } })
})

/** 添加成员（按账号，须为平台已有用户） */
spaceRoutes.post('/:id/members', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id') as string
  const sp = db.select().from(tables.spaces).all().find((s) => s.id === id)
  if (!sp) return c.json({ error: '空间不存在' }, 404)
  if (sp.ownerId !== user.id && user.role.id !== 'admin') return c.json({ error: '仅空间创建者可添加成员' }, 403)
  const { account } = await c.req.json<{ account: string }>()
  const target = db.select().from(tables.users).all().find((u) => u.account === account)
  if (!target) return c.json({ error: `平台用户「${account}」不存在，请先邀请其注册` }, 404)
  if (isMember(id, target.id)) return c.json({ error: '已是成员' }, 409)
  db.insert(tables.spaceMembers).values({ spaceId: id, userId: target.id, role: 'member' }).run()
  audit(user, '添加空间成员', `${sp.name} ← ${target.name}`)
  return c.json({ ok: true, member: { name: target.name, account: target.account } })
})

/** 模板包安装到指定空间（幂等：跳过已存在 id） */
function installPackTo(user: SessionUser, spaceId: string, packId: string): number {
  const pack = PACKS.find((p) => p.id === packId)
  if (!pack) return 0
  const now = Date.now()
  let created = 0
  for (const t of pack.types) {
    const exists = db.select().from(tables.objectTypes).all().some((x) => x.id === t.id && x.spaceId === spaceId)
    if (exists) continue
    db.insert(tables.objectTypes).values({
      id: t.id, apiName: t.id, name: t.name, desc: t.desc, color: t.color, icon: t.icon,
      primaryKey: t.properties[0]?.name ?? 'id', properties: t.properties, viewTemplate: t.viewTemplate,
      spaceId, createdAt: now, updatedAt: now,
    }).run()
    created++
  }
  for (const l of pack.links) {
    const exists = db.select().from(tables.linkTypes).all().some((x) => x.id === l.id && x.spaceId === spaceId)
    if (exists) continue
    db.insert(tables.linkTypes).values({
      id: l.id, name: l.name, sourceTypeId: l.source, targetTypeId: l.target,
      cardinality: l.cardinality, desc: l.desc, spaceId, createdAt: now,
    }).run()
  }
  for (const a of pack.actions) {
    const exists = db.select().from(tables.actionTypes).all().some((x) => x.id === a.id && x.spaceId === spaceId)
    if (exists) continue
    db.insert(tables.actionTypes).values({
      id: a.id, name: a.name, targetTypeId: a.target, params: a.params, effect: a.effect,
      needsApproval: a.needsApproval ? 1 : 0, desc: a.desc, spaceId, createdAt: now,
    }).run()
  }
  if (created > 0 || pack.links.length) {
    db.update(tables.spaces).set({ templatePack: pack.id }).where(eqSpaces(spaceId)).run()
  }
  audit(user, '安装本体模板包', `${pack.name} → 空间${spaceId}`)
  return created + pack.links.length + pack.actions.length
}

import { eq } from 'drizzle-orm'
function eqSpaces(id: string) {
  return eq(tables.spaces.id, id)
}

/** 安装模板包到指定空间（须为成员） */
spaceRoutes.post('/:id/install-template', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id') as string
  const sp = db.select().from(tables.spaces).all().find((s) => s.id === id)
  if (!sp) return c.json({ error: '空间不存在' }, 404)
  if (!isMember(id, user.id)) return c.json({ error: '你不是该空间成员' }, 403)
  const { packId } = await c.req.json<{ packId: string }>()
  const pack = PACKS.find((p) => p.id === packId)
  if (!pack) return c.json({ error: '模板包不存在' }, 404)
  if (!pack.suitKinds.includes(sp.kind)) return c.json({ error: `该模板包适用于 ${pack.suitKinds.join('/')} 空间` }, 400)
  const n = installPackTo(user, id, packId)
  return c.json({ ok: true, created: n })
})

/** 导出空间：本体定义 + 数据 + 关联 → 可移植 JSON bundle（须为成员） */
spaceRoutes.get('/:id/export', (c) => {
  const user = c.get('user')
  const id = c.req.param('id') as string
  const sp = db.select().from(tables.spaces).all().find((s) => s.id === id)
  if (!sp) return c.json({ error: '空间不存在' }, 404)
  if (!isMember(id, user.id)) return c.json({ error: '你不是该空间成员' }, 403)

  const inSpace = <T extends { spaceId: string }>(rows: T[]) => rows.filter((r) => r.spaceId === id)
  const objectTypes = inSpace(db.select().from(tables.objectTypes).all()).map(stripSpace)
  const linkTypes = inSpace(db.select().from(tables.linkTypes).all()).map(stripSpace)
  const actionTypes = inSpace(db.select().from(tables.actionTypes).all()).map(stripSpace)
  const ontologyFunctions = inSpace(db.select().from(tables.ontologyFunctions).all()).map(stripSpace)
  const objects = inSpace(db.select().from(tables.objects).all()).map(stripSpace)
  const objectLinks = inSpace(db.select().from(tables.objectLinks).all()).map(stripSpace)

  const bundle: SpaceBundle = {
    format: 'ontoos.space.bundle',
    version: 1,
    exportedAt: Date.now(),
    space: { name: sp.name, kind: sp.kind },
    objectTypes, linkTypes, actionTypes, ontologyFunctions, objects, objectLinks,
  }
  audit(user, '导出空间', `${sp.name}（${objectTypes.length}类型/${objects.length}对象/${objectLinks.length}链接）`)
  return c.json(bundle)
})

function stripSpace<T extends { spaceId: string }>(row: T): Omit<T, 'spaceId'> {
  const { spaceId: _drop, ...rest } = row
  return rest
}

/** 导入空间 bundle：创建新空间并重映射全部 ID（跨实例安全），导入者成为所有者 */
spaceRoutes.post('/import', async (c) => {
  const user = c.get('user')
  const body = await c.req.json<{ bundle: SpaceBundle; spaceName?: string }>()
  const b = body.bundle
  if (!b || b.format !== 'ontoos.space.bundle' || !Array.isArray(b.objectTypes)) {
    return c.json({ error: '不是有效的空间包（ontoos.space.bundle v1）' }, 400)
  }
  const kind = ['org', 'personal', 'family'].includes(b.space?.kind ?? '') ? (b.space!.kind as string) : 'family'
  const spaceId = `sp-imp-${Date.now().toString(36)}`
  const name = (body.spaceName?.trim() || b.space?.name || '导入的空间').slice(0, 40)
  db.insert(tables.spaces).values({ id: spaceId, name, kind, ownerId: user.id, templatePack: 'imported', createdAt: Date.now() }).run()
  db.insert(tables.spaceMembers).values({ spaceId, userId: user.id, role: 'owner' }).run()

  // 全局占用 ID（各表主键全局唯一）→ 冲突时加后缀重映射
  const taken = new Set<string>([
    ...db.select().from(tables.objectTypes).all().map((t) => t.id),
    ...db.select().from(tables.linkTypes).all().map((l) => l.id),
    ...db.select().from(tables.actionTypes).all().map((a) => a.id),
    ...db.select().from(tables.ontologyFunctions).all().map((f) => f.id),
    ...db.select().from(tables.objects).all().map((o) => o.id),
    ...db.select().from(tables.objectLinks).all().map((l) => l.id),
  ])
  const fresh = (orig: string) => {
    if (!taken.has(orig)) { taken.add(orig); return orig }
    let n = 2
    while (taken.has(`${orig}~${n}`)) n++
    const id = `${orig}~${n}`
    taken.add(id)
    return id
  }

  const typeMap = new Map<string, string>()
  const linkTypeMap = new Map<string, string>()
  const objectMap = new Map<string, string>()
  const now = Date.now()

  for (const t of b.objectTypes as (typeof tables.objectTypes.$inferSelect)[]) {
    const newId = fresh(t.id)
    typeMap.set(t.id, newId)
    db.insert(tables.objectTypes).values({ ...t, id: newId, spaceId, createdAt: t.createdAt ?? now, updatedAt: now }).run()
  }
  for (const l of b.linkTypes as (typeof tables.linkTypes.$inferSelect)[]) {
    const newId = fresh(l.id)
    linkTypeMap.set(l.id, newId)
    db.insert(tables.linkTypes).values({ ...l, id: newId, sourceTypeId: typeMap.get(l.sourceTypeId) ?? l.sourceTypeId, targetTypeId: typeMap.get(l.targetTypeId) ?? l.targetTypeId, spaceId, createdAt: now }).run()
  }
  for (const a of b.actionTypes as (typeof tables.actionTypes.$inferSelect)[]) {
    const newId = fresh(a.id)
    db.insert(tables.actionTypes).values({ ...a, id: newId, targetTypeId: typeMap.get(a.targetTypeId) ?? a.targetTypeId, spaceId, createdAt: now }).run()
  }
  for (const f of (b.ontologyFunctions ?? []) as (typeof tables.ontologyFunctions.$inferSelect)[]) {
    db.insert(tables.ontologyFunctions).values({ ...f, id: fresh(f.id), linkedTypeIds: (f.linkedTypeIds ?? []).map((x) => typeMap.get(x) ?? x), spaceId, createdAt: now }).run()
  }
  for (const o of b.objects as (typeof tables.objects.$inferSelect)[]) {
    const newId = fresh(o.id)
    objectMap.set(o.id, newId)
    db.insert(tables.objects).values({ ...o, id: newId, typeId: typeMap.get(o.typeId) ?? o.typeId, spaceId, createdAt: o.createdAt ?? now, updatedAt: now }).run()
  }
  for (const l of b.objectLinks as (typeof tables.objectLinks.$inferSelect)[]) {
    db.insert(tables.objectLinks).values({ ...l, id: fresh(l.id), linkTypeId: linkTypeMap.get(l.linkTypeId) ?? l.linkTypeId, sourceId: objectMap.get(l.sourceId) ?? l.sourceId, targetId: objectMap.get(l.targetId) ?? l.targetId, spaceId, createdAt: now }).run()
  }

  audit(user, '导入空间', `${name}（${b.objectTypes.length}类型/${(b.objects ?? []).length}对象）`)
  return c.json({
    ok: true,
    space: { id: spaceId, name, kind },
    counts: { types: b.objectTypes.length, links: b.linkTypes.length, objects: (b.objects ?? []).length, objectLinks: (b.objectLinks ?? []).length },
  })
})
