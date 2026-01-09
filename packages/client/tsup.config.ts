import { defineConfig } from 'tsup'

export default defineConfig([
  // Main bundle (full client - original monolithic file)
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    minify: true,
    treeshake: true,
    splitting: false,
    outDir: 'dist',
  },
  // Types module (for separate type imports)
  {
    entry: ['src/types.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    minify: true,
    treeshake: true,
    splitting: false,
    outDir: 'dist',
  },
  // Utils module
  {
    entry: ['src/utils.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    minify: true,
    treeshake: true,
    splitting: false,
    outDir: 'dist',
  },
  // Transports (for tree-shakeable transport layer)
  {
    entry: {
      'index': 'src/transports/index.ts',
      'websocket': 'src/transports/websocket.ts',
      'http': 'src/transports/http.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    minify: true,
    treeshake: true,
    splitting: false,
    outDir: 'dist/transports',
  },
  // Features (for tree-shakeable feature modules)
  {
    entry: {
      'index': 'src/features/index.ts',
      'reconnection': 'src/features/reconnection.ts',
      'subscriptions': 'src/features/subscriptions.ts',
      'offline': 'src/features/offline.ts',
      'batching': 'src/features/batching.ts',
      'retry': 'src/features/retry.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    minify: true,
    treeshake: true,
    splitting: false,
    outDir: 'dist/features',
  },
])
