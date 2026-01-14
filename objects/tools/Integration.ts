/**
 * Integration DO - External service integration
 *
 * A Durable Object that manages connections to external services
 * like Stripe, GitHub, Slack, etc. Handles OAuth, API keys, and
 * connection lifecycle management.
 *
 * @see https://schema.org.ai/Integration
 * @see digital-tools package for type definitions
 */

import { DO, type Env } from '../core/DO'
import type { Integration as IntegrationType } from '@dotdo/digital-tools'
import { createIntegration } from '@dotdo/digital-tools'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Authentication type for the integration
 */
export type AuthType = 'oauth' | 'api_key' | 'bearer' | 'none'

/**
 * Connection status for the integration
 */
export type ConnectionStatus = 'connected' | 'disconnected' | 'error' | 'pending'

/**
 * Integration configuration stored in the DO
 */
export interface IntegrationConfig {
  name: string
  description: string
  provider: string
  authType: AuthType
  baseUrl?: string
  // OAuth specific
  clientId?: string
  scopes?: string[]
  // API Key specific
  apiKeyHeader?: string
  // Connection state
  status: ConnectionStatus
  connectedAt?: Date
  disconnectedAt?: Date
  lastError?: string
  // Metadata
  createdAt: Date
  updatedAt: Date
}

/**
 * Credentials stored securely (encrypted at rest)
 */
export interface IntegrationCredentials {
  accessToken?: string
  refreshToken?: string
  apiKey?: string
  expiresAt?: number
}

/**
 * OAuth token response
 */
export interface OAuthTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
  scope?: string
}

/**
 * Connection options
 */
export interface ConnectOptions {
  credentials?: Partial<IntegrationCredentials>
  oauthCode?: string
  redirectUri?: string
}

// ============================================================================
// INTEGRATION DO
// ============================================================================

export class Integration extends DO {
  static override readonly $type = 'Integration'

  // Configuration cache
  private _config?: IntegrationConfig
  private _credentials?: IntegrationCredentials

  // ═══════════════════════════════════════════════════════════════════════════
  // INTEGRATION ACCESSORS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get the integration as an Integration type
   */
  async getIntegration(): Promise<IntegrationType | null> {
    const config = await this.getConfig()
    if (!config) {
      return null
    }

    return createIntegration({
      $id: this.ns,
      name: config.name,
      description: config.description,
      provider: config.provider,
      authType: config.authType,
      baseUrl: config.baseUrl,
    })
  }

  /**
   * Get the integration configuration
   */
  async getConfig(): Promise<IntegrationConfig | null> {
    if (this._config) {
      return this._config
    }

    const config = await this.ctx.storage.get<IntegrationConfig>('config')
    if (config) {
      this._config = config
    }
    return config ?? null
  }

  /**
   * Configure the integration
   */
  async configure(config: Partial<IntegrationConfig>): Promise<IntegrationConfig> {
    const existing = await this.getConfig()

    const updated: IntegrationConfig = {
      name: config.name ?? existing?.name ?? 'Unnamed Integration',
      description: config.description ?? existing?.description ?? '',
      provider: config.provider ?? existing?.provider ?? '',
      authType: config.authType ?? existing?.authType ?? 'none',
      baseUrl: config.baseUrl ?? existing?.baseUrl,
      clientId: config.clientId ?? existing?.clientId,
      scopes: config.scopes ?? existing?.scopes,
      apiKeyHeader: config.apiKeyHeader ?? existing?.apiKeyHeader,
      status: existing?.status ?? 'disconnected',
      connectedAt: existing?.connectedAt,
      disconnectedAt: existing?.disconnectedAt,
      lastError: existing?.lastError,
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: new Date(),
    }

    await this.ctx.storage.put('config', updated)
    this._config = updated

    // Emit configuration event
    await this.emitEvent('Integration.configured', { config: updated })

    return updated
  }

  /**
   * Create a new integration (initialization)
   */
  async createIntegration(config: Omit<IntegrationConfig, 'status' | 'createdAt' | 'updatedAt'>): Promise<IntegrationConfig> {
    const existing = await this.getConfig()
    if (existing) {
      throw new Error('Integration already exists. Use configure() to modify.')
    }

    const integrationConfig: IntegrationConfig = {
      ...config,
      status: 'disconnected',
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    await this.ctx.storage.put('config', integrationConfig)
    this._config = integrationConfig

    // Emit creation event
    await this.emitEvent('Integration.created', { config: integrationConfig })

    return integrationConfig
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONNECTION MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Connect to the external service
   */
  async connect(options?: ConnectOptions): Promise<void> {
    const config = await this.getConfig()
    if (!config) {
      throw new Error('Integration not configured')
    }

    try {
      let credentials: IntegrationCredentials = {}

      switch (config.authType) {
        case 'oauth':
          if (options?.oauthCode) {
            // Exchange OAuth code for tokens
            credentials = await this.exchangeOAuthCode(config, options.oauthCode, options.redirectUri)
          } else if (options?.credentials?.accessToken) {
            credentials = {
              accessToken: options.credentials.accessToken,
              refreshToken: options.credentials.refreshToken,
              expiresAt: options.credentials.expiresAt,
            }
          } else {
            throw new Error('OAuth code or access token required for OAuth authentication')
          }
          break

        case 'api_key':
          if (!options?.credentials?.apiKey) {
            throw new Error('API key required for API key authentication')
          }
          credentials = { apiKey: options.credentials.apiKey }
          break

        case 'bearer':
          if (!options?.credentials?.accessToken) {
            throw new Error('Access token required for bearer authentication')
          }
          credentials = { accessToken: options.credentials.accessToken }
          break

        case 'none':
          // No credentials needed
          break

        default:
          throw new Error(`Unsupported auth type: ${config.authType}`)
      }

      // Store credentials securely
      await this.ctx.storage.put('credentials', credentials)
      this._credentials = credentials

      // Update connection status
      const updatedConfig: IntegrationConfig = {
        ...config,
        status: 'connected',
        connectedAt: new Date(),
        lastError: undefined,
        updatedAt: new Date(),
      }
      await this.ctx.storage.put('config', updatedConfig)
      this._config = updatedConfig

      // Emit connection event
      await this.emitEvent('Integration.connected', { provider: config.provider })

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      // Update with error status
      const updatedConfig: IntegrationConfig = {
        ...config,
        status: 'error',
        lastError: errorMessage,
        updatedAt: new Date(),
      }
      await this.ctx.storage.put('config', updatedConfig)
      this._config = updatedConfig

      throw error
    }
  }

  /**
   * Disconnect from the external service
   */
  async disconnect(): Promise<void> {
    const config = await this.getConfig()
    if (!config) {
      throw new Error('Integration not configured')
    }

    // Clear credentials
    await this.ctx.storage.delete('credentials')
    this._credentials = undefined

    // Update status
    const updatedConfig: IntegrationConfig = {
      ...config,
      status: 'disconnected',
      disconnectedAt: new Date(),
      updatedAt: new Date(),
    }
    await this.ctx.storage.put('config', updatedConfig)
    this._config = updatedConfig

    // Emit disconnection event
    await this.emitEvent('Integration.disconnected', { provider: config.provider })
  }

  /**
   * Check if the integration is connected
   */
  async isConnected(): Promise<boolean> {
    const config = await this.getConfig()
    if (!config || config.status !== 'connected') {
      return false
    }

    // For OAuth, check if token is expired
    if (config.authType === 'oauth') {
      const credentials = await this.getCredentials()
      if (credentials?.expiresAt && credentials.expiresAt < Date.now()) {
        // Try to refresh token
        if (credentials.refreshToken) {
          try {
            await this.refreshToken()
            return true
          } catch {
            return false
          }
        }
        return false
      }
    }

    return true
  }

  /**
   * Get connection status
   */
  async getStatus(): Promise<ConnectionStatus> {
    const config = await this.getConfig()
    return config?.status ?? 'disconnected'
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CREDENTIALS MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get stored credentials (for internal use only)
   */
  protected async getCredentials(): Promise<IntegrationCredentials | null> {
    if (this._credentials) {
      return this._credentials
    }

    const credentials = await this.ctx.storage.get<IntegrationCredentials>('credentials')
    if (credentials) {
      this._credentials = credentials
    }
    return credentials ?? null
  }

  /**
   * Get an authorization header for API requests
   */
  async getAuthHeader(): Promise<string | null> {
    const config = await this.getConfig()
    if (!config) {
      return null
    }

    const credentials = await this.getCredentials()
    if (!credentials) {
      return null
    }

    switch (config.authType) {
      case 'oauth':
      case 'bearer':
        return credentials.accessToken ? `Bearer ${credentials.accessToken}` : null

      case 'api_key':
        // API key is typically sent in a custom header, not Authorization
        return credentials.apiKey ?? null

      case 'none':
      default:
        return null
    }
  }

  /**
   * Exchange OAuth code for tokens
   */
  private async exchangeOAuthCode(
    config: IntegrationConfig,
    code: string,
    redirectUri?: string
  ): Promise<IntegrationCredentials> {
    // This would typically make a request to the OAuth provider's token endpoint
    // For now, we'll throw an error indicating subclasses should implement this
    throw new Error(
      `OAuth code exchange not implemented for provider: ${config.provider}. ` +
      'Subclasses should override exchangeOAuthCode() or pass credentials directly.'
    )
  }

  /**
   * Refresh an OAuth token
   */
  private async refreshToken(): Promise<void> {
    const config = await this.getConfig()
    const credentials = await this.getCredentials()

    if (!config || !credentials?.refreshToken) {
      throw new Error('Cannot refresh token: no refresh token available')
    }

    // This would typically make a request to refresh the token
    // For now, we mark the integration as needing reconnection
    const updatedConfig: IntegrationConfig = {
      ...config,
      status: 'error',
      lastError: 'Token expired, reconnection required',
      updatedAt: new Date(),
    }
    await this.ctx.storage.put('config', updatedConfig)
    this._config = updatedConfig

    throw new Error('Token refresh not implemented. Please reconnect.')
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HTTP HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  protected override async handleFetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const method = request.method

    try {
      // GET / - Get integration definition
      if (method === 'GET' && url.pathname === '/') {
        const integration = await this.getIntegration()
        if (!integration) {
          return Response.json({ error: 'Integration not found' }, { status: 404 })
        }

        // Include connection status
        const config = await this.getConfig()
        return Response.json({
          ...integration,
          status: config?.status ?? 'disconnected',
          connectedAt: config?.connectedAt,
          disconnectedAt: config?.disconnectedAt,
        })
      }

      // POST / - Create integration
      if (method === 'POST' && url.pathname === '/') {
        const body = await request.json() as Omit<IntegrationConfig, 'status' | 'createdAt' | 'updatedAt'>
        const created = await this.createIntegration(body)
        return Response.json(created, { status: 201 })
      }

      // PUT /config - Update configuration
      if (method === 'PUT' && url.pathname === '/config') {
        const body = await request.json() as Partial<IntegrationConfig>
        const updated = await this.configure(body)
        return Response.json(updated)
      }

      // GET /config - Get full configuration
      if (method === 'GET' && url.pathname === '/config') {
        const config = await this.getConfig()
        if (!config) {
          return Response.json({ error: 'Integration not configured' }, { status: 404 })
        }
        // Don't expose client secrets
        const safeConfig = {
          ...config,
          clientId: config.clientId ? '***' : undefined,
        }
        return Response.json(safeConfig)
      }

      // POST /connect - Connect to external service
      if (method === 'POST' && url.pathname === '/connect') {
        const body = await request.json() as ConnectOptions
        await this.connect(body)
        return Response.json({ success: true, status: 'connected' })
      }

      // POST /disconnect - Disconnect from external service
      if (method === 'POST' && url.pathname === '/disconnect') {
        await this.disconnect()
        return Response.json({ success: true, status: 'disconnected' })
      }

      // GET /status - Get connection status
      if (method === 'GET' && url.pathname === '/status') {
        const connected = await this.isConnected()
        const status = await this.getStatus()
        const config = await this.getConfig()
        return Response.json({
          connected,
          status,
          provider: config?.provider,
          connectedAt: config?.connectedAt,
          lastError: config?.lastError,
        })
      }

      // Health check
      if (url.pathname === '/health') {
        const config = await this.getConfig()
        return Response.json({
          status: 'ok',
          ns: this.ns,
          $type: this.$type,
          provider: config?.provider,
          connectionStatus: config?.status ?? 'disconnected',
        })
      }

      return new Response('Not Found', { status: 404 })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return Response.json({ error: message }, { status: 400 })
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENT EMISSION HELPER
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Emit an event (wrapper for $.send-like functionality)
   */
  private async emitEvent(verb: string, data: unknown): Promise<void> {
    try {
      // Use the events store if available
      if (this.events) {
        await this.events.emit({
          verb,
          source: this.ns,
          data: data as Record<string, unknown>,
        })
      }
    } catch {
      // Best-effort event emission
    }
  }
}

export default Integration
