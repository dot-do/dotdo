/**
 * Tiered Storage Transparency Tests
 *
 * RED TDD: These tests should FAIL because TieredStorage doesn't exist yet.
 *
 * This file defines the expected behavior for transparent tiered storage in DO.
 * The tiered storage layer automatically migrates data between:
 * - Hot tier (in-memory) for frequently accessed data
 * - Warm tier (SQLite) for recent but less frequent data
 * - Cold tier (R2) for archived/old data
 *
 * Test Categories:
 * 1. Tier Placement - Data stored in appropriate tier based on access frequency
 * 2. Automatic Promotion - Cold to hot on access
 * 3. Automatic Demotion - Hot to cold after TTL
 * 4. Unified API - Same interface regardless of current tier
 * 5. Data Integrity - No data loss during tier migration
 * 6. Latency Expectations - Hot < 10ms, warm < 50ms, cold < 500ms
 *
 * Target: 15+ test cases (all failing until implementation)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// These imports will FAIL - implementation doesn't exist yet
import {
  TieredStorage,
  type StorageTier,
  type TierConfig,
  type AccessStats,
  type MigrationResult,
  TierNotFoundError,
  MigrationError,
} from '../TieredStorage'

// ============================================================================
// TYPE DEFINITIONS (for test clarity)
// ============================================================================

/**
 * Expected tier configuration structure
 */
interface ExpectedTierConfig {
  hot: {
    maxItems: number
    maxAge: number  // ms before demotion consideration
  }
  warm: {
    maxItems: number
    maxAge: number  // ms before demotion to cold
  }
  cold: {
    backend: 'r2' | 'sqlite'
  }
}

/**
 * Expected access statistics structure
 */
interface ExpectedAccessStats {
  accessCount: number
  lastAccess: number
  currentTier: StorageTier
  createdAt: number
  promotedAt?: number
  demotedAt?: number
}

// ============================================================================
// MOCK HELPERS
// ============================================================================

function createMockStorage() {
  const storage = new Map<string, unknown>()

  return {
    storage: {
      get: vi.fn(async <T>(key: string): Promise<T | undefined> => storage.get(key) as T | undefined),
      put: vi.fn(async <T>(key: string, value: T): Promise<void> => {
        storage.set(key, value)
      }),
      delete: vi.fn(async (key: string): Promise<boolean> => storage.delete(key)),
      deleteAll: vi.fn(async (): Promise<void> => storage.clear()),
      list: vi.fn(async <T>(options?: { prefix?: string }): Promise<Map<string, T>> => {
        const result = new Map<string, T>()
        for (const [key, value] of storage) {
          if (options?.prefix && !key.startsWith(options.prefix)) continue
          result.set(key, value as T)
        }
        return result
      }),
    },
    _storage: storage,
  }
}

function createMockState() {
  const { storage, _storage } = createMockStorage()
  return {
    id: {
      toString: () => 'test-tiered-do-id',
      name: 'test-tiered-do-id',
      equals: (other: { toString: () => string }) => other.toString() === 'test-tiered-do-id',
    },
    storage,
    _storage,
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async (fn: () => Promise<void>) => fn()),
  } as unknown as DurableObjectState & { _storage: Map<string, unknown> }
}

function createMockEnv() {
  const r2Storage = new Map<string, unknown>()

  return {
    DO: {
      idFromName: vi.fn((name: string) => ({ toString: () => `id-for-${name}` })),
      get: vi.fn(() => ({
        fetch: vi.fn(async () => new Response(JSON.stringify({ ok: true }))),
      })),
    },
    R2_COLD_STORAGE: {
      put: vi.fn(async (key: string, value: unknown) => {
        r2Storage.set(key, value)
      }),
      get: vi.fn(async (key: string) => {
        const value = r2Storage.get(key)
        if (!value) return null
        return {
          text: async () => JSON.stringify(value),
          json: async () => value,
          arrayBuffer: async () => new ArrayBuffer(0),
        }
      }),
      delete: vi.fn(async (key: string) => r2Storage.delete(key)),
      list: vi.fn(async () => ({ objects: [] })),
    },
    _r2Storage: r2Storage,
  }
}

// ============================================================================
// TEST SUITE: Tier Placement
// ============================================================================

describe('Tier Placement', () => {
  let mockState: ReturnType<typeof createMockState>
  let mockEnv: ReturnType<typeof createMockEnv>
  let storage: TieredStorage

  beforeEach(() => {
    vi.useFakeTimers()
    mockState = createMockState()
    mockEnv = createMockEnv()
    storage = new TieredStorage(mockState, mockEnv)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stores new data in hot tier by default', async () => {
    // Store a new value
    await storage.set('user:123', { name: 'John', email: 'john@example.com' })

    // Should be in hot tier immediately
    const tier = await storage.getCurrentTier('user:123')
    expect(tier).toBe('hot')

    // Value should be accessible
    const value = await storage.get('user:123')
    expect(value).toEqual({ name: 'John', email: 'john@example.com' })
  })

  it('allows explicit tier placement on write', async () => {
    // Store directly to warm tier (useful for bulk imports)
    await storage.set('archive:doc-1', { content: 'archived document' }, { tier: 'warm' })

    const tier = await storage.getCurrentTier('archive:doc-1')
    expect(tier).toBe('warm')

    // Store directly to cold tier
    await storage.set('archive:doc-2', { content: 'cold archived document' }, { tier: 'cold' })

    const coldTier = await storage.getCurrentTier('archive:doc-2')
    expect(coldTier).toBe('cold')
  })

  it('returns null for non-existent keys', async () => {
    const tier = await storage.getCurrentTier('non-existent')
    expect(tier).toBeNull()

    const value = await storage.get('non-existent')
    expect(value).toBeUndefined()
  })

  it('tracks access patterns per key', async () => {
    await storage.set('tracking:key', { value: 'test' })

    // Access multiple times
    await storage.get('tracking:key')
    await storage.get('tracking:key')
    await storage.get('tracking:key')

    const stats = storage.getAccessStats('tracking:key')
    expect(stats).toBeDefined()
    expect(stats!.accessCount).toBe(3)
    expect(stats!.currentTier).toBe('hot')
    expect(stats!.lastAccess).toBeGreaterThan(0)
  })
})

// ============================================================================
// TEST SUITE: Hot Tier Behavior
// ============================================================================

describe('Hot Tier (In-Memory)', () => {
  let mockState: ReturnType<typeof createMockState>
  let mockEnv: ReturnType<typeof createMockEnv>
  let storage: TieredStorage

  beforeEach(() => {
    vi.useFakeTimers()
    mockState = createMockState()
    mockEnv = createMockEnv()
    storage = new TieredStorage(mockState, mockEnv, {
      hot: { maxItems: 100, maxAge: 60000 },  // 1 minute
      warm: { maxItems: 1000, maxAge: 3600000 },  // 1 hour
      cold: { backend: 'r2' },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps frequently accessed data in hot tier', async () => {
    await storage.set('hot:key', { data: 'frequently accessed' })

    // Access frequently within the maxAge window
    for (let i = 0; i < 10; i++) {
      await storage.get('hot:key')
      vi.advanceTimersByTime(5000)  // 5 seconds between accesses
    }

    // Should still be in hot tier
    const tier = await storage.getCurrentTier('hot:key')
    expect(tier).toBe('hot')
  })

  it('enforces maxItems limit for hot tier', async () => {
    // Create storage with small hot tier
    const smallHotStorage = new TieredStorage(mockState, mockEnv, {
      hot: { maxItems: 3, maxAge: 60000 },
      warm: { maxItems: 100, maxAge: 3600000 },
      cold: { backend: 'r2' },
    })

    // Fill hot tier
    await smallHotStorage.set('item:1', { data: '1' })
    await smallHotStorage.set('item:2', { data: '2' })
    await smallHotStorage.set('item:3', { data: '3' })

    // All should be in hot tier
    expect(await smallHotStorage.getCurrentTier('item:1')).toBe('hot')
    expect(await smallHotStorage.getCurrentTier('item:2')).toBe('hot')
    expect(await smallHotStorage.getCurrentTier('item:3')).toBe('hot')

    // Add one more - should trigger demotion of least recently used
    await smallHotStorage.set('item:4', { data: '4' })

    // item:4 should be in hot tier
    expect(await smallHotStorage.getCurrentTier('item:4')).toBe('hot')

    // One of the older items should have been demoted to warm
    const tiers = await Promise.all([
      smallHotStorage.getCurrentTier('item:1'),
      smallHotStorage.getCurrentTier('item:2'),
      smallHotStorage.getCurrentTier('item:3'),
    ])
    const demotedCount = tiers.filter(t => t === 'warm').length
    expect(demotedCount).toBeGreaterThanOrEqual(1)
  })
})

// ============================================================================
// TEST SUITE: Warm Tier Behavior
// ============================================================================

describe('Warm Tier (SQLite)', () => {
  let mockState: ReturnType<typeof createMockState>
  let mockEnv: ReturnType<typeof createMockEnv>
  let storage: TieredStorage

  beforeEach(() => {
    vi.useFakeTimers()
    mockState = createMockState()
    mockEnv = createMockEnv()
    storage = new TieredStorage(mockState, mockEnv, {
      hot: { maxItems: 10, maxAge: 60000 },
      warm: { maxItems: 100, maxAge: 3600000 },
      cold: { backend: 'r2' },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stores recent but less frequent data in warm tier', async () => {
    // Store data
    await storage.set('warm:data', { content: 'warm storage test' })

    // Let it age past hot tier maxAge without accessing
    vi.advanceTimersByTime(120000)  // 2 minutes

    // Trigger background maintenance (demotion check)
    await storage.runMaintenance()

    // Should now be in warm tier
    const tier = await storage.getCurrentTier('warm:data')
    expect(tier).toBe('warm')

    // Data should still be accessible
    const value = await storage.get('warm:data')
    expect(value).toEqual({ content: 'warm storage test' })
  })

  it('uses DO SQLite storage for warm tier', async () => {
    // Store directly in warm tier
    await storage.set('sqlite:key', { data: 'stored in sqlite' }, { tier: 'warm' })

    // Verify storage was used (not just in-memory)
    expect(mockState.storage.put).toHaveBeenCalled()

    // Data should be retrievable
    const value = await storage.get('sqlite:key')
    expect(value).toEqual({ data: 'stored in sqlite' })
  })
})

// ============================================================================
// TEST SUITE: Cold Tier Behavior
// ============================================================================

describe('Cold Tier (R2)', () => {
  let mockState: ReturnType<typeof createMockState>
  let mockEnv: ReturnType<typeof createMockEnv>
  let storage: TieredStorage

  beforeEach(() => {
    vi.useFakeTimers()
    mockState = createMockState()
    mockEnv = createMockEnv()
    storage = new TieredStorage(mockState, mockEnv, {
      hot: { maxItems: 10, maxAge: 60000 },
      warm: { maxItems: 100, maxAge: 300000 },  // 5 minutes
      cold: { backend: 'r2' },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('archives old data to cold tier', async () => {
    // Store data
    await storage.set('archive:old', { content: 'old archived data' })

    // Age past both hot and warm maxAge
    vi.advanceTimersByTime(400000)  // ~6.7 minutes

    // Trigger maintenance
    await storage.runMaintenance()

    // Should be in cold tier
    const tier = await storage.getCurrentTier('archive:old')
    expect(tier).toBe('cold')

    // Data should still be accessible (just slower)
    const value = await storage.get('archive:old')
    expect(value).toEqual({ content: 'old archived data' })
  })

  it('uses R2 for cold tier storage', async () => {
    // Store directly in cold tier
    await storage.set('r2:key', { data: 'stored in r2' }, { tier: 'cold' })

    // Verify R2 was used
    expect(mockEnv.R2_COLD_STORAGE.put).toHaveBeenCalled()

    // Data should be retrievable
    const value = await storage.get('r2:key')
    expect(value).toEqual({ data: 'stored in r2' })
  })
})

// ============================================================================
// TEST SUITE: Automatic Promotion
// ============================================================================

describe('Automatic Promotion', () => {
  let mockState: ReturnType<typeof createMockState>
  let mockEnv: ReturnType<typeof createMockEnv>
  let storage: TieredStorage

  beforeEach(() => {
    vi.useFakeTimers()
    mockState = createMockState()
    mockEnv = createMockEnv()
    storage = new TieredStorage(mockState, mockEnv, {
      hot: { maxItems: 100, maxAge: 60000 },
      warm: { maxItems: 1000, maxAge: 300000 },
      cold: { backend: 'r2' },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('promotes cold data to hot on access', async () => {
    // Store in cold tier
    await storage.set('cold:promoted', { data: 'will be promoted' }, { tier: 'cold' })
    expect(await storage.getCurrentTier('cold:promoted')).toBe('cold')

    // Access the data (should trigger promotion)
    const value = await storage.get('cold:promoted')
    expect(value).toEqual({ data: 'will be promoted' })

    // Should now be in hot tier
    const tier = await storage.getCurrentTier('cold:promoted')
    expect(tier).toBe('hot')
  })

  it('promotes warm data to hot on access', async () => {
    // Store in warm tier
    await storage.set('warm:promoted', { data: 'will be promoted' }, { tier: 'warm' })
    expect(await storage.getCurrentTier('warm:promoted')).toBe('warm')

    // Access the data
    await storage.get('warm:promoted')

    // Should now be in hot tier
    const tier = await storage.getCurrentTier('warm:promoted')
    expect(tier).toBe('hot')
  })

  it('can manually promote data to hot tier', async () => {
    // Store in cold tier
    await storage.set('manual:promote', { data: 'manual promotion' }, { tier: 'cold' })

    // Manually promote
    await storage.promoteToHot('manual:promote')

    // Should be in hot tier
    const tier = await storage.getCurrentTier('manual:promote')
    expect(tier).toBe('hot')
  })

  it('records promotion timestamp in stats', async () => {
    await storage.set('stats:promote', { data: 'track promotion' }, { tier: 'cold' })

    const beforePromotion = Date.now()
    await storage.promoteToHot('stats:promote')

    const stats = storage.getAccessStats('stats:promote')
    expect(stats!.promotedAt).toBeGreaterThanOrEqual(beforePromotion)
  })
})

// ============================================================================
// TEST SUITE: Automatic Demotion
// ============================================================================

describe('Automatic Demotion', () => {
  let mockState: ReturnType<typeof createMockState>
  let mockEnv: ReturnType<typeof createMockEnv>
  let storage: TieredStorage

  beforeEach(() => {
    vi.useFakeTimers()
    mockState = createMockState()
    mockEnv = createMockEnv()
    storage = new TieredStorage(mockState, mockEnv, {
      hot: { maxItems: 10, maxAge: 30000 },  // 30 seconds
      warm: { maxItems: 100, maxAge: 60000 },  // 1 minute
      cold: { backend: 'r2' },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('demotes hot data to warm after maxAge', async () => {
    await storage.set('demote:hot', { data: 'will be demoted' })
    expect(await storage.getCurrentTier('demote:hot')).toBe('hot')

    // Wait past hot maxAge
    vi.advanceTimersByTime(40000)
    await storage.runMaintenance()

    // Should be in warm tier
    const tier = await storage.getCurrentTier('demote:hot')
    expect(tier).toBe('warm')
  })

  it('demotes warm data to cold after maxAge', async () => {
    await storage.set('demote:warm', { data: 'will go cold' }, { tier: 'warm' })

    // Wait past warm maxAge
    vi.advanceTimersByTime(70000)
    await storage.runMaintenance()

    // Should be in cold tier
    const tier = await storage.getCurrentTier('demote:warm')
    expect(tier).toBe('cold')
  })

  it('can manually demote data to cold tier', async () => {
    await storage.set('manual:demote', { data: 'manual demotion' })
    expect(await storage.getCurrentTier('manual:demote')).toBe('hot')

    await storage.demoteToCold('manual:demote')

    const tier = await storage.getCurrentTier('manual:demote')
    expect(tier).toBe('cold')
  })

  it('records demotion timestamp in stats', async () => {
    await storage.set('stats:demote', { data: 'track demotion' })

    const beforeDemotion = Date.now()
    await storage.demoteToCold('stats:demote')

    const stats = storage.getAccessStats('stats:demote')
    expect(stats!.demotedAt).toBeGreaterThanOrEqual(beforeDemotion)
  })
})

// ============================================================================
// TEST SUITE: Unified API
// ============================================================================

describe('Unified API', () => {
  let mockState: ReturnType<typeof createMockState>
  let mockEnv: ReturnType<typeof createMockEnv>
  let storage: TieredStorage

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    storage = new TieredStorage(mockState, mockEnv)
  })

  it('get() works regardless of current tier', async () => {
    // Store in different tiers
    await storage.set('hot:key', { tier: 'hot' })
    await storage.set('warm:key', { tier: 'warm' }, { tier: 'warm' })
    await storage.set('cold:key', { tier: 'cold' }, { tier: 'cold' })

    // All should be retrievable with same API
    expect(await storage.get('hot:key')).toEqual({ tier: 'hot' })
    expect(await storage.get('warm:key')).toEqual({ tier: 'warm' })
    expect(await storage.get('cold:key')).toEqual({ tier: 'cold' })
  })

  it('set() works regardless of target tier', async () => {
    // Set to different tiers
    await storage.set('a', { value: 1 })  // default hot
    await storage.set('b', { value: 2 }, { tier: 'warm' })
    await storage.set('c', { value: 3 }, { tier: 'cold' })

    // All should be retrievable
    expect(await storage.get('a')).toEqual({ value: 1 })
    expect(await storage.get('b')).toEqual({ value: 2 })
    expect(await storage.get('c')).toEqual({ value: 3 })
  })

  it('delete() works regardless of current tier', async () => {
    // Store in different tiers
    await storage.set('del:hot', { data: 'hot' })
    await storage.set('del:warm', { data: 'warm' }, { tier: 'warm' })
    await storage.set('del:cold', { data: 'cold' }, { tier: 'cold' })

    // Delete all
    await storage.delete('del:hot')
    await storage.delete('del:warm')
    await storage.delete('del:cold')

    // All should be gone
    expect(await storage.get('del:hot')).toBeUndefined()
    expect(await storage.get('del:warm')).toBeUndefined()
    expect(await storage.get('del:cold')).toBeUndefined()
    expect(await storage.getCurrentTier('del:hot')).toBeNull()
    expect(await storage.getCurrentTier('del:warm')).toBeNull()
    expect(await storage.getCurrentTier('del:cold')).toBeNull()
  })

  it('has() works regardless of current tier', async () => {
    await storage.set('has:hot', { data: 'hot' })
    await storage.set('has:warm', { data: 'warm' }, { tier: 'warm' })
    await storage.set('has:cold', { data: 'cold' }, { tier: 'cold' })

    expect(await storage.has('has:hot')).toBe(true)
    expect(await storage.has('has:warm')).toBe(true)
    expect(await storage.has('has:cold')).toBe(true)
    expect(await storage.has('has:missing')).toBe(false)
  })
})

// ============================================================================
// TEST SUITE: Data Integrity
// ============================================================================

describe('Data Integrity', () => {
  let mockState: ReturnType<typeof createMockState>
  let mockEnv: ReturnType<typeof createMockEnv>
  let storage: TieredStorage

  beforeEach(() => {
    vi.useFakeTimers()
    mockState = createMockState()
    mockEnv = createMockEnv()
    storage = new TieredStorage(mockState, mockEnv, {
      hot: { maxItems: 5, maxAge: 10000 },
      warm: { maxItems: 10, maxAge: 20000 },
      cold: { backend: 'r2' },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('no data loss during hot to warm migration', async () => {
    const originalData = {
      complex: { nested: { value: 42 } },
      array: [1, 2, 3],
      string: 'test data',
    }

    await storage.set('migrate:hw', originalData)

    // Force demotion
    vi.advanceTimersByTime(15000)
    await storage.runMaintenance()

    // Verify tier changed
    expect(await storage.getCurrentTier('migrate:hw')).toBe('warm')

    // Verify data integrity
    const retrieved = await storage.get('migrate:hw')
    expect(retrieved).toEqual(originalData)
  })

  it('no data loss during warm to cold migration', async () => {
    const originalData = {
      id: 'unique-123',
      metadata: { created: Date.now(), tags: ['important', 'archive'] },
      content: 'This is important archived content',
    }

    await storage.set('migrate:wc', originalData, { tier: 'warm' })

    // Force demotion to cold
    vi.advanceTimersByTime(25000)
    await storage.runMaintenance()

    // Verify tier changed
    expect(await storage.getCurrentTier('migrate:wc')).toBe('cold')

    // Verify data integrity
    const retrieved = await storage.get('migrate:wc')
    expect(retrieved).toEqual(originalData)
  })

  it('no data loss during cold to hot promotion', async () => {
    const originalData = {
      deepNesting: { level1: { level2: { level3: { value: 'deep' } } } },
      largeArray: Array.from({ length: 100 }, (_, i) => i),
    }

    await storage.set('promote:ch', originalData, { tier: 'cold' })

    // Access to trigger promotion
    const retrieved = await storage.get('promote:ch')

    // Verify promotion
    expect(await storage.getCurrentTier('promote:ch')).toBe('hot')

    // Verify data integrity
    expect(retrieved).toEqual(originalData)
  })

  it('handles concurrent migrations safely', async () => {
    // Store multiple items
    for (let i = 0; i < 10; i++) {
      await storage.set(`concurrent:${i}`, { index: i, data: `data-${i}` })
    }

    // Trigger maintenance while accessing some items
    const accessPromises = [
      storage.get('concurrent:0'),
      storage.get('concurrent:5'),
      storage.get('concurrent:9'),
    ]

    vi.advanceTimersByTime(15000)

    const maintenancePromise = storage.runMaintenance()

    // Wait for all operations
    const [v0, v5, v9] = await Promise.all(accessPromises)
    await maintenancePromise

    // Verify no data loss
    expect(v0).toEqual({ index: 0, data: 'data-0' })
    expect(v5).toEqual({ index: 5, data: 'data-5' })
    expect(v9).toEqual({ index: 9, data: 'data-9' })

    // All items should still be accessible
    for (let i = 0; i < 10; i++) {
      const value = await storage.get(`concurrent:${i}`)
      expect(value).toEqual({ index: i, data: `data-${i}` })
    }
  })
})

// ============================================================================
// TEST SUITE: Latency Expectations
// ============================================================================

describe('Latency Expectations', () => {
  let mockState: ReturnType<typeof createMockState>
  let mockEnv: ReturnType<typeof createMockEnv>
  let storage: TieredStorage

  beforeEach(() => {
    // Use real timers for latency tests
    vi.useRealTimers()
    mockState = createMockState()
    mockEnv = createMockEnv()
    storage = new TieredStorage(mockState, mockEnv)
  })

  it('hot tier access is fast (< 10ms)', async () => {
    await storage.set('hot:latency', { data: 'hot data' })

    const start = performance.now()
    await storage.get('hot:latency')
    const duration = performance.now() - start

    // Hot tier should be very fast (in-memory)
    expect(duration).toBeLessThan(10)
  })

  it('warm tier access is reasonable (< 50ms)', async () => {
    await storage.set('warm:latency', { data: 'warm data' }, { tier: 'warm' })

    const start = performance.now()
    await storage.get('warm:latency')
    const duration = performance.now() - start

    // Warm tier (SQLite) should be reasonably fast
    expect(duration).toBeLessThan(50)
  })

  it('cold tier access is acceptable (< 500ms)', async () => {
    await storage.set('cold:latency', { data: 'cold data' }, { tier: 'cold' })

    const start = performance.now()
    await storage.get('cold:latency')
    const duration = performance.now() - start

    // Cold tier (R2) can be slower but should still be reasonable
    // Note: In mock tests this will be fast, but the test structure is correct
    expect(duration).toBeLessThan(500)
  })

  it('provides tier-specific latency metrics', async () => {
    // Store in different tiers
    await storage.set('metrics:hot', { data: 'hot' })
    await storage.set('metrics:warm', { data: 'warm' }, { tier: 'warm' })
    await storage.set('metrics:cold', { data: 'cold' }, { tier: 'cold' })

    // Access each tier multiple times
    for (let i = 0; i < 5; i++) {
      await storage.get('metrics:hot')
      await storage.get('metrics:warm')
      await storage.get('metrics:cold')
    }

    // Get latency metrics
    const metrics = await storage.getLatencyMetrics()

    expect(metrics.hot.avgMs).toBeDefined()
    expect(metrics.warm.avgMs).toBeDefined()
    expect(metrics.cold.avgMs).toBeDefined()

    // Hot should be fastest on average
    expect(metrics.hot.avgMs).toBeLessThanOrEqual(metrics.warm.avgMs)
    expect(metrics.warm.avgMs).toBeLessThanOrEqual(metrics.cold.avgMs)
  })
})

// ============================================================================
// TEST SUITE: Configuration and Customization
// ============================================================================

describe('Configuration', () => {
  let mockState: ReturnType<typeof createMockState>
  let mockEnv: ReturnType<typeof createMockEnv>

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
  })

  it('uses default configuration when none provided', async () => {
    const storage = new TieredStorage(mockState, mockEnv)

    // Should have sensible defaults
    await storage.set('default:config', { data: 'test' })
    expect(await storage.getCurrentTier('default:config')).toBe('hot')
  })

  it('respects custom tier configuration', async () => {
    const customConfig: TierConfig = {
      hot: { maxItems: 50, maxAge: 30000 },
      warm: { maxItems: 500, maxAge: 180000 },
      cold: { backend: 'r2' },
    }

    const storage = new TieredStorage(mockState, mockEnv, customConfig)
    const config = storage.getConfig()

    expect(config.hot.maxItems).toBe(50)
    expect(config.hot.maxAge).toBe(30000)
    expect(config.warm.maxItems).toBe(500)
    expect(config.warm.maxAge).toBe(180000)
    expect(config.cold.backend).toBe('r2')
  })

  it('allows runtime configuration updates', async () => {
    const storage = new TieredStorage(mockState, mockEnv)

    // Update hot tier config
    await storage.updateConfig({
      hot: { maxItems: 25, maxAge: 15000 },
    })

    const config = storage.getConfig()
    expect(config.hot.maxItems).toBe(25)
    expect(config.hot.maxAge).toBe(15000)
  })
})

// ============================================================================
// TEST SUITE: Error Handling
// ============================================================================

describe('Error Handling', () => {
  let mockState: ReturnType<typeof createMockState>
  let mockEnv: ReturnType<typeof createMockEnv>
  let storage: TieredStorage

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    storage = new TieredStorage(mockState, mockEnv)
  })

  it('throws TierNotFoundError for promotion of non-existent key', async () => {
    await expect(storage.promoteToHot('non-existent')).rejects.toThrow(TierNotFoundError)
  })

  it('throws TierNotFoundError for demotion of non-existent key', async () => {
    await expect(storage.demoteToCold('non-existent')).rejects.toThrow(TierNotFoundError)
  })

  it('handles R2 storage failures gracefully', async () => {
    // Make R2 fail
    mockEnv.R2_COLD_STORAGE.put = vi.fn().mockRejectedValue(new Error('R2 unavailable'))

    // Attempting to store in cold tier should propagate error
    await expect(
      storage.set('failing:key', { data: 'test' }, { tier: 'cold' })
    ).rejects.toThrow('R2 unavailable')
  })

  it('handles SQLite storage failures gracefully', async () => {
    // Make SQLite fail
    mockState.storage.put = vi.fn().mockRejectedValue(new Error('SQLite unavailable'))

    // Attempting to store in warm tier should propagate error
    await expect(
      storage.set('failing:key', { data: 'test' }, { tier: 'warm' })
    ).rejects.toThrow('SQLite unavailable')
  })

  it('maintains consistency after failed migration', async () => {
    // Store data in hot tier
    await storage.set('migrate:fail', { data: 'original' })

    // Make R2 fail for cold storage
    mockEnv.R2_COLD_STORAGE.put = vi.fn().mockRejectedValue(new Error('R2 unavailable'))

    // Attempt demotion should fail
    await expect(storage.demoteToCold('migrate:fail')).rejects.toThrow(MigrationError)

    // Data should still be in original tier
    expect(await storage.getCurrentTier('migrate:fail')).toBe('hot')
    expect(await storage.get('migrate:fail')).toEqual({ data: 'original' })
  })
})
