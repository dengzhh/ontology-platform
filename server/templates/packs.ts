/** 本体模板包：可一键安装到任意空间（组织/个人/家庭）的领域本体 */

export interface PackProp { key: string; name: string; type: string; required?: boolean; enumValues?: string[] }
export interface PackType { id: string; name: string; desc: string; color: string; icon: string; properties: PackProp[]; viewTemplate: { titleKey: string; subKey?: string; badgeKey?: string } }
export interface PackLink { id: string; name: string; source: string; target: string; cardinality: string; desc: string }
export interface PackAction { id: string; name: string; target: string; params: PackProp[]; needsApproval: boolean; desc: string; effect: { kind: 'create' | 'update'; setValues?: Record<string, string> } }
export interface OntologyPack {
  id: string
  name: string
  desc: string
  suitKinds: string[]
  types: PackType[]
  links: PackLink[]
  actions: PackAction[]
}

/* ---------------- 个人生活管理模板包 ---------------- */

export const PERSONAL_LIFE_PACK: OntologyPack = {
  id: 'personal-life',
  name: '个人生活管理',
  desc: '想法火花、收支记账、人情往来、日程计划、学习资料与笔记的个人本体',
  suitKinds: ['personal', 'family'],
  types: [
    { id: 'contact', name: '人物', desc: '家人、朋友、同事等联系人', color: '#06b6d4', icon: 'UserRound', viewTemplate: { titleKey: 'name', subKey: 'relation', badgeKey: '' }, properties: [
      { key: 'name', name: '姓名', type: 'string', required: true },
      { key: 'relation', name: '关系', type: 'enum', enumValues: ['家人', '亲戚', '朋友', '同事', '同学', '邻居', '其他'] },
      { key: 'phone', name: '电话', type: 'string' },
      { key: 'birthday', name: '生日', type: 'date' },
      { key: 'notes', name: '备注', type: 'string' },
    ] },
    { id: 'idea', name: '想法', desc: '思想火花与灵感记录', color: '#f59e0b', icon: 'Lightbulb', viewTemplate: { titleKey: 'title', subKey: 'sparkAt', badgeKey: 'status' }, properties: [
      { key: 'title', name: '标题', type: 'string', required: true },
      { key: 'content', name: '内容', type: 'string' },
      { key: 'source', name: '灵感来源', type: 'string' },
      { key: 'sparkAt', name: '火花时间', type: 'date' },
      { key: 'status', name: '状态', type: 'enum', enumValues: ['萌芽', '孵化中', '已落地', '已放弃'] },
    ] },
    { id: 'topic', name: '主题', desc: '想法、笔记与资料的分类主题', color: '#8b5cf6', icon: 'Tags', viewTemplate: { titleKey: 'name', subKey: '', badgeKey: '' }, properties: [
      { key: 'name', name: '主题名', type: 'string', required: true },
      { key: 'desc', name: '说明', type: 'string' },
    ] },
    { id: 'account', name: '账户', desc: '现金/储蓄/理财等资金账户', color: '#10b981', icon: 'Wallet', viewTemplate: { titleKey: 'name', subKey: 'kind', badgeKey: '' }, properties: [
      { key: 'name', name: '账户名', type: 'string', required: true },
      { key: 'kind', name: '类型', type: 'enum', enumValues: ['现金', '储蓄', '理财', '信用', '其他'] },
      { key: 'balance', name: '余额', type: 'number' },
    ] },
    { id: 'expense', name: '支出', desc: '日常消费记录', color: '#ef4444', icon: 'Receipt', viewTemplate: { titleKey: 'title', subKey: 'date', badgeKey: 'category' }, properties: [
      { key: 'title', name: '事由', type: 'string', required: true },
      { key: 'amount', name: '金额', type: 'number', required: true },
      { key: 'date', name: '日期', type: 'date', required: true },
      { key: 'category', name: '类别', type: 'enum', enumValues: ['餐饮', '交通', '购物', '居住', '医疗', '教育', '人情', '娱乐', '其他'] },
      { key: 'merchant', name: '商户', type: 'string' },
      { key: 'payment', name: '支付方式', type: 'enum', enumValues: ['现金', '微信', '支付宝', '银行卡', '其他'] },
      { key: 'source', name: '录入来源', type: 'enum', enumValues: ['scan', 'manual', 'import'] },
      { key: 'recurring', name: '支出性质', type: 'enum', enumValues: ['一次性', '周期性'] },
    ] },
    { id: 'expense_item', name: '消费明细', desc: '一笔支出里的商品/服务明细行（扫描小票时自动拆分）', color: '#fb923c', icon: 'List', viewTemplate: { titleKey: 'name', subKey: 'amount', badgeKey: '' }, properties: [
      { key: 'name', name: '商品/服务名', type: 'string', required: true },
      { key: 'qty', name: '数量', type: 'number' },
      { key: 'unitPrice', name: '单价', type: 'number' },
      { key: 'amount', name: '小计', type: 'number', required: true },
      { key: 'category', name: '明细类别', type: 'enum', enumValues: ['餐饮', '交通', '购物', '居住', '医疗', '教育', '人情', '娱乐', '其他'] },
    ] },
    { id: 'income', name: '收入', desc: '工资、奖金、理财收益等', color: '#22c55e', icon: 'TrendingUp', viewTemplate: { titleKey: 'title', subKey: 'date', badgeKey: 'source' }, properties: [
      { key: 'title', name: '事由', type: 'string', required: true },
      { key: 'amount', name: '金额', type: 'number', required: true },
      { key: 'date', name: '日期', type: 'date', required: true },
      { key: 'source', name: '来源', type: 'enum', enumValues: ['工资', '奖金', '理财', '副业', '人情', '其他'] },
    ] },
    { id: 'favor', name: '人情往来', desc: '红白事、礼物、拜访等礼尚往来', color: '#ec4899', icon: 'Gift', viewTemplate: { titleKey: 'title', subKey: 'date', badgeKey: 'direction' }, properties: [
      { key: 'title', name: '事由', type: 'string', required: true },
      { key: 'occasion', name: '场合', type: 'enum', enumValues: ['婚礼', '丧事', '生日', '节日', '探病', '乔迁', '帮忙', '其他'] },
      { key: 'amount', name: '金额/价值', type: 'number' },
      { key: 'direction', name: '方向', type: 'enum', enumValues: ['支出', '收入'] },
      { key: 'date', name: '日期', type: 'date', required: true },
      { key: 'note', name: '备注', type: 'string' },
    ] },
    { id: 'schedule', name: '日程', desc: '具体时间点的安排', color: '#3b82f6', icon: 'CalendarClock', viewTemplate: { titleKey: 'title', subKey: 'start', badgeKey: 'status' }, properties: [
      { key: 'title', name: '事项', type: 'string', required: true },
      { key: 'start', name: '开始', type: 'date', required: true },
      { key: 'end', name: '结束', type: 'date' },
      { key: 'location', name: '地点', type: 'string' },
      { key: 'status', name: '状态', type: 'enum', enumValues: ['计划', '进行中', '已完成', '已取消'] },
    ] },
    { id: 'plan', name: '计划', desc: '阶段性目标与推进', color: '#6366f1', icon: 'Target', viewTemplate: { titleKey: 'title', subKey: 'deadline', badgeKey: 'progress' }, properties: [
      { key: 'title', name: '计划名', type: 'string', required: true },
      { key: 'goal', name: '目标', type: 'string' },
      { key: 'deadline', name: '截止', type: 'date' },
      { key: 'progress', name: '进度', type: 'enum', enumValues: ['未开始', '进行中', '已完成', '搁置'] },
    ] },
    { id: 'material', name: '学习资料', desc: '书/课程/文章/视频', color: '#0ea5e9', icon: 'BookOpen', viewTemplate: { titleKey: 'title', subKey: 'author', badgeKey: 'status' }, properties: [
      { key: 'title', name: '标题', type: 'string', required: true },
      { key: 'kind', name: '形式', type: 'enum', enumValues: ['书', '课程', '文章', '视频', '其他'] },
      { key: 'author', name: '作者/来源', type: 'string' },
      { key: 'status', name: '状态', type: 'enum', enumValues: ['想读', '在读', '已读', '收藏'] },
    ] },
    { id: 'note', name: '笔记', desc: '学习与阅读笔记', color: '#84cc16', icon: 'NotebookPen', viewTemplate: { titleKey: 'title', subKey: '', badgeKey: '' }, properties: [
      { key: 'title', name: '标题', type: 'string', required: true },
      { key: 'content', name: '内容', type: 'string' },
      { key: 'createdAt', name: '记录时间', type: 'date' },
    ] },
  ],
  links: [
    { id: 'idea-assoc', name: '想法联想', source: 'idea', target: 'idea', cardinality: 'N:N', desc: '想法之间的联想关系' },
    { id: 'idea-topic', name: '想法归属主题', source: 'idea', target: 'topic', cardinality: 'N:1', desc: '' },
    { id: 'note-topic', name: '笔记归属主题', source: 'note', target: 'topic', cardinality: 'N:1', desc: '' },
    { id: 'note-from-material', name: '笔记源自资料', source: 'note', target: 'material', cardinality: 'N:1', desc: '' },
    { id: 'expense-account', name: '支出账户', source: 'expense', target: 'account', cardinality: 'N:1', desc: '这笔支出从哪个账户支付' },
    { id: 'expense-has-item', name: '支出包含明细', source: 'expense', target: 'expense_item', cardinality: '1:N', desc: '一笔支出拆分出的商品/服务明细行' },
    { id: 'favor-person', name: '往来对象', source: 'favor', target: 'contact', cardinality: 'N:1', desc: '人情往来涉及的人物' },
    { id: 'schedule-person', name: '参与人物', source: 'schedule', target: 'contact', cardinality: 'N:N', desc: '' },
    { id: 'schedule-plan', name: '日程隶属计划', source: 'schedule', target: 'plan', cardinality: 'N:1', desc: '' },
    { id: 'plan-topic', name: '计划关联主题', source: 'plan', target: 'topic', cardinality: 'N:1', desc: '' },
    { id: 'material-topic', name: '资料归属主题', source: 'material', target: 'topic', cardinality: 'N:1', desc: '' },
  ],
  actions: [
    { id: 'add-expense', name: '记一笔支出', target: 'expense', needsApproval: false, desc: '快速记录一笔日常支出', params: [
      { key: 'title', name: '事由', type: 'string', required: true },
      { key: 'amount', name: '金额', type: 'number', required: true },
      { key: 'category', name: '类别', type: 'string' },
      { key: 'date', name: '日期', type: 'string' },
    ], effect: { kind: 'create' } },
    { id: 'add-favor', name: '记录人情往来', target: 'favor', needsApproval: false, desc: '记录一次礼尚往来', params: [
      { key: 'title', name: '事由', type: 'string', required: true },
      { key: 'amount', name: '金额', type: 'number' },
      { key: 'direction', name: '方向', type: 'string' },
    ], effect: { kind: 'create' } },
    { id: 'finish-schedule', name: '完成日程', target: 'schedule', needsApproval: false, desc: '把日程标记为已完成', params: [
      { key: 'objectId', name: '日程对象', type: 'string', required: true },
    ], effect: { kind: 'update', setValues: { status: '已完成' } } },
  ],
}

/* ---------------- 制造业演示包（默认组织空间即此内容） ---------------- */

export const MANUFACTURING_DEMO_PACK: OntologyPack = {
  id: 'manufacturing-demo',
  name: '制造业运营演示',
  desc: '设备/工单/客户/订单等制造企业本体（默认组织空间内容）',
  suitKinds: ['org'],
  types: [],
  links: [],
  actions: [],
}

export const PACKS: OntologyPack[] = [PERSONAL_LIFE_PACK, MANUFACTURING_DEMO_PACK]
