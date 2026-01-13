import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * CLI Link Command Tests (TDD RED Phase)
 *
 * Tests for the CLI commands that manage linked external accounts (GitHub, Slack, etc.)
 * through OAuth flows. These tests are expected to FAIL until the CLI link command
 * is implemented.
 *
 * Test Cases:
 * 1. `org.ai link github` initiates OAuth
 * 2. Opens browser to OAuth URL
 * 3. Callback handled by id.org.ai
 * 4. Token stored in Vault
 * 5. LinkedAccount created
 * 6. `org.ai accounts` shows linked account
 * 7. `org.ai unlink github` removes account
 *
 * Implementation requirements:
 * - Create CLI commands in cli/commands/link.ts
 * - Implement OAuth flow initiation
 * - Handle browser opening for OAuth
 * - Integrate with id.org.ai callback handling
 * - Store tokens securely in Vault
 * - Create/manage LinkedAccount records
 */

// ============================================================================
// Import CLI modules (will fail until implemented)
// ============================================================================

import {
  link,
  unlink,
  getLinkedAccounts,
  handleOAuthCallback,
  storeLinkedAccount,
  type LinkOptions,
  type LinkedAccount,
  type OAuthCallbackResult,
  type LinkResult,
  type UnlinkResult,
} from '../commands/link'

import { openBrowser, type BrowserOptions } from '../utils/browser'

import { getConfig, setConfig, type CLIConfig } from '../utils/config'

import { getSession, type Session } from '../utils/auth'

// ============================================================================
// Types
// ============================================================================

interface Provider {
  name: string
  displayName: string
  scopes: string[]
  authUrl: string
}

interface MockOAuthState {
  provider: string
  returnUrl: string
  state: string
  codeVerifier?: string
}

// ============================================================================
// Test Constants
// ============================================================================

const SUPPORTED_PROVIDERS: Provider[] = [
  {
    name: 'github',
    displayName: 'GitHub',
    scopes: ['user:email', 'repo', 'read:org'],
    authUrl: 'https://github.com/login/oauth/authorize',
  },
  {
    name: 'slack',
    displayName: 'Slack',
    scopes: ['users:read', 'chat:write', 'channels:read'],
    authUrl: 'https://slack.com/oauth/v2/authorize',
  },
  {
    name: 'google',
    displayName: 'Google',
    scopes: ['email', 'profile', 'calendar.readonly'],
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  },
  {
    name: 'discord',
    displayName: 'Discord',
    scopes: ['identify', 'email', 'guilds'],
    authUrl: 'https://discord.com/api/oauth2/authorize',
  },
  {
    name: 'linear',
    displayName: 'Linear',
    scopes: ['read', 'write'],
    authUrl: 'https://linear.app/oauth/authorize',
  },
]

const MOCK_SESSION: Session = {
  userId: 'user_123',
  email: 'test@example.com.ai',
  accessToken: 'session_token_xyz',
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
}

const MOCK_LINKED_ACCOUNT: LinkedAccount = {
  id: 'linked_account_123',
  provider: 'github',
  providerAccountId: 'gh_user_456',
  displayName: 'octocat',
  email: 'octocat@github.com',
  avatarUrl: 'https://github.com/octocat.png',
  vaultRef: 'vault_github_token_789',
  scopes: ['user:email', 'repo'],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

const MOCK_OAUTH_TOKEN = {
  accessToken: 'gho_mock_access_token_xyz123',
  refreshToken: 'gho_mock_refresh_token_abc456',
  tokenType: 'Bearer',
  expiresIn: 3600,
  scope: 'user:email repo',
}

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Mock the browser open function
 */
function mockBrowserOpen(): {
  calls: Array<{ url: string; options?: BrowserOptions }>
  mock: typeof openBrowser
} {
  const calls: Array<{ url: string; options?: BrowserOptions }> = []
  const mock = vi.fn(async (url: string, options?: BrowserOptions) => {
    calls.push({ url, options })
    return { success: true, url }
  })
  return { calls, mock: mock as unknown as typeof openBrowser }
}

/**
 * Mock the CLI config
 */
function mockConfig(overrides: Partial<CLIConfig> = {}): CLIConfig {
  return {
    apiUrl: 'https://api.org.ai',
    authUrl: 'https://id.org.ai',
    sessionToken: MOCK_SESSION.accessToken,
    ...overrides,
  }
}

/**
 * Create a mock OAuth state for testing callbacks
 */
function createMockOAuthState(provider: string): MockOAuthState {
  return {
    provider,
    returnUrl: 'http://localhost:3000/callback',
    state: `state_${Date.now()}_${Math.random().toString(36).substring(7)}`,
    codeVerifier: `verifier_${Math.random().toString(36).substring(2)}`,
  }
}

// ============================================================================
// 1. Link Command - OAuth Initiation Tests
// ============================================================================

describe('CLI Link Command - OAuth Initiation', () => {
  let browserMock: ReturnType<typeof mockBrowserOpen>

  beforeEach(() => {
    browserMock = mockBrowserOpen()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('link(provider) initiates OAuth flow', () => {
    it('initiates GitHub OAuth when running `org.ai link github`', async () => {
      const result = await link('github', {
        openBrowser: browserMock.mock,
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      expect(result).toBeDefined()
      expect(result.success).toBe(true)
      expect(result.provider).toBe('github')
      expect(result.oauthUrl).toBeDefined()
      expect(result.oauthUrl).toContain('github.com')
    })

    it('initiates Slack OAuth when running `org.ai link slack`', async () => {
      const result = await link('slack', {
        openBrowser: browserMock.mock,
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      expect(result.success).toBe(true)
      expect(result.provider).toBe('slack')
      expect(result.oauthUrl).toContain('slack.com')
    })

    it('initiates Google OAuth when running `org.ai link google`', async () => {
      const result = await link('google', {
        openBrowser: browserMock.mock,
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      expect(result.success).toBe(true)
      expect(result.provider).toBe('google')
      expect(result.oauthUrl).toContain('accounts.google.com')
    })

    it('initiates Discord OAuth when running `org.ai link discord`', async () => {
      const result = await link('discord', {
        openBrowser: browserMock.mock,
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      expect(result.success).toBe(true)
      expect(result.provider).toBe('discord')
      expect(result.oauthUrl).toContain('discord.com')
    })

    it('initiates Linear OAuth when running `org.ai link linear`', async () => {
      const result = await link('linear', {
        openBrowser: browserMock.mock,
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      expect(result.success).toBe(true)
      expect(result.provider).toBe('linear')
      expect(result.oauthUrl).toContain('linear.app')
    })

    it('returns error for unsupported provider', async () => {
      const result = await link('unsupported_provider', {
        openBrowser: browserMock.mock,
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/unsupported|not supported|unknown provider/i)
    })

    it('requires user to be authenticated', async () => {
      const result = await link('github', {
        openBrowser: browserMock.mock,
        config: mockConfig(),
        session: undefined, // No session
      })

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/not authenticated|login required|sign in/i)
    })

    it('includes required scopes in OAuth URL', async () => {
      const result = await link('github', {
        openBrowser: browserMock.mock,
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      expect(result.oauthUrl).toContain('scope=')
      // GitHub scopes should include user:email and repo
      expect(result.oauthUrl).toMatch(/user:email|user%3Aemail/)
    })

    it('includes custom scopes when specified', async () => {
      const result = await link('github', {
        openBrowser: browserMock.mock,
        config: mockConfig(),
        session: MOCK_SESSION,
        scopes: ['user:email', 'repo', 'admin:org'],
      })

      expect(result.oauthUrl).toContain('admin:org')
    })

    it('generates unique state parameter for CSRF protection', async () => {
      const result1 = await link('github', {
        openBrowser: browserMock.mock,
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      const result2 = await link('github', {
        openBrowser: browserMock.mock,
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      expect(result1.state).toBeDefined()
      expect(result2.state).toBeDefined()
      expect(result1.state).not.toBe(result2.state)
    })

    it('uses PKCE (code_challenge) for enhanced security', async () => {
      const result = await link('github', {
        openBrowser: browserMock.mock,
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      expect(result.oauthUrl).toContain('code_challenge=')
      expect(result.oauthUrl).toContain('code_challenge_method=S256')
    })
  })
})

// ============================================================================
// 2. Browser Opening Tests
// ============================================================================

describe('CLI Link Command - Browser Opening', () => {
  let browserMock: ReturnType<typeof mockBrowserOpen>

  beforeEach(() => {
    browserMock = mockBrowserOpen()
    vi.clearAllMocks()
  })

  describe('Opens browser to OAuth URL', () => {
    it('opens browser to GitHub OAuth URL', async () => {
      await link('github', {
        openBrowser: browserMock.mock,
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      expect(browserMock.calls.length).toBe(1)
      expect(browserMock.calls[0].url).toContain('github.com/login/oauth')
    })

    it('opens browser to id.org.ai proxy when federation is enabled', async () => {
      await link('github', {
        openBrowser: browserMock.mock,
        config: mockConfig({ federateAuth: true }),
        session: MOCK_SESSION,
      })

      expect(browserMock.calls.length).toBe(1)
      expect(browserMock.calls[0].url).toContain('id.org.ai')
    })

    it('does not open browser when --no-browser flag is set', async () => {
      const result = await link('github', {
        openBrowser: browserMock.mock,
        config: mockConfig(),
        session: MOCK_SESSION,
        noBrowser: true,
      })

      expect(browserMock.calls.length).toBe(0)
      // Should return URL for manual copying
      expect(result.oauthUrl).toBeDefined()
      expect(result.manualUrl).toBe(true)
    })

    it('handles browser open failure gracefully', async () => {
      const failingBrowserMock = vi.fn(async () => {
        throw new Error('Failed to open browser')
      })

      const result = await link('github', {
        openBrowser: failingBrowserMock as unknown as typeof openBrowser,
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      // Should still succeed, returning URL for manual use
      expect(result.success).toBe(true)
      expect(result.oauthUrl).toBeDefined()
      expect(result.browserError).toBeDefined()
    })

    it('uses system default browser by default', async () => {
      await link('github', {
        openBrowser: browserMock.mock,
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      // Should not specify a specific browser
      expect(browserMock.calls[0].options?.browser).toBeUndefined()
    })

    it('supports specifying browser via config', async () => {
      await link('github', {
        openBrowser: browserMock.mock,
        config: mockConfig({ preferredBrowser: 'chrome' }),
        session: MOCK_SESSION,
      })

      expect(browserMock.calls[0].options?.browser).toBe('chrome')
    })

    it('displays OAuth URL in terminal when browser fails', async () => {
      const failingBrowserMock = vi.fn(async () => {
        throw new Error('No browser available')
      })

      const result = await link('github', {
        openBrowser: failingBrowserMock as unknown as typeof openBrowser,
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      expect(result.displayUrl).toBe(true)
      expect(result.oauthUrl).toBeDefined()
    })
  })
})

// ============================================================================
// 3. OAuth Callback Handling Tests
// ============================================================================

describe('CLI Link Command - OAuth Callback', () => {
  describe('Callback handled by id.org.ai', () => {
    it('handles successful OAuth callback with authorization code', async () => {
      const oauthState = createMockOAuthState('github')

      const result = await handleOAuthCallback({
        code: 'auth_code_xyz123',
        state: oauthState.state,
        storedState: oauthState,
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      expect(result.success).toBe(true)
      expect(result.provider).toBe('github')
      expect(result.tokens).toBeDefined()
    })

    it('exchanges authorization code for tokens', async () => {
      const oauthState = createMockOAuthState('github')

      const result = await handleOAuthCallback({
        code: 'auth_code_xyz123',
        state: oauthState.state,
        storedState: oauthState,
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      expect(result.tokens?.accessToken).toBeDefined()
      expect(result.tokens?.tokenType).toBe('Bearer')
    })

    it('validates state parameter to prevent CSRF', async () => {
      const oauthState = createMockOAuthState('github')

      const result = await handleOAuthCallback({
        code: 'auth_code_xyz123',
        state: 'invalid_state_mismatch',
        storedState: oauthState,
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/state.*mismatch|invalid state|csrf/i)
    })

    it('uses PKCE code_verifier in token exchange', async () => {
      const oauthState = createMockOAuthState('github')

      const result = await handleOAuthCallback({
        code: 'auth_code_xyz123',
        state: oauthState.state,
        storedState: oauthState,
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      // Should successfully exchange using PKCE
      expect(result.success).toBe(true)
    })

    it('handles OAuth error response', async () => {
      const oauthState = createMockOAuthState('github')

      const result = await handleOAuthCallback({
        error: 'access_denied',
        errorDescription: 'User denied access',
        state: oauthState.state,
        storedState: oauthState,
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/access denied|user denied/i)
    })

    it('handles expired authorization code', async () => {
      const oauthState = createMockOAuthState('github')

      const result = await handleOAuthCallback({
        code: 'expired_auth_code',
        state: oauthState.state,
        storedState: oauthState,
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/expired|invalid.*code/i)
    })

    it('retrieves user profile after token exchange', async () => {
      const oauthState = createMockOAuthState('github')

      const result = await handleOAuthCallback({
        code: 'auth_code_xyz123',
        state: oauthState.state,
        storedState: oauthState,
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      expect(result.profile).toBeDefined()
      expect(result.profile?.providerAccountId).toBeDefined()
      expect(result.profile?.displayName).toBeDefined()
    })

    it('handles callback URL from id.org.ai federation', async () => {
      const oauthState = createMockOAuthState('github')

      const result = await handleOAuthCallback({
        code: 'auth_code_xyz123',
        state: oauthState.state,
        storedState: oauthState,
        config: mockConfig({ federateAuth: true }),
        session: MOCK_SESSION,
        callbackOrigin: 'https://id.org.ai',
      })

      expect(result.success).toBe(true)
      expect(result.federatedCallback).toBe(true)
    })
  })
})

// ============================================================================
// 4. Token Storage Tests
// ============================================================================

describe('CLI Link Command - Token Storage', () => {
  describe('Token stored in Vault', () => {
    it('stores OAuth token in secure vault', async () => {
      const result = await storeLinkedAccount({
        provider: 'github',
        tokens: MOCK_OAUTH_TOKEN,
        profile: {
          providerAccountId: 'gh_user_456',
          displayName: 'octocat',
          email: 'octocat@github.com',
        },
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      expect(result.success).toBe(true)
      expect(result.linkedAccount).toBeDefined()
      expect(result.linkedAccount?.vaultRef).toBeDefined()
      expect(result.linkedAccount?.vaultRef).toMatch(/^vault_/)
    })

    it('never stores raw token in LinkedAccount record', async () => {
      const result = await storeLinkedAccount({
        provider: 'github',
        tokens: MOCK_OAUTH_TOKEN,
        profile: {
          providerAccountId: 'gh_user_456',
          displayName: 'octocat',
        },
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      const linkedAccount = result.linkedAccount

      // LinkedAccount should have vaultRef, not raw tokens
      expect(linkedAccount?.vaultRef).toBeDefined()
      expect((linkedAccount as unknown as Record<string, unknown>)?.accessToken).toBeUndefined()
      expect((linkedAccount as unknown as Record<string, unknown>)?.refreshToken).toBeUndefined()
    })

    it('stores refresh token separately for rotation', async () => {
      const result = await storeLinkedAccount({
        provider: 'github',
        tokens: {
          ...MOCK_OAUTH_TOKEN,
          refreshToken: 'gho_refresh_token_xyz',
        },
        profile: {
          providerAccountId: 'gh_user_456',
          displayName: 'octocat',
        },
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      expect(result.success).toBe(true)
      // Refresh token should be stored for automatic rotation
      expect(result.hasRefreshToken).toBe(true)
    })

    it('records token expiration for refresh scheduling', async () => {
      const result = await storeLinkedAccount({
        provider: 'github',
        tokens: {
          ...MOCK_OAUTH_TOKEN,
          expiresIn: 3600,
        },
        profile: {
          providerAccountId: 'gh_user_456',
          displayName: 'octocat',
        },
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      expect(result.linkedAccount?.tokenExpiresAt).toBeDefined()
      const expiresAt = new Date(result.linkedAccount?.tokenExpiresAt || 0)
      expect(expiresAt.getTime()).toBeGreaterThan(Date.now())
    })

    it('encrypts token before storing in vault', async () => {
      const result = await storeLinkedAccount({
        provider: 'github',
        tokens: MOCK_OAUTH_TOKEN,
        profile: {
          providerAccountId: 'gh_user_456',
          displayName: 'octocat',
        },
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      // Token should be encrypted in vault
      expect(result.encrypted).toBe(true)
    })

    it('handles vault storage failure gracefully', async () => {
      const result = await storeLinkedAccount({
        provider: 'github',
        tokens: MOCK_OAUTH_TOKEN,
        profile: {
          providerAccountId: 'gh_user_456',
          displayName: 'octocat',
        },
        config: mockConfig({ vaultUrl: 'https://invalid.vault.url' }),
        session: MOCK_SESSION,
      })

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/vault|storage|failed/i)
    })
  })
})

// ============================================================================
// 5. LinkedAccount Creation Tests
// ============================================================================

describe('CLI Link Command - LinkedAccount Creation', () => {
  describe('LinkedAccount created', () => {
    it('creates LinkedAccount record after successful OAuth', async () => {
      const result = await storeLinkedAccount({
        provider: 'github',
        tokens: MOCK_OAUTH_TOKEN,
        profile: {
          providerAccountId: 'gh_user_456',
          displayName: 'octocat',
          email: 'octocat@github.com',
          avatarUrl: 'https://github.com/octocat.png',
        },
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      expect(result.success).toBe(true)
      expect(result.linkedAccount).toBeDefined()
      expect(result.linkedAccount?.id).toBeDefined()
      expect(result.linkedAccount?.provider).toBe('github')
    })

    it('includes provider account ID in LinkedAccount', async () => {
      const result = await storeLinkedAccount({
        provider: 'github',
        tokens: MOCK_OAUTH_TOKEN,
        profile: {
          providerAccountId: 'gh_user_12345',
          displayName: 'testuser',
        },
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      expect(result.linkedAccount?.providerAccountId).toBe('gh_user_12345')
    })

    it('includes display name and email in LinkedAccount', async () => {
      const result = await storeLinkedAccount({
        provider: 'github',
        tokens: MOCK_OAUTH_TOKEN,
        profile: {
          providerAccountId: 'gh_user_456',
          displayName: 'Test User',
          email: 'test@example.com.ai',
        },
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      expect(result.linkedAccount?.displayName).toBe('Test User')
      expect(result.linkedAccount?.email).toBe('test@example.com.ai')
    })

    it('includes avatar URL in LinkedAccount', async () => {
      const result = await storeLinkedAccount({
        provider: 'github',
        tokens: MOCK_OAUTH_TOKEN,
        profile: {
          providerAccountId: 'gh_user_456',
          displayName: 'octocat',
          avatarUrl: 'https://github.com/octocat.png',
        },
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      expect(result.linkedAccount?.avatarUrl).toBe('https://github.com/octocat.png')
    })

    it('records granted scopes in LinkedAccount', async () => {
      const result = await storeLinkedAccount({
        provider: 'github',
        tokens: {
          ...MOCK_OAUTH_TOKEN,
          scope: 'user:email repo read:org',
        },
        profile: {
          providerAccountId: 'gh_user_456',
          displayName: 'octocat',
        },
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      expect(result.linkedAccount?.scopes).toContain('user:email')
      expect(result.linkedAccount?.scopes).toContain('repo')
      expect(result.linkedAccount?.scopes).toContain('read:org')
    })

    it('sets createdAt and updatedAt timestamps', async () => {
      const beforeCreate = new Date()

      const result = await storeLinkedAccount({
        provider: 'github',
        tokens: MOCK_OAUTH_TOKEN,
        profile: {
          providerAccountId: 'gh_user_456',
          displayName: 'octocat',
        },
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      const createdAt = new Date(result.linkedAccount?.createdAt || 0)
      const updatedAt = new Date(result.linkedAccount?.updatedAt || 0)

      expect(createdAt.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime())
      expect(updatedAt.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime())
    })

    it('prevents duplicate LinkedAccount for same provider and user', async () => {
      // First link
      await storeLinkedAccount({
        provider: 'github',
        tokens: MOCK_OAUTH_TOKEN,
        profile: {
          providerAccountId: 'gh_user_456',
          displayName: 'octocat',
        },
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      // Second link attempt with same provider
      const result = await storeLinkedAccount({
        provider: 'github',
        tokens: MOCK_OAUTH_TOKEN,
        profile: {
          providerAccountId: 'gh_user_456',
          displayName: 'octocat',
        },
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      // Should update existing rather than create duplicate
      expect(result.success).toBe(true)
      expect(result.updated).toBe(true)
    })

    it('allows multiple accounts for same provider (different provider IDs)', async () => {
      // First GitHub account
      await storeLinkedAccount({
        provider: 'github',
        tokens: MOCK_OAUTH_TOKEN,
        profile: {
          providerAccountId: 'gh_work_account',
          displayName: 'Work Account',
        },
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      // Second GitHub account (different provider ID)
      const result = await storeLinkedAccount({
        provider: 'github',
        tokens: MOCK_OAUTH_TOKEN,
        profile: {
          providerAccountId: 'gh_personal_account',
          displayName: 'Personal Account',
        },
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      expect(result.success).toBe(true)
      expect(result.updated).toBeFalsy() // New record, not update
    })
  })
})

// ============================================================================
// 6. List Linked Accounts Tests
// ============================================================================

describe('CLI Link Command - List Accounts', () => {
  describe('`org.ai accounts` shows linked accounts', () => {
    it('returns empty list when no accounts linked', async () => {
      const accounts = await getLinkedAccounts({
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      expect(accounts).toBeDefined()
      expect(Array.isArray(accounts)).toBe(true)
    })

    it('returns all linked accounts for current user', async () => {
      // Pre-link some accounts
      await storeLinkedAccount({
        provider: 'github',
        tokens: MOCK_OAUTH_TOKEN,
        profile: { providerAccountId: 'gh_1', displayName: 'GitHub' },
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      await storeLinkedAccount({
        provider: 'slack',
        tokens: MOCK_OAUTH_TOKEN,
        profile: { providerAccountId: 'slack_1', displayName: 'Slack' },
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      const accounts = await getLinkedAccounts({
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      expect(accounts.length).toBeGreaterThanOrEqual(2)
      const providers = accounts.map((a: LinkedAccount) => a.provider)
      expect(providers).toContain('github')
      expect(providers).toContain('slack')
    })

    it('filters accounts by provider when specified', async () => {
      const accounts = await getLinkedAccounts({
        config: mockConfig(),
        session: MOCK_SESSION,
        provider: 'github',
      })

      for (const account of accounts) {
        expect(account.provider).toBe('github')
      }
    })

    it('includes account metadata (displayName, email, avatar)', async () => {
      await storeLinkedAccount({
        provider: 'github',
        tokens: MOCK_OAUTH_TOKEN,
        profile: {
          providerAccountId: 'gh_metadata_test',
          displayName: 'Test User',
          email: 'test@example.com.ai',
          avatarUrl: 'https://example.com.ai/avatar.png',
        },
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      const accounts = await getLinkedAccounts({
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      const githubAccount = accounts.find(
        (a: LinkedAccount) => a.providerAccountId === 'gh_metadata_test'
      )

      expect(githubAccount).toBeDefined()
      expect(githubAccount?.displayName).toBe('Test User')
      expect(githubAccount?.email).toBe('test@example.com.ai')
      expect(githubAccount?.avatarUrl).toBe('https://example.com.ai/avatar.png')
    })

    it('shows granted scopes for each account', async () => {
      await storeLinkedAccount({
        provider: 'github',
        tokens: {
          ...MOCK_OAUTH_TOKEN,
          scope: 'user:email repo admin:org',
        },
        profile: {
          providerAccountId: 'gh_scopes_test',
          displayName: 'Scopes Test',
        },
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      const accounts = await getLinkedAccounts({
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      const githubAccount = accounts.find(
        (a: LinkedAccount) => a.providerAccountId === 'gh_scopes_test'
      )

      expect(githubAccount?.scopes).toContain('user:email')
      expect(githubAccount?.scopes).toContain('repo')
      expect(githubAccount?.scopes).toContain('admin:org')
    })

    it('requires authentication to list accounts', async () => {
      await expect(
        getLinkedAccounts({
          config: mockConfig(),
          session: undefined, // No session
        })
      ).rejects.toThrow(/not authenticated|login required/i)
    })

    it('does not expose raw tokens in account list', async () => {
      await storeLinkedAccount({
        provider: 'github',
        tokens: MOCK_OAUTH_TOKEN,
        profile: {
          providerAccountId: 'gh_no_tokens',
          displayName: 'No Tokens Visible',
        },
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      const accounts = await getLinkedAccounts({
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      for (const account of accounts) {
        expect((account as unknown as Record<string, unknown>).accessToken).toBeUndefined()
        expect((account as unknown as Record<string, unknown>).refreshToken).toBeUndefined()
      }
    })

    it('shows account connection status (active, expired, needs refresh)', async () => {
      const accounts = await getLinkedAccounts({
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      for (const account of accounts) {
        expect(['active', 'expired', 'needs_refresh', 'error']).toContain(account.status)
      }
    })
  })
})

// ============================================================================
// 7. Unlink Command Tests
// ============================================================================

describe('CLI Link Command - Unlink', () => {
  describe('`org.ai unlink github` removes account', () => {
    it('removes linked account by provider', async () => {
      // First link an account
      await storeLinkedAccount({
        provider: 'github',
        tokens: MOCK_OAUTH_TOKEN,
        profile: {
          providerAccountId: 'gh_to_unlink',
          displayName: 'To Unlink',
        },
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      // Then unlink it
      const result = await unlink('github', {
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      expect(result.success).toBe(true)
      expect(result.provider).toBe('github')
      expect(result.removed).toBe(true)
    })

    it('removes specific account when multiple accounts exist for provider', async () => {
      // Link two GitHub accounts
      await storeLinkedAccount({
        provider: 'github',
        tokens: MOCK_OAUTH_TOKEN,
        profile: { providerAccountId: 'gh_work', displayName: 'Work' },
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      await storeLinkedAccount({
        provider: 'github',
        tokens: MOCK_OAUTH_TOKEN,
        profile: { providerAccountId: 'gh_personal', displayName: 'Personal' },
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      // Unlink specific account by provider account ID
      const result = await unlink('github', {
        config: mockConfig(),
        session: MOCK_SESSION,
        providerAccountId: 'gh_work',
      })

      expect(result.success).toBe(true)

      // Verify only the work account was removed
      const accounts = await getLinkedAccounts({
        config: mockConfig(),
        session: MOCK_SESSION,
        provider: 'github',
      })

      const providerIds = accounts.map((a: LinkedAccount) => a.providerAccountId)
      expect(providerIds).not.toContain('gh_work')
      expect(providerIds).toContain('gh_personal')
    })

    it('deletes tokens from vault when unlinking', async () => {
      // Link an account
      const storeResult = await storeLinkedAccount({
        provider: 'github',
        tokens: MOCK_OAUTH_TOKEN,
        profile: {
          providerAccountId: 'gh_vault_delete',
          displayName: 'Vault Delete',
        },
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      const vaultRef = storeResult.linkedAccount?.vaultRef

      // Unlink it
      const result = await unlink('github', {
        config: mockConfig(),
        session: MOCK_SESSION,
        providerAccountId: 'gh_vault_delete',
      })

      expect(result.success).toBe(true)
      expect(result.vaultDeleted).toBe(true)
      expect(result.deletedVaultRef).toBe(vaultRef)
    })

    it('returns error when trying to unlink non-existent account', async () => {
      const result = await unlink('nonexistent_provider', {
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/not found|no.*account|not linked/i)
    })

    it('requires authentication to unlink', async () => {
      const result = await unlink('github', {
        config: mockConfig(),
        session: undefined, // No session
      })

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/not authenticated|login required/i)
    })

    it('confirms before unlinking (interactive mode)', async () => {
      const confirmMock = vi.fn(() => true)

      const result = await unlink('github', {
        config: mockConfig(),
        session: MOCK_SESSION,
        interactive: true,
        confirm: confirmMock,
      })

      expect(confirmMock).toHaveBeenCalled()
      expect(result.success).toBe(true)
    })

    it('aborts when user declines confirmation', async () => {
      const confirmMock = vi.fn(() => false)

      const result = await unlink('github', {
        config: mockConfig(),
        session: MOCK_SESSION,
        interactive: true,
        confirm: confirmMock,
      })

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/cancelled|aborted|declined/i)
    })

    it('skips confirmation with --force flag', async () => {
      const confirmMock = vi.fn()

      await unlink('github', {
        config: mockConfig(),
        session: MOCK_SESSION,
        force: true,
        confirm: confirmMock,
      })

      expect(confirmMock).not.toHaveBeenCalled()
    })

    it('revokes OAuth token at provider (when supported)', async () => {
      // Link an account
      await storeLinkedAccount({
        provider: 'github',
        tokens: MOCK_OAUTH_TOKEN,
        profile: {
          providerAccountId: 'gh_revoke_test',
          displayName: 'Revoke Test',
        },
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      const result = await unlink('github', {
        config: mockConfig(),
        session: MOCK_SESSION,
        providerAccountId: 'gh_revoke_test',
        revokeAtProvider: true,
      })

      expect(result.success).toBe(true)
      expect(result.providerRevoked).toBe(true)
    })

    it('continues even if provider revocation fails', async () => {
      // Link an account
      await storeLinkedAccount({
        provider: 'github',
        tokens: MOCK_OAUTH_TOKEN,
        profile: {
          providerAccountId: 'gh_revoke_fail',
          displayName: 'Revoke Fail',
        },
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      const result = await unlink('github', {
        config: mockConfig(),
        session: MOCK_SESSION,
        providerAccountId: 'gh_revoke_fail',
        revokeAtProvider: true,
        // Simulate provider revocation failure
        mockProviderError: true,
      } as Parameters<typeof unlink>[1])

      // Should still succeed locally even if provider revocation fails
      expect(result.success).toBe(true)
      expect(result.providerRevoked).toBe(false)
      expect(result.providerRevokeError).toBeDefined()
    })
  })
})

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('CLI Link Command - Edge Cases', () => {
  describe('Error handling', () => {
    it('handles network timeout gracefully', async () => {
      const result = await link('github', {
        openBrowser: mockBrowserOpen().mock,
        config: mockConfig({ apiUrl: 'https://slow.api.example.com.ai', timeout: 1 }),
        session: MOCK_SESSION,
      })

      // Should handle timeout and provide helpful error
      if (!result.success) {
        expect(result.error).toMatch(/timeout|network|connection/i)
      }
    })

    it('handles API errors gracefully', async () => {
      const result = await storeLinkedAccount({
        provider: 'github',
        tokens: MOCK_OAUTH_TOKEN,
        profile: {
          providerAccountId: 'gh_api_error',
          displayName: 'API Error',
        },
        config: mockConfig({ apiUrl: 'https://error.api.example.com.ai' }),
        session: MOCK_SESSION,
      })

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('handles expired session during link', async () => {
      const expiredSession: Session = {
        ...MOCK_SESSION,
        expiresAt: new Date(Date.now() - 3600000).toISOString(), // Expired 1 hour ago
      }

      const result = await link('github', {
        openBrowser: mockBrowserOpen().mock,
        config: mockConfig(),
        session: expiredSession,
      })

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/session.*expired|re-authenticate/i)
    })

    it('handles rate limiting from provider', async () => {
      // Simulate hitting rate limit during token exchange
      const oauthState = createMockOAuthState('github')

      const result = await handleOAuthCallback({
        code: 'rate_limited_code',
        state: oauthState.state,
        storedState: oauthState,
        config: mockConfig(),
        session: MOCK_SESSION,
        mockRateLimit: true,
      } as Parameters<typeof handleOAuthCallback>[0])

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/rate.?limit|too many/i)
      expect(result.retryAfter).toBeDefined()
    })
  })

  describe('Concurrent operations', () => {
    it('handles concurrent link attempts for same provider', async () => {
      const browserMock = mockBrowserOpen()

      const results = await Promise.all([
        link('github', {
          openBrowser: browserMock.mock,
          config: mockConfig(),
          session: MOCK_SESSION,
        }),
        link('github', {
          openBrowser: browserMock.mock,
          config: mockConfig(),
          session: MOCK_SESSION,
        }),
      ])

      // Both should complete without error
      for (const result of results) {
        expect(result.success).toBe(true)
      }
    })

    it('prevents race condition in account creation', async () => {
      const profile = {
        providerAccountId: 'gh_race_condition_test',
        displayName: 'Race Test',
      }

      // Attempt to create same account concurrently
      const results = await Promise.all([
        storeLinkedAccount({
          provider: 'github',
          tokens: MOCK_OAUTH_TOKEN,
          profile,
          config: mockConfig(),
          session: MOCK_SESSION,
        }),
        storeLinkedAccount({
          provider: 'github',
          tokens: MOCK_OAUTH_TOKEN,
          profile,
          config: mockConfig(),
          session: MOCK_SESSION,
        }),
      ])

      // Should not create duplicates
      const successCount = results.filter((r) => r.success).length
      const accounts = await getLinkedAccounts({
        config: mockConfig(),
        session: MOCK_SESSION,
        provider: 'github',
      })

      const matchingAccounts = accounts.filter(
        (a: LinkedAccount) => a.providerAccountId === 'gh_race_condition_test'
      )

      expect(matchingAccounts.length).toBe(1)
    })
  })
})

// ============================================================================
// Integration Scenarios
// ============================================================================

describe('CLI Link Command - Integration Scenarios', () => {
  describe('Full OAuth flow', () => {
    it('completes full GitHub OAuth flow: link -> callback -> store -> list', async () => {
      const browserMock = mockBrowserOpen()

      // Step 1: Initiate link
      const linkResult = await link('github', {
        openBrowser: browserMock.mock,
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      expect(linkResult.success).toBe(true)
      expect(linkResult.state).toBeDefined()

      // Step 2: Handle callback
      const callbackResult = await handleOAuthCallback({
        code: 'test_auth_code_xyz',
        state: linkResult.state!,
        storedState: {
          provider: 'github',
          returnUrl: 'http://localhost:3000/callback',
          state: linkResult.state!,
        },
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      expect(callbackResult.success).toBe(true)
      expect(callbackResult.tokens).toBeDefined()

      // Step 3: Store linked account
      const storeResult = await storeLinkedAccount({
        provider: 'github',
        tokens: callbackResult.tokens!,
        profile: callbackResult.profile!,
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      expect(storeResult.success).toBe(true)
      expect(storeResult.linkedAccount).toBeDefined()

      // Step 4: Verify account appears in list
      const accounts = await getLinkedAccounts({
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      const githubAccount = accounts.find((a: LinkedAccount) => a.provider === 'github')
      expect(githubAccount).toBeDefined()
    })

    it('completes full unlink flow: list -> unlink -> verify removed', async () => {
      // Pre-setup: Link an account
      await storeLinkedAccount({
        provider: 'slack',
        tokens: MOCK_OAUTH_TOKEN,
        profile: {
          providerAccountId: 'slack_to_remove',
          displayName: 'Slack Account',
        },
        config: mockConfig(),
        session: MOCK_SESSION,
      })

      // Step 1: Verify account exists
      const beforeAccounts = await getLinkedAccounts({
        config: mockConfig(),
        session: MOCK_SESSION,
        provider: 'slack',
      })

      expect(beforeAccounts.length).toBeGreaterThan(0)

      // Step 2: Unlink
      const unlinkResult = await unlink('slack', {
        config: mockConfig(),
        session: MOCK_SESSION,
        providerAccountId: 'slack_to_remove',
      })

      expect(unlinkResult.success).toBe(true)

      // Step 3: Verify removed
      const afterAccounts = await getLinkedAccounts({
        config: mockConfig(),
        session: MOCK_SESSION,
        provider: 'slack',
      })

      const slackAccount = afterAccounts.find(
        (a: LinkedAccount) => a.providerAccountId === 'slack_to_remove'
      )
      expect(slackAccount).toBeUndefined()
    })
  })
})
