import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    'cli/index': 'src/cli/index.ts',
  },
  outDir: 'dist',
  format: ['esm'],
  target: 'node18',
  platform: 'node',
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: false,
  shims: false,
  // Externalize all dependencies - keep bundle small
  external: [
    'commander',
    'hono',
    'typescript',
    // Node.js built-ins are automatically externalized
  ],
  // Don't add shebang via banner - source file already has it
  // Make executable on Unix
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
