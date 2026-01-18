import { defineConfig } from 'vitest/config'

/**
 * Vitest configuration for Node.js-based tests (file structure, static analysis)
 *
 * Use this config for tests that don't need the Cloudflare Workers runtime:
 * - File structure validation
 * - Configuration file checks
 * - Static code analysis
 * - CLI tests (require TypeScript which needs node:os)
 *
 * Run with: npx vitest run --config vitest.node.config.ts
 */
export default defineConfig({
  test: {
    globals: true,
    include: [
      'tests/app.test.ts',
      'tests/workers-config.test.ts',
      'tests/fumadocs.test.ts',
      'tests/seo.test.ts',
      'tests/layout.test.ts',
      'tests/examples.test.ts',
      'cli/tests/**/*.test.ts',
      'packages/__tests__/**/*.test.ts',
    ],
    exclude: ['node_modules', 'dist'],
    testTimeout: 10_000,
  },
})
