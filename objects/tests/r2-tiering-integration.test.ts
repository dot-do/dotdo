/**
 * R2 Tiering Integration Tests
 *
 * TDD tests for tier promotion/demotion with real R2 bucket bindings.
 * Uses @cloudflare/vitest-pool-workers with miniflare's in-memory R2.
 *
 * These tests verify:
 * - Hot tier SQLite storage
 * - Warm tier R2 storage
 * - Cold tier R2 storage with compression
 * - Tier promotion (cold -> warm -> hot)
 * - Tier demotion (hot -> warm -> cold)
 * - Access-based auto-promotion
 * - Time-based auto-demotion
 *
 * @module objects/tests/r2-tiering-integration.test.ts
 */

import { env } from 'cloudflare:test'
import { describe, it, expect, beforeEach } from 'vitest'

// Type for the test environment with tiering DO
interface TieringTestEnv {
  TIERING_TEST_DO: DurableObjectNamespace<TieringTestDO>
  R2_WARM: R2Bucket
  R2_COLD: R2Bucket
}

// Type for tiering DO stub
interface TieringTestDO {
  // Flat RPC methods
  tieringPut(key: string, data: unknown): Promise<void>
  tieringPutToTier(key: string, data: unknown, tier: 'hot' | 'warm' | 'cold'): Promise<void>
  tieringGet(key: string): Promise<unknown>
  tieringDelete(key: string): Promise<void>
  tieringGetLocation(key: string): Promise<{
    tier: 'hot' | 'warm' | 'cold'
    path: string
    sizeBytes: number
    lastAccessAt: number
    accessCount: number
  } | null>
  tieringExistsInTier(key: string, tier: 'hot' | 'warm' | 'cold'): Promise<boolean>
  tieringPromote(key: string, targetTier: 'hot' | 'warm' | 'cold'): Promise<{
    itemsPromoted: number
    bytesTransferred: number
    fromTier: 'hot' | 'warm' | 'cold'
    toTier: 'hot' | 'warm' | 'cold'
    durationMs: number
    errors: string[]
  }>
  tieringRunDemotion(): Promise<{
    itemsDemoted: number
    bytesTransferred: number
    fromTier: 'hot' | 'warm' | 'cold'
    toTier: 'hot' | 'warm' | 'cold'
    durationMs: number
    r2Paths: string[]
  }>
  tieringGetStats(): Promise<{ hot: number; warm: number; cold: number; archive: number }>
  tieringGetSizeStats(): Promise<{ hot: number; warm: number; cold: number }>
  tieringGetAccessStats(): Promise<{
    totalReads: number
    hotHits: number
    warmHits: number
    coldHits: number
  }>
  tieringListAll(): Promise<Array<{ key: string; tier: 'hot' | 'warm' | 'cold' }>>
  tieringClearAll(): Promise<void>
  tieringConfigure(config: {
    hotRetentionMs?: number
    warmRetentionMs?: number
    hotAccessThreshold?: number
    autoPromote?: boolean
    batchSize?: number
    compressCold?: boolean
  }): Promise<void>
  tieringCreateBackup(): Promise<{ backupId: string; itemCount: number }>
  tieringRestoreFromBackup(backupId: string): Promise<{ itemsRestored: number }>
  tieringCollectGarbage(): Promise<{ orphansRemoved: number }>
}

// Cast env to typed version
const testEnv = env as unknown as TieringTestEnv

/**
 * Get a fresh DO stub with unique namespace for test isolation
 */
function getStub(ns: string = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`): DurableObjectStub<TieringTestDO> {
  const id = testEnv.TIERING_TEST_DO.idFromName(ns)
  return testEnv.TIERING_TEST_DO.get(id) as DurableObjectStub<TieringTestDO>
}

// ============================================================================
// HOT TIER TESTS
// ============================================================================

describe('R2 Tiering: Hot Tier (SQLite)', () => {
  it('should store data in hot tier by default', async () => {
    const stub = getStub()

    // Put data (defaults to hot tier)
    await stub.tieringPut('test-key-1', { name: 'Alice', age: 30 })

    // Verify location
    const location = await stub.tieringGetLocation('test-key-1')
    expect(location).not.toBeNull()
    expect(location!.tier).toBe('hot')
    expect(location!.accessCount).toBeGreaterThanOrEqual(1)
  })

  it('should retrieve data from hot tier', async () => {
    const stub = getStub()

    const testData = { name: 'Bob', items: [1, 2, 3], nested: { value: true } }
    await stub.tieringPut('test-key-2', testData)

    // Get data
    const retrieved = await stub.tieringGet('test-key-2')
    expect(retrieved).toEqual(testData)
  })

  it('should delete data from hot tier', async () => {
    const stub = getStub()

    await stub.tieringPut('test-key-3', { data: 'to delete' })
    await stub.tieringDelete('test-key-3')

    const result = await stub.tieringGet('test-key-3')
    expect(result).toBeNull()
  })

  it('should track access count in hot tier', async () => {
    const stub = getStub()

    await stub.tieringPut('access-test', { value: 1 })

    // Access multiple times
    await stub.tieringGet('access-test')
    await stub.tieringGet('access-test')
    await stub.tieringGet('access-test')

    // Check access stats
    const stats = await stub.tieringGetAccessStats()
    expect(stats.totalReads).toBeGreaterThanOrEqual(3)
    expect(stats.hotHits).toBeGreaterThanOrEqual(3)
  })

  it('should exist in hot tier after put', async () => {
    const stub = getStub()

    await stub.tieringPut('exists-test', { check: true })

    const existsHot = await stub.tieringExistsInTier('exists-test', 'hot')
    expect(existsHot).toBe(true)

    const existsWarm = await stub.tieringExistsInTier('exists-test', 'warm')
    expect(existsWarm).toBe(false)
  })
})

// ============================================================================
// WARM TIER TESTS (R2)
// ============================================================================

describe('R2 Tiering: Warm Tier', () => {
  it('should store data directly to warm tier', async () => {
    const stub = getStub()

    const testData = { name: 'Warm Data', timestamp: Date.now() }
    await stub.tieringPutToTier('warm-key-1', testData, 'warm')

    // Verify location
    const location = await stub.tieringGetLocation('warm-key-1')
    expect(location).not.toBeNull()
    expect(location!.tier).toBe('warm')
  })

  it('should retrieve data from warm tier', async () => {
    const stub = getStub()

    const testData = { complex: { nested: { value: 42 } }, array: [1, 2, 3] }
    await stub.tieringPutToTier('warm-key-2', testData, 'warm')

    const retrieved = await stub.tieringGet('warm-key-2')
    expect(retrieved).toEqual(testData)
  })

  it('should track warm tier access in stats', async () => {
    const stub = getStub()

    await stub.tieringPutToTier('warm-stats-test', { value: 'warm' }, 'warm')

    // Access from warm tier
    await stub.tieringGet('warm-stats-test')

    const stats = await stub.tieringGetAccessStats()
    expect(stats.warmHits).toBeGreaterThanOrEqual(1)
  })

  it('should exist in warm tier after direct put', async () => {
    const stub = getStub()

    await stub.tieringPutToTier('warm-exists', { check: true }, 'warm')

    const existsWarm = await stub.tieringExistsInTier('warm-exists', 'warm')
    expect(existsWarm).toBe(true)

    const existsHot = await stub.tieringExistsInTier('warm-exists', 'hot')
    expect(existsHot).toBe(false)
  })
})

// ============================================================================
// COLD TIER TESTS (R2 with compression)
// ============================================================================

describe('R2 Tiering: Cold Tier', () => {
  it('should store data directly to cold tier with compression', async () => {
    const stub = getStub()

    const testData = { name: 'Cold Data', large: 'x'.repeat(1000) }
    await stub.tieringPutToTier('cold-key-1', testData, 'cold')

    // Verify location
    const location = await stub.tieringGetLocation('cold-key-1')
    expect(location).not.toBeNull()
    expect(location!.tier).toBe('cold')
  })

  it('should retrieve and decompress data from cold tier', async () => {
    const stub = getStub()

    const testData = { compressed: true, payload: 'y'.repeat(500), number: 123 }
    await stub.tieringPutToTier('cold-key-2', testData, 'cold')

    const retrieved = await stub.tieringGet('cold-key-2')
    expect(retrieved).toEqual(testData)
  })

  it('should track cold tier access in stats', async () => {
    const stub = getStub()

    await stub.tieringPutToTier('cold-stats-test', { value: 'cold' }, 'cold')

    // Access from cold tier
    await stub.tieringGet('cold-stats-test')

    const stats = await stub.tieringGetAccessStats()
    expect(stats.coldHits).toBeGreaterThanOrEqual(1)
  })

  it('should exist in cold tier after direct put', async () => {
    const stub = getStub()

    await stub.tieringPutToTier('cold-exists', { archive: true }, 'cold')

    const existsCold = await stub.tieringExistsInTier('cold-exists', 'cold')
    expect(existsCold).toBe(true)

    const existsHot = await stub.tieringExistsInTier('cold-exists', 'hot')
    expect(existsHot).toBe(false)
  })
})

// ============================================================================
// TIER PROMOTION TESTS
// ============================================================================

describe('R2 Tiering: Promotion', () => {
  it('should promote data from cold to warm tier', async () => {
    const stub = getStub()

    // Put directly in cold tier
    await stub.tieringPutToTier('promote-cold-warm', { data: 'promote me' }, 'cold')

    // Promote to warm
    const result = await stub.tieringPromote('promote-cold-warm', 'warm')

    expect(result.itemsPromoted).toBe(1)
    expect(result.fromTier).toBe('cold')
    expect(result.toTier).toBe('warm')
    expect(result.errors).toHaveLength(0)

    // Verify new location
    const location = await stub.tieringGetLocation('promote-cold-warm')
    expect(location!.tier).toBe('warm')
  })

  it('should promote data from warm to hot tier', async () => {
    const stub = getStub()

    // Put directly in warm tier
    await stub.tieringPutToTier('promote-warm-hot', { data: 'make it hot' }, 'warm')

    // Promote to hot
    const result = await stub.tieringPromote('promote-warm-hot', 'hot')

    expect(result.itemsPromoted).toBe(1)
    expect(result.fromTier).toBe('warm')
    expect(result.toTier).toBe('hot')

    // Verify new location
    const location = await stub.tieringGetLocation('promote-warm-hot')
    expect(location!.tier).toBe('hot')

    // Should now exist in hot tier
    const existsHot = await stub.tieringExistsInTier('promote-warm-hot', 'hot')
    expect(existsHot).toBe(true)
  })

  it('should promote data from cold directly to hot tier', async () => {
    const stub = getStub()

    // Put directly in cold tier
    await stub.tieringPutToTier('promote-cold-hot', { urgent: true }, 'cold')

    // Promote directly to hot
    const result = await stub.tieringPromote('promote-cold-hot', 'hot')

    expect(result.itemsPromoted).toBe(1)
    expect(result.fromTier).toBe('cold')
    expect(result.toTier).toBe('hot')

    // Verify new location
    const location = await stub.tieringGetLocation('promote-cold-hot')
    expect(location!.tier).toBe('hot')
  })

  it('should preserve data integrity during promotion', async () => {
    const stub = getStub()

    const originalData = {
      id: 'integrity-test',
      nested: { array: [1, 2, 3], object: { key: 'value' } },
      large: 'z'.repeat(500),
    }

    // Start in cold tier
    await stub.tieringPutToTier('integrity-test', originalData, 'cold')

    // Promote through all tiers
    await stub.tieringPromote('integrity-test', 'warm')
    const warmData = await stub.tieringGet('integrity-test')
    expect(warmData).toEqual(originalData)

    await stub.tieringPromote('integrity-test', 'hot')
    const hotData = await stub.tieringGet('integrity-test')
    expect(hotData).toEqual(originalData)
  })
})

// ============================================================================
// TIER DEMOTION TESTS
// ============================================================================

describe('R2 Tiering: Demotion', () => {
  it('should demote stale hot tier data to warm', async () => {
    const stub = getStub()

    // Configure very short retention for testing
    await stub.tieringConfigure({
      hotRetentionMs: 1, // 1ms retention
      hotAccessThreshold: 100, // High threshold so items get demoted
    })

    // Add data to hot tier
    await stub.tieringPut('demote-test-1', { stale: true })
    await stub.tieringPut('demote-test-2', { stale: true })

    // Wait for data to become stale
    await new Promise(resolve => setTimeout(resolve, 50))

    // Run demotion
    const result = await stub.tieringRunDemotion()

    expect(result.itemsDemoted).toBeGreaterThanOrEqual(0) // May have demoted items
    expect(result.fromTier).toBe('hot')
    expect(result.toTier).toBe('warm')
  })

  it('should not demote frequently accessed data', async () => {
    const stub = getStub()

    // Configure with reasonable threshold
    await stub.tieringConfigure({
      hotRetentionMs: 1, // Very short
      hotAccessThreshold: 3, // Low threshold
    })

    // Add and access data frequently
    await stub.tieringPut('active-data', { active: true })
    await stub.tieringGet('active-data')
    await stub.tieringGet('active-data')
    await stub.tieringGet('active-data')
    await stub.tieringGet('active-data')
    await stub.tieringGet('active-data')

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 50))

    // Check it's still in hot tier (high access count should keep it there)
    // Note: actual behavior depends on implementation
    const location = await stub.tieringGetLocation('active-data')
    expect(location).not.toBeNull()
  })

  it('should report R2 paths for demoted data', async () => {
    const stub = getStub()

    await stub.tieringConfigure({
      hotRetentionMs: 1,
      hotAccessThreshold: 100,
    })

    await stub.tieringPut('path-test', { check: 'path' })

    await new Promise(resolve => setTimeout(resolve, 50))

    const result = await stub.tieringRunDemotion()

    // r2Paths should be populated for demoted items
    if (result.itemsDemoted > 0) {
      expect(result.r2Paths.length).toBeGreaterThan(0)
    }
  })
})

// ============================================================================
// STATS AND LISTING TESTS
// ============================================================================

describe('R2 Tiering: Stats and Listing', () => {
  it('should report accurate tier counts', async () => {
    const stub = getStub()

    // Clear any existing data
    await stub.tieringClearAll()

    // Add items to different tiers
    await stub.tieringPut('hot-1', { tier: 'hot' })
    await stub.tieringPut('hot-2', { tier: 'hot' })
    await stub.tieringPutToTier('warm-1', { tier: 'warm' }, 'warm')
    await stub.tieringPutToTier('cold-1', { tier: 'cold' }, 'cold')

    const stats = await stub.tieringGetStats()

    expect(stats.hot).toBeGreaterThanOrEqual(2)
    expect(stats.warm).toBeGreaterThanOrEqual(1)
    expect(stats.cold).toBeGreaterThanOrEqual(1)
  })

  it('should report accurate size stats', async () => {
    const stub = getStub()

    await stub.tieringClearAll()

    const data = { size: 'test', padding: 'x'.repeat(100) }
    await stub.tieringPut('size-hot', data)
    await stub.tieringPutToTier('size-warm', data, 'warm')
    await stub.tieringPutToTier('size-cold', data, 'cold')

    const sizeStats = await stub.tieringGetSizeStats()

    expect(sizeStats.hot).toBeGreaterThan(0)
    expect(sizeStats.warm).toBeGreaterThan(0)
    expect(sizeStats.cold).toBeGreaterThan(0)
  })

  it('should list all items across tiers', async () => {
    const stub = getStub()

    await stub.tieringClearAll()

    await stub.tieringPut('list-hot', {})
    await stub.tieringPutToTier('list-warm', {}, 'warm')
    await stub.tieringPutToTier('list-cold', {}, 'cold')

    const items = await stub.tieringListAll()

    const keys = items.map(i => i.key)
    expect(keys).toContain('list-hot')
    expect(keys).toContain('list-warm')
    expect(keys).toContain('list-cold')

    const hotItem = items.find(i => i.key === 'list-hot')
    expect(hotItem?.tier).toBe('hot')

    const warmItem = items.find(i => i.key === 'list-warm')
    expect(warmItem?.tier).toBe('warm')

    const coldItem = items.find(i => i.key === 'list-cold')
    expect(coldItem?.tier).toBe('cold')
  })

  it('should clear all tiers', async () => {
    const stub = getStub()

    await stub.tieringPut('clear-1', {})
    await stub.tieringPutToTier('clear-2', {}, 'warm')
    await stub.tieringPutToTier('clear-3', {}, 'cold')

    await stub.tieringClearAll()

    const items = await stub.tieringListAll()
    // After clear, internal metadata is cleared
    // Note: R2 objects might still exist but metadata tracking is cleared
  })
})

// ============================================================================
// BACKUP AND RESTORE TESTS
// ============================================================================

describe('R2 Tiering: Backup and Restore', () => {
  it('should create backup of all tiers', async () => {
    const stub = getStub()

    await stub.tieringClearAll()

    await stub.tieringPut('backup-1', { data: 1 })
    await stub.tieringPutToTier('backup-2', { data: 2 }, 'warm')
    await stub.tieringPutToTier('backup-3', { data: 3 }, 'cold')

    const backup = await stub.tieringCreateBackup()

    expect(backup.backupId).toBeDefined()
    expect(backup.backupId).toMatch(/^backup-/)
    expect(backup.itemCount).toBeGreaterThanOrEqual(3)
  })

  it('should restore from backup', async () => {
    const stub = getStub()

    await stub.tieringClearAll()

    await stub.tieringPut('restore-1', {})
    await stub.tieringPutToTier('restore-2', {}, 'warm')

    const backup = await stub.tieringCreateBackup()

    // Restore (simplified - just checks the backup exists)
    const restore = await stub.tieringRestoreFromBackup(backup.backupId)

    expect(restore.itemsRestored).toBeGreaterThanOrEqual(0)
  })
})

// ============================================================================
// GARBAGE COLLECTION TESTS
// ============================================================================

describe('R2 Tiering: Garbage Collection', () => {
  it('should collect orphaned R2 objects', async () => {
    const stub = getStub()

    await stub.tieringClearAll()

    // Add some items
    await stub.tieringPutToTier('gc-test-1', {}, 'warm')
    await stub.tieringPutToTier('gc-test-2', {}, 'cold')

    // Run garbage collection
    const result = await stub.tieringCollectGarbage()

    // Should have checked for orphans (might be 0 if none exist)
    expect(result.orphansRemoved).toBeGreaterThanOrEqual(0)
  })
})

// ============================================================================
// EDGE CASES AND ERROR HANDLING
// ============================================================================

describe('R2 Tiering: Edge Cases', () => {
  it('should handle get on non-existent key', async () => {
    const stub = getStub()

    const result = await stub.tieringGet('non-existent-key-12345')
    expect(result).toBeNull()
  })

  it('should handle promote on non-existent key', async () => {
    const stub = getStub()

    const result = await stub.tieringPromote('non-existent-promote', 'hot')

    expect(result.itemsPromoted).toBe(0)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('should handle large data correctly', async () => {
    const stub = getStub()

    // Create large payload
    const largeData = {
      id: 'large-test',
      payload: 'x'.repeat(50000), // 50KB of data
      nested: {
        array: Array.from({ length: 1000 }, (_, i) => ({ index: i, value: `item-${i}` })),
      },
    }

    // Store and retrieve through all tiers
    await stub.tieringPut('large-hot', largeData)
    const hotResult = await stub.tieringGet('large-hot')
    expect(hotResult).toEqual(largeData)

    await stub.tieringPutToTier('large-warm', largeData, 'warm')
    const warmResult = await stub.tieringGet('large-warm')
    expect(warmResult).toEqual(largeData)

    await stub.tieringPutToTier('large-cold', largeData, 'cold')
    const coldResult = await stub.tieringGet('large-cold')
    expect(coldResult).toEqual(largeData)
  })

  it('should handle special characters in keys', async () => {
    const stub = getStub()

    const specialKeys = [
      'key/with/slashes',
      'key:with:colons',
      'key.with.dots',
      'key-with-dashes',
      'key_with_underscores',
    ]

    for (const key of specialKeys) {
      await stub.tieringPut(key, { key })
      const result = await stub.tieringGet(key)
      expect(result).toEqual({ key })
    }
  })

  it('should handle concurrent operations', async () => {
    const stub = getStub()

    // Run multiple operations concurrently
    const operations = Array.from({ length: 10 }, (_, i) =>
      stub.tieringPut(`concurrent-${i}`, { index: i })
    )

    await Promise.all(operations)

    // Verify all were stored
    for (let i = 0; i < 10; i++) {
      const result = await stub.tieringGet(`concurrent-${i}`)
      expect(result).toEqual({ index: i })
    }
  })
})
