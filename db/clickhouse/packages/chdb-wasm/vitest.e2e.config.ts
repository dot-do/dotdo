/**
 * Vitest Configuration for E2E Tests
 *
 * =============================================================================
 * TEST ENVIRONMENT: Node.js (orchestrates HTTP requests)
 * =============================================================================
 *
 * E2E tests run in Node.js and make HTTP requests to:
 * - Local workers spun up via wrangler's unstable_dev (most E2E tests)
 * - Deployed workers via WORKER_URL env var (deployed-worker.test.ts)
 *
 * This is separate from vitest.config.ts because E2E tests:
 * - Need Node.js to orchestrate HTTP requests and worker lifecycle
 * - Spin up/tear down local workers using wrangler's unstable_dev
 * - Test the full HTTP request/response cycle
 * - May test against remote deployed workers
 *
 * Commands:
 * - pnpm test:e2e                    Run all E2E tests
 * - pnpm test:e2e:deployed           Run tests against deployed worker (requires WORKER_URL)
 *
 * Environment Variables:
 * - WORKER_URL: URL of deployed worker (for deployed-worker.test.ts)
 * - WORKER_ENV: Environment to test (staging, production)
 */
import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    // Use node environment - we orchestrate HTTP requests from Node.js
    environment: 'node',

    // Include all E2E test files
    include: ['tests/e2e/**/*.test.ts'],

    // Exclude other test directories
    exclude: ['tests/unit/**', 'tests/workers/**', 'tests/integration/**', '**/node_modules/**'],

    // Enable globals for describe, it, expect
    globals: true,

    // Longer timeout for E2E tests (worker startup can take time)
    testTimeout: 60000,

    // Hook timeout for beforeAll/afterAll (worker startup/teardown)
    hookTimeout: 60000,

    // Run tests sequentially - they may share worker instances
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },

    // Retry failed tests once (network issues, worker startup delays)
    retry: 1,

    // Setup file for E2E tests (starts local worker)
    setupFiles: ['./tests/e2e/setup.ts'],

    // TypeScript configuration
    typecheck: {
      enabled: false,
    },
  },

  // Resolve configuration
  resolve: {
    alias: {
      '@dotdo/chdb-wasm': path.resolve(__dirname, './src/index.ts'),
    },
  },

  // ESBuild options
  esbuild: {
    target: 'esnext',
  },
});
