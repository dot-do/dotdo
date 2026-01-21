/**
 * Vitest Node Configuration for Persistence Tests
 *
 * These tests use Miniflare directly to test persistence across DO restarts.
 * They must run in a Node environment (not Workers pool) because they:
 * 1. Import `Miniflare` from 'miniflare' package directly
 * 2. Use Node APIs like `node:os` for temp directory creation
 * 3. Create multiple Miniflare instances to simulate DO restarts
 *
 * Usage:
 *   npx vitest run --config do/vitest.node.config.ts
 *   npx vitest run --config do/vitest.node.config.ts tests/persistence.test.ts
 *
 * @module do/vitest.node.config
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Include only the persistence tests that use Miniflare directly
    include: [
      'tests/persistence.test.ts',
      'tests/storage-persistence.test.ts',
      'tests/miniflare-integration.test.ts',
      'tests/error-recovery-edge-cases.test.ts',
    ],

    // Standard exclusions
    exclude: ['**/node_modules/**'],

    // Reasonable timeouts - these tests create/dispose Miniflare instances
    testTimeout: 60_000,
    hookTimeout: 30_000,

    // CRITICAL: Limit concurrency to prevent resource exhaustion
    // Run sequentially to avoid resource contention between Miniflare instances
    maxConcurrency: 1,
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,

    // Use default Node environment (not workers pool)
    // This allows importing 'miniflare' and 'node:os'
  },
})
