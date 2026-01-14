/**
 * Access tests - Access policies for credential vault
 *
 * TDD: These tests define the expected behavior of access control.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { AccessManager, createAccessManager, type AccessConfig } from '../access'
import { createSecureVault } from '../vault'

afterEach(() => {
  vi.useRealTimers()
})

function createTestAccessManager(config?: Partial<AccessConfig>): AccessManager {
  const vault = createSecureVault({
    encryptionKey: 'test-encryption-key-32-bytes-ok!',
  })
  return createAccessManager({ vault, ...config })
}

describe('AccessManager - Access Policies', () => {
  describe('Access Token Creation', () => {
    it('should create scoped access token', async () => {
      const manager = createTestAccessManager()

      // Store credentials first
      await manager.storeCredential('stripe-key', 'sk_xxx')
      await manager.storeCredential('sendgrid-key', 'SG.xxx')

      const token = await manager.createAccessToken({
        credentials: ['stripe-key', 'sendgrid-key'],
        permissions: ['read'],
        expiresIn: '1h',
      })

      expect(token.token).toBeDefined()
      expect(token.token.length).toBeGreaterThan(32)
      expect(token.credentials).toEqual(['stripe-key', 'sendgrid-key'])
      expect(token.permissions).toContain('read')
    })

    it('should generate cryptographically secure tokens', async () => {
      const manager = createTestAccessManager()

      const token1 = await manager.createAccessToken({
        permissions: ['read'],
        expiresIn: '1h',
      })

      const token2 = await manager.createAccessToken({
        permissions: ['read'],
        expiresIn: '1h',
      })

      expect(token1.token).not.toBe(token2.token)
    })

    it('should set correct expiration time', async () => {
      const manager = createTestAccessManager()
      const now = Date.now()

      const token = await manager.createAccessToken({
        permissions: ['read'],
        expiresIn: '2h',
      })

      const expectedExpiry = now + 2 * 60 * 60 * 1000
      expect(token.expiresAt.getTime()).toBeGreaterThan(expectedExpiry - 1000)
      expect(token.expiresAt.getTime()).toBeLessThan(expectedExpiry + 1000)
    })
  })

  describe('Access Token Validation', () => {
    it('should allow access with valid token', async () => {
      const manager = createTestAccessManager()

      await manager.storeCredential('allowed-cred', 'secret-value')

      const { token } = await manager.createAccessToken({
        credentials: ['allowed-cred'],
        permissions: ['read'],
        expiresIn: '1h',
      })

      const retrieved = await manager.getWithToken(token, 'allowed-cred')

      expect(retrieved).toBe('secret-value')
    })

    it('should deny access to credentials not in token scope', async () => {
      const manager = createTestAccessManager()

      await manager.storeCredential('allowed', 'allowed-value')
      await manager.storeCredential('denied', 'denied-value')

      const { token } = await manager.createAccessToken({
        credentials: ['allowed'],
        permissions: ['read'],
        expiresIn: '1h',
      })

      await expect(manager.getWithToken(token, 'denied')).rejects.toThrow(/access denied/i)
    })

    it('should reject expired tokens', async () => {
      vi.useFakeTimers()

      try {
        const manager = createTestAccessManager()

        await manager.storeCredential('timed-cred', 'value')

        const { token } = await manager.createAccessToken({
          credentials: ['timed-cred'],
          permissions: ['read'],
          expiresIn: '1h',
        })

        // Should work initially
        const retrieved = await manager.getWithToken(token, 'timed-cred')
        expect(retrieved).toBe('value')

        // Advance time past expiry
        vi.advanceTimersByTime(2 * 60 * 60 * 1000) // 2 hours

        // Should fail after expiry
        await expect(manager.getWithToken(token, 'timed-cred')).rejects.toThrow(/expired/i)
      } finally {
        vi.useRealTimers()
      }
    })

    it('should reject revoked tokens', async () => {
      const manager = createTestAccessManager()

      await manager.storeCredential('revoke-test', 'value')

      const { token, id } = await manager.createAccessToken({
        credentials: ['revoke-test'],
        permissions: ['read'],
        expiresIn: '1h',
      })

      // Should work initially
      await manager.getWithToken(token, 'revoke-test')

      // Revoke the token
      await manager.revokeAccessToken(id)

      // Should fail after revocation
      await expect(manager.getWithToken(token, 'revoke-test')).rejects.toThrow(/revoked/i)
    })

    it('should reject invalid tokens', async () => {
      const manager = createTestAccessManager()

      await manager.storeCredential('test-cred', 'value')

      await expect(manager.getWithToken('invalid-token-xxx', 'test-cred')).rejects.toThrow(/invalid/i)
    })
  })

  describe('Permission Levels', () => {
    it('should enforce read permission', async () => {
      const manager = createTestAccessManager()

      await manager.storeCredential('read-only', 'value')

      const { token } = await manager.createAccessToken({
        credentials: ['read-only'],
        permissions: ['read'],
        expiresIn: '1h',
      })

      // Read should work
      const retrieved = await manager.getWithToken(token, 'read-only')
      expect(retrieved).toBe('value')

      // Write should fail
      await expect(manager.rotateWithToken(token, 'read-only', 'new-value')).rejects.toThrow(/permission|write/i)
    })

    it('should enforce write permission', async () => {
      const manager = createTestAccessManager()

      await manager.storeCredential('writable', 'old-value')

      const { token } = await manager.createAccessToken({
        credentials: ['writable'],
        permissions: ['write'],
        expiresIn: '1h',
      })

      // Write should work
      await manager.rotateWithToken(token, 'writable', 'new-value')

      // But read might be denied (write-only token)
      await expect(manager.getWithToken(token, 'writable')).rejects.toThrow(/permission|read/i)
    })

    it('should allow admin permission for all operations', async () => {
      const manager = createTestAccessManager()

      await manager.storeCredential('admin-test', 'value')

      const { token } = await manager.createAccessToken({
        credentials: ['admin-test'],
        permissions: ['admin'],
        expiresIn: '1h',
      })

      // Admin can read
      const retrieved = await manager.getWithToken(token, 'admin-test')
      expect(retrieved).toBe('value')

      // Admin can write
      await manager.rotateWithToken(token, 'admin-test', 'new-value')

      // Admin can delete
      await manager.deleteWithToken(token, 'admin-test')
    })

    it('should support multiple permissions on same token', async () => {
      const manager = createTestAccessManager()

      await manager.storeCredential('multi-perm', 'value')

      const { token } = await manager.createAccessToken({
        credentials: ['multi-perm'],
        permissions: ['read', 'write'],
        expiresIn: '1h',
      })

      // Both read and write should work
      const retrieved = await manager.getWithToken(token, 'multi-perm')
      expect(retrieved).toBe('value')

      await manager.rotateWithToken(token, 'multi-perm', 'updated')
    })
  })

  describe('Hierarchical Scopes', () => {
    it('should support wildcard scope matching', async () => {
      const manager = createTestAccessManager()

      await manager.storeCredential('stripe-live-key', 'sk_live_xxx', {
        scope: 'payments:stripe:live',
      })

      await manager.storeCredential('stripe-test-key', 'sk_test_xxx', {
        scope: 'payments:stripe:test',
      })

      // Token with wildcard scope
      const { token } = await manager.createAccessToken({
        scopes: ['payments:stripe:*'],
        permissions: ['read'],
        expiresIn: '1h',
      })

      // Both should be accessible
      const live = await manager.getWithToken(token, 'stripe-live-key')
      const test = await manager.getWithToken(token, 'stripe-test-key')

      expect(live).toBe('sk_live_xxx')
      expect(test).toBe('sk_test_xxx')
    })

    it('should deny access to credentials outside scope', async () => {
      const manager = createTestAccessManager()

      await manager.storeCredential('payments-key', 'value', {
        scope: 'payments:stripe:live',
      })

      await manager.storeCredential('email-key', 'value', {
        scope: 'email:sendgrid',
      })

      const { token } = await manager.createAccessToken({
        scopes: ['payments:*'],
        permissions: ['read'],
        expiresIn: '1h',
      })

      // payments should work
      await manager.getWithToken(token, 'payments-key')

      // email should fail
      await expect(manager.getWithToken(token, 'email-key')).rejects.toThrow(/access denied|scope/i)
    })

    it('should support nested scope hierarchies', async () => {
      const manager = createTestAccessManager()

      await manager.storeCredential('cred-1', 'v1', { scope: 'org:team1:service1' })
      await manager.storeCredential('cred-2', 'v2', { scope: 'org:team1:service2' })
      await manager.storeCredential('cred-3', 'v3', { scope: 'org:team2:service1' })

      const { token } = await manager.createAccessToken({
        scopes: ['org:team1:*'],
        permissions: ['read'],
        expiresIn: '1h',
      })

      // team1 credentials should work
      await manager.getWithToken(token, 'cred-1')
      await manager.getWithToken(token, 'cred-2')

      // team2 should fail
      await expect(manager.getWithToken(token, 'cred-3')).rejects.toThrow(/access denied/i)
    })
  })

  describe('Access Policies', () => {
    it('should apply IP whitelist policy', async () => {
      const manager = createTestAccessManager()

      await manager.storeCredential('ip-restricted', 'value')

      const { token } = await manager.createAccessToken({
        credentials: ['ip-restricted'],
        permissions: ['read'],
        expiresIn: '1h',
        policy: {
          allowedIPs: ['192.168.1.0/24', '10.0.0.1'],
        },
      })

      // Allowed IP
      const allowed = await manager.getWithToken(token, 'ip-restricted', {
        context: { ipAddress: '192.168.1.100' },
      })
      expect(allowed).toBe('value')

      // Denied IP
      await expect(
        manager.getWithToken(token, 'ip-restricted', {
          context: { ipAddress: '172.16.0.1' },
        })
      ).rejects.toThrow(/ip.*denied|not allowed/i)
    })

    it('should apply time-based access policy', async () => {
      vi.useFakeTimers()
      const baseTime = new Date('2024-01-15T10:00:00Z').getTime()
      vi.setSystemTime(baseTime)

      try {
        const manager = createTestAccessManager()

        await manager.storeCredential('time-restricted', 'value')

        const { token } = await manager.createAccessToken({
          credentials: ['time-restricted'],
          permissions: ['read'],
          expiresIn: '24h',
          policy: {
            allowedHours: { start: 9, end: 17 }, // 9 AM to 5 PM UTC
          },
        })

        // Within hours (10 AM)
        const allowed = await manager.getWithToken(token, 'time-restricted')
        expect(allowed).toBe('value')

        // Outside hours (8 PM)
        vi.setSystemTime(new Date('2024-01-15T20:00:00Z').getTime())
        await expect(manager.getWithToken(token, 'time-restricted')).rejects.toThrow(/time.*denied|outside.*hours/i)
      } finally {
        vi.useRealTimers()
      }
    })

    it('should apply rate limiting policy', async () => {
      const manager = createTestAccessManager()

      await manager.storeCredential('rate-limited', 'value')

      const { token } = await manager.createAccessToken({
        credentials: ['rate-limited'],
        permissions: ['read'],
        expiresIn: '1h',
        policy: {
          rateLimit: { maxRequests: 3, windowMs: 60000 },
        },
      })

      // First 3 requests should succeed
      await manager.getWithToken(token, 'rate-limited')
      await manager.getWithToken(token, 'rate-limited')
      await manager.getWithToken(token, 'rate-limited')

      // 4th should be rate limited
      await expect(manager.getWithToken(token, 'rate-limited')).rejects.toThrow(/rate.*limit|too many/i)
    })
  })

  describe('Token Management', () => {
    it('should list all active tokens', async () => {
      const manager = createTestAccessManager()

      await manager.createAccessToken({
        permissions: ['read'],
        expiresIn: '1h',
      })

      await manager.createAccessToken({
        permissions: ['write'],
        expiresIn: '2h',
      })

      const tokens = await manager.listAccessTokens()

      expect(tokens).toHaveLength(2)
    })

    it('should not list revoked tokens by default', async () => {
      const manager = createTestAccessManager()

      const { id } = await manager.createAccessToken({
        permissions: ['read'],
        expiresIn: '1h',
      })

      await manager.createAccessToken({
        permissions: ['read'],
        expiresIn: '1h',
      })

      await manager.revokeAccessToken(id)

      const activeTokens = await manager.listAccessTokens()
      expect(activeTokens).toHaveLength(1)

      const allTokens = await manager.listAccessTokens({ includeRevoked: true })
      expect(allTokens).toHaveLength(2)
    })

    it('should bulk revoke tokens by criteria', async () => {
      const manager = createTestAccessManager()

      await manager.storeCredential('cred-1', 'v1')
      await manager.storeCredential('cred-2', 'v2')

      await manager.createAccessToken({
        credentials: ['cred-1'],
        permissions: ['read'],
        expiresIn: '1h',
      })

      await manager.createAccessToken({
        credentials: ['cred-1'],
        permissions: ['read'],
        expiresIn: '1h',
      })

      await manager.createAccessToken({
        credentials: ['cred-2'],
        permissions: ['read'],
        expiresIn: '1h',
      })

      // Revoke all tokens for cred-1
      await manager.revokeTokensForCredential('cred-1')

      const remaining = await manager.listAccessTokens()
      expect(remaining).toHaveLength(1)
      expect(remaining[0].credentials).toContain('cred-2')
    })
  })
})
