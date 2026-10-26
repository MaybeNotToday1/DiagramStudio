import { test, expect, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { blankDocument, uid, type ErDocument } from '../../src/modules/er/domain/model'
import { parseSql } from '../../src/modules/er/domain/sql'

test.use({ actionTimeout: 10000 })

async function importDocument(page: Page, doc: ErDocument) {
  await page.goto('/'); await expect(page.locator('.x6-node')).toHaveCount(11)
  await page.locator('input[type=file]').nth(1).setInputFiles({ name: 'drag.diagram.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) })
  await page.locator('.el-message-box').getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.getByLabel('项目名称')).toHaveValue(doc.title)
  await expect(page.locator('.x6-node')).toHaveCount(doc.entities.length)
  await expect(page.locator('.el-overlay.is-message-box')).not.toBeVisible()
  await page.getByRole('button', { name: '适应画布', exact: true }).click()
  expect(await page.evaluate(() => scrollY)).toBe(0)
}
const node = (page: Page, id: string) => page.locator(`.x6-node[data-cell-id="${id}"]`)
function fixture(count = 1) {
  const doc = blankDocument(); doc.title = '连续拖动验收'
  for (let i = 0; i < count; i++) { const id = uid(); doc.entities.push({ id, name: `entity_${i}`, label: `实体${i}`, fields: [] }); doc.layout[id] = { x: 250 + i * 350, y: 250 + i * 200 } }
  return doc
}
async function backup(page: Page): Promise<ErDocument> {
  const event = page.waitForEvent('download'); await page.getByRole('button', { name: '项目备份' }).click()
  return JSON.parse(await readFile((await (await event).path())!, 'utf8'))
}

test('small pointer movements stay continuous and mouseup/undo/redo reuse existing nodes', async ({ page }) => {
  const doc = fixture(); await importDocument(page, doc)
  const target = node(page, doc.entities[0].id), box = await target.boundingBox(), x = box!.x + box!.width / 2, y = box!.y + box!.height / 2
  const element = await target.elementHandle()
  await page.mouse.move(x, y); await page.mouse.down()
  const positions: number[] = []
  for (let i = 1; i <= 10; i++) { await page.mouse.move(x + i * 2, y, { steps: 1 }); positions.push((await target.boundingBox())!.x) }
  await page.mouse.up()
  const jumps = positions.slice(1).map((p, i) => Math.abs(p - positions[i]))
  await writeFile('.runtime/continuous-drag.json', JSON.stringify({ positions, uniquePositions: new Set(positions).size, largestStep: Math.max(...jumps) }, null, 2))
  expect(new Set(positions).size).toBeGreaterThanOrEqual(8)
  expect(Math.max(...jumps)).toBeLessThan(5)
  await expect.poll(() => element!.evaluate(e => e.isConnected)).toBe(true)
  await page.keyboard.press('Delete'); await expect(page.locator('.el-message-box')).toContainText('删除所选元素')
  await page.locator('.el-message-box').getByRole('button', { name: '取消', exact: true }).click()
  const moved = await backup(page); expect(moved.layout).not.toEqual(doc.layout)
  await page.getByLabel('撤销', { exact: true }).click(); expect((await backup(page)).layout).toEqual(doc.layout)
  expect(await element!.evaluate(e => e.isConnected)).toBe(true)
  await page.getByLabel('重做', { exact: true }).click(); expect((await backup(page)).layout).toEqual(moved.layout)
  await page.reload(); await expect(page.locator('.x6-node')).toHaveCount(1); expect((await backup(page)).layout).toEqual(moved.layout)
})

test('selection has no green boxes and blank dragging pans without a selection mode button', async ({ page }) => {
  const doc = fixture(2); await importDocument(page, doc)
  await expect(page.getByRole('button', { name: '拖动画布', exact: true })).toHaveCount(0)
  await node(page, doc.entities[0].id).click()
  await node(page, doc.entities[1].id).click({ modifiers: ['Shift'] })
  await expect(page.locator('.selection-toolbar')).toContainText('已选择 2 个节点')
  expect(await page.locator('.x6-widget-selection-box,.x6-widget-selection-inner').evaluateAll(elements => elements.some(e => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0))).toBe(false)
  await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v'); await expect(page.locator('.x6-node')).toHaveCount(4)
  await page.getByLabel('撤销', { exact: true }).click(); await expect(page.locator('.x6-node')).toHaveCount(2)
  const host = await page.getByTestId('er-canvas').boundingBox(), matrix = await page.locator('.x6-graph-svg-viewport').getAttribute('transform')
  const x = host!.x + 35, y = host!.y + host!.height - 80
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 100, y - 45, { steps: 12 })
  await expect(page.locator('.x6-widget-selection-rubberband')).toHaveCount(0)
  await page.mouse.up()
  await expect(page.locator('.x6-graph-svg-viewport')).not.toHaveAttribute('transform', matrix!)
  expect((await backup(page)).layout).toEqual(doc.layout)
  await page.screenshot({ path: 'docs/evidence/canvas-without-selection-boxes.png', fullPage: true })
})

test('alignment guides are dashed during an actual node drag', async ({ page }) => {
  const doc = fixture(2); await importDocument(page, doc)
  await node(page, doc.entities[0].id).click(); await node(page, doc.entities[1].id).click({ modifiers: ['Shift'] })
  const first = await node(page, doc.entities[0].id).boundingBox(), second = await node(page, doc.entities[1].id).boundingBox()
  const x = first!.x + first!.width / 2, y = first!.y + first!.height / 2
  await page.mouse.move(x, y); await page.mouse.down()
  await page.mouse.move(second!.x + second!.width / 2 + 1, y + 35, { steps: 18 })
  const guide = page.locator('.x6-widget-snapline-vertical')
  await expect.poll(() => guide.getAttribute('display')).not.toBe('none')
  expect(await guide.evaluate(e => getComputedStyle(e).strokeDasharray)).not.toBe('none')
  expect((await node(page, doc.entities[1].id).boundingBox())!.x).toBeCloseTo(second!.x, 4)
  await page.screenshot({ path: 'docs/evidence/dashed-alignment-guides.png', fullPage: true })
  await page.mouse.up()
})

test('30-table canvas moves an entity with its attributes without rebuilding the graph', async ({ page }) => {
  const sql = Array.from({ length: 30 }, (_, i) => `CREATE TABLE table_${i}(id INT PRIMARY KEY,${Array.from({ length: 19 }, (_, f) => `field_${f} VARCHAR(100)`).join(',')}${i ? `,FOREIGN KEY(field_0) REFERENCES table_${i - 1}(id)` : ''}) COMMENT '复杂表${i}';`).join('\n')
  const doc = parseSql(sql); doc.title = '复杂画布拖动验收'
  await page.goto('/'); await expect(page.locator('.x6-node')).toHaveCount(11)
  await page.locator('input[type=file]').nth(1).setInputFiles({ name: 'large.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) })
  await page.locator('.el-message-box').getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.locator('.x6-node')).toHaveCount(659)
  await page.getByRole('button', { name: '实体与关系', exact: true }).click()
  await page.locator('.entity-card-heading>button').filter({ hasText: '复杂表0' }).click()
  const entity = doc.entities[0], target = node(page, entity.id), originalElement = await target.elementHandle(), box = await target.boundingBox(), start = performance.now()
  const x = box!.x + box!.width / 2, y = box!.y + box!.height / 2
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 81, y + 39, { steps: 24 }); await page.mouse.up()
  const moved = await backup(page), dx = moved.layout[entity.id].x - doc.layout[entity.id].x, dy = moved.layout[entity.id].y - doc.layout[entity.id].y
  expect(dx).toBeGreaterThan(0); expect(dy).toBeGreaterThan(0)
  for (const field of entity.fields) { expect(moved.layout[field.id].x - doc.layout[field.id].x).toBeCloseTo(dx); expect(moved.layout[field.id].y - doc.layout[field.id].y).toBeCloseTo(dy) }
  expect(await originalElement!.evaluate(e => e.isConnected)).toBe(true)
  await expect(page.locator('.x6-node')).toHaveCount(659)
  await writeFile('.runtime/large-canvas-drag.json', JSON.stringify({ nodes: 659, pointerSteps: 24, millisecondsIncludingBackup: Math.round(performance.now() - start), retainedNodeElements: true, movedAttributes: 20 }, null, 2))
})
