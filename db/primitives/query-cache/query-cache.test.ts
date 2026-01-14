/**
 * QueryCacheLayer Tests - TDD RED Phase
 *
 * Tests for the comprehensive query result caching layer that provides:
 * - Query fingerprinting for cache keys
 * - TTL-based expiration
 * - Event-driven invalidation (on data changes)
 * - Cache warming for common queries
 * - Multi-tier caching (memory, KV, R2)
 * - Cache partitioning by tenant
 * - Cache statistics and monitoring
 *
 * Integration with Cloudflare:
 * - Workers KV for hot cache
 * - R2 for large result sets
 * - Durable Objects for coordination
 *
 * @see dotdo-si6zj
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  QueryCacheLayer,
  type QueryCacheConfig,
  type CacheTier,
  type CacheEntry,
  type QueryFingerprint,
  type InvalidationEvent,
  type CacheStats,
  type TenantConfig,
  type WarmingConfig,
  fingerprintQuery,
  parseFingerprint,
  CacheExpiredError,
  CacheMissError,
  CacheInvalidatedError,
  TenantIsolationError,
} from './index'

// =============================================================================
// MOCK HELPERS
// =============================================================================

function createMockKV() {
  const store = new Map<string, { value: unknown; metadata?: Record<string, unknown> }>()

  return {
    get: vi.fn(async <T>(key: string, options?: { type?: string }): Promise<T | null> => {
      const entry = store.get(key)
      if (!entry) return null
      if (options?.type === 'json') return entry.value as T
      return entry.value as T
    }),
    put: vi.fn(async (key: string, value: unknown, options?: { expirationTtl?: number; metadata?: Record<string, unknown> }): Promise<void> => {
      store.set(key, { value, metadata: options?.metadata })
    }),
    delete: vi.fn(async (key: string): Promise<void> => {
      store.delete(key)
    }),
    list: vi.fn(async (options?: { prefix?: string }): Promise<{ keys: { name: string }[] }> => {
      const keys: { name: string }[] = []
      for (const [name] of store) {
        if (!options?.prefix || name.startsWith(options.prefix)) {
          keys.push({ name })
        }
      }
      return { keys }
    }),
    _store: store,
  }
}

function createMockR2() {
  const store = new Map<string, { body: unknown; metadata?: Record<string, unknown> }>()

  return {
    get: vi.fn(async (key: string): Promise<{ json: () => Promise<unknown>; customMetadata: Record<string, unknown> } | null> => {
      const entry = store.get(key)
      if (!entry) return null
      return {
        json: async () => entry.body,
        customMetadata: entry.metadata || {},
      }
    }),
    put: vi.fn(async (key: string, body: unknown, options?: { customMetadata?: Record<string, unknown> }): Promise<void> => {
      store.set(key, {
        body: typeof body === 'string' ? JSON.parse(body) : body,
        metadata: options?.customMetadata,
      })
    }),
    delete: vi.fn(async (key: string): Promise<void> => {
      store.delete(key)
    }),
    list: vi.fn(async (options?: { prefix?: string }): Promise<{ objects: { key: string }[] }> => {
      const objects: { key: string }[] = []
      for (const [key] of store) {
        if (!options?.prefix || key.startsWith(options.prefix)) {
          objects.push({ key })
        }
      }
      return { objects }
    }),
    _store: store,
  }
}

function createMockEnv() {
  return {
    CACHE_KV: createMockKV(),
    CACHE_R2: createMockR2(),
    DO: {
      idFromName: vi.fn((name: string) => ({ toString: () => `id-for-${name}` })),
      get: vi.fn(() => ({
        fetch: vi.fn(async () => new Response(JSON.stringify({ ok: true }))),
      })),
    },
  }
}

// =============================================================================
// TEST SUITE: Query Fingerprinting
// =============================================================================

describe('Query Fingerprinting', () => {
  it('generates consistent fingerprint for identical queries', () => {
    const query1 = {
      sql: 'SELECT * FROM users WHERE status = ?',
      params: ['active'],
    }
    const query2 = {
      sql: 'SELECT * FROM users WHERE status = ?',
      params: ['active'],
    }

    const fp1 = fingerprintQuery(query1)
    const fp2 = fingerprintQuery(query2)

    expect(fp1).toBe(fp2)
  })

  it('generates different fingerprints for different params', () => {
    const query1 = {
      sql: 'SELECT * FROM users WHERE status = ?',
      params: ['active'],
    }
    const query2 = {
      sql: 'SELECT * FROM users WHERE status = ?',
      params: ['inactive'],
    }

    const fp1 = fingerprintQuery(query1)
    const fp2 = fingerprintQuery(query2)

    expect(fp1).not.toBe(fp2)
  })

  it('generates different fingerprints for different SQL', () => {
    const query1 = { sql: 'SELECT * FROM users', params: [] }
    const query2 = { sql: 'SELECT * FROM orders', params: [] }

    const fp1 = fingerprintQuery(query1)
    const fp2 = fingerprintQuery(query2)

    expect(fp1).not.toBe(fp2)
  })

  it('includes tenant context in fingerprint', () => {
    const query = { sql: 'SELECT * FROM users', params: [] }

    const fp1 = fingerprintQuery(query, { tenantId: 'tenant-a' })
    const fp2 = fingerprintQuery(query, { tenantId: 'tenant-b' })

    expect(fp1).not.toBe(fp2)
  })

  it('parses fingerprint back to components', () => {
    const query = {
      sql: 'SELECT * FROM users WHERE id = ?',
      params: ['123'],
    }
    const fp = fingerprintQuery(query, { tenantId: 'tenant-a' })
    const parsed = parseFingerprint(fp)

    expect(parsed.tenantId).toBe('tenant-a')
    expect(parsed.queryHash).toBeDefined()
  })

  it('normalizes SQL whitespace for fingerprinting', () => {
    const query1 = { sql: 'SELECT * FROM users', params: [] }
    const query2 = { sql: 'SELECT  *  FROM  users', params: [] }

    const fp1 = fingerprintQuery(query1)
    const fp2 = fingerprintQuery(query2)

    expect(fp1).toBe(fp2)
  })
})

// =============================================================================
// TEST SUITE: TTL-Based Expiration
// =============================================================================

describe('TTL-Based Expiration', () => {
  let cache: QueryCacheLayer
  let mockEnv: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    vi.useFakeTimers()
    mockEnv = createMockEnv()
    cache = new QueryCacheLayer({
      kv: mockEnv.CACHE_KV,
      r2: mockEnv.CACHE_R2,
      defaultTTL: 60000, // 1 minute
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns cached value within TTL', async () => {
    const query = { sql: 'SELECT * FROM users', params: [] }
    const result = { data: [{ id: 1, name: 'John' }] }

    await cache.set(query, result)
    const cached = await cache.get(query)

    expect(cached).toEqual(result)
  })

  it('returns undefined after TTL expires', async () => {
    const query = { sql: 'SELECT * FROM users', params: [] }
    const result = { data: [{ id: 1 }] }

    await cache.set(query, result, { ttl: 30000 }) // 30 seconds

    vi.advanceTimersByTime(35000) // Advance 35 seconds

    const cached = await cache.get(query)
    expect(cached).toBeUndefined()
  })

  it('supports per-query TTL override', async () => {
    const query1 = { sql: 'SELECT * FROM users', params: [] }
    const query2 = { sql: 'SELECT * FROM orders', params: [] }

    await cache.set(query1, { data: [] }, { ttl: 10000 }) // 10 seconds
    await cache.set(query2, { data: [] }, { ttl: 60000 }) // 60 seconds

    vi.advanceTimersByTime(15000) // 15 seconds

    expect(await cache.get(query1)).toBeUndefined()
    expect(await cache.get(query2)).toBeDefined()
  })

  it('uses default TTL when not specified', async () => {
    const query = { sql: 'SELECT * FROM users', params: [] }
    await cache.set(query, { data: [] })

    // Should still be valid after 30 seconds (default is 60s)
    vi.advanceTimersByTime(30000)
    expect(await cache.get(query)).toBeDefined()

    // Should be expired after 90 seconds
    vi.advanceTimersByTime(60000)
    expect(await cache.get(query)).toBeUndefined()
  })

  it('refreshes TTL on read when configured', async () => {
    const cacheWithRefresh = new QueryCacheLayer({
      kv: mockEnv.CACHE_KV,
      defaultTTL: 60000,
      refreshTTLOnRead: true,
    })

    const query = { sql: 'SELECT * FROM users', params: [] }
    await cacheWithRefresh.set(query, { data: [] }, { ttl: 30000 })

    // Access at 20 seconds - should refresh TTL
    vi.advanceTimersByTime(20000)
    await cacheWithRefresh.get(query)

    // At 40 seconds from start (20 seconds since refresh) - should still be valid
    vi.advanceTimersByTime(20000)
    expect(await cacheWithRefresh.get(query)).toBeDefined()

    // At 60 seconds from start - should still be valid (20s since last refresh)
    vi.advanceTimersByTime(20000)
    expect(await cacheWithRefresh.get(query)).toBeDefined()
  })
})

// =============================================================================
// TEST SUITE: Event-Driven Invalidation
// =============================================================================

describe('Event-Driven Invalidation', () => {
  let cache: QueryCacheLayer
  let mockEnv: ReturnType<typeof createMockEnv>
  let invalidationEvents: InvalidationEvent[]

  beforeEach(() => {
    mockEnv = createMockEnv()
    invalidationEvents = []
    cache = new QueryCacheLayer({
      kv: mockEnv.CACHE_KV,
      r2: mockEnv.CACHE_R2,
    })
    cache.onInvalidation((event) => invalidationEvents.push(event))
  })

  it('invalidates by table name', async () => {
    const usersQuery = { sql: 'SELECT * FROM users', params: [] }
    const ordersQuery = { sql: 'SELECT * FROM orders', params: [] }

    await cache.set(usersQuery, { data: [] }, { tables: ['users'] })
    await cache.set(ordersQuery, { data: [] }, { tables: ['orders'] })

    await cache.invalidateByTable('users')

    expect(await cache.get(usersQuery)).toBeUndefined()
    expect(await cache.get(ordersQuery)).toBeDefined()
  })

  it('invalidates by multiple tables', async () => {
    const joinQuery = {
      sql: 'SELECT * FROM users u JOIN orders o ON u.id = o.user_id',
      params: [],
    }

    await cache.set(joinQuery, { data: [] }, { tables: ['users', 'orders'] })

    // Invalidating either table should invalidate the query
    await cache.invalidateByTable('users')

    expect(await cache.get(joinQuery)).toBeUndefined()
  })

  it('invalidates by entity pattern', async () => {
    const user123Query = { sql: 'SELECT * FROM users WHERE id = ?', params: ['123'] }
    const user456Query = { sql: 'SELECT * FROM users WHERE id = ?', params: ['456'] }

    await cache.set(user123Query, { data: [] }, { entities: ['user:123'] })
    await cache.set(user456Query, { data: [] }, { entities: ['user:456'] })

    await cache.invalidateByEntity('user:123')

    expect(await cache.get(user123Query)).toBeUndefined()
    expect(await cache.get(user456Query)).toBeDefined()
  })

  it('emits invalidation events', async () => {
    const query = { sql: 'SELECT * FROM users', params: [] }
    await cache.set(query, { data: [] }, { tables: ['users'] })

    await cache.invalidateByTable('users')

    expect(invalidationEvents).toHaveLength(1)
    expect(invalidationEvents[0]?.type).toBe('table')
    expect(invalidationEvents[0]?.target).toBe('users')
  })

  it('supports cascade invalidation', async () => {
    // Parent query
    const parentQuery = { sql: 'SELECT * FROM organizations', params: [] }
    await cache.set(parentQuery, { data: [] }, {
      entities: ['org:acme'],
    })

    // Child queries dependent on parent
    const childQuery1 = { sql: 'SELECT * FROM users WHERE org_id = ?', params: ['acme'] }
    const childQuery2 = { sql: 'SELECT * FROM projects WHERE org_id = ?', params: ['acme'] }

    await cache.set(childQuery1, { data: [] }, {
      entities: ['org:acme:users'],
      dependsOn: ['org:acme'],
    })
    await cache.set(childQuery2, { data: [] }, {
      entities: ['org:acme:projects'],
      dependsOn: ['org:acme'],
    })

    // Invalidating parent should cascade to children
    await cache.invalidateCascade('org:acme')

    expect(await cache.get(parentQuery)).toBeUndefined()
    expect(await cache.get(childQuery1)).toBeUndefined()
    expect(await cache.get(childQuery2)).toBeUndefined()
  })

  it('invalidates by prefix pattern', async () => {
    const query1 = { sql: 'SELECT * FROM users WHERE status = ?', params: ['active'] }
    const query2 = { sql: 'SELECT * FROM users WHERE status = ?', params: ['inactive'] }
    const query3 = { sql: 'SELECT * FROM orders', params: [] }

    await cache.set(query1, { data: [] })
    await cache.set(query2, { data: [] })
    await cache.set(query3, { data: [] })

    // Invalidate all user queries
    await cache.invalidateByPrefix('SELECT * FROM users')

    expect(await cache.get(query1)).toBeUndefined()
    expect(await cache.get(query2)).toBeUndefined()
    expect(await cache.get(query3)).toBeDefined()
  })
})

// =============================================================================
// TEST SUITE: Cache Warming
// =============================================================================

describe('Cache Warming', () => {
  let cache: QueryCacheLayer
  let mockEnv: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    mockEnv = createMockEnv()
    cache = new QueryCacheLayer({
      kv: mockEnv.CACHE_KV,
      r2: mockEnv.CACHE_R2,
    })
  })

  it('warms cache with provided queries', async () => {
    const queries = [
      { sql: 'SELECT * FROM users', params: [] },
      { sql: 'SELECT * FROM orders', params: [] },
    ]

    const loader = vi.fn(async (query: { sql: string; params: unknown[] }) => {
      if (query.sql.includes('users')) return { data: [{ id: 1 }] }
      return { data: [{ id: 2 }] }
    })

    await cache.warm(queries, loader)

    expect(loader).toHaveBeenCalledTimes(2)
    expect(await cache.get(queries[0]!)).toEqual({ data: [{ id: 1 }] })
    expect(await cache.get(queries[1]!)).toEqual({ data: [{ id: 2 }] })
  })

  it('skips warming for already cached queries', async () => {
    const query = { sql: 'SELECT * FROM users', params: [] }

    // Pre-populate cache
    await cache.set(query, { data: [{ id: 1 }] })

    const loader = vi.fn(async () => ({ data: [{ id: 2 }] }))

    await cache.warm([query], loader, { skipExisting: true })

    // Loader should not have been called
    expect(loader).not.toHaveBeenCalled()
    // Original value should remain
    expect(await cache.get(query)).toEqual({ data: [{ id: 1 }] })
  })

  it('tracks hot queries for automatic warming', async () => {
    const query = { sql: 'SELECT * FROM users', params: [] }

    // Access query multiple times
    await cache.set(query, { data: [] })
    await cache.get(query)
    await cache.get(query)
    await cache.get(query)
    await cache.get(query)

    const hotQueries = await cache.getHotQueries({ threshold: 3 })

    expect(hotQueries.length).toBeGreaterThanOrEqual(1)
    expect(hotQueries[0]?.query.sql).toBe('SELECT * FROM users')
  })

  it('supports scheduled warming', async () => {
    vi.useFakeTimers()

    const warmingConfig: WarmingConfig = {
      queries: [
        { sql: 'SELECT * FROM dashboard_stats', params: [] },
      ],
      interval: 60000, // Every minute
    }

    const loader = vi.fn(async () => ({ data: [] }))

    await cache.startScheduledWarming(warmingConfig, loader)

    // Should warm immediately
    expect(loader).toHaveBeenCalledTimes(1)

    // Should warm again after interval - advance time and flush promises
    await vi.advanceTimersByTimeAsync(60000)

    expect(loader).toHaveBeenCalledTimes(2)

    cache.stopScheduledWarming()
    vi.useRealTimers()
  })
})

// =============================================================================
// TEST SUITE: Multi-Tier Caching
// =============================================================================

describe('Multi-Tier Caching', () => {
  let cache: QueryCacheLayer
  let mockEnv: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    mockEnv = createMockEnv()
    cache = new QueryCacheLayer({
      kv: mockEnv.CACHE_KV,
      r2: mockEnv.CACHE_R2,
      tiers: ['memory', 'kv', 'r2'],
    })
  })

  it('stores in memory tier for small results', async () => {
    const query = { sql: 'SELECT * FROM users LIMIT 10', params: [] }
    const result = { data: [{ id: 1 }] }

    await cache.set(query, result, { tier: 'memory' })

    // Memory should have it
    expect(await cache.get(query)).toEqual(result)
    // KV should not be called
    expect(mockEnv.CACHE_KV.put).not.toHaveBeenCalled()
  })

  it('stores in KV tier for hot cache', async () => {
    const query = { sql: 'SELECT * FROM users', params: [] }
    const result = { data: Array(100).fill({ id: 1 }) }

    await cache.set(query, result, { tier: 'kv' })

    expect(mockEnv.CACHE_KV.put).toHaveBeenCalled()
    expect(await cache.get(query)).toEqual(result)
  })

  it('stores in R2 tier for large results', async () => {
    const query = { sql: 'SELECT * FROM large_table', params: [] }
    const result = { data: Array(10000).fill({ id: 1, data: 'x'.repeat(1000) }) }

    await cache.set(query, result, { tier: 'r2' })

    expect(mockEnv.CACHE_R2.put).toHaveBeenCalled()
    expect(await cache.get(query)).toEqual(result)
  })

  it('automatically selects tier based on result size', async () => {
    // Small: ~50 bytes (well under 1KB threshold)
    const smallResult = { data: [{ id: 1 }] }
    // Medium: ~20KB (over 1KB memory threshold, under 25MB KV limit)
    const mediumResult = { data: Array(500).fill({ id: 1, name: 'x'.repeat(30) }) }
    // Large: ~30MB (over 25MB KV limit)
    const largeResult = { data: Array(1000).fill({ id: 1, data: 'x'.repeat(30000) }) }

    const autoCache = new QueryCacheLayer({
      kv: mockEnv.CACHE_KV,
      r2: mockEnv.CACHE_R2,
      tierThresholds: {
        memory: 1 * 1024, // < 1KB - memory
        kv: 25 * 1024 * 1024, // < 25MB - kv
        r2: Infinity, // Everything else - r2
      },
    })

    await autoCache.set({ sql: 'small', params: [] }, smallResult)
    await autoCache.set({ sql: 'medium', params: [] }, mediumResult)
    await autoCache.set({ sql: 'large', params: [] }, largeResult)

    // Verify each is in appropriate tier
    const smallStats = await autoCache.getEntryStats({ sql: 'small', params: [] })
    const mediumStats = await autoCache.getEntryStats({ sql: 'medium', params: [] })
    const largeStats = await autoCache.getEntryStats({ sql: 'large', params: [] })

    expect(smallStats?.tier).toBe('memory')
    expect(mediumStats?.tier).toBe('kv')
    expect(largeStats?.tier).toBe('r2')
  })

  it('reads through tiers (L1 -> L2 -> L3)', async () => {
    // Simulate data only in R2
    const query = { sql: 'SELECT * FROM archived', params: [] }
    const result = { data: [{ id: 1 }] }

    // Put directly in R2 (simulating cold cache)
    const fingerprint = fingerprintQuery(query)
    await mockEnv.CACHE_R2.put(fingerprint, JSON.stringify(result), {
      customMetadata: { expiresAt: String(Date.now() + 60000) },
    })

    // Get should find it in R2
    const cached = await cache.get(query)
    expect(cached).toEqual(result)

    // After get, it should be promoted to faster tiers
    expect(mockEnv.CACHE_KV.put).toHaveBeenCalled()
  })

  it('evicts from lower tiers on memory pressure', async () => {
    const memoryLimitedCache = new QueryCacheLayer({
      kv: mockEnv.CACHE_KV,
      r2: mockEnv.CACHE_R2,
      maxMemoryEntries: 3,
    })

    // Fill memory tier
    await memoryLimitedCache.set({ sql: 'q1', params: [] }, { data: [] }, { tier: 'memory' })
    await memoryLimitedCache.set({ sql: 'q2', params: [] }, { data: [] }, { tier: 'memory' })
    await memoryLimitedCache.set({ sql: 'q3', params: [] }, { data: [] }, { tier: 'memory' })

    // Adding one more should evict oldest
    await memoryLimitedCache.set({ sql: 'q4', params: [] }, { data: [] }, { tier: 'memory' })

    const stats = await memoryLimitedCache.getStats()
    expect(stats.memoryEntries).toBeLessThanOrEqual(3)
  })
})

// =============================================================================
// TEST SUITE: Tenant Partitioning
// =============================================================================

describe('Tenant Partitioning', () => {
  let cache: QueryCacheLayer
  let mockEnv: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    mockEnv = createMockEnv()
    cache = new QueryCacheLayer({
      kv: mockEnv.CACHE_KV,
      r2: mockEnv.CACHE_R2,
      multiTenant: true,
    })
  })

  it('isolates cache by tenant', async () => {
    const query = { sql: 'SELECT * FROM users', params: [] }

    await cache.set(query, { data: [{ id: 1, name: 'TenantA User' }] }, { tenantId: 'tenant-a' })
    await cache.set(query, { data: [{ id: 2, name: 'TenantB User' }] }, { tenantId: 'tenant-b' })

    const tenantAResult = await cache.get(query, { tenantId: 'tenant-a' })
    const tenantBResult = await cache.get(query, { tenantId: 'tenant-b' })

    expect(tenantAResult).toEqual({ data: [{ id: 1, name: 'TenantA User' }] })
    expect(tenantBResult).toEqual({ data: [{ id: 2, name: 'TenantB User' }] })
  })

  it('prevents cross-tenant cache access', async () => {
    const query = { sql: 'SELECT * FROM users', params: [] }

    await cache.set(query, { data: [] }, { tenantId: 'tenant-a' })

    // Trying to get without tenant should fail
    const result = await cache.get(query, { tenantId: 'tenant-b' })
    expect(result).toBeUndefined()
  })

  it('enforces tenant context requirement', async () => {
    const strictCache = new QueryCacheLayer({
      kv: mockEnv.CACHE_KV,
      multiTenant: true,
      requireTenant: true,
    })

    const query = { sql: 'SELECT * FROM users', params: [] }

    // Should throw without tenant context
    await expect(strictCache.set(query, { data: [] })).rejects.toThrow(TenantIsolationError)
    await expect(strictCache.get(query)).rejects.toThrow(TenantIsolationError)
  })

  it('supports per-tenant TTL configuration', async () => {
    vi.useFakeTimers()

    const tenantConfigs: TenantConfig[] = [
      { tenantId: 'premium', defaultTTL: 300000 }, // 5 minutes
      { tenantId: 'basic', defaultTTL: 60000 }, // 1 minute
    ]

    const tenantCache = new QueryCacheLayer({
      kv: mockEnv.CACHE_KV,
      tenantConfigs,
    })

    const query = { sql: 'SELECT * FROM data', params: [] }

    await tenantCache.set(query, { data: [] }, { tenantId: 'premium' })
    await tenantCache.set(query, { data: [] }, { tenantId: 'basic' })

    // After 90 seconds, basic should be expired but premium should still be valid
    vi.advanceTimersByTime(90000)

    expect(await tenantCache.get(query, { tenantId: 'premium' })).toBeDefined()
    expect(await tenantCache.get(query, { tenantId: 'basic' })).toBeUndefined()

    vi.useRealTimers()
  })

  it('invalidates only within tenant scope', async () => {
    const query1 = { sql: 'SELECT * FROM users', params: [] }
    const query2 = { sql: 'SELECT * FROM orders', params: [] }

    await cache.set(query1, { data: [] }, { tenantId: 'tenant-a', tables: ['users'] })
    await cache.set(query2, { data: [] }, { tenantId: 'tenant-a', tables: ['orders'] })
    await cache.set(query1, { data: [] }, { tenantId: 'tenant-b', tables: ['users'] })

    // Invalidate users table for tenant-a only
    await cache.invalidateByTable('users', { tenantId: 'tenant-a' })

    expect(await cache.get(query1, { tenantId: 'tenant-a' })).toBeUndefined()
    expect(await cache.get(query2, { tenantId: 'tenant-a' })).toBeDefined()
    expect(await cache.get(query1, { tenantId: 'tenant-b' })).toBeDefined()
  })

  it('provides per-tenant statistics', async () => {
    await cache.set({ sql: 'q1', params: [] }, { data: [] }, { tenantId: 'tenant-a' })
    await cache.set({ sql: 'q2', params: [] }, { data: [] }, { tenantId: 'tenant-a' })
    await cache.set({ sql: 'q3', params: [] }, { data: [] }, { tenantId: 'tenant-b' })

    await cache.get({ sql: 'q1', params: [] }, { tenantId: 'tenant-a' }) // Hit
    await cache.get({ sql: 'missing', params: [] }, { tenantId: 'tenant-a' }) // Miss

    const statsA = await cache.getStats({ tenantId: 'tenant-a' })
    const statsB = await cache.getStats({ tenantId: 'tenant-b' })

    expect(statsA.entries).toBe(2)
    expect(statsA.hits).toBe(1)
    expect(statsA.misses).toBe(1)
    expect(statsB.entries).toBe(1)
    expect(statsB.hits).toBe(0)
  })
})

// =============================================================================
// TEST SUITE: Cache Statistics and Monitoring
// =============================================================================

describe('Cache Statistics and Monitoring', () => {
  let cache: QueryCacheLayer
  let mockEnv: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    mockEnv = createMockEnv()
    cache = new QueryCacheLayer({
      kv: mockEnv.CACHE_KV,
      r2: mockEnv.CACHE_R2,
      enableMetrics: true,
    })
  })

  it('tracks hit/miss ratio', async () => {
    const query = { sql: 'SELECT * FROM users', params: [] }

    // Miss
    await cache.get(query)

    // Set and hit
    await cache.set(query, { data: [] })
    await cache.get(query)
    await cache.get(query)

    const stats = await cache.getStats()

    expect(stats.hits).toBe(2)
    expect(stats.misses).toBe(1)
    expect(stats.hitRatio).toBeCloseTo(2 / 3, 2)
  })

  it('tracks entry count by tier', async () => {
    await cache.set({ sql: 'small', params: [] }, { data: [] }, { tier: 'memory' })
    await cache.set({ sql: 'medium', params: [] }, { data: [] }, { tier: 'kv' })
    await cache.set({ sql: 'large', params: [] }, { data: [] }, { tier: 'r2' })

    const stats = await cache.getStats()

    expect(stats.memoryEntries).toBe(1)
    expect(stats.kvEntries).toBe(1)
    expect(stats.r2Entries).toBe(1)
    expect(stats.totalEntries).toBe(3)
  })

  it('tracks latency by operation', async () => {
    const query = { sql: 'SELECT * FROM users', params: [] }

    await cache.set(query, { data: [] })
    await cache.get(query)
    await cache.get({ sql: 'nonexistent', params: [] })

    const stats = await cache.getStats()

    expect(stats.avgLatencyMs.get).toBeDefined()
    expect(stats.avgLatencyMs.set).toBeDefined()
    expect(stats.avgLatencyMs.hit).toBeDefined()
    expect(stats.avgLatencyMs.miss).toBeDefined()
  })

  it('tracks eviction count', async () => {
    const limitedCache = new QueryCacheLayer({
      kv: mockEnv.CACHE_KV,
      maxMemoryEntries: 2,
      enableMetrics: true,
    })

    await limitedCache.set({ sql: 'q1', params: [] }, { data: [] }, { tier: 'memory' })
    await limitedCache.set({ sql: 'q2', params: [] }, { data: [] }, { tier: 'memory' })
    await limitedCache.set({ sql: 'q3', params: [] }, { data: [] }, { tier: 'memory' })

    const stats = await limitedCache.getStats()
    expect(stats.evictions).toBeGreaterThanOrEqual(1)
  })

  it('provides size metrics', async () => {
    const data = { data: Array(100).fill({ id: 1 }) }
    await cache.set({ sql: 'q1', params: [] }, data)

    const stats = await cache.getStats()
    expect(stats.totalSizeBytes).toBeGreaterThan(0)
  })

  it('supports custom metrics callbacks', async () => {
    const metricsCallback = vi.fn()

    const metricsCache = new QueryCacheLayer({
      kv: mockEnv.CACHE_KV,
      enableMetrics: true,
      onMetrics: metricsCallback,
    })

    await metricsCache.set({ sql: 'q1', params: [] }, { data: [] })
    await metricsCache.get({ sql: 'q1', params: [] })

    expect(metricsCallback).toHaveBeenCalled()
  })
})

// =============================================================================
// TEST SUITE: Error Handling
// =============================================================================

describe('Error Handling', () => {
  let cache: QueryCacheLayer
  let mockEnv: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    mockEnv = createMockEnv()
    cache = new QueryCacheLayer({
      kv: mockEnv.CACHE_KV,
      r2: mockEnv.CACHE_R2,
    })
  })

  it('handles KV failures gracefully', async () => {
    mockEnv.CACHE_KV.get = vi.fn().mockRejectedValue(new Error('KV unavailable'))

    const query = { sql: 'SELECT * FROM users', params: [] }

    // Should not throw, just return undefined
    const result = await cache.get(query)
    expect(result).toBeUndefined()
  })

  it('handles R2 failures gracefully', async () => {
    mockEnv.CACHE_R2.get = vi.fn().mockRejectedValue(new Error('R2 unavailable'))

    const query = { sql: 'SELECT * FROM users', params: [] }

    const result = await cache.get(query)
    expect(result).toBeUndefined()
  })

  it('falls back to next tier on failure', async () => {
    // Make KV fail
    mockEnv.CACHE_KV.get = vi.fn().mockRejectedValue(new Error('KV unavailable'))

    // Put data in R2
    const query = { sql: 'SELECT * FROM users', params: [] }
    const fingerprint = fingerprintQuery(query)
    await mockEnv.CACHE_R2.put(fingerprint, JSON.stringify({ data: [{ id: 1 }] }), {
      customMetadata: { expiresAt: String(Date.now() + 60000) },
    })

    // Should fall back to R2
    const result = await cache.get(query)
    expect(result).toEqual({ data: [{ id: 1 }] })
  })

  it('throws CacheMissError when using strict mode', async () => {
    const strictCache = new QueryCacheLayer({
      kv: mockEnv.CACHE_KV,
      strictMode: true,
    })

    await expect(
      strictCache.getOrThrow({ sql: 'nonexistent', params: [] })
    ).rejects.toThrow(CacheMissError)
  })

  it('throws CacheExpiredError for expired entries in strict mode', async () => {
    vi.useFakeTimers()

    const strictCache = new QueryCacheLayer({
      kv: mockEnv.CACHE_KV,
      strictMode: true,
    })

    const query = { sql: 'SELECT * FROM users', params: [] }
    await strictCache.set(query, { data: [] }, { ttl: 1000 })

    vi.advanceTimersByTime(2000)

    await expect(strictCache.getOrThrow(query)).rejects.toThrow(CacheExpiredError)

    vi.useRealTimers()
  })
})

// =============================================================================
// TEST SUITE: Cloudflare Integration
// =============================================================================

describe('Cloudflare Integration', () => {
  let cache: QueryCacheLayer
  let mockEnv: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    mockEnv = createMockEnv()
    cache = new QueryCacheLayer({
      kv: mockEnv.CACHE_KV,
      r2: mockEnv.CACHE_R2,
      do: mockEnv.DO,
    })
  })

  it('uses KV expirationTtl for automatic cleanup', async () => {
    const query = { sql: 'SELECT * FROM users', params: [] }

    await cache.set(query, { data: [] }, { ttl: 60000, tier: 'kv' })

    expect(mockEnv.CACHE_KV.put).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ expirationTtl: 60 })
    )
  })

  it('stores metadata in R2 custom metadata', async () => {
    const query = { sql: 'SELECT * FROM users', params: [] }

    await cache.set(query, { data: [] }, { ttl: 60000, tier: 'r2' })

    expect(mockEnv.CACHE_R2.put).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        customMetadata: expect.objectContaining({
          expiresAt: expect.any(String),
        }),
      })
    )
  })

  it('broadcasts invalidation via DO stub', async () => {
    await cache.set({ sql: 'q1', params: [] }, { data: [] }, { tables: ['users'] })

    await cache.broadcastInvalidation('users', {
      targetDOs: ['cache-coordinator-1', 'cache-coordinator-2'],
    })

    expect(mockEnv.DO.get).toHaveBeenCalledTimes(2)
  })
})
