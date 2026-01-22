/**
 * Vitest Configuration for example.com.ai Parent DO Tests
 *
 * This example demonstrates a hierarchical DO architecture where:
 * - Parent DO (example.com.ai) aggregates events from children
 * - Child DOs (crm.example.com.ai/:tenant) phone home to parent
 *
 * These are unit tests that define the expected interfaces.
 * They will fail until the implementation is complete.
 *
 * Usage:
 *   npx vitest run examples/example.com.ai/tests/
 *
 * @module examples/example.com.ai/vitest.config
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'example.com.ai',
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,

    // CRITICAL: Limit concurrency to prevent resource exhaustion
    maxConcurrency: 1,
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/__tests__/**', '**/node_modules/**'],
    },
  },
})
