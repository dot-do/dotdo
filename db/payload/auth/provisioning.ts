/**
 * User Provisioning Module
 *
 * This module handles automatic user provisioning on first login.
 * Creates Payload users from Better Auth user data.
 *
 * @module @dotdo/payload/auth/provisioning
 */

import type { BetterAuthUser, AuthBridgeConfig, PayloadUser } from './types'

// ============================================================================
// Types
// ============================================================================

/**
 * Identity types for provisioned users.
 */
export type IdentityType = 'human' | 'agent' | 'service'

/**
 * Provisioning options for creating a Payload user.
 */
export interface ProvisionUserOptions {
  /** Identity type for the user (default: 'human') */
  identityType?: IdentityType
  /** Organization ID to link the user to */
  organizationId?: string
  /** Role within the organization */
  organizationRole?: string
  /** Custom user mapper function */
  userMapper?: (user: BetterAuthUser) => Partial<PayloadUser>
}

/**
 * Database interface for user provisioning.
 */
export interface ProvisioningDatabase {
  /**
   * Check if a Payload user exists by Better Auth ID.
   */
  getUserByBetterAuthId(betterAuthId: string): Promise<PayloadUser | null>

  /**
   * Check if a Payload user exists by email.
   */
  getUserByEmail(email: string): Promise<PayloadUser | null>

  /**
   * Create a new Payload user.
   */
  createUser(user: CreateUserInput): Promise<PayloadUser>

  /**
   * Link user to organization with role.
   */
  linkUserToOrganization(userId: string, orgId: string, role: string): Promise<void>
}

/**
 * Input for creating a new Payload user.
 */
export interface CreateUserInput {
  /** Better Auth user ID (used as Payload user ID) */
  id: string
  /** User's email address */
  email: string
  /** User's display name */
  name?: string
  /** Collection the user belongs to */
  collection: string
  /** Identity type */
  identityType?: IdentityType
  /** Additional custom fields */
  [key: string]: unknown
}

/**
 * Result of provisioning attempt.
 */
export type ProvisioningResult =
  | {
      /** User was created or already existed */
      success: true
      /** The Payload user */
      user: PayloadUser
      /** Whether user was newly created */
      created: boolean
    }
  | {
      /** Provisioning failed */
      success: false
      /** Error type */
      error: 'duplicate_email' | 'database_error' | 'validation_error' | 'rollback_failed'
      /** Error message */
      message: string
    }

// ============================================================================
// Implementation
// ============================================================================

/**
 * Provision a Payload user from a Better Auth user.
 *
 * @param db - Database interface for queries
 * @param betterAuthUser - The Better Auth user to provision
 * @param config - Auth bridge configuration
 * @param options - Optional provisioning options
 * @returns ProvisioningResult indicating success/failure
 *
 * @example
 * ```typescript
 * const result = await provisionUser(db, betterAuthUser, config)
 * if (result.success) {
 *   console.log('User provisioned:', result.user.id)
 * } else {
 *   console.error('Provisioning failed:', result.error)
 * }
 * ```
 */
export async function provisionUser(
  db: ProvisioningDatabase,
  betterAuthUser: BetterAuthUser,
  config: AuthBridgeConfig,
  options?: ProvisionUserOptions,
): Promise<ProvisioningResult> {
  const collection = config.usersCollection ?? 'users'

  // Check if autoCreateUsers is disabled
  if (config.autoCreateUsers === false) {
    return {
      success: false,
      error: 'validation_error',
      message: 'Auto-create users is disabled',
    }
  }

  // Validate required fields
  if (!betterAuthUser.id || betterAuthUser.id.trim() === '') {
    return {
      success: false,
      error: 'validation_error',
      message: 'Better Auth user ID is required',
    }
  }

  if (!betterAuthUser.email || betterAuthUser.email.trim() === '') {
    return {
      success: false,
      error: 'validation_error',
      message: 'Email is required',
    }
  }

  // Check if user already exists by Better Auth ID
  const existingById = await db.getUserByBetterAuthId(betterAuthUser.id)
  if (existingById) {
    return {
      success: true,
      user: existingById,
      created: false,
    }
  }

  // Check if a user with the same email but different ID already exists
  // This prevents duplicate emails across different Better Auth accounts
  // Note: Only flag as duplicate if the existing user wasn't created through
  // the provisioning flow (i.e., doesn't have a BA-style ID prefix)
  // This handles the case where a user was manually created in Payload before BA integration
  const existingByEmail = await db.getUserByEmail(betterAuthUser.email)
  if (existingByEmail && existingByEmail.id !== betterAuthUser.id) {
    // External users (not provisioned through BA) won't have BA-style IDs
    const existingIsExternalUser = !existingByEmail.id.startsWith('ba-')
    if (existingIsExternalUser) {
      return {
        success: false,
        error: 'duplicate_email',
        message: `User with email ${betterAuthUser.email} already exists`,
      }
    }
  }

  // Build user data for creation
  const identityType = options?.identityType ?? 'human'
  let userData: CreateUserInput = {
    id: betterAuthUser.id,
    email: betterAuthUser.email,
    name: betterAuthUser.name,
    collection,
    identityType,
  }

  // Apply custom mapper if provided
  if (options?.userMapper) {
    const customFields = options.userMapper(betterAuthUser)
    userData = { ...userData, ...customFields }
  }

  let createdUser: PayloadUser

  try {
    // Create user in database
    createdUser = await db.createUser(userData)
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    // Handle duplicate key errors (race condition)
    if (
      errorMessage.includes('duplicate') ||
      errorMessage.includes('Duplicate')
    ) {
      return {
        success: false,
        error: 'duplicate_email',
        message: `User with email ${betterAuthUser.email} already exists`,
      }
    }

    return {
      success: false,
      error: 'database_error',
      message: errorMessage,
    }
  }

  // Link to organization if organizationId is provided
  if (options?.organizationId) {
    const orgRole = options.organizationRole ?? 'member'
    try {
      await db.linkUserToOrganization(createdUser.id, options.organizationId, orgRole)
    } catch (error: unknown) {
      // Organization link failed - this is a partial failure
      // We should report this as an error
      const errorMessage = error instanceof Error ? error.message : String(error)
      return {
        success: false,
        error: 'database_error',
        message: `Failed to link user to organization: ${errorMessage}`,
      }
    }
  }

  return {
    success: true,
    user: createdUser,
    created: true,
  }
}
