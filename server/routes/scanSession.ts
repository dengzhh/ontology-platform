import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, tables } from '../db'
import { callVision, getVisionConfig, parseJsonLoose } from './scan'
import { autoMatchTemplate, buildPrompt, applyMapping } from '../engine/scanTemplates'

/**
 * 手机扫码协同会话 API
 * - PC（需登录）创建会话、轮询结果
 * - 手机（公开，凭一次性 token）查看状态、上传图片 → 后端自动识别 → PC 轮询获取结果
 */

const SESSION_TTL = 10 * 60 * 1000 // 10 分钟

interface SessionRow {
  id: string
  spaceId: string
  typeId: string
  ownerId: string
  status: string
  image: string
  values: Record<string, unknown> | null
  error: string
  createdAt: number
  expiresAt: number
}

function publicView(r: SessionRow) {
  return {
    id: r.id,
    spaceId: r.spaceId,
    typeId: r.typeId,
    status: r.status,
    typeName: r.typeId ? (db.select().from(tables.objectTypes).all().find((t) => t.id === r.typeId)?.name ?? '') : '',
    values: r.values,
    error: r.error,
    createdAt: new Date(r.createdAt).toLocaleString('zh-CN', { hour12: false }),
    expiresAt: r.expiresAt,
  }
}

export const scanSessionRoutes = new Hono()

/** 手机端：查询会话状态（公开，凭 token） */
scanSessionRoutes.get('/:id', (c) => {
  const r = db.select().from(tables.scanSessions).where(eq(tables.scanSessions.id, c.req.param('id'))).get() as unknown as SessionRow | undefined
  if (!r) return c.json({ error: '会话不存在或已过期' }, 404)
  if (Date.now() > r.expiresAt) {
    db.update(tables.scanSessions).set({ status: 'expired' }).where(eq(tables.scanSessions.id, r.id)).run()
    return c.json({ error: '二维码已过期，请在电脑上重新生成' }, 410)
  }
  return c.json(publicView(r))
})

/** 手机端：上传图片 → 自动视觉识别 → 结果写回会话（公开） */
scanSessionRoutes.post('/:id/upload', async (c) => {
  const id = c.req.param('id')
  const r = db.select().from(tables.scanSessions).where(eq(tables.scanSessions.id, id)).get() as unknown as SessionRow | undefined
  if (!r) return c.json({ error: '会话不存在' }, 404)
  if (Date.now() > r.expiresAt) return c.json({ error: '二维码已过期' }, 410)
  if (r.status === 'done') return c.json({ error: '该会话已完成' }, 409)

  const body = await c.req.json<{ image: string }>()
  if (!body.image) return c.json({ error: '缺少图片数据' }, 400)
  // 视觉网关仅收 JPEG/PNG：非 JPEG/PNG 前缀（webp/heic 等）直接给出可操作提示，不落库不调模型
  if (!/^data:image\/(jpe?g|png)/i.test(body.image)) {
    return c.json({ error: '仅支持 JPG/JPEG/PNG 格式图片（当前为 ' + (String(body.image).slice(0, 24) || '未知格式') + '…）。请在手机「相机 → 格式」选择兼容模式后重拍' }, 400)
  }

  db.update(tables.scanSessions).set({ status: 'uploaded', image: body.image, error: '' }).where(eq(tables.scanSessions.id, id)).run()

  const cfg = getVisionConfig()
  if (!cfg) {
    db.update(tables.scanSessions).set({ status: 'waiting', error: '未配置视觉模型' }).where(eq(tables.scanSessions.id, id)).run()
    return c.json({ error: '未配置视觉模型，请在控制面板配置' }, 400)
  }

  const types = db.select().from(tables.objectTypes).all()
  const typeName = types.find((x) => x.id === r.typeId)?.name ?? ''
  const template = autoMatchTemplate(r.typeId, typeName, '', r.spaceId).template
  const props = (types.find((x) => x.id === r.typeId)?.properties ?? []) as { key: string; type: string }[]
  const validKeys = new Set(props.map((p) => p.key))

  try {
    const raw = await callVision(cfg, body.image, buildPrompt(r.typeId, r.spaceId, template))
    const parsed = parseJsonLoose(raw)
    if (!parsed) {
      db.update(tables.scanSessions).set({ status: 'waiting', error: '模型返回无法解析，请重拍' }).where(eq(tables.scanSessions.id, id)).run()
      return c.json({ error: '识别结果解析失败，请重拍一张更清晰的照片' }, 502)
    }
    // 清洗空值
    let rawCleaned: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (v === '' || v === null || v === undefined) continue
      rawCleaned[k] = v
    }
    // 字段映射（模板定义）
    let cleaned = template?.fieldMapping && Object.keys(template.fieldMapping).length > 0
      ? applyMapping(rawCleaned, template.fieldMapping, props as { key: string; name: string; type: string }[])
      : rawCleaned
    // 只保留有效类型字段 + 数值转换
    if (validKeys.size > 0) {
      cleaned = Object.fromEntries(Object.entries(cleaned).filter(([k]) => validKeys.has(k)))
      for (const [k, v] of Object.entries(cleaned)) {
        const pDef = props.find((p) => p.key === k)
        if (pDef?.type === 'number') {
          const n = Number(String(v).replace(/[^\d.-]/g, ''))
          cleaned[k] = Number.isNaN(n) ? v : n
        }
      }
    }
    db.update(tables.scanSessions).set({ status: 'done', values: cleaned, error: '' }).where(eq(tables.scanSessions.id, id)).run()
    return c.json({ ok: true, values: cleaned, templateName: template?.name ?? '' })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '识别失败'
    db.update(tables.scanSessions).set({ status: 'waiting', error: msg }).where(eq(tables.scanSessions.id, id)).run()
    return c.json({ error: msg }, 502)
  }
})

/** PC 端：创建会话（需登录，从 Authorization 读用户） */
scanSessionRoutes.post('/create', async (c) => {
  // 复用 auth 的 JWT 解析
  const { loadSessionUser } = await import('../auth')
  const user = await loadSessionUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)
  const { spaceId, typeId } = await c.req.json<{ spaceId: string; typeId: string }>()
  const id = `SS-${Date.now().toString(36).toUpperCase()}`
  const now = Date.now()
  db.insert(tables.scanSessions).values({
    id, spaceId, typeId, ownerId: user.id,
    status: 'waiting', image: '', error: '',
    createdAt: now, expiresAt: now + SESSION_TTL,
  }).run()
  return c.json({ id, expiresAt: now + SESSION_TTL })
})

/** PC 端：轮询会话结果（需登录） */
scanSessionRoutes.get('/:id/poll', async (c) => {
  const { loadSessionUser } = await import('../auth')
  const user = await loadSessionUser(c)
  if (!user) return c.json({ error: '未登录' }, 401)
  const id = c.req.param('id')
  const r = db.select().from(tables.scanSessions).where(eq(tables.scanSessions.id, id)).get() as unknown as SessionRow | undefined
  if (!r) return c.json({ error: '会话不存在' }, 404)
  if (r.ownerId !== user.id && user.role.id !== 'admin') return c.json({ error: '无权访问' }, 403)
  return c.json(publicView(r))
})
