/**
 * 身份与权限示例数据：用户 / 角色 / 用户组。
 * role.apps 为该角色可见的导航路径（'*' 表示全部）；
 * role.objectPerms 为对象类型级权限（full 读写 / read 只读 / none 无）。
 */

export type ObjectPerm = 'full' | 'read' | 'none'

export interface Role {
  id: string
  name: string
  desc: string
  apps: string[] | '*'
  objectPerms: Record<string, ObjectPerm>
  members: number
}

export interface User {
  id: string
  name: string
  account: string
  dept: string
  roleId: string
  markings: string[]
  status: '在职' | '停用'
  lastLogin: string
}

export const ROLES: Role[] = [
  {
    id: 'admin', name: '平台管理员', desc: '平台全量应用与本体管理权限，负责配置与运营',
    apps: '*', members: 2,
    objectPerms: { customer: 'full', order: 'full', product: 'full', device: 'full', ticket: 'full', employee: 'full', factory: 'full', supplier: 'full', document: 'full' },
  },
  {
    id: 'data-eng', name: '数据工程师', desc: '负责数据接入、管道与本体建模',
    apps: ['/launcher', '/overview', '/data/connections', '/data/pipelines', '/data/code', '/data/datasets', '/data/lineage', '/ontology/manager', '/ontology/explorer', '/ontology/graph', '/aip/developers'],
    members: 5,
    objectPerms: { customer: 'full', order: 'full', product: 'full', device: 'full', ticket: 'full', employee: 'read', factory: 'full', supplier: 'full', document: 'full' },
  },
  {
    id: 'analyst', name: '业务分析师', desc: '面向业务数据的探索分析与 AI 应用搭建',
    apps: ['/launcher', '/overview', '/analytics/contour', '/analytics/quiver', '/analytics/insight', '/analytics/map', '/analytics/notepad', '/analytics/fusion', '/ontology/explorer', '/ontology/views', '/ontology/graph', '/knowledge/library', '/knowledge/search', '/apps/workshop', '/apps/carbon', '/apps/marketplace', '/aip/threads'],
    members: 11,
    objectPerms: { customer: 'read', order: 'read', product: 'read', device: 'read', ticket: 'read', employee: 'none', factory: 'read', supplier: 'read', document: 'read' },
  },
  {
    id: 'field', name: '维修工程师', desc: '一线设备运维：工单处理、知识查阅与看板',
    apps: ['/launcher', '/overview', '/ontology/explorer', '/ontology/timeseries', '/knowledge/library', '/knowledge/search', '/apps/workshop', '/apps/carbon'],
    members: 46,
    objectPerms: { customer: 'none', order: 'none', product: 'read', device: 'full', ticket: 'full', employee: 'read', factory: 'read', supplier: 'none', document: 'read' },
  },
  {
    id: 'planner', name: '生产计划员', desc: '排产调度与订单交付跟进',
    apps: ['/launcher', '/overview', '/ontology/explorer', '/ontology/graph', '/ontology/scheduling', '/ontology/machinery', '/analytics/contour', '/analytics/fusion', '/apps/workshop', '/apps/automate', '/apps/carbon', '/knowledge/library', '/knowledge/search'],
    members: 8,
    objectPerms: { customer: 'read', order: 'full', product: 'read', device: 'read', ticket: 'read', employee: 'read', factory: 'full', supplier: 'read', document: 'read' },
  },
  {
    id: 'auditor', name: '合规审计员', desc: '只读全平台，负责审批、审计与安全合规',
    apps: ['/launcher', '/overview', '/gov/approvals', '/gov/audit', '/gov/security', '/admin/control', '/ontology/explorer'],
    members: 3,
    objectPerms: { customer: 'read', order: 'read', product: 'read', device: 'read', ticket: 'read', employee: 'read', factory: 'read', supplier: 'read', document: 'read' },
  },
]

export const USERS: User[] = [
  { id: 'U-0001', name: '陈星野', account: 'chen.xingye', dept: '数字化转型部', roleId: 'admin', markings: ['内部', '机密-客户', '机密-财务'], status: '在职', lastLogin: '今天 09:02' },
  { id: 'U-0102', name: '李维修', account: 'li.weixiu', dept: '佛山二厂 · 设备科', roleId: 'field', markings: ['内部'], status: '在职', lastLogin: '今天 08:47' },
  { id: 'U-0110', name: '王质检', account: 'wang.zhijian', dept: '深圳智造中心 · 质量部', roleId: 'analyst', markings: ['内部'], status: '在职', lastLogin: '今天 09:15' },
  { id: 'U-0125', name: '周计划', account: 'zhou.jihua', dept: '生产计划部', roleId: 'planner', markings: ['内部'], status: '在职', lastLogin: '今天 08:30' },
  { id: 'U-0138', name: '吴采购', account: 'wu.caigou', dept: '供应链管理部', roleId: 'analyst', markings: ['内部', '机密-财务'], status: '在职', lastLogin: '昨天 17:52' },
  { id: 'U-0150', name: '郑审计', account: 'zheng.shenji', dept: '审计与合规部', roleId: 'auditor', markings: ['内部', '机密-客户', '机密-财务'], status: '在职', lastLogin: '昨天 16:20' },
  { id: 'U-0161', name: '赵保养', account: 'zhao.baoyang', dept: '佛山一厂 · 设备科', roleId: 'field', markings: ['内部'], status: '停用', lastLogin: '2026-09-28' },
]

export const USER_GROUPS = [
  { name: '设备运维组', desc: '维修工程师集合，工单派单与知识沉淀的主要使用者', members: ['李维修', '赵保养', '孙调度'], app: '设备运维工作台' },
  { name: '销售运营组', desc: '订单与客户运营，使用销售工作台与客户分析', members: ['周计划', '吴采购'], app: '销售运营工作台' },
  { name: '数据分析组', desc: '分析师与数据工程师，负责看板、报告与建模', members: ['王质检', '陈星野'], app: '探索分析 / 应用搭建' },
]

export function roleOf(id: string): Role {
  return ROLES.find((r) => r.id === id) ?? ROLES[0]
}

/** 判断某角色是否可见某导航路径 */
export function canAccess(role: Role, path: string): boolean {
  return role.apps === '*' || role.apps.includes(path)
}
