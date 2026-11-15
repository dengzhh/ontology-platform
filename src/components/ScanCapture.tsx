import { useEffect, useRef, useState } from 'react'
import { Camera, Upload, X, Loader2, Check, RefreshCw, Sparkles, QrCode, FileText, Files, Image as ImageIcon, Plus } from 'lucide-react'
import Btn from '@/components/ui/Btn'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { Field, Input } from '@/components/ui/Form'
import MobileScanDialog from '@/components/MobileScanDialog'
import { api } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { parseFile, fileKindMeta, type ParsedFile } from '@/lib/fileParse'
import { cn } from '@/lib/utils'

interface PropertyDef { key: string; name: string; type: string; enumValues?: string[] }
interface ScanTarget { id: string; name: string; color: string; properties: PropertyDef[] }
interface ScanTemplate {
  id: string; name: string; desc: string; kind: string; typeId: string; extraPrompt: string
}
interface RecognizeResp {
  values: Record<string, unknown>
  raw: string
  typeId: string | null
  typeName: string
  model: string
  templateId: string | null
  templateName: string
  matchReason: string
  /** 存在配套明细类型时返回，commit 会据此把 items 落地为明细子对象 */
  itemTypeId?: string | null
}

/**
 * 通用票据/单据视觉识别组件（P10+）
 * 上传/粘贴图片 → 视觉模型按本体属性提取字段 → 审核修正 → 入库
 * 可挂到任何手写录入界面。
 */
export default function ScanCapture({
  onClose,
  defaultTypeId,
  onCommitted,
  compact = false,
  title = '扫描录入',
  mode = 'commit',
  onFill,
}: {
  onClose: () => void
  /** 默认目标对象类型（不传则可下拉选择） */
  defaultTypeId?: string
  /** 入库成功回调 */
  onCommitted?: () => void
  /** 紧凑模式（作为小面板嵌入表单） */
  compact?: boolean
  title?: string
  /** commit=直接入库；fill=识别后回填到父表单 */
  mode?: 'commit' | 'fill'
  /** fill 模式：回填回调 */
  onFill?: (values: Record<string, string>) => void
}) {
  const targetsQ = useApi<{ targets: ScanTarget[]; itemTypes: ScanTarget[] }>('/scan/targets')
  const targets = targetsQ.data?.targets ?? []
  const itemTypes = targetsQ.data?.itemTypes ?? []
  const [typeId, setTypeId] = useState(defaultTypeId ?? '')
  const target = targets.find((t) => t.id === typeId)
  const tplQ = useApi<{ templates: ScanTemplate[]; auto: { templateId: string | null; name: string; reason: string } }>(
    typeId ? `/scan/templates?typeId=${typeId}` : '/scan/templates'
  )
  const templates = tplQ.data?.templates ?? []
  const [templateId, setTemplateId] = useState<string>('auto') // auto=自动匹配
  const [matchReason, setMatchReason] = useState('')
  const [usedTemplate, setUsedTemplate] = useState('')

  useEffect(() => {
    if (tplQ.data?.auto) setMatchReason(tplQ.data.auto.reason)
  }, [tplQ.data])
  const [image, setImage] = useState<string>('')
  const [preview, setPreview] = useState<string>('')
  const [hint, setHint] = useState('')
  const [recognizing, setRecognizing] = useState(false)
  const [error, setError] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  /** 明细行（多商品小票）：每行一个商品，入库时落地为独立子对象 */
  const [itemRows, setItemRows] = useState<Record<string, string>[]>([])
  const [itemTypeId, setItemTypeId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [done, setDone] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [inputMode, setInputMode] = useState<'capture' | 'file'>('capture')
  const [parsedFiles, setParsedFiles] = useState<ParsedFile[]>([])
  const [fileBusy, setFileBusy] = useState(false)
  const [fileResults, setFileResults] = useState<{ name: string; values: Record<string, unknown>; itemTypeId?: string | null; error?: string }[]>([])
  const multiFileRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function readFile(f: File) {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      setImage(result)
      setPreview(result)
      setValues({})
      setError('')
      setDone(false)
    }
    reader.readAsDataURL(f)
  }

  /** 批量选择文件 → 解析（图片/PDF/Word/文本） */
  async function onFilesPicked(files: FileList | null) {
    if (!files?.length) return
    setFileBusy(true)
    setError('')
    setFileResults([])
    const parsed: ParsedFile[] = []
    for (const f of Array.from(files).slice(0, 10)) {
      try { parsed.push(await parseFile(f)) }
      catch (e) { parsed.push({ name: f.name, kind: 'text', text: '' }) }
    }
    setParsedFiles(parsed)
    setFileBusy(false)
  }

  /** 识别全部已选文件 */
  async function recognizeFiles() {
    if (!parsedFiles.length) return setError('请先选择文件')
    setRecognizing(true)
    setError('')
    const results: { name: string; values: Record<string, unknown>; itemTypeId?: string | null; error?: string }[] = []
    for (const pf of parsedFiles) {
      // 解析阶段就失败的文件（HEIC 无法解码等）：直接标注结果，不送识别
      if (pf.error) { results.push({ name: pf.name, values: {}, error: pf.error }); continue }
      try {
        let res: RecognizeResp
        if (pf.image && !pf.text) {
          // 纯图片（无文本层）→ 视觉识别
          res = await api<RecognizeResp>('/scan/recognize', {
            method: 'POST',
            body: { image: pf.image, typeId: typeId || undefined, hint: hint || undefined, templateId: templateId === 'auto' ? undefined : templateId },
          })
        } else {
          // PDF 有文本层 / Word / TXT / CSV → 文本结构化提取（更准更快）
          res = await api<RecognizeResp>('/scan/recognize-text', {
            method: 'POST',
            body: { text: pf.text ?? '', typeId: typeId || undefined, hint: hint || undefined, templateId: templateId === 'auto' ? undefined : templateId, fileName: pf.name },
          })
        }
        // PDF 同时有文本与图片：文本失败时用视觉兜底
        if (pf.image && pf.text && (!res.values || Object.keys(res.values).length === 0)) {
          res = await api<RecognizeResp>('/scan/recognize', {
            method: 'POST',
            body: { image: pf.image, typeId: typeId || undefined, hint: hint || undefined, templateId: templateId === 'auto' ? undefined : templateId },
          })
        }
        results.push({ name: pf.name, values: res.values ?? {}, itemTypeId: res.itemTypeId ?? null })
        if (res.templateName) setUsedTemplate(res.templateName)
      } catch (e) {
        results.push({ name: pf.name, values: {}, error: e instanceof Error ? e.message : '识别失败' })
      }
    }
    setFileResults(results)
    setRecognizing(false)
  }

  /** 批量入库（带 itemTypeId：识别出的 items 明细会随主对象一并落地为子对象+链接） */
  async function commitFiles() {
    if (!typeId) return setError('请选择录入的目标类型')
    const valid = fileResults.filter((r) => !r.error && Object.keys(r.values).length > 0)
    if (!valid.length) return setError('没有可入库的结果')
    setCommitting(true)
    setError('')
    try {
      for (const r of valid) {
        await api('/scan/commit', { method: 'POST', body: { typeId, values: r.values, itemTypeId: r.itemTypeId || undefined } })
      }
      setDone(true)
      onCommitted?.()
    } catch (e) { setError(e instanceof Error ? e.message : '入库失败') }
    finally { setCommitting(false) }
  }

  async function recognize() {
    if (!image) return setError('请先上传或粘贴图片')
    setRecognizing(true)
    setError('')
    setValues({})
    try {
      const res = await api<RecognizeResp>('/scan/recognize', {
        method: 'POST',
        body: { image, typeId: typeId || undefined, hint: hint || undefined, templateId: templateId === 'auto' ? undefined : templateId },
      })
      setUsedTemplate(res.templateName ?? '')
      if (res.matchReason) setMatchReason(res.matchReason)
      setItemTypeId(res.itemTypeId ?? null)
      // 转成字符串表单值；items 明细数组提取为独立行编辑（每行入库为独立子对象）
      const v: Record<string, string> = {}
      const rows: Record<string, string>[] = []
      for (const [k, val] of Object.entries(res.values)) {
        if (k === 'items' && Array.isArray(val)) {
          for (const row of val as Record<string, unknown>[]) {
            const r: Record<string, string> = {}
            for (const [ik, iv] of Object.entries(row)) r[ik] = String(iv ?? '')
            rows.push(r)
          }
        } else if (Array.isArray(val)) {
          v[k] = val.map(String).join('、')
        } else {
          v[k] = String(val)
        }
      }
      setValues(v)
      setItemRows(rows)
      setEditing(true)
      if (Object.keys(v).length === 0 && rows.length === 0) setError('未识别到有效字段，请换张清晰的图片重试')
    } catch (e) {
      const msg = e instanceof Error ? e.message : '识别失败'
      setError(msg.includes('VISION_NOT_CONFIGURED') ? '未配置视觉服务：请先到控制面板配置 AI 网关（bigmodel 支持 glm-4v-flash 视觉模型）' : msg)
    } finally { setRecognizing(false) }
  }

  async function commit() {
    if (!typeId) return setError('请选择录入的目标类型')
    if (Object.keys(values).filter((k) => values[k] !== '').length === 0) return setError('没有可入库的字段')
    if (mode === 'fill') {
      // fill 模式回填父表单：明细以 JSON 字符串随行（父表单提交时后端拆为明细子对象）
      onFill?.({ ...values, ...(itemRows.length ? { items: JSON.stringify(itemRows) } : {}) })
      onCommitted?.()
      onClose()
      return
    }
    setCommitting(true)
    setError('')
    try {
      await api('/scan/commit', { method: 'POST', body: { typeId, values: { ...values, items: itemRows }, itemTypeId: itemTypeId || undefined } })
      setDone(true)
      onCommitted?.()
    } catch (e) { setError(e instanceof Error ? e.message : '入库失败') }
    finally { setCommitting(false) }
  }

  function reset() {
    setImage(''); setPreview(''); setValues({}); setItemRows([]); setEditing(false); setError(''); setDone(false); setHint('')
    setParsedFiles([]); setFileResults([])
  }

  const fields = target?.properties ?? []
  const itemFields = itemTypes.find((t) => t.id === itemTypeId)?.properties ?? []
  const setField = (k: string, v: string) => setValues({ ...values, [k]: v })

  return (
    <div className={cn('fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm', compact && 'z-50')} onClick={onClose}>
      <div
        className={cn('max-h-[90vh] w-[640px] max-w-[94vw] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-pop', compact && 'w-[560px]')}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-500 text-white"><Camera size={16} /></div>
            <div>
              <div className="text-base font-bold text-slate-900">{title}</div>
              <div className="text-[11px] text-slate-400">拍照 / 文件（图片·PDF·Word）→ AI 识别字段 → 审核后入库</div>
            </div>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={16} /></button>
        </div>

        {/* 输入方式 Tab */}
        <div className="mb-3 flex w-fit rounded-lg bg-slate-100 p-1">
          <button onClick={() => setInputMode('capture')} className={cn('flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium', inputMode === 'capture' ? 'bg-white text-brand-700 shadow-card' : 'text-slate-500')}>
            <Camera size={13} /> 拍照 / 粘贴图片
          </button>
          <button onClick={() => setInputMode('file')} className={cn('flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium', inputMode === 'file' ? 'bg-white text-brand-700 shadow-card' : 'text-slate-500')}>
            <Files size={13} /> 文件识别（批量）
          </button>
        </div>

        {/* 成功态 */}
        {done ? (
          <div className="py-8 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-500"><Check size={28} /></div>
            <div className="text-base font-bold text-slate-900">已成功录入「{target?.name}」</div>
            <div className="mt-1 text-sm text-slate-500">数据已写入当前空间，可在对象浏览器查看</div>
            <div className="mt-5 flex justify-center gap-2">
              <Btn onClick={reset}><RefreshCw size={13} /> 继续扫描下一张</Btn>
              <Btn variant="primary" onClick={onClose}>完成</Btn>
            </div>
          </div>
        ) : (
          <>
            {/* 目标类型选择 */}
            {!defaultTypeId && (
              <Field label="录入到（对象类型）" hint="识别结果将按此类型的属性映射">
                <select
                  value={typeId}
                  onChange={(e) => { setTypeId(e.target.value); setValues({}); setEditing(false) }}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[13px] text-slate-700 focus:border-brand-400 focus:outline-none"
                >
                  <option value="">选择…（不选则输出通用票据字段）</option>
                  {targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </Field>
            )}

            {/* 识别模板：自动匹配（默认）+ 手动选择 */}
            <div className="mt-3 rounded-lg border border-violet-100 bg-violet-50/50 p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-700">
                  <Sparkles size={12} className="text-violet-500" /> 识别模板（自动匹配，无需配置）
                </div>
                <Badge color="green" dot>已自动选择</Badge>
              </div>
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <select
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[12px] text-slate-700 focus:border-brand-400 focus:outline-none"
                >
                  <option value="auto">🤖 自动匹配（推荐）</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>{t.kind === 'builtin' ? '📦 ' : '✏️ '}{t.name} — {t.desc.slice(0, 24)}</option>
                  ))}
                </select>
                <span className="self-center text-[11px] text-slate-500">{matchReason || '根据对象类型与票据场景自动推断'}</span>
              </div>
              {usedTemplate && (
                <div className="mt-1.5 text-[11px] text-violet-700">本次使用：<b>{usedTemplate}</b> · 可在「控制面板 → 识别模板」自定义提示词</div>
              )}
            </div>

            {/* 上传区：拍照/粘贴 或 文件批量 */}
            {inputMode === 'capture' ? (
              <div className="mt-3">
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f) }} />
                {!preview ? (
                  <button
                    onClick={() => fileRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) readFile(f) }}
                    className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/60 py-10 hover:border-brand-300 hover:bg-brand-50/30"
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-brand-500 shadow-card"><Upload size={22} /></div>
                    <div className="text-sm font-medium text-slate-700">点击上传 / 拖拽 / Ctrl+V 粘贴小票图片</div>
                    <div className="text-[11px] text-slate-400">支持 JPG / PNG / 截图，自动压缩后送视觉模型识别</div>
                  </button>
                ) : (
                  <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                    <img src={preview} alt="待识别票据" className="max-h-64 w-full object-contain" />
                    <div className="absolute right-2 top-2 flex gap-1">
                      <button onClick={() => fileRef.current?.click()} className="flex h-7 items-center gap-1 rounded-lg bg-white/95 px-2 text-[11px] text-slate-600 shadow-card hover:text-brand-600"><RefreshCw size={11} /> 更换</button>
                      <button onClick={reset} className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/95 text-slate-400 shadow-card hover:text-red-500"><X size={13} /></button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-3">
                <input
                  ref={multiFileRef}
                  type="file"
                  multiple
                  accept="image/*,.pdf,.docx,.txt,.md,.csv"
                  className="hidden"
                  onChange={(e) => onFilesPicked(e.target.files)}
                />
                <button
                  onClick={() => multiFileRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); onFilesPicked(e.dataTransfer.files) }}
                  className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/60 py-8 hover:border-brand-300 hover:bg-brand-50/30"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-brand-500 shadow-card"><Files size={22} /></div>
                  <div className="text-sm font-medium text-slate-700">选择文件（可多选，最多 10 个）</div>
                  <div className="text-[11px] text-slate-400">图片 · PDF（首页渲染+全文）· Word/文本（LLM 结构化）</div>
                  {fileBusy && <div className="text-xs text-slate-400"><Loader2 size={12} className="inline animate-spin" /> 解析文件中…</div>}
                </button>

                {/* 已选文件队列 */}
                {parsedFiles.length > 0 && (
                  <div className="mt-2.5 space-y-1.5">
                    {parsedFiles.map((pf, i) => {
                      const meta = fileKindMeta(pf.kind)
                      return (
                        <div key={i} className="flex items-center gap-2.5 rounded-lg border border-slate-100 bg-white px-3 py-2">
                          {pf.kind === 'image' || pf.kind === 'pdf' ? <ImageIcon size={14} className={meta.color} /> : <FileText size={14} className={meta.color} />}
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[12px] font-medium text-slate-700">{pf.name}</div>
                            <div className="text-[10px] text-slate-400">{meta.label} · {meta.hint}{pf.pages ? ` · ${pf.pages} 页` : ''}{pf.text ? ` · ${pf.text.length} 字` : ''}</div>
                          </div>
                          <button onClick={() => setParsedFiles(parsedFiles.filter((_, j) => j !== i))} className="text-slate-300 hover:text-red-500"><X size={13} /></button>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* 批量识别结果 */}
                {fileResults.length > 0 && (
                  <Card className="mt-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-[13px] font-semibold text-slate-700">批量识别结果</div>
                      <Badge color="green" dot>{fileResults.filter((r) => !r.error).length}/{fileResults.length} 成功</Badge>
                    </div>
                    <div className="max-h-48 space-y-1.5 overflow-y-auto">
                      {fileResults.map((r, i) => (
                        <div key={i} className="flex items-start gap-2 rounded-lg border border-slate-100 px-2.5 py-2 text-[11px]">
                          <span className="mt-0.5 shrink-0 text-slate-400">{i + 1}.</span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-medium text-slate-700">{r.name}</div>
                            <div className={cn('truncate', r.error ? 'text-red-500' : 'text-slate-500')}>
                              {r.error ?? Object.entries(r.values).map(([k, v]) => `${k}=${v}`).join('  ')}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 flex justify-end gap-2 border-t border-slate-100 pt-3">
                      <Btn onClick={() => { setFileResults([]); setParsedFiles([]) }}>清空</Btn>
                      <Btn variant="primary" disabled={committing} onClick={commitFiles}>{committing ? '入库中…' : '批量入库'}</Btn>
                    </div>
                  </Card>
                )}
              </div>
            )}

            {/* 补充说明 */}
            <div className="mt-3">
              <Field label="补充要求（可选）" hint="如：只识别合计金额、忽略商品明细；也用于模板自动匹配关键词">
                <Input value={hint} onChange={(e) => setHint(e.target.value)} placeholder="如：金额取合计、日期用消费日期、这是增值税发票" />
              </Field>
            </div>

            {/* 识别按钮 + 手机协同 */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400"><Sparkles size={11} className="text-violet-500" /> {inputMode === 'file' ? 'LLM 按本体属性结构化提取' : '视觉模型按本体属性提取结构化字段'}</div>
              <div className="flex items-center gap-2">
                {inputMode === 'capture' && <Btn size="sm" onClick={() => setMobileOpen(true)}><QrCode size={13} /> 手机扫码拍</Btn>}
                <Btn variant="primary" size="sm" onClick={inputMode === 'file' ? recognizeFiles : recognize} disabled={(inputMode === 'capture' ? !image : !parsedFiles.length) || recognizing}>
                  {recognizing ? <><Loader2 size={13} className="animate-spin" /> 识别中…</> : inputMode === 'file' ? <><Files size={13} /> 批量识别</> : <><Camera size={13} /> 开始识别</>}
                </Btn>
              </div>
            </div>

            {error && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}

            {/* 识别结果审核 */}
            {editing && (
              <Card className="mt-4">
                <div className="mb-2.5 flex items-center justify-between">
                  <div className="text-[13px] font-semibold text-slate-700">识别结果（请核对修正）</div>
                  <Badge color="green" dot>已识别 {Object.keys(values).filter((k) => values[k] !== '').length} 个字段</Badge>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {fields.length > 0 ? (
                    fields.map((p) => (
                      <Field key={p.key} label={p.name} hint={p.type === 'number' ? '数值' : p.type === 'enum' && p.enumValues ? p.enumValues.join(' / ') : undefined}>
                        {p.type === 'enum' && p.enumValues?.length ? (
                          <select
                            value={values[p.key] ?? ''}
                            onChange={(e) => setField(p.key, e.target.value)}
                            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[13px] text-slate-700 focus:border-brand-400 focus:outline-none"
                          >
                            <option value="">（未识别）</option>
                            {p.enumValues.map((v) => <option key={v} value={v}>{v}</option>)}
                          </select>
                        ) : (
                          <Input value={values[p.key] ?? ''} onChange={(e) => setField(p.key, e.target.value)} placeholder="未识别" />
                        )}
                      </Field>
                    ))
                  ) : (
                    // 无目标类型：展示通用字段（items 明细不渲染成输入框，仍随提交保留）
                    Object.keys(values).filter((k) => k !== 'items').map((k) => (
                      <Field key={k} label={k}><Input value={values[k] ?? ''} onChange={(e) => setField(k, e.target.value)} /></Field>
                    ))
                  )}
                </div>
                {fields.length === 0 && (
                  <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
                    未指定目标类型，输出的是通用票据字段。若要直接入库，请选择上方的录入类型后重新识别。
                  </div>
                )}
                {/* 商品明细行编辑：每行独立入库为子对象 */}
                {itemFields.length > 0 && (
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-[12px] font-semibold text-slate-700">商品明细（{itemRows.length} 条，每条独立入库）</div>
                      <button
                        onClick={() => setItemRows([...itemRows, Object.fromEntries(itemFields.map((p) => [p.key, '']))])}
                        className="flex items-center gap-1 rounded-lg bg-brand-50 px-2 py-1 text-[11px] font-medium text-brand-700"
                      >
                        <Plus size={11} /> 添加一行
                      </button>
                    </div>
                    <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                      {itemRows.map((row, i) => (
                        <div key={i} className="rounded-lg border border-slate-100 bg-slate-50/60 p-2">
                          <div className="mb-1 flex items-center justify-between">
                            <span className="text-[10px] font-medium text-slate-400">第 {i + 1} 行</span>
                            <button onClick={() => setItemRows(itemRows.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-500"><X size={12} /></button>
                          </div>
                          <div className="grid grid-cols-3 gap-1.5">
                            {itemFields.map((p) => (
                              <div key={p.key} className={p.key === itemFields[0]?.key ? 'col-span-2' : ''}>
                                <div className="mb-0.5 text-[10px] text-slate-400">{p.name}</div>
                                {p.type === 'enum' && p.enumValues?.length ? (
                                  <select
                                    value={row[p.key] ?? ''}
                                    onChange={(e) => setItemRows(itemRows.map((r, j) => (j === i ? { ...r, [p.key]: e.target.value } : r)))}
                                    className="w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-[11px] text-slate-700 focus:border-brand-400 focus:outline-none"
                                  >
                                    <option value="">（未识别）</option>
                                    {p.enumValues.map((v) => <option key={v} value={v}>{v}</option>)}
                                  </select>
                                ) : (
                                  <input
                                    value={row[p.key] ?? ''}
                                    onChange={(e) => setItemRows(itemRows.map((r, j) => (j === i ? { ...r, [p.key]: e.target.value } : r)))}
                                    className="w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-[11px] text-slate-700 focus:border-brand-400 focus:outline-none"
                                  />
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                      {itemRows.length === 0 && <div className="rounded border border-dashed border-slate-200 px-3 py-2 text-center text-[11px] text-slate-400">无明细行，可点「添加一行」手动补录</div>}
                    </div>
                  </div>
                )}
                <div className="mt-4 flex justify-end gap-2 border-t border-slate-100 pt-3">
                  <Btn onClick={reset}>取消</Btn>
                  <Btn variant="primary" disabled={!typeId || committing} onClick={commit}>
                    {committing ? '入库中…' : mode === 'fill' ? '填入表单' : '确认录入'}
                  </Btn>
                </div>
              </Card>
            )}
          </>
        )}
      </div>

      {/* 手机扫码协同弹层 */}
      {mobileOpen && (
        <MobileScanDialog
          defaultTypeId={defaultTypeId || typeId}
          onClose={() => setMobileOpen(false)}
          onCommitted={() => {
            setMobileOpen(false)
            setDone(true)
            onCommitted?.()
          }}
        />
      )}
    </div>
  )
}
