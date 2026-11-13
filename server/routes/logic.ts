import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, tables } from '../db'
import { requireAuth } from '../auth'
import { resolveSpace, type SpaceInfo } from '../space'
import { llmComplete } from './ai'
import { WORKFLOW_PRESETS, PRESET_IDS, findPreset, type WorkflowStep } from '../../shared/workflowTemplates'
import type { SessionUser } from '../../shared/types'

/** 工作流编排 工作流持久化 + 预设模板 + 真实分支执行引擎 */

interface Workflow { id: string; name: string; steps: WorkflowStep[]; updatedAt: number; desc?: string; tag?: string; sampleInput?: string; needsLlm?: boolean; preset?: boolean }

type Ctx = { Variables: { user: SessionUser; space: SpaceInfo } }

function readWorkflows(spaceId: string): Workflow[] {
  const row = db.select().from(tables.settings).where(eq(tables.settings.key, `logic_workflows_${spaceId}`)).get()
  return (row?.value as unknown as { workflows?: Workflow[] })?.workflows ?? []
}
function writeWorkflows(spaceId: string, workflows: Workflow[]) {
  const key = `logic_workflows_${spaceId}`
  const value = { workflows }
  const now = Date.now()
  const existing = db.select().from(tables.settings).where(eq(tables.settings.key, key)).get()
  if (existing) db.update(tables.settings).set({ value, updatedAt: now }).where(eq(tables.settings.key, key)).run()
  else db.insert(tables.settings).values({ key, value, updatedAt: now }).run()
}

export const logicRoutes = new Hono<Ctx>()
logicRoutes.use('*', requireAuth)
logicRoutes.use('*', async (c, next) => {
  const user = c.get('user')
  const space = resolveSpace(c, user)
  if (!space) return c.json({ error: '尚无可访问的本体空间' }, 403)
  c.set('space', space)
  await next()
})

/** 工作流列表：用户工作流 + 产品预设模板（预设不落库，随版本更新） */
logicRoutes.get('/workflows', (c) => {
  const space = c.get('space')
  const user = readWorkflows(space.id)
  const presets: Workflow[] = WORKFLOW_PRESETS.map((p) => ({
    id: p.id, name: p.name, desc: p.desc, tag: p.tag, sampleInput: p.sampleInput,
    needsLlm: p.needsLlm, preset: true, steps: p.steps, updatedAt: 0,
  }))
  return c.json({ workflows: [...user, ...presets] })
})

/** 新建/更新工作流 */
logicRoutes.post('/workflows', async (c) => {
  const space = c.get('space')
  const user = c.get('user')
  const body = await c.req.json<{ id?: string; name: string; steps: WorkflowStep[] }>()
  if (!body.name?.trim()) return c.json({ error: '请填写名称' }, 400)
  const steps = body.steps ?? []
  if (!Array.isArray(steps) || steps.length === 0) return c.json({ error: '至少需要一个节点' }, 400)
  if (new Set(steps.map((s) => s.id)).size !== steps.length) return c.json({ error: '节点 id 重复' }, 400)
  const validTypes = new Set(['input', 'llm', 'condition', 'transform', 'output'])
  if (steps.some((s) => !validTypes.has(s.type))) return c.json({ error: '存在未知节点类型' }, 400)
  // 分支目标必须指向存在的节点，避免运行时断链
  for (const s of steps) {
    for (const target of [s.nextYes, s.nextNo]) {
      if (target && !steps.some((x) => x.id === target)) return c.json({ error: `节点「${s.label}」的分支目标 ${target} 不存在` }, 400)
    }
  }
  const list = readWorkflows(space.id)
  // 保存预设模板时自动「另存为副本」，不覆盖产品内置模板
  const fromPreset = !!body.id && PRESET_IDS.has(body.id)
  const id = body.id && !fromPreset ? body.id : `WF-${Date.now().toString(36).toUpperCase()}`
  // 同名幂等：load.mjs 等脚本重复装载时不叠加（同名视为更新，保留原 id）
  const sameName = list.find((w) => w.name === body.name.trim() && w.id !== id)
  const finalId = !body.id || fromPreset ? (sameName && !fromPreset ? sameName.id : id) : id
  const wfName = fromPreset ? `${body.name.trim()} 副本` : body.name.trim()
  const wf: Workflow = { id: finalId, name: wfName, steps, updatedAt: Date.now() }
  const next = list.some((w) => w.id === finalId) ? list.map((w) => (w.id === finalId ? wf : w)) : [...list, wf]
  writeWorkflows(space.id, next)
  db.insert(tables.auditEvents).values({
    id: `AE-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    actor: user.name, action: fromPreset ? '另存预设为工作流' : (body.id || sameName ? '更新工作流' : '新建工作流'), target: wfName, ip: '本地', createdAt: Date.now(),
  }).run()
  return c.json({ id: finalId })
})

/** 删除工作流 */
logicRoutes.delete('/workflows/:id', (c) => {
  const space = c.get('space')
  const id = c.req.param('id') as string
  writeWorkflows(space.id, readWorkflows(space.id).filter((w) => w.id !== id))
  return c.json({ ok: true })
})

/**
 * 真实执行工作流：按节点连线逐步执行（条件节点按 nextYes/nextNo 跳转，否则按数组顺序）
 * - llm 步骤：调用 LLM 处理上一步输出
 * - condition 步骤：解析 "字段 操作符 值" 或 "置信度 > 0.8"，按结果走不同分支
 * - 返回每步的输入/输出/分支结果；防环上限 20 步
 */
interface StepResult { step: string; type: string; input: string; output: string; branch?: string }
logicRoutes.post('/workflows/:id/run', async (c) => {
  const space = c.get('space')
  const id = c.req.param('id') as string
  const preset = findPreset(id)
  const wf: Workflow | undefined = preset
    ? { id: preset.id, name: preset.name, steps: preset.steps, updatedAt: 0 }
    : readWorkflows(space.id).find((w) => w.id === id)
  if (!wf) return c.json({ error: '工作流不存在' }, 404)
  const body = await c.req.json<{ input: string }>()
  const input = body.input ?? ''
  const results: StepResult[] = []
  let ctx = input
  let conditionResult: boolean | null = null
  const byId = new Map(wf.steps.map((s) => [s.id, s]))
  const visited = new Set<string>()
  let current: WorkflowStep | undefined = wf.steps[0]

  for (let count = 0; current && count < 20; count++) {
    const step: WorkflowStep = current
    if (visited.has(step.id)) break // 防环
    visited.add(step.id)
    const stepInput = ctx
    let nextId: string | undefined
    const idx = wf.steps.findIndex((s) => s.id === step.id)
    const inOrderNext = idx >= 0 && idx + 1 < wf.steps.length ? wf.steps[idx + 1].id : undefined

    if (step.type === 'input') {
      results.push({ step: step.label, type: step.type, input, output: ctx })
      nextId = inOrderNext
    } else if (step.type === 'transform') {
      // 本地确定性转换：extract 提取数值字段并写入上下文（供条件节点解析）；keyword 追加命中标记；format 格式化
      if (step.transform === 'extract' && step.field) {
        const m = ctx.match(new RegExp(`${step.field}[^0-9-]{0,8}([0-9]+(?:\\.[0-9]+)?)`))
        const value = m ? m[1] : '0'
        ctx = `${ctx}\n${step.field}: ${value}`
        results.push({ step: step.label, type: step.type, input: stepInput.slice(0, 120), output: `提取 ${step.field} = ${value}` })
      } else if (step.transform === 'keyword') {
        const words = (step.words ?? '').split(/[,，]/).map((w) => w.trim()).filter(Boolean)
        const hit = words.filter((w) => ctx.includes(w))
        ctx = `${ctx}\n命中: ${hit.length > 0 ? '是' : '否'}${hit.length ? `（${hit.join('、')}）` : ''}`
        results.push({ step: step.label, type: step.type, input: stepInput.slice(0, 120), output: hit.length ? `命中关键词：${hit.join('、')}` : '未命中关键词' })
      } else {
        ctx = `【${step.label}】\n${ctx}`
        results.push({ step: step.label, type: step.type, input: stepInput.slice(0, 120), output: '已格式化输出' })
      }
      nextId = inOrderNext
    } else if (step.type === 'llm') {
      try {
        const prompt = [
          step.prompt || '处理输入并输出结构化结果。',
          conditionResult === false ? '【条件分支结果为否：请保守处理，标注需人工复核】' : '',
          `\n输入数据：\n${ctx}`,
        ].filter(Boolean).join('\n')
        ctx = await llmComplete('你是工作流中的一个处理节点。输出简洁、结构化，不要解释。', prompt)
      } catch (e) {
        // 网关不可用：降级为规则摘要，保证工作流仍能跑出结果（不假装 LLM 成功）
        const reason = e instanceof Error ? e.message : '未知'
        ctx = `【LLM 节点降级】AI 网关暂不可用（${reason}），以下为基于输入数据的规则摘要：\n${ctx}\n建议：1) 核对设备维护记录 2) 检查关联维修工单 3) 安排人工复核`
        results.push({ step: step.label, type: step.type, input: stepInput.slice(0, 120), output: `AI 网关不可用，已降级为规则摘要（${reason.slice(0, 60)}）`, branch: 'degraded' })
        nextId = inOrderNext
        current = nextId ? byId.get(nextId) : undefined
        continue
      }
      results.push({ step: step.label, type: step.type, input: stepInput.slice(0, 120), output: ctx.slice(0, 400) })
      nextId = inOrderNext
    } else if (step.type === 'condition') {
      // 解析条件：如 "置信度 > 0.8" / "amount >= 100"
      const m = (step.condition ?? '').match(/(.+?)\s*(>=|<=|>|<|==|=|包含|不包含)\s*(.+)/)
      if (m) {
        const left = m[1].trim()
        const op = m[2]
        const right = m[3].trim()
        // 从上一步输出里找字段值
        const fieldMatch = ctx.match(new RegExp(`${left}[:：=\\s]*([0-9.]+)`))
        const lv = fieldMatch ? Number(fieldMatch[1]) : NaN
        const rv = Number(right)
        if (!Number.isNaN(lv) && !Number.isNaN(rv)) {
          conditionResult = op === '>' ? lv > rv : op === '<' ? lv < rv : op === '>=' ? lv >= rv : op === '<=' ? lv <= rv : lv === rv
        } else if (right === '命中' || right === '是' || right === 'yes') {
          // transform keyword 写入的「命中: 是/否」标记
          conditionResult = /命中:\s*是/.test(ctx) || (right !== '命中' && ctx.includes('命中: 是'))
        } else {
          conditionResult = op === '不包含' ? !ctx.includes(right) : ctx.includes(right)
        }
      } else {
        // 无明确表达式：让 LLM 判断
        try {
          const verdict = await llmComplete('你是条件判断节点。只回复"是"或"否"。', `条件：${step.condition}\n数据：${ctx.slice(0, 1000)}`)
          conditionResult = verdict.includes('是')
        } catch { conditionResult = true }
      }
      results.push({ step: step.label, type: step.type, input: stepInput.slice(0, 120), output: conditionResult ? '是 → 走主分支' : '否 → 走人工复核分支', branch: conditionResult ? 'yes' : 'no' })
      // 按分支目标跳转；留空则按数组顺序继续
      nextId = conditionResult ? (step.nextYes ?? inOrderNext) : (step.nextNo ?? inOrderNext)
    } else {
      // output 为终点：不再按数组顺序继续（否则分支两出口会串行执行）
      results.push({ step: step.label, type: step.type, input: stepInput.slice(0, 120), output: ctx.slice(0, 500) })
      nextId = step.nextYes
    }
    current = nextId ? byId.get(nextId) : undefined
  }

  db.insert(tables.auditEvents).values({
    id: `AE-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    actor: c.get('user').name, action: '运行工作流', target: wf.name, ip: '本地', createdAt: Date.now(),
  }).run()
  return c.json({ workflow: wf.name, results, final: ctx })
})
