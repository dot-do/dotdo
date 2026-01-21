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
import { workspaceAliases } from '../vitest.config'

export default defineWorkersConfig({
  // Inherit workspace aliases for package resolution
  resolve: {
    alias: workspaceAliases,
  },
  test: {
    // Include ALL api tests
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
