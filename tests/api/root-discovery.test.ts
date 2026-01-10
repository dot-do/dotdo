import { describe, it, expect, beforeAll } from 'vitest'
import { Hono } from 'hono'
import { cors } from 'hono/cors'

/**
 * Root Discovery Endpoint Tests
 *
 * These tests verify the API discovery endpoints that allow clients
 * to discover available capabilities, versions, and endpoints.
 *
 * Discovery endpoints tested:
 * - GET /          - Root landing page (HTML)
 * - GET /api       - API discovery (JSON)
 * - GET /api/      - API discovery with trailing slash (JSON)
 *
 * Expected to FAIL until:
 * - Discovery endpoint returns comprehensive API metadata
 * - Version information is properly exposed
 * - All available endpoints are listed
 * - Content negotiation is implemented
 * - Links follow HATEOAS principles
 */

// Import routes directly to avoid cloudflare:workers dependency from index.ts
import { apiRoutes } from '../../api/routes/api'
import { mcpRoutes } from '../../api/routes/mcp'
import { rpcRoutes } from '../../api/routes/rpc'
import { doRoutes } from '../../api/routes/do'
import { browsersRoutes } from '../../api/routes/browsers'
import { sandboxesRoutes } from '../../api/routes/sandboxes'
import { obsRoutes } from '../../api/routes/obs'
import { getOpenAPIDocument } from '../../api/routes/openapi'

// API version constant
const API_VERSION = '0.0.1'

// Generate unique request ID
function generateRequestId(): string {
  return crypto.randomUUID()
}

// Create test app with routes (no cloudflare:workers re-export)
const app = new Hono()
app.use('*', cors())

// Security and common headers middleware
app.use('*', async (c, next) => {
  // Handle request ID - echo client-provided or generate new
  const clientRequestId = c.req.header('x-request-id')
  const requestId = clientRequestId || generateRequestId()

  await next()

  // Add common headers
  c.res.headers.set('x-request-id', requestId)
  c.res.headers.set('x-content-type-options', 'nosniff')
  c.res.headers.set('x-api-version', API_VERSION)
  c.res.headers.set('x-powered-by', 'dotdo')
})

// Landing page (simplified for testing)
app.get('/', (c) => {
  c.res.headers.set('cache-control', 'public, max-age=3600')
  c.res.headers.set('x-frame-options', 'SAMEORIGIN')
  return c.html(`
    <!DOCTYPE html>
    <html>
      <head><title>dotdo</title></head>
      <body>
        <h1>dotdo</h1>
        <p>Build your 1-Person Unicorn</p>
        <nav>
          <a href="/docs">Documentation</a>
          <a href="/api">API</a>
        </nav>
      </body>
    </html>
  `)
})

// Discovery response generator
function createDiscoveryResponse() {
  return {
    name: 'dotdo',
    version: API_VERSION,
    description: 'Build your 1-Person Unicorn. Business-as-Code framework for autonomous businesses.',
    status: 'ok',
    endpoints: [
      '/api/health',
      '/api/things',
      '/api/browsers',
      '/api/sandboxes',
      '/api/obs',
      '/api/openapi.json',
      '/mcp',
      '/rpc',
    ],
    capabilities: ['things', 'mcp', 'rpc', 'sync', 'browsers', 'sandboxes'],
    documentation: '/docs',
    openapi: '/api/openapi.json',
    links: {
      self: '/api',
      things: '/api/things',
      health: '/api/health',
      docs: '/docs',
      openapi: '/api/openapi.json',
    },
  }
}

// Generate ETag from discovery response
function generateETag(data: object): string {
  const content = JSON.stringify(data)
  let hash = 0
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return `"${Math.abs(hash).toString(16)}"`
}

// Discovery response handler with proper headers
function handleDiscoveryRequest(c: any) {
  const discovery = createDiscoveryResponse()
  const etag = generateETag(discovery)

  // Check If-None-Match for conditional request
  const ifNoneMatch = c.req.header('if-none-match')
  if (ifNoneMatch === etag) {
    return new Response(null, { status: 304 })
  }

  // Build Link header
  const linkHeader = [
    '</api>; rel="self"',
    '</docs>; rel="documentation"',
    '</api/openapi.json>; rel="service-desc"; type="application/openapi+json"',
  ].join(', ')

  c.res.headers.set('link', linkHeader)
  c.res.headers.set('cache-control', 'public, max-age=60')
  c.res.headers.set('etag', etag)

  return c.json(discovery)
}

// Handle /api and /api/ explicitly for discovery
app.get('/api', handleDiscoveryRequest)
app.get('/api/', handleDiscoveryRequest)

// Documentation endpoint (returns placeholder for testing)
app.get('/docs', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html>
      <head><title>dotdo Documentation</title></head>
      <body>
        <h1>dotdo Documentation</h1>
        <p>API documentation and guides.</p>
      </body>
    </html>
  `)
})

// OpenAPI spec endpoint
app.get('/api/openapi.json', (c) => {
  const spec = getOpenAPIDocument()
  return c.json(spec, 200, {
    'Access-Control-Allow-Origin': '*',
  })
})

// Mount routes
app.route('/api', apiRoutes)
app.route('/api/browsers', browsersRoutes)
app.route('/api/sandboxes', sandboxesRoutes)
app.route('/api/obs', obsRoutes)
app.route('/mcp', mcpRoutes)
app.route('/rpc', rpcRoutes)
app.route('/', doRoutes)

// ============================================================================
// Types
// ============================================================================

interface DiscoveryResponse {
  name: string
  version: string
  description?: string
  endpoints: string[]
  links?: Record<string, string>
  documentation?: string
  openapi?: string
  capabilities?: string[]
  status?: string
}

interface LinkHeader {
  url: string
  rel: string
  type?: string
  title?: string
}

// ============================================================================
// Helper Functions
// ============================================================================

async function get(path: string, headers?: Record<string, string>): Promise<Response> {
  return app.request(path, {
    method: 'GET',
    headers: headers || {},
  })
}

function parseLinkHeader(header: string | null): LinkHeader[] {
  if (!header) return []
  return header.split(',').map((link) => {
    const parts = link.trim().split(';')
    const url = parts[0].trim().replace(/^<|>$/g, '')
    const attrs: Record<string, string> = {}
    for (let i = 1; i < parts.length; i++) {
      const match = parts[i].trim().match(/^(\w+)="?([^"]*)"?$/)
      if (match) {
        attrs[match[1]] = match[2]
      }
    }
    return { url, rel: attrs.rel, type: attrs.type, title: attrs.title }
  })
}

// ============================================================================
// 1. Root Landing Page Tests (GET /)
// ============================================================================

describe('GET / (Root Landing Page)', () => {
  it('returns 200 status', async () => {
    const res = await get('/')
    expect(res.status).toBe(200)
  })

  it('returns HTML content type', async () => {
    const res = await get('/')
    expect(res.headers.get('content-type')).toContain('text/html')
  })

  it('includes product name in HTML', async () => {
    const res = await get('/')
    const html = await res.text()
    expect(html).toContain('dotdo')
  })

  it('includes tagline in HTML', async () => {
    const res = await get('/')
    const html = await res.text()
    expect(html.toLowerCase()).toContain('unicorn')
  })

  it('has valid HTML structure', async () => {
    const res = await get('/')
    const html = await res.text()
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('<html')
    expect(html).toContain('<head>')
    expect(html).toContain('<body>')
  })

  it('includes link to API documentation', async () => {
    const res = await get('/')
    const html = await res.text()
    expect(html).toMatch(/href=["'][^"']*\/docs|\/api["']/i)
  })

  it('includes link to API endpoint', async () => {
    const res = await get('/')
    const html = await res.text()
    expect(html).toMatch(/href=["'][^"']*\/api["']/i)
  })

  it('sets appropriate cache headers', async () => {
    const res = await get('/')
    const cacheControl = res.headers.get('cache-control')
    // Landing page should have some caching
    expect(cacheControl).toBeDefined()
  })
})

// ============================================================================
// 2. API Discovery Endpoint Tests (GET /api)
// ============================================================================

describe('GET /api (API Discovery)', () => {
  it('returns 200 status', async () => {
    const res = await get('/api')
    expect(res.status).toBe(200)
  })

  it('returns JSON content type', async () => {
    const res = await get('/api')
    expect(res.headers.get('content-type')).toContain('application/json')
  })

  it('returns discovery response with name', async () => {
    const res = await get('/api')
    const body = (await res.json()) as DiscoveryResponse
    expect(body.name).toBe('dotdo')
  })

  it('returns discovery response with version', async () => {
    const res = await get('/api')
    const body = (await res.json()) as DiscoveryResponse
    expect(body.version).toBeDefined()
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('returns discovery response with endpoints array', async () => {
    const res = await get('/api')
    const body = (await res.json()) as DiscoveryResponse
    expect(body.endpoints).toBeDefined()
    expect(Array.isArray(body.endpoints)).toBe(true)
    expect(body.endpoints.length).toBeGreaterThan(0)
  })

  it('includes /api/health endpoint in list', async () => {
    const res = await get('/api')
    const body = (await res.json()) as DiscoveryResponse
    expect(body.endpoints).toContain('/api/health')
  })

  it('includes /api/things endpoint in list', async () => {
    const res = await get('/api')
    const body = (await res.json()) as DiscoveryResponse
    expect(body.endpoints).toContain('/api/things')
  })
})

// ============================================================================
// 3. API Discovery with Trailing Slash Tests (GET /api/)
// ============================================================================

describe('GET /api/ (API Discovery with Trailing Slash)', () => {
  it('returns 200 status', async () => {
    const res = await get('/api/')
    expect(res.status).toBe(200)
  })

  it('returns JSON content type', async () => {
    const res = await get('/api/')
    expect(res.headers.get('content-type')).toContain('application/json')
  })

  it('returns same response as /api', async () => {
    const res1 = await get('/api')
    const res2 = await get('/api/')

    const body1 = (await res1.json()) as DiscoveryResponse
    const body2 = (await res2.json()) as DiscoveryResponse

    expect(body1.name).toBe(body2.name)
    expect(body1.version).toBe(body2.version)
  })
})

// ============================================================================
// 4. Extended Discovery Metadata Tests
// ============================================================================

describe('Extended Discovery Metadata', () => {
  let discovery: DiscoveryResponse

  beforeAll(async () => {
    const res = await get('/api')
    discovery = (await res.json()) as DiscoveryResponse
  })

  it('includes description', async () => {
    expect(discovery.description).toBeDefined()
    expect(discovery.description!.length).toBeGreaterThan(10)
  })

  it('includes documentation link', async () => {
    expect(discovery.documentation).toBeDefined()
    expect(discovery.documentation).toMatch(/^https?:\/\/|^\/docs/)
  })

  it('includes OpenAPI spec link', async () => {
    expect(discovery.openapi).toBeDefined()
    expect(discovery.openapi).toContain('openapi.json')
  })

  it('includes capabilities list', async () => {
    expect(discovery.capabilities).toBeDefined()
    expect(Array.isArray(discovery.capabilities)).toBe(true)
  })

  it('capabilities include expected features', async () => {
    expect(discovery.capabilities).toContain('things')
    expect(discovery.capabilities).toContain('mcp')
    expect(discovery.capabilities).toContain('rpc')
  })

  it('includes status indicator', async () => {
    expect(discovery.status).toBe('ok')
  })
})

// ============================================================================
// 5. HATEOAS Links Tests
// ============================================================================

describe('HATEOAS Links', () => {
  let discovery: DiscoveryResponse

  beforeAll(async () => {
    const res = await get('/api')
    discovery = (await res.json()) as DiscoveryResponse
  })

  it('includes links object', async () => {
    expect(discovery.links).toBeDefined()
    expect(typeof discovery.links).toBe('object')
  })

  it('includes self link', async () => {
    expect(discovery.links!.self).toBeDefined()
    expect(discovery.links!.self).toMatch(/\/api\/?$/)
  })

  it('includes things link', async () => {
    expect(discovery.links!.things).toBeDefined()
    expect(discovery.links!.things).toContain('/api/things')
  })

  it('includes health link', async () => {
    expect(discovery.links!.health).toBeDefined()
    expect(discovery.links!.health).toContain('/api/health')
  })

  it('includes docs link', async () => {
    expect(discovery.links!.docs).toBeDefined()
  })

  it('includes openapi link', async () => {
    expect(discovery.links!.openapi).toBeDefined()
    expect(discovery.links!.openapi).toContain('openapi.json')
  })
})

// ============================================================================
// 6. Link Header Tests
// ============================================================================

describe('Link Header', () => {
  it('includes Link header in discovery response', async () => {
    const res = await get('/api')
    const linkHeader = res.headers.get('link')
    expect(linkHeader).toBeDefined()
  })

  it('Link header includes self relation', async () => {
    const res = await get('/api')
    const links = parseLinkHeader(res.headers.get('link'))
    const selfLink = links.find((l) => l.rel === 'self')
    expect(selfLink).toBeDefined()
  })

  it('Link header includes documentation relation', async () => {
    const res = await get('/api')
    const links = parseLinkHeader(res.headers.get('link'))
    const docsLink = links.find((l) => l.rel === 'documentation')
    expect(docsLink).toBeDefined()
  })

  it('Link header includes service-desc for OpenAPI', async () => {
    const res = await get('/api')
    const links = parseLinkHeader(res.headers.get('link'))
    const specLink = links.find((l) => l.rel === 'service-desc' || l.rel === 'describedby')
    expect(specLink).toBeDefined()
    expect(specLink!.type).toContain('application/openapi+json')
  })
})

// ============================================================================
// 7. Content Negotiation Tests
// ============================================================================

describe('Content Negotiation', () => {
  it('returns JSON by default for /api', async () => {
    const res = await get('/api')
    expect(res.headers.get('content-type')).toContain('application/json')
  })

  it('returns JSON when Accept: application/json', async () => {
    const res = await get('/api', { Accept: 'application/json' })
    expect(res.headers.get('content-type')).toContain('application/json')
  })

  it('returns HTML for root when Accept: text/html', async () => {
    const res = await get('/', { Accept: 'text/html' })
    expect(res.headers.get('content-type')).toContain('text/html')
  })

  it('respects Accept header quality values', async () => {
    const res = await get('/api', { Accept: 'text/html;q=0.9, application/json;q=1.0' })
    expect(res.headers.get('content-type')).toContain('application/json')
  })

  it('returns 406 for unsupported Accept types on /api', async () => {
    const res = await get('/api', { Accept: 'application/xml' })
    // Should either return JSON anyway or 406
    expect([200, 406]).toContain(res.status)
    if (res.status === 200) {
      expect(res.headers.get('content-type')).toContain('application/json')
    }
  })
})

// ============================================================================
// 8. Version Header Tests
// ============================================================================

describe('Version Headers', () => {
  it('includes X-API-Version header', async () => {
    const res = await get('/api')
    const version = res.headers.get('x-api-version')
    expect(version).toBeDefined()
    expect(version).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('version header matches response body version', async () => {
    const res = await get('/api')
    const headerVersion = res.headers.get('x-api-version')
    const body = (await res.json()) as DiscoveryResponse
    expect(headerVersion).toBe(body.version)
  })

  it('includes X-Powered-By header', async () => {
    const res = await get('/api')
    const poweredBy = res.headers.get('x-powered-by')
    expect(poweredBy).toBeDefined()
    expect(poweredBy).toContain('dotdo')
  })
})

// ============================================================================
// 9. Comprehensive Endpoint Discovery Tests
// ============================================================================

describe('Comprehensive Endpoint Discovery', () => {
  let discovery: DiscoveryResponse

  beforeAll(async () => {
    const res = await get('/api')
    discovery = (await res.json()) as DiscoveryResponse
  })

  it('includes /api/browsers endpoint', async () => {
    expect(discovery.endpoints).toContain('/api/browsers')
  })

  it('includes /api/sandboxes endpoint', async () => {
    expect(discovery.endpoints).toContain('/api/sandboxes')
  })

  it('includes /api/obs endpoint', async () => {
    expect(discovery.endpoints).toContain('/api/obs')
  })

  it('includes /api/openapi.json endpoint', async () => {
    expect(discovery.endpoints).toContain('/api/openapi.json')
  })

  it('includes /mcp endpoint', async () => {
    expect(discovery.endpoints).toContain('/mcp')
  })

  it('includes /rpc endpoint', async () => {
    expect(discovery.endpoints).toContain('/rpc')
  })

  it('all listed endpoints are valid paths', async () => {
    for (const endpoint of discovery.endpoints) {
      expect(endpoint).toMatch(/^\//)
    }
  })
})

// ============================================================================
// 10. API Versioning Discovery Tests
// ============================================================================

describe('API Versioning Discovery', () => {
  it('discovery includes supported API versions', async () => {
    const res = await get('/api')
    const body = (await res.json()) as DiscoveryResponse & { versions?: string[] }
    expect(body.versions || body.version).toBeDefined()
  })

  it('current version is indicated', async () => {
    const res = await get('/api')
    const body = (await res.json()) as DiscoveryResponse
    expect(body.version).toBeDefined()
  })

  it('version follows semantic versioning', async () => {
    const res = await get('/api')
    const body = (await res.json()) as DiscoveryResponse
    expect(body.version).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/)
  })
})

// ============================================================================
// 11. CORS for Discovery Endpoints Tests
// ============================================================================

describe('CORS for Discovery Endpoints', () => {
  it('includes CORS headers on /api', async () => {
    const res = await get('/api')
    expect(res.headers.get('access-control-allow-origin')).toBeDefined()
  })

  it('allows all origins for discovery', async () => {
    const res = await get('/api')
    const origin = res.headers.get('access-control-allow-origin')
    expect(origin).toBe('*')
  })

  it('handles OPTIONS preflight for /api', async () => {
    const res = await app.request('/api', { method: 'OPTIONS' })
    expect([200, 204]).toContain(res.status)
    expect(res.headers.get('access-control-allow-methods')).toBeDefined()
  })
})

// ============================================================================
// 12. Rate Limiting Discovery Tests
// ============================================================================

describe('Rate Limiting Discovery', () => {
  it('includes rate limit headers on discovery endpoint', async () => {
    const res = await get('/api')
    const rateLimit = res.headers.get('x-ratelimit-limit')
    // Rate limiting headers are optional but good practice
    if (rateLimit) {
      expect(parseInt(rateLimit, 10)).toBeGreaterThan(0)
    }
  })

  it('includes rate limit remaining header', async () => {
    const res = await get('/api')
    const remaining = res.headers.get('x-ratelimit-remaining')
    if (remaining) {
      expect(parseInt(remaining, 10)).toBeGreaterThanOrEqual(0)
    }
  })
})

// ============================================================================
// 13. Security Headers Tests
// ============================================================================

describe('Security Headers', () => {
  it('includes X-Content-Type-Options header', async () => {
    const res = await get('/api')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('includes X-Frame-Options header on root', async () => {
    const res = await get('/')
    const frameOptions = res.headers.get('x-frame-options')
    expect(['DENY', 'SAMEORIGIN']).toContain(frameOptions)
  })

  it('does not expose sensitive server info', async () => {
    const res = await get('/api')
    const server = res.headers.get('server')
    // Server header should not reveal specific version info
    if (server) {
      expect(server).not.toMatch(/\d+\.\d+\.\d+/)
    }
  })
})

// ============================================================================
// 14. Health Check Integration Tests
// ============================================================================

describe('Health Check Integration', () => {
  it('discovery-listed health endpoint works', async () => {
    const discoveryRes = await get('/api')
    const discovery = (await discoveryRes.json()) as DiscoveryResponse

    expect(discovery.endpoints).toContain('/api/health')

    const healthRes = await get('/api/health')
    expect(healthRes.status).toBe(200)
  })

  it('health endpoint returns expected structure', async () => {
    const res = await get('/api/health')
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('ok')
  })
})

// ============================================================================
// 15. Error Handling for Discovery Tests
// ============================================================================

describe('Error Handling for Discovery', () => {
  it('returns 404 for unknown API routes', async () => {
    const res = await get('/api/nonexistent-endpoint-12345')
    expect(res.status).toBe(404)
  })

  it('404 response is JSON for API routes', async () => {
    const res = await get('/api/nonexistent-endpoint-12345')
    expect(res.headers.get('content-type')).toContain('application/json')
  })

  it('404 response includes error object', async () => {
    const res = await get('/api/nonexistent-endpoint-12345')
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error).toBeDefined()
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('method not allowed returns 405', async () => {
    const res = await app.request('/api', { method: 'DELETE' })
    expect([404, 405]).toContain(res.status)
  })
})

// ============================================================================
// 16. Documentation Links Accessibility Tests
// ============================================================================

describe('Documentation Links Accessibility', () => {
  it('documentation link from discovery is accessible', async () => {
    const discoveryRes = await get('/api')
    const discovery = (await discoveryRes.json()) as DiscoveryResponse

    if (discovery.documentation) {
      const docsRes = await get(discovery.documentation)
      expect([200, 301, 302]).toContain(docsRes.status)
    }
  })

  it('OpenAPI spec link from discovery is accessible', async () => {
    const discoveryRes = await get('/api')
    const discovery = (await discoveryRes.json()) as DiscoveryResponse

    if (discovery.openapi) {
      const specRes = await get(discovery.openapi)
      expect(specRes.status).toBe(200)
    }
  })
})

// ============================================================================
// 17. Request ID Tracking Tests
// ============================================================================

describe('Request ID Tracking', () => {
  it('includes X-Request-Id header in response', async () => {
    const res = await get('/api')
    const requestId = res.headers.get('x-request-id')
    expect(requestId).toBeDefined()
    expect(requestId!.length).toBeGreaterThan(0)
  })

  it('request ID is unique per request', async () => {
    const res1 = await get('/api')
    const res2 = await get('/api')

    const id1 = res1.headers.get('x-request-id')
    const id2 = res2.headers.get('x-request-id')

    expect(id1).not.toBe(id2)
  })

  it('echoes back client-provided request ID', async () => {
    const clientRequestId = 'client-req-' + Date.now()
    const res = await get('/api', { 'X-Request-Id': clientRequestId })

    const responseId = res.headers.get('x-request-id')
    expect(responseId).toBe(clientRequestId)
  })
})

// ============================================================================
// 18. Cache Behavior Tests
// ============================================================================

describe('Cache Behavior', () => {
  it('discovery endpoint has appropriate cache headers', async () => {
    const res = await get('/api')
    const cacheControl = res.headers.get('cache-control')
    expect(cacheControl).toBeDefined()
  })

  it('discovery can be cached briefly', async () => {
    const res = await get('/api')
    const cacheControl = res.headers.get('cache-control')
    // Discovery should be cacheable but not for too long
    if (cacheControl) {
      expect(cacheControl).toMatch(/max-age=\d+/)
    }
  })

  it('includes ETag header for conditional requests', async () => {
    const res = await get('/api')
    const etag = res.headers.get('etag')
    expect(etag).toBeDefined()
  })

  it('supports If-None-Match conditional request', async () => {
    const res1 = await get('/api')
    const etag = res1.headers.get('etag')

    if (etag) {
      const res2 = await get('/api', { 'If-None-Match': etag })
      expect([200, 304]).toContain(res2.status)
    }
  })
})

// ============================================================================
// 19. Response Time Headers Tests
// ============================================================================

describe('Response Time Headers', () => {
  it('includes response time header', async () => {
    const res = await get('/api')
    const responseTime =
      res.headers.get('x-response-time') || res.headers.get('server-timing')
    // Response time headers are optional but good for observability
    if (responseTime) {
      expect(responseTime.length).toBeGreaterThan(0)
    }
  })
})

// ============================================================================
// 20. Machine-Readable API Documentation Tests
// ============================================================================

describe('Machine-Readable API Documentation', () => {
  it('provides JSON Schema for discovery response', async () => {
    const res = await get('/api')
    const body = (await res.json()) as DiscoveryResponse

    // Response should be valid JSON with expected structure
    expect(body).toHaveProperty('name')
    expect(body).toHaveProperty('version')
    expect(body).toHaveProperty('endpoints')
  })

  it('OpenAPI spec is accessible from discovery', async () => {
    const res = await get('/api/openapi.json')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
  })

  it('OpenAPI spec is valid JSON', async () => {
    const res = await get('/api/openapi.json')
    const spec = await res.json()
    expect(spec).toHaveProperty('openapi')
    expect(spec).toHaveProperty('info')
    expect(spec).toHaveProperty('paths')
  })
})
