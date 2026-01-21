/**
 * Vitest Configuration for Database Tests
 *
 * This configuration uses @cloudflare/vitest-pool-workers to run tests
 * inside the Cloudflare Workers runtime with real SQLite storage.
 *
 * IMPORTANT: Tests using this config get access to:
 * - Real SQLite via state.storage.sql
 * - Real DurableObjectState with actual storage
 * - Real concurrency handling
 *
 * Usage:
 *   npx vitest --config db/vitest.config.ts           # Run all DB tests
 *   npx vitest --config db/vitest.config.ts run       # Run once
 *   npx vitest run db/tests/sqlite.test.ts            # Run specific file
 *
 * @module db/vitest.config
 */

import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    // Include ALL db tests
    include: [
      'tests/**/*.test.ts',
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

    // Test timeouts (SQLite operations can be slower)
    testTimeout: 30000,
    hookTimeout: 30000,

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/__tests__/**', '**/node_modules/**'],
      thresholds: {
        statements: 75,
        branches: 70,
        functions: 75,
        lines: 75,
      },
    },
  },
})
