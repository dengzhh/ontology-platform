import type { Context, Next } from 'hono'

/**
 * 平台安全中间件（单机内存实现；多实例部署时替换为 Redis 后端即可，接口不变）
 * - rateLimit：滑动窗口限流（按 IP）
 * - loginGuard：登录防爆破（账号+IP 维度失败锁定）
 * - securityHeaders：安全响应头 + CSP（生产模式启用）
 * - clientIp：取真实客户端 IP（可信代理下读 x-forwarded-for）
 */

interface Bucket { hits: number[] }
const buckets = new Map<string, Bucket>()

/** 滑动窗口计数：返回当前窗口内第几次命中（含本次），并清理过期桶 */
function hit(key: string, windowMs: number): number {
  const now = Date.now()
  const b = buckets.get(key) ?? { hits: [] }
  b.hits = b.hits.filter((t) => now - t < windowMs)
  b.hits.push(now)
  buckets.set(key, b)
  // 顺手清理（桶数 >5000 时全量扫一次，防止内存缓慢增长）
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (v.hits.every((t) => now - t >= windowMs)) buckets.delete(k)
    }
  }
  return b.hits.length
}

function clear(key: string) {
  buckets.delete(key)
}

export function clientIp(c: Context): string {
  // 仅在显式声明可信代理时才采信 x-forwarded-for（防止伪造 IP 绕过限流）
  if (process.env.TRUST_PROXY) {
    const fwd = c.req.header('x-forwarded-for')
    if (fwd) return fwd.split(',')[0].trim()
  }
  const inc = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming
  return inc?.socket?.remoteAddress ?? 'unknown'
}

/** 按 IP 限流：limit 次 / windowMs，超限返回 429 */
export function ipRateLimit(limit: number, windowMs: number, scope: string) {
  return async (c: Context, next: Next) => {
    const n = hit(`${scope}:${clientIp(c)}`, windowMs)
    if (n > limit) {
      c.header('Retry-After', String(Math.ceil(windowMs / 1000)))
      return c.json({ error: '请求过于频繁，请稍后再试' }, 429)
    }
    await next()
  }
}

/** 登录防爆破：同一 账号+IP 连续失败 N 次锁定 lockMs；成功登录清零 */
const MAX_LOGIN_FAILS = 5
const LOGIN_LOCK_MS = 15 * 60 * 1000

function failKey(account: string, ip: string) {
  return `loginfail:${account}:${ip}`
}

export function loginLockedRemaining(account: string, ip: string): number {
  const b = buckets.get(failKey(account, ip))
  if (!b) return 0
  const fails = b.hits.filter((t) => Date.now() - t < LOGIN_LOCK_MS).length
  if (fails < MAX_LOGIN_FAILS) return 0
  const oldest = Math.min(...b.hits.filter((t) => Date.now() - t < LOGIN_LOCK_MS))
  return Math.max(0, LOGIN_LOCK_MS - (Date.now() - oldest))
}

export function recordLoginFail(account: string, ip: string) {
  hit(failKey(account, ip), LOGIN_LOCK_MS)
}

export function recordLoginOk(account: string, ip: string) {
  clear(failKey(account, ip))
}

/** 安全响应头；CSP 仅在生产模式收紧（Vite 开发态需要 eval/内联） */
export function securityHeaders() {
  return async (c: Context, next: Next) => {
    await next()
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('X-Frame-Options', 'DENY')
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
    c.header('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()')
    if (process.env.NODE_ENV === 'production') {
      c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
      // 前端构建产物无内联脚本；图表/画布库用到内联样式，样式侧放开 inline
      c.header(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      )
    }
  }
}
