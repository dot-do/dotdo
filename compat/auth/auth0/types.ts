/**
 * @dotdo/auth0 - Auth0 Type Definitions
 *
 * Types compatible with Auth0's API for drop-in replacement.
 *
 * @module
 */

// ============================================================================
// USER TYPES
// ============================================================================

/**
 * Auth0 user object
 */
export interface Auth0User {
  user_id: string
  email?: string
  email_verified?: boolean
  phone_number?: string
  phone_verified?: boolean
  username?: string
  name?: string
  nickname?: string
  given_name?: string
  family_name?: string
  picture?: string
  created_at: string
  updated_at: string
  last_login?: string
  last_ip?: string
  logins_count?: number
  identities?: Auth0Identity[]
  user_metadata?: Record<string, unknown>
  app_metadata?: Record<string, unknown>
  blocked?: boolean
  multifactor?: string[]
}

/**
 * Auth0 user identity
 */
export interface Auth0Identity {
  connection: string
  user_id: string
  provider: string
  isSocial: boolean
  access_token?: string
  access_token_secret?: string
  refresh_token?: string
  profileData?: Record<string, unknown>
}

/**
 * Create user parameters
 */
export interface CreateUserParams {
  email?: string
  phone_number?: string
  username?: string
  password?: string
  connection: string
  name?: string
  nickname?: string
  given_name?: string
  family_name?: string
  picture?: string
  user_metadata?: Record<string, unknown>
  app_metadata?: Record<string, unknown>
  email_verified?: boolean
  phone_verified?: boolean
  verify_email?: boolean
}

/**
 * Update user parameters
 */
export interface UpdateUserParams {
  email?: string
  phone_number?: string
  username?: string
  password?: string
  name?: string
  nickname?: string
  given_name?: string
  family_name?: string
  picture?: string
  user_metadata?: Record<string, unknown>
  app_metadata?: Record<string, unknown>
  email_verified?: boolean
  phone_verified?: boolean
  blocked?: boolean
  connection?: string
  client_id?: string
}

// ============================================================================
// CONNECTION TYPES
// ============================================================================

/**
 * Auth0 connection
 */
export interface Auth0Connection {
  id: string
  name: string
  strategy: string
  options?: ConnectionOptions
  enabled_clients?: string[]
  realms?: string[]
  is_domain_connection?: boolean
  metadata?: Record<string, unknown>
}

/**
 * Connection options
 */
export interface ConnectionOptions {
  validation?: {
    username?: {
      min?: number
      max?: number
    }
  }
  passwordPolicy?: 'none' | 'low' | 'fair' | 'good' | 'excellent'
  password_complexity_options?: {
    min_length?: number
  }
  enabledDatabaseCustomization?: boolean
  import_mode?: boolean
  requires_username?: boolean
  brute_force_protection?: boolean
  disable_signup?: boolean
  [key: string]: unknown
}

/**
 * Create connection parameters
 */
export interface CreateConnectionParams {
  name: string
  strategy: string
  options?: ConnectionOptions
  enabled_clients?: string[]
  realms?: string[]
  is_domain_connection?: boolean
  metadata?: Record<string, unknown>
}

// ============================================================================
// ROLE TYPES
// ============================================================================

/**
 * Auth0 role
 */
export interface Auth0Role {
  id: string
  name: string
  description?: string
}

/**
 * Create role parameters
 */
export interface CreateRoleParams {
  name: string
  description?: string
}

/**
 * Auth0 permission
 */
export interface Auth0Permission {
  permission_name: string
  description?: string
  resource_server_identifier: string
  resource_server_name?: string
}

// ============================================================================
// CLIENT/APPLICATION TYPES
// ============================================================================

/**
 * Auth0 client (application)
 */
export interface Auth0Client {
  client_id: string
  client_secret?: string
  name: string
  description?: string
  logo_uri?: string
  callbacks?: string[]
  allowed_origins?: string[]
  web_origins?: string[]
  allowed_logout_urls?: string[]
  grant_types?: string[]
  jwt_configuration?: {
    lifetime_in_seconds?: number
    secret_encoded?: boolean
    alg?: string
  }
  token_endpoint_auth_method?: 'none' | 'client_secret_post' | 'client_secret_basic'
  app_type?: 'native' | 'spa' | 'regular_web' | 'non_interactive'
  is_first_party?: boolean
  oidc_conformant?: boolean
  custom_login_page_on?: boolean
  cross_origin_auth?: boolean
}

/**
 * Create client parameters
 */
export interface CreateClientParams {
  name: string
  description?: string
  logo_uri?: string
  callbacks?: string[]
  allowed_origins?: string[]
  web_origins?: string[]
  allowed_logout_urls?: string[]
  grant_types?: string[]
  jwt_configuration?: {
    lifetime_in_seconds?: number
    secret_encoded?: boolean
    alg?: string
  }
  token_endpoint_auth_method?: 'none' | 'client_secret_post' | 'client_secret_basic'
  app_type?: 'native' | 'spa' | 'regular_web' | 'non_interactive'
  is_first_party?: boolean
  oidc_conformant?: boolean
}

// ============================================================================
// AUTHENTICATION TYPES
// ============================================================================

/**
 * Token response
 */
export interface TokenResponse {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  refresh_token?: string
  id_token?: string
  scope?: string
}

/**
 * Authorization parameters
 */
export interface AuthorizationParams {
  response_type: 'code' | 'token' | 'id_token' | 'code id_token' | 'code token' | 'token id_token' | 'code token id_token'
  client_id: string
  redirect_uri: string
  scope: string
  state?: string
  nonce?: string
  audience?: string
  connection?: string
  prompt?: 'none' | 'login' | 'consent' | 'select_account'
  login_hint?: string
  max_age?: number
  acr_values?: string
  code_challenge?: string
  code_challenge_method?: 'plain' | 'S256'
}

/**
 * Token exchange parameters
 */
export interface TokenExchangeParams {
  grant_type: 'authorization_code' | 'refresh_token' | 'client_credentials' | 'password' | 'urn:ietf:params:oauth:grant-type:device_code'
  client_id: string
  client_secret?: string
  code?: string
  redirect_uri?: string
  refresh_token?: string
  scope?: string
  audience?: string
  username?: string
  password?: string
  code_verifier?: string
  device_code?: string
  realm?: string
}

/**
 * Signup parameters
 */
export interface SignupParams {
  client_id: string
  email: string
  password: string
  connection: string
  username?: string
  given_name?: string
  family_name?: string
  name?: string
  nickname?: string
  picture?: string
  user_metadata?: Record<string, unknown>
}

/**
 * Change password parameters
 */
export interface ChangePasswordParams {
  client_id: string
  email: string
  connection: string
}

/**
 * Passwordless start parameters
 */
export interface PasswordlessStartParams {
  client_id: string
  client_secret?: string
  connection: 'email' | 'sms'
  email?: string
  phone_number?: string
  send?: 'link' | 'code'
  authParams?: {
    scope?: string
    state?: string
    redirect_uri?: string
    response_type?: string
  }
}

/**
 * Passwordless verify parameters
 */
export interface PasswordlessVerifyParams {
  client_id: string
  client_secret?: string
  connection: 'email' | 'sms'
  email?: string
  phone_number?: string
  verification_code: string
  scope?: string
  audience?: string
}

// ============================================================================
// MFA TYPES
// ============================================================================

/**
 * MFA enrollment
 */
export interface Auth0MFAEnrollment {
  id: string
  authenticator_type: 'otp' | 'oob' | 'recovery-code'
  active: boolean
  name?: string
  phone_number?: string
  email?: string
  created_at?: string
  enrolled_at?: string
  last_auth?: string
}

/**
 * MFA challenge
 */
export interface Auth0MFAChallenge {
  challenge_type: 'otp' | 'oob'
  oob_code?: string
  binding_method?: string
}

// ============================================================================
// LOG TYPES
// ============================================================================

/**
 * Auth0 log event
 */
export interface Auth0Log {
  _id: string
  log_id: string
  date: string
  type: string
  description?: string
  connection?: string
  connection_id?: string
  client_id?: string
  client_name?: string
  ip?: string
  user_agent?: string
  hostname?: string
  user_id?: string
  user_name?: string
  audience?: string
  scope?: string[]
  strategy?: string
  strategy_type?: string
  location_info?: {
    city_name?: string
    country_code?: string
    country_name?: string
    latitude?: number
    longitude?: number
    time_zone?: string
  }
  details?: Record<string, unknown>
}

// ============================================================================
// API ERROR TYPES
// ============================================================================

/**
 * Auth0 API error
 */
export interface Auth0Error {
  statusCode: number
  error: string
  message: string
  errorCode?: string
}

/**
 * Auth0 error class
 */
export class Auth0APIError extends Error {
  statusCode: number
  error: string
  errorCode?: string

  constructor(statusCode: number, error: string, message: string, errorCode?: string) {
    super(message)
    this.name = 'Auth0APIError'
    this.statusCode = statusCode
    this.error = error
    this.errorCode = errorCode
  }

  toJSON(): Auth0Error {
    return {
      statusCode: this.statusCode,
      error: this.error,
      message: this.message,
      errorCode: this.errorCode,
    }
  }
}

// ============================================================================
// PAGINATION TYPES
// ============================================================================

/**
 * Pagination parameters
 */
export interface PaginationParams {
  page?: number
  per_page?: number
  include_totals?: boolean
  sort?: string
  fields?: string
  include_fields?: boolean
  q?: string
}

/**
 * Paginated response
 */
export interface PaginatedResponse<T> {
  start: number
  limit: number
  length: number
  total?: number
  [key: string]: T[] | number | undefined
}

// ============================================================================
// RESOURCE SERVER TYPES
// ============================================================================

/**
 * Auth0 resource server (API)
 */
export interface Auth0ResourceServer {
  id: string
  name: string
  identifier: string
  scopes?: { value: string; description?: string }[]
  signing_alg?: string
  signing_secret?: string
  token_lifetime?: number
  token_lifetime_for_web?: number
  skip_consent_for_verifiable_first_party_clients?: boolean
  enforce_policies?: boolean
  token_dialect?: 'access_token' | 'access_token_authz'
}

/**
 * Create resource server parameters
 */
export interface CreateResourceServerParams {
  name: string
  identifier: string
  scopes?: { value: string; description?: string }[]
  signing_alg?: string
  signing_secret?: string
  token_lifetime?: number
  token_lifetime_for_web?: number
  skip_consent_for_verifiable_first_party_clients?: boolean
  enforce_policies?: boolean
  token_dialect?: 'access_token' | 'access_token_authz'
}
