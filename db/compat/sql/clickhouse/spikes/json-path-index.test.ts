/**
 * Tests for JSON Path Indexing - Automatic statistics and bloom filters
 *
 * Run: npx vitest run json-path-index.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  JSONPathIndex,
  BloomFilter,
  HyperLogLog,
  PathStatistics,
  JSONValue
} from './json-path-index'

describe('BloomFilter', () => {
  describe('basic operations', () => {
    it('should add and check membership', () => {
      const filter = new BloomFilter(100, 0.01)

      filter.add('alice')
      filter.add('bob')
      filter.add('charlie')

      expect(filter.has('alice')).toBe(true)
      expect(filter.has('bob')).toBe(true)
      expect(filter.has('charlie')).toBe(true)
    })

    it('should return false for items not added', () => {
      const filter = new BloomFilter(100, 0.01)

      filter.add('alice')

      expect(filter.has('bob')).toBe(false)
      expect(filter.has('charlie')).toBe(false)
      expect(filter.has('david')).toBe(false)
    })

    it('should track count of added items', () => {
      const filter = new BloomFilter(100, 0.01)

      filter.add('a')
      filter.add('b')
      filter.add('c')

      expect(filter.getCount()).toBe(3)
    })
  })

  describe('false positive rate', () => {
    it('should maintain false positive rate below 1%', () => {
      const expectedItems = 10000
      const fpRate = 0.01
      const filter = new BloomFilter(expectedItems, fpRate)

      // Add expected number of items
      for (let i = 0; i < expectedItems; i++) {
        filter.add(`item-${i}`)
      }

      // Test false positives with items NOT in the set
      let falsePositives = 0
      const testCount = 10000
      for (let i = 0; i < testCount; i++) {
        if (filter.has(`not-in-set-${i}`)) {
          falsePositives++
        }
      }

      const actualFPRate = falsePositives / testCount
      console.log(`False positive rate: ${(actualFPRate * 100).toFixed(2)}% (target: ${fpRate * 100}%)`)

      // Allow some margin for randomness
      expect(actualFPRate).toBeLessThan(fpRate * 2)
    })

    it('should have lower FP rate with lower capacity utilization', () => {
      const filter = new BloomFilter(10000, 0.01)

      // Add only 1000 items (10% utilization)
      for (let i = 0; i < 1000; i++) {
        filter.add(`item-${i}`)
      }

      let falsePositives = 0
      for (let i = 0; i < 10000; i++) {
        if (filter.has(`not-in-set-${i}`)) {
          falsePositives++
        }
      }

      const actualFPRate = falsePositives / 10000
      expect(actualFPRate).toBeLessThan(0.001)  // Should be much lower
    })
  })

  describe('serialization', () => {
    it('should serialize and deserialize correctly', () => {
      const filter = new BloomFilter(100, 0.01)
      filter.add('alice')
      filter.add('bob')

      const serialized = filter.serialize()
      const restored = BloomFilter.deserialize(serialized, 100, 0.01)

      expect(restored.has('alice')).toBe(true)
      expect(restored.has('bob')).toBe(true)
      expect(restored.has('charlie')).toBe(false)
    })
  })
})

describe('HyperLogLog', () => {
  describe('cardinality estimation', () => {
    it('should estimate cardinality for small sets', () => {
      const hll = new HyperLogLog(14)

      hll.add('alice')
      hll.add('bob')
      hll.add('charlie')

      const estimate = hll.count()
      expect(estimate).toBeGreaterThanOrEqual(2)
      expect(estimate).toBeLessThanOrEqual(5)
    })

    it('should handle duplicate values', () => {
      const hll = new HyperLogLog(14)

      // Add same value multiple times
      for (let i = 0; i < 1000; i++) {
        hll.add('duplicate')
      }

      expect(hll.count()).toBe(1)
    })

    it('should estimate large cardinalities with reasonable accuracy', () => {
      const hll = new HyperLogLog(14)
      const actualCardinality = 100000

      for (let i = 0; i < actualCardinality; i++) {
        hll.add(`item-${i}`)
      }

      const estimate = hll.count()
      const error = Math.abs(estimate - actualCardinality) / actualCardinality

      console.log(`HLL estimate: ${estimate}, actual: ${actualCardinality}, error: ${(error * 100).toFixed(2)}%`)

      // Standard error should be ~1.6% for precision 14
      expect(error).toBeLessThan(0.1)  // Allow 10% error for single sample
    })

    it('should provide accuracy estimate', () => {
      const hll = new HyperLogLog(14)
      const accuracy = hll.getAccuracy()

      // Precision 14 = 2^14 = 16384 registers
      // Standard error = 1.04 / sqrt(16384) = ~0.0081
      expect(accuracy).toBeCloseTo(0.0081, 3)
    })
  })

  describe('merge', () => {
    it('should merge two HyperLogLogs', () => {
      const hll1 = new HyperLogLog(14)
      const hll2 = new HyperLogLog(14)

      for (let i = 0; i < 5000; i++) {
        hll1.add(`set1-${i}`)
      }

      for (let i = 0; i < 5000; i++) {
        hll2.add(`set2-${i}`)
      }

      hll1.merge(hll2)

      const estimate = hll1.count()
      expect(estimate).toBeGreaterThan(8000)
      expect(estimate).toBeLessThan(12000)
    })

    it('should throw on precision mismatch', () => {
      const hll1 = new HyperLogLog(14)
      const hll2 = new HyperLogLog(10)

      expect(() => hll1.merge(hll2)).toThrow('Cannot merge HyperLogLog with different precision')
    })
  })
})

describe('JSONPathIndex', () => {
  let index: JSONPathIndex

  beforeEach(() => {
    index = new JSONPathIndex()
  })

  describe('path extraction', () => {
    it('should extract simple paths', () => {
      index.write({ name: 'Alice', age: 30 })

      const paths = index.getAllPaths()
      expect(paths).toContain('name')
      expect(paths).toContain('age')
    })

    it('should extract nested paths', () => {
      index.write({
        user: {
          name: 'Alice',
          email: 'alice@example.com.ai',
          address: {
            city: 'NYC',
            zip: '10001'
          }
        }
      })

      const paths = index.getAllPaths()
      expect(paths).toContain('user')
      expect(paths).toContain('user.name')
      expect(paths).toContain('user.email')
      expect(paths).toContain('user.address')
      expect(paths).toContain('user.address.city')
      expect(paths).toContain('user.address.zip')
    })

    it('should extract array paths with [] notation', () => {
      index.write({
        users: [
          { name: 'Alice' },
          { name: 'Bob' }
        ]
      })

      const paths = index.getAllPaths()
      expect(paths).toContain('users')
      expect(paths).toContain('users[]')
      expect(paths).toContain('users[].name')
    })

    it('should handle deeply nested arrays', () => {
      index.write({
        matrix: [[1, 2], [3, 4]]
      })

      const paths = index.getAllPaths()
      expect(paths).toContain('matrix')
      expect(paths).toContain('matrix[]')
      expect(paths).toContain('matrix[][]')
    })

    it('should respect maxDepth option', () => {
      index = new JSONPathIndex({ maxDepth: 3 })
      index.write({
        a: { b: { c: { d: 'deep' } } }
      })

      const paths = index.getAllPaths()
      expect(paths).toContain('a')
      expect(paths).toContain('a.b')
      expect(paths).toContain('a.b.c')
      expect(paths).not.toContain('a.b.c.d')
    })
  })

  describe('frequency tracking', () => {
    it('should count path frequency across documents', () => {
      index.write({ name: 'Alice' })
      index.write({ name: 'Bob' })
      index.write({ name: 'Charlie', extra: 'field' })

      const nameStats = index.getPathStats('name')
      const extraStats = index.getPathStats('extra')

      expect(nameStats?.frequency).toBe(3)
      expect(extraStats?.frequency).toBe(1)
    })

    it('should track document count', () => {
      index.write({ a: 1 })
      index.write({ b: 2 })
      index.write({ c: 3 })

      expect(index.getDocumentCount()).toBe(3)
    })
  })

  describe('type detection', () => {
    it('should detect string type', () => {
      index.write({ name: 'Alice' })
      expect(index.getPathStats('name')?.type).toBe('string')
    })

    it('should detect number type', () => {
      index.write({ age: 30 })
      expect(index.getPathStats('age')?.type).toBe('number')
    })

    it('should detect boolean type', () => {
      index.write({ active: true })
      expect(index.getPathStats('active')?.type).toBe('boolean')
    })

    it('should detect array type', () => {
      index.write({ items: [1, 2, 3] })
      expect(index.getPathStats('items')?.type).toBe('array')
    })

    it('should detect object type', () => {
      index.write({ meta: { key: 'value' } })
      expect(index.getPathStats('meta')?.type).toBe('object')
    })

    it('should detect null type', () => {
      index.write({ empty: null })
      expect(index.getPathStats('empty')?.type).toBe('null')
    })

    it('should use first non-null type seen', () => {
      index.write({ field: null })
      index.write({ field: 'string' })
      index.write({ field: null })

      expect(index.getPathStats('field')?.type).toBe('string')
    })
  })

  describe('cardinality estimation', () => {
    it('should estimate cardinality for unique values', () => {
      for (let i = 0; i < 1000; i++) {
        index.write({ id: `user-${i}` })
      }

      const stats = index.getPathStats('id')
      expect(stats?.cardinality).toBeGreaterThan(900)
      expect(stats?.cardinality).toBeLessThan(1100)
    })

    it('should estimate cardinality for repeated values', () => {
      const categories = ['A', 'B', 'C', 'D', 'E']
      for (let i = 0; i < 1000; i++) {
        index.write({ category: categories[i % 5] })
      }

      const stats = index.getPathStats('category')
      expect(stats?.cardinality).toBe(5)
    })
  })

  describe('bloom filter generation', () => {
    it('should not create bloom filter below threshold', () => {
      index = new JSONPathIndex({ bloomThreshold: 100 })

      for (let i = 0; i < 50; i++) {
        index.write({ email: `user${i}@example.com.ai` })
      }

      expect(index.getBloomFilter('email')).toBeNull()
    })

    it('should create bloom filter at threshold', () => {
      index = new JSONPathIndex({ bloomThreshold: 100 })

      for (let i = 0; i < 100; i++) {
        index.write({ email: `user${i}@example.com.ai` })
      }

      expect(index.getBloomFilter('email')).not.toBeNull()
    })

    it('should allow testing bloom filter', () => {
      index = new JSONPathIndex({ bloomThreshold: 10 })

      for (let i = 0; i < 100; i++) {
        index.write({ email: `user${i}@example.com.ai` })
      }

      expect(index.testBloomFilter('email', 'user50@example.com.ai')).toBe(true)
      expect(index.testBloomFilter('email', 'notinset@example.com.ai')).toBe(false)
    })

    it('should return false for unknown paths', () => {
      index.write({ name: 'Alice' })
      expect(index.testBloomFilter('unknown', 'value')).toBe(false)
    })

    it('should include serialized bloom filter in stats', () => {
      index = new JSONPathIndex({ bloomThreshold: 10 })

      for (let i = 0; i < 100; i++) {
        index.write({ id: `item-${i}` })
      }

      const stats = index.getPathStats('id')
      expect(stats?.bloomFilter).toBeInstanceOf(Uint8Array)
      expect(stats?.bloomFilter?.length).toBeGreaterThan(0)
    })
  })

  describe('path queries', () => {
    beforeEach(() => {
      index.write({
        user: {
          name: 'Alice',
          email: 'alice@example.com.ai',
          address: {
            city: 'NYC',
            zip: '10001'
          }
        },
        order: {
          id: '123',
          items: [{ sku: 'A1' }]
        }
      })
    })

    it('should find paths matching pattern', () => {
      const userPaths = index.findPaths('user.*')
      expect(userPaths).toContain('user.name')
      expect(userPaths).toContain('user.email')
      expect(userPaths).toContain('user.address')
    })

    it('should find nested paths with wildcard', () => {
      const cityPaths = index.findPaths('*.*.city')
      expect(cityPaths).toContain('user.address.city')
    })

    it('should get all stats sorted by frequency', () => {
      // Add more documents to create frequency differences
      index.write({ user: { name: 'Bob' } })
      index.write({ user: { name: 'Charlie' } })

      const stats = index.getAllStats()
      expect(stats[0].path).toBe('user')  // Most frequent
      expect(stats[1].path).toBe('user.name')  // Second most
    })
  })

  describe('cardinality filtering', () => {
    it('should get high cardinality paths', () => {
      // High cardinality path
      for (let i = 0; i < 500; i++) {
        index.write({ userId: `user-${i}`, status: i % 3 === 0 ? 'active' : 'inactive' })
      }

      const highCard = index.getHighCardinalityPaths(100)
      expect(highCard.some(s => s.path === 'userId')).toBe(true)
      expect(highCard.some(s => s.path === 'status')).toBe(false)
    })

    it('should get low cardinality paths', () => {
      for (let i = 0; i < 500; i++) {
        index.write({ userId: `user-${i}`, status: i % 3 === 0 ? 'active' : 'inactive' })
      }

      const lowCard = index.getLowCardinalityPaths(10)
      expect(lowCard.some(s => s.path === 'status')).toBe(true)
      expect(lowCard.some(s => s.path === 'userId')).toBe(false)
    })
  })

  describe('performance', () => {
    it('should process documents in under 1ms on average', () => {
      // Warm up
      for (let i = 0; i < 100; i++) {
        index.write({ warmup: i })
      }

      // Create a realistic document
      const createDoc = (i: number) => ({
        id: `doc-${i}`,
        type: 'event',
        timestamp: Date.now(),
        user: {
          id: `user-${i % 1000}`,
          name: `User ${i}`,
          email: `user${i}@example.com.ai`,
          metadata: {
            created: Date.now(),
            tags: ['tag1', 'tag2', 'tag3']
          }
        },
        data: {
          action: 'click',
          target: 'button',
          properties: {
            x: Math.random() * 100,
            y: Math.random() * 100
          }
        }
      })

      const iterations = 10000
      const start = performance.now()

      for (let i = 0; i < iterations; i++) {
        index.write(createDoc(i))
      }

      const elapsed = performance.now() - start
      const avgTime = elapsed / iterations

      console.log(`Average write time: ${avgTime.toFixed(4)}ms per document`)
      console.log(`Total paths tracked: ${index.getAllPaths().length}`)
      console.log(`Documents indexed: ${index.getDocumentCount()}`)

      expect(avgTime).toBeLessThan(1)  // Must be under 1ms
    })

    it('should handle wide documents efficiently', () => {
      // Document with many top-level keys
      const wideDoc: Record<string, unknown> = {}
      for (let i = 0; i < 100; i++) {
        wideDoc[`field${i}`] = `value${i}`
      }

      const iterations = 1000
      const start = performance.now()

      for (let i = 0; i < iterations; i++) {
        index.write(wideDoc)
      }

      const elapsed = performance.now() - start
      const avgTime = elapsed / iterations

      console.log(`Wide doc (100 fields) avg time: ${avgTime.toFixed(4)}ms`)
      expect(avgTime).toBeLessThan(1)
    })

    it('should handle deeply nested documents', () => {
      // Create deeply nested document
      const createDeep = (depth: number): Record<string, unknown> => {
        if (depth === 0) return { value: 'leaf' }
        return { nested: createDeep(depth - 1) }
      }

      const deepDoc = createDeep(10)
      const iterations = 1000
      const start = performance.now()

      for (let i = 0; i < iterations; i++) {
        index.write(deepDoc as Record<string, unknown>)
      }

      const elapsed = performance.now() - start
      const avgTime = elapsed / iterations

      console.log(`Deep doc (10 levels) avg time: ${avgTime.toFixed(4)}ms`)
      expect(avgTime).toBeLessThan(1)
    })
  })

  describe('edge cases', () => {
    it('should handle empty documents', () => {
      index.write({})
      expect(index.getAllPaths()).toHaveLength(0)
      expect(index.getDocumentCount()).toBe(1)
    })

    it('should handle null values', () => {
      index.write({ nullField: null })
      expect(index.getAllPaths()).toContain('nullField')
    })

    it('should handle empty arrays', () => {
      index.write({ items: [] })
      expect(index.getAllPaths()).toContain('items')
    })

    it('should handle empty nested objects', () => {
      index.write({ meta: {} })
      expect(index.getAllPaths()).toContain('meta')
    })

    it('should handle mixed array types', () => {
      index.write({ mixed: [1, 'two', true, null, { key: 'value' }] })
      expect(index.getAllPaths()).toContain('mixed')
      expect(index.getAllPaths()).toContain('mixed[]')
      expect(index.getAllPaths()).toContain('mixed[].key')
    })

    it('should handle special characters in keys', () => {
      index.write({ 'key-with-dash': 1, 'key.with.dots': 2, 'key with spaces': 3 })
      expect(index.getAllPaths()).toContain('key-with-dash')
      expect(index.getAllPaths()).toContain('key.with.dots')
      expect(index.getAllPaths()).toContain('key with spaces')
    })

    it('should handle numeric strings', () => {
      index.write({ '123': 'numeric key', nested: { '456': 'also numeric' } })
      expect(index.getAllPaths()).toContain('123')
      expect(index.getAllPaths()).toContain('nested.456')
    })
  })

  describe('statistics accuracy', () => {
    it('should maintain accurate frequency under heavy load', () => {
      const expectedFreq = 10000
      for (let i = 0; i < expectedFreq; i++) {
        index.write({ counter: i })
      }

      const stats = index.getPathStats('counter')
      expect(stats?.frequency).toBe(expectedFreq)
    })

    it('should handle cardinality edge cases', () => {
      // All same values
      for (let i = 0; i < 1000; i++) {
        index.write({ constant: 'same' })
      }
      expect(index.getPathStats('constant')?.cardinality).toBe(1)

      // All unique values
      index = new JSONPathIndex()
      for (let i = 0; i < 1000; i++) {
        index.write({ unique: `val-${i}` })
      }
      const card = index.getPathStats('unique')?.cardinality
      expect(card).toBeGreaterThan(900)
      expect(card).toBeLessThan(1100)
    })
  })
})

describe('Real-world scenarios', () => {
  it('should handle ClickHouse-style event data', () => {
    const index = new JSONPathIndex({ bloomThreshold: 50 })

    // Simulate event ingestion
    const events = [
      { type: 'pageview', url: '/home', user_id: 'u1', timestamp: Date.now() },
      { type: 'click', element: 'button', user_id: 'u2', timestamp: Date.now() },
      { type: 'pageview', url: '/about', user_id: 'u1', timestamp: Date.now() },
      { type: 'purchase', amount: 99.99, user_id: 'u3', timestamp: Date.now() }
    ]

    for (let i = 0; i < 100; i++) {
      const event = events[i % events.length]
      index.write({ ...event, session_id: `s${i % 10}` })
    }

    // Should identify common paths
    const allPaths = index.getAllPaths()
    expect(allPaths).toContain('type')
    expect(allPaths).toContain('timestamp')
    expect(allPaths).toContain('user_id')

    // Should have bloom filter for type (low cardinality, high frequency)
    expect(index.testBloomFilter('type', 'pageview')).toBe(true)
    expect(index.testBloomFilter('type', 'nonexistent')).toBe(false)
  })

  it('should optimize query planning with statistics', () => {
    const index = new JSONPathIndex({ bloomThreshold: 10 })

    // Simulate a user table with varying cardinality
    for (let i = 0; i < 1000; i++) {
      index.write({
        id: `user-${i}`,                    // High cardinality
        email: `user${i}@example.com.ai`,      // High cardinality
        country: ['US', 'UK', 'DE', 'FR', 'JP'][i % 5],  // Low cardinality
        plan: i < 100 ? 'enterprise' : 'free',           // Very low cardinality
        active: i % 10 !== 0                             // Boolean
      })
    }

    const stats = index.getAllStats()

    // Find best columns for filtering
    const idStats = stats.find(s => s.path === 'id')!
    const countryStats = stats.find(s => s.path === 'country')!
    const planStats = stats.find(s => s.path === 'plan')!

    // id should have high cardinality (good for unique lookups)
    expect(idStats.cardinality).toBeGreaterThan(900)

    // country should have low cardinality (good for bloom filter)
    expect(countryStats.cardinality).toBe(5)

    // plan should have very low cardinality
    expect(planStats.cardinality).toBe(2)

    // Bloom filters should work for filtering
    expect(index.testBloomFilter('country', 'US')).toBe(true)
    expect(index.testBloomFilter('country', 'AU')).toBe(false)  // Not in data
  })
})
