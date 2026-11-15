import { useState, type ReactNode } from 'react'
import {
  Search, Plus, Pencil, Trash2, X, Link2, Loader2, RefreshCw, Camera, Sparkles,
  Bookmark, GitCompare, Sigma, Layers, Play, GitMerge, Ban, Save, ChevronDown,
} from 'lucide-react'
import PageShell from '@/components/ui/PageShell'
import DataTable from '@/components/ui/DataTable'
import { Badge, type BadgeColor } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import { SearchInput, Input, Select, Field } from '@/components/ui/Form'
import { KVList } from '@/components/ui/Misc'
import Btn from '@/components/ui/Btn'
import ScanCapture from '@/components/ScanCapture'
import { useUI } from '@/store/ui'
import { api } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'

/* ---------------- 类型 ---------------- */

interface PropDef {
  key: string
  name: string
  type: string
  required?: boolean
  enumValues?: string[]
}
interface TypeBrief { id: string; name: string; color: string; count: number; desc: string }
interface ObjectRow {
  id: string
  values: Record<string, unknown>
  updatedAt: number
  links: string[]
}
interface ListResp {
  type: { id: string; name: string; color: string; properties: PropDef[]; viewTemplate?: { titleKey?: string; subKey?: string; badgeKey?: string } }
  total: number
  objects: ObjectRow[]
}
interface DetailLink {
  id: string
  linkTypeId: string
  linkTypeName: string
  direction: 'out' | 'in'
  otherId: string
  otherType: string
  otherTypeColor: string
  otherName: string
}
interface DetailResp {
  object: { id: string; typeId: string; values: Record<string, unknown>; createdBy: string; createdAt: number; updatedAt: number }
  links: DetailLink[]
}
interface LinkTypeBrief {
  id: string
  name: string
  sourceTypeId: string
  targetTypeId: string
}

/* ---------------- 高级能力类型 ---------------- */

type FilterOp = 'eq' | 'contains' | 'gt' | 'lt'
interface Filter { key: string; op: FilterOp; value: string }
interface SavedExploration {
  id: string; name: string; typeId: string; filters: Filter[]; sort: string
  ownerId: string; spaceId: string; createdAt: number
}
interface RunResp {
  exploration: { id: string; name: string; typeId: string; filters: Filter[]; sort: string }
  total: number
  objects: { id: string; typeId: string; values: Record<string, unknown> }[]
}
interface DerivedProperty {
  id: string; typeId: string; key: string; name: string; expr: string; spaceId: string; createdAt: number
}
interface DerivedEvalResult { id: string; value: unknown; error: string }
interface DerivedEvalResp {
  derived: { id: string; key: string; name: string; expr: string; typeId: string }
  total: number
  results: DerivedEvalResult[]
}
type ScenarioStatus = '进行中' | '已合并' | '已放弃'
interface Change { op: 'create' | 'update' | 'delete'; typeId: string; objectId?: string; values?: Record<string, unknown> }
interface Scenario {
  id: string; name: string; desc: string; status: ScenarioStatus; changes: Change[]
  ownerId: string; spaceId: string; createdAt: number; mergedAt: number | null
}
interface CompareItem { id: string; values: Record<string, unknown> }
interface CompareResp {
  onlyA: CompareItem[]
  onlyB: CompareItem[]
  intersection: (CompareItem & { sameValues: boolean })[]
}

/** 派生属性/对象显示名：取 titleKey/name/title/code/no，回退 id */
function objLabel(values: Record<string, unknown>, id: string): string {
  const v = values ?? {}
  for (const k of ['name', 'title', 'code', 'no']) {
    if (v[k] !== undefined && v[k] !== null && v[k] !== '') return String(v[k])
  }
  return id
}

/* ---------------- 动态表单（按属性定义生成） ---------------- */

function DynamicForm({ props: defs, values, onChange }: { props: PropDef[]; values: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {defs.map((p) => (
        <Field key={p.key} label={`${p.name}${p.required ? '' : '（可选）'}`} required={p.required}>
          {p.type === 'enum' ? (
            <Select className="w-full" value={values[p.key] ?? ''} onChange={(e) => onChange({ ...values, [p.key]: e.target.value })}>
              <option value="">请选择…</option>
              {(p.enumValues ?? []).map((v) => <option key={v} value={v}>{v}</option>)}
            </Select>
          ) : p.type === 'boolean' ? (
            <Select className="w-full" value={values[p.key] ?? ''} onChange={(e) => onChange({ ...values, [p.key]: e.target.value })}>
              <option value="">—</option>
              <option value="true">是</option>
              <option value="false">否</option>
            </Select>
          ) : (
            <Input
              type={p.type === 'number' ? 'number' : p.type === 'date' ? 'date' : 'text'}
              value={values[p.key] ?? ''}
              onChange={(e) => onChange({ ...values, [p.key]: e.target.value })}
            />
          )}
        </Field>
      ))}
    </div>
  )
}

/* ---------------- 枚举值 → 徽章颜色启发式 ---------------- */

function enumColor(propName: string, value: string): BadgeColor {
  if (/运行|正常|完成|已关闭|活跃|在职|优选|在用|已审批/.test(value)) return 'green'
  if (/维修|待机|处理中|待审核|待验收|观察|草稿/.test(value)) return 'amber'
  if (/停机|失败|已取消|流失|报废|淘汰|P0/.test(value)) return 'red'
  if (/封存|休眠|已过期/.test(value)) return 'slate'
  return 'blue'
}

/* ---------------- 通用弹层 ---------------- */

function Modal({ title, onClose, children, width = 560 }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[86vh] max-w-[94vw] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-pop" style={{ width }} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div className="text-base font-bold text-slate-900">{title}</div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

/* ---------------- 主页面 ---------------- */

const EX = '/explorations'

export default function ObjectExplorer() {
  const { currentUser } = useUI()
  const typesQ = useApi<{ types: TypeBrief[] }>('/objects/types')
  const types = typesQ.data?.types ?? []

  const [selectedType, setSelectedType] = useState<string | null>(null)
  const currentType = types.find((t) => t.id === selectedType) ?? types[0]
  const [keyword, setKeyword] = useState('')
  const listQ = useApi<ListResp>(currentType ? `/objects?type=${currentType.id}&keyword=${encodeURIComponent(keyword)}&limit=50` : null)
  // 与服务端 permOf 一致：显式配置优先；新类型按角色回退（建模角色读写 / 其他只读）
  const explicitPerm = currentUser?.role.objectPerms[currentType?.id ?? '']
  const perm: 'full' | 'read' | 'none' =
    explicitPerm ?? (currentUser?.role.id === 'admin' || currentUser?.role.id === 'data-eng' ? 'full' : 'read')
  const canWrite = perm === 'full'

  const [selectedObj, setSelectedObj] = useState<string | null>(null)
  const detailQ = useApi<DetailResp>(selectedObj ? `/objects/${selectedObj}` : null)

  const [toast, setToast] = useState('')
  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2600) }

  /* 新增/编辑弹层 */
  const [formOpen, setFormOpen] = useState<'create' | 'edit' | null>(null)
  const [scanOpen, setScanOpen] = useState(false)
  const [scanForForm, setScanForForm] = useState(false)
  const [formVals, setFormVals] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [formErr, setFormErr] = useState('')

  /* 关联弹层 */
  const [linkOpen, setLinkOpen] = useState(false)
  const linksQ = useApi<{ links: LinkTypeBrief[] }>('/ontology/links')
  const [linkForm, setLinkForm] = useState<{ linkTypeId: string; targetId: string }>({ linkTypeId: '', targetId: '' })
  const [targetSearch, setTargetSearch] = useState('')
  const [confirmDel, setConfirmDel] = useState(false)

  const props = listQ.data?.type.properties ?? []
  const displayProps = props.slice(0, 6)
  const objects = listQ.data?.objects ?? []

  /* ---------------- 高级能力：保存的探索 ---------------- */
  const [exploreOpen, setExploreOpen] = useState(false)
  const explorationsQ = useApi<{ explorations: SavedExploration[] }>(`${EX}/explorations`)
  const [loadedExploration, setLoadedExploration] = useState<SavedExploration | null>(null)
  const [runResult, setRunResult] = useState<RunResp | null>(null)
  const [runBusy, setRunBusy] = useState(false)
  // 新建探索的小表单
  const [expName, setExpName] = useState('')
  const [expSaving, setExpSaving] = useState(false)
  const [draftFilters, setDraftFilters] = useState<Filter[]>([])
  const [draftSort, setDraftSort] = useState('')

  /* ---------------- 高级能力：对象集比较 ---------------- */
  const [checkedIds, setCheckedIds] = useState<string[]>([])
  const [compareOpen, setCompareOpen] = useState(false)
  // 集合归属：每个被勾选对象是否属于 A / B（可重叠，交集才有意义）
  const [setA, setSetA] = useState<string[]>([])
  const [setB, setSetB] = useState<string[]>([])
  const [compareResult, setCompareResult] = useState<CompareResp | null>(null)
  const [compareBusy, setCompareBusy] = useState(false)

  /* ---------------- 高级能力：派生属性 ---------------- */
  const [derivedOpen, setDerivedOpen] = useState(false)
  const derivedQ = useApi<{ derived: DerivedProperty[] }>(`${EX}/derived`)
  const [dpForm, setDpForm] = useState({ key: '', name: '', expr: '' })
  const [dpSaving, setDpSaving] = useState(false)
  const [dpEvalId, setDpEvalId] = useState('')
  const [dpResult, setDpResult] = useState<DerivedEvalResp | null>(null)
  const [dpEvalBusy, setDpEvalBusy] = useState(false)

  /* ---------------- 高级能力：场景 ---------------- */
  const [scenarioOpen, setScenarioOpen] = useState(false)
  const scenariosQ = useApi<{ scenarios: Scenario[] }>(`${EX}/scenarios`)
  const [scnForm, setScnForm] = useState({ name: '', desc: '' })
  const [scnSaving, setScnSaving] = useState(false)
  const [activeScenarioId, setActiveScenarioId] = useState('')
  const [scnBusy, setScnBusy] = useState(false)
  const [stageScenarioId, setStageScenarioId] = useState('')
  const [stageBusy, setStageBusy] = useState(false)

  const inProgressScenarios = (scenariosQ.data?.scenarios ?? []).filter((s) => s.status === '进行中')
  const activeScenario = (scenariosQ.data?.scenarios ?? []).find((s) => s.id === activeScenarioId)

  async function submitForm() {
    if (!currentType) return
    setBusy(true)
    setFormErr('')
    try {
      if (formOpen === 'create') {
        await api('/objects', { method: 'POST', body: { typeId: currentType.id, values: formVals } })
        notify(`已新增「${currentType.name}」实例（审计留痕）`)
      } else if (selectedObj) {
        await api(`/objects/${selectedObj}`, { method: 'PATCH', body: { values: formVals } })
        notify('实例已更新（审计留痕）')
        detailQ.reload()
      }
      setFormOpen(null)
      listQ.reload()
      typesQ.reload()
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  async function removeObject() {
    if (!selectedObj) return
    setBusy(true)
    try {
      const res = await api<{ ok: boolean; cascadedLinks: number; cascadedItems?: number }>(`/objects/${selectedObj}`, { method: 'DELETE' })
      const parts = [
        res.cascadedItems ? `一并删除 ${res.cascadedItems} 条明细` : '',
        res.cascadedLinks ? `断开 ${res.cascadedLinks} 条关联` : '',
      ].filter(Boolean).join('，')
      notify(`实例已删除${parts ? `（${parts}，审计留痕）` : '（审计留痕）'}`)
      setSelectedObj(null)
      setConfirmDel(false)
      listQ.reload()
      typesQ.reload()
    } catch (e) {
      notify(e instanceof Error ? e.message : '删除失败')
    } finally {
      setBusy(false)
    }
  }

  /* 可用链接类型：任一端为当前类型 */
  const applicableLinks = (linksQ.data?.links ?? []).filter((l) => l.sourceTypeId === currentType?.id || l.targetTypeId === currentType?.id)
  const chosenLT = applicableLinks.find((l) => l.id === linkForm.linkTypeId)
  const otherTypeId = chosenLT ? (chosenLT.sourceTypeId === currentType?.id ? chosenLT.targetTypeId : chosenLT.sourceTypeId) : ''
  const targetsQ = useApi<{ objects: { id: string; values: Record<string, unknown> }[] }>(
    linkOpen && otherTypeId ? `/objects?type=${otherTypeId}&keyword=${encodeURIComponent(targetSearch)}&limit=10` : null,
  )

  async function createLink() {
    if (!selectedObj || !linkForm.linkTypeId || !linkForm.targetId) return
    setBusy(true)
    try {
      await api(`/objects/${selectedObj}/links`, {
        method: 'POST',
        body: { linkTypeId: linkForm.linkTypeId, targetId: linkForm.targetId, direction: chosenLT?.sourceTypeId === currentType?.id ? 'out' : 'in' },
      })
      notify('关联已建立（审计留痕）')
      setLinkOpen(false)
      setLinkForm({ linkTypeId: '', targetId: '' })
      detailQ.reload()
      listQ.reload()
    } catch (e) {
      notify(e instanceof Error ? e.message : '创建失败')
    } finally {
      setBusy(false)
    }
  }

  async function removeLink(linkId: string) {
    try {
      await api(`/objects/links/${linkId}`, { method: 'DELETE' })
      notify('关联已移除')
      detailQ.reload()
      listQ.reload()
    } catch (e) {
      notify(e instanceof Error ? e.message : '移除失败')
    }
  }

  /* ---------------- 保存的探索：真实操作 ---------------- */

  async function saveExploration() {
    if (!currentType) return
    if (!expName.trim()) { notify('请填写探索名称'); return }
    setExpSaving(true)
    try {
      await api(`${EX}/explorations`, {
        method: 'POST',
        body: { name: expName.trim(), typeId: currentType.id, filters: draftFilters.filter((f) => f.key && f.value), sort: draftSort },
      })
      notify(`已保存探索「${expName.trim()}」`)
      setExpName(''); setDraftFilters([]); setDraftSort('')
      explorationsQ.reload()
    } catch (e) {
      notify(e instanceof Error ? e.message : '保存探索失败')
    } finally {
      setExpSaving(false)
    }
  }

  function loadExploration(exp: SavedExploration) {
    setSelectedType(exp.typeId)
    setSelectedObj(null)
    setKeyword('')
    setLoadedExploration(exp)
    notify(`已加载探索「${exp.name}」（${exp.filters.length} 个过滤条件），点「运行」查看匹配对象`)
    setExploreOpen(false)
  }

  async function runExploration(exp: SavedExploration) {
    setRunBusy(true)
    try {
      const res = await api<RunResp>(`${EX}/explorations/${exp.id}/run`, { method: 'POST' })
      setRunResult(res)
      notify(`探索「${exp.name}」匹配 ${res.total} 个对象`)
      setExploreOpen(false)
    } catch (e) {
      notify(e instanceof Error ? e.message : '运行探索失败')
    } finally {
      setRunBusy(false)
    }
  }

  async function deleteExploration(id: string, name: string) {
    try {
      await api(`${EX}/explorations/${id}`, { method: 'DELETE' })
      notify(`已删除探索「${name}」`)
      if (loadedExploration?.id === id) setLoadedExploration(null)
      explorationsQ.reload()
    } catch (e) {
      notify(e instanceof Error ? e.message : '删除探索失败')
    }
  }

  /* ---------------- 对象集比较：真实操作 ---------------- */

  function openCompare() {
    // 默认：第 1 个勾选对象归 A、第 2 个归 B，其余归 A
    const ids = checkedIds
    setSetA(ids.filter((_, i) => i !== 1))
    setSetB(ids.filter((_, i) => i === 1))
    setCompareResult(null)
    setCompareOpen(true)
  }

  function toggleIn(id: string, which: 'A' | 'B') {
    if (which === 'A') setSetA((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
    else setSetB((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }

  async function doCompare() {
    setCompareBusy(true)
    try {
      const res = await api<CompareResp>(`${EX}/compare`, { method: 'POST', body: { a: setA, b: setB } })
      setCompareResult(res)
      notify(`比较完成：仅A ${res.onlyA.length} · 仅B ${res.onlyB.length} · 交集 ${res.intersection.length}`)
    } catch (e) {
      notify(e instanceof Error ? e.message : '比较失败')
    } finally {
      setCompareBusy(false)
    }
  }

  /* ---------------- 派生属性：真实操作 ---------------- */

  async function createDerived() {
    if (!currentType) return
    if (!dpForm.key.trim() || !dpForm.name.trim() || !dpForm.expr.trim()) { notify('请填写标识、名称与表达式'); return }
    setDpSaving(true)
    try {
      await api(`${EX}/derived`, {
        method: 'POST',
        body: { typeId: currentType.id, key: dpForm.key.trim(), name: dpForm.name.trim(), expr: dpForm.expr.trim() },
      })
      notify(`已新建派生属性「${dpForm.name.trim()}」`)
      setDpForm({ key: '', name: '', expr: '' })
      derivedQ.reload()
    } catch (e) {
      notify(e instanceof Error ? e.message : '新建派生属性失败')
    } finally {
      setDpSaving(false)
    }
  }

  async function evalDerived(id: string) {
    setDpEvalBusy(true)
    setDpEvalId(id)
    try {
      const res = await api<DerivedEvalResp>(`${EX}/derived/${id}/eval`, { method: 'POST' })
      setDpResult(res)
      notify(`已对 ${res.total} 个对象计算「${res.derived.name}」`)
    } catch (e) {
      notify(e instanceof Error ? e.message : '计算派生属性失败')
    } finally {
      setDpEvalBusy(false)
    }
  }

  /* ---------------- 场景：真实操作 ---------------- */

  async function createScenario() {
    if (!scnForm.name.trim()) { notify('请填写场景名称'); return }
    setScnSaving(true)
    try {
      const res = await api<{ scenario: Scenario }>(`${EX}/scenarios`, { method: 'POST', body: { name: scnForm.name.trim(), desc: scnForm.desc.trim() } })
      notify(`已新建场景「${res.scenario.name}」`)
      setScnForm({ name: '', desc: '' })
      setActiveScenarioId(res.scenario.id)
      setStageScenarioId(res.scenario.id)
      scenariosQ.reload()
    } catch (e) {
      notify(e instanceof Error ? e.message : '新建场景失败')
    } finally {
      setScnSaving(false)
    }
  }

  /** 在新增/编辑表单里「暂存到场景」：记入场景 changes，不立即写 objects */
  async function stageToScenario() {
    if (!currentType) return
    const sid = stageScenarioId || activeScenarioId || inProgressScenarios[0]?.id
    if (!sid) { notify('请先新建一个「进行中」的场景'); return }
    setStageBusy(true)
    try {
      const op: Change['op'] = formOpen === 'create' ? 'create' : 'update'
      const body: { op: Change['op']; typeId: string; objectId?: string; values: Record<string, unknown> } = {
        op, typeId: currentType.id, values: formVals as Record<string, unknown>,
      }
      if (op === 'update' && selectedObj) body.objectId = selectedObj
      await api(`${EX}/scenarios/${sid}/change`, { method: 'POST', body })
      notify(`变更已暂存到场景（${op === 'create' ? '新建' : '编辑'}），合并后才会生效`)
      setFormOpen(null)
      scenariosQ.reload()
    } catch (e) {
      notify(e instanceof Error ? e.message : '暂存失败')
    } finally {
      setStageBusy(false)
    }
  }

  async function mergeScenario(id: string) {
    setScnBusy(true)
    try {
      const res = await api<{ ok: boolean; summary: { created: number; updated: number; deleted: number; linksCleaned: number; skipped: number } }>(`${EX}/scenarios/${id}/merge`, { method: 'POST' })
      const s = res.summary
      notify(`场景已合并：新增 ${s.created} · 更新 ${s.updated} · 删除 ${s.deleted} · 清理关联 ${s.linksCleaned}`)
      scenariosQ.reload()
      listQ.reload()
      typesQ.reload()
      detailQ.reload()
    } catch (e) {
      notify(e instanceof Error ? e.message : '合并场景失败')
    } finally {
      setScnBusy(false)
    }
  }

  async function discardScenario(id: string) {
    setScnBusy(true)
    try {
      await api(`${EX}/scenarios/${id}/discard`, { method: 'POST' })
      notify('场景已放弃，暂存的变更不会生效')
      scenariosQ.reload()
    } catch (e) {
      notify(e instanceof Error ? e.message : '放弃场景失败')
    } finally {
      setScnBusy(false)
    }
  }

  /* 勾选（比较用） */
  function toggleCheck(id: string) {
    setCheckedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }

  const detail = detailQ.data
  const checkedObjects: CompareItem[] = objects.filter((o) => checkedIds.includes(o.id)).map((o) => ({ id: o.id, values: o.values }))
  // 派生属性：只展示当前类型绑定的（新建也绑定当前类型，保证「对当前类型计算」）
  const derivedForType = (derivedQ.data?.derived ?? []).filter((d) => d.typeId === currentType?.id)

  return (
    <PageShell
      icon={Search}
      title="对象浏览器"
      subtitle="搜索、筛选、下钻探索全企业业务对象 —— 列与表单由本体定义动态生成"
      benchmark="对象工作台"
      features={[
        '动态列：表格列与编辑表单由所选类型的属性定义实时生成',
        '实例增删改：按属性校验（必填/类型/枚举），权限限定的真实读写',
        '关联管理：建立/移除对象间链接实例，端点类型自动校验',
        '保存的探索：条件过滤 + 运行匹配，对象集比较（仅A/仅B/交集）',
        '派生属性：表达式真实计算；场景分支：暂存变更 → 合并/放弃',
        '权限感知：只读角色可浏览，读写角色可编辑（按角色对象权限）',
      ]}
      actions={
        <>
          <Btn size="sm" onClick={() => { listQ.reload(); typesQ.reload() }}><RefreshCw size={13} /> 刷新</Btn>
          <Btn size="sm" disabled={!canWrite || !currentType} onClick={() => setScanOpen(true)}>
            <Camera size={14} /> 扫描录入
          </Btn>
          {/* 保存的探索下拉 */}
          <div className="relative">
            <Btn size="sm" onClick={() => setExploreOpen((v) => !v)}><Bookmark size={14} /> 保存的探索 <ChevronDown size={12} /></Btn>
            {exploreOpen && (
              <div className="absolute right-0 top-full z-40 mt-1.5 w-80 rounded-xl border border-slate-200 bg-white p-3 shadow-pop" onClick={(e) => e.stopPropagation()}>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700">已保存的探索</span>
                  <button className="text-slate-300 hover:text-slate-500" onClick={() => setExploreOpen(false)}><X size={14} /></button>
                </div>
                <div className="max-h-56 space-y-1.5 overflow-y-auto">
                  {(explorationsQ.data?.explorations ?? []).length === 0 && <div className="py-3 text-center text-xs text-slate-400">暂无保存的探索</div>}
                  {(explorationsQ.data?.explorations ?? []).map((exp) => (
                    <div key={exp.id} className={cn('rounded-lg border px-2.5 py-2', loadedExploration?.id === exp.id ? 'border-brand-300 bg-brand-50/60' : 'border-slate-100')}>
                      <div className="flex items-center gap-2">
                        <button className="min-w-0 flex-1 text-left" onClick={() => loadExploration(exp)} title="加载（切换到该类型）">
                          <div className="truncate text-[13px] font-medium text-slate-700">{exp.name}</div>
                          <div className="text-[11px] text-slate-400">{types.find((t) => t.id === exp.typeId)?.name ?? exp.typeId} · {exp.filters.length} 个条件{exp.sort ? ` · 排序 ${exp.sort}` : ''}</div>
                        </button>
                        <button disabled={runBusy} onClick={() => runExploration(exp)} className="rounded-md p-1 text-brand-600 hover:bg-brand-50" title="运行（真实过滤）"><Play size={13} /></button>
                        <button onClick={() => deleteExploration(exp.id, exp.name)} className="rounded-md p-1 text-slate-300 hover:bg-red-50 hover:text-red-500" title="删除"><Trash2 size={13} /></button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 border-t border-slate-100 pt-2.5">
                  <div className="mb-1.5 text-[11px] font-semibold text-slate-600">保存当前类型为新探索</div>
                  <Input className="mb-1.5" placeholder={`探索名称（当前：${currentType?.name ?? '—'}）`} value={expName} onChange={(e) => setExpName(e.target.value)} />
                  {draftFilters.map((f, i) => (
                    <div key={i} className="mb-1.5 flex items-center gap-1">
                      <Select className="min-w-0 flex-1" value={f.key} onChange={(e) => setDraftFilters((prev) => prev.map((x, j) => j === i ? { ...x, key: e.target.value } : x))}>
                        <option value="">属性</option>
                        {props.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
                      </Select>
                      <Select className="w-20" value={f.op} onChange={(e) => setDraftFilters((prev) => prev.map((x, j) => j === i ? { ...x, op: e.target.value as FilterOp } : x))}>
                        <option value="eq">等于</option>
                        <option value="contains">包含</option>
                        <option value="gt">大于</option>
                        <option value="lt">小于</option>
                      </Select>
                      <Input className="w-20" placeholder="值" value={f.value} onChange={(e) => setDraftFilters((prev) => prev.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} />
                      <button className="text-slate-300 hover:text-red-500" onClick={() => setDraftFilters((prev) => prev.filter((_, j) => j !== i))}><X size={13} /></button>
                    </div>
                  ))}
                  <div className="mb-1.5 flex items-center gap-2">
                    <button className="flex items-center gap-1 text-[11px] text-brand-600 hover:underline" onClick={() => setDraftFilters((prev) => [...prev, { key: props[0]?.key ?? '', op: 'eq', value: '' }])}><Plus size={12} /> 添加条件</button>
                    <Input className="w-28" placeholder="排序(+/-key)" value={draftSort} onChange={(e) => setDraftSort(e.target.value)} />
                  </div>
                  <Btn size="sm" variant="primary" className="w-full" disabled={expSaving || !currentType} onClick={saveExploration}><Save size={12} /> {expSaving ? '保存中…' : '保存探索'}</Btn>
                </div>
              </div>
            )}
          </div>
          <Btn size="sm" disabled={checkedIds.length < 2} onClick={openCompare} title={checkedIds.length < 2 ? '请先勾选至少两行' : '比较勾选的对象集'}>
            <GitCompare size={14} /> 对象集比较{checkedIds.length > 0 ? ` (${checkedIds.length})` : ''}
          </Btn>
          <Btn size="sm" onClick={() => { setDpResult(null); setDerivedOpen(true) }}><Sigma size={14} /> 派生属性</Btn>
          <Btn size="sm" onClick={() => setScenarioOpen(true)}><Layers size={14} /> 场景</Btn>
          <Btn size="sm" variant="primary" disabled={!canWrite || !currentType} onClick={() => { setFormVals({}); setFormErr(''); setFormOpen('create') }}>
            <Plus size={14} /> 新增{currentType?.name ?? '实例'}
          </Btn>
        </>
      }
    >
      {toast && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">{toast}</div>}
      {loadedExploration && (
        <div className="flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50/60 px-4 py-2 text-xs text-brand-700">
          <Bookmark size={13} /> 已加载探索「{loadedExploration.name}」（{types.find((t) => t.id === loadedExploration.typeId)?.name ?? loadedExploration.typeId} · {loadedExploration.filters.length} 个条件）—— 点下拉中的「运行」查看匹配对象
          <button className="ml-auto text-brand-400 hover:text-brand-700" onClick={() => setLoadedExploration(null)}><X size={13} /></button>
        </div>
      )}
      {scanOpen && currentType && (
        <ScanCapture
          defaultTypeId={currentType.id}
          title={`扫描录入「${currentType.name}」`}
          onClose={() => setScanOpen(false)}
          onCommitted={() => { listQ.reload(); typesQ.reload(); notify('扫描录入成功，数据已入库') }}
        />
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* 左：类型 Tab + 表格 */}
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1.5">
              {types.map((t) => (
                <button
                  key={t.id}
                  onClick={() => { setSelectedType(t.id); setSelectedObj(null); setCheckedIds([]) }}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px] font-medium transition-colors',
                    currentType?.id === t.id ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-slate-200 bg-white text-slate-600 hover:border-brand-200',
                  )}
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: t.color }} />
                  {t.name}
                  <span className="text-[11px] text-slate-400">{t.count}</span>
                </button>
              ))}
            </div>
            <div className="ml-auto w-52">
              <SearchInput value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder={`搜索${currentType?.name ?? ''}…`} />
            </div>
          </div>

          {listQ.loading ? (
            <div className="flex items-center justify-center gap-2 py-14 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" /> 加载对象数据…</div>
          ) : listQ.error ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">{listQ.error}</div>
          ) : (
            <DataTable
              rows={objects}
              rowKey={(o) => o.id}
              onRowClick={(o) => setSelectedObj(o.id)}
              maxHeight="480px"
              columns={[
                {
                  key: '__check', header: '比较', width: '46px', align: 'center',
                  cell: (o: ObjectRow) => (
                    <input
                      type="checkbox"
                      checked={checkedIds.includes(o.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleCheck(o.id)}
                      title="勾选以加入对象集比较"
                    />
                  ),
                },
                ...displayProps.map((p) => ({
                  key: p.key,
                  header: p.name,
                  cell: (o: ObjectRow) => {
                    const v = o.values[p.key]
                    if (v === undefined || v === null || v === '') return <span className="text-slate-300">—</span>
                    if (p.type === 'enum') return <Badge color={enumColor(p.name, String(v))} dot>{String(v)}</Badge>
                    if (p.type === 'boolean') return v ? '✓' : '—'
                    if (p.type === 'number') return <span className="font-medium">{String(v)}</span>
                    return String(v)
                  },
                })),
                { key: '__links', header: '关联', cell: (o: ObjectRow) => o.links.length > 0 ? <span className="text-[11px] text-slate-400">{o.links.length} 条</span> : <span className="text-slate-200">—</span> },
              ]}
            />
          )}
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>共 {listQ.data?.total ?? 0} 个「{currentType?.name ?? ''}」实例{!canWrite && ' · 只读视角（编辑需对应权限）'}</span>
            <span>{checkedIds.length > 0 ? `已勾选 ${checkedIds.length} 行，可点「对象集比较」` : '勾选两行及以上可比较对象集'}</span>
          </div>
        </div>

        {/* 右：详情侧栏 */}
        <div className="min-w-0">
          {!selectedObj ? (
            <Card className="flex h-full min-h-[280px] flex-col items-center justify-center gap-2 text-center">
              <Search size={26} className="text-slate-200" />
              <div className="text-sm font-medium text-slate-500">点击左侧任一行查看对象详情</div>
              <div className="text-xs text-slate-400">属性、关联对象与操作入口</div>
            </Card>
          ) : detailQ.loading ? (
            <Card className="flex h-full items-center justify-center"><Loader2 size={16} className="animate-spin text-slate-300" /></Card>
          ) : detail ? (
            <Card>
              <CardHeader
                title={<span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: currentType?.color }} />{currentType?.name} · 详情</span>}
                desc={`ID ${detail.object.id}`}
                actions={
                  canWrite && (
                    <div className="flex gap-1.5">
                      <Btn size="sm" onClick={() => {
                        const v: Record<string, string> = {}
                        for (const p of props) v[p.key] = String(detail.object.values[p.key] ?? '')
                        setFormVals(v); setFormErr(''); setFormOpen('edit')
                      }}><Pencil size={12} /></Btn>
                      {confirmDel ? (
                        <>
                          <Btn size="sm" variant="danger" disabled={busy} onClick={removeObject}>确认删除？</Btn>
                          <Btn size="sm" variant="ghost" onClick={() => setConfirmDel(false)}>取消</Btn>
                        </>
                      ) : (
                        <Btn size="sm" variant="ghost" onClick={() => setConfirmDel(true)}><Trash2 size={12} /></Btn>
                      )}
                    </div>
                  )
                }
              />
              <div className="mb-3 rounded-lg border border-slate-100 bg-slate-50/60 p-3">
                {confirmDel && detail.links.length > 0 && (() => {
                  // 明细组合关系（如 支出→消费明细）将级联删除子对象；其他关联仅断开
                  const itemLinks = detail.links.filter((l) => /明细|item|detail/i.test(l.linkTypeName))
                  const otherLinks = detail.links.filter((l) => !/明细|item|detail/i.test(l.linkTypeName))
                  return (
                    <div className="mb-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-700">
                      {itemLinks.length > 0 && (
                        <>
                          <b>将一并删除 {itemLinks.length} 条明细子对象</b>
                          <div className="mt-0.5 text-amber-600">{itemLinks.slice(0, 4).map((l) => l.otherName || l.otherType).join('；')}{itemLinks.length > 4 ? ` 等 ${itemLinks.length} 条` : ''}</div>
                        </>
                      )}
                      {otherLinks.length > 0 && (
                        <>
                          <b className={itemLinks.length > 0 ? 'mt-1.5 block' : ''}>将断开 {otherLinks.length} 条关联（对端对象保留）</b>
                          <div className="mt-0.5 text-amber-600">
                            {otherLinks.slice(0, 4).map((l) => `${l.linkTypeName} → ${l.otherType}·${l.otherName}`).join('；')}
                            {otherLinks.length > 4 ? ` 等 ${otherLinks.length} 条` : ''}
                          </div>
                        </>
                      )}
                      <div className="mt-0.5 text-amber-500">删除后不可恢复，审计中有留痕</div>
                    </div>
                  )
                })()}
                <KVList
                  cols={1}
                  items={props.map((p) => ({
                    k: p.name,
                    v: p.type === 'enum' && detail.object.values[p.key]
                      ? <Badge color={enumColor(p.name, String(detail.object.values[p.key]))}>{String(detail.object.values[p.key])}</Badge>
                      : <span>{detail.object.values[p.key] === undefined ? '—' : String(detail.object.values[p.key])}</span>,
                  }))}
                />
                <div className="mt-2 border-t border-slate-100 pt-2 text-[11px] text-slate-400">
                  创建：{detail.object.createdBy || 'seed'} · 更新：{new Date(detail.object.updatedAt).toLocaleString('zh-CN', { hour12: false })}
                </div>
              </div>

              <div className="mb-2 flex items-center justify-between">
                <span className="text-[13px] font-semibold text-slate-700">关联对象（{detail.links.length}）</span>
                {canWrite && (
                  <Btn size="sm" disabled={applicableLinks.length === 0} onClick={() => { setLinkForm({ linkTypeId: '', targetId: '' }); setLinkOpen(true) }}>
                    <Link2 size={12} /> 添加关联
                  </Btn>
                )}
              </div>
              <div className="space-y-1.5">
                {detail.links.length === 0 && <div className="rounded-lg border border-dashed border-slate-200 p-3 text-center text-xs text-slate-400">暂无关联对象</div>}
                {detail.links.map((l) => (
                  <div key={l.id} className="flex items-center gap-2 rounded-lg border border-slate-100 px-2.5 py-2">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: l.otherTypeColor }} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-slate-700">{l.otherName}</div>
                      <div className="text-[11px] text-slate-400">{l.linkTypeName} · {l.otherType}{l.direction === 'in' ? '（入向）' : ''}</div>
                    </div>
                    {canWrite && (
                      <button onClick={() => removeLink(l.id)} className="text-slate-300 hover:text-red-500" title="移除关联"><X size={13} /></button>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </div>
      </div>

      {/* 新增/编辑实例弹层 */}
      {formOpen && currentType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={() => setFormOpen(null)}>
          <div className="max-h-[86vh] w-[560px] max-w-[94vw] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div className="text-base font-bold text-slate-900">{formOpen === 'create' ? `新增「${currentType.name}」` : `编辑「${currentType.name}」`}</div>
              <button onClick={() => setFormOpen(null)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={16} /></button>
            </div>
            {/* 弹层内：扫描识别直接填表（不直接入库） */}
            {formOpen === 'create' && (
              <div className="mb-3 flex items-center justify-between rounded-lg border border-violet-200 bg-violet-50/60 px-3 py-2.5">
                <div className="flex items-center gap-2 text-xs text-violet-700">
                  <Camera size={14} /> 有小票/订单截图？让 AI 识别后自动填入下方表单
                </div>
                <Btn size="sm" onClick={() => setScanForForm(true)}><Sparkles size={12} /> 扫描填表</Btn>
              </div>
            )}
            <DynamicForm props={props} values={formVals} onChange={setFormVals} />
            {formErr && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{formErr}</div>}

            {/* 暂存到场景：把本次新建/编辑记入场景 changes（合并前不生效） */}
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-600"><Layers size={13} /> 暂存到场景（不立即入库，合并后生效）</div>
              <div className="flex items-center gap-2">
                <Select className="min-w-0 flex-1" value={stageScenarioId || activeScenarioId || inProgressScenarios[0]?.id || ''} onChange={(e) => setStageScenarioId(e.target.value)}>
                  <option value="">选择「进行中」场景…</option>
                  {inProgressScenarios.map((s) => <option key={s.id} value={s.id}>{s.name}（{s.changes.length} 项变更）</option>)}
                </Select>
                <Btn size="sm" disabled={stageBusy} onClick={stageToScenario}><Save size={12} /> {stageBusy ? '暂存中…' : '暂存到场景'}</Btn>
                <Btn size="sm" variant="ghost" onClick={() => setScenarioOpen(true)} title="新建场景"><Plus size={12} /> 新建场景</Btn>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Btn onClick={() => setFormOpen(null)}>取消</Btn>
              <Btn variant="primary" disabled={busy} onClick={submitForm}>{busy ? '保存中…' : '直接保存'}</Btn>
            </div>
          </div>
        </div>
      )}

      {/* 扫描填表弹层：识别结果回填到新增表单 */}
      {scanForForm && currentType && (
        <ScanCapture
          defaultTypeId={currentType.id}
          title="扫描识别并填入表单"
          mode="fill"
          onFill={(v) => setFormVals((prev) => ({ ...prev, ...v }))}
          onClose={() => setScanForForm(false)}
          onCommitted={() => notify('识别结果已填入表单，请核对后保存')}
        />
      )}

      {/* 添加关联弹层 */}
      {linkOpen && selectedObj && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={() => setLinkOpen(false)}>
          <div className="w-[480px] max-w-[92vw] rounded-2xl border border-slate-200 bg-white p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 text-base font-bold text-slate-900">添加关联</div>
            <div className="space-y-3.5">
              <Field label="链接类型" required>
                <Select className="w-full" value={linkForm.linkTypeId} onChange={(e) => setLinkForm({ linkTypeId: e.target.value, targetId: '' })}>
                  <option value="">选择…</option>
                  {applicableLinks.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </Select>
              </Field>
              {chosenLT && (
                <Field
                  label={`选择关联对象（${chosenLT.sourceTypeId === currentType?.id ? '目标' : '来源'}类型）`}
                  required
                  hint={chosenLT.sourceTypeId === currentType?.id ? `${currentType?.name} → ${types.find((t) => t.id === chosenLT.targetTypeId)?.name}` : `${types.find((t) => t.id === chosenLT.sourceTypeId)?.name} → ${currentType?.name}`}
                >
                  <div className="space-y-2">
                    <SearchInput value={targetSearch} onChange={(e) => setTargetSearch(e.target.value)} placeholder="搜索对象…" />
                    <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-100 p-1.5">
                      {(targetsQ.data?.objects ?? []).map((o) => (
                        <button
                          key={o.id}
                          onClick={() => setLinkForm({ ...linkForm, targetId: o.id })}
                          className={cn('block w-full rounded-lg px-2.5 py-2 text-left text-[13px]', linkForm.targetId === o.id ? 'bg-brand-50 text-brand-700' : 'hover:bg-slate-50')}
                        >
                          {String(o.values.name ?? o.values.title ?? o.values.code ?? o.values.no ?? o.id)}
                          <span className="ml-1.5 text-[11px] text-slate-400">{String(o.values.code ?? o.values.no ?? '')}</span>
                        </button>
                      ))}
                      {(targetsQ.data?.objects ?? []).length === 0 && <div className="py-3 text-center text-xs text-slate-400">无匹配对象</div>}
                    </div>
                  </div>
                </Field>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Btn onClick={() => setLinkOpen(false)}>取消</Btn>
              <Btn variant="primary" disabled={busy || !linkForm.linkTypeId || !linkForm.targetId} onClick={createLink}>{busy ? '创建中…' : '建立关联'}</Btn>
            </div>
          </div>
        </div>
      )}

      {/* 探索运行结果弹层 */}
      {runResult && (
        <Modal title={`探索结果：${runResult.exploration.name}`} onClose={() => setRunResult(null)} width={640}>
          <div className="mb-3 text-xs text-slate-500">
            {types.find((t) => t.id === runResult.exploration.typeId)?.name ?? runResult.exploration.typeId} · 匹配 <b className="text-slate-700">{runResult.total}</b> 个对象（最多展示 50）
            {runResult.exploration.filters.length > 0 && <> · 条件：{runResult.exploration.filters.map((f) => `${f.key} ${f.op} ${f.value}`).join(' / ')}</>}
          </div>
          <DataTable
            rows={runResult.objects.map((o) => ({ id: o.id, label: objLabel(o.values, o.id), json: JSON.stringify(o.values) }))}
            rowKey={(r) => r.id}
            maxHeight="360px"
            columns={[
              { key: 'label', header: '对象', cell: (r) => <span className="font-medium">{r.label}</span> },
              { key: 'json', header: '属性值', cell: (r) => <span className="text-[11px] text-slate-500">{r.json}</span> },
            ]}
          />
          <div className="mt-4 flex justify-end"><Btn onClick={() => setRunResult(null)}>关闭</Btn></div>
        </Modal>
      )}

      {/* 对象集比较弹层 */}
      {compareOpen && (
        <Modal title="对象集比较" onClose={() => setCompareOpen(false)} width={680}>
          <div className="mb-3 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2 text-xs leading-5 text-slate-500">
            已勾选 {checkedObjects.length} 个对象。为每个对象勾选它属于「集合 A」和/或「集合 B」（同时属于两者即落入交集），然后开始比较。
          </div>
          <div className="mb-3 max-h-52 overflow-y-auto rounded-lg border border-slate-100">
            <table className="w-full text-[13px]">
              <thead><tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
                <th className="px-3 py-2 font-medium">对象</th>
                <th className="px-3 py-2 text-center font-medium">集合 A</th>
                <th className="px-3 py-2 text-center font-medium">集合 B</th>
              </tr></thead>
              <tbody>
                {checkedObjects.map((o) => (
                  <tr key={o.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2"><span className="font-medium">{objLabel(o.values, o.id)}</span><span className="ml-1.5 text-[11px] text-slate-400">{o.id}</span></td>
                    <td className="px-3 py-2 text-center"><input type="checkbox" checked={setA.includes(o.id)} onChange={() => toggleIn(o.id, 'A')} /></td>
                    <td className="px-3 py-2 text-center"><input type="checkbox" checked={setB.includes(o.id)} onChange={() => toggleIn(o.id, 'B')} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mb-3 flex items-center gap-2">
            <Btn size="sm" variant="primary" disabled={compareBusy} onClick={doCompare}><GitCompare size={13} /> {compareBusy ? '比较中…' : '开始比较'}</Btn>
            <span className="text-[11px] text-slate-400">A：{setA.length} 个 · B：{setB.length} 个</span>
          </div>
          {compareResult && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {([
                { label: '仅 A', color: 'blue' as const, items: compareResult.onlyA },
                { label: '仅 B', color: 'violet' as const, items: compareResult.onlyB },
                { label: '交集', color: 'green' as const, items: compareResult.intersection },
              ]).map((g) => (
                <div key={g.label} className="rounded-lg border border-slate-200 p-2.5">
                  <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-700"><Badge color={g.color}>{g.items.length}</Badge> {g.label}</div>
                  <div className="max-h-40 space-y-1 overflow-y-auto">
                    {g.items.length === 0 && <div className="py-2 text-center text-[11px] text-slate-400">无</div>}
                    {g.items.map((o) => (
                      <div key={o.id} className="truncate rounded-md bg-slate-50 px-2 py-1 text-[12px] text-slate-600" title={o.id}>
                        {objLabel(o.values, o.id)}
                        {'sameValues' in o && <span className={cn('ml-1 text-[10px]', o.sameValues ? 'text-emerald-600' : 'text-amber-600')}>{o.sameValues ? '值一致' : '值不同'}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 flex justify-end"><Btn onClick={() => setCompareOpen(false)}>关闭</Btn></div>
        </Modal>
      )}

      {/* 派生属性弹层 */}
      {derivedOpen && (
        <Modal title="派生属性" onClose={() => setDerivedOpen(false)} width={680}>
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
            <div className="mb-2 text-xs font-semibold text-slate-700">新建派生属性（当前类型：{currentType?.name ?? '—'}）</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Input placeholder="属性标识 key" value={dpForm.key} onChange={(e) => setDpForm({ ...dpForm, key: e.target.value })} />
              <Input placeholder="显示名称" value={dpForm.name} onChange={(e) => setDpForm({ ...dpForm, name: e.target.value })} />
              <Input placeholder="表达式，如 v.price * v.qty" value={dpForm.expr} onChange={(e) => setDpForm({ ...dpForm, expr: e.target.value })} />
            </div>
            <div className="mt-1.5 text-[11px] text-slate-400">用 v.属性 读取对象值，仅允许属性读取与简单运算（禁止 require/process/fetch/eval/while/for/箭头函数等）。</div>
            <div className="mt-2 flex justify-end"><Btn size="sm" variant="primary" disabled={dpSaving || !currentType} onClick={createDerived}><Sigma size={12} /> {dpSaving ? '新建中…' : '新建'}</Btn></div>
          </div>

          <div className="mt-4 text-xs font-semibold text-slate-700">已定义的派生属性（{derivedForType.length}）</div>
          <div className="mt-1.5 space-y-1.5">
            {derivedForType.length === 0 && <div className="rounded-lg border border-dashed border-slate-200 p-3 text-center text-xs text-slate-400">暂无派生属性</div>}
            {derivedForType.map((dp) => (
              <div key={dp.id} className="flex items-center gap-2 rounded-lg border border-slate-100 px-2.5 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-slate-700">{dp.name} <span className="text-[11px] text-slate-400">({dp.key})</span></div>
                  <div className="truncate font-mono text-[11px] text-slate-500">{dp.expr}</div>
                  <div className="text-[10px] text-slate-400">绑定类型：{types.find((t) => t.id === dp.typeId)?.name ?? dp.typeId}</div>
                </div>
                <Btn size="sm" disabled={dpEvalBusy} onClick={() => evalDerived(dp.id)}><Play size={12} /> {dpEvalBusy && dpEvalId === dp.id ? '计算中…' : '计算'}</Btn>
              </div>
            ))}
          </div>

          {dpResult && (
            <div className="mt-4">
              <div className="mb-1.5 text-xs font-semibold text-slate-700">
                计算结果：「{dpResult.derived.name}」· {dpResult.total} 个对象 · 表达式 <span className="font-mono">{dpResult.derived.expr}</span>
              </div>
              <DataTable
                rows={dpResult.results.map((r) => ({ id: r.id, value: r.value === null ? '—' : typeof r.value === 'object' ? JSON.stringify(r.value) : String(r.value), error: r.error }))}
                rowKey={(r) => r.id}
                maxHeight="300px"
                columns={[
                  { key: 'id', header: '对象 ID', cell: (r) => <span className="text-[11px] text-slate-500">{r.id}</span> },
                  { key: 'value', header: '计算值', cell: (r) => <span className="font-medium">{r.value}</span> },
                  { key: 'error', header: '状态', cell: (r) => r.error ? <span className="text-[11px] text-red-500">{r.error}</span> : <span className="text-[11px] text-emerald-600">正常</span> },
                ]}
              />
            </div>
          )}
          <div className="mt-4 flex justify-end"><Btn onClick={() => setDerivedOpen(false)}>关闭</Btn></div>
        </Modal>
      )}

      {/* 场景弹层 */}
      {scenarioOpen && (
        <Modal title="本体场景分支" onClose={() => setScenarioOpen(false)} width={680}>
          <div className="mb-3 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2 text-xs leading-5 text-slate-500">
            在「新增/编辑」弹层点「暂存到场景」，变更只记入场景、不会立即写入对象；合并后才会真实生效（含链接清理），或选择放弃。
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
            <div className="mb-2 text-xs font-semibold text-slate-700">新建场景</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1.4fr_auto]">
              <Input placeholder="场景名称" value={scnForm.name} onChange={(e) => setScnForm({ ...scnForm, name: e.target.value })} />
              <Input placeholder="说明（可选）" value={scnForm.desc} onChange={(e) => setScnForm({ ...scnForm, desc: e.target.value })} />
              <Btn size="sm" variant="primary" disabled={scnSaving} onClick={createScenario}><Plus size={12} /> {scnSaving ? '新建中…' : '新建'}</Btn>
            </div>
          </div>

          <div className="mt-4 text-xs font-semibold text-slate-700">场景列表（{scenariosQ.data?.scenarios?.length ?? 0}）</div>
          <div className="mt-1.5 space-y-1.5">
            {(scenariosQ.data?.scenarios ?? []).length === 0 && <div className="rounded-lg border border-dashed border-slate-200 p-3 text-center text-xs text-slate-400">暂无场景</div>}
            {(scenariosQ.data?.scenarios ?? []).map((s) => (
              <div key={s.id} className={cn('rounded-lg border px-2.5 py-2', activeScenarioId === s.id ? 'border-brand-300 bg-brand-50/50' : 'border-slate-100')}>
                <div className="flex items-center gap-2">
                  <button className="min-w-0 flex-1 text-left" onClick={() => { setActiveScenarioId(s.id); setStageScenarioId(s.id) }}>
                    <div className="flex items-center gap-1.5 text-[13px] font-medium text-slate-700">
                      {s.name}
                      <Badge color={s.status === '进行中' ? 'blue' : s.status === '已合并' ? 'green' : 'slate'}>{s.status}</Badge>
                    </div>
                    <div className="text-[11px] text-slate-400">{s.desc || '无说明'} · {s.changes.length} 项暂存变更</div>
                  </button>
                  {s.status === '进行中' && (
                    <div className="flex gap-1.5">
                      <Btn size="sm" variant="primary" disabled={scnBusy} onClick={() => mergeScenario(s.id)}><GitMerge size={12} /> 合并</Btn>
                      <Btn size="sm" disabled={scnBusy} onClick={() => discardScenario(s.id)}><Ban size={12} /> 放弃</Btn>
                    </div>
                  )}
                </div>
                {s.changes.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {s.changes.slice(0, 6).map((ch, i) => (
                      <span key={i} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                        {ch.op === 'create' ? '新建' : ch.op === 'update' ? '编辑' : '删除'} · {types.find((t) => t.id === ch.typeId)?.name ?? ch.typeId}{ch.objectId ? ` · ${ch.objectId}` : ''}
                      </span>
                    ))}
                    {s.changes.length > 6 && <span className="text-[10px] text-slate-400">…等 {s.changes.length} 项</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
          {activeScenario && (
            <div className="mt-3 rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2 text-[11px] text-brand-700">
              当前场景「{activeScenario.name}」：在新增/编辑弹层点「暂存到场景」即可把变更记入该场景。
            </div>
          )}
          <div className="mt-4 flex justify-end"><Btn onClick={() => setScenarioOpen(false)}>关闭</Btn></div>
        </Modal>
      )}
    </PageShell>
  )
}
