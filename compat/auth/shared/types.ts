/**
 * @dotdo/auth - Shared Auth Types
 *
 * Common type definitions used across Auth0 and Clerk compat layers.
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
 * Token pair (access + refresh)
 */
export interface TokenPair {
  access_token: string
  refresh_token?: string
  token_type: 'Bearer'
  expires_in: number
  expires_at?: number
  scope?: string
}

// ============================================================================
// JWT TYPES
// ============================================================================

/**
 * Standard JWT claims
 */
export interface JWTClaims {
  // Standard claims (RFC 7519)
  iss?: string // Issuer
  sub?: string // Subject (user ID)
  aud?: string | string[] // Audience
  exp?: number // Expiration time
  nbf?: number // Not before
  iat?: number // Issued at
  jti?: string // JWT ID

  // Common auth claims
  email?: string
  email_verified?: boolean
  name?: string
  picture?: string
  roles?: string[]
  permissions?: string[]
  org_id?: string
  org_role?: string
  metadata?: Record<string, unknown>

  // Custom claims
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

/**
 * JWT template for generating tokens
 */
export interface JWTTemplate {
  id: string
  name: string
  claims: Partial<JWTClaims>
  lifetime?: number // seconds
  allowed_clock_skew?: number // seconds
  custom_claims?: Record<string, unknown>
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
  phone_number?: string // For SMS
  email?: string // For email
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
 * WebAuthn credential
 */
export interface WebAuthnCredential {
  id: string
  factor_id: string
  public_key: string
  counter: number
  transports?: ('usb' | 'nfc' | 'ble' | 'internal')[]
  created_at: string
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
 * OAuth provider configuration
 */
export interface OAuthProvider {
  id: string
  name: string
  type: 'oauth2' | 'oidc' | 'saml'
  client_id: string
  client_secret?: string
  authorization_url: string
  token_url: string
  userinfo_url?: string
  jwks_url?: string
  scopes: string[]
  enabled: boolean
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
}

/**
 * OAuth token request
 */
export interface OAuthTokenRequest {
  grant_type: 'authorization_code' | 'refresh_token' | 'client_credentials' | 'password'
  client_id: string
  client_secret?: string
  code?: string
  redirect_uri?: string
  refresh_token?: string
  scope?: string
  username?: string
  password?: string
  code_verifier?: string
}

/**
 * OAuth token response
 */
export interface OAuthTokenResponse extends TokenPair {
  id_token?: string
}

// ============================================================================
// ORGANIZATION TYPES
// ============================================================================

/**
 * Organization
 */
export interface Organization {
  id: string
  name: string
  slug: string
  image_url?: string
  created_at: string
  updated_at: string
  max_allowed_memberships?: number
  members_count?: number
  pending_invitations_count?: number
  metadata: Record<string, unknown>
}

/**
 * Organization membership
 */
export interface OrganizationMembership {
  id: string
  organization_id: string
  user_id: string
  role: string
  created_at: string
  updated_at: string
  permissions?: string[]
}

/**
 * Organization invitation
 */
export interface OrganizationInvitation {
  id: string
  organization_id: string
  email: string
  role: string
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  created_at: string
  expires_at: string
  invited_by?: string
}

/**
 * Organization role
 */
export interface OrganizationRole {
  id: string
  key: string
  name: string
  description?: string
  permissions: string[]
  created_at: string
  updated_at: string
}

// ============================================================================
// RBAC TYPES
// ============================================================================

/**
 * Role definition
 */
export interface Role {
  id: string
  name: string
  description?: string
  permissions: string[]
  created_at: string
  updated_at: string
}

/**
 * Permission definition
 */
export interface Permission {
  id: string
  name: string
  description?: string
  resource_server_identifier?: string
  created_at: string
  updated_at: string
}

// ============================================================================
// CONNECTION TYPES
// ============================================================================

/**
 * Auth connection (database, social, enterprise)
 */
export interface Connection {
  id: string
  name: string
  strategy: 'auth0' | 'google-oauth2' | 'github' | 'microsoft' | 'samlp' | 'oidc' | 'email' | 'sms' | string
  enabled_clients: string[]
  is_domain_connection: boolean
  options: ConnectionOptions
  created_at: string
  updated_at: string
}

/**
 * Connection options
 */
export interface ConnectionOptions {
  domain_aliases?: string[]
  tenant_domain?: string
  icon_url?: string
  requires_username?: boolean
  import_mode?: boolean
  disable_signup?: boolean
  passwordless?: boolean
  brute_force_protection?: boolean
  password_policy?: 'none' | 'low' | 'fair' | 'good' | 'excellent'
  [key: string]: unknown
}

// ============================================================================
// AUTH ERROR TYPES
// ============================================================================

/**
 * Standard auth error
 */
export interface AuthError {
  code: string
  message: string
  status?: number
  details?: Record<string, unknown>
}

/**
 * Auth error class
 */
export class AuthenticationError extends Error implements AuthError {
  code: string
  status?: number
  details?: Record<string, unknown>

  constructor(code: string, message: string, status?: number, details?: Record<string, unknown>) {
    super(message)
    this.name = 'AuthenticationError'
    this.code = code
    this.status = status
    this.details = details
  }
}

// ============================================================================
// WEBHOOK TYPES
// ============================================================================

/**
 * Auth webhook event
 */
export interface AuthWebhookEvent {
  id: string
  type: AuthWebhookEventType
  data: Record<string, unknown>
  created_at: string
}

/**
 * Webhook event types
 */
export type AuthWebhookEventType =
  | 'user.created'
  | 'user.updated'
  | 'user.deleted'
  | 'session.created'
  | 'session.ended'
  | 'session.revoked'
  | 'organization.created'
  | 'organization.updated'
  | 'organization.deleted'
  | 'organization.membership.created'
  | 'organization.membership.updated'
  | 'organization.membership.deleted'
  | 'organization.invitation.created'
  | 'organization.invitation.accepted'
  | 'organization.invitation.revoked'

// ============================================================================
// STORAGE TYPES
// ============================================================================

/**
 * User storage record (for TemporalStore)
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

/**
 * Session storage record (for TemporalStore)
 */
export interface SessionRecord extends Session {
  access_token_hash?: string
  refresh_token_hash?: string
}
