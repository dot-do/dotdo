/**
 * @module User
 * @description User Durable Object for human user identities
 *
 * User extends Identity to provide human-specific identity management including
 * email, name, and profile data. It follows the id.org.ai User type specification.
 *
 * **User Fields:**
 * | Field | Type | Description |
 * |-------|------|-------------|
 * | email | string | User's email address |
 * | name | string | User's display name |
 * | profile | object | Optional profile metadata |
 *
 * **Events Emitted:**
 * | Event | When |
 * |-------|------|
 * | `user.created` | User created |
 * | `user.updated` | User fields updated |
 * | `user.email.changed` | Email address changed |
 * | `user.profile.updated` | Profile data updated |
 *
 * @example Creating a User
 * ```typescript
 * const stub = env.User.get(env.User.idFromName('user@example.com'))
 * const user = await stub.createUser({
 *   email: 'user@example.com',
 *   name: 'Alice Smith'
 * })
 * ```
 *
 * @example Updating Profile
 * ```typescript
 * await stub.updateProfile({
 *   avatar: 'https://example.com/avatar.png',
 *   bio: 'Software developer',
 *   settings: { theme: 'dark' }
 * })
 * ```
 *
 * @see Identity - Base identity class
 * @see Session - Authentication session management
 */

import { Identity, type IdentityData, type CreateIdentityOptions } from './Identity'
import type { Env } from '../core/DO'
import type { User as UserType } from 'id.org.ai'

/**
 * User data extending identity data with user-specific fields
 */
export interface UserData extends IdentityData {
  /** User's email address */
  email: string
  /** User's display name */
  name: string
  /** Optional profile metadata */
  profile?: Record<string, unknown>
  /** Whether email has been verified */
  emailVerified?: boolean
  /** ISO 8601 timestamp when email was verified */
  emailVerifiedAt?: string
}

/**
 * Options for creating a user
 */
export interface CreateUserOptions extends CreateIdentityOptions {
  /** User's email address (required) */
  email: string
  /** User's display name (required) */
  name: string
  /** Optional profile metadata */
  profile?: Record<string, unknown>
}

/**
 * Options for updating a user
 */
export interface UpdateUserOptions {
  /** New display name */
  name?: string
  /** New profile data (merged with existing) */
  profile?: Record<string, unknown>
}

/**
 * User - Durable Object for human user identity management
 *
 * Provides user-specific identity capabilities including email management,
 * profile data, and name updates. Extends the base Identity class with
 * user-specific methods and fields.
 */
export class User extends Identity {
  static override readonly $type: string = 'User'

  /** Storage key for user-specific data */
  protected static readonly USER_KEY = 'user'

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  /**
   * Generate a user-specific identity ID
   */
  protected override generateIdentityId(): string {
    return super.generateIdentityId('users')
  }

  /**
   * Get the user data
   */
  async getUser(): Promise<UserData | null> {
    const identity = await this.getIdentity()
    if (!identity) return null

    const userData = await this.ctx.storage.get<Omit<UserData, keyof IdentityData>>(User.USER_KEY)
    if (!userData) return null

    return {
      ...identity,
      ...userData,
    } as UserData
  }

  /**
   * Get the user profile
   */
  async getProfile(): Promise<Record<string, unknown> | null> {
    const user = await this.getUser()
    return user?.profile ?? null
  }

  /**
   * Create a new user identity
   *
   * @param options - User creation options including email and name
   * @returns The created user data
   */
  async createUser(options: CreateUserOptions): Promise<UserData> {
    // Validate email format
    if (!options.email || !this.isValidEmail(options.email)) {
      throw new Error('Invalid email address')
    }
    if (!options.name || options.name.trim().length === 0) {
      throw new Error('Name is required')
    }

    // Create base identity
    const identity = await this.createIdentity({
      $id: options.$id,
      $type: `https://schema.org.ai/User`,
    })

    // Store user-specific data
    const userData = {
      email: options.email.toLowerCase().trim(),
      name: options.name.trim(),
      profile: options.profile,
      emailVerified: false,
    }

    await this.ctx.storage.put(User.USER_KEY, userData)

    const fullUserData: UserData = {
      ...identity,
      ...userData,
    }

    await this.emit('user.created', { user: fullUserData })

    return fullUserData
  }

  /**
   * Update user profile data
   *
   * @param profile - Profile data to merge with existing
   * @returns The updated user data
   */
  async updateProfile(profile: Record<string, unknown>): Promise<UserData> {
    const user = await this.getUser()
    if (!user) {
      throw new Error('User not found')
    }
    if (user.deleted) {
      throw new Error('Cannot update deleted user')
    }

    const existingData = await this.ctx.storage.get<Omit<UserData, keyof IdentityData>>(User.USER_KEY)
    if (!existingData) {
      throw new Error('User data not found')
    }

    // Merge profile data
    const updatedUserData = {
      ...existingData,
      profile: {
        ...existingData.profile,
        ...profile,
      },
    }

    await this.ctx.storage.put(User.USER_KEY, updatedUserData)

    // Update identity timestamp
    await this.updateIdentity({})

    const updatedUser = await this.getUser()

    await this.emit('user.profile.updated', {
      user: updatedUser,
      profileChanges: profile,
    })

    return updatedUser!
  }

  /**
   * Update user fields (name, profile)
   *
   * @param options - Fields to update
   * @returns The updated user data
   */
  async updateUser(options: UpdateUserOptions): Promise<UserData> {
    const user = await this.getUser()
    if (!user) {
      throw new Error('User not found')
    }
    if (user.deleted) {
      throw new Error('Cannot update deleted user')
    }

    const existingData = await this.ctx.storage.get<Omit<UserData, keyof IdentityData>>(User.USER_KEY)
    if (!existingData) {
      throw new Error('User data not found')
    }

    const updatedUserData = {
      ...existingData,
      ...(options.name && { name: options.name.trim() }),
      ...(options.profile && {
        profile: {
          ...existingData.profile,
          ...options.profile,
        },
      }),
    }

    await this.ctx.storage.put(User.USER_KEY, updatedUserData)

    // Update identity timestamp
    await this.updateIdentity({})

    const updatedUser = await this.getUser()

    await this.emit('user.updated', {
      user: updatedUser,
      changes: options,
    })

    return updatedUser!
  }

  /**
   * Set or update the user's email address
   *
   * @param email - New email address
   * @returns The updated user data
   */
  async setEmail(email: string): Promise<UserData> {
    if (!this.isValidEmail(email)) {
      throw new Error('Invalid email address')
    }

    const user = await this.getUser()
    if (!user) {
      throw new Error('User not found')
    }
    if (user.deleted) {
      throw new Error('Cannot update deleted user')
    }

    const existingData = await this.ctx.storage.get<Omit<UserData, keyof IdentityData>>(User.USER_KEY)
    if (!existingData) {
      throw new Error('User data not found')
    }

    const oldEmail = existingData.email
    const normalizedEmail = email.toLowerCase().trim()

    const updatedUserData = {
      ...existingData,
      email: normalizedEmail,
      emailVerified: false, // Reset verification on email change
      emailVerifiedAt: undefined,
    }

    await this.ctx.storage.put(User.USER_KEY, updatedUserData)

    // Update identity timestamp
    await this.updateIdentity({})

    const updatedUser = await this.getUser()

    await this.emit('user.email.changed', {
      user: updatedUser,
      oldEmail,
      newEmail: normalizedEmail,
    })

    return updatedUser!
  }

  /**
   * Mark the user's email as verified
   *
   * @returns The updated user data
   */
  async verifyEmail(): Promise<UserData> {
    const user = await this.getUser()
    if (!user) {
      throw new Error('User not found')
    }

    const existingData = await this.ctx.storage.get<Omit<UserData, keyof IdentityData>>(User.USER_KEY)
    if (!existingData) {
      throw new Error('User data not found')
    }

    const now = new Date().toISOString()
    const updatedUserData = {
      ...existingData,
      emailVerified: true,
      emailVerifiedAt: now,
    }

    await this.ctx.storage.put(User.USER_KEY, updatedUserData)
    await this.updateIdentity({})

    const updatedUser = await this.getUser()

    await this.emit('user.email.verified', { user: updatedUser })

    return updatedUser!
  }

  /**
   * Validate email format
   */
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return emailRegex.test(email)
  }

  /**
   * Handle HTTP requests with REST routes
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // GET /user - Get user data
    if (url.pathname === '/user' && request.method === 'GET') {
      const user = await this.getUser()
      if (!user) {
        return new Response(JSON.stringify({ error: 'User not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify(user), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // POST /user - Create user
    if (url.pathname === '/user' && request.method === 'POST') {
      try {
        const options = await request.json() as CreateUserOptions
        const user = await this.createUser(options)
        return new Response(JSON.stringify(user), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (error) {
        return new Response(JSON.stringify({ error: (error as Error).message }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // PATCH /user - Update user
    if (url.pathname === '/user' && request.method === 'PATCH') {
      try {
        const options = await request.json() as UpdateUserOptions
        const user = await this.updateUser(options)
        return new Response(JSON.stringify(user), {
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (error) {
        return new Response(JSON.stringify({ error: (error as Error).message }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // GET /profile - Get profile data
    if (url.pathname === '/profile' && request.method === 'GET') {
      const profile = await this.getProfile()
      return new Response(JSON.stringify(profile ?? {}), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // PATCH /profile - Update profile
    if (url.pathname === '/profile' && request.method === 'PATCH') {
      try {
        const profile = await request.json() as Record<string, unknown>
        const user = await this.updateProfile(profile)
        return new Response(JSON.stringify(user.profile ?? {}), {
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (error) {
        return new Response(JSON.stringify({ error: (error as Error).message }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // PUT /email - Set email
    if (url.pathname === '/email' && request.method === 'PUT') {
      try {
        const { email } = await request.json() as { email: string }
        const user = await this.setEmail(email)
        return new Response(JSON.stringify({ email: user.email, emailVerified: user.emailVerified }), {
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (error) {
        return new Response(JSON.stringify({ error: (error as Error).message }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // POST /email/verify - Verify email
    if (url.pathname === '/email/verify' && request.method === 'POST') {
      try {
        const user = await this.verifyEmail()
        return new Response(JSON.stringify({ email: user.email, emailVerified: user.emailVerified }), {
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (error) {
        return new Response(JSON.stringify({ error: (error as Error).message }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // Delegate to parent for identity routes and other routes
    return super.fetch(request)
  }
}

export default User
