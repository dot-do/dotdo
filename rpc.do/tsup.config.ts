import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'cli/index': 'src/cli/index.ts',
    'transport/index': 'src/transport/index.ts',
    'transport/fetch': 'src/transport/fetch.ts',
    'auth/index': 'src/auth/index.ts',
  },
  outDir: 'dist',
  format: ['esm'],
  target: 'node18',
  platform: 'node',
  splitting: false,
  sourcemap: true,
  clean: true,
  // Generate types using tsc via the build script instead
  dts: false,
  shims: false,
  external: ['commander', 'hono', 'typescript'],
  onSuccess: async () => {
    const { chmod } = await import('node:fs/promises')
    const { resolve } = await import('node:path')
    try {
      await chmod(resolve('dist/cli/index.js'), 0o755)
    } catch {
      // Ignore errors (e.g., on Windows)
    }
  },
})
