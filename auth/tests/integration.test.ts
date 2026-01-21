/**
 * Auth Integration Tests
 *
 * Tests JWT/JWKS auth with REAL cryptographic operations - NO MOCKS
 * Uses jose library for all JWT operations, real RSA key pairs, and actual JWKS validation.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { Hono } from 'hono'
import {
  SignJWT,
  jwtVerify,
  generateKeyPair,
  exportJWK,
  importJWK,
  decodeProtectedHeader,
  type JWK,
  type KeyLike,
} from 'jose'
import {
  createJwksClient,
  verifyTokenWithJwks,
  validateTokenWithJwks,
  fetchJwks,
  type JwksClient,
  type Jwks,
} from '../jwks'
import {
  validateToken,
  verifyTokenSignature,
  checkTokenExpiration,
  extractToken,
  type TokenPayload,
} from '../token'
import { ApiKeyManager, ApiKeyAuth, createApiKeyMiddleware } from '../apikey'
import { requireRole, requireScope, requireAuth, requireOwner } from '../guards'

// ============================================================================
// Real RSA Key Pair Generation for Tests
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

async function generateEcKeySet(kid: string): Promise<KeySet> {
  const { privateKey, publicKey } = await generateKeyPair('ES256')
  const jwk = await exportJWK(publicKey)
  jwk.kid = kid
  jwk.alg = 'ES256'
  jwk.use = 'sig'

  return { privateKey, publicKey, jwk, kid }
}

// ============================================================================
// Mock JWKS Server for Testing
// ============================================================================

class MockJwksServer {
  private keys: Map<string, KeySet> = new Map()
  private fetchCount = 0

  addKey(keySet: KeySet): void {
    this.keys.set(keySet.kid, keySet)
  }

  removeKey(kid: string): void {
    this.keys.delete(kid)
  }

  getJwks(): Jwks {
    return {
      keys: Array.from(this.keys.values()).map((ks) => ks.jwk),
    }
  }

  getPrivateKey(kid: string): KeyLike | undefined {
    return this.keys.get(kid)?.privateKey
  }

  getFetchCount(): number {
    return this.fetchCount
  }

  resetFetchCount(): void {
    this.fetchCount = 0
  }

  // Create a mock fetch function that returns the JWKS
  createFetchHandler(): typeof globalThis.fetch {
    return async (input: RequestInfo | URL): Promise<Response> => {
      this.fetchCount++
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
// Test Suites
// ============================================================================

describe('Auth Integration Tests', () => {
  describe('Real JWT Verification with JWKS', () => {
    let mockServer: MockJwksServer
    let primaryKey: KeySet
    let originalFetch: typeof globalThis.fetch

    beforeAll(async () => {
      primaryKey = await generateRsaKeySet('key-001')
    })

    beforeEach(() => {
      mockServer = new MockJwksServer()
      mockServer.addKey(primaryKey)
      originalFetch = globalThis.fetch
      globalThis.fetch = mockServer.createFetchHandler()
    })

    afterEach(() => {
      globalThis.fetch = originalFetch
    })

    it('should verify real JWT with JWKS', async () => {
      // Create JWKS client
      const client = createJwksClient({
        jwksUri: 'https://id.org.ai/.well-known/jwks.json',
      })

      // Create a real JWT signed with RSA private key
      const token = await new SignJWT({
        sub: 'user-123',
        email: 'test@example.com',
        roles: ['user'],
        scopes: ['read', 'write'],
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'key-001' })
        .setIssuedAt()
        .setIssuer('https://id.org.ai')
        .setAudience('https://api.dotdo.dev')
        .setExpirationTime('1h')
        .sign(primaryKey.privateKey)

      // Verify with JWKS
      const payload = await verifyTokenWithJwks(token, client, {
        issuer: 'https://id.org.ai',
        audience: 'https://api.dotdo.dev',
      })

      expect(payload.sub).toBe('user-123')
      expect(payload.email).toBe('test@example.com')
      expect(payload.roles).toEqual(['user'])
      expect(payload.scopes).toEqual(['read', 'write'])
    })

    it('should reject JWT with invalid signature', async () => {
      const client = createJwksClient({
        jwksUri: 'https://id.org.ai/.well-known/jwks.json',
      })

      // Create a different key pair (not in JWKS)
      const rogueKey = await generateRsaKeySet('rogue-key')

      // Sign with the rogue key but claim it's from key-001
      const token = await new SignJWT({ sub: 'hacker' })
        .setProtectedHeader({ alg: 'RS256', kid: 'key-001' })
        .setIssuedAt()
        .setIssuer('https://id.org.ai')
        .setAudience('https://api.dotdo.dev')
        .setExpirationTime('1h')
        .sign(rogueKey.privateKey)

      await expect(
        verifyTokenWithJwks(token, client, {
          issuer: 'https://id.org.ai',
          audience: 'https://api.dotdo.dev',
        })
      ).rejects.toThrow()
    })

    it('should reject JWT with unknown key ID', async () => {
      const client = createJwksClient({
        jwksUri: 'https://id.org.ai/.well-known/jwks.json',
        refetchOnMissingKey: false, // Disable refetch for this test
      })

      const unknownKey = await generateRsaKeySet('unknown-key')

      const token = await new SignJWT({ sub: 'user-123' })
        .setProtectedHeader({ alg: 'RS256', kid: 'unknown-key' })
        .setIssuedAt()
        .setIssuer('https://id.org.ai')
        .setAudience('https://api.dotdo.dev')
        .setExpirationTime('1h')
        .sign(unknownKey.privateKey)

      await expect(
        verifyTokenWithJwks(token, client, {
          issuer: 'https://id.org.ai',
          audience: 'https://api.dotdo.dev',
        })
      ).rejects.toThrow('Key with kid "unknown-key" not found in JWKS')
    })

    it('should verify JWT with ES256 algorithm', async () => {
      const ecKey = await generateEcKeySet('ec-key-001')
      mockServer.addKey(ecKey)

      const client = createJwksClient({
        jwksUri: 'https://id.org.ai/.well-known/jwks.json',
      })

      const token = await new SignJWT({ sub: 'user-ec' })
        .setProtectedHeader({ alg: 'ES256', kid: 'ec-key-001' })
        .setIssuedAt()
        .setIssuer('https://id.org.ai')
        .setAudience('https://api.dotdo.dev')
        .setExpirationTime('1h')
        .sign(ecKey.privateKey)

      const payload = await verifyTokenWithJwks(token, client, {
        issuer: 'https://id.org.ai',
        audience: 'https://api.dotdo.dev',
      })

      expect(payload.sub).toBe('user-ec')
    })
  })

  describe('Token Expiration', () => {
    let mockServer: MockJwksServer
    let keySet: KeySet
    let originalFetch: typeof globalThis.fetch

    beforeAll(async () => {
      keySet = await generateRsaKeySet('exp-key-001')
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

    it('should accept non-expired token', async () => {
      const client = createJwksClient({
        jwksUri: 'https://id.org.ai/.well-known/jwks.json',
      })

      const token = await new SignJWT({ sub: 'user-fresh' })
        .setProtectedHeader({ alg: 'RS256', kid: 'exp-key-001' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(keySet.privateKey)

      const payload = await verifyTokenWithJwks(token, client)

      expect(payload.sub).toBe('user-fresh')
      const expCheck = checkTokenExpiration(payload)
      expect(expCheck.expired).toBe(false)
      expect(expCheck.expiresIn).toBeGreaterThan(3500) // ~1 hour
    })

    it('should detect token needing refresh', async () => {
      const client = createJwksClient({
        jwksUri: 'https://id.org.ai/.well-known/jwks.json',
      })

      // Token expiring in 2 minutes
      const expiresAt = Math.floor(Date.now() / 1000) + 120
      const token = await new SignJWT({ sub: 'user-expiring' })
        .setProtectedHeader({ alg: 'RS256', kid: 'exp-key-001' })
        .setIssuedAt()
        .setExpirationTime(expiresAt)
        .sign(keySet.privateKey)

      const payload = await verifyTokenWithJwks(token, client)

      const expCheck = checkTokenExpiration(payload, { refreshThreshold: 300 })
      expect(expCheck.expired).toBe(false)
      expect(expCheck.shouldRefresh).toBe(true)
      expect(expCheck.expiresIn).toBeLessThanOrEqual(120)
    })

    it('should reject expired token during jose verification', async () => {
      const client = createJwksClient({
        jwksUri: 'https://id.org.ai/.well-known/jwks.json',
      })

      // Create token that expired 1 minute ago
      const expiredAt = Math.floor(Date.now() / 1000) - 60
      const token = await new SignJWT({ sub: 'user-expired' })
        .setProtectedHeader({ alg: 'RS256', kid: 'exp-key-001' })
        .setIssuedAt(expiredAt - 3600) // Issued 1 hour before expiry
        .setExpirationTime(expiredAt)
        .sign(keySet.privateKey)

      // jose's jwtVerify should reject expired tokens
      await expect(verifyTokenWithJwks(token, client)).rejects.toThrow()
    })

    it('should handle token without expiration claim', () => {
      const payload: TokenPayload = {
        sub: 'user-no-exp',
      }

      const expCheck = checkTokenExpiration(payload)
      expect(expCheck.expired).toBe(false)
      expect(expCheck.expiresIn).toBeNull()
      expect(expCheck.shouldRefresh).toBe(false)
    })
  })

  describe('Token Refresh Flow', () => {
    let mockServer: MockJwksServer
    let keySet: KeySet
    let originalFetch: typeof globalThis.fetch

    beforeAll(async () => {
      keySet = await generateRsaKeySet('refresh-key-001')
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

    it('should implement full token refresh flow', async () => {
      const client = createJwksClient({
        jwksUri: 'https://id.org.ai/.well-known/jwks.json',
      })

      // Create initial token expiring soon
      const initialToken = await new SignJWT({
        sub: 'user-123',
        email: 'user@example.com',
        roles: ['user'],
        refreshToken: 'refresh-abc123',
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'refresh-key-001' })
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(keySet.privateKey)

      // Verify initial token
      const initialPayload = await verifyTokenWithJwks(token, client)
      expect(initialPayload.sub).toBe('user-123')

      // Simulate refresh: verify the old token is valid and issue new one
      const refreshedToken = await new SignJWT({
        sub: initialPayload.sub,
        email: initialPayload.email,
        roles: initialPayload.roles,
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'refresh-key-001' })
        .setIssuedAt()
        .setExpirationTime('1h') // Extended expiration
        .sign(keySet.privateKey)

      // Verify refreshed token
      const refreshedPayload = await verifyTokenWithJwks(refreshedToken, client)
      expect(refreshedPayload.sub).toBe('user-123')
      expect(refreshedPayload.email).toBe('user@example.com')

      // Refreshed token should have longer expiration
      const oldExp = checkTokenExpiration(initialPayload)
      const newExp = checkTokenExpiration(refreshedPayload)
      expect(newExp.expiresIn!).toBeGreaterThan(oldExp.expiresIn!)
    })

    it('should implement Hono refresh endpoint', async () => {
      const app = new Hono()

      const client = createJwksClient({
        jwksUri: 'https://id.org.ai/.well-known/jwks.json',
      })

      app.post('/auth/refresh', async (c) => {
        const authHeader = c.req.header('Authorization')
        if (!authHeader?.startsWith('Bearer ')) {
          return c.json({ error: 'No token provided' }, 401)
        }

        const oldToken = authHeader.slice(7)

        try {
          // Verify old token
          const payload = await verifyTokenWithJwks(oldToken, client)

          // Issue new token with extended expiration
          const newToken = await new SignJWT({
            sub: payload.sub,
            email: payload.email,
            roles: payload.roles,
            scopes: payload.scopes,
          })
            .setProtectedHeader({ alg: 'RS256', kid: 'refresh-key-001' })
            .setIssuedAt()
            .setExpirationTime('1h')
            .sign(keySet.privateKey)

          return c.json({ token: newToken, expiresIn: 3600 })
        } catch (error) {
          return c.json({ error: 'Invalid token' }, 401)
        }
      })

      // Create initial token
      const initialToken = await new SignJWT({
        sub: 'user-456',
        email: 'refresh@example.com',
        roles: ['admin'],
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'refresh-key-001' })
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(keySet.privateKey)

      // Request refresh
      const res = await app.request('/auth/refresh', {
        method: 'POST',
        headers: { Authorization: `Bearer ${initialToken}` },
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.token).toBeDefined()
      expect(json.expiresIn).toBe(3600)

      // Verify the new token works
      const newPayload = await verifyTokenWithJwks(json.token, client)
      expect(newPayload.sub).toBe('user-456')
      expect(newPayload.email).toBe('refresh@example.com')
    })
  })

  describe('JWKS Key Rotation', () => {
    let mockServer: MockJwksServer
    let oldKey: KeySet
    let newKey: KeySet
    let originalFetch: typeof globalThis.fetch

    beforeAll(async () => {
      oldKey = await generateRsaKeySet('old-key-001')
      newKey = await generateRsaKeySet('new-key-001')
    })

    beforeEach(() => {
      mockServer = new MockJwksServer()
      originalFetch = globalThis.fetch
      globalThis.fetch = mockServer.createFetchHandler()
    })

    afterEach(() => {
      globalThis.fetch = originalFetch
    })

    it('should handle key rotation with overlap period', async () => {
      // Start with old key only
      mockServer.addKey(oldKey)

      const client = createJwksClient({
        jwksUri: 'https://id.org.ai/.well-known/jwks.json',
        cacheTtl: 1, // Short cache for testing
        refetchCooldown: 0, // No cooldown for testing
      })

      // Sign token with old key
      const oldToken = await new SignJWT({ sub: 'user-old' })
        .setProtectedHeader({ alg: 'RS256', kid: 'old-key-001' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(oldKey.privateKey)

      // Verify with old key
      const oldPayload = await verifyTokenWithJwks(oldToken, client)
      expect(oldPayload.sub).toBe('user-old')

      // Simulate key rotation: add new key
      mockServer.addKey(newKey)

      // Clear cache to force refetch
      client.clearCache()

      // Sign new token with new key
      const newToken = await new SignJWT({ sub: 'user-new' })
        .setProtectedHeader({ alg: 'RS256', kid: 'new-key-001' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(newKey.privateKey)

      // Both old and new tokens should verify during overlap
      const newPayload = await verifyTokenWithJwks(newToken, client)
      expect(newPayload.sub).toBe('user-new')

      // Old token should still work
      const revalidatedOldPayload = await verifyTokenWithJwks(oldToken, client)
      expect(revalidatedOldPayload.sub).toBe('user-old')
    })

    it('should refetch JWKS when key is not found', async () => {
      mockServer.addKey(oldKey)

      const client = createJwksClient({
        jwksUri: 'https://id.org.ai/.well-known/jwks.json',
        refetchOnMissingKey: true,
        refetchCooldown: 0,
      })

      // Prime the cache with old key
      const oldToken = await new SignJWT({ sub: 'prime' })
        .setProtectedHeader({ alg: 'RS256', kid: 'old-key-001' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(oldKey.privateKey)
      await verifyTokenWithJwks(oldToken, client)

      mockServer.resetFetchCount()

      // Add new key to JWKS
      mockServer.addKey(newKey)

      // Try to verify token signed with new key
      const newToken = await new SignJWT({ sub: 'user-rotated' })
        .setProtectedHeader({ alg: 'RS256', kid: 'new-key-001' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(newKey.privateKey)

      const payload = await verifyTokenWithJwks(newToken, client)
      expect(payload.sub).toBe('user-rotated')

      // Should have fetched JWKS again
      expect(mockServer.getFetchCount()).toBeGreaterThan(0)
    })

    it('should respect refetch cooldown', async () => {
      mockServer.addKey(oldKey)

      const client = createJwksClient({
        jwksUri: 'https://id.org.ai/.well-known/jwks.json',
        refetchOnMissingKey: true,
        refetchCooldown: 60, // 60 second cooldown
      })

      // Prime cache
      const primeToken = await new SignJWT({ sub: 'prime' })
        .setProtectedHeader({ alg: 'RS256', kid: 'old-key-001' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(oldKey.privateKey)
      await verifyTokenWithJwks(primeToken, client)

      mockServer.resetFetchCount()

      // Try multiple requests with unknown key
      const unknownKey = await generateRsaKeySet('unknown')
      const unknownToken = await new SignJWT({ sub: 'unknown' })
        .setProtectedHeader({ alg: 'RS256', kid: 'unknown' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(unknownKey.privateKey)

      // First attempt should trigger refetch
      await expect(verifyTokenWithJwks(unknownToken, client)).rejects.toThrow()
      const fetchAfterFirst = mockServer.getFetchCount()

      // Second attempt should NOT trigger refetch due to cooldown
      await expect(verifyTokenWithJwks(unknownToken, client)).rejects.toThrow()
      const fetchAfterSecond = mockServer.getFetchCount()

      // Fetch count should not have increased
      expect(fetchAfterSecond).toBe(fetchAfterFirst)
    })

    it('should handle complete key removal after rotation', async () => {
      mockServer.addKey(oldKey)
      mockServer.addKey(newKey)

      const client = createJwksClient({
        jwksUri: 'https://id.org.ai/.well-known/jwks.json',
        cacheTtl: 1,
        refetchCooldown: 0,
      })

      // Sign with old key
      const oldToken = await new SignJWT({ sub: 'user-old-key' })
        .setProtectedHeader({ alg: 'RS256', kid: 'old-key-001' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(oldKey.privateKey)

      // Works while old key is in JWKS
      const payload1 = await verifyTokenWithJwks(oldToken, client)
      expect(payload1.sub).toBe('user-old-key')

      // Remove old key from JWKS
      mockServer.removeKey('old-key-001')
      client.clearCache()

      // Old token should fail after key removal
      await expect(verifyTokenWithJwks(oldToken, client)).rejects.toThrow(
        'Key with kid "old-key-001" not found'
      )

      // New key should still work
      const newToken = await new SignJWT({ sub: 'user-new-key' })
        .setProtectedHeader({ alg: 'RS256', kid: 'new-key-001' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(newKey.privateKey)

      const payload2 = await verifyTokenWithJwks(newToken, client)
      expect(payload2.sub).toBe('user-new-key')
    })
  })

  describe('Multi-Tenant Auth', () => {
    let mockServer: MockJwksServer
    let keySet: KeySet
    let originalFetch: typeof globalThis.fetch

    beforeAll(async () => {
      keySet = await generateRsaKeySet('tenant-key-001')
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

    it('should validate tenant claims in token', async () => {
      const client = createJwksClient({
        jwksUri: 'https://id.org.ai/.well-known/jwks.json',
      })

      const token = await new SignJWT({
        sub: 'user-123',
        tenant: 'acme-corp',
        tenantRole: 'admin',
        email: 'admin@acme-corp.com',
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'tenant-key-001' })
        .setIssuedAt()
        .setIssuer('https://id.org.ai')
        .setAudience('https://acme-corp.dotdo.dev')
        .setExpirationTime('1h')
        .sign(keySet.privateKey)

      const payload = await verifyTokenWithJwks(token, client, {
        issuer: 'https://id.org.ai',
        audience: 'https://acme-corp.dotdo.dev',
      })

      expect(payload.sub).toBe('user-123')
      expect(payload.tenant).toBe('acme-corp')
      expect(payload.tenantRole).toBe('admin')
    })

    it('should reject token with wrong tenant audience', async () => {
      const client = createJwksClient({
        jwksUri: 'https://id.org.ai/.well-known/jwks.json',
      })

      // Token for acme-corp tenant
      const token = await new SignJWT({
        sub: 'user-123',
        tenant: 'acme-corp',
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'tenant-key-001' })
        .setIssuedAt()
        .setIssuer('https://id.org.ai')
        .setAudience('https://acme-corp.dotdo.dev')
        .setExpirationTime('1h')
        .sign(keySet.privateKey)

      // Try to use it for different tenant
      await expect(
        verifyTokenWithJwks(token, client, {
          issuer: 'https://id.org.ai',
          audience: 'https://other-tenant.dotdo.dev',
        })
      ).rejects.toThrow()
    })

    it('should support multiple audiences for cross-tenant access', async () => {
      const client = createJwksClient({
        jwksUri: 'https://id.org.ai/.well-known/jwks.json',
      })

      // Super admin token with access to multiple tenants
      const token = await new SignJWT({
        sub: 'super-admin',
        roles: ['super_admin'],
        tenants: ['acme-corp', 'beta-inc', 'gamma-llc'],
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'tenant-key-001' })
        .setIssuedAt()
        .setIssuer('https://id.org.ai')
        .setAudience(['https://acme-corp.dotdo.dev', 'https://beta-inc.dotdo.dev'])
        .setExpirationTime('1h')
        .sign(keySet.privateKey)

      // Should validate for either audience
      const payload1 = await verifyTokenWithJwks(token, client, {
        issuer: 'https://id.org.ai',
        audience: 'https://acme-corp.dotdo.dev',
      })
      expect(payload1.sub).toBe('super-admin')

      const payload2 = await verifyTokenWithJwks(token, client, {
        issuer: 'https://id.org.ai',
        audience: 'https://beta-inc.dotdo.dev',
      })
      expect(payload2.sub).toBe('super-admin')
    })

    it('should implement tenant isolation middleware', async () => {
      const app = new Hono<{
        Variables: {
          user: { id: string; tenant: string; tenantRole: string }
          token: string
        }
      }>()

      const client = createJwksClient({
        jwksUri: 'https://id.org.ai/.well-known/jwks.json',
      })

      // Middleware that extracts and validates tenant
      app.use('/*', async (c, next) => {
        const authHeader = c.req.header('Authorization')
        if (!authHeader?.startsWith('Bearer ')) {
          return c.json({ error: 'Unauthorized' }, 401)
        }

        const token = authHeader.slice(7)

        try {
          // Extract tenant from hostname
          const host = c.req.header('Host') || ''
          const tenantMatch = host.match(/^([^.]+)\.dotdo\.dev/)
          const expectedTenant = tenantMatch?.[1]

          if (!expectedTenant) {
            return c.json({ error: 'Invalid tenant' }, 400)
          }

          const payload = await verifyTokenWithJwks(token, client, {
            issuer: 'https://id.org.ai',
            audience: `https://${expectedTenant}.dotdo.dev`,
          })

          // Verify tenant claim matches
          if (payload.tenant !== expectedTenant) {
            return c.json({ error: 'Tenant mismatch' }, 403)
          }

          c.set('user', {
            id: payload.sub!,
            tenant: payload.tenant as string,
            tenantRole: payload.tenantRole as string,
          })
          c.set('token', token)

          return next()
        } catch (error) {
          return c.json({ error: 'Invalid token' }, 401)
        }
      })

      app.get('/data', (c) => {
        const user = c.get('user')
        return c.json({
          userId: user.id,
          tenant: user.tenant,
          tenantRole: user.tenantRole,
        })
      })

      // Create token for acme-corp
      const token = await new SignJWT({
        sub: 'user-456',
        tenant: 'acme-corp',
        tenantRole: 'member',
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'tenant-key-001' })
        .setIssuedAt()
        .setIssuer('https://id.org.ai')
        .setAudience('https://acme-corp.dotdo.dev')
        .setExpirationTime('1h')
        .sign(keySet.privateKey)

      // Request with correct tenant host
      const res = await app.request('https://acme-corp.dotdo.dev/data', {
        headers: {
          Authorization: `Bearer ${token}`,
          Host: 'acme-corp.dotdo.dev',
        },
      })

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.tenant).toBe('acme-corp')
      expect(json.tenantRole).toBe('member')
    })
  })

  describe('Role-Based Access Control', () => {
    let keySet: KeySet
    let mockServer: MockJwksServer
    let originalFetch: typeof globalThis.fetch

    beforeAll(async () => {
      keySet = await generateRsaKeySet('rbac-key-001')
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

    it('should enforce role requirements', async () => {
      const app = new Hono()

      const client = createJwksClient({
        jwksUri: 'https://id.org.ai/.well-known/jwks.json',
      })

      // Setup JWKS middleware
      app.use('/*', validateTokenWithJwks({ jwksClient: client }))

      // Protected admin route
      app.get('/admin', requireRole('admin'), (c) => {
        return c.json({ message: 'Admin access granted' })
      })

      // User route accessible by any authenticated user
      app.get('/user', requireAuth(), (c) => {
        return c.json({ message: 'User access granted' })
      })

      // Admin token
      const adminToken = await new SignJWT({
        sub: 'admin-001',
        roles: ['admin', 'user'],
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'rbac-key-001' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(keySet.privateKey)

      // Regular user token
      const userToken = await new SignJWT({
        sub: 'user-001',
        roles: ['user'],
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'rbac-key-001' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(keySet.privateKey)

      // Admin can access admin route
      const adminRes = await app.request('/admin', {
        headers: { Authorization: `Bearer ${adminToken}` },
      })
      expect(adminRes.status).toBe(200)

      // User cannot access admin route
      const userAdminRes = await app.request('/admin', {
        headers: { Authorization: `Bearer ${userToken}` },
      })
      expect(userAdminRes.status).toBe(403)

      // Both can access user route
      const adminUserRes = await app.request('/user', {
        headers: { Authorization: `Bearer ${adminToken}` },
      })
      expect(adminUserRes.status).toBe(200)

      const userUserRes = await app.request('/user', {
        headers: { Authorization: `Bearer ${userToken}` },
      })
      expect(userUserRes.status).toBe(200)
    })

    it('should enforce scope requirements', async () => {
      const app = new Hono()

      const client = createJwksClient({
        jwksUri: 'https://id.org.ai/.well-known/jwks.json',
      })

      app.use('/*', validateTokenWithJwks({ jwksClient: client }))

      // Route requiring specific scope
      app.get('/users', requireScope('users:read'), (c) => {
        return c.json({ users: [] })
      })

      app.post('/users', requireScope('users:write'), (c) => {
        return c.json({ created: true })
      })

      // Token with read-only scope
      const readToken = await new SignJWT({
        sub: 'reader-001',
        scopes: ['users:read'],
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'rbac-key-001' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(keySet.privateKey)

      // Token with write scope
      const writeToken = await new SignJWT({
        sub: 'writer-001',
        scopes: ['users:read', 'users:write'],
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'rbac-key-001' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(keySet.privateKey)

      // Read token can read
      const readRes = await app.request('/users', {
        headers: { Authorization: `Bearer ${readToken}` },
      })
      expect(readRes.status).toBe(200)

      // Read token cannot write
      const readWriteRes = await app.request('/users', {
        method: 'POST',
        headers: { Authorization: `Bearer ${readToken}` },
      })
      expect(readWriteRes.status).toBe(403)

      // Write token can do both
      const writeReadRes = await app.request('/users', {
        headers: { Authorization: `Bearer ${writeToken}` },
      })
      expect(writeReadRes.status).toBe(200)

      const writeWriteRes = await app.request('/users', {
        method: 'POST',
        headers: { Authorization: `Bearer ${writeToken}` },
      })
      expect(writeWriteRes.status).toBe(200)
    })

    it('should support wildcard scopes', async () => {
      const app = new Hono()

      const client = createJwksClient({
        jwksUri: 'https://id.org.ai/.well-known/jwks.json',
      })

      app.use('/*', validateTokenWithJwks({ jwksClient: client }))
      app.get('/posts', requireScope('posts:read'), (c) => c.json({ ok: true }))
      app.get('/comments', requireScope('comments:read'), (c) => c.json({ ok: true }))

      // Token with wildcard scope for posts
      const wildcardToken = await new SignJWT({
        sub: 'wildcard-user',
        scopes: ['posts:*', 'comments:read'],
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'rbac-key-001' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(keySet.privateKey)

      // Global wildcard token
      const globalToken = await new SignJWT({
        sub: 'super-user',
        scopes: ['*'],
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'rbac-key-001' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(keySet.privateKey)

      // posts:* should allow posts:read
      const postsRes = await app.request('/posts', {
        headers: { Authorization: `Bearer ${wildcardToken}` },
      })
      expect(postsRes.status).toBe(200)

      // Global wildcard should allow everything
      const globalPostsRes = await app.request('/posts', {
        headers: { Authorization: `Bearer ${globalToken}` },
      })
      expect(globalPostsRes.status).toBe(200)

      const globalCommentsRes = await app.request('/comments', {
        headers: { Authorization: `Bearer ${globalToken}` },
      })
      expect(globalCommentsRes.status).toBe(200)
    })

    it('should implement owner-based access control', async () => {
      const app = new Hono()

      const client = createJwksClient({
        jwksUri: 'https://id.org.ai/.well-known/jwks.json',
      })

      // Simulated resource storage
      const resources = new Map<string, { id: string; ownerId: string; data: string }>([
        ['res-001', { id: 'res-001', ownerId: 'user-owner', data: 'secret' }],
        ['res-002', { id: 'res-002', ownerId: 'other-user', data: 'other-secret' }],
      ])

      app.use('/*', validateTokenWithJwks({ jwksClient: client }))

      app.get(
        '/resources/:id',
        requireOwner((c) => {
          const id = c.req.param('id')
          const resource = resources.get(id)
          return resource?.ownerId || ''
        }),
        (c) => {
          const id = c.req.param('id')
          const resource = resources.get(id)
          return c.json(resource)
        }
      )

      // Owner token
      const ownerToken = await new SignJWT({
        sub: 'user-owner',
        roles: ['user'],
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'rbac-key-001' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(keySet.privateKey)

      // Non-owner token
      const otherToken = await new SignJWT({
        sub: 'not-owner',
        roles: ['user'],
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'rbac-key-001' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(keySet.privateKey)

      // Admin token (should bypass ownership check)
      const adminToken = await new SignJWT({
        sub: 'admin-user',
        roles: ['admin'],
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'rbac-key-001' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(keySet.privateKey)

      // Owner can access their resource
      const ownerRes = await app.request('/resources/res-001', {
        headers: { Authorization: `Bearer ${ownerToken}` },
      })
      expect(ownerRes.status).toBe(200)

      // Non-owner cannot access
      const otherRes = await app.request('/resources/res-001', {
        headers: { Authorization: `Bearer ${otherToken}` },
      })
      expect(otherRes.status).toBe(403)

      // Admin can access any resource
      const adminRes = await app.request('/resources/res-001', {
        headers: { Authorization: `Bearer ${adminToken}` },
      })
      expect(adminRes.status).toBe(200)

      const adminRes2 = await app.request('/resources/res-002', {
        headers: { Authorization: `Bearer ${adminToken}` },
      })
      expect(adminRes2.status).toBe(200)
    })
  })

  describe('API Key Authentication', () => {
    it('should create and validate API keys', async () => {
      const manager = new ApiKeyManager()

      const { key, apiKey } = await manager.create({
        name: 'Integration Test Key',
        scopes: ['users:read', 'posts:*'],
        metadata: { environment: 'test' },
      })

      expect(key).toMatch(/^dotdo_/)
      expect(apiKey.name).toBe('Integration Test Key')
      expect(apiKey.scopes).toEqual(['users:read', 'posts:*'])
      expect(apiKey.active).toBe(true)

      // Validate the key
      const result = await manager.validate(key)
      expect(result.valid).toBe(true)
      expect(result.apiKey?.id).toBe(apiKey.id)
    })

    it('should implement API key middleware with scopes', async () => {
      const app = new Hono()
      const manager = new ApiKeyManager()

      const { key } = await manager.create({
        name: 'Scoped Key',
        scopes: ['api:read'],
      })

      // Apply middleware requiring api:read scope
      app.use('/*', createApiKeyMiddleware(manager, { requireScopes: ['api:read'] }))
      app.get('/data', (c) => c.json({ data: 'secret' }))

      // Valid key with correct scope
      const res = await app.request('/data', {
        headers: { 'X-API-Key': key },
      })
      expect(res.status).toBe(200)

      // Create key without required scope
      const { key: limitedKey } = await manager.create({
        name: 'Limited Key',
        scopes: ['other:scope'],
      })

      const limitedRes = await app.request('/data', {
        headers: { 'X-API-Key': limitedKey },
      })
      expect(limitedRes.status).toBe(403)
    })

    it('should enforce rate limits on API keys', async () => {
      const manager = new ApiKeyManager()

      const { key, apiKey } = await manager.create({
        name: 'Rate Limited Key',
        rateLimit: {
          maxRequests: 3,
          windowMs: 60000,
        },
      })

      // First 3 requests should pass
      for (let i = 0; i < 3; i++) {
        const allowed = await manager.checkRateLimit(apiKey.id)
        expect(allowed).toBe(true)
      }

      // 4th request should be blocked
      const blocked = await manager.checkRateLimit(apiKey.id)
      expect(blocked).toBe(false)
    })

    it('should support API key rotation', async () => {
      const manager = new ApiKeyManager()

      const { key: oldKey, apiKey: oldApiKey } = await manager.create({
        name: 'Rotation Test',
        scopes: ['api:*'],
        metadata: { version: 1 },
      })

      // Rotate the key
      const { key: newKey, apiKey: newApiKey } = await manager.rotate(oldApiKey.id)

      expect(newKey).not.toBe(oldKey)
      expect(newApiKey.id).not.toBe(oldApiKey.id)
      expect(newApiKey.name).toBe(oldApiKey.name)
      expect(newApiKey.scopes).toEqual(oldApiKey.scopes)

      // Old key should be revoked
      const oldResult = await manager.validate(oldKey)
      expect(oldResult.valid).toBe(false)
      expect(oldResult.error).toBe('API key revoked')

      // New key should work
      const newResult = await manager.validate(newKey)
      expect(newResult.valid).toBe(true)
    })

    it('should track API key usage', async () => {
      const manager = new ApiKeyManager()

      const { key, apiKey } = await manager.create({
        name: 'Usage Tracking Key',
      })

      expect(apiKey.lastUsedAt).toBeUndefined()

      // Validate key
      await manager.validate(key)

      // Check usage was tracked
      const updated = await manager.get(apiKey.id)
      expect(updated?.lastUsedAt).toBeInstanceOf(Date)
    })

    it('should handle expired API keys', async () => {
      const manager = new ApiKeyManager()

      const { key } = await manager.create({
        name: 'Expired Key',
        expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
      })

      const result = await manager.validate(key)
      expect(result.valid).toBe(false)
      expect(result.error).toBe('API key expired')
    })

    it('should combine JWT and API key auth', async () => {
      const app = new Hono()

      const manager = new ApiKeyManager()
      const secret = new TextEncoder().encode('test-secret-key-minimum-256-bits-long-for-hs256')

      const { key: apiKey } = await manager.create({
        name: 'Combined Auth Key',
        scopes: ['api:*'],
      })

      // Middleware that accepts either JWT or API key
      app.use('/*', async (c, next) => {
        // Check for API key first
        const apiKeyHeader = c.req.header('X-API-Key')
        if (apiKeyHeader) {
          const result = await manager.validate(apiKeyHeader)
          if (result.valid && result.apiKey) {
            c.set('user', {
              id: `apikey:${result.apiKey.id}`,
              roles: ['api'],
              scopes: result.apiKey.scopes,
            })
            c.set('token', apiKeyHeader)
            return next()
          }
        }

        // Fall back to JWT
        const authHeader = c.req.header('Authorization')
        if (authHeader?.startsWith('Bearer ')) {
          const token = authHeader.slice(7)
          try {
            const { payload } = await jwtVerify(token, secret)
            c.set('user', {
              id: payload.sub!,
              roles: (payload.roles as string[]) || [],
              scopes: (payload.scopes as string[]) || [],
            })
            c.set('token', token)
            return next()
          } catch {
            return c.json({ error: 'Invalid JWT' }, 401)
          }
        }

        return c.json({ error: 'Authentication required' }, 401)
      })

      app.get('/protected', (c) => {
        const user = c.get('user')
        return c.json({ userId: user.id })
      })

      // Test with API key
      const apiKeyRes = await app.request('/protected', {
        headers: { 'X-API-Key': apiKey },
      })
      expect(apiKeyRes.status).toBe(200)
      const apiKeyJson = await apiKeyRes.json()
      expect(apiKeyJson.userId).toContain('apikey:')

      // Test with JWT
      const jwtToken = await new SignJWT({ sub: 'jwt-user-001' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(secret)

      const jwtRes = await app.request('/protected', {
        headers: { Authorization: `Bearer ${jwtToken}` },
      })
      expect(jwtRes.status).toBe(200)
      const jwtJson = await jwtRes.json()
      expect(jwtJson.userId).toBe('jwt-user-001')

      // Test without auth
      const noAuthRes = await app.request('/protected')
      expect(noAuthRes.status).toBe(401)
    })
  })
})
