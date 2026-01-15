import { defineConfig } from 'vite'
import cloudflare from '@cloudflare/vite-plugin'

/**
 * Vite configuration for static site generation with Cloudflare Workers
 *
 * This config is used for building static documentation pages
 * with TanStack Start prerendering and Cloudflare Workers deployment.
 *
 * Optimizations include:
 * - Asset hashing for cache busting
 * - Chunk splitting for optimal loading
 * - Source maps for production debugging
 */
export default defineConfig({
  plugins: [
    cloudflare({
      // Enable SSR/prerender for static site generation
      configPath: './wrangler.static.jsonc',
    }),
  ],
  build: {
    // Enable SSR mode for prerendering
    ssr: true,

    // Output directory for static assets
    outDir: 'dist/client',

    // Generate source maps for debugging
    sourcemap: true,

    // Optimize chunk splitting for caching
    rollupOptions: {
      output: {
        // Use content hashes for cache busting
        assetFileNames: 'assets/[name]-[hash][extname]',
        chunkFileNames: 'chunks/[name]-[hash].js',
        entryFileNames: '[name]-[hash].js',

        // Manual chunk splitting for vendor libraries
        manualChunks: (id) => {
          // Vendor chunk for node_modules
          if (id.includes('node_modules')) {
            return 'vendor'
          }
        },
      },
    },

    // Minification settings
    minify: 'esbuild',

    // Target modern browsers for better output
    target: 'esnext',
  },

  // Define environment variables for build
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
})
