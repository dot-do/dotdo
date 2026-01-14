/**
 * @dotdo/auth - OAuth 2.0 Flows
 *
 * OAuth 2.0 / OpenID Connect implementation for authorization flows.
 * Supports Authorization Code, PKCE, Client Credentials, and Implicit flows.
 *
 * @module
 */

import { createTemporalStore, type TemporalStore } from '../../../db/primitives/temporal-store'
import type {
  OAuthProvider,
  OAuthAuthorizationRequest,
  OAuthTokenRequest,
  OAuthTokenResponse,
  TokenPair,
} from './types'
import { AuthenticationError } from './types'
import { createJWT, verifyJWT, type JWTCreateOptions } from './jwt'

// ============================================================================
// OAUTH MANAGER OPTIONS
// ============================================================================

/**
 * OAuth manager configuration
 */
export interface OAuthManagerOptions {
  /** JWT signing secret */
  jwtSecret: string
  /** JWT algorithm */
  jwtAlgorithm?: 'HS256' | 'RS256' | 'ES256'
  /** Authorization code TTL in seconds (default: 600 = 10 minutes) */
  authCodeTTL?: number
  /** Access token TTL in seconds (default: 3600 = 1 hour) */
  accessTokenTTL?: number
  /** Refresh token TTL in seconds (default: 604800 = 7 days) */
  refreshTokenTTL?: number
  /** ID token TTL in seconds (default: 3600 = 1 hour) */
  idTokenTTL?: number
  /** Issuer URL */
  issuer?: string
}

/**
 * Authorization code data
 */
interface AuthorizationCode {
  code: string
  client_id: string
  user_id: string
  redirect_uri: string
  scope: string
  state?: string
  nonce?: string
  code_challenge?: string
  code_challenge_method?: 'plain' | 'S256'
  expires_at: string
}

/**
 * OAuth client
 */
export interface OAuthClient {
  id: string
  secret?: string
  name: string
  redirect_uris: string[]
  allowed_grant_types: ('authorization_code' | 'refresh_token' | 'client_credentials' | 'implicit')[]
  allowed_scopes: string[]
  is_first_party: boolean
  created_at: string
  updated_at: string
}

// ============================================================================
// PKCE UTILITIES
// ============================================================================

/**
 * Generate a code verifier for PKCE
 */
export function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return base64UrlEncode(bytes)
}

/**
 * Generate a code challenge from a verifier
 */
export async function generateCodeChallenge(verifier: string, method: 'plain' | 'S256' = 'S256'): Promise<string> {
  if (method === 'plain') {
    return verifier
  }

  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return base64UrlEncode(new Uint8Array(hash))
}

/**
 * Verify a code challenge
 */
async function verifyCodeChallenge(verifier: string, challenge: string, method: 'plain' | 'S256'): Promise<boolean> {
  const expectedChallenge = await generateCodeChallenge(verifier, method)
  return constantTimeCompare(expectedChallenge, challenge)
}

/**
 * Base64URL encode
 */
function base64UrlEncode(data: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...data))
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Constant-time string comparison
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false

  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

// ============================================================================
// OAUTH MANAGER
// ============================================================================

/**
 * OAuth manager for handling OAuth 2.0 flows
 */
export class OAuthManager {
  private options: Required<OAuthManagerOptions>
  private clientStore: TemporalStore<OAuthClient>
  private authCodeStore: TemporalStore<AuthorizationCode>
  private refreshTokenStore: TemporalStore<{ user_id: string; client_id: string; scope: string; expires_at: string }>
  private providerStore: TemporalStore<OAuthProvider>

  constructor(options: OAuthManagerOptions) {
    this.options = {
      jwtSecret: options.jwtSecret,
      jwtAlgorithm: options.jwtAlgorithm ?? 'HS256',
      authCodeTTL: options.authCodeTTL ?? 600,
      accessTokenTTL: options.accessTokenTTL ?? 3600,
      refreshTokenTTL: options.refreshTokenTTL ?? 604800,
      idTokenTTL: options.idTokenTTL ?? 3600,
      issuer: options.issuer ?? '',
    }

    this.clientStore = createTemporalStore<OAuthClient>()
    this.authCodeStore = createTemporalStore<AuthorizationCode>({ enableTTL: true })
    this.refreshTokenStore = createTemporalStore<{ user_id: string; client_id: string; scope: string; expires_at: string }>({
      enableTTL: true,
    })
    this.providerStore = createTemporalStore<OAuthProvider>()
  }

  // ============================================================================
  // CLIENT MANAGEMENT
  // ============================================================================

  /**
   * Register an OAuth client
   */
  async registerClient(params: Omit<OAuthClient, 'id' | 'created_at' | 'updated_at'>): Promise<OAuthClient> {
    const clientId = this.generateId('client')
    const now = new Date().toISOString()

    const client: OAuthClient = {
      id: clientId,
      ...params,
      created_at: now,
      updated_at: now,
    }

    await this.clientStore.put(`client:${clientId}`, client, Date.now())

    return client
  }

  /**
   * Get a client by ID
   */
  async getClient(clientId: string): Promise<OAuthClient | null> {
    return this.clientStore.get(`client:${clientId}`)
  }

  /**
   * Validate client credentials
   */
  async validateClient(clientId: string, clientSecret?: string): Promise<OAuthClient | null> {
    const client = await this.clientStore.get(`client:${clientId}`)
    if (!client) return null

    // Public clients don't require a secret
    if (!client.secret) return client

    // Confidential clients require secret validation
    if (!clientSecret || !constantTimeCompare(clientSecret, client.secret)) {
      return null
    }

    return client
  }

  // ============================================================================
  // AUTHORIZATION CODE FLOW
  // ============================================================================

  /**
   * Create an authorization URL
   */
  createAuthorizationUrl(params: OAuthAuthorizationRequest & { baseUrl: string }): string {
    const url = new URL('/authorize', params.baseUrl)

    url.searchParams.set('client_id', params.client_id)
    url.searchParams.set('redirect_uri', params.redirect_uri)
    url.searchParams.set('response_type', params.response_type)
    url.searchParams.set('scope', params.scope)

    if (params.state) url.searchParams.set('state', params.state)
    if (params.nonce) url.searchParams.set('nonce', params.nonce)
    if (params.code_challenge) url.searchParams.set('code_challenge', params.code_challenge)
    if (params.code_challenge_method) url.searchParams.set('code_challenge_method', params.code_challenge_method)
    if (params.prompt) url.searchParams.set('prompt', params.prompt)

    return url.toString()
  }

  /**
   * Validate an authorization request
   */
  async validateAuthorizationRequest(params: OAuthAuthorizationRequest): Promise<{ valid: boolean; error?: string; client?: OAuthClient }> {
    const client = await this.clientStore.get(`client:${params.client_id}`)
    if (!client) {
      return { valid: false, error: 'invalid_client' }
    }

    // Validate redirect URI
    if (!client.redirect_uris.includes(params.redirect_uri)) {
      return { valid: false, error: 'invalid_redirect_uri' }
    }

    // Validate response type
    const responseTypes = params.response_type.split(' ')
    for (const type of responseTypes) {
      if (type === 'code' && !client.allowed_grant_types.includes('authorization_code')) {
        return { valid: false, error: 'unauthorized_response_type' }
      }
      if ((type === 'token' || type === 'id_token') && !client.allowed_grant_types.includes('implicit')) {
        return { valid: false, error: 'unauthorized_response_type' }
      }
    }

    // Validate scopes
    const requestedScopes = params.scope.split(' ')
    for (const scope of requestedScopes) {
      if (!client.allowed_scopes.includes(scope)) {
        return { valid: false, error: 'invalid_scope' }
      }
    }

    return { valid: true, client }
  }

  /**
   * Generate an authorization code
   */
  async generateAuthorizationCode(
    clientId: string,
    userId: string,
    redirectUri: string,
    scope: string,
    options?: {
      state?: string
      nonce?: string
      codeChallenge?: string
      codeChallengeMethod?: 'plain' | 'S256'
    }
  ): Promise<string> {
    const code = this.generateSecureCode()
    const expiresAt = new Date(Date.now() + this.options.authCodeTTL * 1000)

    const authCode: AuthorizationCode = {
      code,
      client_id: clientId,
      user_id: userId,
      redirect_uri: redirectUri,
      scope,
      state: options?.state,
      nonce: options?.nonce,
      code_challenge: options?.codeChallenge,
      code_challenge_method: options?.codeChallengeMethod,
      expires_at: expiresAt.toISOString(),
    }

    // Store with hash as key (code is returned to client)
    const codeHash = await this.hashCode(code)
    await this.authCodeStore.put(`authcode:${codeHash}`, authCode, Date.now(), {
      ttl: this.options.authCodeTTL * 1000,
    })

    return code
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeAuthorizationCode(
    code: string,
    clientId: string,
    redirectUri: string,
    codeVerifier?: string,
    user?: { id: string; email?: string; name?: string }
  ): Promise<OAuthTokenResponse> {
    const codeHash = await this.hashCode(code)
    const authCode = await this.authCodeStore.get(`authcode:${codeHash}`)

    if (!authCode) {
      throw new AuthenticationError('invalid_grant', 'Authorization code not found or expired')
    }

    // Validate client and redirect URI
    if (authCode.client_id !== clientId) {
      throw new AuthenticationError('invalid_grant', 'Client ID mismatch')
    }

    if (authCode.redirect_uri !== redirectUri) {
      throw new AuthenticationError('invalid_grant', 'Redirect URI mismatch')
    }

    // Check expiration
    if (new Date(authCode.expires_at) < new Date()) {
      throw new AuthenticationError('invalid_grant', 'Authorization code expired')
    }

    // Verify PKCE if used
    if (authCode.code_challenge) {
      if (!codeVerifier) {
        throw new AuthenticationError('invalid_grant', 'Code verifier required')
      }

      const isValid = await verifyCodeChallenge(codeVerifier, authCode.code_challenge, authCode.code_challenge_method ?? 'S256')

      if (!isValid) {
        throw new AuthenticationError('invalid_grant', 'Invalid code verifier')
      }
    }

    // Invalidate authorization code (one-time use)
    await this.authCodeStore.put(`authcode:${codeHash}`, null as unknown as AuthorizationCode, Date.now())

    // Generate tokens
    const tokens = await this.generateTokens(authCode.user_id, clientId, authCode.scope, authCode.nonce, user)

    return tokens
  }

  // ============================================================================
  // TOKEN OPERATIONS
  // ============================================================================

  /**
   * Handle a token request
   */
  async handleTokenRequest(
    request: OAuthTokenRequest,
    user?: { id: string; email?: string; name?: string }
  ): Promise<OAuthTokenResponse> {
    // Validate client
    const client = await this.validateClient(request.client_id, request.client_secret)
    if (!client) {
      throw new AuthenticationError('invalid_client', 'Client authentication failed')
    }

    switch (request.grant_type) {
      case 'authorization_code':
        if (!request.code || !request.redirect_uri) {
          throw new AuthenticationError('invalid_request', 'Missing code or redirect_uri')
        }
        return this.exchangeAuthorizationCode(request.code, request.client_id, request.redirect_uri, request.code_verifier, user)

      case 'refresh_token':
        if (!request.refresh_token) {
          throw new AuthenticationError('invalid_request', 'Missing refresh_token')
        }
        return this.refreshAccessToken(request.refresh_token, request.client_id, request.scope, user)

      case 'client_credentials':
        if (!client.allowed_grant_types.includes('client_credentials')) {
          throw new AuthenticationError('unauthorized_client', 'Client not authorized for client_credentials grant')
        }
        return this.clientCredentialsGrant(request.client_id, request.scope ?? '')

      default:
        throw new AuthenticationError('unsupported_grant_type', `Grant type ${request.grant_type} not supported`)
    }
  }

  /**
   * Generate access and refresh tokens
   */
  private async generateTokens(
    userId: string,
    clientId: string,
    scope: string,
    nonce?: string,
    user?: { id: string; email?: string; name?: string }
  ): Promise<OAuthTokenResponse> {
    const now = Date.now()

    // Access token
    const accessTokenOptions: JWTCreateOptions = {
      secret: this.options.jwtSecret,
      algorithm: this.options.jwtAlgorithm,
      issuer: this.options.issuer,
      audience: clientId,
      subject: userId,
      expiresIn: this.options.accessTokenTTL,
    }

    const accessTokenClaims = {
      scope,
      client_id: clientId,
    }

    const accessToken = await createJWT(accessTokenClaims, accessTokenOptions)

    // Refresh token (opaque)
    const refreshToken = this.generateSecureCode()
    const refreshTokenHash = await this.hashCode(refreshToken)

    await this.refreshTokenStore.put(
      `refresh:${refreshTokenHash}`,
      {
        user_id: userId,
        client_id: clientId,
        scope,
        expires_at: new Date(now + this.options.refreshTokenTTL * 1000).toISOString(),
      },
      now,
      { ttl: this.options.refreshTokenTTL * 1000 }
    )

    const response: OAuthTokenResponse = {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: this.options.accessTokenTTL,
      expires_at: Math.floor(now / 1000) + this.options.accessTokenTTL,
      scope,
    }

    // ID token (if openid scope)
    if (scope.split(' ').includes('openid')) {
      const idTokenOptions: JWTCreateOptions = {
        secret: this.options.jwtSecret,
        algorithm: this.options.jwtAlgorithm,
        issuer: this.options.issuer,
        audience: clientId,
        subject: userId,
        expiresIn: this.options.idTokenTTL,
      }

      const idTokenClaims: Record<string, unknown> = {
        auth_time: Math.floor(now / 1000),
      }

      if (nonce) idTokenClaims.nonce = nonce
      if (user?.email && scope.includes('email')) idTokenClaims.email = user.email
      if (user?.name && scope.includes('profile')) idTokenClaims.name = user.name

      response.id_token = await createJWT(idTokenClaims, idTokenOptions)
    }

    return response
  }

  /**
   * Refresh an access token
   */
  async refreshAccessToken(
    refreshToken: string,
    clientId: string,
    newScope?: string,
    user?: { id: string; email?: string; name?: string }
  ): Promise<OAuthTokenResponse> {
    const refreshTokenHash = await this.hashCode(refreshToken)
    const tokenData = await this.refreshTokenStore.get(`refresh:${refreshTokenHash}`)

    if (!tokenData) {
      throw new AuthenticationError('invalid_grant', 'Invalid refresh token')
    }

    // Validate client
    if (tokenData.client_id !== clientId) {
      throw new AuthenticationError('invalid_grant', 'Refresh token was not issued to this client')
    }

    // Check expiration
    if (new Date(tokenData.expires_at) < new Date()) {
      throw new AuthenticationError('invalid_grant', 'Refresh token expired')
    }

    // Validate scope (can only reduce, not expand)
    let scope = tokenData.scope
    if (newScope) {
      const originalScopes = new Set(tokenData.scope.split(' '))
      const requestedScopes = newScope.split(' ')
      const validScopes = requestedScopes.filter((s) => originalScopes.has(s))
      scope = validScopes.join(' ')
    }

    // Rotate refresh token
    await this.refreshTokenStore.put(`refresh:${refreshTokenHash}`, null as never, Date.now())

    // Generate new tokens
    return this.generateTokens(tokenData.user_id, clientId, scope, undefined, user)
  }

  /**
   * Client credentials grant (machine-to-machine)
   */
  private async clientCredentialsGrant(clientId: string, scope: string): Promise<OAuthTokenResponse> {
    const now = Date.now()

    const accessTokenOptions: JWTCreateOptions = {
      secret: this.options.jwtSecret,
      algorithm: this.options.jwtAlgorithm,
      issuer: this.options.issuer,
      audience: clientId,
      subject: clientId,
      expiresIn: this.options.accessTokenTTL,
    }

    const accessTokenClaims = {
      scope,
      client_id: clientId,
      gty: 'client-credentials',
    }

    const accessToken = await createJWT(accessTokenClaims, accessTokenOptions)

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: this.options.accessTokenTTL,
      expires_at: Math.floor(now / 1000) + this.options.accessTokenTTL,
      scope,
    }
  }

  /**
   * Revoke a token
   */
  async revokeToken(token: string, tokenType: 'access_token' | 'refresh_token'): Promise<void> {
    if (tokenType === 'refresh_token') {
      const tokenHash = await this.hashCode(token)
      await this.refreshTokenStore.put(`refresh:${tokenHash}`, null as never, Date.now())
    }
    // Access tokens are JWTs and can't be revoked without a blocklist
    // In production, implement a token blocklist for access token revocation
  }

  /**
   * Introspect a token
   */
  async introspectToken(token: string): Promise<{ active: boolean; [key: string]: unknown }> {
    // Try to verify as JWT (access token)
    const result = await verifyJWT(token, {
      secret: this.options.jwtSecret,
      algorithms: [this.options.jwtAlgorithm],
      issuer: this.options.issuer,
    })

    if (result.valid && result.claims) {
      return {
        active: true,
        sub: result.claims.sub,
        client_id: result.claims.client_id as string,
        scope: result.claims.scope as string,
        exp: result.claims.exp,
        iat: result.claims.iat,
        iss: result.claims.iss,
      }
    }

    // Try as refresh token
    const tokenHash = await this.hashCode(token)
    const refreshData = await this.refreshTokenStore.get(`refresh:${tokenHash}`)

    if (refreshData && new Date(refreshData.expires_at) > new Date()) {
      return {
        active: true,
        sub: refreshData.user_id,
        client_id: refreshData.client_id,
        scope: refreshData.scope,
        token_type: 'refresh_token',
      }
    }

    return { active: false }
  }

  // ============================================================================
  // PROVIDER MANAGEMENT (for social login)
  // ============================================================================

  /**
   * Register an OAuth provider
   */
  async registerProvider(provider: Omit<OAuthProvider, 'created_at' | 'updated_at'>): Promise<OAuthProvider> {
    const now = new Date().toISOString()

    const fullProvider: OAuthProvider = {
      ...provider,
      created_at: now,
      updated_at: now,
    }

    await this.providerStore.put(`provider:${provider.id}`, fullProvider, Date.now())

    return fullProvider
  }

  /**
   * Get a provider by ID
   */
  async getProvider(providerId: string): Promise<OAuthProvider | null> {
    return this.providerStore.get(`provider:${providerId}`)
  }

  /**
   * List all providers
   */
  async listProviders(): Promise<OAuthProvider[]> {
    // This is a simple implementation - in production you'd want proper listing
    // For now, return empty (would need to track provider IDs separately)
    return []
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  /**
   * Generate a unique ID
   */
  private generateId(prefix: string): string {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    return `${prefix}_${hex}`
  }

  /**
   * Generate a secure random code
   */
  private generateSecureCode(): string {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  /**
   * Hash a code
   */
  private async hashCode(code: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(code)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }
}

/**
 * Create an OAuth manager instance
 */
export function createOAuthManager(options: OAuthManagerOptions): OAuthManager {
  return new OAuthManager(options)
}
