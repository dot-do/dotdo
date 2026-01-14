import { defineConfig } from 'vitest/config'

/**
 * Vitest config for Node.js-specific tests.
 *
 * These tests require Node.js APIs (vm, child_process, os, etc.)
 * and cannot run in the Cloudflare Workers pool.
 *
 * Run with: npx vitest run --config vitest.node.config.ts
 */
export default defineConfig({
  test: {
    globals: true,
    include: [
      'test/cli/**/*.test.ts',
      'test/mcp/**/*.test.ts',
      'test/core/**/*.test.ts',
    ],
    environment: 'node',
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/cli/**/*.ts', 'src/mcp/**/*.ts'],
      exclude: ['src/**/*.d.ts']
    },
  }
})
