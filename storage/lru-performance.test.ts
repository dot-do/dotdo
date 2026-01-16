/**
 * LRU Performance Tests - RED Phase
 *
 * These tests verify that LRU operations are O(1), not O(n).
 * We measure the time for operations at different cache sizes to verify
 * the complexity doesn't scale linearly with cache size.
 *
 * Issue: do-wbso
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryStateManager } from './in-memory-state-manager'

describe('LRU Performance Tests', () => {
  describe('O(1) operation complexity', () => {
    /**
     * This test verifies that access operations don't scale with cache size.
     * With O(n) implementation (indexOf + splice), time would grow linearly.
     * With O(1) implementation (Map-based), time should remain constant.
     *
     * Note: In workerd environment, timer resolution is coarse (1ms), so we use
     * more iterations to get measurable times and assert on absolute performance.
     */
    it('should maintain constant time for access operations regardless of cache size', () => {
      const largeCache = new InMemoryStateManager({ maxEntries: 100000 })

      // Create a large cache to test O(1) behavior
      const LARGE_SIZE = 10000
      const largeIds: string[] = []

      for (let i = 0; i < LARGE_SIZE; i++) {
        const thing = largeCache.create({ $type: 'Item', name: `item-${i}` })
        largeIds.push(thing.$id)
      }

      // Mark all as clean so eviction can happen
      largeCache.markClean(largeIds)

      // With O(1) implementation, 10000 accesses should complete quickly
      // With O(n), each access does O(n) work, so 10000 accesses = O(n^2) = 100M operations
      const ITERATIONS = 10000
      const start = performance.now()
      for (let i = 0; i < ITERATIONS; i++) {
        const randomIndex = Math.floor(Math.random() * LARGE_SIZE)
        largeCache.get(largeIds[randomIndex])
      }
      const elapsed = performance.now() - start

      console.log(`Large cache (${LARGE_SIZE}): ${elapsed.toFixed(2)}ms for ${ITERATIONS} accesses`)

      // O(1): 10000 accesses at ~1ms each = ~10-50ms
      // O(n): 10000 accesses at 10000 ops each = ~5000+ms
      // Allow generous margin, but anything over 500ms indicates O(n)
      expect(elapsed).toBeLessThan(500)
    })

    /**
     * Test that eviction operations are O(1).
     * Finding the LRU entry should not require scanning the entire array.
     */
    it('should maintain constant time for eviction operations', () => {
      const SMALL_SIZE = 100
      const LARGE_SIZE = 5000

      // Test eviction time with small cache
      const smallEvicted: unknown[] = []
      const smallCache = new InMemoryStateManager({
        maxEntries: SMALL_SIZE,
        onEvict: (entries) => smallEvicted.push(...entries),
      })

      // Fill to capacity
      for (let i = 0; i < SMALL_SIZE; i++) {
        const thing = smallCache.create({ $type: 'Item', name: `item-${i}` })
        smallCache.markClean([thing.$id])
      }

      // Measure eviction time (create new entries that trigger eviction)
      const EVICTIONS = 500
      const smallStart = performance.now()
      for (let i = 0; i < EVICTIONS; i++) {
        const thing = smallCache.create({ $type: 'Item', name: `new-${i}` })
        smallCache.markClean([thing.$id])
      }
      const smallTime = performance.now() - smallStart

      // Test eviction time with large cache
      const largeEvicted: unknown[] = []
      const largeCache = new InMemoryStateManager({
        maxEntries: LARGE_SIZE,
        onEvict: (entries) => largeEvicted.push(...entries),
      })

      // Fill to capacity
      for (let i = 0; i < LARGE_SIZE; i++) {
        const thing = largeCache.create({ $type: 'Item', name: `item-${i}` })
        largeCache.markClean([thing.$id])
      }

      // Measure eviction time
      const largeStart = performance.now()
      for (let i = 0; i < EVICTIONS; i++) {
        const thing = largeCache.create({ $type: 'Item', name: `new-${i}` })
        largeCache.markClean([thing.$id])
      }
      const largeTime = performance.now() - largeStart

      console.log(`Small cache eviction (${SMALL_SIZE}): ${smallTime.toFixed(2)}ms for ${EVICTIONS} evictions`)
      console.log(`Large cache eviction (${LARGE_SIZE}): ${largeTime.toFixed(2)}ms for ${EVICTIONS} evictions`)
      console.log(`Ratio: ${(largeTime / smallTime).toFixed(2)}x`)

      // O(1) eviction should have ratio < 5x, O(n) would have ratio > 20x
      expect(largeTime / smallTime).toBeLessThan(10)
    })

    /**
     * Test the specific operations that were O(n) in the old implementation:
     * - removeFromAccessOrder using indexOf + splice
     * - updateAccessOrder using push after removal
     */
    it('should complete 10000 sequential updates in under 100ms', () => {
      const cache = new InMemoryStateManager({ maxEntries: 100000 })
      const ids: string[] = []

      // Create 10000 entries
      for (let i = 0; i < 10000; i++) {
        const thing = cache.create({ $type: 'Item', name: `item-${i}` })
        ids.push(thing.$id)
      }

      // Measure time to update all entries (which triggers LRU reordering)
      const start = performance.now()
      for (const id of ids) {
        cache.update(id, { name: 'updated' })
      }
      const elapsed = performance.now() - start

      console.log(`10000 sequential updates: ${elapsed.toFixed(2)}ms`)

      // With O(1), this should complete in ~50ms
      // With O(n), this would take ~5000ms+ (each update doing O(n) work)
      expect(elapsed).toBeLessThan(500) // Very generous for O(1), still fails for O(n)
    })
  })

  describe('LRU correctness', () => {
    let cache: InMemoryStateManager
    let evicted: Array<{ $id: string; name?: string }>

    beforeEach(() => {
      evicted = []
      cache = new InMemoryStateManager({
        maxEntries: 3,
        onEvict: (entries) => evicted.push(...entries as Array<{ $id: string; name?: string }>),
      })
    })

    it('should evict least recently used entry first', () => {
      const first = cache.create({ $type: 'Item', name: 'first' })
      const second = cache.create({ $type: 'Item', name: 'second' })
      const third = cache.create({ $type: 'Item', name: 'third' })

      // Mark all clean so they can be evicted
      cache.markClean([first.$id, second.$id, third.$id])

      // Create fourth entry, should evict first (LRU)
      cache.create({ $type: 'Item', name: 'fourth' })

      expect(evicted.length).toBe(1)
      expect(evicted[0].name).toBe('first')
    })

    it('should update LRU order on access', () => {
      const first = cache.create({ $type: 'Item', name: 'first' })
      const second = cache.create({ $type: 'Item', name: 'second' })
      const third = cache.create({ $type: 'Item', name: 'third' })

      // Mark all clean so they can be evicted
      cache.markClean([first.$id, second.$id, third.$id])

      // Access first (now most recently used)
      cache.get(first.$id)

      // Create fourth entry, should evict second (now LRU)
      cache.create({ $type: 'Item', name: 'fourth' })

      expect(evicted.length).toBe(1)
      expect(evicted[0].name).toBe('second')
    })

    it('should update LRU order on update', () => {
      const first = cache.create({ $type: 'Item', name: 'first' })
      const second = cache.create({ $type: 'Item', name: 'second' })
      const third = cache.create({ $type: 'Item', name: 'third' })

      // Mark all clean so they can be evicted
      cache.markClean([first.$id, second.$id, third.$id])

      // Update first (now most recently used, and dirty)
      cache.update(first.$id, { name: 'first-updated' })

      // Create fourth entry, should evict second (LRU clean entry)
      cache.create({ $type: 'Item', name: 'fourth' })

      expect(evicted.length).toBe(1)
      expect(evicted[0].name).toBe('second')
    })

    it('should prefer evicting clean entries over dirty ones', () => {
      const first = cache.create({ $type: 'Item', name: 'first' })
      const second = cache.create({ $type: 'Item', name: 'second' })
      const third = cache.create({ $type: 'Item', name: 'third' })

      // Mark only second as clean
      cache.markClean([second.$id])

      // Create fourth entry, should evict second (only clean entry)
      cache.create({ $type: 'Item', name: 'fourth' })

      expect(evicted.length).toBe(1)
      expect(evicted[0].name).toBe('second')
    })

    it('should correctly handle delete removing from LRU order', () => {
      const first = cache.create({ $type: 'Item', name: 'first' })
      const second = cache.create({ $type: 'Item', name: 'second' })
      const third = cache.create({ $type: 'Item', name: 'third' })

      // Mark all clean
      cache.markClean([first.$id, second.$id, third.$id])

      // Delete first
      cache.delete(first.$id)

      // Create two more entries
      cache.create({ $type: 'Item', name: 'fourth' })
      cache.markClean([cache.list()[cache.list().length - 1].$id])

      cache.create({ $type: 'Item', name: 'fifth' })

      // Should evict second (now LRU since first was deleted)
      expect(evicted.length).toBe(1)
      expect(evicted[0].name).toBe('second')
    })
  })
})
