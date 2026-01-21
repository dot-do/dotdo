import { describe, it, expect, beforeEach } from 'vitest'
import {
  ShardRouter,
  createShardRouter,
  fnv1aHash,
  getShardIndex,
  extractUserIdFromHeader,
  extractShardFromQuery,
  LoadMetricsStore,
  LoadBalancedRouter,
  createLoadBalancedRouter,
  type ShardContext,
} from '../shard'

describe('fnv1aHash', () => {
  it('should return consistent hashes for the same input', () => {
    const hash1 = fnv1aHash('test-key')
    const hash2 = fnv1aHash('test-key')
    expect(hash1).toBe(hash2)
  })

  it('should return different hashes for different inputs', () => {
    const hash1 = fnv1aHash('key-1')
    const hash2 = fnv1aHash('key-2')
    expect(hash1).not.toBe(hash2)
  })

  it('should handle empty strings', () => {
    const hash = fnv1aHash('')
    expect(typeof hash).toBe('number')
  })

  it('should handle unicode strings', () => {
    const hash = fnv1aHash('hello-世界-🌍')
    expect(typeof hash).toBe('number')
    expect(hash).toBeGreaterThan(0)
  })
})

describe('getShardIndex', () => {
  it('should return index in valid range', () => {
    const index = getShardIndex('test-key', 16)
    expect(index).toBeGreaterThanOrEqual(0)
    expect(index).toBeLessThan(16)
  })

  it('should return 0 for shard count of 1', () => {
    const index = getShardIndex('any-key', 1)
    expect(index).toBe(0)
  })

  it('should throw for invalid shard count', () => {
    expect(() => getShardIndex('key', 0)).toThrow('Shard count must be positive')
    expect(() => getShardIndex('key', -1)).toThrow('Shard count must be positive')
  })

  it('should use multiple shards for diverse keys', () => {
    const shardCount = 16
    const shardsSeen = new Set<number>()
    const diverseKeys = [
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      'b2c3d4e5-f6a7-8901-bcde-f23456789012',
      'c3d4e5f6-a7b8-9012-cdef-345678901234',
      'd4e5f6a7-b8c9-0123-defa-456789012345',
      'e5f6a7b8-c9d0-1234-efab-567890123456',
      'user-alice-tenant-acme',
      'user-bob-tenant-acme',
      'user-charlie-tenant-beta',
      'order-12345-customer-67890',
      'order-23456-customer-78901',
      'analytics-2024-01-15',
      'analytics-2024-01-16',
      'session-xyz789-user-alice',
      'session-abc123-user-bob',
      'product-sku-001',
      'product-sku-002',
    ]
    for (const key of diverseKeys) {
      const index = getShardIndex(key, shardCount)
      shardsSeen.add(index)
    }
    expect(shardsSeen.size).toBeGreaterThanOrEqual(4)
  })

  it('should be consistent for the same key', () => {
    const key = 'consistent-key'
    const index1 = getShardIndex(key, 32)
    const index2 = getShardIndex(key, 32)
    const index3 = getShardIndex(key, 32)
    expect(index1).toBe(index2)
    expect(index2).toBe(index3)
  })
})

describe('ShardRouter', () => {
  let router: ShardRouter

  beforeEach(() => {
    router = new ShardRouter({
      defaultShardCount: 16,
      entityShards: { users: 32, orders: 64, analytics: 4 },
    })
  })

  describe('getShardCount', () => {
    it('should return entity-specific shard count', () => {
      expect(router.getShardCount('users')).toBe(32)
      expect(router.getShardCount('orders')).toBe(64)
      expect(router.getShardCount('analytics')).toBe(4)
    })

    it('should return default shard count for unknown entities', () => {
      expect(router.getShardCount('unknown')).toBe(16)
      expect(router.getShardCount()).toBe(16)
    })
  })

  describe('route', () => {
    it('should route to namespace only when no key found', () => {
      const result = router.route({ namespace: 'acme', path: '/' })
      expect(result.doName).toBe('acme')
      expect(result.sharded).toBe(false)
      expect(result.shardIndex).toBe(0)
    })

    it('should route with entity type and ID', () => {
      const result = router.route({
        namespace: 'acme',
        path: '/users/user-123',
        entityType: 'users',
        entityId: 'user-123',
      })
      expect(result.doName).toMatch(/^acme:users:shard-\d+$/)
      expect(result.sharded).toBe(true)
      expect(result.key).toBe('user-123')
      expect(result.shardIndex).toBeGreaterThanOrEqual(0)
      expect(result.shardIndex).toBeLessThan(32)
    })

    it('should extract entity type from path', () => {
      const result = router.route({ namespace: 'acme', path: '/users/user-456' })
      expect(result.doName).toMatch(/^acme:users:shard-\d+$/)
      expect(result.sharded).toBe(true)
    })

    it('should use explicit shard key when provided', () => {
      const result = router.route({
        namespace: 'acme',
        path: '/users/user-123',
        shardKey: 'custom-key',
      })
      expect(result.key).toBe('custom-key')
      expect(result.sharded).toBe(true)
    })

    it('should skip API prefixes when extracting entity type', () => {
      const result = router.route({ namespace: 'acme', path: '/api/v1/orders/order-789' })
      expect(result.doName).toMatch(/^acme:orders:shard-\d+$/)
    })

    it('should be consistent for the same input', () => {
      const ctx: ShardContext = {
        namespace: 'acme',
        path: '/users/user-123',
        entityType: 'users',
        entityId: 'user-123',
      }
      const result1 = router.route(ctx)
      const result2 = router.route(ctx)
      const result3 = router.route(ctx)
      expect(result1.doName).toBe(result2.doName)
      expect(result2.doName).toBe(result3.doName)
    })
  })

  describe('with disabled sharding', () => {
    it('should return namespace only when disabled', () => {
      const disabledRouter = new ShardRouter({ defaultShardCount: 16, enabled: false })
      const result = disabledRouter.route({
        namespace: 'acme',
        path: '/users/user-123',
        entityType: 'users',
        entityId: 'user-123',
      })
      expect(result.doName).toBe('acme')
      expect(result.sharded).toBe(false)
    })
  })

  describe('with custom separator', () => {
    it('should use custom separator in DO name', () => {
      const customRouter = new ShardRouter({ defaultShardCount: 16, separator: '-' })
      const result = customRouter.route({
        namespace: 'acme',
        path: '/users/user-123',
        entityType: 'users',
        entityId: 'user-123',
      })
      expect(result.doName).toMatch(/^acme-users-shard-\d+$/)
    })
  })

  describe('with custom key extractors', () => {
    it('should use custom key extractor for matching path', () => {
      const customRouter = new ShardRouter({
        defaultShardCount: 16,
        keyExtractors: { '/api/*/search': (ctx) => ctx.params?.get('tenant') || undefined },
      })
      const params = new URLSearchParams('tenant=tenant-abc&q=hello')
      const result = customRouter.route({ namespace: 'acme', path: '/api/v1/search', params })
      expect(result.key).toBe('tenant-abc')
      expect(result.sharded).toBe(true)
    })
  })
})

describe('createShardRouter', () => {
  it('should create a router with default config', () => {
    const router = createShardRouter()
    expect(router).toBeInstanceOf(ShardRouter)
    expect(router.getShardCount()).toBe(16)
  })

  it('should create a router with custom config', () => {
    const router = createShardRouter({ defaultShardCount: 32, entityShards: { products: 8 } })
    expect(router.getShardCount()).toBe(32)
    expect(router.getShardCount('products')).toBe(8)
  })
})

describe('extractUserIdFromHeader', () => {
  it('should extract X-User-ID header', () => {
    const headers = new Headers({ 'X-User-ID': 'user-123' })
    const ctx: ShardContext = { namespace: 'acme', path: '/api/data', headers }
    expect(extractUserIdFromHeader(ctx)).toBe('user-123')
  })

  it('should fall back to Authorization bearer token', () => {
    const headers = new Headers({ Authorization: 'Bearer token-abc' })
    const ctx: ShardContext = { namespace: 'acme', path: '/api/data', headers }
    expect(extractUserIdFromHeader(ctx)).toBe('token-abc')
  })

  it('should return undefined when no headers', () => {
    const ctx: ShardContext = { namespace: 'acme', path: '/api/data' }
    expect(extractUserIdFromHeader(ctx)).toBeUndefined()
  })
})

describe('extractShardFromQuery', () => {
  it('should extract query parameter', () => {
    const params = new URLSearchParams('tenant_id=tenant-xyz')
    const ctx: ShardContext = { namespace: 'acme', path: '/search', params }
    const extractor = extractShardFromQuery('tenant_id')
    expect(extractor(ctx)).toBe('tenant-xyz')
  })

  it('should return undefined when param missing', () => {
    const params = new URLSearchParams('other=value')
    const ctx: ShardContext = { namespace: 'acme', path: '/search', params }
    const extractor = extractShardFromQuery('tenant_id')
    expect(extractor(ctx)).toBeUndefined()
  })
})

// ============================================================================
// Least-Loaded Load Balancing Tests (do-ftgn)
// ============================================================================

describe('Least-Loaded Load Balancing (do-ftgn)', () => {
  describe('LoadBalancedRouter', () => {
    it('should route to least loaded DO instance', () => {
      const metricsStore = new LoadMetricsStore()
      metricsStore.recordLoad('acme:users:shard-0', 100)
      metricsStore.recordLoad('acme:users:shard-1', 20)
      metricsStore.recordLoad('acme:users:shard-2', 50)
      metricsStore.recordLoad('acme:users:shard-3', 80)

      const router = new LoadBalancedRouter({
        defaultShardCount: 4,
        metricsStore,
        strategy: 'least-loaded',
      })

      // Use path without extractable key (no entity ID) to trigger load balancing
      const result = router.route({ namespace: 'acme', path: '/users', entityType: 'users' })
      expect(result.doName).toBe('acme:users:shard-1')
      expect(result.shardIndex).toBe(1)
      expect(result.loadBalanced).toBe(true)
    })

    it('should fall back to round-robin when loads are equal', () => {
      const metricsStore = new LoadMetricsStore()
      metricsStore.recordLoad('acme:users:shard-0', 50)
      metricsStore.recordLoad('acme:users:shard-1', 50)
      metricsStore.recordLoad('acme:users:shard-2', 50)
      metricsStore.recordLoad('acme:users:shard-3', 50)

      const router = new LoadBalancedRouter({
        defaultShardCount: 4,
        metricsStore,
        strategy: 'least-loaded',
      })

      const results = [
        router.route({ namespace: 'acme', path: '/users/a', entityType: 'users' }),
        router.route({ namespace: 'acme', path: '/users/b', entityType: 'users' }),
        router.route({ namespace: 'acme', path: '/users/c', entityType: 'users' }),
        router.route({ namespace: 'acme', path: '/users/d', entityType: 'users' }),
      ]
      const uniqueShards = new Set(results.map((r) => r.shardIndex))
      expect(uniqueShards.size).toBeGreaterThanOrEqual(2)
    })

    it('should use consistent hashing for existing entity lookups', () => {
      const metricsStore = new LoadMetricsStore()
      metricsStore.recordLoad('acme:users:shard-0', 100)
      metricsStore.recordLoad('acme:users:shard-1', 20)

      const router = new LoadBalancedRouter({
        defaultShardCount: 4,
        metricsStore,
        strategy: 'least-loaded',
      })

      const result = router.route({
        namespace: 'acme',
        path: '/users/existing-user-123',
        entityType: 'users',
        entityId: 'existing-user-123',
      })
      expect(result.loadBalanced).toBe(false)
      expect(result.sharded).toBe(true)

      const result2 = router.route({
        namespace: 'acme',
        path: '/users/existing-user-123',
        entityType: 'users',
        entityId: 'existing-user-123',
      })
      expect(result.doName).toBe(result2.doName)
    })

    it('should track request counts as load metric', () => {
      const store = new LoadMetricsStore()
      store.recordRequest('acme:users:shard-0')
      store.recordRequest('acme:users:shard-0')
      store.recordRequest('acme:users:shard-1')

      expect(store.getLoad('acme:users:shard-0')).toBe(2)
      expect(store.getLoad('acme:users:shard-1')).toBe(1)
      expect(store.getLoad('acme:users:shard-2')).toBe(0)
    })

    it('should decay old load metrics over time', async () => {
      const store = new LoadMetricsStore({ decayIntervalMs: 100, decayFactor: 0.5 })
      store.recordLoad('acme:shard-0', 100)
      expect(store.getLoad('acme:shard-0')).toBe(100)

      await new Promise((resolve) => setTimeout(resolve, 150))
      store.applyDecay()
      expect(store.getLoad('acme:shard-0')).toBe(50)
    })

    it('should report telemetry for load balancing decisions', () => {
      const metricsStore = new LoadMetricsStore()
      const telemetryEvents: unknown[] = []
      metricsStore.recordLoad('acme:users:shard-0', 100)
      metricsStore.recordLoad('acme:users:shard-1', 20)
      metricsStore.recordLoad('acme:users:shard-2', 50)
      metricsStore.recordLoad('acme:users:shard-3', 80)

      const router = new LoadBalancedRouter({
        defaultShardCount: 4,
        metricsStore,
        strategy: 'least-loaded',
        onTelemetry: (event) => telemetryEvents.push(event),
      })

      // Use path without extractable key to trigger load balancing
      router.route({ namespace: 'acme', path: '/users', entityType: 'users' })
      expect(telemetryEvents.length).toBe(1)
      expect(telemetryEvents[0]).toMatchObject({
        type: 'load_balance_decision',
        selectedShard: 1,
        loadSnapshot: expect.any(Object),
      })
    })

    it('should support weighted load balancing', () => {
      const metricsStore = new LoadMetricsStore()
      metricsStore.recordLoad('acme:users:shard-0', 50)
      metricsStore.recordLoad('acme:users:shard-1', 50)
      metricsStore.recordLoad('acme:users:shard-2', 50)

      const router = new LoadBalancedRouter({
        defaultShardCount: 3,
        metricsStore,
        strategy: 'weighted',
        weights: { 'acme:users:shard-0': 2, 'acme:users:shard-1': 1, 'acme:users:shard-2': 1 },
      })

      // Use path without extractable key to trigger load balancing
      const result = router.route({ namespace: 'acme', path: '/users', entityType: 'users' })
      expect(result.doName).toBe('acme:users:shard-0')
    })

    it('should find least loaded shard across all candidates', () => {
      const metricsStore = new LoadMetricsStore()
      for (let i = 0; i < 16; i++) {
        metricsStore.recordLoad(`acme:orders:shard-${i}`, i === 7 ? 5 : 50 + i)
      }

      const router = new LoadBalancedRouter({
        defaultShardCount: 16,
        metricsStore,
        strategy: 'least-loaded',
      })

      // Use path without extractable key to trigger load balancing
      const result = router.route({ namespace: 'acme', path: '/orders', entityType: 'orders' })
      expect(result.shardIndex).toBe(7)
      expect(result.doName).toBe('acme:orders:shard-7')
    })
  })

  describe('LoadMetricsStore', () => {
    it('should initialize with zero load for all shards', () => {
      const store = new LoadMetricsStore()
      expect(store.getLoad('any-shard')).toBe(0)
    })

    it('should support multiple metric types', () => {
      const store = new LoadMetricsStore()
      store.recordMetric('acme:shard-0', 'requests', 100)
      store.recordMetric('acme:shard-0', 'connections', 5)
      store.recordMetric('acme:shard-0', 'memory', 256)

      expect(store.getMetric('acme:shard-0', 'requests')).toBe(100)
      expect(store.getMetric('acme:shard-0', 'connections')).toBe(5)
      expect(store.getMetric('acme:shard-0', 'memory')).toBe(256)
    })

    it('should calculate composite load from multiple metrics', () => {
      const store = new LoadMetricsStore({
        loadWeights: { requests: 1, connections: 10, memory: 0.1 },
      })
      store.recordMetric('acme:shard-0', 'requests', 100)
      store.recordMetric('acme:shard-0', 'connections', 5)
      store.recordMetric('acme:shard-0', 'memory', 256)
      expect(store.getCompositeLoad('acme:shard-0')).toBeCloseTo(175.6)
    })

    it('should get all shard loads for a namespace', () => {
      const store = new LoadMetricsStore()
      store.recordLoad('acme:users:shard-0', 100)
      store.recordLoad('acme:users:shard-1', 50)
      store.recordLoad('acme:orders:shard-0', 200)

      const userLoads = store.getShardLoads('acme', 'users', 4)
      expect(userLoads).toEqual({
        'acme:users:shard-0': 100,
        'acme:users:shard-1': 50,
        'acme:users:shard-2': 0,
        'acme:users:shard-3': 0,
      })
    })

    it('should find least loaded shard', () => {
      const store = new LoadMetricsStore()
      store.recordLoad('acme:users:shard-0', 100)
      store.recordLoad('acme:users:shard-1', 25)
      store.recordLoad('acme:users:shard-2', 50)
      store.recordLoad('acme:users:shard-3', 75)

      const { shardIndex, doName, load } = store.findLeastLoaded('acme', 'users', 4)
      expect(shardIndex).toBe(1)
      expect(doName).toBe('acme:users:shard-1')
      expect(load).toBe(25)
    })

    it('should reset metrics', () => {
      const store = new LoadMetricsStore()
      store.recordLoad('acme:shard-0', 100)
      store.reset()
      expect(store.getLoad('acme:shard-0')).toBe(0)
    })
  })
})

describe('ShardRouter integration scenarios', () => {
  describe('Multi-tenant SaaS scenario', () => {
    it('should shard users by user ID within tenant', () => {
      const router = new ShardRouter({ defaultShardCount: 16, entityShards: { users: 32 } })
      const user1 = router.route({
        namespace: 'acme',
        path: '/users/user-001',
        entityType: 'users',
        entityId: 'user-001',
      })
      const user2 = router.route({
        namespace: 'acme',
        path: '/users/user-002',
        entityType: 'users',
        entityId: 'user-002',
      })
      expect(user1.doName).toMatch(/^acme:users:shard-\d+$/)
      expect(user2.doName).toMatch(/^acme:users:shard-\d+$/)

      const user1Again = router.route({
        namespace: 'acme',
        path: '/users/user-001',
        entityType: 'users',
        entityId: 'user-001',
      })
      expect(user1.doName).toBe(user1Again.doName)
    })
  })

  describe('Analytics hot-spot scenario', () => {
    it('should use fewer shards for analytics to aggregate data', () => {
      const router = new ShardRouter({ defaultShardCount: 16, entityShards: { analytics: 4 } })
      const result = router.route({
        namespace: 'acme',
        path: '/analytics/event-123',
        entityType: 'analytics',
        entityId: 'event-123',
      })
      expect(result.shardIndex).toBeLessThan(4)
    })
  })

  describe('High-cardinality orders scenario', () => {
    it('should use more shards for orders to distribute load', () => {
      const router = new ShardRouter({ defaultShardCount: 16, entityShards: { orders: 128 } })
      const result = router.route({
        namespace: 'acme',
        path: '/orders/order-123',
        entityType: 'orders',
        entityId: 'order-123',
      })
      expect(result.shardIndex).toBeLessThan(128)
    })
  })
})

// ============================================================================
// Additional Shard Routing Edge Cases (do-ka77)
// ============================================================================

describe('Shard routing edge cases (do-ka77)', () => {
  describe('fnv1aHash edge cases', () => {
    it('should produce deterministic results for identical keys', () => {
      const key = 'test-deterministic-key'
      const hashes = Array.from({ length: 100 }, () => fnv1aHash(key))
      expect(new Set(hashes).size).toBe(1)
    })

    it('should handle very long strings', () => {
      const longKey = 'a'.repeat(10000)
      const hash = fnv1aHash(longKey)
      expect(typeof hash).toBe('number')
      expect(hash).toBeGreaterThanOrEqual(0)
    })

    it('should handle special characters', () => {
      const specialKeys = [
        'key/with/slashes',
        'key:with:colons',
        'key@with@at',
        'key#with#hash',
        'key?with?question',
        'key&with&ampersand',
        'key=with=equals',
        'key with spaces',
        'key\twith\ttabs',
        'key\nwith\nnewlines',
      ]
      for (const key of specialKeys) {
        const hash = fnv1aHash(key)
        expect(typeof hash).toBe('number')
        expect(hash).toBeGreaterThanOrEqual(0)
      }
    })

    it('should produce different hashes for similar strings', () => {
      const hashes = new Set([
        fnv1aHash('user-1'),
        fnv1aHash('user-2'),
        fnv1aHash('user-3'),
        fnv1aHash('1-user'),
        fnv1aHash('2-user'),
      ])
      expect(hashes.size).toBe(5)
    })

    it('should handle null characters in strings', () => {
      const keyWithNull = 'key\x00with\x00nulls'
      const hash = fnv1aHash(keyWithNull)
      expect(typeof hash).toBe('number')
    })
  })

  describe('getShardIndex edge cases', () => {
    it('should handle very large shard counts', () => {
      const index = getShardIndex('test-key', 1000000)
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(1000000)
    })

    it('should distribute keys reasonably for power-of-2 shard counts', () => {
      const shardCount = 256
      const shardCounts = new Map<number, number>()

      // Generate many keys and track distribution
      for (let i = 0; i < 1000; i++) {
        const key = `key-${i}-${Math.random()}`
        const index = getShardIndex(key, shardCount)
        shardCounts.set(index, (shardCounts.get(index) ?? 0) + 1)
      }

      // Should use at least 50% of available shards
      expect(shardCounts.size).toBeGreaterThan(shardCount / 2)
    })

    it('should distribute keys reasonably for non-power-of-2 shard counts', () => {
      const shardCount = 17 // Prime number
      const shardCounts = new Map<number, number>()

      for (let i = 0; i < 1000; i++) {
        const key = `key-${i}-${Math.random()}`
        const index = getShardIndex(key, shardCount)
        shardCounts.set(index, (shardCounts.get(index) ?? 0) + 1)
      }

      expect(shardCounts.size).toBe(shardCount) // Should use all shards
    })

    it('should handle edge case shard count of 2', () => {
      const index = getShardIndex('test-key', 2)
      expect(index === 0 || index === 1).toBe(true)
    })
  })

  describe('ShardRouter path extraction edge cases', () => {
    let router: ShardRouter

    beforeEach(() => {
      router = new ShardRouter({ defaultShardCount: 16 })
    })

    it('should handle paths with trailing slashes', () => {
      const result1 = router.route({ namespace: 'acme', path: '/users/user-123/' })
      const result2 = router.route({ namespace: 'acme', path: '/users/user-123' })
      // Both should extract the same key
      expect(result1.key).toBe(result2.key)
    })

    it('should handle paths with multiple API version prefixes', () => {
      const result = router.route({ namespace: 'acme', path: '/api/v2/users/user-123' })
      expect(result.doName).toMatch(/^acme:users:shard-\d+$/)
      expect(result.key).toBe('user-123')
    })

    it('should handle deeply nested paths', () => {
      const result = router.route({
        namespace: 'acme',
        path: '/api/v1/organizations/org-123/teams/team-456/members/user-789',
      })
      expect(result.sharded).toBe(true)
      expect(result.key).toBe('user-789') // Extracts last ID-like segment
    })

    it('should handle UUID-style keys', () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000'
      const result = router.route({
        namespace: 'acme',
        path: `/users/${uuid}`,
        entityId: uuid,
      })
      expect(result.key).toBe(uuid)
      expect(result.sharded).toBe(true)
    })

    it('should handle numeric-only keys', () => {
      const result = router.route({
        namespace: 'acme',
        path: '/users/12345',
        entityId: '12345',
      })
      expect(result.key).toBe('12345')
      expect(result.sharded).toBe(true)
    })

    it('should handle empty path segments', () => {
      const result = router.route({ namespace: 'acme', path: '//users//user-123//' })
      expect(result.sharded).toBe(true)
    })

    it('should handle root path without sharding', () => {
      const result = router.route({ namespace: 'acme', path: '/' })
      expect(result.sharded).toBe(false)
      expect(result.doName).toBe('acme')
    })

    it('should handle paths with only API prefixes', () => {
      const result = router.route({ namespace: 'acme', path: '/api/v1' })
      expect(result.sharded).toBe(false)
      expect(result.doName).toBe('acme')
    })
  })

  describe('ShardRouter namespace edge cases', () => {
    it('should handle namespaces with special characters', () => {
      const router = new ShardRouter({ defaultShardCount: 16 })
      const result = router.route({
        namespace: 'acme-corp',
        path: '/users/user-123',
        entityId: 'user-123',
      })
      expect(result.doName).toMatch(/^acme-corp:users:shard-\d+$/)
    })

    it('should handle numeric namespaces', () => {
      const router = new ShardRouter({ defaultShardCount: 16 })
      const result = router.route({
        namespace: '12345',
        path: '/users/user-123',
        entityId: 'user-123',
      })
      expect(result.doName).toMatch(/^12345:users:shard-\d+$/)
    })

    it('should handle very long namespaces', () => {
      const router = new ShardRouter({ defaultShardCount: 16 })
      const longNamespace = 'a'.repeat(100)
      const result = router.route({
        namespace: longNamespace,
        path: '/users/user-123',
        entityId: 'user-123',
      })
      expect(result.doName).toContain(longNamespace)
      expect(result.sharded).toBe(true)
    })

    it('should handle empty namespace with default behavior', () => {
      const router = new ShardRouter({ defaultShardCount: 16 })
      const result = router.route({
        namespace: '',
        path: '/users/user-123',
        entityId: 'user-123',
      })
      expect(result.doName).toMatch(/^:users:shard-\d+$/)
    })
  })

  describe('ShardRouter pattern matching edge cases', () => {
    it('should match exact path lengths', () => {
      const router = new ShardRouter({
        defaultShardCount: 16,
        keyExtractors: {
          '/api/*/users/*': (ctx) => ctx.params?.get('userId') || undefined,
        },
      })

      const params = new URLSearchParams('userId=custom-123')
      // Pattern has 4 segments, path has 4 segments - should match
      const result = router.route({
        namespace: 'acme',
        path: '/api/v1/users/user-123',
        params,
      })
      expect(result.key).toBe('custom-123')
    })

    it('should not match paths with different segment counts', () => {
      const router = new ShardRouter({
        defaultShardCount: 16,
        keyExtractors: {
          '/api/*/users': (ctx) => ctx.params?.get('userId') || undefined,
        },
      })

      const params = new URLSearchParams('userId=custom-123')
      // Pattern has 3 segments, path has 4 - should NOT match
      const result = router.route({
        namespace: 'acme',
        path: '/api/v1/users/extra',
        params,
      })
      // Should fall back to path extraction, not custom extractor
      expect(result.key).not.toBe('custom-123')
    })

    it('should handle multiple matching patterns (first match wins)', () => {
      const router = new ShardRouter({
        defaultShardCount: 16,
        keyExtractors: {
          '/api/*/users/*': () => 'first-match',
          '/api/v1/users/*': () => 'second-match',
        },
      })

      const result = router.route({
        namespace: 'acme',
        path: '/api/v1/users/user-123',
      })
      // Object iteration order should give us first-match
      expect(result.key).toBe('first-match')
    })
  })
})

// ============================================================================
// Load Balancing Edge Cases (do-ka77)
// ============================================================================

describe('Load balancing edge cases (do-ka77)', () => {
  describe('LoadMetricsStore edge cases', () => {
    it('should handle recording zero load', () => {
      const store = new LoadMetricsStore()
      store.recordLoad('acme:shard-0', 0)
      expect(store.getLoad('acme:shard-0')).toBe(0)
    })

    it('should handle negative load values gracefully', () => {
      const store = new LoadMetricsStore()
      store.recordLoad('acme:shard-0', -10)
      expect(store.getLoad('acme:shard-0')).toBe(-10)
    })

    it('should handle very large load values', () => {
      const store = new LoadMetricsStore()
      store.recordLoad('acme:shard-0', Number.MAX_SAFE_INTEGER)
      expect(store.getLoad('acme:shard-0')).toBe(Number.MAX_SAFE_INTEGER)
    })

    it('should handle concurrent request tracking', () => {
      const store = new LoadMetricsStore()

      // Simulate concurrent requests
      for (let i = 0; i < 100; i++) {
        store.recordRequest(`acme:shard-${i % 4}`)
      }

      const totalRequests =
        store.getLoad('acme:shard-0') +
        store.getLoad('acme:shard-1') +
        store.getLoad('acme:shard-2') +
        store.getLoad('acme:shard-3')

      expect(totalRequests).toBe(100)
    })

    it('should return snapshot of all loads', () => {
      const store = new LoadMetricsStore()
      store.recordLoad('shard-0', 10)
      store.recordLoad('shard-1', 20)
      store.recordLoad('shard-2', 30)

      const snapshot = store.getSnapshot()
      expect(snapshot).toEqual({
        'shard-0': 10,
        'shard-1': 20,
        'shard-2': 30,
      })
    })

    it('should not decay when interval not reached', () => {
      const store = new LoadMetricsStore({ decayIntervalMs: 10000 })
      store.recordLoad('shard-0', 100)

      // Immediate decay call should not reduce load
      store.applyDecay()
      expect(store.getLoad('shard-0')).toBe(100)
    })

    it('should handle metrics decay with floor rounding', () => {
      const store = new LoadMetricsStore({ decayIntervalMs: 1, decayFactor: 0.5 })
      store.recordLoad('shard-0', 7) // 7 * 0.5 = 3.5 -> floor to 3
      store.recordMetric('shard-0', 'requests', 5)

      // Wait for decay interval
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          store.applyDecay()
          expect(store.getLoad('shard-0')).toBe(3)
          expect(store.getMetric('shard-0', 'requests')).toBe(2)
          resolve()
        }, 10)
      })
    })

    it('should find least loaded with all zero loads', () => {
      const store = new LoadMetricsStore()
      // No loads recorded - all are 0

      const result = store.findLeastLoaded('acme', 'users', 4)
      expect(result.shardIndex).toBe(0) // First shard wins on tie
      expect(result.load).toBe(0)
    })

    it('should return zero composite load for unknown shard', () => {
      const store = new LoadMetricsStore()
      expect(store.getCompositeLoad('unknown:shard')).toBe(0)
    })
  })

  describe('LoadBalancedRouter edge cases', () => {
    it('should handle single shard configuration', () => {
      const metricsStore = new LoadMetricsStore()
      metricsStore.recordLoad('acme:users:shard-0', 100)

      const router = new LoadBalancedRouter({
        defaultShardCount: 1,
        metricsStore,
        strategy: 'least-loaded',
      })

      const result = router.route({ namespace: 'acme', path: '/users', entityType: 'users' })
      expect(result.shardIndex).toBe(0)
      expect(result.doName).toBe('acme:users:shard-0')
    })

    it('should handle round-robin strategy', () => {
      const router = new LoadBalancedRouter({
        defaultShardCount: 4,
        strategy: 'round-robin',
      })

      const shardIndices: number[] = []
      for (let i = 0; i < 8; i++) {
        const result = router.route({ namespace: 'acme', path: '/users', entityType: 'users' })
        shardIndices.push(result.shardIndex)
      }

      // Should cycle through 0,1,2,3,0,1,2,3
      expect(shardIndices).toEqual([0, 1, 2, 3, 0, 1, 2, 3])
    })

    it('should handle round-robin for different entity types independently', () => {
      const router = new LoadBalancedRouter({
        defaultShardCount: 4,
        strategy: 'round-robin',
      })

      // Route users
      const users1 = router.route({ namespace: 'acme', path: '/users', entityType: 'users' })
      const users2 = router.route({ namespace: 'acme', path: '/users', entityType: 'users' })

      // Route orders - should start fresh counter
      const orders1 = router.route({ namespace: 'acme', path: '/orders', entityType: 'orders' })
      const orders2 = router.route({ namespace: 'acme', path: '/orders', entityType: 'orders' })

      expect(users1.shardIndex).toBe(0)
      expect(users2.shardIndex).toBe(1)
      expect(orders1.shardIndex).toBe(0)
      expect(orders2.shardIndex).toBe(1)
    })

    it('should return loadBalanced=false when sharding disabled', () => {
      const router = new LoadBalancedRouter({
        defaultShardCount: 4,
        enabled: false,
      })

      const result = router.route({ namespace: 'acme', path: '/users', entityType: 'users' })
      expect(result.loadBalanced).toBe(false)
      expect(result.sharded).toBe(false)
      expect(result.doName).toBe('acme')
    })

    it('should use consistent hashing for keys even with load balancing', () => {
      const metricsStore = new LoadMetricsStore()
      metricsStore.recordLoad('acme:users:shard-0', 1000)
      metricsStore.recordLoad('acme:users:shard-1', 1)

      const router = new LoadBalancedRouter({
        defaultShardCount: 4,
        metricsStore,
        strategy: 'least-loaded',
      })

      // With explicit entityId, should use consistent hash, not load balancing
      const result = router.route({
        namespace: 'acme',
        path: '/users/user-123',
        entityType: 'users',
        entityId: 'user-123',
      })

      expect(result.loadBalanced).toBe(false)
      // Should be deterministic regardless of load
      const result2 = router.route({
        namespace: 'acme',
        path: '/users/user-123',
        entityType: 'users',
        entityId: 'user-123',
      })
      expect(result.doName).toBe(result2.doName)
    })

    it('should handle weighted strategy with missing weights', () => {
      const metricsStore = new LoadMetricsStore()
      metricsStore.recordLoad('acme:users:shard-0', 100)
      metricsStore.recordLoad('acme:users:shard-1', 100)
      metricsStore.recordLoad('acme:users:shard-2', 100)

      const router = new LoadBalancedRouter({
        defaultShardCount: 3,
        metricsStore,
        strategy: 'weighted',
        // Only shard-0 has explicit weight
        weights: { 'acme:users:shard-0': 2 },
      })

      const result = router.route({ namespace: 'acme', path: '/users', entityType: 'users' })
      // shard-0 has weight 2, effective load = 100/2 = 50
      // shard-1,2 have weight 1, effective load = 100/1 = 100
      expect(result.shardIndex).toBe(0)
    })

    it('should not emit telemetry for non-load-balanced routes', () => {
      const metricsStore = new LoadMetricsStore()
      const telemetryEvents: unknown[] = []

      const router = new LoadBalancedRouter({
        defaultShardCount: 4,
        metricsStore,
        strategy: 'least-loaded',
        onTelemetry: (event) => telemetryEvents.push(event),
      })

      // Route with entityId - uses consistent hash, not load balancing
      router.route({
        namespace: 'acme',
        path: '/users/user-123',
        entityType: 'users',
        entityId: 'user-123',
      })

      expect(telemetryEvents.length).toBe(0)
    })

    it('should include correct telemetry metadata', () => {
      const metricsStore = new LoadMetricsStore()
      metricsStore.recordLoad('acme:users:shard-0', 50)
      metricsStore.recordLoad('acme:users:shard-1', 25)

      let capturedEvent: unknown = null

      const router = new LoadBalancedRouter({
        defaultShardCount: 2,
        metricsStore,
        strategy: 'least-loaded',
        onTelemetry: (event) => { capturedEvent = event },
      })

      router.route({ namespace: 'acme', path: '/users', entityType: 'users' })

      expect(capturedEvent).toMatchObject({
        type: 'load_balance_decision',
        namespace: 'acme',
        entityType: 'users',
        selectedShard: 1,
        selectedDoName: 'acme:users:shard-1',
        strategy: 'least-loaded',
        timestamp: expect.any(Number),
        loadSnapshot: {
          'acme:users:shard-0': 50,
          'acme:users:shard-1': 25,
        },
      })
    })

    it('should get metrics store reference', () => {
      const metricsStore = new LoadMetricsStore()
      const router = new LoadBalancedRouter({ metricsStore })

      expect(router.getMetricsStore()).toBe(metricsStore)
    })

    it('should create default metrics store if not provided', () => {
      const router = new LoadBalancedRouter({})
      expect(router.getMetricsStore()).toBeInstanceOf(LoadMetricsStore)
    })

    it('should handle routing without entity type using namespace-only prefix', () => {
      const metricsStore = new LoadMetricsStore()
      metricsStore.recordLoad('acme:shard-0', 100)
      metricsStore.recordLoad('acme:shard-1', 10)

      const router = new LoadBalancedRouter({
        defaultShardCount: 2,
        metricsStore,
        strategy: 'least-loaded',
      })

      // No entityType, no path that extracts one - uses namespace-only prefix
      const result = router.route({ namespace: 'acme', path: '/' })
      // Should use load balancing with namespace-only prefix
      expect(result.doName).toBe('acme:shard-1') // shard-1 has lower load
      expect(result.sharded).toBe(true)
      expect(result.loadBalanced).toBe(true)
    })
  })

  describe('createLoadBalancedRouter', () => {
    it('should create router with default config', () => {
      const router = createLoadBalancedRouter()
      expect(router).toBeInstanceOf(LoadBalancedRouter)
    })

    it('should create router with custom config', () => {
      const metricsStore = new LoadMetricsStore()
      const router = createLoadBalancedRouter({
        defaultShardCount: 32,
        metricsStore,
        strategy: 'round-robin',
      })
      expect(router).toBeInstanceOf(LoadBalancedRouter)
      expect(router.getMetricsStore()).toBe(metricsStore)
    })
  })
})

// ============================================================================
// Shard Selection Boundary Tests (do-ka77)
// ============================================================================

describe('Shard selection boundary tests (do-ka77)', () => {
  describe('Hash distribution at boundaries', () => {
    it('should handle minimum valid shard count (1)', () => {
      const router = new ShardRouter({ defaultShardCount: 1 })
      const result = router.route({
        namespace: 'acme',
        path: '/users/user-123',
        entityId: 'user-123',
      })
      expect(result.shardIndex).toBe(0)
    })

    it('should handle large shard count (1000)', () => {
      const router = new ShardRouter({ defaultShardCount: 1000 })
      const shardsSeen = new Set<number>()

      for (let i = 0; i < 5000; i++) {
        const result = router.route({
          namespace: 'acme',
          path: `/users/user-${i}`,
          entityId: `user-${i}`,
        })
        shardsSeen.add(result.shardIndex)
      }

      // With 5000 keys across 1000 shards, we should hit a reasonable number
      // Hash collisions are expected, so we use a conservative threshold
      expect(shardsSeen.size).toBeGreaterThan(600)
    })

    it('should maintain consistency across router instances', () => {
      const router1 = new ShardRouter({ defaultShardCount: 16 })
      const router2 = new ShardRouter({ defaultShardCount: 16 })

      const ctx = {
        namespace: 'acme',
        path: '/users/user-123',
        entityId: 'user-123',
      }

      expect(router1.route(ctx).doName).toBe(router2.route(ctx).doName)
    })
  })

  describe('Load balanced shard selection boundaries', () => {
    it('should select shard 0 when all loads are equal and round-robin starts', () => {
      const metricsStore = new LoadMetricsStore()
      for (let i = 0; i < 4; i++) {
        metricsStore.recordLoad(`acme:users:shard-${i}`, 50)
      }

      const router = new LoadBalancedRouter({
        defaultShardCount: 4,
        metricsStore,
        strategy: 'least-loaded',
      })

      const result = router.route({ namespace: 'acme', path: '/users', entityType: 'users' })
      expect(result.shardIndex).toBe(0) // First in round-robin
    })

    it('should handle transition when load changes during routing', () => {
      const metricsStore = new LoadMetricsStore()
      metricsStore.recordLoad('acme:users:shard-0', 100)
      metricsStore.recordLoad('acme:users:shard-1', 50)

      const router = new LoadBalancedRouter({
        defaultShardCount: 2,
        metricsStore,
        strategy: 'least-loaded',
      })

      // First route goes to shard-1 (lower load)
      const result1 = router.route({ namespace: 'acme', path: '/users', entityType: 'users' })
      expect(result1.shardIndex).toBe(1)

      // Update load - now shard-0 is lower
      metricsStore.recordLoad('acme:users:shard-0', 10)
      metricsStore.recordLoad('acme:users:shard-1', 200)

      const result2 = router.route({ namespace: 'acme', path: '/users', entityType: 'users' })
      expect(result2.shardIndex).toBe(0)
    })

    it('should handle shard count mismatch between config and metrics', () => {
      const metricsStore = new LoadMetricsStore()
      // Only record load for 2 shards
      metricsStore.recordLoad('acme:users:shard-0', 100)
      metricsStore.recordLoad('acme:users:shard-1', 50)

      const router = new LoadBalancedRouter({
        defaultShardCount: 4, // But config says 4 shards
        metricsStore,
        strategy: 'least-loaded',
      })

      const result = router.route({ namespace: 'acme', path: '/users', entityType: 'users' })
      // Should select shard-2 or shard-3 which have 0 load
      expect([2, 3]).toContain(result.shardIndex)
    })
  })
})
