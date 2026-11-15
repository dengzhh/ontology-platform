import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Camera, Upload, Loader2, Check, X, RefreshCw, Smartphone, AlertCircle, Plus, Trash2 } from 'lucide-react'

const API = '/api/scan-session'

interface PropertyDef { key: string; name: string; type: string; enumValues?: string[] }
interface SessionState {
  id: string
  status: string
  typeName: string
  spaceName: string
  props: PropertyDef[]
  itemProps: PropertyDef[]
  values: Record<string, unknown> | null
  error: string
}

/** 手机端扫码协同页（/m/:id，免登录）：拍照 → 识别 → 可编辑核对（主字段 + 明细行）→ 确认入库 */
export default function MobileScan() {
  const { id = '' } = useParams()
  const [state, setState] = useState<SessionState | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState('')
  /** 编辑态：主字段（key→字符串）与明细行（每行 key→字符串） */
  const [main, setMain] = useState<Record<string, string>>({})
  const [items, setItems] = useState<Record<string, string>[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  async function load() {
    try {
      const res = await fetch(`${API}/${id}`)
      const j = await res.json()
      if (!res.ok) { setErr(j.error ?? '会话不可用'); return }
      setState(j)
    } catch { setErr('网络连接失败，请确认手机与电脑在同一网络') }
    finally { setLoading(false) }
  }

  useEffect(() => {
    load()
    const timer = setInterval(() => {
      if (state?.status === 'done' || state?.status === 'committed') return
      load()
    }, 3000)
    return () => clearInterval(timer)
  }, [id, state?.status])

  /** 识别结果 → 可编辑表单值（主字段 + items 明细行，全部转字符串） */
  function initEdit(vals: Record<string, unknown>) {
    const m: Record<string, string> = {}
    const rows: Record<string, string>[] = []
    for (const [k, v] of Object.entries(vals)) {
      if (k === 'items' && Array.isArray(v)) {
        for (const row of v as Record<string, unknown>[]) {
          const r: Record<string, string> = {}
          for (const [ik, iv] of Object.entries(row)) r[ik] = String(iv ?? '')
          rows.push(r)
        }
      } else if (Array.isArray(v)) {
        m[k] = v.map(String).join('、')
      } else {
        m[k] = String(v ?? '')
      }
    }
    setMain(m)
    setItems(rows)
  }

  // 识别完成（done）时初始化编辑表单（轮询与 upload 两条路径都会走到）
  useEffect(() => {
    if (state?.status === 'done' && state.values) initEdit(state.values)
  }, [state?.status, state?.values])

  function readFile(f: File) {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      // HEIC/HDR（iOS 相册"高效"格式）等浏览器无法解码的图片：给出明确指引而非静默失败
      img.onerror = () => {
        setErr('该照片格式无法在浏览器内处理（可能为 iPhone 高效格式 HEIC）。请在「设置 → 相机 → 格式」选"兼容性最佳"后重拍，或改用拍照直接上传')
        setPreview('')
      }
      img.onload = () => {
        // 压缩到最长边 1400px、JPEG 0.82，减少上传体积
        const scale = Math.min(1, 1400 / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        let out = canvas.toDataURL('image/jpeg', 0.82)
        // 部分安卓内核（X5/UC）对大画布会返回 data:, 或 webp：再画一块干净画布强制重编码一次
        if (!/^data:image\/jpe?g/i.test(out)) {
          const c2 = document.createElement('canvas')
          c2.width = canvas.width; c2.height = canvas.height
          const ctx2 = c2.getContext('2d')!
          ctx2.fillStyle = '#fff'
          ctx2.fillRect(0, 0, c2.width, c2.height)
          ctx2.drawImage(canvas, 0, 0)
          out = c2.toDataURL('image/jpeg', 0.82)
        }
        if (!/^data:image\/jpe?g/i.test(out)) {
          setErr('当前浏览器无法把照片转换为 JPEG，请改用系统相机拍照后从相册选择上传')
          setPreview('')
          return
        }
        setPreview(out)
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(f)
  }

  async function upload() {
    if (!preview) return setErr('请先拍照或选择图片')
    setBusy(true)
    setErr('')
    try {
      const res = await fetch(`${API}/${id}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: preview }),
      })
      const j = await res.json()
      if (!res.ok) { setErr(j.error ?? '上传失败'); return }
      setState((s) => (s ? { ...s, status: 'done', values: j.values } : s))
    } catch { setErr('上传失败，请检查网络') }
    finally { setBusy(false); setPreview(''); if (fileRef.current) fileRef.current.value = '' }
  }

  /** 手机端直接确认入库：编辑后的主字段 + 明细行落成对象（明细为独立子对象），会话标记 committed */
  async function commit() {
    setBusy(true)
    setErr('')
    try {
      const res = await fetch(`${API}/${id}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: { ...main, items } }),
      })
      const j = await res.json()
      if (!res.ok) { setErr(j.error ?? '入库失败'); return }
      setState((s) => (s ? { ...s, status: 'committed' } : s))
    } catch { setErr('入库失败，请检查网络') }
    finally { setBusy(false) }
  }

  /** 「继续拍下一张」：先重置服务端会话（否则轮询会把旧结果拉回来、且第二次上传会 409），再回到拍照态 */
  async function reset() {
    setPreview(''); setErr(''); setMain({}); setItems([])
    setState((s) => (s ? { ...s, status: 'waiting', values: null, error: '' } : s))
    try {
      const res = await fetch(`${API}/${id}/reset`, { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) setErr(j.error ?? '会话重置失败，如已过期请在电脑上重新生成二维码')
    } catch { setErr('网络连接失败，请确认手机与电脑在同一网络') }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-gradient-to-br from-brand-600 to-violet-700 p-6 text-white">
        <Loader2 size={30} className="animate-spin" />
        <div className="text-sm">正在连接电脑…</div>
      </div>
    )
  }

  const fields = state?.props?.length ? state.props : Object.keys(main).map((k) => ({ key: k, name: k, type: 'string' }))
  const itemFields = state?.itemProps ?? []

  function fieldInput(p: PropertyDef, value: string, onChange: (v: string) => void) {
    if (p.type === 'enum' && p.enumValues?.length) {
      return (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-[13px] text-slate-700 focus:border-brand-400 focus:outline-none"
        >
          <option value="">（未识别）</option>
          {p.enumValues.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      )
    }
    return (
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode={p.type === 'number' ? 'decimal' : undefined}
        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-[13px] text-slate-700 focus:border-brand-400 focus:outline-none"
      />
    )
  }

  return (
    <div className="min-h-screen bg-slate-100 pb-8">
      {/* 顶部品牌 */}
      <div className="bg-gradient-to-r from-brand-600 to-violet-600 px-5 py-4 text-white">
        <div className="flex items-center gap-2">
          <Smartphone size={18} />
          <div>
            <div className="text-base font-bold">OntoOS 手机扫描助手</div>
            <div className="text-[11px] text-white/70">拍照上传 → 识别核对 → 直接入库</div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-md space-y-4 p-4">
        {/* 会话状态卡 */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-800">当前任务</div>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${state?.status === 'done' || state?.status === 'committed' ? 'bg-emerald-50 text-emerald-700' : 'bg-brand-50 text-brand-700'}`}>
              {state?.status === 'committed' ? '已入库' : state?.status === 'done' ? '待确认' : state?.status === 'uploaded' ? '识别中…' : '等待拍照'}
            </span>
          </div>
          <div className="mt-2 space-y-1 text-[13px] text-slate-600">
            <div>录入类型：<b className="text-slate-800">{state?.typeName || '通用票据'}</b></div>
            <div className="break-all font-mono text-[11px] text-slate-400">会话 {id}</div>
          </div>
        </div>

        {err && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-600">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>{err}</span>
          </div>
        )}

        {/* 已入库态 */}
        {state?.status === 'committed' ? (
          <div className="rounded-2xl border border-emerald-200 bg-white p-5 text-center shadow-card">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-500"><Check size={28} /></div>
            <div className="text-base font-bold text-slate-900">已录入「{state.typeName || '对象'}」</div>
            <div className="mt-1 text-xs text-slate-500">
              {items.length > 0 && `含 ${items.length} 条商品明细 · `}
              数据已写入「{state.spaceName || '当前'}」空间
            </div>
            <div className="mt-1 text-xs text-slate-500">可在电脑端「对象浏览器」切换到该空间查看与编辑</div>
            <button onClick={reset} className="mt-4 w-full rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white">
              <span className="inline-flex items-center gap-1.5"><RefreshCw size={14} /> 继续拍下一张</span>
            </button>
          </div>
        ) : state?.status === 'done' ? (
          <div className="rounded-2xl border border-emerald-200 bg-white p-4 shadow-card">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 text-emerald-500"><Check size={18} /></div>
              <div>
                <div className="text-sm font-bold text-slate-900">识别完成，请核对修正</div>
                <div className="text-[11px] text-slate-400">识别有误的字段可直接点击修改</div>
              </div>
            </div>

            {/* 主字段编辑 */}
            <div className="space-y-2.5">
              {fields.map((p) => (
                <div key={p.key}>
                  <div className="mb-1 text-[11px] font-medium text-slate-500">{p.name}</div>
                  {fieldInput(p, main[p.key] ?? '', (v) => setMain({ ...main, [p.key]: v }))}
                </div>
              ))}
            </div>

            {/* 明细行编辑（目标类型有配套明细类型时） */}
            {itemFields.length > 0 && (
              <div className="mt-4 border-t border-slate-100 pt-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-[12px] font-semibold text-slate-700">商品明细（{items.length} 条）</div>
                  <button
                    onClick={() => setItems([...items, Object.fromEntries(itemFields.map((p) => [p.key, '']))])}
                    className="flex items-center gap-1 rounded-lg bg-brand-50 px-2 py-1 text-[11px] font-medium text-brand-700"
                  >
                    <Plus size={12} /> 添加一行
                  </button>
                </div>
                <div className="space-y-2">
                  {items.map((row, i) => (
                    <div key={i} className="rounded-xl border border-slate-100 bg-slate-50/60 p-2.5">
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-[10px] font-medium text-slate-400">第 {i + 1} 行</span>
                        <button onClick={() => setItems(items.filter((_, j) => j !== i))} className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-red-500">
                          <Trash2 size={11} /> 删除
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {itemFields.map((p) => (
                          <div key={p.key} className={p.key === itemFields[0]?.key ? 'col-span-2' : ''}>
                            <div className="mb-0.5 text-[10px] text-slate-400">{p.name}</div>
                            {fieldInput(p, row[p.key] ?? '', (v) => setItems(items.map((r, j) => (j === i ? { ...r, [p.key]: v } : r))))}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {items.length === 0 && <div className="rounded-lg bg-slate-50 px-3 py-2 text-center text-[11px] text-slate-400">无明细，可点「添加一行」手动补录</div>}
                </div>
              </div>
            )}

            <button onClick={commit} disabled={busy} className="mt-4 w-full rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white disabled:opacity-50">
              <span className="inline-flex items-center gap-1.5">{busy ? <><Loader2 size={14} className="animate-spin" /> 入库中…</> : <><Check size={14} /> 确认入库</>}</span>
            </button>
            <button onClick={reset} className="mt-2 w-full rounded-xl border border-slate-200 py-2.5 text-[13px] font-medium text-slate-600">
              <span className="inline-flex items-center gap-1.5"><RefreshCw size={13} /> 重拍（不入库）</span>
            </button>
            <p className="mt-2 text-center text-[11px] text-slate-400">每条商品明细会作为独立记录入库，支持按商品统计分析</p>
          </div>
        ) : (
          <>
            {/* 拍照/上传区 */}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f) }}
            />
            {!preview ? (
              <button
                onClick={() => fileRef.current?.click()}
                className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-brand-300 bg-white py-12 shadow-card"
              >
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                  <Camera size={30} />
                </div>
                <div className="text-sm font-semibold text-slate-800">点击拍照 / 选择小票图片</div>
                <div className="text-[11px] text-slate-400">建议光线充足、票面平整、文字清晰</div>
              </button>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
                <img src={preview} alt="待上传票据" className="max-h-80 w-full object-contain" />
                <div className="flex gap-2 border-t border-slate-100 p-3">
                  <button onClick={() => fileRef.current?.click()} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2.5 text-[13px] font-medium text-slate-600">
                    <RefreshCw size={14} /> 重拍
                  </button>
                  <button onClick={reset} className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 text-slate-400"><X size={16} /></button>
                </div>
              </div>
            )}

            <button
              onClick={upload}
              disabled={!preview || busy}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-3.5 text-sm font-semibold text-white shadow-card disabled:opacity-50"
            >
              {busy ? <><Loader2 size={16} className="animate-spin" /> 上传并识别中…</> : <><Upload size={16} /> 上传并识别</>}
            </button>
            <p className="text-center text-[11px] leading-5 text-slate-400">
              图片仅用于本次识别，识别后自动同步到电脑端<br />无需登录 · 会话 10 分钟内有效
            </p>
          </>
        )}
      </div>
    </div>
  )
}
