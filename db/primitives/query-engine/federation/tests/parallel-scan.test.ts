/**
 * Parallel Scan Coordination Tests
 *
 * Tests for parallel scan coordination in the query federation system.
 * Allows splitting large table scans across multiple workers for parallel execution.
 *
 * @see dotdo-f6ccw
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  ParallelScanCoordinator,
  type ScanPartition,
  type ScanPlan,
  type PartitionStrategy,
  type TableMetadata,
  type PartitionResult,
} from '../parallel-scan'

describe('ParallelScanCoordinator', () => {
  let coordinator: ParallelScanCoordinator

  beforeEach(() => {
    coordinator = new ParallelScanCoordinator()
  })

  describe('ScanPartition interface', () => {
    it('should define partition with offset, limit, and optional filter', () => {
      const partition: ScanPartition = {
        id: 'partition-0',
        offset: 0,
        limit: 1000,
        filter: { column: 'status', op: '=', value: 'active' },
      }

      expect(partition.id).toBe('partition-0')
      expect(partition.offset).toBe(0)
      expect(partition.limit).toBe(1000)
      expect(partition.filter).toBeDefined()
    })

    it('should define partition with range bounds for range partitioning', () => {
      const partition: ScanPartition = {
        id: 'partition-1',
        offset: 0,
        limit: 1000,
        rangeStart: 1000,
        rangeEnd: 2000,
        rangeColumn: 'id',
      }

      expect(partition.rangeStart).toBe(1000)
      expect(partition.rangeEnd).toBe(2000)
      expect(partition.rangeColumn).toBe('id')
    })

    it('should define partition with hash bucket for hash partitioning', () => {
      const partition: ScanPartition = {
        id: 'partition-2',
        offset: 0,
        limit: 1000,
        hashBucket: 3,
        totalBuckets: 10,
        hashColumn: 'user_id',
      }

      expect(partition.hashBucket).toBe(3)
      expect(partition.totalBuckets).toBe(10)
      expect(partition.hashColumn).toBe('user_id')
    })
  })

  describe('partitionTable', () => {
    it('should split table into partitions based on row count', () => {
      const metadata: TableMetadata = {
        tableName: 'users',
        rowCount: 10000,
        avgRowSize: 100,
      }

      const partitions = coordinator.partitionTable(metadata, { partitionCount: 4 })

      expect(partitions).toHaveLength(4)
      expect(partitions[0].offset).toBe(0)
      expect(partitions[0].limit).toBe(2500)
      expect(partitions[1].offset).toBe(2500)
      expect(partitions[1].limit).toBe(2500)
      expect(partitions[2].offset).toBe(5000)
      expect(partitions[3].offset).toBe(7500)
    })

    it('should handle uneven row distribution', () => {
      const metadata: TableMetadata = {
        tableName: 'orders',
        rowCount: 10003,
        avgRowSize: 200,
      }

      const partitions = coordinator.partitionTable(metadata, { partitionCount: 4 })

      expect(partitions).toHaveLength(4)
      // Sum of all limits should equal or exceed total rows
      const totalRows = partitions.reduce((sum, p) => sum + p.limit, 0)
      expect(totalRows).toBeGreaterThanOrEqual(10003)
    })

    it('should use range partitioning when column statistics available', () => {
      const metadata: TableMetadata = {
        tableName: 'events',
        rowCount: 100000,
        avgRowSize: 50,
        columnStats: {
          timestamp: { min: 0, max: 100000, distinct: 100000 },
        },
      }

      const partitions = coordinator.partitionTable(metadata, {
        partitionCount: 4,
        strategy: 'range',
        rangeColumn: 'timestamp',
      })

      expect(partitions).toHaveLength(4)
      expect(partitions[0].rangeColumn).toBe('timestamp')
      expect(partitions[0].rangeStart).toBe(0)
      expect(partitions[0].rangeEnd).toBe(25000)
      expect(partitions[3].rangeEnd).toBe(100000)
    })

    it('should use hash partitioning for distributed scans', () => {
      const metadata: TableMetadata = {
        tableName: 'transactions',
        rowCount: 50000,
        avgRowSize: 150,
      }

      const partitions = coordinator.partitionTable(metadata, {
        partitionCount: 5,
        strategy: 'hash',
        hashColumn: 'transaction_id',
      })

      expect(partitions).toHaveLength(5)
      partitions.forEach((p, i) => {
        expect(p.hashBucket).toBe(i)
        expect(p.totalBuckets).toBe(5)
        expect(p.hashColumn).toBe('transaction_id')
      })
    })

    it('should use round-robin partitioning for balanced load', () => {
      const metadata: TableMetadata = {
        tableName: 'logs',
        rowCount: 20000,
        avgRowSize: 80,
      }

      const partitions = coordinator.partitionTable(metadata, {
        partitionCount: 4,
        strategy: 'round-robin',
      })

      expect(partitions).toHaveLength(4)
      // Each partition should get roughly equal rows
      partitions.forEach(p => {
        expect(p.limit).toBe(5000)
      })
    })

    it('should return single partition for small tables', () => {
      const metadata: TableMetadata = {
        tableName: 'configs',
        rowCount: 50,
        avgRowSize: 500,
      }

      const partitions = coordinator.partitionTable(metadata, { partitionCount: 4 })

      // Small tables should not be split
      expect(partitions).toHaveLength(1)
      expect(partitions[0].limit).toBe(50)
    })
  })

  describe('createScanPlan', () => {
    it('should create execution plan with parallel workers', () => {
      const partitions: ScanPartition[] = [
        { id: 'p0', offset: 0, limit: 1000 },
        { id: 'p1', offset: 1000, limit: 1000 },
        { id: 'p2', offset: 2000, limit: 1000 },
      ]

      const plan = coordinator.createScanPlan(partitions, {
        tableName: 'users',
        columns: ['id', 'name', 'email'],
      })

      expect(plan.partitions).toHaveLength(3)
      expect(plan.parallelism).toBe(3)
      expect(plan.tableName).toBe('users')
      expect(plan.columns).toEqual(['id', 'name', 'email'])
    })

    it('should include filter predicates in plan', () => {
      const partitions: ScanPartition[] = [
        { id: 'p0', offset: 0, limit: 500, filter: { column: 'active', op: '=', value: true } },
        { id: 'p1', offset: 500, limit: 500, filter: { column: 'active', op: '=', value: true } },
      ]

      const plan = coordinator.createScanPlan(partitions, {
        tableName: 'accounts',
        columns: ['*'],
        globalFilter: { column: 'deleted', op: '=', value: false },
      })

      expect(plan.globalFilter).toEqual({ column: 'deleted', op: '=', value: false })
      expect(plan.partitions[0].filter).toBeDefined()
    })

    it('should calculate estimated cost for plan', () => {
      const partitions: ScanPartition[] = [
        { id: 'p0', offset: 0, limit: 10000 },
        { id: 'p1', offset: 10000, limit: 10000 },
      ]

      const plan = coordinator.createScanPlan(partitions, {
        tableName: 'large_table',
        columns: ['*'],
      })

      expect(plan.estimatedCost).toBeGreaterThan(0)
      expect(plan.estimatedRows).toBe(20000)
    })

    it('should set merge strategy for results', () => {
      const partitions: ScanPartition[] = [
        { id: 'p0', offset: 0, limit: 1000 },
        { id: 'p1', offset: 1000, limit: 1000 },
      ]

      const plan = coordinator.createScanPlan(partitions, {
        tableName: 'data',
        columns: ['*'],
        orderBy: { column: 'created_at', direction: 'DESC' },
      })

      expect(plan.mergeStrategy).toBe('ordered')
      expect(plan.orderBy).toEqual({ column: 'created_at', direction: 'DESC' })
    })
  })

  describe('mergeScanResults', () => {
    it('should combine results from multiple partitions', () => {
      const results: PartitionResult[] = [
        { partitionId: 'p0', rows: [{ id: 1 }, { id: 2 }], rowCount: 2 },
        { partitionId: 'p1', rows: [{ id: 3 }, { id: 4 }], rowCount: 2 },
        { partitionId: 'p2', rows: [{ id: 5 }], rowCount: 1 },
      ]

      const merged = coordinator.mergeScanResults(results)

      expect(merged.rows).toHaveLength(5)
      expect(merged.totalRowCount).toBe(5)
    })

    it('should preserve order when merge strategy is ordered', () => {
      const results: PartitionResult[] = [
        { partitionId: 'p0', rows: [{ id: 3, ts: 30 }, { id: 1, ts: 10 }], rowCount: 2 },
        { partitionId: 'p1', rows: [{ id: 4, ts: 40 }, { id: 2, ts: 20 }], rowCount: 2 },
      ]

      const merged = coordinator.mergeScanResults(results, {
        strategy: 'ordered',
        orderBy: { column: 'ts', direction: 'ASC' },
      })

      expect(merged.rows).toHaveLength(4)
      expect(merged.rows[0].ts).toBe(10)
      expect(merged.rows[1].ts).toBe(20)
      expect(merged.rows[2].ts).toBe(30)
      expect(merged.rows[3].ts).toBe(40)
    })

    it('should handle empty partition results', () => {
      const results: PartitionResult[] = [
        { partitionId: 'p0', rows: [{ id: 1 }], rowCount: 1 },
        { partitionId: 'p1', rows: [], rowCount: 0 },
        { partitionId: 'p2', rows: [{ id: 2 }], rowCount: 1 },
      ]

      const merged = coordinator.mergeScanResults(results)

      expect(merged.rows).toHaveLength(2)
      expect(merged.totalRowCount).toBe(2)
    })

    it('should apply limit to merged results', () => {
      const results: PartitionResult[] = [
        { partitionId: 'p0', rows: [{ id: 1 }, { id: 2 }, { id: 3 }], rowCount: 3 },
        { partitionId: 'p1', rows: [{ id: 4 }, { id: 5 }], rowCount: 2 },
      ]

      const merged = coordinator.mergeScanResults(results, { limit: 3 })

      expect(merged.rows).toHaveLength(3)
      expect(merged.hasMore).toBe(true)
    })

    it('should deduplicate when using hash partitioning', () => {
      const results: PartitionResult[] = [
        { partitionId: 'p0', rows: [{ id: 1 }, { id: 2 }], rowCount: 2 },
        { partitionId: 'p1', rows: [{ id: 2 }, { id: 3 }], rowCount: 2 }, // id: 2 is duplicate
      ]

      const merged = coordinator.mergeScanResults(results, {
        deduplicate: true,
        deduplicateKey: 'id',
      })

      expect(merged.rows).toHaveLength(3)
      expect(merged.duplicatesRemoved).toBe(1)
    })

    it('should collect statistics from partition results', () => {
      const results: PartitionResult[] = [
        { partitionId: 'p0', rows: [{ id: 1 }], rowCount: 1, scanTimeMs: 100, bytesScanned: 1000 },
        { partitionId: 'p1', rows: [{ id: 2 }], rowCount: 1, scanTimeMs: 150, bytesScanned: 1500 },
      ]

      const merged = coordinator.mergeScanResults(results)

      expect(merged.stats.totalBytesScanned).toBe(2500)
      expect(merged.stats.maxPartitionTime).toBe(150)
      expect(merged.stats.partitionsCompleted).toBe(2)
    })
  })

  describe('estimatePartitions', () => {
    it('should estimate optimal partition count based on row count', () => {
      const metadata: TableMetadata = {
        tableName: 'users',
        rowCount: 1000000,
        avgRowSize: 200,
      }

      const estimate = coordinator.estimatePartitions(metadata)

      expect(estimate.partitionCount).toBeGreaterThan(1)
      expect(estimate.partitionCount).toBeLessThanOrEqual(64) // Reasonable max
    })

    it('should consider available worker count', () => {
      const metadata: TableMetadata = {
        tableName: 'orders',
        rowCount: 500000,
        avgRowSize: 100,
      }

      const estimate = coordinator.estimatePartitions(metadata, {
        maxWorkers: 8,
      })

      expect(estimate.partitionCount).toBeLessThanOrEqual(8)
    })

    it('should factor in memory constraints', () => {
      const metadata: TableMetadata = {
        tableName: 'large_records',
        rowCount: 100000,
        avgRowSize: 10000, // 10KB per row
      }

      const estimate = coordinator.estimatePartitions(metadata, {
        maxMemoryPerWorker: 100 * 1024 * 1024, // 100MB
      })

      // Should create more partitions to fit in memory
      expect(estimate.partitionCount).toBeGreaterThan(1)
      expect(estimate.estimatedMemoryPerPartition).toBeLessThanOrEqual(100 * 1024 * 1024)
    })

    it('should recommend strategy based on table characteristics', () => {
      const sequentialTable: TableMetadata = {
        tableName: 'time_series',
        rowCount: 1000000,
        avgRowSize: 50,
        columnStats: {
          timestamp: { min: 0, max: 1000000, distinct: 1000000, sorted: true },
        },
      }

      const estimate = coordinator.estimatePartitions(sequentialTable, {
        rangeColumn: 'timestamp',
      })

      expect(estimate.recommendedStrategy).toBe('range')
    })

    it('should recommend hash for high-cardinality columns', () => {
      const hashableTable: TableMetadata = {
        tableName: 'transactions',
        rowCount: 500000,
        avgRowSize: 150,
        columnStats: {
          transaction_id: { min: 1, max: 500000, distinct: 500000 },
        },
      }

      const estimate = coordinator.estimatePartitions(hashableTable, {
        hashColumn: 'transaction_id',
      })

      expect(estimate.recommendedStrategy).toBe('hash')
    })

    it('should return single partition for small tables', () => {
      const smallTable: TableMetadata = {
        tableName: 'settings',
        rowCount: 100,
        avgRowSize: 500,
      }

      const estimate = coordinator.estimatePartitions(smallTable)

      expect(estimate.partitionCount).toBe(1)
      expect(estimate.reason).toContain('small')
    })

    it('should calculate estimated scan time', () => {
      const metadata: TableMetadata = {
        tableName: 'data',
        rowCount: 1000000,
        avgRowSize: 100,
      }

      const estimate = coordinator.estimatePartitions(metadata, {
        scanThroughputBytesPerSec: 100 * 1024 * 1024, // 100MB/s
      })

      expect(estimate.estimatedScanTimeMs).toBeGreaterThan(0)
      expect(estimate.estimatedParallelScanTimeMs).toBeLessThan(estimate.estimatedScanTimeMs)
    })
  })

  describe('partition strategies', () => {
    it('should support range strategy with numeric column', () => {
      const metadata: TableMetadata = {
        tableName: 'orders',
        rowCount: 10000,
        avgRowSize: 200,
        columnStats: {
          order_id: { min: 1, max: 10000, distinct: 10000 },
        },
      }

      const partitions = coordinator.partitionTable(metadata, {
        partitionCount: 5,
        strategy: 'range',
        rangeColumn: 'order_id',
      })

      expect(partitions[0].rangeStart).toBe(1)
      // Range end is calculated as: min + (i+1) * rangeSize = 1 + 1 * (9999/5) = ~2000.8
      expect(partitions[0].rangeEnd).toBeGreaterThanOrEqual(2000)
      expect(partitions[0].rangeEnd).toBeLessThan(2010)
      expect(partitions[4].rangeEnd).toBe(10000)
    })

    it('should support range strategy with timestamp column', () => {
      const now = Date.now()
      const dayMs = 24 * 60 * 60 * 1000
      const metadata: TableMetadata = {
        tableName: 'events',
        rowCount: 100000,
        avgRowSize: 100,
        columnStats: {
          created_at: { min: now - 30 * dayMs, max: now, distinct: 100000 },
        },
      }

      const partitions = coordinator.partitionTable(metadata, {
        partitionCount: 3,
        strategy: 'range',
        rangeColumn: 'created_at',
      })

      expect(partitions).toHaveLength(3)
      expect(partitions[0].rangeStart).toBeLessThan(partitions[0].rangeEnd!)
      expect(partitions[2].rangeEnd).toBe(now)
    })

    it('should handle hash strategy with modulo distribution', () => {
      const metadata: TableMetadata = {
        tableName: 'users',
        rowCount: 5000,
        avgRowSize: 300,
      }

      const partitions = coordinator.partitionTable(metadata, {
        partitionCount: 4,
        strategy: 'hash',
        hashColumn: 'user_id',
      })

      expect(partitions.every(p => p.totalBuckets === 4)).toBe(true)
      expect(new Set(partitions.map(p => p.hashBucket)).size).toBe(4)
    })

    it('should handle round-robin with even distribution', () => {
      const metadata: TableMetadata = {
        tableName: 'logs',
        rowCount: 8000,
        avgRowSize: 150,
      }

      const partitions = coordinator.partitionTable(metadata, {
        partitionCount: 4,
        strategy: 'round-robin',
      })

      // Each partition should get equal rows
      partitions.forEach(p => {
        expect(p.limit).toBe(2000)
      })
    })
  })

  describe('edge cases', () => {
    it('should handle zero row tables', () => {
      const metadata: TableMetadata = {
        tableName: 'empty',
        rowCount: 0,
        avgRowSize: 100,
      }

      const partitions = coordinator.partitionTable(metadata, { partitionCount: 4 })

      expect(partitions).toHaveLength(1)
      expect(partitions[0].limit).toBe(0)
    })

    it('should handle single row tables', () => {
      const metadata: TableMetadata = {
        tableName: 'singleton',
        rowCount: 1,
        avgRowSize: 100,
      }

      const partitions = coordinator.partitionTable(metadata, { partitionCount: 4 })

      expect(partitions).toHaveLength(1)
      expect(partitions[0].limit).toBe(1)
    })

    it('should handle partition count larger than row count', () => {
      const metadata: TableMetadata = {
        tableName: 'tiny',
        rowCount: 3,
        avgRowSize: 100,
      }

      const partitions = coordinator.partitionTable(metadata, { partitionCount: 10 })

      // Should not create more partitions than rows
      expect(partitions.length).toBeLessThanOrEqual(3)
    })

    it('should handle missing column statistics gracefully', () => {
      const metadata: TableMetadata = {
        tableName: 'unknown',
        rowCount: 10000,
        avgRowSize: 100,
        // No columnStats
      }

      const partitions = coordinator.partitionTable(metadata, {
        partitionCount: 4,
        strategy: 'range',
        rangeColumn: 'id',
      })

      // Should fall back to offset-based partitioning
      expect(partitions).toHaveLength(4)
      expect(partitions[0].rangeStart).toBeUndefined()
    })

    it('should handle merge with no results', () => {
      const results: PartitionResult[] = []

      const merged = coordinator.mergeScanResults(results)

      expect(merged.rows).toHaveLength(0)
      expect(merged.totalRowCount).toBe(0)
    })

    it('should handle merge with all empty partitions', () => {
      const results: PartitionResult[] = [
        { partitionId: 'p0', rows: [], rowCount: 0 },
        { partitionId: 'p1', rows: [], rowCount: 0 },
      ]

      const merged = coordinator.mergeScanResults(results)

      expect(merged.rows).toHaveLength(0)
      expect(merged.totalRowCount).toBe(0)
    })
  })
})
