/**
 * Comprehensive tests for packages/middleware/src/auth/session.ts
 *
 * Tests the session module including:
 * - sessionMiddleware: Standalone session middleware
 * - SessionValidator: Custom session validation function
 * - MemoryCache: LRU cache for session storage
 * - clearSessionMemoryCache: Cache clearing utility
 * - Cookie extraction and parsing
 * - KV caching integration
 * - Session expiration handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import {
  sessionMiddleware,
  clearSessionMemoryCache,
  MemoryCache,
  type SessionConfig,
  type SessionValidator,
} from '../session'

describe('packages/middleware/src/auth/session', () => {
  beforeEach(() => {
    clearSessionMemoryCache()
  })

  afterEach(() => {
    clearSessionMemoryCache()
  })

  // ============================================================================
  // MemoryCache Tests
  // ============================================================================

  describe('MemoryCache', () => {
    it('should store and retrieve values', () => {
      const cache = new MemoryCache<string>(100, 300)

      cache.set('key1', 'value1')

      expect(cache.get('key1')).toBe('value1')
    })

    it('should return null for non-existent keys', () => {
      const cache = new MemoryCache<string>(100, 300)

      expect(cache.get('non-existent')).toBeNull()
    })

    it('should evict oldest entry when at capacity', () => {
      const cache = new MemoryCache<string>(3, 300) // Max 3 entries

      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      cache.set('key3', 'value3')

      // All three should exist
      expect(cache.get('key1')).toBe('value1')
      expect(cache.get('key2')).toBe('value2')
      expect(cache.get('key3')).toBe('value3')

      // Add a fourth entry - should evict key1 (oldest)
      cache.set('key4', 'value4')

      expect(cache.get('key1')).toBeNull() // Evicted
      expect(cache.get('key2')).toBe('value2')
      expect(cache.get('key3')).toBe('value3')
      expect(cache.get('key4')).toBe('value4')
    })

    it('should update LRU order on get', () => {
      const cache = new MemoryCache<string>(3, 300)

      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      cache.set('key3', 'value3')

      // Access key1 to make it most recently used
      cache.get('key1')

      // Add a new entry - should evict key2 (now oldest)
      cache.set('key4', 'value4')

      expect(cache.get('key1')).toBe('value1') // Still exists
      expect(cache.get('key2')).toBeNull() // Evicted
      expect(cache.get('key3')).toBe('value3')
      expect(cache.get('key4')).toBe('value4')
    })

    it('should delete entries', () => {
      const cache = new MemoryCache<string>(100, 300)

      cache.set('delete-me', 'value')
      expect(cache.get('delete-me')).toBe('value')

      cache.delete('delete-me')
      expect(cache.get('delete-me')).toBeNull()
    })

    it('should clear all entries', () => {
      const cache = new MemoryCache<string>(100, 300)

      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      cache.set('key3', 'value3')

      cache.clear()

      expect(cache.get('key1')).toBeNull()
      expect(cache.get('key2')).toBeNull()
      expect(cache.get('key3')).toBeNull()
    })

    it('should handle object values', () => {
      const cache = new MemoryCache<{ userId: string; role: string }>(100, 300)

      cache.set('session-1', { userId: 'user-123', role: 'admin' })

      const value = cache.get('session-1')
      expect(value).toEqual({ userId: 'user-123', role: 'admin' })
    })

    it('should expire entries after TTL', () => {
      const cache = new MemoryCache<string>(100, 1) // 1 second TTL

      cache.set('expiring-key', 'value')

      // Verify it exists initially
      expect(cache.get('expiring-key')).toBe('value')

      // Wait for entry to expire (use real setTimeout)
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          // Should be expired now
          expect(cache.get('expiring-key')).toBeNull()
          resolve()
        }, 1100)
      })
    })

    it('should respect custom TTL for individual entries', () => {
      const cache = new MemoryCache<string>(100, 300) // Default 5 min TTL

      cache.set('short-ttl', 'value', 1) // 1 second TTL

      expect(cache.get('short-ttl')).toBe('value')

      // Wait for entry to expire
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(cache.get('short-ttl')).toBeNull()
          resolve()
        }, 1100)
      })
    })
  })

  // ============================================================================
  // clearSessionMemoryCache Tests
  // ============================================================================

  describe('clearSessionMemoryCache', () => {
    it('should be safe to call when no cache exists', () => {
      expect(() => clearSessionMemoryCache()).not.toThrow()
    })

    it('should be safe to call multiple times', () => {
      expect(() => {
        clearSessionMemoryCache()
        clearSessionMemoryCache()
        clearSessionMemoryCache()
      }).not.toThrow()
    })
  })

  // ============================================================================
  // sessionMiddleware Tests
  // ============================================================================

  describe('sessionMiddleware', () => {
    describe('basic authentication', () => {
      it('should authenticate valid session cookie', async () => {
        const validateSession: SessionValidator = vi.fn().mockResolvedValue({
          userId: 'session-user-1',
          email: 'session@example.com',
          role: 'user',
        })

        const app = new Hono()
        app.use('*', sessionMiddleware({ validateSession }))
        app.get('/protected', (c) => {
          const session = c.get('session')
          return c.json({
            userId: session?.userId,
            email: session?.email,
            role: session?.role,
          })
        })

        const res = await app.request('/protected', {
          headers: { Cookie: 'session=valid-session-token' },
        })

        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.userId).toBe('session-user-1')
        expect(body.email).toBe('session@example.com')
        expect(body.role).toBe('user')
        expect(validateSession).toHaveBeenCalledWith('valid-session-token')
      })

      it('should return 401 when no session cookie present', async () => {
        const validateSession: SessionValidator = vi.fn()

        const app = new Hono()
        app.use('*', sessionMiddleware({ validateSession }))
        app.get('/protected', (c) => c.json({ ok: true }))

        const res = await app.request('/protected')

        expect(res.status).toBe(401)
        const body = await res.text()
        expect(body).toContain('No session cookie')
        expect(validateSession).not.toHaveBeenCalled()
      })

      it('should return 401 when session validation not configured', async () => {
        const app = new Hono()
        app.use('*', sessionMiddleware({}))
        app.get('/protected', (c) => c.json({ ok: true }))

        const res = await app.request('/protected', {
          headers: { Cookie: 'session=some-token' },
        })

        expect(res.status).toBe(401)
        const body = await res.text()
        expect(body).toContain('Session validation not configured')
      })

      it('should return 401 for invalid session', async () => {
        const validateSession: SessionValidator = vi.fn().mockResolvedValue(null)

        const app = new Hono()
        app.use('*', sessionMiddleware({ validateSession }))
        app.get('/protected', (c) => c.json({ ok: true }))

        const res = await app.request('/protected', {
          headers: { Cookie: 'session=invalid-session' },
        })

        expect(res.status).toBe(401)
        const body = await res.text()
        expect(body).toContain('Invalid session')
      })
    })

    describe('session expiration', () => {
      it('should reject expired session', async () => {
        const validateSession: SessionValidator = vi.fn().mockResolvedValue({
          userId: 'expired-user',
          role: 'user',
          expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
        })

        const app = new Hono()
        app.use('*', sessionMiddleware({ validateSession }))
        app.get('/protected', (c) => c.json({ ok: true }))

        const res = await app.request('/protected', {
          headers: { Cookie: 'session=expired-session' },
        })

        expect(res.status).toBe(401)
        const body = await res.text()
        expect(body).toContain('Invalid session')
      })

      it('should accept session without expiration', async () => {
        const validateSession: SessionValidator = vi.fn().mockResolvedValue({
          userId: 'no-expiry-user',
          role: 'user',
          // No expiresAt
        })

        const app = new Hono()
        app.use('*', sessionMiddleware({ validateSession }))
        app.get('/protected', (c) => {
          const session = c.get('session')
          return c.json({ userId: session?.userId })
        })

        const res = await app.request('/protected', {
          headers: { Cookie: 'session=no-expiry-token' },
        })

        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.userId).toBe('no-expiry-user')
      })

      it('should accept session with future expiration', async () => {
        const validateSession: SessionValidator = vi.fn().mockResolvedValue({
          userId: 'future-expiry-user',
          role: 'admin',
          expiresAt: new Date(Date.now() + 3600000), // 1 hour from now
        })

        const app = new Hono()
        app.use('*', sessionMiddleware({ validateSession }))
        app.get('/protected', (c) => {
          const session = c.get('session')
          return c.json({ userId: session?.userId })
        })

        const res = await app.request('/protected', {
          headers: { Cookie: 'session=future-token' },
        })

        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.userId).toBe('future-expiry-user')
      })
    })

    describe('custom cookie name', () => {
      it('should use custom cookie name', async () => {
        const validateSession: SessionValidator = vi.fn().mockResolvedValue({
          userId: 'custom-cookie-user',
          role: 'user',
        })

        const app = new Hono()
        app.use(
          '*',
          sessionMiddleware({
            validateSession,
            cookieName: 'my_custom_session',
          }),
        )
        app.get('/protected', (c) => {
          const session = c.get('session')
          return c.json({ userId: session?.userId })
        })

        const res = await app.request('/protected', {
          headers: { Cookie: 'my_custom_session=custom-token' },
        })

        expect(res.status).toBe(200)
        expect(validateSession).toHaveBeenCalledWith('custom-token')
      })

      it('should return 401 when using wrong cookie name', async () => {
        const validateSession: SessionValidator = vi.fn()

        const app = new Hono()
        app.use(
          '*',
          sessionMiddleware({
            validateSession,
            cookieName: 'expected_cookie',
          }),
        )
        app.get('/protected', (c) => c.json({ ok: true }))

        const res = await app.request('/protected', {
          headers: { Cookie: 'wrong_cookie=some-token' },
        })

        expect(res.status).toBe(401)
        expect(validateSession).not.toHaveBeenCalled()
      })

      it('should use default cookie name "session" when not specified', async () => {
        const validateSession: SessionValidator = vi.fn().mockResolvedValue({
          userId: 'default-cookie-user',
          role: 'user',
        })

        const app = new Hono()
        app.use('*', sessionMiddleware({ validateSession }))
        app.get('/protected', (c) => {
          const session = c.get('session')
          return c.json({ userId: session?.userId })
        })

        const res = await app.request('/protected', {
          headers: { Cookie: 'session=default-token' },
        })

        expect(res.status).toBe(200)
        expect(validateSession).toHaveBeenCalledWith('default-token')
      })
    })

    describe('cookie extraction', () => {
      it('should extract session from multiple cookies', async () => {
        const validateSession: SessionValidator = vi.fn().mockResolvedValue({
          userId: 'multi-cookie-user',
          role: 'user',
        })

        const app = new Hono()
        app.use('*', sessionMiddleware({ validateSession }))
        app.get('/protected', (c) => {
          const session = c.get('session')
          return c.json({ userId: session?.userId })
        })

        const res = await app.request('/protected', {
          headers: {
            Cookie: 'other=value; session=target-token; another=thing',
          },
        })

        expect(res.status).toBe(200)
        expect(validateSession).toHaveBeenCalledWith('target-token')
      })

      it('should handle cookie with no value', async () => {
        const validateSession: SessionValidator = vi.fn()

        const app = new Hono()
        app.use('*', sessionMiddleware({ validateSession }))
        app.get('/protected', (c) => c.json({ ok: true }))

        const res = await app.request('/protected', {
          headers: { Cookie: 'session=' },
        })

        expect(res.status).toBe(401)
        // Empty cookie value should not trigger validation
      })

      it('should handle malformed cookie header', async () => {
        const validateSession: SessionValidator = vi.fn()

        const app = new Hono()
        app.use('*', sessionMiddleware({ validateSession }))
        app.get('/protected', (c) => c.json({ ok: true }))

        const res = await app.request('/protected', {
          headers: { Cookie: ';;;' },
        })

        expect(res.status).toBe(401)
      })

      it('should handle cookie with special characters in value', async () => {
        const validateSession: SessionValidator = vi.fn().mockResolvedValue({
          userId: 'special-char-user',
          role: 'user',
        })

        const app = new Hono()
        app.use('*', sessionMiddleware({ validateSession }))
        app.get('/protected', (c) => {
          const session = c.get('session')
          return c.json({ userId: session?.userId })
        })

        const res = await app.request('/protected', {
          headers: { Cookie: 'session=abc123_-.' },
        })

        expect(res.status).toBe(200)
        expect(validateSession).toHaveBeenCalledWith('abc123_-.')
      })
    })

    describe('context setting', () => {
      it('should set session data in context', async () => {
        const validateSession: SessionValidator = vi.fn().mockResolvedValue({
          userId: 'ctx-user',
          email: 'ctx@example.com',
          role: 'admin',
        })

        const app = new Hono()
        app.use('*', sessionMiddleware({ validateSession }))
        app.get('/protected', (c) => {
          const session = c.get('session')
          return c.json({ session })
        })

        const res = await app.request('/protected', {
          headers: { Cookie: 'session=ctx-token' },
        })

        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.session).toEqual({
          userId: 'ctx-user',
          email: 'ctx@example.com',
          role: 'admin',
        })
      })

      it('should default role to user when not provided', async () => {
        const validateSession: SessionValidator = vi.fn().mockResolvedValue({
          userId: 'no-role-user',
          // No role specified
        })

        const app = new Hono()
        app.use('*', sessionMiddleware({ validateSession }))
        app.get('/protected', (c) => {
          const session = c.get('session')
          return c.json({ role: session?.role })
        })

        const res = await app.request('/protected', {
          headers: { Cookie: 'session=no-role-token' },
        })

        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.role).toBe('user')
      })
    })

    describe('validation errors', () => {
      it('should handle validator throwing error', async () => {
        const validateSession: SessionValidator = vi.fn().mockRejectedValue(new Error('Database error'))

        const app = new Hono()
        app.use('*', sessionMiddleware({ validateSession }))
        app.get('/protected', (c) => c.json({ ok: true }))

        const res = await app.request('/protected', {
          headers: { Cookie: 'session=error-token' },
        })

        // When validator throws, middleware should propagate the error
        expect(res.status).toBe(500)
      })

      it('should handle validator returning undefined', async () => {
        const validateSession: SessionValidator = vi.fn().mockResolvedValue(undefined)

        const app = new Hono()
        app.use('*', sessionMiddleware({ validateSession }))
        app.get('/protected', (c) => c.json({ ok: true }))

        const res = await app.request('/protected', {
          headers: { Cookie: 'session=undefined-token' },
        })

        expect(res.status).toBe(401)
      })
    })
  })

  // ============================================================================
  // KV Caching Tests
  // ============================================================================

  describe('KV caching', () => {
    it('should cache valid session in KV', async () => {
      const mockKv = {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      }

      const validateSession: SessionValidator = vi.fn().mockResolvedValue({
        userId: 'kv-cache-user',
        email: 'kv@example.com',
        role: 'user',
      })

      const app = new Hono()
      app.use(
        '*',
        sessionMiddleware({
          validateSession,
          sessionCache: mockKv as any,
          sessionCacheTtl: 300,
        }),
      )
      app.get('/protected', (c) => {
        const session = c.get('session')
        return c.json({ userId: session?.userId })
      })

      const res = await app.request('/protected', {
        headers: { Cookie: 'session=kv-token' },
      })

      expect(res.status).toBe(200)
      expect(validateSession).toHaveBeenCalled()
      expect(mockKv.put).toHaveBeenCalled()
    })

    it('should retrieve cached session from KV', async () => {
      const cachedSession = {
        userId: 'cached-kv-user',
        email: 'cached@example.com',
        role: 'admin',
      }

      const mockKv = {
        get: vi.fn().mockResolvedValue(cachedSession),
        put: vi.fn(),
        delete: vi.fn(),
      }

      const validateSession: SessionValidator = vi.fn()

      const app = new Hono()
      app.use(
        '*',
        sessionMiddleware({
          validateSession,
          sessionCache: mockKv as any,
        }),
      )
      app.get('/protected', (c) => {
        const session = c.get('session')
        return c.json({ userId: session?.userId })
      })

      const res = await app.request('/protected', {
        headers: { Cookie: 'session=cached-token' },
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.userId).toBe('cached-kv-user')

      // Validator should not be called when cache hit
      expect(validateSession).not.toHaveBeenCalled()
    })

    it('should handle KV cache errors gracefully', async () => {
      const mockKv = {
        get: vi.fn().mockRejectedValue(new Error('KV error')),
        put: vi.fn().mockRejectedValue(new Error('KV error')),
        delete: vi.fn(),
      }

      const validateSession: SessionValidator = vi.fn().mockResolvedValue({
        userId: 'kv-error-user',
        role: 'user',
      })

      const app = new Hono()
      app.use(
        '*',
        sessionMiddleware({
          validateSession,
          sessionCache: mockKv as any,
        }),
      )
      app.get('/protected', (c) => {
        const session = c.get('session')
        return c.json({ userId: session?.userId })
      })

      const res = await app.request('/protected', {
        headers: { Cookie: 'session=kv-error-token' },
      })

      // Should still work despite KV errors
      expect(res.status).toBe(200)
      expect(validateSession).toHaveBeenCalled()
    })
  })

  // ============================================================================
  // Integration Tests
  // ============================================================================

  describe('integration', () => {
    it('should work with other middleware', async () => {
      const validateSession: SessionValidator = vi.fn().mockResolvedValue({
        userId: 'int-user',
        role: 'user',
      })

      const app = new Hono()

      // Before middleware
      app.use('*', async (c, next) => {
        c.set('beforeSession', true)
        await next()
      })

      app.use('*', sessionMiddleware({ validateSession }))

      // After middleware
      app.use('*', async (c, next) => {
        c.set('afterSession', true)
        await next()
      })

      app.get('/protected', (c) => {
        return c.json({
          beforeSession: c.get('beforeSession'),
          afterSession: c.get('afterSession'),
          session: c.get('session'),
        })
      })

      const res = await app.request('/protected', {
        headers: { Cookie: 'session=int-token' },
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.beforeSession).toBe(true)
      expect(body.afterSession).toBe(true)
      expect(body.session).toBeDefined()
    })

    it('should handle concurrent requests', async () => {
      const validateSession: SessionValidator = vi.fn().mockImplementation(async (token) => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return {
          userId: `user-${token}`,
          role: 'user',
        }
      })

      const app = new Hono()
      app.use('*', sessionMiddleware({ validateSession }))
      app.get('/protected', (c) => {
        const session = c.get('session')
        return c.json({ userId: session?.userId })
      })

      const requests = Promise.all([
        app.request('/protected', { headers: { Cookie: 'session=token1' } }),
        app.request('/protected', { headers: { Cookie: 'session=token2' } }),
        app.request('/protected', { headers: { Cookie: 'session=token3' } }),
      ])

      const responses = await requests

      expect(responses[0].status).toBe(200)
      expect(responses[1].status).toBe(200)
      expect(responses[2].status).toBe(200)

      const body1 = await responses[0].json()
      const body2 = await responses[1].json()
      const body3 = await responses[2].json()

      expect(body1.userId).toBe('user-token1')
      expect(body2.userId).toBe('user-token2')
      expect(body3.userId).toBe('user-token3')
    })
  })
})
