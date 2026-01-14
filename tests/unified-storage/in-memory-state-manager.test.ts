/**
 * InMemoryStateManager Tests
 *
 * TDD RED PHASE - These tests MUST FAIL because the implementation doesn't exist yet.
 *
 * InMemoryStateManager is the core in-memory storage component for the Unified Storage
 * architecture. It provides:
 * - O(1) reads/writes via Map<string, Thing>
 * - Dirty tracking for checkpoint optimization
 * - LRU eviction via WriteBufferCache integration
 * - Bulk operations for cold start loading
 *
 * Architecture context (from unified-storage.md):
 * - All reads: O(1) memory lookup
 * - All writes: Update memory + mark dirty
 * - Dirty entries are checkpointed to SQLite lazily (every 5s or on hibernate)
 * - LRU eviction when memory limits exceeded
 *
 * Issue: do-2tr.2.1
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================================
// IMPORTS - These MUST FAIL because the implementation doesn't exist yet
// ============================================================================

// This import will fail - the file doesn't exist
import { InMemoryStateManager } from '../../objects/unified-storage/in-memory-state-manager'

// Type definitions for test clarity (these would be imported from types/Thing.ts in implementation)
interface ThingData {
  $id: string
  $type: string
  $version?: number
  name?: string
  data?: Record<string, unknown>
  createdAt?: Date
  updatedAt?: Date
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('InMemoryStateManager', () => {
  let manager: InMemoryStateManager

  beforeEach(() => {
    // Create fresh manager for each test
    manager = new InMemoryStateManager()
  })

  // ==========================================================================
  // CRUD OPERATIONS
  // ==========================================================================

  describe('CRUD operations', () => {
    it('should create a thing and return it with generated $id', () => {
      // Given: A thing without an ID
      const input = {
        $type: 'Customer',
        name: 'Alice',
        data: { email: 'alice@example.com' },
      }

      // When: Creating the thing
      const result = manager.create(input)

      // Then: Should return thing with generated $id
      expect(result.$id).toBeDefined()
      expect(result.$id).toMatch(/^customer_/) // Convention: lowercase type prefix
      expect(result.$type).toBe('Customer')
      expect(result.name).toBe('Alice')
      expect(result.$version).toBe(1)
    })

    it('should create a thing with provided $id', () => {
      // Given: A thing with explicit ID
      const input = {
        $id: 'customer_explicit_123',
        $type: 'Customer',
        name: 'Bob',
      }

      // When: Creating the thing
      const result = manager.create(input)

      // Then: Should preserve the provided $id
      expect(result.$id).toBe('customer_explicit_123')
      expect(result.$type).toBe('Customer')
    })

    it('should read a thing by $id in O(1)', () => {
      // Given: A created thing
      const created = manager.create({
        $type: 'Customer',
        name: 'Charlie',
      })

      // When: Reading by $id
      const result = manager.get(created.$id)

      // Then: Should return the same thing
      expect(result).toBeDefined()
      expect(result!.$id).toBe(created.$id)
      expect(result!.name).toBe('Charlie')
    })

    it('should update a thing and increment $version', () => {
      // Given: An existing thing
      const created = manager.create({
        $type: 'Customer',
        name: 'David',
      })
      const originalVersion = created.$version

      // When: Updating the thing
      const updated = manager.update(created.$id, { name: 'David Updated' })

      // Then: Should have incremented version
      expect(updated.$version).toBe(originalVersion! + 1)
      expect(updated.name).toBe('David Updated')
      expect(updated.$type).toBe('Customer') // Preserved

      // And: Reading should return updated version
      const read = manager.get(created.$id)
      expect(read!.name).toBe('David Updated')
      expect(read!.$version).toBe(originalVersion! + 1)
    })

    it('should merge updates by default', () => {
      // Given: A thing with multiple properties
      const created = manager.create({
        $type: 'Customer',
        name: 'Eve',
        data: { email: 'eve@example.com', phone: '555-1234' },
      })

      // When: Updating only one property
      const updated = manager.update(created.$id, {
        data: { email: 'eve.new@example.com' },
      })

      // Then: Other properties should be preserved (merge behavior)
      expect(updated.name).toBe('Eve')
      // Note: Deep merge behavior depends on implementation
    })

    it('should delete a thing', () => {
      // Given: An existing thing
      const created = manager.create({
        $type: 'Customer',
        name: 'Frank',
      })

      // When: Deleting the thing
      const deleted = manager.delete(created.$id)

      // Then: Should return the deleted thing
      expect(deleted).toBeDefined()
      expect(deleted!.$id).toBe(created.$id)

      // And: Reading should return null
      const read = manager.get(created.$id)
      expect(read).toBeNull()
    })

    it('should return null for non-existent thing', () => {
      // Given: A non-existent ID
      const nonExistentId = 'customer_does_not_exist'

      // When: Reading the thing
      const result = manager.get(nonExistentId)

      // Then: Should return null
      expect(result).toBeNull()
    })

    it('should throw or return null when updating non-existent thing', () => {
      // Given: A non-existent ID
      const nonExistentId = 'customer_ghost'

      // When/Then: Updating should throw or return null
      expect(() => manager.update(nonExistentId, { name: 'Ghost' })).toThrow()
      // Alternative: expect(manager.update(nonExistentId, { name: 'Ghost' })).toBeNull()
    })

    it('should return null when deleting non-existent thing', () => {
      // Given: A non-existent ID
      const nonExistentId = 'customer_phantom'

      // When: Deleting
      const result = manager.delete(nonExistentId)

      // Then: Should return null (idempotent delete)
      expect(result).toBeNull()
    })
  })

  // ==========================================================================
  // DIRTY TRACKING
  // ==========================================================================

  describe('dirty tracking', () => {
    it('should mark created things as dirty', () => {
      // Given: A fresh manager
      expect(manager.getDirtyCount()).toBe(0)

      // When: Creating a thing
      const created = manager.create({
        $type: 'Customer',
        name: 'Alice',
      })

      // Then: Should be marked as dirty
      expect(manager.isDirty(created.$id)).toBe(true)
      expect(manager.getDirtyCount()).toBe(1)
    })

    it('should mark updated things as dirty', () => {
      // Given: A created thing that has been marked clean
      const created = manager.create({
        $type: 'Customer',
        name: 'Bob',
      })
      manager.markClean([created.$id])
      expect(manager.isDirty(created.$id)).toBe(false)

      // When: Updating the thing
      manager.update(created.$id, { name: 'Bob Updated' })

      // Then: Should be marked as dirty again
      expect(manager.isDirty(created.$id)).toBe(true)
    })

    it('should not mark read-only access as dirty', () => {
      // Given: A created thing marked clean
      const created = manager.create({
        $type: 'Customer',
        name: 'Charlie',
      })
      manager.markClean([created.$id])
      const initialDirtyCount = manager.getDirtyCount()

      // When: Reading the thing (multiple times)
      manager.get(created.$id)
      manager.get(created.$id)
      manager.get(created.$id)

      // Then: Dirty count should not change
      expect(manager.getDirtyCount()).toBe(initialDirtyCount)
      expect(manager.isDirty(created.$id)).toBe(false)
    })

    it('should return all dirty entries', () => {
      // Given: Multiple things, some clean, some dirty
      const thing1 = manager.create({ $type: 'Customer', name: 'One' })
      const thing2 = manager.create({ $type: 'Customer', name: 'Two' })
      const thing3 = manager.create({ $type: 'Customer', name: 'Three' })

      // Mark first two as clean
      manager.markClean([thing1.$id, thing2.$id])

      // When: Getting dirty entries
      const dirtyEntries = manager.getDirtyEntries()

      // Then: Should only contain thing3
      expect(dirtyEntries.size).toBe(1)
      expect(dirtyEntries.has(thing3.$id)).toBe(true)
      expect(dirtyEntries.has(thing1.$id)).toBe(false)
      expect(dirtyEntries.has(thing2.$id)).toBe(false)
    })

    it('should clear dirty flag after markClean()', () => {
      // Given: Multiple dirty things
      const thing1 = manager.create({ $type: 'Customer', name: 'One' })
      const thing2 = manager.create({ $type: 'Customer', name: 'Two' })
      expect(manager.getDirtyCount()).toBe(2)

      // When: Marking all as clean
      manager.markClean([thing1.$id, thing2.$id])

      // Then: No dirty entries
      expect(manager.getDirtyCount()).toBe(0)
      expect(manager.isDirty(thing1.$id)).toBe(false)
      expect(manager.isDirty(thing2.$id)).toBe(false)
    })

    it('should track dirty state through updates correctly', () => {
      // Given: A thing created, marked clean, then updated
      const thing = manager.create({ $type: 'Task', name: 'Original' })
      manager.markClean([thing.$id])

      // When: Multiple updates
      manager.update(thing.$id, { name: 'First Update' })
      manager.update(thing.$id, { name: 'Second Update' })

      // Then: Should still be dirty (single entry, not duplicated)
      expect(manager.isDirty(thing.$id)).toBe(true)
      expect(manager.getDirtyCount()).toBe(1)
    })

    it('should remove from dirty set on delete', () => {
      // Given: A dirty thing
      const thing = manager.create({ $type: 'Customer', name: 'ToDelete' })
      expect(manager.isDirty(thing.$id)).toBe(true)

      // When: Deleting the thing
      manager.delete(thing.$id)

      // Then: Should no longer be in dirty set (thing doesn't exist)
      expect(manager.isDirty(thing.$id)).toBe(false)
      expect(manager.getDirtyCount()).toBe(0)
    })
  })

  // ==========================================================================
  // CACHE INTEGRATION (LRU EVICTION)
  // ==========================================================================

  describe('cache integration', () => {
    it('should evict LRU entries when max count exceeded', () => {
      // Given: Manager configured with small max count
      const evictedEntries: ThingData[] = []
      const smallManager = new InMemoryStateManager({
        maxEntries: 3,
        onEvict: (entries) => evictedEntries.push(...entries),
      })

      // When: Creating things and marking them clean for eviction
      const first = smallManager.create({ $type: 'Item', name: 'First' })
      const second = smallManager.create({ $type: 'Item', name: 'Second' })
      const third = smallManager.create({ $type: 'Item', name: 'Third' })

      // Mark as clean so they can be evicted
      smallManager.markClean([first.$id, second.$id, third.$id])

      smallManager.create({ $type: 'Item', name: 'Fourth' }) // Should trigger eviction

      // Then: LRU entry should be evicted
      expect(evictedEntries.length).toBeGreaterThan(0)
      expect(evictedEntries[0].name).toBe('First') // First in, first out
    })

    it('should evict entries when max bytes exceeded', () => {
      // Given: Manager configured with small max bytes
      const evictedEntries: ThingData[] = []
      const smallManager = new InMemoryStateManager({
        maxBytes: 500, // Very small limit
        onEvict: (entries) => evictedEntries.push(...entries),
      })

      // When: Creating things that exceed byte limit
      const doc1 = smallManager.create({
        $type: 'Document',
        name: 'Large Doc 1',
        data: { content: 'A'.repeat(200) },
      })
      const doc2 = smallManager.create({
        $type: 'Document',
        name: 'Large Doc 2',
        data: { content: 'B'.repeat(200) },
      })

      // Mark as clean so they can be evicted
      smallManager.markClean([doc1.$id, doc2.$id])

      smallManager.create({
        $type: 'Document',
        name: 'Large Doc 3',
        data: { content: 'C'.repeat(200) },
      })

      // Then: Should have evicted some entries
      expect(evictedEntries.length).toBeGreaterThan(0)
    })

    it('should call onEvict callback with evicted entries', () => {
      // Given: Manager with eviction callback
      const onEvict = vi.fn()
      const smallManager = new InMemoryStateManager({
        maxEntries: 2,
        onEvict,
      })

      // When: Creating items and marking some clean for eviction
      const one = smallManager.create({ $type: 'Item', name: 'One' })
      const two = smallManager.create({ $type: 'Item', name: 'Two' })

      // Mark first one clean so it can be evicted
      smallManager.markClean([one.$id])

      smallManager.create({ $type: 'Item', name: 'Three' }) // Triggers eviction

      // Then: Callback should have been called
      expect(onEvict).toHaveBeenCalled()
      const evictedArg = onEvict.mock.calls[0][0]
      expect(Array.isArray(evictedArg)).toBe(true)
      expect(evictedArg.length).toBeGreaterThan(0)
    })

    it('should update LRU order on read access', () => {
      // Given: Manager with small capacity
      const evictedEntries: ThingData[] = []
      const smallManager = new InMemoryStateManager({
        maxEntries: 3,
        onEvict: (entries) => evictedEntries.push(...entries),
      })

      // Create three things
      const first = smallManager.create({ $type: 'Item', name: 'First' })
      const second = smallManager.create({ $type: 'Item', name: 'Second' })
      const third = smallManager.create({ $type: 'Item', name: 'Third' })

      // Mark all as clean so they can be evicted
      smallManager.markClean([first.$id, second.$id, third.$id])

      // When: Access first item (makes it recently used)
      smallManager.get(first.$id)

      // And: Create a fourth item (triggers eviction of clean entries)
      smallManager.create({ $type: 'Item', name: 'Fourth' })

      // Then: Second item should be evicted (it was LRU clean), not first (recently accessed)
      expect(evictedEntries.length).toBe(1)
      expect(evictedEntries[0].name).toBe('Second')
    })

    it('should not evict dirty entries', () => {
      // Given: Manager with small capacity
      const evictedEntries: ThingData[] = []
      const smallManager = new InMemoryStateManager({
        maxEntries: 2,
        onEvict: (entries) => evictedEntries.push(...entries),
      })

      // Create things (all dirty by default)
      smallManager.create({ $type: 'Item', name: 'First' })
      smallManager.create({ $type: 'Item', name: 'Second' })

      // When: Creating third item
      smallManager.create({ $type: 'Item', name: 'Third' })

      // Then: No entries should be evicted (all are dirty)
      // Dirty entries must be checkpointed before eviction
      expect(evictedEntries.length).toBe(0)
    })

    it('should evict clean entries before dirty ones', () => {
      // Given: Manager with small capacity, some clean entries
      const evictedEntries: ThingData[] = []
      const smallManager = new InMemoryStateManager({
        maxEntries: 3,
        onEvict: (entries) => evictedEntries.push(...entries),
      })

      const first = smallManager.create({ $type: 'Item', name: 'First' })
      const second = smallManager.create({ $type: 'Item', name: 'Second' })
      const third = smallManager.create({ $type: 'Item', name: 'Third' })

      // Mark first and second as clean
      smallManager.markClean([first.$id, second.$id])

      // When: Creating fourth item (triggers eviction)
      smallManager.create({ $type: 'Item', name: 'Fourth' })

      // Then: Should evict clean entry (first), not dirty (third)
      expect(evictedEntries.length).toBe(1)
      expect(evictedEntries[0].name).toBe('First')
    })
  })

  // ==========================================================================
  // BULK OPERATIONS
  // ==========================================================================

  describe('bulk operations', () => {
    it('should load multiple things from array', () => {
      // Given: An array of things to load (e.g., from SQLite cold start)
      const thingsToLoad: ThingData[] = [
        { $id: 'customer_1', $type: 'Customer', name: 'Alice', $version: 5 },
        { $id: 'customer_2', $type: 'Customer', name: 'Bob', $version: 3 },
        { $id: 'order_1', $type: 'Order', name: 'Order #1', $version: 1 },
      ]

      // When: Loading bulk data
      manager.loadBulk(thingsToLoad)

      // Then: All things should be accessible
      expect(manager.get('customer_1')?.name).toBe('Alice')
      expect(manager.get('customer_2')?.name).toBe('Bob')
      expect(manager.get('order_1')?.name).toBe('Order #1')

      // And: Versions should be preserved
      expect(manager.get('customer_1')?.$version).toBe(5)
    })

    it('should not mark bulk-loaded things as dirty', () => {
      // Given: Things loaded from SQLite (already persisted)
      const thingsToLoad: ThingData[] = [
        { $id: 'customer_1', $type: 'Customer', name: 'Alice' },
        { $id: 'customer_2', $type: 'Customer', name: 'Bob' },
      ]

      // When: Loading bulk data
      manager.loadBulk(thingsToLoad)

      // Then: Should not be dirty (they're already persisted)
      expect(manager.isDirty('customer_1')).toBe(false)
      expect(manager.isDirty('customer_2')).toBe(false)
      expect(manager.getDirtyCount()).toBe(0)
    })

    it('should export all things as array', () => {
      // Given: Multiple things in manager
      manager.create({ $type: 'Customer', name: 'Alice' })
      manager.create({ $type: 'Customer', name: 'Bob' })
      manager.create({ $type: 'Order', name: 'Order #1' })

      // When: Exporting all things
      const exported = manager.exportAll()

      // Then: Should return array with all things
      expect(exported.length).toBe(3)
      expect(exported.map((t) => t.name).sort()).toEqual(['Alice', 'Bob', 'Order #1'].sort())
    })

    it('should export things by type', () => {
      // Given: Things of different types
      manager.create({ $type: 'Customer', name: 'Alice' })
      manager.create({ $type: 'Customer', name: 'Bob' })
      manager.create({ $type: 'Order', name: 'Order #1' })

      // When: Exporting by type
      const customers = manager.exportByType('Customer')
      const orders = manager.exportByType('Order')

      // Then: Should return filtered arrays
      expect(customers.length).toBe(2)
      expect(orders.length).toBe(1)
      expect(customers.every((t) => t.$type === 'Customer')).toBe(true)
    })

    it('should clear all state', () => {
      // Given: Manager with multiple things
      manager.create({ $type: 'Customer', name: 'Alice' })
      manager.create({ $type: 'Customer', name: 'Bob' })
      expect(manager.size()).toBeGreaterThan(0)

      // When: Clearing state
      manager.clear()

      // Then: Should have no things
      expect(manager.size()).toBe(0)
      expect(manager.getDirtyCount()).toBe(0)
    })

    it('should clear and reset dirty tracking', () => {
      // Given: Manager with dirty things
      manager.create({ $type: 'Customer', name: 'Alice' })
      expect(manager.getDirtyCount()).toBe(1)

      // When: Clearing state
      manager.clear()

      // Then: Dirty tracking should also be cleared
      expect(manager.getDirtyCount()).toBe(0)
      expect(manager.getDirtyEntries().size).toBe(0)
    })
  })

  // ==========================================================================
  // SIZE AND STATS
  // ==========================================================================

  describe('size and statistics', () => {
    it('should report correct size after operations', () => {
      // Given: Fresh manager
      expect(manager.size()).toBe(0)

      // When: Performing CRUD operations
      const thing1 = manager.create({ $type: 'Customer', name: 'One' })
      expect(manager.size()).toBe(1)

      manager.create({ $type: 'Customer', name: 'Two' })
      expect(manager.size()).toBe(2)

      manager.delete(thing1.$id)
      expect(manager.size()).toBe(1)
    })

    it('should report memory usage stats', () => {
      // Given: Manager with things
      manager.create({ $type: 'Customer', name: 'Alice', data: { large: 'A'.repeat(1000) } })
      manager.create({ $type: 'Customer', name: 'Bob', data: { large: 'B'.repeat(1000) } })

      // When: Getting stats
      const stats = manager.getStats()

      // Then: Should include useful metrics
      expect(stats.entryCount).toBe(2)
      expect(stats.dirtyCount).toBe(2)
      expect(stats.estimatedBytes).toBeGreaterThan(0)
      expect(stats.memoryUsageRatio).toBeGreaterThanOrEqual(0)
      expect(stats.memoryUsageRatio).toBeLessThanOrEqual(1)
    })

    it('should list all IDs', () => {
      // Given: Multiple things
      const thing1 = manager.create({ $type: 'Customer', name: 'Alice' })
      const thing2 = manager.create({ $type: 'Order', name: 'Order #1' })

      // When: Getting all IDs
      const ids = manager.getAllIds()

      // Then: Should contain both IDs
      expect(ids).toContain(thing1.$id)
      expect(ids).toContain(thing2.$id)
      expect(ids.length).toBe(2)
    })

    it('should check if ID exists', () => {
      // Given: A created thing
      const thing = manager.create({ $type: 'Customer', name: 'Alice' })

      // Then: Should report existence correctly
      expect(manager.has(thing.$id)).toBe(true)
      expect(manager.has('nonexistent_id')).toBe(false)
    })
  })

  // ==========================================================================
  // CONCURRENCY CONSIDERATIONS
  // ==========================================================================

  describe('concurrency behavior', () => {
    it('should handle rapid sequential updates', () => {
      // Given: A thing to update rapidly
      const thing = manager.create({ $type: 'Counter', name: 'counter', data: { value: 0 } })

      // When: Rapid sequential updates
      for (let i = 1; i <= 100; i++) {
        manager.update(thing.$id, { data: { value: i } })
      }

      // Then: Should have final value
      const result = manager.get(thing.$id)
      expect(result?.data?.value).toBe(100)
      expect(result?.$version).toBe(101) // 1 create + 100 updates
    })

    it('should maintain consistency during mixed operations', () => {
      // Given: Multiple concurrent-like operations
      const ids: string[] = []
      for (let i = 0; i < 10; i++) {
        const thing = manager.create({ $type: 'Item', name: `Item ${i}` })
        ids.push(thing.$id)
      }

      // When: Mixed reads, updates, deletes
      manager.update(ids[0], { name: 'Updated 0' })
      manager.delete(ids[1])
      manager.get(ids[2])
      manager.update(ids[3], { name: 'Updated 3' })
      manager.delete(ids[4])

      // Then: State should be consistent
      expect(manager.get(ids[0])?.name).toBe('Updated 0')
      expect(manager.get(ids[1])).toBeNull()
      expect(manager.get(ids[2])?.name).toBe('Item 2')
      expect(manager.get(ids[3])?.name).toBe('Updated 3')
      expect(manager.get(ids[4])).toBeNull()
      expect(manager.size()).toBe(8) // 10 - 2 deleted
    })
  })

  // ==========================================================================
  // TYPE SAFETY
  // ==========================================================================

  describe('type safety', () => {
    it('should require $type on create', () => {
      // This test validates that $type is required
      // @ts-expect-error - $type is required
      expect(() => manager.create({ name: 'No Type' })).toThrow()
    })

    it('should preserve $type on update', () => {
      // Given: A thing with a type
      const thing = manager.create({ $type: 'Customer', name: 'Alice' })

      // When: Updating without $type
      const updated = manager.update(thing.$id, { name: 'Alice Updated' })

      // Then: $type should be preserved
      expect(updated.$type).toBe('Customer')
    })

    it('should not allow $id change on update', () => {
      // Given: An existing thing
      const thing = manager.create({ $type: 'Customer', name: 'Alice' })
      const originalId = thing.$id

      // When/Then: Attempting to change $id should be ignored or throw
      const updated = manager.update(thing.$id, {
        $id: 'different_id',
        name: 'Alice Updated',
      } as Partial<ThingData>)

      expect(updated.$id).toBe(originalId) // ID should not change
    })
  })
})
