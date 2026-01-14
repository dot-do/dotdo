/**
 * Expectation DSL tests - Fluent API for data contract validation
 *
 * RED phase: These tests define the expected behavior of the Expectation DSL.
 * All tests should FAIL until implementation is complete.
 *
 * The Expectation DSL provides:
 * - Fluent builder pattern for defining expectations on data columns
 * - Null/unique/pattern constraints
 * - Comparison operations (greater than, less than, between)
 * - Type checks (string, number, date, boolean)
 * - Aggregate expectations (count, sum, avg)
 * - Logical chaining with .and(), .or()
 * - Building to Expectation objects for the validator
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  expect as exp,
  Expectation,
  ExpectationBuilder,
  ExpectationResult,
  validateExpectations,
  type ExpectationType,
  // Table-centric API
  expectTable,
  TableExpectationBuilder,
  ChainedColumnBuilder,
  TableExpectationDefinition,
  validateTableExpectations,
  serializeTableExpectations,
  deserializeTableExpectations,
} from '../expectation-dsl'

// ============================================================================
// BASIC EXPECTATIONS
// ============================================================================

describe('Expectation DSL', () => {
  describe('expect() entry point', () => {
    it('should create an expectation builder for a column', () => {
      const builder = exp('email')

      expect(builder).toBeInstanceOf(ExpectationBuilder)
      expect(builder.column).toBe('email')
    })

    it('should support multiple columns', () => {
      const builder1 = exp('email')
      const builder2 = exp('age')

      expect(builder1.column).toBe('email')
      expect(builder2.column).toBe('age')
    })
  })

  // ============================================================================
  // NOT NULL EXPECTATIONS
  // ============================================================================

  describe('toBeNotNull()', () => {
    it('should create a not-null expectation', () => {
      const expectation = exp('email').toBeNotNull().build()

      expect(expectation.column).toBe('email')
      expect(expectation.type).toBe('not_null')
    })

    it('should pass for non-null values', () => {
      const expectation = exp('email').toBeNotNull().build()

      const result = validateExpectations([expectation], [{ email: 'test@example.com' }])

      expect(result.passed).toBe(true)
      expect(result.failures).toHaveLength(0)
    })

    it('should fail for null values', () => {
      const expectation = exp('email').toBeNotNull().build()

      const result = validateExpectations([expectation], [{ email: null }])

      expect(result.passed).toBe(false)
      expect(result.failures).toHaveLength(1)
      expect(result.failures[0].column).toBe('email')
      expect(result.failures[0].expectationType).toBe('not_null')
    })

    it('should fail for undefined values', () => {
      const expectation = exp('email').toBeNotNull().build()

      const result = validateExpectations([expectation], [{ name: 'Alice' }])

      expect(result.passed).toBe(false)
    })
  })

  // ============================================================================
  // UNIQUE EXPECTATIONS
  // ============================================================================

  describe('toBeUnique()', () => {
    it('should create a unique expectation', () => {
      const expectation = exp('id').toBeUnique().build()

      expect(expectation.column).toBe('id')
      expect(expectation.type).toBe('unique')
    })

    it('should pass when all values are unique', () => {
      const expectation = exp('id').toBeUnique().build()

      const result = validateExpectations([expectation], [{ id: 1 }, { id: 2 }, { id: 3 }])

      expect(result.passed).toBe(true)
    })

    it('should fail when there are duplicate values', () => {
      const expectation = exp('id').toBeUnique().build()

      const result = validateExpectations([expectation], [{ id: 1 }, { id: 2 }, { id: 1 }])

      expect(result.passed).toBe(false)
      expect(result.failures[0].message).toContain('duplicate')
    })

    it('should pass when null values exist (nulls are not considered duplicates)', () => {
      const expectation = exp('id').toBeUnique().build()

      const result = validateExpectations([expectation], [{ id: 1 }, { id: null }, { id: null }])

      expect(result.passed).toBe(true)
    })
  })

  // ============================================================================
  // REGEX PATTERN EXPECTATIONS
  // ============================================================================

  describe('toMatch()', () => {
    it('should create a regex pattern expectation', () => {
      const expectation = exp('email').toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/).build()

      expect(expectation.column).toBe('email')
      expect(expectation.type).toBe('pattern')
      expect(expectation.params?.pattern).toEqual(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
    })

    it('should pass when all values match the pattern', () => {
      const expectation = exp('email').toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/).build()

      const result = validateExpectations([expectation], [
        { email: 'alice@example.com' },
        { email: 'bob@test.org' },
      ])

      expect(result.passed).toBe(true)
    })

    it('should fail when a value does not match the pattern', () => {
      const expectation = exp('email').toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/).build()

      const result = validateExpectations([expectation], [
        { email: 'alice@example.com' },
        { email: 'not-an-email' },
      ])

      expect(result.passed).toBe(false)
      expect(result.failures[0].rowIndex).toBe(1)
    })

    it('should accept string pattern', () => {
      const expectation = exp('phone').toMatch('^\\d{3}-\\d{4}$').build()

      const result = validateExpectations([expectation], [{ phone: '123-4567' }])

      expect(result.passed).toBe(true)
    })

    it('should skip null/undefined values by default', () => {
      const expectation = exp('email').toMatch(/^.+@.+$/).build()

      const result = validateExpectations([expectation], [
        { email: 'alice@example.com' },
        { email: null },
        { email: undefined },
      ])

      expect(result.passed).toBe(true)
    })
  })

  // ============================================================================
  // IN SET EXPECTATIONS
  // ============================================================================

  describe('toBeIn()', () => {
    it('should create an in-set expectation', () => {
      const expectation = exp('status').toBeIn(['active', 'inactive', 'pending']).build()

      expect(expectation.column).toBe('status')
      expect(expectation.type).toBe('in_set')
      expect(expectation.params?.values).toEqual(['active', 'inactive', 'pending'])
    })

    it('should pass when all values are in the set', () => {
      const expectation = exp('status').toBeIn(['active', 'inactive']).build()

      const result = validateExpectations([expectation], [{ status: 'active' }, { status: 'inactive' }])

      expect(result.passed).toBe(true)
    })

    it('should fail when a value is not in the set', () => {
      const expectation = exp('status').toBeIn(['active', 'inactive']).build()

      const result = validateExpectations([expectation], [{ status: 'active' }, { status: 'unknown' }])

      expect(result.passed).toBe(false)
      expect(result.failures[0].message).toContain('unknown')
    })

    it('should work with numeric values', () => {
      const expectation = exp('priority').toBeIn([1, 2, 3]).build()

      const result = validateExpectations([expectation], [{ priority: 1 }, { priority: 2 }])

      expect(result.passed).toBe(true)
    })
  })

  // ============================================================================
  // COMPARISON EXPECTATIONS
  // ============================================================================

  describe('toBeGreaterThan()', () => {
    it('should create a greater-than expectation', () => {
      const expectation = exp('age').toBeGreaterThan(0).build()

      expect(expectation.column).toBe('age')
      expect(expectation.type).toBe('greater_than')
      expect(expectation.params?.value).toBe(0)
    })

    it('should pass when all values are greater than the threshold', () => {
      const expectation = exp('age').toBeGreaterThan(0).build()

      const result = validateExpectations([expectation], [{ age: 25 }, { age: 1 }])

      expect(result.passed).toBe(true)
    })

    it('should fail when a value is less than or equal to the threshold', () => {
      const expectation = exp('age').toBeGreaterThan(0).build()

      const result = validateExpectations([expectation], [{ age: 25 }, { age: 0 }, { age: -5 }])

      expect(result.passed).toBe(false)
      expect(result.failures).toHaveLength(2)
    })
  })

  describe('toBeGreaterThanOrEqual()', () => {
    it('should pass when values are greater than or equal', () => {
      const expectation = exp('age').toBeGreaterThanOrEqual(18).build()

      const result = validateExpectations([expectation], [{ age: 18 }, { age: 25 }])

      expect(result.passed).toBe(true)
    })

    it('should fail when values are less than the threshold', () => {
      const expectation = exp('age').toBeGreaterThanOrEqual(18).build()

      const result = validateExpectations([expectation], [{ age: 17 }])

      expect(result.passed).toBe(false)
    })
  })

  describe('toBeLessThan()', () => {
    it('should create a less-than expectation', () => {
      const expectation = exp('price').toBeLessThan(1000).build()

      expect(expectation.column).toBe('price')
      expect(expectation.type).toBe('less_than')
      expect(expectation.params?.value).toBe(1000)
    })

    it('should pass when all values are less than the threshold', () => {
      const expectation = exp('price').toBeLessThan(1000).build()

      const result = validateExpectations([expectation], [{ price: 500 }, { price: 999 }])

      expect(result.passed).toBe(true)
    })

    it('should fail when a value is greater than or equal to the threshold', () => {
      const expectation = exp('price').toBeLessThan(1000).build()

      const result = validateExpectations([expectation], [{ price: 500 }, { price: 1000 }])

      expect(result.passed).toBe(false)
    })
  })

  describe('toBeLessThanOrEqual()', () => {
    it('should pass when values are less than or equal', () => {
      const expectation = exp('price').toBeLessThanOrEqual(100).build()

      const result = validateExpectations([expectation], [{ price: 100 }, { price: 50 }])

      expect(result.passed).toBe(true)
    })
  })

  describe('toBeBetween()', () => {
    it('should create a between expectation', () => {
      const expectation = exp('age').toBeBetween(0, 150).build()

      expect(expectation.column).toBe('age')
      expect(expectation.type).toBe('between')
      expect(expectation.params?.min).toBe(0)
      expect(expectation.params?.max).toBe(150)
    })

    it('should pass when all values are within range (inclusive)', () => {
      const expectation = exp('age').toBeBetween(0, 150).build()

      const result = validateExpectations([expectation], [{ age: 0 }, { age: 75 }, { age: 150 }])

      expect(result.passed).toBe(true)
    })

    it('should fail when a value is outside the range', () => {
      const expectation = exp('age').toBeBetween(0, 150).build()

      const result = validateExpectations([expectation], [{ age: -1 }, { age: 151 }])

      expect(result.passed).toBe(false)
      expect(result.failures).toHaveLength(2)
    })

    it('should support exclusive bounds', () => {
      const expectation = exp('price').toBeBetween(0, 100, { exclusive: true }).build()

      const result = validateExpectations([expectation], [{ price: 0 }, { price: 50 }, { price: 100 }])

      expect(result.passed).toBe(false)
      expect(result.failures).toHaveLength(2) // 0 and 100 fail
    })
  })

  // ============================================================================
  // TYPE CHECKS
  // ============================================================================

  describe('toBeString()', () => {
    it('should create a string type expectation', () => {
      const expectation = exp('name').toBeString().build()

      expect(expectation.column).toBe('name')
      expect(expectation.type).toBe('type_string')
    })

    it('should pass when all values are strings', () => {
      const expectation = exp('name').toBeString().build()

      const result = validateExpectations([expectation], [{ name: 'Alice' }, { name: 'Bob' }])

      expect(result.passed).toBe(true)
    })

    it('should fail when a value is not a string', () => {
      const expectation = exp('name').toBeString().build()

      const result = validateExpectations([expectation], [{ name: 'Alice' }, { name: 123 }])

      expect(result.passed).toBe(false)
    })
  })

  describe('toBeNumber()', () => {
    it('should create a number type expectation', () => {
      const expectation = exp('age').toBeNumber().build()

      expect(expectation.column).toBe('age')
      expect(expectation.type).toBe('type_number')
    })

    it('should pass when all values are numbers', () => {
      const expectation = exp('age').toBeNumber().build()

      const result = validateExpectations([expectation], [{ age: 25 }, { age: 30.5 }])

      expect(result.passed).toBe(true)
    })

    it('should fail when a value is not a number', () => {
      const expectation = exp('age').toBeNumber().build()

      const result = validateExpectations([expectation], [{ age: 25 }, { age: '30' }])

      expect(result.passed).toBe(false)
    })
  })

  describe('toBeInteger()', () => {
    it('should pass when all values are integers', () => {
      const expectation = exp('count').toBeInteger().build()

      const result = validateExpectations([expectation], [{ count: 1 }, { count: 100 }])

      expect(result.passed).toBe(true)
    })

    it('should fail when a value is a float', () => {
      const expectation = exp('count').toBeInteger().build()

      const result = validateExpectations([expectation], [{ count: 1 }, { count: 1.5 }])

      expect(result.passed).toBe(false)
    })
  })

  describe('toBeDate()', () => {
    it('should create a date type expectation', () => {
      const expectation = exp('createdAt').toBeDate().build()

      expect(expectation.column).toBe('createdAt')
      expect(expectation.type).toBe('type_date')
    })

    it('should pass when all values are Date objects', () => {
      const expectation = exp('createdAt').toBeDate().build()

      const result = validateExpectations([expectation], [
        { createdAt: new Date() },
        { createdAt: new Date('2024-01-01') },
      ])

      expect(result.passed).toBe(true)
    })

    it('should pass when values are valid date strings', () => {
      const expectation = exp('createdAt').toBeDate().build()

      const result = validateExpectations([expectation], [
        { createdAt: '2024-01-01' },
        { createdAt: '2024-12-31T23:59:59Z' },
      ])

      expect(result.passed).toBe(true)
    })

    it('should fail when a value is not a valid date', () => {
      const expectation = exp('createdAt').toBeDate().build()

      const result = validateExpectations([expectation], [{ createdAt: 'not-a-date' }])

      expect(result.passed).toBe(false)
    })
  })

  describe('toBeBoolean()', () => {
    it('should create a boolean type expectation', () => {
      const expectation = exp('active').toBeBoolean().build()

      expect(expectation.column).toBe('active')
      expect(expectation.type).toBe('type_boolean')
    })

    it('should pass when all values are booleans', () => {
      const expectation = exp('active').toBeBoolean().build()

      const result = validateExpectations([expectation], [{ active: true }, { active: false }])

      expect(result.passed).toBe(true)
    })

    it('should fail when a value is not a boolean', () => {
      const expectation = exp('active').toBeBoolean().build()

      const result = validateExpectations([expectation], [{ active: true }, { active: 1 }])

      expect(result.passed).toBe(false)
    })
  })

  // ============================================================================
  // AGGREGATE EXPECTATIONS
  // ============================================================================

  describe('toHaveCount()', () => {
    it('should create a count expectation', () => {
      const expectation = exp('id').toHaveCount(100).build()

      expect(expectation.column).toBe('id')
      expect(expectation.type).toBe('aggregate_count')
      expect(expectation.params?.expected).toBe(100)
    })

    it('should pass when row count matches', () => {
      const expectation = exp('id').toHaveCount(3).build()

      const result = validateExpectations([expectation], [{ id: 1 }, { id: 2 }, { id: 3 }])

      expect(result.passed).toBe(true)
    })

    it('should fail when row count does not match', () => {
      const expectation = exp('id').toHaveCount(5).build()

      const result = validateExpectations([expectation], [{ id: 1 }, { id: 2 }, { id: 3 }])

      expect(result.passed).toBe(false)
      expect(result.failures[0].message).toContain('3')
      expect(result.failures[0].message).toContain('5')
    })

    it('should support count range with min/max', () => {
      const expectation = exp('id').toHaveCount({ min: 1, max: 10 }).build()

      const result = validateExpectations([expectation], [{ id: 1 }, { id: 2 }, { id: 3 }])

      expect(result.passed).toBe(true)
    })
  })

  describe('toHaveSum()', () => {
    it('should create a sum expectation', () => {
      const expectation = exp('amount').toHaveSum(1000).build()

      expect(expectation.column).toBe('amount')
      expect(expectation.type).toBe('aggregate_sum')
      expect(expectation.params?.expected).toBe(1000)
    })

    it('should pass when sum matches', () => {
      const expectation = exp('amount').toHaveSum(100).build()

      const result = validateExpectations([expectation], [{ amount: 25 }, { amount: 25 }, { amount: 50 }])

      expect(result.passed).toBe(true)
    })

    it('should fail when sum does not match', () => {
      const expectation = exp('amount').toHaveSum(100).build()

      const result = validateExpectations([expectation], [{ amount: 25 }, { amount: 25 }])

      expect(result.passed).toBe(false)
    })

    it('should support sum range', () => {
      const expectation = exp('amount').toHaveSum({ min: 50, max: 200 }).build()

      const result = validateExpectations([expectation], [{ amount: 30 }, { amount: 40 }])

      expect(result.passed).toBe(true)
    })
  })

  describe('toHaveAvg()', () => {
    it('should create an average expectation', () => {
      const expectation = exp('score').toHaveAvg(50).build()

      expect(expectation.column).toBe('score')
      expect(expectation.type).toBe('aggregate_avg')
      expect(expectation.params?.expected).toBe(50)
    })

    it('should pass when average matches', () => {
      const expectation = exp('score').toHaveAvg(50).build()

      const result = validateExpectations([expectation], [{ score: 40 }, { score: 60 }])

      expect(result.passed).toBe(true)
    })

    it('should fail when average does not match', () => {
      const expectation = exp('score').toHaveAvg(100).build()

      const result = validateExpectations([expectation], [{ score: 40 }, { score: 60 }])

      expect(result.passed).toBe(false)
    })

    it('should support tolerance for floating point comparison', () => {
      const expectation = exp('score').toHaveAvg(50, { tolerance: 0.1 }).build()

      const result = validateExpectations([expectation], [{ score: 40 }, { score: 60.1 }])

      expect(result.passed).toBe(true)
    })
  })

  describe('toHaveMin()', () => {
    it('should pass when minimum value matches', () => {
      const expectation = exp('price').toHaveMin(10).build()

      const result = validateExpectations([expectation], [{ price: 10 }, { price: 50 }, { price: 100 }])

      expect(result.passed).toBe(true)
    })

    it('should fail when minimum value does not match', () => {
      const expectation = exp('price').toHaveMin(10).build()

      const result = validateExpectations([expectation], [{ price: 5 }, { price: 50 }])

      expect(result.passed).toBe(false)
    })
  })

  describe('toHaveMax()', () => {
    it('should pass when maximum value matches', () => {
      const expectation = exp('price').toHaveMax(100).build()

      const result = validateExpectations([expectation], [{ price: 10 }, { price: 50 }, { price: 100 }])

      expect(result.passed).toBe(true)
    })

    it('should fail when maximum value does not match', () => {
      const expectation = exp('price').toHaveMax(100).build()

      const result = validateExpectations([expectation], [{ price: 50 }, { price: 150 }])

      expect(result.passed).toBe(false)
    })
  })

  // ============================================================================
  // LOGICAL CHAINING
  // ============================================================================

  describe('and() chaining', () => {
    it('should combine expectations with AND logic', () => {
      const expectation = exp('age').toBeNotNull().and().toBeNumber().and().toBeGreaterThan(0).build()

      expect(expectation.column).toBe('age')
      expect(expectation.constraints).toHaveLength(3)
    })

    it('should pass when all chained expectations pass', () => {
      const expectation = exp('age').toBeNotNull().and().toBeNumber().and().toBeGreaterThan(0).build()

      const result = validateExpectations([expectation], [{ age: 25 }, { age: 30 }])

      expect(result.passed).toBe(true)
    })

    it('should fail when any chained expectation fails', () => {
      const expectation = exp('age').toBeNotNull().and().toBeNumber().and().toBeGreaterThan(0).build()

      const result = validateExpectations([expectation], [{ age: 25 }, { age: -5 }])

      expect(result.passed).toBe(false)
    })
  })

  describe('or() chaining', () => {
    it('should combine expectations with OR logic', () => {
      const expectation = exp('status').toBeIn(['active']).or().toBeIn(['pending']).build()

      expect(expectation.column).toBe('status')
      expect(expectation.logicalOperator).toBe('or')
    })

    it('should pass when at least one expectation passes', () => {
      const expectation = exp('value').toBeString().or().toBeNumber().build()

      const result = validateExpectations([expectation], [{ value: 'text' }, { value: 123 }])

      expect(result.passed).toBe(true)
    })

    it('should fail when all expectations fail', () => {
      const expectation = exp('value').toBeString().or().toBeNumber().build()

      const result = validateExpectations([expectation], [{ value: true }])

      expect(result.passed).toBe(false)
    })
  })

  // ============================================================================
  // CUSTOM MESSAGE
  // ============================================================================

  describe('withMessage()', () => {
    it('should set a custom error message', () => {
      const expectation = exp('email')
        .toBeNotNull()
        .withMessage('Email is required')
        .build()

      expect(expectation.message).toBe('Email is required')
    })

    it('should use custom message in failure', () => {
      const expectation = exp('email')
        .toBeNotNull()
        .withMessage('Email is required')
        .build()

      const result = validateExpectations([expectation], [{ email: null }])

      expect(result.passed).toBe(false)
      expect(result.failures[0].message).toBe('Email is required')
    })
  })

  // ============================================================================
  // BUILDING TO EXPECTATION OBJECTS
  // ============================================================================

  describe('build()', () => {
    it('should return an Expectation object', () => {
      const expectation = exp('email').toBeNotNull().build()

      expect(expectation).toHaveProperty('column')
      expect(expectation).toHaveProperty('type')
    })

    it('should include all configured properties', () => {
      const expectation = exp('age')
        .toBeNotNull()
        .and()
        .toBeBetween(0, 150)
        .withMessage('Age must be valid')
        .build()

      expect(expectation.column).toBe('age')
      expect(expectation.constraints).toHaveLength(2)
      expect(expectation.message).toBe('Age must be valid')
    })
  })

  // ============================================================================
  // VALIDATION WITH MULTIPLE EXPECTATIONS
  // ============================================================================

  describe('validateExpectations()', () => {
    it('should validate multiple expectations', () => {
      const expectations = [
        exp('id').toBeNotNull().build(),
        exp('email').toMatch(/^.+@.+$/).build(),
        exp('age').toBeGreaterThan(0).build(),
      ]

      const result = validateExpectations(expectations, [
        { id: 1, email: 'alice@example.com', age: 25 },
        { id: 2, email: 'bob@test.org', age: 30 },
      ])

      expect(result.passed).toBe(true)
      expect(result.expectationsChecked).toBe(3)
    })

    it('should return all failures', () => {
      const expectations = [
        exp('id').toBeNotNull().build(),
        exp('email').toMatch(/^.+@.+$/).build(),
        exp('age').toBeGreaterThan(0).build(),
      ]

      const result = validateExpectations(expectations, [
        { id: null, email: 'invalid', age: -5 },
      ])

      expect(result.passed).toBe(false)
      expect(result.failures.length).toBe(3)
    })

    it('should return timing information', () => {
      const expectations = [exp('id').toBeNotNull().build()]

      const result = validateExpectations(expectations, [{ id: 1 }])

      expect(result.timing).toBeDefined()
      expect(result.timing.totalMs).toBeGreaterThanOrEqual(0)
    })
  })

  // ============================================================================
  // STRING LENGTH EXPECTATIONS
  // ============================================================================

  describe('string length expectations', () => {
    it('toHaveMinLength() should check minimum string length', () => {
      const expectation = exp('name').toHaveMinLength(2).build()

      const result = validateExpectations([expectation], [{ name: 'Al' }, { name: 'A' }])

      expect(result.passed).toBe(false)
      expect(result.failures).toHaveLength(1)
    })

    it('toHaveMaxLength() should check maximum string length', () => {
      const expectation = exp('code').toHaveMaxLength(10).build()

      const result = validateExpectations([expectation], [{ code: '12345' }, { code: '12345678901' }])

      expect(result.passed).toBe(false)
      expect(result.failures).toHaveLength(1)
    })
  })

  // ============================================================================
  // ERROR MESSAGE FORMATTING
  // ============================================================================

  describe('error messages', () => {
    it('should provide informative error messages for not_null', () => {
      const expectation = exp('email').toBeNotNull().build()

      const result = validateExpectations([expectation], [{ email: null }])

      expect(result.failures[0].message).toContain('email')
      expect(result.failures[0].message).toMatch(/null|empty|required/i)
    })

    it('should include actual values in error messages', () => {
      const expectation = exp('age').toBeGreaterThan(0).build()

      const result = validateExpectations([expectation], [{ age: -5 }])

      expect(result.failures[0].actualValue).toBe(-5)
    })

    it('should include row index in error messages', () => {
      const expectation = exp('age').toBeGreaterThan(0).build()

      const result = validateExpectations([expectation], [{ age: 10 }, { age: -5 }, { age: 20 }])

      expect(result.failures[0].rowIndex).toBe(1)
    })
  })

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('edge cases', () => {
    it('should handle empty data arrays', () => {
      const expectation = exp('id').toBeNotNull().build()

      const result = validateExpectations([expectation], [])

      expect(result.passed).toBe(true)
    })

    it('should handle missing columns gracefully', () => {
      const expectation = exp('nonexistent').toBeNotNull().build()

      const result = validateExpectations([expectation], [{ id: 1 }])

      expect(result.passed).toBe(false)
    })

    it('should handle nested column paths', () => {
      const expectation = exp('address.city').toBeNotNull().build()

      const result = validateExpectations([expectation], [
        { address: { city: 'NYC' } },
        { address: { city: null } },
      ])

      expect(result.passed).toBe(false)
      expect(result.failures).toHaveLength(1)
    })

    it('should handle array column paths', () => {
      const expectation = exp('tags[0]').toBeString().build()

      const result = validateExpectations([expectation], [
        { tags: ['foo', 'bar'] },
        { tags: [123, 'bar'] },
      ])

      expect(result.passed).toBe(false)
      expect(result.failures).toHaveLength(1)
    })
  })

  // ============================================================================
  // toMatchRegex ALIAS
  // ============================================================================

  describe('toMatchRegex()', () => {
    it('should be an alias for toMatch()', () => {
      const expectation1 = exp('email').toMatch(/^.+@.+$/).build()
      const expectation2 = exp('email').toMatchRegex(/^.+@.+$/).build()

      // Both should have the same structure
      expect(expectation1.type).toBe('pattern')
      expect(expectation2.type).toBe('pattern')
    })

    it('should validate regex patterns correctly', () => {
      const expectation = exp('email').toMatchRegex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/).build()

      const result = validateExpectations([expectation], [
        { email: 'alice@example.com' },
        { email: 'not-an-email' },
      ])

      expect(result.passed).toBe(false)
      expect(result.failures).toHaveLength(1)
      expect(result.failures[0].rowIndex).toBe(1)
    })
  })
})

// ============================================================================
// TABLE-CENTRIC API TESTS
// ============================================================================

describe('Table Expectation DSL', () => {
  describe('expectTable() entry point', () => {
    it('should create a table expectation builder', () => {
      const builder = expectTable('users')

      expect(builder).toBeInstanceOf(TableExpectationBuilder)
      expect(builder.getTableName()).toBe('users')
    })

    it('should support multiple tables', () => {
      const builder1 = expectTable('users')
      const builder2 = expectTable('orders')

      expect(builder1.getTableName()).toBe('users')
      expect(builder2.getTableName()).toBe('orders')
    })
  })

  describe('.column() method', () => {
    it('should return a ChainedColumnBuilder', () => {
      const builder = expectTable('users').column('email')

      expect(builder).toBeInstanceOf(ChainedColumnBuilder)
    })

    it('should chain multiple columns', () => {
      const tableExpectations = expectTable('users')
        .column('email').toBeString()
        .column('age').toBeNumber()
        .column('status').toBeIn(['active', 'inactive'])
        .build()

      expect(tableExpectations.table).toBe('users')
      expect(tableExpectations.columns).toHaveLength(3)
      expect(tableExpectations.columns[0].column).toBe('email')
      expect(tableExpectations.columns[1].column).toBe('age')
      expect(tableExpectations.columns[2].column).toBe('status')
    })
  })

  describe('fluent API from task description', () => {
    it('should implement the exact API from the task', () => {
      // This is the exact API from the task description
      const expectations = expectTable('users')
        .column('email').toBeString().toMatchRegex(/^.+@.+$/)
        .column('age').toBeNumber().toBeBetween(0, 150)
        .column('status').toBeIn(['active', 'inactive', 'pending'])
        .build()

      expect(expectations.table).toBe('users')
      expect(expectations.columns).toHaveLength(3)

      // Validate email column
      expect(expectations.columns[0].column).toBe('email')
      expect(expectations.columns[0].constraints).toHaveLength(2)
      expect(expectations.columns[0].constraints[0].type).toBe('type_string')
      expect(expectations.columns[0].constraints[1].type).toBe('pattern')

      // Validate age column
      expect(expectations.columns[1].column).toBe('age')
      expect(expectations.columns[1].constraints).toHaveLength(2)
      expect(expectations.columns[1].constraints[0].type).toBe('type_number')
      expect(expectations.columns[1].constraints[1].type).toBe('between')

      // Validate status column
      expect(expectations.columns[2].column).toBe('status')
      expect(expectations.columns[2].constraints).toHaveLength(1)
      expect(expectations.columns[2].constraints[0].type).toBe('in_set')
    })
  })

  describe('validateTableExpectations()', () => {
    it('should validate data against table expectations', () => {
      const expectations = expectTable('users')
        .column('email').toBeString().toMatchRegex(/^.+@.+$/)
        .column('age').toBeNumber().toBeBetween(0, 150)
        .column('status').toBeIn(['active', 'inactive', 'pending'])
        .build()

      const validData = [
        { email: 'alice@example.com', age: 25, status: 'active' },
        { email: 'bob@test.org', age: 30, status: 'inactive' },
      ]

      const result = validateTableExpectations(expectations, validData)

      expect(result.passed).toBe(true)
      expect(result.failures).toHaveLength(0)
    })

    it('should return failures for invalid data', () => {
      const expectations = expectTable('users')
        .column('email').toBeString().toMatchRegex(/^.+@.+$/)
        .column('age').toBeNumber().toBeBetween(0, 150)
        .build()

      const invalidData = [
        { email: 'not-an-email', age: -5 },
      ]

      const result = validateTableExpectations(expectations, invalidData)

      expect(result.passed).toBe(false)
      expect(result.failures.length).toBeGreaterThan(0)
    })
  })

  describe('column constraints chaining', () => {
    it('should support all constraint types', () => {
      const expectations = expectTable('products')
        .column('id').toBeNotNull().toBeUnique()
        .column('name').toBeString().toHaveMinLength(1).toHaveMaxLength(100)
        .column('price').toBeNumber().toBeGreaterThan(0).toBeLessThanOrEqual(10000)
        .column('quantity').toBeInteger()
        .column('active').toBeBoolean()
        .column('createdAt').toBeDate()
        .build()

      expect(expectations.columns).toHaveLength(6)
    })

    it('should support aggregate expectations', () => {
      const expectations = expectTable('transactions')
        .column('amount').toHaveSum({ min: 0, max: 1000000 })
        .column('id').toHaveCount({ min: 1 })
        .build()

      expect(expectations.columns).toHaveLength(2)
      expect(expectations.columns[0].constraints[0].type).toBe('aggregate_sum')
      expect(expectations.columns[1].constraints[0].type).toBe('aggregate_count')
    })

    it('should support .and() and .or() chaining', () => {
      const expectations = expectTable('users')
        .column('email').toBeNotNull().and().toBeString().and().toMatchRegex(/^.+@.+$/)
        .column('role').toBeIn(['admin']).or().toBeIn(['user'])
        .build()

      expect(expectations.columns).toHaveLength(2)
      expect(expectations.columns[0].constraints).toHaveLength(3)
      expect(expectations.columns[1].logicalOperator).toBe('or')
    })

    it('should support custom messages', () => {
      const expectations = expectTable('users')
        .column('email').toBeNotNull().withMessage('Email is required')
        .build()

      expect(expectations.columns[0].message).toBe('Email is required')
    })
  })

  describe('TypeScript type inference', () => {
    it('should infer correct types for the builder pattern', () => {
      // This test verifies TypeScript compilation succeeds
      const builder: TableExpectationBuilder = expectTable('users')
      const columnBuilder: ChainedColumnBuilder = builder.column('email')
      const definition: TableExpectationDefinition = columnBuilder.toBeString().build()

      expect(definition).toBeDefined()
      expect(definition.table).toBe('users')
    })
  })

  describe('JSON serialization', () => {
    it('should serialize table expectations to JSON', () => {
      const expectations = expectTable('users')
        .column('email').toBeString().toMatchRegex(/^.+@.+$/i)
        .column('age').toBeNumber()
        .build()

      const json = serializeTableExpectations(expectations)

      expect(() => JSON.parse(json)).not.toThrow()

      const parsed = JSON.parse(json)
      expect(parsed.table).toBe('users')
      expect(parsed.columns).toHaveLength(2)
    })

    it('should deserialize JSON back to table expectations', () => {
      const original = expectTable('users')
        .column('email').toBeString().toMatchRegex(/^.+@.+$/i)
        .column('age').toBeNumber()
        .build()

      const json = serializeTableExpectations(original)
      const deserialized = deserializeTableExpectations(json)

      expect(deserialized.table).toBe('users')
      expect(deserialized.columns).toHaveLength(2)
    })

    it('should preserve regex patterns through serialization round-trip', () => {
      const original = expectTable('users')
        .column('email').toMatchRegex(/^test@example\.com$/i)
        .build()

      const json = serializeTableExpectations(original)
      const deserialized = deserializeTableExpectations(json)

      // Validate with the deserialized expectations
      const validResult = validateTableExpectations(deserialized, [
        { email: 'TEST@EXAMPLE.COM' }, // Should match with 'i' flag
      ])
      expect(validResult.passed).toBe(true)

      const invalidResult = validateTableExpectations(deserialized, [
        { email: 'other@domain.com' },
      ])
      expect(invalidResult.passed).toBe(false)
    })

    it('should handle expectations without regex patterns', () => {
      const original = expectTable('users')
        .column('age').toBeNumber().toBeBetween(0, 100)
        .column('status').toBeIn(['active', 'inactive'])
        .build()

      const json = serializeTableExpectations(original)
      const deserialized = deserializeTableExpectations(json)

      expect(deserialized.table).toBe('users')
      expect(deserialized.columns).toHaveLength(2)

      const result = validateTableExpectations(deserialized, [
        { age: 25, status: 'active' },
      ])
      expect(result.passed).toBe(true)
    })
  })

  describe('composability', () => {
    it('should allow reusing column patterns', () => {
      // Define common patterns
      const emailExpectation = (builder: TableExpectationBuilder) =>
        builder.column('email').toBeNotNull().toBeString().toMatchRegex(/^.+@.+$/)

      // Use in table definition
      const expectations = expectTable('users')
      emailExpectation(expectations)
        .column('name').toBeString()
        .build()

      expect(expectations.getColumnExpectations()).toHaveLength(2)
    })

    it('should work with existing column-based API', () => {
      // Table-centric API
      const tableExp = expectTable('users')
        .column('email').toBeString()
        .build()

      // Column-centric API
      const columnExp = exp('email').toBeString().build()

      // Both should produce compatible expectations
      expect(tableExp.columns[0].column).toBe(columnExp.column)
      expect(tableExp.columns[0].type).toBe(columnExp.type)
    })
  })

  describe('edge cases', () => {
    it('should handle single column table', () => {
      const expectations = expectTable('simple')
        .column('id').toBeNotNull()
        .build()

      expect(expectations.table).toBe('simple')
      expect(expectations.columns).toHaveLength(1)
    })

    it('should handle empty data arrays', () => {
      const expectations = expectTable('users')
        .column('id').toBeNotNull()
        .build()

      const result = validateTableExpectations(expectations, [])

      expect(result.passed).toBe(true)
    })

    it('should validate all columns independently', () => {
      const expectations = expectTable('users')
        .column('email').toBeString()
        .column('age').toBeNumber()
        .build()

      // Both columns invalid
      const result = validateTableExpectations(expectations, [
        { email: 123, age: 'not a number' },
      ])

      expect(result.passed).toBe(false)
      expect(result.failures.length).toBe(2)
    })
  })
})
