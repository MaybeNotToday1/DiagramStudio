import { defineConfig } from '@playwright/test'
import { existsSync } from 'node:fs'
const browser = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']
  .find((path): path is string => !!path && existsSync(path))
export default defineConfig({
  testDir: './tests/e2e', workers: 1, timeout: 60000,
  outputDir: '.runtime/test-results', reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:5173', viewport: { width: 1600, height: 1100 }, headless: true,
    launchOptions: { executablePath: browser }, screenshot: 'only-on-failure' },
})
