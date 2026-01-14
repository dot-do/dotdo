import { describe, it, expect, beforeEach } from 'vitest'
import {
  InMemoryRefCountStorage,
  calculateStats,
  createMetrics,
  type RefCountStorage,
  type DeduplicationStats,
  type RefCountMetrics,
} from './refcount'

describe('InMemoryRefCountStorage', () => {
  let storage: InMemoryRefCountStorage

  beforeEach(() => {
    storage = new InMemoryRefCountStorage()
  })

  describe('getRefCount', () => {
    it('should return 0 for non-existent hash', async () => {
      const count = await storage.getRefCount('abc123')
      expect(count).toBe(0)
    })

    it('should return correct count after setRefCount', async () => {
      await storage.setRefCount('abc123', 5)
      const count = await storage.getRefCount('abc123')
      expect(count).toBe(5)
    })

    it('should normalize hash to lowercase', async () => {
      await storage.setRefCount('ABC123', 3)
      const count = await storage.getRefCount('abc123')
      expect(count).toBe(3)
    })
  })

  describe('setRefCount', () => {
    it('should set refcount', async () => {
      await storage.setRefCount('hash1', 10)
      expect(await storage.getRefCount('hash1')).toBe(10)
    })

    it('should delete entry when setting to 0', async () => {
      await storage.setRefCount('hash1', 5)
      await storage.setRefCount('hash1', 0)
      expect(await storage.getRefCount('hash1')).toBe(0)
    })

    it('should delete entry when setting to negative', async () => {
      await storage.setRefCount('hash1', 5)
      await storage.setRefCount('hash1', -1)
      expect(await storage.getRefCount('hash1')).toBe(0)
    })
  })

  describe('incrementRefCount', () => {
    it('should increment from 0 to 1', async () => {
      const newCount = await storage.incrementRefCount('hash1')
      expect(newCount).toBe(1)
      expect(await storage.getRefCount('hash1')).toBe(1)
    })

    it('should increment existing count', async () => {
      await storage.setRefCount('hash1', 5)
      const newCount = await storage.incrementRefCount('hash1')
      expect(newCount).toBe(6)
    })

    it('should return the new count', async () => {
      await storage.incrementRefCount('hash1')
      await storage.incrementRefCount('hash1')
      const newCount = await storage.incrementRefCount('hash1')
      expect(newCount).toBe(3)
    })
  })

  describe('decrementRefCount', () => {
    it('should decrement count', async () => {
      await storage.setRefCount('hash1', 5)
      const newCount = await storage.decrementRefCount('hash1')
      expect(newCount).toBe(4)
    })

    it('should not go below 0', async () => {
      await storage.setRefCount('hash1', 1)
      await storage.decrementRefCount('hash1')
      const newCount = await storage.decrementRefCount('hash1')
      expect(newCount).toBe(0)
    })

    it('should delete entry when reaching 0', async () => {
      await storage.setRefCount('hash1', 1)
      await storage.decrementRefCount('hash1')

      // getAllRefCounts should not include this hash
      const all = await storage.getAllRefCounts()
      expect(all.has('hash1')).toBe(false)
    })

    it('should handle decrement on non-existent hash', async () => {
      const newCount = await storage.decrementRefCount('nonexistent')
      expect(newCount).toBe(0)
    })
  })

  describe('deleteRefCount', () => {
    it('should delete refcount entry', async () => {
      await storage.setRefCount('hash1', 5)
      await storage.setSize('hash1', 100)

      await storage.deleteRefCount('hash1')

      expect(await storage.getRefCount('hash1')).toBe(0)
      expect(await storage.getSize('hash1')).toBe(0)
    })

    it('should handle deleting non-existent entry', async () => {
      // Should not throw
      await storage.deleteRefCount('nonexistent')
    })
  })

  describe('setSize / getSize', () => {
    it('should store and retrieve size', async () => {
      await storage.setSize('hash1', 1024)
      expect(await storage.getSize('hash1')).toBe(1024)
    })

    it('should return 0 for non-existent hash', async () => {
      expect(await storage.getSize('nonexistent')).toBe(0)
    })

    it('should normalize hash to lowercase', async () => {
      await storage.setSize('ABC123', 500)
      expect(await storage.getSize('abc123')).toBe(500)
    })
  })

  describe('getAllRefCounts', () => {
    it('should return empty map for empty storage', async () => {
      const all = await storage.getAllRefCounts()
      expect(all.size).toBe(0)
    })

    it('should return all entries with refcount and size', async () => {
      await storage.setRefCount('hash1', 3)
      await storage.setSize('hash1', 100)
      await storage.setRefCount('hash2', 1)
      await storage.setSize('hash2', 200)

      const all = await storage.getAllRefCounts()

      expect(all.size).toBe(2)
      expect(all.get('hash1')).toEqual({ refCount: 3, size: 100 })
      expect(all.get('hash2')).toEqual({ refCount: 1, size: 200 })
    })

    it('should return 0 size for entries without size set', async () => {
      await storage.setRefCount('hash1', 2)

      const all = await storage.getAllRefCounts()

      expect(all.get('hash1')).toEqual({ refCount: 2, size: 0 })
    })
  })

  describe('clear', () => {
    it('should clear all data', async () => {
      await storage.setRefCount('hash1', 5)
      await storage.setSize('hash1', 100)
      await storage.setRefCount('hash2', 3)

      storage.clear()

      expect(await storage.getRefCount('hash1')).toBe(0)
      expect(await storage.getSize('hash1')).toBe(0)
      expect((await storage.getAllRefCounts()).size).toBe(0)
    })
  })
})

describe('calculateStats', () => {
  it('should return zeros for empty map', () => {
    const stats = calculateStats(new Map())

    expect(stats.totalObjects).toBe(0)
    expect(stats.totalReferences).toBe(0)
    expect(stats.deduplicatedBytes).toBe(0)
    expect(stats.averageRefCount).toBe(0)
  })

  it('should count total objects', () => {
    const refCounts = new Map([
      ['hash1', { refCount: 1, size: 100 }],
      ['hash2', { refCount: 1, size: 200 }],
      ['hash3', { refCount: 1, size: 300 }],
    ])

    const stats = calculateStats(refCounts)

    expect(stats.totalObjects).toBe(3)
  })

  it('should count total references', () => {
    const refCounts = new Map([
      ['hash1', { refCount: 3, size: 100 }],
      ['hash2', { refCount: 2, size: 200 }],
      ['hash3', { refCount: 1, size: 300 }],
    ])

    const stats = calculateStats(refCounts)

    expect(stats.totalReferences).toBe(6) // 3 + 2 + 1
  })

  it('should calculate deduplicated bytes', () => {
    const refCounts = new Map([
      ['hash1', { refCount: 3, size: 100 }], // saves (3-1) * 100 = 200
      ['hash2', { refCount: 2, size: 200 }], // saves (2-1) * 200 = 200
      ['hash3', { refCount: 1, size: 300 }], // saves 0 (only 1 ref)
    ])

    const stats = calculateStats(refCounts)

    expect(stats.deduplicatedBytes).toBe(400) // 200 + 200
  })

  it('should calculate average refcount', () => {
    const refCounts = new Map([
      ['hash1', { refCount: 4, size: 100 }],
      ['hash2', { refCount: 2, size: 200 }],
    ])

    const stats = calculateStats(refCounts)

    expect(stats.averageRefCount).toBe(3) // (4 + 2) / 2
  })

  it('should handle single object with multiple refs', () => {
    const refCounts = new Map([['hash1', { refCount: 5, size: 1000 }]])

    const stats = calculateStats(refCounts)

    expect(stats.totalObjects).toBe(1)
    expect(stats.totalReferences).toBe(5)
    expect(stats.deduplicatedBytes).toBe(4000) // (5-1) * 1000
    expect(stats.averageRefCount).toBe(5)
  })
})

/**
 * Race condition tests for CAS reference counting
 *
 * These tests expose TOCTOU (Time-Of-Check-Time-Of-Use) race conditions
 * in the reference counting implementation. The race occurs because:
 *
 * 1. incrementRefCount reads current value
 * 2. incrementRefCount calculates new value
 * 3. incrementRefCount writes new value
 *
 * If two operations interleave, updates can be lost.
 */
describe('Race Condition Prevention', () => {
  let storage: InMemoryRefCountStorage

  beforeEach(() => {
    storage = new InMemoryRefCountStorage()
  })

  describe('Concurrent Increment Operations', () => {
    it('should handle 100 concurrent increments atomically', async () => {
      // Start with refcount 0
      const hash = 'concurrent-inc-test'
      const numOperations = 100

      // Run all increments concurrently
      const promises = Array.from({ length: numOperations }, () =>
        storage.incrementRefCount(hash)
      )

      await Promise.all(promises)

      // Final count MUST be exactly 100
      // Race condition would cause lost updates (count < 100)
      const finalCount = await storage.getRefCount(hash)
      expect(finalCount).toBe(numOperations)
    })

    it('should handle 100 concurrent decrements atomically', async () => {
      const hash = 'concurrent-dec-test'
      const numOperations = 100

      // Start with refcount 100
      await storage.setRefCount(hash, numOperations)

      // Run all decrements concurrently
      const promises = Array.from({ length: numOperations }, () =>
        storage.decrementRefCount(hash)
      )

      await Promise.all(promises)

      // Final count MUST be exactly 0
      // Race condition would cause count > 0 or negative
      const finalCount = await storage.getRefCount(hash)
      expect(finalCount).toBe(0)
    })

    it('should handle mixed concurrent inc/dec operations', async () => {
      const hash = 'mixed-ops-test'
      const numIncrements = 50
      const numDecrements = 30

      // Start with refcount 0
      // Expected final: 50 - 30 = 20

      const incPromises = Array.from({ length: numIncrements }, () =>
        storage.incrementRefCount(hash)
      )
      const decPromises = Array.from({ length: numDecrements }, () =>
        storage.decrementRefCount(hash)
      )

      await Promise.all([...incPromises, ...decPromises])

      const finalCount = await storage.getRefCount(hash)
      expect(finalCount).toBe(numIncrements - numDecrements)
    })
  })

  describe('Atomic Compare-And-Swap Semantics', () => {
    it('should support atomic compareAndSwap operation', async () => {
      const hash = 'cas-test'
      await storage.setRefCount(hash, 5)

      // Try CAS: if current is 5, set to 10
      const result = await storage.compareAndSwapRefCount(hash, 5, 10)

      expect(result).toBe(true)
      expect(await storage.getRefCount(hash)).toBe(10)
    })

    it('should reject CAS when expected value does not match', async () => {
      const hash = 'cas-reject-test'
      await storage.setRefCount(hash, 5)

      // Try CAS: if current is 3, set to 10 (should fail)
      const result = await storage.compareAndSwapRefCount(hash, 3, 10)

      expect(result).toBe(false)
      // Value should remain unchanged
      expect(await storage.getRefCount(hash)).toBe(5)
    })

    it('should handle CAS race between concurrent operations', async () => {
      const hash = 'cas-race-test'
      await storage.setRefCount(hash, 1)

      // Both try to decrement from 1 to 0
      // Only ONE should succeed with CAS
      const [result1, result2] = await Promise.all([
        storage.compareAndSwapRefCount(hash, 1, 0),
        storage.compareAndSwapRefCount(hash, 1, 0),
      ])

      // Exactly one should succeed
      const successes = [result1, result2].filter(Boolean).length
      expect(successes).toBe(1)

      // Final count should be 0
      expect(await storage.getRefCount(hash)).toBe(0)
    })
  })

  describe('GC Race Prevention', () => {
    it('should signal GC exactly once when refcount reaches zero atomically', async () => {
      const hash = 'gc-atomic-test'
      await storage.setRefCount(hash, 2)

      const gcSignals: string[] = []

      // Two decrements: 2 -> 1 -> 0
      // Only the second should signal GC
      await storage.decrementRefCountWithGCSignal(hash, (h) => {
        gcSignals.push(h)
      })
      expect(gcSignals).toHaveLength(0) // First decrement: 2->1, no GC

      await storage.decrementRefCountWithGCSignal(hash, (h) => {
        gcSignals.push(h)
      })
      expect(gcSignals).toHaveLength(1) // Second decrement: 1->0, GC signaled
      expect(gcSignals[0]).toBe(hash)
    })

    it('should not signal GC if already at zero', async () => {
      const hash = 'gc-already-zero-test'
      // Start at 0 (no entry)

      const gcSignals: string[] = []

      // Decrement on non-existent entry
      await storage.decrementRefCountWithGCSignal(hash, (h) => {
        gcSignals.push(h)
      })

      // Should NOT signal GC because we didn't transition from positive to zero
      expect(gcSignals).toHaveLength(0)
    })

    it('should only signal GC when refcount truly reaches zero', async () => {
      const hash = 'gc-true-zero-test'
      await storage.setRefCount(hash, 1)

      const gcSignals: string[] = []

      // Single decrement from 1 to 0
      await storage.decrementRefCountWithGCSignal(hash, (h) => {
        gcSignals.push(h)
      })

      const finalCount = await storage.getRefCount(hash)

      // If count is 0, GC should be signaled exactly once
      if (finalCount === 0) {
        expect(gcSignals).toHaveLength(1)
        expect(gcSignals[0]).toBe(hash)
      }
    })

    it('should handle increment after decrement-to-zero correctly', async () => {
      const hash = 'gc-reincrement-test'
      await storage.setRefCount(hash, 1)

      const gcSignals: string[] = []

      // Decrement to 0 (GC signaled)
      await storage.decrementRefCountWithGCSignal(hash, (h) => {
        gcSignals.push(h)
      })
      expect(gcSignals).toHaveLength(1)

      // Now increment (new reference added after GC was scheduled)
      await storage.incrementRefCount(hash)

      // Refcount should be 1 (new reference)
      expect(await storage.getRefCount(hash)).toBe(1)

      // GC handler is responsible for checking if object still has 0 refs
      // before actually deleting - this is the proper pattern
    })
  })

  describe('Stress Test', () => {
    it('should maintain consistency under heavy concurrent load', async () => {
      const numHashes = 10
      const opsPerHash = 100
      const hashes = Array.from({ length: numHashes }, (_, i) => `stress-hash-${i}`)

      // Initialize all hashes with count 50
      const initialCount = 50
      await Promise.all(hashes.map((h) => storage.setRefCount(h, initialCount)))

      // Generate random inc/dec operations for each hash
      const operations: Promise<number>[] = []
      const expectedDeltas = new Map<string, number>()

      for (const hash of hashes) {
        let delta = 0
        for (let i = 0; i < opsPerHash; i++) {
          const isIncrement = Math.random() > 0.5
          if (isIncrement) {
            operations.push(storage.incrementRefCount(hash))
            delta++
          } else {
            operations.push(storage.decrementRefCount(hash))
            delta--
          }
        }
        expectedDeltas.set(hash, delta)
      }

      await Promise.all(operations)

      // Verify each hash has the correct final count
      for (const hash of hashes) {
        const expected = Math.max(0, initialCount + expectedDeltas.get(hash)!)
        const actual = await storage.getRefCount(hash)
        expect(actual).toBe(expected)
      }
    })
  })

  describe('Concurrent Delete Prevention', () => {
    it('should prevent double-deletion with concurrent decrements', async () => {
      const hash = 'double-delete-test'
      await storage.setRefCount(hash, 1)
      await storage.setSize(hash, 1000)

      let deleteAttempts = 0

      // Two concurrent decrements, both trying to delete
      const dec1 = storage.decrementRefCountWithGCSignal(hash, () => {
        deleteAttempts++
      })
      const dec2 = storage.decrementRefCountWithGCSignal(hash, () => {
        deleteAttempts++
      })

      await Promise.all([dec1, dec2])

      // Only ONE delete should be triggered
      expect(deleteAttempts).toBe(1)
      expect(await storage.getRefCount(hash)).toBe(0)
    })
  })
})

describe('Metrics and Observability', () => {
  let storage: InMemoryRefCountStorage

  beforeEach(() => {
    storage = new InMemoryRefCountStorage()
  })

  describe('createMetrics', () => {
    it('should create metrics with all zeros', () => {
      const metrics = createMetrics()
      expect(metrics.incrementCount).toBe(0)
      expect(metrics.decrementCount).toBe(0)
      expect(metrics.casCount).toBe(0)
      expect(metrics.casFailures).toBe(0)
      expect(metrics.contentionCount).toBe(0)
      expect(metrics.totalLockWaitTimeMs).toBe(0)
      expect(metrics.gcSignalCount).toBe(0)
      expect(metrics.batchOperationCount).toBe(0)
    })
  })

  describe('getMetrics', () => {
    it('should track increment operations', async () => {
      await storage.incrementRefCount('hash1')
      await storage.incrementRefCount('hash1')
      await storage.incrementRefCount('hash2')

      const metrics = storage.getMetrics()
      expect(metrics.incrementCount).toBe(3)
    })

    it('should track decrement operations', async () => {
      await storage.setRefCount('hash1', 5)
      await storage.decrementRefCount('hash1')
      await storage.decrementRefCount('hash1')

      const metrics = storage.getMetrics()
      expect(metrics.decrementCount).toBe(2)
    })

    it('should track CAS operations and failures', async () => {
      await storage.setRefCount('hash1', 5)

      // Successful CAS
      await storage.compareAndSwapRefCount('hash1', 5, 10)
      // Failed CAS
      await storage.compareAndSwapRefCount('hash1', 5, 15)

      const metrics = storage.getMetrics()
      expect(metrics.casCount).toBe(2)
      expect(metrics.casFailures).toBe(1)
    })

    it('should track GC signals', async () => {
      await storage.setRefCount('hash1', 2)
      await storage.decrementRefCountWithGCSignal('hash1', () => {})
      await storage.decrementRefCountWithGCSignal('hash1', () => {})

      const metrics = storage.getMetrics()
      expect(metrics.gcSignalCount).toBe(1) // Only one reached zero
    })

    it('should return a copy of metrics', async () => {
      await storage.incrementRefCount('hash1')
      const metrics1 = storage.getMetrics()
      await storage.incrementRefCount('hash1')
      const metrics2 = storage.getMetrics()

      expect(metrics1.incrementCount).toBe(1)
      expect(metrics2.incrementCount).toBe(2)
    })
  })

  describe('resetMetrics', () => {
    it('should reset all metrics to zero', async () => {
      await storage.incrementRefCount('hash1')
      await storage.decrementRefCount('hash1')

      storage.resetMetrics()

      const metrics = storage.getMetrics()
      expect(metrics.incrementCount).toBe(0)
      expect(metrics.decrementCount).toBe(0)
    })
  })
})

describe('Batch Operations', () => {
  let storage: InMemoryRefCountStorage

  beforeEach(() => {
    storage = new InMemoryRefCountStorage()
  })

  describe('batchIncrementRefCount', () => {
    it('should increment multiple hashes', async () => {
      const hashes = ['hash1', 'hash2', 'hash3']
      const results = await storage.batchIncrementRefCount(hashes)

      expect(results.get('hash1')).toBe(1)
      expect(results.get('hash2')).toBe(1)
      expect(results.get('hash3')).toBe(1)
    })

    it('should increment existing refcounts', async () => {
      await storage.setRefCount('hash1', 5)
      await storage.setRefCount('hash2', 3)

      const results = await storage.batchIncrementRefCount(['hash1', 'hash2', 'hash3'])

      expect(results.get('hash1')).toBe(6)
      expect(results.get('hash2')).toBe(4)
      expect(results.get('hash3')).toBe(1)
    })

    it('should handle duplicate hashes in batch', async () => {
      const results = await storage.batchIncrementRefCount(['hash1', 'hash1', 'hash1'])

      // All three increments should be applied
      expect(await storage.getRefCount('hash1')).toBe(3)
    })

    it('should track batch operation in metrics', async () => {
      await storage.batchIncrementRefCount(['hash1', 'hash2'])

      const metrics = storage.getMetrics()
      expect(metrics.batchOperationCount).toBe(1)
      expect(metrics.incrementCount).toBe(2)
    })
  })

  describe('batchDecrementRefCount', () => {
    it('should decrement multiple hashes', async () => {
      await storage.setRefCount('hash1', 5)
      await storage.setRefCount('hash2', 3)
      await storage.setRefCount('hash3', 1)

      const { results } = await storage.batchDecrementRefCount(['hash1', 'hash2', 'hash3'])

      expect(results.get('hash1')).toBe(4)
      expect(results.get('hash2')).toBe(2)
      expect(results.get('hash3')).toBe(0)
    })

    it('should track hashes that reached zero', async () => {
      await storage.setRefCount('hash1', 1)
      await storage.setRefCount('hash2', 2)
      await storage.setRefCount('hash3', 1)

      const { results, gcHashes } = await storage.batchDecrementRefCount(
        ['hash1', 'hash2', 'hash3'],
        () => {}
      )

      expect(gcHashes).toContain('hash1')
      expect(gcHashes).toContain('hash3')
      expect(gcHashes).not.toContain('hash2')
    })

    it('should call GC callback for each zero-reaching hash', async () => {
      await storage.setRefCount('hash1', 1)
      await storage.setRefCount('hash2', 1)

      const gcCalls: string[] = []
      await storage.batchDecrementRefCount(['hash1', 'hash2'], (hash) => {
        gcCalls.push(hash)
      })

      expect(gcCalls).toHaveLength(2)
      expect(gcCalls).toContain('hash1')
      expect(gcCalls).toContain('hash2')
    })

    it('should work without GC callback', async () => {
      await storage.setRefCount('hash1', 1)
      await storage.setRefCount('hash2', 1)

      const { results, gcHashes } = await storage.batchDecrementRefCount(['hash1', 'hash2'])

      expect(results.get('hash1')).toBe(0)
      expect(results.get('hash2')).toBe(0)
      expect(gcHashes).toHaveLength(0) // No GC tracking without callback
    })

    it('should track batch operation in metrics', async () => {
      await storage.setRefCount('hash1', 5)
      await storage.batchDecrementRefCount(['hash1', 'hash1'])

      const metrics = storage.getMetrics()
      expect(metrics.batchOperationCount).toBe(1)
      expect(metrics.decrementCount).toBe(2)
    })
  })
})
