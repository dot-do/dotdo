/**
 * @dotdo/oauth Custom Provider
 *
 * Factory for creating custom OAuth 2.1 providers with arbitrary endpoints.
 * Useful for self-hosted identity providers or less common OAuth providers.
 *
 * @module @dotdo/oauth/providers/custom
 */

import type { TokenResponse } from '../core/types'
import type { OAuthProvider, OAuthProviderConfig, UserInfo } from './interface'

/**
 * Custom provider configuration.
 */
export interface CustomProviderConfig extends OAuthProviderConfig {
  /** Provider name */
  name: string
  /** Authorization endpoint URL */
  authorizationEndpoint: string
  /** Token endpoint URL */
  tokenEndpoint: string
  /** User info endpoint URL (optional) */
  userInfoEndpoint?: string
  /** Whether the provider supports PKCE (default: true) */
  supportsPKCE?: boolean
  /** Additional authorization parameters */
  authorizationParams?: Record<string, string>
  /** Function to map user info response to UserInfo */
  mapUserInfo?: (data: Record<string, unknown>) => UserInfo
}

/**
 * Default user info mapper - assumes OpenID Connect standard claims.
 */
function defaultUserInfoMapper(data: Record<string, unknown>): UserInfo {
  const userInfo: UserInfo = {
    id: (data['sub'] as string) || (data['id'] as string) || '',
    raw: data,
  }

  if (data['email']) userInfo.email = data['email'] as string
  if (data['email_verified'] !== undefined) userInfo.emailVerified = data['email_verified'] as boolean
  if (data['name']) userInfo.name = data['name'] as string

  const givenName = (data['given_name'] as string | undefined) || (data['firstName'] as string | undefined)
  if (givenName) userInfo.givenName = givenName

  const familyName = (data['family_name'] as string | undefined) || (data['lastName'] as string | undefined)
  if (familyName) userInfo.familyName = familyName

  const picture = (data['picture'] as string | undefined) || (data['avatar'] as string | undefined)
  if (picture) userInfo.picture = picture

  if (data['locale']) userInfo.locale = data['locale'] as string

  return userInfo
}

/**
 * Create a custom OAuth provider with arbitrary endpoints.
 *
 * @param config - Provider configuration
 * @returns OAuthProvider instance
 *
 * @example
 * ```typescript
 * const custom = createCustomProvider({
 *   name: 'my-idp',
 *   clientId: 'your-client-id',
 *   clientSecret: 'your-client-secret',
 *   redirectUri: 'https://yourapp.com/callback',
 *   authorizationEndpoint: 'https://idp.example.com/oauth/authorize',
 *   tokenEndpoint: 'https://idp.example.com/oauth/token',
 *   userInfoEndpoint: 'https://idp.example.com/oauth/userinfo',
 * })
 *
 * // Get authorization URL
 * const url = custom.getAuthorizationUrl(state, codeChallenge)
 * ```
 */
export function createCustomProvider(config: CustomProviderConfig): OAuthProvider {
  const {
    name,
    clientId,
    clientSecret,
    redirectUri,
    scopes = [],
    authorizationEndpoint,
    tokenEndpoint,
    userInfoEndpoint,
    supportsPKCE = true,
    authorizationParams = {},
    mapUserInfo = defaultUserInfoMapper,
  } = config

  return {
    name,

    getAuthorizationUrl(state: string, codeChallenge: string): string {
      const url = new URL(authorizationEndpoint)
      url.searchParams.set('client_id', clientId)
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('state', state)

      if (scopes.length > 0) {
        url.searchParams.set('scope', scopes.join(' '))
      }

      if (supportsPKCE) {
        url.searchParams.set('code_challenge', codeChallenge)
        url.searchParams.set('code_challenge_method', 'S256')
      }

      // Add custom authorization parameters
      for (const [key, value] of Object.entries(authorizationParams)) {
        url.searchParams.set(key, value)
      }

      return url.toString()
    },

    async exchangeCode(code: string, codeVerifier: string): Promise<TokenResponse> {
      const params: Record<string, string> = {
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }

      if (supportsPKCE) {
        params['code_verifier'] = codeVerifier
      }

      const response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(params),
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`Token exchange failed: ${error}`)
      }

      return response.json()
    },

    async getUser(accessToken: string): Promise<UserInfo> {
      if (!userInfoEndpoint) {
        throw new Error(`User info endpoint not configured for provider: ${name}`)
      }

      const response = await fetch(userInfoEndpoint, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch user info: ${response.statusText}`)
      }

      const data = (await response.json()) as Record<string, unknown>
      return mapUserInfo(data)
    },

    async refreshToken(refreshTokenValue: string): Promise<TokenResponse> {
      const params: Record<string, string> = {
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshTokenValue,
        grant_type: 'refresh_token',
      }

      if (scopes.length > 0) {
        params['scope'] = scopes.join(' ')
      }

      const response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(params),
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`Token refresh failed: ${error}`)
      }

      return response.json()
    },
  }
}
