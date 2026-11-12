import { useState } from 'react'
import { ScanLine, Plus, Pencil, Trash2, X, Loader2, Save, Eye, Sparkles } from 'lucide-react'
import PageShell from '@/components/ui/PageShell'
import Btn from '@/components/ui/Btn'
import { Badge } from '@/components/ui/Badge'
import { Card, CardHeader } from '@/components/ui/Card'
import { Field, Input } from '@/components/ui/Form'
import DataTable from '@/components/ui/DataTable'
import { api } from '@/lib/api'
import { useApi } from '@/lib/useApi'
import { cn } from '@/lib/utils'

interface TemplateRow {
  id: string; name: string; desc: string; kind: string; scene: string
  typeId: string; extraPrompt: string; fieldMapping: Record<string, string>
  matchKeywords: string[]; ownerId: string
}
interface TemplatesResp { templates: TemplateRow[]; auto: { templateId: string | null; name: string; reason: string } }
/** 字段映射编辑行：src = 模型输出键，dst = 本体属性 key */
interface MappingDraft { src: string; dst: string }

/** 识别模板管理（自定义提示词 / 字段映射 / 按类型绑定） */
export default function ScanTemplates() {
  const q = useApi<TemplatesResp>('/scan/templates')
  const templates = q.data?.templates ?? []
  const [toast, setToast] = useState('')
  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2800) }
  const [editing, setEditing] = useState<TemplateRow | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', desc: '', typeId: '', extraPrompt: '', matchKeywords: '' })
  /** 字段映射：模型输出键 → 本体属性 key */
  const [mapping, setMapping] = useState<MappingDraft[]>([{ src: '', dst: '' }])
  const [busy, setBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [preview, setPreview] = useState<TemplateRow | null>(null)

  const typesQ = useApi<{ targets: { id: string; name: string }[] }>('/scan/targets')
  const typeName = (id: string) => typesQ.data?.targets.find((t) => t.id === id)?.name ?? '—'

  function startEdit(t: TemplateRow | null) {
    if (t) {
      setForm({ name: t.name, desc: t.desc, typeId: t.typeId, extraPrompt: t.extraPrompt, matchKeywords: t.matchKeywords.join('、') })
      const entries = Object.entries(t.fieldMapping ?? {})
      setMapping(entries.length ? entries.map(([src, dst]) => ({ src, dst })) : [{ src: '', dst: '' }])
      setEditing(t)
      setCreating(false)
    } else {
      setForm({ name: '', desc: '', typeId: '', extraPrompt: '', matchKeywords: '' })
      setMapping([{ src: '', dst: '' }])
      setCreating(true)
      setEditing(null)
    }
  }

  async function save() {
    if (!form.name.trim()) return notify('请填写模板名称')
    // 解析字段映射：只保留两端都填了的行（编辑时不会清空已有映射）
    const fieldMapping: Record<string, string> = {}
    for (const m of mapping) {
      const src = m.src.trim(), dst = m.dst.trim()
      if (src && dst) fieldMapping[src] = dst
    }
    setBusy(true)
    try {
      await api('/scan/templates', {
        method: 'POST',
        body: {
          id: editing?.id,
          name: form.name,
          desc: form.desc,
          typeId: form.typeId || undefined,
          extraPrompt: form.extraPrompt,
          matchKeywords: form.matchKeywords.split(/[、,，]/).map((s) => s.trim()).filter(Boolean),
          fieldMapping,
        },
      })
      notify(editing ? '模板已更新' : '模板已创建')
      setCreating(false); setEditing(null)
      q.reload()
    } catch (e) { notify(e instanceof Error ? e.message : '保存失败') }
    finally { setBusy(false) }
  }

  async function remove(id: string) {
    try {
      await api(`/scan/templates/${id}`, { method: 'DELETE' })
      notify('模板已删除')
      setConfirmDel(null)
      q.reload()
    } catch (e) { notify(e instanceof Error ? e.message : '删除失败') }
  }

  return (
    <PageShell
      icon={ScanLine}
      title="识别模板管理"
      subtitle="自定义扫描识别的提示词与字段映射 —— 普通用户零配置，高级用户可深度定制"
      benchmark="识别模板"
      features={[
        '三层体系：内置模板自动匹配 → 类型级默认绑定 → 自定义模板（本页）',
        '自动匹配：根据对象类型（支出→消费小票、订单→订单截图）与关键词自动选择模板',
        '自定义提示词：写「金额取合计、商户取票头」这类场景指令，无需懂完整 prompt',
        '按类型绑定：把模板绑定对象类型，该类型扫描时自动使用',
        '字段映射：把模型输出键映射到本体属性（内置模板已预置）',
      ]}
      actions={<Btn size="sm" variant="primary" onClick={() => startEdit(null)}><Plus size={14} /> 新建模板</Btn>}
    >
      {toast && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">{toast}</div>}

      {/* 自动匹配说明 */}
      <Card>
        <CardHeader title="自动匹配（默认行为）" desc="系统根据上下文自动选模板，用户无需操作" />
        <div className="grid gap-3 md:grid-cols-3">
          {[
            { step: '①', title: '类型绑定优先', desc: '该对象类型绑定了自定义模板 → 直接用' },
            { step: '②', title: '关键词匹配', desc: '提示词含「发票/小票/订单」→ 命中内置模板' },
            { step: '③', title: '类型推断', desc: '支出→消费小票、销售订单→订单截图' },
          ].map((x) => (
            <div key={x.step} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
              <div className="text-lg font-bold text-brand-600">{x.step}</div>
              <div className="text-[13px] font-semibold text-slate-700">{x.title}</div>
              <div className="mt-0.5 text-[11px] leading-5 text-slate-400">{x.desc}</div>
            </div>
          ))}
        </div>
        {q.data?.auto && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-700">
            <Sparkles size={12} /> 当前默认建议：<b>{q.data.auto.name}</b> · {q.data.auto.reason}
          </div>
        )}
      </Card>

      {/* 模板列表 */}
      <Card padding={false}>
        <div className="border-b border-slate-100 p-4">
          <CardHeader className="mb-0" title="全部模板" desc={`${templates.filter((t) => t.kind === 'builtin').length} 个内置 + ${templates.filter((t) => t.kind === 'custom').length} 个自定义`} />
        </div>
        <div className="p-4">
          {q.loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400"><Loader2 size={15} className="animate-spin" /> 加载模板…</div>
          ) : (
            <DataTable
              rows={templates}
              rowKey={(t) => t.id}
              columns={[
                { key: 'name', header: '模板', cell: (t) => (
                  <span>
                    <span className="block font-semibold text-slate-800">{t.name}</span>
                    <span className="block text-[11px] text-slate-400">{t.desc.slice(0, 34) || '—'}</span>
                  </span>
                ) },
                { key: 'kind', header: '来源', cell: (t) => <Badge color={t.kind === 'builtin' ? 'blue' : 'violet'}>{t.kind === 'builtin' ? '内置' : '自定义'}</Badge> },
                { key: 'typeId', header: '绑定类型', cell: (t) => <span className="text-xs text-slate-600">{t.typeId ? typeName(t.typeId) : '任意'}</span> },
                {
                  key: 'scene', header: '自动匹配词', cell: (t) => (
                    <span className="flex flex-wrap gap-1">{t.matchKeywords.slice(0, 3).map((k) => <span key={k} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{k}</span>)}</span>
                  ),
                },
                {
                  key: 'op', header: '操作', align: 'right', cell: (t) => (
                    <span className="flex items-center justify-end gap-2 text-[11px]">
                      <button onClick={() => setPreview(t)} className="text-slate-500 hover:text-brand-600"><Eye size={13} /></button>
                      {t.kind === 'custom' && (
                        <>
                          <button onClick={() => startEdit(t)} className="text-slate-500 hover:text-brand-600"><Pencil size={13} /></button>
                          {confirmDel === t.id ? (
                            <>
                              <button onClick={() => remove(t.id)} className="rounded bg-red-500 px-1.5 py-0.5 text-white">确认</button>
                              <button onClick={() => setConfirmDel(null)} className="text-slate-400">取消</button>
                            </>
                          ) : (
                            <button onClick={() => setConfirmDel(t.id)} className="text-slate-300 hover:text-red-500"><Trash2 size={13} /></button>
                          )}
                        </>
                      )}
                    </span>
                  ),
                },
              ]}
            />
          )}
        </div>
      </Card>

      {/* 新建/编辑弹层 */}
      {(creating || editing) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={() => { setCreating(false); setEditing(null) }}>
          <div className="max-h-[88vh] w-[560px] max-w-[94vw] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div className="text-base font-bold text-slate-900">{editing ? '编辑模板' : '新建识别模板'}</div>
              <button onClick={() => { setCreating(false); setEditing(null) }} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><X size={16} /></button>
            </div>
            <div className="space-y-3.5">
              <Field label="模板名称" required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：增值税专用发票" /></Field>
              <Field label="说明"><Input value={form.desc} onChange={(e) => setForm({ ...form, desc: e.target.value })} placeholder="一句话说明适用场景" /></Field>
              <Field label="绑定对象类型（可选）" hint="绑定后该类型扫描时自动使用本模板">
                <select value={form.typeId} onChange={(e) => setForm({ ...form, typeId: e.target.value })} className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[13px] text-slate-700 focus:border-brand-400 focus:outline-none">
                  <option value="">不绑定（手动选择时可用）</option>
                  {(typesQ.data?.targets ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </Field>
              <Field label="识别提示词（场景指令）" hint="只写场景要点即可，系统会自动补齐「按本体属性输出 JSON」等通用规则">
                <textarea
                  value={form.extraPrompt}
                  onChange={(e) => setForm({ ...form, extraPrompt: e.target.value })}
                  placeholder={'这是增值税专用发票。\n金额取「价税合计」，不是不含税金额。\n识别发票号码、开票日期、销售方、购买方、税率。\n不要把销货方与购买方混淆。'}
                  className="h-36 w-full resize-none rounded-lg border border-slate-200 p-3 font-mono text-[12px] leading-5 focus:border-brand-400 focus:outline-none"
                />
              </Field>
              <Field label="自动匹配关键词" hint="逗号分隔，命中即自动选用本模板">
                <Input value={form.matchKeywords} onChange={(e) => setForm({ ...form, matchKeywords: e.target.value })} placeholder="专票、增值税、开票" />
              </Field>
              <Field label="字段映射" hint="模型输出键 → 本体属性 key；留空则不映射（识别结果按同名属性回填）">
                <div className="space-y-1.5">
                  {mapping.map((m, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <input
                        value={m.src}
                        onChange={(e) => setMapping(mapping.map((x, j) => j === i ? { ...x, src: e.target.value } : x))}
                        placeholder="模型输出键，如 价税合计"
                        className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 font-mono text-[12px] focus:border-brand-400 focus:outline-none"
                      />
                      <span className="shrink-0 text-slate-400">→</span>
                      <input
                        value={m.dst}
                        onChange={(e) => setMapping(mapping.map((x, j) => j === i ? { ...x, dst: e.target.value } : x))}
                        placeholder="本体属性 key，如 amount"
                        className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 font-mono text-[12px] focus:border-brand-400 focus:outline-none"
                      />
                      <button onClick={() => setMapping(mapping.filter((_, j) => j !== i))} className="shrink-0 text-slate-300 hover:text-red-500" title="删除该行"><X size={13} /></button>
                    </div>
                  ))}
                  <button onClick={() => setMapping([...mapping, { src: '', dst: '' }])} className="text-[11px] text-brand-600 hover:underline">+ 添加映射</button>
                </div>
              </Field>
              <div className="rounded-lg border border-brand-200 bg-brand-50/50 px-3 py-2.5 text-[11px] leading-5 text-brand-700">
                <b>提示：</b>你只需写「识别要点」，字段列表（来自对象类型属性）、JSON 格式约束、枚举约束、数值清洗都由平台自动生成。新建对象类型后模板自动适配其属性。
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Btn onClick={() => { setCreating(false); setEditing(null) }}>取消</Btn>
              <Btn variant="primary" disabled={busy} onClick={save}>{busy ? '保存中…' : <><Save size={13} /> 保存模板</>}</Btn>
            </div>
          </div>
        </div>
      )}

      {/* 模板详情预览 */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm" onClick={() => setPreview(null)}>
          <div className="w-[520px] max-w-[92vw] rounded-2xl border border-slate-200 bg-white p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <div className="text-base font-bold text-slate-900">{preview.name}</div>
              <button onClick={() => setPreview(null)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>
            <div className="space-y-2.5 text-xs">
              <div><span className="text-slate-400">说明：</span>{preview.desc || '—'}</div>
              <div><span className="text-slate-400">场景指令：</span></div>
              <pre className="whitespace-pre-wrap rounded-lg border border-slate-100 bg-slate-50 p-3 font-mono text-[11px] leading-5 text-slate-600">{preview.extraPrompt || '（无，使用通用规则）'}</pre>
              {Object.keys(preview.fieldMapping ?? {}).length > 0 && (
                <>
                  <div><span className="text-slate-400">字段映射：</span></div>
                  <div className="flex flex-wrap gap-1">{Object.entries(preview.fieldMapping).map(([k, v]) => <span key={k} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px]">{k} → {v}</span>)}</div>
                </>
              )}
              <div className="rounded-lg border border-violet-200 bg-violet-50/50 px-3 py-2 text-[11px] leading-5 text-violet-700">
                完整提示词 = 平台通用规则（按本体属性输出 JSON）+ 上方场景指令 + 你本次的补充要求
              </div>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}
