import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    include: [
      'api/tests/**/*.test.ts',
      'db/tests/**/*.test.ts',
      'db/iceberg/**/*.test.ts',
      'app/tests/**/*.test.ts',
      'objects/tests/**/*.test.ts',
      'workflows/**/*.test.ts',
    ],
    environment: 'node',
    // Exclude workers tests from default config - they use workspace
    exclude: ['api/tests/infrastructure/**/*.test.ts', 'api/tests/routes/**/*.test.ts', 'api/tests/middleware/**/*.test.ts'],
  },
  resolve: {
    alias: {
      // Mock cloudflare:workers for Node.js tests
      'cloudflare:workers': resolve(__dirname, 'test-mocks/cloudflare-workers.ts'),
    },
  },
})
