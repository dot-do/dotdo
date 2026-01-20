import { describe, it, expect, beforeEach } from 'vitest'
import {
  ShardRouter,
  createShardRouter,
  fnv1aHash,
  getShardIndex,
  extractUserIdFromHeader,
  extractShardFromQuery,
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

    // Generate diverse keys (UUIDs) to test that multiple shards are used
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

    // With 16 diverse keys across 16 shards, we should use at least 4 different shards
    // This verifies the hash function provides reasonable distribution
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
      entityShards: {
        users: 32,
        orders: 64,
        analytics: 4,
      },
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
      const result = router.route({
        namespace: 'acme',
        path: '/',
      })

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
      expect(result.shardIndex).toBeLessThan(32) // users has 32 shards
    })

    it('should extract entity type from path', () => {
      const result = router.route({
        namespace: 'acme',
        path: '/users/user-456',
      })

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
      const result = router.route({
        namespace: 'acme',
        path: '/api/v1/orders/order-789',
      })

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
      const disabledRouter = new ShardRouter({
        defaultShardCount: 16,
        enabled: false,
      })

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
      const customRouter = new ShardRouter({
        defaultShardCount: 16,
        separator: '-',
      })

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
        keyExtractors: {
          '/api/*/search': (ctx) => ctx.params?.get('tenant') || undefined,
        },
      })

      const params = new URLSearchParams('tenant=tenant-abc&q=hello')
      const result = customRouter.route({
        namespace: 'acme',
        path: '/api/v1/search',
        params,
      })

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
    const router = createShardRouter({
      defaultShardCount: 32,
      entityShards: { products: 8 },
    })

    expect(router.getShardCount()).toBe(32)
    expect(router.getShardCount('products')).toBe(8)
  })
})

describe('extractUserIdFromHeader', () => {
  it('should extract X-User-ID header', () => {
    const headers = new Headers({ 'X-User-ID': 'user-123' })
    const ctx: ShardContext = {
      namespace: 'acme',
      path: '/api/data',
      headers,
    }

    expect(extractUserIdFromHeader(ctx)).toBe('user-123')
  })

  it('should fall back to Authorization bearer token', () => {
    const headers = new Headers({ Authorization: 'Bearer token-abc' })
    const ctx: ShardContext = {
      namespace: 'acme',
      path: '/api/data',
      headers,
    }

    expect(extractUserIdFromHeader(ctx)).toBe('token-abc')
  })

  it('should return undefined when no headers', () => {
    const ctx: ShardContext = {
      namespace: 'acme',
      path: '/api/data',
    }

    expect(extractUserIdFromHeader(ctx)).toBeUndefined()
  })
})

describe('extractShardFromQuery', () => {
  it('should extract query parameter', () => {
    const params = new URLSearchParams('tenant_id=tenant-xyz')
    const ctx: ShardContext = {
      namespace: 'acme',
      path: '/search',
      params,
    }

    const extractor = extractShardFromQuery('tenant_id')
    expect(extractor(ctx)).toBe('tenant-xyz')
  })

  it('should return undefined when param missing', () => {
    const params = new URLSearchParams('other=value')
    const ctx: ShardContext = {
      namespace: 'acme',
      path: '/search',
      params,
    }

    const extractor = extractShardFromQuery('tenant_id')
    expect(extractor(ctx)).toBeUndefined()
  })
})

describe('ShardRouter integration scenarios', () => {
  describe('Multi-tenant SaaS scenario', () => {
    it('should shard users by user ID within tenant', () => {
      const router = new ShardRouter({
        defaultShardCount: 16,
        entityShards: {
          users: 32,
        },
      })

      // Different users in same tenant go to different shards
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

      // Both are in acme:users:shard-X namespace
      expect(user1.doName).toMatch(/^acme:users:shard-\d+$/)
      expect(user2.doName).toMatch(/^acme:users:shard-\d+$/)

      // Same user always routes to same shard
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
      const router = new ShardRouter({
        defaultShardCount: 16,
        entityShards: {
          analytics: 4, // Fewer shards for better aggregation
        },
      })

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
      const router = new ShardRouter({
        defaultShardCount: 16,
        entityShards: {
          orders: 128, // More shards for high-volume orders
        },
      })

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
