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
  // Bundle all relative imports from parent folder (rpc, workflow, lib, types, db)
  noExternal: [
    /^\.\.\//,
  ],
})
