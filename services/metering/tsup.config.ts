import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    types: 'src/types.ts',
    counter: 'src/counter.ts',
    aggregator: 'src/aggregator.ts',
    limiter: 'src/limiter.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  minify: false,
  external: ['@cloudflare/workers-types'],
})
