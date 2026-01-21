/**
 * Auth <-> API Integration Tests
 *
 * Tests the full authentication flow through the API middleware layer.
 * Verifies JWT auth, API key auth, and unauthorized request handling
 * work correctly when integrated with Hono apps.
 *
 * Note: These tests use authMiddleware directly rather than createAPI()
 * because createAPI() has default skipPaths that include '/' which matches
 * all paths (via startsWith). This ensures we're testing the actual auth logic.
 *
 * @module auth/tests/api-integration
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { SignJWT } from 'jose'
import { HTTPException } from 'hono/http-exception'
import { authMiddleware, apiKeyMiddleware } from '../middleware'
import { validateToken } from '../token'
import { ApiKeyManager, createApiKeyMiddleware } from '../apikey'

describe('Auth <-> API Integration', () => {
  // Test constants
  const secret = 'test-secret-key-minimum-256-bits-long-for-hs256'
  const secretKey = new TextEncoder().encode(secret)
  const issuer = 'id.org.ai'
  const audience = 'dotdo.api'

  // Helper to create valid JWT
  async function createJWT(
    payload: Record<string, unknown>,
    options?: { exp?: number; iss?: string; aud?: string }
  ): Promise<string> {
    const jwt = new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setIssuer(options?.iss ?? issuer)
      .setAudience(options?.aud ?? audience)

    if (options?.exp !== undefined) {
      jwt.setExpirationTime(options.exp)
    } else {
      jwt.setExpirationTime('1h')
    }

    return jwt.sign(secretKey)
  }

  // Helper to create an authenticated app with standard middleware stack
  function createAuthenticatedApp(skipPaths: string[] = ['/health']) {
    const app = new Hono()

    // Error handler
    app.onError((error, c) => {
      if (error instanceof HTTPException) {
        return c.json({ error: error.message, status: error.status }, error.status)
      }
      return c.json({ error: 'Internal Server Error', status: 500 }, 500)
    })

    // Request ID middleware
    app.use('*', async (c, next) => {
      const requestId = c.req.header('X-Request-ID') || `${Date.now()}-${Math.random().toString(36).slice(2)}`
      c.set('requestId', requestId)
      await next()
      c.res.headers.set('X-Request-ID', requestId)
    })

    // Auth middleware
    app.use('*', authMiddleware({
      secret,
      issuer,
      audience,
      skipPaths
    }))

    return app
  }

  describe('JWT Auth through API Middleware', () => {
    it('should allow authenticated requests to protected routes', async () => {
      const app = createAuthenticatedApp(['/health'])

      app.get('/api/users', (c) => {
        const user = c.get('user')
        return c.json({ users: [], authenticated: true, userId: user?.id })
      })

      const token = await createJWT({ sub: 'user-123', email: 'test@example.com' })

      const res = await app.request('http://localhost/api/users', {
        headers: { Authorization: `Bearer ${token}` }
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.authenticated).toBe(true)
      expect(body.userId).toBe('user-123')
    })

    it('should reject unauthenticated requests to protected routes', async () => {
      const app = createAuthenticatedApp(['/health'])

      app.get('/api/users', (c) => c.json({ users: [] }))

      const res = await app.request('http://localhost/api/users')

      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body.error).toBeDefined()
    })

    it('should reject requests with invalid JWT signature', async () => {
      const app = createAuthenticatedApp(['/health'])

      app.get('/api/users', (c) => c.json({ users: [] }))

      const token = await createJWT({ sub: 'user-123' })
      // Tamper with the signature
      const parts = token.split('.')
      parts[2] = 'invalid_signature_xyz'
      const tamperedToken = parts.join('.')

      const res = await app.request('http://localhost/api/users', {
        headers: { Authorization: `Bearer ${tamperedToken}` }
      })

      expect(res.status).toBe(401)
    })

    it('should reject requests with expired JWT', async () => {
      const app = createAuthenticatedApp(['/health'])

      app.get('/api/users', (c) => c.json({ users: [] }))

      // Create expired token (expired 1 minute ago)
      const token = await createJWT(
        { sub: 'user-123' },
        { exp: Math.floor(Date.now() / 1000) - 60 }
      )

      const res = await app.request('http://localhost/api/users', {
        headers: { Authorization: `Bearer ${token}` }
      })

      expect(res.status).toBe(401)
    })

    it('should reject requests with wrong issuer', async () => {
      const app = createAuthenticatedApp(['/health'])

      app.get('/api/users', (c) => c.json({ users: [] }))

      const token = await createJWT({ sub: 'user-123' }, { iss: 'evil.com' })

      const res = await app.request('http://localhost/api/users', {
        headers: { Authorization: `Bearer ${token}` }
      })

      expect(res.status).toBe(401)
    })

    it('should reject requests with wrong audience', async () => {
      const app = createAuthenticatedApp(['/health'])

      app.get('/api/users', (c) => c.json({ users: [] }))

      const token = await createJWT({ sub: 'user-123' }, { aud: 'wrong.api' })

      const res = await app.request('http://localhost/api/users', {
        headers: { Authorization: `Bearer ${token}` }
      })

      expect(res.status).toBe(401)
    })

    it('should skip auth for configured skip paths', async () => {
      const app = createAuthenticatedApp(['/health', '/public'])

      // Add a public route
      app.get('/public/info', (c) => c.json({ info: 'public data' }))

      const res = await app.request('http://localhost/public/info')

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.info).toBe('public data')
    })

    it('should provide user context to route handlers', async () => {
      const app = createAuthenticatedApp(['/health'])

      app.get('/api/me', (c) => {
        const user = c.get('user')
        return c.json({
          id: user?.id,
          email: user?.email,
          roles: user?.roles,
          scopes: user?.scopes
        })
      })

      const token = await createJWT({
        sub: 'user-456',
        email: 'user@example.com',
        roles: ['admin', 'editor'],
        scopes: ['read:all', 'write:all']
      })

      const res = await app.request('http://localhost/api/me', {
        headers: { Authorization: `Bearer ${token}` }
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.id).toBe('user-456')
      expect(body.email).toBe('user@example.com')
      expect(body.roles).toContain('admin')
      expect(body.roles).toContain('editor')
      expect(body.scopes).toContain('read:all')
    })

    it('should include request ID in auth error responses', async () => {
      const app = createAuthenticatedApp(['/health'])

      app.get('/api/protected', (c) => c.json({ ok: true }))

      const res = await app.request('http://localhost/api/protected')

      expect(res.status).toBe(401)
      expect(res.headers.get('X-Request-ID')).toBeDefined()
    })
  })

  describe('API Key Auth through API Middleware', () => {
    let manager: ApiKeyManager

    beforeEach(() => {
      manager = new ApiKeyManager()
    })

    it('should allow requests with valid API key', async () => {
      // Create API with API key middleware
      const app = new Hono()
      app.use('/*', createApiKeyMiddleware(manager))
      app.get('/api/data', (c) => {
        const user = c.get('user')
        return c.json({ data: 'secret', userId: user?.id })
      })

      // Create a valid API key
      const { key } = await manager.create({
        name: 'Test Key',
        scopes: ['*']
      })

      const res = await app.request('/api/data', {
        headers: { 'X-API-Key': key }
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data).toBe('secret')
      expect(body.userId).toMatch(/^apikey:/)
    })

    it('should reject requests without API key header', async () => {
      const app = new Hono()
      app.use('/*', createApiKeyMiddleware(manager))
      app.get('/api/data', (c) => c.json({ data: 'secret' }))

      const res = await app.request('/api/data')

      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body.error).toContain('X-API-Key')
    })

    it('should reject requests with invalid API key', async () => {
      const app = new Hono()
      app.use('/*', createApiKeyMiddleware(manager))
      app.get('/api/data', (c) => c.json({ data: 'secret' }))

      const res = await app.request('/api/data', {
        headers: { 'X-API-Key': 'invalid_key12345678901234567890' }
      })

      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body.error).toBeDefined()
    })

    it('should reject requests with revoked API key', async () => {
      const app = new Hono()
      app.use('/*', createApiKeyMiddleware(manager))
      app.get('/api/data', (c) => c.json({ data: 'secret' }))

      // Create and revoke a key
      const { key, apiKey } = await manager.create({
        name: 'Revoked Key',
        scopes: ['*']
      })
      await manager.revoke(apiKey.id)

      const res = await app.request('/api/data', {
        headers: { 'X-API-Key': key }
      })

      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body.error).toContain('revoked')
    })

    it('should reject requests with expired API key', async () => {
      const app = new Hono()
      app.use('/*', createApiKeyMiddleware(manager))
      app.get('/api/data', (c) => c.json({ data: 'secret' }))

      // Create an expired key
      const { key } = await manager.create({
        name: 'Expired Key',
        scopes: ['*'],
        expiresAt: new Date(Date.now() - 60000) // Expired 1 minute ago
      })

      const res = await app.request('/api/data', {
        headers: { 'X-API-Key': key }
      })

      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body.error).toContain('expired')
    })

    it('should enforce scope requirements', async () => {
      const app = new Hono()
      app.use('/*', createApiKeyMiddleware(manager, {
        requireScopes: ['admin:write']
      }))
      app.get('/api/admin', (c) => c.json({ admin: true }))

      // Create a key without admin:write scope
      const { key } = await manager.create({
        name: 'Limited Key',
        scopes: ['users:read']
      })

      const res = await app.request('/api/admin', {
        headers: { 'X-API-Key': key }
      })

      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.error).toContain('scope')
    })

    it('should allow requests with matching scope', async () => {
      const app = new Hono()
      app.use('/*', createApiKeyMiddleware(manager, {
        requireScopes: ['admin:write']
      }))
      app.get('/api/admin', (c) => c.json({ admin: true }))

      // Create a key with admin:write scope
      const { key } = await manager.create({
        name: 'Admin Key',
        scopes: ['admin:write']
      })

      const res = await app.request('/api/admin', {
        headers: { 'X-API-Key': key }
      })

      expect(res.status).toBe(200)
    })

    it('should allow wildcard scopes', async () => {
      const app = new Hono()
      app.use('/*', createApiKeyMiddleware(manager, {
        requireScopes: ['users:delete']
      }))
      app.delete('/api/users/:id', (c) => c.json({ deleted: true }))

      // Create a key with users:* wildcard scope
      const { key } = await manager.create({
        name: 'Users Manager Key',
        scopes: ['users:*']
      })

      const res = await app.request('/api/users/123', {
        method: 'DELETE',
        headers: { 'X-API-Key': key }
      })

      expect(res.status).toBe(200)
    })

    it('should enforce rate limits', async () => {
      const app = new Hono()
      app.use('/*', createApiKeyMiddleware(manager))
      app.get('/api/data', (c) => c.json({ ok: true }))

      // Create a key with a low rate limit
      const { key } = await manager.create({
        name: 'Rate Limited Key',
        scopes: ['*'],
        rateLimit: {
          maxRequests: 2,
          windowMs: 60000
        }
      })

      // First two requests should succeed
      const res1 = await app.request('/api/data', {
        headers: { 'X-API-Key': key }
      })
      expect(res1.status).toBe(200)

      const res2 = await app.request('/api/data', {
        headers: { 'X-API-Key': key }
      })
      expect(res2.status).toBe(200)

      // Third request should be rate limited
      const res3 = await app.request('/api/data', {
        headers: { 'X-API-Key': key }
      })
      expect(res3.status).toBe(429)
      const body = await res3.json()
      expect(body.error).toContain('Rate limit')
    })

    it('should support custom header name', async () => {
      const app = new Hono()
      app.use('/*', createApiKeyMiddleware(manager, {
        header: 'X-Custom-Key'
      }))
      app.get('/api/data', (c) => c.json({ ok: true }))

      const { key } = await manager.create({
        name: 'Custom Header Key',
        scopes: ['*']
      })

      const res = await app.request('/api/data', {
        headers: { 'X-Custom-Key': key }
      })

      expect(res.status).toBe(200)
    })
  })

  describe('Unauthorized Request Rejection', () => {
    it('should reject requests with malformed Authorization header', async () => {
      const app = createAuthenticatedApp(['/health'])

      app.get('/api/protected', (c) => c.json({ ok: true }))

      // Test various malformed headers
      const malformedHeaders = [
        'Bearer', // Missing token
        'Basic abc123', // Wrong scheme
        'bearer token123', // Wrong case (should be Bearer)
        'Token abc123', // Wrong scheme
        'Bearer  ', // Empty token after Bearer
      ]

      for (const authHeader of malformedHeaders) {
        const res = await app.request('http://localhost/api/protected', {
          headers: { Authorization: authHeader }
        })
        expect(res.status).toBe(401)
      }
    })

    it('should reject requests with arbitrary base64 strings (not JWTs)', async () => {
      const app = createAuthenticatedApp(['/health'])

      app.get('/api/protected', (c) => c.json({ ok: true }))

      // Create a base64-encoded JSON that's not a valid JWT
      const fakePayload = { sub: 'user-123', email: 'test@example.com' }
      const fakeToken = btoa(JSON.stringify(fakePayload))

      const res = await app.request('http://localhost/api/protected', {
        headers: { Authorization: `Bearer ${fakeToken}` }
      })

      expect(res.status).toBe(401)
    })

    it('should reject requests with JWT signed by different secret', async () => {
      const app = createAuthenticatedApp(['/health'])

      app.get('/api/protected', (c) => c.json({ ok: true }))

      // Create JWT with a different secret
      const differentSecret = new TextEncoder().encode('different-secret-key-also-256-bits-long')
      const token = await new SignJWT({ sub: 'user-123' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setIssuer(issuer)
        .setAudience(audience)
        .setExpirationTime('1h')
        .sign(differentSecret)

      const res = await app.request('http://localhost/api/protected', {
        headers: { Authorization: `Bearer ${token}` }
      })

      expect(res.status).toBe(401)
    })

    it('should reject requests with JWT missing subject claim', async () => {
      const app = createAuthenticatedApp(['/health'])

      app.get('/api/protected', (c) => c.json({ ok: true }))

      // Create JWT without sub claim
      const token = await new SignJWT({ email: 'test@example.com' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setIssuer(issuer)
        .setAudience(audience)
        .setExpirationTime('1h')
        .sign(secretKey)

      const res = await app.request('http://localhost/api/protected', {
        headers: { Authorization: `Bearer ${token}` }
      })

      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body.error).toContain('subject')
    })

    it('should return 401 not 500 for all auth failures', async () => {
      const app = createAuthenticatedApp(['/health'])

      app.get('/api/protected', (c) => c.json({ ok: true }))

      // Test various failure scenarios - all should be 401, not 500
      const testCases = [
        { name: 'no auth header', headers: {} },
        { name: 'invalid token', headers: { Authorization: 'Bearer invalid.token.here' } },
        { name: 'malformed JWT', headers: { Authorization: 'Bearer abc.def' } },
      ]

      for (const testCase of testCases) {
        const res = await app.request('http://localhost/api/protected', {
          headers: testCase.headers
        })
        expect(res.status, `${testCase.name} should return 401`).toBe(401)
        expect(res.status, `${testCase.name} should not return 500`).not.toBe(500)
      }
    })
  })

  describe('Combined Auth Strategies', () => {
    it('should work with both JWT and API key routes in same app', async () => {
      // Create base app with JWT auth that skips /api/v1/public
      const app = new Hono()

      // Error handler
      app.onError((error, c) => {
        if (error instanceof HTTPException) {
          return c.json({ error: error.message, status: error.status }, error.status)
        }
        return c.json({ error: 'Internal Server Error', status: 500 }, 500)
      })

      // JWT auth middleware that skips public paths
      app.use('*', authMiddleware({
        secret,
        issuer,
        audience,
        skipPaths: ['/health', '/api/v1/public']
      }))

      // Add JWT-protected route
      app.get('/api/v1/users', (c) => {
        const user = c.get('user')
        return c.json({ source: 'jwt', userId: user?.id })
      })

      // Create separate router for API key auth
      const apiKeyManager = new ApiKeyManager()
      const apiKeyRouter = new Hono()
      apiKeyRouter.use('/*', createApiKeyMiddleware(apiKeyManager))
      apiKeyRouter.get('/data', (c) => {
        const user = c.get('user')
        return c.json({ source: 'apikey', userId: user?.id })
      })

      // Mount API key router on public path (skipped by JWT auth)
      app.route('/api/v1/public', apiKeyRouter)

      // Test JWT auth
      const jwtToken = await createJWT({ sub: 'jwt-user-123' })
      const jwtRes = await app.request('http://localhost/api/v1/users', {
        headers: { Authorization: `Bearer ${jwtToken}` }
      })
      expect(jwtRes.status).toBe(200)
      const jwtBody = await jwtRes.json()
      expect(jwtBody.source).toBe('jwt')
      expect(jwtBody.userId).toBe('jwt-user-123')

      // Test API key auth
      const { key } = await apiKeyManager.create({ name: 'Test', scopes: ['*'] })
      const apiKeyRes = await app.request('http://localhost/api/v1/public/data', {
        headers: { 'X-API-Key': key }
      })
      expect(apiKeyRes.status).toBe(200)
      const apiKeyBody = await apiKeyRes.json()
      expect(apiKeyBody.source).toBe('apikey')
      expect(apiKeyBody.userId).toMatch(/^apikey:/)
    })
  })

  describe('validateToken Middleware', () => {
    it('should work as alternative to authMiddleware', async () => {
      const app = new Hono()
      app.use('/*', validateToken({
        secret,
        issuer,
        audience,
        skipPaths: ['/health']
      }))
      app.get('/protected', (c) => {
        const user = c.get('user')
        return c.json({ userId: user?.id })
      })
      app.get('/health', (c) => c.json({ ok: true }))

      // Test protected route with valid token
      const token = await createJWT({ sub: 'user-789' })
      const res = await app.request('/protected', {
        headers: { Authorization: `Bearer ${token}` }
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.userId).toBe('user-789')

      // Test skip path
      const healthRes = await app.request('/health')
      expect(healthRes.status).toBe(200)
    })

    it('should support cookie-based token extraction', async () => {
      const app = new Hono()
      app.use('/*', validateToken({
        secret,
        issuer,
        audience,
        cookieName: 'session_token'
      }))
      app.get('/protected', (c) => {
        const user = c.get('user')
        return c.json({ userId: user?.id })
      })

      const token = await createJWT({ sub: 'cookie-user' })

      const res = await app.request('/protected', {
        headers: { Cookie: `session_token=${token}` }
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.userId).toBe('cookie-user')
    })

    it('should add WWW-Authenticate header on auth failures', async () => {
      const app = new Hono()
      app.use('/*', validateToken({
        secret,
        issuer,
        audience
      }))
      app.get('/protected', (c) => c.json({ ok: true }))

      const res = await app.request('/protected')

      expect(res.status).toBe(401)
      expect(res.headers.get('WWW-Authenticate')).toContain('Bearer')
    })

    it('should add X-Token-Refresh-Hint when token is near expiration', async () => {
      const app = new Hono()
      app.use('/*', validateToken({
        secret,
        issuer,
        audience,
        refreshThreshold: 3600 // 1 hour threshold
      }))
      app.get('/protected', (c) => c.json({ ok: true }))

      // Create token expiring in 30 minutes (within threshold)
      const token = await createJWT(
        { sub: 'user-123' },
        { exp: Math.floor(Date.now() / 1000) + 1800 }
      )

      const res = await app.request('/protected', {
        headers: { Authorization: `Bearer ${token}` }
      })

      expect(res.status).toBe(200)
      expect(res.headers.get('X-Token-Refresh-Hint')).toBe('true')
    })
  })
})
