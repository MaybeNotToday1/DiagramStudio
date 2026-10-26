import { chromium } from 'playwright'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
const xml = await readFile(process.argv[2] || '.runtime/acceptance.drawio', 'utf8')
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  // This environment's browser transport rejects the public editor host.
  // Fetch its unchanged public resources through Node's working transport.
  await page.route('https://embed.diagrams.net/**', async route => {
    try {
      const response = await fetch(route.request().url()), headers = Object.fromEntries(response.headers)
      delete headers['content-encoding']; delete headers['content-length']; delete headers['transfer-encoding']
      await route.fulfill({ status: response.status, headers, body: Buffer.from(await response.arrayBuffer()) })
    } catch { await route.abort() }
  })
  await page.goto('http://127.0.0.1:5173/')
  await page.evaluate(xml => {
    window.drawioEvents = []
    const frame = document.createElement('iframe'); frame.id = 'drawio-verification'; frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:9999;background:white;border:0'
    window.addEventListener('message', event => {
      if (event.origin !== 'https://embed.diagrams.net') return
      let data; try { data = JSON.parse(event.data) } catch { return }
      window.drawioEvents.push(data)
      if (data.event === 'init') frame.contentWindow.postMessage(JSON.stringify({ action: 'load', xml, autosave: 1, fit: 1 }), event.origin)
    })
    frame.src = 'https://embed.diagrams.net/?embed=1&proto=json&spin=1&lang=en'; document.body.append(frame)
  }, xml)
  await page.waitForFunction(() => window.drawioEvents.some(e => e.event === 'load'), undefined, { timeout: 90000 }).catch(async error => { await page.screenshot({ path: '.runtime/drawio-load-debug.png' }); console.log('Editor events:', await page.evaluate(() => window.drawioEvents.map(e => e.event))); throw error })
  const frame = page.frames().find(f => f.url().includes('embed.diagrams.net'))
  const cardinalities = process.argv.includes('--cardinalities')
  const filtered = process.argv.includes('--filtered')
  if (filtered) {
    if (await frame.getByText('学生', { exact: true }).count() || await frame.getByText('关联', { exact: true }).count()) throw new Error('Hidden entities or relationships appeared in the filtered Draw.io export')
    await frame.getByText('班级', { exact: true }).first().waitFor()
    await page.screenshot({ path: 'docs/evidence/filtered-drawio.png' })
  }
  if (cardinalities) {
    const text = frame.getByText('1', { exact: true }).first()
    const font = await text.evaluate(element => {
      const s = getComputedStyle(element)
      return { size: s.fontSize, weight: s.fontWeight, family: s.fontFamily, color: s.fill || s.color }
    })
    if (font.size !== '34px' || Number(font.weight) !== 700 || !font.family.includes('sans-serif') || font.color !== 'rgb(190, 18, 60)') throw new Error('Draw.io did not render the custom cardinality font: ' + JSON.stringify(font))
    const cardinality = await text.boundingBox(), entity = await frame.getByText('班级', { exact: true }).first().boundingBox()
    if (cardinality.y >= entity.y - 100) throw new Error('Draw.io did not preserve the manually moved label position')
    await page.screenshot({ path: 'docs/evidence/cardinalities-drawio.png' })
  }
  const labels = filtered ? ['班级', '班级ID'] : cardinalities ? ['班级', '1', '关联'] : ['班级', '班级ID', '关联']
  for (const [index, label] of labels.entries()) {
    await frame.getByText(label, { exact: true }).first().dblclick()
    const editable = frame.locator('[contenteditable="true"]').first(); await editable.fill(`可编辑验证${index}`); await editable.press('Control+Enter')
  }
  await frame.getByText('Save', { exact: true }).first().click()
  await page.waitForFunction(() => window.drawioEvents.some(e => e.event === 'save'), undefined, { timeout: 15000 })
  const result = await page.evaluate(() => window.drawioEvents.findLast(e => e.event === 'save').xml)
  for (let index = 0; index < labels.length; index++) if (!result.includes(`可编辑验证${index}`)) throw new Error('Draw.io element editing was not retained')
  await writeFile('.runtime/drawio-edited.drawio', result); await page.screenshot({ path: '.runtime/drawio-edit-verified.png' })
  process.stdout.write(filtered ? 'Official Draw.io editor displayed only the selected entity and its attributes, then saved individual edits.\n' : cardinalities ? 'Official Draw.io editor rendered cardinality size, font, weight, color and moved position correctly, then saved individual element edits.\n' : 'Official Draw.io editor loaded the downloaded file and saved edits to entity, attribute and relationship nodes.\n')
} finally { await browser.close() }
