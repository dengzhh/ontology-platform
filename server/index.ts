import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { logger } from 'hono/logger'
import { compress } from 'hono/compress'
import { authRoutes } from './routes/auth'
import { userRoutes } from './routes/users'
import { roleRoutes } from './routes/roles'
import { adminRoutes } from './routes/admin'
import { aiRoutes } from './routes/ai'
import { objectRoutes } from './routes/objects'
import { ontologyRoutes } from './routes/ontology'
import { spaceRoutes } from './routes/spaces'
import { actionRoutes } from './routes/actions'
import { automationRoutes } from './routes/automations'
import { knowledgeRoutes } from './routes/knowledge'
import { workshopRoutes } from './routes/workshop'
import { extractRoutes } from './routes/extract'
import { dashboardRoutes } from './routes/dashboard'
import { aipRoutes } from './routes/aip'
import { p10Routes } from './routes/p10'
import { p10plusRoutes } from './routes/p10plus'
import { p10longRoutes } from './routes/p10long'
import { govRoutes } from './routes/governance'
import { dataLayerRoutes } from './routes/dataLayer'
import { logicRoutes } from './routes/logic'
import { scanRoutes } from './routes/scan'
import { scanSessionRoutes } from './routes/scanSession'
import { functionRoutes } from './routes/functions'
import { explorationRoutes } from './routes/explorations'
import { platformOpsRoutes } from './routes/platformOps'
import { schedulingRoutes } from './routes/scheduling'
import { apolloRoutes } from './routes/apollo'
import { securityHeaders, ipRateLimit } from './security'
import { assertJwtSecret } from './auth'
import { migrateSecrets } from './migrateSecrets'
import { ensureMigrated } from './migrate'
import { sqlite } from './db'

// 加载本地环境变量（.env.local / .env）：主密钥与部署参数
// 生产容器里由编排注入环境变量，此加载对已存在变量不覆盖
for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) {
    try {
      process.loadEnvFile(file)
      console.log(`[ontoos] 已加载环境变量文件 ${file}`)
    } catch { /* 老版本 Node 或文件不可读时忽略 */ }
  }
}

const isProd = process.env.NODE_ENV === 'production'

// 生产必填 ONTOOS_SECRET（密钥加密主密钥）；缺失则拒绝启动，避免以默认键加密生产密钥
if (isProd && !process.env.ONTOOS_SECRET) {
  console.error('[ontoos] 启动中止：生产模式必须设置环境变量 ONTOOS_SECRET（≥32 位随机串）')
  process.exit(1)
}
// JWT 签名密钥同理：默认值公开在仓库中，缺失可被任意伪造身份
assertJwtSecret(isProd)

// 幂等迁移：新部署首次启动自动建表（否则下面 migrateSecrets 查询 settings 会报 no such table）
ensureMigrated()

// 空库自动初始化演示数据（首个部署即可直接登录体验）
// 仅在 users 表为空时触发；设置 AUTO_SEED=false 可关闭（生产环境接真实数据时建议关闭）
if (process.env.AUTO_SEED !== 'false') {
  const userCount = (sqlite.prepare('SELECT count(*) AS c FROM users').get() as { c: number }).c
  if (userCount === 0) {
    console.log('[ontoos] 检测到空库，正在写入演示数据（可通过 AUTO_SEED=false 关闭）…')
    try {
      // 同步加载：生产产物为 CommonJS，不能使用顶层 await
      const { createRequire } = require('node:module') as typeof import('node:module')
      const req = createRequire(__filename)
      const { runSeed } = req('./seed') as typeof import('./seed')
      runSeed()
    } catch (e) {
      console.error('[ontoos] 自动初始化失败（不影响服务启动，可稍后手动执行 npm run seed）：', e instanceof Error ? e.message : e)
    }
  }
}

// 历史明文密钥一次性加密（幂等）
migrateSecrets()

const app = new Hono()

app.use(securityHeaders())
// 生产态压缩响应（前端 bundle 与 JSON 均受益；开发态跳过以便调试）
if (isProd) app.use(compress())
// 访问日志：开发态彩色单行；生产态结构化 JSON（便于日志采集）
if (!isProd) {
  app.use(logger())
} else {
  app.use(async (c, next) => {
    const start = Date.now()
    await next()
    console.log(JSON.stringify({
      t: new Date().toISOString(),
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Date.now() - start,
    }))
  })
}

// 分级限流：全局 600 次/分钟；登录 20 次/分钟；激活 10 次；手机会话 120 次（上传含视觉模型调用）
app.use('/api/*', ipRateLimit(600, 60_000, 'api'))
app.use('/api/auth/login', ipRateLimit(20, 60_000, 'login'))
app.use('/api/auth/activate', ipRateLimit(10, 60_000, 'activate'))
app.use('/api/scan-session/*', ipRateLimit(120, 60_000, 'scansession'))

app.get('/api/health', (c) => c.json({ ok: true, service: 'ontoos-api', time: new Date().toISOString() }))

app.route('/api/auth', authRoutes)
app.route('/api/users', userRoutes)
app.route('/api/roles', roleRoutes)
app.route('/api/admin', adminRoutes)
app.route('/api/ai', aiRoutes)
app.route('/api/objects', objectRoutes)
app.route('/api/ontology', ontologyRoutes)
app.route('/api/spaces', spaceRoutes)
app.route('/api/actions', actionRoutes)
app.route('/api/automations', automationRoutes)
app.route('/api/knowledge', knowledgeRoutes)
app.route('/api/workshop', workshopRoutes)
app.route('/api/extract', extractRoutes)
app.route('/api/dashboard', dashboardRoutes)
app.route('/api/aip', aipRoutes)
app.route('/api/p10', p10Routes)
app.route('/api/p10plus', p10plusRoutes)
app.route('/api/p10long', p10longRoutes)
app.route('/api/gov', govRoutes)
app.route('/api/data-layer', dataLayerRoutes)
app.route('/api/logic', logicRoutes)
app.route('/api/scan', scanRoutes)
app.route('/api/scan-session', scanSessionRoutes)
app.route('/api/fn', functionRoutes)
app.route('/api/explorations', explorationRoutes)
app.route('/api/ops', platformOpsRoutes)
app.route('/api/scheduling', schedulingRoutes)
app.route('/api/apollo', apolloRoutes)

// 前端异常上报（公开端点：未登录页面崩溃也要能上报；单独限流防刷）
app.post('/api/client-error', ipRateLimit(30, 60_000, 'clienterr'), async (c) => {
  type ClientErr = { kind?: string; message?: string; stack?: string; url?: string }
  const body = await c.req.json<ClientErr>().catch((): ClientErr => ({}))
  console.error(JSON.stringify({
    t: new Date().toISOString(), level: 'client', kind: body.kind, message: body.message,
    url: body.url, stack: body.stack, ua: c.req.header('user-agent'),
  }))
  return c.json({ ok: true })
})

// 未知 API 路径统一 JSON 404（避免被 SPA 回退成 HTML）
app.all('/api/*', (c) => c.json({ error: `接口不存在：${c.req.method} ${c.req.path}` }, 404))

// 生产模式：同进程托管前端构建产物（单端口部署，无需额外 Nginx）
const DIST = path.resolve(process.cwd(), 'dist')
if (isProd && existsSync(DIST)) {
  app.use('/*', serveStatic({ root: './dist' }))
  app.get('*', async (c, next) => {
    if (c.req.path.startsWith('/api/')) return next()
    return c.html(await readFile(path.join(DIST, 'index.html'), 'utf8'))
  })
  console.log(`[ontoos] 前端静态托管已启用：${DIST}`)
}

// 全局错误兜底：生产不泄漏堆栈，日志保留完整错误
app.onError((err, c) => {
  console.error(JSON.stringify({
    t: new Date().toISOString(),
    level: 'error',
    method: c.req.method,
    path: c.req.path,
    message: err.message,
    stack: isProd ? undefined : err.stack,
  }))
  if (err.message === 'AI_NOT_CONFIGURED') return c.json({ error: '未配置 AI 服务，请在控制面板配置' }, 400)
  return c.json({ error: isProd ? '服务器内部错误，请稍后重试' : err.message }, 500)
})

const PORT = Number(process.env.PORT || 5000)
const server = serve({ fetch: app.fetch, port: PORT, hostname: process.env.HOST || undefined }, (info) => {
  console.log(`[ontoos-api] listening on http://${process.env.HOST || 'localhost'}:${info.port} (${isProd ? 'production' : 'development'})`)
})

// 优雅关闭：停收新请求 → WAL checkpoint 落盘 → 关闭数据库
function shutdown(signal: string) {
  console.log(`[ontoos] 收到 ${signal}，正在关闭…`)
  server.close(() => {
    try { sqlite.pragma('wal_checkpoint(TRUNCATE)'); sqlite.close() } catch { /* 已关闭 */ }
    console.log('[ontoos] 已安全退出')
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 10_000).unref()
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
