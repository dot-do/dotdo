/**
 * KeyedRouter Tests
 *
 * Comprehensive TDD RED phase tests for KeyedRouter - a consistent hash-based
 * key-to-partition router for distributed data operations.
 *
 * This is RED phase TDD - tests should FAIL until the KeyedRouter implementation
 * is complete in db/primitives/keyed-router.ts.
 *
 * Key features tested:
 * - Consistent routing: same key always maps to same partition
 * - Even distribution: keys should be approximately uniformly distributed
 * - Batch operations: efficient routing of multiple keys
 * - Shuffle operations: grouping data by key for distributed processing
 * - Determinism: reproducible results across process restarts
 *
 * @see db/primitives/keyed-router.ts (to be implemented)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  KeyedRouter,
  createKeyedRouter,
  type KeyedRouterOptions,
} from '../keyed-router'

// ============================================================================
// Test Fixtures and Helpers
// ============================================================================

/**
 * Generate an array of sequential string keys
 */
function generateStringKeys(count: number, prefix = 'key'): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}-${i}`)
}

/**
 * Generate an array of random UUIDs
 */
function generateUUIDs(count: number): string[] {
  return Array.from({ length: count }, () => crypto.randomUUID())
}

/**
 * Calculate chi-squared statistic for distribution evenness test
 * Returns chi-squared value - lower is more even distribution
 */
function calculateChiSquared(observed: number[], expected: number): number {
  return observed.reduce((sum, o) => sum + Math.pow(o - expected, 2) / expected, 0)
}

/**
 * Chi-squared critical values for significance levels
 * Degrees of freedom = partitionCount - 1
 */
function chiSquaredCriticalValue(df: number, alpha = 0.05): number {
  // Common critical values for alpha = 0.05
  const criticalValues: Record<number, number> = {
    1: 3.841,
    3: 7.815,
    7: 14.067,
    9: 16.919,
    15: 24.996,
    31: 44.985,
    63: 82.529,
    99: 123.225,
    127: 154.302,
    255: 293.247,
  }
  // Find closest key
  const closest = Object.keys(criticalValues)
    .map(Number)
    .reduce((prev, curr) => (Math.abs(curr - df) < Math.abs(prev - df) ? curr : prev))
  return criticalValues[closest] ?? df * 1.5 // fallback approximation
}

/**
 * Test data item with key field
 */
interface TestItem {
  id: string
  name: string
  value: number
}

/**
 * Create test items for shuffle tests
 */
function createTestItems(count: number): TestItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `item-${i}`,
    name: `Item ${i}`,
    value: i * 10,
  }))
}

/**
 * Object with custom toString for key routing
 */
class CustomKey {
  constructor(
    public readonly namespace: string,
    public readonly id: string
  ) {}

  toString(): string {
    return `${this.namespace}:${this.id}`
  }
}

// ============================================================================
// Consistent Routing Tests
// ============================================================================

describe('KeyedRouter: Consistent Routing', () => {
  let router: KeyedRouter<string>

  beforeEach(() => {
    router = createKeyedRouter<string>(16)
  })

  describe('route() method', () => {
    it('returns the same partition for the same key on repeated calls', () => {
      const key = 'test-key-123'
      const partition1 = router.route(key)
      const partition2 = router.route(key)
      const partition3 = router.route(key)

      expect(partition1).toBe(partition2)
      expect(partition2).toBe(partition3)
    })

    it('returns partition index within valid range [0, partitionCount)', () => {
      const keys = generateStringKeys(1000)

      for (const key of keys) {
        const partition = router.route(key)
        expect(partition).toBeGreaterThanOrEqual(0)
        expect(partition).toBeLessThan(16)
        expect(Number.isInteger(partition)).toBe(true)
      }
    })

    it('routes 100 unique keys consistently over 100 iterations', () => {
      const keys = generateStringKeys(100)
      const initialMappings = new Map<string, number>()

      // Record initial mappings
      for (const key of keys) {
        initialMappings.set(key, router.route(key))
      }

      // Verify consistency over 100 iterations
      for (let iteration = 0; iteration < 100; iteration++) {
        for (const key of keys) {
          expect(router.route(key)).toBe(initialMappings.get(key))
        }
      }
    })
  })

  describe('getPartition() method', () => {
    it('returns same result as route() for consistency', () => {
      const keys = generateStringKeys(100)

      for (const key of keys) {
        expect(router.getPartition(key)).toBe(router.route(key))
      }
    })

    it('handles empty string key', () => {
      const partition = router.getPartition('')
      expect(partition).toBeGreaterThanOrEqual(0)
      expect(partition).toBeLessThan(16)
    })

    it('handles very long keys (10KB)', () => {
      const longKey = 'a'.repeat(10_000)
      const partition = router.getPartition(longKey)
      expect(partition).toBeGreaterThanOrEqual(0)
      expect(partition).toBeLessThan(16)
    })

    it('handles keys with special characters', () => {
      const specialKeys = [
        'key/with/slashes',
        'key:with:colons',
        'key@with@at',
        'key#with#hash',
        'key with spaces',
        'key\twith\ttabs',
        'key\nwith\nnewlines',
        'key\u0000with\u0000nulls',
        '\u{1F600}\u{1F601}\u{1F602}', // emoji
        '\u4E2D\u6587\u5B57\u7B26', // Chinese characters
      ]

      for (const key of specialKeys) {
        const partition = router.getPartition(key)
        expect(partition).toBeGreaterThanOrEqual(0)
        expect(partition).toBeLessThan(16)
      }
    })
  })
})

// ============================================================================
// Distribution Evenness Tests
// ============================================================================

describe('KeyedRouter: Distribution Evenness', () => {
  describe('with 16 partitions', () => {
    let router: KeyedRouter<string>

    beforeEach(() => {
      router = createKeyedRouter<string>(16)
    })

    it('distributes 10K sequential keys approximately evenly', () => {
      const keys = generateStringKeys(10_000)
      const distribution = router.getDistribution(keys)

      const expected = 10_000 / 16 // 625 per partition
      const tolerance = expected * 0.15 // 15% tolerance

      for (const [partition, count] of distribution) {
        expect(count).toBeGreaterThan(expected - tolerance)
        expect(count).toBeLessThan(expected + tolerance)
      }
    })

    it('distributes 100K UUIDs approximately evenly', () => {
      const keys = generateUUIDs(100_000)
      const distribution = router.getDistribution(keys)

      const expected = 100_000 / 16 // 6250 per partition
      const tolerance = expected * 0.10 // 10% tolerance

      for (const [partition, count] of distribution) {
        expect(count).toBeGreaterThan(expected - tolerance)
        expect(count).toBeLessThan(expected + tolerance)
      }
    })

    it('passes chi-squared test for uniform distribution (1M keys)', () => {
      const keys = generateUUIDs(1_000_000)
      const distribution = router.getDistribution(keys)

      const observed = Array.from(distribution.values())
      const expected = 1_000_000 / 16

      const chiSquared = calculateChiSquared(observed, expected)
      const criticalValue = chiSquaredCriticalValue(15) // df = 16 - 1

      // Chi-squared should be below critical value for uniform distribution
      expect(chiSquared).toBeLessThan(criticalValue)
    })

    it('uses all 16 partitions with 10K keys', () => {
      const keys = generateStringKeys(10_000)
      const distribution = router.getDistribution(keys)

      expect(distribution.size).toBe(16)
      for (let i = 0; i < 16; i++) {
        expect(distribution.has(i)).toBe(true)
        expect(distribution.get(i)).toBeGreaterThan(0)
      }
    })
  })

  describe('with power-of-two partition counts', () => {
    it.each([2, 4, 8, 16, 32, 64, 128, 256])('distributes evenly across %d partitions', (partitionCount) => {
      const router = createKeyedRouter<string>(partitionCount)
      const keys = generateUUIDs(partitionCount * 1000)
      const distribution = router.getDistribution(keys)

      const expected = keys.length / partitionCount
      const tolerance = expected * 0.15

      expect(distribution.size).toBe(partitionCount)
      for (const [, count] of distribution) {
        expect(count).toBeGreaterThan(expected - tolerance)
        expect(count).toBeLessThan(expected + tolerance)
      }
    })
  })

  describe('with non-power-of-two partition counts', () => {
    it.each([3, 5, 7, 10, 13, 17, 100])('distributes evenly across %d partitions', (partitionCount) => {
      const router = createKeyedRouter<string>(partitionCount)
      const keys = generateUUIDs(partitionCount * 1000)
      const distribution = router.getDistribution(keys)

      const expected = keys.length / partitionCount
      const tolerance = expected * 0.20 // slightly higher tolerance for non-power-of-2

      expect(distribution.size).toBe(partitionCount)
      for (const [, count] of distribution) {
        expect(count).toBeGreaterThan(expected - tolerance)
        expect(count).toBeLessThan(expected + tolerance)
      }
    })
  })
})

// ============================================================================
// Batch Routing Tests
// ============================================================================

describe('KeyedRouter: Batch Routing', () => {
  let router: KeyedRouter<string>

  beforeEach(() => {
    router = createKeyedRouter<string>(8)
  })

  describe('routeBatch() method', () => {
    it('groups keys by their partition', () => {
      const keys = ['key-1', 'key-2', 'key-3', 'key-4', 'key-5']
      const batched = router.routeBatch(keys)

      // All keys should be present in some partition
      const allKeys = new Set<string>()
      for (const keys of batched.values()) {
        for (const key of keys) {
          allKeys.add(key)
        }
      }
      expect(allKeys.size).toBe(5)
      expect(allKeys.has('key-1')).toBe(true)
      expect(allKeys.has('key-5')).toBe(true)
    })

    it('returns empty map for empty input', () => {
      const batched = router.routeBatch([])
      expect(batched.size).toBe(0)
    })

    it('groups keys consistently with route()', () => {
      const keys = generateStringKeys(1000)
      const batched = router.routeBatch(keys)

      for (const [partition, partitionKeys] of batched) {
        for (const key of partitionKeys) {
          expect(router.route(key)).toBe(partition)
        }
      }
    })

    it('handles duplicate keys correctly', () => {
      const keys = ['key-1', 'key-2', 'key-1', 'key-3', 'key-1']
      const batched = router.routeBatch(keys)

      // Count total keys (duplicates should be preserved)
      let totalKeys = 0
      for (const partitionKeys of batched.values()) {
        totalKeys += partitionKeys.length
      }
      expect(totalKeys).toBe(5)
    })

    it('uses Map with number partition keys', () => {
      const keys = generateStringKeys(100)
      const batched = router.routeBatch(keys)

      for (const [partition] of batched) {
        expect(typeof partition).toBe('number')
        expect(partition).toBeGreaterThanOrEqual(0)
        expect(partition).toBeLessThan(8)
      }
    })

    it('processes 100K keys efficiently (< 500ms)', () => {
      const keys = generateStringKeys(100_000)

      const start = performance.now()
      const batched = router.routeBatch(keys)
      const elapsed = performance.now() - start

      expect(elapsed).toBeLessThan(500)
      expect(batched.size).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// Shuffle Operation Tests
// ============================================================================

describe('KeyedRouter: Shuffle Operations', () => {
  let router: KeyedRouter<string>

  beforeEach(() => {
    router = createKeyedRouter<string>(4)
  })

  describe('shuffle() method', () => {
    it('groups data items by key correctly', () => {
      const items = createTestItems(100)
      const shuffled = router.shuffle(items, (item) => item.id)

      // All items should be present
      let totalItems = 0
      for (const partitionItems of shuffled.values()) {
        totalItems += partitionItems.length
      }
      expect(totalItems).toBe(100)
    })

    it('preserves item data during shuffle', () => {
      const items: TestItem[] = [
        { id: 'a', name: 'Alpha', value: 100 },
        { id: 'b', name: 'Beta', value: 200 },
        { id: 'c', name: 'Gamma', value: 300 },
      ]
      const shuffled = router.shuffle(items, (item) => item.id)

      const allItems: TestItem[] = []
      for (const partitionItems of shuffled.values()) {
        allItems.push(...partitionItems)
      }

      expect(allItems).toContainEqual({ id: 'a', name: 'Alpha', value: 100 })
      expect(allItems).toContainEqual({ id: 'b', name: 'Beta', value: 200 })
      expect(allItems).toContainEqual({ id: 'c', name: 'Gamma', value: 300 })
    })

    it('groups items with same key into same partition', () => {
      const items: TestItem[] = [
        { id: 'shared-key', name: 'First', value: 1 },
        { id: 'shared-key', name: 'Second', value: 2 },
        { id: 'shared-key', name: 'Third', value: 3 },
        { id: 'other-key', name: 'Other', value: 4 },
      ]
      const shuffled = router.shuffle(items, (item) => item.id)

      // Find partition containing 'shared-key' items
      let sharedKeyPartition: number | null = null
      for (const [partition, partitionItems] of shuffled) {
        if (partitionItems.some((item) => item.id === 'shared-key')) {
          if (sharedKeyPartition === null) {
            sharedKeyPartition = partition
          } else {
            // All items with same key should be in same partition
            expect(partition).toBe(sharedKeyPartition)
          }
        }
      }

      // Verify all three shared-key items are together
      const sharedKeyItems = shuffled.get(sharedKeyPartition!)!
      const sharedKeyCount = sharedKeyItems.filter((item) => item.id === 'shared-key').length
      expect(sharedKeyCount).toBe(3)
    })

    it('handles empty data array', () => {
      const shuffled = router.shuffle([], (item: TestItem) => item.id)
      expect(shuffled.size).toBe(0)
    })

    it('works with different key extraction functions', () => {
      const items: TestItem[] = [
        { id: 'a', name: 'Name1', value: 100 },
        { id: 'b', name: 'Name2', value: 100 },
        { id: 'c', name: 'Name1', value: 200 },
      ]

      // Shuffle by value
      const byValue = router.shuffle(items, (item) => String(item.value))

      // Items with same value should be in same partition
      const value100Items: TestItem[] = []
      for (const partitionItems of byValue.values()) {
        value100Items.push(...partitionItems.filter((item) => item.value === 100))
      }

      // Verify items with value 100 are in the same partition
      const value100Partition = router.route('100')
      const partitionItems = byValue.get(value100Partition) ?? []
      expect(partitionItems.filter((item) => item.value === 100).length).toBe(2)
    })

    it('processes 100K items efficiently (< 1000ms)', () => {
      const items = createTestItems(100_000)

      const start = performance.now()
      const shuffled = router.shuffle(items, (item) => item.id)
      const elapsed = performance.now() - start

      expect(elapsed).toBeLessThan(1000)
      expect(shuffled.size).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// Partition Configuration Tests
// ============================================================================

describe('KeyedRouter: Partition Configuration', () => {
  describe('getPartitionCount() method', () => {
    it.each([1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024])('returns correct count for %d partitions', (count) => {
      const router = createKeyedRouter<string>(count)
      expect(router.getPartitionCount()).toBe(count)
    })

    it('returns correct count after construction', () => {
      const router = createKeyedRouter<string>(42)
      expect(router.getPartitionCount()).toBe(42)
    })
  })

  describe('constructor variations', () => {
    it('creates router with 1 partition', () => {
      const router = createKeyedRouter<string>(1)
      expect(router.getPartitionCount()).toBe(1)

      // All keys should route to partition 0
      const keys = generateStringKeys(100)
      for (const key of keys) {
        expect(router.route(key)).toBe(0)
      }
    })

    it('creates router with large partition count (10000)', () => {
      const router = createKeyedRouter<string>(10_000)
      expect(router.getPartitionCount()).toBe(10_000)

      // Verify distribution
      const keys = generateUUIDs(100_000)
      const distribution = router.getDistribution(keys)

      expect(distribution.size).toBeGreaterThan(9000) // Most partitions should have keys
    })

    it('throws error for zero partitions', () => {
      expect(() => createKeyedRouter<string>(0)).toThrow()
    })

    it('throws error for negative partitions', () => {
      expect(() => createKeyedRouter<string>(-1)).toThrow()
    })

    it('throws error for non-integer partitions', () => {
      expect(() => createKeyedRouter<string>(3.5)).toThrow()
    })

    it('accepts options object in constructor', () => {
      const options: KeyedRouterOptions = {
        partitionCount: 16,
        seed: 12345,
      }
      const router = createKeyedRouter<string>(options)
      expect(router.getPartitionCount()).toBe(16)
    })
  })
})

// ============================================================================
// Key Type Tests
// ============================================================================

describe('KeyedRouter: Different Key Types', () => {
  describe('string keys', () => {
    let router: KeyedRouter<string>

    beforeEach(() => {
      router = createKeyedRouter<string>(8)
    })

    it('routes string keys consistently', () => {
      const key = 'my-string-key'
      const p1 = router.route(key)
      const p2 = router.route(key)
      expect(p1).toBe(p2)
    })

    it('handles empty string', () => {
      const partition = router.route('')
      expect(partition).toBeGreaterThanOrEqual(0)
      expect(partition).toBeLessThan(8)
    })
  })

  describe('number keys', () => {
    let router: KeyedRouter<number>

    beforeEach(() => {
      router = createKeyedRouter<number>(8)
    })

    it('routes number keys consistently', () => {
      const key = 42
      const p1 = router.route(key)
      const p2 = router.route(key)
      expect(p1).toBe(p2)
    })

    it('routes different numbers to potentially different partitions', () => {
      const partitions = new Set<number>()
      for (let i = 0; i < 1000; i++) {
        partitions.add(router.route(i))
      }
      // With 1000 keys, we should hit most partitions
      expect(partitions.size).toBeGreaterThan(4)
    })

    it('handles zero', () => {
      const partition = router.route(0)
      expect(partition).toBeGreaterThanOrEqual(0)
      expect(partition).toBeLessThan(8)
    })

    it('handles negative numbers', () => {
      const partition = router.route(-42)
      expect(partition).toBeGreaterThanOrEqual(0)
      expect(partition).toBeLessThan(8)
    })

    it('handles very large numbers', () => {
      const partition = router.route(Number.MAX_SAFE_INTEGER)
      expect(partition).toBeGreaterThanOrEqual(0)
      expect(partition).toBeLessThan(8)
    })

    it('handles floating point numbers', () => {
      const partition = router.route(3.14159)
      expect(partition).toBeGreaterThanOrEqual(0)
      expect(partition).toBeLessThan(8)
    })
  })

  describe('object keys with toString', () => {
    let router: KeyedRouter<CustomKey>

    beforeEach(() => {
      router = createKeyedRouter<CustomKey>(8)
    })

    it('routes objects using their toString representation', () => {
      const key1 = new CustomKey('namespace', 'id-1')
      const key2 = new CustomKey('namespace', 'id-1') // Same string representation

      const p1 = router.route(key1)
      const p2 = router.route(key2)

      expect(p1).toBe(p2)
    })

    it('routes objects with different string representations to potentially different partitions', () => {
      const key1 = new CustomKey('namespace1', 'id')
      const key2 = new CustomKey('namespace2', 'id')

      // These might route to same partition by chance, but should be deterministic
      const p1 = router.route(key1)
      const p2 = router.route(key2)

      expect(typeof p1).toBe('number')
      expect(typeof p2).toBe('number')
    })

    it('handles shuffle with object keys', () => {
      interface ItemWithCustomKey {
        key: CustomKey
        data: string
      }

      const items: ItemWithCustomKey[] = [
        { key: new CustomKey('ns', 'a'), data: 'first' },
        { key: new CustomKey('ns', 'a'), data: 'second' },
        { key: new CustomKey('ns', 'b'), data: 'third' },
      ]

      const shuffled = router.shuffle(items, (item) => item.key)

      // Items with same key should be together
      let itemsWithKeyA = 0
      const keyAPartition = router.route(new CustomKey('ns', 'a'))
      const partitionItems = shuffled.get(keyAPartition) ?? []
      for (const item of partitionItems) {
        if (item.key.toString() === 'ns:a') {
          itemsWithKeyA++
        }
      }
      expect(itemsWithKeyA).toBe(2)
    })
  })
})

// ============================================================================
// Statistics and Distribution Tests
// ============================================================================

describe('KeyedRouter: Statistics', () => {
  let router: KeyedRouter<string>

  beforeEach(() => {
    router = createKeyedRouter<string>(8)
  })

  describe('getDistribution() method', () => {
    it('returns Map with partition to count mapping', () => {
      const keys = generateStringKeys(100)
      const distribution = router.getDistribution(keys)

      expect(distribution).toBeInstanceOf(Map)
      for (const [partition, count] of distribution) {
        expect(typeof partition).toBe('number')
        expect(typeof count).toBe('number')
        expect(count).toBeGreaterThan(0)
      }
    })

    it('returns empty map for empty keys', () => {
      const distribution = router.getDistribution([])
      expect(distribution.size).toBe(0)
    })

    it('correctly counts duplicate keys', () => {
      const keys = ['key-1', 'key-1', 'key-1', 'key-2']
      const distribution = router.getDistribution(keys)

      let total = 0
      for (const count of distribution.values()) {
        total += count
      }
      expect(total).toBe(4)
    })

    it('sums to total key count', () => {
      const keys = generateStringKeys(10_000)
      const distribution = router.getDistribution(keys)

      let total = 0
      for (const count of distribution.values()) {
        total += count
      }
      expect(total).toBe(10_000)
    })

    it('all partitions have counts consistent with individual routing', () => {
      const keys = generateStringKeys(1000)
      const distribution = router.getDistribution(keys)

      // Manually count and compare
      const manualCounts = new Map<number, number>()
      for (const key of keys) {
        const partition = router.route(key)
        manualCounts.set(partition, (manualCounts.get(partition) ?? 0) + 1)
      }

      expect(distribution.size).toBe(manualCounts.size)
      for (const [partition, count] of distribution) {
        expect(count).toBe(manualCounts.get(partition))
      }
    })
  })
})

// ============================================================================
// Determinism and Reproducibility Tests
// ============================================================================

describe('KeyedRouter: Determinism', () => {
  it('produces same routing for same keys across router instances', () => {
    const router1 = createKeyedRouter<string>(16)
    const router2 = createKeyedRouter<string>(16)

    const keys = generateStringKeys(1000)

    for (const key of keys) {
      expect(router1.route(key)).toBe(router2.route(key))
    }
  })

  it('produces same distribution across router instances', () => {
    const router1 = createKeyedRouter<string>(16)
    const router2 = createKeyedRouter<string>(16)

    const keys = generateUUIDs(10_000)

    const dist1 = router1.getDistribution(keys)
    const dist2 = router2.getDistribution(keys)

    expect(dist1.size).toBe(dist2.size)
    for (const [partition, count] of dist1) {
      expect(dist2.get(partition)).toBe(count)
    }
  })

  it('produces same shuffle results across router instances', () => {
    const router1 = createKeyedRouter<string>(8)
    const router2 = createKeyedRouter<string>(8)

    const items = createTestItems(100)
    const keyFn = (item: TestItem) => item.id

    const shuffle1 = router1.shuffle(items, keyFn)
    const shuffle2 = router2.shuffle(items, keyFn)

    expect(shuffle1.size).toBe(shuffle2.size)
    for (const [partition, items1] of shuffle1) {
      const items2 = shuffle2.get(partition)!
      expect(items1.length).toBe(items2.length)
      // Items should be in same order
      for (let i = 0; i < items1.length; i++) {
        expect(items1[i]).toEqual(items2[i])
      }
    }
  })

  it('seeded router produces deterministic results', () => {
    const options: KeyedRouterOptions = { partitionCount: 16, seed: 42 }
    const router1 = createKeyedRouter<string>(options)
    const router2 = createKeyedRouter<string>(options)

    const keys = generateUUIDs(1000)

    for (const key of keys) {
      expect(router1.route(key)).toBe(router2.route(key))
    }
  })

  it('different seeds produce different results', () => {
    const router1 = createKeyedRouter<string>({ partitionCount: 16, seed: 1 })
    const router2 = createKeyedRouter<string>({ partitionCount: 16, seed: 2 })

    const keys = generateUUIDs(10_000)
    const dist1 = router1.getDistribution(keys)
    const dist2 = router2.getDistribution(keys)

    // At least some partitions should have different counts
    let differences = 0
    for (const [partition, count1] of dist1) {
      const count2 = dist2.get(partition)
      if (count1 !== count2) {
        differences++
      }
    }
    expect(differences).toBeGreaterThan(0)
  })
})

// ============================================================================
// High Cardinality and Hot Key Tests
// ============================================================================

describe('KeyedRouter: High Cardinality', () => {
  it('handles 1M unique keys with good distribution', () => {
    const router = createKeyedRouter<string>(64)
    const keys = generateUUIDs(1_000_000)

    const distribution = router.getDistribution(keys)

    const expected = 1_000_000 / 64
    const tolerance = expected * 0.05 // 5% tolerance

    for (const [, count] of distribution) {
      expect(count).toBeGreaterThan(expected - tolerance)
      expect(count).toBeLessThan(expected + tolerance)
    }
  })

  it('maintains consistent routing under high volume (500K calls)', () => {
    const router = createKeyedRouter<string>(32)
    const testKey = 'my-consistent-key'
    const expectedPartition = router.route(testKey)

    // Reduced from 5M to 500K for reasonable test duration
    for (let i = 0; i < 500_000; i++) {
      expect(router.route(testKey)).toBe(expectedPartition)
    }
  })
})

describe('KeyedRouter: Hot Key Detection', () => {
  it('same key returns same partition regardless of call frequency', () => {
    const router = createKeyedRouter<string>(16)
    const hotKey = 'hot-key'
    const coldKey = 'cold-key'

    // Route cold key once
    const coldPartition = router.route(coldKey)

    // Route hot key many times
    let hotPartition: number | null = null
    for (let i = 0; i < 100_000; i++) {
      const partition = router.route(hotKey)
      if (hotPartition === null) {
        hotPartition = partition
      } else {
        expect(partition).toBe(hotPartition)
      }
    }

    // Cold key should still route to same partition
    expect(router.route(coldKey)).toBe(coldPartition)
  })
})

// ============================================================================
// Hash Collision and Edge Cases Tests
// ============================================================================

describe('KeyedRouter: Hash Collision Handling', () => {
  it('allows different keys to route to same partition (collisions are OK)', () => {
    const router = createKeyedRouter<string>(2) // Only 2 partitions - collisions guaranteed

    const keys = generateStringKeys(100)
    const partition0Keys: string[] = []
    const partition1Keys: string[] = []

    for (const key of keys) {
      const partition = router.route(key)
      if (partition === 0) {
        partition0Keys.push(key)
      } else {
        partition1Keys.push(key)
      }
    }

    // Both partitions should have keys (collisions happened)
    expect(partition0Keys.length).toBeGreaterThan(0)
    expect(partition1Keys.length).toBeGreaterThan(0)
  })

  it('maintains collision consistency - colliding keys always collide', () => {
    const router = createKeyedRouter<string>(2)

    // Find two keys that collide
    const key1 = 'test-a'
    const key2 = 'test-b'
    const p1 = router.route(key1)
    const p2 = router.route(key2)

    // If they collide, they should always collide
    // If they don't, they should always not collide
    for (let i = 0; i < 1000; i++) {
      if (p1 === p2) {
        expect(router.route(key1)).toBe(router.route(key2))
      } else {
        expect(router.route(key1)).not.toBe(router.route(key2))
      }
    }
  })
})

describe('KeyedRouter: Edge Cases', () => {
  it('handles null-like values in string keys', () => {
    const router = createKeyedRouter<string>(8)

    const edgeCases = ['null', 'undefined', 'NaN', 'Infinity', '-Infinity']

    for (const key of edgeCases) {
      const partition = router.route(key)
      expect(partition).toBeGreaterThanOrEqual(0)
      expect(partition).toBeLessThan(8)
    }
  })

  it('handles single key in batch', () => {
    const router = createKeyedRouter<string>(8)
    const batched = router.routeBatch(['only-key'])

    let totalKeys = 0
    for (const keys of batched.values()) {
      totalKeys += keys.length
    }
    expect(totalKeys).toBe(1)
  })

  it('handles single item in shuffle', () => {
    const router = createKeyedRouter<string>(8)
    const items = [{ id: 'only', data: 'item' }]
    const shuffled = router.shuffle(items, (item) => item.id)

    let totalItems = 0
    for (const partitionItems of shuffled.values()) {
      totalItems += partitionItems.length
    }
    expect(totalItems).toBe(1)
  })

  it('handles very similar keys differently', () => {
    const router = createKeyedRouter<string>(256)

    // These keys are very similar but should still distribute
    const similarKeys = Array.from({ length: 1000 }, (_, i) => `key-${String(i).padStart(10, '0')}`)
    const distribution = router.getDistribution(similarKeys)

    // Should use multiple partitions even with similar keys
    expect(distribution.size).toBeGreaterThan(50)
  })

  it('handles binary-like string keys', () => {
    const router = createKeyedRouter<string>(8)

    const binaryKeys = [
      '\x00\x01\x02\x03',
      '\xff\xfe\xfd\xfc',
      '\x00\x00\x00\x00',
      '\xff\xff\xff\xff',
    ]

    for (const key of binaryKeys) {
      const partition = router.route(key)
      expect(partition).toBeGreaterThanOrEqual(0)
      expect(partition).toBeLessThan(8)
    }
  })
})

// ============================================================================
// Performance Tests
// ============================================================================

describe('KeyedRouter: Performance', () => {
  it('routes 1M keys in under 2 seconds', () => {
    const router = createKeyedRouter<string>(64)
    const keys = generateStringKeys(1_000_000)

    const start = performance.now()
    for (const key of keys) {
      router.route(key)
    }
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(2000)
  })

  it('batches 1M keys in under 3 seconds', () => {
    const router = createKeyedRouter<string>(64)
    const keys = generateStringKeys(1_000_000)

    const start = performance.now()
    router.routeBatch(keys)
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(3000)
  })

  it('shuffles 1M items in under 5 seconds', () => {
    const router = createKeyedRouter<string>(64)
    const items = createTestItems(1_000_000)

    const start = performance.now()
    router.shuffle(items, (item) => item.id)
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(5000)
  })

  it('computes distribution of 1M keys in under 3 seconds', () => {
    const router = createKeyedRouter<string>(64)
    const keys = generateStringKeys(1_000_000)

    const start = performance.now()
    router.getDistribution(keys)
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(3000)
  })

  it('route() has O(1) complexity per key', () => {
    const router = createKeyedRouter<string>(64)

    // Measure time for 10K routes
    const keys10k = generateStringKeys(10_000)
    const start10k = performance.now()
    for (const key of keys10k) {
      router.route(key)
    }
    const time10k = performance.now() - start10k

    // Measure time for 100K routes
    const keys100k = generateStringKeys(100_000)
    const start100k = performance.now()
    for (const key of keys100k) {
      router.route(key)
    }
    const time100k = performance.now() - start100k

    // 100K should take roughly 10x the time of 10K (O(n) overall, O(1) per key)
    // Allow 15x as upper bound for variance
    const ratio = time100k / time10k
    expect(ratio).toBeLessThan(15)
    expect(ratio).toBeGreaterThan(5) // Should be at least 5x (some overhead expected)
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('KeyedRouter: Integration Scenarios', () => {
  it('simulates distributed shuffle-join scenario', () => {
    const router = createKeyedRouter<string>(4)

    // Left table data
    const orders: Array<{ orderId: string; customerId: string; amount: number }> = [
      { orderId: 'O1', customerId: 'C1', amount: 100 },
      { orderId: 'O2', customerId: 'C2', amount: 200 },
      { orderId: 'O3', customerId: 'C1', amount: 150 },
      { orderId: 'O4', customerId: 'C3', amount: 300 },
    ]

    // Right table data
    const customers: Array<{ customerId: string; name: string }> = [
      { customerId: 'C1', name: 'Alice' },
      { customerId: 'C2', name: 'Bob' },
      { customerId: 'C3', name: 'Charlie' },
    ]

    // Shuffle both by join key (customerId)
    const ordersShuffled = router.shuffle(orders, (o) => o.customerId)
    const customersShuffled = router.shuffle(customers, (c) => c.customerId)

    // Verify matching customers and orders are in same partition
    const c1Partition = router.route('C1')
    const orderPartitionC1 = ordersShuffled.get(c1Partition) ?? []
    const customerPartitionC1 = customersShuffled.get(c1Partition) ?? []

    const c1Orders = orderPartitionC1.filter((o) => o.customerId === 'C1')
    const c1Customer = customerPartitionC1.filter((c) => c.customerId === 'C1')

    expect(c1Orders.length).toBe(2) // O1 and O3
    expect(c1Customer.length).toBe(1) // C1
  })

  it('simulates map-reduce word count aggregation', () => {
    const router = createKeyedRouter<string>(3)

    // Map phase output: (word, count) pairs
    const mapOutput: Array<{ word: string; count: number }> = [
      { word: 'hello', count: 1 },
      { word: 'world', count: 1 },
      { word: 'hello', count: 1 },
      { word: 'foo', count: 1 },
      { word: 'world', count: 1 },
      { word: 'hello', count: 1 },
    ]

    // Shuffle by word (key)
    const shuffled = router.shuffle(mapOutput, (item) => item.word)

    // In reduce phase, all instances of same word are together
    for (const [partition, items] of shuffled) {
      // Group by word within partition
      const wordGroups = new Map<string, number>()
      for (const item of items) {
        wordGroups.set(item.word, (wordGroups.get(item.word) ?? 0) + item.count)
      }

      // Each word in this partition should only appear in this partition
      for (const word of wordGroups.keys()) {
        expect(router.route(word)).toBe(partition)
      }
    }
  })

  it('simulates partitioned time-series data routing', () => {
    const router = createKeyedRouter<string>(24) // 24 partitions for 24 hours

    interface TimeSeriesPoint {
      timestamp: Date
      sensorId: string
      value: number
    }

    const data: TimeSeriesPoint[] = Array.from({ length: 1000 }, (_, i) => ({
      timestamp: new Date(2024, 0, 1, i % 24, 0, 0),
      sensorId: `sensor-${i % 10}`,
      value: Math.random() * 100,
    }))

    // Route by sensor ID for co-located sensor data
    const shuffled = router.shuffle(data, (point) => point.sensorId)

    // All data from same sensor should be in same partition
    const sensor0Partition = router.route('sensor-0')
    const sensor0Data = (shuffled.get(sensor0Partition) ?? []).filter((p) => p.sensorId === 'sensor-0')

    expect(sensor0Data.length).toBe(100) // 1000 / 10 sensors
  })
})
