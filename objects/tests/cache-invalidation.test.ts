/**
 * DO Cache Invalidation Tests
 *
 * RED TDD: These tests should FAIL because DOCache doesn't exist yet.
 *
 * This file defines the expected behavior for cache invalidation across Durable Objects.
 * The cache layer sits between application code and DO storage, providing:
 * - TTL-based expiration
 * - Event-based invalidation
 * - Write-through caching
 * - Cross-DO invalidation messaging
 * - Cache warming strategies
 * - Observability metrics
 *
 * Test Categories:
 * 1. TTL-Based Invalidation - Time-based expiration
 * 2. Event-Based Invalidation - Dependency tracking and cascade
 * 3. Write-Through Caching - Consistent writes
 * 4. Cache Consistency - Read-your-writes, eventual consistency
 * 5. Cache Warming - Preload strategies
 * 6. Metrics & Observability - Hit/miss tracking
 *
 * Target: 18+ test cases (all failing until implementation)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// These imports will FAIL - implementation doesn't exist yet
import {
  DOCache,
  type CacheOptions,
  type CacheEntry,
  type CacheConfig,
  type CacheStats,
  type InvalidationEvent,
  type CacheDependency,
  type ConsistencyLevel,
  type WarmingStrategy,
  CacheExpiredError,
  CacheInvalidatedError,
  CacheMissError,
  ETagMismatchError,
} from '../DOCache'

// ============================================================================
// TYPE DEFINITIONS (for test clarity)
// ============================================================================

/**
 * Expected cache entry structure
 */
interface ExpectedCacheEntry<T = unknown> {
  key: string
  value: T
  ttl: number
  expiresAt: number
  createdAt: number
  lastAccessedAt: number
  etag: string
  dependencies: string[]
  metadata: Record<string, unknown>
}

/**
 * Expected cache statistics structure
 */
interface ExpectedCacheStats {
  hits: number
  misses: number
  hitRatio: number
  evictions: number
  size: number
  avgLatencyMs: {
    hit: number
    miss: number
    write: number
  }
}

/**
 * Expected invalidation event structure
 */
interface ExpectedInvalidationEvent {
  type: 'write' | 'delete' | 'expire' | 'cascade' | 'manual'
  key: string
  source: string
  timestamp: number
  cascadeKeys?: string[]
  reason?: string
}

// ============================================================================
// MOCK HELPERS
// ============================================================================

function createMockStorage() {
  const storage = new Map<string, unknown>()

  return {
    storage: {
      get: vi.fn(async <T>(key: string): Promise<T | undefined> => storage.get(key) as T | undefined),
      put: vi.fn(async <T>(key: string, value: T): Promise<void> => {
        storage.set(key, value)
      }),
      delete: vi.fn(async (key: string): Promise<boolean> => storage.delete(key)),
      deleteAll: vi.fn(async (): Promise<void> => storage.clear()),
      list: vi.fn(async <T>(options?: { prefix?: string }): Promise<Map<string, T>> => {
        const result = new Map<string, T>()
        for (const [key, value] of storage) {
          if (options?.prefix && !key.startsWith(options.prefix)) continue
          result.set(key, value as T)
        }
        return result
      }),
    },
    _storage: storage,
  }
}

function createMockState() {
  const { storage, _storage } = createMockStorage()
  return {
    id: {
      toString: () => 'test-cache-do-id',
      name: 'test-cache-do-id',
      equals: (other: { toString: () => string }) => other.toString() === 'test-cache-do-id',
    },
    storage,
    _storage,
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async (fn: () => Promise<void>) => fn()),
  } as unknown as DurableObjectState & { _storage: Map<string, unknown> }
}

function createMockEnv() {
  return {
    DO: {
      idFromName: vi.fn((name: string) => ({ toString: () => `id-for-${name}` })),
      get: vi.fn(() => ({
        fetch: vi.fn(async () => new Response(JSON.stringify({ ok: true }))),
      })),
    },
    PIPELINE: {
      send: vi.fn(),
    },
  }
}

// ============================================================================
// TEST SUITE: TTL-Based Invalidation
// ============================================================================

describe('TTL-Based Invalidation', () => {
  let mockState: ReturnType<typeof createMockState>
  let mockEnv: ReturnType<typeof createMockEnv>
  let cache: DOCache

  beforeEach(() => {
    vi.useFakeTimers()
    mockState = createMockState()
    mockEnv = createMockEnv()
    cache = new DOCache(mockState, mockEnv)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('cached value expires after TTL', async () => {
    // Set a value with 1 second TTL
    await cache.set('session:123', { userId: 'user-1' }, { ttl: 1000 })

    // Value should be available immediately
    const beforeExpiry = await cache.get('session:123')
    expect(beforeExpiry).toEqual({ userId: 'user-1' })

    // Advance time past TTL
    vi.advanceTimersByTime(1500)

    // Value should be expired
    const afterExpiry = await cache.get('session:123')
    expect(afterExpiry).toBeUndefined()
  })

  it('refresh extends TTL on access', async () => {
    // Set a value with 1 second TTL and refresh-on-read enabled
    await cache.set('session:456', { userId: 'user-2' }, { ttl: 1000, refreshOnRead: true })

    // Access at 500ms - should extend TTL
    vi.advanceTimersByTime(500)
    const accessed = await cache.get('session:456')
    expect(accessed).toEqual({ userId: 'user-2' })

    // Advance another 700ms (total 1200ms from start, but only 700ms since last access)
    vi.advanceTimersByTime(700)

    // Value should still be available (TTL was refreshed)
    const stillAvailable = await cache.get('session:456')
    expect(stillAvailable).toEqual({ userId: 'user-2' })

    // Advance past the refreshed TTL
    vi.advanceTimersByTime(1100)

    // Now it should be expired
    const expired = await cache.get('session:456')
    expect(expired).toBeUndefined()
  })

  it('configurable TTL per key', async () => {
    // Create cache with default TTL
    const configuredCache = new DOCache(mockState, mockEnv, { defaultTTL: 5000 })

    // Set key without explicit TTL - should use default
    await configuredCache.set('default-ttl', 'value1')

    // Set key with custom short TTL
    await configuredCache.set('short-ttl', 'value2', { ttl: 1000 })

    // Set key with custom long TTL
    await configuredCache.set('long-ttl', 'value3', { ttl: 10000 })

    // Advance 2 seconds
    vi.advanceTimersByTime(2000)

    // Short TTL should be expired
    expect(await configuredCache.get('short-ttl')).toBeUndefined()

    // Default TTL should still be valid
    expect(await configuredCache.get('default-ttl')).toBe('value1')

    // Long TTL should still be valid
    expect(await configuredCache.get('long-ttl')).toBe('value3')

    // Advance to 6 seconds total
    vi.advanceTimersByTime(4000)

    // Default TTL should now be expired
    expect(await configuredCache.get('default-ttl')).toBeUndefined()

    // Long TTL should still be valid
    expect(await configuredCache.get('long-ttl')).toBe('value3')
  })

  it('expired value returns undefined with clean semantics', async () => {
    await cache.set('temp-key', { data: 'temporary' }, { ttl: 500 })

    vi.advanceTimersByTime(600)

    // get() should return undefined, not throw
    const result = await cache.get('temp-key')
    expect(result).toBeUndefined()

    // has() should return false for expired keys
    const exists = await cache.has('temp-key')
    expect(exists).toBe(false)

    // getOrThrow() should throw a specific error
    await expect(cache.getOrThrow('temp-key')).rejects.toThrow(CacheExpiredError)
  })
})

// ============================================================================
// TEST SUITE: Event-Based Invalidation
// ============================================================================

describe('Event-Based Invalidation', () => {
  let mockState: ReturnType<typeof createMockState>
  let mockEnv: ReturnType<typeof createMockEnv>
  let cache: DOCache

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    cache = new DOCache(mockState, mockEnv)
  })

  it('invalidates on related write', async () => {
    // Cache a user profile with dependency on user data
    await cache.set('user:123:profile', { name: 'John', avatar: 'url' }, {
      dependencies: ['user:123'],
    })

    // Verify initial value
    expect(await cache.get('user:123:profile')).toEqual({ name: 'John', avatar: 'url' })

    // Write to dependent key - should invalidate the profile cache
    await cache.invalidateByDependency('user:123')

    // Profile should be invalidated
    expect(await cache.get('user:123:profile')).toBeUndefined()
  })

  it('cascade invalidation across related keys', async () => {
    // Set up a cache hierarchy with dependencies
    // org -> team -> user -> profile
    await cache.set('org:acme', { name: 'Acme Corp' })
    await cache.set('team:eng', { name: 'Engineering' }, { dependencies: ['org:acme'] })
    await cache.set('user:john', { name: 'John' }, { dependencies: ['team:eng'] })
    await cache.set('user:john:profile', { bio: 'Engineer' }, { dependencies: ['user:john'] })
    await cache.set('user:john:settings', { theme: 'dark' }, { dependencies: ['user:john'] })

    // Invalidate the org - should cascade to all dependent keys
    const cascadeResult = await cache.invalidateCascade('org:acme')

    // All dependent keys should be invalidated
    expect(await cache.get('org:acme')).toBeUndefined()
    expect(await cache.get('team:eng')).toBeUndefined()
    expect(await cache.get('user:john')).toBeUndefined()
    expect(await cache.get('user:john:profile')).toBeUndefined()
    expect(await cache.get('user:john:settings')).toBeUndefined()

    // Cascade result should report all invalidated keys
    expect(cascadeResult.invalidatedKeys).toContain('org:acme')
    expect(cascadeResult.invalidatedKeys).toContain('team:eng')
    expect(cascadeResult.invalidatedKeys).toContain('user:john')
    expect(cascadeResult.invalidatedKeys).toContain('user:john:profile')
    expect(cascadeResult.invalidatedKeys).toContain('user:john:settings')
    expect(cascadeResult.invalidatedKeys.length).toBe(5)
  })

  it('batch invalidation of multiple keys', async () => {
    // Set multiple cache entries
    await cache.set('item:1', { name: 'Item 1' })
    await cache.set('item:2', { name: 'Item 2' })
    await cache.set('item:3', { name: 'Item 3' })
    await cache.set('item:4', { name: 'Item 4' })

    // Batch invalidate specific keys
    const result = await cache.invalidateMany(['item:1', 'item:2', 'item:4'])

    // Invalidated keys should be gone
    expect(await cache.get('item:1')).toBeUndefined()
    expect(await cache.get('item:2')).toBeUndefined()
    expect(await cache.get('item:4')).toBeUndefined()

    // Non-invalidated key should remain
    expect(await cache.get('item:3')).toEqual({ name: 'Item 3' })

    // Result should report count
    expect(result.invalidatedCount).toBe(3)
  })

  it('invalidation across DOs via messaging', async () => {
    // Create two caches simulating different DOs
    const cache1State = createMockState()
    const cache2State = createMockState()
    const env = createMockEnv()

    const cache1 = new DOCache(cache1State, env, { namespace: 'do-1' })
    const cache2 = new DOCache(cache2State, env, { namespace: 'do-2' })

    // Set the same key in both caches
    await cache1.set('shared:config', { version: 1 })
    await cache2.set('shared:config', { version: 1 })

    // Invalidate across DOs using broadcast
    await cache1.broadcastInvalidation('shared:config', {
      targetNamespaces: ['do-2'],
    })

    // The env.DO.get should have been called to send invalidation message
    expect(env.DO.get).toHaveBeenCalled()

    // In a real scenario, cache2 would receive the invalidation via its fetch handler
    // For this test, we verify the broadcast was initiated
    expect(env.DO.get).toHaveBeenCalledWith(expect.anything())
  })
})

// ============================================================================
// TEST SUITE: Write-Through Caching
// ============================================================================

describe('Write-Through Caching', () => {
  let mockState: ReturnType<typeof createMockState>
  let mockEnv: ReturnType<typeof createMockEnv>
  let cache: DOCache

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    cache = new DOCache(mockState, mockEnv)
  })

  it('write updates cache immediately', async () => {
    // Use writeThrough to update both cache and storage
    await cache.writeThrough('user:123', { name: 'John', email: 'john@example.com' })

    // Cache should have the value immediately
    const cached = await cache.get('user:123')
    expect(cached).toEqual({ name: 'John', email: 'john@example.com' })

    // Storage should also have been updated
    expect(mockState.storage.put).toHaveBeenCalledWith(
      expect.stringContaining('user:123'),
      expect.anything()
    )
  })

  it('write invalidates stale related cache entries', async () => {
    // Set up related cache entries
    await cache.set('user:123:name', 'John Doe')
    await cache.set('user:123:displayName', 'JohnD')
    await cache.set('user:123:fullProfile', { name: 'John', role: 'admin' })

    // All are valid initially
    expect(await cache.get('user:123:name')).toBe('John Doe')
    expect(await cache.get('user:123:displayName')).toBe('JohnD')
    expect(await cache.get('user:123:fullProfile')).toEqual({ name: 'John', role: 'admin' })

    // Write to user:123 and invalidate related entries
    await cache.writeThrough('user:123', { name: 'Jane', email: 'jane@example.com' }, {
      invalidatePattern: 'user:123:*',
    })

    // Related entries should be invalidated
    expect(await cache.get('user:123:name')).toBeUndefined()
    expect(await cache.get('user:123:displayName')).toBeUndefined()
    expect(await cache.get('user:123:fullProfile')).toBeUndefined()

    // The written value should be available
    expect(await cache.get('user:123')).toEqual({ name: 'Jane', email: 'jane@example.com' })
  })

  it('conditional write on etag for optimistic locking', async () => {
    // Set initial value and get its etag
    const entry = await cache.setWithEtag('resource:1', { count: 0 })
    const initialEtag = entry.etag

    // First update with correct etag should succeed
    const updated = await cache.compareAndSwap('resource:1', { count: 1 }, initialEtag)
    expect(updated.value).toEqual({ count: 1 })
    expect(updated.etag).not.toBe(initialEtag)

    // Second update with stale etag should fail
    await expect(
      cache.compareAndSwap('resource:1', { count: 2 }, initialEtag)
    ).rejects.toThrow(ETagMismatchError)

    // Value should still be the result of first update
    expect(await cache.get('resource:1')).toEqual({ count: 1 })
  })
})

// ============================================================================
// TEST SUITE: Cache Consistency
// ============================================================================

describe('Cache Consistency', () => {
  let mockState: ReturnType<typeof createMockState>
  let mockEnv: ReturnType<typeof createMockEnv>
  let cache: DOCache

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    cache = new DOCache(mockState, mockEnv)
  })

  it('read-your-writes in same session', async () => {
    // Simulate a session context
    const sessionId = 'session-abc-123'

    // Write in session
    await cache.set('data:1', { value: 'written' }, { sessionId })

    // Immediate read in same session should see the write
    const result = await cache.get('data:1', { sessionId })
    expect(result).toEqual({ value: 'written' })

    // Even if there's a slight delay, same session should see its own writes
    await new Promise((resolve) => setTimeout(resolve, 10))
    const delayedResult = await cache.get('data:1', { sessionId })
    expect(delayedResult).toEqual({ value: 'written' })
  })

  it('eventual consistency window for cross-session reads', async () => {
    vi.useFakeTimers()

    // Configure cache with eventual consistency
    const eventualCache = new DOCache(mockState, mockEnv, {
      consistency: 'eventual',
      consistencyWindowMs: 100,
    })

    // Session A writes
    await eventualCache.set('shared:data', { version: 2 }, { sessionId: 'session-a' })

    // Session B reads immediately - may get stale value or undefined
    // (in eventual consistency, we don't guarantee immediate visibility)
    const immediateRead = await eventualCache.get('shared:data', {
      sessionId: 'session-b',
      allowStale: true,
    })

    // After consistency window, Session B should see the update
    vi.advanceTimersByTime(150)
    const afterWindowRead = await eventualCache.get('shared:data', { sessionId: 'session-b' })
    expect(afterWindowRead).toEqual({ version: 2 })

    vi.useRealTimers()
  })

  it('strong consistency option forces fresh read', async () => {
    // Set initial cached value
    await cache.set('critical:data', { value: 'cached' })

    // Simulate storage being updated externally (bypassing cache)
    mockState._storage.set('critical:data', {
      value: { value: 'updated-in-storage' },
      metadata: { updatedAt: Date.now() },
    })

    // Regular read returns cached value
    const cachedRead = await cache.get('critical:data')
    expect(cachedRead).toEqual({ value: 'cached' })

    // Strong consistency read bypasses cache and reads from storage
    const freshRead = await cache.get('critical:data', { consistency: 'strong' })
    expect(freshRead).toEqual({ value: 'updated-in-storage' })
  })
})

// ============================================================================
// TEST SUITE: Cache Warming
// ============================================================================

describe('Cache Warming', () => {
  let mockState: ReturnType<typeof createMockState>
  let mockEnv: ReturnType<typeof createMockEnv>
  let cache: DOCache

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    cache = new DOCache(mockState, mockEnv)
  })

  it('preloads on first access (lazy warming)', async () => {
    // Configure cache with a loader function
    const loader = vi.fn(async (key: string) => {
      // Simulate loading from external source
      if (key === 'user:123') {
        return { name: 'John', email: 'john@example.com' }
      }
      return null
    })

    const warmingCache = new DOCache(mockState, mockEnv, {
      loader,
    })

    // First access triggers loader
    const result = await warmingCache.get('user:123')
    expect(result).toEqual({ name: 'John', email: 'john@example.com' })
    expect(loader).toHaveBeenCalledWith('user:123')

    // Second access should hit cache, not loader
    loader.mockClear()
    const cachedResult = await warmingCache.get('user:123')
    expect(cachedResult).toEqual({ name: 'John', email: 'john@example.com' })
    expect(loader).not.toHaveBeenCalled()
  })

  it('bulk preload for batch warming', async () => {
    // Define keys to preload
    const keysToWarm = ['config:app', 'config:feature-flags', 'config:limits']

    // Bulk loader function
    const bulkLoader = vi.fn(async (keys: string[]) => {
      return new Map([
        ['config:app', { name: 'MyApp', version: '1.0' }],
        ['config:feature-flags', { darkMode: true, beta: false }],
        ['config:limits', { maxItems: 100, maxSize: 1024 }],
      ])
    })

    const warmingCache = new DOCache(mockState, mockEnv, {
      bulkLoader,
    })

    // Warm the cache with multiple keys at once
    await warmingCache.warmMany(keysToWarm)

    expect(bulkLoader).toHaveBeenCalledWith(keysToWarm)

    // All keys should now be cached
    expect(await warmingCache.get('config:app')).toEqual({ name: 'MyApp', version: '1.0' })
    expect(await warmingCache.get('config:feature-flags')).toEqual({ darkMode: true, beta: false })
    expect(await warmingCache.get('config:limits')).toEqual({ maxItems: 100, maxSize: 1024 })

    // Loader should not be called again
    bulkLoader.mockClear()
    await warmingCache.get('config:app')
    expect(bulkLoader).not.toHaveBeenCalled()
  })

  it('selective warming based on access patterns (hot keys)', async () => {
    const warmingCache = new DOCache(mockState, mockEnv, {
      trackAccessPatterns: true,
      hotKeyThreshold: 3, // Key is "hot" if accessed 3+ times
    })

    // Simulate access patterns
    await warmingCache.set('popular:1', { data: 'popular' })
    await warmingCache.set('rare:1', { data: 'rarely accessed' })

    // Access popular key multiple times
    await warmingCache.get('popular:1')
    await warmingCache.get('popular:1')
    await warmingCache.get('popular:1')
    await warmingCache.get('popular:1')

    // Access rare key once
    await warmingCache.get('rare:1')

    // Get hot keys
    const hotKeys = await warmingCache.getHotKeys()
    expect(hotKeys).toContain('popular:1')
    expect(hotKeys).not.toContain('rare:1')

    // Warm only hot keys (useful on DO wake)
    const warmingLoader = vi.fn(async (keys: string[]) => {
      const result = new Map<string, unknown>()
      for (const key of keys) {
        result.set(key, { data: 'reloaded' })
      }
      return result
    })

    await warmingCache.warmHotKeys(warmingLoader)

    // Only hot keys should have been loaded
    expect(warmingLoader).toHaveBeenCalledWith(['popular:1'])
  })
})

// ============================================================================
// TEST SUITE: Metrics & Observability
// ============================================================================

describe('Metrics & Observability', () => {
  let mockState: ReturnType<typeof createMockState>
  let mockEnv: ReturnType<typeof createMockEnv>
  let cache: DOCache

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    cache = new DOCache(mockState, mockEnv, { enableMetrics: true })
  })

  it('tracks hit/miss ratio', async () => {
    // Set some values
    await cache.set('exists:1', 'value1')
    await cache.set('exists:2', 'value2')

    // Generate hits
    await cache.get('exists:1')
    await cache.get('exists:2')
    await cache.get('exists:1')

    // Generate misses
    await cache.get('missing:1')
    await cache.get('missing:2')

    // Get stats
    const stats = await cache.getStats()

    expect(stats.hits).toBe(3)
    expect(stats.misses).toBe(2)
    expect(stats.hitRatio).toBeCloseTo(0.6, 2) // 3/5 = 0.6
  })

  it('tracks eviction count', async () => {
    // Create cache with small max size
    const smallCache = new DOCache(mockState, mockEnv, {
      maxSize: 3,
      evictionPolicy: 'lru',
      enableMetrics: true,
    })

    // Fill the cache
    await smallCache.set('item:1', 'value1')
    await smallCache.set('item:2', 'value2')
    await smallCache.set('item:3', 'value3')

    // This should trigger eviction
    await smallCache.set('item:4', 'value4')
    await smallCache.set('item:5', 'value5')

    const stats = await smallCache.getStats()

    // Should have evicted 2 items
    expect(stats.evictions).toBe(2)
    expect(stats.size).toBe(3)
  })

  it('tracks latency by cache state', async () => {
    // Use real timers with actual latency tracking
    // (Fake timers don't work well with async operations that use setTimeout)

    // Configure loader with minimal delay for misses
    const slowLoader = async (key: string) => {
      // Simulate slow external fetch for cache miss
      await new Promise((resolve) => setTimeout(resolve, 60))
      return { loaded: true }
    }

    const metricCache = new DOCache(mockState, mockEnv, {
      loader: slowLoader,
      enableMetrics: true,
    })

    // Cache hit (fast)
    await metricCache.set('fast:key', { cached: true })
    await metricCache.get('fast:key')

    // Cache miss with loader (slow) - uses real timing
    await metricCache.get('slow:key')

    // Write operation
    await metricCache.set('new:key', { written: true })

    const stats = await metricCache.getStats()

    // Hit latency should be very low (less than 50ms)
    expect(stats.avgLatencyMs.hit).toBeLessThan(50)

    // Miss latency should include loader time (60ms delay)
    expect(stats.avgLatencyMs.miss).toBeGreaterThan(50)

    // Write latency should be low
    expect(stats.avgLatencyMs.write).toBeLessThan(50)
  })

  it('emits invalidation events for observability', async () => {
    const invalidationEvents: InvalidationEvent[] = []

    // Subscribe to invalidation events
    cache.onInvalidation((event: InvalidationEvent) => {
      invalidationEvents.push(event)
    })

    // Trigger various invalidations
    await cache.set('key:1', 'value1')
    await cache.set('key:2', 'value2', { dependencies: ['key:1'] })

    await cache.invalidate('key:1')
    await cache.invalidateCascade('key:1')

    // Should have recorded invalidation events
    expect(invalidationEvents.length).toBeGreaterThan(0)
    expect(invalidationEvents.some((e) => e.type === 'manual')).toBe(true)
    expect(invalidationEvents.some((e) => e.type === 'cascade')).toBe(true)
  })
})

// ============================================================================
// TEST SUITE: Edge Cases & Error Handling
// ============================================================================

describe('Edge Cases & Error Handling', () => {
  let mockState: ReturnType<typeof createMockState>
  let mockEnv: ReturnType<typeof createMockEnv>
  let cache: DOCache

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    cache = new DOCache(mockState, mockEnv)
  })

  it('handles concurrent writes to same key', async () => {
    // Simulate concurrent writes
    const writes = Promise.all([
      cache.set('concurrent:key', { writer: 'A', timestamp: 1 }),
      cache.set('concurrent:key', { writer: 'B', timestamp: 2 }),
      cache.set('concurrent:key', { writer: 'C', timestamp: 3 }),
    ])

    await writes

    // One of the writes should win (last-write-wins by default)
    const result = await cache.get('concurrent:key')
    expect(result).toBeDefined()
    expect(['A', 'B', 'C']).toContain((result as { writer: string }).writer)
  })

  it('handles storage failures gracefully', async () => {
    // Make storage fail
    mockState.storage.put = vi.fn().mockRejectedValue(new Error('Storage unavailable'))

    // Write should propagate the error
    await expect(cache.set('failing:key', 'value')).rejects.toThrow('Storage unavailable')

    // Cache should remain in consistent state (no partial writes)
    expect(await cache.get('failing:key')).toBeUndefined()
  })

  it('handles circular dependencies in cascade invalidation', async () => {
    // Set up circular dependencies (should not infinite loop)
    await cache.set('a', 'value-a', { dependencies: ['c'] })
    await cache.set('b', 'value-b', { dependencies: ['a'] })
    await cache.set('c', 'value-c', { dependencies: ['b'] })

    // Cascade invalidation should detect cycle and terminate
    const result = await cache.invalidateCascade('a')

    // All should be invalidated without infinite loop
    expect(result.invalidatedKeys).toContain('a')
    expect(result.invalidatedKeys).toContain('b')
    expect(result.invalidatedKeys).toContain('c')
    expect(result.invalidatedKeys.length).toBe(3)
  })
})
