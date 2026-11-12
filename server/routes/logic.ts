import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, tables } from '../db'
import { requireAuth } from '../auth'
import { resolveSpace, type SpaceInfo } from '../space'
import { llmComplete } from './ai'
import type { SessionUser } from '../../shared/types'

/** AIP Logic 工作流持久化 + 真实分支执行引擎 */

interface WorkflowStep {
  id: string
  type: 'input' | 'llm' | 'condition' | 'output'
  label: string
  prompt?: string
  model?: string
  condition?: string
  outputFormat?: string
}
interface Workflow { id: string; name: string; steps: WorkflowStep[]; updatedAt: number }

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

/** 工作流列表 */
logicRoutes.get('/workflows', (c) => {
  const space = c.get('space')
  return c.json({ workflows: readWorkflows(space.id) })
})

/** 新建/更新工作流 */
logicRoutes.post('/workflows', async (c) => {
  const space = c.get('space')
  const user = c.get('user')
  const body = await c.req.json<{ id?: string; name: string; steps: WorkflowStep[] }>()
  if (!body.name?.trim()) return c.json({ error: '请填写名称' }, 400)
  const list = readWorkflows(space.id)
  const id = body.id ?? `WF-${Date.now().toString(36).toUpperCase()}`
  const wf: Workflow = { id, name: body.name.trim(), steps: body.steps ?? [], updatedAt: Date.now() }
  const next = body.id ? list.map((w) => (w.id === body.id ? wf : w)) : [...list, wf]
  writeWorkflows(space.id, next)
  db.insert(tables.auditEvents).values({
    id: `AE-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    actor: user.name, action: body.id ? '更新工作流' : '新建工作流', target: body.name, ip: '本地', createdAt: Date.now(),
  }).run()
  return c.json({ id })
})

/** 删除工作流 */
logicRoutes.delete('/workflows/:id', (c) => {
  const space = c.get('space')
  const id = c.req.param('id') as string
  writeWorkflows(space.id, readWorkflows(space.id).filter((w) => w.id !== id))
  return c.json({ ok: true })
})

/**
 * 真实执行工作流：按步骤逐步执行
 * - llm 步骤：调用 LLM 处理上一步输出
 * - condition 步骤：解析 "字段 操作符 值" 或 "置信度 > 0.8"，按结果走不同分支
 * - 返回每步的输入/输出/分支结果
 */
interface StepResult { step: string; type: string; input: string; output: string; branch?: string }
logicRoutes.post('/workflows/:id/run', async (c) => {
  const space = c.get('space')
  const id = c.req.param('id') as string
  const wf = readWorkflows(space.id).find((w) => w.id === id)
  if (!wf) return c.json({ error: '工作流不存在' }, 404)
  const body = await c.req.json<{ input: string }>()
  const input = body.input ?? ''
  const results: StepResult[] = []
  let ctx = input
  let conditionResult: boolean | null = null

  for (const step of wf.steps) {
    const stepInput = ctx
    if (step.type === 'input') {
      results.push({ step: step.label, type: step.type, input, output: ctx })
      continue
    }
    if (step.type === 'llm') {
      try {
        const prompt = [
          step.prompt || '处理输入并输出结构化结果。',
          conditionResult === false ? '【条件分支结果为否：请保守处理，标注需人工复核】' : '',
          `\n输入数据：\n${ctx}`,
        ].filter(Boolean).join('\n')
        ctx = await llmComplete('你是工作流中的一个处理节点。输出简洁、结构化，不要解释。', prompt)
      } catch (e) {
        return c.json({ error: `节点「${step.label}」执行失败：${e instanceof Error ? e.message : '未知'}`, results }, 502)
      }
      results.push({ step: step.label, type: step.type, input: stepInput.slice(0, 120), output: ctx.slice(0, 400) })
      continue
    }
    if (step.type === 'condition') {
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
      continue
    }
    if (step.type === 'output') {
      results.push({ step: step.label, type: step.type, input: stepInput.slice(0, 120), output: ctx.slice(0, 500) })
    }
  }

  db.insert(tables.auditEvents).values({
    id: `AE-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    actor: c.get('user').name, action: '运行工作流', target: wf.name, ip: '本地', createdAt: Date.now(),
  }).run()
  return c.json({ workflow: wf.name, results, final: ctx })
})
