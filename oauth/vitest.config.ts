/**
 * Vitest Configuration for OAuth Package Tests
 *
 * This configuration runs oauth tests in Node environment since they
 * don't require Durable Objects or Workers runtime.
 *
 * IMPORTANT: Tests using this config get access to:
 * - PKCE generation and validation (Web Crypto API)
 * - State token generation and validation
 * - OAuth 2.1 utilities
 *
 * Usage:
 *   npx vitest --config oauth/vitest.config.ts          # Run all oauth tests
 *   npx vitest --config oauth/vitest.config.ts run      # Run once
 *   npx vitest run oauth/tests/pkce.test.ts             # Run specific file
 *
 * @module oauth/vitest.config
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Include ALL oauth tests
    include: ['tests/**/*.test.ts'],

    // Exclude only non-test files
    exclude: ['**/node_modules/**'],

    // CRITICAL: Limit concurrency to prevent resource exhaustion
    maxConcurrency: 1,
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,

    // Reasonable timeouts for oauth tests
    testTimeout: 10000,
    hookTimeout: 10000,

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/__tests__/**',
        '**/node_modules/**',
        'vitest.config.ts',
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
})
