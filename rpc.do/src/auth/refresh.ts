/**
 * @module rpc.do/auth/refresh
 *
 * OAuth 2.0 refresh token grant implementation.
 *
 * This module provides functions for exchanging refresh tokens for new
 * access tokens using the OAuth 2.0 refresh token grant.
 *
 * @example Direct usage
 * ```typescript
 * import { refreshToken } from 'rpc.do'
 *
 * const newTokens = await refreshToken({
 *   refreshToken: 'old-refresh-token',
 *   clientId: 'my-app',
 *   oauthBaseUrl: 'https://oauth.do',
 * })
 * console.log(`New access token: ${newTokens.access_token}`)
 * ```
 *
 * @example With createRefreshFn for AuthTransport
 * ```typescript
 * import { AuthTransport, TokenStore, createRefreshFn } from 'rpc.do'
 *
 * const transport = new AuthTransport({
 *   url: 'https://api.example.com',
 *   tokenStore: new TokenStore(),
 *   onRefreshToken: createRefreshFn({
 *     clientId: 'my-app',
 *     oauthBaseUrl: 'https://oauth.do',
 *   }),
 * })
 * ```
 */

/**
 * Options for refreshing a token
 */
export interface RefreshTokenOptions {
  /** The refresh token to exchange */
  refreshToken: string
  /** OAuth client ID */
  clientId: string
  /** Base URL of the OAuth server */
  oauthBaseUrl: string
  /** Custom fetch implementation (for testing) */
  fetch?: typeof globalThis.fetch
}

/**
 * Token response from refresh
 */
export interface RefreshTokenResponse {
  /** New access token */
  access_token: string
  /** Token type (typically 'Bearer') */
  token_type: string
  /** Access token lifetime in seconds */
  expires_in: number
  /** New refresh token (may be the same or rotated) */
  refresh_token?: string
  /** Granted scopes */
  scope?: string
}

/**
 * Error thrown when token refresh fails
 */
export class RefreshError extends Error {
  constructor(
    public readonly code: string,
    public readonly description?: string
  ) {
    super(description || code)
    this.name = 'RefreshError'
  }
}

/**
 * Refresh an OAuth access token
 *
 * Exchanges a refresh token for a new access token using the OAuth 2.0
 * refresh token grant.
 *
 * @example
 * ```typescript
 * const newTokens = await refreshToken({
 *   refreshToken: 'old-refresh-token',
 *   clientId: 'my-app',
 *   oauthBaseUrl: 'https://oauth.do',
 * })
 * console.log(`New access token: ${newTokens.access_token}`)
 * ```
 *
 * @param options - Refresh token options
 * @returns New token response
 * @throws RefreshError if the refresh fails
 */
export async function refreshToken(options: RefreshTokenOptions): Promise<RefreshTokenResponse> {
  const { refreshToken: token, clientId, oauthBaseUrl } = options
  const fetchImpl = options.fetch ?? globalThis.fetch

  const params = new URLSearchParams()
  params.set('grant_type', 'refresh_token')
  params.set('refresh_token', token)
  params.set('client_id', clientId)

  const response = await fetchImpl(`${oauthBaseUrl}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  })

  if (!response.ok) {
    const error = await response.json() as { error: string; error_description?: string }
    throw new RefreshError(error.error, error.error_description)
  }

  return response.json() as Promise<RefreshTokenResponse>
}

/**
 * Create a refresh token function bound to specific OAuth config
 *
 * @example
 * ```typescript
 * const refreshFn = createRefreshFn({
 *   clientId: 'my-app',
 *   oauthBaseUrl: 'https://oauth.do',
 * })
 *
 * // Later, when you need to refresh:
 * const newTokens = await refreshFn('current-refresh-token')
 * ```
 */
export function createRefreshFn(config: {
  clientId: string
  oauthBaseUrl: string
  fetch?: typeof globalThis.fetch
}): (refreshToken: string) => Promise<RefreshTokenResponse> {
  return (token: string) => {
    const opts: RefreshTokenOptions = {
      refreshToken: token,
      clientId: config.clientId,
      oauthBaseUrl: config.oauthBaseUrl,
    }
    if (config.fetch !== undefined) {
      opts.fetch = config.fetch
    }
    return refreshToken(opts)
  }
}
