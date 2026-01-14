/**
 * ShardAssigner Tests
 *
 * TDD RED PHASE - These tests MUST FAIL because the implementation doesn't exist yet.
 *
 * ShardAssigner determines which shard an entity belongs to. It provides:
 * - Partition key extraction from various sources ($id, namespace, $type, custom fields)
 * - Deterministic shard assignment using consistent hashing
 * - Shard metadata tracking (entity count, byte size, hotspot detection)
 * - Rebalancing hints for oversized/undersized shards
 *
 * Architecture context:
 * - Each entity is assigned to exactly one shard based on partition key
 * - Same partition key always maps to the same shard (deterministic)
 * - Distribution should be even across all shards
 * - Hot shards (high traffic) are detected for potential rebalancing
 *
 * Issue: do-2tr.3.2
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================================
// IMPORTS - These MUST FAIL because the implementation doesn't exist yet
// ============================================================================

// This import will fail - the file doesn't exist
import {
  ShardAssigner,
  type ShardAssignerConfig,
  type ShardMetadata,
  type RebalanceHint,
  type PartitionKeyStrategy,
} from '../../objects/unified-storage/shard-assigner'

// Type definitions for test clarity (these would be imported from types/Thing.ts in implementation)
interface ThingData {
  $id: string
  $type: string
  $version?: number
  namespace?: string
  tenantId?: string
  name?: string
  data?: Record<string, unknown>
  createdAt?: Date
  updatedAt?: Date
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('ShardAssigner', () => {
  let assigner: ShardAssigner

  beforeEach(() => {
    // Create fresh assigner for each test with default config
    assigner = new ShardAssigner({
      shardCount: 8,
      strategy: 'hash',
    })
  })

  // ==========================================================================
  // PARTITION KEY EXTRACTION
  // ==========================================================================

  describe('partition key extraction', () => {
    it('should extract partition key from Thing.$id', () => {
      // Given: A thing with an ID
      const thing: ThingData = {
        $id: 'customer_abc123',
        $type: 'Customer',
        name: 'Alice',
      }

      // When: Extracting the partition key with $id strategy
      const keyAssigner = new ShardAssigner({
        shardCount: 8,
        strategy: 'hash',
        partitionKey: '$id',
      })
      const key = keyAssigner.extractPartitionKey(thing)

      // Then: Should return the $id as partition key
      expect(key).toBe('customer_abc123')
    })

    it('should extract partition key from namespace', () => {
      // Given: A thing with namespace
      const thing: ThingData = {
        $id: 'order_12345',
        $type: 'Order',
        namespace: 'tenant_acme',
        name: 'Order #1',
      }

      // When: Extracting with namespace strategy
      const nsAssigner = new ShardAssigner({
        shardCount: 8,
        strategy: 'hash',
        partitionKey: 'namespace',
      })
      const key = nsAssigner.extractPartitionKey(thing)

      // Then: Should return the namespace as partition key
      expect(key).toBe('tenant_acme')
    })

    it('should extract partition key from $type', () => {
      // Given: A thing with $type
      const thing: ThingData = {
        $id: 'customer_xyz',
        $type: 'Customer',
        name: 'Bob',
      }

      // When: Extracting with $type strategy
      const typeAssigner = new ShardAssigner({
        shardCount: 8,
        strategy: 'hash',
        partitionKey: '$type',
      })
      const key = typeAssigner.extractPartitionKey(thing)

      // Then: Should return the $type as partition key
      expect(key).toBe('Customer')
    })

    it('should support custom partition key field', () => {
      // Given: A thing with custom tenant field
      const thing: ThingData = {
        $id: 'invoice_789',
        $type: 'Invoice',
        tenantId: 'acme_corp',
        name: 'Invoice #789',
      }

      // When: Extracting with custom field strategy
      const customAssigner = new ShardAssigner({
        shardCount: 8,
        strategy: 'hash',
        partitionKey: 'tenantId',
      })
      const key = customAssigner.extractPartitionKey(thing)

      // Then: Should return the custom field value as partition key
      expect(key).toBe('acme_corp')
    })

    it('should support composite partition keys', () => {
      // Given: A thing with multiple fields
      const thing: ThingData = {
        $id: 'product_abc',
        $type: 'Product',
        namespace: 'store_123',
        name: 'Widget',
      }

      // When: Extracting with composite key strategy
      const compositeAssigner = new ShardAssigner({
        shardCount: 8,
        strategy: 'hash',
        partitionKey: ['namespace', '$type'], // Composite key
      })
      const key = compositeAssigner.extractPartitionKey(thing)

      // Then: Should return combined key
      expect(key).toBe('store_123:Product')
    })

    it('should handle missing partition key field gracefully', () => {
      // Given: A thing without the partition key field
      const thing: ThingData = {
        $id: 'item_999',
        $type: 'Item',
        name: 'Item without namespace',
      }

      // When: Extracting with missing field
      const nsAssigner = new ShardAssigner({
        shardCount: 8,
        strategy: 'hash',
        partitionKey: 'namespace',
        fallbackKey: '$id', // Fallback to $id if namespace missing
      })
      const key = nsAssigner.extractPartitionKey(thing)

      // Then: Should fall back to $id
      expect(key).toBe('item_999')
    })

    it('should throw if no valid partition key can be extracted', () => {
      // Given: A thing without any usable key
      const thing: ThingData = {
        $id: 'orphan_123',
        $type: 'Orphan',
        name: 'No valid key',
      }

      // When: Extracting with strict mode (no fallback)
      const strictAssigner = new ShardAssigner({
        shardCount: 8,
        strategy: 'hash',
        partitionKey: 'nonExistentField',
        strict: true, // No fallback, throw on missing
      })

      // Then: Should throw an error
      expect(() => strictAssigner.extractPartitionKey(thing)).toThrow('Missing partition key')
    })

    it('should support function-based partition key extraction', () => {
      // Given: A thing with complex key derivation needs
      const thing: ThingData = {
        $id: 'txn_2024_01_abc123',
        $type: 'Transaction',
        name: 'Payment',
      }

      // When: Using custom extraction function
      const fnAssigner = new ShardAssigner({
        shardCount: 8,
        strategy: 'hash',
        partitionKeyFn: (t: ThingData) => {
          // Extract year-month from ID for time-based partitioning
          const parts = t.$id.split('_')
          return `${parts[1]}_${parts[2]}` // "2024_01"
        },
      })
      const key = fnAssigner.extractPartitionKey(thing)

      // Then: Should return custom-computed key
      expect(key).toBe('2024_01')
    })
  })

  // ==========================================================================
  // SHARD ASSIGNMENT
  // ==========================================================================

  describe('shard assignment', () => {
    it('should assign shard ID for partition key', () => {
      // Given: A partition key
      const partitionKey = 'customer_alice'

      // When: Assigning to a shard
      const shardId = assigner.assignShard(partitionKey)

      // Then: Should return a valid shard ID within range
      expect(shardId).toBeGreaterThanOrEqual(0)
      expect(shardId).toBeLessThan(8) // shardCount = 8
      expect(Number.isInteger(shardId)).toBe(true)
    })

    it('should be deterministic (same key = same shard)', () => {
      // Given: A partition key
      const partitionKey = 'order_12345'

      // When: Assigning multiple times
      const shard1 = assigner.assignShard(partitionKey)
      const shard2 = assigner.assignShard(partitionKey)
      const shard3 = assigner.assignShard(partitionKey)

      // Create new assigner with same config
      const newAssigner = new ShardAssigner({
        shardCount: 8,
        strategy: 'hash',
      })
      const shard4 = newAssigner.assignShard(partitionKey)

      // Then: All assignments should be identical
      expect(shard1).toBe(shard2)
      expect(shard2).toBe(shard3)
      expect(shard3).toBe(shard4)
    })

    it('should distribute evenly across shards', () => {
      // Given: Many partition keys
      const keyCount = 10000
      const shardCounts = new Map<number, number>()

      // Initialize counts
      for (let i = 0; i < 8; i++) {
        shardCounts.set(i, 0)
      }

      // When: Assigning many keys
      for (let i = 0; i < keyCount; i++) {
        const key = `entity_${i}_${crypto.randomUUID()}`
        const shard = assigner.assignShard(key)
        shardCounts.set(shard, (shardCounts.get(shard) ?? 0) + 1)
      }

      // Then: Distribution should be relatively even
      const counts = Array.from(shardCounts.values())
      const mean = keyCount / 8
      const maxDeviation = mean * 0.3 // Allow 30% deviation

      for (const count of counts) {
        expect(count).toBeGreaterThan(mean - maxDeviation)
        expect(count).toBeLessThan(mean + maxDeviation)
      }

      // Check coefficient of variation
      const stdDev = Math.sqrt(counts.reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) / counts.length)
      const cv = stdDev / mean
      expect(cv).toBeLessThan(0.2) // CV should be less than 20%
    })

    it('should support different shard counts', () => {
      // Given: Different shard counts
      const shardCounts = [4, 8, 16, 32, 64]
      const key = 'test_key_xyz'

      for (const count of shardCounts) {
        // When: Creating assigner with different shard count
        const customAssigner = new ShardAssigner({
          shardCount: count,
          strategy: 'hash',
        })
        const shard = customAssigner.assignShard(key)

        // Then: Shard should be within valid range
        expect(shard).toBeGreaterThanOrEqual(0)
        expect(shard).toBeLessThan(count)
      }
    })

    it('should support consistent hashing for minimal redistribution', () => {
      // Given: Keys assigned to 8 shards
      const keys = Array.from({ length: 100 }, (_, i) => `key_${i}`)
      const assignerBefore = new ShardAssigner({
        shardCount: 8,
        strategy: 'consistent',
        virtualNodes: 150,
      })
      const assignmentsBefore = new Map<string, number>()
      keys.forEach((key) => assignmentsBefore.set(key, assignerBefore.assignShard(key)))

      // When: Increasing to 10 shards (25% increase)
      const assignerAfter = new ShardAssigner({
        shardCount: 10,
        strategy: 'consistent',
        virtualNodes: 150,
      })
      const assignmentsAfter = new Map<string, number>()
      keys.forEach((key) => assignmentsAfter.set(key, assignerAfter.assignShard(key)))

      // Then: Most keys should remain in their original shard
      // With consistent hashing, only ~K/N keys should move (K=keys, N=newShards)
      let movedKeys = 0
      for (const key of keys) {
        if (assignmentsBefore.get(key) !== assignmentsAfter.get(key)) {
          movedKeys++
        }
      }

      // Expected movement: ~100 * (2/10) = ~20 keys (adding 2 shards)
      // Allow some variance
      expect(movedKeys).toBeLessThan(keys.length * 0.4) // Less than 40% should move
    })

    it('should assign Thing directly using partition key extraction', () => {
      // Given: A thing object
      const thing: ThingData = {
        $id: 'product_widget_123',
        $type: 'Product',
        name: 'Super Widget',
      }

      // When: Assigning the thing directly
      const shardId = assigner.assignThing(thing)

      // Then: Should return valid shard
      expect(shardId).toBeGreaterThanOrEqual(0)
      expect(shardId).toBeLessThan(8)

      // And: Should be deterministic
      expect(assigner.assignThing(thing)).toBe(shardId)
    })
  })

  // ==========================================================================
  // SHARD METADATA
  // ==========================================================================

  describe('shard metadata', () => {
    let metadataAssigner: ShardAssigner

    beforeEach(() => {
      metadataAssigner = new ShardAssigner({
        shardCount: 4,
        strategy: 'hash',
        trackMetadata: true,
      })
    })

    it('should track entity count per shard', () => {
      // Given: Things assigned to shards
      const things: ThingData[] = [
        { $id: 'a1', $type: 'A', name: 'A1' },
        { $id: 'a2', $type: 'A', name: 'A2' },
        { $id: 'b1', $type: 'B', name: 'B1' },
        { $id: 'c1', $type: 'C', name: 'C1' },
        { $id: 'c2', $type: 'C', name: 'C2' },
      ]

      // When: Registering things with the assigner
      for (const thing of things) {
        metadataAssigner.registerThing(thing)
      }

      // Then: Should track counts per shard
      const metadata = metadataAssigner.getShardMetadata()

      // Total should match
      const totalCount = Array.from(metadata.values()).reduce((sum, m) => sum + m.entityCount, 0)
      expect(totalCount).toBe(5)

      // Each shard metadata should have count
      for (const [shardId, meta] of metadata) {
        expect(meta.shardId).toBe(shardId)
        expect(meta.entityCount).toBeGreaterThanOrEqual(0)
      }
    })

    it('should track byte size per shard', () => {
      // Given: Things of varying sizes
      const smallThing: ThingData = {
        $id: 'small_1',
        $type: 'Small',
        name: 'Tiny',
      }

      const largeThing: ThingData = {
        $id: 'large_1',
        $type: 'Large',
        name: 'Huge Document',
        data: { content: 'A'.repeat(10000) },
      }

      // When: Registering things with byte tracking
      metadataAssigner.registerThing(smallThing)
      metadataAssigner.registerThing(largeThing)

      // Then: Should track byte sizes
      const metadata = metadataAssigner.getShardMetadata()
      const totalBytes = Array.from(metadata.values()).reduce((sum, m) => sum + m.byteSize, 0)

      // Large thing should contribute significantly more
      expect(totalBytes).toBeGreaterThan(10000)

      // Each shard should track its byte size
      for (const meta of metadata.values()) {
        expect(meta.byteSize).toBeGreaterThanOrEqual(0)
      }
    })

    it('should identify hot shards', () => {
      // Given: An assigner with access tracking
      const hotAssigner = new ShardAssigner({
        shardCount: 4,
        strategy: 'hash',
        trackMetadata: true,
        trackAccess: true,
      })

      // Simulate many accesses to one shard's keys
      const hotKey = 'hot_entity_xyz'
      const hotShard = hotAssigner.assignShard(hotKey)

      // When: Simulating many reads to the hot key
      for (let i = 0; i < 1000; i++) {
        hotAssigner.recordAccess(hotKey, 'read')
      }

      // And: Few accesses to other keys
      for (let i = 0; i < 10; i++) {
        hotAssigner.recordAccess(`cold_key_${i}`, 'read')
      }

      // Then: Should identify the hot shard
      const hotShards = hotAssigner.getHotShards({
        threshold: 100, // More than 100 accesses
        windowMs: 60000, // In last minute
      })

      expect(hotShards.length).toBeGreaterThan(0)
      expect(hotShards).toContain(hotShard)
    })

    it('should update metadata on thing removal', () => {
      // Given: Things registered
      const thing1: ThingData = { $id: 'remove_1', $type: 'Test', name: 'Test 1' }
      const thing2: ThingData = { $id: 'remove_2', $type: 'Test', name: 'Test 2' }

      metadataAssigner.registerThing(thing1)
      metadataAssigner.registerThing(thing2)

      const initialMetadata = metadataAssigner.getShardMetadata()
      const initialTotal = Array.from(initialMetadata.values()).reduce((sum, m) => sum + m.entityCount, 0)
      expect(initialTotal).toBe(2)

      // When: Removing a thing
      metadataAssigner.unregisterThing(thing1)

      // Then: Count should decrease
      const finalMetadata = metadataAssigner.getShardMetadata()
      const finalTotal = Array.from(finalMetadata.values()).reduce((sum, m) => sum + m.entityCount, 0)
      expect(finalTotal).toBe(1)
    })

    it('should provide per-shard metadata statistics', () => {
      // Given: Multiple things across shards
      for (let i = 0; i < 20; i++) {
        metadataAssigner.registerThing({
          $id: `stat_${i}`,
          $type: 'Statistic',
          name: `Item ${i}`,
          data: { value: i },
        })
      }

      // When: Getting individual shard metadata
      const metadata = metadataAssigner.getShardMetadata()

      // Then: Each shard should have complete statistics
      for (const [shardId, meta] of metadata) {
        expect(meta).toMatchObject({
          shardId: expect.any(Number),
          entityCount: expect.any(Number),
          byteSize: expect.any(Number),
          lastUpdated: expect.any(Date),
        })
        expect(meta.shardId).toBe(shardId)
      }
    })

    it('should calculate shard utilization percentage', () => {
      // Given: Assigner with capacity limits
      const capacityAssigner = new ShardAssigner({
        shardCount: 4,
        strategy: 'hash',
        trackMetadata: true,
        maxEntitiesPerShard: 1000,
        maxBytesPerShard: 1024 * 1024, // 1MB
      })

      // Register some things
      for (let i = 0; i < 100; i++) {
        capacityAssigner.registerThing({
          $id: `util_${i}`,
          $type: 'Test',
          name: `Item ${i}`,
        })
      }

      // When: Getting utilization
      const utilization = capacityAssigner.getShardUtilization()

      // Then: Should report utilization for each shard
      for (const [shardId, util] of utilization) {
        expect(util.entityUtilization).toBeGreaterThanOrEqual(0)
        expect(util.entityUtilization).toBeLessThanOrEqual(1)
        expect(util.byteUtilization).toBeGreaterThanOrEqual(0)
        expect(util.byteUtilization).toBeLessThanOrEqual(1)
      }
    })
  })

  // ==========================================================================
  // REBALANCING HINTS
  // ==========================================================================

  describe('rebalancing hints', () => {
    let rebalanceAssigner: ShardAssigner

    beforeEach(() => {
      rebalanceAssigner = new ShardAssigner({
        shardCount: 4,
        strategy: 'hash',
        trackMetadata: true,
        maxEntitiesPerShard: 100,
        maxBytesPerShard: 1024 * 100, // 100KB
        minEntitiesPerShard: 10,
      })
    })

    it('should suggest splits for oversized shards', () => {
      // Given: A shard with too many entities
      // Force all entities to one shard by using keys that hash to same shard
      // (In practice, we'd use registerWithShard for testing)
      const targetShard = 0
      for (let i = 0; i < 150; i++) {
        // 150 > max of 100
        rebalanceAssigner.registerThingInShard(
          { $id: `oversized_${i}`, $type: 'Test', name: `Item ${i}` },
          targetShard
        )
      }

      // When: Getting rebalancing hints
      const hints = rebalanceAssigner.getRebalanceHints()

      // Then: Should suggest split for oversized shard
      const splitHints = hints.filter((h) => h.type === 'split')
      expect(splitHints.length).toBeGreaterThan(0)
      expect(splitHints.some((h) => h.sourceShardId === targetShard)).toBe(true)
    })

    it('should suggest merges for undersized shards', () => {
      // Given: Shards with very few entities
      for (let i = 0; i < 4; i++) {
        // Only 2 entities per shard (below min of 10)
        rebalanceAssigner.registerThingInShard({ $id: `small_${i}_1`, $type: 'Test', name: 'A' }, i)
        rebalanceAssigner.registerThingInShard({ $id: `small_${i}_2`, $type: 'Test', name: 'B' }, i)
      }

      // When: Getting rebalancing hints
      const hints = rebalanceAssigner.getRebalanceHints()

      // Then: Should suggest merge for undersized shards
      const mergeHints = hints.filter((h) => h.type === 'merge')
      expect(mergeHints.length).toBeGreaterThan(0)
    })

    it('should respect minimum shard size', () => {
      // Given: Assigner with minimum size config
      const minAssigner = new ShardAssigner({
        shardCount: 8,
        strategy: 'hash',
        trackMetadata: true,
        minEntitiesPerShard: 50,
      })

      // Add some entities (less than minimum)
      for (let i = 0; i < 20; i++) {
        minAssigner.registerThing({
          $id: `min_test_${i}`,
          $type: 'Test',
          name: `Item ${i}`,
        })
      }

      // When: Getting hints
      const hints = minAssigner.getRebalanceHints()

      // Then: Should suggest merges to reach minimum
      // But should not merge below minimum shard count
      const mergeHints = hints.filter((h) => h.type === 'merge')
      for (const hint of mergeHints) {
        // Merge hints should have valid shard IDs
        expect(hint.sourceShardId).toBeGreaterThanOrEqual(0)
        expect(hint.targetShardId).toBeGreaterThanOrEqual(0)
        expect(hint.sourceShardId).not.toBe(hint.targetShardId)
      }
    })

    it('should provide rebalance hints with priorities', () => {
      // Given: Various imbalanced shards
      // Oversized shard
      for (let i = 0; i < 200; i++) {
        rebalanceAssigner.registerThingInShard(
          { $id: `over_${i}`, $type: 'Big', name: `O${i}` },
          0
        )
      }

      // Normal shards
      for (let i = 1; i < 4; i++) {
        for (let j = 0; j < 50; j++) {
          rebalanceAssigner.registerThingInShard(
            { $id: `normal_${i}_${j}`, $type: 'Normal', name: `N${j}` },
            i
          )
        }
      }

      // When: Getting prioritized hints
      const hints = rebalanceAssigner.getRebalanceHints()

      // Then: Hints should be sorted by priority (urgent first)
      expect(hints.length).toBeGreaterThan(0)

      // Each hint should have priority
      for (const hint of hints) {
        expect(hint.priority).toBeDefined()
        expect(['urgent', 'normal', 'low']).toContain(hint.priority)
      }

      // Urgent hints should come first
      if (hints.length > 1) {
        const priorities = hints.map((h) => h.priority)
        const urgentIndex = priorities.indexOf('urgent')
        const normalIndex = priorities.indexOf('normal')
        const lowIndex = priorities.indexOf('low')

        if (urgentIndex >= 0 && normalIndex >= 0) {
          expect(urgentIndex).toBeLessThan(normalIndex)
        }
        if (normalIndex >= 0 && lowIndex >= 0) {
          expect(normalIndex).toBeLessThan(lowIndex)
        }
      }
    })

    it('should suggest byte-based rebalancing', () => {
      // Given: Shard with large entities (exceeds byte limit)
      const largeData = { content: 'X'.repeat(50000) } // ~50KB each
      for (let i = 0; i < 5; i++) {
        rebalanceAssigner.registerThingInShard(
          { $id: `large_${i}`, $type: 'Large', name: `L${i}`, data: largeData },
          0
        )
      }

      // When: Getting hints (total ~250KB > 100KB limit)
      const hints = rebalanceAssigner.getRebalanceHints()

      // Then: Should suggest split due to byte size
      const byteSplitHints = hints.filter((h) => h.type === 'split' && h.reason === 'byte_size')
      expect(byteSplitHints.length).toBeGreaterThan(0)
    })

    it('should not suggest rebalancing for balanced shards', () => {
      // Given: Well-balanced shards
      const balancedAssigner = new ShardAssigner({
        shardCount: 4,
        strategy: 'hash',
        trackMetadata: true,
        maxEntitiesPerShard: 1000,
        minEntitiesPerShard: 10,
      })

      // Add balanced entities (50 per shard)
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 50; j++) {
          balancedAssigner.registerThingInShard(
            { $id: `balanced_${i}_${j}`, $type: 'Test', name: `B${j}` },
            i
          )
        }
      }

      // When: Getting hints
      const hints = balancedAssigner.getRebalanceHints()

      // Then: Should have no rebalancing hints
      expect(hints.length).toBe(0)
    })

    it('should provide migration plan for rebalancing', () => {
      // Given: Oversized shard
      for (let i = 0; i < 150; i++) {
        rebalanceAssigner.registerThingInShard(
          { $id: `migrate_${i}`, $type: 'Migrate', name: `M${i}` },
          0
        )
      }

      // When: Getting a specific hint with migration plan
      const hints = rebalanceAssigner.getRebalanceHints()
      const splitHint = hints.find((h) => h.type === 'split')

      if (splitHint) {
        // Then: Should include migration details
        expect(splitHint.migrationPlan).toBeDefined()
        expect(splitHint.migrationPlan?.entitiesToMove).toBeGreaterThan(0)
        expect(splitHint.migrationPlan?.estimatedDuration).toBeDefined()
        expect(splitHint.migrationPlan?.targetShardId).toBeDefined()
      }
    })
  })

  // ==========================================================================
  // CONFIGURATION
  // ==========================================================================

  describe('configuration', () => {
    it('should accept various hashing strategies', () => {
      // Given: Different hashing strategies
      const strategies: PartitionKeyStrategy[] = ['hash', 'consistent', 'range', 'tenant']

      for (const strategy of strategies) {
        // When: Creating assigner with strategy
        const strategyAssigner = new ShardAssigner({
          shardCount: 8,
          strategy,
        })

        // Then: Should work without error
        const shard = strategyAssigner.assignShard('test_key')
        expect(shard).toBeGreaterThanOrEqual(0)
        expect(shard).toBeLessThan(8)
      }
    })

    it('should allow runtime shard count changes', () => {
      // Given: Initial configuration
      const dynamicAssigner = new ShardAssigner({
        shardCount: 4,
        strategy: 'consistent',
      })

      const key = 'dynamic_key_test'
      const initialShard = dynamicAssigner.assignShard(key)

      // When: Updating shard count
      dynamicAssigner.setShardCount(8)

      // Then: Should use new shard count
      const newShard = dynamicAssigner.assignShard(key)
      expect(newShard).toBeGreaterThanOrEqual(0)
      expect(newShard).toBeLessThan(8)
    })

    it('should validate configuration', () => {
      // Given/When/Then: Invalid shard count should throw
      expect(() => new ShardAssigner({ shardCount: 0, strategy: 'hash' })).toThrow()
      expect(() => new ShardAssigner({ shardCount: -1, strategy: 'hash' })).toThrow()
      expect(() => new ShardAssigner({ shardCount: 1.5, strategy: 'hash' })).toThrow()
    })

    it('should support virtual nodes configuration for consistent hashing', () => {
      // Given: Different virtual node counts
      const lowVNodes = new ShardAssigner({
        shardCount: 4,
        strategy: 'consistent',
        virtualNodes: 10,
      })

      const highVNodes = new ShardAssigner({
        shardCount: 4,
        strategy: 'consistent',
        virtualNodes: 500,
      })

      // When: Getting stats
      const lowStats = lowVNodes.getStats()
      const highStats = highVNodes.getStats()

      // Then: Should reflect virtual node configuration
      expect(lowStats.virtualNodes).toBe(10)
      expect(highStats.virtualNodes).toBe(500)
    })
  })

  // ==========================================================================
  // SERIALIZATION AND RESTORATION
  // ==========================================================================

  describe('serialization', () => {
    it('should serialize shard assignments', () => {
      // Given: Assigner with some state
      const serializeAssigner = new ShardAssigner({
        shardCount: 4,
        strategy: 'hash',
        trackMetadata: true,
      })

      for (let i = 0; i < 10; i++) {
        serializeAssigner.registerThing({
          $id: `serialize_${i}`,
          $type: 'Test',
          name: `S${i}`,
        })
      }

      // When: Serializing
      const serialized = serializeAssigner.serialize()

      // Then: Should produce valid JSON
      expect(typeof serialized).toBe('string')
      const parsed = JSON.parse(serialized)
      expect(parsed.shardCount).toBe(4)
      expect(parsed.strategy).toBe('hash')
      expect(parsed.metadata).toBeDefined()
    })

    it('should restore from serialized state', () => {
      // Given: Serialized state
      const original = new ShardAssigner({
        shardCount: 4,
        strategy: 'hash',
        trackMetadata: true,
      })

      for (let i = 0; i < 10; i++) {
        original.registerThing({
          $id: `restore_${i}`,
          $type: 'Test',
          name: `R${i}`,
        })
      }

      const serialized = original.serialize()

      // When: Restoring
      const restored = ShardAssigner.deserialize(serialized)

      // Then: Should match original state
      expect(restored.getStats().shardCount).toBe(4)

      // Same key should map to same shard
      const key = 'restore_5'
      expect(restored.assignShard(key)).toBe(original.assignShard(key))

      // Metadata should match
      const originalMeta = original.getShardMetadata()
      const restoredMeta = restored.getShardMetadata()
      expect(restoredMeta.size).toBe(originalMeta.size)
    })
  })

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle empty partition key', () => {
      // Given: Thing with empty $id
      const thing: ThingData = {
        $id: '',
        $type: 'Empty',
        name: 'No ID',
      }

      // When/Then: Should handle gracefully or throw appropriate error
      expect(() => assigner.assignThing(thing)).toThrow('Invalid partition key')
    })

    it('should handle very long partition keys', () => {
      // Given: Very long key
      const longKey = 'x'.repeat(10000)

      // When: Assigning
      const shard = assigner.assignShard(longKey)

      // Then: Should work without issue
      expect(shard).toBeGreaterThanOrEqual(0)
      expect(shard).toBeLessThan(8)
    })

    it('should handle special characters in keys', () => {
      // Given: Keys with special characters
      const specialKeys = [
        'key:with:colons',
        'key/with/slashes',
        'key.with.dots',
        'key-with-dashes',
        'key_with_underscores',
        'key with spaces',
        'key\twith\ttabs',
        'key\nwith\nnewlines',
        'unicode_\u4e2d\u6587_key',
        'emoji_\ud83d\ude00_key',
      ]

      for (const key of specialKeys) {
        // When: Assigning
        const shard = assigner.assignShard(key)

        // Then: Should handle all special characters
        expect(shard).toBeGreaterThanOrEqual(0)
        expect(shard).toBeLessThan(8)
      }
    })

    it('should handle concurrent access safely', async () => {
      // Given: Assigner with metadata tracking
      const concurrentAssigner = new ShardAssigner({
        shardCount: 4,
        strategy: 'hash',
        trackMetadata: true,
      })

      // When: Many concurrent registrations
      const promises = Array.from({ length: 100 }, (_, i) =>
        Promise.resolve(
          concurrentAssigner.registerThing({
            $id: `concurrent_${i}`,
            $type: 'Concurrent',
            name: `C${i}`,
          })
        )
      )

      await Promise.all(promises)

      // Then: Should have correct total count
      const metadata = concurrentAssigner.getShardMetadata()
      const total = Array.from(metadata.values()).reduce((sum, m) => sum + m.entityCount, 0)
      expect(total).toBe(100)
    })

    it('should handle single shard configuration', () => {
      // Given: Single shard
      const singleAssigner = new ShardAssigner({
        shardCount: 1,
        strategy: 'hash',
      })

      // When: Assigning many keys
      for (let i = 0; i < 100; i++) {
        const shard = singleAssigner.assignShard(`key_${i}`)
        // Then: All should go to shard 0
        expect(shard).toBe(0)
      }
    })

    it('should handle large shard counts', () => {
      // Given: Large number of shards
      const largeAssigner = new ShardAssigner({
        shardCount: 1024,
        strategy: 'consistent',
      })

      // When: Assigning keys
      const shards = new Set<number>()
      for (let i = 0; i < 10000; i++) {
        const shard = largeAssigner.assignShard(`large_${i}`)
        shards.add(shard)
      }

      // Then: Should utilize most shards
      // With 10K keys across 1024 shards, most should be used
      expect(shards.size).toBeGreaterThan(900)
    })
  })
})
