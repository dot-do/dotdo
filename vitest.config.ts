/**
 * Root Vitest Configuration for dotdo v3
 *
 * CRITICAL: ALL tests run on @cloudflare/vitest-pool-workers
 * This ensures all code actually works in the Cloudflare Workers runtime.
 *
 * Packages with special DO bindings have their own vitest.config.ts files
 * and are configured via test.projects (Vitest 3.2+):
 * - do/ (DO binding)
 * - api/ (DO binding)
 * - db/ (DO binding)
 * - business/ (BUSINESS binding)
 * - mcp/ (DO binding)
 * - rpc.do/ (Node environment for CLI)
 *
 * Usage:
 *   npm test                              # Run all tests
 *   npx vitest run auth/tests/            # Run auth tests
 *   npx vitest run do/tests/              # Run DO tests (via projects)
 *   npx vitest --project=objects          # Run only DO tests
 *   npx vitest --project=workers          # Run only Workers tests
 *
 * @module vitest.config
 */

import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    name: 'workers',
    globals: true,

    // Projects configuration (replaces deprecated vitest.workspace.ts)
    // Each package with custom DO bindings or special requirements has its own vitest.config.ts
    projects: [
      // Durable Object packages with custom bindings
      './do/vitest.config.ts',
      './db/vitest.config.ts',
      './api/vitest.config.ts',
      './mcp/vitest.config.ts',
      './business/vitest.config.ts',
      // RPC packages
      './rpc/vitest.config.ts',
      './rpc.do/vitest.config.ts',
      // Auth packages
      './auth/vitest.config.ts',
      './oauth/vitest.config.ts',
      // AI package
      './ai/vitest.config.ts',
    ],

    // CRITICAL: Limit concurrency to prevent resource exhaustion
    // Workers pool with miniflare is memory-intensive
    maxConcurrency: 1,
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,

    // Include test packages that work with the root wrangler.jsonc
    // Note: Core packages (auth, oauth, ai, rpc, etc.) now have their own configs in projects array
    include: [
      // SDK packages
      'sdk.do/tests/**/*.test.ts',
      'platform.do/tests/**/*.test.ts',
      // Main dotdo package
      'dotdo/tests/**/*.test.ts',
      'dotdo/sdk/tests/**/*.test.ts',
      // Application packages
      'app/tests/**/*.test.ts',
      'e2e/tests/**/*.test.ts',
      'apps/**/tests/**/*.test.ts',
      // Additional packages
      'tests/benchmarks/**/*.test.ts',
      'testing/**/*.test.ts',
      'observability/tests/**/*.test.ts',
      'utils/tests/**/*.test.ts',
      'integrations/tests/**/*.test.ts',
    ],

    // Exclude external packages and archived versions
    // Note: Packages in projects array are automatically excluded
    exclude: [
      '**/node_modules/**',
      '**/.worktrees/**',
      '**/primitives/**',
      '**/dist/**',
      '**/build/**',
    ],

    // Pool worker options for miniflare runtime
    poolOptions: {
      workers: {
        // Use root wrangler config for DO bindings
        wrangler: {
          configPath: './wrangler.jsonc',
        },

        // Use single worker mode to avoid isolated storage issues with SQLite
        // See: https://developers.cloudflare.com/workers/testing/vitest-integration/known-issues/#isolated-storage
        singleWorker: true,

        // Disable isolated storage to work around SQLite WAL issues
        // This is a known limitation when DOs use state.storage.sql
        isolatedStorage: false,

        // Additional miniflare configuration
        miniflare: {
          // Enable DO SQL storage - in-memory for tests (faster)
          durableObjectsPersist: false,

          // Enable unsafe-eval for _eval() tests
          // This allows new Function() and eval() in the workers runtime
          unsafeEvalBinding: 'UNSAFE_EVAL',

          // Add any additional bindings needed for tests
          bindings: {
            TEST_MODE: 'true',
          },
        },
      },
    },

    // Test timeouts (DO operations can be slower)
    testTimeout: 30000,
    hookTimeout: 30000,

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: [
        'auth/**/*.ts',
        'oauth/src/**/*.ts',
        'ai/**/*.ts',
        'rpc/**/*.ts',
        'rpc.do/src/**/*.ts',
        'db/**/*.ts',
        'do/**/*.ts',
        'api/**/*.ts',
        'mcp/**/*.ts',
        'business/**/*.ts',
        'dotdo/src/**/*.ts',
        'apps/**/src/**/*.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/__tests__/**',
        '**/node_modules/**',
        '**/.worktrees/**',
        '**/primitives/**',
        '**/dist/**',
        '**/build/**',
        '**/vitest.config.ts',
        '**/wrangler.jsonc',
      ],
      thresholds: {
        statements: 65,
        branches: 60,
        functions: 60,
        lines: 65,
      },
    },
  },
})
