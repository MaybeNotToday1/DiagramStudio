import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { readFile, writeFile } from 'node:fs/promises'
import { validateDocument } from '../src/modules/er/domain/model.ts'
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } })
  await page.goto('http://127.0.0.1:5173/'); await page.locator('.x6-node').first().waitFor()
  const backup = async file => { const event = page.waitForEvent('download'); await page.getByRole('button', { name: '项目备份' }).click(); await (await event).saveAs(file); return JSON.parse(await readFile(file, 'utf8')) }
  const before = await backup('.runtime/model-before.diagram.json')
  await page.locator('.x6-node[data-cell-id="' + before.entities[0].id + '"]').dblclick()
  const dialog = page.getByRole('dialog', { name: '编辑实体与属性' })
  await dialog.getByPlaceholder('字段原名称').first().fill('renamed_class_id')
  await dialog.getByRole('button', { name: '保存实体' }).click()
  const after = validateDocument(await backup('.runtime/model-after.diagram.json'))
  assert.equal(after.entities[0].id, before.entities[0].id); assert.equal(after.entities[0].fields[0].id, before.entities[0].fields[0].id)
  assert.equal(after.relationships[0].fieldPairs[0].to, 'renamed_class_id')
  await page.getByLabel('SQL 建表语句', { exact: true }).fill("CREATE TABLE employee (\n  id INT PRIMARY KEY COMMENT '员工编号',\n  manager_id INT COMMENT '上级编号',\n  FOREIGN KEY(manager_id) REFERENCES employee(id)\n) COMMENT='员工';")
  await page.getByRole('button', { name: '生成 ER 图' }).click(); await page.locator('.el-message-box').getByRole('button', { name: '确认', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.x6-node').length === 4)
  await page.locator('.el-message-box').waitFor({ state: 'hidden' })
  await page.waitForFunction(() => document.querySelectorAll('.el-message').length === 0)
  const paths = await page.locator('.x6-edge path').evaluateAll(nodes => [...new Set(nodes.map(n => n.getAttribute('d')).filter(Boolean))])
  assert.equal(paths.length, 4); assert.equal(paths.filter(d => (d.match(/L/g) || []).length >= 2).length, 2)
  assert.equal(new Set(paths).size, 4)
  await page.getByLabel('项目名称').fill('员工自关联验收')
  await page.locator('.save-state').filter({ hasText: '已保存' }).waitFor()
  await page.screenshot({ path: '.runtime/self-reference.png' })
  await writeFile('.runtime/model-editing-verification.json', JSON.stringify({ fieldRenameKeptIds: true, foreignKeyReferenceUpdated: true, selfReferenceHasTwoDistinctArms: true }, null, 2))
  process.stdout.write('Real form field rename preserved IDs and foreign key references; self-reference drew two distinct arms.\n')
} finally { await browser.close() }
