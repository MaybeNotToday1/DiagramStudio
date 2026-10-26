import { request } from 'playwright'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile } from 'node:fs/promises'
import { parseSql } from '../src/modules/er/domain/sql.ts'
import { sampleSql } from '../src/modules/er/domain/sample.ts'
const exec = promisify(execFile), root = process.cwd(), client = await request.newContext({ baseURL: 'http://127.0.0.1:5173', extraHTTPHeaders: { 'X-Diagram-Request': '1' } })
try {
  const created = await client.post('/api/v1/export-jobs', { data: { requestId: crypto.randomUUID(), document: parseSql(sampleSql), paper: 'A4', orientation: 'landscape', paginate: false, padding: 40 } })
  if (created.status() !== 202) throw new Error('Restart fixture creation failed')
  const { id } = await created.json()
  const deadline = Date.now() + 30000; let state
  while (Date.now() < deadline) { state = (await (await client.get(`/api/v1/export-jobs/${id}`)).json()).state; if (state === 'SUCCEEDED') break; await new Promise(r => setTimeout(r, 200)) }
  if (state !== 'SUCCEEDED') throw new Error('Restart fixture rendering failed')
  const original = await (await client.get(`/api/v1/export-jobs/${id}/download`)).body()
  const rotate = process.argv.includes('--rotate')
  if (rotate) await exec('pwsh.exe', ['-NoProfile', '-File', `${root}/scripts/Rotate-LocalSecrets.ps1`], { cwd: root, windowsHide: true, timeout: 90000 })
  else {
    try { await exec('pwsh.exe', ['-NoProfile', '-File', `${root}/scripts/Stop.ps1`], { cwd: root, windowsHide: true, timeout: 30000 }) }
    finally { await exec('pwsh.exe', ['-NoProfile', '-File', `${root}/scripts/Start.ps1`], { cwd: root, windowsHide: true, timeout: 90000 }) }
  }
  const downloaded = await client.get(`/api/v1/export-jobs/${id}/download`)
  if (!downloaded.ok() || !(await downloaded.body()).equals(original)) throw new Error('Completed export did not survive all-service restart')
  const fresh = await client.post('/api/v1/export-jobs', { data: { requestId: crypto.randomUUID(), document: parseSql(sampleSql), paper: 'A4', orientation: 'landscape', paginate: false, padding: 40 } })
  if (fresh.status() !== 202) throw new Error('Could not create PDF after service refresh')
  const freshId = (await fresh.json()).id, freshDeadline = Date.now() + 30000
  let freshState
  while (Date.now() < freshDeadline) { freshState = (await (await client.get(`/api/v1/export-jobs/${freshId}`)).json()).state; if (freshState === 'SUCCEEDED' || freshState === 'FAILED') break; await new Promise(r => setTimeout(r, 200)) }
  if (freshState !== 'SUCCEEDED') throw new Error('PDF worker authentication failed after service refresh')
  await writeFile(rotate ? '.runtime/credential-rotation-verification.json' : '.runtime/restart-verification.json', JSON.stringify({ services: rotate ? ['frontend', 'api', 'worker'] : ['frontend', 'api', 'worker', 'project-mysql'], restart: true, credentialsRotated: rotate, persistedPdfIdentical: true, newPdfSucceeded: true, verifiedAt: new Date().toISOString() }, null, 2))
  process.stdout.write(rotate ? 'Local credential rotation verified: existing download retained; new PDF rendered successfully.\n' : 'Full project stop/start passed; completed PDF survived MySQL restart unchanged.\n')
} finally { await client.dispose() }
