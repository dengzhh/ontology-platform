import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileText, Sparkles, Braces, Loader2, X, Check, Upload, CircleAlert, ArrowRight } from 'lucide-react'
import Btn from '@/components/ui/Btn'
import { Badge } from '@/components/ui/Badge'
import { Field } from '@/components/ui/Form'
import { api } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'

interface CandProp {
  name: string
  key: string
  type: string
  required?: boolean
  enumValues?: string[]
}
interface CandType {
  name: string
  desc?: string
  properties: CandProp[]
}
interface CandLink {
  name: string
  source: string
  target: string
  cardinality?: string
  desc?: string
}
interface Candidates {
  objectTypes: CandType[]
  linkTypes: CandLink[]
}

const SAMPLE_JSON = `{
  "objectTypes": [
    { "name": "仓库", "desc": "成品与原材料仓储点", "properties": [
      { "name": "仓库编码", "key": "code", "type": "string", "required": true },
      { "name": "仓库名称", "key": "name", "type": "string" },
      { "name": "类型", "key": "kind", "type": "enum", "enumValues": ["成品仓", "原料仓", "中转仓"] }
    ] },
    { "name": "库存记录", "desc": "物料在仓库的实时库存", "properties": [
      { "name": "物料编码", "key": "material", "type": "string", "required": true },
      { "name": "数量", "key": "qty", "type": "number" },
      { "name": "更新时间", "key": "updatedAt", "type": "date" }
    ] }
  ],
  "linkTypes": [
    { "name": "库存所在仓库", "source": "库存记录", "target": "仓库", "cardinality": "N:1" }
  ]
}`

/** 导入本体：文档智能识别（LLM） / JSON 导入 → 候选审核 → 批量入库 */
export default function ImportModal({
  open,
  onClose,
  existingTypeNames,
  onCommitted,
}: {
  open: boolean
  onClose: () => void
  existingTypeNames: string[]
  onCommitted: () => void
}) {
  const aiStatus = useApi<{ configured: boolean; model: string }>('/ai/status')
  const [tab, setTab] = useState<'ai' | 'json'>('ai')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [cands, setCands] = useState<Candidates | null>(null)
  const [skip, setSkip] = useState<Record<string, boolean>>({})
  const [commitBusy, setCommitBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  if (!open) return null
  const aiConfigured = aiStatus.data?.configured ?? false

  function reset() {
    setText('')
    setError('')
    setCands(null)
    setSkip({})
    setBusy(false)
    setCommitBusy(false)
  }

  async function runExtract() {
    if (text.trim().length < 20) return setError('请粘贴至少 20 字的文档内容')
    setBusy(true)
    setError('')
    try {
      const res = await api<{ candidates: Candidates }>('/ontology/extract', { method: 'POST', body: { text } })
      if (res.candidates.objectTypes.length === 0) return setError('未能从文档中识别出对象类型，请补充文档内容或改用 JSON 导入')
      setCands(res.candidates)
    } catch (e) {
      const err = e instanceof Error ? e.message : '识别失败'
      setError(err === 'AI_NOT_CONFIGURED' ? '' : err)
      if (err === 'AI_NOT_CONFIGURED') setTab('json')
    } finally {
      setBusy(false)
    }
  }

  function parseJson() {
    setError('')
    try {
      const cleaned = text.replace(/```json|```/g, '').trim()
      const start = cleaned.indexOf('{')
      const end = cleaned.lastIndexOf('}')
      const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Candidates
      if (!Array.isArray(parsed.objectTypes) || parsed.objectTypes.length === 0) return setError('JSON 中未找到 objectTypes')
      setCands({
        objectTypes: parsed.objectTypes.filter((t) => t?.name),
        linkTypes: Array.isArray(parsed.linkTypes) ? parsed.linkTypes.filter((l) => l?.name && l?.source && l?.target) : [],
      })
    } catch {
      setError('JSON 解析失败，请检查格式（可点「填入示例」参考）')
    }
  }

  function isTypeSelected(t: CandType) {
    if (existingTypeNames.includes(t.name)) return false // 同名已存在 → 必然跳过
    return !skip[`t:${t.name}`]
  }

  async function commit() {
    if (!cands) return
    setCommitBusy(true)
    const nameToId = new Map<string, string>()
    let okTypes = 0
    let skipTypes = 0
    let okLinks = 0
    let skipLinks = 0
    const errs: string[] = []

    for (const t of cands.objectTypes) {
      if (!isTypeSelected(t)) { skipTypes++; continue }
      try {
        const res = await api<{ type: { id: string; name: string } }>('/ontology/types', {
          method: 'POST',
          body: { name: t.name, desc: t.desc ?? '', properties: t.properties },
        })
        nameToId.set(t.name, res.type.id)
        okTypes++
      } catch (e) {
        skipTypes++
        errs.push(`${t.name}: ${e instanceof Error ? e.message : '失败'}`)
      }
    }
    for (const l of cands.linkTypes) {
      const src = nameToId.get(l.source)
      const dst = nameToId.get(l.target)
      if (!src || !dst) { skipLinks++; continue }
      try {
        await api('/ontology/links', { method: 'POST', body: { name: l.name, sourceTypeId: src, targetTypeId: dst, cardinality: l.cardinality ?? '1:N', desc: l.desc ?? '' } })
        okLinks++
      } catch {
        skipLinks++
      }
    }

    setCommitBusy(false)
    onCommitted()
    alert(`导入完成：新增类型 ${okTypes} 个（跳过 ${skipTypes}）、链接 ${okLinks} 条（跳过 ${skipLinks}）${errs.length ? '\n' + errs.slice(0, 3).join('\n') : ''}\n（全部变更已审计留痕）`)
    reset()
    onClose()
  }

  function readFile(f: File) {
    const reader = new FileReader()
    reader.onload = () => setText(String(reader.result ?? ''))
    reader.readAsText(f, 'utf-8')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[90vh] w-[760px] max-w-[94vw] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-pop" onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="text-base font-bold text-slate-900">导入本体</div>
          <button onClick={() => { reset(); onClose() }} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={16} /></button>
        </div>

        {/* 输入阶段 */}
        {!cands && (
          <div className="flex-1 overflow-y-auto p-5">
            <div className="mb-4 flex w-fit rounded-lg bg-slate-100 p-1">
              <button onClick={() => setTab('ai')} className={cn('flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium', tab === 'ai' ? 'bg-white text-brand-700 shadow-card' : 'text-slate-500')}>
                <Sparkles size={13} /> 文档智能识别 {aiConfigured ? '' : '（需配置 AI）'}
              </button>
              <button onClick={() => setTab('json')} className={cn('flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium', tab === 'json' ? 'bg-white text-brand-700 shadow-card' : 'text-slate-500')}>
                <Braces size={13} /> JSON 导入
              </button>
            </div>

            {tab === 'ai' && !aiConfigured && (
              <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-xs leading-5 text-amber-700">
                <CircleAlert size={15} className="mt-0.5 shrink-0" />
                <div>
                  文档智能识别需要大模型支持。请先到{' '}
                  <Link to="/admin/control" className="font-semibold underline">控制面板 → AI 服务</Link>
                  {' '}配置 OpenAI 兼容接口（可用自建网关），配置后即可从任意业务文档自动识别对象类型与关系；当前可先用 JSON 导入。
                </div>
              </div>
            )}

            <Field
              label={tab === 'ai' ? '文档内容' : '本体 JSON'}
              hint={tab === 'ai' ? '粘贴业务文档（制度/说明/需求），识别结果经审核后入库' : '标准格式：objectTypes + linkTypes，可点「填入示例」'}
            >
              <div className="relative">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={tab === 'ai' ? '例如：仓库管理制度——成品仓库按区域划分为 A/B/C 区，每条库存记录包含物料编码、批次、数量与更新时间，物料由指定供应商提供……' : SAMPLE_JSON.slice(0, 60) + '…'}
                  className="h-52 w-full resize-none rounded-lg border border-slate-200 bg-white p-3 font-mono text-xs leading-5 text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                />
              </div>
            </Field>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input ref={fileRef} type="file" accept=".txt,.md,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f) }} />
              <Btn size="sm" onClick={() => fileRef.current?.click()}><Upload size={12} /> 读取 .txt / .md 文件</Btn>
              {tab === 'json' && <Btn size="sm" onClick={() => setText(SAMPLE_JSON)}>填入示例</Btn>}
              <span className="ml-auto" />
              {tab === 'ai' ? (
                <Btn size="sm" variant="primary" disabled={busy || !aiConfigured} onClick={runExtract}>
                  {busy ? <><Loader2 size={13} className="animate-spin" /> 识别中…</> : <><Sparkles size={13} /> 开始识别</>}
                </Btn>
              ) : (
                <Btn size="sm" variant="primary" disabled={busy || !text.trim()} onClick={parseJson}><Braces size={13} /> 解析 JSON</Btn>
              )}
            </div>
            {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}
          </div>
        )}

        {/* 审核阶段 */}
        {cands && (
          <div className="flex-1 overflow-y-auto p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-slate-900">候选审核（{cands.objectTypes.filter(isTypeSelected).length}/{cands.objectTypes.length} 类型将入库）</div>
                <div className="mt-0.5 text-xs text-slate-400">识别结果仅供审核，勾选后才会写入系统；同名已有类型自动跳过</div>
              </div>
              <Btn size="sm" onClick={() => setCands(null)}>返回重识别</Btn>
            </div>

            <div className="space-y-2.5">
              {cands.objectTypes.map((t) => {
                const exists = existingTypeNames.includes(t.name)
                const sel = isTypeSelected(t)
                return (
                  <button
                    key={t.name}
                    disabled={exists}
                    onClick={() => setSkip({ ...skip, [`t:${t.name}`]: sel })}
                    className={cn('flex w-full items-start gap-3 rounded-xl border p-3.5 text-left transition-colors', exists ? 'border-slate-100 bg-slate-50/60 opacity-70' : sel ? 'border-brand-300 bg-brand-50/40' : 'border-slate-200')}
                  >
                    <div className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border', sel ? 'border-brand-500 bg-brand-500 text-white' : 'border-slate-300 bg-white')}>
                      {sel && <Check size={13} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[14px] font-bold text-slate-800">{t.name}</span>
                        {exists ? <Badge color="slate">同名已存在 · 跳过</Badge> : <Badge color="blue">{t.properties.length} 个属性</Badge>}
                      </div>
                      {t.desc && <div className="mt-0.5 text-xs text-slate-500">{t.desc}</div>}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {t.properties.map((p) => (
                          <span key={p.key} className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-600">
                            {p.name}<span className="ml-1 font-mono text-slate-400">{p.key}:{p.type}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  </button>
                )
              })}

              {cands.linkTypes.length > 0 && (
                <>
                  <div className="pt-2 text-xs font-semibold text-slate-500">候选链接类型</div>
                  {cands.linkTypes.map((l) => {
                    const sel = !skip[`l:${l.name}`]
                    const resolvable = cands.objectTypes.some((t) => t.name === l.source && isTypeSelected(t)) && cands.objectTypes.some((t) => t.name === l.target && isTypeSelected(t))
                    const ok = sel && resolvable
                    return (
                      <button
                        key={l.name}
                        onClick={() => setSkip({ ...skip, [`l:${l.name}`]: ok })}
                        className={cn('flex w-full items-center gap-3 rounded-xl border p-3 text-left', ok ? 'border-brand-300 bg-brand-50/40' : 'border-slate-200')}
                      >
                        <div className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded border', ok ? 'border-brand-500 bg-brand-500 text-white' : 'border-slate-300 bg-white')}>
                          {ok && <Check size={13} />}
                        </div>
                        <span className="text-[13px] font-semibold text-slate-800">{l.name}</span>
                        <span className="flex items-center gap-1.5 text-xs text-slate-600">
                          {l.source}<ArrowRight size={11} className="text-slate-400" />{l.target}
                          <Badge color="slate">{l.cardinality ?? '1:N'}</Badge>
                        </span>
                        {!resolvable && <Badge color="amber">端点类型未选中 · 跳过</Badge>}
                      </button>
                    )
                  })}
                </>
              )}
            </div>

            <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400"><FileText size={12} /> 入库操作将逐条写入并审计留痕</div>
              <div className="flex gap-2">
                <Btn size="sm" onClick={() => { reset(); onClose() }}>取消</Btn>
                <Btn size="sm" variant="primary" disabled={commitBusy} onClick={commit}>
                  {commitBusy ? <><Loader2 size={13} className="animate-spin" /> 入库中…</> : <>确认入库</>}
                </Btn>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
