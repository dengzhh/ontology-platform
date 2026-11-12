import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Terminal, Copy, RefreshCw, Loader2, ShieldAlert, Server, Wrench, KeyRound, Plus, ExternalLink, Trash2, X } from 'lucide-react'
import PageShell from '@/components/ui/PageShell'
import Btn from '@/components/ui/Btn'
import { Badge } from '@/components/ui/Badge'
import Tabs from '@/components/ui/Tabs'
import { Card, CardHeader } from '@/components/ui/Card'
import DataTable from '@/components/ui/DataTable'
import { KVList } from '@/components/ui/Misc'
import { Input, Field, Select } from '@/components/ui/Form'
import { api } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'

/* ---------- 真实接口返回结构（server/routes/p10.ts） ---------- */
interface EndpointItem { name: string; base: string; auth: string; desc: string }
interface ToolItem { name: string; desc: string; params: string }
interface AiConfig { endpoint: string; model: string }
interface DevelopersResp { endpoints: EndpointItem[]; aiConfig: AiConfig; tools: ToolItem[] }

/* ---------- API 密钥（server/routes/governance.ts：/api/gov/keys） ---------- */
interface ApiKeyItem { id: string; name: string; prefix: string; scope: string; lastUsedAt: string; createdAt: string }
interface KeysResp { keys: ApiKeyItem[] }
interface CreatedKey { id: string; key: string; name: string }

/** 复制文本到剪贴板：优先 Clipboard API，降级到 execCommand */
async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  const ok = document.execCommand('copy')
  document.body.removeChild(ta)
  if (!ok) throw new Error('浏览器不支持剪贴板操作')
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

/** 开发者中心：服务端点 / AI 工具 / API 密钥，全部来自真实接口 */
export default function DevelopersPage() {
  const [tab, setTab] = useState('endpoints')
  const q = useApi<DevelopersResp>('/p10/developers')
  // 密钥接口需管理员权限：仅在切换到「API 密钥」Tab 时再拉取，避免其它 Tab 下出现无谓的报错提示
  const keysQ = useApi<KeysResp>(tab === 'keys' ? '/gov/keys' : null)
  const [toast, setToast] = useState<{ msg: string; err: boolean } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /* 新建密钥弹层 / 明文 key 仅一次展示 / 删除确认 / 写操作 loading */
  const [keyModalOpen, setKeyModalOpen] = useState(false)
  const [keyForm, setKeyForm] = useState({ name: '', scope: 'read' })
  const [keySaving, setKeySaving] = useState(false)
  const [revealedKey, setRevealedKey] = useState<CreatedKey | null>(null)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [keyDeleting, setKeyDeleting] = useState<string | null>(null)

  function notify(msg: string, err = false) {
    setToast({ msg, err })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2800)
  }

  useEffect(() => {
    if (q.error) notify(q.error, true)
  }, [q.error])
  useEffect(() => {
    if (keysQ.error) notify(`密钥列表加载失败：${keysQ.error}`, true)
  }, [keysQ.error])

  const endpoints = q.data?.endpoints ?? []
  const tools = q.data?.tools ?? []
  const aiConfig = q.data?.aiConfig
  const keys = keysQ.data?.keys ?? []

  async function copyEndpoint(e: EndpointItem) {
    // base 为相对路径，拼接当前站点源得到可直接使用的完整端点
    const full = /^https?:\/\//.test(e.base) ? e.base : `${window.location.origin}${e.base}`
    try {
      await copyText(full)
      notify(`✓ 已复制端点：${full}`)
    } catch (err) {
      notify(err instanceof Error ? err.message : '复制失败', true)
    }
  }

  function openKeyModal() {
    setKeyForm({ name: '', scope: 'read' })
    setRevealedKey(null)
    setKeyModalOpen(true)
  }

  function closeKeyModal() {
    setKeyModalOpen(false)
    // 关闭即彻底丢弃明文，之后不再显示
    setRevealedKey(null)
  }

  async function createKey() {
    if (!keyForm.name.trim()) return notify('请填写密钥名称', true)
    setKeySaving(true)
    try {
      const res = await api<CreatedKey>('/gov/keys', {
        method: 'POST',
        body: { name: keyForm.name.trim(), scope: keyForm.scope },
      })
      // 明文仅在创建响应里出现一次，切到展示视图；列表永不回显
      setRevealedKey(res)
      keysQ.reload()
      notify('✓ 密钥已创建')
    } catch (e) {
      notify(e instanceof Error ? e.message : '创建失败', true)
    } finally {
      setKeySaving(false)
    }
  }

  async function copyKey() {
    if (!revealedKey) return
    try {
      await copyText(revealedKey.key)
      notify('✓ 已复制密钥明文')
    } catch (err) {
      notify(err instanceof Error ? err.message : '复制失败', true)
    }
  }

  async function removeKey(id: string) {
    setKeyDeleting(id)
    try {
      await api(`/gov/keys/${id}`, { method: 'DELETE' })
      notify('✓ 密钥已删除')
      setConfirmDel(null)
      keysQ.reload()
    } catch (e) {
      notify(e instanceof Error ? e.message : '删除失败', true)
    } finally {
      setKeyDeleting(null)
    }
  }

  return (
    <PageShell
      icon={Terminal}
      title="开发者中心"
      subtitle="平台真实服务端点、AI 工具清单与 API 密钥管理，端点可一键复制使用"
      benchmark="开发者生态"
      features={[
        '服务端点：REST / AI Chat / 对象查询 / 知识检索的实时地址与鉴权方式',
        'AI 配置：当前平台 AI 服务端点与模型，随配置真实变化',
        '工具清单：AIP 助手可调用的真实工具及其参数',
        'API 密钥：真实创建 / 删除，明文仅创建时展示一次、列表不回显',
        '端点复制：拼接站点源生成完整地址，一键写入系统剪贴板',
      ]}
      actions={<Btn size="sm" onClick={q.reload} disabled={q.loading}><RefreshCw size={13} /> 刷新</Btn>}
    >
      {toast && (
        <div className={cn('rounded-lg border px-4 py-2.5 text-sm font-medium',
          toast.err ? 'border-red-200 bg-red-50 text-red-600' : 'border-emerald-200 bg-emerald-50 text-emerald-700')}>
          {toast.msg}
        </div>
      )}

      <Tabs
        tabs={[
          { key: 'endpoints', label: '服务端点', count: endpoints.length },
          { key: 'tools', label: 'AI 工具', count: tools.length },
          { key: 'keys', label: 'API 密钥', count: keys.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {q.loading ? (
        <Card className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
          <Loader2 size={15} className="animate-spin" /> 加载开发者数据…
        </Card>
      ) : q.error ? (
        <Card className="flex flex-col items-center gap-3 py-14 text-center">
          <div className="text-sm text-red-600">加载失败：{q.error}</div>
          <Btn size="sm" onClick={q.reload}><RefreshCw size={13} /> 重试</Btn>
        </Card>
      ) : (
        <>
          {/* 服务端点（真实 endpoints + aiConfig） */}
          {tab === 'endpoints' && (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
              <Card>
                <CardHeader
                  title={<span className="flex items-center gap-1.5"><Server size={14} className="text-brand-600" /> 服务端点</span>}
                  desc="点击「复制端点」将完整地址（站点源 + 路径）写入剪贴板"
                  actions={<Badge color="blue">{endpoints.length} 个端点</Badge>}
                />
                <DataTable
                  dense
                  columns={[
                    { key: 'name', header: '名称', cell: (r) => <span className="font-semibold text-slate-800">{r.name}</span> },
                    { key: 'base', header: '路径', cell: (r) => <code className="font-mono text-[11px] text-brand-700">{r.base}</code> },
                    { key: 'auth', header: '鉴权', align: 'center', cell: (r) => <Badge color="amber">{r.auth}</Badge> },
                    { key: 'desc', header: '说明', cell: (r) => <span className="text-xs text-slate-500">{r.desc}</span> },
                    {
                      key: 'op', header: '操作', align: 'right', width: '110px',
                      cell: (r) => (
                        <Btn size="sm" onClick={() => copyEndpoint(r)}><Copy size={12} /> 复制端点</Btn>
                      ),
                    },
                  ]}
                  rows={endpoints}
                  rowKey={(r) => r.name}
                />
                <div className="mt-3 flex items-start gap-2 rounded-lg bg-slate-50 p-2.5 text-[11px] leading-5 text-slate-500">
                  <ExternalLink size={13} className="mt-0.5 shrink-0 text-brand-500" />
                  所有端点均需携带登录后的 Bearer JWT，或本页创建的 <code className="rounded bg-white px-1 font-mono">ontoos_</code> API 密钥（<b>read</b> 密钥仅能调用 GET；<b>write/admin</b> 密钥可调用全部方法；密钥身份即创建者本人，沿用其角色权限）。复制得到的是当前站点的完整 URL，可直接用于客户端配置。
                </div>
              </Card>
              <Card className="h-fit">
                <CardHeader title="AI 服务配置" desc="来自平台真实设置，未配置时显示占位" />
                <KVList
                  cols={1}
                  items={[
                    { k: '接口地址', v: <span className="break-all font-mono text-[12px]">{aiConfig?.endpoint ?? '—'}</span> },
                    { k: '对话模型', v: <span className="font-mono text-[12px]">{aiConfig?.model ?? '—'}</span> },
                    { k: '鉴权方式', v: <Badge color="amber">Bearer JWT</Badge> },
                  ]}
                />
                <div className="mt-3 rounded-lg border border-dashed border-slate-200 p-2.5 text-[11px] leading-5 text-slate-400">
                  AI 服务请在「控制面板 → AI 服务」中配置；此处仅做只读展示，密钥不会下发到前端。
                </div>
              </Card>
            </div>
          )}

          {/* AI 工具（真实 tools） */}
          {tab === 'tools' && (
            <Card>
              <CardHeader
                title={<span className="flex items-center gap-1.5"><Wrench size={14} className="text-brand-600" /> AIP 可调用工具</span>}
                desc="助手可调用的真实工具清单及入参说明"
                actions={<Badge color="violet">{tools.length} 个工具</Badge>}
              />
              <DataTable
                dense
                columns={[
                  { key: 'name', header: '工具', cell: (r) => <code className="font-mono text-[12px] font-semibold text-brand-700">{r.name}</code> },
                  { key: 'desc', header: '说明', cell: (r) => <span className="text-xs text-slate-600">{r.desc}</span> },
                  { key: 'params', header: '参数', cell: (r) => <code className="font-mono text-[11px] text-slate-500">{r.params}</code> },
                ]}
                rows={tools}
                rowKey={(r) => r.name}
              />
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-slate-200 p-3 text-xs text-slate-400">
                <ShieldAlert size={14} /> 工具由 AIP 助手按最小权限原则调用，涉及写操作的动作会按平台审批规则执行。
              </div>
            </Card>
          )}

          {/* API 密钥：真实 CRUD（GET/POST/DELETE /api/gov/keys） */}
          {tab === 'keys' && (
            <Card>
              <CardHeader
                title={<span className="flex items-center gap-1.5"><KeyRound size={14} className="text-brand-600" /> API 密钥</span>}
                desc="真实落库的密钥清单；明文仅创建时展示一次，列表只保留前缀用于识别"
                actions={
                  <>
                    <Btn size="sm" onClick={keysQ.reload}><RefreshCw size={12} /> 刷新</Btn>
                    <Btn size="sm" variant="primary" onClick={openKeyModal}><Plus size={13} /> 新建密钥</Btn>
                  </>
                }
              />
              {keysQ.loading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400"><Loader2 size={14} className="animate-spin" /> 加载密钥…</div>
              ) : keysQ.error ? (
                <div className="flex flex-col items-center gap-2 py-10 text-center">
                  <div className="text-xs text-red-600">加载失败：{keysQ.error}</div>
                  <Btn size="sm" onClick={keysQ.reload}><RefreshCw size={12} /> 重试</Btn>
                </div>
              ) : (
                <DataTable
                  dense
                  rows={keys}
                  rowKey={(k) => k.id}
                  columns={[
                    { key: 'name', header: '名称', cell: (k) => <span className="font-semibold text-slate-800">{k.name}</span> },
                    { key: 'prefix', header: '前缀', cell: (k) => <code className="font-mono text-[11px] text-slate-600">{k.prefix}…</code> },
                    { key: 'scope', header: '权限范围', align: 'center', cell: (k) => <Badge color={k.scope === 'read' ? 'blue' : 'amber'}>{k.scope}</Badge> },
                    { key: 'lastUsedAt', header: '最近使用', cell: (k) => <span className="text-[11px] text-slate-500">{k.lastUsedAt}</span> },
                    { key: 'createdAt', header: '创建时间', cell: (k) => <span className="text-[11px] text-slate-500">{k.createdAt}</span> },
                    { key: 'op', header: '操作', align: 'right', width: '130px', cell: (k) => (
                      confirmDel === k.id ? (
                        <span className="inline-flex items-center justify-end gap-1.5 whitespace-nowrap text-[11px]">
                          <span className="text-red-600">确认删除？</span>
                          <Btn size="sm" variant="danger" disabled={keyDeleting === k.id} onClick={() => removeKey(k.id)}>
                            {keyDeleting === k.id ? <Loader2 size={12} className="animate-spin" /> : '确认'}
                          </Btn>
                          <Btn size="sm" variant="ghost" onClick={() => setConfirmDel(null)}>取消</Btn>
                        </span>
                      ) : (
                        <button onClick={() => setConfirmDel(k.id)} className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-red-500" title="删除该密钥">
                          <Trash2 size={12} /> 删除
                        </button>
                      )
                    ) },
                  ]}
                />
              )}
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] leading-5 text-amber-700">
                <ShieldAlert size={13} className="mt-0.5 shrink-0" />
                服务端对密钥做 SHA-256 哈希存储，明文仅在新建成功时返回一次，关闭弹层后无法再次查看；列表仅展示前缀。删除为吊销操作，删除后不可恢复。
              </div>
            </Card>
          )}
        </>
      )}

      {/* 新建密钥弹层：创建表单 + 明文 key 仅一次展示 */}
      {keyModalOpen && (
        <Modal
          title={revealedKey ? '密钥已创建' : '新建 API 密钥'}
          desc={revealedKey ? '明文仅显示一次，请立即复制' : 'POST /api/gov/keys · 明文仅创建时返回一次'}
          onClose={closeKeyModal}
        >
          {revealedKey ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] font-medium text-emerald-700">
                ✓ 密钥「{revealedKey.name}」已创建成功
              </div>
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
                <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-bold text-amber-800">
                  <ShieldAlert size={14} /> 仅显示一次，请立即复制
                </div>
                <div className="break-all rounded-md border border-amber-200 bg-white px-3 py-2 font-mono text-[12px] leading-5 text-slate-800">
                  {revealedKey.key}
                </div>
                <div className="mt-1.5 text-[11px] leading-5 text-amber-700">
                  服务端仅保存哈希，关闭此弹层后明文将永久无法查看，也不会出现在列表中。
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Btn size="sm" onClick={copyKey}><Copy size={12} /> 复制密钥</Btn>
                <Btn size="sm" variant="primary" onClick={closeKeyModal}>我已复制，关闭</Btn>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <Field label="密钥名称" required hint="用于识别用途，如「生产环境只读」">
                <Input value={keyForm.name} onChange={(e) => setKeyForm({ ...keyForm, name: e.target.value })} placeholder="生产环境只读" />
              </Field>
              <Field label="权限范围（scope）" hint="写入密钥元数据，用于编目与权限说明">
                <Select value={keyForm.scope} onChange={(e) => setKeyForm({ ...keyForm, scope: e.target.value })} className="w-full">
                  <option value="read">read · 只读</option>
                  <option value="write">write · 读写</option>
                  <option value="all">all · 全部</option>
                </Select>
              </Field>
              <div className="rounded-lg border border-brand-200 bg-brand-50/50 px-3 py-2.5 text-[11px] leading-5 text-brand-700">
                <b>注意：</b>明文密钥只在创建成功后的弹层里出现一次，请复制并妥善保管；列表不会回显明文。
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Btn size="sm" onClick={closeKeyModal}>取消</Btn>
                <Btn size="sm" variant="primary" onClick={createKey} disabled={keySaving}>
                  {keySaving ? <><Loader2 size={13} className="animate-spin" /> 创建中…</> : '确认创建'}
                </Btn>
              </div>
            </div>
          )}
        </Modal>
      )}
    </PageShell>
  )
}
