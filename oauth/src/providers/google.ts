/**
 * @dotdo/oauth Google Provider
 *
 * OAuth 2.1 provider for Google Sign-In.
 *
 * @see https://developers.google.com/identity/protocols/oauth2
 * @module @dotdo/oauth/providers/google
 */

import type { TokenResponse } from '../core/types'
import type { OAuthProvider, OAuthProviderConfig, UserInfo } from './interface'

/**
 * Google-specific provider configuration.
 */
export interface GoogleProviderConfig extends OAuthProviderConfig {
  /** Access type - 'online' or 'offline' (for refresh tokens) */
  accessType?: 'online' | 'offline'
  /** Prompt behavior */
  prompt?: 'none' | 'consent' | 'select_account'
  /** Hosted domain restriction */
  hostedDomain?: string
}

/** Google OAuth authorization endpoint */
const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
/** Google OAuth token endpoint */
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
/** Google userinfo endpoint */
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo'

/** Default scopes for Google */
const DEFAULT_SCOPES = ['openid', 'email', 'profile']

/**
 * Create a Google OAuth provider.
 *
 * @param config - Provider configuration
 * @returns OAuthProvider instance
 *
 * @example
 * ```typescript
 * const google = createGoogleProvider({
 *   clientId: 'your-client-id',
 *   clientSecret: 'your-client-secret',
 *   redirectUri: 'https://yourapp.com/callback',
 *   scopes: ['openid', 'email', 'profile'],
 * })
 *
 * // Get authorization URL
 * const url = google.getAuthorizationUrl(state, codeChallenge)
 * ```
 */
export function createGoogleProvider(config: GoogleProviderConfig): OAuthProvider {
  const {
    clientId,
    clientSecret,
    redirectUri,
    scopes = DEFAULT_SCOPES,
    accessType = 'online',
    prompt,
    hostedDomain,
  } = config

  return {
    name: 'google',

    getAuthorizationUrl(state: string, codeChallenge: string): string {
      const url = new URL(AUTHORIZATION_ENDPOINT)
      url.searchParams.set('client_id', clientId)
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('scope', scopes.join(' '))
      url.searchParams.set('state', state)
      url.searchParams.set('code_challenge', codeChallenge)
      url.searchParams.set('code_challenge_method', 'S256')
      url.searchParams.set('access_type', accessType)

      if (prompt) {
        url.searchParams.set('prompt', prompt)
      }

      if (hostedDomain) {
        url.searchParams.set('hd', hostedDomain)
      }

      return url.toString()
    },

    async exchangeCode(code: string, codeVerifier: string): Promise<TokenResponse> {
      const response = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          code_verifier: codeVerifier,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        }),
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`Token exchange failed: ${error}`)
      }

      return response.json()
    },

    async getUser(accessToken: string): Promise<UserInfo> {
      const response = await fetch(USERINFO_ENDPOINT, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch user info: ${response.statusText}`)
      }

      const data = (await response.json()) as Record<string, unknown>

      const userInfo: UserInfo = {
        id: data['sub'] as string,
        raw: data,
      }

      if (data['email']) userInfo.email = data['email'] as string
      if (data['email_verified'] !== undefined) userInfo.emailVerified = data['email_verified'] as boolean
      if (data['name']) userInfo.name = data['name'] as string
      if (data['given_name']) userInfo.givenName = data['given_name'] as string
      if (data['family_name']) userInfo.familyName = data['family_name'] as string
      if (data['picture']) userInfo.picture = data['picture'] as string
      if (data['locale']) userInfo.locale = data['locale'] as string

      return userInfo
    },

    async refreshToken(refreshTokenValue: string): Promise<TokenResponse> {
      const response = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshTokenValue,
          grant_type: 'refresh_token',
        }),
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`Token refresh failed: ${error}`)
      }

      return response.json()
    },
  }
}
