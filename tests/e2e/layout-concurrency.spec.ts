import { test, expect } from '@playwright/test'

test('editing during delayed layout never overwrites newer document content', async ({ page }) => {
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('**/*elk*', async route => { await held; await route.continue() })
  await page.goto('/'); await expect(page.locator('.x6-node')).toHaveCount(11)
  await page.getByRole('button', { name: /美化排版/ }).click()
  await page.getByLabel('项目名称').fill('排版期间的新名称')
  await page.getByRole('button', { name: '实体与关系', exact: true }).click()
  await page.getByRole('button', { name: '编辑实体 班级', exact: true }).click()
  const editor = page.getByRole('dialog', { name: '编辑实体与属性' })
  await editor.getByPlaceholder('例如 学生').fill('排版期间的新实体名')
  await editor.getByRole('button', { name: '保存实体', exact: true }).click()
  release()
  await expect(page.getByRole('button', { name: /美化排版/ })).toBeEnabled({ timeout: 30000 })
  await expect(page.getByLabel('项目名称')).toHaveValue('排版期间的新名称')
  await expect(page.locator('.x6-node').filter({ hasText: '排版期间的新实体名' })).toHaveCount(1)
  await expect(page.locator('.x6-node')).toHaveCount(11)
})
