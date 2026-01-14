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

// ============================================================================
// ORGANIZATION TYPES
// ============================================================================

/**
 * Auth0 organization
 */
export interface Auth0Organization {
  id: string
  name: string
  display_name?: string
  branding?: OrganizationBranding
  metadata?: Record<string, unknown>
  enabled_connections?: OrganizationConnection[]
}

/**
 * Organization branding configuration
 */
export interface OrganizationBranding {
  logo_url?: string
  colors?: {
    primary?: string
    page_background?: string
  }
}

/**
 * Organization enabled connection
 */
export interface OrganizationConnection {
  connection_id: string
  assign_membership_on_login?: boolean
  show_as_button?: boolean
}

/**
 * Create organization parameters
 */
export interface CreateOrganizationParams {
  name: string
  display_name?: string
  branding?: OrganizationBranding
  metadata?: Record<string, unknown>
  enabled_connections?: OrganizationConnection[]
}

/**
 * Update organization parameters
 */
export interface UpdateOrganizationParams {
  name?: string
  display_name?: string
  branding?: OrganizationBranding
  metadata?: Record<string, unknown>
}

/**
 * Organization member
 */
export interface Auth0OrganizationMember {
  user_id: string
  email?: string
  name?: string
  picture?: string
  roles?: Auth0Role[]
}

/**
 * Add organization members parameters
 */
export interface AddOrganizationMembersParams {
  members: string[] // user_ids
}

/**
 * Organization member role
 */
export interface OrganizationMemberRole {
  id: string
  name: string
  description?: string
}

/**
 * Add member roles parameters
 */
export interface AddMemberRolesParams {
  roles: string[] // role_ids
}

/**
 * Organization invitation
 */
export interface Auth0OrganizationInvitation {
  id: string
  organization_id: string
  inviter: {
    name?: string
  }
  invitee: {
    email: string
  }
  invitation_url?: string
  ticket_id?: string
  created_at: string
  expires_at: string
  client_id: string
  connection_id?: string
  app_metadata?: Record<string, unknown>
  user_metadata?: Record<string, unknown>
  roles?: string[]
  send_invitation_email?: boolean
}

/**
 * Create organization invitation parameters
 */
export interface CreateOrganizationInvitationParams {
  inviter: {
    name?: string
  }
  invitee: {
    email: string
  }
  client_id: string
  connection_id?: string
  ttl_sec?: number
  app_metadata?: Record<string, unknown>
  user_metadata?: Record<string, unknown>
  roles?: string[]
  send_invitation_email?: boolean
}

/**
 * Add organization connection parameters
 */
export interface AddOrganizationConnectionParams {
  connection_id: string
  assign_membership_on_login?: boolean
  show_as_button?: boolean
}

// ============================================================================
// RULES TYPES (Legacy)
// ============================================================================

/**
 * Auth0 Rule definition
 * Rules are JavaScript functions that execute during authentication
 */
export interface Auth0Rule {
  /** Unique rule identifier */
  id: string
  /** Rule name */
  name: string
  /** Rule script (JavaScript code as string) */
  script: string
  /** Order of execution (lower = earlier) */
  order: number
  /** Whether the rule is enabled */
  enabled: boolean
  /** Stage of rule execution */
  stage?: 'login_success' | 'login_failure' | 'pre_authorize'
  /** Creation timestamp */
  created_at?: string
  /** Last update timestamp */
  updated_at?: string
}

/**
 * Rule creation parameters
 */
export interface CreateAuth0RuleParams {
  name: string
  script: string
  order?: number
  enabled?: boolean
  stage?: 'login_success' | 'login_failure' | 'pre_authorize'
}

/**
 * Rule update parameters
 */
export interface UpdateAuth0RuleParams {
  name?: string
  script?: string
  order?: number
  enabled?: boolean
  stage?: 'login_success' | 'login_failure' | 'pre_authorize'
}

/**
 * Rule execution context - passed to rules as the `context` parameter
 */
export interface RuleContext {
  /** Client ID */
  clientID: string
  /** Client name */
  clientName?: string
  /** Client metadata */
  clientMetadata?: Record<string, unknown>
  /** Connection name */
  connection: string
  /** Connection strategy */
  connectionStrategy: string
  /** Request protocol */
  protocol: string
  /** Request details */
  request?: {
    userAgent?: string
    ip?: string
    hostname?: string
    query?: Record<string, string>
    body?: Record<string, unknown>
    geoip?: {
      country_code?: string
      country_name?: string
      city_name?: string
      latitude?: number
      longitude?: number
      time_zone?: string
    }
  }
  /** SAML configuration (if applicable) */
  samlConfiguration?: Record<string, unknown>
  /** Single Sign-On state */
  sso?: {
    with_auth0: boolean
    with_dbconn: boolean
    current_clients: string[]
  }
  /** Access token claims to add */
  accessToken?: Record<string, unknown>
  /** ID token claims to add */
  idToken?: Record<string, unknown>
  /** Multi-factor authentication */
  multifactor?: {
    provider: string
    allowRememberBrowser?: boolean
  }
  /** Redirect URL (for redirecting during authentication) */
  redirect?: {
    url: string
  }
  /** Session ID */
  sessionID?: string
  /** Stats about the authentication */
  stats?: {
    loginsCount: number
  }
  /** Primary user ID for account linking */
  primaryUser?: string
}

/**
 * Rule callback function signature
 */
export type RuleCallback = (error: Error | null, user?: Auth0User, context?: RuleContext) => void

/**
 * Rule function signature (legacy format)
 * function(user, context, callback)
 */
export type RuleFunction = (user: Auth0User, context: RuleContext, callback: RuleCallback) => void

/**
 * Async rule function signature (modern format)
 * async function(user, context)
 */
export type AsyncRuleFunction = (user: Auth0User, context: RuleContext) => Promise<{ user: Auth0User; context: RuleContext }>

// ============================================================================
// ACTIONS TYPES (Modern)
// ============================================================================

/**
 * Auth0 Action triggers
 */
export type ActionTrigger =
  | 'post-login'
  | 'pre-user-registration'
  | 'post-user-registration'
  | 'post-change-password'
  | 'send-phone-message'
  | 'credentials-exchange'
  | 'm2m-credentials-exchange'
  | 'password-reset-post-challenge'

/**
 * Auth0 Action definition
 */
export interface Auth0Action {
  /** Unique action identifier */
  id: string
  /** Action name */
  name: string
  /** Supported triggers */
  supported_triggers: { id: ActionTrigger; version: string }[]
  /** Action code */
  code: string
  /** Dependencies */
  dependencies?: { name: string; version: string }[]
  /** Runtime version */
  runtime?: string
  /** Action status */
  status: 'built' | 'building' | 'failed' | 'pending'
  /** Secrets */
  secrets?: { name: string; value: string }[]
  /** Creation timestamp */
  created_at?: string
  /** Last update timestamp */
  updated_at?: string
  /** Last deployed timestamp */
  deployed_at?: string
}

/**
 * Action creation parameters
 */
export interface CreateActionParams {
  name: string
  supported_triggers: { id: ActionTrigger; version: string }[]
  code: string
  dependencies?: { name: string; version: string }[]
  runtime?: string
  secrets?: { name: string; value: string }[]
}

/**
 * Action update parameters
 */
export interface UpdateActionParams {
  name?: string
  code?: string
  dependencies?: { name: string; version: string }[]
  runtime?: string
  secrets?: { name: string; value: string }[]
}

/**
 * Trigger binding - binds an action to a trigger
 */
export interface TriggerBinding {
  /** Binding ID */
  id: string
  /** Trigger ID */
  trigger_id: ActionTrigger
  /** Action reference */
  action: {
    id: string
    name: string
  }
  /** Display name */
  display_name?: string
  /** Created timestamp */
  created_at?: string
  /** Updated timestamp */
  updated_at?: string
}

/**
 * Post-Login event for Actions
 */
export interface PostLoginEvent {
  /** Request information */
  request: {
    hostname: string
    ip: string
    method: string
    query: Record<string, string>
    body: Record<string, unknown>
    user_agent?: string
    geoip?: {
      countryCode?: string
      countryName?: string
      cityName?: string
      latitude?: number
      longitude?: number
      timeZone?: string
    }
  }
  /** Transaction details */
  transaction?: {
    id: string
    acr_values?: string[]
    locale?: string
    protocol?: string
    requested_scopes?: string[]
    redirect_uri?: string
    response_mode?: string
    response_type?: string[]
    state?: string
    ui_locales?: string[]
  }
  /** Client application */
  client: {
    client_id: string
    name: string
    metadata?: Record<string, unknown>
  }
  /** Connection info */
  connection: {
    id: string
    name: string
    strategy: string
    metadata?: Record<string, unknown>
  }
  /** User info */
  user: {
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
    created_at?: string
    updated_at?: string
    identities?: Array<{
      connection: string
      user_id: string
      provider: string
      isSocial: boolean
    }>
    user_metadata?: Record<string, unknown>
    app_metadata?: Record<string, unknown>
  }
  /** Authentication info */
  authentication?: {
    methods: Array<{
      name: string
      timestamp: string
    }>
  }
  /** Authorization info */
  authorization?: {
    roles: string[]
  }
  /** Stats */
  stats?: {
    logins_count: number
  }
  /** Secrets configured for the action */
  secrets?: Record<string, string>
  /** Resource server (if applicable) */
  resource_server?: {
    identifier: string
  }
  /** Organization (if applicable) */
  organization?: {
    id: string
    name: string
    display_name?: string
    metadata?: Record<string, unknown>
  }
  /** Session */
  session?: {
    id: string
    created_at?: string
    idle_expires_at?: string
    authentication?: {
      methods: Array<{
        name: string
        timestamp: string
      }>
    }
  }
}

/**
 * Post-Login API for Actions
 */
export interface PostLoginApi {
  /** Access token manipulation */
  accessToken: {
    /** Set a custom claim */
    setCustomClaim(name: string, value: unknown): void
    /** Add scope */
    addScope(scope: string): void
  }
  /** ID token manipulation */
  idToken: {
    /** Set a custom claim */
    setCustomClaim(name: string, value: unknown): void
  }
  /** User manipulation */
  user: {
    /** Set user metadata */
    setUserMetadata(key: string, value: unknown): void
    /** Set app metadata */
    setAppMetadata(key: string, value: unknown): void
  }
  /** Multi-factor authentication */
  multifactor: {
    /** Enable MFA */
    enable(provider: string, options?: { allowRememberBrowser?: boolean }): void
  }
  /** Access control */
  access: {
    /** Deny access with reason */
    deny(reason: string): void
  }
  /** Redirect */
  redirect: {
    /** Send to URL */
    sendUserTo(url: string, options?: { query?: Record<string, string> }): void
    /** Validate token */
    validateToken(options: { secret: string; tokenParameterName?: string }): { sub: string; [key: string]: unknown }
    /** Encode token */
    encodeToken(options: { secret: string; expiresInSeconds?: number; payload?: Record<string, unknown> }): string
  }
  /** Session manipulation */
  session: {
    /** Set session lifetime */
    setSessionLifetime(lifetime: number): void
    /** Set idle session lifetime */
    setIdleSessionLifetime(lifetime: number): void
  }
  /** SAML response */
  samlResponse?: {
    /** Set attribute */
    setAttribute(name: string, value: string | string[]): void
  }
  /** Cache for storing data between action invocations */
  cache: {
    /** Get cached value */
    get(key: string): { value: unknown } | undefined
    /** Set cached value */
    set(key: string, value: unknown, options?: { ttl?: number; expires_at?: number }): { type: 'success' | 'error' }
    /** Delete cached value */
    delete(key: string): { type: 'success' | 'error' }
  }
}

/**
 * Pre-User-Registration event
 */
export interface PreUserRegistrationEvent {
  request: {
    hostname: string
    ip: string
    method: string
    query: Record<string, string>
    body: Record<string, unknown>
    user_agent?: string
    geoip?: {
      countryCode?: string
      countryName?: string
      cityName?: string
    }
  }
  client: {
    client_id: string
    name: string
    metadata?: Record<string, unknown>
  }
  connection: {
    id: string
    name: string
    strategy: string
  }
  user: {
    email?: string
    phone_number?: string
    username?: string
    user_metadata?: Record<string, unknown>
    app_metadata?: Record<string, unknown>
  }
  secrets?: Record<string, string>
}

/**
 * Pre-User-Registration API
 */
export interface PreUserRegistrationApi {
  user: {
    setUserMetadata(key: string, value: unknown): void
    setAppMetadata(key: string, value: unknown): void
  }
  access: {
    deny(code: string, reason: string): void
  }
}

/**
 * Post-User-Registration event
 */
export interface PostUserRegistrationEvent {
  request: {
    hostname: string
    ip: string
    method: string
    query: Record<string, string>
    body: Record<string, unknown>
    user_agent?: string
    geoip?: {
      countryCode?: string
      countryName?: string
      cityName?: string
    }
  }
  client: {
    client_id: string
    name: string
    metadata?: Record<string, unknown>
  }
  connection: {
    id: string
    name: string
    strategy: string
  }
  user: {
    user_id: string
    email?: string
    email_verified?: boolean
    phone_number?: string
    phone_verified?: boolean
    username?: string
    name?: string
    user_metadata?: Record<string, unknown>
    app_metadata?: Record<string, unknown>
    created_at?: string
  }
  secrets?: Record<string, string>
}

/**
 * Post-User-Registration API
 */
export interface PostUserRegistrationApi {
  user: {
    setUserMetadata(key: string, value: unknown): void
    setAppMetadata(key: string, value: unknown): void
  }
}

/**
 * Action execution result
 */
export interface ActionResult {
  /** Whether execution was successful */
  success: boolean
  /** Error if failed */
  error?: {
    code: string
    message: string
  }
  /** Modified user */
  user?: Auth0User
  /** Token claims to add */
  accessTokenClaims?: Record<string, unknown>
  /** ID token claims to add */
  idTokenClaims?: Record<string, unknown>
  /** User metadata updates */
  userMetadataUpdates?: Record<string, unknown>
  /** App metadata updates */
  appMetadataUpdates?: Record<string, unknown>
  /** MFA config */
  multifactor?: {
    provider: string
    allowRememberBrowser?: boolean
  }
  /** Redirect URL */
  redirect?: {
    url: string
    query?: Record<string, string>
  }
  /** Access denied */
  accessDenied?: {
    reason: string
  }
  /** Session config */
  session?: {
    lifetime?: number
    idleLifetime?: number
  }
  /** Scopes to add */
  addedScopes?: string[]
}

/**
 * Action handler function type
 */
export type PostLoginHandler = (event: PostLoginEvent, api: PostLoginApi) => void | Promise<void>
export type PreUserRegistrationHandler = (event: PreUserRegistrationEvent, api: PreUserRegistrationApi) => void | Promise<void>
export type PostUserRegistrationHandler = (event: PostUserRegistrationEvent, api: PostUserRegistrationApi) => void | Promise<void>
