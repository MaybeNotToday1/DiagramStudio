import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('fresh clone: sample, SQL errors, dragging, recovery and actual local exports', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await expect(page.locator('.x6-node')).toHaveCount(11)
  await page.getByLabel('SQL 建表语句', { exact: true }).fill('CREATE TABLE broken(,);')
  await page.getByRole('button', { name: '生成 ER 图' }).click()
  await expect(page.getByRole('alert')).toContainText('第 1 行')
  await expect(page.locator('.x6-node')).toHaveCount(11)

  const node = page.locator('.x6-node').first()
  const before = await node.getAttribute('transform'), box = await node.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width / 2 + 60, box!.y + box!.height / 2 + 30, { steps: 10 })
  await page.mouse.up()
  await expect.poll(() => node.getAttribute('transform')).not.toBe(before)
  await page.getByLabel('项目名称').fill('克隆测试项目')
  await expect(page.locator('.save-state')).toContainText('已保存')
  await page.reload()
  await expect(page.getByLabel('项目名称')).toHaveValue('克隆测试项目')
  await expect(page.locator('.x6-node')).toHaveCount(11)

  const backupEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: '项目备份' }).click()
  const backup = JSON.parse(await readFile((await (await backupEvent).path())!, 'utf8'))
  expect(backup.entities).toHaveLength(2)
  expect(backup.schemaVersion).toBe(1)
  await page.getByRole('button', { name: '↓ 导出', exact: true }).click()
  for (const format of ['SVG', 'PNG', 'Draw.io']) {
    await page.getByRole('button', { name: new RegExp(`^${format.replace('.', '\\.')} `) }).click()
    const event = page.waitForEvent('download')
    await page.getByRole('button', { name: '导出文件', exact: true }).click()
    const bytes = await readFile((await (await event).path())!)
    expect(bytes.length).toBeGreaterThan(300)
    if (format === 'PNG') expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    else if (format === 'SVG') expect(bytes.toString()).toContain('班级')
    else expect(bytes.toString()).toContain('vertex="1"')
  }
  expect(errors).toEqual([])
})
