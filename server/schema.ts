import { sqliteTable, text, integer, real, primaryKey, uniqueIndex } from 'drizzle-orm/sqlite-core'

/* ============ 本体空间（组织/个人/家庭，多空间隔离） ============ */

export const spaces = sqliteTable('spaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** org=组织 personal=个人 family=家庭 */
  kind: text('kind').notNull().default('org'),
  ownerId: text('owner_id').notNull().references(() => users.id),
  templatePack: text('template_pack').notNull().default(''),
  createdAt: integer('created_at').notNull(),
})

export const spaceMembers = sqliteTable('space_members', {
  spaceId: text('space_id').notNull().references(() => spaces.id),
  userId: text('user_id').notNull().references(() => users.id),
  role: text('role').notNull().default('member'), // owner | member
}, (t) => ({ pk: primaryKey({ columns: [t.spaceId, t.userId] }) }))

/* ============ 身份与权限（P0/P1） ============ */

export const roles = sqliteTable('roles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  desc: text('desc').notNull().default(''),
  /** 可见应用路径数组，["*"] 表示全部 */
  apps: text('apps', { mode: 'json' }).notNull().$type<string[]>().default([]),
  /** 对象类型权限 { [typeId]: 'full' | 'read' | 'none' } */
  objectPerms: text('object_perms', { mode: 'json' }).notNull().$type<Record<string, string>>().default({}),
  createdAt: integer('created_at').notNull(),
})

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  account: text('account').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  dept: text('dept').notNull().default(''),
  roleId: text('role_id').notNull().references(() => roles.id),
  markings: text('markings', { mode: 'json' }).notNull().$type<string[]>().default([]),
  status: text('status').notNull().default('在职'),
  lastLoginAt: text('last_login_at').notNull().default(''),
  createdAt: integer('created_at').notNull(),
})

export const userGroups = sqliteTable('user_groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  desc: text('desc').notNull().default(''),
  defaultApp: text('default_app').notNull().default(''),
  createdAt: integer('created_at').notNull(),
})

export const groupMembers = sqliteTable('group_members', {
  groupId: text('group_id').notNull().references(() => userGroups.id),
  userId: text('user_id').notNull().references(() => users.id),
}, (t) => ({ pk: primaryKey({ columns: [t.groupId, t.userId] }) }))

/** 用户邀请（邮件/链接渠道，激活流程） */
export const invitations = sqliteTable('invitations', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  account: text('account').notNull(),
  name: text('name').notNull().default(''),
  /** 收件人真实邮箱（邮件渠道必填） */
  email: text('email').notNull().default(''),
  channel: text('channel').notNull().default('email'), // email | link
  subject: text('subject').notNull().default(''),
  body: text('body').notNull().default(''),
  link: text('link').notNull().default(''),
  status: text('status').notNull().default('待发送'), // 待发送 | 已激活 | 已过期
  createdAt: integer('created_at').notNull(),
  activatedAt: integer('activated_at'),
  expiresAt: integer('expires_at').notNull(),
})

/* ============ 本体（P2/P3） ============ */

export const objectTypes = sqliteTable('object_types', {
  id: text('id').primaryKey(),
  apiName: text('api_name').notNull(),
  name: text('name').notNull(),
  desc: text('desc').notNull().default(''),
  color: text('color').notNull().default('#3b82f6'),
  icon: text('icon').notNull().default('Box'),
  primaryKey: text('primary_key').notNull().default('id'),
  /** [{ key, name, type: string|number|date|boolean|enum, required?, enumValues? }] */
  properties: text('properties', { mode: 'json' }).notNull().$type<
    { key: string; name: string; type: string; required?: boolean; enumValues?: string[] }[]
  >().default([]),
  /** 展示模板（对象视图）：{ titleKey?, subKey?, badgeKey? } */
  viewTemplate: text('view_template', { mode: 'json' }).$type<{ titleKey?: string; subKey?: string; badgeKey?: string }>(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),  spaceId: text('space_id').notNull().default(''),

})

export const linkTypes = sqliteTable('link_types', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  sourceTypeId: text('source_type_id').notNull().references(() => objectTypes.id),
  targetTypeId: text('target_type_id').notNull().references(() => objectTypes.id),
  cardinality: text('cardinality').notNull().default('1:N'),
  desc: text('desc').notNull().default(''),
  createdAt: integer('created_at').notNull(),  spaceId: text('space_id').notNull().default(''),

})

export const actionTypes = sqliteTable('action_types', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  targetTypeId: text('target_type_id').notNull().references(() => objectTypes.id),
  /** [{ key, name, type, required?, enumValues? }] */
  params: text('params', { mode: 'json' }).notNull().$type<
    { key: string; name: string; type: string; required?: boolean; enumValues?: string[] }[]
  >().default([]),
  /** 敧行为描述：create/update/delete/link 的参数化规则（P4 引擎解释执行） */
  effect: text('effect', { mode: 'json' }).notNull().$type<{
    kind: 'create' | 'update' | 'delete' | 'link'
    setValues?: Record<string, string>
    linkTypeId?: string
  }>().default({ kind: 'update', setValues: {} }),
  needsApproval: integer('needs_approval').notNull().default(0),
  desc: text('desc').notNull().default(''),
  createdAt: integer('created_at').notNull(),  spaceId: text('space_id').notNull().default(''),

})

export const ontologyFunctions = sqliteTable('ontology_functions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  desc: text('desc').notNull().default(''),
  lang: text('lang').notNull().default('TypeScript'),
  linkedTypeIds: text('linked_type_ids', { mode: 'json' }).notNull().$type<string[]>().default([]),
  /** P6 起 AI 工具可调用的注册函数（此处存逻辑描述/表达式） */
  body: text('body').notNull().default(''),
  createdAt: integer('created_at').notNull(),  spaceId: text('space_id').notNull().default(''),

})

/** 对象实例（通用存储：values JSON） */
export const objects = sqliteTable('objects', {
  id: text('id').primaryKey(),
  typeId: text('type_id').notNull().references(() => objectTypes.id),
  values: text('values', { mode: 'json' }).notNull().$type<Record<string, unknown>>().default({}),
  createdBy: text('created_by').notNull().default(''),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),  spaceId: text('space_id').notNull().default(''),

})

/** 链接实例 */
export const objectLinks = sqliteTable('object_links', {
  id: text('id').primaryKey(),
  linkTypeId: text('link_type_id').notNull().references(() => linkTypes.id),
  sourceId: text('source_id').notNull().references(() => objects.id),
  targetId: text('target_id').notNull().references(() => objects.id),
  createdBy: text('created_by').notNull().default(''),
  createdAt: integer('created_at').notNull(),  spaceId: text('space_id').notNull().default(''),

})

/* ============ 动作 / 审批 / 审计（P4） ============ */

export const actionLogs = sqliteTable('action_logs', {
  id: text('id').primaryKey(),
  actionTypeId: text('action_type_id').notNull(),
  objectId: text('object_id').notNull().default(''),
  params: text('params', { mode: 'json' }).notNull().$type<Record<string, unknown>>().default({}),
  status: text('status').notNull().default('done'), // done | pending_approval | rejected | failed
  result: text('result', { mode: 'json' }).$type<Record<string, unknown>>(),
  actor: text('actor').notNull().default(''),
  createdAt: integer('created_at').notNull(),
})

export const approvals = sqliteTable('approvals', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  kind: text('kind').notNull().default('动作执行'),
  /** 变更内容 { actionLogId?, diff?: [{field, old, new}] } */
  payload: text('payload', { mode: 'json' }).notNull().$type<Record<string, unknown>>().default({}),
  requester: text('requester').notNull(),
  risk: text('risk').notNull().default('中'),
  status: text('status').notNull().default('待审批'), // 待审批 | 已通过 | 已驳回
  decidedBy: text('decided_by').notNull().default(''),
  decidedAt: integer('decided_at'),
  createdAt: integer('created_at').notNull(),
})

export const auditEvents = sqliteTable('audit_events', {
  id: text('id').primaryKey(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  target: text('target').notNull().default(''),
  detail: text('detail', { mode: 'json' }).$type<Record<string, unknown>>(),
  result: text('result').notNull().default('成功'),
  ip: text('ip').notNull().default(''),
  createdAt: integer('created_at').notNull(),
})

/* ============ 通知 / 自动化（P7） ============ */

export const notifications = sqliteTable('notifications', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  level: text('level').notNull().default('info'), // info | warn | error | success
  tag: text('tag').notNull().default('系统'),
  read: integer('read').notNull().default(0),
  createdAt: integer('created_at').notNull(),
})

export const automationRules = sqliteTable('automation_rules', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  trigger: text('trigger', { mode: 'json' }).notNull().$type<{ kind: 'object_change' | 'threshold' | 'schedule'; typeId?: string; field?: string; op?: string; value?: number; cron?: string }>(),
  condition: text('condition').notNull().default(''),
  /** 执行动作列表 [{ kind: 'notify' | 'create_action' | 'hold_approval', config }] */
  actions: text('actions', { mode: 'json' }).notNull().$type<{ kind: string; config?: Record<string, unknown> }[]>().default([]),
  enabled: integer('enabled').notNull().default(1),
  hitCount: integer('hit_count').notNull().default(0),
  lastTriggeredAt: integer('last_triggered_at'),
  owner: text('owner').notNull().default(''),
  createdAt: integer('created_at').notNull(),  spaceId: text('space_id').notNull().default(''),

})

/* ============ 知识层（P5） ============ */

export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  category: text('category').notNull().default('SOP'),
  format: text('format').notNull().default('PDF'),
  size: text('size').notNull().default(''),
  status: text('status').notNull().default('解析中'), // 解析中 | 待审核 | 已索引 | 已过期
  owner: text('owner').notNull().default(''),
  content: text('content').notNull().default(''),
  chunkCount: integer('chunk_count').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),  spaceId: text('space_id').notNull().default(''),

})

export const docChunks = sqliteTable('doc_chunks', {
  id: text('id').primaryKey(),
  docId: text('doc_id').notNull().references(() => documents.id),
  idx: integer('idx').notNull(),
  text: text('text').notNull(),
  /** 本地降级用词袋向量或 API embedding（Float32 序列化 base64） */
  embedding: text('embedding').notNull().default(''),
  dim: integer('dim').notNull().default(0),
  createdAt: integer('created_at').notNull(),  spaceId: text('space_id').notNull().default(''),

})

/** 文档 ↔ 业务对象挂接 */
export const docLinks = sqliteTable('doc_links', {
  id: text('id').primaryKey(),
  docId: text('doc_id').notNull().references(() => documents.id),
  objectId: text('object_id').notNull().references(() => objects.id),
  createdBy: text('created_by').notNull().default(''),
  createdAt: integer('created_at').notNull(),  spaceId: text('space_id').notNull().default(''),

})

export const extractCandidates = sqliteTable('extract_candidates', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(), // 实体 | 关系
  content: text('content').notNull(),
  source: text('source').notNull().default(''),
  confidence: real('confidence').notNull().default(0),
  status: text('status').notNull().default('待审核'), // 待审核 | 已接受 | 已拒绝
  createdAt: integer('created_at').notNull(),  spaceId: text('space_id').notNull().default(''),

})

/* ============ Workshop（P8） ============ */

export const workshopApps = sqliteTable('workshop_apps', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  desc: text('desc').notNull().default(''),
  /** 画布组件配置 [{ id, type, config, x?, y?, w? }]（布局由前端解释） */
  widgets: text('widgets', { mode: 'json' }).notNull().$type<
    { id: string; type: string; config: Record<string, unknown> }[]
  >().default([]),
  variables: text('variables', { mode: 'json' }).notNull().$type<
    { name: string; type: string; bound?: string }[]
  >().default([]),
  ownerId: text('owner_id').notNull().default(''),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),  spaceId: text('space_id').notNull().default(''),

})

/* ============ AI（P6） ============ */

export const aiConversations = sqliteTable('ai_conversations', {
  id: text('id').primaryKey(),
  title: text('title').notNull().default('新对话'),
  scene: text('scene').notNull().default('assist'), // assist | agent | logic | thread
  userId: text('user_id').notNull().default(''),
  spaceId: text('space_id').notNull().default(''),
  createdAt: integer('created_at').notNull(),
})

export const aiMessages = sqliteTable('ai_messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => aiConversations.id),
  role: text('role').notNull(), // user | assistant | tool
  content: text('content').notNull().default(''),
  cites: text('cites', { mode: 'json' }).$type<string[]>(),
  toolCalls: text('tool_calls', { mode: 'json' }).$type<{ name: string; arg: string; result: string }[]>(),
  createdAt: integer('created_at').notNull(),
})

/* ============ 时序（P10 备用） ============ */

export const tsPoints = sqliteTable('ts_points', {
  id: text('id').primaryKey(),
  metric: text('metric').notNull(),
  objectId: text('object_id').notNull().default(''),
  t: integer('t').notNull(),
  value: real('value').notNull().default(0),
}, (t) => ({
  tsUnique: uniqueIndex('ts_points_metric_obj_t').on(t.metric, t.objectId, t.t),
}))

/* ============ 设置 ============ */

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull().$type<Record<string, unknown>>().default({}),
  updatedAt: integer('updated_at').notNull(),
})

/** 手机扫码协同会话（PC 建会话 → 手机上传 → PC 轮询结果） */
export const scanSessions = sqliteTable('scan_sessions', {
  id: text('id').primaryKey(),
  spaceId: text('space_id').notNull(),
  typeId: text('type_id').notNull().default(''),
  ownerId: text('owner_id').notNull(),
  status: text('status').notNull().default('waiting'), // waiting | uploaded | done | expired
  image: text('image').notNull().default(''),
  values: text('values', { mode: 'json' }).$type<Record<string, unknown>>(),
  error: text('error').notNull().default(''),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
})

/** 扫描识别模板：内置 + 用户自定义（按对象类型绑定，含字段映射与额外提示） */
export const scanTemplates = sqliteTable('scan_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  desc: text('desc').notNull().default(''),
  /** 绑定的对象类型（空=通用） */
  typeId: text('type_id').notNull().default(''),
  /** builtin=内置 / custom=用户自定义 */
  kind: text('kind').notNull().default('custom'),
  /** 票据场景标识：receipt/invoice/order/express/general */
  scene: text('scene').notNull().default('general'),
  /** 额外识别指令（用户可定制的提示词片段） */
  extraPrompt: text('extra_prompt').notNull().default(''),
  /** 字段映射：{ 输出key: 类型属性key }，用于把模型输出映射到本体属性 */
  fieldMapping: text('field_mapping', { mode: 'json' }).notNull().$type<Record<string, string>>().default({}),
  /** 自动匹配关键词（如 小票/发票/订单） */
  matchKeywords: text('match_keywords', { mode: 'json' }).notNull().$type<string[]>().default([]),
  ownerId: text('owner_id').notNull().default(''),
  spaceId: text('space_id').notNull().default(''),
  createdAt: integer('created_at').notNull(),
})

/** 数据源连接（数据接入层，P3 补齐） */
export const dataConnections = sqliteTable('data_connections', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(), // MySQL / PostgreSQL / REST / Kafka / SAP
  host: text('host').notNull().default(''),
  port: text('port').notNull().default(''),
  database: text('database').notNull().default(''),
  status: text('status').notNull().default('正常'), // 正常 / 同步中 / 告警 / 停用
  lastSyncAt: text('last_sync_at').notNull().default(''),
  tableCount: integer('table_count').notNull().default(0),
  ownerId: text('owner_id').notNull().default(''),
  spaceId: text('space_id').notNull().default(''),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

/** 数据集编目（对象类型即数据集 + 质量规则） */
export const datasetDefs = sqliteTable('dataset_defs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  typeId: text('type_id').notNull().default(''), // 关联对象类型
  desc: text('desc').notNull().default(''),
  spaceId: text('space_id').notNull().default(''),
  createdAt: integer('created_at').notNull(),
})

/** 代码仓库文件（轻量代码资产登记） */
export const repoFiles = sqliteTable('repo_files', {
  id: text('id').primaryKey(),
  path: text('path').notNull(),
  lang: text('lang').notNull().default('typescript'),
  content: text('content').notNull().default(''),
  branch: text('branch').notNull().default('main'),
  updatedBy: text('updated_by').notNull().default(''),
  spaceId: text('space_id').notNull().default(''),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

/* ============ 第 2 批：报告 / 市场 / 模型 / 管道 / 治理 ============ */

/** Notepad 报告（草稿与发布统一存储） */
export const reports = sqliteTable('reports', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  content: text('content').notNull().default(''),
  /** draft=草稿 / published=已发布 */
  status: text('status').notNull().default('draft'),
  /** AI 润色/续写结果缓存 */
  aipResult: text('aip_result').notNull().default(''),
  ownerId: text('owner_id').notNull().default(''),
  spaceId: text('space_id').notNull().default(''),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

/** Marketplace 上架产品（用户发布的可复用模板包/应用） */
export const marketplaceProducts = sqliteTable('marketplace_products', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  desc: text('desc').notNull().default(''),
  category: text('category').notNull().default('模板包'),
  /** 关联模板包 id 或 workshop 应用 id */
  refId: text('ref_id').notNull().default(''),
  version: text('version').notNull().default('1.0.0'),
  publisher: text('publisher').notNull().default(''),
  installCount: integer('install_count').notNull().default(0),
  spaceId: text('space_id').notNull().default(''),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

/** 多模型注册（BYOM：在单一全局 AI 配置之外，登记多个可用模型） */
export const modelRegistrations = sqliteTable('model_registrations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  provider: text('provider').notNull().default('自定义'),
  type: text('type').notNull().default('对话'), // 对话 / 向量化 / 视觉
  endpoint: text('endpoint').notNull().default(''),
  model: text('model').notNull().default(''),
  enabled: integer('enabled').notNull().default(1),
  /** 月度 token 配额（0=不限） */
  quota: integer('quota').notNull().default(0),
  spaceId: text('space_id').notNull().default(''),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

/** API 密钥（哈希存储，不保存明文） */
export const apiKeys = sqliteTable('api_keys', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull(),
  prefix: text('prefix').notNull().default(''),
  scope: text('scope').notNull().default('read'), // read / write / admin
  ownerId: text('owner_id').notNull().default(''),
  spaceId: text('space_id').notNull().default(''),
  lastUsedAt: integer('last_used_at'),
  createdAt: integer('created_at').notNull(),
})

/** 数据管道定义 */
export const pipelines = sqliteTable('pipelines', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  desc: text('desc').notNull().default(''),
  /** 节点配置 [{ id, type, config }] */
  nodes: text('nodes', { mode: 'json' }).notNull().$type<{ id: string; type: string; config: Record<string, unknown> }[]>().default([]),
  schedule: text('schedule').notNull().default('手动'), // 手动 / 实时 / 定时
  status: text('status').notNull().default('草稿'), // 草稿 / 已发布 / 运行中 / 已暂停
  version: integer('version').notNull().default(1),
  ownerId: text('owner_id').notNull().default(''),
  spaceId: text('space_id').notNull().default(''),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

/** 管道运行记录 */
export const pipelineRuns = sqliteTable('pipeline_runs', {
  id: text('id').primaryKey(),
  pipelineId: text('pipeline_id').notNull(),
  status: text('status').notNull().default('运行中'), // 运行中 / 成功 / 失败
  trigger: text('trigger').notNull().default('手动'),
  durationMs: integer('duration_ms').notNull().default(0),
  rowsProcessed: integer('rows_processed').notNull().default(0),
  message: text('message').notNull().default(''),
  operator: text('operator').notNull().default(''),
  spaceId: text('space_id').notNull().default(''),
  createdAt: integer('created_at').notNull(),
})

/** 治理：脱敏规则 / 扫描发现 / 生命周期策略（取代后端写死常量） */
export const cipherRules = sqliteTable('cipher_rules', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  pattern: text('pattern').notNull().default(''),
  action: text('action').notNull().default('掩码'),
  enabled: integer('enabled').notNull().default(1),
  spaceId: text('space_id').notNull().default(''),
  createdAt: integer('created_at').notNull(),
})
export const scanFindings = sqliteTable('scan_findings', {
  id: text('id').primaryKey(),
  table: text('table_name').notNull(),
  field: text('field').notNull().default(''),
  sensitiveType: text('sensitive_type').notNull().default(''),
  status: text('status').notNull().default('待处置'), // 待处置 / 已处置
  spaceId: text('space_id').notNull().default(''),
  createdAt: integer('created_at').notNull(),
})
export const lifecyclePolicies = sqliteTable('lifecycle_policies', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  retention: text('retention').notNull().default(''),
  legal: text('legal').notNull().default(''),
  spaceId: text('space_id').notNull().default(''),
  createdAt: integer('created_at').notNull(),
})

/** 业务术语 / 认证指标（借鉴 NVIDIA auto-ontology 的语义层：术语→本体属性映射 + 人工认证） */
export const ontologyTerms = sqliteTable('ontology_terms', {
  id: text('id').primaryKey(),
  term: text('term').notNull(),
  /** 同义词/口语问法，如「营收,销售额,收入额」 */
  synonyms: text('synonyms', { mode: 'json' }).notNull().$type<string[]>().default([]),
  /** 映射到的对象类型 id（空 = 跨类型指标） */
  typeId: text('type_id').notNull().default(''),
  /** 映射到的属性 key（空 = 需按表达式计算的指标） */
  propertyKey: text('property_key').notNull().default(''),
  definition: text('definition').notNull().default(''),
  /** 指标口径表达式（人可读，如「SUM(销售订单.amount)」）；非空表示这是认证指标 */
  metricExpr: text('metric_expr').notNull().default(''),
  /** 是否经人工认证（未认证的术语不作为可信口径引用） */
  certified: integer('certified').notNull().default(0),
  spaceId: text('space_id').notNull().default(''),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

/** 本体接口（Interface）：约束实现该接口的对象类型必须提供的属性契约 */
export const interfaceTypes = sqliteTable('interface_types', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  desc: text('desc').notNull().default(''),
  /** 接口契约属性 [{ key, name, type, required }] */
  properties: text('properties', { mode: 'json' }).notNull().$type<{ key: string; name: string; type: string; required?: boolean }[]>().default([]),
  /** 实现该接口的对象类型 id 列表 */
  implementedBy: text('implemented_by', { mode: 'json' }).notNull().$type<string[]>().default([]),
  spaceId: text('space_id').notNull().default(''),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

/* ============ 第 3 批：函数 / 探索 / 场景 / 治理执行 / 排程 / 部署 ============ */

/** 本体函数版本（可执行 JS 沙箱，版本/发布/测试） */
export const functionVersions = sqliteTable('function_versions', {
  id: text('id').primaryKey(),
  functionId: text('function_id').notNull(),
  version: integer('version').notNull().default(1),
  lang: text('lang').notNull().default('javascript'),
  body: text('body').notNull().default(''),
  status: text('status').notNull().default('草稿'), // 草稿 / 已发布
  testInput: text('test_input').notNull().default('{}'),
  testOutput: text('test_output').notNull().default(''),
  publishedAt: integer('published_at'),
  spaceId: text('space_id').notNull().default(''),
  createdAt: integer('created_at').notNull(),
})

/** 保存的探索（Object Explorer 高级能力） */
export const savedExplorations = sqliteTable('saved_explorations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  typeId: text('type_id').notNull(),
  filters: text('filters', { mode: 'json' }).notNull().$type<{ key: string; op: string; value: string }[]>().default([]),
  sort: text('sort').notNull().default(''),
  ownerId: text('owner_id').notNull().default(''),
  spaceId: text('space_id').notNull().default(''),
  createdAt: integer('created_at').notNull(),
})

/** 派生属性（基于表达式从已有属性计算） */
export const derivedProperties = sqliteTable('derived_properties', {
  id: text('id').primaryKey(),
  typeId: text('type_id').notNull(),
  key: text('key').notNull(),
  name: text('name').notNull(),
  expr: text('expr').notNull().default(''),
  spaceId: text('space_id').notNull().default(''),
  createdAt: integer('created_at').notNull(),
})

/** 场景分支（临时对象改动集，可合并/放弃） */
export const ontologyScenarios = sqliteTable('ontology_scenarios', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  desc: text('desc').notNull().default(''),
  status: text('status').notNull().default('进行中'), // 进行中 / 已合并 / 已放弃
  changes: text('changes', { mode: 'json' }).notNull().$type<{ op: string; typeId: string; objectId?: string; values?: Record<string, unknown> }[]>().default([]),
  ownerId: text('owner_id').notNull().default(''),
  spaceId: text('space_id').notNull().default(''),
  createdAt: integer('created_at').notNull(),
  mergedAt: integer('merged_at'),
})

/** 治理执行记录（扫描/掩码/生命周期真实动作留痕） */
export const governanceRuns = sqliteTable('governance_runs', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(), // scan / mask / lifecycle
  target: text('target').notNull().default(''),
  result: text('result').notNull().default(''),
  count: integer('count').notNull().default(0),
  spaceId: text('space_id').notNull().default(''),
  createdAt: integer('created_at').notNull(),
})

/** 排程任务（动态调度本地求解引擎） */
export const scheduleTasks = sqliteTable('schedule_tasks', {
  id: text('id').primaryKey(),
  line: text('line').notNull(),
  batch: text('batch').notNull(),
  product: text('product').notNull().default(''),
  customer: text('customer').notNull().default(''),
  priority: integer('priority').notNull().default(2),
  qty: integer('qty').notNull().default(0),
  durationH: integer('duration_h').notNull().default(8),
  startDay: integer('start_day').notNull().default(0),
  startHour: integer('start_hour').notNull().default(8),
  status: text('status').notNull().default('已排'), // 已排 / 建议 / 已应用
  planId: text('plan_id').notNull().default(''),
  spaceId: text('space_id').notNull().default(''),
  createdAt: integer('created_at').notNull(),
})

/** 部署发布记录（Apollo 本地状态机） */
export const deployments = sqliteTable('deployments', {
  id: text('id').primaryKey(),
  version: text('version').notNull(),
  env: text('env').notNull(), // dev / staging / prod
  status: text('status').notNull().default('构建中'), // 构建中 / 成功 / 失败 / 已回滚
  commit: text('commit').notNull().default(''),
  message: text('message').notNull().default(''),
  operator: text('operator').notNull().default(''),
  previousId: text('previous_id').notNull().default(''),
  durationMs: integer('duration_ms').notNull().default(0),
  spaceId: text('space_id').notNull().default(''),
  createdAt: integer('created_at').notNull(),
})
