import { defineConfig } from '@playwright/test'
import base from './playwright.config'

export default defineConfig(base, {
  testDir: './tests/smoke',
  outputDir: '.runtime/smoke-results',
  use: { baseURL: 'http://127.0.0.1:5187' },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5187',
    url: 'http://127.0.0.1:5187',
    reuseExistingServer: false,
    timeout: 30000,
  },
})
