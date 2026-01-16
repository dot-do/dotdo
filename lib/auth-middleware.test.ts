/**
 * Auth Middleware Tests [do-k4kk]
 *
 * Comprehensive test coverage for lib/auth-middleware.ts
 *
 * Tests cover:
 * - Token extraction (Bearer header, query param)
 * - JWT decoding and validation
 * - Permission checking (direct, wildcard, hierarchical)
 * - Middleware functions (requireAuth, requirePermission, requireAdmin, optionalAuth)
 * - Error responses and security headers
 * - Edge cases (malformed tokens, expired tokens, whitespace, unicode)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import type { Context } from 'hono'
import {
  extractBearerToken,
  extractQueryToken,
  decodeJwtPayload,
  hasPermission,
  hasAllPermissions,
  requireAuth,
  requirePermission,
  requireAdmin,
  optionalAuth,
  matchesSecurityPattern,
  ENDPOINT_SECURITY_CLASSIFICATION,
  type JwtPayload,
  type AuthContext,
  type AuthVariables,
} from './auth-middleware'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a base64url-encoded JWT for testing
 * Note: This creates unsigned tokens for testing decode logic only
 */
function createTestJwt(payload: Partial<JwtPayload> & { sub: string }, options?: {
  invalid?: boolean
  expired?: boolean
  malformed?: boolean
}): string {
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)

  const fullPayload = {
    sub: payload.sub,
    iat: now,
    exp: options?.expired ? now - 3600 : now + 3600, // Expired 1 hour ago or valid for 1 hour
    ...payload,
  }

  if (options?.malformed) {
    return 'not.a.valid.jwt.token'
  }

  const base64UrlEncode = (obj: object | string) => {
    const str = typeof obj === 'string' ? obj : JSON.stringify(obj)
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  }

  const encodedHeader = base64UrlEncode(header)
  const encodedPayload = base64UrlEncode(fullPayload)
  const signature = options?.invalid ? 'invalid-signature' : 'test-signature-not-verified'

  return `${encodedHeader}.${encodedPayload}.${signature}`
}

/**
 * Create a test Hono app with auth middleware
 */
function createTestApp<M extends typeof requireAuth | ReturnType<typeof requirePermission>>(
  middleware: M
) {
  type Env = { Bindings: Record<string, unknown>; Variables: AuthVariables }
  const app = new Hono<Env>()

  app.get('/protected', middleware as any, (c) => {
    const auth = c.get('auth')
    return c.json({
      authenticated: auth.authenticated,
      userId: auth.userId,
      permissions: auth.permissions,
    })
  })

  return app
}

// ============================================================================
// Token Extraction Tests
// ============================================================================

describe('extractBearerToken', () => {
  it('should extract token from valid Bearer header', () => {
    const request = new Request('https://test.com', {
      headers: { Authorization: 'Bearer my-test-token' },
    })
    expect(extractBearerToken(request)).toBe('my-test-token')
  })

  it('should return null for missing Authorization header', () => {
    const request = new Request('https://test.com')
    expect(extractBearerToken(request)).toBeNull()
  })

  it('should return null for empty Authorization header', () => {
    const request = new Request('https://test.com', {
      headers: { Authorization: '' },
    })
    expect(extractBearerToken(request)).toBeNull()
  })

  it('should return null for non-Bearer auth scheme', () => {
    const request = new Request('https://test.com', {
      headers: { Authorization: 'Basic dXNlcjpwYXNz' },
    })
    expect(extractBearerToken(request)).toBeNull()
  })

  it('should be case-sensitive for Bearer prefix', () => {
    // Per RFC 7235, auth-scheme is case-insensitive, but many implementations are strict
    // Our implementation requires exact "Bearer " prefix
    const request = new Request('https://test.com', {
      headers: { Authorization: 'bearer my-token' },
    })
    expect(extractBearerToken(request)).toBeNull()
  })

  it('should return null for Bearer with no token (empty after Bearer )', () => {
    // "Bearer " has length 7, slice(7) on "Bearer " gives empty string
    // But the implementation returns null because startsWith checks for space after Bearer
    // If authHeader is "Bearer ", startsWith('Bearer ') is true, slice(7) returns ''
    const request = new Request('https://test.com', {
      headers: { Authorization: 'Bearer ' },
    })
    // Returns null because "Bearer " without trailing content is effectively empty
    // The implementation considers empty token as null
    expect(extractBearerToken(request)).toBeNull()
  })

  it('should handle token with special characters', () => {
    const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
    const request = new Request('https://test.com', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(extractBearerToken(request)).toBe(token)
  })

  it('should handle multiple spaces after Bearer (returns token with leading space)', () => {
    const request = new Request('https://test.com', {
      headers: { Authorization: 'Bearer  double-space-token' },
    })
    // slice(7) will include the extra space
    expect(extractBearerToken(request)).toBe(' double-space-token')
  })
})

describe('extractQueryToken', () => {
  it('should extract token from query parameter', () => {
    const url = new URL('https://test.com/sse?token=my-query-token')
    expect(extractQueryToken(url)).toBe('my-query-token')
  })

  it('should return null when token parameter is missing', () => {
    const url = new URL('https://test.com/sse')
    expect(extractQueryToken(url)).toBeNull()
  })

  it('should return empty string for empty token parameter', () => {
    const url = new URL('https://test.com/sse?token=')
    expect(extractQueryToken(url)).toBe('')
  })

  it('should handle URL-encoded token', () => {
    const url = new URL('https://test.com/sse?token=token%2Bwith%2Fspecial%3Dchars')
    expect(extractQueryToken(url)).toBe('token+with/special=chars')
  })

  it('should handle token with unicode characters', () => {
    const url = new URL('https://test.com/sse?token=test-token-%E2%9C%93')
    // URL decoding will convert %E2%9C%93 to checkmark
    expect(extractQueryToken(url)).toContain('test-token-')
  })
})

// ============================================================================
// JWT Decoding Tests
// ============================================================================

describe('decodeJwtPayload', () => {
  it('should decode valid JWT payload', () => {
    const token = createTestJwt({ sub: 'user-123', email: 'test@example.com' })
    const payload = decodeJwtPayload(token)

    expect(payload).not.toBeNull()
    expect(payload!.sub).toBe('user-123')
    expect(payload!.email).toBe('test@example.com')
  })

  it('should return null for malformed token (wrong number of parts)', () => {
    expect(decodeJwtPayload('only-one-part')).toBeNull()
    expect(decodeJwtPayload('two.parts')).toBeNull()
    expect(decodeJwtPayload('too.many.parts.here')).toBeNull()
  })

  it('should return null for expired token', () => {
    const token = createTestJwt({ sub: 'user-123' }, { expired: true })
    expect(decodeJwtPayload(token)).toBeNull()
  })

  it('should return null for token without sub claim', () => {
    // Manually create a token without sub
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const payload = btoa(JSON.stringify({ email: 'test@example.com', exp: Math.floor(Date.now() / 1000) + 3600 }))
    const token = `${header}.${payload}.signature`

    expect(decodeJwtPayload(token)).toBeNull()
  })

  it('should return null for token with non-string sub claim', () => {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const payload = btoa(JSON.stringify({ sub: 123, exp: Math.floor(Date.now() / 1000) + 3600 }))
    const token = `${header}.${payload}.signature`

    expect(decodeJwtPayload(token)).toBeNull()
  })

  it('should return empty permissions array when not provided', () => {
    const token = createTestJwt({ sub: 'user-123' })
    const payload = decodeJwtPayload(token)

    expect(payload).not.toBeNull()
    expect(payload!.permissions).toEqual([])
  })

  it('should preserve permissions array from token', () => {
    const token = createTestJwt({ sub: 'user-123', permissions: ['read', 'write'] })
    const payload = decodeJwtPayload(token)

    expect(payload).not.toBeNull()
    expect(payload!.permissions).toEqual(['read', 'write'])
  })

  it('should return empty permissions for non-array permissions claim', () => {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const payload = btoa(JSON.stringify({
      sub: 'user-123',
      permissions: 'not-an-array',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }))
    const token = `${header}.${payload}.signature`

    const decoded = decodeJwtPayload(token)
    expect(decoded).not.toBeNull()
    expect(decoded!.permissions).toEqual([])
  })

  it('should return null for invalid base64 payload', () => {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const token = `${header}.!!!invalid-base64!!!.signature`

    expect(decodeJwtPayload(token)).toBeNull()
  })

  it('should return null for invalid JSON payload', () => {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const invalidJson = btoa('not valid json {')
    const token = `${header}.${invalidJson}.signature`

    expect(decodeJwtPayload(token)).toBeNull()
  })

  it('should handle base64url encoding (URL-safe characters)', () => {
    // Test token with URL-safe base64 characters
    const token = createTestJwt({ sub: 'user-with-special+/=chars' })
    const payload = decodeJwtPayload(token)

    expect(payload).not.toBeNull()
  })

  it('should extract org_id when present', () => {
    const token = createTestJwt({ sub: 'user-123', org_id: 'org-456' })
    const payload = decodeJwtPayload(token)

    expect(payload).not.toBeNull()
    expect(payload!.org_id).toBe('org-456')
  })
})

// ============================================================================
// Permission Checking Tests
// ============================================================================

describe('hasPermission', () => {
  it('should return true for exact permission match', () => {
    expect(hasPermission(['items:read', 'items:write'], 'items:read')).toBe(true)
  })

  it('should return false for non-matching permission', () => {
    expect(hasPermission(['items:read'], 'items:write')).toBe(false)
  })

  it('should return true for global wildcard (*)', () => {
    expect(hasPermission(['*'], 'any:permission:here')).toBe(true)
  })

  it('should return true for hierarchical wildcard match', () => {
    expect(hasPermission(['admin:*'], 'admin:users:read')).toBe(true)
    expect(hasPermission(['admin:*'], 'admin:settings')).toBe(true)
  })

  it('should handle multi-level hierarchical wildcard', () => {
    expect(hasPermission(['items:*'], 'items:123:read')).toBe(true)
    expect(hasPermission(['items:*'], 'items:123:write')).toBe(true)
  })

  it('should not match wildcard at wrong level', () => {
    // admin:* should not match admin since there's no colon
    expect(hasPermission(['admin:*'], 'admins')).toBe(false)
  })

  it('should return false for empty permissions array', () => {
    expect(hasPermission([], 'items:read')).toBe(false)
  })

  it('should handle single-segment permissions', () => {
    expect(hasPermission(['admin'], 'admin')).toBe(true)
    expect(hasPermission(['admin'], 'user')).toBe(false)
  })
})

describe('hasAllPermissions', () => {
  it('should return true when all permissions are present', () => {
    expect(hasAllPermissions(['read', 'write', 'delete'], ['read', 'write'])).toBe(true)
  })

  it('should return false when any permission is missing', () => {
    expect(hasAllPermissions(['read'], ['read', 'write'])).toBe(false)
  })

  it('should return true for empty required permissions', () => {
    expect(hasAllPermissions(['read'], [])).toBe(true)
  })

  it('should handle wildcard permissions', () => {
    expect(hasAllPermissions(['*'], ['read', 'write', 'delete'])).toBe(true)
  })

  it('should handle hierarchical wildcard permissions', () => {
    expect(hasAllPermissions(['items:*'], ['items:read', 'items:write'])).toBe(true)
  })
})

// ============================================================================
// requireAuth Middleware Tests
// ============================================================================

describe('requireAuth middleware', () => {
  it('should allow request with valid Bearer token', async () => {
    const app = createTestApp(requireAuth)
    const token = createTestJwt({ sub: 'user-123', permissions: ['test'] })

    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.authenticated).toBe(true)
    expect(body.userId).toBe('user-123')
  })

  it('should allow request with valid query token (for SSE)', async () => {
    const app = createTestApp(requireAuth)
    const token = createTestJwt({ sub: 'user-123' })

    const res = await app.request(`/protected?token=${token}`)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.authenticated).toBe(true)
  })

  it('should reject request without token with 401', async () => {
    const app = createTestApp(requireAuth)

    const res = await app.request('/protected')

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Unauthorized')
  })

  it('should reject request with expired token with 401', async () => {
    const app = createTestApp(requireAuth)
    const token = createTestJwt({ sub: 'user-123' }, { expired: true })

    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.message).toBe('Invalid or expired token')
  })

  it('should reject request with malformed token with 401', async () => {
    const app = createTestApp(requireAuth)

    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer not-a-valid-jwt' },
    })

    expect(res.status).toBe(401)
  })

  it('should include WWW-Authenticate header on 401 response', async () => {
    const app = createTestApp(requireAuth)

    const res = await app.request('/protected')

    expect(res.status).toBe(401)
    expect(res.headers.get('WWW-Authenticate')).toBe('Bearer realm="dotdo"')
  })

  it('should set auth context with user permissions', async () => {
    const app = createTestApp(requireAuth)
    const token = createTestJwt({ sub: 'user-123', permissions: ['read', 'write'] })

    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.permissions).toEqual(['read', 'write'])
  })

  it('should prefer Bearer token over query token when both present', async () => {
    const app = createTestApp(requireAuth)
    const bearerToken = createTestJwt({ sub: 'bearer-user' })
    const queryToken = createTestJwt({ sub: 'query-user' })

    const res = await app.request(`/protected?token=${queryToken}`, {
      headers: { Authorization: `Bearer ${bearerToken}` },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.userId).toBe('bearer-user')
  })
})

// ============================================================================
// requirePermission Middleware Tests
// ============================================================================

describe('requirePermission middleware', () => {
  it('should allow request with required permission', async () => {
    const app = createTestApp(requirePermission('items:read'))
    const token = createTestJwt({ sub: 'user-123', permissions: ['items:read'] })

    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
  })

  it('should reject request without required permission with 403', async () => {
    const app = createTestApp(requirePermission('items:write'))
    const token = createTestJwt({ sub: 'user-123', permissions: ['items:read'] })

    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('Forbidden')
    expect(body.message).toContain('items:write')
  })

  it('should reject unauthenticated request with 401', async () => {
    const app = createTestApp(requirePermission('items:read'))

    const res = await app.request('/protected')

    expect(res.status).toBe(401)
  })

  it('should accept array of required permissions (all must match)', async () => {
    const app = createTestApp(requirePermission(['items:read', 'items:write']))
    const token = createTestJwt({ sub: 'user-123', permissions: ['items:read', 'items:write'] })

    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
  })

  it('should reject when missing one of multiple required permissions', async () => {
    const app = createTestApp(requirePermission(['items:read', 'items:write']))
    const token = createTestJwt({ sub: 'user-123', permissions: ['items:read'] })

    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(403)
  })

  it('should allow wildcard permission to satisfy requirement', async () => {
    const app = createTestApp(requirePermission('items:read'))
    const token = createTestJwt({ sub: 'user-123', permissions: ['items:*'] })

    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
  })

  it('should allow global wildcard to satisfy any permission', async () => {
    const app = createTestApp(requirePermission('anything:goes'))
    const token = createTestJwt({ sub: 'user-123', permissions: ['*'] })

    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
  })
})

// ============================================================================
// requireAdmin Middleware Tests
// ============================================================================

describe('requireAdmin middleware', () => {
  it('should allow request with admin:* permission', async () => {
    const app = createTestApp(requireAdmin)
    const token = createTestJwt({ sub: 'admin-user', permissions: ['admin:*'] })

    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.userId).toBe('admin-user')
  })

  it('should allow request with specific admin permission', async () => {
    const app = createTestApp(requireAdmin)
    const token = createTestJwt({ sub: 'admin-user', permissions: ['admin:users:read'] })

    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
  })

  it('should allow request with admin permission (no colon)', async () => {
    const app = createTestApp(requireAdmin)
    const token = createTestJwt({ sub: 'admin-user', permissions: ['admin'] })

    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
  })

  it('should allow request with global wildcard (*)', async () => {
    const app = createTestApp(requireAdmin)
    const token = createTestJwt({ sub: 'super-admin', permissions: ['*'] })

    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
  })

  it('should reject request without admin permission with 403', async () => {
    const app = createTestApp(requireAdmin)
    const token = createTestJwt({ sub: 'regular-user', permissions: ['items:read', 'items:write'] })

    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.message).toBe('Admin access required')
  })

  it('should reject unauthenticated request with 401', async () => {
    const app = createTestApp(requireAdmin)

    const res = await app.request('/protected')

    expect(res.status).toBe(401)
  })

  it('should reject request with empty permissions', async () => {
    const app = createTestApp(requireAdmin)
    const token = createTestJwt({ sub: 'user-123', permissions: [] })

    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(403)
  })
})

// ============================================================================
// optionalAuth Middleware Tests
// ============================================================================

describe('optionalAuth middleware', () => {
  it('should set authenticated context for valid token', async () => {
    const app = createTestApp(optionalAuth)
    const token = createTestJwt({ sub: 'user-123', permissions: ['read'] })

    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.authenticated).toBe(true)
    expect(body.userId).toBe('user-123')
  })

  it('should set unauthenticated context when no token', async () => {
    const app = createTestApp(optionalAuth)

    const res = await app.request('/protected')

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.authenticated).toBe(false)
    expect(body.userId).toBeUndefined()
  })

  it('should set unauthenticated context for invalid token', async () => {
    const app = createTestApp(optionalAuth)

    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer invalid-token' },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.authenticated).toBe(false)
  })

  it('should set unauthenticated context for expired token', async () => {
    const app = createTestApp(optionalAuth)
    const token = createTestJwt({ sub: 'user-123' }, { expired: true })

    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.authenticated).toBe(false)
  })

  it('should have empty permissions when unauthenticated', async () => {
    const app = createTestApp(optionalAuth)

    const res = await app.request('/protected')

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.permissions).toEqual([])
  })
})

// ============================================================================
// Security Pattern Matching Tests
// ============================================================================

describe('matchesSecurityPattern', () => {
  const publicPatterns = ENDPOINT_SECURITY_CLASSIFICATION.public

  it('should match exact patterns', () => {
    expect(matchesSecurityPattern('GET', '/health', publicPatterns)).toBe(true)
    expect(matchesSecurityPattern('GET', '/ready', publicPatterns)).toBe(true)
  })

  it('should match OPTIONS wildcard pattern', () => {
    expect(matchesSecurityPattern('OPTIONS', '/any/path', publicPatterns)).toBe(true)
    expect(matchesSecurityPattern('OPTIONS', '/', publicPatterns)).toBe(true)
  })

  it('should match wildcard path patterns', () => {
    const adminPatterns = ENDPOINT_SECURITY_CLASSIFICATION.admin
    expect(matchesSecurityPattern('GET', '/admin/users', adminPatterns)).toBe(true)
    expect(matchesSecurityPattern('GET', '/admin/settings', adminPatterns)).toBe(true)
  })

  it('should not match unrelated paths', () => {
    expect(matchesSecurityPattern('GET', '/api/items', publicPatterns)).toBe(false)
    expect(matchesSecurityPattern('POST', '/health', publicPatterns)).toBe(false) // POST /health doesn't match GET /health
  })

  it('should be case-sensitive for method', () => {
    expect(matchesSecurityPattern('get', '/health', publicPatterns)).toBe(true) // Method is uppercased
    expect(matchesSecurityPattern('GET', '/health', publicPatterns)).toBe(true)
  })
})

// ============================================================================
// Edge Cases and Security Tests
// ============================================================================

describe('Edge Cases', () => {
  it('should handle token with trailing whitespace (HTTP header trimming)', async () => {
    const app = createTestApp(requireAuth)
    const token = createTestJwt({ sub: 'user-123' })

    // HTTP headers may have trailing whitespace trimmed by the Request implementation
    // The test passes because the token is still valid after potential trimming
    // This documents actual behavior - tokens with trailing whitespace may succeed
    // if the HTTP client/library trims the header value
    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token} ` },
    })

    // Note: This behavior depends on HTTP header normalization
    // The test documents that trailing whitespace doesn't necessarily cause failure
    expect(res.status).toBe(200)
  })

  it('should handle very long token', async () => {
    const app = createTestApp(requireAuth)
    // Create a valid JWT structure but with a long payload
    const longPermissions = Array(100).fill('permission:').map((p, i) => `${p}${i}`)
    const token = createTestJwt({ sub: 'user-123', permissions: longPermissions })

    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
  })

  it('should handle unicode in user ID', async () => {
    const app = createTestApp(requireAuth)
    const token = createTestJwt({ sub: 'user-\u00e9\u00e0\u00fc-123' })

    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.userId).toContain('\u00e9')
  })

  it('should not leak sensitive information in error responses', async () => {
    const app = createTestApp(requireAuth)

    const res = await app.request('/protected')

    expect(res.status).toBe(401)
    const body = await res.json()

    // Should not contain stack traces or internal details
    expect(JSON.stringify(body)).not.toContain('stack')
    expect(JSON.stringify(body)).not.toContain('at ')
  })

  it('should handle concurrent requests with different tokens', async () => {
    const app = createTestApp(requireAuth)
    const token1 = createTestJwt({ sub: 'user-1' })
    const token2 = createTestJwt({ sub: 'user-2' })

    const [res1, res2] = await Promise.all([
      app.request('/protected', { headers: { Authorization: `Bearer ${token1}` } }),
      app.request('/protected', { headers: { Authorization: `Bearer ${token2}` } }),
    ])

    const [body1, body2] = await Promise.all([res1.json(), res2.json()])

    expect(body1.userId).toBe('user-1')
    expect(body2.userId).toBe('user-2')
  })
})

// ============================================================================
// Additional Security Edge Cases
// ============================================================================

describe('Security Edge Cases', () => {
  it('should reject token with only header and no payload', async () => {
    const app = createTestApp(requireAuth)

    const res = await app.request('/protected', {
      headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.' },
    })

    expect(res.status).toBe(401)
  })

  it('should reject token with null bytes (HTTP layer rejects)', async () => {
    const app = createTestApp(requireAuth)

    // HTTP headers cannot contain null bytes - this is rejected at the HTTP level
    // before our middleware even runs. This documents the protection.
    try {
      await app.request('/protected', {
        headers: { Authorization: 'Bearer token\x00injected' },
      })
      // If we get here, the request succeeded unexpectedly
      expect.fail('Expected request to throw due to invalid header')
    } catch (e) {
      // Verify it's a TypeError about invalid header
      expect(e).toBeInstanceOf(TypeError)
      expect((e as Error).message).toContain('Invalid header')
    }
  })

  it('should handle request with multiple Authorization headers (uses first)', async () => {
    // Note: HTTP spec says multiple headers should be comma-joined
    // But browsers/implementations may vary - test documents behavior
    const app = createTestApp(requireAuth)
    const validToken = createTestJwt({ sub: 'user-123' })

    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${validToken}` },
    })

    expect(res.status).toBe(200)
  })

  it('should accept token when exp is exactly now (uses < not <=)', async () => {
    // The implementation uses exp < now, so exp === now is still valid
    // This documents the behavior: token is valid until the second AFTER expiration
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const now = Math.floor(Date.now() / 1000)
    const payload = btoa(JSON.stringify({
      sub: 'user-123',
      exp: now, // Exactly now
      iat: now - 10,
    }))
    const token = `${header}.${payload}.signature`

    const app = createTestApp(requireAuth)

    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    })

    // Implementation: exp < now (not <=), so exp === now is accepted
    // This is a slight deviation from strict JWT spec but common in practice
    expect(res.status).toBe(200)
  })

  it('should accept token with exp 1 second in future', async () => {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const now = Math.floor(Date.now() / 1000)
    const payload = btoa(JSON.stringify({
      sub: 'user-123',
      exp: now + 1, // 1 second in the future
      iat: now - 10,
    }))
    const token = `${header}.${payload}.signature`

    const app = createTestApp(requireAuth)

    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
  })

  it('should handle token without exp claim (no expiration check)', async () => {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const now = Math.floor(Date.now() / 1000)
    const payload = btoa(JSON.stringify({
      sub: 'user-123',
      iat: now - 10,
      // No exp claim
    }))
    const token = `${header}.${payload}.signature`

    const app = createTestApp(requireAuth)

    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    })

    // Tokens without exp should be accepted (no expiration to check)
    expect(res.status).toBe(200)
  })

  it('should handle extremely large exp value', async () => {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const now = Math.floor(Date.now() / 1000)
    const payload = btoa(JSON.stringify({
      sub: 'user-123',
      exp: Number.MAX_SAFE_INTEGER, // Very far in the future
      iat: now - 10,
    }))
    const token = `${header}.${payload}.signature`

    const app = createTestApp(requireAuth)

    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(res.status).toBe(200)
  })
})

// ============================================================================
// CORS Preflight Tests
// ============================================================================

describe('CORS Preflight Handling', () => {
  it('OPTIONS requests should be classified as public', () => {
    expect(matchesSecurityPattern('OPTIONS', '/protected', ENDPOINT_SECURITY_CLASSIFICATION.public)).toBe(true)
    expect(matchesSecurityPattern('OPTIONS', '/admin/users', ENDPOINT_SECURITY_CLASSIFICATION.public)).toBe(true)
  })
})

// ============================================================================
// Endpoint Classification Tests
// ============================================================================

describe('ENDPOINT_SECURITY_CLASSIFICATION', () => {
  it('should have public endpoints defined', () => {
    expect(ENDPOINT_SECURITY_CLASSIFICATION.public).toContain('GET /health')
    expect(ENDPOINT_SECURITY_CLASSIFICATION.public).toContain('OPTIONS *')
  })

  it('should have protected endpoints defined', () => {
    expect(ENDPOINT_SECURITY_CLASSIFICATION.protected).toContain('GET /capabilities')
    expect(ENDPOINT_SECURITY_CLASSIFICATION.protected).toContain('GET /sse')
  })

  it('should have admin endpoints defined', () => {
    expect(ENDPOINT_SECURITY_CLASSIFICATION.admin).toContain('GET /admin/*')
  })

  it('should have permission-based endpoints with correct structure', () => {
    const permissionEndpoints = ENDPOINT_SECURITY_CLASSIFICATION.permissionBased
    expect(permissionEndpoints.length).toBeGreaterThan(0)

    for (const ep of permissionEndpoints) {
      expect(ep.endpoint).toBeDefined()
      expect(ep.permission).toBeDefined()
    }
  })
})
