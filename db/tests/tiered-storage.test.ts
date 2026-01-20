/**
 * Tests for TieredStorageAdapter
 *
 * Tests the tiered storage pattern (Cache -> DO -> R2) for cost optimization.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  CacheLayer,
  R2StorageLayer,
  TieredStorageAdapter,
  type TieredStorageConfig,
  type CacheLayerConfig,
  type R2StorageLayerConfig,
} from '../tiered-storage'
import { MemoryStorageAdapter } from '../adapters/memory'

// Mock Cache API
class MockCache implements Cache {
  private store = new Map<string, Response>()

  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    const url = request instanceof Request ? request.url : request.toString()
    return this.store.get(url)
  }

  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    const url = request instanceof Request ? request.url : request.toString()
    const cloned = response.clone()
    this.store.set(url, cloned)
  }

  async delete(request: RequestInfo | URL): Promise<boolean> {
    const url = request instanceof Request ? request.url : request.toString()
    return this.store.delete(url)
  }

  async add(_request: RequestInfo | URL): Promise<void> {
    throw new Error('Not implemented')
  }

  async addAll(_requests: RequestInfo[]): Promise<void> {
    throw new Error('Not implemented')
  }

  async keys(): Promise<readonly Request[]> {
    throw new Error('Not implemented')
  }

  async matchAll(): Promise<readonly Response[]> {
    throw new Error('Not implemented')
  }
}

// Mock R2 Bucket
class MockR2Bucket implements R2Bucket {
  private store = new Map<string, { body: string; metadata?: R2HTTPMetadata }>()

  async get(key: string): Promise<R2ObjectBody | null> {
    const item = this.store.get(key)
    if (!item) return null

    return {
      key,
      version: '1',
      size: item.body.length,
      etag: 'test-etag',
      httpEtag: '"test-etag"',
      checksums: {} as R2Checksums,
      uploaded: new Date(),
      httpMetadata: item.metadata,
      customMetadata: {},
      range: undefined,
      storageClass: 'Standard',
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(item.body))
          controller.close()
        },
      }),
      bodyUsed: false,
      arrayBuffer: async () => new TextEncoder().encode(item.body).buffer as ArrayBuffer,
      text: async () => item.body,
      json: async <T>() => JSON.parse(item.body) as T,
      blob: async () => new Blob([item.body]),
      bytes: async () => new Uint8Array(new TextEncoder().encode(item.body)),
      writeHttpMetadata: () => {},
    } as R2ObjectBody
  }

  async put(key: string, value: ArrayBuffer | ArrayBufferView | string | Blob | ReadableStream, options?: R2PutOptions): Promise<R2Object> {
    let body: string
    if (typeof value === 'string') {
      body = value
    } else if (value instanceof Blob) {
      body = await value.text()
    } else if (value instanceof ArrayBuffer) {
      body = new TextDecoder().decode(value)
    } else if (ArrayBuffer.isView(value)) {
      body = new TextDecoder().decode(value)
    } else {
      // ReadableStream
      const reader = value.getReader()
      const chunks: Uint8Array[] = []
      let done = false
      while (!done) {
        const result = await reader.read()
        done = result.done
        if (result.value) chunks.push(result.value)
      }
      const combined = new Uint8Array(chunks.reduce((acc, chunk) => acc + chunk.length, 0))
      let offset = 0
      for (const chunk of chunks) {
        combined.set(chunk, offset)
        offset += chunk.length
      }
      body = new TextDecoder().decode(combined)
    }

    this.store.set(key, {
      body,
      metadata: options?.httpMetadata,
    })

    return {
      key,
      version: '1',
      size: body.length,
      etag: 'test-etag',
      httpEtag: '"test-etag"',
      checksums: {} as R2Checksums,
      uploaded: new Date(),
      httpMetadata: options?.httpMetadata,
      customMetadata: options?.customMetadata || {},
      storageClass: 'Standard',
      range: undefined,
      writeHttpMetadata: () => {},
    } as R2Object
  }

  async delete(keys: string | string[]): Promise<void> {
    const keyArray = Array.isArray(keys) ? keys : [keys]
    for (const key of keyArray) {
      this.store.delete(key)
    }
  }

  async head(key: string): Promise<R2Object | null> {
    const item = this.store.get(key)
    if (!item) return null

    return {
      key,
      version: '1',
      size: item.body.length,
      etag: 'test-etag',
      httpEtag: '"test-etag"',
      checksums: {} as R2Checksums,
      uploaded: new Date(),
      httpMetadata: item.metadata,
      customMetadata: {},
      storageClass: 'Standard',
      range: undefined,
      writeHttpMetadata: () => {},
    } as R2Object
  }

  async list(options?: R2ListOptions): Promise<R2Objects> {
    const prefix = options?.prefix || ''
    const objects: R2Object[] = []

    for (const [key, item] of this.store.entries()) {
      if (key.startsWith(prefix)) {
        objects.push({
          key,
          version: '1',
          size: item.body.length,
          etag: 'test-etag',
          httpEtag: '"test-etag"',
          checksums: {} as R2Checksums,
          uploaded: new Date(),
          httpMetadata: item.metadata,
          customMetadata: {},
          storageClass: 'Standard',
          range: undefined,
          writeHttpMetadata: () => {},
        } as R2Object)
      }
    }

    return {
      objects,
      truncated: false,
      delimitedPrefixes: [],
    }
  }

  createMultipartUpload(_key: string, _options?: R2MultipartOptions): Promise<R2MultipartUpload> {
    throw new Error('Not implemented')
  }

  resumeMultipartUpload(_key: string, _uploadId: string): R2MultipartUpload {
    throw new Error('Not implemented')
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

  it('should return undefined for missing keys', async () => {
    const result = await cacheLayer.get('missing-key')
    expect(result).toBeUndefined()
  })

  it('should store and retrieve values', async () => {
    await cacheLayer.put('test-key', { name: 'Test', value: 123 })
    const result = await cacheLayer.get('test-key')
    expect(result).toEqual({ name: 'Test', value: 123 })
  })

  it('should delete values', async () => {
    await cacheLayer.put('test-key', { name: 'Test' })
    expect(await cacheLayer.has('test-key')).toBe(true)

    await cacheLayer.delete('test-key')
    expect(await cacheLayer.has('test-key')).toBe(false)
  })

  it('should track statistics', async () => {
    await cacheLayer.get('missing')
    await cacheLayer.put('key1', { value: 1 })
    await cacheLayer.get('key1')
    await cacheLayer.get('missing2')

    const stats = cacheLayer.getStats()
    expect(stats.hits).toBe(1)
    expect(stats.misses).toBe(2)
    expect(stats.writes).toBe(1)
    expect(stats.hitRatio).toBeCloseTo(1 / 3)
  })
})

describe('R2StorageLayer', () => {
  let bucket: MockR2Bucket
  let r2Layer: R2StorageLayer
  const config: R2StorageLayerConfig = {
    bucket: null as unknown as R2Bucket,
    prefix: 'test/',
  }

  beforeEach(() => {
    bucket = new MockR2Bucket()
    config.bucket = bucket
    r2Layer = new R2StorageLayer(config)
  })

  it('should return undefined for missing keys', async () => {
    const result = await r2Layer.get('missing-key')
    expect(result).toBeUndefined()
  })

  it('should store and retrieve values', async () => {
    await r2Layer.put('test-key', { name: 'Test', value: 123 })
    const result = await r2Layer.get('test-key')
    expect(result).toEqual({ name: 'Test', value: 123 })
  })

  it('should apply prefix to keys', async () => {
    await r2Layer.put('my-key', { value: 1 })

    // Check it was stored with prefix
    const raw = await bucket.get('test/my-key')
    expect(raw).not.toBeNull()
  })

  it('should list keys', async () => {
    await r2Layer.put('key1', { value: 1 })
    await r2Layer.put('key2', { value: 2 })

    const result = await r2Layer.list()
    expect(result.keys).toContain('key1')
    expect(result.keys).toContain('key2')
  })

  it('should track statistics', async () => {
    await r2Layer.put('key1', { value: 1 })
    await r2Layer.get('key1')
    await r2Layer.delete('key1')

    const stats = r2Layer.getStats()
    expect(stats.writes).toBe(1)
    expect(stats.reads).toBe(1)
    expect(stats.deletes).toBe(1)
  })
})

describe('TieredStorageAdapter', () => {
  let cacheLayer: CacheLayer
  let doStorage: MemoryStorageAdapter
  let r2Layer: R2StorageLayer
  let tieredStorage: TieredStorageAdapter

  beforeEach(async () => {
    const cache = new MockCache()
    cacheLayer = new CacheLayer(cache, {
      cacheName: 'test-cache',
      ttlSeconds: 300,
      baseUrl: 'https://cache.test.dev',
    })

    doStorage = new MemoryStorageAdapter()

    const bucket = new MockR2Bucket()
    r2Layer = new R2StorageLayer({
      bucket,
      prefix: 'test/',
    })

    tieredStorage = new TieredStorageAdapter({
      cacheLayer,
      doStorage,
      r2Layer,
      promotionThreshold: 3,
      autoPromote: false,
    })
  })

  describe('Basic Operations', () => {
    it('should store and retrieve values from warm tier by default', async () => {
      await tieredStorage.put('key1', { name: 'Test', value: 123 })
      const result = await tieredStorage.get('key1')
      expect(result).toEqual({ name: 'Test', value: 123 })
    })

    it('should delete from all tiers', async () => {
      // Store in all tiers
      await tieredStorage.put('key1', { value: 1 }, { tier: 'hot' })
      await tieredStorage.put('key2', { value: 2 }, { tier: 'warm' })
      await tieredStorage.put('key3', { value: 3 }, { tier: 'cold' })

      await tieredStorage.delete('key1')
      await tieredStorage.delete('key2')
      await tieredStorage.delete('key3')

      expect(await tieredStorage.get('key1')).toBeUndefined()
      expect(await tieredStorage.get('key2')).toBeUndefined()
      expect(await tieredStorage.get('key3')).toBeUndefined()
    })

    it('should check existence across tiers', async () => {
      await tieredStorage.put('hot-key', { value: 1 }, { tier: 'hot' })
      await tieredStorage.put('warm-key', { value: 2 }, { tier: 'warm' })
      await tieredStorage.put('cold-key', { value: 3 }, { tier: 'cold' })

      expect(await tieredStorage.has('hot-key')).toBe(true)
      expect(await tieredStorage.has('warm-key')).toBe(true)
      expect(await tieredStorage.has('cold-key')).toBe(true)
      expect(await tieredStorage.has('missing-key')).toBe(false)
    })
  })

  describe('Tiered Read Path', () => {
    it('should read from hot tier first (cache)', async () => {
      // Put directly in cache
      await cacheLayer.put('cached-key', { source: 'cache' })

      const result = await tieredStorage.get('cached-key')
      expect(result).toEqual({ source: 'cache' })
    })

    it('should fall back to warm tier when not in cache', async () => {
      // Put in DO storage only
      await doStorage.put('do-key', { source: 'do' })

      const result = await tieredStorage.get('do-key')
      expect(result).toEqual({ source: 'do' })
    })

    it('should fall back to cold tier when not in cache or DO', async () => {
      // Put in R2 only
      await r2Layer.put('r2-key', { source: 'r2' })

      const result = await tieredStorage.get('r2-key')
      expect(result).toEqual({ source: 'r2' })
    })
  })

  describe('Tiered Write Path', () => {
    it('should write to warm tier by default', async () => {
      await tieredStorage.put('default-key', { value: 1 })

      // Should be in DO, not in cache or R2
      expect(await doStorage.get('default-key')).toEqual({ value: 1 })
      expect(await cacheLayer.get('default-key')).toBeUndefined()
      expect(await r2Layer.get('default-key')).toBeUndefined()
    })

    it('should write to hot tier when specified', async () => {
      await tieredStorage.put('hot-key', { value: 1 }, { tier: 'hot' })

      // Should be in both DO (for persistence) and cache (for speed)
      expect(await doStorage.get('hot-key')).toEqual({ value: 1 })
      expect(await cacheLayer.get('hot-key')).toEqual({ value: 1 })
    })

    it('should write to cold tier when specified', async () => {
      await tieredStorage.put('cold-key', { value: 1 }, { tier: 'cold' })

      // Should only be in R2
      expect(await r2Layer.get('cold-key')).toEqual({ value: 1 })
      expect(await doStorage.get('cold-key')).toBeUndefined()
      expect(await cacheLayer.get('cold-key')).toBeUndefined()
    })

    it('should write through to cold tier when specified', async () => {
      await tieredStorage.put('persistent-key', { value: 1 }, { tier: 'warm', writeThrough: true })

      // Should be in both DO and R2
      expect(await doStorage.get('persistent-key')).toEqual({ value: 1 })
      expect(await r2Layer.get('persistent-key')).toEqual({ value: 1 })
    })
  })

  describe('Tier Location', () => {
    it('should locate keys in correct tiers', async () => {
      await cacheLayer.put('hot-key', { value: 1 })
      await doStorage.put('warm-key', { value: 2 })
      await r2Layer.put('cold-key', { value: 3 })

      expect(await tieredStorage.locateKey('hot-key')).toEqual({
        tier: 'hot',
        found: true,
        key: 'hot-key',
      })
      expect(await tieredStorage.locateKey('warm-key')).toEqual({
        tier: 'warm',
        found: true,
        key: 'warm-key',
      })
      expect(await tieredStorage.locateKey('cold-key')).toEqual({
        tier: 'cold',
        found: true,
        key: 'cold-key',
      })
      expect(await tieredStorage.locateKey('missing-key')).toEqual({
        found: false,
        key: 'missing-key',
      })
    })
  })

  describe('Promotion', () => {
    it('should promote from cold to warm', async () => {
      await r2Layer.put('cold-key', { value: 1 })

      await tieredStorage.promoteToWarm('cold-key')

      expect(await doStorage.get('cold-key')).toEqual({ value: 1 })
    })

    it('should promote from warm to hot', async () => {
      await doStorage.put('warm-key', { value: 1 })

      await tieredStorage.promoteToHot('warm-key')

      expect(await cacheLayer.get('warm-key')).toEqual({ value: 1 })
    })

    it('should emit promotion events', async () => {
      const promotionEvents: any[] = []
      tieredStorage.onPromotion((event) => promotionEvents.push(event))

      await r2Layer.put('cold-key', { value: 1 })
      await tieredStorage.promoteToWarm('cold-key')

      expect(promotionEvents).toHaveLength(1)
      expect(promotionEvents[0].fromTier).toBe('cold')
      expect(promotionEvents[0].toTier).toBe('warm')
      expect(promotionEvents[0].success).toBe(true)
    })
  })

  describe('Demotion', () => {
    it('should demote from hot to warm', async () => {
      await tieredStorage.put('hot-key', { value: 1 }, { tier: 'hot' })

      await tieredStorage.demoteFromHot('hot-key')

      // Should be removed from cache but still in DO
      expect(await cacheLayer.get('hot-key')).toBeUndefined()
      expect(await doStorage.get('hot-key')).toEqual({ value: 1 })
    })

    it('should demote from warm to cold', async () => {
      await doStorage.put('warm-key', { value: 1 })

      await tieredStorage.demoteFromWarm('warm-key')

      // Should be in R2 and removed from DO
      expect(await r2Layer.get('warm-key')).toEqual({ value: 1 })
      expect(await doStorage.get('warm-key')).toBeUndefined()
    })

    it('should emit demotion events', async () => {
      const demotionEvents: any[] = []
      tieredStorage.onDemotion((event) => demotionEvents.push(event))

      await tieredStorage.put('hot-key', { value: 1 }, { tier: 'hot' })
      await tieredStorage.demoteFromHot('hot-key')

      expect(demotionEvents).toHaveLength(1)
      expect(demotionEvents[0].fromTier).toBe('hot')
      expect(demotionEvents[0].toTier).toBe('warm')
      expect(demotionEvents[0].success).toBe(true)
    })
  })

  describe('Access Tracking', () => {
    it('should track access counts', async () => {
      await tieredStorage.put('key1', { value: 1 })

      await tieredStorage.get('key1')
      expect(tieredStorage.getAccessCount('key1')).toBe(1)

      await tieredStorage.get('key1')
      expect(tieredStorage.getAccessCount('key1')).toBe(2)

      await tieredStorage.get('key1')
      expect(tieredStorage.getAccessCount('key1')).toBe(3)
    })

    it('should reset access count on promotion', async () => {
      await r2Layer.put('cold-key', { value: 1 })

      // Access multiple times
      await tieredStorage.get('cold-key')
      await tieredStorage.get('cold-key')
      await tieredStorage.get('cold-key')
      expect(tieredStorage.getAccessCount('cold-key')).toBe(3)

      // Promote
      await tieredStorage.promoteToWarm('cold-key')
      expect(tieredStorage.getAccessCount('cold-key')).toBe(0)
    })
  })

  describe('Auto-Promotion', () => {
    it('should auto-promote when enabled and threshold reached', async () => {
      tieredStorage.setAutoPromote(true)

      // Put in cold tier
      await r2Layer.put('cold-key', { value: 1 })

      // Access multiple times to reach threshold
      await tieredStorage.get('cold-key')
      await tieredStorage.get('cold-key')
      await tieredStorage.get('cold-key') // 3rd access - should trigger promotion

      // Should now be in warm tier
      expect(await doStorage.get('cold-key')).toEqual({ value: 1 })
    })

    it('should not auto-promote when disabled', async () => {
      tieredStorage.setAutoPromote(false)

      // Put in cold tier
      await r2Layer.put('cold-key', { value: 1 })

      // Access multiple times
      for (let i = 0; i < 10; i++) {
        await tieredStorage.get('cold-key')
      }

      // Should NOT be in warm tier
      expect(await doStorage.get('cold-key')).toBeUndefined()
    })
  })

  describe('Statistics', () => {
    it('should aggregate statistics from all tiers', async () => {
      // Perform various operations
      await tieredStorage.put('key1', { value: 1 }, { tier: 'hot' })
      await tieredStorage.put('key2', { value: 2 }, { tier: 'warm' })
      await tieredStorage.put('key3', { value: 3 }, { tier: 'cold' })
      await tieredStorage.get('key1')
      await tieredStorage.get('key2')
      await tieredStorage.get('key3')

      const stats = tieredStorage.getStats()

      expect(stats.cache.writes).toBeGreaterThan(0)
      expect(stats.do.writes).toBeGreaterThan(0)
      expect(stats.r2.writes).toBeGreaterThan(0)
    })

    it('should reset all statistics', async () => {
      await tieredStorage.put('key1', { value: 1 })
      await tieredStorage.get('key1')

      tieredStorage.resetStats()

      const stats = tieredStorage.getStats()
      expect(stats.do.reads).toBe(0)
      expect(stats.do.writes).toBe(0)
      expect(stats.cache.hits).toBe(0)
    })
  })
})
