import { db, tables } from '../db'

/**
 * 业务术语 / 认证指标解析（借鉴 NVIDIA auto-ontology 的语义层）
 * 独立模块避免 ai.ts ↔ ontology.ts 循环依赖。
 */
export interface ResolvedTerm {
  term: string
  typeId: string
  propertyKey: string
  metricExpr: string
  certified: boolean
}

export interface TermView {
  id: string
  term: string
  synonyms: string[]
  typeId: string
  propertyKey: string
  definition: string
  metricExpr: string
  certified: boolean
  typeName: string
  updatedAt: string
}

export function listTerms(spaceId: string): TermView[] {
  const types = db.select().from(tables.objectTypes).all().filter((t) => t.spaceId === spaceId)
  const typeMap = new Map(types.map((t) => [t.id, t.name]))
  return db.select().from(tables.ontologyTerms).all()
    .filter((r) => r.spaceId === spaceId)
    .sort((a, b) => Number(b.certified) - Number(a.certified) || b.updatedAt - a.updatedAt)
    .map((r) => ({
      id: r.id, term: r.term, synonyms: r.synonyms, typeId: r.typeId,
      propertyKey: r.propertyKey, definition: r.definition, metricExpr: r.metricExpr,
      certified: r.certified === 1,
      typeName: r.typeId ? (typeMap.get(r.typeId) ?? r.typeId) : '跨类型',
      updatedAt: new Date(r.updatedAt).toLocaleString('zh-CN', { hour12: false }),
    }))
}

/** 把问题里的口语/同义词命中到已认证术语（问法→可信口径） */
export function resolveTerms(text: string, spaceId: string): ResolvedTerm[] {
  const lower = text.toLowerCase()
  return listTerms(spaceId)
    .filter((r) => r.certified)
    .filter((r) => [r.term, ...r.synonyms].some((w) => w && lower.includes(w.toLowerCase())))
    .map((r) => ({ term: r.term, typeId: r.typeId, propertyKey: r.propertyKey, metricExpr: r.metricExpr, certified: true }))
}

/** 可信术语清单（注入 LLM system prompt，让模型按认证口径回答） */
export function certifiedTermDigest(spaceId: string): string {
  return listTerms(spaceId)
    .filter((r) => r.certified)
    .map((r) => `· ${r.term}${r.synonyms.length ? `（同义：${r.synonyms.join('/')}）` : ''} → ${r.typeName}${r.propertyKey ? `.${r.propertyKey}` : ''}${r.metricExpr ? `，口径：${r.metricExpr}` : ''}${r.definition ? `：${r.definition}` : ''}`)
    .join('\n')
}

/**
 * 不可回答判定（借鉴 auto-ontology 的 check_answerable）：
 * 仅当空间有已认证术语、用户问的是「数据/指标类」问题、且一个术语都没命中时才拒答。
 * 导航 / 帮助 / 闲聊 / 尚无术语的空间一律放行，避免误伤。
 */
// 需要「认证口径」才可信的指标/聚合类问法；查询对象明细、导航、帮助一律不在此列
const METRIC_QUESTION = /(总额|合计|金额|营收|收入|成本|费用|指标|统计|趋势|排名|占比|分布|利润率|转化率|增长率|有多少|平均|最多|最大|画个图|图表)/
// 明细查询 / 导航 / 帮助 / 闲聊：走工具或本地引擎，不需要口径，优先放行
const PLAIN_ACTION = /(查询|看看|列出|有哪些|列表|搜索|打开|进入|去|跳转|帮助|怎么用|能做什么|查一下|找出)/

export function semanticGuard(text: string, spaceId: string): { blocked: boolean; reply?: string } {
  const all = listTerms(spaceId).filter((r) => r.certified)
  if (all.length === 0) return { blocked: false }
  if (!METRIC_QUESTION.test(text)) return { blocked: false }
  if (resolveTerms(text, spaceId).length > 0) return { blocked: false }
  // 明细查询（如「查询设备 "M-2041"」）与导航/帮助走工具，不需要业务口径
  if (PLAIN_ACTION.test(text)) return { blocked: false }
  // ChatBI 分组聚合走「对象已定义属性」而非自由指标口径，有明确统计维度/对比/交叉/TOP 问法时放行给 analyze_objects
  if (/(统计|聚合|占比|分布|趋势|环比|同比|按.{0,10}看|按.*(分组|统计|分析|汇总|对比)|各.*(多少|花费)|TOP\s*\d|前\s*\d+\s*[个条名]|最大[的]?\s*\d|画个图|图表)/.test(text)) return { blocked: false }
  return {
    blocked: true,
    reply: `当前本体空间还没有能回答「${text.slice(0, 40)}」的可信业务定义，为避免给出错误口径，我不做猜测。\n\n已认证的业务术语/指标有：${all.map((r) => r.term).join('、')}。\n你也可以换个问法（使用上面的术语或其同义词），或到「本体管理器 → 业务术语」补充定义并认证。`,
  }
}
