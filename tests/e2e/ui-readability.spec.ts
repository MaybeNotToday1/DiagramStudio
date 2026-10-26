import { test, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

for (const width of [1280, 1600, 1920]) test(`readable aligned controls and a wider editor at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1100 }); await page.goto('/'); await expect(page.locator('.x6-node')).toHaveCount(11)
  await expect(page.getByRole('combobox', { name: '美化布局方案' })).toHaveCount(0)
  const dimensions = await page.evaluate(() => {
    const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect()
    const editor = rect('.editor-panel'), preview = rect('.preview-panel')
    const controls = [...document.querySelectorAll<HTMLElement>('.canvas-actions>.button,.canvas-actions>.text-button,.export-split')].map(e => ({ width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height }))
    const top = [...document.querySelectorAll<HTMLElement>('.topbar-actions>button')].map(e => ({ center: e.getBoundingClientRect().y + e.getBoundingClientRect().height / 2, height: e.getBoundingClientRect().height, font: parseFloat(getComputedStyle(e).fontSize) }))
    const tools = [...document.querySelectorAll<HTMLElement>('.sql-toolbar button')].map(e => ({ height: e.getBoundingClientRect().height, font: parseFloat(getComputedStyle(e).fontSize), border: parseFloat(getComputedStyle(e).borderTopWidth), background: getComputedStyle(e).backgroundColor }))
    const arrow = rect('.export-menu-button svg'), button = rect('.export-menu-button')
    return {
      ratio: editor.width / (editor.width + preview.width + 18), editor: editor.width, preview: preview.width, controls, top, tools,
      arrowDeltaX: Math.abs(arrow.x + arrow.width / 2 - button.x - button.width / 2), arrowDeltaY: Math.abs(arrow.y + arrow.height / 2 - button.y - button.height / 2),
      footerFont: parseFloat(getComputedStyle(document.querySelector('.page-footer')!).fontSize), noteFont: parseFloat(getComputedStyle(document.querySelector('.editor-note p')!).fontSize),
      hintFont: parseFloat(getComputedStyle(document.querySelector('.canvas-hint')!).fontSize), overflow: document.documentElement.scrollWidth > innerWidth,
    }
  })
  expect(dimensions.ratio).toBeGreaterThan(.4); expect(dimensions.ratio).toBeLessThan(.45); expect(dimensions.preview).toBeGreaterThan(dimensions.editor)
  for (const control of dimensions.controls) { expect(control.height).toBeCloseTo(40, 1); expect(control.width).toBeCloseTo(100, 1) }
  const centers = dimensions.top.map(c => c.center); expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(1)
  for (const control of dimensions.top) { expect(control.height).toBeCloseTo(40, 1); expect(control.font).toBeGreaterThanOrEqual(14) }
  for (const control of dimensions.tools) { expect(control.font).toBeGreaterThanOrEqual(13); expect(control.height).toBeGreaterThanOrEqual(34); expect(control.border).toBeGreaterThan(0); expect(control.background).not.toBe('rgba(0, 0, 0, 0)') }
  expect(dimensions.arrowDeltaX).toBeLessThan(1); expect(dimensions.arrowDeltaY).toBeLessThan(1)
  expect(dimensions.footerFont).toBeGreaterThanOrEqual(13); expect(dimensions.noteFont).toBeGreaterThanOrEqual(13); expect(dimensions.hintFont).toBeGreaterThanOrEqual(12); expect(dimensions.overflow).toBe(false)
  await page.screenshot({ path: `docs/evidence/ui-${width}.png`, fullPage: true })
  await writeFile(`.runtime/ui-${width}.json`, JSON.stringify(dimensions, null, 2))
  const textarea = page.getByLabel('SQL 建表语句', { exact: true })
  await textarea.fill(Array.from({ length: 80 }, (_, i) => `-- scroll line ${i}`).join('\n'))
  await textarea.evaluate(e => { e.scrollTop = 220; e.dispatchEvent(new Event('scroll')) })
  expect(await page.locator('.line-numbers').evaluate(e => e.scrollTop)).toBeGreaterThan(150)
})
