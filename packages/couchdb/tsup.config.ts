import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/backends/memory.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
})
