/**
 * MaterializedTable Tests
 *
 * TDD tests for an incremental aggregate storage primitive inspired by
 * ClickHouse MaterializedViews.
 *
 * Key features tested:
 * - Define materialized tables with groupBy and aggregates
 * - Incremental updates as new data arrives
 * - Partial aggregates that can be merged (distributed computing)
 * - Query the materialized data with optional filters
 * - Multiple aggregate functions: sum, count, avg, min, max
 * - Multi-dimensional grouping (groupBy multiple fields)
 * - Refresh modes: immediate and batch
 *
 * @see https://clickhouse.com/docs/en/engines/table-engines/special/materializedview
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createMaterializedTable,
  type MaterializedTable,
  type MaterializedTableConfig,
  type AggregateSpec,
  type PartialAggregate,
  type RefreshMode,
} from './index'

// ============================================================================
// Test Fixtures
// ============================================================================

interface SalesEvent {
  product: string
  category: string
  region: string
  amount: number
  quantity: number
  timestamp: number
}

interface PageView {
  page: string
  userId: string
  duration: number
  timestamp: number
}

const sampleSalesEvents: SalesEvent[] = [
  { product: 'Widget A', category: 'Electronics', region: 'North', amount: 100, quantity: 2, timestamp: 1000 },
  { product: 'Widget B', category: 'Electronics', region: 'South', amount: 200, quantity: 1, timestamp: 1001 },
  { product: 'Gadget A', category: 'Electronics', region: 'North', amount: 150, quantity: 3, timestamp: 1002 },
  { product: 'Widget A', category: 'Electronics', region: 'North', amount: 100, quantity: 1, timestamp: 1003 },
  { product: 'Book X', category: 'Books', region: 'North', amount: 30, quantity: 5, timestamp: 1004 },
  { product: 'Book Y', category: 'Books', region: 'South', amount: 25, quantity: 2, timestamp: 1005 },
]

const moresSalesEvents: SalesEvent[] = [
  { product: 'Widget A', category: 'Electronics', region: 'North', amount: 100, quantity: 2, timestamp: 2000 },
  { product: 'Book X', category: 'Books', region: 'South', amount: 30, quantity: 1, timestamp: 2001 },
]

// ============================================================================
// Basic Configuration Tests
// ============================================================================

describe('MaterializedTable Configuration', () => {
  it('should create a materialized table with valid config', () => {
    const config: MaterializedTableConfig<SalesEvent> = {
      groupBy: ['category'],
      aggregates: {
        totalAmount: { fn: 'sum', field: 'amount' },
        count: { fn: 'count' },
      },
    }

    const table = createMaterializedTable(config)

    expect(table).toBeDefined()
    expect(table.getConfig().groupBy).toEqual(config.groupBy)
    expect(table.getConfig().aggregates).toEqual(config.aggregates)
  })

  it('should create a table with multiple groupBy fields', () => {
    const config: MaterializedTableConfig<SalesEvent> = {
      groupBy: ['category', 'region'],
      aggregates: {
        totalAmount: { fn: 'sum', field: 'amount' },
      },
    }

    const table = createMaterializedTable(config)
    expect(table.getConfig().groupBy).toEqual(['category', 'region'])
  })

  it('should support all aggregate functions', () => {
    const config: MaterializedTableConfig<SalesEvent> = {
      groupBy: ['category'],
      aggregates: {
        totalAmount: { fn: 'sum', field: 'amount' },
        orderCount: { fn: 'count' },
        avgAmount: { fn: 'avg', field: 'amount' },
        minAmount: { fn: 'min', field: 'amount' },
        maxAmount: { fn: 'max', field: 'amount' },
      },
    }

    const table = createMaterializedTable(config)
    expect(Object.keys(table.getConfig().aggregates)).toHaveLength(5)
  })

  it('should support empty groupBy (global aggregation)', () => {
    const config: MaterializedTableConfig<SalesEvent> = {
      groupBy: [],
      aggregates: {
        totalAmount: { fn: 'sum', field: 'amount' },
        count: { fn: 'count' },
      },
    }

    const table = createMaterializedTable(config)
    expect(table.getConfig().groupBy).toEqual([])
  })

  it('should support immediate refresh mode by default', () => {
    const config: MaterializedTableConfig<SalesEvent> = {
      groupBy: ['category'],
      aggregates: {
        totalAmount: { fn: 'sum', field: 'amount' },
      },
    }

    const table = createMaterializedTable(config)
    expect(table.getRefreshMode()).toBe('immediate')
  })

  it('should support batch refresh mode', () => {
    const config: MaterializedTableConfig<SalesEvent> = {
      groupBy: ['category'],
      aggregates: {
        totalAmount: { fn: 'sum', field: 'amount' },
      },
      refreshMode: 'batch',
    }

    const table = createMaterializedTable(config)
    expect(table.getRefreshMode()).toBe('batch')
  })
})

// ============================================================================
// Incremental Ingest Tests
// ============================================================================

describe('MaterializedTable Ingest', () => {
  let table: MaterializedTable<SalesEvent>

  beforeEach(() => {
    table = createMaterializedTable({
      groupBy: ['category'],
      aggregates: {
        totalAmount: { fn: 'sum', field: 'amount' },
        count: { fn: 'count' },
      },
    })
  })

  it('should ingest single row', () => {
    table.ingest([sampleSalesEvents[0]!])

    const results = table.query()
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      category: 'Electronics',
      totalAmount: 100,
      count: 1,
    })
  })

  it('should incrementally update on multiple ingests', () => {
    table.ingest([sampleSalesEvents[0]!])
    table.ingest([sampleSalesEvents[1]!])

    const results = table.query()
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      category: 'Electronics',
      totalAmount: 300,
      count: 2,
    })
  })

  it('should handle batch ingest', () => {
    table.ingest(sampleSalesEvents)

    const results = table.query()
    expect(results).toHaveLength(2) // Electronics and Books

    const electronics = results.find(r => r.category === 'Electronics')
    const books = results.find(r => r.category === 'Books')

    expect(electronics).toMatchObject({
      category: 'Electronics',
      totalAmount: 550, // 100 + 200 + 150 + 100
      count: 4,
    })

    expect(books).toMatchObject({
      category: 'Books',
      totalAmount: 55, // 30 + 25
      count: 2,
    })
  })

  it('should handle empty ingest', () => {
    table.ingest([])
    const results = table.query()
    expect(results).toHaveLength(0)
  })

  it('should return ingest stats', () => {
    const stats = table.ingest(sampleSalesEvents)

    expect(stats).toMatchObject({
      rowsProcessed: 6,
      groupsCreated: 2,
      groupsUpdated: 6, // All 6 rows update their respective groups
    })
  })
})

// ============================================================================
// Multi-dimensional Grouping Tests
// ============================================================================

describe('MaterializedTable Multi-dimensional Grouping', () => {
  let table: MaterializedTable<SalesEvent>

  beforeEach(() => {
    table = createMaterializedTable({
      groupBy: ['category', 'region'],
      aggregates: {
        totalAmount: { fn: 'sum', field: 'amount' },
        count: { fn: 'count' },
      },
    })
  })

  it('should group by multiple dimensions', () => {
    table.ingest(sampleSalesEvents)

    const results = table.query()
    expect(results).toHaveLength(4) // Electronics-North, Electronics-South, Books-North, Books-South

    const electronicsNorth = results.find(r => r.category === 'Electronics' && r.region === 'North')
    expect(electronicsNorth).toMatchObject({
      category: 'Electronics',
      region: 'North',
      totalAmount: 350, // 100 + 150 + 100
      count: 3,
    })
  })

  it('should correctly aggregate per dimension combination', () => {
    table.ingest(sampleSalesEvents)

    const results = table.query()

    const electronicsSouth = results.find(r => r.category === 'Electronics' && r.region === 'South')
    expect(electronicsSouth).toMatchObject({
      totalAmount: 200,
      count: 1,
    })

    const booksNorth = results.find(r => r.category === 'Books' && r.region === 'North')
    expect(booksNorth).toMatchObject({
      totalAmount: 30,
      count: 1,
    })
  })
})

// ============================================================================
// Global Aggregation Tests
// ============================================================================

describe('MaterializedTable Global Aggregation', () => {
  let table: MaterializedTable<SalesEvent>

  beforeEach(() => {
    table = createMaterializedTable({
      groupBy: [],
      aggregates: {
        totalAmount: { fn: 'sum', field: 'amount' },
        totalQuantity: { fn: 'sum', field: 'quantity' },
        count: { fn: 'count' },
        avgAmount: { fn: 'avg', field: 'amount' },
      },
    })
  })

  it('should compute global aggregates with empty groupBy', () => {
    table.ingest(sampleSalesEvents)

    const results = table.query()
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      totalAmount: 605, // 100 + 200 + 150 + 100 + 30 + 25
      totalQuantity: 14, // 2 + 1 + 3 + 1 + 5 + 2
      count: 6,
    })
  })

  it('should compute correct average', () => {
    table.ingest(sampleSalesEvents)

    const results = table.query()
    const expectedAvg = 605 / 6 // ~100.83
    expect(results[0]!.avgAmount).toBeCloseTo(expectedAvg, 2)
  })
})

// ============================================================================
// All Aggregate Functions Tests
// ============================================================================

describe('MaterializedTable Aggregate Functions', () => {
  it('should compute sum correctly', () => {
    const table = createMaterializedTable<SalesEvent>({
      groupBy: ['category'],
      aggregates: {
        total: { fn: 'sum', field: 'amount' },
      },
    })

    table.ingest(sampleSalesEvents)
    const results = table.query()
    const electronics = results.find(r => r.category === 'Electronics')
    expect(electronics?.total).toBe(550)
  })

  it('should compute count correctly', () => {
    const table = createMaterializedTable<SalesEvent>({
      groupBy: ['category'],
      aggregates: {
        count: { fn: 'count' },
      },
    })

    table.ingest(sampleSalesEvents)
    const results = table.query()
    const electronics = results.find(r => r.category === 'Electronics')
    expect(electronics?.count).toBe(4)
  })

  it('should compute avg correctly', () => {
    const table = createMaterializedTable<SalesEvent>({
      groupBy: ['category'],
      aggregates: {
        avgAmount: { fn: 'avg', field: 'amount' },
      },
    })

    table.ingest(sampleSalesEvents)
    const results = table.query()
    const electronics = results.find(r => r.category === 'Electronics')
    expect(electronics?.avgAmount).toBeCloseTo(137.5, 2) // 550 / 4
  })

  it('should compute min correctly', () => {
    const table = createMaterializedTable<SalesEvent>({
      groupBy: ['category'],
      aggregates: {
        minAmount: { fn: 'min', field: 'amount' },
      },
    })

    table.ingest(sampleSalesEvents)
    const results = table.query()
    const electronics = results.find(r => r.category === 'Electronics')
    expect(electronics?.minAmount).toBe(100)
  })

  it('should compute max correctly', () => {
    const table = createMaterializedTable<SalesEvent>({
      groupBy: ['category'],
      aggregates: {
        maxAmount: { fn: 'max', field: 'amount' },
      },
    })

    table.ingest(sampleSalesEvents)
    const results = table.query()
    const electronics = results.find(r => r.category === 'Electronics')
    expect(electronics?.maxAmount).toBe(200)
  })

  it('should handle multiple aggregates on same field', () => {
    const table = createMaterializedTable<SalesEvent>({
      groupBy: ['category'],
      aggregates: {
        sum: { fn: 'sum', field: 'amount' },
        min: { fn: 'min', field: 'amount' },
        max: { fn: 'max', field: 'amount' },
        avg: { fn: 'avg', field: 'amount' },
      },
    })

    table.ingest(sampleSalesEvents)
    const results = table.query()
    const books = results.find(r => r.category === 'Books')

    expect(books).toMatchObject({
      sum: 55,
      min: 25,
      max: 30,
    })
    expect(books?.avg).toBeCloseTo(27.5, 2)
  })
})

// ============================================================================
// Query with Filter Tests
// ============================================================================

describe('MaterializedTable Query with Filters', () => {
  let table: MaterializedTable<SalesEvent>

  beforeEach(() => {
    table = createMaterializedTable({
      groupBy: ['category', 'region'],
      aggregates: {
        totalAmount: { fn: 'sum', field: 'amount' },
        count: { fn: 'count' },
      },
    })
    table.ingest(sampleSalesEvents)
  })

  it('should filter by single dimension', () => {
    const results = table.query({ category: 'Electronics' })
    expect(results).toHaveLength(2) // North and South
    expect(results.every(r => r.category === 'Electronics')).toBe(true)
  })

  it('should filter by multiple dimensions', () => {
    const results = table.query({ category: 'Electronics', region: 'North' })
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      category: 'Electronics',
      region: 'North',
      totalAmount: 350,
    })
  })

  it('should return empty array for non-matching filter', () => {
    const results = table.query({ category: 'NonExistent' })
    expect(results).toHaveLength(0)
  })

  it('should return all results with empty filter', () => {
    const results = table.query({})
    expect(results).toHaveLength(4)
  })
})

// ============================================================================
// Partial Aggregates and Merge Tests
// ============================================================================

describe('MaterializedTable Partial Aggregates and Merge', () => {
  it('should export partial aggregates', () => {
    const table = createMaterializedTable<SalesEvent>({
      groupBy: ['category'],
      aggregates: {
        totalAmount: { fn: 'sum', field: 'amount' },
        count: { fn: 'count' },
      },
    })

    table.ingest(sampleSalesEvents.slice(0, 3))
    const partial = table.getPartialAggregates()

    expect(partial).toBeDefined()
    expect(partial.length).toBeGreaterThan(0)
    // Each partial should have the state needed to merge
    expect(partial[0]).toHaveProperty('key')
    expect(partial[0]).toHaveProperty('state')
  })

  it('should merge partial aggregates from another table', () => {
    const table1 = createMaterializedTable<SalesEvent>({
      groupBy: ['category'],
      aggregates: {
        totalAmount: { fn: 'sum', field: 'amount' },
        count: { fn: 'count' },
      },
    })

    const table2 = createMaterializedTable<SalesEvent>({
      groupBy: ['category'],
      aggregates: {
        totalAmount: { fn: 'sum', field: 'amount' },
        count: { fn: 'count' },
      },
    })

    // Shard data between tables
    table1.ingest(sampleSalesEvents.slice(0, 3)) // First 3 events (all Electronics)
    table2.ingest(sampleSalesEvents.slice(3)) // Last 3 events (1 Electronics + 2 Books)

    // Merge table2's partials into table1
    const partials = table2.getPartialAggregates()
    table1.merge(partials)

    const results = table1.query()
    expect(results).toHaveLength(2)

    const electronics = results.find(r => r.category === 'Electronics')
    expect(electronics).toMatchObject({
      totalAmount: 550, // Full sum
      count: 4,
    })
  })

  it('should correctly merge avg aggregates', () => {
    const table1 = createMaterializedTable<SalesEvent>({
      groupBy: ['category'],
      aggregates: {
        avgAmount: { fn: 'avg', field: 'amount' },
        count: { fn: 'count' },
      },
    })

    const table2 = createMaterializedTable<SalesEvent>({
      groupBy: ['category'],
      aggregates: {
        avgAmount: { fn: 'avg', field: 'amount' },
        count: { fn: 'count' },
      },
    })

    table1.ingest(sampleSalesEvents.slice(0, 3))
    table2.ingest(sampleSalesEvents.slice(3))

    const partials = table2.getPartialAggregates()
    table1.merge(partials)

    const results = table1.query()
    const electronics = results.find(r => r.category === 'Electronics')
    expect(electronics?.avgAmount).toBeCloseTo(137.5, 2) // 550 / 4
  })

  it('should correctly merge min/max aggregates', () => {
    const table1 = createMaterializedTable<SalesEvent>({
      groupBy: ['category'],
      aggregates: {
        minAmount: { fn: 'min', field: 'amount' },
        maxAmount: { fn: 'max', field: 'amount' },
      },
    })

    const table2 = createMaterializedTable<SalesEvent>({
      groupBy: ['category'],
      aggregates: {
        minAmount: { fn: 'min', field: 'amount' },
        maxAmount: { fn: 'max', field: 'amount' },
      },
    })

    // table1: Electronics with amounts 100, 200
    table1.ingest([sampleSalesEvents[0]!, sampleSalesEvents[1]!])
    // table2: Electronics with amounts 150, 100
    table2.ingest([sampleSalesEvents[2]!, sampleSalesEvents[3]!])

    const partials = table2.getPartialAggregates()
    table1.merge(partials)

    const results = table1.query()
    const electronics = results.find(r => r.category === 'Electronics')
    expect(electronics?.minAmount).toBe(100)
    expect(electronics?.maxAmount).toBe(200)
  })

  it('should handle merging new groups', () => {
    const table1 = createMaterializedTable<SalesEvent>({
      groupBy: ['category'],
      aggregates: {
        totalAmount: { fn: 'sum', field: 'amount' },
      },
    })

    const table2 = createMaterializedTable<SalesEvent>({
      groupBy: ['category'],
      aggregates: {
        totalAmount: { fn: 'sum', field: 'amount' },
      },
    })

    // table1 only has Electronics
    table1.ingest(sampleSalesEvents.filter(e => e.category === 'Electronics'))
    // table2 only has Books
    table2.ingest(sampleSalesEvents.filter(e => e.category === 'Books'))

    const partials = table2.getPartialAggregates()
    table1.merge(partials)

    const results = table1.query()
    expect(results).toHaveLength(2)
    expect(results.find(r => r.category === 'Books')).toBeDefined()
  })
})

// ============================================================================
// Batch Refresh Mode Tests
// ============================================================================

describe('MaterializedTable Batch Refresh Mode', () => {
  let table: MaterializedTable<SalesEvent>

  beforeEach(() => {
    table = createMaterializedTable({
      groupBy: ['category'],
      aggregates: {
        totalAmount: { fn: 'sum', field: 'amount' },
        count: { fn: 'count' },
      },
      refreshMode: 'batch',
    })
  })

  it('should buffer ingested rows in batch mode', () => {
    table.ingest(sampleSalesEvents)

    // Query should return empty until refresh
    const results = table.query()
    expect(results).toHaveLength(0)
  })

  it('should apply buffered rows on refresh', () => {
    table.ingest(sampleSalesEvents)
    table.refresh()

    const results = table.query()
    expect(results).toHaveLength(2)
  })

  it('should accumulate multiple batches before refresh', () => {
    table.ingest(sampleSalesEvents.slice(0, 3))
    table.ingest(sampleSalesEvents.slice(3))
    table.refresh()

    const results = table.query()
    expect(results).toHaveLength(2)

    const electronics = results.find(r => r.category === 'Electronics')
    expect(electronics?.totalAmount).toBe(550)
  })

  it('should return buffered row count', () => {
    table.ingest(sampleSalesEvents.slice(0, 3))
    expect(table.getBufferedRowCount()).toBe(3)

    table.ingest(sampleSalesEvents.slice(3))
    expect(table.getBufferedRowCount()).toBe(6)

    table.refresh()
    expect(table.getBufferedRowCount()).toBe(0)
  })
})

// ============================================================================
// Statistics and Metadata Tests
// ============================================================================

describe('MaterializedTable Statistics', () => {
  let table: MaterializedTable<SalesEvent>

  beforeEach(() => {
    table = createMaterializedTable({
      groupBy: ['category'],
      aggregates: {
        totalAmount: { fn: 'sum', field: 'amount' },
        count: { fn: 'count' },
      },
    })
  })

  it('should track total rows ingested', () => {
    table.ingest(sampleSalesEvents)
    const stats = table.getStats()

    expect(stats.totalRowsIngested).toBe(6)
  })

  it('should track group count', () => {
    table.ingest(sampleSalesEvents)
    const stats = table.getStats()

    expect(stats.groupCount).toBe(2)
  })

  it('should track last updated timestamp', () => {
    const before = Date.now()
    table.ingest(sampleSalesEvents)
    const after = Date.now()
    const stats = table.getStats()

    expect(stats.lastUpdated).toBeGreaterThanOrEqual(before)
    expect(stats.lastUpdated).toBeLessThanOrEqual(after)
  })

  it('should provide memory usage estimate', () => {
    table.ingest(sampleSalesEvents)
    const stats = table.getStats()

    expect(stats.estimatedMemoryBytes).toBeGreaterThan(0)
  })
})

// ============================================================================
// Clear and Reset Tests
// ============================================================================

describe('MaterializedTable Clear and Reset', () => {
  let table: MaterializedTable<SalesEvent>

  beforeEach(() => {
    table = createMaterializedTable({
      groupBy: ['category'],
      aggregates: {
        totalAmount: { fn: 'sum', field: 'amount' },
        count: { fn: 'count' },
      },
    })
    table.ingest(sampleSalesEvents)
  })

  it('should clear all aggregates', () => {
    table.clear()

    const results = table.query()
    expect(results).toHaveLength(0)
  })

  it('should reset statistics on clear', () => {
    table.clear()
    const stats = table.getStats()

    expect(stats.totalRowsIngested).toBe(0)
    expect(stats.groupCount).toBe(0)
  })

  it('should allow ingesting after clear', () => {
    table.clear()
    table.ingest(sampleSalesEvents.slice(0, 2))

    const results = table.query()
    expect(results).toHaveLength(1) // Only Electronics from first 2 events
  })
})

// ============================================================================
// Edge Cases Tests
// ============================================================================

describe('MaterializedTable Edge Cases', () => {
  it('should handle null/undefined field values', () => {
    const table = createMaterializedTable<{ category: string | null; amount: number }>({
      groupBy: ['category'],
      aggregates: {
        total: { fn: 'sum', field: 'amount' },
      },
    })

    table.ingest([
      { category: 'A', amount: 100 },
      { category: null, amount: 50 },
      { category: 'A', amount: 200 },
    ])

    const results = table.query()
    expect(results).toHaveLength(2)

    const nullGroup = results.find(r => r.category === null)
    expect(nullGroup?.total).toBe(50)
  })

  it('should handle numeric groupBy fields', () => {
    const table = createMaterializedTable<{ year: number; amount: number }>({
      groupBy: ['year'],
      aggregates: {
        total: { fn: 'sum', field: 'amount' },
      },
    })

    table.ingest([
      { year: 2023, amount: 100 },
      { year: 2024, amount: 200 },
      { year: 2023, amount: 150 },
    ])

    const results = table.query()
    expect(results).toHaveLength(2)

    const year2023 = results.find(r => r.year === 2023)
    expect(year2023?.total).toBe(250)
  })

  it('should handle very large numbers', () => {
    const table = createMaterializedTable<{ id: string; value: number }>({
      groupBy: ['id'],
      aggregates: {
        total: { fn: 'sum', field: 'value' },
      },
    })

    const largeValue = Number.MAX_SAFE_INTEGER / 2
    table.ingest([
      { id: 'a', value: largeValue },
      { id: 'a', value: largeValue },
    ])

    const results = table.query()
    expect(results[0]?.total).toBe(largeValue * 2)
  })

  it('should handle negative numbers', () => {
    const table = createMaterializedTable<{ type: string; delta: number }>({
      groupBy: ['type'],
      aggregates: {
        total: { fn: 'sum', field: 'delta' },
        min: { fn: 'min', field: 'delta' },
        max: { fn: 'max', field: 'delta' },
      },
    })

    table.ingest([
      { type: 'balance', delta: 100 },
      { type: 'balance', delta: -50 },
      { type: 'balance', delta: -30 },
    ])

    const results = table.query()
    expect(results[0]).toMatchObject({
      total: 20,
      min: -50,
      max: 100,
    })
  })

  it('should handle decimal precision', () => {
    const table = createMaterializedTable<{ id: string; price: number }>({
      groupBy: ['id'],
      aggregates: {
        total: { fn: 'sum', field: 'price' },
        avg: { fn: 'avg', field: 'price' },
      },
    })

    table.ingest([
      { id: 'item', price: 10.99 },
      { id: 'item', price: 20.01 },
      { id: 'item', price: 30.00 },
    ])

    const results = table.query()
    expect(results[0]?.total).toBeCloseTo(61.0, 2)
    expect(results[0]?.avg).toBeCloseTo(20.333, 2)
  })
})
