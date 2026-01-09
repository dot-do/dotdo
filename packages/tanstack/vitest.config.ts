import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['node_modules', 'dist'],
    environment: 'node',
    globals: true,
    // React tests use jsdom
    environmentMatchGlobs: [
      ['tests/react/**', 'jsdom'],
    ],
    setupFiles: ['./tests/react/setup.ts'],
  },
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  resolve: {
    alias: {
      '@dotdo/tanstack': './src/index.ts',
    },
  },
})
