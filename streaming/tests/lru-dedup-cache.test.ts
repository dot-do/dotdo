/**
 * LRU Deduplication Cache Tests (TDD RED Phase)
 *
 * Tests for LRU eviction in the deduplication cache to prevent unbounded
 * memory growth in long-running EventStreamDO instances.
 *
 * Problem: Current deduplicationCache uses Map<string, Map<string, number>>
 * with only TTL-based cleanup. If many events arrive within the dedup window,
 * memory grows unbounded.
 *
 * Solution: Implement LRU eviction when cache exceeds configurable max size.
 *
 * @issue do-eox3 - RED: LRU deduplication cache tests
 * @wave Wave 2: Code Consolidation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// RED: These imports will fail until we implement LRU deduplication cache
// Expected module: streaming/event-stream/dedup-cache.ts or similar
import {
  LRUDedupCache,
  type DedupCacheConfig,
  type DedupCacheStats,
} from '../event-stream/dedup-cache'

describe('LRUDedupCache', () => {
  describe('Basic Operations', () => {
    it('should check and track event IDs', () => {
      const cache = new LRUDedupCache()

      // First time seeing this event - not a duplicate
      expect(cache.isDuplicate('orders', 'event-1')).toBe(false)

      // Now it's tracked - should be duplicate
      expect(cache.isDuplicate('orders', 'event-1')).toBe(true)
    })

    it('should track events per topic', () => {
      const cache = new LRUDedupCache()

      cache.isDuplicate('orders', 'event-1')

      // Same event ID, different topic - not a duplicate
      expect(cache.isDuplicate('payments', 'event-1')).toBe(false)

      // Same topic, same event - duplicate
      expect(cache.isDuplicate('orders', 'event-1')).toBe(true)
    })

    it('should expose current cache size', () => {
      const cache = new LRUDedupCache()

      cache.isDuplicate('orders', 'event-1')
      cache.isDuplicate('orders', 'event-2')
      cache.isDuplicate('payments', 'event-3')

      expect(cache.size).toBe(3)
    })

    it('should clear all entries', () => {
      const cache = new LRUDedupCache()

      cache.isDuplicate('orders', 'event-1')
      cache.isDuplicate('orders', 'event-2')
      cache.clear()

      expect(cache.size).toBe(0)
      expect(cache.isDuplicate('orders', 'event-1')).toBe(false)
    })
  })

  describe('LRU Eviction', () => {
    it('should evict oldest entry when max size is exceeded', () => {
      const cache = new LRUDedupCache({ maxSize: 3 })

      cache.isDuplicate('orders', 'event-1') // Oldest
      cache.isDuplicate('orders', 'event-2')
      cache.isDuplicate('orders', 'event-3')
      cache.isDuplicate('orders', 'event-4') // Should evict event-1

      expect(cache.size).toBe(3)
      // event-1 should have been evicted - use has() to check without adding
      expect(cache.has('orders', 'event-1')).toBe(false)
      // Others should still be tracked
      expect(cache.has('orders', 'event-2')).toBe(true)
      expect(cache.has('orders', 'event-3')).toBe(true)
      expect(cache.has('orders', 'event-4')).toBe(true)
    })

    it('should evict least recently USED entry, not just oldest', () => {
      const cache = new LRUDedupCache({ maxSize: 3 })

      cache.isDuplicate('orders', 'event-1')
      cache.isDuplicate('orders', 'event-2')
      cache.isDuplicate('orders', 'event-3')

      // Access event-1 again, making it most recently used
      cache.isDuplicate('orders', 'event-1')

      // Add new entry - should evict event-2 (LRU)
      cache.isDuplicate('orders', 'event-4')

      expect(cache.size).toBe(3)
      expect(cache.has('orders', 'event-1')).toBe(true) // Recently accessed
      expect(cache.has('orders', 'event-2')).toBe(false) // Evicted
      expect(cache.has('orders', 'event-3')).toBe(true)
      expect(cache.has('orders', 'event-4')).toBe(true)
    })

    it('should update LRU order on each access', () => {
      const cache = new LRUDedupCache({ maxSize: 3 })

      cache.isDuplicate('orders', 'event-1')
      cache.isDuplicate('orders', 'event-2')
      cache.isDuplicate('orders', 'event-3')

      // Access in specific order: 1, 2
      cache.isDuplicate('orders', 'event-1')
      cache.isDuplicate('orders', 'event-2')

      // Now LRU order is: event-3 (LRU), event-1, event-2 (MRU)
      cache.isDuplicate('orders', 'event-4') // Should evict event-3

      expect(cache.has('orders', 'event-3')).toBe(false) // Evicted
      expect(cache.has('orders', 'event-1')).toBe(true)
      expect(cache.has('orders', 'event-2')).toBe(true)
    })

    it('should evict multiple entries if needed to fit new entry', () => {
      const cache = new LRUDedupCache({ maxSize: 5 })

      // Add 5 entries
      for (let i = 1; i <= 5; i++) {
        cache.isDuplicate('orders', `event-${i}`)
      }

      expect(cache.size).toBe(5)

      // Resize to 2, should evict 3 oldest entries
      cache.resize(2)

      expect(cache.size).toBe(2)
      // Only the 2 most recent should remain
      expect(cache.isDuplicate('orders', 'event-4')).toBe(true)
      expect(cache.isDuplicate('orders', 'event-5')).toBe(true)
      // Older ones evicted
      expect(cache.isDuplicate('orders', 'event-1')).toBe(false)
      expect(cache.isDuplicate('orders', 'event-2')).toBe(false)
      expect(cache.isDuplicate('orders', 'event-3')).toBe(false)
    })

    it('should handle cross-topic LRU eviction correctly', () => {
      // Total cache size is shared across topics
      const cache = new LRUDedupCache({ maxSize: 3 })

      cache.isDuplicate('orders', 'event-1') // Oldest
      cache.isDuplicate('payments', 'event-2')
      cache.isDuplicate('inventory', 'event-3')
      cache.isDuplicate('shipping', 'event-4') // Should evict orders/event-1

      expect(cache.size).toBe(3)
      expect(cache.has('orders', 'event-1')).toBe(false) // Evicted
      expect(cache.has('payments', 'event-2')).toBe(true)
    })
  })

  describe('TTL Expiration', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should expire entries after TTL window', () => {
      const cache = new LRUDedupCache({ ttlMs: 1000 }) // 1 second TTL

      cache.isDuplicate('orders', 'event-1')
      expect(cache.isDuplicate('orders', 'event-1')).toBe(true)

      // Advance time past TTL
      vi.advanceTimersByTime(1001)

      // Entry expired, no longer a duplicate
      expect(cache.isDuplicate('orders', 'event-1')).toBe(false)
    })

    it('should not expire entries before TTL', () => {
      const cache = new LRUDedupCache({ ttlMs: 1000 })

      cache.isDuplicate('orders', 'event-1')

      vi.advanceTimersByTime(500) // Half the TTL

      expect(cache.isDuplicate('orders', 'event-1')).toBe(true)
    })

    it('should combine TTL and LRU eviction', () => {
      const cache = new LRUDedupCache({ maxSize: 3, ttlMs: 1000 })

      cache.isDuplicate('orders', 'event-1')
      cache.isDuplicate('orders', 'event-2')

      vi.advanceTimersByTime(600)

      cache.isDuplicate('orders', 'event-3')
      cache.isDuplicate('orders', 'event-4') // Should evict event-1 (LRU)

      expect(cache.size).toBe(3)

      vi.advanceTimersByTime(500) // Total 1100ms - event-2 expired

      // After pruning, event-2 should be expired
      cache.prune() // Explicit prune or automatic on next access
      expect(cache.isDuplicate('orders', 'event-2')).toBe(false) // Expired
    })

    it('should refresh TTL on access', () => {
      const cache = new LRUDedupCache({ ttlMs: 1000 })

      cache.isDuplicate('orders', 'event-1')

      vi.advanceTimersByTime(800)

      // Access again, should refresh TTL
      cache.isDuplicate('orders', 'event-1')

      vi.advanceTimersByTime(800) // Total 1600ms from start, but only 800ms from last access

      // Entry should still be valid (TTL refreshed on access)
      expect(cache.isDuplicate('orders', 'event-1')).toBe(true)
    })
  })

  describe('Configuration', () => {
    it('should use default max size of 10000', () => {
      const cache = new LRUDedupCache()

      // Add more than default max
      for (let i = 0; i < 15000; i++) {
        cache.isDuplicate('orders', `event-${i}`)
      }

      expect(cache.size).toBe(10000)
    })

    it('should use default TTL of 60 seconds', () => {
      vi.useFakeTimers()
      const cache = new LRUDedupCache()

      cache.isDuplicate('orders', 'event-1')

      vi.advanceTimersByTime(59000) // 59 seconds
      expect(cache.has('orders', 'event-1')).toBe(true) // Use has() to check without refreshing TTL

      vi.advanceTimersByTime(2000) // 61 seconds total
      expect(cache.has('orders', 'event-1')).toBe(false) // Expired

      vi.useRealTimers()
    })

    it('should allow custom configuration', () => {
      const cache = new LRUDedupCache({
        maxSize: 500,
        ttlMs: 30000, // 30 seconds
      })

      for (let i = 0; i < 1000; i++) {
        cache.isDuplicate('orders', `event-${i}`)
      }

      expect(cache.size).toBe(500)
    })

    it('should allow dynamic resize', () => {
      const cache = new LRUDedupCache({ maxSize: 100 })

      for (let i = 0; i < 100; i++) {
        cache.isDuplicate('orders', `event-${i}`)
      }

      expect(cache.size).toBe(100)

      // Reduce size
      cache.resize(50)
      expect(cache.size).toBe(50)

      // Increase size (should not add entries, just allow more)
      cache.resize(200)
      expect(cache.size).toBe(50) // Still 50, no new entries added
    })
  })

  describe('Statistics', () => {
    it('should track duplicate count', () => {
      const cache = new LRUDedupCache()

      cache.isDuplicate('orders', 'event-1') // New
      cache.isDuplicate('orders', 'event-1') // Duplicate
      cache.isDuplicate('orders', 'event-1') // Duplicate
      cache.isDuplicate('orders', 'event-2') // New

      const stats = cache.getStats()
      expect(stats.duplicateCount).toBe(2)
    })

    it('should track unique count', () => {
      const cache = new LRUDedupCache()

      cache.isDuplicate('orders', 'event-1') // New
      cache.isDuplicate('orders', 'event-1') // Duplicate
      cache.isDuplicate('orders', 'event-2') // New
      cache.isDuplicate('orders', 'event-3') // New

      const stats = cache.getStats()
      expect(stats.uniqueCount).toBe(3)
    })

    it('should track eviction count', () => {
      const cache = new LRUDedupCache({ maxSize: 2 })

      cache.isDuplicate('orders', 'event-1')
      cache.isDuplicate('orders', 'event-2')
      cache.isDuplicate('orders', 'event-3') // Evicts event-1
      cache.isDuplicate('orders', 'event-4') // Evicts event-2

      const stats = cache.getStats()
      expect(stats.evictionCount).toBe(2)
    })

    it('should track current size in stats', () => {
      const cache = new LRUDedupCache()

      cache.isDuplicate('orders', 'event-1')
      cache.isDuplicate('orders', 'event-2')

      const stats = cache.getStats()
      expect(stats.currentSize).toBe(2)
    })

    it('should reset stats without clearing data', () => {
      const cache = new LRUDedupCache()

      cache.isDuplicate('orders', 'event-1')
      cache.isDuplicate('orders', 'event-1') // Duplicate

      cache.resetStats()

      const stats = cache.getStats()
      expect(stats.duplicateCount).toBe(0)
      expect(stats.uniqueCount).toBe(0)
      expect(stats.evictionCount).toBe(0)
      // But data is still there
      expect(cache.isDuplicate('orders', 'event-1')).toBe(true)
    })
  })

  describe('Memory Bounds (No OOM)', () => {
    it('should not grow beyond max size under continuous load', () => {
      const cache = new LRUDedupCache({ maxSize: 100 })

      // Simulate high-throughput event stream
      for (let i = 0; i < 100000; i++) {
        cache.isDuplicate('orders', `event-${i}`)
      }

      expect(cache.size).toBe(100)
    })

    it('should handle hot path with frequent accesses efficiently', () => {
      const cache = new LRUDedupCache({ maxSize: 50 })

      // Simulate real workload: some events accessed frequently
      for (let round = 0; round < 1000; round++) {
        // Hot events (frequently accessed)
        cache.isDuplicate('orders', 'hot-event-1')
        cache.isDuplicate('orders', 'hot-event-2')
        cache.isDuplicate('orders', 'hot-event-3')

        // Cold events (new each time)
        cache.isDuplicate('orders', `cold-event-${round}`)
      }

      expect(cache.size).toBeLessThanOrEqual(50)

      // Hot events should still be in cache
      expect(cache.isDuplicate('orders', 'hot-event-1')).toBe(true)
      expect(cache.isDuplicate('orders', 'hot-event-2')).toBe(true)
      expect(cache.isDuplicate('orders', 'hot-event-3')).toBe(true)
    })

    it('should handle many topics without memory leak', () => {
      const cache = new LRUDedupCache({ maxSize: 1000 })

      // Many topics with many events
      for (let topic = 0; topic < 100; topic++) {
        for (let event = 0; event < 100; event++) {
          cache.isDuplicate(`topic-${topic}`, `event-${event}`)
        }
      }

      // 100 topics * 100 events = 10000 total, but max is 1000
      expect(cache.size).toBe(1000)
    })
  })

  describe('Edge Cases', () => {
    it('should handle max size of 1', () => {
      const cache = new LRUDedupCache({ maxSize: 1 })

      cache.isDuplicate('orders', 'event-1')
      cache.isDuplicate('orders', 'event-2')

      expect(cache.size).toBe(1)
      expect(cache.has('orders', 'event-1')).toBe(false) // Evicted
      expect(cache.has('orders', 'event-2')).toBe(true) // Still in cache
    })

    it('should handle empty event IDs', () => {
      const cache = new LRUDedupCache()

      cache.isDuplicate('orders', '')

      expect(cache.isDuplicate('orders', '')).toBe(true)
    })

    it('should handle empty topic names', () => {
      const cache = new LRUDedupCache()

      cache.isDuplicate('', 'event-1')

      expect(cache.isDuplicate('', 'event-1')).toBe(true)
    })

    it('should handle rapid duplicate checks efficiently', () => {
      const cache = new LRUDedupCache({ maxSize: 10 })

      // Rapid fire same event
      for (let i = 0; i < 10000; i++) {
        cache.isDuplicate('orders', 'same-event')
      }

      expect(cache.size).toBe(1)

      const stats = cache.getStats()
      expect(stats.uniqueCount).toBe(1)
      expect(stats.duplicateCount).toBe(9999)
    })

    it('should work with special characters in topic/event IDs', () => {
      const cache = new LRUDedupCache()

      cache.isDuplicate('orders.*.created', 'event:123:abc')
      cache.isDuplicate('topic/with/slashes', 'id-with-dashes')
      cache.isDuplicate('topic with spaces', 'id with spaces')

      expect(cache.size).toBe(3)
    })
  })

  describe('Eviction Callback', () => {
    it('should call onEvict when entry is evicted due to LRU', () => {
      const evicted: Array<{ topic: string; eventId: string }> = []
      const cache = new LRUDedupCache({
        maxSize: 2,
        onEvict: (topic, eventId) => {
          evicted.push({ topic, eventId })
        },
      })

      cache.isDuplicate('orders', 'event-1')
      cache.isDuplicate('orders', 'event-2')
      cache.isDuplicate('orders', 'event-3') // Evicts event-1

      expect(evicted).toHaveLength(1)
      expect(evicted[0]).toEqual({ topic: 'orders', eventId: 'event-1' })
    })

    it('should call onEvict when entry expires due to TTL', () => {
      vi.useFakeTimers()

      const evicted: Array<{ topic: string; eventId: string }> = []
      const cache = new LRUDedupCache({
        ttlMs: 1000,
        onEvict: (topic, eventId) => {
          evicted.push({ topic, eventId })
        },
      })

      cache.isDuplicate('orders', 'event-1')

      vi.advanceTimersByTime(1001)
      cache.prune() // Trigger cleanup

      expect(evicted).toHaveLength(1)
      expect(evicted[0]).toEqual({ topic: 'orders', eventId: 'event-1' })

      vi.useRealTimers()
    })

    it('should call onEvict for all entries on clear', () => {
      const evicted: string[] = []
      const cache = new LRUDedupCache({
        onEvict: (_, eventId) => {
          evicted.push(eventId)
        },
      })

      cache.isDuplicate('orders', 'event-1')
      cache.isDuplicate('orders', 'event-2')
      cache.isDuplicate('orders', 'event-3')
      cache.clear()

      expect(evicted).toHaveLength(3)
    })
  })

  describe('Integration with EventStreamDO Pattern', () => {
    it('should support topic-scoped iteration for cleanup', () => {
      const cache = new LRUDedupCache()

      cache.isDuplicate('orders', 'event-1')
      cache.isDuplicate('orders', 'event-2')
      cache.isDuplicate('payments', 'event-3')

      // Should be able to get entries by topic (useful for topic cleanup)
      const orderEntries = cache.getEntriesByTopic('orders')
      expect(orderEntries).toHaveLength(2)
    })

    it('should support clearing entries for a specific topic', () => {
      const cache = new LRUDedupCache()

      cache.isDuplicate('orders', 'event-1')
      cache.isDuplicate('orders', 'event-2')
      cache.isDuplicate('payments', 'event-3')

      cache.clearTopic('orders')

      expect(cache.isDuplicate('orders', 'event-1')).toBe(false)
      expect(cache.isDuplicate('orders', 'event-2')).toBe(false)
      expect(cache.isDuplicate('payments', 'event-3')).toBe(true)
    })

    it('should maintain per-topic stats', () => {
      const cache = new LRUDedupCache()

      cache.isDuplicate('orders', 'event-1')
      cache.isDuplicate('orders', 'event-2')
      cache.isDuplicate('orders', 'event-1') // Duplicate
      cache.isDuplicate('payments', 'event-3')

      const stats = cache.getStats()
      // Per-topic counts if supported
      expect(stats.topicCount).toBe(2)
    })
  })
})
