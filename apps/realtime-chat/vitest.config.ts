/**
 * Vitest Configuration for Real-time Chat Tests
 *
 * Uses @cloudflare/vitest-pool-workers to run tests in the Cloudflare Workers runtime
 * with real Durable Objects, SQLite storage, and WebSocket support.
 *
 * NO MOCKS: All tests use real miniflare instances per CLAUDE.md policy.
 *
 * @module apps/realtime-chat/vitest.config
 */

import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    name: 'realtime-chat',
    globals: true,

    // Include test files
    include: ['tests/**/*.test.ts'],

    // Exclude external packages
    exclude: ['**/node_modules/**'],

    // CRITICAL: Limit concurrency to prevent resource exhaustion
    // Workers pool with miniflare is memory-intensive
    maxConcurrency: 1,
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,

    // Pool worker options for miniflare runtime
    poolOptions: {
      workers: {
        // Use local wrangler config for CHAT_ROOM_DO binding
        wrangler: {
          configPath: './wrangler.jsonc',
        },

        // Use single worker mode to avoid isolated storage issues with SQLite
        singleWorker: true,

        // Disable isolated storage for SQLite WAL compatibility
        isolatedStorage: false,

        // Miniflare configuration
        miniflare: {
          // In-memory DO storage for faster tests
          durableObjectsPersist: false,

          // Test bindings
          bindings: {
            TEST_MODE: 'true',
          },
        },
      },
    },

    // Test timeouts (WebSocket operations can be slower)
    testTimeout: 30000,
    hookTimeout: 30000,

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/node_modules/**'],
      thresholds: {
        statements: 65,
        branches: 60,
        functions: 60,
        lines: 65,
      },
    },
  },
})
