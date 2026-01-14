import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['index.ts', 'types.ts', 'client.ts', 'issues.ts', 'projects.ts', 'webhooks.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
})
