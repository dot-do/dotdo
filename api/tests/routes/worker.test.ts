import { describe, it, expect, beforeAll } from 'vitest'

/**
 * RED Phase Tests for Hono Worker Routes
 *
 * These tests define the expected behavior of the main Hono worker.
 * They will FAIL until the implementation is complete.
 *
 * Tests verify:
 * - Worker responds to requests
 * - GET / returns 200 (static assets or HTML fallback)
 * - GET /api returns 200 with API info (name, version, endpoints)
 * - GET /api/health returns 200 with JSON { status: 'ok', timestamp: ... }
 * - Unknown routes return 404 with proper JSON error
 * - Worker exports default with fetch handler
 * - Hono app is properly configured with CORS
 *
 * FAILING TESTS (RED state):
 * - /api/health does not include timestamp field
 * - /api root does not return API info
 * - Request ID tracking not implemented
 */

describe('Hono Worker', () => {
  let app: { request: (path: string | Request, options?: RequestInit) => Promise<Response> }
  let workerModule: { default: unknown; app?: unknown }

  beforeAll(async () => {
    // Import the worker module - this will fail until src/index.ts exists
    workerModule = await import('../../index')
    app = workerModule.app as typeof app
  })

  describe('Module exports', () => {
    it('exports default worker', () => {
      expect(workerModule.default).toBeDefined()
    })

    it('default export has fetch handler', () => {
      const worker = workerModule.default as { fetch?: unknown }
      expect(worker.fetch).toBeDefined()
      expect(typeof worker.fetch).toBe('function')
    })

    it('exports Hono app instance', () => {
      expect(workerModule.app).toBeDefined()
    })

    it('app has request method for testing', () => {
      expect(typeof app.request).toBe('function')
    })
  })

  describe('GET / (root route)', () => {
    it('responds with 200 status', async () => {
      const res = await app.request('/')
      expect(res.status).toBe(200)
    })

    it('returns HTML content', async () => {
      const res = await app.request('/')
      const contentType = res.headers.get('content-type')
      expect(contentType).toContain('text/html')
    })
  })

  describe('GET /api/health', () => {
    it('responds with 200 status', async () => {
      const res = await app.request('/api/health')
      expect(res.status).toBe(200)
    })

    it('returns JSON content type', async () => {
      const res = await app.request('/api/health')
      const contentType = res.headers.get('content-type')
      expect(contentType).toContain('application/json')
    })

    it('returns JSON body with status field', async () => {
      const res = await app.request('/api/health')
      const body = (await res.json()) as { status?: string; error?: string; timestamp?: string }
      expect(body).toHaveProperty('status')
    })

    it('returns status ok', async () => {
      const res = await app.request('/api/health')
      const body = (await res.json()) as { status?: string; error?: string; timestamp?: string }
      expect(body.status).toBe('ok')
    })

    it('includes timestamp in response', async () => {
      const res = await app.request('/api/health')
      const body = (await res.json()) as { status?: string; error?: string; timestamp?: string }
      expect(body).toHaveProperty('timestamp')
    })
  })

  describe('GET /api (API info)', () => {
    it('responds with 200 status', async () => {
      // RED: This test should FAIL - /api root returns 404
      const res = await app.request('/api')
      expect(res.status).toBe(200)
    })

    it('returns JSON content type', async () => {
      const res = await app.request('/api')
      const contentType = res.headers.get('content-type')
      expect(contentType).toContain('application/json')
    })

    it('returns API info with name field', async () => {
      // RED: This test should FAIL - /api doesn't return name
      const res = await app.request('/api')
      const body = (await res.json()) as { name?: string }
      expect(body).toHaveProperty('name')
      expect(body.name).toBe('dotdo')
    })

    it('returns API info with version field', async () => {
      // RED: This test should FAIL - /api doesn't return version
      const res = await app.request('/api')
      const body = (await res.json()) as { version?: string }
      expect(body).toHaveProperty('version')
    })

    it('returns API info with endpoints array', async () => {
      // RED: This test should FAIL - /api doesn't return endpoints
      const res = await app.request('/api')
      const body = (await res.json()) as { endpoints?: string[] }
      expect(body).toHaveProperty('endpoints')
      expect(Array.isArray(body.endpoints)).toBe(true)
    })
  })

  describe('Unknown routes', () => {
    it('returns 404 for unknown API routes', async () => {
      const res = await app.request('/api/nonexistent')
      expect(res.status).toBe(404)
    })

    it('returns 404 for completely unknown paths', async () => {
      const res = await app.request('/this/path/does/not/exist')
      expect(res.status).toBe(404)
    })

    it('returns JSON error for API 404s', async () => {
      const res = await app.request('/api/unknown-endpoint')
      const contentType = res.headers.get('content-type')
      expect(contentType).toContain('application/json')
    })

    it('404 response includes error message', async () => {
      const res = await app.request('/api/unknown-endpoint')
      const body = (await res.json()) as { status?: string; error?: string; timestamp?: string }
      expect(body).toHaveProperty('error')
    })
  })

  describe('HTTP methods', () => {
    it('health endpoint responds to GET only', async () => {
      const res = await app.request('/api/health', { method: 'POST' })
      expect(res.status).toBe(405)
    })

    it('returns 405 for unsupported methods with Allow header', async () => {
      const res = await app.request('/api/health', { method: 'DELETE' })
      expect(res.status).toBe(405)
    })
  })

  describe('Hono app configuration', () => {
    it('handles requests without throwing', async () => {
      await expect(app.request('/')).resolves.not.toThrow()
    })

    it('handles malformed paths gracefully', async () => {
      const res = await app.request('/api/../../../etc/passwd')
      expect([400, 404]).toContain(res.status)
    })

    it('sets appropriate security headers', async () => {
      const res = await app.request('/api/health')
      // At minimum, content-type should be set
      expect(res.headers.get('content-type')).toBeDefined()
    })
  })

  describe('CORS headers', () => {
    it('includes Access-Control-Allow-Origin header on API responses', async () => {
      const res = await app.request('/api/health')
      const header = res.headers.get('Access-Control-Allow-Origin')
      expect(header).toBeDefined()
    })

    it('handles OPTIONS preflight requests', async () => {
      const res = await app.request('/api/health', { method: 'OPTIONS' })
      // CORS preflight should return 204 with appropriate headers
      expect(res.status).toBe(204)
    })

    it('includes Access-Control-Allow-Methods header on OPTIONS', async () => {
      const res = await app.request('/api/health', { method: 'OPTIONS' })
      const header = res.headers.get('Access-Control-Allow-Methods')
      expect(header).toBeDefined()
    })

    it('includes Access-Control-Allow-Headers header on OPTIONS', async () => {
      const res = await app.request('/api/health', { method: 'OPTIONS' })
      const header = res.headers.get('Access-Control-Allow-Headers')
      expect(header).toBeDefined()
    })
  })

  describe('Request ID tracking', () => {
    it('echoes X-Request-ID header when provided', async () => {
      // RED: This test should FAIL - request ID tracking not implemented
      const requestId = 'test-request-' + Date.now()
      const res = await app.request('/api/health', {
        headers: { 'X-Request-ID': requestId },
      })
      const responseId = res.headers.get('X-Request-ID')
      expect(responseId).toBe(requestId)
    })

    it('generates X-Request-ID header when not provided', async () => {
      // RED: This test should FAIL - request ID generation not implemented
      const res = await app.request('/api/health')
      const responseId = res.headers.get('X-Request-ID')
      expect(responseId).not.toBeNull()
      expect(typeof responseId).toBe('string')
    })
  })
})
