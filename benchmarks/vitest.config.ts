import { defineConfig } from 'vitest/config'

/**
 * Vitest configuration for benchmark tests
 *
 * Key features:
 * - Sequential execution (no parallel) to avoid resource contention
 * - 5 minute timeout per test for long-running benchmarks
 * - No watch mode (run once and exit)
 * - Verbose reporter for detailed output
 *
 * Test structure:
 * - lib/tests/ - Unit tests for benchmark infrastructure (mocked)
 * - tests/ - Integration tests with mock DOs (mocked)
 * - perf/ - Performance tests against deployed infrastructure (requires .perf.do domains)
 */
export default defineConfig({
  test: {
    // Include benchmark test files
    // lib/tests and tests/ use mocks and run locally
    // perf/ requires deployed infrastructure (run separately with --filter perf/)
    include: ['lib/tests/**/*.test.ts', 'tests/**/*.test.ts'],

    // Exclude from global test runs
    root: '.',

    // Sequential execution - critical for accurate benchmark measurements
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },

    // Disable parallel execution
    sequence: {
      concurrent: false,
    },

    // 5 minute timeout per test (300000ms)
    testTimeout: 300000,

    // Hook timeout for setup/teardown
    hookTimeout: 60000,

    // Verbose reporter for detailed output
    reporters: ['verbose'],

    // No watch mode - run once and exit
    watch: false,

    // Global setup
    globals: true,

    // Environment
    environment: 'node',

    // Retry failed tests once
    retry: 1,

    // Coverage configuration (optional, for CI)
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['lib/**/*.ts'],
      exclude: ['lib/tests/**', 'lib/**/*.test.ts'],
    },
  },
})
