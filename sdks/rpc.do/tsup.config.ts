import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'index.ts',
    'cli/index': 'cli/index.ts',
    'transport/index': 'transport/index.ts',
    'transport/fetch': 'transport/fetch.ts',
    'auth/index': 'auth/index.ts',
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
  external: ['commander', 'typescript'],
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
