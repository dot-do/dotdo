/**
 * Concurrency Stress Tests for SQLiteGraphStore
 *
 * TDD RED PHASE: Comprehensive tests to verify data integrity under concurrent
 * operations. These tests expose race conditions, deadlocks, and data loss
 * scenarios that can occur with parallel operations.
 *
 * @see dotdo-d8pyu - [RED] Concurrency Stress Tests
 *
 * Test Scenarios:
 * 1. 100 parallel Thing creates - verify all are created without data loss
 * 2. 50 parallel relationship creates with same from/to - verify unique constraint
 * 3. Concurrent reads during writes - verify read consistency
 * 4. Transaction isolation verification - verify atomicity
 * 5. Deadlock detection tests - verify no infinite waits
 *
 * NO MOCKS - Uses real SQLiteGraphStore per project testing philosophy.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SQLiteGraphStore } from '../stores/sqlite'
import type { GraphThing, GraphRelationship } from '../types'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Generate a unique ID with prefix and index.
 */
function thingId(prefix: string, index: number): string {
  return `${prefix}-${index}`
}

/**
 * Generate a unique relationship ID.
 */
function relId(prefix: string, index: number): string {
  return `rel-${prefix}-${index}`
}

/**
 * Track timing for performance analysis.
 */
interface TimingResult<T> {
  result: T
  durationMs: number
}

async function timed<T>(fn: () => Promise<T>): Promise<TimingResult<T>> {
  const start = Date.now()
  const result = await fn()
  const durationMs = Date.now() - start
  return { result, durationMs }
}

// ============================================================================
// PARALLEL THING CREATES
// ============================================================================

describe('Concurrency Stress Tests', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
  })

  afterEach(async () => {
    await store.close()
  })

  describe('Parallel Thing creates', () => {
    it('should handle 100 parallel creates without data loss', async () => {
      const count = 100
      const creates = Array.from({ length: count }, (_, i) =>
        store.createThing({
          id: thingId('concurrent', i),
          typeId: 500, // Customer type from NOUN_REGISTRY
          typeName: 'Customer',
          data: { index: i, name: `Customer ${i}` },
        })
      )

      const results = await Promise.allSettled(creates)
      const successes = results.filter((r) => r.status === 'fulfilled')
      const failures = results.filter((r) => r.status === 'rejected')

      // ALL should succeed - each has unique ID
      expect(successes.length).toBe(count)
      expect(failures.length).toBe(0)

      // Verify all Things exist in database
      const allThings = await store.getThingsByType({ typeName: 'Customer', limit: 200 })
      expect(allThings.length).toBe(count)

      // Verify each has correct data
      const thingsMap = await store.getThings(
        Array.from({ length: count }, (_, i) => thingId('concurrent', i))
      )
      expect(thingsMap.size).toBe(count)

      for (let i = 0; i < count; i++) {
        const thing = thingsMap.get(thingId('concurrent', i))
        expect(thing).toBeDefined()
        expect(thing?.data).toEqual({ index: i, name: `Customer ${i}` })
      }
    })

    it('should handle duplicate ID creates correctly', async () => {
      const duplicateCount = 10
      // All try to create same ID
      const creates = Array.from({ length: duplicateCount }, () =>
        store.createThing({
          id: 'same-id',
          typeId: 500,
          typeName: 'Customer',
          data: { name: 'Duplicate' },
        })
      )

      const results = await Promise.allSettled(creates)
      const successes = results.filter((r) => r.status === 'fulfilled')
      const failures = results.filter((r) => r.status === 'rejected')

      // Only 1 should succeed - duplicate ID is rejected
      expect(successes.length).toBe(1)
      expect(failures.length).toBe(duplicateCount - 1)

      // Verify failures have correct error message
      for (const failure of failures) {
        if (failure.status === 'rejected') {
          expect(failure.reason.message).toMatch(/already exists|UNIQUE constraint/i)
        }
      }

      // Verify only one Thing in database
      const thing = await store.getThing('same-id')
      expect(thing).not.toBeNull()
      expect(thing?.typeName).toBe('Customer')
    })

    it('should handle mixed unique and duplicate creates', async () => {
      // 50 unique IDs, 50 trying same ID
      const commonId = 'shared-id'
      const creates: Promise<GraphThing>[] = []

      // First 50 try the same ID
      for (let i = 0; i < 50; i++) {
        creates.push(
          store.createThing({
            id: commonId,
            typeId: 500,
            typeName: 'Customer',
            data: { attempt: i },
          })
        )
      }

      // Next 50 use unique IDs
      for (let i = 0; i < 50; i++) {
        creates.push(
          store.createThing({
            id: thingId('unique', i),
            typeId: 500,
            typeName: 'Customer',
            data: { index: i },
          })
        )
      }

      const results = await Promise.allSettled(creates)
      const successes = results.filter((r) => r.status === 'fulfilled')

      // 1 from shared-id + 50 from unique = 51 successes
      expect(successes.length).toBe(51)

      // Verify database state
      const allThings = await store.getThingsByType({ typeName: 'Customer', limit: 200 })
      expect(allThings.length).toBe(51)
    })

    it('should handle high concurrency with 500 parallel creates', async () => {
      const count = 500
      const creates = Array.from({ length: count }, (_, i) =>
        store.createThing({
          id: thingId('high-concurrency', i),
          typeId: 500,
          typeName: 'Customer',
          data: { index: i },
        })
      )

      const { result: results, durationMs } = await timed(() => Promise.allSettled(creates))
      const successes = results.filter((r) => r.status === 'fulfilled')

      expect(successes.length).toBe(count)

      // Performance check - should complete in reasonable time
      // SQLite in-memory is fast, but 500 creates should still be under 5s
      expect(durationMs).toBeLessThan(5000)

      // Verify data integrity
      const thingsMap = await store.getThings(
        Array.from({ length: count }, (_, i) => thingId('high-concurrency', i))
      )
      expect(thingsMap.size).toBe(count)
    })
  })

  // ============================================================================
  // PARALLEL RELATIONSHIP CREATES
  // ============================================================================

  describe('Parallel Relationship creates', () => {
    it('should handle 50 parallel relationship creates with unique tuples', async () => {
      const count = 50
      const creates = Array.from({ length: count }, (_, i) =>
        store.createRelationship({
          id: relId('concurrent', i),
          verb: 'owns',
          from: `do://tenant/users/user-${i}`,
          to: `do://tenant/projects/project-${i}`,
          data: { index: i },
        })
      )

      const results = await Promise.allSettled(creates)
      const successes = results.filter((r) => r.status === 'fulfilled')

      expect(successes.length).toBe(count)

      // Verify all relationships exist
      for (let i = 0; i < count; i++) {
        const rels = await store.queryRelationshipsFrom(`do://tenant/users/user-${i}`)
        expect(rels.length).toBe(1)
        expect(rels[0]?.verb).toBe('owns')
      }
    })

    it('should handle 50 parallel creates with same (verb, from, to)', async () => {
      const count = 50
      const from = 'do://tenant/users/alice'
      const to = 'do://tenant/projects/alpha'
      const verb = 'owns'

      // All try to create same relationship tuple
      const creates = Array.from({ length: count }, (_, i) =>
        store.createRelationship({
          id: relId('same-tuple', i),
          verb,
          from,
          to,
          data: { attempt: i },
        })
      )

      const results = await Promise.allSettled(creates)
      const successes = results.filter((r) => r.status === 'fulfilled')
      const failures = results.filter((r) => r.status === 'rejected')

      // Only 1 should succeed - unique constraint on (verb, from, to)
      expect(successes.length).toBe(1)
      expect(failures.length).toBe(count - 1)

      // Verify failures mention constraint violation
      for (const failure of failures) {
        if (failure.status === 'rejected') {
          expect(failure.reason.message).toMatch(/already exists|UNIQUE constraint/i)
        }
      }

      // Verify only one relationship in database
      const rels = await store.queryRelationshipsFrom(from)
      expect(rels.length).toBe(1)
    })

    it('should handle concurrent creates with same from, different verbs', async () => {
      const from = 'do://tenant/users/bob'
      const to = 'do://tenant/projects/beta'
      const verbs = ['owns', 'manages', 'creates', 'reviews', 'deploys']

      // Create 10 relationships per verb (50 total), all same from+to
      const creates: Promise<GraphRelationship>[] = []
      for (let v = 0; v < verbs.length; v++) {
        for (let i = 0; i < 10; i++) {
          creates.push(
            store.createRelationship({
              id: relId(`${verbs[v]}-${i}`, v * 10 + i),
              verb: verbs[v]!,
              from,
              to,
              data: { verb: verbs[v], attempt: i },
            })
          )
        }
      }

      const results = await Promise.allSettled(creates)
      const successes = results.filter((r) => r.status === 'fulfilled')

      // 5 verbs should succeed (one per unique verb+from+to)
      expect(successes.length).toBe(5)

      // Verify database state
      const rels = await store.queryRelationshipsFrom(from)
      expect(rels.length).toBe(5)
      expect(new Set(rels.map((r) => r.verb)).size).toBe(5)
    })

    it('should handle 100 parallel relationships from same source', async () => {
      const from = 'do://tenant/users/super-connected'
      const count = 100

      const creates = Array.from({ length: count }, (_, i) =>
        store.createRelationship({
          id: relId('fan-out', i),
          verb: 'linkedTo',
          from,
          to: `do://tenant/nodes/node-${i}`,
        })
      )

      const results = await Promise.allSettled(creates)
      const successes = results.filter((r) => r.status === 'fulfilled')

      expect(successes.length).toBe(count)

      // Verify forward traversal
      const rels = await store.queryRelationshipsFrom(from)
      expect(rels.length).toBe(count)
    })
  })

  // ============================================================================
  // CONCURRENT READS DURING WRITES
  // ============================================================================

  describe('Concurrent reads during writes', () => {
    it('should see consistent state during parallel writes', async () => {
      const thingCount = 50

      // Start creating things
      const createPromises = Array.from({ length: thingCount }, (_, i) =>
        store.createThing({
          id: thingId('read-write', i),
          typeId: 500,
          typeName: 'Customer',
          data: { index: i },
        })
      )

      // While creating, also try to read
      const readPromises: Promise<GraphThing | null>[] = []
      for (let i = 0; i < thingCount; i++) {
        readPromises.push(store.getThing(thingId('read-write', i)))
      }

      // Run writes and reads concurrently
      const [createResults, readResults] = await Promise.all([
        Promise.allSettled(createPromises),
        Promise.allSettled(readPromises),
      ])

      // All creates should succeed
      const createSuccesses = createResults.filter((r) => r.status === 'fulfilled')
      expect(createSuccesses.length).toBe(thingCount)

      // Reads may return null (if read happened before create) or the Thing
      // Either is valid - we just shouldn't see partial/corrupted data
      for (const readResult of readResults) {
        if (readResult.status === 'fulfilled') {
          const thing = readResult.value
          // Should be null or a complete Thing - never partial
          if (thing !== null) {
            expect(thing.id).toBeDefined()
            expect(thing.typeId).toBe(500)
            expect(thing.typeName).toBe('Customer')
            expect(thing.createdAt).toBeDefined()
          }
        }
      }
    })

    it('should handle concurrent getThingsByType during creates', async () => {
      const thingCount = 100

      // Create things in parallel
      const createPromises = Array.from({ length: thingCount }, (_, i) =>
        store.createThing({
          id: thingId('query-during-write', i),
          typeId: 500,
          typeName: 'Customer',
          data: { index: i },
        })
      )

      // Query by type multiple times during creates
      const queryPromises = Array.from({ length: 10 }, () =>
        store.getThingsByType({ typeName: 'Customer', limit: 200 })
      )

      const [createResults, queryResults] = await Promise.all([
        Promise.allSettled(createPromises),
        Promise.allSettled(queryPromises),
      ])

      // All creates should succeed
      expect(createResults.filter((r) => r.status === 'fulfilled').length).toBe(thingCount)

      // All queries should succeed (may return different counts)
      expect(queryResults.filter((r) => r.status === 'fulfilled').length).toBe(10)

      // Each query result should be consistent (no partial Things)
      for (const queryResult of queryResults) {
        if (queryResult.status === 'fulfilled') {
          const things = queryResult.value
          for (const thing of things) {
            expect(thing.id).toBeDefined()
            expect(thing.typeId).toBe(500)
            expect(thing.createdAt).toBeDefined()
          }
        }
      }
    })

    it('should handle batch reads during writes', async () => {
      const thingCount = 50

      // Pre-create some things
      for (let i = 0; i < 25; i++) {
        await store.createThing({
          id: thingId('batch-read', i),
          typeId: 500,
          typeName: 'Customer',
          data: { index: i, preCreated: true },
        })
      }

      // Create more things in parallel
      const createPromises = Array.from({ length: 25 }, (_, i) =>
        store.createThing({
          id: thingId('batch-read', i + 25),
          typeId: 500,
          typeName: 'Customer',
          data: { index: i + 25, preCreated: false },
        })
      )

      // Batch read all IDs during creates
      const allIds = Array.from({ length: thingCount }, (_, i) => thingId('batch-read', i))
      const batchReadPromises = Array.from({ length: 5 }, () => store.getThings(allIds))

      const [createResults, batchResults] = await Promise.all([
        Promise.allSettled(createPromises),
        Promise.allSettled(batchReadPromises),
      ])

      expect(createResults.filter((r) => r.status === 'fulfilled').length).toBe(25)
      expect(batchResults.filter((r) => r.status === 'fulfilled').length).toBe(5)

      // After all operations complete, all 50 should exist
      const finalBatch = await store.getThings(allIds)
      expect(finalBatch.size).toBe(thingCount)
    })
  })

  // ============================================================================
  // CONCURRENT UPDATES
  // ============================================================================

  describe('Concurrent updates', () => {
    it('should handle concurrent updates to same Thing', async () => {
      // Create a Thing first
      await store.createThing({
        id: 'update-target',
        typeId: 500,
        typeName: 'Customer',
        data: { counter: 0, updates: [] },
      })

      // Concurrent updates
      const updateCount = 20
      const updates = Array.from({ length: updateCount }, (_, i) =>
        store.updateThing('update-target', {
          data: { counter: i, lastUpdate: i, updates: [`update-${i}`] },
        })
      )

      const results = await Promise.allSettled(updates)
      const successes = results.filter((r) => r.status === 'fulfilled')

      // All updates should succeed (they overwrite, not merge)
      expect(successes.length).toBe(updateCount)

      // Final state should reflect one of the updates
      const final = await store.getThing('update-target')
      expect(final).not.toBeNull()
      expect(final?.data).toHaveProperty('counter')
      expect(final?.data).toHaveProperty('lastUpdate')
    })

    it('should handle mixed creates and updates', async () => {
      const operations: Promise<GraphThing | null>[] = []

      // Create 50 things
      for (let i = 0; i < 50; i++) {
        operations.push(
          store.createThing({
            id: thingId('mixed-ops', i),
            typeId: 500,
            typeName: 'Customer',
            data: { index: i, version: 1 },
          })
        )
      }

      // Update same things (may race with creates)
      for (let i = 0; i < 50; i++) {
        operations.push(
          store.updateThing(thingId('mixed-ops', i), {
            data: { index: i, version: 2 },
          })
        )
      }

      const results = await Promise.allSettled(operations)
      const successes = results.filter((r) => r.status === 'fulfilled')

      // Creates should all succeed (50)
      // Updates may succeed or return null (if Thing doesn't exist yet)
      // So we expect at least 50 successes (all creates)
      expect(successes.length).toBeGreaterThanOrEqual(50)

      // Final state: all 50 things should exist
      const allThings = await store.getThings(
        Array.from({ length: 50 }, (_, i) => thingId('mixed-ops', i))
      )
      expect(allThings.size).toBe(50)
    })

    it('should handle concurrent soft deletes', async () => {
      // Create things first
      for (let i = 0; i < 20; i++) {
        await store.createThing({
          id: thingId('delete-race', i),
          typeId: 500,
          typeName: 'Customer',
          data: { index: i },
        })
      }

      // Concurrent deletes (each thing deleted by multiple concurrent calls)
      const deletes: Promise<GraphThing | null>[] = []
      for (let i = 0; i < 20; i++) {
        // Each thing gets 3 delete attempts
        for (let j = 0; j < 3; j++) {
          deletes.push(store.deleteThing(thingId('delete-race', i)))
        }
      }

      const results = await Promise.allSettled(deletes)
      const fulfilled = results.filter((r) => r.status === 'fulfilled')

      // All should complete without error (some may return null if already deleted)
      expect(fulfilled.length).toBe(60)

      // All 20 things should be soft-deleted
      const things = await store.getThingsByType({
        typeName: 'Customer',
        includeDeleted: true,
        limit: 100,
      })
      const deleted = things.filter((t) => t.id.startsWith('delete-race-'))
      expect(deleted.every((t) => t.deletedAt !== null)).toBe(true)
    })
  })

  // ============================================================================
  // RELATIONSHIP STRESS TESTS
  // ============================================================================

  describe('Relationship stress tests', () => {
    it('should handle star topology creation (many-to-one)', async () => {
      const hubNode = 'do://tenant/hub/central'
      const spokeCount = 100

      const creates = Array.from({ length: spokeCount }, (_, i) =>
        store.createRelationship({
          id: relId('star-spoke', i),
          verb: 'connectsTo',
          from: `do://tenant/spokes/spoke-${i}`,
          to: hubNode,
        })
      )

      const results = await Promise.allSettled(creates)
      const successes = results.filter((r) => r.status === 'fulfilled')

      expect(successes.length).toBe(spokeCount)

      // Verify backward traversal from hub
      const incoming = await store.queryRelationshipsTo(hubNode)
      expect(incoming.length).toBe(spokeCount)
    })

    it('should handle mesh topology creation (many-to-many)', async () => {
      const nodeCount = 10
      // Each node connects to all other nodes = 10 * 9 = 90 relationships
      const creates: Promise<GraphRelationship>[] = []

      for (let i = 0; i < nodeCount; i++) {
        for (let j = 0; j < nodeCount; j++) {
          if (i !== j) {
            creates.push(
              store.createRelationship({
                id: relId(`mesh-${i}-${j}`, i * nodeCount + j),
                verb: 'linkedTo',
                from: `do://tenant/mesh/node-${i}`,
                to: `do://tenant/mesh/node-${j}`,
              })
            )
          }
        }
      }

      const results = await Promise.allSettled(creates)
      const successes = results.filter((r) => r.status === 'fulfilled')

      expect(successes.length).toBe(nodeCount * (nodeCount - 1))

      // Each node should have (nodeCount - 1) outgoing and (nodeCount - 1) incoming
      for (let i = 0; i < nodeCount; i++) {
        const outgoing = await store.queryRelationshipsFrom(`do://tenant/mesh/node-${i}`)
        const incoming = await store.queryRelationshipsTo(`do://tenant/mesh/node-${i}`)
        expect(outgoing.length).toBe(nodeCount - 1)
        expect(incoming.length).toBe(nodeCount - 1)
      }
    })

    it('should handle concurrent relationship queries', async () => {
      // Pre-populate with relationships
      for (let i = 0; i < 50; i++) {
        await store.createRelationship({
          id: relId('query-test', i),
          verb: 'owns',
          from: `do://tenant/owners/owner-${i % 10}`,
          to: `do://tenant/items/item-${i}`,
        })
      }

      // Concurrent queries from different sources
      const queries: Promise<GraphRelationship[]>[] = []
      for (let i = 0; i < 10; i++) {
        queries.push(store.queryRelationshipsFrom(`do://tenant/owners/owner-${i}`))
      }

      // Also query by verb concurrently
      for (let j = 0; j < 5; j++) {
        queries.push(store.queryRelationshipsByVerb('owns'))
      }

      const results = await Promise.allSettled(queries)
      const fulfilled = results.filter((r) => r.status === 'fulfilled')

      expect(fulfilled.length).toBe(15)

      // Verify query results are consistent
      for (let i = 0; i < 10; i++) {
        if (results[i]?.status === 'fulfilled') {
          const rels = (results[i] as PromiseFulfilledResult<GraphRelationship[]>).value
          expect(rels.length).toBe(5) // 50/10 = 5 per owner
          expect(rels.every((r) => r.from === `do://tenant/owners/owner-${i}`)).toBe(true)
        }
      }
    })
  })

  // ============================================================================
  // DATA INTEGRITY VERIFICATION
  // ============================================================================

  describe('Data integrity verification', () => {
    it('should maintain referential consistency after concurrent operations', async () => {
      const operations: Promise<unknown>[] = []

      // Create 50 Things
      for (let i = 0; i < 50; i++) {
        operations.push(
          store.createThing({
            id: thingId('integrity', i),
            typeId: 500,
            typeName: 'Customer',
            data: { index: i },
          })
        )
      }

      // Create relationships between them
      for (let i = 0; i < 49; i++) {
        operations.push(
          store.createRelationship({
            id: relId('integrity', i),
            verb: 'linkedTo',
            from: `do://tenant/things/${thingId('integrity', i)}`,
            to: `do://tenant/things/${thingId('integrity', i + 1)}`,
          })
        )
      }

      await Promise.allSettled(operations)

      // Verify chain is complete
      for (let i = 0; i < 49; i++) {
        const rels = await store.queryRelationshipsFrom(`do://tenant/things/${thingId('integrity', i)}`)
        expect(rels.length).toBe(1)
        expect(rels[0]?.to).toBe(`do://tenant/things/${thingId('integrity', i + 1)}`)
      }
    })

    it('should handle concurrent creations with same data', async () => {
      // Multiple Things with identical data (different IDs)
      const creates = Array.from({ length: 100 }, (_, i) =>
        store.createThing({
          id: thingId('same-data', i),
          typeId: 500,
          typeName: 'Customer',
          data: { name: 'Same Name', email: 'same@example.com' },
        })
      )

      const results = await Promise.allSettled(creates)
      const successes = results.filter((r) => r.status === 'fulfilled')

      // All should succeed - same data doesn't violate uniqueness (only ID does)
      expect(successes.length).toBe(100)
    })

    it('should verify no phantom reads during updates', async () => {
      // Create a Thing
      await store.createThing({
        id: 'phantom-test',
        typeId: 500,
        typeName: 'Customer',
        data: { version: 0 },
      })

      // Rapid update/read cycle
      const operations: Promise<GraphThing | null>[] = []
      for (let i = 1; i <= 50; i++) {
        operations.push(
          store.updateThing('phantom-test', { data: { version: i } })
        )
        operations.push(store.getThing('phantom-test'))
      }

      const results = await Promise.allSettled(operations)

      // All operations should complete
      expect(results.filter((r) => r.status === 'fulfilled').length).toBe(100)

      // All reads should return valid Things (not null, not corrupted)
      for (let i = 1; i < results.length; i += 2) {
        const readResult = results[i]
        if (readResult?.status === 'fulfilled') {
          const thing = readResult.value
          expect(thing).not.toBeNull()
          expect(thing?.id).toBe('phantom-test')
          expect(typeof (thing?.data as { version: number })?.version).toBe('number')
        }
      }
    })
  })

  // ============================================================================
  // BATCH OPERATIONS UNDER CONCURRENCY
  // ============================================================================

  describe('Batch operations under concurrency', () => {
    it('should handle concurrent batch reads', async () => {
      // Pre-create things
      for (let i = 0; i < 100; i++) {
        await store.createThing({
          id: thingId('batch-concurrent', i),
          typeId: 500,
          typeName: 'Customer',
          data: { index: i },
        })
      }

      const allIds = Array.from({ length: 100 }, (_, i) => thingId('batch-concurrent', i))

      // 20 concurrent batch reads
      const reads = Array.from({ length: 20 }, () => store.getThings(allIds))

      const results = await Promise.allSettled(reads)
      const fulfilled = results.filter((r) => r.status === 'fulfilled')

      expect(fulfilled.length).toBe(20)

      // All should return same 100 Things
      for (const result of fulfilled) {
        if (result.status === 'fulfilled') {
          expect(result.value.size).toBe(100)
        }
      }
    })

    it('should handle concurrent queryRelationshipsFromMany', async () => {
      // Pre-create relationships
      for (let i = 0; i < 50; i++) {
        await store.createRelationship({
          id: relId('batch-rel', i),
          verb: 'owns',
          from: `do://tenant/users/user-${i % 10}`,
          to: `do://tenant/items/item-${i}`,
        })
      }

      const urls = Array.from({ length: 10 }, (_, i) => `do://tenant/users/user-${i}`)

      // 10 concurrent batch relationship queries
      const queries = Array.from({ length: 10 }, () =>
        store.queryRelationshipsFromMany(urls)
      )

      const results = await Promise.allSettled(queries)
      const fulfilled = results.filter((r) => r.status === 'fulfilled')

      expect(fulfilled.length).toBe(10)

      // All should return same 50 relationships
      for (const result of fulfilled) {
        if (result.status === 'fulfilled') {
          expect(result.value.length).toBe(50)
        }
      }
    })

    it('should handle batch reads while creating more Things', async () => {
      // Pre-create some things
      for (let i = 0; i < 50; i++) {
        await store.createThing({
          id: thingId('batch-grow', i),
          typeId: 500,
          typeName: 'Customer',
          data: { index: i },
        })
      }

      // Concurrently: create 50 more and batch read all 100
      const creates = Array.from({ length: 50 }, (_, i) =>
        store.createThing({
          id: thingId('batch-grow', i + 50),
          typeId: 500,
          typeName: 'Customer',
          data: { index: i + 50 },
        })
      )

      const allIds = Array.from({ length: 100 }, (_, i) => thingId('batch-grow', i))
      const reads = Array.from({ length: 5 }, () => store.getThings(allIds))

      const [createResults, readResults] = await Promise.all([
        Promise.allSettled(creates),
        Promise.allSettled(reads),
      ])

      expect(createResults.filter((r) => r.status === 'fulfilled').length).toBe(50)
      expect(readResults.filter((r) => r.status === 'fulfilled').length).toBe(5)

      // After all ops, all 100 should exist
      const finalBatch = await store.getThings(allIds)
      expect(finalBatch.size).toBe(100)
    })
  })

  // ============================================================================
  // TRANSACTION ISOLATION VERIFICATION
  // ============================================================================

  describe('Transaction isolation verification', () => {
    it('should prevent lost updates with concurrent modifications', async () => {
      // Create a Thing with a counter
      await store.createThing({
        id: 'isolation-counter',
        typeId: 500,
        typeName: 'Customer',
        data: { counter: 0 },
      })

      // Run concurrent "increment" operations
      // Each reads the current value and writes current+1
      // Without proper isolation, updates will be lost
      const incrementCount = 50
      const increments = Array.from({ length: incrementCount }, async () => {
        const current = await store.getThing('isolation-counter')
        const currentValue = (current?.data as { counter: number })?.counter ?? 0
        await store.updateThing('isolation-counter', {
          data: { counter: currentValue + 1 },
        })
      })

      await Promise.all(increments)

      const final = await store.getThing('isolation-counter')
      const finalCounter = (final?.data as { counter: number })?.counter

      // This test will FAIL in RED phase due to lost updates
      // With proper concurrency control, the counter should be exactly 50
      expect(finalCounter).toBe(incrementCount)
    })

    it('should prevent dirty reads during updates', async () => {
      await store.createThing({
        id: 'dirty-read-test',
        typeId: 500,
        typeName: 'Customer',
        data: { status: 'initial', complete: true },
      })

      // Concurrent updates and reads
      const operations = await Promise.allSettled([
        store.updateThing('dirty-read-test', { data: { status: 'updating', complete: false } }),
        store.getThing('dirty-read-test'),
        store.updateThing('dirty-read-test', { data: { status: 'updated', complete: true } }),
        store.getThing('dirty-read-test'),
        store.getThing('dirty-read-test'),
      ])

      // All operations should succeed
      const failures = operations.filter((r) => r.status === 'rejected')
      expect(failures.length).toBe(0)

      // Reads should see consistent state (either initial, updating, or updated)
      // Never a mix of fields from different states
      for (const op of operations) {
        if (op.status === 'fulfilled' && op.value !== null) {
          const data = (op.value as GraphThing)?.data as { status?: string; complete?: boolean }
          if (data?.status === 'updating') {
            expect(data.complete).toBe(false)
          } else if (data?.status === 'updated' || data?.status === 'initial') {
            expect(data.complete).toBe(true)
          }
        }
      }
    })

    it('should verify serializable isolation for read-modify-write', async () => {
      await store.createThing({
        id: 'serialize-test',
        typeId: 500,
        typeName: 'Customer',
        data: { balance: 1000 },
      })

      // Two concurrent "transfer" operations that both try to
      // read balance, check if sufficient, then deduct
      const transfer1 = async () => {
        const thing = await store.getThing('serialize-test')
        const balance = (thing?.data as { balance: number })?.balance ?? 0
        if (balance >= 600) {
          await store.updateThing('serialize-test', {
            data: { balance: balance - 600 },
          })
          return { success: true, newBalance: balance - 600 }
        }
        return { success: false, reason: 'Insufficient funds' }
      }

      const transfer2 = async () => {
        const thing = await store.getThing('serialize-test')
        const balance = (thing?.data as { balance: number })?.balance ?? 0
        if (balance >= 600) {
          await store.updateThing('serialize-test', {
            data: { balance: balance - 600 },
          })
          return { success: true, newBalance: balance - 600 }
        }
        return { success: false, reason: 'Insufficient funds' }
      }

      const results = await Promise.all([transfer1(), transfer2()])

      // Both read balance=1000, both think they can deduct 600
      // Without proper isolation, both succeed and we get -200 balance
      // With proper isolation, only one should succeed

      const successes = results.filter((r) => r.success)

      // This test will FAIL in RED phase - both transfers succeed
      // Expected: exactly one success
      expect(successes.length).toBe(1)

      const final = await store.getThing('serialize-test')
      const finalBalance = (final?.data as { balance: number })?.balance

      // Balance should never go negative
      expect(finalBalance).toBeGreaterThanOrEqual(0)
      expect(finalBalance).toBe(400) // 1000 - 600 = 400
    })
  })

  // ============================================================================
  // DEADLOCK DETECTION TESTS
  // ============================================================================

  describe('Deadlock detection tests', () => {
    it('should handle circular update pattern without deadlock', async () => {
      // Create two Things
      await store.createThing({
        id: 'deadlock-a',
        typeId: 500,
        typeName: 'Customer',
        data: { value: 'A' },
      })
      await store.createThing({
        id: 'deadlock-b',
        typeId: 500,
        typeName: 'Customer',
        data: { value: 'B' },
      })

      // Attempt circular update pattern
      // Op1: Update A, then B
      // Op2: Update B, then A
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

      // Both Things should exist with some valid value
      const thingA = await store.getThing('deadlock-a')
      const thingB = await store.getThing('deadlock-b')
      expect(thingA).not.toBeNull()
      expect(thingB).not.toBeNull()
    })

    it('should handle many-to-many update pattern without deadlock', async () => {
      const thingCount = 5

      // Create Things
      await Promise.all(
        Array.from({ length: thingCount }, (_, i) =>
          store.createThing({
            id: thingId('many-deadlock', i),
            typeId: 500,
            typeName: 'Customer',
            data: { value: i },
          })
        )
      )

      // Create operations that update Things in different orders
      const operations = Array.from({ length: 10 }, (_, opIndex) => async () => {
        // Shuffle order for each operation
        const indices = Array.from({ length: thingCount }, (_, i) => i)
        for (let i = indices.length - 1; i > 0; i--) {
          const j = (opIndex + i) % (i + 1)
          ;[indices[i], indices[j]] = [indices[j]!, indices[i]!]
        }

        // Update in shuffled order
        for (const idx of indices) {
          await store.updateThing(thingId('many-deadlock', idx), {
            data: { value: `op${opIndex}-${idx}` },
          })
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
      const allThings = await store.getThingsByType({
        typeName: 'Customer',
        limit: 100,
      })
      const deadlockThings = allThings.filter((t) => t.id.startsWith('many-deadlock-'))
      expect(deadlockThings.length).toBe(thingCount)
    })

    it('should handle relationship creation contention without deadlock', async () => {
      const verb = 'connects'
      const nodeCount = 10
      const operationCount = 50

      // Create relationships in various patterns
      const operations = Array.from({ length: operationCount }, (_, i) =>
        store.createRelationship({
          id: relId('contention', i),
          verb: `${verb}-${i % 5}`,
          from: `do://tenant/nodes/node-${i % nodeCount}`,
          to: `do://tenant/nodes/node-${(i + 1) % nodeCount}`,
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
  // ORGANIZATION STORE CONCURRENT MEMBERSHIP UPDATES
  // ============================================================================

  describe('OrganizationStore concurrent membership updates', () => {
    /**
     * These tests require the OrganizationStore.
     * They are marked to FAIL in RED phase because:
     * 1. The store may not handle concurrent membership updates correctly
     * 2. Race conditions in addMember/removeMember may cause duplicates
     */

    it('should handle concurrent member additions without duplicates', async () => {
      // This test imports OrganizationStore and tests concurrent membership
      // Expected to FAIL in RED phase due to race conditions

      const { GraphEngine } = await import('../graph-engine')
      const { createOrganizationStore } = await import('../organization')

      const engine = new GraphEngine()
      const orgStore = createOrganizationStore(engine)

      // Create organization
      const org = await orgStore.create({
        name: 'Concurrent Test Org',
        slug: 'concurrent-member-test',
        type: 'company',
        status: 'active',
      })

      const memberCount = 30

      // Create user nodes first (GraphEngine requires nodes to exist for edges)
      for (let i = 0; i < memberCount; i++) {
        await engine.createNode('User', { name: `User ${i}` }, { id: `user-concurrent-${i}` })
      }

      // Add members concurrently
      const promises = Array.from({ length: memberCount }, (_, i) =>
        orgStore.addMember(org.id, `user-concurrent-${i}`, {
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

    it('should prevent duplicate memberships when adding same user concurrently', async () => {
      const { GraphEngine } = await import('../graph-engine')
      const { createOrganizationStore } = await import('../organization')

      const engine = new GraphEngine()
      const orgStore = createOrganizationStore(engine)

      const org = await orgStore.create({
        name: 'Duplicate Member Test',
        slug: 'duplicate-member-org',
        type: 'company',
        status: 'active',
      })

      const userId = 'duplicate-user-test'
      const concurrentCount = 10

      // Create user node first
      await engine.createNode('User', { name: 'Duplicate User' }, { id: userId })

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

      // Only ONE should succeed - this will FAIL in RED phase
      const successes = results.filter((r) => r.success)
      expect(successes.length).toBe(1)

      // Verify only one membership exists
      const members = await orgStore.getMembers(org.id)
      const userMemberships = members.filter((m) => m.userId === userId)
      expect(userMemberships.length).toBe(1)
    })

    it('should handle concurrent role updates for same member', async () => {
      const { GraphEngine } = await import('../graph-engine')
      const { createOrganizationStore } = await import('../organization')

      const engine = new GraphEngine()
      const orgStore = createOrganizationStore(engine)

      const org = await orgStore.create({
        name: 'Role Update Test',
        slug: 'role-update-org',
        type: 'company',
        status: 'active',
      })

      const userId = 'role-update-user'

      // Create user node first
      await engine.createNode('User', { name: 'Role Update User' }, { id: userId })

      // Add member first
      await orgStore.addMember(org.id, userId, {
        role: 'member',
        status: 'active',
      })

      // Concurrent role updates
      const roles: ('admin' | 'member' | 'guest' | 'owner')[] = [
        'admin',
        'member',
        'guest',
        'owner',
        'admin',
      ]

      const promises = roles.map((role) =>
        orgStore.updateMemberRole(org.id, userId, role)
      )

      await Promise.allSettled(promises)

      // Final role should be one of the valid roles
      const finalRole = await orgStore.getMemberRole(org.id, userId)
      expect(roles).toContain(finalRole)
    })
  })

  // ============================================================================
  // ACTION LIFECYCLE STORE CONCURRENT STATE TRANSITIONS
  // ============================================================================

  describe('ActionLifecycleStore concurrent state transitions', () => {
    it('should only allow one start when same action is started concurrently', async () => {
      const { ActionLifecycleStore } = await import('../actions')

      const lifecycle = new ActionLifecycleStore(store)

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

      // Only ONE should succeed - this will FAIL in RED phase if race condition exists
      const successes = results.filter((r) => r.success)
      expect(successes.length).toBe(1)

      // The successful one should have activity verb form
      if (successes[0]?.success) {
        expect(successes[0].activity.verb).toBe('creating')
      }
    })

    it('should only allow one complete when same activity is completed concurrently', async () => {
      const { ActionLifecycleStore } = await import('../actions')

      const lifecycle = new ActionLifecycleStore(store)

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
      if (successes[0]?.success) {
        expect(successes[0].event.verb).toBe('created')
      }
    })

    it('should handle concurrent fail and complete - only one succeeds', async () => {
      const { ActionLifecycleStore } = await import('../actions')

      const lifecycle = new ActionLifecycleStore(store)

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

      // Only ONE should succeed (either fail OR complete)
      expect(successes.length).toBe(1)
    })

    it('should handle many concurrent action lifecycles', async () => {
      const { ActionLifecycleStore } = await import('../actions')

      const lifecycle = new ActionLifecycleStore(store)

      const actionCount = 30

      // Create actions sequentially to avoid conflicts in ID generation
      const actions = []
      for (let i = 0; i < actionCount; i++) {
        const action = await lifecycle.createAction({
          verb: 'process',
          from: `https://workers.do/worker-${i}`,
          to: `https://tasks.do/task-${i}`,
          data: { index: i },
        })
        actions.push(action)
      }

      expect(actions.length).toBe(actionCount)

      // Start all actions concurrently - this is where race conditions may occur
      const startResults = await Promise.allSettled(
        actions.map((action) => lifecycle.startAction(action.id))
      )

      const startSuccesses = startResults.filter((r) => r.status === 'fulfilled')
      const startFailures = startResults.filter((r) => r.status === 'rejected')

      // All should succeed since each action has unique from/to
      expect(startSuccesses.length).toBe(actionCount)
      expect(startFailures.length).toBe(0)

      // Extract successful activities
      const activities = startSuccesses.map((r) => {
        if (r.status === 'fulfilled') return r.value
        throw new Error('Unexpected rejection')
      })

      // All should be in activity form
      for (const activity of activities) {
        expect(activity.verb).toBe('processing')
      }

      // Complete all activities concurrently
      const completeResults = await Promise.allSettled(
        activities.map((activity, i) =>
          lifecycle.completeAction(activity.id, `https://results.do/result-${i}`)
        )
      )

      const completeSuccesses = completeResults.filter((r) => r.status === 'fulfilled')

      // All should succeed
      expect(completeSuccesses.length).toBe(actionCount)

      // All should be in event form
      for (const result of completeSuccesses) {
        if (result.status === 'fulfilled') {
          expect(result.value.verb).toBe('processed')
        }
      }
    })
  })

  // ============================================================================
  // USER STORE CONCURRENT ROLE ASSIGNMENTS
  // ============================================================================

  describe('UserStore concurrent role assignments', () => {
    /**
     * Tests for concurrent role assignment operations on users.
     * These test scenarios that would cause race conditions in
     * typical user management operations.
     */

    it('should handle concurrent user profile updates', async () => {
      // Create a user Thing
      await store.createThing({
        id: 'user-profile-test',
        typeId: 1, // User type
        typeName: 'User',
        data: {
          email: 'test@example.com',
          name: 'Test User',
          roles: ['user'],
        },
      })

      // Concurrent role assignments
      const roleOperations = [
        store.updateThing('user-profile-test', {
          data: { email: 'test@example.com', name: 'Test User', roles: ['user', 'admin'] },
        }),
        store.updateThing('user-profile-test', {
          data: { email: 'test@example.com', name: 'Test User', roles: ['user', 'moderator'] },
        }),
        store.updateThing('user-profile-test', {
          data: { email: 'test@example.com', name: 'Test User', roles: ['user', 'editor'] },
        }),
      ]

      const results = await Promise.allSettled(roleOperations)

      // All updates should succeed
      const successes = results.filter((r) => r.status === 'fulfilled')
      expect(successes.length).toBe(3)

      // Final state should have one of the role sets
      const finalUser = await store.getThing('user-profile-test')
      expect(finalUser).not.toBeNull()

      const roles = (finalUser?.data as { roles: string[] })?.roles
      expect(roles).toBeDefined()
      expect(roles.includes('user')).toBe(true)
    })

    it('should prevent concurrent creation of users with same email', async () => {
      const email = 'duplicate@example.com'
      const concurrentCount = 10

      // Try to create 10 users with the same email concurrently
      // The unique index on email should prevent duplicates
      const promises = Array.from({ length: concurrentCount }, (_, i) =>
        store.createThing({
          id: `user-dup-${i}`,
          typeId: 1,
          typeName: 'User',
          data: {
            email, // Same email
            name: `User ${i}`,
          },
        })
          .then((thing) => ({ success: true as const, thing }))
          .catch((error) => ({ success: false as const, error }))
      )

      const results = await Promise.all(promises)

      // Only ONE should succeed due to unique constraint on email
      const successes = results.filter((r) => r.success)
      expect(successes.length).toBe(1)

      // Verify only one user exists with this email
      const allUsers = await store.getThingsByType({ typeName: 'User', limit: 100 })
      const usersWithEmail = allUsers.filter((u) => {
        const data = u.data as { email?: string }
        return data?.email === email
      })
      expect(usersWithEmail.length).toBe(1)
    })

    it('should handle concurrent permission grants and revokes', async () => {
      // Create user and permission relationships
      await store.createThing({
        id: 'permission-user',
        typeId: 1,
        typeName: 'User',
        data: { email: 'perm@example.com', name: 'Permission User' },
      })

      // Concurrent permission operations (grant and revoke)
      const operations: Promise<unknown>[] = []

      // Grant permissions
      for (let i = 0; i < 10; i++) {
        operations.push(
          store.createRelationship({
            id: `perm-grant-${i}`,
            verb: 'hasPermission',
            from: 'do://tenant/users/permission-user',
            to: `do://tenant/permissions/permission-${i}`,
          })
        )
      }

      // Also try to create duplicate permissions (should fail)
      for (let i = 0; i < 5; i++) {
        operations.push(
          store.createRelationship({
            id: `perm-dup-${i}`,
            verb: 'hasPermission',
            from: 'do://tenant/users/permission-user',
            to: `do://tenant/permissions/permission-${i}`, // Same target as above
          })
        )
      }

      const results = await Promise.allSettled(operations)

      // First 10 should succeed, next 5 should fail (duplicate)
      const successes = results.filter((r) => r.status === 'fulfilled')
      expect(successes.length).toBe(10)

      // Verify permissions
      const permissions = await store.queryRelationshipsFrom(
        'do://tenant/users/permission-user',
        { verb: 'hasPermission' }
      )
      expect(permissions.length).toBe(10)
    })
  })

  // ============================================================================
  // PERFORMANCE BENCHMARKS
  // ============================================================================

  describe('Performance benchmarks', () => {
    it('should create 1000 Things in parallel under 10 seconds', async () => {
      const count = 1000
      const creates = Array.from({ length: count }, (_, i) =>
        store.createThing({
          id: thingId('perf', i),
          typeId: 500,
          typeName: 'Customer',
          data: { index: i, name: `Customer ${i}`, email: `customer${i}@example.com` },
        })
      )

      const { durationMs } = await timed(() => Promise.allSettled(creates))

      expect(durationMs).toBeLessThan(10000)
      console.log(`Created 1000 Things in ${durationMs}ms`)
    })

    it('should query 100 Things by type under 1 second', async () => {
      // Pre-create things
      for (let i = 0; i < 100; i++) {
        await store.createThing({
          id: thingId('query-perf', i),
          typeId: 500,
          typeName: 'Customer',
          data: { index: i },
        })
      }

      const { result: things, durationMs } = await timed(() =>
        store.getThingsByType({ typeName: 'Customer', limit: 200 })
      )

      expect(durationMs).toBeLessThan(1000)
      expect(things.length).toBe(100)
      console.log(`Queried 100 Things by type in ${durationMs}ms`)
    })

    it('should batch read 500 Things under 500ms', async () => {
      // Pre-create things
      for (let i = 0; i < 500; i++) {
        await store.createThing({
          id: thingId('batch-perf', i),
          typeId: 500,
          typeName: 'Customer',
          data: { index: i },
        })
      }

      const ids = Array.from({ length: 500 }, (_, i) => thingId('batch-perf', i))

      const { result: thingsMap, durationMs } = await timed(() => store.getThings(ids))

      expect(durationMs).toBeLessThan(500)
      expect(thingsMap.size).toBe(500)
      console.log(`Batch read 500 Things in ${durationMs}ms`)
    })
  })
})
