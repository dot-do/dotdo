/**
 * CredentialVault tests
 *
 * RED phase: These tests define the expected behavior of CredentialVault.
 * All tests should FAIL until implementation is complete.
 *
 * CredentialVault provides secure credential storage and rotation:
 * - Storage: AES-256-GCM encrypted storage with versioning
 * - Access: Scoped access tokens, audit logging
 * - Rotation: Automatic rotation policies, manual rotation
 * - Types: API keys, OAuth tokens, passwords, certificates
 * - Providers: Integration adapters for external vaults
 *
 * @module db/primitives/credential-vault
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  CredentialVault,
  createCredentialVault,
  // Types
  type Credential,
  type CredentialType,
  type RotationPolicy,
  type OAuth2Token,
  type AccessToken,
  type AccessTokenOptions,
  type AuditLogEntry,
  type CredentialMetadata,
  type CredentialOptions,
  type ListOptions,
  type RotationOptions,
  type VaultConfig,
  type VaultProvider,
} from './index'

// =============================================================================
// TEST HELPERS
// =============================================================================

function createTestVault(config?: Partial<VaultConfig>): CredentialVault {
  return createCredentialVault({
    encryptionKey: 'test-encryption-key-32-bytes-ok!', // 32 bytes for AES-256
    ...config,
  })
}

// Mock fetch for OAuth refresh tests
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

afterEach(() => {
  mockFetch.mockReset()
})

// =============================================================================
// ENCRYPTION TESTS (AES-256-GCM)
// =============================================================================

describe('CredentialVault', () => {
  describe('Encrypted Storage (AES-256-GCM)', () => {
    it('should encrypt credentials at rest', async () => {
      const vault = createTestVault()

      const cred = await vault.store({
        name: 'test-api-key',
        type: 'api_key',
        value: 'sk_live_supersecret123',
      })

      expect(cred.id).toBeDefined()
      expect(cred.name).toBe('test-api-key')
      // Value should not be stored in plaintext
      expect(cred.value).toBeUndefined() // Stored credential doesn't expose value
    })

    it('should decrypt credentials on retrieval', async () => {
      const vault = createTestVault()

      await vault.store({
        name: 'test-api-key',
        type: 'api_key',
        value: 'sk_live_supersecret123',
      })

      const retrieved = await vault.get('test-api-key')

      expect(retrieved).not.toBeNull()
      expect(retrieved?.value).toBe('sk_live_supersecret123')
    })

    it('should use unique IV per encryption', async () => {
      const vault = createTestVault()

      await vault.store({
        name: 'cred-1',
        type: 'api_key',
        value: 'same-value',
      })

      await vault.store({
        name: 'cred-2',
        type: 'api_key',
        value: 'same-value',
      })

      // Even with same value, encrypted data should differ due to unique IV
      const raw1 = await vault.getRaw('cred-1')
      const raw2 = await vault.getRaw('cred-2')

      expect(raw1?.encryptedValue).not.toBe(raw2?.encryptedValue)
    })

    it('should detect tampering (authenticated encryption)', async () => {
      const vault = createTestVault()

      await vault.store({
        name: 'tamper-test',
        type: 'api_key',
        value: 'original-value',
      })

      // Attempt to tamper with the encrypted data
      await vault.tamperWith('tamper-test')

      // Should throw on retrieval due to auth tag mismatch
      await expect(vault.get('tamper-test')).rejects.toThrow(/tamper|integrity|auth/i)
    })

    it('should derive encryption key from master key', async () => {
      // Same master key should derive same encryption behavior
      const vault1 = createTestVault({ encryptionKey: 'master-key-32-bytes-xxxxxxxx!!!!' })
      const vault2 = createTestVault({ encryptionKey: 'master-key-32-bytes-xxxxxxxx!!!!' })

      await vault1.store({
        name: 'shared-cred',
        type: 'api_key',
        value: 'test-value',
      })

      // Export and import between vaults with same key
      const exported = await vault1.export('shared-cred')
      await vault2.import(exported)

      const retrieved = await vault2.get('shared-cred')
      expect(retrieved?.value).toBe('test-value')
    })

    it('should reject invalid encryption key length', () => {
      expect(() =>
        createCredentialVault({ encryptionKey: 'too-short' })
      ).toThrow(/key.*length|32.*bytes/i)
    })
  })

  // ===========================================================================
  // CREDENTIAL TYPES TESTS
  // ===========================================================================

  describe('Credential Types', () => {
    describe('API Keys', () => {
      it('should store API key credentials', async () => {
        const vault = createTestVault()

        const cred = await vault.store({
          name: 'stripe-api-key',
          type: 'api_key',
          value: 'sk_live_xxx',
          metadata: { environment: 'production', service: 'payments' },
        })

        expect(cred.type).toBe('api_key')
        expect(cred.metadata?.environment).toBe('production')
      })

      it('should retrieve API key with full value', async () => {
        const vault = createTestVault()

        await vault.store({
          name: 'sendgrid-key',
          type: 'api_key',
          value: 'SG.abc123',
        })

        const retrieved = await vault.get('sendgrid-key')

        expect(retrieved?.value).toBe('SG.abc123')
        expect(retrieved?.type).toBe('api_key')
      })
    })

    describe('OAuth2 Tokens', () => {
      it('should store OAuth2 token with refresh token', async () => {
        const vault = createTestVault()

        const expiresAt = new Date(Date.now() + 3600000) // 1 hour from now

        const cred = await vault.store({
          name: 'google-oauth',
          type: 'oauth2',
          value: {
            accessToken: 'ya29.xxx',
            refreshToken: '1//xxx',
            expiresAt,
            tokenType: 'Bearer',
          },
          rotation: {
            policy: 'auto',
            refreshEndpoint: 'https://oauth2.googleapis.com/token',
            clientId: 'client-id',
            clientSecret: 'client-secret',
          },
        })

        expect(cred.type).toBe('oauth2')
      })

      it('should retrieve OAuth2 token with all fields', async () => {
        const vault = createTestVault()

        const expiresAt = new Date(Date.now() + 3600000)

        await vault.store({
          name: 'github-oauth',
          type: 'oauth2',
          value: {
            accessToken: 'gho_xxx',
            refreshToken: 'ghr_xxx',
            expiresAt,
            tokenType: 'Bearer',
            scope: 'repo user',
          },
        })

        const retrieved = await vault.get('github-oauth')
        const token = retrieved?.value as OAuth2Token

        expect(token.accessToken).toBe('gho_xxx')
        expect(token.refreshToken).toBe('ghr_xxx')
        expect(token.scope).toBe('repo user')
      })

      it('should track token expiry', async () => {
        const vault = createTestVault()

        const expiresAt = new Date(Date.now() + 3600000)

        await vault.store({
          name: 'expiring-token',
          type: 'oauth2',
          value: {
            accessToken: 'token',
            expiresAt,
          },
        })

        const retrieved = await vault.get('expiring-token')
        const token = retrieved?.value as OAuth2Token

        expect(token.expiresAt.getTime()).toBe(expiresAt.getTime())
      })
    })

    describe('Passwords', () => {
      it('should store password credentials', async () => {
        const vault = createTestVault()

        const cred = await vault.store({
          name: 'db-password',
          type: 'password',
          value: 'super-secret-password',
          metadata: { database: 'production', user: 'admin' },
        })

        expect(cred.type).toBe('password')
      })

      it('should retrieve password value', async () => {
        const vault = createTestVault()

        await vault.store({
          name: 'service-password',
          type: 'password',
          value: 'p@ssw0rd!',
        })

        const retrieved = await vault.get('service-password')

        expect(retrieved?.value).toBe('p@ssw0rd!')
      })
    })

    describe('Certificates', () => {
      it('should store certificate credentials', async () => {
        const vault = createTestVault()

        const cred = await vault.store({
          name: 'tls-cert',
          type: 'certificate',
          value: {
            certificate: '-----BEGIN CERTIFICATE-----\nMIIC...',
            privateKey: '-----BEGIN PRIVATE KEY-----\nMIIE...',
            chain: ['-----BEGIN CERTIFICATE-----\nMIID...'],
          },
          metadata: { domain: '*.example.com', expiresAt: new Date('2025-12-31') },
        })

        expect(cred.type).toBe('certificate')
      })

      it('should retrieve certificate with all components', async () => {
        const vault = createTestVault()

        await vault.store({
          name: 'api-cert',
          type: 'certificate',
          value: {
            certificate: '-----BEGIN CERTIFICATE-----\ncert',
            privateKey: '-----BEGIN PRIVATE KEY-----\nkey',
          },
        })

        const retrieved = await vault.get('api-cert')
        const cert = retrieved?.value as { certificate: string; privateKey: string }

        expect(cert.certificate).toContain('BEGIN CERTIFICATE')
        expect(cert.privateKey).toContain('BEGIN PRIVATE KEY')
      })
    })

    describe('Generic Secrets', () => {
      it('should store generic secret credentials', async () => {
        const vault = createTestVault()

        const cred = await vault.store({
          name: 'webhook-secret',
          type: 'secret',
          value: 'whsec_abc123',
        })

        expect(cred.type).toBe('secret')
      })

      it('should store JSON object secrets', async () => {
        const vault = createTestVault()

        await vault.store({
          name: 'service-account',
          type: 'secret',
          value: {
            type: 'service_account',
            project_id: 'my-project',
            private_key: '-----BEGIN PRIVATE KEY-----\n...',
          },
        })

        const retrieved = await vault.get('service-account')

        expect(typeof retrieved?.value).toBe('object')
        expect((retrieved?.value as Record<string, unknown>).project_id).toBe('my-project')
      })
    })
  })

  // ===========================================================================
  // CREDENTIAL VERSIONING TESTS
  // ===========================================================================

  describe('Credential Versioning', () => {
    it('should track credential versions on update', async () => {
      const vault = createTestVault()

      await vault.store({
        name: 'versioned-key',
        type: 'api_key',
        value: 'version-1',
      })

      await vault.rotate('versioned-key', { newValue: 'version-2' })
      await vault.rotate('versioned-key', { newValue: 'version-3' })

      const current = await vault.get('versioned-key')
      expect(current?.value).toBe('version-3')
      expect(current?.version).toBe(3)
    })

    it('should retrieve specific version', async () => {
      const vault = createTestVault()

      await vault.store({
        name: 'multi-version',
        type: 'api_key',
        value: 'v1-value',
      })

      await vault.rotate('multi-version', { newValue: 'v2-value' })
      await vault.rotate('multi-version', { newValue: 'v3-value' })

      const v1 = await vault.get('multi-version', { version: 1 })
      const v2 = await vault.get('multi-version', { version: 2 })
      const v3 = await vault.get('multi-version', { version: 3 })

      expect(v1?.value).toBe('v1-value')
      expect(v2?.value).toBe('v2-value')
      expect(v3?.value).toBe('v3-value')
    })

    it('should list all versions of a credential', async () => {
      const vault = createTestVault()

      await vault.store({
        name: 'list-versions',
        type: 'api_key',
        value: 'initial',
      })

      await vault.rotate('list-versions', { newValue: 'rotated-1' })
      await vault.rotate('list-versions', { newValue: 'rotated-2' })

      const versions = await vault.listVersions('list-versions')

      expect(versions).toHaveLength(3)
      expect(versions[0].version).toBe(1)
      expect(versions[2].version).toBe(3)
    })

    it('should soft-delete old versions after retention period', async () => {
      const vault = createTestVault({
        encryptionKey: 'test-encryption-key-32-bytes-ok!',
        versionRetention: 2, // Keep only 2 versions
      })

      await vault.store({
        name: 'retention-test',
        type: 'api_key',
        value: 'v1',
      })

      await vault.rotate('retention-test', { newValue: 'v2' })
      await vault.rotate('retention-test', { newValue: 'v3' })
      await vault.rotate('retention-test', { newValue: 'v4' })

      const versions = await vault.listVersions('retention-test')

      // Only versions 3 and 4 should be retained
      expect(versions).toHaveLength(2)
      expect(versions[0].version).toBe(3)
      expect(versions[1].version).toBe(4)
    })
  })

  // ===========================================================================
  // ROTATION TESTS
  // ===========================================================================

  describe('Credential Rotation', () => {
    describe('Manual Rotation', () => {
      it('should rotate credential manually', async () => {
        const vault = createTestVault()

        await vault.store({
          name: 'manual-rotate',
          type: 'api_key',
          value: 'old-key',
          rotation: { policy: 'manual' },
        })

        await vault.rotate('manual-rotate', { newValue: 'new-key' })

        const retrieved = await vault.get('manual-rotate')
        expect(retrieved?.value).toBe('new-key')
      })

      it('should preserve metadata on rotation', async () => {
        const vault = createTestVault()

        await vault.store({
          name: 'rotate-metadata',
          type: 'api_key',
          value: 'original',
          metadata: { environment: 'production', team: 'platform' },
        })

        await vault.rotate('rotate-metadata', { newValue: 'rotated' })

        const retrieved = await vault.get('rotate-metadata')
        expect(retrieved?.metadata?.environment).toBe('production')
        expect(retrieved?.metadata?.team).toBe('platform')
      })

      it('should record rotation in audit log', async () => {
        const vault = createTestVault()

        await vault.store({
          name: 'audit-rotate',
          type: 'api_key',
          value: 'before',
        })

        await vault.rotate('audit-rotate', {
          newValue: 'after',
          actor: 'admin@example.com',
          reason: 'Scheduled rotation',
        })

        const logs = await vault.getAuditLog('audit-rotate', { limit: 10 })

        expect(logs.some((l) => l.action === 'rotate')).toBe(true)
        const rotateLog = logs.find((l) => l.action === 'rotate')
        expect(rotateLog?.actor).toBe('admin@example.com')
        expect(rotateLog?.reason).toBe('Scheduled rotation')
      })
    })

    describe('OAuth2 Token Refresh', () => {
      it('should auto-refresh OAuth2 token before expiry', async () => {
        const vault = createTestVault()

        const now = Date.now()
        const expiresAt = new Date(now + 60000) // Expires in 1 minute

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: 'new-access-token',
            refresh_token: 'new-refresh-token',
            expires_in: 3600,
            token_type: 'Bearer',
          }),
        })

        await vault.store({
          name: 'auto-refresh-token',
          type: 'oauth2',
          value: {
            accessToken: 'old-access-token',
            refreshToken: 'refresh-token',
            expiresAt,
          },
          rotation: {
            policy: 'auto',
            refreshEndpoint: 'https://oauth.example.com/token',
            clientId: 'client-id',
            clientSecret: 'client-secret',
            refreshBeforeExpiry: 300000, // 5 minutes
          },
        })

        // This should trigger refresh since token expires within refresh window
        const retrieved = await vault.get('auto-refresh-token', { autoRefresh: true })
        const token = retrieved?.value as OAuth2Token

        expect(token.accessToken).toBe('new-access-token')
        expect(mockFetch).toHaveBeenCalled()
      })

      it('should handle refresh token rotation', async () => {
        const vault = createTestVault()

        const expiresAt = new Date(Date.now() - 1000) // Already expired

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: 'new-access',
            refresh_token: 'rotated-refresh', // New refresh token
            expires_in: 3600,
          }),
        })

        await vault.store({
          name: 'rotating-refresh',
          type: 'oauth2',
          value: {
            accessToken: 'expired-access',
            refreshToken: 'old-refresh',
            expiresAt,
          },
          rotation: {
            policy: 'auto',
            refreshEndpoint: 'https://oauth.example.com/token',
            clientId: 'client-id',
            clientSecret: 'client-secret',
          },
        })

        await vault.get('rotating-refresh', { autoRefresh: true })

        // Verify the new refresh token was stored
        const afterRefresh = await vault.get('rotating-refresh')
        const token = afterRefresh?.value as OAuth2Token
        expect(token.refreshToken).toBe('rotated-refresh')
      })

      it('should retry on transient refresh failures', async () => {
        const vault = createTestVault()

        const expiresAt = new Date(Date.now() - 1000)

        mockFetch
          .mockRejectedValueOnce(new Error('Network error'))
          .mockRejectedValueOnce(new Error('Network error'))
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              access_token: 'success-token',
              expires_in: 3600,
            }),
          })

        await vault.store({
          name: 'retry-refresh',
          type: 'oauth2',
          value: {
            accessToken: 'expired',
            refreshToken: 'refresh',
            expiresAt,
          },
          rotation: {
            policy: 'auto',
            refreshEndpoint: 'https://oauth.example.com/token',
            clientId: 'id',
            clientSecret: 'secret',
            maxRetries: 3,
          },
        })

        const retrieved = await vault.get('retry-refresh', { autoRefresh: true })
        const token = retrieved?.value as OAuth2Token

        expect(token.accessToken).toBe('success-token')
        expect(mockFetch).toHaveBeenCalledTimes(3)
      })

      it('should emit events on refresh success/failure', async () => {
        const vault = createTestVault()

        const events: { type: string; name: string }[] = []
        vault.on('credential:refreshed', (e) => events.push({ type: 'refreshed', name: e.name }))
        vault.on('credential:refresh_failed', (e) => events.push({ type: 'failed', name: e.name }))

        const expiresAt = new Date(Date.now() - 1000)

        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            access_token: 'new-token',
            expires_in: 3600,
          }),
        })

        await vault.store({
          name: 'event-test',
          type: 'oauth2',
          value: { accessToken: 'old', refreshToken: 'refresh', expiresAt },
          rotation: {
            policy: 'auto',
            refreshEndpoint: 'https://oauth.example.com/token',
            clientId: 'id',
            clientSecret: 'secret',
          },
        })

        await vault.get('event-test', { autoRefresh: true })

        expect(events).toContainEqual({ type: 'refreshed', name: 'event-test' })
      })
    })

    describe('Scheduled Rotation', () => {
      it('should support rotation schedule policy', async () => {
        const vault = createTestVault()

        const cred = await vault.store({
          name: 'scheduled-rotate',
          type: 'api_key',
          value: 'initial-key',
          rotation: {
            policy: 'scheduled',
            schedule: '30d', // Every 30 days
          },
        })

        expect(cred.rotation?.policy).toBe('scheduled')
        expect(cred.rotation?.nextRotation).toBeDefined()
      })

      it('should calculate next rotation date', async () => {
        const vault = createTestVault()

        const now = Date.now()

        await vault.store({
          name: 'next-rotate',
          type: 'api_key',
          value: 'key',
          rotation: {
            policy: 'scheduled',
            schedule: '7d', // Weekly
          },
        })

        const cred = await vault.getMetadata('next-rotate')
        const nextRotation = cred?.rotation?.nextRotation?.getTime()

        // Should be approximately 7 days from now
        expect(nextRotation).toBeGreaterThan(now + 6 * 24 * 60 * 60 * 1000)
        expect(nextRotation).toBeLessThanOrEqual(now + 8 * 24 * 60 * 60 * 1000)
      })

      it('should list credentials due for rotation', async () => {
        const vault = createTestVault()

        const pastDate = new Date(Date.now() - 86400000) // Yesterday
        const futureDate = new Date(Date.now() + 86400000) // Tomorrow

        await vault.store({
          name: 'overdue-cred',
          type: 'api_key',
          value: 'key1',
          rotation: {
            policy: 'scheduled',
            schedule: '1d',
            nextRotation: pastDate,
          },
        })

        await vault.store({
          name: 'upcoming-cred',
          type: 'api_key',
          value: 'key2',
          rotation: {
            policy: 'scheduled',
            schedule: '1d',
            nextRotation: futureDate,
          },
        })

        const dueForRotation = await vault.listDueForRotation()

        expect(dueForRotation).toHaveLength(1)
        expect(dueForRotation[0].name).toBe('overdue-cred')
      })
    })
  })

  // ===========================================================================
  // SCOPED ACCESS TESTS
  // ===========================================================================

  describe('Scoped Access Control', () => {
    describe('Access Tokens', () => {
      it('should create scoped access token', async () => {
        const vault = createTestVault()

        await vault.store({ name: 'stripe-key', type: 'api_key', value: 'sk_xxx' })
        await vault.store({ name: 'sendgrid-key', type: 'api_key', value: 'SG.xxx' })

        const token = await vault.createAccessToken({
          credentials: ['stripe-key', 'sendgrid-key'],
          permissions: ['read'],
          expiresIn: '1h',
        })

        expect(token.token).toBeDefined()
        expect(token.token.length).toBeGreaterThan(32)
        expect(token.credentials).toEqual(['stripe-key', 'sendgrid-key'])
        expect(token.permissions).toContain('read')
      })

      it('should allow access with valid token', async () => {
        const vault = createTestVault()

        await vault.store({ name: 'allowed-cred', type: 'api_key', value: 'secret-value' })

        const { token } = await vault.createAccessToken({
          credentials: ['allowed-cred'],
          permissions: ['read'],
          expiresIn: '1h',
        })

        const retrieved = await vault.getWithToken(token, 'allowed-cred')

        expect(retrieved?.value).toBe('secret-value')
      })

      it('should deny access to credentials not in token scope', async () => {
        const vault = createTestVault()

        await vault.store({ name: 'allowed', type: 'api_key', value: 'allowed-value' })
        await vault.store({ name: 'denied', type: 'api_key', value: 'denied-value' })

        const { token } = await vault.createAccessToken({
          credentials: ['allowed'],
          permissions: ['read'],
          expiresIn: '1h',
        })

        await expect(vault.getWithToken(token, 'denied')).rejects.toThrow(/access denied|not authorized/i)
      })

      it('should enforce permission levels', async () => {
        const vault = createTestVault()

        await vault.store({ name: 'read-only', type: 'api_key', value: 'value' })

        const { token } = await vault.createAccessToken({
          credentials: ['read-only'],
          permissions: ['read'],
          expiresIn: '1h',
        })

        // Read should work
        const retrieved = await vault.getWithToken(token, 'read-only')
        expect(retrieved?.value).toBe('value')

        // Write should fail
        await expect(
          vault.rotateWithToken(token, 'read-only', { newValue: 'new-value' })
        ).rejects.toThrow(/permission|write|denied/i)
      })

      it('should expire access tokens', async () => {
        vi.useFakeTimers()

        try {
          const vault = createTestVault()

          await vault.store({ name: 'expiring-access', type: 'api_key', value: 'value' })

          const { token } = await vault.createAccessToken({
            credentials: ['expiring-access'],
            permissions: ['read'],
            expiresIn: '1h',
          })

          // Should work initially
          const retrieved = await vault.getWithToken(token, 'expiring-access')
          expect(retrieved?.value).toBe('value')

          // Advance time past expiry
          vi.advanceTimersByTime(2 * 60 * 60 * 1000) // 2 hours

          // Should fail after expiry
          await expect(vault.getWithToken(token, 'expiring-access')).rejects.toThrow(/expired|invalid/i)
        } finally {
          vi.useRealTimers()
        }
      })

      it('should revoke access tokens', async () => {
        const vault = createTestVault()

        await vault.store({ name: 'revoke-test', type: 'api_key', value: 'value' })

        const { token, id } = await vault.createAccessToken({
          credentials: ['revoke-test'],
          permissions: ['read'],
          expiresIn: '1h',
        })

        // Should work initially
        await vault.getWithToken(token, 'revoke-test')

        // Revoke the token
        await vault.revokeAccessToken(id)

        // Should fail after revocation
        await expect(vault.getWithToken(token, 'revoke-test')).rejects.toThrow(/revoked|invalid/i)
      })

      it('should support hierarchical scopes', async () => {
        const vault = createTestVault()

        await vault.store({
          name: 'stripe-live-key',
          type: 'api_key',
          value: 'sk_live_xxx',
          metadata: { scope: 'payments:stripe:live' },
        })

        await vault.store({
          name: 'stripe-test-key',
          type: 'api_key',
          value: 'sk_test_xxx',
          metadata: { scope: 'payments:stripe:test' },
        })

        // Token with wildcard scope
        const { token } = await vault.createAccessToken({
          scopes: ['payments:stripe:*'],
          permissions: ['read'],
          expiresIn: '1h',
        })

        // Both should be accessible
        const live = await vault.getWithToken(token, 'stripe-live-key')
        const test = await vault.getWithToken(token, 'stripe-test-key')

        expect(live?.value).toBe('sk_live_xxx')
        expect(test?.value).toBe('sk_test_xxx')
      })
    })

    describe('Credential Scopes', () => {
      it('should assign scopes to credentials', async () => {
        const vault = createTestVault()

        const cred = await vault.store({
          name: 'scoped-cred',
          type: 'api_key',
          value: 'secret',
          scopes: ['payments', 'billing'],
        })

        expect(cred.scopes).toContain('payments')
        expect(cred.scopes).toContain('billing')
      })

      it('should filter credentials by scope', async () => {
        const vault = createTestVault()

        await vault.store({ name: 'payment-key', type: 'api_key', value: 'pk', scopes: ['payments'] })
        await vault.store({ name: 'email-key', type: 'api_key', value: 'ek', scopes: ['email'] })
        await vault.store({ name: 'multi-key', type: 'api_key', value: 'mk', scopes: ['payments', 'email'] })

        const paymentCreds = await vault.list({ scopes: ['payments'] })

        expect(paymentCreds).toHaveLength(2)
        expect(paymentCreds.map((c) => c.name)).toContain('payment-key')
        expect(paymentCreds.map((c) => c.name)).toContain('multi-key')
      })
    })
  })

  // ===========================================================================
  // AUDIT LOGGING TESTS
  // ===========================================================================

  describe('Audit Logging', () => {
    it('should log credential creation', async () => {
      const vault = createTestVault()

      await vault.store({
        name: 'audit-create',
        type: 'api_key',
        value: 'secret',
      })

      const logs = await vault.getAuditLog('audit-create')

      expect(logs).toHaveLength(1)
      expect(logs[0].action).toBe('create')
      expect(logs[0].timestamp).toBeInstanceOf(Date)
    })

    it('should log credential reads', async () => {
      const vault = createTestVault()

      await vault.store({
        name: 'audit-read',
        type: 'api_key',
        value: 'secret',
      })

      await vault.get('audit-read')
      await vault.get('audit-read')

      const logs = await vault.getAuditLog('audit-read', { action: 'read' })

      expect(logs).toHaveLength(2)
      expect(logs.every((l) => l.action === 'read')).toBe(true)
    })

    it('should log credential rotation', async () => {
      const vault = createTestVault()

      await vault.store({
        name: 'audit-rotation',
        type: 'api_key',
        value: 'old',
      })

      await vault.rotate('audit-rotation', {
        newValue: 'new',
        actor: 'system:rotation-service',
        reason: 'Automated 30-day rotation',
      })

      const logs = await vault.getAuditLog('audit-rotation', { action: 'rotate' })

      expect(logs).toHaveLength(1)
      expect(logs[0].actor).toBe('system:rotation-service')
      expect(logs[0].reason).toBe('Automated 30-day rotation')
      expect(logs[0].metadata?.previousVersion).toBe(1)
      expect(logs[0].metadata?.newVersion).toBe(2)
    })

    it('should log access denials', async () => {
      const vault = createTestVault()

      await vault.store({ name: 'restricted', type: 'api_key', value: 'secret' })

      const { token } = await vault.createAccessToken({
        credentials: ['other-cred'],
        permissions: ['read'],
        expiresIn: '1h',
      })

      try {
        await vault.getWithToken(token, 'restricted')
      } catch {
        // Expected to fail
      }

      const logs = await vault.getAuditLog('restricted', { action: 'access_denied' })

      expect(logs).toHaveLength(1)
      expect(logs[0].action).toBe('access_denied')
    })

    it('should include IP address and user agent in audit log', async () => {
      const vault = createTestVault()

      await vault.store({ name: 'context-audit', type: 'api_key', value: 'secret' })

      await vault.get('context-audit', {
        auditContext: {
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
          requestId: 'req-123',
        },
      })

      const logs = await vault.getAuditLog('context-audit', { action: 'read' })

      expect(logs[0].context?.ipAddress).toBe('192.168.1.1')
      expect(logs[0].context?.userAgent).toBe('Mozilla/5.0')
      expect(logs[0].context?.requestId).toBe('req-123')
    })

    it('should support audit log pagination', async () => {
      const vault = createTestVault()

      await vault.store({ name: 'paginated-audit', type: 'api_key', value: 'secret' })

      // Generate multiple reads
      for (let i = 0; i < 15; i++) {
        await vault.get('paginated-audit')
      }

      const page1 = await vault.getAuditLog('paginated-audit', { limit: 5, offset: 0 })
      const page2 = await vault.getAuditLog('paginated-audit', { limit: 5, offset: 5 })

      expect(page1).toHaveLength(5)
      expect(page2).toHaveLength(5)
      // Pages should not overlap
      expect(page1[0].id).not.toBe(page2[0].id)
    })

    it('should filter audit log by time range', async () => {
      const vault = createTestVault()

      await vault.store({ name: 'time-filter', type: 'api_key', value: 'secret' })

      const beforeRead = new Date()
      await vault.get('time-filter')
      const afterRead = new Date()

      const logs = await vault.getAuditLog('time-filter', {
        since: beforeRead,
        until: afterRead,
        action: 'read',
      })

      expect(logs).toHaveLength(1)
    })
  })

  // ===========================================================================
  // LIST AND QUERY TESTS
  // ===========================================================================

  describe('List and Query', () => {
    it('should list all credentials (metadata only)', async () => {
      const vault = createTestVault()

      await vault.store({ name: 'cred-1', type: 'api_key', value: 'secret1' })
      await vault.store({ name: 'cred-2', type: 'password', value: 'secret2' })
      await vault.store({ name: 'cred-3', type: 'api_key', value: 'secret3' })

      const list = await vault.list()

      expect(list).toHaveLength(3)
      // Values should not be exposed in list
      expect(list.every((c) => c.value === undefined)).toBe(true)
      expect(list.every((c) => c.name && c.type)).toBe(true)
    })

    it('should filter credentials by type', async () => {
      const vault = createTestVault()

      await vault.store({ name: 'api-1', type: 'api_key', value: 'k1' })
      await vault.store({ name: 'api-2', type: 'api_key', value: 'k2' })
      await vault.store({ name: 'pass-1', type: 'password', value: 'p1' })

      const apiKeys = await vault.list({ type: 'api_key' })

      expect(apiKeys).toHaveLength(2)
      expect(apiKeys.every((c) => c.type === 'api_key')).toBe(true)
    })

    it('should filter credentials by metadata', async () => {
      const vault = createTestVault()

      await vault.store({
        name: 'prod-key',
        type: 'api_key',
        value: 'pk',
        metadata: { environment: 'production' },
      })

      await vault.store({
        name: 'dev-key',
        type: 'api_key',
        value: 'dk',
        metadata: { environment: 'development' },
      })

      const prodCreds = await vault.list({ metadata: { environment: 'production' } })

      expect(prodCreds).toHaveLength(1)
      expect(prodCreds[0].name).toBe('prod-key')
    })

    it('should search credentials by name pattern', async () => {
      const vault = createTestVault()

      await vault.store({ name: 'stripe-live-key', type: 'api_key', value: 's1' })
      await vault.store({ name: 'stripe-test-key', type: 'api_key', value: 's2' })
      await vault.store({ name: 'sendgrid-key', type: 'api_key', value: 's3' })

      const stripeCreds = await vault.list({ namePattern: 'stripe-*' })

      expect(stripeCreds).toHaveLength(2)
      expect(stripeCreds.every((c) => c.name.startsWith('stripe-'))).toBe(true)
    })

    it('should paginate credential list', async () => {
      const vault = createTestVault()

      for (let i = 0; i < 10; i++) {
        await vault.store({ name: `cred-${i}`, type: 'api_key', value: `v${i}` })
      }

      const page1 = await vault.list({ limit: 3, offset: 0 })
      const page2 = await vault.list({ limit: 3, offset: 3 })

      expect(page1).toHaveLength(3)
      expect(page2).toHaveLength(3)
      expect(page1[0].name).not.toBe(page2[0].name)
    })
  })

  // ===========================================================================
  // DELETE TESTS
  // ===========================================================================

  describe('Delete Credentials', () => {
    it('should delete credential', async () => {
      const vault = createTestVault()

      await vault.store({ name: 'to-delete', type: 'api_key', value: 'secret' })

      await vault.delete('to-delete')

      const retrieved = await vault.get('to-delete')
      expect(retrieved).toBeNull()
    })

    it('should log deletion in audit', async () => {
      const vault = createTestVault()

      await vault.store({ name: 'audit-delete', type: 'api_key', value: 'secret' })
      await vault.delete('audit-delete', { actor: 'admin', reason: 'No longer needed' })

      // Audit logs should persist even after deletion
      const logs = await vault.getAuditLog('audit-delete', { includeDeleted: true })

      expect(logs.some((l) => l.action === 'delete')).toBe(true)
      const deleteLog = logs.find((l) => l.action === 'delete')
      expect(deleteLog?.actor).toBe('admin')
      expect(deleteLog?.reason).toBe('No longer needed')
    })

    it('should soft-delete by default', async () => {
      const vault = createTestVault()

      await vault.store({ name: 'soft-delete', type: 'api_key', value: 'secret' })
      await vault.delete('soft-delete')

      // Should be able to restore
      await vault.restore('soft-delete')

      const retrieved = await vault.get('soft-delete')
      expect(retrieved?.value).toBe('secret')
    })

    it('should support hard delete', async () => {
      const vault = createTestVault()

      await vault.store({ name: 'hard-delete', type: 'api_key', value: 'secret' })
      await vault.delete('hard-delete', { hard: true })

      // Should not be restorable
      await expect(vault.restore('hard-delete')).rejects.toThrow(/not found/i)
    })
  })

  // ===========================================================================
  // PROVIDER INTEGRATION TESTS
  // ===========================================================================

  describe('External Vault Providers', () => {
    it('should support custom provider adapter', async () => {
      const customProvider: VaultProvider = {
        name: 'custom-vault',
        async get(name: string) {
          if (name === 'external-secret') {
            return { name, type: 'api_key', value: 'from-external-vault' }
          }
          return null
        },
        async set() {
          // No-op for read-only provider
        },
        async delete() {
          // No-op
        },
        async list() {
          return [{ name: 'external-secret', type: 'api_key' }]
        },
      }

      const vault = createTestVault({
        encryptionKey: 'test-encryption-key-32-bytes-ok!',
        providers: [customProvider],
      })

      const cred = await vault.get('external-secret')

      expect(cred?.value).toBe('from-external-vault')
    })

    it('should fall back to providers when credential not found locally', async () => {
      const fallbackProvider: VaultProvider = {
        name: 'fallback',
        async get(name: string) {
          return { name, type: 'api_key', value: 'fallback-value' }
        },
        async set() {},
        async delete() {},
        async list() {
          return []
        },
      }

      const vault = createTestVault({
        encryptionKey: 'test-encryption-key-32-bytes-ok!',
        providers: [fallbackProvider],
      })

      const cred = await vault.get('missing-cred')

      expect(cred?.value).toBe('fallback-value')
    })

    it('should prioritize local credentials over providers', async () => {
      const provider: VaultProvider = {
        name: 'external',
        async get(name: string) {
          return { name, type: 'api_key', value: 'external-value' }
        },
        async set() {},
        async delete() {},
        async list() {
          return []
        },
      }

      const vault = createTestVault({
        encryptionKey: 'test-encryption-key-32-bytes-ok!',
        providers: [provider],
      })

      await vault.store({ name: 'local-cred', type: 'api_key', value: 'local-value' })

      const cred = await vault.get('local-cred')

      expect(cred?.value).toBe('local-value')
    })

    it('should sync credentials from provider', async () => {
      const provider: VaultProvider = {
        name: 'sync-source',
        async get(name: string) {
          const secrets: Record<string, string> = {
            'sync-1': 'value-1',
            'sync-2': 'value-2',
          }
          if (secrets[name]) {
            return { name, type: 'api_key', value: secrets[name] }
          }
          return null
        },
        async set() {},
        async delete() {},
        async list() {
          return [
            { name: 'sync-1', type: 'api_key' as const },
            { name: 'sync-2', type: 'api_key' as const },
          ]
        },
      }

      const vault = createTestVault({
        encryptionKey: 'test-encryption-key-32-bytes-ok!',
        providers: [provider],
      })

      await vault.syncFromProvider('sync-source')

      const localList = await vault.list({ source: 'local' })

      expect(localList).toHaveLength(2)
    })
  })

  // ===========================================================================
  // ERROR HANDLING TESTS
  // ===========================================================================

  describe('Error Handling', () => {
    it('should throw on duplicate credential name', async () => {
      const vault = createTestVault()

      await vault.store({ name: 'duplicate', type: 'api_key', value: 'first' })

      await expect(
        vault.store({ name: 'duplicate', type: 'api_key', value: 'second' })
      ).rejects.toThrow(/already exists|duplicate/i)
    })

    it('should throw on non-existent credential retrieval', async () => {
      const vault = createTestVault()

      const result = await vault.get('non-existent')
      expect(result).toBeNull()
    })

    it('should throw on rotating non-existent credential', async () => {
      const vault = createTestVault()

      await expect(
        vault.rotate('non-existent', { newValue: 'new' })
      ).rejects.toThrow(/not found/i)
    })

    it('should throw on invalid credential type', async () => {
      const vault = createTestVault()

      await expect(
        vault.store({
          name: 'invalid-type',
          // @ts-expect-error - Testing runtime validation
          type: 'invalid',
          value: 'test',
        })
      ).rejects.toThrow(/invalid.*type/i)
    })

    it('should throw on empty credential name', async () => {
      const vault = createTestVault()

      await expect(
        vault.store({ name: '', type: 'api_key', value: 'test' })
      ).rejects.toThrow(/name.*required|empty/i)
    })
  })

  // ===========================================================================
  // CONCURRENT ACCESS TESTS
  // ===========================================================================

  describe('Concurrent Access', () => {
    it('should handle concurrent reads safely', async () => {
      const vault = createTestVault()

      await vault.store({ name: 'concurrent-read', type: 'api_key', value: 'shared-value' })

      const reads = await Promise.all([
        vault.get('concurrent-read'),
        vault.get('concurrent-read'),
        vault.get('concurrent-read'),
        vault.get('concurrent-read'),
        vault.get('concurrent-read'),
      ])

      expect(reads.every((r) => r?.value === 'shared-value')).toBe(true)
    })

    it('should serialize concurrent writes to same credential', async () => {
      const vault = createTestVault()

      await vault.store({ name: 'concurrent-write', type: 'api_key', value: 'initial' })

      // Attempt concurrent rotations
      await Promise.all([
        vault.rotate('concurrent-write', { newValue: 'value-1' }),
        vault.rotate('concurrent-write', { newValue: 'value-2' }),
        vault.rotate('concurrent-write', { newValue: 'value-3' }),
      ])

      const final = await vault.get('concurrent-write')

      // One of the values should win
      expect(['value-1', 'value-2', 'value-3']).toContain(final?.value)
      // Version should reflect all writes
      expect(final?.version).toBe(4) // initial + 3 rotations
    })

    it('should lock during OAuth refresh to prevent duplicate refreshes', async () => {
      const vault = createTestVault()

      let refreshCount = 0

      mockFetch.mockImplementation(async () => {
        refreshCount++
        await new Promise((r) => setTimeout(r, 100)) // Simulate network delay
        return {
          ok: true,
          json: async () => ({
            access_token: `token-${refreshCount}`,
            expires_in: 3600,
          }),
        }
      })

      const expiresAt = new Date(Date.now() - 1000) // Already expired

      await vault.store({
        name: 'concurrent-refresh',
        type: 'oauth2',
        value: { accessToken: 'expired', refreshToken: 'refresh', expiresAt },
        rotation: {
          policy: 'auto',
          refreshEndpoint: 'https://oauth.example.com/token',
          clientId: 'id',
          clientSecret: 'secret',
        },
      })

      // Concurrent refresh attempts
      await Promise.all([
        vault.get('concurrent-refresh', { autoRefresh: true }),
        vault.get('concurrent-refresh', { autoRefresh: true }),
        vault.get('concurrent-refresh', { autoRefresh: true }),
      ])

      // Should only have refreshed once
      expect(refreshCount).toBe(1)
    })
  })
})
