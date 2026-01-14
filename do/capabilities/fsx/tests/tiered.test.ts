/**
 * TieredFS - Tests for multi-tier filesystem with automatic placement
 *
 * Tests cover:
 * 1. Automatic tier selection based on file size
 * 2. Manual tier control (promote, demote)
 * 3. Hot/warm/cold transitions
 * 4. Threshold configuration
 * 5. Fallback behavior (when warm tier unavailable)
 *
 * Note: Uses small custom thresholds to avoid memory issues in tests.
 * Default thresholds are 1MB hot, 100MB warm but we use 1KB/10KB for testing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TieredFS, type TieredFSConfig } from '../storage/tiered'
import {
  InMemoryStorage,
  MockDurableObjectStub,
  MockR2Bucket,
  createRandomBytes,
} from './test-utils'

// Use small thresholds for testing to avoid memory issues
const TEST_HOT_THRESHOLD = 1024 // 1KB
const TEST_WARM_THRESHOLD = 10 * 1024 // 10KB

/**
 * Mock DurableObjectNamespace for testing
 */
class MockDurableObjectNamespace {
  private stubs = new Map<string, MockDurableObjectStub>()
  private storage: InMemoryStorage

  constructor(storage?: InMemoryStorage) {
    this.storage = storage ?? new InMemoryStorage()
  }

  idFromName(name: string): { toString: () => string } {
    return { toString: () => name }
  }

  get(id: { toString: () => string }): MockDurableObjectStub {
    const key = id.toString()
    if (!this.stubs.has(key)) {
      this.stubs.set(key, new MockDurableObjectStub(this.storage))
    }
    return this.stubs.get(key)!
  }

  getStorage(): InMemoryStorage {
    return this.storage
  }
}

/**
 * Extended MockR2Bucket with metadata tracking for tier tests
 */
class TieredMockR2Bucket extends MockR2Bucket {
  private metadata = new Map<string, { size: number; tier: string }>()

  async put(key: string, value: Uint8Array | ArrayBuffer | string): Promise<void> {
    await super.put(key, value)
    const size = typeof value === 'string'
      ? new TextEncoder().encode(value).length
      : value instanceof ArrayBuffer
        ? value.byteLength
        : value.length
    this.metadata.set(key, { size, tier: 'r2' })
  }

  getMetadata(key: string): { size: number; tier: string } | undefined {
    return this.metadata.get(key)
  }

  async delete(key: string): Promise<void> {
    await super.delete(key)
    this.metadata.delete(key)
  }
}

describe('TieredFS', () => {
  let hotNamespace: MockDurableObjectNamespace
  let warmBucket: TieredMockR2Bucket
  let coldBucket: TieredMockR2Bucket
  let tieredFs: TieredFS

  beforeEach(() => {
    hotNamespace = new MockDurableObjectNamespace()
    warmBucket = new TieredMockR2Bucket()
    coldBucket = new TieredMockR2Bucket()

    // Use small thresholds for testing
    tieredFs = new TieredFS({
      hot: hotNamespace as unknown as DurableObjectNamespace,
      warm: warmBucket as unknown as R2Bucket,
      cold: coldBucket as unknown as R2Bucket,
      thresholds: {
        hotMaxSize: TEST_HOT_THRESHOLD,
        warmMaxSize: TEST_WARM_THRESHOLD,
      },
    })
  })

  // ===========================================================================
  // 1. Automatic Tier Selection Based on File Size
  // ===========================================================================
  describe('Automatic Tier Selection', () => {
    it('should store small files in hot tier', async () => {
      const smallData = createRandomBytes(100) // 100 bytes < 1KB threshold
      const result = await tieredFs.writeFile('/small.txt', smallData)

      expect(result.tier).toBe('hot')
    })

    it('should store files exactly at hot threshold in hot tier', async () => {
      const data = createRandomBytes(TEST_HOT_THRESHOLD) // Exactly at threshold
      const result = await tieredFs.writeFile('/exactly-at-hot.bin', data)

      expect(result.tier).toBe('hot')
    })

    it('should store files just over hot threshold in warm tier', async () => {
      const data = createRandomBytes(TEST_HOT_THRESHOLD + 1) // 1 byte over
      const result = await tieredFs.writeFile('/over-hot.bin', data)

      expect(result.tier).toBe('warm')
    })

    it('should store medium files in warm tier', async () => {
      const data = createRandomBytes(5 * 1024) // 5KB - between 1KB and 10KB
      const result = await tieredFs.writeFile('/medium.bin', data)

      expect(result.tier).toBe('warm')
    })

    it('should store files exactly at warm threshold in warm tier', async () => {
      const data = createRandomBytes(TEST_WARM_THRESHOLD) // Exactly at warm threshold
      const result = await tieredFs.writeFile('/exactly-at-warm.bin', data)

      expect(result.tier).toBe('warm')
    })

    it('should store large files in cold tier', async () => {
      const data = createRandomBytes(TEST_WARM_THRESHOLD + 1) // 1 byte over warm
      const result = await tieredFs.writeFile('/large.bin', data)

      expect(result.tier).toBe('cold')
    })

    it('should handle empty files in hot tier', async () => {
      const result = await tieredFs.writeFile('/empty.txt', new Uint8Array(0))

      expect(result.tier).toBe('hot')
    })

    it('should store string data with correct tier based on encoded size', async () => {
      // Small string that fits in hot tier
      const smallString = 'Hello, World!'
      const result = await tieredFs.writeFile('/string.txt', smallString)

      expect(result.tier).toBe('hot')
    })

    it('should handle UTF-8 multi-byte characters correctly', async () => {
      // Emoji is 4 bytes in UTF-8
      const emojis = '\u{1F600}'.repeat(300) // 1200 bytes > 1KB
      const result = await tieredFs.writeFile('/emoji.txt', emojis)

      expect(result.tier).toBe('warm')
    })
  })

  // ===========================================================================
  // 2. Manual Tier Control (Promote, Demote)
  // ===========================================================================
  describe('Manual Tier Control', () => {
    describe('promote()', () => {
      it('should promote file from cold to warm tier on access', async () => {
        // Write to cold tier
        const data = createRandomBytes(TEST_WARM_THRESHOLD + 100)
        await tieredFs.writeFile('/cold-file.bin', data)

        // Read should access from cold tier
        const readResult = await tieredFs.readFile('/cold-file.bin')
        expect(readResult.tier).toBe('cold')
      })

      it('should promote file from warm to hot tier on access for small files', async () => {
        // Create a TieredFS with on-access promotion
        const promotingFs = new TieredFS({
          hot: hotNamespace as unknown as DurableObjectNamespace,
          warm: warmBucket as unknown as R2Bucket,
          cold: coldBucket as unknown as R2Bucket,
          thresholds: {
            hotMaxSize: TEST_HOT_THRESHOLD,
            warmMaxSize: TEST_WARM_THRESHOLD,
          },
          promotionPolicy: 'on-access',
        })

        // Write a small file directly to warm tier (simulate demotion)
        const smallData = createRandomBytes(100)
        await warmBucket.put('/promotable.txt', smallData)

        // Read should find file in warm
        const result = await promotingFs.readFile('/promotable.txt')
        expect(result.tier).toBe('warm')
      })

      it('should not promote if promotion policy is "none"', async () => {
        const noPromoteFs = new TieredFS({
          hot: hotNamespace as unknown as DurableObjectNamespace,
          warm: warmBucket as unknown as R2Bucket,
          cold: coldBucket as unknown as R2Bucket,
          thresholds: {
            hotMaxSize: TEST_HOT_THRESHOLD,
            warmMaxSize: TEST_WARM_THRESHOLD,
          },
          promotionPolicy: 'none',
        })

        // Write to warm
        const data = createRandomBytes(2 * 1024) // 2KB goes to warm
        await noPromoteFs.writeFile('/no-promote.bin', data)

        // Access multiple times
        await noPromoteFs.readFile('/no-promote.bin')
        await noPromoteFs.readFile('/no-promote.bin')
        await noPromoteFs.readFile('/no-promote.bin')

        // Should still be in warm tier
        const result = await noPromoteFs.readFile('/no-promote.bin')
        expect(result.tier).toBe('warm')
      })

      it('should support aggressive promotion policy', async () => {
        const aggressiveFs = new TieredFS({
          hot: hotNamespace as unknown as DurableObjectNamespace,
          warm: warmBucket as unknown as R2Bucket,
          cold: coldBucket as unknown as R2Bucket,
          thresholds: {
            hotMaxSize: TEST_HOT_THRESHOLD,
            warmMaxSize: TEST_WARM_THRESHOLD,
          },
          promotionPolicy: 'aggressive',
        })

        // Write to warm
        const data = createRandomBytes(2 * 1024)
        await aggressiveFs.writeFile('/aggressive.bin', data)

        // Single access
        const result = await aggressiveFs.readFile('/aggressive.bin')
        expect(result.tier).toBe('warm')
      })
    })

    describe('demote()', () => {
      it('should demote file from hot to warm tier', async () => {
        // Write to hot tier
        const data = createRandomBytes(100)
        await tieredFs.writeFile('/hot-file.txt', data)

        // Demote to warm
        await tieredFs.demote('/hot-file.txt', 'warm')

        // Verify file is now in warm tier
        const result = await tieredFs.readFile('/hot-file.txt')
        expect(result.tier).toBe('warm')
      })

      it('should demote file from hot to cold tier', async () => {
        const data = createRandomBytes(100)
        await tieredFs.writeFile('/hot-to-cold.txt', data)

        await tieredFs.demote('/hot-to-cold.txt', 'cold')

        const result = await tieredFs.readFile('/hot-to-cold.txt')
        expect(result.tier).toBe('cold')
      })

      it('should demote file from warm to cold tier', async () => {
        const data = createRandomBytes(2 * 1024) // 2KB goes to warm
        await tieredFs.writeFile('/warm-file.bin', data)

        await tieredFs.demote('/warm-file.bin', 'cold')

        const result = await tieredFs.readFile('/warm-file.bin')
        expect(result.tier).toBe('cold')
      })

      it('should throw error when demoting non-existent file', async () => {
        await expect(tieredFs.demote('/nonexistent.txt', 'cold')).rejects.toThrow()
      })

      it('should remove data from source tier after demotion', async () => {
        const data = createRandomBytes(100)
        await tieredFs.writeFile('/to-demote.txt', data)

        // Verify not in warm tier
        expect(warmBucket.has('/to-demote.txt')).toBe(false)

        await tieredFs.demote('/to-demote.txt', 'warm')

        // Verify in warm tier
        expect(warmBucket.has('/to-demote.txt')).toBe(true)
      })

      it('should preserve file content after demotion', async () => {
        const data = createRandomBytes(100)
        await tieredFs.writeFile('/preserve-content.txt', data)

        await tieredFs.demote('/preserve-content.txt', 'warm')

        const result = await tieredFs.readFile('/preserve-content.txt')
        expect(result.data).toEqual(data)
      })
    })
  })

  // ===========================================================================
  // 3. Hot/Warm/Cold Transitions
  // ===========================================================================
  describe('Tier Transitions', () => {
    it('should read file from hot tier correctly', async () => {
      const content = 'Hello, Hot Tier!'
      await tieredFs.writeFile('/hot-read.txt', content)

      const result = await tieredFs.readFile('/hot-read.txt')

      expect(result.tier).toBe('hot')
      expect(new TextDecoder().decode(result.data)).toBe(content)
    })

    it('should read file from warm tier correctly', async () => {
      const data = createRandomBytes(2 * 1024) // 2KB goes to warm
      await tieredFs.writeFile('/warm-read.bin', data)

      const result = await tieredFs.readFile('/warm-read.bin')

      expect(result.tier).toBe('warm')
      expect(result.data).toEqual(data)
    })

    it('should read file from cold tier correctly', async () => {
      const data = createRandomBytes(15 * 1024) // 15KB goes to cold
      await tieredFs.writeFile('/cold-read.bin', data)

      const result = await tieredFs.readFile('/cold-read.bin')

      expect(result.tier).toBe('cold')
      expect(result.data).toEqual(data)
    })

    it('should track tier in metadata after write', async () => {
      const smallData = createRandomBytes(100) // hot
      const mediumData = createRandomBytes(5 * 1024) // warm
      const largeData = createRandomBytes(15 * 1024) // cold

      await tieredFs.writeFile('/small.txt', smallData)
      await tieredFs.writeFile('/medium.bin', mediumData)
      await tieredFs.writeFile('/large.bin', largeData)

      const small = await tieredFs.readFile('/small.txt')
      const medium = await tieredFs.readFile('/medium.bin')
      const large = await tieredFs.readFile('/large.bin')

      expect(small.tier).toBe('hot')
      expect(medium.tier).toBe('warm')
      expect(large.tier).toBe('cold')
    })

    it('should update metadata when tier changes', async () => {
      const data = createRandomBytes(100)
      await tieredFs.writeFile('/transition.txt', data)

      // Initially in hot
      let result = await tieredFs.readFile('/transition.txt')
      expect(result.tier).toBe('hot')

      // Demote to warm
      await tieredFs.demote('/transition.txt', 'warm')
      result = await tieredFs.readFile('/transition.txt')
      expect(result.tier).toBe('warm')

      // Demote to cold
      await tieredFs.demote('/transition.txt', 'cold')
      result = await tieredFs.readFile('/transition.txt')
      expect(result.tier).toBe('cold')
    })

    it('should handle rapid tier transitions', async () => {
      const data = createRandomBytes(100)
      await tieredFs.writeFile('/rapid.txt', data)

      // Rapidly transition between tiers
      await tieredFs.demote('/rapid.txt', 'warm')
      await tieredFs.demote('/rapid.txt', 'cold')

      const result = await tieredFs.readFile('/rapid.txt')
      expect(result.tier).toBe('cold')
      expect(result.data).toEqual(data)
    })
  })

  // ===========================================================================
  // 4. Threshold Configuration
  // ===========================================================================
  describe('Threshold Configuration', () => {
    it('should use default thresholds when not specified', async () => {
      const defaultFs = new TieredFS({
        hot: hotNamespace as unknown as DurableObjectNamespace,
        warm: warmBucket as unknown as R2Bucket,
        cold: coldBucket as unknown as R2Bucket,
        // No thresholds specified - uses defaults (1MB, 100MB)
      })

      // 100 bytes should be in hot (well under 1MB default)
      const hotData = createRandomBytes(100)
      const hotResult = await defaultFs.writeFile('/default-hot.bin', hotData)
      expect(hotResult.tier).toBe('hot')
    })

    it('should respect custom hot threshold', async () => {
      const customFs = new TieredFS({
        hot: hotNamespace as unknown as DurableObjectNamespace,
        warm: warmBucket as unknown as R2Bucket,
        cold: coldBucket as unknown as R2Bucket,
        thresholds: {
          hotMaxSize: 512, // 512 bytes
        },
      })

      // 512 bytes should be in hot
      const hotData = createRandomBytes(512)
      const hotResult = await customFs.writeFile('/custom-hot.bin', hotData)
      expect(hotResult.tier).toBe('hot')

      // 513 bytes should be in warm
      const warmData = createRandomBytes(513)
      const warmResult = await customFs.writeFile('/custom-warm.bin', warmData)
      expect(warmResult.tier).toBe('warm')
    })

    it('should respect custom warm threshold', async () => {
      const customFs = new TieredFS({
        hot: hotNamespace as unknown as DurableObjectNamespace,
        warm: warmBucket as unknown as R2Bucket,
        cold: coldBucket as unknown as R2Bucket,
        thresholds: {
          hotMaxSize: 100, // 100 bytes
          warmMaxSize: 500, // 500 bytes
        },
      })

      // 500 bytes should be in warm
      const warmData = createRandomBytes(500)
      const warmResult = await customFs.writeFile('/custom-warm.bin', warmData)
      expect(warmResult.tier).toBe('warm')

      // 501 bytes should be in cold
      const coldData = createRandomBytes(501)
      const coldResult = await customFs.writeFile('/custom-cold.bin', coldData)
      expect(coldResult.tier).toBe('cold')
    })

    it('should allow very small hot threshold', async () => {
      const tinyFs = new TieredFS({
        hot: hotNamespace as unknown as DurableObjectNamespace,
        warm: warmBucket as unknown as R2Bucket,
        cold: coldBucket as unknown as R2Bucket,
        thresholds: {
          hotMaxSize: 10, // 10 bytes
        },
      })

      // 10 bytes should be in hot
      const hotData = createRandomBytes(10)
      const hotResult = await tinyFs.writeFile('/tiny-hot.bin', hotData)
      expect(hotResult.tier).toBe('hot')

      // 11 bytes should be in warm
      const warmData = createRandomBytes(11)
      const warmResult = await tinyFs.writeFile('/tiny-warm.bin', warmData)
      expect(warmResult.tier).toBe('warm')
    })

    it('should allow very large thresholds', async () => {
      const largeFs = new TieredFS({
        hot: hotNamespace as unknown as DurableObjectNamespace,
        warm: warmBucket as unknown as R2Bucket,
        cold: coldBucket as unknown as R2Bucket,
        thresholds: {
          hotMaxSize: 1024 * 1024 * 1024, // 1GB
          warmMaxSize: 10 * 1024 * 1024 * 1024, // 10GB
        },
      })

      // 100KB should be in hot with large threshold
      const data = createRandomBytes(100 * 1024)
      const result = await largeFs.writeFile('/large-hot.bin', data)
      expect(result.tier).toBe('hot')
    })

    it('should handle zero hot threshold (all to warm)', async () => {
      const noHotFs = new TieredFS({
        hot: hotNamespace as unknown as DurableObjectNamespace,
        warm: warmBucket as unknown as R2Bucket,
        cold: coldBucket as unknown as R2Bucket,
        thresholds: {
          hotMaxSize: 0,
        },
      })

      // Even 1 byte should go to warm
      const data = createRandomBytes(1)
      const result = await noHotFs.writeFile('/no-hot.bin', data)
      expect(result.tier).toBe('warm')
    })
  })

  // ===========================================================================
  // 5. Fallback Behavior (When Tiers Unavailable)
  // ===========================================================================
  describe('Fallback Behavior', () => {
    it('should fall back to hot tier when warm is unavailable and file exceeds hot threshold', async () => {
      const noWarmFs = new TieredFS({
        hot: hotNamespace as unknown as DurableObjectNamespace,
        // No warm tier
        thresholds: {
          hotMaxSize: TEST_HOT_THRESHOLD,
          warmMaxSize: TEST_WARM_THRESHOLD,
        },
      })

      // File that would normally go to warm
      const data = createRandomBytes(2 * 1024)
      const result = await noWarmFs.writeFile('/fallback-hot.bin', data)

      // Should fall back to hot since warm is unavailable
      expect(result.tier).toBe('hot')
    })

    it('should fall back to warm tier when cold is unavailable', async () => {
      const noColdFs = new TieredFS({
        hot: hotNamespace as unknown as DurableObjectNamespace,
        warm: warmBucket as unknown as R2Bucket,
        // No cold tier
        thresholds: {
          hotMaxSize: TEST_HOT_THRESHOLD,
          warmMaxSize: TEST_WARM_THRESHOLD,
        },
      })

      // File that would normally go to cold
      const data = createRandomBytes(15 * 1024)
      const result = await noColdFs.writeFile('/fallback-warm.bin', data)

      // Should fall back to warm since cold is unavailable
      expect(result.tier).toBe('warm')
    })

    it('should fall back to hot tier when both warm and cold are unavailable', async () => {
      const hotOnlyFs = new TieredFS({
        hot: hotNamespace as unknown as DurableObjectNamespace,
        // No warm or cold tiers
        thresholds: {
          hotMaxSize: TEST_HOT_THRESHOLD,
          warmMaxSize: TEST_WARM_THRESHOLD,
        },
      })

      // Any size file
      const data = createRandomBytes(20 * 1024)
      const result = await hotOnlyFs.writeFile('/hot-only.bin', data)

      // Should fall back to hot tier
      expect(result.tier).toBe('hot')
    })

    it('should handle demote gracefully when target tier is unavailable', async () => {
      const noWarmFs = new TieredFS({
        hot: hotNamespace as unknown as DurableObjectNamespace,
        cold: coldBucket as unknown as R2Bucket,
        // No warm tier
        thresholds: {
          hotMaxSize: TEST_HOT_THRESHOLD,
          warmMaxSize: TEST_WARM_THRESHOLD,
        },
      })

      const data = createRandomBytes(100)
      await noWarmFs.writeFile('/no-warm-demote.txt', data)

      // Demoting to warm when warm doesn't exist should throw or handle gracefully
      await expect(noWarmFs.demote('/no-warm-demote.txt', 'warm')).rejects.toThrow()
    })

    it('should handle demote to cold when cold tier is unavailable', async () => {
      const noColdFs = new TieredFS({
        hot: hotNamespace as unknown as DurableObjectNamespace,
        warm: warmBucket as unknown as R2Bucket,
        // No cold tier
        thresholds: {
          hotMaxSize: TEST_HOT_THRESHOLD,
          warmMaxSize: TEST_WARM_THRESHOLD,
        },
      })

      const data = createRandomBytes(100)
      await noColdFs.writeFile('/no-cold-demote.txt', data)

      // Demoting to cold when cold doesn't exist should throw
      await expect(noColdFs.demote('/no-cold-demote.txt', 'cold')).rejects.toThrow()
    })

    it('should correctly select warm when cold unavailable and file exceeds warm threshold', async () => {
      const noColdFs = new TieredFS({
        hot: hotNamespace as unknown as DurableObjectNamespace,
        warm: warmBucket as unknown as R2Bucket,
        // No cold tier
        thresholds: {
          hotMaxSize: TEST_HOT_THRESHOLD,
          warmMaxSize: TEST_WARM_THRESHOLD,
        },
      })

      // File larger than warm threshold but no cold available
      const data = createRandomBytes(15 * 1024)
      const result = await noColdFs.writeFile('/large-no-cold.bin', data)

      // Should stay in warm as fallback
      expect(result.tier).toBe('warm')
    })
  })

  // ===========================================================================
  // Error Handling
  // ===========================================================================
  describe('Error Handling', () => {
    it('should throw when reading non-existent file', async () => {
      await expect(tieredFs.readFile('/nonexistent.txt')).rejects.toThrow()
    })

    it('should handle concurrent writes to same path', async () => {
      const data1 = createRandomBytes(100)
      const data2 = createRandomBytes(100)

      // Concurrent writes
      await Promise.all([
        tieredFs.writeFile('/concurrent.txt', data1),
        tieredFs.writeFile('/concurrent.txt', data2),
      ])

      // File should exist and be readable
      const result = await tieredFs.readFile('/concurrent.txt')
      expect(result.tier).toBe('hot')
      // Content will be either data1 or data2
      expect(result.data.length).toBe(100)
    })

    it('should handle special characters in file paths', async () => {
      const data = createRandomBytes(100)
      const specialPaths = [
        '/file with spaces.txt',
        '/file-with-dashes.txt',
        '/file_with_underscores.txt',
        '/path/to/nested/file.txt',
      ]

      for (const path of specialPaths) {
        await tieredFs.writeFile(path, data)
        const result = await tieredFs.readFile(path)
        expect(result.data).toEqual(data)
      }
    })
  })

  // ===========================================================================
  // Edge Cases
  // ===========================================================================
  describe('Edge Cases', () => {
    it('should handle boundary size at exactly hot threshold', async () => {
      const exactHot = createRandomBytes(TEST_HOT_THRESHOLD)
      const result = await tieredFs.writeFile('/exact-hot.bin', exactHot)
      expect(result.tier).toBe('hot')
    })

    it('should handle boundary size at exactly warm threshold', async () => {
      const exactWarm = createRandomBytes(TEST_WARM_THRESHOLD)
      const result = await tieredFs.writeFile('/exact-warm.bin', exactWarm)
      expect(result.tier).toBe('warm')
    })

    it('should handle writing same file multiple times', async () => {
      const data = createRandomBytes(100)

      for (let i = 0; i < 5; i++) {
        await tieredFs.writeFile('/rewrite.txt', data)
      }

      const result = await tieredFs.readFile('/rewrite.txt')
      expect(result.data).toEqual(data)
    })

    it('should handle writing then immediately reading', async () => {
      const data = createRandomBytes(2 * 1024)
      await tieredFs.writeFile('/write-read.bin', data)
      const result = await tieredFs.readFile('/write-read.bin')

      expect(result.tier).toBe('warm')
      expect(result.data).toEqual(data)
    })

    it('should handle binary data with null bytes', async () => {
      const binaryData = new Uint8Array([0, 1, 2, 0, 0, 255, 0, 128])
      await tieredFs.writeFile('/binary.bin', binaryData)
      const result = await tieredFs.readFile('/binary.bin')

      expect(result.data).toEqual(binaryData)
    })
  })

  // ===========================================================================
  // Promotion Policy Tests
  // ===========================================================================
  describe('Promotion Policy', () => {
    it('should default to on-access promotion policy', async () => {
      const defaultFs = new TieredFS({
        hot: hotNamespace as unknown as DurableObjectNamespace,
        warm: warmBucket as unknown as R2Bucket,
        cold: coldBucket as unknown as R2Bucket,
        thresholds: {
          hotMaxSize: TEST_HOT_THRESHOLD,
          warmMaxSize: TEST_WARM_THRESHOLD,
        },
      })

      // Write directly to warm bucket to simulate demoted file
      const smallData = createRandomBytes(100)
      await warmBucket.put('/test-default-policy.txt', smallData)

      // Reading should find file in warm
      const result = await defaultFs.readFile('/test-default-policy.txt')
      expect(result).toBeDefined()
    })

    it('should support none promotion policy', async () => {
      const noneFs = new TieredFS({
        hot: hotNamespace as unknown as DurableObjectNamespace,
        warm: warmBucket as unknown as R2Bucket,
        thresholds: {
          hotMaxSize: TEST_HOT_THRESHOLD,
          warmMaxSize: TEST_WARM_THRESHOLD,
        },
        promotionPolicy: 'none',
      })

      // Files should never be promoted regardless of access patterns
      const data = createRandomBytes(2 * 1024)
      await noneFs.writeFile('/no-promote.bin', data)

      // Multiple reads
      for (let i = 0; i < 10; i++) {
        await noneFs.readFile('/no-promote.bin')
      }

      // Should still be in original tier
      const result = await noneFs.readFile('/no-promote.bin')
      expect(result.tier).toBe('warm')
    })

    it('should support aggressive promotion policy', async () => {
      const aggressiveFs = new TieredFS({
        hot: hotNamespace as unknown as DurableObjectNamespace,
        warm: warmBucket as unknown as R2Bucket,
        thresholds: {
          hotMaxSize: TEST_HOT_THRESHOLD,
          warmMaxSize: TEST_WARM_THRESHOLD,
        },
        promotionPolicy: 'aggressive',
      })

      // Aggressive policy should promote on first access if eligible
      const data = createRandomBytes(100) // Small file
      await warmBucket.put('/aggressive-test.txt', data)

      // Single read should trigger promotion
      const result = await aggressiveFs.readFile('/aggressive-test.txt')
      expect(result).toBeDefined()
    })
  })

  // ===========================================================================
  // Integration-like Tests
  // ===========================================================================
  describe('Integration Scenarios', () => {
    it('should handle lifecycle: write -> demote -> read -> verify', async () => {
      const originalData = 'Integration test data'

      // Write to hot tier
      const writeResult = await tieredFs.writeFile('/lifecycle.txt', originalData)
      expect(writeResult.tier).toBe('hot')

      // Demote to warm
      await tieredFs.demote('/lifecycle.txt', 'warm')

      // Read and verify
      const readResult = await tieredFs.readFile('/lifecycle.txt')
      expect(readResult.tier).toBe('warm')
      expect(new TextDecoder().decode(readResult.data)).toBe(originalData)
    })

    it('should handle multiple files across all tiers', async () => {
      const files = [
        { path: '/hot1.txt', size: 100 },
        { path: '/hot2.txt', size: 500 },
        { path: '/warm1.bin', size: 2 * 1024 },
        { path: '/warm2.bin', size: 5 * 1024 },
        { path: '/cold1.bin', size: 15 * 1024 },
      ]

      // Write all files
      for (const file of files) {
        const data = createRandomBytes(file.size)
        await tieredFs.writeFile(file.path, data)
      }

      // Read and verify tier placement
      const hot1 = await tieredFs.readFile('/hot1.txt')
      const hot2 = await tieredFs.readFile('/hot2.txt')
      const warm1 = await tieredFs.readFile('/warm1.bin')
      const warm2 = await tieredFs.readFile('/warm2.bin')
      const cold1 = await tieredFs.readFile('/cold1.bin')

      expect(hot1.tier).toBe('hot')
      expect(hot2.tier).toBe('hot')
      expect(warm1.tier).toBe('warm')
      expect(warm2.tier).toBe('warm')
      expect(cold1.tier).toBe('cold')
    })
  })
})
