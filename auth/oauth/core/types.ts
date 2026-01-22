/**
 * @dotdo/oauth Type Definitions
 *
 * OAuth 2.1 + PKCE types for the oauth package.
 * Uses Web Crypto API for Workers compatibility.
 *
 * @module @dotdo/oauth/types
 */

/**
 * PKCE code challenge method.
 * - S256: SHA-256 hash (recommended, required by OAuth 2.1)
 * - plain: Plain text (only for backwards compatibility, NOT recommended)
 */
export type PKCEMethod = 'S256' | 'plain'

/**
 * PKCE pair containing verifier, challenge, and method.
 */
export interface PKCEPair {
  /** The code verifier (43-128 characters, URL-safe) */
  verifier: string
  /** The code challenge (base64url encoded hash of verifier) */
  challenge: string
  /** The challenge method used */
  method: PKCEMethod
}

/**
 * State token metadata for OAuth flows.
 */
export interface StateMetadata {
  /** Internal nonce for uniqueness */
  _nonce?: string
  /** Expiration timestamp (Unix milliseconds) */
  _exp?: number
  /** Custom metadata fields */
  [key: string]: unknown
}

/**
 * OAuth 2.1 Authorization Request parameters.
 */
export interface AuthorizationRequest {
  /** Response type (always 'code' for OAuth 2.1) */
  response_type: 'code'
  /** Client identifier */
  client_id: string
  /** Redirect URI */
  redirect_uri: string
  /** Scope(s) requested */
  scope?: string
  /** State parameter for CSRF protection */
  state: string
  /** PKCE code challenge */
  code_challenge: string
  /** PKCE code challenge method */
  code_challenge_method: PKCEMethod
  /** Additional parameters */
  [key: string]: string | undefined
}

/**
 * OAuth 2.1 Token Request parameters.
 */
export interface TokenRequest {
  /** Grant type */
  grant_type: 'authorization_code' | 'refresh_token'
  /** Client identifier */
  client_id: string
  /** Authorization code (for authorization_code grant) */
  code?: string
  /** Redirect URI (must match authorization request) */
  redirect_uri?: string
  /** PKCE code verifier */
  code_verifier?: string
  /** Refresh token (for refresh_token grant) */
  refresh_token?: string
  /** Scope(s) requested (for refresh_token grant) */
  scope?: string
}

/**
 * OAuth 2.1 Token Response.
 */
export interface TokenResponse {
  /** Access token */
  access_token: string
  /** Token type (always 'Bearer') */
  token_type: 'Bearer'
  /** Access token expiration in seconds */
  expires_in: number
  /** Refresh token (if issued) */
  refresh_token?: string
  /** Scope(s) granted */
  scope?: string
  /** ID token (for OpenID Connect) */
  id_token?: string
}

/**
 * OAuth 2.1 Error Response.
 */
export interface OAuthError {
  /** Error code */
  error:
    | 'invalid_request'
    | 'unauthorized_client'
    | 'access_denied'
    | 'unsupported_response_type'
    | 'invalid_scope'
    | 'server_error'
    | 'temporarily_unavailable'
    | 'invalid_grant'
    | 'invalid_client'
  /** Human-readable error description */
  error_description?: string
  /** URI for more information */
  error_uri?: string
  /** State parameter (echoed back) */
  state?: string
}
