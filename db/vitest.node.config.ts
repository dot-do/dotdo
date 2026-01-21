/**
 * Vitest Node Configuration for SQLite Tests with Miniflare
 *
 * These tests use Miniflare directly to test SQLite storage with real DOs.
 * They must run in a Node environment (not Workers pool) because they:
 * 1. Import `Miniflare` from 'miniflare' package directly
 * 2. Use Node APIs like `node:os` for temp directory creation
 * 3. Create Miniflare instances with inline DO scripts
 *
 * This approach follows the NO MOCKS philosophy from CLAUDE.md:
 * "Durable Objects require NO MOCKING. Miniflare runs real DOs with real SQLite locally."
 *
 * Usage:
 *   npx vitest run --config db/vitest.node.config.ts
 *   npx vitest run --config db/vitest.node.config.ts tests/sqlite-adapter.test.ts
 *
 * @module db/vitest.node.config
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Include tests that use Miniflare directly (Node environment tests)
    // or pure-Node tests that don't need workers pool
    include: [
      'tests/sqlite-adapter.test.ts',
      'tests/sqlite-things.test.ts',
      'tests/sqlite-events.test.ts',
      'tests/sqlite-relationships.test.ts',
      'tests/migrations.test.ts',
      'tests/transactions.test.ts',
      'tests/bulk-atomicity.test.ts',
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
