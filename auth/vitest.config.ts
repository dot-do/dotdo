/**
 * Vitest Configuration for Auth Package Tests
 *
 * Uses @cloudflare/vitest-pool-workers to ensure auth code
 * works correctly in the Cloudflare Workers runtime.
 *
 * IMPORTANT: Tests using this config get access to:
 * - JWT operations via jose (Workers-compatible)
 * - API key generation and validation (Web Crypto API)
 * - Session management
 * - JWKS validation
 *
 * Usage:
 *   npx vitest --config auth/vitest.config.ts          # Run all auth tests
 *   npx vitest --config auth/vitest.config.ts run      # Run once
 *   npx vitest run auth/tests/token.test.ts            # Run specific file
 *
 * @module auth/vitest.config
 */

import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    name: 'auth',

    // Include ALL auth tests
    include: [
      'tests/**/*.test.ts',
    ],

    // Exclude only non-test files
    exclude: [
      '**/node_modules/**',
    ],

    // CRITICAL: Limit concurrency to prevent resource exhaustion
    maxConcurrency: 1,
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,

    // Pool worker options
    poolOptions: {
      workers: {
        wrangler: {
          configPath: './wrangler.jsonc',
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
    testTimeout: 15000,
    hookTimeout: 15000,

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['*.ts'],
      exclude: ['**/*.test.ts', '**/__tests__/**', '**/node_modules/**', 'vitest.config.ts'],
      thresholds: {
        statements: 65,
        branches: 60,
        functions: 60,
        lines: 65,
      },
    },
  },
})
