/**
 * Comprehensive tests for packages/middleware/src/auth/index.ts
 *
 * Tests the main auth middleware exports including:
 * - authMiddleware: JWT auth, API key auth, session auth, public paths
 * - requireAuth: Returns 401 if not authenticated
 * - requireRole: Admin bypass, role matching, 403 on mismatch
 * - requirePermission: Permission checking, admin bypass
 * - registerApiKey: Runtime API key registration
 * - extractBearerToken (internal): Various Authorization header formats
 * - extractApiKey (internal): X-API-Key header extraction
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import type { Context } from 'hono'
import {
  authMiddleware,
  requireAuth,
  requireRole,
  requirePermission,
  registerApiKey,
  generateJWT,
  clearApiKeys,
  type AuthContext,
  type AuthConfig,
} from '../index'

// Test secret - only used for testing
const TEST_SECRET = 'test-secret-key-for-testing-only-32chars!'

describe('packages/middleware/src/auth', () => {
  beforeEach(() => {
    // Clear any runtime-registered API keys before each test
    clearApiKeys()
  })

  afterEach(() => {
    clearApiKeys()
  })

  // ============================================================================
  // authMiddleware Tests
  // ============================================================================

  describe('authMiddleware', () => {
    describe('public paths', () => {
      it('should skip auth for public paths', async () => {
        const app = new Hono()
        app.use(
          '*',
          authMiddleware({
            jwtSecret: TEST_SECRET,
            publicPaths: ['/public', '/health'],
          }),
        )
        app.get('/public', (c) => c.json({ message: 'public' }))
        app.get('/health', (c) => c.json({ status: 'ok' }))

        const publicRes = await app.request('/public')
        expect(publicRes.status).toBe(200)
        const publicBody = await publicRes.json()
        expect(publicBody.message).toBe('public')

        const healthRes = await app.request('/health')
        expect(healthRes.status).toBe(200)
        const healthBody = await healthRes.json()
        expect(healthBody.status).toBe('ok')
      })

      it('should skip auth for paths starting with public path prefix', async () => {
        const app = new Hono()
        app.use(
          '*',
          authMiddleware({
            jwtSecret: TEST_SECRET,
            publicPaths: ['/public'],
          }),
        )
        app.get('/public/nested/path', (c) => c.json({ ok: true }))

        const res = await app.request('/public/nested/path')
        expect(res.status).toBe(200)
      })

      it('should use default public paths when none specified', async () => {
        const app = new Hono()
        app.use('*', authMiddleware({ jwtSecret: TEST_SECRET }))
        app.get('/health', (c) => c.json({ status: 'ok' }))
        app.get('/public', (c) => c.json({ ok: true }))

        const healthRes = await app.request('/health')
        expect(healthRes.status).toBe(200)

        const publicRes = await app.request('/public')
        expect(publicRes.status).toBe(200)
      })
    })

    describe('JWT authentication', () => {
      it('should authenticate valid JWT', async () => {
        const app = new Hono()
        app.use('*', authMiddleware({ jwtSecret: TEST_SECRET }))
        app.get('/protected', (c) => {
          const auth = c.get('auth') as AuthContext
          return c.json({ userId: auth?.userId, method: auth?.method })
        })

        const token = await generateJWT({ sub: 'user-123', email: 'test@example.com' }, TEST_SECRET)

        const res = await app.request('/protected', {
          headers: { Authorization: `Bearer ${token}` },
        })

        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.userId).toBe('user-123')
        expect(body.method).toBe('jwt')
      })

      it('should reject expired JWT', async () => {
        const app = new Hono()
        app.use('*', authMiddleware({ jwtSecret: TEST_SECRET }))
        app.get('/protected', (c) => c.json({ ok: true }))

        // Generate token that expires immediately
        const token = await generateJWT({ sub: 'user-123' }, TEST_SECRET, '0s')

        // Wait a moment for token to expire
        await new Promise((resolve) => setTimeout(resolve, 100))

        const res = await app.request('/protected', {
          headers: { Authorization: `Bearer ${token}` },
        })

        expect(res.status).toBe(401)
        const body = await res.text()
        expect(body).toContain('expired')
      })

      it('should reject invalid JWT signature', async () => {
        const app = new Hono()
        app.use('*', authMiddleware({ jwtSecret: TEST_SECRET }))
        app.get('/protected', (c) => c.json({ ok: true }))

        // Generate token with different secret
        const token = await generateJWT({ sub: 'user-123' }, 'different-secret-key-32characters!')

        const res = await app.request('/protected', {
          headers: { Authorization: `Bearer ${token}` },
        })

        expect(res.status).toBe(401)
      })

      it('should reject malformed JWT', async () => {
        const app = new Hono()
        app.use('*', authMiddleware({ jwtSecret: TEST_SECRET }))
        app.get('/protected', (c) => c.json({ ok: true }))

        const res = await app.request('/protected', {
          headers: { Authorization: 'Bearer not.a.valid.jwt' },
        })

        expect(res.status).toBe(401)
      })

      it('should extract role and permissions from JWT', async () => {
        const app = new Hono()
        app.use('*', authMiddleware({ jwtSecret: TEST_SECRET }))
        app.get('/protected', (c) => {
          const auth = c.get('auth') as AuthContext
          return c.json({
            role: auth?.role,
            permissions: auth?.permissions,
          })
        })

        const token = await generateJWT(
          {
            sub: 'user-123',
            role: 'admin',
            permissions: ['read', 'write'],
          },
          TEST_SECRET,
        )

        const res = await app.request('/protected', {
          headers: { Authorization: `Bearer ${token}` },
        })

        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.role).toBe('admin')
        expect(body.permissions).toEqual(['read', 'write'])
      })

      it('should default role to user when not in JWT', async () => {
        const app = new Hono()
        app.use('*', authMiddleware({ jwtSecret: TEST_SECRET }))
        app.get('/protected', (c) => {
          const auth = c.get('auth') as AuthContext
          return c.json({ role: auth?.role })
        })

        const token = await generateJWT({ sub: 'user-123' }, TEST_SECRET)

        const res = await app.request('/protected', {
          headers: { Authorization: `Bearer ${token}` },
        })

        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.role).toBe('user')
      })
    })

    describe('API key authentication', () => {
      it('should authenticate valid API key', async () => {
        registerApiKey('valid-api-key-12345', {
          userId: 'api-user-1',
          role: 'user',
          permissions: ['read'],
        })

        const app = new Hono()
        app.use('*', authMiddleware({ jwtSecret: TEST_SECRET }))
        app.get('/protected', (c) => {
          const auth = c.get('auth') as AuthContext
          return c.json({
            userId: auth?.userId,
            method: auth?.method,
            role: auth?.role,
          })
        })

        const res = await app.request('/protected', {
          headers: { 'X-API-Key': 'valid-api-key-12345' },
        })

        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.userId).toBe('api-user-1')
        expect(body.method).toBe('apikey')
        expect(body.role).toBe('user')
      })

      it('should reject invalid API key', async () => {
        const app = new Hono()
        app.use('*', authMiddleware({ jwtSecret: TEST_SECRET }))
        app.get('/protected', (c) => c.json({ ok: true }))

        const res = await app.request('/protected', {
          headers: { 'X-API-Key': 'invalid-api-key-xyz' },
        })

        expect(res.status).toBe(401)
      })

      it('should reject API key that is too short', async () => {
        const app = new Hono()
        app.use('*', authMiddleware({ jwtSecret: TEST_SECRET }))
        app.get('/protected', (c) => c.json({ ok: true }))

        const res = await app.request('/protected', {
          headers: { 'X-API-Key': 'short' },
        })

        expect(res.status).toBe(401)
        const body = await res.text()
        expect(body).toContain('Invalid API key')
      })

      it('should support API keys from config map', async () => {
        const apiKeys = new Map([
          [
            'config-api-key-123',
            {
              userId: 'config-user',
              role: 'admin' as const,
            },
          ],
        ])

        const app = new Hono()
        app.use('*', authMiddleware({ jwtSecret: TEST_SECRET, apiKeys }))
        app.get('/protected', (c) => {
          const auth = c.get('auth') as AuthContext
          return c.json({ userId: auth?.userId })
        })

        const res = await app.request('/protected', {
          headers: { 'X-API-Key': 'config-api-key-123' },
        })

        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.userId).toBe('config-user')
      })
    })

    describe('session authentication', () => {
      it('should authenticate valid session cookie', async () => {
        const validateSession = vi.fn().mockResolvedValue({
          userId: 'session-user-1',
          email: 'session@example.com',
          role: 'user',
          expiresAt: new Date(Date.now() + 3600000), // 1 hour from now
        })

        const app = new Hono()
        app.use(
          '*',
          authMiddleware({
            jwtSecret: TEST_SECRET,
            validateSession,
            cookieName: 'session',
          }),
        )
        app.get('/protected', (c) => {
          const auth = c.get('auth') as AuthContext
          return c.json({
            userId: auth?.userId,
            method: auth?.method,
          })
        })

        const res = await app.request('/protected', {
          headers: { Cookie: 'session=valid-session-token' },
        })

        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.userId).toBe('session-user-1')
        expect(body.method).toBe('session')
        expect(validateSession).toHaveBeenCalledWith('valid-session-token')
      })

      it('should reject expired session', async () => {
        const validateSession = vi.fn().mockResolvedValue({
          userId: 'session-user-1',
          role: 'user',
          expiresAt: new Date(Date.now() - 1000), // Expired
        })

        const app = new Hono()
        app.use(
          '*',
          authMiddleware({
            jwtSecret: TEST_SECRET,
            validateSession,
            cookieName: 'session',
          }),
        )
        app.get('/protected', (c) => {
          const auth = c.get('auth') as AuthContext
          return c.json({ authenticated: !!auth })
        })

        const res = await app.request('/protected', {
          headers: { Cookie: 'session=expired-session' },
        })

        // Session validation fails silently, allowing other auth methods to try
        // If no auth succeeds, request continues without auth context
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.authenticated).toBe(false)
      })

      it('should reject invalid session', async () => {
        const validateSession = vi.fn().mockResolvedValue(null)

        const app = new Hono()
        app.use(
          '*',
          authMiddleware({
            jwtSecret: TEST_SECRET,
            validateSession,
            cookieName: 'session',
          }),
        )
        app.get('/protected', (c) => {
          const auth = c.get('auth') as AuthContext
          return c.json({ authenticated: !!auth })
        })

        const res = await app.request('/protected', {
          headers: { Cookie: 'session=invalid-session' },
        })

        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.authenticated).toBe(false)
      })

      it('should use custom cookie name', async () => {
        const validateSession = vi.fn().mockResolvedValue({
          userId: 'custom-user',
          role: 'user',
        })

        const app = new Hono()
        app.use(
          '*',
          authMiddleware({
            jwtSecret: TEST_SECRET,
            validateSession,
            cookieName: 'custom_session',
          }),
        )
        app.get('/protected', (c) => {
          const auth = c.get('auth') as AuthContext
          return c.json({ userId: auth?.userId })
        })

        const res = await app.request('/protected', {
          headers: { Cookie: 'custom_session=session-token' },
        })

        expect(res.status).toBe(200)
        expect(validateSession).toHaveBeenCalledWith('session-token')
      })
    })

    describe('auth priority', () => {
      it('should prefer JWT over API key when both present', async () => {
        registerApiKey('api-key-for-priority', {
          userId: 'api-user',
          role: 'user',
        })

        const app = new Hono()
        app.use('*', authMiddleware({ jwtSecret: TEST_SECRET }))
        app.get('/protected', (c) => {
          const auth = c.get('auth') as AuthContext
          return c.json({ userId: auth?.userId, method: auth?.method })
        })

        const token = await generateJWT({ sub: 'jwt-user' }, TEST_SECRET)

        const res = await app.request('/protected', {
          headers: {
            Authorization: `Bearer ${token}`,
            'X-API-Key': 'api-key-for-priority',
          },
        })

        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.userId).toBe('jwt-user')
        expect(body.method).toBe('jwt')
      })

      it('should fall back to API key when JWT fails', async () => {
        registerApiKey('fallback-api-key', {
          userId: 'api-user',
          role: 'user',
        })

        const app = new Hono()
        app.use('*', authMiddleware({ jwtSecret: TEST_SECRET }))
        app.get('/protected', (c) => {
          const auth = c.get('auth') as AuthContext
          return c.json({ userId: auth?.userId, method: auth?.method })
        })

        const res = await app.request('/protected', {
          headers: {
            Authorization: 'Bearer invalid.jwt.token',
            'X-API-Key': 'fallback-api-key',
          },
        })

        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.userId).toBe('api-user')
        expect(body.method).toBe('apikey')
      })
    })

    describe('context setting', () => {
      it('should set user context with correct shape', async () => {
        const app = new Hono()
        app.use('*', authMiddleware({ jwtSecret: TEST_SECRET }))
        app.get('/protected', (c) => {
          const user = c.get('user')
          return c.json({ user })
        })

        const token = await generateJWT(
          {
            sub: 'user-123',
            email: 'test@example.com',
            role: 'admin',
            permissions: ['read', 'write'],
          },
          TEST_SECRET,
        )

        const res = await app.request('/protected', {
          headers: { Authorization: `Bearer ${token}` },
        })

        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.user).toEqual({
          id: 'user-123',
          email: 'test@example.com',
          role: 'admin',
          permissions: ['read', 'write'],
        })
      })

      it('should set session context', async () => {
        const app = new Hono()
        app.use('*', authMiddleware({ jwtSecret: TEST_SECRET }))
        app.get('/protected', (c) => {
          const session = c.get('session')
          return c.json({ session })
        })

        const token = await generateJWT({ sub: 'user-123' }, TEST_SECRET)

        const res = await app.request('/protected', {
          headers: { Authorization: `Bearer ${token}` },
        })

        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.session).toEqual({ userId: 'user-123' })
      })
    })
  })

  // ============================================================================
  // requireAuth Tests
  // ============================================================================

  describe('requireAuth', () => {
    it('should return 401 if not authenticated', async () => {
      const app = new Hono()
      app.use('*', authMiddleware({ jwtSecret: TEST_SECRET }))
      app.use('/protected/*', requireAuth())
      app.get('/protected/resource', (c) => c.json({ ok: true }))

      const res = await app.request('/protected/resource')

      expect(res.status).toBe(401)
      const body = await res.text()
      expect(body).toContain('Authentication required')
    })

    it('should set WWW-Authenticate header on 401', async () => {
      const app = new Hono()
      app.use('*', authMiddleware({ jwtSecret: TEST_SECRET }))
      app.use('/protected/*', requireAuth())
      app.get('/protected/resource', (c) => c.json({ ok: true }))

      const res = await app.request('/protected/resource')

      expect(res.status).toBe(401)
      expect(res.headers.get('WWW-Authenticate')).toBe('Bearer realm="dotdo", charset="UTF-8"')
    })

    it('should allow authenticated requests to pass', async () => {
      const app = new Hono()
      app.use('*', authMiddleware({ jwtSecret: TEST_SECRET }))
      app.use('/protected/*', requireAuth())
      app.get('/protected/resource', (c) => c.json({ ok: true }))

      const token = await generateJWT({ sub: 'user-123' }, TEST_SECRET)

      const res = await app.request('/protected/resource', {
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(res.status).toBe(200)
    })
  })

  // ============================================================================
  // requireRole Tests
  // ============================================================================

  describe('requireRole', () => {
    it('should allow admin to access any role-protected route', async () => {
      const app = new Hono()
      app.use('*', authMiddleware({ jwtSecret: TEST_SECRET }))
      app.use('/admin/*', requireRole('admin'))
      app.use('/user/*', requireRole('user'))
      app.get('/admin/dashboard', (c) => c.json({ ok: true }))
      app.get('/user/profile', (c) => c.json({ ok: true }))

      const adminToken = await generateJWT({ sub: 'admin-1', role: 'admin' }, TEST_SECRET)

      const adminRes = await app.request('/admin/dashboard', {
        headers: { Authorization: `Bearer ${adminToken}` },
      })
      expect(adminRes.status).toBe(200)

      // Admin should also access user routes
      const userRes = await app.request('/user/profile', {
        headers: { Authorization: `Bearer ${adminToken}` },
      })
      expect(userRes.status).toBe(200)
    })

    it('should allow matching role', async () => {
      const app = new Hono()
      app.use('*', authMiddleware({ jwtSecret: TEST_SECRET }))
      app.use('/user/*', requireRole('user'))
      app.get('/user/profile', (c) => c.json({ ok: true }))

      const userToken = await generateJWT({ sub: 'user-1', role: 'user' }, TEST_SECRET)

      const res = await app.request('/user/profile', {
        headers: { Authorization: `Bearer ${userToken}` },
      })

      expect(res.status).toBe(200)
    })

    it('should return 403 on role mismatch', async () => {
      const app = new Hono()
      app.use('*', authMiddleware({ jwtSecret: TEST_SECRET }))
      app.use('/admin/*', requireRole('admin'))
      app.get('/admin/dashboard', (c) => c.json({ ok: true }))

      const userToken = await generateJWT({ sub: 'user-1', role: 'user' }, TEST_SECRET)

      const res = await app.request('/admin/dashboard', {
        headers: { Authorization: `Bearer ${userToken}` },
      })

      expect(res.status).toBe(403)
      const body = await res.text()
      expect(body).toContain('admin')
      expect(body).toContain('required')
    })

    it('should return 401 if not authenticated', async () => {
      const app = new Hono()
      app.use('*', authMiddleware({ jwtSecret: TEST_SECRET }))
      app.use('/admin/*', requireRole('admin'))
      app.get('/admin/dashboard', (c) => c.json({ ok: true }))

      const res = await app.request('/admin/dashboard')

      expect(res.status).toBe(401)
      expect(res.headers.get('WWW-Authenticate')).toBe('Bearer realm="dotdo", charset="UTF-8"')
    })
  })

  // ============================================================================
  // requirePermission Tests
  // ============================================================================

  describe('requirePermission', () => {
    it('should allow admin to bypass permission check', async () => {
      const app = new Hono()
      app.use('*', authMiddleware({ jwtSecret: TEST_SECRET }))
      app.use('/api/*', requirePermission('special:access'))
      app.get('/api/special', (c) => c.json({ ok: true }))

      const adminToken = await generateJWT({ sub: 'admin-1', role: 'admin' }, TEST_SECRET)

      const res = await app.request('/api/special', {
        headers: { Authorization: `Bearer ${adminToken}` },
      })

      expect(res.status).toBe(200)
    })

    it('should allow user with matching permission', async () => {
      const app = new Hono()
      app.use('*', authMiddleware({ jwtSecret: TEST_SECRET }))
      app.use('/api/*', requirePermission('read:data'))
      app.get('/api/data', (c) => c.json({ ok: true }))

      const userToken = await generateJWT(
        {
          sub: 'user-1',
          role: 'user',
          permissions: ['read:data', 'write:data'],
        },
        TEST_SECRET,
      )

      const res = await app.request('/api/data', {
        headers: { Authorization: `Bearer ${userToken}` },
      })

      expect(res.status).toBe(200)
    })

    it('should return 403 if permission missing', async () => {
      const app = new Hono()
      app.use('*', authMiddleware({ jwtSecret: TEST_SECRET }))
      app.use('/api/*', requirePermission('admin:secret'))
      app.get('/api/secret', (c) => c.json({ ok: true }))

      const userToken = await generateJWT(
        {
          sub: 'user-1',
          role: 'user',
          permissions: ['read:data'],
        },
        TEST_SECRET,
      )

      const res = await app.request('/api/secret', {
        headers: { Authorization: `Bearer ${userToken}` },
      })

      expect(res.status).toBe(403)
      const body = await res.text()
      expect(body).toContain('admin:secret')
      expect(body).toContain('required')
    })

    it('should return 403 if user has no permissions array', async () => {
      const app = new Hono()
      app.use('*', authMiddleware({ jwtSecret: TEST_SECRET }))
      app.use('/api/*', requirePermission('any:permission'))
      app.get('/api/resource', (c) => c.json({ ok: true }))

      const userToken = await generateJWT(
        {
          sub: 'user-1',
          role: 'user',
          // No permissions array
        },
        TEST_SECRET,
      )

      const res = await app.request('/api/resource', {
        headers: { Authorization: `Bearer ${userToken}` },
      })

      expect(res.status).toBe(403)
    })

    it('should return 401 if not authenticated', async () => {
      const app = new Hono()
      app.use('*', authMiddleware({ jwtSecret: TEST_SECRET }))
      app.use('/api/*', requirePermission('any:permission'))
      app.get('/api/resource', (c) => c.json({ ok: true }))

      const res = await app.request('/api/resource')

      expect(res.status).toBe(401)
      expect(res.headers.get('WWW-Authenticate')).toBe('Bearer realm="dotdo", charset="UTF-8"')
    })
  })

  // ============================================================================
  // registerApiKey Tests
  // ============================================================================

  describe('registerApiKey', () => {
    it('should register API key at runtime', async () => {
      registerApiKey('new-runtime-key-123', {
        userId: 'runtime-user',
        role: 'user',
      })

      const app = new Hono()
      app.use('*', authMiddleware({ jwtSecret: TEST_SECRET }))
      app.get('/protected', (c) => {
        const auth = c.get('auth') as AuthContext
        return c.json({ userId: auth?.userId })
      })

      const res = await app.request('/protected', {
        headers: { 'X-API-Key': 'new-runtime-key-123' },
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.userId).toBe('runtime-user')
    })

    it('should allow overwriting existing key', async () => {
      registerApiKey('overwrite-key-12345', {
        userId: 'original-user',
        role: 'user',
      })

      registerApiKey('overwrite-key-12345', {
        userId: 'new-user',
        role: 'admin',
      })

      const app = new Hono()
      app.use('*', authMiddleware({ jwtSecret: TEST_SECRET }))
      app.get('/protected', (c) => {
        const auth = c.get('auth') as AuthContext
        return c.json({ userId: auth?.userId, role: auth?.role })
      })

      const res = await app.request('/protected', {
        headers: { 'X-API-Key': 'overwrite-key-12345' },
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.userId).toBe('new-user')
      expect(body.role).toBe('admin')
    })

    it('should support permissions in registered key', async () => {
      registerApiKey('perms-api-key-1234', {
        userId: 'perms-user',
        role: 'user',
        permissions: ['read', 'write', 'delete'],
      })

      const app = new Hono()
      app.use('*', authMiddleware({ jwtSecret: TEST_SECRET }))
      app.get('/protected', (c) => {
        const auth = c.get('auth') as AuthContext
        return c.json({ permissions: auth?.permissions })
      })

      const res = await app.request('/protected', {
        headers: { 'X-API-Key': 'perms-api-key-1234' },
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.permissions).toEqual(['read', 'write', 'delete'])
    })
  })

  // ============================================================================
  // Bearer Token Extraction Tests (Internal Function via Integration)
  // ============================================================================

  describe('extractBearerToken (via integration)', () => {
    it('should extract token from standard Bearer header', async () => {
      const app = new Hono()
      app.use('*', authMiddleware({ jwtSecret: TEST_SECRET }))
      app.get('/protected', (c) => {
        const auth = c.get('auth') as AuthContext
        return c.json({ authenticated: !!auth })
      })

      const token = await generateJWT({ sub: 'user-1' }, TEST_SECRET)

      const res = await app.request('/protected', {
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.authenticated).toBe(true)
    })

    it('should handle lowercase bearer prefix', async () => {
      const app = new Hono()
      app.use('*', authMiddleware({ jwtSecret: TEST_SECRET }))
      app.get('/protected', (c) => {
        const auth = c.get('auth') as AuthContext
        return c.json({ authenticated: !!auth })
      })

      const token = await generateJWT({ sub: 'user-1' }, TEST_SECRET)

      const res = await app.request('/protected', {
        headers: { Authorization: `bearer ${token}` },
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.authenticated).toBe(true)
    })

    it('should handle extra whitespace in Authorization header', async () => {
      const app = new Hono()
      app.use('*', authMiddleware({ jwtSecret: TEST_SECRET }))
      app.get('/protected', (c) => {
        const auth = c.get('auth') as AuthContext
        return c.json({ authenticated: !!auth })
      })

      const token = await generateJWT({ sub: 'user-1' }, TEST_SECRET)

      const res = await app.request('/protected', {
        headers: { Authorization: `Bearer   ${token}` },
      })

      expect(res.status).toBe(200)
    })

    it('should reject non-Bearer authorization schemes', async () => {
      const app = new Hono()
      app.use('*', authMiddleware({ jwtSecret: TEST_SECRET }))
      app.get('/protected', (c) => {
        const auth = c.get('auth') as AuthContext
        return c.json({ authenticated: !!auth })
      })

      const res = await app.request('/protected', {
        headers: { Authorization: 'Basic dXNlcjpwYXNz' },
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.authenticated).toBe(false)
    })

    it('should reject empty Authorization header', async () => {
      const app = new Hono()
      app.use('*', authMiddleware({ jwtSecret: TEST_SECRET }))
      app.get('/protected', (c) => {
        const auth = c.get('auth') as AuthContext
        return c.json({ authenticated: !!auth })
      })

      const res = await app.request('/protected', {
        headers: { Authorization: '' },
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.authenticated).toBe(false)
    })

    it('should reject Bearer with empty token', async () => {
      const app = new Hono()
      app.use('*', authMiddleware({ jwtSecret: TEST_SECRET }))
      app.get('/protected', (c) => {
        const auth = c.get('auth') as AuthContext
        return c.json({ authenticated: !!auth })
      })

      const res = await app.request('/protected', {
        headers: { Authorization: 'Bearer ' },
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.authenticated).toBe(false)
    })

    it('should reject whitespace-only token', async () => {
      const app = new Hono()
      app.use('*', authMiddleware({ jwtSecret: TEST_SECRET }))
      app.get('/protected', (c) => {
        const auth = c.get('auth') as AuthContext
        return c.json({ authenticated: !!auth })
      })

      const res = await app.request('/protected', {
        headers: { Authorization: 'Bearer    ' },
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.authenticated).toBe(false)
    })
  })

  // ============================================================================
  // API Key Header Extraction Tests (Internal Function via Integration)
  // ============================================================================

  describe('extractApiKey (via integration)', () => {
    it('should extract API key from X-API-Key header', async () => {
      registerApiKey('header-test-key-1', {
        userId: 'header-user',
        role: 'user',
      })

      const app = new Hono()
      app.use('*', authMiddleware({ jwtSecret: TEST_SECRET }))
      app.get('/protected', (c) => {
        const auth = c.get('auth') as AuthContext
        return c.json({ authenticated: !!auth, method: auth?.method })
      })

      const res = await app.request('/protected', {
        headers: { 'X-API-Key': 'header-test-key-1' },
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.authenticated).toBe(true)
      expect(body.method).toBe('apikey')
    })

    it('should handle case-insensitive header name', async () => {
      registerApiKey('case-test-key-12', {
        userId: 'case-user',
        role: 'user',
      })

      const app = new Hono()
      app.use('*', authMiddleware({ jwtSecret: TEST_SECRET }))
      app.get('/protected', (c) => {
        const auth = c.get('auth') as AuthContext
        return c.json({ authenticated: !!auth })
      })

      // Hono normalizes headers, so this should work
      const res = await app.request('/protected', {
        headers: { 'x-api-key': 'case-test-key-12' },
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.authenticated).toBe(true)
    })

    it('should return null when X-API-Key header is missing', async () => {
      const app = new Hono()
      app.use('*', authMiddleware({ jwtSecret: TEST_SECRET }))
      app.get('/protected', (c) => {
        const auth = c.get('auth') as AuthContext
        return c.json({ authenticated: !!auth })
      })

      const res = await app.request('/protected')

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.authenticated).toBe(false)
    })
  })

  // ============================================================================
  // Edge Cases and Error Handling
  // ============================================================================

  describe('edge cases', () => {
    it('should handle multiple cookies correctly', async () => {
      const validateSession = vi.fn().mockResolvedValue({
        userId: 'multi-cookie-user',
        role: 'user',
      })

      const app = new Hono()
      app.use(
        '*',
        authMiddleware({
          jwtSecret: TEST_SECRET,
          validateSession,
          cookieName: 'session',
        }),
      )
      app.get('/protected', (c) => {
        const auth = c.get('auth') as AuthContext
        return c.json({ userId: auth?.userId })
      })

      const res = await app.request('/protected', {
        headers: {
          Cookie: 'other=value; session=valid-token; another=thing',
        },
      })

      expect(res.status).toBe(200)
      expect(validateSession).toHaveBeenCalledWith('valid-token')
    })

    it('should handle empty cookie value', async () => {
      const validateSession = vi.fn().mockResolvedValue({
        userId: 'user',
        role: 'user',
      })

      const app = new Hono()
      app.use(
        '*',
        authMiddleware({
          jwtSecret: TEST_SECRET,
          validateSession,
          cookieName: 'session',
        }),
      )
      app.get('/protected', (c) => {
        const auth = c.get('auth') as AuthContext
        return c.json({ authenticated: !!auth })
      })

      const res = await app.request('/protected', {
        headers: { Cookie: 'session=' },
      })

      expect(res.status).toBe(200)
      // Empty session token should not trigger validation
      expect(validateSession).not.toHaveBeenCalled()
    })

    it('should continue without auth when no credentials provided', async () => {
      const app = new Hono()
      app.use('*', authMiddleware({ jwtSecret: TEST_SECRET }))
      app.get('/protected', (c) => {
        const auth = c.get('auth') as AuthContext
        return c.json({
          authenticated: !!auth,
          user: c.get('user'),
        })
      })

      const res = await app.request('/protected')

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.authenticated).toBe(false)
      expect(body.user).toBeUndefined()
    })

    it('should not set auth context for failed authentication', async () => {
      const app = new Hono()
      app.use('*', authMiddleware({ jwtSecret: TEST_SECRET }))
      app.get('/protected', (c) => {
        return c.json({
          auth: c.get('auth'),
          user: c.get('user'),
          session: c.get('session'),
        })
      })

      const res = await app.request('/protected', {
        headers: { Authorization: 'Bearer invalid' },
      })

      expect(res.status).toBe(401)
    })
  })
})
