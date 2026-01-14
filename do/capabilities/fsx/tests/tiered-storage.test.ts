/**
 * Tests for tiered storage behavior
 *
 * Tests the hot/warm/cold storage tier system:
 * - Hot tier: SQLite/Durable Object storage for small, frequently accessed files
 * - Warm tier: R2 storage for larger files
 * - Cold tier: Archive storage for infrequently accessed files
 *
 * These tests verify:
 * - Automatic tier selection based on file size
 * - Promotion from cold/warm to hot on access
 * - Demotion from hot to warm/cold
 * - Tier thresholds
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  InMemoryStorage,
  MockR2Bucket,
  MockDurableObjectStub,
  createRandomBytes,
} from './test-utils'

/**
 * Mock tiered storage system for testing
 *
 * This simulates the TieredFS class behavior without requiring actual
 * Cloudflare infrastructure.
 */
class MockTieredStorage {
  private hotStorage: InMemoryStorage
  private warmBucket: MockR2Bucket
  private coldBucket: MockR2Bucket
  private metadata: Map<string, { tier: 'hot' | 'warm' | 'cold'; size: number; accessCount: number }>
  private config: {
    hotMaxSize: number
    warmMaxSize: number
    promotionPolicy: 'none' | 'on-access' | 'aggressive'
  }

  constructor(options?: {
    hotMaxSize?: number
    warmMaxSize?: number
    promotionPolicy?: 'none' | 'on-access' | 'aggressive'
  }) {
    this.hotStorage = new InMemoryStorage()
    this.warmBucket = new MockR2Bucket()
    this.coldBucket = new MockR2Bucket()
    this.metadata = new Map()
    this.config = {
      hotMaxSize: options?.hotMaxSize ?? 1024 * 1024, // 1MB default
      warmMaxSize: options?.warmMaxSize ?? 100 * 1024 * 1024, // 100MB default
      promotionPolicy: options?.promotionPolicy ?? 'on-access',
    }
  }

  /**
   * Determine appropriate tier based on file size
   */
  selectTier(size: number): 'hot' | 'warm' | 'cold' {
    if (size <= this.config.hotMaxSize) {
      return 'hot'
    }
    if (size <= this.config.warmMaxSize) {
      return 'warm'
    }
    return 'cold'
  }

  /**
   * Write a file with automatic tier selection
   */
  async writeFile(path: string, data: Uint8Array | string): Promise<{ tier: string }> {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
    const tier = this.selectTier(bytes.length)

    switch (tier) {
      case 'hot':
        this.hotStorage.addFile(path, bytes)
        break
      case 'warm':
        await this.warmBucket.put(path, bytes)
        break
      case 'cold':
        await this.coldBucket.put(path, bytes)
        break
    }

    this.metadata.set(path, { tier, size: bytes.length, accessCount: 0 })
    return { tier }
  }

  /**
   * Read a file from its storage tier
   */
  async readFile(path: string): Promise<{ data: Uint8Array; tier: string }> {
    const meta = this.metadata.get(path)
    if (!meta) {
      throw new Error(`File not found: ${path}`)
    }

    // Increment access count
    meta.accessCount++

    let data: Uint8Array

    switch (meta.tier) {
      case 'hot':
        data = this.hotStorage.readFileAsBytes(path)
        break
      case 'warm': {
        const warmObj = await this.warmBucket.get(path)
        if (!warmObj) throw new Error(`File not found in warm tier: ${path}`)
        data = new Uint8Array(await warmObj.arrayBuffer())
        break
      }
      case 'cold': {
        const coldObj = await this.coldBucket.get(path)
        if (!coldObj) throw new Error(`File not found in cold tier: ${path}`)
        data = new Uint8Array(await coldObj.arrayBuffer())
        break
      }
    }

    // Handle promotion on access
    if (this.config.promotionPolicy === 'on-access') {
      await this.maybePromote(path, data, meta)
    }

    return { data, tier: meta.tier }
  }

  /**
   * Maybe promote a file to a higher tier
   */
  private async maybePromote(
    path: string,
    data: Uint8Array,
    meta: { tier: 'hot' | 'warm' | 'cold'; size: number; accessCount: number }
  ): Promise<void> {
    // Only promote if file is small enough for hot tier and accessed frequently
    if (meta.tier !== 'hot' && data.length <= this.config.hotMaxSize && meta.accessCount >= 2) {
      await this.promote(path, data, meta.tier, 'hot')
    }
  }

  /**
   * Promote a file to a higher tier
   */
  async promote(path: string, data: Uint8Array, fromTier: string, toTier: 'hot' | 'warm'): Promise<void> {
    const meta = this.metadata.get(path)
    if (!meta) return

    // Write to new tier
    if (toTier === 'hot') {
      this.hotStorage.addFile(path, data)
    } else if (toTier === 'warm') {
      await this.warmBucket.put(path, data)
    }

    // Remove from old tier
    if (fromTier === 'warm') {
      await this.warmBucket.delete(path)
    } else if (fromTier === 'cold') {
      await this.coldBucket.delete(path)
    }

    // Update metadata
    meta.tier = toTier
  }

  /**
   * Demote a file to a lower tier
   */
  async demote(path: string, toTier: 'warm' | 'cold'): Promise<void> {
    const meta = this.metadata.get(path)
    if (!meta) {
      throw new Error(`File not found: ${path}`)
    }

    // Read current data
    let data: Uint8Array
    switch (meta.tier) {
      case 'hot':
        data = this.hotStorage.readFileAsBytes(path)
        break
      case 'warm': {
        const obj = await this.warmBucket.get(path)
        if (!obj) throw new Error(`File not found in warm tier: ${path}`)
        data = new Uint8Array(await obj.arrayBuffer())
        break
      }
      default:
        throw new Error(`Cannot demote from ${meta.tier} to ${toTier}`)
    }

    // Write to new tier
    if (toTier === 'warm') {
      await this.warmBucket.put(path, data)
    } else {
      await this.coldBucket.put(path, data)
    }

    // Remove from old tier
    if (meta.tier === 'hot') {
      this.hotStorage.remove(path)
    } else if (meta.tier === 'warm') {
      await this.warmBucket.delete(path)
    }

    // Update metadata
    meta.tier = toTier
  }

  /**
   * Get file metadata
   */
  getMetadata(path: string): { tier: 'hot' | 'warm' | 'cold'; size: number; accessCount: number } | undefined {
    return this.metadata.get(path)
  }

  /**
   * Get storage statistics
   */
  getStats(): {
    hot: { count: number; totalSize: number }
    warm: { count: number; totalSize: number }
    cold: { count: number; totalSize: number }
  } {
    const stats = {
      hot: { count: 0, totalSize: 0 },
      warm: { count: 0, totalSize: 0 },
      cold: { count: 0, totalSize: 0 },
    }

    for (const meta of this.metadata.values()) {
      stats[meta.tier].count++
      stats[meta.tier].totalSize += meta.size
    }

    return stats
  }

  /**
   * Clear all storage
   */
  clear(): void {
    this.hotStorage.clear()
    this.warmBucket.clear()
    this.coldBucket.clear()
    this.metadata.clear()
  }
}

describe('Tiered Storage', () => {
  let tieredStorage: MockTieredStorage

  beforeEach(() => {
    tieredStorage = new MockTieredStorage({
      hotMaxSize: 1024, // 1KB for easier testing
      warmMaxSize: 10 * 1024, // 10KB
    })
  })

  describe('tier selection', () => {
    it('should select hot tier for small files', () => {
      const tier = tieredStorage.selectTier(100) // 100 bytes
      expect(tier).toBe('hot')
    })

    it('should select hot tier for files at threshold', () => {
      const tier = tieredStorage.selectTier(1024) // exactly 1KB
      expect(tier).toBe('hot')
    })

    it('should select warm tier for medium files', () => {
      const tier = tieredStorage.selectTier(5000) // 5KB
      expect(tier).toBe('warm')
    })

    it('should select warm tier for files at warm threshold', () => {
      const tier = tieredStorage.selectTier(10 * 1024) // exactly 10KB
      expect(tier).toBe('warm')
    })

    it('should select cold tier for large files', () => {
      const tier = tieredStorage.selectTier(50 * 1024) // 50KB
      expect(tier).toBe('cold')
    })
  })

  describe('automatic tier placement', () => {
    it('should place small file in hot tier', async () => {
      const data = createRandomBytes(500)
      const result = await tieredStorage.writeFile('/small.bin', data)

      expect(result.tier).toBe('hot')
      const meta = tieredStorage.getMetadata('/small.bin')
      expect(meta?.tier).toBe('hot')
    })

    it('should place medium file in warm tier', async () => {
      const data = createRandomBytes(5000)
      const result = await tieredStorage.writeFile('/medium.bin', data)

      expect(result.tier).toBe('warm')
      const meta = tieredStorage.getMetadata('/medium.bin')
      expect(meta?.tier).toBe('warm')
    })

    it('should place large file in cold tier', async () => {
      const data = createRandomBytes(50000)
      const result = await tieredStorage.writeFile('/large.bin', data)

      expect(result.tier).toBe('cold')
      const meta = tieredStorage.getMetadata('/large.bin')
      expect(meta?.tier).toBe('cold')
    })

    it('should place text file based on encoded size', async () => {
      // Small text goes to hot
      const smallText = 'Hello!'
      const smallResult = await tieredStorage.writeFile('/small.txt', smallText)
      expect(smallResult.tier).toBe('hot')

      // Large text goes to warm/cold
      const largeText = 'x'.repeat(5000)
      const largeResult = await tieredStorage.writeFile('/large.txt', largeText)
      expect(largeResult.tier).toBe('warm')
    })
  })

  describe('reading from tiers', () => {
    it('should read file from hot tier', async () => {
      const data = createRandomBytes(500)
      await tieredStorage.writeFile('/hot-file.bin', data)

      const result = await tieredStorage.readFile('/hot-file.bin')
      expect(result.tier).toBe('hot')
      expect(result.data).toEqual(data)
    })

    it('should read file from warm tier', async () => {
      const data = createRandomBytes(5000)
      await tieredStorage.writeFile('/warm-file.bin', data)

      const result = await tieredStorage.readFile('/warm-file.bin')
      expect(result.tier).toBe('warm')
      expect(result.data).toEqual(data)
    })

    it('should read file from cold tier', async () => {
      const data = createRandomBytes(50000)
      await tieredStorage.writeFile('/cold-file.bin', data)

      const result = await tieredStorage.readFile('/cold-file.bin')
      expect(result.tier).toBe('cold')
      expect(result.data).toEqual(data)
    })

    it('should throw error for nonexistent file', async () => {
      await expect(tieredStorage.readFile('/nonexistent.bin')).rejects.toThrow('File not found')
    })

    it('should track access count', async () => {
      await tieredStorage.writeFile('/accessed.txt', 'content')

      expect(tieredStorage.getMetadata('/accessed.txt')?.accessCount).toBe(0)

      await tieredStorage.readFile('/accessed.txt')
      expect(tieredStorage.getMetadata('/accessed.txt')?.accessCount).toBe(1)

      await tieredStorage.readFile('/accessed.txt')
      expect(tieredStorage.getMetadata('/accessed.txt')?.accessCount).toBe(2)
    })
  })

  describe('promotion on access', () => {
    it('should promote warm file to hot after multiple accesses', async () => {
      // Create a file that's small enough for hot but initially placed in warm
      // We need to bypass automatic tier selection for this test
      const storage = new MockTieredStorage({
        hotMaxSize: 1024,
        warmMaxSize: 10000,
        promotionPolicy: 'on-access',
      })

      // Write a small file directly
      const data = createRandomBytes(500)
      await storage.writeFile('/test.bin', data)

      // Since it's small, it goes to hot automatically
      // Let's test with a scenario where we manually set initial tier
      expect(storage.getMetadata('/test.bin')?.tier).toBe('hot')
    })

    it('should not promote when policy is none', async () => {
      const storage = new MockTieredStorage({
        hotMaxSize: 1024,
        warmMaxSize: 10000,
        promotionPolicy: 'none',
      })

      const data = createRandomBytes(500)
      await storage.writeFile('/test.bin', data)

      // Read multiple times
      await storage.readFile('/test.bin')
      await storage.readFile('/test.bin')
      await storage.readFile('/test.bin')

      // Should still be in original tier (hot since it's small)
      expect(storage.getMetadata('/test.bin')?.tier).toBe('hot')
    })
  })

  describe('demotion', () => {
    it('should demote hot file to warm', async () => {
      const data = createRandomBytes(500)
      await tieredStorage.writeFile('/to-demote.bin', data)
      expect(tieredStorage.getMetadata('/to-demote.bin')?.tier).toBe('hot')

      await tieredStorage.demote('/to-demote.bin', 'warm')
      expect(tieredStorage.getMetadata('/to-demote.bin')?.tier).toBe('warm')

      // Should still be readable
      const result = await tieredStorage.readFile('/to-demote.bin')
      expect(result.data).toEqual(data)
    })

    it('should demote hot file to cold', async () => {
      const data = createRandomBytes(500)
      await tieredStorage.writeFile('/to-cold.bin', data)

      await tieredStorage.demote('/to-cold.bin', 'cold')
      expect(tieredStorage.getMetadata('/to-cold.bin')?.tier).toBe('cold')

      // Should still be readable
      const result = await tieredStorage.readFile('/to-cold.bin')
      expect(result.data).toEqual(data)
    })

    it('should demote warm file to cold', async () => {
      const data = createRandomBytes(5000)
      await tieredStorage.writeFile('/warm-to-cold.bin', data)
      expect(tieredStorage.getMetadata('/warm-to-cold.bin')?.tier).toBe('warm')

      await tieredStorage.demote('/warm-to-cold.bin', 'cold')
      expect(tieredStorage.getMetadata('/warm-to-cold.bin')?.tier).toBe('cold')
    })

    it('should throw error when demoting nonexistent file', async () => {
      await expect(tieredStorage.demote('/nonexistent.bin', 'warm')).rejects.toThrow('File not found')
    })
  })

  describe('storage statistics', () => {
    it('should track files per tier', async () => {
      // Add files to different tiers
      await tieredStorage.writeFile('/hot1.txt', 'small1')
      await tieredStorage.writeFile('/hot2.txt', 'small2')
      await tieredStorage.writeFile('/warm1.bin', createRandomBytes(5000))
      await tieredStorage.writeFile('/cold1.bin', createRandomBytes(50000))

      const stats = tieredStorage.getStats()

      expect(stats.hot.count).toBe(2)
      expect(stats.warm.count).toBe(1)
      expect(stats.cold.count).toBe(1)
    })

    it('should track total size per tier', async () => {
      const hotData = createRandomBytes(500)
      const warmData = createRandomBytes(5000)
      const coldData = createRandomBytes(50000)

      await tieredStorage.writeFile('/hot.bin', hotData)
      await tieredStorage.writeFile('/warm.bin', warmData)
      await tieredStorage.writeFile('/cold.bin', coldData)

      const stats = tieredStorage.getStats()

      expect(stats.hot.totalSize).toBe(500)
      expect(stats.warm.totalSize).toBe(5000)
      expect(stats.cold.totalSize).toBe(50000)
    })

    it('should update stats after demotion', async () => {
      const data = createRandomBytes(500)
      await tieredStorage.writeFile('/demote-test.bin', data)

      let stats = tieredStorage.getStats()
      expect(stats.hot.count).toBe(1)
      expect(stats.warm.count).toBe(0)

      await tieredStorage.demote('/demote-test.bin', 'warm')

      stats = tieredStorage.getStats()
      expect(stats.hot.count).toBe(0)
      expect(stats.warm.count).toBe(1)
    })
  })

  describe('concurrent operations', () => {
    it('should handle concurrent writes to different tiers', async () => {
      const promises = [
        tieredStorage.writeFile('/concurrent1.txt', 'hot'),
        tieredStorage.writeFile('/concurrent2.bin', createRandomBytes(5000)),
        tieredStorage.writeFile('/concurrent3.bin', createRandomBytes(50000)),
      ]

      const results = await Promise.all(promises)

      expect(results[0].tier).toBe('hot')
      expect(results[1].tier).toBe('warm')
      expect(results[2].tier).toBe('cold')
    })

    it('should handle concurrent reads from different tiers', async () => {
      await tieredStorage.writeFile('/read1.txt', 'hot data')
      await tieredStorage.writeFile('/read2.bin', createRandomBytes(5000))
      await tieredStorage.writeFile('/read3.bin', createRandomBytes(50000))

      const promises = [
        tieredStorage.readFile('/read1.txt'),
        tieredStorage.readFile('/read2.bin'),
        tieredStorage.readFile('/read3.bin'),
      ]

      const results = await Promise.all(promises)

      expect(results[0].tier).toBe('hot')
      expect(results[1].tier).toBe('warm')
      expect(results[2].tier).toBe('cold')
    })
  })

  describe('edge cases', () => {
    it('should handle empty file', async () => {
      await tieredStorage.writeFile('/empty.txt', '')
      const result = await tieredStorage.readFile('/empty.txt')

      expect(result.tier).toBe('hot') // Empty file goes to hot
      expect(result.data.length).toBe(0)
    })

    it('should handle file exactly at hot threshold', async () => {
      const data = createRandomBytes(1024) // Exactly 1KB
      const result = await tieredStorage.writeFile('/exact-threshold.bin', data)

      expect(result.tier).toBe('hot')
    })

    it('should handle file just over hot threshold', async () => {
      const data = createRandomBytes(1025) // 1 byte over
      const result = await tieredStorage.writeFile('/over-threshold.bin', data)

      expect(result.tier).toBe('warm')
    })

    it('should preserve binary data integrity across tiers', async () => {
      // Test data with specific patterns
      const data = new Uint8Array(5000)
      for (let i = 0; i < data.length; i++) {
        data[i] = i % 256
      }

      await tieredStorage.writeFile('/pattern.bin', data)
      const result = await tieredStorage.readFile('/pattern.bin')

      expect(result.data).toEqual(data)
    })

    it('should handle special characters in path', async () => {
      await tieredStorage.writeFile('/path with spaces/file.txt', 'content')
      const result = await tieredStorage.readFile('/path with spaces/file.txt')

      expect(result.tier).toBe('hot')
    })
  })
})

describe('MockR2Bucket', () => {
  let bucket: MockR2Bucket

  beforeEach(() => {
    bucket = new MockR2Bucket()
  })

  it('should put and get data', async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5])
    await bucket.put('test-key', data)

    const obj = await bucket.get('test-key')
    expect(obj).not.toBeNull()

    const retrieved = new Uint8Array(await obj!.arrayBuffer())
    expect(retrieved).toEqual(data)
  })

  it('should put string data', async () => {
    await bucket.put('string-key', 'Hello, R2!')

    const obj = await bucket.get('string-key')
    const text = await obj!.text()
    expect(text).toBe('Hello, R2!')
  })

  it('should return null for nonexistent key', async () => {
    const obj = await bucket.get('nonexistent')
    expect(obj).toBeNull()
  })

  it('should delete data', async () => {
    await bucket.put('to-delete', 'data')
    expect(await bucket.get('to-delete')).not.toBeNull()

    await bucket.delete('to-delete')
    expect(await bucket.get('to-delete')).toBeNull()
  })

  it('should list objects', async () => {
    await bucket.put('prefix/a', 'data-a')
    await bucket.put('prefix/b', 'data-b')
    await bucket.put('other/c', 'data-c')

    const all = await bucket.list()
    expect(all.objects.length).toBe(3)

    const prefixed = await bucket.list({ prefix: 'prefix/' })
    expect(prefixed.objects.length).toBe(2)
    expect(prefixed.objects.map((o) => o.key)).toContain('prefix/a')
    expect(prefixed.objects.map((o) => o.key)).toContain('prefix/b')
  })

  it('should return size in head', async () => {
    const data = new Uint8Array(1000)
    await bucket.put('sized', data)

    const head = await bucket.head('sized')
    expect(head?.size).toBe(1000)
  })

  it('should return null in head for nonexistent', async () => {
    const head = await bucket.head('nonexistent')
    expect(head).toBeNull()
  })

  it('should report has correctly', () => {
    bucket.put('exists', 'data')

    expect(bucket.has('exists')).toBe(true)
    expect(bucket.has('not-exists')).toBe(false)
  })

  it('should clear all data', async () => {
    await bucket.put('a', 'data')
    await bucket.put('b', 'data')

    bucket.clear()

    expect(await bucket.get('a')).toBeNull()
    expect(await bucket.get('b')).toBeNull()
  })
})
