import { defineConfig } from 'vite'
import mdx from 'fumadocs-mdx/vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import tsConfigPaths from 'vite-tsconfig-paths'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    mdx(await import('../source.config')),
    tailwindcss(),
    tsConfigPaths(),
    tanstackStart({
      spa: {
        enabled: true,
        prerender: { enabled: true },
      },
    }),
    cloudflare(),
    react(),
  ],
})
