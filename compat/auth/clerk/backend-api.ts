/**
 * @dotdo/clerk - Backend API
 *
 * Clerk Backend API compatible implementation.
 * Provides users, sessions, organizations, and JWT template management.
 *
 * @module
 */

import { createTemporalStore, type TemporalStore } from '../../../db/primitives/temporal-store'
import { createUserManager, type UserManager } from '../shared/users'
import { createSessionManager, type SessionManager } from '../shared/sessions'
import { createMFAManager, type MFAManager } from '../shared/mfa'
import { createJWT, verifyJWT, decodeJWT } from '../shared/jwt'
import type {
  ClerkUser,
  ClerkEmailAddress,
  ClerkPhoneNumber,
  ClerkSession,
  ClerkOrganization,
  ClerkOrganizationMembership,
  ClerkOrganizationInvitation,
  ClerkJWTTemplate,
  ClerkPaginatedList,
  ClerkDeletedObject,
  CreateUserParams,
  UpdateUserParams,
  CreateOrganizationParams,
  UpdateOrganizationParams,
  CreateInvitationParams,
  CreateJWTTemplateParams,
} from './types'
import { ClerkAPIError } from './types'

// ============================================================================
// CLERK CLIENT OPTIONS
// ============================================================================

/**
 * Clerk client configuration
 */
export interface ClerkClientOptions {
  /** Secret key from Clerk dashboard */
  secretKey: string
  /** Publishable key from Clerk dashboard */
  publishableKey?: string
  /** API version */
  apiVersion?: string
  /** JWT signing key */
  jwtKey?: string
}

// ============================================================================
// CLERK CLIENT
// ============================================================================

/**
 * Clerk Backend API client
 */
export class Clerk {
  private options: ClerkClientOptions
  private userManager: UserManager
  private sessionManager: SessionManager
  private mfaManager: MFAManager
  private organizationStore: TemporalStore<ClerkOrganization>
  private membershipStore: TemporalStore<ClerkOrganizationMembership>
  private invitationStore: TemporalStore<ClerkOrganizationInvitation>
  private jwtTemplateStore: TemporalStore<ClerkJWTTemplate>
  private userOrgStore: TemporalStore<string[]> // user_id -> org_ids
  private orgMemberStore: TemporalStore<string[]> // org_id -> membership_ids
  private externalIdIndex: TemporalStore<string> // external_id -> user_id
  private web3Index: TemporalStore<string> // web3_wallet -> user_id
  private verificationStore: TemporalStore<{
    id: string
    userId: string
    type: string
    identifier: string
    code: string
    expiresAt: number
    attempts: number
    createdAt: number
  }>
  private resetTokenStore: TemporalStore<{ userId: string; expiresAt: number }>

  constructor(options: ClerkClientOptions) {
    this.options = options

    // Extract signing key from secret key or use provided jwtKey
    const jwtSecret = options.jwtKey ?? options.secretKey

    this.userManager = createUserManager()
    this.sessionManager = createSessionManager({
      jwtSecret,
      issuer: 'https://clerk.com',
    })
    this.mfaManager = createMFAManager({ totpIssuer: 'Clerk' })
    this.organizationStore = createTemporalStore<ClerkOrganization>()
    this.membershipStore = createTemporalStore<ClerkOrganizationMembership>()
    this.invitationStore = createTemporalStore<ClerkOrganizationInvitation>()
    this.jwtTemplateStore = createTemporalStore<ClerkJWTTemplate>()
    this.userOrgStore = createTemporalStore<string[]>()
    this.orgMemberStore = createTemporalStore<string[]>()
    this.externalIdIndex = createTemporalStore<string>()
    this.web3Index = createTemporalStore<string>()
    this.verificationStore = createTemporalStore()
    this.resetTokenStore = createTemporalStore()
  }

  // ============================================================================
  // USERS API
  // ============================================================================

  /**
   * users namespace
   */
  users = {
    /**
     * Get a user by ID
     */
    getUser: async (userId: string): Promise<ClerkUser> => {
      const user = await this.userManager.getUser(userId)
      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }
      return this.toClerkUser(user)
    },

    /**
     * Get a list of users
     */
    getUserList: async (params?: {
      limit?: number
      offset?: number
      email_address?: string[]
      phone_number?: string[]
      external_id?: string[]
      username?: string[]
      user_id?: string[]
      query?: string
      order_by?: string
    }): Promise<ClerkPaginatedList<ClerkUser>> => {
      // Simplified implementation
      const users: ClerkUser[] = []

      // If specific user IDs are provided, fetch them
      if (params?.user_id) {
        for (const id of params.user_id) {
          const user = await this.userManager.getUser(id)
          if (user) {
            users.push(this.toClerkUser(user))
          }
        }
      }

      // If email addresses are provided, fetch by email
      if (params?.email_address) {
        for (const email of params.email_address) {
          const user = await this.userManager.getUserByEmail(email)
          if (user && !users.find((u) => u.id === user.id)) {
            users.push(this.toClerkUser(user))
          }
        }
      }

      return {
        data: users,
        total_count: users.length,
      }
    },

    /**
     * Create a new user
     */
    createUser: async (params: CreateUserParams): Promise<ClerkUser> => {
      // Handle skip_password_checks and skip_password_requirement
      const passwordToUse = params.skip_password_requirement ? undefined : params.password
      const skipPasswordChecks = params.skip_password_checks ?? false

      // If password is too short and skip_password_checks is not set, we need to validate
      if (passwordToUse && !skipPasswordChecks && passwordToUse.length < 8) {
        throw new ClerkAPIError(422, [{ code: 'form_password_pwned', message: 'Password must be at least 8 characters' }])
      }

      try {
        // Determine the password to pass to UserManager:
        // - If skip_password_checks is true, we don't pass password to avoid validation
        // - Otherwise, pass the password for normal validation
        const passwordForUserManager = skipPasswordChecks ? undefined : passwordToUse

        // Create base user
        const user = await this.userManager.createUser({
          email: params.email_address?.[0],
          phone: params.phone_number?.[0],
          username: params.username,
          password: passwordForUserManager,
          first_name: params.first_name ?? undefined,
          last_name: params.last_name ?? undefined,
          metadata: params.public_metadata ?? {},
          app_metadata: {
            private_metadata: params.private_metadata ?? {},
            external_id: params.external_id,
            unsafe_metadata: params.unsafe_metadata ?? {},
            // Store additional clerk-specific data
            additional_email_addresses: params.email_address?.slice(1) ?? [],
            additional_phone_numbers: params.phone_number?.slice(1) ?? [],
            web3_wallets: params.web3_wallet ?? [],
            totp_enabled: !!params.totp_secret,
            totp_secret: params.totp_secret,
            backup_code_enabled: !!params.backup_codes?.length,
            backup_codes: params.backup_codes,
            two_factor_enabled: !!params.totp_secret || !!params.backup_codes?.length,
            delete_self_enabled: params.delete_self_enabled ?? true,
            create_organization_enabled: params.create_organization_enabled ?? true,
            password_enabled: !!passwordToUse || !!params.password_digest,
            password_digest: params.password_digest,
            custom_created_at: params.created_at ? new Date(params.created_at).getTime() : undefined,
            // Store weak password hash if skip_password_checks is true
            skip_password_hash: skipPasswordChecks && passwordToUse ? await this.hashSimplePassword(passwordToUse) : undefined,
          },
        })

        // Store external_id index if provided
        if (params.external_id) {
          await this.externalIdIndex.put(`external:${params.external_id}`, user.id, Date.now())
        }

        // Store web3 wallet indexes
        if (params.web3_wallet) {
          for (const wallet of params.web3_wallet) {
            await this.web3Index.put(`web3:${wallet.toLowerCase()}`, user.id, Date.now())
          }
        }

        return this.toClerkUser(user)
      } catch (error: unknown) {
        // Convert AuthenticationError to ClerkAPIError
        if (error && typeof error === 'object' && 'code' in error) {
          const authError = error as { code: string; message: string }
          if (authError.code === 'user_exists') {
            throw new ClerkAPIError(422, [{ code: 'form_identifier_exists', message: authError.message }])
          }
          if (authError.code === 'weak_password') {
            throw new ClerkAPIError(422, [{ code: 'form_password_pwned', message: authError.message }])
          }
        }
        throw error
      }
    },

    /**
     * Update a user
     */
    updateUser: async (userId: string, params: UpdateUserParams): Promise<ClerkUser> => {
      // First get existing user to merge app_metadata
      const existingUser = await this.userManager.getUser(userId)
      if (!existingUser) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }

      // Handle skip_password_checks
      const skipPasswordChecks = params.skip_password_checks ?? false
      const passwordToUse = params.password

      // Validate password unless skip_password_checks is true
      if (passwordToUse && !skipPasswordChecks && passwordToUse.length < 8) {
        throw new ClerkAPIError(422, [{ code: 'form_password_pwned', message: 'Password must be at least 8 characters' }])
      }

      // Build new app_metadata by merging existing with new values
      const existingAppMetadata = existingUser.app_metadata ?? {}
      const newAppMetadata: Record<string, unknown> = { ...existingAppMetadata }

      // Update specific fields in app_metadata if provided
      if (params.private_metadata !== undefined) {
        newAppMetadata.private_metadata = params.private_metadata
      }
      if (params.unsafe_metadata !== undefined) {
        newAppMetadata.unsafe_metadata = params.unsafe_metadata
      }
      if (params.external_id !== undefined) {
        // Check for duplicate external_id
        if (params.external_id) {
          const existingUserId = await this.externalIdIndex.get(`external:${params.external_id}`)
          if (existingUserId && existingUserId !== userId) {
            throw new ClerkAPIError(422, [{ code: 'form_identifier_exists', message: 'A user with this external_id already exists' }])
          }
        }
        // Update index
        const oldExternalId = existingAppMetadata.external_id as string | undefined
        if (oldExternalId && oldExternalId !== params.external_id) {
          await this.externalIdIndex.put(`external:${oldExternalId}`, null as unknown as string, Date.now())
        }
        if (params.external_id) {
          await this.externalIdIndex.put(`external:${params.external_id}`, userId, Date.now())
        }
        newAppMetadata.external_id = params.external_id
      }
      if (params.totp_secret !== undefined) {
        newAppMetadata.totp_enabled = !!params.totp_secret
        newAppMetadata.totp_secret = params.totp_secret
        newAppMetadata.two_factor_enabled = !!params.totp_secret || !!(existingAppMetadata.backup_code_enabled)
      }
      if (params.backup_codes !== undefined) {
        newAppMetadata.backup_code_enabled = !!params.backup_codes?.length
        newAppMetadata.backup_codes = params.backup_codes
        newAppMetadata.two_factor_enabled = !!(existingAppMetadata.totp_enabled) || !!params.backup_codes?.length
      }
      if (params.delete_self_enabled !== undefined) {
        newAppMetadata.delete_self_enabled = params.delete_self_enabled
      }
      if (params.create_organization_enabled !== undefined) {
        newAppMetadata.create_organization_enabled = params.create_organization_enabled
      }
      if (params.primary_email_address_id !== undefined) {
        newAppMetadata.primary_email_address_id = params.primary_email_address_id
      }
      if (params.primary_phone_number_id !== undefined) {
        newAppMetadata.primary_phone_number_id = params.primary_phone_number_id
      }
      if (params.password_digest !== undefined) {
        newAppMetadata.password_digest = params.password_digest
        newAppMetadata.password_enabled = true
      }
      if (skipPasswordChecks && passwordToUse) {
        newAppMetadata.skip_password_hash = await this.hashSimplePassword(passwordToUse)
        newAppMetadata.password_enabled = true
      }

      try {
        // Check for duplicate username
        if (params.username && params.username !== existingUser.username) {
          const existingByUsername = await this.userManager.getUserByUsername(params.username)
          if (existingByUsername && existingByUsername.id !== userId) {
            throw new ClerkAPIError(422, [{ code: 'form_identifier_exists', message: 'A user with this username already exists' }])
          }
        }

        const user = await this.userManager.updateUser(userId, {
          username: params.username,
          password: skipPasswordChecks ? undefined : passwordToUse,
          first_name: params.first_name ?? undefined,
          last_name: params.last_name ?? undefined,
          metadata: params.public_metadata ?? existingUser.metadata,
          app_metadata: newAppMetadata,
        })

        return this.toClerkUser(user)
      } catch (error: unknown) {
        if (error instanceof ClerkAPIError) {
          throw error
        }
        if (error && typeof error === 'object' && 'code' in error) {
          const authError = error as { code: string; message: string }
          if (authError.code === 'user_exists') {
            throw new ClerkAPIError(422, [{ code: 'form_identifier_exists', message: authError.message }])
          }
          if (authError.code === 'weak_password') {
            throw new ClerkAPIError(422, [{ code: 'form_password_pwned', message: authError.message }])
          }
          if (authError.code === 'user_not_found') {
            throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
          }
        }
        throw error
      }
    },

    /**
     * Delete a user
     */
    deleteUser: async (userId: string): Promise<ClerkDeletedObject> => {
      const user = await this.userManager.getUser(userId)
      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }

      await this.userManager.deleteUser(userId)

      return {
        id: userId,
        object: 'user',
        deleted: true,
      }
    },

    /**
     * Ban a user
     */
    banUser: async (userId: string): Promise<ClerkUser> => {
      const user = await this.userManager.updateUser(userId, {
        app_metadata: { banned: true },
      })
      return this.toClerkUser(user)
    },

    /**
     * Unban a user
     */
    unbanUser: async (userId: string): Promise<ClerkUser> => {
      const user = await this.userManager.updateUser(userId, {
        app_metadata: { banned: false },
      })
      return this.toClerkUser(user)
    },

    /**
     * Lock a user
     */
    lockUser: async (userId: string): Promise<ClerkUser> => {
      const user = await this.userManager.updateUser(userId, {
        app_metadata: { locked: true },
      })
      return this.toClerkUser(user)
    },

    /**
     * Unlock a user
     */
    unlockUser: async (userId: string): Promise<ClerkUser> => {
      const user = await this.userManager.updateUser(userId, {
        app_metadata: { locked: false },
      })
      return this.toClerkUser(user)
    },

    /**
     * Get user's organization memberships
     */
    getOrganizationMembershipList: async (params: {
      userId: string
      limit?: number
      offset?: number
    }): Promise<ClerkPaginatedList<ClerkOrganizationMembership>> => {
      const orgIds = (await this.userOrgStore.get(`user_orgs:${params.userId}`)) ?? []
      const memberships: ClerkOrganizationMembership[] = []

      for (const orgId of orgIds) {
        const membershipIds = (await this.orgMemberStore.get(`org_members:${orgId}`)) ?? []
        for (const membershipId of membershipIds) {
          const membership = await this.membershipStore.get(`membership:${membershipId}`)
          if (membership && membership.public_user_data.user_id === params.userId) {
            memberships.push(membership)
          }
        }
      }

      return {
        data: memberships.slice(params.offset ?? 0, (params.offset ?? 0) + (params.limit ?? 10)),
        total_count: memberships.length,
      }
    },

    /**
     * Verify a user's password
     */
    verifyPassword: async (params: { userId: string; password: string }): Promise<{ verified: boolean }> => {
      const user = await this.userManager.getUser(params.userId)
      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }

      // Get identifier for password verification
      const identifier = user.email ?? user.username ?? user.id
      const result = await this.userManager.verifyPassword(identifier, params.password)

      return { verified: result.valid }
    },

    /**
     * Verify a TOTP code
     */
    verifyTOTP: async (params: { userId: string; code: string }): Promise<{ verified: boolean; code_type: 'totp' }> => {
      const factors = await this.mfaManager.listVerifiedFactors(params.userId)
      const totpFactor = factors.find((f) => f.type === 'totp')

      if (!totpFactor) {
        return { verified: false, code_type: 'totp' }
      }

      const verified = await this.mfaManager.verifyTOTP(totpFactor.id, params.code)

      return { verified, code_type: 'totp' }
    },

    /**
     * Disable user's MFA
     */
    disableMFA: async (userId: string): Promise<ClerkUser> => {
      const factors = await this.mfaManager.listFactors(userId)
      for (const factor of factors) {
        await this.mfaManager.unenrollFactor(factor.id)
      }

      const user = await this.userManager.getUser(userId)
      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }

      return this.toClerkUser(user)
    },

    /**
     * List users with optional filters
     */
    listUsers: async (params?: {
      limit?: number
      offset?: number
      emailAddress?: string[]
      phoneNumber?: string[]
      externalId?: string[]
      username?: string[]
      userId?: string[]
      query?: string
      orderBy?: 'created_at' | 'updated_at' | 'last_sign_in_at' | '-created_at' | '-updated_at' | '-last_sign_in_at'
    }): Promise<ClerkPaginatedList<ClerkUser>> => {
      const users: ClerkUser[] = []
      const seenIds = new Set<string>()

      // Fetch by user IDs
      if (params?.userId) {
        for (const id of params.userId) {
          if (!seenIds.has(id)) {
            const user = await this.userManager.getUser(id)
            if (user) {
              users.push(this.toClerkUser(user))
              seenIds.add(id)
            }
          }
        }
      }

      // Fetch by email addresses
      if (params?.emailAddress) {
        for (const email of params.emailAddress) {
          const user = await this.userManager.getUserByEmail(email)
          if (user && !seenIds.has(user.id)) {
            users.push(this.toClerkUser(user))
            seenIds.add(user.id)
          }
        }
      }

      // Fetch by phone numbers
      if (params?.phoneNumber) {
        for (const phone of params.phoneNumber) {
          const user = await this.userManager.getUserByPhone(phone)
          if (user && !seenIds.has(user.id)) {
            users.push(this.toClerkUser(user))
            seenIds.add(user.id)
          }
        }
      }

      // Fetch by usernames
      if (params?.username) {
        for (const username of params.username) {
          const user = await this.userManager.getUserByUsername(username)
          if (user && !seenIds.has(user.id)) {
            users.push(this.toClerkUser(user))
            seenIds.add(user.id)
          }
        }
      }

      // Fetch by external IDs
      if (params?.externalId) {
        for (const extId of params.externalId) {
          const storedUserId = await this.externalIdIndex.get(`external:${extId}`)
          if (storedUserId && !seenIds.has(storedUserId)) {
            const user = await this.userManager.getUser(storedUserId)
            if (user) {
              users.push(this.toClerkUser(user))
              seenIds.add(storedUserId)
            }
          }
        }
      }

      // Sort if orderBy is specified
      if (params?.orderBy) {
        const desc = params.orderBy.startsWith('-')
        const field = params.orderBy.replace('-', '') as 'created_at' | 'updated_at' | 'last_sign_in_at'
        users.sort((a, b) => {
          const aVal = a[field] ?? 0
          const bVal = b[field] ?? 0
          return desc ? bVal - aVal : aVal - bVal
        })
      }

      const limit = params?.limit ?? 10
      const offset = params?.offset ?? 0

      return {
        data: users.slice(offset, offset + limit),
        total_count: users.length,
      }
    },

    /**
     * Search users by query
     */
    searchUsers: async (query: string): Promise<ClerkPaginatedList<ClerkUser>> => {
      const users: ClerkUser[] = []
      const queryLower = query.toLowerCase()

      // Search by email
      const userByEmail = await this.userManager.getUserByEmail(queryLower)
      if (userByEmail) {
        users.push(this.toClerkUser(userByEmail))
      }

      // Search by username
      const userByUsername = await this.userManager.getUserByUsername(queryLower)
      if (userByUsername && !users.find((u) => u.id === userByUsername.id)) {
        users.push(this.toClerkUser(userByUsername))
      }

      return {
        data: users,
        total_count: users.length,
      }
    },

    /**
     * Filter users by multiple criteria
     */
    filterUsers: async (params: {
      emailAddress?: string[]
      phoneNumber?: string[]
      web3Wallet?: string[]
      externalId?: string[]
      username?: string[]
    }): Promise<ClerkPaginatedList<ClerkUser>> => {
      const users: ClerkUser[] = []
      const seenIds = new Set<string>()

      if (params.emailAddress) {
        for (const email of params.emailAddress) {
          const user = await this.userManager.getUserByEmail(email)
          if (user && !seenIds.has(user.id)) {
            users.push(this.toClerkUser(user))
            seenIds.add(user.id)
          }
        }
      }

      if (params.phoneNumber) {
        for (const phone of params.phoneNumber) {
          const user = await this.userManager.getUserByPhone(phone)
          if (user && !seenIds.has(user.id)) {
            users.push(this.toClerkUser(user))
            seenIds.add(user.id)
          }
        }
      }

      if (params.username) {
        for (const username of params.username) {
          const user = await this.userManager.getUserByUsername(username)
          if (user && !seenIds.has(user.id)) {
            users.push(this.toClerkUser(user))
            seenIds.add(user.id)
          }
        }
      }

      if (params.externalId) {
        for (const extId of params.externalId) {
          const userId = await this.externalIdIndex.get(`external:${extId}`)
          if (userId && !seenIds.has(userId)) {
            const user = await this.userManager.getUser(userId)
            if (user) {
              users.push(this.toClerkUser(user))
              seenIds.add(userId)
            }
          }
        }
      }

      if (params.web3Wallet) {
        for (const wallet of params.web3Wallet) {
          const userId = await this.web3Index.get(`web3:${wallet.toLowerCase()}`)
          if (userId && !seenIds.has(userId)) {
            const user = await this.userManager.getUser(userId)
            if (user) {
              users.push(this.toClerkUser(user))
              seenIds.add(userId)
            }
          }
        }
      }

      return {
        data: users,
        total_count: users.length,
      }
    },

    /**
     * Get user by email address
     */
    getUserByEmail: async (email: string): Promise<ClerkUser | null> => {
      const user = await this.userManager.getUserByEmail(email)
      return user ? this.toClerkUser(user) : null
    },

    /**
     * Get user by external ID
     */
    getUserByExternalId: async (externalId: string): Promise<ClerkUser | null> => {
      const userId = await this.externalIdIndex.get(`external:${externalId}`)
      if (!userId) return null
      const user = await this.userManager.getUser(userId)
      return user ? this.toClerkUser(user) : null
    },

    /**
     * Update user metadata
     */
    updateUserMetadata: async (
      userId: string,
      params: {
        publicMetadata?: Record<string, unknown>
        privateMetadata?: Record<string, unknown>
        unsafeMetadata?: Record<string, unknown>
      }
    ): Promise<ClerkUser> => {
      const existingUser = await this.userManager.getUser(userId)
      if (!existingUser) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }

      const newMetadata = params.publicMetadata ?? existingUser.metadata
      const newPrivateMetadata = params.privateMetadata ?? (existingUser.app_metadata.private_metadata as Record<string, unknown>) ?? {}
      const newUnsafeMetadata = params.unsafeMetadata ?? (existingUser.app_metadata.unsafe_metadata as Record<string, unknown>) ?? {}

      const user = await this.userManager.updateUser(userId, {
        metadata: newMetadata,
        app_metadata: {
          ...existingUser.app_metadata,
          private_metadata: newPrivateMetadata,
          unsafe_metadata: newUnsafeMetadata,
        },
      })

      return this.toClerkUser(user)
    },

    /**
     * Get user metadata
     */
    getUserMetadata: async (userId: string): Promise<{
      publicMetadata: Record<string, unknown>
      privateMetadata: Record<string, unknown>
      unsafeMetadata: Record<string, unknown>
    }> => {
      const user = await this.userManager.getUser(userId)
      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }

      return {
        publicMetadata: user.metadata ?? {},
        privateMetadata: (user.app_metadata?.private_metadata as Record<string, unknown>) ?? {},
        unsafeMetadata: (user.app_metadata?.unsafe_metadata as Record<string, unknown>) ?? {},
      }
    },

    /**
     * Update password
     */
    updatePassword: async (userId: string, newPassword: string): Promise<ClerkUser> => {
      if (newPassword.length < 8) {
        throw new ClerkAPIError(422, [{ code: 'form_password_pwned', message: 'Password must be at least 8 characters' }])
      }

      const user = await this.userManager.updateUser(userId, {
        password: newPassword,
      })

      return this.toClerkUser(user)
    },

    /**
     * Reset password (generate reset token)
     */
    resetPassword: async (userId: string): Promise<{ resetToken: string; expiresAt: number }> => {
      const user = await this.userManager.getUser(userId)
      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }

      const resetToken = this.generateToken()
      const expiresAt = Date.now() + 3600000 // 1 hour

      await this.resetTokenStore.put(`reset:${resetToken}`, { userId, expiresAt }, Date.now())

      return { resetToken, expiresAt }
    },

    /**
     * Check password strength
     */
    checkPasswordStrength: (password: string): {
      strength: 'very_weak' | 'weak' | 'fair' | 'strong' | 'very_strong'
      score: number
      warnings: string[]
      suggestions: string[]
    } => {
      const warnings: string[] = []
      const suggestions: string[] = []
      let score = 0

      // Length checks
      if (password.length >= 8) score += 1
      if (password.length >= 12) score += 1
      if (password.length >= 16) score += 1
      if (password.length < 8) {
        warnings.push('Password is too short')
        suggestions.push('Use at least 8 characters')
      }

      // Character diversity checks
      if (/[a-z]/.test(password)) score += 1
      else suggestions.push('Add lowercase letters')

      if (/[A-Z]/.test(password)) score += 1
      else suggestions.push('Add uppercase letters')

      if (/[0-9]/.test(password)) score += 1
      else suggestions.push('Add numbers')

      if (/[^a-zA-Z0-9]/.test(password)) score += 1
      else suggestions.push('Add special characters')

      // Common patterns check
      const commonPatterns = ['123456', 'password', 'qwerty', 'abc123', 'letmein', 'admin']
      const lowerPassword = password.toLowerCase()
      for (const pattern of commonPatterns) {
        if (lowerPassword.includes(pattern)) {
          score = Math.max(0, score - 2)
          warnings.push('Contains common password pattern')
          break
        }
      }

      // Repeated characters
      if (/(.)\1{2,}/.test(password)) {
        score = Math.max(0, score - 1)
        warnings.push('Contains repeated characters')
      }

      // Map score to strength
      let strength: 'very_weak' | 'weak' | 'fair' | 'strong' | 'very_strong'
      if (score <= 1) strength = 'very_weak'
      else if (score <= 2) strength = 'weak'
      else if (score <= 4) strength = 'fair'
      else if (score <= 6) strength = 'strong'
      else strength = 'very_strong'

      return { strength, score, warnings, suggestions }
    },

    /**
     * Create email verification
     */
    createEmailVerification: async (userId: string, email: string): Promise<{ verificationId: string; code: string }> => {
      const user = await this.userManager.getUser(userId)
      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }

      // Check if email belongs to user
      if (user.email?.toLowerCase() !== email.toLowerCase()) {
        throw new ClerkAPIError(422, [{ code: 'resource_not_found', message: 'Email address not found for user' }])
      }

      const verificationId = this.generateId('ev')
      const code = this.generateVerificationCode()
      const now = Date.now()

      await this.verificationStore.put(`verification:${verificationId}`, {
        id: verificationId,
        userId,
        type: 'email',
        identifier: email.toLowerCase(),
        code,
        expiresAt: now + 600000, // 10 minutes
        attempts: 0,
        createdAt: now,
      }, now)

      return { verificationId, code }
    },

    /**
     * Verify email with code
     */
    verifyEmail: async (userId: string, code: string): Promise<ClerkUser> => {
      const user = await this.userManager.getUser(userId)
      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }

      // Find verification by scanning
      let found = false
      const iterator = this.verificationStore.range('verification:', {})
      let result = await iterator.next()
      while (!result.done) {
        const v = result.value as { id: string; userId: string; type: string; code: string; expiresAt: number; identifier: string }
        if (v.userId === userId && v.type === 'email' && v.code === code) {
          if (Date.now() > v.expiresAt) {
            throw new ClerkAPIError(422, [{ code: 'verification_expired', message: 'Verification code has expired' }])
          }
          found = true
          await this.verificationStore.put(`verification:${v.id}`, null as unknown as typeof v, Date.now())
          break
        }
        result = await iterator.next()
      }

      if (!found) {
        throw new ClerkAPIError(422, [{ code: 'verification_failed', message: 'Invalid verification code' }])
      }

      // Update user email_verified
      const updated = await this.userManager.updateUser(userId, {
        email_verified: true,
      })

      return this.toClerkUser(updated)
    },

    /**
     * Create phone verification
     */
    createPhoneVerification: async (userId: string, phone: string): Promise<{ verificationId: string; code: string }> => {
      const user = await this.userManager.getUser(userId)
      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }

      if (user.phone !== phone) {
        throw new ClerkAPIError(422, [{ code: 'resource_not_found', message: 'Phone number not found for user' }])
      }

      const verificationId = this.generateId('pv')
      const code = this.generateVerificationCode()
      const now = Date.now()

      await this.verificationStore.put(`verification:${verificationId}`, {
        id: verificationId,
        userId,
        type: 'phone',
        identifier: phone,
        code,
        expiresAt: now + 600000,
        attempts: 0,
        createdAt: now,
      }, now)

      return { verificationId, code }
    },

    /**
     * Verify phone with code
     */
    verifyPhone: async (userId: string, code: string): Promise<ClerkUser> => {
      const user = await this.userManager.getUser(userId)
      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }

      let found = false
      const iterator = this.verificationStore.range('verification:', {})
      let result = await iterator.next()
      while (!result.done) {
        const v = result.value as { id: string; userId: string; type: string; code: string; expiresAt: number }
        if (v.userId === userId && v.type === 'phone' && v.code === code) {
          if (Date.now() > v.expiresAt) {
            throw new ClerkAPIError(422, [{ code: 'verification_expired', message: 'Verification code has expired' }])
          }
          found = true
          await this.verificationStore.put(`verification:${v.id}`, null as unknown as typeof v, Date.now())
          break
        }
        result = await iterator.next()
      }

      if (!found) {
        throw new ClerkAPIError(422, [{ code: 'verification_failed', message: 'Invalid verification code' }])
      }

      const updated = await this.userManager.updateUser(userId, {
        phone_verified: true,
      })

      return this.toClerkUser(updated)
    },

    /**
     * Link external account
     */
    linkExternalAccount: async (
      userId: string,
      params: {
        provider: string
        token: string
        providerUserId?: string
        email?: string
        firstName?: string
        lastName?: string
        imageUrl?: string
        username?: string
      }
    ): Promise<{
      id: string
      object: 'external_account'
      provider: string
      provider_user_id: string
      email_address: string
      first_name: string | null
      last_name: string | null
      image_url: string | null
      username: string | null
      linked: boolean
      verification: { status: string; strategy: string } | null
    }> => {
      const user = await this.userManager.getUser(userId)
      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }

      // Check for existing external account
      const existingAccounts = (user.app_metadata?.external_accounts as Array<{ provider: string; provider_user_id: string }>) ?? []
      const providerUserId = params.providerUserId ?? this.generateId('puid')

      if (existingAccounts.find((a) => a.provider === params.provider && a.provider_user_id === providerUserId)) {
        throw new ClerkAPIError(422, [{ code: 'external_account_exists', message: 'External account already linked' }])
      }

      const accountId = this.generateId('eac')
      const now = Date.now()

      const newAccount = {
        id: accountId,
        provider: params.provider,
        provider_user_id: providerUserId,
        email_address: params.email ?? '',
        first_name: params.firstName ?? null,
        last_name: params.lastName ?? null,
        image_url: params.imageUrl ?? null,
        username: params.username ?? null,
        created_at: now,
        updated_at: now,
      }

      await this.userManager.updateUser(userId, {
        app_metadata: {
          ...user.app_metadata,
          external_accounts: [...existingAccounts, newAccount],
        },
      })

      return {
        id: accountId,
        object: 'external_account',
        provider: params.provider,
        provider_user_id: providerUserId,
        email_address: params.email ?? '',
        first_name: params.firstName ?? null,
        last_name: params.lastName ?? null,
        image_url: params.imageUrl ?? null,
        username: params.username ?? null,
        linked: true,
        verification: { status: 'verified', strategy: params.provider },
      }
    },

    /**
     * Unlink external account
     */
    unlinkExternalAccount: async (userId: string, accountId: string): Promise<ClerkDeletedObject> => {
      const user = await this.userManager.getUser(userId)
      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }

      const existingAccounts = (user.app_metadata?.external_accounts as Array<{ id: string }>) ?? []
      const accountIndex = existingAccounts.findIndex((a) => a.id === accountId)

      if (accountIndex === -1) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'External account not found' }])
      }

      existingAccounts.splice(accountIndex, 1)

      await this.userManager.updateUser(userId, {
        app_metadata: {
          ...user.app_metadata,
          external_accounts: existingAccounts,
        },
      })

      return {
        id: accountId,
        object: 'external_account',
        deleted: true,
      }
    },

    /**
     * List external accounts
     */
    listExternalAccounts: async (userId: string): Promise<ClerkPaginatedList<{
      id: string
      object: 'external_account'
      provider: string
      provider_user_id: string
      email_address: string
      first_name: string | null
      last_name: string | null
      image_url: string | null
      username: string | null
    }>> => {
      const user = await this.userManager.getUser(userId)
      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }

      const accounts = (user.app_metadata?.external_accounts as Array<{
        id: string
        provider: string
        provider_user_id: string
        email_address: string
        first_name: string | null
        last_name: string | null
        image_url: string | null
        username: string | null
      }>) ?? []

      return {
        data: accounts.map((a) => ({
          ...a,
          object: 'external_account' as const,
        })),
        total_count: accounts.length,
      }
    },

    /**
     * Ban user with reason
     */
    banUser: async (userId: string, reason?: string): Promise<ClerkUser> => {
      const user = await this.userManager.updateUser(userId, {
        app_metadata: { banned: true, ban_reason: reason },
      })
      return this.toClerkUser(user)
    },

    /**
     * Check if user is banned
     */
    isUserBanned: async (userId: string): Promise<{ banned: boolean; reason?: string }> => {
      const user = await this.userManager.getUser(userId)
      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }

      return {
        banned: (user.app_metadata?.banned as boolean) ?? false,
        reason: user.app_metadata?.ban_reason as string | undefined,
      }
    },
  }

  // ============================================================================
  // SESSIONS API
  // ============================================================================

  /**
   * sessions namespace
   */
  sessions = {
    /**
     * Get a session by ID
     */
    getSession: async (sessionId: string): Promise<ClerkSession> => {
      const session = await this.sessionManager.getSession(sessionId)
      if (!session) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Session not found' }])
      }
      return this.toClerkSession(session)
    },

    /**
     * Get a list of sessions
     */
    getSessionList: async (params?: {
      client_id?: string
      user_id?: string
      status?: string
      limit?: number
      offset?: number
    }): Promise<ClerkPaginatedList<ClerkSession>> => {
      if (!params?.user_id) {
        return { data: [], total_count: 0 }
      }

      const sessions = await this.sessionManager.listUserSessions(params.user_id)
      const clerkSessions = sessions.map((s) => this.toClerkSession(s))

      // Filter by status if provided
      const filtered = params.status ? clerkSessions.filter((s) => s.status === params.status) : clerkSessions

      return {
        data: filtered.slice(params.offset ?? 0, (params.offset ?? 0) + (params.limit ?? 10)),
        total_count: filtered.length,
      }
    },

    /**
     * Revoke a session
     */
    revokeSession: async (sessionId: string): Promise<ClerkSession> => {
      await this.sessionManager.revokeSession(sessionId)

      const session = await this.sessionManager.getSession(sessionId)
      if (!session) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Session not found' }])
      }

      return this.toClerkSession(session)
    },

    /**
     * Get session token
     */
    getToken: async (sessionId: string, template?: string): Promise<{ jwt: string }> => {
      const session = await this.sessionManager.getSession(sessionId)
      if (!session) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Session not found' }])
      }

      const user = await this.userManager.getUser(session.user_id)
      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }

      // Get template if provided
      let claims: Record<string, unknown> = {}
      let lifetime = 60

      if (template) {
        const jwtTemplate = await this.jwtTemplateStore.get(`jwt_template:${template}`)
        if (jwtTemplate) {
          claims = { ...jwtTemplate.claims }
          lifetime = jwtTemplate.lifetime
        }
      }

      const jwt = await createJWT(
        {
          ...claims,
          sid: session.id,
          email: user.email,
          name: user.name,
        },
        {
          secret: this.options.jwtKey ?? this.options.secretKey,
          issuer: 'https://clerk.com',
          subject: user.id,
          expiresIn: lifetime,
        }
      )

      return { jwt }
    },

    /**
     * Verify a session token
     */
    verifySession: async (
      sessionId: string,
      token: string
    ): Promise<{ session: ClerkSession; user: ClerkUser }> => {
      const result = await verifyJWT(token, {
        secret: this.options.jwtKey ?? this.options.secretKey,
        issuer: 'https://clerk.com',
      })

      if (!result.valid || result.claims?.sid !== sessionId) {
        throw new ClerkAPIError(401, [{ code: 'session_not_found', message: 'Invalid session token' }])
      }

      const session = await this.sessionManager.getSession(sessionId)
      if (!session || session.status !== 'active') {
        throw new ClerkAPIError(401, [{ code: 'session_not_found', message: 'Session not found or inactive' }])
      }

      const user = await this.userManager.getUser(session.user_id)
      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }

      return {
        session: this.toClerkSession(session),
        user: this.toClerkUser(user),
      }
    },
  }

  // ============================================================================
  // ORGANIZATIONS API
  // ============================================================================

  /**
   * organizations namespace
   */
  organizations = {
    /**
     * Get an organization by ID
     */
    getOrganization: async (organizationId: string): Promise<ClerkOrganization> => {
      const org = await this.organizationStore.get(`org:${organizationId}`)
      if (!org) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Organization not found' }])
      }
      return org
    },

    /**
     * Get organization list
     */
    getOrganizationList: async (params?: {
      limit?: number
      offset?: number
      include_members_count?: boolean
      query?: string
      user_id?: string[]
      order_by?: string
    }): Promise<ClerkPaginatedList<ClerkOrganization>> => {
      // Simplified - would need proper listing in production
      return { data: [], total_count: 0 }
    },

    /**
     * Create an organization
     */
    createOrganization: async (params: CreateOrganizationParams): Promise<ClerkOrganization> => {
      const orgId = this.generateId('org')
      const now = Date.now()

      const org: ClerkOrganization = {
        id: orgId,
        object: 'organization',
        name: params.name,
        slug: params.slug ?? this.slugify(params.name),
        image_url: '',
        has_image: false,
        members_count: 1,
        pending_invitations_count: 0,
        max_allowed_memberships: params.max_allowed_memberships ?? 5,
        admin_delete_enabled: true,
        public_metadata: params.public_metadata ?? {},
        private_metadata: params.private_metadata ?? {},
        created_at: now,
        updated_at: now,
      }

      await this.organizationStore.put(`org:${orgId}`, org, now)

      // Create membership for creator as admin
      const membershipId = this.generateId('mem')
      const user = await this.userManager.getUser(params.created_by)

      const membership: ClerkOrganizationMembership = {
        id: membershipId,
        object: 'organization_membership',
        public_metadata: {},
        private_metadata: {},
        role: 'admin',
        created_at: now,
        updated_at: now,
        organization: org,
        public_user_data: {
          user_id: params.created_by,
          first_name: user?.first_name ?? null,
          last_name: user?.last_name ?? null,
          image_url: user?.picture ?? '',
          has_image: !!user?.picture,
          identifier: user?.email ?? user?.username ?? params.created_by,
        },
      }

      await this.membershipStore.put(`membership:${membershipId}`, membership, now)
      await this.addUserToOrg(params.created_by, orgId, membershipId)

      return org
    },

    /**
     * Update an organization
     */
    updateOrganization: async (
      organizationId: string,
      params: UpdateOrganizationParams
    ): Promise<ClerkOrganization> => {
      const org = await this.organizations.getOrganization(organizationId)
      const now = Date.now()

      const updated: ClerkOrganization = {
        ...org,
        name: params.name ?? org.name,
        slug: params.slug ?? org.slug,
        max_allowed_memberships: params.max_allowed_memberships ?? org.max_allowed_memberships,
        admin_delete_enabled: params.admin_delete_enabled ?? org.admin_delete_enabled,
        public_metadata: params.public_metadata ?? org.public_metadata,
        private_metadata: params.private_metadata ?? org.private_metadata,
        updated_at: now,
      }

      await this.organizationStore.put(`org:${organizationId}`, updated, now)

      return updated
    },

    /**
     * Delete an organization
     */
    deleteOrganization: async (organizationId: string): Promise<ClerkDeletedObject> => {
      await this.organizationStore.put(`org:${organizationId}`, null as unknown as ClerkOrganization, Date.now())

      return {
        id: organizationId,
        object: 'organization',
        deleted: true,
      }
    },

    /**
     * Get organization membership list
     */
    getOrganizationMembershipList: async (params: {
      organizationId: string
      limit?: number
      offset?: number
      role?: string[]
    }): Promise<ClerkPaginatedList<ClerkOrganizationMembership>> => {
      const membershipIds = (await this.orgMemberStore.get(`org_members:${params.organizationId}`)) ?? []
      const memberships: ClerkOrganizationMembership[] = []

      for (const membershipId of membershipIds) {
        const membership = await this.membershipStore.get(`membership:${membershipId}`)
        if (membership) {
          // Filter by role if provided
          if (!params.role || params.role.includes(membership.role)) {
            memberships.push(membership)
          }
        }
      }

      return {
        data: memberships.slice(params.offset ?? 0, (params.offset ?? 0) + (params.limit ?? 10)),
        total_count: memberships.length,
      }
    },

    /**
     * Create organization membership
     */
    createOrganizationMembership: async (params: {
      organizationId: string
      userId: string
      role: string
    }): Promise<ClerkOrganizationMembership> => {
      const org = await this.organizations.getOrganization(params.organizationId)
      const user = await this.userManager.getUser(params.userId)

      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }

      const membershipId = this.generateId('mem')
      const now = Date.now()

      const membership: ClerkOrganizationMembership = {
        id: membershipId,
        object: 'organization_membership',
        public_metadata: {},
        private_metadata: {},
        role: params.role,
        created_at: now,
        updated_at: now,
        organization: org,
        public_user_data: {
          user_id: params.userId,
          first_name: user.first_name ?? null,
          last_name: user.last_name ?? null,
          image_url: user.picture ?? '',
          has_image: !!user.picture,
          identifier: user.email ?? user.username ?? params.userId,
        },
      }

      await this.membershipStore.put(`membership:${membershipId}`, membership, now)
      await this.addUserToOrg(params.userId, params.organizationId, membershipId)

      // Update member count
      org.members_count++
      org.updated_at = now
      await this.organizationStore.put(`org:${params.organizationId}`, org, now)

      return membership
    },

    /**
     * Update organization membership
     */
    updateOrganizationMembership: async (params: {
      organizationId: string
      userId: string
      role: string
    }): Promise<ClerkOrganizationMembership> => {
      const membershipIds = (await this.orgMemberStore.get(`org_members:${params.organizationId}`)) ?? []

      for (const membershipId of membershipIds) {
        const membership = await this.membershipStore.get(`membership:${membershipId}`)
        if (membership && membership.public_user_data.user_id === params.userId) {
          membership.role = params.role
          membership.updated_at = Date.now()
          await this.membershipStore.put(`membership:${membershipId}`, membership, Date.now())
          return membership
        }
      }

      throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Membership not found' }])
    },

    /**
     * Delete organization membership
     */
    deleteOrganizationMembership: async (params: {
      organizationId: string
      userId: string
    }): Promise<ClerkDeletedObject> => {
      const membershipIds = (await this.orgMemberStore.get(`org_members:${params.organizationId}`)) ?? []

      for (const membershipId of membershipIds) {
        const membership = await this.membershipStore.get(`membership:${membershipId}`)
        if (membership && membership.public_user_data.user_id === params.userId) {
          await this.membershipStore.put(`membership:${membershipId}`, null as unknown as ClerkOrganizationMembership, Date.now())
          await this.removeUserFromOrg(params.userId, params.organizationId, membershipId)

          return {
            id: membershipId,
            object: 'organization_membership',
            deleted: true,
          }
        }
      }

      throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Membership not found' }])
    },

    /**
     * Create organization invitation
     */
    createOrganizationInvitation: async (
      organizationId: string,
      params: CreateInvitationParams
    ): Promise<ClerkOrganizationInvitation> => {
      const invitationId = this.generateId('inv')
      const now = Date.now()

      const invitation: ClerkOrganizationInvitation = {
        id: invitationId,
        object: 'organization_invitation',
        email_address: params.email_address,
        role: params.role,
        organization_id: organizationId,
        status: 'pending',
        public_metadata: params.public_metadata ?? {},
        private_metadata: params.private_metadata ?? {},
        created_at: now,
        updated_at: now,
      }

      await this.invitationStore.put(`invitation:${invitationId}`, invitation, now)

      // Update pending invitations count
      const org = await this.organizations.getOrganization(organizationId)
      org.pending_invitations_count++
      org.updated_at = now
      await this.organizationStore.put(`org:${organizationId}`, org, now)

      return invitation
    },

    /**
     * Get organization invitation list
     */
    getOrganizationInvitationList: async (params: {
      organizationId: string
      limit?: number
      offset?: number
      status?: string
    }): Promise<ClerkPaginatedList<ClerkOrganizationInvitation>> => {
      // Simplified - would need proper listing in production
      return { data: [], total_count: 0 }
    },

    /**
     * Revoke organization invitation
     */
    revokeOrganizationInvitation: async (params: {
      organizationId: string
      invitationId: string
    }): Promise<ClerkOrganizationInvitation> => {
      const invitation = await this.invitationStore.get(`invitation:${params.invitationId}`)
      if (!invitation || invitation.organization_id !== params.organizationId) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'Invitation not found' }])
      }

      invitation.status = 'revoked'
      invitation.updated_at = Date.now()
      await this.invitationStore.put(`invitation:${params.invitationId}`, invitation, Date.now())

      // Update pending invitations count
      const org = await this.organizations.getOrganization(params.organizationId)
      org.pending_invitations_count = Math.max(0, org.pending_invitations_count - 1)
      await this.organizationStore.put(`org:${params.organizationId}`, org, Date.now())

      return invitation
    },
  }

  // ============================================================================
  // JWT TEMPLATES API
  // ============================================================================

  /**
   * jwtTemplates namespace
   */
  jwtTemplates = {
    /**
     * Get a JWT template
     */
    getJWTTemplate: async (templateId: string): Promise<ClerkJWTTemplate> => {
      const template = await this.jwtTemplateStore.get(`jwt_template:${templateId}`)
      if (!template) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'JWT template not found' }])
      }
      return template
    },

    /**
     * Get JWT template list
     */
    getJWTTemplateList: async (): Promise<ClerkPaginatedList<ClerkJWTTemplate>> => {
      // Simplified - would need proper listing in production
      return { data: [], total_count: 0 }
    },

    /**
     * Create a JWT template
     */
    createJWTTemplate: async (params: CreateJWTTemplateParams): Promise<ClerkJWTTemplate> => {
      const templateId = this.generateId('jwt')
      const now = Date.now()

      const template: ClerkJWTTemplate = {
        id: templateId,
        object: 'jwt_template',
        name: params.name,
        claims: params.claims,
        lifetime: params.lifetime ?? 60,
        allowed_clock_skew: params.allowed_clock_skew ?? 5,
        custom_signing_key: params.custom_signing_key ?? false,
        signing_algorithm: params.signing_algorithm ?? 'RS256',
        created_at: now,
        updated_at: now,
      }

      await this.jwtTemplateStore.put(`jwt_template:${templateId}`, template, now)

      // Also index by name
      await this.jwtTemplateStore.put(`jwt_template_name:${params.name}`, template, now)

      return template
    },

    /**
     * Update a JWT template
     */
    updateJWTTemplate: async (
      templateId: string,
      params: Partial<CreateJWTTemplateParams>
    ): Promise<ClerkJWTTemplate> => {
      const existing = await this.jwtTemplates.getJWTTemplate(templateId)
      const now = Date.now()

      const template: ClerkJWTTemplate = {
        ...existing,
        name: params.name ?? existing.name,
        claims: params.claims ?? existing.claims,
        lifetime: params.lifetime ?? existing.lifetime,
        allowed_clock_skew: params.allowed_clock_skew ?? existing.allowed_clock_skew,
        custom_signing_key: params.custom_signing_key ?? existing.custom_signing_key,
        signing_algorithm: params.signing_algorithm ?? existing.signing_algorithm,
        updated_at: now,
      }

      await this.jwtTemplateStore.put(`jwt_template:${templateId}`, template, now)

      return template
    },

    /**
     * Delete a JWT template
     */
    deleteJWTTemplate: async (templateId: string): Promise<ClerkDeletedObject> => {
      const template = await this.jwtTemplateStore.get(`jwt_template:${templateId}`)
      if (template) {
        await this.jwtTemplateStore.put(`jwt_template_name:${template.name}`, null as unknown as ClerkJWTTemplate, Date.now())
      }
      await this.jwtTemplateStore.put(`jwt_template:${templateId}`, null as unknown as ClerkJWTTemplate, Date.now())

      return {
        id: templateId,
        object: 'jwt_template',
        deleted: true,
      }
    },
  }

  // ============================================================================
  // TOKEN VERIFICATION
  // ============================================================================

  /**
   * Verify a session token
   */
  async verifyToken(
    token: string,
    options?: { authorizedParties?: string[] }
  ): Promise<{ userId: string; sessionId: string; claims: Record<string, unknown> }> {
    const result = await verifyJWT(token, {
      secret: this.options.jwtKey ?? this.options.secretKey,
      issuer: 'https://clerk.com',
    })

    if (!result.valid || !result.claims) {
      throw new ClerkAPIError(401, [{ code: 'session_token_invalid', message: 'Invalid session token' }])
    }

    // Verify authorized parties if provided
    if (options?.authorizedParties && result.claims.azp) {
      if (!options.authorizedParties.includes(result.claims.azp as string)) {
        throw new ClerkAPIError(401, [{ code: 'session_token_invalid', message: 'Unauthorized party' }])
      }
    }

    return {
      userId: result.claims.sub as string,
      sessionId: result.claims.sid as string,
      claims: result.claims,
    }
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  /**
   * Convert internal user to Clerk user format
   */
  private toClerkUser(user: {
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
    metadata: Record<string, unknown>
    app_metadata: Record<string, unknown>
  }): ClerkUser {
    const createdAtTs = (user.app_metadata?.custom_created_at as number) ?? new Date(user.created_at).getTime()
    const updatedAtTs = new Date(user.updated_at).getTime()

    // Build email addresses array (primary + additional)
    const emailAddresses: ClerkEmailAddress[] = []
    if (user.email) {
      emailAddresses.push({
        id: `email_${user.id}`,
        object: 'email_address',
        email_address: user.email,
        reserved: false,
        verification: user.email_verified
          ? { status: 'verified', strategy: 'email_code', attempts: null, expire_at: null }
          : null,
        linked_to: [],
        created_at: createdAtTs,
        updated_at: updatedAtTs,
      })
    }
    // Add additional email addresses from app_metadata
    const additionalEmails = (user.app_metadata?.additional_email_addresses as string[]) ?? []
    additionalEmails.forEach((email, idx) => {
      emailAddresses.push({
        id: `email_${user.id}_${idx + 1}`,
        object: 'email_address',
        email_address: email,
        reserved: false,
        verification: null,
        linked_to: [],
        created_at: createdAtTs,
        updated_at: updatedAtTs,
      })
    })

    // Build phone numbers array (primary + additional)
    const phoneNumbers: ClerkPhoneNumber[] = []
    if (user.phone) {
      phoneNumbers.push({
        id: `phone_${user.id}`,
        object: 'phone_number',
        phone_number: user.phone,
        reserved_for_second_factor: false,
        default_second_factor: false,
        reserved: false,
        verification: user.phone_verified
          ? { status: 'verified', strategy: 'phone_code', attempts: null, expire_at: null }
          : null,
        linked_to: [],
        created_at: createdAtTs,
        updated_at: updatedAtTs,
      })
    }
    // Add additional phone numbers from app_metadata
    const additionalPhones = (user.app_metadata?.additional_phone_numbers as string[]) ?? []
    additionalPhones.forEach((phone, idx) => {
      phoneNumbers.push({
        id: `phone_${user.id}_${idx + 1}`,
        object: 'phone_number',
        phone_number: phone,
        reserved_for_second_factor: false,
        default_second_factor: false,
        reserved: false,
        verification: null,
        linked_to: [],
        created_at: createdAtTs,
        updated_at: updatedAtTs,
      })
    })

    // Build web3 wallets array from app_metadata
    const web3WalletsData = (user.app_metadata?.web3_wallets as string[]) ?? []
    const web3Wallets = web3WalletsData.map((wallet, idx) => ({
      id: `web3_${user.id}_${idx}`,
      object: 'web3_wallet' as const,
      web3_wallet: wallet,
      verification: null,
      created_at: createdAtTs,
      updated_at: updatedAtTs,
    }))

    // Build external accounts array from app_metadata
    const externalAccountsData = (user.app_metadata?.external_accounts as Array<{
      id: string
      provider: string
      provider_user_id: string
      email_address: string
      first_name: string | null
      last_name: string | null
      image_url: string | null
      username: string | null
    }>) ?? []

    const externalAccounts = externalAccountsData.map((acc) => ({
      id: acc.id,
      object: 'external_account' as const,
      provider: acc.provider,
      identification_id: `idn_${acc.id}`,
      provider_user_id: acc.provider_user_id,
      approved_scopes: '',
      email_address: acc.email_address,
      first_name: acc.first_name,
      last_name: acc.last_name,
      image_url: acc.image_url,
      username: acc.username,
      public_metadata: {},
      label: null,
      created_at: createdAtTs,
      updated_at: updatedAtTs,
      verification: { status: 'verified' as const, strategy: acc.provider, attempts: null, expire_at: null },
    }))

    // Extract flags from app_metadata
    const passwordEnabled = (user.app_metadata?.password_enabled as boolean) ?? true
    const totpEnabled = (user.app_metadata?.totp_enabled as boolean) ?? false
    const backupCodeEnabled = (user.app_metadata?.backup_code_enabled as boolean) ?? false
    const twoFactorEnabled = (user.app_metadata?.two_factor_enabled as boolean) ?? (totpEnabled || backupCodeEnabled)
    const deleteSelfEnabled = (user.app_metadata?.delete_self_enabled as boolean) ?? true
    const createOrganizationEnabled = (user.app_metadata?.create_organization_enabled as boolean) ?? true

    // Get primary IDs, allowing overrides from app_metadata
    const primaryEmailId = (user.app_metadata?.primary_email_address_id as string) ?? emailAddresses[0]?.id ?? null
    const primaryPhoneId = (user.app_metadata?.primary_phone_number_id as string) ?? phoneNumbers[0]?.id ?? null
    const primaryWeb3Id = (user.app_metadata?.primary_web3_wallet_id as string) ?? web3Wallets[0]?.id ?? null

    return {
      id: user.id,
      object: 'user',
      username: user.username ?? null,
      first_name: user.first_name ?? null,
      last_name: user.last_name ?? null,
      image_url: user.picture ?? '',
      has_image: !!user.picture,
      primary_email_address_id: primaryEmailId,
      primary_phone_number_id: primaryPhoneId,
      primary_web3_wallet_id: primaryWeb3Id,
      password_enabled: passwordEnabled,
      two_factor_enabled: twoFactorEnabled,
      totp_enabled: totpEnabled,
      backup_code_enabled: backupCodeEnabled,
      email_addresses: emailAddresses,
      phone_numbers: phoneNumbers,
      web3_wallets: web3Wallets,
      external_accounts: externalAccounts,
      saml_accounts: [],
      public_metadata: user.metadata ?? {},
      private_metadata: (user.app_metadata?.private_metadata as Record<string, unknown>) ?? {},
      unsafe_metadata: (user.app_metadata?.unsafe_metadata as Record<string, unknown>) ?? {},
      external_id: (user.app_metadata?.external_id as string) ?? null,
      last_sign_in_at: user.last_sign_in_at ? new Date(user.last_sign_in_at).getTime() : null,
      banned: (user.app_metadata?.banned as boolean) ?? false,
      locked: (user.app_metadata?.locked as boolean) ?? false,
      lockout_expires_in_seconds: null,
      verification_attempts_remaining: null,
      created_at: createdAtTs,
      updated_at: updatedAtTs,
      delete_self_enabled: deleteSelfEnabled,
      create_organization_enabled: createOrganizationEnabled,
      last_active_at: user.last_sign_in_at ? new Date(user.last_sign_in_at).getTime() : null,
    }
  }

  /**
   * Convert internal session to Clerk session format
   */
  private toClerkSession(session: {
    id: string
    user_id: string
    client_id?: string
    status: string
    created_at: string
    updated_at: string
    expires_at: string
    last_active_at: string
  }): ClerkSession {
    return {
      id: session.id,
      object: 'session',
      client_id: session.client_id ?? '',
      user_id: session.user_id,
      status: session.status as ClerkSession['status'],
      last_active_at: new Date(session.last_active_at).getTime(),
      last_active_organization_id: null,
      actor: null,
      expire_at: new Date(session.expires_at).getTime(),
      abandon_at: new Date(session.expires_at).getTime() + 86400000, // +1 day
      created_at: new Date(session.created_at).getTime(),
      updated_at: new Date(session.updated_at).getTime(),
    }
  }

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
   * Generate a secure token
   */
  private generateToken(): string {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  /**
   * Generate a 6-digit verification code
   */
  private generateVerificationCode(): string {
    const bytes = new Uint8Array(3)
    crypto.getRandomValues(bytes)
    const num = ((bytes[0]! << 16) | (bytes[1]! << 8) | bytes[2]!) % 1000000
    return num.toString().padStart(6, '0')
  }

  /**
   * Simple password hash for skip_password_checks
   */
  private async hashSimplePassword(password: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(password)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return `sha256:${hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')}`
  }

  /**
   * Generate a slug from a name
   */
  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  }

  /**
   * Add user to organization
   */
  private async addUserToOrg(userId: string, orgId: string, membershipId: string): Promise<void> {
    // Add org to user's list
    const userOrgs = (await this.userOrgStore.get(`user_orgs:${userId}`)) ?? []
    if (!userOrgs.includes(orgId)) {
      userOrgs.push(orgId)
      await this.userOrgStore.put(`user_orgs:${userId}`, userOrgs, Date.now())
    }

    // Add membership to org's list
    const orgMembers = (await this.orgMemberStore.get(`org_members:${orgId}`)) ?? []
    if (!orgMembers.includes(membershipId)) {
      orgMembers.push(membershipId)
      await this.orgMemberStore.put(`org_members:${orgId}`, orgMembers, Date.now())
    }
  }

  /**
   * Remove user from organization
   */
  private async removeUserFromOrg(userId: string, orgId: string, membershipId: string): Promise<void> {
    // Remove org from user's list
    const userOrgs = (await this.userOrgStore.get(`user_orgs:${userId}`)) ?? []
    const orgIndex = userOrgs.indexOf(orgId)
    if (orgIndex !== -1) {
      userOrgs.splice(orgIndex, 1)
      await this.userOrgStore.put(`user_orgs:${userId}`, userOrgs, Date.now())
    }

    // Remove membership from org's list
    const orgMembers = (await this.orgMemberStore.get(`org_members:${orgId}`)) ?? []
    const memberIndex = orgMembers.indexOf(membershipId)
    if (memberIndex !== -1) {
      orgMembers.splice(memberIndex, 1)
      await this.orgMemberStore.put(`org_members:${orgId}`, orgMembers, Date.now())
    }
  }
}

/**
 * Create a Clerk client
 */
export function createClerkClient(options: ClerkClientOptions): Clerk {
  return new Clerk(options)
}
