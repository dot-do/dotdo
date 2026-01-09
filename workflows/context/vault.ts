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
// CONTEXT FACTORY (STUB - Will cause tests to fail)
// ============================================================================

/**
 * Creates a mock workflow context ($) with vault support for testing
 *
 * RED PHASE: This is a stub implementation that will cause tests to fail.
 * The GREEN phase will implement the actual logic.
 *
 * @returns A VaultContext object with vault API methods
 */
export function createMockContext(): VaultContext {
  throw new Error('createMockContext not implemented - RED phase')
}
