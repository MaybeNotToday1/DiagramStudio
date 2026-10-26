import { readFile, writeFile } from 'node:fs/promises'
import { createCanvas } from '@napi-rs/canvas'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
const bytes = await readFile(process.argv[2] || '.runtime/acceptance.pdf')
const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }), pdf = await loading.promise
const page = await pdf.getPage(1), viewport = page.getViewport({ scale: 1.6 }), canvas = createCanvas(viewport.width, viewport.height)
await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise
await writeFile('.runtime/pdf-page1.png', canvas.toBuffer('image/png'))
process.stdout.write(`Rendered PDF page 1 of ${pdf.numPages} for visual verification\n`)
await loading.destroy()
