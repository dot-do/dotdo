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
