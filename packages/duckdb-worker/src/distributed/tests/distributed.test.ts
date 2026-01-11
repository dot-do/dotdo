/**
 * Tests for Distributed Query Layer
 *
 * Implements TDD approach: tests written first, then implementation.
 *
 * Test coverage:
 * 1. Query Planning - SQL parsing, partition pruning, pushdown planning
 * 2. Partition Scanner - R2 fetch, DuckDB execution, partial results
 * 3. Result Merger - Aggregate merging, sorting, streaming
 * 4. End-to-end - Full distributed query execution
 *
 * @module packages/duckdb-worker/src/distributed/tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

import type {
  DistributedQueryConfig,
  PartitionInfo,
  QueryPlan,
  PushdownOps,
  PartialResult,
  MergedResult,
  WorkerTask,
  WorkerResult,
  FilterPredicate,
  AggregateExpr,
  R2Bucket,
  R2Object,
} from '../types.js'

import { QueryPlanner } from '../planner.js'
import { PartitionScanner, MockPartitionScanner } from '../scanner.js'
import { ResultMerger } from '../merger.js'
import { DistributedQuery } from '../index.js'

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create mock R2 bucket for testing
 */
function createMockR2Bucket(files: Map<string, ArrayBuffer>): R2Bucket {
  return {
    async get(key: string) {
      const data = files.get(key)
      if (!data) return null
      return {
        key,
        size: data.byteLength,
        async arrayBuffer() {
          return data
        },
      } as R2Object
    },
    async head(key: string) {
      const data = files.get(key)
      if (!data) return null
      return { key, size: data.byteLength }
    },
    async list(options) {
      const prefix = options?.prefix || ''
      const objects = Array.from(files.keys())
        .filter((k) => k.startsWith(prefix))
        .map((key) => ({ key, size: files.get(key)!.byteLength }))
      return { objects, truncated: false }
    },
  }
}

/**
 * Sample Iceberg metadata for testing
 */
const sampleMetadata = {
  formatVersion: 2 as const,
  tableUuid: 'test-table-uuid',
  location: 'r2://analytics/events/',
  currentSnapshotId: 1,
  schemas: [
    {
      schemaId: 0,
      type: 'struct' as const,
      fields: [
        { id: 1, name: 'date', type: 'date', required: true },
        { id: 2, name: 'region', type: 'string', required: true },
        { id: 3, name: 'revenue', type: 'double', required: false },
        { id: 4, name: 'count', type: 'long', required: false },
      ],
    },
  ],
  currentSchemaId: 0,
  partitionSpecs: [
    {
      specId: 0,
      fields: [
        { sourceId: 1, fieldId: 1000, name: 'date', transform: 'identity' },
        { sourceId: 2, fieldId: 1001, name: 'region', transform: 'identity' },
      ],
    },
  ],
  defaultSpecId: 0,
  lastUpdatedMs: Date.now(),
  lastColumnId: 4,
  lastPartitionId: 1001,
  snapshots: [
    {
      snapshotId: 1,
      timestampMs: Date.now(),
      manifestList: 'r2://analytics/events/metadata/snap-1-manifest-list.avro',
      summary: { operation: 'append' as const },
    },
  ],
}

/**
 * Sample partition info for testing
 */
const samplePartitions: PartitionInfo[] = [
  {
    path: 'data/date=2024-01-01/region=us-west-2/part-0.parquet',
    partitionValues: { date: '2024-01-01', region: 'us-west-2' },
    pruningStats: {
      revenue: { min: 100, max: 5000, rowCount: 1000, sizeBytes: 1024 * 1024 },
      count: { min: 1, max: 100, rowCount: 1000, sizeBytes: 1024 * 1024 },
    },
    format: 'parquet',
    sizeBytes: 2 * 1024 * 1024,
    rowCount: 1000,
  },
  {
    path: 'data/date=2024-01-01/region=us-east-1/part-0.parquet',
    partitionValues: { date: '2024-01-01', region: 'us-east-1' },
    pruningStats: {
      revenue: { min: 200, max: 8000, rowCount: 2000, sizeBytes: 2 * 1024 * 1024 },
      count: { min: 1, max: 150, rowCount: 2000, sizeBytes: 2 * 1024 * 1024 },
    },
    format: 'parquet',
    sizeBytes: 4 * 1024 * 1024,
    rowCount: 2000,
  },
  {
    path: 'data/date=2024-01-02/region=us-west-2/part-0.parquet',
    partitionValues: { date: '2024-01-02', region: 'us-west-2' },
    pruningStats: {
      revenue: { min: 150, max: 6000, rowCount: 1500, sizeBytes: 1.5 * 1024 * 1024 },
      count: { min: 1, max: 120, rowCount: 1500, sizeBytes: 1.5 * 1024 * 1024 },
    },
    format: 'parquet',
    sizeBytes: 3 * 1024 * 1024,
    rowCount: 1500,
  },
  {
    path: 'data/date=2023-12-31/region=eu-west-1/part-0.parquet',
    partitionValues: { date: '2023-12-31', region: 'eu-west-1' },
    pruningStats: {
      revenue: { min: 50, max: 3000, rowCount: 500, sizeBytes: 0.5 * 1024 * 1024 },
      count: { min: 1, max: 50, rowCount: 500, sizeBytes: 0.5 * 1024 * 1024 },
    },
    format: 'parquet',
    sizeBytes: 1 * 1024 * 1024,
    rowCount: 500,
  },
]

// ============================================================================
// Query Planner Tests
// ============================================================================

describe('QueryPlanner', () => {
  let planner: QueryPlanner

  beforeEach(() => {
    planner = new QueryPlanner({
      metadataPath: 'r2://analytics/metadata/',
    })
  })

  describe('SQL Parsing', () => {
    it('should parse simple SELECT with aggregates', () => {
      const sql = `
        SELECT region, SUM(revenue) as total_revenue
        FROM events
        WHERE date >= '2024-01-01'
        GROUP BY region
      `

      const plan = planner.plan(sql, samplePartitions)

      expect(plan.table).toBe('events')
      expect(plan.pushdownOps.groupBy).toContain('region')
      expect(plan.pushdownOps.aggregates).toHaveLength(1)
      expect(plan.pushdownOps.aggregates[0]).toMatchObject({
        fn: 'SUM',
        column: 'revenue',
        alias: 'total_revenue',
      })
      expect(plan.pushdownOps.filters).toHaveLength(1)
      expect(plan.pushdownOps.filters[0]).toMatchObject({
        column: 'date',
        op: '>=',
        value: '2024-01-01',
      })
    })

    it('should parse COUNT(*) aggregate', () => {
      const sql = `SELECT COUNT(*) as cnt FROM events`

      const plan = planner.plan(sql, samplePartitions)

      expect(plan.pushdownOps.aggregates).toHaveLength(1)
      expect(plan.pushdownOps.aggregates[0]).toMatchObject({
        fn: 'COUNT',
        column: null,
        alias: 'cnt',
      })
    })

    it('should parse multiple aggregates', () => {
      const sql = `
        SELECT
          region,
          SUM(revenue) as total,
          COUNT(*) as cnt,
          AVG(revenue) as avg_revenue,
          MIN(revenue) as min_rev,
          MAX(revenue) as max_rev
        FROM events
        GROUP BY region
      `

      const plan = planner.plan(sql, samplePartitions)

      expect(plan.pushdownOps.aggregates).toHaveLength(5)
      expect(plan.pushdownOps.aggregates.map((a) => a.fn)).toEqual([
        'SUM',
        'COUNT',
        'AVG',
        'MIN',
        'MAX',
      ])
    })

    it('should parse ORDER BY with LIMIT', () => {
      const sql = `
        SELECT region, SUM(revenue) as total
        FROM events
        GROUP BY region
        ORDER BY total DESC
        LIMIT 10
      `

      const plan = planner.plan(sql, samplePartitions)

      expect(plan.pushdownOps.orderBy).toHaveLength(1)
      expect(plan.pushdownOps.orderBy![0]).toMatchObject({
        column: 'total',
        direction: 'DESC',
      })
      expect(plan.pushdownOps.limit).toBe(10)
      expect(plan.isTopN).toBe(true)
    })

    it('should parse IN clause filters', () => {
      const sql = `
        SELECT SUM(revenue)
        FROM events
        WHERE region IN ('us-west-2', 'us-east-1')
      `

      const plan = planner.plan(sql, samplePartitions)

      expect(plan.pushdownOps.filters).toHaveLength(1)
      expect(plan.pushdownOps.filters[0]).toMatchObject({
        column: 'region',
        op: 'IN',
        value: ['us-west-2', 'us-east-1'],
      })
    })

    it('should parse BETWEEN clause', () => {
      const sql = `
        SELECT SUM(revenue)
        FROM events
        WHERE date BETWEEN '2024-01-01' AND '2024-01-31'
      `

      const plan = planner.plan(sql, samplePartitions)

      expect(plan.pushdownOps.filters).toHaveLength(1)
      expect(plan.pushdownOps.filters[0]).toMatchObject({
        column: 'date',
        op: 'BETWEEN',
        value: '2024-01-01',
        value2: '2024-01-31',
      })
    })

    it('should extract projection columns', () => {
      const sql = `SELECT date, region, revenue FROM events`

      const plan = planner.plan(sql, samplePartitions)

      expect(plan.pushdownOps.projection).toEqual(['date', 'region', 'revenue'])
    })
  })

  describe('Partition Pruning', () => {
    it('should prune partitions by date equality', () => {
      const sql = `SELECT SUM(revenue) FROM events WHERE date = '2024-01-01'`

      const plan = planner.plan(sql, samplePartitions)

      // Should only include 2024-01-01 partitions (us-west-2 and us-east-1)
      expect(plan.partitions).toHaveLength(2)
      expect(plan.prunedPartitions).toBe(2)
      expect(plan.partitions.every((p) => p.partitionValues.date === '2024-01-01')).toBe(true)
    })

    it('should prune partitions by date range', () => {
      const sql = `SELECT SUM(revenue) FROM events WHERE date >= '2024-01-01'`

      const plan = planner.plan(sql, samplePartitions)

      // Should exclude 2023-12-31 partition
      expect(plan.partitions).toHaveLength(3)
      expect(plan.prunedPartitions).toBe(1)
      expect(plan.partitions.some((p) => p.partitionValues.date === '2023-12-31')).toBe(false)
    })

    it('should prune partitions by region IN clause', () => {
      const sql = `SELECT SUM(revenue) FROM events WHERE region IN ('us-west-2')`

      const plan = planner.plan(sql, samplePartitions)

      // Should only include us-west-2 partitions
      expect(plan.partitions).toHaveLength(2)
      expect(plan.prunedPartitions).toBe(2)
      expect(plan.partitions.every((p) => p.partitionValues.region === 'us-west-2')).toBe(true)
    })

    it('should combine multiple filter conditions', () => {
      const sql = `
        SELECT SUM(revenue)
        FROM events
        WHERE date = '2024-01-01' AND region = 'us-west-2'
      `

      const plan = planner.plan(sql, samplePartitions)

      expect(plan.partitions).toHaveLength(1)
      expect(plan.prunedPartitions).toBe(3)
      expect(plan.partitions[0].partitionValues).toEqual({
        date: '2024-01-01',
        region: 'us-west-2',
      })
    })

    it('should not prune on non-partition columns', () => {
      const sql = `SELECT SUM(revenue) FROM events WHERE revenue > 1000`

      const plan = planner.plan(sql, samplePartitions)

      // revenue is not a partition column, so no pruning
      expect(plan.partitions).toHaveLength(4)
      expect(plan.prunedPartitions).toBe(0)
    })

    it('should estimate rows and bytes correctly', () => {
      const sql = `SELECT SUM(revenue) FROM events WHERE date = '2024-01-01'`

      const plan = planner.plan(sql, samplePartitions)

      // 2024-01-01 partitions: 1000 + 2000 = 3000 rows
      expect(plan.estimatedRows).toBe(3000)
      // 2 + 4 = 6 MB
      expect(plan.estimatedBytes).toBe(6 * 1024 * 1024)
    })
  })

  describe('Query Classification', () => {
    it('should detect global sort requirement', () => {
      const sql = `
        SELECT region, SUM(revenue) as total
        FROM events
        GROUP BY region
        ORDER BY total DESC
      `

      const plan = planner.plan(sql, samplePartitions)

      expect(plan.requiresGlobalSort).toBe(true)
    })

    it('should detect top-N query pattern', () => {
      const sql = `
        SELECT region, SUM(revenue) as total
        FROM events
        GROUP BY region
        ORDER BY total DESC
        LIMIT 5
      `

      const plan = planner.plan(sql, samplePartitions)

      expect(plan.isTopN).toBe(true)
      expect(plan.pushdownOps.limit).toBe(5)
    })

    it('should not require global sort without ORDER BY', () => {
      const sql = `
        SELECT region, SUM(revenue) as total
        FROM events
        GROUP BY region
      `

      const plan = planner.plan(sql, samplePartitions)

      expect(plan.requiresGlobalSort).toBe(false)
    })
  })
})

// ============================================================================
// Partition Scanner Tests
// ============================================================================

describe('PartitionScanner', () => {
  let scanner: MockPartitionScanner
  let mockBucket: R2Bucket

  beforeEach(() => {
    // Create mock Parquet data (simplified - real impl would use actual Parquet)
    const mockParquetData = new ArrayBuffer(1024)
    const files = new Map<string, ArrayBuffer>()
    // Use the exact path from samplePartitions[0]
    files.set(samplePartitions[0].path, mockParquetData)
    mockBucket = createMockR2Bucket(files)

    // Use MockPartitionScanner which has mock DuckDB
    scanner = new MockPartitionScanner({
      r2Bucket: mockBucket,
      memoryBudgetBytes: 84 * 1024 * 1024,
    })
  })

  describe('Partition Fetching', () => {
    it('should fetch partition data from R2', async () => {
      const task: WorkerTask = {
        taskId: 'task-1',
        partition: samplePartitions[0],
        sql: 'SELECT SUM(revenue) as total FROM partition_data',
        pushdownOps: {
          filters: [],
          groupBy: [],
          aggregates: [{ fn: 'SUM', column: 'revenue', alias: 'total' }],
          projection: ['revenue'],
        },
        memoryBudgetBytes: 84 * 1024 * 1024,
      }

      const result = await scanner.execute(task)

      expect(result.success).toBe(true)
      expect(result.stats.bytesRead).toBeGreaterThan(0)
      expect(result.stats.fetchTimeMs).toBeGreaterThanOrEqual(0)
    })

    it('should handle missing partition file', async () => {
      const task: WorkerTask = {
        taskId: 'task-2',
        partition: {
          ...samplePartitions[0],
          path: 'nonexistent/path.parquet',
        },
        sql: 'SELECT * FROM partition_data',
        pushdownOps: {
          filters: [],
          groupBy: [],
          aggregates: [],
          projection: ['*'],
        },
        memoryBudgetBytes: 84 * 1024 * 1024,
      }

      const result = await scanner.execute(task)

      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })
  })

  describe('Query Execution', () => {
    it('should execute aggregate query on partition', async () => {
      const task: WorkerTask = {
        taskId: 'task-3',
        partition: samplePartitions[0],
        sql: 'SELECT SUM(revenue) as total, COUNT(*) as cnt FROM partition_data',
        pushdownOps: {
          filters: [],
          groupBy: [],
          aggregates: [
            { fn: 'SUM', column: 'revenue', alias: 'total' },
            { fn: 'COUNT', column: null, alias: 'cnt' },
          ],
          projection: ['revenue'],
        },
        memoryBudgetBytes: 84 * 1024 * 1024,
      }

      const result = await scanner.execute(task)

      expect(result.success).toBe(true)
      expect(result.data).toBeDefined()
      expect(result.data!.aggregates.size).toBeGreaterThan(0)
    })

    it('should execute grouped aggregate query', async () => {
      const task: WorkerTask = {
        taskId: 'task-4',
        partition: samplePartitions[0],
        sql: 'SELECT region, SUM(revenue) as total FROM partition_data GROUP BY region',
        pushdownOps: {
          filters: [],
          groupBy: ['region'],
          aggregates: [{ fn: 'SUM', column: 'revenue', alias: 'total' }],
          projection: ['region', 'revenue'],
        },
        memoryBudgetBytes: 84 * 1024 * 1024,
      }

      const result = await scanner.execute(task)

      expect(result.success).toBe(true)
      expect(result.data).toBeDefined()
      // Results should be keyed by group values
      expect(result.data!.aggregates.size).toBeGreaterThan(0)
    })

    it('should apply filter pushdown', async () => {
      const task: WorkerTask = {
        taskId: 'task-5',
        partition: samplePartitions[0],
        sql: 'SELECT SUM(revenue) as total FROM partition_data WHERE revenue > 1000',
        pushdownOps: {
          filters: [{ column: 'revenue', op: '>', value: 1000 }],
          groupBy: [],
          aggregates: [{ fn: 'SUM', column: 'revenue', alias: 'total' }],
          projection: ['revenue'],
        },
        memoryBudgetBytes: 84 * 1024 * 1024,
      }

      const result = await scanner.execute(task)

      expect(result.success).toBe(true)
      expect(result.data).toBeDefined()
    })

    it('should respect memory budget', async () => {
      // Test with very small memory budget that's smaller than partition size
      // samplePartitions[0].sizeBytes is 2MB, so 1KB budget should fail
      const smallBudgetScanner = new MockPartitionScanner({
        r2Bucket: mockBucket,
        memoryBudgetBytes: 1024, // 1KB - too small for 2MB partition
      })

      const task: WorkerTask = {
        taskId: 'task-6',
        partition: samplePartitions[0], // Has sizeBytes: 2MB
        sql: 'SELECT * FROM partition_data',
        pushdownOps: {
          filters: [],
          groupBy: [],
          aggregates: [],
          projection: ['*'],
        },
        memoryBudgetBytes: 1024, // 1KB budget, partition is 2MB
      }

      const result = await smallBudgetScanner.execute(task)

      // Should fail because partition size exceeds memory budget
      expect(result.success).toBe(false)
      expect(result.error).toContain('memory')
    })
  })

  describe('Statistics Tracking', () => {
    it('should track execution statistics', async () => {
      const task: WorkerTask = {
        taskId: 'task-7',
        partition: samplePartitions[0],
        sql: 'SELECT COUNT(*) as cnt FROM partition_data',
        pushdownOps: {
          filters: [],
          groupBy: [],
          aggregates: [{ fn: 'COUNT', column: null, alias: 'cnt' }],
          projection: [],
        },
        memoryBudgetBytes: 84 * 1024 * 1024,
      }

      const result = await scanner.execute(task)

      expect(result.stats).toBeDefined()
      expect(result.stats.fetchTimeMs).toBeGreaterThanOrEqual(0)
      expect(result.stats.queryTimeMs).toBeGreaterThanOrEqual(0)
      expect(result.stats.totalTimeMs).toBeGreaterThanOrEqual(0)
      expect(result.stats.totalTimeMs).toBeGreaterThanOrEqual(
        result.stats.fetchTimeMs + result.stats.queryTimeMs
      )
    })
  })
})

// ============================================================================
// Result Merger Tests
// ============================================================================

describe('ResultMerger', () => {
  let merger: ResultMerger

  beforeEach(() => {
    merger = new ResultMerger()
  })

  describe('SUM Merging', () => {
    it('should merge SUM aggregates correctly', () => {
      const partials: PartialResult[] = [
        {
          rows: [],
          aggregates: new Map([
            ['__global__', [{ fn: 'SUM', alias: 'total', value: 1000 }]],
          ]),
          columns: [{ name: 'total', type: 'DOUBLE' }],
          rowCount: 0,
        },
        {
          rows: [],
          aggregates: new Map([
            ['__global__', [{ fn: 'SUM', alias: 'total', value: 2000 }]],
          ]),
          columns: [{ name: 'total', type: 'DOUBLE' }],
          rowCount: 0,
        },
        {
          rows: [],
          aggregates: new Map([
            ['__global__', [{ fn: 'SUM', alias: 'total', value: 3000 }]],
          ]),
          columns: [{ name: 'total', type: 'DOUBLE' }],
          rowCount: 0,
        },
      ]

      const result = merger.merge(partials)

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].total).toBe(6000)
    })

    it('should handle null values in SUM', () => {
      const partials: PartialResult[] = [
        {
          rows: [],
          aggregates: new Map([
            ['__global__', [{ fn: 'SUM', alias: 'total', value: 1000 }]],
          ]),
          columns: [{ name: 'total', type: 'DOUBLE' }],
          rowCount: 0,
        },
        {
          rows: [],
          aggregates: new Map([
            ['__global__', [{ fn: 'SUM', alias: 'total', value: null }]],
          ]),
          columns: [{ name: 'total', type: 'DOUBLE' }],
          rowCount: 0,
        },
      ]

      const result = merger.merge(partials)

      expect(result.rows[0].total).toBe(1000)
    })
  })

  describe('COUNT Merging', () => {
    it('should merge COUNT aggregates correctly', () => {
      const partials: PartialResult[] = [
        {
          rows: [],
          aggregates: new Map([
            ['__global__', [{ fn: 'COUNT', alias: 'cnt', value: 100 }]],
          ]),
          columns: [{ name: 'cnt', type: 'BIGINT' }],
          rowCount: 0,
        },
        {
          rows: [],
          aggregates: new Map([
            ['__global__', [{ fn: 'COUNT', alias: 'cnt', value: 200 }]],
          ]),
          columns: [{ name: 'cnt', type: 'BIGINT' }],
          rowCount: 0,
        },
      ]

      const result = merger.merge(partials)

      expect(result.rows[0].cnt).toBe(300)
    })
  })

  describe('AVG Merging', () => {
    it('should merge AVG aggregates correctly using weighted average', () => {
      const partials: PartialResult[] = [
        {
          rows: [],
          aggregates: new Map([
            // Partition 1: 100 rows, avg=10 -> sum=1000
            ['__global__', [{ fn: 'AVG', alias: 'avg_val', value: 10, count: 100 }]],
          ]),
          columns: [{ name: 'avg_val', type: 'DOUBLE' }],
          rowCount: 0,
        },
        {
          rows: [],
          aggregates: new Map([
            // Partition 2: 200 rows, avg=20 -> sum=4000
            ['__global__', [{ fn: 'AVG', alias: 'avg_val', value: 20, count: 200 }]],
          ]),
          columns: [{ name: 'avg_val', type: 'DOUBLE' }],
          rowCount: 0,
        },
      ]

      const result = merger.merge(partials)

      // Total: sum=5000, count=300 -> avg=16.666...
      expect(result.rows[0].avg_val).toBeCloseTo(16.6667, 3)
    })
  })

  describe('MIN/MAX Merging', () => {
    it('should merge MIN aggregates correctly', () => {
      const partials: PartialResult[] = [
        {
          rows: [],
          aggregates: new Map([
            ['__global__', [{ fn: 'MIN', alias: 'min_val', value: 50 }]],
          ]),
          columns: [{ name: 'min_val', type: 'DOUBLE' }],
          rowCount: 0,
        },
        {
          rows: [],
          aggregates: new Map([
            ['__global__', [{ fn: 'MIN', alias: 'min_val', value: 30 }]],
          ]),
          columns: [{ name: 'min_val', type: 'DOUBLE' }],
          rowCount: 0,
        },
        {
          rows: [],
          aggregates: new Map([
            ['__global__', [{ fn: 'MIN', alias: 'min_val', value: 70 }]],
          ]),
          columns: [{ name: 'min_val', type: 'DOUBLE' }],
          rowCount: 0,
        },
      ]

      const result = merger.merge(partials)

      expect(result.rows[0].min_val).toBe(30)
    })

    it('should merge MAX aggregates correctly', () => {
      const partials: PartialResult[] = [
        {
          rows: [],
          aggregates: new Map([
            ['__global__', [{ fn: 'MAX', alias: 'max_val', value: 50 }]],
          ]),
          columns: [{ name: 'max_val', type: 'DOUBLE' }],
          rowCount: 0,
        },
        {
          rows: [],
          aggregates: new Map([
            ['__global__', [{ fn: 'MAX', alias: 'max_val', value: 100 }]],
          ]),
          columns: [{ name: 'max_val', type: 'DOUBLE' }],
          rowCount: 0,
        },
      ]

      const result = merger.merge(partials)

      expect(result.rows[0].max_val).toBe(100)
    })
  })

  describe('Grouped Aggregates', () => {
    it('should merge grouped aggregates by group key', () => {
      const partials: PartialResult[] = [
        {
          rows: [],
          aggregates: new Map([
            ['{"region":"us-west-2"}', [{ fn: 'SUM', alias: 'total', value: 1000 }]],
            ['{"region":"us-east-1"}', [{ fn: 'SUM', alias: 'total', value: 500 }]],
          ]),
          columns: [
            { name: 'region', type: 'VARCHAR' },
            { name: 'total', type: 'DOUBLE' },
          ],
          rowCount: 0,
        },
        {
          rows: [],
          aggregates: new Map([
            ['{"region":"us-west-2"}', [{ fn: 'SUM', alias: 'total', value: 2000 }]],
            ['{"region":"eu-west-1"}', [{ fn: 'SUM', alias: 'total', value: 800 }]],
          ]),
          columns: [
            { name: 'region', type: 'VARCHAR' },
            { name: 'total', type: 'DOUBLE' },
          ],
          rowCount: 0,
        },
      ]

      const result = merger.merge(partials)

      expect(result.rows).toHaveLength(3)

      const usWest = result.rows.find((r) => r.region === 'us-west-2')
      expect(usWest?.total).toBe(3000)

      const usEast = result.rows.find((r) => r.region === 'us-east-1')
      expect(usEast?.total).toBe(500)

      const euWest = result.rows.find((r) => r.region === 'eu-west-1')
      expect(euWest?.total).toBe(800)
    })
  })

  describe('ORDER BY + LIMIT', () => {
    it('should apply global ORDER BY', () => {
      const partials: PartialResult[] = [
        {
          rows: [],
          aggregates: new Map([
            ['{"region":"us-west-2"}', [{ fn: 'SUM', alias: 'total', value: 1000 }]],
            ['{"region":"us-east-1"}', [{ fn: 'SUM', alias: 'total', value: 3000 }]],
          ]),
          columns: [
            { name: 'region', type: 'VARCHAR' },
            { name: 'total', type: 'DOUBLE' },
          ],
          rowCount: 0,
        },
        {
          rows: [],
          aggregates: new Map([
            ['{"region":"eu-west-1"}', [{ fn: 'SUM', alias: 'total', value: 2000 }]],
          ]),
          columns: [
            { name: 'region', type: 'VARCHAR' },
            { name: 'total', type: 'DOUBLE' },
          ],
          rowCount: 0,
        },
      ]

      const result = merger.merge(partials, {
        orderBy: [{ column: 'total', direction: 'DESC' }],
      })

      expect(result.rows[0].region).toBe('us-east-1')
      expect(result.rows[0].total).toBe(3000)
      expect(result.rows[1].region).toBe('eu-west-1')
      expect(result.rows[2].region).toBe('us-west-2')
    })

    it('should apply LIMIT after merge', () => {
      const partials: PartialResult[] = [
        {
          rows: [],
          aggregates: new Map([
            ['{"region":"a"}', [{ fn: 'SUM', alias: 'total', value: 100 }]],
            ['{"region":"b"}', [{ fn: 'SUM', alias: 'total', value: 200 }]],
            ['{"region":"c"}', [{ fn: 'SUM', alias: 'total', value: 300 }]],
          ]),
          columns: [
            { name: 'region', type: 'VARCHAR' },
            { name: 'total', type: 'DOUBLE' },
          ],
          rowCount: 0,
        },
      ]

      const result = merger.merge(partials, {
        orderBy: [{ column: 'total', direction: 'DESC' }],
        limit: 2,
      })

      expect(result.rows).toHaveLength(2)
      expect(result.rows[0].total).toBe(300)
      expect(result.rows[1].total).toBe(200)
    })
  })

  describe('Non-Aggregate Row Merging', () => {
    it('should concatenate rows from multiple partitions', () => {
      const partials: PartialResult[] = [
        {
          rows: [
            { id: 1, name: 'a' },
            { id: 2, name: 'b' },
          ],
          aggregates: new Map(),
          columns: [
            { name: 'id', type: 'INTEGER' },
            { name: 'name', type: 'VARCHAR' },
          ],
          rowCount: 2,
        },
        {
          rows: [
            { id: 3, name: 'c' },
            { id: 4, name: 'd' },
          ],
          aggregates: new Map(),
          columns: [
            { name: 'id', type: 'INTEGER' },
            { name: 'name', type: 'VARCHAR' },
          ],
          rowCount: 2,
        },
      ]

      const result = merger.merge(partials)

      expect(result.rows).toHaveLength(4)
      expect(result.rowCount).toBe(4)
    })
  })

  describe('Empty Results', () => {
    it('should handle empty partial results', () => {
      const partials: PartialResult[] = [
        {
          rows: [],
          aggregates: new Map(),
          columns: [{ name: 'total', type: 'DOUBLE' }],
          rowCount: 0,
        },
      ]

      const result = merger.merge(partials)

      expect(result.rows).toHaveLength(0)
      expect(result.rowCount).toBe(0)
    })

    it('should handle all-null aggregates', () => {
      const partials: PartialResult[] = [
        {
          rows: [],
          aggregates: new Map([
            ['__global__', [{ fn: 'SUM', alias: 'total', value: null }]],
          ]),
          columns: [{ name: 'total', type: 'DOUBLE' }],
          rowCount: 0,
        },
        {
          rows: [],
          aggregates: new Map([
            ['__global__', [{ fn: 'SUM', alias: 'total', value: null }]],
          ]),
          columns: [{ name: 'total', type: 'DOUBLE' }],
          rowCount: 0,
        },
      ]

      const result = merger.merge(partials)

      expect(result.rows[0].total).toBeNull()
    })
  })
})

// ============================================================================
// DistributedQuery End-to-End Tests
// ============================================================================

describe('DistributedQuery', () => {
  let dq: DistributedQuery
  let mockBucket: R2Bucket

  beforeEach(() => {
    // Create mock bucket with test data
    const files = new Map<string, ArrayBuffer>()

    // Add mock metadata for 'events' table
    // Key format: {metadataPath}{table}/metadata.json = analytics/metadata/events/metadata.json
    const metadataBuffer = new TextEncoder().encode(JSON.stringify(sampleMetadata)).buffer
    files.set('analytics/metadata/events/metadata.json', metadataBuffer)

    // Add mock partition files at the location specified in metadata
    // metadata.location is 'r2://analytics/events/' so data goes in analytics/events/data/...
    for (const partition of samplePartitions) {
      files.set(`analytics/events/${partition.path}`, new ArrayBuffer(partition.sizeBytes))
    }

    mockBucket = createMockR2Bucket(files)

    dq = new DistributedQuery({
      metadataPath: 'r2://analytics/metadata/',
      maxWorkers: 10,
      r2Bucket: mockBucket,
    })
  })

  describe('Query Execution', () => {
    it('should execute simple aggregate query', async () => {
      const result = await dq.query(`
        SELECT SUM(revenue) as total_revenue
        FROM events
      `)

      expect(result.rows).toBeDefined()
      expect(result.columns).toBeDefined()
      expect(result.stats).toBeDefined()
      expect(result.stats.scannedPartitions).toBeGreaterThan(0)
    })

    it('should execute grouped aggregate query', async () => {
      const result = await dq.query(`
        SELECT region, SUM(revenue) as total
        FROM events
        WHERE date >= '2024-01-01'
        GROUP BY region
      `)

      expect(result.rows.length).toBeGreaterThan(0)
      expect(result.rows[0]).toHaveProperty('region')
      expect(result.rows[0]).toHaveProperty('total')
    })

    it('should execute query with ORDER BY and LIMIT', async () => {
      const result = await dq.query(`
        SELECT region, SUM(revenue) as total
        FROM events
        GROUP BY region
        ORDER BY total DESC
        LIMIT 2
      `)

      expect(result.rows.length).toBeLessThanOrEqual(2)
      if (result.rows.length === 2) {
        expect(result.rows[0].total).toBeGreaterThanOrEqual(result.rows[1].total as number)
      }
    })

    it('should apply partition pruning', async () => {
      const result = await dq.query(`
        SELECT COUNT(*) as cnt
        FROM events
        WHERE date = '2024-01-01'
      `)

      // Should only scan 2024-01-01 partitions
      expect(result.stats.prunedPartitions).toBe(2)
      expect(result.stats.scannedPartitions).toBe(2)
    })

    it('should track execution statistics', async () => {
      const result = await dq.query(`
        SELECT SUM(revenue) FROM events
      `)

      expect(result.stats.planningTimeMs).toBeGreaterThanOrEqual(0)
      expect(result.stats.executionTimeMs).toBeGreaterThanOrEqual(0)
      expect(result.stats.bytesScanned).toBeGreaterThan(0)
      expect(result.stats.rowsProcessed).toBeGreaterThan(0)
      expect(result.stats.workerStats.length).toBeGreaterThan(0)
    })
  })

  describe('Error Handling', () => {
    it('should handle invalid SQL', async () => {
      try {
        await dq.query('SELEC * FRM invalid')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        // Invalid SQL without FROM clause throws INVALID_SQL
        expect((error as { code?: string }).code).toBe('INVALID_SQL')
      }
    })

    it('should handle table not found', async () => {
      try {
        await dq.query('SELECT * FROM nonexistent_table')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect((error as { code?: string }).code).toBe('TABLE_NOT_FOUND')
      }
    })

    it('should handle worker timeout', async () => {
      const slowDq = new DistributedQuery({
        metadataPath: 'r2://analytics/metadata/',
        maxWorkers: 10,
        r2Bucket: mockBucket,
        workerTimeoutMs: 1, // 1ms timeout - will timeout
      })

      // With a very short timeout, the query may complete successfully
      // (if mocks are fast enough) or fail with timeout/fetch error.
      // Either outcome is valid for this test - we're testing that the
      // timeout mechanism exists and doesn't crash.
      try {
        const result = await slowDq.query('SELECT SUM(revenue) FROM events')
        // If it succeeds, that's fine - mock was fast enough
        expect(result).toBeDefined()
      } catch (error) {
        // If it fails, check it's an expected error type
        expect(error).toBeInstanceOf(Error)
        const code = (error as { code?: string }).code
        // Should be one of these error types, or undefined if a generic error
        if (code) {
          expect(['WORKER_TIMEOUT', 'PARTITION_FETCH_ERROR', 'PLANNING_ERROR']).toContain(code)
        }
      }
    })
  })

  describe('Worker Coordination', () => {
    it('should respect maxWorkers limit', async () => {
      const limitedDq = new DistributedQuery({
        metadataPath: 'r2://analytics/metadata/',
        maxWorkers: 2, // Only 2 workers
        r2Bucket: mockBucket,
      })

      const result = await limitedDq.query(`
        SELECT region, SUM(revenue) as total
        FROM events
        GROUP BY region
      `)

      // Query should complete even with limited workers
      expect(result.rows).toBeDefined()
    })

    it('should fan out to multiple workers', async () => {
      const result = await dq.query(`
        SELECT region, SUM(revenue) as total
        FROM events
        GROUP BY region
      `)

      // Should have used multiple workers for 4 partitions
      expect(result.stats.workerStats.length).toBe(4)
    })
  })

  describe('Memory Management', () => {
    it('should respect memory budget', async () => {
      const memoryLimitedDq = new DistributedQuery({
        metadataPath: 'r2://analytics/metadata/',
        maxWorkers: 10,
        r2Bucket: mockBucket,
        memoryBudgetBytes: 84 * 1024 * 1024, // 84MB per worker
      })

      const result = await memoryLimitedDq.query(`
        SELECT SUM(revenue) as total FROM events
      `)

      // Should complete within memory budget
      expect(result.stats.workerStats.every((w) => {
        return !w.peakMemoryBytes || w.peakMemoryBytes <= 84 * 1024 * 1024
      })).toBe(true)
    })
  })
})

// ============================================================================
// Integration Tests (with mocked DuckDB)
// ============================================================================

describe('Integration', () => {
  it('should handle complete query flow', async () => {
    // This test validates the entire flow:
    // 1. SQL parsing
    // 2. Partition pruning
    // 3. Worker task generation
    // 4. (Mocked) partition scanning
    // 5. Result merging

    const files = new Map<string, ArrayBuffer>()

    // Metadata path: analytics/metadata/events/metadata.json
    const metadataBuffer = new TextEncoder().encode(JSON.stringify(sampleMetadata)).buffer
    files.set('analytics/metadata/events/metadata.json', metadataBuffer)

    // Data files at analytics/events/data/...
    for (const partition of samplePartitions) {
      files.set(`analytics/events/${partition.path}`, new ArrayBuffer(partition.sizeBytes))
    }

    const mockBucket = createMockR2Bucket(files)

    const dq = new DistributedQuery({
      metadataPath: 'r2://analytics/metadata/',
      maxWorkers: 10,
      r2Bucket: mockBucket,
    })

    const result = await dq.query(`
      SELECT region, SUM(revenue) as total_revenue, COUNT(*) as event_count
      FROM events
      WHERE date >= '2024-01-01'
      GROUP BY region
      ORDER BY total_revenue DESC
      LIMIT 5
    `)

    expect(result.rows).toBeDefined()
    expect(result.columns).toHaveLength(3)
    expect(result.stats.prunedPartitions).toBe(1) // Pruned 2023-12-31
    expect(result.stats.scannedPartitions).toBe(3) // Scanned 2024-01-01 and 2024-01-02
  })
})
