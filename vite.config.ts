import { defineConfig } from 'vite'
import { cloudflare } from '@cloudflare/vite-plugin'

// Skip cloudflare plugin during vitest - it conflicts with @cloudflare/vitest-pool-workers
// The plugin's validateWorkerEnvironmentOptions doesn't handle undefined resolve.external
const isVitest = process.env.VITEST === 'true'

export default defineConfig({
  plugins: isVitest ? [] : [cloudflare()],
  // Public directory for static files (_headers, robots.txt, etc.)
  // These files are copied to dist during build
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Enable asset fingerprinting for cache busting
    rollupOptions: {
      output: {
        // Hash-based filenames for immutable caching
        assetFileNames: 'assets/[name]-[hash][extname]',
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
})
