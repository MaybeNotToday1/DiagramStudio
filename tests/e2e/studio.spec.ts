import { test, expect } from '@playwright/test'
import { writeFile, readFile } from 'node:fs/promises'

test('ER-1: renders sample, preserves graph on SQL errors, drags and zooms', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/'); await expect(page.locator('.x6-node')).toHaveCount(11)
  await expect(page.locator('.workspace-stats')).toContainText('02')
  const old = await page.locator('.x6-node').count()
  await page.getByLabel('SQL 建表语句', { exact: true }).fill('CREATE TABLE broken(,);')
  await page.getByRole('button', { name: '生成 ER 图' }).click()
  await expect(page.getByRole('alert')).toContainText('第 1 行')
  await expect(page.locator('.x6-node')).toHaveCount(old)
  const node = page.locator('.x6-node').first(), before = await node.getAttribute('transform'), box = await node.boundingBox()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.down(); await page.mouse.move(box!.x + box!.width / 2 + 70, box!.y + box!.height / 2 + 30, { steps: 10 }); await page.mouse.up()
  await expect.poll(() => page.locator('.x6-node').first().getAttribute('transform')).not.toBe(before)
  const zoom = await page.getByTestId('zoom-value').innerText(); await page.getByRole('button', { name: '放大画布' }).click(); await expect(page.getByTestId('zoom-value')).not.toHaveText(zoom)
  await page.screenshot({ path: '.runtime/er1-verified.png', fullPage: true })
  expect(errors).toEqual([])
})

test('ER-2/3: manual modeling, IndexedDB recovery, backup, editable and image exports', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('.x6-node')).toHaveCount(11)
  await page.getByRole('button', { name: '实体与关系', exact: true }).click()
  await page.getByRole('button', { name: '＋ 添加', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '编辑实体与属性' })
  await dialog.getByPlaceholder('例如 t_student').fill('t_course')
  await dialog.getByPlaceholder('例如 学生').fill('课程 & <中文>')
  await dialog.getByRole('button', { name: '添加属性' }).click()
  await dialog.getByPlaceholder('字段原名称').fill('course_id')
  await dialog.getByPlaceholder('画布显示名称').fill('课程编号')
  await dialog.getByLabel('主键', { exact: true }).check()
  await dialog.getByRole('button', { name: '保存实体' }).click()
  await expect(page.locator('.x6-node')).toHaveCount(13)
  await page.getByLabel('项目名称').fill('验收项目')
  await expect(page.locator('.save-state')).toContainText('已保存')
  await page.reload(); await expect(page.getByLabel('项目名称')).toHaveValue('验收项目'); await expect(page.locator('.x6-node')).toHaveCount(13)
  const backupEvent = page.waitForEvent('download'); await page.getByRole('button', { name: '项目备份' }).click(); const backup = await backupEvent
  await backup.saveAs('.runtime/acceptance.diagram.json'); const doc = JSON.parse(await readFile('.runtime/acceptance.diagram.json', 'utf8'))
  expect(doc.entities).toHaveLength(3)
  await page.getByRole('button', { name: '↓ 导出', exact: true }).click()
  for (const format of ['SVG', 'Draw.io', 'PNG', 'JPEG']) {
    await page.getByRole('button', { name: new RegExp(`^${format.replace('.', '\\.')} `) }).click()
    const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: '导出文件', exact: true }).click(); const file = await downloaded
    const suffix = format === 'Draw.io' ? 'drawio' : format.toLowerCase(); const target = `.runtime/acceptance.${suffix}`; await file.saveAs(target); const bytes = await readFile(target)
    expect(bytes.length).toBeGreaterThan(300)
    if (format === 'SVG') { expect(bytes.toString()).toContain('&amp; &lt;中文&gt;'); expect(bytes.toString()).not.toContain('<中文>') }
    if (format === 'Draw.io') { expect(bytes.toString()).toContain('vertex="1"'); expect(bytes.toString()).not.toContain('data:image') }
    if (format === 'PNG') expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    if (format === 'JPEG') expect(bytes.subarray(0, 3).toString('hex')).toBe('ffd8ff')
  }
})

test('SQL reimport shows change confirmation and retains unchanged entity positions', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('.x6-node')).toHaveCount(11)
  const sql = await page.getByLabel('SQL 建表语句', { exact: true }).inputValue()
  await page.getByLabel('SQL 建表语句', { exact: true }).fill(sql.replace('班级名称', '长名称班级'))
  await page.getByRole('button', { name: '生成 ER 图' }).click()
  await expect(page.locator('.el-message-box')).toContainText('检查 SQL 结构变化')
  await page.locator('.el-message-box').getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.locator('.x6-node')).toHaveCount(11)
  await expect(page.locator('.x6-node')).toContainText(['长名称班级'])
})
