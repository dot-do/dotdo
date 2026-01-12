/**
 * Zapier Authentication Handlers
 *
 * Implements OAuth2, API Key, Session, Basic, and Custom authentication.
 */

import type {
  AuthenticationConfig,
  Bundle,
  ZObject,
  InputField,
  OAuth2Config,
  SessionConfig,
} from './types'

// ============================================================================
// AUTHENTICATION CLASS
// ============================================================================

/**
 * Authentication handler for Zapier apps
 */
export class Authentication {
  readonly type: AuthenticationConfig['type']
  readonly config: AuthenticationConfig

  constructor(config: AuthenticationConfig) {
    this.type = config.type
    this.config = config
  }

  /**
   * Get authentication input fields
   */
  getFields(): InputField[] {
    return this.config.fields || []
  }

  /**
   * Build OAuth2 authorization URL
   */
  getAuthorizeUrl(params: Record<string, string>): string {
    if (this.type !== 'oauth2' || !this.config.oauth2Config) {
      throw new Error('getAuthorizeUrl only available for OAuth2 authentication')
    }

    const oauth2Config = this.config.oauth2Config
    let baseUrl: string

    if (typeof oauth2Config.authorizeUrl === 'string') {
      baseUrl = oauth2Config.authorizeUrl
    } else {
      throw new Error(
        'Dynamic authorizeUrl requires z and bundle - use getAuthorizeUrlAsync instead'
      )
    }

    const url = new URL(baseUrl)

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }

    if (oauth2Config.scope) {
      url.searchParams.set('scope', oauth2Config.scope)
    }

    return url.toString()
  }

  /**
   * Build OAuth2 authorization URL with dynamic URL support
   */
  async getAuthorizeUrlAsync(
    z: ZObject,
    bundle: Bundle,
    params: Record<string, string>
  ): Promise<string> {
    if (this.type !== 'oauth2' || !this.config.oauth2Config) {
      throw new Error(
        'getAuthorizeUrlAsync only available for OAuth2 authentication'
      )
    }

    const oauth2Config = this.config.oauth2Config
    let baseUrl: string

    if (typeof oauth2Config.authorizeUrl === 'string') {
      baseUrl = oauth2Config.authorizeUrl
    } else {
      baseUrl = oauth2Config.authorizeUrl(z, bundle)
    }

    const url = new URL(baseUrl)

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value)
    }

    if (oauth2Config.scope) {
      url.searchParams.set('scope', oauth2Config.scope)
    }

    // Add PKCE code challenge if enabled
    if (oauth2Config.enablePkce && params.code_challenge) {
      url.searchParams.set('code_challenge', params.code_challenge)
      url.searchParams.set('code_challenge_method', 'S256')
    }

    return url.toString()
  }

  /**
   * Exchange authorization code for access token
   */
  async getAccessToken(
    z: ZObject,
    bundle: Bundle
  ): Promise<{ access_token: string; refresh_token?: string; expires_in?: number; [key: string]: unknown }> {
    if (this.type !== 'oauth2' || !this.config.oauth2Config) {
      throw new Error('getAccessToken only available for OAuth2 authentication')
    }

    return this.config.oauth2Config.getAccessToken(z, bundle)
  }

  /**
   * Refresh an expired access token
   */
  async refreshAccessToken(
    z: ZObject,
    bundle: Bundle
  ): Promise<{ access_token: string; expires_in?: number; [key: string]: unknown }> {
    if (this.type !== 'oauth2' || !this.config.oauth2Config) {
      throw new Error(
        'refreshAccessToken only available for OAuth2 authentication'
      )
    }

    if (!this.config.oauth2Config.refreshAccessToken) {
      throw new Error('refreshAccessToken not configured')
    }

    return this.config.oauth2Config.refreshAccessToken(z, bundle)
  }

  /**
   * Test authentication credentials
   */
  async test(z: ZObject, bundle: Bundle): Promise<unknown> {
    return this.config.test(z, bundle)
  }

  /**
   * Get session credentials (for session auth)
   */
  async getSession(
    z: ZObject,
    bundle: Bundle
  ): Promise<{ sessionKey: string; [key: string]: unknown }> {
    if (this.type !== 'session' || !this.config.sessionConfig) {
      throw new Error('getSession only available for session authentication')
    }

    return this.config.sessionConfig.perform(z, bundle)
  }

  /**
   * Get connection label for display
   */
  async getConnectionLabel(z: ZObject, bundle: Bundle): Promise<string> {
    if (!this.config.connectionLabel) {
      return 'Connected'
    }

    if (typeof this.config.connectionLabel === 'string') {
      return this.config.connectionLabel
    }

    return this.config.connectionLabel(z, bundle)
  }

  /**
   * Check if token is expired based on expires_in
   */
  isTokenExpired(authData: Record<string, unknown>): boolean {
    const expiresAt = authData.expires_at as number | undefined
    const expiresIn = authData.expires_in as number | undefined
    const tokenReceivedAt = authData.token_received_at as number | undefined

    if (expiresAt) {
      // Use expires_at timestamp directly
      return Date.now() >= expiresAt
    }

    if (expiresIn && tokenReceivedAt) {
      // Calculate from expires_in + received timestamp
      const expirationTime = tokenReceivedAt + expiresIn * 1000
      return Date.now() >= expirationTime
    }

    // Can't determine expiration, assume not expired
    return false
  }

  /**
   * Should auto-refresh the token
   */
  shouldAutoRefresh(): boolean {
    if (this.type !== 'oauth2' || !this.config.oauth2Config) {
      return false
    }

    return this.config.oauth2Config.autoRefresh !== false
  }
}

// ============================================================================
// AUTH HELPER FUNCTIONS
// ============================================================================

/**
 * Create Basic auth header value
 */
export function createBasicAuthHeader(
  username: string,
  password: string
): string {
  const credentials = `${username}:${password}`
  const encoded = btoa(credentials)
  return `Basic ${encoded}`
}

/**
 * Create Bearer auth header value
 */
export function createBearerAuthHeader(token: string): string {
  return `Bearer ${token}`
}

/**
 * Generate PKCE code verifier
 */
export function generateCodeVerifier(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return base64UrlEncode(array)
}

/**
 * Generate PKCE code challenge from verifier
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return base64UrlEncode(new Uint8Array(digest))
}

/**
 * Base64 URL encode
 */
function base64UrlEncode(buffer: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...buffer))
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// ============================================================================
// AUTH MIDDLEWARE
// ============================================================================

/**
 * Create middleware that adds authentication to requests
 */
export function createAuthMiddleware(auth: Authentication) {
  return async (
    request: { url: string; headers?: Record<string, string>; [key: string]: unknown },
    z: ZObject,
    bundle: Bundle
  ) => {
    const headers = { ...request.headers }

    switch (auth.type) {
      case 'api_key': {
        const apiKey = bundle.authData.api_key as string
        if (apiKey) {
          headers['Authorization'] = createBearerAuthHeader(apiKey)
        }
        break
      }

      case 'basic': {
        const username = bundle.authData.username as string
        const password = bundle.authData.password as string
        if (username && password) {
          headers['Authorization'] = createBasicAuthHeader(username, password)
        }
        break
      }

      case 'oauth2': {
        const accessToken = bundle.authData.access_token as string
        if (accessToken) {
          headers['Authorization'] = createBearerAuthHeader(accessToken)
        }
        break
      }

      case 'session': {
        const sessionKey = bundle.authData.sessionKey as string
        if (sessionKey) {
          headers['X-Session-Key'] = sessionKey
        }
        break
      }

      case 'custom': {
        if (auth.config.customConfig?.perform) {
          const customAuth = await auth.config.customConfig.perform(z, bundle)
          Object.assign(headers, customAuth)
        }
        break
      }
    }

    return { ...request, headers }
  }
}

// ============================================================================
// OAUTH2 HELPER CLASS
// ============================================================================

/**
 * OAuth2 flow helper
 */
export class OAuth2Flow {
  private config: OAuth2Config
  private codeVerifier?: string

  constructor(config: OAuth2Config) {
    this.config = config
  }

  /**
   * Start authorization flow
   */
  async startAuthorization(params: {
    clientId: string
    redirectUri: string
    state: string
    scope?: string
  }): Promise<{ url: string; codeVerifier?: string }> {
    const urlParams: Record<string, string> = {
      client_id: params.clientId,
      redirect_uri: params.redirectUri,
      state: params.state,
      response_type: 'code',
    }

    if (params.scope || this.config.scope) {
      urlParams.scope = params.scope || this.config.scope!
    }

    // Generate PKCE if enabled
    if (this.config.enablePkce) {
      this.codeVerifier = generateCodeVerifier()
      urlParams.code_challenge = await generateCodeChallenge(this.codeVerifier)
      urlParams.code_challenge_method = 'S256'
    }

    const baseUrl =
      typeof this.config.authorizeUrl === 'string'
        ? this.config.authorizeUrl
        : this.config.authorizeUrl({} as ZObject, {} as Bundle)

    const url = new URL(baseUrl)
    for (const [key, value] of Object.entries(urlParams)) {
      url.searchParams.set(key, value)
    }

    return {
      url: url.toString(),
      codeVerifier: this.codeVerifier,
    }
  }

  /**
   * Get code verifier for PKCE
   */
  getCodeVerifier(): string | undefined {
    return this.codeVerifier
  }
}

// ============================================================================
// SESSION AUTH HELPER
// ============================================================================

/**
 * Session auth flow helper
 */
export class SessionAuthFlow {
  private config: SessionConfig
  private sessionKey?: string
  private sessionData?: Record<string, unknown>

  constructor(config: SessionConfig) {
    this.config = config
  }

  /**
   * Acquire session credentials
   */
  async acquireSession(z: ZObject, bundle: Bundle): Promise<void> {
    const result = await this.config.perform(z, bundle)
    this.sessionKey = result.sessionKey
    this.sessionData = result
  }

  /**
   * Get current session key
   */
  getSessionKey(): string | undefined {
    return this.sessionKey
  }

  /**
   * Get all session data
   */
  getSessionData(): Record<string, unknown> | undefined {
    return this.sessionData
  }

  /**
   * Clear session
   */
  clearSession(): void {
    this.sessionKey = undefined
    this.sessionData = undefined
  }
}
