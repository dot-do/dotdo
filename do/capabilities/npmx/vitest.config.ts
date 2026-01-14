import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

// Path to the shared cloudflare:workers mock
const CLOUDFLARE_WORKERS_MOCK = resolve(__dirname, '../../tests/mocks/cloudflare-workers.ts')

export default defineConfig({
  resolve: {
    alias: {
      'cloudflare:workers': CLOUDFLARE_WORKERS_MOCK,
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globals: true,
    testTimeout: 10000,
  },
})
