import { test, expect, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createCanvas } from '@napi-rs/canvas'
import { visibleDocument, type ErDocument } from '../../src/modules/er/domain/model'
import { sceneBounds, sceneFor } from '../../src/modules/er/domain/scene'
import { parseSql } from '../../src/modules/er/domain/sql'
import { sampleSql } from '../../src/modules/er/domain/sample'

test.use({ actionTimeout: 10000 })
async function ready(page: Page) { await page.goto('/'); await expect(page.locator('.x6-node')).toHaveCount(11) }
async function backup(page: Page): Promise<ErDocument> {
  const event = page.waitForEvent('download'); await page.getByRole('button', { name: '项目备份' }).click()
  return JSON.parse(await readFile((await (await event).path())!, 'utf8'))
}
async function scope(page: Page) {
  await page.getByRole('button', { name: '显示与导出选项', exact: true }).click()
  await page.getByRole('menuitem', { name: '指定显示实体', exact: true }).click()
  return page.getByRole('dialog', { name: '选择显示实体', exact: true })
}
async function generate(page: Page, sql: string) {
  await page.getByLabel('SQL 建表语句', { exact: true }).fill(sql); await page.getByRole('button', { name: '生成 ER 图' }).click()
  await page.locator('.el-message-box').getByRole('button', { name: '确认', exact: true }).click()
}

test('entity selector supports cancel/invert/all; canvas, SVG/PNG/Draw.io/PDF and ZIP use the chosen scope', async ({ page }) => {
  test.setTimeout(120000)
  await ready(page); const original = await backup(page)
  let dialog = await scope(page)
  await dialog.getByRole('checkbox', { name: '全选', exact: true }).locator('xpath=ancestor::label').click()
  await expect(dialog.getByRole('button', { name: '应用显示范围' })).toBeDisabled()
  await dialog.getByRole('button', { name: '反选', exact: true }).click()
  await expect(dialog.getByRole('checkbox', { name: '全选', exact: true })).toBeChecked()
  await dialog.getByRole('button', { name: '取消', exact: true }).click(); expect(await backup(page)).toEqual(original)
  dialog = await scope(page); await dialog.getByRole('checkbox', { name: '学生（t_student）', exact: true }).locator('xpath=ancestor::label').click()
  await page.screenshot({ path: 'docs/evidence/entity-visibility.png', fullPage: true })
  await dialog.getByRole('button', { name: '应用显示范围' }).click()
  await expect(page.locator('.x6-node')).toHaveCount(4); await expect(page.locator('.scope-status')).toContainText('1 / 2')
  const filtered = await backup(page); expect(filtered.entities).toEqual(original.entities); expect(filtered.layout).toEqual(original.layout)
  await page.reload(); await expect(page.locator('.x6-node')).toHaveCount(4)
  await page.getByRole('button', { name: '↓ 导出', exact: true }).click()
  for (const format of ['SVG', 'PNG', 'Draw.io']) {
    await page.getByRole('button', { name: new RegExp(`^${format.replace('.', '\\.')} `) }).click()
    const event = page.waitForEvent('download'); await page.getByRole('button', { name: '导出文件', exact: true }).click()
    const file = await event, bytes = await readFile((await file.path())!)
    await file.saveAs(`.runtime/filtered.${format === 'Draw.io' ? 'drawio' : format.toLowerCase()}`)
    if (format === 'Draw.io') { expect(bytes.toString()).not.toContain('value="学生"'); expect(bytes.toString()).not.toContain('value="关联"'); expect(bytes.toString().match(/vertex="1"/g)).toHaveLength(4) }
    else if (format === 'SVG') { expect(bytes.toString()).not.toContain('>学生</tspan>'); expect(bytes.toString()).not.toContain('>关联</tspan>') }
    else {
      expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      const dimensions = await page.evaluate(async data => { const image = await createImageBitmap(new Blob([new Uint8Array(data)], { type: 'image/png' })); return { width: image.width, height: image.height } }, Array.from(bytes))
      const bounds = sceneBounds(sceneFor(visibleDocument(filtered)), 40)
      expect(dimensions).toEqual({ width: Math.ceil(bounds.width * 2), height: Math.ceil(bounds.height * 2) })
    }
  }
  await page.getByRole('button', { name: /^PNG / }).click(); await page.getByText('一键单独导出每个实体（ZIP）', { exact: true }).click()
  const event = page.waitForEvent('download'); await page.getByRole('button', { name: '导出文件', exact: true }).click()
  const entries = unzipSync(new Uint8Array(await readFile((await (await event).path())!)))
  expect(Object.keys(entries)).toHaveLength(1); expect(Object.keys(entries)[0]).toContain('班级')
  await page.getByRole('button', { name: /^PDF / }).click()
  const request = page.waitForRequest(r => r.url().includes('/api/v1/export-jobs') && r.method() === 'POST')
  await page.getByRole('button', { name: '生成 PDF', exact: true }).click()
  const body = (await request).postDataJSON(); expect(body.document.entities).toHaveLength(1); expect(body.document.relationships).toEqual([]); expect(body.document.sql).toBe('')
  await expect(page.getByRole('status')).toContainText('PDF 已生成', { timeout: 60000 })
  const pdfEvent = page.waitForEvent('download'); await page.getByRole('link', { name: '下载 PDF ↓' }).click()
  const pdfFile = await pdfEvent; await pdfFile.saveAs('.runtime/filtered.pdf')
  const loading = getDocument({ data: new Uint8Array(await readFile((await pdfFile.path())!)), useSystemFonts: false }), pdf = await loading.promise, sheet = await pdf.getPage(1)
  const text = (await sheet.getTextContent()).items.map((i: any) => i.str || '').join('').normalize('NFKC')
  expect(text).toContain('班级'); expect(text).not.toContain('学生'); expect(text).not.toContain('关联')
  const viewport = sheet.getViewport({ scale: 1.2 }), image = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
  await sheet.render({ canvas: image as any, canvasContext: image.getContext('2d') as any, viewport }).promise
  await writeFile('docs/evidence/filtered-pdf.png', image.toBuffer('image/png')); await loading.destroy()
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '显示全部', exact: true }).click(); await expect(page.locator('.x6-node')).toHaveCount(11)
})

test('layout templates visibly differ, keep entity groups clear and restore the initial SQL coordinates with undo', async ({ page }) => {
  await ready(page); const original = await backup(page)
  await page.getByRole('button', { name: /美化排版/ }).click(); await expect(page.getByRole('button', { name: /美化排版/ })).toBeEnabled()
  const horizontal = await backup(page); expect(horizontal.layout).not.toEqual(original.layout); expect(horizontal.initialLayout).toEqual(original.initialLayout)
  await page.screenshot({ path: 'docs/evidence/layout-horizontal.png', fullPage: true })
  await expect(page.getByRole('combobox', { name: '美化布局方案' })).toHaveCount(0)
  await expect(page.locator('.layout-direction')).toContainText('下次：纵向')
  await page.getByRole('button', { name: /美化排版/ }).click(); await expect(page.getByRole('button', { name: /美化排版/ })).toBeEnabled()
  const vertical = await backup(page); expect(vertical.layout).not.toEqual(horizontal.layout)
  await page.screenshot({ path: 'docs/evidence/layout-vertical.png', fullPage: true })
  await expect(page.locator('.layout-direction')).toContainText('下次：横向')
  await page.getByRole('button', { name: /美化排版/ }).click(); await expect(page.getByRole('button', { name: /美化排版/ })).toBeEnabled()
  expect((await backup(page)).layout).toEqual(horizontal.layout)
  await page.getByRole('button', { name: '默认布局', exact: true }).click()
  const restored = await backup(page); expect(restored.layout).toEqual(original.initialLayout); expect(restored.style).toEqual(original.style)
  await page.getByLabel('撤销', { exact: true }).click(); expect((await backup(page)).layout).toEqual(horizontal.layout)
  await page.reload(); await expect(page.locator('.x6-node')).toHaveCount(11); expect((await backup(page)).layout).toEqual(horizontal.layout)
})

test('SQL help matches the parser; history records success only and loading it preserves the current graph', async ({ page }) => {
  await ready(page); await page.getByRole('button', { name: 'ⓘ SQL 格式说明', exact: true }).click()
  const help = page.getByRole('dialog', { name: 'SQL 格式说明', exact: true })
  await expect(help).toContainText('复合主键'); await expect(help).toContainText('CREATE TABLE AS / LIKE')
  await help.getByRole('tab', { name: '示例 SQL' }).click(); expect(parseSql(await help.locator('pre').innerText()).entities).toHaveLength(2)
  await page.screenshot({ path: 'docs/evidence/sql-format-help.png', fullPage: true })
  await help.getByRole('button', { name: '关闭', exact: true }).click()
  const first = sampleSql.replace('班级名称', '班级标题')
  await generate(page, first); await expect(page.locator('.x6-node')).toHaveCount(11)
  await page.getByLabel('SQL 建表语句', { exact: true }).fill('CREATE TABLE broken(,);'); await page.getByRole('button', { name: '生成 ER 图' }).click()
  await expect(page.locator('.parse-error')).toContainText('第 1 行')
  await page.getByRole('button', { name: '◷ SQL 历史', exact: true }).click()
  const history = page.getByRole('dialog', { name: 'SQL 生成历史' })
  await expect(history.locator('.sql-history-card')).toHaveCount(1)
  await history.getByRole('button', { name: '查看 SQL', exact: true }).click(); await expect(history.locator('pre')).toHaveText(first)
  const before = await backupViaDrawer(page)
  await history.getByRole('button', { name: '载入 SQL', exact: true }).click(); await expect(page.getByLabel('SQL 建表语句')).toHaveValue(first)
  const after = await backup(page); expect(after.layout).toEqual(before.layout); expect(after.entities).toEqual(before.entities)
  await page.reload(); await expect(page.locator('.x6-node')).toHaveCount(11)
  await page.getByRole('button', { name: '◷ SQL 历史', exact: true }).click(); await expect(page.locator('.sql-history-card')).toHaveCount(1)
})
async function backupViaDrawer(page: Page): Promise<ErDocument> {
  return await page.evaluate(async () => {
    const connection = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('diagram-studio'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    return await new Promise((resolve, reject) => { const request = connection.transaction('workspace').objectStore('workspace').get('current'); request.onsuccess = () => resolve(request.result.document); request.onerror = () => reject(request.error) })
  })
}

test('attribute names toggle without losing comments; missing comments stay unchanged in canvas and exported SVG', async ({ page }) => {
  await ready(page)
  const doc = parseSql("CREATE TABLE person(id INT PRIMARY KEY, name VARCHAR(50) COMMENT '姓名');"), field = doc.entities[0].fields[1]
  await page.locator('input[type=file]').nth(1).setInputFiles({ name: 'names.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) })
  await page.locator('.el-message-box').getByRole('button', { name: '确认', exact: true }).click(); await expect(page.locator('.x6-node')).toHaveCount(3)
  const target = page.locator(`.x6-node[data-cell-id="${field.id}"]`)
  await expect(target).toContainText('姓名')
  await page.getByRole('button', { name: '属性名：注释', exact: true }).click(); await expect(target).toContainText('name')
  const raw = await backup(page); expect(raw.entities).toEqual(doc.entities); expect(raw.layout).toEqual(doc.layout)
  await page.getByRole('button', { name: '↓ 导出', exact: true }).click(); await page.getByRole('button', { name: /^SVG / }).click()
  const event = page.waitForEvent('download'); await page.getByRole('button', { name: '导出文件', exact: true }).click()
  const svg = await readFile((await (await event).path())!, 'utf8'); expect(svg).toContain('>name</tspan>'); expect(svg).not.toContain('>姓名</tspan>')
  await page.getByRole('button', { name: '关闭', exact: true }).click(); await page.reload(); await expect(target).toContainText('name')
  await page.getByRole('button', { name: '属性名：原名', exact: true }).click(); await expect(target).toContainText('姓名')
  await expect(page.locator(`.x6-node[data-cell-id="${doc.entities[0].fields[0].id}"]`)).toContainText('id')
})

test('permanent reset warns, supports cancellation and clears stored history/checkpoints/undo/clipboard even after reload', async ({ page }) => {
  await ready(page); await generate(page, sampleSql.replace('班级名称', '旧历史名称'))
  await page.getByRole('button', { name: /恢复记录/ }).click(); await page.getByRole('button', { name: '＋ 保存当前恢复点', exact: true }).click()
  await page.getByRole('dialog', { name: '恢复记录' }).getByRole('button', { name: 'Close this dialog' }).click()
  await page.locator('.x6-node').first().click(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c')
  const before = await backup(page)
  await page.getByRole('button', { name: '重置工作区', exact: true }).click()
  const warning = page.locator('.el-message-box'); await expect(warning).toContainText('永久清空'); await expect(warning).toContainText('无法通过本网页恢复')
  await warning.getByRole('button', { name: '取消', exact: true }).click(); expect(await backup(page)).toEqual(before)
  await page.getByRole('button', { name: '重置工作区', exact: true }).click(); await warning.getByRole('button', { name: '确认重置并清空' }).click()
  await expect(page.getByLabel('项目名称')).toHaveValue('班级与学生关系图'); await expect(page.getByLabel('SQL 建表语句')).toHaveValue(sampleSql)
  await expect(page.getByLabel('撤销', { exact: true })).toBeDisabled(); await expect(page.getByLabel('重做', { exact: true })).toBeDisabled()
  await page.keyboard.press('Control+v'); await expect(page.locator('.x6-node')).toHaveCount(11)
  await page.getByRole('button', { name: '◷ SQL 历史', exact: true }).click(); await expect(page.locator('.sql-history-card')).toHaveCount(0)
  await page.getByRole('dialog', { name: 'SQL 生成历史' }).getByRole('button', { name: 'Close this dialog' }).click()
  await page.getByRole('button', { name: /恢复记录/ }).click(); await expect(page.locator('.restore-card')).toHaveCount(0)
  await page.getByRole('dialog', { name: '恢复记录' }).getByRole('button', { name: 'Close this dialog' }).click()
  const stored = await page.evaluate(async () => {
    const connection = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('diagram-studio'); request.onsuccess = () => resolve(request.result) })
    return await new Promise<any>(resolve => { const request = connection.transaction('workspace').objectStore('workspace').get('current'); request.onsuccess = () => resolve(request.result) })
  })
  expect(stored.sqlHistory).toEqual([]); expect(stored.restorePoints).toEqual([]); expect(stored.document.sql).toBe(sampleSql)
  await page.reload(); await expect(page.getByLabel('SQL 建表语句')).toHaveValue(sampleSql); await expect(page.getByLabel('撤销', { exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '◷ SQL 历史', exact: true }).click(); await expect(page.locator('.sql-history-card')).toHaveCount(0)
})
