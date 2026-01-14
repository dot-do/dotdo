/**
 * @dotdo/auth - Type Definitions
 *
 * Core type definitions for the authentication package.
 *
 * @module
 */

// ============================================================================
// USER TYPES
// ============================================================================

/**
 * Standard user object
 */
export interface User {
  id: string
  email?: string
  email_verified?: boolean
  phone?: string
  phone_verified?: boolean
  username?: string
  first_name?: string
  last_name?: string
  name?: string
  picture?: string
  created_at: string
  updated_at: string
  last_sign_in_at?: string
  metadata: UserMetadata
  app_metadata: AppMetadata
  identities?: Identity[]
  mfa_factors?: MFAFactor[]
}

/**
 * User-editable metadata
 */
export interface UserMetadata {
  [key: string]: unknown
}

/**
 * System-managed application metadata
 */
export interface AppMetadata {
  provider?: string
  providers?: string[]
  roles?: string[]
  permissions?: string[]
  [key: string]: unknown
}

/**
 * User identity from OAuth provider
 */
export interface Identity {
  id: string
  user_id: string
  provider: string
  provider_id: string
  connection?: string
  is_social: boolean
  access_token?: string
  refresh_token?: string
  expires_at?: number
  profile_data?: Record<string, unknown>
  created_at: string
  updated_at: string
}

/**
 * Internal user record with sensitive data
 */
export interface UserRecord extends User {
  password_hash?: string
  password_changed_at?: string
  email_verification_token?: string
  email_verification_sent_at?: string
  password_reset_token?: string
  password_reset_sent_at?: string
  failed_login_attempts?: number
  locked_until?: string
}

// ============================================================================
// SESSION TYPES
// ============================================================================

/**
 * Authentication session
 */
export interface Session {
  id: string
  user_id: string
  client_id?: string
  status: 'active' | 'revoked' | 'expired'
  created_at: string
  updated_at: string
  expires_at: string
  last_active_at: string
  ip_address?: string
  user_agent?: string
  device_info?: DeviceInfo
}

/**
 * Device information for session
 */
export interface DeviceInfo {
  device_type?: 'desktop' | 'mobile' | 'tablet' | 'unknown'
  os?: string
  os_version?: string
  browser?: string
  browser_version?: string
}

/**
 * Internal session record
 */
export interface SessionRecord extends Session {
  access_token_hash?: string
  refresh_token_hash?: string
}

/**
 * Token pair (access + refresh)
 */
export interface TokenPair {
  access_token: string
  refresh_token?: string
  token_type: 'Bearer'
  expires_in: number
  expires_at?: number
  scope?: string
  id_token?: string
}

// ============================================================================
// JWT TYPES
// ============================================================================

/**
 * Standard JWT claims
 */
export interface JWTClaims {
  iss?: string
  sub?: string
  aud?: string | string[]
  exp?: number
  nbf?: number
  iat?: number
  jti?: string
  email?: string
  email_verified?: boolean
  name?: string
  picture?: string
  roles?: string[]
  permissions?: string[]
  org_id?: string
  org_role?: string
  sid?: string
  metadata?: Record<string, unknown>
  [key: string]: unknown
}

/**
 * JWT header
 */
export interface JWTHeader {
  alg: 'HS256' | 'HS384' | 'HS512' | 'RS256' | 'RS384' | 'RS512' | 'ES256' | 'ES384' | 'ES512'
  typ: 'JWT'
  kid?: string
}

// ============================================================================
// MFA TYPES
// ============================================================================

/**
 * MFA factor
 */
export interface MFAFactor {
  id: string
  user_id: string
  type: 'totp' | 'sms' | 'email' | 'webauthn'
  status: 'verified' | 'unverified' | 'pending'
  friendly_name?: string
  phone_number?: string
  email?: string
  created_at: string
  updated_at: string
  last_used_at?: string
}

/**
 * TOTP enrollment data
 */
export interface TOTPEnrollment {
  factor_id: string
  secret: string
  uri: string
  qr_code: string
}

/**
 * MFA challenge
 */
export interface MFAChallenge {
  id: string
  factor_id: string
  type: 'totp' | 'sms' | 'email' | 'webauthn'
  expires_at: string
}

// ============================================================================
// OAUTH TYPES
// ============================================================================

/**
 * OAuth client
 */
export interface OAuthClient {
  id: string
  secret?: string
  name: string
  redirect_uris: string[]
  allowed_grant_types: ('authorization_code' | 'refresh_token' | 'client_credentials' | 'implicit')[]
  allowed_scopes: string[]
  is_first_party: boolean
  created_at: string
  updated_at: string
}

/**
 * OAuth authorization request
 */
export interface OAuthAuthorizationRequest {
  client_id: string
  redirect_uri: string
  response_type: 'code' | 'token' | 'id_token' | 'code id_token' | 'code token' | 'id_token token' | 'code id_token token'
  scope: string
  state?: string
  nonce?: string
  code_challenge?: string
  code_challenge_method?: 'plain' | 'S256'
  prompt?: 'none' | 'login' | 'consent' | 'select_account'
  baseUrl?: string
}

/**
 * OAuth token response
 */
export interface OAuthTokenResponse extends TokenPair {
  id_token?: string
}

// ============================================================================
// STORAGE TYPES
// ============================================================================

/**
 * Storage backend interface
 */
export interface StorageBackend {
  get: <T>(key: string) => Promise<T | null>
  put: <T>(key: string, value: T, options?: StoragePutOptions) => Promise<void>
  delete: (key: string) => Promise<void>
  list?: (prefix: string) => Promise<string[]>
}

/**
 * Storage put options
 */
export interface StoragePutOptions {
  ttl?: number
}

// ============================================================================
// CONFIG TYPES
// ============================================================================

/**
 * Auth configuration
 */
export interface AuthConfig {
  /** JWT signing secret (required) */
  jwtSecret: string
  /** JWT algorithm */
  jwtAlgorithm?: 'HS256' | 'RS256' | 'ES256'
  /** JWT issuer */
  issuer?: string
  /** JWT audience */
  audience?: string | string[]
  /** Access token TTL in seconds (default: 3600) */
  accessTokenTTL?: number
  /** Refresh token TTL in seconds (default: 604800) */
  refreshTokenTTL?: number
  /** Session TTL in seconds (default: 2592000) */
  sessionTTL?: number
  /** ID token TTL in seconds (default: 3600) */
  idTokenTTL?: number
  /** Minimum password length (default: 8) */
  minPasswordLength?: number
  /** Maximum failed login attempts before lockout (default: 5) */
  maxFailedLoginAttempts?: number
  /** Lockout duration in seconds (default: 900) */
  lockoutDuration?: number
  /** Require email verification */
  requireEmailVerification?: boolean
  /** Rotate refresh tokens on use (default: true) */
  rotateRefreshTokens?: boolean
  /** Maximum sessions per user (0 = unlimited) */
  maxSessionsPerUser?: number
  /** Custom storage backend */
  storage?: StorageBackend
  /** MFA configuration */
  mfa?: MFAConfig
}

/**
 * MFA configuration
 */
export interface MFAConfig {
  /** TOTP issuer name */
  totpIssuer?: string
  /** TOTP period in seconds */
  totpPeriod?: number
  /** TOTP digits */
  totpDigits?: number
  /** OTP length for email/SMS */
  otpLength?: number
  /** OTP TTL in seconds */
  otpTTL?: number
}

// ============================================================================
// RESULT TYPES
// ============================================================================

/**
 * Sign up/in result
 */
export interface AuthResult {
  user: User
  session: Session
  tokens: TokenPair
}

/**
 * Token validation result
 */
export interface TokenValidationResult {
  valid: boolean
  user?: User
  session?: Session
  claims?: JWTClaims
  error?: string
}

/**
 * Password verification result
 */
export interface PasswordVerificationResult {
  valid: boolean
  user?: User
  error?: string
  requiresPasswordChange?: boolean
  locked?: boolean
  lockUntil?: Date
}
