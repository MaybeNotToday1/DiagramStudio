import { test, expect, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createCanvas } from '@napi-rs/canvas'
import { parseSql } from '../../src/modules/er/domain/sql'
import { sampleSql } from '../../src/modules/er/domain/sample'
import type { ErDocument } from '../../src/modules/er/domain/model'
import { sceneBounds, sceneFor } from '../../src/modules/er/domain/scene'
import { entityDocument } from '../../src/modules/er/domain/export'

test.use({ actionTimeout: 10000 })

async function importDocument(page: Page, doc: ErDocument) {
  await page.goto('/'); await expect(page.locator('.x6-node')).toHaveCount(11)
  await page.locator('input[type=file]').nth(1).setInputFiles({ name: 'style.diagram.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) })
  await page.locator('.el-message-box').getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.getByLabel('项目名称')).toHaveValue(doc.title)
}
async function backup(page: Page): Promise<ErDocument> {
  const event = page.waitForEvent('download'); await page.getByRole('button', { name: '项目备份' }).click()
  return JSON.parse(await readFile((await (await event).path())!, 'utf8'))
}
async function number(page: Page, label: string, value: number) { const input = page.getByRole('spinbutton', { name: label, exact: true }); await input.fill(String(value)); await input.press('Tab') }
async function select(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).locator('xpath=ancestor::div[contains(@class,"el-select__wrapper")]').click()
  await page.getByRole('listbox', { name: label, exact: true }).getByRole('option', { name: option, exact: true }).click()
}
const node = (page: Page, id: string) => page.locator(`.x6-node[data-cell-id="${id}"]`)

test('grouped style controls apply to canvas and actual SVG/Draw.io, undo and reload preserve positions', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  const doc = parseSql(sampleSql); doc.title = '样式交互验收'
  await importDocument(page, doc)
  await page.getByRole('button', { name: '⚙ 样式', exact: true }).click()
  await page.getByRole('switch', { name: '自适应宽度', exact: true }).locator('..').click()
  await number(page, '实体宽度', 190); await number(page, '实体高度', 76)
  await number(page, '边框粗细', 3); await number(page, '连线粗细', 2); await number(page, '主键下划线粗细', 2.5)
  await page.getByLabel('文字颜色', { exact: true }).fill('#112233'); await page.getByLabel('线条颜色', { exact: true }).fill('#765432')
  await page.getByLabel('实体填充', { exact: true }).fill('#e5f1ec')
  await select(page, '属性形状', '矩形'); await select(page, '关系形状', '椭圆'); await select(page, '字体粗细', '加粗')
  await page.getByText('透明', { exact: true }).click()
  await page.screenshot({ path: 'docs/evidence/style-settings.png', fullPage: true })
  await page.getByRole('button', { name: '应用样式', exact: true }).click()
  await expect(node(page, doc.entities[0].id).locator('rect')).toHaveAttribute('width', '190')
  await expect(node(page, doc.entities[0].id).locator('rect')).toHaveAttribute('stroke-width', '3')
  await expect(node(page, doc.entities[0].id).locator('text')).toHaveCSS('font-weight', '700')
  await expect(node(page, doc.entities[0].fields[0].id).locator('text')).toHaveCSS('text-decoration-thickness', '2.5px')
  const changed = await backup(page)
  expect(changed.layout).toEqual(doc.layout); expect(changed.style.attributeShape).toBe('rect'); expect(changed.style.fontWeight).toBe('bold')
  await page.getByLabel('撤销', { exact: true }).click(); expect((await backup(page)).style).toEqual(doc.style)
  await page.getByLabel('重做', { exact: true }).click(); expect((await backup(page)).style).toEqual(changed.style)
  await page.reload(); await expect(page.locator('.x6-node')).toHaveCount(11); expect(await backup(page)).toEqual(changed)
  await page.getByRole('button', { name: '↓ 导出', exact: true }).click()
  for (const format of ['SVG', 'Draw.io']) {
    await page.getByRole('button', { name: new RegExp(`^${format.replace('.', '\\.')} `) }).click()
    const event = page.waitForEvent('download'); await page.getByRole('button', { name: '导出文件', exact: true }).click()
    const file = await event, bytes = await readFile((await file.path())!, 'utf8')
    await file.saveAs(`.runtime/styled.${format === 'SVG' ? 'svg' : 'drawio'}`)
    if (format === 'SVG') { expect(bytes).toContain('stroke="#765432" stroke-width="3"'); expect(bytes).toContain('font-weight="bold"'); expect(bytes).toContain('text-decoration-thickness:2.5px') }
    else { expect(bytes).toContain('strokeColor=#765432;strokeWidth=3;fontStyle=1;'); expect(bytes).toContain('labelBackgroundColor=none;') }
  }
  expect(errors).toEqual([])
})

test('full screen keeps dialogs usable, entity/attribute drag stays live, Ctrl drag keeps radius, pan and Esc work', async ({ page }) => {
  const doc = parseSql(sampleSql); doc.title = '全屏拖动验收'
  await importDocument(page, doc)
  await page.getByRole('button', { name: '全屏画布', exact: true }).click()
  await expect(page.locator('.preview-panel')).toHaveClass(/preview-fullscreen/)
  await expect.poll(() => page.locator('.preview-panel').evaluate(e => Math.round(e.getBoundingClientRect().width))).toBe(1600)
  await page.getByRole('button', { name: '⚙ 样式', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '图表样式', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '适应画布', exact: true }).click()
  const entity = doc.entities[0], attr = entity.fields[0], before = await node(page, entity.id).boundingBox(), attrBefore = await node(page, attr.id).boundingBox()
  const x = before!.x + before!.width / 2, y = before!.y + before!.height / 2
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 95, y + 48, { steps: 12 })
  const during = await node(page, attr.id).boundingBox()
  expect(during!.x - attrBefore!.x).toBeGreaterThan(50)
  expect(during!.y - attrBefore!.y).toBeGreaterThan(20)
  await page.mouse.up()
  const moved = await node(page, entity.id).boundingBox(), field = await node(page, attr.id).boundingBox()
  const center = { x: moved!.x + moved!.width / 2, y: moved!.y + moved!.height / 2 }, point = { x: field!.x + field!.width / 2, y: field!.y + field!.height / 2 }
  const radius = Math.hypot(point.x - center.x, point.y - center.y)
  await page.keyboard.down('Control'); await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(point.x + 100, point.y + 65, { steps: 12 }); await page.mouse.up(); await page.keyboard.up('Control')
  const rotated = await node(page, attr.id).boundingBox(), distance = Math.hypot(rotated!.x + rotated!.width / 2 - center.x, rotated!.y + rotated!.height / 2 - center.y)
  expect(distance).toBeCloseTo(radius, 0)
  expect(Math.abs(rotated!.x - field!.x)).toBeGreaterThan(20)
  const transform = await page.locator('.x6-graph-svg-viewport').getAttribute('transform')
  await page.mouse.move(1450, 600); await page.mouse.down(); await page.mouse.move(1330, 650, { steps: 8 }); await page.mouse.up()
  await expect(page.locator('.x6-graph-svg-viewport')).not.toHaveAttribute('transform', transform!)
  await page.screenshot({ path: 'docs/evidence/fullscreen-canvas.png', fullPage: true })
  await page.keyboard.press('Escape'); await expect(page.locator('.preview-panel')).not.toHaveClass(/preview-fullscreen/)
  const saved = await backup(page)
  const oldRadius = Math.hypot(doc.layout[attr.id].x - doc.layout[entity.id].x, doc.layout[attr.id].y - doc.layout[entity.id].y), newRadius = Math.hypot(saved.layout[attr.id].x - saved.layout[entity.id].x, saved.layout[attr.id].y - saved.layout[entity.id].y)
  expect(newRadius).toBeCloseTo(oldRadius, 6)
  await page.reload(); await expect(page.locator('.x6-node')).toHaveCount(11); expect((await backup(page)).layout).toEqual(saved.layout)
})

test('attribute arrangement and visibility controls preserve structure and support undo', async ({ page }) => {
  const doc = parseSql(sampleSql); doc.title = '排列与显隐验收'
  await importDocument(page, doc)
  await page.getByRole('button', { name: '⚙ 样式', exact: true }).click()
  await page.getByRole('switch', { name: '显示关联', exact: true }).locator('..').click()
  await page.getByRole('switch', { name: '主键下划线', exact: true }).locator('..').click()
  await page.getByRole('switch', { name: '智能连接线', exact: true }).locator('..').click()
  await select(page, '属性排列', '水平排列')
  await number(page, '属性连线长度', 300)
  await page.getByRole('button', { name: '应用样式', exact: true }).click()
  await expect(page.locator('.x6-node')).toHaveCount(10); await expect(page.locator('.x6-node [text-decoration=underline]')).toHaveCount(0)
  const next = await backup(page)
  expect(next.entities).toEqual(doc.entities); expect(next.relationships).toEqual(doc.relationships)
  for (const entity of doc.entities) { expect(next.layout[entity.id]).toEqual(doc.layout[entity.id]); expect(new Set(entity.fields.map(f => next.layout[f.id].y)).size).toBe(1) }
  await page.getByLabel('撤销', { exact: true }).click(); expect((await backup(page)).layout).toEqual(doc.layout)
  await expect(page.locator('.x6-node')).toHaveCount(11)
})

test('one-click entity export downloads a ZIP with distinct complete PNG/JPEG images and leaves the document unchanged', async ({ page }) => {
  const doc = parseSql(sampleSql); doc.title = '批量导出验收'; doc.style.showAttributes = false
  doc.entities.forEach(e => { e.label = '重复/实体' })
  for (const p of Object.values(doc.layout)) { p.x -= 900; p.y -= 800 }
  doc.style.entityFill = '#e5f1ec'; doc.style.attributeFill = '#faf6ed'
  await importDocument(page, doc); await expect(page.locator('.x6-node')).toHaveCount(3)
  const before = await backup(page)
  await page.getByRole('button', { name: '↓ 导出', exact: true }).click()
  await page.getByText('一键单独导出每个实体（ZIP）', { exact: true }).click()
  for (const format of ['PNG', 'JPEG'] as const) {
    await page.getByRole('button', { name: new RegExp(`^${format} `) }).click()
    if (format === 'PNG') await page.getByText('透明背景', { exact: true }).click()
    const event = page.waitForEvent('download'); await page.getByRole('button', { name: '导出文件', exact: true }).click()
    const file = await event; expect(file.suggestedFilename()).toBe('批量导出验收-独立实体图.zip')
    await file.saveAs(`.runtime/entities-${format.toLowerCase()}.zip`)
    const entries = Object.entries(unzipSync(new Uint8Array(await readFile((await file.path())!))))
    expect(entries).toHaveLength(2); expect(entries.map(([name]) => name)).toEqual([`001-重复_实体.${format.toLowerCase()}`, `002-重复_实体.${format.toLowerCase()}`])
    for (const [i, [name, bytes]] of entries.entries()) {
      expect(Buffer.from(bytes).subarray(0, format === 'PNG' ? 8 : 3).toString('hex')).toBe(format === 'PNG' ? '89504e470d0a1a0a' : 'ffd8ff')
      const bounds = sceneBounds(sceneFor(entityDocument(doc, doc.entities[i].id)), 40)
      const result = await page.evaluate(async ({ data, mime }) => {
        const bitmap = await createImageBitmap(new Blob([new Uint8Array(data)], { type: mime })), canvas = document.createElement('canvas')
        canvas.width = bitmap.width; canvas.height = bitmap.height; const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0)
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
        let green = 0, beige = 0
        for (let k = 0; k < pixels.length; k += 4) { if (Math.abs(pixels[k] - 229) < 4 && Math.abs(pixels[k + 1] - 241) < 4 && Math.abs(pixels[k + 2] - 236) < 4 && pixels[k + 3] > 200) green++; if (Math.abs(pixels[k] - 250) < 4 && Math.abs(pixels[k + 1] - 246) < 4 && Math.abs(pixels[k + 2] - 237) < 4 && pixels[k + 3] > 200) beige++ }
        return { width: bitmap.width, height: bitmap.height, cornerAlpha: pixels[3], green, beige }
      }, { data: Array.from(bytes), mime: `image/${format.toLowerCase()}` })
      expect(result.width).toBe(Math.ceil(bounds.width * 2)); expect(result.height).toBe(Math.ceil(bounds.height * 2))
      expect(result.cornerAlpha).toBe(format === 'PNG' ? 0 : 255); expect(result.green).toBeGreaterThan(1000); expect(result.beige).toBeGreaterThan(1000)
      await writeFile(`.runtime/entity-${format.toLowerCase()}-${i}.${format.toLowerCase()}`, bytes)
    }
  }
  await page.getByRole('button', { name: '关闭', exact: true }).click(); expect(await backup(page)).toEqual(before)
})

test('PDF applies extended styles and visibility through the actual backend rendering path', async ({ page }) => {
  const doc = parseSql(sampleSql); doc.title = '新样式 PDF 验收'
  Object.assign(doc.style, { showAttributes: false, showRelationships: false, entityFill: '#b7d5ec', lineColor: '#765432', borderWidth: 3, fontWeight: 'bold', radius: 12, entityWidth: 200, entityHeight: 80 })
  await importDocument(page, doc); await expect(page.locator('.x6-node')).toHaveCount(2)
  await page.getByRole('button', { name: '↓ 导出', exact: true }).click(); await page.getByRole('button', { name: /^PDF / }).click()
  await page.getByRole('button', { name: '生成 PDF', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('PDF 已生成', { timeout: 60000 })
  const event = page.waitForEvent('download'); await page.getByRole('link', { name: '下载 PDF ↓' }).click()
  const file = await event; await file.saveAs('.runtime/styled.pdf')
  const bytes = await readFile((await file.path())!), loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }), pdf = await loading.promise, sheet = await pdf.getPage(1)
  const text = (await sheet.getTextContent()).items.map((item: any) => item.str || '').join('').normalize('NFKC')
  expect(text).toContain('班级'); expect(text).toContain('学生'); expect(text).not.toContain('班级ID'); expect(text).not.toContain('关联')
  const viewport = sheet.getViewport({ scale: 1.2 }), canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height)), context = canvas.getContext('2d')
  await sheet.render({ canvas: canvas as any, canvasContext: context as any, viewport }).promise
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data; let blue = 0, brown = 0
  for (let k = 0; k < pixels.length; k += 4) { if (Math.abs(pixels[k] - 183) < 3 && Math.abs(pixels[k + 1] - 213) < 3 && Math.abs(pixels[k + 2] - 236) < 3) blue++; if (Math.abs(pixels[k] - 118) < 3 && Math.abs(pixels[k + 1] - 84) < 3 && Math.abs(pixels[k + 2] - 50) < 3) brown++ }
  expect(blue).toBeGreaterThan(1000); expect(brown).toBeGreaterThan(100)
  await writeFile('docs/evidence/styled-pdf.png', canvas.toBuffer('image/png')); await loading.destroy()
})

test('30 entities / 600 attributes export into 30 independently decoded images with measured time', async ({ page }) => {
  test.setTimeout(120000)
  const sql = Array.from({ length: 30 }, (_, i) => `CREATE TABLE table_${i}(id INT PRIMARY KEY,${Array.from({ length: 19 }, (_, f) => `field_${f} VARCHAR(100) COMMENT '字段${f}'`).join(',')}${i ? `,FOREIGN KEY(field_0) REFERENCES table_${i - 1}(id)` : ''}) COMMENT '批量实体${i}';`).join('\n')
  const doc = parseSql(sql); doc.title = '30实体独立导出'; doc.style.showAttributes = false
  await importDocument(page, doc)
  await page.getByRole('button', { name: '↓ 导出', exact: true }).click()
  await page.getByText('一键单独导出每个实体（ZIP）', { exact: true }).click()
  const start = performance.now(), event = page.waitForEvent('download', { timeout: 60000 })
  await page.getByRole('button', { name: '导出文件', exact: true }).click()
  const file = await event; await file.saveAs('.runtime/entities-stress.zip')
  const ms = Math.round(performance.now() - start), bytes = await readFile((await file.path())!), entries = Object.entries(unzipSync(new Uint8Array(bytes)))
  expect(entries).toHaveLength(30)
  for (const [, image] of entries) {
    expect(Buffer.from(image).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    const size = await page.evaluate(async data => { const bitmap = await createImageBitmap(new Blob([new Uint8Array(data)], { type: 'image/png' })); return { width: bitmap.width, height: bitmap.height } }, Array.from(image))
    expect(size.width).toBeGreaterThan(1000); expect(size.height).toBeGreaterThan(1000)
  }
  await writeFile('.runtime/entity-export-performance.json', JSON.stringify({ entities: 30, attributes: 600, images: entries.length, milliseconds: ms, bytes: bytes.length, format: 'png', ratio: 2 }, null, 2))
})

test('cancelling a pending batch releases the dialog and produces no partial download', async ({ page }) => {
  const doc = parseSql(sampleSql); doc.title = '取消批量验收'
  await importDocument(page, doc)
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  // Only hold the export font fetch. The visible canvas has already loaded its font.
  await page.route('**/fonts/diagram-serif.woff2', async route => { await held; await route.continue() })
  const downloads: string[] = []; page.on('download', file => downloads.push(file.suggestedFilename()))
  await page.getByRole('button', { name: '↓ 导出', exact: true }).click()
  await page.getByText('一键单独导出每个实体（ZIP）', { exact: true }).click()
  await page.getByRole('button', { name: '导出文件', exact: true }).click()
  await page.getByRole('button', { name: '取消导出', exact: true }).click()
  await expect(page.getByRole('button', { name: '导出文件', exact: true })).toBeEnabled()
  release()
  expect(downloads).toEqual([])
  await page.getByRole('button', { name: '关闭', exact: true }).click(); expect((await backup(page)).layout).toEqual(doc.layout)
})
