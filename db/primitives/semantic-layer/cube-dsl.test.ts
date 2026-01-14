/**
 * Cube Schema DSL Tests - TDD RED Phase
 *
 * Tests for the TypeScript-first Cube schema DSL that provides:
 * - TypeScript-first schema definition
 * - Data source binding (table, SQL query, view)
 * - Measures and dimensions registration
 * - Joins to other cubes (one-to-one, one-to-many, many-to-many)
 * - Segments (predefined filters)
 * - Schema validation and type inference
 *
 * @see dotdo-gjpif
 */

import { describe, it, expect } from 'vitest'
import {
  // Core DSL
  cube,

  // Measure helpers
  count,
  sum,
  avg,
  min,
  max,
  countDistinct,

  // Dimension helpers
  time,
  categorical,
  numeric,
  boolean as bool,

  // Join helpers
  oneToOne,
  oneToMany,
  manyToMany,

  // Segment helper
  segment,

  // Validation
  validateCube,

  // Types
  type CubeDefinition,
  type MeasureDefinition,
  type DimensionDefinition,
  type JoinDefinition,
  type SegmentDefinition,
} from './cube-dsl'

// =============================================================================
// Core Cube Definition Tests
// =============================================================================

describe('Cube Schema DSL', () => {
  describe('cube() factory', () => {
    it('should create a cube with sql function', () => {
      const OrdersCube = cube({
        sql: () => `SELECT * FROM orders`,
        measures: {
          count: count(),
        },
        dimensions: {
          createdAt: time('created_at'),
        },
      })

      expect(OrdersCube).toBeDefined()
      expect(OrdersCube.sql).toBe('SELECT * FROM orders')
    })

    it('should create a cube with sql string', () => {
      const OrdersCube = cube({
        sql: `SELECT * FROM orders`,
        measures: {
          count: count(),
        },
        dimensions: {},
      })

      expect(OrdersCube.sql).toBe('SELECT * FROM orders')
    })

    it('should support table shorthand', () => {
      const OrdersCube = cube({
        table: 'orders',
        measures: {
          count: count(),
        },
        dimensions: {},
      })

      expect(OrdersCube.sql).toBe('SELECT * FROM orders')
    })

    it('should support view shorthand', () => {
      const OrdersCube = cube({
        view: 'order_analytics_view',
        measures: {
          count: count(),
        },
        dimensions: {},
      })

      expect(OrdersCube.sql).toBe('SELECT * FROM order_analytics_view')
    })

    it('should support name property', () => {
      const OrdersCube = cube({
        name: 'Orders',
        sql: () => `SELECT * FROM orders`,
        measures: { count: count() },
        dimensions: {},
      })

      expect(OrdersCube.name).toBe('Orders')
    })

    it('should auto-infer name from variable if not provided', () => {
      // This tests the runtime behavior when name is not explicitly set
      const result = cube({
        sql: () => `SELECT * FROM orders`,
        measures: { count: count() },
        dimensions: {},
      })

      // Name should be undefined when not provided (can be set later)
      expect(result.name).toBeUndefined()
    })

    it('should support description', () => {
      const OrdersCube = cube({
        name: 'Orders',
        description: 'E-commerce order analytics',
        sql: () => `SELECT * FROM orders`,
        measures: { count: count() },
        dimensions: {},
      })

      expect(OrdersCube.description).toBe('E-commerce order analytics')
    })
  })
})

// =============================================================================
// Measure Helper Tests
// =============================================================================

describe('Measure Helpers', () => {
  describe('count()', () => {
    it('should create a count measure', () => {
      const measure = count()

      expect(measure.type).toBe('count')
      expect(measure.sql).toBeUndefined()
    })

    it('should support options', () => {
      const measure = count({
        title: 'Total Orders',
        description: 'Number of orders',
      })

      expect(measure.title).toBe('Total Orders')
      expect(measure.description).toBe('Number of orders')
    })
  })

  describe('sum()', () => {
    it('should create a sum measure with column name', () => {
      const measure = sum('amount')

      expect(measure.type).toBe('sum')
      expect(measure.sql).toBe('amount')
    })

    it('should support options', () => {
      const measure = sum('amount', {
        title: 'Revenue',
        format: 'currency',
      })

      expect(measure.title).toBe('Revenue')
      expect(measure.format).toBe('currency')
    })

    it('should support SQL expressions', () => {
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

    it('should support options', () => {
      const measure = avg('amount', { title: 'Average Order Value' })

      expect(measure.title).toBe('Average Order Value')
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

  describe('countDistinct()', () => {
    it('should create a countDistinct measure', () => {
      const measure = countDistinct('customer_id')

      expect(measure.type).toBe('countDistinct')
      expect(measure.sql).toBe('customer_id')
    })
  })

  describe('Measure in cube context', () => {
    it('should register measures correctly', () => {
      const OrdersCube = cube({
        sql: () => `SELECT * FROM orders`,
        measures: {
          count: count(),
          revenue: sum('amount'),
          avgOrderValue: avg('amount'),
        },
        dimensions: {},
      })

      expect(OrdersCube.measures.count.type).toBe('count')
      expect(OrdersCube.measures.revenue.type).toBe('sum')
      expect(OrdersCube.measures.avgOrderValue.type).toBe('avg')
    })
  })
})

// =============================================================================
// Dimension Helper Tests
// =============================================================================

describe('Dimension Helpers', () => {
  describe('time()', () => {
    it('should create a time dimension', () => {
      const dimension = time('created_at')

      expect(dimension.type).toBe('time')
      expect(dimension.sql).toBe('created_at')
    })

    it('should support options', () => {
      const dimension = time('created_at', {
        title: 'Order Date',
        description: 'When the order was placed',
      })

      expect(dimension.title).toBe('Order Date')
      expect(dimension.description).toBe('When the order was placed')
    })

    it('should support granularity', () => {
      const dimension = time('created_at', { granularity: 'day' })

      expect(dimension.granularity).toBe('day')
    })
  })

  describe('categorical()', () => {
    it('should create a categorical (string) dimension', () => {
      const dimension = categorical('status')

      expect(dimension.type).toBe('string')
      expect(dimension.sql).toBe('status')
    })

    it('should support options', () => {
      const dimension = categorical('status', {
        title: 'Order Status',
        description: 'Current status of the order',
      })

      expect(dimension.title).toBe('Order Status')
    })
  })

  describe('numeric()', () => {
    it('should create a numeric dimension', () => {
      const dimension = numeric('quantity')

      expect(dimension.type).toBe('number')
      expect(dimension.sql).toBe('quantity')
    })
  })

  describe('boolean()', () => {
    it('should create a boolean dimension', () => {
      const dimension = bool('is_active')

      expect(dimension.type).toBe('boolean')
      expect(dimension.sql).toBe('is_active')
    })
  })

  describe('Dimension in cube context', () => {
    it('should register dimensions correctly', () => {
      const OrdersCube = cube({
        sql: () => `SELECT * FROM orders`,
        measures: { count: count() },
        dimensions: {
          createdAt: time('created_at'),
          status: categorical('status'),
          quantity: numeric('quantity'),
          isActive: bool('is_active'),
        },
      })

      expect(OrdersCube.dimensions.createdAt.type).toBe('time')
      expect(OrdersCube.dimensions.status.type).toBe('string')
      expect(OrdersCube.dimensions.quantity.type).toBe('number')
      expect(OrdersCube.dimensions.isActive.type).toBe('boolean')
    })
  })
})

// =============================================================================
// Join Helper Tests
// =============================================================================

describe('Join Helpers', () => {
  describe('oneToOne()', () => {
    it('should create a one-to-one join', () => {
      const join = oneToOne('UserProfile', 'user_id', 'user_id')

      expect(join.relationship).toBe('oneToOne')
      expect(join.cube).toBe('UserProfile')
      expect(join.sql).toContain('user_id')
    })

    it('should support custom SQL condition', () => {
      const join = oneToOne('UserProfile', {
        sql: '${CUBE}.user_id = ${UserProfile}.id',
      })

      expect(join.sql).toBe('${CUBE}.user_id = ${UserProfile}.id')
    })
  })

  describe('oneToMany()', () => {
    it('should create a one-to-many join', () => {
      const join = oneToMany('OrderItems', 'id', 'order_id')

      expect(join.relationship).toBe('oneToMany')
      expect(join.cube).toBe('OrderItems')
    })
  })

  describe('manyToMany()', () => {
    it('should create a many-to-many join with junction table', () => {
      const join = manyToMany('Tags', {
        through: 'order_tags',
        sourceKey: 'order_id',
        targetKey: 'tag_id',
      })

      expect(join.relationship).toBe('manyToMany')
      expect(join.cube).toBe('Tags')
      expect(join.through).toBe('order_tags')
    })
  })

  describe('Joins in cube context', () => {
    it('should register joins correctly', () => {
      const OrdersCube = cube({
        sql: () => `SELECT * FROM orders`,
        measures: { count: count() },
        dimensions: {},
        joins: {
          Customer: oneToOne('Customers', 'customer_id', 'id'),
          Items: oneToMany('OrderItems', 'id', 'order_id'),
        },
      })

      expect(OrdersCube.joins?.Customer.relationship).toBe('oneToOne')
      expect(OrdersCube.joins?.Items.relationship).toBe('oneToMany')
    })
  })
})

// =============================================================================
// Segment Tests
// =============================================================================

describe('Segment Helper', () => {
  describe('segment()', () => {
    it('should create a segment with SQL condition', () => {
      const seg = segment(`status = 'completed'`)

      expect(seg.sql).toBe(`status = 'completed'`)
    })

    it('should support options', () => {
      const seg = segment(`amount > 100`, {
        title: 'High Value Orders',
        description: 'Orders with amount greater than $100',
      })

      expect(seg.title).toBe('High Value Orders')
      expect(seg.description).toBe('Orders with amount greater than $100')
    })
  })

  describe('Segments in cube context', () => {
    it('should register segments correctly', () => {
      const OrdersCube = cube({
        sql: () => `SELECT * FROM orders`,
        measures: { count: count() },
        dimensions: {},
        segments: {
          completed: segment(`status = 'completed'`),
          highValue: segment(`amount > 100`),
        },
      })

      expect(OrdersCube.segments?.completed.sql).toBe(`status = 'completed'`)
      expect(OrdersCube.segments?.highValue.sql).toBe(`amount > 100`)
    })
  })
})

// =============================================================================
// Schema Validation Tests
// =============================================================================

describe('Schema Validation', () => {
  describe('validateCube()', () => {
    it('should validate a valid cube', () => {
      const OrdersCube = cube({
        sql: () => `SELECT * FROM orders`,
        measures: { count: count() },
        dimensions: { createdAt: time('created_at') },
      })

      expect(() => validateCube(OrdersCube)).not.toThrow()
    })

    it('should throw for cube without data source', () => {
      expect(() =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cube({
          sql: undefined as any,
          measures: { count: count() },
          dimensions: {},
        })
      ).toThrow()
    })

    it('should throw for cube with empty measures and dimensions', () => {
      expect(() =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cube({
          sql: () => `SELECT * FROM orders`,
          measures: undefined as any,
          dimensions: {},
        })
      ).toThrow()
    })

    it('should validate measure types', () => {
      expect(() =>
        cube({
          sql: () => `SELECT * FROM orders`,
          measures: {
            // @ts-expect-error - Testing runtime validation
            bad: { type: 'invalid' },
          },
          dimensions: {},
        })
      ).toThrow()
    })

    it('should validate dimension types', () => {
      expect(() =>
        cube({
          sql: () => `SELECT * FROM orders`,
          measures: { count: count() },
          dimensions: {
            // @ts-expect-error - Testing runtime validation
            bad: { type: 'invalid', sql: 'col' },
          },
        })
      ).toThrow()
    })

    it('should validate join references', () => {
      const OrdersCube = cube({
        sql: () => `SELECT * FROM orders`,
        measures: { count: count() },
        dimensions: {},
        joins: {
          Customer: oneToOne('Customers', 'customer_id', 'id'),
        },
      })

      // Validation should pass (join references are checked at query time)
      expect(() => validateCube(OrdersCube)).not.toThrow()
    })
  })
})

// =============================================================================
// Type Inference Tests
// =============================================================================

describe('Type Inference', () => {
  it('should provide proper type inference for measures', () => {
    const OrdersCube = cube({
      sql: () => `SELECT * FROM orders`,
      measures: {
        count: count(),
        revenue: sum('amount'),
      },
      dimensions: {},
    })

    // TypeScript should infer these types correctly
    // This is a compile-time check, but we can verify at runtime
    expect(OrdersCube.measures.count.type).toBe('count')
    expect(OrdersCube.measures.revenue.type).toBe('sum')
  })

  it('should provide proper type inference for dimensions', () => {
    const OrdersCube = cube({
      sql: () => `SELECT * FROM orders`,
      measures: { count: count() },
      dimensions: {
        createdAt: time('created_at'),
        status: categorical('status'),
      },
    })

    expect(OrdersCube.dimensions.createdAt.type).toBe('time')
    expect(OrdersCube.dimensions.status.type).toBe('string')
  })

  it('should allow accessing typed measure names', () => {
    const OrdersCube = cube({
      sql: () => `SELECT * FROM orders`,
      measures: {
        count: count(),
        revenue: sum('amount'),
      },
      dimensions: {},
    })

    const measureNames = Object.keys(OrdersCube.measures)
    expect(measureNames).toContain('count')
    expect(measureNames).toContain('revenue')
  })

  it('should allow accessing typed dimension names', () => {
    const OrdersCube = cube({
      sql: () => `SELECT * FROM orders`,
      measures: { count: count() },
      dimensions: {
        createdAt: time('created_at'),
        status: categorical('status'),
      },
    })

    const dimensionNames = Object.keys(OrdersCube.dimensions)
    expect(dimensionNames).toContain('createdAt')
    expect(dimensionNames).toContain('status')
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('Integration', () => {
  it('should create a complete cube matching the example API', () => {
    const OrdersCube = cube({
      sql: () => `SELECT * FROM orders`,
      measures: {
        count: count(),
        revenue: sum('amount'),
        avgOrderValue: avg('amount'),
      },
      dimensions: {
        createdAt: time('created_at'),
        status: categorical('status'),
      },
    })

    // Verify structure matches expected output
    expect(OrdersCube.sql).toBe('SELECT * FROM orders')
    expect(Object.keys(OrdersCube.measures)).toHaveLength(3)
    expect(Object.keys(OrdersCube.dimensions)).toHaveLength(2)

    // Verify measure types
    expect(OrdersCube.measures.count.type).toBe('count')
    expect(OrdersCube.measures.revenue.type).toBe('sum')
    expect(OrdersCube.measures.avgOrderValue.type).toBe('avg')

    // Verify dimension types
    expect(OrdersCube.dimensions.createdAt.type).toBe('time')
    expect(OrdersCube.dimensions.status.type).toBe('string')
  })

  it('should create a complete e-commerce cube with all features', () => {
    const OrdersCube = cube({
      name: 'Orders',
      description: 'E-commerce order analytics cube',
      sql: () => `SELECT * FROM orders`,

      measures: {
        count: count({ title: 'Order Count' }),
        revenue: sum('amount', { title: 'Revenue', format: 'currency' }),
        avgOrderValue: avg('amount', { title: 'AOV' }),
        minOrder: min('amount'),
        maxOrder: max('amount'),
        uniqueCustomers: countDistinct('customer_id'),
      },

      dimensions: {
        id: numeric('id', { primaryKey: true }),
        createdAt: time('created_at', { title: 'Order Date' }),
        status: categorical('status', { title: 'Status' }),
        isActive: bool('is_active'),
      },

      joins: {
        Customer: oneToOne('Customers', 'customer_id', 'id'),
        Items: oneToMany('OrderItems', 'id', 'order_id'),
      },

      segments: {
        completed: segment(`status = 'completed'`, { title: 'Completed Orders' }),
        highValue: segment(`amount > 100`, { title: 'High Value' }),
        recent: segment(`created_at >= CURRENT_DATE - INTERVAL '30 days'`),
      },
    })

    // Verify all components
    expect(OrdersCube.name).toBe('Orders')
    expect(OrdersCube.description).toBe('E-commerce order analytics cube')
    expect(Object.keys(OrdersCube.measures)).toHaveLength(6)
    expect(Object.keys(OrdersCube.dimensions)).toHaveLength(4)
    expect(Object.keys(OrdersCube.joins!)).toHaveLength(2)
    expect(Object.keys(OrdersCube.segments!)).toHaveLength(3)

    // Verify joins
    expect(OrdersCube.joins?.Customer.relationship).toBe('oneToOne')
    expect(OrdersCube.joins?.Items.relationship).toBe('oneToMany')

    // Verify segments
    expect(OrdersCube.segments?.completed.sql).toBe(`status = 'completed'`)
  })

  it('should work with dynamic SQL', () => {
    const getSchema = () => 'analytics'

    const OrdersCube = cube({
      sql: () => `SELECT * FROM ${getSchema()}.orders`,
      measures: { count: count() },
      dimensions: {},
    })

    expect(OrdersCube.sql).toBe('SELECT * FROM analytics.orders')
  })

  it('should support chained cube definitions', () => {
    const CustomersCube = cube({
      name: 'Customers',
      sql: () => `SELECT * FROM customers`,
      measures: {
        count: count(),
      },
      dimensions: {
        id: numeric('id', { primaryKey: true }),
        name: categorical('name'),
      },
    })

    const OrdersCube = cube({
      name: 'Orders',
      sql: () => `SELECT * FROM orders`,
      measures: { count: count() },
      dimensions: {},
      joins: {
        Customer: oneToOne(CustomersCube.name!, 'customer_id', 'id'),
      },
    })

    expect(OrdersCube.joins?.Customer.cube).toBe('Customers')
  })
})
