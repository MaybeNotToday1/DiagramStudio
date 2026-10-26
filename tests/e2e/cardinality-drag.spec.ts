import { test, expect, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createCanvas } from '@napi-rs/canvas'
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib'
import { blankDocument, clone, type ErDocument } from '../../src/modules/er/domain/model'
import { sceneBounds, sceneFor } from '../../src/modules/er/domain/scene'

test.use({ actionTimeout: 10000 })
function fixture(self = false) {
  const doc = blankDocument(); doc.title = '基数拖动验收'
  doc.entities = [{ id: 'a', name: 'a', label: '班级', fields: [] }, ...(!self ? [{ id: 'b', name: 'b', label: '学生', fields: [] }] : [])]
  doc.relationships = [{ id: 'r', name: '关联', from: 'a', to: self ? 'a' : 'b', fromCardinality: '1', toCardinality: 'N' }]
  doc.layout = self ? { a: { x: 450, y: 450 }, r: { x: 450, y: 150 } } : { a: { x: 150, y: 300 }, b: { x: 750, y: 300 }, r: { x: 450, y: 300 } }
  return doc
}
const node = (page: Page, id: string) => page.locator(`.x6-node[data-cell-id="${id}"]`)
const label = (page: Page, id: string) => page.locator(`.x6-edge[data-cell-id="${id}"] .x6-edge-label`)
async function importDocument(page: Page, doc: ErDocument) {
  await page.goto('/'); await expect(page.locator('.x6-node')).toHaveCount(11)
  await page.locator('input[type=file]').nth(1).setInputFiles({ name: 'labels.diagram.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) })
  await page.locator('.el-message-box').getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.getByLabel('项目名称')).toHaveValue(doc.title)
  await expect(page.locator('.x6-edge-label')).toHaveCount(2)
  await page.getByRole('button', { name: '适应画布', exact: true }).click()
}
async function backup(page: Page): Promise<ErDocument> {
  const event = page.waitForEvent('download'); await page.getByRole('button', { name: '项目备份' }).click()
  return JSON.parse(await readFile((await (await event).path())!, 'utf8'))
}
async function select(page: Page, name: string, value: string) {
  await page.getByRole('combobox', { name, exact: true }).locator('xpath=ancestor::div[contains(@class,"el-select__wrapper")]').click()
  await page.getByRole('listbox', { name, exact: true }).getByRole('option', { name: value, exact: true }).click()
}
async function assertPositions(page: Page, doc: ErDocument) {
  for (const edge of sceneFor(doc).edges.filter(e => e.label)) {
    const delta = await label(page, edge.id).evaluate((element, point) => {
      const actual = new DOMPoint().matrixTransform((element as SVGGraphicsElement).getScreenCTM()!)
      const expected = new DOMPoint(point.x, point.y).matrixTransform(document.querySelector<SVGGraphicsElement>('.x6-graph-svg-viewport')!.getScreenCTM()!)
      return Math.hypot(actual.x - expected.x, actual.y - expected.y)
    }, edge.labelPoint!)
    expect(delta).toBeLessThan(.2)
  }
}
async function moveLabel(page: Page, id: string, dx: number, dy: number) {
  const target = label(page, id); await target.click({ trial: true })
  const box = (await target.boundingBox())!, x = box.x + box.width / 2, y = box.y + box.height / 2
  await page.mouse.move(x, y); await page.mouse.down()
  const positions: string[] = []
  for (let i = 1; i <= 12; i++) { await page.mouse.move(x + dx * i / 12, y + dy * i / 12); positions.push((await target.getAttribute('transform'))!) }
  expect(new Set(positions).size).toBeGreaterThanOrEqual(10)
  await page.mouse.up()
}
async function moveNodeAndCheckLive(page: Page, doc: ErDocument, id: string, dx: number, dy: number) {
  const element = node(page, id), handle = await element.elementHandle(), box = (await element.boundingBox())!, x = box.x + box.width / 2, y = box.y + box.height / 2
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y + dy, { steps: 18 })
  const during = clone(doc)
  during.layout[id] = await element.evaluate(element => {
    const n = element as SVGGraphicsElement, box = n.getBBox(), local = new DOMPoint(box.x + box.width / 2, box.y + box.height / 2).matrixTransform(n.getCTM()!)
    return new DOMPoint(local.x, local.y).matrixTransform(document.querySelector<SVGGraphicsElement>('.x6-graph-svg-viewport')!.getCTM()!.inverse()).toJSON()
  })
  await assertPositions(page, during)
  await page.mouse.up(); expect(await handle!.evaluate(e => e.isConnected)).toBe(true)
  const moved = await backup(page); expect(moved.labelLayout).toEqual(doc.labelLayout); await assertPositions(page, moved)
  return moved
}

test('1/N/M labels drag smoothly, survive undo/reload and follow either endpoint before mouseup', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  const doc = fixture(); await importDocument(page, doc); await assertPositions(page, doc)
  await moveLabel(page, 'r-from', -40, -80)
  const first = await backup(page); expect(first.labelLayout['r-from']).toBeDefined(); expect(first.layout).toEqual(doc.layout)
  await page.getByLabel('撤销', { exact: true }).click(); expect((await backup(page)).labelLayout).toEqual({}); await assertPositions(page, doc)
  await page.getByLabel('重做', { exact: true }).click(); expect((await backup(page)).labelLayout).toEqual(first.labelLayout)
  await label(page, 'r-to').dblclick()
  const dialog = page.getByRole('dialog', { name: '关系基数设置' })
  await select(page, '基数值', 'M')
  await dialog.getByRole('button', { name: '保存基数' }).click()
  await expect(label(page, 'r-to')).toHaveText('M')
  await moveLabel(page, 'r-to', 25, 85)
  const edited = await backup(page); expect(Object.keys(edited.labelLayout)).toHaveLength(2); await assertPositions(page, edited)
  const moved = await moveNodeAndCheckLive(page, edited, 'a', -35, 65)
  const final = await moveNodeAndCheckLive(page, moved, 'r', 25, -45)
  await page.reload(); await expect(page.locator('.x6-edge-label')).toHaveCount(2)
  expect(await backup(page)).toEqual(final); await assertPositions(page, final)
  await page.screenshot({ path: 'docs/evidence/draggable-cardinalities.png', fullPage: true })
  expect(errors).toEqual([])
})

test('self-relationship labels keep their manual offsets while both bent connections follow node drags', async ({ page }) => {
  const doc = fixture(true); await importDocument(page, doc)
  await moveLabel(page, 'r-from', -50, -15); await moveLabel(page, 'r-to', 65, 15)
  const edited = await backup(page); await assertPositions(page, edited)
  const moved = await moveNodeAndCheckLive(page, edited, 'a', -30, 50)
  await moveNodeAndCheckLive(page, moved, 'r', 40, -30)
})

test('double-click font settings persist in actual SVG/PNG/JPEG/Draw.io/PDF downloads at the moved positions', async ({ page }) => {
  const doc = fixture(); doc.labelLayout['r-from'] = { distance: .25, offset: { x: -200, y: -350 } }
  doc.labelLayout['r-to'] = { distance: .5, offset: { x: 50, y: 90 } }; doc.relationships[0].toCardinality = 'M'
  await importDocument(page, doc); await assertPositions(page, doc)
  await label(page, 'r-from').dblclick()
  const dialog = page.getByRole('dialog', { name: '关系基数设置' })
  await dialog.getByRole('spinbutton', { name: '基数字号', exact: true }).fill('34')
  await select(page, '基数字体', '系统无衬线字体'); await select(page, '基数粗细', '加粗')
  await dialog.getByLabel('基数颜色', { exact: true }).fill('#be123c')
  await expect(page.getByRole('listbox', { name: '基数粗细' })).not.toBeVisible()
  await page.screenshot({ path: 'docs/evidence/cardinality-font-settings.png', fullPage: true })
  await dialog.getByRole('button', { name: '保存基数' }).click()
  const styled = await backup(page), font = { fontSize: 34, fontFamily: 'sans-serif', fontWeight: 'bold', color: '#be123c' }
  expect(styled.style.cardinalities['r-from']).toEqual(font); expect(styled.labelLayout).toEqual(doc.labelLayout)
  await expect(label(page, 'r-from').locator('text')).toHaveCSS('font-size', '34px')
  await expect(label(page, 'r-from').locator('text')).toHaveCSS('font-weight', '700')
  await expect(label(page, 'r-from').locator('text')).toHaveCSS('fill', 'rgb(190, 18, 60)')
  await expect(label(page, 'r-to').locator('text')).toHaveCSS('font-size', '15px')
  await page.getByLabel('撤销', { exact: true }).click(); expect((await backup(page)).style.cardinalities).toEqual({})
  await page.getByLabel('重做', { exact: true }).click(); expect((await backup(page)).style.cardinalities['r-from']).toEqual(font)
  await page.reload(); await expect(page.locator('.x6-edge-label')).toHaveCount(2); expect(await backup(page)).toEqual(styled)
  await label(page, 'r-from').dblclick(); await dialog.getByRole('spinbutton', { name: '基数字号', exact: true }).fill('55')
  await dialog.getByRole('button', { name: '取消', exact: true }).click(); expect(await backup(page)).toEqual(styled)
  await page.getByRole('button', { name: '↓ 导出', exact: true }).click()
  for (const format of ['SVG', 'PNG', 'JPEG', 'Draw.io']) {
    await page.getByRole('button', { name: new RegExp(`^${format.replace('.', '\\.')} `) }).click()
    const event = page.waitForEvent('download'); await page.getByRole('button', { name: '导出文件', exact: true }).click()
    const file = await event, suffix = format === 'Draw.io' ? 'drawio' : format.toLowerCase(), bytes = await readFile((await file.path())!)
    await file.saveAs(`.runtime/cardinalities.${suffix}`)
    if (format === 'SVG') {
      const point = sceneFor(styled).edges[0].labelPoint!
      expect(bytes.toString()).toContain(`x="${point.x}" y="${point.y}" text-anchor="middle"`)
      expect(bytes.toString()).toContain('font-size="34" font-family="sans-serif, Noto Serif SC, SimSun, serif" font-weight="bold" fill="#be123c"')
    } else if (format === 'Draw.io') {
      expect(bytes.toString()).toContain('<mxPoint x="-200" y="-350" as="offset"/>')
      expect(bytes.toString()).toContain('fontColor=#be123c;fontStyle=1;fontSize=34;fontFamily=sans-serif;')
    } else {
      if (format === 'PNG') expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      else expect(bytes.subarray(0, 3).toString('hex')).toBe('ffd8ff')
      const bounds = sceneBounds(sceneFor(styled), 40), center = sceneFor(styled).edges[0].labelPoint!
      const count = await page.evaluate(async ({ data, mime, x, y }) => {
        const image = await createImageBitmap(new Blob([new Uint8Array(data)], { type: mime })), canvas = document.createElement('canvas')
        canvas.width = image.width; canvas.height = image.height; const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0)
        const pixels = context.getImageData(Math.floor(x - 35), Math.floor(y - 45), 70, 90).data
        let red = 0
        for (let i = 0; i < pixels.length; i += 4) if (Math.abs(pixels[i] - 190) < 15 && Math.abs(pixels[i + 1] - 18) < 15 && Math.abs(pixels[i + 2] - 60) < 15) red++
        return red
      }, { data: Array.from(bytes), mime: `image/${suffix}`, x: (center.x - bounds.x) * 2, y: (center.y - bounds.y) * 2 })
      expect(count).toBeGreaterThan(100)
    }
  }
  await page.getByRole('button', { name: /^PDF / }).click(); await page.getByRole('button', { name: '生成 PDF', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('PDF 已生成', { timeout: 60000 })
  const event = page.waitForEvent('download'); await page.getByRole('link', { name: '下载 PDF ↓' }).click(); const file = await event
  await file.saveAs('.runtime/cardinalities.pdf')
  const loading = getDocument({ data: new Uint8Array(await readFile((await file.path())!)), useSystemFonts: false }), pdf = await loading.promise, sheet = await pdf.getPage(1)
  const items = (await sheet.getTextContent()).items as any[], text = items.map(i => i.str || '').join('').normalize('NFKC')
  expect(text).toContain('班级'); expect(text).toContain('学生'); expect(items.some(i => i.str === '1')).toBe(true); expect(items.some(i => i.str === 'M')).toBe(true)
  const cardinality = items.find(i => i.str === '1'), entity = items.find(i => i.str.normalize('NFKC') === '班级')
  expect(cardinality.transform[5]).toBeGreaterThan(entity.transform[5] + 100)
  expect(Math.abs(cardinality.transform[0] / items.find(i => i.str === 'M').transform[0])).toBeCloseTo(34 / 15, 1)
  const viewport = sheet.getViewport({ scale: 1.2 }), canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
  await sheet.render({ canvas: canvas as any, canvasContext: canvas.getContext('2d') as any, viewport }).promise
  const fontDocument = await PDFDocument.load(await readFile((await file.path())!))
  const fonts = fontDocument.getPages()[0].node.Resources()!.lookup(PDFName.of('Font'), PDFDict)
  const names = fonts.values().map(value => {
    const font = fontDocument.context.lookup(value, PDFDict)
    return (font.get(PDFName.of('BaseFont')) || font.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict)?.get(PDFName.of('FontName')))?.toString() || ''
  })
  expect(names.some(name => /Bold/.test(name) && !/Noto|SimSun/.test(name))).toBe(true)
  const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
  let red = 0
  for (let i = 0; i < pixels.length; i += 4) if (Math.abs(pixels[i] - 190) < 5 && Math.abs(pixels[i + 1] - 18) < 5 && Math.abs(pixels[i + 2] - 60) < 5) red++
  expect(red).toBeGreaterThan(100)
  await writeFile('docs/evidence/cardinalities-pdf.png', canvas.toBuffer('image/png')); await loading.destroy()
  await page.getByRole('button', { name: '关闭', exact: true }).click(); await label(page, 'r-from').dblclick()
  await dialog.getByRole('button', { name: '使用全局样式', exact: true }).click()
  const inherited = await backup(page); expect(inherited.style.cardinalities).toEqual({}); expect(inherited.labelLayout).toEqual(doc.labelLayout)
  await expect(label(page, 'r-from').locator('text')).toHaveCSS('font-size', '15px')
})
