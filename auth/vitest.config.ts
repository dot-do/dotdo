/**
 * Vitest Configuration for Auth Package Tests
 *
 * This configuration runs auth tests in Node environment since they
 * don't require Durable Objects or Workers runtime.
 *
 * IMPORTANT: Tests using this config get access to:
 * - JWT operations via jose
 * - API key generation and validation
 * - Session management
 * - JWKS validation
 *
 * Usage:
 *   npx vitest --config auth/vitest.config.ts          # Run all auth tests
 *   npx vitest --config auth/vitest.config.ts run      # Run once
 *   npx vitest run auth/tests/token.test.ts            # Run specific file
 *
 * @module auth/vitest.config
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Include ALL auth tests
    include: [
      'tests/**/*.test.ts',
    ],

    // Exclude only non-test files
    exclude: [
      '**/node_modules/**',
    ],

    // CRITICAL: Limit concurrency to prevent resource exhaustion
    maxConcurrency: 1,
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,

    // Reasonable timeouts for auth tests
    testTimeout: 10000,
    hookTimeout: 10000,

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['*.ts'],
      exclude: ['**/*.test.ts', '**/__tests__/**', '**/node_modules/**', 'vitest.config.ts'],
      thresholds: {
        statements: 65,
        branches: 60,
        functions: 60,
        lines: 65,
      },
    },
  },
})
