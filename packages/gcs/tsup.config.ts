import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/backend.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
})
