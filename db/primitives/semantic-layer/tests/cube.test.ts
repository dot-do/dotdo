/**
 * Cube.js-Compatible Schema Tests - TDD RED Phase
 *
 * Tests for the Cube.js-compatible schema definitions including:
 * - Cube schema definitions
 * - Measure definitions (sum, count, avg, percentile)
 * - Dimension definitions (time, categorical, derived)
 * - PreAggregation for materialized rollups
 * - SQL generation and validation
 *
 * @see dotdo-oi5zh
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  // Core cube factory
  createCube,
  CubeSchema,
  CubeBuilder,

  // Measure helpers
  measure,
  sumMeasure,
  countMeasure,
  avgMeasure,
  minMeasure,
  maxMeasure,
  countDistinctMeasure,
  percentileMeasure,
  runningTotalMeasure,
  customMeasure,

  // Dimension helpers
  dimension,
  timeDimension,
  categoricalDimension,
  numericDimension,
  booleanDimension,
  derivedDimension,
  geoDimension,

  // PreAggregation helpers
  preAggregation,
  rollup,
  originalSql,
  autoRollup,

  // Join helpers
  join,
  belongsTo,
  hasMany,
  hasOne,
  manyToMany,

  // Segment helpers
  segment,

  // Validation
  validateCubeSchema,
  CubeSchemaError,

  // SQL generation
  generateCubeSQL,
  generateMeasureSQL,
  generateDimensionSQL,
  generatePreAggregationSQL,

  // Types
  type CubeDefinition,
  type MeasureDefinition,
  type DimensionDefinition,
  type PreAggregationDefinition,
  type JoinDefinition,
  type SegmentDefinition,
  type SQLDialect,
} from '../cube'

// =============================================================================
// TEST FIXTURES
// =============================================================================

const ordersTableSQL = 'SELECT * FROM orders'

// =============================================================================
// CUBE SCHEMA CREATION TESTS
// =============================================================================

describe('CubeSchema', () => {
  describe('Basic Cube Creation', () => {
    it('should create a cube with minimal configuration', () => {
      const cube = createCube({
        name: 'Orders',
        sql: ordersTableSQL,
        measures: {
          count: countMeasure(),
        },
        dimensions: {
          id: dimension({ type: 'number', sql: 'id', primaryKey: true }),
        },
      })

      expect(cube).toBeDefined()
      expect(cube.name).toBe('Orders')
      expect(cube.sql).toBe(ordersTableSQL)
    })

    it('should create a cube using table shorthand', () => {
      const cube = createCube({
        name: 'Orders',
        sqlTable: 'orders',
        measures: {
          count: countMeasure(),
        },
        dimensions: {},
      })

      expect(cube.sql).toContain('orders')
    })

    it('should create a cube using sql function', () => {
      const cube = createCube({
        name: 'Orders',
        sql: () => `SELECT * FROM orders WHERE deleted_at IS NULL`,
        measures: {
          count: countMeasure(),
        },
        dimensions: {},
      })

      expect(cube.sql).toContain('deleted_at IS NULL')
    })

    it('should support extends to inherit from another cube', () => {
      const baseCube = createCube({
        name: 'BaseOrders',
        sql: ordersTableSQL,
        measures: {
          count: countMeasure(),
        },
        dimensions: {
          id: dimension({ type: 'number', sql: 'id', primaryKey: true }),
        },
      })

      const extendedCube = createCube({
        name: 'ExtendedOrders',
        extends: baseCube,
        measures: {
          revenue: sumMeasure({ sql: 'amount' }),
        },
      })

      expect(extendedCube.measures.count).toBeDefined()
      expect(extendedCube.measures.revenue).toBeDefined()
      expect(extendedCube.dimensions.id).toBeDefined()
    })

    it('should support dataSource configuration', () => {
      const cube = createCube({
        name: 'Orders',
        sql: ordersTableSQL,
        dataSource: 'warehouse',
        measures: { count: countMeasure() },
        dimensions: {},
      })

      expect(cube.dataSource).toBe('warehouse')
    })

    it('should support refreshKey configuration', () => {
      const cube = createCube({
        name: 'Orders',
        sql: ordersTableSQL,
        refreshKey: {
          every: '1 hour',
          sql: 'SELECT MAX(updated_at) FROM orders',
        },
        measures: { count: countMeasure() },
        dimensions: {},
      })

      expect(cube.refreshKey).toBeDefined()
      expect(cube.refreshKey?.every).toBe('1 hour')
    })

    it('should support description and title metadata', () => {
      const cube = createCube({
        name: 'Orders',
        sql: ordersTableSQL,
        title: 'Customer Orders',
        description: 'All customer orders from the e-commerce platform',
        measures: { count: countMeasure() },
        dimensions: {},
      })

      expect(cube.title).toBe('Customer Orders')
      expect(cube.description).toContain('e-commerce')
    })
  })

  describe('CubeBuilder Fluent API', () => {
    it('should build a cube using fluent API', () => {
      const cube = new CubeBuilder('Orders')
        .sql(ordersTableSQL)
        .measure('count', countMeasure())
        .measure('revenue', sumMeasure({ sql: 'amount' }))
        .dimension('status', categoricalDimension({ sql: 'status' }))
        .dimension('createdAt', timeDimension({ sql: 'created_at' }))
        .build()

      expect(cube.name).toBe('Orders')
      expect(cube.measures.count).toBeDefined()
      expect(cube.measures.revenue).toBeDefined()
      expect(cube.dimensions.status).toBeDefined()
      expect(cube.dimensions.createdAt).toBeDefined()
    })

    it('should support chaining with joins', () => {
      const cube = new CubeBuilder('Orders')
        .sql(ordersTableSQL)
        .measure('count', countMeasure())
        .dimension('id', numericDimension({ sql: 'id', primaryKey: true }))
        .join('Customers', belongsTo({
          sql: '${Orders}.customer_id = ${Customers}.id',
        }))
        .build()

      expect(cube.joins?.Customers).toBeDefined()
      expect(cube.joins?.Customers.relationship).toBe('belongsTo')
    })

    it('should support chaining with segments', () => {
      const cube = new CubeBuilder('Orders')
        .sql(ordersTableSQL)
        .measure('count', countMeasure())
        .dimension('status', categoricalDimension({ sql: 'status' }))
        .segment('completed', segment({ sql: `${CUBE}.status = 'completed'` }))
        .build()

      expect(cube.segments?.completed).toBeDefined()
    })

    it('should support chaining with preAggregations', () => {
      const cube = new CubeBuilder('Orders')
        .sql(ordersTableSQL)
        .measure('count', countMeasure())
        .measure('revenue', sumMeasure({ sql: 'amount' }))
        .dimension('status', categoricalDimension({ sql: 'status' }))
        .dimension('createdAt', timeDimension({ sql: 'created_at' }))
        .preAggregation('daily_status', rollup({
          measures: ['count', 'revenue'],
          dimensions: ['status'],
          timeDimension: 'createdAt',
          granularity: 'day',
        }))
        .build()

      expect(cube.preAggregations?.daily_status).toBeDefined()
    })
  })
})

// =============================================================================
// MEASURE TESTS
// =============================================================================

describe('Measure Definitions', () => {
  describe('Basic Aggregations', () => {
    it('should create a count measure', () => {
      const m = countMeasure()

      expect(m.type).toBe('count')
      expect(m.sql).toBeUndefined()
    })

    it('should create a count measure with filter', () => {
      const m = countMeasure({
        filters: [{ sql: `${CUBE}.status = 'completed'` }],
      })

      expect(m.type).toBe('count')
      expect(m.filters).toHaveLength(1)
    })

    it('should create a sum measure', () => {
      const m = sumMeasure({ sql: 'amount' })

      expect(m.type).toBe('sum')
      expect(m.sql).toBe('amount')
    })

    it('should create an avg measure', () => {
      const m = avgMeasure({ sql: 'amount' })

      expect(m.type).toBe('avg')
      expect(m.sql).toBe('amount')
    })

    it('should create a min measure', () => {
      const m = minMeasure({ sql: 'amount' })

      expect(m.type).toBe('min')
      expect(m.sql).toBe('amount')
    })

    it('should create a max measure', () => {
      const m = maxMeasure({ sql: 'amount' })

      expect(m.type).toBe('max')
      expect(m.sql).toBe('amount')
    })

    it('should create a countDistinct measure', () => {
      const m = countDistinctMeasure({ sql: 'customer_id' })

      expect(m.type).toBe('countDistinct')
      expect(m.sql).toBe('customer_id')
    })
  })

  describe('Percentile Measures', () => {
    it('should create a p50 percentile measure', () => {
      const m = percentileMeasure({ sql: 'response_time', percentile: 50 })

      expect(m.type).toBe('percentile')
      expect(m.percentile).toBe(50)
    })

    it('should create a p90 percentile measure', () => {
      const m = percentileMeasure({ sql: 'response_time', percentile: 90 })

      expect(m.type).toBe('percentile')
      expect(m.percentile).toBe(90)
    })

    it('should create a p95 percentile measure', () => {
      const m = percentileMeasure({ sql: 'response_time', percentile: 95 })

      expect(m.type).toBe('percentile')
      expect(m.percentile).toBe(95)
    })

    it('should create a p99 percentile measure', () => {
      const m = percentileMeasure({ sql: 'response_time', percentile: 99 })

      expect(m.type).toBe('percentile')
      expect(m.percentile).toBe(99)
    })

    it('should reject invalid percentile values', () => {
      expect(() => percentileMeasure({ sql: 'x', percentile: -1 })).toThrow()
      expect(() => percentileMeasure({ sql: 'x', percentile: 101 })).toThrow()
    })
  })

  describe('Custom and Derived Measures', () => {
    it('should create a custom SQL measure', () => {
      const m = customMeasure({
        sql: 'SUM(amount) / COUNT(DISTINCT customer_id)',
        type: 'number',
      })

      expect(m.type).toBe('number')
      expect(m.sql).toContain('SUM(amount)')
    })

    it('should create a running total measure', () => {
      const m = runningTotalMeasure({ sql: 'amount' })

      expect(m.type).toBe('runningTotal')
      expect(m.sql).toBe('amount')
    })

    it('should support measure with drill members', () => {
      const m = sumMeasure({
        sql: 'amount',
        drillMembers: ['id', 'createdAt', 'status'],
      })

      expect(m.drillMembers).toContain('id')
      expect(m.drillMembers).toContain('createdAt')
    })

    it('should support measure formatting', () => {
      const m = sumMeasure({
        sql: 'amount',
        format: 'currency',
      })

      expect(m.format).toBe('currency')
    })

    it('should support shown/hidden measures', () => {
      const m = sumMeasure({
        sql: 'internal_score',
        shown: false,
      })

      expect(m.shown).toBe(false)
    })
  })

  describe('Measure SQL Generation', () => {
    it('should generate count SQL', () => {
      const sql = generateMeasureSQL(countMeasure(), 'Orders', 'postgres')
      expect(sql).toBe('COUNT(*)')
    })

    it('should generate sum SQL', () => {
      const sql = generateMeasureSQL(
        sumMeasure({ sql: 'amount' }),
        'Orders',
        'postgres'
      )
      expect(sql).toBe('SUM(Orders.amount)')
    })

    it('should generate percentile SQL for Postgres', () => {
      const sql = generateMeasureSQL(
        percentileMeasure({ sql: 'response_time', percentile: 95 }),
        'Events',
        'postgres'
      )
      expect(sql).toContain('PERCENTILE_CONT')
      expect(sql).toContain('0.95')
    })

    it('should generate percentile SQL for ClickHouse', () => {
      const sql = generateMeasureSQL(
        percentileMeasure({ sql: 'response_time', percentile: 95 }),
        'Events',
        'clickhouse'
      )
      expect(sql).toContain('quantile')
    })

    it('should generate filtered count SQL', () => {
      const sql = generateMeasureSQL(
        countMeasure({ filters: [{ sql: `status = 'completed'` }] }),
        'Orders',
        'postgres'
      )
      expect(sql).toContain('FILTER')
      expect(sql).toContain('completed')
    })
  })
})

// =============================================================================
// DIMENSION TESTS
// =============================================================================

describe('Dimension Definitions', () => {
  describe('Time Dimensions', () => {
    it('should create a basic time dimension', () => {
      const d = timeDimension({ sql: 'created_at' })

      expect(d.type).toBe('time')
      expect(d.sql).toBe('created_at')
    })

    it('should support default granularity', () => {
      const d = timeDimension({
        sql: 'created_at',
        granularity: 'day',
      })

      expect(d.granularity).toBe('day')
    })

    it('should support all granularities', () => {
      const granularities = ['second', 'minute', 'hour', 'day', 'week', 'month', 'quarter', 'year']

      for (const g of granularities) {
        const d = timeDimension({ sql: 'ts', granularity: g as any })
        expect(d.granularity).toBe(g)
      }
    })

    it('should support timezone configuration', () => {
      const d = timeDimension({
        sql: 'created_at',
        timezone: 'America/New_York',
      })

      expect(d.timezone).toBe('America/New_York')
    })
  })

  describe('Categorical Dimensions', () => {
    it('should create a basic categorical dimension', () => {
      const d = categoricalDimension({ sql: 'status' })

      expect(d.type).toBe('string')
      expect(d.sql).toBe('status')
    })

    it('should support case insensitive matching', () => {
      const d = categoricalDimension({
        sql: 'category',
        caseInsensitive: true,
      })

      expect(d.caseInsensitive).toBe(true)
    })

    it('should support primaryKey flag', () => {
      const d = categoricalDimension({
        sql: 'id',
        primaryKey: true,
      })

      expect(d.primaryKey).toBe(true)
    })
  })

  describe('Numeric Dimensions', () => {
    it('should create a numeric dimension', () => {
      const d = numericDimension({ sql: 'quantity' })

      expect(d.type).toBe('number')
      expect(d.sql).toBe('quantity')
    })

    it('should support numeric dimension as primary key', () => {
      const d = numericDimension({
        sql: 'id',
        primaryKey: true,
      })

      expect(d.primaryKey).toBe(true)
    })
  })

  describe('Boolean Dimensions', () => {
    it('should create a boolean dimension', () => {
      const d = booleanDimension({ sql: 'is_active' })

      expect(d.type).toBe('boolean')
      expect(d.sql).toBe('is_active')
    })
  })

  describe('Derived Dimensions', () => {
    it('should create a derived dimension from expression', () => {
      const d = derivedDimension({
        sql: `CASE WHEN amount > 100 THEN 'high' ELSE 'low' END`,
        type: 'string',
      })

      expect(d.type).toBe('string')
      expect(d.sql).toContain('CASE')
    })

    it('should create a derived dimension referencing other dimensions', () => {
      const d = derivedDimension({
        sql: `CONCAT(${CUBE}.first_name, ' ', ${CUBE}.last_name)`,
        type: 'string',
      })

      expect(d.sql).toContain('CONCAT')
    })

    it('should create year extracted from time dimension', () => {
      const d = derivedDimension({
        sql: `EXTRACT(YEAR FROM ${CUBE}.created_at)`,
        type: 'number',
      })

      expect(d.type).toBe('number')
      expect(d.sql).toContain('EXTRACT')
    })
  })

  describe('Geo Dimensions', () => {
    it('should create a geo dimension', () => {
      const d = geoDimension({
        latitude: { sql: 'lat' },
        longitude: { sql: 'lng' },
      })

      expect(d.type).toBe('geo')
      expect(d.latitude?.sql).toBe('lat')
      expect(d.longitude?.sql).toBe('lng')
    })

    it('should create a geo dimension with single geojson column', () => {
      const d = geoDimension({
        sql: 'location',
      })

      expect(d.type).toBe('geo')
      expect(d.sql).toBe('location')
    })
  })

  describe('Dimension SQL Generation', () => {
    it('should generate time dimension SQL with granularity for Postgres', () => {
      const sql = generateDimensionSQL(
        timeDimension({ sql: 'created_at' }),
        'Orders',
        'postgres',
        { granularity: 'day' }
      )
      expect(sql).toContain('date_trunc')
      expect(sql).toContain('day')
    })

    it('should generate time dimension SQL for ClickHouse', () => {
      const sql = generateDimensionSQL(
        timeDimension({ sql: 'created_at' }),
        'Orders',
        'clickhouse',
        { granularity: 'day' }
      )
      expect(sql).toContain('toDate')
    })

    it('should generate time dimension SQL for DuckDB', () => {
      const sql = generateDimensionSQL(
        timeDimension({ sql: 'created_at' }),
        'Orders',
        'duckdb',
        { granularity: 'month' }
      )
      expect(sql).toContain('date_trunc')
    })

    it('should generate categorical dimension SQL', () => {
      const sql = generateDimensionSQL(
        categoricalDimension({ sql: 'status' }),
        'Orders',
        'postgres'
      )
      expect(sql).toBe('Orders.status')
    })

    it('should generate case insensitive categorical SQL', () => {
      const sql = generateDimensionSQL(
        categoricalDimension({ sql: 'email', caseInsensitive: true }),
        'Users',
        'postgres'
      )
      expect(sql).toContain('LOWER')
    })
  })
})

// =============================================================================
// PRE-AGGREGATION TESTS
// =============================================================================

describe('PreAggregation Definitions', () => {
  describe('Rollup PreAggregations', () => {
    it('should create a basic rollup', () => {
      const pa = rollup({
        measures: ['count', 'revenue'],
        dimensions: ['status'],
      })

      expect(pa.type).toBe('rollup')
      expect(pa.measures).toContain('count')
      expect(pa.dimensions).toContain('status')
    })

    it('should create a rollup with time dimension', () => {
      const pa = rollup({
        measures: ['count', 'revenue'],
        dimensions: ['status'],
        timeDimension: 'createdAt',
        granularity: 'day',
      })

      expect(pa.timeDimension).toBe('createdAt')
      expect(pa.granularity).toBe('day')
    })

    it('should create a partitioned rollup', () => {
      const pa = rollup({
        measures: ['count'],
        dimensions: ['status'],
        timeDimension: 'createdAt',
        granularity: 'day',
        partitionGranularity: 'month',
      })

      expect(pa.partitionGranularity).toBe('month')
    })

    it('should create a rollup with refresh key', () => {
      const pa = rollup({
        measures: ['count'],
        dimensions: ['status'],
        refreshKey: {
          every: '1 hour',
        },
      })

      expect(pa.refreshKey?.every).toBe('1 hour')
    })

    it('should create a rollup with incremental refresh', () => {
      const pa = rollup({
        measures: ['count'],
        dimensions: ['status'],
        timeDimension: 'createdAt',
        granularity: 'day',
        refreshKey: {
          every: '1 hour',
          incremental: true,
          updateWindow: '7 days',
        },
      })

      expect(pa.refreshKey?.incremental).toBe(true)
      expect(pa.refreshKey?.updateWindow).toBe('7 days')
    })

    it('should create a rollup with indexes', () => {
      const pa = rollup({
        measures: ['count'],
        dimensions: ['status', 'region'],
        indexes: {
          status_idx: { columns: ['status'] },
          region_idx: { columns: ['region'] },
        },
      })

      expect(pa.indexes?.status_idx).toBeDefined()
      expect(pa.indexes?.region_idx).toBeDefined()
    })
  })

  describe('Original SQL PreAggregations', () => {
    it('should create an original SQL pre-aggregation', () => {
      const pa = originalSql({
        refreshKey: {
          sql: 'SELECT MAX(updated_at) FROM orders',
        },
      })

      expect(pa.type).toBe('originalSql')
    })

    it('should create original SQL with external refresh', () => {
      const pa = originalSql({
        external: true,
        refreshKey: {
          every: '1 day',
        },
      })

      expect(pa.external).toBe(true)
    })
  })

  describe('Auto Rollup', () => {
    it('should create an auto rollup configuration', () => {
      const pa = autoRollup({
        maxPreAggregations: 20,
      })

      expect(pa.type).toBe('autoRollup')
      expect(pa.maxPreAggregations).toBe(20)
    })
  })

  describe('PreAggregation SQL Generation', () => {
    it('should generate CREATE TABLE SQL for rollup', () => {
      const cube = createCube({
        name: 'Orders',
        sql: ordersTableSQL,
        measures: {
          count: countMeasure(),
          revenue: sumMeasure({ sql: 'amount' }),
        },
        dimensions: {
          status: categoricalDimension({ sql: 'status' }),
          createdAt: timeDimension({ sql: 'created_at' }),
        },
        preAggregations: {
          daily_status: rollup({
            measures: ['count', 'revenue'],
            dimensions: ['status'],
            timeDimension: 'createdAt',
            granularity: 'day',
          }),
        },
      })

      const sql = generatePreAggregationSQL(
        cube,
        'daily_status',
        'postgres'
      )

      expect(sql).toContain('CREATE TABLE')
      expect(sql).toContain('COUNT(*)')
      expect(sql).toContain('SUM')
      expect(sql).toContain('date_trunc')
      expect(sql).toContain('GROUP BY')
    })

    it('should generate incremental refresh SQL', () => {
      const cube = createCube({
        name: 'Orders',
        sql: ordersTableSQL,
        measures: {
          count: countMeasure(),
        },
        dimensions: {
          createdAt: timeDimension({ sql: 'created_at' }),
        },
        preAggregations: {
          incremental_daily: rollup({
            measures: ['count'],
            dimensions: [],
            timeDimension: 'createdAt',
            granularity: 'day',
            refreshKey: {
              incremental: true,
              updateWindow: '3 days',
            },
          }),
        },
      })

      const sql = generatePreAggregationSQL(
        cube,
        'incremental_daily',
        'postgres',
        { incremental: true }
      )

      expect(sql).toContain('DELETE')
      expect(sql).toContain('INSERT')
      expect(sql).toContain('3 days')
    })
  })

  describe('PreAggregation Matching', () => {
    it('should match query to appropriate pre-aggregation', () => {
      const cube = createCube({
        name: 'Orders',
        sql: ordersTableSQL,
        measures: {
          count: countMeasure(),
          revenue: sumMeasure({ sql: 'amount' }),
        },
        dimensions: {
          status: categoricalDimension({ sql: 'status' }),
          createdAt: timeDimension({ sql: 'created_at' }),
        },
        preAggregations: {
          daily_status: rollup({
            measures: ['count', 'revenue'],
            dimensions: ['status'],
            timeDimension: 'createdAt',
            granularity: 'day',
          }),
        },
      })

      const match = cube.findPreAggregation({
        measures: ['count'],
        dimensions: ['status'],
        timeDimension: { dimension: 'createdAt', granularity: 'day' },
      })

      expect(match).toBe('daily_status')
    })

    it('should not match when measures are insufficient', () => {
      const cube = createCube({
        name: 'Orders',
        sql: ordersTableSQL,
        measures: {
          count: countMeasure(),
          revenue: sumMeasure({ sql: 'amount' }),
          avgValue: avgMeasure({ sql: 'amount' }),
        },
        dimensions: {
          status: categoricalDimension({ sql: 'status' }),
        },
        preAggregations: {
          status_count: rollup({
            measures: ['count'],
            dimensions: ['status'],
          }),
        },
      })

      const match = cube.findPreAggregation({
        measures: ['avgValue'], // Not in pre-agg
        dimensions: ['status'],
      })

      expect(match).toBeNull()
    })

    it('should match with coarser granularity', () => {
      const cube = createCube({
        name: 'Orders',
        sql: ordersTableSQL,
        measures: {
          count: countMeasure(),
        },
        dimensions: {
          createdAt: timeDimension({ sql: 'created_at' }),
        },
        preAggregations: {
          daily: rollup({
            measures: ['count'],
            dimensions: [],
            timeDimension: 'createdAt',
            granularity: 'day',
          }),
        },
      })

      // Week granularity can be served by day pre-agg (roll up days)
      const match = cube.findPreAggregation({
        measures: ['count'],
        dimensions: [],
        timeDimension: { dimension: 'createdAt', granularity: 'week' },
      })

      expect(match).toBe('daily')
    })
  })
})

// =============================================================================
// JOIN TESTS
// =============================================================================

describe('Join Definitions', () => {
  it('should create a belongsTo join', () => {
    const j = belongsTo({
      sql: '${Orders}.customer_id = ${Customers}.id',
    })

    expect(j.relationship).toBe('belongsTo')
  })

  it('should create a hasMany join', () => {
    const j = hasMany({
      sql: '${Customers}.id = ${Orders}.customer_id',
    })

    expect(j.relationship).toBe('hasMany')
  })

  it('should create a hasOne join', () => {
    const j = hasOne({
      sql: '${Users}.profile_id = ${Profiles}.id',
    })

    expect(j.relationship).toBe('hasOne')
  })

  it('should create a manyToMany join', () => {
    const j = manyToMany({
      sql: '${Products}.id = ${ProductTags}.product_id AND ${ProductTags}.tag_id = ${Tags}.id',
    })

    expect(j.relationship).toBe('manyToMany')
  })
})

// =============================================================================
// SEGMENT TESTS
// =============================================================================

describe('Segment Definitions', () => {
  it('should create a basic segment', () => {
    const s = segment({
      sql: `${CUBE}.status = 'completed'`,
    })

    expect(s.sql).toContain('completed')
  })

  it('should create a segment with complex condition', () => {
    const s = segment({
      sql: `${CUBE}.amount > 100 AND ${CUBE}.status IN ('completed', 'shipped')`,
    })

    expect(s.sql).toContain('amount > 100')
    expect(s.sql).toContain('shipped')
  })
})

// =============================================================================
// VALIDATION TESTS
// =============================================================================

describe('Cube Schema Validation', () => {
  it('should validate a correct cube schema', () => {
    const cube = createCube({
      name: 'Orders',
      sql: ordersTableSQL,
      measures: { count: countMeasure() },
      dimensions: { id: numericDimension({ sql: 'id', primaryKey: true }) },
    })

    expect(() => validateCubeSchema(cube)).not.toThrow()
  })

  it('should throw on missing name', () => {
    expect(() =>
      createCube({
        name: '',
        sql: ordersTableSQL,
        measures: { count: countMeasure() },
        dimensions: {},
      })
    ).toThrow(CubeSchemaError)
  })

  it('should throw on missing sql source', () => {
    expect(() =>
      createCube({
        name: 'Orders',
        sql: '',
        measures: { count: countMeasure() },
        dimensions: {},
      })
    ).toThrow(CubeSchemaError)
  })

  it('should throw on empty measures', () => {
    expect(() =>
      createCube({
        name: 'Orders',
        sql: ordersTableSQL,
        measures: {},
        dimensions: {},
      })
    ).toThrow(CubeSchemaError)
  })

  it('should throw on sum measure without sql', () => {
    expect(() =>
      createCube({
        name: 'Orders',
        sql: ordersTableSQL,
        measures: {
          revenue: { type: 'sum' } as any,
        },
        dimensions: {},
      })
    ).toThrow(CubeSchemaError)
  })

  it('should throw on dimension without sql', () => {
    expect(() =>
      createCube({
        name: 'Orders',
        sql: ordersTableSQL,
        measures: { count: countMeasure() },
        dimensions: {
          status: { type: 'string' } as any,
        },
      })
    ).toThrow(CubeSchemaError)
  })

  it('should throw on invalid measure type', () => {
    expect(() =>
      createCube({
        name: 'Orders',
        sql: ordersTableSQL,
        measures: {
          invalid: { type: 'invalid' as any, sql: 'x' },
        },
        dimensions: {},
      })
    ).toThrow(CubeSchemaError)
  })

  it('should throw on invalid dimension type', () => {
    expect(() =>
      createCube({
        name: 'Orders',
        sql: ordersTableSQL,
        measures: { count: countMeasure() },
        dimensions: {
          invalid: { type: 'invalid' as any, sql: 'x' },
        },
      })
    ).toThrow(CubeSchemaError)
  })

  it('should validate pre-aggregation references', () => {
    expect(() =>
      createCube({
        name: 'Orders',
        sql: ordersTableSQL,
        measures: { count: countMeasure() },
        dimensions: {},
        preAggregations: {
          invalid: rollup({
            measures: ['nonexistent'], // Does not exist
            dimensions: [],
          }),
        },
      })
    ).toThrow(CubeSchemaError)
  })

  it('should validate join references', () => {
    // Note: Join validation is typically done at runtime when both cubes are registered
    const cube = createCube({
      name: 'Orders',
      sql: ordersTableSQL,
      measures: { count: countMeasure() },
      dimensions: { customerId: categoricalDimension({ sql: 'customer_id' }) },
      joins: {
        Customers: belongsTo({
          sql: '${Orders}.customer_id = ${Customers}.id',
        }),
      },
    })

    expect(cube.joins?.Customers).toBeDefined()
  })
})

// =============================================================================
// FULL CUBE SQL GENERATION
// =============================================================================

describe('Full Cube SQL Generation', () => {
  it('should generate complete SQL for a semantic query', () => {
    const cube = createCube({
      name: 'Orders',
      sql: ordersTableSQL,
      measures: {
        count: countMeasure(),
        revenue: sumMeasure({ sql: 'amount' }),
      },
      dimensions: {
        status: categoricalDimension({ sql: 'status' }),
        createdAt: timeDimension({ sql: 'created_at' }),
      },
    })

    const sql = generateCubeSQL(cube, {
      measures: ['revenue', 'count'],
      dimensions: ['status'],
      timeDimensions: [{ dimension: 'createdAt', granularity: 'month' }],
      filters: [{ dimension: 'status', operator: 'equals', values: ['completed'] }],
      order: [{ id: 'revenue', desc: true }],
      limit: 100,
    }, 'postgres')

    expect(sql).toContain('SELECT')
    expect(sql).toContain('SUM')
    expect(sql).toContain('COUNT')
    expect(sql).toContain('date_trunc')
    expect(sql).toContain('GROUP BY')
    expect(sql).toContain('WHERE')
    expect(sql).toContain('completed')
    expect(sql).toContain('ORDER BY')
    expect(sql).toContain('DESC')
    expect(sql).toContain('LIMIT 100')
  })

  it('should generate SQL with joins', () => {
    // Create both cubes
    const ordersCube = createCube({
      name: 'Orders',
      sql: ordersTableSQL,
      measures: {
        count: countMeasure(),
        revenue: sumMeasure({ sql: 'amount' }),
      },
      dimensions: {
        status: categoricalDimension({ sql: 'status' }),
        customerId: categoricalDimension({ sql: 'customer_id' }),
      },
      joins: {
        Customers: belongsTo({
          sql: '${Orders}.customer_id = ${Customers}.id',
        }),
      },
    })

    const customersCube = createCube({
      name: 'Customers',
      sql: 'SELECT * FROM customers',
      measures: {
        count: countMeasure(),
      },
      dimensions: {
        id: categoricalDimension({ sql: 'id', primaryKey: true }),
        country: categoricalDimension({ sql: 'country' }),
      },
    })

    // Generate SQL that requires join
    const sql = generateCubeSQL(
      ordersCube,
      {
        measures: ['revenue'],
        dimensions: ['Customers.country'],
      },
      'postgres',
      { cubes: { Customers: customersCube } }
    )

    expect(sql).toContain('JOIN')
    expect(sql).toContain('Customers')
    expect(sql).toContain('country')
  })
})

// =============================================================================
// CUBE PLACEHOLDER CONSTANT
// =============================================================================

// This is used in SQL expressions to reference the current cube
const CUBE = '${CUBE}'
