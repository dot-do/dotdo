/**
 * @dotdo/auth - OAuth 2.0 Flows
 *
 * OAuth 2.0 / OpenID Connect implementation.
 *
 * @module
 */

import type { OAuthClient, OAuthAuthorizationRequest, OAuthTokenResponse, TokenPair, User, AuthConfig } from './types'
import { AuthError, AuthErrors } from './error'
import { IndexedStorage } from './storage'
import { createJWT, verifyJWT, type JWTCreateOptions } from './jwt'

// ============================================================================
// OAUTH TYPES
// ============================================================================

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

export interface RegisterClientParams {
  name: string
  secret?: string
  redirect_uris: string[]
  allowed_grant_types: ('authorization_code' | 'refresh_token' | 'client_credentials' | 'implicit')[]
  allowed_scopes: string[]
  is_first_party: boolean
}

// ============================================================================
// OAUTH MANAGER
// ============================================================================

export class OAuthManager {
  private storage: IndexedStorage
  private jwtSecret: string
  private jwtAlgorithm: 'HS256' | 'RS256' | 'ES256'
  private authCodeTTL: number
  private accessTokenTTL: number
  private refreshTokenTTL: number
  private idTokenTTL: number
  private issuer: string

  constructor(storage: IndexedStorage, config: AuthConfig) {
    this.storage = storage
    this.jwtSecret = config.jwtSecret
    this.jwtAlgorithm = config.jwtAlgorithm ?? 'HS256'
    this.authCodeTTL = 600
    this.accessTokenTTL = config.accessTokenTTL ?? 3600
    this.refreshTokenTTL = config.refreshTokenTTL ?? 604800
    this.idTokenTTL = config.idTokenTTL ?? 3600
    this.issuer = config.issuer ?? ''
  }

  // ============================================================================
  // CLIENT MANAGEMENT
  // ============================================================================

  /**
   * Register an OAuth client
   */
  async registerClient(params: RegisterClientParams): Promise<OAuthClient> {
    const clientId = this.generateId('client')
    const now = new Date().toISOString()

    const client: OAuthClient = {
      id: clientId,
      secret: params.secret,
      name: params.name,
      redirect_uris: params.redirect_uris,
      allowed_grant_types: params.allowed_grant_types,
      allowed_scopes: params.allowed_scopes,
      is_first_party: params.is_first_party,
      created_at: now,
      updated_at: now,
    }

    await this.storage.put(`client:${clientId}`, client)

    return client
  }

  /**
   * Get a client by ID
   */
  async getClient(clientId: string): Promise<OAuthClient | null> {
    return this.storage.get<OAuthClient>(`client:${clientId}`)
  }

  /**
   * Validate client credentials
   */
  async validateClient(clientId: string, clientSecret?: string): Promise<OAuthClient | null> {
    const client = await this.storage.get<OAuthClient>(`client:${clientId}`)
    if (!client) return null

    if (!client.secret) return client

    if (!clientSecret || !this.constantTimeCompare(clientSecret, client.secret)) {
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
    const expiresAt = new Date(Date.now() + this.authCodeTTL * 1000)

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

    const codeHash = await this.hashCode(code)
    await this.storage.put(`authcode:${codeHash}`, authCode, { ttl: this.authCodeTTL * 1000 })

    return code
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCode(
    code: string,
    clientId: string,
    redirectUri: string,
    codeVerifier?: string,
    user?: User
  ): Promise<OAuthTokenResponse> {
    const codeHash = await this.hashCode(code)
    const authCode = await this.storage.get<AuthorizationCode>(`authcode:${codeHash}`)

    if (!authCode) {
      throw AuthErrors.oauthInvalidGrant('Authorization code not found or expired')
    }

    if (authCode.client_id !== clientId) {
      throw AuthErrors.oauthInvalidGrant('Client ID mismatch')
    }

    if (authCode.redirect_uri !== redirectUri) {
      throw AuthErrors.oauthInvalidGrant('Redirect URI mismatch')
    }

    if (new Date(authCode.expires_at) < new Date()) {
      throw AuthErrors.oauthInvalidGrant('Authorization code expired')
    }

    if (authCode.code_challenge) {
      if (!codeVerifier) {
        throw AuthErrors.oauthInvalidGrant('Code verifier required')
      }

      const isValid = await this.verifyCodeChallenge(codeVerifier, authCode.code_challenge, authCode.code_challenge_method ?? 'S256')

      if (!isValid) {
        throw AuthErrors.oauthInvalidGrant('Invalid code verifier')
      }
    }

    // Invalidate authorization code
    await this.storage.delete(`authcode:${codeHash}`)

    // Generate tokens
    return this.generateTokens(authCode.user_id, clientId, authCode.scope, authCode.nonce, user)
  }

  // ============================================================================
  // TOKEN OPERATIONS
  // ============================================================================

  /**
   * Generate access and refresh tokens
   */
  private async generateTokens(
    userId: string,
    clientId: string,
    scope: string,
    nonce?: string,
    user?: User
  ): Promise<OAuthTokenResponse> {
    const now = Date.now()

    const accessTokenOptions: JWTCreateOptions = {
      secret: this.jwtSecret,
      algorithm: this.jwtAlgorithm,
      issuer: this.issuer,
      audience: clientId,
      subject: userId,
      expiresIn: this.accessTokenTTL,
    }

    const accessTokenClaims = {
      scope,
      client_id: clientId,
    }

    const accessToken = await createJWT(accessTokenClaims, accessTokenOptions)

    const refreshToken = this.generateSecureCode()
    const refreshTokenHash = await this.hashCode(refreshToken)

    await this.storage.put(
      `refresh:${refreshTokenHash}`,
      {
        user_id: userId,
        client_id: clientId,
        scope,
        expires_at: new Date(now + this.refreshTokenTTL * 1000).toISOString(),
      },
      { ttl: this.refreshTokenTTL * 1000 }
    )

    const response: OAuthTokenResponse = {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: this.accessTokenTTL,
      expires_at: Math.floor(now / 1000) + this.accessTokenTTL,
      scope,
    }

    // ID token (if openid scope)
    if (scope.split(' ').includes('openid')) {
      const idTokenOptions: JWTCreateOptions = {
        secret: this.jwtSecret,
        algorithm: this.jwtAlgorithm,
        issuer: this.issuer,
        audience: clientId,
        subject: userId,
        expiresIn: this.idTokenTTL,
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
   * Introspect a token
   */
  async introspect(token: string): Promise<{ active: boolean; [key: string]: unknown }> {
    const result = await verifyJWT(token, {
      secret: this.jwtSecret,
      algorithms: [this.jwtAlgorithm],
      issuer: this.issuer,
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
    const refreshData = await this.storage.get<{ user_id: string; client_id: string; scope: string; expires_at: string }>(`refresh:${tokenHash}`)

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

  /**
   * Revoke a token
   */
  async revoke(token: string, tokenType: 'access_token' | 'refresh_token'): Promise<void> {
    if (tokenType === 'refresh_token') {
      const tokenHash = await this.hashCode(token)
      await this.storage.delete(`refresh:${tokenHash}`)
    }
    // Access tokens are JWTs and can't be revoked without a blocklist
  }

  // ============================================================================
  // PKCE UTILITIES
  // ============================================================================

  /**
   * Generate a code verifier for PKCE
   */
  generateCodeVerifier(): string {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    return this.base64UrlEncode(bytes)
  }

  /**
   * Generate a code challenge from a verifier
   */
  async generateCodeChallenge(verifier: string, method: 'plain' | 'S256' = 'S256'): Promise<string> {
    if (method === 'plain') {
      return verifier
    }

    const encoder = new TextEncoder()
    const data = encoder.encode(verifier)
    const hash = await crypto.subtle.digest('SHA-256', data)
    return this.base64UrlEncode(new Uint8Array(hash))
  }

  private async verifyCodeChallenge(verifier: string, challenge: string, method: 'plain' | 'S256'): Promise<boolean> {
    const expectedChallenge = await this.generateCodeChallenge(verifier, method)
    return this.constantTimeCompare(expectedChallenge, challenge)
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private generateId(prefix: string): string {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    return `${prefix}_${hex}`
  }

  private generateSecureCode(): string {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  private async hashCode(code: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(code)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  private base64UrlEncode(data: Uint8Array): string {
    const base64 = btoa(String.fromCharCode(...data))
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }

  private constantTimeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false

    let result = 0
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i)
    }
    return result === 0
  }
}
