/**
 * Vite configuration for TanStack Start
 *
 * Configures Vite with TanStack Start plugin for:
 * - File-based routing
 * - Static site generation (SSG)
 * - Server-side rendering support
 *
 * @see https://tanstack.com/start/latest/docs/config
 */
import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/start/plugin'

export default defineConfig({
  plugins: [tanstackStart()],
})
