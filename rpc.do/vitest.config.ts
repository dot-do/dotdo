/**
 * Vitest Configuration for rpc.do Package Tests
 *
 * This configuration runs RPC client/server tests in Node environment
 * since they don't require Durable Objects or Workers runtime.
 *
 * IMPORTANT: Tests using this config get access to:
 * - Cap'n Web RPC client/server
 * - Transport layers (fetch, etc.)
 * - Auth flows (OAuth device flow, token refresh)
 * - CLI commands (login, pull, eval, repl, lsp)
 *
 * Usage:
 *   npx vitest --config rpc.do/vitest.config.ts          # Run all tests
 *   npx vitest --config rpc.do/vitest.config.ts run      # Run once
 *   npx vitest run rpc.do/tests/transport.test.ts        # Run specific file
 *
 * @module rpc.do/vitest.config
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
    testTimeout: 10_000,

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/__tests__/**',
        '**/node_modules/**',
        '**/dist/**',
        'vitest.config.ts',
        'tsup.config.ts',
      ],
      thresholds: {
        lines: 80,
        branches: 70,
        functions: 75,
        statements: 80,
      },
    },
  },
})
