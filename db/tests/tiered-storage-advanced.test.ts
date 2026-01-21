/**
 * Advanced Integration Tests for Tiered Storage
 *
 * This test file covers advanced scenarios for TieredStorageAdapter:
 * 1. Cache promotion/demotion edge cases
 * 2. R2 failure scenarios
 * 3. Concurrent access patterns
 * 4. Memory pressure scenarios
 *
 * @module db/tests/tiered-storage-advanced.test.ts
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  CacheLayer,
  R2StorageLayer,
  TieredStorageAdapter,
  createTieredStorageAdapter,
  type CacheLayerConfig,
  type R2StorageLayerConfig,
  type PromotionEvent,
  type DemotionEvent,
} from '../tiered-storage'
import { createMemoryStorageAdapter } from '../adapters/memory'
import type { StorageAdapter } from '../storage'

// ============================================================================
// MOCK IMPLEMENTATIONS
// ============================================================================

/**
 * Mock Cache implementation for testing
 */
class MockCache implements Cache {
  private store = new Map<string, Response>()
  public throwOnNext: 'get' | 'put' | 'delete' | null = null
  public errorMessage = 'Mock cache error'

  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    if (this.throwOnNext === 'get') {
      this.throwOnNext = null
      throw new Error(this.errorMessage)
    }
    const url = typeof request === 'string' ? request : request instanceof URL ? request.toString() : request.url
    const response = this.store.get(url)
    if (response) {
      return response.clone()
    }
    return undefined
  }

  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    if (this.throwOnNext === 'put') {
      this.throwOnNext = null
      throw new Error(this.errorMessage)
    }
    const url = typeof request === 'string' ? request : request instanceof URL ? request.toString() : request.url
    this.store.set(url, response.clone())
  }

  async delete(request: RequestInfo | URL): Promise<boolean> {
    if (this.throwOnNext === 'delete') {
      this.throwOnNext = null
      throw new Error(this.errorMessage)
    }
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

  size(): number {
    return this.store.size
  }
}

/**
 * Mock R2Bucket implementation with failure injection
 */
class MockR2Bucket implements R2Bucket {
  private store = new Map<string, { body: string; httpMetadata?: R2HTTPMetadata }>()
  public throwOnNext: 'get' | 'put' | 'delete' | 'head' | 'list' | null = null
  public errorMessage = 'Mock R2 error'
  public slowMode = false
  public slowDelayMs = 100

  async head(key: string): Promise<R2Object | null> {
    if (this.throwOnNext === 'head') {
      this.throwOnNext = null
      throw new Error(this.errorMessage)
    }
    if (this.slowMode) {
      await new Promise((resolve) => setTimeout(resolve, this.slowDelayMs))
    }
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
    if (this.throwOnNext === 'get') {
      this.throwOnNext = null
      throw new Error(this.errorMessage)
    }
    if (this.slowMode) {
      await new Promise((resolve) => setTimeout(resolve, this.slowDelayMs))
    }
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
    if (this.throwOnNext === 'put') {
      this.throwOnNext = null
      throw new Error(this.errorMessage)
    }
    if (this.slowMode) {
      await new Promise((resolve) => setTimeout(resolve, this.slowDelayMs))
    }
    let body: string
    if (typeof value === 'string') {
      body = value
    } else if (value instanceof ArrayBuffer) {
      body = new TextDecoder().decode(value)
    } else if (value instanceof Blob) {
      body = await value.text()
    } else {
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
    if (this.throwOnNext === 'delete') {
      this.throwOnNext = null
      throw new Error(this.errorMessage)
    }
    const keysArray = Array.isArray(keys) ? keys : [keys]
    for (const key of keysArray) {
      this.store.delete(key)
    }
  }

  async list(options?: R2ListOptions): Promise<R2Objects> {
    if (this.throwOnNext === 'list') {
      this.throwOnNext = null
      throw new Error(this.errorMessage)
    }
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

  createMultipartUpload(): Promise<R2MultipartUpload> {
    throw new Error('Not implemented')
  }

  resumeMultipartUpload(): R2MultipartUpload {
    throw new Error('Not implemented')
  }

  clear(): void {
    this.store.clear()
  }

  has(key: string): boolean {
    return this.store.has(key)
  }

  size(): number {
    return this.store.size
  }
}

// ============================================================================
// TEST SETUP HELPERS
// ============================================================================

function createTestSetup(options?: {
  promotionThreshold?: number
  autoPromote?: boolean
}) {
  const mockCache = new MockCache()
  const cacheLayer = new CacheLayer(mockCache, {
    cacheName: 'test-cache',
    ttlSeconds: 300,
    baseUrl: 'https://cache.test.dev',
  })

  const doStorage = createMemoryStorageAdapter()

  const mockBucket = new MockR2Bucket()
  const r2Layer = new R2StorageLayer({
    bucket: mockBucket as unknown as R2Bucket,
    prefix: 'dotdo/',
  })

  const tieredStorage = createTieredStorageAdapter({
    cacheLayer,
    doStorage,
    r2Layer,
    promotionThreshold: options?.promotionThreshold ?? 3,
    autoPromote: options?.autoPromote ?? false,
  })

  return {
    mockCache,
    cacheLayer,
    doStorage,
    mockBucket,
    r2Layer,
    tieredStorage,
  }
}

// ============================================================================
// CACHE PROMOTION/DEMOTION EDGE CASES
// ============================================================================

describe('Cache Promotion/Demotion Edge Cases', () => {
  describe('promotion edge cases', () => {
    it('should handle promotion when source data is deleted during promotion', async () => {
      const { tieredStorage, doStorage, cacheLayer } = createTestSetup()

      // Write to warm tier
      await doStorage.put('race-key', { data: 'original' })

      // Manually delete from DO during promotion flow
      const promotionPromise = tieredStorage.promoteToHot('race-key')
      await doStorage.delete('race-key')
      await promotionPromise

      // Promotion should have succeeded with the original data
      const hotData = await cacheLayer.get<{ data: string }>('race-key')
      expect(hotData).toEqual({ data: 'original' })
    })

    it('should handle promotion of non-existent key gracefully', async () => {
      const { tieredStorage, cacheLayer } = createTestSetup()

      // Try to promote a key that doesn't exist
      await tieredStorage.promoteToHot('non-existent')
      await tieredStorage.promoteToWarm('non-existent')

      // Should not crash or add anything
      expect(await cacheLayer.has('non-existent')).toBe(false)
    })

    it('should handle rapid successive promotions of same key', async () => {
      const { tieredStorage, doStorage, cacheLayer } = createTestSetup()

      await doStorage.put('rapid-key', { version: 1 })

      // Fire off multiple promotions simultaneously
      const promotions = [
        tieredStorage.promoteToHot('rapid-key'),
        tieredStorage.promoteToHot('rapid-key'),
        tieredStorage.promoteToHot('rapid-key'),
      ]

      await Promise.all(promotions)

      // Should end up in cache
      const result = await cacheLayer.get<{ version: number }>('rapid-key')
      expect(result?.version).toBe(1)
    })

    it('should reset access count correctly after cold->warm->hot promotion chain', async () => {
      const { tieredStorage, r2Layer } = createTestSetup({
        autoPromote: true,
        promotionThreshold: 2,
      })

      // Start in cold tier
      await r2Layer.put('chain-key', { stage: 'cold' })

      // Access twice to trigger cold->warm promotion
      await tieredStorage.get('chain-key')
      await tieredStorage.get('chain-key')

      // Access count should be reset after promotion
      expect(tieredStorage.getAccessCount('chain-key')).toBe(0)

      // Continue accessing to trigger warm->hot promotion
      await tieredStorage.get('chain-key')
      await tieredStorage.get('chain-key')

      // Access count reset again after second promotion
      expect(tieredStorage.getAccessCount('chain-key')).toBe(0)

      // Verify it's now in hot tier
      const location = await tieredStorage.locateKey('chain-key')
      expect(location.tier).toBe('hot')
    })

    it('should emit promotion event even when cache write fails silently', async () => {
      const { tieredStorage, doStorage, mockCache } = createTestSetup()
      const events: PromotionEvent[] = []
      tieredStorage.onPromotion((e) => events.push(e))

      await doStorage.put('fail-key', { data: 'test' })

      // Make cache write fail - note: CacheLayer catches errors silently
      mockCache.throwOnNext = 'put'
      await tieredStorage.promoteToHot('fail-key')

      // The implementation catches cache errors and may still report success
      // since the error handling in CacheLayer is silent
      expect(events.length).toBe(1)
      // The event is still emitted, behavior depends on implementation
      expect(events[0].fromTier).toBe('warm')
      expect(events[0].toTier).toBe('hot')
    })

    it('should handle promotion threshold of 1', async () => {
      const { tieredStorage, doStorage } = createTestSetup({
        autoPromote: true,
        promotionThreshold: 1,
      })

      await doStorage.put('threshold-1-key', { data: 'test' })

      // Single access should trigger promotion
      await tieredStorage.get('threshold-1-key')

      const location = await tieredStorage.locateKey('threshold-1-key')
      expect(location.tier).toBe('hot')
    })

    it('should handle promotion with very large threshold', async () => {
      const { tieredStorage, doStorage } = createTestSetup({
        autoPromote: true,
        promotionThreshold: 1000,
      })

      await doStorage.put('high-threshold-key', { data: 'test' })

      // Even 10 accesses shouldn't trigger promotion
      for (let i = 0; i < 10; i++) {
        await tieredStorage.get('high-threshold-key')
      }

      const location = await tieredStorage.locateKey('high-threshold-key')
      expect(location.tier).toBe('warm')
      expect(tieredStorage.getAccessCount('high-threshold-key')).toBe(10)
    })
  })

  describe('demotion edge cases', () => {
    it('should handle demotion when target tier is unavailable', async () => {
      const { tieredStorage, doStorage, mockBucket } = createTestSetup()
      const events: DemotionEvent[] = []
      tieredStorage.onDemotion((e) => events.push(e))

      await doStorage.put('demote-fail-key', { data: 'test' })

      // Make R2 write fail
      mockBucket.throwOnNext = 'put'
      await tieredStorage.demoteFromWarm('demote-fail-key')

      expect(events.length).toBe(1)
      expect(events[0].success).toBe(false)
      expect(events[0].error).toBeDefined()
    })

    it('should handle demotion of non-existent key', async () => {
      const { tieredStorage } = createTestSetup()
      const events: DemotionEvent[] = []
      tieredStorage.onDemotion((e) => events.push(e))

      // Try to demote a key that doesn't exist
      await tieredStorage.demoteFromWarm('ghost-key')

      // Should emit event but with no success (nothing to demote)
      expect(events.length).toBe(1)
      expect(events[0].success).toBe(false)
    })

    it('should handle rapid demotion followed by access', async () => {
      const { tieredStorage, doStorage, r2Layer } = createTestSetup()

      await doStorage.put('rapid-demote', { data: 'test' })

      // Demote while accessing
      const demotionPromise = tieredStorage.demoteFromWarm('rapid-demote')
      const accessPromise = tieredStorage.get<{ data: string }>('rapid-demote')

      await demotionPromise
      const result = await accessPromise

      // Should still get the data (from either tier)
      expect(result?.data).toBe('test')

      // Data should now be in cold tier
      const coldData = await r2Layer.get<{ data: string }>('rapid-demote')
      expect(coldData?.data).toBe('test')
    })

    it('should handle demotion after data has been updated', async () => {
      const { tieredStorage, doStorage, r2Layer } = createTestSetup()

      await doStorage.put('update-demote', { version: 1 })
      await doStorage.put('update-demote', { version: 2 })

      await tieredStorage.demoteFromWarm('update-demote')

      const coldData = await r2Layer.get<{ version: number }>('update-demote')
      expect(coldData?.version).toBe(2)
    })
  })
})

// ============================================================================
// R2 FAILURE SCENARIOS
// ============================================================================

describe('R2 Failure Scenarios', () => {
  describe('R2 read failures', () => {
    it('should return undefined when R2 get fails', async () => {
      const { tieredStorage, mockBucket, r2Layer } = createTestSetup()

      // Put data directly in R2
      await r2Layer.put('r2-fail-read', { data: 'test' })

      // Make next get fail
      mockBucket.throwOnNext = 'get'

      const result = await tieredStorage.get('r2-fail-read')
      expect(result).toBeUndefined()
    })

    it('should track R2 error in statistics', async () => {
      const { r2Layer, mockBucket } = createTestSetup()

      // Put data then fail on get
      await r2Layer.put('stat-error', { data: 'test' })
      r2Layer.resetStats()

      mockBucket.throwOnNext = 'get'
      await r2Layer.get('stat-error')

      const stats = r2Layer.getStats()
      expect(stats.errors).toBe(1)
    })

    it('should handle R2 head failure gracefully', async () => {
      const { r2Layer, mockBucket } = createTestSetup()

      await r2Layer.put('head-fail', { data: 'test' })

      mockBucket.throwOnNext = 'head'
      const exists = await r2Layer.has('head-fail')

      expect(exists).toBe(false) // Returns false on error
    })

    it('should handle R2 list failure gracefully', async () => {
      const { r2Layer, mockBucket } = createTestSetup()

      await r2Layer.put('list-fail-1', { data: '1' })
      await r2Layer.put('list-fail-2', { data: '2' })

      mockBucket.throwOnNext = 'list'
      const result = await r2Layer.list()

      expect(result.keys).toEqual([])
      expect(result.truncated).toBe(false)
    })
  })

  describe('R2 write failures', () => {
    it('should throw when R2 put fails', async () => {
      const { r2Layer, mockBucket } = createTestSetup()

      mockBucket.throwOnNext = 'put'

      await expect(r2Layer.put('write-fail', { data: 'test' })).rejects.toThrow()
    })

    it('should handle write-through failure when R2 is down', async () => {
      const { tieredStorage, doStorage, mockBucket } = createTestSetup()

      mockBucket.throwOnNext = 'put'

      // This should still succeed in DO storage even if R2 fails
      await tieredStorage.put('writethrough-fail', { data: 'test' }, { tier: 'warm', writeThrough: true })

      const doData = await doStorage.get<{ data: string }>('writethrough-fail')
      expect(doData?.data).toBe('test')
    })

    it('should handle demotion failure due to R2 write error', async () => {
      const { tieredStorage, doStorage, mockBucket } = createTestSetup()
      const events: DemotionEvent[] = []
      tieredStorage.onDemotion((e) => events.push(e))

      await doStorage.put('demote-r2-fail', { data: 'test' })

      mockBucket.throwOnNext = 'put'
      await tieredStorage.demoteFromWarm('demote-r2-fail')

      expect(events[0].success).toBe(false)
      // Data should still be in DO since demotion failed
      const doData = await doStorage.get<{ data: string }>('demote-r2-fail')
      expect(doData?.data).toBe('test')
    })
  })

  describe('R2 delete failures', () => {
    it('should handle R2 delete failure during tier deletion', async () => {
      const { tieredStorage, r2Layer, mockBucket, cacheLayer, doStorage } = createTestSetup()

      // Put in all tiers
      await cacheLayer.put('delete-fail', 'hot')
      await doStorage.put('delete-fail', 'warm')
      await r2Layer.put('delete-fail', 'cold')

      // Fail R2 delete but continue with other tiers
      mockBucket.throwOnNext = 'delete'
      await tieredStorage.delete('delete-fail')

      // Cache and DO should be deleted
      expect(await cacheLayer.has('delete-fail')).toBe(false)
      expect(await doStorage.has('delete-fail')).toBe(false)
      // R2 might still have it since delete failed
    })
  })

  describe('R2 timeout/slow scenarios', () => {
    it('should handle slow R2 responses', async () => {
      const { r2Layer, mockBucket } = createTestSetup()

      await r2Layer.put('slow-key', { data: 'test' })

      mockBucket.slowMode = true
      mockBucket.slowDelayMs = 50

      const start = Date.now()
      const result = await r2Layer.get<{ data: string }>('slow-key')
      const duration = Date.now() - start

      expect(result?.data).toBe('test')
      expect(duration).toBeGreaterThanOrEqual(50)
    })
  })
})

// ============================================================================
// CONCURRENT ACCESS PATTERNS
// ============================================================================

describe('Concurrent Access Patterns', () => {
  describe('concurrent reads', () => {
    it('should handle concurrent reads from same key', async () => {
      const { tieredStorage, doStorage } = createTestSetup()

      await doStorage.put('concurrent-read', { value: 42 })

      const reads = Array.from({ length: 20 }, () =>
        tieredStorage.get<{ value: number }>('concurrent-read')
      )

      const results = await Promise.all(reads)

      for (const result of results) {
        expect(result?.value).toBe(42)
      }
    })

    it('should handle concurrent reads from different tiers', async () => {
      const { tieredStorage, cacheLayer, doStorage, r2Layer } = createTestSetup()

      // Set up data in all tiers
      await cacheLayer.put('hot-key', { tier: 'hot' })
      await doStorage.put('warm-key', { tier: 'warm' })
      await r2Layer.put('cold-key', { tier: 'cold' })

      const reads = [
        ...Array.from({ length: 5 }, () => tieredStorage.get<{ tier: string }>('hot-key')),
        ...Array.from({ length: 5 }, () => tieredStorage.get<{ tier: string }>('warm-key')),
        ...Array.from({ length: 5 }, () => tieredStorage.get<{ tier: string }>('cold-key')),
      ]

      const results = await Promise.all(reads)

      // Count results by tier
      const tierCounts = { hot: 0, warm: 0, cold: 0 }
      for (const result of results) {
        if (result?.tier === 'hot') tierCounts.hot++
        if (result?.tier === 'warm') tierCounts.warm++
        if (result?.tier === 'cold') tierCounts.cold++
      }

      expect(tierCounts.hot).toBe(5)
      expect(tierCounts.warm).toBe(5)
      expect(tierCounts.cold).toBe(5)
    })

    it('should handle concurrent getMany operations', async () => {
      const { tieredStorage, doStorage } = createTestSetup()

      // Set up test data
      for (let i = 0; i < 10; i++) {
        await doStorage.put(`getmany-${i}`, { index: i })
      }

      const keys = Array.from({ length: 10 }, (_, i) => `getmany-${i}`)

      const getManyOps = Array.from({ length: 5 }, () =>
        tieredStorage.getMany<{ index: number }>(keys)
      )

      const results = await Promise.all(getManyOps)

      for (const result of results) {
        expect(result.size).toBe(10)
        for (let i = 0; i < 10; i++) {
          expect(result.get(`getmany-${i}`)?.index).toBe(i)
        }
      }
    })
  })

  describe('concurrent writes', () => {
    it('should handle concurrent writes to different keys', async () => {
      const { tieredStorage } = createTestSetup()

      const writes = Array.from({ length: 20 }, (_, i) =>
        tieredStorage.put(`concurrent-write-${i}`, { index: i })
      )

      await Promise.all(writes)

      // Verify all writes succeeded
      for (let i = 0; i < 20; i++) {
        const result = await tieredStorage.get<{ index: number }>(`concurrent-write-${i}`)
        expect(result?.index).toBe(i)
      }
    })

    it('should handle concurrent writes to same key (last write wins)', async () => {
      const { tieredStorage } = createTestSetup()

      // Fire off writes with different values
      const writes = Array.from({ length: 10 }, (_, i) =>
        tieredStorage.put('same-key-write', { writer: i })
      )

      await Promise.all(writes)

      // One of the writers should have won
      const result = await tieredStorage.get<{ writer: number }>('same-key-write')
      expect(typeof result?.writer).toBe('number')
      expect(result?.writer).toBeGreaterThanOrEqual(0)
      expect(result?.writer).toBeLessThan(10)
    })

    it('should handle concurrent putMany operations', async () => {
      const { tieredStorage } = createTestSetup()

      const batchOps = Array.from({ length: 5 }, (_, batchIndex) => {
        const entries = new Map<string, { batch: number; index: number }>()
        for (let i = 0; i < 10; i++) {
          entries.set(`batch-${batchIndex}-${i}`, { batch: batchIndex, index: i })
        }
        return tieredStorage.putMany(entries)
      })

      await Promise.all(batchOps)

      // Verify all writes
      for (let b = 0; b < 5; b++) {
        for (let i = 0; i < 10; i++) {
          const result = await tieredStorage.get<{ batch: number; index: number }>(`batch-${b}-${i}`)
          expect(result?.batch).toBe(b)
          expect(result?.index).toBe(i)
        }
      }
    })
  })

  describe('concurrent promotions', () => {
    it('should handle concurrent auto-promotions', async () => {
      const { tieredStorage, doStorage } = createTestSetup({
        autoPromote: true,
        promotionThreshold: 2,
      })

      // Set up multiple keys in warm tier
      for (let i = 0; i < 5; i++) {
        await doStorage.put(`auto-promo-${i}`, { index: i })
      }

      // Concurrently trigger promotions by reading multiple times
      const accessOps = []
      for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 3; j++) {
          accessOps.push(tieredStorage.get(`auto-promo-${i}`))
        }
      }

      await Promise.all(accessOps)

      // All keys should be in hot tier
      for (let i = 0; i < 5; i++) {
        const location = await tieredStorage.locateKey(`auto-promo-${i}`)
        expect(location.tier).toBe('hot')
      }
    })

    it('should handle concurrent manual promotions', async () => {
      const { tieredStorage, r2Layer } = createTestSetup()
      const events: PromotionEvent[] = []
      tieredStorage.onPromotion((e) => events.push(e))

      // Set up data in cold tier
      for (let i = 0; i < 10; i++) {
        await r2Layer.put(`manual-promo-${i}`, { index: i })
      }

      // Concurrently promote all
      const promotions = Array.from({ length: 10 }, (_, i) =>
        tieredStorage.promoteToWarm(`manual-promo-${i}`)
      )

      await Promise.all(promotions)

      expect(events.length).toBe(10)
      expect(events.filter((e) => e.success).length).toBe(10)
    })
  })

  describe('concurrent deletions', () => {
    it('should handle concurrent deletes of different keys', async () => {
      const { tieredStorage } = createTestSetup()

      // Set up test data
      for (let i = 0; i < 20; i++) {
        await tieredStorage.put(`delete-${i}`, { index: i })
      }

      const deletes = Array.from({ length: 20 }, (_, i) =>
        tieredStorage.delete(`delete-${i}`)
      )

      await Promise.all(deletes)

      // Verify all deleted
      for (let i = 0; i < 20; i++) {
        expect(await tieredStorage.has(`delete-${i}`)).toBe(false)
      }
    })

    it('should handle concurrent deleteMany operations', async () => {
      const { tieredStorage } = createTestSetup()

      // Set up test data
      for (let i = 0; i < 30; i++) {
        await tieredStorage.put(`bulk-delete-${i}`, { index: i })
      }

      // Delete in batches concurrently
      const deleteBatches = [
        tieredStorage.deleteMany(Array.from({ length: 10 }, (_, i) => `bulk-delete-${i}`)),
        tieredStorage.deleteMany(Array.from({ length: 10 }, (_, i) => `bulk-delete-${i + 10}`)),
        tieredStorage.deleteMany(Array.from({ length: 10 }, (_, i) => `bulk-delete-${i + 20}`)),
      ]

      await Promise.all(deleteBatches)

      // Verify all deleted
      expect(await tieredStorage.count()).toBe(0)
    })
  })

  describe('mixed concurrent operations', () => {
    it('should handle read-write-delete interleaving', async () => {
      const { tieredStorage } = createTestSetup()

      // Pre-populate some data
      for (let i = 0; i < 10; i++) {
        await tieredStorage.put(`interleave-${i}`, { initial: true })
      }

      // Mix of operations
      const ops = [
        // Reads
        ...Array.from({ length: 5 }, (_, i) => tieredStorage.get(`interleave-${i}`)),
        // Writes
        ...Array.from({ length: 5 }, (_, i) => tieredStorage.put(`interleave-${i}`, { updated: true })),
        // Deletes
        ...Array.from({ length: 5 }, (_, i) => tieredStorage.delete(`interleave-${i + 5}`)),
        // New writes
        ...Array.from({ length: 5 }, (_, i) => tieredStorage.put(`interleave-new-${i}`, { new: true })),
      ]

      await Promise.all(ops)

      // Verify state after all operations
      // Keys 5-9 should be deleted
      for (let i = 5; i < 10; i++) {
        expect(await tieredStorage.has(`interleave-${i}`)).toBe(false)
      }

      // New keys should exist
      for (let i = 0; i < 5; i++) {
        expect(await tieredStorage.has(`interleave-new-${i}`)).toBe(true)
      }
    })

    it('should maintain statistics consistency under concurrent load', async () => {
      const { tieredStorage } = createTestSetup()
      tieredStorage.resetStats()

      const writeCount = 50
      const readCount = 100

      // Generate concurrent load
      const writes = Array.from({ length: writeCount }, (_, i) =>
        tieredStorage.put(`stats-key-${i % 10}`, { count: i })
      )

      const reads = Array.from({ length: readCount }, (_, i) =>
        tieredStorage.get(`stats-key-${i % 10}`)
      )

      await Promise.all([...writes, ...reads])

      const stats = tieredStorage.getStats()

      // Stats should be non-negative and consistent
      expect(stats.do.writes).toBeGreaterThanOrEqual(writeCount)
      expect(stats.do.reads).toBeGreaterThanOrEqual(0)
      expect(stats.cache.misses).toBeGreaterThanOrEqual(0)
    })
  })
})

// ============================================================================
// MEMORY PRESSURE SCENARIOS
// ============================================================================

describe('Memory Pressure Scenarios', () => {
  describe('large data handling', () => {
    it('should handle storage of large objects', async () => {
      const { tieredStorage } = createTestSetup()

      const largeObject = {
        id: 'large-test',
        data: 'x'.repeat(50000), // 50KB string
        array: Array.from({ length: 1000 }, (_, i) => ({ index: i, value: `item-${i}` })),
      }

      await tieredStorage.put('large-object', largeObject)
      const result = await tieredStorage.get<typeof largeObject>('large-object')

      expect(result?.id).toBe('large-test')
      expect(result?.data.length).toBe(50000)
      expect(result?.array.length).toBe(1000)
    })

    it('should handle many small objects', async () => {
      const { tieredStorage } = createTestSetup()

      // Write 1000 small objects
      const writes = Array.from({ length: 1000 }, (_, i) =>
        tieredStorage.put(`small-${i}`, { index: i })
      )

      await Promise.all(writes)

      // Verify count
      const count = await tieredStorage.count()
      expect(count).toBe(1000)

      // Sample reads
      for (let i = 0; i < 100; i += 10) {
        const result = await tieredStorage.get<{ index: number }>(`small-${i}`)
        expect(result?.index).toBe(i)
      }
    })

    it('should track bytes read/written accurately for large data', async () => {
      const { tieredStorage, cacheLayer } = createTestSetup()
      cacheLayer.resetStats()

      const largeData = { payload: 'A'.repeat(10000) }
      await tieredStorage.put('bytes-test', largeData, { tier: 'hot' })
      await tieredStorage.get('bytes-test')

      const stats = cacheLayer.getStats()
      expect(stats.bytesWritten).toBeGreaterThan(10000)
      expect(stats.bytesRead).toBeGreaterThan(10000)
    })
  })

  describe('high volume operations', () => {
    it('should handle burst write load', async () => {
      const { tieredStorage } = createTestSetup()

      const startTime = Date.now()

      // Burst of 500 writes
      const writes = Array.from({ length: 500 }, (_, i) =>
        tieredStorage.put(`burst-${i}`, { timestamp: Date.now(), index: i })
      )

      await Promise.all(writes)

      const duration = Date.now() - startTime

      // Verify all writes succeeded
      expect(await tieredStorage.count()).toBe(500)

      // Should complete in reasonable time (less than 10 seconds)
      expect(duration).toBeLessThan(10000)
    })

    it('should handle burst read load', async () => {
      const { tieredStorage, doStorage } = createTestSetup()

      // Prepare data
      for (let i = 0; i < 100; i++) {
        await doStorage.put(`read-burst-${i}`, { index: i })
      }

      // Burst of 1000 reads (10 reads per key)
      const reads = Array.from({ length: 1000 }, (_, i) =>
        tieredStorage.get(`read-burst-${i % 100}`)
      )

      const results = await Promise.all(reads)

      // All reads should succeed
      expect(results.filter((r) => r !== undefined).length).toBe(1000)
    })

    it('should maintain cache hit ratio under load', async () => {
      const { tieredStorage } = createTestSetup()
      tieredStorage.resetStats()

      // Write to hot tier
      for (let i = 0; i < 10; i++) {
        await tieredStorage.put(`hit-ratio-${i}`, { index: i }, { tier: 'hot' })
      }

      // Multiple reads from hot tier
      for (let i = 0; i < 100; i++) {
        await tieredStorage.get(`hit-ratio-${i % 10}`)
      }

      const stats = tieredStorage.getStats()
      // Most reads should be cache hits
      expect(stats.cache.hitRatio).toBeGreaterThan(0.8)
    })
  })

  describe('tier eviction simulation', () => {
    it('should handle simulated cache eviction by clearing hot tier', async () => {
      const { tieredStorage, cacheLayer, doStorage, mockCache } = createTestSetup()

      // Write to hot tier
      await tieredStorage.put('evict-test', { data: 'test' }, { tier: 'hot' })

      // Verify it's in hot tier
      expect((await tieredStorage.locateKey('evict-test')).tier).toBe('hot')

      // Simulate cache eviction
      mockCache.clear()

      // Should still be accessible from warm tier
      const result = await tieredStorage.get<{ data: string }>('evict-test')
      expect(result?.data).toBe('test')

      // Now located in warm tier
      expect((await tieredStorage.locateKey('evict-test')).tier).toBe('warm')
    })

    it('should handle data recovery after warm tier clear', async () => {
      const { tieredStorage, r2Layer, doStorage } = createTestSetup()

      // Write with write-through to have backup in cold tier
      await tieredStorage.put('recover-test', { data: 'backup' }, { tier: 'warm', writeThrough: true })

      // Clear warm tier
      await doStorage.clear()

      // Should still be accessible from cold tier
      const result = await tieredStorage.get<{ data: string }>('recover-test')
      expect(result?.data).toBe('backup')
    })

    it('should promote frequently accessed data during recovery', async () => {
      const { tieredStorage, r2Layer, doStorage } = createTestSetup({
        autoPromote: true,
        promotionThreshold: 2,
      })

      // Data only in cold tier
      await r2Layer.put('recovery-promo', { data: 'cold-only' })

      // Access pattern simulating recovery
      await tieredStorage.get('recovery-promo')
      await tieredStorage.get('recovery-promo')

      // Should have been promoted to warm
      const warmData = await doStorage.get<{ data: string }>('recovery-promo')
      expect(warmData?.data).toBe('cold-only')
    })
  })

  describe('statistics accuracy under pressure', () => {
    it('should accurately track all tier statistics after heavy use', async () => {
      const { tieredStorage, cacheLayer, doStorage, r2Layer } = createTestSetup()
      tieredStorage.resetStats()

      // Perform various operations
      // Writes to different tiers
      await tieredStorage.put('hot-stat', { tier: 'hot' }, { tier: 'hot' })
      await tieredStorage.put('warm-stat', { tier: 'warm' }, { tier: 'warm' })
      await tieredStorage.put('cold-stat', { tier: 'cold' }, { tier: 'cold' })

      // Multiple reads from each tier
      for (let i = 0; i < 5; i++) {
        await tieredStorage.get('hot-stat')
        await tieredStorage.get('warm-stat')
        await tieredStorage.get('cold-stat')
      }

      // Promotions
      await tieredStorage.promoteToWarm('cold-stat')
      await tieredStorage.promoteToHot('warm-stat')

      // Demotions
      await tieredStorage.demoteFromHot('hot-stat')

      const stats = tieredStorage.getStats()

      // Verify promotion stats
      expect(stats.promotions.coldToWarm).toBe(1)
      expect(stats.promotions.warmToHot).toBe(1)

      // Verify demotion stats
      expect(stats.demotions.hotToWarm).toBe(1)

      // Verify DO stats
      expect(stats.do.writes).toBeGreaterThan(0)
      expect(stats.do.reads).toBeGreaterThan(0)

      // Verify cache stats
      expect(stats.cache.writes).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// CROSS-TIER QUERY SCENARIOS
// ============================================================================

describe('Cross-Tier Query Scenarios', () => {
  describe('getMany across tiers', () => {
    it('should retrieve keys distributed across all tiers', async () => {
      const { tieredStorage, cacheLayer, doStorage, r2Layer } = createTestSetup()

      // Distribute keys across tiers
      await cacheLayer.put('cross-hot-1', { tier: 'hot', id: 1 })
      await cacheLayer.put('cross-hot-2', { tier: 'hot', id: 2 })
      await doStorage.put('cross-warm-1', { tier: 'warm', id: 3 })
      await doStorage.put('cross-warm-2', { tier: 'warm', id: 4 })
      await r2Layer.put('cross-cold-1', { tier: 'cold', id: 5 })
      await r2Layer.put('cross-cold-2', { tier: 'cold', id: 6 })

      const keys = [
        'cross-hot-1', 'cross-hot-2',
        'cross-warm-1', 'cross-warm-2',
        'cross-cold-1', 'cross-cold-2',
        'cross-missing-1', 'cross-missing-2',
      ]

      const results = await tieredStorage.getMany<{ tier: string; id: number }>(keys)

      expect(results.size).toBe(6)
      expect(results.get('cross-hot-1')?.tier).toBe('hot')
      expect(results.get('cross-warm-1')?.tier).toBe('warm')
      expect(results.get('cross-cold-1')?.tier).toBe('cold')
      expect(results.has('cross-missing-1')).toBe(false)
    })

    it('should handle getMany with all keys in cold tier', async () => {
      const { tieredStorage, r2Layer } = createTestSetup()

      // All keys in R2
      for (let i = 0; i < 10; i++) {
        await r2Layer.put(`cold-only-${i}`, { index: i })
      }

      const keys = Array.from({ length: 10 }, (_, i) => `cold-only-${i}`)
      const results = await tieredStorage.getMany<{ index: number }>(keys)

      expect(results.size).toBe(10)
      for (let i = 0; i < 10; i++) {
        expect(results.get(`cold-only-${i}`)?.index).toBe(i)
      }
    })

    it('should track access counts for getMany results', async () => {
      const { tieredStorage, doStorage } = createTestSetup()

      await doStorage.put('getmany-track-1', { id: 1 })
      await doStorage.put('getmany-track-2', { id: 2 })

      await tieredStorage.getMany(['getmany-track-1', 'getmany-track-2'])
      await tieredStorage.getMany(['getmany-track-1', 'getmany-track-2'])

      expect(tieredStorage.getAccessCount('getmany-track-1')).toBe(2)
      expect(tieredStorage.getAccessCount('getmany-track-2')).toBe(2)
    })
  })

  describe('has across tiers', () => {
    it('should find keys in any tier', async () => {
      const { tieredStorage, cacheLayer, doStorage, r2Layer } = createTestSetup()

      await cacheLayer.put('has-hot', 'value')
      await doStorage.put('has-warm', 'value')
      await r2Layer.put('has-cold', 'value')

      expect(await tieredStorage.has('has-hot')).toBe(true)
      expect(await tieredStorage.has('has-warm')).toBe(true)
      expect(await tieredStorage.has('has-cold')).toBe(true)
      expect(await tieredStorage.has('has-missing')).toBe(false)
    })

    it('should check tiers in priority order', async () => {
      const { tieredStorage, cacheLayer, mockCache } = createTestSetup()

      await cacheLayer.put('priority-check', 'hot-value')

      // If cache returns true, DO and R2 shouldn't be checked
      const result = await tieredStorage.has('priority-check')
      expect(result).toBe(true)
    })
  })

  describe('locateKey precision', () => {
    it('should precisely locate keys in each tier', async () => {
      const { tieredStorage, cacheLayer, doStorage, r2Layer } = createTestSetup()

      await cacheLayer.put('locate-hot', 'hot')
      await doStorage.put('locate-warm', 'warm')
      await r2Layer.put('locate-cold', 'cold')

      const hotLocation = await tieredStorage.locateKey('locate-hot')
      const warmLocation = await tieredStorage.locateKey('locate-warm')
      const coldLocation = await tieredStorage.locateKey('locate-cold')
      const missingLocation = await tieredStorage.locateKey('locate-missing')

      expect(hotLocation).toEqual({ tier: 'hot', found: true, key: 'locate-hot' })
      expect(warmLocation).toEqual({ tier: 'warm', found: true, key: 'locate-warm' })
      expect(coldLocation).toEqual({ tier: 'cold', found: true, key: 'locate-cold' })
      expect(missingLocation).toEqual({ found: false, key: 'locate-missing' })
    })

    it('should return highest tier when key exists in multiple tiers', async () => {
      const { tieredStorage, cacheLayer, doStorage, r2Layer } = createTestSetup()

      // Same key in all tiers
      await r2Layer.put('multi-tier', 'cold')
      await doStorage.put('multi-tier', 'warm')
      await cacheLayer.put('multi-tier', 'hot')

      const location = await tieredStorage.locateKey('multi-tier')
      expect(location.tier).toBe('hot')
    })
  })

  describe('list operations', () => {
    it('should list from DO storage correctly', async () => {
      const { tieredStorage } = createTestSetup()

      // Add items through tiered storage
      for (let i = 0; i < 20; i++) {
        await tieredStorage.put(`list-item-${i.toString().padStart(2, '0')}`, { index: i })
      }

      const result = await tieredStorage.list<{ index: number }>({ limit: 10, includeValues: true })

      expect(result.entries.size).toBe(10)
      expect(result.hasMore).toBe(true)
    })

    it('should paginate list results correctly', async () => {
      const { tieredStorage } = createTestSetup()

      for (let i = 0; i < 25; i++) {
        await tieredStorage.put(`page-item-${i.toString().padStart(2, '0')}`, { index: i })
      }

      let cursor: string | undefined
      const allKeys: string[] = []

      do {
        const result = await tieredStorage.list({ limit: 10, cursor })
        for (const [key] of result.entries) {
          allKeys.push(key)
        }
        cursor = result.cursor
      } while (cursor)

      expect(allKeys.length).toBe(25)
      // Check no duplicates
      expect(new Set(allKeys).size).toBe(25)
    })

    it('should filter by prefix correctly', async () => {
      const { tieredStorage } = createTestSetup()

      await tieredStorage.put('prefix-a-1', { type: 'a' })
      await tieredStorage.put('prefix-a-2', { type: 'a' })
      await tieredStorage.put('prefix-b-1', { type: 'b' })
      await tieredStorage.put('other-1', { type: 'other' })

      const result = await tieredStorage.list({ prefix: 'prefix-a' })

      expect(result.entries.size).toBe(2)
      for (const [key] of result.entries) {
        expect(key.startsWith('prefix-a')).toBe(true)
      }
    })
  })

  describe('count operations', () => {
    it('should count keys with prefix', async () => {
      const { tieredStorage } = createTestSetup()

      await tieredStorage.put('count-type-a-1', { type: 'a' })
      await tieredStorage.put('count-type-a-2', { type: 'a' })
      await tieredStorage.put('count-type-b-1', { type: 'b' })

      const countA = await tieredStorage.count('count-type-a')
      const countB = await tieredStorage.count('count-type-b')
      const countAll = await tieredStorage.count()

      expect(countA).toBe(2)
      expect(countB).toBe(1)
      expect(countAll).toBe(3)
    })
  })
})
