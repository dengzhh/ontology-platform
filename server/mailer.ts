import nodemailer, { type Transporter } from 'nodemailer'
import { eq } from 'drizzle-orm'
import { db, tables } from './db'

export interface SmtpConfig {
  host: string
  port: number
  secure: boolean
  user: string
  pass: string
  from: string
  senderName: string
}

/** 读取 SMTP 配置（含密码，仅服务端内部使用） */
export function getSmtpConfig(): SmtpConfig | null {
  const row = db.select().from(tables.settings).where(eq(tables.settings.key, 'smtp')).get()
  if (!row) return null
  const v = row.value as unknown as Partial<SmtpConfig>
  if (!v.host || !v.user || !v.pass || !v.from) return null
  return {
    host: v.host,
    port: Number(v.port) || 465,
    secure: v.secure !== false,
    user: v.user,
    pass: v.pass,
    from: v.from,
    senderName: v.senderName || 'OntoOS 平台',
  }
}

export function isSmtpConfigured(): boolean {
  return getSmtpConfig() !== null
}

let cached: { key: string; transporter: Transporter } | null = null

function getTransporter(cfg: SmtpConfig): Transporter {
  const key = `${cfg.host}|${cfg.port}|${cfg.user}|${cfg.pass}`
  if (cached && cached.key === key) return cached.transporter
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
  })
  cached = { key, transporter }
  return transporter
}

export interface SendResult {
  ok: boolean
  messageId?: string
  error?: string
  previewUrl?: string
}

/** 发送纯文本邮件（系统作为发件人） */
export async function sendMail(to: string, subject: string, body: string): Promise<SendResult> {
  const cfg = getSmtpConfig()
  if (!cfg) return { ok: false, error: 'SMTP_NOT_CONFIGURED' }
  try {
    const info = await getTransporter(cfg).sendMail({
      from: `"${cfg.senderName}" <${cfg.from}>`,
      to,
      subject,
      text: body,
    })
    return { ok: true, messageId: info.messageId, previewUrl: nodemailer.getTestMessageUrl(info) || undefined }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 保存 SMTP 配置 */
export function saveSmtpConfig(cfg: SmtpConfig) {
  const now = Date.now()
  const existing = db.select().from(tables.settings).where(eq(tables.settings.key, 'smtp')).get()
  if (existing) {
    db.update(tables.settings).set({ value: cfg as unknown as Record<string, unknown>, updatedAt: now }).where(eq(tables.settings.key, 'smtp')).run()
  } else {
    db.insert(tables.settings).values({ key: 'smtp', value: cfg as unknown as Record<string, unknown>, updatedAt: now }).run()
  }
  cached = null
}
