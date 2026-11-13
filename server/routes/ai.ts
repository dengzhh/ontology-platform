import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, tables } from '../db'
import { requireAuth, requireAdmin } from '../auth'
import { AI_TOOLS, NAV_HINTS, TYPE_ALIASES } from '../../shared/ai-tools'
import { certifiedTermDigest, resolveTerms, semanticGuard } from '../engine/semantic'
import type { SessionUser } from '../../shared/types'

interface AiConfig {
  endpoint: string
  model: string
  apiKey: string
}

function getAiConfig(): AiConfig | null {
  const row = db.select().from(tables.settings).where(eq(tables.settings.key, 'ai')).get()
  if (!row) return null
  const v = row.value as unknown as Partial<AiConfig>
  if (!v.endpoint || !v.model) return null
  return { endpoint: v.endpoint, model: v.model, apiKey: v.apiKey || '' }
}

/** 通用补全（无工具），供本体抽取等场景复用；未配置时抛 AI_NOT_CONFIGURED */
export async function llmComplete(system: string, user: string): Promise<string> {
  const cfg = getAiConfig()
  if (!cfg) throw new Error('AI_NOT_CONFIGURED')
  const r = await callLlm(cfg, [{ role: 'system', content: system }, { role: 'user', content: user }], [])
  return r.reply
}

function saveAiConfig(cfg: AiConfig) {
  const now = Date.now()
  const existing = db.select().from(tables.settings).where(eq(tables.settings.key, 'ai')).get()
  if (existing) {
    db.update(tables.settings).set({ value: cfg as unknown as Record<string, unknown>, updatedAt: now }).where(eq(tables.settings.key, 'ai')).run()
  } else {
    db.insert(tables.settings).values({ key: 'ai', value: cfg as unknown as Record<string, unknown>, updatedAt: now }).run()
  }
}

interface WireMsg {
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: { id: string; name: string; args: Record<string, unknown> }[]
  toolCallId?: string
}

export const aiRoutes = new Hono<{ Variables: { user: SessionUser } }>()
aiRoutes.use('*', requireAuth)

/** 助手会话列表（当前用户 + 当前空间，最近 10 个） */
aiRoutes.get('/conversations', async (c) => {
  const user = c.get('user')
  const space = c.req.header('x-space-id') ?? ''
  const rows = db.select().from(tables.aiConversations).all()
    .filter((x) => x.scene === 'assist' && x.userId === user.id && x.spaceId === space)
    .sort((a, b) => b.createdAt - a.createdAt).slice(0, 10)
  return c.json({
    conversations: rows.map((x) => ({
      id: x.id, title: x.title, createdAt: new Date(x.createdAt).toLocaleString('zh-CN', { hour12: false }),
    })),
  })
})

/** 新建助手会话 */
aiRoutes.post('/conversations', async (c) => {
  const user = c.get('user')
  const space = c.req.header('x-space-id') ?? ''
  const body = await c.req.json<{ title?: string }>().catch(() => ({ title: undefined }))
  const id = `AC-${Date.now().toString(36).toUpperCase()}`
  db.insert(tables.aiConversations).values({ id, title: body.title || '新对话', scene: 'assist', userId: user.id, spaceId: space, createdAt: Date.now() }).run()
  return c.json({ id })
})

/** 读取助手会话消息 */
aiRoutes.get('/conversations/:id/messages', (c) => {
  const user = c.get('user')
  const conv = db.select().from(tables.aiConversations).where(eq(tables.aiConversations.id, c.req.param('id'))).get()
  if (!conv || conv.userId !== user.id) return c.json({ error: '会话不存在' }, 404)
  const rows = db.select().from(tables.aiMessages).all().filter((m) => m.conversationId === conv.id).sort((a, b) => a.createdAt - b.createdAt)
  return c.json({
    messages: rows.map((m) => ({ role: m.role, content: m.content, cites: m.cites, toolCalls: m.toolCalls, createdAt: new Date(m.createdAt).toLocaleString('zh-CN', { hour12: false }) })),
  })
})

/** 追加助手消息（前端工具调用完成后写入） */
aiRoutes.post('/conversations/:id/messages', async (c) => {
  const user = c.get('user')
  const conv = db.select().from(tables.aiConversations).where(eq(tables.aiConversations.id, c.req.param('id'))).get()
  if (!conv || conv.userId !== user.id) return c.json({ error: '会话不存在' }, 404)
  const body = await c.req.json<{ role: 'user' | 'assistant' | 'tool'; content: string; cites?: string[]; toolCalls?: { name: string; arg: string; result: string }[]; toolCallId?: string }>()
  const id = `AM-${Date.now().toString(36)}${Math.floor(Math.random() * 100)}`
  db.insert(tables.aiMessages).values({
    id, conversationId: conv.id, role: body.role, content: body.content,
    cites: body.cites, toolCalls: body.toolCalls, createdAt: Date.now(),
  }).run()
  if (body.role === 'user') {
    db.update(tables.aiConversations).set({ title: body.content.slice(0, 20) }).where(eq(tables.aiConversations.id, conv.id)).run()
  }
  return c.json({ id })
})

/** 删除助手会话 */
aiRoutes.delete('/conversations/:id', async (c) => {
  const user = c.get('user')
  const conv = db.select().from(tables.aiConversations).where(eq(tables.aiConversations.id, c.req.param('id'))).get()
  if (!conv || conv.userId !== user.id) return c.json({ error: '会话不存在' }, 404)
  for (const m of db.select().from(tables.aiMessages).all().filter((x) => x.conversationId === conv.id)) db.delete(tables.aiMessages).where(eq(tables.aiMessages.id, m.id)).run()
  db.delete(tables.aiConversations).where(eq(tables.aiConversations.id, conv.id)).run()
  return c.json({ ok: true })
})

/** 配置状态（登录即可见，不含密钥） */
aiRoutes.get('/status', (c) => {
  const cfg = getAiConfig()
  return c.json({ configured: !!cfg, model: cfg?.model ?? '', engine: cfg ? 'llm' : 'local' })
})

aiRoutes.get('/config', requireAdmin, (c) => {
  const cfg = getAiConfig()
  if (!cfg) return c.json({ configured: false })
  return c.json({ configured: true, config: { endpoint: cfg.endpoint, model: cfg.model, apiKey: '' } })
})

aiRoutes.put('/config', requireAdmin, async (c) => {
  const body = await c.req.json<Partial<AiConfig>>()
  if (!body.endpoint || !body.model) return c.json({ error: '请填写接口地址与模型名称' }, 400)
  const prev = getAiConfig()
  saveAiConfig({ endpoint: body.endpoint, model: body.model, apiKey: body.apiKey || prev?.apiKey || '' })
  db.insert(tables.auditEvents).values({
    id: `AE-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    actor: c.get('user').name, action: '保存 AI 服务配置', target: body.model, ip: '本地', createdAt: Date.now(),
  }).run()
  return c.json({ ok: true })
})

/** 测试连通：发一条最小对话 */
aiRoutes.post('/test', requireAdmin, async (c) => {
  const cfg = getAiConfig()
  if (!cfg) return c.json({ error: '尚未配置 AI 服务' }, 400)
  try {
    const res = await callLlm(cfg, [{ role: 'user', content: '只回复两个字：连通' }], [])
    return c.json({ ok: true, reply: res.reply })
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : '测试失败' }, 502)
  }
})

/** 对话主入口：多轮工具调用协议（前端循环执行工具，空间感知） */
aiRoutes.post('/chat', async (c) => {
  const user = c.get('user')
  const { messages, context } = await c.req.json<{ messages: WireMsg[]; context?: { page?: string } }>()
  const history = (messages ?? []).slice(-20)
  const last = [...history].reverse().find((m) => m.role === 'user')
  if (!last) return c.json({ error: '缺少用户消息' }, 400)

  // 空间感知：从请求头解析当前空间名
  const { resolveSpace } = await import('../space')
  const space = resolveSpace(c, user)
  const spaceId = space?.id ?? ''

  // 系统用法类问题前置拦截（确定性，LLM 模式也生效）：直接给入口 + navigate，不绕数据/知识工具
  const help = systemHelp(last.content)
  if (help) return c.json(help)

  // 语义层守卫：数据/指标类问题若没有已认证术语覆盖，明确拒答而非编造口径
  const guard = semanticGuard(last.content, spaceId)
  if (guard.blocked) return c.json({ reply: guard.reply, toolCalls: [] })

  const cfg = getAiConfig()
  const system = buildSystemPrompt(user, context?.page ?? '', space?.name ?? '', spaceId)

  if (cfg) {
    try {
      const res = await callLlm(cfg, [{ role: 'system', content: system }, ...toOpenAi(history)], AI_TOOLS)
      return c.json(res)
    } catch (e) {
      // 网关不可用（429/超时）时降级到本地引擎，保留其工具调用，别把 toolCalls 丢掉
      const local = localAnswer(user, last.content, spaceId)
      return c.json({
        reply: `模型网关暂时不可用（${e instanceof Error ? e.message : '未知错误'}），已切换到本地引擎。${local.reply ? '\n\n' + local.reply : ''}`,
        toolCalls: local.toolCalls,
      })
    }
  }
  // 未配置 → 本地意图引擎
  // 若对话尾部是工具结果（前端已执行完工具），则汇总收口而不是重复解析意图
  const trailingTools: WireMsg[] = []
  for (let i = history.length - 1; i >= 0 && history[i].role === 'tool'; i--) trailingTools.unshift(history[i])
  if (trailingTools.length > 0) {
    const summary = trailingTools
      .map((m) => m.content)
      .join('\n\n')
      .slice(0, 800)
    return c.json({ reply: `已完成，结果如下：\n${summary}` })
  }
  return c.json(localAnswer(user, last.content, spaceId))
})

/* ---------------- LLM 调用（OpenAI 兼容 /chat/completions） ---------------- */

interface LlmResult {
  reply: string
  toolCalls?: { id: string; name: string; args: Record<string, unknown> }[]
}

async function callLlm(cfg: AiConfig, messages: unknown[], tools: typeof AI_TOOLS | []): Promise<LlmResult> {
  const url = cfg.endpoint.replace(/\/$/, '') + '/chat/completions'
  const body: Record<string, unknown> = { model: cfg.model, messages, temperature: 0.2 }
  if (tools.length > 0) {
    body.tools = tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: {
          type: 'object',
          properties: Object.fromEntries(t.parameters.map((p) => [p.name, { type: p.type, description: p.desc, ...(p.enumValues ? { enum: p.enumValues } : {}) }])),
          required: t.parameters.filter((p) => p.required).map((p) => p.name),
        },
      },
    }))
    body.tool_choice = 'auto'
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`接口返回 ${res.status}：${text.slice(0, 120)}`)
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[] }
  const msg = data.choices?.[0]?.message
  const toolCalls = msg?.tool_calls?.map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    args: safeJson(tc.function.arguments),
  }))
  return { reply: msg?.content ?? '', toolCalls: toolCalls?.length ? toolCalls : undefined }
}

function safeJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s) as Record<string, unknown>
  } catch {
    return {}
  }
}

function toOpenAi(history: WireMsg[]): unknown[] {
  return history.map((m) => {
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content }
    if (m.role === 'assistant' && m.toolCalls) {
      return {
        role: 'assistant',
        content: m.content || '',
        tool_calls: m.toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args) } })),
      }
    }
    return { role: m.role, content: m.content }
  })
}

/* ---------------- System Prompt ---------------- */

function buildSystemPrompt(user: SessionUser, page: string, spaceName: string, spaceId: string): string {
  // 空间感知：以工具实时返回为准（前端工具请求会带 x-space-id）
  const spaceHint = spaceName ? `当前本体空间：${spaceName}。` : ''
  const types = db.select().from(tables.objectTypes).all()
  const actions = db.select().from(tables.actionTypes).all()
  const digest = spaceId ? certifiedTermDigest(spaceId) : ''
  // 平台功能入口对照：用户问「X 在哪儿配置 / 怎么用 / 什么是 X」时直接给路径 + navigate，不要绕去查数据
  const HELP_ENTRIES = [
    '业务术语/认证指标/可信业务定义 → 本体管理器（/ontology/manager 的「业务术语」Tab），可新建术语、加同义词、认证口径',
    '对象类型/链接/动作/函数/接口建模 → 本体管理器（/ontology/manager）',
    '对象实例增删改查 → 对象浏览器（/ontology/explorer）',
    '分组统计/图表/时间趋势 → Contour 分析（/analytics/contour）或对话内直接问「按…统计」',
    '知识文档入库/检索/抽取 → 知识库（/knowledge/library）、知识检索（/knowledge/search）、知识抽取（/knowledge/extract）',
    '审批/审计/权限标记 → 审批中心（/gov/approvals）、审计日志（/gov/audit）、安全与标记（/gov/security）',
    'AI/嵌入/视觉/SMTP 模型配置 → 控制面板（/admin/control）',
    '用户/角色/用户组/邀请 → 用户与权限（/admin/users）',
    '功能实现进度 → 实现进度（/admin/roadmap）',
    '外部数据源/表预览/同步 → 数据连接（/data/connections）',
    'AIP 工作流/Agent/模型 → /aip/logic、/aip/agents、/aip/models',
    '扫描识别/识别模板 → 顶栏「扫描录入」、识别模板（/admin/scan-templates）',
    '场景分支/对象集比较/派生属性 → 对象浏览器（/ontology/explorer）的高级能力区，也可直接让助手操作',
    '部署/晋升/回滚/集群 → Apollo 部署（/admin/apollo）',
    '空间切换/导出 → 顶栏空间切换器、应用中心（/launcher）的导入/导出；也可让助手列出空间',
  ].join('\n')
  return [
    '你是 OntoOS 本体智能平台的 AIP 助手，帮助用户操作平台、查询业务数据、完成管理任务。',
    '',
    `当前用户：${user.name}（角色：${user.role.name}）。${spaceHint}用户当前所在页面：${page || '未知'}。`,
    '',
    '平台对象类型（以工具实时返回为准，以下为参考）：' + types.map((t) => t.name).slice(0, 15).join('、'),
    '动作类型参考：' + actions.map((a) => a.name).slice(0, 10).join('、'),
    '主要页面：' + NAV_HINTS.map((n) => n.name).join('、'),
    digest ? '\n【已认证业务术语/指标（回答数据问题时必须按此口径，不要自行定义）】\n' + digest : '',
    '\n【平台功能入口对照（用户问「在哪儿配置 / 怎么用 / 什么是 X」时用）】\n' + HELP_ENTRIES,
    '',
    '工作准则：',
    '1. 涉及打开/查看某页面 → 调用 navigate；查询业务对象明细 → query_objects；了解本体 → ontology_overview；管理用户 → list_users / invite_user。',
    '2. 【系统用法类优先】用户问「某功能在哪儿配置 / 怎么用 / 什么是某概念 / 平台怎么设置」等**关于本平台操作方法**的问题 → 依据上方「平台功能入口对照」直接给出页面路径与一句话说明，并调用 navigate 跳到对应页面；**不要调用 analyze_objects / search_knowledge / query_objects 等数据工具**（这类问题不是查业务数据，也不是查知识库文档）。',
    '3. 【ChatBI】问「各/按…统计、多少、占比、趋势、最多/最大、平均、分布、画个图、TOP几、环比、同比」等分析类问题 → 必须调用 analyze_objects（选 typeId、groupBy，有金额类问题带 metric，问趋势带 bucket=month），基于真实聚合结果回答；不要只列原始对象。问「TOP N / 前N大」带 top=N；问「环比」带 compare=prev、问「同比」带 compare=yoy，并同时给 from/to 当期窗口（如问环比上月 → from/to 为上个完整月的起止日）；回答对比类问题时必须给出本期值、上期值与增减百分比。',
    '4. 制度、流程、规范、故障处理等「文档里怎么写」的问题 → 必须先调用 search_knowledge 检索知识库，并基于检索结果回答、注明来源文档。',
    '5. 需要改数据时 → list_actions 查看可用动作，再用 execute_action 执行（需审批的会提示）。',
    '6. 【高级能力】场景/合并→manage_scenario；对象集比较→compare_objects；派生属性→eval_derived；部署/晋升/回滚→apollo_deploy；时序采集→collect_timeseries；外部数据源→sync_source；审批→decide_approval；空间→space_action；函数→run_function；管道→run_pipeline；排程→get_schedule；治理→governance_scan。按用户意图直接调用对应工具，不要绕去 navigate 或查数据。',
    '7. 工具结果返回后，用简洁中文总结要点（可用列表），并注明依据（如「来源：分组聚合」「来源：《XX手册》」）。',
    '8. 权限不足或检索无结果时如实告知，不要编造。',
    '9. 回答保持精炼，不超过 200 字，除非用户要求详细。',
  ].join('\n')
}

/* ---------------- 系统用法帮助（LLM 与本地引擎共享，确定性前置拦截） ---------------- */

const HELP_MAP: { re: RegExp; page: string; desc: string }[] = [
  { re: /(可信业务定义|业务术语|认证指标|指标口径|术语表|同义词)/, page: '本体管理器', desc: '在「本体管理器 → 业务术语」Tab 新建术语、加同义词、认证口径；认证后 AIP 与 Agent 才会按此口径回答' },
  { re: /(对象类型|链接类型|动作类型|本体建模|建模)/, page: '本体管理器', desc: '在「本体管理器」管理对象/链接/动作/函数/接口/业务术语六个 Tab' },
  { re: /(对象.*(增删改|录入|在哪)|对象实例|扫描录入)/, page: '对象浏览器', desc: '在「对象浏览器」增删改查实例，或用顶栏「扫描录入」拍照/上传文件识别入库' },
  { re: /(统计|图表|趋势|占比|分组分析|contour)/i, page: 'Contour 分析', desc: '在「Contour 分析」按维度分组聚合，也可直接在对话里问「按…统计」' },
  { re: /(知识库|文档入库|知识检索|知识抽取)/, page: '知识库', desc: '在「知识库」上传文档、「知识检索」混合检索、「知识抽取」把候选落地为本体' },
  { re: /(模型.*配置|AI 服务|嵌入模型|视觉模型|SMTP|控制面板)/i, page: '控制面板', desc: '在「控制面板」配置 AI/嵌入/视觉/SMTP 四张卡，保存后会回显已保存状态' },
  { re: /(审批|审计日志|权限标记|脱敏)/, page: '审批中心', desc: '审批在「审批中心」，留痕在「审计日志」，标记与脱敏规则在「安全与标记」' },
  { re: /(用户管理|邀请用户|角色|用户组)/, page: '用户与权限', desc: '在「用户与权限」管理用户/角色/用户组并发送邀请' },
  { re: /(实现进度|路线图|哪些功能)/, page: '实现进度', desc: '在「实现进度」查看 42 页状态与阶段进度' },
  { re: /(外部数据|数据连接|同步.*对象|表预览)/, page: '数据连接', desc: '在「数据连接」登记 SQLite/CSV/JSON 外部源，可真实探测、表预览、同步为对象' },
  { re: /(工作流|AIP Logic|Agent|智能体|模型管理)/, page: 'AIP Logic', desc: '工作流在「AIP Logic」、Agent 在「Agent Studio」、模型在「模型管理」' },
  { re: /(识别模板|提示词模板|字段映射)/, page: '识别模板', desc: '在「识别模板」自定义提示词、字段映射与自动匹配' },
]

/** 系统用法类问题 → 直接给路径 + navigate（LLM 与本地引擎共享的确定性前置拦截） */
function systemHelp(text: string): LlmResult | null {
  if (!/(在哪儿|在哪里|在哪|怎么配置|如何配置|怎么设置|怎么用|如何使用|什么是|入口|配置.*在哪|怎么操作|哪儿配置)/.test(text)) return null
  const hit = HELP_MAP.find((h) => h.re.test(text))
  if (!hit) return null
  return { reply: `${hit.desc}。\n\n正在为你打开「${hit.page}」…`, toolCalls: [{ id: 'sys-help-nav', name: 'navigate', args: { page: hit.page } }] }
}

/* ---------------- 本地意图引擎（未配置 LLM 时的降级） ---------------- */

function localAnswer(user: SessionUser, text: string, spaceId: string): LlmResult {
  const t = text.trim()
  const help = systemHelp(t)
  if (help) return help
  // 语义层守卫（本地引擎同样生效）
  const guard = semanticGuard(t, spaceId)
  if (guard.blocked) return { reply: guard.reply ?? '当前问题缺少可信业务定义，无法可靠回答。', toolCalls: [] }
  // 已认证术语命中：把口语问法归一到确定口径，作为回答依据
  const terms = resolveTerms(t, spaceId)
  if (terms.length) {
    const digest = certifiedTermDigest(spaceId)
    return { reply: `已按认证口径理解你的问题：\n${digest}\n\n（本地引擎仅做口径说明，配置 AI 服务后可基于该口径做完整回答）`, toolCalls: [] }
  }

  // 打开页面
  if (/^(打开|进入|去|跳转|切换到|带我去|看)/.test(t) || /(页面|看板|工作台)$/.test(t)) {
    const hit = NAV_HINTS.find((n) => t.includes(n.name) || n.keywords.some((k) => t.toLowerCase().includes(k.toLowerCase())))
    if (hit) return { reply: '', toolCalls: [{ id: 'local-nav', name: 'navigate', args: { page: hit.name } }] }
  }

  // 邀请用户
  if (/邀请|添加.*用户|新建.*账号|创建.*账号/.test(t)) {
    const name = t.match(/邀请\s*([\u4e00-\u9fa5]{2,4})/)?.[1] ?? t.match(/账号?[:：]?\s*([\u4e00-\u9fa5]{2,4})/)?.[1]
    const account = t.match(/([a-z]+\.[a-z]+)/)?.[1]
    const roleHit = ['平台管理员', '数据工程师', '业务分析师', '维修工程师', '生产计划员', '合规审计员'].find((r) => t.includes(r))
    if (name && account && roleHit) {
      return { reply: '', toolCalls: [{ id: 'local-inv', name: 'invite_user', args: { name, account, role: roleHit } }] }
    }
    return { reply: '好的，创建邀请需要：姓名、拼音账号（如 zhang.san）、角色。\n示例：「邀请 张三 zhang.san 维修工程师」' }
  }

  // 用户列表
  if (/(用户|成员|人员)/.test(t) && /(有哪些|列表|多少|谁|查看|列出)/.test(t)) {
    return { reply: '', toolCalls: [{ id: 'local-lu', name: 'list_users', args: {} }] }
  }

  // 第 3 批高级能力（本地引擎降级时也让新工具生效）
  if (/(排程|排产|利用率|准时率|延期|调度任务)/.test(t)) {
    const solve = /(求解|重新排|优化排程)/.test(t)
    return { reply: '', toolCalls: [{ id: 'local-sch', name: 'get_schedule', args: { action: solve ? 'solve' : 'view' } }] }
  }
  if (/(扫描敏感|敏感数据扫描|脱敏预览|生命周期检查|合规检查)/.test(t)) {
    const kind = /脱敏/.test(t) ? 'mask' : /生命周期|到期/.test(t) ? 'lifecycle' : 'scan'
    return { reply: '', toolCalls: [{ id: 'local-gov', name: 'governance_scan', args: { kind } }] }
  }
  if (/(有哪些空间|空间列表|列出空间)/.test(t)) return { reply: '', toolCalls: [{ id: 'local-sp', name: 'space_action', args: { action: 'list' } }] }
  if (/(有哪些|列出).*(场景|场景分支)/.test(t)) return { reply: '', toolCalls: [{ id: 'local-scn', name: 'manage_scenario', args: { action: 'list' } }] }
  if (/(派生属性)/.test(t)) return { reply: '', toolCalls: [{ id: 'local-drv', name: 'eval_derived', args: { action: 'list' } }] }
  if (/(部署记录|发布记录|集群)/.test(t)) return { reply: '', toolCalls: [{ id: 'local-dep', name: 'apollo_deploy', args: { action: /集群/.test(t) ? 'clusters' : 'view' } }] }
  if (/(数据源|外部连接|连接列表)/.test(t)) return { reply: '', toolCalls: [{ id: 'local-src', name: 'sync_source', args: { action: 'list' } }] }
  if (/(待审批|审批单)/.test(t)) return { reply: '', toolCalls: [{ id: 'local-appr', name: 'decide_approval', args: { action: 'list' } }] }
  if (/(采集.*时序|时序采集|真实曲线)/.test(t)) return { reply: '', toolCalls: [{ id: 'local-ts', name: 'collect_timeseries', args: { valueKey: 'health' } }] }

  // ChatBI 聚合分析（本地引擎兜底）：命中分析问法 + 类型别名时调用 analyze_objects
  const ANALYZE_RE = /(统计|聚合|占比|分布|趋势|各.*(多少|花费|金额)|按.*(统计|分组|分析|汇总)|最多|最大|平均|画个图|图表|TOP\s*\d|前\s*\d+\s*[个条名])/
  if (ANALYZE_RE.test(t)) {
    const hit = Object.keys(TYPE_ALIASES).find((k) => t.includes(k))
    // 没带类型词但明显是消费/金额类问法时，兜底用 expense（组织空间会由前端字段归一给出可用字段）
    const type = hit ? TYPE_ALIASES[hit] : /(支出|消费|花费|金额|营收|类别)/.test(t) ? 'expense' : undefined
    if (type) {
      let groupBy = 'category'
      if (/(按|各)(日期|月份|月|时间)|趋势|按月/.test(t)) groupBy = 'date'
      else if (/(按|各)(商户|店铺)/.test(t)) groupBy = 'merchant'
      else if (/(按|各)(状态)/.test(t)) groupBy = 'status'
      else if (/(按|各)(支付方式)/.test(t)) groupBy = 'payment'
      else if (/(按|各)(优先级)/.test(t)) groupBy = 'priority'
      else if (/(设备|机器)/.test(t) && /TOP|前\s*\d|最大|最多/.test(t)) groupBy = 'name'
      const args: Record<string, unknown> = { typeId: type, groupBy }
      if (/(金额|花费|花了|总额|营收|收入|销售额|均价|平均)/.test(t)) args.metric = 'amount'
      if (/(停机)/.test(t)) args.metric = 'downtime'
      if (/(趋势|按月|每月|月份)/.test(t)) args.bucket = 'month'
      // TOP-N：TOP5 / 前 3 个 / 最大 5
      const topM = t.match(/TOP\s*(\d+)|前\s*(\d+)\s*[个条名大]|最大[的]?\s*(\d+)/i)
      if (topM) args.top = Number(topM[1] ?? topM[2] ?? topM[3])
      // 同比/环比：compare + 当期窗口默认取「上个完整月」
      if (/(环比|上月比|比上个月|上一期)/.test(t)) args.compare = 'prev'
      if (/(同比|比去年|去年同期)/.test(t)) args.compare = 'yoy'
      if (args.compare) {
        const now = new Date()
        const mEnd = new Date(now.getFullYear(), now.getMonth(), 0)           // 上月最后一天
        const mStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)     // 上月第一天
        const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        args.from = iso(mStart)
        args.to = iso(mEnd)
        // 对比类问题按月聚合更有信息量
        if (!args.bucket && groupBy !== 'date') { args.groupBy = 'date'; args.bucket = 'month' }
      }
      return { reply: '', toolCalls: [{ id: 'local-an', name: 'analyze_objects', args }] }
    }
  }

  // 对象查询
  const typeHit = Object.keys(TYPE_ALIASES).find((k) => t.includes(k))
  if (typeHit && /(查询|搜索|看看|列出|有哪些|多少|列表|状态)/.test(t)) {
    const kw = t.match(/["“](.+?)["”]/)?.[1] ?? undefined
    return { reply: '', toolCalls: [{ id: 'local-q', name: 'query_objects', args: { type: TYPE_ALIASES[typeHit], ...(kw ? { keyword: kw } : {}) } }] }
  }

  // 本体概览
  if (/(本体|对象类型|有哪些类型)/.test(t)) {
    return { reply: '', toolCalls: [{ id: 'local-oo', name: 'ontology_overview', args: {} }] }
  }

  // 动作列表
  if (/(有哪些动作|动作列表|能做什么动作|可以执行什么)/.test(t)) {
    return { reply: '', toolCalls: [{ id: 'local-la', name: 'list_actions', args: {} }] }
  }

  // 知识检索（本地引擎：问"怎么处理/规定/要求/流程/标准"类问题时检索知识库）
  if (/(怎么|如何|规定|要求|流程|标准|手册|SOP|文档|制度|条款|步骤|处理方法)/i.test(t) && !/^(打开|进入)/.test(t)) {
    return { reply: '', toolCalls: [{ id: 'local-kb', name: 'search_knowledge', args: { query: t.replace(/[?？。！!]/g, '').slice(0, 40) } }] }
  }

  // 执行动作：提取金额/标题等常见参数（本地引擎简化解析，LLM 模式由模型填参）
  if (/(记|来|添加|执行|完成|记录).{0,6}(一笔|一个)?/.test(t) && /(支出|收入|人情|日程|动作)/.test(t)) {
    const amount = t.match(/(\d+(?:\.\d+)?)\s*(块|元|¥)?/)?.[1]
    const title = t.match(/["“](.+?)["”]/)?.[1] ?? (/(支出|收入|人情)/.test(t) ? t.replace(/.*(记|来|添加|记录)/, '').replace(/\d+(?:\.\d+)?\s*(块|元|¥)?/, '').trim().slice(0, 12) : undefined)
    const args: Record<string, unknown> = {}
    if (title) args.title = title
    if (amount) args.amount = Number(amount)
    if (/支出/.test(t)) return { reply: '', toolCalls: [{ id: 'local-ea', name: 'execute_action', args: { action: '记一笔支出', params: JSON.stringify(args) } }] }
    if (/收入/.test(t)) return { reply: '', toolCalls: [{ id: 'local-ea', name: 'execute_action', args: { action: '记录收入', params: JSON.stringify(args) } }] }
    if (/人情/.test(t)) return { reply: '', toolCalls: [{ id: 'local-ea', name: 'execute_action', args: { action: '记录人情往来', params: JSON.stringify(args) } }] }
    if (/完成/.test(t) && /日程/.test(t)) return { reply: '请提供日程的对象 ID，或直接说「完成日程 objectId:xxx」。也可以让我先「查询日程」找到目标。' }
  }

  // 帮助
  if (/帮助|能做什么|怎么用|help/i.test(t)) {
    return { reply: helpText(user.role.name) }
  }

  return {
    reply: `我还没接入大模型（当前为本地引擎），支持这些指令：\n${helpLines()}\n\n如需自由对话与复杂任务，请管理员到「控制面板 → AI 服务」配置 OpenAI 兼容接口。`,
  }
}

function helpLines(): string {
  return ['· 打开 对象浏览器 / 本体管理器 / 审批中心 …（页面导航）', '· 查询设备 / 工单"GD-2291" / 客户（对象查询）', '· 平台有哪些用户（管理员）', '· 邀请 张三 zhang.san 维修工程师（管理员）', '· 本体概览'].join('\n')
}

function helpText(roleName: string): string {
  const admin = roleName === '平台管理员'
  return `我可以帮你操作这个平台：\n${helpLines()}${admin ? '\n（你是管理员，用户管理类指令可用）' : '\n（用户管理类指令需管理员身份）'}`
}
