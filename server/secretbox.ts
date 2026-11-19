import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

/**
 * settings 表密钥字段静态加密（AES-256-GCM）
 * - 存储：enc:v1:<iv>:<tag>:<data>（base64url）
 * - 读取兼容明文（历史数据平滑迁移；启动时 migrateSecrets 一次性回写加密）
 * - 密钥来源：环境变量 ONTOOS_SECRET（生产必填，缺失时启动拦截）；开发态用固定 dev 键
 */

const PREFIX = 'enc:v1:'

function boxKey(): Buffer {
  const secret = process.env.ONTOOS_SECRET || 'ontoos-dev-secretbox'
  return scryptSync(secret, 'ontoos-secretbox-salt', 32)
}

export function encSecret(plain: string): string {
  if (!plain || plain.startsWith(PREFIX)) return plain
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', boxKey(), iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${PREFIX}${iv.toString('base64url')}.${tag.toString('base64url')}.${data.toString('base64url')}`
}

export function decSecret(stored: string): string {
  if (!stored || !stored.startsWith(PREFIX)) return stored
  try {
    const [ivB, tagB, dataB] = stored.slice(PREFIX.length).split('.')
    const decipher = createDecipheriv('aes-256-gcm', boxKey(), Buffer.from(ivB, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagB, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(dataB, 'base64url')), decipher.final()]).toString('utf8')
  } catch {
    // 密钥不符（如 ONTOOS_SECRET 换过）：返回空串，调用方按「未配置」降级
    return ''
  }
}

/** 配置对象中的密钥字段名（settings 各卡的 apiKey 变体） */
const SECRET_FIELDS = ['apiKey', 'textApiKey', 'embedApiKey', 'secretKey'] as const

/** 读 settings 后调用：解密配置对象中的密钥字段（原地无密文字段则原样返回） */
export function decodeCfg<T extends Record<string, unknown>>(cfg: T): T {
  const out = { ...cfg }
  for (const f of SECRET_FIELDS) {
    if (typeof out[f] === 'string' && (out[f] as string).startsWith(PREFIX)) {
      ;(out as Record<string, unknown>)[f] = decSecret(out[f] as string)
    }
  }
  return out
}

/** 写 settings 前调用：加密配置对象中的明文密钥字段 */
export function encodeCfg<T extends Record<string, unknown>>(cfg: T): T {
  const out = { ...cfg }
  for (const f of SECRET_FIELDS) {
    if (typeof out[f] === 'string' && out[f] && !(out[f] as string).startsWith(PREFIX)) {
      ;(out as Record<string, unknown>)[f] = encSecret(out[f] as string)
    }
  }
  return out
}

export function isEncrypted(v: string): boolean {
  return typeof v === 'string' && v.startsWith(PREFIX)
}

export { PREFIX as SECRET_PREFIX }
