/**
 * ClickHouse Compatibility Layer Tests
 *
 * Tests for ClickHouse-compatible SQL analytics engine built on unified primitives.
 * Uses TDD approach - tests written first, then implementation.
 *
 * @see dotdo-b80fl - Unified Analytics Compat Layer Epic
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  ClickHouseClient,
  MergeTreeTable,
  ClickHouseEngine,
  MaterializedView,
  type ClickHouseConfig,
  type TableSchema,
  type ColumnDef,
  type QueryResult,
} from '../index'

// ============================================================================
// Test Data
// ============================================================================

interface HitsRow {
  event_date: Date
  user_id: number
  url: string
  views: number
  browser: string
  country: string
  revenue: number
}

interface SalesRow {
  sale_date: Date
  product: string
  category: string
  region: string
  quantity: number
  price: number
  amount: number
}

const sampleHits: HitsRow[] = [
  { event_date: new Date('2024-01-01'), user_id: 1, url: '/home', views: 10, browser: 'Chrome', country: 'US', revenue: 100 },
  { event_date: new Date('2024-01-01'), user_id: 1, url: '/products', views: 5, browser: 'Chrome', country: 'US', revenue: 50 },
  { event_date: new Date('2024-01-01'), user_id: 2, url: '/home', views: 15, browser: 'Firefox', country: 'UK', revenue: 150 },
  { event_date: new Date('2024-01-02'), user_id: 1, url: '/home', views: 8, browser: 'Chrome', country: 'US', revenue: 80 },
  { event_date: new Date('2024-01-02'), user_id: 3, url: '/products', views: 20, browser: 'Safari', country: 'CA', revenue: 200 },
  { event_date: new Date('2024-01-02'), user_id: 2, url: '/checkout', views: 3, browser: 'Firefox', country: 'UK', revenue: 300 },
  { event_date: new Date('2024-01-03'), user_id: 4, url: '/home', views: 12, browser: 'Chrome', country: 'DE', revenue: 120 },
  { event_date: new Date('2024-01-03'), user_id: 1, url: '/about', views: 2, browser: 'Chrome', country: 'US', revenue: 20 },
]

const sampleSales: SalesRow[] = [
  { sale_date: new Date('2024-01-01'), product: 'Widget', category: 'Hardware', region: 'North', quantity: 10, price: 25, amount: 250 },
  { sale_date: new Date('2024-01-01'), product: 'Gadget', category: 'Hardware', region: 'South', quantity: 5, price: 50, amount: 250 },
  { sale_date: new Date('2024-01-01'), product: 'Service', category: 'Software', region: 'North', quantity: 2, price: 100, amount: 200 },
  { sale_date: new Date('2024-01-02'), product: 'Widget', category: 'Hardware', region: 'East', quantity: 15, price: 25, amount: 375 },
  { sale_date: new Date('2024-01-02'), product: 'Service', category: 'Software', region: 'West', quantity: 8, price: 100, amount: 800 },
  { sale_date: new Date('2024-01-03'), product: 'Gadget', category: 'Hardware', region: 'North', quantity: 12, price: 50, amount: 600 },
  { sale_date: new Date('2024-01-03'), product: 'Widget', category: 'Hardware', region: 'South', quantity: 20, price: 25, amount: 500 },
  { sale_date: new Date('2024-01-03'), product: 'Support', category: 'Software', region: 'East', quantity: 3, price: 200, amount: 600 },
]

// ============================================================================
// MergeTreeTable Tests
// ============================================================================

describe('MergeTreeTable', () => {
  describe('CREATE TABLE', () => {
    it('should create table with MergeTree engine', () => {
      const table = new MergeTreeTable<HitsRow>({
        name: 'hits',
        engine: 'MergeTree',
        columns: [
          { name: 'event_date', type: 'Date' },
          { name: 'user_id', type: 'UInt64' },
          { name: 'url', type: 'String' },
          { name: 'views', type: 'UInt32' },
        ],
        orderBy: ['event_date', 'user_id'],
        partitionBy: 'toYYYYMM(event_date)',
      })

      expect(table.name).toBe('hits')
      expect(table.engine).toBe('MergeTree')
      expect(table.columns).toHaveLength(4)
      expect(table.orderBy).toEqual(['event_date', 'user_id'])
    })

    it('should create table with primary key different from order by', () => {
      const table = new MergeTreeTable<HitsRow>({
        name: 'hits',
        engine: 'MergeTree',
        columns: [
          { name: 'event_date', type: 'Date' },
          { name: 'user_id', type: 'UInt64' },
          { name: 'url', type: 'String' },
        ],
        orderBy: ['event_date', 'user_id', 'url'],
        primaryKey: ['event_date', 'user_id'],
      })

      expect(table.primaryKey).toEqual(['event_date', 'user_id'])
      expect(table.orderBy).toEqual(['event_date', 'user_id', 'url'])
    })

    it('should support TTL for automatic data expiry', () => {
      const table = new MergeTreeTable<HitsRow>({
        name: 'hits',
        engine: 'MergeTree',
        columns: [
          { name: 'event_date', type: 'Date' },
          { name: 'views', type: 'UInt32' },
        ],
        orderBy: ['event_date'],
        ttl: 'event_date + INTERVAL 30 DAY',
      })

      expect(table.ttl).toBe('event_date + INTERVAL 30 DAY')
    })

    it('should support ReplacingMergeTree engine', () => {
      const table = new MergeTreeTable<HitsRow>({
        name: 'hits',
        engine: 'ReplacingMergeTree',
        columns: [
          { name: 'user_id', type: 'UInt64' },
          { name: 'views', type: 'UInt32' },
        ],
        orderBy: ['user_id'],
        versionColumn: 'views',
      })

      expect(table.engine).toBe('ReplacingMergeTree')
      expect(table.versionColumn).toBe('views')
    })

    it('should support AggregatingMergeTree engine', () => {
      const table = new MergeTreeTable<HitsRow>({
        name: 'hits_agg',
        engine: 'AggregatingMergeTree',
        columns: [
          { name: 'event_date', type: 'Date' },
          { name: 'views', type: 'AggregateFunction(sum, UInt64)' },
        ],
        orderBy: ['event_date'],
      })

      expect(table.engine).toBe('AggregatingMergeTree')
    })
  })

  describe('INSERT', () => {
    let table: MergeTreeTable<HitsRow>

    beforeEach(() => {
      table = new MergeTreeTable<HitsRow>({
        name: 'hits',
        engine: 'MergeTree',
        columns: [
          { name: 'event_date', type: 'Date' },
          { name: 'user_id', type: 'UInt64' },
          { name: 'url', type: 'String' },
          { name: 'views', type: 'UInt32' },
          { name: 'browser', type: 'String' },
          { name: 'country', type: 'String' },
          { name: 'revenue', type: 'Float64' },
        ],
        orderBy: ['event_date', 'user_id'],
      })
    })

    it('should insert single row', () => {
      table.insert(sampleHits[0])
      expect(table.rowCount()).toBe(1)
    })

    it('should insert multiple rows with batch optimization', () => {
      table.insertBatch(sampleHits)
      expect(table.rowCount()).toBe(8)
    })

    it('should maintain sort order on insert', () => {
      // Insert out of order
      table.insert(sampleHits[7]) // Jan 3
      table.insert(sampleHits[0]) // Jan 1
      table.insert(sampleHits[3]) // Jan 2

      const rows = table.selectAll()
      // Should be sorted by event_date, user_id
      // Dates are stored as timestamps internally
      const firstDate = rows[0].event_date
      const lastDate = rows[rows.length - 1].event_date
      const jan1 = new Date('2024-01-01').getTime()
      const jan3 = new Date('2024-01-03').getTime()
      expect(typeof firstDate === 'number' ? firstDate : firstDate.getTime()).toBe(jan1)
      expect(typeof lastDate === 'number' ? lastDate : lastDate.getTime()).toBe(jan3)
    })

    it('should support columnar batch insert format', () => {
      const columnarData = {
        event_date: [new Date('2024-01-01'), new Date('2024-01-02')],
        user_id: [1, 2],
        url: ['/home', '/products'],
        views: [10, 20],
        browser: ['Chrome', 'Firefox'],
        country: ['US', 'UK'],
        revenue: [100, 200],
      }

      table.insertColumnar(columnarData)
      expect(table.rowCount()).toBe(2)
    })
  })

  describe('SELECT with WHERE', () => {
    let table: MergeTreeTable<HitsRow>

    beforeEach(() => {
      table = new MergeTreeTable<HitsRow>({
        name: 'hits',
        engine: 'MergeTree',
        columns: [
          { name: 'event_date', type: 'Date' },
          { name: 'user_id', type: 'UInt64' },
          { name: 'url', type: 'String' },
          { name: 'views', type: 'UInt32' },
          { name: 'browser', type: 'String' },
          { name: 'country', type: 'String' },
          { name: 'revenue', type: 'Float64' },
        ],
        orderBy: ['event_date', 'user_id'],
      })
      table.insertBatch(sampleHits)
    })

    it('should filter by equality', () => {
      const result = table.select({ where: { user_id: 1 } })
      expect(result.length).toBe(4) // user_id 1 appears 4 times
    })

    it('should filter by comparison operators', () => {
      const result = table.select({ where: { views: { $gt: 10 } } })
      expect(result.every(r => r.views > 10)).toBe(true)
    })

    it('should filter by BETWEEN', () => {
      const result = table.select({
        where: {
          views: { $between: [5, 15] }
        }
      })
      expect(result.every(r => r.views >= 5 && r.views <= 15)).toBe(true)
    })

    it('should filter by IN', () => {
      const result = table.select({
        where: { country: { $in: ['US', 'UK'] } }
      })
      expect(result.every(r => ['US', 'UK'].includes(r.country))).toBe(true)
    })

    it('should filter by LIKE pattern', () => {
      const result = table.select({
        where: { url: { $like: '/home%' } }
      })
      expect(result.every(r => r.url.startsWith('/home'))).toBe(true)
    })

    it('should support AND conditions', () => {
      const result = table.select({
        where: {
          $and: [
            { browser: 'Chrome' },
            { country: 'US' }
          ]
        }
      })
      expect(result.every(r => r.browser === 'Chrome' && r.country === 'US')).toBe(true)
    })

    it('should support OR conditions', () => {
      const result = table.select({
        where: {
          $or: [
            { browser: 'Chrome' },
            { browser: 'Firefox' }
          ]
        }
      })
      expect(result.every(r => r.browser === 'Chrome' || r.browser === 'Firefox')).toBe(true)
    })

    it('should filter by date range', () => {
      const result = table.select({
        where: {
          event_date: {
            $gte: new Date('2024-01-02'),
            $lt: new Date('2024-01-03')
          }
        }
      })
      expect(result.length).toBe(3) // Jan 2 has 3 entries
    })
  })

  describe('SELECT with ORDER BY and LIMIT', () => {
    let table: MergeTreeTable<HitsRow>

    beforeEach(() => {
      table = new MergeTreeTable<HitsRow>({
        name: 'hits',
        engine: 'MergeTree',
        columns: [
          { name: 'event_date', type: 'Date' },
          { name: 'user_id', type: 'UInt64' },
          { name: 'url', type: 'String' },
          { name: 'views', type: 'UInt32' },
          { name: 'browser', type: 'String' },
          { name: 'country', type: 'String' },
          { name: 'revenue', type: 'Float64' },
        ],
        orderBy: ['event_date', 'user_id'],
      })
      table.insertBatch(sampleHits)
    })

    it('should sort by single column DESC', () => {
      const result = table.select({
        orderBy: [{ column: 'views', direction: 'DESC' }],
        limit: 3,
      })

      expect(result.length).toBe(3)
      expect(result[0].views).toBeGreaterThanOrEqual(result[1].views)
      expect(result[1].views).toBeGreaterThanOrEqual(result[2].views)
    })

    it('should sort by multiple columns', () => {
      const result = table.select({
        orderBy: [
          { column: 'browser', direction: 'ASC' },
          { column: 'views', direction: 'DESC' }
        ],
      })

      // First few should be Chrome (alphabetically first)
      expect(result[0].browser).toBe('Chrome')
    })

    it('should support LIMIT with OFFSET', () => {
      const result = table.select({
        orderBy: [{ column: 'views', direction: 'DESC' }],
        limit: 3,
        offset: 2,
      })

      expect(result.length).toBe(3)
      // Skipped top 2 results
    })

    it('should handle NULLS FIRST/LAST in ORDER BY', () => {
      // Add a row with null value
      table.insert({
        event_date: new Date('2024-01-04'),
        user_id: 5,
        url: '/test',
        views: 0,
        browser: 'Chrome',
        country: 'US',
        revenue: 0
      } as any)

      const result = table.select({
        orderBy: [{ column: 'revenue', direction: 'ASC', nulls: 'FIRST' }],
      })

      // Should handle nulls first ordering
      expect(result.length).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// Aggregate Functions Tests
// ============================================================================

describe('Aggregate Functions', () => {
  let table: MergeTreeTable<HitsRow>

  beforeEach(() => {
    table = new MergeTreeTable<HitsRow>({
      name: 'hits',
      engine: 'MergeTree',
      columns: [
        { name: 'event_date', type: 'Date' },
        { name: 'user_id', type: 'UInt64' },
        { name: 'url', type: 'String' },
        { name: 'views', type: 'UInt32' },
        { name: 'browser', type: 'String' },
        { name: 'country', type: 'String' },
        { name: 'revenue', type: 'Float64' },
      ],
      orderBy: ['event_date', 'user_id'],
    })
    table.insertBatch(sampleHits)
  })

  describe('Basic Aggregates', () => {
    it('should compute count(*)', () => {
      const result = table.aggregate({ count: '*' })
      expect(result.count).toBe(8)
    })

    it('should compute count(column)', () => {
      const result = table.aggregate({ count: 'user_id' })
      expect(result.count).toBe(8) // Non-null values
    })

    it('should compute sum', () => {
      const result = table.aggregate({ sum: 'views' })
      expect(result.sum).toBe(75) // 10+5+15+8+20+3+12+2
    })

    it('should compute avg', () => {
      const result = table.aggregate({ avg: 'views' })
      expect(result.avg).toBeCloseTo(9.375, 2) // 75/8
    })

    it('should compute min and max', () => {
      const result = table.aggregate({ min: 'views', max: 'views' })
      expect(result.min).toBe(2)
      expect(result.max).toBe(20)
    })
  })

  describe('Advanced Aggregates', () => {
    it('should compute uniq (approximate distinct count)', () => {
      const result = table.aggregate({ uniq: 'user_id' })
      expect(result.uniq).toBe(4) // 4 unique users
    })

    it('should compute uniqExact (exact distinct count)', () => {
      const result = table.aggregate({ uniqExact: 'browser' })
      expect(result.uniqExact).toBe(3) // Chrome, Firefox, Safari
    })

    it('should compute quantile', () => {
      const result = table.aggregate({ quantile: { column: 'views', level: 0.5 } })
      expect(result.quantile).toBeDefined()
      // Median should be around 9 (between 8 and 10)
    })

    it('should compute multiple quantiles', () => {
      const result = table.aggregate({
        quantiles: { column: 'views', levels: [0.25, 0.5, 0.75, 0.9] }
      })
      expect(result.quantiles).toHaveLength(4)
    })

    it('should compute argMin and argMax', () => {
      const result = table.aggregate({
        argMin: { column: 'user_id', by: 'views' },
        argMax: { column: 'user_id', by: 'views' },
      })
      // argMin returns user_id for row with minimum views
      // argMax returns user_id for row with maximum views
      expect(result.argMin).toBe(1) // user 1 has views=2 (min)
      expect(result.argMax).toBe(3) // user 3 has views=20 (max)
    })

    it('should compute anyHeavy (approximate mode)', () => {
      const result = table.aggregate({ anyHeavy: 'browser' })
      expect(['Chrome', 'Firefox', 'Safari']).toContain(result.anyHeavy)
    })

    it('should compute topK', () => {
      const result = table.aggregate({ topK: { column: 'browser', k: 2 } })
      expect(result.topK).toHaveLength(2)
      expect(result.topK).toContain('Chrome') // Most common
    })
  })

  describe('GROUP BY', () => {
    it('should group by single column', () => {
      const result = table.groupBy(['browser'], { count: '*', sum: 'views' })

      expect(result.length).toBe(3) // Chrome, Firefox, Safari
      const chrome = result.find(r => r.browser === 'Chrome')
      expect(chrome?.count).toBe(5) // Chrome appears 5 times in sample data
    })

    it('should group by multiple columns', () => {
      const result = table.groupBy(
        ['browser', 'country'],
        { count: '*', sum: 'revenue' }
      )

      expect(result.length).toBeGreaterThanOrEqual(4)
    })

    it('should support HAVING clause', () => {
      const result = table.groupBy(
        ['browser'],
        { count: '*', sum: 'views' },
        { having: { count: { $gt: 1 } } }
      )

      expect(result.every(r => r.count > 1)).toBe(true)
    })

    it('should support WITH TOTALS', () => {
      const result = table.groupBy(
        ['browser'],
        { count: '*', sum: 'views' },
        { withTotals: true }
      )

      // Last row should be totals
      const totals = result.totals
      expect(totals?.count).toBe(8)
      expect(totals?.sum).toBe(75)
    })
  })
})

// ============================================================================
// Window Functions Tests
// ============================================================================

describe('Window Functions', () => {
  let table: MergeTreeTable<SalesRow>

  beforeEach(() => {
    table = new MergeTreeTable<SalesRow>({
      name: 'sales',
      engine: 'MergeTree',
      columns: [
        { name: 'sale_date', type: 'Date' },
        { name: 'product', type: 'String' },
        { name: 'category', type: 'String' },
        { name: 'region', type: 'String' },
        { name: 'quantity', type: 'UInt32' },
        { name: 'price', type: 'Float64' },
        { name: 'amount', type: 'Float64' },
      ],
      orderBy: ['sale_date', 'product'],
    })
    table.insertBatch(sampleSales)
  })

  describe('Ranking Functions', () => {
    it('should compute row_number()', () => {
      const result = table.selectWithWindow({
        columns: ['product', 'amount'],
        window: {
          rowNumber: 'rn',
          orderBy: [{ column: 'amount', direction: 'DESC' }],
        }
      })

      expect(result[0].rn).toBe(1)
      expect(result[1].rn).toBe(2)
      expect(result[0].amount).toBeGreaterThanOrEqual(result[1].amount)
    })

    it('should compute rank()', () => {
      const result = table.selectWithWindow({
        columns: ['category', 'amount'],
        window: {
          rank: 'rnk',
          orderBy: [{ column: 'amount', direction: 'DESC' }],
        }
      })

      // Same values should have same rank
      expect(result[0].rnk).toBe(1)
    })

    it('should compute dense_rank()', () => {
      const result = table.selectWithWindow({
        columns: ['category', 'amount'],
        window: {
          denseRank: 'drnk',
          orderBy: [{ column: 'amount', direction: 'DESC' }],
        }
      })

      expect(result[0].drnk).toBe(1)
    })

    it('should partition window functions', () => {
      const result = table.selectWithWindow({
        columns: ['category', 'product', 'amount'],
        window: {
          rowNumber: 'rn',
          partitionBy: ['category'],
          orderBy: [{ column: 'amount', direction: 'DESC' }],
        }
      })

      // Each category should have its own numbering starting at 1
      const hardware = result.filter(r => r.category === 'Hardware')
      const software = result.filter(r => r.category === 'Software')

      expect(hardware.some(r => r.rn === 1)).toBe(true)
      expect(software.some(r => r.rn === 1)).toBe(true)
    })
  })

  describe('Offset Functions', () => {
    it('should compute lag()', () => {
      const result = table.selectWithWindow({
        columns: ['sale_date', 'amount'],
        window: {
          lag: { column: 'amount', alias: 'prev_amount' },
          orderBy: [{ column: 'sale_date', direction: 'ASC' }],
        }
      })

      expect(result[0].prev_amount).toBeNull() // First row has no previous
      expect(result[1].prev_amount).toBe(result[0].amount)
    })

    it('should compute lead()', () => {
      const result = table.selectWithWindow({
        columns: ['sale_date', 'amount'],
        window: {
          lead: { column: 'amount', alias: 'next_amount' },
          orderBy: [{ column: 'sale_date', direction: 'ASC' }],
        }
      })

      expect(result[result.length - 1].next_amount).toBeNull() // Last row has no next
    })

    it('should compute lag with offset and default', () => {
      const result = table.selectWithWindow({
        columns: ['sale_date', 'amount'],
        window: {
          lag: { column: 'amount', offset: 2, default: 0, alias: 'prev2_amount' },
          orderBy: [{ column: 'sale_date', direction: 'ASC' }],
        }
      })

      expect(result[0].prev2_amount).toBe(0) // Default value
      expect(result[1].prev2_amount).toBe(0) // Default value
    })
  })

  describe('Running Aggregates', () => {
    it('should compute running sum', () => {
      const result = table.selectWithWindow({
        columns: ['sale_date', 'amount'],
        window: {
          sum: { column: 'amount', alias: 'running_total' },
          orderBy: [{ column: 'sale_date', direction: 'ASC' }],
          frame: { type: 'ROWS', start: 'UNBOUNDED PRECEDING', end: 'CURRENT ROW' }
        }
      })

      // Running total should increase
      expect(result[result.length - 1].running_total).toBeGreaterThan(result[0].running_total)
    })

    it('should compute moving average', () => {
      const result = table.selectWithWindow({
        columns: ['sale_date', 'amount'],
        window: {
          avg: { column: 'amount', alias: 'moving_avg' },
          orderBy: [{ column: 'sale_date', direction: 'ASC' }],
          frame: { type: 'ROWS', start: -2, end: 'CURRENT ROW' } // 3-row window
        }
      })

      expect(result[0].moving_avg).toBeDefined()
    })
  })
})

// ============================================================================
// CUBE and ROLLUP Tests
// ============================================================================

describe('CUBE and ROLLUP', () => {
  let table: MergeTreeTable<SalesRow>

  beforeEach(() => {
    table = new MergeTreeTable<SalesRow>({
      name: 'sales',
      engine: 'MergeTree',
      columns: [
        { name: 'sale_date', type: 'Date' },
        { name: 'product', type: 'String' },
        { name: 'category', type: 'String' },
        { name: 'region', type: 'String' },
        { name: 'quantity', type: 'UInt32' },
        { name: 'price', type: 'Float64' },
        { name: 'amount', type: 'Float64' },
      ],
      orderBy: ['sale_date', 'product'],
    })
    table.insertBatch(sampleSales)
  })

  describe('ROLLUP', () => {
    it('should compute hierarchical subtotals', () => {
      const result = table.rollup({
        dimensions: ['category', 'product'],
        measures: { total: { $sum: 'amount' }, count: { $count: {} } }
      })

      // Should have: (category, product), (category), ()
      const grandTotal = result.find(r => r.category === null && r.product === null)
      const categoryTotals = result.filter(r => r.category !== null && r.product === null)
      const detailed = result.filter(r => r.category !== null && r.product !== null)

      expect(grandTotal).toBeDefined()
      expect(categoryTotals.length).toBe(2) // Hardware, Software
      expect(detailed.length).toBeGreaterThan(0)
    })

    it('should identify super-aggregate rows', () => {
      const result = table.rollup({
        dimensions: ['category', 'product'],
        measures: { total: { $sum: 'amount' } },
        withGrouping: true
      })

      // Each row should have grouping() values
      const grandTotal = result.find(r =>
        r._grouping?.category === 1 && r._grouping?.product === 1
      )
      expect(grandTotal).toBeDefined()
    })
  })

  describe('CUBE', () => {
    it('should compute all dimension combinations', () => {
      const result = table.cube({
        dimensions: ['category', 'region'],
        measures: { total: { $sum: 'amount' } }
      })

      // CUBE(category, region) produces:
      // (category, region), (category, null), (null, region), (null, null)
      const combinations = new Set<string>()
      for (const row of result) {
        const key = `${row.category ?? 'null'}:${row.region ?? 'null'}`
        combinations.add(key)
      }

      // Should have grand total
      expect(combinations.has('null:null')).toBe(true)
      // Should have category subtotals
      expect(combinations.has('Hardware:null')).toBe(true)
      expect(combinations.has('Software:null')).toBe(true)
      // Should have region subtotals
      expect(combinations.has('null:North')).toBe(true)
    })

    it('should have consistent totals', () => {
      const result = table.cube({
        dimensions: ['category'],
        measures: { total: { $sum: 'amount' } }
      })

      const grandTotal = result.find(r => r.category === null)?.total
      const detailSum = result
        .filter(r => r.category !== null)
        .reduce((sum, r) => sum + (r.total as number), 0)

      expect(grandTotal).toBe(detailSum)
    })
  })

  describe('GROUPING SETS', () => {
    it('should compute specific groupings only', () => {
      const result = table.groupingSets({
        sets: [
          ['category', 'region'],
          ['category'],
          []
        ],
        measures: { total: { $sum: 'amount' } }
      })

      // Should have exactly the specified groupings
      const hasGrandTotal = result.some(r =>
        r.category === null && r.region === null
      )
      const hasCategoryOnly = result.some(r =>
        r.category !== null && r.region === null
      )

      expect(hasGrandTotal).toBe(true)
      expect(hasCategoryOnly).toBe(true)
    })
  })
})

// ============================================================================
// ClickHouseClient Integration Tests
// ============================================================================

describe('ClickHouseClient', () => {
  let client: ClickHouseClient

  beforeEach(() => {
    client = new ClickHouseClient({
      // In-memory mode for testing
      mode: 'memory'
    })
  })

  afterEach(async () => {
    await client.close()
  })

  describe('SQL Query Execution', () => {
    it('should execute CREATE TABLE', async () => {
      const result = await client.query(`
        CREATE TABLE hits (
          event_date Date,
          user_id UInt64,
          url String,
          views UInt32
        ) ENGINE = MergeTree()
        ORDER BY (event_date, user_id)
      `)

      expect(result.success).toBe(true)
    })

    it('should execute INSERT INTO', async () => {
      await client.query(`
        CREATE TABLE hits (
          event_date Date,
          user_id UInt64,
          url String,
          views UInt32
        ) ENGINE = MergeTree()
        ORDER BY (event_date, user_id)
      `)

      const result = await client.query(`
        INSERT INTO hits VALUES
        ('2024-01-01', 1, '/home', 10),
        ('2024-01-01', 2, '/products', 20)
      `)

      expect(result.rowsAffected).toBe(2)
    })

    it('should execute SELECT queries', async () => {
      await client.query(`
        CREATE TABLE hits (
          event_date Date,
          user_id UInt64,
          url String,
          views UInt32
        ) ENGINE = MergeTree()
        ORDER BY (event_date, user_id)
      `)

      await client.query(`
        INSERT INTO hits VALUES
        ('2024-01-01', 1, '/home', 10),
        ('2024-01-01', 2, '/products', 20),
        ('2024-01-02', 1, '/checkout', 5)
      `)

      const result = await client.query<{ url: string; views: number }>(`
        SELECT url, views FROM hits WHERE user_id = 1
      `)

      expect(result.rows).toHaveLength(2)
      expect(result.rows.map(r => r.url)).toContain('/home')
    })

    it('should execute aggregate queries', async () => {
      await client.query(`
        CREATE TABLE hits (
          event_date Date,
          user_id UInt64,
          browser String,
          views UInt32
        ) ENGINE = MergeTree()
        ORDER BY (event_date, user_id)
      `)

      await client.query(`
        INSERT INTO hits VALUES
        ('2024-01-01', 1, 'Chrome', 10),
        ('2024-01-01', 2, 'Chrome', 20),
        ('2024-01-01', 3, 'Firefox', 15)
      `)

      const result = await client.query<{ browser: string; total: number; cnt: number }>(`
        SELECT browser, sum(views) as total, count(*) as cnt
        FROM hits
        GROUP BY browser
        ORDER BY total DESC
      `)

      expect(result.rows).toHaveLength(2)
      expect(result.rows[0].browser).toBe('Chrome')
      expect(result.rows[0].total).toBe(30)
    })

    it('should support WITH clause (CTEs)', async () => {
      await client.query(`
        CREATE TABLE hits (
          user_id UInt64,
          views UInt32
        ) ENGINE = MergeTree()
        ORDER BY user_id
      `)

      await client.query(`
        INSERT INTO hits VALUES (1, 10), (1, 20), (2, 15)
      `)

      const result = await client.query<{ user_id: number; avg_views: number }>(`
        WITH user_totals AS (
          SELECT user_id, sum(views) as total_views
          FROM hits
          GROUP BY user_id
        )
        SELECT user_id, total_views / 2 as avg_views
        FROM user_totals
      `)

      expect(result.rows.length).toBeGreaterThan(0)
    })
  })

  describe('Query Statistics', () => {
    it('should provide execution statistics', async () => {
      await client.query(`
        CREATE TABLE test (id UInt64) ENGINE = MergeTree() ORDER BY id
      `)
      await client.query(`INSERT INTO test VALUES (1), (2), (3)`)

      const result = await client.query('SELECT * FROM test')

      expect(result.statistics).toBeDefined()
      expect(result.statistics?.rowsRead).toBe(3)
      expect(result.statistics?.elapsedMs).toBeGreaterThanOrEqual(0)
    })

    it('should report bytes processed', async () => {
      await client.query(`
        CREATE TABLE test (
          id UInt64,
          data String
        ) ENGINE = MergeTree() ORDER BY id
      `)
      await client.query(`INSERT INTO test VALUES (1, 'hello'), (2, 'world')`)

      const result = await client.query('SELECT * FROM test')

      expect(result.statistics?.bytesRead).toBeGreaterThan(0)
    })
  })

  describe('Error Handling', () => {
    it('should return error on invalid SQL syntax', async () => {
      const result = await client.query('SELEKT * FROM nonexistent')
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('should return error on unknown table', async () => {
      const result = await client.query('SELECT * FROM nonexistent')
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/not found/)
    })

    it('should return error on type mismatch', async () => {
      await client.query(`
        CREATE TABLE test (id UInt64) ENGINE = MergeTree() ORDER BY id
      `)

      const result = await client.query("INSERT INTO test VALUES ('not a number')")
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })
})

// ============================================================================
// ClickHouseEngine (Query Execution) Tests
// ============================================================================

describe('ClickHouseEngine', () => {
  let engine: ClickHouseEngine

  beforeEach(() => {
    engine = new ClickHouseEngine()
  })

  describe('Query Planning', () => {
    it('should use index for primary key predicates', () => {
      const table = new MergeTreeTable<HitsRow>({
        name: 'hits',
        engine: 'MergeTree',
        columns: [
          { name: 'event_date', type: 'Date' },
          { name: 'user_id', type: 'UInt64' },
        ],
        orderBy: ['event_date', 'user_id'],
      })

      const plan = engine.explain({
        table,
        where: { event_date: new Date('2024-01-01') }
      })

      expect(plan.indexUsed).toBe(true)
      expect(plan.estimatedRows).toBeLessThan(table.rowCount() || 1000)
    })

    it('should skip partitions not matching filter', () => {
      const table = new MergeTreeTable<HitsRow>({
        name: 'hits',
        engine: 'MergeTree',
        columns: [
          { name: 'event_date', type: 'Date' },
          { name: 'user_id', type: 'UInt64' },
        ],
        orderBy: ['event_date', 'user_id'],
        partitionBy: 'toYYYYMM(event_date)',
      })

      const plan = engine.explain({
        table,
        where: { event_date: { $gte: new Date('2024-01-01'), $lt: new Date('2024-02-01') } }
      })

      expect(plan.partitionsPruned).toBeGreaterThanOrEqual(0)
    })
  })

  describe('Columnar Operations', () => {
    it('should use vectorized execution for aggregates', () => {
      const table = new MergeTreeTable<HitsRow>({
        name: 'hits',
        engine: 'MergeTree',
        columns: [
          { name: 'views', type: 'UInt32' },
        ],
        orderBy: ['views'],
      })
      table.insertBatch(sampleHits)

      const result = engine.executeAggregate({
        table,
        aggregations: { sum: 'views' },
        useVectorized: true
      })

      expect(result.sum).toBe(75)
      expect(result._meta?.vectorized).toBe(true)
    })

    it('should compute vectorized average', () => {
      const values = [10, 20, 30, 40]
      const avg = engine.vectorizedAvg(values)
      expect(avg).toBe(25)
    })

    it('should compute vectorized stddev', () => {
      const values = [2, 4, 4, 4, 5, 5, 7, 9]
      const stddev = engine.vectorizedStddev(values)
      expect(stddev).toBeCloseTo(2, 1)
    })

    it('should batch aggregate multiple columns', () => {
      const table = new MergeTreeTable<HitsRow>({
        name: 'hits',
        engine: 'MergeTree',
        columns: [
          { name: 'views', type: 'UInt32' },
        ],
        orderBy: ['views'],
      })
      table.insertBatch(sampleHits)

      const result = engine.batchAggregate(table, [
        { column: 'views', function: 'sum' },
        { column: 'views', function: 'avg' },
        { column: 'views', function: 'count' },
      ])

      // sampleHits has 8 rows with views: 10, 5, 15, 8, 20, 3, 12, 2 = 75
      expect(result.sum_views).toBe(75)
      expect(result.avg_views).toBe(75 / 8) // 9.375
      expect(result.count_views).toBe(8)
    })

    it('should collect table statistics', () => {
      const table = new MergeTreeTable<HitsRow>({
        name: 'hits',
        engine: 'MergeTree',
        columns: [
          { name: 'views', type: 'UInt32' },
          { name: 'browser', type: 'String' },
        ],
        orderBy: ['views'],
      })
      table.insertBatch(sampleHits)

      const stats = engine.collectStatistics(table)

      expect(stats.rowCount).toBe(8)
      expect(stats.columnStats.get('views')).toBeDefined()
      expect(stats.columnStats.get('views')?.distinctCount).toBe(8)
      expect(stats.columnStats.get('views')?.min).toBe(2)
      expect(stats.columnStats.get('views')?.max).toBe(20)
    })
  })
})

// =============================================================================
// MaterializedView Tests
// =============================================================================

describe('MaterializedView', () => {
  it('should compute and cache aggregations', () => {
    const table = new MergeTreeTable<HitsRow>({
      name: 'hits',
      engine: 'MergeTree',
      columns: [
        { name: 'browser', type: 'String' },
        { name: 'views', type: 'UInt32' },
      ],
      orderBy: ['browser'],
    })
    table.insertBatch(sampleHits)

    const mv = new MaterializedView({
      name: 'hits_by_browser',
      source: table,
      aggregations: { sum: 'views', count: '*' },
      groupBy: ['browser'],
    })

    const results = mv.getResults()
    expect(results.length).toBe(3) // Chrome, Firefox, Safari

    const chrome = mv.get({ browser: 'Chrome' })
    expect(chrome?.sum).toBe(37) // 10 + 5 + 8 + 12 + 2 = 37 (but Chrome is 10, 8, 12, 2 = 32, wait no...)
    // Sample data: Chrome (10, 5, 8, 12, 2) but user_id 1,1,1,4,1 for URLs /home, /products, /home, /home, /about
    // Actually from the sample data:
    // Chrome: rows 0,1,3,6,7 -> views: 10, 5, 8, 12, 2 = 37

    const firefox = mv.get({ browser: 'Firefox' })
    expect(firefox?.sum).toBe(18) // rows 2,5 -> views: 15, 3 = 18
  })

  it('should detect staleness', async () => {
    const table = new MergeTreeTable<HitsRow>({
      name: 'hits',
      engine: 'MergeTree',
      columns: [
        { name: 'browser', type: 'String' },
        { name: 'views', type: 'UInt32' },
      ],
      orderBy: ['browser'],
    })
    table.insertBatch(sampleHits)

    const mv = new MaterializedView({
      name: 'hits_by_browser',
      source: table,
      aggregations: { sum: 'views' },
      groupBy: ['browser'],
    })

    // Should not be stale immediately
    expect(mv.isStale(1000)).toBe(false)

    // Wait and check staleness
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(mv.isStale(10)).toBe(true)
  })

  it('should refresh on demand', () => {
    const table = new MergeTreeTable<HitsRow>({
      name: 'hits',
      engine: 'MergeTree',
      columns: [
        { name: 'browser', type: 'String' },
        { name: 'views', type: 'UInt32' },
      ],
      orderBy: ['browser'],
    })
    table.insertBatch(sampleHits)

    const mv = new MaterializedView({
      name: 'hits_by_browser',
      source: table,
      aggregations: { sum: 'views' },
      groupBy: ['browser'],
    })

    let chrome = mv.get({ browser: 'Chrome' })
    expect(chrome?.sum).toBe(37) // Chrome views: 10+5+8+12+2 = 37

    // Insert more data
    table.insert({ browser: 'Chrome', views: 100 } as unknown as HitsRow)

    // Still cached
    chrome = mv.get({ browser: 'Chrome' })
    expect(chrome?.sum).toBe(37)

    // Refresh
    mv.refresh()

    chrome = mv.get({ browser: 'Chrome' })
    expect(chrome?.sum).toBe(137) // 37 + 100
  })

  it('should clean up timer on dispose', () => {
    const table = new MergeTreeTable<HitsRow>({
      name: 'hits',
      engine: 'MergeTree',
      columns: [
        { name: 'browser', type: 'String' },
        { name: 'views', type: 'UInt32' },
      ],
      orderBy: ['browser'],
    })

    const mv = new MaterializedView({
      name: 'hits_by_browser',
      source: table,
      aggregations: { sum: 'views' },
      groupBy: ['browser'],
      refreshInterval: 1000,
    })

    // Should not throw
    mv.dispose()
  })
})
