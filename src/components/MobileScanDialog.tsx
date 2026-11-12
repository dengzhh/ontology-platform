import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { QrCode, X, Loader2, Check, RefreshCw, Smartphone, Copy } from 'lucide-react'
import Btn from '@/components/ui/Btn'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { api } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'

interface PropertyDef { key: string; name: string; type: string; enumValues?: string[] }
interface ScanTarget { id: string; name: string; color: string; properties: PropertyDef[] }
interface SessionState {
  id: string
  status: string
  typeName: string
  values: Record<string, unknown> | null
  error: string
  expiresAt: number
}

/** PC 端手机扫码协同弹层：生成二维码 → 手机拍照 → 轮询结果 → 审核入库 */
export default function MobileScanDialog({
  onClose,
  defaultTypeId,
  onCommitted,
}: {
  onClose: () => void
  defaultTypeId?: string
  onCommitted?: () => void
}) {
  const targetsQ = useApi<{ targets: ScanTarget[] }>('/scan/targets')
  const targets = targetsQ.data?.targets ?? []
  const [typeId, setTypeId] = useState(defaultTypeId ?? '')
  const target = targets.find((t) => t.id === typeId)

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [qrUrl, setQrUrl] = useState('')
  const [mobileUrl, setMobileUrl] = useState('')
  const [state, setState] = useState<SessionState | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [committing, setCommitting] = useState(false)
  const [done, setDone] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // 局域网地址：优先用 location.hostname（手机需同网络），端口用 vite 的 5174
  function getLanBase() {
    const host = location.hostname
    // 如果是 localhost，尝试让用户输入/自动给出提示；用当前协议+主机+前端端口
    const proto = location.protocol
    const port = location.port || '5174'
    return `${proto}//${host}:${port}`
  }

  async function startSession() {
    if (!typeId) return setError('请选择录入的目标类型')
    setStarting(true)
    setError('')
    try {
      const spaceId = localStorage.getItem('ontoos.space') || 'sp-org-default'
      const r = await api<{ id: string; expiresAt: number }>('/scan-session/create', {
        method: 'POST',
        body: { spaceId, typeId },
      })
      setSessionId(r.id)
      const url = `${getLanBase()}/m/${r.id}`
      setMobileUrl(url)
      const qr = await QRCode.toDataURL(url, { width: 260, margin: 1, color: { dark: '#1e3a8a', light: '#ffffff' } })
      setQrUrl(qr)
      // 开始轮询
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = setInterval(async () => {
        try {
          const s = await api<SessionState>(`/scan-session/${r.id}/poll`)
          setState(s)
          if (s.status === 'done' && s.values) {
            const v: Record<string, string> = {}
            for (const [k, val] of Object.entries(s.values)) v[k] = String(val)
            setValues(v)
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
          }
        } catch { /* 轮询失败静默重试 */ }
      }, 2000)
    } catch (e) { setError(e instanceof Error ? e.message : '创建会话失败') }
    finally { setStarting(false) }
  }

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  async function commit() {
    if (!typeId || Object.keys(values).filter((k) => values[k] !== '').length === 0) return setError('没有可入库的字段')
    setCommitting(true)
    setError('')
    try {
      await api('/scan/commit', { method: 'POST', body: { typeId, values } })
      setDone(true)
      onCommitted?.()
    } catch (e) { setError(e instanceof Error ? e.message : '入库失败') }
    finally { setCommitting(false) }
  }

  function restart() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    setSessionId(null); setQrUrl(''); setMobileUrl(''); setState(null); setValues({}); setDone(false); setError('')
  }

  const fields = target?.properties ?? []
  const waiting = !!sessionId && !state?.values
  const minutesLeft = state ? Math.max(0, Math.round((state.expiresAt - Date.now()) / 60000)) : 0

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[92vh] w-[680px] max-w-[94vw] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-500 text-white"><QrCode size={16} /></div>
            <div>
              <div className="text-base font-bold text-slate-900">手机扫码协同扫描</div>
              <div className="text-[11px] text-slate-400">手机拍照 → 自动识别 → 结果回流电脑 → 审核入库</div>
            </div>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={16} /></button>
        </div>

        {/* 成功态 */}
        {done ? (
          <div className="py-8 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-500"><Check size={28} /></div>
            <div className="text-base font-bold text-slate-900">已成功录入「{target?.name}」</div>
            <div className="mt-1 text-sm text-slate-500">手机拍摄的票据数据已写入当前空间</div>
            <div className="mt-5 flex justify-center gap-2">
              <Btn onClick={restart}><RefreshCw size={13} /> 再扫一张</Btn>
              <Btn variant="primary" onClick={onClose}>完成</Btn>
            </div>
          </div>
        ) : (
          <>
            {/* 目标类型（未创建会话前可选） */}
            {!sessionId && (
              <div className="mb-3">
                <div className="mb-1.5 text-xs font-medium text-slate-600">录入到（对象类型）</div>
                <select
                  value={typeId}
                  onChange={(e) => setTypeId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[13px] text-slate-700 focus:border-brand-400 focus:outline-none"
                >
                  <option value="">选择…</option>
                  {targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            )}

            {/* 二维码区 */}
            {!sessionId ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-8 text-center">
                <Smartphone size={34} className="mx-auto mb-2 text-brand-500" />
                <div className="text-sm font-semibold text-slate-700">用手机扫描二维码，调起摄像头拍小票</div>
                <div className="mt-1 text-[11px] text-slate-400">手机无需登录，识别结果自动同步到本电脑</div>
                <Btn variant="primary" className="mt-4" disabled={starting || !typeId} onClick={startSession}>
                  {starting ? <><Loader2 size={14} className="animate-spin" /> 生成中…</> : <><QrCode size={14} /> 生成二维码</>}
                </Btn>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
                {/* 左：二维码 */}
                <div className="flex flex-col items-center rounded-2xl border border-slate-200 bg-white p-4">
                  {qrUrl && <img src={qrUrl} alt="扫码二维码" className="h-[220px] w-[220px]" />}
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
                    {waiting ? <><Loader2 size={12} className="animate-spin text-brand-500" /> 等待手机拍照…</> : <><Check size={12} className="text-emerald-500" /> 已收到识别结果</>}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400">{minutesLeft} 分钟内有效</div>
                  <button
                    onClick={() => navigator.clipboard?.writeText(mobileUrl)}
                    className="mt-2 flex items-center gap-1 text-[11px] text-brand-600 hover:underline"
                  >
                    <Copy size={11} /> 复制手机链接
                  </button>
                  <div className="mt-2 w-full break-all rounded-lg bg-slate-50 px-2 py-1.5 text-center font-mono text-[10px] text-slate-400">{mobileUrl}</div>
                  {location.hostname === 'localhost' && (
                    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] leading-4 text-amber-700">
                      当前为 localhost，手机无法访问。请用电脑的局域网 IP（如 192.168.x.x:5174）打开本平台后重新生成。
                    </div>
                  )}
                </div>

                {/* 右：状态/结果 */}
                <div className="min-w-0 space-y-3">
                  {/* 步骤说明 */}
                  <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                    <div className="mb-2 text-xs font-semibold text-slate-600">协同流程</div>
                    <ol className="space-y-1.5 text-[12px] text-slate-500">
                      {[
                        ['1', '手机扫左侧二维码，打开拍照页'],
                        ['2', '对准小票拍照并上传'],
                        ['3', '服务器调用视觉模型自动识别'],
                        ['4', '识别结果显示在下方，核对后入库'],
                      ].map(([n, t]) => (
                        <li key={n} className="flex items-start gap-2">
                          <span className={cn(
                            'flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                            state?.status === 'done' ? 'bg-emerald-100 text-emerald-700' : 'bg-brand-100 text-brand-700',
                          )}>{n}</span>
                          <span>{t}</span>
                        </li>
                      ))}
                    </ol>
                  </div>

                  {state?.error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">手机端：{state.error}</div>}
                  {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}

                  {/* 识别结果审核 */}
                  {Object.keys(values).length > 0 && (
                    <Card>
                      <div className="mb-2.5 flex items-center justify-between">
                        <div className="text-[13px] font-semibold text-slate-700">识别结果（请核对修正）</div>
                        <Badge color="green" dot>已回流 {Object.keys(values).filter((k) => values[k] !== '').length} 字段</Badge>
                      </div>
                      <div className="grid gap-2.5 sm:grid-cols-2">
                        {fields.map((p) => (
                          <div key={p.key}>
                            <div className="mb-1 text-[11px] font-medium text-slate-600">{p.name}</div>
                            {p.type === 'enum' && p.enumValues?.length ? (
                              <select
                                value={values[p.key] ?? ''}
                                onChange={(e) => setValues({ ...values, [p.key]: e.target.value })}
                                className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[12px] text-slate-700 focus:border-brand-400 focus:outline-none"
                              >
                                <option value="">（未识别）</option>
                                {p.enumValues.map((v) => <option key={v} value={v}>{v}</option>)}
                              </select>
                            ) : (
                              <input
                                value={values[p.key] ?? ''}
                                onChange={(e) => setValues({ ...values, [p.key]: e.target.value })}
                                className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[12px] text-slate-700 focus:border-brand-400 focus:outline-none"
                              />
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 flex justify-end gap-2 border-t border-slate-100 pt-3">
                        <Btn onClick={restart}>重扫</Btn>
                        <Btn variant="primary" disabled={committing} onClick={commit}>{committing ? '入库中…' : '确认录入'}</Btn>
                      </div>
                    </Card>
                  )}

                  {waiting && !state?.values && (
                    <div className="flex items-center gap-2 rounded-xl border border-brand-200 bg-brand-50/50 px-3 py-4 text-xs text-brand-700">
                      <Loader2 size={14} className="animate-spin" /> 等待手机端上传照片（每 2 秒自动刷新）…
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
