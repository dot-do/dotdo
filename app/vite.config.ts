import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { resolve } from 'path'

/**
 * Vite configuration for @dotdo/app using TanStack Start
 *
 * This config enables:
 * - TanStack Start SSR/SSG framework
 * - Static site generation (SSG) for all routes
 * - Asset optimization with hashing
 * - Environment variable handling
 * - Cloudflare Pages deployment compatibility
 */
export default defineConfig({
  plugins: [
    tsconfigPaths(),
    tanstackStart({
      // TanStack Start configuration
      srcDirectory: '.',
      router: {
        routesDirectory: 'routes',
        generatedRouteTree: 'routeTree.gen.ts',
      },
      client: {
        entry: 'client.tsx',
      },
      server: {
        entry: 'ssr.tsx',
        // Note: For Cloudflare deployment, use @cloudflare/vite-plugin instead of preset
      },
      // Prerender configuration for static site generation
      // Note: Full prerendering requires additional Nitro server configuration
      // For now, build generates SSR-ready assets; prerender can be enabled
      // when the deployment target (e.g., Cloudflare Pages) is properly configured
      prerender: {
        enabled: false,
      },
    }),
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
    sourcemap: process.env['NODE_ENV'] !== 'production',

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
    __APP_VERSION__: JSON.stringify(process.env['npm_package_version'] || '0.0.1'),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },

  // Optimize dependencies
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      '@tanstack/react-router',
      '@tanstack/react-start',
    ],
  },

  // SSR configuration for static generation
  ssr: {
    // Don't externalize these packages during SSR
    noExternal: ['@tanstack/react-router', '@tanstack/react-start'],
  },
})
