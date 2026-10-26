import { borderPoint, edgePoints, sceneBounds, sceneFor, labelWidth } from './scene'
import { clone, visibleDocument, type ErDocument } from './model'
import { zipSync } from 'fflate'

export const xml = (s: unknown) => String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!)
export function textLines(label: string, width: number, fontSize: number) {
  const lines: string[] = []; let line = '', size = 0
  for (const char of label) {
    const w = /[^\x00-\xff]/.test(char) ? fontSize : fontSize * .58
    if (char === '\n' || (size + w > width && line)) { lines.push(line); line = ''; size = 0; if (char === '\n') continue }
    line += char; size += w
  }
  lines.push(line)
  return lines
}
export function renderSvg(doc: ErDocument, options: { padding?: number; transparent?: boolean } = {}) {
  const scene = sceneFor(doc), b = sceneBounds(scene, options.padding ?? 40), s = doc.style
  const byId = new Map(scene.nodes.map(n => [n.id, n]))
  const labels: string[] = []
  const edges = scene.edges.map(edge => {
    const points = edgePoints(edge, byId, s.smartConnections)
    const font = edge.labelStyle
    if (edge.label) labels.push(`<text x="${edge.labelPoint!.x}" y="${edge.labelPoint!.y}" text-anchor="middle" dominant-baseline="central" font-size="${font!.fontSize}" font-family="${xml(font!.fontFamily)}, Noto Serif SC, SimSun, serif" font-weight="${font!.fontWeight}" fill="${font!.color}" paint-order="stroke" stroke="${s.labelBackground === 'transparent' ? 'none' : s.labelBackground}" stroke-width="5" stroke-linejoin="round">${xml(edge.label)}</text>`)
    return `<path d="${points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ')}" fill="none" stroke="${s.lineColor}" stroke-width="${s.lineWidth}"/>`
  }).join('')
  const nodes = scene.nodes.map(n => {
    const fill = n.kind === 'entity' ? s.entityFill : n.kind === 'attribute' ? s.attributeFill : s.relationFill
    const geometry = n.shape === 'ellipse' ? `<ellipse rx="${n.width / 2}" ry="${n.height / 2}"/>`
      : n.shape === 'diamond' ? `<polygon points="0,${-n.height / 2} ${n.width / 2},0 0,${n.height / 2} ${-n.width / 2},0"/>`
      : `<rect x="${-n.width / 2}" y="${-n.height / 2}" width="${n.width}" height="${n.height}" rx="${s.radius}"/>`
    const lines = textLines(n.label, labelWidth(n.width, n.shape), s.fontSize * (s.fontWeight === 'bold' ? 1.08 : 1))
    return `<g transform="translate(${n.x},${n.y})"><g fill="${fill}" stroke="${s.lineColor}" stroke-width="${s.borderWidth}">${geometry}</g><text fill="${s.ink}" font-size="${s.fontSize}" text-anchor="middle" dominant-baseline="central"${n.primary ? ` text-decoration="underline" style="text-decoration-thickness:${s.underlineWidth}px"` : ''}>${lines.map((line, i) => `<tspan x="0" y="${(i - (lines.length - 1) / 2) * s.fontSize * 1.35}">${xml(line)}</tspan>`).join('')}</text></g>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(b.width)}" height="${Math.ceil(b.height)}" viewBox="${b.x} ${b.y} ${b.width} ${b.height}" font-family="${xml(s.fontFamily)}, Noto Serif SC, SimSun, serif" font-weight="${s.fontWeight}">${options.transparent ? '' : `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="${s.background}"/>`}${edges}${nodes}${labels.join('')}</svg>`
}

let fontData: Promise<string> | undefined
export async function standaloneSvg(doc: ErDocument, options: { padding?: number; transparent?: boolean } = {}) {
  if (!fontData) fontData = fetch('/fonts/diagram-serif.woff2').then(async response => {
    if (!response.ok) throw new Error('无法读取中文字体，请刷新后重新导出')
    const blob = await response.blob()
    return await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('无法读取导出字体')); reader.readAsDataURL(blob) })
  }).catch(error => { fontData = undefined; throw error })
  const data = await fontData
  return renderSvg(doc, options).replace(/(<svg[^>]*>)/, `$1<defs><style>@font-face{font-family:'Noto Serif SC';src:url('${data}') format('woff2')}</style></defs>`)
}

export function renderDrawio(doc: ErDocument, padding = 40) {
  const scene = sceneFor(doc), b = sceneBounds(scene, padding), s = doc.style
  const nodes = scene.nodes.map(n => {
    const shape = n.shape === 'ellipse' ? 'ellipse;' : n.shape === 'diamond' ? 'rhombus;' : `rounded=${s.radius ? 1 : 0};arcSize=${s.radius};`
    const fill = n.kind === 'entity' ? s.entityFill : n.kind === 'attribute' ? s.attributeFill : s.relationFill
    const style = `${shape}whiteSpace=wrap;html=0;fontFamily=${s.fontFamily};fontSize=${s.fontSize};fontColor=${s.ink};fillColor=${fill};strokeColor=${s.lineColor};strokeWidth=${s.borderWidth};fontStyle=${(n.primary ? 4 : 0) + (s.fontWeight === 'bold' ? 1 : 0)};`
    return `<mxCell id="${n.id}" value="${xml(n.label)}" style="${xml(style)}" vertex="1" parent="1"><mxGeometry x="${n.x - n.width / 2 - b.x}" y="${n.y - n.height / 2 - b.y}" width="${n.width}" height="${n.height}" as="geometry"/></mxCell>`
  }).join('')
  const byId = new Map(scene.nodes.map(n => [n.id, n]))
  const edges = scene.edges.map(e => {
    const a = byId.get(e.from)!, z = byId.get(e.to)!, from = borderPoint(a, e.bend || z, s.smartConnections), to = borderPoint(z, e.bend || a, s.smartConnections)
    const anchors = `exitX=${(from.x - a.x) / a.width + .5};exitY=${(from.y - a.y) / a.height + .5};exitPerimeter=0;entryX=${(to.x - z.x) / z.width + .5};entryY=${(to.y - z.y) / z.height + .5};entryPerimeter=0;`
    const label = e.labelPosition, font = e.labelStyle
    return `<mxCell id="${e.id}" value="${xml(e.label)}" source="${e.from}" target="${e.to}" style="${s.smartConnections ? '' : anchors}endArrow=none;startArrow=none;strokeColor=${s.lineColor};strokeWidth=${s.lineWidth};fontColor=${font?.color || s.ink};fontStyle=${(font?.fontWeight || s.fontWeight) === 'bold' ? 1 : 0};fontSize=${font?.fontSize || s.fontSize - 1};fontFamily=${font?.fontFamily || s.fontFamily};labelBackgroundColor=${s.labelBackground === 'transparent' ? 'none' : s.labelBackground};" edge="1" parent="1"><mxGeometry${label ? ` x="${label.distance * 2 - 1}" y="0"` : ''} relative="1" as="geometry">${label ? `<mxPoint x="${label.offset.x}" y="${label.offset.y}" as="offset"/>` : ''}${e.bend ? `<Array as="points"><mxPoint x="${e.bend.x - b.x}" y="${e.bend.y - b.y}"/></Array>` : ''}</mxGeometry></mxCell>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8"?><mxfile host="DiagramStudio"><diagram name="${xml(doc.title)}" id="${xml(doc.id)}"><mxGraphModel page="0" background="${s.background}"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${nodes}${edges}</root></mxGraphModel></diagram></mxfile>`
}
export function download(content: BlobPart, filename: string, type: string) {
  const blob = new Blob([content], { type }), url = URL.createObjectURL(blob), a = document.createElement('a')
  a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export const safeFilename = (title: string) => title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 80) || 'er-diagram'
export async function rasterBlob(doc: ErDocument, format: 'png' | 'jpeg', ratio: number, padding: number, transparent: boolean, signal?: AbortSignal): Promise<Blob> {
  signal?.throwIfAborted()
  await document.fonts.ready
  const svg = await standaloneSvg(doc, { padding, transparent: format === 'png' && transparent }), b = sceneBounds(sceneFor(doc), padding)
  signal?.throwIfAborted()
  if (Math.ceil(b.width * ratio) * Math.ceil(b.height * ratio) > 64_000_000) throw new Error('图片超过 6400 万像素，请降低倍率或使用 SVG / PDF')
  const canvas = document.createElement('canvas'); canvas.width = Math.ceil(b.width * ratio); canvas.height = Math.ceil(b.height * ratio)
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('浏览器无法创建图片画布')
  const image = new Image(), url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    image.src = url; await image.decode(); ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('图片生成失败')), `image/${format}`, .95))
  } finally { URL.revokeObjectURL(url) }
}
export async function rasterExport(doc: ErDocument, format: 'png' | 'jpeg', ratio: number, padding: number, transparent: boolean) {
  download(await rasterBlob(doc, format, ratio, padding, transparent), `${safeFilename(doc.title)}.${format}`, `image/${format}`)
}
export function entityDocument(document: ErDocument, entityId: string): ErDocument {
  const doc = clone(document), entity = doc.entities.find(e => e.id === entityId)
  if (!entity) throw new Error('实体不存在')
  doc.entities = [entity]; doc.relationships = []; doc.labelLayout = {}; doc.style.cardinalities = {}; doc.title = entity.label || entity.name
  doc.view.entityIds = null
  doc.style.showAttributes = true
  const ids = new Set([entity.id, ...entity.fields.map(f => f.id)])
  doc.layout = Object.fromEntries(Object.entries(doc.layout).filter(([id]) => ids.has(id)))
  doc.initialLayout = Object.fromEntries(Object.entries(doc.initialLayout).filter(([id]) => ids.has(id)))
  return doc
}
export async function entityArchive(document: ErDocument, options: { format: 'png' | 'jpeg'; ratio: number; padding: number; transparent: boolean }, progress: (done: number, total: number) => void, signal?: AbortSignal) {
  const snapshot = visibleDocument(document), files: Record<string, Uint8Array> = {}; let bytes = 0
  if (!snapshot.entities.length) throw new Error('请先创建实体')
  for (const [i, entity] of snapshot.entities.entries()) {
    signal?.throwIfAborted()
    const doc = entityDocument(snapshot, entity.id)
    const image = await new Promise<Blob>((resolve, reject) => {
      const abort = () => reject(signal!.reason)
      signal?.addEventListener('abort', abort, { once: true })
      void rasterBlob(doc, options.format, options.ratio, options.padding, options.transparent, signal).then(resolve, reject).finally(() => signal?.removeEventListener('abort', abort))
    })
    signal?.throwIfAborted()
    bytes += image.size
    if (bytes > 150_000_000) throw new Error('批量图片超过 150 MB，请降低倍率后重试')
    files[`${String(i + 1).padStart(3, '0')}-${safeFilename(doc.title)}.${options.format}`] = new Uint8Array(await image.arrayBuffer())
    progress(i + 1, snapshot.entities.length)
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  signal?.throwIfAborted()
  return zipSync(files, { level: 0 })
}
