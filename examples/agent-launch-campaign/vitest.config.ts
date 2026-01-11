/**
 * Vitest Configuration for Agent Launch Campaign
 *
 * Run tests with: npx vitest run --config examples/agent-launch-campaign/vitest.config.ts
 */

import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

const PROJECT_ROOT = resolve(__dirname, '../..')
const CLOUDFLARE_WORKERS_MOCK = resolve(PROJECT_ROOT, 'tests/mocks/cloudflare-workers.ts')

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globals: true,
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
  resolve: {
    alias: {
      'cloudflare:workers': CLOUDFLARE_WORKERS_MOCK,
    },
  },
})
