/**
 * Type Expectations Tests - Fluent schema type and nullability validation
 *
 * RED phase: These tests define the expected behavior of the fluent type expectation API.
 * All tests should FAIL until implementation is complete.
 *
 * Provides:
 * - .toBeString() - Validates column is string type
 * - .toBeNumber() - Validates column is number type
 * - .toBeBoolean() - Validates column is boolean type
 * - .toBeDate() - Validates column is date format string
 * - .toBeArray() - Validates column is array type
 * - .toBeObject() - Validates column is object type
 * - .toBeRequired() - Validates column cannot be null
 * - .toBeNullable() - Validates column allows null
 * - .toHaveType(schema) - Validates column matches JSON Schema
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { JSONSchema } from '../index'
import {
  column,
  schema,
  TypeExpectationBuilder,
  SchemaTypeValidator,
  createTypeValidator,
  TypeValidationResult,
  TypeValidationError,
} from '../type-expectations'

// ============================================================================
// TEST FIXTURES
// ============================================================================

function createUserSchema(): JSONSchema {
  return {
    type: 'object',
    properties: {
      id: { type: 'string' },
      email: { type: 'string', format: 'email' },
      name: { type: 'string' },
      age: { type: 'integer', minimum: 0 },
      score: { type: 'number' },
      active: { type: 'boolean' },
      createdAt: { type: 'string', format: 'date-time' },
      tags: { type: 'array', items: { type: 'string' } },
      profile: {
        type: 'object',
        properties: {
          bio: { type: 'string' },
          avatar: { type: 'string' },
        },
      },
      nickname: { type: ['string', 'null'] },
    },
    required: ['id', 'email'],
  }
}

// ============================================================================
// FLUENT COLUMN BUILDER
// ============================================================================

describe('TypeExpectations', () => {
  describe('column() builder', () => {
    it('should create a column expectation builder', () => {
      const builder = column('id')
      expect(builder).toBeInstanceOf(TypeExpectationBuilder)
    })

    it('should set column name', () => {
      const builder = column('email')
      expect(builder.getColumnName()).toBe('email')
    })
  })

  // ==========================================================================
  // TYPE ASSERTIONS
  // ==========================================================================

  describe('type assertions', () => {
    describe('.toBeString()', () => {
      it('should pass when column is string type', () => {
        const jsonSchema = createUserSchema()
        const validator = createTypeValidator()

        const result = validator.validate(jsonSchema, column('id').toBeString())

        expect(result.valid).toBe(true)
        expect(result.errors).toHaveLength(0)
      })

      it('should fail when column is not string type', () => {
        const jsonSchema = createUserSchema()
        const validator = createTypeValidator()

        const result = validator.validate(jsonSchema, column('age').toBeString())

        expect(result.valid).toBe(false)
        expect(result.errors[0]?.reason).toBe('type_mismatch')
        expect(result.errors[0]?.expected).toBe('string')
        expect(result.errors[0]?.actual).toBe('integer')
      })

      it('should fail when column does not exist', () => {
        const jsonSchema = createUserSchema()
        const validator = createTypeValidator()

        const result = validator.validate(jsonSchema, column('nonexistent').toBeString())

        expect(result.valid).toBe(false)
        expect(result.errors[0]?.reason).toBe('column_not_found')
      })
    })

    describe('.toBeNumber()', () => {
      it('should pass when column is number type', () => {
        const jsonSchema = createUserSchema()
        const validator = createTypeValidator()

        const result = validator.validate(jsonSchema, column('score').toBeNumber())

        expect(result.valid).toBe(true)
      })

      it('should pass when column is integer type (integer is a number)', () => {
        const jsonSchema = createUserSchema()
        const validator = createTypeValidator()

        const result = validator.validate(jsonSchema, column('age').toBeNumber())

        expect(result.valid).toBe(true)
      })

      it('should fail when column is not number type', () => {
        const jsonSchema = createUserSchema()
        const validator = createTypeValidator()

        const result = validator.validate(jsonSchema, column('id').toBeNumber())

        expect(result.valid).toBe(false)
        expect(result.errors[0]?.reason).toBe('type_mismatch')
      })
    })

    describe('.toBeInteger()', () => {
      it('should pass when column is integer type', () => {
        const jsonSchema = createUserSchema()
        const validator = createTypeValidator()

        const result = validator.validate(jsonSchema, column('age').toBeInteger())

        expect(result.valid).toBe(true)
      })

      it('should fail when column is number (not specifically integer)', () => {
        const jsonSchema = createUserSchema()
        const validator = createTypeValidator()

        const result = validator.validate(jsonSchema, column('score').toBeInteger())

        expect(result.valid).toBe(false)
        expect(result.errors[0]?.reason).toBe('type_mismatch')
        expect(result.errors[0]?.expected).toBe('integer')
        expect(result.errors[0]?.actual).toBe('number')
      })
    })

    describe('.toBeBoolean()', () => {
      it('should pass when column is boolean type', () => {
        const jsonSchema = createUserSchema()
        const validator = createTypeValidator()

        const result = validator.validate(jsonSchema, column('active').toBeBoolean())

        expect(result.valid).toBe(true)
      })

      it('should fail when column is not boolean type', () => {
        const jsonSchema = createUserSchema()
        const validator = createTypeValidator()

        const result = validator.validate(jsonSchema, column('id').toBeBoolean())

        expect(result.valid).toBe(false)
        expect(result.errors[0]?.reason).toBe('type_mismatch')
      })
    })

    describe('.toBeDate()', () => {
      it('should pass when column is date-time format string', () => {
        const jsonSchema = createUserSchema()
        const validator = createTypeValidator()

        const result = validator.validate(jsonSchema, column('createdAt').toBeDate())

        expect(result.valid).toBe(true)
      })

      it('should pass when column is date format string', () => {
        const jsonSchema: JSONSchema = {
          type: 'object',
          properties: {
            birthDate: { type: 'string', format: 'date' },
          },
        }
        const validator = createTypeValidator()

        const result = validator.validate(jsonSchema, column('birthDate').toBeDate())

        expect(result.valid).toBe(true)
      })

      it('should fail when column is string without date format', () => {
        const jsonSchema = createUserSchema()
        const validator = createTypeValidator()

        const result = validator.validate(jsonSchema, column('name').toBeDate())

        expect(result.valid).toBe(false)
        expect(result.errors[0]?.reason).toBe('format_mismatch')
        expect(result.errors[0]?.message).toContain('date')
      })

      it('should fail when column is not string type', () => {
        const jsonSchema = createUserSchema()
        const validator = createTypeValidator()

        const result = validator.validate(jsonSchema, column('age').toBeDate())

        expect(result.valid).toBe(false)
      })
    })

    describe('.toBeArray()', () => {
      it('should pass when column is array type', () => {
        const jsonSchema = createUserSchema()
        const validator = createTypeValidator()

        const result = validator.validate(jsonSchema, column('tags').toBeArray())

        expect(result.valid).toBe(true)
      })

      it('should fail when column is not array type', () => {
        const jsonSchema = createUserSchema()
        const validator = createTypeValidator()

        const result = validator.validate(jsonSchema, column('id').toBeArray())

        expect(result.valid).toBe(false)
        expect(result.errors[0]?.reason).toBe('type_mismatch')
      })
    })

    describe('.toBeObject()', () => {
      it('should pass when column is object type', () => {
        const jsonSchema = createUserSchema()
        const validator = createTypeValidator()

        const result = validator.validate(jsonSchema, column('profile').toBeObject())

        expect(result.valid).toBe(true)
      })

      it('should fail when column is not object type', () => {
        const jsonSchema = createUserSchema()
        const validator = createTypeValidator()

        const result = validator.validate(jsonSchema, column('id').toBeObject())

        expect(result.valid).toBe(false)
        expect(result.errors[0]?.reason).toBe('type_mismatch')
      })
    })
  })

  // ==========================================================================
  // NULLABILITY CONSTRAINTS
  // ==========================================================================

  describe('nullability constraints', () => {
    describe('.toBeRequired() / .toBeNotNull()', () => {
      it('should pass when column type does not include null', () => {
        const jsonSchema = createUserSchema()
        const validator = createTypeValidator()

        const result = validator.validate(jsonSchema, column('id').toBeRequired())

        expect(result.valid).toBe(true)
      })

      it('should fail when column type includes null', () => {
        const jsonSchema = createUserSchema()
        const validator = createTypeValidator()

        const result = validator.validate(jsonSchema, column('nickname').toBeRequired())

        expect(result.valid).toBe(false)
        expect(result.errors[0]?.reason).toBe('nullable_violation')
        expect(result.errors[0]?.message).toContain('not be nullable')
      })

      it('should be aliased as toBeNotNull()', () => {
        const jsonSchema = createUserSchema()
        const validator = createTypeValidator()

        const result = validator.validate(jsonSchema, column('id').toBeNotNull())

        expect(result.valid).toBe(true)
      })
    })

    describe('.toBeNullable()', () => {
      it('should pass when column type includes null', () => {
        const jsonSchema = createUserSchema()
        const validator = createTypeValidator()

        const result = validator.validate(jsonSchema, column('nickname').toBeNullable())

        expect(result.valid).toBe(true)
      })

      it('should fail when column type does not include null', () => {
        const jsonSchema = createUserSchema()
        const validator = createTypeValidator()

        const result = validator.validate(jsonSchema, column('id').toBeNullable())

        expect(result.valid).toBe(false)
        expect(result.errors[0]?.reason).toBe('nullable_violation')
        expect(result.errors[0]?.message).toContain('should be nullable')
      })
    })
  })

  // ==========================================================================
  // ARRAY TYPE VALIDATION
  // ==========================================================================

  describe('array type validation', () => {
    describe('.toBeArrayOf()', () => {
      it('should pass when array items match expected type', () => {
        const jsonSchema = createUserSchema()
        const validator = createTypeValidator()

        const result = validator.validate(jsonSchema, column('tags').toBeArrayOf('string'))

        expect(result.valid).toBe(true)
      })

      it('should fail when array items do not match expected type', () => {
        const jsonSchema = createUserSchema()
        const validator = createTypeValidator()

        const result = validator.validate(jsonSchema, column('tags').toBeArrayOf('number'))

        expect(result.valid).toBe(false)
        expect(result.errors[0]?.reason).toBe('array_items_mismatch')
        expect(result.errors[0]?.expected).toBe('number')
        expect(result.errors[0]?.actual).toBe('string')
      })

      it('should fail when column is not an array', () => {
        const jsonSchema = createUserSchema()
        const validator = createTypeValidator()

        const result = validator.validate(jsonSchema, column('id').toBeArrayOf('string'))

        expect(result.valid).toBe(false)
        expect(result.errors[0]?.reason).toBe('type_mismatch')
      })

      it('should pass when array items match object schema', () => {
        const jsonSchema: JSONSchema = {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                },
                required: ['id'],
              },
            },
          },
        }
        const validator = createTypeValidator()

        const result = validator.validate(jsonSchema, column('items').toBeArrayOf('object'))

        expect(result.valid).toBe(true)
      })
    })

    describe('.toHaveMinItems()', () => {
      it('should pass when array has minItems constraint', () => {
        const jsonSchema: JSONSchema = {
          type: 'object',
          properties: {
            tags: { type: 'array', items: { type: 'string' }, minItems: 1 },
          },
        }
        const validator = createTypeValidator()

        const result = validator.validate(jsonSchema, column('tags').toHaveMinItems(1))

        expect(result.valid).toBe(true)
      })

      it('should fail when array minItems is less than expected', () => {
        const jsonSchema: JSONSchema = {
          type: 'object',
          properties: {
            tags: { type: 'array', items: { type: 'string' }, minItems: 1 },
          },
        }
        const validator = createTypeValidator()

        const result = validator.validate(jsonSchema, column('tags').toHaveMinItems(2))

        expect(result.valid).toBe(false)
        expect(result.errors[0]?.reason).toBe('constraint_mismatch')
      })

      it('should fail when array has no minItems constraint', () => {
        const jsonSchema = createUserSchema()
        const validator = createTypeValidator()

        const result = validator.validate(jsonSchema, column('tags').toHaveMinItems(1))

        expect(result.valid).toBe(false)
        expect(result.errors[0]?.reason).toBe('constraint_mismatch')
      })
    })

    describe('.toHaveMaxItems()', () => {
      it('should pass when array has maxItems constraint', () => {
        const jsonSchema: JSONSchema = {
          type: 'object',
          properties: {
            tags: { type: 'array', items: { type: 'string' }, maxItems: 10 },
          },
        }
        const validator = createTypeValidator()

        const result = validator.validate(jsonSchema, column('tags').toHaveMaxItems(10))

        expect(result.valid).toBe(true)
      })

      it('should fail when array maxItems is greater than expected', () => {
        const jsonSchema: JSONSchema = {
          type: 'object',
          properties: {
            tags: { type: 'array', items: { type: 'string' }, maxItems: 10 },
          },
        }
        const validator = createTypeValidator()

        const result = validator.validate(jsonSchema, column('tags').toHaveMaxItems(5))

        expect(result.valid).toBe(false)
        expect(result.errors[0]?.reason).toBe('constraint_mismatch')
      })
    })
  })

  // ==========================================================================
  // OBJECT TYPE VALIDATION
  // ==========================================================================

  describe('object type validation', () => {
    describe('.toHaveProperty()', () => {
      it('should pass when object has expected property', () => {
        const jsonSchema = createUserSchema()
        const validator = createTypeValidator()

        const result = validator.validate(jsonSchema, column('profile').toHaveProperty('bio'))

        expect(result.valid).toBe(true)
      })

      it('should fail when object does not have expected property', () => {
        const jsonSchema = createUserSchema()
        const validator = createTypeValidator()

        const result = validator.validate(jsonSchema, column('profile').toHaveProperty('missing'))

        expect(result.valid).toBe(false)
        expect(result.errors[0]?.reason).toBe('property_not_found')
      })

      it('should fail when column is not an object', () => {
        const jsonSchema = createUserSchema()
        const validator = createTypeValidator()

        const result = validator.validate(jsonSchema, column('id').toHaveProperty('anything'))

        expect(result.valid).toBe(false)
        expect(result.errors[0]?.reason).toBe('type_mismatch')
      })
    })

    describe('.toHaveProperties()', () => {
      it('should pass when object has all expected properties', () => {
        const jsonSchema = createUserSchema()
        const validator = createTypeValidator()

        const result = validator.validate(jsonSchema, column('profile').toHaveProperties(['bio', 'avatar']))

        expect(result.valid).toBe(true)
      })

      it('should fail when object is missing some properties', () => {
        const jsonSchema = createUserSchema()
        const validator = createTypeValidator()

        const result = validator.validate(jsonSchema, column('profile').toHaveProperties(['bio', 'missing']))

        expect(result.valid).toBe(false)
        expect(result.errors[0]?.reason).toBe('property_not_found')
      })
    })

    describe('.toHaveRequiredProperty()', () => {
      it('should pass when object has required property', () => {
        const jsonSchema: JSONSchema = {
          type: 'object',
          properties: {
            user: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
              },
              required: ['id'],
            },
          },
        }
        const validator = createTypeValidator()

        const result = validator.validate(jsonSchema, column('user').toHaveRequiredProperty('id'))

        expect(result.valid).toBe(true)
      })

      it('should fail when property is not in required array', () => {
        const jsonSchema: JSONSchema = {
          type: 'object',
          properties: {
            user: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
              },
              required: ['id'],
            },
          },
        }
        const validator = createTypeValidator()

        const result = validator.validate(jsonSchema, column('user').toHaveRequiredProperty('name'))

        expect(result.valid).toBe(false)
        expect(result.errors[0]?.reason).toBe('property_not_required')
      })
    })
  })

  // ==========================================================================
  // JSON SCHEMA VALIDATION
  // ==========================================================================

  describe('JSON Schema validation', () => {
    describe('.toHaveType(schema)', () => {
      it('should pass when column matches exact JSON Schema', () => {
        const jsonSchema = createUserSchema()
        const validator = createTypeValidator()

        const result = validator.validate(
          jsonSchema,
          column('email').toHaveType({ type: 'string', format: 'email' })
        )

        expect(result.valid).toBe(true)
      })

      it('should fail when column does not match JSON Schema type', () => {
        const jsonSchema = createUserSchema()
        const validator = createTypeValidator()

        const result = validator.validate(
          jsonSchema,
          column('age').toHaveType({ type: 'string' })
        )

        expect(result.valid).toBe(false)
        expect(result.errors[0]?.reason).toBe('schema_mismatch')
      })

      it('should validate complex nested schema', () => {
        const jsonSchema = createUserSchema()
        const validator = createTypeValidator()

        const result = validator.validate(
          jsonSchema,
          column('profile').toHaveType({
            type: 'object',
            properties: {
              bio: { type: 'string' },
              avatar: { type: 'string' },
            },
          })
        )

        expect(result.valid).toBe(true)
      })

      it('should fail when schema format does not match', () => {
        const jsonSchema = createUserSchema()
        const validator = createTypeValidator()

        const result = validator.validate(
          jsonSchema,
          column('email').toHaveType({ type: 'string', format: 'uri' })
        )

        expect(result.valid).toBe(false)
        expect(result.errors[0]?.reason).toBe('schema_mismatch')
      })
    })
  })

  // ==========================================================================
  // SCHEMA EVOLUTION COMPATIBILITY
  // ==========================================================================

  describe('schema evolution compatibility', () => {
    describe('.toBeBackwardCompatibleWith()', () => {
      it('should pass when type widening is valid (integer -> number)', () => {
        const oldSchema: JSONSchema = {
          type: 'object',
          properties: {
            count: { type: 'integer' },
          },
        }
        const newSchema: JSONSchema = {
          type: 'object',
          properties: {
            count: { type: 'number' },
          },
        }
        const validator = createTypeValidator()

        const result = validator.checkEvolutionCompatibility(
          oldSchema,
          newSchema,
          'count',
          'backward'
        )

        expect(result.valid).toBe(true)
      })

      it('should fail when type narrowing breaks compatibility (number -> integer)', () => {
        const oldSchema: JSONSchema = {
          type: 'object',
          properties: {
            count: { type: 'number' },
          },
        }
        const newSchema: JSONSchema = {
          type: 'object',
          properties: {
            count: { type: 'integer' },
          },
        }
        const validator = createTypeValidator()

        const result = validator.checkEvolutionCompatibility(
          oldSchema,
          newSchema,
          'count',
          'backward'
        )

        expect(result.valid).toBe(false)
        expect(result.errors[0]?.reason).toBe('incompatible_type_change')
      })

      it('should pass when nullable is added (string -> string | null)', () => {
        const oldSchema: JSONSchema = {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
        }
        const newSchema: JSONSchema = {
          type: 'object',
          properties: {
            name: { type: ['string', 'null'] },
          },
        }
        const validator = createTypeValidator()

        const result = validator.checkEvolutionCompatibility(
          oldSchema,
          newSchema,
          'name',
          'backward'
        )

        expect(result.valid).toBe(true)
      })

      it('should fail when nullable is removed (string | null -> string)', () => {
        const oldSchema: JSONSchema = {
          type: 'object',
          properties: {
            name: { type: ['string', 'null'] },
          },
        }
        const newSchema: JSONSchema = {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
        }
        const validator = createTypeValidator()

        const result = validator.checkEvolutionCompatibility(
          oldSchema,
          newSchema,
          'name',
          'backward'
        )

        expect(result.valid).toBe(false)
        expect(result.errors[0]?.reason).toBe('nullable_removed')
      })
    })

    describe('.toBeForwardCompatibleWith()', () => {
      it('should pass when type narrowing is valid for forward compat', () => {
        const oldSchema: JSONSchema = {
          type: 'object',
          properties: {
            count: { type: 'number' },
          },
        }
        const newSchema: JSONSchema = {
          type: 'object',
          properties: {
            count: { type: 'integer' },
          },
        }
        const validator = createTypeValidator()

        const result = validator.checkEvolutionCompatibility(
          oldSchema,
          newSchema,
          'count',
          'forward'
        )

        expect(result.valid).toBe(true)
      })
    })

    describe('.toBeFullyCompatibleWith()', () => {
      it('should pass when no type changes', () => {
        const oldSchema: JSONSchema = {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
        }
        const newSchema: JSONSchema = {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
        }
        const validator = createTypeValidator()

        const result = validator.checkEvolutionCompatibility(
          oldSchema,
          newSchema,
          'name',
          'full'
        )

        expect(result.valid).toBe(true)
      })

      it('should fail when any type change in full compat mode', () => {
        const oldSchema: JSONSchema = {
          type: 'object',
          properties: {
            count: { type: 'integer' },
          },
        }
        const newSchema: JSONSchema = {
          type: 'object',
          properties: {
            count: { type: 'number' },
          },
        }
        const validator = createTypeValidator()

        const result = validator.checkEvolutionCompatibility(
          oldSchema,
          newSchema,
          'count',
          'full'
        )

        expect(result.valid).toBe(false)
      })
    })
  })

  // ==========================================================================
  // SCHEMA-LEVEL VALIDATION
  // ==========================================================================

  describe('schema() builder', () => {
    it('should validate multiple columns at once', () => {
      const jsonSchema = createUserSchema()
      const validator = createTypeValidator()

      const result = validator.validateSchema(
        jsonSchema,
        schema()
          .column('id').toBeString()
          .column('age').toBeNumber()
          .column('active').toBeBoolean()
          .column('tags').toBeArray()
          .build()
      )

      expect(result.valid).toBe(true)
    })

    it('should collect all errors from multiple columns', () => {
      const jsonSchema = createUserSchema()
      const validator = createTypeValidator()

      const result = validator.validateSchema(
        jsonSchema,
        schema()
          .column('id').toBeNumber() // wrong
          .column('age').toBeString() // wrong
          .column('missing').toBeString() // missing
          .build()
      )

      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThanOrEqual(3)
    })
  })

  // ==========================================================================
  // ERROR MESSAGES
  // ==========================================================================

  describe('error messages', () => {
    it('should provide clear error message for type mismatch', () => {
      const jsonSchema = createUserSchema()
      const validator = createTypeValidator()

      const result = validator.validate(jsonSchema, column('age').toBeString())

      expect(result.errors[0]?.message).toContain('age')
      expect(result.errors[0]?.message).toContain('string')
      expect(result.errors[0]?.message).toContain('integer')
    })

    it('should provide clear error message for nullable violation', () => {
      const jsonSchema = createUserSchema()
      const validator = createTypeValidator()

      const result = validator.validate(jsonSchema, column('nickname').toBeRequired())

      expect(result.errors[0]?.message).toContain('nickname')
      expect(result.errors[0]?.message).toContain('nullable')
    })

    it('should provide clear error message for missing column', () => {
      const jsonSchema = createUserSchema()
      const validator = createTypeValidator()

      const result = validator.validate(jsonSchema, column('nonexistent').toBeString())

      expect(result.errors[0]?.message).toContain('nonexistent')
      expect(result.errors[0]?.message).toContain('not found')
    })
  })

  // ==========================================================================
  // CHAINING
  // ==========================================================================

  describe('expectation chaining', () => {
    it('should allow chaining multiple expectations', () => {
      const jsonSchema = createUserSchema()
      const validator = createTypeValidator()

      const result = validator.validate(
        jsonSchema,
        column('email').toBeString().toBeRequired()
      )

      expect(result.valid).toBe(true)
    })

    it('should validate all chained expectations', () => {
      const jsonSchema = createUserSchema()
      const validator = createTypeValidator()

      const result = validator.validate(
        jsonSchema,
        column('nickname').toBeString().toBeRequired() // nickname is nullable, so toBeRequired should fail
      )

      expect(result.valid).toBe(false)
      expect(result.errors[0]?.reason).toBe('nullable_violation')
    })

    it('should allow complex chained expectations for arrays', () => {
      const jsonSchema: JSONSchema = {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            maxItems: 10,
          },
        },
      }
      const validator = createTypeValidator()

      const result = validator.validate(
        jsonSchema,
        column('items').toBeArray().toBeArrayOf('string').toHaveMinItems(1).toHaveMaxItems(10)
      )

      expect(result.valid).toBe(true)
    })
  })
})
