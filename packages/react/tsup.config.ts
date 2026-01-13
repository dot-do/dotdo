import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'hooks/index': 'src/hooks/index.ts',
    'tanstack/index': 'src/tanstack/index.ts',
    'admin/index': 'src/admin/index.ts',
    'sync/index': 'src/sync/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: ['react', 'zod', '@dotdo/client'],
  treeshake: true,
})
