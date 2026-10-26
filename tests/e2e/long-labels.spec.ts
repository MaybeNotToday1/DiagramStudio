import { test, expect } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { parseSql } from '../../src/modules/er/domain/sql'
import { sampleSql } from '../../src/modules/er/domain/sample'
import { defaultLayout } from '../../src/modules/er/domain/scene'

test('long Chinese labels, duplicate display names and negative coordinates export intact', async ({ page }) => {
  const doc = parseSql(sampleSql), title = '包含中文与特殊字符的长实体名称'.repeat(4), field = '长属性名称与主键下划线完整性'.repeat(5) + ' & <测试>'
  doc.entities[0].label = title; doc.entities[1].label = title; doc.entities[0].fields[0].label = field
  doc.layout = defaultLayout(doc)
  for (const [id, point] of Object.entries(doc.layout)) doc.layout[id] = { x: point.x - 1800, y: point.y - 1300 }
  await page.goto('/'); await expect(page.locator('.x6-node')).toHaveCount(11)
  await page.locator('input[type=file]').nth(1).setInputFiles({ name: 'long.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) })
  await page.locator('.el-message-box').getByRole('button', { name: '确认', exact: true }).click(); await expect(page.locator('.x6-node')).toHaveCount(11)
  await page.getByRole('button', { name: '↓ 导出', exact: true }).click(); await page.getByRole('button', { name: /^SVG / }).click()
  const event = page.waitForEvent('download'); await page.getByRole('button', { name: '导出文件', exact: true }).click(); await (await event).saveAs('.runtime/long-labels.svg')
  const svg = await readFile('.runtime/long-labels.svg', 'utf8')
  const result = await page.evaluate(svg => {
    const xml = new DOMParser().parseFromString(svg, 'image/svg+xml')
    return { error: !!xml.querySelector('parsererror'), text: [...xml.querySelectorAll('text')].map(n => n.textContent), negative: xml.documentElement.getAttribute('viewBox')?.startsWith('-'), underline: xml.querySelectorAll('[text-decoration="underline"]').length }
  }, svg)
  expect(result.error).toBe(false); expect(result.negative).toBe(true); expect(result.text.filter(t => t === title)).toHaveLength(2); expect(result.text).toContain(field); expect(result.underline).toBeGreaterThan(0)
  await page.getByRole('button', { name: /^PNG / }).click(); const png = page.waitForEvent('download'); await page.getByRole('button', { name: '导出文件', exact: true }).click(); await (await png).saveAs('.runtime/long-labels.png')
  const bytes = await readFile('.runtime/long-labels.png'); expect(bytes.length).toBeGreaterThan(10000)
  await writeFile('.runtime/long-labels-verification.json', JSON.stringify({ duplicateLabels: true, longLabelCharacters: field.length, negativeCoordinates: true, svgXmlValid: !result.error, primaryUnderline: result.underline > 0, pngBytes: bytes.length }, null, 2))
})
