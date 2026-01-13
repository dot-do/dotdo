import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/webhooks.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  outDir: 'dist',
  external: ['hono'],
})
