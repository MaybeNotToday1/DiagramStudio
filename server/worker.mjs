import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { timingSafeEqual } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { validateDocument } from '../src/modules/er/domain/model.ts'
import { renderSvg } from '../src/modules/er/domain/export.ts'
import { sceneFor, sceneBounds } from '../src/modules/er/domain/scene.ts'

const key = process.env.WORKER_KEY || ''
if (key.length < 24) throw new Error('WORKER_KEY must be configured')
const fontPath = process.env.FONT_PATH || fileURLToPath(new URL('../public/fonts/diagram-serif.woff2', import.meta.url))
const font = (await readFile(fontPath)).toString('base64')
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ['--disable-dev-shm-usage'] })
let busy = false
function authorized(value) { const bytes = Buffer.from(value || ''); return bytes.length === Buffer.byteLength(key) && timingSafeEqual(bytes, Buffer.from(key)) }
export async function renderPdf(body) {
  const document = validateDocument(body.document)
  if (!['A4', 'A3'].includes(body.paper) || !['portrait', 'landscape'].includes(body.orientation) || typeof body.paginate !== 'boolean' || !Number.isFinite(body.padding) || body.padding < 10 || body.padding > 200) throw new Error('Invalid print settings')
  const scene = sceneFor(document)
  if (scene.nodes.length > 5000) throw new Error('Diagram exceeds PDF rendering limit')
  const bounds = sceneBounds(scene, body.padding), svg = renderSvg(document, { padding: body.padding })
  const sides = body.paper === 'A3' ? [297, 420] : [210, 297]
  if (body.orientation === 'landscape') sides.reverse()
  const width = (sides[0] - 20) * 96 / 25.4, height = (sides[1] - 20) * 96 / 25.4
  const columns = body.paginate ? Math.ceil(bounds.width / width) : 1, rows = body.paginate ? Math.ceil(bounds.height / height) : 1
  if (columns * rows > 64) throw new Error('More than 64 PDF pages requested')
  const pages = []
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    const drawing = body.paginate ? svg.replace(/viewBox="[^"]+"/, `viewBox="${bounds.x + col * width} ${bounds.y + row * height} ${width} ${height}"`) : svg
    pages.push(`<section class="sheet">${drawing}</section>`)
  }
  const context = await browser.newContext({ javaScriptEnabled: false })
  try {
    // All content is generated locally; imported diagrams cannot fetch remote resources.
    await context.route('**/*', route => route.abort())
    const page = await context.newPage()
    page.setDefaultTimeout(60000)
    await page.setContent(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
      @font-face{font-family:'Noto Serif SC';src:url(data:font/woff2;base64,${font}) format('woff2')}
      @font-face{font-family:'SimSun';src:url(data:font/woff2;base64,${font}) format('woff2')}
      @page{size:${body.paper} ${body.orientation};margin:10mm}*{box-sizing:border-box}html,body{margin:0;padding:0}
      .sheet{width:${width}px;height:${height}px;break-after:page;overflow:hidden}.sheet:last-child{break-after:auto}
      svg{display:block;width:100%;height:100%}
      </style></head><body>${pages.join('')}</body></html>`, { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready)
    return await page.pdf({ format: body.paper, landscape: body.orientation === 'landscape', printBackground: true, preferCSSPageSize: true, timeout: 90000 })
  } finally { await context.close() }
}
const server = http.createServer(async (request, response) => {
  if (request.url === '/health' && request.method === 'GET') { response.writeHead(200).end('ok'); return }
  if (request.url === '/shutdown' && request.method === 'POST' && authorized(request.headers['x-worker-key'])) { response.writeHead(200).end('ok'); await shutdown(); return }
  if (request.url !== '/render' || request.method !== 'POST') { response.writeHead(404).end(); return }
  if (!authorized(request.headers['x-worker-key'])) { response.writeHead(403).end(); return }
  if (busy) { response.writeHead(429).end(); return }
  busy = true
  try {
    let size = 0; const chunks = []
    for await (const chunk of request) { size += chunk.length; if (size > 8 * 1024 * 1024) throw new Error('Request too large'); chunks.push(chunk) }
    const bytes = await renderPdf(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    response.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': bytes.length }).end(bytes)
  } catch { response.writeHead(422, { 'Content-Type': 'application/json' }).end('{"message":"PDF rendering failed"}') }
  finally { busy = false }
})
server.requestTimeout = 120000
server.headersTimeout = 15000
server.listen(Number(process.env.WORKER_PORT || 3001), process.env.WORKER_HOST || '127.0.0.1', () => process.stdout.write('PDF worker is ready\n'))
async function shutdown() { server.close(); await browser.close(); process.exit(0) }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown)
