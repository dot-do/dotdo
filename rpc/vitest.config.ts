/**
 * Vitest Configuration for RPC Integration Tests with Miniflare
 *
 * This configuration uses @cloudflare/vitest-pool-workers to run tests
 * inside the Cloudflare Workers runtime with real Durable Objects.
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
 *   npx vitest run rpc/tests/miniflare-integration.test.ts  # Run specific file
 *
 * @module rpc/vitest.config
 */

import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    // Only include miniflare integration tests
    include: [
      'tests/miniflare-integration.test.ts',
    ],

    // Exclude only non-test files
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
        // See: https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/#isolated-storage
        singleWorker: true,

        // Disable isolated storage to work around SQLite WAL issues
        // This is a known limitation when DOs use state.storage.sql
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

    // Test timeouts (RPC operations can be slower)
    testTimeout: 30000,
    hookTimeout: 30000,

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['*.ts'],
      exclude: ['**/*.test.ts', '**/__tests__/**', '**/node_modules/**', 'vitest.config.ts'],
      thresholds: {
        statements: 75,
        branches: 70,
        functions: 75,
        lines: 75,
      },
    },
  },
})
