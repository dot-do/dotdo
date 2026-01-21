/**
 * Node-based Vitest config for testing pure TypeScript modules
 * that don't require the Workers runtime.
 *
 * Usage:
 *   npx vitest run --config api/vitest.node.config.ts
 */
import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

const root = resolve(__dirname, '..')

export default defineConfig({
  resolve: {
    alias: {
      '@dotdo/test-utils/helpers': resolve(root, 'test-utils/helpers.ts'),
      '@dotdo/test-utils/factories': resolve(root, 'test-utils/factories.ts'),
      '@dotdo/test-utils/assertions': resolve(root, 'test-utils/assertions.ts'),
      '@dotdo/test-utils/miniflare': resolve(root, 'test-utils/miniflare.ts'),
      '@dotdo/test-utils': resolve(root, 'test-utils/index.ts'),
      '@dotdo/observability': resolve(root, 'observability/index.ts'),
      '@dotdo/db': resolve(root, 'db/index.ts'),
      '@dotdo/utils': resolve(root, 'utils/index.ts'),
    },
  },
  test: {
    // Include pure TypeScript tests that don't require Workers runtime or DO bindings
    // Tests requiring cloudflare:test, env.DO bindings, or deep package dependencies
    // must use the workers config (vitest.config.ts)
    include: [
      // HATEOAS tests - standalone, no deep dependencies
      'tests/hateoas.test.ts',
      'tests/hateoas-e2e.test.ts',
      // OpenAPI tests - mostly standalone
      'tests/openapi.test.ts',
      'tests/openapi-yaml-escaping.test.ts',
      'tests/openapi-zod-validation.test.ts',
      // Resource tests - standalone
      'tests/resource.test.ts',
      // Codegen tests - standalone
      'tests/sdk-gen.test.ts',
      'tests/cli-gen.test.ts',
      'tests/mcp-gen.test.ts',
      // SDK tests - standalone
      'tests/sdk.test.ts',
      'tests/sdk-openapi.test.ts',
    ],
    globals: true,
    testTimeout: 15000,
  },
})
