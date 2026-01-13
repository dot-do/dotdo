/**
 * @dotdo/auth - User Management
 *
 * User CRUD operations with password management.
 *
 * @module
 */

import type { User, UserRecord, UserMetadata, AppMetadata, Identity, AuthConfig } from './types'
import { AuthError, AuthErrors } from './error'
import { IndexedStorage } from './storage'

// ============================================================================
// USER MANAGER OPTIONS
// ============================================================================

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

// ============================================================================
// USER MANAGER
// ============================================================================

export class UserManager {
  private storage: IndexedStorage
  private minPasswordLength: number
  private maxFailedLoginAttempts: number
  private lockoutDuration: number
  private passwordHashIterations: number

  constructor(storage: IndexedStorage, config: AuthConfig) {
    this.storage = storage
    this.minPasswordLength = config.minPasswordLength ?? 8
    this.maxFailedLoginAttempts = config.maxFailedLoginAttempts ?? 5
    this.lockoutDuration = config.lockoutDuration ?? 900
    this.passwordHashIterations = 100000
  }

  /**
   * Create a new user
   */
  async create(params: CreateUserParams): Promise<User> {
    // Validate uniqueness
    if (params.email) {
      const existing = await this.storage.getByIndex<UserRecord>('email', params.email)
      if (existing) {
        throw AuthErrors.userExists('email')
      }
    }

    if (params.phone) {
      const existing = await this.storage.getByIndex<UserRecord>('phone', params.phone)
      if (existing) {
        throw AuthErrors.userExists('phone')
      }
    }

    if (params.username) {
      const existing = await this.storage.getByIndex<UserRecord>('username', params.username)
      if (existing) {
        throw AuthErrors.userExists('username')
      }
    }

    // Validate password
    if (params.password && params.password.length < this.minPasswordLength) {
      throw AuthErrors.weakPassword(this.minPasswordLength)
    }

    const userId = this.generateId('user')
    const now = new Date().toISOString()

    let passwordHash: string | undefined
    if (params.password) {
      passwordHash = await this.hashPassword(params.password)
    }

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
    await this.storage.put(`user:${userId}`, userRecord)

    // Update indexes
    if (params.email) {
      await this.storage.setIndex('email', params.email, `user:${userId}`)
    }
    if (params.phone) {
      await this.storage.setIndex('phone', params.phone, `user:${userId}`)
    }
    if (params.username) {
      await this.storage.setIndex('username', params.username, `user:${userId}`)
    }

    return this.toPublicUser(userRecord)
  }

  /**
   * Get a user by ID
   */
  async get(userId: string): Promise<User | null> {
    const userRecord = await this.storage.get<UserRecord>(`user:${userId}`)
    if (!userRecord) return null
    return this.toPublicUser(userRecord)
  }

  /**
   * Get a user by email
   */
  async getByEmail(email: string): Promise<User | null> {
    const userRecord = await this.storage.getByIndex<UserRecord>('email', email)
    if (!userRecord) return null
    return this.toPublicUser(userRecord)
  }

  /**
   * Get a user by phone
   */
  async getByPhone(phone: string): Promise<User | null> {
    const userRecord = await this.storage.getByIndex<UserRecord>('phone', phone)
    if (!userRecord) return null
    return this.toPublicUser(userRecord)
  }

  /**
   * Get a user by username
   */
  async getByUsername(username: string): Promise<User | null> {
    const userRecord = await this.storage.getByIndex<UserRecord>('username', username)
    if (!userRecord) return null
    return this.toPublicUser(userRecord)
  }

  /**
   * Update a user
   */
  async update(userId: string, params: UpdateUserParams): Promise<User> {
    const userRecord = await this.storage.get<UserRecord>(`user:${userId}`)
    if (!userRecord) {
      throw AuthErrors.userNotFound()
    }

    const now = new Date().toISOString()

    // Update email index if changed
    if (params.email !== undefined && params.email !== userRecord.email) {
      if (params.email) {
        const existing = await this.storage.getByIndex<UserRecord>('email', params.email)
        if (existing && existing.id !== userId) {
          throw new AuthError('email_exists', 'This email is already in use', 409)
        }
      }

      if (userRecord.email) {
        await this.storage.deleteIndex('email', userRecord.email)
      }
      if (params.email) {
        await this.storage.setIndex('email', params.email, `user:${userId}`)
      }

      userRecord.email = params.email
      userRecord.email_verified = params.email_verified ?? false
    }

    // Update phone index if changed
    if (params.phone !== undefined && params.phone !== userRecord.phone) {
      if (params.phone) {
        const existing = await this.storage.getByIndex<UserRecord>('phone', params.phone)
        if (existing && existing.id !== userId) {
          throw new AuthError('phone_exists', 'This phone is already in use', 409)
        }
      }

      if (userRecord.phone) {
        await this.storage.deleteIndex('phone', userRecord.phone)
      }
      if (params.phone) {
        await this.storage.setIndex('phone', params.phone, `user:${userId}`)
      }

      userRecord.phone = params.phone
      userRecord.phone_verified = params.phone_verified ?? false
    }

    // Update username index if changed
    if (params.username !== undefined && params.username !== userRecord.username) {
      if (params.username) {
        const existing = await this.storage.getByIndex<UserRecord>('username', params.username)
        if (existing && existing.id !== userId) {
          throw new AuthError('username_exists', 'This username is already in use', 409)
        }
      }

      if (userRecord.username) {
        await this.storage.deleteIndex('username', userRecord.username)
      }
      if (params.username) {
        await this.storage.setIndex('username', params.username, `user:${userId}`)
      }

      userRecord.username = params.username
    }

    // Update password if provided
    if (params.password) {
      if (params.password.length < this.minPasswordLength) {
        throw AuthErrors.weakPassword(this.minPasswordLength)
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

    await this.storage.put(`user:${userId}`, userRecord)

    return this.toPublicUser(userRecord)
  }

  /**
   * Delete a user
   */
  async delete(userId: string): Promise<void> {
    const userRecord = await this.storage.get<UserRecord>(`user:${userId}`)
    if (!userRecord) return

    // Remove from indexes
    if (userRecord.email) {
      await this.storage.deleteIndex('email', userRecord.email)
    }
    if (userRecord.phone) {
      await this.storage.deleteIndex('phone', userRecord.phone)
    }
    if (userRecord.username) {
      await this.storage.deleteIndex('username', userRecord.username)
    }

    await this.storage.delete(`user:${userId}`)
  }

  /**
   * Verify a user's password
   */
  async verifyPassword(identifier: string, password: string): Promise<{ valid: boolean; user?: User; error?: string; locked?: boolean; lockUntil?: Date }> {
    let userRecord: UserRecord | null = null

    if (identifier.includes('@')) {
      userRecord = await this.storage.getByIndex<UserRecord>('email', identifier)
    } else if (identifier.startsWith('+')) {
      userRecord = await this.storage.getByIndex<UserRecord>('phone', identifier)
    } else {
      userRecord = await this.storage.getByIndex<UserRecord>('username', identifier)
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

    if (!userRecord.password_hash) {
      return { valid: false, error: 'No password set for this account' }
    }

    const isValid = await this.verifyPasswordHash(password, userRecord.password_hash)

    if (!isValid) {
      userRecord.failed_login_attempts = (userRecord.failed_login_attempts ?? 0) + 1

      if (userRecord.failed_login_attempts >= this.maxFailedLoginAttempts) {
        userRecord.locked_until = new Date(Date.now() + this.lockoutDuration * 1000).toISOString()
      }

      await this.storage.put(`user:${userRecord.id}`, userRecord)

      return { valid: false, error: 'Invalid credentials' }
    }

    // Reset failed attempts on success
    if (userRecord.failed_login_attempts && userRecord.failed_login_attempts > 0) {
      userRecord.failed_login_attempts = 0
      userRecord.locked_until = undefined
    }

    // Update last sign in
    userRecord.last_sign_in_at = new Date().toISOString()
    await this.storage.put(`user:${userRecord.id}`, userRecord)

    return { valid: true, user: this.toPublicUser(userRecord) }
  }

  /**
   * Generate email verification token
   */
  async generateEmailVerificationToken(userId: string): Promise<string> {
    const userRecord = await this.storage.get<UserRecord>(`user:${userId}`)
    if (!userRecord) {
      throw AuthErrors.userNotFound()
    }

    const token = this.generateToken()
    userRecord.email_verification_token = await this.hashToken(token)
    userRecord.email_verification_sent_at = new Date().toISOString()
    await this.storage.put(`user:${userId}`, userRecord)

    // Store reverse lookup
    await this.storage.put(`email_verification:${await this.hashToken(token)}`, userId, { ttl: 86400000 }) // 24 hours

    return token
  }

  /**
   * Verify email with token
   */
  async verifyEmailToken(token: string): Promise<User> {
    const hashedToken = await this.hashToken(token)
    const userId = await this.storage.get<string>(`email_verification:${hashedToken}`)

    if (!userId) {
      throw AuthErrors.invalidToken()
    }

    const userRecord = await this.storage.get<UserRecord>(`user:${userId}`)
    if (!userRecord) {
      throw AuthErrors.userNotFound()
    }

    userRecord.email_verified = true
    userRecord.email_verification_token = undefined
    userRecord.email_verification_sent_at = undefined
    userRecord.updated_at = new Date().toISOString()

    await this.storage.put(`user:${userId}`, userRecord)
    await this.storage.delete(`email_verification:${hashedToken}`)

    return this.toPublicUser(userRecord)
  }

  /**
   * Generate password reset token
   */
  async generatePasswordResetToken(email: string): Promise<string | null> {
    const userRecord = await this.storage.getByIndex<UserRecord>('email', email)
    if (!userRecord) return null

    const token = this.generateToken()
    userRecord.password_reset_token = await this.hashToken(token)
    userRecord.password_reset_sent_at = new Date().toISOString()
    await this.storage.put(`user:${userRecord.id}`, userRecord)

    // Store reverse lookup
    await this.storage.put(`password_reset:${await this.hashToken(token)}`, userRecord.id, { ttl: 3600000 }) // 1 hour

    return token
  }

  /**
   * Reset password with token
   */
  async resetPasswordWithToken(token: string, newPassword: string): Promise<User> {
    if (newPassword.length < this.minPasswordLength) {
      throw AuthErrors.weakPassword(this.minPasswordLength)
    }

    const hashedToken = await this.hashToken(token)
    const userId = await this.storage.get<string>(`password_reset:${hashedToken}`)

    if (!userId) {
      throw AuthErrors.invalidToken()
    }

    const userRecord = await this.storage.get<UserRecord>(`user:${userId}`)
    if (!userRecord) {
      throw AuthErrors.userNotFound()
    }

    userRecord.password_hash = await this.hashPassword(newPassword)
    userRecord.password_changed_at = new Date().toISOString()
    userRecord.password_reset_token = undefined
    userRecord.password_reset_sent_at = undefined
    userRecord.failed_login_attempts = 0
    userRecord.locked_until = undefined
    userRecord.updated_at = new Date().toISOString()

    await this.storage.put(`user:${userId}`, userRecord)
    await this.storage.delete(`password_reset:${hashedToken}`)

    return this.toPublicUser(userRecord)
  }

  /**
   * Change password for authenticated user
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const userRecord = await this.storage.get<UserRecord>(`user:${userId}`)
    if (!userRecord) {
      throw AuthErrors.userNotFound()
    }

    if (!userRecord.password_hash) {
      throw new AuthError('no_password', 'No password set for this account', 400)
    }

    const isValid = await this.verifyPasswordHash(currentPassword, userRecord.password_hash)
    if (!isValid) {
      throw AuthErrors.invalidCredentials()
    }

    if (newPassword.length < this.minPasswordLength) {
      throw AuthErrors.weakPassword(this.minPasswordLength)
    }

    userRecord.password_hash = await this.hashPassword(newPassword)
    userRecord.password_changed_at = new Date().toISOString()
    userRecord.updated_at = new Date().toISOString()

    await this.storage.put(`user:${userId}`, userRecord)
  }

  /**
   * Add an identity to a user
   */
  async addIdentity(userId: string, identity: Omit<Identity, 'user_id' | 'created_at' | 'updated_at'>): Promise<Identity> {
    const userRecord = await this.storage.get<UserRecord>(`user:${userId}`)
    if (!userRecord) {
      throw AuthErrors.userNotFound()
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

    await this.storage.put(`user:${userId}`, userRecord)

    return newIdentity
  }

  /**
   * Remove an identity from a user
   */
  async removeIdentity(userId: string, identityId: string): Promise<void> {
    const userRecord = await this.storage.get<UserRecord>(`user:${userId}`)
    if (!userRecord || !userRecord.identities) return

    userRecord.identities = userRecord.identities.filter((i) => i.id !== identityId)
    userRecord.updated_at = new Date().toISOString()

    await this.storage.put(`user:${userId}`, userRecord)
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private generateId(prefix: string): string {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    return `${prefix}_${hex}`
  }

  private generateToken(): string {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  private async hashPassword(password: string): Promise<string> {
    const encoder = new TextEncoder()
    const salt = crypto.getRandomValues(new Uint8Array(16))

    const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])

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

  private async hashToken(token: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(token)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  private constantTimeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false

    let result = 0
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i)
    }
    return result === 0
  }

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
