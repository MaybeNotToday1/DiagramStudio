// Inspect Git's index, so an ignored but force-staged file cannot slip into a commit.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const git = process.env.GIT_EXECUTABLE || 'git'
const run = args => execFileSync(git, args, { cwd: root, maxBuffer: 64 * 1024 * 1024 })
const files = run(['ls-files', '-z']).toString().split('\0').filter(Boolean)
if (!files.length) throw new Error('No indexed files. Stage the reviewed publication candidates first.')
const denied = /(^|\/)(node_modules|dist|target|\.tools|\.cache|\.runtime|\.backups|\.workspaces|\.git|\.aws|\.agents|\.codex|\.idea|\.vscode|coverage|test-results|playwright-report)(\/|$)|^deploy\/certs\/|^docs\/(evidence|rea)\/|^docs\/REA\.md$|(^|\/)\.env(?:\..*)?$|\.(?:log|pem|key|p12|pfx|jks|keystore|sqlite\d*|db|dump|diagram\.json|sql\.gz)$/i
const patterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g],
  ['cloud access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
  ['personal machine path', /[A-Za-z]:[\\/](?:Users|javaCodexProject)[\\/][^\s'"`<>]+/g],
  ['email outside GitHub privacy identity', /\b[A-Z0-9._%+-]+@(?!users\.noreply\.github\.com\b)[A-Z0-9.-]+\.[A-Z]{2,}\b/gi],
]
// Compare local generated secrets in memory; never log or persist their values.
const localFile = resolve(root, '.runtime/local.json')
const localSecrets = existsSync(localFile) ? Object.values(JSON.parse(readFileSync(localFile, 'utf8'))).filter(value => typeof value === 'string' && value.length >= 12) : []
const issues = []
let total = 0
for (const file of files) {
  if (denied.test(file) && !/(^|\/)\.env\.example$/.test(file)) issues.push(`${file}: excluded file type or directory`)
  const bytes = run(['show', `:${file}`])
  total += bytes.length
  if (bytes.length > 50 * 1024 * 1024) issues.push(`${file}: exceeds publication size limit`)
  if (/\.(woff2|png|jpg|jpeg|ico)$/i.test(file)) continue
  const source = bytes.toString('utf8')
  for (const [kind, pattern] of patterns) {
    if (file === 'public/fonts/LICENSE.txt' && kind.startsWith('email')) continue
    for (const match of source.matchAll(pattern)) {
      const line = source.slice(0, match.index).split('\n').length
      issues.push(`${file}:${line}: ${kind}`)
    }
  }
  if (localSecrets.some(secret => source.includes(secret))) issues.push(`${file}: matches a local generated secret`)
}
if (issues.length) {
  console.error('Publication check failed (values redacted):\n' + issues.join('\n'))
  process.exitCode = 1
} else console.log(`Publication check passed: ${files.length} indexed files, ${(total / 1024 / 1024).toFixed(2)} MiB. No values printed. Manual review remains required.`)
