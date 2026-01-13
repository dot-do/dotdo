/**
 * Cascade Chain Caching Tests
 *
 * RED PHASE: Tests for LRU cache implementation for cascade chain resolution.
 *
 * @see dotdo-zvmyl - [RED] Add cascade chain caching
 *
 * Problem:
 * Cascade chain resolution currently requires sequential DB queries for each hop:
 * - code->generative->agentic->human requires 4+ queries
 * - These queries are repeated every time the same chain is resolved
 *
 * Solution:
 * Implement an LRU cache for cascade chain resolution results:
 * - Cache resolved chains by starting function ID
 * - Reduce 4+ queries to 1 cache lookup for repeated calls
 * - Automatically invalidate cache when relationships change
 *
 * These tests will FAIL until CascadeChainCache is implemented.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { SQLiteGraphStore } from '../stores'
import { FunctionGraphAdapter, type FunctionData } from '../adapters/function-graph-adapter'
import type { GraphThing, GraphRelationship } from '../types'

// ============================================================================
// CACHE INTERFACE (to be implemented)
// ============================================================================

/**
 * CascadeChainCache provides LRU caching for cascade chain resolution.
 */
export interface CascadeChainCache {
  /**
   * Get a cached cascade chain.
   * @param functionId - Starting function ID
   * @returns Cached chain or null if not in cache
   */
  get(functionId: string): CachedChainResult | null

  /**
   * Store a cascade chain in the cache.
   * @param functionId - Starting function ID
   * @param chain - The resolved chain to cache
   */
  set(functionId: string, chain: GraphThing[]): void

  /**
   * Invalidate cache entries affected by a function change.
   * @param functionId - ID of the changed function
   */
  invalidateFunction(functionId: string): void

  /**
   * Invalidate cache entries affected by a relationship change.
   * @param fromId - Source function ID of the changed relationship
   * @param toId - Target function ID of the changed relationship
   */
  invalidateRelationship(fromId: string, toId: string): void

  /**
   * Clear all cached entries.
   */
  clear(): void

  /**
   * Get cache statistics.
   */
  getStats(): CacheStats
}

export interface CachedChainResult {
  /** The cached chain */
  chain: GraphThing[]
  /** Timestamp when cached */
  cachedAt: number
  /** Number of times this entry has been accessed */
  hitCount: number
}

export interface CacheStats {
  /** Total number of cache hits */
  hits: number
  /** Total number of cache misses */
  misses: number
  /** Current number of entries in cache */
  size: number
  /** Maximum cache capacity */
  maxSize: number
  /** Hit rate percentage (hits / (hits + misses) * 100) */
  hitRate: number
}

/**
 * Options for creating a CascadeChainCache.
 */
export interface CascadeChainCacheOptions {
  /** Maximum number of entries in the cache (default: 1000) */
  maxSize?: number
  /** Time-to-live in milliseconds (default: 5 minutes) */
  ttl?: number
}

// ============================================================================
// CACHED ADAPTER INTERFACE (to be implemented)
// ============================================================================

/**
 * CachedFunctionGraphAdapter extends FunctionGraphAdapter with caching.
 */
export interface CachedFunctionGraphAdapter {
  /**
   * Get cascade chain with caching.
   * Uses cache if available, otherwise resolves and caches.
   */
  getCascadeChainCached(functionId: string): Promise<GraphThing[]>

  /**
   * Get the underlying cache instance.
   */
  getCache(): CascadeChainCache

  /**
   * Get query count since last reset (for testing).
   */
  getQueryCount(): number

  /**
   * Reset query count (for testing).
   */
  resetQueryCount(): void
}

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Helper to create a function using the adapter
 */
async function createFunction(
  adapter: FunctionGraphAdapter,
  name: string,
  type: 'code' | 'generative' | 'agentic' | 'human',
  options?: { enabled?: boolean; id?: string }
): Promise<GraphThing> {
  return adapter.createFunction({
    name,
    type,
    enabled: options?.enabled ?? true,
    version: '1.0.0',
  }, { id: options?.id })
}

/**
 * Helper to create a cascade relationship
 */
async function createCascade(
  adapter: FunctionGraphAdapter,
  fromId: string,
  toId: string,
  priority: number = 0
): Promise<GraphRelationship> {
  return adapter.addCascade(fromId, toId, { priority })
}

/**
 * Create a full 4-level cascade chain: code -> generative -> agentic -> human
 */
async function createFullCascadeChain(
  adapter: FunctionGraphAdapter,
  prefix: string
): Promise<{
  code: GraphThing
  generative: GraphThing
  agentic: GraphThing
  human: GraphThing
}> {
  const code = await createFunction(adapter, `${prefix}-code`, 'code')
  const generative = await createFunction(adapter, `${prefix}-gen`, 'generative')
  const agentic = await createFunction(adapter, `${prefix}-agent`, 'agentic')
  const human = await createFunction(adapter, `${prefix}-human`, 'human')

  await createCascade(adapter, code.id, generative.id, 1)
  await createCascade(adapter, generative.id, agentic.id, 1)
  await createCascade(adapter, agentic.id, human.id, 1)

  return { code, generative, agentic, human }
}

// ============================================================================
// CACHE IMPLEMENTATION TESTS (RED PHASE)
// ============================================================================

describe('CascadeChainCache (RED Phase)', () => {
  let store: SQLiteGraphStore
  let adapter: FunctionGraphAdapter
  let cache: CascadeChainCache

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
    adapter = new FunctionGraphAdapter(store)

    // This import will FAIL until CascadeChainCache is implemented
    const { createCascadeChainCache } = await import('../cache/cascade-chain-cache')
    cache = createCascadeChainCache({ maxSize: 100 })
  })

  afterEach(async () => {
    await store.close()
  })

  describe('Basic Cache Operations', () => {
    it('should return null for uncached entries', async () => {
      const result = cache.get('non-existent-id')
      expect(result).toBeNull()
    })

    it('should cache and retrieve a chain', async () => {
      const { code, generative, agentic, human } = await createFullCascadeChain(adapter, 'cache-test')
      const chain = [code, generative, agentic, human]

      cache.set(code.id, chain)

      const cached = cache.get(code.id)
      expect(cached).not.toBeNull()
      expect(cached!.chain).toHaveLength(4)
      expect(cached!.chain[0]!.id).toBe(code.id)
      expect(cached!.chain[3]!.id).toBe(human.id)
    })

    it('should track hit count', async () => {
      const { code, generative } = await createFullCascadeChain(adapter, 'hitcount')
      const chain = [code, generative]

      cache.set(code.id, chain)

      // First access
      const first = cache.get(code.id)
      expect(first!.hitCount).toBe(1)

      // Second access
      const second = cache.get(code.id)
      expect(second!.hitCount).toBe(2)

      // Third access
      const third = cache.get(code.id)
      expect(third!.hitCount).toBe(3)
    })

    it('should clear all entries', async () => {
      const { code } = await createFullCascadeChain(adapter, 'clear1')
      const { code: code2 } = await createFullCascadeChain(adapter, 'clear2')

      cache.set(code.id, [code])
      cache.set(code2.id, [code2])

      expect(cache.get(code.id)).not.toBeNull()
      expect(cache.get(code2.id)).not.toBeNull()

      cache.clear()

      expect(cache.get(code.id)).toBeNull()
      expect(cache.get(code2.id)).toBeNull()
    })
  })

  describe('LRU Eviction', () => {
    it('should evict least recently used entries when at capacity', async () => {
      // Create cache with small capacity
      const { createCascadeChainCache } = await import('../cache/cascade-chain-cache')
      const smallCache = createCascadeChainCache({ maxSize: 3 })

      // Create 4 functions
      const fn1 = await createFunction(adapter, 'fn1', 'code')
      const fn2 = await createFunction(adapter, 'fn2', 'code')
      const fn3 = await createFunction(adapter, 'fn3', 'code')
      const fn4 = await createFunction(adapter, 'fn4', 'code')

      // Cache 3 entries (at capacity)
      smallCache.set(fn1.id, [fn1])
      smallCache.set(fn2.id, [fn2])
      smallCache.set(fn3.id, [fn3])

      // All 3 should be cached
      expect(smallCache.get(fn1.id)).not.toBeNull()
      expect(smallCache.get(fn2.id)).not.toBeNull()
      expect(smallCache.get(fn3.id)).not.toBeNull()

      // Access fn1 and fn3 to make fn2 the LRU
      smallCache.get(fn1.id)
      smallCache.get(fn3.id)

      // Add fn4 - should evict fn2 (least recently used)
      smallCache.set(fn4.id, [fn4])

      expect(smallCache.get(fn1.id)).not.toBeNull()
      expect(smallCache.get(fn2.id)).toBeNull() // Evicted
      expect(smallCache.get(fn3.id)).not.toBeNull()
      expect(smallCache.get(fn4.id)).not.toBeNull()
    })

    it('should update LRU order on access', async () => {
      const { createCascadeChainCache } = await import('../cache/cascade-chain-cache')
      const smallCache = createCascadeChainCache({ maxSize: 2 })

      const fn1 = await createFunction(adapter, 'lru1', 'code')
      const fn2 = await createFunction(adapter, 'lru2', 'code')
      const fn3 = await createFunction(adapter, 'lru3', 'code')

      // Cache fn1 and fn2
      smallCache.set(fn1.id, [fn1])
      smallCache.set(fn2.id, [fn2])

      // Access fn1 to make it most recently used
      smallCache.get(fn1.id)

      // Add fn3 - should evict fn2 (now LRU)
      smallCache.set(fn3.id, [fn3])

      expect(smallCache.get(fn1.id)).not.toBeNull()
      expect(smallCache.get(fn2.id)).toBeNull() // Evicted
      expect(smallCache.get(fn3.id)).not.toBeNull()
    })
  })

  describe('TTL Expiration', () => {
    it('should expire entries after TTL', async () => {
      const { createCascadeChainCache } = await import('../cache/cascade-chain-cache')
      const ttlCache = createCascadeChainCache({ maxSize: 100, ttl: 100 }) // 100ms TTL

      const fn = await createFunction(adapter, 'ttl-test', 'code')
      ttlCache.set(fn.id, [fn])

      // Should be cached immediately
      expect(ttlCache.get(fn.id)).not.toBeNull()

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 150))

      // Should be expired
      expect(ttlCache.get(fn.id)).toBeNull()
    })

    it('should refresh TTL on access', async () => {
      const { createCascadeChainCache } = await import('../cache/cascade-chain-cache')
      const ttlCache = createCascadeChainCache({ maxSize: 100, ttl: 200 }) // 200ms TTL

      const fn = await createFunction(adapter, 'ttl-refresh', 'code')
      ttlCache.set(fn.id, [fn])

      // Access at 100ms (before expiry)
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(ttlCache.get(fn.id)).not.toBeNull() // Refreshes TTL

      // Wait another 150ms (total 250ms from set, but only 150ms from last access)
      await new Promise((resolve) => setTimeout(resolve, 150))

      // Should still be valid because TTL was refreshed
      expect(ttlCache.get(fn.id)).not.toBeNull()
    })
  })

  describe('Cache Invalidation', () => {
    it('should invalidate cache when function is modified', async () => {
      const { code, generative, agentic, human } = await createFullCascadeChain(adapter, 'invalidate-fn')
      const chain = [code, generative, agentic, human]

      cache.set(code.id, chain)
      expect(cache.get(code.id)).not.toBeNull()

      // Invalidate by function ID
      cache.invalidateFunction(generative.id)

      // Entry should be invalidated because generative is in the chain
      expect(cache.get(code.id)).toBeNull()
    })

    it('should invalidate cache when relationship is modified', async () => {
      const { code, generative, agentic, human } = await createFullCascadeChain(adapter, 'invalidate-rel')
      const chain = [code, generative, agentic, human]

      cache.set(code.id, chain)
      expect(cache.get(code.id)).not.toBeNull()

      // Invalidate by relationship (generative->agentic)
      cache.invalidateRelationship(generative.id, agentic.id)

      // Entry should be invalidated
      expect(cache.get(code.id)).toBeNull()
    })

    it('should only invalidate affected entries', async () => {
      const chain1 = await createFullCascadeChain(adapter, 'chain1')
      const chain2 = await createFullCascadeChain(adapter, 'chain2')

      cache.set(chain1.code.id, [chain1.code, chain1.generative, chain1.agentic, chain1.human])
      cache.set(chain2.code.id, [chain2.code, chain2.generative, chain2.agentic, chain2.human])

      // Invalidate function in chain1 only
      cache.invalidateFunction(chain1.generative.id)

      // chain1 should be invalidated
      expect(cache.get(chain1.code.id)).toBeNull()
      // chain2 should still be valid
      expect(cache.get(chain2.code.id)).not.toBeNull()
    })

    it('should invalidate entries starting from the modified function', async () => {
      const { code, generative, agentic, human } = await createFullCascadeChain(adapter, 'start-point')

      // Cache chains starting from different points
      cache.set(code.id, [code, generative, agentic, human])
      cache.set(generative.id, [generative, agentic, human])
      cache.set(agentic.id, [agentic, human])

      // Invalidate agentic
      cache.invalidateFunction(agentic.id)

      // All entries containing agentic should be invalidated
      expect(cache.get(code.id)).toBeNull()
      expect(cache.get(generative.id)).toBeNull()
      expect(cache.get(agentic.id)).toBeNull()
    })
  })

  describe('Cache Statistics', () => {
    it('should track hits and misses', async () => {
      const fn = await createFunction(adapter, 'stats', 'code')
      cache.set(fn.id, [fn])

      // Miss
      cache.get('non-existent')
      // Hit
      cache.get(fn.id)
      // Hit
      cache.get(fn.id)
      // Miss
      cache.get('another-non-existent')

      const stats = cache.getStats()
      expect(stats.hits).toBe(2)
      expect(stats.misses).toBe(2)
      expect(stats.hitRate).toBe(50)
    })

    it('should report cache size', async () => {
      expect(cache.getStats().size).toBe(0)

      const fn1 = await createFunction(adapter, 'size1', 'code')
      const fn2 = await createFunction(adapter, 'size2', 'code')

      cache.set(fn1.id, [fn1])
      expect(cache.getStats().size).toBe(1)

      cache.set(fn2.id, [fn2])
      expect(cache.getStats().size).toBe(2)

      cache.clear()
      expect(cache.getStats().size).toBe(0)
    })

    it('should report maxSize', async () => {
      const { createCascadeChainCache } = await import('../cache/cascade-chain-cache')
      const customCache = createCascadeChainCache({ maxSize: 500 })

      expect(customCache.getStats().maxSize).toBe(500)
    })
  })
})

// ============================================================================
// CACHED ADAPTER TESTS (RED PHASE)
// ============================================================================

describe('CachedFunctionGraphAdapter (RED Phase)', () => {
  let store: SQLiteGraphStore
  let cachedAdapter: CachedFunctionGraphAdapter & FunctionGraphAdapter

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()

    // This import will FAIL until CachedFunctionGraphAdapter is implemented
    const { createCachedFunctionGraphAdapter } = await import('../adapters/cached-function-graph-adapter')
    cachedAdapter = createCachedFunctionGraphAdapter(store, { maxSize: 100 })
  })

  afterEach(async () => {
    await store.close()
  })

  describe('Query Reduction', () => {
    it('should reduce 4+ queries to 1 for repeated cascade lookups', async () => {
      // Create full cascade chain
      const code = await cachedAdapter.createFunction({ name: 'reduce-code', type: 'code' })
      const gen = await cachedAdapter.createFunction({ name: 'reduce-gen', type: 'generative' })
      const agent = await cachedAdapter.createFunction({ name: 'reduce-agent', type: 'agentic' })
      const human = await cachedAdapter.createFunction({ name: 'reduce-human', type: 'human' })

      await cachedAdapter.addCascade(code.id, gen.id, { priority: 1 })
      await cachedAdapter.addCascade(gen.id, agent.id, { priority: 1 })
      await cachedAdapter.addCascade(agent.id, human.id, { priority: 1 })

      // Reset query count before test
      cachedAdapter.resetQueryCount()

      // First call - should hit database (4+ queries for chain traversal)
      const chain1 = await cachedAdapter.getCascadeChainCached(code.id)
      expect(chain1).toHaveLength(4)
      const firstCallQueries = cachedAdapter.getQueryCount()
      expect(firstCallQueries).toBeGreaterThanOrEqual(4) // At least 4 queries for 4-level chain

      // Reset query count
      cachedAdapter.resetQueryCount()

      // Second call - should use cache (0 database queries)
      const chain2 = await cachedAdapter.getCascadeChainCached(code.id)
      expect(chain2).toHaveLength(4)
      const secondCallQueries = cachedAdapter.getQueryCount()
      expect(secondCallQueries).toBe(0) // No database queries - all from cache
    })

    it('should cache deep cascade chains efficiently', async () => {
      // Create a 10-level chain
      const functions: GraphThing[] = []
      const types: ('code' | 'generative' | 'agentic' | 'human')[] = ['code', 'generative', 'agentic', 'human']

      for (let i = 0; i < 10; i++) {
        const type = types[i % 4]!
        const fn = await cachedAdapter.createFunction({ name: `deep-${i}`, type })
        functions.push(fn)
      }

      // Link them in a chain
      for (let i = 0; i < functions.length - 1; i++) {
        await cachedAdapter.addCascade(functions[i]!.id, functions[i + 1]!.id, { priority: i })
      }

      cachedAdapter.resetQueryCount()

      // First call
      const chain1 = await cachedAdapter.getCascadeChainCached(functions[0]!.id)
      expect(chain1).toHaveLength(10)
      const firstQueries = cachedAdapter.getQueryCount()
      expect(firstQueries).toBeGreaterThanOrEqual(10)

      cachedAdapter.resetQueryCount()

      // Second call - should be fully cached
      const chain2 = await cachedAdapter.getCascadeChainCached(functions[0]!.id)
      expect(chain2).toHaveLength(10)
      expect(cachedAdapter.getQueryCount()).toBe(0)
    })
  })

  describe('Cache Integration', () => {
    it('should expose cache instance', async () => {
      const cache = cachedAdapter.getCache()
      expect(cache).toBeDefined()
      expect(typeof cache.get).toBe('function')
      expect(typeof cache.set).toBe('function')
      expect(typeof cache.clear).toBe('function')
    })

    it('should invalidate cache when function is updated', async () => {
      const code = await cachedAdapter.createFunction({ name: 'update-test', type: 'code' })
      const gen = await cachedAdapter.createFunction({ name: 'update-test', type: 'generative' })

      await cachedAdapter.addCascade(code.id, gen.id, { priority: 1 })

      // Populate cache
      await cachedAdapter.getCascadeChainCached(code.id)

      // Verify cached
      expect(cachedAdapter.getCache().get(code.id)).not.toBeNull()

      // Update function in chain
      await cachedAdapter.updateFunction(gen.id, { description: 'updated' })

      // Cache should be invalidated
      expect(cachedAdapter.getCache().get(code.id)).toBeNull()
    })

    it('should invalidate cache when cascade is added', async () => {
      const code = await cachedAdapter.createFunction({ name: 'add-cascade', type: 'code' })
      const gen = await cachedAdapter.createFunction({ name: 'add-cascade', type: 'generative' })
      const agent = await cachedAdapter.createFunction({ name: 'add-cascade', type: 'agentic' })

      await cachedAdapter.addCascade(code.id, gen.id, { priority: 1 })

      // Populate cache
      const chain1 = await cachedAdapter.getCascadeChainCached(code.id)
      expect(chain1).toHaveLength(2)

      // Add new cascade
      await cachedAdapter.addCascade(gen.id, agent.id, { priority: 1 })

      // Cache should be invalidated
      expect(cachedAdapter.getCache().get(code.id)).toBeNull()

      // New chain should include the new cascade
      const chain2 = await cachedAdapter.getCascadeChainCached(code.id)
      expect(chain2).toHaveLength(3)
    })

    it('should invalidate cache when cascade is removed', async () => {
      const code = await cachedAdapter.createFunction({ name: 'remove-cascade', type: 'code' })
      const gen = await cachedAdapter.createFunction({ name: 'remove-cascade', type: 'generative' })
      const agent = await cachedAdapter.createFunction({ name: 'remove-cascade', type: 'agentic' })

      await cachedAdapter.addCascade(code.id, gen.id, { priority: 1 })
      await cachedAdapter.addCascade(gen.id, agent.id, { priority: 1 })

      // Populate cache
      const chain1 = await cachedAdapter.getCascadeChainCached(code.id)
      expect(chain1).toHaveLength(3)

      // Remove cascade
      await cachedAdapter.removeCascade(gen.id, agent.id)

      // Cache should be invalidated
      expect(cachedAdapter.getCache().get(code.id)).toBeNull()

      // New chain should reflect removed cascade
      const chain2 = await cachedAdapter.getCascadeChainCached(code.id)
      expect(chain2).toHaveLength(2)
    })

    it('should invalidate cache when function is deleted', async () => {
      const code = await cachedAdapter.createFunction({ name: 'delete-test', type: 'code' })
      const gen = await cachedAdapter.createFunction({ name: 'delete-test', type: 'generative' })

      await cachedAdapter.addCascade(code.id, gen.id, { priority: 1 })

      // Populate cache
      await cachedAdapter.getCascadeChainCached(code.id)
      expect(cachedAdapter.getCache().get(code.id)).not.toBeNull()

      // Delete function
      await cachedAdapter.deleteFunction(gen.id)

      // Cache should be invalidated
      expect(cachedAdapter.getCache().get(code.id)).toBeNull()
    })
  })

  describe('Concurrent Access', () => {
    it('should handle concurrent cache accesses safely', async () => {
      const code = await cachedAdapter.createFunction({ name: 'concurrent', type: 'code' })
      const gen = await cachedAdapter.createFunction({ name: 'concurrent', type: 'generative' })

      await cachedAdapter.addCascade(code.id, gen.id, { priority: 1 })

      // Make 100 concurrent requests
      const requests = Array(100)
        .fill(null)
        .map(() => cachedAdapter.getCascadeChainCached(code.id))

      const results = await Promise.all(requests)

      // All should return the same chain
      for (const chain of results) {
        expect(chain).toHaveLength(2)
        expect(chain[0]!.id).toBe(code.id)
        expect(chain[1]!.id).toBe(gen.id)
      }
    })

    it('should prevent cache stampede', async () => {
      const code = await cachedAdapter.createFunction({ name: 'stampede', type: 'code' })
      const gen = await cachedAdapter.createFunction({ name: 'stampede', type: 'generative' })

      await cachedAdapter.addCascade(code.id, gen.id, { priority: 1 })

      cachedAdapter.resetQueryCount()

      // Clear cache to force miss
      cachedAdapter.getCache().clear()

      // Make concurrent requests while cache is cold
      const requests = Array(10)
        .fill(null)
        .map(() => cachedAdapter.getCascadeChainCached(code.id))

      await Promise.all(requests)

      // Should only have queried once (not 10 times)
      // Cache stampede prevention means first request populates cache,
      // others wait for it rather than all hitting DB
      const queryCount = cachedAdapter.getQueryCount()
      expect(queryCount).toBeLessThanOrEqual(4) // Only one chain resolution
    })
  })
})

// ============================================================================
// INTEGRATION TESTS (RED PHASE)
// ============================================================================

describe('Cascade Chain Cache Integration (RED Phase)', () => {
  let store: SQLiteGraphStore
  let cachedAdapter: CachedFunctionGraphAdapter & FunctionGraphAdapter

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()

    const { createCachedFunctionGraphAdapter } = await import('../adapters/cached-function-graph-adapter')
    cachedAdapter = createCachedFunctionGraphAdapter(store, { maxSize: 100 })
  })

  afterEach(async () => {
    await store.close()
  })

  describe('End-to-End Performance', () => {
    it('should significantly reduce query time for repeated lookups', async () => {
      // Create a realistic cascade chain
      const code = await cachedAdapter.createFunction({ name: 'perf-code', type: 'code' })
      const gen = await cachedAdapter.createFunction({ name: 'perf-gen', type: 'generative' })
      const agent = await cachedAdapter.createFunction({ name: 'perf-agent', type: 'agentic' })
      const human = await cachedAdapter.createFunction({ name: 'perf-human', type: 'human' })

      await cachedAdapter.addCascade(code.id, gen.id, { priority: 1 })
      await cachedAdapter.addCascade(gen.id, agent.id, { priority: 1 })
      await cachedAdapter.addCascade(agent.id, human.id, { priority: 1 })

      // First lookup (cache miss)
      const start1 = performance.now()
      await cachedAdapter.getCascadeChainCached(code.id)
      const firstLookupTime = performance.now() - start1

      // Multiple cached lookups
      const cachedTimes: number[] = []
      for (let i = 0; i < 100; i++) {
        const start = performance.now()
        await cachedAdapter.getCascadeChainCached(code.id)
        cachedTimes.push(performance.now() - start)
      }

      const avgCachedTime = cachedTimes.reduce((a, b) => a + b, 0) / cachedTimes.length

      // Cached lookups should be significantly faster
      // We expect at least 10x improvement for in-memory cache
      expect(avgCachedTime).toBeLessThan(firstLookupTime / 2)
    })

    it('should maintain correctness after cache operations', async () => {
      const code = await cachedAdapter.createFunction({ name: 'correct-code', type: 'code' })
      const gen = await cachedAdapter.createFunction({ name: 'correct-gen', type: 'generative' })
      const agent = await cachedAdapter.createFunction({ name: 'correct-agent', type: 'agentic' })

      await cachedAdapter.addCascade(code.id, gen.id, { priority: 1 })

      // Get chain (2 items)
      const chain1 = await cachedAdapter.getCascadeChainCached(code.id)
      expect(chain1).toHaveLength(2)

      // Add to chain
      await cachedAdapter.addCascade(gen.id, agent.id, { priority: 1 })

      // Get updated chain (3 items)
      const chain2 = await cachedAdapter.getCascadeChainCached(code.id)
      expect(chain2).toHaveLength(3)

      // Remove from chain
      await cachedAdapter.removeCascade(gen.id, agent.id)

      // Get updated chain (back to 2 items)
      const chain3 = await cachedAdapter.getCascadeChainCached(code.id)
      expect(chain3).toHaveLength(2)
    })
  })

  describe('Memory Pressure', () => {
    it('should handle large number of cached chains', async () => {
      // Create 50 separate chains
      const chainStarts: string[] = []

      for (let i = 0; i < 50; i++) {
        const code = await cachedAdapter.createFunction({ name: `memory-code-${i}`, type: 'code' })
        const gen = await cachedAdapter.createFunction({ name: `memory-gen-${i}`, type: 'generative' })
        await cachedAdapter.addCascade(code.id, gen.id, { priority: 1 })
        chainStarts.push(code.id)
      }

      // Cache all chains
      for (const startId of chainStarts) {
        await cachedAdapter.getCascadeChainCached(startId)
      }

      // Verify all are cached
      const cache = cachedAdapter.getCache()
      const stats = cache.getStats()

      // With maxSize: 100, all 50 should fit
      expect(stats.size).toBe(50)

      // Verify correctness
      for (const startId of chainStarts) {
        const cached = cache.get(startId)
        expect(cached).not.toBeNull()
        expect(cached!.chain).toHaveLength(2)
      }
    })

    it('should evict entries when exceeding capacity', async () => {
      // Create adapter with small cache
      const { createCachedFunctionGraphAdapter } = await import('../adapters/cached-function-graph-adapter')
      const smallCacheAdapter = createCachedFunctionGraphAdapter(store, { maxSize: 10 })

      // Create 20 chains
      const chainStarts: string[] = []

      for (let i = 0; i < 20; i++) {
        const code = await smallCacheAdapter.createFunction({ name: `evict-code-${i}`, type: 'code' })
        const gen = await smallCacheAdapter.createFunction({ name: `evict-gen-${i}`, type: 'generative' })
        await smallCacheAdapter.addCascade(code.id, gen.id, { priority: 1 })
        chainStarts.push(code.id)
      }

      // Cache all chains
      for (const startId of chainStarts) {
        await smallCacheAdapter.getCascadeChainCached(startId)
      }

      // Should have evicted oldest entries
      const stats = smallCacheAdapter.getCache().getStats()
      expect(stats.size).toBe(10)

      // Most recent entries should be cached
      const recentStarts = chainStarts.slice(-10)
      for (const startId of recentStarts) {
        const cached = smallCacheAdapter.getCache().get(startId)
        expect(cached).not.toBeNull()
      }
    })
  })
})

// ============================================================================
// BACKWARD COMPATIBILITY TESTS (RED PHASE)
// ============================================================================

describe('Backward Compatibility (RED Phase)', () => {
  let store: SQLiteGraphStore
  let cachedAdapter: CachedFunctionGraphAdapter & FunctionGraphAdapter

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()

    const { createCachedFunctionGraphAdapter } = await import('../adapters/cached-function-graph-adapter')
    cachedAdapter = createCachedFunctionGraphAdapter(store, { maxSize: 100 })
  })

  afterEach(async () => {
    await store.close()
  })

  it('should maintain FunctionGraphAdapter interface compatibility', async () => {
    // All existing FunctionGraphAdapter methods should work
    const fn = await cachedAdapter.createFunction({ name: 'compat', type: 'code' })
    expect(fn).toBeDefined()

    const retrieved = await cachedAdapter.getFunction(fn.id)
    expect(retrieved).toBeDefined()

    const updated = await cachedAdapter.updateFunction(fn.id, { description: 'test' })
    expect(updated).toBeDefined()

    const fn2 = await cachedAdapter.createFunction({ name: 'compat2', type: 'generative' })
    const rel = await cachedAdapter.addCascade(fn.id, fn2.id, { priority: 1 })
    expect(rel).toBeDefined()

    const targets = await cachedAdapter.getCascadeTargets(fn.id)
    expect(targets).toHaveLength(1)

    // Original getCascadeChain should still work (uncached)
    const chain = await cachedAdapter.getCascadeChain(fn.id)
    expect(chain).toHaveLength(2)

    // New cached method should also work
    const cachedChain = await cachedAdapter.getCascadeChainCached(fn.id)
    expect(cachedChain).toHaveLength(2)
  })

  it('should work with existing relationship query methods', async () => {
    const fn1 = await cachedAdapter.createFunction({ name: 'query1', type: 'code' })
    const fn2 = await cachedAdapter.createFunction({ name: 'query2', type: 'generative' })

    await cachedAdapter.addCascade(fn1.id, fn2.id, { priority: 1 })

    // Existing query methods should work
    const sources = await cachedAdapter.getCascadeSources(fn2.id)
    expect(sources).toHaveLength(1)
    expect(sources[0]!.id).toBe(fn1.id)

    const hasCycle = await cachedAdapter.hasCascadeCycle(fn1.id)
    expect(hasCycle).toBe(false)
  })
})
