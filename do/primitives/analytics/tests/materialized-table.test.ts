/**
 * MaterializedTable Primitive Tests - TDD RED Phase
 *
 * Tests for a primitive that stores pre-computed aggregates and supports
 * incremental refresh, similar to ClickHouse materialized views.
 *
 * Key features tested:
 * - Define groupBy + aggregates materialization
 * - Incremental updates from new rows
 * - Merge operations for distributed aggregates
 * - Window-based materializations
 * - Aggregate state storage and retrieval
 *
 * @see dotdo-xi4kc
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  MaterializedTable,
  createMaterializedTable,
  type AggregateDefinition,
  type MaterializationConfig,
  type MaterializationStats,
  type PartialAggregate,
  // Aggregate helpers
  sum,
  count,
  avg,
  min,
  max,
  countDistinct,
  // Window helpers
  tumbling,
  sliding,
} from '../materialized-table'

// ============================================================================
// Test Fixtures
// ============================================================================

interface SalesEvent {
  timestamp: number
  region: string
  product: string
  category: string
  amount: number
  quantity: number
  customerId: string
}

interface MetricEvent {
  timestamp: number
  host: string
  metric: string
  value: number
}

const BASE_TIME = 1704067200000 // 2024-01-01 00:00:00 UTC

function ts(offsetMs: number): number {
  return BASE_TIME + offsetMs
}

function createSalesEvent(
  region: string,
  product: string,
  amount: number,
  quantity: number,
  timestampOffset: number = 0
): SalesEvent {
  return {
    timestamp: ts(timestampOffset),
    region,
    product,
    category: 'Electronics',
    amount,
    quantity,
    customerId: `customer-${Math.random().toString(36).slice(2, 8)}`,
  }
}

// ============================================================================
// MaterializedTable Creation Tests
// ============================================================================

describe('MaterializedTable Creation', () => {
  describe('createMaterializedTable() factory', () => {
    it('should create a MaterializedTable instance', () => {
      const table = createMaterializedTable<SalesEvent>()
      expect(table).toBeDefined()
      expect(typeof table.define).toBe('function')
      expect(typeof table.ingest).toBe('function')
      expect(typeof table.query).toBe('function')
      expect(typeof table.merge).toBe('function')
    })

    it('should create an empty table with no materialization defined', () => {
      const table = createMaterializedTable<SalesEvent>()
      const stats = table.getStats()

      expect(stats.rowCount).toBe(0)
      expect(stats.groupCount).toBe(0)
      expect(stats.lastRefreshTime).toBeUndefined()
    })
  })
})

// ============================================================================
// Define Materialization Tests
// ============================================================================

describe('MaterializedTable.define()', () => {
  let table: MaterializedTable<SalesEvent>

  beforeEach(() => {
    table = createMaterializedTable<SalesEvent>()
  })

  describe('Basic configuration', () => {
    it('should accept groupBy as an array of field names', () => {
      table.define({
        groupBy: ['region', 'product'],
        aggregates: [
          { name: 'totalAmount', fn: sum('amount') },
        ],
        refresh: 'on-insert',
      })

      // Should not throw and be queryable
      const result = table.query()
      expect(result).toEqual([])
    })

    it('should accept single groupBy field', () => {
      table.define({
        groupBy: ['region'],
        aggregates: [
          { name: 'count', fn: count() },
        ],
        refresh: 'on-insert',
      })

      const result = table.query()
      expect(result).toEqual([])
    })

    it('should accept empty groupBy for global aggregates', () => {
      table.define({
        groupBy: [],
        aggregates: [
          { name: 'totalAmount', fn: sum('amount') },
          { name: 'rowCount', fn: count() },
        ],
        refresh: 'on-insert',
      })

      // Should create a single global aggregate group
      table.ingest([
        createSalesEvent('US', 'Laptop', 1299, 1),
        createSalesEvent('EU', 'Phone', 599, 2),
      ])

      const result = table.query()
      expect(result).toHaveLength(1)
      expect(result[0].totalAmount).toBe(1898)
      expect(result[0].rowCount).toBe(2)
    })

    it('should throw if define() is called twice', () => {
      table.define({
        groupBy: ['region'],
        aggregates: [{ name: 'count', fn: count() }],
        refresh: 'on-insert',
      })

      expect(() => {
        table.define({
          groupBy: ['product'],
          aggregates: [{ name: 'count', fn: count() }],
          refresh: 'on-insert',
        })
      }).toThrow(/already defined/i)
    })
  })

  describe('Aggregate definitions', () => {
    it('should accept sum aggregate', () => {
      table.define({
        groupBy: ['region'],
        aggregates: [
          { name: 'totalAmount', fn: sum('amount') },
        ],
        refresh: 'on-insert',
      })

      table.ingest([
        createSalesEvent('US', 'Laptop', 1000, 1),
        createSalesEvent('US', 'Phone', 500, 2),
      ])

      const result = table.query()
      expect(result[0].totalAmount).toBe(1500)
    })

    it('should accept count aggregate', () => {
      table.define({
        groupBy: ['region'],
        aggregates: [
          { name: 'orderCount', fn: count() },
        ],
        refresh: 'on-insert',
      })

      table.ingest([
        createSalesEvent('US', 'Laptop', 1000, 1),
        createSalesEvent('US', 'Phone', 500, 2),
        createSalesEvent('EU', 'Laptop', 1200, 1),
      ])

      const result = table.query()
      const usRow = result.find((r) => r.region === 'US')
      expect(usRow?.orderCount).toBe(2)
    })

    it('should accept avg aggregate', () => {
      table.define({
        groupBy: ['region'],
        aggregates: [
          { name: 'avgAmount', fn: avg('amount') },
        ],
        refresh: 'on-insert',
      })

      table.ingest([
        createSalesEvent('US', 'Laptop', 1000, 1),
        createSalesEvent('US', 'Phone', 500, 2),
      ])

      const result = table.query()
      expect(result[0].avgAmount).toBe(750)
    })

    it('should accept min aggregate', () => {
      table.define({
        groupBy: ['region'],
        aggregates: [
          { name: 'minAmount', fn: min('amount') },
        ],
        refresh: 'on-insert',
      })

      table.ingest([
        createSalesEvent('US', 'Laptop', 1000, 1),
        createSalesEvent('US', 'Phone', 500, 2),
      ])

      const result = table.query()
      expect(result[0].minAmount).toBe(500)
    })

    it('should accept max aggregate', () => {
      table.define({
        groupBy: ['region'],
        aggregates: [
          { name: 'maxAmount', fn: max('amount') },
        ],
        refresh: 'on-insert',
      })

      table.ingest([
        createSalesEvent('US', 'Laptop', 1000, 1),
        createSalesEvent('US', 'Phone', 500, 2),
      ])

      const result = table.query()
      expect(result[0].maxAmount).toBe(1000)
    })

    it('should accept countDistinct aggregate', () => {
      table.define({
        groupBy: ['region'],
        aggregates: [
          { name: 'uniqueProducts', fn: countDistinct('product') },
        ],
        refresh: 'on-insert',
      })

      table.ingest([
        createSalesEvent('US', 'Laptop', 1000, 1),
        createSalesEvent('US', 'Phone', 500, 2),
        createSalesEvent('US', 'Laptop', 1200, 1), // Duplicate product
      ])

      const result = table.query()
      expect(result[0].uniqueProducts).toBe(2)
    })

    it('should accept multiple aggregates', () => {
      table.define({
        groupBy: ['region'],
        aggregates: [
          { name: 'totalAmount', fn: sum('amount') },
          { name: 'avgAmount', fn: avg('amount') },
          { name: 'orderCount', fn: count() },
          { name: 'minAmount', fn: min('amount') },
          { name: 'maxAmount', fn: max('amount') },
        ],
        refresh: 'on-insert',
      })

      table.ingest([
        createSalesEvent('US', 'Laptop', 1000, 1),
        createSalesEvent('US', 'Phone', 500, 2),
      ])

      const result = table.query()
      expect(result[0].totalAmount).toBe(1500)
      expect(result[0].avgAmount).toBe(750)
      expect(result[0].orderCount).toBe(2)
      expect(result[0].minAmount).toBe(500)
      expect(result[0].maxAmount).toBe(1000)
    })
  })

  describe('Refresh modes', () => {
    it('should accept "on-insert" refresh mode', () => {
      table.define({
        groupBy: ['region'],
        aggregates: [{ name: 'count', fn: count() }],
        refresh: 'on-insert',
      })

      // Aggregates should update immediately on ingest
      table.ingest([createSalesEvent('US', 'Laptop', 1000, 1)])
      expect(table.query()[0].count).toBe(1)

      table.ingest([createSalesEvent('US', 'Phone', 500, 1)])
      expect(table.query()[0].count).toBe(2)
    })

    it('should accept "manual" refresh mode', () => {
      table.define({
        groupBy: ['region'],
        aggregates: [{ name: 'count', fn: count() }],
        refresh: 'manual',
      })

      // Aggregates should not update until refresh() is called
      table.ingest([createSalesEvent('US', 'Laptop', 1000, 1)])
      expect(table.query()).toHaveLength(0) // No results yet

      table.refresh()
      expect(table.query()[0].count).toBe(1)
    })

    it('should accept "periodic" refresh mode with interval', () => {
      table.define({
        groupBy: ['region'],
        aggregates: [{ name: 'count', fn: count() }],
        refresh: 'periodic',
        refreshInterval: 60000, // 1 minute
      })

      // Implementation detail: periodic refresh is handled externally
      // The table should store the interval configuration
      const stats = table.getStats()
      expect(stats.refreshMode).toBe('periodic')
      expect(stats.refreshInterval).toBe(60000)
    })
  })
})

// ============================================================================
// Ingest Tests
// ============================================================================

describe('MaterializedTable.ingest()', () => {
  let table: MaterializedTable<SalesEvent>

  beforeEach(() => {
    table = createMaterializedTable<SalesEvent>()
    table.define({
      groupBy: ['region', 'product'],
      aggregates: [
        { name: 'totalAmount', fn: sum('amount') },
        { name: 'orderCount', fn: count() },
      ],
      refresh: 'on-insert',
    })
  })

  describe('Basic ingestion', () => {
    it('should ingest a single row', () => {
      table.ingest([createSalesEvent('US', 'Laptop', 1299, 1)])

      const result = table.query()
      expect(result).toHaveLength(1)
      expect(result[0].region).toBe('US')
      expect(result[0].product).toBe('Laptop')
      expect(result[0].totalAmount).toBe(1299)
    })

    it('should ingest multiple rows', () => {
      table.ingest([
        createSalesEvent('US', 'Laptop', 1299, 1),
        createSalesEvent('US', 'Phone', 599, 2),
        createSalesEvent('EU', 'Laptop', 1199, 1),
      ])

      const result = table.query()
      expect(result).toHaveLength(3) // 3 unique (region, product) combinations
    })

    it('should aggregate rows with same group key', () => {
      table.ingest([
        createSalesEvent('US', 'Laptop', 1000, 1),
        createSalesEvent('US', 'Laptop', 500, 1),
        createSalesEvent('US', 'Laptop', 200, 1),
      ])

      const result = table.query()
      expect(result).toHaveLength(1)
      expect(result[0].totalAmount).toBe(1700)
      expect(result[0].orderCount).toBe(3)
    })

    it('should handle empty array', () => {
      const initialStats = table.getStats()
      table.ingest([])
      const afterStats = table.getStats()

      expect(afterStats.rowCount).toBe(initialStats.rowCount)
    })
  })

  describe('Incremental updates', () => {
    it('should update existing groups incrementally', () => {
      table.ingest([createSalesEvent('US', 'Laptop', 1000, 1)])
      expect(table.query()[0].totalAmount).toBe(1000)

      // Second batch should increment the existing aggregate
      table.ingest([createSalesEvent('US', 'Laptop', 500, 1)])
      expect(table.query()[0].totalAmount).toBe(1500)
    })

    it('should create new groups for new combinations', () => {
      table.ingest([createSalesEvent('US', 'Laptop', 1000, 1)])
      expect(table.query()).toHaveLength(1)

      table.ingest([createSalesEvent('EU', 'Phone', 500, 1)])
      expect(table.query()).toHaveLength(2)
    })

    it('should handle mixed updates (new and existing groups)', () => {
      table.ingest([createSalesEvent('US', 'Laptop', 1000, 1)])

      table.ingest([
        createSalesEvent('US', 'Laptop', 200, 1), // Existing
        createSalesEvent('EU', 'Phone', 300, 1), // New
      ])

      const result = table.query()
      expect(result).toHaveLength(2)

      const usLaptop = result.find((r) => r.region === 'US')
      expect(usLaptop?.totalAmount).toBe(1200)
    })

    it('should update stats after ingestion', () => {
      const beforeStats = table.getStats()
      expect(beforeStats.rowCount).toBe(0)

      table.ingest([
        createSalesEvent('US', 'Laptop', 1000, 1),
        createSalesEvent('EU', 'Phone', 500, 1),
      ])

      const afterStats = table.getStats()
      expect(afterStats.rowCount).toBe(2)
      expect(afterStats.lastRefreshTime).toBeDefined()
    })
  })

  describe('Large batch ingestion', () => {
    it('should handle 10K rows efficiently', () => {
      const rows: SalesEvent[] = []
      const regions = ['US', 'EU', 'APAC', 'LATAM']
      const products = ['Laptop', 'Phone', 'Tablet', 'Watch', 'Headphones']

      for (let i = 0; i < 10000; i++) {
        rows.push(
          createSalesEvent(
            regions[i % regions.length]!,
            products[i % products.length]!,
            100 + (i % 1000),
            1 + (i % 10)
          )
        )
      }

      const start = performance.now()
      table.ingest(rows)
      const duration = performance.now() - start

      expect(duration).toBeLessThan(1000) // Should complete in < 1 second

      const result = table.query()
      // 4 regions * 5 products = 20 unique groups
      expect(result).toHaveLength(20)

      // Verify aggregation is correct
      const totalRowCount = result.reduce((sum, r) => sum + (r.orderCount as number), 0)
      expect(totalRowCount).toBe(10000)
    })
  })
})

// ============================================================================
// Query Tests
// ============================================================================

describe('MaterializedTable.query()', () => {
  let table: MaterializedTable<SalesEvent>

  beforeEach(() => {
    table = createMaterializedTable<SalesEvent>()
    table.define({
      groupBy: ['region', 'product'],
      aggregates: [
        { name: 'totalAmount', fn: sum('amount') },
        { name: 'avgAmount', fn: avg('amount') },
        { name: 'orderCount', fn: count() },
      ],
      refresh: 'on-insert',
    })

    table.ingest([
      createSalesEvent('US', 'Laptop', 1299, 1),
      createSalesEvent('US', 'Laptop', 1199, 1),
      createSalesEvent('US', 'Phone', 599, 2),
      createSalesEvent('EU', 'Laptop', 1099, 1),
      createSalesEvent('EU', 'Phone', 499, 3),
      createSalesEvent('APAC', 'Laptop', 999, 1),
    ])
  })

  describe('Unfiltered queries', () => {
    it('should return all aggregated rows', () => {
      const result = table.query()

      expect(result).toHaveLength(5) // US-Laptop, US-Phone, EU-Laptop, EU-Phone, APAC-Laptop
    })

    it('should return rows with groupBy fields and aggregate values', () => {
      const result = table.query()

      for (const row of result) {
        expect(row).toHaveProperty('region')
        expect(row).toHaveProperty('product')
        expect(row).toHaveProperty('totalAmount')
        expect(row).toHaveProperty('avgAmount')
        expect(row).toHaveProperty('orderCount')
      }
    })

    it('should return correct aggregate values', () => {
      const result = table.query()

      const usLaptop = result.find((r) => r.region === 'US' && r.product === 'Laptop')
      expect(usLaptop?.totalAmount).toBe(2498) // 1299 + 1199
      expect(usLaptop?.avgAmount).toBe(1249) // (1299 + 1199) / 2
      expect(usLaptop?.orderCount).toBe(2)
    })
  })

  describe('Filtered queries', () => {
    it('should filter by single predicate', () => {
      const result = table.query([{ column: 'region', op: '=', value: 'US' }])

      expect(result).toHaveLength(2) // US-Laptop, US-Phone
      expect(result.every((r) => r.region === 'US')).toBe(true)
    })

    it('should filter by multiple predicates (AND)', () => {
      const result = table.query([
        { column: 'region', op: '=', value: 'US' },
        { column: 'product', op: '=', value: 'Laptop' },
      ])

      expect(result).toHaveLength(1)
      expect(result[0].region).toBe('US')
      expect(result[0].product).toBe('Laptop')
    })

    it('should filter by inequality predicates', () => {
      const result = table.query([{ column: 'totalAmount', op: '>', value: 1000 }])

      expect(result.every((r) => (r.totalAmount as number) > 1000)).toBe(true)
    })

    it('should filter by IN predicate', () => {
      const result = table.query([
        { column: 'region', op: 'in', value: ['US', 'EU'] },
      ])

      expect(result).toHaveLength(4) // US-Laptop, US-Phone, EU-Laptop, EU-Phone
      expect(result.every((r) => r.region === 'US' || r.region === 'EU')).toBe(true)
    })

    it('should return empty array when no rows match', () => {
      const result = table.query([{ column: 'region', op: '=', value: 'NonExistent' }])

      expect(result).toEqual([])
    })
  })
})

// ============================================================================
// Merge Tests
// ============================================================================

describe('MaterializedTable.merge()', () => {
  describe('Merging partial aggregates', () => {
    it('should merge two tables with same schema', () => {
      const table1 = createMaterializedTable<SalesEvent>()
      table1.define({
        groupBy: ['region'],
        aggregates: [
          { name: 'totalAmount', fn: sum('amount') },
          { name: 'orderCount', fn: count() },
        ],
        refresh: 'on-insert',
      })

      const table2 = createMaterializedTable<SalesEvent>()
      table2.define({
        groupBy: ['region'],
        aggregates: [
          { name: 'totalAmount', fn: sum('amount') },
          { name: 'orderCount', fn: count() },
        ],
        refresh: 'on-insert',
      })

      // Populate both tables
      table1.ingest([
        createSalesEvent('US', 'Laptop', 1000, 1),
        createSalesEvent('EU', 'Phone', 500, 1),
      ])

      table2.ingest([
        createSalesEvent('US', 'Phone', 600, 1),
        createSalesEvent('APAC', 'Laptop', 800, 1),
      ])

      // Merge table2 into table1
      table1.merge(table2)

      const result = table1.query()
      expect(result).toHaveLength(3) // US, EU, APAC

      const usRow = result.find((r) => r.region === 'US')
      expect(usRow?.totalAmount).toBe(1600) // 1000 + 600
      expect(usRow?.orderCount).toBe(2)
    })

    it('should correctly merge avg aggregates', () => {
      const table1 = createMaterializedTable<SalesEvent>()
      table1.define({
        groupBy: ['region'],
        aggregates: [
          { name: 'avgAmount', fn: avg('amount') },
        ],
        refresh: 'on-insert',
      })

      const table2 = createMaterializedTable<SalesEvent>()
      table2.define({
        groupBy: ['region'],
        aggregates: [
          { name: 'avgAmount', fn: avg('amount') },
        ],
        refresh: 'on-insert',
      })

      // Table1: US with avg 100 from 2 rows
      table1.ingest([
        createSalesEvent('US', 'A', 80, 1),
        createSalesEvent('US', 'B', 120, 1),
      ])

      // Table2: US with avg 200 from 3 rows
      table2.ingest([
        createSalesEvent('US', 'C', 180, 1),
        createSalesEvent('US', 'D', 200, 1),
        createSalesEvent('US', 'E', 220, 1),
      ])

      table1.merge(table2)

      const result = table1.query()
      const usRow = result.find((r) => r.region === 'US')

      // Correct weighted average: (100*2 + 200*3) / 5 = 800/5 = 160
      // Or: (80+120+180+200+220) / 5 = 800/5 = 160
      expect(usRow?.avgAmount).toBe(160)
    })

    it('should correctly merge min/max aggregates', () => {
      const table1 = createMaterializedTable<SalesEvent>()
      table1.define({
        groupBy: ['region'],
        aggregates: [
          { name: 'minAmount', fn: min('amount') },
          { name: 'maxAmount', fn: max('amount') },
        ],
        refresh: 'on-insert',
      })

      const table2 = createMaterializedTable<SalesEvent>()
      table2.define({
        groupBy: ['region'],
        aggregates: [
          { name: 'minAmount', fn: min('amount') },
          { name: 'maxAmount', fn: max('amount') },
        ],
        refresh: 'on-insert',
      })

      table1.ingest([
        createSalesEvent('US', 'A', 100, 1),
        createSalesEvent('US', 'B', 300, 1),
      ])

      table2.ingest([
        createSalesEvent('US', 'C', 50, 1),
        createSalesEvent('US', 'D', 200, 1),
      ])

      table1.merge(table2)

      const result = table1.query()
      const usRow = result.find((r) => r.region === 'US')

      expect(usRow?.minAmount).toBe(50) // min(100, 50) = 50
      expect(usRow?.maxAmount).toBe(300) // max(300, 200) = 300
    })

    it('should throw when merging tables with different schemas', () => {
      const table1 = createMaterializedTable<SalesEvent>()
      table1.define({
        groupBy: ['region'],
        aggregates: [{ name: 'totalAmount', fn: sum('amount') }],
        refresh: 'on-insert',
      })

      const table2 = createMaterializedTable<SalesEvent>()
      table2.define({
        groupBy: ['product'], // Different groupBy
        aggregates: [{ name: 'totalAmount', fn: sum('amount') }],
        refresh: 'on-insert',
      })

      expect(() => table1.merge(table2)).toThrow(/schema/i)
    })
  })

  describe('Partial aggregate export/import', () => {
    it('should export partial aggregates for distributed merge', () => {
      const table = createMaterializedTable<SalesEvent>()
      table.define({
        groupBy: ['region'],
        aggregates: [
          { name: 'totalAmount', fn: sum('amount') },
          { name: 'orderCount', fn: count() },
        ],
        refresh: 'on-insert',
      })

      table.ingest([
        createSalesEvent('US', 'Laptop', 1000, 1),
        createSalesEvent('US', 'Phone', 500, 1),
      ])

      const partials = table.exportPartials()

      expect(partials).toHaveLength(1) // One group (US)
      expect(partials[0].groupKey).toEqual({ region: 'US' })
      expect(partials[0].aggregates.totalAmount).toEqual({ type: 'sum', value: 1500 })
      expect(partials[0].aggregates.orderCount).toEqual({ type: 'count', value: 2 })
    })

    it('should import partial aggregates', () => {
      const table = createMaterializedTable<SalesEvent>()
      table.define({
        groupBy: ['region'],
        aggregates: [
          { name: 'totalAmount', fn: sum('amount') },
          { name: 'orderCount', fn: count() },
        ],
        refresh: 'on-insert',
      })

      // Import pre-computed partials
      table.importPartials([
        {
          groupKey: { region: 'US' },
          aggregates: {
            totalAmount: { type: 'sum', value: 1500 },
            orderCount: { type: 'count', value: 3 },
          },
        },
        {
          groupKey: { region: 'EU' },
          aggregates: {
            totalAmount: { type: 'sum', value: 1000 },
            orderCount: { type: 'count', value: 2 },
          },
        },
      ])

      const result = table.query()
      expect(result).toHaveLength(2)

      const usRow = result.find((r) => r.region === 'US')
      expect(usRow?.totalAmount).toBe(1500)
      expect(usRow?.orderCount).toBe(3)
    })
  })
})

// ============================================================================
// Window-based Materialization Tests
// ============================================================================

describe('Window-based MaterializedTable', () => {
  describe('Tumbling windows', () => {
    it('should create separate aggregates per tumbling window', () => {
      const table = createMaterializedTable<SalesEvent>()
      table.define({
        groupBy: ['region'],
        aggregates: [
          { name: 'totalAmount', fn: sum('amount') },
          { name: 'orderCount', fn: count() },
        ],
        window: tumbling(3600000), // 1 hour windows
        refresh: 'on-insert',
      })

      // Events in first hour window
      table.ingest([
        { ...createSalesEvent('US', 'Laptop', 1000, 1), timestamp: ts(0) },
        { ...createSalesEvent('US', 'Phone', 500, 1), timestamp: ts(1800000) }, // 30 min
      ])

      // Events in second hour window
      table.ingest([
        { ...createSalesEvent('US', 'Laptop', 800, 1), timestamp: ts(3600000) }, // 1 hour
        { ...createSalesEvent('US', 'Phone', 300, 1), timestamp: ts(5400000) }, // 1.5 hours
      ])

      const result = table.query()

      // Should have 2 groups: US in window 1, US in window 2
      expect(result).toHaveLength(2)

      // Window 1 should have sum = 1500
      const window1 = result.find((r) => r.windowStart === ts(0))
      expect(window1?.totalAmount).toBe(1500)

      // Window 2 should have sum = 1100
      const window2 = result.find((r) => r.windowStart === ts(3600000))
      expect(window2?.totalAmount).toBe(1100)
    })

    it('should include window boundaries in result', () => {
      const table = createMaterializedTable<SalesEvent>()
      table.define({
        groupBy: ['region'],
        aggregates: [{ name: 'count', fn: count() }],
        window: tumbling(60000), // 1 minute
        refresh: 'on-insert',
      })

      table.ingest([
        { ...createSalesEvent('US', 'Laptop', 1000, 1), timestamp: ts(30000) },
      ])

      const result = table.query()
      expect(result[0]).toHaveProperty('windowStart')
      expect(result[0]).toHaveProperty('windowEnd')
      expect(result[0].windowStart).toBe(ts(0))
      expect(result[0].windowEnd).toBe(ts(60000))
    })
  })

  describe('Sliding windows', () => {
    it('should create overlapping aggregates for sliding windows', () => {
      const table = createMaterializedTable<SalesEvent>()
      table.define({
        groupBy: ['region'],
        aggregates: [
          { name: 'totalAmount', fn: sum('amount') },
        ],
        window: sliding(3600000, 1800000), // 1 hour window, 30 min slide
        refresh: 'on-insert',
      })

      // Event at 45 minutes should appear in multiple windows
      table.ingest([
        { ...createSalesEvent('US', 'Laptop', 1000, 1), timestamp: ts(2700000) }, // 45 min
      ])

      const result = table.query()

      // Should appear in windows starting at 0 and 30 min
      // (45 min is within [0, 1h) and [30min, 1.5h))
      expect(result.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('Window compaction', () => {
    it('should support compacting old windows', () => {
      const table = createMaterializedTable<SalesEvent>()
      table.define({
        groupBy: ['region'],
        aggregates: [
          { name: 'totalAmount', fn: sum('amount') },
        ],
        window: tumbling(3600000),
        refresh: 'on-insert',
      })

      // Create many windows
      for (let i = 0; i < 24; i++) {
        table.ingest([
          { ...createSalesEvent('US', 'Laptop', 100, 1), timestamp: ts(i * 3600000) },
        ])
      }

      const beforeCompact = table.getStats()
      expect(beforeCompact.groupCount).toBe(24)

      // Compact windows older than 12 hours
      table.compact(ts(12 * 3600000))

      const afterCompact = table.getStats()
      expect(afterCompact.groupCount).toBeLessThan(24)
    })
  })
})

// ============================================================================
// Stats Tests
// ============================================================================

describe('MaterializedTable.getStats()', () => {
  it('should return materialization statistics', () => {
    const table = createMaterializedTable<SalesEvent>()
    table.define({
      groupBy: ['region', 'product'],
      aggregates: [
        { name: 'totalAmount', fn: sum('amount') },
        { name: 'orderCount', fn: count() },
      ],
      refresh: 'on-insert',
    })

    table.ingest([
      createSalesEvent('US', 'Laptop', 1000, 1),
      createSalesEvent('US', 'Phone', 500, 1),
      createSalesEvent('EU', 'Laptop', 800, 1),
    ])

    const stats = table.getStats()

    expect(stats.rowCount).toBe(3) // Total rows ingested
    expect(stats.groupCount).toBe(3) // Unique (region, product) groups
    expect(stats.lastRefreshTime).toBeDefined()
    expect(stats.refreshMode).toBe('on-insert')
    expect(stats.aggregateCount).toBe(2)
    expect(stats.groupByFields).toEqual(['region', 'product'])
  })

  it('should track memory usage estimate', () => {
    const table = createMaterializedTable<SalesEvent>()
    table.define({
      groupBy: ['region'],
      aggregates: [{ name: 'count', fn: count() }],
      refresh: 'on-insert',
    })

    // Add many rows
    const rows: SalesEvent[] = []
    for (let i = 0; i < 1000; i++) {
      rows.push(createSalesEvent(`region-${i % 100}`, 'Product', 100, 1))
    }
    table.ingest(rows)

    const stats = table.getStats()
    expect(stats.memoryBytes).toBeGreaterThan(0)
  })
})

// ============================================================================
// Edge Cases Tests
// ============================================================================

describe('Edge cases', () => {
  it('should handle null values in groupBy fields', () => {
    const table = createMaterializedTable<Partial<SalesEvent>>()
    table.define({
      groupBy: ['region', 'product'],
      aggregates: [{ name: 'count', fn: count() }],
      refresh: 'on-insert',
    })

    table.ingest([
      { timestamp: ts(0), region: 'US', product: 'Laptop', amount: 100, quantity: 1, category: 'Electronics', customerId: '1' },
      { timestamp: ts(0), region: 'US', product: undefined, amount: 100, quantity: 1, category: 'Electronics', customerId: '2' } as SalesEvent,
      { timestamp: ts(0), region: undefined, product: 'Phone', amount: 100, quantity: 1, category: 'Electronics', customerId: '3' } as SalesEvent,
    ])

    const result = table.query()
    // Should handle nulls as distinct group values
    expect(result.length).toBe(3)
  })

  it('should handle numeric overflow gracefully', () => {
    const table = createMaterializedTable<SalesEvent>()
    table.define({
      groupBy: ['region'],
      aggregates: [{ name: 'totalAmount', fn: sum('amount') }],
      refresh: 'on-insert',
    })

    // Ingest values that could cause overflow
    const largeValue = Number.MAX_SAFE_INTEGER / 2
    table.ingest([
      createSalesEvent('US', 'A', largeValue, 1),
      createSalesEvent('US', 'B', largeValue, 1),
    ])

    const result = table.query()
    // Should not throw, may use BigInt or return Infinity
    expect(result).toHaveLength(1)
    expect(typeof result[0].totalAmount).toBe('number')
  })

  it('should handle high cardinality groupBy efficiently', () => {
    const table = createMaterializedTable<SalesEvent>()
    table.define({
      groupBy: ['customerId'], // High cardinality
      aggregates: [
        { name: 'totalAmount', fn: sum('amount') },
        { name: 'orderCount', fn: count() },
      ],
      refresh: 'on-insert',
    })

    // Create 10K unique customers
    const rows: SalesEvent[] = []
    for (let i = 0; i < 10000; i++) {
      rows.push({
        timestamp: ts(0),
        region: 'US',
        product: 'Laptop',
        category: 'Electronics',
        amount: 100 + i,
        quantity: 1,
        customerId: `customer-${i}`,
      })
    }

    const start = performance.now()
    table.ingest(rows)
    const duration = performance.now() - start

    expect(duration).toBeLessThan(2000) // Should complete in < 2 seconds

    const stats = table.getStats()
    expect(stats.groupCount).toBe(10000)
  })

  it('should throw if ingest called before define', () => {
    const table = createMaterializedTable<SalesEvent>()

    expect(() => {
      table.ingest([createSalesEvent('US', 'Laptop', 1000, 1)])
    }).toThrow(/not defined/i)
  })

  it('should throw if query called before define', () => {
    const table = createMaterializedTable<SalesEvent>()

    expect(() => {
      table.query()
    }).toThrow(/not defined/i)
  })
})

// ============================================================================
// Module Exports Tests
// ============================================================================

describe('Module Exports', () => {
  it('should export createMaterializedTable factory', () => {
    expect(createMaterializedTable).toBeDefined()
    expect(typeof createMaterializedTable).toBe('function')
  })

  it('should export aggregate helper functions', () => {
    expect(sum).toBeDefined()
    expect(count).toBeDefined()
    expect(avg).toBeDefined()
    expect(min).toBeDefined()
    expect(max).toBeDefined()
    expect(countDistinct).toBeDefined()
  })

  it('should export window helper functions', () => {
    expect(tumbling).toBeDefined()
    expect(sliding).toBeDefined()
  })

  it('aggregate helpers should return AggregateDefinition objects', () => {
    const sumDef = sum('amount')
    expect(sumDef.type).toBe('sum')
    expect(sumDef.field).toBe('amount')

    const countDef = count()
    expect(countDef.type).toBe('count')

    const avgDef = avg('amount')
    expect(avgDef.type).toBe('avg')
    expect(avgDef.field).toBe('amount')

    const distinctDef = countDistinct('customerId')
    expect(distinctDef.type).toBe('countDistinct')
    expect(distinctDef.field).toBe('customerId')
  })

  it('window helpers should return WindowAssigner objects', () => {
    const tumblingWindow = tumbling(3600000)
    expect(tumblingWindow.type).toBe('tumbling')
    expect(tumblingWindow.size).toBe(3600000)

    const slidingWindow = sliding(3600000, 1800000)
    expect(slidingWindow.type).toBe('sliding')
    expect(slidingWindow.size).toBe(3600000)
    expect(slidingWindow.slide).toBe(1800000)
  })
})
