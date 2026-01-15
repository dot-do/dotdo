/**
 * VectorStore Memory Bounds Tests (RED Phase)
 *
 * Tests for bounded memory in VectorStore to prevent memory leaks from unbounded cache growth.
 *
 * The current VectorStore has unbounded caches:
 * - binaryHashCache: Map<string, Uint8Array>
 * - matryoshkaCache: Map<string, Map<number, Float32Array>>
 *
 * These tests verify:
 * 1. LRU cache with max entries limit
 * 2. Cache eviction under memory pressure
 * 3. Memory usage tracking and reporting
 * 4. Cache hit/miss metrics
 * 5. Configurable cache size
 *
 * @module tests/db/vector/memory-bounds.test
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ============================================================================
// MODULE IMPORTS (will fail until implementation exists)
// ============================================================================

let VectorStore: any

beforeEach(async () => {
  try {
    const vectorModule = await import('../../../db/vector')
    VectorStore = vectorModule.VectorStore
  } catch {
    VectorStore = undefined
  }
})

// ============================================================================
// TEST UTILITIES
// ============================================================================

function assertModuleLoaded(fnName: string, fn: any): asserts fn {
  if (!fn) {
    throw new Error(
      `VectorStore module not implemented. Expected '${fnName}' from 'db/vector'. ` +
        `Create the module to make this test pass.`
    )
  }
}

/**
 * Generate a random normalized vector (unit length for cosine similarity)
 */
function randomNormalizedVector(dims: number, seed?: number): Float32Array {
  const vec = new Float32Array(dims)
  let s = seed ?? Math.floor(Math.random() * 2147483647)

  let norm = 0
  for (let i = 0; i < dims; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const u1 = s / 0x7fffffff
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const u2 = s / 0x7fffffff
    const z = Math.sqrt(-2 * Math.log(u1 + 0.0001)) * Math.cos(2 * Math.PI * u2)
    vec[i] = z
    norm += z * z
  }

  norm = Math.sqrt(norm)
  for (let i = 0; i < dims; i++) {
    vec[i] /= norm
  }

  return vec
}

/**
 * Create a mock database for testing
 */
function createMockDb() {
  const data = new Map<string, any>()
  const ftsData = new Map<string, string>()
  const events: any[] = []

  return {
    data,
    ftsData,
    events,
    exec: vi.fn(),
    prepare: vi.fn(() => ({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn(() => []),
    })),
    onCDC: (handler: (event: any) => void) => {
      return { unsubscribe: () => {} }
    },
    _emitCDC: (event: any) => events.push(event),
  }
}

// ============================================================================
// TESTS: LRU Cache Configuration
// ============================================================================

describe('VectorStore - LRU Cache Configuration', () => {
  it('should accept cacheConfig option with maxSize', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, {
      dimension: 1536,
      cacheConfig: {
        maxSize: 1000,
      },
    })

    // Should expose cache configuration
    expect(vectors.cacheConfig).toBeDefined()
    expect(vectors.cacheConfig.maxSize).toBe(1000)
  })

  it('should use default maxSize of 10000 when not specified', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, { dimension: 1536 })

    expect(vectors.cacheConfig).toBeDefined()
    expect(vectors.cacheConfig.maxSize).toBe(10000)
  })

  it('should accept separate limits for binaryHashCache and matryoshkaCache', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, {
      dimension: 1536,
      cacheConfig: {
        binaryHashMaxSize: 5000,
        matryoshkaMaxSize: 2000,
      },
    })

    expect(vectors.cacheConfig.binaryHashMaxSize).toBe(5000)
    expect(vectors.cacheConfig.matryoshkaMaxSize).toBe(2000)
  })

  it('should validate maxSize is a positive integer', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()

    expect(() => new VectorStore(db, {
      dimension: 1536,
      cacheConfig: { maxSize: 0 },
    })).toThrow(/maxSize.*positive|invalid.*cache.*size/i)

    expect(() => new VectorStore(db, {
      dimension: 1536,
      cacheConfig: { maxSize: -100 },
    })).toThrow(/maxSize.*positive|invalid.*cache.*size/i)

    expect(() => new VectorStore(db, {
      dimension: 1536,
      cacheConfig: { maxSize: 1.5 },
    })).toThrow(/maxSize.*integer|invalid.*cache.*size/i)
  })

  it('should accept memoryLimitBytes for memory-based eviction', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, {
      dimension: 1536,
      cacheConfig: {
        memoryLimitBytes: 100 * 1024 * 1024, // 100MB
      },
    })

    expect(vectors.cacheConfig.memoryLimitBytes).toBe(100 * 1024 * 1024)
  })
})

// ============================================================================
// TESTS: Cache Size Bounds
// ============================================================================

describe('VectorStore - Cache Size Bounds', () => {
  it('should not exceed maxSize entries in binaryHashCache', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const maxSize = 100
    const vectors = new VectorStore(db, {
      dimension: 1536,
      cacheConfig: { maxSize },
    })

    // Insert more documents than maxSize
    const numDocs = maxSize * 2
    for (let i = 0; i < numDocs; i++) {
      await vectors.insert({
        id: `doc_${i}`,
        content: `Document ${i}`,
        embedding: randomNormalizedVector(1536, i),
      })
    }

    // Access all documents to populate cache
    for (let i = 0; i < numDocs; i++) {
      await vectors.search({
        embedding: randomNormalizedVector(1536, i),
        limit: 1,
        useBinaryPrefilter: true,
      })
    }

    // Get cache stats
    const stats = vectors.getCacheStats()
    expect(stats.binaryHashCache.size).toBeLessThanOrEqual(maxSize)
  })

  it('should not exceed maxSize entries in matryoshkaCache', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const maxSize = 100
    const vectors = new VectorStore(db, {
      dimension: 1536,
      matryoshkaDims: [64, 256, 1536],
      cacheConfig: { maxSize },
    })

    // Insert more documents than maxSize
    const numDocs = maxSize * 2
    for (let i = 0; i < numDocs; i++) {
      await vectors.insert({
        id: `doc_${i}`,
        content: `Document ${i}`,
        embedding: randomNormalizedVector(1536, i),
      })
    }

    // Trigger matryoshka cache population via progressive search
    for (let i = 0; i < numDocs; i++) {
      await vectors.progressiveSearch({
        embedding: randomNormalizedVector(1536, i),
        limit: 1,
        stages: [
          { type: 'matryoshka', dim: 64, candidates: 50 },
          { type: 'exact', candidates: 10 },
        ],
      })
    }

    // Get cache stats
    const stats = vectors.getCacheStats()
    expect(stats.matryoshkaCache.size).toBeLessThanOrEqual(maxSize)
  })

  it('should enforce cache bounds after batch insert', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const maxSize = 50
    const vectors = new VectorStore(db, {
      dimension: 1536,
      cacheConfig: { maxSize },
    })

    // Batch insert more than maxSize
    const documents = Array.from({ length: 200 }, (_, i) => ({
      id: `doc_${i}`,
      content: `Document ${i}`,
      embedding: randomNormalizedVector(1536, i),
    }))

    await vectors.insertBatch(documents)

    // Cache should be bounded even after batch insert
    const stats = vectors.getCacheStats()
    expect(stats.binaryHashCache.size).toBeLessThanOrEqual(maxSize)
  })

  it('should maintain cache bounds during continuous operations', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const maxSize = 100
    const vectors = new VectorStore(db, {
      dimension: 1536,
      cacheConfig: { maxSize },
    })

    // Simulate continuous insert/search workload
    for (let round = 0; round < 10; round++) {
      // Insert batch
      for (let i = 0; i < 50; i++) {
        const docId = `doc_round${round}_${i}`
        await vectors.insert({
          id: docId,
          content: `Document ${docId}`,
          embedding: randomNormalizedVector(1536, round * 1000 + i),
        })
      }

      // Search batch
      for (let i = 0; i < 20; i++) {
        await vectors.search({
          embedding: randomNormalizedVector(1536, round * 100 + i),
          limit: 10,
          useBinaryPrefilter: true,
        })
      }

      // Verify bounds after each round
      const stats = vectors.getCacheStats()
      expect(stats.binaryHashCache.size).toBeLessThanOrEqual(maxSize)
      expect(stats.matryoshkaCache.size).toBeLessThanOrEqual(maxSize)
    }
  })
})

// ============================================================================
// TESTS: LRU Eviction Policy
// ============================================================================

describe('VectorStore - LRU Eviction Policy', () => {
  it('should evict least recently used entries when cache is full', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const maxSize = 10
    const vectors = new VectorStore(db, {
      dimension: 1536,
      cacheConfig: { maxSize },
    })

    // Insert and access documents 0-9
    for (let i = 0; i < 10; i++) {
      await vectors.insert({
        id: `doc_${i}`,
        content: `Document ${i}`,
        embedding: randomNormalizedVector(1536, i),
      })
    }

    // Access doc_0 through doc_9 to populate cache
    for (let i = 0; i < 10; i++) {
      await vectors.search({
        embedding: randomNormalizedVector(1536, i),
        limit: 1,
        useBinaryPrefilter: true,
      })
    }

    // Re-access doc_5 through doc_9 (making them more recently used)
    for (let i = 5; i < 10; i++) {
      await vectors.search({
        embedding: randomNormalizedVector(1536, i),
        limit: 1,
        useBinaryPrefilter: true,
      })
    }

    // Insert and access 5 more documents (should evict doc_0 through doc_4)
    for (let i = 10; i < 15; i++) {
      await vectors.insert({
        id: `doc_${i}`,
        content: `Document ${i}`,
        embedding: randomNormalizedVector(1536, i),
      })
      await vectors.search({
        embedding: randomNormalizedVector(1536, i),
        limit: 1,
        useBinaryPrefilter: true,
      })
    }

    // Verify cache contains recently used entries
    const stats = vectors.getCacheStats()
    expect(stats.binaryHashCache.size).toBe(maxSize)

    // Check that least recently used (doc_0 through doc_4) were evicted
    // and recently used (doc_5 through doc_14) are retained
    const cachedIds = stats.binaryHashCache.keys
    for (let i = 0; i < 5; i++) {
      expect(cachedIds).not.toContain(`doc_${i}`)
    }
    for (let i = 10; i < 15; i++) {
      expect(cachedIds).toContain(`doc_${i}`)
    }
  })

  it('should update access time on cache hit', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const maxSize = 5
    const vectors = new VectorStore(db, {
      dimension: 1536,
      cacheConfig: { maxSize },
    })

    // Insert 5 documents
    for (let i = 0; i < 5; i++) {
      await vectors.insert({
        id: `doc_${i}`,
        content: `Document ${i}`,
        embedding: randomNormalizedVector(1536, i),
      })
    }

    // Access doc_0 last (making it most recently used)
    for (let i = 4; i >= 0; i--) {
      await vectors.search({
        embedding: randomNormalizedVector(1536, i),
        limit: 1,
        useBinaryPrefilter: true,
      })
    }

    // Insert one more document (should evict doc_4, not doc_0)
    await vectors.insert({
      id: 'doc_5',
      content: 'Document 5',
      embedding: randomNormalizedVector(1536, 5),
    })
    await vectors.search({
      embedding: randomNormalizedVector(1536, 5),
      limit: 1,
      useBinaryPrefilter: true,
    })

    const stats = vectors.getCacheStats()
    const cachedIds = stats.binaryHashCache.keys
    expect(cachedIds).toContain('doc_0') // Most recently used, should be retained
    expect(cachedIds).not.toContain('doc_4') // Least recently used, should be evicted
  })

  it('should handle get operation without affecting LRU order when not found', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const maxSize = 5
    const vectors = new VectorStore(db, {
      dimension: 1536,
      cacheConfig: { maxSize },
    })

    // Insert 5 documents
    for (let i = 0; i < 5; i++) {
      await vectors.insert({
        id: `doc_${i}`,
        content: `Document ${i}`,
        embedding: randomNormalizedVector(1536, i),
      })
    }

    // Populate cache
    for (let i = 0; i < 5; i++) {
      await vectors.search({
        embedding: randomNormalizedVector(1536, i),
        limit: 1,
        useBinaryPrefilter: true,
      })
    }

    // Try to get non-existent document
    await vectors.get('non_existent')

    // Cache should be unchanged
    const stats = vectors.getCacheStats()
    expect(stats.binaryHashCache.size).toBe(5)
  })
})

// ============================================================================
// TESTS: Memory Pressure Eviction
// ============================================================================

describe('VectorStore - Memory Pressure Eviction', () => {
  it('should evict entries when memory limit is exceeded', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    // Each 1536-dim embedding is ~6KB, binary hash is 192 bytes
    // Set limit to ~100KB to force eviction
    const memoryLimitBytes = 100 * 1024
    const vectors = new VectorStore(db, {
      dimension: 1536,
      cacheConfig: { memoryLimitBytes },
    })

    // Insert many documents to exceed memory limit
    for (let i = 0; i < 100; i++) {
      await vectors.insert({
        id: `doc_${i}`,
        content: `Document ${i}`,
        embedding: randomNormalizedVector(1536, i),
      })
    }

    // Access all documents to populate cache
    for (let i = 0; i < 100; i++) {
      await vectors.search({
        embedding: randomNormalizedVector(1536, i),
        limit: 1,
        useBinaryPrefilter: true,
      })
    }

    const stats = vectors.getCacheStats()
    expect(stats.memoryBytes).toBeLessThanOrEqual(memoryLimitBytes * 1.1) // Allow 10% tolerance
  })

  it('should track memory usage per cache entry', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, {
      dimension: 1536,
      cacheConfig: { maxSize: 100 },
    })

    // Insert single document
    await vectors.insert({
      id: 'doc_1',
      content: 'Test document',
      embedding: randomNormalizedVector(1536, 1),
    })

    // Access to populate cache
    await vectors.search({
      embedding: randomNormalizedVector(1536, 1),
      limit: 1,
      useBinaryPrefilter: true,
    })

    const stats = vectors.getCacheStats()

    // Binary hash for 1536 dims = 192 bytes
    expect(stats.binaryHashCache.memoryBytes).toBeGreaterThan(0)
    expect(stats.binaryHashCache.avgEntryBytes).toBeCloseTo(192, -1) // Allow some overhead
  })

  it('should report total memory usage across all caches', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, {
      dimension: 1536,
      matryoshkaDims: [64, 256, 1536],
      cacheConfig: { maxSize: 100 },
    })

    // Insert documents
    for (let i = 0; i < 50; i++) {
      await vectors.insert({
        id: `doc_${i}`,
        content: `Document ${i}`,
        embedding: randomNormalizedVector(1536, i),
      })
    }

    // Trigger cache population
    for (let i = 0; i < 50; i++) {
      await vectors.progressiveSearch({
        embedding: randomNormalizedVector(1536, i),
        limit: 1,
        stages: [
          { type: 'matryoshka', dim: 64, candidates: 10 },
          { type: 'exact', candidates: 5 },
        ],
      })
    }

    const stats = vectors.getCacheStats()
    expect(stats.totalMemoryBytes).toBe(
      stats.binaryHashCache.memoryBytes + stats.matryoshkaCache.memoryBytes
    )
  })

  it('should trigger eviction at configurable memory threshold', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, {
      dimension: 1536,
      cacheConfig: {
        memoryLimitBytes: 50 * 1024, // 50KB
        evictionThreshold: 0.9, // Evict when at 90% of limit
      },
    })

    // Fill cache
    for (let i = 0; i < 100; i++) {
      await vectors.insert({
        id: `doc_${i}`,
        content: `Document ${i}`,
        embedding: randomNormalizedVector(1536, i),
      })
      await vectors.search({
        embedding: randomNormalizedVector(1536, i),
        limit: 1,
        useBinaryPrefilter: true,
      })
    }

    const stats = vectors.getCacheStats()
    // Should evict before hitting 100% of limit
    expect(stats.memoryBytes).toBeLessThanOrEqual(50 * 1024)
  })
})

// ============================================================================
// TESTS: Cache Hit/Miss Metrics
// ============================================================================

describe('VectorStore - Cache Hit/Miss Metrics', () => {
  it('should track cache hit count', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, {
      dimension: 1536,
      cacheConfig: { maxSize: 100 },
    })

    // Insert and access a document
    await vectors.insert({
      id: 'doc_1',
      content: 'Test document',
      embedding: randomNormalizedVector(1536, 1),
    })

    // First access - cache miss
    await vectors.search({
      embedding: randomNormalizedVector(1536, 1),
      limit: 1,
      useBinaryPrefilter: true,
    })

    // Second access - cache hit
    await vectors.search({
      embedding: randomNormalizedVector(1536, 1),
      limit: 1,
      useBinaryPrefilter: true,
    })

    // Third access - cache hit
    await vectors.search({
      embedding: randomNormalizedVector(1536, 1),
      limit: 1,
      useBinaryPrefilter: true,
    })

    const stats = vectors.getCacheStats()
    expect(stats.binaryHashCache.hits).toBeGreaterThanOrEqual(2)
  })

  it('should track cache miss count', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, {
      dimension: 1536,
      cacheConfig: { maxSize: 100 },
    })

    // Insert multiple documents
    for (let i = 0; i < 10; i++) {
      await vectors.insert({
        id: `doc_${i}`,
        content: `Document ${i}`,
        embedding: randomNormalizedVector(1536, i),
      })
    }

    // Access each document once (all misses)
    for (let i = 0; i < 10; i++) {
      await vectors.search({
        embedding: randomNormalizedVector(1536, i),
        limit: 1,
        useBinaryPrefilter: true,
      })
    }

    const stats = vectors.getCacheStats()
    expect(stats.binaryHashCache.misses).toBeGreaterThanOrEqual(10)
  })

  it('should calculate cache hit rate', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, {
      dimension: 1536,
      cacheConfig: { maxSize: 100 },
    })

    // Insert document
    await vectors.insert({
      id: 'doc_1',
      content: 'Test document',
      embedding: randomNormalizedVector(1536, 1),
    })

    // 1 miss + 9 hits = 90% hit rate
    for (let i = 0; i < 10; i++) {
      await vectors.search({
        embedding: randomNormalizedVector(1536, 1),
        limit: 1,
        useBinaryPrefilter: true,
      })
    }

    const stats = vectors.getCacheStats()
    expect(stats.binaryHashCache.hitRate).toBeCloseTo(0.9, 1)
  })

  it('should track eviction count', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const maxSize = 10
    const vectors = new VectorStore(db, {
      dimension: 1536,
      cacheConfig: { maxSize },
    })

    // Insert and access more documents than maxSize
    for (let i = 0; i < 20; i++) {
      await vectors.insert({
        id: `doc_${i}`,
        content: `Document ${i}`,
        embedding: randomNormalizedVector(1536, i),
      })
      await vectors.search({
        embedding: randomNormalizedVector(1536, i),
        limit: 1,
        useBinaryPrefilter: true,
      })
    }

    const stats = vectors.getCacheStats()
    // At least 10 evictions should have occurred (20 inserts - 10 maxSize)
    expect(stats.binaryHashCache.evictions).toBeGreaterThanOrEqual(10)
  })

  it('should reset metrics on demand', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, {
      dimension: 1536,
      cacheConfig: { maxSize: 100 },
    })

    // Generate some metrics
    for (let i = 0; i < 10; i++) {
      await vectors.insert({
        id: `doc_${i}`,
        content: `Document ${i}`,
        embedding: randomNormalizedVector(1536, i),
      })
      await vectors.search({
        embedding: randomNormalizedVector(1536, i),
        limit: 1,
        useBinaryPrefilter: true,
      })
    }

    let stats = vectors.getCacheStats()
    expect(stats.binaryHashCache.hits + stats.binaryHashCache.misses).toBeGreaterThan(0)

    // Reset metrics
    vectors.resetCacheMetrics()

    stats = vectors.getCacheStats()
    expect(stats.binaryHashCache.hits).toBe(0)
    expect(stats.binaryHashCache.misses).toBe(0)
    expect(stats.binaryHashCache.evictions).toBe(0)
    // Note: cache size should NOT be reset, only metrics
    expect(stats.binaryHashCache.size).toBeGreaterThan(0)
  })

  it('should track metrics separately for each cache type', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, {
      dimension: 1536,
      matryoshkaDims: [64, 256, 1536],
      cacheConfig: { maxSize: 100 },
    })

    // Insert documents
    for (let i = 0; i < 10; i++) {
      await vectors.insert({
        id: `doc_${i}`,
        content: `Document ${i}`,
        embedding: randomNormalizedVector(1536, i),
      })
    }

    // Trigger binary hash cache
    for (let i = 0; i < 5; i++) {
      await vectors.search({
        embedding: randomNormalizedVector(1536, i),
        limit: 1,
        useBinaryPrefilter: true,
      })
    }

    // Trigger matryoshka cache
    for (let i = 5; i < 10; i++) {
      await vectors.adaptiveProgressiveSearch({
        embedding: randomNormalizedVector(1536, i),
        limit: 1,
      })
    }

    const stats = vectors.getCacheStats()

    // Each cache should have independent metrics
    expect(stats.binaryHashCache).toHaveProperty('hits')
    expect(stats.binaryHashCache).toHaveProperty('misses')
    expect(stats.binaryHashCache).toHaveProperty('hitRate')
    expect(stats.matryoshkaCache).toHaveProperty('hits')
    expect(stats.matryoshkaCache).toHaveProperty('misses')
    expect(stats.matryoshkaCache).toHaveProperty('hitRate')
  })
})

// ============================================================================
// TESTS: Cache API
// ============================================================================

describe('VectorStore - Cache API', () => {
  it('should expose getCacheStats() method', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, {
      dimension: 1536,
      cacheConfig: { maxSize: 100 },
    })

    const stats = vectors.getCacheStats()

    expect(stats).toHaveProperty('binaryHashCache')
    expect(stats).toHaveProperty('matryoshkaCache')
    expect(stats).toHaveProperty('totalMemoryBytes')
  })

  it('should expose clearCache() method', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, {
      dimension: 1536,
      cacheConfig: { maxSize: 100 },
    })

    // Populate cache
    for (let i = 0; i < 10; i++) {
      await vectors.insert({
        id: `doc_${i}`,
        content: `Document ${i}`,
        embedding: randomNormalizedVector(1536, i),
      })
      await vectors.search({
        embedding: randomNormalizedVector(1536, i),
        limit: 1,
        useBinaryPrefilter: true,
      })
    }

    let stats = vectors.getCacheStats()
    expect(stats.binaryHashCache.size).toBeGreaterThan(0)

    // Clear cache
    vectors.clearCache()

    stats = vectors.getCacheStats()
    expect(stats.binaryHashCache.size).toBe(0)
    expect(stats.matryoshkaCache.size).toBe(0)
  })

  it('should expose clearCache(type) to clear specific cache', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, {
      dimension: 1536,
      matryoshkaDims: [64, 256, 1536],
      cacheConfig: { maxSize: 100 },
    })

    // Populate both caches
    for (let i = 0; i < 10; i++) {
      await vectors.insert({
        id: `doc_${i}`,
        content: `Document ${i}`,
        embedding: randomNormalizedVector(1536, i),
      })
    }

    for (let i = 0; i < 10; i++) {
      await vectors.search({
        embedding: randomNormalizedVector(1536, i),
        limit: 1,
        useBinaryPrefilter: true,
      })
      await vectors.adaptiveProgressiveSearch({
        embedding: randomNormalizedVector(1536, i),
        limit: 1,
      })
    }

    let stats = vectors.getCacheStats()
    expect(stats.binaryHashCache.size).toBeGreaterThan(0)
    expect(stats.matryoshkaCache.size).toBeGreaterThan(0)

    // Clear only binary hash cache
    vectors.clearCache('binaryHash')

    stats = vectors.getCacheStats()
    expect(stats.binaryHashCache.size).toBe(0)
    expect(stats.matryoshkaCache.size).toBeGreaterThan(0)
  })

  it('should expose resizeCache() method', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, {
      dimension: 1536,
      cacheConfig: { maxSize: 100 },
    })

    // Populate cache to 50 entries
    for (let i = 0; i < 50; i++) {
      await vectors.insert({
        id: `doc_${i}`,
        content: `Document ${i}`,
        embedding: randomNormalizedVector(1536, i),
      })
      await vectors.search({
        embedding: randomNormalizedVector(1536, i),
        limit: 1,
        useBinaryPrefilter: true,
      })
    }

    let stats = vectors.getCacheStats()
    expect(stats.binaryHashCache.size).toBe(50)

    // Resize to smaller size (should trigger eviction)
    vectors.resizeCache({ maxSize: 20 })

    stats = vectors.getCacheStats()
    expect(stats.binaryHashCache.size).toBeLessThanOrEqual(20)
    expect(vectors.cacheConfig.maxSize).toBe(20)
  })

  it('should expose warmCache() method for preloading', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, {
      dimension: 1536,
      cacheConfig: { maxSize: 100 },
    })

    // Insert documents
    const docIds = []
    for (let i = 0; i < 20; i++) {
      docIds.push(`doc_${i}`)
      await vectors.insert({
        id: `doc_${i}`,
        content: `Document ${i}`,
        embedding: randomNormalizedVector(1536, i),
      })
    }

    // Warm cache with specific IDs
    await vectors.warmCache(docIds.slice(0, 10))

    const stats = vectors.getCacheStats()
    expect(stats.binaryHashCache.size).toBeGreaterThanOrEqual(10)
  })
})

// ============================================================================
// TESTS: Cache Behavior with Document Operations
// ============================================================================

describe('VectorStore - Cache with Document Operations', () => {
  it('should invalidate cache entry on document delete', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, {
      dimension: 1536,
      cacheConfig: { maxSize: 100 },
    })

    // Insert and cache document
    await vectors.insert({
      id: 'doc_1',
      content: 'Test document',
      embedding: randomNormalizedVector(1536, 1),
    })

    await vectors.search({
      embedding: randomNormalizedVector(1536, 1),
      limit: 1,
      useBinaryPrefilter: true,
    })

    let stats = vectors.getCacheStats()
    expect(stats.binaryHashCache.keys).toContain('doc_1')

    // Delete document
    await vectors.delete('doc_1')

    stats = vectors.getCacheStats()
    expect(stats.binaryHashCache.keys).not.toContain('doc_1')
  })

  it('should update cache entry on document upsert', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, {
      dimension: 1536,
      cacheConfig: { maxSize: 100 },
    })

    // Insert initial document
    const embedding1 = randomNormalizedVector(1536, 1)
    await vectors.insert({
      id: 'doc_1',
      content: 'Original content',
      embedding: embedding1,
    })

    // Cache the entry
    await vectors.search({
      embedding: embedding1,
      limit: 1,
      useBinaryPrefilter: true,
    })

    // Upsert with new embedding
    const embedding2 = randomNormalizedVector(1536, 2)
    await vectors.upsert({
      id: 'doc_1',
      content: 'Updated content',
      embedding: embedding2,
    })

    // Search should find updated embedding
    const results = await vectors.search({
      embedding: embedding2,
      limit: 1,
    })

    expect(results[0].id).toBe('doc_1')
    expect(results[0].similarity).toBeCloseTo(1.0, 2)
  })

  it('should handle rapid insert/delete cycles without memory leak', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, {
      dimension: 1536,
      cacheConfig: { maxSize: 50 },
    })

    // Rapid insert/delete cycles
    for (let round = 0; round < 100; round++) {
      const docId = `doc_${round % 10}`

      await vectors.upsert({
        id: docId,
        content: `Document ${round}`,
        embedding: randomNormalizedVector(1536, round),
      })

      await vectors.search({
        embedding: randomNormalizedVector(1536, round),
        limit: 1,
        useBinaryPrefilter: true,
      })

      if (round % 5 === 0) {
        await vectors.delete(docId)
      }
    }

    const stats = vectors.getCacheStats()
    expect(stats.binaryHashCache.size).toBeLessThanOrEqual(50)
  })
})

// ============================================================================
// TESTS: Thread Safety (Concurrent Access)
// ============================================================================

describe('VectorStore - Concurrent Cache Access', () => {
  it('should handle concurrent searches without cache corruption', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, {
      dimension: 1536,
      cacheConfig: { maxSize: 100 },
    })

    // Insert documents
    for (let i = 0; i < 50; i++) {
      await vectors.insert({
        id: `doc_${i}`,
        content: `Document ${i}`,
        embedding: randomNormalizedVector(1536, i),
      })
    }

    // Concurrent searches
    const searches = Array.from({ length: 100 }, (_, i) =>
      vectors.search({
        embedding: randomNormalizedVector(1536, i % 50),
        limit: 5,
        useBinaryPrefilter: true,
      })
    )

    await Promise.all(searches)

    const stats = vectors.getCacheStats()
    // Cache should be consistent
    expect(stats.binaryHashCache.size).toBeLessThanOrEqual(100)
    expect(stats.binaryHashCache.size).toBeGreaterThan(0)
  })

  it('should handle concurrent inserts and searches', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, {
      dimension: 1536,
      cacheConfig: { maxSize: 100 },
    })

    // Mixed concurrent operations
    const operations = []
    for (let i = 0; i < 50; i++) {
      operations.push(
        vectors.insert({
          id: `doc_${i}`,
          content: `Document ${i}`,
          embedding: randomNormalizedVector(1536, i),
        })
      )
      operations.push(
        vectors.search({
          embedding: randomNormalizedVector(1536, i),
          limit: 5,
        })
      )
    }

    await Promise.all(operations)

    const stats = vectors.getCacheStats()
    expect(stats.binaryHashCache.size).toBeLessThanOrEqual(100)
  })
})

// ============================================================================
// TESTS: Integration with Tiered Storage
// ============================================================================

describe('VectorStore - Cache Integration with Tiered Storage', () => {
  it('should clear cache for documents demoted to cold tier', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, {
      dimension: 1536,
      cacheConfig: { maxSize: 100 },
      tieredStorage: {
        hot: { enabled: true, maxAgeMs: 100 }, // Very short for testing
        warm: { enabled: true, maxAgeMs: 200 },
        cold: { enabled: true },
        autoDemote: true,
      },
    })

    // Insert and cache document
    await vectors.insert({
      id: 'doc_1',
      content: 'Test document',
      embedding: randomNormalizedVector(1536, 1),
    })

    await vectors.search({
      embedding: randomNormalizedVector(1536, 1),
      limit: 1,
      useBinaryPrefilter: true,
    })

    // Wait for demotion to cold tier
    await new Promise(resolve => setTimeout(resolve, 300))
    await vectors.runTierMaintenance()

    // Cache should be cleared for cold tier documents
    const stats = vectors.getCacheStats()
    expect(stats.binaryHashCache.keys).not.toContain('doc_1')
  })

  it('should populate cache when documents promoted to hot tier', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, {
      dimension: 1536,
      cacheConfig: {
        maxSize: 100,
        autoPopulateOnPromote: true, // New config option
      },
      tieredStorage: {
        hot: { enabled: true, minAccessCount: 2 },
        warm: { enabled: true },
        cold: { enabled: true },
        autoPromote: true,
      },
    })

    // Insert document (starts in hot tier by default)
    await vectors.insert({
      id: 'doc_1',
      content: 'Test document',
      embedding: randomNormalizedVector(1536, 1),
    })

    // Demote to cold tier manually
    await vectors.demoteToCold('doc_1')

    // Clear cache
    vectors.clearCache()

    // Access document multiple times to trigger promotion
    for (let i = 0; i < 3; i++) {
      await vectors.search({
        embedding: randomNormalizedVector(1536, 1),
        limit: 1,
      })
    }

    // Cache should be auto-populated on promotion
    const stats = vectors.getCacheStats()
    expect(stats.binaryHashCache.keys).toContain('doc_1')
  })
})

// ============================================================================
// TESTS: Cache Stats Structure
// ============================================================================

describe('VectorStore - Cache Stats Structure', () => {
  it('should return complete CacheStats structure', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, {
      dimension: 1536,
      cacheConfig: { maxSize: 100 },
    })

    const stats = vectors.getCacheStats()

    // Verify complete structure
    expect(stats).toMatchObject({
      binaryHashCache: {
        size: expect.any(Number),
        maxSize: expect.any(Number),
        memoryBytes: expect.any(Number),
        avgEntryBytes: expect.any(Number),
        hits: expect.any(Number),
        misses: expect.any(Number),
        hitRate: expect.any(Number),
        evictions: expect.any(Number),
        keys: expect.any(Array),
      },
      matryoshkaCache: {
        size: expect.any(Number),
        maxSize: expect.any(Number),
        memoryBytes: expect.any(Number),
        avgEntryBytes: expect.any(Number),
        hits: expect.any(Number),
        misses: expect.any(Number),
        hitRate: expect.any(Number),
        evictions: expect.any(Number),
        keys: expect.any(Array),
      },
      totalMemoryBytes: expect.any(Number),
      memoryLimitBytes: expect.any(Number),
      memoryUsagePercent: expect.any(Number),
    })
  })

  it('should calculate memoryUsagePercent correctly', async () => {
    assertModuleLoaded('VectorStore', VectorStore)

    const db = createMockDb()
    const vectors = new VectorStore(db, {
      dimension: 1536,
      cacheConfig: {
        maxSize: 100,
        memoryLimitBytes: 100 * 1024, // 100KB
      },
    })

    // Insert and cache documents
    for (let i = 0; i < 20; i++) {
      await vectors.insert({
        id: `doc_${i}`,
        content: `Document ${i}`,
        embedding: randomNormalizedVector(1536, i),
      })
      await vectors.search({
        embedding: randomNormalizedVector(1536, i),
        limit: 1,
        useBinaryPrefilter: true,
      })
    }

    const stats = vectors.getCacheStats()
    expect(stats.memoryUsagePercent).toBe(
      (stats.totalMemoryBytes / stats.memoryLimitBytes) * 100
    )
  })
})
