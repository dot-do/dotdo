import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

/**
 * Vite configuration for static export of @dotdo/app
 *
 * This config enables:
 * - Static site generation (SSG) for all routes
 * - Asset optimization with hashing
 * - Build output to dist/ directory
 * - Environment variable handling
 * - Cloudflare Pages deployment compatibility
 */
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],

  // Build configuration for static export
  build: {
    outDir: 'dist',
    emptyOutDir: true,

    // Asset optimization
    assetsDir: 'assets',
    assetsInlineLimit: 4096, // Inline assets < 4KB

    // Enable hashing for cache busting
    rollupOptions: {
      output: {
        // Hash asset filenames for caching
        assetFileNames: 'assets/[name].[hash][extname]',
        chunkFileNames: 'assets/[name].[hash].js',
        entryFileNames: 'assets/[name].[hash].js',

        // Manual chunk splitting for optimal loading
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'router-vendor': ['@tanstack/react-router', '@tanstack/start'],
        },
      },
    },

    // Optimization settings
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true, // Remove console logs in production
        drop_debugger: true,
      },
    },

    // Source maps for debugging (disable in production)
    sourcemap: process.env.NODE_ENV !== 'production',

    // CSS code splitting
    cssCodeSplit: true,

    // Report bundle sizes
    reportCompressedSize: true,
    chunkSizeWarningLimit: 1000, // Warn if chunk > 1MB
  },

  // Development server configuration
  server: {
    port: 3000,
    strictPort: false,
    host: true,
  },

  // Preview server configuration
  preview: {
    port: 4173,
    strictPort: false,
    host: true,
  },

  // Resolve configuration
  resolve: {
    alias: {
      '@': resolve(__dirname, './'),
      '@routes': resolve(__dirname, './routes'),
      '@components': resolve(__dirname, './components'),
    },
  },

  // Environment variable handling
  envPrefix: 'VITE_',

  // Define global constants
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '0.0.1'),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },

  // Optimize dependencies
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      '@tanstack/react-router',
      '@tanstack/start',
    ],
  },

  // SSR configuration for static generation
  ssr: {
    // Don't externalize these packages during SSR
    noExternal: ['@tanstack/react-router', '@tanstack/start'],
  },
})
