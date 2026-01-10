import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Artifact Serve Snippet Tests (RED Phase)
 *
 * Tests for the artifacts-serve.ts snippet that serves compiled artifacts
 * (markdown, HTML, ESM, DTS, etc.) from R2 Iceberg storage with CDN caching.
 *
 * URL Pattern: GET /$.content/{ns}/{type}/{id}.{ext}
 *
 * Features:
 * - Path parsing: Extract ns, type, id, ext from URL
 * - Extension mapping: Map file extension to database column
 * - Cache-Control: Generate SWR headers based on tenant config
 * - Content-Type: Return correct MIME type per extension
 * - SWR pattern: Stale-while-revalidate caching
 * - Query params: ?max_age=N override, ?fresh=true bypass
 * - 404 handling: Proper error responses for missing artifacts
 *
 * These tests are expected to FAIL until the serve snippet is implemented.
 *
 * @module snippets/tests/artifacts-serve.test
 * @see docs/plans/2026-01-10-artifact-storage-design.md
 */

// ============================================================================
// Imports from the to-be-implemented artifacts-serve snippet
// ============================================================================

// These imports will fail until the snippet is implemented
import {
  parsePath,
  getColumnForExtension,
  getContentType,
  buildCacheControl,
  handleServe,
  type TenantConfig,
  type ParsedPath,
  type ServeOptions,
} from '../artifacts-serve'

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Default tenant configuration for testing.
 */
const DEFAULT_TENANT_CONFIG: TenantConfig = {
  ns: 'app.do',
  pipelines: {
    allowedModes: ['preview', 'build', 'bulk'],
    defaultMode: 'build',
  },
  cache: {
    defaultMaxAge: 300, // 5 minutes
    defaultStaleWhileRevalidate: 60,
    minMaxAge: 10,
    allowFreshBypass: true,
  },
  limits: {
    maxArtifactsPerRequest: 1000,
    maxBytesPerRequest: 10_485_760,
    maxRequestsPerMinute: 100,
  },
}

/**
 * Creates a test tenant config with overrides.
 */
function createTenantConfig(overrides: Partial<TenantConfig> = {}): TenantConfig {
  return {
    ...DEFAULT_TENANT_CONFIG,
    ...overrides,
    cache: {
      ...DEFAULT_TENANT_CONFIG.cache,
      ...(overrides.cache ?? {}),
    },
    pipelines: {
      ...DEFAULT_TENANT_CONFIG.pipelines,
      ...(overrides.pipelines ?? {}),
    },
    limits: {
      ...DEFAULT_TENANT_CONFIG.limits,
      ...(overrides.limits ?? {}),
    },
  }
}

/**
 * Creates a mock Request object.
 */
function createRequest(
  path: string,
  options: { method?: string; headers?: Record<string, string> } = {}
): Request {
  const url = `https://artifacts.dotdo.dev${path}`
  return new Request(url, {
    method: options.method ?? 'GET',
    headers: new Headers(options.headers ?? {}),
  })
}

/**
 * Creates a mock ExecutionContext.
 */
function createContext(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext
}

/**
 * Mock artifact data for testing.
 */
const MOCK_ARTIFACTS = {
  'app.do/Page/home': {
    ns: 'app.do',
    type: 'Page',
    id: 'home',
    markdown: '# Home\n\nWelcome to the home page.',
    mdx: 'export default function Home() { return <h1>Home</h1> }',
    html: '<h1>Home</h1><p>Welcome to the home page.</p>',
    esm: 'export const title = "Home";',
    dts: 'export declare const title: string;',
    css: 'h1 { color: blue; }',
    frontmatter: { title: 'Home', description: 'Welcome page' },
    mdast: { type: 'root', children: [] },
    hast: { type: 'root', children: [] },
    estree: { type: 'Program', body: [] },
  },
  'app.do/Component/Button': {
    ns: 'app.do',
    type: 'Component',
    id: 'Button',
    mdx: 'export function Button({ children }) { return <button>{children}</button> }',
    esm: 'export function Button({ children }) { return /*#__PURE__*/React.createElement("button", null, children); }',
    dts: 'export declare function Button({ children }: { children: React.ReactNode }): JSX.Element;',
    css: 'button { padding: 8px 16px; }',
  },
}

/**
 * Creates a mock IcebergReader for testing.
 */
function createMockIcebergReader(artifacts: typeof MOCK_ARTIFACTS = MOCK_ARTIFACTS) {
  return {
    getRecord: vi.fn(async (options: { partition: { ns: string; type: string }; id: string }) => {
      const key = `${options.partition.ns}/${options.partition.type}/${options.id}`
      return artifacts[key as keyof typeof artifacts] ?? null
    }),
  }
}

/**
 * Creates a mock Cache API for testing.
 */
function createMockCacheApi() {
  const store = new Map<string, { response: Response; cachedAt: number; maxAge: number; swrWindow: number }>()

  return {
    default: {
      match: vi.fn(async (request: Request | string) => {
        const url = typeof request === 'string' ? request : request.url
        const entry = store.get(url)
        if (!entry) return undefined

        // Check if entry is still valid (within max-age + stale-while-revalidate window)
        const age = (Date.now() - entry.cachedAt) / 1000
        if (age > entry.maxAge + entry.swrWindow) {
          return undefined // Fully expired (past SWR window)
        }

        return entry.response.clone()
      }),
      put: vi.fn(async (request: Request | string, response: Response) => {
        const url = typeof request === 'string' ? request : request.url
        const cacheControl = response.headers.get('Cache-Control')
        const maxAgeMatch = cacheControl?.match(/max-age=(\d+)/)
        const swrMatch = cacheControl?.match(/stale-while-revalidate=(\d+)/)
        const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1]) : 300
        const swrWindow = swrMatch ? parseInt(swrMatch[1]) : 0

        store.set(url, {
          response: response.clone(),
          cachedAt: Date.now(),
          maxAge,
          swrWindow,
        })
      }),
      delete: vi.fn(async (request: Request | string) => {
        const url = typeof request === 'string' ? request : request.url
        return store.delete(url)
      }),
    },
    _store: store,
    _setStale: (url: string, staleSeconds: number) => {
      const entry = store.get(url)
      if (entry) {
        // Make it appear stale by backdating cachedAt
        entry.cachedAt = Date.now() - (entry.maxAge * 1000) - (staleSeconds * 1000)
      }
    },
  }
}

// ============================================================================
// Path Parsing Tests
// ============================================================================

describe('Artifact Serve - Path Parsing', () => {
  it('parses standard path /{ns}/{type}/{id}.{ext}', () => {
    const url = new URL('https://artifacts.dotdo.dev/$.content/app.do/Page/home.md')
    const result = parsePath(url)

    expect(result).toEqual({
      ns: 'app.do',
      type: 'Page',
      id: 'home',
      ext: 'md',
    })
  })

  it('parses path with .html extension', () => {
    const url = new URL('https://artifacts.dotdo.dev/$.content/app.do/Page/home.html')
    const result = parsePath(url)

    expect(result).toEqual({
      ns: 'app.do',
      type: 'Page',
      id: 'home',
      ext: 'html',
    })
  })

  it('parses path with .js extension', () => {
    const url = new URL('https://artifacts.dotdo.dev/$.content/app.do/Component/Button.js')
    const result = parsePath(url)

    expect(result).toEqual({
      ns: 'app.do',
      type: 'Component',
      id: 'Button',
      ext: 'js',
    })
  })

  it('parses path with .mjs extension', () => {
    const url = new URL('https://artifacts.dotdo.dev/$.content/app.do/Component/Button.mjs')
    const result = parsePath(url)

    expect(result).toEqual({
      ns: 'app.do',
      type: 'Component',
      id: 'Button',
      ext: 'mjs',
    })
  })

  it('parses path with .d.ts extension (compound)', () => {
    const url = new URL('https://artifacts.dotdo.dev/$.content/app.do/Component/Button.d.ts')
    const result = parsePath(url)

    expect(result).toEqual({
      ns: 'app.do',
      type: 'Component',
      id: 'Button',
      ext: 'd.ts',
    })
  })

  it('parses path with .mdx extension', () => {
    const url = new URL('https://artifacts.dotdo.dev/$.content/app.do/Page/docs.mdx')
    const result = parsePath(url)

    expect(result).toEqual({
      ns: 'app.do',
      type: 'Page',
      id: 'docs',
      ext: 'mdx',
    })
  })

  it('parses path with .css extension', () => {
    const url = new URL('https://artifacts.dotdo.dev/$.content/app.do/Component/Button.css')
    const result = parsePath(url)

    expect(result).toEqual({
      ns: 'app.do',
      type: 'Component',
      id: 'Button',
      ext: 'css',
    })
  })

  it('parses path with .json extension (frontmatter)', () => {
    const url = new URL('https://artifacts.dotdo.dev/$.content/app.do/Page/home.json')
    const result = parsePath(url)

    expect(result).toEqual({
      ns: 'app.do',
      type: 'Page',
      id: 'home',
      ext: 'json',
    })
  })

  it('parses path with .mdast.json extension', () => {
    const url = new URL('https://artifacts.dotdo.dev/$.content/app.do/Page/home.mdast.json')
    const result = parsePath(url)

    expect(result).toEqual({
      ns: 'app.do',
      type: 'Page',
      id: 'home',
      ext: 'mdast.json',
    })
  })

  it('parses path with .hast.json extension', () => {
    const url = new URL('https://artifacts.dotdo.dev/$.content/app.do/Page/home.hast.json')
    const result = parsePath(url)

    expect(result).toEqual({
      ns: 'app.do',
      type: 'Page',
      id: 'home',
      ext: 'hast.json',
    })
  })

  it('parses path with .estree.json extension', () => {
    const url = new URL('https://artifacts.dotdo.dev/$.content/app.do/Component/Button.estree.json')
    const result = parsePath(url)

    expect(result).toEqual({
      ns: 'app.do',
      type: 'Component',
      id: 'Button',
      ext: 'estree.json',
    })
  })

  it('parses path with nested namespace (subdomain style)', () => {
    const url = new URL('https://artifacts.dotdo.dev/$.content/myorg.app.do/Page/home.md')
    const result = parsePath(url)

    expect(result).toEqual({
      ns: 'myorg.app.do',
      type: 'Page',
      id: 'home',
      ext: 'md',
    })
  })

  it('parses path with hyphenated id', () => {
    const url = new URL('https://artifacts.dotdo.dev/$.content/app.do/Page/getting-started.md')
    const result = parsePath(url)

    expect(result).toEqual({
      ns: 'app.do',
      type: 'Page',
      id: 'getting-started',
      ext: 'md',
    })
  })

  it('parses path with underscored id', () => {
    const url = new URL('https://artifacts.dotdo.dev/$.content/app.do/Function/create_user.js')
    const result = parsePath(url)

    expect(result).toEqual({
      ns: 'app.do',
      type: 'Function',
      id: 'create_user',
      ext: 'js',
    })
  })

  it('returns null for invalid path (missing components)', () => {
    const url = new URL('https://artifacts.dotdo.dev/$.content/app.do/Page')
    const result = parsePath(url)

    expect(result).toBeNull()
  })

  it('returns null for path without extension', () => {
    const url = new URL('https://artifacts.dotdo.dev/$.content/app.do/Page/home')
    const result = parsePath(url)

    expect(result).toBeNull()
  })

  it('returns null for path with unknown extension', () => {
    const url = new URL('https://artifacts.dotdo.dev/$.content/app.do/Page/home.xyz')
    const result = parsePath(url)

    expect(result).toBeNull()
  })

  it('handles URL-encoded characters in id', () => {
    const url = new URL('https://artifacts.dotdo.dev/$.content/app.do/Page/hello%20world.md')
    const result = parsePath(url)

    expect(result).toEqual({
      ns: 'app.do',
      type: 'Page',
      id: 'hello world',
      ext: 'md',
    })
  })

  it('ignores query parameters when parsing path', () => {
    const url = new URL('https://artifacts.dotdo.dev/$.content/app.do/Page/home.md?max_age=60')
    const result = parsePath(url)

    expect(result).toEqual({
      ns: 'app.do',
      type: 'Page',
      id: 'home',
      ext: 'md',
    })
  })
})

// ============================================================================
// Extension to Column Mapping Tests
// ============================================================================

describe('Artifact Serve - Extension Mapping', () => {
  it('maps .md to markdown column', () => {
    expect(getColumnForExtension('md')).toBe('markdown')
  })

  it('maps .mdx to mdx column', () => {
    expect(getColumnForExtension('mdx')).toBe('mdx')
  })

  it('maps .html to html column', () => {
    expect(getColumnForExtension('html')).toBe('html')
  })

  it('maps .js to esm column', () => {
    expect(getColumnForExtension('js')).toBe('esm')
  })

  it('maps .mjs to esm column', () => {
    expect(getColumnForExtension('mjs')).toBe('esm')
  })

  it('maps .d.ts to dts column', () => {
    expect(getColumnForExtension('d.ts')).toBe('dts')
  })

  it('maps .css to css column', () => {
    expect(getColumnForExtension('css')).toBe('css')
  })

  it('maps .json to frontmatter column', () => {
    expect(getColumnForExtension('json')).toBe('frontmatter')
  })

  it('maps .mdast.json to mdast column', () => {
    expect(getColumnForExtension('mdast.json')).toBe('mdast')
  })

  it('maps .hast.json to hast column', () => {
    expect(getColumnForExtension('hast.json')).toBe('hast')
  })

  it('maps .estree.json to estree column', () => {
    expect(getColumnForExtension('estree.json')).toBe('estree')
  })

  it('throws error for unknown extension', () => {
    expect(() => getColumnForExtension('xyz')).toThrow(/unsupported|unknown/i)
  })

  it('handles case-insensitive extension matching', () => {
    expect(getColumnForExtension('MD')).toBe('markdown')
    expect(getColumnForExtension('Html')).toBe('html')
    expect(getColumnForExtension('JS')).toBe('esm')
  })
})

// ============================================================================
// Content-Type Tests
// ============================================================================

describe('Artifact Serve - Content-Type', () => {
  it('returns text/markdown for .md', () => {
    expect(getContentType('md')).toBe('text/markdown; charset=utf-8')
  })

  it('returns text/mdx for .mdx', () => {
    expect(getContentType('mdx')).toBe('text/mdx; charset=utf-8')
  })

  it('returns text/html for .html', () => {
    expect(getContentType('html')).toBe('text/html; charset=utf-8')
  })

  it('returns application/javascript for .js', () => {
    expect(getContentType('js')).toBe('application/javascript; charset=utf-8')
  })

  it('returns application/javascript for .mjs', () => {
    expect(getContentType('mjs')).toBe('application/javascript; charset=utf-8')
  })

  it('returns application/typescript for .d.ts', () => {
    expect(getContentType('d.ts')).toBe('application/typescript; charset=utf-8')
  })

  it('returns text/css for .css', () => {
    expect(getContentType('css')).toBe('text/css; charset=utf-8')
  })

  it('returns application/json for .json', () => {
    expect(getContentType('json')).toBe('application/json')
  })

  it('returns application/json for .mdast.json', () => {
    expect(getContentType('mdast.json')).toBe('application/json')
  })

  it('returns application/json for .hast.json', () => {
    expect(getContentType('hast.json')).toBe('application/json')
  })

  it('returns application/json for .estree.json', () => {
    expect(getContentType('estree.json')).toBe('application/json')
  })
})

// ============================================================================
// Cache-Control Header Generation Tests
// ============================================================================

describe('Artifact Serve - Cache-Control Headers', () => {
  it('generates Cache-Control with default config', () => {
    const config = createTenantConfig()
    const header = buildCacheControl(config)

    expect(header).toBe('public, max-age=300, stale-while-revalidate=60')
  })

  it('uses custom defaultMaxAge from config', () => {
    const config = createTenantConfig({
      cache: { defaultMaxAge: 600 },
    })
    const header = buildCacheControl(config)

    expect(header).toContain('max-age=600')
  })

  it('uses custom stale-while-revalidate from config', () => {
    const config = createTenantConfig({
      cache: { defaultStaleWhileRevalidate: 120 },
    })
    const header = buildCacheControl(config)

    expect(header).toContain('stale-while-revalidate=120')
  })

  it('allows max_age override via options', () => {
    const config = createTenantConfig()
    const header = buildCacheControl(config, { maxAge: 60 })

    expect(header).toContain('max-age=60')
  })

  it('enforces minMaxAge from config', () => {
    const config = createTenantConfig({
      cache: { minMaxAge: 30 },
    })
    // Try to set max_age below minimum
    const header = buildCacheControl(config, { maxAge: 5 })

    // Should be clamped to minimum
    expect(header).toContain('max-age=30')
  })

  it('allows max_age at exactly minMaxAge', () => {
    const config = createTenantConfig({
      cache: { minMaxAge: 10 },
    })
    const header = buildCacheControl(config, { maxAge: 10 })

    expect(header).toContain('max-age=10')
  })

  it('omits stale-while-revalidate when set to 0', () => {
    const config = createTenantConfig({
      cache: { defaultStaleWhileRevalidate: 0 },
    })
    const header = buildCacheControl(config)

    expect(header).not.toContain('stale-while-revalidate')
    expect(header).toBe('public, max-age=300')
  })

  it('sets private when visibility is private', () => {
    const config = createTenantConfig()
    const header = buildCacheControl(config, { visibility: 'private' })

    expect(header).toContain('private')
    expect(header).not.toContain('public')
  })

  it('sets no-store for fresh bypass', () => {
    const config = createTenantConfig()
    const header = buildCacheControl(config, { fresh: true })

    expect(header).toBe('no-store')
  })
})

// ============================================================================
// SWR (Stale-While-Revalidate) Behavior Tests
// ============================================================================

describe('Artifact Serve - SWR Caching', () => {
  let mockCache: ReturnType<typeof createMockCacheApi>
  let mockReader: ReturnType<typeof createMockIcebergReader>

  beforeEach(() => {
    mockCache = createMockCacheApi()
    mockReader = createMockIcebergReader()
    vi.stubGlobal('caches', mockCache)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns cached response on cache hit (fresh)', async () => {
    const request = createRequest('/$.content/app.do/Page/home.md')
    const ctx = createContext()
    const config = createTenantConfig()

    // Pre-populate cache with fresh entry
    const cachedResponse = new Response('# Cached Home', {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
        'X-Artifact-Source': 'cache',
      },
    })
    await mockCache.default.put(request.url, cachedResponse)

    const response = await handleServe(request, ctx, {
      config,
      reader: mockReader as never,
    })

    // Should return cached response
    expect(response.headers.get('X-Artifact-Source')).toBe('cache')
    // Should NOT fetch from IcebergReader
    expect(mockReader.getRecord).not.toHaveBeenCalled()
  })

  it('returns cached response and revalidates in background (stale)', async () => {
    const request = createRequest('/$.content/app.do/Page/home.md')
    const ctx = createContext()
    const config = createTenantConfig()

    // Pre-populate cache with stale entry (Date header indicates it's past max-age)
    // max-age=300, and we want it to be 30 seconds past max-age (330 seconds old)
    const cachedResponse = new Response('# Stale Home', {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
        'X-Artifact-Source': 'cache',
        'Date': new Date(Date.now() - 330000).toUTCString(), // 330 seconds ago (past max-age)
      },
    })
    await mockCache.default.put(request.url, cachedResponse)
    // Make the mock entry stale (past max-age but within SWR window)
    mockCache._setStale(request.url, 30) // 30 seconds past max-age

    const response = await handleServe(request, ctx, {
      config,
      reader: mockReader as never,
    })

    // Should return stale cached response immediately
    expect(await response.text()).toBe('# Stale Home')
    // Should trigger background revalidation via waitUntil
    expect(ctx.waitUntil).toHaveBeenCalled()
  })

  it('fetches from IcebergReader on cache miss', async () => {
    const request = createRequest('/$.content/app.do/Page/home.md')
    const ctx = createContext()
    const config = createTenantConfig()

    const response = await handleServe(request, ctx, {
      config,
      reader: mockReader as never,
    })

    // Should fetch from IcebergReader
    expect(mockReader.getRecord).toHaveBeenCalledWith({
      table: 'do_resources',
      partition: { ns: 'app.do', type: 'Page' },
      id: 'home',
    })

    // Should return fresh content
    const body = await response.text()
    expect(body).toBe('# Home\n\nWelcome to the home page.')
    expect(response.headers.get('X-Artifact-Source')).toBe('parquet')
  })

  it('populates cache after fetching from IcebergReader', async () => {
    const request = createRequest('/$.content/app.do/Page/home.md')
    const ctx = createContext()
    const config = createTenantConfig()

    await handleServe(request, ctx, {
      config,
      reader: mockReader as never,
    })

    // Should populate cache via waitUntil
    expect(ctx.waitUntil).toHaveBeenCalled()
    expect(mockCache.default.put).toHaveBeenCalled()
  })

  it('includes X-Artifact-Age header showing cache age', async () => {
    const request = createRequest('/$.content/app.do/Page/home.md')
    const ctx = createContext()
    const config = createTenantConfig()

    // Pre-populate cache with entry
    const cachedResponse = new Response('# Cached', {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
        'X-Artifact-Source': 'cache',
        'Date': new Date(Date.now() - 45000).toUTCString(), // 45 seconds ago
      },
    })
    await mockCache.default.put(request.url, cachedResponse)

    const response = await handleServe(request, ctx, {
      config,
      reader: mockReader as never,
    })

    const age = response.headers.get('X-Artifact-Age')
    expect(age).toBeDefined()
    // Age should be approximately 45 (allow some variance)
    expect(parseInt(age!)).toBeGreaterThanOrEqual(40)
    expect(parseInt(age!)).toBeLessThanOrEqual(50)
  })
})

// ============================================================================
// Query Parameter Tests
// ============================================================================

describe('Artifact Serve - Query Parameters', () => {
  let mockCache: ReturnType<typeof createMockCacheApi>
  let mockReader: ReturnType<typeof createMockIcebergReader>

  beforeEach(() => {
    mockCache = createMockCacheApi()
    mockReader = createMockIcebergReader()
    vi.stubGlobal('caches', mockCache)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('honors ?max_age=N to override cache TTL', async () => {
    const request = createRequest('/$.content/app.do/Page/home.md?max_age=60')
    const ctx = createContext()
    const config = createTenantConfig()

    const response = await handleServe(request, ctx, {
      config,
      reader: mockReader as never,
    })

    const cacheControl = response.headers.get('Cache-Control')
    expect(cacheControl).toContain('max-age=60')
  })

  it('enforces minimum max_age even with query param', async () => {
    const request = createRequest('/$.content/app.do/Page/home.md?max_age=1')
    const ctx = createContext()
    const config = createTenantConfig({
      cache: { minMaxAge: 10 },
    })

    const response = await handleServe(request, ctx, {
      config,
      reader: mockReader as never,
    })

    const cacheControl = response.headers.get('Cache-Control')
    expect(cacheControl).toContain('max-age=10') // Clamped to minimum
  })

  it('bypasses cache with ?fresh=true', async () => {
    const request = createRequest('/$.content/app.do/Page/home.md?fresh=true')
    const ctx = createContext()
    const config = createTenantConfig()

    // Pre-populate cache
    const cachedResponse = new Response('# Cached', {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
      },
    })
    await mockCache.default.put(request.url.split('?')[0], cachedResponse)

    const response = await handleServe(request, ctx, {
      config,
      reader: mockReader as never,
    })

    // Should bypass cache and fetch fresh
    expect(mockReader.getRecord).toHaveBeenCalled()
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('respects allowFreshBypass=false in tenant config', async () => {
    const request = createRequest('/$.content/app.do/Page/home.md?fresh=true')
    const ctx = createContext()
    const config = createTenantConfig({
      cache: { allowFreshBypass: false },
    })

    // Pre-populate cache
    const cachedResponse = new Response('# Cached', {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
      },
    })
    await mockCache.default.put(request.url.split('?')[0], cachedResponse)

    const response = await handleServe(request, ctx, {
      config,
      reader: mockReader as never,
    })

    // Should ignore ?fresh=true and use cache
    expect(response.headers.get('X-Artifact-Source')).toBe('cache')
    expect(mockReader.getRecord).not.toHaveBeenCalled()
  })

  it('ignores invalid max_age values', async () => {
    const request = createRequest('/$.content/app.do/Page/home.md?max_age=invalid')
    const ctx = createContext()
    const config = createTenantConfig()

    const response = await handleServe(request, ctx, {
      config,
      reader: mockReader as never,
    })

    // Should use default max_age
    const cacheControl = response.headers.get('Cache-Control')
    expect(cacheControl).toContain('max-age=300')
  })

  it('handles negative max_age by using minimum', async () => {
    const request = createRequest('/$.content/app.do/Page/home.md?max_age=-10')
    const ctx = createContext()
    const config = createTenantConfig({
      cache: { minMaxAge: 10 },
    })

    const response = await handleServe(request, ctx, {
      config,
      reader: mockReader as never,
    })

    const cacheControl = response.headers.get('Cache-Control')
    expect(cacheControl).toContain('max-age=10')
  })
})

// ============================================================================
// 404 Handling Tests
// ============================================================================

describe('Artifact Serve - 404 Handling', () => {
  let mockReader: ReturnType<typeof createMockIcebergReader>

  beforeEach(() => {
    mockReader = createMockIcebergReader()
    vi.stubGlobal('caches', createMockCacheApi())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 404 for non-existent artifact', async () => {
    const request = createRequest('/$.content/app.do/Page/nonexistent.md')
    const ctx = createContext()
    const config = createTenantConfig()

    const response = await handleServe(request, ctx, {
      config,
      reader: mockReader as never,
    })

    expect(response.status).toBe(404)
  })

  it('returns JSON error body for 404', async () => {
    const request = createRequest('/$.content/app.do/Page/nonexistent.md')
    const ctx = createContext()
    const config = createTenantConfig()

    const response = await handleServe(request, ctx, {
      config,
      reader: mockReader as never,
    })

    const body = await response.json()
    expect(body).toHaveProperty('error')
    expect(body.error).toMatch(/not found/i)
  })

  it('includes correct Content-Type for 404 response', async () => {
    const request = createRequest('/$.content/app.do/Page/nonexistent.md')
    const ctx = createContext()
    const config = createTenantConfig()

    const response = await handleServe(request, ctx, {
      config,
      reader: mockReader as never,
    })

    expect(response.headers.get('Content-Type')).toBe('application/json')
  })

  it('does not cache 404 responses', async () => {
    const mockCache = createMockCacheApi()
    vi.stubGlobal('caches', mockCache)

    const request = createRequest('/$.content/app.do/Page/nonexistent.md')
    const ctx = createContext()
    const config = createTenantConfig()

    await handleServe(request, ctx, {
      config,
      reader: mockReader as never,
    })

    // Cache.put should not have been called for 404
    expect(mockCache.default.put).not.toHaveBeenCalled()
  })

  it('returns 400 for invalid path format', async () => {
    const request = createRequest('/$.content/invalid-path')
    const ctx = createContext()
    const config = createTenantConfig()

    const response = await handleServe(request, ctx, {
      config,
      reader: mockReader as never,
    })

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toMatch(/invalid.*path/i)
  })

  it('returns 404 when artifact exists but requested column is null', async () => {
    // Create mock where artifact exists but CSS column is null
    const mockReaderWithNullColumn = {
      getRecord: vi.fn(async () => ({
        ns: 'app.do',
        type: 'Page',
        id: 'no-css',
        markdown: '# Page without CSS',
        css: null, // No CSS for this artifact
      })),
    }

    const request = createRequest('/$.content/app.do/Page/no-css.css')
    const ctx = createContext()
    const config = createTenantConfig()

    const response = await handleServe(request, ctx, {
      config,
      reader: mockReaderWithNullColumn as never,
    })

    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body.error).toMatch(/not found|not available/i)
  })
})

// ============================================================================
// Tenant Configuration Tests
// ============================================================================

describe('Artifact Serve - Tenant Configuration', () => {
  let mockReader: ReturnType<typeof createMockIcebergReader>

  beforeEach(() => {
    mockReader = createMockIcebergReader()
    vi.stubGlobal('caches', createMockCacheApi())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses tenant-specific defaultMaxAge', async () => {
    const request = createRequest('/$.content/app.do/Page/home.md')
    const ctx = createContext()
    const config = createTenantConfig({
      cache: { defaultMaxAge: 600 },
    })

    const response = await handleServe(request, ctx, {
      config,
      reader: mockReader as never,
    })

    const cacheControl = response.headers.get('Cache-Control')
    expect(cacheControl).toContain('max-age=600')
  })

  it('uses tenant-specific stale-while-revalidate', async () => {
    const request = createRequest('/$.content/app.do/Page/home.md')
    const ctx = createContext()
    const config = createTenantConfig({
      cache: { defaultStaleWhileRevalidate: 120 },
    })

    const response = await handleServe(request, ctx, {
      config,
      reader: mockReader as never,
    })

    const cacheControl = response.headers.get('Cache-Control')
    expect(cacheControl).toContain('stale-while-revalidate=120')
  })

  it('enforces tenant-specific minMaxAge', async () => {
    const request = createRequest('/$.content/app.do/Page/home.md?max_age=5')
    const ctx = createContext()
    const config = createTenantConfig({
      cache: { minMaxAge: 30 },
    })

    const response = await handleServe(request, ctx, {
      config,
      reader: mockReader as never,
    })

    const cacheControl = response.headers.get('Cache-Control')
    expect(cacheControl).toContain('max-age=30') // Clamped to tenant minimum
  })

  it('loads tenant config from namespace in path', async () => {
    const request = createRequest('/$.content/custom.do/Page/home.md')
    const ctx = createContext()

    // Create reader with custom.do data
    const customReader = createMockIcebergReader({
      ...MOCK_ARTIFACTS,
      'custom.do/Page/home': {
        ns: 'custom.do',
        type: 'Page',
        id: 'home',
        markdown: '# Custom Home',
      },
    } as typeof MOCK_ARTIFACTS)

    // Mock config loader that returns different config per namespace
    const mockConfigLoader = vi.fn(async (ns: string) => {
      if (ns === 'custom.do') {
        return createTenantConfig({
          ns: 'custom.do',
          cache: { defaultMaxAge: 900 },
        })
      }
      return DEFAULT_TENANT_CONFIG
    })

    const response = await handleServe(request, ctx, {
      configLoader: mockConfigLoader,
      reader: customReader as never,
    })

    expect(mockConfigLoader).toHaveBeenCalledWith('custom.do')
    const cacheControl = response.headers.get('Cache-Control')
    expect(cacheControl).toContain('max-age=900')
  })
})

// ============================================================================
// Response Headers Tests
// ============================================================================

describe('Artifact Serve - Response Headers', () => {
  let mockReader: ReturnType<typeof createMockIcebergReader>

  beforeEach(() => {
    mockReader = createMockIcebergReader()
    vi.stubGlobal('caches', createMockCacheApi())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('includes ETag header based on content hash', async () => {
    const request = createRequest('/$.content/app.do/Page/home.md')
    const ctx = createContext()
    const config = createTenantConfig()

    const response = await handleServe(request, ctx, {
      config,
      reader: mockReader as never,
    })

    const etag = response.headers.get('ETag')
    expect(etag).toBeDefined()
    expect(etag).toMatch(/^"[a-f0-9]+"$/) // Quoted hex string
  })

  it('returns 304 Not Modified when ETag matches', async () => {
    // First request to get ETag
    const request1 = createRequest('/$.content/app.do/Page/home.md')
    const ctx1 = createContext()
    const config = createTenantConfig()

    const response1 = await handleServe(request1, ctx1, {
      config,
      reader: mockReader as never,
    })
    const etag = response1.headers.get('ETag')!

    // Second request with If-None-Match
    const request2 = createRequest('/$.content/app.do/Page/home.md', {
      headers: { 'If-None-Match': etag },
    })
    const ctx2 = createContext()

    const response2 = await handleServe(request2, ctx2, {
      config,
      reader: mockReader as never,
    })

    expect(response2.status).toBe(304)
    expect(response2.body).toBeNull()
  })

  it('includes X-Artifact-Source header', async () => {
    const request = createRequest('/$.content/app.do/Page/home.md')
    const ctx = createContext()
    const config = createTenantConfig()

    const response = await handleServe(request, ctx, {
      config,
      reader: mockReader as never,
    })

    const source = response.headers.get('X-Artifact-Source')
    expect(source).toMatch(/^(cache|parquet)$/)
  })

  it('includes Vary header for caching variations', async () => {
    const request = createRequest('/$.content/app.do/Page/home.md')
    const ctx = createContext()
    const config = createTenantConfig()

    const response = await handleServe(request, ctx, {
      config,
      reader: mockReader as never,
    })

    const vary = response.headers.get('Vary')
    expect(vary).toBeDefined()
    expect(vary).toContain('Accept-Encoding')
  })

  it('includes Content-Length header', async () => {
    const request = createRequest('/$.content/app.do/Page/home.md')
    const ctx = createContext()
    const config = createTenantConfig()

    const response = await handleServe(request, ctx, {
      config,
      reader: mockReader as never,
    })

    const contentLength = response.headers.get('Content-Length')
    expect(contentLength).toBeDefined()
    expect(parseInt(contentLength!)).toBeGreaterThan(0)
  })
})

// ============================================================================
// HTTP Method Tests
// ============================================================================

describe('Artifact Serve - HTTP Methods', () => {
  let mockReader: ReturnType<typeof createMockIcebergReader>

  beforeEach(() => {
    mockReader = createMockIcebergReader()
    vi.stubGlobal('caches', createMockCacheApi())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('handles GET request', async () => {
    const request = createRequest('/$.content/app.do/Page/home.md', { method: 'GET' })
    const ctx = createContext()
    const config = createTenantConfig()

    const response = await handleServe(request, ctx, {
      config,
      reader: mockReader as never,
    })

    expect(response.status).toBe(200)
  })

  it('handles HEAD request (no body)', async () => {
    const request = createRequest('/$.content/app.do/Page/home.md', { method: 'HEAD' })
    const ctx = createContext()
    const config = createTenantConfig()

    const response = await handleServe(request, ctx, {
      config,
      reader: mockReader as never,
    })

    expect(response.status).toBe(200)
    expect(response.body).toBeNull()
    // Headers should still be present
    expect(response.headers.get('Content-Type')).toBeDefined()
    expect(response.headers.get('Content-Length')).toBeDefined()
  })

  it('returns 405 Method Not Allowed for POST', async () => {
    const request = createRequest('/$.content/app.do/Page/home.md', { method: 'POST' })
    const ctx = createContext()
    const config = createTenantConfig()

    const response = await handleServe(request, ctx, {
      config,
      reader: mockReader as never,
    })

    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('GET, HEAD')
  })

  it('returns 405 Method Not Allowed for PUT', async () => {
    const request = createRequest('/$.content/app.do/Page/home.md', { method: 'PUT' })
    const ctx = createContext()
    const config = createTenantConfig()

    const response = await handleServe(request, ctx, {
      config,
      reader: mockReader as never,
    })

    expect(response.status).toBe(405)
  })

  it('returns 405 Method Not Allowed for DELETE', async () => {
    const request = createRequest('/$.content/app.do/Page/home.md', { method: 'DELETE' })
    const ctx = createContext()
    const config = createTenantConfig()

    const response = await handleServe(request, ctx, {
      config,
      reader: mockReader as never,
    })

    expect(response.status).toBe(405)
  })

  it('handles OPTIONS request for CORS preflight', async () => {
    const request = createRequest('/$.content/app.do/Page/home.md', { method: 'OPTIONS' })
    const ctx = createContext()
    const config = createTenantConfig()

    const response = await handleServe(request, ctx, {
      config,
      reader: mockReader as never,
    })

    expect(response.status).toBe(204)
    expect(response.headers.get('Allow')).toBe('GET, HEAD, OPTIONS')
  })
})

// ============================================================================
// JSON Content Tests (ASTs and Frontmatter)
// ============================================================================

describe('Artifact Serve - JSON Content', () => {
  let mockReader: ReturnType<typeof createMockIcebergReader>

  beforeEach(() => {
    mockReader = createMockIcebergReader()
    vi.stubGlobal('caches', createMockCacheApi())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('serves frontmatter as JSON', async () => {
    const request = createRequest('/$.content/app.do/Page/home.json')
    const ctx = createContext()
    const config = createTenantConfig()

    const response = await handleServe(request, ctx, {
      config,
      reader: mockReader as never,
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/json')

    const body = await response.json()
    expect(body).toEqual({ title: 'Home', description: 'Welcome page' })
  })

  it('serves mdast as JSON', async () => {
    const request = createRequest('/$.content/app.do/Page/home.mdast.json')
    const ctx = createContext()
    const config = createTenantConfig()

    const response = await handleServe(request, ctx, {
      config,
      reader: mockReader as never,
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/json')

    const body = await response.json()
    expect(body).toHaveProperty('type', 'root')
  })

  it('serves hast as JSON', async () => {
    const request = createRequest('/$.content/app.do/Page/home.hast.json')
    const ctx = createContext()
    const config = createTenantConfig()

    const response = await handleServe(request, ctx, {
      config,
      reader: mockReader as never,
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toHaveProperty('type', 'root')
  })

  it('serves estree as JSON', async () => {
    const request = createRequest('/$.content/app.do/Page/home.estree.json')
    const ctx = createContext()
    const config = createTenantConfig()

    const response = await handleServe(request, ctx, {
      config,
      reader: mockReader as never,
    })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toHaveProperty('type', 'Program')
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Artifact Serve - Error Handling', () => {
  let mockReader: ReturnType<typeof createMockIcebergReader>

  beforeEach(() => {
    mockReader = createMockIcebergReader()
    vi.stubGlobal('caches', createMockCacheApi())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('handles IcebergReader errors gracefully', async () => {
    const failingReader = {
      getRecord: vi.fn().mockRejectedValue(new Error('R2 connection failed')),
    }

    const request = createRequest('/$.content/app.do/Page/home.md')
    const ctx = createContext()
    const config = createTenantConfig()

    const response = await handleServe(request, ctx, {
      config,
      reader: failingReader as never,
    })

    expect(response.status).toBe(502) // Bad Gateway
    const body = await response.json()
    expect(body.error).toMatch(/storage|backend|unavailable/i)
  })

  it('handles Cache API errors gracefully', async () => {
    const failingCache = {
      default: {
        match: vi.fn().mockRejectedValue(new Error('Cache unavailable')),
        put: vi.fn(),
      },
    }
    vi.stubGlobal('caches', failingCache)

    const request = createRequest('/$.content/app.do/Page/home.md')
    const ctx = createContext()
    const config = createTenantConfig()

    // Should fall back to IcebergReader, not fail entirely
    const response = await handleServe(request, ctx, {
      config,
      reader: mockReader as never,
    })

    expect(response.status).toBe(200) // Should still work
    expect(mockReader.getRecord).toHaveBeenCalled()
  })

  it('handles config loader errors gracefully', async () => {
    const failingConfigLoader = vi.fn().mockRejectedValue(new Error('Config not found'))

    const request = createRequest('/$.content/app.do/Page/home.md')
    const ctx = createContext()

    const response = await handleServe(request, ctx, {
      configLoader: failingConfigLoader,
      reader: mockReader as never,
    })

    // Should use default config or return error
    expect([200, 500]).toContain(response.status)
  })

  it('returns 500 for unexpected errors', async () => {
    const errorReader = {
      getRecord: vi.fn(() => {
        throw new Error('Unexpected internal error')
      }),
    }

    const request = createRequest('/$.content/app.do/Page/home.md')
    const ctx = createContext()
    const config = createTenantConfig()

    const response = await handleServe(request, ctx, {
      config,
      reader: errorReader as never,
    })

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error).toBeDefined()
  })
})

// ============================================================================
// Edge Cases Tests
// ============================================================================

describe('Artifact Serve - Edge Cases', () => {
  let mockReader: ReturnType<typeof createMockIcebergReader>

  beforeEach(() => {
    mockReader = createMockIcebergReader()
    vi.stubGlobal('caches', createMockCacheApi())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('handles very long namespace paths', async () => {
    const longNs = 'a.b.c.d.e.f.g.h.i.j.k.l.m.n.o.p.q.r.s.t.u.v.w.x.y.z.do'
    const customReader = {
      getRecord: vi.fn(async () => ({
        ns: longNs,
        type: 'Page',
        id: 'test',
        markdown: '# Test',
      })),
    }

    const request = createRequest(`/$.content/${longNs}/Page/test.md`)
    const ctx = createContext()
    const config = createTenantConfig()

    const response = await handleServe(request, ctx, {
      config,
      reader: customReader as never,
    })

    expect(response.status).toBe(200)
  })

  it('handles Unicode characters in artifact id', async () => {
    const customReader = {
      getRecord: vi.fn(async () => ({
        ns: 'app.do',
        type: 'Page',
        id: 'cafe',
        markdown: '# Cafe',
      })),
    }

    const request = createRequest('/$.content/app.do/Page/cafe.md')
    const ctx = createContext()
    const config = createTenantConfig()

    const response = await handleServe(request, ctx, {
      config,
      reader: customReader as never,
    })

    expect(response.status).toBe(200)
  })

  it('handles empty content gracefully', async () => {
    const emptyReader = {
      getRecord: vi.fn(async () => ({
        ns: 'app.do',
        type: 'Page',
        id: 'empty',
        markdown: '', // Empty content
      })),
    }

    const request = createRequest('/$.content/app.do/Page/empty.md')
    const ctx = createContext()
    const config = createTenantConfig()

    const response = await handleServe(request, ctx, {
      config,
      reader: emptyReader as never,
    })

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
    expect(response.headers.get('Content-Length')).toBe('0')
  })

  it('handles very large content', async () => {
    const largeContent = '# Large\n\n' + 'Lorem ipsum. '.repeat(100000)
    const largeReader = {
      getRecord: vi.fn(async () => ({
        ns: 'app.do',
        type: 'Page',
        id: 'large',
        markdown: largeContent,
      })),
    }

    const request = createRequest('/$.content/app.do/Page/large.md')
    const ctx = createContext()
    const config = createTenantConfig()

    const response = await handleServe(request, ctx, {
      config,
      reader: largeReader as never,
    })

    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body.length).toBe(largeContent.length)
  })

  it('handles concurrent requests to same artifact', async () => {
    const request1 = createRequest('/$.content/app.do/Page/home.md')
    const request2 = createRequest('/$.content/app.do/Page/home.md')
    const ctx1 = createContext()
    const ctx2 = createContext()
    const config = createTenantConfig()

    const [response1, response2] = await Promise.all([
      handleServe(request1, ctx1, { config, reader: mockReader as never }),
      handleServe(request2, ctx2, { config, reader: mockReader as never }),
    ])

    expect(response1.status).toBe(200)
    expect(response2.status).toBe(200)
  })

  it('handles special characters in type name', async () => {
    const customReader = {
      getRecord: vi.fn(async () => ({
        ns: 'app.do',
        type: 'API-Endpoint',
        id: 'users',
        esm: 'export default {}',
      })),
    }

    const request = createRequest('/$.content/app.do/API-Endpoint/users.js')
    const ctx = createContext()
    const config = createTenantConfig()

    const response = await handleServe(request, ctx, {
      config,
      reader: customReader as never,
    })

    expect(response.status).toBe(200)
  })
})

// ============================================================================
// Performance Tests
// ============================================================================

describe('Artifact Serve - Performance', () => {
  let mockReader: ReturnType<typeof createMockIcebergReader>

  beforeEach(() => {
    mockReader = createMockIcebergReader()
    vi.stubGlobal('caches', createMockCacheApi())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('completes cached request in <5ms', async () => {
    const mockCache = createMockCacheApi()
    vi.stubGlobal('caches', mockCache)

    // Pre-populate cache
    const cachedResponse = new Response('# Cached', {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
        'X-Artifact-Source': 'cache',
      },
    })
    await mockCache.default.put(
      'https://artifacts.dotdo.dev/$.content/app.do/Page/home.md',
      cachedResponse
    )

    const request = createRequest('/$.content/app.do/Page/home.md')
    const ctx = createContext()
    const config = createTenantConfig()

    const start = performance.now()
    await handleServe(request, ctx, {
      config,
      reader: mockReader as never,
    })
    const duration = performance.now() - start

    expect(duration).toBeLessThan(5) // <5ms for cache hit
  })

  it('parsePath completes in <1ms', () => {
    const url = new URL('https://artifacts.dotdo.dev/$.content/app.do/Page/home.md')

    const start = performance.now()
    for (let i = 0; i < 1000; i++) {
      parsePath(url)
    }
    const duration = performance.now() - start

    expect(duration / 1000).toBeLessThan(1) // Average <1ms per call
  })

  it('getColumnForExtension completes in <0.1ms', () => {
    const extensions = ['md', 'html', 'js', 'd.ts', 'css', 'json']

    const start = performance.now()
    for (let i = 0; i < 10000; i++) {
      getColumnForExtension(extensions[i % extensions.length])
    }
    const duration = performance.now() - start

    expect(duration / 10000).toBeLessThan(0.1) // Average <0.1ms per call
  })
})
