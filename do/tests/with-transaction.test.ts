/**
 * withTransaction() Atomic Multi-Operation Transaction Tests (do-9mrsg)
 *
 * Tests for the withTransaction() helper that ensures multi-operation
 * transactions across things, relationships, and events are atomic --
 * either all succeed or all are rolled back.
 *
 * Uses direct file imports to avoid barrel export dependency issues.
 *
 * @module do/tests/with-transaction.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { MemoryStorageAdapter } from '../../db/adapters/memory'
import { TransactionError } from '../../db/utils/errors'
import { createThingsStoreWithAdapter, type ThingsStore } from '../../db/entities/things'
import { createEventsStoreWithAdapter, type EventsStore } from '../../db/entities/events'
import { createRelationshipsStoreWithAdapter, type RelationshipsStore } from '../../db/entities/relationships'
import type { StorageAdapter } from '../../db/storage/storage'

// ============================================================================
// Inline withTransaction logic for testing (avoids barrel import chain)
// This mirrors the logic in EntityManager.withTransaction()
// ============================================================================

interface TestTransactionContext {
  adapter: StorageAdapter
  things: ThingsStore
  events: EventsStore
  relationships: RelationshipsStore
  inTransaction: boolean
}

function createTestContext(): TestTransactionContext {
  const adapter = new MemoryStorageAdapter()
  return {
    adapter,
    things: createThingsStoreWithAdapter(adapter),
    events: createEventsStoreWithAdapter(adapter),
    relationships: createRelationshipsStoreWithAdapter(adapter),
    inTransaction: false,
  }
}

async function withTransaction<T>(ctx: TestTransactionContext, fn: () => Promise<T>): Promise<T> {
  if (ctx.inTransaction) {
    throw new TransactionError(
      'Nested transactions are not supported. ' +
      'withTransaction() was called while another transaction is already in progress.'
    )
  }

  ctx.inTransaction = true
  try {
    const result = await ctx.adapter.transaction(fn)
    return result
  } catch (error) {
    if (error instanceof TransactionError) {
      throw error
    }
    throw new TransactionError(
      `Transaction failed: ${error instanceof Error ? error.message : String(error)}`,
      error instanceof Error ? error : undefined
    )
  } finally {
    ctx.inTransaction = false
  }
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('withTransaction() - Atomic Multi-Operation Transactions (do-9mrsg)', () => {
  let ctx: TestTransactionContext

  beforeEach(() => {
    ctx = createTestContext()
  })

  describe('Basic Transaction Behavior', () => {
    it('should commit all operations on success', async () => {
      const result = await withTransaction(ctx, async () => {
        const customer = await ctx.things.create({
          $type: 'Customer',
          name: 'Alice',
        })

        await ctx.relationships.add({
          subject: customer.$id,
          predicate: 'belongs_to',
          object: 'org-1',
        })

        return customer
      })

      // Verify the thing was committed
      expect(result.$id).toBeDefined()
      expect(result.$type).toBe('Customer')

      const retrieved = await ctx.things.get(result.$id)
      expect(retrieved).not.toBeNull()
      expect((retrieved as { name: string }).name).toBe('Alice')

      // Verify the relationship was committed
      const rels = await ctx.relationships.find({
        subject: result.$id,
        predicate: 'belongs_to',
      })
      expect(rels.length).toBe(1)
      expect(rels[0].object).toBe('org-1')
    })

    it('should rollback all operations on error', async () => {
      // Create a pre-existing thing to verify it survives the rollback
      const existing = await ctx.things.create({
        $type: 'Existing',
        name: 'PreExisting',
      })

      await expect(
        withTransaction(ctx, async () => {
          // Create a thing inside the transaction
          await ctx.things.create({
            $type: 'Customer',
            name: 'ShouldBeRolledBack',
          })

          await ctx.relationships.add({
            subject: 'tx-thing',
            predicate: 'test',
            object: 'tx-target',
          })

          // Force an error to trigger rollback
          throw new Error('Intentional failure')
        })
      ).rejects.toThrow(TransactionError)

      // Verify the pre-existing thing was NOT affected by the rollback
      const existingAfter = await ctx.things.get(existing.$id)
      expect(existingAfter).not.toBeNull()
      expect((existingAfter as { name: string }).name).toBe('PreExisting')

      // Verify the transaction's things were rolled back
      const allThings = await ctx.things.list({})
      expect(allThings.length).toBe(1) // Only the pre-existing thing
      expect(allThings[0].$type).toBe('Existing')

      // Verify the transaction's relationships were rolled back
      const rels = await ctx.relationships.find({
        subject: 'tx-thing',
        predicate: 'test',
      })
      expect(rels.length).toBe(0)
    })

    it('should return the result from the transaction function', async () => {
      const result = await withTransaction(ctx, async () => {
        const thing = await ctx.things.create({
          $type: 'Customer',
          name: 'Alice',
        })
        return { id: thing.$id, created: true }
      })

      expect(result).toEqual({ id: expect.any(String), created: true })
    })
  })

  describe('Multi-Store Atomicity', () => {
    it('should atomically create a thing and a relationship', async () => {
      await withTransaction(ctx, async () => {
        const customer = await ctx.things.create({
          $type: 'Customer',
          name: 'Alice',
        })

        const order = await ctx.things.create({
          $type: 'Order',
          total: 100,
        })

        await ctx.relationships.add({
          subject: customer.$id,
          predicate: 'placed',
          object: order.$id,
        })
      })

      // Both things should exist
      const allThings = await ctx.things.list({})
      expect(allThings.length).toBe(2)

      // Relationship should exist
      const customers = await ctx.things.list({ type: 'Customer' })
      expect(customers.length).toBe(1)

      const rels = await ctx.relationships.find({
        subject: customers[0].$id,
        predicate: 'placed',
      })
      expect(rels.length).toBe(1)
    })

    it('should roll back thing+relationship on error in relationship creation', async () => {
      // Pre-add a relationship so that adding a duplicate fails
      await ctx.relationships.add({
        subject: 'dup-subject',
        predicate: 'dup-pred',
        object: 'dup-object',
      })

      await expect(
        withTransaction(ctx, async () => {
          // This thing create should be rolled back
          await ctx.things.create({
            $type: 'WillRollback',
            name: 'ShouldNotExist',
          })

          // This will fail because it is a duplicate relationship
          await ctx.relationships.add({
            subject: 'dup-subject',
            predicate: 'dup-pred',
            object: 'dup-object',
          })
        })
      ).rejects.toThrow(TransactionError)

      // The thing created inside the transaction should be rolled back
      const things = await ctx.things.list({ type: 'WillRollback' })
      expect(things.length).toBe(0)
    })

    it('should roll back multiple things on error after partial creation', async () => {
      await expect(
        withTransaction(ctx, async () => {
          await ctx.things.create({
            $type: 'Item',
            name: 'Item 1',
          })

          await ctx.things.create({
            $type: 'Item',
            name: 'Item 2',
          })

          await ctx.things.create({
            $type: 'Item',
            name: 'Item 3',
          })

          throw new Error('Abort after 3 items')
        })
      ).rejects.toThrow(TransactionError)

      // All three items should be rolled back
      const items = await ctx.things.list({ type: 'Item' })
      expect(items.length).toBe(0)
    })
  })

  describe('Nesting Prevention', () => {
    it('should throw TransactionError on nested withTransaction()', async () => {
      await expect(
        withTransaction(ctx, async () => {
          // Attempt nested transaction
          await withTransaction(ctx, async () => {
            await ctx.things.create({
              $type: 'Nested',
              name: 'Should not work',
            })
          })
        })
      ).rejects.toThrow(TransactionError)
    })

    it('should throw TransactionError with descriptive message for nesting', async () => {
      await expect(
        withTransaction(ctx, async () => {
          await withTransaction(ctx, async () => {})
        })
      ).rejects.toThrow(/[Nn]ested/)
    })
  })

  describe('Error Wrapping', () => {
    it('should wrap non-TransactionError errors in TransactionError', async () => {
      try {
        await withTransaction(ctx, async () => {
          throw new Error('Custom error')
        })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(TransactionError)
        expect((error as TransactionError).message).toContain('Custom error')
      }
    })

    it('should preserve TransactionError when thrown inside transaction', async () => {
      const original = new TransactionError('Already a TransactionError')

      try {
        await withTransaction(ctx, async () => {
          throw original
        })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(TransactionError)
        expect((error as TransactionError).message).toContain('Already a TransactionError')
      }
    })
  })

  describe('inTransaction State Tracking', () => {
    it('should report inTransaction=false when not in a transaction', () => {
      expect(ctx.inTransaction).toBe(false)
    })

    it('should report inTransaction=true during a transaction', async () => {
      let wasInTransaction = false

      await withTransaction(ctx, async () => {
        wasInTransaction = ctx.inTransaction
      })

      expect(wasInTransaction).toBe(true)
      // After transaction completes, should be false
      expect(ctx.inTransaction).toBe(false)
    })

    it('should reset inTransaction to false after error', async () => {
      try {
        await withTransaction(ctx, async () => {
          throw new Error('Force failure')
        })
      } catch {
        // expected
      }

      expect(ctx.inTransaction).toBe(false)
    })
  })

  describe('MemoryStorageAdapter Transaction Behavior', () => {
    it('should snapshot and restore adapter state on failure', async () => {
      const adapter = new MemoryStorageAdapter()

      // Put some initial data
      await adapter.put('key1', 'value1')
      await adapter.put('key2', 'value2')

      // Transaction that fails
      try {
        await adapter.transaction(async () => {
          await adapter.put('key3', 'value3')
          await adapter.delete('key1')
          throw new Error('Fail')
        })
      } catch {
        // expected
      }

      // key1 should still exist (restored from snapshot)
      const val1 = await adapter.get('key1')
      expect(val1).toBe('value1')

      // key3 should NOT exist (rolled back)
      const val3 = await adapter.get('key3')
      expect(val3).toBeUndefined()

      // key2 should still exist
      const val2 = await adapter.get('key2')
      expect(val2).toBe('value2')
    })
  })

  describe('Complex Transaction Scenarios', () => {
    it('should handle create + update + relationship atomically', async () => {
      // First create an entity outside the transaction
      const org = await ctx.things.create({
        $type: 'Organization',
        name: 'Acme Corp',
      })

      await withTransaction(ctx, async () => {
        // Create new entity
        const customer = await ctx.things.create({
          $type: 'Customer',
          name: 'Alice',
          status: 'pending',
        })

        // Update the entity
        await ctx.things.update(customer.$id, {
          status: 'active',
        })

        // Add relationship
        await ctx.relationships.add({
          subject: customer.$id,
          predicate: 'member_of',
          object: org.$id,
        })
      })

      // Verify all operations committed
      const customers = await ctx.things.list({ type: 'Customer' })
      expect(customers.length).toBe(1)
      expect((customers[0] as { status: string }).status).toBe('active')

      const rels = await ctx.relationships.find({
        subject: customers[0].$id,
        predicate: 'member_of',
      })
      expect(rels.length).toBe(1)
      expect(rels[0].object).toBe(org.$id)
    })

    it('should handle sequential transactions correctly', async () => {
      // First transaction
      await withTransaction(ctx, async () => {
        await ctx.things.create({
          $type: 'Item',
          name: 'From TX 1',
        })
      })

      // Second transaction
      await withTransaction(ctx, async () => {
        await ctx.things.create({
          $type: 'Item',
          name: 'From TX 2',
        })
      })

      // Both should be committed
      const items = await ctx.things.list({ type: 'Item' })
      expect(items.length).toBe(2)
    })

    it('should allow successful transactions after a failed one', async () => {
      // First transaction fails
      try {
        await withTransaction(ctx, async () => {
          await ctx.things.create({ $type: 'Failed', name: 'X' })
          throw new Error('First TX fails')
        })
      } catch {
        // expected
      }

      // Second transaction should succeed
      await withTransaction(ctx, async () => {
        await ctx.things.create({ $type: 'Success', name: 'Y' })
      })

      const failed = await ctx.things.list({ type: 'Failed' })
      expect(failed.length).toBe(0)

      const success = await ctx.things.list({ type: 'Success' })
      expect(success.length).toBe(1)
    })
  })
})
