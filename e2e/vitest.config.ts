// E2E Test Configuration for testing SDKs against live deployed Workers
// See do-luhm.27, do-f8cq, do-iidr.20
import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    // E2E tests run in node environment by default
    environment: 'node',

    // Include test files in root and tests subdirectory
    include: ['**/*.test.ts'],

    // Exclude integration tests that don't need WORKER_URL from skipIf check
    // integration.test.ts uses mock server and doesn't require WORKER_URL
    exclude: ['**/node_modules/**'],

    // Longer timeouts for network calls and WebSocket operations
    testTimeout: 60000, // Extended for WebSocket hibernation tests
    hookTimeout: 30000,

    // Skip E2E tests if WORKER_URL is not set (CI consideration)
    // Tests will check this and skip themselves if not configured
    globals: true,

    // CRITICAL: Limit concurrency to prevent resource exhaustion
    maxConcurrency: 1,
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,

    // Root directory for resolving paths
    root: resolve(__dirname),

    // Setup file runs before tests (only for live worker tests)
    // Note: integration.test.ts uses mock server, doesn't need WORKER_URL setup
    setupFiles: ['./setup.ts'],

    // Isolate test files to avoid cross-contamination
    isolate: true,

    // Retry flaky network tests (especially WebSocket connections)
    retry: 2,

    // Reporter configuration
    reporters: ['verbose'],

    // Pool configuration for different environments
    poolOptions: {
      threads: {
        // Single thread for E2E to avoid rate limiting
        minThreads: 1,
        maxThreads: 1
      }
    },

    // Sequence configuration for WebSocket tests
    // Run WebSocket tests after other tests to avoid interference
    sequence: {
      shuffle: false,
    },

    // Coverage configuration
    // Note: E2E tests typically don't measure coverage as they test external services
    // but we include it for consistency. Coverage may be low as E2E tests external APIs.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/__tests__/**', '**/node_modules/**', '**/fixtures/**'],
      thresholds: {
        statements: 65,
        branches: 60,
        functions: 60,
        lines: 65,
      },
    },
  },

  // Resolve aliases for workspace packages
  resolve: {
    alias: {
      'rpc.do': resolve(__dirname, '../rpc.do/src'),
      'rpc.do/cli/repl': resolve(__dirname, '../rpc.do/src/cli/repl'),
      'rpc.do/cli/pull': resolve(__dirname, '../rpc.do/src/cli/pull'),
      'rpc.do/cli/eval': resolve(__dirname, '../rpc.do/src/cli/eval'),
      'rpc.do/transport/fetch': resolve(__dirname, '../rpc.do/src/transport/fetch'),
      'sdk.do': resolve(__dirname, '../sdk.do/src'),
      'platform.do': resolve(__dirname, '../platform.do/src'),
      '@dotdo/auth': resolve(__dirname, '../auth'),
      '@dotdo/oauth': resolve(__dirname, '../oauth/src'),
    },
  },
})
