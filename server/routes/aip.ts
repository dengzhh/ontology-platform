import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, tables } from '../db'
import { requireAuth } from '../auth'
import { resolveSpace, spaceCanModel, type SpaceInfo } from '../space'
import { llmComplete } from './ai'
import { runAgentTools } from '../engine/agentTools'
import { semanticGuard } from '../engine/semantic'
import type { SessionUser } from '../../shared/types'

/** 智能体 / 工作流 / 文档分析 API（P6）：Agent CRUD + 工作流 CRUD + 执行 + 文档对话 */

interface ToolDef { key: string; name: string; desc: string }
interface Guardrail { maskSensitive: boolean; requireApprovalForActions: boolean }

type Ctx = { Variables: { user: SessionUser; space: SpaceInfo } }

function audit(user: SessionUser, action: string, target: string) {
  db.insert(tables.auditEvents).values({
    id: `AE-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    actor: user.name, action, target, ip: '本地', createdAt: Date.now(),
  }).run()
}

export const aipRoutes = new Hono<Ctx>()
aipRoutes.use('*', requireAuth)
aipRoutes.use('*', async (c, next) => {
  const user = c.get('user')
  const space = resolveSpace(c, user)
  if (!space) return c.json({ error: '尚无可访问的本体空间' }, 403)
  c.set('space', space)
  await next()
})

/* ================ Agent Studio ================ */

/** Agent 列表（当前空间） */
aipRoutes.get('/agents', (c) => {
  const space = c.get('space')
  const convs = db.select().from(tables.aiConversations).all().filter((x) => x.spaceId === space.id && x.scene === 'agent')
  // Agent 存在 ai_conversations 里：title=名称，用 conversation 的 meta 存配置
  return c.json({
    space: { name: space.name },
    agents: convs.map((a) => {
      const msgs = db.select().from(tables.aiMessages).all().filter((m) => m.conversationId === a.id)
      // 从第一条 system 消息解析配置（简化存储）
      const sysMsg = msgs.find((m) => m.role === 'system')
      let config: { tools?: string[]; systemPrompt?: string; guardrail?: Guardrail; model?: string } = {}
      try { config = sysMsg ? JSON.parse(sysMsg.content) : {} } catch { /* 默认空 */ }
      return {
        id: a.id,
        name: a.title,
        desc: (config as { desc?: string }).desc ?? '',
        tools: config.tools ?? [],
        systemPrompt: config.systemPrompt ?? '',
        guardrail: config.guardrail ?? { maskSensitive: true, requireApprovalForActions: true },
        model: config.model ?? '',
        messageCount: msgs.filter((m) => m.role !== 'system').length,
        createdAt: new Date(a.createdAt).toLocaleString('zh-CN', { hour12: false }),
      }
    }),
  })
})

/** 创建/更新 Agent */
aipRoutes.post('/agents', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  if (!spaceCanModel(user, space)) return c.json({ error: '需要空间管理权限' }, 403)
  const body = await c.req.json<{ id?: string; name: string; desc?: string; tools?: string[]; systemPrompt?: string; guardrail?: Guardrail; model?: string }>()
  if (!body.name?.trim()) return c.json({ error: '请填写 Agent 名称' }, 400)

  const config = JSON.stringify({ tools: body.tools ?? [], systemPrompt: body.systemPrompt ?? '', guardrail: body.guardrail ?? { maskSensitive: true, requireApprovalForActions: true }, model: body.model ?? '', desc: body.desc ?? '' })
  const now = Date.now()

  if (body.id) {
    const conv = db.select().from(tables.aiConversations).all().find((x) => x.id === body.id && x.spaceId === space.id)
    if (!conv) return c.json({ error: 'Agent 不存在' }, 404)
    db.update(tables.aiConversations).set({ title: body.name.trim(), createdAt: now }).where(eq(tables.aiConversations.id, body.id)).run()
    // 更新 system 消息
    const sysMsg = db.select().from(tables.aiMessages).all().find((m) => m.conversationId === body.id && m.role === 'system')
    if (sysMsg) {
      db.update(tables.aiMessages).set({ content: config }).where(eq(tables.aiMessages.id, sysMsg.id)).run()
    } else {
      db.insert(tables.aiMessages).values({ id: `AM-${Date.now().toString(36)}`, conversationId: body.id, role: 'system', content: config, createdAt: now }).run()
    }
    audit(user, '更新 Agent', body.name)
    return c.json({ id: body.id })
  }

  const id = `AG-${Date.now().toString(36).toUpperCase()}`
  db.insert(tables.aiConversations).values({ id, title: body.name.trim(), scene: 'agent', userId: user.id, spaceId: space.id, createdAt: now }).run()
  db.insert(tables.aiMessages).values({ id: `AM-${Date.now().toString(36)}1`, conversationId: id, role: 'system', content: config, createdAt: now }).run()
  audit(user, '创建 Agent', body.name)
  return c.json({ id })
})

/** 删除 Agent */
aipRoutes.delete('/agents/:id', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  if (!spaceCanModel(user, space)) return c.json({ error: '需要空间管理权限' }, 403)
  const id = c.req.param('id') as string
  const conv = db.select().from(tables.aiConversations).all().find((x) => x.id === id && x.spaceId === space.id)
  if (!conv) return c.json({ error: 'Agent 不存在' }, 404)
  for (const m of db.select().from(tables.aiMessages).all().filter((x) => x.conversationId === id)) {
    db.delete(tables.aiMessages).where(eq(tables.aiMessages.id, m.id)).run()
  }
  db.delete(tables.aiConversations).where(eq(tables.aiConversations.id, id)).run()
  audit(user, '删除 Agent', conv.title)
  return c.json({ ok: true })
})

/** Agent 对话测试（调用 LLM） */
aipRoutes.post('/agents/:id/chat', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const id = c.req.param('id') as string
  const conv = db.select().from(tables.aiConversations).all().find((x) => x.id === id && x.spaceId === space.id)
  if (!conv) return c.json({ error: 'Agent 不存在' }, 404)
  const { message } = await c.req.json<{ message: string }>()
  if (!message?.trim()) return c.json({ error: '请输入消息' }, 400)

  const msgs = db.select().from(tables.aiMessages).all().filter((m) => m.conversationId === id).sort((a, b) => a.createdAt - b.createdAt)
  const sysMsg = msgs.find((m) => m.role === 'system')
  let config: { tools?: string[]; systemPrompt?: string; model?: string; guardrail?: { maskSensitive: boolean; requireApprovalForActions: boolean } } = {}
  try { config = sysMsg ? JSON.parse(sysMsg.content) : {} } catch { /* */ }

  // 语义层守卫：数据/指标类问题无已认证术语覆盖时明确拒答，避免 Agent 编造口径
  const guard = semanticGuard(message, space.id)
  if (guard.blocked) {
    db.insert(tables.aiMessages).values({ id: `AM-${Date.now().toString(36)}u`, conversationId: id, role: 'user', content: message, createdAt: Date.now() }).run()
    db.insert(tables.aiMessages).values({ id: `AM-${Date.now().toString(36)}a`, conversationId: id, role: 'assistant', content: guard.reply ?? '', createdAt: Date.now() }).run()
    return c.json({ reply: guard.reply, toolCalls: [] })
  }

  const now = Date.now()
  const userMsgId = `AM-${now.toString(36)}u`
  db.insert(tables.aiMessages).values({ id: userMsgId, conversationId: id, role: 'user', content: message, createdAt: now }).run()

  // 真实执行 Agent 已配置的工具（护栏生效）
  const toolResults = await runAgentTools(message, config.tools ?? [], config.guardrail ?? { maskSensitive: true, requireApprovalForActions: true }, space.id, user.id)
  const toolContext = toolResults.length
    ? '\n\n【工具执行结果（必须基于此回答，不要编造）】\n' + toolResults.map((r) => `[${r.name}] ${r.result}`).join('\n')
    : ''

  // 构建对话上下文
  const history = msgs.filter((m) => m.role !== 'system').slice(-6).map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
  const system = [
    config.systemPrompt || `你是「${conv.title}」，一个企业智能助手。基于当前空间「${space.name}」的数据和知识回答问题。`,
    config.tools?.length ? `已配置工具：${config.tools.join('、')}。工具结果已附在下方，回答必须引用真实结果，不要编造数据。` : '',
    config.guardrail?.maskSensitive ? '敏感字段（手机号/身份证/邮箱）必须脱敏展示。' : '',
    config.guardrail?.requireApprovalForActions ? '涉及写操作的动作不自动执行，提示用户到界面确认。' : '',
  ].filter(Boolean).join('\n')

  try {
    const reply = await llmComplete(system, [message, ...history.map((h) => `${h.role === 'user' ? '用户' : '助手'}: ${h.content}`).join('\n'), toolContext].join('\n\n'))
    const aiMsgId = `AM-${Date.now().toString(36)}a`
    db.insert(tables.aiMessages).values({ id: aiMsgId, conversationId: id, role: 'assistant', content: reply, createdAt: Date.now() }).run()
    return c.json({ reply, messageId: aiMsgId, toolCalls: toolResults.map((r) => ({ name: r.name, result: r.result.slice(0, 80) })) })
  } catch (e) {
    return c.json({ error: `LLM 调用失败：${e instanceof Error ? e.message : '未知'}` }, 502)
  }
})

/** Agent 对话历史 */
aipRoutes.get('/agents/:id/messages', (c) => {
  const space = c.get('space')
  const id = c.req.param('id') as string
  const conv = db.select().from(tables.aiConversations).all().find((x) => x.id === id && x.spaceId === space.id)
  if (!conv) return c.json({ error: 'Agent 不存在' }, 404)
  const msgs = db.select().from(tables.aiMessages).all().filter((m) => m.conversationId === id).sort((a, b) => a.createdAt - b.createdAt)
  return c.json({
    messages: msgs.filter((m) => m.role !== 'system').map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
      createdAt: new Date(m.createdAt).toLocaleString('zh-CN', { hour12: false }),
    })),
  })
})

/* ================ 文档分析（文档任务） ================ */

/** 文档任务列表 */
aipRoutes.get('/threads', (c) => {
  const space = c.get('space')
  const convs = db.select().from(tables.aiConversations).all().filter((x) => x.spaceId === space.id && x.scene === 'thread')
  return c.json({
    threads: convs.map((t) => {
      const msgs = db.select().from(tables.aiMessages).all().filter((m) => m.conversationId === t.id)
      return {
        id: t.id,
        title: t.title,
        messageCount: msgs.length,
        createdAt: new Date(t.createdAt).toLocaleString('zh-CN', { hour12: false }),
      }
    }),
  })
})

/** 拼装文档上下文（供首次分析与多轮追问共用）：把所选文档正文汇总为可读文本 */
function buildDocContext(spaceId: string, docIds: string[]): { content: string; titles: string[] } {
  if (!docIds.length) return { content: '', titles: [] }
  const docs = db.select().from(tables.documents).all().filter((d) => docIds.includes(d.id) && d.spaceId === spaceId)
  return {
    content: docs.map((d) => `《${d.title}》\n${d.content}`).join('\n\n---\n\n').slice(0, 5000),
    titles: docs.map((d) => d.title),
  }
}

/** 创建文档分析并运行（真实 LLM）；文档上下文以 system 消息持久化，供后续追问复用 */
aipRoutes.post('/threads', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const body = await c.req.json<{ title: string; taskPrompt: string; documentIds?: string[] }>()
  if (!body.title?.trim() || !body.taskPrompt?.trim()) return c.json({ error: '请填写任务标题与描述' }, 400)

  const now = Date.now()
  const id = `TH-${now.toString(36).toUpperCase()}`
  db.insert(tables.aiConversations).values({ id, title: body.title.trim(), scene: 'thread', userId: user.id, spaceId: space.id, createdAt: now }).run()

  const doc = buildDocContext(space.id, body.documentIds ?? [])
  const contextNote = doc.titles.length
    ? `本分析引用的文档：${doc.titles.join('、')}\n\n文档内容：\n${doc.content}`
    : '（本次分析未引用文档）'
  // system 消息承载文档上下文，追问时按角色拼装进 prompt，保证多轮带得走
  db.insert(tables.aiMessages).values({ id: `AM-${now.toString(36)}c`, conversationId: id, role: 'system', content: contextNote, createdAt: now - 2 }).run()
  db.insert(tables.aiMessages).values({ id: `AM-${now.toString(36)}u`, conversationId: id, role: 'user', content: body.taskPrompt, createdAt: now - 1 }).run()

  try {
    const reply = await llmComplete(
      '你是企业文档分析助手。根据给定任务和文档内容，输出结构化的分析结果。使用简洁的中文，用标题和列表组织内容。',
      `任务：${body.taskPrompt}\n\n参考文档：\n${contextNote}`,
    )
    db.insert(tables.aiMessages).values({ id: `AM-${now.toString(36)}a`, conversationId: id, role: 'assistant', content: reply, createdAt: now }).run()
    audit(user, '运行文档分析', body.title)
    return c.json({ id, result: reply, documentTitles: doc.titles })
  } catch (e) {
    // LLM 失败保留会话草稿（system 上下文 + 用户任务仍在），用户可稍后一键重试，不丢输入
    return c.json({
      id,
      error: `AI 分析失败：${e instanceof Error ? e.message : '未知'}。任务已保留为草稿，可稍后重试`,
      retryable: true,
    }, 502)
  }
})

/** 重试失败的分析：复用已持久化的文档上下文与用户任务，不要求用户重新填写 */
aipRoutes.post('/threads/:id/retry', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const id = c.req.param('id') as string
  const conv = db.select().from(tables.aiConversations).all().find((x) => x.id === id && x.spaceId === space.id && x.scene === 'thread')
  if (!conv) return c.json({ error: '分析不存在' }, 404)
  const msgs = db.select().from(tables.aiMessages).all().filter((m) => m.conversationId === id).sort((a, b) => a.createdAt - b.createdAt)
  const context = msgs.find((m) => m.role === 'system')?.content ?? '（无文档上下文）'
  const task = msgs.find((m) => m.role === 'user')?.content ?? ''
  if (!task) return c.json({ error: '草稿缺少任务描述，无法重试' }, 400)
  const now = Date.now()
  try {
    const reply = await llmComplete(
      '你是企业文档分析助手。根据给定任务和文档内容，输出结构化的分析结果。使用简洁的中文，用标题和列表组织内容。',
      `任务：${task}\n\n参考文档：\n${context}`,
    )
    db.insert(tables.aiMessages).values({ id: `AM-${now.toString(36)}a`, conversationId: id, role: 'assistant', content: reply, createdAt: now }).run()
    audit(user, '重试文档分析', conv.title)
    return c.json({ result: reply, documentTitles: context.startsWith('本分析引用的文档：') ? context.split('\n')[0].slice('本分析引用的文档：'.length).split('、') : [] })
  } catch (e) {
    return c.json({ error: `重试仍失败：${e instanceof Error ? e.message : '未知'}，草稿继续保留` }, 502)
  }
})

/** 多轮追问：带着文档上下文 + 历史问答继续对话（结果同样持久化） */
aipRoutes.post('/threads/:id/followup', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const id = c.req.param('id') as string
  const body = await c.req.json<{ question: string }>()
  if (!body.question?.trim()) return c.json({ error: '请输入追问内容' }, 400)
  const conv = db.select().from(tables.aiConversations).all().find((x) => x.id === id && x.spaceId === space.id && x.scene === 'thread')
  if (!conv) return c.json({ error: '分析不存在' }, 404)

  const msgs = db.select().from(tables.aiMessages).all()
    .filter((m) => m.conversationId === id)
    .sort((a, b) => a.createdAt - b.createdAt)
  const context = msgs.find((m) => m.role === 'system')?.content ?? '（无文档上下文）'
  const history = msgs.filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => `${m.role === 'user' ? '用户' : 'AI'}：${m.content}`).join('\n\n')
  const now = Date.now()
  try {
    const reply = await llmComplete(
      '你是企业文档分析助手。基于给定文档上下文与历史对话回答用户的追问；引用文档内容时注明出处，不确定就明确说明，不要编造。使用简洁中文。',
      `文档上下文：\n${context}\n\n历史对话：\n${history}\n\n用户追问：${body.question.trim()}`,
    )
    db.insert(tables.aiMessages).values({ id: `AM-${now.toString(36)}u`, conversationId: id, role: 'user', content: body.question.trim(), createdAt: now }).run()
    db.insert(tables.aiMessages).values({ id: `AM-${now.toString(36)}a`, conversationId: id, role: 'assistant', content: reply, createdAt: now + 1 }).run()
    audit(user, '文档分析追问', conv.title)
    return c.json({ result: reply })
  } catch (e) {
    return c.json({ error: `追问失败：${e instanceof Error ? e.message : '未知'}，可稍后重试` }, 502)
  }
})

/** 查看线程结果 */
aipRoutes.get('/threads/:id', (c) => {
  const space = c.get('space')
  const id = c.req.param('id') as string
  const conv = db.select().from(tables.aiConversations).all().find((x) => x.id === id && x.spaceId === space.id)
  if (!conv) return c.json({ error: '任务不存在' }, 404)
  const msgs = db.select().from(tables.aiMessages).all().filter((m) => m.conversationId === id).sort((a, b) => a.createdAt - b.createdAt)
  const docsLine = msgs.find((m) => m.role === 'system')?.content.split('\n')[0] ?? ''
  return c.json({
    thread: { id, title: conv.title, createdAt: new Date(conv.createdAt).toLocaleString('zh-CN', { hour12: false }) },
    documentTitles: docsLine.startsWith('本分析引用的文档：') ? docsLine.slice('本分析引用的文档：'.length).split('、') : [],
    // 草稿态：AI 网关失败后仅保留用户任务，前端据此显示「重试」按钮
    pendingRetry: !msgs.some((m) => m.role === 'assistant'),
    // system 消息是内部文档上下文，不返回给前端展示
    messages: msgs.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content })),
  })
})

/** 删除线程 */
aipRoutes.delete('/threads/:id', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const id = c.req.param('id') as string
  const conv = db.select().from(tables.aiConversations).all().find((x) => x.id === id && x.spaceId === space.id)
  if (!conv) return c.json({ error: '任务不存在' }, 404)
  for (const m of db.select().from(tables.aiMessages).all().filter((x) => x.conversationId === id)) {
    db.delete(tables.aiMessages).where(eq(tables.aiMessages.id, m.id)).run()
  }
  db.delete(tables.aiConversations).where(eq(tables.aiConversations.id, id)).run()
  audit(user, '删除文档任务', conv.title)
  return c.json({ ok: true })
})
