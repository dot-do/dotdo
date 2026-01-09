import { describe, it, expect, beforeEach } from 'vitest'
import { createPayloadAdapterHarness } from '../../../src'
import type { PayloadAdapterHarness } from '../../../src'

/**
 * PayloadAdapter Transaction Tests
 *
 * These tests verify transaction operations: begin, commit, and rollback.
 *
 * Transactions in dotdo/Payload adapter context:
 * - Map to SQLite transactions under the hood
 * - Provide atomic operations across multiple creates/updates/deletes
 * - Support isolation for concurrent operations
 * - Enable rollback on failures
 *
 * Reference: dotdo-azuf - A27 RED: Transaction tests
 *
 * This is RED phase TDD - tests should FAIL until transactions are implemented.
 */

// ============================================================================
// BASIC TRANSACTION LIFECYCLE TESTS
// ============================================================================

describe('PayloadAdapter Transactions', () => {
  let harness: PayloadAdapterHarness

  beforeEach(() => {
    harness = createPayloadAdapterHarness({
      namespace: 'https://test.do',
    })
  })

  describe('transaction lifecycle', () => {
    it('should expose beginTransaction method', () => {
      const adapter = harness.adapter as any

      expect(adapter.beginTransaction).toBeDefined()
      expect(typeof adapter.beginTransaction).toBe('function')
    })

    it('should expose commitTransaction method', () => {
      const adapter = harness.adapter as any

      expect(adapter.commitTransaction).toBeDefined()
      expect(typeof adapter.commitTransaction).toBe('function')
    })

    it('should expose rollbackTransaction method', () => {
      const adapter = harness.adapter as any

      expect(adapter.rollbackTransaction).toBeDefined()
      expect(typeof adapter.rollbackTransaction).toBe('function')
    })

    it('should return a transaction object from beginTransaction', async () => {
      const adapter = harness.adapter as any

      const tx = await adapter.beginTransaction()

      expect(tx).toBeDefined()
      expect(tx.id).toBeDefined()
      expect(typeof tx.id).toBe('string')
    })

    it('should track active transaction state', async () => {
      const adapter = harness.adapter as any

      expect(adapter.activeTransaction).toBeUndefined()

      const tx = await adapter.beginTransaction()

      expect(adapter.activeTransaction).toBeDefined()
      expect(adapter.activeTransaction.id).toBe(tx.id)
    })

    it('should clear active transaction on commit', async () => {
      const adapter = harness.adapter as any

      const tx = await adapter.beginTransaction()
      expect(adapter.activeTransaction).toBeDefined()

      await adapter.commitTransaction(tx)

      expect(adapter.activeTransaction).toBeUndefined()
    })

    it('should clear active transaction on rollback', async () => {
      const adapter = harness.adapter as any

      const tx = await adapter.beginTransaction()
      expect(adapter.activeTransaction).toBeDefined()

      await adapter.rollbackTransaction(tx)

      expect(adapter.activeTransaction).toBeUndefined()
    })
  })

  // ============================================================================
  // TRANSACTION CREATE TESTS
  // ============================================================================

  describe('create within transaction', () => {
    it('should create document within transaction', async () => {
      const adapter = harness.adapter as any

      const tx = await adapter.beginTransaction()

      const result = await adapter.create({
        collection: 'posts',
        data: {
          title: 'Transaction Post',
          slug: 'transaction-post',
        },
        transaction: tx,
      })

      expect(result).toBeDefined()
      expect(result.id).toBeDefined()
      expect(result.title).toBe('Transaction Post')

      await adapter.commitTransaction(tx)
    })

    it('should not persist create until commit', async () => {
      const adapter = harness.adapter as any

      const tx = await adapter.beginTransaction()

      // Create within transaction
      const created = await adapter.create({
        collection: 'posts',
        data: {
          title: 'Uncommitted Post',
          slug: 'uncommitted-post',
        },
        transaction: tx,
      })

      // Query outside transaction should not see the document
      const found = await adapter.findOne({
        collection: 'posts',
        id: created.id,
      })

      expect(found).toBeNull()

      await adapter.rollbackTransaction(tx)
    })

    it('should persist create after commit', async () => {
      const adapter = harness.adapter as any

      const tx = await adapter.beginTransaction()

      const created = await adapter.create({
        collection: 'posts',
        data: {
          title: 'Committed Post',
          slug: 'committed-post',
        },
        transaction: tx,
      })

      await adapter.commitTransaction(tx)

      // Now the document should be visible
      const found = await adapter.findOne({
        collection: 'posts',
        id: created.id,
      })

      expect(found).toBeDefined()
      expect(found?.title).toBe('Committed Post')
    })

    it('should discard create on rollback', async () => {
      const adapter = harness.adapter as any

      const tx = await adapter.beginTransaction()

      const created = await adapter.create({
        collection: 'posts',
        data: {
          title: 'Rolled Back Post',
          slug: 'rolled-back-post',
        },
        transaction: tx,
      })

      await adapter.rollbackTransaction(tx)

      // Document should not exist
      const found = await adapter.findOne({
        collection: 'posts',
        id: created.id,
      })

      expect(found).toBeNull()
    })
  })

  // ============================================================================
  // TRANSACTION UPDATE TESTS
  // ============================================================================

  describe('update within transaction', () => {
    it('should update document within transaction', async () => {
      const adapter = harness.adapter as any

      // First create a document outside transaction
      const created = await adapter.create({
        collection: 'posts',
        data: {
          title: 'Original Title',
          slug: 'original-title',
        },
      })

      const tx = await adapter.beginTransaction()

      const updated = await adapter.updateOne({
        collection: 'posts',
        id: created.id,
        data: { title: 'Updated Title' },
        transaction: tx,
      })

      expect(updated.title).toBe('Updated Title')

      await adapter.commitTransaction(tx)
    })

    it('should not persist update until commit', async () => {
      const adapter = harness.adapter as any

      const created = await adapter.create({
        collection: 'posts',
        data: {
          title: 'Original Title',
          slug: 'original-title',
        },
      })

      const tx = await adapter.beginTransaction()

      await adapter.updateOne({
        collection: 'posts',
        id: created.id,
        data: { title: 'Updated Title' },
        transaction: tx,
      })

      // Query outside transaction should see original value
      const found = await adapter.findOne({
        collection: 'posts',
        id: created.id,
      })

      expect(found?.title).toBe('Original Title')

      await adapter.rollbackTransaction(tx)
    })

    it('should persist update after commit', async () => {
      const adapter = harness.adapter as any

      const created = await adapter.create({
        collection: 'posts',
        data: {
          title: 'Original Title',
          slug: 'original-title',
        },
      })

      const tx = await adapter.beginTransaction()

      await adapter.updateOne({
        collection: 'posts',
        id: created.id,
        data: { title: 'Committed Update' },
        transaction: tx,
      })

      await adapter.commitTransaction(tx)

      const found = await adapter.findOne({
        collection: 'posts',
        id: created.id,
      })

      expect(found?.title).toBe('Committed Update')
    })

    it('should revert update on rollback', async () => {
      const adapter = harness.adapter as any

      const created = await adapter.create({
        collection: 'posts',
        data: {
          title: 'Original Title',
          slug: 'original-title',
        },
      })

      const tx = await adapter.beginTransaction()

      await adapter.updateOne({
        collection: 'posts',
        id: created.id,
        data: { title: 'Should Be Reverted' },
        transaction: tx,
      })

      await adapter.rollbackTransaction(tx)

      const found = await adapter.findOne({
        collection: 'posts',
        id: created.id,
      })

      expect(found?.title).toBe('Original Title')
    })
  })

  // ============================================================================
  // TRANSACTION DELETE TESTS
  // ============================================================================

  describe('delete within transaction', () => {
    it('should delete document within transaction', async () => {
      const adapter = harness.adapter as any

      const created = await adapter.create({
        collection: 'posts',
        data: {
          title: 'To Be Deleted',
          slug: 'to-be-deleted',
        },
      })

      const tx = await adapter.beginTransaction()

      await adapter.deleteOne({
        collection: 'posts',
        id: created.id,
        transaction: tx,
      })

      await adapter.commitTransaction(tx)

      const found = await adapter.findOne({
        collection: 'posts',
        id: created.id,
      })

      expect(found).toBeNull()
    })

    it('should not persist delete until commit', async () => {
      const adapter = harness.adapter as any

      const created = await adapter.create({
        collection: 'posts',
        data: {
          title: 'Still Exists',
          slug: 'still-exists',
        },
      })

      const tx = await adapter.beginTransaction()

      await adapter.deleteOne({
        collection: 'posts',
        id: created.id,
        transaction: tx,
      })

      // Query outside transaction should still see document
      const found = await adapter.findOne({
        collection: 'posts',
        id: created.id,
      })

      expect(found).toBeDefined()
      expect(found?.title).toBe('Still Exists')

      await adapter.rollbackTransaction(tx)
    })

    it('should restore document on rollback', async () => {
      const adapter = harness.adapter as any

      const created = await adapter.create({
        collection: 'posts',
        data: {
          title: 'Restored After Rollback',
          slug: 'restored-after-rollback',
        },
      })

      const tx = await adapter.beginTransaction()

      await adapter.deleteOne({
        collection: 'posts',
        id: created.id,
        transaction: tx,
      })

      await adapter.rollbackTransaction(tx)

      const found = await adapter.findOne({
        collection: 'posts',
        id: created.id,
      })

      expect(found).toBeDefined()
      expect(found?.title).toBe('Restored After Rollback')
    })
  })

  // ============================================================================
  // MULTI-OPERATION TRANSACTION TESTS
  // ============================================================================

  describe('multi-operation transactions', () => {
    it('should handle multiple creates in one transaction', async () => {
      const adapter = harness.adapter as any

      const tx = await adapter.beginTransaction()

      const post1 = await adapter.create({
        collection: 'posts',
        data: { title: 'Post 1', slug: 'post-1' },
        transaction: tx,
      })

      const post2 = await adapter.create({
        collection: 'posts',
        data: { title: 'Post 2', slug: 'post-2' },
        transaction: tx,
      })

      const post3 = await adapter.create({
        collection: 'posts',
        data: { title: 'Post 3', slug: 'post-3' },
        transaction: tx,
      })

      await adapter.commitTransaction(tx)

      const result = await adapter.find({ collection: 'posts' })
      expect(result.docs).toHaveLength(3)
    })

    it('should rollback all operations on multi-operation rollback', async () => {
      const adapter = harness.adapter as any

      const tx = await adapter.beginTransaction()

      await adapter.create({
        collection: 'posts',
        data: { title: 'Post 1', slug: 'post-1' },
        transaction: tx,
      })

      await adapter.create({
        collection: 'posts',
        data: { title: 'Post 2', slug: 'post-2' },
        transaction: tx,
      })

      await adapter.rollbackTransaction(tx)

      const result = await adapter.find({ collection: 'posts' })
      expect(result.docs).toHaveLength(0)
    })

    it('should handle create, update, delete in one transaction', async () => {
      const adapter = harness.adapter as any

      // Setup: create initial documents
      const existing = await adapter.create({
        collection: 'posts',
        data: { title: 'Existing Post', slug: 'existing-post' },
      })

      const toDelete = await adapter.create({
        collection: 'posts',
        data: { title: 'To Delete', slug: 'to-delete' },
      })

      const tx = await adapter.beginTransaction()

      // Create new
      await adapter.create({
        collection: 'posts',
        data: { title: 'New Post', slug: 'new-post' },
        transaction: tx,
      })

      // Update existing
      await adapter.updateOne({
        collection: 'posts',
        id: existing.id,
        data: { title: 'Updated Existing' },
        transaction: tx,
      })

      // Delete
      await adapter.deleteOne({
        collection: 'posts',
        id: toDelete.id,
        transaction: tx,
      })

      await adapter.commitTransaction(tx)

      const result = await adapter.find({ collection: 'posts' })
      expect(result.docs).toHaveLength(2)

      const titles = result.docs.map((d: any) => d.title)
      expect(titles).toContain('Updated Existing')
      expect(titles).toContain('New Post')
      expect(titles).not.toContain('To Delete')
    })
  })

  // ============================================================================
  // TRANSACTION ISOLATION TESTS
  // ============================================================================

  describe('transaction isolation', () => {
    it('should prevent nested transactions', async () => {
      const adapter = harness.adapter as any

      const tx1 = await adapter.beginTransaction()

      await expect(adapter.beginTransaction()).rejects.toThrow(/already active|nested/i)

      await adapter.rollbackTransaction(tx1)
    })

    it('should reject operations with invalid transaction', async () => {
      const adapter = harness.adapter as any

      const tx = await adapter.beginTransaction()
      await adapter.commitTransaction(tx)

      // Using committed transaction should fail
      await expect(
        adapter.create({
          collection: 'posts',
          data: { title: 'Invalid', slug: 'invalid' },
          transaction: tx,
        })
      ).rejects.toThrow(/invalid|expired|committed/i)
    })

    it('should query within transaction see uncommitted changes', async () => {
      const adapter = harness.adapter as any

      const tx = await adapter.beginTransaction()

      const created = await adapter.create({
        collection: 'posts',
        data: { title: 'Visible Within Tx', slug: 'visible-within-tx' },
        transaction: tx,
      })

      // Query within same transaction should see the change
      const found = await adapter.findOne({
        collection: 'posts',
        id: created.id,
        transaction: tx,
      })

      expect(found).toBeDefined()
      expect(found?.title).toBe('Visible Within Tx')

      await adapter.rollbackTransaction(tx)
    })
  })

  // ============================================================================
  // TRANSACTION ERROR HANDLING TESTS
  // ============================================================================

  describe('transaction error handling', () => {
    it('should auto-rollback on unhandled error', async () => {
      const adapter = harness.adapter as any

      const tx = await adapter.beginTransaction()

      await adapter.create({
        collection: 'posts',
        data: { title: 'Before Error', slug: 'before-error' },
        transaction: tx,
      })

      // Simulate an error in the adapter
      try {
        await adapter.create({
          collection: 'posts',
          data: { id: 'before-error', title: 'Duplicate', slug: 'duplicate' },
          transaction: tx,
        })
        // Force failure to continue
        throw new Error('Simulated error')
      } catch {
        await adapter.rollbackTransaction(tx)
      }

      // First create should be rolled back too
      const result = await adapter.find({ collection: 'posts' })
      expect(result.docs).toHaveLength(0)
    })

    it('should throw error if commit called on rolled back transaction', async () => {
      const adapter = harness.adapter as any

      const tx = await adapter.beginTransaction()
      await adapter.rollbackTransaction(tx)

      await expect(adapter.commitTransaction(tx)).rejects.toThrow(/invalid|rolled back|not active/i)
    })

    it('should throw error if rollback called on committed transaction', async () => {
      const adapter = harness.adapter as any

      const tx = await adapter.beginTransaction()
      await adapter.commitTransaction(tx)

      await expect(adapter.rollbackTransaction(tx)).rejects.toThrow(/invalid|committed|not active/i)
    })

    it('should throw error if rollback called twice', async () => {
      const adapter = harness.adapter as any

      const tx = await adapter.beginTransaction()
      await adapter.rollbackTransaction(tx)

      await expect(adapter.rollbackTransaction(tx)).rejects.toThrow(/invalid|already|not active/i)
    })
  })

  // ============================================================================
  // TRANSACTION CALLBACK STYLE TESTS
  // ============================================================================

  describe('transaction callback style', () => {
    it('should support transaction callback style', async () => {
      const adapter = harness.adapter as any

      expect(adapter.transaction).toBeDefined()
      expect(typeof adapter.transaction).toBe('function')
    })

    it('should auto-commit on successful callback', async () => {
      const adapter = harness.adapter as any

      await adapter.transaction(async (tx: any) => {
        await adapter.create({
          collection: 'posts',
          data: { title: 'Auto Commit', slug: 'auto-commit' },
          transaction: tx,
        })
      })

      const result = await adapter.find({ collection: 'posts' })
      expect(result.docs).toHaveLength(1)
    })

    it('should auto-rollback on callback error', async () => {
      const adapter = harness.adapter as any

      await expect(
        adapter.transaction(async (tx: any) => {
          await adapter.create({
            collection: 'posts',
            data: { title: 'Will Rollback', slug: 'will-rollback' },
            transaction: tx,
          })
          throw new Error('Callback error')
        })
      ).rejects.toThrow('Callback error')

      const result = await adapter.find({ collection: 'posts' })
      expect(result.docs).toHaveLength(0)
    })

    it('should return callback result on success', async () => {
      const adapter = harness.adapter as any

      const result = await adapter.transaction(async (tx: any) => {
        const created = await adapter.create({
          collection: 'posts',
          data: { title: 'Return Value', slug: 'return-value' },
          transaction: tx,
        })
        return created
      })

      expect(result).toBeDefined()
      expect(result.title).toBe('Return Value')
    })
  })

  // ============================================================================
  // CROSS-COLLECTION TRANSACTION TESTS
  // ============================================================================

  describe('cross-collection transactions', () => {
    it('should handle operations across multiple collections', async () => {
      const adapter = harness.adapter as any

      const tx = await adapter.beginTransaction()

      // Create user
      const user = await adapter.create({
        collection: 'users',
        data: { name: 'Author', email: 'author@test.com' },
        transaction: tx,
      })

      // Create post with author relationship
      const post = await adapter.create({
        collection: 'posts',
        data: {
          title: 'Cross Collection Post',
          slug: 'cross-collection-post',
          author: user.id,
        },
        transaction: tx,
      })

      await adapter.commitTransaction(tx)

      // Both should exist
      const foundUser = await adapter.findOne({ collection: 'users', id: user.id })
      const foundPost = await adapter.findOne({ collection: 'posts', id: post.id })

      expect(foundUser).toBeDefined()
      expect(foundPost).toBeDefined()
      // Author can be populated (object) or raw ID depending on depth
      const authorId = typeof foundPost?.author === 'object' ? foundPost?.author?.id : foundPost?.author
      expect(authorId).toBe(user.id)
    })

    it('should rollback all collections on failure', async () => {
      const adapter = harness.adapter as any

      const tx = await adapter.beginTransaction()

      await adapter.create({
        collection: 'users',
        data: { name: 'Rollback User', email: 'rollback@test.com' },
        transaction: tx,
      })

      await adapter.create({
        collection: 'posts',
        data: { title: 'Rollback Post', slug: 'rollback-post' },
        transaction: tx,
      })

      await adapter.rollbackTransaction(tx)

      // Neither should exist
      const users = await adapter.find({ collection: 'users' })
      const posts = await adapter.find({ collection: 'posts' })

      expect(users.docs).toHaveLength(0)
      expect(posts.docs).toHaveLength(0)
    })
  })

  // ============================================================================
  // TRANSACTION RELATIONSHIP TESTS
  // ============================================================================

  describe('transaction relationship handling', () => {
    it('should handle relationship creation within transaction', async () => {
      const adapter = harness.adapter as any

      const user = await adapter.create({
        collection: 'users',
        data: { name: 'Existing User', email: 'existing@test.com' },
      })

      const tx = await adapter.beginTransaction()

      const post = await adapter.create({
        collection: 'posts',
        data: {
          title: 'Post With Author',
          slug: 'post-with-author',
          author: user.id,
        },
        transaction: tx,
      })

      await adapter.commitTransaction(tx)

      // Relationship should be stored
      const relationships = harness.relationships.list({
        verb: 'hasAuthor',
      })

      expect(relationships.length).toBeGreaterThan(0)
      expect(relationships.some(r => r.to.includes(user.id))).toBe(true)
    })

    it('should rollback relationship on transaction rollback', async () => {
      const adapter = harness.adapter as any

      const user = await adapter.create({
        collection: 'users',
        data: { name: 'User For Rollback', email: 'rollback@test.com' },
      })

      // Get initial relationship count
      const initialRels = harness.relationships.list({ verb: 'hasAuthor' })

      const tx = await adapter.beginTransaction()

      await adapter.create({
        collection: 'posts',
        data: {
          title: 'Rollback Post',
          slug: 'rollback-post',
          author: user.id,
        },
        transaction: tx,
      })

      await adapter.rollbackTransaction(tx)

      // Relationship count should be same as before
      const finalRels = harness.relationships.list({ verb: 'hasAuthor' })
      expect(finalRels.length).toBe(initialRels.length)
    })
  })

  // ============================================================================
  // TRANSACTION THING SYNC TESTS
  // ============================================================================

  describe('transaction Thing sync', () => {
    it('should sync to Things store only on commit', async () => {
      const adapter = harness.adapter as any

      const initialThingsCount = harness.things.list().length

      const tx = await adapter.beginTransaction()

      await adapter.create({
        collection: 'posts',
        data: { title: 'Thing Sync Test', slug: 'thing-sync-test' },
        transaction: tx,
      })

      // Things store should not have the new item yet
      const duringTxCount = harness.things.list().length
      expect(duringTxCount).toBe(initialThingsCount)

      await adapter.commitTransaction(tx)

      // Now Things store should have the new item
      const afterCommitCount = harness.things.list().length
      expect(afterCommitCount).toBe(initialThingsCount + 1)
    })

    it('should not sync to Things store on rollback', async () => {
      const adapter = harness.adapter as any

      const initialThingsCount = harness.things.list().length

      const tx = await adapter.beginTransaction()

      await adapter.create({
        collection: 'posts',
        data: { title: 'No Sync Test', slug: 'no-sync-test' },
        transaction: tx,
      })

      await adapter.rollbackTransaction(tx)

      // Things store count should be unchanged
      const finalThingsCount = harness.things.list().length
      expect(finalThingsCount).toBe(initialThingsCount)
    })
  })

  // ============================================================================
  // TRANSACTION TIMEOUT TESTS
  // ============================================================================

  describe('transaction timeout', () => {
    it('should support transaction timeout option', async () => {
      const adapter = harness.adapter as any

      const tx = await adapter.beginTransaction({ timeout: 5000 })

      expect(tx.timeout).toBe(5000)

      await adapter.rollbackTransaction(tx)
    })

    it('should use default timeout if not specified', async () => {
      const adapter = harness.adapter as any

      const tx = await adapter.beginTransaction()

      // Default timeout should be defined (e.g., 30000ms)
      expect(tx.timeout).toBeDefined()
      expect(typeof tx.timeout).toBe('number')

      await adapter.rollbackTransaction(tx)
    })
  })

  // ============================================================================
  // SAVEPOINT TESTS
  // ============================================================================

  describe('transaction savepoints', () => {
    it('should support creating savepoints', async () => {
      const adapter = harness.adapter as any

      expect(adapter.savepoint).toBeDefined()
      expect(typeof adapter.savepoint).toBe('function')
    })

    it('should create savepoint within transaction', async () => {
      const adapter = harness.adapter as any

      const tx = await adapter.beginTransaction()

      const sp = await adapter.savepoint(tx, 'sp1')

      expect(sp).toBeDefined()
      expect(sp.name).toBe('sp1')

      await adapter.rollbackTransaction(tx)
    })

    it('should rollback to savepoint', async () => {
      const adapter = harness.adapter as any

      const tx = await adapter.beginTransaction()

      await adapter.create({
        collection: 'posts',
        data: { title: 'Before Savepoint', slug: 'before-savepoint' },
        transaction: tx,
      })

      const sp = await adapter.savepoint(tx, 'sp1')

      await adapter.create({
        collection: 'posts',
        data: { title: 'After Savepoint', slug: 'after-savepoint' },
        transaction: tx,
      })

      // Rollback to savepoint
      await adapter.rollbackToSavepoint(tx, sp)

      await adapter.commitTransaction(tx)

      // Only first post should exist
      const result = await adapter.find({ collection: 'posts' })
      expect(result.docs).toHaveLength(1)
      expect(result.docs[0].title).toBe('Before Savepoint')
    })

    it('should release savepoint', async () => {
      const adapter = harness.adapter as any

      const tx = await adapter.beginTransaction()

      const sp = await adapter.savepoint(tx, 'sp1')

      await adapter.create({
        collection: 'posts',
        data: { title: 'After Savepoint', slug: 'after-savepoint' },
        transaction: tx,
      })

      // Release savepoint
      await adapter.releaseSavepoint(tx, sp)

      // Should not be able to rollback to released savepoint
      await expect(adapter.rollbackToSavepoint(tx, sp)).rejects.toThrow(/invalid|released|not found/i)

      await adapter.rollbackTransaction(tx)
    })
  })

  // ============================================================================
  // TRANSACTION ID AND TRACKING TESTS
  // ============================================================================

  describe('transaction tracking', () => {
    it('should assign unique transaction IDs', async () => {
      const adapter = harness.adapter as any

      const tx1 = await adapter.beginTransaction()
      await adapter.commitTransaction(tx1)

      const tx2 = await adapter.beginTransaction()
      await adapter.commitTransaction(tx2)

      expect(tx1.id).not.toBe(tx2.id)
    })

    it('should track transaction start time', async () => {
      const adapter = harness.adapter as any

      const before = Date.now()
      const tx = await adapter.beginTransaction()
      const after = Date.now()

      expect(tx.startedAt).toBeGreaterThanOrEqual(before)
      expect(tx.startedAt).toBeLessThanOrEqual(after)

      await adapter.rollbackTransaction(tx)
    })

    it('should track operations in transaction', async () => {
      const adapter = harness.adapter as any

      const tx = await adapter.beginTransaction()

      await adapter.create({
        collection: 'posts',
        data: { title: 'Op 1', slug: 'op-1' },
        transaction: tx,
      })

      await adapter.create({
        collection: 'posts',
        data: { title: 'Op 2', slug: 'op-2' },
        transaction: tx,
      })

      expect(tx.operations).toBeDefined()
      expect(tx.operations.length).toBe(2)

      await adapter.rollbackTransaction(tx)
    })
  })
})
