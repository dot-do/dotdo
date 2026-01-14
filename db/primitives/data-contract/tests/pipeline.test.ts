/**
 * Pipeline Integration Tests - DataContract as a pipeline stage
 *
 * Tests the DataContract validation as a composable pipeline stage:
 * - DataContract as composable pipeline stage
 * - Fail pipeline on validation errors
 * - Pass validation results downstream
 * - Support conditional validation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSchema, type DataContract, type ValidationError } from '../index'
import {
  validate,
  validateStage,
  createValidationStage,
  conditionalValidate,
  DataContractValidationError,
  type ValidationStageResult,
  type ValidationStageOptions,
  type ConditionalValidationOptions,
} from '../pipeline'

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
      },
      required: ['id', 'email'],
    },
  })
}

function createOrderContract(): DataContract {
  return createSchema({
    name: 'order',
    version: '1.0.0',
    schema: {
      type: 'object',
      properties: {
        orderId: { type: 'string' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sku: { type: 'string' },
              quantity: { type: 'integer', minimum: 1 },
              price: { type: 'number', minimum: 0 },
            },
            required: ['sku', 'quantity'],
          },
          minItems: 1,
        },
        total: { type: 'number', minimum: 0 },
      },
      required: ['orderId', 'items'],
    },
  })
}

// ============================================================================
// BASIC VALIDATION STAGE
// ============================================================================

describe('DataContract Pipeline Integration', () => {
  describe('validate() - simple validation stage', () => {
    let userContract: DataContract

    beforeEach(() => {
      userContract = createUserContract()
    })

    it('should pass valid data through the pipeline', async () => {
      const validateUser = validate(userContract)

      const result = await validateUser({
        id: 'user-123',
        email: 'alice@example.com',
        name: 'Alice',
        age: 30,
      })

      expect(result).toEqual({
        id: 'user-123',
        email: 'alice@example.com',
        name: 'Alice',
        age: 30,
      })
    })

    it('should throw DataContractValidationError for invalid data', async () => {
      const validateUser = validate(userContract)

      await expect(
        validateUser({
          id: 'user-123',
          email: 'invalid-email',
        })
      ).rejects.toThrow(DataContractValidationError)
    })

    it('should include validation errors in the exception', async () => {
      const validateUser = validate(userContract)

      try {
        await validateUser({
          id: 'user-123',
          // missing email
        })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(DataContractValidationError)
        const validationError = error as DataContractValidationError
        expect(validationError.errors).toHaveLength(1)
        expect(validationError.errors[0].path).toBe('email')
      }
    })

    it('should include contract name in error message', async () => {
      const validateUser = validate(userContract)

      await expect(validateUser({ id: 'x' })).rejects.toThrow(/user/)
    })

    it('should work with async pipeline functions', async () => {
      const validateUser = validate(userContract)

      // Simulate async pipeline where validate is one stage
      const pipeline = async (data: unknown) => {
        const validated = await validateUser(data)
        return { ...validated, processed: true }
      }

      const result = await pipeline({
        id: 'user-123',
        email: 'alice@example.com',
      })

      expect(result.processed).toBe(true)
    })
  })

  // ============================================================================
  // VALIDATION STAGE WITH RESULTS
  // ============================================================================

  describe('validateStage() - validation with results', () => {
    let userContract: DataContract

    beforeEach(() => {
      userContract = createUserContract()
    })

    it('should return validation result with valid data', async () => {
      const stage = validateStage(userContract)

      const result = await stage({
        id: 'user-123',
        email: 'alice@example.com',
      })

      expect(result.valid).toBe(true)
      expect(result.data).toEqual({
        id: 'user-123',
        email: 'alice@example.com',
      })
      expect(result.errors).toHaveLength(0)
    })

    it('should return validation result with invalid data (no throw)', async () => {
      const stage = validateStage(userContract)

      const result = await stage({
        id: 'user-123',
        email: 'invalid',
      })

      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('should include timing information', async () => {
      const stage = validateStage(userContract)

      const result = await stage({
        id: 'user-123',
        email: 'alice@example.com',
      })

      expect(result.timing).toBeDefined()
      expect(result.timing.totalMs).toBeGreaterThanOrEqual(0)
    })

    it('should include contract metadata', async () => {
      const stage = validateStage(userContract)

      const result = await stage({
        id: 'user-123',
        email: 'alice@example.com',
      })

      expect(result.contractName).toBe('user')
      expect(result.contractVersion).toBe('1.0.0')
    })

    it('should support coercion mode', async () => {
      const stage = validateStage(userContract, { coerce: true })

      const result = await stage({
        id: 'user-123',
        email: 'alice@example.com',
        age: '30', // string that can be coerced
      })

      expect(result.valid).toBe(true)
      expect(result.coercedData?.age).toBe(30)
    })
  })

  // ============================================================================
  // COMPOSABLE VALIDATION STAGE
  // ============================================================================

  describe('createValidationStage() - composable stage factory', () => {
    it('should create a reusable validation stage', async () => {
      const userContract = createUserContract()
      const userValidationStage = createValidationStage(userContract)

      const validUser = { id: 'user-1', email: 'user@example.com' }
      const invalidUser = { id: 'user-2' }

      const result1 = await userValidationStage(validUser)
      expect(result1.valid).toBe(true)

      const result2 = await userValidationStage(invalidUser)
      expect(result2.valid).toBe(false)
    })

    it('should support strictness options', async () => {
      const userContract = createUserContract()
      const warnStage = createValidationStage(userContract, { strictness: 'warn' })

      const result = await warnStage({
        id: 'user-123',
        email: 'invalid',
      })

      // In warn mode, still valid but errors collected
      expect(result.valid).toBe(true)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('should support onInvalid callback', async () => {
      const userContract = createUserContract()
      const onInvalidMock = vi.fn()

      const stage = createValidationStage(userContract, {
        onInvalid: onInvalidMock,
      })

      await stage({ id: 'user-123' }) // missing email

      expect(onInvalidMock).toHaveBeenCalledWith(
        { id: 'user-123' },
        expect.arrayContaining([expect.objectContaining({ path: 'email' })])
      )
    })

    it('should support onValid callback', async () => {
      const userContract = createUserContract()
      const onValidMock = vi.fn()

      const stage = createValidationStage(userContract, {
        onValid: onValidMock,
      })

      await stage({ id: 'user-123', email: 'alice@example.com' })

      expect(onValidMock).toHaveBeenCalledWith({
        id: 'user-123',
        email: 'alice@example.com',
      })
    })
  })

  // ============================================================================
  // PIPELINE COMPOSITION
  // ============================================================================

  describe('pipeline composition', () => {
    it('should compose with other pipeline stages using async/await', async () => {
      const userContract = createUserContract()
      const validateUser = validate(userContract)

      // Example ETL pipeline stages
      const extract = async (source: string) => ({
        id: 'user-1',
        email: 'alice@example.com',
        source,
      })

      const transform = async (data: { id: string; email: string; source: string }) => ({
        ...data,
        normalized: true,
      })

      const load = async (data: any) => ({
        loaded: true,
        record: data,
      })

      // Compose the pipeline
      const source = 'api'
      const extracted = await extract(source)
      const validated = await validateUser(extracted)
      const transformed = await transform(validated)
      const loaded = await load(transformed)

      expect(loaded.loaded).toBe(true)
      expect(loaded.record.normalized).toBe(true)
    })

    it('should fail pipeline on validation error', async () => {
      const userContract = createUserContract()
      const validateUser = validate(userContract)

      const extract = async () => ({
        id: 'user-1',
        email: 'not-an-email', // Invalid
      })

      const transform = vi.fn()
      const load = vi.fn()

      try {
        const extracted = await extract()
        const validated = await validateUser(extracted)
        await transform(validated)
        await load(validated)
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(DataContractValidationError)
        expect(transform).not.toHaveBeenCalled()
        expect(load).not.toHaveBeenCalled()
      }
    })

    it('should support multiple validation stages in a pipeline', async () => {
      const userContract = createUserContract()
      const orderContract = createOrderContract()

      const validateUser = validateStage(userContract)
      const validateOrder = validateStage(orderContract)

      // User with embedded order
      const userWithOrder = {
        user: {
          id: 'user-123',
          email: 'alice@example.com',
        },
        order: {
          orderId: 'order-456',
          items: [{ sku: 'SKU-001', quantity: 2, price: 29.99 }],
          total: 59.98,
        },
      }

      const userResult = await validateUser(userWithOrder.user)
      const orderResult = await validateOrder(userWithOrder.order)

      expect(userResult.valid).toBe(true)
      expect(orderResult.valid).toBe(true)
    })
  })

  // ============================================================================
  // CONDITIONAL VALIDATION
  // ============================================================================

  describe('conditionalValidate() - conditional validation', () => {
    it('should validate only when condition is true', async () => {
      const userContract = createUserContract()

      const conditionalStage = conditionalValidate(
        userContract,
        (data: any) => data.needsValidation === true
      )

      // Should validate (condition true)
      const result1 = await conditionalStage({
        needsValidation: true,
        id: 'user-123',
        email: 'alice@example.com',
      })
      expect(result1.validated).toBe(true)
      expect(result1.result.valid).toBe(true)

      // Should skip validation (condition false)
      const result2 = await conditionalStage({
        needsValidation: false,
        id: 'user-123',
        // missing email - would fail if validated
      })
      expect(result2.validated).toBe(false)
      expect(result2.skipped).toBe(true)
    })

    it('should support async conditions', async () => {
      const userContract = createUserContract()

      const conditionalStage = conditionalValidate(
        userContract,
        async (data: any) => {
          // Simulate async check (e.g., feature flag lookup)
          await new Promise((r) => setTimeout(r, 1))
          return data.type === 'premium'
        }
      )

      const result = await conditionalStage({
        type: 'premium',
        id: 'user-123',
        email: 'alice@example.com',
      })

      expect(result.validated).toBe(true)
    })

    it('should pass through data when skipped', async () => {
      const userContract = createUserContract()

      const conditionalStage = conditionalValidate(userContract, () => false)

      const result = await conditionalStage({
        id: 'user-123',
        customField: 'preserved',
      })

      expect(result.skipped).toBe(true)
      expect(result.data).toEqual({
        id: 'user-123',
        customField: 'preserved',
      })
    })

    it('should support field-based condition', async () => {
      const userContract = createUserContract()

      const conditionalStage = conditionalValidate(userContract, {
        field: 'status',
        equals: 'active',
      })

      // Should validate active users
      const result1 = await conditionalStage({
        status: 'active',
        id: 'user-123',
        email: 'alice@example.com',
      })
      expect(result1.validated).toBe(true)

      // Should skip inactive users
      const result2 = await conditionalStage({
        status: 'inactive',
        id: 'user-123',
      })
      expect(result2.skipped).toBe(true)
    })

    it('should support multiple contracts with conditions', async () => {
      const userContract = createUserContract()
      const orderContract = createOrderContract()

      const validateByType = async (data: any) => {
        if (data.type === 'user') {
          return conditionalValidate(userContract, (d: any) => d.type === 'user')(data)
        }
        if (data.type === 'order') {
          return conditionalValidate(orderContract, (d: any) => d.type === 'order')(data)
        }
        return { validated: false, skipped: true, data }
      }

      const userResult = await validateByType({
        type: 'user',
        id: 'user-123',
        email: 'alice@example.com',
      })
      expect(userResult.validated).toBe(true)

      const orderResult = await validateByType({
        type: 'order',
        orderId: 'order-456',
        items: [{ sku: 'SKU-001', quantity: 1 }],
      })
      expect(orderResult.validated).toBe(true)
    })
  })

  // ============================================================================
  // ERROR HANDLING
  // ============================================================================

  describe('DataContractValidationError', () => {
    it('should include all validation errors', async () => {
      const userContract = createUserContract()
      const validateUser = validate(userContract)

      try {
        await validateUser({
          id: 123, // wrong type
          email: 'invalid', // invalid format
          age: 200, // exceeds maximum
        })
      } catch (error) {
        const validationError = error as DataContractValidationError
        expect(validationError.errors.length).toBeGreaterThanOrEqual(2)
        expect(validationError.contractName).toBe('user')
      }
    })

    it('should be catchable and inspectable', async () => {
      const userContract = createUserContract()
      const validateUser = validate(userContract)

      const data = { id: 'user-123' }
      let caught = false

      try {
        await validateUser(data)
      } catch (error) {
        if (error instanceof DataContractValidationError) {
          caught = true
          expect(error.data).toEqual(data)
          expect(error.name).toBe('DataContractValidationError')
        }
      }

      expect(caught).toBe(true)
    })

    it('should support error recovery in pipeline', async () => {
      const userContract = createUserContract()
      const validateUser = validate(userContract)

      const recoverableValidation = async (data: unknown) => {
        try {
          return await validateUser(data)
        } catch (error) {
          if (error instanceof DataContractValidationError) {
            // Recovery: provide defaults for missing fields
            return {
              ...data,
              recovered: true,
              errors: error.errors,
            }
          }
          throw error
        }
      }

      const result = await recoverableValidation({ id: 'user-123' })

      expect(result.recovered).toBe(true)
      expect(result.errors).toBeDefined()
    })
  })

  // ============================================================================
  // PASS VALIDATION RESULTS DOWNSTREAM
  // ============================================================================

  describe('passing validation results downstream', () => {
    it('should attach validation metadata to output', async () => {
      const userContract = createUserContract()
      const stage = validateStage(userContract)

      const result = await stage({
        id: 'user-123',
        email: 'alice@example.com',
      })

      // Pipeline can use these results
      expect(result).toMatchObject({
        valid: true,
        data: expect.any(Object),
        errors: [],
        warnings: [],
        contractName: 'user',
        contractVersion: '1.0.0',
        timing: expect.any(Object),
      })
    })

    it('should support extracting just the data for next stage', async () => {
      const userContract = createUserContract()
      const stage = validateStage(userContract)

      const result = await stage({
        id: 'user-123',
        email: 'alice@example.com',
      })

      // Extract just the data for the next stage
      if (result.valid && result.data) {
        const nextStageInput = result.data
        expect(nextStageInput.id).toBe('user-123')
      }
    })

    it('should support coerced data extraction', async () => {
      const userContract = createUserContract()
      const stage = validateStage(userContract, { coerce: true })

      const result = await stage({
        id: 'user-123',
        email: 'alice@example.com',
        age: '30',
      })

      // Use coerced data if available, otherwise original
      const data = result.coercedData || result.data
      expect(data?.age).toBe(30)
    })
  })

  // ============================================================================
  // INTEGRATION WITH PIPELINE HELPERS
  // ============================================================================

  describe('integration patterns', () => {
    it('should work in a typical ETL pattern', async () => {
      const userContract = createUserContract()

      // ETL Pipeline stages
      const extract = async (source: { raw: string }) => JSON.parse(source.raw)

      const validate_stage = validate(userContract)

      const transform = async (user: { id: string; email: string }) => ({
        ...user,
        processedAt: new Date().toISOString(),
      })

      const load = async (user: any) => ({
        success: true,
        recordId: user.id,
      })

      // Execute pipeline
      const source = { raw: '{"id": "user-123", "email": "alice@example.com"}' }
      const extracted = await extract(source)
      const validated = await validate_stage(extracted)
      const transformed = await transform(validated)
      const result = await load(transformed)

      expect(result.success).toBe(true)
      expect(result.recordId).toBe('user-123')
    })

    it('should work with batch processing', async () => {
      const userContract = createUserContract()
      const validateUser = validateStage(userContract)

      const records = [
        { id: 'user-1', email: 'user1@example.com' },
        { id: 'user-2', email: 'invalid' },
        { id: 'user-3', email: 'user3@example.com' },
      ]

      const results = await Promise.all(records.map((r) => validateUser(r)))

      const validRecords = results.filter((r) => r.valid)
      const invalidRecords = results.filter((r) => !r.valid)

      expect(validRecords).toHaveLength(2)
      expect(invalidRecords).toHaveLength(1)
    })

    it('should support fan-out validation', async () => {
      const userContract = createUserContract()
      const orderContract = createOrderContract()

      const validateUser = validateStage(userContract)
      const validateOrder = validateStage(orderContract)

      // Fan-out: validate different parts of a composite record
      const composite = {
        user: { id: 'user-123', email: 'alice@example.com' },
        order: {
          orderId: 'order-456',
          items: [{ sku: 'SKU-001', quantity: 2 }],
        },
      }

      const [userResult, orderResult] = await Promise.all([
        validateUser(composite.user),
        validateOrder(composite.order),
      ])

      expect(userResult.valid).toBe(true)
      expect(orderResult.valid).toBe(true)
    })
  })
})
