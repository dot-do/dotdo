import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import tsConfigPaths from 'vite-tsconfig-paths'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import mdx from 'fumadocs-mdx/vite'
import path from 'node:path'
import * as MdxConfig from './source.config'

export default defineConfig({
  plugins: [
    mdx(MdxConfig),
    tailwindcss(),
    tsConfigPaths(),
    tanstackRouter({
      routesDirectory: './routes',
      generatedRouteTree: './src/routeTree.gen.ts',
      routeFileIgnorePrefix: '-',
      quoteStyle: 'single',
    }),
    react(),
  ],
  server: {
    port: 3000,
    strictPort: false,
    fs: {
      // Allow serving files from tests/mocks directory
      allow: ['..'],
    },
  },
  resolve: {
    alias: {
      '@tests/mocks': path.resolve(__dirname, '../tests/mocks'),
      // React 19 compatibility: redirect use-sync-external-store shim to our implementation
      'use-sync-external-store/shim/with-selector.js': path.resolve(__dirname, 'src/shims/use-sync-external-store-with-selector.ts'),
      'use-sync-external-store/shim/with-selector': path.resolve(__dirname, 'src/shims/use-sync-external-store-with-selector.ts'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
  },
  esbuild: {
    target: 'esnext',
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext',
    },
    // Exclude packages that have React 19 compatibility issues
    exclude: ['use-sync-external-store'],
  },
})
