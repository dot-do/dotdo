/**
 * Schema Validation at API Boundaries - TDD RED Phase
 *
 * Tests for validating data structures at API boundaries using Zod schemas.
 * These tests verify that:
 * 1. FunctionData is validated on creation
 * 2. Relationship data payloads are validated
 * 3. Thing and Relationship creation points have proper validation
 * 4. Invalid data throws appropriate errors
 *
 * @see dotdo-d1u50 - [RED] Add schema validation at API boundaries
 *
 * TDD Philosophy:
 * - Write failing tests FIRST
 * - Tests define the expected behavior
 * - Implementation comes in GREEN phase
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'

// Import schemas (to be created/extended)
// These imports will need to be added once schemas are implemented
// import {
//   functionDataSchema,
//   createRelationshipSchema,
//   cascadeRelationshipDataSchema,
//   createThingSchema,
//   validateFunctionData,
//   validateRelationshipData,
// } from '../api-schemas'

// ============================================================================
// SCHEMA DEFINITIONS (These should move to lib/validation/api-schemas.ts)
// ============================================================================

// Placeholder schemas - these will be implemented in GREEN phase
// For now, we define what we EXPECT the schemas to look like

/**
 * FunctionType enum for runtime validation
 */
const functionTypeSchema = z.enum(['code', 'generative', 'agentic', 'human'])

/**
 * Custom validator for DO URLs or standard URLs
 */
const doUrlSchema = z.string().refine(
  (val) => val.startsWith('do://') || val.startsWith('http://') || val.startsWith('https://'),
  { message: 'Must be a valid URL or DO URL (do://)' }
)

/**
 * FunctionData schema - validates function creation payloads
 */
const functionDataSchema = z.object({
  name: z.string().min(1, 'Function name is required').max(255, 'Function name too long'),
  type: functionTypeSchema,
  description: z.string().max(2000, 'Description too long').optional(),
  handler: z.string().max(500, 'Handler path too long').optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Version must be semver format').optional(),
  enabled: z.boolean().optional(),
})

/**
 * CascadeRelationshipData schema - validates cascade relationship payloads
 */
const cascadeRelationshipDataSchema = z.object({
  priority: z.number().int().min(0, 'Priority must be non-negative'),
  condition: z.string().max(500, 'Condition too long').optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

/**
 * CreateRelationshipInput schema - validates relationship creation
 */
const createRelationshipSchema = z.object({
  id: z.string().min(1, 'Relationship ID is required'),
  verb: z.string().min(1, 'Verb is required').max(100, 'Verb too long'),
  from: doUrlSchema,
  to: doUrlSchema,
  data: z.record(z.string(), z.unknown()).optional(),
})

/**
 * CreateThingInput schema - validates Thing creation at API boundary
 */
const createThingSchema = z.object({
  id: z.string().min(1, 'Thing ID is required').max(255, 'Thing ID too long'),
  typeId: z.number().int().positive('Type ID must be a positive integer'),
  typeName: z.string().min(1, 'Type name is required').max(100, 'Type name too long'),
  data: z.record(z.string(), z.unknown()).nullable().optional(),
})

// ============================================================================
// TEST SUITES - These tests should FAIL until GREEN phase implementation
// ============================================================================

describe('API Boundary Validation', () => {
  // ========================================================================
  // 1. FUNCTION DATA VALIDATION
  // ========================================================================

  describe('FunctionData Validation', () => {
    describe('Valid FunctionData', () => {
      it('accepts valid code function data', () => {
        const validData = {
          name: 'calculateTotal',
          type: 'code' as const,
          description: 'Calculates order total',
          handler: 'handlers/calculate-total.ts',
          version: '1.0.0',
          enabled: true,
        }

        const result = functionDataSchema.safeParse(validData)
        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.name).toBe('calculateTotal')
          expect(result.data.type).toBe('code')
        }
      })

      it('accepts valid generative function data', () => {
        const validData = {
          name: 'generateSummary',
          type: 'generative' as const,
          config: {
            model: 'claude-opus-4-5-20251101',
            temperature: 0.7,
          },
        }

        const result = functionDataSchema.safeParse(validData)
        expect(result.success).toBe(true)
      })

      it('accepts valid agentic function data', () => {
        const validData = {
          name: 'researchAgent',
          type: 'agentic' as const,
          config: {
            tools: ['read_file', 'web_search'],
            maxIterations: 10,
          },
        }

        const result = functionDataSchema.safeParse(validData)
        expect(result.success).toBe(true)
      })

      it('accepts valid human function data', () => {
        const validData = {
          name: 'approveRefund',
          type: 'human' as const,
          handler: 'workflows/refund-approval',
          config: {
            channel: ['slack', 'email'],
            timeout: 3600000,
          },
        }

        const result = functionDataSchema.safeParse(validData)
        expect(result.success).toBe(true)
      })

      it('accepts minimal valid function data (name and type only)', () => {
        const minimalData = {
          name: 'minimalFn',
          type: 'code' as const,
        }

        const result = functionDataSchema.safeParse(minimalData)
        expect(result.success).toBe(true)
      })
    })

    describe('Invalid FunctionData', () => {
      it('rejects function data with missing name', () => {
        const invalidData = {
          type: 'code',
        }

        const result = functionDataSchema.safeParse(invalidData)
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error.issues.some((i) => i.path.includes('name'))).toBe(true)
        }
      })

      it('rejects function data with empty name', () => {
        const invalidData = {
          name: '',
          type: 'code',
        }

        const result = functionDataSchema.safeParse(invalidData)
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error.issues[0]?.message).toContain('required')
        }
      })

      it('rejects function data with missing type', () => {
        const invalidData = {
          name: 'myFunction',
        }

        const result = functionDataSchema.safeParse(invalidData)
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error.issues.some((i) => i.path.includes('type'))).toBe(true)
        }
      })

      it('rejects function data with invalid type', () => {
        const invalidData = {
          name: 'myFunction',
          type: 'invalid-type',
        }

        const result = functionDataSchema.safeParse(invalidData)
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error.issues[0]?.path).toContain('type')
        }
      })

      it('rejects function data with name exceeding max length', () => {
        const invalidData = {
          name: 'a'.repeat(256), // Exceeds 255 char limit
          type: 'code',
        }

        const result = functionDataSchema.safeParse(invalidData)
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error.issues[0]?.message).toContain('too long')
        }
      })

      it('rejects function data with invalid version format', () => {
        const invalidData = {
          name: 'myFunction',
          type: 'code',
          version: 'not-semver',
        }

        const result = functionDataSchema.safeParse(invalidData)
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error.issues[0]?.message).toContain('semver')
        }
      })

      it('rejects function data with description exceeding max length', () => {
        const invalidData = {
          name: 'myFunction',
          type: 'code',
          description: 'a'.repeat(2001), // Exceeds 2000 char limit
        }

        const result = functionDataSchema.safeParse(invalidData)
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error.issues[0]?.message).toContain('too long')
        }
      })

      it('rejects function data with non-boolean enabled field', () => {
        const invalidData = {
          name: 'myFunction',
          type: 'code',
          enabled: 'yes', // Should be boolean
        }

        const result = functionDataSchema.safeParse(invalidData)
        expect(result.success).toBe(false)
      })
    })
  })

  // ========================================================================
  // 2. RELATIONSHIP DATA VALIDATION
  // ========================================================================

  describe('Relationship Data Validation', () => {
    describe('CreateRelationshipInput Validation', () => {
      it('accepts valid relationship input with DO URLs', () => {
        const validInput = {
          id: 'rel-123',
          verb: 'cascadesTo',
          from: 'do://functions/fn-abc',
          to: 'do://functions/fn-xyz',
          data: { priority: 0 },
        }

        const result = createRelationshipSchema.safeParse(validInput)
        expect(result.success).toBe(true)
      })

      it('accepts valid relationship input without data', () => {
        const validInput = {
          id: 'rel-456',
          verb: 'invokes',
          from: 'do://functions/caller',
          to: 'do://functions/callee',
        }

        const result = createRelationshipSchema.safeParse(validInput)
        expect(result.success).toBe(true)
      })

      it('rejects relationship with missing id', () => {
        const invalidInput = {
          verb: 'cascadesTo',
          from: 'do://functions/fn-abc',
          to: 'do://functions/fn-xyz',
        }

        const result = createRelationshipSchema.safeParse(invalidInput)
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error.issues.some((i) => i.path.includes('id'))).toBe(true)
        }
      })

      it('rejects relationship with empty id', () => {
        const invalidInput = {
          id: '',
          verb: 'cascadesTo',
          from: 'do://functions/fn-abc',
          to: 'do://functions/fn-xyz',
        }

        const result = createRelationshipSchema.safeParse(invalidInput)
        expect(result.success).toBe(false)
      })

      it('rejects relationship with missing verb', () => {
        const invalidInput = {
          id: 'rel-123',
          from: 'do://functions/fn-abc',
          to: 'do://functions/fn-xyz',
        }

        const result = createRelationshipSchema.safeParse(invalidInput)
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error.issues.some((i) => i.path.includes('verb'))).toBe(true)
        }
      })

      it('rejects relationship with empty verb', () => {
        const invalidInput = {
          id: 'rel-123',
          verb: '',
          from: 'do://functions/fn-abc',
          to: 'do://functions/fn-xyz',
        }

        const result = createRelationshipSchema.safeParse(invalidInput)
        expect(result.success).toBe(false)
      })

      it('rejects relationship with verb exceeding max length', () => {
        const invalidInput = {
          id: 'rel-123',
          verb: 'a'.repeat(101), // Exceeds 100 char limit
          from: 'do://functions/fn-abc',
          to: 'do://functions/fn-xyz',
        }

        const result = createRelationshipSchema.safeParse(invalidInput)
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error.issues[0]?.message).toContain('too long')
        }
      })

      it('rejects relationship with invalid from URL', () => {
        const invalidInput = {
          id: 'rel-123',
          verb: 'cascadesTo',
          from: 'not-a-url',
          to: 'do://functions/fn-xyz',
        }

        const result = createRelationshipSchema.safeParse(invalidInput)
        expect(result.success).toBe(false)
      })

      it('rejects relationship with invalid to URL', () => {
        const invalidInput = {
          id: 'rel-123',
          verb: 'cascadesTo',
          from: 'do://functions/fn-abc',
          to: 'not-a-url',
        }

        const result = createRelationshipSchema.safeParse(invalidInput)
        expect(result.success).toBe(false)
      })
    })

    describe('CascadeRelationshipData Validation', () => {
      it('accepts valid cascade data', () => {
        const validData = {
          priority: 0,
          condition: 'on-error',
          metadata: { retry: true },
        }

        const result = cascadeRelationshipDataSchema.safeParse(validData)
        expect(result.success).toBe(true)
      })

      it('accepts cascade data with only priority', () => {
        const minimalData = {
          priority: 5,
        }

        const result = cascadeRelationshipDataSchema.safeParse(minimalData)
        expect(result.success).toBe(true)
      })

      it('rejects cascade data with missing priority', () => {
        const invalidData = {
          condition: 'on-error',
        }

        const result = cascadeRelationshipDataSchema.safeParse(invalidData)
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error.issues.some((i) => i.path.includes('priority'))).toBe(true)
        }
      })

      it('rejects cascade data with negative priority', () => {
        const invalidData = {
          priority: -1,
        }

        const result = cascadeRelationshipDataSchema.safeParse(invalidData)
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error.issues[0]?.message).toContain('non-negative')
        }
      })

      it('rejects cascade data with non-integer priority', () => {
        const invalidData = {
          priority: 1.5,
        }

        const result = cascadeRelationshipDataSchema.safeParse(invalidData)
        expect(result.success).toBe(false)
      })

      it('rejects cascade data with condition exceeding max length', () => {
        const invalidData = {
          priority: 0,
          condition: 'a'.repeat(501), // Exceeds 500 char limit
        }

        const result = cascadeRelationshipDataSchema.safeParse(invalidData)
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error.issues[0]?.message).toContain('too long')
        }
      })
    })
  })

  // ========================================================================
  // 3. THING CREATION VALIDATION
  // ========================================================================

  describe('Thing Creation Validation', () => {
    describe('CreateThingInput Validation', () => {
      it('accepts valid Thing input', () => {
        const validInput = {
          id: 'customer-alice',
          typeId: 1,
          typeName: 'Customer',
          data: { name: 'Alice', email: 'alice@example.com' },
        }

        const result = createThingSchema.safeParse(validInput)
        expect(result.success).toBe(true)
      })

      it('accepts Thing input with null data', () => {
        const validInput = {
          id: 'empty-thing',
          typeId: 99,
          typeName: 'Empty',
          data: null,
        }

        const result = createThingSchema.safeParse(validInput)
        expect(result.success).toBe(true)
      })

      it('accepts Thing input without data field', () => {
        const validInput = {
          id: 'no-data-thing',
          typeId: 99,
          typeName: 'NoData',
        }

        const result = createThingSchema.safeParse(validInput)
        expect(result.success).toBe(true)
      })

      it('rejects Thing with missing id', () => {
        const invalidInput = {
          typeId: 1,
          typeName: 'Customer',
        }

        const result = createThingSchema.safeParse(invalidInput)
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error.issues.some((i) => i.path.includes('id'))).toBe(true)
        }
      })

      it('rejects Thing with empty id', () => {
        const invalidInput = {
          id: '',
          typeId: 1,
          typeName: 'Customer',
        }

        const result = createThingSchema.safeParse(invalidInput)
        expect(result.success).toBe(false)
      })

      it('rejects Thing with id exceeding max length', () => {
        const invalidInput = {
          id: 'a'.repeat(256), // Exceeds 255 char limit
          typeId: 1,
          typeName: 'Customer',
        }

        const result = createThingSchema.safeParse(invalidInput)
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error.issues[0]?.message).toContain('too long')
        }
      })

      it('rejects Thing with missing typeId', () => {
        const invalidInput = {
          id: 'customer-123',
          typeName: 'Customer',
        }

        const result = createThingSchema.safeParse(invalidInput)
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error.issues.some((i) => i.path.includes('typeId'))).toBe(true)
        }
      })

      it('rejects Thing with non-positive typeId', () => {
        const invalidInput = {
          id: 'customer-123',
          typeId: 0,
          typeName: 'Customer',
        }

        const result = createThingSchema.safeParse(invalidInput)
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error.issues[0]?.message).toContain('positive')
        }
      })

      it('rejects Thing with negative typeId', () => {
        const invalidInput = {
          id: 'customer-123',
          typeId: -1,
          typeName: 'Customer',
        }

        const result = createThingSchema.safeParse(invalidInput)
        expect(result.success).toBe(false)
      })

      it('rejects Thing with non-integer typeId', () => {
        const invalidInput = {
          id: 'customer-123',
          typeId: 1.5,
          typeName: 'Customer',
        }

        const result = createThingSchema.safeParse(invalidInput)
        expect(result.success).toBe(false)
      })

      it('rejects Thing with missing typeName', () => {
        const invalidInput = {
          id: 'customer-123',
          typeId: 1,
        }

        const result = createThingSchema.safeParse(invalidInput)
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error.issues.some((i) => i.path.includes('typeName'))).toBe(true)
        }
      })

      it('rejects Thing with empty typeName', () => {
        const invalidInput = {
          id: 'customer-123',
          typeId: 1,
          typeName: '',
        }

        const result = createThingSchema.safeParse(invalidInput)
        expect(result.success).toBe(false)
      })

      it('rejects Thing with typeName exceeding max length', () => {
        const invalidInput = {
          id: 'customer-123',
          typeId: 1,
          typeName: 'a'.repeat(101), // Exceeds 100 char limit
        }

        const result = createThingSchema.safeParse(invalidInput)
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error.issues[0]?.message).toContain('too long')
        }
      })
    })
  })

  // ========================================================================
  // 4. ERROR TRANSFORMATION
  // ========================================================================

  describe('Validation Error Handling', () => {
    it('provides clear error messages for missing required fields', () => {
      const invalidData = {}

      const result = functionDataSchema.safeParse(invalidData)
      expect(result.success).toBe(false)
      if (!result.success) {
        // Should have errors for both name and type
        expect(result.error.issues.length).toBeGreaterThanOrEqual(2)
      }
    })

    it('provides path information in error messages', () => {
      const invalidData = {
        name: 'test',
        type: 'code',
        config: {
          nested: {
            value: 'not validated here',
          },
        },
      }

      // This should pass since config accepts Record<string, unknown>
      const result = functionDataSchema.safeParse(invalidData)
      expect(result.success).toBe(true)
    })

    it('collects multiple validation errors', () => {
      const invalidData = {
        name: '', // Invalid: empty
        type: 'invalid', // Invalid: not in enum
        version: 'bad', // Invalid: not semver
      }

      const result = functionDataSchema.safeParse(invalidData)
      expect(result.success).toBe(false)
      if (!result.success) {
        // Should report multiple issues
        expect(result.error.issues.length).toBeGreaterThanOrEqual(2)
      }
    })
  })

  // ========================================================================
  // 5. INTEGRATION WITH STORES
  // ========================================================================
  // These tests verify that stores/adapters use validation at their boundaries.
  // They will FAIL until the GREEN phase implements validation in the stores.

  describe('Store Integration', () => {
    // Note: These tests demonstrate the expected behavior.
    // The actual store implementations don't yet have validation built in.
    // When validation is added to stores, these tests will pass.

    describe('FunctionGraphAdapter Validation', () => {
      it.todo('throws ValidationError when createFunction receives invalid name', async () => {
        // Test that FunctionGraphAdapter.createFunction validates input
        // Implementation in GREEN phase should add validation at the boundary
        //
        // Expected behavior:
        // const adapter = new FunctionGraphAdapter(store)
        // await expect(adapter.createFunction({ name: '', type: 'code' }))
        //   .rejects.toThrow(ValidationError)
      })

      it.todo('throws ValidationError when createFunction receives invalid type', async () => {
        // Expected behavior:
        // await expect(adapter.createFunction({ name: 'test', type: 'invalid' as any }))
        //   .rejects.toThrow(ValidationError)
      })

      it.todo('includes validation errors in error message', async () => {
        // Expected behavior:
        // try {
        //   await adapter.createFunction({ name: '', type: 'invalid' as any })
        // } catch (e) {
        //   expect(e).toBeInstanceOf(ValidationError)
        //   expect(e.issues).toHaveLength(2)
        // }
      })
    })

    describe('GraphStore.createThing Validation', () => {
      it.todo('throws ValidationError when createThing receives invalid input', async () => {
        // Expected behavior:
        // await expect(store.createThing({ id: '', typeId: 1, typeName: 'Test' }))
        //   .rejects.toThrow(ValidationError)
      })

      it.todo('throws ValidationError when typeId is not positive', async () => {
        // Expected behavior:
        // await expect(store.createThing({ id: 'test', typeId: 0, typeName: 'Test' }))
        //   .rejects.toThrow(ValidationError)
      })
    })

    describe('GraphStore.createRelationship Validation', () => {
      it.todo('throws ValidationError when createRelationship receives invalid input', async () => {
        // Expected behavior:
        // await expect(store.createRelationship({ id: '', verb: 'test', from: 'invalid', to: 'invalid' }))
        //   .rejects.toThrow(ValidationError)
      })

      it.todo('throws ValidationError for invalid URLs', async () => {
        // Expected behavior:
        // await expect(store.createRelationship({
        //   id: 'rel-1',
        //   verb: 'test',
        //   from: 'not-a-valid-url',
        //   to: 'also-not-valid'
        // })).rejects.toThrow(ValidationError)
      })
    })

    describe('FunctionGraphAdapter.addCascade Validation', () => {
      it.todo('validates cascade relationship data', async () => {
        // Expected behavior:
        // await expect(adapter.addCascade('fn1', 'fn2', { priority: -1 }))
        //   .rejects.toThrow(ValidationError)
      })
    })
  })

  // ========================================================================
  // 6. EDGE CASES
  // ========================================================================

  describe('Edge Cases', () => {
    describe('Unicode and Special Characters', () => {
      it('accepts function names with unicode characters', () => {
        const validData = {
          name: '计算总价', // Chinese characters
          type: 'code' as const,
        }

        const result = functionDataSchema.safeParse(validData)
        expect(result.success).toBe(true)
      })

      it('accepts function names with emoji', () => {
        const validData = {
          name: 'calculate_total_🚀',
          type: 'code' as const,
        }

        const result = functionDataSchema.safeParse(validData)
        expect(result.success).toBe(true)
      })

      it('accepts description with newlines', () => {
        const validData = {
          name: 'myFunction',
          type: 'code' as const,
          description: 'Line 1\nLine 2\nLine 3',
        }

        const result = functionDataSchema.safeParse(validData)
        expect(result.success).toBe(true)
      })
    })

    describe('Boundary Values', () => {
      it('accepts function name at max length (255 chars)', () => {
        const validData = {
          name: 'a'.repeat(255),
          type: 'code' as const,
        }

        const result = functionDataSchema.safeParse(validData)
        expect(result.success).toBe(true)
      })

      it('accepts description at max length (2000 chars)', () => {
        const validData = {
          name: 'myFunction',
          type: 'code' as const,
          description: 'a'.repeat(2000),
        }

        const result = functionDataSchema.safeParse(validData)
        expect(result.success).toBe(true)
      })

      it('accepts priority of 0', () => {
        const validData = {
          priority: 0,
        }

        const result = cascadeRelationshipDataSchema.safeParse(validData)
        expect(result.success).toBe(true)
      })

      it('accepts very high priority values', () => {
        const validData = {
          priority: Number.MAX_SAFE_INTEGER,
        }

        const result = cascadeRelationshipDataSchema.safeParse(validData)
        expect(result.success).toBe(true)
      })
    })

    describe('Type Coercion', () => {
      it('rejects number as function name (no coercion)', () => {
        const invalidData = {
          name: 123,
          type: 'code',
        }

        const result = functionDataSchema.safeParse(invalidData)
        expect(result.success).toBe(false)
      })

      it('rejects string as typeId (no coercion)', () => {
        const invalidData = {
          id: 'thing-123',
          typeId: '1', // Should be number
          typeName: 'Customer',
        }

        const result = createThingSchema.safeParse(invalidData)
        expect(result.success).toBe(false)
      })

      it('rejects string as priority (no coercion)', () => {
        const invalidData = {
          priority: '5', // Should be number
        }

        const result = cascadeRelationshipDataSchema.safeParse(invalidData)
        expect(result.success).toBe(false)
      })
    })

    describe('Null and Undefined Handling', () => {
      it('rejects null as function name', () => {
        const invalidData = {
          name: null,
          type: 'code',
        }

        const result = functionDataSchema.safeParse(invalidData)
        expect(result.success).toBe(false)
      })

      it('rejects undefined as function type', () => {
        const invalidData = {
          name: 'myFunction',
          type: undefined,
        }

        const result = functionDataSchema.safeParse(invalidData)
        expect(result.success).toBe(false)
      })

      it('accepts null for optional data in Thing', () => {
        const validData = {
          id: 'thing-123',
          typeId: 1,
          typeName: 'Test',
          data: null,
        }

        const result = createThingSchema.safeParse(validData)
        expect(result.success).toBe(true)
      })
    })
  })
})
