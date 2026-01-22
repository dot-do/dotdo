/**
 * Unified Vitest Configuration for Cloudflare Workers Runtime
 *
 * =============================================================================
 * TEST ENVIRONMENT: workerd (Cloudflare Workers Runtime)
 * =============================================================================
 *
 * ALL tests in this project run in the workerd runtime via @cloudflare/vitest-pool-workers,
 * ensuring tests run in the same environment as production (Cloudflare Workers).
 *
 * CONFIGURATION FILES:
 * --------------------
 * - vitest.config.ts (this file)
 *     Default config for unit, workers, and integration tests.
 *     Runs in workerd via @cloudflare/vitest-pool-workers.
 *     Command: pnpm test
 *
 * - vitest.e2e.config.ts
 *     E2E tests that spin up a local worker via wrangler unstable_dev.
 *     Runs in Node.js (orchestrates HTTP requests to local/deployed workers).
 *     Command: pnpm test:e2e
 *
 * - vitest.node.config.ts
 *     Static analysis tests that need Node.js fs (e.g., reading source files).
 *     Used only for tests that cannot run in workerd.
 *     Command: pnpm test:node
 *
 * BENEFITS OF RUNNING ALL TESTS IN WORKERD:
 * -----------------------------------------
 * - WASM loading behavior matches production
 * - Memory limits enforced (128MB on Workers)
 * - CPU time limits enforced
 * - Workers-specific APIs available (R2, KV, DO bindings)
 * - Web Crypto API matches production
 * - Event loop behavior matches production
 * - No WASM mocks needed - tests use real WASM modules
 *
 * TEST DIRECTORIES:
 * -----------------
 * - tests/unit/       Unit tests (isolated, fast)
 * - tests/workers/    Workers runtime-specific tests (WASM, memory, CPU limits)
 * - tests/integration/  Integration tests (cross-component, may need R2/KV)
 * - tests/e2e/        End-to-end tests (HTTP requests, run via vitest.e2e.config.ts)
 */
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    // Include unit, workers, and integration tests - all run in workerd
    include: [
      'tests/unit/**/*.test.ts',
      'tests/workers/**/*.test.ts',
      'tests/integration/**/*.test.ts',
      // Root-level test files
      'tests/*.test.ts',
    ],

    // Exclude tests that need special handling
    exclude: [
      '**/node_modules/**',
      // E2E tests use Node.js to orchestrate HTTP requests (see vitest.e2e.config.ts)
      '**/tests/e2e/**',
      // Note: security-new-function.test.ts was rewritten to test runtime behavior
      // instead of source scanning with Node.js fs, so it now runs in workerd
    ],

    // Enable globals for describe, it, expect
    globals: true,

    // Timeout for async operations (WASM loading can be slow)
    testTimeout: 60000,

    // Hook timeout for beforeAll/afterAll
    hookTimeout: 60000,

    // Pool workers configuration
    poolOptions: {
      workers: {
        // Enable isolated storage for each test
        isolatedStorage: true,

        // Miniflare configuration (workerd)
        miniflare: {
          // Compatibility date for Workers runtime
          compatibilityDate: '2024-01-01',

          // Enable nodejs_compat for broader Node.js API support
          compatibilityFlags: ['nodejs_compat'],

          // WASM module configuration - load actual WASM files (no mocks!)
          modulesRules: [
            {
              type: 'CompiledWasm',
              include: ['**/*.wasm'],
            },
          ],

          // Bindings available in tests via env
          bindings: {
            CHDB_VERSION: '0.1.0',
            ENVIRONMENT: 'test',
          },

          // R2 bucket bindings (mocked in-memory by miniflare)
          r2Buckets: {
            DATA_BUCKET: 'test-data-bucket',
            CLICKBENCH_BUCKET: 'test-clickbench-bucket',
          },

          // KV namespace bindings (mocked in-memory by miniflare)
          kvNamespaces: {
            CACHE: 'test-cache',
          },
        },

        // Wrangler integration - uses test-specific wrangler config
        wrangler: {
          configPath: './tests/workers/wrangler.test.toml',
        },

        // Main worker file for SELF binding
        main: './src/worker.ts',

        // Single worker mode for simpler tests
        singleWorker: true,
      },
    },

    // Retry failed tests once (helpful for flaky WASM loading)
    retry: 1,

    // TypeScript configuration
    typecheck: {
      enabled: false,
    },

    // Verbose output for better debugging
    reporters: ['verbose'],
  },

  // Resolve configuration
  resolve: {
    alias: {
      '@dotdo/chdb-wasm': './src/index.ts',
    },
  },

  // ESBuild options
  esbuild: {
    target: 'esnext',
  },
});
