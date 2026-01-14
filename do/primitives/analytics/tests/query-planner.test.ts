/**
 * Query Planner with Partition Pruning Tests
 *
 * Tests for a cost-based query planner that leverages statistics for optimization:
 * - Partition pruning based on filter predicates
 * - Cost estimation using column statistics
 * - Query plan generation and optimization
 * - Human-readable EXPLAIN output
 *
 * The planner integrates with Iceberg column statistics for file pruning
 * and uses bloom filters for equality predicates.
 *
 * @see dotdo-wjymp
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  QueryPlanner,
  createQueryPlanner,
  // Types
  type AnalyticsQuery,
  type TableStats,
  type PartitionStats,
  type ColumnStats,
  type QueryPlan,
  type PlanNode,
  type CostEstimate,
  // Predicate helpers
  eq,
  gt,
  lt,
  gte,
  lte,
  between,
  inList,
  neq,
} from '../query-planner'

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create sample partition stats for testing
 */
function createPartitionStats(overrides: Partial<PartitionStats> = {}): PartitionStats {
  return {
    partitionId: overrides.partitionId ?? 'partition-001',
    rowCount: overrides.rowCount ?? 10000,
    sizeBytes: overrides.sizeBytes ?? 1024 * 1024, // 1MB
    columns: overrides.columns ?? new Map(),
    bloomFilter: overrides.bloomFilter ?? null,
    ...overrides,
  }
}

/**
 * Create sample column stats for testing
 */
function createColumnStats(overrides: Partial<ColumnStats> = {}): ColumnStats {
  return {
    name: overrides.name ?? 'column',
    type: overrides.type ?? 'string',
    distinctCount: overrides.distinctCount ?? 1000,
    nullCount: overrides.nullCount ?? 0,
    minValue: overrides.minValue ?? 'aaa',
    maxValue: overrides.maxValue ?? 'zzz',
    histogram: overrides.histogram ?? undefined,
    ...overrides,
  }
}

/**
 * Create sample table stats with partitions for testing
 */
function createTableStats(partitionCount: number = 10): TableStats {
  const partitions: PartitionStats[] = []

  for (let i = 0; i < partitionCount; i++) {
    const partitionId = `partition-${String(i).padStart(3, '0')}`
    const startChar = String.fromCharCode(97 + Math.floor(i * 26 / partitionCount)) // a-z
    const endChar = String.fromCharCode(97 + Math.floor((i + 1) * 26 / partitionCount))

    const columns = new Map<string, ColumnStats>()
    columns.set('id', createColumnStats({
      name: 'id',
      type: 'string',
      minValue: `${startChar}aa`,
      maxValue: `${endChar}zz`,
      distinctCount: 1000,
    }))
    columns.set('amount', createColumnStats({
      name: 'amount',
      type: 'number',
      minValue: i * 100,
      maxValue: (i + 1) * 100,
      distinctCount: 100,
    }))
    columns.set('region', createColumnStats({
      name: 'region',
      type: 'string',
      minValue: 'APAC',
      maxValue: 'US',
      distinctCount: 5,
    }))

    partitions.push(createPartitionStats({
      partitionId,
      rowCount: 10000,
      sizeBytes: 1024 * 1024,
      columns,
    }))
  }

  const globalColumns: ColumnStats[] = [
    createColumnStats({ name: 'id', type: 'string', distinctCount: partitionCount * 1000 }),
    createColumnStats({ name: 'amount', type: 'number', minValue: 0, maxValue: partitionCount * 100 }),
    createColumnStats({ name: 'region', type: 'string', distinctCount: 5 }),
  ]

  return {
    tableName: 'orders',
    rowCount: partitionCount * 10000,
    sizeBytes: partitionCount * 1024 * 1024,
    partitions,
    columns: globalColumns,
  }
}

/**
 * Create a basic analytics query
 */
function createQuery(overrides: Partial<AnalyticsQuery> = {}): AnalyticsQuery {
  return {
    select: overrides.select ?? ['*'],
    from: overrides.from ?? 'orders',
    filters: overrides.filters ?? [],
    groupBy: overrides.groupBy ?? [],
    aggregates: overrides.aggregates ?? {},
    orderBy: overrides.orderBy ?? [],
    limit: overrides.limit,
    offset: overrides.offset,
  }
}

// ============================================================================
// QueryPlanner Factory Tests
// ============================================================================

describe('createQueryPlanner() factory', () => {
  it('should create a QueryPlanner instance', () => {
    const planner = createQueryPlanner()
    expect(planner).toBeDefined()
    expect(typeof planner.plan).toBe('function')
    expect(typeof planner.estimateCost).toBe('function')
    expect(typeof planner.explain).toBe('function')
  })

  it('should accept optional configuration', () => {
    const planner = createQueryPlanner({
      enableBloomFilter: true,
      costModel: 'io-based',
    })
    expect(planner).toBeDefined()
  })
})

// ============================================================================
// Query Plan Generation Tests
// ============================================================================

describe('QueryPlanner.plan()', () => {
  let planner: QueryPlanner
  let stats: TableStats

  beforeEach(() => {
    planner = createQueryPlanner()
    stats = createTableStats(10)
  })

  describe('basic plan generation', () => {
    it('should generate a plan for a simple query', () => {
      const query = createQuery({
        select: ['id', 'amount'],
        from: 'orders',
      })

      const plan = planner.plan(query, stats)

      expect(plan).toBeDefined()
      expect(plan.operations).toBeInstanceOf(Array)
      expect(plan.operations.length).toBeGreaterThan(0)
      expect(plan.estimatedRows).toBeGreaterThan(0)
      expect(plan.estimatedCost).toBeGreaterThan(0)
    })

    it('should include a scan operation for table access', () => {
      const query = createQuery({ from: 'orders' })

      const plan = planner.plan(query, stats)

      const scanOp = plan.operations.find(op => op.type === 'scan')
      expect(scanOp).toBeDefined()
    })

    it('should include filter operation when filters are present', () => {
      const query = createQuery({
        filters: [eq('region', 'US')],
      })

      const plan = planner.plan(query, stats)

      const filterOp = plan.operations.find(op => op.type === 'filter')
      expect(filterOp).toBeDefined()
    })

    it('should include aggregate operation when aggregates are present', () => {
      const query = createQuery({
        groupBy: ['region'],
        aggregates: { total: { type: 'sum', column: 'amount' } },
      })

      const plan = planner.plan(query, stats)

      const aggOp = plan.operations.find(op => op.type === 'aggregate')
      expect(aggOp).toBeDefined()
    })

    it('should include sort operation when orderBy is present', () => {
      const query = createQuery({
        orderBy: [{ column: 'amount', direction: 'desc' }],
      })

      const plan = planner.plan(query, stats)

      const sortOp = plan.operations.find(op => op.type === 'sort')
      expect(sortOp).toBeDefined()
    })

    it('should include limit operation when limit is present', () => {
      const query = createQuery({
        limit: 10,
      })

      const plan = planner.plan(query, stats)

      const limitOp = plan.operations.find(op => op.type === 'limit')
      expect(limitOp).toBeDefined()
    })
  })

  describe('plan node structure', () => {
    it('should have proper node structure with inputs', () => {
      const query = createQuery({
        filters: [eq('region', 'US')],
        groupBy: ['region'],
        aggregates: { count: { type: 'count' } },
      })

      const plan = planner.plan(query, stats)

      // Plan should have hierarchical structure
      const lastOp = plan.operations[plan.operations.length - 1]
      expect(lastOp).toBeDefined()
      expect(lastOp!.cost).toBeDefined()
    })

    it('should include cost estimate on each node', () => {
      const query = createQuery({
        filters: [gt('amount', 500)],
      })

      const plan = planner.plan(query, stats)

      plan.operations.forEach(op => {
        expect(op.cost).toBeDefined()
        expect(op.cost!.cpuCost).toBeGreaterThanOrEqual(0)
        expect(op.cost!.ioCost).toBeGreaterThanOrEqual(0)
      })
    })

    it('should include stats on each node', () => {
      const query = createQuery({
        filters: [eq('region', 'US')],
      })

      const plan = planner.plan(query, stats)

      plan.operations.forEach(op => {
        expect(op.stats).toBeDefined()
        expect(op.stats!.estimatedRows).toBeGreaterThanOrEqual(0)
      })
    })
  })
})

// ============================================================================
// Partition Pruning Tests
// ============================================================================

describe('Partition Pruning', () => {
  let planner: QueryPlanner
  let stats: TableStats

  beforeEach(() => {
    planner = createQueryPlanner()
    stats = createTableStats(10)
  })

  describe('equality predicate pruning', () => {
    it('should prune partitions based on equality filter', () => {
      // Query for id starting with 'c' - should only hit partition 1 (b-c range)
      const query = createQuery({
        filters: [eq('id', 'ccc')],
      })

      const plan = planner.plan(query, stats)

      // Should prune most partitions
      expect(plan.partitionsPruned).toBeGreaterThan(0)
      // Should scan less than total rows
      expect(plan.estimatedRows).toBeLessThan(stats.rowCount)
    })

    it('should not prune when value might exist in multiple partitions', () => {
      // Query for region which exists across all partitions
      const query = createQuery({
        filters: [eq('region', 'US')],
      })

      const plan = planner.plan(query, stats)

      // Region exists in all partitions, no pruning possible by range
      // But should still estimate reduced rows based on selectivity
      expect(plan.estimatedRows).toBeLessThan(stats.rowCount)
    })
  })

  describe('range predicate pruning', () => {
    it('should prune partitions based on greater-than filter', () => {
      // Amount > 800 should only hit partition 8 and 9 (800-1000 range)
      const query = createQuery({
        filters: [gt('amount', 800)],
      })

      const plan = planner.plan(query, stats)

      expect(plan.partitionsPruned).toBeGreaterThan(5)
    })

    it('should prune partitions based on less-than filter', () => {
      // Amount < 200 should only hit partitions 0 and 1
      const query = createQuery({
        filters: [lt('amount', 200)],
      })

      const plan = planner.plan(query, stats)

      expect(plan.partitionsPruned).toBeGreaterThan(5)
    })

    it('should prune partitions based on between filter', () => {
      // Amount between 300 and 500 should hit partitions 3-5
      const query = createQuery({
        filters: [between('amount', 300, 500)],
      })

      const plan = planner.plan(query, stats)

      expect(plan.partitionsPruned).toBeGreaterThan(5)
    })

    it('should prune partitions based on gte/lte filters', () => {
      const query = createQuery({
        filters: [gte('amount', 700), lte('amount', 800)],
      })

      const plan = planner.plan(query, stats)

      // 700-800 range covers partitions 7-8 in 0-1000 range with 10 partitions
      // Should prune at least 7 of 10 partitions
      expect(plan.partitionsPruned).toBeGreaterThanOrEqual(7)
    })
  })

  describe('combined predicate pruning', () => {
    it('should prune based on multiple filters (AND logic)', () => {
      const query = createQuery({
        filters: [
          gt('amount', 500),
          eq('id', 'fff'),
        ],
      })

      const plan = planner.plan(query, stats)

      // Both filters should contribute to pruning
      expect(plan.partitionsPruned).toBeGreaterThan(7)
    })

    it('should handle filters on different columns', () => {
      const query = createQuery({
        filters: [
          gt('amount', 800),
          eq('region', 'US'),
        ],
      })

      const plan = planner.plan(query, stats)

      expect(plan.partitionsPruned).toBeGreaterThan(0)
    })
  })

  describe('in-list predicate handling', () => {
    it('should handle inList predicate for pruning', () => {
      const query = createQuery({
        filters: [inList('region', ['US', 'EU'])],
      })

      const plan = planner.plan(query, stats)

      // Should estimate based on cardinality
      expect(plan.estimatedRows).toBeLessThan(stats.rowCount)
    })
  })

  describe('pruning metrics', () => {
    it('should track number of partitions pruned', () => {
      const query = createQuery({
        filters: [gt('amount', 900)],
      })

      const plan = planner.plan(query, stats)

      expect(plan.partitionsPruned).toBeGreaterThanOrEqual(0)
      expect(plan.partitionsPruned).toBeLessThanOrEqual(10)
    })

    it('should report 0 partitions pruned when no pruning is possible', () => {
      const query = createQuery({
        select: ['*'],
        // No filters - can't prune
      })

      const plan = planner.plan(query, stats)

      expect(plan.partitionsPruned).toBe(0)
    })

    it('should achieve 90%+ pruning for selective queries', () => {
      // Very selective query on a column with good stats
      const query = createQuery({
        filters: [eq('id', 'aaa')], // Only in first partition
      })

      const plan = planner.plan(query, stats)

      // Should prune at least 90% of partitions (9 out of 10)
      expect(plan.partitionsPruned).toBeGreaterThanOrEqual(9)
    })
  })
})

// ============================================================================
// Column Pruning Tests
// ============================================================================

describe('Column Pruning (Projection Pushdown)', () => {
  let planner: QueryPlanner
  let stats: TableStats

  beforeEach(() => {
    planner = createQueryPlanner()
    stats = createTableStats(10)
  })

  it('should track columns pruned when selecting subset', () => {
    const query = createQuery({
      select: ['id', 'amount'],
    })

    const plan = planner.plan(query, stats)

    // Should prune columns not in select
    expect(plan.columnsPruned).toBeGreaterThan(0)
  })

  it('should not prune columns when selecting all', () => {
    const query = createQuery({
      select: ['*'],
    })

    const plan = planner.plan(query, stats)

    expect(plan.columnsPruned).toBe(0)
  })

  it('should include filter columns in projection', () => {
    const query = createQuery({
      select: ['id'],
      filters: [gt('amount', 500)],
    })

    const plan = planner.plan(query, stats)

    // amount is needed for filtering even though not in select
    const scanOp = plan.operations.find(op => op.type === 'scan')
    expect(scanOp?.columns).toContain('id')
    expect(scanOp?.columns).toContain('amount')
  })
})

// ============================================================================
// Cost Estimation Tests
// ============================================================================

describe('QueryPlanner.estimateCost()', () => {
  let planner: QueryPlanner
  let stats: TableStats

  beforeEach(() => {
    planner = createQueryPlanner()
    stats = createTableStats(10)
  })

  it('should estimate cost for a query plan', () => {
    const query = createQuery({
      filters: [gt('amount', 500)],
    })
    const plan = planner.plan(query, stats)

    const cost = planner.estimateCost(plan)

    expect(cost).toBeDefined()
    expect(cost.totalCost).toBeGreaterThan(0)
    expect(cost.cpuCost).toBeGreaterThanOrEqual(0)
    expect(cost.ioCost).toBeGreaterThanOrEqual(0)
    expect(cost.memoryCost).toBeGreaterThanOrEqual(0)
  })

  it('should estimate higher cost for larger scans', () => {
    const smallQuery = createQuery({
      filters: [eq('id', 'aaa')], // Very selective
    })
    const largeQuery = createQuery({
      select: ['*'], // Full scan
    })

    const smallPlan = planner.plan(smallQuery, stats)
    const largePlan = planner.plan(largeQuery, stats)

    const smallCost = planner.estimateCost(smallPlan)
    const largeCost = planner.estimateCost(largePlan)

    expect(largeCost.totalCost).toBeGreaterThan(smallCost.totalCost)
  })

  it('should factor in aggregation cost', () => {
    const queryWithoutAgg = createQuery({
      select: ['region', 'amount'],
    })
    const queryWithAgg = createQuery({
      groupBy: ['region'],
      aggregates: { total: { type: 'sum', column: 'amount' } },
    })

    const planWithoutAgg = planner.plan(queryWithoutAgg, stats)
    const planWithAgg = planner.plan(queryWithAgg, stats)

    const costWithoutAgg = planner.estimateCost(planWithoutAgg)
    const costWithAgg = planner.estimateCost(planWithAgg)

    // Aggregation adds CPU cost
    expect(costWithAgg.cpuCost).toBeGreaterThan(costWithoutAgg.cpuCost)
  })

  it('should factor in sort cost', () => {
    const queryWithoutSort = createQuery({
      select: ['amount'],
    })
    const queryWithSort = createQuery({
      select: ['amount'],
      orderBy: [{ column: 'amount', direction: 'desc' }],
    })

    const planWithoutSort = planner.plan(queryWithoutSort, stats)
    const planWithSort = planner.plan(queryWithSort, stats)

    const costWithoutSort = planner.estimateCost(planWithoutSort)
    const costWithSort = planner.estimateCost(planWithSort)

    expect(costWithSort.totalCost).toBeGreaterThan(costWithoutSort.totalCost)
  })

  it('should correlate cost with actual execution time characteristics', () => {
    // Cost should scale with data size
    const smallStats = createTableStats(2)
    const largeStats = createTableStats(20)

    const query = createQuery({ select: ['*'] })

    const smallPlan = planner.plan(query, smallStats)
    const largePlan = planner.plan(query, largeStats)

    const smallCost = planner.estimateCost(smallPlan)
    const largeCost = planner.estimateCost(largePlan)

    // 10x more data should result in higher cost
    expect(largeCost.totalCost).toBeGreaterThan(smallCost.totalCost * 5)
  })
})

// ============================================================================
// EXPLAIN Output Tests
// ============================================================================

describe('QueryPlanner.explain()', () => {
  let planner: QueryPlanner
  let stats: TableStats

  beforeEach(() => {
    planner = createQueryPlanner()
    stats = createTableStats(10)
  })

  describe('human-readable output', () => {
    it('should return a string explanation', () => {
      const query = createQuery({
        filters: [gt('amount', 500)],
        groupBy: ['region'],
        aggregates: { total: { type: 'sum', column: 'amount' } },
      })
      const plan = planner.plan(query, stats)

      const explanation = planner.explain(plan)

      expect(typeof explanation).toBe('string')
      expect(explanation.length).toBeGreaterThan(0)
    })

    it('should include operation types in explanation', () => {
      const query = createQuery({
        filters: [gt('amount', 500)],
        orderBy: [{ column: 'amount', direction: 'desc' }],
        limit: 10,
      })
      const plan = planner.plan(query, stats)

      const explanation = planner.explain(plan)

      expect(explanation).toContain('Scan')
      expect(explanation).toContain('Filter')
      expect(explanation).toContain('Sort')
      expect(explanation).toContain('Limit')
    })

    it('should include cost estimates in explanation', () => {
      const query = createQuery({
        filters: [eq('region', 'US')],
      })
      const plan = planner.plan(query, stats)

      const explanation = planner.explain(plan)

      expect(explanation).toMatch(/cost/i)
    })

    it('should include row estimates in explanation', () => {
      const query = createQuery({
        filters: [gt('amount', 800)],
      })
      const plan = planner.plan(query, stats)

      const explanation = planner.explain(plan)

      expect(explanation).toMatch(/rows?/i)
    })

    it('should include partition pruning info in explanation', () => {
      const query = createQuery({
        filters: [eq('id', 'aaa')],
      })
      const plan = planner.plan(query, stats)

      const explanation = planner.explain(plan)

      expect(explanation).toMatch(/partition/i)
    })
  })

  describe('EXPLAIN format options', () => {
    it('should support verbose format', () => {
      const query = createQuery({
        filters: [gt('amount', 500)],
      })
      const plan = planner.plan(query, stats)

      const explanation = planner.explain(plan, { format: 'verbose' })

      // Verbose should include more details
      expect(explanation.length).toBeGreaterThan(100)
    })

    it('should support tree format', () => {
      const query = createQuery({
        filters: [gt('amount', 500)],
        groupBy: ['region'],
        aggregates: { total: { type: 'sum', column: 'amount' } },
      })
      const plan = planner.plan(query, stats)

      const explanation = planner.explain(plan, { format: 'tree' })

      // Tree format should have indentation
      expect(explanation).toMatch(/^\s+/m)
    })

    it('should support JSON format', () => {
      const query = createQuery({
        filters: [gt('amount', 500)],
      })
      const plan = planner.plan(query, stats)

      const explanation = planner.explain(plan, { format: 'json' })

      // Should be valid JSON
      expect(() => JSON.parse(explanation)).not.toThrow()
    })
  })
})

// ============================================================================
// Bloom Filter Integration Tests
// ============================================================================

describe('Bloom Filter Integration', () => {
  let planner: QueryPlanner

  beforeEach(() => {
    planner = createQueryPlanner({ enableBloomFilter: true })
  })

  it('should use bloom filter for equality predicates when available', () => {
    // Create stats with bloom filter
    const statsWithBloom = createTableStats(10)
    statsWithBloom.partitions.forEach(partition => {
      partition.bloomFilter = {
        column: 'id',
        bitArray: new Uint8Array(1024),
        hashCount: 3,
        contains: (value: unknown) => value === 'known-id',
      }
    })

    const query = createQuery({
      filters: [eq('id', 'unknown-id')],
    })

    const plan = planner.plan(query, statsWithBloom)

    // Bloom filter should help prune partitions
    expect(plan.partitionsPruned).toBeGreaterThan(0)
  })

  it('should fall back to range-based pruning when bloom filter unavailable', () => {
    const stats = createTableStats(10) // No bloom filters

    const query = createQuery({
      filters: [eq('id', 'ccc')],
    })

    const plan = planner.plan(query, stats)

    // Should still prune using range-based approach
    expect(plan.partitionsPruned).toBeGreaterThan(0)
  })
})

// ============================================================================
// Predicate Pushdown Tests
// ============================================================================

describe('Predicate Pushdown', () => {
  let planner: QueryPlanner
  let stats: TableStats

  beforeEach(() => {
    planner = createQueryPlanner()
    stats = createTableStats(10)
  })

  it('should push filter predicates to scan level', () => {
    const query = createQuery({
      filters: [gt('amount', 500)],
    })

    const plan = planner.plan(query, stats)

    const scanOp = plan.operations.find(op => op.type === 'scan')
    // Scan should have pushed-down predicates
    expect(scanOp?.pushdownPredicates).toBeDefined()
    expect(scanOp?.pushdownPredicates?.length).toBeGreaterThan(0)
  })

  it('should identify predicates that cannot be pushed down', () => {
    const query = createQuery({
      filters: [
        gt('amount', 500), // Can push down
        // Complex expression would be here in a more complex query
      ],
      groupBy: ['region'],
      aggregates: { total: { type: 'sum', column: 'amount' } },
    })

    const plan = planner.plan(query, stats)

    // All simple predicates should be pushed down
    const filterOp = plan.operations.find(op => op.type === 'filter')
    const scanOp = plan.operations.find(op => op.type === 'scan')

    // Simple predicates go to scan, complex ones stay in filter
    expect(scanOp?.pushdownPredicates?.length).toBeGreaterThan(0)
  })
})

// ============================================================================
// Aggregation Pushdown Tests
// ============================================================================

describe('Aggregation Pushdown', () => {
  let planner: QueryPlanner
  let stats: TableStats

  beforeEach(() => {
    planner = createQueryPlanner()
    stats = createTableStats(10)
  })

  it('should push partial aggregates to scan level when possible', () => {
    const query = createQuery({
      groupBy: ['region'],
      aggregates: { total: { type: 'sum', column: 'amount' } },
    })

    const plan = planner.plan(query, stats)

    const scanOp = plan.operations.find(op => op.type === 'scan')
    // Scan should have partial aggregation hint
    expect(scanOp?.partialAggregates).toBeDefined()
  })

  it('should support count pushdown', () => {
    const query = createQuery({
      aggregates: { rowCount: { type: 'count' } },
    })

    const plan = planner.plan(query, stats)

    const scanOp = plan.operations.find(op => op.type === 'scan')
    expect(scanOp?.partialAggregates).toContainEqual(
      expect.objectContaining({ type: 'count' })
    )
  })

  it('should support min/max pushdown', () => {
    const query = createQuery({
      aggregates: {
        minAmount: { type: 'min', column: 'amount' },
        maxAmount: { type: 'max', column: 'amount' },
      },
    })

    const plan = planner.plan(query, stats)

    const scanOp = plan.operations.find(op => op.type === 'scan')
    expect(scanOp?.partialAggregates?.length).toBeGreaterThanOrEqual(2)
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('Query Planner Integration', () => {
  let planner: QueryPlanner

  beforeEach(() => {
    planner = createQueryPlanner()
  })

  it('should handle typical OLAP query pattern', () => {
    const stats = createTableStats(100) // Larger dataset

    const query = createQuery({
      select: ['region', 'total'],
      filters: [
        gte('amount', 1000),
        lte('amount', 5000),
      ],
      groupBy: ['region'],
      aggregates: {
        total: { type: 'sum', column: 'amount' },
        count: { type: 'count' },
      },
      orderBy: [{ column: 'total', direction: 'desc' }],
      limit: 10,
    })

    const plan = planner.plan(query, stats)

    // Should generate valid plan
    expect(plan.operations.length).toBeGreaterThanOrEqual(4) // scan, filter, agg, sort, limit

    // Should prune partitions significantly
    expect(plan.partitionsPruned).toBeGreaterThan(50) // >50% pruning

    // Should provide human-readable explanation
    const explanation = planner.explain(plan)
    expect(explanation).toContain('Scan')
    expect(explanation).toContain('Filter')
    expect(explanation).toContain('Aggregate')
    expect(explanation).toContain('Sort')
  })

  it('should optimize time-range query efficiently', () => {
    // Simulate time-partitioned data
    const timeStats: TableStats = {
      tableName: 'events',
      rowCount: 1000000,
      sizeBytes: 100 * 1024 * 1024,
      partitions: Array.from({ length: 30 }, (_, day) => ({
        partitionId: `day-${day}`,
        rowCount: 33333,
        sizeBytes: 3.3 * 1024 * 1024,
        columns: new Map([
          ['timestamp', createColumnStats({
            name: 'timestamp',
            type: 'number',
            minValue: day * 86400000,
            maxValue: (day + 1) * 86400000 - 1,
          })],
        ]),
        bloomFilter: null,
      })),
      columns: [
        createColumnStats({ name: 'timestamp', type: 'number' }),
        createColumnStats({ name: 'event_type', type: 'string' }),
      ],
    }

    // Query for last 3 days
    const query = createQuery({
      filters: [gte('timestamp', 27 * 86400000)],
    })

    const plan = planner.plan(query, timeStats)

    // Should prune 27 out of 30 partitions (90%)
    expect(plan.partitionsPruned).toBeGreaterThanOrEqual(27)
  })
})

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('Edge Cases', () => {
  let planner: QueryPlanner

  beforeEach(() => {
    planner = createQueryPlanner()
  })

  it('should handle empty table stats', () => {
    const emptyStats: TableStats = {
      tableName: 'empty',
      rowCount: 0,
      sizeBytes: 0,
      partitions: [],
      columns: [],
    }

    const query = createQuery({ from: 'empty' })
    const plan = planner.plan(query, emptyStats)

    expect(plan.estimatedRows).toBe(0)
    expect(plan.partitionsPruned).toBe(0)
  })

  it('should handle query with no filters', () => {
    const stats = createTableStats(10)
    const query = createQuery({
      select: ['*'],
    })

    const plan = planner.plan(query, stats)

    expect(plan.partitionsPruned).toBe(0)
    expect(plan.estimatedRows).toBe(stats.rowCount)
  })

  it('should handle partition stats with missing column info', () => {
    const stats = createTableStats(10)
    // Remove column stats from some partitions
    stats.partitions[0]!.columns = new Map()

    const query = createQuery({
      filters: [eq('id', 'aaa')],
    })

    const plan = planner.plan(query, stats)

    // Should still work, but not prune partition without stats
    expect(plan).toBeDefined()
  })

  it('should handle very large number of partitions', () => {
    const largeStats = createTableStats(1000)

    const query = createQuery({
      filters: [eq('id', 'aaa')],
    })

    const startTime = performance.now()
    const plan = planner.plan(query, largeStats)
    const elapsed = performance.now() - startTime

    // Should complete quickly (< 100ms)
    expect(elapsed).toBeLessThan(100)
    expect(plan.partitionsPruned).toBeGreaterThan(900)
  })
})
