import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'do/index': 'src/do/index.ts',
    'proxy/index': 'src/proxy/index.ts',
    'storage/index': 'src/storage/index.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  external: [
    '@cloudflare/workers-types',
    'ai-evaluate',
  ],
})
