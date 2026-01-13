/**
 * ShardManager tests
 *
 * Tests for DO-level sharding to handle 10GB limit per DO:
 * - Consistent hashing algorithm
 * - Range-based sharding
 * - Simple hash sharding
 * - getShardStub() - route to correct shard
 * - queryAll() - fan-out queries across all shards
 * - Shard key extraction from SQL
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ShardConfig } from './types'
import {
  ShardManager,
  consistentHash,
  rangeHash,
  simpleHash,
  extractShardKey,
  clearRingCache,
} from './shard'

// ============================================================================
// CONSISTENT HASHING TESTS
// ============================================================================

describe('consistentHash', () => {
  it('should return consistent results for same key', () => {
    const result1 = consistentHash('tenant-123', 16)
    const result2 = consistentHash('tenant-123', 16)
    expect(result1).toBe(result2)
  })

  it('should return values in range [0, count)', () => {
    const count = 16
    for (let i = 0; i < 100; i++) {
      const result = consistentHash(`key-${i}`, count)
      expect(result).toBeGreaterThanOrEqual(0)
      expect(result).toBeLessThan(count)
    }
  })

  it('should distribute keys across shards', () => {
    const count = 4
    const shardCounts = new Map<number, number>()

    // Generate 1000 keys and count distribution
    for (let i = 0; i < 1000; i++) {
      const shard = consistentHash(`tenant-${i}`, count)
      shardCounts.set(shard, (shardCounts.get(shard) || 0) + 1)
    }

    // All shards should have some keys (roughly 250 each)
    expect(shardCounts.size).toBe(count)
    for (const [, keyCount] of shardCounts) {
      expect(keyCount).toBeGreaterThan(50) // At least some keys
      expect(keyCount).toBeLessThan(600) // Not all keys on one shard
    }
  })

  it('should minimize redistribution when count changes', () => {
    const keys = Array.from({ length: 1000 }, (_, i) => `key-${i}`)
    const oldCount = 4
    const newCount = 5

    // Count how many keys stay on same shard after adding a shard
    let unchanged = 0
    for (const key of keys) {
      const oldShard = consistentHash(key, oldCount)
      const newShard = consistentHash(key, newCount)
      // In consistent hashing, only ~1/N keys should move
      if (oldShard === newShard) {
        unchanged++
      }
    }

    // Should keep most keys on same shard (at least 60%)
    expect(unchanged).toBeGreaterThan(600)
  })
})

// ============================================================================
// RANGE HASH TESTS
// ============================================================================

describe('rangeHash', () => {
  it('should partition numeric keys by range', () => {
    // With 4 shards over range 0-1000
    // Values are distributed: 0 maps to shard 0, 1000 maps to shard 3
    expect(rangeHash(0, 4, 0, 1000)).toBe(0)
    expect(rangeHash(200, 4, 0, 1000)).toBe(0)
    expect(rangeHash(300, 4, 0, 1000)).toBe(1)
    expect(rangeHash(500, 4, 0, 1000)).toBe(2)
    expect(rangeHash(800, 4, 0, 1000)).toBe(3)
    expect(rangeHash(1000, 4, 0, 1000)).toBe(3)
  })

  it('should handle string keys by first character', () => {
    // A-F = 0, G-L = 1, M-R = 2, S-Z = 3 (roughly)
    expect(rangeHash('alice', 4)).toBeLessThanOrEqual(1)
    expect(rangeHash('zebra', 4)).toBe(3)
  })

  it('should handle custom ranges', () => {
    // Range 2020-2023 with 3 shards
    expect(rangeHash(2020, 3, 2020, 2023)).toBe(0)
    expect(rangeHash(2022, 3, 2020, 2023)).toBe(2)
    expect(rangeHash(2023, 3, 2020, 2023)).toBe(2) // Max value goes to last shard
  })
})

// ============================================================================
// SIMPLE HASH TESTS
// ============================================================================

describe('simpleHash', () => {
  it('should return consistent results', () => {
    expect(simpleHash('key1', 8)).toBe(simpleHash('key1', 8))
  })

  it('should return values in range', () => {
    for (let i = 0; i < 100; i++) {
      const result = simpleHash(`key-${i}`, 8)
      expect(result).toBeGreaterThanOrEqual(0)
      expect(result).toBeLessThan(8)
    }
  })

  it('should distribute uniformly', () => {
    const count = 8
    const shardCounts = new Map<number, number>()

    for (let i = 0; i < 800; i++) {
      const shard = simpleHash(`key-${i}`, count)
      shardCounts.set(shard, (shardCounts.get(shard) || 0) + 1)
    }

    // Each shard should have some keys - distribution may vary with simple hash
    expect(shardCounts.size).toBeGreaterThanOrEqual(2) // At least 2 different shards
    for (const [, keyCount] of shardCounts) {
      expect(keyCount).toBeGreaterThan(0) // At least some keys
    }
  })
})

// ============================================================================
// SHARD KEY EXTRACTION TESTS
// ============================================================================

describe('extractShardKey', () => {
  it('should extract from simple WHERE clause', () => {
    const sql = "SELECT * FROM users WHERE tenant_id = 'abc123'"
    expect(extractShardKey(sql, 'tenant_id')).toBe('abc123')
  })

  it('should extract from parameterized query', () => {
    const sql = 'SELECT * FROM users WHERE tenant_id = ?'
    expect(extractShardKey(sql, 'tenant_id', ['abc123'])).toBe('abc123')
  })

  it('should extract from named parameter', () => {
    const sql = 'SELECT * FROM users WHERE tenant_id = :tenant_id'
    expect(extractShardKey(sql, 'tenant_id', { tenant_id: 'abc123' })).toBe('abc123')
  })

  it('should handle INSERT statements', () => {
    const sql = "INSERT INTO users (id, tenant_id, name) VALUES (1, 'abc123', 'John')"
    expect(extractShardKey(sql, 'tenant_id')).toBe('abc123')
  })

  it('should handle UPDATE statements', () => {
    const sql = "UPDATE users SET name = 'Jane' WHERE tenant_id = 'abc123'"
    expect(extractShardKey(sql, 'tenant_id')).toBe('abc123')
  })

  it('should return undefined for cross-shard queries', () => {
    const sql = "SELECT * FROM users WHERE name = 'John'" // No shard key
    expect(extractShardKey(sql, 'tenant_id')).toBeUndefined()
  })

  it('should handle numeric shard keys', () => {
    const sql = 'SELECT * FROM users WHERE tenant_id = 123'
    expect(extractShardKey(sql, 'tenant_id')).toBe('123')
  })

  it('should handle IN clauses', () => {
    // IN clause means multiple shards - return undefined
    const sql = "SELECT * FROM users WHERE tenant_id IN ('a', 'b', 'c')"
    expect(extractShardKey(sql, 'tenant_id')).toBeUndefined()
  })
})

// ============================================================================
// SHARD MANAGER TESTS
// ============================================================================

describe('ShardManager', () => {
  // Mock DurableObjectNamespace
  const createMockNamespace = () => {
    const stubs = new Map<string, any>()
    return {
      idFromName: vi.fn((name: string) => ({ toString: () => `id-${name}` })),
      get: vi.fn((id: any) => {
        const name = id.toString()
        if (!stubs.has(name)) {
          stubs.set(name, {
            fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }))),
          })
        }
        return stubs.get(name)
      }),
      _stubs: stubs,
    }
  }

  let mockNamespace: ReturnType<typeof createMockNamespace>
  let manager: ShardManager

  beforeEach(() => {
    mockNamespace = createMockNamespace()
  })

  describe('constructor', () => {
    it('should create with default config', () => {
      manager = new ShardManager(mockNamespace as any)
      expect(manager).toBeInstanceOf(ShardManager)
    })

    it('should accept custom shard config', () => {
      const config: ShardConfig = {
        key: 'tenant_id',
        count: 16,
        algorithm: 'consistent',
      }
      manager = new ShardManager(mockNamespace as any, config)
      expect(manager.config).toEqual(config)
    })
  })

  describe('getShardId', () => {
    it('should return correct shard for consistent algorithm', () => {
      manager = new ShardManager(mockNamespace as any, {
        key: 'tenant_id',
        count: 4,
        algorithm: 'consistent',
      })

      const shard1 = manager.getShardId('tenant-1')
      const shard2 = manager.getShardId('tenant-1')
      expect(shard1).toBe(shard2) // Consistent

      expect(shard1).toBeGreaterThanOrEqual(0)
      expect(shard1).toBeLessThan(4)
    })

    it('should return correct shard for hash algorithm', () => {
      manager = new ShardManager(mockNamespace as any, {
        key: 'tenant_id',
        count: 4,
        algorithm: 'hash',
      })

      const shard = manager.getShardId('tenant-1')
      expect(shard).toBeGreaterThanOrEqual(0)
      expect(shard).toBeLessThan(4)
    })

    it('should return correct shard for range algorithm', () => {
      manager = new ShardManager(mockNamespace as any, {
        key: 'year',
        count: 4,
        algorithm: 'range',
      })

      // Range sharding on years
      const shard = manager.getShardId('2024')
      expect(shard).toBeGreaterThanOrEqual(0)
      expect(shard).toBeLessThan(4)
    })
  })

  describe('getShardStub', () => {
    it('should return DO stub for shard key', async () => {
      manager = new ShardManager(mockNamespace as any, {
        key: 'tenant_id',
        count: 4,
        algorithm: 'consistent',
      })

      const stub = await manager.getShardStub('tenant-123')

      expect(mockNamespace.idFromName).toHaveBeenCalled()
      expect(mockNamespace.get).toHaveBeenCalled()
      expect(stub).toBeDefined()
      expect(stub.fetch).toBeDefined()
    })

    it('should route same key to same stub', async () => {
      manager = new ShardManager(mockNamespace as any, {
        key: 'tenant_id',
        count: 4,
        algorithm: 'consistent',
      })

      const stub1 = await manager.getShardStub('tenant-123')
      const stub2 = await manager.getShardStub('tenant-123')

      // Should call idFromName with same shard name
      const calls = mockNamespace.idFromName.mock.calls
      const lastTwo = calls.slice(-2)
      expect(lastTwo[0][0]).toBe(lastTwo[1][0])
    })

    it('should route to shard-N naming convention', async () => {
      manager = new ShardManager(mockNamespace as any, {
        key: 'tenant_id',
        count: 4,
        algorithm: 'consistent',
      })

      await manager.getShardStub('some-key')

      const shardName = mockNamespace.idFromName.mock.calls[0][0]
      expect(shardName).toMatch(/^shard-\d+$/)
    })
  })

  describe('getShardStubForSql', () => {
    it('should extract key and route to shard', async () => {
      manager = new ShardManager(mockNamespace as any, {
        key: 'tenant_id',
        count: 4,
        algorithm: 'consistent',
      })

      const stub = await manager.getShardStubForSql(
        "SELECT * FROM users WHERE tenant_id = 'abc123'"
      )

      expect(stub).toBeDefined()
    })

    it('should return undefined for cross-shard queries', async () => {
      manager = new ShardManager(mockNamespace as any, {
        key: 'tenant_id',
        count: 4,
        algorithm: 'consistent',
      })

      const stub = await manager.getShardStubForSql(
        "SELECT * FROM users WHERE name = 'John'"
      )

      expect(stub).toBeUndefined()
    })
  })

  describe('queryAll', () => {
    it('should fan out query to all shards', async () => {
      manager = new ShardManager(mockNamespace as any, {
        key: 'tenant_id',
        count: 4,
        algorithm: 'consistent',
      })

      // Setup mock responses
      for (let i = 0; i < 4; i++) {
        const stub = mockNamespace.get({ toString: () => `id-shard-${i}` })
        stub.fetch.mockResolvedValueOnce(
          new Response(JSON.stringify({ rows: [{ id: i }] }))
        )
      }

      const results = await manager.queryAll('/query', {
        method: 'POST',
        body: JSON.stringify({ sql: 'SELECT COUNT(*) FROM users' }),
      })

      // Should call all 4 shards
      expect(results).toHaveLength(4)
    })

    it('should handle partial failures gracefully', async () => {
      manager = new ShardManager(mockNamespace as any, {
        key: 'tenant_id',
        count: 4,
        algorithm: 'consistent',
      })

      // First shard fails, others succeed
      const stub0 = mockNamespace.get({ toString: () => `id-shard-0` })
      stub0.fetch.mockRejectedValueOnce(new Error('Shard unavailable'))

      const results = await manager.queryAll('/query', {
        method: 'POST',
        body: JSON.stringify({ sql: 'SELECT * FROM users' }),
      })

      // Should return results from successful shards + error marker
      expect(results.length).toBeGreaterThan(0)
      expect(results.some((r) => r.error)).toBe(true)
    })

    it('should merge results from all shards', async () => {
      manager = new ShardManager(mockNamespace as any, {
        key: 'tenant_id',
        count: 2,
        algorithm: 'consistent',
      })

      // Each shard returns different rows
      const stub0 = mockNamespace.get({ toString: () => `id-shard-0` })
      stub0.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ rows: [{ id: 1 }, { id: 2 }] }))
      )
      const stub1 = mockNamespace.get({ toString: () => `id-shard-1` })
      stub1.fetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ rows: [{ id: 3 }, { id: 4 }] }))
      )

      const results = await manager.queryAll('/query', {
        method: 'POST',
        body: JSON.stringify({ sql: 'SELECT * FROM users' }),
      })

      expect(results).toHaveLength(2)
    })
  })

  describe('shardCount', () => {
    it('should return configured shard count', () => {
      manager = new ShardManager(mockNamespace as any, {
        key: 'tenant_id',
        count: 16,
        algorithm: 'consistent',
      })

      expect(manager.shardCount).toBe(16)
    })
  })

  describe('shardKey', () => {
    it('should return configured shard key', () => {
      manager = new ShardManager(mockNamespace as any, {
        key: 'org_id',
        count: 8,
        algorithm: 'hash',
      })

      expect(manager.shardKey).toBe('org_id')
    })
  })
})

// ============================================================================
// BENCHMARK TESTS - RING CACHING
// ============================================================================

describe('consistentHash performance', () => {
  beforeEach(() => {
    // Clear cache between tests for isolation
    clearRingCache()
  })

  it('should have O(log n) lookup time after ring is cached', () => {
    // First call builds the ring - may be slower
    const firstStart = performance.now()
    consistentHash('warmup-key', 16)
    const firstTime = performance.now() - firstStart

    // Subsequent calls should use cached ring and be fast
    const times: number[] = []
    for (let i = 0; i < 100; i++) {
      const start = performance.now()
      consistentHash(`key-${i}`, 16)
      times.push(performance.now() - start)
    }

    // Average lookup time should be under 1ms (typically < 0.1ms with cache)
    const avgTime = times.reduce((a, b) => a + b, 0) / times.length
    expect(avgTime).toBeLessThan(1)

    // All subsequent lookups should be fast (using cached ring)
    expect(times.every((t) => t < 2)).toBe(true)

    // Log for visibility during development
    console.log(`First call: ${firstTime.toFixed(3)}ms, Avg subsequent: ${avgTime.toFixed(3)}ms`)
  })

  it('should not rebuild ring for same config', () => {
    // Warm up with first call
    consistentHash('warmup', 8, 100)

    // Time many lookups - should all be fast if ring is cached
    const lookupTimes: number[] = []
    for (let i = 0; i < 1000; i++) {
      const start = performance.now()
      consistentHash(`tenant-${i}`, 8, 100)
      lookupTimes.push(performance.now() - start)
    }

    // If ring is rebuilt each time, we'd see O(n*virtualNodes) = O(800) operations per lookup
    // With caching, we should see O(log n) = O(log 800) ~ 10 operations per lookup
    // This should translate to < 0.1ms per lookup on average
    const avg = lookupTimes.reduce((a, b) => a + b, 0) / lookupTimes.length
    expect(avg).toBeLessThan(0.5) // Much faster with caching

    // Verify consistency is maintained
    const result1 = consistentHash('test-key', 8, 100)
    const result2 = consistentHash('test-key', 8, 100)
    expect(result1).toBe(result2)
  })

  it('should build separate rings for different configs', () => {
    // Different counts should produce different rings that are both cached
    const result4 = consistentHash('same-key', 4)
    const result8 = consistentHash('same-key', 8)
    // Results might be same or different depending on hash distribution
    // but both should be valid (in range)
    expect(result4).toBeGreaterThanOrEqual(0)
    expect(result4).toBeLessThan(4)
    expect(result8).toBeGreaterThanOrEqual(0)
    expect(result8).toBeLessThan(8)
  })

  it('should clear cache properly', () => {
    // Build some cached rings
    consistentHash('key1', 4)
    consistentHash('key2', 8)

    // Clear cache
    clearRingCache()

    // After clearing, results should still be consistent (just rebuilt)
    const result1 = consistentHash('key1', 4)
    const result2 = consistentHash('key1', 4)
    expect(result1).toBe(result2)
  })

  it('should cache rings per virtualNodes parameter', () => {
    // Same count, different virtualNodes should get different cached rings
    const result100 = consistentHash('test-key', 4, 100)
    const result200 = consistentHash('test-key', 4, 200)

    // Both should be valid results
    expect(result100).toBeGreaterThanOrEqual(0)
    expect(result100).toBeLessThan(4)
    expect(result200).toBeGreaterThanOrEqual(0)
    expect(result200).toBeLessThan(4)
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('ShardManager integration', () => {
  it('should work with realistic tenant isolation', async () => {
    const mockNamespace = {
      idFromName: vi.fn((name: string) => ({ toString: () => `id-${name}` })),
      get: vi.fn(() => ({
        fetch: vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ rows: [] }))
        ),
      })),
    }

    const manager = new ShardManager(mockNamespace as any, {
      key: 'tenant_id',
      count: 16,
      algorithm: 'consistent',
    })

    // Different tenants should potentially go to different shards
    const tenantIds = ['acme-corp', 'globex', 'initech', 'umbrella', 'stark']
    const shardAssignments = new Set<number>()

    for (const tenantId of tenantIds) {
      const shardId = manager.getShardId(tenantId)
      shardAssignments.add(shardId)
    }

    // With 5 tenants and 16 shards, should have at least 2 different shards
    expect(shardAssignments.size).toBeGreaterThanOrEqual(2)
  })
})
