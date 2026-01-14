import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    environment: 'node',
    globals: true,
  },
  resolve: {
    alias: {
      '@dotdo/redis': resolve(__dirname, './src/index.ts'),
    },
  },
})
