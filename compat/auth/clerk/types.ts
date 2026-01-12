/**
 * @dotdo/clerk - Clerk Type Definitions
 *
 * Types compatible with Clerk's Backend API for drop-in replacement.
 *
 * @module
 */

// ============================================================================
// USER TYPES
// ============================================================================

/**
 * Clerk user object
 */
export interface ClerkUser {
  id: string
  object: 'user'
  username: string | null
  first_name: string | null
  last_name: string | null
  image_url: string
  has_image: boolean
  primary_email_address_id: string | null
  primary_phone_number_id: string | null
  primary_web3_wallet_id: string | null
  password_enabled: boolean
  two_factor_enabled: boolean
  totp_enabled: boolean
  backup_code_enabled: boolean
  email_addresses: ClerkEmailAddress[]
  phone_numbers: ClerkPhoneNumber[]
  web3_wallets: ClerkWeb3Wallet[]
  external_accounts: ClerkExternalAccount[]
  saml_accounts: ClerkSAMLAccount[]
  public_metadata: Record<string, unknown>
  private_metadata: Record<string, unknown>
  unsafe_metadata: Record<string, unknown>
  external_id: string | null
  last_sign_in_at: number | null
  banned: boolean
  locked: boolean
  lockout_expires_in_seconds: number | null
  verification_attempts_remaining: number | null
  created_at: number
  updated_at: number
  delete_self_enabled: boolean
  create_organization_enabled: boolean
  last_active_at: number | null
}

/**
 * Clerk email address
 */
export interface ClerkEmailAddress {
  id: string
  object: 'email_address'
  email_address: string
  reserved: boolean
  verification: ClerkVerification | null
  linked_to: ClerkLinkedIdentifier[]
  created_at: number
  updated_at: number
}

/**
 * Clerk phone number
 */
export interface ClerkPhoneNumber {
  id: string
  object: 'phone_number'
  phone_number: string
  reserved_for_second_factor: boolean
  default_second_factor: boolean
  reserved: boolean
  verification: ClerkVerification | null
  linked_to: ClerkLinkedIdentifier[]
  created_at: number
  updated_at: number
}

/**
 * Clerk Web3 wallet
 */
export interface ClerkWeb3Wallet {
  id: string
  object: 'web3_wallet'
  web3_wallet: string
  verification: ClerkVerification | null
  created_at: number
  updated_at: number
}

/**
 * Clerk external account (OAuth)
 */
export interface ClerkExternalAccount {
  id: string
  object: 'external_account'
  provider: string
  identification_id: string
  provider_user_id: string
  approved_scopes: string
  email_address: string
  first_name: string | null
  last_name: string | null
  image_url: string | null
  username: string | null
  public_metadata: Record<string, unknown>
  label: string | null
  created_at: number
  updated_at: number
  verification: ClerkVerification | null
}

/**
 * Clerk SAML account
 */
export interface ClerkSAMLAccount {
  id: string
  object: 'saml_account'
  provider: string
  provider_user_id: string
  email_address: string
  first_name: string | null
  last_name: string | null
  active: boolean
  created_at: number
  updated_at: number
  verification: ClerkVerification | null
}

/**
 * Clerk verification status
 */
export interface ClerkVerification {
  status: 'unverified' | 'verified' | 'transferable' | 'failed' | 'expired'
  strategy: string
  attempts: number | null
  expire_at: number | null
  verified_at_client?: string
}

/**
 * Clerk linked identifier
 */
export interface ClerkLinkedIdentifier {
  id: string
  type: string
}

/**
 * Create user parameters
 */
export interface CreateUserParams {
  external_id?: string
  first_name?: string
  last_name?: string
  email_address?: string[]
  phone_number?: string[]
  web3_wallet?: string[]
  username?: string
  password?: string
  password_digest?: string
  password_hasher?: 'argon2i' | 'argon2id' | 'bcrypt' | 'bcrypt_sha256_django' | 'md5' | 'pbkdf2_sha256' | 'pbkdf2_sha256_django' | 'pbkdf2_sha1' | 'phpass' | 'scrypt_firebase' | 'scrypt_werkzeug' | 'sha256'
  skip_password_checks?: boolean
  skip_password_requirement?: boolean
  totp_secret?: string
  backup_codes?: string[]
  public_metadata?: Record<string, unknown>
  private_metadata?: Record<string, unknown>
  unsafe_metadata?: Record<string, unknown>
  delete_self_enabled?: boolean
  create_organization_enabled?: boolean
  created_at?: string
}

/**
 * Update user parameters
 */
export interface UpdateUserParams {
  external_id?: string
  first_name?: string
  last_name?: string
  primary_email_address_id?: string
  notify_primary_email_address_changed?: boolean
  primary_phone_number_id?: string
  primary_web3_wallet_id?: string
  username?: string
  profile_image_id?: string
  password?: string
  password_digest?: string
  password_hasher?: string
  skip_password_checks?: boolean
  sign_out_of_other_sessions?: boolean
  totp_secret?: string
  backup_codes?: string[]
  public_metadata?: Record<string, unknown>
  private_metadata?: Record<string, unknown>
  unsafe_metadata?: Record<string, unknown>
  delete_self_enabled?: boolean
  create_organization_enabled?: boolean
}

// ============================================================================
// SESSION TYPES
// ============================================================================

/**
 * Clerk session
 */
export interface ClerkSession {
  id: string
  object: 'session'
  client_id: string
  user_id: string
  status: 'active' | 'revoked' | 'ended' | 'expired' | 'removed' | 'replaced' | 'abandoned'
  last_active_at: number
  last_active_organization_id: string | null
  actor: ClerkSessionActor | null
  expire_at: number
  abandon_at: number
  created_at: number
  updated_at: number
}

/**
 * Clerk session actor (for impersonation)
 */
export interface ClerkSessionActor {
  sub: string
}

/**
 * Session token claims
 */
export interface ClerkSessionClaims {
  azp: string // Authorized party (client ID)
  exp: number
  iat: number
  iss: string
  nbf: number
  sid: string // Session ID
  sub: string // User ID
}

// ============================================================================
// ORGANIZATION TYPES
// ============================================================================

/**
 * Clerk organization
 */
export interface ClerkOrganization {
  id: string
  object: 'organization'
  name: string
  slug: string
  image_url: string
  has_image: boolean
  members_count: number
  pending_invitations_count: number
  max_allowed_memberships: number
  admin_delete_enabled: boolean
  public_metadata: Record<string, unknown>
  private_metadata: Record<string, unknown>
  created_at: number
  updated_at: number
}

/**
 * Create organization parameters
 */
export interface CreateOrganizationParams {
  name: string
  slug?: string
  created_by: string
  max_allowed_memberships?: number
  public_metadata?: Record<string, unknown>
  private_metadata?: Record<string, unknown>
}

/**
 * Update organization parameters
 */
export interface UpdateOrganizationParams {
  name?: string
  slug?: string
  max_allowed_memberships?: number
  admin_delete_enabled?: boolean
  public_metadata?: Record<string, unknown>
  private_metadata?: Record<string, unknown>
}

/**
 * Organization membership
 */
export interface ClerkOrganizationMembership {
  id: string
  object: 'organization_membership'
  public_metadata: Record<string, unknown>
  private_metadata: Record<string, unknown>
  role: string
  created_at: number
  updated_at: number
  organization: ClerkOrganization
  public_user_data: ClerkPublicUserData
}

/**
 * Public user data in membership
 */
export interface ClerkPublicUserData {
  user_id: string
  first_name: string | null
  last_name: string | null
  image_url: string
  has_image: boolean
  identifier: string
}

/**
 * Organization invitation
 */
export interface ClerkOrganizationInvitation {
  id: string
  object: 'organization_invitation'
  email_address: string
  role: string
  role_name?: string
  organization_id: string
  inviter_user_id?: string
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  public_metadata: Record<string, unknown>
  private_metadata: Record<string, unknown>
  expires_at?: number
  created_at: number
  updated_at: number
}

/**
 * Organization role
 */
export interface ClerkOrganizationRole {
  id: string
  object: 'role'
  name: string
  key: string
  description: string
  permissions: string[]
  is_creator_eligible: boolean
  created_at: number
  updated_at: number
}

/**
 * Organization permission
 */
export interface ClerkOrganizationPermission {
  id: string
  object: 'permission'
  name: string
  key: string
  description: string
  type: 'system' | 'custom'
  created_at: number
  updated_at: number
}

/**
 * Organization domain
 */
export interface ClerkOrganizationDomain {
  id: string
  object: 'organization_domain'
  organization_id: string
  name: string
  enrollment_mode: 'manual_invitation' | 'automatic_invitation' | 'automatic_suggestion'
  affiliation_email_address?: string
  total_pending_invitations: number
  total_pending_suggestions: number
  verification: ClerkDomainVerification | null
  created_at: number
  updated_at: number
}

/**
 * Domain verification status
 */
export interface ClerkDomainVerification {
  status: 'unverified' | 'verified'
  strategy: 'email_code' | 'dns_record'
  attempts: number
  expires_at: number | null
}

/**
 * Create invitation parameters
 */
export interface CreateInvitationParams {
  email_address: string
  role: string
  inviter_user_id?: string
  public_metadata?: Record<string, unknown>
  private_metadata?: Record<string, unknown>
  redirect_url?: string
  expires_in_days?: number
}

/**
 * Create membership parameters
 */
export interface CreateMembershipParams {
  organizationId: string
  userId: string
  role: string
  public_metadata?: Record<string, unknown>
  private_metadata?: Record<string, unknown>
}

/**
 * Update membership parameters
 */
export interface UpdateMembershipParams {
  organizationId: string
  userId: string
  role: string
  public_metadata?: Record<string, unknown>
  private_metadata?: Record<string, unknown>
}

/**
 * Create role parameters
 */
export interface CreateRoleParams {
  name: string
  key: string
  description?: string
  permissions?: string[]
}

/**
 * Update role parameters
 */
export interface UpdateRoleParams {
  name?: string
  description?: string
  permissions?: string[]
}

/**
 * Create permission parameters
 */
export interface CreatePermissionParams {
  name: string
  key: string
  description?: string
}

/**
 * Create domain parameters
 */
export interface CreateDomainParams {
  name: string
  enrollment_mode?: 'manual_invitation' | 'automatic_invitation' | 'automatic_suggestion'
  verified?: boolean
}

/**
 * Update domain parameters
 */
export interface UpdateDomainParams {
  enrollment_mode?: 'manual_invitation' | 'automatic_invitation' | 'automatic_suggestion'
}

// ============================================================================
// JWT TEMPLATE TYPES
// ============================================================================

/**
 * Clerk JWT template
 */
export interface ClerkJWTTemplate {
  id: string
  object: 'jwt_template'
  name: string
  claims: Record<string, unknown>
  lifetime: number
  allowed_clock_skew: number
  custom_signing_key: boolean
  signing_algorithm: string
  created_at: number
  updated_at: number
}

/**
 * Create JWT template parameters
 */
export interface CreateJWTTemplateParams {
  name: string
  claims: Record<string, unknown>
  lifetime?: number
  allowed_clock_skew?: number
  custom_signing_key?: boolean
  signing_algorithm?: string
}

// ============================================================================
// CLIENT TYPES
// ============================================================================

/**
 * Clerk client (browser session)
 */
export interface ClerkClient {
  id: string
  object: 'client'
  session_ids: string[]
  sessions: ClerkSession[]
  sign_in: ClerkSignIn | null
  sign_up: ClerkSignUp | null
  last_active_session_id: string | null
  created_at: number
  updated_at: number
}

/**
 * Sign in attempt
 */
export interface ClerkSignIn {
  id: string
  object: 'sign_in'
  status: 'needs_identifier' | 'needs_first_factor' | 'needs_second_factor' | 'needs_new_password' | 'complete'
  supported_identifiers: string[]
  supported_first_factors: ClerkFactor[]
  supported_second_factors: ClerkFactor[]
  first_factor_verification: ClerkVerification | null
  second_factor_verification: ClerkVerification | null
  identifier: string | null
  user_data: ClerkPublicUserData | null
  created_session_id: string | null
  abandon_at: number
  created_at: number
  updated_at: number
}

/**
 * Sign up attempt
 */
export interface ClerkSignUp {
  id: string
  object: 'sign_up'
  status: 'missing_requirements' | 'complete' | 'abandoned'
  required_fields: string[]
  optional_fields: string[]
  missing_fields: string[]
  unverified_fields: string[]
  verifications: Record<string, ClerkVerification>
  username: string | null
  email_address: string | null
  phone_number: string | null
  web3_wallet: string | null
  external_account: ClerkExternalAccount | null
  has_password: boolean
  unsafe_metadata: Record<string, unknown>
  public_metadata: Record<string, unknown>
  custom_action: boolean
  external_account_strategy: string | null
  external_account_action_completed_redirect_url: string | null
  abandon_at: number
  created_session_id: string | null
  created_user_id: string | null
  created_at: number
  updated_at: number
}

/**
 * Authentication factor
 */
export interface ClerkFactor {
  strategy: string
  email_address_id?: string
  phone_number_id?: string
  web3_wallet_id?: string
  saml_account_id?: string
  safe?: boolean
  primary?: boolean
  default?: boolean
}

// ============================================================================
// WEBHOOK TYPES
// ============================================================================

/**
 * Clerk webhook event
 */
export interface ClerkWebhookEvent {
  data: Record<string, unknown>
  object: 'event'
  type: ClerkWebhookEventType
}

/**
 * Webhook event types
 */
export type ClerkWebhookEventType =
  | 'user.created'
  | 'user.updated'
  | 'user.deleted'
  | 'session.created'
  | 'session.ended'
  | 'session.removed'
  | 'session.revoked'
  | 'organization.created'
  | 'organization.updated'
  | 'organization.deleted'
  | 'organizationMembership.created'
  | 'organizationMembership.updated'
  | 'organizationMembership.deleted'
  | 'organizationInvitation.created'
  | 'organizationInvitation.accepted'
  | 'organizationInvitation.revoked'
  | 'email.created'
  | 'sms.created'

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

/**
 * Paginated list response
 */
export interface ClerkPaginatedList<T> {
  data: T[]
  total_count: number
}

/**
 * Deleted object response
 */
export interface ClerkDeletedObject {
  id: string
  object: string
  deleted: boolean
}

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Clerk API error
 */
export interface ClerkError {
  status: number
  clerk_trace_id: string
  errors: ClerkErrorDetail[]
}

/**
 * Clerk error detail
 */
export interface ClerkErrorDetail {
  code: string
  message: string
  long_message?: string
  meta?: Record<string, unknown>
}

/**
 * Clerk error class
 */
export class ClerkAPIError extends Error {
  status: number
  clerkTraceId: string
  errors: ClerkErrorDetail[]

  constructor(status: number, errors: ClerkErrorDetail[], clerkTraceId?: string) {
    super(errors[0]?.message ?? 'Unknown error')
    this.name = 'ClerkAPIError'
    this.status = status
    this.clerkTraceId = clerkTraceId ?? this.generateTraceId()
    this.errors = errors
  }

  private generateTraceId(): string {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  toJSON(): ClerkError {
    return {
      status: this.status,
      clerk_trace_id: this.clerkTraceId,
      errors: this.errors,
    }
  }
}
