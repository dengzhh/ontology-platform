/**
 * 全站共享示例数据：星辰智造集团业务本体。
 * 供对象浏览器 / 本体管理器 / 图谱 / 分析等页面复用。
 */

export interface ObjectTypeDef {
  id: string
  name: string
  apiName: string
  color: string
  icon: string
  count: number
  desc: string
  primaryKey: string
  properties: { name: string; key: string; type: string; required?: boolean; enumValues?: string[]; desc?: string }[]
}

export const OBJECT_TYPES: ObjectTypeDef[] = [
  {
    id: 'customer', name: '客户', apiName: 'Customer', color: '#3b82f6', icon: 'Building2', count: 1284,
    desc: '与企业发生交易关系的组织客户', primaryKey: '客户编码',
    properties: [
      { name: '客户编码', key: 'code', type: 'string', required: true },
      { name: '客户名称', key: 'name', type: 'string', required: true },
      { name: '行业', key: 'industry', type: 'enum', enumValues: ['汽车', '消费电子', '医疗器械', '新能源'] },
      { name: '信用等级', key: 'credit', type: 'enum', enumValues: ['A', 'B', 'C', 'D'] },
      { name: '年营收(万)', key: 'revenue', type: 'number' },
      { name: '合作状态', key: 'status', type: 'enum', enumValues: ['活跃', '休眠', '流失'] },
    ],
  },
  {
    id: 'order', name: '销售订单', apiName: 'SalesOrder', color: '#8b5cf6', icon: 'ShoppingCart', count: 8962,
    desc: '客户下达的销售订单主档', primaryKey: '订单号',
    properties: [
      { name: '订单号', key: 'no', type: 'string', required: true },
      { name: '金额(元)', key: 'amount', type: 'number', required: true },
      { name: '下单日期', key: 'date', type: 'date' },
      { name: '交付日期', key: 'due', type: 'date' },
      { name: '订单状态', key: 'status', type: 'enum', enumValues: ['草稿', '已审批', '生产中', '已发货', '已完成', '已取消'] },
    ],
  },
  {
    id: 'product', name: '产品', apiName: 'Product', color: '#10b981', icon: 'Package', count: 342,
    desc: '对外销售的产品与物料主数据', primaryKey: '产品编码',
    properties: [
      { name: '产品编码', key: 'code', type: 'string', required: true },
      { name: '产品名称', key: 'name', type: 'string', required: true },
      { name: '产品线', key: 'line', type: 'enum', enumValues: ['精密结构件', '注塑件', '模具', '组装件'] },
      { name: '单价(元)', key: 'price', type: 'number' },
    ],
  },
  {
    id: 'device', name: '生产设备', apiName: 'Device', color: '#f59e0b', icon: 'Cog', count: 486,
    desc: '工厂内在册生产设备数字孪生', primaryKey: '设备编号',
    properties: [
      { name: '设备编号', key: 'code', type: 'string', required: true },
      { name: '设备名称', key: 'name', type: 'string' },
      { name: '设备类型', key: 'type', type: 'enum', enumValues: ['注塑机', 'CNC', '检测仪', 'AGV', '压缩机'] },
      { name: '健康度', key: 'health', type: 'number', desc: '0-100，综合传感数据评估' },
      { name: '状态', key: 'status', type: 'enum', enumValues: ['运行', '待机', '维修', '停机'] },
      { name: '累计停机(h)', key: 'downtime', type: 'number' },
    ],
  },
  {
    id: 'ticket', name: '维修工单', apiName: 'WorkTicket', color: '#ef4444', icon: 'Wrench', count: 2137,
    desc: '设备维修与维护工单', primaryKey: '工单号',
    properties: [
      { name: '工单号', key: 'no', type: 'string', required: true },
      { name: '优先级', key: 'priority', type: 'enum', enumValues: ['P0', 'P1', 'P2', 'P3'] },
      { name: '故障类型', key: 'fault', type: 'string' },
      { name: '状态', key: 'status', type: 'enum', enumValues: ['待派单', '处理中', '待验收', '已关闭'] },
      { name: '耗时(h)', key: 'hours', type: 'number' },
    ],
  },
  {
    id: 'employee', name: '员工', apiName: 'Employee', color: '#06b6d4', icon: 'UserRound', count: 3568,
    desc: '全集团员工主数据', primaryKey: '工号',
    properties: [
      { name: '工号', key: 'code', type: 'string', required: true },
      { name: '姓名', key: 'name', type: 'string', required: true },
      { name: '岗位', key: 'role', type: 'string' },
      { name: '技能等级', key: 'skill', type: 'enum', enumValues: ['初级', '中级', '高级', '专家'] },
    ],
  },
  {
    id: 'factory', name: '工厂', apiName: 'Factory', color: '#ec4899', icon: 'Factory', count: 9,
    desc: '集团生产基地', primaryKey: '工厂编码',
    properties: [
      { name: '工厂编码', key: 'code', type: 'string', required: true },
      { name: '工厂名称', key: 'name', type: 'string' },
      { name: '所在城市', key: 'city', type: 'string' },
      { name: '设备数', key: 'devices', type: 'number' },
    ],
  },
  {
    id: 'supplier', name: '供应商', apiName: 'Supplier', color: '#6366f1', icon: 'Truck', count: 476,
    desc: '原材料与服务供应商', primaryKey: '供应商编码',
    properties: [
      { name: '供应商编码', key: 'code', type: 'string', required: true },
      { name: '名称', key: 'name', type: 'string' },
      { name: '评级', key: 'grade', type: 'enum', enumValues: ['优选', '合格', '观察', '淘汰'] },
      { name: '准时交付率', key: 'otd', type: 'number' },
    ],
  },
  {
    id: 'document', name: '知识文档', apiName: 'KnowledgeDoc', color: '#0ea5e9', icon: 'BookOpen', count: 486,
    desc: '企业知识库文档（SOP/手册/合同/案例），已分块向量化并挂接业务对象', primaryKey: '文档编号',
    properties: [
      { name: '文档编号', key: 'id', type: 'string', required: true },
      { name: '标题', key: 'title', type: 'string', required: true },
      { name: '分类', key: 'category', type: 'enum', enumValues: ['SOP', '设备手册', '合同', '维修案例', '培训材料', '会议纪要'] },
      { name: '分块数', key: 'chunks', type: 'number', desc: '向量索引中的分块数量' },
      { name: '索引状态', key: 'status', type: 'enum', enumValues: ['已索引', '解析中', '待审核', '已过期'] },
    ],
  },
]

export interface LinkTypeDef {
  name: string
  source: string
  target: string
  cardinality: '1:1' | '1:N' | 'N:1' | 'N:N'
  desc: string
  count: number
}

export const LINK_TYPES: LinkTypeDef[] = [
  { name: '客户下单', source: 'customer', target: 'order', cardinality: '1:N', desc: '客户与销售订单的所有关系', count: 8962 },
  { name: '订单包含产品', source: 'order', target: 'product', cardinality: 'N:N', desc: '订单行项与产品多对多', count: 15421 },
  { name: '工单针对设备', source: 'ticket', target: 'device', cardinality: 'N:1', desc: '维修工单指向具体设备', count: 2137 },
  { name: '设备归属工厂', source: 'device', target: 'factory', cardinality: 'N:1', desc: '设备的在册工厂', count: 486 },
  { name: '员工处理工单', source: 'employee', target: 'ticket', cardinality: '1:N', desc: '维修工程师负责的工单', count: 5106 },
  { name: '员工归属工厂', source: 'employee', target: 'factory', cardinality: 'N:1', desc: '员工所在工厂', count: 3568 },
  { name: '产品由供应商供料', source: 'product', target: 'supplier', cardinality: 'N:N', desc: '产品物料与供应关系', count: 2894 },
  { name: '订单安排工厂', source: 'order', target: 'factory', cardinality: 'N:1', desc: '订单的排产工厂', count: 8962 },
  { name: '文档适用设备', source: 'document', target: 'device', cardinality: 'N:N', desc: '手册/案例适用的设备或设备系列', count: 1284 },
  { name: '文档关联工单', source: 'document', target: 'ticket', cardinality: 'N:N', desc: '维修案例复盘关联的工单', count: 326 },
  { name: '文档签署客户', source: 'document', target: 'customer', cardinality: 'N:1', desc: '合同类文档对应的客户', count: 208 },
]

export interface ActionTypeDef {
  name: string
  target: string
  params: string
  approval: boolean
  desc: string
  exec30d: number
}

export const ACTION_TYPES: ActionTypeDef[] = [
  { name: '创建工单', target: 'ticket', params: '设备、故障类型、优先级、描述', approval: false, desc: '为设备创建维修工单并派单', exec30d: 412 },
  { name: '关闭工单', target: 'ticket', params: '工单、处理结论', approval: false, desc: '验收通过后关闭工单', exec30d: 386 },
  { name: '调整设备健康阈值', target: 'device', params: '设备、新阈值', approval: true, desc: '修改设备健康度告警阈值（需审批）', exec30d: 27 },
  { name: '订单批量审批', target: 'order', params: '订单集合、审批意见', approval: true, desc: '批量通过销售订单审批（需审批）', exec30d: 158 },
  { name: '更新供应商评级', target: 'supplier', params: '供应商、新评级、依据', approval: true, desc: '季度复评后更新供应商评级（需审批）', exec30d: 46 },
]

/** 对象示例行数据（对象浏览器等页面使用） */
export const CUSTOMER_ROWS = [
  { code: 'C-10001', name: '广州鹏程汽车', industry: '汽车', credit: 'A', revenue: '¥82,000', status: '活跃' },
  { code: 'C-10002', name: '深圳蓝湾电子', industry: '消费电子', credit: 'A', revenue: '¥45,600', status: '活跃' },
  { code: 'C-10003', name: '上海康桥医疗', industry: '医疗器械', credit: 'B', revenue: '¥21,300', status: '活跃' },
  { code: 'C-10004', name: '常州沃特新能源', industry: '新能源', credit: 'B', revenue: '¥18,900', status: '活跃' },
  { code: 'C-10005', name: '东莞凯越精密', industry: '消费电子', credit: 'C', revenue: '¥9,800', status: '休眠' },
  { code: 'C-10006', name: '苏州林德汽配', industry: '汽车', credit: 'A', revenue: '¥67,400', status: '活跃' },
  { code: 'C-10007', name: '宁波海视智驾', industry: '新能源', credit: 'B', revenue: '¥15,200', status: '活跃' },
]

export const ORDER_ROWS = [
  { no: 'SO-261102', customer: '广州鹏程汽车', amount: '¥1,286,000', date: '2026-11-01', due: '2026-12-15', status: '已审批' },
  { no: 'SO-261098', customer: '深圳蓝湾电子', amount: '¥864,500', date: '2026-10-30', due: '2026-11-20', status: '生产中' },
  { no: 'SO-261095', customer: '上海康桥医疗', amount: '¥432,800', date: '2026-10-28', due: '2026-11-30', status: '生产中' },
  { no: 'SO-261090', customer: '苏州林德汽配', amount: '¥2,105,000', date: '2026-10-25', due: '2026-12-01', status: '已发货' },
  { no: 'SO-261088', customer: '常州沃特新能源', amount: '¥589,200', date: '2026-10-24', due: '2026-11-18', status: '已完成' },
  { no: 'SO-261082', customer: '东莞凯越精密', amount: '¥96,700', date: '2026-10-20', due: '2026-11-10', status: '已取消' },
]

export const DEVICE_ROWS = [
  { code: 'F2-IM-2041', name: '注塑机 2041', type: '注塑机', health: 62, status: '维修', downtime: 47.5, factory: '佛山 F2' },
  { code: 'F2-CN-1088', name: 'CNC 1088', type: 'CNC', health: 91, status: '运行', downtime: 3.2, factory: '佛山 F2' },
  { code: 'F1-IM-2015', name: '注塑机 2015', type: '注塑机', health: 85, status: '运行', downtime: 8.6, factory: '佛山 F1' },
  { code: 'SZ-QA-0032', name: '三坐标检测仪', type: '检测仪', health: 78, status: '待机', downtime: 12.0, factory: '深圳 SZ' },
  { code: 'F1-AGV-0067', name: 'AGV 0067', type: 'AGV', health: 95, status: '运行', downtime: 1.4, factory: '佛山 F1' },
  { code: 'NB-AC-0009', name: '空压机 0009', type: '压缩机', health: 54, status: '停机', downtime: 36.8, factory: '宁波 NB' },
]

export const TICKET_ROWS = [
  { no: 'GD-2291', device: 'F2-IM-2041', priority: 'P0', fault: '液压系统泄漏', status: '处理中', owner: '李维修', hours: 12.5 },
  { no: 'GD-2290', device: 'NB-AC-0009', priority: 'P1', fault: '排气压力异常', status: '待派单', owner: '—', hours: 0 },
  { no: 'GD-2287', device: 'SZ-QA-0032', priority: 'P2', fault: '探针校准漂移', status: '待验收', owner: '王质检', hours: 4.0 },
  { no: 'GD-2284', device: 'F2-CN-1088', priority: 'P3', fault: '更换导轨润滑', status: '已关闭', owner: '赵保养', hours: 2.0 },
  { no: 'GD-2281', device: 'F1-IM-2015', priority: 'P2', fault: '料筒温控偏差', status: '已关闭', owner: '李维修', hours: 5.5 },
]

export const FACTORY_ROWS = [
  { code: 'F1', name: '佛山一厂', city: '广东·佛山', devices: 128, oee: '86%' },
  { code: 'F2', name: '佛山二厂', city: '广东·佛山', devices: 96, oee: '78%' },
  { code: 'SZ', name: '深圳智造中心', city: '广东·深圳', devices: 84, oee: '91%' },
  { code: 'NB', name: '宁波精工厂', city: '浙江·宁波', devices: 72, oee: '74%' },
  { code: 'CQ', name: '重庆西部厂', city: '重庆', devices: 58, oee: '82%' },
]

export const EMPLOYEES = ['陈星野', '李维修', '王质检', '赵保养', '周计划', '吴采购', '郑审计', '孙调度']
