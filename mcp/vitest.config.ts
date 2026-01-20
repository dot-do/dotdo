/**
 * Vitest Configuration for MCP Tools Tests
 *
 * This configuration uses @cloudflare/vitest-pool-workers to run tests
 * inside the Cloudflare Workers runtime with real Durable Objects.
 *
 * IMPORTANT: Tests using this config get access to:
 * - Real DurableObjectState with actual storage
 * - Real SQLite via state.storage.sql
 * - Real DO bindings for sandbox execution
 *
 * Usage:
 *   npx vitest --config mcp/vitest.config.ts          # Run all MCP tests
 *   npx vitest --config mcp/vitest.config.ts run      # Run once
 *   npx vitest run mcp/tests/sandbox.test.ts          # Run specific file
 *
 * @module mcp/vitest.config
 */

import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    // Include ALL mcp tests
    include: [
      'tests/**/*.test.ts',
    ],

    // Exclude only non-test files
    exclude: [
      '**/node_modules/**',
    ],

    // Pool worker options
    poolOptions: {
      workers: {
        // Use wrangler config for DO bindings
        wrangler: {
          configPath: './wrangler.jsonc',
        },

        // Use single worker mode for stability
        singleWorker: true,

        // Disable isolated storage for SQLite WAL compatibility
        isolatedStorage: false,

        // Additional miniflare configuration
        miniflare: {
          durableObjectsPersist: false, // In-memory for tests (faster)
          bindings: {
            TEST_MODE: 'true',
          },
        },
      },
    },

    // Test timeouts (MCP operations can be slower)
    testTimeout: 30000,
    hookTimeout: 30000,

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/__tests__/**', '**/node_modules/**'],
      thresholds: {
        statements: 65,
        branches: 60,
        functions: 60,
        lines: 65,
      },
    },
  },
})
