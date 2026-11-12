import { useEffect, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Activity, Bot, Cpu, Database, Loader2, Mail, MousePointerClick, RotateCcw, Save, Send, ShieldCheck, SlidersHorizontal, Sparkles, Store, Layers, Camera } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import PageShell from '@/components/ui/PageShell'
import { Badge, StatusDot } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import { KVList, ProgressBar } from '@/components/ui/Misc'
import Btn from '@/components/ui/Btn'
import { Input, Field } from '@/components/ui/Form'
import { api } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'

/* ---------- 邮件服务（真实配置，nodemailer SMTP） ---------- */
const EMPTY_SMTP = { host: '', port: '465', secure: true, user: '', pass: '', from: '', senderName: 'OntoOS 平台' }

function SmtpCard() {
  const cfgQ = useApi<{ configured: boolean; smtp?: typeof EMPTY_SMTP }>('/admin/smtp')
  const [form, setForm] = useState<typeof EMPTY_SMTP>(EMPTY_SMTP)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [testTo, setTestTo] = useState('')
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState('')
  const configured = cfgQ.data?.configured ?? false
  const loaded = !cfgQ.loading
  const filled = useRef(false)

  // 回显已保存的 SMTP 配置（密码服务端不回传，保持空；留空保存表示沿用）
  useEffect(() => {
    if (cfgQ.data?.smtp && !filled.current) {
      const s = cfgQ.data.smtp
      setForm({
        host: s.host ?? '', port: String(s.port ?? ''), user: s.user ?? '',
        from: s.from ?? '', senderName: s.senderName ?? '', secure: s.secure !== false, pass: '',
      })
      filled.current = true
    }
  }, [cfgQ.data])

  async function save() {
    setBusy(true); setMsg('')
    try {
      await api('/admin/smtp', { method: 'PUT', body: { ...form, port: Number(form.port) || 465 } })
      setMsg('✓ 邮件服务配置已保存')
      setForm((f) => ({ ...f, pass: '' }))
      cfgQ.reload()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '保存失败')
    } finally { setBusy(false) }
  }

  async function sendTest() {
    setTesting(true); setTestMsg('')
    try {
      const res = await api<{ previewUrl?: string }>('/admin/smtp/test', { method: 'POST', body: { to: testTo } })
      setTestMsg(`✓ 测试邮件已发出（MessageID 已生成）${res.previewUrl ? '，可在此预览：' + res.previewUrl : ''}`)
    } catch (e) {
      setTestMsg(e instanceof Error ? e.message : '发送失败')
    } finally { setTesting(false) }
  }

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><Mail size={15} className="text-brand-600" /> 邮件服务（SMTP）</span>}
        desc="配置后系统将以自身身份直接发送邀请邮件与通知（兼容企业邮箱 / QQ / 163 / 阿里云邮件推送等标准 SMTP）"
        actions={configured ? <Badge color="green" dot>已配置</Badge> : <Badge color="amber" dot>未配置（邀请走 mailto 降级）</Badge>}
      />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Field label="SMTP 服务器" required hint="如 smtp.exmail.qq.com"><Input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="smtp.example.com" /></Field>
        <Field label="端口" hint="SSL 通常 465，STARTTLS 为 587"><Input value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} /></Field>
        <Field label="账号" required><Input value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} placeholder="发件邮箱账号" /></Field>
        <Field label="密码 / 授权码" hint={configured ? '已保存，留空表示沿用' : '邮箱密码或 SMTP 授权码'}>
          <Input type="password" value={form.pass} onChange={(e) => setForm({ ...form, pass: e.target.value })} placeholder={configured ? '••••••••' : ''} />
        </Field>
        <Field label="发件人地址" required><Input value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} placeholder="ontoos@xingchen-mfg.com" /></Field>
        <Field label="发件人名称"><Input value={form.senderName} onChange={(e) => setForm({ ...form, senderName: e.target.value })} /></Field>
        <Field label="加密方式">
          <div className="flex gap-2">
            {([[true, 'SSL（465）'], [false, 'STARTTLS（587）']] as const).map(([v, label]) => (
              <button key={String(v)} onClick={() => setForm({ ...form, secure: v })}
                className={cn('flex-1 rounded-lg border px-3 py-2 text-[13px] font-medium', form.secure === v ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-500')}>
                {label}
              </button>
            ))}
          </div>
        </Field>
        <div className="flex items-end gap-2">
          <Btn variant="primary" onClick={save} disabled={busy || !loaded}>
            {busy ? <><Loader2 size={13} className="animate-spin" /> 保存中…</> : <><Save size={13} /> 保存配置</>}
          </Btn>
          <Btn onClick={() => { setForm(EMPTY_SMTP); setMsg('') }}><RotateCcw size={13} /> 清空</Btn>
        </div>
      </div>
      {configured && cfgQ.data?.smtp && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-[11px] text-emerald-800">
          <Badge color="green" dot>已保存</Badge>
          <span>服务器：<code className="rounded bg-white/70 px-1 font-mono">{cfgQ.data.smtp.host}:{cfgQ.data.smtp.port}</code></span>
          <span>发件人：<code className="rounded bg-white/70 px-1 font-mono">{cfgQ.data.smtp.from}</code></span>
          <span className="text-emerald-600">密码已保存（不回显，留空即沿用）</span>
        </div>
      )}
      {msg && <div className={cn('mt-3 rounded-lg px-3 py-2 text-xs', msg.startsWith('✓') ? 'border border-emerald-200 bg-emerald-50 text-emerald-700' : 'border border-red-200 bg-red-50 text-red-600')}>{msg}</div>}

      {configured && (
        <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4">
          <Field label="发送测试邮件" hint="发到你自己的邮箱验证配置"><Input className="w-72" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" /></Field>
          <Btn onClick={sendTest} disabled={testing || !testTo}>{testing ? <><Loader2 size={13} className="animate-spin" /> 发送中…</> : <><Send size={13} /> 发送测试</>}</Btn>
          {testMsg && <div className={cn('w-full rounded-lg px-3 py-2 text-xs', testMsg.startsWith('✓') ? 'border border-emerald-200 bg-emerald-50 text-emerald-700' : 'border border-red-200 bg-red-50 text-red-600')}>{testMsg}</div>}
        </div>
      )}
    </Card>
  )
}

/* ---------- AI 服务（真实配置，OpenAI 兼容接口） ---------- */
const EMPTY_AI = { endpoint: '', model: '', apiKey: '' }

function AiCard() {
  const cfgQ = useApi<{ configured: boolean; config?: typeof EMPTY_AI }>('/ai/config')
  const [form, setForm] = useState<typeof EMPTY_AI>(EMPTY_AI)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState('')
  const configured = cfgQ.data?.configured ?? false
  const loaded = useRef(false)

  // 回显已保存配置（API Key 服务端不回传，保持空；留空保存表示沿用）
  useEffect(() => {
    if (cfgQ.data && !loaded.current) {
      const c = cfgQ.data.config
      if (c) setForm({ endpoint: c.endpoint ?? '', model: c.model ?? '', apiKey: '' })
      loaded.current = true
    }
  }, [cfgQ.data])

  async function save() {
    setBusy(true); setMsg('')
    try {
      await api('/ai/config', { method: 'PUT', body: form })
      setMsg('✓ AI 服务配置已保存，AIP 助手将使用真实大模型')
      // 保存后清空密码占位并保留 endpoint/model，避免看起来像没配过
      setForm((f) => ({ ...f, apiKey: '' }))
      cfgQ.reload()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '保存失败')
    } finally { setBusy(false) }
  }

  async function test() {
    setTesting(true); setTestMsg('')
    try {
      const res = await api<{ reply: string }>('/ai/test', { method: 'POST' })
      setTestMsg(`✓ 连通成功，模型回复：「${res.reply.slice(0, 40)}」`)
    } catch (e) {
      setTestMsg(e instanceof Error ? e.message : '测试失败')
    } finally { setTesting(false) }
  }

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><Sparkles size={15} className="text-violet-600" /> AI 服务（AIP 助手）</span>}
        desc="OpenAI 兼容接口（Endpoint + Key + 模型），配置后 AIP 助手支持自然语言对话与工具调用；未配置时使用本地意图引擎"
        actions={configured ? <Badge color="green" dot>已配置</Badge> : <Badge color="amber" dot>本地引擎</Badge>}
      />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Field label="接口地址（Base URL）" required hint="如 https://api.openai.com/v1 或自建网关"><Input value={form.endpoint} onChange={(e) => setForm({ ...form, endpoint: e.target.value })} placeholder="https://your-gateway/v1" /></Field>
        <Field label="模型名称" required hint="如 glm-4.6 / gpt-4o / 自建池模型"><Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="glm-4.6" /></Field>
        <Field label="API Key" hint={configured ? '已保存，留空表示沿用' : '服务端保存，不会下发给前端'}>
          <Input type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder={configured ? '••••••••' : 'sk-…'} />
        </Field>
        <div className="flex items-end gap-2">
          <Btn variant="primary" onClick={save} disabled={busy}>
            {busy ? <><Loader2 size={13} className="animate-spin" /> 保存中…</> : <><Save size={13} /> 保存配置</>}
          </Btn>
          {configured && <Btn onClick={test} disabled={testing}>{testing ? <><Loader2 size={13} className="animate-spin" /> 测试中…</> : '连通测试'}</Btn>}
        </div>
      </div>
      {/* 已保存配置概览：让「配过了」一眼可见，不依赖输入框（密钥不回传） */}
      {configured && cfgQ.data?.config && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-[11px] text-emerald-800">
          <Badge color="green" dot>已保存</Badge>
          <span>端点：<code className="rounded bg-white/70 px-1 font-mono">{cfgQ.data.config.endpoint}</code></span>
          <span>模型：<code className="rounded bg-white/70 px-1 font-mono">{cfgQ.data.config.model}</code></span>
          <span className="text-emerald-600">密钥已保存（不回显，留空即沿用）</span>
        </div>
      )}
      {msg && <div className={cn('mt-3 rounded-lg px-3 py-2 text-xs', msg.startsWith('✓') ? 'border border-emerald-200 bg-emerald-50 text-emerald-700' : 'border border-red-200 bg-red-50 text-red-600')}>{msg}</div>}
      {testMsg && <div className={cn('mt-2 rounded-lg px-3 py-2 text-xs', testMsg.startsWith('✓') ? 'border border-emerald-200 bg-emerald-50 text-emerald-700' : 'border border-red-200 bg-red-50 text-red-600')}>{testMsg}</div>}
    </Card>
  )
}

/* ---------- 嵌入模型（真实配置，知识检索语义向量化用） ---------- */

const EMPTY_EMB = { model: 'embedding-2', endpoint: '', apiKey: '', enabled: true }

function EmbedCard() {
  const cfgQ = useApi<{ embedding?: { model: string; endpoint?: string; apiKey?: string; enabled: boolean } }>('/admin/embedding')
  const [model, setModel] = useState('embedding-2')
  const [endpoint, setEndpoint] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState('')
  const loaded = useRef(false)

  useEffect(() => {
    if (cfgQ.data && !loaded.current) {
      const e = cfgQ.data.embedding
      setModel(e?.model ?? 'embedding-2')
      setEndpoint(e?.endpoint ?? '')
      setApiKey(e?.apiKey ?? '')
      setEnabled(e?.enabled !== false)
      loaded.current = true
    }
  }, [cfgQ.data])

  async function save() {
    setBusy(true); setMsg('')
    try {
      await api('/admin/embedding', { method: 'PUT', body: { model, endpoint: endpoint.trim(), apiKey: apiKey.trim(), enabled } })
      setMsg('✓ 嵌入模型配置已保存，到知识库点「重建索引」生效')
    } catch (e) { setMsg(e instanceof Error ? e.message : '保存失败') }
    finally { setBusy(false) }
  }

  async function test() {
    setTesting(true); setTestMsg('')
    try {
      const res = await api<{ ok: boolean; dim: number; model: string }>('/admin/embedding/test', { method: 'POST' })
      setTestMsg(`✓ 连通成功！${res.model} 返回 ${res.dim} 维向量`)
    } catch (e) { setTestMsg(e instanceof Error ? e.message : '测试失败') }
    finally { setTesting(false) }
  }

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><Layers size={15} className="text-cyan-600" /> 嵌入模型（知识检索向量化）</span>}
        desc="配置 OpenAI 兼容的 /embeddings 接口后，知识检索升级为真正的语义检索。可填独立端点（如智谱网关），不填则用 AI 服务的端点。"
        actions={enabled ? <Badge color="green" dot>{model}</Badge> : <Badge color="amber" dot>本地哈希</Badge>}
      />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Field label="嵌入模型名称" required hint="如 embedding-2 / text-embedding-3-small / bge-m3">
          <Input value={model} onChange={(e) => setModel(e.target.value)} />
        </Field>
        <Field label="专属端点（可选）" hint="留空则用 AI 服务端点。填独立地址可分流">
          <Input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="http://local.bigmodel.cn:8080/v1" />
        </Field>
        <Field label="专属密钥（可选）" hint="留空则用 AI 服务密钥">
          <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="(沿用 AI Key)" />
        </Field>
        <Field label="启用">
          <div className="flex gap-2 pt-1">
            <button onClick={() => setEnabled(true)} className={cn('flex-1 rounded-lg border px-3 py-2 text-[13px] font-medium', enabled ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-500')}>远程嵌入</button>
            <button onClick={() => setEnabled(false)} className={cn('flex-1 rounded-lg border px-3 py-2 text-[13px] font-medium', !enabled ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-500')}>仅本地</button>
          </div>
        </Field>
      </div>
      <div className="mt-3 flex items-end gap-2">
        <Btn variant="primary" size="sm" onClick={save} disabled={busy}>
          {busy ? <><Loader2 size={13} className="animate-spin" /> 保存…</> : <><Save size={13} /> 保存配置</>}
        </Btn>
        <Btn size="sm" onClick={test} disabled={testing || !enabled}>{testing ? <><Loader2 size={13} className="animate-spin" /> 测试…</> : '测试连通'}</Btn>
      </div>
      {msg && <div className={cn('mt-3 rounded-lg px-3 py-2 text-xs', msg.startsWith('✓') ? 'border border-emerald-200 bg-emerald-50 text-emerald-700' : 'border border-red-200 bg-red-50 text-red-600')}>{msg}</div>}
      {testMsg && <div className={cn('mt-2 rounded-lg px-3 py-2 text-xs', testMsg.startsWith('✓') ? 'border border-emerald-200 bg-emerald-50 text-emerald-700' : 'border border-red-200 bg-red-50 text-red-600')}>{testMsg}</div>}
    </Card>
  )
}

/* ---------- 视觉模型（票据扫描识别用） ---------- */

function VisionCard() {
  const cfgQ = useApi<{ configured: boolean; model: string; endpoint: string; textModel: string; textEndpoint: string; textApiKeyConfigured: boolean }>('/scan/config')
  const [model, setModel] = useState('glm-4v-flash')
  const [textModel, setTextModel] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [textEndpoint, setTextEndpoint] = useState('')
  const [textApiKey, setTextApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const loaded = useRef(false)

  useEffect(() => {
    if (cfgQ.data && !loaded.current) {
      setModel(cfgQ.data.model || 'glm-4v-flash')
      setTextModel(cfgQ.data.textModel || '')
      setEndpoint(cfgQ.data.endpoint || '')
      setTextEndpoint(cfgQ.data.textEndpoint || '')
      loaded.current = true
    }
  }, [cfgQ.data])

  async function save() {
    setBusy(true); setMsg('')
    try {
      await api('/admin/vision', {
        method: 'PUT',
        body: {
          model, textModel,
          endpoint: endpoint.trim(), apiKey: apiKey.trim(),
          // 文本模型独立端点/密钥（可选）：留空沿用视觉端点；textApiKey 留空且未配置过则沿用视觉密钥
          textEndpoint: textEndpoint.trim(), textApiKey: textApiKey.trim(),
        },
      })
      setMsg('✓ 模型配置已保存（扫描录入已就绪）')
    } catch (e) { setMsg(e instanceof Error ? e.message : '保存失败') }
    finally { setBusy(false) }
  }

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><Camera size={15} className="text-brand-600" /> 视觉模型（票据扫描识别）</span>}
        desc="配置支持图片输入的视觉模型后，扫描录入功能可用（上传小票/订单截图 → 自动提取字段入库）。推荐 glm-4v-flash（智谱免费视觉模型）。"
        actions={cfgQ.data?.configured ? <Badge color="green" dot>{model}</Badge> : <Badge color="amber" dot>未配置</Badge>}
      />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Field label="视觉模型" required hint="如 glm-4v-flash / qwen2.5vl:7b">
          <Input value={model} onChange={(e) => setModel(e.target.value)} />
        </Field>
        <Field label="文本提取模型（可选）" hint="留空 = 跟随 AI 服务（与 AIP 助手同款模型）；填写则按下方端点路由，如 glm-5.3-flash / qwen2.5:7b">
          <Input value={textModel} onChange={(e) => setTextModel(e.target.value)} />
        </Field>
        <Field label="专属端点（可选）" hint="留空用 AI 网关端点；本地部署填 Ollama/vLLM 地址">
          <Input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="http://localhost:11434/v1" />
        </Field>
        <Field label="专属密钥（可选）" hint="留空沿用 AI 服务密钥；本地部署填任意非空值">
          <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="(沿用 AI Key)" />
        </Field>
        <Field label="文本模型专属端点（可选）" hint="视觉与文本分属不同服务时填写；留空与视觉共用上方端点">
          <Input value={textEndpoint} onChange={(e) => setTextEndpoint(e.target.value)} placeholder="(共用视觉端点)" />
        </Field>
        <Field label="文本模型专属密钥（可选）" hint="留空沿用视觉密钥">
          <Input type="password" value={textApiKey} onChange={(e) => setTextApiKey(e.target.value)} placeholder="(沿用视觉密钥)" />
        </Field>
      </div>
      <div className="mt-3 flex items-end gap-2">
        <Btn variant="primary" size="sm" onClick={save} disabled={busy}>
          {busy ? <><Loader2 size={13} className="animate-spin" /> 保存…</> : <><Save size={13} /> 保存配置</>}
        </Btn>
        <span className="text-[11px] text-slate-400">当前识别入口：顶栏「扫描录入」、对象浏览器「扫描填表」</span>
      </div>
      {msg && <div className={cn('mt-3 rounded-lg px-3 py-2 text-xs', msg.startsWith('✓') ? 'border border-emerald-200 bg-emerald-50 text-emerald-700' : 'border border-red-200 bg-red-50 text-red-600')}>{msg}</div>}
    </Card>
  )
}

/* ---------- 功能开关（真实配置） ---------- */
interface UsageResp {
  metrics: { objects: number; documents: number; chunks: number; aiMessages: number; auditToday: number; auditWeek: number }
  tokenTrend: { day: string; tokens: number }[]
  services: { name: string; metric: string; ok: boolean }[]
}

interface FeatureSwitch {
  key: string
  name: string
  desc: string
  icon: LucideIcon
  on: boolean
}

const FEATURE_SWITCHES: FeatureSwitch[] = [
  { key: 'aip-logic', name: 'AIP Logic', desc: '无代码 LLM 工作流编排：提示、工具调用与分支', icon: Sparkles, on: true },
  { key: 'agent-studio', name: 'Agent Studio', desc: '构建可调用本体工具与检索的智能体', icon: Bot, on: true },
  { key: 'workshop', name: 'Workshop', desc: '拖拽组件搭建运营应用并发布', icon: MousePointerClick, on: true },
  { key: 'marketplace', name: 'Marketplace', desc: '产品市场：安装与发布可复用应用', icon: Store, on: false },
  { key: 'sensitive-scan', name: '敏感数据扫描', desc: '定期扫描数据表敏感字段并提醒处置', icon: ShieldCheck, on: true },
]

/** 控制面板：功能开关 / 用量监控 / 可观测性 */
interface EnvResp {
  runtime: string; platform: string; mode: string; database: string
  space: { name: string; kind: string } | null; uptimeSeconds: number
}

export default function ControlPanelPage() {
  const featQ = useApi<{ features: Record<string, boolean> }>('/admin/features')
  const usageQ = useApi<UsageResp>('/admin/usage')
  const envQ = useApi<EnvResp>('/admin/environment')
  const [switches, setSwitches] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (featQ.data?.features) setSwitches(featQ.data.features) }, [featQ.data])

  async function toggleFeature(key: string) {
    const next = { ...switches, [key]: !switches[key] }
    setSwitches(next)
    setBusy(true)
    try {
      await api('/admin/features', { method: 'PUT', body: next })
      featQ.reload()
    } catch (e) { setSwitches(switches) }
    finally { setBusy(false) }
  }

  return (
    <PageShell
      icon={SlidersHorizontal}
      title="控制面板"
      subtitle="平台功能开关、用量配额与服务可观测性的一站式管理"
      benchmark="平台运维"
      features={[
        '功能开关：按租户粒度启停 AIP Logic、Agent Studio 等平台能力，立即生效',
        '用量监控：LLM Token、对象存储、函数计算的配额消耗与近 14 天趋势',
        '阈值预警：配额消耗超过 80% 自动通知平台管理员并支持临时扩容',
        '可观测性：核心服务健康状态与 P99 延迟实时总览',
        '环境信息：平台版本、部署区域、租户与 Rubix 服务网格连接状态',
      ]}
    >
      {/* 邮件服务（真实配置） */}
      <SmtpCard />

      {/* AI 服务（真实配置） */}
      <AiCard />

      {/* 嵌入模型（真实配置，供知识检索语义向量化） */}
      <EmbedCard />

      {/* 视觉模型（票据/单据扫描识别） */}
      <VisionCard />

      {/* 功能开关 */}
      <Card>
        <CardHeader title="功能开关" desc="按租户粒度启停平台能力（示例可点击切换）" actions={<span className="text-xs text-slate-400">已启用 {Object.values(switches).filter(Boolean).length} / {FEATURE_SWITCHES.length}</span>} />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {FEATURE_SWITCHES.map((f) => {
            const on = switches[f.key]
            return (
              <div key={f.key} className={cn('rounded-xl border p-3.5 transition-colors', on ? 'border-brand-200 bg-brand-50/40' : 'border-slate-200')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', on ? 'bg-brand-100 text-brand-600' : 'bg-slate-100 text-slate-400')}>
                      <f.icon size={15} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-[13px] font-bold text-slate-800">
                        {f.name}
                        {on && <Badge color="green">已启用</Badge>}
                      </div>
                      <div className="mt-0.5 text-[11px] leading-4 text-slate-500">{f.desc}</div>
                    </div>
                  </div>
                  <button
                    aria-label={`切换 ${f.name}`}
                    onClick={() => toggleFeature(f.key)}
                    className={cn('relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors', on ? 'bg-brand-600' : 'bg-slate-200')}
                  >
                    <span className={cn('absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', on && 'left-[18px]')} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      {/* 用量监控（真实数据） */}
      <Card>
        <CardHeader title="用量监控" desc="按审计/对象/文档/消息表实时聚合" actions={<Btn size="sm" onClick={() => usageQ.reload()}><Activity size={12} /> 刷新</Btn>} />
        <div className="grid gap-3 md:grid-cols-3">
          {[
            { label: '对象实例', value: String(usageQ.data?.metrics.objects ?? 0), note: 'objects 表', icon: Database, iconClass: 'bg-brand-50 text-brand-600', pct: 100 },
            { label: '知识分块', value: String(usageQ.data?.metrics.chunks ?? 0), note: `${usageQ.data?.metrics.documents ?? 0} 篇文档`, icon: Cpu, iconClass: 'bg-violet-50 text-violet-600', pct: 100 },
            { label: 'AI 消息', value: String(usageQ.data?.metrics.aiMessages ?? 0), note: `今日审计 ${usageQ.data?.metrics.auditToday ?? 0} 条`, icon: Sparkles, iconClass: 'bg-amber-50 text-amber-600', pct: 100 },
          ].map((u) => (
            <div key={u.label} className="rounded-xl border border-slate-100 p-3.5">
              <div className="flex items-center gap-3">
                <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', u.iconClass)}>
                  <u.icon size={17} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-slate-400">{u.label}</div>
                  <div className="text-lg font-bold text-slate-900">{u.value}</div>
                  <div className="mt-1.5 text-[11px] text-slate-400">{u.note}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={usageQ.data?.tokenTrend ?? []} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} interval={1} />
              <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
              <Line type="monotone" dataKey="tokens" name="AI 活动量" stroke="#3b82f6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-1 text-center text-[11px] text-slate-400">近 14 天 AI/识别相关审计活动趋势</div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* 可观测性（真实计数） */}
        <Card>
          <CardHeader title="可观测性" desc="各子系统真实状态（按数据库记录聚合）" />
          <div className="divide-y divide-slate-100">
            {(usageQ.data?.services ?? []).map((s) => (
              <div key={s.name} className="flex items-center gap-3 py-2.5">
                <StatusDot color={s.ok ? 'green' : 'red'} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-semibold text-slate-800">{s.name}</div>
                </div>
                <Badge color={s.ok ? 'green' : 'red'}>{s.metric}</Badge>
              </div>
            ))}
          </div>
        </Card>

        {/* 环境信息：全部来自真实运行时，不再展示虚构的部署区域/服务网格 */}
        <Card className="h-fit">
          <CardHeader title="环境信息" desc="当前运行时真实状态（本地单进程）" />
          <KVList
            cols={1}
            items={[
              { k: '运行时', v: envQ.data?.runtime ?? '—' },
              { k: '操作系统', v: envQ.data?.platform ?? '—' },
              { k: '运行模式', v: envQ.data?.mode ?? '—' },
              { k: '数据库', v: envQ.data?.database ?? '—' },
              { k: '当前空间', v: envQ.data?.space ? `${envQ.data.space.name}（${envQ.data.space.kind}）` : '—' },
              { k: '进程已运行', v: envQ.data ? `${Math.floor(envQ.data.uptimeSeconds / 60)} 分钟` : '—' },
            ]}
          />
          <div className="mt-4 rounded-lg border border-dashed border-slate-200 p-3 text-[11px] leading-4 text-slate-400">
            功能开关变更会记录审计日志。多集群部署、服务网格与发布窗口属 Apollo 规划能力（见其演示视图说明），本地版本未接入。
          </div>
        </Card>
      </div>
    </PageShell>
  )
}
