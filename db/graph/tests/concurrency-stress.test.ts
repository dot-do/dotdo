/**
 * Concurrency Stress Tests
 *
 * TDD RED Phase: Comprehensive concurrency tests for graph operations.
 * These tests verify that the system handles concurrent operations correctly.
 *
 * @see dotdo-d8pyu - [RED] Concurrency Stress Tests
 *
 * ## Test Scenarios
 * - 100 parallel Thing creates
 * - 50 parallel relationship creates with same from/to
 * - Concurrent reads during writes
 * - Transaction isolation verification
 * - Deadlock detection tests
 *
 * ## Store-Specific Tests
 * - OrganizationStore concurrent membership updates
 * - UserStore concurrent role assignments
 * - ActionLifecycleStore concurrent state transitions
 *
 * Uses real SQLiteGraphStore, NO MOCKS - per project testing philosophy.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SQLiteGraphStore } from '../stores/sqlite'
import { ActionLifecycleStore } from '../actions'
import { createOrganizationStore, type OrganizationStore } from '../organization'

// ============================================================================
// TEST SUITE 1: Parallel Thing Creates
// ============================================================================

describe('[RED] Parallel Thing Creates - Stress Tests', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
  })

  afterEach(async () => {
    await store.close()
  })

  /**
   * Test: 100 parallel Thing creates with unique IDs
   *
   * Expected behavior: All 100 Things should be created successfully
   * with no data loss or corruption. Each Thing should have the correct
   * data and all IDs should be unique.
   */
  it('handles 100 parallel Thing creates with unique IDs', async () => {
    const count = 100
    const typeId = 1 // Assume type 1 exists
    const typeName = 'TestEntity'

    // Launch 100 parallel create operations
    const promises = Array.from({ length: count }, (_, i) =>
      store.createThing({
        id: `stress-test-entity-${i}`,
        typeId,
        typeName,
        data: { index: i, name: `Entity ${i}`, createdBy: 'stress-test' },
      })
        .then((thing) => ({ success: true as const, thing, index: i }))
        .catch((error) => ({ success: false as const, error, index: i }))
    )

    const results = await Promise.all(promises)

    // All 100 should succeed
    const successes = results.filter((r) => r.success)
    const failures = results.filter((r) => !r.success)

    expect(failures.length).toBe(0)
    expect(successes.length).toBe(count)

    // Verify all Things exist with correct data
    const allThings = await store.getThingsByType({ typeName, limit: 200 })

    expect(allThings.length).toBe(count)

    // Verify each Thing has correct data
    for (const thing of allThings) {
      expect(thing.typeName).toBe(typeName)
      expect(thing.data).toBeDefined()
      const data = thing.data as { index: number; name: string; createdBy: string }
      expect(data.createdBy).toBe('stress-test')
      expect(data.name).toMatch(/^Entity \d+$/)
    }

    // Verify no duplicate IDs
    const ids = allThings.map((t) => t.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(count)
  })

  /**
   * Test: 100 parallel creates attempting same ID (conflict resolution)
   *
   * Expected behavior: Only ONE should succeed, rest should fail with
   * unique constraint violation. No duplicates should exist.
   */
  it('only allows one Thing when 100 concurrent creates use same ID', async () => {
    const count = 100
    const sharedId = 'shared-id-conflict-test'
    const typeId = 1
    const typeName = 'ConflictTest'

    // Launch 100 parallel creates with the SAME ID
    const promises = Array.from({ length: count }, (_, i) =>
      store.createThing({
        id: sharedId,
        typeId,
        typeName,
        data: { attempt: i },
      })
        .then((thing) => ({ success: true as const, thing, index: i }))
        .catch((error) => ({ success: false as const, error, index: i }))
    )

    const results = await Promise.all(promises)

    // Only ONE should succeed
    const successes = results.filter((r) => r.success)
    const failures = results.filter((r) => !r.success)

    expect(successes.length).toBe(1)
    expect(failures.length).toBe(count - 1)

    // Verify only one Thing exists
    const thing = await store.getThing(sharedId)
    expect(thing).not.toBeNull()

    // Verify no duplicates in database
    const allThings = await store.getThingsByType({ typeName, limit: 200 })
    expect(allThings.length).toBe(1)
  })

  /**
   * Test: Rapid fire creates with updates interleaved
   *
   * Expected behavior: All creates and updates complete successfully
   * without data corruption. Final state should reflect the updates.
   */
  it('handles interleaved creates and updates under load', async () => {
    const createCount = 50
    const typeId = 1
    const typeName = 'InterleavedTest'

    // First, create 50 Things
    const createPromises = Array.from({ length: createCount }, (_, i) =>
      store.createThing({
        id: `interleaved-${i}`,
        typeId,
        typeName,
        data: { version: 0, index: i },
      })
    )

    const created = await Promise.all(createPromises)
    expect(created.length).toBe(createCount)

    // Now, run concurrent updates on all 50 Things
    const updatePromises = created.flatMap((thing) => [
      store.updateThing(thing.id, { data: { version: 1, index: (thing.data as { index: number }).index } }),
      store.updateThing(thing.id, { data: { version: 2, index: (thing.data as { index: number }).index } }),
      store.updateThing(thing.id, { data: { version: 3, index: (thing.data as { index: number }).index } }),
    ])

    const updateResults = await Promise.allSettled(updatePromises)

    // All updates should succeed (or at least not throw unrecoverable errors)
    const updateFailures = updateResults.filter((r) => r.status === 'rejected')
    expect(updateFailures.length).toBe(0)

    // Verify all Things still exist
    const allThings = await store.getThingsByType({ typeName, limit: 100 })
    expect(allThings.length).toBe(createCount)

    // Each Thing should have version >= 1 (was updated at least once)
    for (const thing of allThings) {
      const data = thing.data as { version: number }
      expect(data.version).toBeGreaterThanOrEqual(1)
    }
  })

  /**
   * Test: Mixed operations - creates, reads, and deletes in parallel
   *
   * Expected behavior: All operations complete without crashing.
   * Deleted items should not be retrievable.
   */
  it('handles mixed creates, reads, and deletes in parallel', async () => {
    const typeId = 1
    const typeName = 'MixedOpsTest'

    // Create initial batch
    const initialThings = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.createThing({
          id: `mixed-ops-${i}`,
          typeId,
          typeName,
          data: { created: true, index: i },
        })
      )
    )

    // Run mixed operations in parallel:
    // - Delete half the things
    // - Read all things
    // - Create 10 new things
    const deletePromises = initialThings.slice(0, 10).map((t) =>
      store.deleteThing(t.id)
    )
    const readPromises = Array.from({ length: 20 }, () =>
      store.getThingsByType({ typeName, limit: 100 })
    )
    const createPromises = Array.from({ length: 10 }, (_, i) =>
      store.createThing({
        id: `mixed-ops-new-${i}`,
        typeId,
        typeName,
        data: { created: true, index: 20 + i },
      })
    )

    const allResults = await Promise.allSettled([
      ...deletePromises,
      ...readPromises,
      ...createPromises,
    ])

    // All operations should complete (not throw)
    const rejected = allResults.filter((r) => r.status === 'rejected')
    expect(rejected.length).toBe(0)

    // Verify final state: 20 active Things (10 original + 10 new)
    const finalThings = await store.getThingsByType({ typeName, limit: 100 })
    expect(finalThings.length).toBe(20)
  })
})

// ============================================================================
// TEST SUITE 2: Parallel Relationship Creates
// ============================================================================

describe('[RED] Parallel Relationship Creates - Stress Tests', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
  })

  afterEach(async () => {
    await store.close()
  })

  /**
   * Test: 50 parallel relationship creates with same from/to but unique IDs
   *
   * Expected behavior: All 50 relationships should be created, as they have
   * unique IDs even though they connect the same nodes. The unique constraint
   * is on (verb, from, to), so same verb/from/to combinations should fail.
   */
  it('handles 50 parallel relationships with same verb/from/to (only one succeeds)', async () => {
    const count = 50
    const fromUrl = 'https://users.do/alice'
    const toUrl = 'https://projects.do/proj-1'
    const verb = 'owns'

    // Launch 50 parallel creates with SAME verb/from/to but different IDs
    const promises = Array.from({ length: count }, (_, i) =>
      store.createRelationship({
        id: `rel-conflict-${i}`,
        verb,
        from: fromUrl,
        to: toUrl,
        data: { attempt: i },
      })
        .then((rel) => ({ success: true as const, rel, index: i }))
        .catch((error) => ({ success: false as const, error, index: i }))
    )

    const results = await Promise.all(promises)

    // Due to unique constraint on (verb, from, to), only ONE should succeed
    const successes = results.filter((r) => r.success)
    const failures = results.filter((r) => !r.success)

    expect(successes.length).toBe(1)
    expect(failures.length).toBe(count - 1)

    // Verify only one relationship exists
    const relationships = await store.queryRelationshipsFrom(fromUrl, { verb })
    expect(relationships.length).toBe(1)
    expect(relationships[0].to).toBe(toUrl)
  })

  /**
   * Test: 50 parallel relationships with unique verbs
   *
   * Expected behavior: All 50 should succeed since they have different verbs.
   */
  it('handles 50 parallel relationships with unique verbs', async () => {
    const count = 50
    const fromUrl = 'https://users.do/bob'
    const toUrl = 'https://resources.do/resource-1'

    // Launch 50 parallel creates with different verbs
    const promises = Array.from({ length: count }, (_, i) =>
      store.createRelationship({
        id: `rel-unique-verb-${i}`,
        verb: `verb-${i}`,
        from: fromUrl,
        to: toUrl,
        data: { index: i },
      })
        .then((rel) => ({ success: true as const, rel, index: i }))
        .catch((error) => ({ success: false as const, error, index: i }))
    )

    const results = await Promise.all(promises)

    // All should succeed
    const successes = results.filter((r) => r.success)
    const failures = results.filter((r) => !r.success)

    expect(failures.length).toBe(0)
    expect(successes.length).toBe(count)

    // Verify all relationships exist
    const relationships = await store.queryRelationshipsFrom(fromUrl)
    expect(relationships.length).toBe(count)
  })

  /**
   * Test: Fan-out pattern - one source to many targets
   *
   * Expected behavior: All relationships from one source to many targets
   * should be created successfully.
   */
  it('handles fan-out: 100 relationships from one source to 100 targets', async () => {
    const count = 100
    const fromUrl = 'https://users.do/fanout-user'
    const verb = 'follows'

    // Create 100 relationships from one source to 100 different targets
    const promises = Array.from({ length: count }, (_, i) =>
      store.createRelationship({
        id: `fanout-${i}`,
        verb,
        from: fromUrl,
        to: `https://users.do/target-${i}`,
        data: { index: i },
      })
    )

    const results = await Promise.all(promises)
    expect(results.length).toBe(count)

    // Query all outgoing relationships
    const relationships = await store.queryRelationshipsFrom(fromUrl)
    expect(relationships.length).toBe(count)
  })

  /**
   * Test: Fan-in pattern - many sources to one target
   *
   * Expected behavior: All relationships from many sources to one target
   * should be created successfully.
   */
  it('handles fan-in: 100 relationships from 100 sources to one target', async () => {
    const count = 100
    const toUrl = 'https://projects.do/popular-project'
    const verb = 'stars'

    // Create 100 relationships from different sources to one target
    const promises = Array.from({ length: count }, (_, i) =>
      store.createRelationship({
        id: `fanin-${i}`,
        verb,
        from: `https://users.do/source-${i}`,
        to: toUrl,
        data: { index: i },
      })
    )

    const results = await Promise.all(promises)
    expect(results.length).toBe(count)

    // Query all incoming relationships
    const relationships = await store.queryRelationshipsTo(toUrl)
    expect(relationships.length).toBe(count)
  })
})

// ============================================================================
// TEST SUITE 3: Concurrent Reads During Writes
// ============================================================================

describe('[RED] Concurrent Reads During Writes', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
  })

  afterEach(async () => {
    await store.close()
  })

  /**
   * Test: Continuous reads while writes are happening
   *
   * Expected behavior: Reads should always return consistent data.
   * A Thing should never be in a partially-written state.
   */
  it('reads return consistent data while writes are in progress', async () => {
    const typeId = 1
    const typeName = 'ReadDuringWrite'
    const thingId = 'read-write-test'

    // Create initial Thing
    await store.createThing({
      id: thingId,
      typeId,
      typeName,
      data: { version: 0, complete: true },
    })

    // Run concurrent reads and updates
    const readPromises: Promise<unknown>[] = []
    const writePromises: Promise<unknown>[] = []

    for (let i = 1; i <= 50; i++) {
      // Spawn reads continuously
      readPromises.push(
        store.getThing(thingId).then((thing) => {
          // Every read should return complete data
          if (thing) {
            const data = thing.data as { complete?: boolean }
            expect(data.complete).toBe(true)
          }
          return thing
        })
      )

      // Spawn writes
      writePromises.push(
        store.updateThing(thingId, {
          data: { version: i, complete: true },
        })
      )
    }

    // Wait for all operations
    await Promise.all([...readPromises, ...writePromises])

    // Final verification
    const finalThing = await store.getThing(thingId)
    expect(finalThing).not.toBeNull()
    const finalData = finalThing?.data as { version: number; complete: boolean }
    expect(finalData.complete).toBe(true)
    expect(finalData.version).toBeGreaterThan(0)
  })

  /**
   * Test: Query results during bulk insert
   *
   * Expected behavior: Query results should be consistent.
   * A query should never see partially inserted batch.
   */
  it('queries return consistent results during bulk inserts', async () => {
    const typeId = 1
    const typeName = 'BulkInsertQuery'
    const batchSize = 20
    const batches = 5

    const inconsistentResults: number[] = []

    // Run concurrent batch inserts and queries
    const operations: Promise<void>[] = []

    for (let batch = 0; batch < batches; batch++) {
      // Insert a batch
      operations.push(
        (async () => {
          for (let i = 0; i < batchSize; i++) {
            await store.createThing({
              id: `bulk-${batch}-${i}`,
              typeId,
              typeName,
              data: { batch, index: i },
            })
          }
        })()
      )

      // Query during insert
      operations.push(
        (async () => {
          for (let q = 0; q < 10; q++) {
            const results = await store.getThingsByType({ typeName, limit: 200 })
            // Results should be a multiple of batch size (complete batches)
            // Or the current in-progress batch
            // Just verify we don't crash and get reasonable results
            if (results.length % batchSize !== 0 && results.length !== 0) {
              // This could be a partial batch during insert - that's expected
              // But data should still be valid
              for (const thing of results) {
                expect(thing.typeName).toBe(typeName)
                expect(thing.data).toBeDefined()
              }
            }
          }
        })()
      )
    }

    await Promise.all(operations)

    // Final count
    const finalResults = await store.getThingsByType({ typeName, limit: 200 })
    expect(finalResults.length).toBe(batches * batchSize)
  })

  /**
   * Test: Read-your-writes consistency
   *
   * Expected behavior: After a write completes, a subsequent read
   * should see the written data.
   */
  it('guarantees read-your-writes consistency', async () => {
    const typeId = 1
    const typeName = 'ReadYourWrites'

    // Run many write-then-read sequences in parallel
    const sequences = Array.from({ length: 50 }, async (_, i) => {
      const id = `ryw-${i}`

      // Write
      await store.createThing({
        id,
        typeId,
        typeName,
        data: { value: i },
      })

      // Immediately read
      const thing = await store.getThing(id)

      // Must see our write
      expect(thing).not.toBeNull()
      expect(thing?.id).toBe(id)
      const data = thing?.data as { value: number }
      expect(data.value).toBe(i)
    })

    await Promise.all(sequences)
  })
})

// ============================================================================
// TEST SUITE 4: Transaction Isolation Verification
// ============================================================================

describe('[RED] Transaction Isolation Verification', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
  })

  afterEach(async () => {
    await store.close()
  })

  /**
   * Test: Dirty read prevention
   *
   * Expected behavior: A read should never see uncommitted data
   * from another transaction.
   */
  it('prevents dirty reads', async () => {
    const typeId = 1
    const typeName = 'DirtyReadTest'
    const thingId = 'dirty-read-test'

    // Create initial Thing
    await store.createThing({
      id: thingId,
      typeId,
      typeName,
      data: { status: 'initial' },
    })

    // Concurrent update and read
    // The read should see either 'initial' or 'updated', never partial
    const operations = await Promise.allSettled([
      store.updateThing(thingId, { data: { status: 'updated' } }),
      store.getThing(thingId),
      store.getThing(thingId),
      store.updateThing(thingId, { data: { status: 'final' } }),
      store.getThing(thingId),
    ])

    // All operations should succeed
    const failures = operations.filter((r) => r.status === 'rejected')
    expect(failures.length).toBe(0)

    // Reads should have valid status values
    const reads = operations.filter(
      (r) => r.status === 'fulfilled' && r.value !== null && 'status' in ((r.value as { data?: { status?: string } })?.data ?? {})
    )

    for (const read of reads) {
      if (read.status === 'fulfilled') {
        const thing = read.value as { data: { status: string } } | null
        if (thing) {
          expect(['initial', 'updated', 'final']).toContain(thing.data.status)
        }
      }
    }
  })

  /**
   * Test: Lost update prevention
   *
   * Expected behavior: Concurrent updates to the same Thing should not
   * result in lost updates. The final value should reflect one of the
   * update operations, not overwritten data.
   */
  it('prevents lost updates with proper serialization', async () => {
    const typeId = 1
    const typeName = 'LostUpdateTest'
    const thingId = 'lost-update-test'

    // Create Thing with a counter
    await store.createThing({
      id: thingId,
      typeId,
      typeName,
      data: { counter: 0 },
    })

    // Run 100 concurrent "increment" operations
    const incrementCount = 100
    const increments = Array.from({ length: incrementCount }, async () => {
      // Read current value
      const current = await store.getThing(thingId)
      const currentCounter = (current?.data as { counter: number })?.counter ?? 0

      // Update with incremented value
      await store.updateThing(thingId, {
        data: { counter: currentCounter + 1 },
      })
    })

    await Promise.all(increments)

    // Check final value
    const final = await store.getThing(thingId)
    const finalCounter = (final?.data as { counter: number })?.counter

    // Without proper concurrency control, the counter will be << 100
    // With proper control, it should be exactly 100
    // This test is expected to FAIL in RED phase, exposing the lost update problem
    expect(finalCounter).toBe(incrementCount)
  })

  /**
   * Test: Phantom read prevention
   *
   * Expected behavior: A range query should return consistent results
   * even if other operations are inserting/deleting records.
   */
  it('prevents phantom reads in range queries', async () => {
    const typeId = 1
    const typeName = 'PhantomReadTest'

    // Create initial set
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        store.createThing({
          id: `phantom-${i}`,
          typeId,
          typeName,
          data: { value: i },
        })
      )
    )

    // Run concurrent queries and inserts
    const operations: Promise<unknown>[] = []

    // Queries
    for (let i = 0; i < 20; i++) {
      operations.push(
        store.getThingsByType({ typeName, limit: 100 }).then((results) => {
          // Each query should see a consistent snapshot
          // The count might change between queries, but within
          // a single query, data should be consistent
          for (const thing of results) {
            expect(thing.typeName).toBe(typeName)
            expect(thing.data).toBeDefined()
          }
          return results.length
        })
      )
    }

    // Inserts
    for (let i = 10; i < 30; i++) {
      operations.push(
        store.createThing({
          id: `phantom-${i}`,
          typeId,
          typeName,
          data: { value: i },
        })
      )
    }

    await Promise.all(operations)

    // Final count should be 30
    const finalResults = await store.getThingsByType({ typeName, limit: 100 })
    expect(finalResults.length).toBe(30)
  })
})

// ============================================================================
// TEST SUITE 5: Deadlock Detection Tests
// ============================================================================

describe('[RED] Deadlock Detection Tests', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
  })

  afterEach(async () => {
    await store.close()
  })

  /**
   * Test: Circular update pattern (potential deadlock)
   *
   * Scenario: Two operations try to update Things in opposite order.
   * Op1: Update A, then B
   * Op2: Update B, then A
   *
   * Expected behavior: Both operations complete without deadlock.
   * The system should either serialize them or detect and resolve deadlock.
   */
  it('handles circular update pattern without deadlock', async () => {
    const typeId = 1
    const typeName = 'DeadlockTest'

    // Create two Things
    await store.createThing({
      id: 'deadlock-a',
      typeId,
      typeName,
      data: { value: 'A' },
    })
    await store.createThing({
      id: 'deadlock-b',
      typeId,
      typeName,
      data: { value: 'B' },
    })

    // Attempt circular update pattern
    const op1 = async () => {
      await store.updateThing('deadlock-a', { data: { value: 'A-op1' } })
      await store.updateThing('deadlock-b', { data: { value: 'B-op1' } })
    }

    const op2 = async () => {
      await store.updateThing('deadlock-b', { data: { value: 'B-op2' } })
      await store.updateThing('deadlock-a', { data: { value: 'A-op2' } })
    }

    // Run with timeout to detect deadlock
    const timeoutMs = 5000
    const results = await Promise.race([
      Promise.allSettled([op1(), op2()]),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), timeoutMs)),
    ])

    // Should complete, not timeout (no deadlock)
    expect(results).not.toBe('timeout')

    if (results !== 'timeout') {
      const failures = results.filter((r) => r.status === 'rejected')
      expect(failures.length).toBe(0)
    }

    // Both Things should have updated values
    const thingA = await store.getThing('deadlock-a')
    const thingB = await store.getThing('deadlock-b')

    expect(thingA).not.toBeNull()
    expect(thingB).not.toBeNull()
  })

  /**
   * Test: Many-to-many update pattern
   *
   * Multiple operations all trying to update the same set of Things
   * in different orders. Should not deadlock.
   */
  it('handles many-to-many update pattern without deadlock', async () => {
    const typeId = 1
    const typeName = 'ManyToManyDeadlock'
    const thingCount = 5

    // Create Things
    await Promise.all(
      Array.from({ length: thingCount }, (_, i) =>
        store.createThing({
          id: `mm-${i}`,
          typeId,
          typeName,
          data: { value: i },
        })
      )
    )

    // Create operations that update Things in different orders
    const operations = Array.from({ length: 10 }, (_, opIndex) => async () => {
      // Shuffle order for each operation
      const indices = Array.from({ length: thingCount }, (_, i) => i)
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor((opIndex + i) % (i + 1))
        ;[indices[i], indices[j]] = [indices[j], indices[i]]
      }

      // Update in shuffled order
      for (const idx of indices) {
        await store.updateThing(`mm-${idx}`, { data: { value: `op${opIndex}-${idx}` } })
      }
    })

    // Run all operations with timeout
    const timeoutMs = 10000
    const results = await Promise.race([
      Promise.allSettled(operations.map((op) => op())),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), timeoutMs)),
    ])

    expect(results).not.toBe('timeout')

    // All Things should still exist
    const allThings = await store.getThingsByType({ typeName, limit: 100 })
    expect(allThings.length).toBe(thingCount)
  })

  /**
   * Test: Resource contention with relationship creation
   *
   * Multiple operations creating relationships between overlapping
   * sets of nodes. Should complete without deadlock.
   */
  it('handles relationship creation contention without deadlock', async () => {
    const verb = 'connects'
    const nodeCount = 10
    const operationCount = 50

    // Create relationships in various patterns
    const operations = Array.from({ length: operationCount }, (_, i) =>
      store.createRelationship({
        id: `contention-${i}`,
        verb: `${verb}-${i % 5}`, // 5 different verbs to allow some duplicates
        from: `https://nodes.do/node-${i % nodeCount}`,
        to: `https://nodes.do/node-${(i + 1) % nodeCount}`,
        data: { index: i },
      })
        .then(() => ({ success: true as const }))
        .catch((error) => ({ success: false as const, error }))
    )

    const timeoutMs = 10000
    const results = await Promise.race([
      Promise.all(operations),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), timeoutMs)),
    ])

    expect(results).not.toBe('timeout')
  })
})

// ============================================================================
// TEST SUITE 6: OrganizationStore Concurrent Membership Updates
// ============================================================================

describe('[RED] OrganizationStore Concurrent Membership Updates', () => {
  let graphStore: SQLiteGraphStore
  let orgStore: OrganizationStore

  beforeEach(async () => {
    graphStore = new SQLiteGraphStore(':memory:')
    await graphStore.initialize()
    // Create organization store using the graph engine pattern
    const { GraphEngine } = await import('../graph-engine')
    const engine = new GraphEngine()
    orgStore = createOrganizationStore(engine)
  })

  afterEach(async () => {
    await graphStore.close()
  })

  /**
   * Test: Concurrent member additions to same organization
   *
   * Expected behavior: All valid member additions should succeed.
   * No duplicate memberships should be created.
   */
  it('handles concurrent member additions without duplicates', async () => {
    // Create organization
    const org = await orgStore.create({
      name: 'Test Org',
      slug: 'concurrent-membership-test',
      type: 'company',
      status: 'active',
    })

    const memberCount = 50

    // Add 50 members concurrently
    const promises = Array.from({ length: memberCount }, (_, i) =>
      orgStore.addMember(org.id, `user-${i}`, {
        role: 'member',
        status: 'active',
      })
        .then((membership) => ({ success: true as const, membership }))
        .catch((error) => ({ success: false as const, error }))
    )

    const results = await Promise.all(promises)

    // All should succeed
    const successes = results.filter((r) => r.success)
    expect(successes.length).toBe(memberCount)

    // Verify member count
    const members = await orgStore.getMembers(org.id)
    expect(members.length).toBe(memberCount)

    // Verify no duplicate user IDs
    const userIds = members.map((m) => m.userId)
    const uniqueUserIds = new Set(userIds)
    expect(uniqueUserIds.size).toBe(memberCount)
  })

  /**
   * Test: Adding same user to organization concurrently
   *
   * Expected behavior: Only ONE membership should be created.
   * Duplicate attempts should fail.
   */
  it('prevents duplicate memberships when adding same user concurrently', async () => {
    const org = await orgStore.create({
      name: 'Duplicate Test Org',
      slug: 'duplicate-member-test',
      type: 'company',
      status: 'active',
    })

    const userId = 'duplicate-user'
    const concurrentCount = 10

    // Try to add the same user 10 times concurrently
    const promises = Array.from({ length: concurrentCount }, () =>
      orgStore.addMember(org.id, userId, {
        role: 'member',
        status: 'active',
      })
        .then((membership) => ({ success: true as const, membership }))
        .catch((error) => ({ success: false as const, error }))
    )

    const results = await Promise.all(promises)

    // Only ONE should succeed
    const successes = results.filter((r) => r.success)
    expect(successes.length).toBe(1)

    // Verify only one membership exists
    const isMember = await orgStore.isMember(org.id, userId)
    expect(isMember).toBe(true)

    const members = await orgStore.getMembers(org.id)
    const userMemberships = members.filter((m) => m.userId === userId)
    expect(userMemberships.length).toBe(1)
  })

  /**
   * Test: Concurrent role updates for same member
   *
   * Expected behavior: All updates complete. Final role should be
   * one of the requested values, not corrupted.
   */
  it('handles concurrent role updates for same member', async () => {
    const org = await orgStore.create({
      name: 'Role Update Org',
      slug: 'role-update-test',
      type: 'company',
      status: 'active',
    })

    const userId = 'role-update-user'

    // Add member first
    await orgStore.addMember(org.id, userId, {
      role: 'member',
      status: 'active',
    })

    // Concurrent role updates
    const roles: ('admin' | 'member' | 'guest' | 'owner')[] = ['admin', 'member', 'guest', 'owner', 'admin']

    const promises = roles.map((role) =>
      orgStore.updateMemberRole(org.id, userId, role)
    )

    await Promise.allSettled(promises)

    // Final role should be one of the valid roles
    const finalRole = await orgStore.getMemberRole(org.id, userId)
    expect(roles).toContain(finalRole)
  })

  /**
   * Test: Concurrent add and remove of same member
   *
   * Expected behavior: Member should end up either present or absent,
   * not in a corrupted state.
   */
  it('handles concurrent add and remove of same member', async () => {
    const org = await orgStore.create({
      name: 'Add Remove Org',
      slug: 'add-remove-test',
      type: 'company',
      status: 'active',
    })

    const userId = 'add-remove-user'

    // Run add and remove in parallel multiple times
    for (let round = 0; round < 5; round++) {
      await Promise.allSettled([
        orgStore.addMember(org.id, userId, { role: 'member', status: 'active' }),
        orgStore.removeMember(org.id, userId),
        orgStore.addMember(org.id, userId, { role: 'admin', status: 'active' }),
        orgStore.removeMember(org.id, userId),
      ])
    }

    // Member should be in a consistent state
    const isMember = await orgStore.isMember(org.id, userId)
    // Either member or not, but not corrupted
    expect(typeof isMember).toBe('boolean')

    const members = await orgStore.getMembers(org.id)
    const userMemberships = members.filter((m) => m.userId === userId)
    // Should have 0 or 1 membership, never more
    expect(userMemberships.length).toBeLessThanOrEqual(1)
  })
})

// ============================================================================
// TEST SUITE 7: ActionLifecycleStore Concurrent State Transitions
// ============================================================================

describe('[RED] ActionLifecycleStore Concurrent State Transitions', () => {
  let store: SQLiteGraphStore
  let lifecycle: ActionLifecycleStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
    lifecycle = new ActionLifecycleStore(store)
  })

  afterEach(async () => {
    await store.close()
  })

  /**
   * Test: Concurrent starts of same action
   *
   * Expected behavior: Only ONE start should succeed.
   * Action can only be started once.
   */
  it('only allows one start when same action is started concurrently', async () => {
    // Create action
    const action = await lifecycle.createAction({
      verb: 'create',
      from: 'https://users.do/alice',
      to: 'https://projects.do/new-project',
    })

    const concurrentCount = 10

    // Try to start the same action 10 times concurrently
    const promises = Array.from({ length: concurrentCount }, () =>
      lifecycle.startAction(action.id)
        .then((activity) => ({ success: true as const, activity }))
        .catch((error) => ({ success: false as const, error }))
    )

    const results = await Promise.all(promises)

    // Only ONE should succeed
    const successes = results.filter((r) => r.success)
    expect(successes.length).toBe(1)

    // The successful one should have activity verb form
    if (successes[0].success) {
      expect(successes[0].activity.verb).toBe('creating')
    }
  })

  /**
   * Test: Concurrent completes of same activity
   *
   * Expected behavior: Only ONE complete should succeed.
   * Activity can only be completed once.
   */
  it('only allows one complete when same activity is completed concurrently', async () => {
    // Create and start action
    const action = await lifecycle.createAction({
      verb: 'create',
      from: 'https://users.do/bob',
      to: 'https://projects.do/project-123',
    })

    const activity = await lifecycle.startAction(action.id)

    const concurrentCount = 10

    // Try to complete the same activity 10 times concurrently
    const promises = Array.from({ length: concurrentCount }, (_, i) =>
      lifecycle.completeAction(activity.id, `https://results.do/result-${i}`)
        .then((event) => ({ success: true as const, event }))
        .catch((error) => ({ success: false as const, error }))
    )

    const results = await Promise.all(promises)

    // Only ONE should succeed
    const successes = results.filter((r) => r.success)
    expect(successes.length).toBe(1)

    // The successful one should have event verb form
    if (successes[0].success) {
      expect(successes[0].event.verb).toBe('created')
    }
  })

  /**
   * Test: Concurrent fail and complete of same activity
   *
   * Expected behavior: Only ONE should succeed (either fail OR complete).
   * Activity cannot be both failed and completed.
   */
  it('handles concurrent fail and complete - only one succeeds', async () => {
    const action = await lifecycle.createAction({
      verb: 'update',
      from: 'https://users.do/charlie',
      to: 'https://documents.do/doc-456',
    })

    const activity = await lifecycle.startAction(action.id)

    // Try to both fail and complete concurrently
    const results = await Promise.allSettled([
      lifecycle.completeAction(activity.id, 'https://results.do/completed'),
      lifecycle.failAction(activity.id, new Error('Failed!')),
      lifecycle.completeAction(activity.id, 'https://results.do/completed-2'),
      lifecycle.failAction(activity.id, new Error('Failed again!')),
    ])

    // Count successes
    const successes = results.filter((r) => r.status === 'fulfilled')

    // Only ONE should succeed
    expect(successes.length).toBe(1)
  })

  /**
   * Test: Many actions created and transitioned concurrently
   *
   * Expected behavior: All independent actions should progress
   * through their lifecycle correctly.
   */
  it('handles many concurrent action lifecycles', async () => {
    const actionCount = 50

    // Create 50 actions
    const actions = await Promise.all(
      Array.from({ length: actionCount }, (_, i) =>
        lifecycle.createAction({
          verb: 'process',
          from: `https://workers.do/worker-${i}`,
          to: `https://tasks.do/task-${i}`,
          data: { index: i },
        })
      )
    )

    expect(actions.length).toBe(actionCount)

    // Start all actions concurrently
    const activities = await Promise.all(
      actions.map((action) => lifecycle.startAction(action.id))
    )

    expect(activities.length).toBe(actionCount)

    // All should be in activity form
    for (const activity of activities) {
      expect(activity.verb).toBe('processing')
    }

    // Complete all activities concurrently
    const events = await Promise.all(
      activities.map((activity, i) =>
        lifecycle.completeAction(activity.id, `https://results.do/result-${i}`)
      )
    )

    expect(events.length).toBe(actionCount)

    // All should be in event form
    for (const event of events) {
      expect(event.verb).toBe('processed')
    }
  })

  /**
   * Test: Rapid create-start-complete cycles
   *
   * Expected behavior: Each lifecycle should complete independently.
   * No state corruption between lifecycles.
   */
  it('handles rapid create-start-complete cycles', async () => {
    const cycleCount = 20

    const cycles = Array.from({ length: cycleCount }, async (_, i) => {
      // Create
      const action = await lifecycle.createAction({
        verb: 'deploy',
        from: `https://pipelines.do/pipeline-${i}`,
        to: `https://environments.do/env-${i}`,
      })

      // Start
      const activity = await lifecycle.startAction(action.id)
      expect(activity.verb).toBe('deploying')

      // Complete
      const event = await lifecycle.completeAction(
        activity.id,
        `https://deployments.do/deployment-${i}`
      )
      expect(event.verb).toBe('deployed')

      return event
    })

    const results = await Promise.all(cycles)
    expect(results.length).toBe(cycleCount)

    // Each event should have unique to URL
    const toUrls = results.map((e) => e.to)
    const uniqueToUrls = new Set(toUrls)
    expect(uniqueToUrls.size).toBe(cycleCount)
  })
})

// ============================================================================
// TEST SUITE 8: Stress Tests at Scale
// ============================================================================

describe('[RED] Scale Stress Tests', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
  })

  afterEach(async () => {
    await store.close()
  })

  /**
   * Test: 1000 Things created in parallel batches
   *
   * Expected behavior: All 1000 Things created successfully
   * without performance degradation or failures.
   */
  it('creates 1000 Things in parallel batches', async () => {
    const totalCount = 1000
    const batchSize = 100
    const typeId = 1
    const typeName = 'ScaleTest'

    const batches = Math.ceil(totalCount / batchSize)
    let createdCount = 0

    for (let batch = 0; batch < batches; batch++) {
      const start = batch * batchSize
      const end = Math.min(start + batchSize, totalCount)

      const promises = Array.from({ length: end - start }, (_, i) =>
        store.createThing({
          id: `scale-${start + i}`,
          typeId,
          typeName,
          data: { index: start + i },
        })
      )

      const results = await Promise.all(promises)
      createdCount += results.length
    }

    expect(createdCount).toBe(totalCount)

    // Verify count
    const allThings = await store.getThingsByType({ typeName, limit: 1500 })
    expect(allThings.length).toBe(totalCount)
  })

  /**
   * Test: High-frequency reads during writes
   *
   * Simulates a read-heavy workload with occasional writes.
   */
  it('handles high read frequency during writes', async () => {
    const typeId = 1
    const typeName = 'ReadHeavy'

    // Create some initial data
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        store.createThing({
          id: `read-heavy-${i}`,
          typeId,
          typeName,
          data: { value: i },
        })
      )
    )

    // Run 1000 reads and 10 writes concurrently
    const readPromises = Array.from({ length: 1000 }, () =>
      store.getThingsByType({ typeName, limit: 100 })
    )

    const writePromises = Array.from({ length: 10 }, (_, i) =>
      store.createThing({
        id: `read-heavy-new-${i}`,
        typeId,
        typeName,
        data: { value: 10 + i },
      })
    )

    const startTime = Date.now()
    await Promise.all([...readPromises, ...writePromises])
    const duration = Date.now() - startTime

    // Should complete in reasonable time (< 10 seconds)
    expect(duration).toBeLessThan(10000)

    // Final count should be 20
    const finalThings = await store.getThingsByType({ typeName, limit: 100 })
    expect(finalThings.length).toBe(20)
  })
})
