/**
 * Vite Configuration for Docs SPA
 *
 * Builds the fumadocs documentation as a static SPA.
 * Deployed to Cloudflare Workers as static assets.
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // Optimize chunk splitting
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          fumadocs: ['fumadocs-core', 'fumadocs-ui'],
        },
      },
    },
  },
})
