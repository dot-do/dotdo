/**
 * API Test Helpers Tests
 *
 * RED phase of TDD: These tests define the expected behavior of
 * the TestClient and TestResponse utilities for API route testing.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { createTestClient, type TestClient, type TestResponse } from '../api'

// ============================================================================
// Test App Setup
// ============================================================================

function createTestApp(): Hono {
  const app = new Hono()

  // Basic routes for testing
  app.get('/health', (c) => c.json({ status: 'ok' }))

  app.get('/echo', (c) => {
    const name = c.req.query('name')
    return c.json({ name })
  })

  app.post('/echo', async (c) => {
    const body = await c.req.json()
    return c.json(body, 201)
  })

  app.put('/items/:id', async (c) => {
    const id = c.req.param('id')
    const body = await c.req.json()
    return c.json({ id, ...body })
  })

  app.patch('/items/:id', async (c) => {
    const id = c.req.param('id')
    const body = await c.req.json()
    return c.json({ id, patched: true, ...body })
  })

  app.delete('/items/:id', (c) => {
    return c.body(null, 204)
  })

  // Auth-protected route
  app.get('/protected', (c) => {
    const auth = c.req.header('Authorization')
    if (!auth) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    return c.json({ message: 'protected', token: auth })
  })

  // Route that checks X-User-ID header
  app.get('/user-context', (c) => {
    const userId = c.req.header('X-User-ID')
    return c.json({ userId })
  })

  // Error routes
  app.get('/not-found', (c) => c.json({ error: 'Not found' }, 404))
  app.get('/server-error', (c) => c.json({ error: 'Internal error' }, 500))

  // Route with various content types
  app.get('/text', (c) => c.text('Hello World'))
  app.get('/html', (c) => c.html('<h1>Hello</h1>'))

  return app
}

// ============================================================================
// createTestClient Tests
// ============================================================================

describe('createTestClient', () => {
  let app: Hono
  let client: TestClient

  beforeEach(() => {
    app = createTestApp()
    client = createTestClient(app)
  })

  describe('basic client creation', () => {
    it('creates a test client from a Hono app', () => {
      expect(client).toBeDefined()
      expect(client.get).toBeTypeOf('function')
      expect(client.post).toBeTypeOf('function')
      expect(client.put).toBeTypeOf('function')
      expect(client.patch).toBeTypeOf('function')
      expect(client.delete).toBeTypeOf('function')
    })

    it('has auth helper methods', () => {
      expect(client.withAuth).toBeTypeOf('function')
      expect(client.asUser).toBeTypeOf('function')
    })
  })

  describe('GET requests', () => {
    it('makes GET requests and returns typed response', async () => {
      const response = await client.get<{ status: string }>('/health')

      expect(response.status).toBe(200)
      expect(response.body.status).toBe('ok')
    })

    it('handles query parameters', async () => {
      const response = await client.get<{ name: string }>('/echo?name=test')

      expect(response.status).toBe(200)
      expect(response.body.name).toBe('test')
    })

    it('returns response headers', async () => {
      const response = await client.get('/health')

      expect(response.headers).toBeInstanceOf(Headers)
      expect(response.headers.get('content-type')).toContain('application/json')
    })

    it('provides raw Response object', async () => {
      const response = await client.get('/health')

      expect(response.raw).toBeInstanceOf(Response)
    })
  })

  describe('POST requests', () => {
    it('makes POST requests with JSON body', async () => {
      const response = await client.post<{ message: string }>('/echo', { message: 'hello' })

      expect(response.status).toBe(201)
      expect(response.body.message).toBe('hello')
    })

    it('serializes body as JSON', async () => {
      const complexBody = {
        nested: { data: [1, 2, 3] },
        string: 'value',
      }
      const response = await client.post('/echo', complexBody)

      expect(response.body).toEqual(complexBody)
    })
  })

  describe('PUT requests', () => {
    it('makes PUT requests with JSON body', async () => {
      const response = await client.put<{ id: string; name: string }>('/items/123', {
        name: 'updated',
      })

      expect(response.status).toBe(200)
      expect(response.body.id).toBe('123')
      expect(response.body.name).toBe('updated')
    })
  })

  describe('PATCH requests', () => {
    it('makes PATCH requests with JSON body', async () => {
      const response = await client.patch<{ id: string; patched: boolean }>('/items/456', {
        field: 'value',
      })

      expect(response.status).toBe(200)
      expect(response.body.id).toBe('456')
      expect(response.body.patched).toBe(true)
    })
  })

  describe('DELETE requests', () => {
    it('makes DELETE requests', async () => {
      const response = await client.delete('/items/789')

      expect(response.status).toBe(204)
    })

    it('handles empty response body for 204', async () => {
      const response = await client.delete('/items/789')

      // Body should be null or empty for 204
      expect(response.body).toBeNull()
    })
  })
})

// ============================================================================
// Auth Helpers Tests
// ============================================================================

describe('TestClient auth helpers', () => {
  let app: Hono
  let client: TestClient

  beforeEach(() => {
    app = createTestApp()
    client = createTestClient(app)
  })

  describe('withAuth(token)', () => {
    it('returns a new client with Authorization header set', async () => {
      const authClient = client.withAuth('my-token')

      const response = await authClient.get<{ token: string }>('/protected')

      expect(response.status).toBe(200)
      expect(response.body.token).toBe('Bearer my-token')
    })

    it('adds Bearer prefix to token', async () => {
      const authClient = client.withAuth('raw-token')

      const response = await authClient.get<{ token: string }>('/protected')

      expect(response.body.token).toBe('Bearer raw-token')
    })

    it('does not modify the original client', async () => {
      const authClient = client.withAuth('token')

      // Original client should not have auth
      const response = await client.get<{ error: string }>('/protected')
      expect(response.status).toBe(401)

      // Auth client should have auth
      const authResponse = await authClient.get('/protected')
      expect(authResponse.status).toBe(200)
    })

    it('chains multiple withAuth calls (last wins)', async () => {
      const client1 = client.withAuth('token1')
      const client2 = client1.withAuth('token2')

      const response = await client2.get<{ token: string }>('/protected')

      expect(response.body.token).toBe('Bearer token2')
    })
  })

  describe('asUser(userId)', () => {
    it('returns a new client with X-User-ID header set', async () => {
      const userClient = client.asUser('user-123')

      const response = await userClient.get<{ userId: string }>('/user-context')

      expect(response.status).toBe(200)
      expect(response.body.userId).toBe('user-123')
    })

    it('does not modify the original client', async () => {
      const userClient = client.asUser('user-456')

      // Original client should not have user header
      const response = await client.get<{ userId: string | undefined }>('/user-context')
      expect(response.body.userId).toBeUndefined()

      // User client should have user header
      const userResponse = await userClient.get<{ userId: string }>('/user-context')
      expect(userResponse.body.userId).toBe('user-456')
    })

    it('can be combined with withAuth', async () => {
      const fullClient = client.withAuth('token').asUser('user-789')

      const protectedResponse = await fullClient.get<{ token: string }>('/protected')
      expect(protectedResponse.status).toBe(200)

      const userResponse = await fullClient.get<{ userId: string }>('/user-context')
      expect(userResponse.body.userId).toBe('user-789')
    })
  })
})

// ============================================================================
// TestResponse Assertion Helpers Tests
// ============================================================================

describe('TestResponse assertion helpers', () => {
  let app: Hono
  let client: TestClient

  beforeEach(() => {
    app = createTestApp()
    client = createTestClient(app)
  })

  describe('expectStatus()', () => {
    it('passes when status matches', async () => {
      const response = await client.get('/health')

      // Should not throw
      expect(() => response.expectStatus(200)).not.toThrow()
    })

    it('throws when status does not match', async () => {
      const response = await client.get('/not-found')

      expect(() => response.expectStatus(200)).toThrow()
    })

    it('returns this for chaining', async () => {
      const response = await client.get('/health')

      const result = response.expectStatus(200)
      expect(result).toBe(response)
    })
  })

  describe('expectJson()', () => {
    it('passes when response is JSON', async () => {
      const response = await client.get('/health')

      expect(() => response.expectJson()).not.toThrow()
    })

    it('throws when response is not JSON', async () => {
      const response = await client.get('/text')

      expect(() => response.expectJson()).toThrow()
    })

    it('returns this for chaining', async () => {
      const response = await client.get('/health')

      const result = response.expectJson()
      expect(result).toBe(response)
    })
  })

  describe('expectBodyToMatch()', () => {
    it('passes when body matches partial object', async () => {
      const response = await client.get<{ status: string }>('/health')

      expect(() => response.expectBodyToMatch({ status: 'ok' })).not.toThrow()
    })

    it('passes for partial match with extra fields', async () => {
      const response = await client.post<{ message: string; extra: number }>('/echo', {
        message: 'hello',
        extra: 42,
      })

      // Should pass even though we only check message
      expect(() => response.expectBodyToMatch({ message: 'hello' })).not.toThrow()
    })

    it('throws when body does not match', async () => {
      const response = await client.get<{ status: string }>('/health')

      expect(() => response.expectBodyToMatch({ status: 'not-ok' })).toThrow()
    })

    it('returns this for chaining', async () => {
      const response = await client.get<{ status: string }>('/health')

      const result = response.expectBodyToMatch({ status: 'ok' })
      expect(result).toBe(response)
    })
  })

  describe('chaining assertions', () => {
    it('allows chaining multiple assertions', async () => {
      const response = await client.get<{ status: string }>('/health')

      // Should be able to chain all assertions
      expect(() =>
        response.expectStatus(200).expectJson().expectBodyToMatch({ status: 'ok' })
      ).not.toThrow()
    })

    it('short-circuits on first failure', async () => {
      const response = await client.get('/health')

      // First assertion fails, chain should stop
      expect(() =>
        response
          .expectStatus(404) // This should throw
          .expectJson()
      ).toThrow()
    })
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('TestClient error handling', () => {
  let app: Hono
  let client: TestClient

  beforeEach(() => {
    app = createTestApp()
    client = createTestClient(app)
  })

  it('handles 404 responses', async () => {
    const response = await client.get<{ error: string }>('/not-found')

    expect(response.status).toBe(404)
    expect(response.body.error).toBe('Not found')
  })

  it('handles 500 responses', async () => {
    const response = await client.get<{ error: string }>('/server-error')

    expect(response.status).toBe(500)
    expect(response.body.error).toBe('Internal error')
  })

  it('handles 401 responses', async () => {
    const response = await client.get<{ error: string }>('/protected')

    expect(response.status).toBe(401)
    expect(response.body.error).toBe('Unauthorized')
  })
})

// ============================================================================
// Type Safety Tests
// ============================================================================

describe('TestResponse type safety', () => {
  let app: Hono
  let client: TestClient

  beforeEach(() => {
    app = createTestApp()
    client = createTestClient(app)
  })

  it('preserves body type through generics', async () => {
    interface HealthResponse {
      status: string
    }

    const response = await client.get<HealthResponse>('/health')

    // TypeScript should know response.body.status is a string
    const status: string = response.body.status
    expect(status).toBe('ok')
  })

  it('defaults to unknown body type', async () => {
    const response = await client.get('/health')

    // Body should be typed as unknown by default
    expect(response.body).toBeDefined()
  })
})
