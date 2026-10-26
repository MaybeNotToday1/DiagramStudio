import { test, expect } from '@playwright/test'
import { writeFile, readFile } from 'node:fs/promises'
import { parseSql } from '../../src/modules/er/domain/sql'
import { sampleSql } from '../../src/modules/er/domain/sample'
import { PDFDocument } from 'pdf-lib'

test('project import restores layout/style exactly, history restores content and corrupt import preserves graph', async ({ page }) => {
  const doc = parseSql(sampleSql); doc.title = '恢复验收'; doc.style.entityFill = '#e5f1ec'; doc.entities[0].label = '同名实体'; doc.entities[1].label = '同名实体'
  doc.layout[doc.entities[0].id] = { x: -900, y: 1400 }
  await page.goto('/'); await expect(page.locator('.x6-node')).toHaveCount(11)
  const upload = page.locator('input[type=file]').nth(1)
  await upload.setInputFiles({ name: 'test.diagram.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) })
  await page.locator('.el-message-box').getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.getByLabel('项目名称')).toHaveValue(doc.title)
  await expect(page.locator('.save-state')).toContainText('已保存')
  await page.reload(); await expect(page.getByLabel('项目名称')).toHaveValue(doc.title)
  const event = page.waitForEvent('download'); await page.getByRole('button', { name: '项目备份' }).click()
  await (await event).saveAs('.runtime/restored.diagram.json'); expect(JSON.parse(await readFile('.runtime/restored.diagram.json', 'utf8'))).toEqual(doc)
  await upload.setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"schemaVersion":999}') })
  await expect(page.locator('.el-message--error')).toContainText('版本'); await expect(page.locator('.x6-node')).toHaveCount(11)
  await page.getByRole('button', { name: '＋ 新建', exact: true }).click()
  await page.locator('.el-message-box').getByRole('button', { name: '确认', exact: true }).click(); await expect(page.locator('.x6-node')).toHaveCount(0)
  await page.getByRole('button', { name: /恢复记录/ }).click()
  const checkpoint = page.locator('.restore-card').filter({ hasText: '新建项目前' })
  await checkpoint.getByRole('button', { name: '恢复', exact: true }).click()
  await expect(page.locator('.x6-node')).toHaveCount(11); await expect(page.getByLabel('项目名称')).toHaveValue(doc.title)
})

test('30 tables / 600 fields: records real browser loading, layout, SVG and PDF costs', async ({ page, request }) => {
  test.setTimeout(120000)
  const sql = Array.from({ length: 30 }, (_, i) => `CREATE TABLE table_${i}(id INT PRIMARY KEY,${Array.from({ length: 19 }, (_, f) => `field_${f} VARCHAR(100) COMMENT '字段${f}'`).join(',')}${i ? `,FOREIGN KEY(field_0) REFERENCES table_${i - 1}(id)` : ''}) COMMENT '复杂样本表${i}';`).join('\n')
  const start = performance.now(), doc = parseSql(sql), parsedAt = performance.now()
  doc.title = '30表复杂验收样本'
  await page.goto('/'); await expect(page.locator('.x6-node')).toHaveCount(11)
  const loadingAt = performance.now()
  await page.locator('input[type=file]').nth(1).setInputFiles({ name: 'stress.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) })
  await page.locator('.el-message-box').getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.locator('.x6-node')).toHaveCount(659, { timeout: 30000 }); const loadedAt = performance.now()
  const layoutStart = performance.now()
  await page.getByRole('button', { name: /美化排版/ }).click()
  await expect(page.locator('.el-message--success').filter({ hasText: '排版完成' })).toBeVisible({ timeout: 30000 })
  const layoutAt = performance.now(), backupEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: '项目备份' }).click(); await (await backupEvent).saveAs('.runtime/stress.diagram.json')
  const laidOut = JSON.parse(await readFile('.runtime/stress.diagram.json', 'utf8'))
  await page.getByRole('button', { name: '↓ 导出', exact: true }).click(); await page.getByRole('button', { name: /^SVG / }).click()
  const svgAt = performance.now(), downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: '导出文件', exact: true }).click()
  await (await downloaded).saveAs('.runtime/stress.svg'); const svgDone = performance.now()
  const text = await readFile('.runtime/stress.svg', 'utf8'); expect(text).toContain('复杂样本表29'); expect(text).toContain('字段18')
  const pdfAt = performance.now(), response = await request.post('/api/v1/export-jobs', { headers: { 'X-Diagram-Request': '1' }, data: { requestId: crypto.randomUUID(), document: laidOut, paper: 'A3', orientation: 'landscape', paginate: false, padding: 40 } })
  expect(response.status()).toBe(202); const job = await response.json()
  await expect.poll(async () => (await (await request.get(`/api/v1/export-jobs/${job.id}`)).json()).state, { timeout: 60000 }).toBe('SUCCEEDED')
  const result = await request.get(`/api/v1/export-jobs/${job.id}/download`), bytes = await result.body(); const pdf = await PDFDocument.load(bytes); expect(pdf.getPageCount()).toBe(1)
  await writeFile('.runtime/stress.pdf', bytes)
  const metrics = { tables: 30, fields: 600, relationships: 29, visibleNodes: 659, parseMs: Math.round(parsedAt - start), browserLayoutMs: Math.round(layoutAt - layoutStart), browserImportRenderMs: Math.round(loadedAt - loadingAt), svgDownloadMs: Math.round(svgDone - svgAt), svgBytes: Buffer.byteLength(text), pdfTaskDownloadMs: Math.round(performance.now() - pdfAt), pdfBytes: bytes.length }
  await writeFile('.runtime/performance.json', JSON.stringify(metrics, null, 2)); console.info('Measured acceptance costs:', metrics)
})
