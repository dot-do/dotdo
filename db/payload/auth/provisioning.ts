/**
 * User Provisioning Module (Stub - RED Phase)
 *
 * This module will handle automatic user provisioning on first login.
 * Creates Payload users from Better Auth user data.
 *
 * TODO: Implement in GREEN phase (dotdo-b7zj)
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
// Stub Implementation (to be implemented in GREEN phase)
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
  _db: ProvisioningDatabase,
  _betterAuthUser: BetterAuthUser,
  _config: AuthBridgeConfig,
  _options?: ProvisionUserOptions,
): Promise<ProvisioningResult> {
  // TODO: Implement in GREEN phase
  throw new Error('Not implemented - see dotdo-b7zj for GREEN phase implementation')
}
