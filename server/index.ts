import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
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

const app = new Hono()
app.use(logger())

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

const PORT = Number(process.env.PORT || 5000)
serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[ontoos-api] listening on http://localhost:${info.port}`)
})
