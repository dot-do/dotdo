/**
 * Integration Tests for Tiered Storage with Real R2 Bindings
 *
 * These tests use @cloudflare/vitest-pool-workers with miniflare's in-memory R2
 * to test the tiered storage system with real R2 operations rather than mocks.
 *
 * Test coverage:
 * 1. R2StorageLayer operations (get, put, delete, list, has)
 * 2. TieredStorageAdapter with real R2 cold tier
 * 3. Tiered caching behavior (hot -> warm -> cold fallback)
 * 4. Promotion and demotion between tiers
 * 5. Statistics tracking across tiers
 *
 * @module db/tests/tiered-storage-integration.test.ts
 */

import { env } from 'cloudflare:test'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  CacheLayer,
  R2StorageLayer,
  TieredStorageAdapter,
  createTieredStorageAdapter,
  type CacheLayerConfig,
  type PromotionEvent,
  type DemotionEvent,
} from '../tiered-storage'
import { createMemoryStorageAdapter } from '../adapters/memory'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Test environment with R2 binding
 */
interface TieredStorageTestEnv {
  R2_STORAGE: R2Bucket
}

// Cast env to typed version
const testEnv = env as unknown as TieredStorageTestEnv

/**
 * Generate a unique test prefix for isolation
 */
function generateTestPrefix(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2)}/`
}

/**
 * Mock Cache implementation for testing CacheLayer
 * (Cache API is not available in miniflare test environment)
 */
class MockCache implements Cache {
  private store = new Map<string, Response>()

  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    const url = typeof request === 'string' ? request : request instanceof URL ? request.toString() : request.url
    const response = this.store.get(url)
    if (response) {
      return response.clone()
    }
    return undefined
  }

  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    const url = typeof request === 'string' ? request : request instanceof URL ? request.toString() : request.url
    this.store.set(url, response.clone())
  }

  async delete(request: RequestInfo | URL): Promise<boolean> {
    const url = typeof request === 'string' ? request : request instanceof URL ? request.toString() : request.url
    return this.store.delete(url)
  }

  async add(): Promise<void> {
    throw new Error('Not implemented')
  }

  async addAll(): Promise<void> {
    throw new Error('Not implemented')
  }

  async keys(): Promise<readonly Request[]> {
    return Array.from(this.store.keys()).map((url) => new Request(url))
  }

  async matchAll(): Promise<readonly Response[]> {
    return Array.from(this.store.values()).map((r) => r.clone())
  }

  clear(): void {
    this.store.clear()
  }
}

// ============================================================================
// R2 STORAGE LAYER INTEGRATION TESTS
// ============================================================================

describe('R2StorageLayer Integration Tests', () => {
  let r2Layer: R2StorageLayer
  let testPrefix: string

  beforeEach(() => {
    testPrefix = generateTestPrefix()
    r2Layer = new R2StorageLayer({
      bucket: testEnv.R2_STORAGE,
      prefix: testPrefix,
    })
  })

  describe('Basic R2 Operations', () => {
    it('should put and get data from real R2', async () => {
      const testData = { name: 'Alice', age: 30, nested: { value: true } }

      await r2Layer.put('user:123', testData)
      const result = await r2Layer.get<typeof testData>('user:123')

      expect(result).toEqual(testData)
    })

    it('should return undefined for non-existent key', async () => {
      const result = await r2Layer.get('non-existent-key-12345')

      expect(result).toBeUndefined()
    })

    it('should check if key exists with has()', async () => {
      await r2Layer.put('exists-test', { exists: true })

      expect(await r2Layer.has('exists-test')).toBe(true)
      expect(await r2Layer.has('does-not-exist')).toBe(false)
    })

    it('should delete key from R2', async () => {
      await r2Layer.put('to-delete', { delete: 'me' })
      expect(await r2Layer.has('to-delete')).toBe(true)

      await r2Layer.delete('to-delete')

      expect(await r2Layer.has('to-delete')).toBe(false)
    })

    it('should handle update (overwrite) of existing key', async () => {
      await r2Layer.put('update-key', { version: 1 })
      await r2Layer.put('update-key', { version: 2, updated: true })

      const result = await r2Layer.get<{ version: number; updated?: boolean }>('update-key')

      expect(result).toEqual({ version: 2, updated: true })
    })
  })

  describe('R2 List Operations', () => {
    it('should list keys with prefix stripped', async () => {
      await r2Layer.put('list:a', { value: 'a' })
      await r2Layer.put('list:b', { value: 'b' })
      await r2Layer.put('list:c', { value: 'c' })

      const result = await r2Layer.list()

      expect(result.keys).toContain('list:a')
      expect(result.keys).toContain('list:b')
      expect(result.keys).toContain('list:c')
      expect(result.truncated).toBe(false)
    })

    it('should paginate list results', async () => {
      // Create more items than page size
      for (let i = 0; i < 5; i++) {
        await r2Layer.put(`page:item-${i}`, { index: i })
      }

      const page1 = await r2Layer.list({ limit: 2 })
      expect(page1.keys.length).toBe(2)
      expect(page1.truncated).toBe(true)
      expect(page1.cursor).toBeDefined()

      const page2 = await r2Layer.list({ limit: 2, cursor: page1.cursor })
      expect(page2.keys.length).toBe(2)

      // Verify no overlap between pages
      const page1Keys = new Set(page1.keys)
      for (const key of page2.keys) {
        expect(page1Keys.has(key)).toBe(false)
      }
    })
  })

  describe('R2 Statistics', () => {
    it('should track read statistics', async () => {
      await r2Layer.put('stats:read', { data: 'test' })

      r2Layer.resetStats()

      await r2Layer.get('stats:read')
      await r2Layer.get('stats:read')

      const stats = r2Layer.getStats()
      expect(stats.reads).toBe(2)
    })

    it('should track write statistics', async () => {
      r2Layer.resetStats()

      await r2Layer.put('stats:write1', { data: 'test1' })
      await r2Layer.put('stats:write2', { data: 'test2' })

      const stats = r2Layer.getStats()
      expect(stats.writes).toBe(2)
    })

    it('should track delete statistics', async () => {
      await r2Layer.put('stats:delete', { data: 'delete me' })

      r2Layer.resetStats()

      await r2Layer.delete('stats:delete')

      const stats = r2Layer.getStats()
      expect(stats.deletes).toBe(1)
    })

    it('should track bytes read and written', async () => {
      const testData = { largeField: 'x'.repeat(1000) }

      r2Layer.resetStats()

      await r2Layer.put('stats:bytes', testData)
      await r2Layer.get('stats:bytes')

      const stats = r2Layer.getStats()
      expect(stats.bytesWritten).toBeGreaterThan(1000)
      expect(stats.bytesRead).toBeGreaterThan(1000)
    })
  })

  describe('R2 Large Data Handling', () => {
    it('should handle 100KB payload', async () => {
      const largeData = {
        id: 'large-100kb',
        payload: 'x'.repeat(100 * 1024),
      }

      await r2Layer.put('large:100kb', largeData)
      const result = await r2Layer.get<typeof largeData>('large:100kb')

      expect(result?.id).toBe('large-100kb')
      expect(result?.payload.length).toBe(100 * 1024)
    })

    it('should handle 1MB payload', async () => {
      const largeData = {
        id: 'large-1mb',
        payload: 'y'.repeat(1024 * 1024),
      }

      await r2Layer.put('large:1mb', largeData)
      const result = await r2Layer.get<typeof largeData>('large:1mb')

      expect(result?.id).toBe('large-1mb')
      expect(result?.payload.length).toBe(1024 * 1024)
    })

    it('should handle complex nested structures', async () => {
      const complexData = {
        id: 'complex',
        arrays: [[1, 2, 3], ['a', 'b', 'c'], [{ nested: true }]],
        objects: {
          level1: {
            level2: {
              level3: {
                value: 'deep',
              },
            },
          },
        },
        special: {
          nullValue: null,
          boolTrue: true,
          boolFalse: false,
          number: 42.5,
          emptyArray: [],
          emptyObject: {},
        },
      }

      await r2Layer.put('complex:data', complexData)
      const result = await r2Layer.get<typeof complexData>('complex:data')

      expect(result).toEqual(complexData)
    })
  })

  describe('R2 Concurrent Operations', () => {
    it('should handle concurrent writes', async () => {
      const writePromises = Array.from({ length: 10 }, (_, i) =>
        r2Layer.put(`concurrent:write-${i}`, { index: i })
      )

      await Promise.all(writePromises)

      // Verify all writes succeeded
      for (let i = 0; i < 10; i++) {
        const result = await r2Layer.get<{ index: number }>(`concurrent:write-${i}`)
        expect(result?.index).toBe(i)
      }
    })

    it('should handle concurrent reads', async () => {
      await r2Layer.put('concurrent:read', { data: 'concurrent test' })

      const readPromises = Array.from({ length: 10 }, () =>
        r2Layer.get<{ data: string }>('concurrent:read')
      )

      const results = await Promise.all(readPromises)

      for (const result of results) {
        expect(result?.data).toBe('concurrent test')
      }
    })

    it('should handle mixed concurrent operations', async () => {
      // Setup initial data
      await r2Layer.put('mixed:initial', { value: 'initial' })

      // Run mixed operations
      const operations = [
        r2Layer.put('mixed:new1', { value: 'new1' }),
        r2Layer.put('mixed:new2', { value: 'new2' }),
        r2Layer.get<{ value: string }>('mixed:initial'),
        r2Layer.has('mixed:initial'),
        r2Layer.has('mixed:missing'),
      ]

      const results = await Promise.all(operations)

      // Verify mixed results
      expect(results[2]).toEqual({ value: 'initial' })
      expect(results[3]).toBe(true)
      expect(results[4]).toBe(false)
    })
  })
})

// ============================================================================
// TIERED STORAGE ADAPTER INTEGRATION TESTS
// ============================================================================

describe('TieredStorageAdapter Integration Tests', () => {
  let mockCache: MockCache
  let cacheLayer: CacheLayer
  let doStorage: ReturnType<typeof createMemoryStorageAdapter>
  let r2Layer: R2StorageLayer
  let tieredStorage: TieredStorageAdapter
  let testPrefix: string

  beforeEach(() => {
    testPrefix = generateTestPrefix()

    // Set up cache layer (hot tier) with mock
    mockCache = new MockCache()
    cacheLayer = new CacheLayer(mockCache, {
      cacheName: 'test-cache',
      ttlSeconds: 300,
      baseUrl: 'https://cache.test.dev',
    })

    // Set up DO storage (warm tier) with memory adapter
    doStorage = createMemoryStorageAdapter()

    // Set up R2 layer (cold tier) with real R2
    r2Layer = new R2StorageLayer({
      bucket: testEnv.R2_STORAGE,
      prefix: testPrefix,
    })

    // Create tiered storage
    tieredStorage = createTieredStorageAdapter({
      cacheLayer,
      doStorage,
      r2Layer,
      promotionThreshold: 3,
      autoPromote: false,
    })
  })

  describe('Tiered Storage Tier Assignment', () => {
    it('should write to warm tier (DO) by default', async () => {
      await tieredStorage.put('default-tier', { data: 'test' })

      const location = await tieredStorage.locateKey('default-tier')
      expect(location.found).toBe(true)
      expect(location.tier).toBe('warm')
    })

    it('should write to hot tier when specified', async () => {
      await tieredStorage.put('hot-tier', { data: 'hot' }, { tier: 'hot' })

      const location = await tieredStorage.locateKey('hot-tier')
      expect(location.found).toBe(true)
      expect(location.tier).toBe('hot')
    })

    it('should write to cold tier (R2) when specified', async () => {
      await tieredStorage.put('cold-tier', { data: 'cold' }, { tier: 'cold' })

      const location = await tieredStorage.locateKey('cold-tier')
      expect(location.found).toBe(true)
      expect(location.tier).toBe('cold')

      // Verify data is actually in R2
      const r2Data = await r2Layer.get<{ data: string }>('cold-tier')
      expect(r2Data?.data).toBe('cold')
    })

    it('should write through to cold tier when specified', async () => {
      await tieredStorage.put('writethrough', { data: 'through' }, { tier: 'warm', writeThrough: true })

      // Should be in both warm and cold
      expect(await doStorage.has('writethrough')).toBe(true)
      expect(await r2Layer.has('writethrough')).toBe(true)
    })
  })

  describe('Tiered Fallback Behavior', () => {
    it('should retrieve data from hot tier first', async () => {
      // Put same key in all tiers
      await r2Layer.put('fallback-key', { tier: 'cold' })
      await doStorage.put('fallback-key', { tier: 'warm' })
      await cacheLayer.put('fallback-key', { tier: 'hot' })

      const result = await tieredStorage.get<{ tier: string }>('fallback-key')
      expect(result?.tier).toBe('hot')
    })

    it('should fall back to warm tier when not in hot', async () => {
      await r2Layer.put('warm-fallback', { tier: 'cold' })
      await doStorage.put('warm-fallback', { tier: 'warm' })
      // Not in cache

      const result = await tieredStorage.get<{ tier: string }>('warm-fallback')
      expect(result?.tier).toBe('warm')
    })

    it('should fall back to cold tier (R2) when not in hot or warm', async () => {
      await r2Layer.put('cold-fallback', { tier: 'cold', source: 'r2' })
      // Not in cache or DO

      const result = await tieredStorage.get<{ tier: string; source: string }>('cold-fallback')
      expect(result?.tier).toBe('cold')
      expect(result?.source).toBe('r2')
    })

    it('should return undefined when key not in any tier', async () => {
      const result = await tieredStorage.get('non-existent-key-xyz')
      expect(result).toBeUndefined()
    })
  })

  describe('Tiered Promotion', () => {
    it('should promote from cold (R2) to warm (DO)', async () => {
      // Write to cold tier directly via R2
      await r2Layer.put('promote-cold-warm', { data: 'cold-data' })

      // Promote to warm
      await tieredStorage.promoteToWarm('promote-cold-warm')

      // Verify it's now in warm tier
      const warmData = await doStorage.get<{ data: string }>('promote-cold-warm')
      expect(warmData).toEqual({ data: 'cold-data' })
    })

    it('should promote from warm (DO) to hot (Cache)', async () => {
      // Write to warm tier
      await doStorage.put('promote-warm-hot', { data: 'warm-data' })

      // Promote to hot
      await tieredStorage.promoteToHot('promote-warm-hot')

      // Verify it's now in hot tier
      const location = await tieredStorage.locateKey('promote-warm-hot')
      expect(location.tier).toBe('hot')
    })

    it('should preserve data integrity during promotion from R2', async () => {
      const originalData = {
        id: 'integrity-test',
        nested: { array: [1, 2, 3], object: { key: 'value' } },
        large: 'z'.repeat(500),
      }

      // Start in cold tier (R2)
      await r2Layer.put('integrity-test', originalData)

      // Promote to warm
      await tieredStorage.promoteToWarm('integrity-test')
      const warmData = await doStorage.get<typeof originalData>('integrity-test')
      expect(warmData).toEqual(originalData)

      // Promote to hot
      await tieredStorage.promoteToHot('integrity-test')
      const hotData = await cacheLayer.get<typeof originalData>('integrity-test')
      expect(hotData).toEqual(originalData)
    })

    it('should emit promotion events', async () => {
      const promotionEvents: PromotionEvent[] = []
      tieredStorage.onPromotion((event) => promotionEvents.push(event))

      await r2Layer.put('event-test', { data: 'promote' })
      await tieredStorage.promoteToWarm('event-test')

      expect(promotionEvents.length).toBe(1)
      expect(promotionEvents[0].fromTier).toBe('cold')
      expect(promotionEvents[0].toTier).toBe('warm')
      expect(promotionEvents[0].key).toBe('event-test')
      expect(promotionEvents[0].success).toBe(true)
    })

    it('should auto-promote from cold to warm after threshold accesses', async () => {
      tieredStorage.setAutoPromote(true)
      tieredStorage.setPromotionThreshold(2)

      // Write to cold tier directly
      await r2Layer.put('auto-promote-cold', { data: 'auto' })

      // Access multiple times to trigger promotion
      await tieredStorage.get('auto-promote-cold') // Access 1
      await tieredStorage.get('auto-promote-cold') // Access 2 - triggers promotion

      // Verify promoted to warm
      const warmData = await doStorage.get<{ data: string }>('auto-promote-cold')
      expect(warmData).toEqual({ data: 'auto' })
    })
  })

  describe('Tiered Demotion', () => {
    it('should demote from hot (Cache) to warm (DO)', async () => {
      // Write to hot tier (also persists to DO)
      await tieredStorage.put('demote-hot', { data: 'hot-data' }, { tier: 'hot' })

      // Demote from hot
      await tieredStorage.demoteFromHot('demote-hot')

      // Should no longer be in cache but still in DO
      const cacheData = await cacheLayer.get('demote-hot')
      expect(cacheData).toBeUndefined()

      const doData = await doStorage.get<{ data: string }>('demote-hot')
      expect(doData).toEqual({ data: 'hot-data' })
    })

    it('should demote from warm (DO) to cold (R2)', async () => {
      // Write to warm tier
      await doStorage.put('demote-warm', { data: 'warm-data' })

      // Demote to cold
      await tieredStorage.demoteFromWarm('demote-warm')

      // Should now be in R2, not DO
      const doData = await doStorage.get('demote-warm')
      expect(doData).toBeUndefined()

      const r2Data = await r2Layer.get<{ data: string }>('demote-warm')
      expect(r2Data).toEqual({ data: 'warm-data' })
    })

    it('should emit demotion events', async () => {
      const demotionEvents: DemotionEvent[] = []
      tieredStorage.onDemotion((event) => demotionEvents.push(event))

      await doStorage.put('demotion-event-test', { data: 'demote' })
      await tieredStorage.demoteFromWarm('demotion-event-test')

      expect(demotionEvents.length).toBe(1)
      expect(demotionEvents[0].fromTier).toBe('warm')
      expect(demotionEvents[0].toTier).toBe('cold')
      expect(demotionEvents[0].key).toBe('demotion-event-test')
      expect(demotionEvents[0].success).toBe(true)
    })
  })

  describe('Tiered Delete Operations', () => {
    it('should delete from all tiers', async () => {
      // Put in all tiers
      await cacheLayer.put('delete-all', 'hot')
      await doStorage.put('delete-all', 'warm')
      await r2Layer.put('delete-all', 'cold')

      await tieredStorage.delete('delete-all')

      expect(await cacheLayer.has('delete-all')).toBe(false)
      expect(await doStorage.has('delete-all')).toBe(false)
      expect(await r2Layer.has('delete-all')).toBe(false)
    })

    it('should delete multiple keys from all tiers', async () => {
      await cacheLayer.put('multi-delete-1', 'hot')
      await doStorage.put('multi-delete-2', 'warm')
      await r2Layer.put('multi-delete-3', 'cold')

      await tieredStorage.deleteMany(['multi-delete-1', 'multi-delete-2', 'multi-delete-3'])

      expect(await tieredStorage.has('multi-delete-1')).toBe(false)
      expect(await tieredStorage.has('multi-delete-2')).toBe(false)
      expect(await tieredStorage.has('multi-delete-3')).toBe(false)
    })
  })

  describe('Tiered Has Operation', () => {
    it('should find key in cold tier (R2)', async () => {
      await r2Layer.put('has-cold', 'value')

      expect(await tieredStorage.has('has-cold')).toBe(true)
    })

    it('should return false for missing key', async () => {
      expect(await tieredStorage.has('totally-missing-key-xyz')).toBe(false)
    })
  })

  describe('Tiered Statistics', () => {
    it('should aggregate statistics from all tiers', async () => {
      await tieredStorage.put('stats-test', 'value')
      await tieredStorage.get('stats-test')

      const stats = tieredStorage.getStats()

      expect(stats.do).toBeDefined()
      expect(stats.cache).toBeDefined()
      expect(stats.r2).toBeDefined()
      expect(stats.promotions).toBeDefined()
      expect(stats.demotions).toBeDefined()
    })

    it('should track promotion statistics', async () => {
      tieredStorage.resetStats()

      await r2Layer.put('promo-stat-1', 'cold')
      await tieredStorage.promoteToWarm('promo-stat-1')

      await doStorage.put('promo-stat-2', 'warm')
      await tieredStorage.promoteToHot('promo-stat-2')

      const stats = tieredStorage.getStats()

      expect(stats.promotions.coldToWarm).toBe(1)
      expect(stats.promotions.warmToHot).toBe(1)
    })

    it('should track demotion statistics', async () => {
      tieredStorage.resetStats()

      await tieredStorage.put('demo-stat-1', 'hot', { tier: 'hot' })
      await tieredStorage.demoteFromHot('demo-stat-1')

      await doStorage.put('demo-stat-2', 'warm')
      await tieredStorage.demoteFromWarm('demo-stat-2')

      const stats = tieredStorage.getStats()

      expect(stats.demotions.hotToWarm).toBe(1)
      expect(stats.demotions.warmToCold).toBe(1)
    })
  })

  describe('Tiered GetMany Operation', () => {
    it('should retrieve multiple keys from different tiers', async () => {
      await cacheLayer.put('many-hot', { tier: 'hot' })
      await doStorage.put('many-warm', { tier: 'warm' })
      await r2Layer.put('many-cold', { tier: 'cold' })

      const results = await tieredStorage.getMany<{ tier: string }>([
        'many-hot',
        'many-warm',
        'many-cold',
        'many-missing',
      ])

      expect(results.get('many-hot')).toEqual({ tier: 'hot' })
      expect(results.get('many-warm')).toEqual({ tier: 'warm' })
      expect(results.get('many-cold')).toEqual({ tier: 'cold' })
      expect(results.has('many-missing')).toBe(false)
    })
  })
})

// ============================================================================
// EDGE CASES AND ERROR HANDLING
// ============================================================================

describe('Tiered Storage Edge Cases', () => {
  let r2Layer: R2StorageLayer
  let testPrefix: string

  beforeEach(() => {
    testPrefix = generateTestPrefix()
    r2Layer = new R2StorageLayer({
      bucket: testEnv.R2_STORAGE,
      prefix: testPrefix,
    })
  })

  it('should handle empty data', async () => {
    await r2Layer.put('empty-object', {})
    const result = await r2Layer.get<Record<string, unknown>>('empty-object')
    expect(result).toEqual({})
  })

  it('should handle special characters in keys', async () => {
    const specialKeys = [
      'key/with/slashes',
      'key:with:colons',
      'key.with.dots',
      'key-with-dashes',
      'key_with_underscores',
      'key with spaces',
    ]

    for (const key of specialKeys) {
      await r2Layer.put(key, { key })
      const result = await r2Layer.get<{ key: string }>(key)
      expect(result?.key).toBe(key)
    }
  })

  it('should handle Unicode content', async () => {
    const unicodeData = {
      japanese: 'こんにちは',
      chinese: '你好',
      emoji: '🎉🚀💻',
      arabic: 'مرحبا',
    }

    await r2Layer.put('unicode', unicodeData)
    const result = await r2Layer.get<typeof unicodeData>('unicode')

    expect(result).toEqual(unicodeData)
  })

  it('should handle numeric values correctly', async () => {
    const numericData = {
      integer: 42,
      negative: -100,
      float: 3.14159,
      scientific: 1.23e10,
      zero: 0,
    }

    await r2Layer.put('numbers', numericData)
    const result = await r2Layer.get<typeof numericData>('numbers')

    expect(result).toEqual(numericData)
  })

  it('should handle boolean and null values', async () => {
    const mixedData = {
      boolTrue: true,
      boolFalse: false,
      nullValue: null,
    }

    await r2Layer.put('mixed', mixedData)
    const result = await r2Layer.get<typeof mixedData>('mixed')

    expect(result).toEqual(mixedData)
  })

  it('should handle arrays correctly', async () => {
    const arrayData = {
      numbers: [1, 2, 3, 4, 5],
      strings: ['a', 'b', 'c'],
      mixed: [1, 'two', true, null],
      nested: [[1, 2], [3, 4]],
      empty: [],
    }

    await r2Layer.put('arrays', arrayData)
    const result = await r2Layer.get<typeof arrayData>('arrays')

    expect(result).toEqual(arrayData)
  })
})
