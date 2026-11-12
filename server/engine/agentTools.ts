import { db, tables } from '../db'
import { resolveTerms, certifiedTermDigest } from './semantic'

/**
 * Agent 工具执行引擎（服务端）
 * 把 Agent 配置里勾选的工具真正执行：查对象 / 概览 / 检索知识 / 执行动作 / 发通知 / 用户管理
 * 护栏：敏感字段脱敏、动作执行需人工确认（返回待确认提示而非直接写库）
 */

export interface AgentToolResult {
  name: string
  result: string
}

interface Guardrail { maskSensitive?: boolean; requireApprovalForActions?: boolean }

const SENSITIVE_KEYS = ['phone', 'mobile', 'idcard', '身份证', '手机', '联系人', 'address', 'email', '邮箱', 'account']

function mask(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    const s = String(v ?? '')
    out[k] = SENSITIVE_KEYS.some((key) => k.toLowerCase().includes(key.toLowerCase())) && s.length > 3
      ? `${s.slice(0, 2)}***${s.slice(-2)}`
      : v
  }
  return out
}

/** 根据消息内容推断需要调用哪些工具，并执行 */
export async function runAgentTools(
  message: string,
  tools: string[],
  guardrail: Guardrail,
  spaceId: string,
  ownerId: string,
): Promise<AgentToolResult[]> {
  const out: AgentToolResult[] = []
  const t = message.toLowerCase()

  const wants = (keywords: string[]) => keywords.some((k) => t.includes(k))

  // 语义层：把口语问法归一到已认证术语/指标口径，注入工具结果供 LLM 引用
  const hits = resolveTerms(message, spaceId)
  if (hits.length) {
    out.push({
      name: 'certified_terms',
      result: `问题命中已认证业务术语：${hits.map((h) => h.term).join('、')}。必须按以下口径回答，不要自行定义：\n${certifiedTermDigest(spaceId)}`,
    })
  }

  // 1. 本体概览
  if (tools.includes('ontology_overview') && wants(['本体', '有哪些类型', '对象类型', '概览'])) {
    const types = db.select().from(tables.objectTypes).all().filter((x) => x.spaceId === spaceId)
    const objs = db.select().from(tables.objects).all().filter((x) => x.spaceId === spaceId)
    out.push({
      name: 'ontology_overview',
      result: `当前空间有 ${types.length} 个对象类型、${objs.length} 个实例：` + types.map((x) => `${x.name}(${objs.filter((o) => o.typeId === x.id).length})`).join('、'),
    })
  }

  // 2. 查询对象
  if (tools.includes('query_objects') && wants(['查询', '查一下', '有哪些', '列出', '多少', '状态', '设备', '工单', '客户', '订单'])) {
    const types = db.select().from(tables.objectTypes).all().filter((x) => x.spaceId === spaceId)
    const hit = types.find((x) => t.includes(x.name.toLowerCase()))
    const typeId = hit?.id ?? 'device'
    const rows = db.select().from(tables.objects).all().filter((x) => x.spaceId === spaceId && x.typeId === typeId).slice(0, 8)
    const display = rows.map((o) => {
      const v = (o.values ?? {}) as Record<string, unknown>
      return mask(guardrail.maskSensitive ? v : v)
    })
    out.push({
      name: 'query_objects',
      result: `「${hit?.name ?? typeId}」共 ${db.select().from(tables.objects).all().filter((x) => x.spaceId === spaceId && x.typeId === typeId).length} 个对象，前 ${display.length} 个：` +
        JSON.stringify(display).slice(0, 600),
    })
  }

  // 3. 检索知识库（先限定空间再匹配：原写法 && || 优先级问题会导致跨空间命中）
  if (tools.includes('search_knowledge') && wants(['知识', '文档', '手册', 'sop', '怎么', '如何', '规定', '流程'])) {
    const kwContent = message.slice(0, 6)
    const kwTitle = message.slice(0, 4)
    const docs = db.select().from(tables.documents).all()
      .filter((d) => d.spaceId === spaceId && (d.content.includes(kwContent) || d.title.includes(kwTitle))).slice(0, 3)
    const chunks = db.select().from(tables.docChunks).all().filter((ch) => ch.spaceId === spaceId).slice(0, 3)
    out.push({
      name: 'search_knowledge',
      result: docs.length
        ? `找到 ${docs.length} 篇相关文档：` + docs.map((d) => `《${d.title}》${d.content.slice(0, 120)}`).join('；')
        : chunks.length
          ? `知识库共 ${chunks.length} 个分块，关键词未直接命中；可用 /knowledge/search 精确检索。`
          : '当前空间暂无已索引文档。',
    })
  }

  // 4. 执行动作（护栏：需人工确认则不直接写库）
  if (tools.includes('execute_action') && wants(['创建', '新增', '记一笔', '执行', '关闭', '完成'])) {
    const actions = db.select().from(tables.actionTypes).all().filter((a) => a.spaceId === spaceId)
    const hit = actions.find((a) => t.includes(a.name.toLowerCase()))
    if (guardrail.requireApprovalForActions) {
      out.push({
        name: 'execute_action',
        result: `检测到动作意图「${hit?.name ?? '未知动作'}」。护栏要求人工确认，未自动执行；请在对象浏览器/审批中心确认后操作。`,
      })
    } else if (hit) {
      out.push({
        name: 'execute_action',
        result: `已识别可用动作「${hit.name}」（目标：${hit.targetTypeId}）。参数需用户补充，未自动写入。`,
      })
    }
  }

  // 5. 发送通知
  if (tools.includes('send_notification') && wants(['通知', '提醒', '告知'])) {
    const id = `NT-${Date.now().toString(36)}`
    db.insert(tables.notifications).values({
      id, title: `Agent 提醒：${message.slice(0, 30)}`, body: `由 Agent（${ownerId}）触发`, level: 'info', tag: 'Agent', read: 0, createdAt: Date.now(),
    }).run()
    out.push({ name: 'send_notification', result: `已生成站内通知（${id}）` })
  }

  // 6. 用户管理
  if (tools.includes('list_users') && wants(['用户', '成员', '人员', '谁'])) {
    const users = db.select().from(tables.users).all().filter((u) => u.status === '在职')
    out.push({ name: 'list_users', result: `在职用户 ${users.length} 人：` + users.map((u) => u.name).join('、') })
  }

  return out
}
