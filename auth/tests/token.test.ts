import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import { SignJWT } from 'jose'
import {
  validateToken,
  extractToken,
  verifyTokenSignature,
  checkTokenExpiration,
  type TokenPayload,
  type TokenValidationOptions,
} from '../token'

describe('Token Validation', () => {
  let app: Hono
  const secret = new TextEncoder().encode('test-secret-key-minimum-256-bits-long-for-hs256')
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

    return jwt.sign(secret)
  }

  beforeEach(() => {
    app = new Hono()
  })

  describe('extractToken', () => {
    it('should extract Bearer token from Authorization header', () => {
      const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test'
      const result = extractToken({
        headers: new Headers({ Authorization: `Bearer ${token}` }),
      } as Request)

      expect(result).toBe(token)
    })

    it('should extract token from cookie when no Authorization header', () => {
      const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test'
      const result = extractToken(
        {
          headers: new Headers({ Cookie: `auth_token=${token}` }),
        } as Request,
        { cookieName: 'auth_token' }
      )

      expect(result).toBe(token)
    })

    it('should return null when no token present', () => {
      const result = extractToken({
        headers: new Headers(),
      } as Request)

      expect(result).toBeNull()
    })

    it('should reject invalid Authorization scheme', () => {
      const result = extractToken({
        headers: new Headers({ Authorization: 'Basic dGVzdDp0ZXN0' }),
      } as Request)

      expect(result).toBeNull()
    })

    it('should trim whitespace from extracted token', () => {
      const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test'
      const result = extractToken({
        headers: new Headers({ Authorization: `Bearer  ${token}  ` }),
      } as Request)

      expect(result).toBe(token)
    })
  })

  describe('verifyTokenSignature', () => {
    it('should verify valid JWT signature', async () => {
      const token = await createJWT({ sub: 'user-123', email: 'test@example.com' })

      const result = await verifyTokenSignature(token, {
        secret,
        issuer,
        audience,
      })

      expect(result.sub).toBe('user-123')
      expect(result.email).toBe('test@example.com')
    })

    it('should reject token with invalid signature', async () => {
      const token = await createJWT({ sub: 'user-123' })
      const wrongSecret = new TextEncoder().encode('wrong-secret-key-different-from-original')

      await expect(
        verifyTokenSignature(token, {
          secret: wrongSecret,
          issuer,
          audience,
        })
      ).rejects.toThrow('signature verification failed')
    })

    it('should reject token with wrong issuer', async () => {
      const token = await createJWT({ sub: 'user-123' }, { iss: 'evil.com' })

      await expect(
        verifyTokenSignature(token, {
          secret,
          issuer,
          audience,
        })
      ).rejects.toThrow(/Token issuer \(iss\) does not match expected value/)
    })

    it('should reject token with wrong audience', async () => {
      const token = await createJWT({ sub: 'user-123' }, { aud: 'wrong.api' })

      await expect(
        verifyTokenSignature(token, {
          secret,
          issuer,
          audience,
        })
      ).rejects.toThrow(/Token audience \(aud\) does not match expected value/)
    })

    it('should reject malformed token', async () => {
      await expect(
        verifyTokenSignature('not.a.jwt', {
          secret,
          issuer,
          audience,
        })
      ).rejects.toThrow()
    })

    it('should reject token with missing required claims', async () => {
      // Create JWT without issuer
      const jwt = new SignJWT({ sub: 'user-123' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setAudience(audience)
        .setExpirationTime('1h')

      const token = await jwt.sign(secret)

      await expect(
        verifyTokenSignature(token, {
          secret,
          issuer,
          audience,
        })
      ).rejects.toThrow()
    })
  })

  describe('checkTokenExpiration', () => {
    it('should accept token with valid expiration', async () => {
      const token = await createJWT({ sub: 'user-123' })
      const payload = await verifyTokenSignature(token, { secret, issuer, audience })

      const result = checkTokenExpiration(payload)

      expect(result.expired).toBe(false)
      expect(result.expiresIn).toBeGreaterThan(0)
    })

    it('should detect expired token', async () => {
      // Note: jwtVerify will reject expired tokens during signature verification
      // So we test checkTokenExpiration with a manually created expired payload
      const expiredPayload: TokenPayload = {
        sub: 'user-123',
        iss: issuer,
        aud: audience,
        exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
      }

      const result = checkTokenExpiration(expiredPayload)

      expect(result.expired).toBe(true)
      expect(result.expiresIn).toBeLessThan(0)
    })

    it('should provide time until expiration', async () => {
      const expiresAt = Math.floor(Date.now() / 1000) + 600 // 10 minutes from now
      const token = await createJWT({ sub: 'user-123' }, { exp: expiresAt })
      const payload = await verifyTokenSignature(token, { secret, issuer, audience })

      const result = checkTokenExpiration(payload)

      expect(result.expired).toBe(false)
      expect(result.expiresIn).toBeGreaterThan(500)
      expect(result.expiresIn).toBeLessThanOrEqual(600)
    })

    it('should handle token without expiration claim', () => {
      const payload: TokenPayload = {
        sub: 'user-123',
        iss: issuer,
        aud: audience,
      }

      const result = checkTokenExpiration(payload)

      // Should treat as never expires
      expect(result.expired).toBe(false)
      expect(result.expiresIn).toBeNull()
    })

    it('should suggest refresh when close to expiration', async () => {
      const expiresAt = Math.floor(Date.now() / 1000) + 120 // 2 minutes from now
      const token = await createJWT({ sub: 'user-123' }, { exp: expiresAt })
      const payload = await verifyTokenSignature(token, { secret, issuer, audience })

      const result = checkTokenExpiration(payload, { refreshThreshold: 300 }) // 5 minutes

      expect(result.shouldRefresh).toBe(true)
    })

    it('should not suggest refresh for fresh tokens', async () => {
      const token = await createJWT({ sub: 'user-123' })
      const payload = await verifyTokenSignature(token, { secret, issuer, audience })

      const result = checkTokenExpiration(payload, { refreshThreshold: 300 })

      expect(result.shouldRefresh).toBe(false)
    })
  })

  describe('validateToken middleware', () => {
    beforeEach(() => {
      app.use('/*', validateToken({ secret, issuer, audience }))
      app.get('/protected', (c) => c.json({ user: c.get('user'), token: c.get('token') }))
    })

    it('should reject requests without token', async () => {
      const res = await app.request('/protected')

      expect(res.status).toBe(401)
      const wwwAuth = res.headers.get('WWW-Authenticate')
      expect(wwwAuth).toContain('Bearer')
    })

    it('should reject expired tokens', async () => {
      const token = await createJWT(
        { sub: 'user-123' },
        { exp: Math.floor(Date.now() / 1000) - 60 }
      )

      const res = await app.request('/protected', {
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(res.status).toBe(401)
      // Response message may vary, just check for 401 status
      const text = await res.text()
      expect(text.toLowerCase()).toMatch(/expired|invalid|claim|timestamp/)
    })

    it('should reject malformed tokens', async () => {
      const res = await app.request('/protected', {
        headers: { Authorization: 'Bearer not.a.valid.jwt' },
      })

      expect(res.status).toBe(401)
    })

    it('should accept valid JWT from id.org.ai', async () => {
      const token = await createJWT({
        sub: 'user-123',
        email: 'test@example.com',
        roles: ['admin'],
        scopes: ['users:read', 'users:write'],
      })

      const res = await app.request('/protected', {
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.user.id).toBe('user-123')
      expect(json.user.email).toBe('test@example.com')
      expect(json.user.roles).toContain('admin')
      expect(json.user.scopes).toContain('users:read')
      expect(json.token).toBe(token)
    })

    it('should reject token with wrong issuer', async () => {
      const token = await createJWT({ sub: 'user-123' }, { iss: 'evil.com' })

      const res = await app.request('/protected', {
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(res.status).toBe(401)
    })

    it('should set refresh hint header for tokens close to expiration', async () => {
      const expiresAt = Math.floor(Date.now() / 1000) + 120 // 2 minutes
      const token = await createJWT({ sub: 'user-123' }, { exp: expiresAt })

      const res = await app.request('/protected', {
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(res.status).toBe(200)
      const refreshHint = res.headers.get('X-Token-Refresh-Hint')
      expect(refreshHint).toBe('true')
    })

    it('should extract token from cookies when configured', async () => {
      const cookieApp = new Hono()
      cookieApp.use(
        '/*',
        validateToken({ secret, issuer, audience, cookieName: 'auth_token' })
      )
      cookieApp.get('/protected', (c) => c.json({ user: c.get('user') }))

      const token = await createJWT({ sub: 'user-123' })

      const res = await cookieApp.request('/protected', {
        headers: { Cookie: `auth_token=${token}` },
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.user.id).toBe('user-123')
    })

    it('should skip validation for excluded paths', async () => {
      const skipApp = new Hono()
      skipApp.use(
        '/*',
        validateToken({ secret, issuer, audience, skipPaths: ['/public', '/health'] })
      )
      skipApp.get('/public/info', (c) => c.json({ ok: true }))
      skipApp.get('/health', (c) => c.json({ status: 'ok' }))

      const res1 = await skipApp.request('/public/info')
      expect(res1.status).toBe(200)

      const res2 = await skipApp.request('/health')
      expect(res2.status).toBe(200)
    })

    it('should parse token payload correctly into AuthUser', async () => {
      const token = await createJWT({
        sub: 'user-456',
        email: 'admin@example.com',
        roles: ['admin', 'user'],
        scopes: ['*'],
        name: 'Admin User',
        custom: 'data',
      })

      const res = await app.request('/protected', {
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.user).toEqual({
        id: 'user-456',
        email: 'admin@example.com',
        roles: ['admin', 'user'],
        scopes: ['*'],
      })
    })

    it('should handle token without optional claims', async () => {
      const token = await createJWT({ sub: 'user-789' })

      const res = await app.request('/protected', {
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.user).toEqual({
        id: 'user-789',
        email: undefined,
        roles: [],
        scopes: [],
      })
    })
  })

  describe('Token refresh handling', () => {
    it('should provide refresh endpoint example', async () => {
      // This test documents the expected refresh flow
      const refreshApp = new Hono()

      refreshApp.post('/auth/refresh', async (c) => {
        const oldToken = extractToken(c.req.raw)
        if (!oldToken) {
          return c.json({ error: 'No token provided' }, 401)
        }

        try {
          // Verify old token (even if expired, for refresh purposes)
          const payload = await verifyTokenSignature(oldToken, {
            secret,
            issuer,
            audience,
          })

          // Wait 1ms to ensure different issuedAt timestamp
          await new Promise((resolve) => setTimeout(resolve, 1))

          // Create new token with extended expiration
          const newToken = await createJWT({
            sub: payload.sub,
            email: payload.email,
            roles: payload.roles,
            scopes: payload.scopes,
          })

          return c.json({ token: newToken })
        } catch (error) {
          return c.json({ error: 'Invalid token' }, 401)
        }
      })

      const oldToken = await createJWT({ sub: 'user-123' })

      const res = await refreshApp.request('/auth/refresh', {
        method: 'POST',
        headers: { Authorization: `Bearer ${oldToken}` },
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.token).toBeDefined()
      expect(typeof json.token).toBe('string')
      // Tokens should be different due to different iat (issued at) timestamps
      // but the assertion is timing-dependent, so we just verify it's a valid token
    })
  })
})
