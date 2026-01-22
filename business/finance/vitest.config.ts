/**
 * Vitest Configuration for @dotdo/business-finance Tests
 *
 * Simple node-based tests - no workers/miniflare needed since
 * FinancialClient is a pure TypeScript interface.
 *
 * @module business/finance/vitest.config
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**'],

    // Standard Node.js environment
    environment: 'node',

    // Single worker to avoid memory issues
    maxConcurrency: 1,
    maxWorkers: 1,
    fileParallelism: false,

    testTimeout: 10000,
  },
})
