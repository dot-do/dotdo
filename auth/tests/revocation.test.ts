import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { SignJWT } from 'jose'
import {
  createInMemoryRevocationStore,
  createRevocationChecker,
  checkRevocation,
  type TokenRevocationStore,
} from '../revocation'
import { validateToken } from '../token'

describe('Token Revocation', () => {
  const secret = new TextEncoder().encode('test-secret-key-minimum-256-bits-long-for-hs256')
  const issuer = 'id.org.ai'
  const audience = 'dotdo.api'

  // Helper to create valid JWT with JTI
  async function createJWT(
    payload: Record<string, unknown>,
    options?: { exp?: number; jti?: string }
  ): Promise<string> {
    const jwt = new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setIssuer(issuer)
      .setAudience(audience)

    if (options?.jti) {
      jwt.setJti(options.jti)
    }

    if (options?.exp !== undefined) {
      jwt.setExpirationTime(options.exp)
    } else {
      jwt.setExpirationTime('1h')
    }

    return jwt.sign(secret)
  }

  describe('createInMemoryRevocationStore', () => {
    let store: TokenRevocationStore

    beforeEach(() => {
      store = createInMemoryRevocationStore()
    })

    it('should revoke a token', async () => {
      const jti = 'token-123'
      const expiresAt = Date.now() + 3600000 // 1 hour from now

      await store.revokeToken(jti, expiresAt, 'user requested logout')

      expect(await store.isTokenRevoked(jti)).toBe(true)
    })

    it('should return false for non-revoked tokens', async () => {
      expect(await store.isTokenRevoked('unknown-token')).toBe(false)
    })

    it('should get revocation details', async () => {
      const jti = 'token-456'
      const expiresAt = Date.now() + 3600000
      const reason = 'security concern'

      await store.revokeToken(jti, expiresAt, reason)

      const revocation = await store.getRevocation(jti)
      expect(revocation).not.toBeNull()
      expect(revocation?.jti).toBe(jti)
      expect(revocation?.reason).toBe(reason)
      expect(revocation?.expiresAt).toBe(expiresAt)
      expect(revocation?.revokedAt).toBeLessThanOrEqual(Date.now())
    })

    it('should return null for non-revoked token details', async () => {
      const revocation = await store.getRevocation('unknown')
      expect(revocation).toBeNull()
    })

    it('should cleanup expired revocations', async () => {
      // Add expired revocation
      const expiredJti = 'expired-token'
      await store.revokeToken(expiredJti, Date.now() - 1000) // expired 1 second ago

      // Add valid revocation
      const validJti = 'valid-token'
      await store.revokeToken(validJti, Date.now() + 3600000)

      const cleaned = await store.cleanupExpiredRevocations()

      expect(cleaned).toBe(1)
      expect(await store.isTokenRevoked(expiredJti)).toBe(false)
      expect(await store.isTokenRevoked(validJti)).toBe(true)
    })

    it('should list revocations', async () => {
      await store.revokeToken('token-1', Date.now() + 3600000, 'reason-1')
      await store.revokeToken('token-2', Date.now() + 3600000, 'reason-2')
      await store.revokeToken('token-3', Date.now() + 3600000, 'reason-1')

      const all = await store.listRevocations()
      expect(all).toHaveLength(3)

      const filtered = await store.listRevocations({ reason: 'reason-1' })
      expect(filtered).toHaveLength(2)
    })

    it('should count revocations', async () => {
      await store.revokeToken('token-1', Date.now() + 3600000)
      await store.revokeToken('token-2', Date.now() - 1000) // expired

      // Excluding expired
      expect(await store.countRevocations(false)).toBe(1)

      // Including expired
      expect(await store.countRevocations(true)).toBe(2)
    })

    it('should respect limit and offset in list', async () => {
      for (let i = 0; i < 5; i++) {
        await store.revokeToken(`token-${i}`, Date.now() + 3600000)
      }

      const page1 = await store.listRevocations({ limit: 2, offset: 0 })
      expect(page1).toHaveLength(2)

      const page2 = await store.listRevocations({ limit: 2, offset: 2 })
      expect(page2).toHaveLength(2)

      const page3 = await store.listRevocations({ limit: 2, offset: 4 })
      expect(page3).toHaveLength(1)
    })
  })

  describe('createRevocationChecker', () => {
    it('should create a checker from a store', async () => {
      const store = createInMemoryRevocationStore()
      const checker = createRevocationChecker(store)

      const jti = 'test-token'
      await store.revokeToken(jti, Date.now() + 3600000)

      expect(await checker(jti)).toBe(true)
      expect(await checker('other-token')).toBe(false)
    })
  })

  describe('checkRevocation', () => {
    it('should return false when no JTI provided', async () => {
      const store = createInMemoryRevocationStore()
      expect(await checkRevocation(undefined, { revocationStore: store })).toBe(false)
    })

    it('should use custom checker when provided', async () => {
      const customChecker = async (jti: string) => jti === 'revoked'

      expect(await checkRevocation('revoked', { revocationChecker: customChecker })).toBe(true)
      expect(await checkRevocation('valid', { revocationChecker: customChecker })).toBe(false)
    })

    it('should use store when no checker provided', async () => {
      const store = createInMemoryRevocationStore()
      await store.revokeToken('revoked', Date.now() + 3600000)

      expect(await checkRevocation('revoked', { revocationStore: store })).toBe(true)
      expect(await checkRevocation('valid', { revocationStore: store })).toBe(false)
    })

    it('should return false when no store or checker configured', async () => {
      expect(await checkRevocation('any-token', {})).toBe(false)
    })
  })

  describe('validateToken middleware with revocation', () => {
    let app: Hono
    let revocationStore: TokenRevocationStore

    beforeEach(() => {
      revocationStore = createInMemoryRevocationStore()
      app = new Hono()
      app.use(
        '/*',
        validateToken({
          secret,
          issuer,
          audience,
          revocationStore,
        })
      )
      app.get('/protected', (c) => c.json({ user: c.get('user') }))
    })

    it('should accept valid token that is not revoked', async () => {
      const token = await createJWT({ sub: 'user-123' }, { jti: 'valid-token' })

      const res = await app.request('/protected', {
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(res.status).toBe(200)
    })

    it('should reject revoked token', async () => {
      const jti = 'revoked-token'
      const token = await createJWT({ sub: 'user-123' }, { jti })

      // Revoke the token
      await revocationStore.revokeToken(jti, Date.now() + 3600000, 'user logout')

      const res = await app.request('/protected', {
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(res.status).toBe(401)
      const body = await res.text()
      expect(body).toContain('revoked')
    })

    it('should accept token without JTI when revocation is configured', async () => {
      // Tokens without JTI cannot be revoked, but should still be valid
      const token = await createJWT({ sub: 'user-123' })

      const res = await app.request('/protected', {
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(res.status).toBe(200)
    })
  })

  describe('validateToken middleware with custom revocation checker', () => {
    it('should use custom revocation checker', async () => {
      const revokedTokens = new Set(['bad-token'])
      const customChecker = async (jti: string) => revokedTokens.has(jti)

      const app = new Hono()
      app.use(
        '/*',
        validateToken({
          secret,
          issuer,
          audience,
          revocationChecker: customChecker,
        })
      )
      app.get('/protected', (c) => c.json({ ok: true }))

      // Valid token
      const validToken = await createJWT({ sub: 'user-123' }, { jti: 'good-token' })
      const validRes = await app.request('/protected', {
        headers: { Authorization: `Bearer ${validToken}` },
      })
      expect(validRes.status).toBe(200)

      // Revoked token
      const revokedToken = await createJWT({ sub: 'user-123' }, { jti: 'bad-token' })
      const revokedRes = await app.request('/protected', {
        headers: { Authorization: `Bearer ${revokedToken}` },
      })
      expect(revokedRes.status).toBe(401)
    })
  })
})
