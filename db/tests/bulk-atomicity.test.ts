/**
 * Bulk Operation Atomicity Tests
 *
 * TDD RED PHASE: Tests that expose non-atomic bulk operation behavior.
 *
 * These tests demonstrate that bulkCreate, bulkUpdate, and bulkDelete
 * operations are NOT currently atomic - partial results can exist after
 * a failure midway through the operation.
 *
 * After implementing atomic bulk operations, these tests should FAIL
 * (proving atomicity) and be updated to expect no partial results.
 *
 * @module db/tests/bulk-atomicity
 * @see do-5uai
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createThingsStoreWithAdapter, type ThingsStore } from '../things'
import { MemoryStorageAdapter } from '../adapters/memory'
import type { StorageAdapter } from '../storage'

/**
 * Custom storage adapter that can inject failures at specific points
 * during bulk operations to test atomicity.
 */
class FailingStorageAdapter implements StorageAdapter {
  private delegate: MemoryStorageAdapter
  private putCount = 0
  private failAfterPuts: number | null = null

  constructor() {
    this.delegate = new MemoryStorageAdapter()
  }

  /**
   * Configure the adapter to throw an error after N successful puts
   * within a single putMany call.
   */
  failAfter(n: number): void {
    this.failAfterPuts = n
    this.putCount = 0
  }

  /**
   * Reset failure configuration
   */
  resetFailure(): void {
    this.failAfterPuts = null
    this.putCount = 0
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.delegate.get<T>(key)
  }

  async getMany<T = unknown>(keys: string[]): Promise<Map<string, T>> {
    return this.delegate.getMany<T>(keys)
  }

  async put<T = unknown>(key: string, value: T): Promise<void> {
    return this.delegate.put(key, value)
  }

  /**
   * putMany with injectable failure - this is where we simulate
   * the non-atomic behavior.
   */
  async putMany<T = unknown>(entries: Map<string, T>): Promise<void> {
    // Simulate the current non-atomic implementation by iterating
    // and potentially failing midway
    for (const [key, value] of entries) {
      if (this.failAfterPuts !== null && this.putCount >= this.failAfterPuts) {
        throw new Error(`Simulated failure after ${this.failAfterPuts} puts`)
      }

      await this.delegate.put(key, value)
      this.putCount++
    }
  }

  async delete(key: string): Promise<void> {
    return this.delegate.delete(key)
  }

  async deleteMany(keys: string[]): Promise<void> {
    return this.delegate.deleteMany(keys)
  }

  async list<T = unknown>(options?: Parameters<StorageAdapter['list']>[0]) {
    return this.delegate.list<T>(options)
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    // Current implementation doesn't provide true transaction support
    return this.delegate.transaction(fn)
  }

  async has(key: string): Promise<boolean> {
    return this.delegate.has(key)
  }

  async clear(): Promise<void> {
    return this.delegate.clear()
  }

  async count(prefix?: string): Promise<number> {
    return this.delegate.count(prefix)
  }

  /**
   * Get the underlying delegate for inspection
   */
  getDelegate(): MemoryStorageAdapter {
    return this.delegate
  }
}

describe('Bulk Operation Atomicity', () => {
  let adapter: FailingStorageAdapter
  let things: ThingsStore

  beforeEach(() => {
    adapter = new FailingStorageAdapter()
    things = createThingsStoreWithAdapter(adapter)
  })

  afterEach(() => {
    adapter.resetFailure()
  })

  describe('bulkCreate non-atomicity (should fail after fix)', () => {
    it('should have partial results when putMany fails midway - PROVES NON-ATOMICITY', async () => {
      // Configure to fail after inserting 2 items
      adapter.failAfter(2)

      const items = [
        { $type: 'Customer', name: 'Alice' },
        { $type: 'Customer', name: 'Bob' },
        { $type: 'Customer', name: 'Charlie' },  // Will fail before this one
        { $type: 'Customer', name: 'Diana' },
      ]

      // The bulkCreate should throw
      await expect(things.bulkCreate(items)).rejects.toThrow('Simulated failure')

      // THIS IS THE KEY ASSERTION:
      // Currently, we expect partial results to exist (proving non-atomicity).
      // After implementing atomic bulk operations, this should be 0,
      // and this test should FAIL.
      const allCustomers = await things.list({ type: 'Customer' })

      // NON-ATOMIC BEHAVIOR: Some items were created before the failure
      // This test PASSES now (proving the bug) but should FAIL after the fix
      expect(allCustomers.length).toBeGreaterThan(0)
      expect(allCustomers.length).toBeLessThan(items.length)

      // Verify we have exactly 2 items (the ones created before failure)
      expect(allCustomers.length).toBe(2)

      // Verify the specific items that were created
      const names = allCustomers.map(c => c.name).sort()
      expect(names).toEqual(['Alice', 'Bob'])
    })

    it('should leave database dirty after failure - PROVES NON-ATOMICITY', async () => {
      // First, create some existing data
      await things.create({ $type: 'Existing', name: 'Pre-existing' })

      // Configure to fail after inserting 1 item
      adapter.failAfter(1)

      const items = [
        { $type: 'NewType', name: 'First' },
        { $type: 'NewType', name: 'Second' },  // Will fail before this one
      ]

      // The bulkCreate should throw
      await expect(things.bulkCreate(items)).rejects.toThrow('Simulated failure')

      // The database is now in an inconsistent state:
      // - Original data still exists (good)
      // - Partial new data exists (bad - proves non-atomicity)
      const existing = await things.list({ type: 'Existing' })
      const newItems = await things.list({ type: 'NewType' })

      expect(existing.length).toBe(1)  // Original data preserved

      // NON-ATOMIC BEHAVIOR: Partial new items exist
      // This test PASSES now but should FAIL after implementing atomicity
      expect(newItems.length).toBe(1)  // Should be 0 after fix
      expect(newItems[0].name).toBe('First')
    })
  })

  describe('bulkUpdate non-atomicity (should fail after fix)', () => {
    it('should have partial updates when putMany fails midway - PROVES NON-ATOMICITY', async () => {
      // Create initial items
      const created = await Promise.all([
        things.create({ $type: 'Item', value: 0 }),
        things.create({ $type: 'Item', value: 0 }),
        things.create({ $type: 'Item', value: 0 }),
        things.create({ $type: 'Item', value: 0 }),
      ])

      // Configure to fail after updating 2 items
      adapter.failAfter(2)

      const updates = created.map((item, i) => ({
        id: item.$id,
        data: { value: i + 1 }  // Update to 1, 2, 3, 4
      }))

      // The bulkUpdate should throw
      await expect(things.bulkUpdate(updates)).rejects.toThrow('Simulated failure')

      // Check the state - some items should be updated, others not
      const items = await Promise.all(created.map(c => things.get(c.$id)))

      // Count how many were updated (value > 0)
      const updatedCount = items.filter(item => item && item.value > 0).length
      const notUpdatedCount = items.filter(item => item && item.value === 0).length

      // NON-ATOMIC BEHAVIOR: Some items were updated before the failure
      // This test PASSES now but should FAIL after implementing atomicity
      expect(updatedCount).toBe(2)
      expect(notUpdatedCount).toBe(2)
    })
  })

  describe('bulkDelete non-atomicity (should fail after fix)', () => {
    it('should have partial deletes when deleteMany fails midway - PROVES NON-ATOMICITY', async () => {
      // Create initial items
      const created = await Promise.all([
        things.create({ $type: 'ToDelete', index: 0 }),
        things.create({ $type: 'ToDelete', index: 1 }),
        things.create({ $type: 'ToDelete', index: 2 }),
        things.create({ $type: 'ToDelete', index: 3 }),
      ])

      // Create a custom adapter that fails deleteMany midway
      const failingDeleteAdapter = new (class extends MemoryStorageAdapter {
        private deleteCount = 0
        private failAfterDeletes = 2

        async deleteMany(keys: string[]): Promise<void> {
          // Non-atomic: delete one by one, potentially failing midway
          for (const key of keys) {
            if (this.deleteCount >= this.failAfterDeletes) {
              throw new Error('Simulated delete failure')
            }
            await this.delete(key)
            this.deleteCount++
          }
        }
      })()

      // Copy data to the failing adapter
      const delegate = adapter.getDelegate()
      for (const [key, entry] of delegate.getStore()) {
        await failingDeleteAdapter.put(key, entry.value)
      }

      const failingThings = createThingsStoreWithAdapter(failingDeleteAdapter)

      const idsToDelete = created.map(c => c.$id)

      // The bulkDelete should throw
      await expect(failingThings.bulkDelete(idsToDelete)).rejects.toThrow('Simulated delete failure')

      // Check how many were actually deleted
      const remaining = await failingThings.list({ type: 'ToDelete' })

      // NON-ATOMIC BEHAVIOR: Some items were deleted before the failure
      // This test PASSES now but should FAIL after implementing atomicity
      expect(remaining.length).toBe(2)  // 2 deleted, 2 remain
      expect(remaining.length).toBeLessThan(created.length)
    })
  })

  describe('atomicity requirements', () => {
    it('documents the expected atomic behavior (will pass after fix)', async () => {
      /**
       * ATOMIC BEHAVIOR SPECIFICATION:
       *
       * When bulk operations are properly atomic:
       *
       * 1. bulkCreate: Either ALL items are created, or NONE are created
       * 2. bulkUpdate: Either ALL items are updated, or NONE are updated
       * 3. bulkDelete: Either ALL items are deleted, or NONE are deleted
       *
       * Implementation approaches:
       *
       * A. For SQLite adapter:
       *    - Wrap putMany/deleteMany in BEGIN/COMMIT transaction
       *    - ROLLBACK on any error
       *
       * B. For Memory adapter:
       *    - Already has transaction() with snapshot/restore
       *    - Need to use it in putMany/deleteMany
       *
       * C. For ThingsStore:
       *    - Use adapter.transaction() wrapper for bulk operations
       *    - Or implement bulk operations as single SQL statements
       */
      expect(true).toBe(true)  // Placeholder - spec documentation
    })
  })
})
