/**
 * Node-based Vitest config for testing pure TypeScript modules
 * that don't require the Workers runtime.
 *
 * Usage:
 *   npx vitest run --config api/vitest.node.config.ts
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/hateoas.test.ts', 'tests/hateoas-e2e.test.ts'],
    globals: true,
    testTimeout: 10000,
  },
})
