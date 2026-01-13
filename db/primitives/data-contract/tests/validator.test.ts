/**
 * Runtime Validator tests - Configurable strictness levels
 *
 * Tests the ContractValidator implementation with:
 * - Multiple strictness levels (strict, warn, lenient, sample, off)
 * - Type coercion for compatible types
 * - Batch validation with early termination
 * - Dead-letter queue integration
 * - Performance benchmarks
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  ContractValidator,
  ValidationException,
  createValidator,
  validateData,
  validateBatch,
  type StrictnessLevel,
  type ValidationOptions,
  type DeadLetterQueue,
  type RuntimeValidationResult,
  type BatchValidationResult,
} from '../validator'
import { createSchema, type DataContract } from '../index'

// ============================================================================
// TEST FIXTURES
// ============================================================================

function createUserContract(): DataContract {
  return createSchema({
    name: 'user',
    version: '1.0.0',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        email: { type: 'string', format: 'email' },
        name: { type: 'string' },
        age: { type: 'integer', minimum: 0, maximum: 150 },
        active: { type: 'boolean' },
      },
      required: ['id', 'email'],
    },
  })
}

function createProductContract(): DataContract {
  return createSchema({
    name: 'product',
    version: '1.0.0',
    schema: {
      type: 'object',
      properties: {
        sku: { type: 'string', pattern: '^[A-Z]{3}-\\d{4}$' },
        price: { type: 'number', minimum: 0 },
        quantity: { type: 'integer', minimum: 0 },
        tags: { type: 'array', items: { type: 'string' } },
        metadata: {
          type: 'object',
          properties: {
            category: { type: 'string' },
            weight: { type: 'number' },
          },
        },
      },
      required: ['sku', 'price'],
    },
  })
}

// ============================================================================
// BASIC VALIDATION TESTS
// ============================================================================

describe('ContractValidator', () => {
  describe('basic validation', () => {
    let contract: DataContract
    let validator: ContractValidator

    beforeEach(() => {
      contract = createUserContract()
      validator = createValidator(contract)
    })

    it('should validate valid data successfully', () => {
      const result = validator.validate({
        id: 'user-123',
        email: 'alice@example.com',
        name: 'Alice',
        age: 30,
        active: true,
      })

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
      expect(result.data).toBeDefined()
    })

    it('should fail validation for missing required fields', () => {
      const result = validator.validate({
        id: 'user-123',
        // missing email
        name: 'Alice',
      })

      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors.some((e) => e.path.includes('email'))).toBe(true)
    })

    it('should fail validation for wrong type', () => {
      const result = validator.validate({
        id: 'user-123',
        email: 'alice@example.com',
        age: 'thirty', // should be integer
      })

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.path.includes('age'))).toBe(true)
    })

    it('should fail validation for invalid format', () => {
      const result = validator.validate({
        id: 'user-123',
        email: 'not-an-email',
      })

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.keyword === 'format')).toBe(true)
    })

    it('should fail validation for out of range numbers', () => {
      const result = validator.validate({
        id: 'user-123',
        email: 'alice@example.com',
        age: 200, // exceeds maximum of 150
      })

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.keyword === 'maximum')).toBe(true)
    })

    it('should include timing information', () => {
      const result = validator.validate({
        id: 'user-123',
        email: 'alice@example.com',
      })

      expect(result.timing).toBeDefined()
      expect(result.timing.totalMs).toBeGreaterThanOrEqual(0)
    })
  })

  // ============================================================================
  // STRICTNESS LEVELS
  // ============================================================================

  describe('strictness levels', () => {
    let contract: DataContract

    beforeEach(() => {
      contract = createUserContract()
    })

    describe('strict mode', () => {
      it('should fail on any validation error', () => {
        const validator = createValidator(contract, { strictness: 'strict' })

        const result = validator.validate({
          id: 'user-123',
          email: 'invalid-email',
        })

        expect(result.valid).toBe(false)
        expect(result.data).toBeUndefined()
      })

      it('should not coerce types', () => {
        const validator = createValidator(contract, { strictness: 'strict' })

        const result = validator.validate({
          id: 'user-123',
          email: 'alice@example.com',
          age: '30', // string instead of integer
        })

        expect(result.valid).toBe(false)
      })
    })

    describe('warn mode', () => {
      it('should log warnings but not fail', () => {
        const validator = createValidator(contract, { strictness: 'warn' })

        const result = validator.validate({
          id: 'user-123',
          email: 'invalid-email',
        })

        expect(result.valid).toBe(true) // doesn't fail in warn mode
        expect(result.errors.length).toBeGreaterThan(0) // but still collects errors
      })

      it('should return original data despite errors', () => {
        const validator = createValidator(contract, { strictness: 'warn' })
        const inputData = {
          id: 'user-123',
          email: 'invalid-email',
          name: 'Alice',
        }

        const result = validator.validate(inputData)

        expect(result.data).toEqual(inputData)
      })
    })

    describe('lenient mode', () => {
      it('should enable type coercion by default', () => {
        const validator = createValidator(contract, { strictness: 'lenient' })

        const result = validator.validate({
          id: 'user-123',
          email: 'alice@example.com',
          age: '30', // string that can be coerced to integer
        })

        expect(result.valid).toBe(true)
        expect(result.coercedData?.age).toBe(30)
      })

      it('should coerce boolean values', () => {
        const validator = createValidator(contract, { strictness: 'lenient' })

        const result = validator.validate({
          id: 'user-123',
          email: 'alice@example.com',
          active: 'true', // string that can be coerced to boolean
        })

        expect(result.valid).toBe(true)
        expect(result.coercedData?.active).toBe(true)
      })

      it('should fail when coercion is not possible', () => {
        const validator = createValidator(contract, { strictness: 'lenient' })

        const result = validator.validate({
          id: 'user-123',
          email: 'alice@example.com',
          age: 'not-a-number', // cannot be coerced to integer
        })

        expect(result.valid).toBe(false)
      })

      it('should add warnings for coerced values', () => {
        const validator = createValidator(contract, { strictness: 'lenient' })

        const result = validator.validate({
          id: 'user-123',
          email: 'alice@example.com',
          age: '30',
        })

        expect(result.warnings.length).toBeGreaterThan(0)
        expect(result.warnings.some((w) => w.keyword === 'coercion')).toBe(true)
      })
    })

    describe('sample mode', () => {
      it('should validate only a sample of records', () => {
        const validator = createValidator(contract, {
          strictness: 'sample',
          sampleRate: 0.5,
        })

        // Run many validations
        let validatedCount = 0
        for (let i = 0; i < 100; i++) {
          const result = validator.validate({
            id: `user-${i}`,
            email: `user${i}@example.com`,
          })

          // All should be valid since data is correct
          expect(result.valid).toBe(true)

          // Check if validation was actually performed (timing > 0)
          if (result.timing.validateMs > 0) {
            validatedCount++
          }
        }

        // Should validate roughly 50% (with some variance)
        expect(validatedCount).toBeGreaterThan(20)
        expect(validatedCount).toBeLessThan(80)
      })

      it('should skip validation when not sampled', () => {
        const validator = createValidator(contract, {
          strictness: 'sample',
          sampleRate: 0, // never validate
        })

        const result = validator.validate({
          id: 'user-123',
          email: 'invalid', // would fail if validated
        })

        expect(result.valid).toBe(true) // skipped, so passes
      })
    })

    describe('off mode', () => {
      it('should skip validation entirely', () => {
        const validator = createValidator(contract, { strictness: 'off' })

        const invalidData = {
          // completely invalid - missing required fields, wrong types
          foo: 'bar',
        }

        const result = validator.validate(invalidData)

        expect(result.valid).toBe(true)
        expect(result.errors).toHaveLength(0)
        expect(result.data).toEqual(invalidData)
      })

      it('should have minimal timing overhead', () => {
        const validator = createValidator(contract, { strictness: 'off' })

        const result = validator.validate({
          id: 'user-123',
          email: 'alice@example.com',
        })

        expect(result.timing.totalMs).toBeLessThan(1)
      })
    })
  })

  // ============================================================================
  // TYPE COERCION
  // ============================================================================

  describe('type coercion', () => {
    let contract: DataContract

    beforeEach(() => {
      contract = createUserContract()
    })

    it('should coerce string to number', () => {
      const validator = createValidator(contract, { coerce: true })

      const result = validator.validate({
        id: 'user-123',
        email: 'alice@example.com',
        age: '25',
      })

      expect(result.coercedData?.age).toBe(25)
    })

    it('should coerce string to boolean (true)', () => {
      const validator = createValidator(contract, { coerce: true })

      const result = validator.validate({
        id: 'user-123',
        email: 'alice@example.com',
        active: 'true',
      })

      expect(result.coercedData?.active).toBe(true)
    })

    it('should coerce string to boolean (false)', () => {
      const validator = createValidator(contract, { coerce: true })

      const result = validator.validate({
        id: 'user-123',
        email: 'alice@example.com',
        active: 'false',
      })

      expect(result.coercedData?.active).toBe(false)
    })

    it('should coerce number to string', () => {
      const stringContract = createSchema({
        name: 'test',
        version: '1.0.0',
        schema: {
          type: 'object',
          properties: {
            value: { type: 'string' },
          },
        },
      })

      const validator = createValidator(stringContract, { coerce: true })

      const result = validator.validate({ value: 123 })

      expect(result.coercedData?.value).toBe('123')
    })

    it('should coerce number to integer by rounding', () => {
      const validator = createValidator(contract, { coerce: true })

      const result = validator.validate({
        id: 'user-123',
        email: 'alice@example.com',
        age: 25.7,
      })

      expect(result.coercedData?.age).toBe(26)
    })

    it('should fail coercion for incompatible types', () => {
      const validator = createValidator(contract, { coerce: true })

      const result = validator.validate({
        id: 'user-123',
        email: 'alice@example.com',
        age: 'not-a-number',
      })

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.path.includes('age'))).toBe(true)
    })

    it('should coerce nested object properties', () => {
      const productContract = createProductContract()
      const validator = createValidator(productContract, { coerce: true })

      const result = validator.validate({
        sku: 'ABC-1234',
        price: '99.99',
        quantity: '10',
        metadata: {
          weight: '2.5',
        },
      })

      expect(result.coercedData?.price).toBe(99.99)
      expect(result.coercedData?.quantity).toBe(10)
      expect(result.coercedData?.metadata?.weight).toBe(2.5)
    })

    it('should coerce array items', () => {
      const arrayContract = createSchema({
        name: 'test',
        version: '1.0.0',
        schema: {
          type: 'object',
          properties: {
            numbers: { type: 'array', items: { type: 'integer' } },
          },
        },
      })

      const validator = createValidator(arrayContract, { coerce: true })

      const result = validator.validate({
        numbers: ['1', '2', '3'],
      })

      expect(result.coercedData?.numbers).toEqual([1, 2, 3])
    })
  })

  // ============================================================================
  // ERROR STRATEGIES
  // ============================================================================

  describe('error strategies', () => {
    let contract: DataContract

    beforeEach(() => {
      contract = createUserContract()
    })

    describe('throw strategy', () => {
      it('should throw ValidationException on error', () => {
        const validator = createValidator(contract, { onError: 'throw' })

        expect(() =>
          validator.validate({
            id: 'user-123',
            email: 'invalid',
          })
        ).toThrow(ValidationException)
      })

      it('should include errors in exception', () => {
        const validator = createValidator(contract, { onError: 'throw' })

        try {
          validator.validate({
            id: 'user-123',
            email: 'invalid',
          })
          expect.fail('Should have thrown')
        } catch (error) {
          expect(error).toBeInstanceOf(ValidationException)
          expect((error as ValidationException).errors.length).toBeGreaterThan(0)
        }
      })
    })

    describe('collect strategy', () => {
      it('should collect all errors without throwing', () => {
        const validator = createValidator(contract, { onError: 'collect' })

        const result = validator.validate({
          id: 123, // wrong type
          email: 'invalid', // invalid format
          age: -5, // below minimum
        })

        expect(result.valid).toBe(false)
        expect(result.errors.length).toBeGreaterThanOrEqual(2)
      })
    })

    describe('dead-letter strategy', () => {
      it('should send failed records to dead-letter queue', () => {
        const deadLetterQueue: DeadLetterQueue = {
          send: vi.fn(),
        }

        const validator = createValidator(contract, {
          onError: 'dead-letter',
          deadLetterQueue,
        })

        validator.validate({
          id: 'user-123',
          email: 'invalid',
        })

        expect(deadLetterQueue.send).toHaveBeenCalled()
      })

      it('should pass errors to dead-letter queue', () => {
        const sendMock = vi.fn()
        const deadLetterQueue: DeadLetterQueue = { send: sendMock }

        const validator = createValidator(contract, {
          onError: 'dead-letter',
          deadLetterQueue,
        })

        validator.validate({
          id: 'user-123',
          email: 'invalid',
        })

        expect(sendMock).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'user-123' }),
          expect.arrayContaining([expect.objectContaining({ keyword: 'format' })])
        )
      })

      it('should handle async dead-letter queue', async () => {
        const sendMock = vi.fn().mockResolvedValue(undefined)
        const deadLetterQueue: DeadLetterQueue = { send: sendMock }

        const validator = createValidator(contract, {
          onError: 'dead-letter',
          deadLetterQueue,
        })

        await validator.validateAsync({
          id: 'user-123',
          email: 'invalid',
        })

        expect(sendMock).toHaveBeenCalled()
      })
    })
  })

  // ============================================================================
  // BATCH VALIDATION
  // ============================================================================

  describe('batch validation', () => {
    let contract: DataContract

    beforeEach(() => {
      contract = createUserContract()
    })

    it('should validate multiple records', () => {
      const validator = createValidator(contract)

      const result = validator.validateBatch([
        { id: 'user-1', email: 'user1@example.com' },
        { id: 'user-2', email: 'user2@example.com' },
        { id: 'user-3', email: 'user3@example.com' },
      ])

      expect(result.totalRecords).toBe(3)
      expect(result.validRecords).toBe(3)
      expect(result.invalidRecords).toBe(0)
    })

    it('should track valid and invalid records separately', () => {
      const validator = createValidator(contract)

      const result = validator.validateBatch([
        { id: 'user-1', email: 'user1@example.com' },
        { id: 'user-2', email: 'invalid' }, // invalid
        { id: 'user-3', email: 'user3@example.com' },
      ])

      expect(result.validRecords).toBe(2)
      expect(result.invalidRecords).toBe(1)
    })

    it('should include error details with index', () => {
      const validator = createValidator(contract)

      const result = validator.validateBatch([
        { id: 'user-1', email: 'user1@example.com' },
        { id: 'user-2', email: 'invalid' },
      ])

      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].index).toBe(1)
      expect(result.errors[0].errors.length).toBeGreaterThan(0)
    })

    it('should support early termination', () => {
      const validator = createValidator(contract, { maxErrors: 2 })

      const result = validator.validateBatch([
        { id: 'user-1', email: 'invalid1' },
        { id: 'user-2', email: 'invalid2' },
        { id: 'user-3', email: 'invalid3' }, // should not be validated
        { id: 'user-4', email: 'invalid4' }, // should not be validated
      ])

      expect(result.earlyTerminated).toBe(true)
      expect(result.errors.length).toBe(2)
    })

    it('should calculate average time per record', () => {
      const validator = createValidator(contract)

      const result = validator.validateBatch([
        { id: 'user-1', email: 'user1@example.com' },
        { id: 'user-2', email: 'user2@example.com' },
        { id: 'user-3', email: 'user3@example.com' },
      ])

      expect(result.timing.avgPerRecordMs).toBeGreaterThan(0)
    })

    it('should track skipped records in sample mode', () => {
      const validator = createValidator(contract, {
        strictness: 'sample',
        sampleRate: 0.5,
      })

      const records = Array.from({ length: 100 }, (_, i) => ({
        id: `user-${i}`,
        email: `user${i}@example.com`,
      }))

      const result = validator.validateBatch(records)

      expect(result.skippedRecords).toBeGreaterThan(0)
      expect(result.skippedRecords).toBeLessThan(100)
    })
  })

  // ============================================================================
  // PERFORMANCE
  // ============================================================================

  describe('performance', () => {
    it('should validate simple schemas in under 1ms', () => {
      const contract = createUserContract()
      const validator = createValidator(contract)

      const timings: number[] = []

      for (let i = 0; i < 100; i++) {
        const result = validator.validate({
          id: `user-${i}`,
          email: `user${i}@example.com`,
          name: `User ${i}`,
          age: 25 + (i % 50),
          active: i % 2 === 0,
        })

        timings.push(result.timing.totalMs)
      }

      const avgTiming = timings.reduce((a, b) => a + b, 0) / timings.length
      expect(avgTiming).toBeLessThan(1)
    })

    it('should validate complex schemas in under 10ms', () => {
      // Create a complex schema with many fields
      const properties: Record<string, { type: string }> = {}
      for (let i = 0; i < 100; i++) {
        properties[`field${i}`] = { type: 'string' }
      }

      const complexContract = createSchema({
        name: 'complex',
        version: '1.0.0',
        schema: {
          type: 'object',
          properties,
        },
      })

      const validator = createValidator(complexContract)

      const data: Record<string, string> = {}
      for (let i = 0; i < 100; i++) {
        data[`field${i}`] = `value${i}`
      }

      const result = validator.validate(data)

      expect(result.valid).toBe(true)
      expect(result.timing.totalMs).toBeLessThan(10)
    })

    it('should handle batch validation efficiently', () => {
      const contract = createUserContract()
      const validator = createValidator(contract)

      const records = Array.from({ length: 1000 }, (_, i) => ({
        id: `user-${i}`,
        email: `user${i}@example.com`,
      }))

      const result = validator.validateBatch(records)

      expect(result.totalRecords).toBe(1000)
      expect(result.timing.avgPerRecordMs).toBeLessThan(1)
    })
  })

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('edge cases', () => {
    it('should handle empty objects', () => {
      const contract = createSchema({
        name: 'empty',
        version: '1.0.0',
        schema: { type: 'object' },
      })

      const validator = createValidator(contract)
      const result = validator.validate({})

      expect(result.valid).toBe(true)
    })

    it('should handle null values in nullable fields', () => {
      const contract = createSchema({
        name: 'nullable',
        version: '1.0.0',
        schema: {
          type: 'object',
          properties: {
            value: { type: ['string', 'null'] },
          },
        },
      })

      const validator = createValidator(contract)
      const result = validator.validate({ value: null })

      expect(result.valid).toBe(true)
    })

    it('should handle deeply nested structures', () => {
      const contract = createSchema({
        name: 'nested',
        version: '1.0.0',
        schema: {
          type: 'object',
          properties: {
            level1: {
              type: 'object',
              properties: {
                level2: {
                  type: 'object',
                  properties: {
                    level3: {
                      type: 'object',
                      properties: {
                        value: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      })

      const validator = createValidator(contract)
      const result = validator.validate({
        level1: {
          level2: {
            level3: {
              value: 'deep',
            },
          },
        },
      })

      expect(result.valid).toBe(true)
    })

    it('should handle arrays with complex items', () => {
      const contract = createSchema({
        name: 'array',
        version: '1.0.0',
        schema: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  nested: {
                    type: 'object',
                    properties: {
                      value: { type: 'integer' },
                    },
                  },
                },
                required: ['id'],
              },
            },
          },
        },
      })

      const validator = createValidator(contract)
      const result = validator.validate({
        items: [
          { id: 'item-1', nested: { value: 1 } },
          { id: 'item-2', nested: { value: 2 } },
        ],
      })

      expect(result.valid).toBe(true)
    })

    it('should strip unknown properties when configured', () => {
      const contract = createSchema({
        name: 'strict',
        version: '1.0.0',
        schema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
          additionalProperties: false,
        },
      })

      const validator = createValidator(contract, {
        coerce: true,
        stripUnknown: true,
      })

      const result = validator.validate({
        id: 'test',
        unknown: 'field',
      })

      expect(result.valid).toBe(true)
      expect(result.coercedData).not.toHaveProperty('unknown')
      expect(result.warnings.some((w) => w.keyword === 'stripUnknown')).toBe(true)
    })
  })

  // ============================================================================
  // FACTORY FUNCTIONS
  // ============================================================================

  describe('factory functions', () => {
    it('should work with validateData helper', () => {
      const contract = createUserContract()

      const result = validateData(contract, {
        id: 'user-123',
        email: 'alice@example.com',
      })

      expect(result.valid).toBe(true)
    })

    it('should work with validateBatch helper', () => {
      const contract = createUserContract()

      const result = validateBatch(contract, [
        { id: 'user-1', email: 'user1@example.com' },
        { id: 'user-2', email: 'user2@example.com' },
      ])

      expect(result.totalRecords).toBe(2)
      expect(result.validRecords).toBe(2)
    })

    it('should accept options in helper functions', () => {
      const contract = createUserContract()

      const result = validateData(
        contract,
        { id: 'user-123', email: 'invalid' },
        { strictness: 'warn' }
      )

      expect(result.valid).toBe(true) // warn mode doesn't fail
      expect(result.errors.length).toBeGreaterThan(0)
    })
  })

  // ============================================================================
  // PERMISSIVE MODE
  // ============================================================================

  describe('permissive mode', () => {
    let contract: DataContract

    beforeEach(() => {
      contract = createUserContract()
    })

    it('should silently ignore invalid fields', () => {
      const validator = createValidator(contract, { strictness: 'permissive' })

      const result = validator.validate({
        id: 123, // wrong type - should be string
        email: 'not-valid-email', // invalid format
        age: 'not-a-number', // wrong type
        extraField: 'unknown', // extra field
      })

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
      expect(result.data).toBeDefined()
    })

    it('should pass through all data regardless of schema violations', () => {
      const validator = createValidator(contract, { strictness: 'permissive' })

      const invalidData = {
        foo: 'bar',
        baz: 123,
      }

      const result = validator.validate(invalidData)

      expect(result.valid).toBe(true)
      expect(result.data).toEqual(invalidData)
    })

    it('should still run custom validators and report as warnings', () => {
      const validator = createValidator(contract, {
        strictness: 'permissive',
        customValidators: [
          {
            path: 'age',
            validate: (value) => {
              if (typeof value === 'number' && value < 18) {
                return 'Must be at least 18 years old'
              }
              return undefined
            },
          },
        ],
      })

      const result = validator.validate({
        id: 'user-123',
        email: 'alice@example.com',
        age: 15,
      })

      expect(result.valid).toBe(true)
      expect(result.warnings.length).toBeGreaterThan(0)
      expect(result.warnings.some((w) => w.message.includes('18'))).toBe(true)
    })
  })

  // ============================================================================
  // CUSTOM VALIDATION FUNCTIONS
  // ============================================================================

  describe('custom validation functions', () => {
    let contract: DataContract

    beforeEach(() => {
      contract = createUserContract()
    })

    it('should run custom validators on specified field paths', () => {
      const validator = createValidator(contract, {
        customValidators: [
          {
            path: 'name',
            validate: (value) => {
              if (typeof value === 'string' && value.length < 2) {
                return 'Name must be at least 2 characters'
              }
              return undefined
            },
          },
        ],
      })

      const result = validator.validate({
        id: 'user-123',
        email: 'alice@example.com',
        name: 'A', // too short
      })

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.keyword === 'custom')).toBe(true)
      expect(result.errors.some((e) => e.message.includes('2 characters'))).toBe(true)
    })

    it('should support multiple custom validators', () => {
      const validator = createValidator(contract, {
        customValidators: [
          {
            path: 'name',
            validate: (value) => {
              if (typeof value === 'string' && value.length < 2) {
                return 'Name too short'
              }
              return undefined
            },
          },
          {
            path: 'age',
            validate: (value) => {
              if (typeof value === 'number' && value < 18) {
                return 'Must be an adult'
              }
              return undefined
            },
          },
        ],
      })

      const result = validator.validate({
        id: 'user-123',
        email: 'alice@example.com',
        name: 'A',
        age: 15,
      })

      expect(result.valid).toBe(false)
      expect(result.errors.filter((e) => e.keyword === 'custom')).toHaveLength(2)
    })

    it('should support custom validators returning ValidationError objects', () => {
      const validator = createValidator(contract, {
        customValidators: [
          {
            path: 'email',
            validate: (value, path) => {
              if (typeof value === 'string' && value.endsWith('@blocked.com')) {
                return {
                  path,
                  message: 'Email domain is blocked',
                  keyword: 'blockedDomain',
                  params: { domain: 'blocked.com' },
                }
              }
              return undefined
            },
          },
        ],
      })

      const result = validator.validate({
        id: 'user-123',
        email: 'user@blocked.com',
      })

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.keyword === 'blockedDomain')).toBe(true)
    })

    it('should support custom validators returning arrays of errors', () => {
      const validator = createValidator(contract, {
        customValidators: [
          {
            path: 'name',
            validate: (value, path) => {
              const errors: Array<{ path: string; message: string; keyword: string }> = []
              if (typeof value === 'string') {
                if (value.includes(' ')) {
                  errors.push({ path, message: 'No spaces allowed', keyword: 'noSpaces' })
                }
                if (value.includes('@')) {
                  errors.push({ path, message: 'No @ symbol allowed', keyword: 'noAt' })
                }
              }
              return errors.length > 0 ? errors : undefined
            },
          },
        ],
      })

      const result = validator.validate({
        id: 'user-123',
        email: 'alice@example.com',
        name: 'John @ Doe',
      })

      expect(result.valid).toBe(false)
      expect(result.errors.filter((e) => e.keyword === 'noSpaces' || e.keyword === 'noAt')).toHaveLength(2)
    })

    it('should support wildcard path patterns for arrays', () => {
      const arrayContract = createSchema({
        name: 'order',
        version: '1.0.0',
        schema: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  price: { type: 'number' },
                  quantity: { type: 'integer' },
                },
              },
            },
          },
        },
      })

      const validator = createValidator(arrayContract, {
        customValidators: [
          {
            path: 'items[*].price',
            validate: (value) => {
              if (typeof value === 'number' && value <= 0) {
                return 'Price must be positive'
              }
              return undefined
            },
          },
        ],
      })

      const result = validator.validate({
        items: [
          { price: 10, quantity: 2 },
          { price: -5, quantity: 1 }, // invalid
          { price: 20, quantity: 3 },
        ],
      })

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.path === 'items[1].price')).toBe(true)
    })

    it('should support wildcard path patterns for object keys', () => {
      const mapContract = createSchema({
        name: 'config',
        version: '1.0.0',
        schema: {
          type: 'object',
          properties: {
            settings: {
              type: 'object',
            },
          },
        },
      })

      const validator = createValidator(mapContract, {
        customValidators: [
          {
            path: 'settings.*',
            validate: (value) => {
              if (value === null) {
                return 'Setting values cannot be null'
              }
              return undefined
            },
          },
        ],
      })

      const result = validator.validate({
        settings: {
          theme: 'dark',
          language: null, // invalid
          fontSize: 14,
        },
      })

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.path === 'settings.language')).toBe(true)
    })

    it('should support stopOnError option', () => {
      const validator = createValidator(contract, {
        customValidators: [
          {
            path: 'id',
            validate: () => 'First error',
            stopOnError: true,
          },
          {
            path: 'email',
            validate: () => 'Second error',
          },
        ],
      })

      const result = validator.validate({
        id: 'user-123',
        email: 'alice@example.com',
      })

      expect(result.valid).toBe(false)
      expect(result.errors.filter((e) => e.keyword === 'custom')).toHaveLength(1)
      expect(result.errors[0].message).toBe('First error')
    })

    it('should support message override', () => {
      const validator = createValidator(contract, {
        customValidators: [
          {
            path: 'age',
            validate: (value) => {
              if (typeof value === 'number' && value < 0) {
                return 'Original message'
              }
              return undefined
            },
            message: 'Age cannot be negative',
          },
        ],
      })

      const result = validator.validate({
        id: 'user-123',
        email: 'alice@example.com',
        age: -5,
      })

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.message === 'Age cannot be negative')).toBe(true)
    })

    it('should receive full data object in custom validator', () => {
      let capturedData: unknown = null

      const validator = createValidator(contract, {
        customValidators: [
          {
            path: 'age',
            validate: (value, _path, data) => {
              capturedData = data
              return undefined
            },
          },
        ],
      })

      const inputData = {
        id: 'user-123',
        email: 'alice@example.com',
        age: 25,
      }

      validator.validate(inputData)

      expect(capturedData).toEqual(inputData)
    })

    it('should work with coercion', () => {
      const validator = createValidator(contract, {
        coerce: true,
        customValidators: [
          {
            path: 'age',
            validate: (value) => {
              if (typeof value === 'number' && value < 18) {
                return 'Must be an adult'
              }
              return undefined
            },
          },
        ],
      })

      const result = validator.validate({
        id: 'user-123',
        email: 'alice@example.com',
        age: '25', // string that will be coerced to 25
      })

      // After coercion, age becomes 25 which passes validation
      expect(result.coercedData?.age).toBe(25)
    })

    it('should run custom validators in warn mode', () => {
      const validator = createValidator(contract, {
        strictness: 'warn',
        customValidators: [
          {
            path: 'name',
            validate: (value) => {
              if (typeof value === 'string' && value.includes('bad')) {
                return 'Name contains forbidden word'
              }
              return undefined
            },
          },
        ],
      })

      const result = validator.validate({
        id: 'user-123',
        email: 'alice@example.com',
        name: 'bad name',
      })

      // In warn mode, still valid but errors collected
      expect(result.valid).toBe(true)
      expect(result.errors.some((e) => e.message.includes('forbidden'))).toBe(true)
    })
  })

  // ============================================================================
  // CDC/SYNC PIPELINE INTEGRATION
  // ============================================================================

  describe('CDC/Sync pipeline integration', () => {
    it('should work with dead-letter queue for pipeline errors', () => {
      const deadLetterQueue: DeadLetterQueue = {
        send: vi.fn(),
      }

      const contract = createUserContract()
      const validator = createValidator(contract, {
        strictness: 'strict',
        onError: 'dead-letter',
        deadLetterQueue,
      })

      // Simulate a batch of CDC events
      const events = [
        { id: 'user-1', email: 'valid@example.com' },
        { id: 123, email: 'invalid' }, // invalid - will go to DLQ
        { id: 'user-3', email: 'valid2@example.com' },
      ]

      const results = events.map((event) => validator.validate(event))

      // First and third should be valid
      expect(results[0].valid).toBe(true)
      expect(results[2].valid).toBe(true)

      // Second should be invalid and sent to DLQ
      expect(results[1].valid).toBe(false)
      expect(deadLetterQueue.send).toHaveBeenCalledTimes(1)
    })

    it('should support async dead-letter queue for distributed pipelines', async () => {
      const deadLetterSend = vi.fn().mockResolvedValue(undefined)
      const deadLetterQueue: DeadLetterQueue = { send: deadLetterSend }

      const contract = createUserContract()
      const validator = createValidator(contract, {
        strictness: 'strict',
        onError: 'dead-letter',
        deadLetterQueue,
      })

      await validator.validateAsync({
        id: 'user-123',
        email: 'invalid',
      })

      expect(deadLetterSend).toHaveBeenCalled()
    })

    it('should provide detailed error paths for debugging pipeline issues', () => {
      const contract = createProductContract()
      const validator = createValidator(contract)

      const result = validator.validate({
        sku: 'invalid', // doesn't match pattern
        price: -10, // below minimum
        quantity: 1.5, // not an integer
        metadata: {
          weight: 'heavy', // wrong type
        },
      })

      expect(result.valid).toBe(false)

      // Verify error paths are specific
      const paths = result.errors.map((e) => e.path)
      expect(paths).toContain('sku')
      expect(paths).toContain('price')
      expect(paths).toContain('quantity')
      expect(paths.some((p) => p.includes('metadata'))).toBe(true)
    })

    it('should support batch validation for high-throughput CDC streams', () => {
      const contract = createUserContract()
      const validator = createValidator(contract)

      // Simulate a batch of 1000 CDC events
      const events = Array.from({ length: 1000 }, (_, i) => ({
        id: `user-${i}`,
        email: i % 10 === 0 ? 'invalid' : `user${i}@example.com`,
      }))

      const result = validator.validateBatch(events)

      expect(result.totalRecords).toBe(1000)
      expect(result.invalidRecords).toBe(100) // 10% invalid
      expect(result.timing.avgPerRecordMs).toBeLessThan(1)
    })

    it('should support sample mode for high-volume pipelines', () => {
      const contract = createUserContract()
      const validator = createValidator(contract, {
        strictness: 'sample',
        sampleRate: 0.1, // Only validate 10%
      })

      // In production, this would be a firehose of CDC events
      const results = []
      for (let i = 0; i < 1000; i++) {
        results.push(
          validator.validate({
            id: `user-${i}`,
            email: `user${i}@example.com`,
          })
        )
      }

      // All should be "valid" (sample mode doesn't fail the non-sampled)
      expect(results.every((r) => r.valid)).toBe(true)

      // But only ~10% should have non-zero validation time
      const validatedCount = results.filter((r) => r.timing.validateMs > 0).length
      expect(validatedCount).toBeGreaterThan(50)
      expect(validatedCount).toBeLessThan(200)
    })
  })
})
