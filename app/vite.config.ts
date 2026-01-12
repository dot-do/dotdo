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
      // TODO: Re-enable once @mdxui/primitives SSR compatibility is fixed
      // Current error: ERR_UNKNOWN_FILE_EXTENSION for .tsx files in node_modules
      prerender: {
        enabled: false,
        // Lower concurrency to manage memory (default 14)
        concurrency: 2,
        // Crawl links to discover all docs pages automatically
        // Starting from /docs, it will find all linked pages
        crawlLinks: true,
        // Start with root routes - crawlLinks will discover docs pages
        routes: [
          '/',
          '/docs',
        ],
      },
    }),
    react(),
  ],
  resolve: {
    alias: {
      '@tests/mocks': path.resolve(__dirname, '../tests/mocks'),
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
