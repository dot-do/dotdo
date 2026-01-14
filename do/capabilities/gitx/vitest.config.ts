import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    // Exclude tests that require Node.js APIs (vm, child_process, os, etc.)
    // These run in vitest.node.config.ts instead
    exclude: [
      'test/cli/**/*.test.ts',
      'test/mcp/**/*.test.ts',
    ],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        singleWorker: true,
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/index.ts']
    },
    testTimeout: 10000
  }
})
