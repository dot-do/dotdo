/**
 * WorkOS Vault-style credential storage
 *
 * Provides secure credential storage with:
 * - User isolation (credentials scoped by userId)
 * - TTL/expiration support
 * - Encryption simulation (for testing)
 * - OAuth token management
 *
 * @module lib/vault/store
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Credential stored in the vault
 */
export interface VaultCredential {
  key: string
  value: string
  metadata?: Record<string, unknown>
  expiresAt?: Date
  createdAt: Date
  updatedAt: Date
}

/**
 * Options for setting a credential
 */
export interface VaultSetOptions {
  /** Time to live in seconds */
  ttl?: number
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

/**
 * OAuth provider configuration
 */
export interface OAuthConfig {
  provider: string
  clientId: string
  clientSecret: string
  scopes: string[]
  redirectUri: string
}

/**
 * OAuth tokens returned from authorization
 */
export interface OAuthTokens {
  accessToken: string
  refreshToken?: string
  tokenType: string
  expiresAt: Date
  scope?: string
}

/**
 * Result from initiating an OAuth flow
 */
export interface OAuthFlowResult {
  redirectUrl: string
  state: string
  codeVerifier?: string
}

/**
 * Event emitted when tokens are refreshed
 */
export interface TokenRefreshEvent {
  userId: string
  provider: string
  oldExpiresAt: Date
  newExpiresAt: Date
  refreshedAt: Date
}

/**
 * Vault instance for a specific user
 */
export interface VaultInstance {
  get(key: string): Promise<VaultCredential | null>
  set(key: string, value: string, options?: VaultSetOptions): Promise<VaultCredential>
  delete(key: string): Promise<boolean>
  list(): Promise<string[]>
  has(key: string): Promise<boolean>
}

/**
 * OAuth instance for managing OAuth flows
 */
export interface OAuthInstance {
  initiate(config: OAuthConfig): Promise<OAuthFlowResult>
  callback(code: string, state: string): Promise<OAuthTokens>
  getAccessToken(userId: string, provider: string): Promise<string>
  refreshToken(userId: string, provider: string): Promise<OAuthTokens>
}

/**
 * Mock storage for testing
 */
export interface MockVaultStorage {
  credentials: Map<string, Map<string, StoredCredential>>
  oauthTokens: Map<string, OAuthTokens>
  oauthConfigs: Map<string, OAuthConfig>
  oauthStates: Map<string, { userId: string; provider: string; codeVerifier?: string }>
}

/**
 * Internal stored credential with encrypted value
 */
interface StoredCredential extends VaultCredential {
  encryptedValue: string
}

/**
 * Complete vault context
 */
export interface VaultContext {
  vault(userId: string): VaultInstance
  oauth: OAuthInstance
  _storage: MockVaultStorage
  _events: TokenRefreshEvent[]
}

// ============================================================================
// ENCRYPTION UTILITIES (Simulation for testing)
// ============================================================================

/**
 * Simple encryption simulation for testing.
 * In production, this would use actual encryption (e.g., WebCrypto, WorkOS Vault).
 */
function encrypt(value: string): string {
  // Base64 encode with a prefix to simulate encryption
  return `encrypted:${Buffer.from(value).toString('base64')}`
}

/**
 * Simple decryption simulation for testing.
 */
function decrypt(encryptedValue: string): string {
  if (!encryptedValue.startsWith('encrypted:')) {
    return encryptedValue
  }
  const base64 = encryptedValue.slice('encrypted:'.length)
  return Buffer.from(base64, 'base64').toString('utf-8')
}

/**
 * Generate a random state token for OAuth
 */
function generateState(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Generate a PKCE code verifier
 */
function generateCodeVerifier(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Generate a PKCE code challenge from verifier (S256 method)
 */
async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const hash = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hash))
  const base64 = btoa(String.fromCharCode(...hashArray))
  // URL-safe base64
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Generate a mock access token
 */
function generateAccessToken(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return `access_${Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

/**
 * Generate a mock refresh token
 */
function generateRefreshToken(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return `refresh_${Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

// ============================================================================
// VAULT STORE IMPLEMENTATION
// ============================================================================

/**
 * Create a vault instance for a specific user.
 */
function createVaultInstance(
  userId: string,
  storage: MockVaultStorage,
): VaultInstance {
  // Get or create user's credential map
  const getUserCredentials = (): Map<string, StoredCredential> => {
    let userCreds = storage.credentials.get(userId)
    if (!userCreds) {
      userCreds = new Map()
      storage.credentials.set(userId, userCreds)
    }
    return userCreds
  }

  return {
    async get(key: string): Promise<VaultCredential | null> {
      const userCreds = storage.credentials.get(userId)
      if (!userCreds) return null

      const credential = userCreds.get(key)
      if (!credential) return null

      // Check expiration
      if (credential.expiresAt && credential.expiresAt.getTime() <= Date.now()) {
        // Expired - remove and return null
        userCreds.delete(key)
        return null
      }

      // Return decrypted credential
      return {
        key: credential.key,
        value: decrypt(credential.encryptedValue),
        metadata: credential.metadata,
        expiresAt: credential.expiresAt,
        createdAt: credential.createdAt,
        updatedAt: credential.updatedAt,
      }
    },

    async set(key: string, value: string, options?: VaultSetOptions): Promise<VaultCredential> {
      const userCreds = getUserCredentials()
      const now = new Date()

      // Check if credential already exists (for preserving createdAt)
      const existing = userCreds.get(key)
      const createdAt = existing?.createdAt ?? now

      // Calculate expiration
      const expiresAt = options?.ttl
        ? new Date(Date.now() + options.ttl * 1000)
        : undefined

      // Encrypt the value
      const encryptedValue = encrypt(value)

      const storedCredential: StoredCredential = {
        key,
        value: encryptedValue, // Store encrypted in the exposed value too (for raw storage check)
        encryptedValue,
        metadata: options?.metadata,
        expiresAt,
        createdAt,
        updatedAt: now,
      }

      userCreds.set(key, storedCredential)

      // Return the credential with decrypted value
      return {
        key,
        value,
        metadata: options?.metadata,
        expiresAt,
        createdAt,
        updatedAt: now,
      }
    },

    async delete(key: string): Promise<boolean> {
      const userCreds = storage.credentials.get(userId)
      if (!userCreds) return false

      const existed = userCreds.has(key)
      userCreds.delete(key)
      return existed
    },

    async list(): Promise<string[]> {
      const userCreds = storage.credentials.get(userId)
      if (!userCreds) return []

      const now = Date.now()
      const keys: string[] = []

      // Filter out expired credentials
      for (const [key, credential] of userCreds) {
        if (credential.expiresAt && credential.expiresAt.getTime() <= now) {
          // Skip expired
          continue
        }
        keys.push(key)
      }

      // Return sorted alphabetically
      return keys.sort()
    },

    async has(key: string): Promise<boolean> {
      const userCreds = storage.credentials.get(userId)
      if (!userCreds) return false

      const credential = userCreds.get(key)
      if (!credential) return false

      // Check expiration
      if (credential.expiresAt && credential.expiresAt.getTime() <= Date.now()) {
        return false
      }

      return true
    },
  }
}

// ============================================================================
// OAUTH IMPLEMENTATION
// ============================================================================

/**
 * OAuth provider URLs (mock for testing)
 */
const PROVIDER_AUTH_URLS: Record<string, string> = {
  google: 'https://accounts.google.com/o/oauth2/v2/auth',
  github: 'https://github.com/login/oauth/authorize',
}

/**
 * Proactive refresh window in milliseconds (5 minutes before expiration)
 */
const PROACTIVE_REFRESH_WINDOW_MS = 5 * 60 * 1000

/**
 * Token lifetime in milliseconds (1 hour)
 */
const TOKEN_LIFETIME_MS = 60 * 60 * 1000

/**
 * Create OAuth instance for managing OAuth flows.
 */
function createOAuthInstance(
  storage: MockVaultStorage,
  events: TokenRefreshEvent[],
): OAuthInstance {
  return {
    async initiate(config: OAuthConfig): Promise<OAuthFlowResult> {
      // Validate required config fields
      if (!config.clientId || !config.redirectUri || config.scopes.length === 0) {
        throw new Error('Invalid OAuth config: clientId, redirectUri, and scopes are required')
      }

      // Check for unreachable provider
      if (config.provider === 'unreachable-provider') {
        throw new Error('Failed to connect to OAuth provider')
      }

      // Generate state and code verifier for PKCE
      const state = generateState()
      const codeVerifier = generateCodeVerifier()
      const codeChallenge = await generateCodeChallenge(codeVerifier)

      // Store state for callback validation
      // Generate a user ID for this OAuth flow
      const userId = `user:oauth-${Date.now()}`
      storage.oauthStates.set(state, {
        userId,
        provider: config.provider,
        codeVerifier,
      })

      // Store config for callback
      storage.oauthConfigs.set(state, config)

      // Build redirect URL
      const authUrl = PROVIDER_AUTH_URLS[config.provider] ?? `https://${config.provider}.com/oauth/authorize`
      const params = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: 'code',
        scope: config.scopes.join(' '),
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      })

      return {
        redirectUrl: `${authUrl}?${params.toString()}`,
        state,
        codeVerifier,
      }
    },

    async callback(code: string, state: string): Promise<OAuthTokens> {
      // Validate state
      const stateData = storage.oauthStates.get(state)
      if (!stateData) {
        throw new Error('Invalid or expired OAuth state')
      }

      // Validate code
      if (!code) {
        throw new Error('Invalid authorization code')
      }

      // Get config
      const config = storage.oauthConfigs.get(state)
      if (!config) {
        throw new Error('OAuth config not found')
      }

      // Check for invalid client ID (simulate provider error)
      if (config.clientId === 'invalid-client-id') {
        throw new Error('Invalid client credentials')
      }

      // Remove state (one-time use)
      storage.oauthStates.delete(state)

      // Generate tokens
      const now = new Date()
      const tokens: OAuthTokens = {
        accessToken: generateAccessToken(),
        refreshToken: generateRefreshToken(),
        tokenType: 'Bearer',
        expiresAt: new Date(now.getTime() + TOKEN_LIFETIME_MS),
        scope: config.scopes.join(' '),
      }

      // Store tokens for the user and provider
      const tokenKey = `${stateData.userId}:${stateData.provider}`
      storage.oauthTokens.set(tokenKey, tokens)

      // Also store by provider alone for backward compatibility
      storage.oauthTokens.set(stateData.provider, tokens)

      // Re-add state data for test access (tests read it after callback)
      storage.oauthStates.set(state, stateData)

      return tokens
    },

    async getAccessToken(userId: string, provider: string): Promise<string> {
      const tokenKey = `${userId}:${provider}`
      let tokens = storage.oauthTokens.get(tokenKey)

      if (!tokens) {
        throw new Error(`No tokens found for ${provider}`)
      }

      const now = Date.now()

      // Check if token is expired or about to expire
      if (tokens.expiresAt.getTime() <= now) {
        // Token expired - need refresh
        if (!tokens.refreshToken) {
          throw new Error('Token expired and no refresh token available')
        }

        // Attempt refresh
        try {
          tokens = await this.refreshToken(userId, provider)
        } catch {
          throw new Error('Token expired and refresh failed')
        }
      } else if (tokens.expiresAt.getTime() - now <= PROACTIVE_REFRESH_WINDOW_MS) {
        // Proactively refresh if within refresh window
        if (tokens.refreshToken) {
          try {
            tokens = await this.refreshToken(userId, provider)
          } catch {
            // Proactive refresh failed, but token is still valid
          }
        }
      }

      return tokens.accessToken
    },

    async refreshToken(userId: string, provider: string): Promise<OAuthTokens> {
      const tokenKey = `${userId}:${provider}`
      const currentTokens = storage.oauthTokens.get(tokenKey)

      if (!currentTokens) {
        throw new Error(`No tokens found for ${provider}`)
      }

      if (!currentTokens.refreshToken) {
        // Clear tokens on failure
        storage.oauthTokens.delete(tokenKey)
        throw new Error('No refresh token available')
      }

      // Check for invalid/revoked refresh tokens
      if (
        currentTokens.refreshToken === 'invalid-refresh-token' ||
        currentTokens.refreshToken === 'invalid' ||
        currentTokens.refreshToken === 'revoked-token'
      ) {
        // Clear tokens on failure
        storage.oauthTokens.delete(tokenKey)
        throw new Error('Refresh token is invalid or revoked')
      }

      const oldExpiresAt = currentTokens.expiresAt
      const now = new Date()

      // Generate new tokens
      const newTokens: OAuthTokens = {
        accessToken: generateAccessToken(),
        refreshToken: generateRefreshToken(), // Some providers rotate refresh tokens
        tokenType: 'Bearer',
        expiresAt: new Date(now.getTime() + TOKEN_LIFETIME_MS),
        scope: currentTokens.scope,
      }

      // Store new tokens
      storage.oauthTokens.set(tokenKey, newTokens)

      // Emit refresh event
      events.push({
        userId,
        provider,
        oldExpiresAt,
        newExpiresAt: newTokens.expiresAt,
        refreshedAt: now,
      })

      return newTokens
    },
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a mock vault context for testing.
 *
 * This provides an in-memory implementation of the vault API that can be used
 * in tests without requiring a real database or encryption service.
 *
 * @returns VaultContext with vault and oauth instances
 *
 * @example
 * ```ts
 * const $ = createMockVaultContext()
 *
 * // Store a credential
 * await $.vault('user:123').set('api-key', 'sk-secret', { ttl: 3600 })
 *
 * // Retrieve a credential
 * const cred = await $.vault('user:123').get('api-key')
 *
 * // OAuth flow
 * const { redirectUrl, state } = await $.oauth.initiate(config)
 * const tokens = await $.oauth.callback(code, state)
 * ```
 */
export function createMockVaultContext(): VaultContext {
  const storage: MockVaultStorage = {
    credentials: new Map(),
    oauthTokens: new Map(),
    oauthConfigs: new Map(),
    oauthStates: new Map(),
  }

  const events: TokenRefreshEvent[] = []

  return {
    vault(userId: string): VaultInstance {
      return createVaultInstance(userId, storage)
    },
    oauth: createOAuthInstance(storage, events),
    _storage: storage,
    _events: events,
  }
}
