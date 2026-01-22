/**
 * @dotdo/oauth OAuth Middleware Extended Tests
 *
 * Extended tests for the OAuth session validation middleware covering
 * authentication, path exclusion, JWT verification, and edge cases.
 *
 * Following NO MOCKS philosophy - uses real test implementations.
 *
 * @module @dotdo/oauth/tests/oauth-middleware
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { createTestSessionStore, createTestTokenVerifier } from './test-utils'
import type { SessionData } from '../src/storage/interface'

describe('@dotdo/oauth OAuth Middleware Extended', () => {
  describe('Session extraction', () => {
    it('extracts session from Cookie header', async () => {
      const { oauthMiddleware } = await import('../src/middleware/oauth-middleware')
      const store = createTestSessionStore()

      await store.set('cookie-session-id', {
        userId: 'user-cookie',
        accessToken: 'token-from-cookie',
        provider: 'github',
      })

      const app = new Hono()
      app.use('*', oauthMiddleware({ sessionStore: store }))
      app.get('/test', (c) => {
        const session = c.get('session')
        return c.json({ source: 'cookie', userId: session?.userId })
      })

      const res = await app.request('/test', {
        headers: { Cookie: 'session=cookie-session-id' },
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.userId).toBe('user-cookie')
    })

    it('extracts session from Authorization Bearer header', async () => {
      const { oauthMiddleware } = await import('../src/middleware/oauth-middleware')
      const store = createTestSessionStore()

      await store.set('bearer-token-session', {
        userId: 'user-bearer',
        accessToken: 'token-from-bearer',
        provider: 'google',
      })

      const app = new Hono()
      app.use('*', oauthMiddleware({ sessionStore: store }))
      app.get('/test', (c) => {
        const session = c.get('session')
        return c.json({ source: 'bearer', userId: session?.userId })
      })

      const res = await app.request('/test', {
        headers: { Authorization: 'Bearer bearer-token-session' },
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.userId).toBe('user-bearer')
    })

    it('prefers Authorization header over Cookie', async () => {
      const { oauthMiddleware } = await import('../src/middleware/oauth-middleware')
      const store = createTestSessionStore()

      await store.set('cookie-session', {
        userId: 'user-from-cookie',
        accessToken: 'token-cookie',
        provider: 'mock',
      })

      await store.set('bearer-session', {
        userId: 'user-from-bearer',
        accessToken: 'token-bearer',
        provider: 'mock',
      })

      const app = new Hono()
      app.use('*', oauthMiddleware({ sessionStore: store }))
      app.get('/test', (c) => {
        const session = c.get('session')
        return c.json({ userId: session?.userId })
      })

      const res = await app.request('/test', {
        headers: {
          Cookie: 'session=cookie-session',
          Authorization: 'Bearer bearer-session',
        },
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.userId).toBe('user-from-bearer')
    })

    it('uses custom cookie name', async () => {
      const { oauthMiddleware } = await import('../src/middleware/oauth-middleware')
      const store = createTestSessionStore()

      await store.set('custom-cookie-value', {
        userId: 'user-custom',
        accessToken: 'token',
        provider: 'mock',
      })

      const app = new Hono()
      app.use('*', oauthMiddleware({ sessionStore: store, cookieName: 'my_auth' }))
      app.get('/test', (c) => {
        const session = c.get('session')
        return c.json({ userId: session?.userId })
      })

      const res = await app.request('/test', {
        headers: { Cookie: 'my_auth=custom-cookie-value' },
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.userId).toBe('user-custom')
    })

    it('handles multiple cookies', async () => {
      const { oauthMiddleware } = await import('../src/middleware/oauth-middleware')
      const store = createTestSessionStore()

      await store.set('target-session', {
        userId: 'user-target',
        accessToken: 'token',
        provider: 'mock',
      })

      const app = new Hono()
      app.use('*', oauthMiddleware({ sessionStore: store }))
      app.get('/test', (c) => {
        const session = c.get('session')
        return c.json({ userId: session?.userId })
      })

      const res = await app.request('/test', {
        headers: { Cookie: 'other=value; session=target-session; another=cookie' },
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.userId).toBe('user-target')
    })
  })

  describe('Authentication failures', () => {
    it('returns 401 when no credentials provided', async () => {
      const { oauthMiddleware } = await import('../src/middleware/oauth-middleware')
      const store = createTestSessionStore()

      const app = new Hono()
      app.use('*', oauthMiddleware({ sessionStore: store }))
      app.get('/protected', (c) => c.json({ ok: true }))

      const res = await app.request('/protected')

      expect(res.status).toBe(401)
      const json = await res.json()
      expect(json.error).toBe('Unauthorized')
    })

    it('returns 401 when session not found in store', async () => {
      const { oauthMiddleware } = await import('../src/middleware/oauth-middleware')
      const store = createTestSessionStore()

      const app = new Hono()
      app.use('*', oauthMiddleware({ sessionStore: store }))
      app.get('/protected', (c) => c.json({ ok: true }))

      const res = await app.request('/protected', {
        headers: { Cookie: 'session=nonexistent-session' },
      })

      expect(res.status).toBe(401)
    })

    it('returns 401 for invalid Authorization header format', async () => {
      const { oauthMiddleware } = await import('../src/middleware/oauth-middleware')
      const store = createTestSessionStore()

      const app = new Hono()
      app.use('*', oauthMiddleware({ sessionStore: store }))
      app.get('/protected', (c) => c.json({ ok: true }))

      // Only "Bearer" keyword, no token
      const res = await app.request('/protected', {
        headers: { Authorization: 'Bearer' },
      })

      expect(res.status).toBe(401)
    })

    it('returns 401 for non-Bearer Authorization scheme', async () => {
      const { oauthMiddleware } = await import('../src/middleware/oauth-middleware')
      const store = createTestSessionStore()

      await store.set('token-123', {
        userId: 'user',
        accessToken: 'token',
        provider: 'mock',
      })

      const app = new Hono()
      app.use('*', oauthMiddleware({ sessionStore: store }))
      app.get('/protected', (c) => c.json({ ok: true }))

      const res = await app.request('/protected', {
        headers: { Authorization: 'Basic token-123' },
      })

      expect(res.status).toBe(401)
    })
  })

  describe('Path exclusion', () => {
    it('skips authentication for excluded paths', async () => {
      const { oauthMiddleware } = await import('../src/middleware/oauth-middleware')
      const store = createTestSessionStore()

      const app = new Hono()
      app.use(
        '*',
        oauthMiddleware({
          sessionStore: store,
          excludePaths: ['/public', '/health', '/api/v1/status'],
        })
      )
      app.get('/public', (c) => c.json({ public: true }))
      app.get('/health', (c) => c.json({ healthy: true }))
      app.get('/api/v1/status', (c) => c.json({ status: 'ok' }))
      app.get('/protected', (c) => c.json({ protected: true }))

      // All excluded paths should be accessible without auth
      const res1 = await app.request('/public')
      const res2 = await app.request('/health')
      const res3 = await app.request('/api/v1/status')

      expect(res1.status).toBe(200)
      expect(res2.status).toBe(200)
      expect(res3.status).toBe(200)

      // Non-excluded path requires auth
      const res4 = await app.request('/protected')
      expect(res4.status).toBe(401)
    })

    it('matches path prefixes for exclusion', async () => {
      const { oauthMiddleware } = await import('../src/middleware/oauth-middleware')
      const store = createTestSessionStore()

      const app = new Hono()
      app.use(
        '*',
        oauthMiddleware({
          sessionStore: store,
          excludePaths: ['/api/public'],
        })
      )
      app.get('/api/public/users', (c) => c.json({ ok: true }))
      app.get('/api/private/users', (c) => c.json({ ok: true }))

      // Prefix match
      const res1 = await app.request('/api/public/users')
      expect(res1.status).toBe(200)

      // No prefix match
      const res2 = await app.request('/api/private/users')
      expect(res2.status).toBe(401)
    })

    it('handles empty excludePaths', async () => {
      const { oauthMiddleware } = await import('../src/middleware/oauth-middleware')
      const store = createTestSessionStore()

      const app = new Hono()
      app.use(
        '*',
        oauthMiddleware({
          sessionStore: store,
          excludePaths: [],
        })
      )
      app.get('/test', (c) => c.json({ ok: true }))

      const res = await app.request('/test')
      expect(res.status).toBe(401)
    })
  })

  describe('JWT verification', () => {
    it('verifies JWT when verifyToken function provided', async () => {
      const { oauthMiddleware } = await import('../src/middleware/oauth-middleware')
      const store = createTestSessionStore()

      // Use a real token map instead of mock
      const validTokens = new Map<string, Record<string, unknown>>([
        [
          'valid-jwt-token',
          {
            sub: 'jwt-user-id',
            email: 'jwt@example.com',
            role: 'admin',
          },
        ],
      ])

      const verifyToken = createTestTokenVerifier(validTokens)

      const app = new Hono()
      app.use(
        '*',
        oauthMiddleware({
          sessionStore: store,
          verifyToken,
        })
      )
      app.get('/protected', (c) => {
        const user = c.get('user')
        return c.json({ userId: user?.sub, email: user?.email })
      })

      const res = await app.request('/protected', {
        headers: { Authorization: 'Bearer valid-jwt-token' },
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.userId).toBe('jwt-user-id')
      expect(json.email).toBe('jwt@example.com')
    })

    it('falls back to session store when JWT verification fails', async () => {
      const { oauthMiddleware } = await import('../src/middleware/oauth-middleware')
      const store = createTestSessionStore()

      // Store a session with the same ID as the token
      await store.set('fallback-token', {
        userId: 'session-user',
        accessToken: 'token',
        provider: 'mock',
      })

      // Empty map means no valid tokens
      const validTokens = new Map<string, Record<string, unknown>>()
      const verifyToken = createTestTokenVerifier(validTokens)

      const app = new Hono()
      app.use(
        '*',
        oauthMiddleware({
          sessionStore: store,
          verifyToken,
        })
      )
      app.get('/protected', (c) => {
        const session = c.get('session')
        return c.json({ userId: session?.userId })
      })

      const res = await app.request('/protected', {
        headers: { Authorization: 'Bearer fallback-token' },
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.userId).toBe('session-user')
    })

    it('returns 401 when both JWT and session lookup fail', async () => {
      const { oauthMiddleware } = await import('../src/middleware/oauth-middleware')
      const store = createTestSessionStore()

      const validTokens = new Map<string, Record<string, unknown>>()
      const verifyToken = createTestTokenVerifier(validTokens)

      const app = new Hono()
      app.use(
        '*',
        oauthMiddleware({
          sessionStore: store,
          verifyToken,
        })
      )
      app.get('/protected', (c) => c.json({ ok: true }))

      const res = await app.request('/protected', {
        headers: { Authorization: 'Bearer invalid-everywhere' },
      })

      expect(res.status).toBe(401)
    })

    it('sets user context with JWT payload', async () => {
      const { oauthMiddleware } = await import('../src/middleware/oauth-middleware')
      const store = createTestSessionStore()

      const validTokens = new Map<string, Record<string, unknown>>([
        [
          'jwt-token',
          {
            sub: 'user-123',
            email: 'user@example.com',
            customClaim: 'custom-value',
            nested: { data: true },
          },
        ],
      ])

      const verifyToken = createTestTokenVerifier(validTokens)

      const app = new Hono()
      app.use(
        '*',
        oauthMiddleware({
          sessionStore: store,
          verifyToken,
        })
      )
      app.get('/protected', (c) => {
        const user = c.get('user')
        return c.json(user)
      })

      const res = await app.request('/protected', {
        headers: { Authorization: 'Bearer jwt-token' },
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.sub).toBe('user-123')
      expect(json.customClaim).toBe('custom-value')
      expect(json.nested).toEqual({ data: true })
    })
  })

  describe('Session context', () => {
    it('sets full session data in context', async () => {
      const { oauthMiddleware } = await import('../src/middleware/oauth-middleware')
      const store = createTestSessionStore()

      const sessionData: SessionData = {
        userId: 'context-user',
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 3600000,
        provider: 'github',
        metadata: {
          email: 'context@example.com',
          name: 'Context User',
          scopes: ['read', 'write'],
        },
      }

      await store.set('full-session', sessionData)

      const app = new Hono()
      app.use('*', oauthMiddleware({ sessionStore: store }))
      app.get('/session-info', (c) => {
        const session = c.get('session')
        return c.json(session)
      })

      const res = await app.request('/session-info', {
        headers: { Cookie: 'session=full-session' },
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json).toEqual(sessionData)
    })

    it('allows next middleware to access session', async () => {
      const { oauthMiddleware } = await import('../src/middleware/oauth-middleware')
      const store = createTestSessionStore()

      await store.set('chain-session', {
        userId: 'chain-user',
        accessToken: 'token',
        provider: 'mock',
      })

      let middlewareSession: SessionData | undefined

      const app = new Hono()
      app.use('*', oauthMiddleware({ sessionStore: store }))
      app.use('*', async (c, next) => {
        middlewareSession = c.get('session')
        await next()
      })
      app.get('/test', (c) => c.json({ ok: true }))

      const res = await app.request('/test', {
        headers: { Cookie: 'session=chain-session' },
      })

      expect(res.status).toBe(200)
      expect(middlewareSession?.userId).toBe('chain-user')
    })
  })

  describe('Edge cases', () => {
    it('handles empty cookie header', async () => {
      const { oauthMiddleware } = await import('../src/middleware/oauth-middleware')
      const store = createTestSessionStore()

      const app = new Hono()
      app.use('*', oauthMiddleware({ sessionStore: store }))
      app.get('/test', (c) => c.json({ ok: true }))

      const res = await app.request('/test', {
        headers: { Cookie: '' },
      })

      expect(res.status).toBe(401)
    })

    it('handles cookie with only name (no value)', async () => {
      const { oauthMiddleware } = await import('../src/middleware/oauth-middleware')
      const store = createTestSessionStore()

      const app = new Hono()
      app.use('*', oauthMiddleware({ sessionStore: store }))
      app.get('/test', (c) => c.json({ ok: true }))

      const res = await app.request('/test', {
        headers: { Cookie: 'session=' },
      })

      expect(res.status).toBe(401)
    })

    it('handles cookie value with equals sign', async () => {
      const { oauthMiddleware } = await import('../src/middleware/oauth-middleware')
      const store = createTestSessionStore()

      await store.set('token=with=equals', {
        userId: 'user',
        accessToken: 'token',
        provider: 'mock',
      })

      const app = new Hono()
      app.use('*', oauthMiddleware({ sessionStore: store }))
      app.get('/test', (c) => {
        const session = c.get('session')
        return c.json({ userId: session?.userId })
      })

      const res = await app.request('/test', {
        headers: { Cookie: 'session=token=with=equals' },
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.userId).toBe('user')
    })

    it('handles whitespace around cookie values', async () => {
      const { oauthMiddleware } = await import('../src/middleware/oauth-middleware')
      const store = createTestSessionStore()

      await store.set('whitespace-session', {
        userId: 'user',
        accessToken: 'token',
        provider: 'mock',
      })

      const app = new Hono()
      app.use('*', oauthMiddleware({ sessionStore: store }))
      app.get('/test', (c) => {
        const session = c.get('session')
        return c.json({ userId: session?.userId })
      })

      const res = await app.request('/test', {
        headers: { Cookie: '  session = whitespace-session  ' },
      })

      expect(res.status).toBe(200)
    })
  })
})
