/**
 * Query Validation Tests
 *
 * Tests for operator query input validation (VAL-1).
 * Ensures malformed operator queries are rejected with clear error messages.
 *
 * @see do-tsy: [VAL-1] Operator query input validation
 */

import { describe, it, expect } from 'vitest'
import {
  validateOperatorQuery,
  validateWhereClause,
  matchesOperators,
  matchesWhere,
  isOperatorObject,
  QueryValidationError,
  VALID_OPERATORS,
  type OperatorQuery,
} from './query-validation'

// =============================================================================
// VALIDATION TESTS - RED PHASE
// =============================================================================

describe('Query Validation', () => {
  describe('isOperatorObject', () => {
    it('returns true for objects with $ prefixed keys', () => {
      expect(isOperatorObject({ $gt: 5 })).toBe(true)
      expect(isOperatorObject({ $lt: 10, $gt: 5 })).toBe(true)
      expect(isOperatorObject({ $in: [1, 2, 3] })).toBe(true)
    })

    it('returns false for plain values', () => {
      expect(isOperatorObject('hello')).toBe(false)
      expect(isOperatorObject(42)).toBe(false)
      expect(isOperatorObject(null)).toBe(false)
      expect(isOperatorObject(undefined)).toBe(false)
    })

    it('returns false for arrays', () => {
      expect(isOperatorObject([1, 2, 3])).toBe(false)
      expect(isOperatorObject([])).toBe(false)
    })

    it('returns false for objects without $ keys', () => {
      expect(isOperatorObject({ name: 'Alice' })).toBe(false)
      expect(isOperatorObject({ age: 25, status: 'active' })).toBe(false)
    })

    it('returns false for mixed objects (some $ keys)', () => {
      // If ANY key doesn't start with $, it's not an operator object
      expect(isOperatorObject({ $gt: 5, name: 'test' })).toBe(false)
    })
  })

  describe('validateOperatorQuery', () => {
    describe('valid operators', () => {
      it('accepts $gt with number', () => {
        const result = validateOperatorQuery('age', { $gt: 18 })
        expect(result.$gt).toBe(18)
      })

      it('accepts $lt with number', () => {
        const result = validateOperatorQuery('price', { $lt: 100 })
        expect(result.$lt).toBe(100)
      })

      it('accepts $gte and $lte for ranges', () => {
        const result = validateOperatorQuery('quantity', { $gte: 10, $lte: 50 })
        expect(result.$gte).toBe(10)
        expect(result.$lte).toBe(50)
      })

      it('accepts $eq with any value', () => {
        expect(validateOperatorQuery('status', { $eq: 'active' }).$eq).toBe('active')
        expect(validateOperatorQuery('count', { $eq: 0 }).$eq).toBe(0)
        expect(validateOperatorQuery('flag', { $eq: null }).$eq).toBe(null)
      })

      it('accepts $ne with any value', () => {
        const result = validateOperatorQuery('status', { $ne: 'deleted' })
        expect(result.$ne).toBe('deleted')
      })

      it('accepts $in with array', () => {
        const result = validateOperatorQuery('status', { $in: ['active', 'pending'] })
        expect(result.$in).toEqual(['active', 'pending'])
      })

      it('accepts $nin with array', () => {
        const result = validateOperatorQuery('status', { $nin: ['deleted', 'archived'] })
        expect(result.$nin).toEqual(['deleted', 'archived'])
      })

      it('accepts $exists with boolean', () => {
        expect(validateOperatorQuery('email', { $exists: true }).$exists).toBe(true)
        expect(validateOperatorQuery('phone', { $exists: false }).$exists).toBe(false)
      })

      it('accepts $regex with string', () => {
        const result = validateOperatorQuery('name', { $regex: '^John' })
        expect(result.$regex).toBe('^John')
      })

      it('accepts $gt with string for comparison', () => {
        const result = validateOperatorQuery('name', { $gt: 'A' })
        expect(result.$gt).toBe('A')
      })

      it('accepts $gt with ISO date string (stays as string)', () => {
        const result = validateOperatorQuery('createdAt', {
          $gt: '2024-01-01T00:00:00.000Z',
        })
        // Date strings remain as strings - parsing happens at match time
        expect(result.$gt).toBe('2024-01-01T00:00:00.000Z')
      })
    })

    describe('invalid operators', () => {
      it('rejects unknown operator names', () => {
        expect(() => validateOperatorQuery('field', { $unknown: 'value' })).toThrow(
          QueryValidationError
        )
        expect(() => validateOperatorQuery('field', { $unknown: 'value' })).toThrow(
          /Unknown operator '\$unknown'/
        )
      })

      it('rejects $gtx (typo)', () => {
        expect(() => validateOperatorQuery('field', { $gtx: 5 })).toThrow(
          /Unknown operator '\$gtx'/
        )
      })

      it('rejects empty operator object', () => {
        // Empty objects are not detected as operator objects (no $ keys)
        // so they fail the isOperatorObject check
        expect(() => validateOperatorQuery('field', {})).toThrow(QueryValidationError)
        expect(() => validateOperatorQuery('field', {})).toThrow(
          /Expected operator object/
        )
      })

      it('rejects $in with non-array value', () => {
        expect(() => validateOperatorQuery('field', { $in: 'not-an-array' })).toThrow(
          QueryValidationError
        )
      })

      it('rejects $nin with non-array value', () => {
        expect(() => validateOperatorQuery('field', { $nin: 123 })).toThrow(
          QueryValidationError
        )
      })

      it('rejects $exists with non-boolean value', () => {
        expect(() => validateOperatorQuery('field', { $exists: 'yes' })).toThrow(
          QueryValidationError
        )
        expect(() => validateOperatorQuery('field', { $exists: 1 })).toThrow(
          QueryValidationError
        )
      })

      it('rejects non-object values', () => {
        expect(() => validateOperatorQuery('field', 'string')).toThrow(
          QueryValidationError
        )
        expect(() => validateOperatorQuery('field', 123)).toThrow(QueryValidationError)
        expect(() => validateOperatorQuery('field', [1, 2, 3])).toThrow(
          QueryValidationError
        )
      })

      it('provides clear error message with field name', () => {
        try {
          validateOperatorQuery('myField', { $badOp: 'value' })
          expect.fail('Should have thrown')
        } catch (error) {
          expect(error).toBeInstanceOf(QueryValidationError)
          const qve = error as QueryValidationError
          expect(qve.field).toBe('myField')
          expect(qve.message).toContain('myField')
          expect(qve.message).toContain('$badOp')
        }
      })
    })
  })

  describe('validateWhereClause', () => {
    it('validates simple equality queries', () => {
      const result = validateWhereClause({ status: 'active', type: 'user' })
      expect(result).toEqual({ status: 'active', type: 'user' })
    })

    it('validates operator queries within where clause', () => {
      const result = validateWhereClause({
        age: { $gt: 18 },
        status: 'active',
      })
      expect(result.status).toBe('active')
      expect((result.age as OperatorQuery).$gt).toBe(18)
    })

    it('validates multiple fields with operators', () => {
      const result = validateWhereClause({
        price: { $gte: 10, $lte: 100 },
        status: { $in: ['available', 'pending'] },
        deleted: { $exists: false },
      })
      expect((result.price as OperatorQuery).$gte).toBe(10)
      expect((result.price as OperatorQuery).$lte).toBe(100)
      expect((result.status as OperatorQuery).$in).toEqual(['available', 'pending'])
      expect((result.deleted as OperatorQuery).$exists).toBe(false)
    })

    it('passes through null and undefined values', () => {
      const result = validateWhereClause({
        nullField: null,
        undefinedField: undefined,
      })
      expect(result.nullField).toBe(null)
      expect(result.undefinedField).toBe(undefined)
    })

    it('rejects invalid operator in where clause', () => {
      expect(() =>
        validateWhereClause({
          status: 'active',
          age: { $badOperator: 25 },
        })
      ).toThrow(QueryValidationError)
    })

    it('treats objects without $ keys as equality match', () => {
      const result = validateWhereClause({
        profile: { name: 'Alice', role: 'admin' },
      })
      expect(result.profile).toEqual({ name: 'Alice', role: 'admin' })
    })
  })
})

// =============================================================================
// OPERATOR MATCHING TESTS
// =============================================================================

describe('Operator Matching', () => {
  describe('matchesOperators', () => {
    describe('comparison operators', () => {
      it('matches $gt correctly', () => {
        expect(matchesOperators(10, { $gt: 5 })).toBe(true)
        expect(matchesOperators(5, { $gt: 5 })).toBe(false)
        expect(matchesOperators(3, { $gt: 5 })).toBe(false)
      })

      it('matches $lt correctly', () => {
        expect(matchesOperators(3, { $lt: 5 })).toBe(true)
        expect(matchesOperators(5, { $lt: 5 })).toBe(false)
        expect(matchesOperators(10, { $lt: 5 })).toBe(false)
      })

      it('matches $gte correctly', () => {
        expect(matchesOperators(10, { $gte: 5 })).toBe(true)
        expect(matchesOperators(5, { $gte: 5 })).toBe(true)
        expect(matchesOperators(3, { $gte: 5 })).toBe(false)
      })

      it('matches $lte correctly', () => {
        expect(matchesOperators(3, { $lte: 5 })).toBe(true)
        expect(matchesOperators(5, { $lte: 5 })).toBe(true)
        expect(matchesOperators(10, { $lte: 5 })).toBe(false)
      })

      it('matches range queries ($gte and $lte)', () => {
        expect(matchesOperators(25, { $gte: 18, $lte: 65 })).toBe(true)
        expect(matchesOperators(18, { $gte: 18, $lte: 65 })).toBe(true)
        expect(matchesOperators(65, { $gte: 18, $lte: 65 })).toBe(true)
        expect(matchesOperators(17, { $gte: 18, $lte: 65 })).toBe(false)
        expect(matchesOperators(66, { $gte: 18, $lte: 65 })).toBe(false)
      })

      it('compares strings correctly', () => {
        expect(matchesOperators('banana', { $gt: 'apple' })).toBe(true)
        expect(matchesOperators('apple', { $gt: 'banana' })).toBe(false)
        expect(matchesOperators('apple', { $lt: 'banana' })).toBe(true)
      })

      it('compares dates correctly', () => {
        const jan = new Date('2024-01-01')
        const feb = new Date('2024-02-01')
        const mar = new Date('2024-03-01')

        expect(matchesOperators(feb, { $gt: jan })).toBe(true)
        expect(matchesOperators(jan, { $gt: feb })).toBe(false)
        expect(matchesOperators(feb, { $gte: jan, $lte: mar })).toBe(true)
      })
    })

    describe('equality operators', () => {
      it('matches $eq correctly', () => {
        expect(matchesOperators('active', { $eq: 'active' })).toBe(true)
        expect(matchesOperators('pending', { $eq: 'active' })).toBe(false)
        expect(matchesOperators(42, { $eq: 42 })).toBe(true)
        expect(matchesOperators(42, { $eq: '42' })).toBe(false) // Strict equality
      })

      it('matches $ne correctly', () => {
        expect(matchesOperators('active', { $ne: 'deleted' })).toBe(true)
        expect(matchesOperators('deleted', { $ne: 'deleted' })).toBe(false)
      })
    })

    describe('array operators', () => {
      it('matches $in correctly', () => {
        expect(matchesOperators('active', { $in: ['active', 'pending'] })).toBe(true)
        expect(matchesOperators('pending', { $in: ['active', 'pending'] })).toBe(true)
        expect(matchesOperators('deleted', { $in: ['active', 'pending'] })).toBe(false)
      })

      it('matches $nin correctly', () => {
        expect(matchesOperators('active', { $nin: ['deleted', 'archived'] })).toBe(true)
        expect(matchesOperators('deleted', { $nin: ['deleted', 'archived'] })).toBe(
          false
        )
      })

      it('handles empty arrays', () => {
        expect(matchesOperators('anything', { $in: [] })).toBe(false)
        expect(matchesOperators('anything', { $nin: [] })).toBe(true)
      })
    })

    describe('$exists operator', () => {
      it('matches $exists: true for defined values', () => {
        expect(matchesOperators('value', { $exists: true })).toBe(true)
        expect(matchesOperators(0, { $exists: true })).toBe(true)
        expect(matchesOperators('', { $exists: true })).toBe(true)
        expect(matchesOperators(false, { $exists: true })).toBe(true)
      })

      it('matches $exists: true fails for null/undefined', () => {
        expect(matchesOperators(null, { $exists: true })).toBe(false)
        expect(matchesOperators(undefined, { $exists: true })).toBe(false)
      })

      it('matches $exists: false for null/undefined', () => {
        expect(matchesOperators(null, { $exists: false })).toBe(true)
        expect(matchesOperators(undefined, { $exists: false })).toBe(true)
      })

      it('matches $exists: false fails for defined values', () => {
        expect(matchesOperators('value', { $exists: false })).toBe(false)
        expect(matchesOperators(0, { $exists: false })).toBe(false)
      })
    })

    describe('$regex operator', () => {
      it('matches regex patterns', () => {
        expect(matchesOperators('john.doe@example.com', { $regex: '@example.com$' })).toBe(
          true
        )
        expect(matchesOperators('john.doe@gmail.com', { $regex: '@example.com$' })).toBe(
          false
        )
      })

      it('matches with RegExp object', () => {
        expect(matchesOperators('Hello World', { $regex: /world/i })).toBe(true)
        expect(matchesOperators('Hello World', { $regex: /world/ })).toBe(false) // Case sensitive
      })

      it('returns false for non-string values', () => {
        expect(matchesOperators(123, { $regex: '\\d+' })).toBe(false)
        expect(matchesOperators(null, { $regex: 'test' })).toBe(false)
      })
    })

    describe('combined operators', () => {
      it('all operators must match (AND logic)', () => {
        // Value must be > 10 AND < 50 AND in the array
        expect(matchesOperators(25, { $gt: 10, $lt: 50, $in: [20, 25, 30] })).toBe(true)
        expect(matchesOperators(25, { $gt: 10, $lt: 50, $in: [20, 30] })).toBe(false) // Not in array
        expect(matchesOperators(5, { $gt: 10, $lt: 50, $in: [5, 25, 30] })).toBe(false) // Not > 10
      })
    })
  })

  describe('matchesWhere', () => {
    const testThing = {
      $id: 'test_123',
      $type: 'Product',
      name: 'Widget',
      price: 29.99,
      quantity: 100,
      status: 'active',
      category: 'electronics',
      tags: ['sale', 'featured'],
    }

    it('matches simple equality conditions', () => {
      expect(matchesWhere(testThing, { status: 'active' })).toBe(true)
      expect(matchesWhere(testThing, { status: 'deleted' })).toBe(false)
      expect(
        matchesWhere(testThing, { status: 'active', category: 'electronics' })
      ).toBe(true)
      expect(matchesWhere(testThing, { status: 'active', category: 'books' })).toBe(
        false
      )
    })

    it('matches operator conditions', () => {
      expect(matchesWhere(testThing, { price: { $lt: 50 } })).toBe(true)
      expect(matchesWhere(testThing, { price: { $gt: 50 } })).toBe(false)
      expect(matchesWhere(testThing, { quantity: { $gte: 100 } })).toBe(true)
    })

    it('matches mixed equality and operator conditions', () => {
      expect(
        matchesWhere(testThing, {
          status: 'active',
          price: { $lt: 50 },
          quantity: { $gte: 50 },
        })
      ).toBe(true)

      expect(
        matchesWhere(testThing, {
          status: 'deleted', // This fails
          price: { $lt: 50 },
        })
      ).toBe(false)
    })

    it('handles missing fields', () => {
      expect(matchesWhere(testThing, { nonexistent: { $exists: false } })).toBe(true)
      expect(matchesWhere(testThing, { nonexistent: { $exists: true } })).toBe(false)
    })

    it('handles complex nested conditions', () => {
      expect(
        matchesWhere(testThing, {
          price: { $gte: 20, $lte: 40 },
          status: { $in: ['active', 'pending'] },
          category: { $ne: 'food' },
        })
      ).toBe(true)
    })
  })
})

// =============================================================================
// ERROR MESSAGE QUALITY TESTS
// =============================================================================

describe('Error Message Quality', () => {
  it('includes field name in error message', () => {
    try {
      validateOperatorQuery('customerAge', { $badOp: 25 })
    } catch (error) {
      expect((error as Error).message).toContain('customerAge')
    }
  })

  it('includes invalid operator name in error message', () => {
    try {
      validateOperatorQuery('field', { $notReal: 'value' })
    } catch (error) {
      expect((error as Error).message).toContain('$notReal')
    }
  })

  it('lists valid operators in error message', () => {
    try {
      validateOperatorQuery('field', { $fake: 123 })
    } catch (error) {
      expect((error as Error).message).toContain('$gt')
      expect((error as Error).message).toContain('$lt')
      expect((error as Error).message).toContain('$in')
    }
  })

  it('provides actionable error for type mismatches', () => {
    try {
      validateOperatorQuery('status', { $in: 'not-an-array' })
    } catch (error) {
      // Error should indicate the problem is with the value type
      expect((error as Error).message).toContain('status')
    }
  })
})
