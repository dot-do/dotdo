/**
 * Vitest Configuration for RPC Package Tests
 *
 * Uses @cloudflare/vitest-pool-workers to ensure RPC code
 * works correctly in the Cloudflare Workers runtime.
 *
 * IMPORTANT: Tests using this config get access to:
 * - Real DurableObjectState with actual storage
 * - Real SQLite via state.storage.sql
 * - Real DO-to-DO communication via env bindings
 * - Real concurrency handling (blockConcurrencyWhile)
 *
 * Usage:
 *   npx vitest --config rpc/vitest.config.ts        # Watch mode
 *   npx vitest --config rpc/vitest.config.ts run    # Run once
 *   npx vitest run rpc/tests/client.test.ts         # Run specific file
 *
 * @module rpc/vitest.config
 */

import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    name: 'rpc',

    // Include ALL RPC tests
    include: [
      'tests/**/*.test.ts',
    ],

    // Exclude only non-test files
    exclude: [
      '**/node_modules/**',
    ],

    // CRITICAL: Limit concurrency to prevent resource exhaustion
    maxConcurrency: 1,
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,

    // Pool worker options
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

    // Test timeouts
    testTimeout: 30000,
    hookTimeout: 30000,

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['*.ts'],
      exclude: ['**/*.test.ts', '**/__tests__/**', '**/node_modules/**', 'vitest.config.ts'],
      thresholds: {
        statements: 65,
        branches: 60,
        functions: 60,
        lines: 65,
      },
    },
  },
})
