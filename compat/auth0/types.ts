/**
 * @dotdo/auth0 - Auth0 Management API Types
 *
 * Type definitions for Auth0 Management API compatibility layer.
 * These types are designed to be compatible with auth0 Node.js SDK.
 *
 * @see https://auth0.com/docs/api/management/v2
 * @module
 */

// ============================================================================
// USER TYPES
// ============================================================================

/**
 * Auth0 User object
 * @see https://auth0.com/docs/api/management/v2#!/Users/get_users
 */
export interface User {
  /** The user's unique identifier */
  user_id: string
  /** The user's email address */
  email?: string
  /** Whether the user's email is verified */
  email_verified?: boolean
  /** The user's phone number */
  phone_number?: string
  /** Whether the user's phone number is verified */
  phone_verified?: boolean
  /** The user's username (only if connection requires username) */
  username?: string
  /** The user's given (first) name */
  given_name?: string
  /** The user's family (last) name */
  family_name?: string
  /** The user's full name */
  name?: string
  /** The user's nickname */
  nickname?: string
  /** URL to user's picture */
  picture?: string
  /** When the user was created */
  created_at: string
  /** When the user was last updated */
  updated_at: string
  /** The last time the user logged in */
  last_login?: string
  /** The last time the user's IP address was recorded */
  last_ip?: string
  /** Number of times the user has logged in */
  logins_count?: number
  /** Whether the user has been blocked */
  blocked?: boolean
  /** User metadata (editable by user) */
  user_metadata?: UserMetadata
  /** Application metadata (system-managed) */
  app_metadata?: AppMetadata
  /** User's identities from various connections */
  identities?: Identity[]
  /** Multifactor authentication enrollments */
  multifactor?: string[]
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
  [key: string]: unknown
}

/**
 * User identity from a connection
 */
export interface Identity {
  /** Connection name */
  connection: string
  /** Identity provider */
  provider: string
  /** User ID at the identity provider */
  user_id: string
  /** Whether this is a social identity */
  isSocial: boolean
  /** Access token for the identity provider (if available) */
  access_token?: string
  /** Refresh token for the identity provider (if available) */
  refresh_token?: string
  /** Token expiration (if available) */
  expires_in?: number
  /** Profile data from the identity provider */
  profileData?: Record<string, unknown>
}

// ============================================================================
// USER MANAGEMENT PARAMS
// ============================================================================

/**
 * Parameters for creating a user
 */
export interface CreateUserParams {
  /** Connection name (e.g., 'Username-Password-Authentication') */
  connection: string
  /** The user's email address */
  email?: string
  /** The user's phone number (E.164 format) */
  phone_number?: string
  /** The user's username */
  username?: string
  /** The user's password (for database connections) */
  password?: string
  /** Whether the email should be marked as verified */
  email_verified?: boolean
  /** Whether the phone should be marked as verified */
  phone_verified?: boolean
  /** The user's given name */
  given_name?: string
  /** The user's family name */
  family_name?: string
  /** The user's full name */
  name?: string
  /** The user's nickname */
  nickname?: string
  /** URL to user's picture */
  picture?: string
  /** User metadata */
  user_metadata?: UserMetadata
  /** Application metadata */
  app_metadata?: AppMetadata
  /** Whether to verify the user's email */
  verify_email?: boolean
}

/**
 * Parameters for updating a user
 */
export interface UpdateUserParams {
  /** The user's email address */
  email?: string
  /** The user's phone number */
  phone_number?: string
  /** The user's username */
  username?: string
  /** The user's password */
  password?: string
  /** Whether the email should be marked as verified */
  email_verified?: boolean
  /** Whether the phone should be marked as verified */
  phone_verified?: boolean
  /** The user's given name */
  given_name?: string
  /** The user's family name */
  family_name?: string
  /** The user's full name */
  name?: string
  /** The user's nickname */
  nickname?: string
  /** URL to user's picture */
  picture?: string
  /** User metadata */
  user_metadata?: UserMetadata
  /** Application metadata */
  app_metadata?: AppMetadata
  /** Connection name (required for email/phone/username changes) */
  connection?: string
  /** Whether the user is blocked */
  blocked?: boolean
  /** Whether the user's password has been set by the admin */
  verify_email?: boolean
}

/**
 * Parameters for searching/listing users
 */
export interface GetUsersParams {
  /** Number of results per page (max 100) */
  per_page?: number
  /** Page index (zero-based) */
  page?: number
  /** Whether to include totals */
  include_totals?: boolean
  /** Sort order (field:order, e.g., 'created_at:1' or 'created_at:-1') */
  sort?: string
  /** Connection name filter */
  connection?: string
  /** Fields to include in the response */
  fields?: string
  /** Whether to include specified fields or exclude them */
  include_fields?: boolean
  /** Lucene query string (q) */
  q?: string
  /** Search engine version (v3 recommended) */
  search_engine?: 'v1' | 'v2' | 'v3'
}

/**
 * Paginated response with totals
 */
export interface GetUsersResponse {
  /** Array of users */
  users: User[]
  /** Starting index (for pagination) */
  start?: number
  /** Number of results per page */
  limit?: number
  /** Total number of users matching the query */
  total?: number
}

/**
 * Parameters for getting users by email
 */
export interface GetUsersByEmailParams {
  /** Email address to search for */
  email: string
  /** Fields to include in the response */
  fields?: string
  /** Whether to include specified fields or exclude them */
  include_fields?: boolean
}

// ============================================================================
// PASSWORD MANAGEMENT
// ============================================================================

/**
 * Parameters for changing a user's password
 */
export interface ChangePasswordParams {
  /** User ID */
  user_id: string
  /** New password */
  password: string
  /** Connection name */
  connection?: string
}

/**
 * Parameters for requesting a password reset
 */
export interface ResetPasswordParams {
  /** Connection name */
  connection: string
  /** User's email address */
  email: string
  /** URL to redirect after password reset */
  redirect_uri?: string
}

/**
 * Password reset ticket response
 */
export interface PasswordResetTicket {
  /** Ticket URL for password reset */
  ticket: string
}

// ============================================================================
// EMAIL VERIFICATION
// ============================================================================

/**
 * Parameters for creating an email verification ticket
 */
export interface CreateEmailVerificationTicketParams {
  /** User ID */
  user_id: string
  /** URL to redirect after verification */
  result_url?: string
  /** TTL in seconds (default 432000 = 5 days) */
  ttl_sec?: number
  /** Whether to include the email in the redirect URL */
  includeEmailInRedirect?: boolean
  /** Identity provider */
  identity?: {
    user_id: string
    provider: string
  }
}

/**
 * Email verification ticket response
 */
export interface EmailVerificationTicket {
  /** Ticket URL for email verification */
  ticket: string
}

/**
 * Parameters for resending verification email
 */
export interface ResendVerificationEmailParams {
  /** User ID */
  user_id: string
  /** Client ID (optional) */
  client_id?: string
  /** Identity provider */
  identity?: {
    user_id: string
    provider: string
  }
}

// ============================================================================
// MFA (MULTI-FACTOR AUTHENTICATION)
// ============================================================================

/**
 * MFA enrollment
 */
export interface Enrollment {
  /** Enrollment ID */
  id: string
  /** Enrollment status */
  status: 'pending' | 'confirmed'
  /** Enrollment type */
  type: 'totp' | 'sms' | 'voice' | 'email' | 'push' | 'recovery-code'
  /** Enrollment name */
  name?: string
  /** Phone number (for SMS/voice) */
  phone_number?: string
  /** Authenticator ID */
  authenticator_id?: string
  /** When enrolled */
  enrolled_at: string
  /** Last authentication time */
  last_auth?: string
}

/**
 * Parameters for deleting a user's MFA enrollments
 */
export interface DeleteUserEnrollmentParams {
  /** User ID */
  user_id: string
  /** Enrollment ID */
  enrollment_id: string
}

// ============================================================================
// ROLES AND PERMISSIONS
// ============================================================================

/**
 * Role assigned to a user
 */
export interface Role {
  /** Role ID */
  id: string
  /** Role name */
  name: string
  /** Role description */
  description?: string
}

/**
 * Permission
 */
export interface Permission {
  /** Permission name */
  permission_name: string
  /** Resource server identifier (API) */
  resource_server_identifier: string
  /** Resource server name */
  resource_server_name?: string
  /** Permission description */
  description?: string
}

/**
 * Parameters for assigning roles to a user
 */
export interface AssignRolesParams {
  /** User ID */
  user_id: string
  /** Array of role IDs to assign */
  roles: string[]
}

/**
 * Parameters for removing roles from a user
 */
export interface RemoveRolesParams {
  /** User ID */
  user_id: string
  /** Array of role IDs to remove */
  roles: string[]
}

/**
 * Parameters for assigning permissions to a user
 */
export interface AssignPermissionsParams {
  /** User ID */
  user_id: string
  /** Array of permissions to assign */
  permissions: Array<{
    permission_name: string
    resource_server_identifier: string
  }>
}

/**
 * Parameters for removing permissions from a user
 */
export interface RemovePermissionsParams {
  /** User ID */
  user_id: string
  /** Array of permissions to remove */
  permissions: Array<{
    permission_name: string
    resource_server_identifier: string
  }>
}

// ============================================================================
// USER BLOCKS
// ============================================================================

/**
 * User block information
 */
export interface UserBlock {
  /** Block identifier */
  identifier: string
  /** IP address that triggered the block */
  ip?: string
}

// ============================================================================
// LOGS
// ============================================================================

/**
 * User log entry
 */
export interface LogEvent {
  /** Log ID */
  log_id: string
  /** Log date */
  date: string
  /** Event type code */
  type: string
  /** Client ID */
  client_id?: string
  /** Client name */
  client_name?: string
  /** IP address */
  ip?: string
  /** Location info */
  location_info?: {
    country_code?: string
    country_code3?: string
    country_name?: string
    city_name?: string
    latitude?: number
    longitude?: number
    time_zone?: string
    continent_code?: string
  }
  /** User agent */
  user_agent?: string
  /** User ID */
  user_id?: string
  /** User name */
  user_name?: string
  /** Connection */
  connection?: string
  /** Connection ID */
  connection_id?: string
  /** Description */
  description?: string
  /** Hostname */
  hostname?: string
  /** Scope */
  scope?: string
  /** Audience */
  audience?: string
  /** Strategy */
  strategy?: string
  /** Strategy type */
  strategy_type?: string
}

/**
 * Parameters for getting user logs
 */
export interface GetUserLogsParams {
  /** User ID */
  user_id: string
  /** Number of results per page */
  per_page?: number
  /** Page index */
  page?: number
  /** Sort order */
  sort?: string
  /** Include totals */
  include_totals?: boolean
}

// ============================================================================
// CLIENT OPTIONS
// ============================================================================

/**
 * Management API client options
 */
export interface ManagementClientOptions {
  /** Auth0 domain (e.g., 'tenant.auth0.com') */
  domain: string
  /** Client ID (for client credentials grant) */
  clientId?: string
  /** Client secret (for client credentials grant) */
  clientSecret?: string
  /** Management API token (alternative to client credentials) */
  token?: string
  /** API audience (defaults to https://{domain}/api/v2/) */
  audience?: string
  /** Token provider (for custom token management) */
  tokenProvider?: {
    getAccessToken: () => Promise<string>
  }
  /** HTTP timeout in milliseconds */
  timeoutDuration?: number
  /** Retry options */
  retry?: {
    enabled?: boolean
    maxRetries?: number
  }
  /** Custom headers */
  headers?: Record<string, string>
}

// ============================================================================
// ERROR TYPES
// ============================================================================

/**
 * Auth0 Management API error
 */
export interface ManagementApiError {
  /** HTTP status code */
  statusCode: number
  /** Error message */
  message: string
  /** Error code */
  error?: string
  /** Error description */
  errorCode?: string
  /** Additional error details */
  details?: Record<string, unknown>
}

/**
 * Auth0 Management API error class
 */
export class Auth0ManagementError extends Error implements ManagementApiError {
  statusCode: number
  error?: string
  errorCode?: string
  details?: Record<string, unknown>

  constructor(message: string, statusCode: number, errorCode?: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'Auth0ManagementError'
    this.statusCode = statusCode
    this.errorCode = errorCode
    this.details = details
  }
}

// ============================================================================
// INTERNAL STORAGE TYPES
// ============================================================================

/**
 * Internal user record (with password hash and tokens)
 */
export interface UserRecord extends User {
  /** Hashed password */
  password_hash?: string
  /** When password was last changed */
  password_changed_at?: string
  /** Email verification token hash */
  email_verification_token?: string
  /** When email verification was sent */
  email_verification_sent_at?: string
  /** Password reset token hash */
  password_reset_token?: string
  /** When password reset was sent */
  password_reset_sent_at?: string
  /** Number of failed login attempts */
  failed_login_attempts?: number
  /** Account locked until */
  locked_until?: string
  /** User's roles */
  roles?: string[]
  /** User's direct permissions */
  permissions?: Permission[]
}
