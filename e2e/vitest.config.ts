// E2E Test Configuration for testing SDKs against live deployed Workers
// See do-luhm.27, do-f8cq
import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    // E2E tests run in node environment by default
    environment: 'node',

    // Include test files in root and tests subdirectory
    include: ['**/*.test.ts'],

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

    // Setup file runs before tests
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
      exclude: ['**/*.test.ts', '**/__tests__/**', '**/node_modules/**'],
      thresholds: {
        statements: 75,
        branches: 70,
        functions: 75,
        lines: 75,
      },
    },
  }
})
