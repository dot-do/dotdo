/**
 * CLI Unit Test Configuration
 *
 * These tests run in Node.js environment (not Workers) because:
 * 1. They test CLI command implementations directly
 * 2. They use fs/os modules for file operations
 * 3. They test argument parsing and command execution
 *
 * Run with: npx vitest --config dotdo/tests/unit/vitest.config.ts
 */
import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    // Unit tests run in node environment
    environment: 'node',

    // Include test files
    include: ['**/*.test.ts'],

    // Exclude
    exclude: ['**/node_modules/**'],

    // Timeouts for CLI operations
    testTimeout: 30000,
    hookTimeout: 30000,

    // Globals for describe/it/expect
    globals: true,

    // Concurrency settings
    maxConcurrency: 1,
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,

    // Root directory
    root: resolve(__dirname),

    // Isolate test files
    isolate: true,

    // Reporter
    reporters: ['verbose'],

    // Pool configuration
    poolOptions: {
      threads: {
        minThreads: 1,
        maxThreads: 1,
      },
    },

    // Run tests in sequence
    sequence: {
      shuffle: false,
    },
  },

  // Resolve aliases
  resolve: {
    alias: {
      dotdo: resolve(__dirname, '../..'),
    },
  },
})
