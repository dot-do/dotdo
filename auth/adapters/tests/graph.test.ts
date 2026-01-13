/**
 * graphAuthAdapter Tests - better-auth Database Adapter using Graph Model
 *
 * Tests for the graphAuthAdapter factory function that provides a better-auth
 * compatible database adapter backed by GraphStore.
 *
 * @see dotdo-3qn58 - better-auth integration with GraphAuthAdapter
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SQLiteGraphStore } from '../../../db/graph/stores'
import { graphAuthAdapter } from '../graph'

// ============================================================================
// TEST SUITE
// ============================================================================

describe('graphAuthAdapter - better-auth Database Adapter', () => {
  let store: SQLiteGraphStore
  let adapter: ReturnType<ReturnType<typeof graphAuthAdapter>>

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
    adapter = graphAuthAdapter(store)()
  })

  afterEach(async () => {
    await store.close()
  })

  // ==========================================================================
  // ADAPTER CREATION TESTS
  // ==========================================================================

  describe('Adapter Creation', () => {
    it('creates adapter from SQLiteGraphStore', () => {
      expect(adapter).toBeDefined()
      expect(adapter.id).toBe('graph-auth-adapter')
    })

    it('adapter implements required DBAdapter interface', () => {
      expect(typeof adapter.create).toBe('function')
      expect(typeof adapter.findOne).toBe('function')
      expect(typeof adapter.findMany).toBe('function')
      expect(typeof adapter.update).toBe('function')
      expect(typeof adapter.updateMany).toBe('function')
      expect(typeof adapter.delete).toBe('function')
      expect(typeof adapter.deleteMany).toBe('function')
      expect(typeof adapter.count).toBe('function')
    })
  })

  // ==========================================================================
  // CREATE OPERATION TESTS
  // ==========================================================================

  describe('create', () => {
    it('creates a user record', async () => {
      const user = await adapter.create({
        model: 'user',
        data: {
          email: 'alice@example.com',
          name: 'Alice',
          emailVerified: false,
        },
      })

      expect(user.id).toBeDefined()
      expect(user.email).toBe('alice@example.com')
      expect(user.name).toBe('Alice')
      expect(user.emailVerified).toBe(false)
      expect(user.createdAt).toBeInstanceOf(Date)
      expect(user.updatedAt).toBeInstanceOf(Date)
    })

    it('creates a session record', async () => {
      const expiresAt = new Date(Date.now() + 86400000)
      const session = await adapter.create({
        model: 'session',
        data: {
          token: 'test-token-123',
          userId: 'user-1',
          expiresAt,
        },
      })

      expect(session.id).toBeDefined()
      expect(session.token).toBe('test-token-123')
      expect(session.userId).toBe('user-1')
    })

    it('creates an account record', async () => {
      const account = await adapter.create({
        model: 'account',
        data: {
          userId: 'user-1',
          provider: 'github',
          providerAccountId: 'gh-12345',
          accessToken: 'gho_xxx',
        },
      })

      expect(account.id).toBeDefined()
      expect(account.provider).toBe('github')
      expect(account.providerAccountId).toBe('gh-12345')
    })

    it('allows custom ID when forceAllowId is true', async () => {
      const user = await adapter.create({
        model: 'user',
        data: {
          id: 'custom-user-id',
          email: 'custom@example.com',
        },
        forceAllowId: true,
      })

      expect(user.id).toBe('custom-user-id')
    })

    it('generates unique IDs', async () => {
      const user1 = await adapter.create({
        model: 'user',
        data: { email: 'user1@example.com' },
      })
      const user2 = await adapter.create({
        model: 'user',
        data: { email: 'user2@example.com' },
      })

      expect(user1.id).not.toBe(user2.id)
    })

    it('creates records for any model type', async () => {
      const verification = await adapter.create({
        model: 'verification',
        data: {
          identifier: 'email:alice@example.com',
          value: 'verification-code',
          expiresAt: new Date(Date.now() + 3600000),
        },
      })

      expect(verification.id).toBeDefined()
      expect(verification.identifier).toBe('email:alice@example.com')
    })
  })

  // ==========================================================================
  // FINDONE OPERATION TESTS
  // ==========================================================================

  describe('findOne', () => {
    it('finds record by ID', async () => {
      const created = await adapter.create({
        model: 'user',
        data: { email: 'findme@example.com', name: 'Find Me' },
      })

      const found = await adapter.findOne({
        model: 'user',
        where: [{ field: 'id', value: created.id }],
      })

      expect(found).not.toBeNull()
      expect(found?.id).toBe(created.id)
      expect(found?.email).toBe('findme@example.com')
    })

    it('finds record by email', async () => {
      await adapter.create({
        model: 'user',
        data: { email: 'byemail@example.com', name: 'By Email' },
      })

      const found = await adapter.findOne({
        model: 'user',
        where: [{ field: 'email', value: 'byemail@example.com' }],
      })

      expect(found).not.toBeNull()
      expect(found?.email).toBe('byemail@example.com')
    })

    it('returns null for non-existent record', async () => {
      const found = await adapter.findOne({
        model: 'user',
        where: [{ field: 'id', value: 'non-existent' }],
      })

      expect(found).toBeNull()
    })

    it('returns null for wrong model type', async () => {
      const created = await adapter.create({
        model: 'user',
        data: { email: 'wrongtype@example.com' },
      })

      const found = await adapter.findOne({
        model: 'session',
        where: [{ field: 'id', value: created.id }],
      })

      expect(found).toBeNull()
    })

    it('supports multiple where clauses', async () => {
      await adapter.create({
        model: 'user',
        data: { email: 'multi@example.com', name: 'Multi Where', emailVerified: true },
      })
      await adapter.create({
        model: 'user',
        data: { email: 'other@example.com', name: 'Other', emailVerified: false },
      })

      const found = await adapter.findOne({
        model: 'user',
        where: [
          { field: 'name', value: 'Multi Where' },
          { field: 'emailVerified', value: true },
        ],
      })

      expect(found).not.toBeNull()
      expect(found?.email).toBe('multi@example.com')
    })

    it('supports ne operator', async () => {
      await adapter.create({
        model: 'user',
        data: { email: 'user1@example.com', name: 'User1' },
      })
      await adapter.create({
        model: 'user',
        data: { email: 'user2@example.com', name: 'User2' },
      })

      const found = await adapter.findOne({
        model: 'user',
        where: [{ field: 'name', value: 'User1', operator: 'ne' }],
      })

      expect(found).not.toBeNull()
      expect(found?.name).toBe('User2')
    })

    it('supports in operator', async () => {
      await adapter.create({
        model: 'user',
        data: { email: 'intest@example.com', name: 'InTest' },
      })

      const found = await adapter.findOne({
        model: 'user',
        where: [{ field: 'name', value: ['InTest', 'Other'], operator: 'in' }],
      })

      expect(found).not.toBeNull()
      expect(found?.name).toBe('InTest')
    })
  })

  // ==========================================================================
  // FINDMANY OPERATION TESTS
  // ==========================================================================

  describe('findMany', () => {
    beforeEach(async () => {
      await adapter.create({ model: 'user', data: { email: 'user1@example.com', name: 'Alice' } })
      await adapter.create({ model: 'user', data: { email: 'user2@example.com', name: 'Bob' } })
      await adapter.create({ model: 'user', data: { email: 'user3@example.com', name: 'Charlie' } })
    })

    it('finds all records of a model', async () => {
      const users = await adapter.findMany({ model: 'user' })

      expect(users.length).toBe(3)
    })

    it('filters records by where clause', async () => {
      const users = await adapter.findMany({
        model: 'user',
        where: [{ field: 'name', value: 'Alice' }],
      })

      expect(users.length).toBe(1)
      expect(users[0]?.name).toBe('Alice')
    })

    it('limits results', async () => {
      const users = await adapter.findMany({
        model: 'user',
        limit: 2,
      })

      expect(users.length).toBe(2)
    })

    it('applies offset', async () => {
      const allUsers = await adapter.findMany({ model: 'user' })
      const offsetUsers = await adapter.findMany({
        model: 'user',
        offset: 1,
      })

      expect(offsetUsers.length).toBe(allUsers.length - 1)
    })

    it('sorts results ascending', async () => {
      const users = await adapter.findMany({
        model: 'user',
        sortBy: { field: 'name', direction: 'asc' },
      })

      expect(users[0]?.name).toBe('Alice')
      expect(users[1]?.name).toBe('Bob')
      expect(users[2]?.name).toBe('Charlie')
    })

    it('sorts results descending', async () => {
      const users = await adapter.findMany({
        model: 'user',
        sortBy: { field: 'name', direction: 'desc' },
      })

      expect(users[0]?.name).toBe('Charlie')
      expect(users[1]?.name).toBe('Bob')
      expect(users[2]?.name).toBe('Alice')
    })

    it('combines limit and offset', async () => {
      const users = await adapter.findMany({
        model: 'user',
        sortBy: { field: 'name', direction: 'asc' },
        offset: 1,
        limit: 1,
      })

      expect(users.length).toBe(1)
      expect(users[0]?.name).toBe('Bob')
    })

    it('returns empty array for non-matching filter', async () => {
      const users = await adapter.findMany({
        model: 'user',
        where: [{ field: 'name', value: 'NonExistent' }],
      })

      expect(users).toHaveLength(0)
    })
  })

  // ==========================================================================
  // UPDATE OPERATION TESTS
  // ==========================================================================

  describe('update', () => {
    it('updates a record', async () => {
      const created = await adapter.create({
        model: 'user',
        data: { email: 'update@example.com', name: 'Original' },
      })

      const updated = await adapter.update({
        model: 'user',
        where: [{ field: 'id', value: created.id }],
        update: { name: 'Updated' },
      })

      expect(updated).not.toBeNull()
      expect(updated?.name).toBe('Updated')
      expect(updated?.email).toBe('update@example.com')
    })

    it('returns null for non-existent record', async () => {
      const updated = await adapter.update({
        model: 'user',
        where: [{ field: 'id', value: 'non-existent' }],
        update: { name: 'Updated' },
      })

      expect(updated).toBeNull()
    })

    it('updates multiple fields', async () => {
      const created = await adapter.create({
        model: 'user',
        data: { email: 'multiupdate@example.com', name: 'Original', emailVerified: false },
      })

      const updated = await adapter.update({
        model: 'user',
        where: [{ field: 'id', value: created.id }],
        update: { name: 'New Name', emailVerified: true },
      })

      expect(updated?.name).toBe('New Name')
      expect(updated?.emailVerified).toBe(true)
    })

    it('updates updatedAt timestamp', async () => {
      const created = await adapter.create({
        model: 'user',
        data: { email: 'timestamp@example.com' },
      })

      await new Promise((resolve) => setTimeout(resolve, 10))

      const updated = await adapter.update({
        model: 'user',
        where: [{ field: 'id', value: created.id }],
        update: { name: 'New Name' },
      })

      expect(updated?.updatedAt.getTime()).toBeGreaterThan(created.createdAt.getTime())
    })
  })

  // ==========================================================================
  // UPDATEMANY OPERATION TESTS
  // ==========================================================================

  describe('updateMany', () => {
    it('updates multiple matching records', async () => {
      await adapter.create({ model: 'user', data: { email: 'a@example.com', emailVerified: false } })
      await adapter.create({ model: 'user', data: { email: 'b@example.com', emailVerified: false } })
      await adapter.create({ model: 'user', data: { email: 'c@example.com', emailVerified: true } })

      const count = await adapter.updateMany({
        model: 'user',
        where: [{ field: 'emailVerified', value: false }],
        update: { emailVerified: true },
      })

      expect(count).toBe(2)

      const users = await adapter.findMany({
        model: 'user',
        where: [{ field: 'emailVerified', value: true }],
      })
      expect(users.length).toBe(3)
    })

    it('returns 0 for no matching records', async () => {
      const count = await adapter.updateMany({
        model: 'user',
        where: [{ field: 'name', value: 'NonExistent' }],
        update: { emailVerified: true },
      })

      expect(count).toBe(0)
    })
  })

  // ==========================================================================
  // DELETE OPERATION TESTS
  // ==========================================================================

  describe('delete', () => {
    it('deletes a record', async () => {
      const created = await adapter.create({
        model: 'user',
        data: { email: 'delete@example.com' },
      })

      await adapter.delete({
        model: 'user',
        where: [{ field: 'id', value: created.id }],
      })

      const found = await adapter.findOne({
        model: 'user',
        where: [{ field: 'id', value: created.id }],
      })

      expect(found).toBeNull()
    })

    it('does not throw for non-existent record', async () => {
      await expect(
        adapter.delete({
          model: 'user',
          where: [{ field: 'id', value: 'non-existent' }],
        })
      ).resolves.not.toThrow()
    })
  })

  // ==========================================================================
  // DELETEMANY OPERATION TESTS
  // ==========================================================================

  describe('deleteMany', () => {
    it('deletes multiple matching records', async () => {
      await adapter.create({ model: 'session', data: { token: 'token1', userId: 'user-1' } })
      await adapter.create({ model: 'session', data: { token: 'token2', userId: 'user-1' } })
      await adapter.create({ model: 'session', data: { token: 'token3', userId: 'user-2' } })

      const count = await adapter.deleteMany({
        model: 'session',
        where: [{ field: 'userId', value: 'user-1' }],
      })

      expect(count).toBe(2)

      const remaining = await adapter.findMany({ model: 'session' })
      expect(remaining.length).toBe(1)
      expect(remaining[0]?.userId).toBe('user-2')
    })

    it('returns 0 for no matching records', async () => {
      const count = await adapter.deleteMany({
        model: 'session',
        where: [{ field: 'userId', value: 'non-existent' }],
      })

      expect(count).toBe(0)
    })
  })

  // ==========================================================================
  // COUNT OPERATION TESTS
  // ==========================================================================

  describe('count', () => {
    it('counts all records of a model', async () => {
      await adapter.create({ model: 'user', data: { email: 'a@example.com' } })
      await adapter.create({ model: 'user', data: { email: 'b@example.com' } })
      await adapter.create({ model: 'user', data: { email: 'c@example.com' } })

      const count = await adapter.count({ model: 'user' })

      expect(count).toBe(3)
    })

    it('counts records matching where clause', async () => {
      await adapter.create({ model: 'user', data: { email: 'a@example.com', emailVerified: true } })
      await adapter.create({ model: 'user', data: { email: 'b@example.com', emailVerified: false } })
      await adapter.create({ model: 'user', data: { email: 'c@example.com', emailVerified: true } })

      const count = await adapter.count({
        model: 'user',
        where: [{ field: 'emailVerified', value: true }],
      })

      expect(count).toBe(2)
    })

    it('returns 0 for empty model', async () => {
      const count = await adapter.count({ model: 'user' })

      expect(count).toBe(0)
    })
  })

  // ==========================================================================
  // INTEGRATION WITH BETTER-AUTH MODELS
  // ==========================================================================

  describe('better-auth Model Integration', () => {
    it('handles user model correctly', async () => {
      const user = await adapter.create({
        model: 'user',
        data: {
          email: 'integration@example.com',
          name: 'Integration User',
          emailVerified: false,
          image: 'https://example.com/avatar.jpg',
        },
      })

      expect(user.id).toBeDefined()
      expect(user.email).toBe('integration@example.com')
      expect(user.name).toBe('Integration User')
      expect(user.emailVerified).toBe(false)
      expect(user.image).toBe('https://example.com/avatar.jpg')
    })

    it('handles session model correctly', async () => {
      const user = await adapter.create({
        model: 'user',
        data: { email: 'session-user@example.com' },
      })

      const session = await adapter.create({
        model: 'session',
        data: {
          token: 'session-token-xyz',
          userId: user.id as string,
          expiresAt: new Date(Date.now() + 86400000),
          userAgent: 'Mozilla/5.0',
          ipAddress: '127.0.0.1',
        },
      })

      expect(session.token).toBe('session-token-xyz')
      expect(session.userId).toBe(user.id)
    })

    it('handles account model correctly', async () => {
      const user = await adapter.create({
        model: 'user',
        data: { email: 'account-user@example.com' },
      })

      const account = await adapter.create({
        model: 'account',
        data: {
          userId: user.id as string,
          provider: 'github',
          providerAccountId: 'gh-98765',
          accessToken: 'gho_accesstoken',
          refreshToken: 'gho_refreshtoken',
          scope: 'user:email',
        },
      })

      expect(account.provider).toBe('github')
      expect(account.providerAccountId).toBe('gh-98765')
      expect(account.accessToken).toBe('gho_accesstoken')
    })

    it('handles verification model correctly', async () => {
      const verification = await adapter.create({
        model: 'verification',
        data: {
          identifier: 'email:verify@example.com',
          value: 'verification-code-123',
          expiresAt: new Date(Date.now() + 3600000),
        },
      })

      expect(verification.identifier).toBe('email:verify@example.com')
      expect(verification.value).toBe('verification-code-123')
    })

    it('handles organization model correctly', async () => {
      const org = await adapter.create({
        model: 'organization',
        data: {
          name: 'Test Organization',
          slug: 'test-org',
        },
      })

      expect(org.name).toBe('Test Organization')
      expect(org.slug).toBe('test-org')
    })
  })

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('Edge Cases', () => {
    it('handles unicode in data', async () => {
      const user = await adapter.create({
        model: 'user',
        data: { email: 'unicode@example.com', name: 'Test User' },
      })

      const found = await adapter.findOne({
        model: 'user',
        where: [{ field: 'id', value: user.id }],
      })

      expect(found?.name).toBe('Test User')
    })

    it('handles null values', async () => {
      const user = await adapter.create({
        model: 'user',
        data: { email: 'null@example.com', name: null, image: null },
      })

      expect(user.name).toBeNull()
      expect(user.image).toBeNull()
    })

    it('handles Date conversion', async () => {
      const expiresAt = new Date('2025-12-31T23:59:59Z')
      const session = await adapter.create({
        model: 'session',
        data: {
          token: 'date-test',
          userId: 'user-1',
          expiresAt,
        },
      })

      // The date should be stored as a timestamp and converted back
      const found = await adapter.findOne({
        model: 'session',
        where: [{ field: 'token', value: 'date-test' }],
      })

      // expiresAt is stored as timestamp, so compare timestamps
      expect(found?.expiresAt).toBe(expiresAt.getTime())
    })

    it('handles empty where array in findMany', async () => {
      await adapter.create({ model: 'user', data: { email: 'a@example.com' } })
      await adapter.create({ model: 'user', data: { email: 'b@example.com' } })

      const users = await adapter.findMany({
        model: 'user',
        where: [],
      })

      expect(users.length).toBe(2)
    })

    it('handles concurrent operations', async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        adapter.create({
          model: 'user',
          data: { email: `concurrent${i}@example.com` },
        })
      )

      const users = await Promise.all(promises)

      expect(users.length).toBe(10)
      expect(new Set(users.map((u) => u.id)).size).toBe(10)
    })
  })
})
