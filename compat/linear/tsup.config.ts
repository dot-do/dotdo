import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'index.ts',
    'types.ts',
    'client.ts',
    'issues.ts',
    'projects.ts',
    'cycles.ts',
    'webhooks.ts',
  ],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  external: ['../../db/primitives/temporal-store', '../../db/primitives/window-manager'],
})
