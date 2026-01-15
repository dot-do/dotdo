/**
 * R2 Tiering Integration Tests
 *
 * RED TDD Phase: Tests for wiring R2 buckets to TierManager/TieredStore.
 *
 * These tests verify:
 * 1. R2TierClient connects to real/mock R2 buckets correctly
 * 2. TieredStore promotes/demotes data across tiers with R2
 * 3. Policy-based automatic tiering integrates with R2 operations
 * 4. Multi-tier read fallback (hot -> warm -> cold) works correctly
 * 5. Batch operations for tier migration
 *
 * Architecture:
 * - Hot tier: DO SQLite (<1ms, ~100MB)
 * - Warm tier: R2 Parquet (~50ms, ~10GB)
 * - Cold tier: R2 Iceberg Archive (~100ms, unlimited)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  TieredStore,
  R2TierClient,
  PolicyEvaluator,
  ageBasedPolicy,
  batchMove,
  batchDelete,
  createTierMetadata,
  createTieredData,
  type TieredStoreOptions,
  type TieredData,
  type TierMetadata,
  type R2BucketLike,
  type R2ObjectLike,
  type R2PutOptions,
  type R2ListOptions,
  type R2ObjectsLike,
} from './index'

// ============================================================================
// MOCK R2 BUCKET
// ============================================================================

/**
 * Create a mock R2 bucket for testing
 * Simulates Cloudflare R2 bucket behavior
 */
function createMockR2Bucket(): R2BucketLike {
  const storage = new Map<string, { data: string; metadata?: Record<string, string> }>()

  return {
    async get(key: string): Promise<R2ObjectLike | null> {
      const item = storage.get(key)
      if (!item) return null

      return {
        key,
        size: item.data.length,
        etag: 'mock-etag',
        uploaded: new Date(),
        customMetadata: item.metadata,
        async arrayBuffer() {
          return new TextEncoder().encode(item.data).buffer
        },
        async text() {
          return item.data
        },
        async json<T = unknown>() {
          return JSON.parse(item.data) as T
        },
      }
    },
    async put(key: string, value: ArrayBuffer | string, options?: R2PutOptions): Promise<R2ObjectLike> {
      const data = typeof value === 'string' ? value : new TextDecoder().decode(value as ArrayBuffer)
      storage.set(key, { data, metadata: options?.customMetadata })
      return {
        key,
        size: data.length,
        etag: 'mock-etag',
        uploaded: new Date(),
        customMetadata: options?.customMetadata,
        async arrayBuffer() {
          return new TextEncoder().encode(data).buffer
        },
        async text() {
          return data
        },
        async json<T = unknown>() {
          return JSON.parse(data) as T
        },
      }
    },
    async delete(key: string | string[]): Promise<void> {
      const keys = Array.isArray(key) ? key : [key]
      for (const k of keys) {
        storage.delete(k)
      }
    },
    async list(options?: R2ListOptions): Promise<R2ObjectsLike> {
      const objects: Array<{ key: string; size: number; uploaded: Date }> = []
      for (const [key, item] of storage) {
        if (!options?.prefix || key.startsWith(options.prefix)) {
          objects.push({
            key,
            size: item.data.length,
            uploaded: new Date(),
          })
        }
      }
      return {
        objects: options?.limit ? objects.slice(0, options.limit) : objects,
        truncated: false,
      }
    },
    async head(key: string): Promise<R2ObjectLike | null> {
      const item = storage.get(key)
      if (!item) return null

      return {
        key,
        size: item.data.length,
        etag: 'mock-etag',
        uploaded: new Date(),
        customMetadata: item.metadata,
        async arrayBuffer() {
          return new TextEncoder().encode(item.data).buffer
        },
        async text() {
          return item.data
        },
        async json<T = unknown>() {
          return JSON.parse(item.data) as T
        },
      }
    },
  }
}

// ============================================================================
// R2 TIER CLIENT TESTS
// ============================================================================

describe('R2TierClient', () => {
  let warmBucket: R2BucketLike
  let coldBucket: R2BucketLike
  let client: R2TierClient<{ id: string; name: string }>

  beforeEach(() => {
    warmBucket = createMockR2Bucket()
    coldBucket = createMockR2Bucket()
    client = new R2TierClient({
      warm: warmBucket,
      cold: coldBucket,
      keyPrefix: 'test',
    })
  })

  describe('put', () => {
    it('should store data in warm tier', async () => {
      const result = await client.put('warm', 'doc:123', { id: '123', name: 'Test' })

      expect(result.success).toBe(true)
      expect(result.toTier).toBe('warm')
      expect(result.key).toBe('doc:123')
    })

    it('should store data in cold tier', async () => {
      const result = await client.put('cold', 'doc:456', { id: '456', name: 'Archive' })

      expect(result.success).toBe(true)
      expect(result.toTier).toBe('cold')
    })

    it('should include metadata with tier info', async () => {
      await client.put('warm', 'doc:789', { id: '789', name: 'Meta' }, {
        tier: 'warm',
        createdAt: Date.now(),
        accessCount: 5,
        lastAccess: Date.now(),
      })

      const retrieved = await client.get('warm', 'doc:789')
      expect(retrieved).not.toBeNull()
      expect(retrieved?.metadata.tier).toBe('warm')
    })

    it('should handle R2 bucket errors gracefully', async () => {
      const failingBucket = createMockR2Bucket()
      failingBucket.put = async () => {
        throw new Error('R2 write failed')
      }

      const failClient = new R2TierClient({ warm: failingBucket })
      const result = await failClient.put('warm', 'fail:1', { id: '1', name: 'Fail' })

      expect(result.success).toBe(false)
      expect(result.error).toContain('R2 write failed')
    })
  })

  describe('get', () => {
    it('should retrieve data from warm tier', async () => {
      await client.put('warm', 'doc:get1', { id: 'get1', name: 'Warmdata' })

      const result = await client.get('warm', 'doc:get1')

      expect(result).not.toBeNull()
      expect(result?.data.id).toBe('get1')
      expect(result?.data.name).toBe('Warmdata')
    })

    it('should retrieve data from cold tier', async () => {
      await client.put('cold', 'doc:get2', { id: 'get2', name: 'Colddata' })

      const result = await client.get('cold', 'doc:get2')

      expect(result).not.toBeNull()
      expect(result?.data.id).toBe('get2')
    })

    it('should return null for non-existent key', async () => {
      const result = await client.get('warm', 'nonexistent')

      expect(result).toBeNull()
    })
  })

  describe('getWithFallback', () => {
    it('should try warm tier first', async () => {
      await client.put('warm', 'doc:fb1', { id: 'fb1', name: 'Warm' })

      const result = await client.getWithFallback('doc:fb1')

      expect(result.tier).toBe('warm')
      expect(result.data?.data.name).toBe('Warm')
    })

    it('should fall back to cold tier if not in warm', async () => {
      await client.put('cold', 'doc:fb2', { id: 'fb2', name: 'Cold' })

      const result = await client.getWithFallback('doc:fb2')

      expect(result.tier).toBe('cold')
      expect(result.data?.data.name).toBe('Cold')
    })

    it('should return null if not found in any tier', async () => {
      const result = await client.getWithFallback('doc:fb3')

      expect(result.data).toBeNull()
      expect(result.tier).toBeNull()
    })
  })

  describe('move', () => {
    it('should move data from warm to cold', async () => {
      await client.put('warm', 'doc:mv1', { id: 'mv1', name: 'ToMove' })

      const result = await client.move('doc:mv1', 'warm', 'cold')

      expect(result.success).toBe(true)
      expect(result.fromTier).toBe('warm')
      expect(result.toTier).toBe('cold')

      // Verify data moved
      const warmData = await client.get('warm', 'doc:mv1')
      const coldData = await client.get('cold', 'doc:mv1')
      expect(warmData).toBeNull()
      expect(coldData?.data.name).toBe('ToMove')
    })

    it('should move data from cold to warm (restore)', async () => {
      await client.put('cold', 'doc:mv2', { id: 'mv2', name: 'ToRestore' })

      const result = await client.move('doc:mv2', 'cold', 'warm')

      expect(result.success).toBe(true)
      expect(result.fromTier).toBe('cold')
      expect(result.toTier).toBe('warm')
    })

    it('should fail if source data not found', async () => {
      const result = await client.move('nonexistent', 'warm', 'cold')

      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })
  })

  describe('delete', () => {
    it('should delete data from warm tier', async () => {
      await client.put('warm', 'doc:del1', { id: 'del1', name: 'ToDelete' })

      const result = await client.delete('warm', 'doc:del1')

      expect(result.success).toBe(true)

      const check = await client.get('warm', 'doc:del1')
      expect(check).toBeNull()
    })

    it('should delete data from all tiers', async () => {
      await client.put('warm', 'doc:delall', { id: 'delall', name: 'Everywhere' })
      await client.put('cold', 'doc:delall', { id: 'delall', name: 'Everywhere' })

      const result = await client.deleteFromAll('doc:delall')

      expect(result.succeeded).toBe(2)
      expect(await client.get('warm', 'doc:delall')).toBeNull()
      expect(await client.get('cold', 'doc:delall')).toBeNull()
    })
  })

  describe('list', () => {
    it('should list keys in warm tier', async () => {
      await client.put('warm', 'doc:list1', { id: 'list1', name: 'One' })
      await client.put('warm', 'doc:list2', { id: 'list2', name: 'Two' })
      await client.put('warm', 'doc:list3', { id: 'list3', name: 'Three' })

      const result = await client.list('warm')

      expect(result.keys.length).toBe(3)
    })

    it('should list keys with prefix filter', async () => {
      await client.put('warm', 'users:1', { id: '1', name: 'User1' })
      await client.put('warm', 'users:2', { id: '2', name: 'User2' })
      await client.put('warm', 'orders:1', { id: '1', name: 'Order1' })

      const result = await client.list('warm', { prefix: 'users' })

      // Note: prefix includes the keyPrefix already set
      expect(result.keys.some((k) => k.includes('users'))).toBe(true)
    })

    it('should respect limit option', async () => {
      await client.put('warm', 'lim:1', { id: '1', name: 'A' })
      await client.put('warm', 'lim:2', { id: '2', name: 'B' })
      await client.put('warm', 'lim:3', { id: '3', name: 'C' })

      const result = await client.list('warm', { limit: 2 })

      expect(result.keys.length).toBeLessThanOrEqual(2)
    })
  })

  describe('exists', () => {
    it('should return true for existing key', async () => {
      await client.put('warm', 'doc:exists', { id: 'exists', name: 'Yes' })

      const exists = await client.exists('warm', 'doc:exists')

      expect(exists).toBe(true)
    })

    it('should return false for non-existent key', async () => {
      const exists = await client.exists('warm', 'doc:noexist')

      expect(exists).toBe(false)
    })
  })

  describe('getMetadata', () => {
    it('should retrieve metadata without full data', async () => {
      await client.put('warm', 'doc:meta', { id: 'meta', name: 'Metadata' }, {
        tier: 'warm',
        createdAt: 1000,
        accessCount: 10,
        lastAccess: 2000,
      })

      const metadata = await client.getMetadata('warm', 'doc:meta')

      expect(metadata).not.toBeNull()
      expect(metadata?.tier).toBe('warm')
    })
  })

  describe('buildPartitionedKey', () => {
    it('should build Iceberg-style partitioned key', () => {
      const date = new Date('2024-01-15')
      const key = client.buildPartitionedKey('user:123', 'User', date)

      expect(key).toMatch(/type=User/)
      expect(key).toMatch(/dt=2024-01/)
      expect(key).toMatch(/user:123\.json$/)
    })
  })
})

// ============================================================================
// BATCH OPERATIONS TESTS
// ============================================================================

describe('Batch Operations', () => {
  let warmBucket: R2BucketLike
  let coldBucket: R2BucketLike
  let client: R2TierClient<{ id: string }>

  beforeEach(async () => {
    warmBucket = createMockR2Bucket()
    coldBucket = createMockR2Bucket()
    client = new R2TierClient({ warm: warmBucket, cold: coldBucket })

    // Seed data
    for (let i = 0; i < 10; i++) {
      await client.put('warm', `batch:${i}`, { id: `${i}` })
    }
  })

  describe('batchMove', () => {
    it('should move multiple keys in batch', async () => {
      const keys = ['batch:0', 'batch:1', 'batch:2']

      const result = await batchMove(client, keys, 'warm', 'cold')

      expect(result.total).toBe(3)
      expect(result.succeeded).toBe(3)
      expect(result.failed).toBe(0)
    })

    it('should handle partial failures', async () => {
      // One key doesn't exist
      const keys = ['batch:0', 'nonexistent', 'batch:2']

      const result = await batchMove(client, keys, 'warm', 'cold')

      expect(result.succeeded).toBe(2)
      expect(result.failed).toBe(1)
    })

    it('should respect concurrency limit', async () => {
      const keys = Array.from({ length: 25 }, (_, i) => `batch:${i}`)
      // Only 10 exist, but this tests concurrency batching
      const result = await batchMove(client, keys, 'warm', 'cold', { concurrency: 5 })

      // Should complete without blocking
      expect(result.total).toBe(25)
    })
  })

  describe('batchDelete', () => {
    it('should delete multiple keys in batch', async () => {
      const keys = ['batch:5', 'batch:6', 'batch:7']

      const result = await batchDelete(client, keys, 'warm')

      expect(result.succeeded).toBe(3)

      for (const key of keys) {
        expect(await client.exists('warm', key)).toBe(false)
      }
    })
  })
})

// ============================================================================
// TIERED STORE INTEGRATION TESTS
// ============================================================================

/**
 * Concrete implementation of TieredStore for testing
 */
class TestTieredStore extends TieredStore<{ id: string; data: string }> {
  private hotStorage = new Map<string, TieredData<{ id: string; data: string }>>()

  constructor(options: TieredStoreOptions) {
    super(options)
  }

  protected async getFromHot(key: string): Promise<TieredData<{ id: string; data: string }> | null> {
    return this.hotStorage.get(key) ?? null
  }

  protected async putToHot(key: string, data: TieredData<{ id: string; data: string }>): Promise<void> {
    this.hotStorage.set(key, data)
  }

  protected async deleteFromHot(key: string): Promise<void> {
    this.hotStorage.delete(key)
  }

  protected async listHotKeys(options?: { prefix?: string; limit?: number }): Promise<string[]> {
    const keys = Array.from(this.hotStorage.keys())
    const filtered = options?.prefix
      ? keys.filter((k) => k.startsWith(options.prefix!))
      : keys
    return options?.limit ? filtered.slice(0, options.limit) : filtered
  }

  protected async getHotMetadata(key: string): Promise<TierMetadata | null> {
    const data = this.hotStorage.get(key)
    return data?.metadata ?? null
  }

  // Expose hot storage for test assertions
  getHotStorageSize(): number {
    return this.hotStorage.size
  }
}

describe('TieredStore Integration', () => {
  let warmBucket: R2BucketLike
  let coldBucket: R2BucketLike
  let store: TestTieredStore

  beforeEach(() => {
    warmBucket = createMockR2Bucket()
    coldBucket = createMockR2Bucket()
    store = new TestTieredStore({
      policy: ageBasedPolicy(7, 90),
      r2Warm: warmBucket,
      r2Cold: coldBucket,
      keyPrefix: 'test-store',
    })
  })

  describe('put and get', () => {
    it('should store data in hot tier by default', async () => {
      await store.put('doc:1', { id: '1', data: 'hot data' })

      const result = await store.get('doc:1')

      expect(result).not.toBeNull()
      expect(result?.tier).toBe('hot')
      expect(result?.data.data).toBe('hot data')
    })

    it('should read from warm tier when not in hot', async () => {
      // Put directly to warm via internal R2 client
      await store.put('doc:2', { id: '2', data: 'warm data' })
      await store.tierToWarm('doc:2')

      const result = await store.get('doc:2')

      expect(result).not.toBeNull()
      expect(result?.tier).toBe('warm')
    })

    it('should read from cold tier with fallback', async () => {
      await store.put('doc:3', { id: '3', data: 'cold data' })
      await store.tierToWarm('doc:3')
      await store.tierToCold('doc:3')

      const result = await store.get('doc:3')

      expect(result).not.toBeNull()
      expect(result?.tier).toBe('cold')
    })
  })

  describe('tierToWarm', () => {
    it('should move data from hot to warm tier', async () => {
      await store.put('tier:1', { id: '1', data: 'moving to warm' })

      const result = await store.tierToWarm('tier:1')

      expect(result.success).toBe(true)
      expect(result.fromTier).toBe('hot')
      expect(result.toTier).toBe('warm')

      // Verify data moved
      const fromHot = await store.get('tier:1')
      expect(fromHot?.tier).toBe('warm')
    })

    it('should fail if data not in hot tier', async () => {
      const result = await store.tierToWarm('nonexistent')

      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })

    it('should remove data from hot tier after tiering', async () => {
      await store.put('tier:2', { id: '2', data: 'to remove' })
      const initialSize = store.getHotStorageSize()

      await store.tierToWarm('tier:2')

      expect(store.getHotStorageSize()).toBe(initialSize - 1)
    })
  })

  describe('tierToCold', () => {
    it('should move data from warm to cold tier', async () => {
      await store.put('tier:c1', { id: 'c1', data: 'to cold' })
      await store.tierToWarm('tier:c1')

      const result = await store.tierToCold('tier:c1')

      expect(result.success).toBe(true)
      expect(result.fromTier).toBe('warm')
      expect(result.toTier).toBe('cold')
    })
  })

  describe('promoteToHot', () => {
    it('should promote data from warm back to hot', async () => {
      await store.put('promo:1', { id: 'p1', data: 'promote me' })
      await store.tierToWarm('promo:1')

      const result = await store.promoteToHot('promo:1')

      expect(result.success).toBe(true)
      expect(result.fromTier).toBe('warm')
      expect(result.toTier).toBe('hot')

      // Verify data back in hot
      const check = await store.get('promo:1')
      expect(check?.tier).toBe('hot')
    })
  })

  describe('restoreFromCold', () => {
    it('should restore data from cold to warm', async () => {
      await store.put('restore:1', { id: 'r1', data: 'restore me' })
      await store.tierToWarm('restore:1')
      await store.tierToCold('restore:1')

      const result = await store.restoreFromCold('restore:1')

      expect(result.success).toBe(true)
      expect(result.fromTier).toBe('cold')
      expect(result.toTier).toBe('warm')
    })
  })

  describe('delete', () => {
    it('should delete data from all tiers', async () => {
      await store.put('del:1', { id: 'd1', data: 'delete me' })
      await store.tierToWarm('del:1')

      // Put another copy in cold
      await store.put('del:1', { id: 'd1', data: 'delete me' })
      await store.tierToWarm('del:1')
      await store.tierToCold('del:1')

      await store.delete('del:1')

      const result = await store.get('del:1')
      expect(result).toBeNull()
    })
  })

  describe('fetchFromWarm and fetchFromCold', () => {
    it('should fetch directly from warm tier', async () => {
      await store.put('fetch:w', { id: 'fw', data: 'warm fetch' })
      await store.tierToWarm('fetch:w')

      const data = await store.fetchFromWarm('fetch:w')

      expect(data).not.toBeNull()
      expect(data?.data).toBe('warm fetch')
    })

    it('should fetch directly from cold tier', async () => {
      await store.put('fetch:c', { id: 'fc', data: 'cold fetch' })
      await store.tierToWarm('fetch:c')
      await store.tierToCold('fetch:c')

      const data = await store.fetchFromCold('fetch:c')

      expect(data).not.toBeNull()
      expect(data?.data).toBe('cold fetch')
    })
  })

  describe('shouldTier', () => {
    it('should return warm for data older than warm threshold', () => {
      const oldMetadata = createTierMetadata('hot')
      oldMetadata.createdAt = Date.now() - 10 * 24 * 60 * 60 * 1000 // 10 days ago

      const targetTier = store.shouldTier(oldMetadata)

      expect(targetTier).toBe('warm')
    })

    it('should return cold for data older than cold threshold', () => {
      const veryOldMetadata = createTierMetadata('warm')
      veryOldMetadata.createdAt = Date.now() - 100 * 24 * 60 * 60 * 1000 // 100 days ago

      const targetTier = store.shouldTier(veryOldMetadata)

      expect(targetTier).toBe('cold')
    })

    it('should return null for recent data', () => {
      const recentMetadata = createTierMetadata('hot')
      recentMetadata.createdAt = Date.now() - 1000 // 1 second ago

      const targetTier = store.shouldTier(recentMetadata)

      expect(targetTier).toBeNull()
    })
  })

  describe('runTieringBatch', () => {
    it('should evaluate and tier multiple items', async () => {
      // Create old data
      for (let i = 0; i < 5; i++) {
        await store.put(`batch:${i}`, { id: `${i}`, data: `old ${i}` })
      }

      // Manually age the data in hot storage (simulate passage of time)
      vi.useFakeTimers()
      const now = Date.now()
      vi.setSystemTime(now + 10 * 24 * 60 * 60 * 1000) // Advance 10 days

      const result = await store.runTieringBatch({ limit: 10 })

      vi.useRealTimers()

      expect(result.evaluated).toBeGreaterThan(0)
    })

    it('should support dry run mode', async () => {
      await store.put('dry:1', { id: 'd1', data: 'dry run' })

      vi.useFakeTimers()
      vi.setSystemTime(Date.now() + 10 * 24 * 60 * 60 * 1000)

      const result = await store.runTieringBatch({ dryRun: true })

      vi.useRealTimers()

      // Dry run should not actually move data
      expect(store.getHotStorageSize()).toBeGreaterThan(0)
    })
  })

  describe('getStats', () => {
    it('should return statistics for all tiers', async () => {
      await store.put('stat:1', { id: 's1', data: 'hot' })
      await store.put('stat:2', { id: 's2', data: 'warm' })
      await store.tierToWarm('stat:2')

      const stats = await store.getStats()

      expect(stats.hotKeys).toBeGreaterThanOrEqual(1)
      expect(stats.warmKeys).toBeGreaterThanOrEqual(0)
    })
  })
})

// ============================================================================
// POLICY EVALUATOR WITH R2 TESTS
// ============================================================================

describe('PolicyEvaluator with R2 Integration', () => {
  let evaluator: PolicyEvaluator

  beforeEach(() => {
    evaluator = new PolicyEvaluator(ageBasedPolicy(7, 90))
  })

  it('should evaluate tiering decisions consistently', () => {
    const now = Date.now()

    // Hot data (< 7 days)
    const hotMeta = createTierMetadata('hot')
    hotMeta.createdAt = now - 3 * 24 * 60 * 60 * 1000 // 3 days ago
    expect(evaluator.evaluate(hotMeta, now)).toBeNull()

    // Warm candidate (7-90 days)
    const warmMeta = createTierMetadata('hot')
    warmMeta.createdAt = now - 30 * 24 * 60 * 60 * 1000 // 30 days ago
    expect(evaluator.evaluate(warmMeta, now)).toBe('warm')

    // Cold candidate (> 90 days)
    const coldMeta = createTierMetadata('warm')
    coldMeta.createdAt = now - 100 * 24 * 60 * 60 * 1000 // 100 days ago
    expect(evaluator.evaluate(coldMeta, now)).toBe('cold')
  })

  it('should provide time until warm tier', () => {
    const metadata = createTierMetadata('hot')
    metadata.createdAt = Date.now() - 3 * 24 * 60 * 60 * 1000 // 3 days ago

    const timeUntil = evaluator.timeUntilWarm(metadata)

    expect(timeUntil).not.toBeNull()
    expect(timeUntil).toBeGreaterThan(0) // Should be about 4 days
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('R2 Error Handling', () => {
  it('should handle R2 bucket not configured', async () => {
    const client = new R2TierClient<{ id: string }>({})

    const result = await client.put('warm', 'key', { id: '1' })

    // R2TierClient returns error result instead of throwing
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/bucket.*configured/i)
  })

  it('should handle concurrent R2 operations', async () => {
    const bucket = createMockR2Bucket()
    const client = new R2TierClient({ warm: bucket })

    const operations = Array.from({ length: 50 }, (_, i) =>
      client.put('warm', `concurrent:${i}`, { id: `${i}` })
    )

    const results = await Promise.all(operations)

    expect(results.every((r) => r.success)).toBe(true)
  })

  it('should handle large data gracefully', async () => {
    const bucket = createMockR2Bucket()
    const client = new R2TierClient<{ id: string; largeField: string }>({ warm: bucket })

    const largeData = {
      id: 'large',
      largeField: 'x'.repeat(10 * 1024 * 1024), // 10MB
    }

    const result = await client.put('warm', 'large:1', largeData)

    expect(result.success).toBe(true)
  })
})
