import { test, expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parseSql } from '../../src/modules/er/domain/sql'
import { sampleSql } from '../../src/modules/er/domain/sample'
const exec = promisify(execFile)
const project = process.cwd()

test('real API restart retains completed downloads and marks an interrupted task failed', async ({ request }) => {
  test.setTimeout(90000)
  const create = async () => {
    const result = await request.post('/api/v1/export-jobs', { headers: { 'X-Diagram-Request': '1' }, data: { requestId: crypto.randomUUID(), document: parseSql(sampleSql), paper: 'A4', orientation: 'landscape', paginate: false, padding: 40 } })
    expect(result.status()).toBe(202); return (await result.json()).id
  }
  const complete = await create()
  await expect.poll(async () => (await (await request.get(`/api/v1/export-jobs/${complete}`)).json()).state, { timeout: 30000 }).toBe('SUCCEEDED')
  const original = await (await request.get(`/api/v1/export-jobs/${complete}/download`)).body()
  const interrupted = await create()
  await expect.poll(async () => (await (await request.get(`/api/v1/export-jobs/${interrupted}`)).json()).state, { timeout: 10000, intervals: [30] }).toBe('RUNNING')
  try {
    await exec('pwsh.exe', ['-NoProfile', '-File', `${project}/scripts/Stop.ps1`, '-Service', 'api'], { cwd: project, windowsHide: true })
  } finally {
    await exec('pwsh.exe', ['-NoProfile', '-File', `${project}/scripts/Start.ps1`], { cwd: project, windowsHide: true, timeout: 60000 })
  }
  await expect.poll(async () => {
    try { return (await request.get('/api/health')).ok() } catch { return false }
  }, { timeout: 20000 }).toBe(true)
  const failed = await (await request.get(`/api/v1/export-jobs/${interrupted}`)).json(); expect(failed.state).toBe('FAILED'); expect(failed.error).toContain('重启')
  expect(await (await request.get(`/api/v1/export-jobs/${complete}/download`)).body()).toEqual(original)
  const next = await create(); await expect.poll(async () => (await (await request.get(`/api/v1/export-jobs/${next}`)).json()).state, { timeout: 30000 }).toBe('SUCCEEDED')
})
