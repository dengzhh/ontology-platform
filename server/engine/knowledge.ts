/**
 * 知识层引擎（P5）
 * - 分块：按段落/句子边界切分，带重叠
 * - 向量化：优先调用已配置的 OpenAI 兼容 embedding 接口；未配置时用本地哈希词袋（可检索，非语义）
 * - 检索：BM25 关键词 + 向量余弦，RRF 融合排序
 */

export interface Chunk {
  idx: number
  text: string
}

/** 语义分块：按段落聚合，超长按句子切分，句间保留重叠（默认上限 260 字，检索颗粒度更细） */
export function chunkText(text: string, maxLen = 260, overlap = 50): Chunk[] {
  const clean = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!clean) return []

  // 先按段落/句子拆成原子单元
  const atoms: string[] = []
  for (const para of clean.split(/\n\s*\n/)) {
    const p = para.trim()
    if (!p) continue
    if (p.length <= maxLen) { atoms.push(p); continue }
    // 长段落按中文/英文句末标点切句
    const sentences = p.split(/(?<=[。！？；.!?;\n])/).map((s) => s.trim()).filter(Boolean)
    for (const s of sentences) {
      if (s.length <= maxLen) atoms.push(s)
      else {
        // 极长句硬切
        for (let i = 0; i < s.length; i += maxLen) atoms.push(s.slice(i, i + maxLen))
      }
    }
  }

  // 聚合原子为块
  const chunks: Chunk[] = []
  let buf = ''
  for (const a of atoms) {
    if (!buf) { buf = a; continue }
    if (buf.length + a.length + 1 <= maxLen) { buf += '\n' + a; continue }
    chunks.push({ idx: chunks.length, text: buf })
    // 重叠：保留上一块尾部
    const tail = buf.slice(-overlap)
    buf = (tail + '\n' + a).slice(0, maxLen)
  }
  if (buf.trim()) chunks.push({ idx: chunks.length, text: buf })
  return chunks
}

/* ---------------- 向量化 ---------------- */

const LOCAL_DIM = 256

/** 本地降级向量：字符 n-gram 哈希到固定维度（无需外部服务，可做相似度检索） */
export function localEmbed(text: string): number[] {
  const v = new Array<number>(LOCAL_DIM).fill(0)
  const s = text.toLowerCase().replace(/\s+/g, ' ')
  // 中文按 1-2 字滑窗，英文按词
  const grams: string[] = []
  for (let i = 0; i < s.length - 1; i++) grams.push(s.slice(i, i + 2))
  for (const w of s.split(/[^\w\u4e00-\u9fa5]+/).filter(Boolean)) if (w.length > 1) grams.push(w)
  for (const g of grams) {
    let h = 2166136261
    for (let i = 0; i < g.length; i++) {
      h ^= g.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    const idx = Math.abs(h) % LOCAL_DIM
    v[idx] += 1
  }
  // L2 归一化
  const norm = Math.sqrt(v.reduce((s2, x) => s2 + x * x, 0)) || 1
  return v.map((x) => x / norm)
}

export interface EmbedConfig { endpoint: string; model: string; apiKey: string }

/** 远程 embedding（OpenAI 兼容 /embeddings）；失败抛错由调用方降级 */
export async function remoteEmbed(cfg: EmbedConfig, texts: string[]): Promise<number[][]> {
  const url = cfg.endpoint.replace(/\/$/, '').replace(/\/embeddings$/, '') + '/embeddings'
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model, input: texts }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`embedding 接口 ${res.status}`)
  const data = (await res.json()) as { data?: { embedding: number[] }[] }
  const out = data.data?.map((d) => d.embedding)
  if (!out || out.length !== texts.length) throw new Error('embedding 返回格式异常')
  return out
}

export function serializeEmbedding(v: number[]): string {
  return Buffer.from(new Float32Array(v).buffer).toString('base64')
}

export function deserializeEmbedding(b64: string): number[] {
  if (!b64) return []
  const buf = Buffer.from(b64, 'base64')
  const f = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
  return Array.from(f)
}

export function cosine(a: number[], b: number[]): number {
  if (!a.length || !b.length) return 0
  const n = Math.min(a.length, b.length)
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/* ---------------- BM25 关键词检索 ---------------- */

export interface ScoredChunk {
  chunkId: string
  docId: string
  docTitle: string
  docCategory: string
  idx: number
  text: string
  score: number
  source: 'kw' | 'vec' | 'both'
}

function tokenize(text: string): string[] {
  const s = text.toLowerCase()
  const tokens: string[] = []
  // 英文词
  for (const w of s.split(/[^\w\u4e00-\u9fa5]+/).filter(Boolean)) if (w.length > 1) tokens.push(w)
  // 中文 2-gram
  const cjk = s.match(/[\u4e00-\u9fa5]+/g) ?? []
  for (const seg of cjk) {
    if (seg.length === 1) tokens.push(seg)
    for (let i = 0; i < seg.length - 1; i++) tokens.push(seg.slice(i, i + 2))
  }
  return tokens
}

/** BM25 打分 */
export function bm25(query: string, docs: { id: string; text: string }[], k1 = 1.5, b = 0.75): Map<string, number> {
  const qTokens = tokenize(query)
  const N = docs.length || 1
  const df = new Map<string, number>()
  const docLens = new Map<string, number>()
  const tfs = new Map<string, Map<string, number>>()

  for (const d of docs) {
    const tokens = tokenize(d.text)
    docLens.set(d.id, tokens.length)
    const tf = new Map<string, number>()
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
    tfs.set(d.id, tf)
    for (const t of new Set(tokens)) df.set(t, (df.get(t) ?? 0) + 1)
  }
  const avgLen = Array.from(docLens.values()).reduce((s, x) => s + x, 0) / N || 1
  const scores = new Map<string, number>()
  for (const d of docs) {
    const tf = tfs.get(d.id)!
    const len = docLens.get(d.id) ?? 0
    let score = 0
    for (const q of new Set(qTokens)) {
      const f = tf.get(q) ?? 0
      if (f === 0) continue
      const n = df.get(q) ?? 0
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5))
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * len) / avgLen)))
    }
    if (score > 0) scores.set(d.id, score)
  }
  return scores
}

/** RRF 融合两路排名 */
export function rrfFuse(kwRanked: string[], vecRanked: string[], k = 60): Map<string, number> {
  const scores = new Map<string, number>()
  kwRanked.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1)))
  vecRanked.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1)))
  return scores
}
