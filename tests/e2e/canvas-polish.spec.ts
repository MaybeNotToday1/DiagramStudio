import { test, expect, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { unzipSync } from 'fflate'
import { blankDocument, uid, type ErDocument } from '../../src/modules/er/domain/model'
import { sceneBounds, sceneFor } from '../../src/modules/er/domain/scene'
import { entityDocument } from '../../src/modules/er/domain/export'

test.use({ actionTimeout: 10000 })
const zoom = async (page: Page) => parseInt(await page.getByTestId('zoom-value').innerText())
const frame = (page: Page) => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
async function smallest(page: Page) {
  const button = page.getByRole('button', { name: '缩小画布', exact: true })
  for (let i = 0; i < 30 && await button.isEnabled(); i++) await button.click()
  await expect(button).toBeDisabled()
}
async function chooseQuality(page: Page, label: string) {
  await page.getByRole('combobox', { name: '图片清晰度', exact: true }).locator('xpath=ancestor::div[contains(@class,"el-select__wrapper")]').click()
  await page.getByRole('option', { name: label, exact: true }).click()
}

test('FAQ opens at most one answer with pointer and keyboard and allows closing it', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('.x6-node')).toHaveCount(11)
  const questions = page.locator('.help-faqs details')
  await expect(page.locator('.help-faqs details[open]')).toHaveCount(1)
  for (const i of [1, 4, 0, 5, 2]) {
    await questions.nth(i).locator('summary').click()
    await expect(questions.nth(i)).toHaveAttribute('open', '')
    await expect(page.locator('.help-faqs details[open]')).toHaveCount(1)
  }
  await questions.nth(3).locator('summary').focus(); await page.keyboard.press('Enter')
  await expect(questions.nth(3)).toHaveAttribute('open', ''); await expect(questions.nth(2)).not.toHaveAttribute('open', '')
  await page.keyboard.press('Enter'); await expect(page.locator('.help-faqs details[open]')).toHaveCount(0)
})

test('button and wheel zoom stop at 20%; sparse grid keeps the default canvas white and custom backgrounds remain effective', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('.x6-node')).toHaveCount(11)
  await smallest(page); expect(await zoom(page)).toBe(20)
  const canvas = page.getByTestId('er-canvas'), rect = (await canvas.boundingBox())!
  await page.mouse.move(rect.x + 60, rect.y + 100)
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 350); await frame(page) }
  expect(await zoom(page)).toBe(20); expect(await page.evaluate(() => scrollY)).toBe(0)
  await expect(page.locator('.x6-graph-grid')).toHaveCSS('background-image', 'none')
  const pixel = async () => {
    const image = await loadImage(await canvas.screenshot()), surface = createCanvas(image.width, image.height), context = surface.getContext('2d')
    context.drawImage(image, 0, 0); return [...context.getImageData(8, 80, 1, 1).data]
  }
  expect(await pixel()).toEqual([255, 255, 255, 255])
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '放大画布', exact: true }).click()
  await expect(page.locator('.x6-graph-grid')).not.toHaveCSS('background-image', 'none')
  await smallest(page)
  await page.getByRole('button', { name: '⚙ 样式', exact: true }).click()
  await page.getByLabel('画布背景', { exact: true }).fill('#dfefff')
  await page.getByRole('button', { name: '应用样式', exact: true }).click(); await expect(page.getByRole('dialog', { name: '图表样式', exact: true })).not.toBeVisible()
  expect(await pixel()).toEqual([223, 239, 255, 255])
  await page.getByRole('button', { name: '适应画布', exact: true }).click(); expect(await zoom(page)).toBeGreaterThan(20)
})

test('a very wide diagram still fits completely and cannot be manually reduced below its fitted view', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('.x6-node')).toHaveCount(11)
  const doc = blankDocument(); doc.title = '大图缩放边界'
  for (let i = 0; i < 2; i++) { const id = uid(); doc.entities.push({ id, name: `wide_${i}`, label: `实体${i}`, fields: [] }); doc.layout[id] = { x: i * 18000, y: 0 } }
  await page.locator('input[type=file]').nth(1).setInputFiles({ name: 'wide.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) })
  await page.locator('.el-message-box').getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.locator('.el-overlay.is-message-box')).not.toBeVisible(); await expect(page.locator('.x6-node')).toHaveCount(2)
  await page.getByRole('button', { name: '适应画布', exact: true }).click()
  const fitted = await zoom(page); expect(fitted).toBeGreaterThan(0); expect(fitted).toBeLessThan(20)
  const host = (await page.getByTestId('er-canvas').boundingBox())!
  for (const entity of doc.entities) {
    const node = (await page.locator(`.x6-node[data-cell-id="${entity.id}"]`).boundingBox())!
    expect(node.x).toBeGreaterThanOrEqual(host.x); expect(node.x + node.width).toBeLessThanOrEqual(host.x + host.width)
  }
  await page.getByRole('button', { name: '放大画布', exact: true }).click(); await smallest(page)
  expect(await zoom(page)).toBe(fitted)
  await page.mouse.move(host.x + 60, host.y + 100); await page.mouse.wheel(0, 500); await frame(page)
  expect(await zoom(page)).toBe(fitted); expect(await page.evaluate(() => scrollY)).toBe(0)
})

test('standard and high quality PNG/JPEG and individual ZIP files use the selected resolution and user styling', async ({ page }) => {
  test.setTimeout(120000)
  await page.goto('/'); await expect(page.locator('.x6-node')).toHaveCount(11)
  await page.getByRole('button', { name: '⚙ 样式', exact: true }).click()
  await page.getByLabel('文字颜色', { exact: true }).fill('#9d174d')
  await page.getByRole('button', { name: '应用样式', exact: true }).click(); await expect(page.getByRole('dialog', { name: '图表样式', exact: true })).not.toBeVisible()
  await smallest(page)
  const backup = page.waitForEvent('download'); await page.getByRole('button', { name: '项目备份' }).click()
  const doc: ErDocument = JSON.parse(await readFile((await (await backup).path())!, 'utf8')), bounds = sceneBounds(sceneFor(doc), 40)
  await page.getByRole('button', { name: '↓ 导出', exact: true }).click()
  const metrics: { format: string; ratio: number; width: number; height: number; redPixels: number }[] = []
  const inspect = async (bytes: Buffer | Uint8Array, format: string, ratio: number, width: number, height: number) => {
    const image = await loadImage(Buffer.from(bytes)), surface = createCanvas(image.width, image.height), context = surface.getContext('2d')
    expect(image.width).toBe(Math.ceil(width * ratio)); expect(image.height).toBe(Math.ceil(height * ratio))
    context.drawImage(image, 0, 0); const data = context.getImageData(0, 0, image.width, image.height).data
    let redPixels = 0
    for (let i = 0; i < data.length; i += 4) if (data[i] > 120 && data[i + 1] < 65 && data[i + 2] > 40 && data[i + 2] < 120) redPixels++
    expect(redPixels).toBeGreaterThan(50); metrics.push({ format, ratio, width: image.width, height: image.height, redPixels })
  }
  for (const format of ['PNG', 'JPEG']) {
    await page.getByRole('button', { name: new RegExp(`^${format} `) }).click()
    for (const [ratio, label] of [[1, '标清（1 倍）'], [2, '高清（2 倍）']] as const) {
      await chooseQuality(page, label)
      const event = page.waitForEvent('download', { timeout: 30000 }); await page.getByRole('button', { name: '导出文件', exact: true }).click()
      const file = await event; await file.saveAs(`.runtime/quality-${ratio}x.${format.toLowerCase()}`)
      await inspect(await readFile((await file.path())!), format, ratio, bounds.width, bounds.height)
    }
  }
  for (const format of ['PNG', 'JPEG']) {
    const [standard, high] = metrics.filter(m => m.format === format); expect(high.redPixels).toBeGreaterThan(standard.redPixels * 2)
  }
  await page.getByRole('button', { name: /^PNG / }).click(); await chooseQuality(page, '标清（1 倍）')
  await page.getByRole('checkbox', { name: '一键单独导出每个实体（ZIP）' }).locator('..').click()
  const event = page.waitForEvent('download', { timeout: 30000 }); await page.getByRole('button', { name: '导出文件', exact: true }).click()
  const archive = await event, entries = Object.values(unzipSync(await readFile((await archive.path())!)))
  expect(entries).toHaveLength(doc.entities.length)
  for (let i = 0; i < entries.length; i++) { const b = sceneBounds(sceneFor(entityDocument(doc, doc.entities[i].id)), 40); await inspect(entries[i], 'ZIP/PNG', 1, b.width, b.height) }
  await page.getByRole('button', { name: /^SVG / }).click(); await expect(page.getByRole('combobox', { name: '图片清晰度' })).toHaveCount(0)
  await writeFile('.runtime/image-quality-verification.json', JSON.stringify(metrics, null, 2))
})
