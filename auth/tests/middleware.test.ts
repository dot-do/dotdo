import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { SignJWT } from 'jose'
import { authMiddleware, apiKeyMiddleware } from '../middleware'

describe('Auth Middleware', () => {
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

  describe('authMiddleware', () => {
    beforeEach(() => {
      app.use('/*', authMiddleware({ secret, issuer, audience }))
      app.get('/protected', (c) => c.json({ user: c.get('user') }))
    })

    it('should reject requests without Authorization header', async () => {
      const res = await app.request('/protected')
      expect(res.status).toBe(401)
    })

    it('should reject non-Bearer tokens', async () => {
      const res = await app.request('/protected', {
        headers: { Authorization: 'Basic abc123' }
      })
      expect(res.status).toBe(401)
    })

    it('should accept valid JWT Bearer token', async () => {
      const token = await createJWT({ sub: 'user-123', email: 'test@example.com', roles: ['admin'] })

      const res = await app.request('/protected', {
        headers: { Authorization: `Bearer ${token}` }
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.user.id).toBe('user-123')
      expect(json.user.email).toBe('test@example.com')
      expect(json.user.roles).toContain('admin')
    })

    it('should reject base64-encoded JSON (not a valid JWT)', async () => {
      // This was previously allowed by the permissive fallback - now it should fail
      const payload = { sub: 'user-123', email: 'test@example.com', roles: ['admin'] }
      const fakeToken = btoa(JSON.stringify(payload))

      const res = await app.request('/protected', {
        headers: { Authorization: `Bearer ${fakeToken}` }
      })

      expect(res.status).toBe(401)
    })

    it('should reject arbitrary strings as tokens', async () => {
      // This was previously allowed by the permissive fallback - now it should fail
      const res = await app.request('/protected', {
        headers: { Authorization: 'Bearer some-random-string' }
      })

      expect(res.status).toBe(401)
    })

    it('should reject JWT with invalid signature', async () => {
      const token = await createJWT({ sub: 'user-123' })
      // Tamper with the signature
      const parts = token.split('.')
      parts[2] = 'invalid_signature_here'
      const tamperedToken = parts.join('.')

      const res = await app.request('/protected', {
        headers: { Authorization: `Bearer ${tamperedToken}` }
      })

      expect(res.status).toBe(401)
    })

    it('should reject JWT with wrong issuer', async () => {
      const token = await createJWT({ sub: 'user-123' }, { iss: 'evil.com' })

      const res = await app.request('/protected', {
        headers: { Authorization: `Bearer ${token}` }
      })

      expect(res.status).toBe(401)
    })

    it('should reject JWT with wrong audience', async () => {
      const token = await createJWT({ sub: 'user-123' }, { aud: 'wrong.api' })

      const res = await app.request('/protected', {
        headers: { Authorization: `Bearer ${token}` }
      })

      expect(res.status).toBe(401)
    })

    it('should reject expired JWT', async () => {
      const token = await createJWT(
        { sub: 'user-123' },
        { exp: Math.floor(Date.now() / 1000) - 60 } // Expired 1 minute ago
      )

      const res = await app.request('/protected', {
        headers: { Authorization: `Bearer ${token}` }
      })

      expect(res.status).toBe(401)
    })

    it('should reject JWT without subject claim', async () => {
      // Create JWT without sub claim
      const jwt = new SignJWT({ email: 'test@example.com' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setIssuer(issuer)
        .setAudience(audience)
        .setExpirationTime('1h')

      const token = await jwt.sign(secret)

      const res = await app.request('/protected', {
        headers: { Authorization: `Bearer ${token}` }
      })

      expect(res.status).toBe(401)
      const body = await res.text()
      expect(body).toContain('subject')
    })

    it('should skip auth for specified paths', async () => {
      const skipApp = new Hono()
      skipApp.use('/*', authMiddleware({ secret, issuer, audience, skipPaths: ['/public', '/health'] }))
      skipApp.get('/public/data', (c) => c.json({ ok: true }))
      skipApp.get('/health', (c) => c.json({ status: 'ok' }))

      const res1 = await skipApp.request('/public/data')
      expect(res1.status).toBe(200)

      const res2 = await skipApp.request('/health')
      expect(res2.status).toBe(200)
    })

    it('should throw error if secret is not provided', () => {
      expect(() => {
        // @ts-expect-error - testing runtime validation
        authMiddleware({})
      }).toThrow('authMiddleware requires a secret')
    })

    it('should accept string secret', async () => {
      const stringSecretApp = new Hono()
      stringSecretApp.use('/*', authMiddleware({
        secret: 'test-secret-key-minimum-256-bits-long-for-hs256',
        issuer,
        audience
      }))
      stringSecretApp.get('/test', (c) => c.json({ user: c.get('user') }))

      const token = await createJWT({ sub: 'user-123' })

      const res = await stringSecretApp.request('/test', {
        headers: { Authorization: `Bearer ${token}` }
      })

      expect(res.status).toBe(200)
    })

    it('should handle non-array roles gracefully', async () => {
      const token = await createJWT({ sub: 'user-123', roles: 'admin' }) // string instead of array

      const res = await app.request('/protected', {
        headers: { Authorization: `Bearer ${token}` }
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.user.roles).toEqual([]) // Should default to empty array for non-array
    })

    it('should handle non-array scopes gracefully', async () => {
      const token = await createJWT({ sub: 'user-123', scopes: 'read:all' }) // string instead of array

      const res = await app.request('/protected', {
        headers: { Authorization: `Bearer ${token}` }
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.user.scopes).toEqual([]) // Should default to empty array for non-array
    })
  })

  describe('apiKeyMiddleware', () => {
    beforeEach(() => {
      app.use('/*', apiKeyMiddleware())
      app.get('/api', (c) => c.json({ user: c.get('user') }))
    })

    it('should reject requests without API key', async () => {
      const res = await app.request('/api')
      expect(res.status).toBe(401)
    })

    it('should accept valid API key', async () => {
      const res = await app.request('/api', {
        headers: { 'X-API-Key': 'my-secret-key-12345' }
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.user.id).toBe('apikey:my-secre')
      expect(json.user.roles).toContain('api')
    })

    it('should support custom header name', async () => {
      const customApp = new Hono()
      customApp.use('/*', apiKeyMiddleware({ header: 'X-Custom-Key' }))
      customApp.get('/api', (c) => c.json({ ok: true }))

      const res = await customApp.request('/api', {
        headers: { 'X-Custom-Key': 'custom-key' }
      })

      expect(res.status).toBe(200)
    })
  })
})
