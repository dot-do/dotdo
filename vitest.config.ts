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
    include: [
      'auth/tests/**/*.test.ts',
      'ai/tests/**/*.test.ts',
      'rpc/tests/**/*.test.ts',
      'rpc.do/tests/**/*.test.ts',
      'dotdo/tests/**/*.test.ts',
      'app/tests/**/*.test.ts',
      'e2e/tests/**/*.test.ts',
      'apps/**/tests/**/*.test.ts',
      'tests/benchmarks/**/*.test.ts',
      'testing/**/*.test.ts',
      'observability/tests/**/*.test.ts',
      'utils/tests/**/*.test.ts',
      'integrations/tests/**/*.test.ts',
    ],

    exclude: defaultExcludes,

    // Reasonable timeouts for Node tests
    testTimeout: 10_000,
    hookTimeout: 10_000,

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'auth/src/**/*.ts',
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
