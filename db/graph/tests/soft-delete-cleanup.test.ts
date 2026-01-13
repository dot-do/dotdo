/**
 * Relationship Cleanup on Soft Delete Tests
 *
 * TDD RED phase: Failing tests for relationship cleanup when a Thing is soft deleted.
 *
 * @see dotdo-37vuc - [RED] Implement relationship cleanup on soft delete
 *
 * Background:
 * When a Thing is soft deleted (deletedAt set), its relationships become orphaned.
 * This can cause:
 * 1. Stale references when querying relationships
 * 2. Incorrect graph traversals pointing to deleted nodes
 * 3. Index pollution with references to soft-deleted records
 * 4. Storage bloat from orphaned relationship data
 *
 * Solution: deleteThingWithCleanup() method that:
 * 1. Soft deletes the Thing (sets deletedAt)
 * 2. Marks related relationships for cleanup
 * 3. Updates indexes to exclude soft-deleted records
 * 4. Optionally triggers a compaction job for old soft-deleted records
 *
 * This test file verifies:
 * 1. deleteThingWithCleanup() method exists and functions correctly
 * 2. Orphaned relationships are cleaned up when a Thing is soft deleted
 * 3. Indexes are updated to exclude soft-deleted records
 * 4. Compaction job for old soft-deleted records works correctly
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// ============================================================================
// EXPECTED TYPES - Document the expected API contract
// ============================================================================

/**
 * Options for deleteThingWithCleanup operation
 */
interface DeleteWithCleanupOptions {
  /** Whether to clean up relationships where this thing is the source */
  cleanupOutgoing?: boolean
  /** Whether to clean up relationships where this thing is the target */
  cleanupIncoming?: boolean
  /** Whether to cascade soft delete to related things */
  cascade?: boolean
  /** Dry run - return what would be cleaned up without actually deleting */
  dryRun?: boolean
}

/**
 * Result of deleteThingWithCleanup operation
 */
interface DeleteWithCleanupResult {
  /** The deleted Thing */
  thing: {
    id: string
    typeId: number
    typeName: string
    deletedAt: number
  }
  /** Number of outgoing relationships cleaned up */
  outgoingRelationshipsRemoved: number
  /** Number of incoming relationships cleaned up */
  incomingRelationshipsRemoved: number
  /** IDs of cascade-deleted things (if cascade: true) */
  cascadeDeletedThingIds: string[]
}

/**
 * Options for compacting soft-deleted records
 */
interface CompactSoftDeletedOptions {
  /** Only compact records deleted before this date */
  olderThan?: Date
  /** Maximum number of records to compact in one batch */
  batchSize?: number
  /** Whether to archive before permanent deletion */
  archive?: boolean
  /** Only compact specific types */
  types?: string[]
  /** Dry run - return what would be compacted without actually deleting */
  dryRun?: boolean
}

/**
 * Result of compacting soft-deleted records
 */
interface CompactSoftDeletedResult {
  /** Number of Things permanently deleted */
  thingsRemoved: number
  /** Number of orphaned relationships removed */
  relationshipsRemoved: number
  /** Archived records count (if archive: true) */
  recordsArchived: number
}

// ============================================================================
// 1. deleteThingWithCleanup() METHOD TESTS
// ============================================================================

describe('[RED] deleteThingWithCleanup() Method', () => {
  describe('Method Export and Signature', () => {
    it('deleteThingWithCleanup is exported from db/graph/things', async () => {
      const thingsModule = await import('../things').catch(() => null)

      expect(thingsModule).not.toBeNull()
      expect(thingsModule?.deleteThingWithCleanup).toBeDefined()
      expect(typeof thingsModule?.deleteThingWithCleanup).toBe('function')
    })

    it('deleteThingWithCleanup accepts id and options parameters', async () => {
      const thingsModule = await import('../things').catch(() => null)

      if (!thingsModule?.deleteThingWithCleanup) {
        throw new Error('deleteThingWithCleanup not implemented')
      }

      // Function should accept (db, id, options?)
      expect(thingsModule.deleteThingWithCleanup.length).toBeGreaterThanOrEqual(2)
    })

    it('deleteThingWithCleanup returns DeleteWithCleanupResult', async () => {
      const thingsModule = await import('../things').catch(() => null)

      if (!thingsModule?.deleteThingWithCleanup) {
        throw new Error('deleteThingWithCleanup not implemented')
      }

      // Result should have the expected shape
      const expectedResultShape: DeleteWithCleanupResult = {
        thing: { id: 'test', typeId: 1, typeName: 'Test', deletedAt: Date.now() },
        outgoingRelationshipsRemoved: 0,
        incomingRelationshipsRemoved: 0,
        cascadeDeletedThingIds: [],
      }

      expect(expectedResultShape).toHaveProperty('thing')
      expect(expectedResultShape).toHaveProperty('outgoingRelationshipsRemoved')
      expect(expectedResultShape).toHaveProperty('incomingRelationshipsRemoved')
      expect(expectedResultShape).toHaveProperty('cascadeDeletedThingIds')
    })
  })

  describe('Basic Soft Delete with Cleanup', () => {
    it('soft deletes a Thing and sets deletedAt timestamp', async () => {
      const thingsModule = await import('../things').catch(() => null)

      if (!thingsModule?.deleteThingWithCleanup || !thingsModule?.createThing || !thingsModule?.getThing) {
        throw new Error('Required functions not implemented')
      }

      const mockDb = {}

      // Create a test thing
      await thingsModule.createThing(mockDb, {
        id: 'cleanup-test-1',
        typeId: 1,
        typeName: 'Customer',
        data: { name: 'Alice' },
      })

      // Delete with cleanup
      const result = await thingsModule.deleteThingWithCleanup(mockDb, 'cleanup-test-1')

      expect(result.thing.id).toBe('cleanup-test-1')
      expect(result.thing.deletedAt).toBeDefined()
      expect(result.thing.deletedAt).toBeGreaterThan(0)

      // Verify the thing is soft deleted
      const deleted = await thingsModule.getThing(mockDb, 'cleanup-test-1')
      expect(deleted?.deletedAt).not.toBeNull()
    })

    it('returns null/throws for non-existent Thing', async () => {
      const thingsModule = await import('../things').catch(() => null)

      if (!thingsModule?.deleteThingWithCleanup) {
        throw new Error('deleteThingWithCleanup not implemented')
      }

      const mockDb = {}

      await expect(thingsModule.deleteThingWithCleanup(mockDb, 'non-existent-id')).rejects.toThrow()
    })

    it('is idempotent - deleting already deleted Thing updates timestamp', async () => {
      const thingsModule = await import('../things').catch(() => null)

      if (!thingsModule?.deleteThingWithCleanup || !thingsModule?.createThing) {
        throw new Error('Required functions not implemented')
      }

      const mockDb = {}

      await thingsModule.createThing(mockDb, {
        id: 'idempotent-test',
        typeId: 1,
        typeName: 'Customer',
        data: { name: 'Bob' },
      })

      // Delete first time
      const result1 = await thingsModule.deleteThingWithCleanup(mockDb, 'idempotent-test')

      // Small delay
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Delete second time should update timestamp or be no-op
      const result2 = await thingsModule.deleteThingWithCleanup(mockDb, 'idempotent-test')

      expect(result2.thing.deletedAt).toBeGreaterThanOrEqual(result1.thing.deletedAt)
    })
  })
})

// ============================================================================
// 2. OUTGOING RELATIONSHIP CLEANUP TESTS
// ============================================================================

describe('[RED] Outgoing Relationship Cleanup', () => {
  describe('Cleanup relationships where deleted Thing is source', () => {
    it('removes outgoing relationships by default', async () => {
      const thingsModule = await import('../things').catch(() => null)
      const { RelationshipsStore } = await import('../relationships')

      if (!thingsModule?.deleteThingWithCleanup || !thingsModule?.createThing) {
        throw new Error('Required functions not implemented')
      }

      const mockDb = {}
      const relStore = new RelationshipsStore(mockDb)

      // Create source and target things
      await thingsModule.createThing(mockDb, {
        id: 'source-thing',
        typeId: 1,
        typeName: 'Customer',
        data: { name: 'Source' },
      })

      await thingsModule.createThing(mockDb, {
        id: 'target-thing',
        typeId: 2,
        typeName: 'Product',
        data: { name: 'Target' },
      })

      // Create outgoing relationship from source to target
      await relStore.create({
        id: 'outgoing-rel-1',
        verb: 'owns',
        from: 'source-thing',
        to: 'target-thing',
      })

      // Delete source thing with cleanup
      const result = await thingsModule.deleteThingWithCleanup(mockDb, 'source-thing', {
        cleanupOutgoing: true,
      })

      expect(result.outgoingRelationshipsRemoved).toBe(1)

      // Verify relationship is removed
      const remainingRels = await relStore.queryByFrom('source-thing')
      expect(remainingRels.length).toBe(0)
    })

    it('removes multiple outgoing relationships', async () => {
      const thingsModule = await import('../things').catch(() => null)
      const { RelationshipsStore } = await import('../relationships')

      if (!thingsModule?.deleteThingWithCleanup || !thingsModule?.createThing) {
        throw new Error('Required functions not implemented')
      }

      const mockDb = {}
      const relStore = new RelationshipsStore(mockDb)

      // Create things
      await thingsModule.createThing(mockDb, {
        id: 'multi-source',
        typeId: 1,
        typeName: 'Customer',
        data: {},
      })

      for (let i = 1; i <= 3; i++) {
        await thingsModule.createThing(mockDb, {
          id: `multi-target-${i}`,
          typeId: 2,
          typeName: 'Product',
          data: {},
        })

        await relStore.create({
          id: `multi-rel-${i}`,
          verb: 'owns',
          from: 'multi-source',
          to: `multi-target-${i}`,
        })
      }

      // Delete source
      const result = await thingsModule.deleteThingWithCleanup(mockDb, 'multi-source', {
        cleanupOutgoing: true,
      })

      expect(result.outgoingRelationshipsRemoved).toBe(3)
    })

    it('can skip outgoing cleanup with cleanupOutgoing: false', async () => {
      const thingsModule = await import('../things').catch(() => null)
      const { RelationshipsStore } = await import('../relationships')

      if (!thingsModule?.deleteThingWithCleanup || !thingsModule?.createThing) {
        throw new Error('Required functions not implemented')
      }

      const mockDb = {}
      const relStore = new RelationshipsStore(mockDb)

      await thingsModule.createThing(mockDb, {
        id: 'skip-source',
        typeId: 1,
        typeName: 'Customer',
        data: {},
      })

      await thingsModule.createThing(mockDb, {
        id: 'skip-target',
        typeId: 2,
        typeName: 'Product',
        data: {},
      })

      await relStore.create({
        id: 'skip-rel',
        verb: 'owns',
        from: 'skip-source',
        to: 'skip-target',
      })

      // Delete without outgoing cleanup
      const result = await thingsModule.deleteThingWithCleanup(mockDb, 'skip-source', {
        cleanupOutgoing: false,
      })

      expect(result.outgoingRelationshipsRemoved).toBe(0)

      // Relationship should still exist (orphaned)
      const remainingRels = await relStore.queryByFrom('skip-source')
      expect(remainingRels.length).toBe(1)
    })
  })
})

// ============================================================================
// 3. INCOMING RELATIONSHIP CLEANUP TESTS
// ============================================================================

describe('[RED] Incoming Relationship Cleanup', () => {
  describe('Cleanup relationships where deleted Thing is target', () => {
    it('removes incoming relationships by default', async () => {
      const thingsModule = await import('../things').catch(() => null)
      const { RelationshipsStore } = await import('../relationships')

      if (!thingsModule?.deleteThingWithCleanup || !thingsModule?.createThing) {
        throw new Error('Required functions not implemented')
      }

      const mockDb = {}
      const relStore = new RelationshipsStore(mockDb)

      // Create things
      await thingsModule.createThing(mockDb, {
        id: 'incoming-source',
        typeId: 1,
        typeName: 'Customer',
        data: {},
      })

      await thingsModule.createThing(mockDb, {
        id: 'incoming-target',
        typeId: 2,
        typeName: 'Product',
        data: {},
      })

      // Create incoming relationship to target
      await relStore.create({
        id: 'incoming-rel',
        verb: 'owns',
        from: 'incoming-source',
        to: 'incoming-target',
      })

      // Delete target thing with cleanup
      const result = await thingsModule.deleteThingWithCleanup(mockDb, 'incoming-target', {
        cleanupIncoming: true,
      })

      expect(result.incomingRelationshipsRemoved).toBe(1)

      // Verify relationship is removed
      const remainingRels = await relStore.queryByTo('incoming-target')
      expect(remainingRels.length).toBe(0)
    })

    it('removes multiple incoming relationships', async () => {
      const thingsModule = await import('../things').catch(() => null)
      const { RelationshipsStore } = await import('../relationships')

      if (!thingsModule?.deleteThingWithCleanup || !thingsModule?.createThing) {
        throw new Error('Required functions not implemented')
      }

      const mockDb = {}
      const relStore = new RelationshipsStore(mockDb)

      // Create target
      await thingsModule.createThing(mockDb, {
        id: 'multi-incoming-target',
        typeId: 2,
        typeName: 'Product',
        data: {},
      })

      // Create multiple sources pointing to target
      for (let i = 1; i <= 5; i++) {
        await thingsModule.createThing(mockDb, {
          id: `multi-incoming-source-${i}`,
          typeId: 1,
          typeName: 'Customer',
          data: {},
        })

        await relStore.create({
          id: `multi-incoming-rel-${i}`,
          verb: 'owns',
          from: `multi-incoming-source-${i}`,
          to: 'multi-incoming-target',
        })
      }

      // Delete target
      const result = await thingsModule.deleteThingWithCleanup(mockDb, 'multi-incoming-target', {
        cleanupIncoming: true,
      })

      expect(result.incomingRelationshipsRemoved).toBe(5)
    })

    it('can skip incoming cleanup with cleanupIncoming: false', async () => {
      const thingsModule = await import('../things').catch(() => null)
      const { RelationshipsStore } = await import('../relationships')

      if (!thingsModule?.deleteThingWithCleanup || !thingsModule?.createThing) {
        throw new Error('Required functions not implemented')
      }

      const mockDb = {}
      const relStore = new RelationshipsStore(mockDb)

      await thingsModule.createThing(mockDb, {
        id: 'skip-inc-source',
        typeId: 1,
        typeName: 'Customer',
        data: {},
      })

      await thingsModule.createThing(mockDb, {
        id: 'skip-inc-target',
        typeId: 2,
        typeName: 'Product',
        data: {},
      })

      await relStore.create({
        id: 'skip-inc-rel',
        verb: 'owns',
        from: 'skip-inc-source',
        to: 'skip-inc-target',
      })

      // Delete without incoming cleanup
      const result = await thingsModule.deleteThingWithCleanup(mockDb, 'skip-inc-target', {
        cleanupIncoming: false,
      })

      expect(result.incomingRelationshipsRemoved).toBe(0)

      // Relationship should still exist (orphaned)
      const remainingRels = await relStore.queryByTo('skip-inc-target')
      expect(remainingRels.length).toBe(1)
    })
  })

  describe('Combined incoming and outgoing cleanup', () => {
    it('cleans up both directions when thing is in middle of graph', async () => {
      const thingsModule = await import('../things').catch(() => null)
      const { RelationshipsStore } = await import('../relationships')

      if (!thingsModule?.deleteThingWithCleanup || !thingsModule?.createThing) {
        throw new Error('Required functions not implemented')
      }

      const mockDb = {}
      const relStore = new RelationshipsStore(mockDb)

      // Create graph: A -> B -> C
      await thingsModule.createThing(mockDb, { id: 'node-A', typeId: 1, typeName: 'Node', data: {} })
      await thingsModule.createThing(mockDb, { id: 'node-B', typeId: 1, typeName: 'Node', data: {} })
      await thingsModule.createThing(mockDb, { id: 'node-C', typeId: 1, typeName: 'Node', data: {} })

      await relStore.create({ id: 'rel-A-B', verb: 'linksTo', from: 'node-A', to: 'node-B' })
      await relStore.create({ id: 'rel-B-C', verb: 'linksTo', from: 'node-B', to: 'node-C' })

      // Delete B (middle node)
      const result = await thingsModule.deleteThingWithCleanup(mockDb, 'node-B', {
        cleanupOutgoing: true,
        cleanupIncoming: true,
      })

      expect(result.incomingRelationshipsRemoved).toBe(1) // A -> B
      expect(result.outgoingRelationshipsRemoved).toBe(1) // B -> C
    })
  })
})

// ============================================================================
// 4. CASCADE DELETE TESTS
// ============================================================================

describe('[RED] Cascade Soft Delete', () => {
  describe('Cascade delete to related things', () => {
    it('cascade deletes outgoing related things when cascade: true', async () => {
      const thingsModule = await import('../things').catch(() => null)
      const { RelationshipsStore } = await import('../relationships')

      if (!thingsModule?.deleteThingWithCleanup || !thingsModule?.createThing || !thingsModule?.getThing) {
        throw new Error('Required functions not implemented')
      }

      const mockDb = {}
      const relStore = new RelationshipsStore(mockDb)

      // Create parent with children
      await thingsModule.createThing(mockDb, { id: 'parent', typeId: 1, typeName: 'Parent', data: {} })
      await thingsModule.createThing(mockDb, { id: 'child-1', typeId: 2, typeName: 'Child', data: {} })
      await thingsModule.createThing(mockDb, { id: 'child-2', typeId: 2, typeName: 'Child', data: {} })

      await relStore.create({ id: 'parent-child-1', verb: 'owns', from: 'parent', to: 'child-1' })
      await relStore.create({ id: 'parent-child-2', verb: 'owns', from: 'parent', to: 'child-2' })

      // Cascade delete parent
      const result = await thingsModule.deleteThingWithCleanup(mockDb, 'parent', {
        cascade: true,
        cleanupOutgoing: true,
      })

      expect(result.cascadeDeletedThingIds).toContain('child-1')
      expect(result.cascadeDeletedThingIds).toContain('child-2')

      // Children should also be soft deleted
      const child1 = await thingsModule.getThing(mockDb, 'child-1')
      const child2 = await thingsModule.getThing(mockDb, 'child-2')
      expect(child1?.deletedAt).not.toBeNull()
      expect(child2?.deletedAt).not.toBeNull()
    })

    it('does not cascade when cascade: false (default)', async () => {
      const thingsModule = await import('../things').catch(() => null)
      const { RelationshipsStore } = await import('../relationships')

      if (!thingsModule?.deleteThingWithCleanup || !thingsModule?.createThing || !thingsModule?.getThing) {
        throw new Error('Required functions not implemented')
      }

      const mockDb = {}
      const relStore = new RelationshipsStore(mockDb)

      await thingsModule.createThing(mockDb, { id: 'no-cascade-parent', typeId: 1, typeName: 'Parent', data: {} })
      await thingsModule.createThing(mockDb, { id: 'no-cascade-child', typeId: 2, typeName: 'Child', data: {} })

      await relStore.create({
        id: 'no-cascade-rel',
        verb: 'owns',
        from: 'no-cascade-parent',
        to: 'no-cascade-child',
      })

      // Delete without cascade
      const result = await thingsModule.deleteThingWithCleanup(mockDb, 'no-cascade-parent', {
        cascade: false,
      })

      expect(result.cascadeDeletedThingIds.length).toBe(0)

      // Child should still be active
      const child = await thingsModule.getThing(mockDb, 'no-cascade-child')
      expect(child?.deletedAt).toBeNull()
    })

    it('cascade respects depth limit to prevent infinite loops', async () => {
      const thingsModule = await import('../things').catch(() => null)
      const { RelationshipsStore } = await import('../relationships')

      if (!thingsModule?.deleteThingWithCleanup || !thingsModule?.createThing) {
        throw new Error('Required functions not implemented')
      }

      const mockDb = {}
      const relStore = new RelationshipsStore(mockDb)

      // Create circular reference: A -> B -> C -> A
      await thingsModule.createThing(mockDb, { id: 'cycle-A', typeId: 1, typeName: 'Node', data: {} })
      await thingsModule.createThing(mockDb, { id: 'cycle-B', typeId: 1, typeName: 'Node', data: {} })
      await thingsModule.createThing(mockDb, { id: 'cycle-C', typeId: 1, typeName: 'Node', data: {} })

      await relStore.create({ id: 'cycle-A-B', verb: 'linksTo', from: 'cycle-A', to: 'cycle-B' })
      await relStore.create({ id: 'cycle-B-C', verb: 'linksTo', from: 'cycle-B', to: 'cycle-C' })
      await relStore.create({ id: 'cycle-C-A', verb: 'linksTo', from: 'cycle-C', to: 'cycle-A' })

      // Should not infinite loop
      const result = await thingsModule.deleteThingWithCleanup(mockDb, 'cycle-A', {
        cascade: true,
      })

      // Should complete without hanging
      expect(result.thing.id).toBe('cycle-A')
    })
  })
})

// ============================================================================
// 5. DRY RUN MODE TESTS
// ============================================================================

describe('[RED] Dry Run Mode', () => {
  describe('Preview cleanup without actual deletion', () => {
    it('dryRun: true returns what would be deleted without deleting', async () => {
      const thingsModule = await import('../things').catch(() => null)
      const { RelationshipsStore } = await import('../relationships')

      if (!thingsModule?.deleteThingWithCleanup || !thingsModule?.createThing || !thingsModule?.getThing) {
        throw new Error('Required functions not implemented')
      }

      const mockDb = {}
      const relStore = new RelationshipsStore(mockDb)

      await thingsModule.createThing(mockDb, { id: 'dryrun-source', typeId: 1, typeName: 'Customer', data: {} })
      await thingsModule.createThing(mockDb, { id: 'dryrun-target', typeId: 2, typeName: 'Product', data: {} })

      await relStore.create({
        id: 'dryrun-rel',
        verb: 'owns',
        from: 'dryrun-source',
        to: 'dryrun-target',
      })

      // Dry run delete
      const result = await thingsModule.deleteThingWithCleanup(mockDb, 'dryrun-source', {
        dryRun: true,
        cleanupOutgoing: true,
      })

      // Should report what would be deleted
      expect(result.outgoingRelationshipsRemoved).toBe(1)

      // But thing should NOT be deleted
      const thing = await thingsModule.getThing(mockDb, 'dryrun-source')
      expect(thing?.deletedAt).toBeNull()

      // Relationship should still exist
      const rels = await relStore.queryByFrom('dryrun-source')
      expect(rels.length).toBe(1)
    })
  })
})

// ============================================================================
// 6. INDEX UPDATE TESTS
// ============================================================================

describe('[RED] Index Updates for Soft-Deleted Records', () => {
  describe('getThingsByType excludes soft-deleted by default', () => {
    it('soft-deleted things are excluded from getThingsByType by default', async () => {
      const thingsModule = await import('../things').catch(() => null)

      if (
        !thingsModule?.deleteThingWithCleanup ||
        !thingsModule?.createThing ||
        !thingsModule?.getThingsByType
      ) {
        throw new Error('Required functions not implemented')
      }

      const mockDb = {}

      // Create multiple things of same type
      await thingsModule.createThing(mockDb, { id: 'idx-cust-1', typeId: 1, typeName: 'Customer', data: {} })
      await thingsModule.createThing(mockDb, { id: 'idx-cust-2', typeId: 1, typeName: 'Customer', data: {} })
      await thingsModule.createThing(mockDb, { id: 'idx-cust-3', typeId: 1, typeName: 'Customer', data: {} })

      // Delete one
      await thingsModule.deleteThingWithCleanup(mockDb, 'idx-cust-2')

      // Query should exclude deleted
      const customers = await thingsModule.getThingsByType(mockDb, { typeName: 'Customer' })
      expect(customers.length).toBe(2)
      expect(customers.map((c: { id: string }) => c.id)).not.toContain('idx-cust-2')
    })

    it('soft-deleted things included when includeDeleted: true', async () => {
      const thingsModule = await import('../things').catch(() => null)

      if (
        !thingsModule?.deleteThingWithCleanup ||
        !thingsModule?.createThing ||
        !thingsModule?.getThingsByType
      ) {
        throw new Error('Required functions not implemented')
      }

      const mockDb = {}

      await thingsModule.createThing(mockDb, { id: 'inc-del-1', typeId: 1, typeName: 'Customer', data: {} })
      await thingsModule.createThing(mockDb, { id: 'inc-del-2', typeId: 1, typeName: 'Customer', data: {} })

      await thingsModule.deleteThingWithCleanup(mockDb, 'inc-del-1')

      // Query with includeDeleted
      const all = await thingsModule.getThingsByType(mockDb, {
        typeName: 'Customer',
        includeDeleted: true,
      })
      expect(all.length).toBe(2)
    })
  })

  describe('Relationship queries exclude soft-deleted things', () => {
    it('queryByFrom excludes relationships from soft-deleted things', async () => {
      const thingsModule = await import('../things').catch(() => null)
      const { RelationshipsStore } = await import('../relationships')

      if (!thingsModule?.deleteThingWithCleanup || !thingsModule?.createThing) {
        throw new Error('Required functions not implemented')
      }

      const mockDb = {}
      const relStore = new RelationshipsStore(mockDb)

      await thingsModule.createThing(mockDb, { id: 'rel-idx-src', typeId: 1, typeName: 'Node', data: {} })
      await thingsModule.createThing(mockDb, { id: 'rel-idx-tgt', typeId: 1, typeName: 'Node', data: {} })

      await relStore.create({ id: 'rel-idx-1', verb: 'links', from: 'rel-idx-src', to: 'rel-idx-tgt' })

      // Delete source without cleanup (to test orphaned relationship query)
      await thingsModule.deleteThingWithCleanup(mockDb, 'rel-idx-src', {
        cleanupOutgoing: false,
      })

      // When querying relationships, implementation should optionally filter out
      // relationships where source is soft-deleted
      // This tests a potential new option: excludeDeletedSources
      const rels = await relStore.queryByFrom('rel-idx-src', { excludeDeletedSources: true } as never)

      // The expectation is that this should return 0 or be filtered
      expect(rels.length).toBe(0)
    })
  })
})

// ============================================================================
// 7. COMPACTION JOB TESTS
// ============================================================================

describe('[RED] Compaction Job for Soft-Deleted Records', () => {
  describe('compactSoftDeleted() method', () => {
    it('compactSoftDeleted is exported from db/graph/things', async () => {
      const thingsModule = await import('../things').catch(() => null)

      expect(thingsModule).not.toBeNull()
      expect(thingsModule?.compactSoftDeleted).toBeDefined()
      expect(typeof thingsModule?.compactSoftDeleted).toBe('function')
    })

    it('permanently removes soft-deleted records older than specified date', async () => {
      const thingsModule = await import('../things').catch(() => null)

      if (
        !thingsModule?.compactSoftDeleted ||
        !thingsModule?.createThing ||
        !thingsModule?.deleteThingWithCleanup ||
        !thingsModule?.getThing
      ) {
        throw new Error('Required functions not implemented')
      }

      const mockDb = {}

      // Create and delete a thing
      await thingsModule.createThing(mockDb, {
        id: 'compact-test-1',
        typeId: 1,
        typeName: 'Customer',
        data: {},
      })

      await thingsModule.deleteThingWithCleanup(mockDb, 'compact-test-1')

      // Compact records older than now (should include the just-deleted record)
      const futureDate = new Date(Date.now() + 1000)
      const result: CompactSoftDeletedResult = await thingsModule.compactSoftDeleted(mockDb, {
        olderThan: futureDate,
      })

      expect(result.thingsRemoved).toBeGreaterThanOrEqual(1)

      // Thing should be permanently gone
      const thing = await thingsModule.getThing(mockDb, 'compact-test-1')
      expect(thing).toBeNull()
    })

    it('respects batchSize limit', async () => {
      const thingsModule = await import('../things').catch(() => null)

      if (
        !thingsModule?.compactSoftDeleted ||
        !thingsModule?.createThing ||
        !thingsModule?.deleteThingWithCleanup
      ) {
        throw new Error('Required functions not implemented')
      }

      const mockDb = {}

      // Create and delete multiple things
      for (let i = 0; i < 10; i++) {
        await thingsModule.createThing(mockDb, {
          id: `batch-${i}`,
          typeId: 1,
          typeName: 'Customer',
          data: {},
        })
        await thingsModule.deleteThingWithCleanup(mockDb, `batch-${i}`)
      }

      // Compact with batch size of 3
      const result: CompactSoftDeletedResult = await thingsModule.compactSoftDeleted(mockDb, {
        batchSize: 3,
        olderThan: new Date(Date.now() + 1000),
      })

      expect(result.thingsRemoved).toBe(3)
    })

    it('filters by type when types option specified', async () => {
      const thingsModule = await import('../things').catch(() => null)

      if (
        !thingsModule?.compactSoftDeleted ||
        !thingsModule?.createThing ||
        !thingsModule?.deleteThingWithCleanup ||
        !thingsModule?.getThing
      ) {
        throw new Error('Required functions not implemented')
      }

      const mockDb = {}

      // Create and delete different types
      await thingsModule.createThing(mockDb, { id: 'type-cust', typeId: 1, typeName: 'Customer', data: {} })
      await thingsModule.createThing(mockDb, { id: 'type-prod', typeId: 2, typeName: 'Product', data: {} })

      await thingsModule.deleteThingWithCleanup(mockDb, 'type-cust')
      await thingsModule.deleteThingWithCleanup(mockDb, 'type-prod')

      // Compact only Customer type
      const result: CompactSoftDeletedResult = await thingsModule.compactSoftDeleted(mockDb, {
        types: ['Customer'],
        olderThan: new Date(Date.now() + 1000),
      })

      expect(result.thingsRemoved).toBe(1)

      // Customer should be gone, Product should still exist (soft-deleted)
      const cust = await thingsModule.getThing(mockDb, 'type-cust')
      const prod = await thingsModule.getThing(mockDb, 'type-prod')
      expect(cust).toBeNull()
      expect(prod).not.toBeNull()
    })

    it('removes orphaned relationships during compaction', async () => {
      const thingsModule = await import('../things').catch(() => null)
      const { RelationshipsStore } = await import('../relationships')

      if (
        !thingsModule?.compactSoftDeleted ||
        !thingsModule?.createThing ||
        !thingsModule?.deleteThingWithCleanup
      ) {
        throw new Error('Required functions not implemented')
      }

      const mockDb = {}
      const relStore = new RelationshipsStore(mockDb)

      // Create things with relationship
      await thingsModule.createThing(mockDb, { id: 'orphan-src', typeId: 1, typeName: 'Node', data: {} })
      await thingsModule.createThing(mockDb, { id: 'orphan-tgt', typeId: 1, typeName: 'Node', data: {} })

      await relStore.create({ id: 'orphan-rel', verb: 'links', from: 'orphan-src', to: 'orphan-tgt' })

      // Delete without relationship cleanup (leaves orphan)
      await thingsModule.deleteThingWithCleanup(mockDb, 'orphan-src', {
        cleanupOutgoing: false,
      })

      // Compaction should clean up orphaned relationships
      const result: CompactSoftDeletedResult = await thingsModule.compactSoftDeleted(mockDb, {
        olderThan: new Date(Date.now() + 1000),
      })

      expect(result.relationshipsRemoved).toBeGreaterThanOrEqual(1)
    })

    it('archives before deletion when archive: true', async () => {
      const thingsModule = await import('../things').catch(() => null)

      if (
        !thingsModule?.compactSoftDeleted ||
        !thingsModule?.createThing ||
        !thingsModule?.deleteThingWithCleanup
      ) {
        throw new Error('Required functions not implemented')
      }

      const mockDb = {}

      await thingsModule.createThing(mockDb, {
        id: 'archive-test',
        typeId: 1,
        typeName: 'Customer',
        data: { important: 'data' },
      })

      await thingsModule.deleteThingWithCleanup(mockDb, 'archive-test')

      const result: CompactSoftDeletedResult = await thingsModule.compactSoftDeleted(mockDb, {
        archive: true,
        olderThan: new Date(Date.now() + 1000),
      })

      expect(result.recordsArchived).toBeGreaterThanOrEqual(1)
    })

    it('dryRun mode returns counts without actual deletion', async () => {
      const thingsModule = await import('../things').catch(() => null)

      if (
        !thingsModule?.compactSoftDeleted ||
        !thingsModule?.createThing ||
        !thingsModule?.deleteThingWithCleanup ||
        !thingsModule?.getThing
      ) {
        throw new Error('Required functions not implemented')
      }

      const mockDb = {}

      await thingsModule.createThing(mockDb, {
        id: 'compact-dryrun',
        typeId: 1,
        typeName: 'Customer',
        data: {},
      })

      await thingsModule.deleteThingWithCleanup(mockDb, 'compact-dryrun')

      // Dry run
      const result: CompactSoftDeletedResult = await thingsModule.compactSoftDeleted(mockDb, {
        dryRun: true,
        olderThan: new Date(Date.now() + 1000),
      })

      expect(result.thingsRemoved).toBeGreaterThanOrEqual(1)

      // Thing should still exist
      const thing = await thingsModule.getThing(mockDb, 'compact-dryrun')
      expect(thing).not.toBeNull()
    })
  })
})

// ============================================================================
// 8. SQLiteGraphStore INTEGRATION TESTS
// ============================================================================

describe('[RED] SQLiteGraphStore deleteThingWithCleanup Integration', () => {
  describe('SQLiteGraphStore has deleteThingWithCleanup method', () => {
    it('SQLiteGraphStore exports deleteThingWithCleanup method', async () => {
      const { SQLiteGraphStore } = await import('../stores/sqlite')

      expect(SQLiteGraphStore.prototype.deleteThingWithCleanup).toBeDefined()
      expect(typeof SQLiteGraphStore.prototype.deleteThingWithCleanup).toBe('function')
    })

    it('works with real SQLite database', async () => {
      const { SQLiteGraphStore } = await import('../stores/sqlite')

      const store = new SQLiteGraphStore(':memory:')
      await store.initialize()

      try {
        // Create things
        await store.createThing({
          id: 'sqlite-cleanup-src',
          typeId: 1,
          typeName: 'Customer',
          data: { name: 'Test' },
        })

        await store.createThing({
          id: 'sqlite-cleanup-tgt',
          typeId: 2,
          typeName: 'Product',
          data: { name: 'Widget' },
        })

        // Create relationship
        await store.createRelationship({
          id: 'sqlite-cleanup-rel',
          verb: 'owns',
          from: 'sqlite-cleanup-src',
          to: 'sqlite-cleanup-tgt',
        })

        // Delete with cleanup
        const result = await store.deleteThingWithCleanup('sqlite-cleanup-src', {
          cleanupOutgoing: true,
        })

        expect(result.thing.id).toBe('sqlite-cleanup-src')
        expect(result.outgoingRelationshipsRemoved).toBe(1)
      } finally {
        await store.close()
      }
    })
  })

  describe('SQLiteGraphStore has compactSoftDeleted method', () => {
    it('SQLiteGraphStore exports compactSoftDeleted method', async () => {
      const { SQLiteGraphStore } = await import('../stores/sqlite')

      expect(SQLiteGraphStore.prototype.compactSoftDeleted).toBeDefined()
      expect(typeof SQLiteGraphStore.prototype.compactSoftDeleted).toBe('function')
    })
  })
})

// ============================================================================
// 9. EDGE CASES AND ERROR HANDLING
// ============================================================================

describe('[RED] Edge Cases and Error Handling', () => {
  describe('Error scenarios', () => {
    it('throws meaningful error when deleting non-existent thing', async () => {
      const thingsModule = await import('../things').catch(() => null)

      if (!thingsModule?.deleteThingWithCleanup) {
        throw new Error('deleteThingWithCleanup not implemented')
      }

      const mockDb = {}

      await expect(
        thingsModule.deleteThingWithCleanup(mockDb, 'does-not-exist')
      ).rejects.toThrow(/not found/i)
    })

    it('handles concurrent deletions gracefully', async () => {
      const thingsModule = await import('../things').catch(() => null)

      if (!thingsModule?.deleteThingWithCleanup || !thingsModule?.createThing) {
        throw new Error('Required functions not implemented')
      }

      const mockDb = {}

      await thingsModule.createThing(mockDb, {
        id: 'concurrent-delete',
        typeId: 1,
        typeName: 'Customer',
        data: {},
      })

      // Concurrent deletions should not throw
      const results = await Promise.all([
        thingsModule.deleteThingWithCleanup(mockDb, 'concurrent-delete'),
        thingsModule.deleteThingWithCleanup(mockDb, 'concurrent-delete'),
      ])

      // At least one should succeed
      expect(results.some((r) => r.thing.id === 'concurrent-delete')).toBe(true)
    })
  })

  describe('Self-referential relationships', () => {
    it('handles self-referential relationships (from === to)', async () => {
      const thingsModule = await import('../things').catch(() => null)
      const { RelationshipsStore } = await import('../relationships')

      if (!thingsModule?.deleteThingWithCleanup || !thingsModule?.createThing) {
        throw new Error('Required functions not implemented')
      }

      const mockDb = {}
      const relStore = new RelationshipsStore(mockDb)

      // Create thing with self-reference
      await thingsModule.createThing(mockDb, { id: 'self-ref', typeId: 1, typeName: 'Node', data: {} })

      await relStore.create({ id: 'self-ref-rel', verb: 'references', from: 'self-ref', to: 'self-ref' })

      // Delete should clean up the self-referential relationship
      const result = await thingsModule.deleteThingWithCleanup(mockDb, 'self-ref', {
        cleanupOutgoing: true,
        cleanupIncoming: true,
      })

      // The self-referential relationship counts as both incoming and outgoing
      // Implementation may count it once or twice - both are acceptable
      const totalRemoved = result.outgoingRelationshipsRemoved + result.incomingRelationshipsRemoved
      expect(totalRemoved).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Empty state handling', () => {
    it('handles thing with no relationships', async () => {
      const thingsModule = await import('../things').catch(() => null)

      if (!thingsModule?.deleteThingWithCleanup || !thingsModule?.createThing) {
        throw new Error('Required functions not implemented')
      }

      const mockDb = {}

      await thingsModule.createThing(mockDb, {
        id: 'no-rels',
        typeId: 1,
        typeName: 'Customer',
        data: {},
      })

      const result = await thingsModule.deleteThingWithCleanup(mockDb, 'no-rels', {
        cleanupOutgoing: true,
        cleanupIncoming: true,
      })

      expect(result.outgoingRelationshipsRemoved).toBe(0)
      expect(result.incomingRelationshipsRemoved).toBe(0)
    })

    it('compaction on empty database returns zeros', async () => {
      const thingsModule = await import('../things').catch(() => null)

      if (!thingsModule?.compactSoftDeleted) {
        throw new Error('compactSoftDeleted not implemented')
      }

      const mockDb = {}

      const result: CompactSoftDeletedResult = await thingsModule.compactSoftDeleted(mockDb, {
        olderThan: new Date(),
      })

      expect(result.thingsRemoved).toBe(0)
      expect(result.relationshipsRemoved).toBe(0)
      expect(result.recordsArchived).toBe(0)
    })
  })
})
