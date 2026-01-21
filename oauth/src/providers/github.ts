/**
 * @dotdo/oauth GitHub Provider
 *
 * OAuth 2.0 provider for GitHub.
 * Note: GitHub does not support PKCE, but we include the interface for consistency.
 *
 * @see https://docs.github.com/en/developers/apps/building-oauth-apps/authorizing-oauth-apps
 * @module @dotdo/oauth/providers/github
 */

import type { TokenResponse } from '../core/types'
import type { OAuthProvider, OAuthProviderConfig, UserInfo } from './interface'

/**
 * GitHub-specific provider configuration.
 */
export interface GitHubProviderConfig extends OAuthProviderConfig {
  /** Whether to allow signup on GitHub's OAuth page */
  allowSignup?: boolean
}

/** GitHub OAuth authorization endpoint */
const AUTHORIZATION_ENDPOINT = 'https://github.com/login/oauth/authorize'
/** GitHub OAuth token endpoint */
const TOKEN_ENDPOINT = 'https://github.com/login/oauth/access_token'
/** GitHub API user endpoint */
const USER_ENDPOINT = 'https://api.github.com/user'
/** GitHub API emails endpoint */
const EMAILS_ENDPOINT = 'https://api.github.com/user/emails'

/** Default scopes for GitHub */
const DEFAULT_SCOPES = ['read:user', 'user:email']

/**
 * Create a GitHub OAuth provider.
 *
 * @param config - Provider configuration
 * @returns OAuthProvider instance
 *
 * @example
 * ```typescript
 * const github = createGitHubProvider({
 *   clientId: 'your-client-id',
 *   clientSecret: 'your-client-secret',
 *   redirectUri: 'https://yourapp.com/callback',
 *   scopes: ['read:user', 'user:email'],
 * })
 *
 * // Get authorization URL
 * const url = github.getAuthorizationUrl(state, codeChallenge)
 * ```
 */
export function createGitHubProvider(config: GitHubProviderConfig): OAuthProvider {
  const { clientId, clientSecret, redirectUri, scopes = DEFAULT_SCOPES, allowSignup = true } = config

  return {
    name: 'github',

    getAuthorizationUrl(state: string, _codeChallenge: string): string {
      const url = new URL(AUTHORIZATION_ENDPOINT)
      url.searchParams.set('client_id', clientId)
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('scope', scopes.join(' '))
      url.searchParams.set('state', state)
      url.searchParams.set('allow_signup', allowSignup ? 'true' : 'false')

      // Note: GitHub does not support PKCE, so codeChallenge is ignored

      return url.toString()
    },

    async exchangeCode(code: string, _codeVerifier: string): Promise<TokenResponse> {
      const response = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      })

      if (!response.ok) {
        const error = await response.text()
        throw new Error(`Token exchange failed: ${error}`)
      }

      const data = (await response.json()) as Record<string, unknown>

      // GitHub returns access_token, token_type, scope but not expires_in
      // We return a standard TokenResponse with a default expiry
      const tokenResponse: TokenResponse = {
        access_token: data['access_token'] as string,
        token_type: 'Bearer',
        expires_in: 0, // GitHub tokens don't expire unless revoked
      }

      if (data['scope']) tokenResponse.scope = data['scope'] as string

      return tokenResponse
    },

    async getUser(accessToken: string): Promise<UserInfo> {
      // Fetch user profile
      const userResponse = await fetch(USER_ENDPOINT, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      })

      if (!userResponse.ok) {
        throw new Error(`Failed to fetch user info: ${userResponse.statusText}`)
      }

      const userData = (await userResponse.json()) as Record<string, unknown>

      // Fetch primary email if not available in profile
      let email = userData['email'] as string | undefined
      let emailVerified = false

      if (!email) {
        try {
          const emailsResponse = await fetch(EMAILS_ENDPOINT, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
            },
          })

          if (emailsResponse.ok) {
            const emails = (await emailsResponse.json()) as Array<{
              email: string
              primary: boolean
              verified: boolean
            }>
            const primaryEmail = emails.find((e) => e.primary)
            if (primaryEmail) {
              email = primaryEmail.email
              emailVerified = primaryEmail.verified
            }
          }
        } catch {
          // Email fetch failed, continue without email
        }
      }

      // Build user info with only defined properties
      const userInfo: UserInfo = {
        id: String(userData['id']),
        raw: userData,
      }

      if (email) userInfo.email = email
      if (emailVerified) userInfo.emailVerified = emailVerified

      // Handle name
      const fullName = userData['name'] as string | undefined
      if (fullName) {
        userInfo.name = fullName
        const parts = fullName.split(' ')
        if (parts[0]) userInfo.givenName = parts[0]
        const family = parts.slice(1).join(' ')
        if (family) userInfo.familyName = family
      }

      if (userData['avatar_url']) userInfo.picture = userData['avatar_url'] as string

      return userInfo
    },

    // GitHub does not support refresh tokens in OAuth flow
    // Tokens are valid until revoked
  }
}
