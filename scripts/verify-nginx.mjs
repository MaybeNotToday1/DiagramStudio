import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { once } from 'node:events'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runtime = resolve(root, '.runtime/nginx-verification')
const nginx = process.env.NGINX_PATH || (process.platform === 'win32' ? resolve(root, '.tools/nginx-1.28.3/nginx.exe') : '/usr/sbin/nginx')
const openssl = process.env.OPENSSL_PATH || 'openssl'
assert(existsSync(nginx), 'Set NGINX_PATH to an existing Nginx executable; see docs/DEVELOPMENT.md')
assert(existsSync(resolve(root, 'dist/index.html')), 'Run npm run build before this check')
await mkdir(runtime, { recursive: true })
const certificate = resolve(runtime, 'localhost.crt'), key = resolve(runtime, 'localhost.key')
execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-keyout', key, '-out', certificate], { stdio: 'ignore' })
const ca = await readFile(certificate)
const pdfFixture = Buffer.concat([Buffer.from('%PDF-1.4\nTEST_ONLY_PROXY_PDF\n'), Buffer.from([0, 255, 128]), Buffer.from('\n%%EOF\n')])
const mock = http.createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk)
  if (req.url.endsWith('/download')) { res.writeHead(200, { 'Content-Type': 'application/pdf' }); res.end(pdfFixture); return }
  if (req.url === '/api/failure') { res.writeHead(503); res.end('TEST_ONLY_UPSTREAM_FAILURE'); return }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ method: req.method, uri: req.url, host: req.headers.host, cookie: req.headers.cookie, body: Buffer.concat(chunks).toString() }))
})
mock.listen(0, '127.0.0.1'); await once(mock, 'listening')
const upstreamPort = mock.address().port
const freePort = async () => { const s = http.createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening'); const p = s.address().port; await new Promise(r => s.close(r)); return p }
const posix = path => path.replaceAll('\\', '/')
function request(port, path, secure, method = 'GET') {
  return new Promise((resolve, reject) => {
    const headers = method === 'POST' ? { 'Content-Type': 'application/json', Cookie: 'diagram_session=TEST_ONLY_PROXY_COOKIE' } : {}
    const req = (secure ? https : http).request({ hostname: '127.0.0.1', port, path, method, headers, ca, timeout: 3000 }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => { const bytes = Buffer.concat(chunks); resolve({ status: res.statusCode, headers: res.headers, bytes, body: bytes.toString() }) })
    })
    req.on('timeout', () => req.destroy(new Error('Fixture request timed out')))
    req.on('error', reject); req.end(method === 'POST' ? '{"fixture":true}' : undefined)
  })
}
const results = [], failures = []
try {
  const asset = (await readdir(resolve(root, 'dist/assets'))).find(file => file.endsWith('.js'))
  for (const secure of [false, true]) {
    const mode = secure ? 'https' : 'http', prefix = resolve(runtime, mode)
    await mkdir(resolve(prefix, 'logs'), { recursive: true })
    await mkdir(resolve(prefix, 'temp'), { recursive: true })
    const plainPort = await freePort(), tlsPort = await freePort(), port = secure ? tlsPort : plainPort
    const template = (await readFile(resolve(root, `deploy/nginx.${mode}.conf.template`), 'utf8'))
      .replaceAll('${DOMAIN}', 'localhost')
      .replaceAll('listen 8080;', `listen 127.0.0.1:${plainPort};`)
      .replaceAll('listen 8443 ssl;', `listen 127.0.0.1:${tlsPort} ssl;`)
      .replaceAll('/usr/share/nginx/html', `"${posix(resolve(root, 'dist'))}"`)
      .replaceAll('http://api:8080', `http://127.0.0.1:${upstreamPort}`)
      .replaceAll('/etc/nginx/certs/fullchain.pem', `"${posix(certificate)}"`)
      .replaceAll('/etc/nginx/certs/privkey.pem', `"${posix(key)}"`)
    const config = `master_process off;\ndaemon off;\npid logs/nginx.pid;\nerror_log logs/error.log;\nevents {}\nhttp {\naccess_log off;\nclient_body_temp_path temp/client;\nproxy_temp_path temp/proxy;\n${template}\n}\n`
    await writeFile(resolve(prefix, 'nginx.conf'), config)
    const args = ['-p', posix(prefix) + '/', '-c', 'nginx.conf']
    execFileSync(nginx, ['-t', ...args], { stdio: 'pipe' })
    const child = spawn(nginx, args, { cwd: prefix, windowsHide: true, stdio: 'ignore' })
    let exited = false; child.on('exit', () => { exited = true })
    const check = (ok, label) => { if (!ok) failures.push(`${mode}: ${label}`) }
    try {
      let ready = false
      for (let i = 0; i < 50; i++) {
        try { await request(port, '/', secure); ready = true; break } catch { await new Promise(r => setTimeout(r, 100)) }
      }
      assert(ready && !exited, `${mode} Nginx fixture failed to start`)
      const headers = []
      for (const path of ['/', '/index.html', '/guide/fallback', `/assets/${asset}`, '/assets/missing.js', '/fonts/fonts.css', '/api/health', '/api/failure']) {
        const response = await request(port, path, secure), h = response.headers
        check(h['x-frame-options'] === 'DENY', `${path} framing header`)
        check(h['x-content-type-options'] === 'nosniff', `${path} nosniff header`)
        check(h['referrer-policy'] === 'same-origin', `${path} referrer header`)
        if (secure) check(h['strict-transport-security'] === 'max-age=31536000', `${path} HSTS header`)
        if (path === '/') check(h['cache-control']?.includes('no-cache'), 'HTML no-cache')
        if (path === `/assets/${asset}`) check(h['cache-control']?.includes('immutable') && h['cache-control']?.includes('max-age=31536000'), 'asset cache policy')
        if (path === '/fonts/fonts.css') check(h['cache-control']?.includes('max-age=2592000'), 'font expiry')
        check(response.status === (path === '/assets/missing.js' ? 404 : path === '/api/failure' ? 503 : 200), `${path} routing`)
        headers.push({ path, status: response.status, framing: h['x-frame-options'], hsts: h['strict-transport-security'] })
      }
      const paths = ['/api/v1/export-jobs', '/api/v1/export-jobs;x=1', '/api/v1;probe=1/export-jobs', '/api/v1/export-jobs%3Bx=1', '/api/v1/export-jobs%3bx=1', '/api//v1/export-jobs', '/api/v1/%65xport-jobs', '/api/v1/export-jobs?probe=1', '/api/health', '/api/missing', '/api/v1/export-jobs;next=2', '/api/v1/export-jobs']
      const posts = []
      for (const path of paths) {
        const response = await request(port, path, secure, 'POST')
        posts.push({ path, status: response.status })
        if (response.status === 200) {
          const forwarded = JSON.parse(response.body)
          check(forwarded.method === 'POST' && forwarded.uri === path && forwarded.host === `127.0.0.1:${port}` && forwarded.cookie === 'diagram_session=TEST_ONLY_PROXY_COOKIE' && forwarded.body === '{"fixture":true}', 'original POST URI/Host/body/cookie forwarding')
        }
        if (response.status === 429) check(response.headers['x-frame-options'] === 'DENY', '429 security header')
      }
      check(posts.slice(0, 4).every(r => r.status === 200) && posts.slice(4).every(r => r.status === 429), 'initial POSTs succeed and all aliases share one limiter')
      for (let i = 0; i < 12; i++) for (const path of ['/api/health', '/api/v1/export-jobs/fixture', '/api/v1/export-jobs/fixture/download']) {
        const response = await request(port, path, secure)
        check(response.status === 200, 'GET polling/download remains unthrottled after POST saturation')
        if (path.endsWith('/download')) check(response.headers['content-type'] === 'application/pdf' && response.bytes.equals(pdfFixture), 'PDF response bytes preserved')
      }
      await new Promise(r => setTimeout(r, 11000))
      check((await request(port, '/api/v1/export-jobs', secure, 'POST')).status === 200, 'POST allowance recovers after rate interval')
      if (secure) { const redirect = await request(plainPort, '/guide', false); check(redirect.status === 301 && redirect.headers.location === 'https://localhost/guide', 'HTTP redirects to HTTPS') }
      results.push({ mode, headers, posts, pollingRequests: 36 })
    } finally {
      if (!exited) { const done = once(child, 'exit'); child.kill(); await done }
    }
  }
} finally { await new Promise(r => mock.close(r)) }
await writeFile(resolve(runtime, 'result.json'), JSON.stringify({ results, failures }, null, 2))
assert.deepEqual(failures, [], 'Nginx security regression failed: ' + failures.join('; '))
console.log('Nginx HTTP/HTTPS passed: equivalent POST limits, unrestricted GET polling, security headers, SPA/static/cache behavior.')
