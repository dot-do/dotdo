/**
 * OAuth 2.0 Authorization Server Types
 *
 * Types for oauth.do - RFC 6749 and OpenID Connect compliant.
 */

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * OAuth Server configuration
 */
export interface OAuthServerConfig {
  /**
   * Issuer identifier (must be a URL)
   * Used in discovery document and JWT tokens
   */
  issuer: string

  /**
   * Signing key for JWTs (will be converted to RSA key pair)
   */
  signingKey: string

  /**
   * Access token TTL in seconds (default: 3600)
   */
  accessTokenTtl?: number

  /**
   * Refresh token TTL in seconds (default: 30 days)
   */
  refreshTokenTtl?: number

  /**
   * Authorization code TTL in seconds (default: 600)
   */
  authorizationCodeTtl?: number

  /**
   * Supported scopes
   */
  scopes?: string[]

  /**
   * Enforce HTTPS for redirect URIs
   */
  enforceHttps?: boolean

  /**
   * Login page URL (for redirecting unauthenticated users)
   */
  loginUrl?: string

  /**
   * Consent page URL (for user consent flow)
   */
  consentUrl?: string
}

// ============================================================================
// Client Types
// ============================================================================

/**
 * OAuth client registration
 */
export interface OAuthClient {
  id: string
  clientId: string
  clientSecret: string
  name: string
  redirectUris: string[]
  scopes: string[]
  grantTypes: string[]
  responseTypes?: string[]
  tokenEndpointAuthMethod?: string
  type?: 'web' | 'native' | 'user-agent-based'
  public: boolean
  disabled?: boolean
  skipConsent: boolean
  userId: string
  organizationId?: string
  uri?: string
  icon?: string
  metadata?: Record<string, unknown>
  createdAt?: Date
  updatedAt?: Date
}

/**
 * Dynamic client registration request (RFC 7591)
 */
export interface ClientRegistrationRequest {
  client_name?: string
  redirect_uris: string[]
  grant_types?: string[]
  response_types?: string[]
  scope?: string
  token_endpoint_auth_method?: string
  client_uri?: string
  logo_uri?: string
  policy_uri?: string
  tos_uri?: string
  contacts?: string[]
}

/**
 * Dynamic client registration response
 */
export interface ClientRegistrationResponse {
  client_id: string
  client_secret?: string
  client_name?: string
  redirect_uris: string[]
  grant_types: string[]
  response_types: string[]
  token_endpoint_auth_method: string
  client_id_issued_at?: number
  client_secret_expires_at?: number
}

// ============================================================================
// Authorization Types
// ============================================================================

/**
 * Authorization request parameters
 */
export interface AuthorizationRequest {
  response_type: string
  client_id: string
  redirect_uri: string
  scope?: string
  state?: string
  nonce?: string
  code_challenge?: string
  code_challenge_method?: 'plain' | 'S256'
  prompt?: 'none' | 'login' | 'consent' | 'select_account'
  login_hint?: string
  acr_values?: string
  response_mode?: 'query' | 'fragment' | 'form_post'
}

/**
 * Stored authorization request (for login/consent flow)
 */
export interface StoredAuthRequest extends AuthorizationRequest {
  id: string
  createdAt: Date
  expiresAt: Date
}

/**
 * Authorization code record
 */
export interface AuthorizationCode {
  code: string
  clientId: string
  userId: string
  redirectUri: string
  scopes: string[]
  codeChallenge?: string
  codeChallengeMethod?: string
  nonce?: string
  expiresAt: Date
  used: boolean
  createdAt?: Date
}

// ============================================================================
// Token Types
// ============================================================================

/**
 * Token request parameters
 */
export interface TokenRequest {
  grant_type: string
  code?: string
  redirect_uri?: string
  client_id?: string
  client_secret?: string
  refresh_token?: string
  scope?: string
  code_verifier?: string
}

/**
 * Token response
 */
export interface TokenResponse {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  refresh_token?: string
  id_token?: string
  scope: string
}

/**
 * Access token record
 */
export interface AccessToken {
  id: string
  token: string
  clientId: string
  userId: string
  scopes: string[]
  expiresAt: Date
  revoked: boolean
  createdAt?: Date
}

/**
 * Refresh token record
 */
export interface RefreshToken {
  id: string
  token: string
  clientId: string
  userId: string
  scopes: string[]
  expiresAt: Date
  revoked: boolean
  createdAt?: Date
}

// ============================================================================
// Consent Types
// ============================================================================

/**
 * User consent record
 */
export interface UserConsent {
  userId: string
  clientId: string
  scopes: string[]
  organizationId?: string
  createdAt?: Date
  updatedAt?: Date
}

// ============================================================================
// User Types
// ============================================================================

/**
 * User information for tokens
 */
export interface OAuthUser {
  id: string
  email: string
  name: string
  emailVerified: boolean
  image?: string
}

// ============================================================================
// Introspection Types (RFC 7662)
// ============================================================================

/**
 * Token introspection response
 */
export interface IntrospectionResponse {
  active: boolean
  scope?: string
  client_id?: string
  username?: string
  token_type?: string
  exp?: number
  iat?: number
  nbf?: number
  sub?: string
  aud?: string
  iss?: string
  jti?: string
}

// ============================================================================
// Discovery Types (OpenID Connect)
// ============================================================================

/**
 * OpenID Connect Discovery document
 */
export interface DiscoveryDocument {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  userinfo_endpoint: string
  jwks_uri: string
  registration_endpoint?: string
  introspection_endpoint?: string
  revocation_endpoint?: string
  scopes_supported: string[]
  response_types_supported: string[]
  response_modes_supported: string[]
  grant_types_supported: string[]
  subject_types_supported: string[]
  id_token_signing_alg_values_supported: string[]
  token_endpoint_auth_methods_supported: string[]
  code_challenge_methods_supported: string[]
  claims_supported: string[]
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * OAuth 2.0 Error response
 */
export interface OAuthError {
  error: string
  error_description?: string
  error_uri?: string
  state?: string
}

/**
 * Standard OAuth 2.0 error codes
 */
export type OAuthErrorCode =
  | 'invalid_request'
  | 'unauthorized_client'
  | 'access_denied'
  | 'unsupported_response_type'
  | 'invalid_scope'
  | 'server_error'
  | 'temporarily_unavailable'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unsupported_grant_type'
  | 'invalid_redirect_uri'
  | 'invalid_token'
  | 'invalid_client_metadata'

// ============================================================================
// Database Interface
// ============================================================================

/**
 * Abstract database interface for OAuth storage
 */
export interface OAuthDatabase {
  // Clients
  clients: Map<string, OAuthClient>

  // Authorization codes
  authCodes: Map<string, AuthorizationCode>

  // Access tokens
  tokens: Map<string, AccessToken>

  // Refresh tokens
  refreshTokens: Map<string, RefreshToken>

  // User consents
  consents: Map<string, UserConsent>

  // Users
  users: Map<string, OAuthUser>

  // Helpers
  seedClient(data: OAuthClient): void
  seedUser(data: OAuthUser): void
}
