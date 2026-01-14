/**
 * Schema Expectations Tests - Schema-level validation for data contracts
 *
 * RED phase: These tests define the expected behavior of SchemaExpectations.
 * All tests should FAIL until implementation is complete.
 *
 * SchemaExpectations provide:
 * - Column Expectations - Required columns, column types, nullable rules
 * - Table Expectations - Primary key, foreign keys, unique constraints
 * - Relationship Expectations - Referential integrity rules
 * - SchemaValidator - Validates schemas against expectations
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  SchemaExpectation,
  ColumnExpectation,
  TableExpectation,
  RelationshipExpectation,
  SchemaValidator,
  createSchemaValidator,
  SchemaExpectationResult,
  ColumnExpectationError,
  ConstraintExpectationError,
  RelationshipExpectationError,
} from '../schema-expectations'
import { createSchema, type JSONSchema, type DataContract } from '../index'

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
      active: { type: 'boolean' },
      createdAt: { type: 'string', format: 'date-time' },
    },
    required: ['id', 'email'],
  }
}

function createOrderSchema(): JSONSchema {
  return {
    type: 'object',
    properties: {
      orderId: { type: 'string' },
      userId: { type: 'string' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            productId: { type: 'string' },
            quantity: { type: 'integer', minimum: 1 },
            price: { type: 'number', minimum: 0 },
          },
          required: ['productId', 'quantity'],
        },
        minItems: 1,
      },
      total: { type: 'number', minimum: 0 },
      status: {
        type: 'string',
        enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled'],
      },
    },
    required: ['orderId', 'userId', 'items'],
  }
}

function createProductSchema(): JSONSchema {
  return {
    type: 'object',
    properties: {
      sku: { type: 'string', pattern: '^[A-Z]{3}-\\d{4}$' },
      name: { type: 'string' },
      price: { type: 'number', minimum: 0 },
      category: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
    },
    required: ['sku', 'name', 'price'],
  }
}

// ============================================================================
// COLUMN EXPECTATIONS
// ============================================================================

describe('SchemaExpectations', () => {
  describe('column expectations', () => {
    let validator: SchemaValidator

    beforeEach(() => {
      validator = createSchemaValidator()
    })

    describe('required columns', () => {
      it('should pass when all required columns exist', () => {
        const schema = createUserSchema()
        const expectation: ColumnExpectation = {
          type: 'column',
          columns: [
            { name: 'id', required: true },
            { name: 'email', required: true },
          ],
        }

        const result = validator.validateColumns(schema, expectation)

        expect(result.valid).toBe(true)
        expect(result.errors).toHaveLength(0)
      })

      it('should fail when required column is missing', () => {
        const schema = createUserSchema()
        const expectation: ColumnExpectation = {
          type: 'column',
          columns: [
            { name: 'id', required: true },
            { name: 'phone', required: true }, // doesn't exist
          ],
        }

        const result = validator.validateColumns(schema, expectation)

        expect(result.valid).toBe(false)
        expect(result.errors.length).toBeGreaterThan(0)
        expect(result.errors.some((e) => e.column === 'phone' && e.reason === 'missing')).toBe(true)
      })

      it('should pass when optional column is missing', () => {
        const schema = createUserSchema()
        const expectation: ColumnExpectation = {
          type: 'column',
          columns: [
            { name: 'id', required: true },
            { name: 'phone', required: false }, // optional, doesn't exist
          ],
        }

        const result = validator.validateColumns(schema, expectation)

        expect(result.valid).toBe(true)
      })

      it('should report all missing required columns', () => {
        const schema: JSONSchema = {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
        }

        const expectation: ColumnExpectation = {
          type: 'column',
          columns: [
            { name: 'id', required: true },
            { name: 'email', required: true },
            { name: 'name', required: true },
          ],
        }

        const result = validator.validateColumns(schema, expectation)

        expect(result.valid).toBe(false)
        expect(result.errors.filter((e) => e.reason === 'missing')).toHaveLength(2)
      })
    })

    describe('column types', () => {
      it('should pass when column type matches expectation', () => {
        const schema = createUserSchema()
        const expectation: ColumnExpectation = {
          type: 'column',
          columns: [
            { name: 'id', expectedType: 'string' },
            { name: 'age', expectedType: 'integer' },
            { name: 'active', expectedType: 'boolean' },
          ],
        }

        const result = validator.validateColumns(schema, expectation)

        expect(result.valid).toBe(true)
      })

      it('should fail when column type does not match', () => {
        const schema = createUserSchema()
        const expectation: ColumnExpectation = {
          type: 'column',
          columns: [{ name: 'age', expectedType: 'string' }], // wrong type
        }

        const result = validator.validateColumns(schema, expectation)

        expect(result.valid).toBe(false)
        expect(
          result.errors.some(
            (e) => e.column === 'age' && e.reason === 'type_mismatch' && e.expected === 'string' && e.actual === 'integer'
          )
        ).toBe(true)
      })

      it('should handle array type expectations', () => {
        const schema = createProductSchema()
        const expectation: ColumnExpectation = {
          type: 'column',
          columns: [{ name: 'tags', expectedType: 'array' }],
        }

        const result = validator.validateColumns(schema, expectation)

        expect(result.valid).toBe(true)
      })

      it('should handle object type expectations', () => {
        const schema = createOrderSchema()
        const expectation: ColumnExpectation = {
          type: 'column',
          columns: [{ name: 'items', expectedType: 'array' }],
        }

        const result = validator.validateColumns(schema, expectation)

        expect(result.valid).toBe(true)
      })

      it('should support multiple allowed types', () => {
        const schema: JSONSchema = {
          type: 'object',
          properties: {
            value: { type: ['string', 'null'] },
          },
        }

        const expectation: ColumnExpectation = {
          type: 'column',
          columns: [{ name: 'value', expectedType: ['string', 'null'] }],
        }

        const result = validator.validateColumns(schema, expectation)

        expect(result.valid).toBe(true)
      })
    })

    describe('nullable rules', () => {
      it('should pass when nullable column allows null', () => {
        const schema: JSONSchema = {
          type: 'object',
          properties: {
            nickname: { type: ['string', 'null'] },
          },
        }

        const expectation: ColumnExpectation = {
          type: 'column',
          columns: [{ name: 'nickname', nullable: true }],
        }

        const result = validator.validateColumns(schema, expectation)

        expect(result.valid).toBe(true)
      })

      it('should fail when non-nullable column allows null', () => {
        const schema: JSONSchema = {
          type: 'object',
          properties: {
            id: { type: ['string', 'null'] },
          },
        }

        const expectation: ColumnExpectation = {
          type: 'column',
          columns: [{ name: 'id', nullable: false }],
        }

        const result = validator.validateColumns(schema, expectation)

        expect(result.valid).toBe(false)
        expect(result.errors.some((e) => e.column === 'id' && e.reason === 'nullable_mismatch')).toBe(true)
      })

      it('should fail when nullable column does not allow null', () => {
        const schema: JSONSchema = {
          type: 'object',
          properties: {
            nickname: { type: 'string' },
          },
        }

        const expectation: ColumnExpectation = {
          type: 'column',
          columns: [{ name: 'nickname', nullable: true }],
        }

        const result = validator.validateColumns(schema, expectation)

        expect(result.valid).toBe(false)
        expect(result.errors.some((e) => e.column === 'nickname' && e.reason === 'nullable_mismatch')).toBe(true)
      })
    })

    describe('format constraints', () => {
      it('should pass when column has expected format', () => {
        const schema = createUserSchema()
        const expectation: ColumnExpectation = {
          type: 'column',
          columns: [
            { name: 'email', expectedFormat: 'email' },
            { name: 'createdAt', expectedFormat: 'date-time' },
          ],
        }

        const result = validator.validateColumns(schema, expectation)

        expect(result.valid).toBe(true)
      })

      it('should fail when column format does not match', () => {
        const schema = createUserSchema()
        const expectation: ColumnExpectation = {
          type: 'column',
          columns: [{ name: 'email', expectedFormat: 'uri' }], // wrong format
        }

        const result = validator.validateColumns(schema, expectation)

        expect(result.valid).toBe(false)
        expect(
          result.errors.some(
            (e) => e.column === 'email' && e.reason === 'format_mismatch' && e.expected === 'uri' && e.actual === 'email'
          )
        ).toBe(true)
      })

      it('should fail when column is missing expected format', () => {
        const schema = createUserSchema()
        const expectation: ColumnExpectation = {
          type: 'column',
          columns: [{ name: 'name', expectedFormat: 'email' }], // name has no format
        }

        const result = validator.validateColumns(schema, expectation)

        expect(result.valid).toBe(false)
        expect(result.errors.some((e) => e.column === 'name' && e.reason === 'format_mismatch')).toBe(true)
      })
    })

    describe('pattern constraints', () => {
      it('should pass when column has expected pattern', () => {
        const schema = createProductSchema()
        const expectation: ColumnExpectation = {
          type: 'column',
          columns: [{ name: 'sku', expectedPattern: '^[A-Z]{3}-\\d{4}$' }],
        }

        const result = validator.validateColumns(schema, expectation)

        expect(result.valid).toBe(true)
      })

      it('should fail when column pattern does not match', () => {
        const schema = createProductSchema()
        const expectation: ColumnExpectation = {
          type: 'column',
          columns: [{ name: 'sku', expectedPattern: '^[a-z]+$' }], // wrong pattern
        }

        const result = validator.validateColumns(schema, expectation)

        expect(result.valid).toBe(false)
        expect(result.errors.some((e) => e.column === 'sku' && e.reason === 'pattern_mismatch')).toBe(true)
      })
    })

    describe('enum constraints', () => {
      it('should pass when column has expected enum values', () => {
        const schema = createOrderSchema()
        const expectation: ColumnExpectation = {
          type: 'column',
          columns: [
            {
              name: 'status',
              expectedEnum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled'],
            },
          ],
        }

        const result = validator.validateColumns(schema, expectation)

        expect(result.valid).toBe(true)
      })

      it('should fail when enum values do not match', () => {
        const schema = createOrderSchema()
        const expectation: ColumnExpectation = {
          type: 'column',
          columns: [
            {
              name: 'status',
              expectedEnum: ['open', 'closed'], // wrong enum values
            },
          ],
        }

        const result = validator.validateColumns(schema, expectation)

        expect(result.valid).toBe(false)
        expect(result.errors.some((e) => e.column === 'status' && e.reason === 'enum_mismatch')).toBe(true)
      })

      it('should fail when expected enum is subset of actual', () => {
        const schema = createOrderSchema()
        const expectation: ColumnExpectation = {
          type: 'column',
          columns: [
            {
              name: 'status',
              expectedEnum: ['pending', 'processing'], // subset of actual
            },
          ],
        }

        const result = validator.validateColumns(schema, expectation)

        expect(result.valid).toBe(false)
        expect(result.errors.some((e) => e.column === 'status' && e.reason === 'enum_mismatch')).toBe(true)
      })
    })

    describe('numeric constraints', () => {
      it('should pass when column has expected minimum', () => {
        const schema = createUserSchema()
        const expectation: ColumnExpectation = {
          type: 'column',
          columns: [{ name: 'age', expectedMinimum: 0 }],
        }

        const result = validator.validateColumns(schema, expectation)

        expect(result.valid).toBe(true)
      })

      it('should fail when column minimum does not match', () => {
        const schema = createUserSchema()
        const expectation: ColumnExpectation = {
          type: 'column',
          columns: [{ name: 'age', expectedMinimum: 18 }], // schema has minimum: 0
        }

        const result = validator.validateColumns(schema, expectation)

        expect(result.valid).toBe(false)
        expect(result.errors.some((e) => e.column === 'age' && e.reason === 'constraint_mismatch')).toBe(true)
      })
    })
  })

  // ============================================================================
  // TABLE/CONSTRAINT EXPECTATIONS
  // ============================================================================

  describe('constraint expectations', () => {
    let validator: SchemaValidator

    beforeEach(() => {
      validator = createSchemaValidator()
    })

    describe('required fields (primary key equivalent)', () => {
      it('should pass when schema has all required fields', () => {
        const schema = createUserSchema()
        const expectation: TableExpectation = {
          type: 'table',
          requiredFields: ['id', 'email'],
        }

        const result = validator.validateConstraints(schema, expectation)

        expect(result.valid).toBe(true)
      })

      it('should fail when schema is missing required fields', () => {
        const schema = createUserSchema()
        const expectation: TableExpectation = {
          type: 'table',
          requiredFields: ['id', 'email', 'phone'], // phone not required in schema
        }

        const result = validator.validateConstraints(schema, expectation)

        expect(result.valid).toBe(false)
        expect(result.errors.some((e) => e.field === 'phone' && e.reason === 'not_required')).toBe(true)
      })
    })

    describe('unique constraints', () => {
      it('should pass when schema enforces uniqueness via pattern', () => {
        // In JSON Schema, uniqueness is often enforced via patterns (like uuid format)
        const schema: JSONSchema = {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
          required: ['id'],
        }

        const expectation: TableExpectation = {
          type: 'table',
          uniqueFields: ['id'],
        }

        const result = validator.validateConstraints(schema, expectation)

        expect(result.valid).toBe(true)
      })

      it('should fail when unique field is not defined', () => {
        const schema = createUserSchema()
        const expectation: TableExpectation = {
          type: 'table',
          uniqueFields: ['nonExistentField'],
        }

        const result = validator.validateConstraints(schema, expectation)

        expect(result.valid).toBe(false)
        expect(result.errors.some((e) => e.field === 'nonExistentField' && e.reason === 'field_not_found')).toBe(true)
      })
    })

    describe('additionalProperties constraint', () => {
      it('should pass when schema disallows additional properties as expected', () => {
        const schema: JSONSchema = {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
          additionalProperties: false,
        }

        const expectation: TableExpectation = {
          type: 'table',
          additionalProperties: false,
        }

        const result = validator.validateConstraints(schema, expectation)

        expect(result.valid).toBe(true)
      })

      it('should fail when additionalProperties constraint does not match', () => {
        const schema: JSONSchema = {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
          additionalProperties: true,
        }

        const expectation: TableExpectation = {
          type: 'table',
          additionalProperties: false,
        }

        const result = validator.validateConstraints(schema, expectation)

        expect(result.valid).toBe(false)
        expect(result.errors.some((e) => e.reason === 'additional_properties_mismatch')).toBe(true)
      })
    })

    describe('minimum properties', () => {
      it('should pass when schema has minimum expected properties', () => {
        const schema = createUserSchema() // has 6 properties

        const expectation: TableExpectation = {
          type: 'table',
          minProperties: 5,
        }

        const result = validator.validateConstraints(schema, expectation)

        expect(result.valid).toBe(true)
      })

      it('should fail when schema has fewer properties than expected', () => {
        const schema: JSONSchema = {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
        }

        const expectation: TableExpectation = {
          type: 'table',
          minProperties: 5,
        }

        const result = validator.validateConstraints(schema, expectation)

        expect(result.valid).toBe(false)
        expect(result.errors.some((e) => e.reason === 'insufficient_properties')).toBe(true)
      })
    })
  })

  // ============================================================================
  // RELATIONSHIP EXPECTATIONS
  // ============================================================================

  describe('relationship expectations', () => {
    let validator: SchemaValidator

    beforeEach(() => {
      validator = createSchemaValidator()
    })

    describe('foreign key references', () => {
      it('should pass when reference field exists', () => {
        const schemas: Record<string, JSONSchema> = {
          order: createOrderSchema(),
          user: createUserSchema(),
        }

        const expectation: RelationshipExpectation = {
          type: 'relationship',
          relationships: [
            {
              from: { schema: 'order', field: 'userId' },
              to: { schema: 'user', field: 'id' },
              type: 'many-to-one',
            },
          ],
        }

        const result = validator.validateRelationships(schemas, expectation)

        expect(result.valid).toBe(true)
      })

      it('should fail when reference source field does not exist', () => {
        const schemas: Record<string, JSONSchema> = {
          order: createOrderSchema(),
          user: createUserSchema(),
        }

        const expectation: RelationshipExpectation = {
          type: 'relationship',
          relationships: [
            {
              from: { schema: 'order', field: 'customerId' }, // doesn't exist
              to: { schema: 'user', field: 'id' },
              type: 'many-to-one',
            },
          ],
        }

        const result = validator.validateRelationships(schemas, expectation)

        expect(result.valid).toBe(false)
        expect(result.errors.some((e) => e.field === 'customerId' && e.reason === 'source_field_not_found')).toBe(true)
      })

      it('should fail when reference target field does not exist', () => {
        const schemas: Record<string, JSONSchema> = {
          order: createOrderSchema(),
          user: createUserSchema(),
        }

        const expectation: RelationshipExpectation = {
          type: 'relationship',
          relationships: [
            {
              from: { schema: 'order', field: 'userId' },
              to: { schema: 'user', field: 'userId' }, // doesn't exist in user schema
              type: 'many-to-one',
            },
          ],
        }

        const result = validator.validateRelationships(schemas, expectation)

        expect(result.valid).toBe(false)
        expect(result.errors.some((e) => e.field === 'userId' && e.reason === 'target_field_not_found')).toBe(true)
      })

      it('should fail when reference schema does not exist', () => {
        const schemas: Record<string, JSONSchema> = {
          order: createOrderSchema(),
        }

        const expectation: RelationshipExpectation = {
          type: 'relationship',
          relationships: [
            {
              from: { schema: 'order', field: 'userId' },
              to: { schema: 'user', field: 'id' }, // user schema doesn't exist
              type: 'many-to-one',
            },
          ],
        }

        const result = validator.validateRelationships(schemas, expectation)

        expect(result.valid).toBe(false)
        expect(result.errors.some((e) => e.schema === 'user' && e.reason === 'schema_not_found')).toBe(true)
      })
    })

    describe('type compatibility', () => {
      it('should pass when reference field types are compatible', () => {
        const schemas: Record<string, JSONSchema> = {
          order: createOrderSchema(),
          user: createUserSchema(),
        }

        const expectation: RelationshipExpectation = {
          type: 'relationship',
          relationships: [
            {
              from: { schema: 'order', field: 'userId' },
              to: { schema: 'user', field: 'id' },
              type: 'many-to-one',
              requireTypeMatch: true,
            },
          ],
        }

        const result = validator.validateRelationships(schemas, expectation)

        expect(result.valid).toBe(true)
      })

      it('should fail when reference field types are incompatible', () => {
        const schemas: Record<string, JSONSchema> = {
          order: {
            type: 'object',
            properties: {
              userId: { type: 'integer' }, // integer
            },
          },
          user: {
            type: 'object',
            properties: {
              id: { type: 'string' }, // string
            },
          },
        }

        const expectation: RelationshipExpectation = {
          type: 'relationship',
          relationships: [
            {
              from: { schema: 'order', field: 'userId' },
              to: { schema: 'user', field: 'id' },
              type: 'many-to-one',
              requireTypeMatch: true,
            },
          ],
        }

        const result = validator.validateRelationships(schemas, expectation)

        expect(result.valid).toBe(false)
        expect(result.errors.some((e) => e.reason === 'type_incompatible')).toBe(true)
      })
    })

    describe('relationship cardinality', () => {
      it('should validate one-to-one relationships', () => {
        const schemas: Record<string, JSONSchema> = {
          user: createUserSchema(),
          profile: {
            type: 'object',
            properties: {
              userId: { type: 'string' },
              bio: { type: 'string' },
            },
            required: ['userId'],
          },
        }

        const expectation: RelationshipExpectation = {
          type: 'relationship',
          relationships: [
            {
              from: { schema: 'profile', field: 'userId' },
              to: { schema: 'user', field: 'id' },
              type: 'one-to-one',
            },
          ],
        }

        const result = validator.validateRelationships(schemas, expectation)

        expect(result.valid).toBe(true)
      })

      it('should validate one-to-many relationships', () => {
        const schemas: Record<string, JSONSchema> = {
          user: createUserSchema(),
          order: createOrderSchema(),
        }

        const expectation: RelationshipExpectation = {
          type: 'relationship',
          relationships: [
            {
              from: { schema: 'order', field: 'userId' },
              to: { schema: 'user', field: 'id' },
              type: 'many-to-one',
            },
          ],
        }

        const result = validator.validateRelationships(schemas, expectation)

        expect(result.valid).toBe(true)
      })

      it('should validate many-to-many relationships', () => {
        const schemas: Record<string, JSONSchema> = {
          product: createProductSchema(),
          order: createOrderSchema(),
          orderItem: {
            type: 'object',
            properties: {
              orderId: { type: 'string' },
              productId: { type: 'string' },
              quantity: { type: 'integer' },
            },
            required: ['orderId', 'productId'],
          },
        }

        const expectation: RelationshipExpectation = {
          type: 'relationship',
          relationships: [
            {
              from: { schema: 'orderItem', field: 'orderId' },
              to: { schema: 'order', field: 'orderId' },
              type: 'many-to-one',
            },
            {
              from: { schema: 'orderItem', field: 'productId' },
              to: { schema: 'product', field: 'sku' },
              type: 'many-to-one',
            },
          ],
        }

        const result = validator.validateRelationships(schemas, expectation)

        expect(result.valid).toBe(true)
      })
    })
  })

  // ============================================================================
  // SCHEMA VALIDATOR - FULL VALIDATION
  // ============================================================================

  describe('SchemaValidator - full validation', () => {
    let validator: SchemaValidator

    beforeEach(() => {
      validator = createSchemaValidator()
    })

    it('should validate full schema expectation', () => {
      const schema = createUserSchema()
      const expectation: SchemaExpectation = {
        columns: {
          type: 'column',
          columns: [
            { name: 'id', required: true, expectedType: 'string' },
            { name: 'email', required: true, expectedType: 'string', expectedFormat: 'email' },
            { name: 'age', expectedType: 'integer', expectedMinimum: 0 },
          ],
        },
        constraints: {
          type: 'table',
          requiredFields: ['id', 'email'],
        },
      }

      const result = validator.validate(schema, expectation)

      expect(result.valid).toBe(true)
      expect(result.columnErrors).toHaveLength(0)
      expect(result.constraintErrors).toHaveLength(0)
    })

    it('should aggregate errors from all validation types', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'integer' }, // wrong type
        },
        required: [], // nothing required
      }

      const expectation: SchemaExpectation = {
        columns: {
          type: 'column',
          columns: [
            { name: 'id', expectedType: 'string' },
            { name: 'email', required: true }, // missing
          ],
        },
        constraints: {
          type: 'table',
          requiredFields: ['id', 'email'],
        },
      }

      const result = validator.validate(schema, expectation)

      expect(result.valid).toBe(false)
      expect(result.columnErrors.length).toBeGreaterThan(0)
      expect(result.constraintErrors.length).toBeGreaterThan(0)
    })

    it('should validate with relationships when provided', () => {
      const schemas: Record<string, JSONSchema> = {
        user: createUserSchema(),
        order: createOrderSchema(),
      }

      const expectation: SchemaExpectation = {
        columns: {
          type: 'column',
          columns: [{ name: 'id', required: true }],
        },
        relationships: {
          type: 'relationship',
          relationships: [
            {
              from: { schema: 'order', field: 'userId' },
              to: { schema: 'user', field: 'id' },
              type: 'many-to-one',
            },
          ],
        },
      }

      const result = validator.validateWithRelationships(schemas.user, schemas, expectation)

      expect(result.valid).toBe(true)
    })

    it('should provide clear error messages', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'integer' },
        },
      }

      const expectation: SchemaExpectation = {
        columns: {
          type: 'column',
          columns: [{ name: 'id', expectedType: 'string' }],
        },
      }

      const result = validator.validate(schema, expectation)

      expect(result.valid).toBe(false)
      expect(result.columnErrors[0].message).toContain('id')
      expect(result.columnErrors[0].message).toContain('type')
    })
  })

  // ============================================================================
  // ERROR REPORTING
  // ============================================================================

  describe('error reporting', () => {
    let validator: SchemaValidator

    beforeEach(() => {
      validator = createSchemaValidator()
    })

    it('should include column name in column errors', () => {
      const schema = createUserSchema()
      const expectation: ColumnExpectation = {
        type: 'column',
        columns: [{ name: 'missing_column', required: true }],
      }

      const result = validator.validateColumns(schema, expectation)

      expect(result.errors[0].column).toBe('missing_column')
    })

    it('should include expected and actual values in type errors', () => {
      const schema = createUserSchema()
      const expectation: ColumnExpectation = {
        type: 'column',
        columns: [{ name: 'age', expectedType: 'string' }],
      }

      const result = validator.validateColumns(schema, expectation)

      expect(result.errors[0].expected).toBe('string')
      expect(result.errors[0].actual).toBe('integer')
    })

    it('should include schema and field in relationship errors', () => {
      const schemas: Record<string, JSONSchema> = {
        order: createOrderSchema(),
      }

      const expectation: RelationshipExpectation = {
        type: 'relationship',
        relationships: [
          {
            from: { schema: 'order', field: 'userId' },
            to: { schema: 'user', field: 'id' },
            type: 'many-to-one',
          },
        ],
      }

      const result = validator.validateRelationships(schemas, expectation)

      expect(result.errors[0].schema).toBe('user')
    })

    it('should format errors as human-readable messages', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'integer' },
        },
      }

      const expectation: ColumnExpectation = {
        type: 'column',
        columns: [
          { name: 'id', expectedType: 'string' },
          { name: 'email', required: true },
        ],
      }

      const result = validator.validateColumns(schema, expectation)

      // Errors should have meaningful messages
      for (const error of result.errors) {
        expect(error.message).toBeDefined()
        expect(error.message.length).toBeGreaterThan(10)
      }
    })
  })

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('edge cases', () => {
    let validator: SchemaValidator

    beforeEach(() => {
      validator = createSchemaValidator()
    })

    it('should handle empty schema', () => {
      const schema: JSONSchema = { type: 'object' }
      const expectation: ColumnExpectation = {
        type: 'column',
        columns: [],
      }

      const result = validator.validateColumns(schema, expectation)

      expect(result.valid).toBe(true)
    })

    it('should handle schema with no properties', () => {
      const schema: JSONSchema = {
        type: 'object',
        additionalProperties: true,
      }

      const expectation: ColumnExpectation = {
        type: 'column',
        columns: [{ name: 'id', required: true }],
      }

      const result = validator.validateColumns(schema, expectation)

      expect(result.valid).toBe(false)
    })

    it('should handle deeply nested schemas', () => {
      const schema: JSONSchema = {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              profile: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                },
              },
            },
          },
        },
      }

      const expectation: ColumnExpectation = {
        type: 'column',
        columns: [{ name: 'user', expectedType: 'object' }],
      }

      const result = validator.validateColumns(schema, expectation)

      expect(result.valid).toBe(true)
    })

    it('should handle expectations with all options', () => {
      const schema = createUserSchema()
      const expectation: ColumnExpectation = {
        type: 'column',
        columns: [
          {
            name: 'email',
            required: true,
            expectedType: 'string',
            expectedFormat: 'email',
            nullable: false,
          },
        ],
      }

      const result = validator.validateColumns(schema, expectation)

      expect(result.valid).toBe(true)
    })

    it('should handle empty relationships', () => {
      const schemas: Record<string, JSONSchema> = {
        user: createUserSchema(),
      }

      const expectation: RelationshipExpectation = {
        type: 'relationship',
        relationships: [],
      }

      const result = validator.validateRelationships(schemas, expectation)

      expect(result.valid).toBe(true)
    })
  })
})
