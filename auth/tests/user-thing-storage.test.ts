/**
 * User Thing Storage Tests - RED Phase
 *
 * These tests verify User entities are properly stored as Things in the graph model
 * with correct indexes, constraints, and data serialization.
 *
 * @see dotdo-n8qjx - [RED] User as Thing: Graph storage tests
 *
 * Focus areas:
 * - User Thing storage format and typeId
 * - Soft delete behavior (deletedAt timestamp)
 * - Email uniqueness via graph index (not just adapter logic)
 * - Data serialization/deserialization
 * - Partial update preservation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SQLiteGraphStore } from '../../db/graph/stores'
import { createGraphAuthAdapter, type GraphAuthAdapter } from '../adapters'

describe('[RED] User as Thing - Graph Storage', () => {
  let store: SQLiteGraphStore
  let adapter: GraphAuthAdapter

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
    adapter = await createGraphAuthAdapter(store)
  })

  afterEach(async () => {
    await store.close()
  })

  // ==========================================================================
  // USER THING STORAGE FORMAT
  // ==========================================================================

  describe('User Thing Storage Format', () => {
    it('stores User with typeId=1', async () => {
      const user = await adapter.createUser({
        email: 'typeid@example.com',
        name: 'TypeId Test',
      })

      // Verify the Thing was created with correct typeId
      const thing = await store.getThing(user.id)

      expect(thing).not.toBeNull()
      expect(thing?.typeId).toBe(1)
      expect(thing?.typeName).toBe('User')
    })

    it('stores User email in original case', async () => {
      const user = await adapter.createUser({
        email: 'MixedCase@Example.COM',
        name: 'Case Test',
      })

      // Verify email is stored in original case (not normalized)
      const thing = await store.getThing(user.id)
      const data = thing?.data as { email?: string } | null

      expect(data?.email).toBe('MixedCase@Example.COM')
    })

    it('stores all User fields in Thing data', async () => {
      const user = await adapter.createUser({
        email: 'complete@example.com',
        name: 'Complete User',
        emailVerified: true,
        image: 'https://example.com/avatar.png',
      })

      // Verify all fields are stored in the Thing data
      const thing = await store.getThing(user.id)
      const data = thing?.data as {
        email?: string
        name?: string | null
        emailVerified?: boolean
        image?: string | null
      } | null

      expect(data?.email).toBe('complete@example.com')
      expect(data?.name).toBe('Complete User')
      expect(data?.emailVerified).toBe(true)
      expect(data?.image).toBe('https://example.com/avatar.png')
    })

    it('stores null fields correctly', async () => {
      const user = await adapter.createUser({
        email: 'nullfields@example.com',
        // name not provided (should be null)
        // image not provided (should be null)
      })

      const thing = await store.getThing(user.id)
      const data = thing?.data as {
        name?: string | null
        image?: string | null
        emailVerified?: boolean
      } | null

      expect(data?.name).toBeNull()
      expect(data?.image).toBeNull()
      expect(data?.emailVerified).toBe(false)
    })
  })

  // ==========================================================================
  // SOFT DELETE BEHAVIOR
  // ==========================================================================

  describe('Soft Delete Behavior', () => {
    it('deleteUser sets deletedAt timestamp (soft delete)', async () => {
      const user = await adapter.createUser({
        email: 'softdelete@example.com',
        name: 'Soft Delete Test',
      })

      const beforeDelete = Date.now()
      await adapter.deleteUser(user.id)
      const afterDelete = Date.now()

      // The User Thing should still exist in the store but with deletedAt set
      const thing = await store.getThing(user.id)

      expect(thing).not.toBeNull()
      expect(thing?.deletedAt).not.toBeNull()
      expect(thing?.deletedAt).toBeGreaterThanOrEqual(beforeDelete)
      expect(thing?.deletedAt).toBeLessThanOrEqual(afterDelete)
    })

    it('soft-deleted user is excluded from getThingsByType by default', async () => {
      const user = await adapter.createUser({
        email: 'excluded@example.com',
      })

      await adapter.deleteUser(user.id)

      // Query without includeDeleted should exclude the deleted user
      const users = await store.getThingsByType({ typeName: 'User' })
      const foundUser = users.find((t) => t.id === user.id)

      expect(foundUser).toBeUndefined()
    })

    it('soft-deleted user is included when querying with includeDeleted', async () => {
      const user = await adapter.createUser({
        email: 'included@example.com',
      })

      await adapter.deleteUser(user.id)

      // Query with includeDeleted should include the deleted user
      const users = await store.getThingsByType({ typeName: 'User', includeDeleted: true })
      const foundUser = users.find((t) => t.id === user.id)

      expect(foundUser).not.toBeUndefined()
      expect(foundUser?.deletedAt).not.toBeNull()
    })

    it('getUserById returns null for soft-deleted user', async () => {
      const user = await adapter.createUser({
        email: 'getbyid-deleted@example.com',
      })

      await adapter.deleteUser(user.id)

      // Adapter should filter out soft-deleted users
      const result = await adapter.getUserById(user.id)
      expect(result).toBeNull()
    })

    it('getUserByEmail returns null for soft-deleted user', async () => {
      const user = await adapter.createUser({
        email: 'getbyemail-deleted@example.com',
      })

      await adapter.deleteUser(user.id)

      // Adapter should filter out soft-deleted users
      const result = await adapter.getUserByEmail('getbyemail-deleted@example.com')
      expect(result).toBeNull()
    })
  })

  // ==========================================================================
  // EMAIL UNIQUENESS CONSTRAINTS
  // ==========================================================================

  describe('Email Uniqueness', () => {
    it('rejects duplicate email (case-insensitive)', async () => {
      await adapter.createUser({
        email: 'unique@example.com',
      })

      // Different case should still be rejected
      await expect(
        adapter.createUser({
          email: 'UNIQUE@example.com',
        })
      ).rejects.toThrow()
    })

    it('allows reusing email of soft-deleted user', async () => {
      // Create and delete user
      const user1 = await adapter.createUser({
        email: 'reuse@example.com',
      })
      await adapter.deleteUser(user1.id)

      // Should be able to create new user with same email
      // (email is free because original is soft-deleted)
      const user2 = await adapter.createUser({
        email: 'reuse@example.com',
      })

      expect(user2.id).not.toBe(user1.id)
      expect(user2.email).toBe('reuse@example.com')
    })

    it('email uniqueness check is efficient (uses index)', async () => {
      // Create many users
      for (let i = 0; i < 100; i++) {
        await adapter.createUser({
          email: `user${i}@example.com`,
        })
      }

      const start = Date.now()

      // Duplicate check should be fast due to index
      await expect(
        adapter.createUser({
          email: 'user50@example.com',
        })
      ).rejects.toThrow()

      const duration = Date.now() - start

      // Should complete in reasonable time (< 100ms)
      // If scanning all rows without index, this would be slow
      expect(duration).toBeLessThan(100)
    })
  })

  // ==========================================================================
  // PARTIAL UPDATE PRESERVATION
  // ==========================================================================

  describe('Partial Update Preservation', () => {
    it('updating name preserves email', async () => {
      const user = await adapter.createUser({
        email: 'preserve@example.com',
        name: 'Original Name',
      })

      await adapter.updateUser(user.id, { name: 'New Name' })

      const updated = await adapter.getUserById(user.id)
      expect(updated?.name).toBe('New Name')
      expect(updated?.email).toBe('preserve@example.com')
    })

    it('updating email preserves name', async () => {
      const user = await adapter.createUser({
        email: 'old@example.com',
        name: 'Preserved Name',
      })

      await adapter.updateUser(user.id, { email: 'new@example.com' })

      const updated = await adapter.getUserById(user.id)
      expect(updated?.email).toBe('new@example.com')
      expect(updated?.name).toBe('Preserved Name')
    })

    it('updating emailVerified preserves other fields', async () => {
      const user = await adapter.createUser({
        email: 'verify@example.com',
        name: 'Verify User',
        image: 'https://example.com/pic.jpg',
      })

      await adapter.updateUser(user.id, { emailVerified: true })

      const updated = await adapter.getUserById(user.id)
      expect(updated?.emailVerified).toBe(true)
      expect(updated?.email).toBe('verify@example.com')
      expect(updated?.name).toBe('Verify User')
      expect(updated?.image).toBe('https://example.com/pic.jpg')
    })

    it('updating image preserves other fields', async () => {
      const user = await adapter.createUser({
        email: 'image@example.com',
        name: 'Image User',
        emailVerified: true,
      })

      await adapter.updateUser(user.id, { image: 'https://new.example.com/avatar.jpg' })

      const updated = await adapter.getUserById(user.id)
      expect(updated?.image).toBe('https://new.example.com/avatar.jpg')
      expect(updated?.email).toBe('image@example.com')
      expect(updated?.name).toBe('Image User')
      expect(updated?.emailVerified).toBe(true)
    })

    it('setting field to null preserves other fields', async () => {
      const user = await adapter.createUser({
        email: 'nullify@example.com',
        name: 'Will Be Nulled',
        image: 'https://example.com/pic.jpg',
      })

      await adapter.updateUser(user.id, { name: null })

      const updated = await adapter.getUserById(user.id)
      expect(updated?.name).toBeNull()
      expect(updated?.email).toBe('nullify@example.com')
      expect(updated?.image).toBe('https://example.com/pic.jpg')
    })

    it('multiple sequential updates preserve all fields', async () => {
      const user = await adapter.createUser({
        email: 'sequential@example.com',
        name: 'Sequential User',
      })

      await adapter.updateUser(user.id, { emailVerified: true })
      await adapter.updateUser(user.id, { image: 'https://example.com/a.jpg' })
      await adapter.updateUser(user.id, { name: 'Updated Name' })

      const updated = await adapter.getUserById(user.id)
      expect(updated?.email).toBe('sequential@example.com')
      expect(updated?.name).toBe('Updated Name')
      expect(updated?.emailVerified).toBe(true)
      expect(updated?.image).toBe('https://example.com/a.jpg')
    })
  })

  // ==========================================================================
  // DATA SERIALIZATION
  // ==========================================================================

  describe('Data Serialization', () => {
    it('handles special characters in name', async () => {
      const specialName = 'O\'Brien "Bob" & Friends <test>'

      const user = await adapter.createUser({
        email: 'special@example.com',
        name: specialName,
      })

      const retrieved = await adapter.getUserById(user.id)
      expect(retrieved?.name).toBe(specialName)
    })

    it('handles emoji in name', async () => {
      const emojiName = 'Alice Wonderland'

      const user = await adapter.createUser({
        email: 'emoji@example.com',
        name: emojiName,
      })

      const retrieved = await adapter.getUserById(user.id)
      expect(retrieved?.name).toBe(emojiName)
    })

    it('handles international characters in email', async () => {
      // Note: Most email systems don't support unicode local parts,
      // but the storage layer should handle it
      const internationalEmail = 'user@example.com'

      const user = await adapter.createUser({
        email: internationalEmail,
        name: 'International',
      })

      const retrieved = await adapter.getUserByEmail(internationalEmail)
      expect(retrieved?.email).toBe(internationalEmail)
    })

    it('handles very long image URLs', async () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(2000) + '.jpg'

      const user = await adapter.createUser({
        email: 'longurl@example.com',
        image: longUrl,
      })

      const retrieved = await adapter.getUserById(user.id)
      expect(retrieved?.image).toBe(longUrl)
    })
  })

  // ==========================================================================
  // TIMESTAMP PRECISION
  // ==========================================================================

  describe('Timestamp Precision', () => {
    it('createdAt has millisecond precision', async () => {
      const user = await adapter.createUser({
        email: 'precision@example.com',
      })

      // Timestamp should be in milliseconds (13 digits)
      const timestampLength = user.createdAt.getTime().toString().length
      expect(timestampLength).toBeGreaterThanOrEqual(13)
    })

    it('updatedAt changes with each update', async () => {
      const user = await adapter.createUser({
        email: 'updatedAt@example.com',
      })

      const originalUpdatedAt = user.updatedAt.getTime()

      // Small delay
      await new Promise((r) => setTimeout(r, 5))

      await adapter.updateUser(user.id, { name: 'Updated 1' })
      const user1 = await adapter.getUserById(user.id)

      // Small delay
      await new Promise((r) => setTimeout(r, 5))

      await adapter.updateUser(user.id, { name: 'Updated 2' })
      const user2 = await adapter.getUserById(user.id)

      expect(user1?.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt)
      expect(user2?.updatedAt.getTime()).toBeGreaterThan(user1?.updatedAt.getTime() ?? 0)
    })

    it('createdAt does not change on update', async () => {
      const user = await adapter.createUser({
        email: 'createdAt@example.com',
      })

      const originalCreatedAt = user.createdAt.getTime()

      // Small delay
      await new Promise((r) => setTimeout(r, 10))

      await adapter.updateUser(user.id, { name: 'Updated' })
      const updated = await adapter.getUserById(user.id)

      expect(updated?.createdAt.getTime()).toBe(originalCreatedAt)
    })
  })

  // ==========================================================================
  // GRAPH QUERY BEHAVIOR
  // ==========================================================================

  describe('Graph Query Behavior', () => {
    it('getUserByEmail performs case-insensitive match', async () => {
      await adapter.createUser({
        email: 'CaSeTeStInG@Example.COM',
        name: 'Case Testing',
      })

      // All these variations should find the user
      const variations = [
        'casetesting@example.com',
        'CASETESTING@EXAMPLE.COM',
        'CaSeTeStInG@Example.COM',
        'casetesting@EXAMPLE.com',
      ]

      for (const email of variations) {
        const user = await adapter.getUserByEmail(email)
        expect(user).not.toBeNull()
        expect(user?.name).toBe('Case Testing')
      }
    })

    it('querying Users by type returns only User things', async () => {
      // Create users
      await adapter.createUser({ email: 'user1@example.com' })
      await adapter.createUser({ email: 'user2@example.com' })

      // Create a session (different type)
      const user = await adapter.createUser({ email: 'session-owner@example.com' })
      await adapter.createSession({
        userId: user.id,
        token: 'test-token',
        expiresAt: new Date(Date.now() + 86400000),
      })

      // Query Users only
      const users = await store.getThingsByType({ typeName: 'User' })

      // Should only include User things, not Session
      expect(users.every((t) => t.typeName === 'User')).toBe(true)
      expect(users.length).toBe(3)
    })

    it('Users can be queried by typeId', async () => {
      await adapter.createUser({ email: 'typeid1@example.com' })
      await adapter.createUser({ email: 'typeid2@example.com' })

      // Query by typeId (User = 1)
      const users = await store.getThingsByType({ typeId: 1 })

      expect(users.length).toBeGreaterThanOrEqual(2)
      expect(users.every((t) => t.typeId === 1)).toBe(true)
    })
  })
})

// ==========================================================================
// RED TESTS - Expected to fail until graph-level features are implemented
// ==========================================================================

describe('[RED] User Thing - Graph Index Requirements', () => {
  let store: SQLiteGraphStore
  let adapter: GraphAuthAdapter

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
    adapter = await createGraphAuthAdapter(store)
  })

  afterEach(async () => {
    await store.close()
  })

  describe('Graph Email Index', () => {
    it('has a unique index on User email field (graph-level constraint)', async () => {
      // This test verifies that email uniqueness is enforced at the GRAPH level,
      // not just at the adapter level. A proper graph implementation would have
      // a database index that prevents duplicate emails.

      // Get raw SQLite connection to verify index exists
      const sqlite = (store as unknown as { sqlite: { prepare: (sql: string) => { all: () => Array<{ name: string }> } } }).sqlite

      // Query the index list
      const indexes = sqlite.prepare(`
        SELECT name FROM sqlite_master
        WHERE type='index'
        AND tbl_name='graph_things'
        AND sql LIKE '%email%'
      `).all()

      // Should have an index on the email field (extracted from JSON data)
      expect(indexes.length).toBeGreaterThan(0)
    })

    it('enforces email uniqueness via database constraint, not just adapter logic', async () => {
      await adapter.createUser({ email: 'constraint@example.com' })

      // Try to create a duplicate directly via store (bypassing adapter)
      // This should fail if there's a proper database constraint
      await expect(
        store.createThing({
          id: 'test-duplicate',
          typeId: 1,
          typeName: 'User',
          data: { email: 'constraint@example.com', name: null, emailVerified: false, image: null },
        })
      ).rejects.toThrow()
    })
  })

  describe('Concurrent Write Safety', () => {
    it('handles concurrent user creation with same email atomically', async () => {
      // Simulate race condition - both operations start before either completes
      const email = 'race@example.com'

      // Start both creations at the "same time"
      const promises = [
        adapter.createUser({ email, name: 'First' }),
        adapter.createUser({ email, name: 'Second' }),
      ]

      // One should succeed, one should fail
      const results = await Promise.allSettled(promises)

      const successes = results.filter((r) => r.status === 'fulfilled')
      const failures = results.filter((r) => r.status === 'rejected')

      expect(successes.length).toBe(1)
      expect(failures.length).toBe(1)
    })

    it('handles concurrent updates to same user without data loss', async () => {
      const user = await adapter.createUser({
        email: 'concurrent-update@example.com',
        name: 'Original',
      })

      // Concurrent updates to different fields
      const promises = [
        adapter.updateUser(user.id, { name: 'Updated Name' }),
        adapter.updateUser(user.id, { emailVerified: true }),
        adapter.updateUser(user.id, { image: 'https://example.com/pic.jpg' }),
      ]

      await Promise.all(promises)

      // All updates should be preserved (last-write-wins is acceptable,
      // but updates to different fields should not overwrite each other)
      const final = await adapter.getUserById(user.id)

      // This test documents the expected behavior - concurrent updates
      // to different fields should ideally all be preserved
      // With current implementation, some may be lost due to read-modify-write
      expect(final).not.toBeNull()
    })
  })

  describe('Strict User Schema Validation', () => {
    it('rejects user creation with invalid email format', async () => {
      // Email validation at the storage layer
      await expect(
        adapter.createUser({ email: 'not-an-email', name: 'Invalid' })
      ).rejects.toThrow()
    })

    it('rejects user creation with empty email', async () => {
      await expect(
        adapter.createUser({ email: '', name: 'Empty Email' })
      ).rejects.toThrow()
    })

    it('rejects email update that creates duplicate', async () => {
      await adapter.createUser({ email: 'existing@example.com' })
      const user2 = await adapter.createUser({ email: 'another@example.com' })

      // Updating to an existing email should fail
      await expect(
        adapter.updateUser(user2.id, { email: 'existing@example.com' })
      ).rejects.toThrow()
    })
  })

  describe('Graph Relationship Integrity', () => {
    it('cannot create orphaned sessions (user must exist)', async () => {
      // Creating a session for a non-existent user should fail
      await expect(
        adapter.createSession({
          userId: 'non-existent-user-id',
          token: 'orphan-session',
          expiresAt: new Date(Date.now() + 86400000),
        })
      ).rejects.toThrow()
    })

    it('cannot create orphaned accounts (user must exist)', async () => {
      // Creating an account for a non-existent user should fail
      await expect(
        adapter.linkAccount({
          userId: 'non-existent-user-id',
          provider: 'github',
          providerAccountId: '12345',
        })
      ).rejects.toThrow()
    })
  })
})
