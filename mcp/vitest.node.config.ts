/**
 * Vitest Configuration for MCP Tools Tests - Node Environment
 *
 * This configuration runs sandbox tests in Node.js environment.
 * These tests don't require Workers runtime or DO bindings.
 *
 * Usage:
 *   npx vitest --config mcp/vitest.node.config.ts run tests/sandbox-limits.test.ts
 *
 * @module mcp/vitest.node.config
 */

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'tests/sandbox*.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
    ],
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
  },
})
