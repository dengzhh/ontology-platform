import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Bot, X, Wrench, FileSearch, User, Send, Loader2, Sparkles } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, Tooltip, PieChart, Pie, Cell } from 'recharts'
import { useUI } from '@/store/ui'
import { Badge } from '@/components/ui/Badge'
import { ALL_NAV_ITEMS } from '@/config/nav'
import { api, getSpaceId } from '@/lib/api'
import { cn } from '@/lib/utils'

/** ChatBI 聚合结果（对话内迷你图表用）；groupBy/metric 与后端 /dashboard/aggregate 一致为 {key,name} */
interface ChartData { name: string; sum: number; count: number; avg: number }
/** 同比/环比对比块（/aggregate?compare=prev|yoy 返回） */
interface AnalysisCompare {
  mode: 'prev' | 'yoy'
  current: { from: string; to: string; objects: number; sum: number; avg: number; count: number }
  previous: { from: string; to: string; objects: number; sum: number; avg: number; count: number }
  delta: number
  deltaPct: number | null
}
/** 二维交叉矩阵（/aggregate?crossBy=第二维度 返回） */
interface AnalysisCross {
  rowBy: { key: string; name: string }
  colBy: { key: string; name: string }
  columns: string[]
  rows: { name: string; rowCount: number; rowSum: number; cells: Record<string, { sum: number; count: number }> }[]
  metric: 'sum' | 'count'
}
interface AnalysisResult {
  groups: ChartData[]
  compare?: AnalysisCompare | null
  cross?: AnalysisCross | null
  groupBy: { key: string; name: string }
  metric: { key: string; name: string } | null
  total: number
  applied: Record<string, unknown>
}

/** 面板内消息（渲染用） */
interface UiMsg {
  role: 'user' | 'ai'
  content: string
  tools?: { name: string; arg: string; result: string }[]
  cites?: string[]
  /** 该条消息里工具产出的聚合结果，用于渲染对话内柱图 */
  analysis?: AnalysisResult
  /** ask_clarification 反问的候选项（点击即作为用户答复发送） */
  clarify?: string[]
}

/** 与服务端的协议消息 */
interface WireMsg {
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: { id: string; name: string; args: Record<string, unknown> }[]
  toolCallId?: string
}

/** 按空间 id 选示例集（getSpaceId 返回 sp-org-default / sp-personal-xxx / sp-family-xxx） */
function suggestionsFor(spaceId: string): string[] {
  if (spaceId.includes('personal') || spaceId.includes('family')) return SUGGESTIONS_BY_SPACE.personal
  return SUGGESTIONS_BY_SPACE.org
}

/** 快捷示例：按空间类型给出不同侧重点，覆盖全部工具能力（导航/明细/概览/ChatBI 含趋势环比同比TOP/知识/动作/用户/系统用法/函数/管道/排程/治理） */
const SUGGESTIONS_BY_SPACE: Record<string, string[]> = {
  org: [
    '打开 对象浏览器',
    '查询设备 "M-2041"',
    '本体概览',
    '按状态统计设备数量',
    '近 12 个月订单金额趋势',
    '订单金额环比上月',
    '订单金额同比去年',
    '停机时长 TOP5 设备',
    '各设备类型的状态分布',
    '按月看各状态订单金额',
    '统计一下',
    '维修工单怎么处理',
    '有哪些动作',
    '查看当前排程与利用率',
    '扫描敏感数据',
    '看看有哪些待审批',
    '列出数据源连接',
    '有哪些空间',
    '可信业务定义在哪儿配置',
  ],
  personal: [
    '按类别统计支出金额',
    '按月统计消费趋势',
    '消费金额环比上月',
    '花销最大的 5 个类别',
    '记一笔支出 午饭 28 元',
    '查询支出 "房租"',
    '本体概览',
    '打开 对象浏览器',
    '有哪些空间',
    '可信业务定义在哪儿配置',
  ],
}

export default function AssistPanel() {
  const { assistOpen, setAssistOpen } = useUI()
  const navigate = useNavigate()
  const location = useLocation()
  const [msgs, setMsgs] = useState<UiMsg[]>([])
  const [wire, setWire] = useState<WireMsg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [engine, setEngine] = useState<{ configured: boolean; model: string; engine: string } | null>(null)
  const [convs, setConvs] = useState<{ id: string; title: string; createdAt: string }[]>([])
  const [convId, setConvId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  /** 最近一次 analyze_objects 工具的结构化结果（供渲染对话内图表，不回灌 LLM） */
  const lastAnalysis = useRef<AnalysisResult | null>(null)

  async function loadConvs() {
    try {
      const r = await api<{ conversations: { id: string; title: string; createdAt: string }[] }>('/ai/conversations')
      setConvs(r.conversations)
      return r.conversations
    } catch { return [] }
  }

  useEffect(() => {
    if (assistOpen && !engine) {
      api<{ configured: boolean; model: string; engine: string }>('/ai/status').then(setEngine).catch(() => setEngine({ configured: false, model: '', engine: 'local' }))
    }
    if (assistOpen) loadConvs()
  }, [assistOpen, engine])

  // 加载选中会话的历史消息
  useEffect(() => {
    if (!convId) { setMsgs([]); setWire([]); return }
    api<{ messages: UiMsg[] }>(`/ai/conversations/${convId}/messages`).then((r) => { setMsgs(r.messages); setWire([]) }).catch(() => {})
  }, [convId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [msgs, busy])

  async function runTool(name: string, args: Record<string, unknown>): Promise<string> {
    try {
      if (name === 'navigate') {
        const page = String(args.page ?? '')
        // 旧英文名兼容：菜单统一改中文后，历史问法/模型输出仍带英文产品名时也能正确导航
        const LEGACY_PAGE_NAMES: Record<string, string> = {
          'contour': '探索分析', 'contour 分析': '探索分析', 'quiver': '联动分析', 'quiver 分析': '联动分析',
          'insight': '路径分析', 'insight 路径': '路径分析', 'notepad': '智能报告', 'notepad 报告': '智能报告',
          'fusion': '智能表格', 'fusion 表格': '智能表格', 'workshop': '应用搭建', 'workshop 搭建': '应用搭建',
          'automate': '自动化引擎', 'automate 自动化': '自动化引擎', 'carbon': '岗位工作区', 'carbon 工作区': '岗位工作区',
          'marketplace': '应用市场', 'aip logic': '工作流编排', 'agent studio': '智能体构建',
          'aip threads': '文档分析', 'aip evals': '模型评估', 'apollo': '部署发布', 'apollo 部署': '部署发布',
        }
        const norm = LEGACY_PAGE_NAMES[page.trim().toLowerCase()] ?? page
        const hit = ALL_NAV_ITEMS.find((i) => i.name === norm || i.path === norm || norm.includes(i.name))
        if (!hit) return `未找到页面「${page}」`
        navigate(hit.path)
        return `已跳转到「${hit.name}」（${hit.path}）`
      }
      if (name === 'query_objects') {
        const q = new URLSearchParams({ type: String(args.type ?? '') })
        if (args.keyword) q.set('keyword', String(args.keyword))
        const r = await api<{ type: { name: string }; total: number; objects: { id?: string; values: Record<string, unknown>; links: string[] }[] }>(`/objects?${q}`)
        const lines = r.objects.map((o) => {
          const v = o.values
          const main = String(v.name ?? v.title ?? v.code ?? v.no ?? o.id ?? '')
          const sub = Object.entries(v).slice(1, 4).map(([k, val]) => `${k}=${val}`).join(' ')
          return `· ${main}${sub ? '（' + sub + '）' : ''}${o.links.length ? ` 关联:${o.links.slice(0, 3).join('/')}` : ''}`
        })
        return `「${r.type.name}」共 ${r.total} 个对象，前 ${r.objects.length} 个：\n${lines.join('\n')}`
      }
      if (name === 'ontology_overview') {
        const r = await api<{ types: { name: string; count: number }[]; linkTypes: string[]; actionTypes: { name: string; needsApproval: boolean }[] }>('/objects/types')
        return [
          '对象类型：' + r.types.map((t) => `${t.name}(${t.count})`).join('、'),
          '链接类型：' + r.linkTypes.join('、'),
          '动作类型：' + r.actionTypes.map((a) => a.name + (a.needsApproval ? '（需审批）' : '')).join('、'),
        ].join('\n')
      }
      if (name === 'list_users') {
        const r = await api<{ users: { name: string; account: string; roleName: string; status: string }[] }>('/users')
        return '平台用户：\n' + r.users.map((u) => `· ${u.name}（${u.account}，${u.roleName}，${u.status}）`).join('\n')
      }
      if (name === 'invite_user') {
        const roles = await api<{ roles: { id: string; name: string }[] }>('/roles')
        const role = roles.roles.find((r) => r.name === String(args.role)) ?? roles.roles[0]
        const r = await api<{ user: { name: string; status: string }; invitation: { link: string; sent: boolean; sendError?: string } }>('/users/invite', {
          method: 'POST',
          body: { name: args.name, account: args.account, roleId: role.id, channel: 'link' },
        })
        return `已创建邀请：${r.user.name}（${r.user.status}）。激活链接：${r.invitation.link}`
      }
      if (name === 'list_actions') {
        const r = await api<{ space: { name: string }; actions: { id: string; name: string; desc: string; targetName: string; params: { key: string; name: string; required?: boolean }[]; needsApproval: boolean }[] }>('/actions')
        if (r.actions.length === 0) return `当前空间「${r.space.name}」暂无动作类型`
        return `「${r.space.name}」可执行动作：\n` + r.actions.map((a) => `· ${a.name}（目标：${a.targetName}${a.needsApproval ? '，需审批' : ''}）参数：${a.params.map((p) => p.name + (p.required ? '*' : '')).join('/') || '无'}`).join('\n')
      }
      if (name === 'search_knowledge') {
        const query = String(args.query ?? '')
        const r = await api<{ total: number; results: { docTitle: string; idx: number; text: string; score: number }[]; hint?: string; engine?: string }>(
          `/knowledge/search?q=${encodeURIComponent(query)}&mode=hybrid&limit=4`,
        )
        if (r.total === 0) return r.hint ? `${r.hint}` : `知识库中未找到与「${query}」相关的片段`
        const lines = r.results.map((x, i) => `[${i + 1}] 《${x.docTitle}》第${x.idx + 1}块（相关度 ${x.score}）\n${x.text.slice(0, 220)}`)
        return `知识库检索到 ${r.total} 个相关片段：\n\n${lines.join('\n\n')}`
      }
      if (name === 'ask_clarification') {
        // 不调 API：反问文本作为工具结果展示，候选选项由 send 循环渲染为可点 chips
        const q = String(args.question ?? '能补充一点信息吗？')
        return q
      }
      if (name === 'analyze_objects') {
        // 类型 + 属性定义一起拿：把模型给的中文显示名归一成真实属性 key，避免反复 400
        const typeArg = String(args.typeId ?? '')
        const types = (await api<{ types: { id: string; name: string; properties: { key: string; name: string; type: string }[] }[] }>('/ontology/types')).types ?? []
        const t = types.find((x) => x.id === typeArg || x.name === typeArg || x.name.includes(typeArg) || typeArg.includes(x.name))
        if (!t) return `未找到对象类型「${typeArg}」，当前空间有：${types.map((x) => x.name).join('、')}`
        const props = t.properties ?? []
        const norm = (v: unknown) => {
          const s = String(v ?? '').trim()
          if (!s) return ''
          const p = props.find((x) => x.key === s || x.name === s || x.name.includes(s) || s.includes(x.name))
          return p ? p.key : s
        }
        const groupBy = norm(args.groupBy)
        const metric = norm(args.metric)
        const valid = (k: string) => props.some((p) => p.key === k)
        if (!groupBy || !valid(groupBy)) {
          return `分组字段「${String(args.groupBy ?? '')}」不是「${t.name}」的合法属性。该类型可用字段：${props.map((p) => `${p.name}(${p.key})`).join('、')}。请用这些 key 之一重试，或省略 groupBy 改用「按笔数统计」类问法。`
        }
        // 不显式传 sort/order：让服务端按场景默认（时间序列升序 / 其余按 sum 降序）
        const q = new URLSearchParams({ typeId: t.id, groupBy })
        if (metric && valid(metric)) q.set('metric', metric)
        // 兜底：按日期属性分组但模型漏传 bucket 时，默认按月分桶（避免按天爆炸成海量组）
        if (!args.bucket && props.find((p) => p.key === groupBy && p.type === 'date')) q.set('bucket', 'month')
        const crossBy = norm(args.crossBy)
        if (crossBy) {
          if (!valid(crossBy)) return `交叉维度「${String(args.crossBy ?? '')}」不是「${t.name}」的合法属性。可用字段：${props.map((p) => `${p.name}(${p.key})`).join('、')}。请改用其中之一，或调用 ask_clarification 让用户选择。`
          q.set('crossBy', crossBy)
        }
        for (const k of ['bucket', 'from', 'to', 'compare'] as const) {
          const v = args[k]
          if (v) q.set(k, String(v))
        }
        if (args.top) q.set('top', String(Math.max(1, Math.min(50, Number(args.top) || 5))))
        const r = await api<AnalysisResult & { error?: string }>(`/dashboard/aggregate?${q}`)
        if (r.error) return `分析失败：${r.error}`
        lastAnalysis.current = { groups: r.groups ?? [], groupBy: r.groupBy, metric: r.metric, total: r.total, applied: r.applied ?? {}, compare: r.compare ?? undefined, cross: r.cross ?? undefined }
        // 二维交叉：给 LLM 矩阵文本（行×列 + 合计），让其总结行列规律
        if (r.cross) {
          const cr = r.cross
          const cv = (cell: { sum: number; count: number }) => (cr.metric === 'sum' ? cell.sum : cell.count)
          const matrix = [
            `| ${cr.rowBy.name}＼${cr.colBy.name} | ${cr.columns.join(' | ')} | 合计 |`,
            ...cr.rows.slice(0, 10).map((row) => `| ${row.name} | ${cr.columns.map((c2) => cv(row.cells[c2] ?? { sum: 0, count: 0 })).join(' | ')} | ${cr.metric === 'sum' ? row.rowSum : row.rowCount} |`),
          ].join('\n')
          return `「${t.name}」二维交叉分析（共 ${r.total} 个对象，${cr.rows.length} 行 × ${cr.columns.length} 列，指标=${cr.metric === 'sum' ? (r.metric?.name ?? '求和') + '总和' : '笔数'}）：\n${matrix}\n\n请基于以上真实矩阵总结：哪一行总量最大、哪一列最集中、有无突出的异常单元格。`
        }
        const label = r.metric ? r.metric.name : '笔数'
        const topSuffix = r.applied?.top ? `，取 TOP${String(r.applied.top)}` : ''
        // 时间序列（升序）给最近 12 组并注明，避免 LLM 只总结到最早的旧数据；其余取前 10（降序最大优先）
        const isTs = !!r.applied?.bucket
        const listed = isTs ? (r.groups ?? []).slice(-12) : (r.groups ?? []).slice(0, 10)
        const tsNote = isTs && (r.groups?.length ?? 0) > listed.length ? `（时间升序共 ${r.groups.length} 组，以上为最近 ${listed.length} 组）` : ''
        const lines = listed.map((g, i) => `${i + 1}. ${g.name}：${r.metric ? g.sum : g.count} ${label}（${g.count} 条，均值 ${g.avg}）`)
        let cmpLine = ''
        if (r.compare) {
          const cmp = r.compare
          const v = (o: AnalysisCompare['current']) => (r.metric ? o.sum : o.count)
          const prevName = cmp.mode === 'yoy' ? '去年同期' : '上一期'
          const pct = cmp.deltaPct === null ? '上期无数据，无法算增减幅' : `${cmp.deltaPct >= 0 ? '增长' : '下降'} ${Math.abs(cmp.deltaPct)}%`
          cmpLine = `\n${cmp.mode === 'yoy' ? '同比' : '环比'}（当期 ${cmp.current.from}~${cmp.current.to}，${prevName} ${cmp.previous.from}~${cmp.previous.to}）：本期 ${v(cmp.current)} vs ${prevName} ${v(cmp.previous)}，${pct}。\n请明确给出本期值、上期值与增减百分比。`
        }
        return `「${t.name}」按 ${r.groupBy.name} 分组聚合（共 ${r.total} 个对象，${r.groups?.length ?? 0} 组${topSuffix}）：\n${lines.join('\n')}${tsNote}${cmpLine}\n\n请基于以上真实聚合结果回答，并说明是哪一维度的统计。`
      }
      if (name === 'run_function') {
        // 按名/中文名找函数（已发布或最新版本），真实沙箱执行
        const fnName = String(args.name ?? '')
        const fns = (await api<{ functions: { id: string; name: string; desc: string; publishedVersion?: number }[] }>('/ontology/functions')).functions ?? []
        const fn = fns.find((f) => f.id === fnName || f.name === fnName || f.name.includes(fnName) || fnName.includes(f.name))
        if (!fn) return `未找到函数「${fnName}」，当前空间有：${fns.map((f) => f.name).join('、') || '（无）'}`
        let input: unknown = {}
        try { input = args.input ? JSON.parse(String(args.input)) : {} } catch { return 'input 参数不是合法 JSON，请传如 {"a":1}' }
        const r = await api<{ ok: boolean; result?: unknown; error?: string; version?: number; durationMs?: number }>(`/fn/functions/${fn.id}/run`, { method: 'POST', body: { input } })
        if (!r.ok) return `函数「${fn.name}」执行失败：${r.error}（v${r.version}，${r.durationMs}ms）`
        return `函数「${fn.name}」v${r.version} 执行成功（${r.durationMs}ms）：\n${JSON.stringify(r.result)}\n\n请基于此真实结果回答。`
      }
      if (name === 'run_pipeline') {
        const plName = String(args.name ?? '')
        const pls = (await api<{ pipelines: { id: string; name: string; status: string }[] }>('/p10plus/pipelines')).pipelines ?? []
        const pl = pls.find((p) => p.name === plName || p.name.includes(plName) || plName.includes(p.name))
        if (!pl) return `未找到管道「${plName}」，当前空间有：${pls.map((p) => p.name).join('、') || '（无，可先在「管道构建」页创建）'}`
        const r = await api<{ runId: string; rowsProcessed: number }>(`/p10plus/pipelines/${pl.id}/run`, { method: 'POST' })
        return `管道「${pl.name}」运行成功：处理 ${r.rowsProcessed} 行（运行记录 ${r.runId}，已审计留痕，可在「管道构建」页查看历史）。`
      }
      if (name === 'get_schedule') {
        const action = String(args.action ?? 'view')
        if (action === 'solve') {
          const r = await api<{ planId: string; placed: number; conflicts: unknown[]; metrics?: { utilization?: number; onTimeRate?: number; lateCount?: number } }>('/scheduling/solve', { method: 'POST' })
          return `求解完成：落位 ${r.placed} 个任务，冲突 ${(r.conflicts ?? []).length} 个（方案 ${r.planId}，可在「调度优化」页应用）。利用率 ${r.metrics?.utilization ?? '—'}%，准时率 ${r.metrics?.onTimeRate ?? '—'}%。`
        }
        const m = await api<{ utilization?: number; onTimeRate?: number; lateCount?: number; taskCount?: number; metrics?: { utilization?: number; onTimeRate?: number; lateCount?: number; taskCount?: number } }>('/scheduling/metrics')
        const mm = m.metrics ?? m
        const t = await api<{ tasks?: unknown[] }>('/scheduling/tasks')
        return `当前排程 ${(t.tasks ?? []).length} 个任务：利用率 ${mm.utilization ?? '—'}%，准时率 ${mm.onTimeRate ?? '—'}%，延期 ${mm.lateCount ?? '—'} 个。详见「调度优化」页。`
      }
      if (name === 'governance_scan') {
        const kind = String(args.kind ?? 'scan')
        if (!['scan', 'mask', 'lifecycle'].includes(kind)) return 'kind 仅支持 scan / mask / lifecycle'
        const r = await api<{ result?: string; hitCount?: number; fieldCount?: number; expiredCount?: number; scannedObjects?: number; objectCount?: number }>(`/ops/governance/${kind}`, { method: 'POST', body: {} })
        const summary = r.result ?? (kind === 'scan' ? `扫描 ${r.scannedObjects ?? 0} 个对象，命中 ${r.hitCount ?? 0}` : kind === 'mask' ? `涉及字段 ${r.fieldCount ?? 0}（预览，不改库）` : `到期 ${r.expiredCount ?? 0}`)
        return `治理${kind === 'scan' ? '扫描' : kind === 'mask' ? '脱敏预览' : '生命周期检查'}完成：${summary}（已留痕，可在「安全与标记」页查看执行记录）。`
      }
      if (name === 'manage_scenario') {
        const action = String(args.action ?? 'list')
        const EX = '/explorations/explorations'
        if (action === 'list') {
          const r = await api<{ scenarios: { id: string; name: string; status: string }[] }>(`${EX}/scenarios`)
          return `场景列表（${(r.scenarios ?? []).length} 个）：\n${(r.scenarios ?? []).map((s) => `· ${s.name}（${s.status}，id=${s.id}）`).join('\n') || '（无，可说「建个场景」）'}`
        }
        if (action === 'create') {
          const nm = String(args.name ?? '').trim()
          if (!nm) return '新建场景需要 name 参数'
          const r = await api<{ scenario: { id: string; name: string } }>(`${EX}/scenarios`, { method: 'POST', body: { name: nm, desc: '由智能助手创建' } })
          return `场景「${r.scenario.name}」已创建（id=${r.scenario.id}），可暂存变更后合并。`
        }
        if (action === 'merge' || action === 'discard') {
          const id = String(args.id ?? '')
          if (!id) return `${action} 需要场景 id，可先 list 取`
          const r = await api<{ ok: boolean; summary?: { created: number; updated: number; deleted: number } }>(`${EX}/scenarios/${id}/${action}`, { method: 'POST' })
          return action === 'merge'
            ? `场景已合并，真实写入对象：新建 ${r.summary?.created ?? 0} / 更新 ${r.summary?.updated ?? 0} / 删除 ${r.summary?.deleted ?? 0}（已留痕）。`
            : '场景已放弃，暂存变更未写入。'
        }
        return 'action 仅支持 list / create / merge / discard'
      }
      if (name === 'compare_objects') {
        const split = (v: unknown) => String(v ?? '').split(/[,，]/).map((s) => s.trim()).filter(Boolean)
        const r = await api<{ onlyA?: unknown[]; onlyB?: unknown[]; intersection?: unknown[] }>('/explorations/compare', { method: 'POST', body: { a: split(args.a), b: split(args.b) } })
        return `对象集比较：仅 A ${(r.onlyA ?? []).length} 个 / 仅 B ${(r.onlyB ?? []).length} 个 / 交集 ${(r.intersection ?? []).length} 个。`
      }
      if (name === 'eval_derived') {
        const action = String(args.action ?? 'list')
        const EX = '/explorations/explorations'
        if (action === 'list') {
          const r = await api<{ derived: { id: string; name: string; expr: string }[] }>(`${EX}/derived`)
          return `派生属性（${(r.derived ?? []).length} 个）：\n${(r.derived ?? []).map((d) => `· ${d.name}（${d.expr}，id=${d.id}）`).join('\n') || '（无）'}`
        }
        const nm = String(args.name ?? '')
        const list = await api<{ derived: { id: string; name: string }[] }>(`${EX}/derived`)
        const d = (list.derived ?? []).find((x) => x.id === nm || x.name === nm || x.name.includes(nm))
        if (!d) return `未找到派生属性「${nm}」，可先 list`
        const r = await api<{ values?: { id: string; value: unknown }[] }>(`${EX}/derived/${d.id}/eval`, { method: 'POST' })
        return `派生属性「${d.name}」计算完成，共 ${(r.values ?? []).length} 个对象：\n${(r.values ?? []).slice(0, 8).map((v) => `· ${v.id} = ${String(v.value)}`).join('\n')}`
      }
      if (name === 'apollo_deploy') {
        const action = String(args.action ?? 'view')
        if (action === 'view') {
          const r = await api<{ deployments?: { version: string; env: string; status: string }[] }>('/apollo/deployments')
          return `部署记录（${(r.deployments ?? []).length} 条）：\n${(r.deployments ?? []).slice(0, 8).map((d) => `· ${d.version} ${d.env} ${d.status}`).join('\n') || '（无）'}`
        }
        if (action === 'clusters') {
          const r = await api<{ clusters?: { name: string; version: string; status?: string }[] }>('/apollo/clusters')
          return `集群视图：\n${(r.clusters ?? []).map((c) => `· ${c.name} ${c.version} ${c.status ?? ''}`).join('\n') || '（无）'}`
        }
        if (action === 'deploy') {
          const v = String(args.version ?? '')
          if (!v) return 'deploy 需要 version 参数'
          const r = await api<{ id: string; status: string }>('/apollo/deploy', { method: 'POST', body: { version: v, env: 'dev', message: '由智能助手发起' } })
          return `部署 ${v} 到 dev 成功（${r.status}，id=${r.id}）；如需发布到生产可说「晋升该版本」。`
        }
        const id = String(args.id ?? '')
        if (!id) return `${action} 需要部署记录 id，可先 view 取`
        const r = await api<{ ok: boolean; rollbackToVersion?: string }>(`/apollo/${action}/${id}`, { method: 'POST' })
        return `${action === 'promote' ? '版本晋升' : '回滚'}成功${r.rollbackToVersion ? `，回退到 ${r.rollbackToVersion}` : ''}。`
      }
      if (name === 'collect_timeseries') {
        const key = String(args.valueKey ?? 'health')
        const r = await api<{ inserted?: number; objectCount?: number }>('/ops/timeseries/collect-from-objects', { method: 'POST', body: { metric: `DEMO_${key}`, valueKey: key } })
        const s = await api<{ count?: number; points?: unknown[] }>(`/ops/timeseries/series?metric=DEMO_${key}`)
        return `已从当前空间对象按「${key}」真实采集 ${r.inserted ?? 0} 个采样点（覆盖 ${r.objectCount ?? 0} 个对象，ts_points 落库），序列共 ${s.count ?? (s.points ?? []).length} 个点。`
      }
      if (name === 'sync_source') {
        const action = String(args.action ?? 'list')
        if (action === 'list') {
          const r = await api<{ connections?: { id: string; name: string; type: string; status: string }[] }>('/data-layer/connections')
          return `数据源连接（${(r.connections ?? []).length} 个）：\n${(r.connections ?? []).map((c) => `· ${c.name}（${c.type}，${c.status}，id=${c.id}）`).join('\n') || '（无）'}`
        }
        const nm = String(args.name ?? '')
        const list = await api<{ connections?: { id: string; name: string; type: string }[] }>('/data-layer/connections')
        const c = (list.connections ?? []).find((x) => x.name === nm || x.name.includes(nm))
        if (!c) return `未找到连接「${nm}」，可先 list`
        if (action === 'test') {
          const isFile = ['CSV', 'JSON', 'TXT', 'MD'].includes(c.type)
          const r = await api<{ tableCount?: number; tables?: string[] }>(`/data-layer/connections/${c.id}/${isFile ? 'test-file' : 'test'}`, { method: 'POST' })
          return `连接「${c.name}」探测成功，发现 ${r.tableCount ?? (r.tables ?? []).length} 张表/数据集。`
        }
        const tid = String(args.typeId ?? '')
        if (!tid) return 'sync 需要 typeId（目标对象类型）'
        const isFile = ['CSV', 'JSON', 'TXT', 'MD'].includes(c.type)
        const r = await api<{ created?: number; skipped?: number }>(`/data-layer/connections/${c.id}/${isFile ? 'sync-file' : 'sync'}`, { method: 'POST', body: { table: isFile ? (c.type === 'JSON' ? 'objects' : 'csv') : 'equipment', typeId: tid } })
        return `同步完成：新增 ${r.created ?? 0} 个对象，跳过 ${r.skipped ?? 0} 行（幂等）。`
      }
      if (name === 'decide_approval') {
        const action = String(args.action ?? 'list')
        if (action === 'list') {
          const r = await api<{ approvals?: { id: string; title: string; status: string }[] }>('/actions/approvals/list')
          const pending = (r.approvals ?? []).filter((a) => a.status === '待审批')
          return `待审批单（${pending.length} 个）：\n${pending.map((a) => `· ${a.title}（id=${a.id}）`).join('\n') || '（无待审批）'}`
        }
        const id = String(args.id ?? '')
        if (!id) return `${action} 需要审批单 id，可先 list 取`
        const decision = action === 'approve' ? 'approve' : 'reject'
        const r = await api<{ status: string; result?: unknown }>(`/actions/approvals/${id}/decide`, { method: 'POST', body: { decision, comment: '由智能助手处理' } })
        return `审批单 ${id} 已${decision === 'approve' ? '通过' : '驳回'}（${r.status}），动作${decision === 'approve' ? '已写回' : '已关闭'}并留痕。`
      }
      if (name === 'space_action') {
        const action = String(args.action ?? 'list')
        if (action === 'list') {
          const r = await api<{ spaces?: { id: string; name: string; kind: string }[] }>('/spaces')
          return `当前可访问空间（${(r.spaces ?? []).length} 个）：\n${(r.spaces ?? []).map((s) => `· ${s.name}（${s.kind}，id=${s.id}）`).join('\n')}`
        }
        const sid = getSpaceId()
        const r = await api<{ format?: string; bundle?: unknown }>(`/spaces/${encodeURIComponent(sid)}/export`)
        return `当前空间包已导出（格式 ${r.format ?? 'ontoos.space.bundle'}），可在「应用中心 → 导入空间包」用于迁移/备份。`
      }
      if (name === 'execute_action') {
        const actionName = String(args.action ?? '')
        const r = await api<{ actions: { id: string; name: string; needsApproval: boolean; params: { key: string; name: string }[] }[] }>('/actions')
        const target = r.actions.find((a) => a.name === actionName || a.name.includes(actionName))
        if (!target) return `当前空间未找到动作「${actionName}」，可先问「有哪些动作」`
        let raw: Record<string, unknown> = {}
        try { raw = args.params ? (JSON.parse(String(args.params)) as Record<string, unknown>) : {} } catch { raw = {} }
        // 参数键名归一：模型可能用显示名（如「事由」）作键，映射回真实 key（title）
        const params: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(raw)) {
          const def = target.params.find((p) => p.key === k || p.name === k || k.includes(p.name) || p.key.includes(k))
          params[def ? def.key : k] = v
        }
        const res = await api<{ status: string; message?: string; result?: Record<string, unknown>; approvalId?: string }>(`/actions/${target.id}/execute`, {
          method: 'POST',
          body: { params },
        })
        if (res.status === 'pending_approval') return `${res.message}（审批单 ${res.approvalId}），可在「审批中心」处理`
        const keys = res.result ? Object.entries(res.result).map(([k, v]) => `${k}=${v}`).join(' ') : ''
        return `动作「${target.name}」执行成功${keys ? '：' + keys : ''}（已审计留痕）`
      }
      return `未知工具 ${name}`
    } catch (e) {
      return `执行失败：${e instanceof Error ? e.message : String(e)}`
    }
  }

  async function send(text?: string) {
    const content = (text ?? input).trim()
    if (!content || busy) return
    setInput('')
    setBusy(true)
    const userMsg: UiMsg = { role: 'user', content }
    setMsgs((m) => [...m, userMsg])
    const history: WireMsg[] = [...wire, { role: 'user', content }]

    // 确保有会话并持久化用户消息
    let cid = convId
    try {
      if (!cid) {
        const r = await api<{ id: string }>('/ai/conversations', { method: 'POST', body: { title: content.slice(0, 20) } })
        cid = r.id
        setConvId(cid)
      }
      await api(`/ai/conversations/${cid}/messages`, { method: 'POST', body: { role: 'user', content } })
      loadConvs()
    } catch { /* 会话持久化失败不阻断对话 */ }

    try {
      for (let round = 0; round < 4; round++) {
        const res = await api<{ reply: string; toolCalls?: { id: string; name: string; args: Record<string, unknown> }[] }>('/ai/chat', {
          method: 'POST',
          body: { messages: history, context: { page: location.pathname } },
        })

        if (res.toolCalls?.length) {
          const toolChips: { name: string; arg: string; result: string }[] = []
          const toolWire: WireMsg[] = []
          lastAnalysis.current = null
          let allFailed = true
          for (const tc of res.toolCalls) {
            const result = await runTool(tc.name, tc.args)
            if (!/失败|不存在|不是合法|未找到/.test(result)) allFailed = false
            toolChips.push({ name: tc.name, arg: briefArgs(tc.args), result: result.split('\n')[0].slice(0, 40) })
            toolWire.push({ role: 'tool', content: result, toolCallId: tc.id })
          }
          history.push({ role: 'assistant', content: res.reply || '', toolCalls: res.toolCalls })
          history.push(...toolWire)
          // 中间轮：展示工具链；若本轮含聚合分析，把图表附在这条消息上
          const analysis = lastAnalysis.current ?? undefined
          setMsgs((m) => [...m, { role: 'ai', content: res.reply || '', tools: toolChips, ...(analysis ? { analysis } : {}) }])
          // ask_clarification 是终态：渲染反问与可点选项，等用户点击答复，不回灌模型
          const clarifyCall = res.toolCalls.find((tc) => tc.name === 'ask_clarification')
          if (clarifyCall) {
            const raw = clarifyCall.args.options
            const options = (Array.isArray(raw) ? raw.map(String) : String(raw ?? '').split(/[,，、]/))
              .map((s) => s.trim()).filter(Boolean).slice(0, 6)
            const content = res.reply || String(clarifyCall.args.question ?? '能补充一点信息吗？')
            setMsgs((m) => [...m, { role: 'ai', content, tools: toolChips, ...(options.length ? { clarify: options } : {}) }])
            if (cid) api(`/ai/conversations/${cid}/messages`, { method: 'POST', body: { role: 'assistant', content } }).catch(() => {})
            break
          }
          // navigate 是终态动作（已跳转），不再回灌给模型，避免重复循环同一 toolCall
          if (res.toolCalls.some((tc) => tc.name === 'navigate')) {
            if (cid) api(`/ai/conversations/${cid}/messages`, { method: 'POST', body: { role: 'assistant', content: res.reply || '' } }).catch(() => {})
            break
          }
          // 熔断：同轮全部工具都失败时终止循环，直接把失败原因作为最终回复，不再空转重试
          if (allFailed) {
            const failSummary = toolWire.map((w) => w.content.split('\n')[0]).join('；')
            const reply = `工具调用未成功：${failSummary}。\n\n建议：换一个问法，或告诉我具体的目标对象类型/字段；也可以说「打开 XX」直接去对应页面操作。`
            setMsgs((m) => [...m, { role: 'ai', content: reply }])
            if (cid) api(`/ai/conversations/${cid}/messages`, { method: 'POST', body: { role: 'assistant', content: reply } }).catch(() => {})
            break
          }
          continue
        }

        setMsgs((m) => [...m, { role: 'ai', content: res.reply || '（无回复）' }])
        // 持久化 AI 回复
        if (cid) api(`/ai/conversations/${cid}/messages`, { method: 'POST', body: { role: 'assistant', content: res.reply || '' } }).catch(() => {})
        break
      }
    } catch (e) {
      setMsgs((m) => [...m, { role: 'ai', content: `出错了：${e instanceof Error ? e.message : '请求失败'}` }])
    } finally {
      setWire(history)
      setBusy(false)
    }
  }

  function briefArgs(args: Record<string, unknown>): string {
    return Object.entries(args).map(([k, v]) => `${k}=${String(v).slice(0, 18)}`).join(' ')
  }

  return (
    <>
      {assistOpen && <div className="fixed inset-0 z-40 bg-slate-900/20" onClick={() => setAssistOpen(false)} />}
      <div
        className={`fixed right-0 top-0 z-50 flex h-full w-[430px] max-w-[94vw] flex-col border-l border-slate-200 bg-white shadow-pop transition-transform duration-200 ${
          assistOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-500 text-white">
              <Bot size={16} />
            </div>
            <div>
              <div className="text-sm font-bold text-slate-900">智能助手</div>
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                对话式操作平台 · 查询 · 执行
                <select
                  value={convId ?? ''}
                  onChange={(e) => {
                    if (!e.target.value) {
                      setConvId(null); setMsgs([]); setWire([])
                      api<{ id: string }>('/ai/conversations', { method: 'POST', body: {} }).then((r) => { setConvId(r.id); loadConvs() })
                    } else {
                      setConvId(e.target.value)
                      setWire([])
                    }
                  }}
                  className="max-w-[110px] rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px] text-slate-500"
                >
                  <option value="">＋ 新对话</option>
                  {convs.map((c) => <option key={c.id} value={c.id}>{c.title.slice(0, 12)}</option>)}
                </select>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {engine && <Badge color={engine.configured ? 'green' : 'amber'} dot>{engine.configured ? engine.model : '本地引擎'}</Badge>}
            <button onClick={() => setAssistOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* 消息区 */}
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
          {msgs.length === 0 && (
            <div className="space-y-3 pt-6 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-violet-500 text-white"><Sparkles size={22} /></div>
              <div className="text-sm font-semibold text-slate-700">你好，我可以帮你操作这个平台</div>
              <div className="text-xs leading-5 text-slate-400">页面导航、对象查询、知识检索、动作执行、用户管理<br />分组统计/趋势分析（ChatBI，对话内出图）· 函数/管道/排程/治理</div>
              <div className="space-y-2 pt-2 text-left">
                {suggestionsFor(getSpaceId()).map((s) => (
                  <button key={s} onClick={() => send(s)} className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 hover:border-brand-300 hover:bg-brand-50/50 hover:text-brand-700">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {msgs.map((m, i) => (
            <div key={i} className={cn('flex gap-2.5', m.role === 'user' && 'flex-row-reverse')}>
              <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', m.role === 'ai' ? 'bg-gradient-to-br from-brand-500 to-violet-500 text-white' : 'bg-slate-200 text-slate-600')}>
                {m.role === 'ai' ? <Bot size={16} /> : <User size={15} />}
              </div>
              <div className={cn('max-w-[82%] space-y-2', m.role === 'user' && 'flex flex-col items-end')}>
                {m.tools && m.tools.length > 0 && (
                  <div className="space-y-1.5">
                    {m.tools.map((t, j) => (
                      <div key={j} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-600">
                        <Wrench size={12} className="shrink-0 text-brand-500" />
                        <span className="font-semibold text-slate-700">{t.name}</span>
                        {t.arg && <span className="truncate font-mono text-slate-400">{t.arg}</span>}
                        <span className="ml-auto max-w-[110px] truncate text-emerald-600">→ {t.result}</span>
                      </div>
                    ))}
                  </div>
                )}
                {/* ChatBI：对话内图表（自动选择：时间趋势→折线图 / 枚举占比→饼图 / 其余→条形图）+ 同比环比对比卡 */}
                {m.analysis && (() => {
                  const a = m.analysis
                  const val = (g: ChartData) => (a.metric ? g.sum : g.count)
                  const isTime = !!a.applied?.bucket
                  // 时间序列（升序）展示最近 12 组；其余展示前 8 组（降序最大优先），与给 LLM 的文本口径一致
                  const shown = isTime ? a.groups.slice(-12) : a.groups.slice(0, 8)
                  const isPie = !a.metric && !isTime && shown.length >= 2 && shown.length <= 6
                  const max = Math.max(1, ...shown.map(val))
                  const cmp = a.compare
                  const cmpVal = (o: AnalysisCompare['current']) => (a.metric ? o.sum : o.count)
                  const pieColors = ['#6366f1', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444']
                  return (
                    <div className="w-[320px] max-w-full rounded-xl border border-brand-100 bg-white p-3 shadow-sm">
                      <div className="mb-2 flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-slate-700">
                          {isTime ? '📈 按月趋势' : isPie ? '🥧 占比分布' : '📊 聚合'} · {a.groupBy.name}{a.applied?.top ? ` · TOP${String(a.applied.top)}` : ''}
                        </span>
                        <span className="text-slate-400">{a.total} 个对象 · {a.groups.length} 组</span>
                      </div>
                      {cmp && (
                        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] text-slate-600">
                          <span className="font-semibold text-slate-700">{cmp.mode === 'yoy' ? '同比' : '环比'}</span>
                          <span>本期 <b className="font-mono">{cmpVal(cmp.current)}</b></span>
                          <span className="text-slate-400">{cmp.mode === 'yoy' ? '去年同期' : '上一期'} <b className="font-mono">{cmpVal(cmp.previous)}</b></span>
                          {cmp.deltaPct === null ? <span className="text-slate-400">上期无数据</span> : (
                            <span className={cmp.deltaPct >= 0 ? 'font-semibold text-emerald-600' : 'font-semibold text-red-500'}>
                              {cmp.deltaPct >= 0 ? '↑' : '↓'} {Math.abs(cmp.deltaPct)}%
                            </span>
                          )}
                        </div>
                      )}
                      {a.cross ? (
                        <div className="overflow-x-auto">
                          <table className="w-full border-collapse text-[10px]">
                            <thead>
                              <tr className="text-slate-500">
                                <th className="whitespace-nowrap px-1 py-1 text-left font-medium">{a.cross.rowBy.name}＼{a.cross.colBy.name}</th>
                                {a.cross.columns.map((col) => <th key={col} className="whitespace-nowrap px-1 py-1 text-right font-medium">{col}</th>)}
                                <th className="px-1 py-1 text-right font-medium">合计</th>
                              </tr>
                            </thead>
                            <tbody>
                              {a.cross.rows.map((row) => {
                                const cv = (cell: { sum: number; count: number }) => (a.cross!.metric === 'sum' ? cell.sum : cell.count)
                                const rowMax = Math.max(1, ...a.cross!.columns.map((col) => cv(row.cells[col] ?? { sum: 0, count: 0 })))
                                return (
                                  <tr key={row.name} className="border-t border-slate-100">
                                    <td className="max-w-[72px] truncate whitespace-nowrap px-1 py-1 text-slate-600" title={row.name}>{row.name}</td>
                                    {a.cross!.columns.map((col) => {
                                      const v = cv(row.cells[col] ?? { sum: 0, count: 0 })
                                      return <td key={col} className="px-1 py-1 text-right font-mono tabular-nums" style={{ background: v > 0 ? `rgba(99,102,241,${(0.06 + 0.42 * (v / rowMax)).toFixed(2)})` : '' }}>{v}</td>
                                    })}
                                    <td className="px-1 py-1 text-right font-mono font-semibold tabular-nums text-slate-700">{a.cross!.metric === 'sum' ? row.rowSum : row.rowCount}</td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : isTime ? (
                        <div className="h-[130px] w-full">
                          <LineChart width={292} height={130} data={shown.map((g) => ({ name: g.name, value: val(g) }))} margin={{ top: 6, right: 8, bottom: 0, left: 8 }}>
                            <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#94a3b8' }} interval="preserveStartEnd" tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
                            <YAxis hide />
                            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                            <Line type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={2} dot={false} isAnimationActive={false} />
                          </LineChart>
                        </div>
                      ) : isPie ? (
                        <div className="flex items-center gap-2">
                          <PieChart width={110} height={110}>
                            <Pie data={shown.map((g) => ({ name: g.name, value: val(g) }))} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={26} outerRadius={50} isAnimationActive={false}>
                              {shown.map((_, j) => <Cell key={j} fill={pieColors[j % pieColors.length]} />)}
                            </Pie>
                            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                          </PieChart>
                          <div className="flex-1 space-y-1">
                            {shown.map((g, j) => (
                              <div key={j} className="flex items-center gap-1.5 text-[10px]">
                                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: pieColors[j % pieColors.length] }} />
                                <span className="flex-1 truncate text-slate-600" title={g.name}>{g.name}</span>
                                <span className="font-mono font-semibold text-slate-700">{val(g)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {shown.map((g, j) => (
                            <div key={j} className="flex items-center gap-1.5">
                              <span className="w-16 shrink-0 truncate text-[10px] text-slate-500" title={g.name}>{g.name}</span>
                              <span className="h-3.5 flex-1 overflow-hidden rounded bg-slate-100">
                                <span className="block h-full rounded bg-gradient-to-r from-brand-500 to-violet-500" style={{ width: `${Math.max(3, (val(g) / max) * 100)}%` }} />
                              </span>
                              <span className="w-14 shrink-0 text-right font-mono text-[10px] font-semibold text-slate-700">{Math.round(val(g) * 100) / 100}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="mt-2 border-t border-slate-100 pt-1.5 text-[10px] text-slate-400">
                        指标：{a.metric ? a.metric.name + '总和' : '实例笔数'}{a.applied?.bucket ? ` · 按${String(a.applied.bucket)}分桶` : ''}{a.applied?.from ? ` · ${String(a.applied.from)}~${String(a.applied.to)}` : ''} · 来源 /dashboard/aggregate
                      </div>
                    </div>
                  )
                })()}
                {m.content && (
                  <div className={cn('whitespace-pre-wrap rounded-xl px-3.5 py-2.5 text-[13px] leading-6', m.role === 'ai' ? 'bg-slate-50 text-slate-700' : 'bg-brand-600 text-white')}>
                    {m.content}
                  </div>
                )}
                {m.cites && m.cites.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <FileSearch size={12} className="text-slate-400" />
                    {m.cites.map((ct, j) => (
                      <span key={j} className="rounded border border-brand-200 bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700">{ct}</span>
                    ))}
                  </div>
                )}
                {/* ask_clarification 反问的候选选项：点击即作为用户答复发送 */}
                {m.clarify && m.clarify.length > 0 && (
                  <div className="flex max-w-full flex-wrap gap-1.5">
                    {m.clarify.map((opt, j) => (
                      <button
                        key={j}
                        onClick={() => send(opt)}
                        className="rounded-full border border-brand-300 bg-white px-2.5 py-1 text-[11px] font-medium text-brand-700 shadow-sm transition-colors hover:bg-brand-50"
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {busy && (
            <div className="flex gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-violet-500 text-white"><Bot size={16} /></div>
              <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3.5 py-2.5 text-[13px] text-slate-400">
                <Loader2 size={14} className="animate-spin" /> 思考与执行中…
              </div>
            </div>
          )}
        </div>

        {/* 输入区 */}
        <div className="border-t border-slate-100 p-3">
          {/* 快捷示例：发消息后换行常驻（全部可见，不靠横向滚动）；空会话由欢迎区大列表展示 */}
          {msgs.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {suggestionsFor(getSpaceId()).map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  disabled={busy}
                  title={s}
                  className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) send() }}
              placeholder={engine?.configured ? '向智能助手提问或下达指令…' : '试试：打开 审批中心 / 查询设备 / 平台有哪些用户'}
              className="flex-1 bg-transparent text-[13px] text-slate-800 placeholder:text-slate-400 focus:outline-none"
            />
            <button onClick={() => send()} disabled={busy || !input.trim()} className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-white disabled:opacity-40">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            </button>
          </div>
          <div className="mt-1.5 px-1 text-[10px] text-slate-400">
            工具调用均在你的权限内执行（{engine?.configured ? `模型 ${engine.model}` : '未配置 AI，本地引擎'}）
          </div>
        </div>
      </div>
    </>
  )
}
