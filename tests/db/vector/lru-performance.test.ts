/**
 * LRU Cache Performance Tests - O(1) Operations Verification
 *
 * These tests verify that LRU cache operations (get, set, delete, eviction)
 * maintain O(1) time complexity regardless of cache size.
 *
 * PROBLEM: Current implementations use array.indexOf() and array.splice()
 * which are O(n) operations:
 * - db/vector/cache.ts lines 252-258: updateAccessOrder uses indexOf/splice
 * - db/vector/cache.ts lines 184-186: delete uses indexOf/splice
 * - db/edgevec/embedding-cache.ts lines 240-242: delete uses indexOf/splice
 * - db/edgevec/embedding-cache.ts lines 382-385: touch uses indexOf/splice
 *
 * SOLUTION: Use a doubly-linked list with a Map for O(1) access:
 * - Map<key, Node> for O(1) lookup
 * - Doubly-linked list for O(1) removal and insertion at ends
 *
 * @module tests/db/vector/lru-performance
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { BoundedLRUCache, binaryHashSizeCalculator } from '../../../db/vector/cache'
import { EmbeddingCache } from '../../../db/edgevec/embedding-cache'

// ============================================================================
// TEST CONSTANTS
// ============================================================================

/** Small cache size for baseline measurements */
const SMALL_CACHE_SIZE = 100

/** Large cache size to expose O(n) behavior */
const LARGE_CACHE_SIZE = 100_000

/** Number of operations to average for timing */
const TIMING_ITERATIONS = 1000

/**
 * Maximum acceptable ratio between large and small cache operation times.
 * For O(1) operations, this should be close to 1.0 (operations take same time).
 * For O(n) operations, this would be LARGE_CACHE_SIZE / SMALL_CACHE_SIZE = 1000.
 *
 * We use 5x as threshold to account for:
 * - CPU cache effects
 * - Memory allocation patterns
 * - V8 JIT compilation variance
 */
const MAX_ACCEPTABLE_TIME_RATIO = 5

/**
 * Maximum acceptable time per operation in microseconds.
 * O(1) hash-based operations should be <10us.
 * With 100k entries, O(n) indexOf would take 100+ us.
 */
const MAX_OPERATION_TIME_US = 50

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Measure average operation time in microseconds
 */
function measureOperationTime(operation: () => void, iterations: number): number {
  // Warm up
  for (let i = 0; i < 100; i++) {
    operation()
  }

  // Force GC if available
  if (global.gc) {
    global.gc()
  }

  const start = performance.now()
  for (let i = 0; i < iterations; i++) {
    operation()
  }
  const end = performance.now()

  return ((end - start) / iterations) * 1000 // Convert to microseconds
}

/**
 * Create a populated BoundedLRUCache with the specified number of entries
 */
function createPopulatedBoundedCache(size: number): BoundedLRUCache<string, Uint8Array> {
  const cache = new BoundedLRUCache<string, Uint8Array>(
    size + 1000, // Extra capacity to prevent evictions during test
    binaryHashSizeCalculator
  )

  const value = new Uint8Array(32) // 32-byte hash value
  for (let i = 0; i < size; i++) {
    cache.set(`key-${i}`, value)
  }

  return cache
}

/**
 * Create a populated EmbeddingCache with the specified number of entries
 */
function createPopulatedEmbeddingCache(size: number): EmbeddingCache {
  const cache = new EmbeddingCache({
    dimensions: 384,
    maxEntries: size + 1000, // Extra capacity to prevent evictions during test
  })

  const vector = new Float32Array(384)
  for (let i = 0; i < size; i++) {
    cache.set(`key-${i}`, vector)
  }

  return cache
}

// ============================================================================
// BOUNDEDLRUCACHE PERFORMANCE TESTS
// ============================================================================

describe('BoundedLRUCache O(1) Performance', () => {
  describe('get() operation', () => {
    it('should have O(1) time complexity - small vs large cache timing', () => {
      const smallCache = createPopulatedBoundedCache(SMALL_CACHE_SIZE)
      const largeCache = createPopulatedBoundedCache(LARGE_CACHE_SIZE)

      // Measure get time on existing keys (triggers updateAccessOrder)
      const smallTime = measureOperationTime(() => {
        const key = `key-${Math.floor(Math.random() * SMALL_CACHE_SIZE)}`
        smallCache.get(key)
      }, TIMING_ITERATIONS)

      const largeTime = measureOperationTime(() => {
        const key = `key-${Math.floor(Math.random() * LARGE_CACHE_SIZE)}`
        largeCache.get(key)
      }, TIMING_ITERATIONS)

      const timeRatio = largeTime / smallTime

      console.log(`BoundedLRUCache.get() performance:`)
      console.log(`  Small cache (${SMALL_CACHE_SIZE} entries): ${smallTime.toFixed(2)} us/op`)
      console.log(`  Large cache (${LARGE_CACHE_SIZE} entries): ${largeTime.toFixed(2)} us/op`)
      console.log(`  Time ratio: ${timeRatio.toFixed(2)}x`)

      // O(1) operations should have similar timing regardless of cache size
      expect(timeRatio).toBeLessThan(MAX_ACCEPTABLE_TIME_RATIO)
    })

    it('should complete get() in <50 microseconds with 100k entries', () => {
      const cache = createPopulatedBoundedCache(LARGE_CACHE_SIZE)

      // Access a key in the middle of the cache (worst case for O(n) indexOf)
      const midKey = `key-${Math.floor(LARGE_CACHE_SIZE / 2)}`

      const avgTime = measureOperationTime(() => {
        cache.get(midKey)
      }, TIMING_ITERATIONS)

      console.log(`BoundedLRUCache.get() with ${LARGE_CACHE_SIZE} entries: ${avgTime.toFixed(2)} us/op`)

      expect(avgTime).toBeLessThan(MAX_OPERATION_TIME_US)
    })
  })

  describe('set() operation', () => {
    it('should have O(1) time complexity - small vs large cache timing', () => {
      const smallCache = createPopulatedBoundedCache(SMALL_CACHE_SIZE)
      const largeCache = createPopulatedBoundedCache(LARGE_CACHE_SIZE)
      const value = new Uint8Array(32)

      // Measure set time for updating existing keys (triggers updateAccessOrder)
      const smallTime = measureOperationTime(() => {
        const key = `key-${Math.floor(Math.random() * SMALL_CACHE_SIZE)}`
        smallCache.set(key, value)
      }, TIMING_ITERATIONS)

      const largeTime = measureOperationTime(() => {
        const key = `key-${Math.floor(Math.random() * LARGE_CACHE_SIZE)}`
        largeCache.set(key, value)
      }, TIMING_ITERATIONS)

      const timeRatio = largeTime / smallTime

      console.log(`BoundedLRUCache.set() performance:`)
      console.log(`  Small cache (${SMALL_CACHE_SIZE} entries): ${smallTime.toFixed(2)} us/op`)
      console.log(`  Large cache (${LARGE_CACHE_SIZE} entries): ${largeTime.toFixed(2)} us/op`)
      console.log(`  Time ratio: ${timeRatio.toFixed(2)}x`)

      expect(timeRatio).toBeLessThan(MAX_ACCEPTABLE_TIME_RATIO)
    })

    it('should complete set() update in <50 microseconds with 100k entries', () => {
      const cache = createPopulatedBoundedCache(LARGE_CACHE_SIZE)
      const value = new Uint8Array(32)

      // Update a key in the middle of the cache
      const midKey = `key-${Math.floor(LARGE_CACHE_SIZE / 2)}`

      const avgTime = measureOperationTime(() => {
        cache.set(midKey, value)
      }, TIMING_ITERATIONS)

      console.log(`BoundedLRUCache.set() update with ${LARGE_CACHE_SIZE} entries: ${avgTime.toFixed(2)} us/op`)

      expect(avgTime).toBeLessThan(MAX_OPERATION_TIME_US)
    })
  })

  describe('delete() operation', () => {
    it('should have O(1) time complexity - small vs large cache timing', () => {
      // Note: We need to recreate the cache for each test to have keys to delete
      const value = new Uint8Array(32)

      // Small cache timing
      let smallCache = createPopulatedBoundedCache(SMALL_CACHE_SIZE)
      let idx = 0
      const smallTime = measureOperationTime(() => {
        const key = `key-${idx % SMALL_CACHE_SIZE}`
        smallCache.delete(key)
        smallCache.set(key, value) // Re-add to allow repeated deletion
        idx++
      }, TIMING_ITERATIONS)

      // Large cache timing
      let largeCache = createPopulatedBoundedCache(LARGE_CACHE_SIZE)
      idx = 0
      const largeTime = measureOperationTime(() => {
        const key = `key-${idx % LARGE_CACHE_SIZE}`
        largeCache.delete(key)
        largeCache.set(key, value) // Re-add to allow repeated deletion
        idx++
      }, TIMING_ITERATIONS)

      const timeRatio = largeTime / smallTime

      console.log(`BoundedLRUCache.delete() performance:`)
      console.log(`  Small cache (${SMALL_CACHE_SIZE} entries): ${smallTime.toFixed(2)} us/op`)
      console.log(`  Large cache (${LARGE_CACHE_SIZE} entries): ${largeTime.toFixed(2)} us/op`)
      console.log(`  Time ratio: ${timeRatio.toFixed(2)}x`)

      expect(timeRatio).toBeLessThan(MAX_ACCEPTABLE_TIME_RATIO)
    })

    it('should complete delete() in <50 microseconds with 100k entries', () => {
      const cache = createPopulatedBoundedCache(LARGE_CACHE_SIZE)
      const value = new Uint8Array(32)

      // Delete keys from the middle of the cache
      let idx = Math.floor(LARGE_CACHE_SIZE / 2)

      const avgTime = measureOperationTime(() => {
        const key = `key-${idx % LARGE_CACHE_SIZE}`
        cache.delete(key)
        cache.set(key, value) // Re-add
        idx++
      }, TIMING_ITERATIONS)

      console.log(`BoundedLRUCache.delete() with ${LARGE_CACHE_SIZE} entries: ${avgTime.toFixed(2)} us/op`)

      expect(avgTime).toBeLessThan(MAX_OPERATION_TIME_US)
    })
  })

  describe('LRU eviction', () => {
    it('should have O(1) eviction time complexity', () => {
      const value = new Uint8Array(32)

      // Small cache - measure eviction time
      const smallCache = new BoundedLRUCache<string, Uint8Array>(
        SMALL_CACHE_SIZE,
        binaryHashSizeCalculator
      )
      // Fill to capacity
      for (let i = 0; i < SMALL_CACHE_SIZE; i++) {
        smallCache.set(`key-${i}`, value)
      }
      let smallIdx = 0
      const smallTime = measureOperationTime(() => {
        smallCache.set(`evict-${smallIdx++}`, value) // Triggers eviction
      }, TIMING_ITERATIONS)

      // Large cache - measure eviction time
      const largeCache = new BoundedLRUCache<string, Uint8Array>(
        LARGE_CACHE_SIZE,
        binaryHashSizeCalculator
      )
      // Fill to capacity
      for (let i = 0; i < LARGE_CACHE_SIZE; i++) {
        largeCache.set(`key-${i}`, value)
      }
      let largeIdx = 0
      const largeTime = measureOperationTime(() => {
        largeCache.set(`evict-${largeIdx++}`, value) // Triggers eviction
      }, TIMING_ITERATIONS)

      const timeRatio = largeTime / smallTime

      console.log(`BoundedLRUCache eviction performance:`)
      console.log(`  Small cache (${SMALL_CACHE_SIZE} entries): ${smallTime.toFixed(2)} us/op`)
      console.log(`  Large cache (${LARGE_CACHE_SIZE} entries): ${largeTime.toFixed(2)} us/op`)
      console.log(`  Time ratio: ${timeRatio.toFixed(2)}x`)

      // Eviction should be O(1) - shift from array start, but the preceding
      // access order update on set is O(n), which will make this fail
      expect(timeRatio).toBeLessThan(MAX_ACCEPTABLE_TIME_RATIO)
    })
  })
})

// ============================================================================
// EMBEDDINGCACHE PERFORMANCE TESTS
// ============================================================================

describe('EmbeddingCache O(1) Performance', () => {
  describe('get() operation', () => {
    it('should have O(1) time complexity - small vs large cache timing', () => {
      const smallCache = createPopulatedEmbeddingCache(SMALL_CACHE_SIZE)
      const largeCache = createPopulatedEmbeddingCache(LARGE_CACHE_SIZE)

      const smallTime = measureOperationTime(() => {
        const key = `key-${Math.floor(Math.random() * SMALL_CACHE_SIZE)}`
        smallCache.get(key)
      }, TIMING_ITERATIONS)

      const largeTime = measureOperationTime(() => {
        const key = `key-${Math.floor(Math.random() * LARGE_CACHE_SIZE)}`
        largeCache.get(key)
      }, TIMING_ITERATIONS)

      const timeRatio = largeTime / smallTime

      console.log(`EmbeddingCache.get() performance:`)
      console.log(`  Small cache (${SMALL_CACHE_SIZE} entries): ${smallTime.toFixed(2)} us/op`)
      console.log(`  Large cache (${LARGE_CACHE_SIZE} entries): ${largeTime.toFixed(2)} us/op`)
      console.log(`  Time ratio: ${timeRatio.toFixed(2)}x`)

      expect(timeRatio).toBeLessThan(MAX_ACCEPTABLE_TIME_RATIO)
    })

    it('should complete get() in <50 microseconds with 100k entries', () => {
      const cache = createPopulatedEmbeddingCache(LARGE_CACHE_SIZE)
      const midKey = `key-${Math.floor(LARGE_CACHE_SIZE / 2)}`

      const avgTime = measureOperationTime(() => {
        cache.get(midKey)
      }, TIMING_ITERATIONS)

      console.log(`EmbeddingCache.get() with ${LARGE_CACHE_SIZE} entries: ${avgTime.toFixed(2)} us/op`)

      expect(avgTime).toBeLessThan(MAX_OPERATION_TIME_US)
    })
  })

  describe('set() operation', () => {
    it('should have O(1) time complexity for updates - small vs large cache timing', () => {
      const smallCache = createPopulatedEmbeddingCache(SMALL_CACHE_SIZE)
      const largeCache = createPopulatedEmbeddingCache(LARGE_CACHE_SIZE)
      const vector = new Float32Array(384)

      const smallTime = measureOperationTime(() => {
        const key = `key-${Math.floor(Math.random() * SMALL_CACHE_SIZE)}`
        smallCache.set(key, vector)
      }, TIMING_ITERATIONS)

      const largeTime = measureOperationTime(() => {
        const key = `key-${Math.floor(Math.random() * LARGE_CACHE_SIZE)}`
        largeCache.set(key, vector)
      }, TIMING_ITERATIONS)

      const timeRatio = largeTime / smallTime

      console.log(`EmbeddingCache.set() update performance:`)
      console.log(`  Small cache (${SMALL_CACHE_SIZE} entries): ${smallTime.toFixed(2)} us/op`)
      console.log(`  Large cache (${LARGE_CACHE_SIZE} entries): ${largeTime.toFixed(2)} us/op`)
      console.log(`  Time ratio: ${timeRatio.toFixed(2)}x`)

      expect(timeRatio).toBeLessThan(MAX_ACCEPTABLE_TIME_RATIO)
    })
  })

  describe('delete() operation', () => {
    it('should have O(1) time complexity - small vs large cache timing', () => {
      const vector = new Float32Array(384)

      // Small cache timing
      let smallCache = createPopulatedEmbeddingCache(SMALL_CACHE_SIZE)
      let idx = 0
      const smallTime = measureOperationTime(() => {
        const key = `key-${idx % SMALL_CACHE_SIZE}`
        smallCache.delete(key)
        smallCache.set(key, vector)
        idx++
      }, TIMING_ITERATIONS)

      // Large cache timing
      let largeCache = createPopulatedEmbeddingCache(LARGE_CACHE_SIZE)
      idx = 0
      const largeTime = measureOperationTime(() => {
        const key = `key-${idx % LARGE_CACHE_SIZE}`
        largeCache.delete(key)
        largeCache.set(key, vector)
        idx++
      }, TIMING_ITERATIONS)

      const timeRatio = largeTime / smallTime

      console.log(`EmbeddingCache.delete() performance:`)
      console.log(`  Small cache (${SMALL_CACHE_SIZE} entries): ${smallTime.toFixed(2)} us/op`)
      console.log(`  Large cache (${LARGE_CACHE_SIZE} entries): ${largeTime.toFixed(2)} us/op`)
      console.log(`  Time ratio: ${timeRatio.toFixed(2)}x`)

      expect(timeRatio).toBeLessThan(MAX_ACCEPTABLE_TIME_RATIO)
    })
  })
})

// ============================================================================
// STRESS TEST
// ============================================================================

describe('Stress Tests', () => {
  it('should maintain O(1) performance under high load', () => {
    const cache = new BoundedLRUCache<string, Uint8Array>(
      50_000, // Fixed size cache
      binaryHashSizeCalculator
    )
    const value = new Uint8Array(32)

    // Pre-populate
    for (let i = 0; i < 50_000; i++) {
      cache.set(`key-${i}`, value)
    }

    // Run mixed operations for 5 seconds or 100k operations
    const operations = ['get', 'set', 'delete'] as const
    const results: number[] = []
    let totalOps = 0

    const startTime = performance.now()
    while (performance.now() - startTime < 5000 && totalOps < 100_000) {
      const opStart = performance.now()
      const op = operations[totalOps % 3]
      const key = `key-${totalOps % 50_000}`

      switch (op) {
        case 'get':
          cache.get(key)
          break
        case 'set':
          cache.set(key, value)
          break
        case 'delete':
          cache.delete(key)
          cache.set(key, value) // Re-add
          break
      }

      const opTime = (performance.now() - opStart) * 1000 // Convert to us
      results.push(opTime)
      totalOps++
    }

    // Calculate percentiles
    results.sort((a, b) => a - b)
    const p50 = results[Math.floor(results.length * 0.5)]!
    const p95 = results[Math.floor(results.length * 0.95)]!
    const p99 = results[Math.floor(results.length * 0.99)]!
    const max = results[results.length - 1]!

    console.log(`Stress test results (${totalOps} ops):`)
    console.log(`  p50: ${p50.toFixed(2)} us`)
    console.log(`  p95: ${p95.toFixed(2)} us`)
    console.log(`  p99: ${p99.toFixed(2)} us`)
    console.log(`  max: ${max.toFixed(2)} us`)

    // For O(1) operations, p99 should be similar to p50 (within 10x)
    // For O(n) operations, we'd see much higher variance
    expect(p99).toBeLessThan(p50 * 20)
    expect(p99).toBeLessThan(1000) // p99 should be < 1ms
  })
})
