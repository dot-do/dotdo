/**
 * @dotdo/cubejs - Semantic Layer Primitives Tests
 *
 * TDD tests for the composable, type-safe primitives for building
 * Cube.js-style semantic layers.
 *
 * Tests cover:
 * - Measure definitions (sum, count, avg, min, max, countDistinct)
 * - Percentile measures (p50, p90, p95, p99)
 * - Composite measures (derived from other measures)
 * - Measure formatting (currency, percentage, number)
 * - Dimension types (time, categorical, numeric, boolean, geo)
 * - Derived dimensions (computed from SQL)
 * - Dimension hierarchies
 * - Segment definitions
 * - Join helpers
 * - Pre-aggregation helpers
 * - Cube builder DSL
 */

import { describe, it, expect } from 'vitest'
import {
  // Measure primitives
  count,
  countDistinct,
  countDistinctApprox,
  sum,
  avg,
  min,
  max,
  runningTotal,
  number,
  percentile,
  median,
  p90,
  p95,
  p99,
  composite,
  customMeasure,

  // Dimension primitives
  time,
  categorical,
  string,
  numeric,
  boolean,
  geo,
  derived,

  // Hierarchy helpers
  hierarchy,
  expandHierarchy,

  // Time helpers
  TIME_GRANULARITIES,
  getTimeTruncSQL,

  // Segment helpers
  segment,

  // Join helpers
  belongsTo,
  hasMany,
  hasOne,

  // Pre-aggregation helpers
  rollup,
  originalSql,

  // Cube builder
  defineCube,

  // Formatting
  formatMeasureValue,

  // Types
  type Measure,
  type Dimension,
  type CubeSchema,
} from '../src/primitives'

// =============================================================================
// Measure Primitives Tests
// =============================================================================

describe('Measure Primitives', () => {
  describe('count()', () => {
    it('should create a count measure', () => {
      const measure = count()

      expect(measure.type).toBe('count')
      expect(measure.sql).toBeUndefined()
    })

    it('should accept options', () => {
      const measure = count({
        title: 'Total Orders',
        description: 'Number of orders',
        format: 'number',
      })

      expect(measure.title).toBe('Total Orders')
      expect(measure.description).toBe('Number of orders')
      expect(measure.format).toBe('number')
    })

    it('should support drill members', () => {
      const measure = count({
        drillMembers: ['id', 'createdAt', 'status'],
      })

      expect(measure.drillMembers).toEqual(['id', 'createdAt', 'status'])
    })

    it('should support rolling window', () => {
      const measure = count({
        rollingWindow: {
          trailing: '7 days',
          offset: 'start',
        },
      })

      expect(measure.rollingWindow?.trailing).toBe('7 days')
      expect(measure.rollingWindow?.offset).toBe('start')
    })

    it('should support filters', () => {
      const measure = count({
        filters: [{ sql: `status = 'completed'` }],
      })

      expect(measure.filters).toHaveLength(1)
      expect(measure.filters![0].sql).toBe(`status = 'completed'`)
    })
  })

  describe('countDistinct()', () => {
    it('should create a countDistinct measure', () => {
      const measure = countDistinct('customer_id')

      expect(measure.type).toBe('countDistinct')
      expect(measure.sql).toBe('customer_id')
    })

    it('should accept options', () => {
      const measure = countDistinct('customer_id', {
        title: 'Unique Customers',
      })

      expect(measure.title).toBe('Unique Customers')
    })
  })

  describe('countDistinctApprox()', () => {
    it('should create an approximate countDistinct measure', () => {
      const measure = countDistinctApprox('user_id')

      expect(measure.type).toBe('countDistinctApprox')
      expect(measure.sql).toBe('user_id')
    })
  })

  describe('sum()', () => {
    it('should create a sum measure', () => {
      const measure = sum('amount')

      expect(measure.type).toBe('sum')
      expect(measure.sql).toBe('amount')
      expect(measure.format).toBe('number') // Default format
    })

    it('should support currency format', () => {
      const measure = sum('amount', { format: 'currency' })

      expect(measure.format).toBe('currency')
    })

    it('should accept complex SQL expressions', () => {
      const measure = sum('price * quantity')

      expect(measure.sql).toBe('price * quantity')
    })
  })

  describe('avg()', () => {
    it('should create an avg measure', () => {
      const measure = avg('amount')

      expect(measure.type).toBe('avg')
      expect(measure.sql).toBe('amount')
    })

    it('should support percentage format', () => {
      const measure = avg('conversion_rate', { format: 'percent' })

      expect(measure.format).toBe('percent')
    })
  })

  describe('min()', () => {
    it('should create a min measure', () => {
      const measure = min('amount')

      expect(measure.type).toBe('min')
      expect(measure.sql).toBe('amount')
    })
  })

  describe('max()', () => {
    it('should create a max measure', () => {
      const measure = max('amount')

      expect(measure.type).toBe('max')
      expect(measure.sql).toBe('amount')
    })
  })

  describe('runningTotal()', () => {
    it('should create a running total measure', () => {
      const measure = runningTotal('amount')

      expect(measure.type).toBe('runningTotal')
      expect(measure.sql).toBe('amount')
    })
  })

  describe('number()', () => {
    it('should create a custom number measure', () => {
      const measure = number('COALESCE(amount, 0)')

      expect(measure.type).toBe('number')
      expect(measure.sql).toBe('COALESCE(amount, 0)')
    })
  })
})

// =============================================================================
// Percentile Measures Tests
// =============================================================================

describe('Percentile Measures', () => {
  describe('percentile()', () => {
    it('should create a percentile measure', () => {
      const measure = percentile('response_time', 50)

      expect(measure.type).toBe('number')
      expect(measure.sql).toContain('PERCENTILE_CONT')
      expect(measure.sql).toContain('0.5')
      expect(measure.meta?.percentileValue).toBe(50)
      expect(measure.meta?.isPercentile).toBe(true)
    })

    it('should support p90', () => {
      const measure = percentile('response_time', 90)

      expect(measure.sql).toContain('0.9')
      expect(measure.title).toBe('P90')
    })

    it('should support p95', () => {
      const measure = percentile('response_time', 95)

      expect(measure.sql).toContain('0.95')
      expect(measure.title).toBe('P95')
    })

    it('should support p99', () => {
      const measure = percentile('response_time', 99)

      expect(measure.sql).toContain('0.99')
      expect(measure.title).toBe('P99')
    })

    it('should throw for invalid percentile values', () => {
      expect(() => percentile('x', -1)).toThrow()
      expect(() => percentile('x', 101)).toThrow()
    })

    it('should accept custom options', () => {
      const measure = percentile('latency', 75, {
        title: 'P75 Latency',
        format: 'number',
      })

      expect(measure.title).toBe('P75 Latency')
      expect(measure.format).toBe('number')
    })
  })

  describe('median()', () => {
    it('should create a p50 (median) measure', () => {
      const measure = median('response_time')

      expect(measure.title).toBe('Median')
      expect(measure.meta?.percentileValue).toBe(50)
    })
  })

  describe('p90()', () => {
    it('should create a p90 measure', () => {
      const measure = p90('latency')

      expect(measure.meta?.percentileValue).toBe(90)
    })
  })

  describe('p95()', () => {
    it('should create a p95 measure', () => {
      const measure = p95('latency')

      expect(measure.meta?.percentileValue).toBe(95)
    })
  })

  describe('p99()', () => {
    it('should create a p99 measure', () => {
      const measure = p99('latency')

      expect(measure.meta?.percentileValue).toBe(99)
    })
  })
})

// =============================================================================
// Composite Measures Tests
// =============================================================================

describe('Composite Measures', () => {
  describe('composite()', () => {
    it('should create a composite measure', () => {
      const measure = composite(
        ({ revenue, count }) => `${revenue} / NULLIF(${count}, 0)`,
        ['revenue', 'count']
      )

      expect(measure.type).toBe('number')
      expect(measure.sql).toContain('${revenue}')
      expect(measure.sql).toContain('${count}')
      expect(measure.meta?.isComposite).toBe(true)
      expect(measure.meta?.dependencies).toEqual(['revenue', 'count'])
    })

    it('should support complex calculations', () => {
      const measure = composite(
        ({ totalRevenue, totalCost }) => `(${totalRevenue} - ${totalCost}) / NULLIF(${totalRevenue}, 0) * 100`,
        ['totalRevenue', 'totalCost'],
        { title: 'Profit Margin %', format: 'percent' }
      )

      expect(measure.title).toBe('Profit Margin %')
      expect(measure.format).toBe('percent')
      expect(measure.sql).toContain('totalRevenue')
      expect(measure.sql).toContain('totalCost')
    })

    it('should support single dependency', () => {
      const measure = composite(
        ({ count }) => `${count} * 1.1`,
        ['count'],
        { title: 'Adjusted Count' }
      )

      expect(measure.meta?.dependencies).toEqual(['count'])
    })
  })

  describe('customMeasure()', () => {
    it('should create a custom SQL measure', () => {
      const measure = customMeasure(
        `SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END)`
      )

      expect(measure.type).toBe('number')
      expect(measure.meta?.isCustom).toBe(true)
    })
  })
})

// =============================================================================
// Measure Formatting Tests
// =============================================================================

describe('Measure Formatting', () => {
  describe('formatMeasureValue()', () => {
    it('should format currency values', () => {
      const formatted = formatMeasureValue(1234.56, 'currency')

      expect(formatted).toBe('$1,234.56')
    })

    it('should format currency with custom locale and currency', () => {
      const formatted = formatMeasureValue(1234.56, 'currency', {
        locale: 'de-DE',
        currency: 'EUR',
      })

      // German format uses different separators
      expect(formatted).toContain('EUR') // or contains euro symbol
    })

    it('should format percent values', () => {
      const formatted = formatMeasureValue(75.5, 'percent')

      expect(formatted).toBe('75.50%')
    })

    it('should format number values', () => {
      const formatted = formatMeasureValue(1234567.89, 'number')

      expect(formatted).toBe('1,234,567.89')
    })

    it('should handle null values', () => {
      const formatted = formatMeasureValue(null, 'currency')

      expect(formatted).toBe('-')
    })

    it('should handle undefined values', () => {
      const formatted = formatMeasureValue(undefined, 'currency')

      expect(formatted).toBe('-')
    })

    it('should respect decimal places option', () => {
      const formatted = formatMeasureValue(1234.5678, 'number', { decimals: 4 })

      expect(formatted).toBe('1,234.5678')
    })
  })
})

// =============================================================================
// Dimension Primitives Tests
// =============================================================================

describe('Dimension Primitives', () => {
  describe('time()', () => {
    it('should create a time dimension', () => {
      const dimension = time('created_at')

      expect(dimension.type).toBe('time')
      expect(dimension.sql).toBe('created_at')
    })

    it('should accept options', () => {
      const dimension = time('created_at', {
        title: 'Created Date',
        description: 'When the order was created',
      })

      expect(dimension.title).toBe('Created Date')
      expect(dimension.description).toBe('When the order was created')
    })

    it('should support primary key', () => {
      const dimension = time('event_time', { primaryKey: true })

      expect(dimension.primaryKey).toBe(true)
    })
  })

  describe('categorical()', () => {
    it('should create a string dimension', () => {
      const dimension = categorical('status')

      expect(dimension.type).toBe('string')
      expect(dimension.sql).toBe('status')
      expect(dimension.caseInsensitiveMatch).toBe(true) // Default
    })

    it('should support case-sensitive matching', () => {
      const dimension = categorical('code', { caseInsensitiveMatch: false })

      expect(dimension.caseInsensitiveMatch).toBe(false)
    })
  })

  describe('string()', () => {
    it('should be an alias for categorical', () => {
      const dimension = string('name')

      expect(dimension.type).toBe('string')
    })
  })

  describe('numeric()', () => {
    it('should create a number dimension', () => {
      const dimension = numeric('amount')

      expect(dimension.type).toBe('number')
      expect(dimension.sql).toBe('amount')
    })
  })

  describe('boolean()', () => {
    it('should create a boolean dimension', () => {
      const dimension = boolean('is_active')

      expect(dimension.type).toBe('boolean')
      expect(dimension.sql).toBe('is_active')
    })
  })

  describe('geo()', () => {
    it('should create a geo dimension with lat/lng', () => {
      const dimension = geo({
        lat: 'latitude',
        lng: 'longitude',
      })

      expect(dimension.type).toBe('geo')
      expect(dimension.latitude?.sql).toBe('latitude')
      expect(dimension.longitude?.sql).toBe('longitude')
    })

    it('should accept title and other options', () => {
      const dimension = geo({
        lat: 'store_lat',
        lng: 'store_lng',
        title: 'Store Location',
      })

      expect(dimension.title).toBe('Store Location')
    })
  })

  describe('derived()', () => {
    it('should create a derived dimension', () => {
      const dimension = derived(`CONCAT(first_name, ' ', last_name)`)

      expect(dimension.type).toBe('string') // Default type
      expect(dimension.sql).toContain('CONCAT')
      expect(dimension.meta?.isDerived).toBe(true)
    })

    it('should support custom type', () => {
      const dimension = derived(`EXTRACT(YEAR FROM created_at)`, 'number')

      expect(dimension.type).toBe('number')
    })

    it('should support CASE expressions', () => {
      const dimension = derived(`
        CASE status
          WHEN 'pending' THEN 'Pending Review'
          WHEN 'approved' THEN 'Approved'
          ELSE 'Unknown'
        END
      `)

      expect(dimension.sql).toContain('CASE')
    })
  })
})

// =============================================================================
// Dimension Hierarchy Tests
// =============================================================================

describe('Dimension Hierarchies', () => {
  describe('hierarchy()', () => {
    it('should create a hierarchy definition', () => {
      const dateHierarchy = hierarchy('date', [
        { name: 'year', dimension: derived(`EXTRACT(YEAR FROM created_at)`, 'number') },
        { name: 'quarter', dimension: derived(`EXTRACT(QUARTER FROM created_at)`, 'number') },
        { name: 'month', dimension: derived(`EXTRACT(MONTH FROM created_at)`, 'number') },
        { name: 'day', dimension: derived(`EXTRACT(DAY FROM created_at)`, 'number') },
      ])

      expect(dateHierarchy.name).toBe('date')
      expect(dateHierarchy.levels).toHaveLength(4)
      expect(dateHierarchy.levels[0].name).toBe('year')
      expect(dateHierarchy.levels[3].name).toBe('day')
    })

    it('should support geographic hierarchies', () => {
      const geoHierarchy = hierarchy('location', [
        { name: 'country', dimension: categorical('country') },
        { name: 'region', dimension: categorical('region') },
        { name: 'city', dimension: categorical('city') },
      ])

      expect(geoHierarchy.levels).toHaveLength(3)
    })

    it('should support metadata', () => {
      const h = hierarchy('category', [
        { name: 'department', dimension: categorical('department') },
        { name: 'category', dimension: categorical('category') },
        { name: 'subcategory', dimension: categorical('subcategory') },
      ], { drillable: true })

      expect(h.meta?.drillable).toBe(true)
    })
  })

  describe('expandHierarchy()', () => {
    it('should expand hierarchy into flat dimensions', () => {
      const h = hierarchy('date', [
        { name: 'year', dimension: derived(`EXTRACT(YEAR FROM created_at)`, 'number') },
        { name: 'month', dimension: derived(`EXTRACT(MONTH FROM created_at)`, 'number') },
      ])

      const dimensions = expandHierarchy(h)

      expect(dimensions['date_year']).toBeDefined()
      expect(dimensions['date_month']).toBeDefined()
      expect(dimensions['date_year'].meta?.hierarchy).toBe('date')
      expect(dimensions['date_year'].meta?.hierarchyLevel).toBe(0)
      expect(dimensions['date_month'].meta?.hierarchyLevel).toBe(1)
    })

    it('should preserve dimension properties', () => {
      const h = hierarchy('location', [
        { name: 'country', dimension: categorical('country', { title: 'Country' }) },
      ])

      const dimensions = expandHierarchy(h)

      expect(dimensions['location_country'].title).toBe('Country')
    })
  })
})

// =============================================================================
// Time Granularity Tests
// =============================================================================

describe('Time Granularity', () => {
  describe('TIME_GRANULARITIES', () => {
    it('should include all standard granularities', () => {
      expect(TIME_GRANULARITIES).toContain('second')
      expect(TIME_GRANULARITIES).toContain('minute')
      expect(TIME_GRANULARITIES).toContain('hour')
      expect(TIME_GRANULARITIES).toContain('day')
      expect(TIME_GRANULARITIES).toContain('week')
      expect(TIME_GRANULARITIES).toContain('month')
      expect(TIME_GRANULARITIES).toContain('quarter')
      expect(TIME_GRANULARITIES).toContain('year')
    })
  })

  describe('getTimeTruncSQL()', () => {
    describe('PostgreSQL dialect', () => {
      it('should generate date_trunc for day', () => {
        const sql = getTimeTruncSQL('created_at', 'day', 'postgres')
        expect(sql).toBe(`date_trunc('day', created_at)`)
      })

      it('should generate date_trunc for month', () => {
        const sql = getTimeTruncSQL('created_at', 'month', 'postgres')
        expect(sql).toBe(`date_trunc('month', created_at)`)
      })

      it('should generate date_trunc for year', () => {
        const sql = getTimeTruncSQL('created_at', 'year', 'postgres')
        expect(sql).toBe(`date_trunc('year', created_at)`)
      })
    })

    describe('ClickHouse dialect', () => {
      it('should generate toDate for day', () => {
        const sql = getTimeTruncSQL('created_at', 'day', 'clickhouse')
        expect(sql).toBe('toDate(created_at)')
      })

      it('should generate toStartOfMonth for month', () => {
        const sql = getTimeTruncSQL('created_at', 'month', 'clickhouse')
        expect(sql).toBe('toStartOfMonth(created_at)')
      })

      it('should generate toStartOfYear for year', () => {
        const sql = getTimeTruncSQL('created_at', 'year', 'clickhouse')
        expect(sql).toBe('toStartOfYear(created_at)')
      })

      it('should generate toStartOfQuarter for quarter', () => {
        const sql = getTimeTruncSQL('created_at', 'quarter', 'clickhouse')
        expect(sql).toBe('toStartOfQuarter(created_at)')
      })
    })

    describe('DuckDB dialect', () => {
      it('should use date_trunc like PostgreSQL', () => {
        const sql = getTimeTruncSQL('created_at', 'day', 'duckdb')
        expect(sql).toBe(`date_trunc('day', created_at)`)
      })
    })

    describe('SQLite dialect', () => {
      it('should use strftime for day', () => {
        const sql = getTimeTruncSQL('created_at', 'day', 'sqlite')
        expect(sql).toBe('date(created_at)')
      })

      it('should use strftime for month', () => {
        const sql = getTimeTruncSQL('created_at', 'month', 'sqlite')
        expect(sql).toContain('strftime')
      })
    })

    describe('MySQL dialect', () => {
      it('should use DATE for day', () => {
        const sql = getTimeTruncSQL('created_at', 'day', 'mysql')
        expect(sql).toBe('DATE(created_at)')
      })

      it('should use DATE_FORMAT for month', () => {
        const sql = getTimeTruncSQL('created_at', 'month', 'mysql')
        expect(sql).toContain('DATE_FORMAT')
      })
    })
  })
})

// =============================================================================
// Segment Tests
// =============================================================================

describe('Segment Primitives', () => {
  describe('segment()', () => {
    it('should create a segment', () => {
      const seg = segment(`status = 'completed'`)

      expect(seg.sql).toBe(`status = 'completed'`)
    })

    it('should accept title and description', () => {
      const seg = segment(`amount > 1000`, {
        title: 'High Value Orders',
        description: 'Orders with amount greater than $1000',
      })

      expect(seg.title).toBe('High Value Orders')
      expect(seg.description).toBe('Orders with amount greater than $1000')
    })

    it('should support complex SQL conditions', () => {
      const seg = segment(`
        status = 'completed'
        AND amount > 100
        AND created_at >= CURRENT_DATE - INTERVAL '30 days'
      `)

      expect(seg.sql).toContain('AND')
    })
  })
})

// =============================================================================
// Join Primitives Tests
// =============================================================================

describe('Join Primitives', () => {
  describe('belongsTo()', () => {
    it('should create a belongsTo join', () => {
      const join = belongsTo('${CUBE}.customer_id = ${Customers}.id')

      expect(join.relationship).toBe('belongsTo')
      expect(join.sql).toContain('customer_id')
    })
  })

  describe('hasMany()', () => {
    it('should create a hasMany join', () => {
      const join = hasMany('${CUBE}.id = ${Orders}.customer_id')

      expect(join.relationship).toBe('hasMany')
    })
  })

  describe('hasOne()', () => {
    it('should create a hasOne join', () => {
      const join = hasOne('${CUBE}.id = ${Profile}.user_id')

      expect(join.relationship).toBe('hasOne')
    })
  })
})

// =============================================================================
// Pre-aggregation Primitives Tests
// =============================================================================

describe('Pre-aggregation Primitives', () => {
  describe('rollup()', () => {
    it('should create a rollup pre-aggregation', () => {
      const preAgg = rollup({
        measures: ['count', 'totalAmount'],
        dimensions: ['status'],
        timeDimension: 'createdAt',
        granularity: 'day',
      })

      expect(preAgg.type).toBe('rollup')
      expect(preAgg.measureReferences).toEqual(['count', 'totalAmount'])
      expect(preAgg.dimensionReferences).toEqual(['status'])
      expect(preAgg.timeDimensionReference).toBe('createdAt')
      expect(preAgg.granularity).toBe('day')
    })

    it('should support refresh key', () => {
      const preAgg = rollup({
        measures: ['count'],
        granularity: 'day',
        refreshKey: {
          every: '1 hour',
          incremental: true,
          updateWindow: '7 days',
        },
      })

      expect(preAgg.refreshKey?.every).toBe('1 hour')
      expect(preAgg.refreshKey?.incremental).toBe(true)
    })

    it('should support partition granularity', () => {
      const preAgg = rollup({
        measures: ['count'],
        timeDimension: 'createdAt',
        granularity: 'day',
        partitionGranularity: 'month',
      })

      expect(preAgg.partitionGranularity).toBe('month')
    })

    it('should support indexes', () => {
      const preAgg = rollup({
        measures: ['count'],
        dimensions: ['status', 'region'],
        indexes: {
          main: { columns: ['status', 'region'] },
        },
      })

      expect(preAgg.indexes?.main.columns).toEqual(['status', 'region'])
    })
  })

  describe('originalSql()', () => {
    it('should create an originalSql pre-aggregation', () => {
      const preAgg = originalSql({
        refreshKey: { every: '1 hour' },
      })

      expect(preAgg.type).toBe('originalSql')
      expect(preAgg.refreshKey?.every).toBe('1 hour')
    })

    it('should support external storage', () => {
      const preAgg = originalSql({
        external: true,
        scheduledRefresh: true,
      })

      expect(preAgg.external).toBe(true)
      expect(preAgg.scheduledRefresh).toBe(true)
    })
  })
})

// =============================================================================
// Cube Builder Tests
// =============================================================================

describe('Cube Builder DSL', () => {
  describe('defineCube()', () => {
    it('should create a cube schema with primitives', () => {
      const Orders = defineCube('Orders', {
        sql: `SELECT * FROM orders`,

        measures: {
          count: count(),
          revenue: sum('amount', { format: 'currency' }),
          avgOrderValue: avg('amount'),
        },

        dimensions: {
          createdAt: time('created_at'),
          status: categorical('status'),
        },
      })

      expect(Orders.name).toBe('Orders')
      expect(Orders.sql).toBe('SELECT * FROM orders')
      expect(Orders.measures.count.type).toBe('count')
      expect(Orders.measures.revenue.type).toBe('sum')
      expect(Orders.measures.revenue.format).toBe('currency')
      expect(Orders.dimensions.createdAt.type).toBe('time')
      expect(Orders.dimensions.status.type).toBe('string')
    })

    it('should support sql function for dynamic SQL', () => {
      const Orders = defineCube('Orders', {
        sql: () => `SELECT * FROM ${process.env.SCHEMA || 'public'}.orders`,
        measures: { count: count() },
        dimensions: {},
      })

      expect(Orders.sql).toContain('SELECT * FROM')
    })

    it('should support joins', () => {
      const Orders = defineCube('Orders', {
        sql: 'SELECT * FROM orders',
        measures: { count: count() },
        dimensions: { customerId: numeric('customer_id') },
        joins: {
          Customers: belongsTo('${CUBE}.customer_id = ${Customers}.id'),
        },
      })

      expect(Orders.joins?.Customers.relationship).toBe('belongsTo')
    })

    it('should support pre-aggregations', () => {
      const Orders = defineCube('Orders', {
        sql: 'SELECT * FROM orders',
        measures: {
          count: count(),
          revenue: sum('amount'),
        },
        dimensions: {
          createdAt: time('created_at'),
          status: categorical('status'),
        },
        preAggregations: {
          ordersDaily: rollup({
            measures: ['count', 'revenue'],
            dimensions: ['status'],
            timeDimension: 'createdAt',
            granularity: 'day',
          }),
        },
      })

      expect(Orders.preAggregations?.ordersDaily.type).toBe('rollup')
    })

    it('should support segments', () => {
      const Orders = defineCube('Orders', {
        sql: 'SELECT * FROM orders',
        measures: { count: count() },
        dimensions: {},
        segments: {
          completedOrders: segment(`status = 'completed'`),
          highValueOrders: segment(`amount > 1000`),
        },
      })

      expect(Orders.segments?.completedOrders.sql).toContain('completed')
      expect(Orders.segments?.highValueOrders.sql).toContain('1000')
    })

    it('should support all cube options', () => {
      const Orders = defineCube('Orders', {
        sql: 'SELECT * FROM orders',
        sqlTable: 'orders',
        title: 'Orders Cube',
        description: 'Order analytics',
        measures: { count: count() },
        dimensions: {},
        dataSource: 'warehouse',
        shown: true,
        rewriteQueries: true,
        refreshKey: { every: '1 hour' },
        contextMembers: ['tenantId'],
        meta: { category: 'sales' },
      })

      expect(Orders.title).toBe('Orders Cube')
      expect(Orders.description).toBe('Order analytics')
      expect(Orders.dataSource).toBe('warehouse')
      expect(Orders.shown).toBe(true)
      expect(Orders.rewriteQueries).toBe(true)
      expect(Orders.refreshKey?.every).toBe('1 hour')
      expect(Orders.contextMembers).toContain('tenantId')
      expect(Orders.meta?.category).toBe('sales')
    })

    it('should support percentile measures', () => {
      const Performance = defineCube('Performance', {
        sql: 'SELECT * FROM performance_metrics',
        measures: {
          medianResponseTime: median('response_time'),
          p95ResponseTime: p95('response_time'),
          p99ResponseTime: p99('response_time'),
        },
        dimensions: {
          endpoint: categorical('endpoint'),
        },
      })

      expect(Performance.measures.medianResponseTime.meta?.percentileValue).toBe(50)
      expect(Performance.measures.p95ResponseTime.meta?.percentileValue).toBe(95)
    })

    it('should support composite measures', () => {
      const Sales = defineCube('Sales', {
        sql: 'SELECT * FROM sales',
        measures: {
          totalRevenue: sum('revenue'),
          totalCost: sum('cost'),
          profitMargin: composite(
            ({ totalRevenue, totalCost }) =>
              `(${totalRevenue} - ${totalCost}) / NULLIF(${totalRevenue}, 0) * 100`,
            ['totalRevenue', 'totalCost'],
            { title: 'Profit Margin %', format: 'percent' }
          ),
        },
        dimensions: {},
      })

      expect(Sales.measures.profitMargin.meta?.isComposite).toBe(true)
      expect(Sales.measures.profitMargin.meta?.dependencies).toEqual(['totalRevenue', 'totalCost'])
    })

    it('should support geo dimensions', () => {
      const Stores = defineCube('Stores', {
        sql: 'SELECT * FROM stores',
        measures: { count: count() },
        dimensions: {
          location: geo({ lat: 'latitude', lng: 'longitude', title: 'Location' }),
          region: categorical('region'),
        },
      })

      expect(Stores.dimensions.location.type).toBe('geo')
      expect(Stores.dimensions.location.latitude?.sql).toBe('latitude')
      expect(Stores.dimensions.location.longitude?.sql).toBe('longitude')
    })

    it('should support derived dimensions', () => {
      const Users = defineCube('Users', {
        sql: 'SELECT * FROM users',
        measures: { count: count() },
        dimensions: {
          fullName: derived(`CONCAT(first_name, ' ', last_name)`),
          ageGroup: derived(`
            CASE
              WHEN age < 18 THEN 'Under 18'
              WHEN age < 35 THEN '18-34'
              WHEN age < 55 THEN '35-54'
              ELSE '55+'
            END
          `),
        },
      })

      expect(Users.dimensions.fullName.meta?.isDerived).toBe(true)
      expect(Users.dimensions.ageGroup.sql).toContain('CASE')
    })
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('Integration', () => {
  it('should create a complete e-commerce analytics cube', () => {
    const Orders = defineCube('Orders', {
      sql: 'SELECT * FROM orders',
      title: 'Orders',
      description: 'E-commerce order analytics',

      measures: {
        count: count({ title: 'Order Count' }),
        totalRevenue: sum('amount', { title: 'Total Revenue', format: 'currency' }),
        avgOrderValue: avg('amount', { title: 'AOV', format: 'currency' }),
        medianOrderValue: median('amount', { title: 'Median Order Value' }),
        uniqueCustomers: countDistinct('customer_id', { title: 'Unique Customers' }),
        revenuePerCustomer: composite(
          ({ totalRevenue, uniqueCustomers }) =>
            `${totalRevenue} / NULLIF(${uniqueCustomers}, 0)`,
          ['totalRevenue', 'uniqueCustomers'],
          { title: 'Revenue per Customer', format: 'currency' }
        ),
      },

      dimensions: {
        id: numeric('id', { primaryKey: true }),
        createdAt: time('created_at', { title: 'Order Date' }),
        status: categorical('status', { title: 'Order Status' }),
        customerId: numeric('customer_id'),
        region: categorical('region'),
        isHighValue: derived(`amount > 1000`, 'boolean', { title: 'High Value Order' }),
      },

      segments: {
        completed: segment(`status = 'completed'`, { title: 'Completed Orders' }),
        highValue: segment(`amount > 1000`, { title: 'High Value Orders' }),
      },

      joins: {
        Customers: belongsTo('${CUBE}.customer_id = ${Customers}.id'),
      },

      preAggregations: {
        daily: rollup({
          measures: ['count', 'totalRevenue'],
          dimensions: ['status', 'region'],
          timeDimension: 'createdAt',
          granularity: 'day',
          refreshKey: { every: '1 hour' },
        }),
      },
    })

    // Verify cube structure
    expect(Orders.name).toBe('Orders')
    expect(Object.keys(Orders.measures)).toHaveLength(6)
    expect(Object.keys(Orders.dimensions)).toHaveLength(6)
    expect(Object.keys(Orders.segments!)).toHaveLength(2)
    expect(Object.keys(Orders.joins!)).toHaveLength(1)
    expect(Object.keys(Orders.preAggregations!)).toHaveLength(1)

    // Verify types
    expect(Orders.measures.count.type).toBe('count')
    expect(Orders.measures.totalRevenue.type).toBe('sum')
    expect(Orders.measures.medianOrderValue.meta?.isPercentile).toBe(true)
    expect(Orders.measures.revenuePerCustomer.meta?.isComposite).toBe(true)

    expect(Orders.dimensions.createdAt.type).toBe('time')
    expect(Orders.dimensions.status.type).toBe('string')
    expect(Orders.dimensions.isHighValue.type).toBe('boolean')
    expect(Orders.dimensions.isHighValue.meta?.isDerived).toBe(true)
  })
})
