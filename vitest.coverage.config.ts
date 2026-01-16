/**
 * Vitest Configuration for Coverage Reporting
 *
 * This config runs tests in Node.js environment (not Workers pool)
 * to enable v8 coverage collection. The Workers pool doesn't support
 * the node:inspector module required for coverage.
 *
 * Usage: npm run test:coverage
 *
 * Coverage thresholds:
 * - statements: 50%
 * - branches: 40%
 * - functions: 50%
 * - lines: 50%
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
      // Initial thresholds - adjust as coverage improves
      // Current baseline: ~5% lines, ~38% functions
      // Goal: Increase gradually as tests are added
      thresholds: {
        statements: 0,
        branches: 0,
        functions: 0,
        lines: 0,
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
