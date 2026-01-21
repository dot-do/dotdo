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
import { workspaceAliases } from '../vitest.config'

export default defineWorkersConfig({
  // Inherit workspace aliases for package resolution
  resolve: {
    alias: workspaceAliases,
  },
  test: {
    // Include ALL db tests
    include: [
      'tests/**/*.test.ts',
    ],

    // Exclude non-test files and tests incompatible with vitest-pool-workers
    exclude: [
      '**/node_modules/**',
      // transactions.test.ts uses Miniflare directly with Node.js modules (os, fs, path)
      // which are incompatible with vitest-pool-workers
      'tests/transactions.test.ts',
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
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/__tests__/**', '**/node_modules/**'],
      thresholds: {
        statements: 65,
        branches: 60,
        functions: 60,
        lines: 65,
      },
    },
  },
})
