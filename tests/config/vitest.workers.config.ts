/**
 * Vitest Workers Configuration
 *
 * Configuration for tests that run in the Cloudflare Workers runtime.
 * Uses @cloudflare/vitest-pool-workers for true Workers environment testing.
 *
 * Features:
 * - Isolated storage between tests (KV, DO, etc.)
 * - Single worker mode for stability
 * - Access to cloudflare:test utilities (env, SELF, fetchMock)
 * - D1 migrations support
 *
 * Extended by vitest.workspace.ts for the 'workers' project.
 *
 * @see https://developers.cloudflare.com/workers/testing/vitest-integration/
 */

import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'
import { resolve } from 'path'
import type { Plugin } from 'vite'

// Resolve path to duckdb-wasm browser-blocking module
// The package doesn't export this path in its exports field, but the file exists
const DUCKDB_BROWSER_BLOCKING = resolve(
  __dirname,
  '../../node_modules/@duckdb/duckdb-wasm/dist/duckdb-browser-blocking.mjs'
)

/**
 * Vite plugin to patch DuckDB WASM's bundled sha256 code for Workers compatibility
 * The sha256 module detects Node.js and uses Buffer.from() which doesn't exist in Workers.
 * We patch the code to disable Node.js detection by replacing the detection pattern.
 */
function patchDuckDBForWorkers(): Plugin {
  return {
    name: 'patch-duckdb-workers',
    enforce: 'pre',
    transform(code, id) {
      // Only transform the duckdb-browser-blocking module
      if (id.includes('duckdb-browser-blocking')) {
        // The sha256 module has this pattern:
        // n=!r.JS_SHA256_NO_NODE_JS&&typeof process=="object"&&process.versions&&process.versions.node
        // We replace 'typeof process=="object"' to always return false, disabling Node.js mode

        let patched = code

        // Replace Node.js detection patterns to force browser mode
        // Pattern 1: typeof process=="object"
        patched = patched.replace(
          /typeof process=="object"&&process\.versions&&process\.versions\.node/g,
          'false'
        )
        // Pattern 2: process.type!="renderer"
        patched = patched.replace(
          /process\.type!="renderer"/g,
          'true'
        )

        return patched
      }
      return null
    },
  }
}

export default defineWorkersConfig({
  plugins: [patchDuckDBForWorkers()],
  resolve: {
    alias: {
      // Map the import path to the actual file location
      '@duckdb/duckdb-wasm/dist/duckdb-browser-blocking.mjs': DUCKDB_BROWSER_BLOCKING,
    },
  },
  // SSR options for miniflare compatibility
  ssr: {
    // These packages need to be transformed by Vite
    noExternal: ['@duckdb/duckdb-wasm'],
  },
  // Optimize deps to properly handle duckdb-wasm in Workers
  optimizeDeps: {
    // Don't optimize duckdb-wasm - let miniflare handle it directly
    exclude: ['@duckdb/duckdb-wasm'],
  },
  test: {
    // Enable globals (describe, it, expect) without imports
    globals: true,

    // Use Cloudflare Workers pool
    pool: '@cloudflare/vitest-pool-workers',

    poolOptions: {
      workers: {
        // Use the main wrangler config for bindings
        wrangler: { configPath: './wrangler.jsonc' },

        // Isolate storage between tests for deterministic results
        // Each test starts with clean KV, DO, etc.
        isolatedStorage: true,

        // Single worker mode for CI stability
        // Prevents race conditions between parallel tests
        singleWorker: true,

        // Miniflare options for local development
        miniflare: {
          // Enable verbose logging in debug mode
          verbose: process.env.DEBUG === 'true',

          // Compatibility settings
          compatibilityDate: '2026-01-08',
          compatibilityFlags: ['nodejs_compat', 'nodejs_compat_v2'],

          // Enable outbound network access for CDN fetches (e.g., jsDelivr for WASM)
          outboundService: 'internet',
        },
      },
    },

    // Test timeout for Workers tests (network operations may be slower)
    testTimeout: 15_000,
    hookTimeout: 15_000,

    // Retry flaky tests in CI
    retry: process.env.CI ? 1 : 0,
  },
})
