/**
 * Tests for api/app.ts - Hono App Setup
 *
 * This test file provides comprehensive coverage of the createAPI function
 * and all middleware components defined in app.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createAPI, type APIOptions } from '../app'
import { HTTPException } from 'hono/http-exception'

describe('api/app.ts - createAPI', () => {
  // Suppress console output during tests
  let consoleLogSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // Current implementation uses console.log with JSON.stringify for logging
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
    consoleErrorSpy.mockRestore()
  })

  describe('Basic API Creation', () => {
    it('should create a Hono app instance without options', () => {
      const app = createAPI()
      expect(app).toBeDefined()
      expect(typeof app.fetch).toBe('function')
      expect(typeof app.request).toBe('function')
    })

    it('should create a Hono app instance with empty options', () => {
      const app = createAPI({})
      expect(app).toBeDefined()
    })

    it('should create a Hono app with basePath option', () => {
      const app = createAPI({ basePath: '/api/v1' })
      expect(app).toBeDefined()
    })

    it('should create a Hono app with all options', () => {
      const options: APIOptions = {
        basePath: '/api',
        cors: { allowedOrigins: ['https://example.com'] },
        auth: {
          enabled: false
        }
      }
      const app = createAPI(options)
      expect(app).toBeDefined()
    })
  })

  describe('Health Check Endpoint', () => {
    it('should return 200 OK for health check', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/health')

      expect(res.status).toBe(200)
    })

    it('should return correct health check body structure', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/health')
      const body = await res.json()

      expect(body).toHaveProperty('status', 'ok')
      expect(body).toHaveProperty('service', 'dotdo-api')
      expect(body).toHaveProperty('timestamp')
    })

    it('should return valid ISO timestamp in health response', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/health')
      const body = await res.json()

      // Verify timestamp is valid ISO format
      const timestamp = new Date(body.timestamp)
      expect(timestamp.toISOString()).toBe(body.timestamp)
    })

    it('should work with basePath', async () => {
      const app = createAPI({ basePath: '/v2' })
      const res = await app.request('http://localhost/v2/health')

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.status).toBe('ok')
    })

    it('should include uptime when running in Node environment', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/health')
      const body = await res.json()

      // In test environment with process.uptime, should include uptime
      if (typeof process !== 'undefined' && process.uptime) {
        expect(body).toHaveProperty('uptime')
        expect(typeof body.uptime).toBe('number')
      }
    })
  })

  describe('Readiness Check Endpoint', () => {
    it('should return 200 OK when ready', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/ready')

      expect(res.status).toBe(200)
    })

    it('should return correct readiness body structure', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/ready')
      const body = await res.json()

      expect(body).toHaveProperty('status', 'ready')
      expect(body).toHaveProperty('service', 'dotdo-api')
      expect(body).toHaveProperty('timestamp')
      expect(body).toHaveProperty('checks')
    })

    it('should include checks object with api status', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/ready')
      const body = await res.json()

      expect(body.checks).toBeDefined()
      expect(body.checks.api).toBe(true)
    })

    it('should work with basePath', async () => {
      const app = createAPI({ basePath: '/api/v1' })
      const res = await app.request('http://localhost/api/v1/ready')

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.status).toBe('ready')
    })

    it('should return valid ISO timestamp in ready response', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/ready')
      const body = await res.json()

      // Verify timestamp is valid ISO format
      const timestamp = new Date(body.timestamp)
      expect(timestamp.toISOString()).toBe(body.timestamp)
    })
  })

  describe('Root Endpoint (HATEOAS)', () => {
    it('should return 200 OK for root endpoint', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/')

      expect(res.status).toBe(200)
    })

    it('should return API discovery information', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/')
      const body = await res.json()

      expect(body).toHaveProperty('name', 'dotdo API')
      expect(body).toHaveProperty('version', '1.0.0')
      expect(body).toHaveProperty('description', 'Self-describing HATEOAS API')
    })

    it('should include _links with self and health', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/')
      const body = await res.json()

      expect(body._links).toBeDefined()
      expect(body._links.self).toMatchObject({
        href: expect.stringContaining('/'),
        rel: 'self',
        method: 'GET'
      })
      expect(body._links.health).toMatchObject({
        href: expect.stringContaining('/health'),
        rel: 'health',
        method: 'GET',
        title: 'Health check endpoint'
      })
    })

    it('should reflect basePath in HATEOAS links', async () => {
      const app = createAPI({ basePath: '/api/v1' })
      // Note: Root endpoint is at /api/v1 (no trailing slash) when using basePath
      const res = await app.request('http://localhost/api/v1')
      const body = await res.json()

      expect(body._links.self.href).toContain('/api/v1')
      expect(body._links.health.href).toContain('/api/v1/health')
    })

    it('should handle different origins in HATEOAS links', async () => {
      const app = createAPI()
      const res = await app.request('https://api.example.com/')
      const body = await res.json()

      expect(body._links.self.href).toContain('https://api.example.com/')
    })

    it('should include ready link in HATEOAS response', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/')
      const body = await res.json()

      expect(body._links.ready).toBeDefined()
      expect(body._links.ready).toMatchObject({
        href: expect.stringContaining('/ready'),
        rel: 'related',
        method: 'GET',
        title: 'Readiness check endpoint'
      })
    })

    it('should include OpenAPI links for API description', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/')
      const body = await res.json()

      // The root endpoint should include describedby links for OpenAPI
      expect(body._links.describedby).toMatchObject({
        href: expect.stringContaining('/openapi.json'),
        rel: 'describedby',
        method: 'GET'
      })
      expect(body._links['describedby-yaml']).toMatchObject({
        href: expect.stringContaining('/openapi.yaml'),
        rel: 'describedby',
        method: 'GET'
      })
    })

    it('should include help link for documentation', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/')
      const body = await res.json()

      expect(body._links.help).toMatchObject({
        href: expect.stringContaining('/docs'),
        rel: 'help',
        method: 'GET'
      })
    })

    it('should include all standard HATEOAS link types', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/')
      const body = await res.json()

      // Verify all standard HATEOAS link types are present
      const linkTypes = Object.keys(body._links)
      expect(linkTypes).toContain('self')
      expect(linkTypes).toContain('health')
      expect(linkTypes).toContain('ready')
    })
  })

  describe('Request ID Middleware', () => {
    it('should generate X-Request-ID header when not provided', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/health')

      const requestId = res.headers.get('X-Request-ID')
      expect(requestId).toBeDefined()
      expect(requestId).not.toBe('')
    })

    it('should use provided X-Request-ID header', async () => {
      const app = createAPI()
      const customId = 'custom-request-id-12345'
      const res = await app.request('http://localhost/health', {
        headers: { 'X-Request-ID': customId }
      })

      expect(res.headers.get('X-Request-ID')).toBe(customId)
    })

    it('should generate unique request IDs for different requests', async () => {
      const app = createAPI()

      const res1 = await app.request('http://localhost/health')
      const res2 = await app.request('http://localhost/health')

      const id1 = res1.headers.get('X-Request-ID')
      const id2 = res2.headers.get('X-Request-ID')

      expect(id1).not.toBe(id2)
    })

    it('should include request ID in both success and error responses', async () => {
      const app = createAPI()

      const successRes = await app.request('http://localhost/health')
      const errorRes = await app.request('http://localhost/not-found')

      expect(successRes.headers.get('X-Request-ID')).toBeDefined()
      expect(errorRes.headers.get('X-Request-ID')).toBeDefined()
    })
  })

  describe('Logging Middleware', () => {
    it('should log request details as JSON', async () => {
      const app = createAPI()
      await app.request('http://localhost/health')

      // Current implementation uses console.log with JSON.stringify
      expect(consoleLogSpy).toHaveBeenCalled()

      // Parse the JSON log output
      const logCall = consoleLogSpy.mock.calls[0][0]
      const logData = JSON.parse(logCall)

      expect(logData).toHaveProperty('method', 'GET')
      expect(logData).toHaveProperty('url', 'http://localhost/health')
      expect(logData).toHaveProperty('status', 200)
      expect(logData).toHaveProperty('duration')
      expect(logData).toHaveProperty('timestamp')
      expect(logData).toHaveProperty('requestId')
    })

    it('should log correct status for different responses', async () => {
      const app = createAPI()

      await app.request('http://localhost/health')
      await app.request('http://localhost/not-found')

      expect(consoleLogSpy).toHaveBeenCalledTimes(2)

      // Parse JSON from both calls
      const successLog = JSON.parse(consoleLogSpy.mock.calls[0][0])
      const errorLog = JSON.parse(consoleLogSpy.mock.calls[1][0])

      expect(successLog.status).toBe(200)
      expect(errorLog.status).toBe(404)
    })

    it('should include duration in milliseconds format', async () => {
      const app = createAPI()
      await app.request('http://localhost/health')

      const logData = JSON.parse(consoleLogSpy.mock.calls[0][0])
      expect(logData.duration).toMatch(/^\d+ms$/)
    })
  })

  describe('CORS Middleware', () => {
    // Note: Current implementation uses hardcoded CORS with origin: '*'
    // Future versions may add configurable CORS options

    it('should allow all origins with wildcard CORS', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/health', {
        headers: { 'Origin': 'https://any-origin.com' }
      })

      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    })

    it('should handle OPTIONS preflight requests', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/health', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://example.com',
          'Access-Control-Request-Method': 'POST'
        }
      })

      expect(res.status).toBe(204)
      expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST')
    })

    it('should expose X-Request-ID header', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/health', {
        headers: { 'Origin': 'https://example.com' }
      })

      expect(res.headers.get('Access-Control-Expose-Headers')).toContain('X-Request-ID')
    })

    it('should support credentials', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/health', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://example.com',
          'Access-Control-Request-Method': 'GET'
        }
      })

      expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true')
    })

    it('should allow all standard HTTP methods in preflight', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/health', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://example.com',
          'Access-Control-Request-Method': 'DELETE'
        }
      })

      const allowedMethods = res.headers.get('Access-Control-Allow-Methods')
      expect(allowedMethods).toContain('GET')
      expect(allowedMethods).toContain('POST')
      expect(allowedMethods).toContain('PUT')
      expect(allowedMethods).toContain('PATCH')
      expect(allowedMethods).toContain('DELETE')
    })

    it('should allow required headers in preflight', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/health', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://example.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type, Authorization'
        }
      })

      const allowedHeaders = res.headers.get('Access-Control-Allow-Headers')
      expect(allowedHeaders).toContain('Content-Type')
      expect(allowedHeaders).toContain('Authorization')
    })
  })

  describe('404 Not Found Handler', () => {
    it('should return 404 for unknown paths', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/unknown/path')

      expect(res.status).toBe(404)
    })

    it('should return JSON error response for 404', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/not-found')
      const body = await res.json()

      expect(body).toHaveProperty('error', 'Not Found')
      expect(body).toHaveProperty('status', 404)
      expect(body).toHaveProperty('path', '/not-found')
      expect(body).toHaveProperty('requestId')
    })

    it('should include correct path in 404 response', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/some/deep/path')
      const body = await res.json()

      expect(body.path).toBe('/some/deep/path')
    })

    it('should handle 404 with basePath', async () => {
      const app = createAPI({ basePath: '/api' })

      // Path without basePath should 404
      const res = await app.request('http://localhost/health')
      expect(res.status).toBe(404)
    })

    it('should include HATEOAS links in 404 response', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/not-found')
      const body = await res.json()

      expect(body._links).toBeDefined()
      expect(body._links.root).toMatchObject({
        href: expect.stringContaining('/'),
        rel: 'up',
        method: 'GET'
      })
    })

    it('should include help link in 404 response', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/not-found')
      const body = await res.json()

      expect(body._links.help).toMatchObject({
        href: expect.stringContaining('/docs'),
        rel: 'help',
        method: 'GET'
      })
    })

    it('should include health link in 404 response', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/not-found')
      const body = await res.json()

      expect(body._links.health).toMatchObject({
        href: expect.stringContaining('/health'),
        rel: 'health',
        method: 'GET'
      })
    })
  })

  describe('Error Handler', () => {
    it('should handle HTTPException errors', async () => {
      const app = createAPI()

      // Add a route that throws HTTPException
      app.get('/http-error', () => {
        throw new HTTPException(403, { message: 'Forbidden' })
      })

      const res = await app.request('http://localhost/http-error')
      const body = await res.json()

      expect(res.status).toBe(403)
      expect(body.error).toBe('Forbidden')
      expect(body.status).toBe(403)
      expect(body.requestId).toBeDefined()
    })

    it('should handle generic errors as 500', async () => {
      const app = createAPI()

      app.get('/generic-error', () => {
        throw new Error('Something went wrong')
      })

      const res = await app.request('http://localhost/generic-error')
      const body = await res.json()

      expect(res.status).toBe(500)
      expect(body.status).toBe(500)
      expect(body.error).toBe('Something went wrong')
      expect(body.requestId).toBeDefined()
    })

    it('should log unhandled errors', async () => {
      const app = createAPI()

      app.get('/logged-error', () => {
        throw new Error('Logged error')
      })

      await app.request('http://localhost/logged-error')

      expect(consoleErrorSpy).toHaveBeenCalled()
    })

    it('should handle errors with unknown request ID', async () => {
      const app = createAPI()

      // This tests the fallback to 'unknown' requestId
      app.get('/early-error', (c) => {
        // Clear the requestId to simulate early error
        c.set('requestId', undefined as any)
        throw new Error('Early error')
      })

      const res = await app.request('http://localhost/early-error')
      const body = await res.json()

      // Should still return valid response
      expect(res.status).toBe(500)
      expect(body.requestId).toBeDefined()
    })
  })

  describe('Auth Middleware Integration', () => {
    it('should not apply auth when not enabled', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/health')

      expect(res.status).toBe(200)
    })

    it('should skip auth for /health by default', async () => {
      const app = createAPI({
        auth: {
          enabled: true,
          secret: 'test-secret-key-for-testing-purposes'
        }
      })
      const res = await app.request('http://localhost/health')

      expect(res.status).toBe(200)
    })

    it('should skip auth for root / by default', async () => {
      const app = createAPI({
        auth: {
          enabled: true,
          secret: 'test-secret-key-for-testing-purposes'
        }
      })
      const res = await app.request('http://localhost/')

      expect(res.status).toBe(200)
    })

    it('should support custom skipPaths', async () => {
      const app = createAPI({
        auth: {
          enabled: true,
          secret: 'test-secret-key-for-testing-purposes',
          skipPaths: ['/public', '/custom-public']
        }
      })

      app.get('/public', (c) => c.json({ public: true }))
      app.get('/custom-public', (c) => c.json({ custom: true }))

      const res1 = await app.request('http://localhost/public')
      const res2 = await app.request('http://localhost/custom-public')

      expect(res1.status).toBe(200)
      expect(res2.status).toBe(200)
    })
  })

  describe('basePath Routing', () => {
    it('should mount routes under basePath', async () => {
      const app = createAPI({ basePath: '/api/v1' })

      const healthRes = await app.request('http://localhost/api/v1/health')
      // Note: Root endpoint is at /api/v1 (no trailing slash) when using basePath
      const rootRes = await app.request('http://localhost/api/v1')

      expect(healthRes.status).toBe(200)
      expect(rootRes.status).toBe(200)
    })

    it('should 404 for routes without basePath when basePath is set', async () => {
      const app = createAPI({ basePath: '/api' })

      const res = await app.request('http://localhost/health')

      expect(res.status).toBe(404)
    })

    it('should handle empty basePath correctly', async () => {
      const app = createAPI({ basePath: '' })

      const res = await app.request('http://localhost/health')

      expect(res.status).toBe(200)
    })

    it('should handle nested basePath', async () => {
      const app = createAPI({ basePath: '/api/v1/internal' })

      const res = await app.request('http://localhost/api/v1/internal/health')

      expect(res.status).toBe(200)
    })
  })

  describe('Content-Type Headers', () => {
    it('should return application/json content type', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/health')

      expect(res.headers.get('Content-Type')).toContain('application/json')
    })

    it('should return JSON for error responses', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/not-found')

      expect(res.headers.get('Content-Type')).toContain('application/json')
    })
  })

  describe('HTTP Methods', () => {
    it('should respond to GET requests', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/health', { method: 'GET' })

      expect(res.status).toBe(200)
    })

    it('should handle POST to root (404)', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/', { method: 'POST' })

      expect(res.status).toBe(404)
    })

    it('should handle PUT to health (404)', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/health', { method: 'PUT' })

      expect(res.status).toBe(404)
    })

    it('should handle DELETE to health (404)', async () => {
      const app = createAPI()
      const res = await app.request('http://localhost/health', { method: 'DELETE' })

      expect(res.status).toBe(404)
    })
  })

  describe('Concurrent Requests', () => {
    it('should handle multiple concurrent requests', async () => {
      const app = createAPI()
      const requests = Array.from({ length: 20 }, () =>
        app.request('http://localhost/health')
      )

      const responses = await Promise.all(requests)

      expect(responses.every(r => r.status === 200)).toBe(true)
    })

    it('should generate unique request IDs for concurrent requests', async () => {
      const app = createAPI()
      const requests = Array.from({ length: 10 }, () =>
        app.request('http://localhost/health')
      )

      const responses = await Promise.all(requests)
      const requestIds = responses.map(r => r.headers.get('X-Request-ID'))

      // All IDs should be unique
      const uniqueIds = new Set(requestIds)
      expect(uniqueIds.size).toBe(requestIds.length)
    })
  })
})
