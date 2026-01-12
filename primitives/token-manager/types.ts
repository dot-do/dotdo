/**
 * Token Manager Types
 *
 * Type definitions for JWT, API keys, and token management.
 */

/**
 * Supported token types
 */
export type TokenType = 'jwt' | 'api-key' | 'refresh' | 'access' | 'opaque'

/**
 * JWT algorithm types
 */
export type Algorithm = 'HS256' | 'HS384' | 'HS512' | 'RS256' | 'RS384' | 'RS512'

/**
 * JWT payload with standard claims
 */
export interface TokenPayload {
  /** Subject - typically user ID */
  sub: string
  /** Issued at timestamp (seconds since epoch) */
  iat: number
  /** Expiration timestamp (seconds since epoch) */
  exp: number
  /** Custom claims */
  claims?: Record<string, unknown>
  /** Token ID for revocation tracking */
  jti?: string
  /** Issuer */
  iss?: string
  /** Audience */
  aud?: string | string[]
}

/**
 * Token configuration for creation
 */
export interface TokenConfig {
  /** Secret key for HMAC algorithms */
  secret?: string
  /** Private key for RSA algorithms */
  privateKey?: string
  /** Public key for RSA verification */
  publicKey?: string
  /** Algorithm to use */
  algorithm?: Algorithm
  /** Token lifetime (e.g., '15m', '1h', '7d') or seconds */
  expiresIn?: string | number
  /** Issuer claim */
  issuer?: string
  /** Audience claim */
  audience?: string | string[]
}

/**
 * Access and refresh token pair
 */
export interface TokenPair {
  /** Short-lived access token */
  accessToken: string
  /** Long-lived refresh token */
  refreshToken: string
  /** Access token expiration timestamp */
  accessTokenExpiresAt: number
  /** Refresh token expiration timestamp */
  refreshTokenExpiresAt: number
  /** Token type (always 'Bearer') */
  tokenType: 'Bearer'
}

/**
 * API key representation
 */
export interface APIKey {
  /** The actual key value */
  key: string
  /** Key ID for identification */
  id: string
  /** Human-readable name */
  name: string
  /** Permissions granted to this key */
  permissions: string[]
  /** Creation timestamp */
  createdAt: number
  /** Expiration timestamp (null for non-expiring) */
  expiresAt: number | null
  /** Last used timestamp */
  lastUsedAt?: number
  /** Associated metadata */
  metadata?: Record<string, unknown>
}

/**
 * Options for creating an API key
 */
export interface APIKeyOptions {
  /** Human-readable name */
  name: string
  /** Permissions to grant */
  permissions?: string[]
  /** Key lifetime (e.g., '30d', '1y') or null for non-expiring */
  expiresIn?: string | number | null
  /** Prefix for the key (e.g., 'sk_live_') */
  prefix?: string
  /** Key length in bytes (default: 32) */
  length?: number
  /** Associated metadata */
  metadata?: Record<string, unknown>
}

/**
 * Result of token validation
 */
export interface TokenValidation {
  /** Whether the token is valid */
  valid: boolean
  /** Decoded payload if valid */
  payload?: TokenPayload
  /** Error message if invalid */
  error?: string
  /** Error code for programmatic handling */
  errorCode?: 'expired' | 'invalid_signature' | 'malformed' | 'revoked' | 'invalid_claims'
}

/**
 * Result of API key validation
 */
export interface APIKeyValidation {
  /** Whether the key is valid */
  valid: boolean
  /** API key details if valid */
  apiKey?: APIKey
  /** Error message if invalid */
  error?: string
  /** Error code */
  errorCode?: 'expired' | 'invalid' | 'revoked' | 'not_found'
}

/**
 * Configuration for refresh tokens
 */
export interface RefreshConfig {
  /** Length of refresh token in bytes (default: 64) */
  tokenLength?: number
  /** Lifetime of refresh token (default: '7d') */
  expiresIn?: string | number
  /** Window for token reuse after refresh (default: 0 - no reuse) */
  reuseWindow?: number
  /** Whether to rotate refresh tokens on use (default: true) */
  rotateOnUse?: boolean
}

/**
 * Stored refresh token data
 */
export interface RefreshTokenData {
  /** The refresh token value */
  token: string
  /** Associated user/subject ID */
  userId: string
  /** Creation timestamp */
  createdAt: number
  /** Expiration timestamp */
  expiresAt: number
  /** Whether this token has been used */
  used: boolean
  /** When the token was used */
  usedAt?: number
  /** Token that replaced this one */
  replacedBy?: string
  /** Token family for rotation tracking */
  family: string
}

/**
 * Token rotation configuration
 */
export interface TokenRotationConfig {
  /** How often to rotate (e.g., '1h', '24h') */
  interval: string | number
  /** Grace period where old tokens still work */
  gracePeriod?: string | number
  /** Callback when rotation occurs */
  onRotate?: (oldToken: string, newToken: string) => void | Promise<void>
}

/**
 * Claims validator function type
 */
export type ClaimsValidator = (claims: Record<string, unknown>) => boolean | Promise<boolean>

/**
 * Storage interface for token persistence
 */
export interface TokenStorage {
  /** Store a refresh token */
  storeRefreshToken(data: RefreshTokenData): Promise<void>
  /** Get refresh token by value */
  getRefreshToken(token: string): Promise<RefreshTokenData | null>
  /** Mark refresh token as used */
  markRefreshTokenUsed(token: string, replacedBy?: string): Promise<void>
  /** Revoke all tokens in a family */
  revokeTokenFamily(family: string): Promise<void>
  /** Check if token is revoked */
  isRevoked(tokenId: string): Promise<boolean>
  /** Add token to revocation list */
  revokeToken(tokenId: string, expiresAt: number): Promise<void>
  /** Store API key */
  storeAPIKey(apiKey: APIKey): Promise<void>
  /** Get API key by key value */
  getAPIKey(key: string): Promise<APIKey | null>
  /** Get API key by ID */
  getAPIKeyById(id: string): Promise<APIKey | null>
  /** Revoke API key */
  revokeAPIKey(keyOrId: string): Promise<void>
  /** Update API key last used timestamp */
  updateAPIKeyLastUsed(key: string): Promise<void>
}
