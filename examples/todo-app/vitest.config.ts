/**
 * Vitest Configuration for todo-app
 *
 * Uses @cloudflare/vitest-pool-workers for real Durable Object testing.
 * NO MOCKS - tests run against real miniflare instances with SQLite.
 *
 * @module apps/todo-app/vitest.config
 */

import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    name: 'todo-app',
    globals: true,

    // Include test files
    include: ['tests/**/*.test.ts'],

    // Exclude external packages
    exclude: ['**/node_modules/**', '**/dist/**'],

    // CRITICAL: Limit concurrency to prevent resource exhaustion
    maxConcurrency: 1,
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,

    // Pool worker options for miniflare runtime
    poolOptions: {
      workers: {
        // Use this app's wrangler config for DO bindings
        wrangler: {
          configPath: './wrangler.jsonc',
        },

        // Use single worker mode to avoid isolated storage issues with SQLite
        singleWorker: true,

        // Disable isolated storage to work around SQLite WAL issues
        isolatedStorage: false,

        // Additional miniflare configuration
        miniflare: {
          // Enable DO SQL storage - in-memory for tests (faster)
          durableObjectsPersist: false,

          // Add any additional bindings needed for tests
          bindings: {
            TEST_MODE: 'true',
          },
        },
      },
    },

    // Test timeouts (DO operations can be slower)
    testTimeout: 30000,
    hookTimeout: 30000,
  },
})
