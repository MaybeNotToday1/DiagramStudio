import { test, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

for (const [width, height] of [[1100, 700], [1280, 720], [1366, 768], [1440, 900], [1600, 900], [1600, 600], [1920, 1080], [2320, 1300]]) {
  test(`complete workbench and aligned information panels at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height }); await page.goto('/'); await expect(page.locator('.x6-node')).toHaveCount(11)
    const dimensions = await page.evaluate(() => {
      const box = (selector: string) => { const r = document.querySelector(selector)!.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height } }
      return { viewport: { width: innerWidth, height: innerHeight }, scroll: scrollY, pageWidth: document.documentElement.scrollWidth, editor: box('.editor-panel'), preview: box('.preview-panel') }
    })
    expect(dimensions.scroll).toBe(0); expect(dimensions.pageWidth).toBeLessThanOrEqual(width)
    for (const panel of [dimensions.editor, dimensions.preview]) { expect(panel.top).toBeGreaterThan(0); expect(panel.bottom).toBeLessThanOrEqual(height - 10); expect(panel.height).toBeGreaterThan(280) }
    expect(dimensions.editor.top).toBeCloseTo(dimensions.preview.top, 1); expect(dimensions.editor.bottom).toBeCloseTo(dimensions.preview.bottom, 1)
    await expect(page.getByRole('button', { name: '生成 ER 图' })).toBeInViewport()
    await expect(page.getByRole('button', { name: '适应画布', exact: true })).toBeInViewport()
    const alignment = await page.evaluate(() => {
      const box = (selector: string) => { const r = document.querySelector(selector)!.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom } }
      return { usage: box('.usage-card'), faq: box('.faq-card'), editor: box('.editor-panel'), preview: box('.preview-panel') }
    })
    expect(alignment.usage.left).toBeCloseTo(alignment.editor.left, 1); expect(alignment.usage.right).toBeCloseTo(alignment.editor.right, 1)
    expect(alignment.faq.left).toBeCloseTo(alignment.preview.left, 1); expect(alignment.faq.right).toBeCloseTo(alignment.preview.right, 1)
    expect(alignment.usage.top).toBeCloseTo(alignment.faq.top, 1); expect(alignment.usage.bottom).toBeCloseTo(alignment.faq.bottom, 1)
    await page.screenshot({ path: `docs/evidence/first-screen-${width}-${height}.png` })
    await writeFile(`.runtime/first-screen-${width}-${height}.json`, JSON.stringify({ ...dimensions, alignment }, null, 2))
  })
}

test('help is keyboard accessible and expanding answers keeps the workbench aligned', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 }); await page.goto('/'); await expect(page.locator('.x6-node')).toHaveCount(11)
  await page.getByRole('link', { name: '使用方法', exact: true }).click()
  await expect(page.locator('#usage-guide')).toBeInViewport()
  await page.getByRole('button', { name: '查看完整 SQL 规范' }).click()
  const dialog = page.getByRole('dialog', { name: 'SQL 格式说明', exact: true })
  await expect(dialog).toBeVisible(); await expect(dialog).toContainText('MySQL 建表语句')
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  const answer = page.locator('.faq-card details').nth(1)
  await answer.locator('summary').focus(); await page.keyboard.press('Enter')
  await expect(answer).toHaveAttribute('open', ''); await expect(answer.locator('p')).toBeVisible()
  await page.keyboard.press('Enter'); await expect(answer).not.toHaveAttribute('open', '')
  await page.locator('.workspace-help').screenshot({ path: 'docs/evidence/aligned-help.png' })
  await page.getByRole('link', { name: '返回工作区', exact: true }).click()
  await expect(page.locator('.editor-panel')).toBeInViewport({ ratio: 1 }); await expect(page.locator('.preview-panel')).toBeInViewport({ ratio: 1 })
  await expect(page.getByLabel('项目名称')).toHaveValue('班级与学生关系图')
})

test('short viewport keeps SQL errors, manual editing and resize inside the workbench', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 }); await page.goto('/'); await expect(page.locator('.x6-node')).toHaveCount(11)
  const input = page.getByLabel('SQL 建表语句', { exact: true })
  await input.fill('SELECT * FROM users;'); await page.getByRole('button', { name: '生成 ER 图' }).click()
  await expect(page.locator('.parse-error')).toBeVisible(); await expect(page.locator('.x6-node')).toHaveCount(11)
  await expect(page.getByRole('button', { name: '生成 ER 图' })).toBeInViewport()
  await page.getByRole('button', { name: '实体与关系', exact: true }).click()
  await expect(page.locator('.entity-card').first()).toBeVisible()
  await page.setViewportSize({ width: 1600, height: 600 })
  const geometry = await page.evaluate(() => {
    const panels = [...document.querySelectorAll('.editor-panel,.preview-panel')].map(e => e.getBoundingClientRect())
    return { bottoms: panels.map(p => p.bottom), scroll: scrollY, inputHeight: document.querySelector('.structure-list')!.clientHeight }
  })
  expect(geometry.scroll).toBe(0); expect(Math.max(...geometry.bottoms)).toBeLessThanOrEqual(590); expect(geometry.inputHeight).toBeGreaterThan(90)
  await page.locator('.structure-list').evaluate(e => { e.scrollTop = e.scrollHeight })
  expect(await page.locator('.structure-list').evaluate(e => e.scrollTop)).toBeGreaterThan(0)
  await expect(page.locator('.editor-panel')).toBeInViewport({ ratio: 1 }); await expect(page.locator('.preview-panel')).toBeInViewport({ ratio: 1 })
})
