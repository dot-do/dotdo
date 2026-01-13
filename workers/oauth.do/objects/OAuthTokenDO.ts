/**
 * OAuthTokenDO - Durable Object for OAuth Token Management
 *
 * Stores and manages OAuth tokens with:
 * - Authorization codes (short-lived)
 * - Access tokens
 * - Refresh tokens
 * - Token revocation and introspection
 *
 * Token DOs are keyed by user_id:client_id to enable:
 * - Fast token lookups for a user/client pair
 * - Bulk revocation of all tokens for a user or client
 * - Consent management per user/client pair
 */

import type {
  AuthorizationCode,
  AccessToken,
  RefreshToken,
  UserConsent,
} from '../types'
import { generateAuthorizationCode, generateAccessToken, generateRefreshToken, hashSecret } from '../crypto'

// ============================================================================
// Types
// ============================================================================

interface TokenState {
  userId: string
  clientId: string
  consents: UserConsent | null
  authCodes: Map<string, AuthorizationCode>
  accessTokens: Map<string, AccessToken>
  refreshTokens: Map<string, RefreshToken>
}

interface CreateAuthCodeInput {
  redirectUri: string
  scopes: string[]
  codeChallenge?: string
  codeChallengeMethod?: string
  nonce?: string
  expiresInSeconds?: number
}

interface CreateAccessTokenInput {
  scopes: string[]
  expiresInSeconds?: number
}

interface CreateRefreshTokenInput {
  scopes: string[]
  expiresInSeconds?: number
}

// ============================================================================
// Durable Object
// ============================================================================

/**
 * OAuth Token Durable Object
 *
 * Manages tokens for a specific user/client pair.
 *
 * @example
 * ```typescript
 * // Get token DO by user:client pair
 * const key = `${userId}:${clientId}`
 * const id = env.OAUTH_TOKENS.idFromName(key)
 * const stub = env.OAUTH_TOKENS.get(id)
 *
 * // Create authorization code
 * const response = await stub.fetch('/auth-code/create', {
 *   method: 'POST',
 *   body: JSON.stringify({
 *     redirectUri: 'https://app.example.com/callback',
 *     scopes: ['openid', 'profile'],
 *   })
 * })
 * ```
 */
export class OAuthTokenDO implements DurableObject {
  private state: DurableObjectState
  private tokenState: TokenState | null = null

  constructor(state: DurableObjectState) {
    this.state = state
  }

  /**
   * Load token state from storage
   */
  private async ensureLoaded(): Promise<TokenState> {
    if (this.tokenState === null) {
      const stored = await this.state.storage.get<{
        userId: string
        clientId: string
        consents: UserConsent | null
        authCodes: Record<string, AuthorizationCode>
        accessTokens: Record<string, AccessToken>
        refreshTokens: Record<string, RefreshToken>
      }>('tokens')

      if (stored) {
        this.tokenState = {
          userId: stored.userId,
          clientId: stored.clientId,
          consents: stored.consents,
          authCodes: new Map(Object.entries(stored.authCodes)),
          accessTokens: new Map(Object.entries(stored.accessTokens)),
          refreshTokens: new Map(Object.entries(stored.refreshTokens)),
        }
      } else {
        // Initialize empty state - will be set on first token creation
        this.tokenState = {
          userId: '',
          clientId: '',
          consents: null,
          authCodes: new Map(),
          accessTokens: new Map(),
          refreshTokens: new Map(),
        }
      }
    }
    return this.tokenState
  }

  /**
   * Save token state to storage
   */
  private async save(): Promise<void> {
    if (this.tokenState) {
      await this.state.storage.put('tokens', {
        userId: this.tokenState.userId,
        clientId: this.tokenState.clientId,
        consents: this.tokenState.consents,
        authCodes: Object.fromEntries(this.tokenState.authCodes),
        accessTokens: Object.fromEntries(this.tokenState.accessTokens),
        refreshTokens: Object.fromEntries(this.tokenState.refreshTokens),
      })
    }
  }

  /**
   * Clean up expired tokens
   */
  private async cleanupExpired(): Promise<void> {
    const state = await this.ensureLoaded()
    const now = Date.now()

    // Clean auth codes (typically short-lived)
    for (const [code, authCode] of state.authCodes) {
      if (authCode.expiresAt.getTime() < now) {
        state.authCodes.delete(code)
      }
    }

    // Clean access tokens
    for (const [token, accessToken] of state.accessTokens) {
      if (accessToken.expiresAt.getTime() < now) {
        state.accessTokens.delete(token)
      }
    }

    // Note: We don't auto-delete refresh tokens as they may be long-lived
    // and the user might want to see them in a "connected apps" view

    await this.save()
  }

  /**
   * Handle incoming requests
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    try {
      // Route to appropriate handler
      if (path.startsWith('/auth-code/')) {
        return this.handleAuthCode(request, path.slice(11))
      }

      if (path.startsWith('/access-token/')) {
        return this.handleAccessToken(request, path.slice(14))
      }

      if (path.startsWith('/refresh-token/')) {
        return this.handleRefreshToken(request, path.slice(15))
      }

      if (path.startsWith('/consent/')) {
        return this.handleConsent(request, path.slice(9))
      }

      switch (path) {
        case '/init':
          return this.handleInit(request)

        case '/revoke-all':
          return this.handleRevokeAll()

        case '/cleanup':
          return this.handleCleanup()

        case '/stats':
          return this.handleStats()

        default:
          return new Response('Not Found', { status: 404 })
      }
    } catch (error) {
      console.error('OAuthTokenDO error:', error)
      return new Response(
        JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }
  }

  /**
   * Initialize token store with user/client IDs
   */
  private async handleInit(request: Request): Promise<Response> {
    const { userId, clientId } = await request.json() as { userId: string; clientId: string }

    const state = await this.ensureLoaded()
    state.userId = userId
    state.clientId = clientId
    await this.save()

    return new Response(JSON.stringify({ initialized: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // =========================================================================
  // Authorization Code Handlers
  // =========================================================================

  private async handleAuthCode(request: Request, action: string): Promise<Response> {
    switch (action) {
      case 'create':
        return this.createAuthCode(request)
      case 'validate':
        return this.validateAuthCode(request)
      case 'use':
        return this.useAuthCode(request)
      default:
        return new Response('Not Found', { status: 404 })
    }
  }

  private async createAuthCode(request: Request): Promise<Response> {
    const state = await this.ensureLoaded()
    const input = await request.json() as CreateAuthCodeInput

    const code = generateAuthorizationCode()
    const expiresAt = new Date(Date.now() + (input.expiresInSeconds || 600) * 1000)

    const authCode: AuthorizationCode = {
      code,
      clientId: state.clientId,
      userId: state.userId,
      redirectUri: input.redirectUri,
      scopes: input.scopes,
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: input.codeChallengeMethod,
      nonce: input.nonce,
      expiresAt,
      used: false,
    }

    state.authCodes.set(code, authCode)
    await this.save()

    return new Response(JSON.stringify({ code, expiresAt: expiresAt.toISOString() }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  private async validateAuthCode(request: Request): Promise<Response> {
    const state = await this.ensureLoaded()
    const { code } = await request.json() as { code: string }

    const authCode = state.authCodes.get(code)
    if (!authCode) {
      return new Response(JSON.stringify({ valid: false, error: 'Code not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (authCode.used) {
      return new Response(JSON.stringify({ valid: false, error: 'Code already used' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (new Date() > authCode.expiresAt) {
      return new Response(JSON.stringify({ valid: false, error: 'Code expired' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ valid: true, authCode }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  private async useAuthCode(request: Request): Promise<Response> {
    const state = await this.ensureLoaded()
    const { code } = await request.json() as { code: string }

    const authCode = state.authCodes.get(code)
    if (!authCode) {
      return new Response(JSON.stringify({ error: 'Code not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (authCode.used) {
      // Security: Revoke all tokens if code is reused (potential attack)
      await this.revokeAllTokens(state)
      return new Response(JSON.stringify({ error: 'Code already used - all tokens revoked' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    authCode.used = true
    await this.save()

    return new Response(JSON.stringify({ success: true, authCode }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // =========================================================================
  // Access Token Handlers
  // =========================================================================

  private async handleAccessToken(request: Request, action: string): Promise<Response> {
    switch (action) {
      case 'create':
        return this.createAccessToken(request)
      case 'validate':
        return this.validateAccessToken(request)
      case 'revoke':
        return this.revokeAccessToken(request)
      case 'list':
        return this.listAccessTokens()
      default:
        return new Response('Not Found', { status: 404 })
    }
  }

  private async createAccessToken(request: Request): Promise<Response> {
    const state = await this.ensureLoaded()
    const input = await request.json() as CreateAccessTokenInput

    const token = generateAccessToken()
    const expiresAt = new Date(Date.now() + (input.expiresInSeconds || 3600) * 1000)

    const accessToken: AccessToken = {
      id: crypto.randomUUID(),
      token,
      clientId: state.clientId,
      userId: state.userId,
      scopes: input.scopes,
      expiresAt,
      revoked: false,
    }

    state.accessTokens.set(token, accessToken)
    await this.save()

    return new Response(
      JSON.stringify({
        access_token: token,
        token_type: 'Bearer',
        expires_in: input.expiresInSeconds || 3600,
      }),
      {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }

  private async validateAccessToken(request: Request): Promise<Response> {
    const state = await this.ensureLoaded()
    const { token } = await request.json() as { token: string }

    const accessToken = state.accessTokens.get(token)
    if (!accessToken) {
      return new Response(JSON.stringify({ active: false }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const active = !accessToken.revoked && new Date() < accessToken.expiresAt

    return new Response(
      JSON.stringify({
        active,
        scope: accessToken.scopes.join(' '),
        client_id: accessToken.clientId,
        sub: accessToken.userId,
        exp: Math.floor(accessToken.expiresAt.getTime() / 1000),
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }

  private async revokeAccessToken(request: Request): Promise<Response> {
    const state = await this.ensureLoaded()
    const { token } = await request.json() as { token: string }

    const accessToken = state.accessTokens.get(token)
    if (accessToken) {
      accessToken.revoked = true
      await this.save()
    }

    return new Response(JSON.stringify({ revoked: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  private async listAccessTokens(): Promise<Response> {
    const state = await this.ensureLoaded()

    const tokens = Array.from(state.accessTokens.values()).map((t) => ({
      id: t.id,
      scopes: t.scopes,
      expiresAt: t.expiresAt,
      revoked: t.revoked,
      active: !t.revoked && new Date() < t.expiresAt,
    }))

    return new Response(JSON.stringify({ tokens }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // =========================================================================
  // Refresh Token Handlers
  // =========================================================================

  private async handleRefreshToken(request: Request, action: string): Promise<Response> {
    switch (action) {
      case 'create':
        return this.createRefreshToken(request)
      case 'validate':
        return this.validateRefreshToken(request)
      case 'revoke':
        return this.revokeRefreshToken(request)
      case 'rotate':
        return this.rotateRefreshToken(request)
      case 'list':
        return this.listRefreshTokens()
      default:
        return new Response('Not Found', { status: 404 })
    }
  }

  private async createRefreshToken(request: Request): Promise<Response> {
    const state = await this.ensureLoaded()
    const input = await request.json() as CreateRefreshTokenInput

    const token = generateRefreshToken()
    const expiresAt = new Date(Date.now() + (input.expiresInSeconds || 86400 * 30) * 1000)

    const refreshToken: RefreshToken = {
      id: crypto.randomUUID(),
      token,
      clientId: state.clientId,
      userId: state.userId,
      scopes: input.scopes,
      expiresAt,
      revoked: false,
    }

    state.refreshTokens.set(token, refreshToken)
    await this.save()

    return new Response(JSON.stringify({ refresh_token: token }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  private async validateRefreshToken(request: Request): Promise<Response> {
    const state = await this.ensureLoaded()
    const { token } = await request.json() as { token: string }

    const refreshToken = state.refreshTokens.get(token)
    if (!refreshToken) {
      return new Response(JSON.stringify({ valid: false, error: 'Token not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (refreshToken.revoked) {
      return new Response(JSON.stringify({ valid: false, error: 'Token revoked' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (new Date() > refreshToken.expiresAt) {
      return new Response(JSON.stringify({ valid: false, error: 'Token expired' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response(
      JSON.stringify({
        valid: true,
        scopes: refreshToken.scopes,
        expiresAt: refreshToken.expiresAt,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }

  private async revokeRefreshToken(request: Request): Promise<Response> {
    const state = await this.ensureLoaded()
    const { token } = await request.json() as { token: string }

    const refreshToken = state.refreshTokens.get(token)
    if (refreshToken) {
      refreshToken.revoked = true
      await this.save()
    }

    return new Response(JSON.stringify({ revoked: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  private async rotateRefreshToken(request: Request): Promise<Response> {
    const state = await this.ensureLoaded()
    const { token, expiresInSeconds } = await request.json() as { token: string; expiresInSeconds?: number }

    const oldToken = state.refreshTokens.get(token)
    if (!oldToken || oldToken.revoked || new Date() > oldToken.expiresAt) {
      return new Response(JSON.stringify({ error: 'Invalid refresh token' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Revoke old token
    oldToken.revoked = true

    // Create new token with same scopes
    const newToken = generateRefreshToken()
    const expiresAt = new Date(Date.now() + (expiresInSeconds || 86400 * 30) * 1000)

    const newRefreshToken: RefreshToken = {
      id: crypto.randomUUID(),
      token: newToken,
      clientId: state.clientId,
      userId: state.userId,
      scopes: oldToken.scopes,
      expiresAt,
      revoked: false,
    }

    state.refreshTokens.set(newToken, newRefreshToken)
    await this.save()

    return new Response(JSON.stringify({ refresh_token: newToken }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  private async listRefreshTokens(): Promise<Response> {
    const state = await this.ensureLoaded()

    const tokens = Array.from(state.refreshTokens.values()).map((t) => ({
      id: t.id,
      scopes: t.scopes,
      expiresAt: t.expiresAt,
      revoked: t.revoked,
      active: !t.revoked && new Date() < t.expiresAt,
    }))

    return new Response(JSON.stringify({ tokens }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // =========================================================================
  // Consent Handlers
  // =========================================================================

  private async handleConsent(request: Request, action: string): Promise<Response> {
    switch (action) {
      case 'get':
        return this.getConsent()
      case 'grant':
        return this.grantConsent(request)
      case 'revoke':
        return this.revokeConsent()
      default:
        return new Response('Not Found', { status: 404 })
    }
  }

  private async getConsent(): Promise<Response> {
    const state = await this.ensureLoaded()

    return new Response(
      JSON.stringify({
        hasConsent: !!state.consents,
        consent: state.consents,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }

  private async grantConsent(request: Request): Promise<Response> {
    const state = await this.ensureLoaded()
    const { scopes } = await request.json() as { scopes: string[] }

    state.consents = {
      userId: state.userId,
      clientId: state.clientId,
      scopes,
    }

    await this.save()

    return new Response(JSON.stringify({ granted: true, consent: state.consents }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  private async revokeConsent(): Promise<Response> {
    const state = await this.ensureLoaded()

    state.consents = null
    await this.revokeAllTokens(state)

    return new Response(JSON.stringify({ revoked: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // =========================================================================
  // Utility Handlers
  // =========================================================================

  private async revokeAllTokens(state: TokenState): Promise<void> {
    // Revoke all access tokens
    for (const token of state.accessTokens.values()) {
      token.revoked = true
    }

    // Revoke all refresh tokens
    for (const token of state.refreshTokens.values()) {
      token.revoked = true
    }

    // Mark all auth codes as used
    for (const code of state.authCodes.values()) {
      code.used = true
    }

    await this.save()
  }

  private async handleRevokeAll(): Promise<Response> {
    const state = await this.ensureLoaded()
    await this.revokeAllTokens(state)

    return new Response(JSON.stringify({ revokedAll: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  private async handleCleanup(): Promise<Response> {
    await this.cleanupExpired()

    return new Response(JSON.stringify({ cleaned: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  private async handleStats(): Promise<Response> {
    const state = await this.ensureLoaded()

    const activeAccessTokens = Array.from(state.accessTokens.values()).filter(
      (t) => !t.revoked && new Date() < t.expiresAt
    ).length

    const activeRefreshTokens = Array.from(state.refreshTokens.values()).filter(
      (t) => !t.revoked && new Date() < t.expiresAt
    ).length

    return new Response(
      JSON.stringify({
        userId: state.userId,
        clientId: state.clientId,
        hasConsent: !!state.consents,
        authCodes: state.authCodes.size,
        accessTokens: {
          total: state.accessTokens.size,
          active: activeAccessTokens,
        },
        refreshTokens: {
          total: state.refreshTokens.size,
          active: activeRefreshTokens,
        },
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}
