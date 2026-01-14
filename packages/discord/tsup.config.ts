import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/client.ts',
    'src/rest.ts',
    'src/types.ts',
    'src/builders.ts',
    'src/messages.ts',
    'src/embeds.ts',
    'src/interactions.ts',
    'src/webhooks.ts',
  ],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
})
