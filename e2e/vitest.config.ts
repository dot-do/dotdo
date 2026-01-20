// E2E Test Configuration for testing SDKs against live deployed Workers
// See do-luhm.27
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // E2E tests run in node environment by default
    environment: 'node',

    // Separate test files by environment
    include: ['**/*.test.ts'],

    // Longer timeouts for network calls
    testTimeout: 30000,
    hookTimeout: 30000,

    // Skip E2E tests if WORKER_URL is not set (CI consideration)
    // Tests will check this and skip themselves if not configured
    globals: true,

    // Setup file runs before tests
    setupFiles: ['./setup.ts'],

    // Isolate test files to avoid cross-contamination
    isolate: true,

    // Retry flaky network tests
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

    // Coverage configuration
    // Note: E2E tests typically don't measure coverage as they test external services
    // but we include it for consistency. Coverage may be low as E2E tests external APIs.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/__tests__/**', '**/node_modules/**'],
      thresholds: {
        statements: 65,
        branches: 60,
        functions: 60,
        lines: 65,
      },
    },
  }
})
