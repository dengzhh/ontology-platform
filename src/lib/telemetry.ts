/**
 * 前端异常上报：生产环境把未捕获错误送到服务端日志（便于运维定位）
 * - 不阻塞 UI，失败静默
 * - 同一错误 5 分钟内只报一次，避免刷屏
 * - 开发态只打印控制台
 */

interface ClientError {
  kind: string
  message: string
  stack?: string
  url?: string
}

const seen = new Map<string, number>()
const DEDUPE_MS = 5 * 60 * 1000

export function reportClientError(err: ClientError) {
  if (import.meta.env.DEV) {
    console.error('[client-error]', err)
    return
  }
  const key = `${err.kind}:${err.message}`.slice(0, 200)
  const last = seen.get(key) ?? 0
  if (Date.now() - last < DEDUPE_MS) return
  seen.set(key, Date.now())

  try {
    void fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...err, stack: err.stack?.slice(0, 2000) }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* 上报失败不影响业务 */
  }
}
