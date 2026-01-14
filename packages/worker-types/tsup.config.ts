import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/worker.ts',
    'src/agent.ts',
    'src/human.ts',
    'src/guards.ts',
    'src/routing.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
})
