import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import tsConfigPaths from 'vite-tsconfig-paths'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import mdx from 'fumadocs-mdx/vite'
import path from 'node:path'

export default defineConfig({
  server: {
    port: 3000,
  },
  // SSR configuration - force Vite to bundle packages that export raw TSX or have SSR issues
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
  },
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
      // Static prerendering for zero-cost Cloudflare static assets deployment
      // Uses multi-collection splitting for memory-efficient builds
      // @see docs/plans/2026-01-12-fumadocs-static-prerender-design.md
      prerender: {
        // DISABLED: Build runs out of memory (8GB) due to 28MB docs-sdks chunk
        // TODO: Split integrations into smaller chunks, then re-enable
        enabled: false,
        // Lower concurrency to manage memory (default 14)
        concurrency: 2,
        // DISABLED: crawlLinks causes SSR timeout due to 28MB docs-sdks chunk
        // TODO: Re-enable after splitting integrations into smaller chunks
        crawlLinks: false,
        // Explicit routes for prerendering (lightweight sections first)
        routes: [
          '/docs',
          '/docs/getting-started',
          '/docs/concepts',
          '/docs/guides',
        ],
        // Filter out auth-protected routes from prerendering
        // These routes require authentication and should be SSR'd at runtime
        filter: ({ path }) => {
          // Exclude admin routes (behind auth)
          if (path.startsWith('/admin')) return false
          // Exclude app routes (behind auth)
          if (path.startsWith('/app')) return false
          // Exclude auth flows (redirects cause infinite loops)
          if (path.startsWith('/signup')) return false
          if (path.startsWith('/login')) return false
          // Exclude homepage (SSR timeout issues with beacon components)
          if (path === '/' || path === '') return false
          // Prerender everything else
          return true
        },
      },
    }),
    react(),
  ],
  resolve: {
    alias: {
      '@tests/mocks': path.resolve(__dirname, '../tests/mocks'),
      // Alias server-only to empty module - this package is designed for Next.js RSC
      // and throws when imported from client components. In TanStack Start we don't
      // have the same RSC boundaries, so we shim it to a no-op.
      'server-only': path.resolve(__dirname, 'lib/shims/server-only.ts'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Split docs collections into separate chunks for smaller bundles
        // Each collection gets its own chunk to avoid large monolithic bundles
        // Paths match import.meta.glob patterns from fumadocs: ./../../docs/{collection}/
        // Use specific patterns with trailing slash/path to avoid circular dependencies
        manualChunks(id) {
          // Extract the docs folder name from paths like: /docs/{folder}/ or docs/{folder}/
          const docsMatch = id.match(/\/docs\/([a-z-]+)\//)
          if (docsMatch) {
            const folder = docsMatch[1]
            // Map folder names to chunk names
            switch (folder) {
              case 'concepts': return 'docs-concepts'
              case 'api': return 'docs-api'
              case 'getting-started': return 'docs-getting-started'
              case 'integrations': return 'docs-sdks'
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
            }
          }
        },
      },
    },
  },
})
