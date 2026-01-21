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
      // platform.do -> local src
      { find: /^platform\.do$/, replacement: resolve(__dirname, './src/index.ts') },
      // sdk.do dependencies
      { find: /^sdk\.do\/oauth$/, replacement: resolve(__dirname, '../sdk.do/src/oauth.ts') },
      { find: /^sdk\.do$/, replacement: resolve(__dirname, '../sdk.do/src/index.ts') },
      // rpc.do dependencies
      { find: /^rpc\.do\/auth$/, replacement: resolve(__dirname, '../rpc.do/src/auth/index.ts') },
      { find: /^rpc\.do$/, replacement: resolve(__dirname, '../rpc.do/src/index.ts') },
      // @dotdo/oauth dependencies
      { find: /^@dotdo\/oauth\/middleware$/, replacement: resolve(__dirname, '../oauth/src/middleware/index.ts') },
      { find: /^@dotdo\/oauth$/, replacement: resolve(__dirname, '../oauth/src/index.ts') },
    ],
  },
})
