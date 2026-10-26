import { test, expect } from '@playwright/test'

test('development server blocks private runtime, tools, deployment and backend files', async ({ request }) => {
  for (const path of ['/.runtime/local.json', '/.RUNTIME/LOCAL.JSON', '/%2eruntime/local.json', '/.runtime/local.json?raw', '/.runtime/logs/api.out.log', '/.runtime/processes.json', '/.tools/docker-compose.exe', '/server/api/src/main/resources/application.yml', '/deploy/.env.example', '/.npmrc', '/@fs/' + process.cwd().replaceAll('\\', '/') + '/.runtime/local.json']) {
    const response = await request.head(path)
    expect([403, 404].includes(response.status())).toBe(true)
  }
  expect((await request.head('/src/main.ts')).ok()).toBe(true)
  expect((await request.head('/fonts/diagram-serif.woff2')).ok()).toBe(true)
})
