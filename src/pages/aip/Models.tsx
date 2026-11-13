import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Activity, Calendar, Cpu, Loader2, Plug, Plus, RefreshCw, ShieldCheck, Trash2, X, Zap } from 'lucide-react'
import PageShell from '@/components/ui/PageShell'
import Btn from '@/components/ui/Btn'
import { Badge, type BadgeColor } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import DataTable from '@/components/ui/DataTable'
import StatCard from '@/components/ui/StatCard'
import { Input, Field, Select } from '@/components/ui/Form'
import { KVList } from '@/components/ui/Misc'
import { api } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'

/* ---------- 真实接口返回结构（server/routes/p10.ts、server/routes/ai.ts） ---------- */
interface ModelItem {
  id: string
  name: string
  provider: string
  type: string
  status: string
  configured: boolean
  endpoint?: string
}
interface TokenUsage { today: number; week: number; month: number; unit?: string; note?: string }
interface ModelsResp { models: ModelItem[]; tokenUsage: TokenUsage }

/* ---------- 已注册模型（server/routes/governance.ts：/api/gov/models） ---------- */
interface RegisteredModel {
  id: string
  name: string
  provider: string
  type: string
  endpoint: string
  model: string
  enabled: boolean
  quota: number
}
interface RegisteredModelsResp { models: RegisteredModel[] }

/** 次数可读化：过万显示为「x.x 万」 */
function fmtCount(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)} 万`
  return n.toLocaleString('zh-CN')
}

function statusColor(s: string): BadgeColor {
  if (s.includes('连接') || s.includes('启用')) return 'green'
  if (s.includes('禁用')) return 'red'
  if (s.includes('备用') || s.includes('灰度')) return 'amber'
  return 'slate'
}

/** 通用弹层：点击遮罩或右上角关闭按钮均关闭 */
function Modal({ title, desc, onClose, children }: { title: string; desc?: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <div className="w-[480px] max-w-[94vw] rounded-2xl border border-slate-200 bg-white p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-sm font-bold text-slate-900">{title}</div>
            {desc && <div className="mt-0.5 text-[11px] text-slate-400">{desc}</div>}
          </div>
          <button aria-label="关闭" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** BYOM 模型管理：模型列表 / token 用量 / 注册配置 / 已注册模型编目全部来自真实接口 */
export default function ModelsPage() {
  const modelsQ = useApi<ModelsResp>('/p10/models')
  const registeredQ = useApi<RegisteredModelsResp>('/gov/models')
  const [toast, setToast] = useState<{ msg: string; err: boolean } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState({ endpoint: '', model: '', apiKey: '' })
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  /* 已注册模型：新建弹层 / 删除确认 / 写操作 loading */
  const [regModalOpen, setRegModalOpen] = useState(false)
  const [regForm, setRegForm] = useState({ name: '', provider: '', type: '对话', endpoint: '', model: '', quota: '' })
  const [regSaving, setRegSaving] = useState(false)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [regDeleting, setRegDeleting] = useState<string | null>(null)

  function notify(msg: string, err = false) {
    setToast({ msg, err })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3200)
  }

  // 加载失败也通过错误 toast 提示
  useEffect(() => {
    if (modelsQ.error) notify(modelsQ.error, true)
  }, [modelsQ.error])
  useEffect(() => {
    if (registeredQ.error) notify(`已注册模型加载失败：${registeredQ.error}`, true)
  }, [registeredQ.error])

  const models = modelsQ.data?.models ?? []
  const usage = modelsQ.data?.tokenUsage
  const chatModel = models.find((m) => m.id === 'chat')
  const registered = registeredQ.data?.models ?? []

  function openModal() {
    // 预填来自真实列表的已接入对话模型，密钥永不回显
    setForm({ endpoint: chatModel?.endpoint ?? '', model: chatModel?.name ?? '', apiKey: '' })
    setModalOpen(true)
  }

  async function saveConfig() {
    if (!form.endpoint.trim() || !form.model.trim()) return notify('请填写接口地址与模型名称', true)
    setSaving(true)
    try {
      await api('/ai/config', {
        method: 'PUT',
        body: { endpoint: form.endpoint.trim(), model: form.model.trim(), apiKey: form.apiKey.trim() },
      })
      notify('✓ 模型已注册（AI 服务配置已保存）')
      setModalOpen(false)
      modelsQ.reload()
    } catch (e) {
      notify(e instanceof Error ? e.message : '保存失败', true)
    } finally {
      setSaving(false)
    }
  }

  async function testConn() {
    setTesting(true)
    try {
      const res = await api<{ ok: boolean; reply: string }>('/ai/test', { method: 'POST' })
      notify(`✓ 连通成功，模型回复：「${(res.reply ?? '').slice(0, 40)}」`)
    } catch (e) {
      notify(e instanceof Error ? e.message : '测试失败', true)
    } finally {
      setTesting(false)
    }
  }

  function openRegModal() {
    setRegForm({ name: '', provider: '', type: '对话', endpoint: '', model: '', quota: '' })
    setRegModalOpen(true)
  }

  async function saveRegistered() {
    if (!regForm.name.trim()) return notify('请填写模型名称', true)
    const quota = Number.parseInt(regForm.quota.trim(), 10)
    setRegSaving(true)
    try {
      await api('/gov/models', {
        method: 'POST',
        body: {
          name: regForm.name.trim(),
          provider: regForm.provider.trim() || undefined,
          type: regForm.type.trim() || undefined,
          endpoint: regForm.endpoint.trim() || undefined,
          model: regForm.model.trim() || undefined,
          quota: Number.isNaN(quota) ? undefined : quota,
        },
      })
      notify('✓ 模型已注册到编目清单')
      setRegModalOpen(false)
      registeredQ.reload()
    } catch (e) {
      notify(e instanceof Error ? e.message : '注册失败', true)
    } finally {
      setRegSaving(false)
    }
  }

  async function removeRegistered(id: string) {
    setRegDeleting(id)
    try {
      await api(`/gov/models/${id}`, { method: 'DELETE' })
      notify('✓ 已删除模型注册')
      setConfirmDel(null)
      registeredQ.reload()
    } catch (e) {
      notify(e instanceof Error ? e.message : '删除失败', true)
    } finally {
      setRegDeleting(null)
    }
  }

  return (
    <PageShell
      icon={Cpu}
      title="模型管理"
      subtitle="统一接入自建与第三方大模型：读取真实 AI 服务配置、真实调用量与已注册模型编目"
      benchmark="模型接入"
      features={[
        '模型清单：来自平台真实 AI / 嵌入配置，含提供方、类型与连接状态',
        '调用量：按今日 / 近 7 日 / 近 30 日真实聚合 AI 回复次数（非网关 token）',
        '自定义注册：写入平台 AI 服务配置（OpenAI 兼容协议）并即时刷新列表',
        '已注册模型：真实落库的模型编目清单，支持注册 / 删除与配额治理',
        '连通测试：向已配置模型发起最小对话验证可用性',
      ]}
      actions={
        <>
          <Btn size="sm" onClick={testConn} disabled={testing || !chatModel}>
            {testing ? <><Loader2 size={13} className="animate-spin" /> 测试中…</> : <><Zap size={13} /> 测试连接</>}
          </Btn>
          <Btn size="sm" variant="primary" onClick={openModal}><Plus size={13} /> 注册模型</Btn>
        </>
      }
    >
      {toast && (
        <div className={cn('rounded-lg border px-4 py-2.5 text-sm font-medium',
          toast.err ? 'border-red-200 bg-red-50 text-red-600' : 'border-emerald-200 bg-emerald-50 text-emerald-700')}>
          {toast.msg}
        </div>
      )}

      {modelsQ.loading ? (
        <Card className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
          <Loader2 size={15} className="animate-spin" /> 加载模型数据…
        </Card>
      ) : modelsQ.error ? (
        <Card className="flex flex-col items-center gap-3 py-14 text-center">
          <div className="text-sm text-red-600">加载失败：{modelsQ.error}</div>
          <Btn size="sm" onClick={modelsQ.reload}><RefreshCw size={13} /> 重试</Btn>
        </Card>
      ) : (
        <>
          {/* 调用量：真实消息数聚合，口径明确标注 */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <StatCard label="今日 AI 回复" value={usage ? fmtCount(usage.today) : '—'} unit="次" icon={Zap} />
            <StatCard label="近 7 日 AI 回复" value={usage ? fmtCount(usage.week) : '—'} unit="次" icon={Activity} iconClass="bg-violet-50 text-violet-600" />
            <StatCard label="近 30 日 AI 回复" value={usage ? fmtCount(usage.month) : '—'} unit="次" icon={Calendar} iconClass="bg-emerald-50 text-emerald-600" />
          </div>
          {usage?.note && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-500">
              口径说明：{usage.note}
            </div>
          )}

          {/* 已注册模型：真实 CRUD 编目清单 */}
          <Card>
            <CardHeader
              title={<span className="flex items-center gap-1.5"><Plug size={14} className="text-brand-600" /> 已注册模型</span>}
              desc={`共 ${registered.length} 个 · 真实落库的模型编目 / 配额治理（POST/DELETE /api/gov/models）`}
              actions={
                <>
                  <Btn size="sm" onClick={registeredQ.reload}><RefreshCw size={12} /> 刷新</Btn>
                  <Btn size="sm" variant="primary" onClick={openRegModal}><Plus size={12} /> 注册</Btn>
                </>
              }
            />
            {registeredQ.loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400"><Loader2 size={14} className="animate-spin" /> 加载已注册模型…</div>
            ) : registeredQ.error ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <div className="text-xs text-red-600">加载失败：{registeredQ.error}</div>
                <Btn size="sm" onClick={registeredQ.reload}><RefreshCw size={12} /> 重试</Btn>
              </div>
            ) : (
              <DataTable
                dense
                rows={registered}
                rowKey={(m) => m.id}
                columns={[
                  { key: 'name', header: '名称', cell: (m) => (
                    <span>
                      <span className="font-semibold text-slate-800">{m.name}</span>
                      <span className="block truncate text-[11px] text-slate-400" title={m.endpoint}>{m.endpoint || '未提供端点'}</span>
                    </span>
                  ) },
                  { key: 'provider', header: '提供方', cell: (m) => <span className="text-xs text-slate-600">{m.provider || '—'}</span> },
                  { key: 'type', header: '类型', cell: (m) => <Badge color={m.type.includes('向量') ? 'violet' : 'blue'}>{m.type || '—'}</Badge> },
                  { key: 'model', header: '模型标识', cell: (m) => <code className="font-mono text-[11px] text-brand-700">{m.model || '—'}</code> },
                  { key: 'quota', header: '配额', align: 'center', cell: (m) => <span className="text-xs text-slate-600">{m.quota > 0 ? m.quota.toLocaleString('zh-CN') : '不限'}</span> },
                  { key: 'enabled', header: '状态', align: 'center', cell: (m) => <Badge color={m.enabled ? 'green' : 'slate'} dot>{m.enabled ? '已启用' : '已禁用'}</Badge> },
                  { key: 'op', header: '操作', align: 'right', width: '130px', cell: (m) => (
                    confirmDel === m.id ? (
                      <span className="inline-flex items-center justify-end gap-1.5 whitespace-nowrap text-[11px]">
                        <span className="text-red-600">确认删除？</span>
                        <Btn size="sm" variant="danger" disabled={regDeleting === m.id} onClick={() => removeRegistered(m.id)}>
                          {regDeleting === m.id ? <Loader2 size={12} className="animate-spin" /> : '确认'}
                        </Btn>
                        <Btn size="sm" variant="ghost" onClick={() => setConfirmDel(null)}>取消</Btn>
                      </span>
                    ) : (
                      <button onClick={() => setConfirmDel(m.id)} className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-red-500" title="删除该注册模型">
                        <Trash2 size={12} /> 删除
                      </button>
                    )
                  ) },
                ]}
              />
            )}
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-[11px] leading-5 text-slate-500">
              <ShieldCheck size={13} className="mt-0.5 shrink-0 text-brand-500" />
              平台运行时仍使用单一全局 AI 配置（上方「AI 服务接入」），注册模型仅用于模型编目 / 配额治理，不会切换线上推理端点。
            </div>
          </Card>

          {/* 模型卡片（真实列表） */}
          <Card>
            <CardHeader
              title="已接入模型"
              desc={`共 ${models.length} 个 · 来源于平台 AI / 嵌入服务配置`}
              actions={<Btn size="sm" onClick={modelsQ.reload}><RefreshCw size={12} /> 刷新</Btn>}
            />
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {models.map((m) => (
                <div key={m.id} className="flex flex-col gap-2.5 rounded-xl border border-slate-200 p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-slate-900">{m.name}</span>
                        <Badge color={m.type.includes('向量') ? 'violet' : 'blue'}>{m.type}</Badge>
                      </div>
                      <div className="mt-1 truncate text-[11px] text-slate-400" title={m.endpoint}>
                        {m.endpoint || '平台内置 · 无需外部端点'}
                      </div>
                    </div>
                    <Badge color={statusColor(m.status)} dot>{m.status}</Badge>
                  </div>
                  <div className="mt-auto grid grid-cols-2 gap-2 border-t border-slate-100 pt-2.5 text-center">
                    <div>
                      <div className="text-[10px] text-slate-400">提供方</div>
                      <div className="mt-0.5 truncate text-[12px] font-medium text-slate-700">{m.provider}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400">配置状态</div>
                      <div className={cn('mt-0.5 text-[12px] font-medium', m.configured ? 'text-emerald-600' : 'text-slate-400')}>
                        {m.configured ? '已配置' : '未配置'}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* AI 服务接入说明（真实配置） */}
          <Card>
            <CardHeader
              title={<span className="flex items-center gap-1.5"><Plug size={14} className="text-brand-600" /> AI 服务接入</span>}
              desc="注册模型写入平台 AI 服务配置；OpenAI 兼容 /chat/completions 协议"
              actions={<Btn size="sm" variant="primary" onClick={openModal}>配置 / 修改</Btn>}
            />
            <KVList
              items={[
                { k: '接口地址', v: chatModel?.endpoint ? <span className="font-mono text-[12px]">{chatModel.endpoint}</span> : <span className="text-slate-400">尚未配置</span> },
                { k: '对话模型', v: chatModel?.name ?? <span className="text-slate-400">尚未配置</span> },
                { k: '连接状态', v: chatModel ? <Badge color={statusColor(chatModel.status)} dot>{chatModel.status}</Badge> : <span className="text-slate-400">未接入</span> },
              ]}
            />
            <div className="mt-3 flex items-start gap-2 rounded-lg bg-slate-50 p-2.5 text-[11px] leading-5 text-slate-500">
              <ShieldCheck size={13} className="mt-0.5 shrink-0 text-emerald-500" />
              密钥仅写入服务端配置，页面不回显明文；留空表示沿用已保存密钥。注册与连通测试需管理员权限，失败会以顶部错误提示告知。
            </div>
          </Card>
        </>
      )}

      {/* 注册 / 修改模型配置弹层（原有 AI 服务配置，保留） */}
      {modalOpen && (
        <Modal title="注册 / 修改模型" desc="保存后写入平台 AI 服务配置（PUT /api/ai/config）" onClose={() => setModalOpen(false)}>
          <div className="space-y-3">
            <Field label="接口地址（Base URL）" required hint="如 https://api.openai.com/v1 或自建网关">
              <Input value={form.endpoint} onChange={(e) => setForm({ ...form, endpoint: e.target.value })} placeholder="https://your-gateway/v1" />
            </Field>
            <Field label="模型名称" required hint="如 glm-4.6 / gpt-4o / 自建池模型">
              <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="glm-4.6" />
            </Field>
            <Field label="API Key" hint="留空表示沿用已保存密钥；服务端保存，不下发前端">
              <Input type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder="(沿用已保存密钥)" />
            </Field>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Btn size="sm" onClick={() => setModalOpen(false)}>取消</Btn>
            <Btn size="sm" variant="primary" onClick={saveConfig} disabled={saving}>
              {saving ? <><Loader2 size={13} className="animate-spin" /> 保存中…</> : '保存并注册'}
            </Btn>
          </div>
        </Modal>
      )}

      {/* 新增「已注册模型」弹层（POST /api/gov/models） */}
      {regModalOpen && (
        <Modal title="注册模型到编目清单" desc="写入 /api/gov/models，仅用于模型编目 / 配额治理" onClose={() => setRegModalOpen(false)}>
          <div className="space-y-3">
            <Field label="模型名称" required hint="如 生产对话模型 / 测试嵌入模型">
              <Input value={regForm.name} onChange={(e) => setRegForm({ ...regForm, name: e.target.value })} placeholder="生产对话模型" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="提供方" hint="留空默认「自定义」">
                <Input value={regForm.provider} onChange={(e) => setRegForm({ ...regForm, provider: e.target.value })} placeholder="OpenAI / 自建" />
              </Field>
              <Field label="类型">
                <Select value={regForm.type} onChange={(e) => setRegForm({ ...regForm, type: e.target.value })} className="w-full">
                  <option value="对话">对话</option>
                  <option value="嵌入 / 向量">嵌入 / 向量</option>
                  <option value="重排序">重排序</option>
                  <option value="多模态">多模态</option>
                </Select>
              </Field>
            </div>
            <Field label="接口地址（Endpoint）" hint="可选，编目用途">
              <Input value={regForm.endpoint} onChange={(e) => setRegForm({ ...regForm, endpoint: e.target.value })} placeholder="https://your-gateway/v1" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="模型标识（model）" hint="可选">
                <Input value={regForm.model} onChange={(e) => setRegForm({ ...regForm, model: e.target.value })} placeholder="glm-4.6" />
              </Field>
              <Field label="配额" hint="留空或 0 表示不限">
                <Input value={regForm.quota} onChange={(e) => setRegForm({ ...regForm, quota: e.target.value })} placeholder="0" inputMode="numeric" />
              </Field>
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Btn size="sm" onClick={() => setRegModalOpen(false)}>取消</Btn>
            <Btn size="sm" variant="primary" onClick={saveRegistered} disabled={regSaving}>
              {regSaving ? <><Loader2 size={13} className="animate-spin" /> 注册中…</> : '确认注册'}
            </Btn>
          </div>
        </Modal>
      )}
    </PageShell>
  )
}
