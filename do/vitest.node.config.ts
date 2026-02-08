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
import { resolve } from 'path'

const root = resolve(__dirname, '..')

export default defineConfig({
  resolve: {
    alias: {
      '@dotdo/db': resolve(root, 'db/index.ts'),
      '@dotdo/do': resolve(root, 'do/index.ts'),
      '@dotdo/utils': resolve(root, 'utils/index.ts'),
      '@dotdo/integrations': resolve(root, 'integrations/index.ts'),
      '@dotdo/observability': resolve(root, 'observability/index.ts'),
    },
  },
  test: {
    // Include persistence tests that use Miniflare directly AND
    // pure logic tests that don't need cloudflare:test runtime
    include: [
      'tests/persistence.test.ts',
      'tests/storage-persistence.test.ts',
      'tests/miniflare-integration.test.ts',
      'tests/error-recovery-edge-cases.test.ts',
      'tests/saga.test.ts',
      'tests/client.test.ts', // Client-side $Context tests (RED phase)
      'tests/with-transaction.test.ts', // Atomic multi-operation transactions (do-9mrsg)
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
