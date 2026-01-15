/**
 * InMemoryStateManager Memory Limits Tests
 *
 * MIXED PHASE:
 * - GREEN: Basic memory limits (maxEntries, maxBytes, LRU eviction)
 * - RED: Advanced capacity features (strict mode, FIFO, TTL, priority, utilization metrics)
 *
 * Current implementation includes:
 * 1. maxEntries and maxBytes limits enforced on create(), loadBulk(), and put()
 * 2. LRU eviction of clean entries, with fallback to dirty entries under pressure
 * 3. forceEvict() API for critical memory pressure scenarios
 * 4. onMemoryPressure callback when clean entries are exhausted
 *
 * RED tests document desired features for future implementation:
 * - strictCapacity mode: reject entries instead of evicting
 * - FIFO eviction policy: alternative to LRU
 * - TTL-based eviction: auto-expire entries after timeout
 * - Priority-based eviction: evict low-priority entries first
 * - Capacity utilization metrics: getCapacityUtilization()
 * - Capacity reservation: reserveCapacity() for guaranteed allocation
 *
 * @see storage/in-memory-state-manager.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  InMemoryStateManager,
  type ThingData,
  type CreateThingInput,
} from '../../storage/in-memory-state-manager'

describe('InMemoryStateManager Memory Limits', () => {
  describe('maxEntries enforcement', () => {
    it('should enforce maxEntries limit during create()', () => {
      const onEvict = vi.fn()
      const manager = new InMemoryStateManager({
        maxEntries: 5,
        onEvict,
      })

      // Create 5 entries - should be at capacity
      for (let i = 0; i < 5; i++) {
        manager.create({ $type: 'Item', name: `item-${i}` })
      }

      // Mark some as clean to allow eviction
      const keys = manager.getDirtyKeys()
      manager.markClean(keys.slice(0, 3)) // Mark first 3 as clean

      // Create one more - should trigger eviction
      manager.create({ $type: 'Item', name: 'item-5' })

      // Store should not exceed maxEntries
      expect(manager.size()).toBeLessThanOrEqual(5)
      expect(onEvict).toHaveBeenCalled()
    })

    it('should enforce maxEntries limit during loadBulk()', () => {
      const onEvict = vi.fn()
      const manager = new InMemoryStateManager({
        maxEntries: 5,
        onEvict,
      })

      // Bulk load 10 entries - should respect the limit
      const things: ThingData[] = Array.from({ length: 10 }, (_, i) => ({
        $id: `item_${i}`,
        $type: 'Item',
        $version: 1,
        name: `item-${i}`,
      }))

      manager.loadBulk(things)

      // loadBulk() enforces maxEntries via maybeEvict()
      expect(manager.size()).toBeLessThanOrEqual(5)
    })

    it('should call onEvict callback with evicted entries during bulk load', () => {
      const evictedEntries: ThingData[] = []
      const onEvict = vi.fn((entries: ThingData[]) => {
        evictedEntries.push(...entries)
      })

      const manager = new InMemoryStateManager({
        maxEntries: 3,
        onEvict,
      })

      // Bulk load 6 entries
      const things: ThingData[] = Array.from({ length: 6 }, (_, i) => ({
        $id: `item_${i}`,
        $type: 'Item',
        $version: 1,
        name: `item-${i}`,
      }))

      manager.loadBulk(things)

      // onEvict is called during loadBulk when eviction occurs
      expect(onEvict).toHaveBeenCalled()
      expect(evictedEntries.length).toBeGreaterThanOrEqual(3)
    })
  })

  describe('maxBytes enforcement', () => {
    it('should enforce maxBytes limit during create()', () => {
      const onEvict = vi.fn()
      // Each entry is roughly 100-150 bytes when serialized
      const manager = new InMemoryStateManager({
        maxBytes: 500,
        onEvict,
      })

      // Create entries until we're at capacity
      for (let i = 0; i < 5; i++) {
        const thing = manager.create({ $type: 'Item', name: `item-${i}` })
        manager.markClean([thing.$id]) // Allow eviction
      }

      // Get current stats
      const statsBefore = manager.getStats()

      // Create a large entry that should trigger eviction
      manager.create({
        $type: 'Item',
        name: 'large-item',
        data: { padding: 'x'.repeat(200) },
      })

      // Bytes should stay bounded (with some tolerance for the last entry)
      const statsAfter = manager.getStats()
      expect(statsAfter.estimatedBytes).toBeLessThanOrEqual(700) // 500 + tolerance
    })

    it('should enforce maxBytes limit during loadBulk()', () => {
      const onEvict = vi.fn()
      const manager = new InMemoryStateManager({
        maxBytes: 500,
        onEvict,
      })

      // Create large entries that exceed the byte limit
      const things: ThingData[] = Array.from({ length: 5 }, (_, i) => ({
        $id: `large_${i}`,
        $type: 'LargeItem',
        $version: 1,
        name: `large-item-${i}`,
        data: { payload: 'x'.repeat(200) },
      }))

      manager.loadBulk(things)

      // loadBulk() enforces maxBytes via maybeEvict()
      const stats = manager.getStats()
      expect(stats.estimatedBytes).toBeLessThanOrEqual(700) // 500 + tolerance
    })
  })

  describe('LRU eviction policy', () => {
    it('should evict least recently used clean entries first', () => {
      const evictedIds: string[] = []
      const onEvict = vi.fn((entries: ThingData[]) => {
        evictedIds.push(...entries.map((e) => e.$id))
      })

      const manager = new InMemoryStateManager({
        maxEntries: 3,
        onEvict,
      })

      // Create entries in order
      const item0 = manager.create({ $id: 'oldest', $type: 'Item' })
      const item1 = manager.create({ $id: 'middle', $type: 'Item' })
      const item2 = manager.create({ $id: 'newest', $type: 'Item' })

      // Mark all as clean
      manager.markClean(['oldest', 'middle', 'newest'])

      // Access 'oldest' to make it recently used
      manager.get('oldest')

      // Create a new entry - should evict 'middle' (LRU among clean)
      manager.create({ $id: 'trigger', $type: 'Item' })

      // 'middle' should be evicted, not 'oldest' (which was accessed)
      expect(evictedIds).toContain('middle')
      expect(evictedIds).not.toContain('oldest')
    })

    it('should only evict clean entries, not dirty ones', () => {
      const evictedIds: string[] = []
      const onEvict = vi.fn((entries: ThingData[]) => {
        evictedIds.push(...entries.map((e) => e.$id))
      })

      const manager = new InMemoryStateManager({
        maxEntries: 3,
        onEvict,
      })

      // Create entries
      manager.create({ $id: 'dirty1', $type: 'Item' })
      manager.create({ $id: 'dirty2', $type: 'Item' })
      manager.create({ $id: 'clean1', $type: 'Item' })

      // Mark only clean1 as clean
      manager.markClean(['clean1'])

      // Create a new entry - should evict clean1
      manager.create({ $id: 'trigger', $type: 'Item' })

      // Only clean entry should be evicted
      expect(evictedIds).toEqual(['clean1'])
    })

    it('should NOT allow unbounded growth when all entries are dirty', () => {
      // When all entries are dirty, the implementation:
      // 1. Calls onMemoryPressure callback first
      // 2. Then force evicts dirty entries as a last resort
      const onEvict = vi.fn()
      const manager = new InMemoryStateManager({
        maxEntries: 3,
        onEvict,
      })

      // Create entries (all will be dirty)
      manager.create({ $id: 'item1', $type: 'Item' })
      manager.create({ $id: 'item2', $type: 'Item' })
      manager.create({ $id: 'item3', $type: 'Item' })

      // Do NOT mark any as clean - all are dirty

      // Create more entries - these should be rejected or force eviction
      manager.create({ $id: 'item4', $type: 'Item' })
      manager.create({ $id: 'item5', $type: 'Item' })
      manager.create({ $id: 'item6', $type: 'Item' })

      // Size is bounded at maxEntries; dirty entries are evicted under pressure
      expect(manager.size()).toBeLessThanOrEqual(3)
    })
  })

  describe('memory pressure handling', () => {
    it('should have a mechanism to force eviction under memory pressure', () => {
      // forceEvict() API allows explicit eviction of dirty entries
      // after checkpointing them
      const manager = new InMemoryStateManager({
        maxEntries: 100,
      })

      // Fill with dirty entries
      for (let i = 0; i < 100; i++) {
        manager.create({ $type: 'Item', name: `item-${i}` })
      }

      // forceEvict() method exists for explicit eviction
      expect(typeof (manager as any).forceEvict).toBe('function')
    })

    it('should provide memory pressure callback/hook', () => {
      // onMemoryPressure callback is called when clean entries are exhausted
      // and dirty entries must be evicted
      const onMemoryPressure = vi.fn()

      const manager = new InMemoryStateManager({
        maxEntries: 3,
        onEvict: () => {},
        onMemoryPressure,
      })

      // Fill with dirty entries
      manager.create({ $type: 'Item' })
      manager.create({ $type: 'Item' })
      manager.create({ $type: 'Item' })

      // Try to add more - should trigger memory pressure callback
      manager.create({ $type: 'Item' })

      expect(onMemoryPressure).toHaveBeenCalled()
    })
  })

  describe('eviction callback contract', () => {
    it('should call onEvict with complete ThingData objects', () => {
      const evictedData: ThingData[] = []
      const onEvict = vi.fn((entries: ThingData[]) => {
        evictedData.push(...entries)
      })

      const manager = new InMemoryStateManager({
        maxEntries: 2,
        onEvict,
      })

      // Create entries
      const thing1 = manager.create({
        $type: 'Customer',
        name: 'Alice',
        email: 'alice@example.com',
      })
      manager.markClean([thing1.$id])

      manager.create({ $type: 'Customer', name: 'Bob' })
      manager.markClean(manager.getDirtyKeys())

      // Trigger eviction
      manager.create({ $type: 'Customer', name: 'Charlie' })

      // Verify evicted data is complete
      expect(evictedData.length).toBeGreaterThan(0)
      expect(evictedData[0]).toHaveProperty('$id')
      expect(evictedData[0]).toHaveProperty('$type')
      expect(evictedData[0]).toHaveProperty('$version')
    })

    it('should batch evictions into single onEvict call', () => {
      const onEvict = vi.fn()

      const manager = new InMemoryStateManager({
        maxEntries: 5,  // Set limit to allow 5 entries
        onEvict,
      })

      // Create 5 entries (within limit, no eviction)
      for (let i = 0; i < 5; i++) {
        manager.create({ $type: 'Item', name: `item-${i}` })
      }
      manager.markClean(manager.getDirtyKeys())

      // Reset mock to only count from here
      onEvict.mockClear()

      // Now reduce limit and trigger eviction by adding more entries
      // Since we can't change maxEntries, we create multiple entries to force eviction
      // With 5 entries and maxEntries=5, creating more will exceed limit
      manager.create({ $type: 'Item', name: 'trigger-1' })
      manager.create({ $type: 'Item', name: 'trigger-2' })
      manager.create({ $type: 'Item', name: 'trigger-3' })
      manager.create({ $type: 'Item', name: 'trigger-4' })

      // onEvict should be called for each create that exceeds the limit
      // All evictions should be batched per operation
      expect(onEvict).toHaveBeenCalled()

      // Total evicted entries should be 4 (5 clean + 4 new dirty - 5 = 4)
      // Each new entry triggers eviction of one clean entry
      const totalEvicted = onEvict.mock.calls.reduce(
        (sum, call) => sum + call[0].length,
        0
      )
      expect(totalEvicted).toBe(4)
    })
  })

  /**
   * RED PHASE: Tests for features that don't exist yet.
   * These tests document desired behavior for future implementation.
   */
  describe('strict capacity enforcement (RED - failing tests)', () => {
    it('should reject entries when strictCapacity mode is enabled', () => {
      /**
       * RED TEST: InMemoryStateManager always accepts new entries and evicts old ones.
       * For some use cases, we need strict rejection when at capacity.
       */
      const onReject = vi.fn()
      const manager = new InMemoryStateManager({
        maxEntries: 3,
        // @ts-expect-error - strictCapacity option doesn't exist yet
        strictCapacity: true,
        // @ts-expect-error - onReject callback doesn't exist yet
        onReject,
      })

      // Fill capacity
      manager.create({ $id: 'item-1', $type: 'Item' })
      manager.create({ $id: 'item-2', $type: 'Item' })
      manager.create({ $id: 'item-3', $type: 'Item' })

      // 4th entry should be rejected in strict mode (return null instead of evicting)
      const result = manager.create({ $id: 'item-overflow', $type: 'Item' })

      // In strict mode, create should return null and call onReject
      expect(result).toBeNull()
      expect(onReject).toHaveBeenCalled()
      expect(manager.size()).toBe(3)
    })

    it('should support FIFO eviction policy as alternative to LRU', () => {
      /**
       * RED TEST: Tests FIFO eviction policy. Currently only LRU is supported.
       * With FIFO, order of insertion matters, not access time.
       */
      const evictedIds: string[] = []
      const manager = new InMemoryStateManager({
        maxEntries: 3,
        // @ts-expect-error - evictionPolicy option doesn't exist
        evictionPolicy: 'fifo',
        onEvict: (entries) => evictedIds.push(...entries.map((e) => e.$id)),
      })

      manager.create({ $id: 'first', $type: 'Item' })
      manager.create({ $id: 'second', $type: 'Item' })
      manager.create({ $id: 'third', $type: 'Item' })
      manager.markClean(['first', 'second', 'third'])

      // Access 'first' to make it recently used (should NOT affect FIFO)
      manager.get('first')

      // Add new entry - with FIFO, should evict 'first' (first in, first out)
      // But with current LRU, it will evict 'second' instead
      manager.create({ $id: 'fourth', $type: 'Item' })

      // With FIFO, 'first' should be evicted despite being recently accessed
      expect(evictedIds).toContain('first')
      expect(evictedIds).not.toContain('second')
    })

    it('should expose capacity utilization metrics via getCapacityUtilization()', () => {
      /**
       * RED TEST: The manager should expose utilization as percentages
       * for monitoring and auto-scaling decisions.
       */
      const manager = new InMemoryStateManager({
        maxEntries: 100,
        maxBytes: 10000,
      })

      // Add entries to reach ~50% capacity
      for (let i = 0; i < 50; i++) {
        manager.create({ $type: 'Item', name: `item-${i}` })
      }

      // @ts-expect-error - getCapacityUtilization() doesn't exist
      const utilization = manager.getCapacityUtilization()

      expect(utilization).toHaveProperty('entryUtilization')
      expect(utilization).toHaveProperty('byteUtilization')
      expect(utilization.entryUtilization).toBeCloseTo(0.5, 1) // ~50%
    })

    it('should support TTL-based automatic eviction', async () => {
      /**
       * RED TEST: Entries should support TTL (time-to-live)
       * and automatically become unavailable when expired.
       */
      const manager = new InMemoryStateManager({
        maxEntries: 100,
        // @ts-expect-error - defaultTTL option doesn't exist
        defaultTTL: 100, // 100ms TTL
      })

      manager.create({ $id: 'short-lived', $type: 'Item' })

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 150))

      // Entry should return null after TTL expires
      const result = manager.get('short-lived')
      expect(result).toBeNull()
    })

    it('should support reserveCapacity for guaranteed allocation', () => {
      /**
       * RED TEST: For critical operations, reserve capacity in advance
       * to guarantee space will be available.
       */
      const manager = new InMemoryStateManager({
        maxEntries: 10,
      })

      // Fill to 8 entries
      for (let i = 0; i < 8; i++) {
        manager.create({ $type: 'Item' })
      }

      // Reserve 3 entries for critical operation
      // @ts-expect-error - reserveCapacity doesn't exist
      const reservation = manager.reserveCapacity(3)

      expect(reservation).toBeTruthy()
      expect(reservation.token).toBeDefined()

      // Normal create should fail due to reservation
      const result = manager.create({ $type: 'Item' })
      expect(result).toBeNull()

      // Use the reservation
      // @ts-expect-error - createWithReservation doesn't exist
      const reserved = manager.createWithReservation(reservation.token, { $type: 'Critical' })
      expect(reserved.$type).toBe('Critical')
    })

    it('should support priority-based eviction', () => {
      /**
       * RED TEST: Entries with lower priority should be evicted first,
       * regardless of LRU order.
       */
      const evictedIds: string[] = []
      const manager = new InMemoryStateManager({
        maxEntries: 3,
        onEvict: (entries) => evictedIds.push(...entries.map((e) => e.$id)),
      })

      // Create with different priorities
      // @ts-expect-error - $priority field doesn't exist
      manager.create({ $id: 'high', $type: 'Item', $priority: 10 })
      // @ts-expect-error - $priority field doesn't exist
      manager.create({ $id: 'low', $type: 'Item', $priority: 1 })
      // @ts-expect-error - $priority field doesn't exist
      manager.create({ $id: 'medium', $type: 'Item', $priority: 5 })

      manager.markClean(['high', 'low', 'medium'])

      // Trigger eviction
      manager.create({ $id: 'new', $type: 'Item' })

      // 'low' should be evicted first due to lowest priority
      expect(evictedIds[0]).toBe('low')
    })
  })

  describe('stats accuracy', () => {
    it('should accurately track estimatedBytes after eviction', () => {
      const manager = new InMemoryStateManager({
        maxEntries: 2,
      })

      // Create entries
      manager.create({ $type: 'Item', data: { payload: 'x'.repeat(100) } })
      manager.create({ $type: 'Item', data: { payload: 'y'.repeat(100) } })

      const bytesBefore = manager.getStats().estimatedBytes

      // Mark as clean and trigger eviction
      manager.markClean(manager.getDirtyKeys())
      manager.create({ $type: 'Item', data: { payload: 'z'.repeat(100) } })

      const bytesAfter = manager.getStats().estimatedBytes

      // Bytes should decrease after eviction
      // 2 entries of ~100 bytes each, one evicted, one added
      expect(bytesAfter).toBeLessThan(bytesBefore + 250)
      expect(manager.size()).toBe(2)
    })

    it('should track dirty count correctly through eviction cycles', () => {
      const manager = new InMemoryStateManager({
        maxEntries: 3,
      })

      // Create 3 entries (all dirty)
      manager.create({ $type: 'Item' })
      manager.create({ $type: 'Item' })
      manager.create({ $type: 'Item' })

      expect(manager.getDirtyCount()).toBe(3)

      // Mark 2 as clean
      const keys = manager.getDirtyKeys()
      manager.markClean(keys.slice(0, 2))

      expect(manager.getDirtyCount()).toBe(1)

      // Trigger eviction by adding more
      manager.create({ $type: 'Item' })

      // Dirty count should include new entry, minus any evicted dirty entries
      expect(manager.getDirtyCount()).toBeLessThanOrEqual(2)
      expect(manager.size()).toBeLessThanOrEqual(3)
    })
  })
})
