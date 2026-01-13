/**
 * @dotdo/clerk - Users API
 *
 * Clerk Users Backend API compatible implementation.
 * Provides user CRUD, search, metadata, verification,
 * password management, external accounts, and banning.
 *
 * @see https://clerk.com/docs/reference/backend-api/tag/Users
 * @module
 */

import { createTemporalStore, type TemporalStore } from '../../../db/primitives/temporal-store'
import type { UserManager } from '../shared/users'
import {
  ClerkAPIError,
  type ClerkUser,
  type ClerkEmailAddress,
  type ClerkPhoneNumber,
  type ClerkWeb3Wallet,
  type ClerkExternalAccount,
  type ClerkVerification,
  type ClerkPaginatedList,
  type ClerkDeletedObject,
  type CreateUserParams,
  type UpdateUserParams,
} from './types'

// ============================================================================
// TYPES
// ============================================================================

/**
 * User metadata types
 */
export interface UserMetadataParams {
  publicMetadata?: Record<string, unknown>
  privateMetadata?: Record<string, unknown>
  unsafeMetadata?: Record<string, unknown>
}

/**
 * User metadata result
 */
export interface UserMetadata {
  publicMetadata: Record<string, unknown>
  privateMetadata: Record<string, unknown>
  unsafeMetadata: Record<string, unknown>
}

/**
 * User filter parameters
 */
export interface FilterUsersParams {
  emailAddress?: string[]
  phoneNumber?: string[]
  web3Wallet?: string[]
  externalId?: string[]
  username?: string[]
}

/**
 * User list parameters
 */
export interface ListUsersParams {
  limit?: number
  offset?: number
  orderBy?: 'created_at' | 'updated_at' | 'last_sign_in_at' | '-created_at' | '-updated_at' | '-last_sign_in_at'
  query?: string
  emailAddress?: string[]
  phoneNumber?: string[]
  externalId?: string[]
  username?: string[]
  userId?: string[]
}

/**
 * Email verification parameters
 */
export interface CreateEmailVerificationParams {
  userId: string
  email: string
}

/**
 * Phone verification parameters
 */
export interface CreatePhoneVerificationParams {
  userId: string
  phone: string
}

/**
 * Password strength result
 */
export interface PasswordStrengthResult {
  strength: 'very_weak' | 'weak' | 'fair' | 'strong' | 'very_strong'
  score: number
  warnings: string[]
  suggestions: string[]
}

/**
 * Link external account parameters
 */
export interface LinkExternalAccountParams {
  provider: string
  token: string
  providerUserId?: string
  email?: string
  firstName?: string
  lastName?: string
  imageUrl?: string
  username?: string
}

/**
 * External account result
 */
export interface ExternalAccountResult extends ClerkExternalAccount {
  linked: boolean
}

// ============================================================================
// INTERNAL STORAGE TYPES
// ============================================================================

interface StoredUser {
  id: string
  username: string | null
  firstName: string | null
  lastName: string | null
  imageUrl: string
  hasImage: boolean
  primaryEmailAddressId: string | null
  primaryPhoneNumberId: string | null
  primaryWeb3WalletId: string | null
  passwordEnabled: boolean
  passwordHash?: string
  twoFactorEnabled: boolean
  totpEnabled: boolean
  backupCodeEnabled: boolean
  emailAddresses: StoredEmailAddress[]
  phoneNumbers: StoredPhoneNumber[]
  web3Wallets: StoredWeb3Wallet[]
  externalAccounts: StoredExternalAccount[]
  publicMetadata: Record<string, unknown>
  privateMetadata: Record<string, unknown>
  unsafeMetadata: Record<string, unknown>
  externalId: string | null
  lastSignInAt: number | null
  banned: boolean
  banReason?: string
  locked: boolean
  lockoutExpiresInSeconds: number | null
  verificationAttemptsRemaining: number | null
  createdAt: number
  updatedAt: number
  deleteSelfEnabled: boolean
  createOrganizationEnabled: boolean
  lastActiveAt: number | null
}

interface StoredEmailAddress {
  id: string
  emailAddress: string
  reserved: boolean
  verification: ClerkVerification | null
  linkedTo: { id: string; type: string }[]
  createdAt: number
  updatedAt: number
}

interface StoredPhoneNumber {
  id: string
  phoneNumber: string
  reservedForSecondFactor: boolean
  defaultSecondFactor: boolean
  reserved: boolean
  verification: ClerkVerification | null
  linkedTo: { id: string; type: string }[]
  createdAt: number
  updatedAt: number
}

interface StoredWeb3Wallet {
  id: string
  web3Wallet: string
  verification: ClerkVerification | null
  createdAt: number
  updatedAt: number
}

interface StoredExternalAccount {
  id: string
  provider: string
  identificationId: string
  providerUserId: string
  approvedScopes: string
  emailAddress: string
  firstName: string | null
  lastName: string | null
  imageUrl: string | null
  username: string | null
  publicMetadata: Record<string, unknown>
  label: string | null
  createdAt: number
  updatedAt: number
  verification: ClerkVerification | null
}

interface StoredVerification {
  id: string
  userId: string
  type: 'email' | 'phone'
  identifier: string
  code: string
  expiresAt: number
  attempts: number
  createdAt: number
}

// ============================================================================
// USERS API
// ============================================================================

/**
 * Users API manager
 */
export interface UsersAPI {
  // User CRUD
  createUser(params: CreateUserParams): Promise<ClerkUser>
  getUser(userId: string): Promise<ClerkUser>
  updateUser(userId: string, params: UpdateUserParams): Promise<ClerkUser>
  deleteUser(userId: string): Promise<ClerkDeletedObject>
  listUsers(params?: ListUsersParams): Promise<ClerkPaginatedList<ClerkUser>>

  // User Search & Filtering
  searchUsers(query: string): Promise<ClerkPaginatedList<ClerkUser>>
  getUserByEmail(email: string): Promise<ClerkUser | null>
  getUserByExternalId(externalId: string): Promise<ClerkUser | null>
  filterUsers(params: FilterUsersParams): Promise<ClerkPaginatedList<ClerkUser>>

  // User Metadata
  updateUserMetadata(userId: string, params: UserMetadataParams): Promise<ClerkUser>
  getUserMetadata(userId: string): Promise<UserMetadata>

  // User Verification
  createEmailVerification(userId: string, email: string): Promise<{ verificationId: string; code: string }>
  verifyEmail(userId: string, code: string): Promise<ClerkUser>
  createPhoneVerification(userId: string, phone: string): Promise<{ verificationId: string; code: string }>
  verifyPhone(userId: string, code: string): Promise<ClerkUser>

  // Password Management
  updatePassword(userId: string, newPassword: string): Promise<ClerkUser>
  resetPassword(userId: string): Promise<{ resetToken: string; expiresAt: number }>
  checkPasswordStrength(password: string): PasswordStrengthResult

  // External Accounts
  linkExternalAccount(userId: string, params: LinkExternalAccountParams): Promise<ExternalAccountResult>
  unlinkExternalAccount(userId: string, accountId: string): Promise<ClerkDeletedObject>
  listExternalAccounts(userId: string): Promise<ClerkPaginatedList<ClerkExternalAccount>>

  // User Banning
  banUser(userId: string, reason?: string): Promise<ClerkUser>
  unbanUser(userId: string): Promise<ClerkUser>
  isUserBanned(userId: string): Promise<{ banned: boolean; reason?: string }>
}

/**
 * Create Users API manager
 */
export function createUsersManager(options: {
  userManager?: UserManager
  minPasswordLength?: number
  passwordHashIterations?: number
}): UsersAPI {
  const { minPasswordLength = 8 } = options

  // Storage for users and related data
  const userStore = createTemporalStore<StoredUser>()
  const emailIndex = createTemporalStore<string>() // email -> user_id
  const phoneIndex = createTemporalStore<string>() // phone -> user_id
  const usernameIndex = createTemporalStore<string>() // username -> user_id
  const externalIdIndex = createTemporalStore<string>() // external_id -> user_id
  const web3Index = createTemporalStore<string>() // web3_wallet -> user_id
  const verificationStore = createTemporalStore<StoredVerification>()
  const resetTokenStore = createTemporalStore<{ userId: string; expiresAt: number }>()

  // Helper functions
  const generateId = (prefix: string): string => {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    return `${prefix}_${hex}`
  }

  const generateCode = (): string => {
    const bytes = new Uint8Array(3)
    crypto.getRandomValues(bytes)
    const num = ((bytes[0]! << 16) | (bytes[1]! << 8) | bytes[2]!) % 1000000
    return num.toString().padStart(6, '0')
  }

  const generateToken = (): string => {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  const hashPassword = async (password: string): Promise<string> => {
    const encoder = new TextEncoder()
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const iterations = options.passwordHashIterations ?? 100000

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

    const saltHex = Array.from(salt)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    const hashHex = Array.from(new Uint8Array(derivedBits))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    return `pbkdf2:${iterations}:${saltHex}:${hashHex}`
  }

  const toPublicUser = (stored: StoredUser): ClerkUser => {
    return {
      id: stored.id,
      object: 'user',
      username: stored.username,
      first_name: stored.firstName,
      last_name: stored.lastName,
      image_url: stored.imageUrl,
      has_image: stored.hasImage,
      primary_email_address_id: stored.primaryEmailAddressId,
      primary_phone_number_id: stored.primaryPhoneNumberId,
      primary_web3_wallet_id: stored.primaryWeb3WalletId,
      password_enabled: stored.passwordEnabled,
      two_factor_enabled: stored.twoFactorEnabled,
      totp_enabled: stored.totpEnabled,
      backup_code_enabled: stored.backupCodeEnabled,
      email_addresses: stored.emailAddresses.map((e) => ({
        id: e.id,
        object: 'email_address' as const,
        email_address: e.emailAddress,
        reserved: e.reserved,
        verification: e.verification,
        linked_to: e.linkedTo,
        created_at: e.createdAt,
        updated_at: e.updatedAt,
      })),
      phone_numbers: stored.phoneNumbers.map((p) => ({
        id: p.id,
        object: 'phone_number' as const,
        phone_number: p.phoneNumber,
        reserved_for_second_factor: p.reservedForSecondFactor,
        default_second_factor: p.defaultSecondFactor,
        reserved: p.reserved,
        verification: p.verification,
        linked_to: p.linkedTo,
        created_at: p.createdAt,
        updated_at: p.updatedAt,
      })),
      web3_wallets: stored.web3Wallets.map((w) => ({
        id: w.id,
        object: 'web3_wallet' as const,
        web3_wallet: w.web3Wallet,
        verification: w.verification,
        created_at: w.createdAt,
        updated_at: w.updatedAt,
      })),
      external_accounts: stored.externalAccounts.map((e) => ({
        id: e.id,
        object: 'external_account' as const,
        provider: e.provider,
        identification_id: e.identificationId,
        provider_user_id: e.providerUserId,
        approved_scopes: e.approvedScopes,
        email_address: e.emailAddress,
        first_name: e.firstName,
        last_name: e.lastName,
        image_url: e.imageUrl,
        username: e.username,
        public_metadata: e.publicMetadata,
        label: e.label,
        created_at: e.createdAt,
        updated_at: e.updatedAt,
        verification: e.verification,
      })),
      saml_accounts: [],
      public_metadata: stored.publicMetadata,
      private_metadata: stored.privateMetadata,
      unsafe_metadata: stored.unsafeMetadata,
      external_id: stored.externalId,
      last_sign_in_at: stored.lastSignInAt,
      banned: stored.banned,
      locked: stored.locked,
      lockout_expires_in_seconds: stored.lockoutExpiresInSeconds,
      verification_attempts_remaining: stored.verificationAttemptsRemaining,
      created_at: stored.createdAt,
      updated_at: stored.updatedAt,
      delete_self_enabled: stored.deleteSelfEnabled,
      create_organization_enabled: stored.createOrganizationEnabled,
      last_active_at: stored.lastActiveAt,
    }
  }

  return {
    // ═══════════════════════════════════════════════════════════════════════════
    // USER CRUD
    // ═══════════════════════════════════════════════════════════════════════════

    async createUser(params: CreateUserParams): Promise<ClerkUser> {
      const now = Date.now()
      const userId = generateId('user')

      // Validate and check uniqueness for email addresses
      const emailAddresses: StoredEmailAddress[] = []
      if (params.email_address) {
        for (const email of params.email_address) {
          const existingId = await emailIndex.get(`email:${email.toLowerCase()}`)
          if (existingId) {
            throw new ClerkAPIError(422, [
              { code: 'form_identifier_exists', message: `Email address ${email} is already in use` },
            ])
          }

          const emailId = generateId('idn')
          emailAddresses.push({
            id: emailId,
            emailAddress: email,
            reserved: false,
            verification: null,
            linkedTo: [],
            createdAt: now,
            updatedAt: now,
          })

          await emailIndex.put(`email:${email.toLowerCase()}`, userId, now)
        }
      }

      // Validate and check uniqueness for phone numbers
      const phoneNumbers: StoredPhoneNumber[] = []
      if (params.phone_number) {
        for (const phone of params.phone_number) {
          const existingId = await phoneIndex.get(`phone:${phone}`)
          if (existingId) {
            throw new ClerkAPIError(422, [
              { code: 'form_identifier_exists', message: `Phone number ${phone} is already in use` },
            ])
          }

          const phoneId = generateId('idn')
          phoneNumbers.push({
            id: phoneId,
            phoneNumber: phone,
            reservedForSecondFactor: false,
            defaultSecondFactor: false,
            reserved: false,
            verification: null,
            linkedTo: [],
            createdAt: now,
            updatedAt: now,
          })

          await phoneIndex.put(`phone:${phone}`, userId, now)
        }
      }

      // Validate and check uniqueness for web3 wallets
      const web3Wallets: StoredWeb3Wallet[] = []
      if (params.web3_wallet) {
        for (const wallet of params.web3_wallet) {
          const existingId = await web3Index.get(`web3:${wallet.toLowerCase()}`)
          if (existingId) {
            throw new ClerkAPIError(422, [
              { code: 'form_identifier_exists', message: `Web3 wallet ${wallet} is already in use` },
            ])
          }

          const walletId = generateId('idn')
          web3Wallets.push({
            id: walletId,
            web3Wallet: wallet,
            verification: null,
            createdAt: now,
            updatedAt: now,
          })

          await web3Index.put(`web3:${wallet.toLowerCase()}`, userId, now)
        }
      }

      // Validate username uniqueness
      if (params.username) {
        const existingId = await usernameIndex.get(`username:${params.username.toLowerCase()}`)
        if (existingId) {
          throw new ClerkAPIError(422, [
            { code: 'form_identifier_exists', message: `Username ${params.username} is already in use` },
          ])
        }
        await usernameIndex.put(`username:${params.username.toLowerCase()}`, userId, now)
      }

      // Validate external ID uniqueness
      if (params.external_id) {
        const existingId = await externalIdIndex.get(`external:${params.external_id}`)
        if (existingId) {
          throw new ClerkAPIError(422, [
            { code: 'form_identifier_exists', message: `External ID ${params.external_id} is already in use` },
          ])
        }
        await externalIdIndex.put(`external:${params.external_id}`, userId, now)
      }

      // Validate password
      let passwordHash: string | undefined
      if (params.password) {
        if (!params.skip_password_checks && params.password.length < minPasswordLength) {
          throw new ClerkAPIError(422, [
            { code: 'form_password_pwned', message: `Password must be at least ${minPasswordLength} characters` },
          ])
        }
        passwordHash = await hashPassword(params.password)
      } else if (params.password_digest) {
        // Use pre-hashed password
        passwordHash = params.password_digest
      }

      const storedUser: StoredUser = {
        id: userId,
        username: params.username ?? null,
        firstName: params.first_name ?? null,
        lastName: params.last_name ?? null,
        imageUrl: '',
        hasImage: false,
        primaryEmailAddressId: emailAddresses[0]?.id ?? null,
        primaryPhoneNumberId: phoneNumbers[0]?.id ?? null,
        primaryWeb3WalletId: web3Wallets[0]?.id ?? null,
        passwordEnabled: !!passwordHash,
        passwordHash,
        twoFactorEnabled: false,
        totpEnabled: !!params.totp_secret,
        backupCodeEnabled: !!params.backup_codes?.length,
        emailAddresses,
        phoneNumbers,
        web3Wallets,
        externalAccounts: [],
        publicMetadata: params.public_metadata ?? {},
        privateMetadata: params.private_metadata ?? {},
        unsafeMetadata: params.unsafe_metadata ?? {},
        externalId: params.external_id ?? null,
        lastSignInAt: null,
        banned: false,
        locked: false,
        lockoutExpiresInSeconds: null,
        verificationAttemptsRemaining: null,
        createdAt: params.created_at ? new Date(params.created_at).getTime() : now,
        updatedAt: now,
        deleteSelfEnabled: params.delete_self_enabled ?? true,
        createOrganizationEnabled: params.create_organization_enabled ?? true,
        lastActiveAt: null,
      }

      await userStore.put(`user:${userId}`, storedUser, now)

      return toPublicUser(storedUser)
    },

    async getUser(userId: string): Promise<ClerkUser> {
      const user = await userStore.get(`user:${userId}`)
      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }
      return toPublicUser(user)
    },

    async updateUser(userId: string, params: UpdateUserParams): Promise<ClerkUser> {
      const user = await userStore.get(`user:${userId}`)
      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }

      const now = Date.now()

      // Update username if changed
      if (params.username !== undefined && params.username !== user.username) {
        if (params.username) {
          const existingId = await usernameIndex.get(`username:${params.username.toLowerCase()}`)
          if (existingId && existingId !== userId) {
            throw new ClerkAPIError(422, [
              { code: 'form_identifier_exists', message: `Username ${params.username} is already in use` },
            ])
          }
          await usernameIndex.put(`username:${params.username.toLowerCase()}`, userId, now)
        }
        if (user.username) {
          await usernameIndex.put(`username:${user.username.toLowerCase()}`, null as unknown as string, now)
        }
        user.username = params.username ?? null
      }

      // Update external ID if changed
      if (params.external_id !== undefined && params.external_id !== user.externalId) {
        if (params.external_id) {
          const existingId = await externalIdIndex.get(`external:${params.external_id}`)
          if (existingId && existingId !== userId) {
            throw new ClerkAPIError(422, [
              { code: 'form_identifier_exists', message: `External ID ${params.external_id} is already in use` },
            ])
          }
          await externalIdIndex.put(`external:${params.external_id}`, userId, now)
        }
        if (user.externalId) {
          await externalIdIndex.put(`external:${user.externalId}`, null as unknown as string, now)
        }
        user.externalId = params.external_id ?? null
      }

      // Update password if provided
      if (params.password) {
        if (!params.skip_password_checks && params.password.length < minPasswordLength) {
          throw new ClerkAPIError(422, [
            { code: 'form_password_pwned', message: `Password must be at least ${minPasswordLength} characters` },
          ])
        }
        user.passwordHash = await hashPassword(params.password)
        user.passwordEnabled = true
      } else if (params.password_digest) {
        user.passwordHash = params.password_digest
        user.passwordEnabled = true
      }

      // Update primary IDs
      if (params.primary_email_address_id !== undefined) {
        const emailExists = user.emailAddresses.some((e) => e.id === params.primary_email_address_id)
        if (!emailExists && params.primary_email_address_id !== null) {
          throw new ClerkAPIError(422, [{ code: 'resource_not_found', message: 'Email address not found' }])
        }
        user.primaryEmailAddressId = params.primary_email_address_id ?? null
      }

      if (params.primary_phone_number_id !== undefined) {
        const phoneExists = user.phoneNumbers.some((p) => p.id === params.primary_phone_number_id)
        if (!phoneExists && params.primary_phone_number_id !== null) {
          throw new ClerkAPIError(422, [{ code: 'resource_not_found', message: 'Phone number not found' }])
        }
        user.primaryPhoneNumberId = params.primary_phone_number_id ?? null
      }

      if (params.primary_web3_wallet_id !== undefined) {
        const walletExists = user.web3Wallets.some((w) => w.id === params.primary_web3_wallet_id)
        if (!walletExists && params.primary_web3_wallet_id !== null) {
          throw new ClerkAPIError(422, [{ code: 'resource_not_found', message: 'Web3 wallet not found' }])
        }
        user.primaryWeb3WalletId = params.primary_web3_wallet_id ?? null
      }

      // Update basic fields
      if (params.first_name !== undefined) user.firstName = params.first_name ?? null
      if (params.last_name !== undefined) user.lastName = params.last_name ?? null
      if (params.public_metadata !== undefined) {
        user.publicMetadata = { ...user.publicMetadata, ...params.public_metadata }
      }
      if (params.private_metadata !== undefined) {
        user.privateMetadata = { ...user.privateMetadata, ...params.private_metadata }
      }
      if (params.unsafe_metadata !== undefined) {
        user.unsafeMetadata = { ...user.unsafeMetadata, ...params.unsafe_metadata }
      }
      if (params.delete_self_enabled !== undefined) user.deleteSelfEnabled = params.delete_self_enabled
      if (params.create_organization_enabled !== undefined) {
        user.createOrganizationEnabled = params.create_organization_enabled
      }

      // Update TOTP/backup codes
      if (params.totp_secret !== undefined) user.totpEnabled = !!params.totp_secret
      if (params.backup_codes !== undefined) user.backupCodeEnabled = params.backup_codes.length > 0

      user.updatedAt = now
      await userStore.put(`user:${userId}`, user, now)

      return toPublicUser(user)
    },

    async deleteUser(userId: string): Promise<ClerkDeletedObject> {
      const user = await userStore.get(`user:${userId}`)
      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }

      const now = Date.now()

      // Remove from indexes
      for (const email of user.emailAddresses) {
        await emailIndex.put(`email:${email.emailAddress.toLowerCase()}`, null as unknown as string, now)
      }
      for (const phone of user.phoneNumbers) {
        await phoneIndex.put(`phone:${phone.phoneNumber}`, null as unknown as string, now)
      }
      for (const wallet of user.web3Wallets) {
        await web3Index.put(`web3:${wallet.web3Wallet.toLowerCase()}`, null as unknown as string, now)
      }
      if (user.username) {
        await usernameIndex.put(`username:${user.username.toLowerCase()}`, null as unknown as string, now)
      }
      if (user.externalId) {
        await externalIdIndex.put(`external:${user.externalId}`, null as unknown as string, now)
      }

      // Delete user
      await userStore.put(`user:${userId}`, null as unknown as StoredUser, now)

      return {
        id: userId,
        object: 'user',
        deleted: true,
      }
    },

    async listUsers(params?: ListUsersParams): Promise<ClerkPaginatedList<ClerkUser>> {
      const users: ClerkUser[] = []

      // If specific user IDs are provided, fetch them
      if (params?.userId) {
        for (const id of params.userId) {
          const user = await userStore.get(`user:${id}`)
          if (user) {
            users.push(toPublicUser(user))
          }
        }
      }

      // If email addresses are provided, fetch by email
      if (params?.emailAddress) {
        for (const email of params.emailAddress) {
          const userId = await emailIndex.get(`email:${email.toLowerCase()}`)
          if (userId && !users.find((u) => u.id === userId)) {
            const user = await userStore.get(`user:${userId}`)
            if (user) {
              users.push(toPublicUser(user))
            }
          }
        }
      }

      // If phone numbers are provided, fetch by phone
      if (params?.phoneNumber) {
        for (const phone of params.phoneNumber) {
          const userId = await phoneIndex.get(`phone:${phone}`)
          if (userId && !users.find((u) => u.id === userId)) {
            const user = await userStore.get(`user:${userId}`)
            if (user) {
              users.push(toPublicUser(user))
            }
          }
        }
      }

      // If usernames are provided, fetch by username
      if (params?.username) {
        for (const username of params.username) {
          const userId = await usernameIndex.get(`username:${username.toLowerCase()}`)
          if (userId && !users.find((u) => u.id === userId)) {
            const user = await userStore.get(`user:${userId}`)
            if (user) {
              users.push(toPublicUser(user))
            }
          }
        }
      }

      // If external IDs are provided, fetch by external ID
      if (params?.externalId) {
        for (const externalId of params.externalId) {
          const userId = await externalIdIndex.get(`external:${externalId}`)
          if (userId && !users.find((u) => u.id === userId)) {
            const user = await userStore.get(`user:${userId}`)
            if (user) {
              users.push(toPublicUser(user))
            }
          }
        }
      }

      // Apply sorting
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

    // ═══════════════════════════════════════════════════════════════════════════
    // USER SEARCH & FILTERING
    // ═══════════════════════════════════════════════════════════════════════════

    async searchUsers(query: string): Promise<ClerkPaginatedList<ClerkUser>> {
      // Full-text search implementation
      // Search across email, username, first_name, last_name
      const queryLower = query.toLowerCase()
      const matchingUsers: ClerkUser[] = []

      // This is a simplified implementation - in production you'd want
      // a proper full-text search index
      // For now, we search by email prefix as the primary search path
      const emailUserId = await emailIndex.get(`email:${queryLower}`)
      if (emailUserId) {
        const user = await userStore.get(`user:${emailUserId}`)
        if (user) {
          matchingUsers.push(toPublicUser(user))
        }
      }

      // Search by username
      const usernameUserId = await usernameIndex.get(`username:${queryLower}`)
      if (usernameUserId && !matchingUsers.find((u) => u.id === usernameUserId)) {
        const user = await userStore.get(`user:${usernameUserId}`)
        if (user) {
          matchingUsers.push(toPublicUser(user))
        }
      }

      return {
        data: matchingUsers,
        total_count: matchingUsers.length,
      }
    },

    async getUserByEmail(email: string): Promise<ClerkUser | null> {
      const userId = await emailIndex.get(`email:${email.toLowerCase()}`)
      if (!userId) return null

      const user = await userStore.get(`user:${userId}`)
      if (!user) return null

      return toPublicUser(user)
    },

    async getUserByExternalId(externalId: string): Promise<ClerkUser | null> {
      const userId = await externalIdIndex.get(`external:${externalId}`)
      if (!userId) return null

      const user = await userStore.get(`user:${userId}`)
      if (!user) return null

      return toPublicUser(user)
    },

    async filterUsers(params: FilterUsersParams): Promise<ClerkPaginatedList<ClerkUser>> {
      const users: ClerkUser[] = []
      const seenIds = new Set<string>()

      // Filter by email addresses
      if (params.emailAddress) {
        for (const email of params.emailAddress) {
          const userId = await emailIndex.get(`email:${email.toLowerCase()}`)
          if (userId && !seenIds.has(userId)) {
            const user = await userStore.get(`user:${userId}`)
            if (user) {
              users.push(toPublicUser(user))
              seenIds.add(userId)
            }
          }
        }
      }

      // Filter by phone numbers
      if (params.phoneNumber) {
        for (const phone of params.phoneNumber) {
          const userId = await phoneIndex.get(`phone:${phone}`)
          if (userId && !seenIds.has(userId)) {
            const user = await userStore.get(`user:${userId}`)
            if (user) {
              users.push(toPublicUser(user))
              seenIds.add(userId)
            }
          }
        }
      }

      // Filter by web3 wallets
      if (params.web3Wallet) {
        for (const wallet of params.web3Wallet) {
          const userId = await web3Index.get(`web3:${wallet.toLowerCase()}`)
          if (userId && !seenIds.has(userId)) {
            const user = await userStore.get(`user:${userId}`)
            if (user) {
              users.push(toPublicUser(user))
              seenIds.add(userId)
            }
          }
        }
      }

      // Filter by external IDs
      if (params.externalId) {
        for (const externalId of params.externalId) {
          const userId = await externalIdIndex.get(`external:${externalId}`)
          if (userId && !seenIds.has(userId)) {
            const user = await userStore.get(`user:${userId}`)
            if (user) {
              users.push(toPublicUser(user))
              seenIds.add(userId)
            }
          }
        }
      }

      // Filter by usernames
      if (params.username) {
        for (const username of params.username) {
          const userId = await usernameIndex.get(`username:${username.toLowerCase()}`)
          if (userId && !seenIds.has(userId)) {
            const user = await userStore.get(`user:${userId}`)
            if (user) {
              users.push(toPublicUser(user))
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

    // ═══════════════════════════════════════════════════════════════════════════
    // USER METADATA
    // ═══════════════════════════════════════════════════════════════════════════

    async updateUserMetadata(userId: string, params: UserMetadataParams): Promise<ClerkUser> {
      const user = await userStore.get(`user:${userId}`)
      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }

      const now = Date.now()

      if (params.publicMetadata !== undefined) {
        user.publicMetadata = params.publicMetadata
      }
      if (params.privateMetadata !== undefined) {
        user.privateMetadata = params.privateMetadata
      }
      if (params.unsafeMetadata !== undefined) {
        user.unsafeMetadata = params.unsafeMetadata
      }

      user.updatedAt = now
      await userStore.put(`user:${userId}`, user, now)

      return toPublicUser(user)
    },

    async getUserMetadata(userId: string): Promise<UserMetadata> {
      const user = await userStore.get(`user:${userId}`)
      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }

      return {
        publicMetadata: user.publicMetadata,
        privateMetadata: user.privateMetadata,
        unsafeMetadata: user.unsafeMetadata,
      }
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // USER VERIFICATION
    // ═══════════════════════════════════════════════════════════════════════════

    async createEmailVerification(userId: string, email: string): Promise<{ verificationId: string; code: string }> {
      const user = await userStore.get(`user:${userId}`)
      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }

      // Check if email belongs to user
      const emailAddress = user.emailAddresses.find((e) => e.emailAddress.toLowerCase() === email.toLowerCase())
      if (!emailAddress) {
        throw new ClerkAPIError(422, [{ code: 'resource_not_found', message: 'Email address not found for user' }])
      }

      const now = Date.now()
      const verificationId = generateId('ev')
      const code = generateCode()

      const verification: StoredVerification = {
        id: verificationId,
        userId,
        type: 'email',
        identifier: email.toLowerCase(),
        code,
        expiresAt: now + 10 * 60 * 1000, // 10 minutes
        attempts: 0,
        createdAt: now,
      }

      await verificationStore.put(`verification:${verificationId}`, verification, now)

      // In production, this would send an email with the code
      return { verificationId, code }
    },

    async verifyEmail(userId: string, code: string): Promise<ClerkUser> {
      const user = await userStore.get(`user:${userId}`)
      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }

      // Find matching verification by scanning (simplified implementation)
      // In production, you'd want an index by code
      let foundVerification: StoredVerification | null = null
      let foundKey: string | null = null

      // For simplicity, we iterate through email verifications for this user
      // In production, maintain a proper index
      for (const email of user.emailAddresses) {
        const iterator = verificationStore.range('verification:', {})
        let result = await iterator.next()
        while (!result.done) {
          const v = result.value as StoredVerification
          if (v.userId === userId && v.type === 'email' && v.code === code) {
            foundVerification = v
            foundKey = `verification:${v.id}`
            break
          }
          result = await iterator.next()
        }
        if (foundVerification) break
      }

      if (!foundVerification || !foundKey) {
        throw new ClerkAPIError(422, [{ code: 'verification_failed', message: 'Invalid verification code' }])
      }

      const now = Date.now()

      // Check expiration
      if (now > foundVerification.expiresAt) {
        throw new ClerkAPIError(422, [{ code: 'verification_expired', message: 'Verification code has expired' }])
      }

      // Update email address verification status
      const emailAddress = user.emailAddresses.find(
        (e) => e.emailAddress.toLowerCase() === foundVerification!.identifier
      )
      if (emailAddress) {
        emailAddress.verification = {
          status: 'verified',
          strategy: 'email_code',
          attempts: foundVerification.attempts + 1,
          expire_at: null,
        }
        emailAddress.updatedAt = now
      }

      // Delete used verification
      await verificationStore.put(foundKey, null as unknown as StoredVerification, now)

      user.updatedAt = now
      await userStore.put(`user:${userId}`, user, now)

      return toPublicUser(user)
    },

    async createPhoneVerification(userId: string, phone: string): Promise<{ verificationId: string; code: string }> {
      const user = await userStore.get(`user:${userId}`)
      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }

      // Check if phone belongs to user
      const phoneNumber = user.phoneNumbers.find((p) => p.phoneNumber === phone)
      if (!phoneNumber) {
        throw new ClerkAPIError(422, [{ code: 'resource_not_found', message: 'Phone number not found for user' }])
      }

      const now = Date.now()
      const verificationId = generateId('pv')
      const code = generateCode()

      const verification: StoredVerification = {
        id: verificationId,
        userId,
        type: 'phone',
        identifier: phone,
        code,
        expiresAt: now + 10 * 60 * 1000, // 10 minutes
        attempts: 0,
        createdAt: now,
      }

      await verificationStore.put(`verification:${verificationId}`, verification, now)

      // In production, this would send an SMS with the code
      return { verificationId, code }
    },

    async verifyPhone(userId: string, code: string): Promise<ClerkUser> {
      const user = await userStore.get(`user:${userId}`)
      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }

      // Find matching verification
      let foundVerification: StoredVerification | null = null
      let foundKey: string | null = null

      for (const phone of user.phoneNumbers) {
        const iterator = verificationStore.range('verification:', {})
        let result = await iterator.next()
        while (!result.done) {
          const v = result.value as StoredVerification
          if (v.userId === userId && v.type === 'phone' && v.code === code) {
            foundVerification = v
            foundKey = `verification:${v.id}`
            break
          }
          result = await iterator.next()
        }
        if (foundVerification) break
      }

      if (!foundVerification || !foundKey) {
        throw new ClerkAPIError(422, [{ code: 'verification_failed', message: 'Invalid verification code' }])
      }

      const now = Date.now()

      // Check expiration
      if (now > foundVerification.expiresAt) {
        throw new ClerkAPIError(422, [{ code: 'verification_expired', message: 'Verification code has expired' }])
      }

      // Update phone number verification status
      const phoneNumber = user.phoneNumbers.find((p) => p.phoneNumber === foundVerification!.identifier)
      if (phoneNumber) {
        phoneNumber.verification = {
          status: 'verified',
          strategy: 'phone_code',
          attempts: foundVerification.attempts + 1,
          expire_at: null,
        }
        phoneNumber.updatedAt = now
      }

      // Delete used verification
      await verificationStore.put(foundKey, null as unknown as StoredVerification, now)

      user.updatedAt = now
      await userStore.put(`user:${userId}`, user, now)

      return toPublicUser(user)
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // PASSWORD MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════

    async updatePassword(userId: string, newPassword: string): Promise<ClerkUser> {
      const user = await userStore.get(`user:${userId}`)
      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }

      // Validate password strength
      if (newPassword.length < minPasswordLength) {
        throw new ClerkAPIError(422, [
          { code: 'form_password_pwned', message: `Password must be at least ${minPasswordLength} characters` },
        ])
      }

      const now = Date.now()
      user.passwordHash = await hashPassword(newPassword)
      user.passwordEnabled = true
      user.updatedAt = now

      await userStore.put(`user:${userId}`, user, now)

      return toPublicUser(user)
    },

    async resetPassword(userId: string): Promise<{ resetToken: string; expiresAt: number }> {
      const user = await userStore.get(`user:${userId}`)
      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }

      const now = Date.now()
      const resetToken = generateToken()
      const expiresAt = now + 60 * 60 * 1000 // 1 hour

      await resetTokenStore.put(`reset:${resetToken}`, { userId, expiresAt }, now)

      // In production, this would send an email with the reset link
      return { resetToken, expiresAt }
    },

    checkPasswordStrength(password: string): PasswordStrengthResult {
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
      let strength: PasswordStrengthResult['strength']
      if (score <= 1) strength = 'very_weak'
      else if (score <= 2) strength = 'weak'
      else if (score <= 4) strength = 'fair'
      else if (score <= 6) strength = 'strong'
      else strength = 'very_strong'

      return { strength, score, warnings, suggestions }
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // EXTERNAL ACCOUNTS
    // ═══════════════════════════════════════════════════════════════════════════

    async linkExternalAccount(userId: string, params: LinkExternalAccountParams): Promise<ExternalAccountResult> {
      const user = await userStore.get(`user:${userId}`)
      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }

      // Check if this external account is already linked
      const existingAccount = user.externalAccounts.find(
        (a) => a.provider === params.provider && a.providerUserId === params.providerUserId
      )
      if (existingAccount) {
        throw new ClerkAPIError(422, [
          { code: 'external_account_exists', message: 'External account already linked' },
        ])
      }

      const now = Date.now()
      const accountId = generateId('eac')

      const externalAccount: StoredExternalAccount = {
        id: accountId,
        provider: params.provider,
        identificationId: generateId('idn'),
        providerUserId: params.providerUserId ?? generateId('puid'),
        approvedScopes: '',
        emailAddress: params.email ?? '',
        firstName: params.firstName ?? null,
        lastName: params.lastName ?? null,
        imageUrl: params.imageUrl ?? null,
        username: params.username ?? null,
        publicMetadata: {},
        label: null,
        createdAt: now,
        updatedAt: now,
        verification: {
          status: 'verified',
          strategy: params.provider,
          attempts: null,
          expire_at: null,
        },
      }

      user.externalAccounts.push(externalAccount)
      user.updatedAt = now

      await userStore.put(`user:${userId}`, user, now)

      return {
        id: externalAccount.id,
        object: 'external_account',
        provider: externalAccount.provider,
        identification_id: externalAccount.identificationId,
        provider_user_id: externalAccount.providerUserId,
        approved_scopes: externalAccount.approvedScopes,
        email_address: externalAccount.emailAddress,
        first_name: externalAccount.firstName,
        last_name: externalAccount.lastName,
        image_url: externalAccount.imageUrl,
        username: externalAccount.username,
        public_metadata: externalAccount.publicMetadata,
        label: externalAccount.label,
        created_at: externalAccount.createdAt,
        updated_at: externalAccount.updatedAt,
        verification: externalAccount.verification,
        linked: true,
      }
    },

    async unlinkExternalAccount(userId: string, accountId: string): Promise<ClerkDeletedObject> {
      const user = await userStore.get(`user:${userId}`)
      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }

      const accountIndex = user.externalAccounts.findIndex((a) => a.id === accountId)
      if (accountIndex === -1) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'External account not found' }])
      }

      const now = Date.now()
      user.externalAccounts.splice(accountIndex, 1)
      user.updatedAt = now

      await userStore.put(`user:${userId}`, user, now)

      return {
        id: accountId,
        object: 'external_account',
        deleted: true,
      }
    },

    async listExternalAccounts(userId: string): Promise<ClerkPaginatedList<ClerkExternalAccount>> {
      const user = await userStore.get(`user:${userId}`)
      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }

      const accounts: ClerkExternalAccount[] = user.externalAccounts.map((a) => ({
        id: a.id,
        object: 'external_account',
        provider: a.provider,
        identification_id: a.identificationId,
        provider_user_id: a.providerUserId,
        approved_scopes: a.approvedScopes,
        email_address: a.emailAddress,
        first_name: a.firstName,
        last_name: a.lastName,
        image_url: a.imageUrl,
        username: a.username,
        public_metadata: a.publicMetadata,
        label: a.label,
        created_at: a.createdAt,
        updated_at: a.updatedAt,
        verification: a.verification,
      }))

      return {
        data: accounts,
        total_count: accounts.length,
      }
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // USER BANNING
    // ═══════════════════════════════════════════════════════════════════════════

    async banUser(userId: string, reason?: string): Promise<ClerkUser> {
      const user = await userStore.get(`user:${userId}`)
      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }

      const now = Date.now()
      user.banned = true
      user.banReason = reason
      user.updatedAt = now

      await userStore.put(`user:${userId}`, user, now)

      return toPublicUser(user)
    },

    async unbanUser(userId: string): Promise<ClerkUser> {
      const user = await userStore.get(`user:${userId}`)
      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }

      const now = Date.now()
      user.banned = false
      user.banReason = undefined
      user.updatedAt = now

      await userStore.put(`user:${userId}`, user, now)

      return toPublicUser(user)
    },

    async isUserBanned(userId: string): Promise<{ banned: boolean; reason?: string }> {
      const user = await userStore.get(`user:${userId}`)
      if (!user) {
        throw new ClerkAPIError(404, [{ code: 'resource_not_found', message: 'User not found' }])
      }

      return {
        banned: user.banned,
        reason: user.banReason,
      }
    },
  }
}
