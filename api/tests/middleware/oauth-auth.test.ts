/**
 * API Auth Middleware Tests - oauth.do Integration
 *
 * TDD RED Phase: Tests for authentication middleware that validates oauth.do sessions
 *
 * These tests verify that:
 * 1. Protected API routes return 401 for unauthenticated requests
 * 2. Authenticated requests with valid session cookies are allowed
 * 3. Session validation calls the proper oauth.do endpoints
 * 4. Error responses have proper structure
 *
 * All tests should FAIL initially - they define the expected behavior
 * before implementation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Helper to create Request with cookies
function createRequest(
  path: string,
  options: RequestInit & { cookies?: Record<string, string> } = {}
): Request {
  const { cookies, ...init } = options
  const headers = new Headers(init.headers)

  if (cookies) {
    const cookieString = Object.entries(cookies)
      .map(([key, value]) => `${key}=${value}`)
      .join('; ')
    headers.set('Cookie', cookieString)
  }

  return new Request(`https://api.example.com${path}`, {
    ...init,
    headers,
  })
}

describe('OAuth Auth Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('unauthenticated requests', () => {
    it('should return 401 for requests without session cookie', async () => {
      // This import will fail until the middleware is created
      // RED phase: this test defines the expected API
      const { authMiddleware } = await import('../../middleware/oauth-auth')

      // Request without any cookies
      const request = createRequest('/api/users')

      // Execute middleware
      const response = await authMiddleware(request)

      expect(response.status).toBe(401)
    })

    it('should return 401 with proper error structure', async () => {
      const { authMiddleware } = await import('../../middleware/oauth-auth')

      const request = createRequest('/api/users')
      const response = await authMiddleware(request)

      expect(response.status).toBe(401)
      const json = await response.json()
      expect(json).toMatchObject({
        error: {
          status: 401,
          message: expect.stringMatching(/unauthorized|authentication required/i),
        },
      })
    })

    it('should include WWW-Authenticate header in 401 response', async () => {
      const { authMiddleware } = await import('../../middleware/oauth-auth')

      const request = createRequest('/api/users')
      const response = await authMiddleware(request)

      expect(response.status).toBe(401)
      expect(response.headers.get('WWW-Authenticate')).toBeDefined()
    })

    it('should return 401 for invalid/expired session cookie', async () => {
      const { authMiddleware, setMockSessionInvalid } = await import('../../middleware/oauth-auth')

      // Mark session as invalid
      await setMockSessionInvalid(true)

      // Request with an invalid/expired session
      const request = createRequest('/api/users', {
        cookies: { session: 'expired-or-invalid-token' },
      })

      const response = await authMiddleware(request)

      expect(response.status).toBe(401)
    })

    it('should return 401 for malformed session cookie', async () => {
      const { authMiddleware } = await import('../../middleware/oauth-auth')

      // Request with malformed cookie value
      const request = createRequest('/api/users', {
        cookies: { session: 'not-valid-json-or-token' },
      })

      const response = await authMiddleware(request)

      expect(response.status).toBe(401)
    })
  })

  describe('authenticated requests', () => {
    it('should allow requests with valid session cookie', async () => {
      const { createProtectedHandler } = await import('../../middleware/oauth-auth')

      // Create a protected handler that returns user data
      const protectedHandler = createProtectedHandler(async (req, user) => {
        return new Response(JSON.stringify({ user }), {
          headers: { 'Content-Type': 'application/json' },
        })
      })

      const request = createRequest('/api/users', {
        cookies: { session: 'valid-session-token' },
      })

      // Execute handler
      const response = await protectedHandler(request)

      // Should return 200 with user data
      expect(response.status).toBe(200)
    })

    it('should extract user from session and pass to handler', async () => {
      const { createProtectedHandler } = await import('../../middleware/oauth-auth')

      let receivedUser: unknown

      const protectedHandler = createProtectedHandler(async (req, user) => {
        receivedUser = user
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      })

      const request = createRequest('/api/users', {
        cookies: { session: 'valid-session-token' },
      })

      await protectedHandler(request)

      // Handler should receive the user object
      expect(receivedUser).toBeDefined()
      expect(receivedUser).toHaveProperty('id')
      expect(receivedUser).toHaveProperty('email')
    })

    it('should validate session against oauth.do on each request', async () => {
      const { authMiddleware, getMockValidationCalls } = await import('../../middleware/oauth-auth')

      const request = createRequest('/api/users', {
        cookies: { session: 'session-token' },
      })

      await authMiddleware(request)

      // Should have validated the session
      const calls = await getMockValidationCalls()
      expect(calls.length).toBeGreaterThan(0)
    })
  })

  describe('authorization header support', () => {
    it('should accept Bearer token in Authorization header', async () => {
      const { authMiddleware } = await import('../../middleware/oauth-auth')

      const request = createRequest('/api/users', {
        headers: {
          Authorization: 'Bearer valid-bearer-token',
        },
      })

      const response = await authMiddleware(request)

      expect(response.status).toBe(200)
    })

    it('should return 401 for invalid Bearer token', async () => {
      const { authMiddleware, setMockBearerTokenInvalid } = await import('../../middleware/oauth-auth')

      await setMockBearerTokenInvalid(true)

      const request = createRequest('/api/users', {
        headers: {
          Authorization: 'Bearer invalid-token',
        },
      })

      const response = await authMiddleware(request)

      expect(response.status).toBe(401)
    })

    it('should prefer session cookie over Authorization header', async () => {
      const { createProtectedHandler } = await import('../../middleware/oauth-auth')

      let receivedUser: { id: string } | null = null

      const protectedHandler = createProtectedHandler(async (req, user) => {
        receivedUser = user as { id: string }
        return new Response(JSON.stringify({ success: true }))
      })

      const request = createRequest('/api/users', {
        cookies: { session: 'session-token' },
        headers: {
          Authorization: 'Bearer bearer-token',
        },
      })

      await protectedHandler(request)

      // Should use session cookie user, not bearer token user
      expect(receivedUser).toBeDefined()
      expect(receivedUser?.id).toBe('session-user')
    })
  })

  describe('public routes bypass', () => {
    it('should allow configuring public routes that skip auth', async () => {
      const { createAuthMiddleware } = await import('../../middleware/oauth-auth')

      // Create middleware with public routes config
      const middleware = createAuthMiddleware({
        publicRoutes: ['/api/health', '/api/public/*'],
      })

      // Request to public route without auth
      const request = createRequest('/api/health')
      const response = await middleware(request)

      // Should pass through without auth check
      expect(response.status).not.toBe(401)
    })

    it('should match wildcard public routes', async () => {
      const { createAuthMiddleware } = await import('../../middleware/oauth-auth')

      const middleware = createAuthMiddleware({
        publicRoutes: ['/api/public/*'],
      })

      // Request to nested public route
      const request = createRequest('/api/public/docs/getting-started')
      const response = await middleware(request)

      expect(response.status).not.toBe(401)
    })

    it('should still require auth for non-public routes', async () => {
      const { createAuthMiddleware } = await import('../../middleware/oauth-auth')

      const middleware = createAuthMiddleware({
        publicRoutes: ['/api/health'],
      })

      // Request to protected route without auth
      const request = createRequest('/api/users')
      const response = await middleware(request)

      expect(response.status).toBe(401)
    })
  })

  describe('error handling', () => {
    it('should handle oauth.do service errors gracefully', async () => {
      const { authMiddleware, setMockServiceError } = await import('../../middleware/oauth-auth')

      // oauth.do service is down
      await setMockServiceError(new Error('Service unavailable'))

      const request = createRequest('/api/users', {
        cookies: { session: 'valid-token' },
      })

      const response = await authMiddleware(request)

      // Should return 503 or 500 for service errors, not expose internal error
      expect([500, 503]).toContain(response.status)
      const json = await response.json()
      expect(json.error.message).not.toContain('Service unavailable')
    })

    it('should not expose internal error details in response', async () => {
      const { authMiddleware, setMockServiceError } = await import('../../middleware/oauth-auth')

      await setMockServiceError(
        new Error('Database connection failed: postgres://user:password@db:5432')
      )

      const request = createRequest('/api/users', {
        cookies: { session: 'valid-token' },
      })

      const response = await authMiddleware(request)

      const json = await response.json()
      // Should not expose connection string or password
      expect(JSON.stringify(json)).not.toContain('postgres://')
      expect(JSON.stringify(json)).not.toContain('password')
    })

    it('should log errors server-side for debugging', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { authMiddleware, setMockServiceError } = await import('../../middleware/oauth-auth')

      const error = new Error('Auth service error')
      await setMockServiceError(error)

      const request = createRequest('/api/users', {
        cookies: { session: 'valid-token' },
      })

      await authMiddleware(request)

      // Should log the error server-side
      expect(consoleSpy).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })
  })

  describe('session refresh', () => {
    it('should refresh session cookie if near expiration', async () => {
      const { createAuthMiddleware } = await import('../../middleware/oauth-auth')

      // Session with short remaining time
      const middleware = createAuthMiddleware({
        refreshThreshold: 300, // 5 minutes
      })

      const request = createRequest('/api/users', {
        cookies: {
          session: 'token-near-expiration',
          session_exp: String(Date.now() / 1000 + 120), // Expires in 2 minutes
        },
      })

      const response = await middleware(request)

      // Should set a new session cookie with extended expiration
      const setCookie = response.headers.get('Set-Cookie')
      expect(setCookie).toBeDefined()
      expect(setCookie).toContain('session=')
    })
  })

  describe('rate limiting integration', () => {
    it('should respect rate limits for unauthenticated requests', async () => {
      const { createAuthMiddleware } = await import('../../middleware/oauth-auth')

      const middleware = createAuthMiddleware({
        rateLimitUnauthenticated: 10, // 10 requests per minute
      })

      // Simulate many requests
      const requests = Array.from({ length: 15 }, () => createRequest('/api/public/data'))

      let rateLimited = false
      for (const request of requests) {
        const response = await middleware(request)
        if (response.status === 429) {
          rateLimited = true
          break
        }
      }

      expect(rateLimited).toBe(true)
    })
  })
})
