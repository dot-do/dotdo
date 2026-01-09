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
    html_handling?: 'auto-trailing-slash' | 'force-trailing-slash' | 'drop-trailing-slash' | 'none'
    not_found_handling?: 'single-page-application' | '404-page' | 'none'
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

  describe('HTML handling', () => {
    /**
     * HTML handling controls trailing slash behavior for SEO.
     * auto-trailing-slash: Individual files without slash, folders with slash
     * This helps avoid duplicate content issues in search engines.
     */

    it('has html_handling configured for SEO-friendly URLs', () => {
      const config = parseWranglerToml()
      expect(config.assets?.html_handling).toBeDefined()
    })

    it('uses auto-trailing-slash for canonical URL handling', () => {
      const config = parseWranglerToml()
      // auto-trailing-slash: files served without slash, folders with slash
      expect(config.assets?.html_handling).toBe('auto-trailing-slash')
    })
  })
})

describe('Static Assets Support Files', () => {
  const PUBLIC_DIR = join(PROJECT_ROOT, 'public')
  const HEADERS_PATH = join(PUBLIC_DIR, '_headers')
  const ASSETSIGNORE_PATH = join(PUBLIC_DIR, '.assetsignore')

  describe('_headers file', () => {
    /**
     * The _headers file configures cache control and security headers
     * for static assets served by Cloudflare Workers.
     */

    it('_headers file exists in public directory', () => {
      expect(existsSync(HEADERS_PATH)).toBe(true)
    })

    it('_headers has cache rules for fingerprinted assets', () => {
      const content = readFileSync(HEADERS_PATH, 'utf-8')
      // Fingerprinted assets should have immutable cache
      expect(content).toContain('/assets/*')
      expect(content).toContain('immutable')
    })

    it('_headers has security headers', () => {
      const content = readFileSync(HEADERS_PATH, 'utf-8')
      expect(content).toContain('X-Content-Type-Options')
      expect(content).toContain('X-Frame-Options')
    })

    it('_headers has cache rules for HTML pages', () => {
      const content = readFileSync(HEADERS_PATH, 'utf-8')
      // HTML should use short cache with revalidation for SPA
      expect(content).toContain('/*.html')
      expect(content).toContain('must-revalidate')
    })

    it('_headers has cache rules for documentation', () => {
      const content = readFileSync(HEADERS_PATH, 'utf-8')
      expect(content).toContain('/docs/*')
    })

    it('_headers has no-cache rules for admin pages', () => {
      const content = readFileSync(HEADERS_PATH, 'utf-8')
      expect(content).toContain('/admin/*')
      expect(content).toContain('no-cache')
    })
  })

  describe('.assetsignore file', () => {
    /**
     * The .assetsignore file excludes files from being uploaded
     * as static assets to Cloudflare.
     */

    it('.assetsignore file exists in public directory', () => {
      expect(existsSync(ASSETSIGNORE_PATH)).toBe(true)
    })

    it('.assetsignore excludes source maps', () => {
      const content = readFileSync(ASSETSIGNORE_PATH, 'utf-8')
      expect(content).toContain('*.map')
    })

    it('.assetsignore excludes TypeScript files', () => {
      const content = readFileSync(ASSETSIGNORE_PATH, 'utf-8')
      expect(content).toContain('*.ts')
    })

    it('.assetsignore excludes test files', () => {
      const content = readFileSync(ASSETSIGNORE_PATH, 'utf-8')
      expect(content).toContain('*.test.*')
    })

    it('.assetsignore excludes node_modules', () => {
      const content = readFileSync(ASSETSIGNORE_PATH, 'utf-8')
      expect(content).toContain('node_modules/')
    })
  })
})
