import { test, expect, request as requests } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { PDFDocument } from 'pdf-lib'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { parseSql } from '../../src/modules/er/domain/sql'
import { sampleSql } from '../../src/modules/er/domain/sample'

test('ER-4: browser submits snapshot, downloads Chinese PDF, and isolates anonymous sessions', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('.x6-node')).toHaveCount(11)
  await page.getByRole('button', { name: '↓ 导出', exact: true }).click()
  await page.getByRole('button', { name: /^PDF / }).click()
  const submitted = page.waitForResponse(r => r.url().endsWith('/api/v1/export-jobs') && r.request().method() === 'POST')
  await page.getByRole('button', { name: '生成 PDF', exact: true }).click()
  const created = await submitted; expect(created.status()).toBe(202); const job = await created.json()
  const cookie = (await page.context().cookies()).find(c => c.name === 'diagram_session')
  expect(cookie?.httpOnly).toBe(true); expect(cookie?.sameSite).toBe('Lax')
  await expect(page.getByRole('status')).toContainText('PDF 已生成', { timeout: 60000 })
  const refreshed = await page.request.get(`/api/v1/export-jobs/${job.id}`)
  expect((refreshed.headers()['set-cookie'] || '').includes('Max-Age=86400')).toBe(true)
  const outsider = await requests.newContext({ baseURL: 'http://127.0.0.1:5173' })
  expect((await outsider.get(`/api/v1/export-jobs/${job.id}`)).status()).toBe(404)
  expect((await outsider.get(`/api/v1/export-jobs/${job.id}/download`)).status()).toBe(404)
  expect((await outsider.post('/api/v1/export-jobs', { data: {} })).status()).toBe(403)
  expect((await outsider.post('/api/v1/export-jobs', { headers: { 'X-Diagram-Request': '1' }, data: {} })).status()).toBe(400)
  expect((await outsider.post('/api/v1/export-jobs', { headers: { 'X-Diagram-Request': '1', Origin: 'https://unrelated.example' }, data: {} })).status()).toBe(403)
  await outsider.dispose()
  const downloaded = page.waitForEvent('download'); await page.getByRole('link', { name: '下载 PDF ↓' }).click()
  const file = await downloaded; await file.saveAs('.runtime/acceptance.pdf'); const bytes = await readFile('.runtime/acceptance.pdf')
  const pdf = await PDFDocument.load(bytes); expect(pdf.getPageCount()).toBe(1)
  expect(Math.abs(pdf.getPage(0).getWidth() - 297 * 72 / 25.4)).toBeLessThan(1)
  expect(Math.abs(pdf.getPage(0).getHeight() - 210 * 72 / 25.4)).toBeLessThan(1)
  const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }), parsed = await loading.promise
  const text = (await (await parsed.getPage(1)).getTextContent()).items.map((item: any) => item.str || '').join('')
  const normalized = text.normalize('NFKC')
  expect(normalized).toContain('班级'); expect(normalized).toContain('学生'); expect(normalized).toContain('学生ID')
  await writeFile('.runtime/pdf-verification.json', JSON.stringify({ pages: pdf.getPageCount(), bytes: bytes.length, text }, null, 2)); await loading.destroy()
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '导出图表' })).toBeHidden()
  await page.screenshot({ path: '.runtime/er-workbench.png', fullPage: true })
})

test('PDF paper settings, pagination, retry idempotency and unsupported snapshot failures', async ({ request }) => {
  const doc = parseSql(sampleSql)
  const create = async (settings: Record<string, unknown>) => {
    const result = await request.post('/api/v1/export-jobs', { headers: { 'X-Diagram-Request': '1' }, data: { requestId: crypto.randomUUID(), document: doc, paper: 'A3', orientation: 'portrait', paginate: true, padding: 40, ...settings } })
    expect(result.status()).toBe(202); return await result.json()
  }
  const requestId = crypto.randomUUID(), job = await create({ requestId })
  expect((await create({ requestId })).id).toBe(job.id)
  await expect.poll(async () => (await (await request.get(`/api/v1/export-jobs/${job.id}`)).json()).state, { timeout: 60000 }).toBe('SUCCEEDED')
  const result = await request.get(`/api/v1/export-jobs/${job.id}/download`), pdf = await PDFDocument.load(await result.body())
  expect(pdf.getPageCount()).toBeGreaterThan(1); expect(pdf.getPage(0).getWidth()).toBeCloseTo(841.92, 0); expect(pdf.getPage(0).getHeight()).toBeCloseTo(1190.88, 0)
  await writeFile('.runtime/acceptance-a3-paged.pdf', await result.body())
  const broken = await create({ document: { ...doc, schemaVersion: 1, relationships: [{ id: 'broken', from: 'missing' }] } })
  await expect.poll(async () => (await (await request.get(`/api/v1/export-jobs/${broken.id}`)).json()).state, { timeout: 30000 }).toBe('FAILED')
  expect((await request.get(`/api/v1/export-jobs/${broken.id}/download`)).status()).toBe(409)
})
