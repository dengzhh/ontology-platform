/** 治理与运行类示例数据：审批 / 审计 / 管道运行 */

export const APPROVALS = [
  { id: 'AP-20261103-01', title: '批量关闭僵尸工单（127 条）', requester: '周计划', type: '动作执行', target: '维修工单', risk: '中', time: '2026-11-03 09:12', status: '待审批' },
  { id: 'AP-20261102-08', title: '调整 NB-AC-0009 健康阈值 60→50', requester: '李维修', type: '参数变更', target: '生产设备', risk: '低', time: '2026-11-02 16:40', status: '待审批' },
  { id: 'AP-20261102-05', title: '供应商「恒达五金」评级 B→C', requester: '吴采购', type: '评级变更', target: '供应商', risk: '中', time: '2026-11-02 11:05', status: '待审批' },
  { id: 'AP-20261101-12', title: '订单 SO-261102 审批（¥1,286,000）', requester: '陈星野', type: '订单审批', target: '销售订单', risk: '高', time: '2026-11-01 15:22', status: '已通过' },
  { id: 'AP-20261101-09', title: '新建对象类型「模具批次」', requester: '陈星野', type: '本体变更', target: '本体', risk: '低', time: '2026-11-01 10:18', status: '已通过' },
  { id: 'AP-20261031-21', title: '导出客户联系方式（含手机号）', requester: '吴采购', type: '敏感数据', target: '客户', risk: '高', time: '2026-10-31 17:55', status: '已驳回' },
]

export const AUDIT_EVENTS = [
  { time: '2026-11-03 09:41:22', actor: '李维修', action: '执行动作 · 创建工单', target: 'GD-2291 / F2-IM-2041', result: '成功', ip: '10.8.12.66' },
  { time: '2026-11-03 09:12:05', actor: '周计划', action: '发起动作 · 批量关闭工单（127）', target: '维修工单', result: '待审批', ip: '10.8.20.31' },
  { time: '2026-11-03 08:55:40', actor: 'AIP·质量异常检测员', action: 'Agent 运行 · 批次 B-2026-1102 分析', target: '产品批次', result: '成功', ip: '内部' },
  { time: '2026-11-03 08:30:00', actor: '系统', action: '管道调度 · ERP 订单同步', target: 'pipeline_erp_order', result: '成功', ip: '内部' },
  { time: '2026-11-03 08:02:17', actor: '王质检', action: '查看敏感属性 · 客户.联系人手机', target: 'C-10001', result: 'Checkpoint 已留痕', ip: '10.8.9.14' },
  { time: '2026-11-02 22:41:03', actor: 'AIP·质量异常检测员', action: '触发通知 · 疑似异常批次', target: 'B-2026-1102', result: '成功', ip: '内部' },
  { time: '2026-11-02 16:40:11', actor: '李维修', action: '参数变更申请 · 设备健康阈值', target: 'NB-AC-0009', result: '待审批', ip: '10.8.12.66' },
  { time: '2026-11-02 14:20:45', actor: '郑审计', action: '查询审计日志', target: 'audit.3', result: '成功', ip: '10.8.3.7' },
]

export const PIPELINE_RUNS = [
  { name: 'ERP 订单同步', schedule: '每日 06:00', duration: '4分12秒', rows: '1.2M', status: '成功', time: '今日 06:00' },
  { name: 'MES 设备遥测流', schedule: '实时', duration: '—', rows: '8.6万/时', status: '运行中', time: '持续' },
  { name: 'CRM 客户增量', schedule: '每 30 分钟', duration: '38秒', rows: '1,204', status: '成功', time: '09:30' },
  { name: '供应商评级月度重算', schedule: '每月 1 日', duration: '12分08秒', rows: '476', status: '成功', time: '11-01 02:00' },
  { name: 'SRM 交付数据校验', schedule: '每日 05:30', duration: '2分41秒', rows: '9,872', status: '告警', time: '今日 05:30' },
]
