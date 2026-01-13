/**
 * Plan Cache Tests
 *
 * TDD tests for query plan caching:
 * - Cache optimized query plans by query signature
 * - Invalidate on schema changes
 * - Support parameterized queries
 * - Track cache hit/miss statistics
 *
 * @see dotdo-1ajq8
 */

import { describe, it, expect, beforeEach } from 'vitest'

import {
  // Plan Cache (to be implemented)
  PlanCache,
  type PlanCacheConfig,
  type PlanCacheStats,
  type CachedPlan,
  QueryNormalizer,
  type NormalizedQuery,

  // Existing types
  Catalog,
  PushdownOptimizer,
  createMemoryAdapter,
  type FederatedQuery,
  type ExecutionPlan,
} from '../index'

// =============================================================================
// Plan Cache Tests
// =============================================================================

describe('PlanCache', () => {
  let cache: PlanCache
  let catalog: Catalog
  let optimizer: PushdownOptimizer

  beforeEach(() => {
    catalog = new Catalog()
    optimizer = new PushdownOptimizer(catalog)

    // Setup test sources
    catalog.registerSource({ name: 'users_db', type: 'memory', config: {} })
    catalog.attachAdapter('users_db', createMemoryAdapter({
      users: [
        { id: 1, name: 'Alice', status: 'active' },
        { id: 2, name: 'Bob', status: 'inactive' },
      ],
    }))

    cache = new PlanCache({ maxSize: 100, ttlMs: 60000 })
  })

  describe('basic caching', () => {
    it('should cache an optimized plan by query signature', () => {
      const query: FederatedQuery = {
        from: [{ source: 'users_db', table: 'users' }],
        predicates: [{ column: 'status', op: '=', value: 'active' }],
      }

      const plan = optimizer.optimize(query)
      cache.put(query, plan)

      const cached = cache.get(query)

      expect(cached).toBeDefined()
      expect(cached?.plan).toEqual(plan)
    })

    it('should return undefined for uncached queries', () => {
      const query: FederatedQuery = {
        from: [{ source: 'users_db', table: 'users' }],
        predicates: [{ column: 'status', op: '=', value: 'active' }],
      }

      const cached = cache.get(query)

      expect(cached).toBeUndefined()
    })

    it('should return same plan for identical queries', () => {
      const query1: FederatedQuery = {
        from: [{ source: 'users_db', table: 'users' }],
        columns: ['id', 'name'],
        predicates: [{ column: 'status', op: '=', value: 'active' }],
      }

      const query2: FederatedQuery = {
        from: [{ source: 'users_db', table: 'users' }],
        columns: ['id', 'name'],
        predicates: [{ column: 'status', op: '=', value: 'active' }],
      }

      const plan = optimizer.optimize(query1)
      cache.put(query1, plan)

      const cached = cache.get(query2)

      expect(cached?.plan).toEqual(plan)
    })

    it('should not return plan for different queries', () => {
      const query1: FederatedQuery = {
        from: [{ source: 'users_db', table: 'users' }],
        predicates: [{ column: 'status', op: '=', value: 'active' }],
      }

      const query2: FederatedQuery = {
        from: [{ source: 'users_db', table: 'users' }],
        predicates: [{ column: 'status', op: '=', value: 'inactive' }],
      }

      const plan = optimizer.optimize(query1)
      cache.put(query1, plan)

      const cached = cache.get(query2)

      expect(cached).toBeUndefined()
    })
  })

  describe('TTL expiration', () => {
    it('should expire entries after TTL', async () => {
      cache = new PlanCache({ maxSize: 100, ttlMs: 50 })

      const query: FederatedQuery = {
        from: [{ source: 'users_db', table: 'users' }],
      }

      const plan = optimizer.optimize(query)
      cache.put(query, plan)

      // Should be cached initially
      expect(cache.get(query)).toBeDefined()

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 100))

      // Should be expired
      expect(cache.get(query)).toBeUndefined()
    })

    it('should track entry age', () => {
      const query: FederatedQuery = {
        from: [{ source: 'users_db', table: 'users' }],
      }

      const plan = optimizer.optimize(query)
      cache.put(query, plan)

      const cached = cache.get(query)

      expect(cached?.createdAt).toBeDefined()
      expect(cached?.createdAt).toBeLessThanOrEqual(Date.now())
    })
  })

  describe('LRU eviction', () => {
    it('should evict least recently used entries when full', () => {
      cache = new PlanCache({ maxSize: 3, ttlMs: 60000 })

      // Fill cache
      for (let i = 0; i < 3; i++) {
        const query: FederatedQuery = {
          from: [{ source: 'users_db', table: 'users' }],
          limit: i,
        }
        cache.put(query, optimizer.optimize(query))
      }

      // Access first entry to make it recently used
      cache.get({
        from: [{ source: 'users_db', table: 'users' }],
        limit: 0,
      })

      // Add new entry (should evict limit: 1)
      const newQuery: FederatedQuery = {
        from: [{ source: 'users_db', table: 'users' }],
        limit: 99,
      }
      cache.put(newQuery, optimizer.optimize(newQuery))

      // First entry should still exist (was recently accessed)
      expect(cache.get({
        from: [{ source: 'users_db', table: 'users' }],
        limit: 0,
      })).toBeDefined()

      // Second entry should be evicted (LRU)
      expect(cache.get({
        from: [{ source: 'users_db', table: 'users' }],
        limit: 1,
      })).toBeUndefined()

      // New entry should exist
      expect(cache.get(newQuery)).toBeDefined()
    })

    it('should report current cache size', () => {
      const query1: FederatedQuery = {
        from: [{ source: 'users_db', table: 'users' }],
        limit: 1,
      }
      const query2: FederatedQuery = {
        from: [{ source: 'users_db', table: 'users' }],
        limit: 2,
      }

      cache.put(query1, optimizer.optimize(query1))
      cache.put(query2, optimizer.optimize(query2))

      expect(cache.size).toBe(2)
    })
  })

  describe('cache invalidation', () => {
    it('should invalidate all entries for a source on schema change', () => {
      // Cache queries for multiple sources
      catalog.registerSource({ name: 'orders_db', type: 'memory', config: {} })
      catalog.attachAdapter('orders_db', createMemoryAdapter({
        orders: [{ id: 1, total: 100 }],
      }))

      const usersQuery: FederatedQuery = {
        from: [{ source: 'users_db', table: 'users' }],
      }
      const ordersQuery: FederatedQuery = {
        from: [{ source: 'orders_db', table: 'orders' }],
      }

      cache.put(usersQuery, optimizer.optimize(usersQuery))
      cache.put(ordersQuery, optimizer.optimize(ordersQuery))

      // Invalidate users_db entries
      cache.invalidateSource('users_db')

      // users_db entries should be invalidated
      expect(cache.get(usersQuery)).toBeUndefined()

      // orders_db entries should remain
      expect(cache.get(ordersQuery)).toBeDefined()
    })

    it('should invalidate entries for specific table', () => {
      catalog.attachAdapter('users_db', createMemoryAdapter({
        users: [{ id: 1, name: 'Alice' }],
        profiles: [{ user_id: 1, bio: 'Hello' }],
      }))

      const usersQuery: FederatedQuery = {
        from: [{ source: 'users_db', table: 'users' }],
      }
      const profilesQuery: FederatedQuery = {
        from: [{ source: 'users_db', table: 'profiles' }],
      }

      cache.put(usersQuery, optimizer.optimize(usersQuery))
      cache.put(profilesQuery, optimizer.optimize(profilesQuery))

      // Invalidate only users table
      cache.invalidateTable('users_db', 'users')

      expect(cache.get(usersQuery)).toBeUndefined()
      expect(cache.get(profilesQuery)).toBeDefined()
    })

    it('should invalidate all entries', () => {
      for (let i = 0; i < 5; i++) {
        const query: FederatedQuery = {
          from: [{ source: 'users_db', table: 'users' }],
          limit: i,
        }
        cache.put(query, optimizer.optimize(query))
      }

      expect(cache.size).toBe(5)

      cache.clear()

      expect(cache.size).toBe(0)
    })

    it('should invalidate cross-source queries when any source changes', () => {
      catalog.registerSource({ name: 'orders_db', type: 'memory', config: {} })
      catalog.attachAdapter('orders_db', createMemoryAdapter({
        orders: [{ id: 1, user_id: 1, total: 100 }],
      }))

      const crossSourceQuery: FederatedQuery = {
        from: [
          { source: 'users_db', table: 'users' },
          { source: 'orders_db', table: 'orders' },
        ],
        join: {
          type: 'INNER',
          on: { left: 'users.id', right: 'orders.user_id' },
        },
      }

      cache.put(crossSourceQuery, optimizer.optimize(crossSourceQuery))

      // Invalidate just one source
      cache.invalidateSource('users_db')

      // Cross-source query should be invalidated
      expect(cache.get(crossSourceQuery)).toBeUndefined()
    })
  })

  describe('schema version tracking', () => {
    it('should track schema version per source', () => {
      const query: FederatedQuery = {
        from: [{ source: 'users_db', table: 'users' }],
      }

      cache.setSchemaVersion('users_db', 1)
      cache.put(query, optimizer.optimize(query))

      // Bump schema version
      cache.setSchemaVersion('users_db', 2)

      // Cached entry should be invalid due to version mismatch
      expect(cache.get(query)).toBeUndefined()
    })

    it('should auto-invalidate on schema version bump', () => {
      const query: FederatedQuery = {
        from: [{ source: 'users_db', table: 'users' }],
      }

      cache.setSchemaVersion('users_db', 1)
      cache.put(query, optimizer.optimize(query))

      expect(cache.get(query)).toBeDefined()

      // Schema change bumps version
      cache.bumpSchemaVersion('users_db')

      expect(cache.get(query)).toBeUndefined()
    })
  })
})

// =============================================================================
// Query Normalizer Tests
// =============================================================================

describe('QueryNormalizer', () => {
  let normalizer: QueryNormalizer

  beforeEach(() => {
    normalizer = new QueryNormalizer()
  })

  describe('parameterized query normalization', () => {
    it('should normalize literal values to parameters', () => {
      const query: FederatedQuery = {
        from: [{ source: 'users_db', table: 'users' }],
        predicates: [
          { column: 'status', op: '=', value: 'active' },
          { column: 'age', op: '>', value: 21 },
        ],
      }

      const normalized = normalizer.normalize(query)

      // Parameters should be extracted (sorted alphabetically by column: age, status)
      expect(normalized.params).toHaveLength(2)
      expect(normalized.params[0]).toBe(21)      // age comes first alphabetically
      expect(normalized.params[1]).toBe('active') // status comes second

      // Query signature should use placeholders
      expect(normalized.signature).not.toContain('active')
      expect(normalized.signature).not.toContain('21')
    })

    it('should produce same signature for queries with different values', () => {
      const query1: FederatedQuery = {
        from: [{ source: 'users_db', table: 'users' }],
        predicates: [{ column: 'id', op: '=', value: 1 }],
      }

      const query2: FederatedQuery = {
        from: [{ source: 'users_db', table: 'users' }],
        predicates: [{ column: 'id', op: '=', value: 999 }],
      }

      const normalized1 = normalizer.normalize(query1)
      const normalized2 = normalizer.normalize(query2)

      expect(normalized1.signature).toBe(normalized2.signature)
    })

    it('should produce different signatures for structurally different queries', () => {
      const query1: FederatedQuery = {
        from: [{ source: 'users_db', table: 'users' }],
        predicates: [{ column: 'status', op: '=', value: 'active' }],
      }

      const query2: FederatedQuery = {
        from: [{ source: 'users_db', table: 'users' }],
        predicates: [{ column: 'age', op: '=', value: 'active' }],
      }

      const normalized1 = normalizer.normalize(query1)
      const normalized2 = normalizer.normalize(query2)

      expect(normalized1.signature).not.toBe(normalized2.signature)
    })

    it('should handle IN operator with arrays', () => {
      const query: FederatedQuery = {
        from: [{ source: 'users_db', table: 'users' }],
        predicates: [
          { column: 'id', op: 'IN', value: [1, 2, 3] },
        ],
      }

      const normalized = normalizer.normalize(query)

      expect(normalized.params[0]).toEqual([1, 2, 3])
    })

    it('should preserve query structure in signature', () => {
      const query: FederatedQuery = {
        from: [{ source: 'users_db', table: 'users' }],
        columns: ['id', 'name'],
        predicates: [{ column: 'status', op: '=', value: 'active' }],
        limit: 10,
      }

      const normalized = normalizer.normalize(query)

      // Signature should include structural elements
      expect(normalized.signature).toContain('users_db')
      expect(normalized.signature).toContain('users')
      expect(normalized.signature).toContain('id')
      expect(normalized.signature).toContain('name')
      expect(normalized.signature).toContain('status')
    })

    it('should handle queries without predicates', () => {
      const query: FederatedQuery = {
        from: [{ source: 'users_db', table: 'users' }],
        columns: ['id', 'name'],
      }

      const normalized = normalizer.normalize(query)

      expect(normalized.params).toHaveLength(0)
      expect(normalized.signature).toBeDefined()
    })
  })

  describe('signature stability', () => {
    it('should produce deterministic signatures', () => {
      const query: FederatedQuery = {
        from: [{ source: 'users_db', table: 'users' }],
        predicates: [{ column: 'status', op: '=', value: 'active' }],
      }

      const sig1 = normalizer.normalize(query).signature
      const sig2 = normalizer.normalize(query).signature
      const sig3 = normalizer.normalize(query).signature

      expect(sig1).toBe(sig2)
      expect(sig2).toBe(sig3)
    })

    it('should produce same signature regardless of predicate order', () => {
      const query1: FederatedQuery = {
        from: [{ source: 'users_db', table: 'users' }],
        predicates: [
          { column: 'status', op: '=', value: 'active' },
          { column: 'age', op: '>', value: 21 },
        ],
      }

      const query2: FederatedQuery = {
        from: [{ source: 'users_db', table: 'users' }],
        predicates: [
          { column: 'age', op: '>', value: 21 },
          { column: 'status', op: '=', value: 'active' },
        ],
      }

      const sig1 = normalizer.normalize(query1).signature
      const sig2 = normalizer.normalize(query2).signature

      expect(sig1).toBe(sig2)
    })
  })
})

// =============================================================================
// Cache Statistics Tests
// =============================================================================

describe('PlanCache Statistics', () => {
  let cache: PlanCache
  let catalog: Catalog
  let optimizer: PushdownOptimizer

  beforeEach(() => {
    catalog = new Catalog()
    optimizer = new PushdownOptimizer(catalog)

    catalog.registerSource({ name: 'users_db', type: 'memory', config: {} })
    catalog.attachAdapter('users_db', createMemoryAdapter({
      users: [{ id: 1, name: 'Alice' }],
    }))

    cache = new PlanCache({ maxSize: 100, ttlMs: 60000 })
  })

  it('should track cache hits', () => {
    const query: FederatedQuery = {
      from: [{ source: 'users_db', table: 'users' }],
    }

    cache.put(query, optimizer.optimize(query))

    // Multiple hits
    cache.get(query)
    cache.get(query)
    cache.get(query)

    const stats = cache.getStats()

    expect(stats.hits).toBe(3)
  })

  it('should track cache misses', () => {
    const query1: FederatedQuery = {
      from: [{ source: 'users_db', table: 'users' }],
      limit: 1,
    }
    const query2: FederatedQuery = {
      from: [{ source: 'users_db', table: 'users' }],
      limit: 2,
    }

    cache.put(query1, optimizer.optimize(query1))

    cache.get(query1) // hit
    cache.get(query2) // miss
    cache.get(query2) // miss

    const stats = cache.getStats()

    expect(stats.hits).toBe(1)
    expect(stats.misses).toBe(2)
  })

  it('should calculate hit rate', () => {
    const query1: FederatedQuery = {
      from: [{ source: 'users_db', table: 'users' }],
      limit: 1,
    }
    const query2: FederatedQuery = {
      from: [{ source: 'users_db', table: 'users' }],
      limit: 2,
    }

    cache.put(query1, optimizer.optimize(query1))

    // 3 hits
    cache.get(query1)
    cache.get(query1)
    cache.get(query1)

    // 1 miss
    cache.get(query2)

    const stats = cache.getStats()

    expect(stats.hitRate).toBe(0.75) // 3 / 4
  })

  it('should track evictions', () => {
    cache = new PlanCache({ maxSize: 2, ttlMs: 60000 })

    for (let i = 0; i < 5; i++) {
      const query: FederatedQuery = {
        from: [{ source: 'users_db', table: 'users' }],
        limit: i,
      }
      cache.put(query, optimizer.optimize(query))
    }

    const stats = cache.getStats()

    expect(stats.evictions).toBe(3) // 5 inserts - 2 max size = 3 evictions
  })

  it('should track invalidations', () => {
    for (let i = 0; i < 5; i++) {
      const query: FederatedQuery = {
        from: [{ source: 'users_db', table: 'users' }],
        limit: i,
      }
      cache.put(query, optimizer.optimize(query))
    }

    cache.invalidateSource('users_db')

    const stats = cache.getStats()

    expect(stats.invalidations).toBe(5)
  })

  it('should reset statistics', () => {
    const query: FederatedQuery = {
      from: [{ source: 'users_db', table: 'users' }],
    }

    cache.put(query, optimizer.optimize(query))
    cache.get(query)
    cache.get(query)

    cache.resetStats()

    const stats = cache.getStats()

    expect(stats.hits).toBe(0)
    expect(stats.misses).toBe(0)
    expect(stats.evictions).toBe(0)
    expect(stats.invalidations).toBe(0)
  })

  it('should report entry count per source', () => {
    catalog.registerSource({ name: 'orders_db', type: 'memory', config: {} })
    catalog.attachAdapter('orders_db', createMemoryAdapter({
      orders: [{ id: 1 }],
    }))

    // 3 users_db entries
    for (let i = 0; i < 3; i++) {
      const query: FederatedQuery = {
        from: [{ source: 'users_db', table: 'users' }],
        limit: i,
      }
      cache.put(query, optimizer.optimize(query))
    }

    // 2 orders_db entries
    for (let i = 0; i < 2; i++) {
      const query: FederatedQuery = {
        from: [{ source: 'orders_db', table: 'orders' }],
        limit: i,
      }
      cache.put(query, optimizer.optimize(query))
    }

    const stats = cache.getStats()

    expect(stats.entriesBySource['users_db']).toBe(3)
    expect(stats.entriesBySource['orders_db']).toBe(2)
  })
})

// =============================================================================
// Integration with FederatedQueryPlanner Tests
// =============================================================================

describe('PlanCache Integration', () => {
  let catalog: Catalog
  let optimizer: PushdownOptimizer
  let cache: PlanCache

  beforeEach(() => {
    catalog = new Catalog()
    optimizer = new PushdownOptimizer(catalog)
    cache = new PlanCache({ maxSize: 100, ttlMs: 60000 })

    catalog.registerSource({ name: 'customers', type: 'memory', config: {} })
    catalog.attachAdapter('customers', createMemoryAdapter({
      customers: [
        { id: 1, name: 'Acme Corp', tier: 'enterprise' },
        { id: 2, name: 'Startup Inc', tier: 'basic' },
      ],
    }))
  })

  it('should integrate with CachedOptimizer for transparent caching', () => {
    const cachedOptimizer = cache.wrapOptimizer(optimizer)

    const query: FederatedQuery = {
      from: [{ source: 'customers', table: 'customers' }],
      predicates: [{ column: 'tier', op: '=', value: 'enterprise' }],
    }

    // First call - cache miss
    const plan1 = cachedOptimizer.optimize(query)

    // Second call - cache hit
    const plan2 = cachedOptimizer.optimize(query)

    expect(plan1).toEqual(plan2)

    const stats = cache.getStats()
    expect(stats.hits).toBe(1)
    expect(stats.misses).toBe(1)
  })

  it('should cache parameterized queries efficiently', () => {
    cache = new PlanCache({
      maxSize: 100,
      ttlMs: 60000,
      parameterize: true,
    })
    const cachedOptimizer = cache.wrapOptimizer(optimizer)

    // Different values but same structure
    const query1: FederatedQuery = {
      from: [{ source: 'customers', table: 'customers' }],
      predicates: [{ column: 'id', op: '=', value: 1 }],
    }
    const query2: FederatedQuery = {
      from: [{ source: 'customers', table: 'customers' }],
      predicates: [{ column: 'id', op: '=', value: 2 }],
    }

    cachedOptimizer.optimize(query1) // miss
    cachedOptimizer.optimize(query2) // hit (same signature)

    const stats = cache.getStats()
    expect(stats.hits).toBe(1)
    expect(stats.misses).toBe(1)
  })

  it('should invalidate cache when catalog schema changes', () => {
    // Create catalog with cache integration
    const cachedCatalog = cache.wrapCatalog(catalog)

    const query: FederatedQuery = {
      from: [{ source: 'customers', table: 'customers' }],
    }

    cache.put(query, optimizer.optimize(query))

    expect(cache.get(query)).toBeDefined()

    // Schema change through wrapped catalog
    cachedCatalog.registerSchema('customers', {
      tables: {
        customers: {
          columns: {
            id: { type: 'integer', nullable: false },
            name: { type: 'string', nullable: false },
            tier: { type: 'string', nullable: false },
            newColumn: { type: 'string', nullable: true }, // New column
          },
        },
      },
    })

    // Cache should be invalidated
    expect(cache.get(query)).toBeUndefined()
  })
})
