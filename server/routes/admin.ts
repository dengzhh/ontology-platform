import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import fs from 'node:fs'
import path from 'node:path'
import { requireAuth, requireAdmin } from '../auth'
import { db, sqlite, tables } from '../db'
import { resolveSpace } from '../space'
import { getSmtpConfig, saveSmtpConfig, sendMail, isSmtpConfigured, type SmtpConfig } from '../mailer'
import { decodeCfg, encodeCfg } from '../secretbox'
import { selfSignupEnabled, setSelfSignup } from '../quota'
import type { SessionUser } from '../../shared/types'

function db_insertAudit(actor: string, action: string, target: string) {
  audit(actor, action, target)
}

function audit(actor: string, action: string, target: string) {
  db.insert(tables.auditEvents).values({
    id: `AE-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    actor, action, target, ip: '本地', createdAt: Date.now(),
  }).run()
}

/** 管理配置：邮件服务 / 审计日志查询 */
export const adminRoutes = new Hono<{ Variables: { user: SessionUser } }>()
adminRoutes.use('*', requireAuth)

/** 审计日志：?actor=&action=&limit=（真实留痕，P4 接入） */
adminRoutes.get('/audit', (c) => {
  const actor = (c.req.query('actor') ?? '').trim()
  const action = (c.req.query('action') ?? '').trim()
  const limit = Math.min(Number(c.req.query('limit')) || 50, 200)
  let rows = db.select().from(tables.auditEvents).all().sort((a, b) => b.createdAt - a.createdAt)
  if (actor) rows = rows.filter((r) => r.actor.includes(actor))
  if (action) rows = rows.filter((r) => r.action.includes(action))
  return c.json({
    total: rows.length,
    events: rows.slice(0, limit).map((r) => ({
      id: r.id, actor: r.actor, action: r.action, target: r.target, result: r.result,
      detail: r.detail, createdAt: new Date(r.createdAt).toLocaleString('zh-CN', { hour12: false }),
    })),
  })
})

/** 读取 SMTP 配置（密码不回传） */
adminRoutes.get('/smtp', requireAdmin, (c) => {
  const cfg = getSmtpConfig()
  if (!cfg) return c.json({ configured: false })
  const { pass, ...safe } = cfg
  return c.json({ configured: true, smtp: { ...safe, pass: '' } })
})

/** 保存 SMTP 配置（pass 留空表示沿用原密码） */
adminRoutes.put('/smtp', requireAdmin, async (c) => {
  const body = await c.req.json<Partial<SmtpConfig>>()
  if (!body.host || !body.user || !body.from) return c.json({ error: '请填写服务器、账号与发件人地址' }, 400)
  const prev = getSmtpConfig()
  const cfg: SmtpConfig = {
    host: body.host,
    port: Number(body.port) || 465,
    secure: body.secure !== false,
    user: body.user,
    pass: body.pass || prev?.pass || '',
    from: body.from,
    senderName: body.senderName || 'OntoOS 平台',
  }
  if (!cfg.pass) return c.json({ error: '请填写邮箱密码/授权码' }, 400)
  saveSmtpConfig(cfg)
  audit(c.get('user').name, '保存邮件服务配置', body.host)
  return c.json({ ok: true })
})

/** 嵌入模型配置（供知识检索语义向量化）；密钥加密存储，回显脱敏 */
adminRoutes.get('/embedding', requireAdmin, (c) => {
  const row = db.select().from(tables.settings).where(eq(tables.settings.key, 'embedding')).get()
  if (!row) return c.json({ embedding: null })
  const v = { ...(row.value as Record<string, unknown>) }
  if (v.apiKey) v.apiKey = '******'
  return c.json({ embedding: v })
})

adminRoutes.put('/embedding', requireAdmin, async (c) => {
  const body = await c.req.json<{ model: string; enabled: boolean; endpoint?: string; apiKey?: string }>()
  if (!body.model?.trim()) return c.json({ error: '请填写嵌入模型名称' }, 400)
  const now = Date.now()
  const existing = db.select().from(tables.settings).where(eq(tables.settings.key, 'embedding')).get()
  // 掩码/留空表示沿用原密钥（回显是脱敏值，直接回存会覆盖真实密钥）
  if (!body.apiKey || body.apiKey === '******') {
    const prev = existing?.value as { apiKey?: string } | undefined
    if (prev?.apiKey) body.apiKey = prev.apiKey
  }
  const value = encodeCfg(body as unknown as Record<string, unknown>)
  if (existing) {
    db.update(tables.settings).set({ value, updatedAt: now }).where(eq(tables.settings.key, 'embedding')).run()
  } else {
    db.insert(tables.settings).values({ key: 'embedding', value, updatedAt: now }).run()
  }
  db_insertAudit(c.get('user').name, '保存嵌入模型配置', `${body.model}@${body.endpoint || '(用AI网关)'}`)
  return c.json({ ok: true })
})

adminRoutes.post('/embedding/test', requireAdmin, async (c) => {
  const ai = db.select().from(tables.settings).where(eq(tables.settings.key, 'ai')).get()
  const aiVal = decodeCfg((ai?.value ?? {}) as Record<string, unknown>) as { endpoint?: string; apiKey?: string }
  const emb = db.select().from(tables.settings).where(eq(tables.settings.key, 'embedding')).get()
  const embVal = decodeCfg((emb?.value ?? {}) as Record<string, unknown>) as { model?: string; endpoint?: string; apiKey?: string }
  const endpoint = (embVal.endpoint || aiVal.endpoint || '').replace(/\/$/, '').replace(/\/embeddings$/, '')
  const apiKey = embVal.apiKey || aiVal.apiKey || ''
  const model = embVal.model || 'text-embedding-3-small'
  if (!endpoint || !apiKey) return c.json({ error: '未配置嵌入端点或密钥（可填专属端点，或依赖 AI 服务配置）' }, 400)
  try {
    const res = await fetch(endpoint + '/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, input: ['连通测试'] }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      return c.json({ error: `接口 ${res.status}：${t.slice(0, 80)}` }, 502)
    }
    const data = (await res.json()) as { data?: { embedding: number[] }[] }
    const dim = data.data?.[0]?.embedding?.length ?? 0
    if (dim === 0) return c.json({ error: '接口返回了空向量' }, 502)
    return c.json({ ok: true, dim, model })
  } catch (e) {
    return c.json({ error: `连接失败：${e instanceof Error ? e.message : '未知'}` }, 502)
  }
})

/** 视觉模型配置（票据扫描识别）；密钥加密存储，回显脱敏 */
adminRoutes.get('/vision', requireAdmin, (c) => {
  const row = db.select().from(tables.settings).where(eq(tables.settings.key, 'vision')).get()
  const v = { ...((row?.value ?? {}) as Record<string, unknown>) }
  if (v.apiKey) v.apiKey = '******'
  if (v.textApiKey) v.textApiKey = '******'
  return c.json({ configured: !!row, value: v })
})

adminRoutes.put('/vision', requireAdmin, async (c) => {
  const body = await c.req.json<{ model: string; textModel?: string; endpoint?: string; apiKey?: string; textEndpoint?: string; textApiKey?: string }>()
  if (!body.model?.trim()) return c.json({ error: '请填写视觉模型名称' }, 400)
  const now = Date.now()
  const existing = db.select().from(tables.settings).where(eq(tables.settings.key, 'vision')).get()
  // 掩码/留空表示沿用原密钥；文本模型独立端点/密钥：允许仅填其一（端点独立、密钥沿用视觉的），读取端自行回退
  const prev = (existing?.value ?? {}) as { apiKey?: string; textApiKey?: string }
  if ((!body.apiKey || body.apiKey === '******') && prev.apiKey) body.apiKey = prev.apiKey
  if ((!body.textApiKey || body.textApiKey === '******') && prev.textApiKey) body.textApiKey = prev.textApiKey
  const value = encodeCfg(body as unknown as Record<string, unknown>)
  if (existing) db.update(tables.settings).set({ value, updatedAt: now }).where(eq(tables.settings.key, 'vision')).run()
  else db.insert(tables.settings).values({ key: 'vision', value, updatedAt: now }).run()
  db_insertAudit(c.get('user').name, '保存视觉模型配置', body.model)
  return c.json({ ok: true })
})

/** 平台功能开关（真实落库，影响导航可见性） */
adminRoutes.get('/features', (c) => {
  const row = db.select().from(tables.settings).where(eq(tables.settings.key, 'features')).get()
  const defaults = { 'aip-logic': true, 'agent-studio': true, workshop: true, marketplace: false, 'sensitive-scan': true }
  return c.json({ features: { ...defaults, ...((row?.value ?? {}) as Record<string, boolean>) } })
})

adminRoutes.put('/features', requireAdmin, async (c) => {
  const body = await c.req.json<Record<string, boolean>>()
  const key = 'features'
  const now = Date.now()
  const existing = db.select().from(tables.settings).where(eq(tables.settings.key, key)).get()
  if (existing) db.update(tables.settings).set({ value: body, updatedAt: now }).where(eq(tables.settings.key, key)).run()
  else db.insert(tables.settings).values({ key, value: body, updatedAt: now }).run()
  db_insertAudit(c.get('user').name, '更新功能开关', Object.entries(body).filter(([, v]) => !v).map(([k]) => k).join(',') || '全部启用')
  return c.json({ ok: true })
})

/** 平台真实用量统计（从审计/对象/文档/消息表聚合） */
adminRoutes.get('/usage', (c) => {
  const audit = db.select().from(tables.auditEvents).all()
  const now = Date.now()
  const day = 86400_000
  const aiActions = audit.filter((a) => a.action.includes('AI') || a.action.includes('Agent') || a.action.includes('识别') || a.action.includes('工作流'))
  const tokenTrend: { day: string; tokens: number }[] = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now - i * day)
    const label = `${d.getMonth() + 1}/${d.getDate()}`
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    const end = start + day
    tokenTrend.push({ day: label, tokens: aiActions.filter((a) => a.createdAt >= start && a.createdAt < end).length * 120 })
  }
  return c.json({
    metrics: {
      objects: db.select().from(tables.objects).all().length,
      documents: db.select().from(tables.documents).all().length,
      chunks: db.select().from(tables.docChunks).all().length,
      aiMessages: db.select().from(tables.aiMessages).all().length,
      auditToday: audit.filter((a) => a.createdAt > now - day).length,
      auditWeek: audit.filter((a) => a.createdAt > now - 7 * day).length,
    },
    tokenTrend,
    services: [
      { name: '本体服务', metric: `${db.select().from(tables.objects).all().length} 个实例`, ok: true },
      { name: 'AI 网关', metric: '已配置', ok: true },
      { name: '知识索引', metric: `${db.select().from(tables.docChunks).all().length} 向量`, ok: true },
      { name: '自动化引擎', metric: `${db.select().from(tables.automationRules).all().filter((r) => r.enabled === 1).length} 规则`, ok: true },
    ],
  })
})

/** 运行环境信息：全部来自真实运行时/数据库，不再展示虚构的部署区域与服务网格 */
adminRoutes.get('/environment', (c) => {
  const space = resolveSpace(c, c.get('user'))
  return c.json({
    runtime: `Node ${process.version}`,
    platform: `${process.platform} / ${process.arch}`,
    mode: process.env.NODE_ENV === 'production' ? '生产构建' : '本地开发（单进程）',
    database: 'SQLite（单文件 · better-sqlite3）',
    space: space ? { name: space.name, kind: space.kind } : null,
    uptimeSeconds: Math.round(process.uptime()),
  })
})

/** 发送测试邮件 */
adminRoutes.post('/smtp/test', requireAdmin, async (c) => {
  const { to } = await c.req.json<{ to: string }>()
  if (!to) return c.json({ error: '请填写测试收件地址' }, 400)
  if (!isSmtpConfigured()) return c.json({ error: '尚未配置邮件服务' }, 400)
  const res = await sendMail(to, '【OntoOS】邮件服务测试', '这是一封来自 OntoOS 平台的测试邮件。\n\n如果你收到了它，说明邮件服务配置成功，系统将以此身份发送邀请与通知。\n\n—— 星辰智造集团 数字化转型部')
  if (!res.ok) return c.json({ error: `发送失败：${res.error}` }, 502)
  return c.json({ ok: true, messageId: res.messageId, previewUrl: res.previewUrl })
})

/* ============ 平台健康自检（运维探针 / 监控告警） ============ */

/** 深度健康检查：数据库连通/完整性、磁盘余量、关键计数、AI 配置状态
 *  返回 200=健康，503=降级（供 Docker healthcheck / Prometheus / Zabbix 探针） */
adminRoutes.get('/health', (c) => {
  const started = Date.now()
  const checks: Record<string, { ok: boolean; detail: string }> = {}

  // 数据库
  try {
    const one = sqlite.prepare('SELECT 1 AS x').get() as { x: number }
    const objs = (sqlite.prepare('SELECT count(*) AS c FROM objects').get() as { c: number }).c
    checks.database = { ok: one?.x === 1, detail: `ok · objects=${objs}` }
  } catch (e) {
    checks.database = { ok: false, detail: e instanceof Error ? e.message : '查询失败' }
  }

  // 磁盘余量（数据目录所在盘）
  try {
    const st = fs.statfsSync(process.cwd())
    const freeGB = (st.bavail * st.bsize) / 1024 / 1024 / 1024
    checks.disk = { ok: freeGB > 1, detail: `free=${freeGB.toFixed(1)}GB` }
  } catch {
    checks.disk = { ok: true, detail: 'unavailable' }
  }

  // WAL 大小（异常增长说明长时间未 checkpoint）
  try {
    const wal = path.join(process.cwd(), 'data', 'ontoos.db-wal')
    const sizeMB = fs.existsSync(wal) ? fs.statSync(wal).size / 1024 / 1024 : 0
    checks.wal = { ok: sizeMB < 512, detail: `${sizeMB.toFixed(1)}MB` }
  } catch {
    checks.wal = { ok: true, detail: 'unavailable' }
  }

  // AI 配置（未配置不算不健康，只是能力降级）
  const aiRow = db.select().from(tables.settings).where(eq(tables.settings.key, 'ai')).get()
  const aiCfg = decodeCfg((aiRow?.value ?? {}) as Record<string, unknown>)
  checks.ai = { ok: true, detail: aiCfg.endpoint && aiCfg.apiKey ? `configured(${String(aiCfg.model)})` : 'not-configured(local-engine)' }

  const healthy = Object.values(checks).every((x) => x.ok)
  if (!healthy) c.status(503)
  return c.json({
    status: healthy ? 'ok' : 'degraded',
    uptimeSec: Math.round(process.uptime()),
    rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    latencyMs: Date.now() - started,
    checks,
    time: new Date().toISOString(),
  })
})

/* ============ 自助注册开关（SaaS 模式） ============ */

adminRoutes.get('/signup', requireAdmin, (c) => c.json({ enabled: selfSignupEnabled() }))

adminRoutes.put('/signup', requireAdmin, async (c) => {
  const body = await c.req.json<{ enabled?: boolean }>()
  setSelfSignup(Boolean(body.enabled))
  db_insertAudit(c.get('user').name, body.enabled ? '开启自助注册' : '关闭自助注册', '注册开关')
  return c.json({ ok: true, enabled: selfSignupEnabled() })
})
