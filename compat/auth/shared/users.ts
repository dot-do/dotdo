/**
 * @dotdo/auth - User Management
 *
 * User storage and management using TemporalStore.
 * Supports CRUD operations, password management, and user search.
 *
 * @module
 */

import { createTemporalStore, type TemporalStore } from '../../../db/primitives/temporal-store'
import { createExactlyOnceContext, type ExactlyOnceContext } from '../../../db/primitives/exactly-once-context'
import type { User, UserRecord, UserMetadata, AppMetadata, Identity } from './types'
import { AuthenticationError } from './types'

// ============================================================================
// USER MANAGER OPTIONS
// ============================================================================

/**
 * User manager configuration
 */
export interface UserManagerOptions {
  /** Minimum password length */
  minPasswordLength?: number
  /** Require email verification */
  requireEmailVerification?: boolean
  /** Password hashing iterations (for PBKDF2) */
  passwordHashIterations?: number
  /** Maximum failed login attempts before lockout */
  maxFailedLoginAttempts?: number
  /** Lockout duration in seconds */
  lockoutDuration?: number
  /** Email verification token TTL in seconds */
  emailVerificationTTL?: number
  /** Password reset token TTL in seconds */
  passwordResetTTL?: number
}

/**
 * User creation params
 */
export interface CreateUserParams {
  email?: string
  phone?: string
  username?: string
  password?: string
  first_name?: string
  last_name?: string
  name?: string
  picture?: string
  email_verified?: boolean
  phone_verified?: boolean
  metadata?: UserMetadata
  app_metadata?: AppMetadata
}

/**
 * User update params
 */
export interface UpdateUserParams {
  email?: string
  phone?: string
  username?: string
  password?: string
  first_name?: string
  last_name?: string
  name?: string
  picture?: string
  email_verified?: boolean
  phone_verified?: boolean
  metadata?: UserMetadata
  app_metadata?: AppMetadata
}

/**
 * User search params
 */
export interface SearchUsersParams {
  query?: string
  email?: string
  phone?: string
  username?: string
  limit?: number
  offset?: number
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

// ============================================================================
// USER MANAGER
// ============================================================================

/**
 * User manager with TemporalStore backend
 */
export class UserManager {
  private options: Required<UserManagerOptions>
  private userStore: TemporalStore<UserRecord>
  private emailIndex: TemporalStore<string> // email -> user_id
  private phoneIndex: TemporalStore<string> // phone -> user_id
  private usernameIndex: TemporalStore<string> // username -> user_id
  private exactlyOnce: ExactlyOnceContext

  constructor(options: UserManagerOptions = {}) {
    this.options = {
      minPasswordLength: options.minPasswordLength ?? 8,
      requireEmailVerification: options.requireEmailVerification ?? false,
      passwordHashIterations: options.passwordHashIterations ?? 100000,
      maxFailedLoginAttempts: options.maxFailedLoginAttempts ?? 5,
      lockoutDuration: options.lockoutDuration ?? 900, // 15 minutes
      emailVerificationTTL: options.emailVerificationTTL ?? 86400, // 24 hours
      passwordResetTTL: options.passwordResetTTL ?? 3600, // 1 hour
    }

    this.userStore = createTemporalStore<UserRecord>()
    this.emailIndex = createTemporalStore<string>()
    this.phoneIndex = createTemporalStore<string>()
    this.usernameIndex = createTemporalStore<string>()
    this.exactlyOnce = createExactlyOnceContext()
  }

  /**
   * Create a new user
   *
   * Note: This method performs uniqueness validation and will throw if a user
   * with the same email/phone/username already exists. For idempotent request
   * handling, use the API layer with explicit idempotency keys.
   */
  async createUser(params: CreateUserParams): Promise<User> {
    // Validate uniqueness
    if (params.email) {
      const existingId = await this.emailIndex.get(`email:${params.email.toLowerCase()}`)
      if (existingId) {
        throw new AuthenticationError('user_exists', 'A user with this email already exists')
      }
    }

    if (params.phone) {
      const existingId = await this.phoneIndex.get(`phone:${params.phone}`)
      if (existingId) {
        throw new AuthenticationError('user_exists', 'A user with this phone already exists')
      }
    }

    if (params.username) {
      const existingId = await this.usernameIndex.get(`username:${params.username.toLowerCase()}`)
      if (existingId) {
        throw new AuthenticationError('user_exists', 'A user with this username already exists')
      }
    }

    // Validate password
    if (params.password && params.password.length < this.options.minPasswordLength) {
      throw new AuthenticationError(
        'weak_password',
        `Password must be at least ${this.options.minPasswordLength} characters`
      )
    }

    // Generate user ID
    const userId = this.generateId('user')
    const now = new Date().toISOString()

    // Hash password if provided
    let passwordHash: string | undefined
    if (params.password) {
      passwordHash = await this.hashPassword(params.password)
    }

    // Create user record
    const userRecord: UserRecord = {
      id: userId,
      email: params.email,
      email_verified: params.email_verified ?? false,
      phone: params.phone,
      phone_verified: params.phone_verified ?? false,
      username: params.username,
      first_name: params.first_name,
      last_name: params.last_name,
      name: params.name ?? ([params.first_name, params.last_name].filter(Boolean).join(' ') || undefined),
      picture: params.picture,
      created_at: now,
      updated_at: now,
      metadata: params.metadata ?? {},
      app_metadata: params.app_metadata ?? {},
      password_hash: passwordHash,
      password_changed_at: passwordHash ? now : undefined,
      failed_login_attempts: 0,
    }

    // Store user
    await this.userStore.put(`user:${userId}`, userRecord, Date.now())

    // Update indexes
    if (params.email) {
      await this.emailIndex.put(`email:${params.email.toLowerCase()}`, userId, Date.now())
    }
    if (params.phone) {
      await this.phoneIndex.put(`phone:${params.phone}`, userId, Date.now())
    }
    if (params.username) {
      await this.usernameIndex.put(`username:${params.username.toLowerCase()}`, userId, Date.now())
    }

    return this.toPublicUser(userRecord)
  }

  /**
   * Get a user by ID
   */
  async getUser(userId: string): Promise<User | null> {
    const userRecord = await this.userStore.get(`user:${userId}`)
    if (!userRecord) return null
    return this.toPublicUser(userRecord)
  }

  /**
   * Get a user by email
   */
  async getUserByEmail(email: string): Promise<User | null> {
    const userId = await this.emailIndex.get(`email:${email.toLowerCase()}`)
    if (!userId) return null
    return this.getUser(userId)
  }

  /**
   * Get a user by phone
   */
  async getUserByPhone(phone: string): Promise<User | null> {
    const userId = await this.phoneIndex.get(`phone:${phone}`)
    if (!userId) return null
    return this.getUser(userId)
  }

  /**
   * Get a user by username
   */
  async getUserByUsername(username: string): Promise<User | null> {
    const userId = await this.usernameIndex.get(`username:${username.toLowerCase()}`)
    if (!userId) return null
    return this.getUser(userId)
  }

  /**
   * Update a user
   */
  async updateUser(userId: string, params: UpdateUserParams): Promise<User> {
    const userRecord = await this.userStore.get(`user:${userId}`)
    if (!userRecord) {
      throw new AuthenticationError('user_not_found', 'User not found')
    }

    const now = new Date().toISOString()

    // Update email index if changed
    if (params.email !== undefined && params.email !== userRecord.email) {
      if (params.email) {
        const existingId = await this.emailIndex.get(`email:${params.email.toLowerCase()}`)
        if (existingId && existingId !== userId) {
          throw new AuthenticationError('email_exists', 'This email is already in use')
        }
      }

      // Remove old index
      if (userRecord.email) {
        await this.emailIndex.delete(`email:${userRecord.email.toLowerCase()}`, Date.now())
      }
      // Add new index
      if (params.email) {
        await this.emailIndex.put(`email:${params.email.toLowerCase()}`, userId, Date.now())
      }

      userRecord.email = params.email
      userRecord.email_verified = params.email_verified ?? false
    }

    // Update phone index if changed
    if (params.phone !== undefined && params.phone !== userRecord.phone) {
      if (params.phone) {
        const existingId = await this.phoneIndex.get(`phone:${params.phone}`)
        if (existingId && existingId !== userId) {
          throw new AuthenticationError('phone_exists', 'This phone is already in use')
        }
      }

      // Remove old index
      if (userRecord.phone) {
        await this.phoneIndex.delete(`phone:${userRecord.phone}`, Date.now())
      }
      // Add new index
      if (params.phone) {
        await this.phoneIndex.put(`phone:${params.phone}`, userId, Date.now())
      }

      userRecord.phone = params.phone
      userRecord.phone_verified = params.phone_verified ?? false
    }

    // Update username index if changed
    if (params.username !== undefined && params.username !== userRecord.username) {
      if (params.username) {
        const existingId = await this.usernameIndex.get(`username:${params.username.toLowerCase()}`)
        if (existingId && existingId !== userId) {
          throw new AuthenticationError('username_exists', 'This username is already in use')
        }
      }

      // Remove old index
      if (userRecord.username) {
        await this.usernameIndex.delete(`username:${userRecord.username.toLowerCase()}`, Date.now())
      }
      // Add new index
      if (params.username) {
        await this.usernameIndex.put(`username:${params.username.toLowerCase()}`, userId, Date.now())
      }

      userRecord.username = params.username
    }

    // Update password if provided
    if (params.password) {
      if (params.password.length < this.options.minPasswordLength) {
        throw new AuthenticationError(
          'weak_password',
          `Password must be at least ${this.options.minPasswordLength} characters`
        )
      }
      userRecord.password_hash = await this.hashPassword(params.password)
      userRecord.password_changed_at = now
    }

    // Update other fields
    if (params.first_name !== undefined) userRecord.first_name = params.first_name
    if (params.last_name !== undefined) userRecord.last_name = params.last_name
    if (params.name !== undefined) userRecord.name = params.name
    if (params.picture !== undefined) userRecord.picture = params.picture
    if (params.email_verified !== undefined) userRecord.email_verified = params.email_verified
    if (params.phone_verified !== undefined) userRecord.phone_verified = params.phone_verified
    if (params.metadata !== undefined) userRecord.metadata = { ...userRecord.metadata, ...params.metadata }
    if (params.app_metadata !== undefined) userRecord.app_metadata = { ...userRecord.app_metadata, ...params.app_metadata }

    userRecord.updated_at = now

    // Store updated user
    await this.userStore.put(`user:${userId}`, userRecord, Date.now())

    return this.toPublicUser(userRecord)
  }

  /**
   * Delete a user
   */
  async deleteUser(userId: string): Promise<void> {
    const userRecord = await this.userStore.get(`user:${userId}`)
    if (!userRecord) return

    // Remove from indexes
    if (userRecord.email) {
      await this.emailIndex.delete(`email:${userRecord.email.toLowerCase()}`, Date.now())
    }
    if (userRecord.phone) {
      await this.phoneIndex.delete(`phone:${userRecord.phone}`, Date.now())
    }
    if (userRecord.username) {
      await this.usernameIndex.delete(`username:${userRecord.username.toLowerCase()}`, Date.now())
    }

    // Delete user
    await this.userStore.put(`user:${userId}`, null as unknown as UserRecord, Date.now())
  }

  /**
   * Verify a user's password
   */
  async verifyPassword(identifier: string, password: string): Promise<PasswordVerificationResult> {
    // Try to find user by email, phone, or username
    let userRecord: UserRecord | null = null

    if (identifier.includes('@')) {
      const userId = await this.emailIndex.get(`email:${identifier.toLowerCase()}`)
      if (userId) {
        userRecord = await this.userStore.get(`user:${userId}`)
      }
    } else if (identifier.startsWith('+')) {
      const userId = await this.phoneIndex.get(`phone:${identifier}`)
      if (userId) {
        userRecord = await this.userStore.get(`user:${userId}`)
      }
    } else {
      const userId = await this.usernameIndex.get(`username:${identifier.toLowerCase()}`)
      if (userId) {
        userRecord = await this.userStore.get(`user:${userId}`)
      }
    }

    if (!userRecord) {
      return { valid: false, error: 'Invalid credentials' }
    }

    // Check if account is locked
    if (userRecord.locked_until) {
      const lockUntil = new Date(userRecord.locked_until)
      if (lockUntil > new Date()) {
        return { valid: false, error: 'Account is locked', locked: true, lockUntil }
      }
      // Lock expired, reset
      userRecord.locked_until = undefined
      userRecord.failed_login_attempts = 0
    }

    // Verify password
    if (!userRecord.password_hash) {
      return { valid: false, error: 'No password set for this account' }
    }

    const isValid = await this.verifyPasswordHash(password, userRecord.password_hash)

    if (!isValid) {
      // Increment failed attempts
      userRecord.failed_login_attempts = (userRecord.failed_login_attempts ?? 0) + 1

      // Check if should lock
      if (userRecord.failed_login_attempts >= this.options.maxFailedLoginAttempts) {
        userRecord.locked_until = new Date(Date.now() + this.options.lockoutDuration * 1000).toISOString()
      }

      await this.userStore.put(`user:${userRecord.id}`, userRecord, Date.now())

      return { valid: false, error: 'Invalid credentials' }
    }

    // Reset failed attempts on success
    if (userRecord.failed_login_attempts && userRecord.failed_login_attempts > 0) {
      userRecord.failed_login_attempts = 0
      userRecord.locked_until = undefined
      await this.userStore.put(`user:${userRecord.id}`, userRecord, Date.now())
    }

    // Update last sign in
    userRecord.last_sign_in_at = new Date().toISOString()
    await this.userStore.put(`user:${userRecord.id}`, userRecord, Date.now())

    return { valid: true, user: this.toPublicUser(userRecord) }
  }

  /**
   * Generate email verification token
   */
  async generateEmailVerificationToken(userId: string): Promise<string> {
    const userRecord = await this.userStore.get(`user:${userId}`)
    if (!userRecord) {
      throw new AuthenticationError('user_not_found', 'User not found')
    }

    const token = this.generateToken()
    userRecord.email_verification_token = await this.hashToken(token)
    userRecord.email_verification_sent_at = new Date().toISOString()
    await this.userStore.put(`user:${userId}`, userRecord, Date.now())

    return token
  }

  /**
   * Verify email with token
   */
  async verifyEmail(token: string): Promise<User> {
    // This is a simple implementation - in production you'd want to
    // store tokens separately with a reverse index
    // For now, we'll need to scan users (not efficient at scale)
    throw new AuthenticationError('not_implemented', 'Email verification requires token index')
  }

  /**
   * Generate password reset token
   */
  async generatePasswordResetToken(email: string): Promise<string | null> {
    const userId = await this.emailIndex.get(`email:${email.toLowerCase()}`)
    if (!userId) return null

    const userRecord = await this.userStore.get(`user:${userId}`)
    if (!userRecord) return null

    const token = this.generateToken()
    userRecord.password_reset_token = await this.hashToken(token)
    userRecord.password_reset_sent_at = new Date().toISOString()
    await this.userStore.put(`user:${userId}`, userRecord, Date.now())

    return token
  }

  /**
   * Reset password with token
   */
  async resetPassword(token: string, newPassword: string): Promise<User> {
    // Similar to verifyEmail - would need token index for production
    throw new AuthenticationError('not_implemented', 'Password reset requires token index')
  }

  /**
   * Add an identity to a user
   */
  async addIdentity(userId: string, identity: Omit<Identity, 'user_id' | 'created_at' | 'updated_at'>): Promise<Identity> {
    const userRecord = await this.userStore.get(`user:${userId}`)
    if (!userRecord) {
      throw new AuthenticationError('user_not_found', 'User not found')
    }

    const now = new Date().toISOString()
    const newIdentity: Identity = {
      ...identity,
      user_id: userId,
      created_at: now,
      updated_at: now,
    }

    userRecord.identities = userRecord.identities ?? []
    userRecord.identities.push(newIdentity)
    userRecord.updated_at = now

    await this.userStore.put(`user:${userId}`, userRecord, Date.now())

    return newIdentity
  }

  /**
   * Remove an identity from a user
   */
  async removeIdentity(userId: string, identityId: string): Promise<void> {
    const userRecord = await this.userStore.get(`user:${userId}`)
    if (!userRecord || !userRecord.identities) return

    userRecord.identities = userRecord.identities.filter((i) => i.id !== identityId)
    userRecord.updated_at = new Date().toISOString()

    await this.userStore.put(`user:${userId}`, userRecord, Date.now())
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  /**
   * Generate a unique ID
   */
  private generateId(prefix: string): string {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    return `${prefix}_${hex}`
  }

  /**
   * Generate a random token
   */
  private generateToken(): string {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  /**
   * Hash a password using PBKDF2
   */
  private async hashPassword(password: string): Promise<string> {
    const encoder = new TextEncoder()
    const salt = crypto.getRandomValues(new Uint8Array(16))

    const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt,
        iterations: this.options.passwordHashIterations,
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

    return `pbkdf2:${this.options.passwordHashIterations}:${saltHex}:${hashHex}`
  }

  /**
   * Verify a password against a hash
   */
  private async verifyPasswordHash(password: string, hash: string): Promise<boolean> {
    const parts = hash.split(':')
    if (parts.length !== 4 || parts[0] !== 'pbkdf2') {
      return false
    }

    const iterations = parseInt(parts[1], 10)
    const saltHex = parts[2]
    const expectedHashHex = parts[3]

    const encoder = new TextEncoder()
    const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((byte) => parseInt(byte, 16)))

    const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt,
        iterations,
        hash: 'SHA-256',
      },
      keyMaterial,
      256
    )

    const actualHashHex = Array.from(new Uint8Array(derivedBits))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    return this.constantTimeCompare(actualHashHex, expectedHashHex)
  }

  /**
   * Hash a token
   */
  private async hashToken(token: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(token)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  /**
   * Constant-time string comparison
   */
  private constantTimeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false

    let result = 0
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i)
    }
    return result === 0
  }

  /**
   * Convert internal user record to public user object
   */
  private toPublicUser(record: UserRecord): User {
    return {
      id: record.id,
      email: record.email,
      email_verified: record.email_verified,
      phone: record.phone,
      phone_verified: record.phone_verified,
      username: record.username,
      first_name: record.first_name,
      last_name: record.last_name,
      name: record.name,
      picture: record.picture,
      created_at: record.created_at,
      updated_at: record.updated_at,
      last_sign_in_at: record.last_sign_in_at,
      metadata: record.metadata,
      app_metadata: record.app_metadata,
      identities: record.identities,
      mfa_factors: record.mfa_factors,
    }
  }
}

/**
 * Create a user manager instance
 */
export function createUserManager(options?: UserManagerOptions): UserManager {
  return new UserManager(options)
}
