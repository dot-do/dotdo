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
      // Note: Prerender is disabled due to memory constraints with 170+ docs
      // SSR still provides good SEO. To enable static generation:
      // 1. Reduce docs count or split into multiple builds
      // 2. Run with NODE_OPTIONS="--max-old-space-size=16384"
      // prerender: { enabled: true },
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
  },
})
