import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/react/**/*.test.tsx'],
    exclude: ['node_modules', 'dist'],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/react/setup.ts'],
  },
  resolve: {
    alias: {
      '@dotdo/tanstack': './src/index.ts',
    },
  },
})
