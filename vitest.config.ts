import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    globals: true,
    include: ['**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    testTimeout: 10_000,
    hookTimeout: 10_000,
    setupFiles: ['./vitest.setup.ts'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        singleWorker: true,
        isolatedStorage: false,
      },
    },
  },
})
