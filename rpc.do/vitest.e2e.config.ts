/**
 * Vitest Configuration for RPC E2E Integration Tests
 *
 * This configuration uses @cloudflare/vitest-pool-workers to run tests
 * inside the Cloudflare Workers runtime with real Durable Objects.
 *
 * IMPORTANT: Tests using this config get access to:
 * - Real DurableObjectState with actual storage
 * - Real SQLite via state.storage.sql
 * - Real DO-to-DO communication via env bindings
 * - Full RPC client-server round-trip testing
 *
 * Usage:
 *   npx vitest --config rpc.do/vitest.e2e.config.ts        # Run E2E tests
 *   npx vitest run --config rpc.do/vitest.e2e.config.ts    # Run once
 *   npx vitest run rpc.do/tests/e2e.test.ts                # Run specific file
 *
 * @module rpc.do/vitest.e2e.config
 */

import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    // Include only E2E tests
    include: [
      'tests/e2e.test.ts',
    ],

    // Exclude non-test files
    exclude: [
      '**/node_modules/**',
    ],

    // CRITICAL: Limit concurrency to prevent resource exhaustion
    // Workers pool with miniflare is memory-intensive
    maxConcurrency: 1,
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,

    // Pool worker options
    poolOptions: {
      workers: {
        // Use wrangler config for DO bindings
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

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/__tests__/**',
        '**/node_modules/**',
        'vitest.config.ts',
        'vitest.e2e.config.ts',
        'tsup.config.ts',
      ],
    },
  },
})
