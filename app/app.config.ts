import { defineConfig } from '@tanstack/start/config'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  server: {
    preset: 'cloudflare-pages',
    // Enable static prerendering
    prerender: {
      routes: ['/', '/docs', '/admin'],
      crawlLinks: true, // Auto-discover additional routes
    },
  },
  vite: {
    plugins: [tailwindcss()] as any, // Vite version mismatch between root and @tanstack/start-config
  },
  // Enable static export for Cloudflare Pages
  react: {
    babel: {
      plugins: [],
    },
  },
  routers: {
    ssr: {
      entry: './ssr.tsx',
    },
    client: {
      entry: './client.tsx',
    },
  },
  // Additional static export configuration
  deployment: {
    preset: 'cloudflare-pages-static',
  },
})
