import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db, tables } from '../db'
import { requireAuth } from '../auth'
import { resolveSpace, spacePerm, spaceCanModel, type SpaceInfo } from '../space'
import {
  chunkText, localEmbed, remoteEmbed, serializeEmbedding, deserializeEmbedding, cosine, bm25, rrfFuse,
  type ScoredChunk,
} from '../engine/knowledge'
import type { SessionUser } from '../../shared/types'

/** 知识库 API（P5，空间感知）：入库分块向量化 / 混合检索 / 文档挂接对象 */

type Ctx = { Variables: { user: SessionUser; space: SpaceInfo } }

function audit(user: SessionUser, action: string, target: string, detail?: Record<string, unknown>) {
  db.insert(tables.auditEvents).values({
    id: `AE-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    actor: user.name, action, target, detail, ip: '本地', createdAt: Date.now(),
  }).run()
}

/** 读取 embedding 配置：优先用嵌入专属 endpoint/key，其次回退 AI 网关 */
function getEmbedConfig(): { endpoint: string; apiKey: string; model: string } | null {
  const ai = db.select().from(tables.settings).where(eq(tables.settings.key, 'ai')).get()
  const emb = db.select().from(tables.settings).where(eq(tables.settings.key, 'embedding')).get()
  const aiVal = (ai?.value ?? {}) as { endpoint?: string; apiKey?: string }
  const embVal = (emb?.value ?? {}) as { model?: string; enabled?: boolean; endpoint?: string; apiKey?: string }
  if (embVal.enabled === false) return null
  // 优先用嵌入专属端点，否则用 AI 网关端点
  const endpoint = embVal.endpoint || aiVal.endpoint
  const apiKey = embVal.apiKey || aiVal.apiKey
  if (!endpoint || !apiKey) return null
  return { endpoint, apiKey, model: embVal.model || 'text-embedding-3-small' }
}

/** 为文档生成分块与向量（远程失败自动降级本地向量） */
async function indexDocument(docId: string, text: string): Promise<{ chunks: number; mode: 'remote' | 'local' }> {
  // 清理旧分块
  const olds = db.select().from(tables.docChunks).all().filter((c) => c.docId === docId)
  for (const c of olds) db.delete(tables.docChunks).where(eq(tables.docChunks.id, c.id)).run()

  const chunks = chunkText(text)
  if (chunks.length === 0) return { chunks: 0, mode: 'local' }

  let vectors: number[][] = []
  let mode: 'remote' | 'local' = 'local'
  const cfg = getEmbedConfig()
  if (cfg) {
    try {
      vectors = await remoteEmbed(cfg, chunks.map((c) => c.text))
      mode = 'remote'
    } catch {
      vectors = chunks.map((c) => localEmbed(c.text))
      mode = 'local'
    }
  } else {
    vectors = chunks.map((c) => localEmbed(c.text))
  }

  for (const c of chunks) {
    db.insert(tables.docChunks).values({
      id: `${docId}#${c.idx}`,
      docId,
      idx: c.idx,
      text: c.text,
      embedding: serializeEmbedding(vectors[c.idx] ?? []),
      dim: (vectors[c.idx] ?? []).length,
      createdAt: Date.now(),
    }).run()
  }
  db.update(tables.documents).set({ chunkCount: chunks.length, status: '已索引', updatedAt: Date.now() }).where(eq(tables.documents.id, docId)).run()
  return { chunks: chunks.length, mode }
}

export const knowledgeRoutes = new Hono<Ctx>()
knowledgeRoutes.use('*', requireAuth)
knowledgeRoutes.use('*', async (c, next) => {
  const user = c.get('user')
  const space = resolveSpace(c, user)
  if (!space) return c.json({ error: '尚无可访问的本体空间' }, 403)
  c.set('space', space)
  await next()
})

/** 文档列表（含分类统计） */
knowledgeRoutes.get('/docs', (c) => {
  const space = c.get('space')
  const docs = db.select().from(tables.documents).all().filter((d) => d.spaceId === space.id).sort((a, b) => b.updatedAt - a.updatedAt)
  const chunks = db.select().from(tables.docChunks).all().filter((ch) => docs.some((d) => d.id === ch.docId))
  const docLinks = db.select().from(tables.docLinks).all()
  const objs = db.select().from(tables.objects).all().filter((o) => o.spaceId === space.id)
  const types = db.select().from(tables.objectTypes).all().filter((t) => t.spaceId === space.id)
  const objMap = new Map(objs.map((o) => [o.id, o]))

  return c.json({
    space: { id: space.id, name: space.name, kind: space.kind },
    stats: {
      total: docs.length,
      indexed: docs.filter((d) => d.status === '已索引').length,
      chunks: chunks.length,
      categories: Array.from(new Set(docs.map((d) => d.category))).length,
    },
    docs: docs.map((d) => ({
      id: d.id, title: d.title, category: d.category, format: d.format, size: d.size,
      status: d.status, owner: d.owner, chunkCount: d.chunkCount,
      updatedAt: new Date(d.updatedAt).toLocaleDateString('zh-CN'),
      linked: docLinks
        .filter((l) => l.docId === d.id)
        .map((l) => {
          const o = objMap.get(l.objectId)
          const t = types.find((x) => x.id === o?.typeId)
          const v = (o?.values ?? {}) as Record<string, unknown>
          return { objectId: l.objectId, typeName: t?.name ?? '', label: String(v.name ?? v.title ?? v.code ?? v.no ?? l.objectId) }
        }),
    })),
  })
})

/** 新建/入库文档：文本 → 分块 → 向量化 → 索引 */
knowledgeRoutes.post('/docs', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  if (!spaceCanModel(user, space) && spacePerm(user, space, 'document') !== 'full') {
    return c.json({ error: '需要写权限' }, 403)
  }
  const body = await c.req.json<{ title: string; category?: string; format?: string; content: string; objectIds?: string[] }>()
  if (!body.title?.trim()) return c.json({ error: '请填写文档标题' }, 400)
  if (!body.content?.trim() || body.content.trim().length < 10) return c.json({ error: '请提供至少 10 字的文档内容' }, 400)

  const id = `KB-${Date.now().toString(36).toUpperCase()}`
  const now = Date.now()
  db.insert(tables.documents).values({
    id, title: body.title.trim(), category: body.category || 'SOP', format: body.format || 'TXT',
    size: `${(body.content.length / 1024).toFixed(1)} KB`, status: '解析中', owner: user.name,
    content: body.content, chunkCount: 0, spaceId: space.id, createdAt: now, updatedAt: now,
  }).run()

  const res = await indexDocument(id, body.content)

  for (const oid of body.objectIds ?? []) {
    const o = db.select().from(tables.objects).all().find((x) => x.id === oid && x.spaceId === space.id)
    if (o) {
      db.insert(tables.docLinks).values({ id: `DL-${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`, docId: id, objectId: oid, createdBy: user.name, createdAt: now }).run()
    }
  }
  audit(user, '知识入库', `${body.title}@${space.name}`, { chunks: res.chunks, mode: res.mode })
  return c.json({ id, chunks: res.chunks, mode: res.mode })
})

/** 重新索引（内容或 embedding 配置变更后） */
knowledgeRoutes.post('/docs/:id/reindex', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const id = c.req.param('id') as string
  const doc = db.select().from(tables.documents).all().find((d) => d.id === id && d.spaceId === space.id)
  if (!doc) return c.json({ error: '文档不存在（当前空间）' }, 404)
  const res = await indexDocument(id, doc.content)
  audit(user, '重建索引', doc.title, res)
  return c.json({ ok: true, ...res })
})

/** 删除文档（级联分块与挂接） */
knowledgeRoutes.delete('/docs/:id', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const id = c.req.param('id') as string
  const doc = db.select().from(tables.documents).all().find((d) => d.id === id && d.spaceId === space.id)
  if (!doc) return c.json({ error: '文档不存在' }, 404)
  for (const ch of db.select().from(tables.docChunks).all().filter((x) => x.docId === id)) db.delete(tables.docChunks).where(eq(tables.docChunks.id, ch.id)).run()
  for (const l of db.select().from(tables.docLinks).all().filter((x) => x.docId === id)) db.delete(tables.docLinks).where(eq(tables.docLinks.id, l.id)).run()
  db.delete(tables.documents).where(eq(tables.documents.id, id)).run()
  audit(user, '删除文档', doc.title)
  return c.json({ ok: true })
})

/** 文档挂接/解挂业务对象 */
knowledgeRoutes.post('/docs/:id/links', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const id = c.req.param('id') as string
  const { objectId } = await c.req.json<{ objectId: string }>()
  const doc = db.select().from(tables.documents).all().find((d) => d.id === id && d.spaceId === space.id)
  const obj = db.select().from(tables.objects).all().find((o) => o.id === objectId && o.spaceId === space.id)
  if (!doc || !obj) return c.json({ error: '文档或对象不存在' }, 404)
  const existing = db.select().from(tables.docLinks).all().find((l) => l.docId === id && l.objectId === objectId)
  if (existing) return c.json({ error: '已挂接' }, 409)
  db.insert(tables.docLinks).values({ id: `DL-${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`, docId: id, objectId, createdBy: user.name, createdAt: Date.now() }).run()
  audit(user, '文档挂接对象', `${doc.title} → ${objectId}`)
  return c.json({ ok: true })
})

/** 混合检索：BM25 + 向量，RRF 融合 */
knowledgeRoutes.get('/search', async (c) => {
  const user = c.get('user')
  const space = c.get('space')
  const q = (c.req.query('q') ?? '').trim()
  const mode = (c.req.query('mode') ?? 'hybrid') as 'hybrid' | 'keyword' | 'semantic'
  const limit = Math.min(Number(c.req.query('limit')) || 10, 30)
  if (!q) return c.json({ results: [], total: 0, q })

  const docs = db.select().from(tables.documents).all().filter((d) => d.spaceId === space.id && d.status !== '已过期')
  const docMap = new Map(docs.map((d) => [d.id, d]))
  const chunks = db.select().from(tables.docChunks).all().filter((ch) => docMap.has(ch.docId))
  if (chunks.length === 0) return c.json({ results: [], total: 0, q, hint: '当前空间暂无已索引文档' })

  // 关键词路
  const kwScores = bm25(q, chunks.map((ch) => ({ id: ch.id, text: ch.text })))
  const kwRanked = Array.from(kwScores.entries()).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([id]) => id)

  // 语义路
  let vecRanked: string[] = []
  let vecScores = new Map<string, number>()
  if (mode !== 'keyword') {
    const cfg = getEmbedConfig()
    let qv: number[] = []
    if (cfg) {
      try { qv = (await remoteEmbed(cfg, [q]))[0] }
      catch { qv = localEmbed(q) }
    } else qv = localEmbed(q)
    for (const ch of chunks) {
      const v = deserializeEmbedding(ch.embedding)
      if (v.length !== qv.length) continue // 维度不一致（换过模型）跳过
      const s = cosine(qv, v)
      if (s > 0.01) vecScores.set(ch.id, s)
    }
    vecRanked = Array.from(vecScores.entries()).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([id]) => id)
  }

  // 融合
  let finalIds: string[] = []
  if (mode === 'hybrid') finalIds = Array.from(rrfFuse(kwRanked, vecRanked).entries()).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id)
  else if (mode === 'keyword') finalIds = kwRanked.slice(0, limit)
  else finalIds = vecRanked.slice(0, limit)

  const chunkMap = new Map(chunks.map((ch) => [ch.id, ch]))
  const results: ScoredChunk[] = finalIds.map((id) => {
    const ch = chunkMap.get(id)!
    const d = docMap.get(ch.docId)!
    return {
      chunkId: id, docId: ch.docId, docTitle: d.title, docCategory: d.category, idx: ch.idx, text: ch.text,
      score: Math.round(((vecScores.get(id) ?? 0) * 100 + (kwScores.get(id) ?? 0) * 10) * 10) / 10,
      source: kwScores.has(id) && vecScores.has(id) ? 'both' : kwScores.has(id) ? 'kw' : 'vec',
    }
  })

  return c.json({ q, mode, total: results.length, results, engine: getEmbedConfig() ? 'remote' : 'local' })
})
