import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/client.ts',
    'src/pool.ts',
    'src/query.ts',
    'src/backends/memory.ts',
  ],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  external: ['@cloudflare/workers-types'],
  splitting: false,
  treeshake: true,
})
