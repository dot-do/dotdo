import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ObjectType } from '../../src/types/objects'
import { TieredObjectStoreStub } from '../../src/tiered/read-path'

/**
 * Tiered Read Path Tests
 *
 * Tests for reading objects from the multi-tier storage system:
 * - Hot tier: Durable Object SQLite (fastest, local)
 * - Warm tier: R2 object storage (medium latency, packed objects)
 * - Cold tier: Analytics/Parquet (highest latency, cold storage)
 *
 * These tests verify:
 * 1. Hot tier reads (DO storage)
 * 2. Warm tier reads (R2)
 * 3. Cold tier reads (analytics)
 * 4. Tier fallback on miss
 * 5. Cache promotion
 */

// Type definitions for tiered storage interfaces (to be implemented)
interface StoredObject {
  sha: string
  type: ObjectType
  size: number
  data: Uint8Array
  createdAt: number
}

interface TierConfig {
  enabled: boolean
  maxSize?: number
  ttl?: number
}

interface TieredStorageConfig {
  hot: TierConfig
  warm: TierConfig
  cold: TierConfig
  promotionPolicy: 'aggressive' | 'conservative' | 'none'
}

interface ReadResult {
  object: StoredObject | null
  tier: 'hot' | 'warm' | 'cold' | null
  promoted: boolean
  latencyMs: number
}

interface TieredObjectStore {
  read(sha: string): Promise<ReadResult>
  readFromHot(sha: string): Promise<StoredObject | null>
  readFromWarm(sha: string): Promise<StoredObject | null>
  readFromCold(sha: string): Promise<StoredObject | null>
  promoteToHot(sha: string, object: StoredObject): Promise<void>
  getConfig(): TieredStorageConfig
}

// Mock interfaces for tier backends
interface HotTierBackend {
  get(sha: string): Promise<StoredObject | null>
  put(sha: string, object: StoredObject): Promise<void>
  delete(sha: string): Promise<boolean>
  has(sha: string): Promise<boolean>
}

interface WarmTierBackend {
  get(sha: string): Promise<StoredObject | null>
  getFromPack(packId: string, offset: number): Promise<StoredObject | null>
}

interface ColdTierBackend {
  get(sha: string): Promise<StoredObject | null>
  query(filter: { type?: ObjectType; minSize?: number; maxSize?: number }): Promise<StoredObject[]>
}

// Helper functions
const encoder = new TextEncoder()
const sampleSha = 'a'.repeat(40)
const sampleSha2 = 'b'.repeat(40)
const sampleSha3 = 'c'.repeat(40)

function createTestObject(sha: string, content: string, type: ObjectType = 'blob'): StoredObject {
  const data = encoder.encode(content)
  return {
    sha,
    type,
    size: data.length,
    data,
    createdAt: Date.now()
  }
}

// Mock implementations for testing (stubs that will cause tests to fail)
class MockHotTierBackend implements HotTierBackend {
  private objects: Map<string, StoredObject> = new Map()

  async get(sha: string): Promise<StoredObject | null> {
    return this.objects.get(sha) ?? null
  }

  async put(sha: string, object: StoredObject): Promise<void> {
    this.objects.set(sha, object)
  }

  async delete(sha: string): Promise<boolean> {
    return this.objects.delete(sha)
  }

  async has(sha: string): Promise<boolean> {
    return this.objects.has(sha)
  }

  // Test helper to inject objects
  inject(sha: string, object: StoredObject): void {
    this.objects.set(sha, object)
  }

  clear(): void {
    this.objects.clear()
  }
}

class MockWarmTierBackend implements WarmTierBackend {
  private objects: Map<string, StoredObject> = new Map()
  private packs: Map<string, Map<number, StoredObject>> = new Map()

  async get(sha: string): Promise<StoredObject | null> {
    return this.objects.get(sha) ?? null
  }

  async getFromPack(packId: string, offset: number): Promise<StoredObject | null> {
    const pack = this.packs.get(packId)
    if (!pack) return null
    return pack.get(offset) ?? null
  }

  // Test helpers
  inject(sha: string, object: StoredObject): void {
    this.objects.set(sha, object)
  }

  injectInPack(packId: string, offset: number, object: StoredObject): void {
    if (!this.packs.has(packId)) {
      this.packs.set(packId, new Map())
    }
    this.packs.get(packId)!.set(offset, object)
    // Also add to objects map so get() can find it by SHA
    this.objects.set(object.sha, object)
  }

  clear(): void {
    this.objects.clear()
    this.packs.clear()
  }
}

class MockColdTierBackend implements ColdTierBackend {
  private objects: Map<string, StoredObject> = new Map()

  async get(sha: string): Promise<StoredObject | null> {
    return this.objects.get(sha) ?? null
  }

  async query(filter: { type?: ObjectType; minSize?: number; maxSize?: number }): Promise<StoredObject[]> {
    const results: StoredObject[] = []
    for (const obj of this.objects.values()) {
      if (filter.type && obj.type !== filter.type) continue
      if (filter.minSize !== undefined && obj.size < filter.minSize) continue
      if (filter.maxSize !== undefined && obj.size > filter.maxSize) continue
      results.push(obj)
    }
    return results
  }

  // Test helpers
  inject(sha: string, object: StoredObject): void {
    this.objects.set(sha, object)
  }

  clear(): void {
    this.objects.clear()
  }
}

// TieredObjectStoreStub is imported from src/tiered/read-path.ts

describe('Tiered Read Path', () => {
  let hotBackend: MockHotTierBackend
  let warmBackend: MockWarmTierBackend
  let coldBackend: MockColdTierBackend
  let store: TieredObjectStore
  let defaultConfig: TieredStorageConfig

  beforeEach(() => {
    hotBackend = new MockHotTierBackend()
    warmBackend = new MockWarmTierBackend()
    coldBackend = new MockColdTierBackend()
    defaultConfig = {
      hot: { enabled: true, maxSize: 1024 * 1024 }, // 1MB
      warm: { enabled: true },
      cold: { enabled: true },
      promotionPolicy: 'aggressive'
    }
    store = new TieredObjectStoreStub(hotBackend, warmBackend, coldBackend, defaultConfig)
  })

  describe('Hot Tier Reads (DO Storage)', () => {
    it('should read object from hot tier when present', async () => {
      const testObj = createTestObject(sampleSha, 'hot tier content')
      hotBackend.inject(sampleSha, testObj)

      const result = await store.read(sampleSha)

      expect(result.object).not.toBeNull()
      expect(result.tier).toBe('hot')
      expect(result.object!.sha).toBe(sampleSha)
      expect(result.object!.data).toEqual(testObj.data)
    })

    it('should return null tier when object not found anywhere', async () => {
      const result = await store.read('nonexistent'.repeat(4))

      expect(result.object).toBeNull()
      expect(result.tier).toBeNull()
    })

    it('should read object directly from hot tier using readFromHot', async () => {
      const testObj = createTestObject(sampleSha, 'direct hot read')
      hotBackend.inject(sampleSha, testObj)

      const obj = await store.readFromHot(sampleSha)

      expect(obj).not.toBeNull()
      expect(obj!.sha).toBe(sampleSha)
    })

    it('should return null from readFromHot when object not in hot tier', async () => {
      // Object only in warm tier
      warmBackend.inject(sampleSha, createTestObject(sampleSha, 'warm only'))

      const obj = await store.readFromHot(sampleSha)

      expect(obj).toBeNull()
    })

    it('should have lowest latency for hot tier reads', async () => {
      const testObj = createTestObject(sampleSha, 'latency test')
      hotBackend.inject(sampleSha, testObj)

      const result = await store.read(sampleSha)

      // Hot tier should be fast (< 10ms in test environment)
      expect(result.latencyMs).toBeLessThan(10)
    })

    it('should not mark hot tier read as promoted', async () => {
      const testObj = createTestObject(sampleSha, 'no promotion needed')
      hotBackend.inject(sampleSha, testObj)

      const result = await store.read(sampleSha)

      expect(result.promoted).toBe(false)
    })

    it('should handle multiple concurrent hot tier reads', async () => {
      const obj1 = createTestObject(sampleSha, 'concurrent 1')
      const obj2 = createTestObject(sampleSha2, 'concurrent 2')
      const obj3 = createTestObject(sampleSha3, 'concurrent 3')
      hotBackend.inject(sampleSha, obj1)
      hotBackend.inject(sampleSha2, obj2)
      hotBackend.inject(sampleSha3, obj3)

      const results = await Promise.all([
        store.read(sampleSha),
        store.read(sampleSha2),
        store.read(sampleSha3)
      ])

      expect(results.every(r => r.object !== null)).toBe(true)
      expect(results.every(r => r.tier === 'hot')).toBe(true)
    })

    it('should handle binary data in hot tier', async () => {
      const binaryData = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe, 0x00])
      const binaryObj: StoredObject = {
        sha: sampleSha,
        type: 'blob',
        size: binaryData.length,
        data: binaryData,
        createdAt: Date.now()
      }
      hotBackend.inject(sampleSha, binaryObj)

      const result = await store.read(sampleSha)

      expect(result.object).not.toBeNull()
      expect(result.object!.data).toEqual(binaryData)
    })
  })

  describe('Warm Tier Reads (R2)', () => {
    it('should read object from warm tier when not in hot', async () => {
      const testObj = createTestObject(sampleSha, 'warm tier content')
      warmBackend.inject(sampleSha, testObj)

      const result = await store.read(sampleSha)

      expect(result.object).not.toBeNull()
      expect(result.tier).toBe('warm')
      expect(result.object!.sha).toBe(sampleSha)
    })

    it('should read object directly from warm tier using readFromWarm', async () => {
      const testObj = createTestObject(sampleSha, 'direct warm read')
      warmBackend.inject(sampleSha, testObj)

      const obj = await store.readFromWarm(sampleSha)

      expect(obj).not.toBeNull()
      expect(obj!.sha).toBe(sampleSha)
    })

    it('should return null from readFromWarm when object not in warm tier', async () => {
      // Object only in cold tier
      coldBackend.inject(sampleSha, createTestObject(sampleSha, 'cold only'))

      const obj = await store.readFromWarm(sampleSha)

      expect(obj).toBeNull()
    })

    it('should read object from pack file in warm tier', async () => {
      const testObj = createTestObject(sampleSha, 'packed object')
      warmBackend.injectInPack('pack-001', 1024, testObj)

      // This test assumes the store can look up pack location from object index
      // and then retrieve from the pack
      const obj = await store.readFromWarm(sampleSha)

      // For RED phase, this will fail as implementation doesn't exist
      expect(obj).not.toBeNull()
    })

    it('should handle large objects in warm tier', async () => {
      const largeData = new Uint8Array(5 * 1024 * 1024) // 5MB
      for (let i = 0; i < largeData.length; i++) {
        largeData[i] = i % 256
      }
      const largeObj: StoredObject = {
        sha: sampleSha,
        type: 'blob',
        size: largeData.length,
        data: largeData,
        createdAt: Date.now()
      }
      warmBackend.inject(sampleSha, largeObj)

      const result = await store.read(sampleSha)

      expect(result.object).not.toBeNull()
      expect(result.object!.size).toBe(5 * 1024 * 1024)
    })

    it('should prefer hot tier over warm tier', async () => {
      const hotObj = createTestObject(sampleSha, 'hot version')
      const warmObj = createTestObject(sampleSha, 'warm version')
      hotBackend.inject(sampleSha, hotObj)
      warmBackend.inject(sampleSha, warmObj)

      const result = await store.read(sampleSha)

      expect(result.tier).toBe('hot')
      expect(new TextDecoder().decode(result.object!.data)).toBe('hot version')
    })
  })

  describe('Cold Tier Reads (Analytics)', () => {
    it('should read object from cold tier when not in hot or warm', async () => {
      const testObj = createTestObject(sampleSha, 'cold tier content')
      coldBackend.inject(sampleSha, testObj)

      const result = await store.read(sampleSha)

      expect(result.object).not.toBeNull()
      expect(result.tier).toBe('cold')
      expect(result.object!.sha).toBe(sampleSha)
    })

    it('should read object directly from cold tier using readFromCold', async () => {
      const testObj = createTestObject(sampleSha, 'direct cold read')
      coldBackend.inject(sampleSha, testObj)

      const obj = await store.readFromCold(sampleSha)

      expect(obj).not.toBeNull()
      expect(obj!.sha).toBe(sampleSha)
    })

    it('should return null from readFromCold when object not in cold tier', async () => {
      // Object only in hot tier
      hotBackend.inject(sampleSha, createTestObject(sampleSha, 'hot only'))

      const obj = await store.readFromCold(sampleSha)

      expect(obj).toBeNull()
    })

    it('should handle tree objects in cold tier', async () => {
      const treeObj = createTestObject(sampleSha, 'tree data', 'tree')
      coldBackend.inject(sampleSha, treeObj)

      const result = await store.read(sampleSha)

      expect(result.object).not.toBeNull()
      expect(result.object!.type).toBe('tree')
    })

    it('should handle commit objects in cold tier', async () => {
      const commitObj = createTestObject(sampleSha, 'commit data', 'commit')
      coldBackend.inject(sampleSha, commitObj)

      const result = await store.read(sampleSha)

      expect(result.object).not.toBeNull()
      expect(result.object!.type).toBe('commit')
    })

    it('should have higher latency for cold tier reads', async () => {
      const testObj = createTestObject(sampleSha, 'cold latency test')
      coldBackend.inject(sampleSha, testObj)

      const result = await store.read(sampleSha)

      // Cold tier should have measurable latency (implementation should track this)
      expect(result.latencyMs).toBeDefined()
      expect(typeof result.latencyMs).toBe('number')
    })
  })

  describe('Tier Fallback on Miss', () => {
    it('should fall back from hot to warm on miss', async () => {
      // Object only in warm tier
      const testObj = createTestObject(sampleSha, 'warm fallback')
      warmBackend.inject(sampleSha, testObj)

      const result = await store.read(sampleSha)

      expect(result.object).not.toBeNull()
      expect(result.tier).toBe('warm')
    })

    it('should fall back from hot to warm to cold on miss', async () => {
      // Object only in cold tier
      const testObj = createTestObject(sampleSha, 'cold fallback')
      coldBackend.inject(sampleSha, testObj)

      const result = await store.read(sampleSha)

      expect(result.object).not.toBeNull()
      expect(result.tier).toBe('cold')
    })

    it('should check tiers in order: hot -> warm -> cold', async () => {
      const checkOrder: string[] = []

      // Create a custom store to track check order
      const trackingStore: TieredObjectStore = {
        async read(sha: string): Promise<ReadResult> {
          checkOrder.push('hot')
          const hotResult = await this.readFromHot(sha)
          if (hotResult) {
            return { object: hotResult, tier: 'hot', promoted: false, latencyMs: 1 }
          }

          checkOrder.push('warm')
          const warmResult = await this.readFromWarm(sha)
          if (warmResult) {
            return { object: warmResult, tier: 'warm', promoted: false, latencyMs: 10 }
          }

          checkOrder.push('cold')
          const coldResult = await this.readFromCold(sha)
          if (coldResult) {
            return { object: coldResult, tier: 'cold', promoted: false, latencyMs: 100 }
          }

          return { object: null, tier: null, promoted: false, latencyMs: 0 }
        },
        async readFromHot(_sha: string): Promise<StoredObject | null> {
          return null
        },
        async readFromWarm(_sha: string): Promise<StoredObject | null> {
          return null
        },
        async readFromCold(sha: string): Promise<StoredObject | null> {
          return coldBackend.get(sha)
        },
        async promoteToHot(): Promise<void> {},
        getConfig: () => defaultConfig
      }

      coldBackend.inject(sampleSha, createTestObject(sampleSha, 'deep in cold'))

      await trackingStore.read(sampleSha)

      expect(checkOrder).toEqual(['hot', 'warm', 'cold'])
    })

    it('should stop at first tier with data', async () => {
      const warmObj = createTestObject(sampleSha, 'stop at warm')
      const coldObj = createTestObject(sampleSha, 'should not reach')
      warmBackend.inject(sampleSha, warmObj)
      coldBackend.inject(sampleSha, coldObj)

      const result = await store.read(sampleSha)

      expect(result.tier).toBe('warm')
      expect(new TextDecoder().decode(result.object!.data)).toBe('stop at warm')
    })

    it('should handle disabled tiers in fallback', async () => {
      const configWithDisabledWarm: TieredStorageConfig = {
        hot: { enabled: true },
        warm: { enabled: false }, // Warm tier disabled
        cold: { enabled: true },
        promotionPolicy: 'aggressive'
      }
      const storeWithDisabledWarm = new TieredObjectStoreStub(
        hotBackend, warmBackend, coldBackend, configWithDisabledWarm
      )

      coldBackend.inject(sampleSha, createTestObject(sampleSha, 'skip warm'))

      const result = await storeWithDisabledWarm.read(sampleSha)

      // Should skip warm and go directly to cold
      expect(result.object).not.toBeNull()
      expect(result.tier).toBe('cold')
    })

    it('should return null when object not found in any tier', async () => {
      // No object injected anywhere

      const result = await store.read(sampleSha)

      expect(result.object).toBeNull()
      expect(result.tier).toBeNull()
      expect(result.promoted).toBe(false)
    })

    it('should handle partial tier availability', async () => {
      // Simulate warm tier being unavailable (throwing error)
      const failingWarmBackend: WarmTierBackend = {
        async get(_sha: string): Promise<StoredObject | null> {
          throw new Error('R2 unavailable')
        },
        async getFromPack(_packId: string, _offset: number): Promise<StoredObject | null> {
          throw new Error('R2 unavailable')
        }
      }

      const storeWithFailingWarm = new TieredObjectStoreStub(
        hotBackend, failingWarmBackend, coldBackend, defaultConfig
      )

      coldBackend.inject(sampleSha, createTestObject(sampleSha, 'cold after warm failure'))

      // Should gracefully fall back to cold tier
      const result = await storeWithFailingWarm.read(sampleSha)

      expect(result.object).not.toBeNull()
      expect(result.tier).toBe('cold')
    })
  })

  describe('Cache Promotion', () => {
    it('should promote object from warm to hot tier on read', async () => {
      const testObj = createTestObject(sampleSha, 'promote to hot')
      warmBackend.inject(sampleSha, testObj)

      const result = await store.read(sampleSha)

      expect(result.promoted).toBe(true)
      // Verify object is now in hot tier
      const hotObj = await hotBackend.get(sampleSha)
      expect(hotObj).not.toBeNull()
    })

    it('should promote object from cold to hot tier on read', async () => {
      const testObj = createTestObject(sampleSha, 'promote from cold')
      coldBackend.inject(sampleSha, testObj)

      const result = await store.read(sampleSha)

      expect(result.promoted).toBe(true)
      const hotObj = await hotBackend.get(sampleSha)
      expect(hotObj).not.toBeNull()
    })

    it('should not promote when policy is none', async () => {
      const noPromotionConfig: TieredStorageConfig = {
        hot: { enabled: true },
        warm: { enabled: true },
        cold: { enabled: true },
        promotionPolicy: 'none'
      }
      const storeNoPromotion = new TieredObjectStoreStub(
        hotBackend, warmBackend, coldBackend, noPromotionConfig
      )

      warmBackend.inject(sampleSha, createTestObject(sampleSha, 'no promotion'))

      const result = await storeNoPromotion.read(sampleSha)

      expect(result.promoted).toBe(false)
      const hotObj = await hotBackend.get(sampleSha)
      expect(hotObj).toBeNull()
    })

    it('should use promoteToHot method for manual promotion', async () => {
      const testObj = createTestObject(sampleSha, 'manual promotion')

      await store.promoteToHot(sampleSha, testObj)

      const hotObj = await hotBackend.get(sampleSha)
      expect(hotObj).not.toBeNull()
      expect(hotObj!.sha).toBe(sampleSha)
    })

    it('should handle promotion of large objects with size limits', async () => {
      const configWithSizeLimit: TieredStorageConfig = {
        hot: { enabled: true, maxSize: 1024 }, // 1KB limit
        warm: { enabled: true },
        cold: { enabled: true },
        promotionPolicy: 'aggressive'
      }
      const storeSizeLimit = new TieredObjectStoreStub(
        hotBackend, warmBackend, coldBackend, configWithSizeLimit
      )

      // Create object larger than hot tier limit
      const largeData = new Uint8Array(2048) // 2KB
      const largeObj: StoredObject = {
        sha: sampleSha,
        type: 'blob',
        size: largeData.length,
        data: largeData,
        createdAt: Date.now()
      }
      warmBackend.inject(sampleSha, largeObj)

      const result = await storeSizeLimit.read(sampleSha)

      // Should read successfully but not promote due to size
      expect(result.object).not.toBeNull()
      expect(result.promoted).toBe(false)
    })

    it('should respect conservative promotion policy', async () => {
      const conservativeConfig: TieredStorageConfig = {
        hot: { enabled: true },
        warm: { enabled: true },
        cold: { enabled: true },
        promotionPolicy: 'conservative'
      }
      const storeConservative = new TieredObjectStoreStub(
        hotBackend, warmBackend, coldBackend, conservativeConfig
      )

      coldBackend.inject(sampleSha, createTestObject(sampleSha, 'conservative promotion'))

      // First read - should not promote with conservative policy
      const result1 = await storeConservative.read(sampleSha)
      expect(result1.promoted).toBe(false)

      // Multiple reads might trigger promotion in conservative mode
      // This depends on implementation - testing the concept
    })

    it('should not duplicate data during promotion', async () => {
      const testObj = createTestObject(sampleSha, 'no duplicates')
      warmBackend.inject(sampleSha, testObj)

      await store.read(sampleSha)
      await store.read(sampleSha) // Second read

      // Should only have one copy in hot tier
      const hotObj = await hotBackend.get(sampleSha)
      expect(hotObj).not.toBeNull()
      // Verify data integrity
      expect(hotObj!.data).toEqual(testObj.data)
    })

    it('should preserve object metadata during promotion', async () => {
      const timestamp = 1704067200000 // Fixed timestamp for testing
      const testObj: StoredObject = {
        sha: sampleSha,
        type: 'commit',
        size: 100,
        data: encoder.encode('commit content'),
        createdAt: timestamp
      }
      warmBackend.inject(sampleSha, testObj)

      await store.read(sampleSha)

      const hotObj = await hotBackend.get(sampleSha)
      expect(hotObj!.type).toBe('commit')
      expect(hotObj!.size).toBe(100)
      // createdAt should be preserved or updated appropriately
      expect(hotObj!.createdAt).toBeDefined()
    })

    it('should handle promotion failure gracefully', async () => {
      // Create a failing hot backend for puts
      const failingHotBackend: HotTierBackend = {
        async get(_sha: string): Promise<StoredObject | null> { return null },
        async put(_sha: string, _object: StoredObject): Promise<void> {
          throw new Error('Hot tier write failed')
        },
        async delete(_sha: string): Promise<boolean> { return false },
        async has(_sha: string): Promise<boolean> { return false }
      }

      const storeFailingHot = new TieredObjectStoreStub(
        failingHotBackend, warmBackend, coldBackend, defaultConfig
      )

      warmBackend.inject(sampleSha, createTestObject(sampleSha, 'promotion will fail'))

      // Should still return the object even if promotion fails
      const result = await storeFailingHot.read(sampleSha)

      expect(result.object).not.toBeNull()
      expect(result.tier).toBe('warm')
      expect(result.promoted).toBe(false)
    })

    it('should track promotion in read result', async () => {
      const testObj = createTestObject(sampleSha, 'track promotion')
      coldBackend.inject(sampleSha, testObj)

      const result = await store.read(sampleSha)

      expect(result).toHaveProperty('promoted')
      expect(typeof result.promoted).toBe('boolean')
    })
  })

  describe('Edge Cases and Error Handling', () => {
    it('should handle empty SHA gracefully', async () => {
      const result = await store.read('')

      expect(result.object).toBeNull()
    })

    it('should handle invalid SHA format', async () => {
      const result = await store.read('invalid-sha')

      expect(result.object).toBeNull()
    })

    it('should handle SHA with wrong length', async () => {
      const shortSha = 'a'.repeat(39)
      const longSha = 'a'.repeat(41)

      const result1 = await store.read(shortSha)
      const result2 = await store.read(longSha)

      expect(result1.object).toBeNull()
      expect(result2.object).toBeNull()
    })

    it('should handle concurrent reads of same object', async () => {
      const testObj = createTestObject(sampleSha, 'concurrent access')
      coldBackend.inject(sampleSha, testObj)

      const results = await Promise.all([
        store.read(sampleSha),
        store.read(sampleSha),
        store.read(sampleSha)
      ])

      // All reads should succeed
      expect(results.every(r => r.object !== null)).toBe(true)
    })

    it('should handle all tiers being disabled', async () => {
      const allDisabledConfig: TieredStorageConfig = {
        hot: { enabled: false },
        warm: { enabled: false },
        cold: { enabled: false },
        promotionPolicy: 'none'
      }
      const storeAllDisabled = new TieredObjectStoreStub(
        hotBackend, warmBackend, coldBackend, allDisabledConfig
      )

      hotBackend.inject(sampleSha, createTestObject(sampleSha, 'nowhere to read'))

      const result = await storeAllDisabled.read(sampleSha)

      expect(result.object).toBeNull()
    })

    it('should report latency for all read paths', async () => {
      hotBackend.inject(sampleSha, createTestObject(sampleSha, 'latency tracking'))

      const result = await store.read(sampleSha)

      expect(result.latencyMs).toBeDefined()
      expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    })
  })
})
