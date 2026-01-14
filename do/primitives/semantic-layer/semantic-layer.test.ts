/**
 * SemanticLayer Tests - TDD RED Phase
 *
 * Tests for the SemanticLayer primitive that provides business metrics and dimensions
 * as a consistent abstraction layer for analytics and business intelligence.
 *
 * @see dotdo-oi5zh
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  SemanticLayer,
  Cube,
  Metric,
  Dimension,
  PreAggregation,
  type CubeDefinition,
  type MetricDefinition,
  type DimensionDefinition,
  type SemanticQuery,
  type QueryResult,
  type PreAggregationDefinition,
  type FilterOperator,
  type JoinRelationship,
  type DimensionType,
  type MetricType,
  type Granularity,
  // Errors
  SemanticLayerError,
  CubeNotFoundError,
  InvalidQueryError,
  CacheError,
} from './index'

// =============================================================================
// TEST DATA FIXTURES
// =============================================================================

const ordersCubeDefinition: CubeDefinition = {
  name: 'orders',
  sql: 'SELECT * FROM orders',

  measures: {
    count: { type: 'count' },
    totalRevenue: { type: 'sum', sql: 'amount' },
    avgOrderValue: { type: 'avg', sql: 'amount' },
    uniqueCustomers: { type: 'countDistinct', sql: 'customer_id' },
    minAmount: { type: 'min', sql: 'amount' },
    maxAmount: { type: 'max', sql: 'amount' },
    customMetric: {
      type: 'custom',
      sql: 'SUM(amount) / COUNT(DISTINCT customer_id)',
    },
  },

  dimensions: {
    status: { type: 'string', sql: 'status' },
    createdAt: { type: 'time', sql: 'created_at' },
    customerId: { type: 'string', sql: 'customer_id' },
    region: { type: 'string', sql: 'region' },
    amount: { type: 'number', sql: 'amount' },
  },

  joins: [
    {
      name: 'customers',
      relationship: 'belongsTo' as JoinRelationship,
      sql: '${orders}.customer_id = ${customers}.id',
    },
  ],
}

const customersCubeDefinition: CubeDefinition = {
  name: 'customers',
  sql: 'SELECT * FROM customers',

  measures: {
    count: { type: 'count' },
  },

  dimensions: {
    id: { type: 'string', sql: 'id' },
    name: { type: 'string', sql: 'name' },
    country: { type: 'string', sql: 'country' },
    tier: { type: 'string', sql: 'tier' },
    createdAt: { type: 'time', sql: 'created_at' },
  },

  joins: [
    {
      name: 'orders',
      relationship: 'hasMany' as JoinRelationship,
      sql: '${customers}.id = ${orders}.customer_id',
    },
  ],
}

// =============================================================================
// CORE SEMANTIC LAYER TESTS
// =============================================================================

describe('SemanticLayer', () => {
  let semantic: SemanticLayer

  beforeEach(() => {
    semantic = new SemanticLayer()
  })

  describe('Constructor and Basic Setup', () => {
    it('should create a new SemanticLayer instance', () => {
      expect(semantic).toBeInstanceOf(SemanticLayer)
    })

    it('should accept configuration options', () => {
      const semanticWithConfig = new SemanticLayer({
        sqlDialect: 'postgres',
        schemaPath: '/schemas',
      })
      expect(semanticWithConfig).toBeInstanceOf(SemanticLayer)
    })

    it('should have empty cubes by default', () => {
      expect(semantic.getCubes()).toEqual([])
    })
  })

  describe('Cube Definition', () => {
    it('should define a cube with measures and dimensions', () => {
      semantic.defineCube(ordersCubeDefinition)

      const cubes = semantic.getCubes()
      expect(cubes).toHaveLength(1)
      expect(cubes[0]?.name).toBe('orders')
    })

    it('should define multiple cubes', () => {
      semantic.defineCube(ordersCubeDefinition)
      semantic.defineCube(customersCubeDefinition)

      const cubes = semantic.getCubes()
      expect(cubes).toHaveLength(2)
    })

    it('should retrieve a cube by name', () => {
      semantic.defineCube(ordersCubeDefinition)

      const cube = semantic.getCube('orders')
      expect(cube).toBeDefined()
      expect(cube?.name).toBe('orders')
    })

    it('should return undefined for non-existent cube', () => {
      const cube = semantic.getCube('nonexistent')
      expect(cube).toBeUndefined()
    })

    it('should throw when defining duplicate cube name', () => {
      semantic.defineCube(ordersCubeDefinition)

      expect(() => semantic.defineCube(ordersCubeDefinition)).toThrow(
        SemanticLayerError
      )
    })

    it('should validate cube definition has required fields', () => {
      expect(() =>
        semantic.defineCube({
          name: '',
          sql: 'SELECT * FROM table',
          measures: {},
          dimensions: {},
        })
      ).toThrow(SemanticLayerError)
    })

    it('should store joins configuration', () => {
      semantic.defineCube(ordersCubeDefinition)

      const cube = semantic.getCube('orders')
      expect(cube?.joins).toHaveLength(1)
      expect(cube?.joins?.[0]?.name).toBe('customers')
    })
  })
})

// =============================================================================
// METRIC TESTS
// =============================================================================

describe('Metrics', () => {
  let semantic: SemanticLayer

  beforeEach(() => {
    semantic = new SemanticLayer()
    semantic.defineCube(ordersCubeDefinition)
  })

  describe('Metric Types', () => {
    it('should support count metric', () => {
      const cube = semantic.getCube('orders')
      expect(cube?.measures.count).toBeDefined()
      expect(cube?.measures.count?.type).toBe('count')
    })

    it('should support sum metric with sql reference', () => {
      const cube = semantic.getCube('orders')
      expect(cube?.measures.totalRevenue?.type).toBe('sum')
      expect(cube?.measures.totalRevenue?.sql).toBe('amount')
    })

    it('should support avg metric', () => {
      const cube = semantic.getCube('orders')
      expect(cube?.measures.avgOrderValue?.type).toBe('avg')
    })

    it('should support countDistinct metric', () => {
      const cube = semantic.getCube('orders')
      expect(cube?.measures.uniqueCustomers?.type).toBe('countDistinct')
    })

    it('should support min metric', () => {
      const cube = semantic.getCube('orders')
      expect(cube?.measures.minAmount?.type).toBe('min')
    })

    it('should support max metric', () => {
      const cube = semantic.getCube('orders')
      expect(cube?.measures.maxAmount?.type).toBe('max')
    })

    it('should support custom SQL metric', () => {
      const cube = semantic.getCube('orders')
      expect(cube?.measures.customMetric?.type).toBe('custom')
      expect(cube?.measures.customMetric?.sql).toContain('SUM(amount)')
    })
  })

  describe('Metric Validation', () => {
    it('should validate metric type is supported', () => {
      expect(() =>
        semantic.defineCube({
          name: 'invalid',
          sql: 'SELECT * FROM table',
          measures: {
            bad: { type: 'unsupported' as MetricType, sql: 'col' },
          },
          dimensions: {},
        })
      ).toThrow(SemanticLayerError)
    })

    it('should require sql for non-count metrics', () => {
      expect(() =>
        semantic.defineCube({
          name: 'invalid',
          sql: 'SELECT * FROM table',
          measures: {
            noSql: { type: 'sum' }, // Missing sql
          },
          dimensions: {},
        })
      ).toThrow(SemanticLayerError)
    })
  })
})

// =============================================================================
// DIMENSION TESTS
// =============================================================================

describe('Dimensions', () => {
  let semantic: SemanticLayer

  beforeEach(() => {
    semantic = new SemanticLayer()
    semantic.defineCube(ordersCubeDefinition)
    semantic.defineCube(customersCubeDefinition)
  })

  describe('Dimension Types', () => {
    it('should support string dimension', () => {
      const cube = semantic.getCube('orders')
      expect(cube?.dimensions.status?.type).toBe('string')
    })

    it('should support time dimension', () => {
      const cube = semantic.getCube('orders')
      expect(cube?.dimensions.createdAt?.type).toBe('time')
    })

    it('should support number dimension', () => {
      const cube = semantic.getCube('orders')
      expect(cube?.dimensions.amount?.type).toBe('number')
    })
  })

  describe('Time Dimension Granularity', () => {
    it('should generate granularity variants for time dimensions', () => {
      const cube = semantic.getCube('orders')
      const timeDim = cube?.dimensions.createdAt

      expect(timeDim?.type).toBe('time')
      // Time dimensions should support granularity queries
    })
  })

  describe('Dimension Validation', () => {
    it('should validate dimension type is supported', () => {
      expect(() =>
        semantic.defineCube({
          name: 'invalid',
          sql: 'SELECT * FROM table',
          measures: {},
          dimensions: {
            bad: { type: 'unsupported' as DimensionType, sql: 'col' },
          },
        })
      ).toThrow(SemanticLayerError)
    })

    it('should require sql for dimensions', () => {
      expect(() =>
        semantic.defineCube({
          name: 'invalid',
          sql: 'SELECT * FROM table',
          measures: {},
          dimensions: {
            noSql: { type: 'string' } as DimensionDefinition, // Missing sql
          },
        })
      ).toThrow(SemanticLayerError)
    })
  })
})

// =============================================================================
// QUERY TESTS
// =============================================================================

describe('Semantic Queries', () => {
  let semantic: SemanticLayer

  beforeEach(() => {
    semantic = new SemanticLayer()
    semantic.defineCube(ordersCubeDefinition)
    semantic.defineCube(customersCubeDefinition)
  })

  describe('Basic Queries', () => {
    it('should generate SQL for simple measure query', async () => {
      const result = await semantic.query({
        measures: ['orders.count'],
      })

      expect(result.sql).toBeDefined()
      expect(result.sql).toContain('COUNT(*)')
      expect(result.sql).toContain('orders')
    })

    it('should generate SQL for measure with dimension', async () => {
      const result = await semantic.query({
        measures: ['orders.totalRevenue'],
        dimensions: ['orders.status'],
      })

      expect(result.sql).toContain('SUM')
      expect(result.sql).toContain('amount')
      expect(result.sql).toContain('status')
      expect(result.sql).toContain('GROUP BY')
    })

    it('should generate SQL for multiple measures', async () => {
      const result = await semantic.query({
        measures: ['orders.totalRevenue', 'orders.count'],
        dimensions: ['orders.status'],
      })

      expect(result.sql).toContain('SUM')
      expect(result.sql).toContain('COUNT(*)')
    })

    it('should generate SQL for multiple dimensions', async () => {
      const result = await semantic.query({
        measures: ['orders.count'],
        dimensions: ['orders.status', 'orders.region'],
      })

      expect(result.sql).toContain('status')
      expect(result.sql).toContain('region')
    })
  })

  describe('Filter Queries', () => {
    it('should generate SQL with equals filter', async () => {
      const result = await semantic.query({
        measures: ['orders.count'],
        filters: [
          { dimension: 'orders.status', operator: 'equals', values: ['completed'] },
        ],
      })

      expect(result.sql).toContain('WHERE')
      expect(result.sql).toMatch(/status\s*=/)
    })

    it('should generate SQL with not equals filter', async () => {
      const result = await semantic.query({
        measures: ['orders.count'],
        filters: [
          { dimension: 'orders.status', operator: 'notEquals', values: ['cancelled'] },
        ],
      })

      expect(result.sql).toContain('WHERE')
      expect(result.sql).toMatch(/status\s*(<>|!=)/)
    })

    it('should generate SQL with greater than filter', async () => {
      const result = await semantic.query({
        measures: ['orders.count'],
        filters: [
          { dimension: 'orders.amount', operator: 'gt', values: ['100'] },
        ],
      })

      expect(result.sql).toContain('WHERE')
      expect(result.sql).toMatch(/amount\s*>/)
    })

    it('should generate SQL with greater than or equal filter', async () => {
      const result = await semantic.query({
        measures: ['orders.count'],
        filters: [
          { dimension: 'orders.amount', operator: 'gte', values: ['100'] },
        ],
      })

      expect(result.sql).toContain('WHERE')
      expect(result.sql).toMatch(/amount\s*>=/)
    })

    it('should generate SQL with less than filter', async () => {
      const result = await semantic.query({
        measures: ['orders.count'],
        filters: [
          { dimension: 'orders.amount', operator: 'lt', values: ['100'] },
        ],
      })

      expect(result.sql).toContain('WHERE')
      expect(result.sql).toMatch(/amount\s*<[^=]/)
    })

    it('should generate SQL with less than or equal filter', async () => {
      const result = await semantic.query({
        measures: ['orders.count'],
        filters: [
          { dimension: 'orders.amount', operator: 'lte', values: ['100'] },
        ],
      })

      expect(result.sql).toContain('WHERE')
      expect(result.sql).toMatch(/amount\s*<=/)
    })

    it('should generate SQL with IN filter', async () => {
      const result = await semantic.query({
        measures: ['orders.count'],
        filters: [
          {
            dimension: 'orders.status',
            operator: 'in',
            values: ['completed', 'pending'],
          },
        ],
      })

      expect(result.sql).toContain('WHERE')
      expect(result.sql).toContain('IN')
    })

    it('should generate SQL with NOT IN filter', async () => {
      const result = await semantic.query({
        measures: ['orders.count'],
        filters: [
          {
            dimension: 'orders.status',
            operator: 'notIn',
            values: ['cancelled'],
          },
        ],
      })

      expect(result.sql).toContain('WHERE')
      expect(result.sql).toContain('NOT IN')
    })

    it('should generate SQL with BETWEEN filter', async () => {
      const result = await semantic.query({
        measures: ['orders.count'],
        filters: [
          {
            dimension: 'orders.createdAt',
            operator: 'between',
            values: ['2024-01-01', '2024-12-31'],
          },
        ],
      })

      expect(result.sql).toContain('WHERE')
      expect(result.sql).toContain('BETWEEN')
    })

    it('should generate SQL with multiple filters (AND)', async () => {
      const result = await semantic.query({
        measures: ['orders.count'],
        filters: [
          { dimension: 'orders.status', operator: 'equals', values: ['completed'] },
          { dimension: 'orders.amount', operator: 'gte', values: ['100'] },
        ],
      })

      expect(result.sql).toContain('WHERE')
      expect(result.sql).toContain('AND')
    })

    it('should support time dimension date range filters', async () => {
      const result = await semantic.query({
        measures: ['orders.count'],
        filters: [
          {
            dimension: 'orders.createdAt',
            operator: 'gte',
            values: ['2024-01-01'],
          },
        ],
      })

      expect(result.sql).toContain('created_at')
      expect(result.sql).toContain('>=')
    })
  })

  describe('Order and Limit Queries', () => {
    it('should generate SQL with ORDER BY', async () => {
      const result = await semantic.query({
        measures: ['orders.totalRevenue'],
        dimensions: ['orders.status'],
        order: [{ id: 'orders.totalRevenue', desc: true }],
      })

      expect(result.sql).toContain('ORDER BY')
      expect(result.sql).toContain('DESC')
    })

    it('should generate SQL with ORDER BY ascending', async () => {
      const result = await semantic.query({
        measures: ['orders.count'],
        dimensions: ['orders.status'],
        order: [{ id: 'orders.status', desc: false }],
      })

      expect(result.sql).toContain('ORDER BY')
      expect(result.sql).toMatch(/ASC|[^D]$/i) // Either ASC or no DESC
    })

    it('should generate SQL with multiple ORDER BY', async () => {
      const result = await semantic.query({
        measures: ['orders.totalRevenue', 'orders.count'],
        dimensions: ['orders.status'],
        order: [
          { id: 'orders.totalRevenue', desc: true },
          { id: 'orders.count', desc: false },
        ],
      })

      expect(result.sql).toContain('ORDER BY')
    })

    it('should generate SQL with LIMIT', async () => {
      const result = await semantic.query({
        measures: ['orders.count'],
        dimensions: ['orders.status'],
        limit: 100,
      })

      expect(result.sql).toContain('LIMIT')
      expect(result.sql).toContain('100')
    })

    it('should generate SQL with OFFSET', async () => {
      const result = await semantic.query({
        measures: ['orders.count'],
        dimensions: ['orders.status'],
        limit: 100,
        offset: 50,
      })

      expect(result.sql).toContain('LIMIT')
      expect(result.sql).toContain('OFFSET')
      expect(result.sql).toContain('50')
    })
  })

  describe('Join Queries', () => {
    it('should generate SQL with JOIN for cross-cube dimensions', async () => {
      const result = await semantic.query({
        measures: ['orders.totalRevenue', 'orders.count'],
        dimensions: ['orders.status', 'customers.country'],
      })

      expect(result.sql).toContain('JOIN')
      expect(result.sql).toContain('customers')
      expect(result.sql).toContain('country')
    })

    it('should generate correct JOIN condition', async () => {
      const result = await semantic.query({
        measures: ['orders.count'],
        dimensions: ['customers.country'],
      })

      expect(result.sql).toContain('customer_id')
    })

    it('should handle filters on joined dimensions', async () => {
      const result = await semantic.query({
        measures: ['orders.count'],
        dimensions: ['orders.status'],
        filters: [
          { dimension: 'customers.country', operator: 'equals', values: ['USA'] },
        ],
      })

      expect(result.sql).toContain('JOIN')
      expect(result.sql).toContain('WHERE')
      expect(result.sql).toContain('country')
    })
  })

  describe('Time Dimension Granularity', () => {
    it('should support day granularity', async () => {
      const result = await semantic.query({
        measures: ['orders.count'],
        timeDimensions: [
          {
            dimension: 'orders.createdAt',
            granularity: 'day',
          },
        ],
      })

      expect(result.sql).toBeDefined()
      // Should extract day from timestamp
    })

    it('should support week granularity', async () => {
      const result = await semantic.query({
        measures: ['orders.count'],
        timeDimensions: [
          {
            dimension: 'orders.createdAt',
            granularity: 'week',
          },
        ],
      })

      expect(result.sql).toBeDefined()
    })

    it('should support month granularity', async () => {
      const result = await semantic.query({
        measures: ['orders.count'],
        timeDimensions: [
          {
            dimension: 'orders.createdAt',
            granularity: 'month',
          },
        ],
      })

      expect(result.sql).toBeDefined()
    })

    it('should support year granularity', async () => {
      const result = await semantic.query({
        measures: ['orders.count'],
        timeDimensions: [
          {
            dimension: 'orders.createdAt',
            granularity: 'year',
          },
        ],
      })

      expect(result.sql).toBeDefined()
    })

    it('should support hour granularity', async () => {
      const result = await semantic.query({
        measures: ['orders.count'],
        timeDimensions: [
          {
            dimension: 'orders.createdAt',
            granularity: 'hour',
          },
        ],
      })

      expect(result.sql).toBeDefined()
    })

    it('should support minute granularity', async () => {
      const result = await semantic.query({
        measures: ['orders.count'],
        timeDimensions: [
          {
            dimension: 'orders.createdAt',
            granularity: 'minute',
          },
        ],
      })

      expect(result.sql).toBeDefined()
    })

    it('should support time dimension with date range', async () => {
      const result = await semantic.query({
        measures: ['orders.count'],
        timeDimensions: [
          {
            dimension: 'orders.createdAt',
            granularity: 'day',
            dateRange: ['2024-01-01', '2024-01-31'],
          },
        ],
      })

      expect(result.sql).toContain('WHERE')
      expect(result.sql).toContain('2024-01-01')
    })
  })

  describe('Query Validation', () => {
    it('should throw for invalid cube reference', async () => {
      await expect(
        semantic.query({
          measures: ['nonexistent.count'],
        })
      ).rejects.toThrow(CubeNotFoundError)
    })

    it('should throw for invalid measure reference', async () => {
      await expect(
        semantic.query({
          measures: ['orders.nonexistent'],
        })
      ).rejects.toThrow(InvalidQueryError)
    })

    it('should throw for invalid dimension reference', async () => {
      await expect(
        semantic.query({
          measures: ['orders.count'],
          dimensions: ['orders.nonexistent'],
        })
      ).rejects.toThrow(InvalidQueryError)
    })

    it('should throw for query with no measures and no dimensions', async () => {
      await expect(semantic.query({})).rejects.toThrow(InvalidQueryError)
    })

    it('should validate filter operator', async () => {
      await expect(
        semantic.query({
          measures: ['orders.count'],
          filters: [
            {
              dimension: 'orders.status',
              operator: 'invalid' as FilterOperator,
              values: ['test'],
            },
          ],
        })
      ).rejects.toThrow(InvalidQueryError)
    })
  })
})

// =============================================================================
// PRE-AGGREGATION TESTS
// =============================================================================

describe('Pre-aggregations', () => {
  let semantic: SemanticLayer

  beforeEach(() => {
    semantic = new SemanticLayer()
    semantic.defineCube(ordersCubeDefinition)
  })

  describe('Pre-aggregation Definition', () => {
    it('should define a pre-aggregation for a cube', () => {
      semantic.definePreAggregation('orders', {
        name: 'daily_revenue',
        measures: ['totalRevenue', 'count'],
        dimensions: ['status'],
        timeDimension: 'createdAt',
        granularity: 'day',
        refreshKey: { every: '1 hour' },
      })

      const cube = semantic.getCube('orders')
      expect(cube?.preAggregations).toHaveLength(1)
      expect(cube?.preAggregations?.[0]?.name).toBe('daily_revenue')
    })

    it('should support multiple pre-aggregations per cube', () => {
      semantic.definePreAggregation('orders', {
        name: 'daily_revenue',
        measures: ['totalRevenue'],
        dimensions: ['status'],
        timeDimension: 'createdAt',
        granularity: 'day',
      })

      semantic.definePreAggregation('orders', {
        name: 'monthly_revenue',
        measures: ['totalRevenue'],
        dimensions: ['region'],
        timeDimension: 'createdAt',
        granularity: 'month',
      })

      const cube = semantic.getCube('orders')
      expect(cube?.preAggregations).toHaveLength(2)
    })

    it('should throw when defining pre-aggregation for non-existent cube', () => {
      expect(() =>
        semantic.definePreAggregation('nonexistent', {
          name: 'test',
          measures: ['count'],
          dimensions: [],
          granularity: 'day',
        })
      ).toThrow(CubeNotFoundError)
    })

    it('should throw when defining pre-aggregation with invalid measure', () => {
      expect(() =>
        semantic.definePreAggregation('orders', {
          name: 'test',
          measures: ['nonexistent'],
          dimensions: [],
          granularity: 'day',
        })
      ).toThrow(InvalidQueryError)
    })

    it('should throw for duplicate pre-aggregation name', () => {
      semantic.definePreAggregation('orders', {
        name: 'daily_revenue',
        measures: ['totalRevenue'],
        dimensions: [],
        granularity: 'day',
      })

      expect(() =>
        semantic.definePreAggregation('orders', {
          name: 'daily_revenue',
          measures: ['count'],
          dimensions: [],
          granularity: 'day',
        })
      ).toThrow(SemanticLayerError)
    })
  })

  describe('Pre-aggregation Matching', () => {
    beforeEach(() => {
      semantic.definePreAggregation('orders', {
        name: 'daily_revenue',
        measures: ['totalRevenue', 'count'],
        dimensions: ['status'],
        timeDimension: 'createdAt',
        granularity: 'day',
      })
    })

    it('should match query to pre-aggregation', async () => {
      const result = await semantic.query({
        measures: ['orders.totalRevenue'],
        dimensions: ['orders.status'],
        timeDimensions: [
          {
            dimension: 'orders.createdAt',
            granularity: 'day',
          },
        ],
      })

      expect(result.usedPreAggregation).toBe('daily_revenue')
    })

    it('should not match query with different granularity', async () => {
      const result = await semantic.query({
        measures: ['orders.totalRevenue'],
        dimensions: ['orders.status'],
        timeDimensions: [
          {
            dimension: 'orders.createdAt',
            granularity: 'hour', // Different from pre-agg
          },
        ],
      })

      expect(result.usedPreAggregation).toBeUndefined()
    })

    it('should not match query with additional dimensions', async () => {
      const result = await semantic.query({
        measures: ['orders.totalRevenue'],
        dimensions: ['orders.status', 'orders.region'], // Extra dimension
        timeDimensions: [
          {
            dimension: 'orders.createdAt',
            granularity: 'day',
          },
        ],
      })

      expect(result.usedPreAggregation).toBeUndefined()
    })

    it('should match query with subset of pre-agg measures', async () => {
      const result = await semantic.query({
        measures: ['orders.count'], // Subset of pre-agg
        dimensions: ['orders.status'],
        timeDimensions: [
          {
            dimension: 'orders.createdAt',
            granularity: 'day',
          },
        ],
      })

      expect(result.usedPreAggregation).toBe('daily_revenue')
    })
  })

  describe('Pre-aggregation SQL Generation', () => {
    it('should generate SQL for pre-aggregation table creation', () => {
      semantic.definePreAggregation('orders', {
        name: 'daily_revenue',
        measures: ['totalRevenue', 'count'],
        dimensions: ['status'],
        timeDimension: 'createdAt',
        granularity: 'day',
      })

      const createSQL = semantic.getPreAggregationSQL('orders', 'daily_revenue')
      expect(createSQL).toContain('CREATE TABLE')
      expect(createSQL).toContain('SUM')
      expect(createSQL).toContain('COUNT')
    })

    it('should generate refresh SQL for pre-aggregation', () => {
      semantic.definePreAggregation('orders', {
        name: 'daily_revenue',
        measures: ['totalRevenue', 'count'],
        dimensions: ['status'],
        timeDimension: 'createdAt',
        granularity: 'day',
        refreshKey: { every: '1 hour' },
      })

      const refreshSQL = semantic.getPreAggregationRefreshSQL(
        'orders',
        'daily_revenue'
      )
      expect(refreshSQL).toBeDefined()
    })
  })
})

// =============================================================================
// CACHING TESTS
// =============================================================================

describe('Query Caching', () => {
  let semantic: SemanticLayer
  let mockExecutor: { execute: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    mockExecutor = {
      execute: vi.fn().mockResolvedValue({
        data: [{ count: 100 }],
        sql: 'SELECT COUNT(*) FROM orders',
      }),
    }

    semantic = new SemanticLayer({
      executor: mockExecutor,
      cache: {
        enabled: true,
        ttl: 60000, // 1 minute
      },
    })
    semantic.defineCube(ordersCubeDefinition)
  })

  describe('Cache Hits and Misses', () => {
    it('should cache query results', async () => {
      const query: SemanticQuery = {
        measures: ['orders.count'],
      }

      // First call - cache miss
      await semantic.query(query)
      expect(mockExecutor.execute).toHaveBeenCalledTimes(1)

      // Second call - cache hit
      await semantic.query(query)
      expect(mockExecutor.execute).toHaveBeenCalledTimes(1) // Not called again
    })

    it('should not cache when disabled', async () => {
      const noCacheSemantic = new SemanticLayer({
        executor: mockExecutor,
        cache: {
          enabled: false,
        },
      })
      noCacheSemantic.defineCube(ordersCubeDefinition)

      const query: SemanticQuery = {
        measures: ['orders.count'],
      }

      await noCacheSemantic.query(query)
      await noCacheSemantic.query(query)
      expect(mockExecutor.execute).toHaveBeenCalledTimes(2)
    })

    it('should generate unique cache keys for different queries', async () => {
      await semantic.query({ measures: ['orders.count'] })
      await semantic.query({ measures: ['orders.totalRevenue'] })

      expect(mockExecutor.execute).toHaveBeenCalledTimes(2)
    })

    it('should include filters in cache key', async () => {
      await semantic.query({
        measures: ['orders.count'],
        filters: [
          { dimension: 'orders.status', operator: 'equals', values: ['completed'] },
        ],
      })

      await semantic.query({
        measures: ['orders.count'],
        filters: [
          { dimension: 'orders.status', operator: 'equals', values: ['pending'] },
        ],
      })

      expect(mockExecutor.execute).toHaveBeenCalledTimes(2)
    })
  })

  describe('Cache Invalidation', () => {
    it('should invalidate cache for specific cube', async () => {
      await semantic.query({ measures: ['orders.count'] })
      expect(mockExecutor.execute).toHaveBeenCalledTimes(1)

      semantic.invalidateCache('orders')

      await semantic.query({ measures: ['orders.count'] })
      expect(mockExecutor.execute).toHaveBeenCalledTimes(2)
    })

    it('should invalidate all cache', async () => {
      await semantic.query({ measures: ['orders.count'] })

      semantic.invalidateAllCache()

      await semantic.query({ measures: ['orders.count'] })
      expect(mockExecutor.execute).toHaveBeenCalledTimes(2)
    })

    it('should expire cache after TTL', async () => {
      vi.useFakeTimers()

      await semantic.query({ measures: ['orders.count'] })
      expect(mockExecutor.execute).toHaveBeenCalledTimes(1)

      // Advance time past TTL
      vi.advanceTimersByTime(70000) // 70 seconds (past 60s TTL)

      await semantic.query({ measures: ['orders.count'] })
      expect(mockExecutor.execute).toHaveBeenCalledTimes(2)

      vi.useRealTimers()
    })
  })

  describe('Cache Statistics', () => {
    it('should track cache hits and misses', async () => {
      await semantic.query({ measures: ['orders.count'] }) // Miss
      await semantic.query({ measures: ['orders.count'] }) // Hit
      await semantic.query({ measures: ['orders.totalRevenue'] }) // Miss

      const stats = semantic.getCacheStats()
      expect(stats.hits).toBe(1)
      expect(stats.misses).toBe(2)
    })

    it('should track cache size', async () => {
      await semantic.query({ measures: ['orders.count'] })
      await semantic.query({ measures: ['orders.totalRevenue'] })

      const stats = semantic.getCacheStats()
      expect(stats.entries).toBe(2)
    })
  })
})

// =============================================================================
// SQL DIALECT TESTS
// =============================================================================

describe('SQL Dialects', () => {
  describe('PostgreSQL Dialect', () => {
    let semantic: SemanticLayer

    beforeEach(() => {
      semantic = new SemanticLayer({ sqlDialect: 'postgres' })
      semantic.defineCube(ordersCubeDefinition)
    })

    it('should use PostgreSQL date_trunc for time granularity', async () => {
      const result = await semantic.query({
        measures: ['orders.count'],
        timeDimensions: [
          {
            dimension: 'orders.createdAt',
            granularity: 'day',
          },
        ],
      })

      expect(result.sql).toContain('date_trunc')
    })
  })

  describe('ClickHouse Dialect', () => {
    let semantic: SemanticLayer

    beforeEach(() => {
      semantic = new SemanticLayer({ sqlDialect: 'clickhouse' })
      semantic.defineCube(ordersCubeDefinition)
    })

    it('should use ClickHouse toStartOf functions for time granularity', async () => {
      const result = await semantic.query({
        measures: ['orders.count'],
        timeDimensions: [
          {
            dimension: 'orders.createdAt',
            granularity: 'day',
          },
        ],
      })

      expect(result.sql).toMatch(/toStartOfDay|toDate/)
    })
  })

  describe('DuckDB Dialect', () => {
    let semantic: SemanticLayer

    beforeEach(() => {
      semantic = new SemanticLayer({ sqlDialect: 'duckdb' })
      semantic.defineCube(ordersCubeDefinition)
    })

    it('should use DuckDB date_trunc for time granularity', async () => {
      const result = await semantic.query({
        measures: ['orders.count'],
        timeDimensions: [
          {
            dimension: 'orders.createdAt',
            granularity: 'day',
          },
        ],
      })

      expect(result.sql).toContain('date_trunc')
    })
  })

  describe('SQLite Dialect', () => {
    let semantic: SemanticLayer

    beforeEach(() => {
      semantic = new SemanticLayer({ sqlDialect: 'sqlite' })
      semantic.defineCube(ordersCubeDefinition)
    })

    it('should use SQLite strftime for time granularity', async () => {
      const result = await semantic.query({
        measures: ['orders.count'],
        timeDimensions: [
          {
            dimension: 'orders.createdAt',
            granularity: 'day',
          },
        ],
      })

      expect(result.sql).toMatch(/strftime|date/)
    })
  })
})

// =============================================================================
// INTEGRATION TESTS
// =============================================================================

describe('Integration', () => {
  let semantic: SemanticLayer

  beforeEach(() => {
    semantic = new SemanticLayer()
    semantic.defineCube(ordersCubeDefinition)
    semantic.defineCube(customersCubeDefinition)
  })

  describe('Complex Multi-cube Query', () => {
    it('should generate correct SQL for complex analytics query', async () => {
      const result = await semantic.query({
        measures: ['orders.totalRevenue', 'orders.count', 'orders.avgOrderValue'],
        dimensions: ['orders.status', 'customers.country'],
        filters: [
          { dimension: 'orders.createdAt', operator: 'gte', values: ['2024-01-01'] },
          { dimension: 'customers.tier', operator: 'in', values: ['gold', 'platinum'] },
        ],
        order: [{ id: 'orders.totalRevenue', desc: true }],
        limit: 100,
      })

      // Verify all components are present
      expect(result.sql).toContain('SELECT')
      expect(result.sql).toContain('SUM')
      expect(result.sql).toContain('COUNT')
      expect(result.sql).toContain('AVG')
      expect(result.sql).toContain('JOIN')
      expect(result.sql).toContain('WHERE')
      expect(result.sql).toContain('GROUP BY')
      expect(result.sql).toContain('ORDER BY')
      expect(result.sql).toContain('LIMIT')
    })
  })

  describe('Schema Introspection', () => {
    it('should return cube metadata', () => {
      const meta = semantic.getMeta()

      expect(meta.cubes).toHaveLength(2)

      const ordersMeta = meta.cubes.find((c) => c.name === 'orders')
      expect(ordersMeta?.measures).toHaveLength(7)
      expect(ordersMeta?.dimensions).toHaveLength(5)
    })

    it('should return measure metadata with types', () => {
      const meta = semantic.getMeta()
      const ordersMeta = meta.cubes.find((c) => c.name === 'orders')

      const revenueMeta = ordersMeta?.measures.find(
        (m) => m.name === 'totalRevenue'
      )
      expect(revenueMeta?.type).toBe('sum')
    })

    it('should return dimension metadata with types', () => {
      const meta = semantic.getMeta()
      const ordersMeta = meta.cubes.find((c) => c.name === 'orders')

      const statusMeta = ordersMeta?.dimensions.find((d) => d.name === 'status')
      expect(statusMeta?.type).toBe('string')
    })
  })
})

// =============================================================================
// HELPER CLASS TESTS
// =============================================================================

describe('Cube Helper Class', () => {
  it('should create a Cube instance with definition', () => {
    const cube = new Cube(ordersCubeDefinition)
    expect(cube.name).toBe('orders')
    expect(cube.measures).toBeDefined()
    expect(cube.dimensions).toBeDefined()
  })

  it('should have getMeasure helper', () => {
    const cube = new Cube(ordersCubeDefinition)
    const measure = cube.getMeasure('totalRevenue')
    expect(measure?.type).toBe('sum')
  })

  it('should have getDimension helper', () => {
    const cube = new Cube(ordersCubeDefinition)
    const dimension = cube.getDimension('status')
    expect(dimension?.type).toBe('string')
  })
})

describe('Metric Helper Class', () => {
  it('should create metric from definition', () => {
    const metric = new Metric('revenue', { type: 'sum', sql: 'amount' })
    expect(metric.name).toBe('revenue')
    expect(metric.type).toBe('sum')
    expect(metric.sql).toBe('amount')
  })

  it('should generate SQL fragment', () => {
    const metric = new Metric('revenue', { type: 'sum', sql: 'amount' })
    const sql = metric.toSQL('orders')
    expect(sql).toContain('SUM')
    expect(sql).toContain('amount')
  })
})

describe('Dimension Helper Class', () => {
  it('should create dimension from definition', () => {
    const dim = new Dimension('status', { type: 'string', sql: 'status' })
    expect(dim.name).toBe('status')
    expect(dim.type).toBe('string')
  })

  it('should generate SQL fragment', () => {
    const dim = new Dimension('status', { type: 'string', sql: 'status' })
    const sql = dim.toSQL('orders')
    expect(sql).toContain('status')
  })

  it('should generate granularity SQL for time dimension', () => {
    const dim = new Dimension('createdAt', { type: 'time', sql: 'created_at' })
    const sql = dim.toSQL('orders', { granularity: 'day', dialect: 'postgres' })
    expect(sql).toContain('date_trunc')
  })
})

describe('PreAggregation Helper Class', () => {
  it('should create pre-aggregation from definition', () => {
    const preAgg = new PreAggregation('daily_revenue', {
      measures: ['totalRevenue'],
      dimensions: ['status'],
      granularity: 'day',
    })

    expect(preAgg.name).toBe('daily_revenue')
    expect(preAgg.measures).toContain('totalRevenue')
    expect(preAgg.granularity).toBe('day')
  })

  it('should check if query matches pre-aggregation', () => {
    const preAgg = new PreAggregation('daily_revenue', {
      measures: ['totalRevenue', 'count'],
      dimensions: ['status'],
      timeDimension: 'createdAt',
      granularity: 'day',
    })

    const matches = preAgg.matches({
      measures: ['totalRevenue'],
      dimensions: ['status'],
      timeDimension: 'createdAt',
      granularity: 'day',
    })

    expect(matches).toBe(true)
  })
})
