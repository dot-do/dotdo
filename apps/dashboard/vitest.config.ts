/**
 * Vitest Configuration for Dashboard App
 *
 * Uses @cloudflare/vitest-pool-workers for real DO testing with miniflare.
 * NO MOCKS - tests run against real DashboardDO instances.
 *
 * @module apps/dashboard/vitest.config
 */

import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    name: 'dashboard',
    globals: true,

    include: ['tests/**/*.test.ts'],

    exclude: ['**/node_modules/**'],

    // CRITICAL: Limit concurrency to prevent resource exhaustion
    maxConcurrency: 1,
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,

    // Pool worker options for miniflare runtime
    poolOptions: {
      workers: {
        // Use wrangler config for DO bindings
        wrangler: {
          configPath: './wrangler.jsonc',
        },

        // Use single worker mode to avoid isolated storage issues with SQLite
        singleWorker: true,

        // Disable isolated storage for SQLite WAL compatibility
        isolatedStorage: false,

        // Miniflare configuration
        miniflare: {
          // In-memory storage for tests (faster)
          durableObjectsPersist: false,

          bindings: {
            TEST_MODE: 'true',
          },
        },
      },
    },

    // Test timeouts (DO operations can be slower)
    testTimeout: 30000,
    hookTimeout: 30000,

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/node_modules/**'],
      thresholds: {
        statements: 60,
        branches: 50,
        functions: 60,
        lines: 60,
      },
    },
  },
})
