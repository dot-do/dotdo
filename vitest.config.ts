/**
 * Vitest Configuration for Cloudflare Workers Pool
 *
 * This config runs tests in the Cloudflare Workers runtime via miniflare.
 * For coverage reporting, use vitest.coverage.config.ts instead.
 *
 * Usage:
 *   npm test          - Watch mode
 *   npm run test:run  - Single run
 *   npm run test:coverage - Coverage (uses separate config)
 */

import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    globals: true,
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**', 'node_modules', 'dist', 'app/node_modules/**', 'tests/e2e/**', 'cli/**'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    setupFiles: ['./vitest.setup.ts'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
        singleWorker: true,
        isolatedStorage: false,
      },
    },
    // Note: Coverage runs via vitest.coverage.config.ts which uses Node.js
    // because the Workers runtime doesn't support node:inspector
  },
})
