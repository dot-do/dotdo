/**
 * CUBE/ROLLUP Multi-dimensional Aggregation Tests (RED Phase)
 *
 * Tests for SQL analytics operations:
 * - CUBE: All dimension combinations
 * - ROLLUP: Hierarchical subtotals
 * - GROUPING SETS: Custom dimension combinations
 * - grouping() function: NULL detection in aggregate rows
 *
 * @see dotdo-1133y
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  CubeStage,
  RollupStage,
  GroupingSetsStage,
  createCubeStage,
  createRollupStage,
  createGroupingSetsStage,
  grouping,
  groupingId,
  CubeSpec,
  RollupSpec,
  GroupingSetsSpec,
} from '../stages/cube-rollup'

// Test data types
interface SalesData {
  year: number
  quarter: string
  region: string
  product: string
  category: string
  amount: number
  quantity: number
}

interface WebAnalytics {
  date: Date
  country: string
  device: string
  browser: string
  pageviews: number
  sessions: number
  bounceRate: number
}

describe('CubeStage', () => {
  let salesData: SalesData[]

  beforeEach(() => {
    salesData = [
      { year: 2024, quarter: 'Q1', region: 'US', product: 'Laptop', category: 'Electronics', amount: 1299, quantity: 10 },
      { year: 2024, quarter: 'Q1', region: 'US', product: 'Phone', category: 'Electronics', amount: 599, quantity: 25 },
      { year: 2024, quarter: 'Q1', region: 'EU', product: 'Laptop', category: 'Electronics', amount: 1199, quantity: 8 },
      { year: 2024, quarter: 'Q2', region: 'US', product: 'Laptop', category: 'Electronics', amount: 1299, quantity: 15 },
      { year: 2024, quarter: 'Q2', region: 'EU', product: 'Chair', category: 'Furniture', amount: 299, quantity: 30 },
      { year: 2024, quarter: 'Q2', region: 'APAC', product: 'Phone', category: 'Electronics', amount: 499, quantity: 40 },
      { year: 2023, quarter: 'Q4', region: 'US', product: 'Desk', category: 'Furniture', amount: 499, quantity: 5 },
      { year: 2023, quarter: 'Q4', region: 'EU', product: 'Monitor', category: 'Electronics', amount: 399, quantity: 12 },
    ]
  })

  describe('Stage properties', () => {
    it('should have name "$cube"', () => {
      const stage = createCubeStage<SalesData>({
        dimensions: ['region', 'category'],
        measures: { totalAmount: { $sum: '$amount' } },
      })
      expect(stage.name).toBe('$cube')
    })

    it('should expose the cube specification for inspection', () => {
      const spec: CubeSpec<SalesData> = {
        dimensions: ['region', 'category'],
        measures: { totalAmount: { $sum: '$amount' } },
      }
      const stage = createCubeStage(spec)
      expect(stage.specification).toEqual(spec)
    })
  })

  describe('All dimension combinations', () => {
    it('should generate all 2^n combinations for n dimensions', () => {
      // 2 dimensions -> 4 combinations: (R,C), (R,null), (null,C), (null,null)
      const stage = createCubeStage<SalesData>({
        dimensions: ['region', 'category'],
        measures: { total: { $sum: '$amount' } },
      })
      const result = stage.process(salesData)

      // Should have combinations:
      // 1. All (region, category) pairs from data
      // 2. All (region, null) subtotals
      // 3. All (null, category) subtotals
      // 4. (null, null) grand total
      expect(result.some((r) => r.region !== null && r.category !== null)).toBe(true)
      expect(result.some((r) => r.region !== null && r.category === null)).toBe(true)
      expect(result.some((r) => r.region === null && r.category !== null)).toBe(true)
      expect(result.some((r) => r.region === null && r.category === null)).toBe(true)
    })

    it('should generate 8 combinations for 3 dimensions', () => {
      // 3 dimensions -> 8 combinations
      const stage = createCubeStage<SalesData>({
        dimensions: ['year', 'region', 'category'],
        measures: { total: { $sum: '$amount' } },
      })
      const result = stage.process(salesData)

      // Count distinct grouping patterns
      const patterns = new Set(
        result.map((r) =>
          [r.year !== null, r.region !== null, r.category !== null].join(',')
        )
      )
      expect(patterns.size).toBe(8)
    })

    it('should compute correct aggregates for each combination', () => {
      const stage = createCubeStage<SalesData>({
        dimensions: ['region'],
        measures: {
          totalAmount: { $sum: '$amount' },
          count: { $count: {} },
        },
      })
      const result = stage.process(salesData)

      // Find US subtotal
      const usTotal = result.find((r) => r.region === 'US' && r._groupingLevel === 0)
      expect(usTotal?.totalAmount).toBe(1299 + 599 + 1299 + 499) // All US sales

      // Find grand total
      const grandTotal = result.find((r) => r.region === null)
      expect(grandTotal?.count).toBe(8)
    })

    it('should handle single dimension cube', () => {
      const stage = createCubeStage<SalesData>({
        dimensions: ['category'],
        measures: { total: { $sum: '$amount' } },
      })
      const result = stage.process(salesData)

      // Should have: Electronics, Furniture, null (grand total)
      expect(result).toHaveLength(3)
    })
  })

  describe('Multiple measures', () => {
    it('should compute multiple aggregates per combination', () => {
      const stage = createCubeStage<SalesData>({
        dimensions: ['region'],
        measures: {
          totalAmount: { $sum: '$amount' },
          avgAmount: { $avg: '$amount' },
          minAmount: { $min: '$amount' },
          maxAmount: { $max: '$amount' },
          count: { $count: {} },
        },
      })
      const result = stage.process(salesData)

      const grandTotal = result.find((r) => r.region === null)
      expect(grandTotal).toHaveProperty('totalAmount')
      expect(grandTotal).toHaveProperty('avgAmount')
      expect(grandTotal).toHaveProperty('minAmount')
      expect(grandTotal).toHaveProperty('maxAmount')
      expect(grandTotal).toHaveProperty('count')
    })

    it('should support computed measures', () => {
      const stage = createCubeStage<SalesData>({
        dimensions: ['region'],
        measures: {
          totalRevenue: { $sum: { $multiply: ['$amount', '$quantity'] } },
        },
      })
      const result = stage.process(salesData)

      expect(result.every((r) => typeof r.totalRevenue === 'number')).toBe(true)
    })
  })

  describe('Grouping metadata', () => {
    it('should include _groupingLevel to identify aggregation level', () => {
      const stage = createCubeStage<SalesData>({
        dimensions: ['region', 'category'],
        measures: { total: { $sum: '$amount' } },
      })
      const result = stage.process(salesData)

      // Level 0: full detail (both dimensions)
      // Level 1: one dimension rolled up
      // Level 2: grand total
      expect(result.some((r) => r._groupingLevel === 0)).toBe(true)
      expect(result.some((r) => r._groupingLevel === 1)).toBe(true)
      expect(result.some((r) => r._groupingLevel === 2)).toBe(true)
    })

    it('should include _groupingSet to identify which dimensions are grouped', () => {
      const stage = createCubeStage<SalesData>({
        dimensions: ['region', 'category'],
        measures: { total: { $sum: '$amount' } },
      })
      const result = stage.process(salesData)

      // _groupingSet is a bitmask: 0 = detail, 1 = region grouped, 2 = category grouped, 3 = both
      const grandTotal = result.find((r) => r.region === null && r.category === null)
      expect(grandTotal?._groupingSet).toBe(3) // Both dimensions are aggregated
    })
  })
})

describe('RollupStage', () => {
  let salesData: SalesData[]

  beforeEach(() => {
    salesData = [
      { year: 2024, quarter: 'Q1', region: 'US', product: 'Laptop', category: 'Electronics', amount: 1299, quantity: 10 },
      { year: 2024, quarter: 'Q1', region: 'US', product: 'Phone', category: 'Electronics', amount: 599, quantity: 25 },
      { year: 2024, quarter: 'Q1', region: 'EU', product: 'Laptop', category: 'Electronics', amount: 1199, quantity: 8 },
      { year: 2024, quarter: 'Q2', region: 'US', product: 'Laptop', category: 'Electronics', amount: 1299, quantity: 15 },
      { year: 2024, quarter: 'Q2', region: 'EU', product: 'Chair', category: 'Furniture', amount: 299, quantity: 30 },
      { year: 2024, quarter: 'Q2', region: 'APAC', product: 'Phone', category: 'Electronics', amount: 499, quantity: 40 },
    ]
  })

  describe('Stage properties', () => {
    it('should have name "$rollup"', () => {
      const stage = createRollupStage<SalesData>({
        dimensions: ['year', 'quarter', 'region'],
        measures: { total: { $sum: '$amount' } },
      })
      expect(stage.name).toBe('$rollup')
    })

    it('should expose the rollup specification for inspection', () => {
      const spec: RollupSpec<SalesData> = {
        dimensions: ['year', 'quarter'],
        measures: { total: { $sum: '$amount' } },
      }
      const stage = createRollupStage(spec)
      expect(stage.specification).toEqual(spec)
    })
  })

  describe('Hierarchical subtotals', () => {
    it('should generate n+1 levels for n dimensions', () => {
      // ROLLUP(A, B, C) generates:
      // (A, B, C), (A, B, null), (A, null, null), (null, null, null)
      const stage = createRollupStage<SalesData>({
        dimensions: ['year', 'quarter', 'region'],
        measures: { total: { $sum: '$amount' } },
      })
      const result = stage.process(salesData)

      // Should have 4 levels
      const levels = new Set(result.map((r) => r._groupingLevel))
      expect(levels.size).toBe(4) // 0, 1, 2, 3
    })

    it('should respect dimension hierarchy (left to right)', () => {
      const stage = createRollupStage<SalesData>({
        dimensions: ['year', 'quarter'],
        measures: { total: { $sum: '$amount' } },
      })
      const result = stage.process(salesData)

      // Should have:
      // - Detail rows (year, quarter) pairs
      // - Year subtotals (year, null)
      // - Grand total (null, null)
      // Should NOT have (null, quarter) - that's CUBE behavior
      expect(result.some((r) => r.year !== null && r.quarter !== null)).toBe(true)
      expect(result.some((r) => r.year !== null && r.quarter === null)).toBe(true)
      expect(result.some((r) => r.year === null && r.quarter === null)).toBe(true)
      expect(result.some((r) => r.year === null && r.quarter !== null)).toBe(false)
    })

    it('should compute correct hierarchical totals', () => {
      const stage = createRollupStage<SalesData>({
        dimensions: ['year', 'quarter'],
        measures: {
          totalAmount: { $sum: '$amount' },
          count: { $count: {} },
        },
      })
      const result = stage.process(salesData)

      // 2024 Q1 subtotal
      const q1_2024 = result.find(
        (r) => r.year === 2024 && r.quarter === 'Q1' && r._groupingLevel === 0
      )
      expect(q1_2024?.totalAmount).toBe(1299 + 599 + 1199)

      // 2024 year subtotal
      const year2024 = result.find(
        (r) => r.year === 2024 && r.quarter === null
      )
      expect(year2024?.count).toBe(6) // All 2024 records
    })
  })

  describe('Typical ROLLUP use cases', () => {
    it('should support time-based rollup (year > quarter > month)', () => {
      const timeData = [
        { year: 2024, quarter: 'Q1', month: 'Jan', sales: 100 },
        { year: 2024, quarter: 'Q1', month: 'Feb', sales: 120 },
        { year: 2024, quarter: 'Q1', month: 'Mar', sales: 110 },
        { year: 2024, quarter: 'Q2', month: 'Apr', sales: 130 },
      ]

      const stage = createRollupStage<(typeof timeData)[0]>({
        dimensions: ['year', 'quarter', 'month'],
        measures: { totalSales: { $sum: '$sales' } },
      })
      const result = stage.process(timeData)

      // Find Q1 subtotal
      const q1Total = result.find(
        (r) => r.year === 2024 && r.quarter === 'Q1' && r.month === null
      )
      expect(q1Total?.totalSales).toBe(330)
    })

    it('should support geographic rollup (country > state > city)', () => {
      const geoData = [
        { country: 'USA', state: 'CA', city: 'LA', population: 4000000 },
        { country: 'USA', state: 'CA', city: 'SF', population: 870000 },
        { country: 'USA', state: 'NY', city: 'NYC', population: 8300000 },
        { country: 'UK', state: 'England', city: 'London', population: 9000000 },
      ]

      const stage = createRollupStage<(typeof geoData)[0]>({
        dimensions: ['country', 'state', 'city'],
        measures: { totalPop: { $sum: '$population' } },
      })
      const result = stage.process(geoData)

      // USA total
      const usaTotal = result.find(
        (r) => r.country === 'USA' && r.state === null && r.city === null
      )
      expect(usaTotal?.totalPop).toBe(4000000 + 870000 + 8300000)
    })

    it('should support organizational rollup (dept > team > employee)', () => {
      const orgData = [
        { dept: 'Engineering', team: 'Frontend', employee: 'Alice', salary: 100000 },
        { dept: 'Engineering', team: 'Frontend', employee: 'Bob', salary: 95000 },
        { dept: 'Engineering', team: 'Backend', employee: 'Carol', salary: 110000 },
        { dept: 'Sales', team: 'Enterprise', employee: 'Dave', salary: 85000 },
      ]

      const stage = createRollupStage<(typeof orgData)[0]>({
        dimensions: ['dept', 'team'],
        measures: {
          totalSalary: { $sum: '$salary' },
          headcount: { $count: {} },
        },
      })
      const result = stage.process(orgData)

      // Engineering dept total
      const engTotal = result.find(
        (r) => r.dept === 'Engineering' && r.team === null
      )
      expect(engTotal?.headcount).toBe(3)
    })
  })
})

describe('GroupingSetsStage', () => {
  let salesData: SalesData[]

  beforeEach(() => {
    salesData = [
      { year: 2024, quarter: 'Q1', region: 'US', product: 'Laptop', category: 'Electronics', amount: 1299, quantity: 10 },
      { year: 2024, quarter: 'Q1', region: 'EU', product: 'Phone', category: 'Electronics', amount: 599, quantity: 15 },
      { year: 2024, quarter: 'Q2', region: 'US', product: 'Chair', category: 'Furniture', amount: 299, quantity: 20 },
      { year: 2024, quarter: 'Q2', region: 'APAC', product: 'Desk', category: 'Furniture', amount: 499, quantity: 5 },
    ]
  })

  describe('Stage properties', () => {
    it('should have name "$groupingSets"', () => {
      const stage = createGroupingSetsStage<SalesData>({
        sets: [['region'], ['category'], []],
        measures: { total: { $sum: '$amount' } },
      })
      expect(stage.name).toBe('$groupingSets')
    })

    it('should expose the grouping sets specification for inspection', () => {
      const spec: GroupingSetsSpec<SalesData> = {
        sets: [['region', 'category'], ['region'], []],
        measures: { total: { $sum: '$amount' } },
      }
      const stage = createGroupingSetsStage(spec)
      expect(stage.specification).toEqual(spec)
    })
  })

  describe('Custom dimension combinations', () => {
    it('should generate only specified grouping sets', () => {
      const stage = createGroupingSetsStage<SalesData>({
        sets: [
          ['region', 'category'], // Detail by region and category
          ['region'],             // Subtotal by region
          [],                     // Grand total
        ],
        measures: { total: { $sum: '$amount' } },
      })
      const result = stage.process(salesData)

      // Should have specific combinations only
      expect(result.some((r) => r.region !== null && r.category !== null)).toBe(true)
      expect(result.some((r) => r.region !== null && r.category === null)).toBe(true)
      expect(result.some((r) => r.region === null && r.category === null)).toBe(true)

      // Should NOT have category-only grouping (not in sets)
      expect(result.some((r) => r.region === null && r.category !== null)).toBe(false)
    })

    it('should support non-hierarchical groupings', () => {
      // Compare region totals vs category totals (not hierarchical)
      const stage = createGroupingSetsStage<SalesData>({
        sets: [
          ['region'],   // By region only
          ['category'], // By category only
        ],
        measures: { total: { $sum: '$amount' } },
      })
      const result = stage.process(salesData)

      const regionGroups = result.filter((r) => r.region !== null && r.category === null)
      const categoryGroups = result.filter((r) => r.region === null && r.category !== null)

      expect(regionGroups.length).toBeGreaterThan(0)
      expect(categoryGroups.length).toBeGreaterThan(0)
    })

    it('should handle empty set (grand total only)', () => {
      const stage = createGroupingSetsStage<SalesData>({
        sets: [[]],
        measures: { total: { $sum: '$amount' } },
      })
      const result = stage.process(salesData)

      expect(result).toHaveLength(1)
      expect(result[0].total).toBe(1299 + 599 + 299 + 499)
    })

    it('should handle single-element sets', () => {
      const stage = createGroupingSetsStage<SalesData>({
        sets: [['region']],
        measures: { total: { $sum: '$amount' } },
      })
      const result = stage.process(salesData)

      // Should have one row per distinct region
      const regions = new Set(result.map((r) => r.region))
      expect(regions.size).toBe(3) // US, EU, APAC
    })
  })

  describe('Equivalence to CUBE and ROLLUP', () => {
    it('should be equivalent to CUBE when all combinations specified', () => {
      // CUBE(A, B) = GROUPING SETS((A,B), (A), (B), ())
      const cubeStage = createCubeStage<SalesData>({
        dimensions: ['region', 'category'],
        measures: { total: { $sum: '$amount' } },
      })

      const groupingSetsStage = createGroupingSetsStage<SalesData>({
        sets: [
          ['region', 'category'],
          ['region'],
          ['category'],
          [],
        ],
        measures: { total: { $sum: '$amount' } },
      })

      const cubeResult = cubeStage.process(salesData)
      const gsResult = groupingSetsStage.process(salesData)

      // Should produce same number of rows (may differ in order)
      expect(cubeResult.length).toBe(gsResult.length)
    })

    it('should be equivalent to ROLLUP when hierarchical sets specified', () => {
      // ROLLUP(A, B) = GROUPING SETS((A,B), (A), ())
      const rollupStage = createRollupStage<SalesData>({
        dimensions: ['region', 'category'],
        measures: { total: { $sum: '$amount' } },
      })

      const groupingSetsStage = createGroupingSetsStage<SalesData>({
        sets: [
          ['region', 'category'],
          ['region'],
          [],
        ],
        measures: { total: { $sum: '$amount' } },
      })

      const rollupResult = rollupStage.process(salesData)
      const gsResult = groupingSetsStage.process(salesData)

      expect(rollupResult.length).toBe(gsResult.length)
    })
  })
})

describe('grouping() function', () => {
  let salesData: SalesData[]

  beforeEach(() => {
    salesData = [
      { year: 2024, quarter: 'Q1', region: 'US', product: 'Laptop', category: 'Electronics', amount: 1299, quantity: 10 },
      { year: 2024, quarter: 'Q1', region: 'EU', product: 'Phone', category: 'Electronics', amount: 599, quantity: 15 },
      { year: 2024, quarter: 'Q2', region: 'US', product: 'Chair', category: 'Furniture', amount: 299, quantity: 20 },
    ]
  })

  describe('NULL detection for aggregated dimensions', () => {
    it('should return 1 when dimension is aggregated (super-aggregate row)', () => {
      const stage = createCubeStage<SalesData>({
        dimensions: ['region', 'category'],
        measures: {
          total: { $sum: '$amount' },
          isRegionAggregated: { $grouping: 'region' },
          isCategoryAggregated: { $grouping: 'category' },
        },
      })
      const result = stage.process(salesData)

      // Grand total row (all aggregated)
      const grandTotal = result.find(
        (r) => r.region === null && r.category === null
      )
      expect(grandTotal?.isRegionAggregated).toBe(1)
      expect(grandTotal?.isCategoryAggregated).toBe(1)

      // Region subtotal (category aggregated)
      const regionSubtotal = result.find(
        (r) => r.region !== null && r.category === null
      )
      expect(regionSubtotal?.isRegionAggregated).toBe(0)
      expect(regionSubtotal?.isCategoryAggregated).toBe(1)
    })

    it('should return 0 when dimension is not aggregated', () => {
      const stage = createCubeStage<SalesData>({
        dimensions: ['region'],
        measures: {
          total: { $sum: '$amount' },
          isAggregated: { $grouping: 'region' },
        },
      })
      const result = stage.process(salesData)

      // Detail rows
      const detailRows = result.filter((r) => r.region !== null)
      expect(detailRows.every((r) => r.isAggregated === 0)).toBe(true)
    })

    it('should distinguish actual NULL values from aggregation NULLs', () => {
      const dataWithNulls = [
        { region: 'US', category: 'Electronics', amount: 100 },
        { region: null, category: 'Furniture', amount: 200 }, // Actual null
        { region: 'EU', category: 'Electronics', amount: 150 },
      ]

      const stage = createCubeStage<(typeof dataWithNulls)[0]>({
        dimensions: ['region', 'category'],
        measures: {
          total: { $sum: '$amount' },
          isRegionAggregated: { $grouping: 'region' },
        },
      })
      const result = stage.process(dataWithNulls)

      // Actual null region value (grouping = 0)
      const actualNull = result.find(
        (r) => r.region === null && r.isRegionAggregated === 0
      )
      expect(actualNull).toBeDefined()

      // Aggregated null region (grouping = 1)
      const aggregatedNull = result.find(
        (r) => r.region === null && r.isRegionAggregated === 1
      )
      expect(aggregatedNull).toBeDefined()
    })
  })
})

describe('groupingId() function', () => {
  let salesData: SalesData[]

  beforeEach(() => {
    salesData = [
      { year: 2024, quarter: 'Q1', region: 'US', product: 'Laptop', category: 'Electronics', amount: 1299, quantity: 10 },
      { year: 2024, quarter: 'Q1', region: 'EU', product: 'Phone', category: 'Electronics', amount: 599, quantity: 15 },
    ]
  })

  describe('Bitmask generation', () => {
    it('should generate unique bitmask for each grouping level', () => {
      const stage = createCubeStage<SalesData>({
        dimensions: ['region', 'category'],
        measures: {
          total: { $sum: '$amount' },
          groupId: { $groupingId: ['region', 'category'] },
        },
      })
      const result = stage.process(salesData)

      // groupingId for (region, category) with CUBE:
      // (R, C) -> 0b00 = 0 (neither aggregated)
      // (R, null) -> 0b01 = 1 (category aggregated)
      // (null, C) -> 0b10 = 2 (region aggregated)
      // (null, null) -> 0b11 = 3 (both aggregated)

      const detailRow = result.find((r) => r.region !== null && r.category !== null)
      expect(detailRow?.groupId).toBe(0)

      const grandTotal = result.find((r) => r.region === null && r.category === null)
      expect(grandTotal?.groupId).toBe(3)
    })

    it('should support ordering of dimensions in bitmask', () => {
      // The order of dimensions in groupingId affects bit positions
      const stage = createCubeStage<SalesData>({
        dimensions: ['region', 'category'],
        measures: {
          total: { $sum: '$amount' },
          groupId1: { $groupingId: ['region', 'category'] },
          groupId2: { $groupingId: ['category', 'region'] },
        },
      })
      const result = stage.process(salesData)

      // Region subtotal (category aggregated)
      const regionSubtotal = result.find(
        (r) => r.region !== null && r.category === null
      )

      // groupingId(['region', 'category']) -> category bit = 1 -> 0b01 = 1
      // groupingId(['category', 'region']) -> category bit = 2 -> 0b10 = 2
      expect(regionSubtotal?.groupId1).toBe(1)
      expect(regionSubtotal?.groupId2).toBe(2)
    })
  })

  describe('Use cases', () => {
    it('should enable filtering of specific aggregation levels', () => {
      const stage = createCubeStage<SalesData>({
        dimensions: ['region', 'category'],
        measures: {
          total: { $sum: '$amount' },
          groupId: { $groupingId: ['region', 'category'] },
        },
      })
      const result = stage.process(salesData)

      // Filter to only get region subtotals
      const regionSubtotals = result.filter((r) => r.groupId === 1)
      expect(regionSubtotals.every((r) => r.region !== null && r.category === null)).toBe(true)
    })

    it('should enable custom labeling of aggregation rows', () => {
      const stage = createCubeStage<SalesData>({
        dimensions: ['region'],
        measures: {
          total: { $sum: '$amount' },
          label: {
            $cond: {
              if: { $eq: [{ $grouping: 'region' }, 1] },
              then: 'All Regions',
              else: '$region',
            },
          },
        },
      })
      const result = stage.process(salesData)

      const grandTotal = result.find((r) => r.region === null)
      expect(grandTotal?.label).toBe('All Regions')

      const detailRow = result.find((r) => r.region === 'US')
      expect(detailRow?.label).toBe('US')
    })
  })
})

describe('Edge cases and performance', () => {
  it('should handle empty input', () => {
    const stage = createCubeStage<SalesData>({
      dimensions: ['region'],
      measures: { total: { $sum: '$amount' } },
    })
    const result = stage.process([])

    // Should still produce grand total with 0/null
    expect(result).toHaveLength(1)
    expect(result[0].total).toBe(0)
  })

  it('should handle single record', () => {
    const singleRecord: SalesData[] = [
      { year: 2024, quarter: 'Q1', region: 'US', product: 'Laptop', category: 'Electronics', amount: 1299, quantity: 10 },
    ]

    const stage = createCubeStage<SalesData>({
      dimensions: ['region', 'category'],
      measures: { total: { $sum: '$amount' } },
    })
    const result = stage.process(singleRecord)

    // Should have (US, Electronics), (US, null), (null, Electronics), (null, null)
    expect(result.length).toBe(4)
  })

  it('should handle many dimensions efficiently', () => {
    const data = Array.from({ length: 100 }, (_, i) => ({
      d1: String(i % 5),
      d2: String(i % 4),
      d3: String(i % 3),
      value: i,
    }))

    const stage = createCubeStage<(typeof data)[0]>({
      dimensions: ['d1', 'd2', 'd3'],
      measures: { total: { $sum: '$value' } },
    })

    const start = performance.now()
    const result = stage.process(data)
    const duration = performance.now() - start

    // 3 dimensions -> 8 grouping levels max
    // But actual rows depend on distinct value combinations
    expect(result.length).toBeGreaterThan(0)
    expect(duration).toBeLessThan(1000) // Should complete quickly
  })

  it('should handle null values in dimension columns', () => {
    const dataWithNulls = [
      { region: 'US', category: 'A', amount: 100 },
      { region: null, category: 'B', amount: 200 },
      { region: 'EU', category: null, amount: 300 },
    ]

    const stage = createCubeStage<(typeof dataWithNulls)[0]>({
      dimensions: ['region', 'category'],
      measures: {
        total: { $sum: '$amount' },
        isRegionGrouped: { $grouping: 'region' },
      },
    })
    const result = stage.process(dataWithNulls)

    // Should distinguish actual nulls from aggregation nulls
    expect(result.length).toBeGreaterThan(4)
  })
})
