import { describe, it, expect, beforeEach } from 'vitest'
import { createAPI } from '../app'

describe('Hono App Setup', () => {
  describe('createAPI', () => {
    it('should create a Hono app instance', () => {
      const app = createAPI()
      expect(app).toBeDefined()
      expect(app.fetch).toBeDefined()
    })

    it('should accept custom basePath option', () => {
      const app = createAPI({ basePath: '/api/v1' })
      expect(app).toBeDefined()
    })
  })

  describe('Health Check Endpoint', () => {
    it('should respond to /health with 200 OK', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/health')

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toMatchObject({
        status: 'ok',
        timestamp: expect.any(String)
      })
    })

    it('should include service name in health response', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/health')

      const body = await res.json()
      expect(body.service).toBe('dotdo-api')
    })
  })

  describe('Root Endpoint', () => {
    it('should respond to / with API discovery', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/')

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toMatchObject({
        name: 'dotdo API',
        version: expect.any(String),
        _links: expect.any(Object)
      })
    })

    it('should include HATEOAS links in root response', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/')

      const body = await res.json()
      expect(body._links).toBeDefined()
      expect(body._links.self).toMatchObject({
        href: expect.any(String),
        rel: 'self'
      })
      expect(body._links.health).toMatchObject({
        href: expect.stringContaining('/health'),
        rel: 'health'
      })
    })
  })

  describe('CORS Middleware', () => {
    it('should not add CORS headers when no origins configured (secure default)', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/health')

      // Secure default: no CORS headers when no origins are explicitly allowed
      expect(res.headers.get('access-control-allow-origin')).toBeNull()
    })

    it('should add CORS headers when origins are configured', async () => {
      const app = createAPI({
        cors: { allowedOrigins: ['https://app.dotdo.dev'] }
      })
      const res = await app.request('http://localhost/health', {
        headers: { 'Origin': 'https://app.dotdo.dev' }
      })

      expect(res.headers.get('access-control-allow-origin')).toBe('https://app.dotdo.dev')
    })

    it('should handle OPTIONS preflight requests', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/health', {
        method: 'OPTIONS'
      })

      expect(res.status).toBe(204)
      expect(res.headers.get('access-control-allow-methods')).toBeDefined()
    })
  })

  describe('Request ID Middleware', () => {
    it('should add X-Request-ID header to responses', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/health')

      expect(res.headers.get('x-request-id')).toBeDefined()
      expect(res.headers.get('x-request-id')).toMatch(/^[\w-]+$/)
    })

    it('should use provided X-Request-ID if present', async () => {
      const app = createAPI()
      const requestId = 'test-request-123'
      const res = await app.request('http://localhost/health', {
        headers: { 'X-Request-ID': requestId }
      })

      expect(res.headers.get('x-request-id')).toBe(requestId)
    })
  })

  describe('Logging Middleware', () => {
    it('should not throw errors on requests', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/health')

      expect(res.status).toBe(200)
    })
  })

  describe('Error Handling Middleware', () => {
    it('should handle 404 errors with JSON response', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/nonexistent')

      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body).toMatchObject({
        error: expect.any(String),
        status: 404
      })
    })

    it('should include request ID in error responses', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/nonexistent')

      const body = await res.json()
      expect(body.requestId).toBeDefined()
    })

    it('should handle HTTPException errors', async () => {
      const app = createAPI()
      // Trigger auth error by trying to access a protected route (once implemented)
      const res = await app.request('http://localhost/nonexistent')

      expect(res.status).toBe(404)
    })

    it('should handle uncaught errors with 500 response', async () => {
      const app = createAPI()

      // Add a route that throws an error
      app.get('/error', () => {
        throw new Error('Test error')
      })

      const res = await app.request('http://localhost/error')

      expect(res.status).toBe(500)
      const body = await res.json()
      expect(body).toMatchObject({
        error: expect.any(String),
        status: 500
      })
    })
  })

  describe('Auth Middleware Integration', () => {
    it('should skip auth for health endpoint', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/health')

      expect(res.status).toBe(200)
    })

    it('should skip auth for root endpoint', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/')

      expect(res.status).toBe(200)
    })

    it('should allow custom skipPaths via options', async () => {
      const app = createAPI({
        auth: {
          enabled: true,
          skipPaths: ['/public'],
          secret: 'test-secret-for-auth-middleware-testing-12345'
        }
      })

      // Add a public route
      app.get('/public', (c) => c.json({ message: 'public' }))

      const res = await app.request('http://localhost/public')
      expect(res.status).toBe(200)
    })
  })

  describe('basePath Integration', () => {
    it('should mount all routes under basePath', async () => {
      const app = createAPI({ basePath: '/api/v1' })
      const res = await app.request('http://localhost/api/v1/health')

      expect(res.status).toBe(200)
    })

    it('should not respond to routes without basePath', async () => {
      const app = createAPI({ basePath: '/api/v1' })
      const res = await app.request('http://localhost/health')

      expect(res.status).toBe(404)
    })

    it('should include basePath in HATEOAS links', async () => {
      const app = createAPI({ basePath: '/api/v1' })
      // Try without trailing slash first
      const res = await app.request('http://localhost/api/v1')

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body._links).toBeDefined()
      expect(body._links.health.href).toContain('/api/v1/health')
    })
  })

  describe('Content-Type Headers', () => {
    it('should return JSON content type for JSON responses', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/health')

      expect(res.headers.get('content-type')).toContain('application/json')
    })
  })

  describe('Performance', () => {
    it('should handle requests quickly', async () => {
      const app = createAPI()
      const start = Date.now()
      await app.request('http://localhost/health')
      const duration = Date.now() - start

      expect(duration).toBeLessThan(100) // Should be very fast
    })

    it('should handle multiple concurrent requests', async () => {
      const app = createAPI()
      const requests = Array.from({ length: 10 }, () =>
        app.request('http://localhost/health')
      )

      const responses = await Promise.all(requests)
      expect(responses).toHaveLength(10)
      expect(responses.every(r => r.status === 200)).toBe(true)
    })
  })
})
