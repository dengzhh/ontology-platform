import { useState } from 'react'
import { Boxes, Link2, Zap, FunctionSquare, Layers, Plus, ArrowRight, KeyRound, Pencil, Trash2, X, Check, Loader2, Search, Play, RotateCcw } from 'lucide-react'
import PageShell from '@/components/ui/PageShell'
import Tabs from '@/components/ui/Tabs'
import Btn from '@/components/ui/Btn'
import DataTable from '@/components/ui/DataTable'
import StatCard from '@/components/ui/StatCard'
import { Badge, type BadgeColor } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import { KVList } from '@/components/ui/Misc'
import { Input, Select, Field } from '@/components/ui/Form'
import { useUI } from '@/store/ui'
import { api } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'
import ImportModal from './ImportModal'

/* ---------------- 类型定义 ---------------- */

interface PropDef {
  key: string
  name: string
  type: string
  required?: boolean
  enumValues?: string[]
}

interface ObjectTypeRow {
  id: string
  apiName: string
  name: string
  desc: string
  color: string
  icon: string
  primaryKey: string
  properties: PropDef[]
  count: number
  createdAt: number
}

interface LinkTypeRow {
  id: string
  name: string
  sourceTypeId: string
  targetTypeId: string
  sourceName: string
  targetName: string
  cardinality: string
  desc: string
  count: number
}

interface ActionTypeRow {
  id: string
  name: string
  targetTypeId: string
  targetName: string
  params: PropDef[]
  needsApproval: number
  desc: string
  execCount: number
}

interface FunctionRow {
  id: string
  name: string
  desc: string
  lang: string
  linkedTypeIds: string[]
  linkedNames: string[]
  versionCount: number
  publishedVersion: number | null
}

/** 函数版本（可执行 JS 沙箱） */
interface FunctionVersionRow {
  id: string
  functionId: string
  version: number
  lang: string
  body: string
  status: string
  testInput: string
  testOutput: string
  publishedAt: number | null
  spaceId: string
  createdAt: number
}

/** 沙箱执行结果 */
interface RunResult {
  ok: boolean
  result: unknown
  error: string
  durationMs: number
  functionId?: string
  versionId?: string
  version?: number
}

const PROP_TYPES = ['string', 'number', 'date', 'boolean', 'enum']
const COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#6366f1', '#0ea5e9', '#84cc16']
const CARDINALITIES = ['1:1', '1:N', 'N:1', 'N:N']
const FN_LANGS = ['TypeScript', 'JavaScript', 'Python', 'SQL']

/** 函数体约定：function main(input) { … return … }，在服务端 node:vm 沙箱执行 */
const FN_TEMPLATE = `function main(input) {
  // 可用：input / Math / JSON / Date / String / Number / Array / Object
  // 禁止：require / process / global / fetch / eval / Function
  return { received: input };
}`

/** 版本/运行端点前缀（新路由由 index.ts 统一挂载，前端按字面路径调用） */
const FN_API = '/fn'

/** 新建函数表单：body 为逻辑描述（本地版本通过 Code Repositories 编写，P6 起可作为 智能工具被调用） */
interface NewFunctionDraft {
  name: string
  desc: string
  lang: string
  linkedTypeIds: string[]
  body: string
}

/** 接口（Interface）：约束实现类型必须提供的属性契约 */
interface InterfaceRow {
  id: string
  name: string
  desc: string
  properties: { key: string; name: string; type: string; required?: boolean }[]
  propCount: number
  implementedBy: string[]
  implementedNames: string[]
  updatedAt: string
}
interface IfaceCheckResult {
  typeId: string
  typeName: string
  ok: boolean
  missing: string[]
}

/** 新建/编辑接口表单 */
interface NewInterfaceDraft {
  id?: string
  name: string
  desc: string
  properties: { key: string; name: string; type: string; required?: boolean }[]
  implementedBy: string[]
}
const EMPTY_INTERFACE: NewInterfaceDraft = { name: '', desc: '', properties: [{ key: '', name: '', type: 'string' }], implementedBy: [] }

/** 业务术语 / 认证指标（语义层） */
interface TermRow {
  id: string; term: string; synonyms: string[]; typeId: string; propertyKey: string
  definition: string; metricExpr: string; certified: boolean; typeName: string; updatedAt: string
}
interface NewTermDraft {
  id?: string; term: string; synonyms: string; typeId: string; propertyKey: string
  definition: string; metricExpr: string; certified: boolean
}
const EMPTY_TERM: NewTermDraft = { term: '', synonyms: '', typeId: '', propertyKey: '', definition: '', metricExpr: '', certified: false }
const EMPTY_FUNCTION: NewFunctionDraft = { name: '', desc: '', lang: 'TypeScript', linkedTypeIds: [], body: '' }

/* ---------------- 属性编辑器 ---------------- */

function PropertyEditor({ props, onChange }: { props: PropDef[]; onChange: (p: PropDef[]) => void }) {
  function update(i: number, patch: Partial<PropDef>) {
    onChange(props.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  }
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <div className="grid grid-cols-[1.2fr_1fr_0.9fr_52px_1.4fr_32px] gap-2 bg-slate-50 px-2.5 py-2 text-[11px] font-medium text-slate-500">
        <span>属性名称*</span><span>字段 key*</span><span>类型</span><span>必填</span><span>枚举值（逗号分隔）</span><span />
      </div>
      {props.map((p, i) => (
        <div key={i} className="grid grid-cols-[1.2fr_1fr_0.9fr_52px_1.4fr_32px] items-center gap-2 border-t border-slate-100 px-2.5 py-1.5">
          <Input className="py-1 text-xs" value={p.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="如 设备名称" />
          <Input className="py-1 font-mono text-xs" value={p.key} onChange={(e) => update(i, { key: e.target.value.replace(/[^\w]/g, '') })} placeholder="name" />
          <Select className="py-1 text-xs" value={p.type} onChange={(e) => update(i, { type: e.target.value })}>
            {PROP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
          <button
            onClick={() => update(i, { required: !p.required })}
            className={cn('flex h-6 w-6 items-center justify-center rounded', p.required ? 'bg-red-50 text-red-500' : 'text-slate-300 hover:text-slate-400')}
            title="必填"
          >
            {p.required ? <Check size={13} /> : <X size={13} />}
          </button>
          <Input
            className="py-1 text-xs"
            value={p.enumValues?.join(',') ?? ''}
            onChange={(e) => update(i, { enumValues: e.target.value ? e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : undefined })}
            placeholder={p.type === 'enum' ? '运行,待机,维修' : '仅 enum 类型可填'}
            disabled={p.type !== 'enum'}
          />
          <button onClick={() => onChange(props.filter((_, j) => j !== i))} className="text-slate-300 hover:text-red-500" title="删除属性行">
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <button
        onClick={() => onChange([...props, { key: '', name: '', type: 'string' }])}
        className="flex w-full items-center justify-center gap-1 border-t border-dashed border-slate-200 py-2 text-xs text-slate-400 hover:border-brand-300 hover:text-brand-600"
      >
        <Plus size={12} /> 添加属性
      </button>
    </div>
  )
}

/* ---------------- 主页面 ---------------- */

export default function OntologyManager() {
  const { currentUser } = useUI()
  const canEdit = currentUser?.role.id === 'admin' || currentUser?.role.id === 'data-eng'

  const typesQ = useApi<{ types: ObjectTypeRow[] }>('/ontology/types')
  const linksQ = useApi<{ links: LinkTypeRow[] }>('/ontology/links')
  const actionsQ = useApi<{ actions: ActionTypeRow[] }>('/ontology/actions')
  const fnsQ = useApi<{ functions: FunctionRow[] }>('/ontology/functions')
  const ifacesQ = useApi<{ interfaces: InterfaceRow[] }>('/ontology/interfaces')
  const termsQ = useApi<{ terms: TermRow[] }>('/ontology/terms')

  const [tab, setTab] = useState('objects')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const types = typesQ.data?.types ?? []
  const current = types.find((t) => t.id === selectedId) ?? types[0]

  const [toast, setToast] = useState('')
  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2600) }

  /* 对象类型编辑态 */
  const [editing, setEditing] = useState(false)
  const [editDraft, setEditDraft] = useState<{ name: string; desc: string; color: string; properties: PropDef[] } | null>(null)
  const [busy, setBusy] = useState(false)

  /* 新建弹层 */
  const [newTypeOpen, setNewTypeOpen] = useState(false)
  const [newType, setNewType] = useState({ name: '', apiName: '', desc: '', color: COLORS[0], properties: [] as PropDef[] })
  const [newLinkOpen, setNewLinkOpen] = useState(false)
  const [newLink, setNewLink] = useState({ name: '', sourceTypeId: '', targetTypeId: '', cardinality: '1:N', desc: '' })
  const [newActionOpen, setNewActionOpen] = useState(false)
  const [newAction, setNewAction] = useState({ name: '', targetTypeId: '', needsApproval: false, desc: '' })
  const [newFnOpen, setNewFnOpen] = useState(false)
  const [newFn, setNewFn] = useState<NewFunctionDraft>(EMPTY_FUNCTION)
  /* 函数：版本列表 / 编辑代码 / 测试运行 / 发布 / 回滚 */
  const [versionsFnId, setVersionsFnId] = useState<string | null>(null)
  const [versions, setVersions] = useState<FunctionVersionRow[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorFnId, setEditorFnId] = useState<string | null>(null)
  const [editorCode, setEditorCode] = useState('')
  const [editorTestInput, setEditorTestInput] = useState('{}')
  const [testOpen, setTestOpen] = useState(false)
  const [testFnId, setTestFnId] = useState<string | null>(null)
  const [testInput, setTestInput] = useState('{}')
  const [testVersionId, setTestVersionId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<RunResult | null>(null)
  const [fnBusy, setFnBusy] = useState<string | null>(null)
  /* 接口编辑态 */
  const [newIfaceOpen, setNewIfaceOpen] = useState(false)
  const [newIface, setNewIface] = useState<NewInterfaceDraft>(EMPTY_INTERFACE)
  const [checkResults, setCheckResults] = useState<Record<string, IfaceCheckResult[]>>({})
  /* 业务术语 */
  const [newTermOpen, setNewTermOpen] = useState(false)
  const [newTerm, setNewTerm] = useState<NewTermDraft>(EMPTY_TERM)
  const [termProbe, setTermProbe] = useState('')
  const [termProbeResult, setTermProbeResult] = useState<{ hits: string[]; total: number; answerable: boolean } | null>(null)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)

  async function saveTypeEdit() {
    if (!current || !editDraft) return
    if (editDraft.properties.some((p) => !p.key || !p.name)) return notify('属性存在空的名称或字段 key')
    setBusy(true)
    try {
      await api(`/ontology/types/${current.id}`, { method: 'PATCH', body: editDraft })
      notify(`已保存「${editDraft.name}」的修改（审计已留痕）`)
      setEditing(false)
      typesQ.reload()
    } catch (e) { notify(e instanceof Error ? e.message : '保存失败') } finally { setBusy(false) }
  }

  async function createType() {
    if (!newType.name) return notify('请填写类型名称')
    if (newType.properties.some((p) => !p.key || !p.name)) return notify('属性存在空的名称或字段 key')
    setBusy(true)
    try {
      const res = await api<{ type: ObjectTypeRow }>('/ontology/types', { method: 'POST', body: newType })
      notify(`对象类型「${res.type.name}」已创建，即刻生效（可查询 / AI 可见）`)
      setNewTypeOpen(false)
      setNewType({ name: '', apiName: '', desc: '', color: COLORS[0], properties: [] })
      setSelectedId(res.type.id)
      typesQ.reload()
    } catch (e) { notify(e instanceof Error ? e.message : '创建失败') } finally { setBusy(false) }
  }

  async function createLink() {
    if (!newLink.name || !newLink.sourceTypeId || !newLink.targetTypeId) return notify('请填写名称与两端类型')
    setBusy(true)
    try {
      await api('/ontology/links', { method: 'POST', body: newLink })
      notify(`链接类型「${newLink.name}」已创建`)
      setNewLinkOpen(false)
      setNewLink({ name: '', sourceTypeId: '', targetTypeId: '', cardinality: '1:N', desc: '' })
      linksQ.reload()
    } catch (e) { notify(e instanceof Error ? e.message : '创建失败') } finally { setBusy(false) }
  }

  async function createAction() {
    if (!newAction.name || !newAction.targetTypeId) return notify('请填写名称与目标对象类型')
    setBusy(true)
    try {
      await api('/ontology/actions', { method: 'POST', body: { ...newAction, params: [{ key: 'objectId', name: '目标对象', type: 'string', required: true }, { key: 'comment', name: '说明', type: 'string' }] } })
      notify(`动作类型「${newAction.name}」已创建`)
      setNewActionOpen(false)
      setNewAction({ name: '', targetTypeId: '', needsApproval: false, desc: '' })
      actionsQ.reload()
    } catch (e) { notify(e instanceof Error ? e.message : '创建失败') } finally { setBusy(false) }
  }

  async function createFunction() {
    if (!newFn.name.trim()) return notify('请填写函数名')
    setBusy(true)
    try {
      await api('/ontology/functions', {
        method: 'POST',
        body: {
          name: newFn.name.trim(),
          desc: newFn.desc,
          lang: newFn.lang,
          linkedTypeIds: newFn.linkedTypeIds,
          body: newFn.body,
        },
      })
      notify(`函数「${newFn.name.trim()}」已创建（审计已留痕）`)
      setNewFnOpen(false)
      setNewFn(EMPTY_FUNCTION)
      fnsQ.reload()
    } catch (e) { notify(e instanceof Error ? e.message : '创建失败') } finally { setBusy(false) }
  }

  /* ---------------- 函数版本：列表 / 新建 / 编辑代码 / 测试 / 发布 / 回滚 / 运行 ---------------- */

  async function loadVersions(fnId: string) {
    setVersionsFnId(fnId)
    setVersionsLoading(true)
    setVersions([])
    try {
      const r = await api<{ versions: FunctionVersionRow[] }>(`${FN_API}/functions/${fnId}/versions`)
      setVersions(r.versions)
    } catch (e) { notify(e instanceof Error ? e.message : '加载版本失败') } finally { setVersionsLoading(false) }
  }

  /** 新建版本：可复用「编辑代码」弹层，默认填入 main 模板 */
  function openNewVersion(fnId: string) {
    setEditorFnId(fnId)
    setEditorCode(FN_TEMPLATE)
    setEditorTestInput('{}')
    setEditorOpen(true)
  }

  /** 编辑代码：从已发布/最新版本带入代码，保存后生成新草稿版本并自动测试 */
  function openEditCode(fnId: string) {
    const base = versions.length ? versions[0] : null
    setEditorFnId(fnId)
    setEditorCode(base?.body ?? FN_TEMPLATE)
    setEditorTestInput(base?.testInput ?? '{}')
    setEditorOpen(true)
  }

  async function saveNewVersion() {
    if (!editorFnId) return
    if (!editorCode.trim()) return notify('请填写函数代码')
    setFnBusy('saveVersion')
    try {
      const r = await api<{ version: FunctionVersionRow; test: RunResult }>(
        `${FN_API}/functions/${editorFnId}/versions`,
        { method: 'POST', body: { body: editorCode, lang: 'javascript', testInput: editorTestInput } },
      )
      notify(`已创建 v${r.version.version} 草稿版本${r.test.ok ? '（自动测试通过）' : '（自动测试失败：' + r.test.error + '）'}`)
      setEditorOpen(false)
      fnsQ.reload()
      await loadVersions(editorFnId)
    } catch (e) { notify(e instanceof Error ? e.message : '新建版本失败') } finally { setFnBusy(null) }
  }

  function openTest(fnId: string, versionId?: string) {
    setTestFnId(fnId)
    setTestResult(null)
    // 带版本测试时优先使用该版本保存的测试输入
    const v = versionId ? versions.find((x) => x.id === versionId) : null
    setTestInput(v?.testInput ?? '{}')
    setTestOpen(true)
    setTestVersionId(versionId ?? null)
  }

  async function runTest() {
    if (!testFnId) return
    setFnBusy('runTest')
    setTestResult(null)
    try {
      // 指定版本 → 走该版本测试端点（回写 testOutput）；否则走函数运行入口（执行已发布版本）
      const r = testVersionId
        ? await api<RunResult>(`${FN_API}/functions/${testFnId}/versions/${testVersionId}/test`, { method: 'POST', body: { input: testInput } })
        : await api<RunResult>(`${FN_API}/functions/${testFnId}/run`, { method: 'POST', body: { input: testInput } })
      setTestResult(r)
      if (r.ok) notify(`运行成功（${r.durationMs} ms）`)
      else notify(`运行失败：${r.error}`)
      if (versionsFnId) await loadVersions(versionsFnId)
    } catch (e) { notify(e instanceof Error ? e.message : '运行失败') } finally { setFnBusy(null) }
  }

  async function publishVersion(fnId: string, v: FunctionVersionRow) {
    setFnBusy(`publish-${v.id}`)
    try {
      await api(`${FN_API}/functions/${fnId}/versions/${v.id}/publish`, { method: 'POST' })
      notify(`已发布 v${v.version}（其余版本回落草稿，审计已留痕）`)
      fnsQ.reload()
      await loadVersions(fnId)
    } catch (e) { notify(e instanceof Error ? e.message : '发布失败') } finally { setFnBusy(null) }
  }

  async function rollbackVersion(fnId: string, v: FunctionVersionRow) {
    setFnBusy(`rollback-${v.id}`)
    try {
      await api(`${FN_API}/functions/${fnId}/versions/${v.id}/rollback`, { method: 'POST' })
      notify(`已回滚到 v${v.version}（审计已留痕）`)
      fnsQ.reload()
      await loadVersions(fnId)
    } catch (e) { notify(e instanceof Error ? e.message : '回滚失败') } finally { setFnBusy(null) }
  }

  async function remove(path: string, id: string, label: string) {
    setBusy(true)
    try {
      await api(`${path}/${id}`, { method: 'DELETE' })
      notify(`已删除 ${label}（审计已留痕）`)
      setConfirmDel(null)
      if (path.includes('types')) { typesQ.reload(); setSelectedId(null) }
      if (path.includes('links')) linksQ.reload()
      if (path.includes('actions')) actionsQ.reload()
      if (path.includes('interfaces')) ifacesQ.reload()
      if (path.includes('terms')) termsQ.reload()
    } catch (e) { notify(e instanceof Error ? e.message : '删除失败') } finally { setBusy(false) }
  }

  /* 接口：保存（新建/编辑共用）与符合性校验 */
  async function saveInterface() {
    if (!newIface.name.trim()) return notify('请填写接口名称')
    const props = newIface.properties.filter((p) => p.key.trim() && p.name.trim())
    if (props.length === 0) return notify('至少填写一个契约属性')
    setBusy(true)
    try {
      await api('/ontology/interfaces', {
        method: 'POST',
        body: { id: newIface.id, name: newIface.name.trim(), desc: newIface.desc, properties: props, implementedBy: newIface.implementedBy },
      })
      notify(`接口「${newIface.name.trim()}」已${newIface.id ? '更新' : '创建'}（审计已留痕）`)
      setNewIfaceOpen(false)
      setNewIface(EMPTY_INTERFACE)
      ifacesQ.reload()
    } catch (e) { notify(e instanceof Error ? e.message : '保存失败') } finally { setBusy(false) }
  }

  async function checkInterface(id: string) {
    try {
      const r = await api<{ results: IfaceCheckResult[] | null; propCount: number }>(`/ontology/interfaces/${id}/check`)
      setCheckResults((prev) => ({ ...prev, [id]: r.results ?? [] }))
      if (r.results === null) return notify('该接口尚未绑定实现对象')
      const bad = r.results.filter((x) => !x.ok)
      notify(bad.length === 0 ? '符合性校验通过：全部实现类型满足契约' : `${bad.length} 个实现类型缺少契约属性`)
    } catch (e) { notify(e instanceof Error ? e.message : '校验失败') }
  }

  /* 业务术语：保存 / 认证 / 删除 / 解析预检 */
  async function saveTerm() {
    if (!newTerm.term.trim()) return notify('请填写术语名称')
    setBusy(true)
    try {
      await api('/ontology/terms', {
        method: 'POST',
        body: {
          id: newTerm.id, term: newTerm.term.trim(),
          synonyms: newTerm.synonyms.split(/[、,，]/).map((s) => s.trim()).filter(Boolean),
          typeId: newTerm.typeId || undefined, propertyKey: newTerm.propertyKey || undefined,
          definition: newTerm.definition, metricExpr: newTerm.metricExpr, certified: newTerm.certified,
        },
      })
      notify(`术语「${newTerm.term.trim()}」已${newTerm.id ? '更新' : '创建'}${newTerm.certified ? '并认证' : ''}（审计已留痕）`)
      setNewTermOpen(false); setNewTerm(EMPTY_TERM); termsQ.reload()
    } catch (e) { notify(e instanceof Error ? e.message : '保存失败') } finally { setBusy(false) }
  }

  async function certifyTerm(t: TermRow) {
    setBusy(true)
    try {
      await api(`/ontology/terms/${t.id}/certify`, { method: 'PATCH', body: { certified: !t.certified } })
      notify(`术语「${t.term}」已${t.certified ? '撤销认证' : '认证'}`)
      termsQ.reload()
    } catch (e) { notify(e instanceof Error ? e.message : '操作失败') } finally { setBusy(false) }
  }

  async function probeTerm() {
    if (!termProbe.trim()) return
    try {
      const r = await api<{ hits: { term: string }[]; total: number; answerable: boolean }>(`/ontology/terms/resolve?q=${encodeURIComponent(termProbe)}`)
      setTermProbeResult({ hits: r.hits.map((h) => h.term), total: r.total, answerable: r.answerable })
    } catch (e) { notify(e instanceof Error ? e.message : '解析失败') }
  }

  const linkCount = linksQ.data?.links.length ?? 0
  const actionCount = actionsQ.data?.actions.length ?? 0
  const totalInstances = types.reduce((s, t) => s + t.count, 0)

  return (
    <PageShell
      icon={Boxes}
      title="本体管理器"
      subtitle="定义企业的对象、链接、动作、函数与接口 —— 建模即时生效，全程审计留痕"
      benchmark="本体建模"
      features={[
        '对象类型在线建模：属性（文本/数值/日期/布尔/枚举）、必填约束、主键、展示颜色',
        '链接类型：任意两端对象类型 + 四种基数（1:1 / 1:N / N:1 / N:N）',
        '动作类型：目标对象 + 参数 + 是否需审批（P4 动作引擎执行）',
        '即时生效：新建类型立即可被对象查询与智能助手检索到',
        '安全删除：存在实例或被引用的类型禁止删除，防止悬空数据',
        '接口契约：定义属性契约并绑定实现对象类型，一键校验符合性',
      ]}
      actions={
        <>
          <Btn size="sm" disabled={!canEdit} onClick={() => setImportOpen(true)}><Layers size={13} /> 导入本体</Btn>
          <Btn size="sm" variant="primary" disabled={!canEdit} onClick={() => setNewTypeOpen(true)}>
            <Plus size={14} /> 新建对象类型
          </Btn>
        </>
      }
    >
      {toast && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">{toast}</div>}
      {!canEdit && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-700">
          当前角色「{currentUser?.role.name}」为只读视角：可浏览本体定义，编辑需平台管理员或数据工程师
        </div>
      )}

      {/* 统计 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="对象类型" value={types.length} icon={Boxes} footer="含真实实例计数" />
        <StatCard label="链接类型" value={linkCount} icon={Link2} iconClass="bg-violet-50 text-violet-600" footer={`${linksQ.data?.links.reduce((s, l) => s + l.count, 0) ?? 0} 条链接实例`} />
        <StatCard label="动作类型" value={actionCount} icon={Zap} iconClass="bg-amber-50 text-amber-600" footer={`其中 ${actionsQ.data?.actions.filter((a) => a.needsApproval).length ?? 0} 类需审批`} />
        <StatCard label="对象实例总数" value={totalInstances.toLocaleString()} icon={Layers} iconClass="bg-emerald-50 text-emerald-600" footer="由数据管道与建模共同维护" />
      </div>

      <Card padding={false}>
        <div className="border-b border-slate-100 p-3">
          <Tabs
            tabs={[
              { key: 'objects', label: '对象类型', count: types.length },
              { key: 'links', label: '链接类型', count: linkCount },
              { key: 'actions', label: '动作类型', count: actionCount },
              { key: 'functions', label: '函数', count: fnsQ.data?.functions.length },
              { key: 'interfaces', label: '接口', count: ifacesQ.data?.interfaces.length },
              { key: 'terms', label: '业务术语', count: termsQ.data?.terms.length },
            ]}
            active={tab}
            onChange={setTab}
          />
        </div>

        {typesQ.loading && tab === 'objects' && (
          <div className="flex items-center justify-center gap-2 py-14 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" /> 加载本体定义…</div>
        )}

        {/* 对象类型 */}
        {tab === 'objects' && !typesQ.loading && current && (
          <div className="flex min-h-[460px]">
            <div className="w-56 shrink-0 border-r border-slate-100 p-2">
              {types.map((t) => (
                <button
                  key={t.id}
                  onClick={() => { setSelectedId(t.id); setEditing(false); setConfirmDel(null) }}
                  className={cn('mb-1 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium', current.id === t.id ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50')}
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t.color }} />
                  <span className="flex-1 truncate">{t.name}</span>
                  <span className="text-[11px] text-slate-400">{t.count}</span>
                </button>
              ))}
              {canEdit && (
                <button onClick={() => setNewTypeOpen(true)} className="mt-1 flex w-full items-center gap-2 rounded-lg border border-dashed border-slate-200 px-2.5 py-2 text-[13px] text-slate-400 hover:border-brand-300 hover:text-brand-600">
                  <Plus size={14} /> 新建对象类型
                </button>
              )}
            </div>

            <div className="min-w-0 flex-1 p-4">
              {!editing ? (
                <>
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-full" style={{ background: current.color }} />
                        <span className="text-base font-bold text-slate-900">{current.name}</span>
                        <Badge color="blue">{current.apiName}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-slate-400">{current.desc || '（暂无描述）'}</p>
                    </div>
                    {canEdit && (
                      <div className="flex shrink-0 gap-2">
                        <Btn size="sm" onClick={() => { setEditDraft({ name: current.name, desc: current.desc, color: current.color, properties: current.properties.map((p) => ({ ...p })) }); setEditing(true) }}>
                          <Pencil size={12} /> 编辑定义
                        </Btn>
                        {confirmDel === current.id ? (
                          <>
                            <Btn size="sm" variant="danger" disabled={busy} onClick={() => remove('/ontology/types', current.id, current.name)}>确认删除？</Btn>
                            <Btn size="sm" variant="ghost" onClick={() => setConfirmDel(null)}>取消</Btn>
                          </>
                        ) : (
                          <Btn size="sm" variant="ghost" onClick={() => setConfirmDel(current.id)}><Trash2 size={12} /></Btn>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="mb-4 rounded-lg border border-slate-100 bg-slate-50/60 p-3.5">
                    <KVList
                      items={[
                        { k: 'API 标识', v: <code className="rounded bg-white px-1.5 py-0.5 font-mono text-xs text-brand-700">{current.id}</code> },
                        { k: '主键', v: <span className="inline-flex items-center gap-1"><KeyRound size={12} className="text-amber-500" />{current.primaryKey}</span> },
                        { k: '实例数量', v: `${current.count} 个（真实数据）` },
                        { k: '创建时间', v: new Date(current.createdAt).toLocaleString('zh-CN', { hour12: false }) },
                      ]}
                    />
                  </div>

                  <CardHeader title={<span>属性定义（{current.properties.length}）</span>} desc={canEdit ? '点击「编辑定义」修改属性结构' : '只读'} />
                  <DataTable
                    dense
                    rows={current.properties}
                    columns={[
                      { key: 'name', header: '属性名称', cell: (r) => <span className="font-medium text-slate-800">{r.name}</span> },
                      { key: 'key', header: '字段', cell: (r) => <code className="font-mono text-xs text-slate-500">{r.key}</code> },
                      { key: 'type', header: '类型', cell: (r) => <Badge color={(r.type === 'enum' ? 'violet' : r.type === 'number' ? 'cyan' : 'slate') as BadgeColor}>{r.type}</Badge> },
                      { key: 'required', header: '必填', cell: (r) => (r.required ? <Badge color="red">必填</Badge> : <span className="text-slate-300">—</span>) },
                      { key: 'enumValues', header: '枚举值', cell: (r) => <span className="text-xs text-slate-500">{r.enumValues?.join(' / ') ?? '—'}</span> },
                    ]}
                  />
                </>
              ) : (
                editDraft && (
                  <>
                    <div className="mb-4 flex items-center justify-between">
                      <div className="text-base font-bold text-slate-900">编辑「{current.name}」定义</div>
                      <div className="flex gap-2">
                        <Btn size="sm" onClick={() => setEditing(false)}>取消</Btn>
                        <Btn size="sm" variant="primary" disabled={busy} onClick={saveTypeEdit}>{busy ? '保存中…' : '保存修改'}</Btn>
                      </div>
                    </div>
                    <div className="mb-4 grid gap-3 md:grid-cols-[1fr_2fr_auto]">
                      <Field label="类型名称" required><Input value={editDraft.name} onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })} /></Field>
                      <Field label="描述"><Input value={editDraft.desc} onChange={(e) => setEditDraft({ ...editDraft, desc: e.target.value })} /></Field>
                      <Field label="展示颜色">
                        <div className="flex gap-1.5 pt-1">
                          {COLORS.map((c) => (
                            <button key={c} onClick={() => setEditDraft({ ...editDraft, color: c })} className={cn('h-6 w-6 rounded-full', editDraft.color === c && 'ring-2 ring-slate-400 ring-offset-2')} style={{ background: c }} />
                          ))}
                        </div>
                      </Field>
                    </div>
                    <CardHeader title="属性定义" desc="保存即生效；已有实例的旧字段数据仍保留在 values 中" />
                    <PropertyEditor props={editDraft.properties} onChange={(p) => setEditDraft({ ...editDraft, properties: p })} />
                  </>
                )
              )}
            </div>
          </div>
        )}

        {/* 链接类型 */}
        {tab === 'links' && (
          <div className="p-4">
            <div className="mb-3 flex justify-end">
              <Btn size="sm" variant="primary" disabled={!canEdit} onClick={() => setNewLinkOpen(true)}><Plus size={13} /> 新建链接类型</Btn>
            </div>
            <DataTable
              rows={linksQ.data?.links ?? []}
              rowKey={(l) => l.id}
              columns={[
                {
                  key: 'name', header: '链接类型', cell: (l) => (
                    <span className="font-semibold text-slate-800">
                      {l.name}
                      {confirmDel === l.id && (
                        <span className="ml-2 inline-flex items-center gap-1.5">
                          <button disabled={busy} onClick={() => remove('/ontology/links', l.id, l.name)} className="rounded bg-red-500 px-1.5 py-0.5 text-[10px] text-white">确认删除</button>
                          <button onClick={() => setConfirmDel(null)} className="text-[10px] text-slate-400 hover:text-slate-600">取消</button>
                        </span>
                      )}
                    </span>
                  ),
                },
                {
                  key: 'pair', header: '两端对象', cell: (l) => (
                    <span className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                      {l.sourceName}<ArrowRight size={12} className="text-slate-400" />{l.targetName}
                    </span>
                  ),
                },
                { key: 'cardinality', header: '基数', cell: (l) => <Badge color={l.cardinality === 'N:N' ? 'violet' : 'blue'}>{l.cardinality}</Badge> },
                { key: 'count', header: '链接实例', align: 'right' },
                { key: 'desc', header: '说明', cell: (l) => <span className="text-xs text-slate-500">{l.desc}</span> },
                {
                  key: 'op', header: '', align: 'center', cell: (l) => canEdit ? (
                    <button onClick={() => setConfirmDel(confirmDel === l.id ? null : l.id)} className="text-slate-300 hover:text-red-500"><Trash2 size={13} /></button>
                  ) : null,
                },
              ]}
            />
          </div>
        )}

        {/* 动作类型 */}
        {tab === 'actions' && (
          <div className="p-4">
            <div className="mb-3 flex justify-end">
              <Btn size="sm" variant="primary" disabled={!canEdit} onClick={() => setNewActionOpen(true)}><Plus size={13} /> 新建动作类型</Btn>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {(actionsQ.data?.actions ?? []).map((a) => (
                <div key={a.id} className="rounded-xl border border-slate-200 p-4 transition-colors hover:border-brand-300">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600"><Zap size={15} /></div>
                      <span className="text-[14px] font-bold text-slate-800">{a.name}</span>
                    </div>
                    {canEdit ? (
                      <button
                        onClick={async () => {
                          try {
                            await api(`/ontology/actions/${a.id}`, { method: 'PATCH', body: { needsApproval: !a.needsApproval } })
                            notify(`「${a.name}」已切换为${!a.needsApproval ? '需审批' : '直接执行'}`)
                            actionsQ.reload()
                          } catch (e) { notify(e instanceof Error ? e.message : '更新失败') }
                        }}
                        title="点击切换审批策略"
                      >
                        {a.needsApproval ? <Badge color="red">需审批 ↺</Badge> : <Badge color="green">直接执行 ↺</Badge>}
                      </button>
                    ) : (
                      a.needsApproval ? <Badge color="red">需审批</Badge> : <Badge color="green">直接执行</Badge>
                    )}
                  </div>
                  <div className="mb-2 text-xs leading-5 text-slate-500">{a.desc}</div>
                  <div className="space-y-1 text-[11px] text-slate-500">
                    <div>目标对象：<span className="font-medium text-slate-700">{a.targetName}</span></div>
                    <div>参数：<span className="font-mono">{a.params.map((p) => p.name).join(' / ') || '—'}</span></div>
                    <div>累计执行：<span className="font-medium text-slate-700">{a.execCount} 次</span></div>
                  </div>
                  {canEdit && (
                    <div className="mt-2 border-t border-slate-50 pt-2 text-right">
                      {confirmDel === a.id ? (
                        <span className="flex items-center gap-1.5">
                          <button disabled={busy} onClick={() => remove('/ontology/actions', a.id, a.name)} className="rounded bg-red-500 px-2 py-1 text-[11px] text-white">确认删除</button>
                          <button onClick={() => setConfirmDel(null)} className="text-[11px] text-slate-400 hover:text-slate-600">取消</button>
                        </span>
                      ) : (
                        <button onClick={() => setConfirmDel(a.id)} className="inline-flex items-center gap-1 text-[11px] text-slate-300 hover:text-red-500"><Trash2 size={11} /> 删除</button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 函数（可执行版本：编辑代码 / 测试运行 / 发布 / 回滚） */}
        {tab === 'functions' && (
          <div className="p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="text-[12px] text-slate-500">函数体约定 <code className="rounded bg-slate-100 px-1 font-mono">function main(input) {'{ … }'}</code>，在服务端 node:vm 沙箱真实执行；发布后可供动作/查询调用</div>
              <Btn size="sm" variant="primary" disabled={!canEdit} onClick={() => setNewFnOpen(true)}><Plus size={13} /> 新建函数</Btn>
            </div>
            {fnsQ.loading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" /> 加载函数…</div>
            ) : (fnsQ.data?.functions.length ?? 0) === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-8 text-center text-sm text-slate-400">
                暂无函数，点击右上「新建函数」登记第一个可执行函数
              </div>
            ) : (
              <div className="space-y-3">
                {fnsQ.data?.functions.map((f) => (
                  <div key={f.id} className="rounded-xl border border-slate-200 p-3.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <FunctionSquare size={14} className="shrink-0 text-brand-600" />
                          <code className="rounded bg-brand-50 px-1.5 py-0.5 font-mono text-xs font-semibold text-brand-700">{f.name}</code>
                          <Badge color="slate">{f.lang}</Badge>
                          <Badge color="blue">{f.versionCount ?? 0} 个版本</Badge>
                          {f.publishedVersion != null
                            ? <Badge color="green">已发布 v{f.publishedVersion}</Badge>
                            : <Badge color="amber">未发布</Badge>}
                        </div>
                        {f.desc && <div className="mt-1 text-[11px] text-slate-400">{f.desc}</div>}
                        <div className="mt-1 text-[11px] text-slate-400">关联对象：{f.linkedNames?.join(' / ') || '—'}</div>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-1">
                        <Btn size="sm" onClick={() => loadVersions(f.id)} disabled={versionsFnId === f.id && versionsLoading}>
                          {versionsFnId === f.id && versionsLoading ? <Loader2 size={12} className="animate-spin" /> : <Layers size={12} />} 版本列表
                        </Btn>
                        <Btn size="sm" onClick={() => openTest(f.id)}><Play size={12} /> 测试运行</Btn>
                        {canEdit && <Btn size="sm" onClick={() => openNewVersion(f.id)}><Plus size={12} /> 新建版本</Btn>}
                      </div>
                    </div>

                    {/* 版本列表 + 发布 / 回滚 / 编辑 / 单版本测试 */}
                    {versionsFnId === f.id && (
                      <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50/60 p-2.5">
                        <div className="mb-2 flex items-center justify-between">
                          <div className="text-[12px] font-semibold text-slate-600">版本历史（按版本降序）</div>
                          {canEdit && <Btn size="sm" onClick={() => openEditCode(f.id)}><Pencil size={12} /> 编辑代码</Btn>}
                        </div>
                        {versionsLoading ? (
                          <div className="flex items-center gap-2 py-4 text-xs text-slate-400"><Loader2 size={13} className="animate-spin" /> 加载版本…</div>
                        ) : versions.length === 0 ? (
                          <div className="py-4 text-center text-xs text-slate-400">尚无版本，点击「新建版本」或「编辑代码」创建第一个草稿</div>
                        ) : (
                          <div className="space-y-1.5">
                            {versions.map((v) => {
                              const isPublished = v.status === '已发布'
                              return (
                                <div key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-2">
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono text-xs font-bold text-slate-700">v{v.version}</span>
                                    <Badge color={isPublished ? 'green' : 'slate'}>{v.status}</Badge>
                                    {v.publishedAt && <span className="text-[10px] text-slate-400">{new Date(v.publishedAt).toLocaleString('zh-CN', { hour12: false })}</span>}
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <Btn size="sm" variant="ghost" onClick={() => openTest(f.id, v.id)}><Play size={12} /> 测试</Btn>
                                    {canEdit && !isPublished && (
                                      <>
                                        <Btn size="sm" onClick={() => publishVersion(f.id, v)} disabled={fnBusy === `publish-${v.id}`}>
                                          {fnBusy === `publish-${v.id}` ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} 发布
                                        </Btn>
                                        <Btn size="sm" onClick={() => rollbackVersion(f.id, v)} disabled={fnBusy === `rollback-${v.id}`}>
                                          {fnBusy === `rollback-${v.id}` ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} 回滚
                                        </Btn>
                                      </>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 接口（真实 CRUD + 符合性校验） */}
        {tab === 'interfaces' && (
          <div className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-[12px] text-slate-500">接口定义属性契约；实现对象类型须提供全部契约属性，可一键校验符合性</div>
              <Btn size="sm" variant="primary" disabled={!canEdit} onClick={() => { setNewIface(EMPTY_INTERFACE); setNewIfaceOpen(true) }}><Plus size={13} /> 新建接口</Btn>
            </div>
            {ifacesQ.loading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" /> 加载接口…</div>
            ) : (ifacesQ.data?.interfaces.length ?? 0) === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-8 text-center text-sm text-slate-400">
                暂无接口定义，点击右上「新建接口」创建第一个属性契约
              </div>
            ) : (
              <div className="space-y-3">
                {ifacesQ.data?.interfaces.map((iface) => {
                  const results = checkResults[iface.id]
                  return (
                    <div key={iface.id} className="rounded-xl border border-slate-200 p-3.5">
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <Layers size={14} className="shrink-0 text-brand-600" />
                            <span className="text-[14px] font-bold text-slate-800">{iface.name}</span>
                            <Badge color="blue">{iface.propCount} 项契约属性</Badge>
                            {iface.implementedNames.length > 0
                              ? <Badge color="violet">{iface.implementedNames.length} 个实现类型</Badge>
                              : <Badge color="slate">未绑定实现</Badge>}
                          </div>
                          {iface.desc && <div className="mt-0.5 text-[11px] text-slate-400">{iface.desc} · 更新于 {iface.updatedAt}</div>}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Btn size="sm" onClick={() => checkInterface(iface.id)}><Check size={12} /> 校验符合性</Btn>
                          {canEdit && (
                            <>
                              <button
                                onClick={() => {
                                  setNewIface({
                                    id: iface.id, name: iface.name, desc: iface.desc,
                                    properties: iface.properties.length ? iface.properties : [{ key: '', name: '', type: 'string' }],
                                    implementedBy: iface.implementedBy,
                                  })
                                  setNewIfaceOpen(true)
                                }}
                                className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-brand-600"
                                title="编辑接口"
                              ><Pencil size={13} /></button>
                              {confirmDel === iface.id ? (
                                <>
                                  <button onClick={() => remove('/ontology/interfaces', iface.id, `接口 ${iface.name}`)} className="rounded bg-red-500 px-1.5 py-0.5 text-[10px] text-white">确认</button>
                                  <button onClick={() => setConfirmDel(null)} className="text-[10px] text-slate-400">取消</button>
                                </>
                              ) : (
                                <button onClick={() => setConfirmDel(iface.id)} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 hover:text-red-500" title="删除接口"><Trash2 size={13} /></button>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      {/* 契约属性 */}
                      <div className="flex flex-wrap gap-1.5">
                        {iface.properties.map((p) => (
                          <span key={p.key} className="rounded-md border border-slate-100 bg-slate-50 px-2 py-1 text-[11px] text-slate-600">
                            <span className="font-mono text-brand-700">{p.key}</span> · {p.name}
                            <span className="ml-1 text-slate-400">{p.type}{p.required ? ' · 必填' : ''}</span>
                          </span>
                        ))}
                      </div>
                      {/* 实现类型 */}
                      <div className="mt-2 text-[11px] text-slate-500">
                        实现对象：<span className="text-slate-700">{iface.implementedNames.length ? iface.implementedNames.join('、') : '（未绑定）'}</span>
                      </div>
                      {/* 校验结果：按每个实现类型的 ok 判定，而非结果数组长度 */}
                      {results !== undefined && (
                        <div className={cn('mt-2.5 rounded-lg border p-2.5', results.every((r) => r.ok) ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50')}>
                          {results.length === 0 ? (
                            <div className="text-[12px] text-slate-500">该接口尚未绑定实现对象</div>
                          ) : results.map((r) => (
                            <div key={r.typeId} className={cn('text-[12px]', r.ok ? 'text-emerald-700' : 'text-red-700')}>
                              {r.ok ? '✓' : '✗'} {r.typeName}{r.ok ? ' 满足契约' : <> 缺少：{r.missing.map((m) => <code key={m} className="mx-0.5 rounded bg-white/70 px-1 font-mono">{m}</code>)}</>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* 业务术语 / 认证指标（语义层：借鉴 NVIDIA auto-ontology） */}
        {tab === 'terms' && (
          <div className="p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-[12px] text-slate-500">
                把业务口语/同义词映射到确定的本体属性或指标口径；<b>认证后</b> 智能助手与 Agent 才会按此口径回答，数据类问题无覆盖时明确拒答而非猜测
              </div>
              <Btn size="sm" variant="primary" disabled={!canEdit} onClick={() => { setNewTerm(EMPTY_TERM); setNewTermOpen(true) }}><Plus size={13} /> 新建术语</Btn>
            </div>
            {/* 解析预检 */}
            <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-slate-100 bg-slate-50/60 p-3">
              <Field label="术语解析预检" hint="输入一句自然语言，看命中了哪些已认证术语/是否可回答">
                <Input value={termProbe} onChange={(e) => setTermProbe(e.target.value)} placeholder="如：这个月营收有多少？" className="w-72" />
              </Field>
              <Btn size="sm" onClick={probeTerm}><Search size={13} /> 解析</Btn>
              {termProbeResult && (
                <span className={cn('text-[12px]', termProbeResult.answerable ? 'text-emerald-700' : 'text-amber-700')}>
                  {termProbeResult.total === 0
                    ? `尚无已认证术语（不启用拦截）`
                    : termProbeResult.answerable
                      ? `✓ 命中：${termProbeResult.hits.join('、')}（共 ${termProbeResult.total} 个认证术语）`
                      : '✗ 该问题无术语覆盖，助手将明确拒答'}
                </span>
              )}
            </div>
            {termsQ.loading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" /> 加载术语…</div>
            ) : (termsQ.data?.terms.length ?? 0) === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-8 text-center text-sm text-slate-400">
                暂无业务术语，点击「新建术语」登记第一个可信口径（如「营收 → 销售订单.amount 合计」）
              </div>
            ) : (
              <DataTable
                rows={termsQ.data?.terms ?? []}
                rowKey={(t) => t.id}
                columns={[
                  { key: 'term', header: '术语', cell: (t) => <span className="font-semibold text-slate-800">{t.term}</span> },
                  { key: 'synonyms', header: '同义词 / 口语问法', cell: (t) => <span className="flex flex-wrap gap-1">{t.synonyms.map((s) => <Badge key={s} color="slate">{s}</Badge>)}</span> },
                  { key: 'typeName', header: '映射类型 / 属性', cell: (t) => <span className="text-xs text-slate-600">{t.typeName}{t.propertyKey ? `.${t.propertyKey}` : ''}</span> },
                  { key: 'metricExpr', header: '指标口径', cell: (t) => <code className="text-[11px] text-slate-500">{t.metricExpr || '—'}</code> },
                  { key: 'certified', header: '状态', cell: (t) => <Badge color={t.certified ? 'green' : 'amber'} dot>{t.certified ? '已认证' : '草稿'}</Badge> },
                  { key: 'op', header: '操作', align: 'right', cell: (t) => (
                    <span className="flex items-center justify-end gap-2">
                      {canEdit && <button onClick={() => certifyTerm(t)} className="text-[11px] text-brand-600 hover:underline">{t.certified ? '撤销认证' : '认证'}</button>}
                      {canEdit && <button onClick={() => { setNewTerm({ id: t.id, term: t.term, synonyms: t.synonyms.join('、'), typeId: t.typeId, propertyKey: t.propertyKey, definition: t.definition, metricExpr: t.metricExpr, certified: t.certified }); setNewTermOpen(true) }} className="text-slate-400 hover:text-brand-600"><Pencil size={13} /></button>}
                      {canEdit && (confirmDel === t.id ? (
                        <>
                          <button onClick={() => remove('/ontology/terms', t.id, `术语 ${t.term}`)} className="rounded bg-red-500 px-1.5 py-0.5 text-[10px] text-white">确认</button>
                          <button onClick={() => setConfirmDel(null)} className="text-[10px] text-slate-400">取消</button>
                        </>
                      ) : (
                        <button onClick={() => setConfirmDel(t.id)} className="text-slate-300 hover:text-red-500"><Trash2 size={13} /></button>
                      ))}
                    </span>
                  ) },
                ]}
              />
            )}
          </div>
        )}
      </Card>

      {/* 导入本体弹层（文档智能识别 / JSON） */}
      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        existingTypeNames={types.map((t) => t.name)}
        onCommitted={() => { typesQ.reload(); linksQ.reload() }}
      />

      {/* 新建对象类型弹层 */}
      {newTypeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={() => setNewTypeOpen(false)}>
          <div className="max-h-[88vh] w-[680px] max-w-[94vw] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div className="text-base font-bold text-slate-900">新建对象类型</div>
              <button onClick={() => setNewTypeOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={16} /></button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="类型名称" required><Input value={newType.name} onChange={(e) => setNewType({ ...newType, name: e.target.value })} placeholder="如 模具批次" /></Field>
              <Field label="API 标识" hint="留空按名称生成"><Input value={newType.apiName} onChange={(e) => setNewType({ ...newType, apiName: e.target.value })} placeholder="moldBatch" /></Field>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
              <Field label="描述"><Input value={newType.desc} onChange={(e) => setNewType({ ...newType, desc: e.target.value })} placeholder="一句话说明该业务实体" /></Field>
              <Field label="展示颜色">
                <div className="flex gap-1.5 pt-1">
                  {COLORS.map((c) => (
                    <button key={c} onClick={() => setNewType({ ...newType, color: c })} className={cn('h-6 w-6 rounded-full', newType.color === c && 'ring-2 ring-slate-400 ring-offset-2')} style={{ background: c }} />
                  ))}
                </div>
              </Field>
            </div>
            <div className="mt-4">
              <CardHeader title="属性定义" desc="第一个属性将作为主键与标题字段" />
              <PropertyEditor props={newType.properties} onChange={(p) => setNewType({ ...newType, properties: p })} />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Btn onClick={() => setNewTypeOpen(false)}>取消</Btn>
              <Btn variant="primary" disabled={busy} onClick={createType}>{busy ? '创建中…' : '创建类型'}</Btn>
            </div>
          </div>
        </div>
      )}

      {/* 新建链接类型弹层 */}
      {newLinkOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={() => setNewLinkOpen(false)}>
          <div className="w-[460px] max-w-[92vw] rounded-2xl border border-slate-200 bg-white p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 text-base font-bold text-slate-900">新建链接类型</div>
            <div className="space-y-3.5">
              <Field label="名称" required><Input value={newLink.name} onChange={(e) => setNewLink({ ...newLink, name: e.target.value })} placeholder="如 批次使用模具" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="源对象类型" required>
                  <Select className="w-full" value={newLink.sourceTypeId} onChange={(e) => setNewLink({ ...newLink, sourceTypeId: e.target.value })}>
                    <option value="">选择…</option>
                    {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </Select>
                </Field>
                <Field label="目标对象类型" required>
                  <Select className="w-full" value={newLink.targetTypeId} onChange={(e) => setNewLink({ ...newLink, targetTypeId: e.target.value })}>
                    <option value="">选择…</option>
                    {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </Select>
                </Field>
              </div>
              <Field label="基数">
                <Select className="w-full" value={newLink.cardinality} onChange={(e) => setNewLink({ ...newLink, cardinality: e.target.value })}>
                  {CARDINALITIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </Field>
              <Field label="说明"><Input value={newLink.desc} onChange={(e) => setNewLink({ ...newLink, desc: e.target.value })} /></Field>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Btn onClick={() => setNewLinkOpen(false)}>取消</Btn>
              <Btn variant="primary" disabled={busy} onClick={createLink}>{busy ? '创建中…' : '创建'}</Btn>
            </div>
          </div>
        </div>
      )}

      {/* 新建动作类型弹层 */}
      {newActionOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={() => setNewActionOpen(false)}>
          <div className="w-[460px] max-w-[92vw] rounded-2xl border border-slate-200 bg-white p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 text-base font-bold text-slate-900">新建动作类型</div>
            <div className="space-y-3.5">
              <Field label="名称" required><Input value={newAction.name} onChange={(e) => setNewAction({ ...newAction, name: e.target.value })} placeholder="如 调整健康阈值" /></Field>
              <Field label="目标对象类型" required>
                <Select className="w-full" value={newAction.targetTypeId} onChange={(e) => setNewAction({ ...newAction, targetTypeId: e.target.value })}>
                  <option value="">选择…</option>
                  {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
              </Field>
              <Field label="执行策略" hint="需审批的动作在执行前进入审批中心（P4 生效）">
                <div className="flex gap-2">
                  {([[false, '直接执行'], [true, '需审批']] as const).map(([v, label]) => (
                    <button key={String(v)} onClick={() => setNewAction({ ...newAction, needsApproval: v })}
                      className={cn('flex-1 rounded-lg border px-3 py-2 text-[13px] font-medium', newAction.needsApproval === v ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-500')}>
                      {label}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="说明"><Input value={newAction.desc} onChange={(e) => setNewAction({ ...newAction, desc: e.target.value })} placeholder="动作的执行效果描述" /></Field>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Btn onClick={() => setNewActionOpen(false)}>取消</Btn>
              <Btn variant="primary" disabled={busy} onClick={createAction}>{busy ? '创建中…' : '创建'}</Btn>
            </div>
          </div>
        </div>
      )}

      {/* 新建函数弹层 */}
      {newFnOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={() => setNewFnOpen(false)}>
          <div className="max-h-[88vh] w-[520px] max-w-[94vw] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div className="text-base font-bold text-slate-900">新建函数</div>
              <button onClick={() => setNewFnOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={16} /></button>
            </div>
            <div className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <Field label="函数名" required hint="按名称生成唯一标识"><Input value={newFn.name} onChange={(e) => setNewFn({ ...newFn, name: e.target.value })} placeholder="如 computeOee" /></Field>
                <Field label="语言">
                  <Select className="w-full" value={newFn.lang} onChange={(e) => setNewFn({ ...newFn, lang: e.target.value })}>
                    {FN_LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
                  </Select>
                </Field>
              </div>
              <Field label="说明"><Input value={newFn.desc} onChange={(e) => setNewFn({ ...newFn, desc: e.target.value })} placeholder="一句话说明函数用途" /></Field>
              <Field label="关联对象类型" hint="可多选，用于标注函数作用的对象类型">
                <div className="flex flex-wrap gap-1.5 rounded-lg border border-slate-200 p-2">
                  {types.length === 0 && <span className="text-[11px] text-slate-400">当前空间暂无对象类型</span>}
                  {types.map((t) => {
                    const checked = newFn.linkedTypeIds.includes(t.id)
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setNewFn({ ...newFn, linkedTypeIds: checked ? newFn.linkedTypeIds.filter((id) => id !== t.id) : [...newFn.linkedTypeIds, t.id] })}
                        className={cn('inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium', checked ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-500')}
                      >
                        <span className="h-2 w-2 rounded-full" style={{ background: t.color }} />{t.name}
                      </button>
                    )
                  })}
                </div>
              </Field>
              <Field label="初始代码（可选）" hint="填写 function main(input) {…} 会顺带创建 v1 草稿版本；留空仅登记函数，稍后可用「新建版本」编写">
                <textarea
                  value={newFn.body}
                  onChange={(e) => setNewFn({ ...newFn, body: e.target.value })}
                  rows={4}
                  className="w-full resize-none rounded-lg border border-slate-200 p-3 font-mono text-xs focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                  placeholder={FN_TEMPLATE}
                />
              </Field>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Btn onClick={() => setNewFnOpen(false)}>取消</Btn>
              <Btn variant="primary" disabled={busy} onClick={createFunction}>{busy ? '创建中…' : '创建函数'}</Btn>
            </div>
          </div>
        </div>
      )}

      {/* 编辑代码 / 新建版本弹层（保存即生成新草稿版本并自动测试） */}
      {editorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={() => setEditorOpen(false)}>
          <div className="max-h-[88vh] w-[680px] max-w-[94vw] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div className="text-base font-bold text-slate-900">编辑代码 · 新建草稿版本</div>
              <button onClick={() => setEditorOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={16} /></button>
            </div>
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
              约定函数体 <code className="font-mono">function main(input) {'{ … return … }'}</code>；在服务端 node:vm 沙箱执行，仅可用 input / Math / JSON / Date / String / Number / Array / Object，禁用 require / process / global / fetch / eval / Function，单次超时 2 秒。保存后将生成新版本并自动跑一次测试。
            </div>
            <Field label="函数代码（JavaScript）">
              <textarea
                value={editorCode}
                onChange={(e) => setEditorCode(e.target.value)}
                rows={12}
                spellCheck={false}
                className="w-full resize-y rounded-lg border border-slate-200 bg-slate-900 p-3 font-mono text-xs leading-relaxed text-slate-100 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                placeholder={FN_TEMPLATE}
              />
            </Field>
            <div className="mt-3">
              <Field label="自动测试输入（JSON）" hint="新建版本时自动执行一次，结果写入该版本 testOutput">
                <textarea
                  value={editorTestInput}
                  onChange={(e) => setEditorTestInput(e.target.value)}
                  rows={3}
                  spellCheck={false}
                  className="w-full resize-y rounded-lg border border-slate-200 p-3 font-mono text-xs focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                  placeholder='{"k": 2}'
                />
              </Field>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Btn onClick={() => setEditorOpen(false)}>取消</Btn>
              <Btn variant="primary" disabled={fnBusy === 'saveVersion'} onClick={saveNewVersion}>
                {fnBusy === 'saveVersion' ? <><Loader2 size={13} className="animate-spin" /> 保存并测试中…</> : '保存为新版本'}
              </Btn>
            </div>
          </div>
        </div>
      )}

      {/* 测试运行弹层（输入 JSON，显示结果 / 耗时 / 错误） */}
      {testOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={() => setTestOpen(false)}>
          <div className="max-h-[88vh] w-[600px] max-w-[94vw] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div className="text-base font-bold text-slate-900">测试运行</div>
              <button onClick={() => setTestOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={16} /></button>
            </div>
            <div className="mb-3 text-[11px] text-slate-500">
              {testVersionId
                ? '将真实执行所选版本代码，并把结果回写到该版本的 testOutput'
                : '将真实执行该函数「已发布」版本（尚无已发布版本时请先在版本列表中指定版本测试）'}
            </div>
            <Field label="输入 input（JSON）">
              <textarea
                value={testInput}
                onChange={(e) => setTestInput(e.target.value)}
                rows={5}
                spellCheck={false}
                className="w-full resize-y rounded-lg border border-slate-200 p-3 font-mono text-xs focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                placeholder='{"k": 2}'
              />
            </Field>
            {testResult && (
              <div className={cn('mt-3 rounded-lg border p-3', testResult.ok ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50')}>
                <div className="mb-1.5 flex items-center gap-2 text-[12px] font-semibold">
                  <Badge color={testResult.ok ? 'green' : 'red'}>{testResult.ok ? '执行成功' : '执行失败'}</Badge>
                  <span className="text-slate-500">耗时 {testResult.durationMs} ms</span>
                  {testResult.version != null && <span className="text-slate-500">v{testResult.version}</span>}
                </div>
                {testResult.ok ? (
                  <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all rounded bg-white/70 p-2 font-mono text-[11px] text-slate-700">{JSON.stringify(testResult.result, null, 2)}</pre>
                ) : (
                  <pre className="whitespace-pre-wrap break-all rounded bg-white/70 p-2 font-mono text-[11px] text-red-700">{testResult.error}</pre>
                )}
              </div>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <Btn onClick={() => setTestOpen(false)}>关闭</Btn>
              <Btn variant="primary" disabled={fnBusy === 'runTest'} onClick={runTest}>
                {fnBusy === 'runTest' ? <><Loader2 size={13} className="animate-spin" /> 执行中…</> : <><Play size={13} /> 运行</>}
              </Btn>
            </div>
          </div>
        </div>
      )}

      {/* 新建/编辑接口弹层 */}
      {newIfaceOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={() => setNewIfaceOpen(false)}>
          <div className="max-h-[88vh] w-[600px] max-w-[94vw] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div className="text-base font-bold text-slate-900">{newIface.id ? '编辑接口' : '新建接口'}</div>
              <button onClick={() => setNewIfaceOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={16} /></button>
            </div>
            <div className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <Field label="接口名称" required><Input value={newIface.name} onChange={(e) => setNewIface({ ...newIface, name: e.target.value })} placeholder="如 可监控资产" /></Field>
                <Field label="说明"><Input value={newIface.desc} onChange={(e) => setNewIface({ ...newIface, desc: e.target.value })} placeholder="一句话说明接口契约" /></Field>
              </div>
              <Field label="契约属性" hint="实现该接口的对象类型必须具备这些属性；key 与对象类型属性 key 一致">
                <div className="space-y-1.5">
                  {newIface.properties.map((p, i) => (
                    <div key={i} className="grid grid-cols-[1.2fr_1fr_0.8fr_60px_28px] items-center gap-1.5">
                      <Input className="py-1 text-xs" value={p.name} onChange={(e) => setNewIface({ ...newIface, properties: newIface.properties.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })} placeholder="属性名，如 健康度" />
                      <Input className="py-1 font-mono text-xs" value={p.key} onChange={(e) => setNewIface({ ...newIface, properties: newIface.properties.map((x, j) => j === i ? { ...x, key: e.target.value.replace(/[^\w]/g, '') } : x) })} placeholder="health" />
                      <Select className="py-1 text-xs" value={p.type} onChange={(e) => setNewIface({ ...newIface, properties: newIface.properties.map((x, j) => j === i ? { ...x, type: e.target.value } : x) })}>
                        {PROP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </Select>
                      <button
                        type="button"
                        onClick={() => setNewIface({ ...newIface, properties: newIface.properties.map((x, j) => j === i ? { ...x, required: !x.required } : x) })}
                        className={cn('flex h-7 items-center justify-center gap-0.5 rounded border text-[10px]', p.required ? 'border-red-200 bg-red-50 text-red-600' : 'border-slate-200 text-slate-400')}
                      >{p.required ? <Check size={11} /> : null}必填</button>
                      <button onClick={() => setNewIface({ ...newIface, properties: newIface.properties.filter((_, j) => j !== i) })} className="text-slate-300 hover:text-red-500" title="删除属性行"><Trash2 size={13} /></button>
                    </div>
                  ))}
                  <button onClick={() => setNewIface({ ...newIface, properties: [...newIface.properties, { key: '', name: '', type: 'string' }] })} className="text-[11px] text-brand-600 hover:underline">+ 添加契约属性</button>
                </div>
              </Field>
              <Field label="实现对象类型" hint="可多选；保存后可一键校验这些类型是否真的具备契约属性">
                <div className="flex flex-wrap gap-1.5 rounded-lg border border-slate-200 p-2">
                  {types.length === 0 && <span className="text-[11px] text-slate-400">当前空间暂无对象类型</span>}
                  {types.map((t) => {
                    const checked = newIface.implementedBy.includes(t.id)
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setNewIface({ ...newIface, implementedBy: checked ? newIface.implementedBy.filter((id) => id !== t.id) : [...newIface.implementedBy, t.id] })}
                        className={cn('inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium', checked ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-500')}
                      >
                        <span className="h-2 w-2 rounded-full" style={{ background: t.color }} />{t.name}
                      </button>
                    )
                  })}
                </div>
              </Field>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Btn onClick={() => setNewIfaceOpen(false)}>取消</Btn>
              <Btn variant="primary" disabled={busy} onClick={saveInterface}>{busy ? '保存中…' : newIface.id ? '保存修改' : '创建接口'}</Btn>
            </div>
          </div>
        </div>
      )}

      {/* 新建/编辑业务术语弹层 */}
      {newTermOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={() => setNewTermOpen(false)}>
          <div className="max-h-[88vh] w-[560px] max-w-[94vw] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div className="text-base font-bold text-slate-900">{newTerm.id ? '编辑业务术语' : '新建业务术语'}</div>
              <button onClick={() => setNewTermOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={16} /></button>
            </div>
            <div className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <Field label="术语名称" required hint="如 营收 / 设备可用率"><Input value={newTerm.term} onChange={(e) => setNewTerm({ ...newTerm, term: e.target.value })} placeholder="营收" /></Field>
                <Field label="同义词 / 口语问法" hint="顿号或逗号分隔"><Input value={newTerm.synonyms} onChange={(e) => setNewTerm({ ...newTerm, synonyms: e.target.value })} placeholder="销售额、收入额" /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="映射对象类型" hint="可留空表示跨类型指标">
                  <select value={newTerm.typeId} onChange={(e) => setNewTerm({ ...newTerm, typeId: e.target.value, propertyKey: '' })} className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[13px] text-slate-700 focus:border-brand-400 focus:outline-none">
                    <option value="">不绑定（跨类型）</option>
                    {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </Field>
                <Field label="映射属性" hint="选定类型后可选其属性">
                  <select value={newTerm.propertyKey} onChange={(e) => setNewTerm({ ...newTerm, propertyKey: e.target.value })} disabled={!newTerm.typeId} className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[13px] text-slate-700 focus:border-brand-400 focus:outline-none disabled:opacity-50">
                    <option value="">不映射（用指标口径）</option>
                    {(types.find((t) => t.id === newTerm.typeId)?.properties ?? []).map((p) => <option key={p.key} value={p.key}>{p.name}({p.key})</option>)}
                  </select>
                </Field>
              </div>
              <Field label="指标口径表达式" hint="人可读即可，如 SUM(销售订单.amount)；认证后助手按此口径回答">
                <Input value={newTerm.metricExpr} onChange={(e) => setNewTerm({ ...newTerm, metricExpr: e.target.value })} placeholder="SUM(order.amount) · 仅统计已付款订单" />
              </Field>
              <Field label="定义说明"><Input value={newTerm.definition} onChange={(e) => setNewTerm({ ...newTerm, definition: e.target.value })} placeholder="一句话说明业务含义与统计范围" /></Field>
              <label className="flex items-center gap-2 rounded-lg border border-slate-200 p-2.5 text-[12px] text-slate-600">
                <input type="checkbox" checked={newTerm.certified} onChange={(e) => setNewTerm({ ...newTerm, certified: e.target.checked })} className="h-4 w-4" />
                立即认证（认证后 智能助手 / Agent 才会将其作为可信口径引用）
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Btn onClick={() => setNewTermOpen(false)}>取消</Btn>
              <Btn variant="primary" disabled={busy} onClick={saveTerm}>{busy ? '保存中…' : newTerm.id ? '保存修改' : '创建术语'}</Btn>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}
