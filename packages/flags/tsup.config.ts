import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/client.ts',
    'src/evaluation.ts',
    'src/targeting.ts',
    'src/types.ts',
  ],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
})
