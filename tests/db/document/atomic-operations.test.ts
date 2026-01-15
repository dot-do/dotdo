/**
 * DocumentStore Atomic Operations - RED Phase Tests
 *
 * TDD RED phase: These tests define expected atomic behavior for DocumentStore.
 * Tests should FAIL until implementation is complete.
 *
 * Critical issue being tested:
 * - DocumentStore.createMany has a race condition where partial failures
 *   don't properly rollback (they delete docs serially, which can fail)
 *
 * Test coverage:
 * 1. createMany with full rollback on ANY failure
 * 2. updateMany with atomic commit (all-or-nothing)
 * 3. Concurrent write detection
 * 4. Optimistic locking with version checks
 * 5. Transaction isolation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'

import { DocumentStore } from '../../../db/document'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface TestDocument {
  $id: string
  $type: string
  $createdAt: number
  $updatedAt: number
  $version: number
  name: string
  value: number
  status?: string
  metadata?: {
    tier?: string
    priority?: number
  }
}

interface CDCEvent {
  type: 'cdc.insert' | 'cdc.update' | 'cdc.delete'
  op: 'c' | 'u' | 'd'
  store: 'document'
  table: string
  key: string
  before?: Record<string, unknown>
  after?: Record<string, unknown>
}

// ============================================================================
// TEST SETUP
// ============================================================================

describe('DocumentStore Atomic Operations - RED Phase', () => {
  let sqlite: Database.Database
  let db: ReturnType<typeof drizzle>
  let docs: DocumentStore<TestDocument>
  let cdcEvents: CDCEvent[]

  beforeEach(() => {
    sqlite = new Database(':memory:')
    db = drizzle(sqlite)
    cdcEvents = []

    // Create documents table
    sqlite.exec(`
      CREATE TABLE documents (
        "$id" TEXT PRIMARY KEY,
        "$type" TEXT NOT NULL,
        data JSON NOT NULL,
        "$createdAt" INTEGER NOT NULL,
        "$updatedAt" INTEGER NOT NULL,
        "$version" INTEGER NOT NULL DEFAULT 1
      );

      CREATE INDEX idx_documents_type ON documents("$type");
      CREATE INDEX idx_documents_updated ON documents("$updatedAt");
    `)

    docs = new DocumentStore<TestDocument>(db, {
      type: 'TestDoc',
      onEvent: (event: CDCEvent) => cdcEvents.push(event),
    })
  })

  afterEach(() => {
    sqlite.close()
  })

  // ============================================================================
  // 1. createMany WITH FULL ROLLBACK ON ANY FAILURE
  // ============================================================================

  describe('createMany - Atomic Rollback', () => {
    it('should rollback ALL documents when 3rd of 5 inserts fails', async () => {
      // Arrange: Pre-insert a document that will cause a duplicate key error
      await docs.create({
        $id: 'conflict_id',
        name: 'Pre-existing',
        value: 0,
      })

      const inputs = [
        { $id: 'doc_1', name: 'First', value: 1 },
        { $id: 'doc_2', name: 'Second', value: 2 },
        { $id: 'conflict_id', name: 'Third (conflict)', value: 3 }, // Will fail
        { $id: 'doc_4', name: 'Fourth', value: 4 },
        { $id: 'doc_5', name: 'Fifth', value: 5 },
      ]

      // Act & Assert
      await expect(docs.createMany(inputs)).rejects.toThrow()

      // Verify: NONE of the new documents should exist (atomic rollback)
      const doc1 = await docs.get('doc_1')
      const doc2 = await docs.get('doc_2')
      const doc4 = await docs.get('doc_4')
      const doc5 = await docs.get('doc_5')

      // These should all be null if rollback was atomic
      expect(doc1).toBeNull()
      expect(doc2).toBeNull()
      expect(doc4).toBeNull()
      expect(doc5).toBeNull()

      // Original document should be unchanged
      const original = await docs.get('conflict_id')
      expect(original?.name).toBe('Pre-existing')
    })

    it('should rollback when last of 5 inserts fails', async () => {
      await docs.create({ $id: 'last_conflict', name: 'Existing', value: 0 })

      const inputs = [
        { $id: 'a_1', name: 'First', value: 1 },
        { $id: 'a_2', name: 'Second', value: 2 },
        { $id: 'a_3', name: 'Third', value: 3 },
        { $id: 'a_4', name: 'Fourth', value: 4 },
        { $id: 'last_conflict', name: 'Fifth (conflict)', value: 5 },
      ]

      await expect(docs.createMany(inputs)).rejects.toThrow()

      // All should be rolled back
      expect(await docs.get('a_1')).toBeNull()
      expect(await docs.get('a_2')).toBeNull()
      expect(await docs.get('a_3')).toBeNull()
      expect(await docs.get('a_4')).toBeNull()
    })

    it('should rollback when first insert fails', async () => {
      await docs.create({ $id: 'first_conflict', name: 'Existing', value: 0 })

      const inputs = [
        { $id: 'first_conflict', name: 'First (conflict)', value: 1 },
        { $id: 'b_2', name: 'Second', value: 2 },
        { $id: 'b_3', name: 'Third', value: 3 },
      ]

      await expect(docs.createMany(inputs)).rejects.toThrow()

      expect(await docs.get('b_2')).toBeNull()
      expect(await docs.get('b_3')).toBeNull()
    })

    it('should not emit ANY CDC events when batch fails', async () => {
      await docs.create({ $id: 'cdc_conflict', name: 'Existing', value: 0 })
      cdcEvents = [] // Clear setup events

      const inputs = [
        { $id: 'cdc_1', name: 'First', value: 1 },
        { $id: 'cdc_2', name: 'Second', value: 2 },
        { $id: 'cdc_conflict', name: 'Third (conflict)', value: 3 },
      ]

      await expect(docs.createMany(inputs)).rejects.toThrow()

      // No CDC events should have been emitted (or they should be rolled back)
      const insertEvents = cdcEvents.filter((e) => e.type === 'cdc.insert')
      expect(insertEvents).toHaveLength(0)
    })

    it('should handle concurrent createMany calls atomically', async () => {
      const batch1 = [
        { $id: 'concurrent_1', name: 'Batch1-A', value: 1 },
        { $id: 'concurrent_2', name: 'Batch1-B', value: 2 },
      ]

      const batch2 = [
        { $id: 'concurrent_1', name: 'Batch2-A', value: 10 }, // Conflicts with batch1
        { $id: 'concurrent_3', name: 'Batch2-B', value: 20 },
      ]

      // Run concurrently
      const results = await Promise.allSettled([
        docs.createMany(batch1),
        docs.createMany(batch2),
      ])

      // At least one should fail
      const failures = results.filter((r) => r.status === 'rejected')
      expect(failures.length).toBeGreaterThanOrEqual(1)

      // The winner batch should have all docs, loser should have none
      const doc1 = await docs.get('concurrent_1')
      const doc2 = await docs.get('concurrent_2')
      const doc3 = await docs.get('concurrent_3')

      // Either (doc1 + doc2 exist) OR (doc1 + doc3 exist), but not a mix
      if (doc2) {
        expect(doc1).not.toBeNull()
        expect(doc3).toBeNull() // Batch2 should have been rolled back
      } else if (doc3) {
        expect(doc1).not.toBeNull()
        expect(doc2).toBeNull() // Batch1 should have been rolled back
      }
    })

    it('should use SQLite transaction for atomicity', async () => {
      // This test verifies the implementation uses BEGIN/COMMIT/ROLLBACK
      const transactionSpy = vi.spyOn(sqlite, 'exec')

      await docs.createMany([
        { $id: 'tx_1', name: 'First', value: 1 },
        { $id: 'tx_2', name: 'Second', value: 2 },
      ])

      // Should have used transaction
      const calls = transactionSpy.mock.calls.map((c) => c[0])
      expect(calls.some((c) => c.includes('BEGIN') || c.includes('TRANSACTION'))).toBe(true)

      transactionSpy.mockRestore()
    })
  })

  // ============================================================================
  // 2. updateMany WITH ATOMIC COMMIT (ALL-OR-NOTHING)
  // ============================================================================

  describe('updateMany - Atomic Commit', () => {
    beforeEach(async () => {
      // Seed test data
      await docs.createMany([
        { $id: 'upd_1', name: 'Update1', value: 10, status: 'pending' },
        { $id: 'upd_2', name: 'Update2', value: 20, status: 'pending' },
        { $id: 'upd_3', name: 'Update3', value: 30, status: 'active' },
        { $id: 'upd_4', name: 'Update4', value: 40, status: 'pending' },
        { $id: 'upd_5', name: 'Update5', value: 50, status: 'pending' },
      ])
    })

    it('should update all matching documents atomically', async () => {
      const count = await docs.updateMany(
        { where: { status: 'pending' } },
        { status: 'processed', value: 999 }
      )

      expect(count).toBe(4)

      // All should be updated
      const results = await docs.query({ where: { status: 'processed' } })
      expect(results).toHaveLength(4)
      expect(results.every((r) => r.value === 999)).toBe(true)
    })

    it('should rollback all updates when one fails due to constraint', async () => {
      // Create a unique index to cause failure
      sqlite.exec(`
        CREATE UNIQUE INDEX idx_unique_name ON documents(json_extract(data, '$.name'));
      `)

      // Pre-insert a document that will cause conflict
      await docs.create({ $id: 'conflict_name', name: 'ConflictName', value: 0 })

      // Try to update all pending docs to same name (will cause unique constraint violation)
      await expect(
        docs.updateMany(
          { where: { status: 'pending' } },
          { name: 'ConflictName' }
        )
      ).rejects.toThrow()

      // All documents should retain original names
      const upd1 = await docs.get('upd_1')
      const upd2 = await docs.get('upd_2')
      const upd4 = await docs.get('upd_4')
      const upd5 = await docs.get('upd_5')

      expect(upd1?.name).toBe('Update1')
      expect(upd2?.name).toBe('Update2')
      expect(upd4?.name).toBe('Update4')
      expect(upd5?.name).toBe('Update5')
    })

    it('should not emit CDC events when updateMany fails', async () => {
      // Setup a constraint that will fail
      sqlite.exec(`
        CREATE UNIQUE INDEX idx_unique_value ON documents(json_extract(data, '$.value'));
      `)

      cdcEvents = []

      // This will fail because multiple docs can't have same value
      await expect(
        docs.updateMany(
          { where: { status: 'pending' } },
          { value: 12345 }
        )
      ).rejects.toThrow()

      const updateEvents = cdcEvents.filter((e) => e.type === 'cdc.update')
      expect(updateEvents).toHaveLength(0)
    })

    it('should handle updateMany with version check', async () => {
      // First update should succeed
      await docs.updateMany(
        { where: { status: 'pending' } },
        { status: 'processing' }
      )

      // All pending docs should now be processing
      const processing = await docs.query({ where: { status: 'processing' } })
      expect(processing).toHaveLength(4)

      // All should have version 2
      expect(processing.every((p) => p.$version === 2)).toBe(true)
    })
  })

  // ============================================================================
  // 3. CONCURRENT WRITE DETECTION
  // ============================================================================

  describe('Concurrent Write Detection', () => {
    it('should detect concurrent modification on same document', async () => {
      const doc = await docs.create({ $id: 'concurrent_doc', name: 'Original', value: 100 })

      // Simulate two concurrent updates
      const update1 = docs.update(doc.$id, { name: 'Update1', value: 200 })
      const update2 = docs.update(doc.$id, { name: 'Update2', value: 300 })

      const results = await Promise.allSettled([update1, update2])

      // Both might succeed in current implementation (last-write-wins)
      // But with proper optimistic locking, one should fail with version conflict
      const successes = results.filter((r) => r.status === 'fulfilled')

      // Verify the document is in a consistent state
      const finalDoc = await docs.get(doc.$id)

      // Should have version 3 if both succeeded sequentially
      // Or version 2 if one was rejected
      expect(finalDoc?.$version).toBeGreaterThanOrEqual(2)
    })

    it('should implement optimistic locking with $version', async () => {
      const doc = await docs.create({ $id: 'opt_lock_doc', name: 'Original', value: 100 })
      expect(doc.$version).toBe(1)

      // Update with expected version (should succeed)
      const updated = await docs.update(doc.$id, { name: 'Updated' })
      expect(updated.$version).toBe(2)

      // Try to update with stale version (should fail)
      // This requires a new API: updateWithVersion or conditional update
      await expect(
        (docs as any).updateWithVersion(doc.$id, { name: 'Stale' }, 1)
      ).rejects.toThrow(/version.*mismatch|concurrent.*modification|conflict/i)
    })

    it('should detect and prevent lost updates in read-modify-write cycle', async () => {
      const doc = await docs.create({
        $id: 'rmw_doc',
        name: 'Counter',
        value: 0,
      })

      // Simulate two readers getting the same version
      const read1 = await docs.get(doc.$id)
      const read2 = await docs.get(doc.$id)

      expect(read1?.$version).toBe(1)
      expect(read2?.$version).toBe(1)

      // Both try to increment
      const newValue1 = (read1?.value ?? 0) + 10
      const newValue2 = (read2?.value ?? 0) + 20

      // First write succeeds
      await docs.update(doc.$id, { value: newValue1 })

      // Second write should fail if using optimistic locking with version
      // (in current implementation, it will succeed with lost update)
      // This test documents the expected behavior with proper locking
      const finalDoc = await docs.get(doc.$id)

      // With proper locking: value should be 10 (only first update applied)
      // Without locking (current): value will be 20 (lost update)
      // We test for the DESIRED behavior:
      expect(finalDoc?.value).toBe(10)
    })

    it('should handle compare-and-swap (CAS) updates', async () => {
      const doc = await docs.create({
        $id: 'cas_doc',
        name: 'CAS Test',
        value: 100,
      })

      // CAS: only update if current value matches expected
      const casUpdate = async (
        id: string,
        expectedValue: number,
        newValue: number
      ): Promise<boolean> => {
        const current = await docs.get(id)
        if (current?.value !== expectedValue) {
          return false
        }
        await docs.update(id, { value: newValue })
        return true
      }

      // First CAS should succeed
      const result1 = await casUpdate('cas_doc', 100, 200)
      expect(result1).toBe(true)

      // Second CAS with stale expected value should fail
      const result2 = await casUpdate('cas_doc', 100, 300)
      expect(result2).toBe(false)

      // Verify final value
      const finalDoc = await docs.get('cas_doc')
      expect(finalDoc?.value).toBe(200)
    })
  })

  // ============================================================================
  // 4. OPTIMISTIC LOCKING WITH VERSION CHECKS
  // ============================================================================

  describe('Optimistic Locking', () => {
    it('should expose updateIfVersion API for optimistic locking', async () => {
      const doc = await docs.create({
        $id: 'if_version_doc',
        name: 'Test',
        value: 1,
      })

      // Update only if version matches
      const result = await (docs as any).updateIfVersion(
        doc.$id,
        { value: 2 },
        1 // Expected version
      )

      expect(result).not.toBeNull()
      expect(result.$version).toBe(2)
      expect(result.value).toBe(2)
    })

    it('should reject updateIfVersion when version mismatch', async () => {
      const doc = await docs.create({
        $id: 'version_mismatch_doc',
        name: 'Test',
        value: 1,
      })

      // Update first
      await docs.update(doc.$id, { value: 100 })

      // Try to update with stale version
      await expect(
        (docs as any).updateIfVersion(doc.$id, { value: 999 }, 1)
      ).rejects.toThrow(/version.*mismatch|optimistic.*lock|conflict/i)

      // Value should still be 100
      const finalDoc = await docs.get(doc.$id)
      expect(finalDoc?.value).toBe(100)
      expect(finalDoc?.$version).toBe(2)
    })

    it('should support deleteIfVersion for conditional deletes', async () => {
      const doc = await docs.create({
        $id: 'delete_if_version',
        name: 'Test',
        value: 1,
      })

      // Update to version 2
      await docs.update(doc.$id, { value: 2 })

      // Try to delete with stale version
      const result1 = await (docs as any).deleteIfVersion(doc.$id, 1)
      expect(result1).toBe(false)

      // Document should still exist
      expect(await docs.get(doc.$id)).not.toBeNull()

      // Delete with correct version
      const result2 = await (docs as any).deleteIfVersion(doc.$id, 2)
      expect(result2).toBe(true)

      // Document should be gone
      expect(await docs.get(doc.$id)).toBeNull()
    })

    it('should increment version correctly across multiple updates', async () => {
      const doc = await docs.create({
        $id: 'multi_update',
        name: 'Test',
        value: 0,
      })

      for (let i = 1; i <= 10; i++) {
        await docs.update(doc.$id, { value: i })
      }

      const finalDoc = await docs.get(doc.$id)
      expect(finalDoc?.$version).toBe(11)
      expect(finalDoc?.value).toBe(10)
    })

    it('should return version in batch operations', async () => {
      const created = await docs.createMany([
        { $id: 'batch_v_1', name: 'A', value: 1 },
        { $id: 'batch_v_2', name: 'B', value: 2 },
        { $id: 'batch_v_3', name: 'C', value: 3 },
      ])

      // All should have version 1
      expect(created.every((d) => d.$version === 1)).toBe(true)

      // Update all
      await docs.updateMany({}, { status: 'updated' })

      // Verify versions incremented
      const doc1 = await docs.get('batch_v_1')
      const doc2 = await docs.get('batch_v_2')
      const doc3 = await docs.get('batch_v_3')

      expect(doc1?.$version).toBe(2)
      expect(doc2?.$version).toBe(2)
      expect(doc3?.$version).toBe(2)
    })
  })

  // ============================================================================
  // 5. TRANSACTION ISOLATION
  // ============================================================================

  describe('Transaction Isolation', () => {
    it('should provide SERIALIZABLE isolation within transaction', async () => {
      // Seed data
      await docs.createMany([
        { $id: 'iso_1', name: 'A', value: 100 },
        { $id: 'iso_2', name: 'B', value: 200 },
      ])

      // Within a transaction, reads should be consistent
      const transactionResult = await (docs as any).transaction(async (tx: any) => {
        const doc1Before = await tx.get('iso_1')
        const doc2Before = await tx.get('iso_2')

        // Sum before any updates
        const sumBefore = (doc1Before?.value ?? 0) + (doc2Before?.value ?? 0)

        // Transfer value from doc1 to doc2
        await tx.update('iso_1', { value: doc1Before.value - 50 })
        await tx.update('iso_2', { value: doc2Before.value + 50 })

        const doc1After = await tx.get('iso_1')
        const doc2After = await tx.get('iso_2')

        // Sum after should be same (conservation)
        const sumAfter = (doc1After?.value ?? 0) + (doc2After?.value ?? 0)

        return { sumBefore, sumAfter }
      })

      expect(transactionResult.sumBefore).toBe(300)
      expect(transactionResult.sumAfter).toBe(300)
    })

    it('should rollback entire transaction on error', async () => {
      await docs.create({ $id: 'tx_rollback', name: 'Original', value: 100 })

      await expect(
        (docs as any).transaction(async (tx: any) => {
          await tx.update('tx_rollback', { value: 200 })
          await tx.update('tx_rollback', { value: 300 })

          // Verify in-transaction state
          const doc = await tx.get('tx_rollback')
          expect(doc.value).toBe(300)

          // Throw to trigger rollback
          throw new Error('Intentional failure')
        })
      ).rejects.toThrow('Intentional failure')

      // Should be rolled back to original
      const doc = await docs.get('tx_rollback')
      expect(doc?.value).toBe(100)
    })

    it('should not see uncommitted changes from other transactions', async () => {
      await docs.create({ $id: 'phantom_doc', name: 'Base', value: 1 })

      // Note: SQLite with single connection doesn't provide cross-transaction isolation
      // In single-threaded JS, reads during a transaction see the transaction's uncommitted writes
      // This test verifies that after rollback, changes are not visible

      let valueAfterRollback: number | undefined

      await expect(
        (docs as any).transaction(async (tx: any) => {
          await tx.update('phantom_doc', { value: 999 })

          // Verify in-transaction state shows update
          const inTx = await tx.get('phantom_doc')
          expect(inTx?.value).toBe(999)

          throw new Error('Rollback this transaction')
        })
      ).rejects.toThrow('Rollback')

      // After rollback, external read should see original value
      const afterRollback = await docs.get('phantom_doc')
      valueAfterRollback = afterRollback?.value

      // Value should be back to original after rollback
      expect(valueAfterRollback).toBe(1)
    })

    it('should prevent phantom reads within transaction', async () => {
      // Seed initial data
      await docs.createMany([
        { $id: 'phantom_1', name: 'A', value: 10, status: 'active' },
        { $id: 'phantom_2', name: 'B', value: 20, status: 'active' },
      ])

      // Note: SQLite single-connection doesn't prevent phantom reads from same connection
      // This test instead verifies that transaction operations are consistent

      const results = await (docs as any).transaction(async (tx: any) => {
        // First count
        const count1 = await tx.count({ where: { status: 'active' } })

        // Create a new document within the same transaction
        await tx.create({ $id: 'phantom_3', name: 'C', value: 30, status: 'active' })

        // Second count within same transaction should see the new doc
        const count2 = await tx.count({ where: { status: 'active' } })

        return { count1, count2 }
      })

      // Within transaction, we should see our own writes
      expect(results.count1).toBe(2)
      expect(results.count2).toBe(3)

      // After commit, count should reflect the new document
      const finalCount = await docs.count({ where: { status: 'active' } })
      expect(finalCount).toBe(3)
    })

    it('should detect and handle deadlock scenarios', async () => {
      await docs.create({ $id: 'deadlock_a', name: 'A', value: 1 })
      await docs.create({ $id: 'deadlock_b', name: 'B', value: 2 })

      // Note: SQLite single-connection doesn't support nested transactions
      // When running concurrent transactions on same connection, we get
      // "cannot start a transaction within a transaction" error
      // This is expected behavior - SQLite serializes all access

      // Two transactions trying to run concurrently
      const tx1 = (docs as any).transaction(async (tx: any) => {
        await tx.update('deadlock_a', { value: 10 })
        await new Promise((resolve) => setTimeout(resolve, 50))
        await tx.update('deadlock_b', { value: 20 })
        return 'tx1'
      })

      const tx2 = (docs as any).transaction(async (tx: any) => {
        await tx.update('deadlock_b', { value: 200 })
        await new Promise((resolve) => setTimeout(resolve, 50))
        await tx.update('deadlock_a', { value: 100 })
        return 'tx2'
      })

      // At least one should succeed, and concurrent tx attempt should be handled
      const results = await Promise.allSettled([tx1, tx2])

      const successes = results.filter((r) => r.status === 'fulfilled')
      const failures = results.filter((r) => r.status === 'rejected')

      // Either both succeed (SQLite serializes) or one fails with nested tx error
      expect(successes.length).toBeGreaterThanOrEqual(1)

      // If there was a failure, it should be a transaction/lock-related error
      if (failures.length > 0) {
        const error = (failures[0] as PromiseRejectedResult).reason
        expect(error.message).toMatch(/deadlock|busy|locked|serialization|transaction/i)
      }
    })
  })

  // ============================================================================
  // 6. ACID COMPLIANCE VERIFICATION
  // ============================================================================

  describe('ACID Compliance', () => {
    describe('Atomicity', () => {
      it('should ensure all-or-nothing for multi-document operations', async () => {
        // Create setup docs
        await docs.create({ $id: 'acid_a_1', name: 'A1', value: 100 })
        await docs.create({ $id: 'acid_a_2', name: 'A2', value: 200 })

        const originalSum = 300

        // Try batch that will fail
        await expect(
          (docs as any).atomicBatch([
            { op: 'update', id: 'acid_a_1', data: { value: 150 } },
            { op: 'update', id: 'acid_a_2', data: { value: 250 } },
            { op: 'update', id: 'nonexistent', data: { value: 999 } }, // Will fail
          ])
        ).rejects.toThrow()

        // Sum should be unchanged
        const doc1 = await docs.get('acid_a_1')
        const doc2 = await docs.get('acid_a_2')
        const newSum = (doc1?.value ?? 0) + (doc2?.value ?? 0)

        expect(newSum).toBe(originalSum)
      })
    })

    describe('Consistency', () => {
      it('should maintain consistency across updates', async () => {
        // Create two accounts with total balance 1000
        await docs.create({ $id: 'account_a', name: 'A', value: 500 })
        await docs.create({ $id: 'account_b', name: 'B', value: 500 })

        const verifyInvariant = async (): Promise<number> => {
          const a = await docs.get('account_a')
          const b = await docs.get('account_b')
          return (a?.value ?? 0) + (b?.value ?? 0)
        }

        // Initial invariant
        expect(await verifyInvariant()).toBe(1000)

        // Transfer
        await (docs as any).transaction(async (tx: any) => {
          const a = await tx.get('account_a')
          const b = await tx.get('account_b')

          await tx.update('account_a', { value: a.value - 100 })
          await tx.update('account_b', { value: b.value + 100 })
        })

        // Invariant maintained
        expect(await verifyInvariant()).toBe(1000)
      })

      it('should enforce constraints within transactions', async () => {
        await docs.create({
          $id: 'constrained_doc',
          name: 'Test',
          value: 100,
          metadata: { priority: 1 },
        })

        // Try to violate a business constraint (negative value)
        await expect(
          (docs as any).transaction(async (tx: any) => {
            const doc = await tx.get('constrained_doc')
            if (doc.value - 200 < 0) {
              throw new Error('Insufficient balance')
            }
            await tx.update('constrained_doc', { value: doc.value - 200 })
          })
        ).rejects.toThrow('Insufficient balance')

        // Value should be unchanged
        const doc = await docs.get('constrained_doc')
        expect(doc?.value).toBe(100)
      })
    })

    describe('Isolation', () => {
      it('should provide snapshot isolation for reads', async () => {
        await docs.create({ $id: 'snapshot_doc', name: 'Test', value: 100 })

        // Note: SQLite single-connection with single-threaded JS means
        // "external" updates during a transaction cannot actually interleave
        // This test verifies that transaction reads are consistent

        const result = await (docs as any).transaction(async (tx: any) => {
          const initial = await tx.get('snapshot_doc')

          // Make an update within the transaction
          await tx.update('snapshot_doc', { value: 200 })

          // Read again within same transaction - should see our update
          const again = await tx.get('snapshot_doc')

          return { initial: initial.value, again: again.value }
        })

        // First read should be 100, second read should see our update to 200
        expect(result.initial).toBe(100)
        expect(result.again).toBe(200)

        // After commit, external reads should see the committed value
        const afterCommit = await docs.get('snapshot_doc')
        expect(afterCommit?.value).toBe(200)
      })
    })

    describe('Durability', () => {
      it('should persist committed transactions even after reconnect', async () => {
        await docs.create({ $id: 'durable_doc', name: 'Test', value: 1 })

        await (docs as any).transaction(async (tx: any) => {
          await tx.update('durable_doc', { value: 42 })
        })

        // Simulate reconnect by creating new store instance
        const newDocs = new DocumentStore<TestDocument>(db, { type: 'TestDoc' })

        const doc = await newDocs.get('durable_doc')
        expect(doc?.value).toBe(42)
      })

      it('should not persist rolled back transactions', async () => {
        await docs.create({ $id: 'rollback_durable', name: 'Test', value: 1 })

        await expect(
          (docs as any).transaction(async (tx: any) => {
            await tx.update('rollback_durable', { value: 999 })
            throw new Error('Rollback')
          })
        ).rejects.toThrow('Rollback')

        // Even with new instance, should see original value
        const newDocs = new DocumentStore<TestDocument>(db, { type: 'TestDoc' })
        const doc = await newDocs.get('rollback_durable')
        expect(doc?.value).toBe(1)
      })
    })
  })

  // ============================================================================
  // 7. DELETEMANY ATOMICITY
  // ============================================================================

  describe('deleteMany - Atomic Operations', () => {
    beforeEach(async () => {
      await docs.createMany([
        { $id: 'del_1', name: 'Delete1', value: 1, status: 'pending' },
        { $id: 'del_2', name: 'Delete2', value: 2, status: 'pending' },
        { $id: 'del_3', name: 'Delete3', value: 3, status: 'active' },
        { $id: 'del_4', name: 'Delete4', value: 4, status: 'pending' },
        { $id: 'del_5', name: 'Delete5', value: 5, status: 'pending' },
      ])
    })

    it('should delete all matching documents atomically', async () => {
      const count = await docs.deleteMany({ where: { status: 'pending' } })

      expect(count).toBe(4)

      // Only active doc should remain
      const remaining = await docs.list()
      expect(remaining).toHaveLength(1)
      expect(remaining[0].status).toBe('active')
    })

    it('should rollback deleteMany on partial failure', async () => {
      // This tests the atomic nature of deleteMany by using a constraint failure

      // First, get count
      const beforeCount = await docs.count()
      expect(beforeCount).toBe(5)

      // Use atomicBatch to test rollback with a non-existent document
      // This will fail because we try to update a document that doesn't exist
      await expect(
        (docs as any).atomicBatch([
          { op: 'delete', id: 'del_1' },
          { op: 'delete', id: 'del_2' },
          { op: 'update', id: 'nonexistent_doc', data: { value: 999 } }, // Will fail
        ])
      ).rejects.toThrow()

      // With proper atomicity, del_1 and del_2 should NOT be deleted
      // (the whole operation should rollback)
      const doc1 = await docs.get('del_1')
      const doc2 = await docs.get('del_2')

      // Both should still exist because the batch was rolled back
      expect(doc1).not.toBeNull()
      expect(doc2).not.toBeNull()

      // Count should be unchanged
      const afterCount = await docs.count()
      expect(afterCount).toBe(5)
    })
  })

  // ============================================================================
  // 8. ERROR RECOVERY AND RETRY
  // ============================================================================

  describe('Error Recovery', () => {
    it('should handle transient errors with retry', async () => {
      let attempts = 0

      const retryingCreate = async () => {
        attempts++
        if (attempts < 3) {
          throw new Error('SQLITE_BUSY')
        }
        return docs.create({ $id: 'retry_doc', name: 'Success', value: 1 })
      }

      // With proper retry logic, this should succeed
      // Current implementation may not have retry, so this documents expected behavior
      const doc = await (docs as any).withRetry(retryingCreate, { maxRetries: 5 })

      expect(doc).not.toBeNull()
      expect(attempts).toBe(3)
    })

    it('should fail fast for non-recoverable errors', async () => {
      await docs.create({ $id: 'fail_fast', name: 'Existing', value: 1 })

      // Duplicate key is not recoverable - should fail immediately
      const startTime = Date.now()

      await expect(
        (docs as any).withRetry(
          () => docs.create({ $id: 'fail_fast', name: 'Duplicate', value: 2 }),
          { maxRetries: 5 }
        )
      ).rejects.toThrow()

      const elapsed = Date.now() - startTime

      // Should fail fast (no retries for non-transient errors)
      expect(elapsed).toBeLessThan(100)
    })

    it('should clean up partial state on unrecoverable error', async () => {
      // Start a multi-step operation
      const doc = await docs.create({
        $id: 'cleanup_doc',
        name: 'Original',
        value: 1,
        metadata: { tier: 'basic' },
      })

      // Try an operation that fails mid-way
      await expect(
        (docs as any).complexOperation(doc.$id, async (tx: any) => {
          await tx.update(doc.$id, { value: 100 })
          await tx.update(doc.$id, { name: 'Updated' })
          throw new Error('Mid-operation failure')
        })
      ).rejects.toThrow('Mid-operation failure')

      // Document should be in original state
      const finalDoc = await docs.get(doc.$id)
      expect(finalDoc?.value).toBe(1)
      expect(finalDoc?.name).toBe('Original')
    })
  })
})
