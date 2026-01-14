import { describe, test, expect, beforeEach } from 'vitest'
import { APIGateway, Router, MiddlewareChain, RateLimiter, CORSHandler, AuthMiddleware, ResponseBuilder } from './index'
import type { APIRequest, APIResponse, Middleware, RateLimitConfig, CORSConfig, AuthConfig } from './types'

describe('APIGateway', () => {
  let gateway: APIGateway

  beforeEach(() => {
    gateway = new APIGateway()
  })

  // ============================================
  // Basic Routing Tests
  // ============================================

  describe('basic routing', () => {
    test('handles GET request', async () => {
      gateway.route('GET', '/users', () => ({
        status: 200,
        headers: {},
        body: { users: [] }
      }))

      const response = await gateway.handle({
        method: 'GET',
        path: '/users',
        headers: {},
        params: {},
        query: {}
      })

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ users: [] })
    })

    test('handles POST request', async () => {
      gateway.route('POST', '/users', (req) => ({
        status: 201,
        headers: {},
        body: { created: req.body }
      }))

      const response = await gateway.handle({
        method: 'POST',
        path: '/users',
        headers: {},
        body: { name: 'John' },
        params: {},
        query: {}
      })

      expect(response.status).toBe(201)
      expect(response.body).toEqual({ created: { name: 'John' } })
    })

    test('handles PUT request', async () => {
      gateway.route('PUT', '/users/1', (req) => ({
        status: 200,
        headers: {},
        body: { updated: req.body }
      }))

      const response = await gateway.handle({
        method: 'PUT',
        path: '/users/1',
        headers: {},
        body: { name: 'Jane' },
        params: {},
        query: {}
      })

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ updated: { name: 'Jane' } })
    })

    test('handles DELETE request', async () => {
      gateway.route('DELETE', '/users/1', () => ({
        status: 204,
        headers: {},
        body: undefined
      }))

      const response = await gateway.handle({
        method: 'DELETE',
        path: '/users/1',
        headers: {},
        params: {},
        query: {}
      })

      expect(response.status).toBe(204)
    })

    test('returns 404 for unmatched route', async () => {
      const response = await gateway.handle({
        method: 'GET',
        path: '/nonexistent',
        headers: {},
        params: {},
        query: {}
      })

      expect(response.status).toBe(404)
      expect(response.body).toEqual({ error: 'Not Found' })
    })

    test('returns 404 for wrong method on existing path', async () => {
      gateway.route('GET', '/users', () => ({
        status: 200,
        headers: {},
        body: []
      }))

      const response = await gateway.handle({
        method: 'POST',
        path: '/users',
        headers: {},
        params: {},
        query: {}
      })

      expect(response.status).toBe(404)
    })
  })

  // ============================================
  // Path Parameters Tests
  // ============================================

  describe('path parameters', () => {
    test('extracts single path parameter', async () => {
      gateway.route('GET', '/users/:id', (req) => ({
        status: 200,
        headers: {},
        body: { id: req.params.id }
      }))

      const response = await gateway.handle({
        method: 'GET',
        path: '/users/123',
        headers: {},
        params: {},
        query: {}
      })

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ id: '123' })
    })

    test('extracts multiple path parameters', async () => {
      gateway.route('GET', '/users/:userId/posts/:postId', (req) => ({
        status: 200,
        headers: {},
        body: { userId: req.params.userId, postId: req.params.postId }
      }))

      const response = await gateway.handle({
        method: 'GET',
        path: '/users/42/posts/99',
        headers: {},
        params: {},
        query: {}
      })

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ userId: '42', postId: '99' })
    })

    test('handles wildcard routes', async () => {
      gateway.route('GET', '/files/*', (req) => ({
        status: 200,
        headers: {},
        body: { path: req.params['*'] }
      }))

      const response = await gateway.handle({
        method: 'GET',
        path: '/files/documents/reports/2024/q1.pdf',
        headers: {},
        params: {},
        query: {}
      })

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ path: 'documents/reports/2024/q1.pdf' })
    })

    test('prefers exact match over parameter match', async () => {
      gateway.route('GET', '/users/me', () => ({
        status: 200,
        headers: {},
        body: { type: 'exact' }
      }))

      gateway.route('GET', '/users/:id', () => ({
        status: 200,
        headers: {},
        body: { type: 'param' }
      }))

      const response = await gateway.handle({
        method: 'GET',
        path: '/users/me',
        headers: {},
        params: {},
        query: {}
      })

      expect(response.body).toEqual({ type: 'exact' })
    })
  })

  // ============================================
  // Query String Tests
  // ============================================

  describe('query string parsing', () => {
    test('parses query parameters from path', async () => {
      gateway.route('GET', '/search', (req) => ({
        status: 200,
        headers: {},
        body: { query: req.query }
      }))

      const response = await gateway.handle({
        method: 'GET',
        path: '/search?q=hello&limit=10',
        headers: {},
        params: {},
        query: {}
      })

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ query: { q: 'hello', limit: '10' } })
    })

    test('handles URL encoded query values', async () => {
      gateway.route('GET', '/search', (req) => ({
        status: 200,
        headers: {},
        body: { term: req.query.q }
      }))

      const response = await gateway.handle({
        method: 'GET',
        path: '/search?q=hello%20world',
        headers: {},
        params: {},
        query: {}
      })

      expect(response.body).toEqual({ term: 'hello world' })
    })

    test('handles empty query string', async () => {
      gateway.route('GET', '/items', (req) => ({
        status: 200,
        headers: {},
        body: { query: req.query }
      }))

      const response = await gateway.handle({
        method: 'GET',
        path: '/items',
        headers: {},
        params: {},
        query: {}
      })

      expect(response.body).toEqual({ query: {} })
    })
  })

  // ============================================
  // Middleware Tests
  // ============================================

  describe('middleware execution', () => {
    test('executes global middleware before handler', async () => {
      const order: string[] = []

      gateway.use({
        before: (req) => {
          order.push('middleware')
          return req
        }
      })

      gateway.route('GET', '/test', () => {
        order.push('handler')
        return { status: 200, headers: {}, body: {} }
      })

      await gateway.handle({
        method: 'GET',
        path: '/test',
        headers: {},
        params: {},
        query: {}
      })

      expect(order).toEqual(['middleware', 'handler'])
    })

    test('executes global middleware after handler', async () => {
      const order: string[] = []

      gateway.use({
        after: (req, res) => {
          order.push('after-middleware')
          return res
        }
      })

      gateway.route('GET', '/test', () => {
        order.push('handler')
        return { status: 200, headers: {}, body: {} }
      })

      await gateway.handle({
        method: 'GET',
        path: '/test',
        headers: {},
        params: {},
        query: {}
      })

      expect(order).toEqual(['handler', 'after-middleware'])
    })

    test('middleware can modify request', async () => {
      gateway.use({
        before: (req) => ({
          ...req,
          context: { ...req.context, user: 'test-user' }
        })
      })

      gateway.route('GET', '/whoami', (req) => ({
        status: 200,
        headers: {},
        body: { user: req.context?.user }
      }))

      const response = await gateway.handle({
        method: 'GET',
        path: '/whoami',
        headers: {},
        params: {},
        query: {}
      })

      expect(response.body).toEqual({ user: 'test-user' })
    })

    test('middleware can modify response', async () => {
      gateway.use({
        after: (req, res) => ({
          ...res,
          headers: { ...res.headers, 'X-Custom': 'added' }
        })
      })

      gateway.route('GET', '/test', () => ({
        status: 200,
        headers: {},
        body: {}
      }))

      const response = await gateway.handle({
        method: 'GET',
        path: '/test',
        headers: {},
        params: {},
        query: {}
      })

      expect(response.headers['X-Custom']).toBe('added')
    })

    test('middleware can short-circuit with response', async () => {
      gateway.use({
        before: () => ({
          status: 401,
          headers: {},
          body: { error: 'Unauthorized' }
        })
      })

      gateway.route('GET', '/protected', () => ({
        status: 200,
        headers: {},
        body: { secret: 'data' }
      }))

      const response = await gateway.handle({
        method: 'GET',
        path: '/protected',
        headers: {},
        params: {},
        query: {}
      })

      expect(response.status).toBe(401)
      expect(response.body).toEqual({ error: 'Unauthorized' })
    })

    test('executes multiple middleware in order', async () => {
      const order: string[] = []

      gateway.use({
        name: 'first',
        before: (req) => {
          order.push('first-before')
          return req
        },
        after: (req, res) => {
          order.push('first-after')
          return res
        }
      })

      gateway.use({
        name: 'second',
        before: (req) => {
          order.push('second-before')
          return req
        },
        after: (req, res) => {
          order.push('second-after')
          return res
        }
      })

      gateway.route('GET', '/test', () => {
        order.push('handler')
        return { status: 200, headers: {}, body: {} }
      })

      await gateway.handle({
        method: 'GET',
        path: '/test',
        headers: {},
        params: {},
        query: {}
      })

      expect(order).toEqual([
        'first-before',
        'second-before',
        'handler',
        'second-after',
        'first-after'
      ])
    })

    test('route-specific middleware executes after global', async () => {
      const order: string[] = []

      gateway.use({
        before: (req) => {
          order.push('global')
          return req
        }
      })

      gateway.route('GET', '/test', () => {
        order.push('handler')
        return { status: 200, headers: {}, body: {} }
      }, [{
        before: (req) => {
          order.push('route')
          return req
        }
      }])

      await gateway.handle({
        method: 'GET',
        path: '/test',
        headers: {},
        params: {},
        query: {}
      })

      expect(order).toEqual(['global', 'route', 'handler'])
    })
  })

  // ============================================
  // Rate Limiting Tests
  // ============================================

  describe('rate limiting', () => {
    test('allows requests within limit', async () => {
      gateway.route('GET', '/api', () => ({
        status: 200,
        headers: {},
        body: { ok: true }
      }), [], { requests: 3, window: 1000, key: 'ip' })

      const request: APIRequest = {
        method: 'GET',
        path: '/api',
        headers: { 'X-Forwarded-For': '1.2.3.4' },
        params: {},
        query: {}
      }

      const r1 = await gateway.handle(request)
      const r2 = await gateway.handle(request)
      const r3 = await gateway.handle(request)

      expect(r1.status).toBe(200)
      expect(r2.status).toBe(200)
      expect(r3.status).toBe(200)
    })

    test('blocks requests exceeding limit', async () => {
      gateway.route('GET', '/api', () => ({
        status: 200,
        headers: {},
        body: { ok: true }
      }), [], { requests: 2, window: 10000, key: 'ip' })

      const request: APIRequest = {
        method: 'GET',
        path: '/api',
        headers: { 'X-Forwarded-For': '1.2.3.4' },
        params: {},
        query: {}
      }

      await gateway.handle(request)
      await gateway.handle(request)
      const r3 = await gateway.handle(request)

      expect(r3.status).toBe(429)
      expect(r3.body).toEqual({ error: 'Too Many Requests' })
    })

    test('rate limits by custom key', async () => {
      gateway.route('GET', '/api', () => ({
        status: 200,
        headers: {},
        body: { ok: true }
      }), [], { requests: 1, window: 10000, key: (req) => req.headers['X-API-Key'] || 'anonymous' })

      const request1: APIRequest = {
        method: 'GET',
        path: '/api',
        headers: { 'X-API-Key': 'key1' },
        params: {},
        query: {}
      }

      const request2: APIRequest = {
        method: 'GET',
        path: '/api',
        headers: { 'X-API-Key': 'key2' },
        params: {},
        query: {}
      }

      const r1 = await gateway.handle(request1)
      const r2 = await gateway.handle(request2)

      expect(r1.status).toBe(200)
      expect(r2.status).toBe(200)
    })

    test('includes rate limit headers in response', async () => {
      gateway.route('GET', '/api', () => ({
        status: 200,
        headers: {},
        body: {}
      }), [], { requests: 5, window: 60000, key: 'ip' })

      const response = await gateway.handle({
        method: 'GET',
        path: '/api',
        headers: { 'X-Forwarded-For': '1.2.3.4' },
        params: {},
        query: {}
      })

      expect(response.headers['X-RateLimit-Limit']).toBe('5')
      expect(response.headers['X-RateLimit-Remaining']).toBe('4')
    })
  })

  // ============================================
  // CORS Tests
  // ============================================

  describe('CORS handling', () => {
    test('handles preflight OPTIONS request', async () => {
      const corsGateway = new APIGateway({
        cors: {
          origins: ['https://example.com'],
          methods: ['GET', 'POST'],
          headers: ['Content-Type']
        }
      })

      corsGateway.route('GET', '/api', () => ({
        status: 200,
        headers: {},
        body: {}
      }))

      const response = await corsGateway.handle({
        method: 'OPTIONS',
        path: '/api',
        headers: { 'Origin': 'https://example.com' },
        params: {},
        query: {}
      })

      expect(response.status).toBe(204)
      expect(response.headers['Access-Control-Allow-Origin']).toBe('https://example.com')
      expect(response.headers['Access-Control-Allow-Methods']).toBe('GET, POST')
      expect(response.headers['Access-Control-Allow-Headers']).toBe('Content-Type')
    })

    test('adds CORS headers to response', async () => {
      const corsGateway = new APIGateway({
        cors: {
          origins: '*',
          methods: ['GET'],
          headers: []
        }
      })

      corsGateway.route('GET', '/api', () => ({
        status: 200,
        headers: {},
        body: { data: 'test' }
      }))

      const response = await corsGateway.handle({
        method: 'GET',
        path: '/api',
        headers: { 'Origin': 'https://any.com' },
        params: {},
        query: {}
      })

      expect(response.headers['Access-Control-Allow-Origin']).toBe('*')
    })

    test('rejects disallowed origins', async () => {
      const corsGateway = new APIGateway({
        cors: {
          origins: ['https://allowed.com'],
          methods: ['GET'],
          headers: []
        }
      })

      corsGateway.route('GET', '/api', () => ({
        status: 200,
        headers: {},
        body: {}
      }))

      const response = await corsGateway.handle({
        method: 'OPTIONS',
        path: '/api',
        headers: { 'Origin': 'https://malicious.com' },
        params: {},
        query: {}
      })

      expect(response.headers['Access-Control-Allow-Origin']).toBeUndefined()
    })

    test('includes credentials header when configured', async () => {
      const corsGateway = new APIGateway({
        cors: {
          origins: ['https://example.com'],
          methods: ['GET'],
          headers: [],
          credentials: true
        }
      })

      corsGateway.route('GET', '/api', () => ({
        status: 200,
        headers: {},
        body: {}
      }))

      const response = await corsGateway.handle({
        method: 'GET',
        path: '/api',
        headers: { 'Origin': 'https://example.com' },
        params: {},
        query: {}
      })

      expect(response.headers['Access-Control-Allow-Credentials']).toBe('true')
    })
  })

  // ============================================
  // Authentication Tests
  // ============================================

  describe('JWT authentication', () => {
    test('allows valid JWT token', async () => {
      const authGateway = new APIGateway({
        auth: {
          type: 'jwt',
          validate: (token) => token === 'valid-jwt-token'
        }
      })

      authGateway.route('GET', '/protected', () => ({
        status: 200,
        headers: {},
        body: { secret: 'data' }
      }))

      const response = await authGateway.handle({
        method: 'GET',
        path: '/protected',
        headers: { 'Authorization': 'Bearer valid-jwt-token' },
        params: {},
        query: {}
      })

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ secret: 'data' })
    })

    test('rejects invalid JWT token', async () => {
      const authGateway = new APIGateway({
        auth: {
          type: 'jwt',
          validate: (token) => token === 'valid-jwt-token'
        }
      })

      authGateway.route('GET', '/protected', () => ({
        status: 200,
        headers: {},
        body: { secret: 'data' }
      }))

      const response = await authGateway.handle({
        method: 'GET',
        path: '/protected',
        headers: { 'Authorization': 'Bearer invalid-token' },
        params: {},
        query: {}
      })

      expect(response.status).toBe(401)
      expect(response.body).toEqual({ error: 'Unauthorized' })
    })

    test('rejects missing token', async () => {
      const authGateway = new APIGateway({
        auth: {
          type: 'jwt',
          validate: () => true
        }
      })

      authGateway.route('GET', '/protected', () => ({
        status: 200,
        headers: {},
        body: {}
      }))

      const response = await authGateway.handle({
        method: 'GET',
        path: '/protected',
        headers: {},
        params: {},
        query: {}
      })

      expect(response.status).toBe(401)
    })

    test('attaches user to request context', async () => {
      const authGateway = new APIGateway({
        auth: {
          type: 'jwt',
          validate: (token) => ({
            valid: true,
            user: { id: '123', role: 'admin' }
          })
        }
      })

      authGateway.route('GET', '/me', (req) => ({
        status: 200,
        headers: {},
        body: { user: req.context?.user }
      }))

      const response = await authGateway.handle({
        method: 'GET',
        path: '/me',
        headers: { 'Authorization': 'Bearer any-token' },
        params: {},
        query: {}
      })

      expect(response.body).toEqual({ user: { id: '123', role: 'admin' } })
    })
  })

  describe('API key authentication', () => {
    test('allows valid API key', async () => {
      const authGateway = new APIGateway({
        auth: {
          type: 'api-key',
          validate: (key) => key === 'secret-api-key',
          header: 'X-API-Key'
        }
      })

      authGateway.route('GET', '/data', () => ({
        status: 200,
        headers: {},
        body: { data: 'secret' }
      }))

      const response = await authGateway.handle({
        method: 'GET',
        path: '/data',
        headers: { 'X-API-Key': 'secret-api-key' },
        params: {},
        query: {}
      })

      expect(response.status).toBe(200)
    })

    test('rejects invalid API key', async () => {
      const authGateway = new APIGateway({
        auth: {
          type: 'api-key',
          validate: (key) => key === 'secret-api-key',
          header: 'X-API-Key'
        }
      })

      authGateway.route('GET', '/data', () => ({
        status: 200,
        headers: {},
        body: {}
      }))

      const response = await authGateway.handle({
        method: 'GET',
        path: '/data',
        headers: { 'X-API-Key': 'wrong-key' },
        params: {},
        query: {}
      })

      expect(response.status).toBe(401)
    })
  })

  // ============================================
  // Error Handling Tests
  // ============================================

  describe('error handling', () => {
    test('returns 500 for handler errors', async () => {
      gateway.route('GET', '/crash', () => {
        throw new Error('Something went wrong')
      })

      const response = await gateway.handle({
        method: 'GET',
        path: '/crash',
        headers: {},
        params: {},
        query: {}
      })

      expect(response.status).toBe(500)
      expect(response.body).toEqual({ error: 'Internal Server Error' })
    })

    test('returns 500 for async handler errors', async () => {
      gateway.route('GET', '/async-crash', async () => {
        throw new Error('Async failure')
      })

      const response = await gateway.handle({
        method: 'GET',
        path: '/async-crash',
        headers: {},
        params: {},
        query: {}
      })

      expect(response.status).toBe(500)
    })

    test('returns 500 for middleware errors', async () => {
      gateway.use({
        before: () => {
          throw new Error('Middleware failed')
        }
      })

      gateway.route('GET', '/test', () => ({
        status: 200,
        headers: {},
        body: {}
      }))

      const response = await gateway.handle({
        method: 'GET',
        path: '/test',
        headers: {},
        params: {},
        query: {}
      })

      expect(response.status).toBe(500)
    })
  })

  // ============================================
  // Route Groups Tests
  // ============================================

  describe('route groups', () => {
    test('adds prefix to grouped routes', async () => {
      gateway.group('/api/v1', [
        {
          method: 'GET',
          path: '/users',
          handler: () => ({ status: 200, headers: {}, body: { version: 'v1' } })
        },
        {
          method: 'GET',
          path: '/posts',
          handler: () => ({ status: 200, headers: {}, body: { posts: [] } })
        }
      ])

      const r1 = await gateway.handle({
        method: 'GET',
        path: '/api/v1/users',
        headers: {},
        params: {},
        query: {}
      })

      const r2 = await gateway.handle({
        method: 'GET',
        path: '/api/v1/posts',
        headers: {},
        params: {},
        query: {}
      })

      expect(r1.status).toBe(200)
      expect(r1.body).toEqual({ version: 'v1' })
      expect(r2.status).toBe(200)
    })

    test('applies group middleware to all routes', async () => {
      const order: string[] = []

      gateway.group('/admin', [
        {
          method: 'GET',
          path: '/dashboard',
          handler: () => {
            order.push('handler')
            return { status: 200, headers: {}, body: {} }
          }
        }
      ], [{
        before: (req) => {
          order.push('group-middleware')
          return req
        }
      }])

      await gateway.handle({
        method: 'GET',
        path: '/admin/dashboard',
        headers: {},
        params: {},
        query: {}
      })

      expect(order).toEqual(['group-middleware', 'handler'])
    })

    test('nested route groups', async () => {
      gateway.group('/api', [
        {
          method: 'GET',
          path: '/health',
          handler: () => ({ status: 200, headers: {}, body: { ok: true } })
        }
      ])

      gateway.group('/api/v1', [
        {
          method: 'GET',
          path: '/users',
          handler: () => ({ status: 200, headers: {}, body: [] })
        }
      ])

      const r1 = await gateway.handle({
        method: 'GET',
        path: '/api/health',
        headers: {},
        params: {},
        query: {}
      })

      const r2 = await gateway.handle({
        method: 'GET',
        path: '/api/v1/users',
        headers: {},
        params: {},
        query: {}
      })

      expect(r1.status).toBe(200)
      expect(r2.status).toBe(200)
    })
  })

  // ============================================
  // Response Builder Tests
  // ============================================

  describe('ResponseBuilder', () => {
    test('builds response with status', () => {
      const response = new ResponseBuilder().status(201).build()
      expect(response.status).toBe(201)
    })

    test('builds response with headers', () => {
      const response = new ResponseBuilder()
        .header('Content-Type', 'application/json')
        .header('X-Custom', 'value')
        .build()

      expect(response.headers['Content-Type']).toBe('application/json')
      expect(response.headers['X-Custom']).toBe('value')
    })

    test('builds response with JSON body', () => {
      const response = new ResponseBuilder()
        .json({ name: 'test' })
        .build()

      expect(response.body).toEqual({ name: 'test' })
      expect(response.headers['Content-Type']).toBe('application/json')
    })

    test('builds response with text body', () => {
      const response = new ResponseBuilder()
        .text('Hello World')
        .build()

      expect(response.body).toBe('Hello World')
      expect(response.headers['Content-Type']).toBe('text/plain')
    })

    test('provides shorthand methods', () => {
      expect(ResponseBuilder.ok({ data: 'test' }).status).toBe(200)
      expect(ResponseBuilder.created({ id: 1 }).status).toBe(201)
      expect(ResponseBuilder.noContent().status).toBe(204)
      expect(ResponseBuilder.badRequest('Invalid').status).toBe(400)
      expect(ResponseBuilder.unauthorized().status).toBe(401)
      expect(ResponseBuilder.forbidden().status).toBe(403)
      expect(ResponseBuilder.notFound().status).toBe(404)
      expect(ResponseBuilder.serverError().status).toBe(500)
    })
  })
})

// ============================================
// Router Tests
// ============================================

describe('Router', () => {
  test('matches exact paths', () => {
    const router = new Router()
    router.add('GET', '/users', {} as any)

    const match = router.match('GET', '/users')
    expect(match).not.toBeNull()
    expect(match!.params).toEqual({})
  })

  test('does not match different paths', () => {
    const router = new Router()
    router.add('GET', '/users', {} as any)

    const match = router.match('GET', '/posts')
    expect(match).toBeNull()
  })

  test('extracts path parameters', () => {
    const router = new Router()
    router.add('GET', '/users/:id', {} as any)

    const match = router.match('GET', '/users/123')
    expect(match).not.toBeNull()
    expect(match!.params).toEqual({ id: '123' })
  })

  test('handles wildcard routes', () => {
    const router = new Router()
    router.add('GET', '/static/*', {} as any)

    const match = router.match('GET', '/static/css/main.css')
    expect(match).not.toBeNull()
    expect(match!.params['*']).toBe('css/main.css')
  })
})

// ============================================
// MiddlewareChain Tests
// ============================================

describe('MiddlewareChain', () => {
  test('executes empty chain', async () => {
    const chain = new MiddlewareChain([])
    const request: APIRequest = {
      method: 'GET',
      path: '/test',
      headers: {},
      params: {},
      query: {}
    }

    const result = await chain.executeBefore(request)
    expect(result).toEqual(request)
  })

  test('executes before middleware in order', async () => {
    const order: number[] = []
    const middleware: Middleware[] = [
      { before: (req) => { order.push(1); return req } },
      { before: (req) => { order.push(2); return req } },
      { before: (req) => { order.push(3); return req } }
    ]

    const chain = new MiddlewareChain(middleware)
    await chain.executeBefore({
      method: 'GET',
      path: '/test',
      headers: {},
      params: {},
      query: {}
    })

    expect(order).toEqual([1, 2, 3])
  })

  test('executes after middleware in reverse order', async () => {
    const order: number[] = []
    const middleware: Middleware[] = [
      { after: (req, res) => { order.push(1); return res } },
      { after: (req, res) => { order.push(2); return res } },
      { after: (req, res) => { order.push(3); return res } }
    ]

    const chain = new MiddlewareChain(middleware)
    const request: APIRequest = {
      method: 'GET',
      path: '/test',
      headers: {},
      params: {},
      query: {}
    }
    const response: APIResponse = { status: 200, headers: {}, body: {} }

    await chain.executeAfter(request, response)
    expect(order).toEqual([3, 2, 1])
  })
})

// ============================================
// RateLimiter Tests
// ============================================

describe('RateLimiter', () => {
  test('tracks request counts', () => {
    const limiter = new RateLimiter()
    const config: RateLimitConfig = { requests: 5, window: 1000, key: 'test-key' }

    expect(limiter.check('test-key', config)).toBe(true)
    expect(limiter.check('test-key', config)).toBe(true)
  })

  test('blocks after limit exceeded', () => {
    const limiter = new RateLimiter()
    const config: RateLimitConfig = { requests: 2, window: 10000, key: 'test' }

    expect(limiter.check('test', config)).toBe(true)
    expect(limiter.check('test', config)).toBe(true)
    expect(limiter.check('test', config)).toBe(false)
  })

  test('returns remaining count', () => {
    const limiter = new RateLimiter()
    const config: RateLimitConfig = { requests: 5, window: 1000, key: 'test' }

    limiter.check('test', config)
    limiter.check('test', config)

    expect(limiter.remaining('test', config)).toBe(3)
  })
})

// ============================================
// CORSHandler Tests
// ============================================

describe('CORSHandler', () => {
  test('validates allowed origins', () => {
    const handler = new CORSHandler({
      origins: ['https://example.com', 'https://test.com'],
      methods: ['GET'],
      headers: []
    })

    expect(handler.isOriginAllowed('https://example.com')).toBe(true)
    expect(handler.isOriginAllowed('https://malicious.com')).toBe(false)
  })

  test('allows all origins with wildcard', () => {
    const handler = new CORSHandler({
      origins: '*',
      methods: ['GET'],
      headers: []
    })

    expect(handler.isOriginAllowed('https://any.com')).toBe(true)
  })

  test('generates preflight headers', () => {
    const handler = new CORSHandler({
      origins: ['https://example.com'],
      methods: ['GET', 'POST', 'PUT'],
      headers: ['Content-Type', 'Authorization'],
      maxAge: 3600
    })

    const headers = handler.getPreflightHeaders('https://example.com')
    expect(headers['Access-Control-Allow-Origin']).toBe('https://example.com')
    expect(headers['Access-Control-Allow-Methods']).toBe('GET, POST, PUT')
    expect(headers['Access-Control-Allow-Headers']).toBe('Content-Type, Authorization')
    expect(headers['Access-Control-Max-Age']).toBe('3600')
  })
})

// ============================================
// AuthMiddleware Tests
// ============================================

describe('AuthMiddleware', () => {
  test('extracts Bearer token', async () => {
    let extractedToken = ''
    const auth = new AuthMiddleware({
      type: 'jwt',
      validate: (token) => {
        extractedToken = token
        return true
      }
    })

    await auth.authenticate({
      method: 'GET',
      path: '/test',
      headers: { 'Authorization': 'Bearer my-token' },
      params: {},
      query: {}
    })

    expect(extractedToken).toBe('my-token')
  })

  test('extracts API key from custom header', async () => {
    let extractedKey = ''
    const auth = new AuthMiddleware({
      type: 'api-key',
      validate: (key) => {
        extractedKey = key
        return true
      },
      header: 'X-API-Key'
    })

    await auth.authenticate({
      method: 'GET',
      path: '/test',
      headers: { 'X-API-Key': 'secret-123' },
      params: {},
      query: {}
    })

    expect(extractedKey).toBe('secret-123')
  })

  test('returns error for missing token', async () => {
    const auth = new AuthMiddleware({
      type: 'jwt',
      validate: () => true
    })

    const result = await auth.authenticate({
      method: 'GET',
      path: '/test',
      headers: {},
      params: {},
      query: {}
    })

    expect(result.valid).toBe(false)
    expect(result.error).toBe('Missing authorization token')
  })
})
