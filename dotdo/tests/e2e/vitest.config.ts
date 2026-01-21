/**
 * CLI E2E Test Configuration
 *
 * These tests run in Node.js environment (not Workers) because:
 * 1. They execute real CLI commands using child_process
 * 2. They create/delete temporary directories using fs
 * 3. They test end-to-end CLI workflows
 *
 * Run with: npx vitest --config dotdo/tests/e2e/vitest.config.ts
 */
import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    // E2E tests run in node environment
    environment: 'node',

    // Include test files
    include: ['**/*.test.ts'],

    // Exclude
    exclude: ['**/node_modules/**'],

    // Longer timeouts for CLI operations (can be slow)
    testTimeout: 120000, // 2 minutes for CLI commands
    hookTimeout: 60000,

    // Globals for describe/it/expect
    globals: true,

    // CRITICAL: Limit concurrency - CLI tests must run sequentially
    maxConcurrency: 1,
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,

    // Root directory
    root: resolve(__dirname),

    // Isolate test files
    isolate: true,

    // Retry flaky tests
    retry: 1,

    // Reporter
    reporters: ['verbose'],

    // Pool configuration
    poolOptions: {
      threads: {
        minThreads: 1,
        maxThreads: 1
      }
    },

    // Run tests in sequence (not shuffled)
    sequence: {
      shuffle: false,
    },
  },

  // Resolve aliases
  resolve: {
    alias: {
      'dotdo': resolve(__dirname, '../..'),
    },
  },
})
