/**
 * @dotdo/oauth Provider Interface
 *
 * Defines the OAuthProvider interface that all providers must implement.
 * Supports OAuth 2.1 with PKCE.
 *
 * @module @dotdo/oauth/providers/interface
 */

import type { TokenResponse } from '../core/types'

/**
 * User information returned from a provider's userinfo endpoint.
 */
export interface UserInfo {
  /** Unique identifier from the provider */
  id: string
  /** User's email address (if available) */
  email?: string
  /** Whether the email is verified */
  emailVerified?: boolean
  /** User's display name */
  name?: string
  /** User's given/first name */
  givenName?: string
  /** User's family/last name */
  familyName?: string
  /** URL to the user's profile picture */
  picture?: string
  /** User's locale/language preference */
  locale?: string
  /** Raw response from the provider */
  raw?: Record<string, unknown>
}

/**
 * OAuth provider configuration options.
 */
export interface OAuthProviderConfig {
  /** OAuth client ID */
  clientId: string
  /** OAuth client secret */
  clientSecret: string
  /** Redirect URI for OAuth callback */
  redirectUri: string
  /** Scopes to request */
  scopes?: string[]
}

/**
 * OAuth provider interface.
 *
 * All OAuth providers must implement this interface to be usable
 * with the provider registry and OAuth flow utilities.
 */
export interface OAuthProvider {
  /** Provider name (e.g., 'google', 'github') */
  name: string

  /**
   * Generate the authorization URL for the OAuth flow.
   *
   * @param state - CSRF state parameter
   * @param codeChallenge - PKCE code challenge
   * @returns The authorization URL
   */
  getAuthorizationUrl(state: string, codeChallenge: string): string

  /**
   * Exchange an authorization code for tokens.
   *
   * @param code - The authorization code from the callback
   * @param codeVerifier - PKCE code verifier
   * @returns Promise resolving to the token response
   */
  exchangeCode(code: string, codeVerifier: string): Promise<TokenResponse>

  /**
   * Get user information using an access token.
   *
   * @param accessToken - The access token
   * @returns Promise resolving to user information
   */
  getUser(accessToken: string): Promise<UserInfo>

  /**
   * Refresh an access token using a refresh token.
   * Optional - not all providers support refresh tokens.
   *
   * @param refreshToken - The refresh token
   * @returns Promise resolving to the new token response
   */
  refreshToken?(refreshToken: string): Promise<TokenResponse>
}
