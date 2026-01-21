// Tests for TieredStorage (hot/warm/cold tier transitions)
// Tests CacheLayer, R2StorageLayer, and TieredStorageAdapter
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  CacheLayer,
  R2StorageLayer,
  TieredStorageAdapter,
  createTieredStorageAdapter,
  type CacheLayerConfig,
  type R2StorageLayerConfig,
  type TieredStorageConfig,
  type PromotionEvent,
  type DemotionEvent,
  type StorageTier,
} from '../tiered-storage'
import { createMemoryStorageAdapter } from '../adapters/memory'
import type { StorageAdapter } from '../storage'

/**
 * Mock Cache implementation for testing
 */
class MockCache implements Cache {
  private store = new Map<string, Response>()

  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    const url = typeof request === 'string' ? request : request instanceof URL ? request.toString() : request.url
    const response = this.store.get(url)
    if (response) {
      // Clone response since body can only be read once
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

  // Required by Cache interface but not used in our implementation
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

  // Helper for tests
  clear(): void {
    this.store.clear()
  }
}

/**
 * Mock R2Bucket implementation for testing
 */
class MockR2Bucket implements R2Bucket {
  private store = new Map<string, { body: string; httpMetadata?: R2HTTPMetadata }>()

  async head(key: string): Promise<R2Object | null> {
    const entry = this.store.get(key)
    if (!entry) return null
    return {
      key,
      size: entry.body.length,
      etag: 'mock-etag',
      httpEtag: '"mock-etag"',
      version: 'mock-version',
      httpMetadata: entry.httpMetadata,
      customMetadata: {},
      uploaded: new Date(),
      checksums: { toJSON: () => ({}) },
      storageClass: 'Standard',
      writeHttpMetadata: () => {},
    } as R2Object
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    const entry = this.store.get(key)
    if (!entry) return null
    return {
      key,
      size: entry.body.length,
      etag: 'mock-etag',
      httpEtag: '"mock-etag"',
      version: 'mock-version',
      httpMetadata: entry.httpMetadata,
      customMetadata: {},
      uploaded: new Date(),
      checksums: { toJSON: () => ({}) },
      storageClass: 'Standard',
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(entry.body))
          controller.close()
        },
      }),
      bodyUsed: false,
      arrayBuffer: async () => new TextEncoder().encode(entry.body).buffer as ArrayBuffer,
      text: async () => entry.body,
      json: async <T>() => JSON.parse(entry.body) as T,
      blob: async () => new Blob([entry.body]),
      writeHttpMetadata: () => {},
    } as R2ObjectBody
  }

  async put(key: string, value: string | ReadableStream | ArrayBuffer | Blob, options?: R2PutOptions): Promise<R2Object> {
    let body: string
    if (typeof value === 'string') {
      body = value
    } else if (value instanceof ArrayBuffer) {
      body = new TextDecoder().decode(value)
    } else if (value instanceof Blob) {
      body = await value.text()
    } else {
      // ReadableStream
      const reader = value.getReader()
      const chunks: Uint8Array[] = []
      let done = false
      while (!done) {
        const result = await reader.read()
        done = result.done
        if (result.value) {
          chunks.push(result.value)
        }
      }
      body = new TextDecoder().decode(new Uint8Array(chunks.flatMap((c) => Array.from(c))))
    }

    this.store.set(key, { body, httpMetadata: options?.httpMetadata })

    return {
      key,
      size: body.length,
      etag: 'mock-etag',
      httpEtag: '"mock-etag"',
      version: 'mock-version',
      httpMetadata: options?.httpMetadata,
      customMetadata: {},
      uploaded: new Date(),
      checksums: { toJSON: () => ({}) },
      storageClass: 'Standard',
      writeHttpMetadata: () => {},
    } as R2Object
  }

  async delete(keys: string | string[]): Promise<void> {
    const keysArray = Array.isArray(keys) ? keys : [keys]
    for (const key of keysArray) {
      this.store.delete(key)
    }
  }

  async list(options?: R2ListOptions): Promise<R2Objects> {
    const prefix = options?.prefix || ''
    const limit = options?.limit || 1000
    const cursor = options?.cursor

    const allKeys = Array.from(this.store.keys())
      .filter((key) => key.startsWith(prefix))
      .sort()

    let startIndex = 0
    if (cursor) {
      startIndex = allKeys.findIndex((key) => key > cursor)
      if (startIndex === -1) startIndex = allKeys.length
    }

    const keys = allKeys.slice(startIndex, startIndex + limit)
    const truncated = startIndex + limit < allKeys.length

    return {
      objects: keys.map((key) => {
        const entry = this.store.get(key)!
        return {
          key,
          size: entry.body.length,
          etag: 'mock-etag',
          httpEtag: '"mock-etag"',
          version: 'mock-version',
          httpMetadata: entry.httpMetadata,
          customMetadata: {},
          uploaded: new Date(),
          checksums: { toJSON: () => ({}) },
          storageClass: 'Standard',
          writeHttpMetadata: () => {},
        } as R2Object
      }),
      truncated,
      cursor: truncated ? keys[keys.length - 1] : undefined,
      delimitedPrefixes: [],
    }
  }

  // Not used but required by interface
  createMultipartUpload(): Promise<R2MultipartUpload> {
    throw new Error('Not implemented')
  }

  resumeMultipartUpload(): R2MultipartUpload {
    throw new Error('Not implemented')
  }

  // Helper for tests
  clear(): void {
    this.store.clear()
  }

  has(key: string): boolean {
    return this.store.has(key)
  }
}

describe('CacheLayer', () => {
  let cache: MockCache
  let cacheLayer: CacheLayer
  const config: CacheLayerConfig = {
    cacheName: 'test-cache',
    ttlSeconds: 300,
    baseUrl: 'https://cache.test.dev',
  }

  beforeEach(() => {
    cache = new MockCache()
    cacheLayer = new CacheLayer(cache, config)
  })

  describe('basic operations', () => {
    it('should put and get a value', async () => {
      await cacheLayer.put('key1', { name: 'test', value: 123 })
      const result = await cacheLayer.get<{ name: string; value: number }>('key1')

      expect(result).toEqual({ name: 'test', value: 123 })
    })

    it('should return undefined for non-existent key', async () => {
      const result = await cacheLayer.get('nonexistent')
      expect(result).toBeUndefined()
    })

    it('should check if key exists', async () => {
      await cacheLayer.put('key1', 'value1')

      expect(await cacheLayer.has('key1')).toBe(true)
      expect(await cacheLayer.has('nonexistent')).toBe(false)
    })

    it('should delete a key', async () => {
      await cacheLayer.put('key1', 'value1')
      const deleted = await cacheLayer.delete('key1')

      expect(deleted).toBe(true)
      expect(await cacheLayer.has('key1')).toBe(false)
    })

    it('should return false when deleting non-existent key', async () => {
      const deleted = await cacheLayer.delete('nonexistent')
      expect(deleted).toBe(false)
    })

    it('should update existing key', async () => {
      await cacheLayer.put('key1', 'first')
      await cacheLayer.put('key1', 'second')

      const result = await cacheLayer.get('key1')
      expect(result).toBe('second')
    })

    it('should store metadata in headers', async () => {
      await cacheLayer.put('key1', { data: 'test' }, {
        lastAccessed: 1000,
        accessCount: 5,
        size: 100,
      })

      // Value should still be retrievable
      const result = await cacheLayer.get<{ data: string }>('key1')
      expect(result).toEqual({ data: 'test' })
    })
  })

  describe('statistics', () => {
    it('should track hits and misses', async () => {
      await cacheLayer.put('key1', 'value1')

      // Hit
      await cacheLayer.get('key1')
      // Miss
      await cacheLayer.get('nonexistent')

      const stats = cacheLayer.getStats()
      expect(stats.hits).toBe(1)
      expect(stats.misses).toBe(1)
      expect(stats.hitRatio).toBe(0.5)
    })

    it('should track writes', async () => {
      await cacheLayer.put('key1', 'value1')
      await cacheLayer.put('key2', 'value2')

      const stats = cacheLayer.getStats()
      expect(stats.writes).toBe(2)
    })

    it('should track deletes', async () => {
      await cacheLayer.put('key1', 'value1')
      await cacheLayer.delete('key1')

      const stats = cacheLayer.getStats()
      expect(stats.deletes).toBe(1)
    })

    it('should track bytes read and written', async () => {
      const value = { data: 'test data here' }
      await cacheLayer.put('key1', value)
      await cacheLayer.get('key1')

      const stats = cacheLayer.getStats()
      expect(stats.bytesWritten).toBeGreaterThan(0)
      expect(stats.bytesRead).toBeGreaterThan(0)
    })

    it('should reset statistics', async () => {
      await cacheLayer.put('key1', 'value1')
      await cacheLayer.get('key1')

      cacheLayer.resetStats()

      const stats = cacheLayer.getStats()
      expect(stats.hits).toBe(0)
      expect(stats.misses).toBe(0)
      expect(stats.writes).toBe(0)
    })

    it('should calculate hitRatio correctly with no requests', async () => {
      const stats = cacheLayer.getStats()
      expect(stats.hitRatio).toBe(0)
    })
  })
})

describe('R2StorageLayer', () => {
  let bucket: MockR2Bucket
  let r2Layer: R2StorageLayer
  const config: R2StorageLayerConfig = {
    bucket: null as unknown as R2Bucket,
    prefix: 'dotdo/',
  }

  beforeEach(() => {
    bucket = new MockR2Bucket()
    config.bucket = bucket as unknown as R2Bucket
    r2Layer = new R2StorageLayer(config)
  })

  describe('basic operations', () => {
    it('should put and get a value', async () => {
      await r2Layer.put('key1', { name: 'test', value: 123 })
      const result = await r2Layer.get<{ name: string; value: number }>('key1')

      expect(result).toEqual({ name: 'test', value: 123 })
    })

    it('should return undefined for non-existent key', async () => {
      const result = await r2Layer.get('nonexistent')
      expect(result).toBeUndefined()
    })

    it('should check if key exists', async () => {
      await r2Layer.put('key1', 'value1')

      expect(await r2Layer.has('key1')).toBe(true)
      expect(await r2Layer.has('nonexistent')).toBe(false)
    })

    it('should delete a key', async () => {
      await r2Layer.put('key1', 'value1')
      await r2Layer.delete('key1')

      expect(await r2Layer.has('key1')).toBe(false)
    })

    it('should apply prefix to keys', async () => {
      await r2Layer.put('key1', 'value1')

      // The key in the bucket should have the prefix
      expect(bucket.has('dotdo/key1')).toBe(true)
      expect(bucket.has('key1')).toBe(false)
    })
  })

  describe('list operations', () => {
    it('should list keys with prefix stripped', async () => {
      await r2Layer.put('key1', 'value1')
      await r2Layer.put('key2', 'value2')
      await r2Layer.put('key3', 'value3')

      const result = await r2Layer.list()

      expect(result.keys).toContain('key1')
      expect(result.keys).toContain('key2')
      expect(result.keys).toContain('key3')
      expect(result.truncated).toBe(false)
    })

    it('should paginate results', async () => {
      await r2Layer.put('key1', 'value1')
      await r2Layer.put('key2', 'value2')
      await r2Layer.put('key3', 'value3')

      const page1 = await r2Layer.list({ limit: 2 })
      expect(page1.keys.length).toBe(2)
      expect(page1.truncated).toBe(true)
      expect(page1.cursor).toBeDefined()

      const page2 = await r2Layer.list({ limit: 2, cursor: page1.cursor })
      expect(page2.keys.length).toBe(1)
      expect(page2.truncated).toBe(false)
    })
  })

  describe('statistics', () => {
    it('should track reads', async () => {
      await r2Layer.put('key1', 'value1')
      await r2Layer.get('key1')
      await r2Layer.get('key1')

      const stats = r2Layer.getStats()
      expect(stats.reads).toBe(2)
    })

    it('should track writes', async () => {
      await r2Layer.put('key1', 'value1')
      await r2Layer.put('key2', 'value2')

      const stats = r2Layer.getStats()
      expect(stats.writes).toBe(2)
    }
    )

    it('should track deletes', async () => {
      await r2Layer.put('key1', 'value1')
      await r2Layer.delete('key1')

      const stats = r2Layer.getStats()
      expect(stats.deletes).toBe(1)
    })

    it('should reset statistics', async () => {
      await r2Layer.put('key1', 'value1')
      await r2Layer.get('key1')

      r2Layer.resetStats()

      const stats = r2Layer.getStats()
      expect(stats.reads).toBe(0)
      expect(stats.writes).toBe(0)
    })
  })
})

describe('TieredStorageAdapter', () => {
  let mockCache: MockCache
  let cacheLayer: CacheLayer
  let doStorage: StorageAdapter
  let mockBucket: MockR2Bucket
  let r2Layer: R2StorageLayer
  let tieredStorage: TieredStorageAdapter

  beforeEach(() => {
    // Set up cache layer (hot tier)
    mockCache = new MockCache()
    cacheLayer = new CacheLayer(mockCache, {
      cacheName: 'test-cache',
      ttlSeconds: 300,
      baseUrl: 'https://cache.test.dev',
    })

    // Set up DO storage (warm tier)
    doStorage = createMemoryStorageAdapter()

    // Set up R2 layer (cold tier)
    mockBucket = new MockR2Bucket()
    r2Layer = new R2StorageLayer({
      bucket: mockBucket as unknown as R2Bucket,
      prefix: 'dotdo/',
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

  describe('tier assignment', () => {
    it('should write to warm tier (DO) by default', async () => {
      await tieredStorage.put('key1', { data: 'test' })

      const location = await tieredStorage.locateKey('key1')
      expect(location.found).toBe(true)
      expect(location.tier).toBe('warm')
    })

    it('should write to hot tier when specified', async () => {
      await tieredStorage.put('key1', { data: 'test' }, { tier: 'hot' })

      const location = await tieredStorage.locateKey('key1')
      expect(location.found).toBe(true)
      expect(location.tier).toBe('hot')
    })

    it('should write to cold tier when specified', async () => {
      await tieredStorage.put('key1', { data: 'test' }, { tier: 'cold' })

      const location = await tieredStorage.locateKey('key1')
      expect(location.found).toBe(true)
      expect(location.tier).toBe('cold')
    })

    it('should write through to cold tier when specified', async () => {
      await tieredStorage.put('key1', { data: 'test' }, { tier: 'warm', writeThrough: true })

      // Should be in both warm and cold
      expect(await doStorage.has('key1')).toBe(true)
      expect(await r2Layer.has('key1')).toBe(true)
    })

    it('should report not found for non-existent keys', async () => {
      const location = await tieredStorage.locateKey('nonexistent')
      expect(location.found).toBe(false)
      expect(location.tier).toBeUndefined()
    })
  })

  describe('tier transitions - promotion', () => {
    it('should promote from cold to warm', async () => {
      // Write to cold tier directly
      await r2Layer.put('key1', { data: 'cold-data' })

      // Promote to warm
      await tieredStorage.promoteToWarm('key1')

      // Verify it's now in warm tier
      const warmData = await doStorage.get<{ data: string }>('key1')
      expect(warmData).toEqual({ data: 'cold-data' })
    })

    it('should promote from warm to hot', async () => {
      // Write to warm tier
      await doStorage.put('key1', { data: 'warm-data' })

      // Promote to hot
      await tieredStorage.promoteToHot('key1')

      // Verify it's now in hot tier
      const location = await tieredStorage.locateKey('key1')
      expect(location.tier).toBe('hot')
    })

    it('should auto-promote from cold to warm after threshold accesses', async () => {
      tieredStorage.setAutoPromote(true)
      tieredStorage.setPromotionThreshold(2)

      // Write to cold tier
      await r2Layer.put('key1', { data: 'cold-data' })

      // Access multiple times to trigger promotion
      await tieredStorage.get('key1') // Access 1
      await tieredStorage.get('key1') // Access 2 - should trigger promotion

      // Verify it's been promoted to warm
      const warmData = await doStorage.get<{ data: string }>('key1')
      expect(warmData).toEqual({ data: 'cold-data' })
    })

    it('should auto-promote from warm to hot after threshold accesses', async () => {
      tieredStorage.setAutoPromote(true)
      tieredStorage.setPromotionThreshold(2)

      // Write to warm tier
      await doStorage.put('key1', { data: 'warm-data' })

      // Access multiple times to trigger promotion
      await tieredStorage.get('key1') // Access 1
      await tieredStorage.get('key1') // Access 2 - should trigger promotion

      // Verify it's been promoted to hot
      const location = await tieredStorage.locateKey('key1')
      expect(location.tier).toBe('hot')
    })

    it('should emit promotion events', async () => {
      const promotionEvents: PromotionEvent[] = []
      tieredStorage.onPromotion((event) => promotionEvents.push(event))

      await doStorage.put('key1', { data: 'warm-data' })
      await tieredStorage.promoteToHot('key1')

      expect(promotionEvents.length).toBe(1)
      expect(promotionEvents[0].fromTier).toBe('warm')
      expect(promotionEvents[0].toTier).toBe('hot')
      expect(promotionEvents[0].key).toBe('key1')
      expect(promotionEvents[0].success).toBe(true)
    })

    it('should reset access count after promotion', async () => {
      tieredStorage.setAutoPromote(true)
      tieredStorage.setPromotionThreshold(2)

      await doStorage.put('key1', { data: 'test' })

      // Access to build up count
      await tieredStorage.get('key1')
      await tieredStorage.get('key1') // Promotes and resets

      // Count should be reset
      expect(tieredStorage.getAccessCount('key1')).toBe(0)
    })

    it('should not promote when skipPromotion is set', async () => {
      tieredStorage.setAutoPromote(true)
      tieredStorage.setPromotionThreshold(1)

      await doStorage.put('key1', { data: 'warm-data' })

      // Access with skipPromotion
      await tieredStorage.get('key1', { skipPromotion: true })

      // Should still be in warm tier
      const location = await tieredStorage.locateKey('key1')
      expect(location.tier).toBe('warm')
    })

    it('should not track access when trackAccess is false', async () => {
      await doStorage.put('key1', { data: 'test' })

      await tieredStorage.get('key1', { trackAccess: false })
      await tieredStorage.get('key1', { trackAccess: false })

      expect(tieredStorage.getAccessCount('key1')).toBe(0)
    })
  })

  describe('tier transitions - demotion', () => {
    it('should demote from hot to warm', async () => {
      // Write to hot tier (also writes to DO for persistence)
      await tieredStorage.put('key1', { data: 'hot-data' }, { tier: 'hot' })

      // Demote from hot
      await tieredStorage.demoteFromHot('key1')

      // Should no longer be in cache but still in DO
      const cacheData = await cacheLayer.get('key1')
      expect(cacheData).toBeUndefined()

      const doData = await doStorage.get<{ data: string }>('key1')
      expect(doData).toEqual({ data: 'hot-data' })
    })

    it('should demote from warm to cold', async () => {
      // Write to warm tier
      await doStorage.put('key1', { data: 'warm-data' })

      // Demote to cold
      await tieredStorage.demoteFromWarm('key1')

      // Should now be in R2, not DO
      const doData = await doStorage.get('key1')
      expect(doData).toBeUndefined()

      const r2Data = await r2Layer.get<{ data: string }>('key1')
      expect(r2Data).toEqual({ data: 'warm-data' })
    })

    it('should emit demotion events', async () => {
      const demotionEvents: DemotionEvent[] = []
      tieredStorage.onDemotion((event) => demotionEvents.push(event))

      await tieredStorage.put('key1', { data: 'hot-data' }, { tier: 'hot' })
      await tieredStorage.demoteFromHot('key1')

      expect(demotionEvents.length).toBe(1)
      expect(demotionEvents[0].fromTier).toBe('hot')
      expect(demotionEvents[0].toTier).toBe('warm')
      expect(demotionEvents[0].key).toBe('key1')
      expect(demotionEvents[0].success).toBe(true)
      expect(demotionEvents[0].reason).toBe('manual')
    })
  })

  describe('data retrieval from different tiers', () => {
    it('should retrieve data from hot tier first', async () => {
      // Put same key in all tiers with different values
      await r2Layer.put('key1', { data: 'cold' })
      await doStorage.put('key1', { data: 'warm' })
      await cacheLayer.put('key1', { data: 'hot' })

      const result = await tieredStorage.get<{ data: string }>('key1')
      expect(result).toEqual({ data: 'hot' })
    })

    it('should fall back to warm tier when not in hot', async () => {
      await r2Layer.put('key1', { data: 'cold' })
      await doStorage.put('key1', { data: 'warm' })
      // Not in cache

      const result = await tieredStorage.get<{ data: string }>('key1')
      expect(result).toEqual({ data: 'warm' })
    })

    it('should fall back to cold tier when not in hot or warm', async () => {
      await r2Layer.put('key1', { data: 'cold' })
      // Not in DO or cache

      const result = await tieredStorage.get<{ data: string }>('key1')
      expect(result).toEqual({ data: 'cold' })
    })

    it('should return undefined when key not in any tier', async () => {
      const result = await tieredStorage.get('nonexistent')
      expect(result).toBeUndefined()
    })

    it('should retrieve multiple keys from different tiers', async () => {
      await cacheLayer.put('hot-key', { tier: 'hot' })
      await doStorage.put('warm-key', { tier: 'warm' })
      await r2Layer.put('cold-key', { tier: 'cold' })

      const results = await tieredStorage.getMany<{ tier: string }>([
        'hot-key',
        'warm-key',
        'cold-key',
        'missing-key',
      ])

      expect(results.get('hot-key')).toEqual({ tier: 'hot' })
      expect(results.get('warm-key')).toEqual({ tier: 'warm' })
      expect(results.get('cold-key')).toEqual({ tier: 'cold' })
      expect(results.has('missing-key')).toBe(false)
    })
  })

  describe('has operation across tiers', () => {
    it('should find key in hot tier', async () => {
      await cacheLayer.put('key1', 'value')

      expect(await tieredStorage.has('key1')).toBe(true)
    })

    it('should find key in warm tier', async () => {
      await doStorage.put('key1', 'value')

      expect(await tieredStorage.has('key1')).toBe(true)
    })

    it('should find key in cold tier', async () => {
      await r2Layer.put('key1', 'value')

      expect(await tieredStorage.has('key1')).toBe(true)
    })

    it('should return false when key not in any tier', async () => {
      expect(await tieredStorage.has('nonexistent')).toBe(false)
    })
  })

  describe('delete operation across tiers', () => {
    it('should delete from all tiers', async () => {
      // Put in all tiers
      await cacheLayer.put('key1', 'hot')
      await doStorage.put('key1', 'warm')
      await r2Layer.put('key1', 'cold')

      await tieredStorage.delete('key1')

      expect(await cacheLayer.has('key1')).toBe(false)
      expect(await doStorage.has('key1')).toBe(false)
      expect(await r2Layer.has('key1')).toBe(false)
    })

    it('should delete multiple keys from all tiers', async () => {
      await cacheLayer.put('key1', 'hot')
      await doStorage.put('key2', 'warm')
      await r2Layer.put('key3', 'cold')

      await tieredStorage.deleteMany(['key1', 'key2', 'key3'])

      expect(await tieredStorage.has('key1')).toBe(false)
      expect(await tieredStorage.has('key2')).toBe(false)
      expect(await tieredStorage.has('key3')).toBe(false)
    })

    it('should clear access tracking on delete', async () => {
      await doStorage.put('key1', 'value')

      // Build up access count
      await tieredStorage.get('key1')
      await tieredStorage.get('key1')
      expect(tieredStorage.getAccessCount('key1')).toBe(2)

      await tieredStorage.delete('key1')

      expect(tieredStorage.getAccessCount('key1')).toBe(0)
    })
  })

  describe('list and count operations', () => {
    it('should list from DO storage (warm tier)', async () => {
      await tieredStorage.put('key1', 'v1')
      await tieredStorage.put('key2', 'v2')
      await tieredStorage.put('key3', 'v3')

      const result = await tieredStorage.list()

      expect(result.entries.size).toBe(3)
    })

    it('should count keys from DO storage', async () => {
      await tieredStorage.put('key1', 'v1')
      await tieredStorage.put('key2', 'v2')

      const count = await tieredStorage.count()

      expect(count).toBe(2)
    })
  })

  describe('transaction support', () => {
    it('should delegate transactions to DO storage', async () => {
      await tieredStorage.put('key1', 'original')

      try {
        await tieredStorage.transaction(async () => {
          await doStorage.put('key1', 'modified')
          throw new Error('Rollback!')
        })
      } catch {
        // Expected
      }

      // Transaction should have rolled back in DO storage
      const result = await doStorage.get('key1')
      expect(result).toBe('original')
    })
  })

  describe('clear operation', () => {
    it('should clear DO storage and access tracking', async () => {
      await tieredStorage.put('key1', 'v1')
      await tieredStorage.put('key2', 'v2')

      // Build access counts
      await tieredStorage.get('key1')
      await tieredStorage.get('key2')

      await tieredStorage.clear()

      expect(await tieredStorage.count()).toBe(0)
      expect(tieredStorage.getAccessCount('key1')).toBe(0)
      expect(tieredStorage.getAccessCount('key2')).toBe(0)
    })
  })

  describe('statistics', () => {
    it('should aggregate statistics from all tiers', async () => {
      // Generate some activity
      await tieredStorage.put('key1', 'value1')
      await tieredStorage.get('key1')

      const stats = tieredStorage.getStats()

      expect(stats.do).toBeDefined()
      expect(stats.cache).toBeDefined()
      expect(stats.r2).toBeDefined()
      expect(stats.promotions).toBeDefined()
      expect(stats.demotions).toBeDefined()
    })

    it('should track promotion statistics', async () => {
      await r2Layer.put('key1', 'cold')
      await tieredStorage.promoteToWarm('key1')

      await doStorage.put('key2', 'warm')
      await tieredStorage.promoteToHot('key2')

      const stats = tieredStorage.getStats()

      expect(stats.promotions.coldToWarm).toBe(1)
      expect(stats.promotions.warmToHot).toBe(1)
    })

    it('should track demotion statistics', async () => {
      await tieredStorage.put('key1', 'hot', { tier: 'hot' })
      await tieredStorage.demoteFromHot('key1')

      await doStorage.put('key2', 'warm')
      await tieredStorage.demoteFromWarm('key2')

      const stats = tieredStorage.getStats()

      expect(stats.demotions.hotToWarm).toBe(1)
      expect(stats.demotions.warmToCold).toBe(1)
    })

    it('should reset all statistics', async () => {
      // Generate activity
      await tieredStorage.put('key1', 'value')
      await tieredStorage.get('key1')

      tieredStorage.resetStats()

      const stats = tieredStorage.getStats()
      expect(stats.do.reads).toBe(0)
      expect(stats.do.writes).toBe(0)
      expect(stats.cache.hits).toBe(0)
      expect(stats.promotions.coldToWarm).toBe(0)
    })
  })

  describe('configuration', () => {
    it('should get and set promotion threshold', () => {
      expect(tieredStorage.getPromotionThreshold()).toBe(3)

      tieredStorage.setPromotionThreshold(5)

      expect(tieredStorage.getPromotionThreshold()).toBe(5)
    })

    it('should enable and disable auto-promote', () => {
      expect(tieredStorage.isAutoPromoteEnabled()).toBe(false)

      tieredStorage.setAutoPromote(true)

      expect(tieredStorage.isAutoPromoteEnabled()).toBe(true)
    })
  })

  describe('putMany operation', () => {
    it('should put multiple entries to warm tier', async () => {
      const entries = new Map<string, { name: string }>([
        ['key1', { name: 'Alice' }],
        ['key2', { name: 'Bob' }],
        ['key3', { name: 'Charlie' }],
      ])

      await tieredStorage.putMany(entries)

      expect(await tieredStorage.get<{ name: string }>('key1')).toEqual({ name: 'Alice' })
      expect(await tieredStorage.get<{ name: string }>('key2')).toEqual({ name: 'Bob' })
      expect(await tieredStorage.get<{ name: string }>('key3')).toEqual({ name: 'Charlie' })
    })
  })
})
