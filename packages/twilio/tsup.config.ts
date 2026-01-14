import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/sms.ts',
    'src/whatsapp.ts',
    'src/voice.ts',
    'src/verify.ts',
    'src/types.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  target: 'es2022',
  splitting: false,
  treeshake: true,
})
