/**
 * Vitest configuration for @dotdo/utils package
 *
 * Tests for shared utility functions: logger, proxy utilities, time constants.
 * Runs in the Cloudflare Workers runtime via @cloudflare/vitest-pool-workers.
 *
 * Usage:
 *   npx vitest run utils/tests/              # Run all utils tests
 *   npx vitest run utils/tests/logger.test.ts # Run specific test file
 *
 * @module utils/vitest.config
 */

import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'
import { resolve } from 'path'

// Project root
const root = resolve(__dirname, '..')

export default defineWorkersConfig({
  resolve: {
    alias: {
      '@dotdo/utils/proxy': resolve(root, 'utils/proxy.ts'),
      '@dotdo/utils/logger': resolve(root, 'utils/logger.ts'),
      '@dotdo/utils': resolve(root, 'utils/index.ts'),
    },
  },
  test: {
    name: '@dotdo/utils',
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
