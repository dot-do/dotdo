/**
 * REST API Auto-Wiring Tests
 *
 * RED TDD: Tests for auto-exposing DO methods as REST endpoints.
 *
 * The REST auto-wiring system automatically generates REST API routes from
 * DO class methods, enabling rapid API development without manual route setup.
 *
 * Key concepts:
 * - Static $rest configuration defines route mappings
 * - @rest() decorator provides inline route configuration
 * - Methods are exposed at /api/{method} by default
 * - HTTP methods (GET, POST, PUT, DELETE, PATCH) are inferred or configured
 * - Query params map to method arguments
 * - Request body is passed to methods
 * - Return values are serialized as JSON
 * - Errors map to appropriate HTTP status codes
 * - Rate limiting and throttling are configurable per-route
 *
 * This test file validates the REST auto-wiring WITHOUT a working implementation.
 * All tests should FAIL until the implementation is complete.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// These imports will FAIL until implementation exists
import {
  createRestRouter,
  rest,
  getRestRoutes,
  getRouteConfig,
  parseRouteParams,
  serializeResponse,
  deserializeRequest,
  mapHttpError,
  type RestRouteConfig,
  type RestMethodConfig,
  type RestRateLimitConfig,
  type RestThrottleConfig,
  type RestResponse,
  type RestRequest,
  type RestError,
  type ContentType,
} from '../../transport/rest-autowire'

import { DO } from '../../DO'

// ============================================================================
// TEST DO CLASSES
// ============================================================================

/**
 * A simple test DO with various REST-exposed methods
 */
class RestTestDO extends DO {
  // Static REST configuration
  static $rest = {
    // Simple GET endpoint
    greet: {
      method: 'GET',
      path: '/greet/:name',
    },
    // POST with body
    createItem: {
      method: 'POST',
      path: '/items',
    },
    // GET with query params
    searchItems: {
      method: 'GET',
      path: '/items',
      queryParams: ['q', 'limit', 'offset'],
    },
    // PUT for updates
    updateItem: {
      method: 'PUT',
      path: '/items/:id',
    },
    // DELETE
    deleteItem: {
      method: 'DELETE',
      path: '/items/:id',
    },
    // PATCH for partial updates
    patchItem: {
      method: 'PATCH',
      path: '/items/:id',
    },
  } as const

  private items: Map<string, { id: string; name: string; description?: string }> = new Map()

  greet(name: string): { message: string } {
    return { message: `Hello, ${name}!` }
  }

  createItem(data: { name: string; description?: string }): { id: string; name: string; description?: string } {
    const id = crypto.randomUUID()
    const item = { id, ...data }
    this.items.set(id, item)
    return item
  }

  searchItems(q?: string, limit?: number, offset?: number): { items: Array<{ id: string; name: string }>; total: number } {
    let results = Array.from(this.items.values())

    if (q) {
      results = results.filter((item) => item.name.toLowerCase().includes(q.toLowerCase()))
    }

    const total = results.length
    const start = offset ?? 0
    const end = limit ? start + limit : results.length

    return {
      items: results.slice(start, end),
      total,
    }
  }

  updateItem(id: string, data: { name: string; description?: string }): { id: string; name: string; description?: string } {
    if (!this.items.has(id)) {
      throw new NotFoundError(`Item ${id} not found`)
    }
    const item = { id, ...data }
    this.items.set(id, item)
    return item
  }

  deleteItem(id: string): { deleted: boolean } {
    if (!this.items.has(id)) {
      throw new NotFoundError(`Item ${id} not found`)
    }
    this.items.delete(id)
    return { deleted: true }
  }

  patchItem(id: string, data: Partial<{ name: string; description: string }>): { id: string; name: string; description?: string } {
    const existing = this.items.get(id)
    if (!existing) {
      throw new NotFoundError(`Item ${id} not found`)
    }
    const updated = { ...existing, ...data }
    this.items.set(id, updated)
    return updated
  }
}

/**
 * A DO using @rest() decorators instead of static config
 */
class DecoratedRestDO extends DO {
  @rest({ method: 'GET', path: '/users/:userId' })
  getUser(userId: string): { id: string; name: string } {
    return { id: userId, name: 'Test User' }
  }

  @rest({ method: 'POST', path: '/users' })
  createUser(data: { name: string; email: string }): { id: string; name: string; email: string } {
    return { id: crypto.randomUUID(), ...data }
  }

  @rest({
    method: 'GET',
    path: '/users',
    queryParams: ['limit', 'offset', 'sort'],
  })
  listUsers(limit?: number, offset?: number, sort?: string): { users: Array<{ id: string; name: string }> } {
    return { users: [] }
  }
}

/**
 * A DO with rate limiting configuration
 */
class RateLimitedDO extends DO {
  static $rest = {
    limitedEndpoint: {
      method: 'GET',
      path: '/limited',
      rateLimit: {
        requests: 10,
        windowMs: 60000, // 1 minute
        keyBy: 'ip', // Rate limit by IP address
      },
    },
    userLimitedEndpoint: {
      method: 'GET',
      path: '/user-limited',
      rateLimit: {
        requests: 100,
        windowMs: 3600000, // 1 hour
        keyBy: 'user', // Rate limit by authenticated user
      },
    },
    burstLimitedEndpoint: {
      method: 'POST',
      path: '/burst-limited',
      throttle: {
        burstLimit: 5,
        sustainedRate: 1, // 1 request per second
        windowMs: 1000,
      },
    },
  } as const

  limitedEndpoint(): { data: string } {
    return { data: 'limited response' }
  }

  userLimitedEndpoint(): { data: string } {
    return { data: 'user limited response' }
  }

  burstLimitedEndpoint(data: unknown): { received: boolean } {
    return { received: true }
  }
}

/**
 * A DO with content-type negotiation
 */
class ContentNegotiationDO extends DO {
  static $rest = {
    getData: {
      method: 'GET',
      path: '/data',
      produces: ['application/json', 'application/xml', 'text/csv'],
    },
    submitData: {
      method: 'POST',
      path: '/data',
      consumes: ['application/json', 'multipart/form-data', 'application/x-www-form-urlencoded'],
    },
  } as const

  getData(): { items: Array<{ id: string; value: number }> } {
    return {
      items: [
        { id: '1', value: 100 },
        { id: '2', value: 200 },
      ],
    }
  }

  submitData(data: Record<string, unknown>): { success: boolean; data: Record<string, unknown> } {
    return { success: true, data }
  }
}

/**
 * A DO with authentication requirements
 */
class AuthenticatedDO extends DO {
  static $rest = {
    publicEndpoint: {
      method: 'GET',
      path: '/public',
      auth: false,
    },
    protectedEndpoint: {
      method: 'GET',
      path: '/protected',
      auth: true,
    },
    adminEndpoint: {
      method: 'GET',
      path: '/admin',
      auth: true,
      roles: ['admin'],
    },
    scopedEndpoint: {
      method: 'POST',
      path: '/scoped',
      auth: true,
      scopes: ['write:items', 'read:items'],
    },
  } as const

  publicEndpoint(): { message: string } {
    return { message: 'public data' }
  }

  protectedEndpoint(): { message: string } {
    return { message: 'protected data' }
  }

  adminEndpoint(): { message: string } {
    return { message: 'admin data' }
  }

  scopedEndpoint(data: unknown): { message: string } {
    return { message: 'scoped data' }
  }
}

/**
 * Custom error classes for proper HTTP status mapping
 */
class NotFoundError extends Error {
  readonly statusCode = 404
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

class ValidationError extends Error {
  readonly statusCode = 400
  constructor(message: string, readonly errors?: Record<string, string[]>) {
    super(message)
    this.name = 'ValidationError'
  }
}

class UnauthorizedError extends Error {
  readonly statusCode = 401
  constructor(message: string = 'Unauthorized') {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

class ForbiddenError extends Error {
  readonly statusCode = 403
  constructor(message: string = 'Forbidden') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

class ConflictError extends Error {
  readonly statusCode = 409
  constructor(message: string) {
    super(message)
    this.name = 'ConflictError'
  }
}

class RateLimitExceededError extends Error {
  readonly statusCode = 429
  readonly retryAfter: number
  constructor(message: string, retryAfter: number) {
    super(message)
    this.name = 'RateLimitExceededError'
    this.retryAfter = retryAfter
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('REST API Auto-Wiring', () => {
  // ==========================================================================
  // 1. ROUTE DISCOVERY TESTS
  // ==========================================================================

  describe('Route Discovery', () => {
    describe('getRestRoutes()', () => {
      it('returns an array of route configurations from static $rest', () => {
        const routes = getRestRoutes(RestTestDO)

        expect(routes).toBeDefined()
        expect(Array.isArray(routes)).toBe(true)
        expect(routes.length).toBeGreaterThan(0)
      })

      it('extracts route path from configuration', () => {
        const routes = getRestRoutes(RestTestDO)

        const greetRoute = routes.find((r) => r.methodName === 'greet')
        expect(greetRoute).toBeDefined()
        expect(greetRoute?.path).toBe('/greet/:name')
      })

      it('extracts HTTP method from configuration', () => {
        const routes = getRestRoutes(RestTestDO)

        const createRoute = routes.find((r) => r.methodName === 'createItem')
        expect(createRoute).toBeDefined()
        expect(createRoute?.httpMethod).toBe('POST')
      })

      it('extracts query params configuration', () => {
        const routes = getRestRoutes(RestTestDO)

        const searchRoute = routes.find((r) => r.methodName === 'searchItems')
        expect(searchRoute).toBeDefined()
        expect(searchRoute?.queryParams).toEqual(['q', 'limit', 'offset'])
      })

      it('returns all CRUD operation routes', () => {
        const routes = getRestRoutes(RestTestDO)

        const httpMethods = routes.map((r) => r.httpMethod)

        expect(httpMethods).toContain('GET')
        expect(httpMethods).toContain('POST')
        expect(httpMethods).toContain('PUT')
        expect(httpMethods).toContain('DELETE')
        expect(httpMethods).toContain('PATCH')
      })

      it('returns routes from @rest() decorated methods', () => {
        const routes = getRestRoutes(DecoratedRestDO)

        expect(routes.length).toBe(3)

        const getUserRoute = routes.find((r) => r.methodName === 'getUser')
        expect(getUserRoute).toBeDefined()
        expect(getUserRoute?.path).toBe('/users/:userId')
        expect(getUserRoute?.httpMethod).toBe('GET')
      })

      it('returns empty array for DO without REST configuration', () => {
        class PlainDO extends DO {
          someMethod(): void {}
        }

        const routes = getRestRoutes(PlainDO)
        expect(routes).toEqual([])
      })
    })

    describe('getRouteConfig()', () => {
      it('returns configuration for a specific route', () => {
        const config = getRouteConfig(RestTestDO, 'greet')

        expect(config).toBeDefined()
        expect(config?.method).toBe('GET')
        expect(config?.path).toBe('/greet/:name')
      })

      it('returns undefined for non-existent route', () => {
        const config = getRouteConfig(RestTestDO, 'nonExistent')

        expect(config).toBeUndefined()
      })

      it('returns rate limit configuration when present', () => {
        const config = getRouteConfig(RateLimitedDO, 'limitedEndpoint')

        expect(config?.rateLimit).toBeDefined()
        expect(config?.rateLimit?.requests).toBe(10)
        expect(config?.rateLimit?.windowMs).toBe(60000)
      })

      it('returns throttle configuration when present', () => {
        const config = getRouteConfig(RateLimitedDO, 'burstLimitedEndpoint')

        expect(config?.throttle).toBeDefined()
        expect(config?.throttle?.burstLimit).toBe(5)
        expect(config?.throttle?.sustainedRate).toBe(1)
      })

      it('returns auth configuration when present', () => {
        const config = getRouteConfig(AuthenticatedDO, 'adminEndpoint')

        expect(config?.auth).toBe(true)
        expect(config?.roles).toEqual(['admin'])
      })
    })
  })

  // ==========================================================================
  // 2. ROUTER CREATION TESTS
  // ==========================================================================

  describe('Router Creation', () => {
    describe('createRestRouter()', () => {
      it('creates a router from DO class', () => {
        const router = createRestRouter(RestTestDO)

        expect(router).toBeDefined()
        expect(typeof router.fetch).toBe('function')
      })

      it('creates routes for all configured endpoints', () => {
        const router = createRestRouter(RestTestDO)
        const routes = router.routes

        expect(routes.length).toBe(6) // All 6 routes from RestTestDO.$rest
      })

      it('supports custom base path prefix', () => {
        const router = createRestRouter(RestTestDO, { basePath: '/v1' })
        const routes = router.routes

        const greetRoute = routes.find((r) => r.methodName === 'greet')
        expect(greetRoute?.fullPath).toBe('/v1/greet/:name')
      })

      it('supports custom API prefix', () => {
        const router = createRestRouter(RestTestDO, { apiPrefix: '/custom-api' })
        const routes = router.routes

        const greetRoute = routes.find((r) => r.methodName === 'greet')
        expect(greetRoute?.fullPath).toBe('/custom-api/greet/:name')
      })

      it('creates router with middleware support', () => {
        const middleware = vi.fn((req, next) => next(req))
        const router = createRestRouter(RestTestDO, { middleware: [middleware] })

        expect(router.middleware).toContain(middleware)
      })
    })
  })

  // ==========================================================================
  // 3. REQUEST HANDLING TESTS
  // ==========================================================================

  describe('Request Handling', () => {
    describe('GET requests', () => {
      it('handles GET request with path parameters', async () => {
        const router = createRestRouter(RestTestDO)
        const request = new Request('https://example.com.ai/greet/World')

        const response = await router.fetch(request)

        expect(response.status).toBe(200)
        const body = await response.json()
        expect(body).toEqual({ message: 'Hello, World!' })
      })

      it('handles GET request with query parameters', async () => {
        const router = createRestRouter(RestTestDO)
        const request = new Request('https://example.com.ai/items?q=test&limit=10&offset=0')

        const response = await router.fetch(request)

        expect(response.status).toBe(200)
        const body = await response.json()
        expect(body).toHaveProperty('items')
        expect(body).toHaveProperty('total')
      })

      it('converts query params to correct types', async () => {
        const router = createRestRouter(RestTestDO)
        const request = new Request('https://example.com.ai/items?limit=5')

        // The router should convert "5" string to number 5
        const response = await router.fetch(request)

        expect(response.status).toBe(200)
      })

      it('handles optional query parameters', async () => {
        const router = createRestRouter(RestTestDO)
        const request = new Request('https://example.com.ai/items')

        const response = await router.fetch(request)

        expect(response.status).toBe(200)
      })
    })

    describe('POST requests', () => {
      it('handles POST request with JSON body', async () => {
        const router = createRestRouter(RestTestDO)
        const request = new Request('https://example.com.ai/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Test Item', description: 'A test item' }),
        })

        const response = await router.fetch(request)

        expect(response.status).toBe(201) // Created
        const body = await response.json()
        expect(body).toHaveProperty('id')
        expect(body.name).toBe('Test Item')
      })

      it('handles POST with form-data', async () => {
        const router = createRestRouter(ContentNegotiationDO)
        const formData = new FormData()
        formData.append('name', 'Test')
        formData.append('value', '123')

        const request = new Request('https://example.com.ai/data', {
          method: 'POST',
          body: formData,
        })

        const response = await router.fetch(request)

        expect(response.status).toBe(201)
      })

      it('handles POST with URL-encoded data', async () => {
        const router = createRestRouter(ContentNegotiationDO)
        const request = new Request('https://example.com.ai/data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'name=Test&value=123',
        })

        const response = await router.fetch(request)

        expect(response.status).toBe(201)
      })

      it('rejects POST with unsupported content type', async () => {
        const router = createRestRouter(ContentNegotiationDO)
        const request = new Request('https://example.com.ai/data', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: 'some text',
        })

        const response = await router.fetch(request)

        expect(response.status).toBe(415) // Unsupported Media Type
      })
    })

    describe('PUT requests', () => {
      it('handles PUT request for resource update', async () => {
        const router = createRestRouter(RestTestDO)

        // First create an item
        const createRequest = new Request('https://example.com.ai/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Original' }),
        })
        const createResponse = await router.fetch(createRequest)
        const created = await createResponse.json()

        // Then update it
        const updateRequest = new Request(`https://example.com.ai/items/${created.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Updated', description: 'Updated description' }),
        })

        const response = await router.fetch(updateRequest)

        expect(response.status).toBe(200)
        const body = await response.json()
        expect(body.name).toBe('Updated')
      })

      it('returns 404 for PUT on non-existent resource', async () => {
        const router = createRestRouter(RestTestDO)
        const request = new Request('https://example.com.ai/items/non-existent-id', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Updated' }),
        })

        const response = await router.fetch(request)

        expect(response.status).toBe(404)
      })
    })

    describe('PATCH requests', () => {
      it('handles PATCH request for partial update', async () => {
        const router = createRestRouter(RestTestDO)

        // First create an item
        const createRequest = new Request('https://example.com.ai/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Original', description: 'Original desc' }),
        })
        const createResponse = await router.fetch(createRequest)
        const created = await createResponse.json()

        // Then patch it
        const patchRequest = new Request(`https://example.com.ai/items/${created.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description: 'Patched description' }),
        })

        const response = await router.fetch(patchRequest)

        expect(response.status).toBe(200)
        const body = await response.json()
        expect(body.name).toBe('Original') // Unchanged
        expect(body.description).toBe('Patched description') // Updated
      })
    })

    describe('DELETE requests', () => {
      it('handles DELETE request for resource removal', async () => {
        const router = createRestRouter(RestTestDO)

        // First create an item
        const createRequest = new Request('https://example.com.ai/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'To Delete' }),
        })
        const createResponse = await router.fetch(createRequest)
        const created = await createResponse.json()

        // Then delete it
        const deleteRequest = new Request(`https://example.com.ai/items/${created.id}`, {
          method: 'DELETE',
        })

        const response = await router.fetch(deleteRequest)

        expect(response.status).toBe(200)
        const body = await response.json()
        expect(body.deleted).toBe(true)
      })

      it('returns 404 for DELETE on non-existent resource', async () => {
        const router = createRestRouter(RestTestDO)
        const request = new Request('https://example.com.ai/items/non-existent-id', {
          method: 'DELETE',
        })

        const response = await router.fetch(request)

        expect(response.status).toBe(404)
      })
    })
  })

  // ==========================================================================
  // 4. PARAMETER PARSING TESTS
  // ==========================================================================

  describe('Parameter Parsing', () => {
    describe('parseRouteParams()', () => {
      it('extracts single path parameter', () => {
        const result = parseRouteParams('/users/:userId', '/users/123')

        expect(result).toEqual({ userId: '123' })
      })

      it('extracts multiple path parameters', () => {
        const result = parseRouteParams('/users/:userId/posts/:postId', '/users/123/posts/456')

        expect(result).toEqual({ userId: '123', postId: '456' })
      })

      it('handles paths without parameters', () => {
        const result = parseRouteParams('/users', '/users')

        expect(result).toEqual({})
      })

      it('handles URL-encoded path parameters', () => {
        const result = parseRouteParams('/greet/:name', '/greet/John%20Doe')

        expect(result).toEqual({ name: 'John Doe' })
      })

      it('returns null for non-matching paths', () => {
        const result = parseRouteParams('/users/:userId', '/posts/123')

        expect(result).toBeNull()
      })

      it('handles trailing slashes correctly', () => {
        const result = parseRouteParams('/users/:userId', '/users/123/')

        expect(result).toEqual({ userId: '123' })
      })

      it('handles optional parameters (suffix ?)', () => {
        const result = parseRouteParams('/users/:userId/:action?', '/users/123')

        expect(result).toEqual({ userId: '123', action: undefined })
      })

      it('handles wildcard parameters (suffix *)', () => {
        const result = parseRouteParams('/files/*path', '/files/folder/subfolder/file.txt')

        expect(result).toEqual({ path: 'folder/subfolder/file.txt' })
      })
    })
  })

  // ==========================================================================
  // 5. RESPONSE SERIALIZATION TESTS
  // ==========================================================================

  describe('Response Serialization', () => {
    describe('serializeResponse()', () => {
      it('serializes object to JSON response', () => {
        const data = { id: '123', name: 'Test' }
        const response = serializeResponse(data)

        expect(response.headers.get('Content-Type')).toBe('application/json')
      })

      it('serializes array to JSON response', () => {
        const data = [{ id: '1' }, { id: '2' }]
        const response = serializeResponse(data)

        expect(response.headers.get('Content-Type')).toBe('application/json')
      })

      it('serializes primitive values', () => {
        const numberResponse = serializeResponse(42)
        const stringResponse = serializeResponse('hello')
        const boolResponse = serializeResponse(true)

        expect(numberResponse.headers.get('Content-Type')).toBe('application/json')
        expect(stringResponse.headers.get('Content-Type')).toBe('application/json')
        expect(boolResponse.headers.get('Content-Type')).toBe('application/json')
      })

      it('handles null response', () => {
        const response = serializeResponse(null)

        expect(response.status).toBe(204) // No Content
      })

      it('handles undefined response', () => {
        const response = serializeResponse(undefined)

        expect(response.status).toBe(204) // No Content
      })

      it('respects Accept header for content negotiation', () => {
        const data = { id: '123', name: 'Test' }
        const accept = 'application/xml'

        const response = serializeResponse(data, { accept })

        expect(response.headers.get('Content-Type')).toBe('application/xml')
      })

      it('falls back to JSON for unknown Accept header', () => {
        const data = { id: '123' }
        const accept = 'application/unknown'

        const response = serializeResponse(data, { accept })

        expect(response.headers.get('Content-Type')).toBe('application/json')
      })

      it('sets appropriate status code for POST response (201)', () => {
        const data = { id: '123', name: 'Created' }
        const response = serializeResponse(data, { method: 'POST' })

        expect(response.status).toBe(201)
      })

      it('sets appropriate status code for DELETE response', () => {
        const data = { deleted: true }
        const response = serializeResponse(data, { method: 'DELETE' })

        expect(response.status).toBe(200)
      })
    })

    describe('Content-Type negotiation', () => {
      it('returns JSON when Accept is application/json', async () => {
        const router = createRestRouter(ContentNegotiationDO)
        const request = new Request('https://example.com.ai/data', {
          headers: { 'Accept': 'application/json' },
        })

        const response = await router.fetch(request)

        expect(response.headers.get('Content-Type')).toContain('application/json')
      })

      it('returns XML when Accept is application/xml', async () => {
        const router = createRestRouter(ContentNegotiationDO)
        const request = new Request('https://example.com.ai/data', {
          headers: { 'Accept': 'application/xml' },
        })

        const response = await router.fetch(request)

        expect(response.headers.get('Content-Type')).toContain('application/xml')
      })

      it('returns CSV when Accept is text/csv', async () => {
        const router = createRestRouter(ContentNegotiationDO)
        const request = new Request('https://example.com.ai/data', {
          headers: { 'Accept': 'text/csv' },
        })

        const response = await router.fetch(request)

        expect(response.headers.get('Content-Type')).toContain('text/csv')
      })

      it('respects Accept header quality values', async () => {
        const router = createRestRouter(ContentNegotiationDO)
        const request = new Request('https://example.com.ai/data', {
          headers: { 'Accept': 'application/xml;q=0.9, application/json;q=1.0' },
        })

        const response = await router.fetch(request)

        // Should prefer JSON due to higher quality value
        expect(response.headers.get('Content-Type')).toContain('application/json')
      })

      it('returns 406 Not Acceptable for unsupported Accept types', async () => {
        const router = createRestRouter(ContentNegotiationDO)
        const request = new Request('https://example.com.ai/data', {
          headers: { 'Accept': 'application/unsupported' },
        })

        const response = await router.fetch(request)

        expect(response.status).toBe(406)
      })
    })
  })

  // ==========================================================================
  // 6. REQUEST DESERIALIZATION TESTS
  // ==========================================================================

  describe('Request Deserialization', () => {
    describe('deserializeRequest()', () => {
      it('deserializes JSON request body', async () => {
        const request = new Request('https://example.com.ai/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Test' }),
        })

        const data = await deserializeRequest(request)

        expect(data).toEqual({ name: 'Test' })
      })

      it('deserializes form-data request body', async () => {
        const formData = new FormData()
        formData.append('name', 'Test')
        formData.append('count', '5')

        const request = new Request('https://example.com.ai/items', {
          method: 'POST',
          body: formData,
        })

        const data = await deserializeRequest(request)

        expect(data.name).toBe('Test')
        expect(data.count).toBe('5')
      })

      it('deserializes URL-encoded request body', async () => {
        const request = new Request('https://example.com.ai/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'name=Test&count=5',
        })

        const data = await deserializeRequest(request)

        expect(data.name).toBe('Test')
        expect(data.count).toBe('5')
      })

      it('handles empty request body', async () => {
        const request = new Request('https://example.com.ai/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })

        const data = await deserializeRequest(request)

        expect(data).toEqual({})
      })

      it('handles malformed JSON gracefully', async () => {
        const request = new Request('https://example.com.ai/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{ invalid json }',
        })

        await expect(deserializeRequest(request)).rejects.toThrow()
      })

      it('handles file uploads in form-data', async () => {
        const file = new File(['test content'], 'test.txt', { type: 'text/plain' })
        const formData = new FormData()
        formData.append('file', file)
        formData.append('name', 'Test Upload')

        const request = new Request('https://example.com.ai/upload', {
          method: 'POST',
          body: formData,
        })

        const data = await deserializeRequest(request)

        expect(data.file).toBeInstanceOf(File)
        expect(data.name).toBe('Test Upload')
      })
    })
  })

  // ==========================================================================
  // 7. ERROR HANDLING TESTS
  // ==========================================================================

  describe('Error Handling', () => {
    describe('mapHttpError()', () => {
      it('maps NotFoundError to 404', () => {
        const error = new NotFoundError('Resource not found')
        const result = mapHttpError(error)

        expect(result.status).toBe(404)
        expect(result.message).toBe('Resource not found')
      })

      it('maps ValidationError to 400', () => {
        const error = new ValidationError('Invalid input', { name: ['Required'] })
        const result = mapHttpError(error)

        expect(result.status).toBe(400)
        expect(result.errors).toEqual({ name: ['Required'] })
      })

      it('maps UnauthorizedError to 401', () => {
        const error = new UnauthorizedError()
        const result = mapHttpError(error)

        expect(result.status).toBe(401)
      })

      it('maps ForbiddenError to 403', () => {
        const error = new ForbiddenError()
        const result = mapHttpError(error)

        expect(result.status).toBe(403)
      })

      it('maps ConflictError to 409', () => {
        const error = new ConflictError('Resource already exists')
        const result = mapHttpError(error)

        expect(result.status).toBe(409)
      })

      it('maps RateLimitExceededError to 429', () => {
        const error = new RateLimitExceededError('Too many requests', 60)
        const result = mapHttpError(error)

        expect(result.status).toBe(429)
        expect(result.retryAfter).toBe(60)
      })

      it('maps unknown errors to 500', () => {
        const error = new Error('Something went wrong')
        const result = mapHttpError(error)

        expect(result.status).toBe(500)
      })

      it('preserves error code if present', () => {
        class CustomError extends Error {
          readonly statusCode = 422
          readonly code = 'UNPROCESSABLE_ENTITY'
        }
        const error = new CustomError('Unprocessable')
        const result = mapHttpError(error)

        expect(result.status).toBe(422)
        expect(result.code).toBe('UNPROCESSABLE_ENTITY')
      })
    })

    describe('Error Response Format', () => {
      it('returns proper error response body', async () => {
        const router = createRestRouter(RestTestDO)
        const request = new Request('https://example.com.ai/items/non-existent', {
          method: 'DELETE',
        })

        const response = await router.fetch(request)

        expect(response.status).toBe(404)
        const body = await response.json()
        expect(body).toHaveProperty('error')
        expect(body.error).toHaveProperty('message')
        expect(body.error).toHaveProperty('code')
      })

      it('includes stack trace in development mode', async () => {
        const router = createRestRouter(RestTestDO, { debug: true })
        const request = new Request('https://example.com.ai/items/non-existent', {
          method: 'DELETE',
        })

        const response = await router.fetch(request)

        const body = await response.json()
        expect(body.error).toHaveProperty('stack')
      })

      it('excludes stack trace in production mode', async () => {
        const router = createRestRouter(RestTestDO, { debug: false })
        const request = new Request('https://example.com.ai/items/non-existent', {
          method: 'DELETE',
        })

        const response = await router.fetch(request)

        const body = await response.json()
        expect(body.error.stack).toBeUndefined()
      })

      it('includes request ID in error response', async () => {
        const router = createRestRouter(RestTestDO)
        const request = new Request('https://example.com.ai/items/non-existent', {
          method: 'DELETE',
          headers: { 'X-Request-ID': 'req-123' },
        })

        const response = await router.fetch(request)

        const body = await response.json()
        expect(body.error).toHaveProperty('requestId', 'req-123')
      })
    })
  })

  // ==========================================================================
  // 8. RATE LIMITING TESTS
  // ==========================================================================

  describe('Rate Limiting', () => {
    it('allows requests within rate limit', async () => {
      const router = createRestRouter(RateLimitedDO)

      for (let i = 0; i < 10; i++) {
        const request = new Request('https://example.com.ai/limited', {
          headers: { 'X-Forwarded-For': '192.168.1.1' },
        })
        const response = await router.fetch(request)
        expect(response.status).toBe(200)
      }
    })

    it('rejects requests exceeding rate limit', async () => {
      const router = createRestRouter(RateLimitedDO)

      // Make 10 requests (the limit)
      for (let i = 0; i < 10; i++) {
        await router.fetch(new Request('https://example.com.ai/limited', {
          headers: { 'X-Forwarded-For': '192.168.1.1' },
        }))
      }

      // 11th request should be rate limited
      const response = await router.fetch(new Request('https://example.com.ai/limited', {
        headers: { 'X-Forwarded-For': '192.168.1.1' },
      }))

      expect(response.status).toBe(429)
    })

    it('includes Retry-After header when rate limited', async () => {
      const router = createRestRouter(RateLimitedDO)

      // Exhaust rate limit
      for (let i = 0; i < 11; i++) {
        await router.fetch(new Request('https://example.com.ai/limited', {
          headers: { 'X-Forwarded-For': '192.168.1.1' },
        }))
      }

      const response = await router.fetch(new Request('https://example.com.ai/limited', {
        headers: { 'X-Forwarded-For': '192.168.1.1' },
      }))

      expect(response.headers.get('Retry-After')).toBeDefined()
    })

    it('includes rate limit headers in response', async () => {
      const router = createRestRouter(RateLimitedDO)
      const request = new Request('https://example.com.ai/limited', {
        headers: { 'X-Forwarded-For': '192.168.1.1' },
      })

      const response = await router.fetch(request)

      expect(response.headers.get('X-RateLimit-Limit')).toBe('10')
      expect(response.headers.get('X-RateLimit-Remaining')).toBeDefined()
      expect(response.headers.get('X-RateLimit-Reset')).toBeDefined()
    })

    it('rate limits by user when configured', async () => {
      const router = createRestRouter(RateLimitedDO)

      // User A should have their own limit
      for (let i = 0; i < 100; i++) {
        const request = new Request('https://example.com.ai/user-limited', {
          headers: { 'Authorization': 'Bearer token-user-a' },
        })
        const response = await router.fetch(request)
        expect(response.status).toBe(200)
      }

      // User A's 101st request should be limited
      const limitedResponse = await router.fetch(new Request('https://example.com.ai/user-limited', {
        headers: { 'Authorization': 'Bearer token-user-a' },
      }))
      expect(limitedResponse.status).toBe(429)

      // User B should still be able to make requests
      const userBResponse = await router.fetch(new Request('https://example.com.ai/user-limited', {
        headers: { 'Authorization': 'Bearer token-user-b' },
      }))
      expect(userBResponse.status).toBe(200)
    })

    it('applies throttling with burst limit', async () => {
      const router = createRestRouter(RateLimitedDO)

      // Make 5 rapid requests (burst limit)
      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          router.fetch(new Request('https://example.com.ai/burst-limited', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Forwarded-For': '192.168.1.1',
            },
            body: '{}',
          }))
        )
      )

      // All should succeed (within burst limit)
      responses.forEach((r) => expect(r.status).toBe(201))

      // 6th immediate request should be throttled
      const throttledResponse = await router.fetch(new Request('https://example.com.ai/burst-limited', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '192.168.1.1',
        },
        body: '{}',
      }))

      expect(throttledResponse.status).toBe(429)
    })
  })

  // ==========================================================================
  // 9. AUTHENTICATION TESTS
  // ==========================================================================

  describe('Authentication', () => {
    it('allows access to public endpoints without auth', async () => {
      const router = createRestRouter(AuthenticatedDO)
      const request = new Request('https://example.com.ai/public')

      const response = await router.fetch(request)

      expect(response.status).toBe(200)
    })

    it('requires authentication for protected endpoints', async () => {
      const router = createRestRouter(AuthenticatedDO)
      const request = new Request('https://example.com.ai/protected')

      const response = await router.fetch(request)

      expect(response.status).toBe(401)
      expect(response.headers.get('WWW-Authenticate')).toBeDefined()
    })

    it('allows access with valid authentication', async () => {
      const router = createRestRouter(AuthenticatedDO)
      const request = new Request('https://example.com.ai/protected', {
        headers: { 'Authorization': 'Bearer valid-token' },
      })

      const response = await router.fetch(request)

      expect(response.status).toBe(200)
    })

    it('enforces role-based access control', async () => {
      const router = createRestRouter(AuthenticatedDO)

      // User without admin role
      const userRequest = new Request('https://example.com.ai/admin', {
        headers: { 'Authorization': 'Bearer user-token' },
      })
      const userResponse = await router.fetch(userRequest)
      expect(userResponse.status).toBe(403)

      // User with admin role
      const adminRequest = new Request('https://example.com.ai/admin', {
        headers: { 'Authorization': 'Bearer admin-token' },
      })
      const adminResponse = await router.fetch(adminRequest)
      expect(adminResponse.status).toBe(200)
    })

    it('enforces scope-based access control', async () => {
      const router = createRestRouter(AuthenticatedDO)

      // Token without required scopes
      const limitedRequest = new Request('https://example.com.ai/scoped', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer limited-scope-token',
          'Content-Type': 'application/json',
        },
        body: '{}',
      })
      const limitedResponse = await router.fetch(limitedRequest)
      expect(limitedResponse.status).toBe(403)

      // Token with required scopes
      const fullRequest = new Request('https://example.com.ai/scoped', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer full-scope-token',
          'Content-Type': 'application/json',
        },
        body: '{}',
      })
      const fullResponse = await router.fetch(fullRequest)
      expect(fullResponse.status).toBe(200)
    })
  })

  // ==========================================================================
  // 10. CORS TESTS
  // ==========================================================================

  describe('CORS Support', () => {
    it('handles preflight OPTIONS requests', async () => {
      const router = createRestRouter(RestTestDO, {
        cors: {
          origins: ['https://example.com.ai'],
          methods: ['GET', 'POST', 'PUT', 'DELETE'],
        },
      })

      const request = new Request('https://example.com.ai/items', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://example.com.ai',
          'Access-Control-Request-Method': 'POST',
        },
      })

      const response = await router.fetch(request)

      expect(response.status).toBe(204)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com.ai')
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST')
    })

    it('includes CORS headers in actual response', async () => {
      const router = createRestRouter(RestTestDO, {
        cors: {
          origins: ['https://example.com.ai'],
        },
      })

      const request = new Request('https://example.com.ai/items?q=test', {
        headers: { 'Origin': 'https://example.com.ai' },
      })

      const response = await router.fetch(request)

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com.ai')
    })

    it('rejects requests from non-allowed origins', async () => {
      const router = createRestRouter(RestTestDO, {
        cors: {
          origins: ['https://allowed.com'],
        },
      })

      const request = new Request('https://example.com.ai/items', {
        headers: { 'Origin': 'https://not-allowed.com' },
      })

      const response = await router.fetch(request)

      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
    })

    it('supports wildcard origin', async () => {
      const router = createRestRouter(RestTestDO, {
        cors: {
          origins: ['*'],
        },
      })

      const request = new Request('https://example.com.ai/items', {
        headers: { 'Origin': 'https://any-origin.com' },
      })

      const response = await router.fetch(request)

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    })

    it('includes credentials header when configured', async () => {
      const router = createRestRouter(RestTestDO, {
        cors: {
          origins: ['https://example.com.ai'],
          credentials: true,
        },
      })

      const request = new Request('https://example.com.ai/items', {
        headers: { 'Origin': 'https://example.com.ai' },
      })

      const response = await router.fetch(request)

      expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true')
    })
  })

  // ==========================================================================
  // 11. CACHING TESTS
  // ==========================================================================

  describe('HTTP Caching', () => {
    it('sets cache headers for GET requests', async () => {
      class CacheableDO extends DO {
        static $rest = {
          getCachedData: {
            method: 'GET',
            path: '/cached',
            cache: {
              maxAge: 3600,
              staleWhileRevalidate: 60,
            },
          },
        } as const

        getCachedData(): { data: string } {
          return { data: 'cached' }
        }
      }

      const router = createRestRouter(CacheableDO)
      const request = new Request('https://example.com.ai/cached')

      const response = await router.fetch(request)

      expect(response.headers.get('Cache-Control')).toContain('max-age=3600')
      expect(response.headers.get('Cache-Control')).toContain('stale-while-revalidate=60')
    })

    it('sets no-store for mutating requests', async () => {
      const router = createRestRouter(RestTestDO)
      const request = new Request('https://example.com.ai/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      })

      const response = await router.fetch(request)

      expect(response.headers.get('Cache-Control')).toContain('no-store')
    })

    it('supports ETag for conditional requests', async () => {
      class ETagDO extends DO {
        static $rest = {
          getResource: {
            method: 'GET',
            path: '/resource/:id',
            etag: true,
          },
        } as const

        getResource(id: string): { id: string; version: number } {
          return { id, version: 1 }
        }
      }

      const router = createRestRouter(ETagDO)

      // First request gets ETag
      const response1 = await router.fetch(new Request('https://example.com.ai/resource/123'))
      const etag = response1.headers.get('ETag')
      expect(etag).toBeDefined()

      // Conditional request with matching ETag
      const response2 = await router.fetch(new Request('https://example.com.ai/resource/123', {
        headers: { 'If-None-Match': etag! },
      }))
      expect(response2.status).toBe(304) // Not Modified
    })

    it('supports Last-Modified for conditional requests', async () => {
      class LastModifiedDO extends DO {
        static $rest = {
          getResource: {
            method: 'GET',
            path: '/resource/:id',
            lastModified: true,
          },
        } as const

        getResource(id: string): { id: string; updatedAt: Date } {
          return { id, updatedAt: new Date('2024-01-15T00:00:00Z') }
        }
      }

      const router = createRestRouter(LastModifiedDO)

      // First request gets Last-Modified
      const response1 = await router.fetch(new Request('https://example.com.ai/resource/123'))
      const lastModified = response1.headers.get('Last-Modified')
      expect(lastModified).toBeDefined()

      // Conditional request with matching Last-Modified
      const response2 = await router.fetch(new Request('https://example.com.ai/resource/123', {
        headers: { 'If-Modified-Since': lastModified! },
      }))
      expect(response2.status).toBe(304) // Not Modified
    })
  })

  // ==========================================================================
  // 12. VALIDATION TESTS
  // ==========================================================================

  describe('Request Validation', () => {
    class ValidatedDO extends DO {
      static $rest = {
        createUser: {
          method: 'POST',
          path: '/users',
          schema: {
            type: 'object',
            properties: {
              name: { type: 'string', minLength: 1, maxLength: 100 },
              email: { type: 'string', format: 'email' },
              age: { type: 'number', minimum: 0, maximum: 150 },
            },
            required: ['name', 'email'],
          },
        },
      } as const

      createUser(data: { name: string; email: string; age?: number }): { id: string } {
        return { id: crypto.randomUUID() }
      }
    }

    it('validates request body against schema', async () => {
      const router = createRestRouter(ValidatedDO)
      const request = new Request('https://example.com.ai/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test', email: 'test@example.com.ai' }),
      })

      const response = await router.fetch(request)

      expect(response.status).toBe(201)
    })

    it('rejects invalid request body', async () => {
      const router = createRestRouter(ValidatedDO)
      const request = new Request('https://example.com.ai/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '' }), // Empty name, missing email
      })

      const response = await router.fetch(request)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error.errors).toBeDefined()
    })

    it('validates required fields', async () => {
      const router = createRestRouter(ValidatedDO)
      const request = new Request('https://example.com.ai/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }), // Missing required email
      })

      const response = await router.fetch(request)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error.errors.email).toBeDefined()
    })

    it('validates field formats', async () => {
      const router = createRestRouter(ValidatedDO)
      const request = new Request('https://example.com.ai/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test', email: 'not-an-email' }),
      })

      const response = await router.fetch(request)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error.errors.email).toBeDefined()
    })

    it('validates numeric ranges', async () => {
      const router = createRestRouter(ValidatedDO)
      const request = new Request('https://example.com.ai/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test', email: 'test@example.com.ai', age: 200 }),
      })

      const response = await router.fetch(request)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error.errors.age).toBeDefined()
    })
  })

  // ==========================================================================
  // 13. OPENAPI SPEC GENERATION TESTS
  // ==========================================================================

  describe('OpenAPI Spec Generation', () => {
    it('generates OpenAPI spec from DO class', () => {
      const spec = createRestRouter(RestTestDO).getOpenAPISpec()

      expect(spec).toHaveProperty('openapi', '3.0.0')
      expect(spec).toHaveProperty('info')
      expect(spec).toHaveProperty('paths')
    })

    it('includes all routes in paths', () => {
      const spec = createRestRouter(RestTestDO).getOpenAPISpec()

      expect(spec.paths).toHaveProperty('/greet/{name}')
      expect(spec.paths).toHaveProperty('/items')
      expect(spec.paths).toHaveProperty('/items/{id}')
    })

    it('documents HTTP methods correctly', () => {
      const spec = createRestRouter(RestTestDO).getOpenAPISpec()

      expect(spec.paths['/items']).toHaveProperty('get')
      expect(spec.paths['/items']).toHaveProperty('post')
      expect(spec.paths['/items/{id}']).toHaveProperty('put')
      expect(spec.paths['/items/{id}']).toHaveProperty('delete')
      expect(spec.paths['/items/{id}']).toHaveProperty('patch')
    })

    it('documents path parameters', () => {
      const spec = createRestRouter(RestTestDO).getOpenAPISpec()

      const greetOp = spec.paths['/greet/{name}'].get
      expect(greetOp.parameters).toContainEqual(
        expect.objectContaining({
          name: 'name',
          in: 'path',
          required: true,
        })
      )
    })

    it('documents query parameters', () => {
      const spec = createRestRouter(RestTestDO).getOpenAPISpec()

      const searchOp = spec.paths['/items'].get
      expect(searchOp.parameters).toContainEqual(
        expect.objectContaining({
          name: 'q',
          in: 'query',
        })
      )
    })

    it('documents request body schema', () => {
      const spec = createRestRouter(RestTestDO).getOpenAPISpec()

      const createOp = spec.paths['/items'].post
      expect(createOp.requestBody).toBeDefined()
      expect(createOp.requestBody.content['application/json']).toBeDefined()
    })

    it('documents response schemas', () => {
      const spec = createRestRouter(RestTestDO).getOpenAPISpec()

      const createOp = spec.paths['/items'].post
      expect(createOp.responses['201']).toBeDefined()
    })

    it('documents authentication requirements', () => {
      const spec = createRestRouter(AuthenticatedDO).getOpenAPISpec()

      const protectedOp = spec.paths['/protected'].get
      expect(protectedOp.security).toBeDefined()
    })

    it('documents rate limit info', () => {
      const spec = createRestRouter(RateLimitedDO).getOpenAPISpec()

      const limitedOp = spec.paths['/limited'].get
      expect(limitedOp['x-ratelimit']).toBeDefined()
      expect(limitedOp['x-ratelimit'].requests).toBe(10)
    })
  })

  // ==========================================================================
  // 14. MIDDLEWARE INTEGRATION TESTS
  // ==========================================================================

  describe('Middleware Integration', () => {
    it('executes middleware before handler', async () => {
      const middleware = vi.fn((req: Request, next: () => Promise<Response>) => {
        return next()
      })

      const router = createRestRouter(RestTestDO, { middleware: [middleware] })
      await router.fetch(new Request('https://example.com.ai/items'))

      expect(middleware).toHaveBeenCalled()
    })

    it('allows middleware to modify request', async () => {
      const middleware = async (req: Request, next: () => Promise<Response>) => {
        // Add custom header
        const modifiedReq = new Request(req, {
          headers: { ...Object.fromEntries(req.headers), 'X-Custom': 'value' },
        })
        return next()
      }

      const router = createRestRouter(RestTestDO, { middleware: [middleware] })
      const response = await router.fetch(new Request('https://example.com.ai/items'))

      expect(response.status).toBe(200)
    })

    it('allows middleware to modify response', async () => {
      const middleware = async (req: Request, next: () => Promise<Response>) => {
        const response = await next()
        return new Response(response.body, {
          status: response.status,
          headers: {
            ...Object.fromEntries(response.headers),
            'X-Processed-By': 'middleware',
          },
        })
      }

      const router = createRestRouter(RestTestDO, { middleware: [middleware] })
      const response = await router.fetch(new Request('https://example.com.ai/items'))

      expect(response.headers.get('X-Processed-By')).toBe('middleware')
    })

    it('allows middleware to short-circuit request', async () => {
      const middleware = async (req: Request, next: () => Promise<Response>) => {
        return new Response('Blocked by middleware', { status: 403 })
      }

      const router = createRestRouter(RestTestDO, { middleware: [middleware] })
      const response = await router.fetch(new Request('https://example.com.ai/items'))

      expect(response.status).toBe(403)
    })

    it('executes middleware in order', async () => {
      const order: number[] = []

      const middleware1 = async (req: Request, next: () => Promise<Response>) => {
        order.push(1)
        const response = await next()
        order.push(4)
        return response
      }

      const middleware2 = async (req: Request, next: () => Promise<Response>) => {
        order.push(2)
        const response = await next()
        order.push(3)
        return response
      }

      const router = createRestRouter(RestTestDO, { middleware: [middleware1, middleware2] })
      await router.fetch(new Request('https://example.com.ai/items'))

      expect(order).toEqual([1, 2, 3, 4])
    })
  })

  // ==========================================================================
  // 15. EDGE CASES AND SPECIAL SCENARIOS
  // ==========================================================================

  describe('Edge Cases', () => {
    it('handles routes with no matching path', async () => {
      const router = createRestRouter(RestTestDO)
      const request = new Request('https://example.com.ai/non-existent-route')

      const response = await router.fetch(request)

      expect(response.status).toBe(404)
    })

    it('handles method not allowed', async () => {
      const router = createRestRouter(RestTestDO)
      const request = new Request('https://example.com.ai/greet/World', {
        method: 'POST', // greet only accepts GET
      })

      const response = await router.fetch(request)

      expect(response.status).toBe(405) // Method Not Allowed
      expect(response.headers.get('Allow')).toContain('GET')
    })

    it('handles HEAD requests automatically', async () => {
      const router = createRestRouter(RestTestDO)
      const request = new Request('https://example.com.ai/items', {
        method: 'HEAD',
      })

      const response = await router.fetch(request)

      expect(response.status).toBe(200)
      expect(response.body).toBeNull() // HEAD should have no body
      expect(response.headers.get('Content-Length')).toBeDefined()
    })

    it('handles OPTIONS requests for CORS preflight', async () => {
      const router = createRestRouter(RestTestDO)
      const request = new Request('https://example.com.ai/items', {
        method: 'OPTIONS',
      })

      const response = await router.fetch(request)

      expect([200, 204]).toContain(response.status)
    })

    it('handles very long URLs gracefully', async () => {
      const router = createRestRouter(RestTestDO)
      const longQuery = 'a'.repeat(10000)
      const request = new Request(`https://example.com.ai/items?q=${longQuery}`)

      const response = await router.fetch(request)

      expect(response.status).toBe(414) // URI Too Long
    })

    it('handles concurrent requests to same endpoint', async () => {
      const router = createRestRouter(RestTestDO)

      const requests = Array.from({ length: 100 }, (_, i) =>
        router.fetch(new Request(`https://example.com.ai/greet/User${i}`))
      )

      const responses = await Promise.all(requests)

      responses.forEach((response) => {
        expect(response.status).toBe(200)
      })
    })

    it('handles async method that throws after delay', async () => {
      class DelayedErrorDO extends DO {
        static $rest = {
          delayedError: {
            method: 'GET',
            path: '/delayed-error',
          },
        } as const

        async delayedError(): Promise<void> {
          await new Promise((resolve) => setTimeout(resolve, 100))
          throw new Error('Delayed error')
        }
      }

      const router = createRestRouter(DelayedErrorDO)
      const request = new Request('https://example.com.ai/delayed-error')

      const response = await router.fetch(request)

      expect(response.status).toBe(500)
    })

    it('handles streaming responses', async () => {
      class StreamingDO extends DO {
        static $rest = {
          getStream: {
            method: 'GET',
            path: '/stream',
            streaming: true,
          },
        } as const

        async *getStream(): AsyncGenerator<{ chunk: number }> {
          for (let i = 0; i < 5; i++) {
            yield { chunk: i }
          }
        }
      }

      const router = createRestRouter(StreamingDO)
      const request = new Request('https://example.com.ai/stream')

      const response = await router.fetch(request)

      expect(response.status).toBe(200)
      expect(response.headers.get('Transfer-Encoding')).toBe('chunked')
    })

    it('handles binary response data', async () => {
      class BinaryDO extends DO {
        static $rest = {
          getImage: {
            method: 'GET',
            path: '/image',
            produces: ['image/png'],
          },
        } as const

        getImage(): ArrayBuffer {
          return new ArrayBuffer(100)
        }
      }

      const router = createRestRouter(BinaryDO)
      const request = new Request('https://example.com.ai/image')

      const response = await router.fetch(request)

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('image/png')
    })
  })

  // ==========================================================================
  // 16. TYPE DEFINITIONS TESTS
  // ==========================================================================

  describe('Type Definitions', () => {
    it('RestRouteConfig has required properties', () => {
      const config: RestRouteConfig = {
        methodName: 'test',
        httpMethod: 'GET',
        path: '/test',
      }

      expect(config.methodName).toBe('test')
      expect(config.httpMethod).toBe('GET')
      expect(config.path).toBe('/test')
    })

    it('RestMethodConfig supports all HTTP methods', () => {
      const methods: RestMethodConfig['method'][] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']

      methods.forEach((method) => {
        expect(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']).toContain(method)
      })
    })

    it('RestRateLimitConfig has expected shape', () => {
      const config: RestRateLimitConfig = {
        requests: 100,
        windowMs: 60000,
        keyBy: 'ip',
      }

      expect(config.requests).toBe(100)
      expect(config.windowMs).toBe(60000)
      expect(config.keyBy).toBe('ip')
    })

    it('RestThrottleConfig has expected shape', () => {
      const config: RestThrottleConfig = {
        burstLimit: 10,
        sustainedRate: 1,
        windowMs: 1000,
      }

      expect(config.burstLimit).toBe(10)
      expect(config.sustainedRate).toBe(1)
    })

    it('ContentType includes standard MIME types', () => {
      const types: ContentType[] = [
        'application/json',
        'application/xml',
        'text/html',
        'text/csv',
        'multipart/form-data',
        'application/x-www-form-urlencoded',
      ]

      expect(types.length).toBe(6)
    })
  })
})
