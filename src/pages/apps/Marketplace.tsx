import { useMemo, useState } from 'react'
import {
  Store,
  Download,
  Upload,
  Cog,
  RefreshCw,
  Loader2,
  Search as SearchIcon,
  Info,
  Layers,
  Link2,
  Zap,
  CheckCircle2,
  X,
  Trash2,
} from 'lucide-react'
import PageShell from '@/components/ui/PageShell'
import Tabs from '@/components/ui/Tabs'
import Btn from '@/components/ui/Btn'
import { Card } from '@/components/ui/Card'
import { Badge, type BadgeColor } from '@/components/ui/Badge'
import { SearchInput, Input, Field } from '@/components/ui/Form'
import { api, getSpaceId } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'

/** GET /api/p10plus/marketplace 的真实模板包产品 + 用户上架产品 */
interface Product {
  id: string
  name: string
  category: string
  desc: string
  typeCount: number
  linkCount: number
  actionCount: number
  installed: boolean
  installCount: number
  builtin: boolean
  version: string
}
interface MarketplaceResp { products: Product[]; installed: number }
interface SpaceRow { id: string; name: string; kind: string }
interface SpacesResp { spaces: SpaceRow[] }
interface InstallResp { ok: boolean; created: number }
interface CreateResp { id: string }
interface DeleteResp { ok: boolean }
interface PublishForm { name: string; desc: string; category: string; version: string }

const EMPTY_FORM: PublishForm = { name: '', desc: '', category: '', version: '1.0.0' }

const CATEGORY_COLOR: Record<string, BadgeColor> = {
  '个人': 'violet',
  '行业模板': 'amber',
  '连接器': 'cyan',
  '数据产品': 'blue',
  'AI 应用': 'green',
}

/** Marketplace：发现并安装真实模板包 */
export default function Marketplace() {
  const q = useApi<MarketplaceResp>('/p10plus/marketplace')
  const products = q.data?.products ?? []
  const spacesQ = useApi<SpacesResp>('/spaces')
  const spaces = spacesQ.data?.spaces ?? []

  const [tab, setTab] = useState('store')
  const [category, setCategory] = useState('全部')
  const [query, setQuery] = useState('')
  const [toast, setToast] = useState('')
  const [errToast, setErrToast] = useState('')
  const [installing, setInstalling] = useState<string | null>(null)
  const [publishOpen, setPublishOpen] = useState(false)
  const [form, setForm] = useState<PublishForm>(EMPTY_FORM)
  const [publishing, setPublishing] = useState(false)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3000) }
  const notifyErr = (m: string) => { setErrToast(m); setTimeout(() => setErrToast(''), 4000) }

  // 分类 chips 由真实产品的 category 派生（内置模板包 + 用户上架产品）
  const categories = useMemo(() => {
    const uniq = Array.from(new Set(products.map((p) => p.category)))
    return ['全部', ...uniq]
  }, [products])

  const installedProducts = products.filter((p) => p.installed)

  const filtered = products.filter((p) => {
    const matchCat = category === '全部' || p.category === category
    const kw = query.trim().toLowerCase()
    const matchQuery = !kw || [p.name, p.category, p.desc].some((s) => s.toLowerCase().includes(kw))
    const matchTab = tab === 'store' || p.installed
    return matchCat && matchQuery && matchTab
  })

  /** 解析当前空间 id：与后端 resolveSpace 的回退规则一致（x-space-id → 首个空间） */
  function currentSpaceId(): string {
    const wanted = getSpaceId()
    if (wanted && spaces.some((s) => s.id === wanted)) return wanted
    return spaces[0]?.id ?? wanted
  }

  /** 安装模板包到当前空间：POST /api/spaces/:id/install-template，成功后 reload */
  async function install(p: Product) {
    const spaceId = currentSpaceId()
    if (!spaceId) return notifyErr('无法确定当前空间，请先在顶部选择空间')
    setInstalling(p.id)
    try {
      const res = await api<InstallResp>(`/spaces/${spaceId}/install-template`, {
        method: 'POST',
        body: { packId: p.id },
      })
      notify(`「${p.name}」已安装到当前空间（新建 ${res.created} 项本体定义）`)
      q.reload()
    } catch (e) {
      notifyErr(e instanceof Error ? e.message : '安装失败')
    } finally {
      setInstalling(null)
    }
  }

  function openPublish() { setForm(EMPTY_FORM); setPublishOpen(true) }
  function closePublish() { if (!publishing) setPublishOpen(false) }

  /** 上架产品：POST /p10plus/marketplace/products，成功后 toast + reload 目录 */
  async function publish() {
    const name = form.name.trim()
    if (!name) return notifyErr('请填写产品名称')
    const body: { name: string; desc?: string; category?: string; version?: string } = { name }
    if (form.desc.trim()) body.desc = form.desc.trim()
    if (form.category.trim()) body.category = form.category.trim()
    if (form.version.trim()) body.version = form.version.trim()
    setPublishing(true)
    try {
      await api<CreateResp>('/p10plus/marketplace/products', { method: 'POST', body })
      setPublishOpen(false)
      setForm(EMPTY_FORM)
      notify(`「${name}」已上架到产品市场`)
      q.reload()
    } catch (e) {
      notifyErr(e instanceof Error ? e.message : '上架失败')
    } finally {
      setPublishing(false)
    }
  }

  /** 下架用户上架的产品：DELETE /p10plus/marketplace/products/:id，成功后 toast + reload */
  async function removeProduct(p: Product) {
    setRemoving(p.id)
    try {
      await api<DeleteResp>(`/p10plus/marketplace/products/${encodeURIComponent(p.id)}`, { method: 'DELETE' })
      setConfirmDel(null)
      notify(`「${p.name}」已下架`)
      q.reload()
    } catch (e) {
      notifyErr(e instanceof Error ? e.message : '下架失败')
    } finally {
      setRemoving(null)
    }
  }

  return (
    <PageShell
      icon={Store}
      title="Marketplace 产品市场"
      subtitle="发现并安装真实本体模板包：安装即写入当前空间的对象类型、链接类型与动作类型"
      benchmark="应用市场"
      features={[
        '真实产品目录：产品、分类、规模与安装量来自后端动态清单（内置模板包 + 用户上架产品）',
        '搜索与分类：按名称、分类、描述与真实 category 实时过滤',
        '一键安装：调用空间模板包安装接口，写入当前本体空间',
        '发布与下架：可上架自定义产品，或下架自己发布的产品（真实写库）',
        '已安装视图：基于真实 installed 标记查看已挂载到空间的模板包',
        '写后刷新：每次安装 / 上架 / 下架成功后自动重新拉取产品与安装状态',
      ]}
      actions={
        <Btn size="sm" variant="primary" onClick={openPublish}><Upload size={13} /> 发布产品</Btn>
      }
    >
      {toast && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">{toast}</div>}
      {errToast && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700">{errToast}</div>}
      {q.error && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700">
          <span>产品加载失败：{q.error}</span>
          <Btn size="sm" variant="ghost" onClick={q.reload}><RefreshCw size={13} /> 重试</Btn>
        </div>
      )}

      <Card padding={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-3">
          <Tabs
            tabs={[
              { key: 'store', label: '商店', count: products.length },
              { key: 'installed', label: '已安装', count: installedProducts.length },
            ]}
            active={tab}
            onChange={setTab}
          />
          <SearchInput
            className="w-64"
            placeholder="搜索产品、分类或描述…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {/* 分类 chips：由真实数据派生 */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
          {categories.map((c) => {
            const count = c === '全部' ? products.length : products.filter((p) => p.category === c).length
            return (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  category === c
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-brand-300 hover:text-brand-700',
                )}
              >
                {c}
                <span className={cn('ml-1', category === c ? 'text-brand-100' : 'text-slate-400')}>{count}</span>
              </button>
            )
          })}
        </div>

        {/* 产品网格（商店 / 已安装共用同一份真实数据，仅 tab 过滤） */}
        <div className="p-4">
          {q.loading && products.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-slate-400"><Loader2 size={18} className="mr-2 animate-spin" /> 正在加载产品…</div>
          ) : filtered.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((p) => {
                const busy = installing === p.id
                return (
                  <div key={p.id} className="group flex flex-col rounded-xl border border-slate-200 p-4 transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-card">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-slate-100 to-slate-200 text-slate-500 transition-colors group-hover:from-brand-500 group-hover:to-violet-500 group-hover:text-white">
                        {p.installed ? <CheckCircle2 size={19} /> : <Store size={19} />}
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        <Badge color={p.builtin ? 'slate' : 'amber'}>{p.builtin ? '内置' : '用户上架'}</Badge>
                        <Badge color={CATEGORY_COLOR[p.category] ?? 'slate'}>{p.category}</Badge>
                      </div>
                    </div>
                    <div className="mt-3 text-[14px] font-bold text-slate-800 group-hover:text-brand-700">{p.name}</div>
                    <div className="mt-1.5 line-clamp-2 min-h-[32px] text-xs leading-4 text-slate-500">{p.desc}</div>

                    {/* 模板包真实规模 */}
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                      <span className="flex items-center gap-1"><Layers size={12} className="text-brand-500" /> {p.typeCount} 对象类型</span>
                      <span className="flex items-center gap-1"><Link2 size={12} className="text-violet-500" /> {p.linkCount} 链接类型</span>
                      <span className="flex items-center gap-1"><Zap size={12} className="text-amber-500" /> {p.actionCount} 动作类型</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                      <span className="flex items-center gap-1"><Download size={11} /> {p.installCount} 次安装</span>
                      <span className="flex items-center gap-1.5">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">v{p.version}</span>
                        {p.installed && <Badge color="green" dot>已安装</Badge>}
                      </span>
                    </div>

                    <div className="mt-3 border-t border-slate-100 pt-2.5">
                      {p.builtin === false ? (
                        /* 用户上架产品未关联可安装的模板包内容（refId 未映射 PACKS），安装必然 404 —— 不渲染安装按钮，如实说明 */
                        <div className="rounded-lg border border-dashed border-slate-200 px-2 py-1.5 text-center text-[10px] leading-4 text-slate-400">
                          用户上架产品 · 暂不支持一键安装（需关联模板包内容后开放）
                        </div>
                      ) : p.installed ? (
                        <Btn size="sm" className="w-full" disabled title="该模板包已安装到空间（后端安装接口幂等）">已安装</Btn>
                      ) : (
                        <Btn size="sm" variant="primary" className="w-full" disabled={busy} onClick={() => install(p)}>
                          {busy ? <><Loader2 size={12} className="animate-spin" /> 安装中…</> : <><Download size={12} /> 安装</>}
                        </Btn>
                      )}
                      {/* 用户上架产品可下架：内置产品无此操作 */}
                      {!p.builtin && (
                        <div className="mt-1.5 flex items-center justify-center gap-2 text-[11px]">
                          {confirmDel === p.id ? (
                            <>
                              <span className="text-slate-500">确认下架？</span>
                              <button
                                onClick={() => removeProduct(p)}
                                disabled={removing === p.id}
                                className="rounded bg-red-500 px-1.5 py-0.5 font-medium text-white hover:bg-red-600 disabled:opacity-50"
                              >{removing === p.id ? '下架中…' : '确认下架'}</button>
                              <button onClick={() => setConfirmDel(null)} disabled={removing === p.id} className="text-slate-400 hover:text-slate-600 disabled:opacity-50">取消</button>
                            </>
                          ) : (
                            <button onClick={() => setConfirmDel(p.id)} className="flex items-center gap-1 text-slate-400 transition-colors hover:text-red-500"><Trash2 size={11} /> 下架</button>
                          )}
                        </div>
                      )}
                      {/* 设置 / 检查更新：后端无对应接口，禁用并说明 */}
                      <div className="mt-1.5 flex items-center justify-center gap-1 text-[10px] text-slate-400">
                        <Cog size={11} /> 设置 / 检查更新暂不可用（后端未提供配置与版本升级接口）
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-16 text-slate-400">
              <SearchIcon size={28} />
              <span className="text-sm">{tab === 'installed' && installedProducts.length === 0 ? '当前空间暂未安装任何模板包' : `没有匹配「${query}」的产品，换个关键词试试`}</span>
            </div>
          )}

          <div className="mt-3 flex items-start gap-2 rounded-lg border border-dashed border-slate-200 p-3 text-[11px] leading-5 text-slate-400">
            <Info size={13} className="mt-0.5 shrink-0" />
            <span>安装会把模板包内的对象类型 / 链接类型 / 动作类型写入当前空间（接口按 id 幂等）。发布产品可直接上架自定义产品并按需下架；设置 / 检查更新因缺少对应后端接口暂不可用，待后续提供。</span>
          </div>
        </div>
      </Card>

      {/* 发布产品弹层：POST /p10plus/marketplace/products，真实写库 */}
      {publishOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={closePublish}>
          <div className="max-h-[88vh] w-[520px] max-w-[94vw] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-base font-bold text-slate-900">发布产品到市场</div>
                <div className="mt-0.5 text-[11px] text-slate-400">提交至 POST /p10plus/marketplace/products，真实写入产品目录</div>
              </div>
              <button onClick={closePublish} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={16} /></button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); void publish() }} className="space-y-3.5">
              <Field label="产品名称" required>
                <Input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：设备维保模板包" />
              </Field>
              <Field label="产品说明">
                <Input value={form.desc} onChange={(e) => setForm({ ...form, desc: e.target.value })} placeholder="一句话说明产品用途" />
              </Field>
              <Field label="分类" hint="可选择已有分类或输入新分类（留空使用默认分类）">
                <Input list="mp-category-options" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="如：行业模板" />
                <datalist id="mp-category-options">
                  {categories.filter((c) => c !== '全部').map((c) => <option key={c} value={c} />)}
                </datalist>
              </Field>
              <Field label="版本">
                <Input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} placeholder="1.0.0" />
              </Field>
              <div className="mt-5 flex justify-end gap-2">
                <Btn type="button" onClick={closePublish}>取消</Btn>
                <Btn type="submit" variant="primary" disabled={publishing}>
                  {publishing ? <><Loader2 size={14} className="animate-spin" /> 上架中…</> : <><Upload size={14} /> 确认上架</>}
                </Btn>
              </div>
            </form>
          </div>
        </div>
      )}
    </PageShell>
  )
}
