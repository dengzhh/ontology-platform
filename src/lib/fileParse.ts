/**
 * 文件识别解析工具（浏览器端）
 * - 图片（jpg/png/webp）：直接转 dataURL 送视觉模型
 * - PDF：pdfjs 渲染第 1 页为图片送视觉模型（多页可选），同时提取全文文本
 * - Word（docx）：mammoth 提取纯文本
 * - 文本（txt/md/csv）：直接读文本
 */
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import * as mammoth from 'mammoth'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export interface ParsedFile {
  /** 送视觉模型的图片（dataURL） */
  image?: string
  /** 提取的纯文本（供文本识别/兜底） */
  text?: string
  /** 文件显示名 */
  name: string
  /** 类型标签 */
  kind: 'image' | 'pdf' | 'word' | 'text'
  /** 页数（PDF） */
  pages?: number
}

/** 把任意 File 解析成可识别的输入 */
export async function parseFile(file: File): Promise<ParsedFile> {
  const name = file.name
  const lower = name.toLowerCase()

  // 图片
  if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|gif)$/.test(lower)) {
    const dataUrl = await readAsDataURL(file)
    // 压缩大图（同手机端逻辑）
    return { name, kind: 'image', image: await compressImage(dataUrl) }
  }

  // PDF
  if (file.type === 'application/pdf' || lower.endsWith('.pdf')) {
    const buf = await file.arrayBuffer()
    const pdf = await pdfjs.getDocument({ data: buf }).promise
    const pages = pdf.numPages
    // 渲染第 1 页为图片（新版 pdfjs 用 canvas 参数）
    const page = await pdf.getPage(1)
    const viewport = page.getViewport({ scale: 1.6 })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    await page.render({ canvas, viewport } as Parameters<typeof page.render>[0]).promise
    const image = canvas.toDataURL('image/jpeg', 0.85)
    // 提取全部文本（兜底）
    const texts: string[] = []
    for (let i = 1; i <= Math.min(pages, 5); i++) {
      const p = await pdf.getPage(i)
      const tc = await p.getTextContent()
      texts.push(tc.items.map((it) => ('str' in it ? it.str : '')).join(' '))
    }
    return { name, kind: 'pdf', image, text: texts.join('\n'), pages }
  }

  // Word docx
  if (lower.endsWith('.docx') || file.type.includes('wordprocessingml')) {
    const buf = await file.arrayBuffer()
    const result = await mammoth.extractRawText({ arrayBuffer: buf })
    return { name, kind: 'word', text: result.value }
  }

  // 纯文本 / CSV / Markdown
  const text = await file.text()
  return { name, kind: 'text', text }
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

/** 压缩图片：最长边 1600px、JPEG 0.85 */
export function compressImage(dataUrl: string, maxEdge = 1600, quality = 0.85): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

/** 文件类型 → 图标色/描述 */
export function fileKindMeta(kind: ParsedFile['kind']) {
  const map = {
    image: { label: '图片', color: 'text-blue-500', hint: '视觉识别' },
    pdf: { label: 'PDF', color: 'text-red-500', hint: '首页渲染 + 全文提取' },
    word: { label: 'Word', color: 'text-brand-600', hint: '文本提取' },
    text: { label: '文本', color: 'text-slate-500', hint: '文本识别' },
  }
  return map[kind]
}
