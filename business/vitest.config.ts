/**
 * Vitest Configuration for Business Package Tests
 *
 * Uses @cloudflare/vitest-pool-workers since Business extends DO
 * and needs real miniflare runtime for testing.
 *
 * Usage:
 *   npx vitest run business/tests/goals.test.ts
 *
 * @module business/vitest.config
 */

import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**'],

    // CRITICAL: Limit concurrency
    maxConcurrency: 1,
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,

    poolOptions: {
      workers: {
        wrangler: {
          configPath: './wrangler.jsonc',
        },
        singleWorker: true,
        isolatedStorage: false,
        miniflare: {
          durableObjectsPersist: false,
          bindings: {
            TEST_MODE: 'true',
          },
        },
      },
    },

    testTimeout: 30000,
    hookTimeout: 30000,
  },
})
