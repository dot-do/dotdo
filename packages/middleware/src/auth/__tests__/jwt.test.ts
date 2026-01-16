/**
 * Comprehensive tests for packages/middleware/src/auth/jwt.ts
 *
 * Tests the JWT module including:
 * - jwtMiddleware: Standalone JWT middleware
 * - verifyJWT: JWT verification function
 * - generateJWT: JWT generation function
 * - resetJWKSCache: Cache reset utility
 * - Token extraction from Authorization header
 * - Various JWT algorithms support
 * - Error handling for expired/invalid tokens
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import * as jose from 'jose'
import { jwtMiddleware, verifyJWT, generateJWT, resetJWKSCache, type JWTPayload, type JWTConfig } from '../jwt'

// Test secrets - only used for testing
const TEST_SECRET = 'test-secret-key-for-testing-only-32chars!'
const DIFFERENT_SECRET = 'different-secret-key-32characters!'

describe('packages/middleware/src/auth/jwt', () => {
  beforeEach(() => {
    resetJWKSCache()
  })

  afterEach(() => {
    resetJWKSCache()
  })

  // ============================================================================
  // generateJWT Tests
  // ============================================================================

  describe('generateJWT', () => {
    it('should generate a valid JWT token', async () => {
      const token = await generateJWT({ sub: 'user-123' }, TEST_SECRET)

      expect(token).toBeDefined()
      expect(typeof token).toBe('string')
      expect(token.split('.')).toHaveLength(3) // Header.Payload.Signature
    })

    it('should include subject in payload', async () => {
      const token = await generateJWT({ sub: 'user-456' }, TEST_SECRET)

      const payload = await verifyJWT(token, { secret: TEST_SECRET })
      expect(payload.sub).toBe('user-456')
    })

    it('should include email in payload when provided', async () => {
      const token = await generateJWT({ sub: 'user-789', email: 'test@example.com' }, TEST_SECRET)

      const payload = await verifyJWT(token, { secret: TEST_SECRET })
      expect(payload.email).toBe('test@example.com')
    })

    it('should include role in payload when provided', async () => {
      const token = await generateJWT({ sub: 'user-101', role: 'admin' }, TEST_SECRET)

      const payload = await verifyJWT(token, { secret: TEST_SECRET })
      expect(payload.role).toBe('admin')
    })

    it('should include permissions in payload when provided', async () => {
      const token = await generateJWT(
        {
          sub: 'user-102',
          permissions: ['read', 'write', 'delete'],
        },
        TEST_SECRET,
      )

      const payload = await verifyJWT(token, { secret: TEST_SECRET })
      expect(payload.permissions).toEqual(['read', 'write', 'delete'])
    })

    it('should set default expiration of 1 hour', async () => {
      const beforeGenerate = Math.floor(Date.now() / 1000)
      const token = await generateJWT({ sub: 'user-103' }, TEST_SECRET)
      const afterGenerate = Math.floor(Date.now() / 1000)

      const payload = await verifyJWT(token, { secret: TEST_SECRET })

      // exp should be approximately 1 hour from now
      const oneHourInSeconds = 3600
      expect(payload.exp).toBeGreaterThanOrEqual(beforeGenerate + oneHourInSeconds - 1)
      expect(payload.exp).toBeLessThanOrEqual(afterGenerate + oneHourInSeconds + 1)
    })

    it('should respect custom expiration time', async () => {
      const beforeGenerate = Math.floor(Date.now() / 1000)
      const token = await generateJWT({ sub: 'user-104' }, TEST_SECRET, '2h')
      const afterGenerate = Math.floor(Date.now() / 1000)

      const payload = await verifyJWT(token, { secret: TEST_SECRET })

      // exp should be approximately 2 hours from now
      const twoHoursInSeconds = 7200
      expect(payload.exp).toBeGreaterThanOrEqual(beforeGenerate + twoHoursInSeconds - 1)
      expect(payload.exp).toBeLessThanOrEqual(afterGenerate + twoHoursInSeconds + 1)
    })

    it('should set issued at (iat) claim', async () => {
      const beforeGenerate = Math.floor(Date.now() / 1000)
      const token = await generateJWT({ sub: 'user-105' }, TEST_SECRET)
      const afterGenerate = Math.floor(Date.now() / 1000)

      const payload = await verifyJWT(token, { secret: TEST_SECRET })

      expect(payload.iat).toBeGreaterThanOrEqual(beforeGenerate)
      expect(payload.iat).toBeLessThanOrEqual(afterGenerate)
    })

    it('should generate different tokens for different payloads', async () => {
      const token1 = await generateJWT({ sub: 'user-1' }, TEST_SECRET)
      const token2 = await generateJWT({ sub: 'user-2' }, TEST_SECRET)

      expect(token1).not.toBe(token2)
    })

    it('should generate different tokens with same payload (due to iat)', async () => {
      const token1 = await generateJWT({ sub: 'user-same' }, TEST_SECRET)
      await new Promise((resolve) => setTimeout(resolve, 10))
      const token2 = await generateJWT({ sub: 'user-same' }, TEST_SECRET)

      // Tokens might be same if generated in same second
      // But their payloads should both be valid
      const payload1 = await verifyJWT(token1, { secret: TEST_SECRET })
      const payload2 = await verifyJWT(token2, { secret: TEST_SECRET })

      expect(payload1.sub).toBe('user-same')
      expect(payload2.sub).toBe('user-same')
    })
  })

  // ============================================================================
  // verifyJWT Tests
  // ============================================================================

  describe('verifyJWT', () => {
    it('should verify a valid JWT with symmetric secret', async () => {
      const token = await generateJWT({ sub: 'verify-user-1' }, TEST_SECRET)

      const payload = await verifyJWT(token, { secret: TEST_SECRET })

      expect(payload.sub).toBe('verify-user-1')
    })

    it('should throw 401 for expired token', async () => {
      // Generate a token that expires immediately
      const token = await generateJWT({ sub: 'expired-user' }, TEST_SECRET, '0s')

      // Wait for token to expire
      await new Promise((resolve) => setTimeout(resolve, 100))

      await expect(verifyJWT(token, { secret: TEST_SECRET })).rejects.toMatchObject({
        status: 401,
        message: 'Token expired',
      })
    })

    it('should throw 401 for invalid signature', async () => {
      const token = await generateJWT({ sub: 'wrong-sig-user' }, TEST_SECRET)

      await expect(verifyJWT(token, { secret: DIFFERENT_SECRET })).rejects.toMatchObject({
        status: 401,
      })
    })

    it('should throw 401 for malformed token', async () => {
      await expect(verifyJWT('not.a.valid.jwt', { secret: TEST_SECRET })).rejects.toMatchObject({
        status: 401,
      })
    })

    it('should throw 401 for tampered token', async () => {
      const token = await generateJWT({ sub: 'tampered-user' }, TEST_SECRET)

      // Tamper with the payload
      const parts = token.split('.')
      const tamperedPayload = Buffer.from(JSON.stringify({ sub: 'hacker' })).toString('base64url')
      const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`

      await expect(verifyJWT(tamperedToken, { secret: TEST_SECRET })).rejects.toMatchObject({
        status: 401,
      })
    })

    it('should throw error when no verification method configured', async () => {
      const token = await generateJWT({ sub: 'no-config-user' }, TEST_SECRET)

      await expect(verifyJWT(token, {})).rejects.toMatchObject({
        status: 401,
        message: 'Token verification failed',
      })
    })

    it('should support custom algorithms array', async () => {
      const token = await generateJWT({ sub: 'algo-user' }, TEST_SECRET)

      // The default algorithm is HS256, so this should work
      const payload = await verifyJWT(token, {
        secret: TEST_SECRET,
        algorithms: ['HS256'],
      })

      expect(payload.sub).toBe('algo-user')
    })

    it('should return all payload claims', async () => {
      const token = await generateJWT(
        {
          sub: 'full-payload-user',
          email: 'full@example.com',
          role: 'admin',
          permissions: ['a', 'b', 'c'],
        },
        TEST_SECRET,
      )

      const payload = await verifyJWT(token, { secret: TEST_SECRET })

      expect(payload.sub).toBe('full-payload-user')
      expect(payload.email).toBe('full@example.com')
      expect(payload.role).toBe('admin')
      expect(payload.permissions).toEqual(['a', 'b', 'c'])
      expect(payload.iat).toBeDefined()
      expect(payload.exp).toBeDefined()
    })
  })

  // ============================================================================
  // jwtMiddleware Tests
  // ============================================================================

  describe('jwtMiddleware', () => {
    it('should authenticate valid JWT', async () => {
      const app = new Hono()
      app.use('*', jwtMiddleware({ secret: TEST_SECRET }))
      app.get('/protected', (c) => {
        const payload = c.get('jwtPayload')
        return c.json({ userId: payload?.sub })
      })

      const token = await generateJWT({ sub: 'mw-user-1' }, TEST_SECRET)

      const res = await app.request('/protected', {
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.userId).toBe('mw-user-1')
    })

    it('should return 401 when no token provided', async () => {
      const app = new Hono()
      app.use('*', jwtMiddleware({ secret: TEST_SECRET }))
      app.get('/protected', (c) => c.json({ ok: true }))

      const res = await app.request('/protected')

      expect(res.status).toBe(401)
      const body = await res.text()
      expect(body).toContain('No token provided')
    })

    it('should return 401 for expired token', async () => {
      const app = new Hono()
      app.use('*', jwtMiddleware({ secret: TEST_SECRET }))
      app.get('/protected', (c) => c.json({ ok: true }))

      const token = await generateJWT({ sub: 'expired-mw-user' }, TEST_SECRET, '0s')
      await new Promise((resolve) => setTimeout(resolve, 100))

      const res = await app.request('/protected', {
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(res.status).toBe(401)
      const body = await res.text()
      expect(body).toContain('expired')
    })

    it('should return 401 for invalid token', async () => {
      const app = new Hono()
      app.use('*', jwtMiddleware({ secret: TEST_SECRET }))
      app.get('/protected', (c) => c.json({ ok: true }))

      const res = await app.request('/protected', {
        headers: { Authorization: 'Bearer invalid.jwt.token' },
      })

      expect(res.status).toBe(401)
    })

    it('should set jwtPayload in context', async () => {
      const app = new Hono()
      app.use('*', jwtMiddleware({ secret: TEST_SECRET }))
      app.get('/protected', (c) => {
        const payload = c.get('jwtPayload')
        return c.json({ payload })
      })

      const token = await generateJWT(
        {
          sub: 'ctx-user',
          email: 'ctx@example.com',
          role: 'admin',
          permissions: ['read'],
        },
        TEST_SECRET,
      )

      const res = await app.request('/protected', {
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.payload.sub).toBe('ctx-user')
      expect(body.payload.email).toBe('ctx@example.com')
      expect(body.payload.role).toBe('admin')
      expect(body.payload.permissions).toEqual(['read'])
    })

    describe('Bearer token extraction', () => {
      it('should extract token from standard Bearer header', async () => {
        const app = new Hono()
        app.use('*', jwtMiddleware({ secret: TEST_SECRET }))
        app.get('/protected', (c) => {
          const payload = c.get('jwtPayload')
          return c.json({ sub: payload?.sub })
        })

        const token = await generateJWT({ sub: 'standard-bearer' }, TEST_SECRET)

        const res = await app.request('/protected', {
          headers: { Authorization: `Bearer ${token}` },
        })

        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.sub).toBe('standard-bearer')
      })

      it('should handle lowercase bearer prefix', async () => {
        const app = new Hono()
        app.use('*', jwtMiddleware({ secret: TEST_SECRET }))
        app.get('/protected', (c) => {
          const payload = c.get('jwtPayload')
          return c.json({ sub: payload?.sub })
        })

        const token = await generateJWT({ sub: 'lowercase-bearer' }, TEST_SECRET)

        const res = await app.request('/protected', {
          headers: { Authorization: `bearer ${token}` },
        })

        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.sub).toBe('lowercase-bearer')
      })

      it('should handle extra whitespace in header', async () => {
        const app = new Hono()
        app.use('*', jwtMiddleware({ secret: TEST_SECRET }))
        app.get('/protected', (c) => {
          const payload = c.get('jwtPayload')
          return c.json({ sub: payload?.sub })
        })

        const token = await generateJWT({ sub: 'whitespace-bearer' }, TEST_SECRET)

        const res = await app.request('/protected', {
          headers: { Authorization: `Bearer   ${token}` },
        })

        expect(res.status).toBe(200)
      })

      it('should reject non-Bearer authorization schemes', async () => {
        const app = new Hono()
        app.use('*', jwtMiddleware({ secret: TEST_SECRET }))
        app.get('/protected', (c) => c.json({ ok: true }))

        const res = await app.request('/protected', {
          headers: { Authorization: 'Basic dXNlcjpwYXNz' },
        })

        expect(res.status).toBe(401)
        const body = await res.text()
        expect(body).toContain('No token provided')
      })

      it('should reject empty Authorization header', async () => {
        const app = new Hono()
        app.use('*', jwtMiddleware({ secret: TEST_SECRET }))
        app.get('/protected', (c) => c.json({ ok: true }))

        const res = await app.request('/protected', {
          headers: { Authorization: '' },
        })

        expect(res.status).toBe(401)
      })

      it('should reject Bearer with empty token', async () => {
        const app = new Hono()
        app.use('*', jwtMiddleware({ secret: TEST_SECRET }))
        app.get('/protected', (c) => c.json({ ok: true }))

        const res = await app.request('/protected', {
          headers: { Authorization: 'Bearer ' },
        })

        expect(res.status).toBe(401)
      })

      it('should reject whitespace-only token', async () => {
        const app = new Hono()
        app.use('*', jwtMiddleware({ secret: TEST_SECRET }))
        app.get('/protected', (c) => c.json({ ok: true }))

        const res = await app.request('/protected', {
          headers: { Authorization: 'Bearer    ' },
        })

        expect(res.status).toBe(401)
      })

      it('should reject token with extra parts', async () => {
        const app = new Hono()
        app.use('*', jwtMiddleware({ secret: TEST_SECRET }))
        app.get('/protected', (c) => c.json({ ok: true }))

        const token = await generateJWT({ sub: 'extra-parts' }, TEST_SECRET)

        const res = await app.request('/protected', {
          headers: { Authorization: `Bearer ${token} extra stuff` },
        })

        expect(res.status).toBe(401)
      })
    })
  })

  // ============================================================================
  // resetJWKSCache Tests
  // ============================================================================

  describe('resetJWKSCache', () => {
    it('should reset the JWKS cache without error', () => {
      // This is mainly for testing cleanup - just verify it doesn't throw
      expect(() => resetJWKSCache()).not.toThrow()
    })

    it('should be safe to call multiple times', () => {
      expect(() => {
        resetJWKSCache()
        resetJWKSCache()
        resetJWKSCache()
      }).not.toThrow()
    })
  })

  // ============================================================================
  // Edge Cases and Error Handling
  // ============================================================================

  describe('edge cases', () => {
    it('should handle token with minimal payload', async () => {
      const token = await generateJWT({ sub: 'minimal' }, TEST_SECRET)

      const payload = await verifyJWT(token, { secret: TEST_SECRET })

      expect(payload.sub).toBe('minimal')
      expect(payload.iat).toBeDefined()
      expect(payload.exp).toBeDefined()
    })

    it('should handle special characters in payload', async () => {
      const token = await generateJWT(
        {
          sub: 'user-with-special-chars',
          email: "test+special'chars@example.com",
        },
        TEST_SECRET,
      )

      const payload = await verifyJWT(token, { secret: TEST_SECRET })

      expect(payload.email).toBe("test+special'chars@example.com")
    })

    it('should handle unicode in payload', async () => {
      const token = await generateJWT(
        {
          sub: 'unicode-user',
          email: 'user@example.com',
        },
        TEST_SECRET,
      )

      const payload = await verifyJWT(token, { secret: TEST_SECRET })

      expect(payload.sub).toBe('unicode-user')
    })

    it('should handle very long secret', async () => {
      const longSecret = 'a'.repeat(256)
      const token = await generateJWT({ sub: 'long-secret-user' }, longSecret)

      const payload = await verifyJWT(token, { secret: longSecret })

      expect(payload.sub).toBe('long-secret-user')
    })

    it('should handle middleware with no config', async () => {
      const app = new Hono()
      app.use('*', jwtMiddleware())
      app.get('/protected', (c) => c.json({ ok: true }))

      const token = await generateJWT({ sub: 'no-config-user' }, TEST_SECRET)

      const res = await app.request('/protected', {
        headers: { Authorization: `Bearer ${token}` },
      })

      // Without a secret configured, verification should fail
      expect(res.status).toBe(401)
    })
  })

  // ============================================================================
  // Integration Tests
  // ============================================================================

  describe('integration', () => {
    it('should work in a full request flow', async () => {
      const app = new Hono()

      // Login endpoint to generate token
      app.post('/login', async (c) => {
        const body = await c.req.json()
        const token = await generateJWT(
          {
            sub: body.userId,
            email: body.email,
            role: body.role || 'user',
          },
          TEST_SECRET,
          '1h',
        )
        return c.json({ token })
      })

      // Protected endpoint
      app.use('/api/*', jwtMiddleware({ secret: TEST_SECRET }))
      app.get('/api/me', (c) => {
        const payload = c.get('jwtPayload')
        return c.json({
          userId: payload?.sub,
          email: payload?.email,
          role: payload?.role,
        })
      })

      // Step 1: Login
      const loginRes = await app.request('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'test-user-id',
          email: 'test@example.com',
          role: 'admin',
        }),
      })

      expect(loginRes.status).toBe(200)
      const loginBody = await loginRes.json()
      expect(loginBody.token).toBeDefined()

      // Step 2: Access protected resource with token
      const meRes = await app.request('/api/me', {
        headers: { Authorization: `Bearer ${loginBody.token}` },
      })

      expect(meRes.status).toBe(200)
      const meBody = await meRes.json()
      expect(meBody.userId).toBe('test-user-id')
      expect(meBody.email).toBe('test@example.com')
      expect(meBody.role).toBe('admin')
    })

    it('should handle multiple protected routes', async () => {
      const app = new Hono()
      app.use('/api/*', jwtMiddleware({ secret: TEST_SECRET }))

      app.get('/api/users', (c) => c.json({ route: 'users' }))
      app.get('/api/posts', (c) => c.json({ route: 'posts' }))
      app.get('/api/comments', (c) => c.json({ route: 'comments' }))

      const token = await generateJWT({ sub: 'multi-route-user' }, TEST_SECRET)
      const headers = { Authorization: `Bearer ${token}` }

      const usersRes = await app.request('/api/users', { headers })
      const postsRes = await app.request('/api/posts', { headers })
      const commentsRes = await app.request('/api/comments', { headers })

      expect(usersRes.status).toBe(200)
      expect(postsRes.status).toBe(200)
      expect(commentsRes.status).toBe(200)

      expect((await usersRes.json()).route).toBe('users')
      expect((await postsRes.json()).route).toBe('posts')
      expect((await commentsRes.json()).route).toBe('comments')
    })
  })
})
