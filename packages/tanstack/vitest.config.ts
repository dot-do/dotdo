import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    globals: true,
  },
  resolve: {
    alias: {
      '@dotdo/tanstack': './src/index.ts',
    },
  },
})
