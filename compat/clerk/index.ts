/**
 * @dotdo/clerk - Clerk SDK Compat Layer for Cloudflare Workers
 *
 * Drop-in replacement for the Clerk Backend SDK that runs on Cloudflare Workers
 * with edge-optimized performance. Implements the Clerk Backend API.
 *
 * @example Basic Usage
 * ```typescript
 * import { Clerk } from '@dotdo/clerk'
 *
 * const clerk = new Clerk({ secretKey: 'sk_test_xxx' })
 *
 * // Get a session
 * const session = await clerk.sessions.getSession('sess_xxx')
 *
 * // List sessions for a user
 * const { data, total_count } = await clerk.sessions.listSessions({
 *   userId: 'user_xxx',
 * })
 *
 * // Revoke a session
 * await clerk.sessions.revokeSession('sess_xxx')
 * ```
 *
 * @see https://clerk.com/docs/reference/backend-api
 * @module
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Session status enum matching Clerk API
 */
export type SessionStatus =
  | 'active'
  | 'expired'
  | 'revoked'
  | 'abandoned'
  | 'removed'
  | 'replaced'
  | 'ended'

/**
 * Actor information for impersonation sessions
 */
export interface SessionActor {
  sub: string
  actor_id?: string
}

/**
 * Clerk session object matching the Clerk API response format
 */
export interface Session {
  id: string
  object: 'session'
  client_id: string
  user_id: string
  status: SessionStatus
  last_active_at: number
  expire_at: number
  abandon_at: number
  created_at: number
  updated_at: number
  last_active_organization_id?: string
  actor?: SessionActor
}

/**
 * Session list response with pagination info
 */
export interface SessionList {
  data: Session[]
  total_count: number
}

/**
 * Session token response
 */
export interface SessionToken {
  object: 'token'
  jwt: string
}

/**
 * Parameters for creating a session
 */
export interface CreateSessionParams {
  userId: string
  expireAt?: number
  actor?: {
    sub: string
  }
}

/**
 * Parameters for revoking a session
 */
export interface RevokeSessionParams {
  sessionId: string
}

/**
 * Parameters for listing sessions
 */
export interface ListSessionsParams {
  userId?: string
  clientId?: string
  status?: SessionStatus
  limit?: number
  offset?: number
}

/**
 * Parameters for verifying a session
 */
export interface VerifySessionOptions {
  token: string
}

/**
 * Parameters for getting a session token
 */
export interface GetSessionTokenParams {
  template?: string
}

// ============================================================================
// ORGANIZATION TYPES
// ============================================================================

/**
 * Clerk organization object matching the Clerk API response format
 */
export interface Organization {
  id: string
  object: 'organization'
  name: string
  slug: string
  image_url: string | null
  has_image: boolean
  members_count: number
  pending_invitations_count: number
  max_allowed_memberships: number
  admin_delete_enabled: boolean
  public_metadata: Record<string, unknown>
  private_metadata: Record<string, unknown>
  created_by: string
  created_at: number
  updated_at: number
}

/**
 * Organization list response with pagination info
 */
export interface OrganizationList {
  data: Organization[]
  total_count: number
}

/**
 * Parameters for creating an organization
 */
export interface CreateOrganizationParams {
  name: string
  slug?: string
  createdBy?: string
  maxAllowedMemberships?: number
  publicMetadata?: Record<string, unknown>
  privateMetadata?: Record<string, unknown>
}

/**
 * Parameters for updating an organization
 */
export interface UpdateOrganizationParams {
  name?: string
  slug?: string
  maxAllowedMemberships?: number
  adminDeleteEnabled?: boolean
  publicMetadata?: Record<string, unknown>
  privateMetadata?: Record<string, unknown>
}

/**
 * Parameters for listing organizations
 */
export interface ListOrganizationsParams {
  userId?: string
  includeMembersCount?: boolean
  limit?: number
  offset?: number
  orderBy?: string
  query?: string
}

/**
 * Parameters for updating organization metadata
 */
export interface UpdateOrganizationMetadataParams {
  publicMetadata?: Record<string, unknown>
  privateMetadata?: Record<string, unknown>
}

/**
 * Parameters for updating organization logo
 */
export interface UpdateOrganizationLogoParams {
  file: File
  uploaderUserId?: string
}

/**
 * Get organization params - can be ID string or object with slug
 */
export type GetOrganizationParams = string | { slug: string }

// ============================================================================
// USER TYPES
// ============================================================================

/**
 * Email address object for a user
 */
export interface EmailAddress {
  id: string
  object: 'email_address'
  email_address: string
  verification: {
    status: 'verified' | 'unverified' | 'transferable' | 'failed' | 'expired'
    strategy?: string
    attempts?: number
    expire_at?: number
  } | null
  linked_to: { id: string; type: string }[]
  created_at: number
  updated_at: number
}

/**
 * Phone number object for a user
 */
export interface PhoneNumber {
  id: string
  object: 'phone_number'
  phone_number: string
  reserved_for_second_factor: boolean
  default_second_factor: boolean
  verification: {
    status: 'verified' | 'unverified' | 'transferable' | 'failed' | 'expired'
    strategy?: string
    attempts?: number
    expire_at?: number
  } | null
  linked_to: { id: string; type: string }[]
  created_at: number
  updated_at: number
}

/**
 * External account (OAuth provider)
 */
export interface ExternalAccount {
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
  verification: {
    status: 'verified' | 'unverified' | 'transferable' | 'failed' | 'expired'
    strategy?: string
    expire_at?: number
    attempts?: number
    error?: { code: string; message: string }
  } | null
}

/**
 * Clerk user object matching the Clerk API response format
 */
export interface User {
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
  email_addresses: EmailAddress[]
  phone_numbers: PhoneNumber[]
  external_accounts: ExternalAccount[]
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
  last_active_at: number | null
  profile_image_url: string
}

/**
 * User list response with pagination info
 */
export interface UserList {
  data: User[]
  total_count: number
}

/**
 * Parameters for creating a user
 */
export interface CreateUserParams {
  emailAddress?: string[]
  phoneNumber?: string[]
  username?: string
  password?: string
  firstName?: string
  lastName?: string
  externalId?: string
  publicMetadata?: Record<string, unknown>
  privateMetadata?: Record<string, unknown>
  unsafeMetadata?: Record<string, unknown>
  skipPasswordChecks?: boolean
  skipPasswordRequirement?: boolean
  totpSecret?: string
  backupCodes?: string[]
  createdAt?: string
}

/**
 * Parameters for updating a user
 */
export interface UpdateUserParams {
  username?: string
  password?: string
  firstName?: string
  lastName?: string
  primaryEmailAddressId?: string
  primaryPhoneNumberId?: string
  primaryWeb3WalletId?: string
  externalId?: string
  publicMetadata?: Record<string, unknown>
  privateMetadata?: Record<string, unknown>
  unsafeMetadata?: Record<string, unknown>
  profileImageId?: string
  totpSecret?: string
  backupCodes?: string[]
  skipPasswordChecks?: boolean
  signOutOfOtherSessions?: boolean
  deleteProfileImage?: boolean
  createOrganizationEnabled?: boolean
  createOrganizationsLimit?: number
}

/**
 * Parameters for listing users
 */
export interface ListUsersParams {
  emailAddress?: string[]
  phoneNumber?: string[]
  externalId?: string[]
  username?: string[]
  web3Wallet?: string[]
  userId?: string[]
  organizationId?: string[]
  query?: string
  lastActiveAtSince?: number
  limit?: number
  offset?: number
  orderBy?: string
}

/**
 * Parameters for verifying a user's email
 */
export interface VerifyEmailParams {
  emailAddressId: string
}

/**
 * Parameters for verifying a user's phone
 */
export interface VerifyPhoneParams {
  phoneNumberId: string
}

/**
 * Parameters for updating user metadata
 */
export interface UpdateUserMetadataParams {
  publicMetadata?: Record<string, unknown>
  privateMetadata?: Record<string, unknown>
  unsafeMetadata?: Record<string, unknown>
}

/**
 * Parameters for banning a user
 */
export interface BanUserParams {
  userId: string
}

/**
 * Parameters for unlocking a user
 */
export interface UnlockUserParams {
  userId: string
}

/**
 * Deleted object response
 */
export interface DeletedObject {
  object: string
  id: string
  slug?: string
  deleted: boolean
}

/**
 * Clerk client configuration options
 */
export interface ClerkOptions {
  secretKey: string
  publishableKey?: string
  apiUrl?: string
  apiVersion?: string
}

/**
 * Clerk API error structure
 */
export interface ClerkError {
  code: string
  message: string
  long_message?: string
  meta?: Record<string, unknown>
}

// ============================================================================
// ERROR CLASS
// ============================================================================

/**
 * Custom error class for Clerk API errors
 */
export class ClerkAPIError extends Error {
  code: string
  status: number
  errors: ClerkError[]
  meta?: Record<string, unknown>

  constructor(response: { errors: ClerkError[] }, status: number) {
    const firstError = response.errors[0]
    super(firstError?.message || 'Unknown Clerk API error')
    this.name = 'ClerkAPIError'
    this.code = firstError?.code || 'unknown_error'
    this.status = status
    this.errors = response.errors
    this.meta = firstError?.meta
  }
}

// ============================================================================
// SESSIONS RESOURCE
// ============================================================================

/**
 * Sessions resource for managing Clerk sessions
 */
class SessionsResource {
  private client: Clerk

  constructor(client: Clerk) {
    this.client = client
  }

  /**
   * Create a new session for a user
   */
  async createSession(params: CreateSessionParams): Promise<Session> {
    const body: Record<string, unknown> = {
      user_id: params.userId,
    }
    if (params.expireAt !== undefined) {
      body.expire_at = params.expireAt
    }
    if (params.actor !== undefined) {
      body.actor = params.actor
    }

    return this.client.request<Session>('/v1/sessions', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  /**
   * Get a session by ID
   */
  async getSession(sessionId: string): Promise<Session> {
    return this.client.request<Session>(`/v1/sessions/${sessionId}`, {
      method: 'GET',
    })
  }

  /**
   * Revoke a session by ID
   */
  async revokeSession(sessionId: string): Promise<Session> {
    return this.client.request<Session>(`/v1/sessions/${sessionId}/revoke`, {
      method: 'POST',
    })
  }

  /**
   * List sessions with optional filters
   */
  async listSessions(params?: ListSessionsParams): Promise<SessionList> {
    const searchParams = new URLSearchParams()

    if (params?.userId) {
      searchParams.set('user_id', params.userId)
    }
    if (params?.clientId) {
      searchParams.set('client_id', params.clientId)
    }
    if (params?.status) {
      searchParams.set('status', params.status)
    }
    if (params?.limit !== undefined) {
      searchParams.set('limit', String(params.limit))
    }
    if (params?.offset !== undefined) {
      searchParams.set('offset', String(params.offset))
    }

    const queryString = searchParams.toString()
    const path = queryString ? `/v1/sessions?${queryString}` : '/v1/sessions'

    return this.client.request<SessionList>(path, {
      method: 'GET',
    })
  }

  /**
   * Verify a session token
   */
  async verifySession(sessionId: string, token: string): Promise<SessionToken> {
    return this.client.request<SessionToken>(`/v1/sessions/${sessionId}/verify`, {
      method: 'POST',
      body: JSON.stringify({ token }),
    })
  }

  /**
   * Get a new token for a session
   */
  async getSessionToken(sessionId: string, params?: GetSessionTokenParams): Promise<SessionToken> {
    const body: Record<string, unknown> = {}
    if (params?.template) {
      body.template = params.template
    }

    return this.client.request<SessionToken>(`/v1/sessions/${sessionId}/tokens`, {
      method: 'POST',
      body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
    })
  }
}

// ============================================================================
// ORGANIZATIONS RESOURCE
// ============================================================================

/**
 * Organizations resource for managing Clerk organizations
 */
class OrganizationsResource {
  private client: Clerk

  constructor(client: Clerk) {
    this.client = client
  }

  /**
   * Create a new organization
   */
  async createOrganization(params: CreateOrganizationParams): Promise<Organization> {
    const body: Record<string, unknown> = {
      name: params.name,
    }

    if (params.slug !== undefined) {
      body.slug = params.slug
    }
    if (params.createdBy !== undefined) {
      body.created_by = params.createdBy
    }
    if (params.maxAllowedMemberships !== undefined) {
      body.max_allowed_memberships = params.maxAllowedMemberships
    }
    if (params.publicMetadata !== undefined) {
      body.public_metadata = params.publicMetadata
    }
    if (params.privateMetadata !== undefined) {
      body.private_metadata = params.privateMetadata
    }

    return this.client.request<Organization>('/v1/organizations', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  /**
   * Get an organization by ID or slug
   */
  async getOrganization(params: GetOrganizationParams): Promise<Organization> {
    if (typeof params === 'string') {
      return this.client.request<Organization>(`/v1/organizations/${params}`, {
        method: 'GET',
      })
    }

    // Get by slug - use query parameter
    return this.client.request<Organization>(`/v1/organizations/${params.slug}`, {
      method: 'GET',
    })
  }

  /**
   * Update an organization by ID
   */
  async updateOrganization(organizationId: string, params: UpdateOrganizationParams): Promise<Organization> {
    const body: Record<string, unknown> = {}

    if (params.name !== undefined) {
      body.name = params.name
    }
    if (params.slug !== undefined) {
      body.slug = params.slug
    }
    if (params.maxAllowedMemberships !== undefined) {
      body.max_allowed_memberships = params.maxAllowedMemberships
    }
    if (params.adminDeleteEnabled !== undefined) {
      body.admin_delete_enabled = params.adminDeleteEnabled
    }
    if (params.publicMetadata !== undefined) {
      body.public_metadata = params.publicMetadata
    }
    if (params.privateMetadata !== undefined) {
      body.private_metadata = params.privateMetadata
    }

    return this.client.request<Organization>(`/v1/organizations/${organizationId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
  }

  /**
   * Delete an organization by ID
   */
  async deleteOrganization(organizationId: string): Promise<Organization> {
    return this.client.request<Organization>(`/v1/organizations/${organizationId}`, {
      method: 'DELETE',
    })
  }

  /**
   * List organizations with optional filters
   */
  async listOrganizations(params?: ListOrganizationsParams): Promise<OrganizationList> {
    const searchParams = new URLSearchParams()

    if (params?.userId) {
      searchParams.set('user_id', params.userId)
    }
    if (params?.includeMembersCount) {
      searchParams.set('include_members_count', String(params.includeMembersCount))
    }
    if (params?.limit !== undefined) {
      searchParams.set('limit', String(params.limit))
    }
    if (params?.offset !== undefined) {
      searchParams.set('offset', String(params.offset))
    }
    if (params?.orderBy) {
      searchParams.set('order_by', params.orderBy)
    }
    if (params?.query) {
      searchParams.set('query', params.query)
    }

    const queryString = searchParams.toString()
    const path = queryString ? `/v1/organizations?${queryString}` : '/v1/organizations'

    return this.client.request<OrganizationList>(path, {
      method: 'GET',
    })
  }

  /**
   * Update organization metadata
   */
  async updateOrganizationMetadata(
    organizationId: string,
    params: UpdateOrganizationMetadataParams
  ): Promise<Organization> {
    const body: Record<string, unknown> = {}

    if (params.publicMetadata !== undefined) {
      body.public_metadata = params.publicMetadata
    }
    if (params.privateMetadata !== undefined) {
      body.private_metadata = params.privateMetadata
    }

    return this.client.request<Organization>(`/v1/organizations/${organizationId}/metadata`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
  }

  /**
   * Update organization logo
   */
  async updateOrganizationLogo(
    organizationId: string,
    params: UpdateOrganizationLogoParams
  ): Promise<Organization> {
    const formData = new FormData()
    formData.append('file', params.file)
    if (params.uploaderUserId) {
      formData.append('uploader_user_id', params.uploaderUserId)
    }

    return this.client.requestFormData<Organization>(`/v1/organizations/${organizationId}/logo`, {
      method: 'PUT',
      body: formData,
    })
  }

  /**
   * Delete organization logo
   */
  async deleteOrganizationLogo(organizationId: string): Promise<Organization> {
    return this.client.request<Organization>(`/v1/organizations/${organizationId}/logo`, {
      method: 'DELETE',
    })
  }
}

// ============================================================================
// USERS RESOURCE
// ============================================================================

/**
 * Users resource for managing Clerk users
 */
class UsersResource {
  private client: Clerk

  constructor(client: Clerk) {
    this.client = client
  }

  /**
   * Create a new user
   */
  async createUser(params: CreateUserParams): Promise<User> {
    const body: Record<string, unknown> = {}

    if (params.emailAddress !== undefined) {
      body.email_address = params.emailAddress
    }
    if (params.phoneNumber !== undefined) {
      body.phone_number = params.phoneNumber
    }
    if (params.username !== undefined) {
      body.username = params.username
    }
    if (params.password !== undefined) {
      body.password = params.password
    }
    if (params.firstName !== undefined) {
      body.first_name = params.firstName
    }
    if (params.lastName !== undefined) {
      body.last_name = params.lastName
    }
    if (params.externalId !== undefined) {
      body.external_id = params.externalId
    }
    if (params.publicMetadata !== undefined) {
      body.public_metadata = params.publicMetadata
    }
    if (params.privateMetadata !== undefined) {
      body.private_metadata = params.privateMetadata
    }
    if (params.unsafeMetadata !== undefined) {
      body.unsafe_metadata = params.unsafeMetadata
    }
    if (params.skipPasswordChecks !== undefined) {
      body.skip_password_checks = params.skipPasswordChecks
    }
    if (params.skipPasswordRequirement !== undefined) {
      body.skip_password_requirement = params.skipPasswordRequirement
    }
    if (params.totpSecret !== undefined) {
      body.totp_secret = params.totpSecret
    }
    if (params.backupCodes !== undefined) {
      body.backup_codes = params.backupCodes
    }
    if (params.createdAt !== undefined) {
      body.created_at = params.createdAt
    }

    return this.client.request<User>('/v1/users', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  /**
   * Get a user by ID
   */
  async getUser(userId: string): Promise<User> {
    return this.client.request<User>(`/v1/users/${userId}`, {
      method: 'GET',
    })
  }

  /**
   * Update a user by ID
   */
  async updateUser(userId: string, params: UpdateUserParams): Promise<User> {
    const body: Record<string, unknown> = {}

    if (params.username !== undefined) {
      body.username = params.username
    }
    if (params.password !== undefined) {
      body.password = params.password
    }
    if (params.firstName !== undefined) {
      body.first_name = params.firstName
    }
    if (params.lastName !== undefined) {
      body.last_name = params.lastName
    }
    if (params.primaryEmailAddressId !== undefined) {
      body.primary_email_address_id = params.primaryEmailAddressId
    }
    if (params.primaryPhoneNumberId !== undefined) {
      body.primary_phone_number_id = params.primaryPhoneNumberId
    }
    if (params.primaryWeb3WalletId !== undefined) {
      body.primary_web3_wallet_id = params.primaryWeb3WalletId
    }
    if (params.externalId !== undefined) {
      body.external_id = params.externalId
    }
    if (params.publicMetadata !== undefined) {
      body.public_metadata = params.publicMetadata
    }
    if (params.privateMetadata !== undefined) {
      body.private_metadata = params.privateMetadata
    }
    if (params.unsafeMetadata !== undefined) {
      body.unsafe_metadata = params.unsafeMetadata
    }
    if (params.profileImageId !== undefined) {
      body.profile_image_id = params.profileImageId
    }
    if (params.totpSecret !== undefined) {
      body.totp_secret = params.totpSecret
    }
    if (params.backupCodes !== undefined) {
      body.backup_codes = params.backupCodes
    }
    if (params.skipPasswordChecks !== undefined) {
      body.skip_password_checks = params.skipPasswordChecks
    }
    if (params.signOutOfOtherSessions !== undefined) {
      body.sign_out_of_other_sessions = params.signOutOfOtherSessions
    }
    if (params.deleteProfileImage !== undefined) {
      body.delete_profile_image = params.deleteProfileImage
    }
    if (params.createOrganizationEnabled !== undefined) {
      body.create_organization_enabled = params.createOrganizationEnabled
    }
    if (params.createOrganizationsLimit !== undefined) {
      body.create_organizations_limit = params.createOrganizationsLimit
    }

    return this.client.request<User>(`/v1/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
  }

  /**
   * Delete a user by ID
   */
  async deleteUser(userId: string): Promise<DeletedObject> {
    return this.client.request<DeletedObject>(`/v1/users/${userId}`, {
      method: 'DELETE',
    })
  }

  /**
   * List users with optional filters
   */
  async listUsers(params?: ListUsersParams): Promise<UserList> {
    const searchParams = new URLSearchParams()

    if (params?.emailAddress) {
      params.emailAddress.forEach((email) => searchParams.append('email_address', email))
    }
    if (params?.phoneNumber) {
      params.phoneNumber.forEach((phone) => searchParams.append('phone_number', phone))
    }
    if (params?.externalId) {
      params.externalId.forEach((id) => searchParams.append('external_id', id))
    }
    if (params?.username) {
      params.username.forEach((name) => searchParams.append('username', name))
    }
    if (params?.web3Wallet) {
      params.web3Wallet.forEach((wallet) => searchParams.append('web3_wallet', wallet))
    }
    if (params?.userId) {
      params.userId.forEach((id) => searchParams.append('user_id', id))
    }
    if (params?.organizationId) {
      params.organizationId.forEach((id) => searchParams.append('organization_id', id))
    }
    if (params?.query) {
      searchParams.set('query', params.query)
    }
    if (params?.lastActiveAtSince !== undefined) {
      searchParams.set('last_active_at_since', String(params.lastActiveAtSince))
    }
    if (params?.limit !== undefined) {
      searchParams.set('limit', String(params.limit))
    }
    if (params?.offset !== undefined) {
      searchParams.set('offset', String(params.offset))
    }
    if (params?.orderBy) {
      searchParams.set('order_by', params.orderBy)
    }

    const queryString = searchParams.toString()
    const path = queryString ? `/v1/users?${queryString}` : '/v1/users'

    return this.client.request<UserList>(path, {
      method: 'GET',
    })
  }

  /**
   * Get users count with optional filters
   */
  async getUsersCount(params?: ListUsersParams): Promise<{ object: 'total_count'; total_count: number }> {
    const searchParams = new URLSearchParams()

    if (params?.emailAddress) {
      params.emailAddress.forEach((email) => searchParams.append('email_address', email))
    }
    if (params?.phoneNumber) {
      params.phoneNumber.forEach((phone) => searchParams.append('phone_number', phone))
    }
    if (params?.externalId) {
      params.externalId.forEach((id) => searchParams.append('external_id', id))
    }
    if (params?.username) {
      params.username.forEach((name) => searchParams.append('username', name))
    }
    if (params?.web3Wallet) {
      params.web3Wallet.forEach((wallet) => searchParams.append('web3_wallet', wallet))
    }
    if (params?.userId) {
      params.userId.forEach((id) => searchParams.append('user_id', id))
    }
    if (params?.organizationId) {
      params.organizationId.forEach((id) => searchParams.append('organization_id', id))
    }
    if (params?.query) {
      searchParams.set('query', params.query)
    }
    if (params?.lastActiveAtSince !== undefined) {
      searchParams.set('last_active_at_since', String(params.lastActiveAtSince))
    }

    const queryString = searchParams.toString()
    const path = queryString ? `/v1/users/count?${queryString}` : '/v1/users/count'

    return this.client.request<{ object: 'total_count'; total_count: number }>(path, {
      method: 'GET',
    })
  }

  /**
   * Update user metadata
   */
  async updateUserMetadata(userId: string, params: UpdateUserMetadataParams): Promise<User> {
    const body: Record<string, unknown> = {}

    if (params.publicMetadata !== undefined) {
      body.public_metadata = params.publicMetadata
    }
    if (params.privateMetadata !== undefined) {
      body.private_metadata = params.privateMetadata
    }
    if (params.unsafeMetadata !== undefined) {
      body.unsafe_metadata = params.unsafeMetadata
    }

    return this.client.request<User>(`/v1/users/${userId}/metadata`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
  }

  /**
   * Ban a user
   */
  async banUser(userId: string): Promise<User> {
    return this.client.request<User>(`/v1/users/${userId}/ban`, {
      method: 'POST',
    })
  }

  /**
   * Unban a user
   */
  async unbanUser(userId: string): Promise<User> {
    return this.client.request<User>(`/v1/users/${userId}/unban`, {
      method: 'POST',
    })
  }

  /**
   * Lock a user
   */
  async lockUser(userId: string): Promise<User> {
    return this.client.request<User>(`/v1/users/${userId}/lock`, {
      method: 'POST',
    })
  }

  /**
   * Unlock a user
   */
  async unlockUser(userId: string): Promise<User> {
    return this.client.request<User>(`/v1/users/${userId}/unlock`, {
      method: 'POST',
    })
  }

  /**
   * Get organization memberships for a user
   */
  async getUserOrganizationMemberships(
    userId: string,
    params?: { limit?: number; offset?: number }
  ): Promise<{ data: OrganizationMembership[]; total_count: number }> {
    const searchParams = new URLSearchParams()

    if (params?.limit !== undefined) {
      searchParams.set('limit', String(params.limit))
    }
    if (params?.offset !== undefined) {
      searchParams.set('offset', String(params.offset))
    }

    const queryString = searchParams.toString()
    const path = queryString
      ? `/v1/users/${userId}/organization_memberships?${queryString}`
      : `/v1/users/${userId}/organization_memberships`

    return this.client.request<{ data: OrganizationMembership[]; total_count: number }>(path, {
      method: 'GET',
    })
  }

  /**
   * Verify a user's password
   */
  async verifyPassword(userId: string, password: string): Promise<{ verified: boolean }> {
    return this.client.request<{ verified: boolean }>(`/v1/users/${userId}/verify_password`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    })
  }

  /**
   * Verify a user's TOTP code
   */
  async verifyTOTP(userId: string, code: string): Promise<{ verified: boolean; code_type: string }> {
    return this.client.request<{ verified: boolean; code_type: string }>(`/v1/users/${userId}/verify_totp`, {
      method: 'POST',
      body: JSON.stringify({ code }),
    })
  }

  /**
   * Disable a user's MFA
   */
  async disableMFA(userId: string): Promise<User> {
    return this.client.request<User>(`/v1/users/${userId}/mfa`, {
      method: 'DELETE',
    })
  }

  // ===========================================================================
  // EMAIL VERIFICATION METHODS
  // ===========================================================================

  /**
   * Create an email verification for a user
   */
  async createEmailVerification(
    userId: string,
    emailAddress: string
  ): Promise<{ id: string; code: string; expires_at: number }> {
    return this.client.request<{ id: string; code: string; expires_at: number }>(
      `/v1/users/${userId}/email_addresses`,
      {
        method: 'POST',
        body: JSON.stringify({ email_address: emailAddress }),
      }
    )
  }

  /**
   * Verify an email with a verification code
   */
  async verifyEmail(userId: string, code: string): Promise<User> {
    return this.client.request<User>(`/v1/users/${userId}/email_addresses`, {
      method: 'POST',
      body: JSON.stringify({ code }),
    })
  }

  // ===========================================================================
  // PHONE VERIFICATION METHODS
  // ===========================================================================

  /**
   * Create a phone verification for a user
   */
  async createPhoneVerification(
    userId: string,
    phoneNumber: string
  ): Promise<{ id: string; code: string; expires_at: number }> {
    return this.client.request<{ id: string; code: string; expires_at: number }>(
      `/v1/users/${userId}/phone_numbers`,
      {
        method: 'POST',
        body: JSON.stringify({ phone_number: phoneNumber }),
      }
    )
  }

  /**
   * Verify a phone number with a verification code
   */
  async verifyPhone(userId: string, code: string): Promise<User> {
    return this.client.request<User>(`/v1/users/${userId}/phone_numbers`, {
      method: 'POST',
      body: JSON.stringify({ code }),
    })
  }

  // ===========================================================================
  // EXTERNAL ACCOUNT METHODS
  // ===========================================================================

  /**
   * Create an external account for a user
   */
  async createExternalAccount(
    userId: string,
    params: {
      provider: string
      token: string
      providerUserId?: string
      email?: string
    }
  ): Promise<ExternalAccount> {
    const body: Record<string, unknown> = {
      provider: params.provider,
      token: params.token,
    }

    if (params.providerUserId !== undefined) {
      body.provider_user_id = params.providerUserId
    }
    if (params.email !== undefined) {
      body.email = params.email
    }

    return this.client.request<ExternalAccount>(`/v1/users/${userId}/external_accounts`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  /**
   * Delete an external account from a user
   */
  async deleteExternalAccount(
    userId: string,
    externalAccountId: string
  ): Promise<DeletedObject> {
    return this.client.request<DeletedObject>(
      `/v1/users/${userId}/external_accounts/${externalAccountId}`,
      {
        method: 'DELETE',
      }
    )
  }

  /**
   * List all external accounts for a user
   */
  async listExternalAccounts(
    userId: string
  ): Promise<{ data: ExternalAccount[]; total_count: number }> {
    return this.client.request<{ data: ExternalAccount[]; total_count: number }>(
      `/v1/users/${userId}/external_accounts`,
      {
        method: 'GET',
      }
    )
  }

  // ===========================================================================
  // PASSWORD MANAGEMENT METHODS
  // ===========================================================================

  /**
   * Update a user's password
   */
  async updatePassword(userId: string, password: string): Promise<User> {
    return this.client.request<User>(`/v1/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ password }),
    })
  }

  /**
   * Generate a password reset token for a user
   */
  async resetPassword(userId: string): Promise<{ reset_token: string; expires_at: number }> {
    return this.client.request<{ reset_token: string; expires_at: number }>(
      `/v1/users/${userId}/reset_password`,
      {
        method: 'POST',
      }
    )
  }

  /**
   * Check password strength (client-side utility, no API call)
   */
  checkPasswordStrength(password: string): {
    strength: 'very_weak' | 'weak' | 'fair' | 'strong' | 'very_strong'
    score: number
    warnings: string[]
    suggestions: string[]
  } {
    const warnings: string[] = []
    const suggestions: string[] = []
    let score = 0

    // Length check
    if (password.length >= 8) score += 1
    if (password.length >= 12) score += 1
    if (password.length >= 16) score += 1

    if (password.length < 8) {
      warnings.push('Password is too short')
      suggestions.push('Use at least 8 characters')
    }

    // Character variety checks
    const hasLower = /[a-z]/.test(password)
    const hasUpper = /[A-Z]/.test(password)
    const hasDigit = /\d/.test(password)
    const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)

    if (hasLower) score += 1
    if (hasUpper) score += 1
    if (hasDigit) score += 1
    if (hasSpecial) score += 1

    if (!hasLower && !hasUpper) {
      suggestions.push('Add uppercase and lowercase letters')
    }
    if (!hasDigit) {
      suggestions.push('Add numbers')
    }
    if (!hasSpecial) {
      suggestions.push('Add special characters')
    }

    // Common patterns check
    const commonPatterns = [
      /^password/i,
      /^123456/,
      /^qwerty/i,
      /^letmein/i,
      /^admin/i,
      /^welcome/i,
      /^monkey/i,
      /^dragon/i,
    ]

    for (const pattern of commonPatterns) {
      if (pattern.test(password)) {
        warnings.push('Password contains common patterns')
        score = Math.max(0, score - 2)
        break
      }
    }

    // Sequential characters check
    if (/(.)\1{2,}/.test(password)) {
      warnings.push('Avoid repeated characters')
      score = Math.max(0, score - 1)
    }

    // Determine strength
    let strength: 'very_weak' | 'weak' | 'fair' | 'strong' | 'very_strong'
    if (score <= 1) {
      strength = 'very_weak'
    } else if (score <= 3) {
      strength = 'weak'
    } else if (score <= 4) {
      strength = 'fair'
    } else if (score <= 6) {
      strength = 'strong'
    } else {
      strength = 'very_strong'
    }

    return { strength, score, warnings, suggestions }
  }

  // ===========================================================================
  // USER SEARCH AND LOOKUP METHODS
  // ===========================================================================

  /**
   * Search users by query string
   */
  async searchUsers(query: string): Promise<UserList> {
    return this.listUsers({ query })
  }

  /**
   * Get a user by email address
   */
  async getUserByEmail(email: string): Promise<User | null> {
    const result = await this.listUsers({ emailAddress: [email.toLowerCase()] })
    return result.data.length > 0 ? result.data[0] : null
  }

  /**
   * Get a user by external ID
   */
  async getUserByExternalId(externalId: string): Promise<User | null> {
    const result = await this.listUsers({ externalId: [externalId] })
    return result.data.length > 0 ? result.data[0] : null
  }

  /**
   * Get a user by username
   */
  async getUserByUsername(username: string): Promise<User | null> {
    const result = await this.listUsers({ username: [username] })
    return result.data.length > 0 ? result.data[0] : null
  }

  /**
   * Get all metadata types for a user
   */
  async getUserMetadata(userId: string): Promise<{
    publicMetadata: Record<string, unknown>
    privateMetadata: Record<string, unknown>
    unsafeMetadata: Record<string, unknown>
  }> {
    const user = await this.getUser(userId)
    return {
      publicMetadata: user.public_metadata,
      privateMetadata: user.private_metadata,
      unsafeMetadata: user.unsafe_metadata,
    }
  }

  /**
   * Check if a user is banned
   */
  async isUserBanned(userId: string): Promise<{ banned: boolean }> {
    const user = await this.getUser(userId)
    return { banned: user.banned }
  }

  // ===========================================================================
  // WEB3 WALLET METHODS
  // ===========================================================================

  /**
   * Web3 wallet object
   */
  /**
   * Create a Web3 wallet for a user
   */
  async createWeb3Wallet(
    userId: string,
    walletAddress: string
  ): Promise<{
    id: string
    object: 'web3_wallet'
    web3_wallet: string
    verification: { status: string }
    created_at: number
    updated_at: number
  }> {
    return this.client.request<{
      id: string
      object: 'web3_wallet'
      web3_wallet: string
      verification: { status: string }
      created_at: number
      updated_at: number
    }>(`/v1/users/${userId}/web3_wallets`, {
      method: 'POST',
      body: JSON.stringify({ web3_wallet: walletAddress }),
    })
  }

  /**
   * Delete a Web3 wallet from a user
   */
  async deleteWeb3Wallet(userId: string, walletId: string): Promise<DeletedObject> {
    return this.client.request<DeletedObject>(`/v1/users/${userId}/web3_wallets/${walletId}`, {
      method: 'DELETE',
    })
  }

  /**
   * List all Web3 wallets for a user
   */
  async listWeb3Wallets(userId: string): Promise<{
    data: {
      id: string
      object: 'web3_wallet'
      web3_wallet: string
      verification: { status: string }
      created_at: number
      updated_at: number
    }[]
    total_count: number
  }> {
    return this.client.request<{
      data: {
        id: string
        object: 'web3_wallet'
        web3_wallet: string
        verification: { status: string }
        created_at: number
        updated_at: number
      }[]
      total_count: number
    }>(`/v1/users/${userId}/web3_wallets`, {
      method: 'GET',
    })
  }

  // ===========================================================================
  // PROFILE IMAGE METHODS
  // ===========================================================================

  /**
   * Upload a profile image for a user
   */
  async uploadProfileImage(userId: string, file: File): Promise<User> {
    const formData = new FormData()
    formData.append('file', file)

    return this.client.requestFormData<User>(`/v1/users/${userId}/profile_image`, {
      method: 'POST',
      body: formData,
    })
  }

  /**
   * Delete the profile image for a user
   */
  async deleteProfileImage(userId: string): Promise<User> {
    return this.client.request<User>(`/v1/users/${userId}/profile_image`, {
      method: 'DELETE',
    })
  }
}

// ============================================================================
// ORGANIZATION MEMBERSHIP TYPES
// ============================================================================

/**
 * Organization membership object
 */
export interface OrganizationMembership {
  id: string
  object: 'organization_membership'
  organization: Organization
  public_metadata: Record<string, unknown>
  private_metadata: Record<string, unknown>
  role: string
  permissions: string[]
  created_at: number
  updated_at: number
}

/**
 * Organization membership list response
 */
export interface OrganizationMembershipList {
  data: OrganizationMembership[]
  total_count: number
}

// ============================================================================
// INVITATION TYPES
// ============================================================================

/**
 * Invitation status enum
 */
export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired'

/**
 * Organization invitation object
 */
export interface OrganizationInvitation {
  id: string
  object: 'organization_invitation'
  email_address: string
  organization_id: string
  public_metadata: Record<string, unknown>
  private_metadata: Record<string, unknown>
  role: string
  status: InvitationStatus
  created_at: number
  updated_at: number
  expires_at?: number
}

/**
 * Organization invitation list response
 */
export interface OrganizationInvitationList {
  data: OrganizationInvitation[]
  total_count: number
}

/**
 * Parameters for creating an organization invitation
 */
export interface CreateOrganizationInvitationParams {
  emailAddress: string
  role: string
  inviterUserId: string
  redirectUrl?: string
  publicMetadata?: Record<string, unknown>
  privateMetadata?: Record<string, unknown>
}

/**
 * Parameters for listing organization invitations
 */
export interface ListOrganizationInvitationsParams {
  status?: InvitationStatus
  limit?: number
  offset?: number
}

/**
 * Parameters for creating a bulk invitation
 */
export interface CreateBulkOrganizationInvitationsParams {
  emailAddresses: string[]
  role: string
  inviterUserId: string
  redirectUrl?: string
  publicMetadata?: Record<string, unknown>
  privateMetadata?: Record<string, unknown>
}

// ============================================================================
// INVITATIONS RESOURCE
// ============================================================================

/**
 * Invitations resource for managing organization invitations
 */
class InvitationsResource {
  private client: Clerk

  constructor(client: Clerk) {
    this.client = client
  }

  /**
   * Create an invitation for an organization
   */
  async createOrganizationInvitation(
    organizationId: string,
    params: CreateOrganizationInvitationParams
  ): Promise<OrganizationInvitation> {
    const body: Record<string, unknown> = {
      email_address: params.emailAddress,
      role: params.role,
      inviter_user_id: params.inviterUserId,
    }

    if (params.redirectUrl !== undefined) {
      body.redirect_url = params.redirectUrl
    }
    if (params.publicMetadata !== undefined) {
      body.public_metadata = params.publicMetadata
    }
    if (params.privateMetadata !== undefined) {
      body.private_metadata = params.privateMetadata
    }

    return this.client.request<OrganizationInvitation>(
      `/v1/organizations/${organizationId}/invitations`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      }
    )
  }

  /**
   * Get an invitation by ID
   */
  async getOrganizationInvitation(
    organizationId: string,
    invitationId: string
  ): Promise<OrganizationInvitation> {
    return this.client.request<OrganizationInvitation>(
      `/v1/organizations/${organizationId}/invitations/${invitationId}`,
      {
        method: 'GET',
      }
    )
  }

  /**
   * List invitations for an organization
   */
  async listOrganizationInvitations(
    organizationId: string,
    params?: ListOrganizationInvitationsParams
  ): Promise<OrganizationInvitationList> {
    const searchParams = new URLSearchParams()

    if (params?.status) {
      searchParams.set('status', params.status)
    }
    if (params?.limit !== undefined) {
      searchParams.set('limit', String(params.limit))
    }
    if (params?.offset !== undefined) {
      searchParams.set('offset', String(params.offset))
    }

    const queryString = searchParams.toString()
    const path = queryString
      ? `/v1/organizations/${organizationId}/invitations?${queryString}`
      : `/v1/organizations/${organizationId}/invitations`

    return this.client.request<OrganizationInvitationList>(path, {
      method: 'GET',
    })
  }

  /**
   * Revoke an invitation
   */
  async revokeOrganizationInvitation(
    organizationId: string,
    invitationId: string,
    requestingUserId: string
  ): Promise<OrganizationInvitation> {
    return this.client.request<OrganizationInvitation>(
      `/v1/organizations/${organizationId}/invitations/${invitationId}/revoke`,
      {
        method: 'POST',
        body: JSON.stringify({ requesting_user_id: requestingUserId }),
      }
    )
  }

  /**
   * Get pending invitations count for an organization
   */
  async getPendingInvitationsCount(
    organizationId: string
  ): Promise<{ object: 'total_count'; total_count: number }> {
    return this.client.request<{ object: 'total_count'; total_count: number }>(
      `/v1/organizations/${organizationId}/invitations/pending_count`,
      {
        method: 'GET',
      }
    )
  }

  /**
   * Create bulk invitations for an organization
   */
  async createBulkOrganizationInvitations(
    organizationId: string,
    params: CreateBulkOrganizationInvitationsParams
  ): Promise<OrganizationInvitationList> {
    const body: Record<string, unknown> = {
      email_addresses: params.emailAddresses,
      role: params.role,
      inviter_user_id: params.inviterUserId,
    }

    if (params.redirectUrl !== undefined) {
      body.redirect_url = params.redirectUrl
    }
    if (params.publicMetadata !== undefined) {
      body.public_metadata = params.publicMetadata
    }
    if (params.privateMetadata !== undefined) {
      body.private_metadata = params.privateMetadata
    }

    return this.client.request<OrganizationInvitationList>(
      `/v1/organizations/${organizationId}/invitations/bulk`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      }
    )
  }
}

// ============================================================================
// MAIN CLIENT
// ============================================================================

/**
 * Clerk Backend API client
 *
 * @example
 * ```typescript
 * const clerk = new Clerk({ secretKey: 'sk_test_xxx' })
 *
 * const session = await clerk.sessions.getSession('sess_xxx')
 * ```
 */
export class Clerk {
  private secretKey: string
  private publishableKey?: string
  private apiUrl: string
  private apiVersion: string

  sessions: SessionsResource
  organizations: OrganizationsResource
  users: UsersResource
  invitations: InvitationsResource

  constructor(options: ClerkOptions) {
    if (!options.secretKey) {
      throw new Error('Clerk secret key is required')
    }

    this.secretKey = options.secretKey
    this.publishableKey = options.publishableKey
    this.apiUrl = options.apiUrl || 'https://api.clerk.com'
    this.apiVersion = options.apiVersion || 'v1'

    // Initialize resources
    this.sessions = new SessionsResource(this)
    this.organizations = new OrganizationsResource(this)
    this.users = new UsersResource(this)
    this.invitations = new InvitationsResource(this)
  }

  /**
   * Make an authenticated request to the Clerk API
   * @internal
   */
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.apiUrl}${path}`

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.secretKey}`,
      'Clerk-SDK': '@dotdo/clerk@1.0.0',
      ...(init.headers as Record<string, string>),
    }

    // Add Content-Type for requests with body
    if (init.body) {
      headers['Content-Type'] = 'application/json'
    }

    const response = await fetch(url, {
      ...init,
      headers,
    })

    const data = await response.json()

    if (!response.ok) {
      throw new ClerkAPIError(data as { errors: ClerkError[] }, response.status)
    }

    return data as T
  }

  /**
   * Make an authenticated request with FormData (for file uploads)
   * @internal
   */
  async requestFormData<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.apiUrl}${path}`

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.secretKey}`,
      'Clerk-SDK': '@dotdo/clerk@1.0.0',
      // Note: Content-Type is NOT set for FormData - browser sets it automatically with boundary
    }

    const response = await fetch(url, {
      ...init,
      headers,
    })

    const data = await response.json()

    if (!response.ok) {
      throw new ClerkAPIError(data as { errors: ClerkError[] }, response.status)
    }

    return data as T
  }
}
