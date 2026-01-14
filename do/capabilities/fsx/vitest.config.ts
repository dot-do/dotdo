import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts', 'test/**/*.test.ts', 'tests/**/*.test.ts', 'storage/**/*.test.ts', 'core/**/*.test.ts', 'do/**/*.test.ts'],
    // Exclude test/core - those tests need Node.js environment (not Workers)
    // They have their own vitest.config.ts and should be run separately or via workspace
    exclude: ['**/node_modules/**', 'test/core/**/*.test.ts'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.test.jsonc' },
      },
    },
  },
})
