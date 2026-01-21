/**
 * Vitest Configuration for MCP Tools Tests - Node Environment
 *
 * This configuration runs sandbox tests in Node.js environment.
 * These tests don't require Workers runtime or DO bindings.
 *
 * Usage:
 *   cd mcp && npx vitest --config vitest.node.config.ts run
 *   # OR from root:
 *   npx vitest run mcp/tests --config mcp/vitest.node.config.ts
 *
 * @module mcp/vitest.node.config
 */

import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    root: resolve(__dirname),
    include: [
      'tests/sandbox*.test.ts',
      'tests/global-state.test.ts',
      'tests/cli.test.ts',
      'tests/store-adapters.test.ts',
      'tests/search.test.ts',
      'tests/fetch.test.ts',
      'tests/discovery.test.ts',
      'tests/server.test.ts',
      'tests/do.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
    ],
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,

    // CRITICAL: Limit concurrency to prevent resource exhaustion
    maxConcurrency: 1,
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,
  },
})
