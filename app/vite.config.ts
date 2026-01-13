import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import tsConfigPaths from 'vite-tsconfig-paths'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import mdx from 'fumadocs-mdx/vite'
import path from 'node:path'

/**
 * Vite Configuration for TanStack Start + Fumadocs
 *
 * Optimizations:
 * 1. Build - Minification, source maps, target optimization
 * 2. Chunking - Vendor splitting + docs collection splitting
 * 3. Assets - Inlining limits, naming patterns
 * 4. Dev Server - HMR, CORS, dependency pre-bundling
 * 5. SSR - Package bundling for SSR compatibility
 *
 * @see internal/plans/2026-01-12-fumadocs-static-prerender-design.md
 */
export default defineConfig({
  // ============================================
  // Development Server Configuration
  // ============================================
  server: {
    port: 3000,
    // Enable strict port - fail if 3000 is taken
    strictPort: false,
    // HMR configuration for faster development
    hmr: {
      overlay: true,
    },
    // CORS for development API calls
    cors: true,
    // Watch configuration - ignore large directories
    watch: {
      ignored: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
    },
  },

  // ============================================
  // Preview Server (for production build testing)
  // ============================================
  preview: {
    port: 3001,
    strictPort: false,
  },

  // ============================================
  // Dependency Optimization (Pre-bundling)
  // ============================================
  optimizeDeps: {
    // Include heavy dependencies for faster dev startup
    include: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      '@tanstack/react-router',
      '@tanstack/react-start',
      'lucide-react',
      'clsx',
      'tailwind-merge',
    ],
    // Exclude packages that cause issues when pre-bundled
    exclude: [
      // MDX files need runtime processing
      'fumadocs-mdx',
      // Server-only should use our shim
      'server-only',
    ],
    // Enable esbuild optimizations
    esbuildOptions: {
      target: 'es2022',
    },
  },

  // ============================================
  // SSR Configuration
  // ============================================
  // Force Vite to bundle packages that export raw TSX or have SSR issues
  // noExternal forces Vite to transform these packages during SSR build
  ssr: {
    noExternal: [
      // @mdxui packages export raw TSX files
      '@mdxui/primitives',
      '@mdxui/cockpit',
      '@mdxui/beacon',
      '@mdxui/themes',
      // @workos-inc/widgets has SSR compatibility issues with @radix-ui/themes
      '@workos-inc/widgets',
      // @xterm/xterm has ESM export issues during SSR
      '@xterm/xterm',
      // server-only throws in non-RSC environments - must bundle to apply our shim
      'server-only',
      // fumadocs-typescript/ui imports server-only, bundle it to use our shim
      'fumadocs-typescript',
    ],
    // Optimize SSR externals for faster builds
    optimizeDeps: {
      include: ['react', 'react-dom'],
    },
  },

  // ============================================
  // Plugins
  // ============================================
  plugins: [
    mdx(await import('./source.config')),
    tailwindcss(),
    tsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tanstackStart({
      routesDirectory: './routes',
      generatedRouteTree: './src/routeTree.gen.ts',
      routeFileIgnorePrefix: '-',
      quoteStyle: 'single',
      // Static prerendering - disabled temporarily to fix build issues
      // TODO: Re-enable after SSR issues are resolved
      // @see docs/plans/2026-01-12-fumadocs-static-prerender-design.md
      prerender: {
        enabled: false,
      },
    }),
    react({
      // Enable React Refresh for HMR
      fastRefresh: true,
    }),
  ],

  // ============================================
  // Module Resolution
  // ============================================
  resolve: {
    alias: {
      '@tests/mocks': path.resolve(__dirname, '../tests/mocks'),
      // Alias server-only to empty module - this package is designed for Next.js RSC
      // and throws when imported from client components. In TanStack Start we don't
      // have the same RSC boundaries, so we shim it to a no-op.
      'server-only': path.resolve(__dirname, 'lib/shims/server-only.ts'),
    },
  },

  // ============================================
  // Build Configuration
  // ============================================
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Target modern browsers for smaller bundles
    target: 'es2022',
    // Enable minification (uses esbuild by default)
    minify: 'esbuild',
    // Source maps for production debugging (hidden from browser devtools)
    sourcemap: 'hidden',
    // Report compressed size in build output
    reportCompressedSize: true,
    // Chunk size warning limit (500KB)
    chunkSizeWarningLimit: 500,
    // CSS configuration
    cssMinify: true,
    cssCodeSplit: true,
    // Asset handling
    assetsInlineLimit: 4096, // Inline assets < 4KB as base64
    // Rollup-specific options
    rollupOptions: {
      output: {
        // Asset file naming pattern
        assetFileNames: (assetInfo) => {
          // Put fonts in fonts directory
          if (assetInfo.name?.match(/\.(woff2?|ttf|otf|eot)$/)) {
            return 'assets/fonts/[name]-[hash][extname]'
          }
          // Put images in images directory
          if (assetInfo.name?.match(/\.(png|jpe?g|gif|svg|webp|avif|ico)$/)) {
            return 'assets/images/[name]-[hash][extname]'
          }
          // Default pattern for other assets
          return 'assets/[name]-[hash][extname]'
        },
        // Chunk file naming pattern
        chunkFileNames: 'assets/js/[name]-[hash].js',
        // Entry file naming pattern
        entryFileNames: 'assets/js/[name]-[hash].js',
        // Manual chunks for optimal splitting
        manualChunks(id) {
          // ============================================
          // Vendor Chunks (node_modules)
          // ============================================
          if (id.includes('node_modules')) {
            // React ecosystem - frequently used together
            if (id.includes('react') || id.includes('scheduler') || id.includes('react-dom')) {
              return 'vendor-react'
            }
            // TanStack libraries
            if (id.includes('@tanstack')) {
              return 'vendor-tanstack'
            }
            // Fumadocs libraries
            if (id.includes('fumadocs')) {
              return 'vendor-fumadocs'
            }
            // Radix UI components
            if (id.includes('@radix-ui')) {
              return 'vendor-radix'
            }
            // MDXUI components
            if (id.includes('@mdxui')) {
              return 'vendor-mdxui'
            }
            // Lucide icons (tree-shakeable, but large if fully imported)
            if (id.includes('lucide-react')) {
              return 'vendor-icons'
            }
            // Other small utilities - group together
            if (id.includes('clsx') || id.includes('tailwind-merge') || id.includes('class-variance-authority')) {
              return 'vendor-utils'
            }
          }

          // ============================================
          // Documentation Chunks
          // ============================================
          // Split integrations into smaller category-based chunks
          // This keeps each chunk under 500KB for efficient prerendering
          const integrationsMatch = id.match(/\/docs\/integrations\/([a-z-]+)\.mdx/)
          if (integrationsMatch) {
            const filename = integrationsMatch[1]
            // Categorize integrations by type
            const databases = ['postgres', 'planetscale', 'mongodb', 'neon', 'couchdb', 'clickhouse', 'convex', 'supabase', 'firebase']
            const search = ['elasticsearch', 'algolia']
            const vector = ['pinecone', 'weaviate']
            const realtime = ['ably', 'pusher']
            const messaging = ['kafka', 'redis', 'upstash']
            const email = ['sendgrid', 'mailgun', 'postmark', 'resend']
            const ai = ['openai', 'anthropic', 'cohere', 'google-ai']
            const auth = ['clerk', 'auth0', 'supabase-auth']
            const communication = ['slack', 'discord', 'twilio']

            if (databases.includes(filename)) return 'docs-sdks-databases'
            if (search.includes(filename)) return 'docs-sdks-search'
            if (vector.includes(filename)) return 'docs-sdks-vector'
            if (realtime.includes(filename)) return 'docs-sdks-realtime'
            if (messaging.includes(filename)) return 'docs-sdks-messaging'
            if (email.includes(filename)) return 'docs-sdks-email'
            if (ai.includes(filename)) return 'docs-sdks-ai'
            if (auth.includes(filename)) return 'docs-sdks-auth'
            if (communication.includes(filename)) return 'docs-sdks-communication'
            // Remaining integrations (analytics, automation, etc.)
            return 'docs-sdks-misc'
          }

          // Extract the docs folder name from paths like: /docs/{folder}/ or docs/{folder}/
          const docsMatch = id.match(/\/docs\/([a-z-]+)\//)
          if (docsMatch) {
            const folder = docsMatch[1]
            // Map folder names to chunk names
            switch (folder) {
              case 'concepts': return 'docs-concepts'
              case 'api': return 'docs-api'
              case 'getting-started': return 'docs-getting-started'
              case 'integrations': return 'docs-sdks-misc' // Fallback for index.mdx etc
              case 'agents': return 'docs-agents'
              case 'cli': return 'docs-cli'
              case 'database': return 'docs-database'
              case 'deployment': return 'docs-deployment'
              case 'sdk': return 'docs-sdk'
              case 'rpc': return 'docs-rpc'
              case 'guides': return 'docs-guides'
              case 'observability': return 'docs-observability'
              case 'primitives': return 'docs-primitives'
              case 'security': return 'docs-security'
              case 'storage': return 'docs-storage'
              case 'workflows': return 'docs-workflows'
              case 'actions': return 'docs-actions'
              case 'architecture': return 'docs-architecture'
              case 'compat': return 'docs-compat'
              case 'events': return 'docs-events'
              case 'functions': return 'docs-functions'
              case 'humans': return 'docs-humans'
              case 'mcp': return 'docs-mcp'
              case 'objects': return 'docs-objects'
              case 'platform': return 'docs-platform'
              case 'transport': return 'docs-transport'
              case 'ui': return 'docs-ui'
              case 'lib': return 'docs-lib'
            }
          }
        },
      },
      // Tree-shaking optimization
      treeshake: {
        // Aggressive tree-shaking for smaller bundles
        moduleSideEffects: 'no-external',
        // Preserve pure annotations
        annotations: true,
      },
    },
  },

  // ============================================
  // Environment Variables
  // ============================================
  // Expose env variables with VITE_ prefix
  envPrefix: 'VITE_',

  // ============================================
  // Logging
  // ============================================
  logLevel: 'info',

  // ============================================
  // JSON Handling
  // ============================================
  json: {
    // Enable named exports for JSON modules
    namedExports: true,
    // Stringify for smaller bundles
    stringify: true,
  },
})
