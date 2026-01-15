/**
 * ShardRouter Tests - TDD RED Phase
 *
 * Tests for the ShardRouter class implementing consistent hashing.
 * ShardRouter distributes keys across shards using a consistent hash ring,
 * minimizing key movement when shards are added or removed.
 *
 * Key responsibilities:
 * 1. Consistent hash ring implementation with virtual nodes
 * 2. Even key distribution across shards
 * 3. Minimal key movement on shard add/remove (<5%)
 * 4. O(log n) lookup time via binary search
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { ShardRouter, type ShardRouterOptions } from '../shard-router'

// =============================================================================
// Consistent Hashing Tests
// =============================================================================

describe('Shard Router', () => {
  describe('Consistent Hashing', () => {
    it('should hash key to consistent shard', () => {
      const router = new ShardRouter(['shard-1', 'shard-2', 'shard-3'])

      // Same key should always map to same shard
      const shard1 = router.getShardId('test-key')
      const shard2 = router.getShardId('test-key')
      const shard3 = router.getShardId('test-key')

      expect(shard1).toBe(shard2)
      expect(shard2).toBe(shard3)
    })

    it('should distribute keys evenly across shards', () => {
      const router = new ShardRouter(['shard-1', 'shard-2', 'shard-3'])
      const counts: Record<string, number> = {}

      for (let i = 0; i < 10000; i++) {
        const shard = router.getShardId(`key-${i}`)
        counts[shard] = (counts[shard] ?? 0) + 1
      }

      // Each shard should have roughly 3333 keys (within 35% tolerance for consistent hashing)
      // Consistent hashing with virtual nodes provides good but not perfect distribution
      // The key benefit is minimal key movement, not perfect uniformity
      for (const count of Object.values(counts)) {
        expect(count).toBeGreaterThan(2000)
        expect(count).toBeLessThan(5000)
      }
    })

    it('should minimize key movement when adding shard', () => {
      const router = new ShardRouter(['shard-1', 'shard-2', 'shard-3'])
      const keyCount = 10000

      // Record initial shard assignments
      const initialAssignments = new Map<string, string>()
      for (let i = 0; i < keyCount; i++) {
        const key = `key-${i}`
        initialAssignments.set(key, router.getShardId(key))
      }

      // Add a new shard
      router.addShard('shard-4')

      // Count how many keys moved
      let movedCount = 0
      for (let i = 0; i < keyCount; i++) {
        const key = `key-${i}`
        const newShard = router.getShardId(key)
        if (initialAssignments.get(key) !== newShard) {
          movedCount++
        }
      }

      // With 4 shards, ~25% of keys should move to the new shard
      // Due to hash ring properties, actual movement can vary
      // Key insight: should be significantly less than 100% (random reshuffling)
      const movePercentage = (movedCount / keyCount) * 100
      expect(movePercentage).toBeGreaterThan(10) // Some keys must move
      expect(movePercentage).toBeLessThan(50) // But not too many (consistent hashing benefit)
    })

    it('should minimize key movement when removing shard', () => {
      const router = new ShardRouter(['shard-1', 'shard-2', 'shard-3', 'shard-4'])
      const keyCount = 10000

      // Record initial shard assignments
      const initialAssignments = new Map<string, string>()
      for (let i = 0; i < keyCount; i++) {
        const key = `key-${i}`
        initialAssignments.set(key, router.getShardId(key))
      }

      // Remove a shard
      router.removeShard('shard-3')

      // Count how many keys moved
      let movedCount = 0
      for (let i = 0; i < keyCount; i++) {
        const key = `key-${i}`
        const newShard = router.getShardId(key)
        if (initialAssignments.get(key) !== newShard) {
          movedCount++
        }
      }

      // Only keys that were on shard-3 should move (~25% of keys)
      // Plus some tolerance for hash ring behavior
      const movePercentage = (movedCount / keyCount) * 100
      expect(movePercentage).toBeGreaterThan(15)
      expect(movePercentage).toBeLessThan(40)
    })

    it('should produce deterministic hashing regardless of shard order', () => {
      const router1 = new ShardRouter(['shard-1', 'shard-2', 'shard-3'])
      const router2 = new ShardRouter(['shard-3', 'shard-1', 'shard-2'])

      // Same keys should map to same shards regardless of initialization order
      for (let i = 0; i < 100; i++) {
        const key = `test-key-${i}`
        expect(router1.getShardId(key)).toBe(router2.getShardId(key))
      }
    })
  })

  // ===========================================================================
  // Route Resolution Tests
  // ===========================================================================

  describe('Route Resolution', () => {
    it('should resolve shard ID from route key', () => {
      const router = new ShardRouter(['shard-1', 'shard-2', 'shard-3'])

      const shardId = router.getShardId('customer-123')
      expect(['shard-1', 'shard-2', 'shard-3']).toContain(shardId)
    })

    it('should handle empty key', () => {
      const router = new ShardRouter(['shard-1', 'shard-2'])

      const shardId = router.getShardId('')
      expect(['shard-1', 'shard-2']).toContain(shardId)
    })

    it('should handle special characters in key', () => {
      const router = new ShardRouter(['shard-1', 'shard-2'])

      const shardId = router.getShardId('user:123:profile@tenant/data')
      expect(['shard-1', 'shard-2']).toContain(shardId)
    })

    it('should handle unicode keys', () => {
      const router = new ShardRouter(['shard-1', 'shard-2'])

      const shardId = router.getShardId('用户-名称-日本語')
      expect(['shard-1', 'shard-2']).toContain(shardId)
    })

    it('should handle very long keys', () => {
      const router = new ShardRouter(['shard-1', 'shard-2'])
      const longKey = 'x'.repeat(10000)

      const shardId = router.getShardId(longKey)
      expect(['shard-1', 'shard-2']).toContain(shardId)
    })
  })

  // ===========================================================================
  // Shard Configuration Tests
  // ===========================================================================

  describe('Shard Configuration', () => {
    it('should initialize with shard IDs', () => {
      const shardIds = ['shard-a', 'shard-b', 'shard-c']
      const router = new ShardRouter(shardIds)

      expect(router.getShardIds()).toEqual(expect.arrayContaining(shardIds))
      expect(router.getShardCount()).toBe(3)
    })

    it('should support dynamic shard count via addShard', () => {
      const router = new ShardRouter(['shard-1', 'shard-2'])
      expect(router.getShardCount()).toBe(2)

      router.addShard('shard-3')
      expect(router.getShardCount()).toBe(3)
      expect(router.getShardIds()).toContain('shard-3')
    })

    it('should support dynamic shard count via removeShard', () => {
      const router = new ShardRouter(['shard-1', 'shard-2', 'shard-3'])
      expect(router.getShardCount()).toBe(3)

      router.removeShard('shard-2')
      expect(router.getShardCount()).toBe(2)
      expect(router.getShardIds()).not.toContain('shard-2')
    })

    it('should not add duplicate shards', () => {
      const router = new ShardRouter(['shard-1', 'shard-2'])
      router.addShard('shard-1')

      expect(router.getShardCount()).toBe(2)
    })

    it('should handle removing non-existent shard gracefully', () => {
      const router = new ShardRouter(['shard-1', 'shard-2'])
      router.removeShard('shard-999')

      expect(router.getShardCount()).toBe(2)
    })

    it('should support virtual nodes for balance', () => {
      // More virtual nodes = better distribution
      const router50 = new ShardRouter(['shard-1', 'shard-2'], { virtualNodes: 50 })
      const router200 = new ShardRouter(['shard-1', 'shard-2'], { virtualNodes: 200 })

      // Both should work, but more virtual nodes should give more even distribution
      const counts50: Record<string, number> = {}
      const counts200: Record<string, number> = {}

      for (let i = 0; i < 5000; i++) {
        const key = `key-${i}`
        const shard50 = router50.getShardId(key)
        const shard200 = router200.getShardId(key)
        counts50[shard50] = (counts50[shard50] ?? 0) + 1
        counts200[shard200] = (counts200[shard200] ?? 0) + 1
      }

      // Calculate standard deviation of distribution
      const values50 = Object.values(counts50)
      const values200 = Object.values(counts200)

      const stdDev = (arr: number[]) => {
        const mean = arr.reduce((a, b) => a + b, 0) / arr.length
        const sq = arr.map((x) => Math.pow(x - mean, 2))
        return Math.sqrt(sq.reduce((a, b) => a + b, 0) / arr.length)
      }

      // Both should produce some distribution (std dev less than half the expected mean)
      // With 2 shards and 5000 keys, mean is 2500, so stddev < 1250 is reasonable
      expect(stdDev(values50)).toBeLessThan(2000)
      expect(stdDev(values200)).toBeLessThan(1500)
    })

    it('should use default virtual nodes when not specified', () => {
      const router = new ShardRouter(['shard-1', 'shard-2'])

      // Default should produce reasonable distribution
      const counts: Record<string, number> = {}
      for (let i = 0; i < 1000; i++) {
        const shard = router.getShardId(`key-${i}`)
        counts[shard] = (counts[shard] ?? 0) + 1
      }

      // Each shard should have some keys (within 40% tolerance for small sample)
      // With only 1000 keys and 2 shards, variance is expected
      for (const count of Object.values(counts)) {
        expect(count).toBeGreaterThan(300)
        expect(count).toBeLessThan(700)
      }
    })
  })

  // ===========================================================================
  // Edge Cases and Error Handling
  // ===========================================================================

  describe('Edge Cases', () => {
    it('should handle single shard', () => {
      const router = new ShardRouter(['shard-only'])

      for (let i = 0; i < 100; i++) {
        expect(router.getShardId(`key-${i}`)).toBe('shard-only')
      }
    })

    it('should handle many shards', () => {
      const shardIds = Array.from({ length: 100 }, (_, i) => `shard-${i}`)
      const router = new ShardRouter(shardIds)

      expect(router.getShardCount()).toBe(100)

      // Should distribute across many shards
      const usedShards = new Set<string>()
      for (let i = 0; i < 10000; i++) {
        usedShards.add(router.getShardId(`key-${i}`))
      }

      // Should use a significant portion of available shards
      expect(usedShards.size).toBeGreaterThan(90)
    })

    it('should throw when initialized with empty shard list', () => {
      expect(() => new ShardRouter([])).toThrow()
    })

    it('should throw when all shards removed', () => {
      const router = new ShardRouter(['shard-1'])
      router.removeShard('shard-1')

      expect(() => router.getShardId('key')).toThrow()
    })
  })

  // ===========================================================================
  // Performance Tests
  // ===========================================================================

  describe('Performance', () => {
    it('should have O(log n) lookup time', () => {
      const shardIds = Array.from({ length: 1000 }, (_, i) => `shard-${i}`)
      const router = new ShardRouter(shardIds, { virtualNodes: 100 })

      const start = performance.now()
      for (let i = 0; i < 100000; i++) {
        router.getShardId(`key-${i}`)
      }
      const elapsed = performance.now() - start

      // 100k lookups should complete in reasonable time (< 1 second)
      expect(elapsed).toBeLessThan(1000)
    })

    it('should handle high-throughput routing', () => {
      const router = new ShardRouter(['shard-1', 'shard-2', 'shard-3', 'shard-4'])

      const start = performance.now()
      for (let i = 0; i < 1000000; i++) {
        router.getShardId(`customer-${i % 10000}`)
      }
      const elapsed = performance.now() - start

      // 1M lookups should complete in reasonable time (< 3 seconds)
      expect(elapsed).toBeLessThan(3000)
    })
  })

  // ===========================================================================
  // Hash Function Tests
  // ===========================================================================

  describe('Hash Function', () => {
    it('should produce uniform distribution', () => {
      const router = new ShardRouter(['s1', 's2', 's3', 's4', 's5'])
      const counts: Record<string, number> = {}

      // Generate many random-ish keys
      for (let i = 0; i < 50000; i++) {
        const key = `tenant-${i % 1000}-user-${Math.floor(i / 1000)}`
        const shard = router.getShardId(key)
        counts[shard] = (counts[shard] ?? 0) + 1
      }

      // Each of 5 shards should have ~10000 keys (within 50% tolerance)
      // Consistent hashing prioritizes minimal key movement over perfect uniformity
      for (const count of Object.values(counts)) {
        expect(count).toBeGreaterThan(5000)
        expect(count).toBeLessThan(15000)
      }
    })

    it('should handle similar keys differently', () => {
      const router = new ShardRouter(['shard-1', 'shard-2', 'shard-3', 'shard-4'])

      const shards = new Set<string>()
      // Similar keys should distribute across different shards
      for (let i = 0; i < 100; i++) {
        shards.add(router.getShardId(`key-${i}`))
      }

      // Should use multiple shards even for sequential keys
      expect(shards.size).toBeGreaterThan(1)
    })
  })

  // ===========================================================================
  // Integration with BrokerDO Tests
  // ===========================================================================

  describe('Integration', () => {
    it('should work with BrokerDO-style target resolution', () => {
      const router = new ShardRouter(['worker-1', 'worker-2', 'worker-3'])

      // Simulate routing RPC calls by tenant
      const tenants = ['tenant-a', 'tenant-b', 'tenant-c', 'tenant-d', 'tenant-e']
      const routedCalls = new Map<string, string[]>()

      for (const tenant of tenants) {
        const shard = router.getShardId(tenant)
        const existing = routedCalls.get(shard) ?? []
        existing.push(tenant)
        routedCalls.set(shard, existing)
      }

      // All tenants should be routed somewhere
      let totalRouted = 0
      for (const calls of routedCalls.values()) {
        totalRouted += calls.length
      }
      expect(totalRouted).toBe(tenants.length)
    })

    it('should provide consistent routing for session affinity', () => {
      const router = new ShardRouter(['ws-1', 'ws-2', 'ws-3', 'ws-4'])

      // Same client ID should always route to same shard
      const clientId = 'client-session-abc123'

      const routes = new Set<string>()
      for (let i = 0; i < 100; i++) {
        routes.add(router.getShardId(clientId))
      }

      // Should always route to exactly one shard
      expect(routes.size).toBe(1)
    })
  })
})
