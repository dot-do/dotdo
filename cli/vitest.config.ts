import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: true,
    testTimeout: 10000,
    pool: 'forks',
    isolate: true,
  },
  resolve: {
    alias: {
      // Ensure React is resolved correctly for ink-testing-library
      react: 'react',
    },
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
  },
})
