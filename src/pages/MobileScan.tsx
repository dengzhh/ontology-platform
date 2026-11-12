import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Camera, Upload, Loader2, Check, X, RefreshCw, Smartphone, AlertCircle } from 'lucide-react'

const API = '/api/scan-session'

interface SessionState {
  id: string
  status: string
  typeName: string
  values: Record<string, unknown> | null
  error: string
}

/** 手机端扫码协同页（/m/:id，免登录） */
export default function MobileScan() {
  const { id = '' } = useParams()
  const [state, setState] = useState<SessionState | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState('')
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
      if (state?.status === 'done') return
      load()
    }, 3000)
    return () => clearInterval(timer)
  }, [id, state?.status])

  function readFile(f: File) {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
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
        setPreview(canvas.toDataURL('image/jpeg', 0.82))
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

  function reset() {
    setPreview(''); setErr(''); setState((s) => (s ? { ...s, status: 'waiting', values: null, error: '' } : s))
  }

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-gradient-to-br from-brand-600 to-violet-700 p-6 text-white">
        <Loader2 size={30} className="animate-spin" />
        <div className="text-sm">正在连接电脑…</div>
      </div>
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
            <div className="text-[11px] text-white/70">拍照上传 → 电脑端自动接收识别结果</div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-md space-y-4 p-4">
        {/* 会话状态卡 */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-800">当前任务</div>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${state?.status === 'done' ? 'bg-emerald-50 text-emerald-700' : 'bg-brand-50 text-brand-700'}`}>
              {state?.status === 'done' ? '已完成' : state?.status === 'uploaded' ? '识别中…' : '等待拍照'}
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

        {/* 完成态 */}
        {state?.status === 'done' ? (
          <div className="rounded-2xl border border-emerald-200 bg-white p-5 text-center shadow-card">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-500"><Check size={28} /></div>
            <div className="text-base font-bold text-slate-900">识别完成！</div>
            <div className="mt-1 text-xs text-slate-500">结果已同步到电脑端，请在电脑上核对并确认入库</div>
            {state.values && (
              <div className="mt-4 space-y-1.5 rounded-xl bg-slate-50 p-3 text-left">
                {Object.entries(state.values).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3 text-[12px]">
                    <span className="text-slate-400">{k}</span>
                    <span className="truncate font-medium text-slate-700">{String(v)}</span>
                  </div>
                ))}
              </div>
            )}
            <button onClick={reset} className="mt-4 w-full rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white">
              <span className="inline-flex items-center gap-1.5"><RefreshCw size={14} /> 继续拍下一张</span>
            </button>
            <p className="mt-2 text-[11px] text-slate-400">可继续拍照，新结果会覆盖并同步到电脑</p>
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
