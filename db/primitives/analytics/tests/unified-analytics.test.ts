/**
 * Unified Analytics API Tests - TDD RED Phase
 *
 * Tests for a fluent builder API that unifies all analytics primitives:
 * - TypedColumnStore for columnar storage
 * - MaterializedTable for pre-computed aggregates
 * - CUBE/ROLLUP for multi-dimensional analysis
 * - Approximate queries (T-Digest, Count-Min Sketch)
 *
 * The API provides:
 * - Fluent chained method calls
 * - Query plan generation and explain
 * - Streaming and batch modes
 * - Full type inference
 *
 * @see dotdo-eqrhx
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createAnalytics,
  Analytics,
  AnalyticsBuilder,
  // Aggregate helpers
  sum,
  count,
  avg,
  min,
  max,
  countDistinct,
  approxPercentile,
  approxTopK,
  // Predicate helpers
  eq,
  neq,
  gt,
  lt,
  gte,
  lte,
  between,
  inList,
  // Window helpers
  tumbling,
  sliding,
  // Order helpers
  asc,
  desc,
  // Types
  type QueryPlan,
  type AggregateSpec,
  type OrderSpec,
} from '../unified-analytics'

// ============================================================================
// Test Fixtures
// ============================================================================

interface OrderEvent {
  timestamp: number
  orderId: string
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
  service: string
  metric: string
  value: number
}

const BASE_TIME = 1704067200000 // 2024-01-01 00:00:00 UTC

function ts(offsetMs: number): number {
  return BASE_TIME + offsetMs
}

function createOrder(
  region: string,
  product: string,
  amount: number,
  quantity: number = 1,
  timestampOffset: number = 0
): OrderEvent {
  return {
    timestamp: ts(timestampOffset),
    orderId: `order-${Math.random().toString(36).slice(2, 8)}`,
    region,
    product,
    category: product.startsWith('Phone') ? 'Electronics' : 'Accessories',
    amount,
    quantity,
    customerId: `customer-${Math.random().toString(36).slice(2, 8)}`,
  }
}

function createMetric(
  host: string,
  metric: string,
  value: number,
  timestampOffset: number = 0
): MetricEvent {
  return {
    timestamp: ts(timestampOffset),
    host,
    service: 'api',
    metric,
    value,
  }
}

// ============================================================================
// Analytics Factory Tests
// ============================================================================

describe('createAnalytics() factory', () => {
  it('should create an Analytics instance', () => {
    const analytics = createAnalytics()
    expect(analytics).toBeDefined()
    expect(typeof analytics.table).toBe('function')
    expect(typeof analytics.fromData).toBe('function')
  })

  it('should accept optional configuration', () => {
    const analytics = createAnalytics({
      defaultWindow: tumbling('1h'),
      approximateThreshold: 10000,
    })
    expect(analytics).toBeDefined()
  })
})

// ============================================================================
// AnalyticsBuilder - Source Selection
// ============================================================================

describe('AnalyticsBuilder - Source Selection', () => {
  let analytics: Analytics

  beforeEach(() => {
    analytics = createAnalytics()
  })

  describe('table()', () => {
    it('should create a builder from a table name', () => {
      const builder = analytics.table('orders')
      expect(builder).toBeDefined()
      expect(typeof builder.filter).toBe('function')
      expect(typeof builder.groupBy).toBe('function')
    })
  })

  describe('fromData()', () => {
    it('should create a builder from an array of data', () => {
      const orders = [
        createOrder('US', 'Phone', 100),
        createOrder('EU', 'Phone', 150),
      ]
      const builder = analytics.fromData(orders)
      expect(builder).toBeDefined()
    })

    it('should infer types from the data', async () => {
      const orders = [
        createOrder('US', 'Phone', 100),
        createOrder('EU', 'Phone', 150),
      ]
      const result = await analytics
        .fromData(orders)
        .aggregate({
          total: sum('amount'),
        })
        .execute()

      expect(result).toHaveLength(1)
      expect(result[0]!.total).toBe(250)
    })
  })
})

// ============================================================================
// AnalyticsBuilder - Filtering
// ============================================================================

describe('AnalyticsBuilder - Filtering', () => {
  let analytics: Analytics
  let orders: OrderEvent[]

  beforeEach(() => {
    analytics = createAnalytics()
    orders = [
      createOrder('US', 'Phone', 100, 1, 0),
      createOrder('US', 'Case', 20, 2, 1000),
      createOrder('EU', 'Phone', 150, 1, 2000),
      createOrder('EU', 'Case', 25, 3, 3000),
      createOrder('APAC', 'Phone', 120, 1, 4000),
    ]
  })

  describe('filter() with predicates', () => {
    it('should filter with equality predicate', async () => {
      const result = await analytics
        .fromData(orders)
        .filter(eq('region', 'US'))
        .aggregate({ count: count() })
        .execute()

      expect(result[0]!.count).toBe(2)
    })

    it('should filter with inequality predicate', async () => {
      const result = await analytics
        .fromData(orders)
        .filter(neq('region', 'US'))
        .aggregate({ count: count() })
        .execute()

      expect(result[0]!.count).toBe(3)
    })

    it('should filter with greater than predicate', async () => {
      const result = await analytics
        .fromData(orders)
        .filter(gt('amount', 100))
        .aggregate({ count: count() })
        .execute()

      expect(result[0]!.count).toBe(2)
    })

    it('should filter with less than predicate', async () => {
      const result = await analytics
        .fromData(orders)
        .filter(lt('amount', 100))
        .aggregate({ count: count() })
        .execute()

      expect(result[0]!.count).toBe(2)
    })

    it('should filter with between predicate', async () => {
      const result = await analytics
        .fromData(orders)
        .filter(between('amount', 100, 150))
        .aggregate({ count: count() })
        .execute()

      expect(result[0]!.count).toBe(3) // 100, 120, 150
    })

    it('should filter with inList predicate', async () => {
      const result = await analytics
        .fromData(orders)
        .filter(inList('region', ['US', 'EU']))
        .aggregate({ count: count() })
        .execute()

      expect(result[0]!.count).toBe(4)
    })

    it('should chain multiple filters with AND semantics', async () => {
      const result = await analytics
        .fromData(orders)
        .filter(eq('region', 'US'))
        .filter(gt('amount', 50))
        .aggregate({ count: count() })
        .execute()

      expect(result[0]!.count).toBe(1)
    })
  })

  describe('where() alias', () => {
    it('should be an alias for filter()', async () => {
      const result = await analytics
        .fromData(orders)
        .where(eq('region', 'EU'))
        .aggregate({ count: count() })
        .execute()

      expect(result[0]!.count).toBe(2)
    })
  })
})

// ============================================================================
// AnalyticsBuilder - Grouping
// ============================================================================

describe('AnalyticsBuilder - Grouping', () => {
  let analytics: Analytics
  let orders: OrderEvent[]

  beforeEach(() => {
    analytics = createAnalytics()
    orders = [
      createOrder('US', 'Phone', 100, 1),
      createOrder('US', 'Case', 20, 2),
      createOrder('EU', 'Phone', 150, 1),
      createOrder('EU', 'Case', 25, 3),
      createOrder('APAC', 'Phone', 120, 1),
    ]
  })

  describe('groupBy()', () => {
    it('should group by a single column', async () => {
      const result = await analytics
        .fromData(orders)
        .groupBy('region')
        .aggregate({ count: count() })
        .execute()

      expect(result).toHaveLength(3)
      const regions = result.map((r) => r.region)
      expect(regions).toContain('US')
      expect(regions).toContain('EU')
      expect(regions).toContain('APAC')
    })

    it('should group by multiple columns', async () => {
      const result = await analytics
        .fromData(orders)
        .groupBy('region', 'product')
        .aggregate({ count: count() })
        .execute()

      expect(result).toHaveLength(5)
    })
  })

  describe('cube()', () => {
    it('should generate all dimension combinations', async () => {
      const result = await analytics
        .fromData(orders)
        .cube('region', 'product')
        .aggregate({ total: sum('amount') })
        .execute()

      // CUBE(region, product) generates 4 groupings:
      // (region, product), (region), (product), ()
      // With 3 regions and 2 products, we get:
      // - 5 detail rows (region x product combinations)
      // - 3 region subtotals
      // - 2 product subtotals
      // - 1 grand total
      // = 11 rows total
      expect(result.length).toBeGreaterThanOrEqual(11)

      // Check for grand total
      const grandTotal = result.find((r) => r.region === null && r.product === null)
      expect(grandTotal).toBeDefined()
      expect(grandTotal!.total).toBe(415) // 100+20+150+25+120
    })
  })

  describe('rollup()', () => {
    it('should generate hierarchical subtotals', async () => {
      const result = await analytics
        .fromData(orders)
        .rollup('region', 'product')
        .aggregate({ total: sum('amount') })
        .execute()

      // ROLLUP(region, product) generates:
      // (region, product), (region), ()
      // With 3 regions and their products, we get:
      // - 5 detail rows
      // - 3 region subtotals
      // - 1 grand total
      // = 9 rows total
      expect(result.length).toBeGreaterThanOrEqual(9)

      // Check for region subtotals
      const usSubtotal = result.find((r) => r.region === 'US' && r.product === null)
      expect(usSubtotal).toBeDefined()
      expect(usSubtotal!.total).toBe(120) // 100+20
    })
  })
})

// ============================================================================
// AnalyticsBuilder - Aggregation
// ============================================================================

describe('AnalyticsBuilder - Aggregation', () => {
  let analytics: Analytics
  let orders: OrderEvent[]

  beforeEach(() => {
    analytics = createAnalytics()
    orders = [
      createOrder('US', 'Phone', 100, 1),
      createOrder('US', 'Phone', 200, 2),
      createOrder('EU', 'Phone', 150, 1),
    ]
  })

  describe('aggregate() with standard functions', () => {
    it('should compute sum', async () => {
      const result = await analytics
        .fromData(orders)
        .aggregate({ total: sum('amount') })
        .execute()

      expect(result[0]!.total).toBe(450)
    })

    it('should compute count', async () => {
      const result = await analytics
        .fromData(orders)
        .aggregate({ orders: count() })
        .execute()

      expect(result[0]!.orders).toBe(3)
    })

    it('should compute avg', async () => {
      const result = await analytics
        .fromData(orders)
        .aggregate({ avgAmount: avg('amount') })
        .execute()

      expect(result[0]!.avgAmount).toBe(150)
    })

    it('should compute min', async () => {
      const result = await analytics
        .fromData(orders)
        .aggregate({ minAmount: min('amount') })
        .execute()

      expect(result[0]!.minAmount).toBe(100)
    })

    it('should compute max', async () => {
      const result = await analytics
        .fromData(orders)
        .aggregate({ maxAmount: max('amount') })
        .execute()

      expect(result[0]!.maxAmount).toBe(200)
    })

    it('should compute countDistinct', async () => {
      const result = await analytics
        .fromData(orders)
        .aggregate({ uniqueRegions: countDistinct('region') })
        .execute()

      expect(result[0]!.uniqueRegions).toBe(2)
    })

    it('should compute multiple aggregates at once', async () => {
      const result = await analytics
        .fromData(orders)
        .aggregate({
          total: sum('amount'),
          orders: count(),
          avgAmount: avg('amount'),
          minAmount: min('amount'),
          maxAmount: max('amount'),
        })
        .execute()

      expect(result[0]).toEqual({
        total: 450,
        orders: 3,
        avgAmount: 150,
        minAmount: 100,
        maxAmount: 200,
      })
    })
  })

  describe('aggregate() with approximate functions', () => {
    it('should compute approximate percentile', async () => {
      // Create more data for percentile calculation
      const manyOrders = Array.from({ length: 100 }, (_, i) =>
        createOrder('US', 'Phone', i + 1, 1)
      )

      const result = await analytics
        .fromData(manyOrders)
        .aggregate({
          p50: approxPercentile('amount', 50),
          p95: approxPercentile('amount', 95),
          p99: approxPercentile('amount', 99),
        })
        .execute()

      // Use wider tolerance for approximate algorithms
      // T-Digest median of 1-100 is around 50-51
      expect(result[0]!.p50).toBeGreaterThan(45)
      expect(result[0]!.p50).toBeLessThan(55)
      expect(result[0]!.p95).toBeGreaterThan(90)
      expect(result[0]!.p95).toBeLessThan(100)
      expect(result[0]!.p99).toBeGreaterThan(95)
      expect(result[0]!.p99).toBeLessThanOrEqual(100)
    })

    it('should compute approximate topK', async () => {
      const ordersWithRepeats = [
        ...Array.from({ length: 50 }, () => createOrder('US', 'Phone', 100)),
        ...Array.from({ length: 30 }, () => createOrder('EU', 'Phone', 100)),
        ...Array.from({ length: 20 }, () => createOrder('APAC', 'Phone', 100)),
      ]

      const result = await analytics
        .fromData(ordersWithRepeats)
        .aggregate({
          topRegions: approxTopK('region', 3),
        })
        .execute()

      const topRegions = result[0]!.topRegions as Array<{ value: string; count: number }>
      expect(topRegions).toHaveLength(3)
      expect(topRegions[0]!.value).toBe('US')
      expect(topRegions[0]!.count).toBe(50)
    })
  })
})

// ============================================================================
// AnalyticsBuilder - Windowing
// ============================================================================

describe('AnalyticsBuilder - Windowing', () => {
  let analytics: Analytics
  let orders: OrderEvent[]

  beforeEach(() => {
    analytics = createAnalytics()
    // Create orders spread across 3 hours
    orders = [
      createOrder('US', 'Phone', 100, 1, 0), // Hour 0
      createOrder('US', 'Phone', 150, 1, 30 * 60 * 1000), // Hour 0, 30 min
      createOrder('EU', 'Phone', 200, 1, 60 * 60 * 1000), // Hour 1
      createOrder('EU', 'Phone', 250, 1, 90 * 60 * 1000), // Hour 1, 30 min
      createOrder('APAC', 'Phone', 300, 1, 120 * 60 * 1000), // Hour 2
    ]
  })

  describe('window() with tumbling windows', () => {
    it('should aggregate by tumbling window', async () => {
      const result = await analytics
        .fromData(orders)
        .window(tumbling('1h'))
        .aggregate({
          total: sum('amount'),
          count: count(),
        })
        .execute()

      expect(result).toHaveLength(3) // 3 hourly windows

      // First window: 100 + 150 = 250
      const hour0 = result.find((r) => r.windowStart === ts(0))
      expect(hour0!.total).toBe(250)
      expect(hour0!.count).toBe(2)
    })

    it('should support window with groupBy', async () => {
      const result = await analytics
        .fromData(orders)
        .window(tumbling('1h'))
        .groupBy('region')
        .aggregate({ total: sum('amount') })
        .execute()

      // Each region in each window
      const usHour0 = result.find((r) => r.region === 'US' && r.windowStart === ts(0))
      expect(usHour0!.total).toBe(250)
    })
  })

  describe('window() with sliding windows', () => {
    it('should aggregate by sliding window', async () => {
      const result = await analytics
        .fromData(orders)
        .window(sliding('2h', '1h'))
        .aggregate({ total: sum('amount') })
        .execute()

      // Each element belongs to multiple windows due to overlap
      expect(result.length).toBeGreaterThan(3)
    })
  })
})

// ============================================================================
// AnalyticsBuilder - Ordering and Limits
// ============================================================================

describe('AnalyticsBuilder - Ordering and Limits', () => {
  let analytics: Analytics
  let orders: OrderEvent[]

  beforeEach(() => {
    analytics = createAnalytics()
    orders = [
      createOrder('US', 'Phone', 100),
      createOrder('EU', 'Phone', 200),
      createOrder('APAC', 'Phone', 150),
    ]
  })

  describe('orderBy()', () => {
    it('should order results ascending', async () => {
      const result = await analytics
        .fromData(orders)
        .groupBy('region')
        .aggregate({ total: sum('amount') })
        .orderBy(asc('total'))
        .execute()

      expect(result[0]!.region).toBe('US')
      expect(result[2]!.region).toBe('EU')
    })

    it('should order results descending', async () => {
      const result = await analytics
        .fromData(orders)
        .groupBy('region')
        .aggregate({ total: sum('amount') })
        .orderBy(desc('total'))
        .execute()

      expect(result[0]!.region).toBe('EU')
      expect(result[2]!.region).toBe('US')
    })

    it('should support multiple order keys', async () => {
      const moreOrders = [
        createOrder('US', 'A', 100),
        createOrder('US', 'B', 100),
        createOrder('EU', 'A', 100),
      ]

      const result = await analytics
        .fromData(moreOrders)
        .groupBy('region', 'product')
        .aggregate({ total: sum('amount') })
        .orderBy(desc('total'), asc('region'))
        .execute()

      // All totals are 100, so sorted by region ascending
      expect(result[0]!.region).toBe('EU')
    })
  })

  describe('limit()', () => {
    it('should limit number of results', async () => {
      const result = await analytics
        .fromData(orders)
        .groupBy('region')
        .aggregate({ total: sum('amount') })
        .orderBy(desc('total'))
        .limit(2)
        .execute()

      expect(result).toHaveLength(2)
    })
  })

  describe('offset()', () => {
    it('should skip first n results', async () => {
      const result = await analytics
        .fromData(orders)
        .groupBy('region')
        .aggregate({ total: sum('amount') })
        .orderBy(desc('total'))
        .offset(1)
        .execute()

      expect(result).toHaveLength(2)
      expect(result[0]!.region).toBe('APAC')
    })
  })
})

// ============================================================================
// AnalyticsBuilder - Materialization
// ============================================================================

describe('AnalyticsBuilder - Materialization', () => {
  let analytics: Analytics
  let orders: OrderEvent[]

  beforeEach(() => {
    analytics = createAnalytics()
    orders = [
      createOrder('US', 'Phone', 100),
      createOrder('EU', 'Phone', 150),
    ]
  })

  describe('materialize()', () => {
    it('should create a materialized table', async () => {
      const materializedTable = await analytics
        .fromData(orders)
        .groupBy('region')
        .aggregate({ total: sum('amount') })
        .materialize('region_totals')

      expect(materializedTable).toBeDefined()
      expect(materializedTable.name).toBe('region_totals')

      // Query the materialized table
      const result = await analytics
        .table('region_totals')
        .execute()

      expect(result).toHaveLength(2)
    })

    it('should support incremental updates', async () => {
      const materializedTable = await analytics
        .fromData(orders)
        .groupBy('region')
        .aggregate({ total: sum('amount') })
        .materialize('region_totals', { refresh: 'on-insert' })

      // Add more data
      materializedTable.ingest([createOrder('US', 'Phone', 50)])

      const result = await analytics.table('region_totals').execute()
      const usTotal = result.find((r) => r.region === 'US')
      expect(usTotal!.total).toBe(150) // 100 + 50
    })
  })
})

// ============================================================================
// AnalyticsBuilder - Query Plan
// ============================================================================

describe('AnalyticsBuilder - Query Plan', () => {
  let analytics: Analytics

  beforeEach(() => {
    analytics = createAnalytics()
  })

  describe('explain()', () => {
    it('should return a query plan', () => {
      const orders = [createOrder('US', 'Phone', 100)]

      const plan = analytics
        .fromData(orders)
        .filter(eq('region', 'US'))
        .groupBy('region')
        .aggregate({ total: sum('amount') })
        .explain()

      expect(plan).toBeDefined()
      expect(plan.operations).toBeInstanceOf(Array)
      expect(plan.estimatedRows).toBeDefined()
    })

    it('should include filter predicates in plan', () => {
      const orders = [createOrder('US', 'Phone', 100)]

      const plan = analytics
        .fromData(orders)
        .filter(eq('region', 'US'))
        .filter(gt('amount', 50))
        .explain()

      const filterOps = plan.operations.filter((op) => op.type === 'filter')
      expect(filterOps.length).toBeGreaterThanOrEqual(1)
    })

    it('should include grouping in plan', () => {
      const orders = [createOrder('US', 'Phone', 100)]

      const plan = analytics
        .fromData(orders)
        .cube('region', 'product')
        .aggregate({ total: sum('amount') })
        .explain()

      const groupOp = plan.operations.find((op) => op.type === 'group')
      expect(groupOp).toBeDefined()
      expect(groupOp!.mode).toBe('cube')
    })
  })

  describe('explain() - human readable output', () => {
    it('should provide a human-readable explanation', () => {
      const orders = [createOrder('US', 'Phone', 100)]

      const plan = analytics
        .fromData(orders)
        .filter(eq('region', 'US'))
        .groupBy('region')
        .aggregate({ total: sum('amount') })
        .explain()

      const explanation = plan.toString()
      expect(typeof explanation).toBe('string')
      expect(explanation).toContain('Filter')
      expect(explanation).toContain('Group')
      expect(explanation).toContain('Aggregate')
    })
  })
})

// ============================================================================
// Integration: Complex Queries
// ============================================================================

describe('AnalyticsBuilder - Complex Queries', () => {
  let analytics: Analytics

  beforeEach(() => {
    analytics = createAnalytics()
  })

  it('should handle a typical analytics workflow', async () => {
    // Create sample e-commerce data
    const orders = [
      createOrder('US', 'Phone', 500, 1, 0),
      createOrder('US', 'Phone', 600, 1, 1000),
      createOrder('US', 'Case', 25, 5, 2000),
      createOrder('EU', 'Phone', 450, 1, 3000),
      createOrder('EU', 'Phone', 550, 2, 4000),
      createOrder('EU', 'Case', 30, 3, 5000),
      createOrder('APAC', 'Phone', 400, 1, 6000),
    ]

    // Revenue by region with rollup
    const revenueByRegion = await analytics
      .fromData(orders)
      .rollup('region')
      .aggregate({
        revenue: sum('amount'),
        orders: count(),
        avgOrder: avg('amount'),
      })
      .orderBy(desc('revenue'))
      .execute()

    // Check results
    expect(revenueByRegion.length).toBe(4) // 3 regions + grand total

    // Grand total
    const grandTotal = revenueByRegion.find((r) => r.region === null)
    expect(grandTotal!.revenue).toBe(2555)
    expect(grandTotal!.orders).toBe(7)

    // US
    const usTotal = revenueByRegion.find((r) => r.region === 'US')
    expect(usTotal!.revenue).toBe(1125)
    expect(usTotal!.orders).toBe(3)
  })

  it('should handle time-series aggregation', async () => {
    // Create hourly metrics
    const metrics = Array.from({ length: 24 }, (_, hour) =>
      Array.from({ length: 60 }, (_, minute) =>
        createMetric('host1', 'cpu', Math.random() * 100, hour * 3600000 + minute * 60000)
      )
    ).flat()

    const hourlyStats = await analytics
      .fromData(metrics)
      .window(tumbling('1h'))
      .aggregate({
        avgCpu: avg('value'),
        maxCpu: max('value'),
        p99Cpu: approxPercentile('value', 99),
      })
      .orderBy(asc('windowStart'))
      .execute()

    expect(hourlyStats).toHaveLength(24)
    hourlyStats.forEach((stat) => {
      expect(stat.avgCpu).toBeGreaterThan(0)
      expect(stat.maxCpu).toBeLessThanOrEqual(100)
    })
  })
})

// ============================================================================
// Type Safety Tests
// ============================================================================

describe('AnalyticsBuilder - Type Safety', () => {
  it('should provide type inference for results', async () => {
    const analytics = createAnalytics()
    const orders = [createOrder('US', 'Phone', 100)]

    // TypeScript should infer the result type
    const result = await analytics
      .fromData(orders)
      .groupBy('region')
      .aggregate({
        total: sum('amount'),
        count: count(),
      })
      .execute()

    // The result should have typed access to aggregates
    const first = result[0]!
    expect(typeof first.total).toBe('number')
    expect(typeof first.count).toBe('number')
    expect(first.region).toBe('US')
  })
})
