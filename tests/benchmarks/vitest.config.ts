/**
 * Vitest Configuration for Benchmark Tests
 *
 * Separate configuration for benchmark tests to avoid interfering
 * with regular test suite.
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/benchmarks/*.bench.ts'],
    exclude: ['**/node_modules/**'],
    setupFiles: ['tests/benchmarks/setup.ts'],
    // Benchmarks should run sequentially
    sequence: {
      shuffle: false,
    },
    // Longer timeout for benchmarks
    testTimeout: 120000,
    // Don't watch for benchmarks
    watch: false,
    // Show detailed output
    reporters: ['verbose'],
  },
})
