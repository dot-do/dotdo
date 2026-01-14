import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/mixpanel.ts', 'src/amplitude.ts', 'src/posthog.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  outDir: 'dist',
})
