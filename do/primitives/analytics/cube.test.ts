/**
 * CUBE/ROLLUP Operations - Multi-dimensional aggregation tests
 *
 * Tests for SQL-standard CUBE and ROLLUP operations:
 * - CUBE generates all 2^n grouping combinations
 * - ROLLUP generates hierarchical n+1 grouping sets
 * - groupingId bitmap correctly identifies aggregated dimensions
 *
 * @see dotdo-mhcxi [ANALYTICS-2] CUBE/ROLLUP operations
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  cube,
  rollup,
  groupingSets,
  aggregate,
  cubeAggregate,
  rollupAggregate,
  calculateGroupingId,
  calculateGroupingIndicators,
  calculateGroupingLevel,
  isSubtotal,
  isGrandTotal,
  getActiveDimensions,
  filterByGroupingLevel,
  filterByGroupingId,
  getDetailRows,
  getGrandTotalRow,
  type AggregateSpec,
  type CubeResultRow,
} from './cube'

// ============================================================================
// Test Data
// ============================================================================

interface SalesRecord {
  year: number
  quarter: string
  region: string
  product: string
  amount: number
  quantity: number
}

interface WebAnalytics {
  date: string
  country: string
  device: string
  pageviews: number
  sessions: number
}

describe('Grouping Set Generators', () => {
  describe('cube()', () => {
    it('should generate all 2^n combinations for n columns', () => {
      const result = cube(['a', 'b'])
      expect(result).toHaveLength(4) // 2^2 = 4

      // Should contain: [a,b], [a], [b], []
      expect(result.some((s) => s.length === 2 && s.includes('a') && s.includes('b'))).toBe(true)
      expect(result.some((s) => s.length === 1 && s.includes('a'))).toBe(true)
      expect(result.some((s) => s.length === 1 && s.includes('b'))).toBe(true)
      expect(result.some((s) => s.length === 0)).toBe(true)
    })

    it('should generate 8 combinations for 3 columns', () => {
      const result = cube(['a', 'b', 'c'])
      expect(result).toHaveLength(8) // 2^3 = 8
    })

    it('should generate 16 combinations for 4 columns', () => {
      const result = cube(['a', 'b', 'c', 'd'])
      expect(result).toHaveLength(16) // 2^4 = 16
    })

    it('should handle empty columns', () => {
      const result = cube([])
      expect(result).toEqual([[]])
    })

    it('should handle single column', () => {
      const result = cube(['a'])
      expect(result).toHaveLength(2)
      expect(result).toContainEqual(['a'])
      expect(result).toContainEqual([])
    })

    it('should sort results by length (most detailed first)', () => {
      const result = cube(['a', 'b', 'c'])
      // First should have length 3, last should have length 0
      expect(result[0]).toHaveLength(3)
      expect(result[result.length - 1]).toHaveLength(0)
    })
  })

  describe('rollup()', () => {
    it('should generate n+1 hierarchical grouping sets', () => {
      const result = rollup(['a', 'b', 'c'])
      expect(result).toHaveLength(4) // n+1 = 4

      // Should be in order: [a,b,c], [a,b], [a], []
      expect(result[0]).toEqual(['a', 'b', 'c'])
      expect(result[1]).toEqual(['a', 'b'])
      expect(result[2]).toEqual(['a'])
      expect(result[3]).toEqual([])
    })

    it('should preserve column order (hierarchy)', () => {
      const result = rollup(['year', 'quarter', 'month'])
      expect(result).toEqual([
        ['year', 'quarter', 'month'],
        ['year', 'quarter'],
        ['year'],
        [],
      ])
    })

    it('should handle empty columns', () => {
      const result = rollup([])
      expect(result).toEqual([[]])
    })

    it('should handle single column', () => {
      const result = rollup(['a'])
      expect(result).toEqual([['a'], []])
    })
  })

  describe('groupingSets()', () => {
    it('should return the provided grouping sets', () => {
      const sets = [['a', 'b'], ['a'], []]
      const result = groupingSets(sets)
      expect(result).toHaveLength(3)
    })

    it('should deduplicate identical sets', () => {
      const sets = [['a', 'b'], ['b', 'a'], ['a']]
      const result = groupingSets(sets)
      expect(result).toHaveLength(2) // [a,b] and [b,a] are the same
    })

    it('should handle empty input', () => {
      const result = groupingSets([])
      expect(result).toEqual([])
    })
  })
})

describe('Grouping ID Calculations', () => {
  describe('calculateGroupingId()', () => {
    it('should return 0 when all dimensions are active', () => {
      const result = calculateGroupingId(['a', 'b', 'c'], ['a', 'b', 'c'])
      expect(result).toBe(0) // 0b000
    })

    it('should return max value when no dimensions are active (grand total)', () => {
      const result = calculateGroupingId(['a', 'b', 'c'], [])
      expect(result).toBe(7) // 0b111 = 7
    })

    it('should set bits for aggregated dimensions', () => {
      // With dimensions [a, b, c] and active [a], b and c are aggregated
      // a = bit 2 = 0, b = bit 1 = 1, c = bit 0 = 1
      // Result: 0b011 = 3
      const result = calculateGroupingId(['a', 'b', 'c'], ['a'])
      expect(result).toBe(3)
    })

    it('should handle single dimension', () => {
      expect(calculateGroupingId(['a'], ['a'])).toBe(0)
      expect(calculateGroupingId(['a'], [])).toBe(1)
    })

    it('should respect dimension order', () => {
      // [a, b] with active [b]: a is aggregated (bit 1), b is not (bit 0)
      // Result: 0b10 = 2
      expect(calculateGroupingId(['a', 'b'], ['b'])).toBe(2)

      // [a, b] with active [a]: a is not (bit 1), b is aggregated (bit 0)
      // Result: 0b01 = 1
      expect(calculateGroupingId(['a', 'b'], ['a'])).toBe(1)
    })
  })

  describe('calculateGroupingIndicators()', () => {
    it('should return 0 for active dimensions and 1 for aggregated', () => {
      const result = calculateGroupingIndicators(['a', 'b', 'c'], ['a', 'c'])
      expect(result).toEqual({ a: 0, b: 1, c: 0 })
    })

    it('should return all 0s when all dimensions are active', () => {
      const result = calculateGroupingIndicators(['a', 'b'], ['a', 'b'])
      expect(result).toEqual({ a: 0, b: 0 })
    })

    it('should return all 1s when no dimensions are active', () => {
      const result = calculateGroupingIndicators(['a', 'b'], [])
      expect(result).toEqual({ a: 1, b: 1 })
    })
  })

  describe('calculateGroupingLevel()', () => {
    it('should return 0 when all dimensions are active', () => {
      expect(calculateGroupingLevel(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(0)
    })

    it('should return n when no dimensions are active', () => {
      expect(calculateGroupingLevel(['a', 'b', 'c'], [])).toBe(3)
    })

    it('should return the count of aggregated dimensions', () => {
      expect(calculateGroupingLevel(['a', 'b', 'c'], ['a'])).toBe(2)
      expect(calculateGroupingLevel(['a', 'b', 'c'], ['a', 'b'])).toBe(1)
    })
  })
})

describe('aggregate()', () => {
  let salesData: SalesRecord[]

  beforeEach(() => {
    salesData = [
      { year: 2024, quarter: 'Q1', region: 'US', product: 'Laptop', amount: 1299, quantity: 10 },
      { year: 2024, quarter: 'Q1', region: 'US', product: 'Phone', amount: 599, quantity: 25 },
      { year: 2024, quarter: 'Q1', region: 'EU', product: 'Laptop', amount: 1199, quantity: 8 },
      { year: 2024, quarter: 'Q2', region: 'US', product: 'Laptop', amount: 1299, quantity: 15 },
      { year: 2024, quarter: 'Q2', region: 'EU', product: 'Chair', amount: 299, quantity: 30 },
      { year: 2024, quarter: 'Q2', region: 'APAC', product: 'Phone', amount: 499, quantity: 40 },
    ]
  })

  describe('basic aggregation', () => {
    it('should aggregate with sum', () => {
      const aggregates: AggregateSpec[] = [
        { column: 'amount', fn: 'sum', alias: 'totalAmount' },
      ]

      const result = aggregate(salesData, [[]], aggregates)

      expect(result).toHaveLength(1)
      expect(result[0]!.measures.totalAmount).toBe(1299 + 599 + 1199 + 1299 + 299 + 499)
    })

    it('should aggregate with count', () => {
      const aggregates: AggregateSpec[] = [
        { column: 'amount', fn: 'count', alias: 'count' },
      ]

      const result = aggregate(salesData, [[]], aggregates)

      expect(result[0]!.measures.count).toBe(6)
    })

    it('should aggregate with avg', () => {
      const aggregates: AggregateSpec[] = [
        { column: 'amount', fn: 'avg', alias: 'avgAmount' },
      ]

      const result = aggregate(salesData, [[]], aggregates)

      const expectedAvg = (1299 + 599 + 1199 + 1299 + 299 + 499) / 6
      expect(result[0]!.measures.avgAmount).toBeCloseTo(expectedAvg)
    })

    it('should aggregate with min and max', () => {
      const aggregates: AggregateSpec[] = [
        { column: 'amount', fn: 'min', alias: 'minAmount' },
        { column: 'amount', fn: 'max', alias: 'maxAmount' },
      ]

      const result = aggregate(salesData, [[]], aggregates)

      expect(result[0]!.measures.minAmount).toBe(299)
      expect(result[0]!.measures.maxAmount).toBe(1299)
    })

    it('should support multiple aggregates', () => {
      const aggregates: AggregateSpec[] = [
        { column: 'amount', fn: 'sum', alias: 'totalAmount' },
        { column: 'quantity', fn: 'sum', alias: 'totalQuantity' },
        { column: 'amount', fn: 'count', alias: 'rowCount' },
      ]

      const result = aggregate(salesData, [[]], aggregates)

      expect(result[0]!.measures.totalAmount).toBe(5194)
      expect(result[0]!.measures.totalQuantity).toBe(128)
      expect(result[0]!.measures.rowCount).toBe(6)
    })
  })

  describe('grouping by single dimension', () => {
    it('should group by a single dimension', () => {
      const aggregates: AggregateSpec[] = [
        { column: 'amount', fn: 'sum', alias: 'total' },
      ]

      const result = aggregate(salesData, [['region']], aggregates)

      // Should have 3 groups: US, EU, APAC
      expect(result).toHaveLength(3)

      const usRow = result.find((r) => r.dimensions.region === 'US')
      expect(usRow?.measures.total).toBe(1299 + 599 + 1299) // US total

      const euRow = result.find((r) => r.dimensions.region === 'EU')
      expect(euRow?.measures.total).toBe(1199 + 299) // EU total

      const apacRow = result.find((r) => r.dimensions.region === 'APAC')
      expect(apacRow?.measures.total).toBe(499) // APAC total
    })

    it('should include grouping metadata', () => {
      const aggregates: AggregateSpec[] = [
        { column: 'amount', fn: 'sum', alias: 'total' },
      ]

      const result = aggregate(salesData, [['region']], aggregates)

      for (const row of result) {
        expect(row.groupingId).toBe(0) // region is active
        expect(row.grouping.region).toBe(0) // region not aggregated
        expect(row.groupingLevel).toBe(0) // no dimensions aggregated
      }
    })
  })

  describe('grouping by multiple dimensions', () => {
    it('should group by multiple dimensions', () => {
      const aggregates: AggregateSpec[] = [
        { column: 'amount', fn: 'sum', alias: 'total' },
      ]

      const result = aggregate(salesData, [['quarter', 'region']], aggregates)

      // Q1 has US (2 records) and EU (1 record)
      // Q2 has US, EU, APAC (1 each)
      const q1Us = result.find(
        (r) => r.dimensions.quarter === 'Q1' && r.dimensions.region === 'US'
      )
      expect(q1Us?.measures.total).toBe(1299 + 599)

      const q2Apac = result.find(
        (r) => r.dimensions.quarter === 'Q2' && r.dimensions.region === 'APAC'
      )
      expect(q2Apac?.measures.total).toBe(499)
    })
  })

  describe('multiple grouping sets', () => {
    it('should compute multiple grouping sets', () => {
      const aggregates: AggregateSpec[] = [
        { column: 'amount', fn: 'sum', alias: 'total' },
      ]

      const result = aggregate(salesData, [['region'], []], aggregates)

      // Should have region groups + grand total
      const regionRows = result.filter((r) => r.groupingLevel === 0)
      const grandTotal = result.find((r) => r.groupingLevel === 1)

      expect(regionRows).toHaveLength(3) // US, EU, APAC
      expect(grandTotal).toBeDefined()
      expect(grandTotal!.measures.total).toBe(5194)
    })

    it('should include correct grouping metadata for each set', () => {
      const aggregates: AggregateSpec[] = [
        { column: 'amount', fn: 'sum', alias: 'total' },
      ]

      const result = aggregate(salesData, [['region'], []], aggregates)

      // Region rows: groupingId = 0 (region is active)
      const regionRows = result.filter((r) => r.groupingLevel === 0)
      for (const row of regionRows) {
        expect(row.groupingId).toBe(0)
        expect(row.grouping.region).toBe(0)
      }

      // Grand total: groupingId = 1 (region is aggregated)
      const grandTotal = result.find((r) => r.groupingLevel === 1)
      expect(grandTotal!.groupingId).toBe(1)
      expect(grandTotal!.grouping.region).toBe(1)
    })
  })

  describe('empty data handling', () => {
    it('should handle empty data with grand total', () => {
      const aggregates: AggregateSpec[] = [
        { column: 'amount', fn: 'sum', alias: 'total' },
        { column: 'amount', fn: 'count', alias: 'count' },
      ]

      const result = aggregate([], [[]], aggregates)

      expect(result).toHaveLength(1)
      expect(result[0]!.measures.count).toBe(0)
    })

    it('should return empty for non-grand-total groupings with empty data', () => {
      const aggregates: AggregateSpec[] = [
        { column: 'amount', fn: 'sum', alias: 'total' },
      ]

      const result = aggregate([], [['region']], aggregates)

      // No data means no groups to form
      expect(result).toHaveLength(0)
    })
  })

  describe('sorting', () => {
    it('should sort by grouping level when sortByLevel is true', () => {
      const aggregates: AggregateSpec[] = [
        { column: 'amount', fn: 'sum', alias: 'total' },
      ]

      const result = aggregate(
        salesData,
        [['quarter', 'region'], ['quarter'], []],
        aggregates,
        { sortByLevel: true }
      )

      // First rows should have level 0, then level 1, then level 2
      let lastLevel = -1
      for (const row of result) {
        expect(row.groupingLevel).toBeGreaterThanOrEqual(lastLevel)
        lastLevel = row.groupingLevel
      }
    })
  })
})

describe('cubeAggregate()', () => {
  let salesData: SalesRecord[]

  beforeEach(() => {
    salesData = [
      { year: 2024, quarter: 'Q1', region: 'US', product: 'Laptop', amount: 1000, quantity: 10 },
      { year: 2024, quarter: 'Q1', region: 'EU', product: 'Laptop', amount: 1200, quantity: 8 },
      { year: 2024, quarter: 'Q2', region: 'US', product: 'Phone', amount: 600, quantity: 25 },
      { year: 2024, quarter: 'Q2', region: 'EU', product: 'Phone', amount: 500, quantity: 20 },
    ]
  })

  it('should generate all dimension combinations', () => {
    const result = cubeAggregate(
      salesData,
      ['region', 'quarter'],
      [{ column: 'amount', fn: 'sum', alias: 'total' }]
    )

    // 2^2 = 4 grouping sets, but multiple rows per set based on distinct values
    // (region, quarter) pairs: 4
    // (region) only: 2
    // (quarter) only: 2
    // () grand total: 1
    // Total: 4 + 2 + 2 + 1 = 9 (approximately)

    // Check that we have all types of groupings
    expect(result.some((r) => r.dimensions.region !== null && r.dimensions.quarter !== null)).toBe(true)
    expect(result.some((r) => r.dimensions.region !== null && r.dimensions.quarter === null)).toBe(true)
    expect(result.some((r) => r.dimensions.region === null && r.dimensions.quarter !== null)).toBe(true)
    expect(result.some((r) => r.dimensions.region === null && r.dimensions.quarter === null)).toBe(true)
  })

  it('should compute correct totals at each level', () => {
    const result = cubeAggregate(
      salesData,
      ['region'],
      [{ column: 'amount', fn: 'sum', alias: 'total' }]
    )

    // Detail level
    const usTotal = result.find((r) => r.dimensions.region === 'US')
    expect(usTotal?.measures.total).toBe(1600) // 1000 + 600

    // Grand total
    const grandTotal = result.find((r) => r.dimensions.region === null)
    expect(grandTotal?.measures.total).toBe(3300) // 1000 + 1200 + 600 + 500
  })

  it('should include correct groupingId for each combination', () => {
    const result = cubeAggregate(
      salesData,
      ['region', 'quarter'],
      [{ column: 'amount', fn: 'sum', alias: 'total' }]
    )

    // Detail rows (both dimensions active): groupingId = 0
    const detailRows = result.filter(
      (r) => r.dimensions.region !== null && r.dimensions.quarter !== null
    )
    expect(detailRows.every((r) => r.groupingId === 0)).toBe(true)

    // Grand total (no dimensions active): groupingId = 3 (0b11)
    const grandTotal = result.find(
      (r) => r.dimensions.region === null && r.dimensions.quarter === null
    )
    expect(grandTotal?.groupingId).toBe(3)
  })
})

describe('rollupAggregate()', () => {
  let salesData: SalesRecord[]

  beforeEach(() => {
    salesData = [
      { year: 2024, quarter: 'Q1', region: 'US', product: 'Laptop', amount: 1000, quantity: 10 },
      { year: 2024, quarter: 'Q1', region: 'EU', product: 'Laptop', amount: 1200, quantity: 8 },
      { year: 2024, quarter: 'Q2', region: 'US', product: 'Phone', amount: 600, quantity: 25 },
      { year: 2023, quarter: 'Q4', region: 'US', product: 'Desk', amount: 500, quantity: 5 },
    ]
  })

  it('should generate hierarchical grouping sets', () => {
    const result = rollupAggregate(
      salesData,
      ['year', 'quarter'],
      [{ column: 'amount', fn: 'sum', alias: 'total' }]
    )

    // Should have:
    // - (year, quarter) detail rows
    // - (year) subtotals
    // - () grand total
    // Should NOT have (null, quarter)

    expect(result.some((r) => r.dimensions.year !== null && r.dimensions.quarter !== null)).toBe(true)
    expect(result.some((r) => r.dimensions.year !== null && r.dimensions.quarter === null)).toBe(true)
    expect(result.some((r) => r.dimensions.year === null && r.dimensions.quarter === null)).toBe(true)
    // This is the key difference from CUBE - no cross-product
    expect(result.every((r) => !(r.dimensions.year === null && r.dimensions.quarter !== null))).toBe(true)
  })

  it('should compute correct hierarchical totals', () => {
    const result = rollupAggregate(
      salesData,
      ['year', 'quarter'],
      [{ column: 'amount', fn: 'sum', alias: 'total' }]
    )

    // 2024 year total
    const year2024 = result.find(
      (r) => r.dimensions.year === 2024 && r.dimensions.quarter === null
    )
    expect(year2024?.measures.total).toBe(2800) // 1000 + 1200 + 600

    // 2023 year total
    const year2023 = result.find(
      (r) => r.dimensions.year === 2023 && r.dimensions.quarter === null
    )
    expect(year2023?.measures.total).toBe(500)

    // Grand total
    const grandTotal = result.find(
      (r) => r.dimensions.year === null && r.dimensions.quarter === null
    )
    expect(grandTotal?.measures.total).toBe(3300)
  })

  it('should preserve dimension hierarchy', () => {
    const result = rollupAggregate(
      salesData,
      ['year', 'quarter', 'region'],
      [{ column: 'amount', fn: 'sum', alias: 'total' }]
    )

    // Check that we have proper hierarchical subtotals
    // (year, quarter, region) -> (year, quarter) -> (year) -> ()
    const levels = new Set(result.map((r) => r.groupingLevel))
    expect(levels).toEqual(new Set([0, 1, 2, 3]))
  })
})

describe('Helper Functions', () => {
  let sampleResults: CubeResultRow[]

  beforeEach(() => {
    sampleResults = [
      {
        dimensions: { region: 'US', category: 'Electronics' },
        measures: { total: 1000 },
        groupingId: 0,
        grouping: { region: 0, category: 0 },
        groupingLevel: 0,
      },
      {
        dimensions: { region: 'US', category: null },
        measures: { total: 1500 },
        groupingId: 1,
        grouping: { region: 0, category: 1 },
        groupingLevel: 1,
      },
      {
        dimensions: { region: null, category: 'Electronics' },
        measures: { total: 2000 },
        groupingId: 2,
        grouping: { region: 1, category: 0 },
        groupingLevel: 1,
      },
      {
        dimensions: { region: null, category: null },
        measures: { total: 5000 },
        groupingId: 3,
        grouping: { region: 1, category: 1 },
        groupingLevel: 2,
      },
    ]
  })

  describe('isSubtotal()', () => {
    it('should return false for detail rows', () => {
      expect(isSubtotal(sampleResults[0]!)).toBe(false)
    })

    it('should return true for subtotal rows', () => {
      expect(isSubtotal(sampleResults[1]!)).toBe(true)
      expect(isSubtotal(sampleResults[2]!)).toBe(true)
    })

    it('should return true for grand total', () => {
      expect(isSubtotal(sampleResults[3]!)).toBe(true)
    })
  })

  describe('isGrandTotal()', () => {
    it('should return false for detail rows', () => {
      expect(isGrandTotal(sampleResults[0]!)).toBe(false)
    })

    it('should return false for partial subtotals', () => {
      expect(isGrandTotal(sampleResults[1]!)).toBe(false)
      expect(isGrandTotal(sampleResults[2]!)).toBe(false)
    })

    it('should return true for grand total', () => {
      expect(isGrandTotal(sampleResults[3]!)).toBe(true)
    })
  })

  describe('getActiveDimensions()', () => {
    it('should return all dimensions for detail rows', () => {
      const active = getActiveDimensions(sampleResults[0]!)
      expect(active.sort()).toEqual(['category', 'region'])
    })

    it('should return active dimensions for subtotals', () => {
      expect(getActiveDimensions(sampleResults[1]!)).toEqual(['region'])
      expect(getActiveDimensions(sampleResults[2]!)).toEqual(['category'])
    })

    it('should return empty for grand total', () => {
      expect(getActiveDimensions(sampleResults[3]!)).toEqual([])
    })
  })

  describe('filterByGroupingLevel()', () => {
    it('should filter to specific grouping level', () => {
      const level0 = filterByGroupingLevel(sampleResults, 0)
      expect(level0).toHaveLength(1)
      expect(level0[0]).toBe(sampleResults[0])

      const level1 = filterByGroupingLevel(sampleResults, 1)
      expect(level1).toHaveLength(2)

      const level2 = filterByGroupingLevel(sampleResults, 2)
      expect(level2).toHaveLength(1)
      expect(level2[0]).toBe(sampleResults[3])
    })
  })

  describe('filterByGroupingId()', () => {
    it('should filter to specific grouping ID', () => {
      const id0 = filterByGroupingId(sampleResults, 0)
      expect(id0).toHaveLength(1)
      expect(id0[0]!.dimensions.region).toBe('US')

      const id3 = filterByGroupingId(sampleResults, 3)
      expect(id3).toHaveLength(1)
      expect(id3[0]!.dimensions.region).toBeNull()
    })
  })

  describe('getDetailRows()', () => {
    it('should return only detail rows', () => {
      const details = getDetailRows(sampleResults)
      expect(details).toHaveLength(1)
      expect(details[0]!.groupingLevel).toBe(0)
    })
  })

  describe('getGrandTotalRow()', () => {
    it('should return the grand total row', () => {
      const grandTotal = getGrandTotalRow(sampleResults)
      expect(grandTotal).toBe(sampleResults[3])
    })

    it('should return undefined if no grand total exists', () => {
      const noGrandTotal = sampleResults.filter((r) => r.groupingLevel !== 2)
      expect(getGrandTotalRow(noGrandTotal)).toBeUndefined()
    })
  })
})

describe('Edge Cases', () => {
  it('should handle null values in data', () => {
    const dataWithNulls = [
      { region: 'US', amount: 100 },
      { region: null, amount: 200 },
      { region: 'EU', amount: 150 },
    ]

    const result = cubeAggregate(
      dataWithNulls,
      ['region'],
      [{ column: 'amount', fn: 'sum', alias: 'total' }]
    )

    // Should have: US, null (actual data), EU, and grand total null
    expect(result.length).toBeGreaterThan(0)
  })

  it('should handle string values correctly', () => {
    const data = [
      { category: 'A', value: 10 },
      { category: 'B', value: 20 },
      { category: 'A', value: 15 },
    ]

    const result = cubeAggregate(
      data,
      ['category'],
      [{ column: 'value', fn: 'sum', alias: 'total' }]
    )

    const categoryA = result.find((r) => r.dimensions.category === 'A')
    expect(categoryA?.measures.total).toBe(25)
  })

  it('should handle large number of dimensions', () => {
    const data = [
      { d1: 'a', d2: 'x', d3: '1', d4: 'i', value: 10 },
      { d1: 'a', d2: 'x', d3: '1', d4: 'j', value: 20 },
      { d1: 'b', d2: 'y', d3: '2', d4: 'i', value: 30 },
    ]

    // 4 dimensions = 16 grouping sets
    const start = performance.now()
    const result = cubeAggregate(
      data,
      ['d1', 'd2', 'd3', 'd4'],
      [{ column: 'value', fn: 'sum', alias: 'total' }]
    )
    const duration = performance.now() - start

    expect(result.length).toBeGreaterThan(0)
    expect(duration).toBeLessThan(1000) // Should be fast
  })

  it('should handle deeply nested field paths', () => {
    const data = [
      { meta: { location: { region: 'US' } }, amount: 100 },
      { meta: { location: { region: 'EU' } }, amount: 200 },
    ]

    const result = aggregate(
      data,
      [['meta.location.region']],
      [{ column: 'amount', fn: 'sum', alias: 'total' }]
    )

    expect(result).toHaveLength(2)
    const usRow = result.find((r) => r.dimensions['meta.location.region'] === 'US')
    expect(usRow?.measures.total).toBe(100)
  })

  it('should handle non-numeric values in aggregation gracefully', () => {
    const data = [
      { category: 'A', value: 'not a number' },
      { category: 'A', value: 10 },
      { category: 'B', value: 20 },
    ]

    const result = cubeAggregate(
      data,
      ['category'],
      [
        { column: 'value', fn: 'sum', alias: 'total' },
        { column: 'value', fn: 'count', alias: 'count' },
      ]
    )

    const categoryA = result.find(
      (r) => r.dimensions.category === 'A' && r.groupingLevel === 0
    )
    // Count should include all rows, sum should only include numeric
    expect(categoryA?.measures.count).toBe(2)
    expect(categoryA?.measures.total).toBe(10) // Only the numeric value
  })
})

describe('Real-world Use Cases', () => {
  it('should support time-based sales analysis', () => {
    const sales = [
      { year: 2024, month: 'Jan', region: 'US', revenue: 10000 },
      { year: 2024, month: 'Jan', region: 'EU', revenue: 8000 },
      { year: 2024, month: 'Feb', region: 'US', revenue: 12000 },
      { year: 2024, month: 'Feb', region: 'EU', revenue: 9000 },
    ]

    const result = rollupAggregate(
      sales,
      ['year', 'month', 'region'],
      [{ column: 'revenue', fn: 'sum', alias: 'totalRevenue' }]
    )

    // Verify hierarchical structure
    const janUsDetail = result.find(
      (r) =>
        r.dimensions.year === 2024 &&
        r.dimensions.month === 'Jan' &&
        r.dimensions.region === 'US'
    )
    expect(janUsDetail?.measures.totalRevenue).toBe(10000)

    const janSubtotal = result.find(
      (r) =>
        r.dimensions.year === 2024 &&
        r.dimensions.month === 'Jan' &&
        r.dimensions.region === null
    )
    expect(janSubtotal?.measures.totalRevenue).toBe(18000)

    const yearTotal = result.find(
      (r) =>
        r.dimensions.year === 2024 &&
        r.dimensions.month === null &&
        r.dimensions.region === null
    )
    expect(yearTotal?.measures.totalRevenue).toBe(39000)
  })

  it('should support web analytics with multiple dimensions', () => {
    const analytics: WebAnalytics[] = [
      { date: '2024-01-01', country: 'US', device: 'mobile', pageviews: 1000, sessions: 500 },
      { date: '2024-01-01', country: 'US', device: 'desktop', pageviews: 800, sessions: 400 },
      { date: '2024-01-01', country: 'UK', device: 'mobile', pageviews: 600, sessions: 300 },
      { date: '2024-01-02', country: 'US', device: 'mobile', pageviews: 1100, sessions: 550 },
    ]

    const result = cubeAggregate(
      analytics,
      ['country', 'device'],
      [
        { column: 'pageviews', fn: 'sum', alias: 'totalPageviews' },
        { column: 'sessions', fn: 'sum', alias: 'totalSessions' },
        { column: 'pageviews', fn: 'avg', alias: 'avgPageviews' },
      ]
    )

    // US mobile total
    const usMobile = result.find(
      (r) =>
        r.dimensions.country === 'US' &&
        r.dimensions.device === 'mobile' &&
        r.groupingLevel === 0
    )
    expect(usMobile?.measures.totalPageviews).toBe(2100)
    expect(usMobile?.measures.totalSessions).toBe(1050)

    // Grand total
    const grandTotal = getGrandTotalRow(result)
    expect(grandTotal?.measures.totalPageviews).toBe(3500)
  })
})
