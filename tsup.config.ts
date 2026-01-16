import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    // Main entry point
    index: 'index.ts',
    // Subpath exports
    'rpc/index': 'rpc/index.ts',
    'storage/index': 'storage/index.ts',
    'workflow/index': 'workflow/index.ts',
    'ai/index': 'ai/index.ts',
    'types/index': 'types/index.ts',
  },
  format: ['esm'],
  // Skip declaration generation due to complex DO type inheritance
  // Types are consumed from source files via TypeScript
  dts: false,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  external: [
    // Cloudflare runtime
    'cloudflare:workers',
    'cloudflare:test',
    // Peer dependencies
    'hono',
    '@cloudflare/workers-types',
    // Node builtins that may be referenced
    'crypto',
    'process',
  ],
  // Don't bundle internal modules - they resolve at runtime
  noExternal: [],
  // Target ES2022 for modern Workers runtime
  target: 'es2022',
  // Ensure proper module resolution
  platform: 'neutral',
})
