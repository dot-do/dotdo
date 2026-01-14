/**
 * CUBE/ROLLUP Operations for TypedColumnStore - TDD Tests
 *
 * Multi-dimensional aggregation operations optimized for columnar storage.
 * These tests define the expected behavior for CUBE and ROLLUP operations
 * that integrate with TypedColumnStore.
 *
 * Key features tested:
 * - CUBE: Generate all 2^n combinations of dimensions
 * - ROLLUP: Generate hierarchical n+1 grouping sets
 * - groupingId: Bitmask to identify which dimensions are aggregated
 * - Performance: Handle 100K rows x 4 dimensions in <1s
 *
 * @see dotdo-mhcxi
 * @module db/primitives/analytics/tests/cube-rollup
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createCubeOperations,
  type CubeOperations,
  type GroupingSet,
  type AggregateDefinition,
  type GroupedResult,
} from '../cube-rollup'
import { createColumnStore, type TypedColumnStore } from '../../typed-column-store'

// ============================================================================
// Test Data Setup
// ============================================================================

interface SalesRecord {
  region: string
  product: string
  month: string
  amount: number
  quantity: number
}

function createSalesStore(): TypedColumnStore {
  const store = createColumnStore()
  store.addColumn('region', 'string')
  store.addColumn('product', 'string')
  store.addColumn('month', 'string')
  store.addColumn('amount', 'float64')
  store.addColumn('quantity', 'int64')
  return store
}

function appendSalesData(store: TypedColumnStore, data: SalesRecord[]): void {
  store.append('region', data.map(d => d.region))
  store.append('product', data.map(d => d.product))
  store.append('month', data.map(d => d.month))
  store.append('amount', data.map(d => d.amount))
  store.append('quantity', data.map(d => d.quantity))
}

const SAMPLE_DATA: SalesRecord[] = [
  { region: 'US', product: 'Laptop', month: 'Jan', amount: 1299, quantity: 10 },
  { region: 'US', product: 'Laptop', month: 'Feb', amount: 1199, quantity: 8 },
  { region: 'US', product: 'Phone', month: 'Jan', amount: 599, quantity: 25 },
  { region: 'EU', product: 'Laptop', month: 'Jan', amount: 1399, quantity: 12 },
  { region: 'EU', product: 'Phone', month: 'Feb', amount: 499, quantity: 30 },
  { region: 'APAC', product: 'Phone', month: 'Jan', amount: 449, quantity: 40 },
  { region: 'APAC', product: 'Laptop', month: 'Feb', amount: 1099, quantity: 5 },
]

// ============================================================================
// CUBE Grouping Set Generation Tests
// ============================================================================

describe('CubeOperations.cube() - Grouping Set Generation', () => {
  let ops: CubeOperations

  beforeEach(() => {
    ops = createCubeOperations()
  })

  describe('grouping set generation', () => {
    it('should generate 2^1 = 2 grouping sets for 1 dimension', () => {
      const sets = ops.cube(['region'])

      // CUBE(region) = {(region), ()}
      expect(sets).toHaveLength(2)
      expect(sets).toContainEqual({ columns: ['region'] })
      expect(sets).toContainEqual({ columns: [] })
    })

    it('should generate 2^2 = 4 grouping sets for 2 dimensions', () => {
      const sets = ops.cube(['region', 'product'])

      // CUBE(region, product) = {(region,product), (region), (product), ()}
      expect(sets).toHaveLength(4)
      expect(sets).toContainEqual({ columns: ['region', 'product'] })
      expect(sets).toContainEqual({ columns: ['region'] })
      expect(sets).toContainEqual({ columns: ['product'] })
      expect(sets).toContainEqual({ columns: [] })
    })

    it('should generate 2^3 = 8 grouping sets for 3 dimensions', () => {
      const sets = ops.cube(['region', 'product', 'month'])

      // All 8 combinations
      expect(sets).toHaveLength(8)
      expect(sets).toContainEqual({ columns: ['region', 'product', 'month'] })
      expect(sets).toContainEqual({ columns: ['region', 'product'] })
      expect(sets).toContainEqual({ columns: ['region', 'month'] })
      expect(sets).toContainEqual({ columns: ['product', 'month'] })
      expect(sets).toContainEqual({ columns: ['region'] })
      expect(sets).toContainEqual({ columns: ['product'] })
      expect(sets).toContainEqual({ columns: ['month'] })
      expect(sets).toContainEqual({ columns: [] })
    })

    it('should generate 2^4 = 16 grouping sets for 4 dimensions', () => {
      const sets = ops.cube(['a', 'b', 'c', 'd'])
      expect(sets).toHaveLength(16)
    })

    it('should handle empty dimensions list', () => {
      const sets = ops.cube([])
      // Empty CUBE just returns the grand total grouping
      expect(sets).toHaveLength(1)
      expect(sets).toContainEqual({ columns: [] })
    })
  })
})

// ============================================================================
// ROLLUP Grouping Set Generation Tests
// ============================================================================

describe('CubeOperations.rollup() - Hierarchical Grouping Sets', () => {
  let ops: CubeOperations

  beforeEach(() => {
    ops = createCubeOperations()
  })

  describe('hierarchical grouping set generation', () => {
    it('should generate n+1 = 2 grouping sets for 1 dimension', () => {
      const sets = ops.rollup(['region'])

      // ROLLUP(region) = {(region), ()}
      expect(sets).toHaveLength(2)
      expect(sets[0]).toEqual({ columns: ['region'] })
      expect(sets[1]).toEqual({ columns: [] })
    })

    it('should generate n+1 = 3 grouping sets for 2 dimensions', () => {
      const sets = ops.rollup(['region', 'product'])

      // ROLLUP(region, product) = {(region,product), (region), ()}
      expect(sets).toHaveLength(3)
      expect(sets[0]).toEqual({ columns: ['region', 'product'] })
      expect(sets[1]).toEqual({ columns: ['region'] })
      expect(sets[2]).toEqual({ columns: [] })
    })

    it('should generate n+1 = 4 grouping sets for 3 dimensions', () => {
      const sets = ops.rollup(['year', 'quarter', 'month'])

      // ROLLUP(year, quarter, month) = {(year,quarter,month), (year,quarter), (year), ()}
      expect(sets).toHaveLength(4)
      expect(sets[0]).toEqual({ columns: ['year', 'quarter', 'month'] })
      expect(sets[1]).toEqual({ columns: ['year', 'quarter'] })
      expect(sets[2]).toEqual({ columns: ['year'] })
      expect(sets[3]).toEqual({ columns: [] })
    })

    it('should preserve dimension order (left to right)', () => {
      const sets = ops.rollup(['a', 'b', 'c'])

      // Each level should be a prefix of the previous
      expect(sets[0].columns).toEqual(['a', 'b', 'c'])
      expect(sets[1].columns).toEqual(['a', 'b'])
      expect(sets[2].columns).toEqual(['a'])
      expect(sets[3].columns).toEqual([])
    })

    it('should handle empty dimensions list', () => {
      const sets = ops.rollup([])
      expect(sets).toHaveLength(1)
      expect(sets).toContainEqual({ columns: [] })
    })
  })

  describe('ROLLUP vs CUBE difference', () => {
    it('should NOT include non-hierarchical groupings that CUBE would', () => {
      const rollupSets = ops.rollup(['region', 'product'])
      const cubeSets = ops.cube(['region', 'product'])

      // CUBE includes (product) alone, ROLLUP does not
      const productOnlyInCube = cubeSets.some(
        s => s.columns.length === 1 && s.columns[0] === 'product'
      )
      const productOnlyInRollup = rollupSets.some(
        s => s.columns.length === 1 && s.columns[0] === 'product'
      )

      expect(productOnlyInCube).toBe(true)
      expect(productOnlyInRollup).toBe(false)
    })
  })
})

// ============================================================================
// Aggregation Execution Tests
// ============================================================================

describe('CubeOperations.aggregate() - Aggregation Execution', () => {
  let ops: CubeOperations
  let store: TypedColumnStore

  beforeEach(() => {
    ops = createCubeOperations()
    store = createSalesStore()
    appendSalesData(store, SAMPLE_DATA)
  })

  describe('single grouping set aggregation', () => {
    it('should aggregate with sum function', () => {
      const groupingSets: GroupingSet[] = [{ columns: ['region'] }]
      const aggregates: AggregateDefinition[] = [
        { name: 'totalAmount', column: 'amount', fn: 'sum' }
      ]

      const results = ops.aggregate(store, groupingSets, aggregates)

      // Should have 3 rows (US, EU, APAC)
      expect(results).toHaveLength(3)

      // Find US total: 1299 + 1199 + 599 = 3097
      const usResult = results.find(r => r.keys.region === 'US')
      expect(usResult).toBeDefined()
      expect(usResult!.aggregates.totalAmount).toBe(3097)
    })

    it('should aggregate with count function', () => {
      const groupingSets: GroupingSet[] = [{ columns: ['region'] }]
      const aggregates: AggregateDefinition[] = [
        { name: 'rowCount', column: 'amount', fn: 'count' }
      ]

      const results = ops.aggregate(store, groupingSets, aggregates)

      const usResult = results.find(r => r.keys.region === 'US')
      expect(usResult!.aggregates.rowCount).toBe(3) // 3 US records
    })

    it('should aggregate with avg function', () => {
      const groupingSets: GroupingSet[] = [{ columns: ['region'] }]
      const aggregates: AggregateDefinition[] = [
        { name: 'avgAmount', column: 'amount', fn: 'avg' }
      ]

      const results = ops.aggregate(store, groupingSets, aggregates)

      const usResult = results.find(r => r.keys.region === 'US')
      // US avg: (1299 + 1199 + 599) / 3 = 1032.33...
      expect(usResult!.aggregates.avgAmount).toBeCloseTo(3097 / 3, 2)
    })

    it('should aggregate with min function', () => {
      const groupingSets: GroupingSet[] = [{ columns: ['region'] }]
      const aggregates: AggregateDefinition[] = [
        { name: 'minAmount', column: 'amount', fn: 'min' }
      ]

      const results = ops.aggregate(store, groupingSets, aggregates)

      const usResult = results.find(r => r.keys.region === 'US')
      expect(usResult!.aggregates.minAmount).toBe(599) // Phone
    })

    it('should aggregate with max function', () => {
      const groupingSets: GroupingSet[] = [{ columns: ['region'] }]
      const aggregates: AggregateDefinition[] = [
        { name: 'maxAmount', column: 'amount', fn: 'max' }
      ]

      const results = ops.aggregate(store, groupingSets, aggregates)

      const usResult = results.find(r => r.keys.region === 'US')
      expect(usResult!.aggregates.maxAmount).toBe(1299) // Laptop Jan
    })
  })

  describe('multiple aggregates', () => {
    it('should compute multiple aggregates per grouping set', () => {
      const groupingSets: GroupingSet[] = [{ columns: ['region'] }]
      const aggregates: AggregateDefinition[] = [
        { name: 'totalAmount', column: 'amount', fn: 'sum' },
        { name: 'totalQty', column: 'quantity', fn: 'sum' },
        { name: 'avgAmount', column: 'amount', fn: 'avg' },
        { name: 'rowCount', column: 'amount', fn: 'count' },
      ]

      const results = ops.aggregate(store, groupingSets, aggregates)

      const usResult = results.find(r => r.keys.region === 'US')
      expect(usResult!.aggregates).toHaveProperty('totalAmount')
      expect(usResult!.aggregates).toHaveProperty('totalQty')
      expect(usResult!.aggregates).toHaveProperty('avgAmount')
      expect(usResult!.aggregates).toHaveProperty('rowCount')
    })
  })

  describe('multiple dimensions', () => {
    it('should group by multiple dimensions', () => {
      const groupingSets: GroupingSet[] = [{ columns: ['region', 'product'] }]
      const aggregates: AggregateDefinition[] = [
        { name: 'totalAmount', column: 'amount', fn: 'sum' }
      ]

      const results = ops.aggregate(store, groupingSets, aggregates)

      // Find US Laptop: 1299 + 1199 = 2498
      const usLaptop = results.find(
        r => r.keys.region === 'US' && r.keys.product === 'Laptop'
      )
      expect(usLaptop).toBeDefined()
      expect(usLaptop!.aggregates.totalAmount).toBe(2498)
    })
  })

  describe('grand total (empty grouping set)', () => {
    it('should compute grand total with empty columns', () => {
      const groupingSets: GroupingSet[] = [{ columns: [] }]
      const aggregates: AggregateDefinition[] = [
        { name: 'totalAmount', column: 'amount', fn: 'sum' }
      ]

      const results = ops.aggregate(store, groupingSets, aggregates)

      expect(results).toHaveLength(1)
      // Total: 1299 + 1199 + 599 + 1399 + 499 + 449 + 1099 = 6543
      expect(results[0].aggregates.totalAmount).toBe(6543)
      expect(results[0].keys).toEqual({})
    })
  })

  describe('multiple grouping sets', () => {
    it('should aggregate across multiple grouping sets', () => {
      const groupingSets: GroupingSet[] = [
        { columns: ['region', 'product'] },
        { columns: ['region'] },
        { columns: [] },
      ]
      const aggregates: AggregateDefinition[] = [
        { name: 'totalAmount', column: 'amount', fn: 'sum' }
      ]

      const results = ops.aggregate(store, groupingSets, aggregates)

      // Should have:
      // - Region x Product combinations (detail)
      // - Region subtotals
      // - Grand total
      expect(results.some(r => r.keys.region !== undefined && r.keys.product !== undefined)).toBe(true)
      expect(results.some(r => r.keys.region !== undefined && r.keys.product === undefined)).toBe(true)
      expect(results.some(r => Object.keys(r.keys).length === 0)).toBe(true)
    })
  })
})

// ============================================================================
// groupingId Tests
// ============================================================================

describe('CubeOperations.aggregate() - groupingId', () => {
  let ops: CubeOperations
  let store: TypedColumnStore

  beforeEach(() => {
    ops = createCubeOperations()
    store = createSalesStore()
    appendSalesData(store, SAMPLE_DATA)
  })

  describe('groupingId bitmask calculation', () => {
    it('should set groupingId to 0 for detail rows (all dimensions present)', () => {
      const cubeSets = ops.cube(['region', 'product'])
      const aggregates: AggregateDefinition[] = [
        { name: 'total', column: 'amount', fn: 'sum' }
      ]

      const results = ops.aggregate(store, cubeSets, aggregates)

      // Detail rows have both dimensions
      const detailRows = results.filter(
        r => r.keys.region !== undefined && r.keys.product !== undefined
      )
      expect(detailRows.every(r => r.groupingId === 0)).toBe(true)
    })

    it('should set correct groupingId for single dimension grouped', () => {
      const cubeSets = ops.cube(['region', 'product'])
      const aggregates: AggregateDefinition[] = [
        { name: 'total', column: 'amount', fn: 'sum' }
      ]

      const results = ops.aggregate(store, cubeSets, aggregates)

      // Region only (product grouped) -> bit 0 = 1 -> groupingId = 1
      const regionOnly = results.filter(
        r => r.keys.region !== undefined && r.keys.product === undefined
      )
      expect(regionOnly.every(r => r.groupingId === 1)).toBe(true)

      // Product only (region grouped) -> bit 1 = 1 -> groupingId = 2
      const productOnly = results.filter(
        r => r.keys.region === undefined && r.keys.product !== undefined
      )
      expect(productOnly.every(r => r.groupingId === 2)).toBe(true)
    })

    it('should set groupingId to max value for grand total', () => {
      const cubeSets = ops.cube(['region', 'product'])
      const aggregates: AggregateDefinition[] = [
        { name: 'total', column: 'amount', fn: 'sum' }
      ]

      const results = ops.aggregate(store, cubeSets, aggregates)

      // Grand total (both grouped) -> bits 0,1 = 1 -> groupingId = 3
      const grandTotal = results.find(
        r => r.keys.region === undefined && r.keys.product === undefined
      )
      expect(grandTotal!.groupingId).toBe(3)
    })

    it('should handle 3 dimensions correctly', () => {
      const cubeSets = ops.cube(['region', 'product', 'month'])
      const aggregates: AggregateDefinition[] = [
        { name: 'total', column: 'amount', fn: 'sum' }
      ]

      const results = ops.aggregate(store, cubeSets, aggregates)

      // Check grand total: all 3 bits set -> 2^3 - 1 = 7
      const grandTotal = results.find(
        r => Object.keys(r.keys).length === 0
      )
      expect(grandTotal!.groupingId).toBe(7)
    })
  })

  describe('groupingId uniqueness', () => {
    it('should assign unique groupingId per grouping set pattern', () => {
      const cubeSets = ops.cube(['region', 'product'])
      const aggregates: AggregateDefinition[] = [
        { name: 'total', column: 'amount', fn: 'sum' }
      ]

      const results = ops.aggregate(store, cubeSets, aggregates)

      // Collect all unique groupingIds
      const groupingIds = new Set(results.map(r => r.groupingId))

      // CUBE(2) should have 4 unique groupingIds: 0, 1, 2, 3
      expect(groupingIds.size).toBe(4)
      expect(groupingIds.has(0)).toBe(true)
      expect(groupingIds.has(1)).toBe(true)
      expect(groupingIds.has(2)).toBe(true)
      expect(groupingIds.has(3)).toBe(true)
    })
  })
})

// ============================================================================
// Full CUBE Aggregation Tests
// ============================================================================

describe('Full CUBE aggregation workflow', () => {
  let ops: CubeOperations
  let store: TypedColumnStore

  beforeEach(() => {
    ops = createCubeOperations()
    store = createSalesStore()
    appendSalesData(store, SAMPLE_DATA)
  })

  it('should execute complete CUBE with aggregation', () => {
    const cubeSets = ops.cube(['region', 'product'])
    const aggregates: AggregateDefinition[] = [
      { name: 'totalAmount', column: 'amount', fn: 'sum' },
      { name: 'count', column: 'amount', fn: 'count' },
    ]

    const results = ops.aggregate(store, cubeSets, aggregates)

    // Verify structure
    results.forEach(r => {
      expect(r).toHaveProperty('keys')
      expect(r).toHaveProperty('aggregates')
      expect(r).toHaveProperty('groupingId')
      expect(typeof r.groupingId).toBe('number')
    })

    // Verify grand total
    const grandTotal = results.find(r => r.groupingId === 3)
    expect(grandTotal!.aggregates.totalAmount).toBe(6543)
    expect(grandTotal!.aggregates.count).toBe(7)
  })
})

// ============================================================================
// Full ROLLUP Aggregation Tests
// ============================================================================

describe('Full ROLLUP aggregation workflow', () => {
  let ops: CubeOperations
  let store: TypedColumnStore

  beforeEach(() => {
    ops = createCubeOperations()
    store = createSalesStore()
    appendSalesData(store, SAMPLE_DATA)
  })

  it('should execute complete ROLLUP with aggregation', () => {
    const rollupSets = ops.rollup(['region', 'product'])
    const aggregates: AggregateDefinition[] = [
      { name: 'totalAmount', column: 'amount', fn: 'sum' },
    ]

    const results = ops.aggregate(store, rollupSets, aggregates)

    // ROLLUP should NOT have product-only subtotals
    const productOnlyRows = results.filter(
      r => r.keys.region === undefined && r.keys.product !== undefined
    )
    expect(productOnlyRows).toHaveLength(0)

    // Should have region subtotals
    const regionSubtotals = results.filter(
      r => r.keys.region !== undefined && r.keys.product === undefined
    )
    expect(regionSubtotals.length).toBeGreaterThan(0)
  })
})

// ============================================================================
// Performance Tests
// ============================================================================

describe('Performance requirements', () => {
  it('should handle 100K rows x 4 dimensions in <1s', () => {
    const ops = createCubeOperations()
    const store = createColumnStore()

    // Create 4 dimension columns
    store.addColumn('dim1', 'string')
    store.addColumn('dim2', 'string')
    store.addColumn('dim3', 'string')
    store.addColumn('dim4', 'string')
    store.addColumn('amount', 'float64')

    // Generate 100K rows
    const rowCount = 100000
    const dim1Values = Array.from({ length: rowCount }, (_, i) => `D1_${i % 10}`)
    const dim2Values = Array.from({ length: rowCount }, (_, i) => `D2_${i % 8}`)
    const dim3Values = Array.from({ length: rowCount }, (_, i) => `D3_${i % 5}`)
    const dim4Values = Array.from({ length: rowCount }, (_, i) => `D4_${i % 4}`)
    const amounts = Array.from({ length: rowCount }, (_, i) => (i % 1000) + 100)

    store.append('dim1', dim1Values)
    store.append('dim2', dim2Values)
    store.append('dim3', dim3Values)
    store.append('dim4', dim4Values)
    store.append('amount', amounts)

    // Execute CUBE on 4 dimensions (16 grouping sets)
    const cubeSets = ops.cube(['dim1', 'dim2', 'dim3', 'dim4'])
    const aggregates: AggregateDefinition[] = [
      { name: 'total', column: 'amount', fn: 'sum' },
    ]

    const start = performance.now()
    const results = ops.aggregate(store, cubeSets, aggregates)
    const duration = performance.now() - start

    // Should complete in under 1 second
    expect(duration).toBeLessThan(1000)

    // Verify we got results
    expect(results.length).toBeGreaterThan(0)

    // Verify grand total exists
    const grandTotal = results.find(r => r.groupingId === 15) // 2^4 - 1
    expect(grandTotal).toBeDefined()
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge cases', () => {
  let ops: CubeOperations

  beforeEach(() => {
    ops = createCubeOperations()
  })

  it('should handle empty store', () => {
    const store = createSalesStore()
    // Don't append any data

    const cubeSets = ops.cube(['region'])
    const aggregates: AggregateDefinition[] = [
      { name: 'total', column: 'amount', fn: 'sum' },
    ]

    const results = ops.aggregate(store, cubeSets, aggregates)

    // Should still return grouping set structure, but with 0 or appropriate defaults
    expect(results.length).toBeGreaterThanOrEqual(1)
  })

  it('should handle single row', () => {
    const store = createSalesStore()
    appendSalesData(store, [SAMPLE_DATA[0]])

    const cubeSets = ops.cube(['region', 'product'])
    const aggregates: AggregateDefinition[] = [
      { name: 'total', column: 'amount', fn: 'sum' },
    ]

    const results = ops.aggregate(store, cubeSets, aggregates)

    // Should have 4 grouping sets: detail, region-only, product-only, grand total
    // All with the same amount (single row)
    expect(results.every(r => r.aggregates.total === 1299)).toBe(true)
  })

  it('should handle duplicate dimension values', () => {
    const store = createSalesStore()
    const duplicateData: SalesRecord[] = [
      { region: 'US', product: 'Laptop', month: 'Jan', amount: 100, quantity: 1 },
      { region: 'US', product: 'Laptop', month: 'Jan', amount: 200, quantity: 2 },
      { region: 'US', product: 'Laptop', month: 'Jan', amount: 300, quantity: 3 },
    ]
    appendSalesData(store, duplicateData)

    const cubeSets = ops.cube(['region', 'product'])
    const aggregates: AggregateDefinition[] = [
      { name: 'total', column: 'amount', fn: 'sum' },
    ]

    const results = ops.aggregate(store, cubeSets, aggregates)

    // All rows collapse to same group
    const detail = results.find(r => r.groupingId === 0)
    expect(detail!.aggregates.total).toBe(600)
  })
})
