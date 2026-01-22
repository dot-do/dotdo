/**
 * Auth E2E Tests
 *
 * End-to-end tests for complete authentication flows including:
 * 1. Login flow (JWT-based and API key)
 * 2. Token validation across requests
 * 3. Session management (create, refresh, invalidate)
 * 4. Logout flow (single session and all sessions)
 * 5. Permission checks (roles, scopes, ownership)
 *
 * Uses vitest with real cryptographic operations - NO MOCKS
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { SignJWT, generateKeyPair, exportJWK, type KeyLike, type JWK } from 'jose'
import {
  createSession,
  getSession,
  invalidateSession,
  refreshSession,
  clearAllSessions,
  getUserSessions,
  type Session,
} from '../session'
import { authMiddleware } from '../middleware'
import { requireAuth, requireRole, requireScope, requireOwner } from '../guards'
import { ApiKeyManager, createApiKeyMiddleware } from '../apikey'
import { createJwksClient, verifyTokenWithJwks, validateTokenWithJwks, type Jwks } from '../jwks'

// ============================================================================
// Test Infrastructure
// ============================================================================

interface KeySet {
  privateKey: KeyLike
  publicKey: KeyLike
  jwk: JWK
  kid: string
}

async function generateRsaKeySet(kid: string): Promise<KeySet> {
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const jwk = await exportJWK(publicKey)
  jwk.kid = kid
  jwk.alg = 'RS256'
  jwk.use = 'sig'

  return { privateKey, publicKey, jwk, kid }
}

class MockJwksServer {
  private keys: Map<string, KeySet> = new Map()

  addKey(keySet: KeySet): void {
    this.keys.set(keySet.kid, keySet)
  }

  getJwks(): Jwks {
    return {
      keys: Array.from(this.keys.values()).map((ks) => ks.jwk),
    }
  }

  getPrivateKey(kid: string): KeyLike | undefined {
    return this.keys.get(kid)?.privateKey
  }

  createFetchHandler(): typeof globalThis.fetch {
    return async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/.well-known/jwks.json')) {
        return new Response(JSON.stringify(this.getJwks()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('Not Found', { status: 404 })
    }
  }
}

// ============================================================================
// E2E Test Suites
// ============================================================================

describe('Auth E2E Tests', () => {
  // Shared HMAC secret for simpler JWT tests
  const hmacSecret = new TextEncoder().encode('test-secret-key-minimum-256-bits-long-for-hs256')
  const issuer = 'https://id.org.ai'
  const audience = 'https://api.dotdo.dev'

  // Helper to create JWT with HMAC
  async function createHmacJWT(
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

    return jwt.sign(hmacSecret)
  }

  describe('1. Login Flow', () => {
    describe('JWT-based Login', () => {
      it('should complete login flow with valid credentials', async () => {
        const app = new Hono()

        // Login endpoint that issues JWT
        app.post('/auth/login', async (c) => {
          const body = await c.req.json()
          const { email, password } = body

          // Simulate credential validation
          if (email === 'user@example.com' && password === 'correct-password') {
            const token = await createHmacJWT({
              sub: 'user-123',
              email: 'user@example.com',
              roles: ['user'],
              scopes: ['read', 'write'],
            })

            // Create session for the user
            const session = await createSession('user-123', {
              email: 'user@example.com',
              loginMethod: 'password',
            })

            return c.json({
              token,
              sessionId: session.id,
              expiresIn: 3600,
              user: {
                id: 'user-123',
                email: 'user@example.com',
                roles: ['user'],
              },
            })
          }

          return c.json({ error: 'Invalid credentials' }, 401)
        })

        // Test successful login
        const loginRes = await app.request('/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'user@example.com',
            password: 'correct-password',
          }),
        })

        expect(loginRes.status).toBe(200)
        const loginData = await loginRes.json()
        expect(loginData.token).toBeDefined()
        expect(loginData.sessionId).toBeDefined()
        expect(loginData.user.email).toBe('user@example.com')

        // Test failed login
        const failedLoginRes = await app.request('/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'user@example.com',
            password: 'wrong-password',
          }),
        })

        expect(failedLoginRes.status).toBe(401)
      })

      it('should include user metadata in session on login', async () => {
        await clearAllSessions()
        const app = new Hono()

        app.post('/auth/login', async (c) => {
          const ip = c.req.header('X-Forwarded-For') || '127.0.0.1'
          // Use X-Device-Type header for explicit device type in tests
          const deviceType = c.req.header('X-Device-Type') || 'desktop'
          const userAgent = c.req.header('User-Agent') || 'unknown'

          const session = await createSession(
            'user-456',
            { email: 'meta@example.com' },
            {
              metadata: {
                ip,
                userAgent,
                device: deviceType,
              },
            }
          )

          const token = await createHmacJWT({
            sub: 'user-456',
            email: 'meta@example.com',
            sessionId: session.id,
          })

          return c.json({ token, sessionId: session.id })
        })

        const res = await app.request('/auth/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Forwarded-For': '192.168.1.100',
            'X-Device-Type': 'mobile',
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
          },
          body: JSON.stringify({ email: 'meta@example.com', password: 'test' }),
        })

        expect(res.status).toBe(200)
        const data = await res.json()

        // Verify session metadata was stored
        const session = await getSession(data.sessionId)
        expect(session).toBeDefined()
        expect(session?.metadata?.ip).toBe('192.168.1.100')
        expect(session?.metadata?.device).toBe('mobile')
      })

      it('should handle multiple concurrent login sessions', async () => {
        await clearAllSessions()
        const userId = 'multi-session-user'

        // Create sessions from multiple devices
        const session1 = await createSession(userId, {}, { metadata: { device: 'laptop' } })
        const session2 = await createSession(userId, {}, { metadata: { device: 'phone' } })
        const session3 = await createSession(userId, {}, { metadata: { device: 'tablet' } })

        const sessions = await getUserSessions(userId)
        expect(sessions).toHaveLength(3)
        expect(sessions.map((s) => s.metadata?.device)).toContain('laptop')
        expect(sessions.map((s) => s.metadata?.device)).toContain('phone')
        expect(sessions.map((s) => s.metadata?.device)).toContain('tablet')
      })
    })

    describe('API Key Login', () => {
      let apiKeyManager: ApiKeyManager

      beforeEach(() => {
        apiKeyManager = new ApiKeyManager()
      })

      it('should complete login flow with valid API key', async () => {
        const app = new Hono()

        const { key, apiKey } = await apiKeyManager.create({
          name: 'E2E Test Key',
          scopes: ['api:read', 'api:write'],
        })

        app.use('/api/*', createApiKeyMiddleware(apiKeyManager))
        app.get('/api/me', (c) => {
          const user = c.get('user')
          return c.json({ userId: user.id, scopes: user.scopes })
        })

        const res = await app.request('/api/me', {
          headers: { 'X-API-Key': key },
        })

        expect(res.status).toBe(200)
        const data = await res.json()
        expect(data.userId).toContain('apikey:')
        expect(data.scopes).toContain('api:read')
      })

      it('should reject invalid API key', async () => {
        const app = new Hono()

        app.use('/api/*', createApiKeyMiddleware(apiKeyManager))
        app.get('/api/me', (c) => c.json({ ok: true }))

        const res = await app.request('/api/me', {
          headers: { 'X-API-Key': 'invalid-key-that-does-not-exist' },
        })

        expect(res.status).toBe(401)
      })

      it('should reject revoked API key', async () => {
        const app = new Hono()

        const { key, apiKey } = await apiKeyManager.create({
          name: 'Revoked Key',
          scopes: ['api:read'],
        })

        // Revoke the key
        await apiKeyManager.revoke(apiKey.id)

        app.use('/api/*', createApiKeyMiddleware(apiKeyManager))
        app.get('/api/me', (c) => c.json({ ok: true }))

        const res = await app.request('/api/me', {
          headers: { 'X-API-Key': key },
        })

        expect(res.status).toBe(401)
      })
    })
  })

  describe('2. Token Validation', () => {
    let app: Hono

    beforeEach(async () => {
      app = new Hono()
      await clearAllSessions()

      app.use(
        '/protected/*',
        authMiddleware({
          secret: hmacSecret,
          issuer,
          audience,
        })
      )

      app.get('/protected/data', (c) => {
        const user = c.get('user')
        const token = c.get('token')
        return c.json({
          userId: user.id,
          email: user.email,
          roles: user.roles,
          scopes: user.scopes,
          hasToken: !!token,
        })
      })

      app.get('/public/health', (c) => c.json({ status: 'ok' }))
    })

    it('should validate token on every protected request', async () => {
      const token = await createHmacJWT({
        sub: 'user-789',
        email: 'validated@example.com',
        roles: ['user'],
        scopes: ['read'],
      })

      // First request
      const res1 = await app.request('/protected/data', {
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(res1.status).toBe(200)
      const data1 = await res1.json()
      expect(data1.userId).toBe('user-789')

      // Second request with same token
      const res2 = await app.request('/protected/data', {
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(res2.status).toBe(200)
      const data2 = await res2.json()
      expect(data2.userId).toBe('user-789')
    })

    it('should reject expired tokens', async () => {
      const expiredToken = await createHmacJWT(
        { sub: 'user-expired' },
        { exp: Math.floor(Date.now() / 1000) - 60 } // Expired 1 minute ago
      )

      const res = await app.request('/protected/data', {
        headers: { Authorization: `Bearer ${expiredToken}` },
      })

      expect(res.status).toBe(401)
    })

    it('should reject tokens with wrong issuer', async () => {
      const wrongIssuerToken = await createHmacJWT({ sub: 'user-wrong-issuer' }, { iss: 'https://evil.com' })

      const res = await app.request('/protected/data', {
        headers: { Authorization: `Bearer ${wrongIssuerToken}` },
      })

      expect(res.status).toBe(401)
    })

    it('should reject tokens with wrong audience', async () => {
      const wrongAudienceToken = await createHmacJWT({ sub: 'user-wrong-aud' }, { aud: 'https://wrong.api.com' })

      const res = await app.request('/protected/data', {
        headers: { Authorization: `Bearer ${wrongAudienceToken}` },
      })

      expect(res.status).toBe(401)
    })

    it('should reject tampered tokens', async () => {
      const validToken = await createHmacJWT({ sub: 'user-tampered' })
      // Tamper with payload
      const parts = validToken.split('.')
      const payload = JSON.parse(atob(parts[1]))
      payload.sub = 'attacker-id'
      parts[1] = btoa(JSON.stringify(payload))
      const tamperedToken = parts.join('.')

      const res = await app.request('/protected/data', {
        headers: { Authorization: `Bearer ${tamperedToken}` },
      })

      expect(res.status).toBe(401)
    })

    it('should reject requests without token to protected routes', async () => {
      const res = await app.request('/protected/data')
      expect(res.status).toBe(401)
    })

    it('should allow requests to public routes without token', async () => {
      const res = await app.request('/public/health')
      expect(res.status).toBe(200)
    })
  })

  describe('3. Session Management', () => {
    beforeEach(async () => {
      await clearAllSessions()
    })

    it('should create session with proper expiration', async () => {
      const session = await createSession('session-user', { email: 'session@example.com' }, { maxAge: 3600 })

      expect(session.id).toBeDefined()
      expect(session.userId).toBe('session-user')
      expect(session.expiresAt).toBeGreaterThan(Date.now())
      expect(session.expiresAt).toBeLessThanOrEqual(Date.now() + 3600 * 1000 + 100) // Allow 100ms tolerance
    })

    it('should retrieve valid session', async () => {
      const created = await createSession('retrieve-user', { key: 'value' })

      const retrieved = await getSession(created.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved?.userId).toBe('retrieve-user')
      expect(retrieved?.data.key).toBe('value')
    })

    it('should return null for non-existent session', async () => {
      const retrieved = await getSession('non-existent-session-id')
      expect(retrieved).toBeNull()
    })

    it('should return null for expired session', async () => {
      const expired = await createSession('expired-user', {}, { maxAge: -1 })
      const retrieved = await getSession(expired.id)
      expect(retrieved).toBeNull()
    })

    it('should refresh session and extend expiry', async () => {
      const original = await createSession('refresh-user', { count: 0 }, { maxAge: 3600 })
      const originalExpiry = original.expiresAt

      // Wait a bit to ensure time difference
      await new Promise((resolve) => setTimeout(resolve, 50))

      const refreshed = await refreshSession(original.id, { count: 1 })

      expect(refreshed).not.toBeNull()
      expect(refreshed?.data.count).toBe(1)
      expect(refreshed?.expiresAt).toBeGreaterThanOrEqual(originalExpiry)
    })

    it('should implement sliding window expiration', async () => {
      const session = await createSession('sliding-user', {}, { maxAge: 3600 })
      const initialExpiry = session.expiresAt

      // Access session multiple times with small delays
      await new Promise((resolve) => setTimeout(resolve, 10))
      await getSession(session.id)

      await new Promise((resolve) => setTimeout(resolve, 10))
      const finalSession = await getSession(session.id)

      // Expiry should have been extended
      expect(finalSession?.expiresAt).toBeGreaterThan(initialExpiry)
    })

    it('should rotate session ID for security', async () => {
      const original = await createSession('rotate-user', { sensitive: 'data' })
      const originalId = original.id

      const rotated = await refreshSession(original.id, undefined, { rotate: true })

      expect(rotated).not.toBeNull()
      expect(rotated?.id).not.toBe(originalId)
      expect(rotated?.userId).toBe(original.userId)
      expect(rotated?.data.sensitive).toBe('data')

      // Old session should be invalidated
      const oldSession = await getSession(originalId)
      expect(oldSession).toBeNull()
    })
  })

  describe('4. Logout Flow', () => {
    beforeEach(async () => {
      await clearAllSessions()
    })

    it('should logout from single session', async () => {
      const session = await createSession('logout-user', {})

      // Verify session exists
      const beforeLogout = await getSession(session.id)
      expect(beforeLogout).not.toBeNull()

      // Logout (invalidate session)
      const result = await invalidateSession(session.id)
      expect(result).toBe(true)

      // Verify session no longer exists
      const afterLogout = await getSession(session.id)
      expect(afterLogout).toBeNull()
    })

    it('should logout from all user sessions', async () => {
      const userId = 'multi-logout-user'

      // Create multiple sessions
      await createSession(userId, {}, { metadata: { device: 'device1' } })
      await createSession(userId, {}, { metadata: { device: 'device2' } })
      await createSession(userId, {}, { metadata: { device: 'device3' } })

      // Verify all sessions exist
      const beforeLogout = await getUserSessions(userId)
      expect(beforeLogout).toHaveLength(3)

      // Logout from all devices
      const count = await invalidateSession(null, userId)
      expect(count).toBe(3)

      // Verify no sessions remain
      const afterLogout = await getUserSessions(userId)
      expect(afterLogout).toHaveLength(0)
    })

    it('should not affect other users when logging out', async () => {
      const user1 = 'user-one'
      const user2 = 'user-two'

      const session1 = await createSession(user1, {})
      const session2 = await createSession(user2, {})

      // Logout user1
      await invalidateSession(null, user1)

      // User1 session should be gone
      const user1Sessions = await getUserSessions(user1)
      expect(user1Sessions).toHaveLength(0)

      // User2 session should remain
      const user2Session = await getSession(session2.id)
      expect(user2Session).not.toBeNull()
    })

    it('should implement complete logout endpoint', async () => {
      const app = new Hono()

      app.post('/auth/logout', async (c) => {
        const body = await c.req.json().catch(() => ({}))
        const { sessionId, logoutAll, userId } = body

        if (logoutAll && userId) {
          const count = await invalidateSession(null, userId)
          return c.json({ message: `Logged out from ${count} sessions` })
        }

        if (sessionId) {
          const success = await invalidateSession(sessionId)
          if (success) {
            return c.json({ message: 'Logged out successfully' })
          }
          return c.json({ error: 'Session not found' }, 404)
        }

        return c.json({ error: 'Session ID or logout all required' }, 400)
      })

      // Create sessions
      const userId = 'endpoint-user'
      const session1 = await createSession(userId, {})
      const session2 = await createSession(userId, {})

      // Single logout
      const singleLogoutRes = await app.request('/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session1.id }),
      })
      expect(singleLogoutRes.status).toBe(200)

      // Verify session1 is gone but session2 remains
      expect(await getSession(session1.id)).toBeNull()
      expect(await getSession(session2.id)).not.toBeNull()

      // Create more sessions
      await createSession(userId, {})
      await createSession(userId, {})

      // Logout from all
      const allLogoutRes = await app.request('/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logoutAll: true, userId }),
      })
      expect(allLogoutRes.status).toBe(200)
      const allLogoutData = await allLogoutRes.json()
      expect(allLogoutData.message).toContain('Logged out from')

      // Verify all sessions are gone
      const remainingSessions = await getUserSessions(userId)
      expect(remainingSessions).toHaveLength(0)
    })
  })

  describe('5. Permission Checks', () => {
    let app: Hono

    beforeEach(async () => {
      app = new Hono()
      await clearAllSessions()

      // Setup auth middleware
      app.use(
        '/api/*',
        authMiddleware({
          secret: hmacSecret,
          issuer,
          audience,
        })
      )
    })

    describe('Role-Based Access Control', () => {
      beforeEach(() => {
        app.get('/api/admin', requireRole('admin'), (c) => c.json({ access: 'admin' }))
        app.get('/api/user', requireRole('user'), (c) => c.json({ access: 'user' }))
        app.get('/api/any', requireRole('admin', 'user'), (c) => c.json({ access: 'any' }))
      })

      it('should allow admin to access admin route', async () => {
        const adminToken = await createHmacJWT({
          sub: 'admin-user',
          roles: ['admin'],
        })

        const res = await app.request('/api/admin', {
          headers: { Authorization: `Bearer ${adminToken}` },
        })

        expect(res.status).toBe(200)
        const data = await res.json()
        expect(data.access).toBe('admin')
      })

      it('should deny user from accessing admin route', async () => {
        const userToken = await createHmacJWT({
          sub: 'regular-user',
          roles: ['user'],
        })

        const res = await app.request('/api/admin', {
          headers: { Authorization: `Bearer ${userToken}` },
        })

        expect(res.status).toBe(403)
      })

      it('should allow user with multiple roles', async () => {
        const multiRoleToken = await createHmacJWT({
          sub: 'multi-role-user',
          roles: ['user', 'admin'],
        })

        // Can access admin route
        const adminRes = await app.request('/api/admin', {
          headers: { Authorization: `Bearer ${multiRoleToken}` },
        })
        expect(adminRes.status).toBe(200)

        // Can access user route
        const userRes = await app.request('/api/user', {
          headers: { Authorization: `Bearer ${multiRoleToken}` },
        })
        expect(userRes.status).toBe(200)
      })

      it('should accept any of multiple allowed roles', async () => {
        const userToken = await createHmacJWT({
          sub: 'user-only',
          roles: ['user'],
        })

        const adminToken = await createHmacJWT({
          sub: 'admin-only',
          roles: ['admin'],
        })

        // Both should access 'any' route
        const userRes = await app.request('/api/any', {
          headers: { Authorization: `Bearer ${userToken}` },
        })
        expect(userRes.status).toBe(200)

        const adminRes = await app.request('/api/any', {
          headers: { Authorization: `Bearer ${adminToken}` },
        })
        expect(adminRes.status).toBe(200)
      })
    })

    describe('Scope-Based Access Control', () => {
      beforeEach(() => {
        app.get('/api/posts', requireScope('posts:read'), (c) => c.json({ posts: [] }))
        app.post('/api/posts', requireScope('posts:write'), (c) => c.json({ created: true }))
        app.delete('/api/posts/:id', requireScope('posts:delete'), (c) => c.json({ deleted: true }))
      })

      it('should allow access with exact scope match', async () => {
        const token = await createHmacJWT({
          sub: 'scoped-user',
          scopes: ['posts:read'],
        })

        const res = await app.request('/api/posts', {
          headers: { Authorization: `Bearer ${token}` },
        })

        expect(res.status).toBe(200)
      })

      it('should deny access without required scope', async () => {
        const token = await createHmacJWT({
          sub: 'limited-user',
          scopes: ['posts:read'],
        })

        const res = await app.request('/api/posts', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })

        expect(res.status).toBe(403)
      })

      it('should allow access with wildcard scope', async () => {
        const token = await createHmacJWT({
          sub: 'wildcard-user',
          scopes: ['posts:*'],
        })

        // Should access all posts endpoints
        const readRes = await app.request('/api/posts', {
          headers: { Authorization: `Bearer ${token}` },
        })
        expect(readRes.status).toBe(200)

        const writeRes = await app.request('/api/posts', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
        expect(writeRes.status).toBe(200)

        const deleteRes = await app.request('/api/posts/123', {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        })
        expect(deleteRes.status).toBe(200)
      })

      it('should allow access with global wildcard scope', async () => {
        const token = await createHmacJWT({
          sub: 'super-user',
          scopes: ['*'],
        })

        const res = await app.request('/api/posts/123', {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        })

        expect(res.status).toBe(200)
      })
    })

    describe('Ownership-Based Access Control', () => {
      const resources = new Map<string, { id: string; ownerId: string; content: string }>([
        ['post-1', { id: 'post-1', ownerId: 'owner-user', content: 'My post' }],
        ['post-2', { id: 'post-2', ownerId: 'other-user', content: 'Other post' }],
      ])

      beforeEach(() => {
        app.get(
          '/api/posts/:id',
          requireOwner((c) => {
            const id = c.req.param('id')
            return resources.get(id)?.ownerId || ''
          }),
          (c) => {
            const id = c.req.param('id')
            return c.json(resources.get(id))
          }
        )
      })

      it('should allow owner to access their resource', async () => {
        const ownerToken = await createHmacJWT({
          sub: 'owner-user',
          roles: ['user'],
        })

        const res = await app.request('/api/posts/post-1', {
          headers: { Authorization: `Bearer ${ownerToken}` },
        })

        expect(res.status).toBe(200)
        const data = await res.json()
        expect(data.content).toBe('My post')
      })

      it('should deny non-owner from accessing resource', async () => {
        const otherToken = await createHmacJWT({
          sub: 'not-the-owner',
          roles: ['user'],
        })

        const res = await app.request('/api/posts/post-1', {
          headers: { Authorization: `Bearer ${otherToken}` },
        })

        expect(res.status).toBe(403)
      })

      it('should allow admin to bypass ownership check', async () => {
        const adminToken = await createHmacJWT({
          sub: 'admin-user',
          roles: ['admin'],
        })

        // Admin can access any resource
        const res1 = await app.request('/api/posts/post-1', {
          headers: { Authorization: `Bearer ${adminToken}` },
        })
        expect(res1.status).toBe(200)

        const res2 = await app.request('/api/posts/post-2', {
          headers: { Authorization: `Bearer ${adminToken}` },
        })
        expect(res2.status).toBe(200)
      })
    })

    describe('Unauthenticated Requests', () => {
      beforeEach(() => {
        app.get('/api/protected', requireAuth(), (c) => c.json({ ok: true }))
      })

      it('should reject requests without token', async () => {
        const res = await app.request('/api/protected')
        expect(res.status).toBe(401)
      })

      it('should reject requests with invalid token format', async () => {
        const res = await app.request('/api/protected', {
          headers: { Authorization: 'Basic abc123' },
        })
        expect(res.status).toBe(401)
      })

      it('should reject requests with malformed JWT', async () => {
        const res = await app.request('/api/protected', {
          headers: { Authorization: 'Bearer not.a.valid.jwt' },
        })
        expect(res.status).toBe(401)
      })
    })
  })

  describe('E2E: Complete Auth Flow', () => {
    beforeEach(async () => {
      await clearAllSessions()
    })

    it('should complete full login -> use -> logout flow', async () => {
      const app = new Hono()

      // Login endpoint
      app.post('/auth/login', async (c) => {
        const { email, password } = await c.req.json()

        if (email === 'e2e@example.com' && password === 'e2e-password') {
          const session = await createSession('e2e-user', { email })
          const token = await createHmacJWT({
            sub: 'e2e-user',
            email,
            sessionId: session.id,
            roles: ['user'],
            scopes: ['data:read'],
          })

          return c.json({ token, sessionId: session.id })
        }

        return c.json({ error: 'Invalid credentials' }, 401)
      })

      // Protected endpoint
      app.use(
        '/api/*',
        authMiddleware({
          secret: hmacSecret,
          issuer,
          audience,
        })
      )
      app.get('/api/data', requireScope('data:read'), (c) => {
        const user = c.get('user')
        return c.json({ userId: user.id, data: 'secret-data' })
      })

      // Logout endpoint
      app.post('/auth/logout', async (c) => {
        const { sessionId } = await c.req.json()
        await invalidateSession(sessionId)
        return c.json({ message: 'Logged out' })
      })

      // Step 1: Login
      const loginRes = await app.request('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'e2e@example.com', password: 'e2e-password' }),
      })
      expect(loginRes.status).toBe(200)
      const { token, sessionId } = await loginRes.json()
      expect(token).toBeDefined()
      expect(sessionId).toBeDefined()

      // Step 2: Access protected resource
      const dataRes = await app.request('/api/data', {
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(dataRes.status).toBe(200)
      const data = await dataRes.json()
      expect(data.data).toBe('secret-data')

      // Verify session exists
      const session = await getSession(sessionId)
      expect(session).not.toBeNull()

      // Step 3: Logout
      const logoutRes = await app.request('/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
      expect(logoutRes.status).toBe(200)

      // Verify session is invalidated
      const invalidatedSession = await getSession(sessionId)
      expect(invalidatedSession).toBeNull()

      // Token still works (stateless JWT) but session-based operations would fail
      const stillValidRes = await app.request('/api/data', {
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(stillValidRes.status).toBe(200) // JWT is still valid

      // For true logout, you'd need token blacklisting or session-bound validation
    })

    it('should handle session rotation on privilege escalation', async () => {
      // Create initial session (normal user)
      const session = await createSession('escalate-user', {
        roles: ['user'],
        escalated: false,
      })
      const originalId = session.id

      // Simulate privilege escalation (e.g., MFA verification)
      const rotated = await refreshSession(
        session.id,
        { roles: ['user', 'admin'], escalated: true },
        { rotate: true }
      )

      expect(rotated).not.toBeNull()
      expect(rotated?.id).not.toBe(originalId)
      expect(rotated?.data.roles).toContain('admin')
      expect(rotated?.data.escalated).toBe(true)

      // Old session should be invalidated
      const oldSession = await getSession(originalId)
      expect(oldSession).toBeNull()
    })
  })

  describe('E2E: JWKS-Based Authentication', () => {
    let mockServer: MockJwksServer
    let keySet: KeySet
    let originalFetch: typeof globalThis.fetch

    beforeAll(async () => {
      keySet = await generateRsaKeySet('e2e-key-001')
    })

    beforeEach(() => {
      mockServer = new MockJwksServer()
      mockServer.addKey(keySet)
      originalFetch = globalThis.fetch
      globalThis.fetch = mockServer.createFetchHandler()
    })

    afterEach(() => {
      globalThis.fetch = originalFetch
    })

    it('should complete full JWKS-based auth flow', async () => {
      const app = new Hono()

      const jwksClient = createJwksClient({
        jwksUri: 'https://id.org.ai/.well-known/jwks.json',
      })

      app.use('/api/*', validateTokenWithJwks({ jwksClient }))
      app.get('/api/profile', (c) => {
        const user = c.get('user')
        return c.json({
          id: user.id,
          email: user.email,
          roles: user.roles,
        })
      })

      // Create RSA-signed JWT
      const token = await new SignJWT({
        sub: 'jwks-user',
        email: 'jwks@example.com',
        roles: ['user'],
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'e2e-key-001' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(keySet.privateKey)

      const res = await app.request('/api/profile', {
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.id).toBe('jwks-user')
      expect(data.email).toBe('jwks@example.com')
    })
  })
})
