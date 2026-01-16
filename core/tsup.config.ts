import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'index.ts',
    'rpc/index': 'rpc/index.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  external: [
    'hono',
    'cloudflare:workers',
  ],
  // Bundle the rpc dependencies from parent folder
  noExternal: [
    /^\.\.\/rpc\//,
  ],
})
