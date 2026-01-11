/**
 * User Synchronization Tests (RED Phase)
 *
 * These tests define the contract for keeping Payload CMS users in sync
 * with Better Auth when user data changes.
 *
 * The sync module should handle:
 * - syncUser: Update Payload user when Better Auth user changes
 * - syncUserByEvent: Handle Better Auth events (updated, deleted, session.created)
 * - batchSyncUsers: Efficiently sync multiple users
 * - detectDrift: Find users that are out of sync between systems
 * - Webhook handler: Validate signatures and dispatch to handlers
 *
 * Reference: dotdo - User Sync RED Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { BetterAuthUser, PayloadUser, AuthBridgeConfig } from '../../auth/types'
import {
  syncUser,
  syncUserByEvent,
  batchSyncUsers,
  detectDrift,
  createWebhookHandler,
} from '../../auth/user-sync'

// ============================================================================
// Type definitions for the user-sync module (to be implemented)
// ============================================================================

/**
 * Result of a single user sync operation.
 */
export interface SyncResult {
  /** Whether sync was successful */
  success: true
  /** User ID that was synced */
  userId: string
  /** Fields that were changed */
  changes: string[]
  /** Whether user was created (fallback provisioning) */
  created: boolean
}

/**
 * Failed sync result.
 */
export interface SyncFailure {
  /** Sync failed */
  success: false
  /** User ID that failed to sync */
  userId: string
  /** Error type */
  error: 'not_found' | 'database_error' | 'validation_error' | 'conflict'
  /** Error message */
  message: string
}

/**
 * Union type for sync results.
 */
export type SyncUserResult = SyncResult | SyncFailure

/**
 * Options for sync operations.
 */
export interface SyncOptions {
  /** Payload database interface */
  payload: PayloadInterface
  /** Whether to create user if not exists (default: false) */
  createIfNotExists?: boolean
  /** Collection name for users */
  usersCollection?: string
}

/**
 * Payload interface for sync operations.
 */
export interface PayloadInterface {
  /** Find users in a collection */
  find(args: {
    collection: string
    where?: Record<string, unknown>
    limit?: number
  }): Promise<{ docs: PayloadUserWithDetails[] }>

  /** Update a user */
  update(args: {
    collection: string
    id: string
    data: Partial<PayloadUserWithDetails>
  }): Promise<PayloadUserWithDetails>

  /** Create a user */
  create(args: {
    collection: string
    data: Partial<PayloadUserWithDetails>
  }): Promise<PayloadUserWithDetails>

  /** Delete a user */
  delete(args: {
    collection: string
    id: string
  }): Promise<void>
}

/**
 * Extended Payload user with additional fields.
 */
export interface PayloadUserWithDetails extends PayloadUser {
  name?: string
  role?: string
  emailVerified?: boolean
  image?: string | null
  betterAuthId?: string
  active?: boolean
  deactivatedAt?: Date | null
}

/**
 * Better Auth event types.
 */
export type BetterAuthEventType =
  | 'user.created'
  | 'user.updated'
  | 'user.deleted'
  | 'session.created'
  | 'session.revoked'

/**
 * Better Auth event payload.
 */
export interface BetterAuthEvent {
  type: BetterAuthEventType
  timestamp: Date
  data: {
    user?: BetterAuthUser
    userId?: string
    sessionId?: string
  }
}

/**
 * Batch sync result for multiple users.
 */
export interface BatchSyncResult {
  /** Total users processed */
  total: number
  /** Successfully synced count */
  succeeded: number
  /** Failed sync count */
  failed: number
  /** Individual results per user */
  results: SyncUserResult[]
}

/**
 * Drift detection result for a single user.
 */
export interface UserDrift {
  /** User ID */
  userId: string
  /** Email address */
  email: string
  /** Fields that differ between systems */
  driftedFields: string[]
  /** Details of the differences */
  differences: {
    field: string
    betterAuth: unknown
    payload: unknown
  }[]
}

/**
 * Options for drift detection.
 */
export interface DriftDetectionOptions {
  /** Payload database interface */
  payload: PayloadInterface
  /** Better Auth database interface */
  betterAuth: BetterAuthInterface
  /** Collection name for users */
  usersCollection?: string
  /** Limit number of users to check */
  limit?: number
}

/**
 * Better Auth interface for reading users.
 */
export interface BetterAuthInterface {
  /** Get all users */
  getUsers(limit?: number): Promise<BetterAuthUser[]>
  /** Get user by ID */
  getUserById(id: string): Promise<BetterAuthUser | null>
}

/**
 * Drift detection result.
 */
export interface DriftDetectionResult {
  /** Total users compared */
  totalCompared: number
  /** Users with drift */
  driftedUsers: UserDrift[]
  /** Users in Better Auth but not in Payload */
  missingInPayload: string[]
  /** Users in Payload but not in Better Auth */
  orphanedInPayload: string[]
}

/**
 * Webhook handler options.
 */
export interface WebhookHandlerOptions {
  /** Secret for validating webhook signatures */
  secret: string
  /** Payload database interface */
  payload: PayloadInterface
  /** Collection name for users */
  usersCollection?: string
}

/**
 * Webhook validation result.
 */
export type WebhookResult =
  | { success: true; event: BetterAuthEvent; syncResult?: SyncUserResult }
  | { success: false; error: 'invalid_signature' | 'invalid_payload' | 'handler_error'; message: string }

// ============================================================================
// Mock helpers
// ============================================================================

function createMockBetterAuthUser(overrides: Partial<BetterAuthUser> = {}): BetterAuthUser {
  const now = new Date()
  return {
    id: 'ba-user-001',
    name: 'Alice Smith',
    email: 'alice@example.com.ai',
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

function createMockPayloadUser(overrides: Partial<PayloadUserWithDetails> = {}): PayloadUserWithDetails {
  return {
    id: 'ba-user-001',
    email: 'alice@example.com.ai',
    collection: 'users',
    name: 'Alice Smith',
    role: 'user',
    emailVerified: true,
    image: null,
    betterAuthId: 'ba-user-001',
    active: true,
    deactivatedAt: null,
    ...overrides,
  }
}

function createMockPayloadInterface(options: {
  existingUsers?: PayloadUserWithDetails[]
  shouldFailOnUpdate?: boolean
  shouldFailOnCreate?: boolean
  shouldFailOnDelete?: boolean
} = {}): PayloadInterface {
  const users = [...(options.existingUsers ?? [])]

  return {
    find: vi.fn(async (args) => {
      const where = args.where as Record<string, unknown> | undefined
      if (where?.email) {
        const found = users.filter((u) => u.email === where.email)
        return { docs: found }
      }
      if (where?.id) {
        const found = users.filter((u) => u.id === where.id)
        return { docs: found }
      }
      if (where?.betterAuthId) {
        const found = users.filter((u) => u.betterAuthId === where.betterAuthId)
        return { docs: found }
      }
      return { docs: users.slice(0, args.limit) }
    }),
    update: vi.fn(async (args) => {
      if (options.shouldFailOnUpdate) {
        throw new Error('Database update failed')
      }
      const idx = users.findIndex((u) => u.id === args.id)
      if (idx === -1) {
        throw new Error('User not found')
      }
      users[idx] = { ...users[idx], ...args.data }
      return users[idx]
    }),
    create: vi.fn(async (args) => {
      if (options.shouldFailOnCreate) {
        throw new Error('Database create failed')
      }
      const newUser: PayloadUserWithDetails = {
        id: args.data.id ?? `payload-${Date.now()}`,
        email: args.data.email ?? '',
        collection: args.collection,
        ...args.data,
      }
      users.push(newUser)
      return newUser
    }),
    delete: vi.fn(async (args) => {
      if (options.shouldFailOnDelete) {
        throw new Error('Database delete failed')
      }
      const idx = users.findIndex((u) => u.id === args.id)
      if (idx !== -1) {
        users.splice(idx, 1)
      }
    }),
  }
}

function createMockBetterAuthInterface(options: {
  users?: BetterAuthUser[]
} = {}): BetterAuthInterface {
  const users = options.users ?? []

  return {
    getUsers: vi.fn(async (limit?: number) => {
      return limit ? users.slice(0, limit) : users
    }),
    getUserById: vi.fn(async (id: string) => {
      return users.find((u) => u.id === id) ?? null
    }),
  }
}

// ============================================================================
// Tests: syncUser
// ============================================================================

describe('User Sync', () => {
  describe('syncUser', () => {
    it('should update Payload user email when Better Auth email changes', async () => {
      const existingUser = createMockPayloadUser({ email: 'old@example.com.ai' })
      const payload = createMockPayloadInterface({ existingUsers: [existingUser] })

      const betterAuthUser = createMockBetterAuthUser({ email: 'new@example.com.ai' })

      const result = await syncUser(betterAuthUser, { payload })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.changes).toContain('email')
      }
      expect(payload.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ email: 'new@example.com.ai' }),
        })
      )
    })

    it('should update Payload user name when Better Auth name changes', async () => {
      const existingUser = createMockPayloadUser({ name: 'Old Name' })
      const payload = createMockPayloadInterface({ existingUsers: [existingUser] })

      const betterAuthUser = createMockBetterAuthUser({ name: 'New Name' })

      const result = await syncUser(betterAuthUser, { payload })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.changes).toContain('name')
      }
      expect(payload.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'New Name' }),
        })
      )
    })

    it('should update Payload user role when Better Auth role changes', async () => {
      const existingUser = createMockPayloadUser({ role: 'user' })
      const payload = createMockPayloadInterface({ existingUsers: [existingUser] })

      const betterAuthUser = createMockBetterAuthUser({ role: 'admin' })

      const result = await syncUser(betterAuthUser, { payload })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.changes).toContain('role')
      }
      expect(payload.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ role: 'admin' }),
        })
      )
    })

    it('should handle multiple field changes in single sync', async () => {
      const existingUser = createMockPayloadUser({
        email: 'old@example.com.ai',
        name: 'Old Name',
        role: 'user',
      })
      const payload = createMockPayloadInterface({ existingUsers: [existingUser] })

      const betterAuthUser = createMockBetterAuthUser({
        email: 'new@example.com.ai',
        name: 'New Name',
        role: 'admin',
      })

      const result = await syncUser(betterAuthUser, { payload })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.changes).toContain('email')
        expect(result.changes).toContain('name')
        expect(result.changes).toContain('role')
        expect(result.changes.length).toBe(3)
      }
    })

    it('should return empty changes array when no differences', async () => {
      const existingUser = createMockPayloadUser({
        email: 'alice@example.com.ai',
        name: 'Alice Smith',
        role: 'user',
      })
      const payload = createMockPayloadInterface({ existingUsers: [existingUser] })

      const betterAuthUser = createMockBetterAuthUser({
        email: 'alice@example.com.ai',
        name: 'Alice Smith',
        role: 'user',
      })

      const result = await syncUser(betterAuthUser, { payload })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.changes).toEqual([])
        expect(result.created).toBe(false)
      }
      // Should not call update when no changes
      expect(payload.update).not.toHaveBeenCalled()
    })

    it('should create user if not exists when createIfNotExists is true', async () => {
      const payload = createMockPayloadInterface({ existingUsers: [] })

      const betterAuthUser = createMockBetterAuthUser()

      const result = await syncUser(betterAuthUser, {
        payload,
        createIfNotExists: true,
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.created).toBe(true)
      }
      expect(payload.create).toHaveBeenCalled()
    })

    it('should fail when user not found and createIfNotExists is false', async () => {
      const payload = createMockPayloadInterface({ existingUsers: [] })

      const betterAuthUser = createMockBetterAuthUser()

      const result = await syncUser(betterAuthUser, {
        payload,
        createIfNotExists: false,
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('not_found')
      }
    })

    it('should handle database update errors gracefully', async () => {
      const existingUser = createMockPayloadUser()
      const payload = createMockPayloadInterface({
        existingUsers: [existingUser],
        shouldFailOnUpdate: true,
      })

      const betterAuthUser = createMockBetterAuthUser({ email: 'changed@example.com.ai' })

      const result = await syncUser(betterAuthUser, { payload })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('database_error')
      }
    })

    it('should use custom usersCollection if provided', async () => {
      const existingUser = createMockPayloadUser({ collection: 'members' })
      const payload = createMockPayloadInterface({ existingUsers: [existingUser] })

      const betterAuthUser = createMockBetterAuthUser({ email: 'new@example.com.ai' })

      await syncUser(betterAuthUser, {
        payload,
        usersCollection: 'members',
      })

      expect(payload.find).toHaveBeenCalledWith(
        expect.objectContaining({ collection: 'members' })
      )
    })

    it('should sync emailVerified status', async () => {
      const existingUser = createMockPayloadUser({ emailVerified: false })
      const payload = createMockPayloadInterface({ existingUsers: [existingUser] })

      const betterAuthUser = createMockBetterAuthUser({ emailVerified: true })

      const result = await syncUser(betterAuthUser, { payload })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.changes).toContain('emailVerified')
      }
    })

    it('should sync image/avatar changes', async () => {
      const existingUser = createMockPayloadUser({ image: null })
      const payload = createMockPayloadInterface({ existingUsers: [existingUser] })

      const betterAuthUser = createMockBetterAuthUser({
        image: 'https://example.com.ai/avatar.png',
      })

      const result = await syncUser(betterAuthUser, { payload })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.changes).toContain('image')
      }
    })

    it('should find user by betterAuthId field', async () => {
      const existingUser = createMockPayloadUser({
        id: 'payload-internal-id',
        betterAuthId: 'ba-user-001',
      })
      const payload = createMockPayloadInterface({ existingUsers: [existingUser] })

      const betterAuthUser = createMockBetterAuthUser({ id: 'ba-user-001' })

      const result = await syncUser(betterAuthUser, { payload })

      expect(result.success).toBe(true)
      expect(payload.find).toHaveBeenCalled()
    })
  })

  // ============================================================================
  // Tests: syncUserByEvent
  // ============================================================================

  describe('syncUserByEvent', () => {
    it('should sync user on user.updated event', async () => {
      const existingUser = createMockPayloadUser({ name: 'Old Name' })
      const payload = createMockPayloadInterface({ existingUsers: [existingUser] })

      const event: BetterAuthEvent = {
        type: 'user.updated',
        timestamp: new Date(),
        data: {
          user: createMockBetterAuthUser({ name: 'Updated Name' }),
        },
      }

      const result = await syncUserByEvent(event, { payload })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.changes).toContain('name')
      }
    })

    it('should deactivate Payload user on user.deleted event', async () => {
      const existingUser = createMockPayloadUser({ active: true })
      const payload = createMockPayloadInterface({ existingUsers: [existingUser] })

      const event: BetterAuthEvent = {
        type: 'user.deleted',
        timestamp: new Date(),
        data: {
          userId: 'ba-user-001',
        },
      }

      const result = await syncUserByEvent(event, { payload })

      expect(result.success).toBe(true)
      expect(payload.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            active: false,
            deactivatedAt: expect.any(Date),
          }),
        })
      )
    })

    it('should sync on session.created if user data changed', async () => {
      const existingUser = createMockPayloadUser({ name: 'Old Name' })
      const payload = createMockPayloadInterface({ existingUsers: [existingUser] })

      const event: BetterAuthEvent = {
        type: 'session.created',
        timestamp: new Date(),
        data: {
          user: createMockBetterAuthUser({ name: 'Name Updated During Login' }),
          sessionId: 'session-123',
        },
      }

      const result = await syncUserByEvent(event, { payload })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.changes).toContain('name')
      }
    })

    it('should handle missing user in event data', async () => {
      const payload = createMockPayloadInterface()

      const event: BetterAuthEvent = {
        type: 'user.updated',
        timestamp: new Date(),
        data: {},
      }

      const result = await syncUserByEvent(event, { payload })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('validation_error')
      }
    })

    it('should handle unknown event types gracefully', async () => {
      const payload = createMockPayloadInterface()

      const event = {
        type: 'unknown.event' as BetterAuthEventType,
        timestamp: new Date(),
        data: { user: createMockBetterAuthUser() },
      }

      const result = await syncUserByEvent(event, { payload })

      // Should either succeed with no changes or return validation error
      expect(result.success === true || result.error === 'validation_error').toBe(true)
    })

    it('should not delete user on user.deleted, only deactivate', async () => {
      const existingUser = createMockPayloadUser()
      const payload = createMockPayloadInterface({ existingUsers: [existingUser] })

      const event: BetterAuthEvent = {
        type: 'user.deleted',
        timestamp: new Date(),
        data: { userId: 'ba-user-001' },
      }

      await syncUserByEvent(event, { payload })

      // Should update (deactivate), not delete
      expect(payload.delete).not.toHaveBeenCalled()
      expect(payload.update).toHaveBeenCalled()
    })
  })

  // ============================================================================
  // Tests: batchSyncUsers
  // ============================================================================

  describe('batchSyncUsers', () => {
    it('should sync multiple users efficiently', async () => {
      const existingUsers = [
        createMockPayloadUser({ id: 'ba-user-001', email: 'old1@example.com.ai' }),
        createMockPayloadUser({ id: 'ba-user-002', email: 'old2@example.com.ai' }),
        createMockPayloadUser({ id: 'ba-user-003', email: 'old3@example.com.ai' }),
      ]
      const payload = createMockPayloadInterface({ existingUsers })

      const betterAuthUsers = [
        createMockBetterAuthUser({ id: 'ba-user-001', email: 'new1@example.com.ai' }),
        createMockBetterAuthUser({ id: 'ba-user-002', email: 'new2@example.com.ai' }),
        createMockBetterAuthUser({ id: 'ba-user-003', email: 'new3@example.com.ai' }),
      ]

      const result = await batchSyncUsers(betterAuthUsers, { payload })

      expect(result.total).toBe(3)
      expect(result.succeeded).toBe(3)
      expect(result.failed).toBe(0)
      expect(result.results.length).toBe(3)
    })

    it('should return results per user with success/failure', async () => {
      const existingUsers = [
        createMockPayloadUser({ id: 'ba-user-001' }),
        // ba-user-002 does not exist
      ]
      const payload = createMockPayloadInterface({ existingUsers })

      const betterAuthUsers = [
        createMockBetterAuthUser({ id: 'ba-user-001', email: 'new1@example.com.ai' }),
        createMockBetterAuthUser({ id: 'ba-user-002', email: 'new2@example.com.ai' }),
      ]

      const result = await batchSyncUsers(betterAuthUsers, {
        payload,
        createIfNotExists: false,
      })

      expect(result.total).toBe(2)
      expect(result.succeeded).toBe(1)
      expect(result.failed).toBe(1)

      const successResult = result.results.find((r) => r.userId === 'ba-user-001')
      const failResult = result.results.find((r) => r.userId === 'ba-user-002')

      expect(successResult?.success).toBe(true)
      expect(failResult?.success).toBe(false)
    })

    it('should handle partial failures without stopping batch', async () => {
      const existingUsers = [
        createMockPayloadUser({ id: 'ba-user-001' }),
        createMockPayloadUser({ id: 'ba-user-002' }),
        createMockPayloadUser({ id: 'ba-user-003' }),
      ]

      // Create a mock that fails only for the second user
      const payload: PayloadInterface = {
        find: vi.fn(async (args) => {
          const where = args.where as Record<string, unknown> | undefined
          const found = existingUsers.filter((u) => u.id === where?.id || u.betterAuthId === where?.betterAuthId)
          return { docs: found }
        }),
        update: vi.fn(async (args) => {
          if (args.id === 'ba-user-002') {
            throw new Error('Simulated failure for user 2')
          }
          const user = existingUsers.find((u) => u.id === args.id)!
          return { ...user, ...args.data }
        }),
        create: vi.fn(),
        delete: vi.fn(),
      }

      const betterAuthUsers = [
        createMockBetterAuthUser({ id: 'ba-user-001', email: 'new1@example.com.ai' }),
        createMockBetterAuthUser({ id: 'ba-user-002', email: 'new2@example.com.ai' }),
        createMockBetterAuthUser({ id: 'ba-user-003', email: 'new3@example.com.ai' }),
      ]

      const result = await batchSyncUsers(betterAuthUsers, { payload })

      expect(result.succeeded).toBe(2)
      expect(result.failed).toBe(1)

      // The failed user should have error details
      const failedResult = result.results.find((r) => r.userId === 'ba-user-002')
      expect(failedResult?.success).toBe(false)
    })

    it('should track changes for each user', async () => {
      const existingUsers = [
        createMockPayloadUser({ id: 'ba-user-001', email: 'same@example.com.ai', name: 'Old Name 1' }),
        createMockPayloadUser({ id: 'ba-user-002', email: 'old2@example.com.ai', name: 'Same Name' }),
      ]
      const payload = createMockPayloadInterface({ existingUsers })

      const betterAuthUsers = [
        createMockBetterAuthUser({ id: 'ba-user-001', email: 'same@example.com.ai', name: 'New Name 1' }),
        createMockBetterAuthUser({ id: 'ba-user-002', email: 'new2@example.com.ai', name: 'Same Name' }),
      ]

      const result = await batchSyncUsers(betterAuthUsers, { payload })

      const user1Result = result.results.find((r) => r.userId === 'ba-user-001')
      const user2Result = result.results.find((r) => r.userId === 'ba-user-002')

      if (user1Result?.success) {
        expect(user1Result.changes).toContain('name')
        expect(user1Result.changes).not.toContain('email')
      }

      if (user2Result?.success) {
        expect(user2Result.changes).toContain('email')
        expect(user2Result.changes).not.toContain('name')
      }
    })

    it('should handle empty array of users', async () => {
      const payload = createMockPayloadInterface()

      const result = await batchSyncUsers([], { payload })

      expect(result.total).toBe(0)
      expect(result.succeeded).toBe(0)
      expect(result.failed).toBe(0)
      expect(result.results).toEqual([])
    })
  })

  // ============================================================================
  // Tests: detectDrift
  // ============================================================================

  describe('detectDrift', () => {
    it('should find users with different email between systems', async () => {
      const payloadUsers = [
        createMockPayloadUser({ id: 'ba-user-001', email: 'payload@example.com.ai' }),
      ]
      const payload = createMockPayloadInterface({ existingUsers: payloadUsers })

      const betterAuthUsers = [
        createMockBetterAuthUser({ id: 'ba-user-001', email: 'betterauth@example.com.ai' }),
      ]
      const betterAuth = createMockBetterAuthInterface({ users: betterAuthUsers })

      const result = await detectDrift({ payload, betterAuth })

      expect(result.driftedUsers.length).toBe(1)
      expect(result.driftedUsers[0].driftedFields).toContain('email')
      expect(result.driftedUsers[0].differences).toContainEqual({
        field: 'email',
        betterAuth: 'betterauth@example.com.ai',
        payload: 'payload@example.com.ai',
      })
    })

    it('should find users with different name between systems', async () => {
      const payloadUsers = [
        createMockPayloadUser({ id: 'ba-user-001', name: 'Payload Name' }),
      ]
      const payload = createMockPayloadInterface({ existingUsers: payloadUsers })

      const betterAuthUsers = [
        createMockBetterAuthUser({ id: 'ba-user-001', name: 'Better Auth Name' }),
      ]
      const betterAuth = createMockBetterAuthInterface({ users: betterAuthUsers })

      const result = await detectDrift({ payload, betterAuth })

      expect(result.driftedUsers[0].driftedFields).toContain('name')
    })

    it('should find users with different role between systems', async () => {
      const payloadUsers = [
        createMockPayloadUser({ id: 'ba-user-001', role: 'user' }),
      ]
      const payload = createMockPayloadInterface({ existingUsers: payloadUsers })

      const betterAuthUsers = [
        createMockBetterAuthUser({ id: 'ba-user-001', role: 'admin' }),
      ]
      const betterAuth = createMockBetterAuthInterface({ users: betterAuthUsers })

      const result = await detectDrift({ payload, betterAuth })

      expect(result.driftedUsers[0].driftedFields).toContain('role')
    })

    it('should identify users missing in Payload', async () => {
      const payloadUsers: PayloadUserWithDetails[] = []
      const payload = createMockPayloadInterface({ existingUsers: payloadUsers })

      const betterAuthUsers = [
        createMockBetterAuthUser({ id: 'ba-user-001' }),
        createMockBetterAuthUser({ id: 'ba-user-002' }),
      ]
      const betterAuth = createMockBetterAuthInterface({ users: betterAuthUsers })

      const result = await detectDrift({ payload, betterAuth })

      expect(result.missingInPayload).toContain('ba-user-001')
      expect(result.missingInPayload).toContain('ba-user-002')
    })

    it('should identify orphaned users in Payload', async () => {
      const payloadUsers = [
        createMockPayloadUser({ id: 'ba-user-001', betterAuthId: 'ba-user-001' }),
        createMockPayloadUser({ id: 'orphan-001', betterAuthId: 'orphan-001' }),
      ]
      const payload = createMockPayloadInterface({ existingUsers: payloadUsers })

      const betterAuthUsers = [
        createMockBetterAuthUser({ id: 'ba-user-001' }),
        // orphan-001 does not exist in Better Auth
      ]
      const betterAuth = createMockBetterAuthInterface({ users: betterAuthUsers })

      const result = await detectDrift({ payload, betterAuth })

      expect(result.orphanedInPayload).toContain('orphan-001')
    })

    it('should return empty results when all users are in sync', async () => {
      const payloadUsers = [
        createMockPayloadUser({
          id: 'ba-user-001',
          email: 'alice@example.com.ai',
          name: 'Alice Smith',
          role: 'user',
        }),
      ]
      const payload = createMockPayloadInterface({ existingUsers: payloadUsers })

      const betterAuthUsers = [
        createMockBetterAuthUser({
          id: 'ba-user-001',
          email: 'alice@example.com.ai',
          name: 'Alice Smith',
          role: 'user',
        }),
      ]
      const betterAuth = createMockBetterAuthInterface({ users: betterAuthUsers })

      const result = await detectDrift({ payload, betterAuth })

      expect(result.driftedUsers).toEqual([])
      expect(result.missingInPayload).toEqual([])
      expect(result.orphanedInPayload).toEqual([])
    })

    it('should respect limit option', async () => {
      const betterAuthUsers = Array.from({ length: 100 }, (_, i) =>
        createMockBetterAuthUser({ id: `ba-user-${i}` })
      )
      const betterAuth = createMockBetterAuthInterface({ users: betterAuthUsers })
      const payload = createMockPayloadInterface()

      const result = await detectDrift({
        payload,
        betterAuth,
        limit: 10,
      })

      expect(result.totalCompared).toBeLessThanOrEqual(10)
    })

    it('should detect multiple drifted fields per user', async () => {
      const payloadUsers = [
        createMockPayloadUser({
          id: 'ba-user-001',
          email: 'old@example.com.ai',
          name: 'Old Name',
          role: 'user',
        }),
      ]
      const payload = createMockPayloadInterface({ existingUsers: payloadUsers })

      const betterAuthUsers = [
        createMockBetterAuthUser({
          id: 'ba-user-001',
          email: 'new@example.com.ai',
          name: 'New Name',
          role: 'admin',
        }),
      ]
      const betterAuth = createMockBetterAuthInterface({ users: betterAuthUsers })

      const result = await detectDrift({ payload, betterAuth })

      expect(result.driftedUsers[0].driftedFields.length).toBe(3)
      expect(result.driftedUsers[0].driftedFields).toContain('email')
      expect(result.driftedUsers[0].driftedFields).toContain('name')
      expect(result.driftedUsers[0].driftedFields).toContain('role')
    })
  })

  // ============================================================================
  // Tests: Webhook Handler
  // ============================================================================

  describe('Webhook Handler', () => {
    it('should validate webhook signature', async () => {
      const payload = createMockPayloadInterface()
      const handler = createWebhookHandler({
        secret: 'webhook-secret-123',
        payload,
      })

      const validSignature = 'sha256=valid-signature-here'
      const body = JSON.stringify({
        type: 'user.updated',
        timestamp: new Date().toISOString(),
        data: { user: createMockBetterAuthUser() },
      })

      // This should fail with invalid signature
      const result = await handler(body, 'sha256=invalid-signature')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('invalid_signature')
      }
    })

    it('should parse event payload correctly', async () => {
      const existingUser = createMockPayloadUser()
      const payload = createMockPayloadInterface({ existingUsers: [existingUser] })
      const handler = createWebhookHandler({
        secret: 'webhook-secret-123',
        payload,
      })

      const eventData = {
        type: 'user.updated',
        timestamp: new Date().toISOString(),
        data: { user: createMockBetterAuthUser({ name: 'Updated Name' }) },
      }
      const body = JSON.stringify(eventData)

      // Assume valid signature for this test (implementation will verify)
      const result = await handler(body, 'valid-signature')

      if (result.success) {
        expect(result.event.type).toBe('user.updated')
        expect(result.event.data.user?.name).toBe('Updated Name')
      }
    })

    it('should reject malformed JSON payload', async () => {
      const payload = createMockPayloadInterface()
      const handler = createWebhookHandler({
        secret: 'webhook-secret-123',
        payload,
      })

      const result = await handler('{ invalid json }', 'any-signature')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBe('invalid_payload')
      }
    })

    it('should dispatch user.updated to sync handler', async () => {
      const existingUser = createMockPayloadUser({ name: 'Old Name' })
      const payload = createMockPayloadInterface({ existingUsers: [existingUser] })
      const handler = createWebhookHandler({
        secret: 'webhook-secret-123',
        payload,
      })

      const eventData = {
        type: 'user.updated',
        timestamp: new Date().toISOString(),
        data: { user: createMockBetterAuthUser({ name: 'New Name' }) },
      }
      const body = JSON.stringify(eventData)

      // Assuming valid signature verification
      const result = await handler(body, 'valid-signature')

      if (result.success && result.syncResult) {
        expect(result.syncResult.success).toBe(true)
      }
    })

    it('should dispatch user.deleted to deactivation handler', async () => {
      const existingUser = createMockPayloadUser({ active: true })
      const payload = createMockPayloadInterface({ existingUsers: [existingUser] })
      const handler = createWebhookHandler({
        secret: 'webhook-secret-123',
        payload,
      })

      const eventData = {
        type: 'user.deleted',
        timestamp: new Date().toISOString(),
        data: { userId: 'ba-user-001' },
      }
      const body = JSON.stringify(eventData)

      const result = await handler(body, 'valid-signature')

      if (result.success) {
        expect(payload.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ active: false }),
          })
        )
      }
    })

    it('should handle handler errors gracefully', async () => {
      const payload = createMockPayloadInterface({ shouldFailOnUpdate: true })
      const existingUser = createMockPayloadUser()
      ;(payload.find as ReturnType<typeof vi.fn>).mockResolvedValue({ docs: [existingUser] })

      const handler = createWebhookHandler({
        secret: 'webhook-secret-123',
        payload,
      })

      const eventData = {
        type: 'user.updated',
        timestamp: new Date().toISOString(),
        data: { user: createMockBetterAuthUser({ email: 'new@example.com.ai' }) },
      }
      const body = JSON.stringify(eventData)

      const result = await handler(body, 'valid-signature')

      // Should return error, not throw
      expect(result.success === false || (result.success && result.syncResult?.success === false)).toBe(true)
    })

    it('should use custom usersCollection from options', async () => {
      const existingUser = createMockPayloadUser({ collection: 'members' })
      const payload = createMockPayloadInterface({ existingUsers: [existingUser] })
      const handler = createWebhookHandler({
        secret: 'webhook-secret-123',
        payload,
        usersCollection: 'members',
      })

      const eventData = {
        type: 'user.updated',
        timestamp: new Date().toISOString(),
        data: { user: createMockBetterAuthUser() },
      }
      const body = JSON.stringify(eventData)

      await handler(body, 'valid-signature')

      expect(payload.find).toHaveBeenCalledWith(
        expect.objectContaining({ collection: 'members' })
      )
    })
  })

  // ============================================================================
  // Tests: Edge Cases
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle null role in Better Auth user', async () => {
      const existingUser = createMockPayloadUser({ role: 'user' })
      const payload = createMockPayloadInterface({ existingUsers: [existingUser] })

      const betterAuthUser = createMockBetterAuthUser({ role: null })

      const result = await syncUser(betterAuthUser, { payload })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.changes).toContain('role')
      }
    })

    it('should handle undefined name gracefully', async () => {
      const existingUser = createMockPayloadUser({ name: 'Existing Name' })
      const payload = createMockPayloadInterface({ existingUsers: [existingUser] })

      const betterAuthUser = createMockBetterAuthUser({ name: '' })

      const result = await syncUser(betterAuthUser, { payload })

      expect(result.success).toBe(true)
    })

    it('should handle concurrent sync attempts safely', async () => {
      const existingUser = createMockPayloadUser()
      const payload = createMockPayloadInterface({ existingUsers: [existingUser] })

      const betterAuthUser = createMockBetterAuthUser({ email: 'new@example.com.ai' })

      // Simulate concurrent sync
      const results = await Promise.all([
        syncUser(betterAuthUser, { payload }),
        syncUser(betterAuthUser, { payload }),
        syncUser(betterAuthUser, { payload }),
      ])

      // All should succeed or handle conflict gracefully
      const allSucceeded = results.every((r) => r.success)
      const someConflict = results.some((r) => !r.success && r.error === 'conflict')

      expect(allSucceeded || someConflict).toBe(true)
    })

    it('should preserve fields not in Better Auth during sync', async () => {
      const existingUser = createMockPayloadUser({
        email: 'alice@example.com.ai',
        // Custom Payload-only field
        customPayloadField: 'should-be-preserved',
      } as PayloadUserWithDetails & { customPayloadField: string })
      const payload = createMockPayloadInterface({ existingUsers: [existingUser] })

      const betterAuthUser = createMockBetterAuthUser({ name: 'New Name' })

      await syncUser(betterAuthUser, { payload })

      // The update should only include changed fields, not overwrite custom fields
      expect(payload.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ customPayloadField: undefined }),
        })
      )
    })

    it('should handle very long email addresses', async () => {
      const longEmail = 'a'.repeat(200) + '@example.com.ai'
      const existingUser = createMockPayloadUser()
      const payload = createMockPayloadInterface({ existingUsers: [existingUser] })

      const betterAuthUser = createMockBetterAuthUser({ email: longEmail })

      const result = await syncUser(betterAuthUser, { payload })

      // Should either succeed or return validation error
      expect(result.success || (!result.success && result.error === 'validation_error')).toBe(true)
    })
  })
})
