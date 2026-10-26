import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173, strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:8080', changeOrigin: false } },
    fs: { deny: ['.env', '.env.*', '**/.git/**', '**/.runtime/**', '**/.backups/**', '**/.workspaces/**', '**/.tools/**', '**/.cache/**', '**/.codex/**', '**/.agents/**', '**/.aws/**', '**/server/**', '**/deploy/**', '**/.npmrc', '**/*.{crt,pem,key}'] },
  },
  test: { include: ['tests/unit/**/*.test.ts'] },
})
