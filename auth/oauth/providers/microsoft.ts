/**
 * @dotdo/oauth Microsoft Provider
 *
 * OAuth 2.1 provider for Microsoft Identity Platform (Azure AD / Microsoft Entra ID).
 *
 * @see https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
 * @module @dotdo/oauth/providers/microsoft
 */

import type { TokenResponse } from '../core/types'
import type { OAuthProvider, OAuthProviderConfig, UserInfo } from './interface'

/**
 * Microsoft-specific provider configuration.
 */
export interface MicrosoftProviderConfig extends OAuthProviderConfig {
  /** Azure AD tenant ID or 'common', 'organizations', 'consumers' */
  tenant?: string
  /** Prompt behavior */
  prompt?: 'login' | 'none' | 'consent' | 'select_account'
  /** Domain hint for login */
  domainHint?: string
  /** Login hint (email or UPN) */
  loginHint?: string
}

/** Microsoft Graph API userinfo endpoint */
const GRAPH_USER_ENDPOINT = 'https://graph.microsoft.com/v1.0/me'

/** Default scopes for Microsoft */
const DEFAULT_SCOPES = ['openid', 'email', 'profile', 'User.Read']

/**
 * Get the authorization endpoint for a tenant.
 */
function getAuthorizationEndpoint(tenant: string): string {
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`
}

/**
 * Get the token endpoint for a tenant.
 */
function getTokenEndpoint(tenant: string): string {
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`
}

/**
 * Create a Microsoft OAuth provider.
 *
 * @param config - Provider configuration
 * @returns OAuthProvider instance
 *
 * @example
 * ```typescript
 * const microsoft = createMicrosoftProvider({
 *   clientId: 'your-client-id',
 *   clientSecret: 'your-client-secret',
 *   redirectUri: 'https://yourapp.com/callback',
 *   tenant: 'common', // or specific tenant ID
 * })
 *
 * // Get authorization URL
 * const url = microsoft.getAuthorizationUrl(state, codeChallenge)
 * ```
 */
export function createMicrosoftProvider(config: MicrosoftProviderConfig): OAuthProvider {
  const {
    clientId,
    clientSecret,
    redirectUri,
    scopes = DEFAULT_SCOPES,
    tenant = 'common',
    prompt,
    domainHint,
    loginHint,
  } = config

  const authorizationEndpoint = getAuthorizationEndpoint(tenant)
  const tokenEndpoint = getTokenEndpoint(tenant)

  return {
    name: 'microsoft',

    getAuthorizationUrl(state: string, codeChallenge: string): string {
      const url = new URL(authorizationEndpoint)
      url.searchParams.set('client_id', clientId)
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('scope', scopes.join(' '))
      url.searchParams.set('state', state)
      url.searchParams.set('code_challenge', codeChallenge)
      url.searchParams.set('code_challenge_method', 'S256')
      url.searchParams.set('response_mode', 'query')

      if (prompt) {
        url.searchParams.set('prompt', prompt)
      }

      if (domainHint) {
        url.searchParams.set('domain_hint', domainHint)
      }

      if (loginHint) {
        url.searchParams.set('login_hint', loginHint)
      }

      return url.toString()
    },

    async exchangeCode(code: string, codeVerifier: string): Promise<TokenResponse> {
      const response = await fetch(tokenEndpoint, {
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
      const response = await fetch(GRAPH_USER_ENDPOINT, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch user info: ${response.statusText}`)
      }

      const data = (await response.json()) as Record<string, unknown>

      const userInfo: UserInfo = {
        id: data['id'] as string,
        emailVerified: true, // Microsoft verifies emails
        raw: data,
      }

      const email = (data['mail'] as string | undefined) || (data['userPrincipalName'] as string | undefined)
      if (email) userInfo.email = email
      if (data['displayName']) userInfo.name = data['displayName'] as string
      if (data['givenName']) userInfo.givenName = data['givenName'] as string
      if (data['surname']) userInfo.familyName = data['surname'] as string

      return userInfo
    },

    async refreshToken(refreshTokenValue: string): Promise<TokenResponse> {
      const response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshTokenValue,
          grant_type: 'refresh_token',
          scope: scopes.join(' '),
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
