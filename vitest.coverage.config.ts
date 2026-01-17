/**
 * Vitest Configuration for Coverage Reporting
 *
 * This config runs tests in Node.js environment (not Workers pool)
 * to enable v8 coverage collection. The Workers pool doesn't support
 * the node:inspector module required for coverage.
 *
 * Usage: npm run test:coverage
 *
 * Coverage thresholds (baseline 2026-01-16):
 * - statements: 10%
 * - branches: 2%
 * - functions: 2%
 * - lines: 10%
 *
 * These thresholds are set slightly below current coverage (~12% statements,
 * ~3.5% branches/functions) to prevent regression while allowing for variance.
 * Increase these values as coverage improves.
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['**/*.test.ts'],
    exclude: [
      'node_modules',
      'dist',
      // E2E tests need special handling
      'tests/e2e/**',
    ],
    testTimeout: 10_000,
    hookTimeout: 10_000,
    // Run in Node.js environment for coverage support
    environment: 'node',
    // Single-threaded for reliable coverage
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      exclude: [
        '**/*.test.ts',
        '**/node_modules/**',
        '**/dist/**',
        'tests/**',
        'coverage/**',
        '**/*.d.ts',
        'vitest.*.ts',
        'wrangler.*.ts',
        'app/**',
        'docs/**',
        'examples/**',
        'scripts/**',
        // Cloudflare-specific files that won't run in Node
        '.wrangler/**',
      ],
      // Coverage thresholds - baseline measured 2026-01-16
      // Current coverage: ~12% statements, ~3.5% branches, ~3.5% functions, ~12% lines
      // Setting thresholds slightly below to prevent regression while allowing variance
      thresholds: {
        statements: 10,
        branches: 2,
        functions: 2,
        lines: 10,
      },
    },
  },
  resolve: {
    alias: {
      // Mock cloudflare-specific modules for Node.js environment
      'cloudflare:workers': './tests/mocks/cloudflare-workers.ts',
      'cloudflare:test': './tests/mocks/cloudflare-test.ts',
    },
  },
})
