import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'autonomous-startup',
    include: ['tests/**/*.test.ts'],
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    // Don't run in watch mode by default
    watch: false,
  },
  resolve: {
    alias: {
      // Allow imports from the root
      '@': new URL('../../..', import.meta.url).pathname,
    },
  },
})
