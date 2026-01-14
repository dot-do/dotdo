/**
 * Contract Integration Tests
 *
 * Tests type-safe SemanticLayer definitions using DataContract schemas.
 *
 * Acceptance Criteria:
 * - [x] Cubes defined with type safety
 * - [x] Invalid field references caught at compile time
 * - [x] Query builder respects contract types
 * - [x] IDE auto-complete works correctly (verified by TypeScript compilation)
 * - [x] Tests cover type inference scenarios
 *
 * @see dotdo-eh0a8
 */

import { describe, test, expect, beforeEach } from 'vitest'
import {
  defineCube,
  dimension,
  metric,
  query,
  dimensionFromContract,
  metricFromContract,
  inferDimensions,
  inferMetrics,
  toStandardCube,
  getCubeFields,
  isBoundToContract,
  type TypedCube,
  type TypedDimension,
  type TypedMetric,
  ContractIntegrationError,
  InvalidFieldError,
  TypeMismatchError,
} from './contract-integration'
import { createSchema, type DataContract } from '../data-contract'

// =============================================================================
// Test Types and Fixtures
// =============================================================================

/**
 * Order entity type matching the contract
 */
interface Order {
  id: string
  amount: number
  quantity: number
  status: string
  createdAt: string
  customerId: string
  isActive: boolean
}

/**
 * Customer entity type
 */
interface Customer {
  id: string
  name: string
  email: string
  createdAt: string
  totalSpent: number
}

/**
 * Create test Order contract
 */
function createOrderContract(): DataContract {
  return createSchema({
    name: 'Order',
    version: '1.0.0',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Order ID' },
        amount: { type: 'number', description: 'Order amount in dollars' },
        quantity: { type: 'integer', description: 'Number of items' },
        status: { type: 'string', description: 'Order status' },
        createdAt: { type: 'string', format: 'date-time', description: 'Order creation time' },
        customerId: { type: 'string', description: 'Customer reference' },
        isActive: { type: 'boolean', description: 'Is order active' },
      },
      required: ['id', 'amount', 'status', 'createdAt'],
    },
  })
}

/**
 * Create test Customer contract
 */
function createCustomerContract(): DataContract {
  return createSchema({
    name: 'Customer',
    version: '1.0.0',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        email: { type: 'string', format: 'email' },
        createdAt: { type: 'string', format: 'date-time' },
        totalSpent: { type: 'number' },
      },
      required: ['id', 'name', 'email'],
    },
  })
}

// =============================================================================
// TypedDimension Tests
// =============================================================================

describe('TypedDimension', () => {
  test('creates dimension with field name and type', () => {
    const statusDim = dimension<Order>('status', 'string')

    expect(statusDim.field).toBe('status')
    expect(statusDim.type).toBe('string')
    expect(statusDim.sql).toBe('status')
  })

  test('creates time dimension with granularity', () => {
    const createdAtDim = dimension<Order>('createdAt', 'time', {
      granularity: 'day',
    })

    expect(createdAtDim.field).toBe('createdAt')
    expect(createdAtDim.type).toBe('time')
    expect(createdAtDim.granularity).toBe('day')
  })

  test('creates dimension with custom SQL', () => {
    const customDim = dimension<Order>('status', 'string', {
      sql: 'UPPER(status)',
    })

    expect(customDim.sql).toBe('UPPER(status)')
  })

  test('creates dimension with all config options', () => {
    const dim = dimension<Order>('id', 'string', {
      sql: 'id',
      title: 'Order ID',
      description: 'Unique order identifier',
      primaryKey: true,
      shown: true,
      caseInsensitiveMatch: false,
      meta: { indexed: true },
    })

    expect(dim.title).toBe('Order ID')
    expect(dim.description).toBe('Unique order identifier')
    expect(dim.primaryKey).toBe(true)
    expect(dim.shown).toBe(true)
    expect(dim.caseInsensitiveMatch).toBe(false)
    expect(dim.meta).toEqual({ indexed: true })
  })

  test('dimension type is inferred from field', () => {
    // These would be compile errors if wrong field names used
    const statusDim: TypedDimension<Order, 'status'> = dimension<Order, 'status'>('status', 'string')
    const amountDim: TypedDimension<Order, 'amount'> = dimension<Order, 'amount'>('amount', 'number')

    expect(statusDim.field).toBe('status')
    expect(amountDim.field).toBe('amount')
  })
})

// =============================================================================
// TypedMetric Tests
// =============================================================================

describe('TypedMetric', () => {
  test('creates sum metric', () => {
    const revenue = metric<Order>('amount', 'sum')

    expect(revenue.field).toBe('amount')
    expect(revenue.aggregation).toBe('sum')
    expect(revenue.sql).toBe('amount')
  })

  test('creates count metric', () => {
    const orderCount = metric<Order>('id', 'count')

    expect(orderCount.field).toBe('id')
    expect(orderCount.aggregation).toBe('count')
  })

  test('creates avg metric', () => {
    const avgAmount = metric<Order>('amount', 'avg')

    expect(avgAmount.aggregation).toBe('avg')
  })

  test('creates min/max metrics', () => {
    const minAmount = metric<Order>('amount', 'min')
    const maxAmount = metric<Order>('amount', 'max')

    expect(minAmount.aggregation).toBe('min')
    expect(maxAmount.aggregation).toBe('max')
  })

  test('creates countDistinct metric', () => {
    const uniqueCustomers = metric<Order>('customerId', 'countDistinct')

    expect(uniqueCustomers.aggregation).toBe('countDistinct')
  })

  test('creates metric with format', () => {
    const revenue = metric<Order>('amount', 'sum', {
      format: 'currency',
    })

    expect(revenue.format).toBe('currency')
  })

  test('creates metric with all config options', () => {
    const met = metric<Order>('amount', 'sum', {
      sql: 'amount * (1 - discount)',
      title: 'Net Revenue',
      description: 'Revenue after discounts',
      format: 'currency',
      drillMembers: ['id', 'status'],
      filters: [{ sql: "status = 'completed'" }],
      shown: true,
      meta: { priority: 'high' },
    })

    expect(met.title).toBe('Net Revenue')
    expect(met.description).toBe('Revenue after discounts')
    expect(met.drillMembers).toEqual(['id', 'status'])
    expect(met.filters).toHaveLength(1)
    expect(met.meta).toEqual({ priority: 'high' })
  })

  test('metric type is inferred from field', () => {
    // These would be compile errors if wrong field names used
    const amountMetric: TypedMetric<Order, 'amount'> = metric<Order, 'amount'>('amount', 'sum')
    const idMetric: TypedMetric<Order, 'id'> = metric<Order, 'id'>('id', 'count')

    expect(amountMetric.field).toBe('amount')
    expect(idMetric.field).toBe('id')
  })
})

// =============================================================================
// defineCube Tests
// =============================================================================

describe('defineCube', () => {
  let orderContract: DataContract

  beforeEach(() => {
    orderContract = createOrderContract()
  })

  test('creates cube with dimensions and metrics', () => {
    const cube = defineCube<Order>(orderContract, {
      name: 'Orders',
      sql: 'SELECT * FROM orders',
      dimensions: [
        dimension('status', 'string'),
        dimension('createdAt', 'time'),
      ],
      metrics: [
        metric('amount', 'sum'),
        metric('id', 'count'),
      ],
    })

    expect(cube.name).toBe('Orders')
    expect(cube.sql).toBe('SELECT * FROM orders')
    expect(cube.dimensions).toHaveLength(2)
    expect(cube.metrics).toHaveLength(2)
    expect(cube.contract).toBe(orderContract)
  })

  test('validates dimension fields exist in contract', () => {
    expect(() =>
      defineCube<Order>(orderContract, {
        name: 'Orders',
        sql: 'SELECT * FROM orders',
        dimensions: [
          // @ts-expect-error - Testing runtime validation
          dimension('invalidField', 'string'),
        ],
        metrics: [],
      })
    ).toThrow(InvalidFieldError)
  })

  test('validates metric fields exist in contract', () => {
    expect(() =>
      defineCube<Order>(orderContract, {
        name: 'Orders',
        sql: 'SELECT * FROM orders',
        dimensions: [],
        metrics: [
          // @ts-expect-error - Testing runtime validation
          metric('nonExistent', 'sum'),
        ],
      })
    ).toThrow(InvalidFieldError)
  })

  test('validates numeric fields for sum/avg aggregations', () => {
    expect(() =>
      defineCube<Order>(orderContract, {
        name: 'Orders',
        sql: 'SELECT * FROM orders',
        dimensions: [],
        metrics: [
          // status is a string, cannot use sum
          metric('status', 'sum'),
        ],
      })
    ).toThrow(TypeMismatchError)
  })

  test('allows count on any field type', () => {
    // Should not throw - count works on any field
    const cube = defineCube<Order>(orderContract, {
      name: 'Orders',
      sql: 'SELECT * FROM orders',
      dimensions: [],
      metrics: [
        metric('status', 'count'),
        metric('id', 'countDistinct'),
      ],
    })

    expect(cube.metrics).toHaveLength(2)
  })

  test('allows integer fields for numeric aggregations', () => {
    // quantity is integer type - should work with sum
    const cube = defineCube<Order>(orderContract, {
      name: 'Orders',
      sql: 'SELECT * FROM orders',
      dimensions: [],
      metrics: [
        metric('quantity', 'sum'),
        metric('quantity', 'avg'),
      ],
    })

    expect(cube.metrics).toHaveLength(2)
  })

  test('creates cube with SQL function', () => {
    const cube = defineCube<Order>(orderContract, {
      name: 'Orders',
      sql: () => `SELECT * FROM orders WHERE active = true`,
      dimensions: [],
      metrics: [metric('amount', 'sum')],
    })

    expect(cube.sql).toBe('SELECT * FROM orders WHERE active = true')
  })

  test('preserves cube metadata', () => {
    const cube = defineCube<Order>(orderContract, {
      name: 'Orders',
      sql: 'SELECT * FROM orders',
      description: 'All orders',
      dimensions: [],
      metrics: [],
      refreshKey: { every: '1 hour' },
      dataSource: 'default',
      meta: { version: '2.0' },
    })

    expect(cube.description).toBe('All orders')
    expect(cube.refreshKey).toEqual({ every: '1 hour' })
    expect(cube.dataSource).toBe('default')
    expect(cube.meta).toEqual({ version: '2.0' })
  })
})

// =============================================================================
// TypedQueryBuilder Tests
// =============================================================================

describe('TypedQueryBuilder', () => {
  let ordersCube: TypedCube<Order>
  let orderContract: DataContract

  beforeEach(() => {
    orderContract = createOrderContract()
    ordersCube = defineCube<Order>(orderContract, {
      name: 'Orders',
      sql: 'SELECT * FROM orders',
      dimensions: [
        dimension('status', 'string'),
        dimension('createdAt', 'time'),
        dimension('customerId', 'string'),
      ],
      metrics: [
        metric('amount', 'sum'),
        metric('id', 'count'),
        metric('quantity', 'avg'),
      ],
    })
  })

  test('builds query with select', () => {
    const q = query(ordersCube)
      .select('amount')
      .build()

    expect(q.measures).toEqual(['Orders.amount'])
  })

  test('builds query with multiple selects', () => {
    const q = query(ordersCube)
      .select('amount', 'id')
      .build()

    expect(q.measures).toEqual(['Orders.amount', 'Orders.id'])
  })

  test('builds query with groupBy', () => {
    const q = query(ordersCube)
      .select('amount')
      .groupBy('status')
      .build()

    expect(q.dimensions).toEqual(['Orders.status'])
  })

  test('builds query with multiple dimensions', () => {
    const q = query(ordersCube)
      .select('amount')
      .groupBy('status', 'customerId')
      .build()

    expect(q.dimensions).toEqual(['Orders.status', 'Orders.customerId'])
  })

  test('builds query with where filter', () => {
    const q = query(ordersCube)
      .select('amount')
      .where('status', 'completed')
      .build()

    expect(q.filters).toEqual([
      { dimension: 'Orders.status', operator: 'equals', values: ['completed'] },
    ])
  })

  test('builds query with array values in where', () => {
    const q = query(ordersCube)
      .select('amount')
      .where('status', ['completed', 'shipped'], 'in')
      .build()

    expect(q.filters).toEqual([
      { dimension: 'Orders.status', operator: 'in', values: ['completed', 'shipped'] },
    ])
  })

  test('builds query with time dimension', () => {
    const q = query(ordersCube)
      .select('amount')
      .timeDimension('createdAt', 'month')
      .build()

    expect(q.timeDimensions).toEqual([
      { dimension: 'Orders.createdAt', granularity: 'month', dateRange: undefined },
    ])
  })

  test('builds query with time dimension date range', () => {
    const q = query(ordersCube)
      .select('amount')
      .timeDimension('createdAt', 'day', ['2024-01-01', '2024-12-31'])
      .build()

    expect(q.timeDimensions?.[0]?.dateRange).toEqual(['2024-01-01', '2024-12-31'])
  })

  test('builds query with orderBy', () => {
    const q = query(ordersCube)
      .select('amount')
      .orderBy('amount', true)
      .build()

    expect(q.order).toEqual([{ id: 'Orders.amount', desc: true }])
  })

  test('builds query with limit and offset', () => {
    const q = query(ordersCube)
      .select('amount')
      .limit(10)
      .offset(20)
      .build()

    expect(q.limit).toBe(10)
    expect(q.offset).toBe(20)
  })

  test('builds complete query', () => {
    const q = query(ordersCube)
      .select('amount', 'id')
      .groupBy('status')
      .timeDimension('createdAt', 'month')
      .where('status', 'completed')
      .orderBy('amount', true)
      .limit(100)
      .build()

    expect(q).toEqual({
      measures: ['Orders.amount', 'Orders.id'],
      dimensions: ['Orders.status'],
      timeDimensions: [{ dimension: 'Orders.createdAt', granularity: 'month', dateRange: undefined }],
      filters: [{ dimension: 'Orders.status', operator: 'equals', values: ['completed'] }],
      order: [{ id: 'Orders.amount', desc: true }],
      limit: 100,
      offset: undefined,
    })
  })

  test('throws for invalid metric in select', () => {
    expect(() =>
      query(ordersCube)
        // @ts-expect-error - Testing runtime validation
        .select('invalidMetric')
    ).toThrow(ContractIntegrationError)
  })

  test('throws for invalid dimension in groupBy', () => {
    expect(() =>
      query(ordersCube)
        .select('amount')
        // @ts-expect-error - Testing runtime validation
        .groupBy('invalidDimension')
    ).toThrow(ContractIntegrationError)
  })

  test('throws for non-time dimension in timeDimension', () => {
    expect(() =>
      query(ordersCube)
        .select('amount')
        // status is not a time dimension
        .timeDimension('status' as 'createdAt', 'day')
    ).toThrow(ContractIntegrationError)
  })

  test('getCube returns the cube', () => {
    const builder = query(ordersCube)
    expect(builder.getCube()).toBe(ordersCube)
  })

  test('measure method adds direct measure', () => {
    const q = query(ordersCube)
      .measure('amount')
      .build()

    expect(q.measures).toEqual(['Orders.amount'])
  })

  test('filter method adds raw filter', () => {
    const q = query(ordersCube)
      .select('amount')
      .filter({ dimension: 'Orders.status', operator: 'notEquals', values: ['cancelled'] })
      .build()

    expect(q.filters?.[0]?.operator).toBe('notEquals')
  })
})

// =============================================================================
// Contract Inference Tests
// =============================================================================

describe('Contract Inference', () => {
  let orderContract: DataContract
  let customerContract: DataContract

  beforeEach(() => {
    orderContract = createOrderContract()
    customerContract = createCustomerContract()
  })

  describe('dimensionFromContract', () => {
    test('infers string dimension type', () => {
      const dim = dimensionFromContract<Order>(orderContract, 'status')

      expect(dim.type).toBe('string')
      expect(dim.field).toBe('status')
      expect(dim.caseInsensitiveMatch).toBe(true)
    })

    test('infers time dimension from date-time format', () => {
      const dim = dimensionFromContract<Order>(orderContract, 'createdAt')

      expect(dim.type).toBe('time')
      expect(dim.granularity).toBe('day')
    })

    test('infers number dimension type', () => {
      const dim = dimensionFromContract<Order>(orderContract, 'amount')

      expect(dim.type).toBe('number')
    })

    test('infers boolean dimension type', () => {
      const dim = dimensionFromContract<Order>(orderContract, 'isActive')

      expect(dim.type).toBe('boolean')
    })

    test('uses description from schema', () => {
      const dim = dimensionFromContract<Order>(orderContract, 'amount')

      expect(dim.title).toBe('Order amount in dollars')
    })

    test('throws for invalid field', () => {
      expect(() =>
        // @ts-expect-error - Testing runtime validation
        dimensionFromContract<Order>(orderContract, 'nonExistent')
      ).toThrow(InvalidFieldError)
    })
  })

  describe('metricFromContract', () => {
    test('creates metric with validation', () => {
      const met = metricFromContract<Order>(orderContract, 'amount', 'sum')

      expect(met.field).toBe('amount')
      expect(met.aggregation).toBe('sum')
    })

    test('throws for non-numeric sum', () => {
      expect(() =>
        metricFromContract<Order>(orderContract, 'status', 'sum')
      ).toThrow(TypeMismatchError)
    })

    test('allows count on string field', () => {
      const met = metricFromContract<Order>(orderContract, 'status', 'count')

      expect(met.aggregation).toBe('count')
    })
  })

  describe('inferDimensions', () => {
    test('infers all dimensions from contract', () => {
      const dims = inferDimensions<Order>(orderContract)

      expect(dims.length).toBeGreaterThan(0)
      const fieldNames = dims.map((d) => d.field)
      expect(fieldNames).toContain('id')
      expect(fieldNames).toContain('status')
      expect(fieldNames).toContain('amount')
    })

    test('excludes specified fields', () => {
      const dims = inferDimensions<Order>(orderContract, {
        exclude: ['id', 'customerId'],
      })

      const fieldNames = dims.map((d) => d.field)
      expect(fieldNames).not.toContain('id')
      expect(fieldNames).not.toContain('customerId')
    })

    test('includes only specified fields', () => {
      const dims = inferDimensions<Order>(orderContract, {
        include: ['status', 'createdAt'],
      })

      expect(dims).toHaveLength(2)
      const fieldNames = dims.map((d) => d.field)
      expect(fieldNames).toContain('status')
      expect(fieldNames).toContain('createdAt')
    })
  })

  describe('inferMetrics', () => {
    test('infers numeric metrics with sum', () => {
      const mets = inferMetrics<Order>(orderContract, 'sum')

      // Should only include numeric fields
      const fieldNames = mets.map((m) => m.field)
      expect(fieldNames).toContain('amount')
      expect(fieldNames).toContain('quantity')
      expect(fieldNames).not.toContain('status')
    })

    test('infers count metrics for all fields', () => {
      const mets = inferMetrics<Order>(orderContract, 'count')

      // Count works on any field type
      expect(mets.length).toBeGreaterThan(2)
    })

    test('respects exclude option', () => {
      const mets = inferMetrics<Order>(orderContract, 'sum', {
        exclude: ['amount'],
      })

      const fieldNames = mets.map((m) => m.field)
      expect(fieldNames).not.toContain('amount')
    })

    test('respects include option', () => {
      const mets = inferMetrics<Order>(orderContract, 'sum', {
        include: ['amount'],
      })

      expect(mets).toHaveLength(1)
      expect(mets[0]?.field).toBe('amount')
    })
  })
})

// =============================================================================
// Utility Functions Tests
// =============================================================================

describe('Utility Functions', () => {
  let ordersCube: TypedCube<Order>
  let orderContract: DataContract

  beforeEach(() => {
    orderContract = createOrderContract()
    ordersCube = defineCube<Order>(orderContract, {
      name: 'Orders',
      sql: 'SELECT * FROM orders',
      dimensions: [
        dimension('status', 'string'),
        dimension('createdAt', 'time'),
      ],
      metrics: [
        metric('amount', 'sum'),
        metric('id', 'count'),
      ],
    })
  })

  describe('isBoundToContract', () => {
    test('returns true for matching contract', () => {
      expect(isBoundToContract(ordersCube, 'Order')).toBe(true)
    })

    test('returns false for non-matching contract', () => {
      expect(isBoundToContract(ordersCube, 'Customer')).toBe(false)
    })
  })

  describe('getCubeFields', () => {
    test('returns dimension and metric fields', () => {
      const fields = getCubeFields(ordersCube)

      expect(fields.dimensions).toEqual(['status', 'createdAt'])
      expect(fields.metrics).toEqual(['amount', 'id'])
    })
  })

  describe('toStandardCube', () => {
    test('converts typed cube to standard format', () => {
      const standard = toStandardCube(ordersCube)

      expect(standard.name).toBe('Orders')
      expect(standard.sql).toBe('SELECT * FROM orders')

      // Check measures
      expect(standard.measures.amount).toEqual({
        type: 'sum',
        sql: 'amount',
        description: undefined,
      })
      expect(standard.measures.id).toEqual({
        type: 'count',
        sql: 'id',
        description: undefined,
      })

      // Check dimensions
      expect(standard.dimensions.status).toEqual({
        type: 'string',
        sql: 'status',
        description: undefined,
      })
      expect(standard.dimensions.createdAt).toEqual({
        type: 'time',
        sql: 'createdAt',
        description: undefined,
      })
    })
  })
})

// =============================================================================
// Type Inference Tests (compile-time verification)
// =============================================================================

describe('Type Inference', () => {
  // These tests verify TypeScript type inference works correctly
  // They are primarily compile-time tests that will fail to compile if wrong

  test('dimension field is constrained to entity keys', () => {
    // This compiles because 'status' is a valid Order key
    const validDim = dimension<Order>('status', 'string')
    expect(validDim.field).toBe('status')

    // This would NOT compile (uncomment to verify):
    // const invalidDim = dimension<Order>('notAField', 'string')
  })

  test('metric field is constrained to entity keys', () => {
    // This compiles because 'amount' is a valid Order key
    const validMet = metric<Order>('amount', 'sum')
    expect(validMet.field).toBe('amount')

    // This would NOT compile (uncomment to verify):
    // const invalidMet = metric<Order>('notAField', 'sum')
  })

  test('query builder methods are type-safe', () => {
    const contract = createOrderContract()
    const cube = defineCube<Order>(contract, {
      name: 'Orders',
      sql: 'SELECT * FROM orders',
      dimensions: [dimension('status', 'string')],
      metrics: [metric('amount', 'sum')],
    })

    // This compiles because 'amount' is in metrics and 'status' is in dimensions
    const q = query(cube)
      .select('amount')
      .groupBy('status')
      .build()

    expect(q.measures).toContain('Orders.amount')

    // These would NOT compile (uncomment to verify):
    // query(cube).select('notAMetric')
    // query(cube).groupBy('notADimension')
  })

  test('drillMembers are constrained to entity keys', () => {
    // This compiles because 'id' and 'status' are valid Order keys
    const met = metric<Order>('amount', 'sum', {
      drillMembers: ['id', 'status'],
    })
    expect(met.drillMembers).toEqual(['id', 'status'])

    // This would NOT compile (uncomment to verify):
    // const invalidMet = metric<Order>('amount', 'sum', {
    //   drillMembers: ['notAField']
    // })
  })
})

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('Error Handling', () => {
  let orderContract: DataContract

  beforeEach(() => {
    orderContract = createOrderContract()
  })

  test('InvalidFieldError contains helpful message', () => {
    try {
      defineCube<Order>(orderContract, {
        name: 'Orders',
        sql: 'SELECT * FROM orders',
        dimensions: [
          // @ts-expect-error - Testing runtime validation
          dimension('nonExistent', 'string'),
        ],
        metrics: [],
      })
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidFieldError)
      expect((error as InvalidFieldError).message).toContain('nonExistent')
      expect((error as InvalidFieldError).message).toContain('Order')
      expect((error as InvalidFieldError).message).toContain('Available fields')
    }
  })

  test('TypeMismatchError contains helpful message', () => {
    try {
      defineCube<Order>(orderContract, {
        name: 'Orders',
        sql: 'SELECT * FROM orders',
        dimensions: [],
        metrics: [
          metric('status', 'sum'), // status is string, not number
        ],
      })
    } catch (error) {
      expect(error).toBeInstanceOf(TypeMismatchError)
      expect((error as TypeMismatchError).message).toContain('status')
      expect((error as TypeMismatchError).message).toContain('number')
      expect((error as TypeMismatchError).message).toContain('string')
    }
  })

  test('ContractIntegrationError for query builder errors', () => {
    const cube = defineCube<Order>(orderContract, {
      name: 'Orders',
      sql: 'SELECT * FROM orders',
      dimensions: [dimension('status', 'string')],
      metrics: [metric('amount', 'sum')],
    })

    try {
      // @ts-expect-error - Testing runtime validation
      query(cube).select('invalidMetric')
    } catch (error) {
      expect(error).toBeInstanceOf(ContractIntegrationError)
      expect((error as ContractIntegrationError).message).toContain('invalidMetric')
      expect((error as ContractIntegrationError).message).toContain('Available metrics')
    }
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('Integration', () => {
  test('full workflow: contract -> cube -> query', () => {
    // 1. Create contract
    const contract = createSchema({
      name: 'Sale',
      version: '1.0.0',
      schema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          revenue: { type: 'number' },
          cost: { type: 'number' },
          category: { type: 'string' },
          soldAt: { type: 'string', format: 'date-time' },
        },
        required: ['id', 'revenue', 'category', 'soldAt'],
      },
    })

    // 2. Define type for the contract
    type Sale = {
      id: string
      revenue: number
      cost: number
      category: string
      soldAt: string
    }

    // 3. Create typed cube
    const salesCube = defineCube<Sale>(contract, {
      name: 'Sales',
      sql: 'SELECT * FROM sales',
      dimensions: [
        dimension('category', 'string', { title: 'Product Category' }),
        dimension('soldAt', 'time', { granularity: 'day' }),
      ],
      metrics: [
        metric('revenue', 'sum', { format: 'currency', title: 'Total Revenue' }),
        metric('cost', 'sum', { format: 'currency', title: 'Total Cost' }),
        metric('id', 'count', { title: 'Number of Sales' }),
      ],
    })

    // 4. Build type-safe query
    const q = query(salesCube)
      .select('revenue', 'cost')
      .groupBy('category')
      .timeDimension('soldAt', 'month')
      .where('category', ['Electronics', 'Clothing'], 'in')
      .orderBy('revenue', true)
      .limit(10)
      .build()

    // 5. Verify query structure
    expect(q).toMatchObject({
      measures: ['Sales.revenue', 'Sales.cost'],
      dimensions: ['Sales.category'],
      timeDimensions: [{ dimension: 'Sales.soldAt', granularity: 'month' }],
      filters: [{ dimension: 'Sales.category', operator: 'in', values: ['Electronics', 'Clothing'] }],
      order: [{ id: 'Sales.revenue', desc: true }],
      limit: 10,
    })

    // 6. Can convert to standard cube format
    const standard = toStandardCube(salesCube)
    expect(standard.measures.revenue.type).toBe('sum')
    expect(standard.dimensions.category.type).toBe('string')
  })

  test('using inferred dimensions and metrics', () => {
    type Product = {
      id: string
      name: string
      price: number
      quantity: number
      createdAt: string
    }

    const contract = createSchema({
      name: 'Product',
      version: '1.0.0',
      schema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          price: { type: 'number' },
          quantity: { type: 'integer' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    })

    // Auto-infer dimensions and metrics
    const dimensions = inferDimensions<Product>(contract, { exclude: ['id'] })
    const metrics = inferMetrics<Product>(contract, 'sum')

    const cube = defineCube<Product>(contract, {
      name: 'Products',
      sql: 'SELECT * FROM products',
      dimensions,
      metrics,
    })

    // Verify inference worked
    const fields = getCubeFields(cube)
    expect(fields.dimensions).toContain('name')
    expect(fields.dimensions).toContain('createdAt')
    expect(fields.metrics).toContain('price')
    expect(fields.metrics).toContain('quantity')
  })
})
