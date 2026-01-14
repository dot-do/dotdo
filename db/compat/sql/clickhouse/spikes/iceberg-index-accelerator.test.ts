/**
 * Tests for Iceberg Index Accelerator Spike
 *
 * Validates that DO-based indexes can accelerate queries
 * over cold R2 Iceberg storage
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  IcebergIndexAccelerator,
  BloomFilter,
  MinMaxIndex,
  generateTestManifest,
  generateTestEmails,
  type ParsedQuery,
  type IcebergManifest,
} from './iceberg-index-accelerator'

describe('Iceberg Index Accelerator', () => {
  // ============================================================================
  // Bloom Filter Tests
  // ============================================================================
  describe('BloomFilter', () => {
    it('should return true for added items', () => {
      const filter = new BloomFilter(1000, 0.01)

      filter.add('alice@example.com')
      filter.add('bob@example.com')
      filter.add('charlie@example.com')

      expect(filter.mightContain('alice@example.com')).toBe(true)
      expect(filter.mightContain('bob@example.com')).toBe(true)
      expect(filter.mightContain('charlie@example.com')).toBe(true)
    })

    it('should return false for items definitely not in set', () => {
      const filter = new BloomFilter(1000, 0.01)
      const emails = generateTestEmails(100)

      for (const email of emails) {
        filter.add(email)
      }

      // Test items not added
      let falsePositives = 0
      for (let i = 100; i < 200; i++) {
        if (filter.mightContain(`notadded${i}@example.com`)) {
          falsePositives++
        }
      }

      // False positive rate should be around 1%
      expect(falsePositives / 100).toBeLessThan(0.05)
    })

    it('should serialize and deserialize correctly', () => {
      const filter = new BloomFilter(1000, 0.01)
      filter.add('test@example.com')
      filter.add('test2@example.com')

      const serialized = filter.serialize()
      const deserialized = BloomFilter.deserialize(serialized)

      expect(deserialized.mightContain('test@example.com')).toBe(true)
      expect(deserialized.mightContain('test2@example.com')).toBe(true)
      expect(deserialized.mightContain('notadded@example.com')).toBe(false)
    })
  })

  // ============================================================================
  // Min/Max Index Tests
  // ============================================================================
  describe('MinMaxIndex', () => {
    let index: MinMaxIndex

    beforeEach(() => {
      index = new MinMaxIndex()

      // Add partition stats
      index.addPartitionStats('createdAt', {
        column: 'createdAt',
        partitionKey: 'dt=2024-01-01',
        minValue: new Date('2024-01-01').getTime(),
        maxValue: new Date('2024-01-01T23:59:59').getTime(),
        nullCount: 0,
        rowCount: 10000,
      })
      index.addPartitionStats('createdAt', {
        column: 'createdAt',
        partitionKey: 'dt=2024-01-15',
        minValue: new Date('2024-01-15').getTime(),
        maxValue: new Date('2024-01-15T23:59:59').getTime(),
        nullCount: 0,
        rowCount: 10000,
      })
      index.addPartitionStats('createdAt', {
        column: 'createdAt',
        partitionKey: 'dt=2024-01-31',
        minValue: new Date('2024-01-31').getTime(),
        maxValue: new Date('2024-01-31T23:59:59').getTime(),
        nullCount: 0,
        rowCount: 10000,
      })
    })

    it('should prune partitions for equality predicates', () => {
      const matching = index.findPartitions('createdAt', {
        column: 'createdAt',
        op: '=',
        value: new Date('2024-01-15T12:00:00').getTime(),
      })

      expect(matching).toContain('dt=2024-01-15')
      expect(matching).not.toContain('dt=2024-01-01')
      expect(matching).not.toContain('dt=2024-01-31')
    })

    it('should prune partitions for range predicates', () => {
      const matching = index.findPartitions('createdAt', {
        column: 'createdAt',
        op: '>',
        value: new Date('2024-01-20').getTime(),
      })

      expect(matching).toContain('dt=2024-01-31')
      expect(matching).not.toContain('dt=2024-01-01')
      expect(matching).not.toContain('dt=2024-01-15')
    })

    it('should prune partitions for BETWEEN predicates', () => {
      const matching = index.findPartitions('createdAt', {
        column: 'createdAt',
        op: 'BETWEEN',
        value: [new Date('2024-01-10').getTime(), new Date('2024-01-20').getTime()],
      })

      expect(matching).toContain('dt=2024-01-15')
      expect(matching).not.toContain('dt=2024-01-01')
      expect(matching).not.toContain('dt=2024-01-31')
    })

    it('should serialize and deserialize correctly', () => {
      const serialized = index.serialize()
      const deserialized = MinMaxIndex.deserialize(serialized)

      const matching = deserialized.findPartitions('createdAt', {
        column: 'createdAt',
        op: '=',
        value: new Date('2024-01-15T12:00:00').getTime(),
      })

      expect(matching).toContain('dt=2024-01-15')
    })
  })

  // ============================================================================
  // Accelerator Integration Tests
  // ============================================================================
  describe('IcebergIndexAccelerator', () => {
    let accelerator: IcebergIndexAccelerator
    let manifest: IcebergManifest

    beforeEach(async () => {
      accelerator = new IcebergIndexAccelerator()

      // Generate test manifest with 100 partitions, 10K rows each
      manifest = generateTestManifest(100, 10000)

      // Sync from manifest
      await accelerator.syncFromManifest(manifest)

      // Add bloom filter for email column
      const emails = generateTestEmails(100000) // 100K unique emails
      accelerator.addBloomFilter('data.email', emails)

      // Index IDs
      const ids: string[] = []
      for (let i = 0; i < 100000; i++) {
        ids.push(`thing-${i}`)
      }
      accelerator.indexIds(ids)

      // Index types
      const typeToIds = new Map<string, string[]>()
      typeToIds.set(
        'User',
        ids.filter((_, i) => i % 5 === 0)
      )
      typeToIds.set(
        'Order',
        ids.filter((_, i) => i % 5 === 1)
      )
      typeToIds.set(
        'Product',
        ids.filter((_, i) => i % 5 === 2)
      )
      typeToIds.set(
        'Event',
        ids.filter((_, i) => i % 5 === 3)
      )
      typeToIds.set(
        'Session',
        ids.filter((_, i) => i % 5 === 4)
      )
      accelerator.indexTypes(typeToIds)
    })

    it('should answer COUNT(*) from index without R2 fetch', async () => {
      const query: ParsedQuery = {
        select: [],
        predicates: [],
        isCountOnly: true,
      }

      const mockFetchFromR2 = async () => {
        throw new Error('Should not fetch from R2')
      }

      const result = await accelerator.executeQuery(query, mockFetchFromR2)

      expect(result.data).toEqual([{ count: 1000000 }]) // 100 partitions * 10K rows
      expect(result.stats.r2PartitionsFetched).toBe(0)
      expect(result.stats.indexRowsRead).toBeGreaterThan(0)
    })

    it('should answer COUNT(*) WHERE type = x from index', async () => {
      const query: ParsedQuery = {
        select: [],
        predicates: [{ column: 'type', op: '=', value: 'User' }],
        isCountOnly: true,
      }

      const mockFetchFromR2 = async () => {
        throw new Error('Should not fetch from R2')
      }

      const result = await accelerator.executeQuery(query, mockFetchFromR2)

      expect(result.data).toEqual([{ count: 20000 }]) // 20% of 100K IDs
      expect(result.stats.r2PartitionsFetched).toBe(0)
    })

    it('should answer EXISTS(id) from index', async () => {
      const query: ParsedQuery = {
        select: [],
        predicates: [{ column: 'id', op: '=', value: 'thing-500' }],
        isExistsOnly: true,
      }

      const mockFetchFromR2 = async () => {
        throw new Error('Should not fetch from R2')
      }

      const result = await accelerator.executeQuery(query, mockFetchFromR2)

      expect(result.data).toEqual([{ exists: true }])
      expect(result.stats.r2PartitionsFetched).toBe(0)
    })

    it('should return false for non-existent ID', async () => {
      const query: ParsedQuery = {
        select: [],
        predicates: [{ column: 'id', op: '=', value: 'nonexistent-id' }],
        isExistsOnly: true,
      }

      const mockFetchFromR2 = async () => {
        throw new Error('Should not fetch from R2')
      }

      const result = await accelerator.executeQuery(query, mockFetchFromR2)

      expect(result.data).toEqual([{ exists: false }])
    })

    it('should use bloom filter to skip R2 fetch for non-existent email', async () => {
      const query: ParsedQuery = {
        select: ['id', 'type', 'data.email'],
        predicates: [{ column: 'data.email', op: '=', value: 'definitely-not-exists@nowhere.com' }],
      }

      const mockFetchFromR2 = async () => {
        throw new Error('Should not fetch from R2 (bloom filter should skip)')
      }

      const result = await accelerator.executeQuery(query, mockFetchFromR2)

      expect(result.data).toEqual([])
      expect(result.stats.r2PartitionsFetched).toBe(0)
    })

    it('should prune partitions using min/max index', async () => {
      const query: ParsedQuery = {
        select: ['id', 'type'],
        predicates: [{ column: 'type', op: '=', value: 'User' }],
        limit: 10,
      }

      let fetchCount = 0
      const mockFetchFromR2 = async (file: string, columns: string[]) => {
        fetchCount++
        return {
          id: [`user-${fetchCount}`, `user-${fetchCount + 1}`],
          type: ['User', 'User'],
        }
      }

      const result = await accelerator.executeQuery(query, mockFetchFromR2)

      // Should only fetch User partitions (20 out of 100)
      expect(fetchCount).toBe(20)
    })

    it('should cache column data for repeated queries', async () => {
      const query: ParsedQuery = {
        select: ['id', 'type'],
        predicates: [{ column: 'type', op: '=', value: 'User' }],
        limit: 10,
      }

      let fetchCount = 0
      const mockFetchFromR2 = async (file: string, columns: string[]) => {
        fetchCount++
        return {
          id: [`user-${fetchCount}`],
          type: ['User'],
        }
      }

      // First query
      await accelerator.executeQuery(query, mockFetchFromR2)
      const firstFetchCount = fetchCount

      // Second query (should hit cache)
      const result2 = await accelerator.executeQuery(query, mockFetchFromR2)

      // Should have more cache hits on second query
      expect(result2.stats.cacheHits).toBeGreaterThan(0)
      expect(fetchCount).toBeLessThan(firstFetchCount * 2)
    })

    it('should execute aggregations correctly', async () => {
      // Use a fresh accelerator with single partition to avoid multiple fetches
      const singlePartitionAccelerator = new IcebergIndexAccelerator()
      await singlePartitionAccelerator.syncFromManifest(generateTestManifest(1, 5))

      const query: ParsedQuery = {
        select: ['type'],
        predicates: [],
        groupBy: ['type'],
        aggregations: [
          { function: 'count', alias: 'count' },
          { function: 'sum', column: 'amount', alias: 'total' },
        ],
      }

      const mockFetchFromR2 = async () => {
        return {
          type: ['User', 'User', 'Order', 'Order', 'Order'],
          amount: [100, 200, 50, 75, 125],
        }
      }

      const result = await singlePartitionAccelerator.executeQuery(query, mockFetchFromR2)

      const userRow = (result.data as Record<string, unknown>[]).find((r) => r.type === 'User')
      const orderRow = (result.data as Record<string, unknown>[]).find((r) => r.type === 'Order')

      expect(userRow?.count).toBe(2)
      expect(userRow?.total).toBe(300)
      expect(orderRow?.count).toBe(3)
      expect(orderRow?.total).toBe(250)
    })

    it('should apply filters correctly', async () => {
      // Use a fresh accelerator with single partition to avoid multiple fetches
      const singlePartitionAccelerator = new IcebergIndexAccelerator()
      await singlePartitionAccelerator.syncFromManifest(generateTestManifest(1, 5))

      const query: ParsedQuery = {
        select: ['id', 'amount'],
        predicates: [{ column: 'amount', op: '>', value: 100 }],
      }

      const mockFetchFromR2 = async () => {
        return {
          id: ['a', 'b', 'c', 'd', 'e'],
          amount: [50, 150, 200, 75, 300],
        }
      }

      const result = await singlePartitionAccelerator.executeQuery(query, mockFetchFromR2)
      const data = result.data as Record<string, unknown>[]

      expect(data.length).toBe(3)
      expect(data.map((d) => d.id)).toEqual(['b', 'c', 'e'])
    })

    it('should apply order by and limit', async () => {
      // Create a fresh accelerator with a small manifest for this test
      const smallAccelerator = new IcebergIndexAccelerator()
      const smallManifest = generateTestManifest(1, 5) // Just 1 partition
      await smallAccelerator.syncFromManifest(smallManifest)

      const query: ParsedQuery = {
        select: ['id', 'amount'],
        predicates: [],
        orderBy: ['amount'],
        limit: 3,
      }

      const mockFetchFromR2 = async () => {
        return {
          id: ['a', 'b', 'c', 'd', 'e'],
          amount: [50, 150, 200, 75, 300],
        }
      }

      const result = await smallAccelerator.executeQuery(query, mockFetchFromR2)
      const data = result.data as Record<string, unknown>[]

      expect(data.length).toBe(3)
      expect(data.map((d) => d.amount)).toEqual([50, 75, 150])
    })
  })

  // ============================================================================
  // Cost Analysis Tests
  // ============================================================================
  describe('Cost Analysis', () => {
    it('should show massive savings for COUNT queries', () => {
      const analysis = IcebergIndexAccelerator.costAnalysis(10000000, 1000)

      const countQuery = analysis.find((a) => a.query === 'SELECT COUNT(*)')

      expect(countQuery).toBeDefined()
      expect(countQuery!.fullScan.r2Fetches).toBe(1000)
      expect(countQuery!.accelerated.r2Fetches).toBe(0)
      expect(countQuery!.accelerated.indexReads).toBe(1)
      expect(countQuery!.savings).toBe('99.99%')
    })

    it('should show savings for type-filtered queries', () => {
      const analysis = IcebergIndexAccelerator.costAnalysis(10000000, 1000)

      const typeQuery = analysis.find((a) => a.query === "SELECT COUNT(*) WHERE type = 'User'")

      expect(typeQuery).toBeDefined()
      expect(typeQuery!.accelerated.r2Fetches).toBe(0)
      expect(typeQuery!.savings).toBe('99.99%')
    })

    it('should show bloom filter can eliminate R2 fetches', () => {
      const analysis = IcebergIndexAccelerator.costAnalysis(10000000, 1000)

      const emailQuery = analysis.find((a) => a.query === "SELECT * WHERE data.email = 'x@y.com'")

      expect(emailQuery).toBeDefined()
      expect(emailQuery!.accelerated.r2Fetches).toBe(0)
      expect(emailQuery!.savings).toContain('99.99%')
    })

    it('should show min/max pruning for range queries', () => {
      const analysis = IcebergIndexAccelerator.costAnalysis(10000000, 1000)

      const rangeQuery = analysis.find((a) => a.query === 'SELECT * WHERE createdAt > "2024-01-01"')

      expect(rangeQuery).toBeDefined()
      expect(rangeQuery!.accelerated.r2Fetches).toBeLessThan(rangeQuery!.fullScan.r2Fetches)
      expect(rangeQuery!.savings).toContain('75%')
    })
  })

  // ============================================================================
  // Edge Cases
  // ============================================================================
  describe('Edge Cases', () => {
    it('should handle empty manifest', async () => {
      const accelerator = new IcebergIndexAccelerator()
      await accelerator.syncFromManifest({ entries: [] })

      const stats = accelerator.getStats()
      expect(stats.totalRows).toBe(0)
      expect(stats.partitionCount).toBe(0)
    })

    it('should handle query with no matching partitions via bloom filter', async () => {
      const accelerator = new IcebergIndexAccelerator()
      const manifest = generateTestManifest(10, 1000)
      await accelerator.syncFromManifest(manifest)

      // Add bloom filter with enough items to reduce false positive rate
      // Use 100 items so the bloom filter is sized properly
      const emails = generateTestEmails(100)
      accelerator.addBloomFilter('email', emails)

      const query: ParsedQuery = {
        select: ['id'],
        predicates: [
          {
            column: 'email',
            op: '=',
            value: 'definitely-not-in-filter-xyz123@nowhere.com',  // Unique value not in bloom filter
          },
        ],
      }

      const mockFetchFromR2 = async () => {
        throw new Error('Should not fetch - bloom filter says no')
      }

      const result = await accelerator.executeQuery(query, mockFetchFromR2)
      expect(result.data).toEqual([])
      expect(result.stats.r2PartitionsFetched).toBe(0)
    })

    it('should handle mixed predicate types', async () => {
      // Use single partition to get predictable results
      const accelerator = new IcebergIndexAccelerator()
      const manifest = generateTestManifest(1, 1000)
      await accelerator.syncFromManifest(manifest)

      const query: ParsedQuery = {
        select: ['id', 'type', 'amount'],
        predicates: [
          { column: 'amount', op: '>', value: 100 },
          { column: 'status', op: 'IS NOT NULL', value: null },
        ],
      }

      const mockFetchFromR2 = async () => {
        return {
          id: ['a', 'b', 'c'],
          type: ['User', 'User', 'User'],
          amount: [50, 150, 200],
          status: ['active', null, 'pending'],
        }
      }

      const result = await accelerator.executeQuery(query, mockFetchFromR2)
      const data = result.data as Record<string, unknown>[]

      // Should filter: amount > 100 AND status IS NOT NULL
      expect(data.length).toBe(1) // Only 'c' with amount=200 and status='pending'
    })
  })

  // ============================================================================
  // Performance Tests
  // ============================================================================
  describe('Performance', () => {
    it('should sync large manifest quickly', async () => {
      const accelerator = new IcebergIndexAccelerator()
      const manifest = generateTestManifest(10000, 100000) // 10K partitions, 1B rows total

      const start = performance.now()
      await accelerator.syncFromManifest(manifest)
      const elapsed = performance.now() - start

      expect(elapsed).toBeLessThan(1000) // Should sync in < 1 second

      const stats = accelerator.getStats()
      expect(stats.totalRows).toBe(1000000000) // 1 billion
      expect(stats.partitionCount).toBe(10000)
    })

    it('should answer index-only queries in < 1ms', async () => {
      const accelerator = new IcebergIndexAccelerator()
      const manifest = generateTestManifest(1000, 10000)
      await accelerator.syncFromManifest(manifest)

      const query: ParsedQuery = {
        select: [],
        predicates: [],
        isCountOnly: true,
      }

      const mockFetchFromR2 = async () => {
        throw new Error('Should not fetch')
      }

      const result = await accelerator.executeQuery(query, mockFetchFromR2)

      expect(result.stats.executionTimeMs).toBeLessThan(1)
    })
  })
})
