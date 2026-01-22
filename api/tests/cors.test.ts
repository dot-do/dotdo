import { describe, it, expect, beforeEach } from 'vitest'
import { createAPI } from '../app'

describe('CORS Configuration', () => {
  describe('when ALLOWED_ORIGINS is not set', () => {
    it('should reject requests from any origin in production', async () => {
      // Default behavior: restrictive (no wildcard)
      const app = createAPI()

      const request = new Request('https://api.dotdo.dev/health', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://malicious-site.com',
          'Access-Control-Request-Method': 'GET',
        },
      })

      const response = await app.fetch(request)

      // Should not include the malicious origin in Access-Control-Allow-Origin
      const allowOrigin = response.headers.get('Access-Control-Allow-Origin')
      expect(allowOrigin).not.toBe('https://malicious-site.com')
      expect(allowOrigin).not.toBe('*')
    })
  })

  describe('when ALLOWED_ORIGINS is configured', () => {
    it('should accept requests from allowed origins', async () => {
      const app = createAPI({
        cors: {
          allowedOrigins: ['https://app.dotdo.dev', 'https://dashboard.dotdo.dev'],
        },
      })

      const request = new Request('https://api.dotdo.dev/health', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://app.dotdo.dev',
          'Access-Control-Request-Method': 'GET',
        },
      })

      const response = await app.fetch(request)

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.dotdo.dev')
    })

    it('should reject requests from non-allowed origins', async () => {
      const app = createAPI({
        cors: {
          allowedOrigins: ['https://app.dotdo.dev'],
        },
      })

      const request = new Request('https://api.dotdo.dev/health', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://unauthorized-site.com',
          'Access-Control-Request-Method': 'GET',
        },
      })

      const response = await app.fetch(request)

      const allowOrigin = response.headers.get('Access-Control-Allow-Origin')
      expect(allowOrigin).not.toBe('https://unauthorized-site.com')
      expect(allowOrigin).not.toBe('*')
    })

    it('should handle multiple allowed origins correctly', async () => {
      const app = createAPI({
        cors: {
          allowedOrigins: ['https://app.dotdo.dev', 'https://dashboard.dotdo.dev', 'https://admin.dotdo.dev'],
        },
      })

      // Test first origin
      const request1 = new Request('https://api.dotdo.dev/health', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://dashboard.dotdo.dev',
          'Access-Control-Request-Method': 'GET',
        },
      })
      const response1 = await app.fetch(request1)
      expect(response1.headers.get('Access-Control-Allow-Origin')).toBe('https://dashboard.dotdo.dev')

      // Test second origin
      const request2 = new Request('https://api.dotdo.dev/health', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://admin.dotdo.dev',
          'Access-Control-Request-Method': 'GET',
        },
      })
      const response2 = await app.fetch(request2)
      expect(response2.headers.get('Access-Control-Allow-Origin')).toBe('https://admin.dotdo.dev')
    })
  })

  describe('when wildcard is explicitly allowed', () => {
    it('should allow all origins when "*" is in allowed origins', async () => {
      const app = createAPI({
        cors: {
          allowedOrigins: ['*'],
        },
      })

      const request = new Request('https://api.dotdo.dev/health', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://any-site.com',
          'Access-Control-Request-Method': 'GET',
        },
      })

      const response = await app.fetch(request)

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    })
  })

  describe('CORS headers on actual requests', () => {
    it('should include CORS headers on GET requests from allowed origins', async () => {
      const app = createAPI({
        cors: {
          allowedOrigins: ['https://app.dotdo.dev'],
        },
      })

      const request = new Request('https://api.dotdo.dev/health', {
        method: 'GET',
        headers: {
          'Origin': 'https://app.dotdo.dev',
        },
      })

      const response = await app.fetch(request)

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.dotdo.dev')
      expect(response.headers.get('Access-Control-Expose-Headers')).toContain('X-Request-ID')
    })

    it('should include Vary: Origin header for dynamic origin handling', async () => {
      const app = createAPI({
        cors: {
          allowedOrigins: ['https://app.dotdo.dev', 'https://dashboard.dotdo.dev'],
        },
      })

      const request = new Request('https://api.dotdo.dev/health', {
        method: 'GET',
        headers: {
          'Origin': 'https://app.dotdo.dev',
        },
      })

      const response = await app.fetch(request)

      // When using dynamic origins, Vary: Origin should be set for proper caching
      expect(response.headers.get('Vary')).toContain('Origin')
    })
  })

  describe('CORS with credentials', () => {
    it('should set credentials header when allowed origin matches', async () => {
      const app = createAPI({
        cors: {
          allowedOrigins: ['https://app.dotdo.dev'],
        },
      })

      const request = new Request('https://api.dotdo.dev/health', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://app.dotdo.dev',
          'Access-Control-Request-Method': 'GET',
        },
      })

      const response = await app.fetch(request)

      expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true')
    })
  })

  describe('default allowed methods and headers', () => {
    it('should allow standard HTTP methods', async () => {
      const app = createAPI({
        cors: {
          allowedOrigins: ['https://app.dotdo.dev'],
        },
      })

      const request = new Request('https://api.dotdo.dev/health', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://app.dotdo.dev',
          'Access-Control-Request-Method': 'DELETE',
        },
      })

      const response = await app.fetch(request)

      const allowMethods = response.headers.get('Access-Control-Allow-Methods')
      expect(allowMethods).toContain('GET')
      expect(allowMethods).toContain('POST')
      expect(allowMethods).toContain('PUT')
      expect(allowMethods).toContain('PATCH')
      expect(allowMethods).toContain('DELETE')
    })

    it('should allow standard headers', async () => {
      const app = createAPI({
        cors: {
          allowedOrigins: ['https://app.dotdo.dev'],
        },
      })

      const request = new Request('https://api.dotdo.dev/health', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://app.dotdo.dev',
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'Content-Type, Authorization',
        },
      })

      const response = await app.fetch(request)

      const allowHeaders = response.headers.get('Access-Control-Allow-Headers')
      expect(allowHeaders).toContain('Content-Type')
      expect(allowHeaders).toContain('Authorization')
      expect(allowHeaders).toContain('X-Request-ID')
      expect(allowHeaders).toContain('X-API-Key')
    })
  })
})
