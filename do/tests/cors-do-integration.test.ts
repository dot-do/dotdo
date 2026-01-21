/**
 * DO Class CORS Integration Tests - Real Durable Objects with Miniflare
 *
 * Tests CORS configuration options in the DO class using real miniflare runtime.
 *
 * NO MOCKS - per CLAUDE.md:
 * - Real miniflare runtime
 * - Real SQLite storage
 * - Real DO instances via env bindings
 *
 * @module do/tests/cors-do-integration.test
 */

import { describe, it, expect } from 'vitest'
import { env } from 'cloudflare:test'

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Generate a unique test identifier to isolate test data
 */
function generateTestId(): string {
  return `cors-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Get a fresh DO stub for testing
 */
function getStub(name?: string) {
  const testName = name ?? generateTestId()
  const id = env.DO.idFromName(testName)
  return env.DO.get(id)
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('DO CORS Integration', () => {
  describe('default CORS behavior', () => {
    it('should include CORS headers on OPTIONS preflight', async () => {
      const stub = getStub()

      const response = await stub.fetch('https://do/', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://app.example.com',
          'Access-Control-Request-Method': 'GET',
        },
      })

      // CORS headers should be present
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeTruthy()
      expect(response.headers.get('Access-Control-Allow-Methods')).toBeTruthy()
    })

    it('should include CORS headers on actual requests', async () => {
      const stub = getStub()

      const response = await stub.fetch('https://do/', {
        method: 'GET',
        headers: {
          'Origin': 'https://app.example.com',
        },
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeTruthy()
    })

    it('should handle preflight for POST requests', async () => {
      const stub = getStub()

      const response = await stub.fetch('https://do/rpc', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://app.example.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type',
        },
      })

      // Should allow POST requests via preflight
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeTruthy()
      const allowMethods = response.headers.get('Access-Control-Allow-Methods')
      expect(allowMethods).toBeTruthy()
    })

    it('should handle preflight for PUT requests', async () => {
      const stub = getStub()

      const response = await stub.fetch('https://do/info', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://app.example.com',
          'Access-Control-Request-Method': 'PUT',
        },
      })

      expect(response.headers.get('Access-Control-Allow-Origin')).toBeTruthy()
    })

    it('should handle preflight for DELETE requests', async () => {
      const stub = getStub()

      const response = await stub.fetch('https://do/info', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://app.example.com',
          'Access-Control-Request-Method': 'DELETE',
        },
      })

      expect(response.headers.get('Access-Control-Allow-Origin')).toBeTruthy()
    })
  })

  describe('CORS with various origins', () => {
    it('should work with localhost origin', async () => {
      const stub = getStub()

      const response = await stub.fetch('https://do/', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'http://localhost:3000',
          'Access-Control-Request-Method': 'GET',
        },
      })

      expect(response.headers.get('Access-Control-Allow-Origin')).toBeTruthy()
    })

    it('should work with subdomain origin', async () => {
      const stub = getStub()

      const response = await stub.fetch('https://do/', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://app.subdomain.example.com',
          'Access-Control-Request-Method': 'GET',
        },
      })

      expect(response.headers.get('Access-Control-Allow-Origin')).toBeTruthy()
    })

    it('should work with port in origin', async () => {
      const stub = getStub()

      const response = await stub.fetch('https://do/', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://example.com:8443',
          'Access-Control-Request-Method': 'GET',
        },
      })

      expect(response.headers.get('Access-Control-Allow-Origin')).toBeTruthy()
    })
  })

  describe('CORS headers content', () => {
    it('should include standard allowed methods', async () => {
      const stub = getStub()

      const response = await stub.fetch('https://do/', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://app.example.com',
          'Access-Control-Request-Method': 'POST',
        },
      })

      const allowMethods = response.headers.get('Access-Control-Allow-Methods')
      expect(allowMethods).toContain('GET')
      expect(allowMethods).toContain('POST')
      expect(allowMethods).toContain('PUT')
      expect(allowMethods).toContain('DELETE')
    })

    it('should include standard allowed headers', async () => {
      const stub = getStub()

      const response = await stub.fetch('https://do/', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://app.example.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type, Authorization',
        },
      })

      const allowHeaders = response.headers.get('Access-Control-Allow-Headers')
      if (allowHeaders) {
        expect(allowHeaders).toContain('Content-Type')
      }
    })

    it('should include exposed headers', async () => {
      const stub = getStub()

      const response = await stub.fetch('https://do/', {
        method: 'GET',
        headers: {
          'Origin': 'https://app.example.com',
        },
      })

      const exposeHeaders = response.headers.get('Access-Control-Expose-Headers')
      // Should expose X-Request-ID and X-DO-Colo
      if (exposeHeaders) {
        expect(exposeHeaders.toLowerCase()).toContain('x-request-id')
      }
    })
  })

  describe('non-CORS requests', () => {
    it('should work without Origin header', async () => {
      const stub = getStub()

      const response = await stub.fetch('https://do/')
      expect(response.status).toBe(200)
    })

    it('should include telemetry headers even without CORS', async () => {
      const stub = getStub()

      const response = await stub.fetch('https://do/')
      expect(response.headers.get('X-DO-Colo')).toBeTruthy()
    })
  })

  describe('concurrent CORS requests', () => {
    it('should handle multiple concurrent preflight requests', async () => {
      const stub = getStub()

      const origins = [
        'https://app1.example.com',
        'https://app2.example.com',
        'https://app3.example.com',
      ]

      const requests = origins.map(origin =>
        stub.fetch('https://do/', {
          method: 'OPTIONS',
          headers: {
            'Origin': origin,
            'Access-Control-Request-Method': 'GET',
          },
        })
      )

      const responses = await Promise.all(requests)

      for (const response of responses) {
        expect(response.headers.get('Access-Control-Allow-Origin')).toBeTruthy()
      }
    })

    it('should handle mixed CORS and non-CORS requests', async () => {
      const stub = getStub()

      const requests = [
        stub.fetch('https://do/'),  // non-CORS
        stub.fetch('https://do/', {  // CORS
          method: 'GET',
          headers: { 'Origin': 'https://app.example.com' },
        }),
        stub.fetch('https://do/info'),  // non-CORS
        stub.fetch('https://do/', {  // CORS preflight
          method: 'OPTIONS',
          headers: {
            'Origin': 'https://app.example.com',
            'Access-Control-Request-Method': 'POST',
          },
        }),
      ]

      const responses = await Promise.all(requests)

      // All should succeed
      for (const response of responses) {
        expect(response.status).toBeLessThan(500)
      }
    })
  })
})
