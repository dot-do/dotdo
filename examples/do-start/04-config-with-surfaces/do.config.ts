/**
 * Config with Surfaces Example
 *
 * Demonstrates explicit configuration with do.config.ts
 * showing all available options for surface routing.
 */

import { defineConfig } from 'dotdo'

export default defineConfig({
  // ──────────────────────────────────────────────────────────────────────────
  // Project Settings
  // ──────────────────────────────────────────────────────────────────────────

  name: 'configured-app',

  // Entry point for Durable Objects (optional if using surfaces)
  entryPoint: './src/index.ts',

  // ──────────────────────────────────────────────────────────────────────────
  // Development Server
  // ──────────────────────────────────────────────────────────────────────────

  port: 4000,
  host: 'localhost',

  // Persist DO state between restarts
  persist: true,

  // ──────────────────────────────────────────────────────────────────────────
  // Cloudflare Settings
  // ──────────────────────────────────────────────────────────────────────────

  compatibilityDate: '2024-01-01',
  compatibilityFlags: ['nodejs_compat'],

  // ──────────────────────────────────────────────────────────────────────────
  // Durable Objects
  // ──────────────────────────────────────────────────────────────────────────

  durableObjects: {
    COUNTER: { className: 'Counter' },
    WORKSPACE: { className: 'Workspace' },
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Surfaces Configuration
  //
  // Explicit surface paths override automatic discovery.
  // Use this when you want custom file locations or content directories.
  // ──────────────────────────────────────────────────────────────────────────

  surfaces: {
    // Simple string path - just the component file
    app: './src/App.tsx',
    admin: './src/Admin.tsx',

    // Full config with shell and content directory
    site: {
      shell: './src/Site.mdx',
      content: './content/site/',
    },
    docs: {
      shell: './src/Docs.mdx',
      content: './content/docs/',
    },
    blog: {
      shell: './src/Blog.mdx',
      content: './content/blog/',
    },
  },
})
