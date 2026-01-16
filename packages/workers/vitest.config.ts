import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 10000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: {
      // Resolve .ts files directly
    },
  },
  esbuild: {
    target: 'node20',
  },
})
