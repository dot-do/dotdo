/**
 * Vitest configuration for @dotdo/core package
 *
 * Tests for core types, interfaces, and utility functions.
 * Runs in the Cloudflare Workers runtime via @cloudflare/vitest-pool-workers.
 *
 * Usage:
 *   npx vitest run core/tests/              # Run all core tests
 *   npx vitest run core/tests/polymorphic.test.ts # Run specific test file
 *
 * @module core/vitest.config
 */

import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'
import { resolve } from 'path'

// Project root
const root = resolve(__dirname, '..')

export default defineWorkersConfig({
  resolve: {
    alias: {
      '@dotdo/core': resolve(root, 'core/src/index.ts'),
    },
  },
  test: {
    name: '@dotdo/core',
    globals: true,

    // Only include tests from this package
    include: ['tests/**/*.test.ts'],

    // Exclude external packages
    exclude: ['**/node_modules/**', '**/dist/**'],

    // CRITICAL: Limit concurrency
    maxConcurrency: 1,
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,

    // Pool worker options for miniflare runtime
    poolOptions: {
      workers: {
        // Use root wrangler config
        wrangler: {
          configPath: resolve(root, 'wrangler.jsonc'),
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
  },
})
