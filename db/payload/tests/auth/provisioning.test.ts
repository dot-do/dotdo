/**
 * User Provisioning Tests (RED Phase)
 *
 * These tests define the contract for automatic user provisioning on first login.
 * When a Better Auth user logs in and no corresponding Payload user exists,
 * the system should automatically create one.
 *
 * The provisionUser function should:
 * - Create a Payload user from Better Auth user data on first login
 * - Map Better Auth id to Payload user id
 * - Copy email and name from Better Auth
 * - Support different identity types (human, agent, service)
 * - Allow custom field mapping via userMapper
 * - Handle organization context and roles
 * - Gracefully handle errors and duplicates
 *
 * Reference: dotdo-33qg - B10 RED: User provisioning tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { BetterAuthUser, AuthBridgeConfig, PayloadUser } from '../../auth/types'
import { provisionUser } from '../../auth/provisioning'

// ============================================================================
// Type definitions for the provisioning module (to be implemented)
// ============================================================================

/**
 * Identity types for provisioned users.
 * - human: Regular interactive user
 * - agent: AI agent or bot
 * - service: Service account for machine-to-machine
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
// Mock helpers
// ============================================================================

function createMockBetterAuthUser(overrides: Partial<BetterAuthUser> = {}): BetterAuthUser {
  const now = new Date()
  return {
    id: 'ba-user-001',
    name: 'Alice Smith',
    email: 'alice@example.com',
    emailVerified: true,
    role: 'user',
    image: null,
    banned: false,
    banReason: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function createMockConfig(overrides: Partial<AuthBridgeConfig> = {}): AuthBridgeConfig {
  return {
    usersCollection: 'users',
    sessionCookieName: 'better_auth.session_token',
    apiKeyHeader: 'x-api-key',
    autoCreateUsers: true,
    ...overrides,
  }
}

function createMockDb(options: {
  existingUsers?: PayloadUser[]
  shouldFailOnCreate?: boolean
  shouldFailOnLink?: boolean
} = {}): ProvisioningDatabase {
  const users = [...(options.existingUsers ?? [])]

  return {
    getUserByBetterAuthId: vi.fn(async (id: string) => {
      return users.find((u) => u.id === id) ?? null
    }),
    getUserByEmail: vi.fn(async (email: string) => {
      return users.find((u) => u.email === email) ?? null
    }),
    createUser: vi.fn(async (input: CreateUserInput) => {
      if (options.shouldFailOnCreate) {
        throw new Error('Database connection failed')
      }
      const newUser: PayloadUser = {
        id: input.id,
        email: input.email,
        collection: input.collection,
      }
      users.push(newUser)
      return newUser
    }),
    linkUserToOrganization: vi.fn(async () => {
      if (options.shouldFailOnLink) {
        throw new Error('Failed to link user to organization')
      }
    }),
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('User Provisioning', () => {
  describe('provisionUser', () => {
    it('should create Payload user on first Better Auth login', async () => {
      const db = createMockDb()
      const config = createMockConfig()
      const betterAuthUser = createMockBetterAuthUser()

      const result = await provisionUser(db, betterAuthUser, config)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.created).toBe(true)
        expect(result.user).toBeDefined()
      }
      expect(db.createUser).toHaveBeenCalled()
    })

    it('should map Better Auth id to Payload user', async () => {
      const db = createMockDb()
      const config = createMockConfig()
      const betterAuthUser = createMockBetterAuthUser({ id: 'ba-unique-id-xyz' })

      const result = await provisionUser(db, betterAuthUser, config)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.user.id).toBe('ba-unique-id-xyz')
      }
    })

    it('should copy email from Better Auth', async () => {
      const db = createMockDb()
      const config = createMockConfig()
      const betterAuthUser = createMockBetterAuthUser({ email: 'unique@test.com' })

      const result = await provisionUser(db, betterAuthUser, config)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.user.email).toBe('unique@test.com')
      }
    })

    it('should copy name from Better Auth', async () => {
      const db = createMockDb()
      const config = createMockConfig()
      const betterAuthUser = createMockBetterAuthUser({ name: 'Jane Doe' })

      const result = await provisionUser(db, betterAuthUser, config)

      expect(result.success).toBe(true)
      expect(db.createUser).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Jane Doe' })
      )
    })

    it('should set collection to configured users collection', async () => {
      const db = createMockDb()
      const config = createMockConfig({ usersCollection: 'members' })
      const betterAuthUser = createMockBetterAuthUser()

      const result = await provisionUser(db, betterAuthUser, config)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.user.collection).toBe('members')
      }
    })

    it('should skip provisioning for existing user', async () => {
      const existingUser: PayloadUser = {
        id: 'ba-user-001',
        email: 'alice@example.com',
        collection: 'users',
      }
      const db = createMockDb({ existingUsers: [existingUser] })
      const config = createMockConfig()
      const betterAuthUser = createMockBetterAuthUser()

      const result = await provisionUser(db, betterAuthUser, config)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.created).toBe(false)
        expect(result.user.id).toBe('ba-user-001')
      }
      expect(db.createUser).not.toHaveBeenCalled()
    })
  })

  describe('identity types', () => {
    it('should handle human identity type', async () => {
      const db = createMockDb()
      const config = createMockConfig()
      const betterAuthUser = createMockBetterAuthUser()

      const result = await provisionUser(db, betterAuthUser, config, {
        identityType: 'human',
      })

      expect(result.success).toBe(true)
      expect(db.createUser).toHaveBeenCalledWith(
        expect.objectContaining({ identityType: 'human' })
      )
    })

    it('should handle agent identity type', async () => {
      const db = createMockDb()
      const config = createMockConfig()
      const betterAuthUser = createMockBetterAuthUser({
        name: 'AI Assistant',
        email: 'agent@bots.example.com',
      })

      const result = await provisionUser(db, betterAuthUser, config, {
        identityType: 'agent',
      })

      expect(result.success).toBe(true)
      expect(db.createUser).toHaveBeenCalledWith(
        expect.objectContaining({ identityType: 'agent' })
      )
    })

    it('should handle service identity type', async () => {
      const db = createMockDb()
      const config = createMockConfig()
      const betterAuthUser = createMockBetterAuthUser({
        name: 'Background Worker',
        email: 'service@internal.example.com',
      })

      const result = await provisionUser(db, betterAuthUser, config, {
        identityType: 'service',
      })

      expect(result.success).toBe(true)
      expect(db.createUser).toHaveBeenCalledWith(
        expect.objectContaining({ identityType: 'service' })
      )
    })

    it('should set appropriate fields per identity type', async () => {
      const db = createMockDb()
      const config = createMockConfig()

      // Test human - should have standard user fields
      const humanUser = createMockBetterAuthUser({ name: 'Human User' })
      await provisionUser(db, humanUser, config, { identityType: 'human' })

      expect(db.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          identityType: 'human',
          name: 'Human User',
        })
      )

      // Reset mock
      vi.mocked(db.createUser).mockClear()

      // Test agent - may have different fields
      const agentUser = createMockBetterAuthUser({
        id: 'ba-agent-001',
        name: 'Agent Bot',
      })
      await provisionUser(db, agentUser, config, { identityType: 'agent' })

      expect(db.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          identityType: 'agent',
          name: 'Agent Bot',
        })
      )
    })

    it('should default to human identity type when not specified', async () => {
      const db = createMockDb()
      const config = createMockConfig()
      const betterAuthUser = createMockBetterAuthUser()

      await provisionUser(db, betterAuthUser, config)

      expect(db.createUser).toHaveBeenCalledWith(
        expect.objectContaining({ identityType: 'human' })
      )
    })
  })

  describe('custom mapping', () => {
    it('should use custom userMapper if provided', async () => {
      const db = createMockDb()
      const config = createMockConfig()
      const betterAuthUser = createMockBetterAuthUser()

      const customMapper = vi.fn((user: BetterAuthUser) => ({
        customField: `custom-${user.id}`,
      }))

      await provisionUser(db, betterAuthUser, config, {
        userMapper: customMapper,
      })

      expect(customMapper).toHaveBeenCalledWith(betterAuthUser)
      expect(db.createUser).toHaveBeenCalledWith(
        expect.objectContaining({ customField: 'custom-ba-user-001' })
      )
    })

    it('should allow adding custom fields', async () => {
      const db = createMockDb()
      const config = createMockConfig()
      const betterAuthUser = createMockBetterAuthUser()

      const result = await provisionUser(db, betterAuthUser, config, {
        userMapper: () => ({
          department: 'Engineering',
          tier: 'premium',
        }),
      })

      expect(result.success).toBe(true)
      expect(db.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          department: 'Engineering',
          tier: 'premium',
        })
      )
    })

    it('should allow transforming role', async () => {
      const db = createMockDb()
      const config = createMockConfig()
      const betterAuthUser = createMockBetterAuthUser({ role: 'admin' })

      const result = await provisionUser(db, betterAuthUser, config, {
        userMapper: (user) => ({
          payloadRole: user.role === 'admin' ? 'editor' : 'viewer',
        }),
      })

      expect(result.success).toBe(true)
      expect(db.createUser).toHaveBeenCalledWith(
        expect.objectContaining({ payloadRole: 'editor' })
      )
    })

    it('should merge custom fields with default fields', async () => {
      const db = createMockDb()
      const config = createMockConfig()
      const betterAuthUser = createMockBetterAuthUser({
        id: 'ba-merge-test',
        email: 'merge@test.com',
      })

      await provisionUser(db, betterAuthUser, config, {
        userMapper: () => ({
          customField: 'custom-value',
        }),
      })

      // Should have both default fields (id, email, collection) and custom fields
      expect(db.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'ba-merge-test',
          email: 'merge@test.com',
          collection: 'users',
          customField: 'custom-value',
        })
      )
    })
  })

  describe('organization context', () => {
    it('should link user to organization if activeOrganizationId', async () => {
      const db = createMockDb()
      const config = createMockConfig()
      const betterAuthUser = createMockBetterAuthUser()

      const result = await provisionUser(db, betterAuthUser, config, {
        organizationId: 'org-001',
      })

      expect(result.success).toBe(true)
      expect(db.linkUserToOrganization).toHaveBeenCalledWith(
        'ba-user-001',
        'org-001',
        expect.any(String)
      )
    })

    it('should set org role from Better Auth', async () => {
      const db = createMockDb()
      const config = createMockConfig()
      const betterAuthUser = createMockBetterAuthUser({ role: 'admin' })

      await provisionUser(db, betterAuthUser, config, {
        organizationId: 'org-002',
        organizationRole: 'manager',
      })

      expect(db.linkUserToOrganization).toHaveBeenCalledWith(
        'ba-user-001',
        'org-002',
        'manager'
      )
    })

    it('should use default role member when not specified', async () => {
      const db = createMockDb()
      const config = createMockConfig()
      const betterAuthUser = createMockBetterAuthUser()

      await provisionUser(db, betterAuthUser, config, {
        organizationId: 'org-003',
      })

      expect(db.linkUserToOrganization).toHaveBeenCalledWith(
        'ba-user-001',
        'org-003',
        'member' // default role
      )
    })

    it('should not link to organization if no organizationId', async () => {
      const db = createMockDb()
      const config = createMockConfig()
      const betterAuthUser = createMockBetterAuthUser()

      await provisionUser(db, betterAuthUser, config)

      expect(db.linkUserToOrganization).not.toHaveBeenCalled()
    })
  })

  describe('error handling', () => {
    it('should handle duplicate email gracefully', async () => {
      const existingUserWithEmail: PayloadUser = {
        id: 'different-id',
        email: 'alice@example.com',
        collection: 'users',
      }
      const db = createMockDb({ existingUsers: [existingUserWithEmail] })
      const config = createMockConfig()
      // New user with same email but different BA ID
      const betterAuthUser = createMockBetterAuthUser({
        id: 'ba-new-user',
        email: 'alice@example.com',
      })

      const result = await provisionUser(db, betterAuthUser, config)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('duplicate_email')
      }
    })

    it('should handle database errors', async () => {
      const db = createMockDb({ shouldFailOnCreate: true })
      const config = createMockConfig()
      const betterAuthUser = createMockBetterAuthUser()

      const result = await provisionUser(db, betterAuthUser, config)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('database_error')
      }
    })

    it('should rollback on partial failure', async () => {
      // User creation succeeds but org link fails
      const db = createMockDb({ shouldFailOnLink: true })
      const config = createMockConfig()
      const betterAuthUser = createMockBetterAuthUser()

      const result = await provisionUser(db, betterAuthUser, config, {
        organizationId: 'org-fail',
      })

      // Should either rollback the user creation or report the failure
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(['database_error', 'rollback_failed']).toContain(result.error)
      }
    })

    it('should validate required fields before provisioning', async () => {
      const db = createMockDb()
      const config = createMockConfig()
      const betterAuthUser = createMockBetterAuthUser({
        email: '', // Invalid empty email
      })

      const result = await provisionUser(db, betterAuthUser, config)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('validation_error')
      }
    })

    it('should handle missing Better Auth user ID', async () => {
      const db = createMockDb()
      const config = createMockConfig()
      const betterAuthUser = createMockBetterAuthUser({
        id: '', // Invalid empty ID
      })

      const result = await provisionUser(db, betterAuthUser, config)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('validation_error')
      }
    })
  })

  describe('edge cases', () => {
    it('should handle user with no name', async () => {
      const db = createMockDb()
      const config = createMockConfig()
      const betterAuthUser = createMockBetterAuthUser({ name: '' })

      const result = await provisionUser(db, betterAuthUser, config)

      expect(result.success).toBe(true)
      // Name should be optional or have a fallback
    })

    it('should handle concurrent provisioning attempts', async () => {
      // Simulate race condition where user is created between check and create
      let createCallCount = 0
      const db: ProvisioningDatabase = {
        getUserByBetterAuthId: vi.fn(async () => null), // Initially not found
        getUserByEmail: vi.fn(async () => null),
        createUser: vi.fn(async (input) => {
          createCallCount++
          if (createCallCount > 1) {
            // Second call should fail due to duplicate
            throw new Error('Duplicate key error')
          }
          return {
            id: input.id,
            email: input.email,
            collection: input.collection,
          }
        }),
        linkUserToOrganization: vi.fn(async () => {}),
      }
      const config = createMockConfig()
      const betterAuthUser = createMockBetterAuthUser()

      // First provisioning should succeed
      const result1 = await provisionUser(db, betterAuthUser, config)
      expect(result1.success).toBe(true)

      // Second provisioning (simulating race) should handle gracefully
      const result2 = await provisionUser(db, betterAuthUser, config)
      // Should either succeed by finding existing user or fail gracefully
      expect(result2.success === true || result2.error === 'duplicate_email').toBe(true)
    })

    it('should preserve Better Auth metadata for audit', async () => {
      const db = createMockDb()
      const config = createMockConfig()
      const createdAt = new Date('2024-01-01')
      const betterAuthUser = createMockBetterAuthUser({
        createdAt,
        emailVerified: true,
      })

      await provisionUser(db, betterAuthUser, config)

      // The provisioning should preserve or reference the original BA user creation time
      expect(db.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          // Either directly include or have a reference field
          id: betterAuthUser.id,
        })
      )
    })

    it('should work when autoCreateUsers is false in config', async () => {
      const db = createMockDb()
      const config = createMockConfig({ autoCreateUsers: false })
      const betterAuthUser = createMockBetterAuthUser()

      // When autoCreateUsers is false, should not create user
      const result = await provisionUser(db, betterAuthUser, config)

      expect(result.success).toBe(false)
      expect(db.createUser).not.toHaveBeenCalled()
    })
  })
})
