/**
 * Vitest Configuration for API Worker Tests
 *
 * This configuration uses @cloudflare/vitest-pool-workers to run tests
 * inside the Cloudflare Workers runtime with real Durable Objects.
 *
 * IMPORTANT: Tests using this config get access to:
 * - Real DurableObjectState with actual storage
 * - Real SQLite via state.storage.sql
 * - Real worker fetch handling
 *
 * Usage:
 *   npx vitest --config api/vitest.config.ts          # Run all API tests
 *   npx vitest --config api/vitest.config.ts run      # Run once
 *   npx vitest run api/tests/hateoas.test.ts          # Run specific file
 *
 * @module api/vitest.config
 */

import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    // Include ALL api tests
    include: [
      'tests/**/*.test.ts',
    ],

    // Exclude only non-test files
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

        // Use single worker mode for stability
        singleWorker: true,

        // Disable isolated storage for SQLite WAL compatibility
        isolatedStorage: false,

        // Additional miniflare configuration
        miniflare: {
          durableObjectsPersist: false, // In-memory for tests (faster)
          bindings: {
            TEST_MODE: 'true',
          },
        },
      },
    },

    // Test timeouts (API operations need reasonable time)
    testTimeout: 15000,
    hookTimeout: 15000,
  },
})
