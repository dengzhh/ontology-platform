/**
 * 扫描识别模板引擎
 * 三层体系：
 *  1) 内置模板（按票据场景预置：小票/发票/订单/快递/通用），根据对象类型 + 用户描述自动匹配 → 普通用户零配置
 *  2) 类型级绑定：每个对象类型可绑定默认模板（自动带出）
 *  3) 自定义模板：高级用户可写额外提示词与字段映射
 */

import { db, tables } from '../db'

export interface TemplateRow {
  id: string
  name: string
  desc: string
  typeId: string
  kind: string
  scene: string
  extraPrompt: string
  fieldMapping: Record<string, string>
  matchKeywords: string[]
  ownerId: string
  spaceId: string
  createdAt: number
}

interface PropertyDef { key: string; name: string; type: string; enumValues?: string[] }

/** 内置模板定义（代码级，随平台发布） */
export const BUILTIN_TEMPLATES: Omit<TemplateRow, 'createdAt'>[] = [
  {
    id: 'builtin-receipt', name: '消费小票', desc: '便利店/餐饮/超市收银小票：识别商户、日期、合计金额、支付方式、消费类别',
    typeId: '', kind: 'builtin', scene: 'receipt',
    extraPrompt: [
      '这是消费小票。',
      '金额取票面「合计/实付/总计」，不要取单件商品价格，也不要把多件商品相加（除非无合计行）。',
      '商户取票头店名（含分店名）。日期取消费日期。',
      '支付取「支付方式/付款方式」；消费类别按商品推断（餐饮/购物/交通/娱乐/其他）。',
    ].join('\n'),
    fieldMapping: { title: 'title', amount: 'amount', date: 'date', category: 'category', merchant: 'merchant', payment: 'payment' },
    matchKeywords: ['小票', '收银', '便利店', '超市', '餐饮', '消费', 'receipt', '购物小票'],
    ownerId: '', spaceId: '',
  },
  {
    id: 'builtin-invoice', name: '增值税发票', desc: '识别发票号码、开票日期、价税合计、销售方、购买方、税率',
    typeId: '', kind: 'builtin', scene: 'invoice',
    extraPrompt: [
      '这是增值税发票。识别：发票号码、开票日期、价税合计（金额）、销售方名称、购买方名称、税率。',
      '金额一律取「价税合计」，不是不含税金额。日期为开票日期。',
      '不要混淆销售方与购买方：销售方是开票方（收款方），购买方是抬头方。',
    ].join('\n'),
    fieldMapping: { no: 'no', title: 'title', amount: 'amount', date: 'date', seller: 'merchant', buyer: 'customer' },
    matchKeywords: ['发票', '增值税', '税票', 'invoice', '开票'],
    ownerId: '', spaceId: '',
  },
  {
    id: 'builtin-order', name: '订单详情截图', desc: '电商/外卖订单截图：订单号、下单时间、实付金额、店铺、商品明细',
    typeId: '', kind: 'builtin', scene: 'order',
    extraPrompt: [
      '这是订单详情截图。识别：订单号、下单/支付时间、实付金额、店铺/卖家名称、商品名称。',
      '金额取「实付款/合计」，忽略优惠前原价、运费单列。',
      '标题可用「店铺名 + 主要商品」概括。',
    ].join('\n'),
    fieldMapping: { no: 'no', title: 'title', amount: 'amount', date: 'date', shop: 'merchant', items: 'notes' },
    matchKeywords: ['订单', '下单', '外卖', '电商', '订单详情', 'order', '实付'],
    ownerId: '', spaceId: '',
  },
  {
    id: 'builtin-express', name: '快递单据', desc: '快递面单/物流单：运单号、寄件/收件信息、日期、费用',
    typeId: '', kind: 'builtin', scene: 'express',
    extraPrompt: '这是快递/物流单据。识别运单号、寄件人、收件人、寄件日期、运费。金额取运费或到付金额。',
    fieldMapping: { no: 'no', title: 'title', amount: 'amount', date: 'date', sender: 'merchant', receiver: 'notes' },
    matchKeywords: ['快递', '物流', '运单', '面单', 'express'],
    ownerId: '', spaceId: '',
  },
  {
    id: 'builtin-general', name: '通用票据', desc: '未指定场景时的兜底模板：提取标题、金额、日期、类别、商户、备注',
    typeId: '', kind: 'builtin', scene: 'general',
    extraPrompt: '识别票据/单据中的关键信息：标题/事由、金额、日期、类别、商户/对方、支付方式、备注。金额只输出数字。',
    fieldMapping: {},
    matchKeywords: [],
    ownerId: '', spaceId: '',
  },
]

/** 列出空间可用的模板：内置 + 该空间自定义 */
export function listTemplates(spaceId: string, typeId?: string): TemplateRow[] {
  const custom = (db.select().from(tables.scanTemplates).all() as unknown as TemplateRow[])
    .filter((t) => t.kind === 'custom' && (t.spaceId === spaceId || t.spaceId === ''))
  const all = [...BUILTIN_TEMPLATES.map((t) => ({ ...t, createdAt: 0 })), ...custom]
  if (typeId) {
    // 优先显示绑定该类型的模板，其次通用
    return all.sort((a, b) => (a.typeId === typeId ? -1 : 0) - (b.typeId === typeId ? -1 : 0))
  }
  return all
}

/**
 * 自动匹配模板：根据「对象类型 + 用户给的 hint/类型名」推断
 * 返回匹配到的模板与置信依据
 */
export function autoMatchTemplate(typeId: string, typeName: string, hint: string, spaceId: string): { template: TemplateRow | null; reason: string } {
  const templates = listTemplates(spaceId, typeId)
  const haystack = `${typeName} ${hint}`.toLowerCase()

  // 1) 该类型绑定的默认模板（自定义模板优先）
  const bound = templates.find((t) => t.typeId === typeId && t.kind === 'custom')
  if (bound) return { template: bound, reason: `已绑定「${typeName}」的默认模板` }

  // 2) 关键词匹配内置模板
  let best: { t: TemplateRow; hits: number } | null = null
  for (const t of templates.filter((x) => x.kind === 'builtin' && x.id !== 'builtin-general')) {
    const hits = t.matchKeywords.filter((k) => haystack.includes(k.toLowerCase())).length
    if (hits > 0 && (!best || hits > best.hits)) best = { t, hits }
  }
  if (best) return { template: best.t, reason: `根据「${best.t.matchKeywords.slice(0, 2).join('/')}」自动匹配` }

  // 3) 按对象类型名推断场景
  const sceneByType: Record<string, string> = { 支出: 'receipt', 收入: 'invoice', 销售订单: 'order', 订单: 'order', 人情往来: 'general' }
  const scene = sceneByType[typeName] ?? ''
  if (scene) {
    const t = templates.find((x) => x.kind === 'builtin' && x.scene === scene)
    if (t) return { template: t, reason: `根据对象类型「${typeName}」推断为${t.name}场景` }
  }

  // 4) 兜底通用
  const general = templates.find((t) => t.id === 'builtin-general')!
  return { template: general, reason: '未匹配到专用场景，使用通用票据模板' }
}

/** 按模板 + 目标类型属性生成系统提示词 */
export function buildPrompt(typeId: string, spaceId: string, template?: TemplateRow | null, hint?: string): string {
  const t = db.select().from(tables.objectTypes).all().find((x) => x.id === typeId)
  const props = (t?.properties ?? []) as PropertyDef[]

  let fields = props.map((p) => {
    const desc = p.type === 'enum' && p.enumValues?.length
      ? `枚举只能是: ${p.enumValues.join('/')}`
      : p.type === 'number' ? '数字（只输出数值，无货币符号/千分位）' : p.type === 'date' ? '日期 YYYY-MM-DD' : '文本'
    return `  "${p.key}": ${p.name}（${desc}，识别不到填空字符串""）`
  }).join(',\n')

  // 若该类型有「包含明细」链接（如 expense → expense_item），要求模型额外输出 items 数组
  const itemLink = db.select().from(tables.linkTypes).all()
    .find((l) => l.spaceId === spaceId && l.sourceTypeId === typeId && /item|detail|明细/i.test(l.id + l.name))
  const itemType = itemLink ? db.select().from(tables.objectTypes).all()
    .find((x) => x.id === itemLink.targetTypeId && x.spaceId === spaceId) : null
  if (itemType) {
    const itemProps = (itemType.properties ?? []) as PropertyDef[]
    // 显式两行示例：glm-4v-flash 对内联 `[ { … } ]` 的 schema 会整个忽略 items 键，示例化后才能稳定输出
    const demoRow = (i: number) => '    ' + JSON.stringify(Object.fromEntries(itemProps.map((p) => [p.key, p.type === 'number' ? i : ''])))
    fields += `,\n  "items": [\n${demoRow(1)},\n${demoRow(2)}\n  ]`
  }

  const lines = [
    '你是票据/单据 OCR 结构化提取专家。识别图片内容，提取字段并输出严格的 JSON 对象（不要代码块、不要其他文字）。',
    t ? `目标对象类型：${t.name}。` : '',
    `输出格式：\n{\n${fields || '  "title": "", "amount": 0, "date": "", "notes": ""'}\n}`,
    '通用规则：',
    '1. 只输出 JSON，不要解释。',
    '2. 金额类只输出数字；日期统一 YYYY-MM-DD；识别不到的字段填空字符串。',
    '3. 输出字段名必须与上面给出的 key 完全一致。',
  ]
  if (itemType) {
    lines.push('', `【明细行·必填】票面出现逐条商品/服务明细时，必须把每一行逐行抄录进 "items" 数组（字段：${((itemType.properties ?? []) as PropertyDef[]).map((p) => p.key).join(', ')}；金额为该行小计）。即使字很小也要逐行提取，禁止遗漏、禁止只给合计；票面确实没有任何明细行时才输出 []。`)
    lines.push('重要：每件商品必须是 items 里独立的一个对象（一商品一行）；严禁把多个商品的同一字段合并成数组（如 "name":["A","B"]）或拼接成一个字符串。')
  }
  if (template?.extraPrompt) {
    lines.push('', `【${template.name} · 场景识别要点】`, template.extraPrompt)
  }
  if (hint) lines.push('', `【本次补充要求】`, hint)
  return lines.filter(Boolean).join('\n')
}

/** 应用字段映射：把模型输出的键映射到本体属性 key */
export function applyMapping(values: Record<string, unknown>, mapping: Record<string, string>, props: PropertyDef[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const validKeys = new Set(props.map((p) => p.key))
  for (const [k, v] of Object.entries(values)) {
    // items 是明细行数组（配套明细类型落地用），不参与字段映射，直接放行
    if (k === 'items') { out.items = v; continue }
    const mapped = mapping[k] ?? k
    if (validKeys.size === 0 || validKeys.has(mapped)) out[mapped] = v
  }
  return out
}
