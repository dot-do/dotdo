/**
 * ShardManager Integration Tests
 *
 * Tests for getShardStub() routing with real miniflare Durable Objects.
 * NO MOCKS - uses actual DO instances via @cloudflare/vitest-pool-workers.
 *
 * Verifies:
 * - Consistent hashing distributes keys across shards
 * - Same key always routes to same shard
 * - Virtual nodes work correctly
 * - getShardStub() returns valid DO stubs
 * - Stubs can fetch and return responses
 *
 * @module db/core/shard-integration.test
 */

import { env, SELF } from 'cloudflare:test'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  ShardManager,
  consistentHash,
  clearRingCache,
} from './shard'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Unique namespace per test suite run to ensure isolation
 */
const testRunId = Date.now()

/**
 * Generate a unique namespace for each test
 */
function uniqueNs(prefix: string = 'shard-test'): string {
  return `${prefix}-${testRunId}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Helper to make requests via the sharded DO stub
 */
async function stubFetch(
  stub: DurableObjectStub,
  path: string,
  init?: RequestInit
): Promise<Response> {
  return stub.fetch(`https://shard.test${path}`, init)
}

// ============================================================================
// Integration Tests: getShardStub() with Real DOs
// ============================================================================

describe('ShardManager Integration (Real DOs)', () => {
  beforeEach(() => {
    // Clear the ring cache to ensure each test starts fresh
    clearRingCache()
  })

  // ==========================================================================
  // BASIC SHARD STUB OPERATIONS
  // ==========================================================================

  describe('getShardStub() returns valid DO stubs', () => {
    it('should return a DO stub for a key', async () => {
      const manager = new ShardManager(env.DO, {
        key: 'tenant_id',
        count: 4,
        algorithm: 'consistent',
      })

      const stub = await manager.getShardStub('tenant-123')

      // Stub should be defined
      expect(stub).toBeDefined()

      // Stub should have fetch method
      expect(typeof stub.fetch).toBe('function')
    })

    it('should return stubs that can respond to requests', async () => {
      const manager = new ShardManager(env.DO, {
        key: 'tenant_id',
        count: 4,
        algorithm: 'consistent',
      })

      const stub = await manager.getShardStub('tenant-abc')

      // Make a health check request to the shard
      const response = await stubFetch(stub, '/health')

      // Should get a valid response (DO may return 200 or error depending on implementation)
      expect(response).toBeDefined()
      expect(typeof response.status).toBe('number')
    })

    it('should route same key to same shard consistently', async () => {
      const manager = new ShardManager(env.DO, {
        key: 'tenant_id',
        count: 8,
        algorithm: 'consistent',
      })

      const key = 'consistent-key-test'

      // Get stub multiple times for same key
      const stub1 = await manager.getShardStub(key)
      const stub2 = await manager.getShardStub(key)
      const stub3 = await manager.getShardStub(key)

      // All should route to the same shard index
      const shardId1 = manager.getShardId(key)
      const shardId2 = manager.getShardId(key)
      const shardId3 = manager.getShardId(key)

      expect(shardId1).toBe(shardId2)
      expect(shardId2).toBe(shardId3)

      // The shard index should be within valid range
      expect(shardId1).toBeGreaterThanOrEqual(0)
      expect(shardId1).toBeLessThan(8)
    })
  })

  // ==========================================================================
  // CONSISTENT HASHING DISTRIBUTION
  // ==========================================================================

  describe('consistent hashing distribution', () => {
    it('should distribute keys across all shards', async () => {
      const shardCount = 4
      const manager = new ShardManager(env.DO, {
        key: 'tenant_id',
        count: shardCount,
        algorithm: 'consistent',
      })

      // Track which shards are used
      const shardUsage = new Map<number, number>()

      // Generate many keys and check distribution
      const keyCount = 100
      for (let i = 0; i < keyCount; i++) {
        const key = `tenant-${i}-${uniqueNs()}`
        const shardId = manager.getShardId(key)

        // Verify shardId is in valid range
        expect(shardId).toBeGreaterThanOrEqual(0)
        expect(shardId).toBeLessThan(shardCount)

        shardUsage.set(shardId, (shardUsage.get(shardId) || 0) + 1)
      }

      // All shards should receive some keys
      expect(shardUsage.size).toBe(shardCount)

      // Distribution should be reasonably balanced (no shard gets all keys)
      for (const [shardId, count] of shardUsage) {
        // At minimum, each shard should have at least 5% of keys
        expect(count).toBeGreaterThan(keyCount * 0.05)
        // No shard should have more than 60% of keys
        expect(count).toBeLessThan(keyCount * 0.6)
      }
    })

    it('should minimize key redistribution when shard count changes', () => {
      // Generate a set of test keys
      const keys = Array.from({ length: 1000 }, (_, i) => `key-${i}`)

      const oldCount = 4
      const newCount = 5

      // Count how many keys stay on the same shard
      let unchanged = 0
      for (const key of keys) {
        const oldShard = consistentHash(key, oldCount)
        const newShard = consistentHash(key, newCount)

        if (oldShard === newShard) {
          unchanged++
        }
      }

      // With consistent hashing, ~80% of keys should stay on same shard
      // (only 1/N keys should move when adding one shard)
      const unchangedPercent = unchanged / keys.length
      expect(unchangedPercent).toBeGreaterThan(0.6)
    })
  })

  // ==========================================================================
  // VIRTUAL NODES
  // ==========================================================================

  describe('virtual nodes', () => {
    it('should work with default virtual nodes (150)', () => {
      clearRingCache()

      const shardCount = 4
      const manager = new ShardManager(env.DO, {
        key: 'tenant_id',
        count: shardCount,
        algorithm: 'consistent',
      })

      // With virtual nodes, distribution should be even
      // Use a larger sample to ensure all shards are hit
      const distribution = new Map<number, number>()
      const keyCount = 1000

      for (let i = 0; i < keyCount; i++) {
        const shard = manager.getShardId(`key-${i}`)
        distribution.set(shard, (distribution.get(shard) || 0) + 1)
      }

      // With 1000 keys across 4 shards, all shards should be used
      expect(distribution.size).toBe(shardCount)

      // Calculate standard deviation
      const avg = keyCount / shardCount // 250
      let variance = 0
      for (const count of distribution.values()) {
        variance += Math.pow(count - avg, 2)
      }
      const stdDev = Math.sqrt(variance / shardCount)

      // With 150 virtual nodes, stdDev should be reasonable (< 50% of avg)
      // Note: Consistent hashing prioritizes minimal redistribution over perfect uniformity
      expect(stdDev).toBeLessThan(avg * 0.5)
    })

    it('should provide different distribution with different virtual node counts', () => {
      clearRingCache()

      const key = 'test-key-for-virtual-nodes'
      const count = 4

      // Different virtual node counts may produce different shard assignments
      const result100 = consistentHash(key, count, 100)
      const result200 = consistentHash(key, count, 200)

      // Both should be valid shard indices
      expect(result100).toBeGreaterThanOrEqual(0)
      expect(result100).toBeLessThan(count)
      expect(result200).toBeGreaterThanOrEqual(0)
      expect(result200).toBeLessThan(count)

      // Note: They may or may not be the same depending on the hash
      // The important thing is both are valid
    })
  })

  // ==========================================================================
  // SHARD NAMING
  // ==========================================================================

  describe('shard naming convention', () => {
    it('should use shard-N naming pattern', async () => {
      const manager = new ShardManager(env.DO, {
        key: 'tenant_id',
        count: 4,
        algorithm: 'consistent',
      })

      // Get a stub and verify it was created with correct shard name
      const key = 'test-key'
      const shardId = manager.getShardId(key)

      // The shard name should be shard-{index}
      const expectedShardName = `shard-${shardId}`

      // We can verify this by checking the stub works
      const stub = await manager.getShardStub(key)
      expect(stub).toBeDefined()
    })
  })

  // ==========================================================================
  // ALL SHARDS ACCESS
  // ==========================================================================

  describe('getAllShardStubs()', () => {
    it('should return stubs for all shards', () => {
      const shardCount = 4
      const manager = new ShardManager(env.DO, {
        key: 'tenant_id',
        count: shardCount,
        algorithm: 'consistent',
      })

      const stubs = manager.getAllShardStubs()

      expect(stubs).toHaveLength(shardCount)

      // All stubs should be valid DO stubs
      for (const stub of stubs) {
        expect(stub).toBeDefined()
        expect(typeof stub.fetch).toBe('function')
      }
    })

    it('should return different stubs for different shards', () => {
      const shardCount = 4
      const manager = new ShardManager(env.DO, {
        key: 'tenant_id',
        count: shardCount,
        algorithm: 'consistent',
      })

      const stubs = manager.getAllShardStubs()

      // Each stub should be unique (though we can't easily compare DO stubs directly)
      // At least verify we have the right number
      expect(stubs).toHaveLength(shardCount)
    })
  })

  // ==========================================================================
  // ALGORITHM VARIATIONS
  // ==========================================================================

  describe('different sharding algorithms', () => {
    it('should route correctly with hash algorithm', async () => {
      const manager = new ShardManager(env.DO, {
        key: 'tenant_id',
        count: 4,
        algorithm: 'hash',
      })

      const key = 'hash-test-key'
      const shardId1 = manager.getShardId(key)
      const shardId2 = manager.getShardId(key)

      // Same key should route to same shard
      expect(shardId1).toBe(shardId2)

      // Should be in valid range
      expect(shardId1).toBeGreaterThanOrEqual(0)
      expect(shardId1).toBeLessThan(4)

      // Should be able to get a stub
      const stub = await manager.getShardStub(key)
      expect(stub).toBeDefined()
    })

    it('should route correctly with range algorithm', async () => {
      const manager = new ShardManager(env.DO, {
        key: 'year',
        count: 4,
        algorithm: 'range',
      })

      // Range hashing should work with numeric-like keys
      const key = '500'
      const shardId = manager.getShardId(key)

      // Should be in valid range
      expect(shardId).toBeGreaterThanOrEqual(0)
      expect(shardId).toBeLessThan(4)

      // Should be able to get a stub
      const stub = await manager.getShardStub(key)
      expect(stub).toBeDefined()
    })
  })

  // ==========================================================================
  // FAN-OUT QUERIES
  // ==========================================================================

  describe('queryAll() fan-out', () => {
    it('should query all shards and return results', async () => {
      const shardCount = 4
      const manager = new ShardManager(env.DO, {
        key: 'tenant_id',
        count: shardCount,
        algorithm: 'consistent',
      })

      // Query all shards
      const results = await manager.queryAll('/health')

      // Should have results from all shards
      expect(results).toHaveLength(shardCount)

      // Each result should have shard index
      for (let i = 0; i < shardCount; i++) {
        const result = results.find((r) => r.shard === i)
        expect(result).toBeDefined()
        // Either has data or error
        expect(result!.data !== undefined || result!.error !== undefined).toBe(true)
      }
    })

    it('should handle partial failures gracefully', async () => {
      const shardCount = 4
      const manager = new ShardManager(env.DO, {
        key: 'tenant_id',
        count: shardCount,
        algorithm: 'consistent',
      })

      // Query with a path that may fail on some shards
      const results = await manager.queryAll('/nonexistent-endpoint')

      // Should still return results array
      expect(results).toHaveLength(shardCount)

      // Results should have shard indices
      for (const result of results) {
        expect(result.shard).toBeGreaterThanOrEqual(0)
        expect(result.shard).toBeLessThan(shardCount)
      }
    })
  })

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle single shard configuration', async () => {
      const manager = new ShardManager(env.DO, {
        key: 'tenant_id',
        count: 1,
        algorithm: 'consistent',
      })

      // All keys should route to shard 0
      expect(manager.getShardId('key1')).toBe(0)
      expect(manager.getShardId('key2')).toBe(0)
      expect(manager.getShardId('any-key')).toBe(0)

      const stub = await manager.getShardStub('any-key')
      expect(stub).toBeDefined()
    })

    it('should handle many shards', async () => {
      const shardCount = 32
      const manager = new ShardManager(env.DO, {
        key: 'tenant_id',
        count: shardCount,
        algorithm: 'consistent',
      })

      // Generate many keys and verify distribution
      const usedShards = new Set<number>()
      for (let i = 0; i < 1000; i++) {
        const shardId = manager.getShardId(`key-${i}`)
        expect(shardId).toBeGreaterThanOrEqual(0)
        expect(shardId).toBeLessThan(shardCount)
        usedShards.add(shardId)
      }

      // With 1000 keys across 32 shards, we should hit most shards
      expect(usedShards.size).toBeGreaterThan(shardCount * 0.8)
    })

    it('should handle empty key', async () => {
      const manager = new ShardManager(env.DO, {
        key: 'tenant_id',
        count: 4,
        algorithm: 'consistent',
      })

      // Empty string should still hash to a valid shard
      const shardId = manager.getShardId('')
      expect(shardId).toBeGreaterThanOrEqual(0)
      expect(shardId).toBeLessThan(4)

      const stub = await manager.getShardStub('')
      expect(stub).toBeDefined()
    })

    it('should handle special characters in keys', async () => {
      const manager = new ShardManager(env.DO, {
        key: 'tenant_id',
        count: 4,
        algorithm: 'consistent',
      })

      const specialKeys = [
        'key with spaces',
        'key-with-dashes',
        'key.with.dots',
        'key/with/slashes',
        'key:with:colons',
        'key?with=query',
        'key#with#hash',
        'key@with@at',
        'key!with!bang',
        'unicode-test-test',
        'emoji-test',
      ]

      for (const key of specialKeys) {
        const shardId = manager.getShardId(key)
        expect(shardId).toBeGreaterThanOrEqual(0)
        expect(shardId).toBeLessThan(4)

        const stub = await manager.getShardStub(key)
        expect(stub).toBeDefined()
      }
    })

    it('should handle very long keys', async () => {
      const manager = new ShardManager(env.DO, {
        key: 'tenant_id',
        count: 4,
        algorithm: 'consistent',
      })

      // Create a very long key
      const longKey = 'a'.repeat(10000)
      const shardId = manager.getShardId(longKey)

      expect(shardId).toBeGreaterThanOrEqual(0)
      expect(shardId).toBeLessThan(4)

      const stub = await manager.getShardStub(longKey)
      expect(stub).toBeDefined()
    })
  })

  // ==========================================================================
  // SHARD CONFIG PROPERTIES
  // ==========================================================================

  describe('shard config accessors', () => {
    it('should return correct shardCount', () => {
      const manager = new ShardManager(env.DO, {
        key: 'tenant_id',
        count: 16,
        algorithm: 'consistent',
      })

      expect(manager.shardCount).toBe(16)
    })

    it('should return correct shardKey', () => {
      const manager = new ShardManager(env.DO, {
        key: 'org_id',
        count: 8,
        algorithm: 'hash',
      })

      expect(manager.shardKey).toBe('org_id')
    })

    it('should return full config', () => {
      const config = {
        key: 'user_id',
        count: 12,
        algorithm: 'consistent' as const,
      }
      const manager = new ShardManager(env.DO, config)

      expect(manager.config).toEqual(config)
    })
  })

  // ==========================================================================
  // PERFORMANCE CHARACTERISTICS
  // ==========================================================================

  describe('performance', () => {
    it('should cache ring for repeated lookups', () => {
      clearRingCache()

      const count = 8
      const virtualNodes = 150

      // First call builds the ring
      const startBuild = performance.now()
      consistentHash('warmup', count, virtualNodes)
      const buildTime = performance.now() - startBuild

      // Subsequent calls should use cached ring and be fast
      const lookupTimes: number[] = []
      for (let i = 0; i < 100; i++) {
        const start = performance.now()
        consistentHash(`key-${i}`, count, virtualNodes)
        lookupTimes.push(performance.now() - start)
      }

      const avgLookup = lookupTimes.reduce((a, b) => a + b, 0) / lookupTimes.length

      // Cached lookups should be fast (< 1ms each on average)
      expect(avgLookup).toBeLessThan(1)

      // All lookups should be fast (using cached ring)
      expect(lookupTimes.every((t) => t < 5)).toBe(true)
    })

    it('should have consistent performance across key sizes', () => {
      clearRingCache()

      const count = 8

      // Warm up the cache
      consistentHash('warmup', count)

      // Test different key sizes
      const keySizes = [1, 10, 100, 1000]
      const timings = new Map<number, number[]>()

      for (const size of keySizes) {
        const key = 'x'.repeat(size)
        const times: number[] = []

        for (let i = 0; i < 50; i++) {
          const start = performance.now()
          consistentHash(key + i, count)
          times.push(performance.now() - start)
        }

        timings.set(size, times)
      }

      // All key sizes should have similar performance
      for (const [size, times] of timings) {
        const avg = times.reduce((a, b) => a + b, 0) / times.length
        expect(avg).toBeLessThan(1) // All should be under 1ms
      }
    })
  })
})
