/**
 * Vitest Configuration for AI Package Tests
 *
 * This configuration runs AI tests in Node environment since they
 * don't require Durable Objects or Workers runtime.
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

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Include ALL ai tests
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

    // Reasonable timeouts for AI tests
    testTimeout: 10000,
    hookTimeout: 10000,

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['*.ts'],
      exclude: ['**/*.test.ts', '**/__tests__/**', '**/node_modules/**', 'vitest.config.ts', 'examples/**'],
      thresholds: {
        statements: 75,
        branches: 70,
        functions: 75,
        lines: 75,
      },
    },
  },
})
