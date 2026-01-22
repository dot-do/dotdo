import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

const __dirname = new URL('.', import.meta.url).pathname

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
    testTimeout: 10_000,
  },
  resolve: {
    alias: [
      // Order matters: more specific patterns first
      { find: /^sdk\.do\/oauth$/, replacement: resolve(__dirname, './src/oauth.ts') },
      { find: /^sdk\.do$/, replacement: resolve(__dirname, './src/index.ts') },
      { find: /^rpc\.do\/auth$/, replacement: resolve(__dirname, '../rpc.do/src/auth/index.ts') },
      { find: /^rpc\.do$/, replacement: resolve(__dirname, '../rpc.do/src/index.ts') },
      { find: /^@dotdo\/oauth\/middleware$/, replacement: resolve(__dirname, '../oauth/src/middleware/index.ts') },
      { find: /^@dotdo\/oauth$/, replacement: resolve(__dirname, '../oauth/src/index.ts') },
    ],
  },
})
