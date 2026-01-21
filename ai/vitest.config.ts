/**
 * Vitest Configuration for AI Package Tests
 *
 * Uses @cloudflare/vitest-pool-workers to ensure AI code
 * works correctly in the Cloudflare Workers runtime.
 *
 * IMPORTANT: Tests using this config get access to:
 * - Template literal AI processing
 * - Multi-provider routing
 * - Streaming responses
 * - AI promise handling
 *
 * Usage:
 *   npx vitest --config ai/vitest.config.ts          # Run all AI tests
 *   npx vitest --config ai/vitest.config.ts run      # Run once
 *   npx vitest run ai/tests/template.test.ts         # Run specific file
 *
 * @module ai/vitest.config
 */

import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    // Include ALL AI tests (including do-integration.test.ts)
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
    testTimeout: 30000,
    hookTimeout: 30000,

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['*.ts'],
      exclude: ['**/*.test.ts', '**/__tests__/**', '**/node_modules/**', 'vitest.config.ts', 'examples/**'],
      thresholds: {
        statements: 65,
        branches: 60,
        functions: 60,
        lines: 65,
      },
    },
  },
})
