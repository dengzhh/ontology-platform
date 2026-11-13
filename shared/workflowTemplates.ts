/** AIP Logic 预设工作流模板（前后端共享）：开箱即用的一键可跑模板 */

export interface WorkflowStep {
  id: string
  type: 'input' | 'llm' | 'condition' | 'transform' | 'output'
  label: string
  prompt?: string
  model?: string
  condition?: string
  outputFormat?: string
  /** transform 节点：extract=提取数值字段（供后续条件判断），keyword=关键词命中路由，format=格式化输出 */
  transform?: 'extract' | 'keyword' | 'format'
  /** transform 参数：extract 用 field（字段名）；keyword 用 words（逗号分隔） */
  field?: string
  words?: string
  x?: number
  y?: number
  /** 条件节点分支目标：命中走 nextYes，否则走 nextNo；留空按数组顺序继续 */
  nextYes?: string
  nextNo?: string
}

export interface WorkflowPreset {
  id: string
  name: string
  desc: string
  /** 适用领域标签，模板库卡片显示 */
  tag: string
  /** 是否依赖 LLM 网关（false=纯本地确定性执行，离线可跑） */
  needsLlm: boolean
  /** 一键载入时自动填入的示例输入 */
  sampleInput: string
  steps: WorkflowStep[]
}

const OUT = (id: string, label: string, format: string, x: number, y: number): WorkflowStep =>
  ({ id, type: 'output', label, outputFormat: format, x, y })

export const WORKFLOW_PRESETS: WorkflowPreset[] = [
  {
    id: 'PRESET-DEVICE-TRIAGE',
    name: '设备健康分诊',
    desc: '从设备告警文本提取健康度数值，按阈值自动分流：≥60 归档、<60 转维修复核',
    tag: '设备运维',
    needsLlm: false,
    sampleInput: '设备 F2-IM-2041 健康度 42，已停机 47.5 小时，关联工单 GD-2291',
    steps: [
      { id: 's1', type: 'input', label: '输入告警文本', outputFormat: '设备告警/工单文本', x: 40, y: 60 },
      { id: 's2', type: 'transform', label: '提取健康度', transform: 'extract', field: '健康度', x: 280, y: 60 },
      { id: 's3', type: 'condition', label: '健康度 ≥ 60？', condition: '健康度 >= 60', x: 520, y: 60, nextYes: 's4', nextNo: 's5' },
      OUT('s4', '自动归档', '健康设备清单', 760, 20),
      OUT('s5', '转维修复核', '维修工单草稿', 760, 150),
    ],
  },
  {
    id: 'PRESET-TICKET-ROUTE',
    name: '工单紧急分流',
    desc: '按告警文本关键词判定紧急程度：含「紧急/停机/故障」走优先处理，否则常规排队',
    tag: '工单管理',
    needsLlm: false,
    sampleInput: '紧急：注塑机 F1-CN-1088 的主轴故障停机，需立即处理',
    steps: [
      { id: 's1', type: 'input', label: '输入工单文本', outputFormat: '工单/报修文本', x: 40, y: 60 },
      { id: 's2', type: 'transform', label: '关键词标记', transform: 'keyword', words: '紧急,停机,故障,告警', x: 280, y: 60 },
      { id: 's3', type: 'condition', label: '是否紧急？', condition: '包含 命中', x: 520, y: 60, nextYes: 's4', nextNo: 's5' },
      OUT('s4', '优先处理', 'P1 紧急工单', 760, 20),
      OUT('s5', '常规排队', 'P3 常规工单', 760, 150),
    ],
  },
  {
    id: 'PRESET-ORDER-TIER',
    name: '订单金额分级',
    desc: '提取订单金额，≥50 万标记大客户订单重点跟进，其余常规履约',
    tag: '销售运营',
    needsLlm: false,
    sampleInput: '订单 SO-2026-1188 客户 广州鹏程汽车 金额 820000 元，状态 已审批',
    steps: [
      { id: 's1', type: 'input', label: '输入订单文本', outputFormat: '订单摘要文本', x: 40, y: 60 },
      { id: 's2', type: 'transform', label: '提取金额', transform: 'extract', field: '金额', x: 280, y: 60 },
      { id: 's3', type: 'condition', label: '金额 ≥ 50 万？', condition: '金额 >= 500000', x: 520, y: 60, nextYes: 's4', nextNo: 's5' },
      OUT('s4', '大客户跟进', '重点订单清单', 760, 20),
      OUT('s5', '常规履约', '常规订单清单', 760, 150),
    ],
  },
  {
    id: 'PRESET-DOC-CLASSIFY',
    name: '文档归类标记',
    desc: '按文档内容关键词自动打标：合同/发票类进财务归档，其余进通用知识库',
    tag: '知识管理',
    needsLlm: false,
    sampleInput: '《设备采购合同》甲方星辰智造集团，乙方供应商，合同金额 120 万元，签字盖章生效',
    steps: [
      { id: 's1', type: 'input', label: '输入文档摘要', outputFormat: '文档标题/正文摘要', x: 40, y: 60 },
      { id: 's2', type: 'transform', label: '关键词标记', transform: 'keyword', words: '合同,发票,付款,金额', x: 280, y: 60 },
      { id: 's3', type: 'condition', label: '是否财务类？', condition: '包含 命中', x: 520, y: 60, nextYes: 's4', nextNo: 's5' },
      OUT('s4', '财务归档', '财务文档分类', 760, 20),
      OUT('s5', '通用知识库', '通用文档分类', 760, 150),
    ],
  },
  {
    id: 'PRESET-LLM-ANALYSIS',
    name: 'LLM 停机归因分析',
    desc: '调用平台已配置的 AI 模型分析设备故障原因并给出处置建议；网关不可用时自动降级为规则摘要',
    tag: '智能分析',
    needsLlm: true,
    sampleInput: '设备 F2-IM-2041 健康度 62，近 7 天停机 3 次累计 47.5 小时，液压系统渗漏，维修工单 GD-2291 处理中',
    steps: [
      { id: 's1', type: 'input', label: '输入设备数据', outputFormat: '设备告警/维修记录', x: 40, y: 60 },
      { id: 's2', type: 'llm', label: 'LLM 归因分析', prompt: '分析设备故障的可能原因，给出 3 条处置建议，并输出结构化结果（含置信度）', model: 'auto', x: 300, y: 60 },
      { id: 's3', type: 'condition', label: '含高置信结论？', condition: '包含 建议', x: 560, y: 60, nextYes: 's4', nextNo: 's5' },
      OUT('s4', '输出分析结论', '归因报告 + 处置建议', 820, 20),
      OUT('s5', '人工复核', '待复核分析草稿', 820, 150),
    ],
  },
]

export const PRESET_IDS = new Set(WORKFLOW_PRESETS.map((p) => p.id))
export function findPreset(id: string): WorkflowPreset | undefined {
  return WORKFLOW_PRESETS.find((p) => p.id === id)
}
