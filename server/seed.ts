/**
 * 初始化种子数据：身份/角色/本体/示例实例。
 * 运行：npx tsx server/seed.ts  （幂等：先清空再插入）
 */
import { db, tables } from './db'
import { hashPassword } from './auth'
import { ROLES, USERS, USER_GROUPS } from '../src/mocks/identity'
import { OBJECT_TYPES, LINK_TYPES, ACTION_TYPES, CUSTOMER_ROWS, ORDER_ROWS, DEVICE_ROWS, TICKET_ROWS, FACTORY_ROWS } from '../src/mocks/ontology'
import { APPROVALS, AUDIT_EVENTS, PIPELINE_RUNS } from '../src/mocks/activity'
import { KNOWLEDGE_DOCS } from '../src/mocks/knowledge'

const now = Date.now()
const slug = (s: string) => s.replace(/\s+/g, '-').toLowerCase()

function wipe() {
  for (const t of [
    tables.spaceMembers, tables.spaces, tables.groupMembers, tables.userGroups, tables.users, tables.roles,
    tables.objectLinks, tables.objects, tables.linkTypes, tables.actionTypes, tables.ontologyFunctions, tables.objectTypes,
    tables.approvals, tables.actionLogs, tables.auditEvents, tables.notifications,
    tables.docLinks, tables.docChunks, tables.documents, tables.extractCandidates,
    tables.automationRules, tables.workshopApps, tables.aiMessages, tables.aiConversations,
    tables.tsPoints, tables.settings,
  ]) {
    db.delete(t).run()
  }
}

function seedIdentity() {
  // 插入顺序必须满足外键：roles → users → spaces（owner_id 指向 users） → space_members
  for (const r of ROLES) {
    db.insert(tables.roles).values({
      id: r.id, name: r.name, desc: r.desc,
      apps: r.apps === '*' ? ['*'] : r.apps,
      objectPerms: r.objectPerms, createdAt: now,
    }).run()
  }
  for (const u of USERS) {
    db.insert(tables.users).values({
      id: u.id, name: u.name, account: u.account, passwordHash: hashPassword('ontos@2026'),
      dept: u.dept, roleId: u.roleId, markings: u.markings, status: u.status,
      lastLoginAt: u.lastLogin, createdAt: now,
    }).run()
  }
  db.insert(tables.spaces).values({ id: 'sp-org-default', name: '星辰智造集团', kind: 'org', ownerId: 'U-0001', templatePack: 'manufacturing-demo', createdAt: now }).run()
  for (const u of USERS) {
    db.insert(tables.spaceMembers).values({ spaceId: 'sp-org-default', userId: u.id, role: u.account === 'chen.xingye' ? 'owner' : 'member' }).run()
  }
  USER_GROUPS.forEach((g, i) => {
    const gid = `G-${i + 1}`
    db.insert(tables.userGroups).values({ id: gid, name: g.name, desc: g.desc, defaultApp: g.app, createdAt: now }).run()
    for (const m of g.members) {
      const uid = USERS.find((u) => u.name === m)?.id
      if (uid) db.insert(tables.groupMembers).values({ groupId: gid, userId: uid }).run()
    }
  })
}

function seedOntology() {
  const SP = 'sp-org-default'
  for (const t of OBJECT_TYPES) {
    db.insert(tables.objectTypes).values({
      id: t.id, apiName: t.apiName, name: t.name, desc: t.desc, color: t.color, icon: t.icon,
      primaryKey: t.primaryKey,
      properties: t.properties.map((p) => ({ key: p.key, name: p.name, type: p.type, required: p.required, enumValues: p.enumValues })),
      viewTemplate: { titleKey: t.properties[0]?.key, subKey: t.properties[1]?.key },
      spaceId: SP, createdAt: now, updatedAt: now,
    }).run()
  }
  for (const l of LINK_TYPES) {
    db.insert(tables.linkTypes).values({
      id: slug(l.name), name: l.name, sourceTypeId: l.source, targetTypeId: l.target,
      cardinality: l.cardinality, desc: l.desc, spaceId: SP, createdAt: now,
    }).run()
  }
  for (const a of ACTION_TYPES) {
    db.insert(tables.actionTypes).values({
      id: slug(a.name), name: a.name, targetTypeId: a.target,
      params: [
        { key: 'objectId', name: '目标对象', type: 'string', required: true },
        { key: 'comment', name: '说明', type: 'string' },
      ],
      effect: { kind: 'update', setValues: {} },
      needsApproval: a.approval ? 1 : 0, desc: a.desc, spaceId: SP, createdAt: now,
    }).run()
  }
  const fns = [
    { name: 'computeOee', desc: '按设备与时间窗计算 OEE 综合效率', linked: ['device'] },
    { name: 'churnProbability', desc: '客户流失概率评分（智能调用）', linked: ['customer'] },
    { name: 'ticketSlaCheck', desc: '工单 SLA 达成检查并触发升级', linked: ['ticket'] },
  ]
  for (const f of fns) {
    db.insert(tables.ontologyFunctions).values({
      id: slug(f.name), name: f.name, desc: f.desc, lang: 'TypeScript',
      linkedTypeIds: f.linked, body: '// P6：AI 工具可调用的注册函数', spaceId: SP, createdAt: now,
    }).run()
  }
}

function seedObjects() {
  const objId = (type: string, n: number) => `${type}:${n + 1}`
  const insertObjects = (typeId: string, rows: Record<string, unknown>[]) => {
    rows.forEach((values, i) => {
      db.insert(tables.objects).values({
        id: objId(typeId, i), typeId, values, createdBy: 'seed', spaceId: 'sp-org-default', createdAt: now, updatedAt: now,
      }).run()
    })
  }
  insertObjects('factory', FACTORY_ROWS as unknown as Record<string, unknown>[])
  insertObjects('device', DEVICE_ROWS as unknown as Record<string, unknown>[])
  insertObjects('customer', CUSTOMER_ROWS as unknown as Record<string, unknown>[])
  insertObjects('order', ORDER_ROWS as unknown as Record<string, unknown>[])
  insertObjects('ticket', TICKET_ROWS as unknown as Record<string, unknown>[])

  const findObj = (typeId: string, key: string, val: string) =>
    db.select().from(tables.objects).all().find((o) => o.typeId === typeId && String((o.values as Record<string, unknown>)[key]) === val)?.id

  // 订单 → 客户
  ORDER_ROWS.forEach((o, i) => {
    const cid = findObj('customer', 'name', o.customer)
    if (cid) db.insert(tables.objectLinks).values({ id: `L-oc-${i}`, linkTypeId: '客户下单', sourceId: cid, targetId: objId('order', i), createdBy: 'seed', spaceId: 'sp-org-default', createdAt: now }).run()
  })
  // 工单 → 设备
  TICKET_ROWS.forEach((t, i) => {
    const did = findObj('device', 'code', t.device)
    if (did) db.insert(tables.objectLinks).values({ id: `L-td-${i}`, linkTypeId: '工单针对设备', sourceId: objId('ticket', i), targetId: did, createdBy: 'seed', spaceId: 'sp-org-default', createdAt: now }).run()
  })
  // 设备 → 工厂
  DEVICE_ROWS.forEach((d, i) => {
    const fid = findObj('factory', 'name', String(d.factory))
    if (fid) db.insert(tables.objectLinks).values({ id: `L-df-${i}`, linkTypeId: '设备归属工厂', sourceId: objId('device', i), targetId: fid, createdBy: 'seed', spaceId: 'sp-org-default', createdAt: now }).run()
  })
}

function seedGovernance() {
  APPROVALS.forEach((a, i) => {
    db.insert(tables.approvals).values({
      id: a.id, title: a.title, kind: a.type, payload: { target: a.target }, requester: a.requester,
      risk: a.risk, status: a.status, decidedBy: a.status === '待审批' ? '' : '陈星野',
      decidedAt: a.status === '待审批' ? null : now - (i + 1) * 3600_000, createdAt: now - (i + 1) * 7200_000,
    }).run()
  })
  AUDIT_EVENTS.forEach((e, i) => {
    db.insert(tables.auditEvents).values({
      id: `AE-seed-${i}`, actor: e.actor, action: e.action, target: e.target,
      detail: { result: e.result }, result: e.result, ip: e.ip, createdAt: now - i * 1800_000,
    }).run()
  })
  ;[
    { title: '数据质量告警：订单明细表空值率超阈值', level: 'error', tag: '数据' },
    { title: '审批待处理：「批量关闭僵尸工单」动作申请', level: 'warn', tag: '审批' },
    { title: `管道「${PIPELINE_RUNS[0].name}」今日运行成功`, level: 'success', tag: '管道' },
  ].forEach((n, i) => {
    db.insert(tables.notifications).values({
      id: `NT-seed-${i}`, title: n.title, body: '', level: n.level, tag: n.tag, read: 0, createdAt: now - (i + 1) * 600_000,
    }).run()
  })
}

function seedKnowledge() {
  // P5 起改为真实文档入库，不再 seed 占位文档
  return
  KNOWLEDGE_DOCS.forEach((d) => {
    db.insert(tables.documents).values({
      id: d.id, title: d.title, category: d.category, format: d.format, size: d.size,
      status: d.status, owner: d.owner, content: `（P5 将解析入库：${d.title}）`, chunkCount: d.chunks, spaceId: 'sp-org-default',
      createdAt: now, updatedAt: now,
    }).run()
  })
}

function seedSettings() {
  db.insert(tables.settings).values({
    key: 'ai',
    value: { endpoint: '', apiKey: '', model: '', configured: false },
    updatedAt: now,
  }).run()
}

wipe()
seedIdentity()
seedOntology()
seedObjects()
seedGovernance()
seedKnowledge()
seedSettings()

const counts = {
  users: db.select().from(tables.users).all().length,
  roles: db.select().from(tables.roles).all().length,
  objectTypes: db.select().from(tables.objectTypes).all().length,
  linkTypes: db.select().from(tables.linkTypes).all().length,
  actionTypes: db.select().from(tables.actionTypes).all().length,
  objects: db.select().from(tables.objects).all().length,
  links: db.select().from(tables.objectLinks).all().length,
  documents: db.select().from(tables.documents).all().length,
}
console.log('[seed] 完成：', counts)
console.log('[seed] 默认账号：chen.xingye / ontos@2026（所有演示账号同密码）')
