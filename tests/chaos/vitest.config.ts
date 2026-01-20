/**
 * Vitest Configuration for Chaos Engineering Tests
 *
 * These tests verify system resilience under various failure conditions
 * using REAL Miniflare Durable Objects instead of mocks.
 *
 * Uses @cloudflare/vitest-pool-workers for real DO runtime behavior.
 *
 * Usage:
 *   npx vitest --config tests/chaos/vitest.config.ts
 *   npx vitest run --config tests/chaos/vitest.config.ts
 *
 * @module tests/chaos/vitest.config
 * @see do-fhng.9
 * @see do-t0v5 - NO MOCKS conversion
 */

import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'
import path from 'path'

export default defineWorkersConfig({
  test: {
    globals: true,

    // Include chaos tests only (relative to this config file's directory)
    include: ['**/*.test.ts'],

    // Exclude non-test files
    exclude: ['**/node_modules/**'],

    // Set root to this directory
    root: path.dirname(new URL(import.meta.url).pathname),

    // Chaos tests may have higher timeout requirements
    testTimeout: 60_000,
    hookTimeout: 30_000,

    // CRITICAL: Limit concurrency to prevent resource exhaustion
    // Workers pool with miniflare is memory-intensive
    maxConcurrency: 1,
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,

    // Pool worker options
    poolOptions: {
      workers: {
        // Use test-specific wrangler config (path relative to root)
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
            CHAOS_TEST: 'true',
          },
        },
      },
    },

    // Retry flaky tests due to probabilistic nature of chaos testing
    retry: 1,
  },
})
