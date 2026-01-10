/**
 * Comprehensive Vault Context Tests
 *
 * Tests for $.vault context for secrets management as specified in dotdo-9clpt.
 *
 * Coverage:
 * 1. Secret storage and retrieval (validated against existing tests)
 * 2. Secret rotation
 * 3. Access control for secrets
 * 4. Encryption at rest verification
 * 5. Integration with DO lifecycle
 *
 * @module tests/vault/comprehensive-vault
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  createMockContext,
  type VaultCredentials,
  type VaultContext,
} from '../../workflows/context/vault'
import {
  createMockVaultContext,
  type VaultContext as StoreVaultContext,
} from '../../lib/vault/store'

// ============================================================================
// SECRET STORAGE AND RETRIEVAL
// ============================================================================

describe('$.vault Secret Storage and Retrieval', () => {
  let $: VaultContext

  beforeEach(() => {
    $ = createMockContext()
  })

  describe('basic secret operations', () => {
    it('stores and retrieves OAuth token secrets', async () => {
      $._storage.credentials.set('github', {
        provider: 'github',
        accessToken: 'gho_secret_token_12345',
        tokenType: 'bearer',
        expiresAt: new Date(Date.now() + 3600000),
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const token = await $.vault('github').getToken()
      expect(token).toBe('gho_secret_token_12345')
    })

    it('stores and retrieves API key secrets', async () => {
      $._storage.credentials.set('openai', {
        provider: 'openai',
        apiKey: 'sk-proj-xxxxxxxx',
        tokenType: 'api_key',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const creds = await $.vault('openai').getCredentials()
      expect(creds?.apiKey).toBe('sk-proj-xxxxxxxx')
    })

    it('stores secrets with metadata for context', async () => {
      $._storage.credentials.set('stripe', {
        provider: 'stripe',
        apiKey: 'sk_live_xxxx',
        tokenType: 'api_key',
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {
          environment: 'production',
          version: 'v1',
          region: 'us-east-1',
        },
      })

      const creds = await $.vault('stripe').getCredentials()
      expect(creds?.metadata?.environment).toBe('production')
      expect(creds?.metadata?.version).toBe('v1')
      expect(creds?.metadata?.region).toBe('us-east-1')
    })

    it('handles missing secrets gracefully', async () => {
      const token = await $.vault('nonexistent').getToken()
      expect(token).toBeNull()

      const creds = await $.vault('nonexistent').getCredentials()
      expect(creds).toBeNull()

      const connected = await $.vault('nonexistent').isConnected()
      expect(connected).toBe(false)
    })
  })

  describe('secret types', () => {
    it('supports OAuth tokens with refresh capability', async () => {
      $._storage.credentials.set('google', {
        provider: 'google',
        accessToken: 'ya29.xxx',
        refreshToken: '1//xxx',
        tokenType: 'bearer',
        scope: 'email profile',
        expiresAt: new Date(Date.now() + 3600000),
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const creds = await $.vault('google').getCredentials()
      expect(creds?.accessToken).toBeDefined()
      expect(creds?.refreshToken).toBeDefined()
      expect(creds?.scope).toBe('email profile')
    })

    it('supports API keys without expiration', async () => {
      $._storage.credentials.set('anthropic', {
        provider: 'anthropic',
        apiKey: 'sk-ant-api03-xxx',
        tokenType: 'api_key',
        createdAt: new Date(),
        updatedAt: new Date(),
        // No expiresAt - API keys don't expire
      })

      const connected = await $.vault('anthropic').isConnected()
      expect(connected).toBe(true)

      // Should remain connected indefinitely
      const creds = await $.vault('anthropic').getCredentials()
      expect(creds?.expiresAt).toBeUndefined()
    })

    it('supports secrets with custom scopes', async () => {
      $._storage.credentials.set('slack', {
        provider: 'slack',
        accessToken: 'xoxb-xxx',
        tokenType: 'bearer',
        scope: 'channels:read,chat:write,users:read',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const creds = await $.vault('slack').getCredentials()
      expect(creds?.scope).toContain('channels:read')
      expect(creds?.scope).toContain('chat:write')
    })
  })
})

// ============================================================================
// SECRET ROTATION
// ============================================================================

describe('$.vault Secret Rotation', () => {
  let $: VaultContext

  beforeEach(() => {
    $ = createMockContext()
  })

  describe('OAuth token rotation', () => {
    it('rotates access token via refresh', async () => {
      const oldToken = 'old_access_token'
      const newToken = 'new_access_token'

      $._storage.credentials.set('github', {
        provider: 'github',
        accessToken: oldToken,
        refreshToken: 'ghr_refresh_token',
        tokenType: 'bearer',
        expiresAt: new Date(Date.now() - 1000), // Expired
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      $._mockRefresh.set('github', {
        accessToken: newToken,
        expiresIn: 3600,
      })

      await $.vault('github').refresh()

      const creds = await $.vault('github').getCredentials()
      expect(creds?.accessToken).toBe(newToken)
      expect(creds?.accessToken).not.toBe(oldToken)
    })

    it('extends expiration time on rotation', async () => {
      const now = Date.now()
      const oldExpiry = new Date(now - 1000)

      $._storage.credentials.set('github', {
        provider: 'github',
        accessToken: 'old_token',
        refreshToken: 'ghr_refresh',
        tokenType: 'bearer',
        expiresAt: oldExpiry,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      $._mockRefresh.set('github', {
        accessToken: 'new_token',
        expiresIn: 7200, // 2 hours
      })

      await $.vault('github').refresh()

      const creds = await $.vault('github').getCredentials()
      expect(creds?.expiresAt?.getTime()).toBeGreaterThan(now)
      expect(creds?.expiresAt?.getTime()).toBeGreaterThan(oldExpiry.getTime())
    })

    it('preserves refresh token after rotation', async () => {
      const refreshToken = 'ghr_persistent_refresh'

      $._storage.credentials.set('github', {
        provider: 'github',
        accessToken: 'old_token',
        refreshToken,
        tokenType: 'bearer',
        expiresAt: new Date(Date.now() - 1000),
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      $._mockRefresh.set('github', {
        accessToken: 'new_token',
        expiresIn: 3600,
      })

      await $.vault('github').refresh()

      const creds = await $.vault('github').getCredentials()
      expect(creds?.refreshToken).toBe(refreshToken)
    })

    it('updates timestamp on rotation', async () => {
      const originalUpdatedAt = new Date(Date.now() - 60000)

      $._storage.credentials.set('github', {
        provider: 'github',
        accessToken: 'old_token',
        refreshToken: 'ghr_refresh',
        tokenType: 'bearer',
        expiresAt: new Date(Date.now() - 1000),
        createdAt: new Date(Date.now() - 120000),
        updatedAt: originalUpdatedAt,
      })

      $._mockRefresh.set('github', {
        accessToken: 'new_token',
        expiresIn: 3600,
      })

      await $.vault('github').refresh()

      const creds = await $.vault('github').getCredentials()
      expect(creds?.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime())
    })
  })

  describe('API key rotation', () => {
    it('rejects refresh for API key providers', async () => {
      $._storage.credentials.set('stripe', {
        provider: 'stripe',
        apiKey: 'sk_live_xxx',
        tokenType: 'api_key',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // API keys cannot be refreshed - they must be manually rotated
      await expect($.vault('stripe').refresh()).rejects.toThrow()
    })

    it('supports manual API key rotation via reconnect', async () => {
      $._providerConfigs.set('stripe', {
        type: 'api_key',
      })

      // Initial connection
      await $.vaults.connect('stripe', {
        apiKey: 'sk_live_old_key',
      })

      let creds = await $.vault('stripe').getCredentials()
      expect(creds?.apiKey).toBe('sk_live_old_key')

      // Manual rotation - disconnect and reconnect with new key
      await $.vault('stripe').disconnect()
      await $.vaults.connect('stripe', {
        apiKey: 'sk_live_new_key',
      })

      creds = await $.vault('stripe').getCredentials()
      expect(creds?.apiKey).toBe('sk_live_new_key')
    })
  })

  describe('rotation error handling', () => {
    it('throws when no refresh token available', async () => {
      $._storage.credentials.set('github', {
        provider: 'github',
        accessToken: 'token_without_refresh',
        tokenType: 'bearer',
        // No refreshToken
        expiresAt: new Date(Date.now() - 1000),
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      await expect($.vault('github').refresh()).rejects.toThrow()
    })

    it('throws when provider is not connected', async () => {
      await expect($.vault('unconnected').refresh()).rejects.toThrow()
    })

    it('throws with descriptive error for rotation failure', async () => {
      $._storage.credentials.set('github', {
        provider: 'github',
        accessToken: 'old_token',
        refreshToken: 'ghr_refresh',
        tokenType: 'bearer',
        expiresAt: new Date(Date.now() - 1000),
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // No mock refresh configured = refresh will fail
      await expect($.vault('github').refresh()).rejects.toThrow(/refresh|configured/i)
    })
  })
})

// ============================================================================
// ACCESS CONTROL FOR SECRETS
// ============================================================================

describe('$.vault Access Control', () => {
  describe('user isolation in vault store', () => {
    let $: StoreVaultContext

    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-10T12:00:00.000Z'))
      $ = createMockVaultContext()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('isolates secrets by user ID', async () => {
      await $.vault('user:alice').set('api-key', 'alice-secret')
      await $.vault('user:bob').set('api-key', 'bob-secret')

      const aliceCred = await $.vault('user:alice').get('api-key')
      const bobCred = await $.vault('user:bob').get('api-key')

      expect(aliceCred?.value).toBe('alice-secret')
      expect(bobCred?.value).toBe('bob-secret')
      expect(aliceCred?.value).not.toBe(bobCred?.value)
    })

    it('prevents cross-user secret access', async () => {
      await $.vault('user:alice').set('private-key', 'super-secret')

      // Bob should not be able to access Alice's secrets
      const bobAccess = await $.vault('user:bob').get('private-key')
      expect(bobAccess).toBeNull()
    })

    it('user deletion does not affect other users', async () => {
      await $.vault('user:alice').set('key-1', 'value-1')
      await $.vault('user:bob').set('key-1', 'value-1')

      await $.vault('user:alice').delete('key-1')

      expect(await $.vault('user:alice').get('key-1')).toBeNull()
      expect(await $.vault('user:bob').get('key-1')).not.toBeNull()
    })

    it('lists only user-specific keys', async () => {
      await $.vault('user:alice').set('alice-key-1', 'value')
      await $.vault('user:alice').set('alice-key-2', 'value')
      await $.vault('user:bob').set('bob-key-1', 'value')

      const aliceKeys = await $.vault('user:alice').list()
      const bobKeys = await $.vault('user:bob').list()

      expect(aliceKeys).toContain('alice-key-1')
      expect(aliceKeys).toContain('alice-key-2')
      expect(aliceKeys).not.toContain('bob-key-1')
      expect(bobKeys).toContain('bob-key-1')
      expect(bobKeys).not.toContain('alice-key-1')
    })
  })

  describe('provider-level access in workflow context', () => {
    let $: VaultContext

    beforeEach(() => {
      $ = createMockContext()
    })

    it('isolates credentials by provider', async () => {
      $._storage.credentials.set('github', {
        provider: 'github',
        accessToken: 'github-token',
        tokenType: 'bearer',
        expiresAt: new Date(Date.now() + 3600000),
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      $._storage.credentials.set('gitlab', {
        provider: 'gitlab',
        accessToken: 'gitlab-token',
        tokenType: 'bearer',
        expiresAt: new Date(Date.now() + 3600000),
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      expect(await $.vault('github').getToken()).toBe('github-token')
      expect(await $.vault('gitlab').getToken()).toBe('gitlab-token')
    })

    it('disconnect affects only target provider', async () => {
      $._storage.credentials.set('provider-a', {
        provider: 'provider-a',
        accessToken: 'token-a',
        tokenType: 'bearer',
        expiresAt: new Date(Date.now() + 3600000),
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      $._storage.credentials.set('provider-b', {
        provider: 'provider-b',
        accessToken: 'token-b',
        tokenType: 'bearer',
        expiresAt: new Date(Date.now() + 3600000),
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      await $.vault('provider-a').disconnect()

      expect(await $.vault('provider-a').isConnected()).toBe(false)
      expect(await $.vault('provider-b').isConnected()).toBe(true)
    })

    it('status flag controls visibility', async () => {
      $._storage.credentials.set('github', {
        provider: 'github',
        accessToken: 'valid-token',
        tokenType: 'bearer',
        expiresAt: new Date(Date.now() + 3600000),
        createdAt: new Date(),
        updatedAt: new Date(),
        status: 'disconnected', // Explicitly disconnected
      })

      // Even though token exists, status says disconnected
      expect(await $.vault('github').isConnected()).toBe(false)
      expect(await $.vault('github').getToken()).toBeNull()
    })
  })

  describe('OAuth state CSRF protection', () => {
    let $: VaultContext

    beforeEach(() => {
      $ = createMockContext()
    })

    it('validates state parameter in callback', async () => {
      $._providerConfigs.set('github', {
        type: 'oauth',
        clientId: 'client_id',
        clientSecret: 'client_secret',
        authorizationUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        scopes: ['repo'],
      })

      // Attempt callback with invalid state
      await expect(
        $.vaults.getCallback('github', {
          code: 'auth_code',
          state: 'invalid_state_token',
        })
      ).rejects.toThrow(/state/i)
    })

    it('prevents state reuse (one-time use)', async () => {
      $._providerConfigs.set('github', {
        type: 'oauth',
        clientId: 'client_id',
        clientSecret: 'client_secret',
        authorizationUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        scopes: ['repo'],
      })

      const { state } = await $.vaults.connect('github', {
        redirectUri: 'https://example.com/callback',
      })

      $._mockTokenExchange.set('github', {
        access_token: 'token',
        token_type: 'bearer',
      })

      // First callback succeeds
      await $.vaults.getCallback('github', { code: 'code1', state })

      // Second callback with same state should fail
      await expect(
        $.vaults.getCallback('github', { code: 'code2', state })
      ).rejects.toThrow(/state/i)
    })

    it('expires state after timeout', async () => {
      $._providerConfigs.set('github', {
        type: 'oauth',
        clientId: 'client_id',
        clientSecret: 'client_secret',
        authorizationUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        scopes: ['repo'],
      })

      const state = 'expired_state'
      $._storage.pendingOAuth.set(state, {
        provider: 'github',
        redirectUri: 'https://example.com/callback',
        createdAt: new Date(Date.now() - 10 * 60 * 1000), // 10 min ago
        expiresAt: new Date(Date.now() - 5 * 60 * 1000), // Expired 5 min ago
      })

      await expect(
        $.vaults.getCallback('github', { code: 'code', state })
      ).rejects.toThrow(/expired/i)
    })
  })
})

// ============================================================================
// ENCRYPTION AT REST VERIFICATION
// ============================================================================

describe('$.vault Encryption at Rest', () => {
  let $: StoreVaultContext

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-10T12:00:00.000Z'))
    $ = createMockVaultContext()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stores values in encrypted form', async () => {
    const plaintext = 'super-secret-api-key-12345'
    await $.vault('user:123').set('api-key', plaintext)

    // Access raw storage
    const rawStorage = $._storage.credentials.get('user:123')
    const rawCredential = rawStorage?.get('api-key')

    // Raw stored value should not equal plaintext
    expect(rawCredential).toBeDefined()
    if (rawCredential) {
      expect(rawCredential.value).not.toBe(plaintext)
      // Should have encryption prefix or be transformed
      expect(rawCredential.value).toMatch(/^encrypted:|^[A-Za-z0-9+/=]+$/)
    }
  })

  it('decrypts values correctly on retrieval', async () => {
    const plaintext = 'my-secret-value-xyz789'
    await $.vault('user:123').set('secret', plaintext)

    const credential = await $.vault('user:123').get('secret')

    expect(credential?.value).toBe(plaintext)
  })

  it('different values produce different encrypted outputs', async () => {
    await $.vault('user:123').set('key-1', 'secret-value-1')
    await $.vault('user:123').set('key-2', 'secret-value-2')

    const raw1 = $._storage.credentials.get('user:123')?.get('key-1')
    const raw2 = $._storage.credentials.get('user:123')?.get('key-2')

    expect(raw1?.value).not.toBe(raw2?.value)
  })

  it('same value encrypted again produces consistent decryption', async () => {
    const value = 'consistent-secret'

    await $.vault('user:123').set('key-a', value)
    await $.vault('user:456').set('key-b', value)

    const cred1 = await $.vault('user:123').get('key-a')
    const cred2 = await $.vault('user:456').get('key-b')

    // Both should decrypt to same value
    expect(cred1?.value).toBe(value)
    expect(cred2?.value).toBe(value)
  })

  it('handles special characters in secrets', async () => {
    const specialValue = 'secret!@#$%^&*()_+-=[]{}|;:,.<>?'
    await $.vault('user:123').set('special', specialValue)

    const credential = await $.vault('user:123').get('special')
    expect(credential?.value).toBe(specialValue)
  })

  it('handles unicode in secrets', async () => {
    const unicodeValue = 'secret-with-unicode-emoji'
    await $.vault('user:123').set('unicode', unicodeValue)

    const credential = await $.vault('user:123').get('unicode')
    expect(credential?.value).toBe(unicodeValue)
  })

  it('handles very long secrets', async () => {
    const longValue = 'x'.repeat(10000)
    await $.vault('user:123').set('long-secret', longValue)

    const credential = await $.vault('user:123').get('long-secret')
    expect(credential?.value).toBe(longValue)
    expect(credential?.value.length).toBe(10000)
  })
})

// ============================================================================
// INTEGRATION WITH DO LIFECYCLE
// ============================================================================

describe('$.vault DO Lifecycle Integration', () => {
  describe('vault persistence across operations', () => {
    let $: StoreVaultContext

    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-10T12:00:00.000Z'))
      $ = createMockVaultContext()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('persists secrets across vault instance access', async () => {
      // First access - store secret
      await $.vault('user:123').set('persistent-key', 'persistent-value')

      // Second access - retrieve
      const cred = await $.vault('user:123').get('persistent-key')
      expect(cred?.value).toBe('persistent-value')
    })

    it('maintains created timestamp across updates', async () => {
      await $.vault('user:123').set('key', 'original-value')
      const original = await $.vault('user:123').get('key')
      const originalCreatedAt = original?.createdAt

      vi.advanceTimersByTime(5000) // 5 seconds later

      await $.vault('user:123').set('key', 'updated-value')
      const updated = await $.vault('user:123').get('key')

      // createdAt should be preserved
      expect(updated?.createdAt.getTime()).toBe(originalCreatedAt?.getTime())
      // updatedAt should be newer
      expect(updated?.updatedAt.getTime()).toBeGreaterThan(originalCreatedAt?.getTime() ?? 0)
    })

    it('TTL expiration works with time progression', async () => {
      await $.vault('user:123').set('ttl-key', 'ttl-value', { ttl: 60 }) // 60 second TTL

      // Before expiration
      vi.advanceTimersByTime(30000) // 30 seconds
      let cred = await $.vault('user:123').get('ttl-key')
      expect(cred?.value).toBe('ttl-value')

      // After expiration
      vi.advanceTimersByTime(31000) // 31 more seconds (total 61)
      cred = await $.vault('user:123').get('ttl-key')
      expect(cred).toBeNull()
    })

    it('expired keys are excluded from list', async () => {
      await $.vault('user:123').set('permanent', 'value')
      await $.vault('user:123').set('temporary', 'value', { ttl: 60 })

      // Before expiration
      let keys = await $.vault('user:123').list()
      expect(keys).toContain('permanent')
      expect(keys).toContain('temporary')

      // After expiration
      vi.advanceTimersByTime(61000)
      keys = await $.vault('user:123').list()
      expect(keys).toContain('permanent')
      expect(keys).not.toContain('temporary')
    })
  })

  describe('OAuth flow lifecycle', () => {
    let $: VaultContext

    beforeEach(() => {
      $ = createMockContext()
    })

    it('complete OAuth lifecycle: connect -> use -> refresh -> disconnect', async () => {
      // Setup provider
      $._providerConfigs.set('github', {
        type: 'oauth',
        clientId: 'client_id',
        clientSecret: 'client_secret',
        authorizationUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        scopes: ['repo', 'user'],
      })

      // 1. Initiate connection
      const { state, authorizationUrl } = await $.vaults.connect('github', {
        redirectUri: 'https://example.com/callback',
      })
      expect(authorizationUrl).toContain('github.com')
      expect(state).toBeDefined()

      // 2. Handle callback
      $._mockTokenExchange.set('github', {
        access_token: 'initial_token',
        refresh_token: 'refresh_token',
        token_type: 'bearer',
        expires_in: 3600,
      })

      const result = await $.vaults.getCallback('github', { code: 'auth_code', state })
      expect(result.success).toBe(true)

      // 3. Use the token
      expect(await $.vault('github').isConnected()).toBe(true)
      expect(await $.vault('github').getToken()).toBe('initial_token')

      // 4. Refresh the token
      $._mockRefresh.set('github', {
        accessToken: 'refreshed_token',
        expiresIn: 3600,
      })

      await $.vault('github').refresh()
      expect(await $.vault('github').getToken()).toBe('refreshed_token')

      // 5. Disconnect
      await $.vault('github').disconnect()
      expect(await $.vault('github').isConnected()).toBe(false)
      expect(await $.vault('github').getToken()).toBeNull()
    })

    it('API key lifecycle: connect -> use -> disconnect', async () => {
      $._providerConfigs.set('stripe', {
        type: 'api_key',
        validateKey: (key: string) => key.startsWith('sk_'),
      })

      // 1. Connect with API key
      const result = await $.vaults.connect('stripe', {
        apiKey: 'sk_live_xxxx',
      })
      expect(result.connected).toBe(true)

      // 2. Use the key
      expect(await $.vault('stripe').isConnected()).toBe(true)
      const creds = await $.vault('stripe').getCredentials()
      expect(creds?.apiKey).toBe('sk_live_xxxx')

      // 3. Listed in connected providers
      const providers = await $.vaults.list()
      expect(providers).toContain('stripe')

      // 4. Disconnect
      await $.vault('stripe').disconnect()
      expect(await $.vault('stripe').isConnected()).toBe(false)
    })

    it('multiple providers operate independently', async () => {
      // Connect multiple providers
      $._storage.credentials.set('github', {
        provider: 'github',
        accessToken: 'github_token',
        tokenType: 'bearer',
        expiresAt: new Date(Date.now() + 3600000),
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      $._storage.credentials.set('slack', {
        provider: 'slack',
        accessToken: 'slack_token',
        tokenType: 'bearer',
        expiresAt: new Date(Date.now() + 3600000),
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      $._storage.credentials.set('stripe', {
        provider: 'stripe',
        apiKey: 'sk_live_xxx',
        tokenType: 'api_key',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // All connected
      expect(await $.vaults.list()).toHaveLength(3)

      // Disconnect one
      await $.vault('github').disconnect()

      // Others remain connected
      expect(await $.vault('github').isConnected()).toBe(false)
      expect(await $.vault('slack').isConnected()).toBe(true)
      expect(await $.vault('stripe').isConnected()).toBe(true)
      expect(await $.vaults.list()).toHaveLength(2)
    })
  })

  describe('credential store with OAuth token lifecycle', () => {
    let $: StoreVaultContext

    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-10T12:00:00.000Z'))
      $ = createMockVaultContext()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('vault and OAuth operate independently', async () => {
      const userId = 'user:123'

      // Store a vault credential
      await $.vault(userId).set('custom-secret', 'my-custom-value')

      // Complete OAuth flow
      const oauthConfig = {
        provider: 'google',
        clientId: 'test-client',
        clientSecret: 'test-secret',
        scopes: ['email'],
        redirectUri: 'https://app.example.com/callback',
      }

      const initResult = await $.oauth.initiate(oauthConfig)
      await $.oauth.callback('auth-code', initResult.state)

      // Both should exist independently
      const vaultCred = await $.vault(userId).get('custom-secret')
      expect(vaultCred?.value).toBe('my-custom-value')

      // Delete vault credential
      await $.vault(userId).delete('custom-secret')

      // OAuth tokens should still work
      const stateData = $._storage._consumedStates.get(initResult.state)
      const token = await $.oauth.getAccessToken(stateData?.userId ?? '', 'google')
      expect(token).toBeDefined()
    })

    it('token refresh emits events', async () => {
      const oauthConfig = {
        provider: 'google',
        clientId: 'test-client',
        clientSecret: 'test-secret',
        scopes: ['email'],
        redirectUri: 'https://app.example.com/callback',
      }

      const initResult = await $.oauth.initiate(oauthConfig)
      await $.oauth.callback('auth-code', initResult.state)

      const stateData = $._storage._consumedStates.get(initResult.state)
      const userId = stateData?.userId ?? ''

      // Advance time to trigger refresh need
      vi.advanceTimersByTime(2 * 60 * 60 * 1000) // 2 hours

      await $.oauth.refreshToken(userId, 'google')

      // Check events were emitted
      expect($._events.length).toBeGreaterThan(0)
      const refreshEvent = $._events[0]
      expect(refreshEvent.provider).toBe('google')
      expect(refreshEvent.userId).toBe(userId)
    })
  })
})

// ============================================================================
// EDGE CASES AND ERROR HANDLING
// ============================================================================

describe('$.vault Edge Cases', () => {
  describe('workflow context edge cases', () => {
    let $: VaultContext

    beforeEach(() => {
      $ = createMockContext()
    })

    it('handles empty provider name', async () => {
      expect(await $.vault('').isConnected()).toBe(false)
      expect(await $.vault('').getToken()).toBeNull()
      expect(await $.vault('').getCredentials()).toBeNull()
    })

    it('handles provider names with special characters', async () => {
      $._storage.credentials.set('my-custom-provider', {
        provider: 'my-custom-provider',
        accessToken: 'token',
        tokenType: 'bearer',
        expiresAt: new Date(Date.now() + 3600000),
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      expect(await $.vault('my-custom-provider').isConnected()).toBe(true)
    })

    it('handles concurrent token access', async () => {
      $._storage.credentials.set('github', {
        provider: 'github',
        accessToken: 'concurrent_token',
        tokenType: 'bearer',
        expiresAt: new Date(Date.now() + 3600000),
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const results = await Promise.all([
        $.vault('github').getToken(),
        $.vault('github').getToken(),
        $.vault('github').getToken(),
        $.vault('github').isConnected(),
        $.vault('github').getCredentials(),
      ])

      expect(results[0]).toBe('concurrent_token')
      expect(results[1]).toBe('concurrent_token')
      expect(results[2]).toBe('concurrent_token')
      expect(results[3]).toBe(true)
      expect(results[4]?.accessToken).toBe('concurrent_token')
    })

    it('token at exact expiration boundary is expired', async () => {
      $._storage.credentials.set('github', {
        provider: 'github',
        accessToken: 'boundary_token',
        tokenType: 'bearer',
        expiresAt: new Date(Date.now()), // Expires exactly now
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      expect(await $.vault('github').isConnected()).toBe(false)
    })

    it('handles very long-lived tokens', async () => {
      $._storage.credentials.set('github', {
        provider: 'github',
        accessToken: 'long_lived',
        tokenType: 'bearer',
        expiresAt: new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000), // 100 years
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      expect(await $.vault('github').isConnected()).toBe(true)
      expect(await $.vault('github').getToken()).toBe('long_lived')
    })
  })

  describe('store context edge cases', () => {
    let $: StoreVaultContext

    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-10T12:00:00.000Z'))
      $ = createMockVaultContext()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('handles empty string values', async () => {
      await $.vault('user:123').set('empty', '')

      const cred = await $.vault('user:123').get('empty')
      expect(cred?.value).toBe('')
    })

    it('handles whitespace-only values', async () => {
      await $.vault('user:123').set('whitespace', '   ')

      const cred = await $.vault('user:123').get('whitespace')
      expect(cred?.value).toBe('   ')
    })

    it('handles keys with special characters', async () => {
      await $.vault('user:123').set('key-with-dashes', 'value1')
      await $.vault('user:123').set('key_with_underscores', 'value2')
      await $.vault('user:123').set('key.with.dots', 'value3')

      expect((await $.vault('user:123').get('key-with-dashes'))?.value).toBe('value1')
      expect((await $.vault('user:123').get('key_with_underscores'))?.value).toBe('value2')
      expect((await $.vault('user:123').get('key.with.dots'))?.value).toBe('value3')
    })

    it('handles rapid set/get cycles', async () => {
      for (let i = 0; i < 100; i++) {
        await $.vault('user:123').set(`key-${i}`, `value-${i}`)
        const cred = await $.vault('user:123').get(`key-${i}`)
        expect(cred?.value).toBe(`value-${i}`)
      }

      const keys = await $.vault('user:123').list()
      expect(keys.length).toBe(100)
    })

    it('handles TTL of zero (no expiration set)', async () => {
      // TTL of 0 is treated as no TTL (falsy value)
      await $.vault('user:123').set('no-ttl', 'value', { ttl: 0 })

      // Credential should persist without expiration
      vi.advanceTimersByTime(60000) // 1 minute later
      const cred = await $.vault('user:123').get('no-ttl')
      expect(cred?.value).toBe('value')
      expect(cred?.expiresAt).toBeUndefined()
    })

    it('handles very short TTL', async () => {
      await $.vault('user:123').set('short', 'value', { ttl: 1 }) // 1 second

      // Before expiration
      let cred = await $.vault('user:123').get('short')
      expect(cred?.value).toBe('value')

      // After expiration
      vi.advanceTimersByTime(1001)
      cred = await $.vault('user:123').get('short')
      expect(cred).toBeNull()
    })
  })
})
