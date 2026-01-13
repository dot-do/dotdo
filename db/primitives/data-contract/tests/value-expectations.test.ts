/**
 * Value Expectations Tests - Comprehensive value validation for data contracts
 *
 * Tests for range, regex, enum, and custom validation:
 * - Range validation: min/max for numbers, length for strings, date ranges
 * - Regex validation: Pattern matching for strings
 * - Enum validation: Value must be in allowed set
 * - Custom predicates: Arbitrary validation functions
 * - Null handling: How to treat nulls in validation
 * - Built-in validators: email, phone, URL, etc.
 */
import { describe, it, expect } from 'vitest'
import {
  valueExpect,
  ve,
  validateValue,
  validateRecord,
  validateRecords,
  ValueExpectation,
  ValueExpectationBuilder,
  ValueValidationResult,
  ValueValidationFailure,
  // Built-in patterns
  patterns,
  // Null handling
  NullHandling,
} from '../value-expectations'

// ============================================================================
// RANGE VALIDATION TESTS
// ============================================================================

describe('ValueExpectations', () => {
  describe('Range Validation', () => {
    describe('.toBeBetween()', () => {
      it('should pass when number value is within range', () => {
        const expectation = valueExpect('age').toBeBetween(0, 150).build()
        const result = expectation.validate(25)

        expect(result.valid).toBe(true)
        expect(result.failures).toHaveLength(0)
      })

      it('should pass when value equals min bound (inclusive)', () => {
        const expectation = valueExpect('age').toBeBetween(0, 150).build()
        const result = expectation.validate(0)

        expect(result.valid).toBe(true)
      })

      it('should pass when value equals max bound (inclusive)', () => {
        const expectation = valueExpect('age').toBeBetween(0, 150).build()
        const result = expectation.validate(150)

        expect(result.valid).toBe(true)
      })

      it('should fail when value is below min', () => {
        const expectation = valueExpect('age').toBeBetween(0, 150).build()
        const result = expectation.validate(-5)

        expect(result.valid).toBe(false)
        expect(result.failures[0]?.type).toBe('between')
        expect(result.failures[0]?.message).toContain('not between')
      })

      it('should fail when value is above max', () => {
        const expectation = valueExpect('age').toBeBetween(0, 150).build()
        const result = expectation.validate(200)

        expect(result.valid).toBe(false)
        expect(result.failures[0]?.message).toContain('not between')
      })

      it('should support exclusive bounds', () => {
        const expectation = valueExpect('score')
          .toBeBetween(0, 100, { exclusive: true })
          .build()

        expect(expectation.validate(0).valid).toBe(false)
        expect(expectation.validate(100).valid).toBe(false)
        expect(expectation.validate(50).valid).toBe(true)
        expect(expectation.validate(1).valid).toBe(true)
        expect(expectation.validate(99).valid).toBe(true)
      })

      it('should support includeMin/includeMax options', () => {
        const expectation = valueExpect('score')
          .toBeBetween(0, 100, { includeMin: false, includeMax: true })
          .build()

        expect(expectation.validate(0).valid).toBe(false)
        expect(expectation.validate(100).valid).toBe(true)
      })

      it('should validate date ranges', () => {
        const start = new Date('2020-01-01')
        const end = new Date('2025-12-31')
        const expectation = valueExpect('createdAt').toBeBetween(start, end).build()

        expect(expectation.validate(new Date('2023-06-15')).valid).toBe(true)
        expect(expectation.validate(new Date('2019-01-01')).valid).toBe(false)
        expect(expectation.validate(new Date('2026-01-01')).valid).toBe(false)
      })

      it('should validate date strings', () => {
        const start = new Date('2020-01-01')
        const end = new Date('2025-12-31')
        const expectation = valueExpect('createdAt').toBeBetween(start, end).build()

        expect(expectation.validate('2023-06-15').valid).toBe(true)
        expect(expectation.validate('2019-01-01').valid).toBe(false)
      })

      it('should fail for invalid date strings', () => {
        const start = new Date('2020-01-01')
        const end = new Date('2025-12-31')
        const expectation = valueExpect('createdAt').toBeBetween(start, end).build()

        const result = expectation.validate('not-a-date')
        expect(result.valid).toBe(false)
        expect(result.failures[0]?.message).toContain('invalid date')
      })

      it('should fail for non-numeric values when expecting numbers', () => {
        const expectation = valueExpect('age').toBeBetween(0, 150).build()
        const result = expectation.validate('twenty-five')

        expect(result.valid).toBe(false)
        expect(result.failures[0]?.message).toContain('expected number')
      })
    })

    describe('.toBeGreaterThan()', () => {
      it('should pass when value is greater than threshold', () => {
        const expectation = valueExpect('price').toBeGreaterThan(0).build()

        expect(expectation.validate(10).valid).toBe(true)
        expect(expectation.validate(0.01).valid).toBe(true)
      })

      it('should fail when value equals threshold', () => {
        const expectation = valueExpect('price').toBeGreaterThan(0).build()

        expect(expectation.validate(0).valid).toBe(false)
      })

      it('should fail when value is less than threshold', () => {
        const expectation = valueExpect('price').toBeGreaterThan(0).build()

        expect(expectation.validate(-5).valid).toBe(false)
      })

      it('should work with dates', () => {
        const threshold = new Date('2020-01-01')
        const expectation = valueExpect('date').toBeGreaterThan(threshold).build()

        expect(expectation.validate(new Date('2021-01-01')).valid).toBe(true)
        expect(expectation.validate(new Date('2019-01-01')).valid).toBe(false)
        expect(expectation.validate(new Date('2020-01-01')).valid).toBe(false)
      })
    })

    describe('.toBeGreaterThanOrEqual()', () => {
      it('should pass when value equals threshold', () => {
        const expectation = valueExpect('quantity').toBeGreaterThanOrEqual(0).build()

        expect(expectation.validate(0).valid).toBe(true)
        expect(expectation.validate(10).valid).toBe(true)
      })

      it('should fail when value is less than threshold', () => {
        const expectation = valueExpect('quantity').toBeGreaterThanOrEqual(0).build()

        expect(expectation.validate(-1).valid).toBe(false)
      })
    })

    describe('.toBeLessThan()', () => {
      it('should pass when value is less than threshold', () => {
        const expectation = valueExpect('discount').toBeLessThan(100).build()

        expect(expectation.validate(50).valid).toBe(true)
        expect(expectation.validate(99.99).valid).toBe(true)
      })

      it('should fail when value equals threshold', () => {
        const expectation = valueExpect('discount').toBeLessThan(100).build()

        expect(expectation.validate(100).valid).toBe(false)
      })
    })

    describe('.toBeLessThanOrEqual()', () => {
      it('should pass when value equals threshold', () => {
        const expectation = valueExpect('discount').toBeLessThanOrEqual(100).build()

        expect(expectation.validate(100).valid).toBe(true)
        expect(expectation.validate(50).valid).toBe(true)
      })

      it('should fail when value exceeds threshold', () => {
        const expectation = valueExpect('discount').toBeLessThanOrEqual(100).build()

        expect(expectation.validate(101).valid).toBe(false)
      })
    })
  })

  // ==========================================================================
  // REGEX VALIDATION TESTS
  // ==========================================================================

  describe('Regex Validation', () => {
    describe('.toMatchRegex()', () => {
      it('should pass when string matches regex pattern', () => {
        const expectation = valueExpect('code').toMatchRegex(/^[A-Z]{3}-\d{4}$/).build()

        expect(expectation.validate('ABC-1234').valid).toBe(true)
        expect(expectation.validate('XYZ-9999').valid).toBe(true)
      })

      it('should fail when string does not match regex pattern', () => {
        const expectation = valueExpect('code').toMatchRegex(/^[A-Z]{3}-\d{4}$/).build()

        expect(expectation.validate('abc-1234').valid).toBe(false)
        expect(expectation.validate('ABCD-1234').valid).toBe(false)
        expect(expectation.validate('AB-1234').valid).toBe(false)
      })

      it('should accept regex as string', () => {
        const expectation = valueExpect('code').toMatchRegex('^[A-Z]{3}-\\d{4}$').build()

        expect(expectation.validate('ABC-1234').valid).toBe(true)
        expect(expectation.validate('abc-1234').valid).toBe(false)
      })

      it('should fail for non-string values', () => {
        const expectation = valueExpect('code').toMatchRegex(/test/).build()

        expect(expectation.validate(123).valid).toBe(false)
        expect(expectation.validate({ value: 'test' }).valid).toBe(false)
      })

      it('should provide useful error message', () => {
        const expectation = valueExpect('email').toMatchRegex(/^.+@.+\..+$/).build()
        const result = expectation.validate('not-an-email')

        expect(result.valid).toBe(false)
        expect(result.failures[0]?.message).toContain('does not match pattern')
        expect(result.failures[0]?.actualValue).toBe('not-an-email')
      })
    })

    describe('.toStartWith()', () => {
      it('should pass when string starts with prefix', () => {
        const expectation = valueExpect('url').toStartWith('https://').build()

        expect(expectation.validate('https://example.com').valid).toBe(true)
        expect(expectation.validate('https://').valid).toBe(true)
      })

      it('should fail when string does not start with prefix', () => {
        const expectation = valueExpect('url').toStartWith('https://').build()

        expect(expectation.validate('http://example.com').valid).toBe(false)
        expect(expectation.validate('example.com').valid).toBe(false)
      })
    })

    describe('.toEndWith()', () => {
      it('should pass when string ends with suffix', () => {
        const expectation = valueExpect('filename').toEndWith('.json').build()

        expect(expectation.validate('config.json').valid).toBe(true)
        expect(expectation.validate('.json').valid).toBe(true)
      })

      it('should fail when string does not end with suffix', () => {
        const expectation = valueExpect('filename').toEndWith('.json').build()

        expect(expectation.validate('config.yaml').valid).toBe(false)
        expect(expectation.validate('config.json.bak').valid).toBe(false)
      })
    })
  })

  // ==========================================================================
  // ENUM VALIDATION TESTS
  // ==========================================================================

  describe('Enum Validation', () => {
    describe('.toBeIn()', () => {
      it('should pass when value is in allowed set', () => {
        const expectation = valueExpect('status')
          .toBeIn(['active', 'inactive', 'pending'])
          .build()

        expect(expectation.validate('active').valid).toBe(true)
        expect(expectation.validate('inactive').valid).toBe(true)
        expect(expectation.validate('pending').valid).toBe(true)
      })

      it('should fail when value is not in allowed set', () => {
        const expectation = valueExpect('status')
          .toBeIn(['active', 'inactive', 'pending'])
          .build()

        expect(expectation.validate('deleted').valid).toBe(false)
        expect(expectation.validate('ACTIVE').valid).toBe(false) // case sensitive
      })

      it('should work with numeric enums', () => {
        const expectation = valueExpect('priority').toBeIn([1, 2, 3]).build()

        expect(expectation.validate(1).valid).toBe(true)
        expect(expectation.validate(2).valid).toBe(true)
        expect(expectation.validate(4).valid).toBe(false)
      })

      it('should work with boolean enums', () => {
        const expectation = valueExpect('flag').toBeIn([true, false]).build()

        expect(expectation.validate(true).valid).toBe(true)
        expect(expectation.validate(false).valid).toBe(true)
      })

      it('should work with Set', () => {
        const allowedValues = new Set(['a', 'b', 'c'])
        const expectation = valueExpect('letter').toBeIn(allowedValues).build()

        expect(expectation.validate('a').valid).toBe(true)
        expect(expectation.validate('d').valid).toBe(false)
      })

      it('should provide useful error message listing allowed values', () => {
        const expectation = valueExpect('status')
          .toBeIn(['active', 'inactive'])
          .build()
        const result = expectation.validate('deleted')

        expect(result.failures[0]?.message).toContain('active')
        expect(result.failures[0]?.message).toContain('inactive')
        expect(result.failures[0]?.expectedValue).toEqual(['active', 'inactive'])
      })
    })

    describe('.toBeOneOf()', () => {
      it('should be an alias for toBeIn()', () => {
        const expectation = valueExpect('status')
          .toBeOneOf(['active', 'inactive'])
          .build()

        expect(expectation.validate('active').valid).toBe(true)
        expect(expectation.validate('deleted').valid).toBe(false)
      })
    })
  })

  // ==========================================================================
  // LENGTH VALIDATION TESTS
  // ==========================================================================

  describe('Length Validation', () => {
    describe('.toHaveLength()', () => {
      it('should pass when string length is within range', () => {
        const expectation = valueExpect('username').toHaveLength(3, 20).build()

        expect(expectation.validate('john').valid).toBe(true)
        expect(expectation.validate('abc').valid).toBe(true)
        expect(expectation.validate('a'.repeat(20)).valid).toBe(true)
      })

      it('should fail when string is too short', () => {
        const expectation = valueExpect('username').toHaveLength(3, 20).build()

        expect(expectation.validate('ab').valid).toBe(false)
        expect(expectation.validate('').valid).toBe(false)
      })

      it('should fail when string is too long', () => {
        const expectation = valueExpect('username').toHaveLength(3, 20).build()

        expect(expectation.validate('a'.repeat(21)).valid).toBe(false)
      })

      it('should work with arrays', () => {
        const expectation = valueExpect('tags').toHaveLength(1, 5).build()

        expect(expectation.validate(['a']).valid).toBe(true)
        expect(expectation.validate(['a', 'b', 'c']).valid).toBe(true)
        expect(expectation.validate([]).valid).toBe(false)
        expect(expectation.validate(['a', 'b', 'c', 'd', 'e', 'f']).valid).toBe(false)
      })

      it('should work with single min argument (same as exact)', () => {
        const expectation = valueExpect('code').toHaveLength(6).build()

        expect(expectation.validate('ABC123').valid).toBe(true)
        expect(expectation.validate('ABC12').valid).toBe(false)
        expect(expectation.validate('ABC1234').valid).toBe(false)
      })
    })

    describe('.toHaveExactLength()', () => {
      it('should pass when length is exactly as specified', () => {
        const expectation = valueExpect('pin').toHaveExactLength(4).build()

        expect(expectation.validate('1234').valid).toBe(true)
        expect(expectation.validate(['a', 'b', 'c', 'd']).valid).toBe(true)
      })

      it('should fail when length differs', () => {
        const expectation = valueExpect('pin').toHaveExactLength(4).build()

        expect(expectation.validate('123').valid).toBe(false)
        expect(expectation.validate('12345').valid).toBe(false)
      })
    })
  })

  // ==========================================================================
  // CUSTOM VALIDATION TESTS
  // ==========================================================================

  describe('Custom Validation', () => {
    describe('.toPassCustom()', () => {
      it('should pass when custom function returns true', () => {
        const isEven = (n: number) => n % 2 === 0
        const expectation = valueExpect('count').toPassCustom(isEven).build()

        expect(expectation.validate(2).valid).toBe(true)
        expect(expectation.validate(4).valid).toBe(true)
        expect(expectation.validate(100).valid).toBe(true)
      })

      it('should fail when custom function returns false', () => {
        const isEven = (n: number) => n % 2 === 0
        const expectation = valueExpect('count').toPassCustom(isEven).build()

        expect(expectation.validate(1).valid).toBe(false)
        expect(expectation.validate(3).valid).toBe(false)
      })

      it('should accept custom error message', () => {
        const isEven = (n: number) => n % 2 === 0
        const expectation = valueExpect('count')
          .toPassCustom(isEven, 'Value must be even')
          .build()

        const result = expectation.validate(3)
        expect(result.failures[0]?.message).toBe('Value must be even')
      })

      it('should support returning object with valid and message', () => {
        const validateEmail = (value: unknown) => {
          if (typeof value !== 'string') {
            return { valid: false, message: 'Expected string' }
          }
          if (!value.includes('@')) {
            return { valid: false, message: 'Missing @ symbol' }
          }
          return { valid: true }
        }

        const expectation = valueExpect('email').toPassCustom(validateEmail).build()

        expect(expectation.validate('test@example.com').valid).toBe(true)
        expect(expectation.validate('invalid').valid).toBe(false)
        expect(expectation.validate('invalid').failures[0]?.message).toBe('Missing @ symbol')
      })

      it('should handle validation functions that throw', () => {
        const throwingValidator = () => {
          throw new Error('Validation error')
        }

        const expectation = valueExpect('field')
          .toPassCustom(throwingValidator)
          .build()

        const result = expectation.validate('anything')
        expect(result.valid).toBe(false)
        expect(result.failures[0]?.message).toContain('threw error')
        expect(result.failures[0]?.message).toContain('Validation error')
      })
    })
  })

  // ==========================================================================
  // DATE VALIDATION TESTS
  // ==========================================================================

  describe('Date Validation', () => {
    describe('.toBeAfter()', () => {
      it('should pass when date is after threshold', () => {
        const threshold = new Date('2020-01-01')
        const expectation = valueExpect('date').toBeAfter(threshold).build()

        expect(expectation.validate(new Date('2021-01-01')).valid).toBe(true)
        expect(expectation.validate('2021-01-01').valid).toBe(true)
      })

      it('should fail when date equals threshold', () => {
        const threshold = new Date('2020-01-01')
        const expectation = valueExpect('date').toBeAfter(threshold).build()

        expect(expectation.validate(new Date('2020-01-01')).valid).toBe(false)
      })

      it('should fail when date is before threshold', () => {
        const threshold = new Date('2020-01-01')
        const expectation = valueExpect('date').toBeAfter(threshold).build()

        expect(expectation.validate(new Date('2019-01-01')).valid).toBe(false)
      })
    })

    describe('.toBeBefore()', () => {
      it('should pass when date is before threshold', () => {
        const threshold = new Date('2025-01-01')
        const expectation = valueExpect('date').toBeBefore(threshold).build()

        expect(expectation.validate(new Date('2024-01-01')).valid).toBe(true)
      })

      it('should fail when date equals or exceeds threshold', () => {
        const threshold = new Date('2025-01-01')
        const expectation = valueExpect('date').toBeBefore(threshold).build()

        expect(expectation.validate(new Date('2025-01-01')).valid).toBe(false)
        expect(expectation.validate(new Date('2026-01-01')).valid).toBe(false)
      })
    })

    describe('.toBeDateBetween()', () => {
      it('should pass when date is within range', () => {
        const start = new Date('2020-01-01')
        const end = new Date('2025-12-31')
        const expectation = valueExpect('date').toBeDateBetween(start, end).build()

        expect(expectation.validate(new Date('2022-06-15')).valid).toBe(true)
        expect(expectation.validate(new Date('2020-01-01')).valid).toBe(true)
        expect(expectation.validate(new Date('2025-12-31')).valid).toBe(true)
      })

      it('should fail when date is outside range', () => {
        const start = new Date('2020-01-01')
        const end = new Date('2025-12-31')
        const expectation = valueExpect('date').toBeDateBetween(start, end).build()

        expect(expectation.validate(new Date('2019-12-31')).valid).toBe(false)
        expect(expectation.validate(new Date('2026-01-01')).valid).toBe(false)
      })
    })
  })

  // ==========================================================================
  // NULL HANDLING TESTS
  // ==========================================================================

  describe('Null Handling', () => {
    it('should skip validation for null values by default', () => {
      const expectation = valueExpect('age').toBeBetween(0, 150).build()

      expect(expectation.validate(null).valid).toBe(true)
      expect(expectation.validate(undefined).valid).toBe(true)
    })

    it('should support NullHandling.SKIP (default)', () => {
      const expectation = valueExpect('age')
        .withNullHandling(NullHandling.SKIP)
        .toBeBetween(0, 150)
        .build()

      expect(expectation.validate(null).valid).toBe(true)
    })

    it('should support NullHandling.FAIL', () => {
      const expectation = valueExpect('age')
        .withNullHandling(NullHandling.FAIL)
        .toBeBetween(0, 150)
        .build()

      expect(expectation.validate(null).valid).toBe(false)
      expect(expectation.validate(null).failures[0]?.message).toContain('null')
    })

    it('should support NullHandling.PASS', () => {
      const expectation = valueExpect('age')
        .withNullHandling(NullHandling.PASS)
        .toBeBetween(0, 150)
        .build()

      expect(expectation.validate(null).valid).toBe(true)
    })

    it('should distinguish between null and undefined with NullHandling.FAIL', () => {
      const expectation = valueExpect('field')
        .withNullHandling(NullHandling.FAIL)
        .toBeIn(['a', 'b'])
        .build()

      const nullResult = expectation.validate(null)
      const undefinedResult = expectation.validate(undefined)

      expect(nullResult.valid).toBe(false)
      expect(undefinedResult.valid).toBe(false)
    })
  })

  // ==========================================================================
  // BUILT-IN PATTERN VALIDATORS TESTS
  // ==========================================================================

  describe('Built-in Pattern Validators', () => {
    describe('patterns.email', () => {
      it('should validate email addresses', () => {
        const expectation = valueExpect('email').toMatchRegex(patterns.email).build()

        expect(expectation.validate('test@example.com').valid).toBe(true)
        expect(expectation.validate('user.name+tag@domain.co.uk').valid).toBe(true)
        expect(expectation.validate('invalid').valid).toBe(false)
        expect(expectation.validate('@missing-local.com').valid).toBe(false)
        expect(expectation.validate('missing-at-sign.com').valid).toBe(false)
      })
    })

    describe('patterns.phone', () => {
      it('should validate phone numbers', () => {
        const expectation = valueExpect('phone').toMatchRegex(patterns.phone).build()

        expect(expectation.validate('+1234567890').valid).toBe(true)
        expect(expectation.validate('(123) 456-7890').valid).toBe(true)
        expect(expectation.validate('123-456-7890').valid).toBe(true)
        expect(expectation.validate('abc').valid).toBe(false)
      })
    })

    describe('patterns.url', () => {
      it('should validate URLs', () => {
        const expectation = valueExpect('url').toMatchRegex(patterns.url).build()

        expect(expectation.validate('https://example.com').valid).toBe(true)
        expect(expectation.validate('http://example.com/path').valid).toBe(true)
        expect(expectation.validate('not-a-url').valid).toBe(false)
      })
    })

    describe('patterns.uuid', () => {
      it('should validate UUIDs', () => {
        const expectation = valueExpect('id').toMatchRegex(patterns.uuid).build()

        expect(
          expectation.validate('550e8400-e29b-41d4-a716-446655440000').valid
        ).toBe(true)
        expect(
          expectation.validate('550E8400-E29B-41D4-A716-446655440000').valid
        ).toBe(true)
        expect(expectation.validate('not-a-uuid').valid).toBe(false)
        expect(expectation.validate('550e8400-e29b-41d4-a716').valid).toBe(false)
      })
    })

    describe('patterns.ipv4', () => {
      it('should validate IPv4 addresses', () => {
        const expectation = valueExpect('ip').toMatchRegex(patterns.ipv4).build()

        expect(expectation.validate('192.168.1.1').valid).toBe(true)
        expect(expectation.validate('0.0.0.0').valid).toBe(true)
        expect(expectation.validate('255.255.255.255').valid).toBe(true)
        expect(expectation.validate('256.1.1.1').valid).toBe(false)
        expect(expectation.validate('192.168.1').valid).toBe(false)
      })
    })

    describe('patterns.creditCard', () => {
      it('should validate credit card numbers', () => {
        const expectation = valueExpect('card')
          .toMatchRegex(patterns.creditCard)
          .build()

        expect(expectation.validate('4111111111111111').valid).toBe(true) // Visa
        expect(expectation.validate('5500000000000004').valid).toBe(true) // Mastercard
        expect(expectation.validate('123').valid).toBe(false)
      })
    })

    describe('patterns.postalCodeUS', () => {
      it('should validate US postal codes', () => {
        const expectation = valueExpect('zip')
          .toMatchRegex(patterns.postalCodeUS)
          .build()

        expect(expectation.validate('12345').valid).toBe(true)
        expect(expectation.validate('12345-6789').valid).toBe(true)
        expect(expectation.validate('1234').valid).toBe(false)
      })
    })

    describe('patterns.slug', () => {
      it('should validate URL slugs', () => {
        const expectation = valueExpect('slug').toMatchRegex(patterns.slug).build()

        expect(expectation.validate('my-blog-post').valid).toBe(true)
        expect(expectation.validate('article-123').valid).toBe(true)
        expect(expectation.validate('My Blog Post').valid).toBe(false)
        expect(expectation.validate('my_blog_post').valid).toBe(false)
      })
    })

    describe('patterns.alphanumeric', () => {
      it('should validate alphanumeric strings', () => {
        const expectation = valueExpect('code')
          .toMatchRegex(patterns.alphanumeric)
          .build()

        expect(expectation.validate('abc123').valid).toBe(true)
        expect(expectation.validate('ABC123').valid).toBe(true)
        expect(expectation.validate('abc-123').valid).toBe(false)
        expect(expectation.validate('abc 123').valid).toBe(false)
      })
    })
  })

  // ==========================================================================
  // CHAINING TESTS
  // ==========================================================================

  describe('Chaining', () => {
    it('should allow chaining multiple constraints', () => {
      const expectation = valueExpect('username')
        .toHaveLength(3, 20)
        .toMatchRegex(/^[a-z0-9_]+$/)
        .build()

      expect(expectation.validate('john_doe').valid).toBe(true)
      expect(expectation.validate('ab').valid).toBe(false) // too short
      expect(expectation.validate('John_Doe').valid).toBe(false) // uppercase
    })

    it('should validate all chained constraints', () => {
      const expectation = valueExpect('score')
        .toBeBetween(0, 100)
        .toBeGreaterThan(-1)
        .toBeLessThan(101)
        .build()

      expect(expectation.validate(50).valid).toBe(true)
    })

    it('should report all failures when multiple constraints fail', () => {
      const expectation = valueExpect('value')
        .toBeBetween(0, 10)
        .toBeIn([1, 2, 3])
        .build()

      const result = expectation.validate(50)
      expect(result.valid).toBe(false)
      expect(result.failures.length).toBeGreaterThanOrEqual(2)
    })
  })

  // ==========================================================================
  // VALIDATE HELPER FUNCTIONS TESTS
  // ==========================================================================

  describe('Helper Functions', () => {
    describe('validateValue()', () => {
      it('should validate a value against multiple expectations', () => {
        const expectations = [
          valueExpect('field').toBeBetween(0, 100).build(),
          valueExpect('field').toBeGreaterThan(-1).build(),
        ]

        const result = validateValue(50, expectations)
        expect(result.valid).toBe(true)
      })
    })

    describe('validateRecord()', () => {
      it('should validate a record against field expectations', () => {
        const expectations = [
          valueExpect('age').toBeBetween(0, 150).build(),
          valueExpect('status').toBeIn(['active', 'inactive']).build(),
        ]

        const record = { age: 25, status: 'active' }
        const result = validateRecord(record, expectations)

        expect(result.valid).toBe(true)
      })

      it('should fail when record field violates expectation', () => {
        const expectations = [
          valueExpect('age').toBeBetween(0, 150).build(),
        ]

        const record = { age: 200 }
        const result = validateRecord(record, expectations)

        expect(result.valid).toBe(false)
      })

      it('should support nested field paths', () => {
        const expectations = [
          valueExpect('address.city').toHaveLength(1, 100).build(),
        ]

        const record = { address: { city: 'New York' } }
        const result = validateRecord(record, expectations)

        expect(result.valid).toBe(true)
      })

      it('should support array index paths', () => {
        const expectations = [
          valueExpect('tags[0]').toStartWith('#').build(),
        ]

        const record = { tags: ['#first', '#second'] }
        const result = validateRecord(record, expectations)

        expect(result.valid).toBe(true)
      })
    })

    describe('validateRecords()', () => {
      it('should validate multiple records', () => {
        const expectations = [
          valueExpect('age').toBeBetween(0, 150).build(),
        ]

        const records = [{ age: 25 }, { age: 30 }, { age: 45 }]
        const result = validateRecords(records, expectations)

        expect(result.valid).toBe(true)
      })

      it('should report all failures across records', () => {
        const expectations = [
          valueExpect('age').toBeBetween(0, 150).build(),
        ]

        const records = [{ age: 25 }, { age: 200 }, { age: -5 }]
        const result = validateRecords(records, expectations)

        expect(result.valid).toBe(false)
        expect(result.failures.length).toBe(2)
      })
    })
  })

  // ==========================================================================
  // BUILDER API TESTS
  // ==========================================================================

  describe('Builder API', () => {
    it('should create builder with ve() shorthand', () => {
      const builder = ve('field')
      expect(builder).toBeInstanceOf(ValueExpectationBuilder)
    })

    it('should return ValueExpectation from build()', () => {
      const expectation = valueExpect('field').toBeBetween(0, 100).build()
      expect(expectation).toBeInstanceOf(ValueExpectation)
    })

    it('should support validateMany() for batch validation', () => {
      const expectation = valueExpect('score').toBeBetween(0, 100).build()

      const result = expectation.validateMany([50, 75, 90])
      expect(result.valid).toBe(true)

      const failResult = expectation.validateMany([50, 150, 90])
      expect(failResult.valid).toBe(false)
      expect(failResult.failures.length).toBe(1)
    })
  })

  // ==========================================================================
  // INTEGRATION WITH SCHEMA EXPECTATIONS
  // ==========================================================================

  describe('Integration with Schema Expectations', () => {
    it('should work alongside type expectations in a data contract', () => {
      // This test demonstrates how value expectations complement type expectations
      const ageExpectation = valueExpect('age').toBeBetween(0, 150).build()
      const statusExpectation = valueExpect('status')
        .toBeIn(['active', 'inactive', 'pending'])
        .build()
      const emailExpectation = valueExpect('email')
        .toMatchRegex(patterns.email)
        .build()

      const user = {
        age: 25,
        status: 'active',
        email: 'user@example.com',
      }

      const expectations = [ageExpectation, statusExpectation, emailExpectation]
      const result = validateRecord(user, expectations)

      expect(result.valid).toBe(true)
    })
  })

  // ==========================================================================
  // EXCLUSIVE RANGE VALIDATION TESTS
  // ==========================================================================

  describe('Exclusive Range Validation', () => {
    describe('.toBeBetween() with minExclusive/maxExclusive', () => {
      it('should support minExclusive option', () => {
        const expectation = valueExpect('score')
          .toBeBetween(0, 100, { minExclusive: true })
          .build()

        expect(expectation.validate(0).valid).toBe(false) // min is exclusive
        expect(expectation.validate(1).valid).toBe(true)
        expect(expectation.validate(100).valid).toBe(true) // max is still inclusive
      })

      it('should support maxExclusive option', () => {
        const expectation = valueExpect('score')
          .toBeBetween(0, 100, { maxExclusive: true })
          .build()

        expect(expectation.validate(0).valid).toBe(true) // min is still inclusive
        expect(expectation.validate(100).valid).toBe(false) // max is exclusive
        expect(expectation.validate(99).valid).toBe(true)
      })

      it('should support both minExclusive and maxExclusive', () => {
        const expectation = valueExpect('score')
          .toBeBetween(0, 100, { minExclusive: true, maxExclusive: true })
          .build()

        expect(expectation.validate(0).valid).toBe(false)
        expect(expectation.validate(100).valid).toBe(false)
        expect(expectation.validate(1).valid).toBe(true)
        expect(expectation.validate(99).valid).toBe(true)
        expect(expectation.validate(50).valid).toBe(true)
      })

      it('should use minExclusive/maxExclusive over exclusive flag', () => {
        // When specific exclusive options are set, they should take precedence
        const expectation = valueExpect('score')
          .toBeBetween(0, 100, { exclusive: false, minExclusive: true })
          .build()

        expect(expectation.validate(0).valid).toBe(false) // minExclusive takes precedence
        expect(expectation.validate(100).valid).toBe(true) // max is not exclusive
      })
    })
  })

  // ==========================================================================
  // DISALLOWED VALUES (NOT IN SET) TESTS
  // ==========================================================================

  describe('Disallowed Values Validation', () => {
    describe('.toNotBeIn()', () => {
      it('should pass when value is not in disallowed set', () => {
        const expectation = valueExpect('status')
          .toNotBeIn(['deleted', 'banned', 'suspended'])
          .build()

        expect(expectation.validate('active').valid).toBe(true)
        expect(expectation.validate('pending').valid).toBe(true)
      })

      it('should fail when value is in disallowed set', () => {
        const expectation = valueExpect('status')
          .toNotBeIn(['deleted', 'banned', 'suspended'])
          .build()

        expect(expectation.validate('deleted').valid).toBe(false)
        expect(expectation.validate('banned').valid).toBe(false)
        expect(expectation.validate('suspended').valid).toBe(false)
      })

      it('should work with numeric values', () => {
        const expectation = valueExpect('priority')
          .toNotBeIn([0, -1])
          .build()

        expect(expectation.validate(1).valid).toBe(true)
        expect(expectation.validate(5).valid).toBe(true)
        expect(expectation.validate(0).valid).toBe(false)
        expect(expectation.validate(-1).valid).toBe(false)
      })

      it('should work with Set', () => {
        const disallowedValues = new Set(['x', 'y', 'z'])
        const expectation = valueExpect('letter')
          .toNotBeIn(disallowedValues)
          .build()

        expect(expectation.validate('a').valid).toBe(true)
        expect(expectation.validate('x').valid).toBe(false)
      })

      it('should provide useful error message listing disallowed values', () => {
        const expectation = valueExpect('status')
          .toNotBeIn(['deleted', 'banned'])
          .build()
        const result = expectation.validate('deleted')

        expect(result.failures[0]?.message).toContain('deleted')
        expect(result.failures[0]?.message).toContain('banned')
        expect(result.failures[0]?.message).toContain('disallowed')
      })
    })
  })

  // ==========================================================================
  // COMPOSITE VALIDATORS TESTS
  // ==========================================================================

  describe('Composite Validators', () => {
    describe('allOf() - AND logic', () => {
      it('should pass when all validators pass', () => {
        const expectation = valueExpect('password')
          .allOf([
            (v) => typeof v === 'string' && v.length >= 8,
            (v) => typeof v === 'string' && /[A-Z]/.test(v),
            (v) => typeof v === 'string' && /[0-9]/.test(v),
          ])
          .build()

        expect(expectation.validate('Password123').valid).toBe(true)
        expect(expectation.validate('StrongPass9').valid).toBe(true)
      })

      it('should fail when any validator fails', () => {
        const expectation = valueExpect('password')
          .allOf([
            (v) => typeof v === 'string' && v.length >= 8,
            (v) => typeof v === 'string' && /[A-Z]/.test(v),
            (v) => typeof v === 'string' && /[0-9]/.test(v),
          ])
          .build()

        // Missing uppercase
        expect(expectation.validate('password123').valid).toBe(false)
        // Missing number
        expect(expectation.validate('Password').valid).toBe(false)
        // Too short
        expect(expectation.validate('Pass1').valid).toBe(false)
      })

      it('should report failures for all failed validators', () => {
        const expectation = valueExpect('value')
          .allOf([
            (v) => (typeof v === 'number' && v > 0) || { valid: false, message: 'Must be positive' },
            (v) => (typeof v === 'number' && v < 100) || { valid: false, message: 'Must be less than 100' },
          ])
          .build()

        const result = expectation.validate(-50)
        expect(result.valid).toBe(false)
        expect(result.failures).toHaveLength(1) // First failure is reported in allOf
        expect(result.failures[0]?.message).toContain('Must be positive')
      })

      it('should accept custom message for allOf', () => {
        const expectation = valueExpect('password')
          .allOf(
            [
              (v) => typeof v === 'string' && v.length >= 8,
              (v) => typeof v === 'string' && /[A-Z]/.test(v),
            ],
            'Password must be 8+ chars with uppercase'
          )
          .build()

        const result = expectation.validate('weak')
        expect(result.failures[0]?.message).toBe('Password must be 8+ chars with uppercase')
      })
    })

    describe('anyOf() - OR logic', () => {
      it('should pass when at least one validator passes', () => {
        const expectation = valueExpect('contact')
          .anyOf([
            (v) => typeof v === 'string' && patterns.email.test(v),
            (v) => typeof v === 'string' && patterns.phone.test(v),
          ])
          .build()

        expect(expectation.validate('user@example.com').valid).toBe(true)
        expect(expectation.validate('+1234567890').valid).toBe(true)
      })

      it('should fail when all validators fail', () => {
        const expectation = valueExpect('contact')
          .anyOf([
            (v) => typeof v === 'string' && patterns.email.test(v),
            (v) => typeof v === 'string' && patterns.phone.test(v),
          ])
          .build()

        expect(expectation.validate('not-email-or-phone').valid).toBe(false)
        expect(expectation.validate(12345).valid).toBe(false)
      })

      it('should accept custom message for anyOf', () => {
        const expectation = valueExpect('contact')
          .anyOf(
            [
              (v) => typeof v === 'string' && patterns.email.test(v),
              (v) => typeof v === 'string' && patterns.phone.test(v),
            ],
            'Must be a valid email or phone number'
          )
          .build()

        const result = expectation.validate('invalid')
        expect(result.failures[0]?.message).toBe('Must be a valid email or phone number')
      })
    })

    describe('noneOf() - NOT logic', () => {
      it('should pass when no validators pass', () => {
        const expectation = valueExpect('username')
          .noneOf([
            (v) => typeof v === 'string' && v.toLowerCase() === 'admin',
            (v) => typeof v === 'string' && v.toLowerCase() === 'root',
            (v) => typeof v === 'string' && v.startsWith('system_'),
          ])
          .build()

        expect(expectation.validate('john_doe').valid).toBe(true)
        expect(expectation.validate('regular_user').valid).toBe(true)
      })

      it('should fail when any validator passes', () => {
        const expectation = valueExpect('username')
          .noneOf([
            (v) => typeof v === 'string' && v.toLowerCase() === 'admin',
            (v) => typeof v === 'string' && v.toLowerCase() === 'root',
            (v) => typeof v === 'string' && v.startsWith('system_'),
          ])
          .build()

        expect(expectation.validate('admin').valid).toBe(false)
        expect(expectation.validate('Root').valid).toBe(false)
        expect(expectation.validate('system_user').valid).toBe(false)
      })

      it('should accept custom message for noneOf', () => {
        const expectation = valueExpect('username')
          .noneOf(
            [(v) => typeof v === 'string' && v.toLowerCase() === 'admin'],
            'Reserved username not allowed'
          )
          .build()

        const result = expectation.validate('admin')
        expect(result.failures[0]?.message).toBe('Reserved username not allowed')
      })
    })

    describe('chaining composite validators', () => {
      it('should allow chaining composite with other validators', () => {
        const expectation = valueExpect('password')
          .toHaveLength(8, 64)
          .allOf([
            (v) => typeof v === 'string' && /[A-Z]/.test(v),
            (v) => typeof v === 'string' && /[a-z]/.test(v),
            (v) => typeof v === 'string' && /[0-9]/.test(v),
          ])
          .toNotBeIn(['Password123', 'Admin123!'])
          .build()

        expect(expectation.validate('SecurePass99').valid).toBe(true)
        expect(expectation.validate('Password123').valid).toBe(false) // in disallowed list
        expect(expectation.validate('short').valid).toBe(false) // too short
      })

      it('should allow nested composite validators', () => {
        const expectation = valueExpect('value')
          .anyOf([
            (v) =>
              typeof v === 'string' &&
              v.startsWith('http://'),
            (v) =>
              typeof v === 'string' &&
              v.startsWith('https://'),
            (v) =>
              typeof v === 'string' &&
              patterns.email.test(v),
          ])
          .build()

        expect(expectation.validate('http://example.com').valid).toBe(true)
        expect(expectation.validate('https://example.com').valid).toBe(true)
        expect(expectation.validate('user@example.com').valid).toBe(true)
        expect(expectation.validate('ftp://example.com').valid).toBe(false)
      })
    })
  })

  // ==========================================================================
  // REGEX FLAGS SUPPORT TESTS
  // ==========================================================================

  describe('Regex Flags Support', () => {
    it('should support case-insensitive flag', () => {
      const expectation = valueExpect('code')
        .toMatchRegex(/^[a-z]+$/i)
        .build()

      expect(expectation.validate('abc').valid).toBe(true)
      expect(expectation.validate('ABC').valid).toBe(true)
      expect(expectation.validate('AbC').valid).toBe(true)
    })

    it('should support multiline flag', () => {
      const expectation = valueExpect('text')
        .toMatchRegex(/^line/m)
        .build()

      expect(expectation.validate('line 1').valid).toBe(true)
      expect(expectation.validate('first\nline 2').valid).toBe(true)
    })

    it('should support global flag (test still works)', () => {
      const expectation = valueExpect('text')
        .toMatchRegex(/\d+/g)
        .build()

      expect(expectation.validate('123').valid).toBe(true)
      expect(expectation.validate('abc').valid).toBe(false)
    })
  })
})
