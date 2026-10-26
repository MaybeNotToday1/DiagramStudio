import { request } from 'playwright'
import { readFile, writeFile, unlink, access } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { parseSql } from '../src/modules/er/domain/sql.ts'
import { sampleSql } from '../src/modules/er/domain/sample.ts'
const exec = promisify(execFile), root = process.cwd(), configFile = resolve('.runtime/expiry-client.cnf')
const local = JSON.parse(await readFile('.runtime/local.json', 'utf8'))
const client = await request.newContext({ baseURL: 'http://127.0.0.1:5173', extraHTTPHeaders: { 'X-Diagram-Request': '1' } })
const mysql = resolve('.tools/mysql-8.4.13-winx64/bin/mysql.exe')
try {
  const response = await client.post('/api/v1/export-jobs', { data: { requestId: crypto.randomUUID(), document: parseSql(sampleSql), paper: 'A4', orientation: 'portrait', paginate: false, padding: 40 } })
  if (response.status() !== 202) throw new Error('Could not create expiration fixture')
  const { id } = await response.json()
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid fixture ID')
  const deadline = Date.now() + 30000
  let state
  while (Date.now() < deadline) { state = (await (await client.get(`/api/v1/export-jobs/${id}`)).json()).state; if (state === 'SUCCEEDED' || state === 'FAILED') break; await new Promise(r => setTimeout(r, 200)) }
  if (state !== 'SUCCEEDED') throw new Error('Expiration fixture did not render')
  await writeFile(configFile, `[client]\nuser=diagram_app\npassword=${local.dbPassword}\nhost=127.0.0.1\nport=3307\nprotocol=TCP\n`, { mode: 0o600 })
  const sql = async statement => (await exec(mysql, [`--defaults-extra-file=${configFile}`, '--batch', '--skip-column-names', 'diagram_studio', '--execute', statement], { windowsHide: true })).stdout.trim()
  const binaryLoggingDisabled = (await sql('SELECT @@global.log_bin')) === '0'
  // Only this test's newly created UUID is changed; no production cleanup endpoint exists.
  await sql(`UPDATE export_jobs SET expires_at=0 WHERE id='${id}'`)
  if ((await client.get(`/api/v1/export-jobs/${id}`)).status() !== 404 || (await client.get(`/api/v1/export-jobs/${id}/download`)).status() !== 404) throw new Error('Expired task remains accessible')
  const cleanupDeadline = Date.now() + 70000
  let remaining = '1'
  while (Date.now() < cleanupDeadline) { remaining = await sql(`SELECT COUNT(*) FROM export_jobs WHERE id='${id}'`); if (remaining === '0') break; await new Promise(r => setTimeout(r, 500)) }
  if (remaining !== '0') throw new Error('Expired task row was not deleted')
  let present = true; try { await access(resolve('.runtime/exports', `${id}.pdf`)) } catch { present = false }
  if (present) throw new Error('Expired PDF was not deleted')
  await writeFile('.runtime/expiry-verification.json', JSON.stringify({ expiredStatus: 404, snapshotDeleted: true, rowDeleted: true, pdfDeleted: true, binaryLoggingDisabled, database: 'project MySQL 8.4', verifiedAt: new Date().toISOString() }, null, 2))
  if (!binaryLoggingDisabled) throw new Error('Restart the project MySQL with scripts/Stop.ps1 and Start.ps1 to disable transient-data binary logging')
  process.stdout.write('Actual MySQL expiration check passed: task is inaccessible; snapshot, row and PDF were removed.\n')
} finally { await client.dispose(); await unlink(configFile).catch(() => {}) }
