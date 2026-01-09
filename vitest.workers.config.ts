/**
 * Vitest Workers Configuration
 *
 * Configuration for tests that run in the Cloudflare Workers runtime.
 * Uses @cloudflare/vitest-pool-workers for true Workers environment testing.
 *
 * Features:
 * - Isolated storage between tests (KV, DO, etc.)
 * - Single worker mode for stability
 * - Access to cloudflare:test utilities (env, SELF, fetchMock)
 * - D1 migrations support
 *
 * Extended by vitest.workspace.ts for the 'workers' project.
 *
 * @see https://developers.cloudflare.com/workers/testing/vitest-integration/
 */

import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    // Enable globals (describe, it, expect) without imports
    globals: true,

    // Use Cloudflare Workers pool
    pool: '@cloudflare/vitest-pool-workers',

    poolOptions: {
      workers: {
        // Use the main wrangler config for bindings
        wrangler: { configPath: './wrangler.jsonc' },

        // Isolate storage between tests for deterministic results
        // Each test starts with clean KV, DO, etc.
        isolatedStorage: true,

        // Single worker mode for CI stability
        // Prevents race conditions between parallel tests
        singleWorker: true,

        // Miniflare options for local development
        miniflare: {
          // Enable verbose logging in debug mode
          verbose: process.env.DEBUG === 'true',

          // Compatibility settings
          compatibilityDate: '2026-01-08',
          compatibilityFlags: ['nodejs_compat'],
        },
      },
    },

    // Test timeout for Workers tests (network operations may be slower)
    testTimeout: 15_000,
    hookTimeout: 15_000,

    // Retry flaky tests in CI
    retry: process.env.CI ? 1 : 0,
  },
})
