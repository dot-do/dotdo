/**
 * Tiered Storage Tests (RED Phase - TDD)
 *
 * Tests for the R2 tiered storage system that provides:
 * - Hot tier: In-memory + SQLite for fast access
 * - Warm tier: R2 storage for infrequently accessed data
 * - Cold tier: R2 archive for rarely accessed data
 * - Automatic promotion/demotion based on access patterns
 *
 * RED PHASE: All tests should FAIL initially.
 * GREEN PHASE: Implement TieredStorageManager to make tests pass.
 * REFACTOR: Optimize implementation.
 *
 * @module objects/persistence/tests/tiered-storage.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type {
  StorageTier,
  DataLocation,
  TieredStorageConfig,
  TierPromotionResult,
  TierDemotionResult,
} from '../types'

// Will be implemented in GREEN phase
// import { TieredStorageManager } from '../tiered-storage-manager'

// ============================================================================
// MOCK TYPES FOR TESTING
// ============================================================================

interface MockStorage {
  data: Map<string, unknown>
  sql: {
    exec(query: string, ...params: unknown[]): {
      toArray(): unknown[]
      changes?: number
    }
  }
}

interface MockR2Object {
  key: string
  data: Uint8Array
  metadata?: Record<string, string>
  storageClass?: string
}

interface MockR2Bucket {
  objects: Map<string, MockR2Object>
  put(key: string, data: ArrayBuffer | Uint8Array | string, options?: {
    customMetadata?: Record<string, string>
    storageClass?: string
  }): Promise<void>
  get(key: string): Promise<{ body: ReadableStream; customMetadata?: Record<string, string> } | null>
  delete(key: string | string[]): Promise<void>
  list(options?: { prefix?: string }): Promise<{ objects: { key: string }[] }>
}

interface MockEnv {
  R2_WARM?: MockR2Bucket
  R2_COLD?: MockR2Bucket
}

// ============================================================================
// TEST HELPERS
// ============================================================================

function createMockStorage(): MockStorage {
  const hotData = new Map<string, { data: unknown; accessCount: number; lastAccessAt: number }>()

  return {
    data: hotData,
    sql: {
      exec(query: string, ...params: unknown[]) {
        const upperQuery = query.toUpperCase()

        if (upperQuery.includes('INSERT INTO HOT_TIER')) {
          const key = params[0] as string
          hotData.set(key, {
            data: params[1],
            accessCount: 1,
            lastAccessAt: Date.now(),
          })
          return { toArray: () => [] }
        }

        if (upperQuery.includes('SELECT') && upperQuery.includes('FROM HOT_TIER')) {
          const key = params[0] as string
          const item = hotData.get(key)
          if (item) {
            item.accessCount++
            item.lastAccessAt = Date.now()
            return { toArray: () => [item] }
          }
          return { toArray: () => [] }
        }

        if (upperQuery.includes('DELETE FROM HOT_TIER')) {
          const key = params[0] as string
          hotData.delete(key)
          return { toArray: () => [], changes: 1 }
        }

        if (upperQuery.includes('COUNT(*)')) {
          return { toArray: () => [{ count: hotData.size }] }
        }

        return { toArray: () => [] }
      }
    }
  }
}

function createMockR2Bucket(): MockR2Bucket {
  const objects = new Map<string, MockR2Object>()

  return {
    objects,
    async put(key: string, data: ArrayBuffer | Uint8Array | string, options?: {
      customMetadata?: Record<string, string>
      storageClass?: string
    }): Promise<void> {
      const bytes = typeof data === 'string'
        ? new TextEncoder().encode(data)
        : data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : data
      objects.set(key, {
        key,
        data: bytes,
        metadata: options?.customMetadata,
        storageClass: options?.storageClass,
      })
    },
    async get(key: string): Promise<{ body: ReadableStream; customMetadata?: Record<string, string> } | null> {
      const obj = objects.get(key)
      if (!obj) return null

      return {
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(obj.data)
            controller.close()
          }
        }),
        customMetadata: obj.metadata
      }
    },
    async delete(key: string | string[]): Promise<void> {
      const keys = Array.isArray(key) ? key : [key]
      for (const k of keys) {
        objects.delete(k)
      }
    },
    async list(options?: { prefix?: string }): Promise<{ objects: { key: string }[] }> {
      const result: { key: string }[] = []
      for (const k of objects.keys()) {
        if (!options?.prefix || k.startsWith(options.prefix)) {
          result.push({ key: k })
        }
      }
      return { objects: result }
    }
  }
}

function createTestRecords(): Array<{ id: string; data: Record<string, unknown> }> {
  return Array.from({ length: 100 }, (_, i) => ({
    id: `record-${i}`,
    data: { index: i, name: `Record ${i}`, value: Math.random() * 1000 },
  }))
}

// ============================================================================
// TEST SUITE: TIERED STORAGE MANAGER
// ============================================================================

describe('TieredStorageManager', () => {
  let storage: MockStorage
  let warmBucket: MockR2Bucket
  let coldBucket: MockR2Bucket
  let env: MockEnv

  beforeEach(() => {
    vi.useFakeTimers()
    storage = createMockStorage()
    warmBucket = createMockR2Bucket()
    coldBucket = createMockR2Bucket()
    env = { R2_WARM: warmBucket, R2_COLD: coldBucket }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // HOT TIER OPERATIONS
  // ==========================================================================

  describe('Hot Tier Operations', () => {
    it('should store data in hot tier', async () => {
      const manager = null as unknown as {
        put(key: string, data: unknown): Promise<void>
        getLocation(key: string): Promise<DataLocation | null>
      }

      await manager.put('record-1', { name: 'Test' })

      const location = await manager.getLocation('record-1')

      expect(location?.tier).toBe('hot')
    })

    it('should retrieve data from hot tier', async () => {
      const manager = null as unknown as {
        put(key: string, data: unknown): Promise<void>
        get(key: string): Promise<unknown>
      }

      const testData = { name: 'Test', value: 42 }
      await manager.put('record-1', testData)

      const retrieved = await manager.get('record-1')

      expect(retrieved).toEqual(testData)
    })

    it('should track access count for hot tier items', async () => {
      const manager = null as unknown as {
        put(key: string, data: unknown): Promise<void>
        get(key: string): Promise<unknown>
        getLocation(key: string): Promise<DataLocation | null>
      }

      await manager.put('record-1', { name: 'Test' })

      // Access multiple times
      await manager.get('record-1')
      await manager.get('record-1')
      await manager.get('record-1')

      const location = await manager.getLocation('record-1')

      expect(location?.accessCount).toBe(3)
    })

    it('should update last access time', async () => {
      const manager = null as unknown as {
        put(key: string, data: unknown): Promise<void>
        get(key: string): Promise<unknown>
        getLocation(key: string): Promise<DataLocation | null>
      }

      await manager.put('record-1', { name: 'Test' })

      const initialLocation = await manager.getLocation('record-1')
      const initialAccess = initialLocation?.lastAccessAt

      await vi.advanceTimersByTimeAsync(1000)
      await manager.get('record-1')

      const updatedLocation = await manager.getLocation('record-1')

      expect(updatedLocation?.lastAccessAt).toBeGreaterThan(initialAccess!)
    })

    it('should delete data from hot tier', async () => {
      const manager = null as unknown as {
        put(key: string, data: unknown): Promise<void>
        delete(key: string): Promise<void>
        get(key: string): Promise<unknown>
      }

      await manager.put('record-1', { name: 'Test' })
      await manager.delete('record-1')

      const retrieved = await manager.get('record-1')

      expect(retrieved).toBeNull()
    })
  })

  // ==========================================================================
  // AUTOMATIC DEMOTION
  // ==========================================================================

  describe('Automatic Demotion', () => {
    it('should demote cold data to warm tier after retention period', async () => {
      const config: TieredStorageConfig = { hotRetentionMs: 60000 } // 1 minute
      const manager = null as unknown as {
        configure(config: TieredStorageConfig): void
        put(key: string, data: unknown): Promise<void>
        runDemotion(): Promise<TierDemotionResult>
        getLocation(key: string): Promise<DataLocation | null>
      }

      manager.configure(config)

      await manager.put('record-1', { name: 'Test' })

      // Advance time past retention
      await vi.advanceTimersByTimeAsync(65000)

      await manager.runDemotion()

      const location = await manager.getLocation('record-1')

      expect(location?.tier).toBe('warm')
    })

    it('should keep frequently accessed data in hot tier', async () => {
      const config: TieredStorageConfig = {
        hotRetentionMs: 60000,
        hotAccessThreshold: 5
      }
      const manager = null as unknown as {
        configure(config: TieredStorageConfig): void
        put(key: string, data: unknown): Promise<void>
        get(key: string): Promise<unknown>
        runDemotion(): Promise<TierDemotionResult>
        getLocation(key: string): Promise<DataLocation | null>
      }

      manager.configure(config)

      await manager.put('record-1', { name: 'Test' })

      // Access frequently (above threshold)
      for (let i = 0; i < 10; i++) {
        await manager.get('record-1')
        await vi.advanceTimersByTimeAsync(5000)
      }

      // Past retention time
      await vi.advanceTimersByTimeAsync(65000)

      await manager.runDemotion()

      const location = await manager.getLocation('record-1')

      // Should stay hot due to high access count
      expect(location?.tier).toBe('hot')
    })

    it('should demote in batches', async () => {
      const config: TieredStorageConfig = {
        hotRetentionMs: 60000,
        batchSize: 10
      }
      const manager = null as unknown as {
        configure(config: TieredStorageConfig): void
        put(key: string, data: unknown): Promise<void>
        runDemotion(): Promise<TierDemotionResult>
      }

      manager.configure(config)

      // Add 25 records
      for (let i = 0; i < 25; i++) {
        await manager.put(`record-${i}`, { index: i })
      }

      await vi.advanceTimersByTimeAsync(65000)

      const result = await manager.runDemotion()

      // Should demote in batches of 10
      expect(result.itemsDemoted).toBeLessThanOrEqual(10)
    })

    it('should store demoted data in R2', async () => {
      const config: TieredStorageConfig = { hotRetentionMs: 60000 }
      const manager = null as unknown as {
        configure(config: TieredStorageConfig): void
        put(key: string, data: unknown): Promise<void>
        runDemotion(): Promise<TierDemotionResult>
      }

      manager.configure(config)

      await manager.put('record-1', { name: 'Test' })
      await vi.advanceTimersByTimeAsync(65000)

      const result = await manager.runDemotion()

      // Data should be in warm bucket
      const stored = await warmBucket.get(result.r2Paths[0])
      expect(stored).not.toBeNull()
    })

    it('should compress data when demoting to cold tier', async () => {
      const config: TieredStorageConfig = {
        hotRetentionMs: 60000,
        warmRetentionMs: 3600000, // 1 hour
        compressCold: true
      }
      const manager = null as unknown as {
        configure(config: TieredStorageConfig): void
        put(key: string, data: unknown): Promise<void>
        runDemotion(): Promise<TierDemotionResult>
        getLocation(key: string): Promise<DataLocation | null>
      }

      manager.configure(config)

      // Create large data
      const largeData = { content: 'x'.repeat(10000) }
      await manager.put('record-1', largeData)

      // Advance past hot retention
      await vi.advanceTimersByTimeAsync(65000)
      await manager.runDemotion() // hot -> warm

      // Advance past warm retention
      await vi.advanceTimersByTimeAsync(3700000)
      await manager.runDemotion() // warm -> cold

      const location = await manager.getLocation('record-1')

      expect(location?.tier).toBe('cold')
      // Compressed size should be smaller
      expect(location?.sizeBytes).toBeLessThan(10000)
    })
  })

  // ==========================================================================
  // AUTOMATIC PROMOTION
  // ==========================================================================

  describe('Automatic Promotion', () => {
    it('should promote frequently accessed warm data to hot', async () => {
      const config: TieredStorageConfig = {
        hotRetentionMs: 60000,
        hotAccessThreshold: 5,
        autoPromote: true
      }
      const manager = null as unknown as {
        configure(config: TieredStorageConfig): void
        put(key: string, data: unknown): Promise<void>
        runDemotion(): Promise<TierDemotionResult>
        get(key: string): Promise<unknown>
        getLocation(key: string): Promise<DataLocation | null>
      }

      manager.configure(config)

      await manager.put('record-1', { name: 'Test' })
      await vi.advanceTimersByTimeAsync(65000)
      await manager.runDemotion()

      // Now access frequently from warm tier
      for (let i = 0; i < 10; i++) {
        await manager.get('record-1')
      }

      const location = await manager.getLocation('record-1')

      expect(location?.tier).toBe('hot')
    })

    it('should manually promote cold data to hot', async () => {
      const manager = null as unknown as {
        putToTier(key: string, data: unknown, tier: StorageTier): Promise<void>
        promote(key: string, targetTier: StorageTier): Promise<TierPromotionResult>
        getLocation(key: string): Promise<DataLocation | null>
      }

      await manager.putToTier('record-1', { name: 'Test' }, 'cold')

      await manager.promote('record-1', 'hot')

      const location = await manager.getLocation('record-1')

      expect(location?.tier).toBe('hot')
    })

    it('should track bytes transferred during promotion', async () => {
      const manager = null as unknown as {
        putToTier(key: string, data: unknown, tier: StorageTier): Promise<void>
        promote(key: string, targetTier: StorageTier): Promise<TierPromotionResult>
      }

      const data = { content: 'x'.repeat(1000) }
      await manager.putToTier('record-1', data, 'cold')

      const result = await manager.promote('record-1', 'hot')

      expect(result.bytesTransferred).toBeGreaterThan(0)
    })

    it('should clean up source tier after promotion', async () => {
      const manager = null as unknown as {
        putToTier(key: string, data: unknown, tier: StorageTier): Promise<void>
        promote(key: string, targetTier: StorageTier): Promise<TierPromotionResult>
        existsInTier(key: string, tier: StorageTier): Promise<boolean>
      }

      await manager.putToTier('record-1', { name: 'Test' }, 'cold')

      await manager.promote('record-1', 'hot')

      const existsInCold = await manager.existsInTier('record-1', 'cold')

      expect(existsInCold).toBe(false)
    })
  })

  // ==========================================================================
  // CROSS-TIER QUERIES
  // ==========================================================================

  describe('Cross-Tier Queries', () => {
    it('should find data across all tiers', async () => {
      const manager = null as unknown as {
        putToTier(key: string, data: unknown, tier: StorageTier): Promise<void>
        get(key: string): Promise<unknown>
      }

      await manager.putToTier('hot-record', { tier: 'hot' }, 'hot')
      await manager.putToTier('warm-record', { tier: 'warm' }, 'warm')
      await manager.putToTier('cold-record', { tier: 'cold' }, 'cold')

      const hotData = await manager.get('hot-record')
      const warmData = await manager.get('warm-record')
      const coldData = await manager.get('cold-record')

      expect(hotData).toEqual({ tier: 'hot' })
      expect(warmData).toEqual({ tier: 'warm' })
      expect(coldData).toEqual({ tier: 'cold' })
    })

    it('should search hot tier first for performance', async () => {
      const accessLog: StorageTier[] = []
      const manager = null as unknown as {
        putToTier(key: string, data: unknown, tier: StorageTier): Promise<void>
        onTierAccess(callback: (tier: StorageTier) => void): void
        get(key: string): Promise<unknown>
      }

      await manager.putToTier('record-1', { name: 'Test' }, 'hot')

      manager.onTierAccess((tier) => accessLog.push(tier))

      await manager.get('record-1')

      // Should only access hot tier (found immediately)
      expect(accessLog).toEqual(['hot'])
    })

    it('should fall through tiers when not found', async () => {
      const accessLog: StorageTier[] = []
      const manager = null as unknown as {
        putToTier(key: string, data: unknown, tier: StorageTier): Promise<void>
        onTierAccess(callback: (tier: StorageTier) => void): void
        get(key: string): Promise<unknown>
      }

      await manager.putToTier('record-1', { name: 'Test' }, 'cold')

      manager.onTierAccess((tier) => accessLog.push(tier))

      await manager.get('record-1')

      // Should check hot, then warm, then cold
      expect(accessLog).toEqual(['hot', 'warm', 'cold'])
    })

    it('should list all items across tiers', async () => {
      const manager = null as unknown as {
        putToTier(key: string, data: unknown, tier: StorageTier): Promise<void>
        listAll(): Promise<Array<{ key: string; tier: StorageTier }>>
      }

      await manager.putToTier('hot-1', {}, 'hot')
      await manager.putToTier('hot-2', {}, 'hot')
      await manager.putToTier('warm-1', {}, 'warm')
      await manager.putToTier('cold-1', {}, 'cold')

      const items = await manager.listAll()

      expect(items.length).toBe(4)
      expect(items.filter(i => i.tier === 'hot').length).toBe(2)
      expect(items.filter(i => i.tier === 'warm').length).toBe(1)
      expect(items.filter(i => i.tier === 'cold').length).toBe(1)
    })
  })

  // ==========================================================================
  // TIER STATISTICS
  // ==========================================================================

  describe('Tier Statistics', () => {
    it('should track item count per tier', async () => {
      const manager = null as unknown as {
        putToTier(key: string, data: unknown, tier: StorageTier): Promise<void>
        getStats(): Promise<{ hot: number; warm: number; cold: number; archive: number }>
      }

      await manager.putToTier('hot-1', {}, 'hot')
      await manager.putToTier('hot-2', {}, 'hot')
      await manager.putToTier('warm-1', {}, 'warm')

      const stats = await manager.getStats()

      expect(stats.hot).toBe(2)
      expect(stats.warm).toBe(1)
      expect(stats.cold).toBe(0)
    })

    it('should track total size per tier', async () => {
      const manager = null as unknown as {
        putToTier(key: string, data: unknown, tier: StorageTier): Promise<void>
        getSizeStats(): Promise<{ hot: number; warm: number; cold: number }>
      }

      await manager.putToTier('hot-1', { data: 'x'.repeat(1000) }, 'hot')
      await manager.putToTier('warm-1', { data: 'x'.repeat(2000) }, 'warm')

      const stats = await manager.getSizeStats()

      expect(stats.hot).toBeGreaterThan(0)
      expect(stats.warm).toBeGreaterThan(0)
    })

    it('should track access patterns', async () => {
      const manager = null as unknown as {
        put(key: string, data: unknown): Promise<void>
        get(key: string): Promise<unknown>
        getAccessStats(): Promise<{ totalReads: number; hotHits: number; warmHits: number; coldHits: number }>
      }

      await manager.put('record-1', { name: 'Test' })

      await manager.get('record-1')
      await manager.get('record-1')

      const stats = await manager.getAccessStats()

      expect(stats.totalReads).toBe(2)
      expect(stats.hotHits).toBe(2)
    })
  })

  // ==========================================================================
  // R2 INTEGRATION
  // ==========================================================================

  describe('R2 Integration', () => {
    it('should use correct bucket for each tier', async () => {
      const manager = null as unknown as {
        putToTier(key: string, data: unknown, tier: StorageTier): Promise<void>
      }

      await manager.putToTier('warm-record', { tier: 'warm' }, 'warm')
      await manager.putToTier('cold-record', { tier: 'cold' }, 'cold')

      // Verify warm bucket
      const warmStored = await warmBucket.get('warm-record')
      expect(warmStored).not.toBeNull()

      // Verify cold bucket
      const coldStored = await coldBucket.get('cold-record')
      expect(coldStored).not.toBeNull()
    })

    it('should store metadata with R2 objects', async () => {
      const manager = null as unknown as {
        putToTier(key: string, data: unknown, tier: StorageTier): Promise<void>
      }

      await manager.putToTier('record-1', { name: 'Test' }, 'warm')

      const obj = warmBucket.objects.get('record-1')

      expect(obj?.metadata?.originalTier).toBeDefined()
      expect(obj?.metadata?.createdAt).toBeDefined()
    })

    it('should handle R2 errors gracefully', async () => {
      const manager = null as unknown as {
        putToTier(key: string, data: unknown, tier: StorageTier): Promise<void>
      }

      // Simulate R2 failure
      warmBucket.put = async () => { throw new Error('R2 unavailable') }

      await expect(manager.putToTier('record-1', {}, 'warm'))
        .rejects.toThrow(/R2.*unavailable|storage.*error/i)
    })

    it('should retry failed R2 operations', async () => {
      let attempts = 0
      const manager = null as unknown as {
        putToTier(key: string, data: unknown, tier: StorageTier, options?: { maxRetries?: number }): Promise<void>
      }

      const originalPut = warmBucket.put.bind(warmBucket)
      warmBucket.put = async (...args: Parameters<typeof originalPut>) => {
        attempts++
        if (attempts < 3) throw new Error('Transient error')
        return originalPut(...args)
      }

      await manager.putToTier('record-1', {}, 'warm', { maxRetries: 3 })

      expect(attempts).toBe(3)
    })
  })

  // ==========================================================================
  // GARBAGE COLLECTION
  // ==========================================================================

  describe('Garbage Collection', () => {
    it('should collect orphaned R2 objects', async () => {
      const manager = null as unknown as {
        putToTier(key: string, data: unknown, tier: StorageTier): Promise<void>
        delete(key: string): Promise<void>
        collectGarbage(): Promise<{ orphansRemoved: number }>
      }

      await manager.putToTier('record-1', {}, 'warm')

      // Simulate orphan (metadata lost but R2 object remains)
      await warmBucket.put('orphan-record', new Uint8Array([1, 2, 3]))

      const result = await manager.collectGarbage()

      expect(result.orphansRemoved).toBeGreaterThan(0)
    })

    it('should not remove referenced objects', async () => {
      const manager = null as unknown as {
        putToTier(key: string, data: unknown, tier: StorageTier): Promise<void>
        collectGarbage(): Promise<{ orphansRemoved: number }>
        get(key: string): Promise<unknown>
      }

      await manager.putToTier('record-1', { name: 'Test' }, 'warm')

      await manager.collectGarbage()

      const data = await manager.get('record-1')
      expect(data).not.toBeNull()
    })
  })

  // ==========================================================================
  // CONSISTENCY GUARANTEES
  // ==========================================================================

  describe('Consistency Guarantees', () => {
    it('should ensure atomic tier transition', async () => {
      const manager = null as unknown as {
        put(key: string, data: unknown): Promise<void>
        runDemotion(): Promise<TierDemotionResult>
        get(key: string): Promise<unknown>
      }

      await manager.put('record-1', { name: 'Test' })

      // Simulate concurrent read during demotion
      const demotionPromise = vi.advanceTimersByTimeAsync(65000).then(() =>
        manager.runDemotion()
      )

      // Read during transition
      const data = await manager.get('record-1')

      await demotionPromise

      // Data should always be available
      expect(data).not.toBeNull()
    })

    it('should handle concurrent reads and writes', async () => {
      const manager = null as unknown as {
        put(key: string, data: unknown): Promise<void>
        get(key: string): Promise<unknown>
      }

      const operations = [
        manager.put('record-1', { v: 1 }),
        manager.get('record-1'),
        manager.put('record-1', { v: 2 }),
        manager.get('record-1'),
        manager.put('record-1', { v: 3 }),
      ]

      await Promise.all(operations)

      const final = await manager.get('record-1')
      expect(final).toBeDefined()
    })

    it('should maintain referential integrity during promotion', async () => {
      const manager = null as unknown as {
        putToTier(key: string, data: unknown, tier: StorageTier): Promise<void>
        promote(key: string, targetTier: StorageTier): Promise<TierPromotionResult>
        getLocation(key: string): Promise<DataLocation | null>
        get(key: string): Promise<unknown>
      }

      await manager.putToTier('record-1', { name: 'Test' }, 'cold')

      // Start promotion
      const promotionPromise = manager.promote('record-1', 'hot')

      // Read during promotion
      const data = await manager.get('record-1')

      await promotionPromise

      expect(data).toEqual({ name: 'Test' })
    })
  })

  // ==========================================================================
  // BACKUP/RESTORE
  // ==========================================================================

  describe('Backup/Restore', () => {
    it('should backup all tiers to R2', async () => {
      const manager = null as unknown as {
        putToTier(key: string, data: unknown, tier: StorageTier): Promise<void>
        createBackup(): Promise<{ backupId: string; itemCount: number }>
      }

      await manager.putToTier('hot-1', {}, 'hot')
      await manager.putToTier('warm-1', {}, 'warm')
      await manager.putToTier('cold-1', {}, 'cold')

      const backup = await manager.createBackup()

      expect(backup.backupId).toBeDefined()
      expect(backup.itemCount).toBe(3)
    })

    it('should restore all tiers from backup', async () => {
      const manager = null as unknown as {
        putToTier(key: string, data: unknown, tier: StorageTier): Promise<void>
        createBackup(): Promise<{ backupId: string; itemCount: number }>
        clearAll(): Promise<void>
        restoreFromBackup(backupId: string): Promise<{ itemsRestored: number }>
        getStats(): Promise<{ hot: number; warm: number; cold: number; archive: number }>
      }

      await manager.putToTier('hot-1', {}, 'hot')
      await manager.putToTier('warm-1', {}, 'warm')

      const backup = await manager.createBackup()

      await manager.clearAll()
      await manager.restoreFromBackup(backup.backupId)

      const stats = await manager.getStats()
      expect(stats.hot + stats.warm).toBe(2)
    })
  })
})
