import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/sendgrid.ts',
    'src/resend.ts',
    'src/providers.ts',
    'src/templates.ts',
    'src/webhooks.ts',
  ],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  outDir: 'dist',
})
