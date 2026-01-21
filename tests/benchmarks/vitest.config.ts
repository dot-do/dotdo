/**
 * Vitest Configuration for Benchmark Tests with Real Miniflare DOs
 *
 * This configuration uses @cloudflare/vitest-pool-workers to run benchmarks
 * inside the Cloudflare Workers runtime with real Durable Objects.
 *
 * NO MOCKS: Per CLAUDE.md, all benchmarks use real miniflare instances
 * with real SQLite storage, not vi.fn() mocks.
 *
 * Usage:
 *   npx vitest --config tests/benchmarks/vitest.config.ts        # Watch mode
 *   npx vitest --config tests/benchmarks/vitest.config.ts run    # Run once
 *   npx vitest run tests/benchmarks/rpc-latency.bench.ts         # Single benchmark
 */

import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    globals: true,
    include: ['*.bench.ts'],
    exclude: ['**/node_modules/**'],

    // CRITICAL: Limit concurrency to prevent resource exhaustion
    // Benchmarks should run sequentially for accurate measurements
    maxConcurrency: 1,
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,

    // Benchmarks should run sequentially
    sequence: {
      shuffle: false,
    },

    // Pool worker options for real miniflare DOs
    poolOptions: {
      workers: {
        // Use benchmark-specific wrangler config
        wrangler: {
          configPath: './wrangler.jsonc',
        },

        // Use single worker mode to avoid isolated storage issues
        singleWorker: true,

        // Disable isolated storage for consistent benchmark state
        isolatedStorage: false,

        // Miniflare configuration
        miniflare: {
          // Enable DO SQL storage - in-memory for benchmarks (faster)
          durableObjectsPersist: false,

          // Benchmark bindings
          bindings: {
            BENCHMARK_MODE: 'true',
          },
        },
      },
    },

    // Longer timeout for benchmarks
    testTimeout: 120000,
    hookTimeout: 30000,

    // Show detailed output
    reporters: ['verbose'],
  },
})
