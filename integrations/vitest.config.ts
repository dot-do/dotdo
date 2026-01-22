/**
 * Vitest Configuration for Integrations Package Tests
 *
 * Uses @cloudflare/vitest-pool-workers for testing in Cloudflare Workers runtime.
 *
 * Usage:
 *   npx vitest run --config integrations/vitest.config.ts
 *   npx vitest run --config integrations/vitest.config.ts integrations/tests/stripe.test.ts
 *
 * @module integrations/vitest.config
 */

import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'
import { workspaceAliases } from '../vitest.config'

export default defineWorkersConfig({
  // Inherit workspace aliases for package resolution
  resolve: {
    alias: workspaceAliases,
  },
  test: {
    name: 'integrations',
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**'],

    // CRITICAL: Limit concurrency
    maxConcurrency: 1,
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,

    poolOptions: {
      workers: {
        wrangler: {
          configPath: '../wrangler.jsonc',
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

    testTimeout: 30000,
    hookTimeout: 30000,

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['*.ts', '**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/tests/**',
        '**/dist/**',
        '**/node_modules/**',
        'vitest.config.ts',
      ],
      thresholds: {
        statements: 65,
        branches: 60,
        functions: 60,
        lines: 65,
      },
    },
  },
})
