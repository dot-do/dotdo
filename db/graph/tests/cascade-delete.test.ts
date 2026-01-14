/**
 * Cascade Delete Tests - Relationship Cleanup on Thing Deletion
 *
 * TDD RED phase: Failing tests for cascade deletion of relationships when Things are deleted.
 *
 * @see dotdo-2ntbc - [RED] Cascade Delete Tests
 *
 * Background:
 * When a Thing is soft deleted (deletedAt set), its relationships become orphaned.
 * This can cause:
 * 1. Stale references when querying relationships
 * 2. Incorrect graph traversals pointing to deleted nodes
 * 3. Index pollution with references to soft-deleted records
 * 4. Storage bloat from orphaned relationship data
 *
 * Solution: Cascade delete functionality that:
 * 1. Removes outgoing relationships when Thing deleted
 * 2. Removes incoming relationships when Thing deleted
 * 3. Respects transaction boundaries
 * 4. Supports optional cascade configuration
 *
 * This test file verifies cascade delete behavior using real SQLite - NO MOCKS.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SQLiteGraphStore } from '../stores/sqlite'

// ============================================================================
// EXPECTED TYPES - Document the expected API contract
// ============================================================================

/**
 * Options for cascade delete operation
 */
interface CascadeDeleteOptions {
  /** Whether to remove relationships where this thing is the source (outgoing) */
  removeOutgoing?: boolean
  /** Whether to remove relationships where this thing is the target (incoming) */
  removeIncoming?: boolean
}

/**
 * Result of cascade delete operation
 */
interface CascadeDeleteResult {
  /** The deleted Thing */
  thing: {
    id: string
    typeId: number
    typeName: string
    deletedAt: number
  }
  /** Number of outgoing relationships removed */
  outgoingRemoved: number
  /** Number of incoming relationships removed */
  incomingRemoved: number
}

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Helper to create a Thing for tests
 */
async function createTestThing(
  store: SQLiteGraphStore,
  id: string,
  typeName: string,
  data: Record<string, unknown> = {}
) {
  // Create Noun type first if needed
  const typeId = typeName === 'Customer' ? 1 : typeName === 'Product' ? 2 : typeName === 'Order' ? 3 : 99

  return store.createThing({
    id,
    typeId,
    typeName,
    data,
  })
}

/**
 * Helper to create a relationship for tests
 */
async function createTestRelationship(
  store: SQLiteGraphStore,
  id: string,
  verb: string,
  from: string,
  to: string,
  data?: Record<string, unknown>
) {
  return store.createRelationship({
    id,
    verb,
    from: `do://test/${from}`,
    to: `do://test/${to}`,
    data,
  })
}

// ============================================================================
// 1. BASIC CASCADE DELETE TESTS
// ============================================================================

describe('Cascade Delete', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
  })

  afterEach(async () => {
    await store.close()
  })

  describe('Relationship cleanup on Thing delete', () => {
    it('should remove outgoing relationships when Thing deleted', async () => {
      // Create Things
      const source = await createTestThing(store, 'source-thing', 'Customer', { name: 'Alice' })
      const target = await createTestThing(store, 'target-thing', 'Product', { name: 'Widget' })

      // Create outgoing relationship from source to target
      await createTestRelationship(store, 'rel-1', 'owns', source.id, target.id)

      // Verify relationship exists
      const relsBefore = await store.queryRelationshipsFrom(`do://test/${source.id}`)
      expect(relsBefore.length).toBe(1)

      // Delete source Thing with cascade
      const deleted = await store.deleteThing(source.id)
      expect(deleted).not.toBeNull()
      expect(deleted!.deletedAt).not.toBeNull()

      // Relationships from deleted Thing should be removed
      // This test will FAIL until cascade delete is implemented
      const relsAfter = await store.queryRelationshipsFrom(`do://test/${source.id}`)
      expect(relsAfter.length).toBe(0)
    })

    it('should remove incoming relationships when Thing deleted', async () => {
      // Create Things
      const source = await createTestThing(store, 'incoming-source', 'Customer', { name: 'Bob' })
      const target = await createTestThing(store, 'incoming-target', 'Product', { name: 'Gadget' })

      // Create incoming relationship to target
      await createTestRelationship(store, 'rel-incoming', 'owns', source.id, target.id)

      // Verify relationship exists
      const relsBefore = await store.queryRelationshipsTo(`do://test/${target.id}`)
      expect(relsBefore.length).toBe(1)

      // Delete target Thing
      const deleted = await store.deleteThing(target.id)
      expect(deleted).not.toBeNull()

      // Relationships to deleted Thing should be removed
      // This test will FAIL until cascade delete is implemented
      const relsAfter = await store.queryRelationshipsTo(`do://test/${target.id}`)
      expect(relsAfter.length).toBe(0)
    })

    it('should remove both incoming and outgoing relationships', async () => {
      // Create a Thing in the middle of a graph: A -> B -> C
      const nodeA = await createTestThing(store, 'node-a', 'Customer', { name: 'A' })
      const nodeB = await createTestThing(store, 'node-b', 'Customer', { name: 'B' })
      const nodeC = await createTestThing(store, 'node-c', 'Customer', { name: 'C' })

      // A links to B, B links to C
      await createTestRelationship(store, 'rel-a-b', 'linksTo', nodeA.id, nodeB.id)
      await createTestRelationship(store, 'rel-b-c', 'linksTo', nodeB.id, nodeC.id)

      // Delete B (middle node)
      const deleted = await store.deleteThing(nodeB.id)
      expect(deleted).not.toBeNull()

      // Both relationships involving B should be removed
      const fromA = await store.queryRelationshipsFrom(`do://test/${nodeA.id}`)
      const fromB = await store.queryRelationshipsFrom(`do://test/${nodeB.id}`)
      const toC = await store.queryRelationshipsTo(`do://test/${nodeC.id}`)

      expect(fromA.length).toBe(0) // A -> B removed
      expect(fromB.length).toBe(0) // B -> C removed
      expect(toC.length).toBe(0) // B -> C removed
    })

    it('should handle Thing with multiple outgoing relationships', async () => {
      const source = await createTestThing(store, 'multi-source', 'Customer', { name: 'Alice' })
      const target1 = await createTestThing(store, 'multi-target-1', 'Product', { name: 'Widget' })
      const target2 = await createTestThing(store, 'multi-target-2', 'Product', { name: 'Gadget' })
      const target3 = await createTestThing(store, 'multi-target-3', 'Product', { name: 'Gizmo' })

      // Create multiple outgoing relationships
      await createTestRelationship(store, 'rel-m-1', 'owns', source.id, target1.id)
      await createTestRelationship(store, 'rel-m-2', 'owns', source.id, target2.id)
      await createTestRelationship(store, 'rel-m-3', 'owns', source.id, target3.id)

      // Verify all relationships exist
      const relsBefore = await store.queryRelationshipsFrom(`do://test/${source.id}`)
      expect(relsBefore.length).toBe(3)

      // Delete source
      await store.deleteThing(source.id)

      // All outgoing relationships should be removed
      const relsAfter = await store.queryRelationshipsFrom(`do://test/${source.id}`)
      expect(relsAfter.length).toBe(0)
    })

    it('should handle Thing with multiple incoming relationships', async () => {
      const target = await createTestThing(store, 'multi-incoming-target', 'Product', { name: 'Popular' })
      const source1 = await createTestThing(store, 'multi-incoming-source-1', 'Customer', { name: 'Alice' })
      const source2 = await createTestThing(store, 'multi-incoming-source-2', 'Customer', { name: 'Bob' })
      const source3 = await createTestThing(store, 'multi-incoming-source-3', 'Customer', { name: 'Carol' })

      // Create multiple incoming relationships
      await createTestRelationship(store, 'rel-i-1', 'owns', source1.id, target.id)
      await createTestRelationship(store, 'rel-i-2', 'owns', source2.id, target.id)
      await createTestRelationship(store, 'rel-i-3', 'owns', source3.id, target.id)

      // Verify all relationships exist
      const relsBefore = await store.queryRelationshipsTo(`do://test/${target.id}`)
      expect(relsBefore.length).toBe(3)

      // Delete target
      await store.deleteThing(target.id)

      // All incoming relationships should be removed
      const relsAfter = await store.queryRelationshipsTo(`do://test/${target.id}`)
      expect(relsAfter.length).toBe(0)
    })
  })

  // ============================================================================
  // 2. SELF-REFERENTIAL RELATIONSHIPS
  // ============================================================================

  describe('Self-referential relationships', () => {
    it('should handle self-referential relationship (from === to)', async () => {
      const thing = await createTestThing(store, 'self-ref', 'Customer', { name: 'SelfRef' })

      // Create self-referential relationship
      await createTestRelationship(store, 'rel-self', 'references', thing.id, thing.id)

      // Verify relationship exists
      const relsBefore = await store.queryRelationshipsFrom(`do://test/${thing.id}`)
      expect(relsBefore.length).toBe(1)

      // Delete the thing
      await store.deleteThing(thing.id)

      // Self-referential relationship should be removed
      const relsAfter = await store.queryRelationshipsFrom(`do://test/${thing.id}`)
      expect(relsAfter.length).toBe(0)
    })
  })

  // ============================================================================
  // 3. THING WITH NO RELATIONSHIPS
  // ============================================================================

  describe('Thing with no relationships', () => {
    it('should handle Thing with no relationships gracefully', async () => {
      const standalone = await createTestThing(store, 'standalone', 'Customer', { name: 'Lonely' })

      // Verify no relationships exist
      const relsFromBefore = await store.queryRelationshipsFrom(`do://test/${standalone.id}`)
      const relsToBefore = await store.queryRelationshipsTo(`do://test/${standalone.id}`)
      expect(relsFromBefore.length).toBe(0)
      expect(relsToBefore.length).toBe(0)

      // Delete should succeed without errors
      const deleted = await store.deleteThing(standalone.id)
      expect(deleted).not.toBeNull()
      expect(deleted!.deletedAt).not.toBeNull()
    })
  })

  // ============================================================================
  // 4. RELATIONSHIPS PRESERVED FOR NON-DELETED THINGS
  // ============================================================================

  describe('Relationships preserved for non-deleted Things', () => {
    it('should not affect relationships between other Things', async () => {
      // Create 4 things: A, B, C, D
      const nodeA = await createTestThing(store, 'preserve-a', 'Customer', { name: 'A' })
      const nodeB = await createTestThing(store, 'preserve-b', 'Customer', { name: 'B' })
      const nodeC = await createTestThing(store, 'preserve-c', 'Customer', { name: 'C' })
      const nodeD = await createTestThing(store, 'preserve-d', 'Customer', { name: 'D' })

      // Create relationships: A -> B, C -> D
      await createTestRelationship(store, 'rel-ab', 'linksTo', nodeA.id, nodeB.id)
      await createTestRelationship(store, 'rel-cd', 'linksTo', nodeC.id, nodeD.id)

      // Delete A (should only affect A -> B relationship)
      await store.deleteThing(nodeA.id)

      // C -> D relationship should still exist
      const relsCtoD = await store.queryRelationshipsFrom(`do://test/${nodeC.id}`)
      expect(relsCtoD.length).toBe(1)
      expect(relsCtoD[0]!.to).toBe(`do://test/${nodeD.id}`)
    })
  })

  // ============================================================================
  // 5. TRANSACTION BOUNDARY TESTS
  // ============================================================================

  describe('Transaction boundaries', () => {
    it('should cascade delete atomically (all or nothing)', async () => {
      const source = await createTestThing(store, 'atomic-source', 'Customer', { name: 'Source' })
      const target1 = await createTestThing(store, 'atomic-target-1', 'Product', { name: 'T1' })
      const target2 = await createTestThing(store, 'atomic-target-2', 'Product', { name: 'T2' })

      await createTestRelationship(store, 'rel-atomic-1', 'owns', source.id, target1.id)
      await createTestRelationship(store, 'rel-atomic-2', 'owns', source.id, target2.id)

      // Delete source
      const deleted = await store.deleteThing(source.id)
      expect(deleted).not.toBeNull()

      // Either all relationships are removed or none (atomicity)
      const relsAfter = await store.queryRelationshipsFrom(`do://test/${source.id}`)
      // All should be removed
      expect(relsAfter.length).toBe(0)
    })

    it('should delete Thing and relationships in same transaction', async () => {
      const thing = await createTestThing(store, 'tx-thing', 'Customer', { name: 'TX' })
      const target = await createTestThing(store, 'tx-target', 'Product', { name: 'Target' })

      await createTestRelationship(store, 'rel-tx', 'owns', thing.id, target.id)

      // Delete the thing
      const deleted = await store.deleteThing(thing.id)

      // Verify both thing is deleted and relationships are cleaned up
      expect(deleted).not.toBeNull()
      expect(deleted!.deletedAt).not.toBeNull()

      const relsAfter = await store.queryRelationshipsFrom(`do://test/${thing.id}`)
      expect(relsAfter.length).toBe(0)
    })
  })

  // ============================================================================
  // 6. DIFFERENT VERB TYPES
  // ============================================================================

  describe('Different verb types', () => {
    it('should remove relationships of all verb types', async () => {
      const thing = await createTestThing(store, 'multi-verb', 'Customer', { name: 'MultiVerb' })
      const target1 = await createTestThing(store, 'verb-target-1', 'Product', { name: 'T1' })
      const target2 = await createTestThing(store, 'verb-target-2', 'Product', { name: 'T2' })
      const target3 = await createTestThing(store, 'verb-target-3', 'Product', { name: 'T3' })

      // Create relationships with different verbs
      await createTestRelationship(store, 'rel-owns', 'owns', thing.id, target1.id)
      await createTestRelationship(store, 'rel-creates', 'creates', thing.id, target2.id)
      await createTestRelationship(store, 'rel-manages', 'manages', thing.id, target3.id)

      // Verify all relationships exist
      const relsBefore = await store.queryRelationshipsFrom(`do://test/${thing.id}`)
      expect(relsBefore.length).toBe(3)

      // Delete thing
      await store.deleteThing(thing.id)

      // All relationships should be removed regardless of verb
      const relsAfter = await store.queryRelationshipsFrom(`do://test/${thing.id}`)
      expect(relsAfter.length).toBe(0)
    })
  })

  // ============================================================================
  // 7. RELATIONSHIP DATA PRESERVATION
  // ============================================================================

  describe('Relationship data', () => {
    it('should completely remove relationship including data', async () => {
      const source = await createTestThing(store, 'data-source', 'Customer', { name: 'Source' })
      const target = await createTestThing(store, 'data-target', 'Product', { name: 'Target' })

      // Create relationship with data
      await createTestRelationship(store, 'rel-with-data', 'owns', source.id, target.id, {
        since: '2024-01-01',
        percentage: 100,
        notes: 'Important relationship data',
      })

      // Verify relationship exists with data
      const relsBefore = await store.queryRelationshipsFrom(`do://test/${source.id}`)
      expect(relsBefore.length).toBe(1)
      expect(relsBefore[0]!.data).not.toBeNull()

      // Delete source
      await store.deleteThing(source.id)

      // Relationship should be completely removed
      const relsAfter = await store.queryRelationshipsFrom(`do://test/${source.id}`)
      expect(relsAfter.length).toBe(0)
    })
  })

  // ============================================================================
  // 8. EDGE CASES
  // ============================================================================

  describe('Edge cases', () => {
    it('should handle deleting non-existent Thing', async () => {
      const result = await store.deleteThing('non-existent-thing')
      expect(result).toBeNull()
    })

    it('should handle concurrent deletions', async () => {
      const thing = await createTestThing(store, 'concurrent', 'Customer', { name: 'Concurrent' })
      const target = await createTestThing(store, 'concurrent-target', 'Product', { name: 'Target' })

      await createTestRelationship(store, 'rel-concurrent', 'owns', thing.id, target.id)

      // Attempt concurrent deletions
      const results = await Promise.all([store.deleteThing(thing.id), store.deleteThing(thing.id)])

      // At least one should succeed
      const successCount = results.filter((r) => r !== null).length
      expect(successCount).toBeGreaterThanOrEqual(1)

      // Relationships should be cleaned up
      const relsAfter = await store.queryRelationshipsFrom(`do://test/${thing.id}`)
      expect(relsAfter.length).toBe(0)
    })

    it('should handle Thing with many relationships', async () => {
      const thing = await createTestThing(store, 'hub', 'Customer', { name: 'Hub' })

      // Create 100 outgoing relationships
      for (let i = 0; i < 100; i++) {
        const target = await createTestThing(store, `spoke-${i}`, 'Product', { name: `Spoke ${i}` })
        await createTestRelationship(store, `rel-hub-${i}`, 'owns', thing.id, target.id)
      }

      // Verify all relationships exist
      const relsBefore = await store.queryRelationshipsFrom(`do://test/${thing.id}`)
      expect(relsBefore.length).toBe(100)

      // Delete hub
      await store.deleteThing(thing.id)

      // All relationships should be removed
      const relsAfter = await store.queryRelationshipsFrom(`do://test/${thing.id}`)
      expect(relsAfter.length).toBe(0)
    })
  })

  // ============================================================================
  // 9. DELETEWITHOPTIONS METHOD TESTS (RED - to be implemented)
  // ============================================================================

  describe('deleteThingWithOptions (RED Phase)', () => {
    it('should have deleteThingWithOptions method on SQLiteGraphStore', async () => {
      // This test will FAIL until deleteThingWithOptions is implemented
      expect(typeof (store as any).deleteThingWithOptions).toBe('function')
    })

    it('should return cascade delete result', async () => {
      const source = await createTestThing(store, 'result-source', 'Customer', { name: 'Source' })
      const target = await createTestThing(store, 'result-target', 'Product', { name: 'Target' })

      await createTestRelationship(store, 'rel-result', 'owns', source.id, target.id)

      // This will FAIL until deleteThingWithOptions is implemented
      const result: CascadeDeleteResult = await (store as any).deleteThingWithOptions(source.id, {
        removeOutgoing: true,
        removeIncoming: true,
      })

      expect(result.thing.id).toBe(source.id)
      expect(result.thing.deletedAt).toBeDefined()
      expect(result.outgoingRemoved).toBe(1)
      expect(result.incomingRemoved).toBe(0)
    })

    it('should support selective cascade with removeOutgoing only', async () => {
      const source = await createTestThing(store, 'selective-source', 'Customer', { name: 'Source' })
      const target = await createTestThing(store, 'selective-target', 'Product', { name: 'Target' })

      // Create outgoing and incoming relationships
      await createTestRelationship(store, 'rel-out', 'owns', source.id, target.id)
      await createTestRelationship(store, 'rel-in', 'ownedBy', target.id, source.id)

      // Delete with only outgoing removal
      const result: CascadeDeleteResult = await (store as any).deleteThingWithOptions(source.id, {
        removeOutgoing: true,
        removeIncoming: false,
      })

      expect(result.outgoingRemoved).toBe(1)
      expect(result.incomingRemoved).toBe(0)

      // Outgoing relationship should be removed
      const outgoingAfter = await store.queryRelationshipsFrom(`do://test/${source.id}`)
      expect(outgoingAfter.length).toBe(0)

      // Incoming relationship should still exist (orphaned)
      const incomingAfter = await store.queryRelationshipsTo(`do://test/${source.id}`)
      expect(incomingAfter.length).toBe(1)
    })

    it('should support selective cascade with removeIncoming only', async () => {
      const source = await createTestThing(store, 'incoming-only-source', 'Customer', { name: 'Source' })
      const target = await createTestThing(store, 'incoming-only-target', 'Product', { name: 'Target' })

      await createTestRelationship(store, 'rel-to-delete', 'owns', source.id, target.id)
      await createTestRelationship(store, 'rel-to-keep', 'owns', target.id, source.id)

      // Delete source with only incoming removal
      const result: CascadeDeleteResult = await (store as any).deleteThingWithOptions(target.id, {
        removeOutgoing: false,
        removeIncoming: true,
      })

      expect(result.incomingRemoved).toBe(1)
      expect(result.outgoingRemoved).toBe(0)
    })

    it('should support no cascade (delete Thing only)', async () => {
      const source = await createTestThing(store, 'no-cascade-source', 'Customer', { name: 'Source' })
      const target = await createTestThing(store, 'no-cascade-target', 'Product', { name: 'Target' })

      await createTestRelationship(store, 'rel-orphan', 'owns', source.id, target.id)

      // Delete with no cascade (creates orphaned relationship)
      const result: CascadeDeleteResult = await (store as any).deleteThingWithOptions(source.id, {
        removeOutgoing: false,
        removeIncoming: false,
      })

      expect(result.outgoingRemoved).toBe(0)
      expect(result.incomingRemoved).toBe(0)

      // Relationship should still exist (orphaned)
      const relsAfter = await store.queryRelationshipsFrom(`do://test/${source.id}`)
      expect(relsAfter.length).toBe(1)
    })
  })

  // ============================================================================
  // 10. QUERY ORPHANED RELATIONSHIPS
  // ============================================================================

  describe('Orphaned relationships detection', () => {
    it('should be able to detect orphaned relationships after delete without cascade', async () => {
      const source = await createTestThing(store, 'orphan-detect-source', 'Customer', { name: 'Source' })
      const target = await createTestThing(store, 'orphan-detect-target', 'Product', { name: 'Target' })

      await createTestRelationship(store, 'rel-orphan-detect', 'owns', source.id, target.id)

      // Delete source without cascade (if deleteThingWithOptions with no cascade is used)
      // For now, the standard deleteThing creates orphaned relationships
      // until cascade is implemented

      // This test documents the current behavior (orphaned relationships)
      // and will need to be updated when cascade delete is implemented
      const relsBeforeDelete = await store.queryRelationshipsFrom(`do://test/${source.id}`)
      expect(relsBeforeDelete.length).toBe(1)

      // After deleteThing, check if relationship still exists
      await store.deleteThing(source.id)

      // Current behavior: relationship still exists (orphaned)
      // Expected behavior after fix: relationship removed
      const relsAfterDelete = await store.queryRelationshipsFrom(`do://test/${source.id}`)

      // This assertion will PASS in current (buggy) behavior
      // and FAIL once cascade delete is implemented
      // Uncomment the line below to verify current behavior creates orphans:
      // expect(relsAfterDelete.length).toBe(1) // Current: orphaned relationship exists

      // This is the correct behavior we want:
      expect(relsAfterDelete.length).toBe(0) // Expected: relationship removed
    })
  })

  // ============================================================================
  // 11. CROSS-DO URL RELATIONSHIPS
  // ============================================================================

  describe('Cross-DO URL relationships', () => {
    it('should handle relationships with full do:// URLs', async () => {
      const source = await createTestThing(store, 'url-source', 'Customer', { name: 'Source' })

      // Create relationship with explicit do:// URLs
      await store.createRelationship({
        id: 'rel-url-test',
        verb: 'integratesWith',
        from: `do://test/${source.id}`,
        to: 'do://other-namespace/external-service',
        data: { integration: 'oauth' },
      })

      // Verify relationship exists
      const relsBefore = await store.queryRelationshipsFrom(`do://test/${source.id}`)
      expect(relsBefore.length).toBe(1)

      // Delete source
      await store.deleteThing(source.id)

      // Relationship should be removed
      const relsAfter = await store.queryRelationshipsFrom(`do://test/${source.id}`)
      expect(relsAfter.length).toBe(0)
    })

    it('should handle relationships to external URLs', async () => {
      const source = await createTestThing(store, 'external-source', 'Customer', { name: 'Source' })

      // Create relationship to external service
      await store.createRelationship({
        id: 'rel-external',
        verb: 'integratesWith',
        from: `do://test/${source.id}`,
        to: 'https://github.com/org/repo',
        data: { branch: 'main' },
      })

      // Verify relationship exists
      const relsBefore = await store.queryRelationshipsFrom(`do://test/${source.id}`)
      expect(relsBefore.length).toBe(1)

      // Delete source
      await store.deleteThing(source.id)

      // Relationship should be removed
      const relsAfter = await store.queryRelationshipsFrom(`do://test/${source.id}`)
      expect(relsAfter.length).toBe(0)
    })
  })
})

// ============================================================================
// BATCH CASCADE DELETE TESTS
// ============================================================================

describe('Batch Cascade Delete', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
  })

  afterEach(async () => {
    await store.close()
  })

  it('should support deleting multiple Things with cascade', async () => {
    // Create 3 things with relationships between them
    const thing1 = await store.createThing({ id: 'batch-1', typeId: 1, typeName: 'Customer', data: {} })
    const thing2 = await store.createThing({ id: 'batch-2', typeId: 1, typeName: 'Customer', data: {} })
    const thing3 = await store.createThing({ id: 'batch-3', typeId: 1, typeName: 'Customer', data: {} })

    await store.createRelationship({
      id: 'rel-batch-1-2',
      verb: 'linksTo',
      from: `do://test/${thing1.id}`,
      to: `do://test/${thing2.id}`,
    })
    await store.createRelationship({
      id: 'rel-batch-2-3',
      verb: 'linksTo',
      from: `do://test/${thing2.id}`,
      to: `do://test/${thing3.id}`,
    })

    // Delete all three
    await Promise.all([store.deleteThing(thing1.id), store.deleteThing(thing2.id), store.deleteThing(thing3.id)])

    // All relationships should be removed
    const allRels = await store.queryRelationshipsByVerb('linksTo')
    expect(allRels.length).toBe(0)
  })
})
