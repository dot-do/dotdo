import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'

/**
 * Authentication Middleware Tests
 *
 * These tests verify the authentication middleware for the dotdo worker.
 * They are expected to FAIL until the auth middleware is implemented.
 *
 * Implementation requirements:
 * - Create middleware in worker/src/middleware/auth.ts
 * - Support Bearer token (JWT) authentication
 * - Support API key authentication via X-API-Key header
 * - Implement role-based access control (admin vs user)
 * - Set auth context on request for downstream handlers
 * - Configure CORS headers appropriately
 */

// Import the actual middleware
import { authMiddleware, requireAuth, requireRole, generateJWT } from '../../middleware/auth'
import * as jose from 'jose'

// Mock jose for controlled testing
vi.mock('jose', async () => {
  const actual = await vi.importActual('jose')
  return {
    ...actual,
    jwtVerify: vi.fn(),
    createRemoteJWKSet: vi.fn(() => vi.fn()),
  }
})

const mockedJwtVerify = vi.mocked(jose.jwtVerify)
const mockedCreateRemoteJWKSet = vi.mocked(jose.createRemoteJWKSet)

// ============================================================================
// Test Types
// ============================================================================

interface AuthContext {
  userId: string
  email?: string
  role: 'admin' | 'user'
  permissions?: string[]
}

interface JWTPayload {
  sub: string
  email?: string
  role?: 'admin' | 'user'
  permissions?: string[]
  iat?: number
  exp?: number
}

// ============================================================================
// Test App with Auth Middleware
// ============================================================================

const app = new Hono()

// Apply auth middleware globally
app.use('*', authMiddleware({ jwtSecret: 'test-secret' }))

// Public route (should work without auth)
app.get('/public', (c) => c.json({ message: 'public' }))

// Protected routes
app.get('/protected', requireAuth(), (c) => c.json({ message: 'protected', user: c.get('user') }))
app.get('/admin', requireAuth(), requireRole('admin'), (c) => c.json({ message: 'admin only' }))
app.get('/user-profile', requireAuth(), (c) => c.json({ message: 'user profile', user: c.get('user') }))
app.post('/api/things', requireAuth(), (c) => c.json({ message: 'created' }))

// ============================================================================
// Helper Functions
// ============================================================================

function createJWT(payload: JWTPayload): string {
  // Create a fake JWT for testing (header.payload.signature format)
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const body = btoa(JSON.stringify(payload))
  const signature = btoa('fake-signature')
  return `${header}.${body}.${signature}`
}

function mockValidJWTVerification(payload: JWTPayload) {
  mockedJwtVerify.mockResolvedValueOnce({
    payload: {
      ...payload,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    },
    protectedHeader: { alg: 'RS256' },
  } as never)
}

function mockInvalidJWTVerification(errorMessage: string = 'Invalid token') {
  mockedJwtVerify.mockRejectedValueOnce(new Error(errorMessage))
}

async function request(
  method: string,
  path: string,
  options: {
    headers?: Record<string, string>
    body?: unknown
  } = {}
): Promise<Response> {
  const init: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  }
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body)
  }
  return app.request(path, init)
}

// ============================================================================
// Bearer Token Extraction Tests
// ============================================================================

describe('Bearer Token Extraction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('extracts Bearer token from Authorization header', async () => {
    const token = createJWT({ sub: 'user-123', role: 'user' })
    mockValidJWTVerification({ sub: 'user-123', role: 'user' })

    const res = await request('GET', '/protected', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    // Should succeed with valid Bearer token
    expect(res.status).toBe(200)
    expect(mockedJwtVerify).toHaveBeenCalled()
  })

  it('handles Bearer token with extra whitespace', async () => {
    const token = createJWT({ sub: 'user-123', role: 'user' })
    mockValidJWTVerification({ sub: 'user-123', role: 'user' })

    const res = await request('GET', '/protected', {
      headers: {
        Authorization: `Bearer  ${token}`, // extra space
      },
    })

    // Should still extract and verify the token
    expect(res.status).toBe(200)
  })

  it('rejects malformed Bearer token format', async () => {
    const res = await request('GET', '/protected', {
      headers: {
        Authorization: 'Bearer', // no token value
      },
    })

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toHaveProperty('error')
  })

  it('rejects non-Bearer Authorization schemes', async () => {
    const res = await request('GET', '/protected', {
      headers: {
        Authorization: 'Basic dXNlcjpwYXNz', // Basic auth
      },
    })

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toHaveProperty('error')
  })

  it('is case-insensitive for Bearer prefix', async () => {
    const token = createJWT({ sub: 'user-123', role: 'user' })
    mockValidJWTVerification({ sub: 'user-123', role: 'user' })

    const res = await request('GET', '/protected', {
      headers: {
        Authorization: `bearer ${token}`, // lowercase
      },
    })

    expect(res.status).toBe(200)
  })
})

// ============================================================================
// API Key Validation Tests
// ============================================================================

describe('API Key Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts valid API key from X-API-Key header', async () => {
    const res = await request('GET', '/protected', {
      headers: {
        'X-API-Key': 'valid-api-key-12345',
      },
    })

    // Should succeed with valid API key
    expect(res.status).toBe(200)
  })

  it('rejects invalid API key', async () => {
    const res = await request('GET', '/protected', {
      headers: {
        'X-API-Key': 'invalid-key',
      },
    })

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toHaveProperty('error')
  })

  it('rejects empty API key', async () => {
    const res = await request('GET', '/protected', {
      headers: {
        'X-API-Key': '',
      },
    })

    expect(res.status).toBe(401)
  })

  it('prefers Bearer token over API key when both provided', async () => {
    const token = createJWT({ sub: 'user-123', role: 'admin' })
    mockValidJWTVerification({ sub: 'user-123', role: 'admin' })

    const res = await request('GET', '/protected', {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-API-Key': 'some-api-key',
      },
    })

    // Bearer token should be used, JWT verify should be called
    expect(res.status).toBe(200)
    expect(mockedJwtVerify).toHaveBeenCalled()
  })

  it('falls back to API key if Bearer token is invalid', async () => {
    const token = createJWT({ sub: 'user-123', role: 'user' })
    mockInvalidJWTVerification('Token expired')

    const res = await request('GET', '/protected', {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-API-Key': 'valid-api-key-12345',
      },
    })

    // Should fall back to API key and succeed
    expect(res.status).toBe(200)
  })

  it('validates API key format', async () => {
    const res = await request('GET', '/protected', {
      headers: {
        'X-API-Key': 'short', // too short
      },
    })

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toContain('Invalid')
  })
})

// ============================================================================
// JWT Token Verification Tests
// ============================================================================

describe('JWT Token Verification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('verifies JWT signature using jose library', async () => {
    const token = createJWT({ sub: 'user-123', email: 'user@example.com', role: 'user' })
    mockValidJWTVerification({ sub: 'user-123', email: 'user@example.com', role: 'user' })

    const res = await request('GET', '/protected', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    expect(res.status).toBe(200)
    expect(mockedJwtVerify).toHaveBeenCalledWith(
      token,
      expect.anything(), // JWKS
      expect.objectContaining({
        algorithms: expect.arrayContaining(['RS256']),
      })
    )
  })

  it('rejects expired JWT token', async () => {
    const token = createJWT({ sub: 'user-123', role: 'user' })
    mockInvalidJWTVerification('Token has expired')

    const res = await request('GET', '/protected', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toContain('expired')
  })

  it('rejects JWT with invalid signature', async () => {
    const token = createJWT({ sub: 'user-123', role: 'user' })
    mockInvalidJWTVerification('Invalid signature')

    const res = await request('GET', '/protected', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toContain('Invalid')
  })

  it('rejects JWT without required claims', async () => {
    const token = createJWT({ sub: '' } as JWTPayload) // missing sub
    mockValidJWTVerification({ sub: '' } as JWTPayload)

    const res = await request('GET', '/protected', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toHaveProperty('error')
  })

  it('extracts user info from JWT payload', async () => {
    const token = createJWT({
      sub: 'user-456',
      email: 'test@example.com',
      role: 'admin',
      permissions: ['read', 'write', 'delete'],
    })
    mockValidJWTVerification({
      sub: 'user-456',
      email: 'test@example.com',
      role: 'admin',
      permissions: ['read', 'write', 'delete'],
    })

    const res = await request('GET', '/user-profile', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    expect(res.status).toBe(200)
    // The middleware should extract and set auth context
  })

  it('uses JWKS for token verification', async () => {
    const token = createJWT({ sub: 'user-123', role: 'user' })
    mockValidJWTVerification({ sub: 'user-123', role: 'user' })

    await request('GET', '/protected', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    // Should have created JWKS set
    expect(mockedCreateRemoteJWKSet).toHaveBeenCalled()
  })
})

// ============================================================================
// Protected Routes - 401 Without Auth Tests
// ============================================================================

describe('Protected Routes Return 401 Without Auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 for protected route without any auth', async () => {
    const res = await request('GET', '/protected')

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body).toHaveProperty('error')
    expect(body.error).toBeTruthy()
  })

  it('returns 401 for admin route without auth', async () => {
    const res = await request('GET', '/admin')

    expect(res.status).toBe(401)
  })

  it('returns 401 for POST to protected API without auth', async () => {
    const res = await request('POST', '/api/things', {
      body: { name: 'Test Thing' },
    })

    expect(res.status).toBe(401)
  })

  it('returns JSON error response for 401', async () => {
    const res = await request('GET', '/protected')

    expect(res.status).toBe(401)
    expect(res.headers.get('content-type')).toContain('application/json')

    const body = await res.json()
    expect(body).toHaveProperty('error')
  })

  it('returns WWW-Authenticate header on 401', async () => {
    const res = await request('GET', '/protected')

    expect(res.status).toBe(401)
    expect(res.headers.get('WWW-Authenticate')).toContain('Bearer')
  })

  it('allows public routes without auth', async () => {
    const res = await request('GET', '/public')

    // Public route should work without auth
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toBe('public')
  })
})

// ============================================================================
// Protected Routes - Work With Valid Auth Tests
// ============================================================================

describe('Protected Routes Work With Valid Auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows access to protected route with valid Bearer token', async () => {
    const token = createJWT({ sub: 'user-123', role: 'user' })
    mockValidJWTVerification({ sub: 'user-123', role: 'user' })

    const res = await request('GET', '/protected', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toBe('protected')
  })

  it('allows access to protected route with valid API key', async () => {
    const res = await request('GET', '/protected', {
      headers: {
        'X-API-Key': 'valid-api-key-12345',
      },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toBe('protected')
  })

  it('allows POST to protected API with valid auth', async () => {
    const token = createJWT({ sub: 'user-123', role: 'user' })
    mockValidJWTVerification({ sub: 'user-123', role: 'user' })

    const res = await request('POST', '/api/things', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: { name: 'Test Thing' },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toBe('created')
  })

  it('passes through to handler after successful auth', async () => {
    const token = createJWT({ sub: 'user-123', role: 'user' })
    mockValidJWTVerification({ sub: 'user-123', role: 'user' })

    const res = await request('GET', '/user-profile', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toBe('user profile')
  })
})

// ============================================================================
// Role-Based Access Control Tests
// ============================================================================

describe('Role-Based Access Control (RBAC)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows admin to access admin-only route', async () => {
    const token = createJWT({ sub: 'admin-user', role: 'admin' })
    mockValidJWTVerification({ sub: 'admin-user', role: 'admin' })

    const res = await request('GET', '/admin', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toBe('admin only')
  })

  it('denies regular user access to admin-only route', async () => {
    const token = createJWT({ sub: 'regular-user', role: 'user' })
    mockValidJWTVerification({ sub: 'regular-user', role: 'user' })

    const res = await request('GET', '/admin', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    // Should return 403 Forbidden (authenticated but not authorized)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body).toHaveProperty('error')
  })

  it('allows user to access user-level route', async () => {
    const token = createJWT({ sub: 'regular-user', role: 'user' })
    mockValidJWTVerification({ sub: 'regular-user', role: 'user' })

    const res = await request('GET', '/user-profile', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    expect(res.status).toBe(200)
  })

  it('allows admin to access user-level routes', async () => {
    const token = createJWT({ sub: 'admin-user', role: 'admin' })
    mockValidJWTVerification({ sub: 'admin-user', role: 'admin' })

    const res = await request('GET', '/user-profile', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    // Admin should have access to user-level routes
    expect(res.status).toBe(200)
  })

  it('returns 403 with descriptive error for insufficient permissions', async () => {
    const token = createJWT({ sub: 'regular-user', role: 'user' })
    mockValidJWTVerification({ sub: 'regular-user', role: 'user' })

    const res = await request('GET', '/admin', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toContain('permission')
  })

  it('checks permission-based access when permissions array provided', async () => {
    const token = createJWT({
      sub: 'limited-user',
      role: 'user',
      permissions: ['read'],
    })
    mockValidJWTVerification({
      sub: 'limited-user',
      role: 'user',
      permissions: ['read'],
    })

    // Assuming POST requires 'write' permission
    const res = await request('POST', '/api/things', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: { name: 'Test' },
    })

    // User without 'write' permission should be denied
    expect(res.status).toBe(403)
  })

  it('handles missing role claim gracefully', async () => {
    const token = createJWT({ sub: 'user-no-role' } as JWTPayload)
    mockValidJWTVerification({ sub: 'user-no-role' } as JWTPayload)

    const res = await request('GET', '/protected', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    // Should default to 'user' role or deny access
    expect([200, 403]).toContain(res.status)
  })
})

// ============================================================================
// Auth Context Availability Tests
// ============================================================================

describe('Auth Context Available in Request', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sets auth context with userId from JWT sub claim', async () => {
    const token = createJWT({ sub: 'user-789', role: 'user' })
    mockValidJWTVerification({ sub: 'user-789', role: 'user' })

    // Create a test app that reads auth context
    const testApp = new Hono<{ Variables: { auth: AuthContext } }>()

    // TODO: Apply auth middleware here once implemented
    // testApp.use('*', authMiddleware)

    testApp.get('/whoami', (c) => {
      const auth = c.get('auth')
      return c.json({
        userId: auth?.userId,
        role: auth?.role,
      })
    })

    const res = await testApp.request('/whoami', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.userId).toBe('user-789')
  })

  it('sets auth context with email when present in JWT', async () => {
    const token = createJWT({
      sub: 'user-123',
      email: 'user@example.com',
      role: 'user',
    })
    mockValidJWTVerification({
      sub: 'user-123',
      email: 'user@example.com',
      role: 'user',
    })

    // Create test app to verify email in context
    const testApp = new Hono<{ Variables: { auth: AuthContext } }>()

    testApp.get('/profile', (c) => {
      const auth = c.get('auth')
      return c.json({ email: auth?.email })
    })

    const res = await testApp.request('/profile', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.email).toBe('user@example.com')
  })

  it('sets auth context with role from JWT', async () => {
    const token = createJWT({ sub: 'admin-123', role: 'admin' })
    mockValidJWTVerification({ sub: 'admin-123', role: 'admin' })

    const testApp = new Hono<{ Variables: { auth: AuthContext } }>()

    testApp.get('/role', (c) => {
      const auth = c.get('auth')
      return c.json({ role: auth?.role })
    })

    const res = await testApp.request('/role', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.role).toBe('admin')
  })

  it('sets auth context with permissions array', async () => {
    const token = createJWT({
      sub: 'user-123',
      role: 'user',
      permissions: ['read', 'write'],
    })
    mockValidJWTVerification({
      sub: 'user-123',
      role: 'user',
      permissions: ['read', 'write'],
    })

    const testApp = new Hono<{ Variables: { auth: AuthContext } }>()

    testApp.get('/permissions', (c) => {
      const auth = c.get('auth')
      return c.json({ permissions: auth?.permissions })
    })

    const res = await testApp.request('/permissions', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.permissions).toEqual(['read', 'write'])
  })

  it('auth context is undefined for public routes', async () => {
    const testApp = new Hono<{ Variables: { auth?: AuthContext } }>()

    testApp.get('/public', (c) => {
      const auth = c.get('auth')
      return c.json({ hasAuth: auth !== undefined })
    })

    const res = await testApp.request('/public', { method: 'GET' })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.hasAuth).toBe(false)
  })

  it('auth context persists through middleware chain', async () => {
    const token = createJWT({ sub: 'user-chain', role: 'user' })
    mockValidJWTVerification({ sub: 'user-chain', role: 'user' })

    const testApp = new Hono<{ Variables: { auth: AuthContext; processed: boolean } }>()

    // First middleware checks auth
    testApp.use('*', async (c, next) => {
      await next()
      // Auth should still be available after next()
      const auth = c.get('auth')
      if (auth) {
        c.header('X-User-Id', auth.userId)
      }
    })

    testApp.get('/chain', (c) => {
      c.set('processed', true)
      return c.json({ ok: true })
    })

    const res = await testApp.request('/chain', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('X-User-Id')).toBe('user-chain')
  })
})

// ============================================================================
// CORS Headers Tests
// ============================================================================

describe('CORS Headers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sets Access-Control-Allow-Origin header', async () => {
    const res = await request('GET', '/public', {
      headers: {
        Origin: 'https://example.com',
      },
    })

    expect(res.headers.get('Access-Control-Allow-Origin')).toBeTruthy()
  })

  it('allows specific origins from allowlist', async () => {
    const res = await request('GET', '/public', {
      headers: {
        Origin: 'https://allowed-origin.com',
      },
    })

    const allowOrigin = res.headers.get('Access-Control-Allow-Origin')
    expect(allowOrigin).toBe('https://allowed-origin.com')
  })

  it('responds to OPTIONS preflight request', async () => {
    const res = await app.request('/protected', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://example.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Authorization, Content-Type',
      },
    })

    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Methods')).toBeTruthy()
    expect(res.headers.get('Access-Control-Allow-Headers')).toBeTruthy()
  })

  it('allows Authorization header in CORS', async () => {
    const res = await app.request('/protected', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://example.com',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Authorization',
      },
    })

    const allowHeaders = res.headers.get('Access-Control-Allow-Headers')
    expect(allowHeaders?.toLowerCase()).toContain('authorization')
  })

  it('allows X-API-Key header in CORS', async () => {
    const res = await app.request('/protected', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://example.com',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'X-API-Key',
      },
    })

    const allowHeaders = res.headers.get('Access-Control-Allow-Headers')
    expect(allowHeaders?.toLowerCase()).toContain('x-api-key')
  })

  it('sets Access-Control-Max-Age for caching preflight', async () => {
    const res = await app.request('/protected', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://example.com',
        'Access-Control-Request-Method': 'GET',
      },
    })

    const maxAge = res.headers.get('Access-Control-Max-Age')
    expect(maxAge).toBeTruthy()
    expect(parseInt(maxAge || '0')).toBeGreaterThan(0)
  })

  it('includes CORS headers on error responses', async () => {
    const res = await request('GET', '/protected', {
      headers: {
        Origin: 'https://example.com',
        // No auth - should get 401
      },
    })

    expect(res.status).toBe(401)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeTruthy()
  })

  it('allows credentials when configured', async () => {
    const res = await request('GET', '/public', {
      headers: {
        Origin: 'https://example.com',
      },
    })

    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true')
  })

  it('exposes custom headers in response', async () => {
    const token = createJWT({ sub: 'user-123', role: 'user' })
    mockValidJWTVerification({ sub: 'user-123', role: 'user' })

    const res = await request('GET', '/protected', {
      headers: {
        Origin: 'https://example.com',
        Authorization: `Bearer ${token}`,
      },
    })

    const exposeHeaders = res.headers.get('Access-Control-Expose-Headers')
    // Should expose headers like X-Request-Id, X-RateLimit-*, etc.
    expect(exposeHeaders).toBeTruthy()
  })
})

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('Edge Cases and Error Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('handles concurrent requests with different auth', async () => {
    const token1 = createJWT({ sub: 'user-1', role: 'user' })
    const token2 = createJWT({ sub: 'user-2', role: 'admin' })

    mockValidJWTVerification({ sub: 'user-1', role: 'user' })
    mockValidJWTVerification({ sub: 'user-2', role: 'admin' })

    const [res1, res2] = await Promise.all([
      request('GET', '/protected', {
        headers: { Authorization: `Bearer ${token1}` },
      }),
      request('GET', '/admin', {
        headers: { Authorization: `Bearer ${token2}` },
      }),
    ])

    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)
  })

  it('handles request with empty Authorization header', async () => {
    const res = await request('GET', '/protected', {
      headers: {
        Authorization: '',
      },
    })

    expect(res.status).toBe(401)
  })

  it('handles request with whitespace-only Authorization header', async () => {
    const res = await request('GET', '/protected', {
      headers: {
        Authorization: '   ',
      },
    })

    expect(res.status).toBe(401)
  })

  it('handles JWT verification timeout gracefully', async () => {
    const token = createJWT({ sub: 'user-123', role: 'user' })

    // Simulate timeout
    mockedJwtVerify.mockImplementationOnce(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 100))
    )

    const res = await request('GET', '/protected', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    expect(res.status).toBe(401)
  })

  it('handles malformed JWT token structure', async () => {
    const res = await request('GET', '/protected', {
      headers: {
        Authorization: 'Bearer not.a.valid.jwt.token.format',
      },
    })

    expect(res.status).toBe(401)
  })

  it('handles special characters in API key', async () => {
    const res = await request('GET', '/protected', {
      headers: {
        'X-API-Key': 'key-with-special-chars!@#$%',
      },
    })

    // Should either accept or reject cleanly, not error
    expect([200, 401]).toContain(res.status)
  })

  it('does not leak sensitive information in error responses', async () => {
    const token = createJWT({ sub: 'user-123', role: 'user' })
    mockInvalidJWTVerification('Detailed internal error message')

    const res = await request('GET', '/protected', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    expect(res.status).toBe(401)
    const body = await res.json()

    // Error message should be generic, not expose internal details
    expect(body.error).not.toContain('internal')
    expect(body.error).not.toContain('Detailed')
  })
})
