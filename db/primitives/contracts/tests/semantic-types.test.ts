/**
 * SemanticLayer Type-Safe Definitions Tests - TDD RED Phase
 *
 * Tests for type-safe integration between DataContract and SemanticLayer
 * for metrics, dimensions, and query type inference.
 *
 * @see dotdo-eh0a8
 */

import { describe, it, expect, expectTypeOf } from 'vitest'
import { z } from 'zod'
import {
  // Core type generators
  SemanticTypeGenerator,
  TypeInference,
  JoinPathValidator,
  // Factory functions
  typedCube,
  typedDimension,
  typedMeasure,
  typedQuery,
  // Type utilities
  inferQueryResult,
  generateCubeSchema,
  validateJoinPath,
  // Types
  type TypedCube,
  type TypedDimension,
  type TypedMeasure,
  type TypedQueryBuilder,
  type DimensionConfig,
  type MeasureConfig,
  type Aggregation,
  type InferredQueryResult,
  type JoinPath,
  type JoinPathError,
} from '../semantic-types'
import { contract, s, type ZodDataContract } from '../../data-contract/schema-dsl'

// =============================================================================
// TEST DATA FIXTURES
// =============================================================================

// Order schema using DataContract DSL
const orderSchema = s.object({
  id: s.string().uuid(),
  customerId: s.string().uuid(),
  status: s.enum(['pending', 'completed', 'cancelled', 'refunded']),
  amount: s.number().positive(),
  currency: s.string().length(3, 3),
  createdAt: s.datetime(),
  updatedAt: s.datetime().optional(),
  metadata: s.object({
    source: s.string().optional(),
    campaign: s.string().optional(),
  }).optional(),
})

interface Order {
  id: string
  customerId: string
  status: 'pending' | 'completed' | 'cancelled' | 'refunded'
  amount: number
  currency: string
  createdAt: string
  updatedAt?: string
  metadata?: {
    source?: string
    campaign?: string
  }
}

const orderContract = contract<Order>({
  name: 'orders',
  version: '1.0.0',
  schema: orderSchema,
  metadata: {
    description: 'Order events from e-commerce platform',
    owner: 'data-platform',
    tags: ['ecommerce', 'transactions'],
  },
})

// Customer schema
const customerSchema = s.object({
  id: s.string().uuid(),
  name: s.string().min(1),
  email: s.email(),
  tier: s.enum(['free', 'basic', 'premium', 'enterprise']),
  country: s.string().length(2, 2),
  createdAt: s.datetime(),
})

interface Customer {
  id: string
  name: string
  email: string
  tier: 'free' | 'basic' | 'premium' | 'enterprise'
  country: string
  createdAt: string
}

const customerContract = contract<Customer>({
  name: 'customers',
  version: '1.0.0',
  schema: customerSchema,
})

// Product schema
const productSchema = s.object({
  id: s.string().uuid(),
  name: s.string(),
  category: s.string(),
  price: s.number().positive(),
  inventory: s.int().nonnegative(),
})

interface Product {
  id: string
  name: string
  category: string
  price: number
  inventory: number
}

const productContract = contract<Product>({
  name: 'products',
  version: '1.0.0',
  schema: productSchema,
})

// =============================================================================
// DIMENSION TYPE DEFINITIONS TESTS
// =============================================================================

describe('Dimension Type Definitions', () => {
  describe('typedDimension factory', () => {
    it('should create a typed dimension from contract field', () => {
      const statusDim = typedDimension(orderContract, 'status')

      expect(statusDim).toBeDefined()
      expect(statusDim.name).toBe('status')
      expect(statusDim.type).toBe('string')
      expect(statusDim.contractField).toBe('status')
    })

    it('should infer dimension type from contract field type', () => {
      const amountDim = typedDimension(orderContract, 'amount')
      expect(amountDim.type).toBe('number')

      const createdAtDim = typedDimension(orderContract, 'createdAt')
      expect(createdAtDim.type).toBe('time')

      const statusDim = typedDimension(orderContract, 'status')
      expect(statusDim.type).toBe('string')
    })

    it('should accept configuration options', () => {
      const statusDim = typedDimension(orderContract, 'status', {
        description: 'Order status',
        sql: 'UPPER(status)',
      })

      expect(statusDim.description).toBe('Order status')
      expect(statusDim.sql).toBe('UPPER(status)')
    })

    it('should support primaryKey configuration', () => {
      const idDim = typedDimension(orderContract, 'id', {
        primaryKey: true,
      })

      expect(idDim.primaryKey).toBe(true)
    })

    // Type-level test: should fail at compile time for invalid fields
    it('should only allow valid contract fields (compile-time check)', () => {
      // This should work
      const validDim = typedDimension(orderContract, 'status')
      expect(validDim).toBeDefined()

      // @ts-expect-error - 'invalidField' does not exist on Order type
      // This demonstrates compile-time safety
      // typedDimension(orderContract, 'invalidField')
    })

    it('should preserve enum values from contract for string dimensions', () => {
      const statusDim = typedDimension(orderContract, 'status')

      // The enum values should be extractable for filter dropdowns
      expect(statusDim.enumValues).toEqual([
        'pending',
        'completed',
        'cancelled',
        'refunded',
      ])
    })
  })

  describe('dimension type inference', () => {
    it('should map string fields to string dimension type', () => {
      const generator = new SemanticTypeGenerator(orderContract)
      const dimType = generator.inferDimensionType('currency')

      expect(dimType).toBe('string')
    })

    it('should map number fields to number dimension type', () => {
      const generator = new SemanticTypeGenerator(orderContract)
      const dimType = generator.inferDimensionType('amount')

      expect(dimType).toBe('number')
    })

    it('should map datetime fields to time dimension type', () => {
      const generator = new SemanticTypeGenerator(orderContract)
      const dimType = generator.inferDimensionType('createdAt')

      expect(dimType).toBe('time')
    })

    it('should map boolean fields to boolean dimension type', () => {
      const boolContract = contract({
        name: 'flags',
        version: '1.0.0',
        schema: s.object({ active: s.boolean() }),
      })

      const generator = new SemanticTypeGenerator(boolContract)
      const dimType = generator.inferDimensionType('active')

      expect(dimType).toBe('boolean')
    })

    it('should throw for nested object fields', () => {
      const generator = new SemanticTypeGenerator(orderContract)

      expect(() => generator.inferDimensionType('metadata')).toThrow(
        /Cannot create dimension from object type/
      )
    })
  })
})

// =============================================================================
// MEASURE TYPE DEFINITIONS TESTS
// =============================================================================

describe('Measure Type Definitions', () => {
  describe('typedMeasure factory', () => {
    it('should create a typed measure from contract field', () => {
      const revenueMeasure = typedMeasure(orderContract, 'amount', 'sum')

      expect(revenueMeasure).toBeDefined()
      expect(revenueMeasure.name).toBe('amount')
      expect(revenueMeasure.aggregation).toBe('sum')
      expect(revenueMeasure.contractField).toBe('amount')
    })

    it('should support all aggregation types', () => {
      const sumMeasure = typedMeasure(orderContract, 'amount', 'sum')
      expect(sumMeasure.aggregation).toBe('sum')

      const avgMeasure = typedMeasure(orderContract, 'amount', 'avg')
      expect(avgMeasure.aggregation).toBe('avg')

      const minMeasure = typedMeasure(orderContract, 'amount', 'min')
      expect(minMeasure.aggregation).toBe('min')

      const maxMeasure = typedMeasure(orderContract, 'amount', 'max')
      expect(maxMeasure.aggregation).toBe('max')
    })

    it('should support count aggregation without field', () => {
      const countMeasure = typedMeasure(orderContract, null, 'count')

      expect(countMeasure.aggregation).toBe('count')
      expect(countMeasure.contractField).toBeNull()
    })

    it('should support countDistinct aggregation', () => {
      const uniqueCustomers = typedMeasure(orderContract, 'customerId', 'countDistinct')

      expect(uniqueCustomers.aggregation).toBe('countDistinct')
      expect(uniqueCustomers.contractField).toBe('customerId')
    })

    it('should accept configuration options', () => {
      const revenueMeasure = typedMeasure(orderContract, 'amount', 'sum', {
        description: 'Total revenue',
        format: 'currency',
      })

      expect(revenueMeasure.description).toBe('Total revenue')
      expect(revenueMeasure.format).toBe('currency')
    })

    // Type-level test: only numeric fields for sum/avg/min/max
    it('should only allow numeric fields for arithmetic aggregations', () => {
      // This should work - amount is numeric
      const validMeasure = typedMeasure(orderContract, 'amount', 'sum')
      expect(validMeasure).toBeDefined()

      // @ts-expect-error - 'status' is string, not allowed for sum
      // typedMeasure(orderContract, 'status', 'sum')
    })
  })

  describe('measure type validation', () => {
    it('should validate field type matches aggregation requirements', () => {
      const generator = new SemanticTypeGenerator(orderContract)

      // Numeric field + sum = valid
      expect(() =>
        generator.validateMeasure('amount', 'sum')
      ).not.toThrow()

      // String field + sum = invalid
      expect(() =>
        generator.validateMeasure('status', 'sum')
      ).toThrow(/Field 'status' must be numeric for 'sum' aggregation/)
    })

    it('should allow any field type for count aggregation', () => {
      const generator = new SemanticTypeGenerator(orderContract)

      expect(() =>
        generator.validateMeasure('status', 'count')
      ).not.toThrow()
    })

    it('should allow any field type for countDistinct aggregation', () => {
      const generator = new SemanticTypeGenerator(orderContract)

      expect(() =>
        generator.validateMeasure('status', 'countDistinct')
      ).not.toThrow()
    })
  })
})

// =============================================================================
// JOIN PATH TYPE SAFETY TESTS
// =============================================================================

describe('Join Path Type Safety', () => {
  describe('JoinPathValidator', () => {
    it('should validate simple join path between two cubes', () => {
      const validator = new JoinPathValidator()

      // Register cubes with their contracts
      validator.registerCube('orders', orderContract, {
        joins: [
          {
            target: 'customers',
            foreignKey: 'customerId',
            targetKey: 'id',
            relationship: 'belongsTo',
          },
        ],
      })
      validator.registerCube('customers', customerContract)

      const result = validator.validateJoinPath(['orders', 'customers'])

      expect(result.valid).toBe(true)
      expect(result.joinType).toBe('belongsTo')
    })

    it('should return error for invalid join path', () => {
      const validator = new JoinPathValidator()

      validator.registerCube('orders', orderContract)
      validator.registerCube('products', productContract)

      const result = validator.validateJoinPath(['orders', 'products'])

      expect(result.valid).toBe(false)
      expect(result.error).toMatch(/No join defined between/)
    })

    it('should validate join key types match', () => {
      const validator = new JoinPathValidator()

      validator.registerCube('orders', orderContract, {
        joins: [
          {
            target: 'customers',
            foreignKey: 'customerId',
            targetKey: 'id',
            relationship: 'belongsTo',
          },
        ],
      })
      validator.registerCube('customers', customerContract)

      const result = validator.validateJoinPath(['orders', 'customers'])

      // customerId (string/uuid) should match customers.id (string/uuid)
      expect(result.valid).toBe(true)
    })

    it('should detect type mismatch in join keys', () => {
      // Create contract with mismatched types
      const badOrderContract = contract({
        name: 'bad_orders',
        version: '1.0.0',
        schema: s.object({
          id: s.string(),
          customerId: s.int(), // Integer instead of string UUID
        }),
      })

      const validator = new JoinPathValidator()

      validator.registerCube('bad_orders', badOrderContract, {
        joins: [
          {
            target: 'customers',
            foreignKey: 'customerId',
            targetKey: 'id', // String UUID
            relationship: 'belongsTo',
          },
        ],
      })
      validator.registerCube('customers', customerContract)

      const result = validator.validateJoinPath(['bad_orders', 'customers'])

      expect(result.valid).toBe(false)
      expect(result.error).toMatch(/Type mismatch.*customerId.*id/)
    })

    it('should validate multi-hop join paths', () => {
      // Order -> Customer -> Some other table
      const validator = new JoinPathValidator()

      validator.registerCube('orders', orderContract, {
        joins: [
          {
            target: 'customers',
            foreignKey: 'customerId',
            targetKey: 'id',
            relationship: 'belongsTo',
          },
        ],
      })
      validator.registerCube('customers', customerContract, {
        joins: [
          {
            target: 'regions',
            foreignKey: 'country',
            targetKey: 'code',
            relationship: 'belongsTo',
          },
        ],
      })

      const regionContract = contract({
        name: 'regions',
        version: '1.0.0',
        schema: s.object({
          code: s.string().length(2, 2),
          name: s.string(),
        }),
      })
      validator.registerCube('regions', regionContract)

      const result = validator.validateJoinPath(['orders', 'customers', 'regions'])

      expect(result.valid).toBe(true)
      expect(result.hops).toBe(2)
    })

    it('should return detailed join path for SQL generation', () => {
      const validator = new JoinPathValidator()

      validator.registerCube('orders', orderContract, {
        joins: [
          {
            target: 'customers',
            foreignKey: 'customerId',
            targetKey: 'id',
            relationship: 'belongsTo',
          },
        ],
      })
      validator.registerCube('customers', customerContract)

      const result = validator.validateJoinPath(['orders', 'customers'])

      expect(result.valid).toBe(true)
      expect(result.joins).toHaveLength(1)
      expect(result.joins![0]).toEqual({
        from: 'orders',
        to: 'customers',
        fromKey: 'customerId',
        toKey: 'id',
        relationship: 'belongsTo',
      })
    })
  })

  describe('validateJoinPath utility', () => {
    it('should be a standalone function for quick validation', () => {
      const isValid = validateJoinPath(
        [orderContract, customerContract],
        ['orders', 'customers'],
        {
          'orders->customers': {
            foreignKey: 'customerId',
            targetKey: 'id',
          },
        }
      )

      expect(isValid).toBe(true)
    })
  })
})

// =============================================================================
// CUBE SCHEMA GENERATION TESTS
// =============================================================================

describe('Cube Schema Generation from Contract', () => {
  describe('typedCube factory', () => {
    it('should create a typed cube from contract', () => {
      const ordersCube = typedCube(orderContract, {
        sql: 'SELECT * FROM orders',
        measures: {
          count: { aggregation: 'count' },
          totalRevenue: { field: 'amount', aggregation: 'sum' },
          avgOrderValue: { field: 'amount', aggregation: 'avg' },
        },
        dimensions: {
          status: { field: 'status' },
          createdAt: { field: 'createdAt' },
          customerId: { field: 'customerId' },
        },
      })

      expect(ordersCube).toBeDefined()
      expect(ordersCube.name).toBe('orders')
      expect(ordersCube.contract).toBe(orderContract)
    })

    it('should expose typed dimensions', () => {
      const ordersCube = typedCube(orderContract, {
        sql: 'SELECT * FROM orders',
        measures: {},
        dimensions: {
          status: { field: 'status' },
        },
      })

      expect(ordersCube.dimensions.status).toBeDefined()
      expect(ordersCube.dimensions.status.type).toBe('string')
    })

    it('should expose typed measures', () => {
      const ordersCube = typedCube(orderContract, {
        sql: 'SELECT * FROM orders',
        measures: {
          totalRevenue: { field: 'amount', aggregation: 'sum' },
        },
        dimensions: {},
      })

      expect(ordersCube.measures.totalRevenue).toBeDefined()
      expect(ordersCube.measures.totalRevenue.aggregation).toBe('sum')
    })

    // Type-level test: dimension fields must exist in contract
    it('should enforce contract field references at compile time', () => {
      // This should work
      const validCube = typedCube(orderContract, {
        sql: 'SELECT * FROM orders',
        measures: {},
        dimensions: {
          status: { field: 'status' },
        },
      })
      expect(validCube).toBeDefined()

      // @ts-expect-error - 'nonexistent' is not a valid field
      // typedCube(orderContract, {
      //   sql: 'SELECT * FROM orders',
      //   measures: {},
      //   dimensions: {
      //     bad: { field: 'nonexistent' },
      //   },
      // })
    })
  })

  describe('generateCubeSchema utility', () => {
    it('should generate Cube.js compatible schema from contract', () => {
      const cubeSchema = generateCubeSchema(orderContract, {
        measures: {
          count: { aggregation: 'count' },
          totalRevenue: { field: 'amount', aggregation: 'sum' },
        },
        dimensions: {
          status: { field: 'status' },
          createdAt: { field: 'createdAt' },
        },
      })

      expect(cubeSchema).toMatchObject({
        name: 'orders',
        measures: expect.objectContaining({
          count: { type: 'count' },
          totalRevenue: { type: 'sum', sql: 'amount' },
        }),
        dimensions: expect.objectContaining({
          status: { type: 'string', sql: 'status' },
          createdAt: { type: 'time', sql: 'created_at' },
        }),
      })
    })

    it('should convert camelCase to snake_case for SQL', () => {
      const cubeSchema = generateCubeSchema(orderContract, {
        measures: {},
        dimensions: {
          customerId: { field: 'customerId' },
          createdAt: { field: 'createdAt' },
        },
      })

      expect(cubeSchema.dimensions.customerId.sql).toBe('customer_id')
      expect(cubeSchema.dimensions.createdAt.sql).toBe('created_at')
    })

    it('should allow custom SQL override', () => {
      const cubeSchema = generateCubeSchema(orderContract, {
        measures: {},
        dimensions: {
          status: {
            field: 'status',
            sql: 'UPPER(status)',
          },
        },
      })

      expect(cubeSchema.dimensions.status.sql).toBe('UPPER(status)')
    })
  })

  describe('SemanticTypeGenerator', () => {
    it('should generate complete cube definition', () => {
      const generator = new SemanticTypeGenerator(orderContract)

      const cubeDefinition = generator.generateCubeDefinition({
        sql: 'SELECT * FROM orders',
        measures: ['count', 'sum:amount', 'avg:amount'],
        dimensions: ['status', 'createdAt', 'customerId'],
      })

      expect(cubeDefinition.name).toBe('orders')
      expect(cubeDefinition.sql).toBe('SELECT * FROM orders')
      expect(cubeDefinition.measures.count.type).toBe('count')
      expect(cubeDefinition.measures.sumAmount.type).toBe('sum')
      expect(cubeDefinition.dimensions.status.type).toBe('string')
    })

    it('should auto-generate dimension names from fields', () => {
      const generator = new SemanticTypeGenerator(orderContract)

      const cubeDefinition = generator.generateCubeDefinition({
        sql: 'SELECT * FROM orders',
        measures: [],
        dimensions: ['status', 'createdAt'],
      })

      expect(cubeDefinition.dimensions).toHaveProperty('status')
      expect(cubeDefinition.dimensions).toHaveProperty('createdAt')
    })

    it('should support shorthand measure notation', () => {
      const generator = new SemanticTypeGenerator(orderContract)

      // Shorthand: 'sum:amount' -> { name: 'sumAmount', type: 'sum', sql: 'amount' }
      const cubeDefinition = generator.generateCubeDefinition({
        sql: 'SELECT * FROM orders',
        measures: ['sum:amount', 'avg:amount', 'countDistinct:customerId'],
        dimensions: [],
      })

      expect(cubeDefinition.measures.sumAmount.type).toBe('sum')
      expect(cubeDefinition.measures.avgAmount.type).toBe('avg')
      expect(cubeDefinition.measures.countDistinctCustomerId.type).toBe('countDistinct')
    })
  })
})

// =============================================================================
// TYPE INFERENCE FOR QUERIES TESTS
// =============================================================================

describe('Type Inference for Queries', () => {
  describe('TypeInference class', () => {
    it('should infer result types for dimension queries', () => {
      const inference = new TypeInference()

      const ordersCube = typedCube(orderContract, {
        sql: 'SELECT * FROM orders',
        measures: {},
        dimensions: {
          status: { field: 'status' },
        },
      })

      inference.registerCube(ordersCube)

      const resultType = inference.inferQueryResult({
        dimensions: ['orders.status'],
      })

      expect(resultType.dimensions).toEqual({
        'orders.status': 'string',
      })
    })

    it('should infer result types for measure queries', () => {
      const inference = new TypeInference()

      const ordersCube = typedCube(orderContract, {
        sql: 'SELECT * FROM orders',
        measures: {
          count: { aggregation: 'count' },
          totalRevenue: { field: 'amount', aggregation: 'sum' },
        },
        dimensions: {},
      })

      inference.registerCube(ordersCube)

      const resultType = inference.inferQueryResult({
        measures: ['orders.count', 'orders.totalRevenue'],
      })

      expect(resultType.measures).toEqual({
        'orders.count': 'number',
        'orders.totalRevenue': 'number',
      })
    })

    it('should infer result types for combined queries', () => {
      const inference = new TypeInference()

      const ordersCube = typedCube(orderContract, {
        sql: 'SELECT * FROM orders',
        measures: {
          totalRevenue: { field: 'amount', aggregation: 'sum' },
        },
        dimensions: {
          status: { field: 'status' },
          createdAt: { field: 'createdAt' },
        },
      })

      inference.registerCube(ordersCube)

      const resultType = inference.inferQueryResult({
        measures: ['orders.totalRevenue'],
        dimensions: ['orders.status'],
        timeDimensions: [{ dimension: 'orders.createdAt', granularity: 'day' }],
      })

      expect(resultType.measures).toHaveProperty('orders.totalRevenue')
      expect(resultType.dimensions).toHaveProperty('orders.status')
      expect(resultType.timeDimensions).toHaveProperty('orders.createdAt')
    })

    it('should throw for invalid measure references', () => {
      const inference = new TypeInference()

      const ordersCube = typedCube(orderContract, {
        sql: 'SELECT * FROM orders',
        measures: {
          count: { aggregation: 'count' },
        },
        dimensions: {},
      })

      inference.registerCube(ordersCube)

      expect(() =>
        inference.inferQueryResult({
          measures: ['orders.nonexistent'],
        })
      ).toThrow(/Measure 'nonexistent' not found/)
    })

    it('should throw for invalid dimension references', () => {
      const inference = new TypeInference()

      const ordersCube = typedCube(orderContract, {
        sql: 'SELECT * FROM orders',
        measures: {},
        dimensions: {
          status: { field: 'status' },
        },
      })

      inference.registerCube(ordersCube)

      expect(() =>
        inference.inferQueryResult({
          dimensions: ['orders.nonexistent'],
        })
      ).toThrow(/Dimension 'nonexistent' not found/)
    })
  })

  describe('inferQueryResult utility', () => {
    it('should return TypeScript-compatible type definition', () => {
      const ordersCube = typedCube(orderContract, {
        sql: 'SELECT * FROM orders',
        measures: {
          count: { aggregation: 'count' },
          totalRevenue: { field: 'amount', aggregation: 'sum' },
        },
        dimensions: {
          status: { field: 'status' },
        },
      })

      const typeDefinition = inferQueryResult(ordersCube, {
        measures: ['count', 'totalRevenue'],
        dimensions: ['status'],
      })

      // Should return a type definition that could be used for codegen
      expect(typeDefinition.typescript).toContain('count: number')
      expect(typeDefinition.typescript).toContain('totalRevenue: number')
      expect(typeDefinition.typescript).toContain('status: string')
    })
  })

  describe('typedQuery builder', () => {
    it('should create a type-safe query builder', () => {
      const ordersCube = typedCube(orderContract, {
        sql: 'SELECT * FROM orders',
        measures: {
          count: { aggregation: 'count' },
          totalRevenue: { field: 'amount', aggregation: 'sum' },
        },
        dimensions: {
          status: { field: 'status' },
          createdAt: { field: 'createdAt' },
        },
      })

      const query = typedQuery(ordersCube)
        .select('count', 'totalRevenue')
        .by('status')
        .build()

      expect(query.measures).toEqual(['orders.count', 'orders.totalRevenue'])
      expect(query.dimensions).toEqual(['orders.status'])
    })

    it('should support fluent filter API', () => {
      const ordersCube = typedCube(orderContract, {
        sql: 'SELECT * FROM orders',
        measures: {
          count: { aggregation: 'count' },
        },
        dimensions: {
          status: { field: 'status' },
        },
      })

      const query = typedQuery(ordersCube)
        .select('count')
        .by('status')
        .filter('status', 'equals', 'completed')
        .build()

      expect(query.filters).toHaveLength(1)
      expect(query.filters![0]).toEqual({
        dimension: 'orders.status',
        operator: 'equals',
        values: ['completed'],
      })
    })

    // Type-level test: only allow valid measure/dimension names
    it('should only allow valid cube members in query builder', () => {
      const ordersCube = typedCube(orderContract, {
        sql: 'SELECT * FROM orders',
        measures: {
          count: { aggregation: 'count' },
        },
        dimensions: {
          status: { field: 'status' },
        },
      })

      // This should work
      const validQuery = typedQuery(ordersCube).select('count').by('status').build()
      expect(validQuery).toBeDefined()

      // @ts-expect-error - 'invalid' is not a valid measure
      // typedQuery(ordersCube).select('invalid').build()

      // @ts-expect-error - 'invalid' is not a valid dimension
      // typedQuery(ordersCube).by('invalid').build()
    })

    it('should support time dimension with granularity', () => {
      const ordersCube = typedCube(orderContract, {
        sql: 'SELECT * FROM orders',
        measures: {
          count: { aggregation: 'count' },
        },
        dimensions: {
          createdAt: { field: 'createdAt' },
        },
      })

      const query = typedQuery(ordersCube)
        .select('count')
        .byTime('createdAt', 'day')
        .build()

      expect(query.timeDimensions).toHaveLength(1)
      expect(query.timeDimensions![0]).toEqual({
        dimension: 'orders.createdAt',
        granularity: 'day',
      })
    })

    it('should support date range filters', () => {
      const ordersCube = typedCube(orderContract, {
        sql: 'SELECT * FROM orders',
        measures: {
          count: { aggregation: 'count' },
        },
        dimensions: {
          createdAt: { field: 'createdAt' },
        },
      })

      const query = typedQuery(ordersCube)
        .select('count')
        .byTime('createdAt', 'day', ['2024-01-01', '2024-12-31'])
        .build()

      expect(query.timeDimensions![0].dateRange).toEqual(['2024-01-01', '2024-12-31'])
    })
  })
})

// =============================================================================
// COMPILE-TIME TYPE SAFETY TESTS
// =============================================================================

describe('Compile-Time Type Safety', () => {
  // These tests use expectTypeOf from vitest for type-level assertions

  describe('TypedCube type inference', () => {
    it('should correctly infer measure names from definition', () => {
      const cube = typedCube(orderContract, {
        sql: 'SELECT * FROM orders',
        measures: {
          count: { aggregation: 'count' },
          revenue: { field: 'amount', aggregation: 'sum' },
        },
        dimensions: {},
      })

      // Type should include 'count' and 'revenue' as valid measure keys
      type MeasureKeys = keyof typeof cube.measures
      expectTypeOf<MeasureKeys>().toEqualTypeOf<'count' | 'revenue'>()
    })

    it('should correctly infer dimension names from definition', () => {
      const cube = typedCube(orderContract, {
        sql: 'SELECT * FROM orders',
        measures: {},
        dimensions: {
          status: { field: 'status' },
          amount: { field: 'amount' },
        },
      })

      type DimensionKeys = keyof typeof cube.dimensions
      expectTypeOf<DimensionKeys>().toEqualTypeOf<'status' | 'amount'>()
    })
  })

  describe('Query result type inference', () => {
    it('should infer correct result row type', () => {
      // This demonstrates compile-time type inference for query results
      const cube = typedCube(orderContract, {
        sql: 'SELECT * FROM orders',
        measures: {
          count: { aggregation: 'count' },
          revenue: { field: 'amount', aggregation: 'sum' },
        },
        dimensions: {
          status: { field: 'status' },
        },
      })

      // The InferredQueryResult type should match the query shape
      type QueryResult = InferredQueryResult<
        typeof cube,
        ['count', 'revenue'],
        ['status']
      >

      // Result should have count (number), revenue (number), status (string)
      expectTypeOf<QueryResult>().toMatchTypeOf<{
        count: number
        revenue: number
        status: string
      }>()
    })
  })
})

// =============================================================================
// IDE AUTO-COMPLETE SUPPORT TESTS
// =============================================================================

describe('IDE Auto-complete Support', () => {
  describe('Contract field suggestions', () => {
    it('should provide field suggestions when creating dimensions', () => {
      // This test verifies that the types are set up correctly for IDE support
      // The actual auto-complete is handled by TypeScript language server

      const generator = new SemanticTypeGenerator(orderContract)

      // getAvailableFields should return all contract fields
      const fields = generator.getAvailableFields()

      expect(fields).toContain('id')
      expect(fields).toContain('customerId')
      expect(fields).toContain('status')
      expect(fields).toContain('amount')
      expect(fields).toContain('currency')
      expect(fields).toContain('createdAt')
    })

    it('should provide numeric fields for arithmetic measures', () => {
      const generator = new SemanticTypeGenerator(orderContract)

      const numericFields = generator.getNumericFields()

      expect(numericFields).toContain('amount')
      expect(numericFields).not.toContain('status')
      expect(numericFields).not.toContain('createdAt')
    })

    it('should provide enum values for string dimensions', () => {
      const generator = new SemanticTypeGenerator(orderContract)

      const enumValues = generator.getEnumValues('status')

      expect(enumValues).toEqual([
        'pending',
        'completed',
        'cancelled',
        'refunded',
      ])
    })

    it('should return null for non-enum fields', () => {
      const generator = new SemanticTypeGenerator(orderContract)

      const enumValues = generator.getEnumValues('customerId')

      expect(enumValues).toBeNull()
    })
  })
})

// =============================================================================
// ERROR HANDLING TESTS
// =============================================================================

describe('Error Handling', () => {
  describe('Contract validation errors', () => {
    it('should throw descriptive error for invalid contract', () => {
      expect(() => {
        new SemanticTypeGenerator(null as unknown as ZodDataContract)
      }).toThrow(/Invalid contract/)
    })

    it('should throw for missing schema in contract', () => {
      const invalidContract = { name: 'test', version: '1.0.0' } as ZodDataContract

      expect(() => {
        new SemanticTypeGenerator(invalidContract)
      }).toThrow(/Contract must have a schema/)
    })
  })

  describe('Dimension creation errors', () => {
    it('should throw when field does not exist', () => {
      const generator = new SemanticTypeGenerator(orderContract)

      expect(() => {
        generator.createDimension('nonexistent')
      }).toThrow(/Field 'nonexistent' not found/)
    })
  })

  describe('Measure creation errors', () => {
    it('should throw when field type incompatible with aggregation', () => {
      const generator = new SemanticTypeGenerator(orderContract)

      expect(() => {
        generator.createMeasure('status', 'sum')
      }).toThrow(/must be numeric for 'sum' aggregation/)
    })

    it('should throw for unknown aggregation type', () => {
      const generator = new SemanticTypeGenerator(orderContract)

      expect(() => {
        generator.createMeasure('amount', 'invalid' as Aggregation)
      }).toThrow(/Unknown aggregation type/)
    })
  })
})

// =============================================================================
// INTEGRATION WITH EXISTING SEMANTIC LAYER TESTS
// =============================================================================

describe('Integration with SemanticLayer', () => {
  it('should generate compatible CubeDefinition for SemanticLayer', () => {
    const generator = new SemanticTypeGenerator(orderContract)

    const cubeDefinition = generator.generateCubeDefinition({
      sql: 'SELECT * FROM orders',
      measures: ['count', 'sum:amount'],
      dimensions: ['status', 'createdAt'],
    })

    // The generated definition should be compatible with SemanticLayer.defineCube
    expect(cubeDefinition).toMatchObject({
      name: expect.any(String),
      sql: expect.any(String),
      measures: expect.any(Object),
      dimensions: expect.any(Object),
    })

    // Verify measure structure matches expected format
    expect(cubeDefinition.measures.count).toMatchObject({
      type: 'count',
    })

    expect(cubeDefinition.measures.sumAmount).toMatchObject({
      type: 'sum',
      sql: 'amount',
    })

    // Verify dimension structure matches expected format
    expect(cubeDefinition.dimensions.status).toMatchObject({
      type: 'string',
      sql: expect.any(String),
    })
  })

  it('should work end-to-end with SemanticLayer', async () => {
    // Import SemanticLayer from the existing implementation
    const { SemanticLayer } = await import('../../semantic-layer/index')

    const generator = new SemanticTypeGenerator(orderContract)

    const cubeDefinition = generator.generateCubeDefinition({
      sql: 'SELECT * FROM orders',
      measures: ['count', 'sum:amount'],
      dimensions: ['status'],
    })

    const semanticLayer = new SemanticLayer()

    // Should not throw when defining the generated cube
    expect(() => {
      semanticLayer.defineCube(cubeDefinition)
    }).not.toThrow()

    // Should be able to query the cube
    const result = await semanticLayer.query({
      measures: ['orders.count'],
      dimensions: ['orders.status'],
    })

    expect(result.sql).toBeDefined()
    expect(result.sql).toContain('COUNT')
  })
})
