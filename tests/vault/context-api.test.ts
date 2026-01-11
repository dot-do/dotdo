/**
 * RED Phase Tests for $.vault() Workflow Context API
 *
 * These tests verify the $.vault() context API that integrates
 * credential/secret management into the workflow context ($).
 *
 * Related issues:
 * - dotdo-mhye: [Red] $.vault() context API tests
 *
 * The API integrates with the existing $ proxy pattern:
 * - $.vault(provider) returns a VaultContextInstance for per-provider operations
 * - $.vaults provides collection-level operations (list, connect, getCallback)
 *
 * Vault API enables:
 * - Secure storage and retrieval of OAuth tokens
 * - API key management for third-party services
 * - OAuth flow initiation and callback handling
 * - Provider connection status checking
 * - Token refresh management
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createMockContext,
  type VaultCredentials,
  type VaultContextInstance,
  type VaultsCollection,
  type ProviderConfig,
  type OAuthConfig,
  type ApiKeyConfig,
} from '../../workflows/context/vault'

// ============================================================================
// $.vault(provider).getToken() - Get access token for provider
// ============================================================================

describe('$.vault(provider).getToken() returns access token', () => {
  it('returns null when provider is not connected', async () => {
    const $ = createMockContext()

    const token = await $.vault('github').getToken()

    expect(token).toBeNull()
  })

  it('returns access token when provider is connected', async () => {
    const $ = createMockContext()

    // Setup: connect a provider
    $._storage.credentials.set('github', {
      provider: 'github',
      accessToken: 'gho_xxxxxxxxxxxx',
      tokenType: 'bearer',
      scope: 'repo,user',
      expiresAt: new Date(Date.now() + 3600000), // 1 hour from now
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const token = await $.vault('github').getToken()

    expect(token).toBe('gho_xxxxxxxxxxxx')
    expect(typeof token).toBe('string')
  })

  it('returns null when token is expired', async () => {
    const $ = createMockContext()

    // Setup: connect a provider with expired token
    $._storage.credentials.set('github', {
      provider: 'github',
      accessToken: 'gho_expired_token',
      tokenType: 'bearer',
      scope: 'repo,user',
      expiresAt: new Date(Date.now() - 3600000), // Expired 1 hour ago
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const token = await $.vault('github').getToken()

    expect(token).toBeNull()
  })

  it('returns token for different providers independently', async () => {
    const $ = createMockContext()

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
      accessToken: 'xoxb-slack-token',
      tokenType: 'bearer',
      expiresAt: new Date(Date.now() + 3600000),
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    expect(await $.vault('github').getToken()).toBe('github_token')
    expect(await $.vault('slack').getToken()).toBe('xoxb-slack-token')
    expect(await $.vault('stripe').getToken()).toBeNull()
  })
})

// ============================================================================
// $.vault(provider).getCredentials() - Get full credentials object
// ============================================================================

describe('$.vault(provider).getCredentials() returns full credentials', () => {
  it('returns null when provider is not connected', async () => {
    const $ = createMockContext()

    const creds = await $.vault('github').getCredentials()

    expect(creds).toBeNull()
  })

  it('returns full credentials object when connected', async () => {
    const $ = createMockContext()

    const now = new Date()
    $._storage.credentials.set('github', {
      provider: 'github',
      accessToken: 'gho_xxxxxxxxxxxx',
      refreshToken: 'ghr_xxxxxxxxxxxx',
      tokenType: 'bearer',
      scope: 'repo,user,read:org',
      expiresAt: new Date(now.getTime() + 3600000),
      createdAt: now,
      updatedAt: now,
      metadata: {
        login: 'octocat',
        id: 12345,
        avatarUrl: 'https://github.com/images/octocat.png',
      },
    })

    const creds = await $.vault('github').getCredentials()

    expect(creds).not.toBeNull()
    expect(creds?.provider).toBe('github')
    expect(creds?.accessToken).toBe('gho_xxxxxxxxxxxx')
    expect(creds?.refreshToken).toBe('ghr_xxxxxxxxxxxx')
    expect(creds?.tokenType).toBe('bearer')
    expect(creds?.scope).toBe('repo,user,read:org')
    expect(creds?.expiresAt).toBeInstanceOf(Date)
    expect(creds?.metadata?.login).toBe('octocat')
  })

  it('returns a snapshot (mutations do not affect storage)', async () => {
    const $ = createMockContext()

    $._storage.credentials.set('github', {
      provider: 'github',
      accessToken: 'original_token',
      tokenType: 'bearer',
      expiresAt: new Date(Date.now() + 3600000),
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const creds = await $.vault('github').getCredentials()
    if (creds) {
      creds.accessToken = 'mutated_token'
    }

    // Original storage should be unchanged
    const refetched = await $.vault('github').getCredentials()
    expect(refetched?.accessToken).toBe('original_token')
  })

  it('includes API key for non-OAuth providers', async () => {
    const $ = createMockContext()

    $._storage.credentials.set('stripe', {
      provider: 'stripe',
      apiKey: 'sk_live_xxxxxxxxxxxx',
      tokenType: 'api_key',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const creds = await $.vault('stripe').getCredentials()

    expect(creds).not.toBeNull()
    expect(creds?.apiKey).toBe('sk_live_xxxxxxxxxxxx')
    expect(creds?.tokenType).toBe('api_key')
  })
})

// ============================================================================
// $.vault(provider).isConnected() - Check if provider is connected
// ============================================================================

describe('$.vault(provider).isConnected() returns boolean', () => {
  it('returns false when provider is not connected', async () => {
    const $ = createMockContext()

    const connected = await $.vault('github').isConnected()

    expect(connected).toBe(false)
    expect(typeof connected).toBe('boolean')
  })

  it('returns true when provider is connected with valid token', async () => {
    const $ = createMockContext()

    $._storage.credentials.set('github', {
      provider: 'github',
      accessToken: 'gho_xxxxxxxxxxxx',
      tokenType: 'bearer',
      expiresAt: new Date(Date.now() + 3600000),
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const connected = await $.vault('github').isConnected()

    expect(connected).toBe(true)
  })

  it('returns false when token is expired', async () => {
    const $ = createMockContext()

    $._storage.credentials.set('github', {
      provider: 'github',
      accessToken: 'gho_expired_token',
      tokenType: 'bearer',
      expiresAt: new Date(Date.now() - 3600000), // Expired
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const connected = await $.vault('github').isConnected()

    expect(connected).toBe(false)
  })

  it('returns true for API key providers (no expiration)', async () => {
    const $ = createMockContext()

    $._storage.credentials.set('stripe', {
      provider: 'stripe',
      apiKey: 'sk_live_xxxxxxxxxxxx',
      tokenType: 'api_key',
      createdAt: new Date(),
      updatedAt: new Date(),
      // No expiresAt - API keys don't expire
    })

    const connected = await $.vault('stripe').isConnected()

    expect(connected).toBe(true)
  })

  it('returns false when provider was disconnected', async () => {
    const $ = createMockContext()

    $._storage.credentials.set('github', {
      provider: 'github',
      accessToken: 'gho_xxxxxxxxxxxx',
      tokenType: 'bearer',
      expiresAt: new Date(Date.now() + 3600000),
      createdAt: new Date(),
      updatedAt: new Date(),
      status: 'disconnected', // Explicitly disconnected
    })

    const connected = await $.vault('github').isConnected()

    expect(connected).toBe(false)
  })
})

// ============================================================================
// $.vault(provider).disconnect() - Remove provider connection
// ============================================================================

describe('$.vault(provider).disconnect() removes connection', () => {
  it('removes the provider credentials', async () => {
    const $ = createMockContext()

    $._storage.credentials.set('github', {
      provider: 'github',
      accessToken: 'gho_xxxxxxxxxxxx',
      tokenType: 'bearer',
      expiresAt: new Date(Date.now() + 3600000),
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    // Verify connected
    expect(await $.vault('github').isConnected()).toBe(true)

    await $.vault('github').disconnect()

    // Verify disconnected
    expect(await $.vault('github').isConnected()).toBe(false)
    expect(await $.vault('github').getToken()).toBeNull()
  })

  it('is idempotent - calling multiple times has same effect', async () => {
    const $ = createMockContext()

    $._storage.credentials.set('github', {
      provider: 'github',
      accessToken: 'gho_xxxxxxxxxxxx',
      tokenType: 'bearer',
      expiresAt: new Date(Date.now() + 3600000),
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await $.vault('github').disconnect()
    await $.vault('github').disconnect()
    await $.vault('github').disconnect()

    // Should not throw and should remain disconnected
    expect(await $.vault('github').isConnected()).toBe(false)
  })

  it('does not throw for non-existent provider', async () => {
    const $ = createMockContext()

    // Should not throw
    await expect($.vault('nonexistent').disconnect()).resolves.toBeUndefined()
  })

  it('only disconnects the specified provider', async () => {
    const $ = createMockContext()

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

    await $.vault('github').disconnect()

    expect(await $.vault('github').isConnected()).toBe(false)
    expect(await $.vault('slack').isConnected()).toBe(true)
  })
})

// ============================================================================
// $.vault(provider).refresh() - Force token refresh
// ============================================================================

describe('$.vault(provider).refresh() refreshes token', () => {
  it('throws when provider is not connected', async () => {
    const $ = createMockContext()

    await expect($.vault('github').refresh()).rejects.toThrow()
  })

  it('throws when no refresh token is available', async () => {
    const $ = createMockContext()

    $._storage.credentials.set('github', {
      provider: 'github',
      accessToken: 'gho_xxxxxxxxxxxx',
      tokenType: 'bearer',
      // No refreshToken
      expiresAt: new Date(Date.now() + 3600000),
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await expect($.vault('github').refresh()).rejects.toThrow()
  })

  it('updates the access token when refresh succeeds', async () => {
    const $ = createMockContext()

    $._storage.credentials.set('github', {
      provider: 'github',
      accessToken: 'old_access_token',
      refreshToken: 'ghr_xxxxxxxxxxxx',
      tokenType: 'bearer',
      expiresAt: new Date(Date.now() - 1000), // Expired
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    // Mock the refresh to simulate OAuth token refresh
    $._mockRefresh.set('github', {
      accessToken: 'new_access_token',
      expiresIn: 3600,
    })

    await $.vault('github').refresh()

    const creds = await $.vault('github').getCredentials()
    expect(creds?.accessToken).toBe('new_access_token')
    expect(creds?.updatedAt.getTime()).toBeGreaterThan(Date.now() - 1000)
  })

  it('preserves refresh token after refresh', async () => {
    const $ = createMockContext()

    $._storage.credentials.set('github', {
      provider: 'github',
      accessToken: 'old_access_token',
      refreshToken: 'ghr_xxxxxxxxxxxx',
      tokenType: 'bearer',
      expiresAt: new Date(Date.now() - 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    $._mockRefresh.set('github', {
      accessToken: 'new_access_token',
      expiresIn: 3600,
    })

    await $.vault('github').refresh()

    const creds = await $.vault('github').getCredentials()
    expect(creds?.refreshToken).toBe('ghr_xxxxxxxxxxxx')
  })

  it('updates the expiration time', async () => {
    const $ = createMockContext()

    const oldExpiry = new Date(Date.now() - 1000)
    $._storage.credentials.set('github', {
      provider: 'github',
      accessToken: 'old_access_token',
      refreshToken: 'ghr_xxxxxxxxxxxx',
      tokenType: 'bearer',
      expiresAt: oldExpiry,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    $._mockRefresh.set('github', {
      accessToken: 'new_access_token',
      expiresIn: 7200, // 2 hours
    })

    await $.vault('github').refresh()

    const creds = await $.vault('github').getCredentials()
    expect(creds?.expiresAt?.getTime()).toBeGreaterThan(Date.now())
  })

  it('throws when API key provider (non-refreshable)', async () => {
    const $ = createMockContext()

    $._storage.credentials.set('stripe', {
      provider: 'stripe',
      apiKey: 'sk_live_xxxxxxxxxxxx',
      tokenType: 'api_key',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await expect($.vault('stripe').refresh()).rejects.toThrow()
  })
})

// ============================================================================
// $.vaults.list() - List connected providers
// ============================================================================

describe('$.vaults.list() returns connected providers', () => {
  it('returns empty array when no providers connected', async () => {
    const $ = createMockContext()

    const providers = await $.vaults.list()

    expect(providers).toEqual([])
    expect(Array.isArray(providers)).toBe(true)
  })

  it('returns list of connected provider names', async () => {
    const $ = createMockContext()

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

    const providers = await $.vaults.list()

    expect(providers).toContain('github')
    expect(providers).toContain('slack')
    expect(providers.length).toBe(2)
  })

  it('excludes expired OAuth providers', async () => {
    const $ = createMockContext()

    $._storage.credentials.set('github', {
      provider: 'github',
      accessToken: 'github_token',
      tokenType: 'bearer',
      expiresAt: new Date(Date.now() - 3600000), // Expired
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    $._storage.credentials.set('slack', {
      provider: 'slack',
      accessToken: 'slack_token',
      tokenType: 'bearer',
      expiresAt: new Date(Date.now() + 3600000), // Valid
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const providers = await $.vaults.list()

    expect(providers).not.toContain('github')
    expect(providers).toContain('slack')
  })

  it('includes API key providers (no expiration check)', async () => {
    const $ = createMockContext()

    $._storage.credentials.set('stripe', {
      provider: 'stripe',
      apiKey: 'sk_live_xxxxxxxxxxxx',
      tokenType: 'api_key',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const providers = await $.vaults.list()

    expect(providers).toContain('stripe')
  })

  it('excludes disconnected providers', async () => {
    const $ = createMockContext()

    $._storage.credentials.set('github', {
      provider: 'github',
      accessToken: 'github_token',
      tokenType: 'bearer',
      expiresAt: new Date(Date.now() + 3600000),
      status: 'disconnected',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const providers = await $.vaults.list()

    expect(providers).not.toContain('github')
  })
})

// ============================================================================
// $.vaults.connect(provider, config) - Initiate OAuth flow
// ============================================================================

describe('$.vaults.connect() initiates OAuth connection', () => {
  it('returns OAuth authorization URL for OAuth providers', async () => {
    const $ = createMockContext()

    // Configure GitHub OAuth
    $._providerConfigs.set('github', {
      type: 'oauth',
      clientId: 'client_id_xxx',
      clientSecret: 'client_secret_xxx',
      authorizationUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      scopes: ['repo', 'user'],
    })

    const result = await $.vaults.connect('github', {
      redirectUri: 'https://example.com.ai/callback/github',
    })

    expect(result.authorizationUrl).toBeDefined()
    expect(result.authorizationUrl).toContain('github.com/login/oauth/authorize')
    expect(result.authorizationUrl).toContain('client_id=client_id_xxx')
    expect(result.state).toBeDefined()
    expect(typeof result.state).toBe('string')
  })

  it('throws for unconfigured provider', async () => {
    const $ = createMockContext()

    await expect(
      $.vaults.connect('unconfigured', {
        redirectUri: 'https://example.com.ai/callback',
      })
    ).rejects.toThrow()
  })

  it('includes requested scopes in authorization URL', async () => {
    const $ = createMockContext()

    $._providerConfigs.set('github', {
      type: 'oauth',
      clientId: 'client_id_xxx',
      clientSecret: 'client_secret_xxx',
      authorizationUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      scopes: ['repo', 'user'],
    })

    const result = await $.vaults.connect('github', {
      redirectUri: 'https://example.com.ai/callback/github',
      scopes: ['repo', 'user', 'read:org'],
    })

    expect(result.authorizationUrl).toContain('scope=')
    expect(result.authorizationUrl).toContain('repo')
    expect(result.authorizationUrl).toContain('user')
    expect(result.authorizationUrl).toContain('read:org')
  })

  it('stores state for CSRF protection', async () => {
    const $ = createMockContext()

    $._providerConfigs.set('github', {
      type: 'oauth',
      clientId: 'client_id_xxx',
      clientSecret: 'client_secret_xxx',
      authorizationUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      scopes: ['repo'],
    })

    const result = await $.vaults.connect('github', {
      redirectUri: 'https://example.com.ai/callback/github',
    })

    // Verify state is stored for validation
    expect($._storage.pendingOAuth.has(result.state)).toBe(true)
    const pending = $._storage.pendingOAuth.get(result.state)
    expect(pending?.provider).toBe('github')
    expect(pending?.redirectUri).toBe('https://example.com.ai/callback/github')
  })

  it('stores API key directly for API key providers', async () => {
    const $ = createMockContext()

    $._providerConfigs.set('stripe', {
      type: 'api_key',
    })

    const result = await $.vaults.connect('stripe', {
      apiKey: 'sk_live_xxxxxxxxxxxx',
    })

    expect(result.connected).toBe(true)
    expect(await $.vault('stripe').isConnected()).toBe(true)
    expect(await $.vault('stripe').getCredentials()).toMatchObject({
      provider: 'stripe',
      apiKey: 'sk_live_xxxxxxxxxxxx',
      tokenType: 'api_key',
    })
  })

  it('validates API key format for Stripe', async () => {
    const $ = createMockContext()

    $._providerConfigs.set('stripe', {
      type: 'api_key',
      validateKey: (key: string) => key.startsWith('sk_'),
    })

    await expect(
      $.vaults.connect('stripe', {
        apiKey: 'invalid_key_format',
      })
    ).rejects.toThrow()
  })
})

// ============================================================================
// $.vaults.getCallback(provider) - Handle OAuth callback
// ============================================================================

describe('$.vaults.getCallback() handles OAuth callback', () => {
  it('exchanges code for token and stores credentials', async () => {
    const $ = createMockContext()

    $._providerConfigs.set('github', {
      type: 'oauth',
      clientId: 'client_id_xxx',
      clientSecret: 'client_secret_xxx',
      authorizationUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      scopes: ['repo'],
    })

    // Setup pending OAuth state
    const state = 'random_state_123'
    $._storage.pendingOAuth.set(state, {
      provider: 'github',
      redirectUri: 'https://example.com.ai/callback/github',
      createdAt: new Date(),
    })

    // Mock token exchange response
    $._mockTokenExchange.set('github', {
      access_token: 'gho_new_token',
      token_type: 'bearer',
      scope: 'repo',
      expires_in: 3600,
    })

    const result = await $.vaults.getCallback('github', {
      code: 'oauth_code_xxx',
      state,
    })

    expect(result.success).toBe(true)
    expect(await $.vault('github').isConnected()).toBe(true)
    expect(await $.vault('github').getToken()).toBe('gho_new_token')
  })

  it('throws for invalid state (CSRF protection)', async () => {
    const $ = createMockContext()

    $._providerConfigs.set('github', {
      type: 'oauth',
      clientId: 'client_id_xxx',
      clientSecret: 'client_secret_xxx',
      authorizationUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      scopes: ['repo'],
    })

    await expect(
      $.vaults.getCallback('github', {
        code: 'oauth_code_xxx',
        state: 'invalid_state',
      })
    ).rejects.toThrow(/state/i)
  })

  it('throws for expired state', async () => {
    const $ = createMockContext()

    $._providerConfigs.set('github', {
      type: 'oauth',
      clientId: 'client_id_xxx',
      clientSecret: 'client_secret_xxx',
      authorizationUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      scopes: ['repo'],
    })

    // Setup expired pending OAuth state (10 minutes ago)
    const state = 'expired_state_123'
    $._storage.pendingOAuth.set(state, {
      provider: 'github',
      redirectUri: 'https://example.com.ai/callback/github',
      createdAt: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes ago
      expiresAt: new Date(Date.now() - 5 * 60 * 1000), // Expired 5 minutes ago
    })

    await expect(
      $.vaults.getCallback('github', {
        code: 'oauth_code_xxx',
        state,
      })
    ).rejects.toThrow(/expired/i)
  })

  it('cleans up pending state after successful callback', async () => {
    const $ = createMockContext()

    $._providerConfigs.set('github', {
      type: 'oauth',
      clientId: 'client_id_xxx',
      clientSecret: 'client_secret_xxx',
      authorizationUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      scopes: ['repo'],
    })

    const state = 'cleanup_state_123'
    $._storage.pendingOAuth.set(state, {
      provider: 'github',
      redirectUri: 'https://example.com.ai/callback/github',
      createdAt: new Date(),
    })

    $._mockTokenExchange.set('github', {
      access_token: 'gho_new_token',
      token_type: 'bearer',
      scope: 'repo',
    })

    await $.vaults.getCallback('github', {
      code: 'oauth_code_xxx',
      state,
    })

    expect($._storage.pendingOAuth.has(state)).toBe(false)
  })

  it('stores refresh token when provided', async () => {
    const $ = createMockContext()

    $._providerConfigs.set('github', {
      type: 'oauth',
      clientId: 'client_id_xxx',
      clientSecret: 'client_secret_xxx',
      authorizationUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      scopes: ['repo'],
    })

    const state = 'refresh_state_123'
    $._storage.pendingOAuth.set(state, {
      provider: 'github',
      redirectUri: 'https://example.com.ai/callback/github',
      createdAt: new Date(),
    })

    $._mockTokenExchange.set('github', {
      access_token: 'gho_access_token',
      refresh_token: 'ghr_refresh_token',
      token_type: 'bearer',
      scope: 'repo',
      expires_in: 3600,
    })

    await $.vaults.getCallback('github', {
      code: 'oauth_code_xxx',
      state,
    })

    const creds = await $.vault('github').getCredentials()
    expect(creds?.refreshToken).toBe('ghr_refresh_token')
  })

  it('throws when OAuth error is returned', async () => {
    const $ = createMockContext()

    $._providerConfigs.set('github', {
      type: 'oauth',
      clientId: 'client_id_xxx',
      clientSecret: 'client_secret_xxx',
      authorizationUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      scopes: ['repo'],
    })

    const state = 'error_state_123'
    $._storage.pendingOAuth.set(state, {
      provider: 'github',
      redirectUri: 'https://example.com.ai/callback/github',
      createdAt: new Date(),
    })

    await expect(
      $.vaults.getCallback('github', {
        error: 'access_denied',
        error_description: 'The user denied access',
        state,
      })
    ).rejects.toThrow(/access_denied|denied/i)
  })
})

// ============================================================================
// Provider Configurations - GitHub, Slack, Google, Stripe
// ============================================================================

describe('Provider configurations', () => {
  describe('GitHub OAuth provider', () => {
    it('supports GitHub OAuth flow', async () => {
      const $ = createMockContext()

      $._providerConfigs.set('github', {
        type: 'oauth',
        clientId: 'github_client_id',
        clientSecret: 'github_client_secret',
        authorizationUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        scopes: ['repo', 'user', 'read:org'],
        userInfoUrl: 'https://api.github.com/user',
      })

      const result = await $.vaults.connect('github', {
        redirectUri: 'https://example.com.ai/callback/github',
      })

      expect(result.authorizationUrl).toContain('github.com')
    })

    it('stores GitHub-specific metadata', async () => {
      const $ = createMockContext()

      $._storage.credentials.set('github', {
        provider: 'github',
        accessToken: 'gho_xxxxxxxxxxxx',
        tokenType: 'bearer',
        scope: 'repo,user,read:org',
        expiresAt: new Date(Date.now() + 3600000),
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {
          login: 'octocat',
          id: 12345,
          type: 'User',
          avatarUrl: 'https://avatars.githubusercontent.com/u/12345',
          name: 'The Octocat',
          email: 'octocat@github.com',
          organizations: ['org1', 'org2'],
        },
      })

      const creds = await $.vault('github').getCredentials()
      expect(creds?.metadata?.login).toBe('octocat')
      expect(creds?.metadata?.organizations).toContain('org1')
    })
  })

  describe('Slack OAuth provider', () => {
    it('supports Slack OAuth flow', async () => {
      const $ = createMockContext()

      $._providerConfigs.set('slack', {
        type: 'oauth',
        clientId: 'slack_client_id',
        clientSecret: 'slack_client_secret',
        authorizationUrl: 'https://slack.com/oauth/v2/authorize',
        tokenUrl: 'https://slack.com/api/oauth.v2.access',
        scopes: ['channels:read', 'chat:write', 'users:read'],
      })

      const result = await $.vaults.connect('slack', {
        redirectUri: 'https://example.com.ai/callback/slack',
      })

      expect(result.authorizationUrl).toContain('slack.com')
    })

    it('stores Slack-specific metadata', async () => {
      const $ = createMockContext()

      $._storage.credentials.set('slack', {
        provider: 'slack',
        accessToken: 'xoxb-xxxx-xxxx-xxxx',
        tokenType: 'bearer',
        scope: 'channels:read,chat:write',
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {
          teamId: 'T12345678',
          teamName: 'My Workspace',
          botUserId: 'U12345678',
          appId: 'A12345678',
        },
      })

      const creds = await $.vault('slack').getCredentials()
      expect(creds?.metadata?.teamId).toBe('T12345678')
      expect(creds?.metadata?.teamName).toBe('My Workspace')
    })
  })

  describe('Google OAuth provider', () => {
    it('supports Google OAuth flow', async () => {
      const $ = createMockContext()

      $._providerConfigs.set('google', {
        type: 'oauth',
        clientId: 'google_client_id.apps.googleusercontent.com',
        clientSecret: 'google_client_secret',
        authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        scopes: ['openid', 'email', 'profile'],
        additionalParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      })

      const result = await $.vaults.connect('google', {
        redirectUri: 'https://example.com.ai/callback/google',
      })

      expect(result.authorizationUrl).toContain('accounts.google.com')
      expect(result.authorizationUrl).toContain('access_type=offline')
    })

    it('stores Google-specific metadata', async () => {
      const $ = createMockContext()

      $._storage.credentials.set('google', {
        provider: 'google',
        accessToken: 'ya29.xxxxxxxxxxxx',
        refreshToken: '1//xxxxxxxxxxxx',
        tokenType: 'bearer',
        scope: 'openid email profile',
        expiresAt: new Date(Date.now() + 3600000),
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {
          sub: '123456789012345678901',
          email: 'user@gmail.com',
          emailVerified: true,
          name: 'John Doe',
          picture: 'https://lh3.googleusercontent.com/a-/xxxxx',
        },
      })

      const creds = await $.vault('google').getCredentials()
      expect(creds?.metadata?.email).toBe('user@gmail.com')
      expect(creds?.refreshToken).toBe('1//xxxxxxxxxxxx')
    })
  })

  describe('Stripe API key provider', () => {
    it('supports Stripe API key storage', async () => {
      const $ = createMockContext()

      $._providerConfigs.set('stripe', {
        type: 'api_key',
        validateKey: (key: string) => key.startsWith('sk_'),
      })

      const result = await $.vaults.connect('stripe', {
        apiKey: 'sk_live_xxxxxxxxxxxx',
      })

      expect(result.connected).toBe(true)
      expect(await $.vault('stripe').isConnected()).toBe(true)
    })

    it('supports test vs live mode detection', async () => {
      const $ = createMockContext()

      $._providerConfigs.set('stripe', {
        type: 'api_key',
        validateKey: (key: string) => key.startsWith('sk_'),
        extractMetadata: (key: string) => ({
          mode: key.startsWith('sk_live_') ? 'live' : 'test',
        }),
      })

      await $.vaults.connect('stripe', {
        apiKey: 'sk_test_xxxxxxxxxxxx',
      })

      const creds = await $.vault('stripe').getCredentials()
      expect(creds?.metadata?.mode).toBe('test')
    })
  })

  describe('Custom OAuth provider', () => {
    it('supports custom OAuth provider configuration', async () => {
      const $ = createMockContext()

      $._providerConfigs.set('custom', {
        type: 'oauth',
        clientId: 'custom_client_id',
        clientSecret: 'custom_client_secret',
        authorizationUrl: 'https://custom-provider.com/oauth/authorize',
        tokenUrl: 'https://custom-provider.com/oauth/token',
        scopes: ['read', 'write'],
        userInfoUrl: 'https://custom-provider.com/api/me',
      })

      const result = await $.vaults.connect('custom', {
        redirectUri: 'https://example.com.ai/callback/custom',
      })

      expect(result.authorizationUrl).toContain('custom-provider.com')
      expect(result.state).toBeDefined()
    })

    it('handles custom token response format', async () => {
      const $ = createMockContext()

      $._providerConfigs.set('custom', {
        type: 'oauth',
        clientId: 'custom_client_id',
        clientSecret: 'custom_client_secret',
        authorizationUrl: 'https://custom-provider.com/oauth/authorize',
        tokenUrl: 'https://custom-provider.com/oauth/token',
        scopes: ['read'],
        parseTokenResponse: (response: Record<string, unknown>) => ({
          accessToken: response.token as string,
          tokenType: 'Bearer',
          expiresIn: response.expires as number,
        }),
      })

      const state = 'custom_state_123'
      $._storage.pendingOAuth.set(state, {
        provider: 'custom',
        redirectUri: 'https://example.com.ai/callback/custom',
        createdAt: new Date(),
      })

      $._mockTokenExchange.set('custom', {
        token: 'custom_access_token',
        expires: 7200,
      })

      await $.vaults.getCallback('custom', {
        code: 'custom_code',
        state,
      })

      const creds = await $.vault('custom').getCredentials()
      expect(creds?.accessToken).toBe('custom_access_token')
    })
  })
})

// ============================================================================
// Integration tests
// ============================================================================

describe('$.vault and $.vaults integration', () => {
  it('complete OAuth flow: connect, callback, use, refresh, disconnect', async () => {
    const $ = createMockContext()

    // 1. Configure provider
    $._providerConfigs.set('github', {
      type: 'oauth',
      clientId: 'client_id',
      clientSecret: 'client_secret',
      authorizationUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      scopes: ['repo'],
    })

    // 2. Initiate connection
    const { authorizationUrl, state } = await $.vaults.connect('github', {
      redirectUri: 'https://example.com.ai/callback/github',
    })
    expect(authorizationUrl).toContain('github.com')

    // 3. Mock token exchange
    $._mockTokenExchange.set('github', {
      access_token: 'initial_token',
      refresh_token: 'refresh_token',
      token_type: 'bearer',
      expires_in: 3600,
    })

    // 4. Handle callback
    const callbackResult = await $.vaults.getCallback('github', {
      code: 'auth_code',
      state,
    })
    expect(callbackResult.success).toBe(true)

    // 5. Verify connected
    expect(await $.vault('github').isConnected()).toBe(true)
    expect(await $.vault('github').getToken()).toBe('initial_token')

    // 6. Mock refresh
    $._mockRefresh.set('github', {
      accessToken: 'refreshed_token',
      expiresIn: 3600,
    })

    // 7. Refresh token
    await $.vault('github').refresh()
    expect(await $.vault('github').getToken()).toBe('refreshed_token')

    // 8. Disconnect
    await $.vault('github').disconnect()
    expect(await $.vault('github').isConnected()).toBe(false)
    expect(await $.vaults.list()).not.toContain('github')
  })

  it('API key flow: connect, use, disconnect', async () => {
    const $ = createMockContext()

    // 1. Configure provider
    $._providerConfigs.set('stripe', {
      type: 'api_key',
    })

    // 2. Connect with API key
    await $.vaults.connect('stripe', {
      apiKey: 'sk_live_xxxxxxxxxxxx',
    })

    // 3. Verify connected
    expect(await $.vault('stripe').isConnected()).toBe(true)
    const creds = await $.vault('stripe').getCredentials()
    expect(creds?.apiKey).toBe('sk_live_xxxxxxxxxxxx')

    // 4. List includes stripe
    expect(await $.vaults.list()).toContain('stripe')

    // 5. Disconnect
    await $.vault('stripe').disconnect()
    expect(await $.vault('stripe').isConnected()).toBe(false)
  })

  it('multiple providers can be connected simultaneously', async () => {
    const $ = createMockContext()

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
      apiKey: 'sk_live_xxxxxxxxxxxx',
      tokenType: 'api_key',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    // Verify all connected
    const connected = await $.vaults.list()
    expect(connected).toContain('github')
    expect(connected).toContain('slack')
    expect(connected).toContain('stripe')
    expect(connected.length).toBe(3)

    // Disconnect one doesn't affect others
    await $.vault('github').disconnect()
    expect(await $.vault('github').isConnected()).toBe(false)
    expect(await $.vault('slack').isConnected()).toBe(true)
    expect(await $.vault('stripe').isConnected()).toBe(true)
  })
})

// ============================================================================
// Edge cases and error handling
// ============================================================================

describe('Edge cases and error handling', () => {
  it('handles empty provider name', async () => {
    const $ = createMockContext()

    expect(await $.vault('').isConnected()).toBe(false)
    expect(await $.vault('').getToken()).toBeNull()
  })

  it('handles special characters in provider name', async () => {
    const $ = createMockContext()

    // Provider names should be alphanumeric with possible underscores
    expect(await $.vault('my-custom-provider').isConnected()).toBe(false)
    expect(await $.vault('provider_with_underscore').isConnected()).toBe(false)
  })

  it('handles concurrent token access', async () => {
    const $ = createMockContext()

    $._storage.credentials.set('github', {
      provider: 'github',
      accessToken: 'concurrent_token',
      tokenType: 'bearer',
      expiresAt: new Date(Date.now() + 3600000),
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    // Concurrent access should return same token
    const [token1, token2, token3] = await Promise.all([
      $.vault('github').getToken(),
      $.vault('github').getToken(),
      $.vault('github').getToken(),
    ])

    expect(token1).toBe('concurrent_token')
    expect(token2).toBe('concurrent_token')
    expect(token3).toBe('concurrent_token')
  })

  it('handles missing required connect parameters', async () => {
    const $ = createMockContext()

    $._providerConfigs.set('github', {
      type: 'oauth',
      clientId: 'client_id',
      clientSecret: 'client_secret',
      authorizationUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      scopes: ['repo'],
    })

    // Missing redirectUri for OAuth
    await expect($.vaults.connect('github', {} as any)).rejects.toThrow()

    $._providerConfigs.set('stripe', {
      type: 'api_key',
    })

    // Missing apiKey for API key provider
    await expect($.vaults.connect('stripe', {} as any)).rejects.toThrow()
  })

  it('handles token at exact expiration boundary', async () => {
    const $ = createMockContext()

    // Token expires exactly now
    $._storage.credentials.set('github', {
      provider: 'github',
      accessToken: 'boundary_token',
      tokenType: 'bearer',
      expiresAt: new Date(Date.now()),
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    // Should be considered expired
    expect(await $.vault('github').isConnected()).toBe(false)
  })

  it('handles very long-lived tokens', async () => {
    const $ = createMockContext()

    // Token expires in 100 years
    $._storage.credentials.set('github', {
      provider: 'github',
      accessToken: 'long_lived_token',
      tokenType: 'bearer',
      expiresAt: new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    expect(await $.vault('github').isConnected()).toBe(true)
  })
})
