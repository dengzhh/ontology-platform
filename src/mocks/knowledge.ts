/** 知识层示例数据：文档库 / 向量索引 / 抽取候选（星辰智造集团） */

export interface KnowledgeDoc {
  id: string
  title: string
  category: string
  format: 'PDF' | 'Word' | 'Wiki' | 'PPT'
  size: string
  chunks: number
  linked: { type: string; name: string }[]
  status: '已索引' | '解析中' | '待审核' | '已过期'
  updatedAt: string
  owner: string
}

export const KNOWLEDGE_DOCS: KnowledgeDoc[] = [
  { id: 'KB-0012', title: '注塑机液压系统维修手册（第 3 版）', category: '设备手册', format: 'PDF', size: '12.4 MB', chunks: 86, linked: [{ type: '生产设备', name: '注塑机 F2 系列' }, { type: '工单', name: 'GD-2291' }], status: '已索引', updatedAt: '2026-11-02', owner: '李维修' },
  { id: 'KB-0034', title: '佛山二厂设备点检 SOP', category: 'SOP', format: 'Word', size: '2.1 MB', chunks: 24, linked: [{ type: '工厂', name: '佛山 F2' }], status: '已索引', updatedAt: '2026-10-28', owner: '周计划' },
  { id: 'KB-0102', title: '广州鹏程汽车框架采购合同 2026', category: '合同', format: 'PDF', size: '3.8 MB', chunks: 41, linked: [{ type: '客户', name: '广州鹏程汽车' }, { type: '订单', name: 'SO-261102' }], status: '已索引', updatedAt: '2026-10-25', owner: '吴采购' },
  { id: 'KB-0157', title: 'GD-2291 液压泄漏维修案例复盘', category: '维修案例', format: 'Wiki', size: '—', chunks: 6, linked: [{ type: '工单', name: 'GD-2291' }, { type: '生产设备', name: 'F2-IM-2041' }], status: '待审核', updatedAt: '2026-11-03', owner: '李维修' },
  { id: 'KB-0189', title: '供应商季度评审操作指引', category: 'SOP', format: 'PDF', size: '1.6 MB', chunks: 18, linked: [{ type: '供应商', name: '全部' }], status: '已索引', updatedAt: '2026-10-15', owner: '吴采购' },
  { id: 'KB-0203', title: '空压机异常声音诊断培训课件', category: '培训材料', format: 'PPT', size: '8.9 MB', chunks: 33, linked: [{ type: '生产设备', name: 'NB-AC-0009' }], status: '解析中', updatedAt: '2026-11-03', owner: '王质检' },
  { id: 'KB-0221', title: '2026 Q3 质量分析会议纪要', category: '会议纪要', format: 'Word', size: '0.4 MB', chunks: 5, linked: [{ type: '产品', name: '精密结构件' }], status: '已索引', updatedAt: '2026-10-12', owner: '郑审计' },
  { id: 'KB-0240', title: '设备润滑保养标准（2024 版）', category: '设备手册', format: 'PDF', size: '5.2 MB', chunks: 37, linked: [{ type: '生产设备', name: '全部' }], status: '已过期', updatedAt: '2025-06-30', owner: '赵保养' },
]

export interface VectorIndex {
  name: string
  source: string
  vectors: string
  dim: number
  model: string
  updated: string
}

export const VECTOR_INDEXES: VectorIndex[] = [
  { name: 'kb_main', source: '知识文档（全部已索引）', vectors: '128,406', dim: 1024, model: 'text-embedding-3', updated: '10 分钟前' },
  { name: 'kb_contract', source: '合同类文档', vectors: '18,932', dim: 1024, model: 'text-embedding-3', updated: '2 小时前' },
  { name: 'kb_manual', source: '设备手册', vectors: '42,180', dim: 1024, model: 'bge-m3', updated: '昨天 22:00' },
  { name: 'ticket_history', source: '历史工单处理记录', vectors: '86,204', dim: 768, model: 'bge-m3', updated: '1 小时前' },
]

export interface ExtractCandidate {
  id: string
  kind: '实体' | '关系'
  content: string
  source: string
  confidence: number
  status: '待审核' | '已接受' | '已拒绝'
}

export const EXTRACT_CANDIDATES: ExtractCandidate[] = [
  { id: 'EC-1042', kind: '实体', content: '液压系统泄漏 → 故障类型（工单.故障类型枚举新增值）', source: 'KB-0012 维修手册', confidence: 0.96, status: '待审核' },
  { id: 'EC-1043', kind: '关系', content: 'GD-2291 涉及 液压系统 → 工单 ↔ 知识文档 新链接', source: 'KB-0157 案例复盘', confidence: 0.91, status: '待审核' },
  { id: 'EC-1044', kind: '实体', content: '「恒达精密五金」→ 供应商（疑似新建，与恒达五金相似度 0.72）', source: 'KB-0102 合同', confidence: 0.68, status: '待审核' },
  { id: 'EC-1045', kind: '关系', content: 'NB-AC-0009 适用 KB-0203 培训课件 → 设备 ↔ 知识文档', source: 'KB-0203 课件', confidence: 0.94, status: '已接受' },
  { id: 'EC-1046', kind: '实体', content: '润滑脂 NLGI-2 → 物料属性候选', source: 'KB-0240 保养标准', confidence: 0.57, status: '已拒绝' },
]
