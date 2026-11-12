import { useState } from 'react'
import { LayoutTemplate, Loader2, Save, Search, Pencil, X } from 'lucide-react'
import PageShell from '@/components/ui/PageShell'
import Btn from '@/components/ui/Btn'
import { Badge, type BadgeColor } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import { Field, Select } from '@/components/ui/Form'
import { useUI } from '@/store/ui'
import { api } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'

interface PropDef { key: string; name: string; type: string; required?: boolean; enumValues?: string[] }
interface ViewTemplate { titleKey?: string; subKey?: string; badgeKey?: string }
interface GalleryObject { id: string; values: Record<string, unknown> }
interface Group {
  type: { id: string; name: string; color: string; desc: string; properties: PropDef[]; viewTemplate: ViewTemplate | null }
  total: number
  objects: GalleryObject[]
}

function badgeColor(v: string): BadgeColor {
  if (/运行|正常|完成|活跃|在职|在用|已审批/.test(v)) return 'green'
  if (/维修|待机|处理中|待审核|观察/.test(v)) return 'amber'
  if (/停机|失败|已取消|流失|报废/.test(v)) return 'red'
  return 'blue'
}

function val(o: GalleryObject, key?: string): string {
  if (!key) return ''
  const v = o.values[key]
  return v === undefined || v === null ? '' : String(v)
}

/** 卡片：编辑中用模板草稿实时预览，否则用已保存模板 */
function ObjectCard({ o, group, tplOverride }: { o: GalleryObject; group: Group; tplOverride?: ViewTemplate }) {
  const t = group.type
  const tpl = tplOverride ?? t.viewTemplate ?? {}
  const props = t.properties
  const titleKey = tpl.titleKey ?? props[0]?.key
  const subKey = tpl.subKey ?? props[1]?.key
  const badge = val(o, tpl.badgeKey)
  const extras = props.filter((p) => p.key !== titleKey && p.key !== subKey && p.key !== tpl.badgeKey).slice(0, 2)
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3.5 transition-colors hover:border-brand-300">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white" style={{ background: t.color }}>
            {val(o, titleKey).slice(0, 1) || '?'}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[14px] font-bold text-slate-800">{val(o, titleKey) || o.id}</div>
            {subKey && <div className="truncate text-[11px] text-slate-400">{val(o, subKey)}</div>}
          </div>
        </div>
        {badge && <Badge color={badgeColor(badge)} dot>{badge}</Badge>}
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-slate-50 pt-2.5">
        {extras.map((p) => (
          <div key={p.key} className="truncate text-[11px] text-slate-500">
            <span className="text-slate-400">{p.name}</span> {val(o, p.key) || '—'}
          </div>
        ))}
      </div>
    </div>
  )
}

/** 对象视图：跨类型全局搜索 + 卡片画廊；模板编辑面板内联在对应类型卡片组下方（所见即所得） */
export default function ObjectViews() {
  const { currentUser } = useUI()
  const canEdit = currentUser?.role.id === 'admin' || currentUser?.role.id === 'data-eng'
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const searchQ = useApi<{ groups: Group[]; total: number }>(`/objects/search?q=${encodeURIComponent(query)}`)

  const [cfgType, setCfgType] = useState<string | null>(null)
  const [draft, setDraft] = useState<ViewTemplate | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')

  const groups = searchQ.data?.groups ?? []
  const editingGroup = groups.find((g) => g.type.id === cfgType)
  const tpl = editingGroup?.type.viewTemplate ?? {}
  const view = draft ?? { titleKey: tpl.titleKey ?? editingGroup?.type.properties[0]?.key, subKey: tpl.subKey ?? editingGroup?.type.properties[1]?.key, badgeKey: tpl.badgeKey }
  const props = editingGroup?.type.properties ?? []
  const propName = (key?: string) => props.find((p) => p.key === key)?.name ?? '（未设置）'

  function selectType(id: string) {
    setCfgType(id)
    setDraft(null)
    // 面板内联在分组下方，选中时把该分组滚入视野即可（WebView 不支持 smooth，用即时滚动）
    setTimeout(() => {
      document.querySelector(`[data-group="${id}"]`)?.scrollIntoView({ block: 'nearest' })
    }, 60)
  }

  async function saveTemplate() {
    if (!editingGroup || !draft) return
    setBusy(true)
    try {
      await api(`/ontology/types/${editingGroup.type.id}`, { method: 'PATCH', body: { viewTemplate: draft } })
      setToast(`「${editingGroup.type.name}」展示模板已保存，卡片画廊与各引用处生效`)
      setDraft(null)
      searchQ.reload()
    } catch (e) {
      setToast(e instanceof Error ? e.message : '保存失败')
    } finally {
      setBusy(false)
    }
    setTimeout(() => setToast(''), 2600)
  }

  return (
    <PageShell
      icon={LayoutTemplate}
      title="对象视图"
      subtitle="跨类型全局搜索与卡片画廊 —— 模板编辑就在卡片旁边，改完立刻看到效果"
      benchmark="对象视图"
      features={[
        '全局搜索：关键词一次命中所有类型（按权限过滤），与对象浏览器的单类型表格形成互补',
        '卡片画廊：结果按类型分组，卡片由该类型的展示模板（标题/副标题/徽章）渲染',
        '展示模板内联编辑：面板就在对应卡片组下方，调整字段时上方卡片实时变化',
        '模板保存后，画廊、详情侧栏、关联引用等处统一生效',
      ]}
    >
      {toast && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">{toast}</div>}

      {/* 全局搜索栏 */}
      <Card>
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
          <Search size={17} className="shrink-0 text-brand-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) setQuery(q.trim()) }}
            placeholder="搜索全平台对象：设备编号、客户名、工单号、仓库……"
            className="flex-1 bg-transparent text-[14px] text-slate-800 placeholder:text-slate-400 focus:outline-none"
          />
          {q && <button onClick={() => { setQ(''); setQuery('') }} className="text-slate-300 hover:text-slate-500"><X size={15} /></button>}
          <button onClick={() => setQuery(q.trim())} className="rounded-lg bg-brand-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-brand-700">搜索</button>
        </div>
        <div className="mt-2.5 flex items-center gap-3 px-1 text-[11px] text-slate-400">
          <span>{query ? `关键词「${query}」命中 ${searchQ.data?.total ?? 0} 个对象 · ${groups.length} 个类型` : `各类型最新对象速览（共 ${groups.length} 个类型有实例）`}</span>
          {query && <button onClick={() => { setQ(''); setQuery('') }} className="font-medium text-brand-600">清除筛选</button>}
        </div>
      </Card>

      {/* 类型 chips */}
      <div className="flex flex-wrap gap-1.5">
        {groups.map((g) => (
          <button
            key={g.type.id}
            onClick={() => selectType(g.type.id)}
            className={cn('flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px] font-medium', cfgType === g.type.id ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-600 hover:border-brand-200')}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: g.type.color }} />
            {g.type.name}
            <span className="text-[11px] text-slate-400">{g.total}</span>
          </button>
        ))}
      </div>

      {/* 画廊 + 内联模板面板 */}
      {searchQ.loading ? (
        <div className="flex items-center justify-center gap-2 py-14 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" /> 搜索中…</div>
      ) : groups.length === 0 ? (
        <Card className="py-14 text-center text-sm text-slate-400">
          {query ? `没有匹配「${query}」的对象` : '暂无对象实例，先到对象浏览器录入数据'}
        </Card>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => {
            const selected = cfgType === g.type.id
            const editingThis = selected && !!draft
            return (
              <Card key={g.type.id} className={cn(selected && 'ring-2 ring-brand-200')} >
                <div data-group={g.type.id}>
                  <CardHeader
                    title={<span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: g.type.color }} />{g.type.name}{editingThis && <Badge color="blue">模板预览中</Badge>}</span>}
                    desc={`${g.total} 个对象${query ? ' · 命中关键词' : ' · 最新'}${g.total > g.objects.length ? `，展示前 ${g.objects.length} 个` : ''}${selected ? ' · 展示模板配置见下方' : ''}`}
                    actions={
                      <button
                        onClick={() => selectType(g.type.id)}
                        className={cn('inline-flex items-center gap-1 text-xs font-medium', selected ? 'text-brand-600' : 'text-slate-400 hover:text-brand-600')}
                      >
                        <LayoutTemplate size={12} /> {selected ? '已选中（下方配置）' : '展示模板'}
                      </button>
                    }
                  />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {g.objects.map((o) => <ObjectCard key={o.id} o={o} group={g} tplOverride={editingThis ? draft! : undefined} />)}
                  </div>
                </div>

                {/* 内联展示模板面板：紧贴卡片，编辑即预览 */}
                {selected && (
                  <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3.5">
                    {!draft ? (
                      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                        <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-slate-600"><LayoutTemplate size={13} className="text-brand-500" /> 展示模板</span>
                        <span className="text-[12px] text-slate-500">标题 = <b className="text-slate-700">{propName(view.titleKey)}</b></span>
                        <span className="text-[12px] text-slate-500">副标题 = <b className="text-slate-700">{propName(view.subKey)}</b></span>
                        <span className="text-[12px] text-slate-500">徽章 = <b className="text-slate-700">{propName(view.badgeKey)}</b></span>
                        {canEdit && (
                          <Btn size="sm" variant="primary" className="ml-auto" onClick={() => setDraft({ titleKey: tpl.titleKey ?? props[0]?.key, subKey: tpl.subKey ?? props[1]?.key, badgeKey: tpl.badgeKey })}>
                            <Pencil size={12} /> 编辑模板
                          </Btn>
                        )}
                      </div>
                    ) : (
                      <>
                        <div className="mb-2.5 flex items-center justify-between">
                          <span className="text-[12px] font-semibold text-brand-700">编辑展示模板 —— 上方卡片实时预览，保存后全平台生效</span>
                          <span className="flex gap-2">
                            <Btn size="sm" onClick={() => setDraft(null)}>取消</Btn>
                            <Btn size="sm" variant="primary" disabled={busy} onClick={saveTemplate}>{busy ? '保存中…' : <><Save size={12} /> 保存模板</>}</Btn>
                          </span>
                        </div>
                        <div className="grid gap-3 md:grid-cols-3">
                          <Field label="标题字段（卡片主标题）">
                            <Select className="w-full" value={view.titleKey ?? ''} onChange={(e) => setDraft({ ...view, titleKey: e.target.value })}>
                              {props.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
                            </Select>
                          </Field>
                          <Field label="副标题字段">
                            <Select className="w-full" value={view.subKey ?? ''} onChange={(e) => setDraft({ ...view, subKey: e.target.value })}>
                              <option value="">不显示</option>
                              {props.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
                            </Select>
                          </Field>
                          <Field label="徽章字段（建议枚举类）">
                            <Select className="w-full" value={view.badgeKey ?? ''} onChange={(e) => setDraft({ ...view, badgeKey: e.target.value })}>
                              <option value="">不显示</option>
                              {props.map((p) => <option key={p.key} value={p.key}>{p.name}{p.type === 'enum' ? '（枚举）' : ''}</option>)}
                            </Select>
                          </Field>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </PageShell>
  )
}
