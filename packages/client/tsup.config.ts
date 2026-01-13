import { defineConfig } from 'tsup'

/**
 * @dotdo/client build configuration
 *
 * Simplified build for the Cap'n Web based client SDK.
 * The capnweb library handles all transport, reconnection, batching,
 * and pipelining internally, so we only need to build the main entry point.
 */
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    auth: 'src/auth.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  minify: true,
  treeshake: true,
  splitting: false,
  outDir: 'dist',
  // External capnweb - it's a runtime dependency
  external: ['capnweb'],
})
