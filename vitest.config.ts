import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['api/tests/**/*.test.ts', 'db/tests/**/*.test.ts', 'app/tests/**/*.test.ts'],
    environment: 'node',
    // Exclude workers tests from default config - they use workspace
    exclude: ['api/tests/infrastructure/**/*.test.ts', 'api/tests/routes/**/*.test.ts', 'api/tests/middleware/**/*.test.ts'],
  },
})
