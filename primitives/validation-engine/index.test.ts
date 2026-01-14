/**
 * ValidationEngine Tests - TDD Red-Green-Refactor
 *
 * Comprehensive tests for validation primitives
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  ValidationEngine,
  z,
  StringValidator,
  NumberValidator,
  ObjectValidator,
  ArrayValidator,
  BooleanValidator,
  DateValidator,
} from './index'
import type {
  ValidationResult,
  ValidationError,
  SafeParseResult,
  Schema,
} from './types'

// =============================================================================
// Primitive Validation Tests
// =============================================================================

describe('Primitive Validation', () => {
  let engine: ValidationEngine

  beforeEach(() => {
    engine = new ValidationEngine()
  })

  describe('String Validation', () => {
    it('should validate a valid string', () => {
      const schema = z.string()
      const result = engine.validate('hello', schema)
      expect(result.valid).toBe(true)
      expect(result.value).toBe('hello')
      expect(result.errors).toHaveLength(0)
    })

    it('should reject non-string values', () => {
      const schema = z.string()
      const result = engine.validate(123, schema)
      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].code).toBe('invalid_type')
      expect(result.errors[0].expected).toBe('string')
      expect(result.errors[0].received).toBe('number')
    })

    it('should reject null for non-nullable string', () => {
      const schema = z.string()
      const result = engine.validate(null, schema)
      expect(result.valid).toBe(false)
      expect(result.errors[0].code).toBe('invalid_type')
    })

    it('should reject undefined for non-optional string', () => {
      const schema = z.string()
      const result = engine.validate(undefined, schema)
      expect(result.valid).toBe(false)
      expect(result.errors[0].code).toBe('required')
    })
  })

  describe('Number Validation', () => {
    it('should validate a valid number', () => {
      const schema = z.number()
      const result = engine.validate(42, schema)
      expect(result.valid).toBe(true)
      expect(result.value).toBe(42)
    })

    it('should validate float numbers', () => {
      const schema = z.number()
      const result = engine.validate(3.14, schema)
      expect(result.valid).toBe(true)
      expect(result.value).toBe(3.14)
    })

    it('should reject string values', () => {
      const schema = z.number()
      const result = engine.validate('42', schema)
      expect(result.valid).toBe(false)
      expect(result.errors[0].code).toBe('invalid_type')
    })

    it('should reject NaN', () => {
      const schema = z.number()
      const result = engine.validate(NaN, schema)
      expect(result.valid).toBe(false)
      expect(result.errors[0].code).toBe('invalid_type')
    })
  })

  describe('Boolean Validation', () => {
    it('should validate true', () => {
      const schema = z.boolean()
      const result = engine.validate(true, schema)
      expect(result.valid).toBe(true)
      expect(result.value).toBe(true)
    })

    it('should validate false', () => {
      const schema = z.boolean()
      const result = engine.validate(false, schema)
      expect(result.valid).toBe(true)
      expect(result.value).toBe(false)
    })

    it('should reject truthy values that are not boolean', () => {
      const schema = z.boolean()
      const result = engine.validate(1, schema)
      expect(result.valid).toBe(false)
    })

    it('should reject falsy values that are not boolean', () => {
      const schema = z.boolean()
      const result = engine.validate(0, schema)
      expect(result.valid).toBe(false)
    })
  })
})

// =============================================================================
// String Constraints Tests
// =============================================================================

describe('String Constraints', () => {
  let engine: ValidationEngine

  beforeEach(() => {
    engine = new ValidationEngine()
  })

  describe('minLength', () => {
    it('should pass when string meets minimum length', () => {
      const schema = z.string().min(3)
      const result = engine.validate('hello', schema)
      expect(result.valid).toBe(true)
    })

    it('should fail when string is too short', () => {
      const schema = z.string().min(5)
      const result = engine.validate('hi', schema)
      expect(result.valid).toBe(false)
      expect(result.errors[0].code).toBe('too_small')
      expect(result.errors[0].message).toContain('5')
    })

    it('should pass when string exactly meets minimum', () => {
      const schema = z.string().min(5)
      const result = engine.validate('hello', schema)
      expect(result.valid).toBe(true)
    })
  })

  describe('maxLength', () => {
    it('should pass when string is under maximum length', () => {
      const schema = z.string().max(10)
      const result = engine.validate('hello', schema)
      expect(result.valid).toBe(true)
    })

    it('should fail when string is too long', () => {
      const schema = z.string().max(3)
      const result = engine.validate('hello', schema)
      expect(result.valid).toBe(false)
      expect(result.errors[0].code).toBe('too_big')
    })

    it('should pass when string exactly meets maximum', () => {
      const schema = z.string().max(5)
      const result = engine.validate('hello', schema)
      expect(result.valid).toBe(true)
    })
  })

  describe('length', () => {
    it('should pass when string has exact length', () => {
      const schema = z.string().length(5)
      const result = engine.validate('hello', schema)
      expect(result.valid).toBe(true)
    })

    it('should fail when string length does not match', () => {
      const schema = z.string().length(3)
      const result = engine.validate('hello', schema)
      expect(result.valid).toBe(false)
    })
  })

  describe('email', () => {
    it('should validate valid email addresses', () => {
      const schema = z.string().email()
      expect(engine.validate('user@example.com', schema).valid).toBe(true)
      expect(engine.validate('user.name@example.co.uk', schema).valid).toBe(true)
      expect(engine.validate('user+tag@example.com', schema).valid).toBe(true)
    })

    it('should reject invalid email addresses', () => {
      const schema = z.string().email()
      expect(engine.validate('invalid', schema).valid).toBe(false)
      expect(engine.validate('missing@domain', schema).valid).toBe(false)
      expect(engine.validate('@example.com', schema).valid).toBe(false)
      expect(engine.validate('user@.com', schema).valid).toBe(false)
    })

    it('should provide correct error code', () => {
      const schema = z.string().email()
      const result = engine.validate('invalid', schema)
      expect(result.errors[0].code).toBe('invalid_string')
    })
  })

  describe('url', () => {
    it('should validate valid URLs', () => {
      const schema = z.string().url()
      expect(engine.validate('https://example.com', schema).valid).toBe(true)
      expect(engine.validate('http://example.com/path', schema).valid).toBe(true)
      expect(engine.validate('https://example.com:8080', schema).valid).toBe(true)
      expect(engine.validate('ftp://files.example.com', schema).valid).toBe(true)
    })

    it('should reject invalid URLs', () => {
      const schema = z.string().url()
      expect(engine.validate('not-a-url', schema).valid).toBe(false)
      expect(engine.validate('example.com', schema).valid).toBe(false)
      expect(engine.validate('://missing-protocol.com', schema).valid).toBe(false)
    })
  })

  describe('uuid', () => {
    it('should validate valid UUIDs', () => {
      const schema = z.string().uuid()
      expect(engine.validate('123e4567-e89b-12d3-a456-426614174000', schema).valid).toBe(true)
      expect(engine.validate('550e8400-e29b-41d4-a716-446655440000', schema).valid).toBe(true)
    })

    it('should reject invalid UUIDs', () => {
      const schema = z.string().uuid()
      expect(engine.validate('not-a-uuid', schema).valid).toBe(false)
      expect(engine.validate('123e4567-e89b-12d3-a456', schema).valid).toBe(false)
      expect(engine.validate('123e4567-e89b-12d3-a456-42661417400g', schema).valid).toBe(false)
    })
  })

  describe('regex', () => {
    it('should validate against custom regex', () => {
      const schema = z.string().regex(/^[A-Z]{3}-\d{4}$/)
      expect(engine.validate('ABC-1234', schema).valid).toBe(true)
      expect(engine.validate('XYZ-0001', schema).valid).toBe(true)
    })

    it('should reject strings not matching regex', () => {
      const schema = z.string().regex(/^[A-Z]{3}-\d{4}$/)
      expect(engine.validate('abc-1234', schema).valid).toBe(false)
      expect(engine.validate('ABCD-1234', schema).valid).toBe(false)
      expect(engine.validate('ABC-12345', schema).valid).toBe(false)
    })
  })

  describe('startsWith', () => {
    it('should validate strings starting with prefix', () => {
      const schema = z.string().startsWith('hello')
      expect(engine.validate('hello world', schema).valid).toBe(true)
      expect(engine.validate('hello', schema).valid).toBe(true)
    })

    it('should reject strings not starting with prefix', () => {
      const schema = z.string().startsWith('hello')
      expect(engine.validate('world hello', schema).valid).toBe(false)
    })
  })

  describe('endsWith', () => {
    it('should validate strings ending with suffix', () => {
      const schema = z.string().endsWith('.js')
      expect(engine.validate('file.js', schema).valid).toBe(true)
    })

    it('should reject strings not ending with suffix', () => {
      const schema = z.string().endsWith('.js')
      expect(engine.validate('file.ts', schema).valid).toBe(false)
    })
  })

  describe('includes', () => {
    it('should validate strings containing substring', () => {
      const schema = z.string().includes('world')
      expect(engine.validate('hello world', schema).valid).toBe(true)
    })

    it('should reject strings not containing substring', () => {
      const schema = z.string().includes('world')
      expect(engine.validate('hello there', schema).valid).toBe(false)
    })
  })

  describe('trim transformation', () => {
    it('should trim whitespace from strings', () => {
      const schema = z.string().trim()
      const result = engine.parse('  hello  ', schema)
      expect(result).toBe('hello')
    })
  })

  describe('toLowerCase transformation', () => {
    it('should convert strings to lowercase', () => {
      const schema = z.string().toLowerCase()
      const result = engine.parse('HELLO World', schema)
      expect(result).toBe('hello world')
    })
  })

  describe('toUpperCase transformation', () => {
    it('should convert strings to uppercase', () => {
      const schema = z.string().toUpperCase()
      const result = engine.parse('hello world', schema)
      expect(result).toBe('HELLO WORLD')
    })
  })

  describe('chained constraints', () => {
    it('should validate with multiple constraints', () => {
      const schema = z.string().min(3).max(10).email()
      expect(engine.validate('a@b.co', schema).valid).toBe(true)
    })

    it('should fail on first constraint violation', () => {
      const schema = z.string().min(3).max(10).email()
      const result = engine.validate('ab', schema)
      expect(result.valid).toBe(false)
      expect(result.errors[0].code).toBe('too_small')
    })
  })
})

// =============================================================================
// Number Constraints Tests
// =============================================================================

describe('Number Constraints', () => {
  let engine: ValidationEngine

  beforeEach(() => {
    engine = new ValidationEngine()
  })

  describe('min', () => {
    it('should pass when number meets minimum', () => {
      const schema = z.number().min(5)
      expect(engine.validate(5, schema).valid).toBe(true)
      expect(engine.validate(10, schema).valid).toBe(true)
    })

    it('should fail when number is below minimum', () => {
      const schema = z.number().min(5)
      const result = engine.validate(3, schema)
      expect(result.valid).toBe(false)
      expect(result.errors[0].code).toBe('too_small')
    })
  })

  describe('max', () => {
    it('should pass when number is under maximum', () => {
      const schema = z.number().max(10)
      expect(engine.validate(10, schema).valid).toBe(true)
      expect(engine.validate(5, schema).valid).toBe(true)
    })

    it('should fail when number exceeds maximum', () => {
      const schema = z.number().max(10)
      const result = engine.validate(15, schema)
      expect(result.valid).toBe(false)
      expect(result.errors[0].code).toBe('too_big')
    })
  })

  describe('gt (greater than)', () => {
    it('should pass when number is strictly greater', () => {
      const schema = z.number().gt(5)
      expect(engine.validate(6, schema).valid).toBe(true)
    })

    it('should fail when number equals boundary', () => {
      const schema = z.number().gt(5)
      expect(engine.validate(5, schema).valid).toBe(false)
    })
  })

  describe('gte (greater than or equal)', () => {
    it('should pass when number equals boundary', () => {
      const schema = z.number().gte(5)
      expect(engine.validate(5, schema).valid).toBe(true)
    })
  })

  describe('lt (less than)', () => {
    it('should pass when number is strictly less', () => {
      const schema = z.number().lt(10)
      expect(engine.validate(9, schema).valid).toBe(true)
    })

    it('should fail when number equals boundary', () => {
      const schema = z.number().lt(10)
      expect(engine.validate(10, schema).valid).toBe(false)
    })
  })

  describe('lte (less than or equal)', () => {
    it('should pass when number equals boundary', () => {
      const schema = z.number().lte(10)
      expect(engine.validate(10, schema).valid).toBe(true)
    })
  })

  describe('int', () => {
    it('should pass for integers', () => {
      const schema = z.number().int()
      expect(engine.validate(42, schema).valid).toBe(true)
      expect(engine.validate(-10, schema).valid).toBe(true)
      expect(engine.validate(0, schema).valid).toBe(true)
    })

    it('should fail for floating point numbers', () => {
      const schema = z.number().int()
      expect(engine.validate(3.14, schema).valid).toBe(false)
      expect(engine.validate(-1.5, schema).valid).toBe(false)
    })
  })

  describe('positive', () => {
    it('should pass for positive numbers', () => {
      const schema = z.number().positive()
      expect(engine.validate(1, schema).valid).toBe(true)
      expect(engine.validate(0.001, schema).valid).toBe(true)
    })

    it('should fail for zero and negative numbers', () => {
      const schema = z.number().positive()
      expect(engine.validate(0, schema).valid).toBe(false)
      expect(engine.validate(-1, schema).valid).toBe(false)
    })
  })

  describe('negative', () => {
    it('should pass for negative numbers', () => {
      const schema = z.number().negative()
      expect(engine.validate(-1, schema).valid).toBe(true)
      expect(engine.validate(-0.001, schema).valid).toBe(true)
    })

    it('should fail for zero and positive numbers', () => {
      const schema = z.number().negative()
      expect(engine.validate(0, schema).valid).toBe(false)
      expect(engine.validate(1, schema).valid).toBe(false)
    })
  })

  describe('nonNegative', () => {
    it('should pass for zero and positive numbers', () => {
      const schema = z.number().nonNegative()
      expect(engine.validate(0, schema).valid).toBe(true)
      expect(engine.validate(1, schema).valid).toBe(true)
    })

    it('should fail for negative numbers', () => {
      const schema = z.number().nonNegative()
      expect(engine.validate(-1, schema).valid).toBe(false)
    })
  })

  describe('nonPositive', () => {
    it('should pass for zero and negative numbers', () => {
      const schema = z.number().nonPositive()
      expect(engine.validate(0, schema).valid).toBe(true)
      expect(engine.validate(-1, schema).valid).toBe(true)
    })

    it('should fail for positive numbers', () => {
      const schema = z.number().nonPositive()
      expect(engine.validate(1, schema).valid).toBe(false)
    })
  })

  describe('finite', () => {
    it('should pass for finite numbers', () => {
      const schema = z.number().finite()
      expect(engine.validate(42, schema).valid).toBe(true)
    })

    it('should fail for Infinity', () => {
      const schema = z.number().finite()
      expect(engine.validate(Infinity, schema).valid).toBe(false)
      expect(engine.validate(-Infinity, schema).valid).toBe(false)
    })
  })

  describe('safe', () => {
    it('should pass for safe integers', () => {
      const schema = z.number().safe()
      expect(engine.validate(Number.MAX_SAFE_INTEGER, schema).valid).toBe(true)
      expect(engine.validate(Number.MIN_SAFE_INTEGER, schema).valid).toBe(true)
    })

    it('should fail for unsafe integers', () => {
      const schema = z.number().safe()
      expect(engine.validate(Number.MAX_SAFE_INTEGER + 1, schema).valid).toBe(false)
    })
  })

  describe('multipleOf', () => {
    it('should pass for multiples', () => {
      const schema = z.number().multipleOf(5)
      expect(engine.validate(10, schema).valid).toBe(true)
      expect(engine.validate(0, schema).valid).toBe(true)
      expect(engine.validate(-5, schema).valid).toBe(true)
    })

    it('should fail for non-multiples', () => {
      const schema = z.number().multipleOf(5)
      expect(engine.validate(7, schema).valid).toBe(false)
    })
  })
})

// =============================================================================
// Object Validation Tests
// =============================================================================

describe('Object Validation', () => {
  let engine: ValidationEngine

  beforeEach(() => {
    engine = new ValidationEngine()
  })

  describe('basic object validation', () => {
    it('should validate object with correct shape', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      })

      const result = engine.validate({ name: 'John', age: 30 }, schema)
      expect(result.valid).toBe(true)
      expect(result.value).toEqual({ name: 'John', age: 30 })
    })

    it('should reject non-object values', () => {
      const schema = z.object({ name: z.string() })
      expect(engine.validate('not an object', schema).valid).toBe(false)
      expect(engine.validate(null, schema).valid).toBe(false)
      expect(engine.validate([], schema).valid).toBe(false)
    })

    it('should report missing required fields', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      })

      const result = engine.validate({ name: 'John' }, schema)
      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].path).toBe('age')
      expect(result.errors[0].code).toBe('required')
    })

    it('should report invalid field types', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      })

      const result = engine.validate({ name: 'John', age: 'thirty' }, schema)
      expect(result.valid).toBe(false)
      expect(result.errors[0].path).toBe('age')
      expect(result.errors[0].code).toBe('invalid_type')
    })
  })

  describe('nested objects', () => {
    it('should validate nested objects', () => {
      const schema = z.object({
        user: z.object({
          name: z.string(),
          email: z.string().email(),
        }),
      })

      const result = engine.validate({
        user: { name: 'John', email: 'john@example.com' },
      }, schema)
      expect(result.valid).toBe(true)
    })

    it('should report errors with nested paths', () => {
      const schema = z.object({
        user: z.object({
          name: z.string(),
          email: z.string().email(),
        }),
      })

      const result = engine.validate({
        user: { name: 'John', email: 'invalid' },
      }, schema)
      expect(result.valid).toBe(false)
      expect(result.errors[0].path).toBe('user.email')
    })
  })

  describe('optional fields', () => {
    it('should allow omitted optional fields', () => {
      const schema = z.object({
        name: z.string(),
        nickname: z.string().optional(),
      })

      const result = engine.validate({ name: 'John' }, schema)
      expect(result.valid).toBe(true)
    })

    it('should validate optional fields when present', () => {
      const schema = z.object({
        name: z.string(),
        nickname: z.string().optional(),
      })

      const result = engine.validate({ name: 'John', nickname: 123 }, schema)
      expect(result.valid).toBe(false)
    })
  })

  describe('strict mode', () => {
    it('should reject unknown keys in strict mode', () => {
      const schema = z.object({ name: z.string() }).strict()

      const result = engine.validate({ name: 'John', extra: 'field' }, schema)
      expect(result.valid).toBe(false)
      expect(result.errors[0].code).toBe('unrecognized_keys')
    })
  })

  describe('passthrough mode', () => {
    it('should allow unknown keys in passthrough mode', () => {
      const schema = z.object({ name: z.string() }).passthrough()

      const result = engine.validate({ name: 'John', extra: 'field' }, schema)
      expect(result.valid).toBe(true)
      expect(result.value).toEqual({ name: 'John', extra: 'field' })
    })
  })

  describe('strip mode', () => {
    it('should remove unknown keys in strip mode', () => {
      const schema = z.object({ name: z.string() }).strip()

      const result = engine.parse({ name: 'John', extra: 'field' }, schema)
      expect(result).toEqual({ name: 'John' })
    })
  })

  describe('partial', () => {
    it('should make all fields optional', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      }).partial()

      const result = engine.validate({}, schema)
      expect(result.valid).toBe(true)
    })
  })

  describe('required', () => {
    it('should make all optional fields required', () => {
      const schema = z.object({
        name: z.string().optional(),
        age: z.number().optional(),
      }).required()

      const result = engine.validate({}, schema)
      expect(result.valid).toBe(false)
    })
  })

  describe('pick', () => {
    it('should create schema with only picked keys', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
        email: z.string(),
      }).pick(['name', 'email'])

      const result = engine.validate({ name: 'John', email: 'john@example.com' }, schema)
      expect(result.valid).toBe(true)
    })
  })

  describe('omit', () => {
    it('should create schema without omitted keys', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
        email: z.string(),
      }).omit(['email'])

      const result = engine.validate({ name: 'John', age: 30 }, schema)
      expect(result.valid).toBe(true)
    })
  })

  describe('extend', () => {
    it('should extend schema with new fields', () => {
      const baseSchema = z.object({ name: z.string() })
      const schema = baseSchema.extend({ age: z.number() })

      const result = engine.validate({ name: 'John', age: 30 }, schema)
      expect(result.valid).toBe(true)
    })
  })

  describe('merge', () => {
    it('should merge two object schemas', () => {
      const schema1 = z.object({ name: z.string() })
      const schema2 = z.object({ age: z.number() })
      const schema = schema1.merge(schema2)

      const result = engine.validate({ name: 'John', age: 30 }, schema)
      expect(result.valid).toBe(true)
    })
  })
})

// =============================================================================
// Array Validation Tests
// =============================================================================

describe('Array Validation', () => {
  let engine: ValidationEngine

  beforeEach(() => {
    engine = new ValidationEngine()
  })

  describe('basic array validation', () => {
    it('should validate array of strings', () => {
      const schema = z.array(z.string())
      const result = engine.validate(['a', 'b', 'c'], schema)
      expect(result.valid).toBe(true)
    })

    it('should reject non-array values', () => {
      const schema = z.array(z.string())
      expect(engine.validate('not an array', schema).valid).toBe(false)
      expect(engine.validate({}, schema).valid).toBe(false)
    })

    it('should validate element types', () => {
      const schema = z.array(z.number())
      const result = engine.validate([1, 'two', 3], schema)
      expect(result.valid).toBe(false)
      expect(result.errors[0].path).toBe('[1]')
    })
  })

  describe('array of objects', () => {
    it('should validate array of objects', () => {
      const schema = z.array(z.object({ name: z.string() }))
      const result = engine.validate([{ name: 'John' }, { name: 'Jane' }], schema)
      expect(result.valid).toBe(true)
    })

    it('should report errors with array index paths', () => {
      const schema = z.array(z.object({ name: z.string() }))
      const result = engine.validate([{ name: 'John' }, { name: 123 }], schema)
      expect(result.valid).toBe(false)
      expect(result.errors[0].path).toBe('[1].name')
    })
  })

  describe('minLength', () => {
    it('should pass when array meets minimum length', () => {
      const schema = z.array(z.string()).min(2)
      const result = engine.validate(['a', 'b', 'c'], schema)
      expect(result.valid).toBe(true)
    })

    it('should fail when array is too short', () => {
      const schema = z.array(z.string()).min(3)
      const result = engine.validate(['a', 'b'], schema)
      expect(result.valid).toBe(false)
      expect(result.errors[0].code).toBe('too_small')
    })
  })

  describe('maxLength', () => {
    it('should pass when array is under maximum', () => {
      const schema = z.array(z.string()).max(5)
      const result = engine.validate(['a', 'b'], schema)
      expect(result.valid).toBe(true)
    })

    it('should fail when array is too long', () => {
      const schema = z.array(z.string()).max(2)
      const result = engine.validate(['a', 'b', 'c'], schema)
      expect(result.valid).toBe(false)
      expect(result.errors[0].code).toBe('too_big')
    })
  })

  describe('length', () => {
    it('should validate exact length', () => {
      const schema = z.array(z.number()).length(3)
      expect(engine.validate([1, 2, 3], schema).valid).toBe(true)
      expect(engine.validate([1, 2], schema).valid).toBe(false)
    })
  })

  describe('nonEmpty', () => {
    it('should pass for non-empty arrays', () => {
      const schema = z.array(z.string()).nonEmpty()
      const result = engine.validate(['a'], schema)
      expect(result.valid).toBe(true)
    })

    it('should fail for empty arrays', () => {
      const schema = z.array(z.string()).nonEmpty()
      const result = engine.validate([], schema)
      expect(result.valid).toBe(false)
    })
  })

  describe('unique', () => {
    it('should pass for arrays with unique elements', () => {
      const schema = z.array(z.number()).unique()
      const result = engine.validate([1, 2, 3], schema)
      expect(result.valid).toBe(true)
    })

    it('should fail for arrays with duplicates', () => {
      const schema = z.array(z.number()).unique()
      const result = engine.validate([1, 2, 2, 3], schema)
      expect(result.valid).toBe(false)
    })
  })
})

// =============================================================================
// Union and Intersection Tests
// =============================================================================

describe('Union Types', () => {
  let engine: ValidationEngine

  beforeEach(() => {
    engine = new ValidationEngine()
  })

  describe('z.union', () => {
    it('should validate if any option matches', () => {
      const schema = z.union([z.string(), z.number()])
      expect(engine.validate('hello', schema).valid).toBe(true)
      expect(engine.validate(42, schema).valid).toBe(true)
    })

    it('should fail if no option matches', () => {
      const schema = z.union([z.string(), z.number()])
      const result = engine.validate(true, schema)
      expect(result.valid).toBe(false)
      expect(result.errors[0].code).toBe('invalid_union')
    })
  })

  describe('z.or', () => {
    it('should create union with or method', () => {
      const schema = z.string().or(z.number())
      expect(engine.validate('hello', schema).valid).toBe(true)
      expect(engine.validate(42, schema).valid).toBe(true)
      expect(engine.validate(true, schema).valid).toBe(false)
    })
  })

  describe('discriminated unions', () => {
    it('should validate discriminated unions', () => {
      const schema = z.union([
        z.object({ type: z.literal('dog'), barks: z.boolean() }),
        z.object({ type: z.literal('cat'), meows: z.boolean() }),
      ])

      expect(engine.validate({ type: 'dog', barks: true }, schema).valid).toBe(true)
      expect(engine.validate({ type: 'cat', meows: true }, schema).valid).toBe(true)
      expect(engine.validate({ type: 'bird' }, schema).valid).toBe(false)
    })
  })
})

describe('Intersection Types', () => {
  let engine: ValidationEngine

  beforeEach(() => {
    engine = new ValidationEngine()
  })

  describe('z.intersection', () => {
    it('should require all schemas to match', () => {
      const schema = z.intersection([
        z.object({ name: z.string() }),
        z.object({ age: z.number() }),
      ])

      expect(engine.validate({ name: 'John', age: 30 }, schema).valid).toBe(true)
      expect(engine.validate({ name: 'John' }, schema).valid).toBe(false)
    })
  })

  describe('z.and', () => {
    it('should create intersection with and method', () => {
      const schema1 = z.object({ name: z.string() })
      const schema2 = z.object({ age: z.number() })
      const schema = schema1.and(schema2)

      expect(engine.validate({ name: 'John', age: 30 }, schema).valid).toBe(true)
    })
  })
})

// =============================================================================
// Nullable and Optional Tests
// =============================================================================

describe('Nullable and Optional', () => {
  let engine: ValidationEngine

  beforeEach(() => {
    engine = new ValidationEngine()
  })

  describe('nullable', () => {
    it('should allow null values', () => {
      const schema = z.string().nullable()
      expect(engine.validate(null, schema).valid).toBe(true)
      expect(engine.validate('hello', schema).valid).toBe(true)
    })

    it('should still reject other invalid types', () => {
      const schema = z.string().nullable()
      expect(engine.validate(123, schema).valid).toBe(false)
    })
  })

  describe('optional', () => {
    it('should allow undefined values', () => {
      const schema = z.string().optional()
      expect(engine.validate(undefined, schema).valid).toBe(true)
      expect(engine.validate('hello', schema).valid).toBe(true)
    })
  })

  describe('nullish', () => {
    it('should allow both null and undefined', () => {
      const schema = z.string().nullish()
      expect(engine.validate(null, schema).valid).toBe(true)
      expect(engine.validate(undefined, schema).valid).toBe(true)
      expect(engine.validate('hello', schema).valid).toBe(true)
    })
  })

  describe('default', () => {
    it('should use default value for undefined', () => {
      const schema = z.string().default('default')
      const result = engine.parse(undefined, schema)
      expect(result).toBe('default')
    })

    it('should not use default for defined values', () => {
      const schema = z.string().default('default')
      const result = engine.parse('hello', schema)
      expect(result).toBe('hello')
    })
  })
})

// =============================================================================
// Custom Validators Tests
// =============================================================================

describe('Custom Validators', () => {
  let engine: ValidationEngine

  beforeEach(() => {
    engine = new ValidationEngine()
  })

  describe('refine', () => {
    it('should apply custom validation logic', () => {
      const schema = z.string().refine((val) => val.length > 5, 'Must be longer than 5 characters')
      expect(engine.validate('hello world', schema).valid).toBe(true)
      expect(engine.validate('hi', schema).valid).toBe(false)
    })

    it('should report custom error messages', () => {
      const schema = z.string().refine((val) => val.length > 5, 'Must be longer than 5 characters')
      const result = engine.validate('hi', schema)
      expect(result.errors[0].message).toBe('Must be longer than 5 characters')
      expect(result.errors[0].code).toBe('custom')
    })
  })

  describe('superRefine', () => {
    it('should allow adding multiple issues', () => {
      const schema = z.string().superRefine((val, ctx) => {
        if (val.length < 5) {
          ctx.addIssue({ message: 'Too short', code: 'custom' })
        }
        if (!val.includes('@')) {
          ctx.addIssue({ message: 'Must contain @', code: 'custom' })
        }
      })

      const result = engine.validate('hi', schema)
      expect(result.errors).toHaveLength(2)
    })
  })

  describe('transform', () => {
    it('should transform the value', () => {
      const schema = z.string().transform((val) => parseInt(val, 10))
      const result = engine.parse('42', schema)
      expect(result).toBe(42)
    })

    it('should apply transformations in order', () => {
      const schema = z.string()
        .trim()
        .transform((val) => val.split(','))
        .transform((arr) => arr.map((s) => s.toUpperCase()))

      const result = engine.parse('  a, b, c  ', schema)
      expect(result).toEqual(['A', ' B', ' C'])
    })
  })

  describe('registered custom validators', () => {
    it('should use registered validators by name', () => {
      engine.register('isEven', (val: number) => val % 2 === 0)
      const schema = z.number().use('isEven')

      expect(engine.validate(4, schema).valid).toBe(true)
      expect(engine.validate(3, schema).valid).toBe(false)
    })
  })
})

// =============================================================================
// Type Coercion Tests
// =============================================================================

describe('Type Coercion', () => {
  let engine: ValidationEngine

  beforeEach(() => {
    engine = new ValidationEngine()
  })

  describe('z.coerce.string', () => {
    it('should coerce numbers to strings', () => {
      const schema = z.coerce.string()
      const result = engine.parse(42, schema)
      expect(result).toBe('42')
    })

    it('should coerce booleans to strings', () => {
      const schema = z.coerce.string()
      expect(engine.parse(true, schema)).toBe('true')
      expect(engine.parse(false, schema)).toBe('false')
    })
  })

  describe('z.coerce.number', () => {
    it('should coerce strings to numbers', () => {
      const schema = z.coerce.number()
      expect(engine.parse('42', schema)).toBe(42)
      expect(engine.parse('3.14', schema)).toBe(3.14)
    })

    it('should fail for non-numeric strings', () => {
      const schema = z.coerce.number()
      const result = engine.validate('not a number', schema)
      expect(result.valid).toBe(false)
    })
  })

  describe('z.coerce.boolean', () => {
    it('should coerce truthy values to true', () => {
      const schema = z.coerce.boolean()
      expect(engine.parse(1, schema)).toBe(true)
      expect(engine.parse('true', schema)).toBe(true)
      expect(engine.parse('yes', schema)).toBe(true)
    })

    it('should coerce falsy values to false', () => {
      const schema = z.coerce.boolean()
      expect(engine.parse(0, schema)).toBe(false)
      expect(engine.parse('', schema)).toBe(false)
      expect(engine.parse(null, schema)).toBe(false)
    })
  })

  describe('z.coerce.date', () => {
    it('should coerce strings to dates', () => {
      const schema = z.coerce.date()
      const result = engine.parse('2024-01-15', schema)
      expect(result).toBeInstanceOf(Date)
      expect(result.getFullYear()).toBe(2024)
    })

    it('should coerce numbers (timestamps) to dates', () => {
      const schema = z.coerce.date()
      const timestamp = 1705276800000 // 2024-01-15
      const result = engine.parse(timestamp, schema)
      expect(result).toBeInstanceOf(Date)
    })
  })
})

// =============================================================================
// Error Messages and Paths Tests
// =============================================================================

describe('Error Messages and Paths', () => {
  let engine: ValidationEngine

  beforeEach(() => {
    engine = new ValidationEngine()
  })

  describe('custom error messages', () => {
    it('should use custom error messages when provided', () => {
      const schema = z.string().min(5, 'Name must be at least 5 characters')
      const result = engine.validate('hi', schema)
      expect(result.errors[0].message).toBe('Name must be at least 5 characters')
    })

    it('should use default messages when not provided', () => {
      const schema = z.string().min(5)
      const result = engine.validate('hi', schema)
      expect(result.errors[0].message).toContain('5')
    })
  })

  describe('error paths', () => {
    it('should provide correct path for nested errors', () => {
      const schema = z.object({
        users: z.array(z.object({
          profile: z.object({
            email: z.string().email(),
          }),
        })),
      })

      const result = engine.validate({
        users: [
          { profile: { email: 'valid@example.com' } },
          { profile: { email: 'invalid' } },
        ],
      }, schema)

      expect(result.errors[0].path).toBe('users[1].profile.email')
    })
  })

  describe('multiple errors', () => {
    it('should collect all errors by default', () => {
      const schema = z.object({
        name: z.string().min(5),
        age: z.number().min(0),
        email: z.string().email(),
      })

      const result = engine.validate({
        name: 'hi',
        age: -1,
        email: 'invalid',
      }, schema)

      expect(result.errors.length).toBeGreaterThanOrEqual(3)
    })
  })

  describe('error formatting', () => {
    it('should include expected and received in type errors', () => {
      const schema = z.string()
      const result = engine.validate(123, schema)
      expect(result.errors[0].expected).toBe('string')
      expect(result.errors[0].received).toBe('number')
    })
  })
})

// =============================================================================
// Async Validation Tests
// =============================================================================

describe('Async Validation', () => {
  let engine: ValidationEngine

  beforeEach(() => {
    engine = new ValidationEngine()
  })

  describe('async refine', () => {
    it('should handle async validators', async () => {
      const schema = z.string().refineAsync(async (val) => {
        // Simulate async check (e.g., database lookup)
        await new Promise(resolve => setTimeout(resolve, 10))
        return val !== 'taken'
      }, 'Username is already taken')

      const result1 = await engine.validateAsync('available', schema)
      expect(result1.valid).toBe(true)

      const result2 = await engine.validateAsync('taken', schema)
      expect(result2.valid).toBe(false)
    })
  })

  describe('parseAsync', () => {
    it('should resolve valid async parsing', async () => {
      const schema = z.string().refineAsync(async () => true)
      const result = await engine.parseAsync('hello', schema)
      expect(result).toBe('hello')
    })

    it('should reject invalid async parsing', async () => {
      const schema = z.string().refineAsync(async () => false, 'Invalid')
      await expect(engine.parseAsync('hello', schema)).rejects.toThrow()
    })
  })

  describe('safeParseAsync', () => {
    it('should return success result for valid data', async () => {
      const schema = z.string().refineAsync(async () => true)
      const result = await engine.safeParseAsync('hello', schema)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toBe('hello')
      }
    })

    it('should return error result for invalid data', async () => {
      const schema = z.string().refineAsync(async () => false, 'Invalid')
      const result = await engine.safeParseAsync('hello', schema)
      expect(result.success).toBe(false)
    })
  })
})

// =============================================================================
// Schema Composition Tests
// =============================================================================

describe('Schema Composition', () => {
  let engine: ValidationEngine

  beforeEach(() => {
    engine = new ValidationEngine()
  })

  describe('pipe', () => {
    it('should pipe schemas together', () => {
      const schema = z.string()
        .transform((s) => s.split(','))
        .pipe(z.array(z.string()).min(2))

      expect(engine.validate('a,b,c', schema).valid).toBe(true)
      expect(engine.validate('a', schema).valid).toBe(false)
    })
  })

  describe('brand', () => {
    it('should create branded types', () => {
      const EmailSchema = z.string().email().brand<'Email'>()
      const result = engine.validate('test@example.com', EmailSchema)
      expect(result.valid).toBe(true)
    })
  })

  describe('lazy', () => {
    it('should handle recursive schemas', () => {
      interface TreeNode {
        value: string
        children: TreeNode[]
      }

      const treeSchema: Schema = z.lazy(() => z.object({
        value: z.string(),
        children: z.array(treeSchema),
      }))

      const validTree = {
        value: 'root',
        children: [
          { value: 'child1', children: [] },
          { value: 'child2', children: [{ value: 'grandchild', children: [] }] },
        ],
      }

      expect(engine.validate(validTree, treeSchema).valid).toBe(true)
    })
  })
})

// =============================================================================
// Literal and Enum Tests
// =============================================================================

describe('Literal and Enum', () => {
  let engine: ValidationEngine

  beforeEach(() => {
    engine = new ValidationEngine()
  })

  describe('z.literal', () => {
    it('should validate exact string values', () => {
      const schema = z.literal('hello')
      expect(engine.validate('hello', schema).valid).toBe(true)
      expect(engine.validate('world', schema).valid).toBe(false)
    })

    it('should validate exact number values', () => {
      const schema = z.literal(42)
      expect(engine.validate(42, schema).valid).toBe(true)
      expect(engine.validate(43, schema).valid).toBe(false)
    })

    it('should validate boolean literals', () => {
      const schema = z.literal(true)
      expect(engine.validate(true, schema).valid).toBe(true)
      expect(engine.validate(false, schema).valid).toBe(false)
    })
  })

  describe('z.enum', () => {
    it('should validate against enum values', () => {
      const schema = z.enum(['red', 'green', 'blue'])
      expect(engine.validate('red', schema).valid).toBe(true)
      expect(engine.validate('green', schema).valid).toBe(true)
      expect(engine.validate('yellow', schema).valid).toBe(false)
    })

    it('should provide correct error for invalid enum', () => {
      const schema = z.enum(['red', 'green', 'blue'])
      const result = engine.validate('yellow', schema)
      expect(result.errors[0].code).toBe('invalid_enum')
    })
  })

  describe('z.nativeEnum', () => {
    it('should validate against TypeScript enums', () => {
      enum Color {
        Red = 'red',
        Green = 'green',
        Blue = 'blue',
      }

      const schema = z.nativeEnum(Color)
      expect(engine.validate('red', schema).valid).toBe(true)
      expect(engine.validate('yellow', schema).valid).toBe(false)
    })
  })
})

// =============================================================================
// Date Validation Tests
// =============================================================================

describe('Date Validation', () => {
  let engine: ValidationEngine

  beforeEach(() => {
    engine = new ValidationEngine()
  })

  describe('basic date validation', () => {
    it('should validate Date objects', () => {
      const schema = z.date()
      expect(engine.validate(new Date(), schema).valid).toBe(true)
    })

    it('should reject non-Date values', () => {
      const schema = z.date()
      expect(engine.validate('2024-01-15', schema).valid).toBe(false)
      expect(engine.validate(1705276800000, schema).valid).toBe(false)
    })

    it('should reject invalid Date objects', () => {
      const schema = z.date()
      expect(engine.validate(new Date('invalid'), schema).valid).toBe(false)
    })
  })

  describe('min date', () => {
    it('should pass for dates after minimum', () => {
      const schema = z.date().min(new Date('2024-01-01'))
      expect(engine.validate(new Date('2024-06-15'), schema).valid).toBe(true)
    })

    it('should fail for dates before minimum', () => {
      const schema = z.date().min(new Date('2024-01-01'))
      expect(engine.validate(new Date('2023-06-15'), schema).valid).toBe(false)
    })
  })

  describe('max date', () => {
    it('should pass for dates before maximum', () => {
      const schema = z.date().max(new Date('2024-12-31'))
      expect(engine.validate(new Date('2024-06-15'), schema).valid).toBe(true)
    })

    it('should fail for dates after maximum', () => {
      const schema = z.date().max(new Date('2024-12-31'))
      expect(engine.validate(new Date('2025-06-15'), schema).valid).toBe(false)
    })
  })
})

// =============================================================================
// Tuple and Record Tests
// =============================================================================

describe('Tuple Validation', () => {
  let engine: ValidationEngine

  beforeEach(() => {
    engine = new ValidationEngine()
  })

  describe('basic tuple', () => {
    it('should validate tuple with correct types', () => {
      const schema = z.tuple([z.string(), z.number(), z.boolean()])
      expect(engine.validate(['hello', 42, true], schema).valid).toBe(true)
    })

    it('should reject wrong types in tuple', () => {
      const schema = z.tuple([z.string(), z.number()])
      expect(engine.validate(['hello', 'world'], schema).valid).toBe(false)
    })

    it('should reject wrong length', () => {
      const schema = z.tuple([z.string(), z.number()])
      expect(engine.validate(['hello'], schema).valid).toBe(false)
      expect(engine.validate(['hello', 42, 'extra'], schema).valid).toBe(false)
    })
  })

  describe('tuple with rest', () => {
    it('should allow additional elements with rest schema', () => {
      const schema = z.tuple([z.string(), z.number()]).rest(z.boolean())
      expect(engine.validate(['hello', 42, true, false], schema).valid).toBe(true)
    })
  })
})

describe('Record Validation', () => {
  let engine: ValidationEngine

  beforeEach(() => {
    engine = new ValidationEngine()
  })

  describe('basic record', () => {
    it('should validate record with string keys', () => {
      const schema = z.record(z.string(), z.number())
      expect(engine.validate({ a: 1, b: 2 }, schema).valid).toBe(true)
    })

    it('should reject invalid values', () => {
      const schema = z.record(z.string(), z.number())
      expect(engine.validate({ a: 'one', b: 2 }, schema).valid).toBe(false)
    })
  })

  describe('record with key validation', () => {
    it('should validate keys against schema', () => {
      const schema = z.record(z.string().min(2), z.number())
      expect(engine.validate({ ab: 1, cd: 2 }, schema).valid).toBe(true)
      expect(engine.validate({ a: 1 }, schema).valid).toBe(false)
    })
  })
})

// =============================================================================
// Parse and SafeParse Tests
// =============================================================================

describe('Parse Methods', () => {
  let engine: ValidationEngine

  beforeEach(() => {
    engine = new ValidationEngine()
  })

  describe('parse', () => {
    it('should return value for valid data', () => {
      const schema = z.string()
      const result = engine.parse('hello', schema)
      expect(result).toBe('hello')
    })

    it('should throw for invalid data', () => {
      const schema = z.string()
      expect(() => engine.parse(123, schema)).toThrow()
    })

    it('should throw with validation errors', () => {
      const schema = z.string()
      try {
        engine.parse(123, schema)
      } catch (e) {
        expect(Array.isArray(e)).toBe(true)
        expect((e as ValidationError[])[0].code).toBe('invalid_type')
      }
    })
  })

  describe('safeParse', () => {
    it('should return success result for valid data', () => {
      const schema = z.string()
      const result = engine.safeParse('hello', schema)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toBe('hello')
      }
    })

    it('should return error result for invalid data', () => {
      const schema = z.string()
      const result = engine.safeParse(123, schema)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toHaveLength(1)
      }
    })
  })
})

// =============================================================================
// Edge Cases Tests
// =============================================================================

describe('Edge Cases', () => {
  let engine: ValidationEngine

  beforeEach(() => {
    engine = new ValidationEngine()
  })

  describe('empty values', () => {
    it('should handle empty string', () => {
      const schema = z.string()
      expect(engine.validate('', schema).valid).toBe(true)
    })

    it('should handle empty array', () => {
      const schema = z.array(z.string())
      expect(engine.validate([], schema).valid).toBe(true)
    })

    it('should handle empty object', () => {
      const schema = z.object({})
      expect(engine.validate({}, schema).valid).toBe(true)
    })
  })

  describe('special values', () => {
    it('should handle zero', () => {
      const schema = z.number()
      expect(engine.validate(0, schema).valid).toBe(true)
    })

    it('should handle negative zero', () => {
      const schema = z.number()
      expect(engine.validate(-0, schema).valid).toBe(true)
    })

    it('should handle very large numbers', () => {
      const schema = z.number()
      expect(engine.validate(1e308, schema).valid).toBe(true)
    })

    it('should handle very small numbers', () => {
      const schema = z.number()
      expect(engine.validate(1e-308, schema).valid).toBe(true)
    })
  })

  describe('deep nesting', () => {
    it('should handle deeply nested objects', () => {
      const schema = z.object({
        a: z.object({
          b: z.object({
            c: z.object({
              d: z.object({
                e: z.string(),
              }),
            }),
          }),
        }),
      })

      expect(engine.validate({
        a: { b: { c: { d: { e: 'deep' } } } },
      }, schema).valid).toBe(true)
    })

    it('should report correct path for deep errors', () => {
      const schema = z.object({
        a: z.object({
          b: z.object({
            c: z.string(),
          }),
        }),
      })

      const result = engine.validate({ a: { b: { c: 123 } } }, schema)
      expect(result.errors[0].path).toBe('a.b.c')
    })
  })

  describe('circular references', () => {
    it('should handle objects with circular references gracefully', () => {
      const schema = z.object({
        name: z.string(),
        self: z.any().optional(),
      })

      const obj: Record<string, unknown> = { name: 'test' }
      obj.self = obj

      // Should not cause stack overflow
      expect(() => engine.validate(obj, schema)).not.toThrow()
    })
  })
})

// =============================================================================
// Validator Classes Tests
// =============================================================================

describe('StringValidator Class', () => {
  it('should provide chainable API', () => {
    const validator = new StringValidator()
      .min(3)
      .max(10)
      .email()

    expect(validator.build()._type).toBe('string')
  })
})

describe('NumberValidator Class', () => {
  it('should provide chainable API', () => {
    const validator = new NumberValidator()
      .min(0)
      .max(100)
      .int()

    expect(validator.build()._type).toBe('number')
  })
})

describe('ObjectValidator Class', () => {
  it('should provide chainable API', () => {
    const validator = new ObjectValidator({
      name: z.string(),
    }).strict()

    expect(validator.build()._type).toBe('object')
  })
})

describe('ArrayValidator Class', () => {
  it('should provide chainable API', () => {
    const validator = new ArrayValidator(z.string())
      .min(1)
      .max(10)
      .unique()

    expect(validator.build()._type).toBe('array')
  })
})
