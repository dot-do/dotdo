/**
 * Vitest Workers Configuration for @dotdo/duckdb-worker
 *
 * Configuration for tests that run in the Cloudflare Workers runtime.
 * Uses @cloudflare/vitest-pool-workers for true Workers environment testing.
 *
 * @see https://developers.cloudflare.com/workers/testing/vitest-integration/
 */

import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'
import { resolve } from 'path'

export default defineWorkersConfig({
  test: {
    // Enable globals (describe, it, expect) without imports
    globals: true,

    // Test files to include
    include: ['**/*.test.ts'],

    // Exclude non-workers tests
    exclude: ['**/node_modules/**', '**/dist/**'],

    // Use Cloudflare Workers pool
    pool: '@cloudflare/vitest-pool-workers',

    poolOptions: {
      workers: {
        // Use wrangler.jsonc for bindings
        wrangler: {
          configPath: resolve(__dirname, '../../wrangler.jsonc'),
        },

        // Miniflare options
        miniflare: {
          // Enable verbose logging in debug mode
          verbose: process.env.DEBUG === 'true',

          // Compatibility settings - use supported date
          compatibilityDate: '2025-09-06',
          compatibilityFlags: ['nodejs_compat'],

          // Modules rules for WASM (ES module style imports)
          modulesRules: [
            { type: 'CompiledWasm', include: ['**/*.wasm'] },
          ],
        },

        // Isolate storage between tests for deterministic results
        isolatedStorage: true,

        // Single worker mode for CI stability
        singleWorker: true,
      },
    },

    // Test timeout for Workers tests (WASM loading may be slower)
    testTimeout: 30_000,
    hookTimeout: 30_000,

    // Retry flaky tests in CI
    retry: process.env.CI ? 1 : 0,

    // Sequential execution for stability
    sequence: {
      concurrent: false,
    },
  },

  resolve: {
    alias: {
      '@dotdo/duckdb-worker': resolve(__dirname, '../../src/index.ts'),
    },
  },
})
