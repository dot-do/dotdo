import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { parse } from 'smol-toml'

/**
 * RED Phase Tests for Workers Static Assets Configuration
 *
 * These tests verify that wrangler.toml has the correct [assets] configuration
 * for Cloudflare Workers Static Assets.
 *
 * Tests will FAIL until wrangler.toml is created with proper [assets] section.
 *
 * Static Assets allow serving static files (HTML, CSS, JS) directly from
 * Cloudflare's edge while routing dynamic requests (/api/*, /mcp, /rpc/*)
 * to the Worker.
 *
 * @see https://developers.cloudflare.com/workers/static-assets/
 */

const PROJECT_ROOT = join(__dirname, '../..')
const WRANGLER_PATH = join(PROJECT_ROOT, 'wrangler.toml')

interface WranglerConfig {
  assets?: {
    directory?: string
    binding?: string
    html_handling?: string
    not_found_handling?: string
    run_worker_first?: string[]
  }
  raw: string
}

/**
 * Parse wrangler.toml using smol-toml
 */
function parseWranglerToml(): WranglerConfig {
  if (!existsSync(WRANGLER_PATH)) {
    throw new Error(`wrangler.toml not found at ${WRANGLER_PATH}`)
  }
  const raw = readFileSync(WRANGLER_PATH, 'utf-8')
  const config = parse(raw) as Record<string, unknown>

  return {
    assets: config.assets as WranglerConfig['assets'],
    raw,
  }
}

describe('Workers Static Assets Configuration', () => {
  describe('wrangler.toml existence', () => {
    it('wrangler.toml exists', () => {
      expect(existsSync(WRANGLER_PATH)).toBe(true)
    })
  })

  describe('[assets] section', () => {
    it('has [assets] section configured', () => {
      const config = parseWranglerToml()
      expect(config.assets).toBeDefined()
    })

    it('has directory = "./dist" configured', () => {
      const config = parseWranglerToml()
      expect(config.assets?.directory).toBe('./dist')
    })

    it('has binding = "ASSETS" configured', () => {
      const config = parseWranglerToml()
      expect(config.assets?.binding).toBe('ASSETS')
    })

    it('has not_found_handling = "single-page-application" configured', () => {
      const config = parseWranglerToml()
      expect(config.assets?.not_found_handling).toBe('single-page-application')
    })

    it('has run_worker_first configured for dynamic routes', () => {
      const config = parseWranglerToml()
      expect(config.assets?.run_worker_first).toBeDefined()
      expect(Array.isArray(config.assets?.run_worker_first)).toBe(true)
    })

    it('run_worker_first includes /api/*', () => {
      const config = parseWranglerToml()
      expect(config.assets?.run_worker_first).toContain('/api/*')
    })

    it('run_worker_first includes /mcp', () => {
      const config = parseWranglerToml()
      expect(config.assets?.run_worker_first).toContain('/mcp')
    })

    it('run_worker_first includes /rpc/*', () => {
      const config = parseWranglerToml()
      expect(config.assets?.run_worker_first).toContain('/rpc/*')
    })

    it('run_worker_first has exactly the expected routes', () => {
      const config = parseWranglerToml()
      const expectedRoutes = ['/api/*', '/mcp', '/rpc/*']
      expect(config.assets?.run_worker_first).toEqual(expect.arrayContaining(expectedRoutes))
      expect(config.assets?.run_worker_first?.length).toBe(expectedRoutes.length)
    })
  })

  describe('Static routes (no worker invocation)', () => {
    /**
     * These routes should be served directly from static assets
     * without invoking the Worker. This is handled by NOT including
     * them in run_worker_first.
     */

    it('/ (root) is NOT in run_worker_first', () => {
      const config = parseWranglerToml()
      const runWorkerFirst = config.assets?.run_worker_first ?? []

      // Root should not be in run_worker_first - it should serve static index.html
      const matchesRoot = runWorkerFirst.some((pattern) => pattern === '/' || pattern === '/*')
      expect(matchesRoot).toBe(false)
    })

    it('/docs/* is NOT in run_worker_first', () => {
      const config = parseWranglerToml()
      const runWorkerFirst = config.assets?.run_worker_first ?? []

      // Docs should be static - not in run_worker_first
      const matchesDocs = runWorkerFirst.some((pattern) => pattern === '/docs/*' || pattern === '/docs' || pattern === '/docs/**')
      expect(matchesDocs).toBe(false)
    })

    it('/admin/* is NOT in run_worker_first', () => {
      const config = parseWranglerToml()
      const runWorkerFirst = config.assets?.run_worker_first ?? []

      // Admin UI should be static - not in run_worker_first
      const matchesAdmin = runWorkerFirst.some((pattern) => pattern === '/admin/*' || pattern === '/admin' || pattern === '/admin/**')
      expect(matchesAdmin).toBe(false)
    })

    it('static asset paths are served from ./dist directory', () => {
      const config = parseWranglerToml()

      // Verify the directory is set to ./dist
      // Static routes like /, /docs/*, /admin/* will be served from here
      expect(config.assets?.directory).toBe('./dist')
    })
  })

  describe('Dynamic routes (worker invocation)', () => {
    /**
     * These routes should invoke the Worker first, before checking
     * static assets. This enables API endpoints, MCP protocol, and
     * RPC handlers to work.
     */

    it('/api/* routes invoke the worker', () => {
      const config = parseWranglerToml()
      const runWorkerFirst = config.assets?.run_worker_first ?? []

      // /api/* must be in run_worker_first for API endpoints to work
      expect(runWorkerFirst).toContain('/api/*')
    })

    it('/mcp route invokes the worker', () => {
      const config = parseWranglerToml()
      const runWorkerFirst = config.assets?.run_worker_first ?? []

      // /mcp must be in run_worker_first for MCP protocol to work
      expect(runWorkerFirst).toContain('/mcp')
    })

    it('/rpc/* routes invoke the worker', () => {
      const config = parseWranglerToml()
      const runWorkerFirst = config.assets?.run_worker_first ?? []

      // /rpc/* must be in run_worker_first for RPC handlers to work
      expect(runWorkerFirst).toContain('/rpc/*')
    })

    it('all dynamic routes are configured', () => {
      const config = parseWranglerToml()
      const runWorkerFirst = config.assets?.run_worker_first ?? []

      const dynamicRoutes = ['/api/*', '/mcp', '/rpc/*']

      for (const route of dynamicRoutes) {
        expect(runWorkerFirst).toContain(route)
      }
    })
  })

  describe('SPA handling', () => {
    /**
     * Single Page Application handling ensures that navigation
     * to routes like /docs/getting-started returns index.html
     * instead of 404, allowing client-side routing to work.
     */

    it('enables SPA not_found_handling for client-side routing', () => {
      const config = parseWranglerToml()

      // This enables serving index.html for unknown static paths
      // Essential for SPA client-side routing
      expect(config.assets?.not_found_handling).toBe('single-page-application')
    })
  })

  describe('ASSETS binding', () => {
    /**
     * The ASSETS binding allows the Worker to access static assets
     * programmatically when needed. This is useful for:
     * - Serving index.html with injected data
     * - Custom 404 handling
     * - Asset manipulation before serving
     */

    it('provides ASSETS binding for programmatic access', () => {
      const config = parseWranglerToml()

      // ASSETS binding allows worker code to fetch static files
      expect(config.assets?.binding).toBe('ASSETS')
    })
  })
})
