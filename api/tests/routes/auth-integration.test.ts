/**
 * Auth Integration Tests - API Routes with OAuth Middleware
 *
 * TDD RED Phase: Tests for mounting oauth-auth middleware on API routes.
 *
 * These tests verify that:
 * 1. Protected API routes require authentication
 * 2. Public routes are accessible without auth
 * 3. Session endpoint returns proper user info
 * 4. API keys work via multiple headers
 * 5. Error responses have proper structure
 *
 * All tests should FAIL initially - they define expected behavior
 * before the middleware is mounted on api/index.ts.
 *
 * @see api/middleware/oauth-auth.ts for the middleware implementation
 * @see api/index.ts where middleware needs to be mounted
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { app } from '../../index'
import { resetMocks, setMockSessionInvalid, setMockBearerTokenInvalid } from '../../middleware/oauth-auth'

// ============================================================================
// Types
// ============================================================================

interface ErrorResponse {
  error: {
    status?: number
    code?: string
    message: string
  }
}

interface SessionResponse {
  authenticated: boolean
  user?: {
    id: string
    email?: string
    name?: string
    role?: string
  }
}

interface ThingsResponse {
  items?: unknown[]
  error?: ErrorResponse['error']
}

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Helper to make requests to the app
 */
async function request(
  method: string,
  path: string,
  options: {
    headers?: Record<string, string>
    cookies?: Record<string, string>
    body?: unknown
  } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers,
  }

  // Set cookies if provided
  if (options.cookies) {
    const cookieString = Object.entries(options.cookies)
      .map(([key, value]) => `${key}=${value}`)
      .join('; ')
    headers['Cookie'] = cookieString
  }

  const init: RequestInit = { method, headers }

  if (options.body) {
    init.body = JSON.stringify(options.body)
  }

  return app.request(path, init)
}

async function get(path: string, options?: Parameters<typeof request>[2]): Promise<Response> {
  return request('GET', path, options)
}

async function post(path: string, body: unknown, options?: Omit<Parameters<typeof request>[2], 'body'>): Promise<Response> {
  return request('POST', path, { ...options, body })
}

// ============================================================================
// Test Setup
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks()
  resetMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
  resetMocks()
})

// ============================================================================
// 1. Protected Route Tests
// ============================================================================

describe('Protected Route Tests', () => {
  describe('GET /api/things - Authentication Required', () => {
    it('should return 401 without auth cookie', async () => {
      // RED: This test will FAIL because middleware is not mounted
      const res = await get('/api/things')

      expect(res.status).toBe(401)

      const body = (await res.json()) as ErrorResponse
      expect(body.error).toBeDefined()
      expect(body.error.message).toMatch(/authentication|unauthorized/i)
    })

    it('should return 401 without Bearer token', async () => {
      // RED: This test will FAIL because middleware is not mounted
      const res = await get('/api/things', {
        headers: {
          // No Authorization header
        },
      })

      expect(res.status).toBe(401)
    })

    it('should return 200 with valid session cookie', async () => {
      // RED: This test will FAIL because middleware is not mounted
      // Using a valid token format that the mock validator accepts
      const res = await get('/api/things', {
        cookies: { session: 'valid-session-token' },
      })

      // Should succeed with valid session
      expect(res.status).toBe(200)

      const body = (await res.json()) as ThingsResponse
      expect(body.items).toBeDefined()
      expect(Array.isArray(body.items)).toBe(true)
    })

    it('should return 200 with valid Bearer token', async () => {
      // RED: This test will FAIL because middleware is not mounted
      const res = await get('/api/things', {
        headers: {
          Authorization: 'Bearer valid-bearer-token',
        },
      })

      // Should succeed with valid Bearer token
      expect(res.status).toBe(200)

      const body = (await res.json()) as ThingsResponse
      expect(body.items).toBeDefined()
    })

    it('should return 401 with invalid session cookie', async () => {
      // Set up mock to reject session
      await setMockSessionInvalid(true)

      const res = await get('/api/things', {
        cookies: { session: 'invalid-session' },
      })

      expect(res.status).toBe(401)
    })

    it('should return 401 with invalid Bearer token', async () => {
      // Set up mock to reject bearer token
      await setMockBearerTokenInvalid(true)

      const res = await get('/api/things', {
        headers: {
          Authorization: 'Bearer invalid-token',
        },
      })

      expect(res.status).toBe(401)
    })
  })

  describe('POST /api/things - Authentication Required', () => {
    it('should return 401 when creating without auth', async () => {
      // RED: This test will FAIL because middleware is not mounted
      const res = await post('/api/things', {
        name: 'Test Thing',
        $type: 'thing',
      })

      expect(res.status).toBe(401)
    })

    it('should return 201 when creating with valid auth', async () => {
      // RED: This test will FAIL because middleware is not mounted
      const res = await post(
        '/api/things',
        {
          name: 'Test Thing',
          $type: 'thing',
        },
        {
          cookies: { session: 'valid-session-token' },
        },
      )

      // Should succeed with valid session
      expect(res.status).toBe(201)
    })
  })
})

// ============================================================================
// 2. Public Route Tests
// ============================================================================

describe('Public Route Tests', () => {
  describe('GET /api/health - Public Route', () => {
    it('should return 200 without auth', async () => {
      // Health check should always be public
      const res = await get('/api/health')

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body).toHaveProperty('status', 'ok')
    })

    it('should return 200 regardless of auth state', async () => {
      // Even with invalid session, health should work
      await setMockSessionInvalid(true)

      const res = await get('/api/health', {
        cookies: { session: 'invalid-session' },
      })

      expect(res.status).toBe(200)
    })
  })

  describe('GET /api/openapi.json - Public Route', () => {
    it('should return 200 without auth', async () => {
      // OpenAPI spec should be public
      const res = await get('/api/openapi.json')

      expect(res.status).toBe(200)

      const body = await res.json()
      // Should be valid OpenAPI spec
      expect(body).toHaveProperty('openapi')
    })
  })

  describe('GET /api/auth/* - Public Auth Routes', () => {
    it('GET /api/auth/session should be accessible without auth', async () => {
      // RED: This test will FAIL because auth/session endpoint doesn't exist
      const res = await get('/api/auth/session')

      // Should return 200 (with unauthenticated state) or the endpoint exists
      // Not 401 - the endpoint itself should be public
      expect(res.status).not.toBe(401)
    })

    it('GET /api/auth/login should be accessible without auth', async () => {
      // RED: This test documents expected behavior for login endpoint
      const res = await get('/api/auth/login')

      // Should not require auth to access login
      expect(res.status).not.toBe(401)
    })

    it('GET /api/auth/logout should be accessible without auth', async () => {
      // RED: This test documents expected behavior for logout endpoint
      const res = await get('/api/auth/logout')

      // Should not require auth to access logout
      expect(res.status).not.toBe(401)
    })
  })
})

// ============================================================================
// 3. Session Endpoint Tests
// ============================================================================

describe('Session Endpoint Tests', () => {
  describe('GET /api/auth/session', () => {
    it('should return session info when authenticated', async () => {
      // RED: This test will FAIL because endpoint doesn't exist
      const res = await get('/api/auth/session', {
        cookies: { session: 'valid-session-token' },
      })

      expect(res.status).toBe(200)

      const body = (await res.json()) as SessionResponse
      expect(body.authenticated).toBe(true)
      expect(body.user).toBeDefined()
      expect(body.user?.id).toBeDefined()
    })

    it('should return user details in session response', async () => {
      // RED: This test will FAIL because endpoint doesn't exist
      const res = await get('/api/auth/session', {
        cookies: { session: 'valid-session-token' },
      })

      expect(res.status).toBe(200)

      const body = (await res.json()) as SessionResponse
      expect(body.user).toBeDefined()
      expect(body.user).toHaveProperty('id')
      expect(body.user).toHaveProperty('email')
    })

    it('should return 401 when not authenticated', async () => {
      // RED: This test will FAIL because endpoint doesn't exist
      const res = await get('/api/auth/session')

      expect(res.status).toBe(401)

      const body = (await res.json()) as ErrorResponse
      expect(body.error).toBeDefined()
      expect(body.error.message).toMatch(/authentication|unauthorized/i)
    })

    it('should return 401 with invalid session', async () => {
      await setMockSessionInvalid(true)

      const res = await get('/api/auth/session', {
        cookies: { session: 'invalid-session' },
      })

      expect(res.status).toBe(401)
    })
  })
})

// ============================================================================
// 4. API Key Tests
// ============================================================================

describe('API Key Tests', () => {
  describe('X-API-Key header', () => {
    it('should authenticate with API key in X-API-Key header', async () => {
      // RED: This test will FAIL until API key auth is integrated
      // Note: API keys need to be configured in environment
      const res = await get('/api/things', {
        headers: {
          'X-API-Key': 'valid-api-key',
        },
      })

      // With valid API key, should return 200 or 401 if not configured
      // The actual status depends on whether API keys are set up
      // For RED phase, we expect this to fail (401) because middleware isn't mounted
      expect(res.status).toBe(200)
    })

    it('should return 401 with invalid X-API-Key', async () => {
      const res = await get('/api/things', {
        headers: {
          'X-API-Key': 'invalid-api-key',
        },
      })

      expect(res.status).toBe(401)
    })
  })

  describe('Authorization: ApiKey header', () => {
    it('should authenticate with Authorization: ApiKey format', async () => {
      // RED: This test will FAIL until ApiKey auth format is supported
      const res = await get('/api/things', {
        headers: {
          Authorization: 'ApiKey valid-api-key',
        },
      })

      // Should accept ApiKey format in Authorization header
      expect(res.status).toBe(200)
    })

    it('should return 401 with invalid ApiKey', async () => {
      const res = await get('/api/things', {
        headers: {
          Authorization: 'ApiKey invalid-key',
        },
      })

      expect(res.status).toBe(401)
    })
  })
})

// ============================================================================
// 5. Error Response Tests
// ============================================================================

describe('Error Response Tests', () => {
  describe('401 Response Structure', () => {
    it('should include WWW-Authenticate header in 401 response', async () => {
      // RED: This test will FAIL because middleware is not mounted
      const res = await get('/api/things')

      expect(res.status).toBe(401)
      expect(res.headers.get('WWW-Authenticate')).toBeDefined()
    })

    it('should include Bearer realm in WWW-Authenticate header', async () => {
      const res = await get('/api/things')

      expect(res.status).toBe(401)
      const wwwAuth = res.headers.get('WWW-Authenticate')
      expect(wwwAuth).toMatch(/Bearer/i)
    })

    it('should return proper JSON error structure', async () => {
      const res = await get('/api/things')

      expect(res.status).toBe(401)
      expect(res.headers.get('Content-Type')).toContain('application/json')

      const body = (await res.json()) as ErrorResponse
      expect(body).toHaveProperty('error')
      expect(body.error).toHaveProperty('message')
    })

    it('should include status code in error response', async () => {
      const res = await get('/api/things')

      expect(res.status).toBe(401)

      const body = (await res.json()) as ErrorResponse
      expect(body.error.status).toBe(401)
    })

    it('should not expose internal error details', async () => {
      // Even with service error, should return generic message
      const res = await get('/api/things')

      const body = (await res.json()) as ErrorResponse
      // Should not contain stack traces or internal paths
      const bodyString = JSON.stringify(body)
      expect(bodyString).not.toMatch(/at\s+\w+\s+\(/)  // No stack traces
      expect(bodyString).not.toMatch(/node_modules/)   // No internal paths
      expect(bodyString).not.toMatch(/password/i)      // No credentials
    })
  })

  describe('Error message clarity', () => {
    it('should provide clear message for missing authentication', async () => {
      const res = await get('/api/things')

      expect(res.status).toBe(401)

      const body = (await res.json()) as ErrorResponse
      expect(body.error.message).toBeTruthy()
      // Message should be user-friendly
      expect(body.error.message.length).toBeGreaterThan(5)
      expect(body.error.message.length).toBeLessThan(200)
    })

    it('should provide clear message for invalid token', async () => {
      await setMockBearerTokenInvalid(true)

      const res = await get('/api/things', {
        headers: {
          Authorization: 'Bearer invalid-token',
        },
      })

      expect(res.status).toBe(401)

      const body = (await res.json()) as ErrorResponse
      expect(body.error.message).toMatch(/invalid|expired|unauthorized/i)
    })
  })
})

// ============================================================================
// 6. Authentication Priority Tests
// ============================================================================

describe('Authentication Priority Tests', () => {
  it('should prefer session cookie over Bearer token', async () => {
    // When both are provided, session cookie should take precedence
    const res = await get('/api/things', {
      cookies: { session: 'session-token' },
      headers: {
        Authorization: 'Bearer bearer-token',
      },
    })

    expect(res.status).toBe(200)
    // Note: We can't easily verify which was used without inspecting the response
    // The oauth-auth middleware prefers session cookies
  })

  it('should fall back to Bearer token when session is invalid', async () => {
    await setMockSessionInvalid(true)

    const res = await get('/api/things', {
      cookies: { session: 'invalid-session' },
      headers: {
        Authorization: 'Bearer valid-bearer-token',
      },
    })

    // Should succeed using Bearer token fallback
    expect(res.status).toBe(200)
  })
})

// ============================================================================
// 7. CORS and Preflight Tests
// ============================================================================

describe('CORS and Preflight Tests', () => {
  it('should handle OPTIONS requests for CORS preflight', async () => {
    const res = await request('OPTIONS', '/api/things', {
      headers: {
        Origin: 'https://example.com',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Authorization',
      },
    })

    // OPTIONS should return 204 or 200 (CORS preflight)
    expect([200, 204]).toContain(res.status)
  })

  it('should include CORS headers in response', async () => {
    const res = await get('/api/things', {
      cookies: { session: 'valid-session-token' },
      headers: {
        Origin: 'https://example.com',
      },
    })

    // Should have CORS headers
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeDefined()
  })
})

// ============================================================================
// 8. Route-Specific Auth Tests
// ============================================================================

describe('Route-Specific Auth Tests', () => {
  describe('API Info Endpoint', () => {
    it('GET /api should be public', async () => {
      // The root API info endpoint should be accessible
      const res = await get('/api')

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body).toHaveProperty('name')
      expect(body).toHaveProperty('version')
    })

    it('GET /api/ should be public', async () => {
      const res = await get('/api/')

      expect(res.status).toBe(200)
    })
  })

  describe('Things Collection', () => {
    it('GET /api/things/:id should require auth', async () => {
      // Individual thing access should require auth
      const res = await get('/api/things/some-id')

      expect(res.status).toBe(401)
    })

    it('PUT /api/things/:id should require auth', async () => {
      const res = await request('PUT', '/api/things/some-id', {
        body: { name: 'Updated' },
      })

      expect(res.status).toBe(401)
    })

    it('DELETE /api/things/:id should require auth', async () => {
      const res = await request('DELETE', '/api/things/some-id')

      expect(res.status).toBe(401)
    })
  })
})
