import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/hash.ts', 'src/compression.ts', 'src/events.ts', 'src/state.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
})
