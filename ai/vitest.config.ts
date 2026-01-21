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
import { resolve } from 'path'
import { workspaceAliases } from '../vitest.config'

// Directory for this package
const aiDir = __dirname

export default defineWorkersConfig({
  // Inherit workspace aliases and add stubs for optional AI dependencies
  resolve: {
    alias: {
      ...workspaceAliases,
      // Map optional AI packages to stubs that throw MODULE_NOT_FOUND errors
      // This triggers the mock fallback behavior in models.ts and providers/index.ts
      'ai-providers': resolve(aiDir, 'stubs/ai-providers.ts'),
      'ai': resolve(aiDir, 'stubs/ai.ts'),
      '@ai-sdk/openai': resolve(aiDir, 'stubs/@ai-sdk/openai.ts'),
      '@ai-sdk/anthropic': resolve(aiDir, 'stubs/@ai-sdk/anthropic.ts'),
      '@ai-sdk/google': resolve(aiDir, 'stubs/@ai-sdk/google.ts'),
    },
  },
  test: {
    name: 'ai',

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
