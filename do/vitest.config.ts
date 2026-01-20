/**
 * Vitest Configuration for Durable Object Integration Tests
 *
 * This configuration uses @cloudflare/vitest-pool-workers to run tests
 * inside the Cloudflare Workers runtime with real Durable Objects.
 *
 * IMPORTANT: Tests using this config get access to:
 * - Real DurableObjectState with actual storage
 * - Real SQLite via state.storage.sql
 * - Real WebSocket hibernation
 * - Real DO-to-DO communication via env bindings
 * - Real concurrency handling (blockConcurrencyWhile)
 *
 * Usage:
 *   npx vitest run --config do/vitest.config.ts
 *
 * Or to run a specific test:
 *   npx vitest run --config do/vitest.config.ts do/tests/vitest-pool-workers-example.test.ts
 *
 * @module do/vitest.config
 */

import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    // Only include integration tests that need the workers pool
    include: [
      'tests/vitest-pool-workers-example.test.ts',
      // Add more integration tests here as they're converted:
      // 'tests/DO.integration.test.ts',
      // 'tests/entities.integration.test.ts',
      // 'tests/websocket.integration.test.ts',
    ],

    // Exclude unit tests that don't need the workers pool
    // (these run faster with the default vitest config)
    exclude: [
      '**/node_modules/**',
    ],

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
          // Enable DO SQL storage
          durableObjectsPersist: false, // In-memory for tests (faster)

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
