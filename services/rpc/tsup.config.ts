import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/types.ts',
    'src/router.ts',
    'src/auth.ts',
    'src/metering.ts',
    'src/rate-limit.ts',
    'src/pipeline.ts',
    'src/audit.ts',
  ],
  format: ['esm'],
  dts: true,
  clean: true,
  external: ['@cloudflare/workers-types'],
})
