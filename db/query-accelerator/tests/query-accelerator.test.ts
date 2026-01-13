/**
 * RED PHASE: Query Accelerator Tests (Bloom/MinMax Indexes)
 *
 * TDD tests for the production DO Query Accelerator index layer.
 * These tests define the expected interface and behavior for bloom filters
 * and min/max statistics that enable fast query pruning over Iceberg cold storage.
 *
 * @see db/ARCHITECTURE.md for design details
 * @issue dotdo-xjbem
 *
 * Expected implementation location: db/query-accelerator/index.ts
 *
 * Key features to implement:
 * 1. Bloom filter indexes for high-cardinality equality predicates
 * 2. Min/Max statistics for range predicate partition pruning
 * 3. Type index for fast type-based filtering
 * 4. Cardinality statistics for query optimization
 * 5. Index persistence and sync with Iceberg manifests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Import production module (will fail until implemented)
import type {
  QueryAccelerator,
  QueryAcceleratorOptions,
  BloomFilterIndex,
  MinMaxIndex,
  IndexStats,
  Predicate,
  ParsedQuery,
  QueryResult,
  QueryStats,
  IcebergManifest,
  IcebergPartition,
} from '../index'

// Placeholder imports that will fail - these are the interfaces we expect
// @ts-expect-error - Module not yet implemented
import {
  createQueryAccelerator,
  BloomFilter,
  MinMaxStatistics,
  TypeIndex,
  CardinalityTracker,
} from '../index'

// ============================================================================
// BloomFilter Tests
// ============================================================================

describe('Query Accelerator - BloomFilter', () => {
  describe('Basic Operations', () => {
    it('should create bloom filter with expected items', () => {
      const bloom = new BloomFilter({ expectedItems: 10000, falsePositiveRate: 0.01 })

      expect(bloom).toBeDefined()
      expect(typeof bloom.add).toBe('function')
      expect(typeof bloom.mightContain).toBe('function')
    })

    it('should add items and return definite negative for non-existent', () => {
      const bloom = new BloomFilter({ expectedItems: 1000, falsePositiveRate: 0.01 })

      bloom.add('user@example.com')
      bloom.add('another@test.com')

      expect(bloom.mightContain('user@example.com')).toBe(true)
      expect(bloom.mightContain('definitely-not-added@nowhere.com')).toBe(false)
    })

    it('should never return false negative for added items', () => {
      const bloom = new BloomFilter({ expectedItems: 10000, falsePositiveRate: 0.01 })

      const items = Array.from({ length: 1000 }, (_, i) => `item-${i}@test.com`)
      for (const item of items) {
        bloom.add(item)
      }

      // All added items MUST return true (no false negatives)
      for (const item of items) {
        expect(bloom.mightContain(item)).toBe(true)
      }
    })

    it('should have configurable false positive rate', () => {
      const bloom = new BloomFilter({ expectedItems: 10000, falsePositiveRate: 0.001 })

      // Add 10,000 items
      for (let i = 0; i < 10000; i++) {
        bloom.add(`email-${i}@domain.com`)
      }

      // Check 10,000 items that were NOT added
      let falsePositives = 0
      for (let i = 10000; i < 20000; i++) {
        if (bloom.mightContain(`email-${i}@domain.com`)) {
          falsePositives++
        }
      }

      // FPR should be approximately 0.1% (allow some variance)
      const actualFPR = falsePositives / 10000
      expect(actualFPR).toBeLessThan(0.01) // Should be well under 1%
    })
  })

  describe('Serialization', () => {
    it('should serialize to binary format', () => {
      const bloom = new BloomFilter({ expectedItems: 1000, falsePositiveRate: 0.01 })

      bloom.add('test1@example.com')
      bloom.add('test2@example.com')

      const serialized = bloom.serialize()

      expect(serialized).toBeDefined()
      expect(serialized instanceof Uint8Array).toBe(true)
    })

    it('should deserialize and preserve state', () => {
      const bloom = new BloomFilter({ expectedItems: 1000, falsePositiveRate: 0.01 })

      bloom.add('test1@example.com')
      bloom.add('test2@example.com')

      const serialized = bloom.serialize()
      const restored = BloomFilter.deserialize(serialized)

      expect(restored.mightContain('test1@example.com')).toBe(true)
      expect(restored.mightContain('test2@example.com')).toBe(true)
      expect(restored.mightContain('never-added@example.com')).toBe(false)
    })
  })

  describe('Statistics', () => {
    it('should report filter statistics', () => {
      const bloom = new BloomFilter({ expectedItems: 1000, falsePositiveRate: 0.01 })

      for (let i = 0; i < 500; i++) {
        bloom.add(`item-${i}`)
      }

      const stats = bloom.getStats()

      expect(stats.numBits).toBeGreaterThan(0)
      expect(stats.numHashFunctions).toBeGreaterThan(0)
      expect(stats.itemCount).toBe(500)
      expect(stats.fillRatio).toBeGreaterThan(0)
      expect(stats.fillRatio).toBeLessThan(1)
      expect(stats.memoryBytes).toBeGreaterThan(0)
    })
  })

  describe('Merge Operations', () => {
    it('should merge two bloom filters', () => {
      const bloom1 = new BloomFilter({ expectedItems: 1000, falsePositiveRate: 0.01 })
      const bloom2 = new BloomFilter({ expectedItems: 1000, falsePositiveRate: 0.01 })

      bloom1.add('item-a')
      bloom1.add('item-b')
      bloom2.add('item-c')
      bloom2.add('item-d')

      bloom1.merge(bloom2)

      expect(bloom1.mightContain('item-a')).toBe(true)
      expect(bloom1.mightContain('item-b')).toBe(true)
      expect(bloom1.mightContain('item-c')).toBe(true)
      expect(bloom1.mightContain('item-d')).toBe(true)
    })

    it('should reject merge of incompatible filters', () => {
      const bloom1 = new BloomFilter({ expectedItems: 1000, falsePositiveRate: 0.01 })
      const bloom2 = new BloomFilter({ expectedItems: 10000, falsePositiveRate: 0.01 })

      expect(() => bloom1.merge(bloom2)).toThrow()
    })
  })
})

// ============================================================================
// MinMaxStatistics Tests
// ============================================================================

describe('Query Accelerator - MinMaxStatistics', () => {
  let minmax: MinMaxStatistics

  beforeEach(() => {
    minmax = new MinMaxStatistics()
  })

  describe('Adding Partition Stats', () => {
    it('should add partition statistics', () => {
      minmax.addPartitionStats('createdAt', {
        column: 'createdAt',
        partitionKey: 'type=User/dt=2024-01-01',
        minValue: new Date('2024-01-01').getTime(),
        maxValue: new Date('2024-01-01T23:59:59').getTime(),
        nullCount: 0,
        rowCount: 1000,
      })

      const stats = minmax.getColumnStats('createdAt')
      expect(stats).toHaveLength(1)
    })

    it('should track multiple partitions per column', () => {
      for (let day = 1; day <= 31; day++) {
        const dateStr = `2024-01-${String(day).padStart(2, '0')}`
        minmax.addPartitionStats('createdAt', {
          column: 'createdAt',
          partitionKey: `type=User/dt=${dateStr}`,
          minValue: new Date(`${dateStr}T00:00:00`).getTime(),
          maxValue: new Date(`${dateStr}T23:59:59`).getTime(),
          nullCount: 0,
          rowCount: 1000,
        })
      }

      const stats = minmax.getColumnStats('createdAt')
      expect(stats).toHaveLength(31)
    })
  })

  describe('Partition Pruning', () => {
    beforeEach(() => {
      // Add 31 days of partitions
      for (let day = 1; day <= 31; day++) {
        const dateStr = `2024-01-${String(day).padStart(2, '0')}`
        minmax.addPartitionStats('createdAt', {
          column: 'createdAt',
          partitionKey: `dt=${dateStr}`,
          minValue: new Date(`${dateStr}T00:00:00`).getTime(),
          maxValue: new Date(`${dateStr}T23:59:59`).getTime(),
          nullCount: 0,
          rowCount: 1000,
        })
      }
    })

    it('should find partitions for equality predicate', () => {
      const predicate: Predicate = {
        column: 'createdAt',
        op: '=',
        value: new Date('2024-01-15T12:00:00').getTime(),
      }

      const partitions = minmax.findPartitions('createdAt', predicate)

      expect(partitions).toHaveLength(1)
      expect(partitions[0]).toBe('dt=2024-01-15')
    })

    it('should find partitions for greater than predicate', () => {
      const predicate: Predicate = {
        column: 'createdAt',
        op: '>',
        value: new Date('2024-01-25T00:00:00').getTime(),
      }

      const partitions = minmax.findPartitions('createdAt', predicate)

      // Should match days 25-31 (7 partitions)
      expect(partitions.length).toBeGreaterThanOrEqual(6)
      expect(partitions.length).toBeLessThanOrEqual(7)
    })

    it('should find partitions for less than predicate', () => {
      const predicate: Predicate = {
        column: 'createdAt',
        op: '<',
        value: new Date('2024-01-05T00:00:00').getTime(),
      }

      const partitions = minmax.findPartitions('createdAt', predicate)

      // Should match days 1-4 (4 partitions)
      expect(partitions.length).toBeLessThanOrEqual(4)
    })

    it('should find partitions for BETWEEN predicate', () => {
      const predicate: Predicate = {
        column: 'createdAt',
        op: 'BETWEEN',
        value: [
          new Date('2024-01-10T00:00:00').getTime(),
          new Date('2024-01-15T23:59:59').getTime(),
        ],
      }

      const partitions = minmax.findPartitions('createdAt', predicate)

      // Should match days 10-15 (6 partitions)
      expect(partitions.length).toBe(6)
    })

    it('should return empty for value outside all ranges', () => {
      const predicate: Predicate = {
        column: 'createdAt',
        op: '=',
        value: new Date('2025-01-01').getTime(), // Outside 2024-01 range
      }

      const partitions = minmax.findPartitions('createdAt', predicate)

      expect(partitions).toHaveLength(0)
    })
  })

  describe('Numeric Columns', () => {
    beforeEach(() => {
      // Add partitions with amount ranges
      minmax.addPartitionStats('amount', {
        column: 'amount',
        partitionKey: 'partition-1',
        minValue: 0,
        maxValue: 100,
        nullCount: 5,
        rowCount: 1000,
      })
      minmax.addPartitionStats('amount', {
        column: 'amount',
        partitionKey: 'partition-2',
        minValue: 100,
        maxValue: 500,
        nullCount: 10,
        rowCount: 2000,
      })
      minmax.addPartitionStats('amount', {
        column: 'amount',
        partitionKey: 'partition-3',
        minValue: 500,
        maxValue: 10000,
        nullCount: 2,
        rowCount: 500,
      })
    })

    it('should prune partitions for numeric equality', () => {
      const predicate: Predicate = {
        column: 'amount',
        op: '=',
        value: 250,
      }

      const partitions = minmax.findPartitions('amount', predicate)

      expect(partitions).toHaveLength(1)
      expect(partitions[0]).toBe('partition-2')
    })

    it('should prune partitions for numeric range', () => {
      const predicate: Predicate = {
        column: 'amount',
        op: '>',
        value: 400,
      }

      const partitions = minmax.findPartitions('amount', predicate)

      // partition-2 (max 500 > 400) and partition-3 (max 10000 > 400)
      expect(partitions).toHaveLength(2)
    })
  })

  describe('String Columns', () => {
    beforeEach(() => {
      minmax.addPartitionStats('name', {
        column: 'name',
        partitionKey: 'partition-a',
        minValue: 'Aaron',
        maxValue: 'David',
        nullCount: 0,
        rowCount: 100,
      })
      minmax.addPartitionStats('name', {
        column: 'name',
        partitionKey: 'partition-b',
        minValue: 'Emily',
        maxValue: 'Kate',
        nullCount: 0,
        rowCount: 100,
      })
      minmax.addPartitionStats('name', {
        column: 'name',
        partitionKey: 'partition-c',
        minValue: 'Larry',
        maxValue: 'Zoe',
        nullCount: 0,
        rowCount: 100,
      })
    })

    it('should prune partitions for string equality', () => {
      const predicate: Predicate = {
        column: 'name',
        op: '=',
        value: 'Frank',
      }

      const partitions = minmax.findPartitions('name', predicate)

      expect(partitions).toHaveLength(1)
      expect(partitions[0]).toBe('partition-b')
    })

    it('should prune partitions for string range', () => {
      const predicate: Predicate = {
        column: 'name',
        op: '>=',
        value: 'Mike',
      }

      const partitions = minmax.findPartitions('name', predicate)

      // Only partition-c (Larry-Zoe) can contain names >= Mike
      expect(partitions).toHaveLength(1)
      expect(partitions[0]).toBe('partition-c')
    })
  })

  describe('Serialization', () => {
    it('should serialize to JSON', () => {
      minmax.addPartitionStats('col1', {
        column: 'col1',
        partitionKey: 'p1',
        minValue: 0,
        maxValue: 100,
        nullCount: 0,
        rowCount: 100,
      })

      const json = minmax.serialize()

      expect(typeof json).toBe('string')
      expect(JSON.parse(json)).toBeDefined()
    })

    it('should deserialize from JSON', () => {
      minmax.addPartitionStats('col1', {
        column: 'col1',
        partitionKey: 'p1',
        minValue: 0,
        maxValue: 100,
        nullCount: 0,
        rowCount: 100,
      })

      const json = minmax.serialize()
      const restored = MinMaxStatistics.deserialize(json)

      const partitions = restored.findPartitions('col1', {
        column: 'col1',
        op: '=',
        value: 50,
      })

      expect(partitions).toHaveLength(1)
    })
  })
})

// ============================================================================
// TypeIndex Tests
// ============================================================================

describe('Query Accelerator - TypeIndex', () => {
  let typeIndex: TypeIndex

  beforeEach(() => {
    typeIndex = new TypeIndex()
  })

  it('should index types with their IDs', () => {
    typeIndex.add('Customer', ['c1', 'c2', 'c3'])
    typeIndex.add('Order', ['o1', 'o2'])

    expect(typeIndex.getCount('Customer')).toBe(3)
    expect(typeIndex.getCount('Order')).toBe(2)
  })

  it('should check if ID exists for type', () => {
    typeIndex.add('Customer', ['c1', 'c2', 'c3'])

    expect(typeIndex.hasId('Customer', 'c2')).toBe(true)
    expect(typeIndex.hasId('Customer', 'c99')).toBe(false)
    expect(typeIndex.hasId('Order', 'c1')).toBe(false)
  })

  it('should get all IDs for type', () => {
    typeIndex.add('Customer', ['c1', 'c2', 'c3'])

    const ids = typeIndex.getIds('Customer')

    expect(ids).toContain('c1')
    expect(ids).toContain('c2')
    expect(ids).toContain('c3')
    expect(ids).toHaveLength(3)
  })

  it('should get all types', () => {
    typeIndex.add('Customer', ['c1'])
    typeIndex.add('Order', ['o1'])
    typeIndex.add('Product', ['p1'])

    const types = typeIndex.getAllTypes()

    expect(types).toContain('Customer')
    expect(types).toContain('Order')
    expect(types).toContain('Product')
    expect(types).toHaveLength(3)
  })

  it('should serialize and deserialize', () => {
    typeIndex.add('Customer', ['c1', 'c2'])
    typeIndex.add('Order', ['o1'])

    const json = typeIndex.serialize()
    const restored = TypeIndex.deserialize(json)

    expect(restored.getCount('Customer')).toBe(2)
    expect(restored.getCount('Order')).toBe(1)
  })
})

// ============================================================================
// CardinalityTracker Tests
// ============================================================================

describe('Query Accelerator - CardinalityTracker', () => {
  let tracker: CardinalityTracker

  beforeEach(() => {
    tracker = new CardinalityTracker()
  })

  it('should track total row count', () => {
    tracker.addPartition('p1', { rowCount: 1000 })
    tracker.addPartition('p2', { rowCount: 2000 })
    tracker.addPartition('p3', { rowCount: 500 })

    expect(tracker.getTotalRows()).toBe(3500)
  })

  it('should track row counts by type', () => {
    tracker.addPartition('type=Customer/dt=2024-01-01', {
      rowCount: 1000,
      type: 'Customer',
    })
    tracker.addPartition('type=Order/dt=2024-01-01', {
      rowCount: 2000,
      type: 'Order',
    })
    tracker.addPartition('type=Customer/dt=2024-01-02', {
      rowCount: 1500,
      type: 'Customer',
    })

    expect(tracker.getRowCountByType('Customer')).toBe(2500)
    expect(tracker.getRowCountByType('Order')).toBe(2000)
  })

  it('should track partition count', () => {
    tracker.addPartition('p1', { rowCount: 1000 })
    tracker.addPartition('p2', { rowCount: 2000 })

    expect(tracker.getPartitionCount()).toBe(2)
  })

  it('should answer COUNT(*) without data access', () => {
    tracker.addPartition('p1', { rowCount: 1000 })
    tracker.addPartition('p2', { rowCount: 2000 })

    const result = tracker.answerCountQuery()

    expect(result.count).toBe(3000)
    expect(result.fromIndex).toBe(true)
  })

  it('should answer COUNT(*) WHERE type = x', () => {
    tracker.addPartition('type=Customer/dt=2024-01-01', {
      rowCount: 1000,
      type: 'Customer',
    })
    tracker.addPartition('type=Order/dt=2024-01-01', {
      rowCount: 2000,
      type: 'Order',
    })

    const result = tracker.answerCountQuery({ type: 'Customer' })

    expect(result.count).toBe(1000)
    expect(result.fromIndex).toBe(true)
  })
})

// ============================================================================
// QueryAccelerator Integration Tests
// ============================================================================

describe('Query Accelerator - Integration', () => {
  let accelerator: QueryAccelerator

  beforeEach(async () => {
    accelerator = createQueryAccelerator()

    // Sync with test manifest
    const manifest: IcebergManifest = {
      entries: [
        {
          partitionKey: 'type=Customer/dt=2024-01-01',
          dataFile: 's3://bucket/data/type=Customer/dt=2024-01-01/data.parquet',
          rowCount: 1000,
          sizeBytes: 500000,
          lowerBounds: {
            type: 'Customer',
            createdAt: new Date('2024-01-01').getTime(),
          },
          upperBounds: {
            type: 'Customer',
            createdAt: new Date('2024-01-01T23:59:59').getTime(),
          },
          nullCounts: { type: 0, createdAt: 0 },
        },
        {
          partitionKey: 'type=Order/dt=2024-01-01',
          dataFile: 's3://bucket/data/type=Order/dt=2024-01-01/data.parquet',
          rowCount: 2000,
          sizeBytes: 1000000,
          lowerBounds: {
            type: 'Order',
            createdAt: new Date('2024-01-01').getTime(),
          },
          upperBounds: {
            type: 'Order',
            createdAt: new Date('2024-01-01T23:59:59').getTime(),
          },
          nullCounts: { type: 0, createdAt: 0 },
        },
      ],
    }

    await accelerator.syncFromManifest(manifest)

    // Add bloom filter for email column
    accelerator.addBloomFilter('data.email', [
      'alice@example.com',
      'bob@example.com',
      'charlie@example.com',
    ])
  })

  describe('COUNT Query Optimization', () => {
    it('should answer COUNT(*) from index without R2 fetch', async () => {
      const query: ParsedQuery = {
        select: [],
        predicates: [],
        isCountOnly: true,
      }

      const mockFetchFromR2 = vi.fn()
      const result = await accelerator.executeQuery(query, mockFetchFromR2)

      expect(result.data).toEqual([{ count: 3000 }])
      expect(mockFetchFromR2).not.toHaveBeenCalled()
      expect(result.stats.r2PartitionsFetched).toBe(0)
      expect(result.stats.indexRowsRead).toBeGreaterThan(0)
    })

    it('should answer COUNT(*) WHERE type = x from index', async () => {
      const query: ParsedQuery = {
        select: [],
        predicates: [{ column: 'type', op: '=', value: 'Customer' }],
        isCountOnly: true,
      }

      const mockFetchFromR2 = vi.fn()
      const result = await accelerator.executeQuery(query, mockFetchFromR2)

      expect(result.data).toEqual([{ count: 1000 }])
      expect(mockFetchFromR2).not.toHaveBeenCalled()
    })
  })

  describe('Bloom Filter Optimization', () => {
    it('should skip R2 fetch when bloom says definitely not', async () => {
      const query: ParsedQuery = {
        select: ['$id', 'data'],
        predicates: [{ column: 'data.email', op: '=', value: 'nonexistent@example.com' }],
      }

      const mockFetchFromR2 = vi.fn()
      const result = await accelerator.executeQuery(query, mockFetchFromR2)

      expect(result.data).toEqual([])
      expect(mockFetchFromR2).not.toHaveBeenCalled()
      expect(result.stats.r2PartitionsFetched).toBe(0)
    })

    it('should fetch from R2 when bloom says maybe exists', async () => {
      const query: ParsedQuery = {
        select: ['$id', 'data'],
        predicates: [{ column: 'data.email', op: '=', value: 'alice@example.com' }],
      }

      const mockFetchFromR2 = vi.fn().mockResolvedValue({
        '$id': ['customer-1'],
        data: [{ email: 'alice@example.com' }],
      })

      const result = await accelerator.executeQuery(query, mockFetchFromR2)

      expect(mockFetchFromR2).toHaveBeenCalled()
    })
  })

  describe('Min/Max Partition Pruning', () => {
    it('should prune partitions based on date range', async () => {
      // Add more partitions for January
      const manifest: IcebergManifest = {
        entries: Array.from({ length: 31 }, (_, i) => {
          const day = i + 1
          const dateStr = `2024-01-${String(day).padStart(2, '0')}`
          return {
            partitionKey: `type=Event/dt=${dateStr}`,
            dataFile: `s3://bucket/data/type=Event/dt=${dateStr}/data.parquet`,
            rowCount: 100,
            sizeBytes: 50000,
            lowerBounds: {
              type: 'Event',
              createdAt: new Date(`${dateStr}T00:00:00`).getTime(),
            },
            upperBounds: {
              type: 'Event',
              createdAt: new Date(`${dateStr}T23:59:59`).getTime(),
            },
            nullCounts: { type: 0, createdAt: 0 },
          }
        }),
      }

      await accelerator.syncFromManifest(manifest)

      const query: ParsedQuery = {
        select: ['$id'],
        predicates: [
          {
            column: 'createdAt',
            op: '>',
            value: new Date('2024-01-25').getTime(),
          },
        ],
      }

      const fetchedPartitions: string[] = []
      const mockFetchFromR2 = vi.fn().mockImplementation((file) => {
        fetchedPartitions.push(file)
        return Promise.resolve({ '$id': [] })
      })

      await accelerator.executeQuery(query, mockFetchFromR2)

      // Should only fetch partitions from Jan 26-31 (6-7 days)
      expect(fetchedPartitions.length).toBeLessThanOrEqual(7)
    })

    it('should return empty when no partitions match', async () => {
      const query: ParsedQuery = {
        select: ['$id'],
        predicates: [
          {
            column: 'createdAt',
            op: '>',
            value: new Date('2025-01-01').getTime(), // Future date
          },
        ],
      }

      const mockFetchFromR2 = vi.fn()
      const result = await accelerator.executeQuery(query, mockFetchFromR2)

      expect(result.data).toEqual([])
      expect(mockFetchFromR2).not.toHaveBeenCalled()
    })
  })

  describe('Type-Based Partition Pruning', () => {
    it('should only fetch partitions matching type filter', async () => {
      const query: ParsedQuery = {
        select: ['$id', 'data'],
        predicates: [{ column: 'type', op: '=', value: 'Customer' }],
        limit: 100,
      }

      const fetchedFiles: string[] = []
      const mockFetchFromR2 = vi.fn().mockImplementation((file) => {
        fetchedFiles.push(file)
        return Promise.resolve({ '$id': ['c1'], data: [{}] })
      })

      await accelerator.executeQuery(query, mockFetchFromR2)

      // Should only fetch Customer partitions, not Order
      expect(fetchedFiles.every((f) => f.includes('type=Customer'))).toBe(true)
    })
  })

  describe('Column Caching', () => {
    it('should cache fetched columns for repeated queries', async () => {
      const query: ParsedQuery = {
        select: ['$id', 'data.name'],
        predicates: [],
        limit: 10,
      }

      const mockFetchFromR2 = vi.fn().mockResolvedValue({
        '$id': ['id1'],
        'data.name': ['Alice'],
      })

      // First query
      await accelerator.executeQuery(query, mockFetchFromR2)
      const firstCallCount = mockFetchFromR2.mock.calls.length

      // Second identical query
      const result = await accelerator.executeQuery(query, mockFetchFromR2)

      // Should use cache, not fetch again
      expect(result.stats.cacheHits).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// Query Statistics Tests
// ============================================================================

describe('Query Accelerator - Statistics', () => {
  it('should track index read/write operations', async () => {
    const accelerator = createQueryAccelerator()

    const manifest: IcebergManifest = {
      entries: [
        {
          partitionKey: 'p1',
          dataFile: 'data.parquet',
          rowCount: 1000,
          sizeBytes: 500000,
          lowerBounds: {},
          upperBounds: {},
          nullCounts: {},
        },
      ],
    }

    await accelerator.syncFromManifest(manifest)
    accelerator.addBloomFilter('email', ['test@example.com'])

    const stats = accelerator.getQueryStats()

    expect(stats.writeCount).toBeGreaterThan(0)
  })

  it('should report index statistics', () => {
    const accelerator = createQueryAccelerator()

    accelerator.addBloomFilter('col1', ['a', 'b', 'c'])
    accelerator.addBloomFilter('col2', ['x', 'y', 'z'])

    const stats = accelerator.getStats()

    expect(stats.bloomFilters).toContain('col1')
    expect(stats.bloomFilters).toContain('col2')
  })
})

// ============================================================================
// Cost Analysis Tests
// ============================================================================

describe('Query Accelerator - Cost Analysis', () => {
  it('should provide cost comparison for COUNT queries', () => {
    const analysis = createQueryAccelerator.costAnalysis(1000000, 1000)

    const countAnalysis = analysis.find((a) => a.query === 'SELECT COUNT(*)')

    expect(countAnalysis).toBeDefined()
    expect(countAnalysis!.fullScan.r2Fetches).toBe(1000) // All partitions
    expect(countAnalysis!.accelerated.r2Fetches).toBe(0)
    expect(countAnalysis!.savings).toContain('99')
  })

  it('should provide cost comparison for filtered queries', () => {
    const analysis = createQueryAccelerator.costAnalysis(1000000, 1000)

    const filteredAnalysis = analysis.find((a) => a.query.includes('WHERE type'))

    expect(filteredAnalysis).toBeDefined()
    expect(filteredAnalysis!.accelerated.r2Fetches).toBeLessThan(
      filteredAnalysis!.fullScan.r2Fetches
    )
  })

  it('should provide cost comparison for bloom filter queries', () => {
    const analysis = createQueryAccelerator.costAnalysis(1000000, 1000)

    const bloomAnalysis = analysis.find((a) => a.query.includes('data.email'))

    expect(bloomAnalysis).toBeDefined()
    expect(bloomAnalysis!.savings).toContain('99')
  })

  it('should provide cost comparison for range queries', () => {
    const analysis = createQueryAccelerator.costAnalysis(1000000, 1000)

    const rangeAnalysis = analysis.find((a) => a.query.includes('createdAt'))

    expect(rangeAnalysis).toBeDefined()
    // Should show ~75% savings from min/max pruning
    expect(rangeAnalysis!.accelerated.r2Fetches).toBeLessThan(
      rangeAnalysis!.fullScan.r2Fetches / 2
    )
  })
})

// ============================================================================
// Persistence Tests
// ============================================================================

describe('Query Accelerator - Persistence', () => {
  it('should persist index to SQLite rows', async () => {
    const accelerator = createQueryAccelerator()

    accelerator.addBloomFilter('email', ['test@example.com'])

    const rows = accelerator.toSQLiteRows()

    expect(rows.length).toBeGreaterThan(0)
    expect(rows.some((r) => r.key.startsWith('bloom:'))).toBe(true)
  })

  it('should restore from SQLite rows', async () => {
    const accelerator = createQueryAccelerator()
    accelerator.addBloomFilter('email', ['test@example.com'])

    const rows = accelerator.toSQLiteRows()

    const restored = createQueryAccelerator()
    restored.fromSQLiteRows(rows)

    // Verify bloom filter was restored
    const query: ParsedQuery = {
      select: ['$id'],
      predicates: [{ column: 'email', op: '=', value: 'nonexistent@example.com' }],
    }

    const mockFetch = vi.fn()
    const result = await restored.executeQuery(query, mockFetch)

    // Should use restored bloom filter
    expect(mockFetch).not.toHaveBeenCalled()
    expect(result.data).toEqual([])
  })

  it('should generate CREATE TABLE SQL', () => {
    const sql = createQueryAccelerator.createTableSQL('query_accelerator_index')

    expect(sql).toContain('CREATE TABLE')
    expect(sql).toContain('query_accelerator_index')
    expect(sql).toContain('index_key')
    expect(sql).toContain('index_data')
    expect(sql).toContain('PRIMARY KEY')
  })
})

// ============================================================================
// Edge Cases Tests
// ============================================================================

describe('Query Accelerator - Edge Cases', () => {
  it('should handle empty manifest', async () => {
    const accelerator = createQueryAccelerator()

    await accelerator.syncFromManifest({ entries: [] })

    const query: ParsedQuery = {
      select: ['$id'],
      predicates: [],
      isCountOnly: true,
    }

    const mockFetch = vi.fn()
    const result = await accelerator.executeQuery(query, mockFetch)

    expect(result.data).toEqual([{ count: 0 }])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('should handle query with unindexed column', async () => {
    const accelerator = createQueryAccelerator()

    const manifest: IcebergManifest = {
      entries: [
        {
          partitionKey: 'p1',
          dataFile: 'data.parquet',
          rowCount: 1000,
          sizeBytes: 500000,
          lowerBounds: {},
          upperBounds: {},
          nullCounts: {},
        },
      ],
    }

    await accelerator.syncFromManifest(manifest)

    // Query on column without bloom filter
    const query: ParsedQuery = {
      select: ['$id'],
      predicates: [{ column: 'unindexed.field', op: '=', value: 'test' }],
    }

    const mockFetch = vi.fn().mockResolvedValue({ '$id': [] })
    await accelerator.executeQuery(query, mockFetch)

    // Should fall through to partition scan
    expect(mockFetch).toHaveBeenCalled()
  })

  it('should handle very large bloom filters', () => {
    const bloom = new BloomFilter({ expectedItems: 10000000, falsePositiveRate: 0.001 })

    // Add 1M items
    for (let i = 0; i < 1000000; i++) {
      bloom.add(`item-${i}`)
    }

    const stats = bloom.getStats()

    // Memory should be bounded
    expect(stats.memoryBytes).toBeLessThan(50 * 1024 * 1024) // < 50MB
  })

  it('should handle concurrent query execution', async () => {
    const accelerator = createQueryAccelerator()

    const manifest: IcebergManifest = {
      entries: [
        {
          partitionKey: 'p1',
          dataFile: 'data.parquet',
          rowCount: 1000,
          sizeBytes: 500000,
          lowerBounds: {},
          upperBounds: {},
          nullCounts: {},
        },
      ],
    }

    await accelerator.syncFromManifest(manifest)

    const query: ParsedQuery = {
      select: ['$id'],
      predicates: [],
      isCountOnly: true,
    }

    const mockFetch = vi.fn()

    // Execute 10 queries concurrently
    const results = await Promise.all(
      Array.from({ length: 10 }, () => accelerator.executeQuery(query, mockFetch))
    )

    // All should return same result
    results.forEach((r) => {
      expect(r.data).toEqual([{ count: 1000 }])
    })
  })
})

// ============================================================================
// Export Tests
// ============================================================================

describe('Query Accelerator - Exports', () => {
  it('should export createQueryAccelerator factory', async () => {
    const module = await import('../index')
    expect(module.createQueryAccelerator).toBeDefined()
    expect(typeof module.createQueryAccelerator).toBe('function')
  })

  it('should export BloomFilter class', async () => {
    const module = await import('../index')
    expect(module.BloomFilter).toBeDefined()
  })

  it('should export MinMaxStatistics class', async () => {
    const module = await import('../index')
    expect(module.MinMaxStatistics).toBeDefined()
  })

  it('should export TypeIndex class', async () => {
    const module = await import('../index')
    expect(module.TypeIndex).toBeDefined()
  })

  it('should export CardinalityTracker class', async () => {
    const module = await import('../index')
    expect(module.CardinalityTracker).toBeDefined()
  })

  it('should export type definitions', async () => {
    // Type exports are verified at compile time
    const module = await import('../index')
    expect(module).toBeDefined()
  })
})
