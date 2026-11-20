import { useState } from 'react'
import { Cable, Database, Server, Cloud, Radio, Globe, Plug, Workflow, RefreshCw, Plus, Loader2, X, Trash2, HardDrive, FileText } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import PageShell from '@/components/ui/PageShell'
import StatCard from '@/components/ui/StatCard'
import Btn from '@/components/ui/Btn'
import { Badge, type BadgeColor } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import { Input, Select, Field } from '@/components/ui/Form'
import { KVList } from '@/components/ui/Misc'
import { api } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'

/* ---------------- 类型 ---------------- */

interface Connection {
  id: string
  name: string
  type: string
  host: string
  port: string
  database: string
  status: string
  lastSyncAt: string
  tableCount: number
  ownerId: string
}
interface ConnResp {
  connections: Connection[]
  stats: { total: number; active: number; syncing: number; warning: number; tables: number }
}
interface ConnForm {
  name: string
  type: string
  host: string
  port: string
  database: string
}

const EXTERNAL_DB = 'demo-data/external/enterprise.db'
const FILE_DIR = 'demo-data/files/'
const FILE_CSV = `${FILE_DIR}expenses.csv`
const FILE_JSON = `${FILE_DIR}devices.json`
const FILE_TXT = `${FILE_DIR}sop.txt`
const FILE_MD = `${FILE_DIR}expense-note.md`
const FILE_DEFAULT: Record<string, string> = { CSV: FILE_CSV, JSON: FILE_JSON, TXT: FILE_TXT, MD: FILE_MD }
const FILE_TYPES = ['CSV', 'JSON', 'TXT', 'MD']
const EMPTY_FORM: ConnForm = { name: '外部企业库（演示）', type: 'SQLite', host: '', port: '', database: EXTERNAL_DB }
const TYPE_OPTIONS = ['SQLite', 'CSV', 'JSON', 'TXT', 'MD', 'MySQL', 'PostgreSQL', 'Oracle', 'SQL Server', 'Kafka', 'S3', 'REST API', 'SAP RFC']
const STATUS_OPTIONS = ['正常', '同步中', '告警', '停用']
const STATUS_COLOR: Record<string, BadgeColor> = { 正常: 'green', 同步中: 'blue', 告警: 'amber', 停用: 'slate' }

const WIZARD_STEPS = [
  { name: '选择来源类型', desc: '名称与数据源类型' },
  { name: '配置连接', desc: '主机 / 端口 / 数据库' },
  { name: '确认信息', desc: '核对登记内容' },
  { name: '提交发布', desc: '写入连接登记表' },
]

/** 依据真实 type 选择图标（无写死连接器清单） */
function iconFor(type: string): { icon: LucideIcon; iconClass: string } {
  const t = type.toLowerCase()
  if (['csv', 'json', 'txt', 'md'].includes(t)) return { icon: FileText, iconClass: 'bg-amber-50 text-amber-600' }
  if (t.includes('mysql') || t.includes('postgres') || t.includes('oracle') || t.includes('sql')) return { icon: Database, iconClass: 'bg-brand-50 text-brand-600' }
  if (t.includes('kafka') || t.includes('mq') || t.includes('stream') || t.includes('流')) return { icon: Radio, iconClass: 'bg-violet-50 text-violet-600' }
  if (t.includes('s3') || t.includes('oss') || t.includes('lake') || t.includes('湖') || t.includes('文件')) return { icon: Cloud, iconClass: 'bg-sky-50 text-sky-600' }
  if (t.includes('rest') || t.includes('api') || t.includes('http')) return { icon: Globe, iconClass: 'bg-rose-50 text-rose-500' }
  if (t.includes('sap') || t.includes('rfc')) return { icon: Plug, iconClass: 'bg-slate-100 text-slate-600' }
  return { icon: Server, iconClass: 'bg-emerald-50 text-emerald-600' }
}

function statusColor(s: string): BadgeColor { return STATUS_COLOR[s] ?? 'slate' }

/** 数据连接：管理外部系统到平台的数据通道 */
export default function Connections() {
  const connQ = useApi<ConnResp>('/data-layer/connections')
  const connections = connQ.data?.connections ?? []
  const stats = connQ.data?.stats

  const [toast, setToast] = useState<{ msg: string; err: boolean } | null>(null)
  const notify = (msg: string, err = false) => { setToast({ msg, err }); setTimeout(() => setToast(null), 2800) }

  /* 卡片展开详情 */
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null)
  const [healthBusy, setHealthBusy] = useState(false)
  const expanded = connections.find((c) => c.id === expandedId) ?? null
  const isFileType = !!expanded && FILE_TYPES.includes(expanded.type)

  /* 外部数据源：真实探测 / 表清单 / 表预览 / 同步为对象（SQLite 与文件型共用展示状态） */
  const [tables, setTables] = useState<string[]>([])
  const [preview, setPreview] = useState<{ columns: { name: string; type: string }[]; rows: Record<string, unknown>[]; total: number } | null>(null)
  const [syncTable, setSyncTable] = useState('')
  const [syncTypeId, setSyncTypeId] = useState('')
  const [extBusy, setExtBusy] = useState(false)
  const [extFormat, setExtFormat] = useState('')
  const typesQ = useApi<{ types: { id: string; name: string }[] }>(expandedId ? '/ontology/types' : null)
  const types = typesQ.data?.types ?? []

  /** 切换展开卡片时清空上一张连接的探测/预览/同步状态 */
  function resetOps() {
    setTables([]); setPreview(null); setSyncTable(''); setSyncTypeId(''); setExtFormat('')
  }

  /* 新建连接向导（弹层） */
  const [wizardOpen, setWizardOpen] = useState(false)
  const [step, setStep] = useState(1)
  const [form, setForm] = useState<ConnForm>(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [formErr, setFormErr] = useState('')

  function openWizard() { setForm(EMPTY_FORM); setStep(1); setFormErr(''); setWizardOpen(true) }

  /** 切换来源类型时，文件型自动预填 demo-data/files/ 下的示例文件路径 */
  function changeType(type: string) {
    setForm((f) => ({
      ...f,
      type,
      database: type === 'SQLite' ? EXTERNAL_DB : (FILE_DEFAULT[type] ?? ''),
    }))
  }

  function next() {
    if (step === 1 && (!form.name.trim() || !form.type)) { setFormErr('请填写连接名称与来源类型'); return }
    if (step === 1 && FILE_TYPES.includes(form.type) && !form.database) {
      setForm((f) => ({ ...f, database: FILE_DEFAULT[f.type] ?? '' }))
    }
    setFormErr('')
    setStep((s) => Math.min(4, s + 1))
  }
  function back() { setFormErr(''); setStep((s) => Math.max(1, s - 1)) }

  async function submitWizard() {
    setBusy(true); setFormErr('')
    try {
      await api<{ id: string }>('/data-layer/connections', {
        method: 'POST',
        body: { name: form.name.trim(), type: form.type, host: form.host, port: form.port, database: form.database },
      })
      setWizardOpen(false)
      connQ.reload()
      notify(`数据连接「${form.name.trim()}」已创建`)
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : '创建失败')
    } finally {
      setBusy(false)
    }
  }

  async function changeStatus(id: string, status: string) {
    try {
      await api(`/data-layer/connections/${id}`, { method: 'PATCH', body: { status } })
      connQ.reload()
      notify('连接状态已更新')
    } catch (e) {
      notify(e instanceof Error ? e.message : '状态更新失败', true)
    }
  }

  async function remove(id: string) {
    try {
      await api(`/data-layer/connections/${id}`, { method: 'DELETE' })
      if (expandedId === id) setExpandedId(null)
      setConfirmDelId(null)
      connQ.reload()
      notify('数据连接已删除')
    } catch (e) {
      notify(e instanceof Error ? e.message : '删除失败', true)
    }
  }

  /** 全量健康检查：逐条真实打开外部库探测表数/状态（不再只刷时间戳） */
  async function healthCheck() {
    if (connections.length === 0) { notify('暂无连接可检查', true); return }
    setHealthBusy(true)
    try {
      let ok = 0, fail = 0
      await Promise.all(connections.map(async (c) => {
        const ep = FILE_TYPES.includes(c.type) ? 'test-file' : 'test'
        try { await api(`/data-layer/connections/${c.id}/${ep}`, { method: 'POST' }); ok++ } catch { fail++ }
      }))
      connQ.reload()
      notify(`探测完成：${ok} 条可达${fail ? ` · ${fail} 条告警` : ''}（表数/状态/时间已按真实结果回写）`)
    } finally { setHealthBusy(false) }
  }

  /** 单条连接：真实探测 + 拉表清单（SQLite 走 /test，文件型走 /test-file） */
  async function testConn(id: string) {
    setExtBusy(true)
    try {
      const file = isFileType
      const r = await api<{ tables: string[]; tableCount: number; format?: string }>(
        `/data-layer/connections/${id}/${file ? 'test-file' : 'test'}`, { method: 'POST' })
      setTables(r.tables ?? [])
      setSyncTable((prev) => prev || (r.tables?.[0] ?? ''))
      if (file) setExtFormat(r.format ?? '')
      notify(file
        ? `解析成功：${r.format ?? '文件'} · 发现 ${r.tableCount} 张表`
        : `连通成功：发现 ${r.tableCount} 张表`)
      connQ.reload()
    } catch (e) { notify(e instanceof Error ? e.message : '探测失败', true) }
    finally { setExtBusy(false) }
  }

  /** 文件型：单独拉取多表清单（JSON 里多个数组键 → 多张表） */
  async function loadFileTables(id: string) {
    setExtBusy(true)
    try {
      const r = await api<{ tables: string[]; format?: string }>(`/data-layer/connections/${id}/file-tables`)
      setTables(r.tables ?? [])
      setSyncTable((prev) => prev || (r.tables?.[0] ?? ''))
      if (r.format) setExtFormat(r.format)
      notify(`表清单：${r.format ?? '文件'} · ${r.tables?.length ?? 0} 张表`)
    } catch (e) { notify(e instanceof Error ? e.message : '读取表清单失败', true) }
    finally { setExtBusy(false) }
  }

  /** 表预览（SQLite 走 /tables/:table/preview，文件型走 /file-preview?table=） */
  async function previewTable(id: string, table: string) {
    if (!table) return
    setExtBusy(true)
    try {
      type PreviewResp = { columns: { name: string; type: string }[]; rows: Record<string, unknown>[]; total: number; format?: string }
      const r: PreviewResp = isFileType
        ? await api<PreviewResp>(`/data-layer/connections/${id}/file-preview?table=${encodeURIComponent(table)}`)
        : await api<PreviewResp>(`/data-layer/connections/${id}/tables/${encodeURIComponent(table)}/preview`)
      setPreview(r)
      if (r.format) setExtFormat(r.format)
    } catch (e) { notify(e instanceof Error ? e.message : '预览失败', true) }
    finally { setExtBusy(false) }
  }

  /** 同步外部表 → 本体对象（SQLite 走 /sync，文件型走 /sync-file） */
  async function syncTableToObjects(id: string) {
    if (!syncTable || !syncTypeId) { notify('请选择外部表与目标对象类型', true); return }
    setExtBusy(true)
    try {
      const r = await api<{ created: number; skipped: number }>(`/data-layer/connections/${id}/${isFileType ? 'sync-file' : 'sync'}`, {
        method: 'POST', body: { table: syncTable, typeId: syncTypeId },
      })
      notify(`同步完成：新增 ${r.created} 个对象，跳过 ${r.skipped} 行（重复/必填缺失）`)
      connQ.reload()
    } catch (e) { notify(e instanceof Error ? e.message : '同步失败', true) }
    finally { setExtBusy(false) }
  }

  return (
    <PageShell
      icon={Cable}
      title="数据连接"
      subtitle="接入 SQLite 外部库与 CSV/JSON/TXT/MD 文件型数据源：真实解析、预览表数据、一键同步为本体对象"
      benchmark="数据集成"
      features={[
        'SQLite 数据源：demo-data/external/ 下的真实库（4 张表 / 120 行），与主库完全独立',
        '文件型数据源：demo-data/files/ 下的 CSV/JSON/TXT/MD，路径白名单限定、源文件只读；JSON 多个数组键列为多张表',
        '真实探测：SQLite 读 sqlite_master 表数，文件型读文件头判格式并解析表头/结构，回写状态/表数/同步时间',
        '表预览：真实列名 + 类型 + 最多 20 行样本数据，只读消费',
        '同步为对象：表行按同名属性映射到本体对象类型，数字/enum 自动归一，幂等写入并留审计；数据集页随即看到行数变化',
        '向导式建连：选择来源 → 填写库/文件路径（CSV/JSON 自动预填示例文件）→ 确认 → 提交；其它类型仍仅登记（诚实标注）',
      ]}
      actions={
        <>
          <Btn size="sm" disabled={healthBusy || connQ.loading} onClick={healthCheck}>
            {healthBusy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} 全量健康检查
          </Btn>
          <Btn size="sm" variant="primary" onClick={openWizard}><Plus size={14} /> 新建数据连接</Btn>
        </>
      }
    >
      {toast && (
        <div className={cn('rounded-lg border px-4 py-2.5 text-sm font-medium', toast.err ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700')}>
          {toast.msg}
        </div>
      )}

      {/* 统计（真实 stats） */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="连接总数" value={stats?.total ?? 0} icon={Cable} footer={`正常 ${stats?.active ?? 0} · 同步中 ${stats?.syncing ?? 0} · 告警 ${stats?.warning ?? 0}`} />
        <StatCard label="正常运行" value={stats?.active ?? 0} icon={Workflow} iconClass="bg-emerald-50 text-emerald-600" footer="状态为「正常」的连接" />
        <StatCard label="同步中" value={stats?.syncing ?? 0} icon={RefreshCw} iconClass="bg-violet-50 text-violet-600" footer="状态为「同步中」的连接" />
        <StatCard label="数据源表" value={stats?.tables ?? 0} icon={Database} iconClass="bg-sky-50 text-sky-600" footer="各连接已编目表数量合计" />
      </div>

      {/* 连接器卡片网格 + 详情 + 向导条 */}
      <Card padding={false}>
        <div className="p-4">
          <CardHeader
            title="连接器"
            desc={`共 ${stats?.total ?? 0} 个连接；点击卡片可展开详情并切换状态 / 删除`}
            actions={<Badge color={stats?.warning ? 'amber' : 'green'} dot>{stats?.warning ? `${stats.warning} 条告警` : '全部正常'}</Badge>}
          />
          {connQ.loading ? (
            <div className="flex items-center justify-center gap-2 py-14 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" /> 加载连接数据…</div>
          ) : connQ.error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{connQ.error}</div>
          ) : connections.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 py-12 text-center text-sm text-slate-400">暂无数据连接，点击右上角「新建数据连接」开始接入</div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {connections.map((c) => {
                const { icon: Icon, iconClass } = iconFor(c.type)
                const active = expandedId === c.id
                return (
                  <button
                    key={c.id}
                    onClick={() => { setExpandedId(active ? null : c.id); setConfirmDelId(null); resetOps() }}
                    className={cn(
                      'group rounded-xl border p-3.5 text-left transition-colors',
                      active ? 'border-brand-400 bg-brand-50/40' : 'border-slate-200 hover:border-brand-300 hover:bg-brand-50/30',
                    )}
                  >
                    <div className="mb-2 flex items-start justify-between">
                      <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg', iconClass)}><Icon size={17} /></div>
                      <Badge color={statusColor(c.status)} dot>{c.status}</Badge>
                    </div>
                    <div className="text-[13.5px] font-bold text-slate-800 group-hover:text-brand-700">{c.name}</div>
                    <div className="mt-0.5 text-[11px] text-slate-400">{c.type}</div>
                    <div className="mt-2.5 space-y-1.5 border-t border-slate-100 pt-2.5 text-[11px] text-slate-500">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-400">主机 / 端点</span>
                        <code className="truncate font-mono text-[11px] text-slate-600">{[c.host, c.port].filter(Boolean).join(':') || '—'}</code>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-400">最近同步</span>
                        <span className="truncate">{c.lastSyncAt || '—'}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">同步表</span>
                        <span className="font-medium text-slate-700">{c.tableCount} 张</span>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* 展开详情：状态切换 + 删除 */}
        {expanded && (
          <div className="border-t border-slate-100 bg-slate-50/50 p-4">
            <CardHeader
              title={<span className="flex items-center gap-2"><HardDrive size={14} className="text-brand-600" />{expanded.name} · 连接详情</span>}
              desc={`ID ${expanded.id}`}
              actions={<Badge color={statusColor(expanded.status)} dot>{expanded.status}</Badge>}
            />
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-slate-100 bg-white p-3">
                <KVList
                  cols={1}
                  items={[
                    { k: '名称', v: expanded.name },
                    { k: '类型', v: expanded.type },
                    { k: '主机', v: expanded.host || '—' },
                    { k: '端口', v: expanded.port || '—' },
                    { k: '数据库', v: expanded.database || '—' },
                    { k: '最近同步', v: expanded.lastSyncAt || '—' },
                    { k: '同步表', v: `${expanded.tableCount} 张` },
                    { k: '负责人 ID', v: expanded.ownerId || '—' },
                  ]}
                />
              </div>
              <div className="space-y-3">
                <Field label="切换连接状态" hint="PATCH 写入 /data-layer/connections，立即生效">
                  <Select className="w-full" value={expanded.status} onChange={(e) => changeStatus(expanded.id, e.target.value)}>
                    {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </Select>
                </Field>
                <div className="flex items-center gap-2">
                  {confirmDelId === expanded.id ? (
                    <>
                      <span className="text-xs text-red-600">确认删除该连接？</span>
                      <Btn size="sm" variant="danger" onClick={() => remove(expanded.id)}>确认删除</Btn>
                      <Btn size="sm" variant="ghost" onClick={() => setConfirmDelId(null)}>取消</Btn>
                    </>
                  ) : (
                    <Btn size="sm" variant="danger" onClick={() => setConfirmDelId(expanded.id)}><Trash2 size={12} /> 删除连接</Btn>
                  )}
                </div>
              </div>
            </div>

            {/* 外部数据源：真实探测 / 表预览 / 同步为本体对象（SQLite 外部库 + 文件型数据源） */}
            {expanded.type === 'SQLite' || isFileType ? (
              <div className="mt-4 rounded-lg border border-brand-100 bg-white p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-700">
                    {isFileType ? <FileText size={13} className="text-amber-600" /> : <Database size={13} className="text-brand-600" />}
                    {isFileType ? `文件型数据源（${expanded.type}${extFormat ? ` · ${extFormat}` : ''}，只读解析）` : '外部数据源（真实只读消费）'}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    {isFileType && (
                      <Btn size="sm" disabled={extBusy} onClick={() => loadFileTables(expanded.id)}><Loader2 size={12} className={cn(extBusy && 'animate-spin')} /> 表清单</Btn>
                    )}
                    <Btn size="sm" disabled={extBusy} onClick={() => testConn(expanded.id)}>{extBusy ? <Loader2 size={12} className="animate-spin" /> : <Plug size={12} />} {isFileType ? '测试解析 / 读取表清单' : '测试连接 / 读取表清单'}</Btn>
                  </div>
                </div>
                {tables.length === 0 ? (
                  <div className="text-[11px] text-slate-400">
                    {isFileType
                      ? `点击「测试解析」，系统会真实读取 ${expanded.database || 'demo-data/files/ 下的文件'}，判断 CSV/JSON/TXT/MD 格式并列出表与列。`
                      : '点击右上「测试连接」，系统会真实打开该 SQLite 文件并列出表。'}
                  </div>
                ) : (
                  <>
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {tables.map((t) => (
                        <button key={t} onClick={() => { setSyncTable(t); previewTable(expanded.id, t) }}
                          className={cn('rounded-md border px-2 py-1 font-mono text-[11px]', syncTable === t ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600 hover:border-brand-200')}>{t}</button>
                      ))}
                    </div>
                    {preview && (
                      <div className="mb-2 overflow-auto rounded-lg border border-slate-100">
                        <div className="bg-slate-50 px-2 py-1 text-[10px] text-slate-500">表 {syncTable} · 共 {preview.total} 行 · 列：{preview.columns.map((c) => c.name).join(', ')}</div>
                        <table className="w-full text-[11px]">
                          <thead><tr className="border-b border-slate-100 text-left text-slate-400">{preview.columns.map((c) => <th key={c.name} className="px-2 py-1 font-medium">{c.name}</th>)}</tr></thead>
                          <tbody>{preview.rows.slice(0, 5).map((r, i) => <tr key={i} className="border-b border-slate-50">{preview.columns.map((c) => <td key={c.name} className="truncate px-2 py-1 text-slate-600">{String(r[c.name] ?? '')}</td>)}</tr>)}</tbody>
                        </table>
                      </div>
                    )}
                    <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-2">
                      <Field label={isFileType ? '文件表' : '外部表'}><Select className="w-40" value={syncTable} onChange={(e) => { setSyncTable(e.target.value); previewTable(expanded.id, e.target.value) }}>{tables.map((t) => <option key={t} value={t}>{t}</option>)}</Select></Field>
                      <Field label="同步到对象类型" hint="同名列映射到同名属性"><Select className="w-40" value={syncTypeId} onChange={(e) => setSyncTypeId(e.target.value)}><option value="">选择…</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
                      <Btn size="sm" variant="primary" disabled={extBusy || !syncTable || !syncTypeId} onClick={() => syncTableToObjects(expanded.id)}><RefreshCw size={12} /> 同步为对象</Btn>
                      <span className="text-[10px] text-slate-400">{isFileType ? '按列名↔属性 key 同名映射；数字/enum 自动归一' : '按列名↔属性 key 同名映射'}；重复同步自动跳过已存在行</span>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="mt-4 rounded-lg border border-dashed border-slate-200 px-3 py-2 text-[11px] text-slate-400">
                类型「{expanded.type}」当前仅登记连接参数；真实探测/预览/同步仅对 SQLite 外部库与 CSV/JSON/TXT/MD 文件型数据源开放。
              </div>
            )}
          </div>
        )}

        {/* 新建连接向导条（静态步骤展示 + 真实入口按钮） */}
        <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Plus size={14} className="text-brand-600" />
              <span className="text-sm font-semibold text-slate-700">新建数据连接</span>
              <span className="text-xs text-slate-400">四步向导 · 来源类型 / 连接参数 / 确认 / 提交</span>
            </div>
            <Btn size="sm" variant="primary" onClick={openWizard}>开始向导</Btn>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {WIZARD_STEPS.map((s, i) => (
              <div key={s.name} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-100 bg-white px-2.5 py-1.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-700">{i + 1}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-semibold text-slate-700">{s.name}</span>
                  <span className="block truncate text-[10.5px] text-slate-400">{s.desc}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* 新建连接向导弹层（真实表单 + 真正提交） */}
      {wizardOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={() => setWizardOpen(false)}>
          <div className="max-h-[86vh] w-[560px] max-w-[94vw] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div className="text-base font-bold text-slate-900">新建数据连接 · 第 {step} / 4 步</div>
              <button onClick={() => setWizardOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={16} /></button>
            </div>

            {/* 步骤指示器（展示用，非按钮） */}
            <div className="mb-5 flex items-center">
              {WIZARD_STEPS.map((s, i) => (
                <div key={s.name} className={cn('flex min-w-0 flex-1 items-center', i > 0 && 'ml-1.5')}>
                  <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold', i + 1 < step ? 'bg-emerald-500 text-white' : i + 1 === step ? 'bg-brand-600 text-white' : 'bg-slate-200 text-slate-500')}>
                    {i + 1 < step ? '✓' : i + 1}
                  </span>
                  <span className={cn('ml-1.5 hidden truncate text-[11px] sm:block', i + 1 === step ? 'font-semibold text-brand-700' : 'text-slate-400')}>{s.name}</span>
                  {i < 3 && <div className={cn('mx-1.5 h-0.5 flex-1 rounded', i + 1 < step ? 'bg-emerald-500' : 'bg-slate-200')} />}
                </div>
              ))}
            </div>

            {step === 1 && (
              <div className="grid gap-3.5">
                <Field label="连接名称" required>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如 ERP-MySQL 主生产库" />
                </Field>
                <Field label="来源类型" required hint="写入后端 type 字段；CSV/JSON/TXT/MD 会自动预填 demo-data/files/ 下的示例文件">
                  <Select className="w-full" value={form.type} onChange={(e) => changeType(e.target.value)}>
                    {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </Select>
                </Field>
              </div>
            )}

            {step === 2 && (
              <div className="grid gap-3.5 md:grid-cols-2">
                <Field label="主机 / 端点">
                  <Input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="10.8.1.20 或 https://…" />
                </Field>
                <Field label="端口">
                  <Input value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} placeholder="3306" />
                </Field>
                <div className="md:col-span-2">
                  <Field label="数据库 / 文件路径" hint={form.type === 'SQLite' ? 'SQLite 填相对项目根的文件路径（须在 demo-data/external/ 目录内）' : FILE_TYPES.includes(form.type) ? '文件型填相对项目根的文件路径（须在 demo-data/files/ 目录内，只读解析）' : '数据库名 / topic / bucket'}>
                    <Input value={form.database} onChange={(e) => setForm({ ...form, database: e.target.value })} placeholder={form.type === 'SQLite' ? EXTERNAL_DB : FILE_TYPES.includes(form.type) ? FILE_CSV : 'ods / topic / bucket'} />
                  </Field>
                </div>
                <div className="md:col-span-2 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-[11.5px] text-slate-500">
                  {form.type === 'SQLite'
                    ? 'SQLite 类型支持真实探测/表预览/同步为对象（创建后在详情卡片点「测试连接」）；路径限定在 demo-data/external/ 内，只读打开。'
                    : FILE_TYPES.includes(form.type)
                      ? `「${form.type}」为文件型数据源：支持真实解析表头/结构、表预览、同步为对象（创建后点「测试解析」）；路径限定在 demo-data/files/ 内，源文件只读；JSON 多个数组键会列为多张表。`
                      : '其它类型当前仅登记连接参数（名称/主机/端口/数据库），不发起真实连接；凭据与内网代理探测待后续接入。'}
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
                <KVList
                  cols={1}
                  items={[
                    { k: '连接名称', v: form.name || '—' },
                    { k: '来源类型', v: form.type },
                    { k: '主机', v: form.host || '（未填写）' },
                    { k: '端口', v: form.port || '（未填写）' },
                    { k: '数据库', v: form.database || '（未填写）' },
                    { k: '初始状态', v: <Badge color="green" dot>正常</Badge> },
                  ]}
                />
              </div>
            )}

            {step === 4 && (
              <div className="space-y-3">
                <div className="rounded-lg border border-brand-200 bg-brand-50/60 px-3.5 py-3 text-[12.5px] leading-6 text-brand-800">
                  点击「确认创建」将向 <code className="font-mono">POST /api/data-layer/connections</code> 写入「{form.name}」（{form.type}）。创建后连接立即可用，状态默认为「正常」，初始同步表数量 0。
                </div>
                <div className="text-[11.5px] text-slate-400">提交后自动刷新列表与统计卡，并写入审计留痕。</div>
              </div>
            )}

            {formErr && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{formErr}</div>}

            <div className="mt-5 flex justify-end gap-2">
              <Btn onClick={() => setWizardOpen(false)}>取消</Btn>
              {step > 1 && <Btn onClick={back}>上一步</Btn>}
              {step < 4 ? (
                <Btn variant="primary" onClick={next}>下一步</Btn>
              ) : (
                <Btn variant="primary" disabled={busy} onClick={submitWizard}>{busy ? '创建中…' : '确认创建连接'}</Btn>
              )}
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}
