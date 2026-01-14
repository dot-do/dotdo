import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/types.ts',
  ],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  external: ['@cloudflare/workers-types', '@dotdo/duckdb-worker'],
  splitting: false,
  treeshake: true,
})
