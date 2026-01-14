/**
 * Vitest config for core architectural tests
 *
 * These tests need to run in Node.js (not Cloudflare Workers pool)
 * because they scan the filesystem to verify the core/ package
 * has no Cloudflare dependencies.
 */

import { defineConfig } from 'vitest/config'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default defineConfig({
  test: {
    globals: true,
    root: __dirname,
    include: ['**/*.test.ts'],
    // Run in Node.js, not Workers pool
    environment: 'node',
  },
  resolve: {
    alias: {
      // Ensure we can resolve paths correctly
      '@': path.resolve(__dirname, '../../'),
    },
  },
})
