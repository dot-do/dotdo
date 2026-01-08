import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Exclude workers tests from default config - they use workspace
    exclude: [
      'tests/infrastructure/**/*.test.ts',
      'tests/routes/**/*.test.ts',
      'tests/middleware/**/*.test.ts',
    ],
  },
})
