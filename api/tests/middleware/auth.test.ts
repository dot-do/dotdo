import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'

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
import { authMiddleware, requireAuth, requireRole, requirePermission, generateJWT, resetJWKSCache } from '../../middleware/auth'
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

// Variables available in Hono context after auth middleware
type AppVariables = {
  user?: AuthContext
}

// Environment bindings for tests
interface TestEnv {
  API_KEYS: string
}

// Response types for type assertions
interface AuthResponse {
  message?: string
  user?: AuthContext
  error?: string
  authenticated?: boolean
  // Direct auth context fields (some tests return these at top level)
  userId?: string
  email?: string
  role?: 'admin' | 'user'
  permissions?: string[]
  hasAuth?: boolean
}

// ============================================================================
// Test Environment with API Keys
// ============================================================================

// Test API keys provided via environment (not hardcoded in source)
const testEnv: TestEnv = {
  API_KEYS: JSON.stringify({
    'valid-api-key-12345': { userId: 'api-user-1', role: 'user', name: 'Test API Key' },
    'admin-api-key-12345': { userId: 'api-admin-1', role: 'admin', name: 'Admin API Key' },
  }),
}

// ============================================================================
// Test App with Auth Middleware
// ============================================================================

const app = new Hono<{ Bindings: TestEnv; Variables: AppVariables }>()

// Global error handler - converts all errors to JSON
app.onError((err, c) => {
  const status = err instanceof HTTPException ? err.status : 500
  const message = err.message || 'Internal Server Error'

  // Preserve headers set before the error (like WWW-Authenticate)
  return c.json({ error: message }, status as 400 | 401 | 403 | 404 | 500)
})

// CORS middleware
app.use(
  '*',
  cors({
    origin: (origin) => origin || '*',
    allowHeaders: ['Authorization', 'Content-Type', 'X-API-Key', 'X-Request-Id'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['X-Request-Id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'],
    maxAge: 86400,
    credentials: true,
  }),
)

// Apply auth middleware globally with JWKS URL so jose mocks work
app.use('*', authMiddleware({ jwksUrl: 'https://test.example.com/.well-known/jwks.json' }))

// Public route (should work without auth)
app.get('/public', (c) => c.json({ message: 'public' }))

// Protected routes
app.get('/protected', requireAuth(), (c) => c.json({ message: 'protected', user: c.get('user') }))
app.get('/admin', requireAuth(), requireRole('admin'), (c) => c.json({ message: 'admin only' }))
app.get('/user-profile', requireAuth(), (c) => c.json({ message: 'user profile', user: c.get('user') }))
// POST route just requires auth (users have implicit write permission for basic operations)
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

function mockInvalidJWTVerification(errorType: 'expired' | 'invalid' | 'generic' = 'generic', errorMessage: string = 'Invalid token') {
  let error: Error
  if (errorType === 'expired') {
    // Use jose.errors.JWTExpired
    error = new jose.errors.JWTExpired(errorMessage)
  } else if (errorType === 'invalid') {
    // Use jose.errors.JWTInvalid
    error = new jose.errors.JWTInvalid(errorMessage)
  } else {
    error = new Error(errorMessage)
  }
  mockedJwtVerify.mockRejectedValueOnce(error)
}

async function request(
  method: string,
  path: string,
  options: {
    headers?: Record<string, string>
    body?: unknown
  } = {},
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
  // Pass testEnv bindings so API keys are available
  return app.request(path, init, testEnv)
}

// ============================================================================
// Bearer Token Extraction Tests
// ============================================================================

describe('Bearer Token Extraction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetJWKSCache()
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
    const body = (await res.json()) as AuthResponse
    expect(body).toHaveProperty('error')
  })

  it('rejects non-Bearer Authorization schemes', async () => {
    const res = await request('GET', '/protected', {
      headers: {
        Authorization: 'Basic dXNlcjpwYXNz', // Basic auth
      },
    })

    expect(res.status).toBe(401)
    const body = (await res.json()) as AuthResponse
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
    const body = (await res.json()) as AuthResponse
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
    const body = (await res.json()) as AuthResponse
    expect(body.error).toContain('Invalid')
  })
})

// ============================================================================
// JWT Token Verification Tests
// ============================================================================

describe('JWT Token Verification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetJWKSCache() // Reset cached JWKS so createRemoteJWKSet is called fresh
  })

  it('verifies JWT signature using jose library', async () => {
    const token = createJWT({ sub: 'user-123', email: 'user@example.com.ai', role: 'user' })
    mockValidJWTVerification({ sub: 'user-123', email: 'user@example.com.ai', role: 'user' })

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
      }),
    )
  })

  it('rejects expired JWT token', async () => {
    const token = createJWT({ sub: 'user-123', role: 'user' })
    mockInvalidJWTVerification('expired', 'Token has expired')

    const res = await request('GET', '/protected', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    expect(res.status).toBe(401)
    const body = (await res.json()) as AuthResponse
    expect(body.error).toContain('expired')
  })

  it('rejects JWT with invalid signature', async () => {
    const token = createJWT({ sub: 'user-123', role: 'user' })
    mockInvalidJWTVerification('invalid', 'Invalid signature')

    const res = await request('GET', '/protected', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    expect(res.status).toBe(401)
    const body = (await res.json()) as AuthResponse
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
    const body = (await res.json()) as AuthResponse
    expect(body).toHaveProperty('error')
  })

  it('extracts user info from JWT payload', async () => {
    const token = createJWT({
      sub: 'user-456',
      email: 'test@example.com.ai',
      role: 'admin',
      permissions: ['read', 'write', 'delete'],
    })
    mockValidJWTVerification({
      sub: 'user-456',
      email: 'test@example.com.ai',
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
    const body = (await res.json()) as AuthResponse
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

    const body = (await res.json()) as AuthResponse
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
    const body = (await res.json()) as AuthResponse
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
    const body = (await res.json()) as AuthResponse
    expect(body.message).toBe('protected')
  })

  it('allows access to protected route with valid API key', async () => {
    const res = await request('GET', '/protected', {
      headers: {
        'X-API-Key': 'valid-api-key-12345',
      },
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as AuthResponse
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
    const body = (await res.json()) as AuthResponse
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
    const body = (await res.json()) as AuthResponse
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
    const body = (await res.json()) as AuthResponse
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
    const body = (await res.json()) as AuthResponse
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
    const body = (await res.json()) as AuthResponse
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
    const body = (await res.json()) as AuthResponse
    expect(body.userId).toBe('user-789')
  })

  it('sets auth context with email when present in JWT', async () => {
    const token = createJWT({
      sub: 'user-123',
      email: 'user@example.com.ai',
      role: 'user',
    })
    mockValidJWTVerification({
      sub: 'user-123',
      email: 'user@example.com.ai',
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
    const body = (await res.json()) as AuthResponse
    expect(body.email).toBe('user@example.com.ai')
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
    const body = (await res.json()) as AuthResponse
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
    const body = (await res.json()) as AuthResponse
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
    const body = (await res.json()) as AuthResponse
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
        Origin: 'https://example.com.ai',
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
        Origin: 'https://example.com.ai',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Authorization, Content-Type',
      },
    }, testEnv)

    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Methods')).toBeTruthy()
    expect(res.headers.get('Access-Control-Allow-Headers')).toBeTruthy()
  })

  it('allows Authorization header in CORS', async () => {
    const res = await app.request('/protected', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://example.com.ai',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Authorization',
      },
    }, testEnv)

    const allowHeaders = res.headers.get('Access-Control-Allow-Headers')
    expect(allowHeaders?.toLowerCase()).toContain('authorization')
  })

  it('allows X-API-Key header in CORS', async () => {
    const res = await app.request('/protected', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://example.com.ai',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'X-API-Key',
      },
    }, testEnv)

    const allowHeaders = res.headers.get('Access-Control-Allow-Headers')
    expect(allowHeaders?.toLowerCase()).toContain('x-api-key')
  })

  it('sets Access-Control-Max-Age for caching preflight', async () => {
    const res = await app.request('/protected', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://example.com.ai',
        'Access-Control-Request-Method': 'GET',
      },
    }, testEnv)

    const maxAge = res.headers.get('Access-Control-Max-Age')
    expect(maxAge).toBeTruthy()
    expect(parseInt(maxAge || '0')).toBeGreaterThan(0)
  })

  it('includes CORS headers on error responses', async () => {
    const res = await request('GET', '/protected', {
      headers: {
        Origin: 'https://example.com.ai',
        // No auth - should get 401
      },
    })

    expect(res.status).toBe(401)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeTruthy()
  })

  it('allows credentials when configured', async () => {
    const res = await request('GET', '/public', {
      headers: {
        Origin: 'https://example.com.ai',
      },
    })

    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true')
  })

  it('exposes custom headers in response', async () => {
    const token = createJWT({ sub: 'user-123', role: 'user' })
    mockValidJWTVerification({ sub: 'user-123', role: 'user' })

    const res = await request('GET', '/protected', {
      headers: {
        Origin: 'https://example.com.ai',
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
    mockedJwtVerify.mockImplementationOnce(() => new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 100)))

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
    const body = (await res.json()) as AuthResponse

    // Error message should be generic, not expose internal details
    expect(body.error).not.toContain('internal')
    expect(body.error).not.toContain('Detailed')
  })
})

// ============================================================================
// Session Validation Tests
// ============================================================================

import { createSessionValidator, type SessionValidator, type SessionDatabase } from '../../middleware/auth'

describe('Session Validation with better-auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Create a mock database for testing
  function createMockDb(options: {
    session?: { id: string; userId: string; token: string; expiresAt: Date } | null
    user?: { id: string; email: string; role?: string | null } | null
  }): SessionDatabase {
    return {
      query: {
        sessions: {
          findFirst: vi.fn().mockResolvedValue(options.session ?? undefined),
        },
        users: {
          findFirst: vi.fn().mockResolvedValue(options.user ?? undefined),
        },
      },
    }
  }

  // Create a mock KV namespace
  function createMockKV(): KVNamespace {
    const store = new Map<string, string>()
    return {
      get: vi.fn((key: string, type?: string) => {
        const value = store.get(key)
        if (!value) return Promise.resolve(null)
        return Promise.resolve(type === 'json' ? JSON.parse(value) : value)
      }),
      put: vi.fn((key: string, value: string) => {
        store.set(key, value)
        return Promise.resolve()
      }),
      delete: vi.fn((key: string) => {
        store.delete(key)
        return Promise.resolve()
      }),
    } as unknown as KVNamespace
  }

  describe('createSessionValidator', () => {
    it('returns session data for valid token', async () => {
      const futureDate = new Date(Date.now() + 3600000) // 1 hour from now
      const mockDb = createMockDb({
        session: {
          id: 'sess-123',
          userId: 'user-456',
          token: 'valid-token',
          expiresAt: futureDate,
        },
        user: {
          id: 'user-456',
          email: 'test@example.com.ai',
          role: 'user',
        },
      })

      const validator = createSessionValidator(mockDb)
      const result = await validator('valid-token')

      expect(result).not.toBeNull()
      expect(result?.userId).toBe('user-456')
      expect(result?.email).toBe('test@example.com.ai')
      expect(result?.role).toBe('user')
    })

    it('returns null for invalid token (session not found)', async () => {
      const mockDb = createMockDb({
        session: null,
        user: null,
      })

      const validator = createSessionValidator(mockDb)
      const result = await validator('invalid-token')

      expect(result).toBeNull()
    })

    it('returns null when user not found for session', async () => {
      const futureDate = new Date(Date.now() + 3600000)
      const mockDb = createMockDb({
        session: {
          id: 'sess-123',
          userId: 'user-456',
          token: 'valid-token',
          expiresAt: futureDate,
        },
        user: null,
      })

      const validator = createSessionValidator(mockDb)
      const result = await validator('valid-token')

      expect(result).toBeNull()
    })

    it('returns admin role when user has admin role', async () => {
      const futureDate = new Date(Date.now() + 3600000)
      const mockDb = createMockDb({
        session: {
          id: 'sess-123',
          userId: 'admin-user',
          token: 'admin-token',
          expiresAt: futureDate,
        },
        user: {
          id: 'admin-user',
          email: 'admin@example.com.ai',
          role: 'admin',
        },
      })

      const validator = createSessionValidator(mockDb)
      const result = await validator('admin-token')

      expect(result?.role).toBe('admin')
    })

    it('defaults to user role when role is null', async () => {
      const futureDate = new Date(Date.now() + 3600000)
      const mockDb = createMockDb({
        session: {
          id: 'sess-123',
          userId: 'user-456',
          token: 'valid-token',
          expiresAt: futureDate,
        },
        user: {
          id: 'user-456',
          email: 'test@example.com.ai',
          role: null,
        },
      })

      const validator = createSessionValidator(mockDb)
      const result = await validator('valid-token')

      expect(result?.role).toBe('user')
    })
  })

  describe('Session Authentication in Middleware', () => {
    it('rejects session when no validator is configured', async () => {
      const sessionApp = new Hono<{ Variables: AppVariables }>()
      sessionApp.use('*', authMiddleware({ cookieName: 'session' }))
      sessionApp.get('/protected', requireAuth(), (c) => c.json({ message: 'ok' }))

      const res = await sessionApp.request('/protected', {
        headers: {
          Cookie: 'session=some-token',
        },
      })

      expect(res.status).toBe(401)
    })

    it('authenticates with valid session token', async () => {
      const futureDate = new Date(Date.now() + 3600000)
      const mockValidator: SessionValidator = vi.fn().mockResolvedValue({
        userId: 'session-user',
        email: 'session@example.com.ai',
        role: 'user' as const,
        expiresAt: futureDate,
      })

      const sessionApp = new Hono<{ Variables: AppVariables }>()
      sessionApp.use(
        '*',
        authMiddleware({
          cookieName: 'session',
          validateSession: mockValidator,
        }),
      )
      sessionApp.get('/protected', requireAuth(), (c) => c.json({ message: 'ok', user: c.get('user') }))

      const res = await sessionApp.request('/protected', {
        headers: {
          Cookie: 'session=valid-session-token',
        },
      })

      expect(res.status).toBe(200)
      expect(mockValidator).toHaveBeenCalledWith('valid-session-token')
    })

    it('rejects mock token "valid-session" when real validator is configured', async () => {
      // This test ensures the mock token is no longer accepted
      const mockValidator: SessionValidator = vi.fn().mockResolvedValue(null)

      const sessionApp = new Hono<{ Variables: AppVariables }>()
      sessionApp.use(
        '*',
        authMiddleware({
          cookieName: 'session',
          validateSession: mockValidator,
        }),
      )
      sessionApp.get('/protected', requireAuth(), (c) => c.json({ message: 'ok' }))

      const res = await sessionApp.request('/protected', {
        headers: {
          Cookie: 'session=valid-session',
        },
      })

      expect(res.status).toBe(401)
      expect(mockValidator).toHaveBeenCalledWith('valid-session')
    })

    it('rejects expired session', async () => {
      const pastDate = new Date(Date.now() - 3600000) // 1 hour ago
      const mockValidator: SessionValidator = vi.fn().mockResolvedValue({
        userId: 'session-user',
        role: 'user' as const,
        expiresAt: pastDate,
      })

      const sessionApp = new Hono<{ Variables: AppVariables }>()
      sessionApp.use(
        '*',
        authMiddleware({
          cookieName: 'session',
          validateSession: mockValidator,
        }),
      )
      sessionApp.get('/protected', requireAuth(), (c) => c.json({ message: 'ok' }))

      const res = await sessionApp.request('/protected', {
        headers: {
          Cookie: 'session=expired-session-token',
        },
      })

      expect(res.status).toBe(401)
    })
  })

  describe('Session Caching with KV', () => {
    it('caches validated sessions in KV', async () => {
      const futureDate = new Date(Date.now() + 3600000)
      const mockValidator: SessionValidator = vi.fn().mockResolvedValue({
        userId: 'cached-user',
        email: 'cached@example.com.ai',
        role: 'user' as const,
        expiresAt: futureDate,
      })
      const mockKV = createMockKV()

      const sessionApp = new Hono<{ Variables: AppVariables }>()
      sessionApp.use(
        '*',
        authMiddleware({
          cookieName: 'session',
          validateSession: mockValidator,
          sessionCache: mockKV,
          sessionCacheTtl: 300,
        }),
      )
      sessionApp.get('/protected', requireAuth(), (c) => c.json({ message: 'ok' }))

      // First request - should call validator and cache
      await sessionApp.request('/protected', {
        headers: {
          Cookie: 'session=cacheable-token',
        },
      })

      expect(mockValidator).toHaveBeenCalledTimes(1)
      expect(mockKV.put).toHaveBeenCalled()
    })

    it('returns cached session without calling validator', async () => {
      const futureDate = new Date(Date.now() + 3600000)
      const mockValidator: SessionValidator = vi.fn().mockResolvedValue({
        userId: 'cached-user',
        email: 'cached@example.com.ai',
        role: 'user' as const,
        expiresAt: futureDate,
      })
      const mockKV = createMockKV()

      // Pre-populate cache
      await mockKV.put(
        'session:precached-token',
        JSON.stringify({
          userId: 'cached-user',
          email: 'cached@example.com.ai',
          role: 'user',
          expiresAt: futureDate.toISOString(),
        }),
      )

      const sessionApp = new Hono<{ Variables: AppVariables }>()
      sessionApp.use(
        '*',
        authMiddleware({
          cookieName: 'session',
          validateSession: mockValidator,
          sessionCache: mockKV,
        }),
      )
      sessionApp.get('/protected', requireAuth(), (c) => c.json({ message: 'ok' }))

      const res = await sessionApp.request('/protected', {
        headers: {
          Cookie: 'session=precached-token',
        },
      })

      expect(res.status).toBe(200)
      expect(mockValidator).not.toHaveBeenCalled()
    })

    it('evicts expired sessions from cache', async () => {
      const pastDate = new Date(Date.now() - 3600000)
      const futureDate = new Date(Date.now() + 3600000)
      const mockValidator: SessionValidator = vi.fn().mockResolvedValue({
        userId: 'fresh-user',
        email: 'fresh@example.com.ai',
        role: 'user' as const,
        expiresAt: futureDate,
      })
      const mockKV = createMockKV()

      // Pre-populate cache with expired session
      await mockKV.put(
        'session:expired-cached-token',
        JSON.stringify({
          userId: 'expired-user',
          email: 'expired@example.com.ai',
          role: 'user',
          expiresAt: pastDate.toISOString(),
        }),
      )

      const sessionApp = new Hono<{ Variables: AppVariables }>()
      sessionApp.use(
        '*',
        authMiddleware({
          cookieName: 'session',
          validateSession: mockValidator,
          sessionCache: mockKV,
        }),
      )
      sessionApp.get('/protected', requireAuth(), (c) => c.json({ message: 'ok' }))

      const res = await sessionApp.request('/protected', {
        headers: {
          Cookie: 'session=expired-cached-token',
        },
      })

      expect(res.status).toBe(200)
      // Should have called validator because cached session was expired
      expect(mockValidator).toHaveBeenCalled()
      // Should have deleted the expired cached entry
      expect(mockKV.delete).toHaveBeenCalledWith('session:expired-cached-token')
    })
  })

  describe('In-Memory LRU Cache', () => {
    // Import MemoryCache and clearSessionMemoryCache for testing
    let MemoryCache: typeof import('../../middleware/auth').MemoryCache
    let clearSessionMemoryCache: typeof import('../../middleware/auth').clearSessionMemoryCache

    beforeEach(async () => {
      const authModule = await import('../../middleware/auth')
      MemoryCache = authModule.MemoryCache
      clearSessionMemoryCache = authModule.clearSessionMemoryCache
      // Clear the global memory cache before each test
      clearSessionMemoryCache()
    })

    it('stores and retrieves values', () => {
      const cache = new MemoryCache<string>(100, 300)
      cache.set('key1', 'value1')
      expect(cache.get('key1')).toBe('value1')
    })

    it('returns null for missing keys', () => {
      const cache = new MemoryCache<string>(100, 300)
      expect(cache.get('nonexistent')).toBeNull()
    })

    it('expires entries after TTL', async () => {
      const cache = new MemoryCache<string>(100, 1) // 1 second TTL
      cache.set('key1', 'value1')
      expect(cache.get('key1')).toBe('value1')
      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 1100))
      expect(cache.get('key1')).toBeNull()
    })

    it('evicts oldest entries when at capacity', () => {
      const cache = new MemoryCache<string>(3, 300)
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      cache.set('key3', 'value3')
      expect(cache.size).toBe(3)
      // Add a 4th entry, should evict key1 (oldest, first in)
      cache.set('key4', 'value4')
      expect(cache.get('key1')).toBeNull() // Evicted
      expect(cache.get('key2')).toBe('value2')
      expect(cache.get('key3')).toBe('value3')
      expect(cache.get('key4')).toBe('value4')
    })

    it('moves accessed entries to end (LRU)', () => {
      const cache = new MemoryCache<string>(3, 300)
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      cache.set('key3', 'value3')
      // Access key1, making it most recently used
      cache.get('key1')
      // Add key4, should evict key2 (now oldest)
      cache.set('key4', 'value4')
      expect(cache.get('key1')).toBe('value1')
      expect(cache.get('key2')).toBeNull()
    })

    it('prunes expired entries', async () => {
      const cache = new MemoryCache<string>(100, 1) // 1 second TTL
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      expect(cache.size).toBe(2)
      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 1100))
      const removed = cache.prune()
      expect(removed).toBe(2)
      expect(cache.size).toBe(0)
    })

    it('integrates with session authentication as L1 cache', async () => {
      const futureDate = new Date(Date.now() + 3600000)
      let validatorCallCount = 0
      const mockValidator: SessionValidator = vi.fn().mockImplementation(() => {
        validatorCallCount++
        return Promise.resolve({
          userId: 'memory-cached-user',
          email: 'memory@example.com.ai',
          role: 'user' as const,
          expiresAt: futureDate,
        })
      })
      const mockKV = createMockKV()

      const sessionApp = new Hono<{ Variables: AppVariables }>()
      sessionApp.use(
        '*',
        authMiddleware({
          cookieName: 'session',
          validateSession: mockValidator,
          sessionCache: mockKV,
          enableMemoryCache: true,
          sessionCacheTtl: 300,
        }),
      )
      sessionApp.get('/protected', requireAuth(), (c) => c.json({ message: 'ok' }))

      // First request - should call validator
      await sessionApp.request('/protected', {
        headers: { Cookie: 'session=memory-test-token' },
      })
      expect(validatorCallCount).toBe(1)

      // Second request - should use memory cache (L1), not call validator
      await sessionApp.request('/protected', {
        headers: { Cookie: 'session=memory-test-token' },
      })
      expect(validatorCallCount).toBe(1) // Still 1, memory cache was used

      // Third request - same token, still uses memory cache
      await sessionApp.request('/protected', {
        headers: { Cookie: 'session=memory-test-token' },
      })
      expect(validatorCallCount).toBe(1) // Still 1
    })

    it('populates memory cache from KV cache hit', async () => {
      const futureDate = new Date(Date.now() + 3600000)
      let validatorCallCount = 0
      const mockValidator: SessionValidator = vi.fn().mockImplementation(() => {
        validatorCallCount++
        return Promise.resolve({
          userId: 'kv-user',
          role: 'user' as const,
          expiresAt: futureDate,
        })
      })
      const mockKV = createMockKV()

      // Pre-populate KV cache
      await mockKV.put(
        'session:kv-to-memory-token',
        JSON.stringify({
          userId: 'kv-user',
          role: 'user',
          expiresAt: futureDate.toISOString(),
        }),
      )

      // Clear memory cache to ensure we start fresh
      clearSessionMemoryCache()

      const sessionApp = new Hono<{ Variables: AppVariables }>()
      sessionApp.use(
        '*',
        authMiddleware({
          cookieName: 'session',
          validateSession: mockValidator,
          sessionCache: mockKV,
          enableMemoryCache: true,
        }),
      )
      sessionApp.get('/protected', requireAuth(), (c) => c.json({ message: 'ok' }))

      // First request - should hit KV, populate memory cache
      const res1 = await sessionApp.request('/protected', {
        headers: { Cookie: 'session=kv-to-memory-token' },
      })
      expect(res1.status).toBe(200)
      expect(validatorCallCount).toBe(0) // KV cache hit, no validator call
      expect(mockKV.get).toHaveBeenCalled()
    })
  })
})
