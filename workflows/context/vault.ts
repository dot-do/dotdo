/**
 * Vault Context API for $.vault() and $.vaults
 *
 * Provides a workflow context API for credential/secret management with support for:
 * - $.vault(provider).getToken() - Get access token for provider
 * - $.vault(provider).getCredentials() - Get full credentials object
 * - $.vault(provider).isConnected() - Check if provider is connected
 * - $.vault(provider).disconnect() - Remove provider connection
 * - $.vault(provider).refresh() - Force token refresh
 * - $.vaults.list() - List connected providers
 * - $.vaults.connect(provider, config) - Initiate OAuth or API key connection
 * - $.vaults.getCallback(provider) - Handle OAuth callback
 *
 * @module workflows/context/vault
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Credentials stored for a provider
 */
export interface VaultCredentials {
  provider: string
  accessToken?: string
  refreshToken?: string
  apiKey?: string
  tokenType: 'bearer' | 'api_key'
  scope?: string
  expiresAt?: Date
  createdAt: Date
  updatedAt: Date
  status?: 'connected' | 'disconnected'
  metadata?: Record<string, unknown>
}

/**
 * Vault instance returned by $.vault(provider)
 */
export interface VaultContextInstance {
  getToken(): Promise<string | null>
  getCredentials(): Promise<VaultCredentials | null>
  isConnected(): Promise<boolean>
  disconnect(): Promise<void>
  refresh(): Promise<void>
}

/**
 * Vaults collection API at $.vaults
 */
export interface VaultsCollection {
  list(): Promise<string[]>
  connect(provider: string, config: ConnectConfig): Promise<ConnectResult>
  getCallback(provider: string, params: CallbackParams): Promise<CallbackResult>
}

/**
 * OAuth provider configuration
 */
export interface OAuthConfig {
  type: 'oauth'
  clientId: string
  clientSecret: string
  authorizationUrl: string
  tokenUrl: string
  scopes: string[]
  userInfoUrl?: string
  additionalParams?: Record<string, string>
  parseTokenResponse?: (response: Record<string, unknown>) => {
    accessToken: string
    tokenType: string
    expiresIn?: number
    refreshToken?: string
  }
}

/**
 * API key provider configuration
 */
export interface ApiKeyConfig {
  type: 'api_key'
  validateKey?: (key: string) => boolean
  extractMetadata?: (key: string) => Record<string, unknown>
}

/**
 * Provider configuration (OAuth or API key)
 */
export type ProviderConfig = OAuthConfig | ApiKeyConfig

/**
 * Configuration for $.vaults.connect()
 */
export interface ConnectConfig {
  redirectUri?: string
  scopes?: string[]
  apiKey?: string
}

/**
 * Result from $.vaults.connect()
 */
export interface ConnectResult {
  authorizationUrl?: string
  state?: string
  connected?: boolean
}

/**
 * Parameters for $.vaults.getCallback()
 */
export interface CallbackParams {
  code?: string
  state?: string
  error?: string
  error_description?: string
}

/**
 * Result from $.vaults.getCallback()
 */
export interface CallbackResult {
  success: boolean
}

/**
 * Pending OAuth state
 */
export interface PendingOAuth {
  provider: string
  redirectUri: string
  createdAt: Date
  expiresAt?: Date
}

/**
 * Mock token exchange response
 */
export interface MockTokenExchange {
  access_token?: string
  refresh_token?: string
  token_type?: string
  scope?: string
  expires_in?: number
  // Custom formats
  token?: string
  expires?: number
}

/**
 * Mock refresh response
 */
export interface MockRefresh {
  accessToken: string
  expiresIn: number
}

/**
 * Mock storage interface for vault
 */
export interface MockStorage {
  credentials: Map<string, VaultCredentials>
  pendingOAuth: Map<string, PendingOAuth>
}

/**
 * Full context interface returned by createMockContext
 */
export interface VaultContext {
  vault: (provider: string) => VaultContextInstance
  vaults: VaultsCollection
  _storage: MockStorage
  _providerConfigs: Map<string, ProviderConfig>
  _mockTokenExchange: Map<string, MockTokenExchange>
  _mockRefresh: Map<string, MockRefresh>
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Default OAuth state expiration time (5 minutes in milliseconds)
 */
const OAUTH_STATE_EXPIRATION_MS = 5 * 60 * 1000

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if OAuth credentials are expired
 */
function isTokenExpired(creds: VaultCredentials): boolean {
  // API keys don't expire
  if (creds.tokenType === 'api_key') {
    return false
  }

  // No expiration = not expired
  if (!creds.expiresAt) {
    return false
  }

  // Compare with current time (expired if expiresAt <= now)
  return creds.expiresAt.getTime() <= Date.now()
}

/**
 * Check if credentials are valid and connected
 */
function isCredentialConnected(creds: VaultCredentials | undefined): boolean {
  if (!creds) {
    return false
  }

  // Check if explicitly disconnected
  if (creds.status === 'disconnected') {
    return false
  }

  // Check if token is expired
  if (isTokenExpired(creds)) {
    return false
  }

  // Check if we have a token or API key
  if (creds.tokenType === 'api_key') {
    return !!creds.apiKey
  }

  return !!creds.accessToken
}

/**
 * Create a deep copy of credentials
 */
function cloneCredentials(creds: VaultCredentials): VaultCredentials {
  return {
    ...creds,
    expiresAt: creds.expiresAt ? new Date(creds.expiresAt.getTime()) : undefined,
    createdAt: new Date(creds.createdAt.getTime()),
    updatedAt: new Date(creds.updatedAt.getTime()),
    metadata: creds.metadata ? { ...creds.metadata } : undefined,
  }
}

/**
 * Generate a random state string for CSRF protection
 */
function generateState(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Build OAuth authorization URL
 */
function buildAuthorizationUrl(
  config: OAuthConfig,
  redirectUri: string,
  state: string,
  scopes?: string[]
): string {
  const url = new URL(config.authorizationUrl)

  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', state)
  url.searchParams.set('response_type', 'code')

  // Merge scopes: use provided scopes or fall back to config scopes
  const allScopes = scopes ?? config.scopes
  if (allScopes && allScopes.length > 0) {
    url.searchParams.set('scope', allScopes.join(' '))
  }

  // Add additional params if configured
  if (config.additionalParams) {
    for (const [key, value] of Object.entries(config.additionalParams)) {
      url.searchParams.set(key, value)
    }
  }

  return url.toString()
}

// ============================================================================
// CONTEXT FACTORY
// ============================================================================

/**
 * Creates a mock workflow context ($) with vault support for testing
 *
 * This factory creates a context object with:
 * - $.vault(provider) - Returns a VaultContextInstance for per-provider operations
 * - $.vaults - Collection-level operations (list, connect, getCallback)
 * - $._storage - Internal storage for test setup
 * - $._providerConfigs - Provider configurations for OAuth/API key
 * - $._mockTokenExchange - Mock token exchange responses for testing
 * - $._mockRefresh - Mock refresh responses for testing
 *
 * @returns A VaultContext object with vault API methods
 */
export function createMockContext(): VaultContext {
  // Internal storage
  const storage: MockStorage = {
    credentials: new Map<string, VaultCredentials>(),
    pendingOAuth: new Map<string, PendingOAuth>(),
  }

  // Provider configurations
  const providerConfigs = new Map<string, ProviderConfig>()

  // Mock responses for testing
  const mockTokenExchange = new Map<string, MockTokenExchange>()
  const mockRefresh = new Map<string, MockRefresh>()

  /**
   * Create a VaultContextInstance for a specific provider
   */
  function createVaultInstance(provider: string): VaultContextInstance {
    return {
      /**
       * Get access token for this provider
       * Returns null if not connected or token is expired
       */
      async getToken(): Promise<string | null> {
        const creds = storage.credentials.get(provider)

        if (!isCredentialConnected(creds)) {
          return null
        }

        // For API key providers, return the API key
        if (creds!.tokenType === 'api_key') {
          return creds!.apiKey ?? null
        }

        return creds!.accessToken ?? null
      },

      /**
       * Get full credentials object for this provider
       * Returns a snapshot (deep copy) to prevent mutations
       */
      async getCredentials(): Promise<VaultCredentials | null> {
        const creds = storage.credentials.get(provider)

        if (!creds) {
          return null
        }

        // Return a deep copy to prevent mutations
        return cloneCredentials(creds)
      },

      /**
       * Check if this provider is connected with valid credentials
       */
      async isConnected(): Promise<boolean> {
        const creds = storage.credentials.get(provider)
        return isCredentialConnected(creds)
      },

      /**
       * Disconnect this provider (remove credentials)
       */
      async disconnect(): Promise<void> {
        storage.credentials.delete(provider)
      },

      /**
       * Force token refresh for this provider
       * Throws if not connected, no refresh token, or API key provider
       */
      async refresh(): Promise<void> {
        const creds = storage.credentials.get(provider)

        if (!creds) {
          throw new Error(`Provider '${provider}' is not connected`)
        }

        // API key providers can't be refreshed
        if (creds.tokenType === 'api_key') {
          throw new Error(`Provider '${provider}' uses API key authentication and cannot be refreshed`)
        }

        // Check for refresh token
        if (!creds.refreshToken) {
          throw new Error(`Provider '${provider}' has no refresh token`)
        }

        // Get mock refresh response
        const mockResponse = mockRefresh.get(provider)
        if (!mockResponse) {
          throw new Error(`No mock refresh response configured for '${provider}'`)
        }

        // Update credentials with refreshed token
        const now = new Date()
        creds.accessToken = mockResponse.accessToken
        creds.expiresAt = new Date(now.getTime() + mockResponse.expiresIn * 1000)
        creds.updatedAt = now

        storage.credentials.set(provider, creds)
      },
    }
  }

  /**
   * Vaults collection API
   */
  const vaultsCollection: VaultsCollection = {
    /**
     * List all connected providers with valid credentials
     */
    async list(): Promise<string[]> {
      const connected: string[] = []

      for (const [provider, creds] of storage.credentials.entries()) {
        if (isCredentialConnected(creds)) {
          connected.push(provider)
        }
      }

      return connected
    },

    /**
     * Initiate OAuth connection or store API key
     */
    async connect(provider: string, config: ConnectConfig): Promise<ConnectResult> {
      const providerConfig = providerConfigs.get(provider)

      if (!providerConfig) {
        throw new Error(`Provider '${provider}' is not configured`)
      }

      // Handle API key providers
      if (providerConfig.type === 'api_key') {
        if (!config.apiKey) {
          throw new Error(`API key is required for provider '${provider}'`)
        }

        // Validate key if validator is provided
        if (providerConfig.validateKey && !providerConfig.validateKey(config.apiKey)) {
          throw new Error(`Invalid API key format for provider '${provider}'`)
        }

        // Extract metadata if extractor is provided
        const metadata = providerConfig.extractMetadata
          ? providerConfig.extractMetadata(config.apiKey)
          : undefined

        // Store credentials
        const now = new Date()
        storage.credentials.set(provider, {
          provider,
          apiKey: config.apiKey,
          tokenType: 'api_key',
          createdAt: now,
          updatedAt: now,
          metadata,
        })

        return { connected: true }
      }

      // Handle OAuth providers
      if (!config.redirectUri) {
        throw new Error(`redirectUri is required for OAuth provider '${provider}'`)
      }

      // Generate state for CSRF protection
      const state = generateState()

      // Build authorization URL
      const authorizationUrl = buildAuthorizationUrl(
        providerConfig,
        config.redirectUri,
        state,
        config.scopes
      )

      // Store pending OAuth state
      const now = new Date()
      storage.pendingOAuth.set(state, {
        provider,
        redirectUri: config.redirectUri,
        createdAt: now,
        expiresAt: new Date(now.getTime() + OAUTH_STATE_EXPIRATION_MS),
      })

      return {
        authorizationUrl,
        state,
      }
    },

    /**
     * Handle OAuth callback and exchange code for tokens
     */
    async getCallback(provider: string, params: CallbackParams): Promise<CallbackResult> {
      // Check for OAuth error
      if (params.error) {
        throw new Error(`OAuth error: ${params.error}${params.error_description ? ` - ${params.error_description}` : ''}`)
      }

      // Validate state
      if (!params.state) {
        throw new Error('Invalid OAuth callback: missing state parameter')
      }

      const pendingOAuth = storage.pendingOAuth.get(params.state)

      if (!pendingOAuth) {
        throw new Error('Invalid OAuth callback: state not found')
      }

      // Check state expiration
      if (pendingOAuth.expiresAt && pendingOAuth.expiresAt.getTime() < Date.now()) {
        storage.pendingOAuth.delete(params.state)
        throw new Error('OAuth state expired')
      }

      // Verify provider matches
      if (pendingOAuth.provider !== provider) {
        throw new Error(`OAuth state mismatch: expected ${pendingOAuth.provider}, got ${provider}`)
      }

      // Get provider config
      const providerConfig = providerConfigs.get(provider)

      if (!providerConfig || providerConfig.type !== 'oauth') {
        throw new Error(`Provider '${provider}' is not configured for OAuth`)
      }

      // Get mock token exchange response
      const mockResponse = mockTokenExchange.get(provider)
      if (!mockResponse) {
        throw new Error(`No mock token exchange response configured for '${provider}'`)
      }

      // Parse token response (use custom parser if provided)
      let accessToken: string
      let tokenType: string
      let expiresIn: number | undefined
      let refreshToken: string | undefined

      if (providerConfig.parseTokenResponse) {
        const parsed = providerConfig.parseTokenResponse(mockResponse as Record<string, unknown>)
        accessToken = parsed.accessToken
        tokenType = parsed.tokenType
        expiresIn = parsed.expiresIn
        refreshToken = parsed.refreshToken
      } else {
        accessToken = mockResponse.access_token!
        tokenType = mockResponse.token_type ?? 'bearer'
        expiresIn = mockResponse.expires_in
        refreshToken = mockResponse.refresh_token
      }

      // Store credentials
      const now = new Date()
      storage.credentials.set(provider, {
        provider,
        accessToken,
        refreshToken,
        tokenType: 'bearer',
        scope: mockResponse.scope,
        expiresAt: expiresIn ? new Date(now.getTime() + expiresIn * 1000) : undefined,
        createdAt: now,
        updatedAt: now,
      })

      // Clean up pending OAuth state
      storage.pendingOAuth.delete(params.state)

      return { success: true }
    },
  }

  return {
    vault: createVaultInstance,
    vaults: vaultsCollection,
    _storage: storage,
    _providerConfigs: providerConfigs,
    _mockTokenExchange: mockTokenExchange,
    _mockRefresh: mockRefresh,
  }
}
