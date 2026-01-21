/**
 * CLI Package Test Configuration
 *
 * The CLI package (dotdo) runs in Node.js environment (not Workers) because:
 * 1. CLI commands use Node.js built-in modules (fs, os, child_process)
 * 2. Tests interact with file system and spawn processes
 * 3. CLI is the user-facing entrypoint, not a worker
 *
 * Run with: npx vitest --config dotdo/vitest.config.ts
 */
import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

const root = resolve(__dirname, '..')

export default defineConfig({
  test: {
    name: 'dotdo-cli',
    // CLI tests run in node environment
    environment: 'node',

    // Include test files
    include: ['tests/**/*.test.ts', 'sdk/tests/**/*.test.ts'],

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
    root: __dirname,

    // Reporter
    reporters: ['verbose'],

    // Pool configuration
    poolOptions: {
      threads: {
        minThreads: 1,
        maxThreads: 1,
      },
    },
  },

  // Resolve aliases
  resolve: {
    alias: {
      'dotdo': resolve(__dirname, 'index.ts'),
      '@dotdo/do': resolve(root, 'do/index.ts'),
      '@dotdo/db': resolve(root, 'db/index.ts'),
      '@dotdo/rpc': resolve(root, 'rpc/index.ts'),
      '@dotdo/api': resolve(root, 'api/index.ts'),
      '@dotdo/auth': resolve(root, 'auth/index.ts'),
      '@dotdo/mcp': resolve(root, 'mcp/index.ts'),
      '@dotdo/ai': resolve(root, 'ai/index.ts'),
      '@dotdo/utils': resolve(root, 'utils/index.ts'),
    },
  },
})
