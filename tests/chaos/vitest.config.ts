/**
 * Vitest Configuration for Chaos Engineering Tests
 *
 * These tests verify system resilience under various failure conditions.
 * They use a Node environment since they don't require real Cloudflare Workers runtime.
 *
 * Usage:
 *   npx vitest --config tests/chaos/vitest.config.ts
 *   npx vitest run --config tests/chaos/vitest.config.ts
 *
 * @module tests/chaos/vitest.config
 * @see do-fhng.9
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,

    // Include chaos tests only
    include: ['tests/chaos/**/*.test.ts'],

    // Chaos tests may have higher timeout requirements
    testTimeout: 60_000,
    hookTimeout: 30_000,

    // Single worker to avoid resource exhaustion
    maxConcurrency: 1,
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,

    // Retry flaky tests due to probabilistic nature of chaos testing
    retry: 1,
  },
})
