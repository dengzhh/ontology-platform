import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, tables } from '../db'
import { requireAuth } from '../auth'
import { resolveSpace, type SpaceInfo } from '../space'
import { llmComplete } from './ai'
import { listTemplates, autoMatchTemplate, buildPrompt, applyMapping } from '../engine/scanTemplates'
import type { SessionUser } from '../../shared/types'

/**
 * 票据/单据视觉识别 API（P10+）
 * 上传图片 → 视觉模型按本体类型属性提取结构化字段 → 返回候选值（前端审核后入库）
 */

type Ctx = { Variables: { user: SessionUser; space: SpaceInfo } }

interface VisionConfig { endpoint: string; apiKey: string; model: string }

export function getVisionConfig(): VisionConfig | null {
  const ai = db.select().from(tables.settings).where(eq(tables.settings.key, 'ai')).get()
  const vision = db.select().from(tables.settings).where(eq(tables.settings.key, 'vision')).get()
  const aiVal = (ai?.value ?? {}) as Record<string, unknown>
  const vVal = (vision?.value ?? {}) as Record<string, unknown>
  const endpoint = String(vVal.endpoint || aiVal.endpoint || '')
  const apiKey = String(vVal.apiKey || aiVal.apiKey || '')
  if (!endpoint || !apiKey) return null
  return { endpoint, apiKey, model: String(vVal.model || 'glm-4v-flash') }
}

/** 从 OpenAI 兼容视觉模型提取字段 */
export async function callVision(cfg: VisionConfig, imageBase64: string, systemPrompt: string): Promise<string> {
  const url = cfg.endpoint.replace(/\/$/, '') + '/chat/completions'
  const dataUrl = imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: '请识别这张票据/单据图片，按系统要求输出严格的 JSON。不要输出其他文字。' },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      temperature: 0.1,
      max_tokens: 1000,
    }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`视觉模型 ${res.status}: ${t.slice(0, 100)}`)
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('视觉模型未返回内容')
  return content
}

export function parseJsonLoose(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```json|```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try { return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown> } catch { return null }
}

function audit(actor: string, action: string, target: string) {
  db.insert(tables.auditEvents).values({
    id: `AE-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    actor, action, target, ip: '本地', createdAt: Date.now(),
  }).run()
}

/** 目标类型的「包含明细」配套明细类型（按链接 id/name 判定），无则 null */
export function findItemTypeId(spaceId: string, sourceTypeId: string): string | null {
  const link = db.select().from(tables.linkTypes).all()
    .find((l) => l.spaceId === spaceId && l.sourceTypeId === sourceTypeId && /item|detail|明细/i.test(l.id + l.name))
  return link?.targetTypeId ?? null
}

/** 模型常见错误形态矫正：多行商品被输出成「列数组」（name/qty/… 各自是 N 元素数组）
 *  → 重组为行数组 items: [{name, qty, …}, …]，每个商品一条明细，供分析统计 */
export function pivotArrayFields(values: Record<string, unknown>): Record<string, unknown> {
  const arrayKeys = Object.entries(values)
    .filter(([k, v]) => k !== 'items' && Array.isArray(v) && v.length > 0)
    .map(([k]) => k)
  if (arrayKeys.length === 0) return values
  const len = Math.max(...arrayKeys.map((k) => (values[k] as unknown[]).length))
  const rows: Record<string, unknown>[] = []
  for (let i = 0; i < len; i++) {
    const row: Record<string, unknown> = {}
    let hasVal = false
    for (const k of arrayKeys) {
      const arr = values[k] as unknown[]
      const v = arr[i] ?? ''
      if (v !== '' && v !== null && v !== undefined) hasVal = true
      row[k] = v
    }
    if (hasVal) rows.push(row)
  }
  const out: Record<string, unknown> = { ...values }
  for (const k of arrayKeys) delete out[k]
  out.items = Array.isArray(out.items) ? [...(out.items as Record<string, unknown>[]), ...rows] : rows
  return out
}

/** 扫描结果落库（PC 确认与手机会话确认共用）：主对象 + items 明细子对象 + 链接 + 审计 */
export function commitScanObject(opts: {
  spaceId: string
  typeId: string
  values: Record<string, unknown>
  itemTypeId?: string | null
  actorName: string
}): { id: string; itemCount: number } | { error: string } {
  const { spaceId, typeId, values, actorName } = opts
  const t = db.select().from(tables.objectTypes).all().find((x) => x.id === typeId && x.spaceId === spaceId)
  if (!t) return { error: '目标类型不存在' }

  // 拆出 items：仅当该空间存在配套明细类型 + 链接时才落地（主对象不存这个特殊键）
  const rawItems = values.items
  const items = Array.isArray(rawItems) ? (rawItems.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]) : []
  const mainValues = { ...values }
  delete mainValues.items
  // 表单编辑后的值是字符串：number 属性按类型定义转回数值，保证消费分析可聚合
  for (const p of (t.properties ?? []) as { key: string; type: string }[]) {
    const v = mainValues[p.key]
    if (p.type === 'number' && typeof v === 'string' && v.trim() !== '') {
      const n = Number(v.replace(/[^\d.-]/g, ''))
      if (!Number.isNaN(n)) mainValues[p.key] = n
    }
  }

  const id = `${t.id}:${Date.now().toString(36)}${Math.floor(Math.random() * 100).toString(36)}`
  const now = Date.now()
  db.insert(tables.objects).values({
    id, typeId: t.id, values: mainValues, createdBy: actorName,
    createdAt: now, updatedAt: now, spaceId,
  }).run()

  let itemCount = 0
  const allTypes = db.select().from(tables.objectTypes).all()
  const itemType = opts.itemTypeId ? allTypes.find((x) => x.id === opts.itemTypeId && x.spaceId === spaceId) : null
  const link = itemType ? db.select().from(tables.linkTypes).all()
    .find((l) => l.spaceId === spaceId && l.sourceTypeId === t.id && l.targetTypeId === itemType.id) : null
  if (itemType && link) {
    const itemProps = (itemType.properties ?? []) as { key: string; type: string }[]
    for (let i = 0; i < items.length; i++) {
      const vals: Record<string, unknown> = {}
      for (const p of itemProps) {
        const v = items[i][p.key]
        if (v === undefined || v === null || v === '') continue
        vals[p.key] = p.type === 'number' ? (Number(v) || 0) : v
      }
      if (!Object.keys(vals).length) continue
      const itemId = `${itemType.id}:${now.toString(36)}${i.toString(36)}`
      db.insert(tables.objects).values({
        id: itemId, typeId: itemType.id, values: vals, createdBy: actorName,
        createdAt: now, updatedAt: now, spaceId,
      }).run()
      db.insert(tables.objectLinks).values({
        id: `OL-${now.toString(36)}-${i.toString(36)}`, linkTypeId: link.id,
        sourceId: id, targetId: itemId, createdBy: actorName, createdAt: now, spaceId,
      }).run()
      itemCount++
    }
  }
  audit(actorName, '扫描录入对象', `${t.name}${itemCount ? ` + ${itemCount} 条明细` : ''} ${JSON.stringify(mainValues).slice(0, 60)}`)
  return { id, itemCount }
}

export const scanRoutes = new Hono<Ctx>()
scanRoutes.use('*', requireAuth)
scanRoutes.use('*', async (c, next) => {
  const user = c.get('user')
  const space = resolveSpace(c, user)
  if (!space) return c.json({ error: '尚无可访问的本体空间' }, 403)
  c.set('space', space)
  await next()
})

/** 视觉配置状态（含文本模型独立端点/密钥：留空表示与视觉共用） */
scanRoutes.get('/config', (c) => {
  const cfg = getVisionConfig()
  const vRow = db.select().from(tables.settings).where(eq(tables.settings.key, 'vision')).get()
  const vVal = (vRow?.value ?? {}) as Record<string, unknown>
  return c.json({
    configured: !!cfg, model: cfg?.model ?? 'glm-4v-flash', endpoint: cfg?.endpoint ?? '',
    // textModel 留空 = 跟随平台 AI 服务（与智能助手同款模型）
    textModel: String(vVal.textModel ?? ''),
    textEndpoint: String(vVal.textEndpoint ?? ''),
    textApiKeyConfigured: !!vVal.textApiKey,
  })
})

/** 识别模板列表（内置 + 自定义，可按类型过滤） */
scanRoutes.get('/templates', async (c) => {
  const space = c.get('space')
  const typeId = c.req.query('typeId') ?? ''

  const templates = listTemplates(space.id, typeId)
  // 附带：当前类型的自动匹配建议
  const types = db.select().from(tables.objectTypes).all().filter((t) => t.spaceId === space.id)
  const typeName = types.find((t) => t.id === typeId)?.name ?? ''
  const auto = autoMatchTemplate(typeId, typeName, '', space.id)
  return c.json({
    templates: templates.map((t) => ({
      id: t.id, name: t.name, desc: t.desc, kind: t.kind, scene: t.scene,
      typeId: t.typeId, extraPrompt: t.extraPrompt, fieldMapping: t.fieldMapping,
      matchKeywords: t.matchKeywords, ownerId: t.ownerId,
    })),
    auto: { templateId: auto.template?.id ?? null, name: auto.template?.name ?? '', reason: auto.reason },
  })
})

/** 模板 CRUD：新建 / 更新自定义模板 */
scanRoutes.post('/templates', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const body = await c.req.json<{
    id?: string; name: string; desc?: string; typeId?: string; extraPrompt?: string
    fieldMapping?: Record<string, string>; matchKeywords?: string[]
  }>()
  if (!body.name?.trim()) return c.json({ error: '请填写模板名称' }, 400)
  const id = body.id ?? `TPL-${Date.now().toString(36).toUpperCase()}`
  const values = {
    id, name: body.name.trim(), desc: body.desc ?? '', typeId: body.typeId ?? '',
    kind: 'custom', scene: 'custom', extraPrompt: body.extraPrompt ?? '',
    fieldMapping: body.fieldMapping ?? {}, matchKeywords: body.matchKeywords ?? [],
    ownerId: user.id, spaceId: space.id, createdAt: Date.now(),
  }
  if (body.id) {
    const prev = db.select().from(tables.scanTemplates).where(eq(tables.scanTemplates.id, body.id)).get()
    if (!prev) return c.json({ error: '模板不存在' }, 404)
    db.update(tables.scanTemplates).set(values).where(eq(tables.scanTemplates.id, body.id)).run()
  } else {
    db.insert(tables.scanTemplates).values(values).run()
  }
  audit(user.name, body.id ? '更新识别模板' : '新建识别模板', body.name)
  return c.json({ id })
})

/** 删除自定义模板 */
scanRoutes.delete('/templates/:id', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const id = c.req.param('id') as string
  const t = db.select().from(tables.scanTemplates).where(eq(tables.scanTemplates.id, id)).get()
  if (!t) return c.json({ error: '模板不存在' }, 404)
  if (t.kind === 'builtin') return c.json({ error: '内置模板不可删除' }, 403)
  db.delete(tables.scanTemplates).where(eq(tables.scanTemplates.id, id)).run()
  audit(user.name, '删除识别模板', t.name)
  return c.json({ ok: true })
})

/** 当前空间可作为录入目标的对象类型（含属性） */
scanRoutes.get('/targets', (c) => {
  const space = c.get('space')
  const types = db.select().from(tables.objectTypes).all().filter((t) => t.spaceId === space.id)
  // 明细类型（被「包含明细」链接指向，如 消费明细 expense_item）不作为扫描目标：
  // 它是主类型（支出）扫描后 items 的落地形态，直接扫它会引导用户把多商品录成一条记录
  const itemTypeIds = new Set(
    db.select().from(tables.linkTypes).all()
      .filter((l) => l.spaceId === space.id && /item|detail|明细/i.test(l.id + l.name))
      .map((l) => l.targetTypeId)
  )
  const view = (t: typeof types[number]) => ({
    id: t.id, name: t.name, color: t.color,
    properties: (t.properties as { key: string; name: string; type: string; enumValues?: string[] }[]).map((p) => ({
      key: p.key, name: p.name, type: p.type, enumValues: p.enumValues,
    })),
  })
  return c.json({
    targets: types.filter((t) => !itemTypeIds.has(t.id)).map(view),
    /** 明细类型定义：前端渲染「明细行编辑器」时按 itemTypeId 取字段 */
    itemTypes: types.filter((t) => itemTypeIds.has(t.id)).map(view),
  })
})

/** 识别单张图片（支持识别模板自动匹配 / 指定模板） */
scanRoutes.post('/recognize', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const body = await c.req.json<{ image: string; typeId?: string; hint?: string; templateId?: string }>()
  if (!body.image) return c.json({ error: '缺少图片数据' }, 400)

  const cfg = getVisionConfig()
  if (!cfg) return c.json({ error: 'VISION_NOT_CONFIGURED', hint: '请先在控制面板配置 AI/视觉服务' }, 400)

  const types = db.select().from(tables.objectTypes).all().filter((t) => t.spaceId === space.id)
  const target = types.find((t) => t.id === body.typeId)

  // 选择模板：显式指定 > 自动匹配（含对象类型推断）

  let template = body.templateId
    ? listTemplates(space.id, body.typeId).find((t) => t.id === body.templateId) ?? null
    : null
  let matchReason = template ? `手动选择「${template.name}」` : ''
  if (!template) {
    const matched = autoMatchTemplate(body.typeId ?? '', target?.name ?? '', body.hint ?? '', space.id)
    template = matched.template
    matchReason = matched.reason
  }

  const systemPrompt = buildPrompt(body.typeId ?? '', space.id, template, body.hint)

  let raw: string
  try {
    raw = await callVision(cfg, body.image, systemPrompt)
  } catch (e) {
    return c.json({ error: `识别失败：${e instanceof Error ? e.message : '未知'}` }, 502)
  }

  const values = parseJsonLoose(raw)
  if (!values) return c.json({ error: '模型返回内容无法解析为 JSON', raw: raw.slice(0, 200) }, 502)

  // 清洗空值 + 字段映射 + 数值转换
  let cleaned: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(values)) {
    if (v === '' || v === null || v === undefined) continue
    cleaned[k] = v
  }
  const props = (target?.properties ?? []) as { key: string; name: string; type: string; enumValues?: string[] }[]
  // 若目标类型有「包含明细」链接，保留模型输出的 items 数组，供 /commit 落地为明细子对象
  const itemTypeId = target ? findItemTypeId(space.id, target.id) : null
  if (template?.fieldMapping && Object.keys(template.fieldMapping).length > 0) {
    cleaned = applyMapping(cleaned, template.fieldMapping, props)
  }
  // 模型把多行商品输出成「列数组」（name/qty… 各为 N 元素数组）时，重组为 items 行数组
  if (itemTypeId) cleaned = pivotArrayFields(cleaned)
  // 只保留目标类型的有效字段（避免模型输出多余键）；items 作为明细行特殊键保留
  if (target) {
    const valid = new Set(props.map((p) => p.key))
    if (itemTypeId) valid.add('items')
    cleaned = Object.fromEntries(Object.entries(cleaned).filter(([k]) => valid.has(k)))
    for (const p of props) {
      if (p.type === 'number' && cleaned[p.key] !== undefined) {
        const n = Number(String(cleaned[p.key]).replace(/[^\d.-]/g, ''))
        if (!Number.isNaN(n)) cleaned[p.key] = n
      }
    }
  }

  audit(user.name, '视觉识别票据', `${target?.name ?? '通用'}@${space.name} · 模板:${template?.name ?? '无'}`)
  return c.json({
    values: cleaned,
    itemTypeId,
    raw: raw.slice(0, 200),
    typeId: target?.id ?? null,
    typeName: target?.name ?? '通用票据',
    model: cfg.model,
    templateId: template?.id ?? null,
    templateName: template?.name ?? '通用票据',
    matchReason,
  })
})

/** 文本类文件识别（Word/TXT/CSV/PDF 全文）：LLM 结构化提取，复用模板体系 */
scanRoutes.post('/recognize-text', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const body = await c.req.json<{ text: string; typeId?: string; hint?: string; templateId?: string; fileName?: string }>()
  if (!body.text?.trim()) return c.json({ error: '缺少文本内容' }, 400)

  const types = db.select().from(tables.objectTypes).all().filter((t) => t.spaceId === space.id)
  const target = types.find((t) => t.id === body.typeId)

  let template = body.templateId
    ? listTemplates(space.id, body.typeId).find((t) => t.id === body.templateId) ?? null
    : null
  let matchReason = template ? `手动选择「${template.name}」` : ''
  if (!template) {
    const matched = autoMatchTemplate(body.typeId ?? '', target?.name ?? '', `${body.hint ?? ''} ${body.fileName ?? ''}`, space.id)
    template = matched.template
    matchReason = matched.reason
  }

  const props = (target?.properties ?? []) as { key: string; name: string; type: string; enumValues?: string[] }[]
  // 与 /recognize 对齐：目标类型带「包含明细」链接时，文本提取同样输出 items 数组
  const itemType = target
    ? db.select().from(tables.objectTypes).all().find((x) => x.id === findItemTypeId(space.id, target.id) && x.spaceId === space.id)
    : null
  const itemTypeId = itemType?.id ?? null
  let fields = props.map((p) => {
    const desc = p.type === 'enum' && p.enumValues?.length ? `枚举只能是: ${p.enumValues.join('/')}` : p.type === 'number' ? '数字' : p.type === 'date' ? '日期 YYYY-MM-DD' : '文本'
    return `  "${p.key}": ${p.name}（${desc}，提取不到填空字符串""）`
  }).join(',\n')
  if (itemType) {
    const itemProps = ((itemType.properties ?? []) as { key: string; type: string }[])
    // 与 buildPrompt 一致：显式两行示例，避免模型忽略 items 键
    const demoRow = (i: number) => '    ' + JSON.stringify(Object.fromEntries(itemProps.map((p) => [p.key, p.type === 'number' ? i : ''])))
    fields += `,\n  "items": [\n${demoRow(1)},\n${demoRow(2)}\n  ]`
  }
  const system = [
    '你是单据/文档结构化信息提取专家。从给定文本中提取字段，输出严格 JSON（不要代码块、不要其他文字）。',
    target ? `目标对象类型：${target.name}。` : '',
    `输出格式：\n{\n${fields || '  "title": "", "amount": 0, "date": "", "notes": ""'}\n}`,
    '规则：只输出 JSON；金额只输出数字；日期 YYYY-MM-DD；输出字段名必须与上面 key 一致；提取不到填空字符串。',
    itemType ? `文本含逐条商品/服务明细时必须逐行抄录进 "items" 数组（字段：${((itemType.properties ?? []) as { key: string }[]).map((p) => p.key).join(', ')}），无明细输出 []。每件商品独立一个对象，严禁把多个商品的同一字段合并为数组或拼接字符串。` : '',
    template?.extraPrompt ? `\n【${template.name} · 提取要点】\n${template.extraPrompt}` : '',
    body.hint ? `\n【补充要求】${body.hint}` : '',
  ].filter(Boolean).join('\n')

  let raw: string
  try {
    // 文本模型通道路由（优先级从高到低）：
    //   ① textModel 留空        → 直接用平台 AI 服务（llmComplete，与智能助手同款模型）
    //   ② textEndpoint 独立配置 → 用独立端点 + textModel（视觉/文本分属不同服务）
    //   ③ 否则                  → 与视觉模型共用端点 + textModel
    // 均失败再兜底平台 AI 网关
    const vcfg = getVisionConfig()
    const vVal2 = (db.select().from(tables.settings).where(eq(tables.settings.key, 'vision')).get()?.value ?? {}) as Record<string, unknown>
    const textModel = String(vVal2.textModel ?? '').trim()
    const textEndpoint = String(vVal2.textEndpoint || vcfg?.endpoint || '')
    const textApiKey = String(vVal2.textApiKey || vcfg?.apiKey || '')
    if (textModel && textEndpoint && textApiKey) {
      const url = textEndpoint.replace(/\/$/, '') + '/chat/completions'
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${textApiKey}` },
        body: JSON.stringify({
          model: textModel,
          messages: [{ role: 'system', content: system }, { role: 'user', content: body.text.slice(0, 8000) }],
          temperature: 0.1, max_tokens: 1000,
        }),
        signal: AbortSignal.timeout(45_000),
      })
      if (!res.ok) throw new Error(`文本模型网关 ${res.status}`)
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
      raw = data.choices?.[0]?.message?.content ?? ''
      if (!raw) throw new Error('空回复')
    } else {
      raw = await llmComplete(system, body.text.slice(0, 8000))
    }
  } catch (e) {
    // 最后一次兜底：平台 AI 网关
    try {
      raw = await llmComplete(system, body.text.slice(0, 8000))
    } catch {
      return c.json({ error: `文本识别失败：${e instanceof Error ? e.message : '未知'}` }, 502)
    }
  }
  const parsed = parseJsonLoose(raw)
  if (!parsed) return c.json({ error: '模型返回无法解析', raw: raw.slice(0, 200) }, 502)

  let cleaned: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(parsed)) {
    if (v === '' || v === null || v === undefined) continue
    cleaned[k] = v
  }
  if (template?.fieldMapping && Object.keys(template.fieldMapping).length > 0) {
    cleaned = applyMapping(cleaned, template.fieldMapping, props)
  }
  // 模型把多行商品输出成「列数组」时，同样重组为 items 行数组（与 /recognize 对齐）
  if (itemTypeId) cleaned = pivotArrayFields(cleaned)
  if (target) {
    const valid = new Set(props.map((p) => p.key))
    if (itemTypeId) valid.add('items')
    cleaned = Object.fromEntries(Object.entries(cleaned).filter(([k]) => valid.has(k)))
    for (const p of props) {
      if (p.type === 'number' && cleaned[p.key] !== undefined) {
        const n = Number(String(cleaned[p.key]).replace(/[^\d.-]/g, ''))
        if (!Number.isNaN(n)) cleaned[p.key] = n
      }
    }
  }
  audit(user.name, '文件文本识别', `${body.fileName ?? ''} ${target?.name ?? '通用'} · 模板:${template?.name ?? '无'}`)
  return c.json({
    values: cleaned, raw: raw.slice(0, 200),
    typeId: target?.id ?? null, typeName: target?.name ?? '通用', itemTypeId,
    model: 'LLM', templateId: template?.id ?? null, templateName: template?.name ?? '', matchReason,
  })
})

/** 批量识别（多张图片，逐张返回） */
scanRoutes.post('/recognize-batch', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const body = await c.req.json<{ images: string[]; typeId?: string }>()
  if (!body.images?.length) return c.json({ error: '缺少图片' }, 400)
  const cfg = getVisionConfig()
  if (!cfg) return c.json({ error: 'VISION_NOT_CONFIGURED' }, 400)

  // 复用单张逻辑：逐张调用（前端也可并发调用 /recognize，这里给简单聚合）
  const results: { index: number; ok: boolean; values?: Record<string, unknown>; error?: string }[] = []
  for (let i = 0; i < Math.min(body.images.length, 10); i++) {
    try {
      // 直接转发到内部处理（简化：重新构造请求）
      const types = db.select().from(tables.objectTypes).all().filter((t) => t.spaceId === space.id)
      const target = types.find((t) => t.id === body.typeId)
      const props = (target?.properties ?? []) as { key: string; name: string; type: string; enumValues?: string[] }[]
      const fields = props.map((p) => `"${p.key}": ${p.name}`).join(', ')
      const prompt = `你是票据 OCR 专家。识别图片，输出严格 JSON（不要其他文字）。字段：{${fields || '"title":"","amount":0,"date":""'}}。金额只输出数字，日期 YYYY-MM-DD，识别不到填空。只输出 JSON。`
      const raw = await callVision(cfg, body.images[i], prompt)
      const values = parseJsonLoose(raw)
      results.push(values ? { index: i, ok: true, values } : { index: i, ok: false, error: '解析失败' })
    } catch (e) {
      results.push({ index: i, ok: false, error: e instanceof Error ? e.message : '失败' })
    }
  }
  audit(user.name, '批量视觉识别', `${body.images.length} 张@${space.name}`)
  return c.json({ results })
})

/** 识别后确认入库（PC 端审核修正后调用）；落库逻辑与手机会话确认共用 commitScanObject */
scanRoutes.post('/commit', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const body = await c.req.json<{ typeId: string; values: Record<string, unknown>; itemTypeId?: string | null }>()
  const r = commitScanObject({ spaceId: space.id, typeId: body.typeId, values: body.values, itemTypeId: body.itemTypeId, actorName: user.name })
  if ('error' in r) return c.json({ error: r.error }, 404)
  return c.json({ id: r.id, ok: true, itemCount: r.itemCount })
})
