/** API 客户端：自动携带 JWT，统一错误处理 */

const TOKEN_KEY = 'ontoos.token'
const SPACE_KEY = 'ontoos.space'

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || ''
}
export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t)
}
export function getSpaceId(): string {
  return localStorage.getItem(SPACE_KEY) || ''
}
export function setSpaceId(id: string) {
  localStorage.setItem(SPACE_KEY, id)
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem('ontoos.currentUser')
  localStorage.removeItem(SPACE_KEY)
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  const spaceId = getSpaceId()
  if (spaceId) headers['x-space-id'] = spaceId
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    /* 空响应体 */
  }
  if (!res.ok) {
    const msg = (data as { error?: string })?.error ?? `请求失败（${res.status}）`
    // 会话失效（令牌过期 / 已登出 / 被管理员停用）：清理本地态并回到登录页
    // 登录接口自身的 401 不跳转，交给登录表单展示「账号或密码错误」
    if (res.status === 401 && !path.startsWith('/auth/login') && getToken()) {
      clearToken()
      if (!location.pathname.startsWith('/login')) {
        location.href = `/login?expired=1&next=${encodeURIComponent(location.pathname + location.search)}`
      }
    }
    throw new ApiError(msg, res.status)
  }
  return data as T
}
