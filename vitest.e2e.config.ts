import { defineConfig } from 'vitest/config'

/**
 * Vitest configuration for E2E tests against deployed workers
 *
 * These tests run in Node.js and make HTTP requests to deployed workers.
 * They test the full stack including:
 * - RPC client connectivity
 * - Example deployments
 * - Authentication flows
 *
 * Configuration:
 *   TEST_URL - Base URL of deployed worker
 *   EXAMPLES_BASE_URL - URL pattern for examples (use {example} placeholder)
 *   TEST_TOKEN - Auth token for protected endpoints
 *
 * Run with:
 *   npx vitest run --config vitest.e2e.config.ts
 *
 * Or against deployed:
 *   TEST_URL=https://api.dotdo.dev npx vitest run --config vitest.e2e.config.ts
 */
export default defineConfig({
  test: {
    globals: true,
    include: ['tests/e2e/**/*.e2e.test.ts'],
    exclude: ['node_modules', 'dist'],
    testTimeout: 30_000, // Longer timeout for network requests
    hookTimeout: 30_000,
    // Run E2E tests sequentially to avoid rate limiting
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // Reporter for CI
    reporters: process.env.CI ? ['default', 'junit'] : ['default'],
    outputFile: {
      junit: './test-results/e2e-junit.xml',
    },
  },
})
