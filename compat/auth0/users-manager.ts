/**
 * @dotdo/auth0 - Users Manager
 *
 * Auth0 Management API User operations compatible with the auth0 Node.js SDK.
 * Provides CRUD operations, search, password management, and email verification.
 *
 * @see https://auth0.com/docs/api/management/v2#!/Users
 * @module
 */

import type {
  User,
  UserRecord,
  CreateUserParams,
  UpdateUserParams,
  GetUsersParams,
  GetUsersResponse,
  GetUsersByEmailParams,
  Identity,
  UserMetadata,
  AppMetadata,
} from './types'
import { Auth0ManagementError } from './types'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Parameters for getting a single user
 */
export interface GetUserParams {
  /** User ID */
  id: string
  /** Fields to include */
  fields?: string
  /** Whether to include or exclude fields */
  include_fields?: boolean
}

/**
 * Parameters for deleting a user
 */
export interface DeleteUserParams {
  /** User ID */
  id: string
}

/**
 * Parameters for identifying user in update
 */
export interface UserIdParams {
  /** User ID */
  id: string
}

// ============================================================================
// USER MANAGER OPTIONS
// ============================================================================

/**
 * Options for UsersManager
 */
export interface UsersManagerOptions {
  /** Auth0 domain */
  domain: string
  /** Minimum password length */
  minPasswordLength?: number
  /** Password hash iterations */
  passwordHashIterations?: number
}

// ============================================================================
// USERS MANAGER
// ============================================================================

/**
 * Auth0 Users Manager
 *
 * Provides user management operations compatible with Auth0 Management API.
 */
export class UsersManager {
  private domain: string
  private minPasswordLength: number
  private passwordHashIterations: number

  // In-memory stores (in production, would use TemporalStore)
  private users = new Map<string, UserRecord>()
  private emailIndex = new Map<string, string>() // email -> user_id
  private phoneIndex = new Map<string, string>() // phone -> user_id
  private usernameIndex = new Map<string, string>() // username -> user_id

  constructor(options: UsersManagerOptions) {
    this.domain = options.domain
    this.minPasswordLength = options.minPasswordLength ?? 8
    this.passwordHashIterations = options.passwordHashIterations ?? 100000
  }

  // ============================================================================
  // CREATE USER
  // ============================================================================

  /**
   * Create a new user
   *
   * @see https://auth0.com/docs/api/management/v2#!/Users/post_users
   */
  async create(params: CreateUserParams): Promise<User> {
    // Validate required fields
    if (!params.connection) {
      throw new Auth0ManagementError('Connection is required', 400, 'invalid_body')
    }

    // For database connections, password is required
    if (params.connection === 'Username-Password-Authentication' && !params.password) {
      throw new Auth0ManagementError('Password is required for database connections', 400, 'invalid_body')
    }

    // Validate email uniqueness
    if (params.email) {
      const emailLower = params.email.toLowerCase()
      if (this.emailIndex.has(emailLower)) {
        throw new Auth0ManagementError(
          'The user already exists.',
          409,
          'user_exists'
        )
      }
    }

    // Validate phone uniqueness
    if (params.phone_number) {
      if (this.phoneIndex.has(params.phone_number)) {
        throw new Auth0ManagementError(
          'The user already exists.',
          409,
          'user_exists'
        )
      }
    }

    // Validate username uniqueness
    if (params.username) {
      const usernameLower = params.username.toLowerCase()
      if (this.usernameIndex.has(usernameLower)) {
        throw new Auth0ManagementError(
          'The user already exists.',
          409,
          'user_exists'
        )
      }
    }

    // Validate password strength
    if (params.password && params.password.length < this.minPasswordLength) {
      throw new Auth0ManagementError(
        `Password must be at least ${this.minPasswordLength} characters`,
        400,
        'invalid_password'
      )
    }

    // Generate user ID
    const userId = this.generateUserId()
    const now = new Date().toISOString()

    // Hash password if provided
    let passwordHash: string | undefined
    if (params.password) {
      passwordHash = await this.hashPassword(params.password)
    }

    // Create identity
    const identity: Identity = {
      connection: params.connection,
      provider: this.getProviderFromConnection(params.connection),
      user_id: userId.replace('auth0|', ''),
      isSocial: this.isSocialConnection(params.connection),
    }

    // Create user record
    const userRecord: UserRecord = {
      user_id: userId,
      email: params.email,
      email_verified: params.email_verified ?? false,
      phone_number: params.phone_number,
      phone_verified: params.phone_verified ?? false,
      username: params.username,
      given_name: params.given_name,
      family_name: params.family_name,
      name: params.name ?? this.buildFullName(params.given_name, params.family_name),
      nickname: params.nickname ?? params.email?.split('@')[0] ?? params.username,
      picture: params.picture ?? this.generateGravatarUrl(params.email),
      created_at: now,
      updated_at: now,
      logins_count: 0,
      blocked: false,
      user_metadata: params.user_metadata ?? {},
      app_metadata: params.app_metadata ?? {},
      identities: [identity],
      password_hash: passwordHash,
      password_changed_at: passwordHash ? now : undefined,
      failed_login_attempts: 0,
    }

    // Store user
    this.users.set(userId, userRecord)

    // Update indexes
    if (params.email) {
      this.emailIndex.set(params.email.toLowerCase(), userId)
    }
    if (params.phone_number) {
      this.phoneIndex.set(params.phone_number, userId)
    }
    if (params.username) {
      this.usernameIndex.set(params.username.toLowerCase(), userId)
    }

    return this.toPublicUser(userRecord)
  }

  // ============================================================================
  // GET USER
  // ============================================================================

  /**
   * Get a user by ID
   *
   * @see https://auth0.com/docs/api/management/v2#!/Users/get_users_by_id
   */
  async get(params: GetUserParams): Promise<User | null> {
    const userRecord = this.users.get(params.id)
    if (!userRecord) {
      return null
    }

    const user = this.toPublicUser(userRecord)

    // Apply field filtering if specified
    if (params.fields) {
      return this.filterFields(user, params.fields, params.include_fields ?? true)
    }

    return user
  }

  // ============================================================================
  // UPDATE USER
  // ============================================================================

  /**
   * Update a user
   *
   * @see https://auth0.com/docs/api/management/v2#!/Users/patch_users_by_id
   */
  async update(idParams: UserIdParams, params: UpdateUserParams): Promise<User> {
    const userRecord = this.users.get(idParams.id)
    if (!userRecord) {
      throw new Auth0ManagementError('User not found', 404, 'inexistent_user')
    }

    const now = new Date().toISOString()

    // Update email if changed
    if (params.email !== undefined && params.email !== userRecord.email) {
      const emailLower = params.email.toLowerCase()
      const existingId = this.emailIndex.get(emailLower)
      if (existingId && existingId !== idParams.id) {
        throw new Auth0ManagementError('Email already in use', 409, 'user_exists')
      }

      // Remove old index
      if (userRecord.email) {
        this.emailIndex.delete(userRecord.email.toLowerCase())
      }
      // Add new index
      this.emailIndex.set(emailLower, idParams.id)
      userRecord.email = params.email
    }

    // Update phone if changed
    if (params.phone_number !== undefined && params.phone_number !== userRecord.phone_number) {
      const existingId = this.phoneIndex.get(params.phone_number)
      if (existingId && existingId !== idParams.id) {
        throw new Auth0ManagementError('Phone number already in use', 409, 'user_exists')
      }

      // Remove old index
      if (userRecord.phone_number) {
        this.phoneIndex.delete(userRecord.phone_number)
      }
      // Add new index
      if (params.phone_number) {
        this.phoneIndex.set(params.phone_number, idParams.id)
      }
      userRecord.phone_number = params.phone_number
    }

    // Update username if changed
    if (params.username !== undefined && params.username !== userRecord.username) {
      const usernameLower = params.username.toLowerCase()
      const existingId = this.usernameIndex.get(usernameLower)
      if (existingId && existingId !== idParams.id) {
        throw new Auth0ManagementError('Username already in use', 409, 'user_exists')
      }

      // Remove old index
      if (userRecord.username) {
        this.usernameIndex.delete(userRecord.username.toLowerCase())
      }
      // Add new index
      this.usernameIndex.set(usernameLower, idParams.id)
      userRecord.username = params.username
    }

    // Update password if provided
    if (params.password) {
      if (params.password.length < this.minPasswordLength) {
        throw new Auth0ManagementError(
          `Password must be at least ${this.minPasswordLength} characters`,
          400,
          'invalid_password'
        )
      }
      userRecord.password_hash = await this.hashPassword(params.password)
      userRecord.password_changed_at = now
    }

    // Update scalar fields
    if (params.email_verified !== undefined) userRecord.email_verified = params.email_verified
    if (params.phone_verified !== undefined) userRecord.phone_verified = params.phone_verified
    if (params.given_name !== undefined) userRecord.given_name = params.given_name
    if (params.family_name !== undefined) userRecord.family_name = params.family_name
    if (params.name !== undefined) userRecord.name = params.name
    if (params.nickname !== undefined) userRecord.nickname = params.nickname
    if (params.picture !== undefined) userRecord.picture = params.picture
    if (params.blocked !== undefined) userRecord.blocked = params.blocked

    // Merge user_metadata (Auth0 behavior - shallow merge, null removes keys)
    if (params.user_metadata !== undefined) {
      userRecord.user_metadata = this.mergeMetadata(
        userRecord.user_metadata ?? {},
        params.user_metadata
      )
    }

    // Merge app_metadata (Auth0 behavior - shallow merge, null removes keys)
    if (params.app_metadata !== undefined) {
      userRecord.app_metadata = this.mergeMetadata(
        userRecord.app_metadata ?? {},
        params.app_metadata
      )
    }

    userRecord.updated_at = now

    // Store updated user
    this.users.set(idParams.id, userRecord)

    return this.toPublicUser(userRecord)
  }

  // ============================================================================
  // DELETE USER
  // ============================================================================

  /**
   * Delete a user
   *
   * @see https://auth0.com/docs/api/management/v2#!/Users/delete_users_by_id
   */
  async delete(params: DeleteUserParams): Promise<void> {
    const userRecord = this.users.get(params.id)
    if (!userRecord) {
      // Auth0 returns 204 even for non-existent users
      return
    }

    // Remove from indexes
    if (userRecord.email) {
      this.emailIndex.delete(userRecord.email.toLowerCase())
    }
    if (userRecord.phone_number) {
      this.phoneIndex.delete(userRecord.phone_number)
    }
    if (userRecord.username) {
      this.usernameIndex.delete(userRecord.username.toLowerCase())
    }

    // Delete user
    this.users.delete(params.id)
  }

  // ============================================================================
  // GET ALL USERS (LIST/SEARCH)
  // ============================================================================

  /**
   * List or search users
   *
   * @see https://auth0.com/docs/api/management/v2#!/Users/get_users
   */
  async getAll(params: GetUsersParams = {}): Promise<GetUsersResponse> {
    let users = Array.from(this.users.values())

    // Apply Lucene query filter if provided
    if (params.q) {
      users = this.applyLuceneQuery(users, params.q)
    }

    // Filter by connection
    if (params.connection) {
      users = users.filter((u) =>
        u.identities?.some((i) => i.connection === params.connection)
      )
    }

    // Sort
    if (params.sort) {
      users = this.sortUsers(users, params.sort)
    }

    const total = users.length

    // Paginate
    const page = params.page ?? 0
    const perPage = Math.min(params.per_page ?? 50, 100)
    const start = page * perPage
    users = users.slice(start, start + perPage)

    // Convert to public users
    const publicUsers = users.map((u) => this.toPublicUser(u))

    // Apply field filtering
    const filteredUsers = params.fields
      ? publicUsers.map((u) => this.filterFields(u, params.fields!, params.include_fields ?? true))
      : publicUsers

    const response: GetUsersResponse = {
      users: filteredUsers,
    }

    if (params.include_totals) {
      response.start = start
      response.limit = perPage
      response.total = total
    }

    return response
  }

  // ============================================================================
  // GET USERS BY EMAIL
  // ============================================================================

  /**
   * Get users by email
   *
   * @see https://auth0.com/docs/api/management/v2#!/Users_By_Email/get_users_by_email
   */
  async getByEmail(email: string, params?: Omit<GetUsersByEmailParams, 'email'>): Promise<User[]> {
    const emailLower = email.toLowerCase()
    const userId = this.emailIndex.get(emailLower)

    if (!userId) {
      return []
    }

    const userRecord = this.users.get(userId)
    if (!userRecord) {
      return []
    }

    let user = this.toPublicUser(userRecord)

    // Apply field filtering if specified
    if (params?.fields) {
      user = this.filterFields(user, params.fields, params.include_fields ?? true)
    }

    return [user]
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  /**
   * Generate a user ID in Auth0 format
   */
  private generateUserId(): string {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    return `auth0|${hex}`
  }

  /**
   * Hash a password
   */
  private async hashPassword(password: string): Promise<string> {
    const encoder = new TextEncoder()
    const salt = crypto.getRandomValues(new Uint8Array(16))

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    )

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt,
        iterations: this.passwordHashIterations,
        hash: 'SHA-256',
      },
      keyMaterial,
      256
    )

    const saltHex = Array.from(salt)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    const hashHex = Array.from(new Uint8Array(derivedBits))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    return `pbkdf2:${this.passwordHashIterations}:${saltHex}:${hashHex}`
  }

  /**
   * Get provider from connection name
   */
  private getProviderFromConnection(connection: string): string {
    const providers: Record<string, string> = {
      'Username-Password-Authentication': 'auth0',
      'google-oauth2': 'google-oauth2',
      'github': 'github',
      'facebook': 'facebook',
      'twitter': 'twitter',
      'linkedin': 'linkedin',
      'sms': 'sms',
      'email': 'email',
    }
    return providers[connection] ?? 'auth0'
  }

  /**
   * Check if connection is social
   */
  private isSocialConnection(connection: string): boolean {
    const socialConnections = [
      'google-oauth2',
      'github',
      'facebook',
      'twitter',
      'linkedin',
      'apple',
      'microsoft',
    ]
    return socialConnections.includes(connection)
  }

  /**
   * Build full name from given and family names
   */
  private buildFullName(givenName?: string, familyName?: string): string | undefined {
    const parts = [givenName, familyName].filter(Boolean)
    return parts.length > 0 ? parts.join(' ') : undefined
  }

  /**
   * Generate Gravatar URL for email
   */
  private generateGravatarUrl(email?: string): string | undefined {
    if (!email) return undefined
    // Simple placeholder - in production would use actual Gravatar hash
    return `https://s.gravatar.com/avatar/${email.toLowerCase().replace(/[^a-z0-9]/g, '')}?s=480&r=pg&d=identicon`
  }

  /**
   * Merge metadata (shallow merge, null removes keys)
   */
  private mergeMetadata(
    existing: UserMetadata | AppMetadata,
    updates: UserMetadata | AppMetadata
  ): UserMetadata | AppMetadata {
    const result = { ...existing }

    for (const [key, value] of Object.entries(updates)) {
      if (value === null) {
        delete result[key]
      } else {
        result[key] = value
      }
    }

    return result
  }

  /**
   * Convert internal user record to public user
   */
  private toPublicUser(record: UserRecord): User {
    return {
      user_id: record.user_id,
      email: record.email,
      email_verified: record.email_verified,
      phone_number: record.phone_number,
      phone_verified: record.phone_verified,
      username: record.username,
      given_name: record.given_name,
      family_name: record.family_name,
      name: record.name,
      nickname: record.nickname,
      picture: record.picture,
      created_at: record.created_at,
      updated_at: record.updated_at,
      last_login: record.last_login,
      last_ip: record.last_ip,
      logins_count: record.logins_count,
      blocked: record.blocked,
      user_metadata: record.user_metadata,
      app_metadata: record.app_metadata,
      identities: record.identities,
      multifactor: record.multifactor,
    }
  }

  /**
   * Filter user fields
   */
  private filterFields(user: User, fields: string, includeFields: boolean): User {
    const fieldList = fields.split(',').map((f) => f.trim())

    if (includeFields) {
      // Only include specified fields
      const result: Partial<User> = {}
      for (const field of fieldList) {
        if (field in user) {
          (result as Record<string, unknown>)[field] = (user as Record<string, unknown>)[field]
        }
      }
      return result as User
    } else {
      // Exclude specified fields
      const result = { ...user }
      for (const field of fieldList) {
        delete (result as Record<string, unknown>)[field]
      }
      return result
    }
  }

  /**
   * Apply Lucene-style query filter
   */
  private applyLuceneQuery(users: UserRecord[], query: string): UserRecord[] {
    // Simple Lucene query parser (supports field:value format)
    const conditions = query.split(' AND ').map((c) => c.trim())

    return users.filter((user) => {
      for (const condition of conditions) {
        const [field, value] = condition.split(':').map((s) => s.trim())

        if (!value) continue

        // Handle nested fields (e.g., app_metadata.department)
        const fieldParts = field.split('.')
        let fieldValue: unknown = user as Record<string, unknown>

        for (const part of fieldParts) {
          if (fieldValue && typeof fieldValue === 'object') {
            fieldValue = (fieldValue as Record<string, unknown>)[part]
          } else {
            fieldValue = undefined
            break
          }
        }

        // String comparison (case-insensitive)
        if (typeof fieldValue === 'string') {
          if (fieldValue.toLowerCase() !== value.toLowerCase()) {
            return false
          }
        } else if (fieldValue !== undefined) {
          if (String(fieldValue) !== value) {
            return false
          }
        } else {
          return false
        }
      }
      return true
    })
  }

  /**
   * Sort users by field
   */
  private sortUsers(users: UserRecord[], sort: string): UserRecord[] {
    const [field, order] = sort.split(':')
    const ascending = order === '1'

    return [...users].sort((a, b) => {
      const aVal = (a as Record<string, unknown>)[field]
      const bVal = (b as Record<string, unknown>)[field]

      if (aVal === bVal) return 0
      if (aVal === undefined) return ascending ? 1 : -1
      if (bVal === undefined) return ascending ? -1 : 1

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return ascending
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal)
      }

      return ascending
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number)
    })
  }
}
