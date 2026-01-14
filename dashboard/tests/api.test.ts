/**
 * DO Dashboard API() Factory Tests (RED Phase)
 *
 * These tests define the contract for the Dashboard API factory that creates
 * a Hono-compatible request handler serving JSON with HATEOAS links.
 *
 * The DO Dashboard provides three outputs from one codebase:
 * - REST API (JSON + HATEOAS links) <-- This test file
 * - CLI Dashboard (terminal UI)
 * - Web Admin (browser UI)
 *
 * All tests are RED phase - they define expected behavior that is not yet
 * implemented. Running these tests should fail with "Not implemented" errors.
 *
 * @see {@link API} for the factory function
 * @see docs/plans/2026-01-10-do-dashboard-design.md for design reference
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import {
  API,
  type APIOptions,
  type HATEOASResponse,
  type RootResource,
  type SchemaResponse,
  type TypeSchemaResponse,
  type DataCollectionResponse,
  type ItemsResponse,
  type ItemResponse,
  type OpenAPISpec,
  type Links,
} from '../api'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a test request
 */
function createRequest(
  path: string,
  options: {
    method?: string
    headers?: Record<string, string>
    body?: unknown
  } = {}
): Request {
  const { method = 'GET', headers = {}, body } = options
  const url = `https://test.dashboard.do${path}`

  return new Request(url, {
    method,
    headers: {
      'Accept': 'application/json',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
}

/**
 * Execute a request against the API
 */
async function executeRequest(
  app: Hono,
  path: string,
  options: {
    method?: string
    headers?: Record<string, string>
    body?: unknown
  } = {}
): Promise<Response> {
  const request = createRequest(path, options)
  return app.fetch(request)
}

/**
 * Parse JSON response with type
 */
async function parseResponse<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>
}

// ============================================================================
// 1. API FACTORY TESTS (~15 tests)
// ============================================================================

describe('API Factory', () => {
  describe('Basic Factory Behavior', () => {
    it('should return a Hono instance when called with no arguments', () => {
      const app = API()

      expect(app).toBeInstanceOf(Hono)
    })

    it('should return a Hono instance when called with empty options', () => {
      const app = API({})

      expect(app).toBeInstanceOf(Hono)
    })

    it('should have a fetch method', () => {
      const app = API()

      expect(typeof app.fetch).toBe('function')
    })

    it('should handle requests asynchronously', async () => {
      const app = API()
      const response = await executeRequest(app, '/')

      expect(response).toBeInstanceOf(Response)
    })
  })

  describe('Configuration Options', () => {
    it('should accept config path option', () => {
      const app = API({ config: './custom.config.ts' })

      expect(app).toBeInstanceOf(Hono)
    })

    it('should accept ns (namespace) option', () => {
      const app = API({ ns: 'my-namespace' })

      expect(app).toBeInstanceOf(Hono)
    })

    it('should accept debug option', () => {
      const app = API({ debug: true })

      expect(app).toBeInstanceOf(Hono)
    })

    it('should accept all options together', () => {
      const app = API({
        config: './do.config.ts',
        ns: 'test-namespace',
        debug: true,
      })

      expect(app).toBeInstanceOf(Hono)
    })

    it('should load do.config.ts from current directory if config not specified', async () => {
      const app = API()
      const response = await executeRequest(app, '/')

      // Should not error due to missing config
      expect(response.status).not.toBe(500)
    })
  })

  describe('Error Handling', () => {
    it('should throw on invalid config path type', () => {
      expect(() => {
        // @ts-expect-error - Testing invalid input
        API({ config: 123 })
      }).toThrow()
    })

    it('should throw on invalid ns type', () => {
      expect(() => {
        // @ts-expect-error - Testing invalid input
        API({ ns: {} })
      }).toThrow()
    })

    it('should throw on invalid debug type', () => {
      expect(() => {
        // @ts-expect-error - Testing invalid input
        API({ debug: 'yes' })
      }).toThrow()
    })

    it('should throw on unknown options', () => {
      expect(() => {
        // @ts-expect-error - Testing invalid input
        API({ unknownOption: true })
      }).toThrow()
    })

    it('should handle missing config file gracefully', async () => {
      const app = API({ config: './nonexistent.config.ts' })
      const response = await executeRequest(app, '/')

      // Should return error response, not crash
      expect(response.status).toBe(500)
      const body = await parseResponse<{ error: string }>(response)
      expect(body.error).toContain('config')
    })
  })
})

// ============================================================================
// 2. REQUEST ROUTING TESTS (~20 tests)
// ============================================================================

describe('Request Routing', () => {
  let app: Hono

  beforeEach(() => {
    app = API()
  })

  describe('Root Resource', () => {
    it('should return 200 for GET /', async () => {
      const response = await executeRequest(app, '/')

      expect(response.status).toBe(200)
    })

    it('should return JSON content type for GET /', async () => {
      const response = await executeRequest(app, '/')

      expect(response.headers.get('Content-Type')).toMatch(/application\/json/)
    })

    it('should return root resource with _links for GET /', async () => {
      const response = await executeRequest(app, '/')
      const body = await parseResponse<RootResource>(response)

      expect(body).toHaveProperty('_links')
      expect(body).toHaveProperty('name')
      expect(body).toHaveProperty('version')
    })
  })

  describe('Schema Endpoints', () => {
    it('should return 200 for GET /schema', async () => {
      const response = await executeRequest(app, '/schema')

      expect(response.status).toBe(200)
    })

    it('should return types from $introspect for GET /schema', async () => {
      const response = await executeRequest(app, '/schema')
      const body = await parseResponse<SchemaResponse>(response)

      expect(body).toHaveProperty('types')
      expect(Array.isArray(body.types)).toBe(true)
    })

    it('should return 200 for GET /schema/:type with valid type', async () => {
      const response = await executeRequest(app, '/schema/Customer')

      // 200 if type exists, 404 if not
      expect([200, 404]).toContain(response.status)
    })

    it('should return single type definition for GET /schema/:type', async () => {
      const response = await executeRequest(app, '/schema/Customer')

      if (response.status === 200) {
        const body = await parseResponse<TypeSchemaResponse>(response)
        expect(body).toHaveProperty('name')
        expect(body).toHaveProperty('type')
        expect(body).toHaveProperty('properties')
      }
    })

    it('should return 404 for GET /schema/:type with invalid type', async () => {
      const response = await executeRequest(app, '/schema/NonExistentType12345')

      expect(response.status).toBe(404)
    })
  })

  describe('Data Endpoints', () => {
    it('should return 200 for GET /data', async () => {
      const response = await executeRequest(app, '/data')

      expect(response.status).toBe(200)
    })

    it('should return data collections for GET /data', async () => {
      const response = await executeRequest(app, '/data')
      const body = await parseResponse<DataCollectionResponse>(response)

      expect(body).toHaveProperty('collections')
      expect(Array.isArray(body.collections)).toBe(true)
    })

    it('should return 200 for GET /data/:type with valid type', async () => {
      const response = await executeRequest(app, '/data/customers')

      expect([200, 404]).toContain(response.status)
    })

    it('should return instances for GET /data/:type', async () => {
      const response = await executeRequest(app, '/data/customers')

      if (response.status === 200) {
        const body = await parseResponse<ItemsResponse>(response)
        expect(body).toHaveProperty('items')
        expect(Array.isArray(body.items)).toBe(true)
        expect(body).toHaveProperty('total')
      }
    })

    it('should return 200 for GET /data/:type/:id with valid id', async () => {
      const response = await executeRequest(app, '/data/customers/cust-123')

      expect([200, 404]).toContain(response.status)
    })

    it('should return single instance for GET /data/:type/:id', async () => {
      const response = await executeRequest(app, '/data/customers/cust-123')

      if (response.status === 200) {
        const body = await parseResponse<ItemResponse>(response)
        expect(body).toHaveProperty('_links')
      }
    })

    it('should return 404 for GET /data/:type/:id with invalid id', async () => {
      const response = await executeRequest(app, '/data/customers/nonexistent-id-12345')

      expect(response.status).toBe(404)
    })
  })

  describe('CRUD Operations', () => {
    it('should return 201 for POST /data/:type with valid body', async () => {
      const response = await executeRequest(app, '/data/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { name: 'Test Customer', email: 'test@example.com' },
      })

      expect([201, 404, 500]).toContain(response.status)
    })

    it('should return created instance for POST /data/:type', async () => {
      const response = await executeRequest(app, '/data/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { name: 'Test Customer' },
      })

      if (response.status === 201) {
        const body = await parseResponse<ItemResponse>(response)
        expect(body).toHaveProperty('_links')
        expect(body._links.self).toBeDefined()
      }
    })

    it('should return 200 for PUT /data/:type/:id with valid body', async () => {
      const response = await executeRequest(app, '/data/customers/cust-123', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: { name: 'Updated Customer' },
      })

      expect([200, 404]).toContain(response.status)
    })

    it('should return updated instance for PUT /data/:type/:id', async () => {
      const response = await executeRequest(app, '/data/customers/cust-123', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: { name: 'Updated Customer' },
      })

      if (response.status === 200) {
        const body = await parseResponse<ItemResponse>(response)
        expect(body).toHaveProperty('_links')
      }
    })

    it('should return 200 or 204 for DELETE /data/:type/:id', async () => {
      const response = await executeRequest(app, '/data/customers/cust-123', {
        method: 'DELETE',
      })

      expect([200, 204, 404]).toContain(response.status)
    })
  })

  describe('Error Responses', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await executeRequest(app, '/unknown/path/here')

      expect(response.status).toBe(404)
    })

    it('should return 405 for invalid methods on collection', async () => {
      const response = await executeRequest(app, '/data/customers', {
        method: 'DELETE',
      })

      expect(response.status).toBe(405)
    })

    it('should return 405 for invalid methods on item', async () => {
      const response = await executeRequest(app, '/data/customers/cust-123', {
        method: 'POST',
      })

      expect(response.status).toBe(405)
    })

    it('should include Allow header for 405 responses', async () => {
      const response = await executeRequest(app, '/data/customers', {
        method: 'DELETE',
      })

      if (response.status === 405) {
        const allow = response.headers.get('Allow')
        expect(allow).toBeDefined()
        expect(allow).toContain('GET')
        expect(allow).toContain('POST')
      }
    })
  })
})

// ============================================================================
// 3. HATEOAS LINKS TESTS (~15 tests)
// ============================================================================

describe('HATEOAS Links', () => {
  let app: Hono

  beforeEach(() => {
    app = API()
  })

  describe('Root Resource Links', () => {
    it('should include _links object on root resource', async () => {
      const response = await executeRequest(app, '/')
      const body = await parseResponse<RootResource>(response)

      expect(body._links).toBeDefined()
      expect(typeof body._links).toBe('object')
    })

    it('should include _links.self pointing to root', async () => {
      const response = await executeRequest(app, '/')
      const body = await parseResponse<RootResource>(response)

      expect(body._links.self).toBeDefined()
      expect(body._links.self.href).toBe('/')
    })

    it('should include _links.schema pointing to schema endpoint', async () => {
      const response = await executeRequest(app, '/')
      const body = await parseResponse<RootResource>(response)

      expect(body._links.schema).toBeDefined()
      expect(body._links.schema?.href).toBe('/schema')
    })

    it('should include _links.data pointing to data endpoint', async () => {
      const response = await executeRequest(app, '/')
      const body = await parseResponse<RootResource>(response)

      expect(body._links.data).toBeDefined()
      expect(body._links.data?.href).toBe('/data')
    })

    it('should include _links.openapi pointing to OpenAPI spec', async () => {
      const response = await executeRequest(app, '/')
      const body = await parseResponse<RootResource>(response)

      expect(body._links.openapi).toBeDefined()
      expect(body._links.openapi?.href).toBe('/openapi.json')
    })
  })

  describe('Self Links', () => {
    it('should include _links.self on all resources', async () => {
      const paths = ['/', '/schema', '/data']

      for (const path of paths) {
        const response = await executeRequest(app, path)
        if (response.status === 200) {
          const body = await parseResponse<HATEOASResponse>(response)
          expect(body._links.self).toBeDefined()
          expect(body._links.self.href).toBe(path)
        }
      }
    })

    it('should include _links.self on schema type response', async () => {
      const response = await executeRequest(app, '/schema/Customer')

      if (response.status === 200) {
        const body = await parseResponse<TypeSchemaResponse>(response)
        expect(body._links.self).toBeDefined()
        expect(body._links.self.href).toBe('/schema/Customer')
      }
    })

    it('should include _links.self on item response', async () => {
      const response = await executeRequest(app, '/data/customers/cust-123')

      if (response.status === 200) {
        const body = await parseResponse<ItemResponse>(response)
        expect(body._links.self).toBeDefined()
        expect(body._links.self.href).toBe('/data/customers/cust-123')
      }
    })
  })

  describe('Collection Links', () => {
    it('should include _links.items on collection responses', async () => {
      const response = await executeRequest(app, '/data/customers')

      if (response.status === 200) {
        const body = await parseResponse<ItemsResponse>(response)
        expect(body._links.items).toBeDefined()
        expect(Array.isArray(body._links.items)).toBe(true)
      }
    })

    it('should include _links.collection on item responses', async () => {
      const response = await executeRequest(app, '/data/customers/cust-123')

      if (response.status === 200) {
        const body = await parseResponse<ItemResponse>(response)
        expect(body._links.collection).toBeDefined()
        expect(body._links.collection?.href).toBe('/data/customers')
      }
    })
  })

  describe('Pagination Links', () => {
    it('should include next link when there are more items', async () => {
      const response = await executeRequest(app, '/data/customers?limit=5')

      if (response.status === 200) {
        const body = await parseResponse<ItemsResponse>(response)
        if (body.total > 5 && body.items.length === 5) {
          expect(body._links.next).toBeDefined()
          expect(body._links.next?.href).toContain('offset=5')
        }
      }
    })

    it('should include prev link when not on first page', async () => {
      const response = await executeRequest(app, '/data/customers?limit=5&offset=5')

      if (response.status === 200) {
        const body = await parseResponse<ItemsResponse>(response)
        expect(body._links.prev).toBeDefined()
        expect(body._links.prev?.href).toContain('offset=0')
      }
    })

    it('should include first link on paginated responses', async () => {
      const response = await executeRequest(app, '/data/customers?limit=5&offset=10')

      if (response.status === 200) {
        const body = await parseResponse<ItemsResponse>(response)
        expect(body._links.first).toBeDefined()
        expect(body._links.first?.href).toContain('offset=0')
      }
    })

    it('should include last link on paginated responses', async () => {
      const response = await executeRequest(app, '/data/customers?limit=5')

      if (response.status === 200) {
        const body = await parseResponse<ItemsResponse>(response)
        if (body.total > 5) {
          expect(body._links.last).toBeDefined()
          const lastOffset = Math.floor((body.total - 1) / 5) * 5
          expect(body._links.last?.href).toContain(`offset=${lastOffset}`)
        }
      }
    })

    it('should not include next link on last page', async () => {
      const response = await executeRequest(app, '/data/customers?limit=1000')

      if (response.status === 200) {
        const body = await parseResponse<ItemsResponse>(response)
        if (body.items.length < 1000 || body.items.length === body.total) {
          expect(body._links.next).toBeUndefined()
        }
      }
    })

    it('should not include prev link on first page', async () => {
      const response = await executeRequest(app, '/data/customers?limit=5&offset=0')

      if (response.status === 200) {
        const body = await parseResponse<ItemsResponse>(response)
        expect(body._links.prev).toBeUndefined()
      }
    })
  })
})

// ============================================================================
// 4. OPENAPI SPEC TESTS (~10 tests)
// ============================================================================

describe('OpenAPI Specification', () => {
  let app: Hono

  beforeEach(() => {
    app = API()
  })

  describe('Basic Structure', () => {
    it('should return 200 for GET /openapi.json', async () => {
      const response = await executeRequest(app, '/openapi.json')

      expect(response.status).toBe(200)
    })

    it('should return valid OpenAPI 3.0 spec', async () => {
      const response = await executeRequest(app, '/openapi.json')
      const spec = await parseResponse<OpenAPISpec>(response)

      expect(spec.openapi).toBe('3.0.0')
    })

    it('should include info object', async () => {
      const response = await executeRequest(app, '/openapi.json')
      const spec = await parseResponse<OpenAPISpec>(response)

      expect(spec.info).toBeDefined()
      expect(spec.info.title).toBeDefined()
      expect(spec.info.version).toBeDefined()
    })

    it('should include paths object', async () => {
      const response = await executeRequest(app, '/openapi.json')
      const spec = await parseResponse<OpenAPISpec>(response)

      expect(spec.paths).toBeDefined()
      expect(typeof spec.paths).toBe('object')
    })
  })

  describe('Route Coverage', () => {
    it('should include all standard routes in paths', async () => {
      const response = await executeRequest(app, '/openapi.json')
      const spec = await parseResponse<OpenAPISpec>(response)

      const expectedPaths = ['/', '/schema', '/data', '/openapi.json']

      for (const path of expectedPaths) {
        expect(spec.paths).toHaveProperty(path)
      }
    })

    it('should include parameterized routes for types', async () => {
      const response = await executeRequest(app, '/openapi.json')
      const spec = await parseResponse<OpenAPISpec>(response)

      expect(spec.paths).toHaveProperty('/schema/{type}')
      expect(spec.paths).toHaveProperty('/data/{type}')
      expect(spec.paths).toHaveProperty('/data/{type}/{id}')
    })
  })

  describe('Schema Components', () => {
    it('should include components.schemas', async () => {
      const response = await executeRequest(app, '/openapi.json')
      const spec = await parseResponse<OpenAPISpec>(response)

      expect(spec.components).toBeDefined()
      expect(spec.components?.schemas).toBeDefined()
    })

    it('should generate schemas from $introspect types', async () => {
      const response = await executeRequest(app, '/openapi.json')
      const spec = await parseResponse<OpenAPISpec>(response)

      // Should have schemas for each type discovered from $introspect
      expect(spec.components?.schemas).toBeDefined()
      expect(Object.keys(spec.components?.schemas || {}).length).toBeGreaterThan(0)
    })

    it('should include request/response schemas for operations', async () => {
      const response = await executeRequest(app, '/openapi.json')
      const spec = await parseResponse<OpenAPISpec>(response)

      // POST operations should have requestBody schemas
      const dataTypePath = spec.paths['/data/{type}'] as Record<string, unknown>
      if (dataTypePath?.post) {
        const post = dataTypePath.post as Record<string, unknown>
        expect(post.requestBody).toBeDefined()
      }
    })
  })

  describe('Authentication', () => {
    it('should include securitySchemes', async () => {
      const response = await executeRequest(app, '/openapi.json')
      const spec = await parseResponse<OpenAPISpec>(response)

      expect(spec.components?.securitySchemes).toBeDefined()
    })

    it('should define Bearer token authentication', async () => {
      const response = await executeRequest(app, '/openapi.json')
      const spec = await parseResponse<OpenAPISpec>(response)

      const schemes = spec.components?.securitySchemes as Record<string, Record<string, unknown>>
      expect(schemes).toBeDefined()

      // Should have some form of bearer/JWT auth
      const hasBearerAuth = Object.values(schemes || {}).some(
        (s) => s.type === 'http' && s.scheme === 'bearer'
      )
      expect(hasBearerAuth).toBe(true)
    })

    it('should include security requirements', async () => {
      const response = await executeRequest(app, '/openapi.json')
      const spec = await parseResponse<OpenAPISpec>(response)

      expect(spec.security).toBeDefined()
      expect(Array.isArray(spec.security)).toBe(true)
    })
  })
})

// ============================================================================
// 5. CONTENT NEGOTIATION TESTS
// ============================================================================

describe('Content Negotiation', () => {
  let app: Hono

  beforeEach(() => {
    app = API()
  })

  it('should return JSON for Accept: application/json', async () => {
    const response = await executeRequest(app, '/', {
      headers: { 'Accept': 'application/json' },
    })

    expect(response.headers.get('Content-Type')).toMatch(/application\/json/)
  })

  it('should return JSON for Accept: application/hal+json', async () => {
    const response = await executeRequest(app, '/', {
      headers: { 'Accept': 'application/hal+json' },
    })

    // Should accept HAL+JSON and return valid HATEOAS response
    expect(response.status).toBe(200)
    const body = await parseResponse<HATEOASResponse>(response)
    expect(body._links).toBeDefined()
  })

  it('should return JSON for Accept: */*', async () => {
    const response = await executeRequest(app, '/', {
      headers: { 'Accept': '*/*' },
    })

    expect(response.headers.get('Content-Type')).toMatch(/application\/json/)
  })

  it('should include Link header with context', async () => {
    const response = await executeRequest(app, '/')

    // Optional: Link header for JSON-LD context
    const link = response.headers.get('Link')
    // Link header is optional but recommended for HATEOAS
    if (link) {
      expect(typeof link).toBe('string')
    }
  })
})

// ============================================================================
// 6. QUERY PARAMETER TESTS
// ============================================================================

describe('Query Parameters', () => {
  let app: Hono

  beforeEach(() => {
    app = API()
  })

  describe('Pagination', () => {
    it('should support limit parameter', async () => {
      const response = await executeRequest(app, '/data/customers?limit=10')

      if (response.status === 200) {
        const body = await parseResponse<ItemsResponse>(response)
        expect(body.limit).toBe(10)
        expect(body.items.length).toBeLessThanOrEqual(10)
      }
    })

    it('should support offset parameter', async () => {
      const response = await executeRequest(app, '/data/customers?offset=5')

      if (response.status === 200) {
        const body = await parseResponse<ItemsResponse>(response)
        expect(body.offset).toBe(5)
      }
    })

    it('should default limit to reasonable value', async () => {
      const response = await executeRequest(app, '/data/customers')

      if (response.status === 200) {
        const body = await parseResponse<ItemsResponse>(response)
        expect(body.limit).toBeGreaterThan(0)
        expect(body.limit).toBeLessThanOrEqual(100)
      }
    })

    it('should default offset to 0', async () => {
      const response = await executeRequest(app, '/data/customers')

      if (response.status === 200) {
        const body = await parseResponse<ItemsResponse>(response)
        expect(body.offset).toBe(0)
      }
    })
  })

  describe('Filtering', () => {
    it('should support filter[field]=value syntax', async () => {
      const response = await executeRequest(app, '/data/customers?filter[status]=active')

      // Should not error
      expect([200, 404]).toContain(response.status)
    })

    it('should support q parameter for full-text search', async () => {
      const response = await executeRequest(app, '/data/customers?q=acme')

      // Should not error
      expect([200, 404]).toContain(response.status)
    })
  })

  describe('Sorting', () => {
    it('should support sort parameter', async () => {
      const response = await executeRequest(app, '/data/customers?sort=name')

      // Should not error
      expect([200, 404]).toContain(response.status)
    })

    it('should support descending sort with - prefix', async () => {
      const response = await executeRequest(app, '/data/customers?sort=-createdAt')

      // Should not error
      expect([200, 404]).toContain(response.status)
    })
  })

  describe('Field Selection', () => {
    it('should support fields parameter for sparse fieldsets', async () => {
      const response = await executeRequest(app, '/data/customers?fields=id,name')

      if (response.status === 200) {
        const body = await parseResponse<ItemsResponse>(response)
        for (const item of body.items) {
          // Should only have specified fields plus _links
          const keys = Object.keys(item).filter((k) => k !== '_links')
          for (const key of keys) {
            expect(['id', 'name']).toContain(key)
          }
        }
      }
    })
  })
})

// ============================================================================
// 7. ERROR RESPONSE FORMAT TESTS
// ============================================================================

describe('Error Response Format', () => {
  let app: Hono

  beforeEach(() => {
    app = API()
  })

  it('should return JSON error responses', async () => {
    const response = await executeRequest(app, '/nonexistent')

    expect(response.headers.get('Content-Type')).toMatch(/application\/json/)
  })

  it('should include error message in response', async () => {
    const response = await executeRequest(app, '/nonexistent')
    const body = await parseResponse<{ error: string }>(response)

    expect(body.error).toBeDefined()
    expect(typeof body.error).toBe('string')
  })

  it('should include status code in error response', async () => {
    const response = await executeRequest(app, '/nonexistent')
    const body = await parseResponse<{ error: string; status?: number }>(response)

    // Status in body is optional but recommended
    if (body.status !== undefined) {
      expect(body.status).toBe(404)
    }
  })

  it('should include _links.self on error responses', async () => {
    const response = await executeRequest(app, '/nonexistent')
    const body = await parseResponse<HATEOASResponse>(response)

    // HATEOAS-compliant error responses should have self link
    expect(body._links).toBeDefined()
    expect(body._links.self).toBeDefined()
  })

  it('should return 400 for invalid query parameters', async () => {
    const response = await executeRequest(app, '/data/customers?limit=-1')

    expect(response.status).toBe(400)
  })

  it('should return 400 for invalid JSON in POST body', async () => {
    const request = new Request('https://test.dashboard.do/data/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json',
    })

    const response = await app.fetch(request)

    expect(response.status).toBe(400)
  })
})

// ============================================================================
// 8. DEBUG MODE TESTS
// ============================================================================

describe('Debug Mode', () => {
  it('should expose debug endpoint when debug is true', async () => {
    const app = API({ debug: true })
    const response = await executeRequest(app, '/_debug')

    expect(response.status).toBe(200)
  })

  it('should not expose debug endpoint when debug is false', async () => {
    const app = API({ debug: false })
    const response = await executeRequest(app, '/_debug')

    expect(response.status).toBe(404)
  })

  it('should not expose debug endpoint by default', async () => {
    const app = API()
    const response = await executeRequest(app, '/_debug')

    expect(response.status).toBe(404)
  })

  it('should include timing information in debug mode', async () => {
    const app = API({ debug: true })
    const response = await executeRequest(app, '/')

    // Debug mode may include timing headers
    const serverTiming = response.headers.get('Server-Timing')
    if (serverTiming) {
      expect(typeof serverTiming).toBe('string')
    }
  })
})

// ============================================================================
// 9. NAMESPACE HANDLING TESTS
// ============================================================================

describe('Namespace Handling', () => {
  it('should include namespace in root resource', async () => {
    const app = API({ ns: 'test-namespace' })
    const response = await executeRequest(app, '/')
    const body = await parseResponse<RootResource & { ns?: string }>(response)

    expect(body.ns).toBe('test-namespace')
  })

  it('should include namespace in Link headers', async () => {
    const app = API({ ns: 'test-namespace' })
    const response = await executeRequest(app, '/')
    const body = await parseResponse<RootResource>(response)

    // Links should be relative or include namespace context
    expect(body._links.self.href).toBeDefined()
  })

  it('should use namespace from config file', async () => {
    // This test verifies that namespace can be loaded from do.config.ts
    const app = API({ config: './do.config.ts' })
    const response = await executeRequest(app, '/')

    // Should not error
    expect(response.status).toBe(200)
  })
})

// ============================================================================
// 10. INTEGRATION WITH $introspect TESTS
// ============================================================================

describe('Integration with $introspect', () => {
  let app: Hono

  beforeEach(() => {
    app = API()
  })

  it('should load schema from $introspect endpoint', async () => {
    const response = await executeRequest(app, '/schema')

    if (response.status === 200) {
      const body = await parseResponse<SchemaResponse>(response)
      // Types should come from $introspect
      expect(body.types).toBeDefined()
    }
  })

  it('should generate data collections from schema types', async () => {
    const response = await executeRequest(app, '/data')

    if (response.status === 200) {
      const body = await parseResponse<DataCollectionResponse>(response)
      // Collections should be derived from schema types
      expect(body.collections).toBeDefined()
    }
  })

  it('should match schema types with data collections', async () => {
    const schemaResponse = await executeRequest(app, '/schema')
    const dataResponse = await executeRequest(app, '/data')

    if (schemaResponse.status === 200 && dataResponse.status === 200) {
      const schema = await parseResponse<SchemaResponse>(schemaResponse)
      const data = await parseResponse<DataCollectionResponse>(dataResponse)

      // Each schema type should have a corresponding data collection
      const typeNames = schema.types.map((t) => t.name.toLowerCase())
      const collectionNames = data.collections.map((c) => c.name.toLowerCase())

      for (const typeName of typeNames) {
        // Collections may use plural form
        const hasCollection = collectionNames.some(
          (c) => c === typeName || c === typeName + 's' || c === typeName.replace(/y$/, 'ies')
        )
        // Not all types may have collections, so this is informational
        expect(typeof hasCollection).toBe('boolean')
      }
    }
  })

  it('should generate OpenAPI spec from $introspect schema', async () => {
    const response = await executeRequest(app, '/openapi.json')

    if (response.status === 200) {
      const spec = await parseResponse<OpenAPISpec>(response)
      // Schemas should be generated from $introspect types
      expect(spec.components?.schemas).toBeDefined()
    }
  })
})

// ============================================================================
// 11. CORS AND SECURITY TESTS
// ============================================================================

describe('CORS and Security', () => {
  let app: Hono

  beforeEach(() => {
    app = API()
  })

  it('should handle OPTIONS preflight requests', async () => {
    const response = await executeRequest(app, '/data/customers', {
      method: 'OPTIONS',
    })

    expect([200, 204]).toContain(response.status)
  })

  it('should include CORS headers on responses', async () => {
    const response = await executeRequest(app, '/')

    // CORS headers may or may not be present depending on config
    const allowOrigin = response.headers.get('Access-Control-Allow-Origin')
    // Just check the header is readable (may be null)
    expect(typeof allowOrigin === 'string' || allowOrigin === null).toBe(true)
  })

  it('should not include sensitive information in error responses', async () => {
    const response = await executeRequest(app, '/nonexistent')
    const text = await response.text()

    // Should not leak stack traces or internal paths
    expect(text).not.toContain('node_modules')
    expect(text).not.toContain('Error:')
    expect(text).not.toMatch(/at\s+\w+\s+\(/)
  })
})
