/**
 * Root Vitest Configuration for dotdo v3
 *
 * This configuration handles Node environment tests. For Workers environment
 * tests that need real Durable Objects, use the package-specific configs:
 *
 *   npx vitest --config do/vitest.config.ts      # DO tests (real miniflare)
 *   npx vitest --config db/vitest.config.ts      # DB tests (real SQLite)
 *
 * Or use the convenience scripts in package.json:
 *   npm test                    # Run all tests
 *   npm run test:do             # Run DO tests only
 *   npm run test:db             # Run DB tests only
 *
 * Test Environment Strategy:
 * ==========================
 *
 * Node Environment (this config):
 * - auth/tests/** - JWT, API keys, sessions (no DO needed)
 * - ai/tests/** - Template literals, routing (no DO needed)
 * - rpc/tests/** - RPC layer tests (no DO needed)
 * - dotdo/tests/** - Main package tests (no DO needed)
 * - app/tests/** - TanStack Start frontend tests (no DO needed)
 *
 * Workers Environment (use do/vitest.config.ts):
 * - do/tests/** - DO class tests with real miniflare
 * - db/tests/** - SQLite tests requiring state.storage.sql
 * - mcp/tests/** - MCP tools requiring DO bindings
 * - api/tests/** - API integration tests
 *
 * WHY separate configs?
 * @cloudflare/vitest-pool-workers replaces the entire test runner to provide
 * real Durable Object instances. Tests using `cloudflare:test` imports MUST
 * run with the workers pool config.
 *
 * @module vitest.config
 */

import { defineConfig } from 'vitest/config'

const defaultExcludes = [
  '**/node_modules/**',
  '**/.worktrees/**',
  '**/primitives/**',
  '**/dist/**',
  '**/build/**',
  // Exclude tests that use cloudflare:test imports - they have workers configs
  'ai/tests/do-integration.test.ts',
  'rpc/tests/miniflare-integration.test.ts',
  'rpc/tests/cross-do.test.ts',
]

export default defineConfig({
  test: {
    globals: true,

    // CRITICAL: Limit concurrency to prevent resource exhaustion
    // Vitest can consume ~100GB RAM without these limits
    maxConcurrency: 1,
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,

    // Include Node-based tests that don't need Workers runtime
    // IMPORTANT: Packages with cloudflare:test imports have their own workers configs:
    //   - do/vitest.config.ts
    //   - db/vitest.config.ts
    //   - api/vitest.config.ts
    //   - business/vitest.config.ts
    //   - mcp/vitest.config.ts
    //   - rpc/vitest.config.ts (for miniflare-integration.test.ts, cross-do.test.ts)
    //   - ai/vitest.workers.config.ts (for do-integration.test.ts)
    //   - fsx/vitest.config.ts
    //   - tests/chaos/vitest.config.ts
    include: [
      'auth/tests/**/*.test.ts',
      'oauth/tests/**/*.test.ts',
      // AI tests except do-integration.test.ts (uses workers config)
      'ai/tests/**/*.test.ts',
      // RPC tests except miniflare-integration and cross-do (use workers config)
      'rpc/tests/**/*.test.ts',
      'rpc.do/tests/**/*.test.ts',
      'dotdo/tests/**/*.test.ts',
      'dotdo/sdk/tests/**/*.test.ts',
      // business tests use workers pool (have cloudflare:test imports) - EXCLUDED
      // 'business/tests/**/*.test.ts',
      'app/tests/**/*.test.ts',
      'e2e/tests/**/*.test.ts',
      'apps/**/tests/**/*.test.ts',
      'tests/benchmarks/**/*.test.ts',
      'testing/**/*.test.ts',
      'observability/tests/**/*.test.ts',
      'utils/tests/**/*.test.ts',
      'integrations/tests/**/*.test.ts',
    ],

    // Exclude tests that use cloudflare:test imports (they use workers configs)
    // Also exclude worktrees, primitives, dist, etc.

    exclude: defaultExcludes,

    // Reasonable timeouts for Node tests
    testTimeout: 10_000,
    hookTimeout: 10_000,

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: [
        'auth/src/**/*.ts',
        'oauth/src/**/*.ts',
        'ai/src/**/*.ts',
        'rpc/src/**/*.ts',
        'rpc.do/src/**/*.ts',
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
