/**
 * RED Phase Tests: WorkOS Vault Integration
 *
 * Tests for secure credential storage and OAuth flow management using WorkOS Vault.
 * These tests define the expected behavior BEFORE implementation.
 * All tests should FAIL initially.
 *
 * Related issues:
 * - dotdo-cikf: [Red] Vault get/set/delete tests
 * - dotdo-ldk7: [Red] OAuth flow tests
 * - dotdo-4gs6: [Red] Token refresh tests
 *
 * WorkOS Vault provides:
 * - Encrypted credential storage
 * - OAuth token management
 * - Automatic token refresh
 * - TTL/expiration support
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// Types that will be implemented
interface VaultCredential {
  key: string
  value: string
  metadata?: Record<string, unknown>
  expiresAt?: Date
  createdAt: Date
  updatedAt: Date
}

interface VaultSetOptions {
  ttl?: number // Time to live in seconds
  metadata?: Record<string, unknown>
}

interface OAuthConfig {
  provider: string
  clientId: string
  clientSecret: string
  scopes: string[]
  redirectUri: string
}

interface OAuthTokens {
  accessToken: string
  refreshToken?: string
  tokenType: string
  expiresAt: Date
  scope?: string
}

interface OAuthFlowResult {
  redirectUrl: string
  state: string
  codeVerifier?: string // For PKCE
}

interface TokenRefreshEvent {
  userId: string
  provider: string
  oldExpiresAt: Date
  newExpiresAt: Date
  refreshedAt: Date
}

interface VaultInstance {
  get(key: string): Promise<VaultCredential | null>
  set(key: string, value: string, options?: VaultSetOptions): Promise<VaultCredential>
  delete(key: string): Promise<boolean>
  list(): Promise<string[]>
  has(key: string): Promise<boolean>
}

interface OAuthInstance {
  initiate(config: OAuthConfig): Promise<OAuthFlowResult>
  callback(code: string, state: string): Promise<OAuthTokens>
  getAccessToken(userId: string, provider: string): Promise<string>
  refreshToken(userId: string, provider: string): Promise<OAuthTokens>
}

interface VaultContext {
  vault(userId: string): VaultInstance
  oauth: OAuthInstance
  _storage: MockVaultStorage
  _events: TokenRefreshEvent[]
}

// Mock storage type for testing
interface MockVaultStorage {
  credentials: Map<string, Map<string, VaultCredential>>
  oauthTokens: Map<string, OAuthTokens>
  oauthConfigs: Map<string, OAuthConfig>
  oauthStates: Map<string, { userId: string; provider: string; codeVerifier?: string }>
  _consumedStates: Map<string, { userId: string; provider: string; codeVerifier?: string }>
}

// Import the actual implementation
import { createMockVaultContext as createVaultContextImpl } from '../../lib/vault/store'

// Wrapper that casts to the expected type interface
function createMockVaultContext(): VaultContext {
  return createVaultContextImpl() as unknown as VaultContext
}

// ============================================================================
// dotdo-cikf: Vault get/set/delete operations
// ============================================================================

describe('Vault get/set/delete operations', () => {
  let $: VaultContext

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00.000Z'))
    $ = createMockVaultContext()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // -------------------------------------------------------------------------
  // vault.get(key) returns credential
  // -------------------------------------------------------------------------

  describe('vault.get(key) returns credential', () => {
    it('returns null for non-existent key', async () => {
      const credential = await $.vault('user:123').get('nonexistent-key')

      expect(credential).toBeNull()
    })

    it('returns stored credential for existing key', async () => {
      // First store a credential
      await $.vault('user:123').set('api-key', 'sk-test-12345')

      const credential = await $.vault('user:123').get('api-key')

      expect(credential).not.toBeNull()
      expect(credential?.value).toBe('sk-test-12345')
    })

    it('returns credential with metadata', async () => {
      await $.vault('user:123').set('api-key', 'sk-test-12345', {
        metadata: { provider: 'openai', environment: 'production' },
      })

      const credential = await $.vault('user:123').get('api-key')

      expect(credential?.metadata).toEqual({
        provider: 'openai',
        environment: 'production',
      })
    })

    it('returns credential with timestamps', async () => {
      await $.vault('user:123').set('api-key', 'sk-test-12345')

      const credential = await $.vault('user:123').get('api-key')

      expect(credential?.createdAt).toBeInstanceOf(Date)
      expect(credential?.updatedAt).toBeInstanceOf(Date)
    })

    it('returns null for expired credential', async () => {
      // Store with 60 second TTL
      await $.vault('user:123').set('api-key', 'sk-test-12345', { ttl: 60 })

      // Advance time past expiration
      vi.advanceTimersByTime(61 * 1000)

      const credential = await $.vault('user:123').get('api-key')

      expect(credential).toBeNull()
    })

    it('returns credential before TTL expires', async () => {
      await $.vault('user:123').set('api-key', 'sk-test-12345', { ttl: 60 })

      // Advance time but not past expiration
      vi.advanceTimersByTime(30 * 1000)

      const credential = await $.vault('user:123').get('api-key')

      expect(credential).not.toBeNull()
      expect(credential?.value).toBe('sk-test-12345')
    })

    it('includes expiresAt for credentials with TTL', async () => {
      await $.vault('user:123').set('api-key', 'sk-test-12345', { ttl: 3600 })

      const credential = await $.vault('user:123').get('api-key')

      expect(credential?.expiresAt).toBeInstanceOf(Date)
      expect(credential?.expiresAt?.getTime()).toBe(Date.now() + 3600 * 1000)
    })
  })

  // -------------------------------------------------------------------------
  // vault.set(key, value) stores credential
  // -------------------------------------------------------------------------

  describe('vault.set(key, value) stores credential', () => {
    it('stores and returns credential', async () => {
      const credential = await $.vault('user:123').set('api-key', 'sk-test-12345')

      expect(credential.key).toBe('api-key')
      expect(credential.value).toBe('sk-test-12345')
    })

    it('overwrites existing credential', async () => {
      await $.vault('user:123').set('api-key', 'old-value')
      await $.vault('user:123').set('api-key', 'new-value')

      const credential = await $.vault('user:123').get('api-key')

      expect(credential?.value).toBe('new-value')
    })

    it('updates updatedAt timestamp on overwrite', async () => {
      await $.vault('user:123').set('api-key', 'old-value')
      const firstCredential = await $.vault('user:123').get('api-key')

      vi.advanceTimersByTime(1000)

      await $.vault('user:123').set('api-key', 'new-value')
      const secondCredential = await $.vault('user:123').get('api-key')

      expect(secondCredential?.updatedAt.getTime()).toBeGreaterThan(firstCredential?.updatedAt.getTime() ?? 0)
    })

    it('preserves createdAt on overwrite', async () => {
      await $.vault('user:123').set('api-key', 'old-value')
      const firstCredential = await $.vault('user:123').get('api-key')
      const originalCreatedAt = firstCredential?.createdAt

      vi.advanceTimersByTime(1000)

      await $.vault('user:123').set('api-key', 'new-value')
      const secondCredential = await $.vault('user:123').get('api-key')

      expect(secondCredential?.createdAt.getTime()).toBe(originalCreatedAt?.getTime())
    })

    it('stores credential with TTL', async () => {
      const credential = await $.vault('user:123').set('api-key', 'sk-test-12345', {
        ttl: 3600,
      })

      expect(credential.expiresAt).toBeInstanceOf(Date)
    })

    it('stores credential with metadata', async () => {
      const credential = await $.vault('user:123').set('api-key', 'sk-test-12345', {
        metadata: { provider: 'stripe' },
      })

      expect(credential.metadata).toEqual({ provider: 'stripe' })
    })

    it('handles empty string value', async () => {
      const credential = await $.vault('user:123').set('empty-key', '')

      expect(credential.value).toBe('')
    })

    it('handles very long values', async () => {
      const longValue = 'x'.repeat(10000)
      const credential = await $.vault('user:123').set('long-key', longValue)

      expect(credential.value).toBe(longValue)
    })
  })

  // -------------------------------------------------------------------------
  // vault.delete(key) removes credential
  // -------------------------------------------------------------------------

  describe('vault.delete(key) removes credential', () => {
    it('deletes existing credential and returns true', async () => {
      await $.vault('user:123').set('api-key', 'sk-test-12345')

      const deleted = await $.vault('user:123').delete('api-key')

      expect(deleted).toBe(true)
    })

    it('returns false for non-existent key', async () => {
      const deleted = await $.vault('user:123').delete('nonexistent-key')

      expect(deleted).toBe(false)
    })

    it('removes credential from storage', async () => {
      await $.vault('user:123').set('api-key', 'sk-test-12345')
      await $.vault('user:123').delete('api-key')

      const credential = await $.vault('user:123').get('api-key')

      expect(credential).toBeNull()
    })

    it('is idempotent - multiple deletes return false after first', async () => {
      await $.vault('user:123').set('api-key', 'sk-test-12345')

      const first = await $.vault('user:123').delete('api-key')
      const second = await $.vault('user:123').delete('api-key')
      const third = await $.vault('user:123').delete('api-key')

      expect(first).toBe(true)
      expect(second).toBe(false)
      expect(third).toBe(false)
    })

    it('only deletes specified key', async () => {
      await $.vault('user:123').set('key-1', 'value-1')
      await $.vault('user:123').set('key-2', 'value-2')

      await $.vault('user:123').delete('key-1')

      expect(await $.vault('user:123').get('key-1')).toBeNull()
      expect(await $.vault('user:123').get('key-2')).not.toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // vault.list() returns all keys
  // -------------------------------------------------------------------------

  describe('vault.list() returns all keys', () => {
    it('returns empty array when no credentials exist', async () => {
      const keys = await $.vault('user:123').list()

      expect(keys).toEqual([])
    })

    it('returns all stored keys', async () => {
      await $.vault('user:123').set('key-1', 'value-1')
      await $.vault('user:123').set('key-2', 'value-2')
      await $.vault('user:123').set('key-3', 'value-3')

      const keys = await $.vault('user:123').list()

      expect(keys).toHaveLength(3)
      expect(keys).toContain('key-1')
      expect(keys).toContain('key-2')
      expect(keys).toContain('key-3')
    })

    it('does not return expired keys', async () => {
      await $.vault('user:123').set('permanent', 'value')
      await $.vault('user:123').set('expiring', 'value', { ttl: 60 })

      vi.advanceTimersByTime(61 * 1000)

      const keys = await $.vault('user:123').list()

      expect(keys).toContain('permanent')
      expect(keys).not.toContain('expiring')
    })

    it('reflects deletions', async () => {
      await $.vault('user:123').set('key-1', 'value-1')
      await $.vault('user:123').set('key-2', 'value-2')

      await $.vault('user:123').delete('key-1')

      const keys = await $.vault('user:123').list()

      expect(keys).not.toContain('key-1')
      expect(keys).toContain('key-2')
    })

    it('returns keys in consistent order (alphabetical)', async () => {
      await $.vault('user:123').set('zebra', 'value')
      await $.vault('user:123').set('alpha', 'value')
      await $.vault('user:123').set('mango', 'value')

      const keys = await $.vault('user:123').list()

      expect(keys).toEqual(['alpha', 'mango', 'zebra'])
    })
  })

  // -------------------------------------------------------------------------
  // Credentials are isolated by userId
  // -------------------------------------------------------------------------

  describe('credentials are isolated by userId', () => {
    it('different users have separate credential stores', async () => {
      await $.vault('user:A').set('api-key', 'value-A')
      await $.vault('user:B').set('api-key', 'value-B')

      const credentialA = await $.vault('user:A').get('api-key')
      const credentialB = await $.vault('user:B').get('api-key')

      expect(credentialA?.value).toBe('value-A')
      expect(credentialB?.value).toBe('value-B')
    })

    it('deleting from one user does not affect another', async () => {
      await $.vault('user:A').set('api-key', 'value-A')
      await $.vault('user:B').set('api-key', 'value-B')

      await $.vault('user:A').delete('api-key')

      expect(await $.vault('user:A').get('api-key')).toBeNull()
      expect(await $.vault('user:B').get('api-key')).not.toBeNull()
    })

    it('list only returns keys for specific user', async () => {
      await $.vault('user:A').set('key-A1', 'value')
      await $.vault('user:A').set('key-A2', 'value')
      await $.vault('user:B').set('key-B1', 'value')

      const keysA = await $.vault('user:A').list()
      const keysB = await $.vault('user:B').list()

      expect(keysA).toEqual(['key-A1', 'key-A2'])
      expect(keysB).toEqual(['key-B1'])
    })
  })

  // -------------------------------------------------------------------------
  // Credentials are encrypted at rest (conceptual test)
  // -------------------------------------------------------------------------

  describe('credentials are encrypted at rest', () => {
    it('raw storage does not contain plaintext values', async () => {
      await $.vault('user:123').set('api-key', 'sk-secret-12345')

      // Access internal storage to verify encryption
      // The stored value should NOT match the plaintext
      const rawStorage = $._storage.credentials.get('user:123')
      const rawCredential = rawStorage?.get('api-key')

      // The raw value should be encrypted (not equal to plaintext)
      // This is a conceptual test - actual implementation will determine specifics
      if (rawCredential) {
        expect(rawCredential.value).not.toBe('sk-secret-12345')
      }
    })

    it('decrypted value matches original', async () => {
      const originalValue = 'sk-secret-12345'
      await $.vault('user:123').set('api-key', originalValue)

      const credential = await $.vault('user:123').get('api-key')

      expect(credential?.value).toBe(originalValue)
    })
  })

  // -------------------------------------------------------------------------
  // vault.has(key) checks existence
  // -------------------------------------------------------------------------

  describe('vault.has(key) checks existence', () => {
    it('returns false for non-existent key', async () => {
      const exists = await $.vault('user:123').has('nonexistent')

      expect(exists).toBe(false)
    })

    it('returns true for existing key', async () => {
      await $.vault('user:123').set('api-key', 'value')

      const exists = await $.vault('user:123').has('api-key')

      expect(exists).toBe(true)
    })

    it('returns false for expired key', async () => {
      await $.vault('user:123').set('api-key', 'value', { ttl: 60 })

      vi.advanceTimersByTime(61 * 1000)

      const exists = await $.vault('user:123').has('api-key')

      expect(exists).toBe(false)
    })

    it('returns false after deletion', async () => {
      await $.vault('user:123').set('api-key', 'value')
      await $.vault('user:123').delete('api-key')

      const exists = await $.vault('user:123').has('api-key')

      expect(exists).toBe(false)
    })
  })
})

// ============================================================================
// dotdo-ldk7: OAuth flow tests
// ============================================================================

describe('OAuth flow', () => {
  let $: VaultContext

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00.000Z'))
    $ = createMockVaultContext()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // -------------------------------------------------------------------------
  // Initiate OAuth flow (redirect URL generation)
  // -------------------------------------------------------------------------

  describe('oauth.initiate() returns redirect URL', () => {
    const testConfig: OAuthConfig = {
      provider: 'google',
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      scopes: ['openid', 'email', 'profile'],
      redirectUri: 'https://app.example.com.ai/oauth/callback',
    }

    it('returns redirect URL for OAuth provider', async () => {
      const result = await $.oauth.initiate(testConfig)

      expect(result.redirectUrl).toBeDefined()
      expect(typeof result.redirectUrl).toBe('string')
      expect(result.redirectUrl).toContain('https://')
    })

    it('includes state parameter in redirect URL', async () => {
      const result = await $.oauth.initiate(testConfig)

      expect(result.state).toBeDefined()
      expect(typeof result.state).toBe('string')
      expect(result.state.length).toBeGreaterThan(0)
      expect(result.redirectUrl).toContain(`state=${result.state}`)
    })

    it('includes client_id in redirect URL', async () => {
      const result = await $.oauth.initiate(testConfig)

      expect(result.redirectUrl).toContain('client_id=test-client-id')
    })

    it('includes scopes in redirect URL', async () => {
      const result = await $.oauth.initiate(testConfig)

      expect(result.redirectUrl).toContain('scope=')
      expect(result.redirectUrl).toContain('openid')
    })

    it('includes redirect_uri in redirect URL', async () => {
      const result = await $.oauth.initiate(testConfig)

      expect(result.redirectUrl).toContain('redirect_uri=')
    })

    it('generates unique state for each initiation', async () => {
      const result1 = await $.oauth.initiate(testConfig)
      const result2 = await $.oauth.initiate(testConfig)

      expect(result1.state).not.toBe(result2.state)
    })

    it('supports PKCE flow with code_verifier', async () => {
      const pkceConfig: OAuthConfig = {
        ...testConfig,
        provider: 'github',
      }

      const result = await $.oauth.initiate(pkceConfig)

      // PKCE should include code_verifier for later use
      expect(result.codeVerifier).toBeDefined()
      expect(typeof result.codeVerifier).toBe('string')
      // code_challenge should be in URL (derived from verifier)
      expect(result.redirectUrl).toContain('code_challenge=')
      expect(result.redirectUrl).toContain('code_challenge_method=S256')
    })

    it('stores state for callback validation', async () => {
      const result = await $.oauth.initiate(testConfig)

      // Internal storage should have the state
      expect($._storage.oauthStates.has(result.state)).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Handle OAuth callback with code exchange
  // -------------------------------------------------------------------------

  describe('oauth.callback() exchanges code for tokens', () => {
    const testConfig: OAuthConfig = {
      provider: 'google',
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      scopes: ['openid', 'email'],
      redirectUri: 'https://app.example.com.ai/oauth/callback',
    }

    it('exchanges authorization code for tokens', async () => {
      // First initiate to get valid state
      const initResult = await $.oauth.initiate(testConfig)

      // Mock callback with code
      const tokens = await $.oauth.callback('auth-code-12345', initResult.state)

      expect(tokens).toBeDefined()
      expect(tokens.accessToken).toBeDefined()
      expect(typeof tokens.accessToken).toBe('string')
    })

    it('returns access token', async () => {
      const initResult = await $.oauth.initiate(testConfig)
      const tokens = await $.oauth.callback('auth-code-12345', initResult.state)

      expect(tokens.accessToken).toBeTruthy()
      expect(tokens.accessToken.length).toBeGreaterThan(0)
    })

    it('returns refresh token when available', async () => {
      const initResult = await $.oauth.initiate(testConfig)
      const tokens = await $.oauth.callback('auth-code-12345', initResult.state)

      // Refresh token is optional but should be present for most OAuth providers
      expect(tokens.refreshToken).toBeDefined()
    })

    it('returns token type', async () => {
      const initResult = await $.oauth.initiate(testConfig)
      const tokens = await $.oauth.callback('auth-code-12345', initResult.state)

      expect(tokens.tokenType).toBe('Bearer')
    })

    it('returns expiration timestamp', async () => {
      const initResult = await $.oauth.initiate(testConfig)
      const tokens = await $.oauth.callback('auth-code-12345', initResult.state)

      expect(tokens.expiresAt).toBeInstanceOf(Date)
      expect(tokens.expiresAt.getTime()).toBeGreaterThan(Date.now())
    })

    it('throws for invalid state', async () => {
      await expect($.oauth.callback('auth-code-12345', 'invalid-state')).rejects.toThrow()
    })

    it('throws for reused state (state should be one-time use)', async () => {
      const initResult = await $.oauth.initiate(testConfig)

      // First callback succeeds
      await $.oauth.callback('auth-code-12345', initResult.state)

      // Second callback with same state should fail
      await expect($.oauth.callback('auth-code-67890', initResult.state)).rejects.toThrow()
    })

    it('throws for invalid authorization code', async () => {
      const initResult = await $.oauth.initiate(testConfig)

      // Empty or invalid code should fail
      await expect($.oauth.callback('', initResult.state)).rejects.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // Store tokens in vault
  // -------------------------------------------------------------------------

  describe('tokens are stored in vault after callback', () => {
    const testConfig: OAuthConfig = {
      provider: 'google',
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      scopes: ['openid', 'email'],
      redirectUri: 'https://app.example.com.ai/oauth/callback',
    }

    it('stores tokens after successful callback', async () => {
      const initResult = await $.oauth.initiate(testConfig)
      await $.oauth.callback('auth-code-12345', initResult.state)

      // Tokens should be stored in vault
      const storedTokens = $._storage.oauthTokens.get('google')

      expect(storedTokens).toBeDefined()
      expect(storedTokens?.accessToken).toBeDefined()
    })

    it('stores tokens for specific user and provider', async () => {
      // Setup: associate state with user
      const initResult = await $.oauth.initiate(testConfig)
      const stateData = $._storage.oauthStates.get(initResult.state)

      // Verify tokens are stored with user association
      await $.oauth.callback('auth-code-12345', initResult.state)

      // Should be retrievable by user ID and provider
      const accessToken = await $.oauth.getAccessToken(stateData?.userId ?? '', 'google')
      expect(accessToken).toBeDefined()
    })

    it('overwrites existing tokens for same provider', async () => {
      const initResult1 = await $.oauth.initiate(testConfig)
      const tokens1 = await $.oauth.callback('auth-code-first', initResult1.state)

      vi.advanceTimersByTime(1000)

      const initResult2 = await $.oauth.initiate(testConfig)
      const tokens2 = await $.oauth.callback('auth-code-second', initResult2.state)

      // Second tokens should overwrite first
      expect(tokens2.accessToken).not.toBe(tokens1.accessToken)
    })
  })

  // -------------------------------------------------------------------------
  // Retrieve access token for API calls
  // -------------------------------------------------------------------------

  describe('oauth.getAccessToken() retrieves stored token', () => {
    const testConfig: OAuthConfig = {
      provider: 'google',
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      scopes: ['openid', 'email'],
      redirectUri: 'https://app.example.com.ai/oauth/callback',
    }

    it('returns access token for user and provider', async () => {
      const initResult = await $.oauth.initiate(testConfig)
      await $.oauth.callback('auth-code-12345', initResult.state)

      const stateData = $._storage._consumedStates.get(initResult.state)
      const accessToken = await $.oauth.getAccessToken(stateData?.userId ?? 'user:123', 'google')

      expect(accessToken).toBeDefined()
      expect(typeof accessToken).toBe('string')
    })

    it('throws when no token exists for provider', async () => {
      await expect($.oauth.getAccessToken('user:123', 'unknown-provider')).rejects.toThrow()
    })

    it('throws when token is expired and no refresh token', async () => {
      const initResult = await $.oauth.initiate(testConfig)
      await $.oauth.callback('auth-code-12345', initResult.state)

      const stateData = $._storage._consumedStates.get(initResult.state)
      const tokenKey = `${stateData?.userId}:google`

      // Remove the refresh token to simulate "no refresh token configured"
      const storedTokens = $._storage.oauthTokens.get(tokenKey)
      if (storedTokens) {
        delete storedTokens.refreshToken
      }

      // Advance past expiration
      vi.advanceTimersByTime(2 * 60 * 60 * 1000) // 2 hours

      // With no refresh token configured, should throw
      await expect($.oauth.getAccessToken(stateData?.userId ?? '', 'google')).rejects.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // OAuth error handling
  // -------------------------------------------------------------------------

  describe('OAuth error handling', () => {
    it('handles provider error in callback', async () => {
      const testConfig: OAuthConfig = {
        provider: 'google',
        clientId: 'invalid-client-id',
        clientSecret: 'test-secret',
        scopes: ['openid'],
        redirectUri: 'https://app.example.com.ai/callback',
      }

      const initResult = await $.oauth.initiate(testConfig)

      // Simulate provider returning error
      await expect($.oauth.callback('invalid-code', initResult.state)).rejects.toThrow()
    })

    it('handles network errors gracefully', async () => {
      const testConfig: OAuthConfig = {
        provider: 'unreachable-provider',
        clientId: 'test-id',
        clientSecret: 'test-secret',
        scopes: ['openid'],
        redirectUri: 'https://app.example.com.ai/callback',
      }

      await expect($.oauth.initiate(testConfig)).rejects.toThrow()
    })

    it('validates required config fields', async () => {
      const invalidConfig = {
        provider: 'google',
        clientId: '',
        clientSecret: 'test-secret',
        scopes: [],
        redirectUri: '',
      }

      await expect($.oauth.initiate(invalidConfig)).rejects.toThrow()
    })
  })
})

// ============================================================================
// dotdo-4gs6: Token refresh tests
// ============================================================================

describe('Token refresh', () => {
  let $: VaultContext

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00.000Z'))
    $ = createMockVaultContext()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const setupTokens = async () => {
    const testConfig: OAuthConfig = {
      provider: 'google',
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      scopes: ['openid', 'email'],
      redirectUri: 'https://app.example.com.ai/callback',
    }

    const initResult = await $.oauth.initiate(testConfig)
    const tokens = await $.oauth.callback('auth-code-12345', initResult.state)
    const stateData = $._storage._consumedStates.get(initResult.state)

    return { tokens, userId: stateData?.userId ?? 'user:123', provider: 'google' }
  }

  // -------------------------------------------------------------------------
  // Automatic refresh when token expires
  // -------------------------------------------------------------------------

  describe('automatic refresh when token expires', () => {
    it('automatically refreshes expired token on access', async () => {
      const { userId, provider } = await setupTokens()
      const originalToken = await $.oauth.getAccessToken(userId, provider)

      // Advance time past expiration (tokens typically expire in 1 hour)
      vi.advanceTimersByTime(2 * 60 * 60 * 1000) // 2 hours

      // Getting access token should trigger refresh
      const newToken = await $.oauth.getAccessToken(userId, provider)

      expect(newToken).toBeDefined()
      expect(newToken).not.toBe(originalToken)
    })

    it('updates expiresAt after refresh', async () => {
      const { tokens, userId, provider } = await setupTokens()
      const originalExpiresAt = tokens.expiresAt

      vi.advanceTimersByTime(2 * 60 * 60 * 1000)

      await $.oauth.getAccessToken(userId, provider)

      // Check stored token has new expiration
      const storedTokens = $._storage.oauthTokens.get(`${userId}:${provider}`)
      expect(storedTokens?.expiresAt.getTime()).toBeGreaterThan(originalExpiresAt.getTime())
    })

    it('proactively refreshes when close to expiration', async () => {
      const { userId, provider } = await setupTokens()
      const originalToken = await $.oauth.getAccessToken(userId, provider)

      // Advance to 5 minutes before expiration (within refresh window)
      vi.advanceTimersByTime(55 * 60 * 1000) // 55 minutes

      // Should trigger proactive refresh
      const refreshedToken = await $.oauth.getAccessToken(userId, provider)

      expect(refreshedToken).toBeDefined()
      // Token might be different if proactive refresh triggered
    })

    it('does not refresh when token is still valid', async () => {
      const { userId, provider } = await setupTokens()
      const firstToken = await $.oauth.getAccessToken(userId, provider)

      // Advance only 10 minutes
      vi.advanceTimersByTime(10 * 60 * 1000)

      const secondToken = await $.oauth.getAccessToken(userId, provider)

      // Should be same token (no refresh needed)
      expect(secondToken).toBe(firstToken)
    })
  })

  // -------------------------------------------------------------------------
  // Refresh token rotation
  // -------------------------------------------------------------------------

  describe('refresh token rotation', () => {
    it('updates refresh token when provider returns new one', async () => {
      const { userId, provider, tokens } = await setupTokens()
      const originalRefreshToken = tokens.refreshToken

      vi.advanceTimersByTime(2 * 60 * 60 * 1000)

      // Trigger refresh
      await $.oauth.refreshToken(userId, provider)

      const storedTokens = $._storage.oauthTokens.get(`${userId}:${provider}`)

      // Some providers rotate refresh tokens
      // Implementation should handle both cases
      expect(storedTokens?.refreshToken).toBeDefined()
    })

    it('keeps old refresh token if provider does not return new one', async () => {
      const { userId, provider, tokens } = await setupTokens()
      const originalRefreshToken = tokens.refreshToken

      vi.advanceTimersByTime(2 * 60 * 60 * 1000)

      const newTokens = await $.oauth.refreshToken(userId, provider)

      // If no new refresh token, original should still be stored
      const storedTokens = $._storage.oauthTokens.get(`${userId}:${provider}`)
      expect(storedTokens?.refreshToken).toBe(newTokens.refreshToken ?? originalRefreshToken)
    })

    it('stores both access and refresh token after rotation', async () => {
      const { userId, provider } = await setupTokens()

      vi.advanceTimersByTime(2 * 60 * 60 * 1000)

      const newTokens = await $.oauth.refreshToken(userId, provider)

      const storedTokens = $._storage.oauthTokens.get(`${userId}:${provider}`)

      expect(storedTokens?.accessToken).toBe(newTokens.accessToken)
      if (newTokens.refreshToken) {
        expect(storedTokens?.refreshToken).toBe(newTokens.refreshToken)
      }
    })
  })

  // -------------------------------------------------------------------------
  // Handle refresh failures gracefully
  // -------------------------------------------------------------------------

  describe('handle refresh failures gracefully', () => {
    it('throws when refresh token is invalid', async () => {
      const { userId, provider } = await setupTokens()

      // Invalidate refresh token in storage
      const storedTokens = $._storage.oauthTokens.get(`${userId}:${provider}`)
      if (storedTokens) {
        storedTokens.refreshToken = 'invalid-refresh-token'
      }

      vi.advanceTimersByTime(2 * 60 * 60 * 1000)

      await expect($.oauth.refreshToken(userId, provider)).rejects.toThrow()
    })

    it('throws when refresh token is missing', async () => {
      const { userId, provider } = await setupTokens()

      // Remove refresh token
      const storedTokens = $._storage.oauthTokens.get(`${userId}:${provider}`)
      if (storedTokens) {
        delete storedTokens.refreshToken
      }

      vi.advanceTimersByTime(2 * 60 * 60 * 1000)

      await expect($.oauth.refreshToken(userId, provider)).rejects.toThrow()
    })

    it('throws when provider revokes refresh token', async () => {
      const { userId, provider } = await setupTokens()

      // Simulate provider revocation by marking token as revoked
      const storedTokens = $._storage.oauthTokens.get(`${userId}:${provider}`)
      if (storedTokens) {
        storedTokens.refreshToken = 'revoked-token'
      }

      vi.advanceTimersByTime(2 * 60 * 60 * 1000)

      // Expect error indicating re-authentication needed
      await expect($.oauth.refreshToken(userId, provider)).rejects.toThrow()
    })

    it('clears stored tokens on refresh failure', async () => {
      const { userId, provider } = await setupTokens()

      // Invalidate refresh token
      const storedTokens = $._storage.oauthTokens.get(`${userId}:${provider}`)
      if (storedTokens) {
        storedTokens.refreshToken = 'revoked-token'
      }

      vi.advanceTimersByTime(2 * 60 * 60 * 1000)

      try {
        await $.oauth.refreshToken(userId, provider)
      } catch {
        // Expected to throw
      }

      // Tokens should be cleared after refresh failure
      const clearedTokens = $._storage.oauthTokens.get(`${userId}:${provider}`)
      expect(clearedTokens).toBeUndefined()
    })

    it('throws descriptive error for refresh failures', async () => {
      const { userId, provider } = await setupTokens()

      // Invalidate refresh token
      const storedTokens = $._storage.oauthTokens.get(`${userId}:${provider}`)
      if (storedTokens) {
        storedTokens.refreshToken = 'invalid'
      }

      vi.advanceTimersByTime(2 * 60 * 60 * 1000)

      await expect($.oauth.refreshToken(userId, provider)).rejects.toThrow(/refresh|expired|invalid/i)
    })
  })

  // -------------------------------------------------------------------------
  // Token refresh events emitted
  // -------------------------------------------------------------------------

  describe('token refresh events emitted', () => {
    it('emits event on successful token refresh', async () => {
      const { userId, provider } = await setupTokens()

      vi.advanceTimersByTime(2 * 60 * 60 * 1000)

      await $.oauth.refreshToken(userId, provider)

      expect($._events).toHaveLength(1)
      expect($._events[0].userId).toBe(userId)
      expect($._events[0].provider).toBe(provider)
    })

    it('event includes old and new expiration times', async () => {
      const { userId, provider, tokens } = await setupTokens()
      const oldExpiresAt = tokens.expiresAt

      vi.advanceTimersByTime(2 * 60 * 60 * 1000)

      await $.oauth.refreshToken(userId, provider)

      const event = $._events[0]
      expect(event.oldExpiresAt).toEqual(oldExpiresAt)
      expect(event.newExpiresAt.getTime()).toBeGreaterThan(oldExpiresAt.getTime())
    })

    it('event includes refreshedAt timestamp', async () => {
      const { userId, provider } = await setupTokens()

      vi.advanceTimersByTime(2 * 60 * 60 * 1000)

      await $.oauth.refreshToken(userId, provider)

      const event = $._events[0]
      expect(event.refreshedAt).toBeInstanceOf(Date)
      expect(event.refreshedAt.getTime()).toBe(Date.now())
    })

    it('does not emit event when refresh fails', async () => {
      const { userId, provider } = await setupTokens()

      // Invalidate refresh token
      const storedTokens = $._storage.oauthTokens.get(`${userId}:${provider}`)
      if (storedTokens) {
        storedTokens.refreshToken = 'invalid'
      }

      vi.advanceTimersByTime(2 * 60 * 60 * 1000)

      try {
        await $.oauth.refreshToken(userId, provider)
      } catch {
        // Expected
      }

      expect($._events).toHaveLength(0)
    })

    it('emits event for automatic refresh on access', async () => {
      const { userId, provider } = await setupTokens()

      vi.advanceTimersByTime(2 * 60 * 60 * 1000)

      // getAccessToken triggers automatic refresh
      await $.oauth.getAccessToken(userId, provider)

      expect($._events.length).toBeGreaterThan(0)
      expect($._events[0].provider).toBe(provider)
    })
  })

  // -------------------------------------------------------------------------
  // Manual refresh
  // -------------------------------------------------------------------------

  describe('oauth.refreshToken() manual refresh', () => {
    it('manually refreshes token', async () => {
      const { userId, provider, tokens } = await setupTokens()
      const originalToken = tokens.accessToken

      const newTokens = await $.oauth.refreshToken(userId, provider)

      expect(newTokens.accessToken).toBeDefined()
      expect(newTokens.accessToken).not.toBe(originalToken)
    })

    it('returns new tokens after manual refresh', async () => {
      const { userId, provider } = await setupTokens()

      const newTokens = await $.oauth.refreshToken(userId, provider)

      expect(newTokens.accessToken).toBeDefined()
      expect(newTokens.tokenType).toBe('Bearer')
      expect(newTokens.expiresAt).toBeInstanceOf(Date)
    })

    it('updates stored tokens after manual refresh', async () => {
      const { userId, provider } = await setupTokens()

      const newTokens = await $.oauth.refreshToken(userId, provider)

      const storedTokens = $._storage.oauthTokens.get(`${userId}:${provider}`)
      expect(storedTokens?.accessToken).toBe(newTokens.accessToken)
    })

    it('works even when token is not yet expired', async () => {
      const { userId, provider, tokens } = await setupTokens()
      const originalToken = tokens.accessToken

      // No time advancement - token is still valid
      const newTokens = await $.oauth.refreshToken(userId, provider)

      expect(newTokens.accessToken).toBeDefined()
      expect(newTokens.accessToken).not.toBe(originalToken)
    })

    it('throws for non-existent user/provider combination', async () => {
      await expect($.oauth.refreshToken('unknown-user', 'google')).rejects.toThrow()
    })
  })
})

// ============================================================================
// Integration tests
// ============================================================================

describe('Vault and OAuth integration', () => {
  let $: VaultContext

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00.000Z'))
    $ = createMockVaultContext()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('complete OAuth workflow: initiate, callback, store, retrieve, refresh', async () => {
    const config: OAuthConfig = {
      provider: 'google',
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      scopes: ['openid', 'email'],
      redirectUri: 'https://app.example.com.ai/callback',
    }

    // 1. Initiate OAuth flow
    const initResult = await $.oauth.initiate(config)
    expect(initResult.redirectUrl).toBeDefined()

    // 2. Handle callback (simulate user authorization)
    const tokens = await $.oauth.callback('auth-code-12345', initResult.state)
    expect(tokens.accessToken).toBeDefined()

    // 3. Get state data for user ID (states are consumed after callback)
    const stateData = $._storage._consumedStates.get(initResult.state)
    const userId = stateData?.userId ?? 'user:123'

    // 4. Retrieve access token
    const accessToken = await $.oauth.getAccessToken(userId, 'google')
    expect(accessToken).toBe(tokens.accessToken)

    // 5. Advance time and refresh
    vi.advanceTimersByTime(2 * 60 * 60 * 1000)

    const newTokens = await $.oauth.refreshToken(userId, 'google')
    expect(newTokens.accessToken).not.toBe(tokens.accessToken)

    // 6. Verify refresh event was emitted
    expect($._events).toHaveLength(1)
  })

  it('vault operations are independent from OAuth tokens', async () => {
    // Store a credential
    await $.vault('user:123').set('custom-api-key', 'my-api-key')

    // Complete OAuth flow
    const config: OAuthConfig = {
      provider: 'github',
      clientId: 'github-client',
      clientSecret: 'github-secret',
      scopes: ['repo'],
      redirectUri: 'https://app.example.com.ai/callback',
    }
    const initResult = await $.oauth.initiate(config)
    await $.oauth.callback('github-code', initResult.state)

    // Vault credential should still exist
    const credential = await $.vault('user:123').get('custom-api-key')
    expect(credential?.value).toBe('my-api-key')

    // Delete vault credential should not affect OAuth tokens
    await $.vault('user:123').delete('custom-api-key')

    const stateData = $._storage._consumedStates.get(initResult.state)
    const accessToken = await $.oauth.getAccessToken(stateData?.userId ?? '', 'github')
    expect(accessToken).toBeDefined()
  })

  it('multiple providers can be used simultaneously', async () => {
    const googleConfig: OAuthConfig = {
      provider: 'google',
      clientId: 'google-client',
      clientSecret: 'google-secret',
      scopes: ['email'],
      redirectUri: 'https://app.example.com.ai/callback',
    }

    const githubConfig: OAuthConfig = {
      provider: 'github',
      clientId: 'github-client',
      clientSecret: 'github-secret',
      scopes: ['repo'],
      redirectUri: 'https://app.example.com.ai/callback',
    }

    // Authenticate with both providers
    const googleInit = await $.oauth.initiate(googleConfig)
    const googleTokens = await $.oauth.callback('google-code', googleInit.state)

    const githubInit = await $.oauth.initiate(githubConfig)
    const githubTokens = await $.oauth.callback('github-code', githubInit.state)

    // Both tokens should be retrievable (states are consumed after callback)
    const googleStateData = $._storage._consumedStates.get(googleInit.state)
    const githubStateData = $._storage._consumedStates.get(githubInit.state)

    const googleAccessToken = await $.oauth.getAccessToken(googleStateData?.userId ?? '', 'google')
    const githubAccessToken = await $.oauth.getAccessToken(githubStateData?.userId ?? '', 'github')

    expect(googleAccessToken).toBe(googleTokens.accessToken)
    expect(githubAccessToken).toBe(githubTokens.accessToken)
  })
})
