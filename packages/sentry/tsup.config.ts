import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/breadcrumbs.ts',
    'src/capture.ts',
    'src/transport.ts',
    'src/scope.ts',
    'src/types.ts',
  ],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  outDir: 'dist',
})
