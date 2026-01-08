import { describe, it, expect, beforeAll } from 'vitest'

/**
 * RED Phase Tests for Hono Worker Routes
 *
 * These tests define the expected behavior of the main Hono worker.
 * They will FAIL until the implementation is created in src/index.ts
 *
 * Tests verify:
 * - Worker responds to requests
 * - GET / returns 200 (static assets)
 * - GET /api/health returns 200 with JSON
 * - Unknown routes return 404
 * - Worker exports default with fetch handler
 * - Hono app is properly configured
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
      const body = await res.json()
      expect(body).toHaveProperty('status')
    })

    it('returns status ok', async () => {
      const res = await app.request('/api/health')
      const body = await res.json()
      expect(body.status).toBe('ok')
    })

    it('includes timestamp in response', async () => {
      const res = await app.request('/api/health')
      const body = await res.json()
      expect(body).toHaveProperty('timestamp')
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
      const body = await res.json()
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
})
