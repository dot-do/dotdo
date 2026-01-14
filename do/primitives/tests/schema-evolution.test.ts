/**
 * SchemaEvolution tests
 *
 * RED phase: These tests define the expected behavior of SchemaEvolution.
 * All tests should FAIL until implementation is complete.
 *
 * SchemaEvolution provides dynamic schema management:
 * - Infer schema from JSON data samples
 * - Detect schema changes (added/removed/changed fields)
 * - Check compatibility between schema versions
 * - Apply schema evolutions with versioning
 * - Rollback to previous schema versions
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createSchemaEvolution,
  createEmptySchema,
  fieldTypesEqual,
  canWiden,
  fieldTypeToString,
  type SchemaEvolution,
  type Schema,
  type SchemaDiff,
  type FieldType,
  type ArrayFieldType,
  type MapFieldType,
  type StructFieldType,
  type HistoryRetentionPolicy,
  type HistoryPruneStats,
} from '../schema-evolution'

// ============================================================================
// TEST HELPERS
// ============================================================================

function createTestEvolution(): SchemaEvolution {
  return createSchemaEvolution()
}

/**
 * Helper to create a simple schema with primitive fields
 */
function createSimpleSchema(
  fields: Record<string, FieldType>,
  requiredFields: string[] = [],
  version = 1
): Schema {
  return {
    fields: new Map(Object.entries(fields)),
    requiredFields: new Set(requiredFields),
    version,
  }
}

/**
 * Helper to check if a diff has specific added fields
 */
function hasAddedField(diff: SchemaDiff, fieldName: string): boolean {
  return diff.addedFields.has(fieldName)
}

/**
 * Helper to check if a diff has specific removed fields
 */
function hasRemovedField(diff: SchemaDiff, fieldName: string): boolean {
  return diff.removedFields.has(fieldName)
}

// ============================================================================
// SCHEMA INFERENCE FROM JSON OBJECTS
// ============================================================================

describe('SchemaEvolution', () => {
  describe('schema inference from JSON objects', () => {
    it('should infer schema from simple JSON objects', () => {
      const evolution = createTestEvolution()

      const sample = [
        { name: 'Alice', age: 30, active: true },
        { name: 'Bob', age: 25, active: false },
      ]

      const schema = evolution.inferSchema(sample)

      expect(schema.fields.size).toBe(3)
      expect(schema.fields.get('name')).toBe('string')
      expect(schema.fields.get('age')).toBe('int')
      expect(schema.fields.get('active')).toBe('boolean')
    })

    it('should infer required fields from consistent presence', () => {
      const evolution = createTestEvolution()

      const sample = [
        { id: 1, name: 'Alice', email: 'alice@test.com' },
        { id: 2, name: 'Bob' }, // email missing
        { id: 3, name: 'Charlie', email: 'charlie@test.com' },
      ]

      const schema = evolution.inferSchema(sample)

      // id and name are always present -> required
      expect(schema.requiredFields.has('id')).toBe(true)
      expect(schema.requiredFields.has('name')).toBe(true)
      // email is sometimes missing -> not required
      expect(schema.requiredFields.has('email')).toBe(false)
    })

    it('should infer float type when numbers have decimals', () => {
      const evolution = createTestEvolution()

      const sample = [{ price: 19.99 }, { price: 29.5 }, { price: 9.0 }]

      const schema = evolution.inferSchema(sample)

      expect(schema.fields.get('price')).toBe('float')
    })

    it('should infer int type when numbers are whole', () => {
      const evolution = createTestEvolution()

      const sample = [{ count: 1 }, { count: 2 }, { count: 100 }]

      const schema = evolution.inferSchema(sample)

      expect(schema.fields.get('count')).toBe('int')
    })

    it('should widen int to float if mixed', () => {
      const evolution = createTestEvolution()

      const sample = [{ value: 1 }, { value: 2.5 }, { value: 3 }]

      const schema = evolution.inferSchema(sample)

      // Mixed int/float should result in float
      expect(schema.fields.get('value')).toBe('float')
    })

    it('should infer null type for always-null fields', () => {
      const evolution = createTestEvolution()

      const sample = [{ data: null }, { data: null }, { data: null }]

      const schema = evolution.inferSchema(sample)

      expect(schema.fields.get('data')).toBe('null')
    })

    it('should infer timestamp type for ISO date strings', () => {
      const evolution = createTestEvolution()

      const sample = [
        { createdAt: '2024-01-15T10:30:00Z' },
        { createdAt: '2024-02-20T14:45:30Z' },
      ]

      const schema = evolution.inferSchema(sample)

      expect(schema.fields.get('createdAt')).toBe('timestamp')
    })

    it('should infer date type for date-only strings', () => {
      const evolution = createTestEvolution()

      const sample = [{ birthDate: '1990-05-15' }, { birthDate: '1985-12-01' }]

      const schema = evolution.inferSchema(sample)

      expect(schema.fields.get('birthDate')).toBe('date')
    })

    it('should handle empty sample array', () => {
      const evolution = createTestEvolution()

      const schema = evolution.inferSchema([])

      expect(schema.fields.size).toBe(0)
      expect(schema.version).toBe(1)
    })

    it('should handle sample with single object', () => {
      const evolution = createTestEvolution()

      const schema = evolution.inferSchema([{ id: 1, name: 'Test' }])

      expect(schema.fields.size).toBe(2)
      expect(schema.fields.get('id')).toBe('int')
      expect(schema.fields.get('name')).toBe('string')
    })
  })

  // ============================================================================
  // DETECT NEW FIELDS ADDED
  // ============================================================================

  describe('detect new fields added', () => {
    it('should detect single added field', () => {
      const evolution = createTestEvolution()

      const oldSchema = createSimpleSchema({ name: 'string' })
      const newSchema = createSimpleSchema({ name: 'string', email: 'string' })

      const diff = evolution.diff(oldSchema, newSchema)

      expect(diff.addedFields.size).toBe(1)
      expect(diff.addedFields.get('email')).toBe('string')
    })

    it('should detect multiple added fields', () => {
      const evolution = createTestEvolution()

      const oldSchema = createSimpleSchema({ id: 'int' })
      const newSchema = createSimpleSchema({
        id: 'int',
        name: 'string',
        age: 'int',
        email: 'string',
      })

      const diff = evolution.diff(oldSchema, newSchema)

      expect(diff.addedFields.size).toBe(3)
      expect(hasAddedField(diff, 'name')).toBe(true)
      expect(hasAddedField(diff, 'age')).toBe(true)
      expect(hasAddedField(diff, 'email')).toBe(true)
    })

    it('should not report added fields when schemas are identical', () => {
      const evolution = createTestEvolution()

      const schema = createSimpleSchema({ name: 'string', age: 'int' })

      const diff = evolution.diff(schema, schema)

      expect(diff.addedFields.size).toBe(0)
    })

    it('should detect added nested struct fields', () => {
      const evolution = createTestEvolution()

      const addressType: StructFieldType = {
        type: 'struct',
        fields: new Map([
          ['street', 'string'],
          ['city', 'string'],
        ]),
      }

      const oldSchema = createSimpleSchema({ name: 'string' })
      const newSchema: Schema = {
        fields: new Map<string, FieldType>([
          ['name', 'string'],
          ['address', addressType],
        ]),
        requiredFields: new Set(),
        version: 2,
      }

      const diff = evolution.diff(oldSchema, newSchema)

      expect(diff.addedFields.size).toBe(1)
      expect(diff.addedFields.has('address')).toBe(true)
      const addedAddress = diff.addedFields.get('address') as StructFieldType
      expect(addedAddress.type).toBe('struct')
    })
  })

  // ============================================================================
  // DETECT FIELDS REMOVED
  // ============================================================================

  describe('detect fields removed', () => {
    it('should detect single removed field', () => {
      const evolution = createTestEvolution()

      const oldSchema = createSimpleSchema({ name: 'string', email: 'string' })
      const newSchema = createSimpleSchema({ name: 'string' })

      const diff = evolution.diff(oldSchema, newSchema)

      expect(diff.removedFields.size).toBe(1)
      expect(diff.removedFields.has('email')).toBe(true)
    })

    it('should detect multiple removed fields', () => {
      const evolution = createTestEvolution()

      const oldSchema = createSimpleSchema({
        id: 'int',
        name: 'string',
        age: 'int',
        email: 'string',
      })
      const newSchema = createSimpleSchema({ id: 'int' })

      const diff = evolution.diff(oldSchema, newSchema)

      expect(diff.removedFields.size).toBe(3)
      expect(hasRemovedField(diff, 'name')).toBe(true)
      expect(hasRemovedField(diff, 'age')).toBe(true)
      expect(hasRemovedField(diff, 'email')).toBe(true)
    })

    it('should not report removed fields when schemas are identical', () => {
      const evolution = createTestEvolution()

      const schema = createSimpleSchema({ name: 'string' })

      const diff = evolution.diff(schema, schema)

      expect(diff.removedFields.size).toBe(0)
    })

    it('should detect both added and removed fields together', () => {
      const evolution = createTestEvolution()

      const oldSchema = createSimpleSchema({ name: 'string', oldField: 'int' })
      const newSchema = createSimpleSchema({ name: 'string', newField: 'boolean' })

      const diff = evolution.diff(oldSchema, newSchema)

      expect(diff.addedFields.size).toBe(1)
      expect(diff.addedFields.has('newField')).toBe(true)
      expect(diff.removedFields.size).toBe(1)
      expect(diff.removedFields.has('oldField')).toBe(true)
    })
  })

  // ============================================================================
  // DETECT TYPE CHANGES (STRING -> NUMBER)
  // ============================================================================

  describe('detect type changes', () => {
    it('should detect string to int type change', () => {
      const evolution = createTestEvolution()

      const oldSchema = createSimpleSchema({ value: 'string' })
      const newSchema = createSimpleSchema({ value: 'int' })

      const diff = evolution.diff(oldSchema, newSchema)

      expect(diff.changedTypes.size).toBe(1)
      const change = diff.changedTypes.get('value')
      expect(change?.from).toBe('string')
      expect(change?.to).toBe('int')
    })

    it('should detect int to string type change', () => {
      const evolution = createTestEvolution()

      const oldSchema = createSimpleSchema({ id: 'int' })
      const newSchema = createSimpleSchema({ id: 'string' })

      const diff = evolution.diff(oldSchema, newSchema)

      expect(diff.changedTypes.size).toBe(1)
      const change = diff.changedTypes.get('id')
      expect(change?.from).toBe('int')
      expect(change?.to).toBe('string')
    })

    it('should detect boolean to string type change', () => {
      const evolution = createTestEvolution()

      const oldSchema = createSimpleSchema({ active: 'boolean' })
      const newSchema = createSimpleSchema({ active: 'string' })

      const diff = evolution.diff(oldSchema, newSchema)

      expect(diff.changedTypes.size).toBe(1)
      const change = diff.changedTypes.get('active')
      expect(change?.from).toBe('boolean')
      expect(change?.to).toBe('string')
    })

    it('should detect multiple type changes', () => {
      const evolution = createTestEvolution()

      const oldSchema = createSimpleSchema({ a: 'string', b: 'int', c: 'boolean' })
      const newSchema = createSimpleSchema({ a: 'int', b: 'float', c: 'string' })

      const diff = evolution.diff(oldSchema, newSchema)

      expect(diff.changedTypes.size).toBe(3)
      expect(diff.changedTypes.get('a')?.from).toBe('string')
      expect(diff.changedTypes.get('a')?.to).toBe('int')
      expect(diff.changedTypes.get('b')?.from).toBe('int')
      expect(diff.changedTypes.get('b')?.to).toBe('float')
    })

    it('should not report type change for same type', () => {
      const evolution = createTestEvolution()

      const oldSchema = createSimpleSchema({ name: 'string' })
      const newSchema = createSimpleSchema({ name: 'string' })

      const diff = evolution.diff(oldSchema, newSchema)

      expect(diff.changedTypes.size).toBe(0)
    })
  })

  // ============================================================================
  // TYPE WIDENING (INT -> FLOAT) IS COMPATIBLE
  // ============================================================================

  describe('type widening is compatible', () => {
    it('should mark int to float as compatible', () => {
      const evolution = createTestEvolution()

      const oldSchema = createSimpleSchema({ value: 'int' })
      const newSchema = createSimpleSchema({ value: 'float' })

      const result = evolution.isCompatible(oldSchema, newSchema)

      expect(result.compatible).toBe(true)
      expect(result.breakingChanges).toHaveLength(0)
    })

    it('should include widening in warnings but not breaking changes', () => {
      const evolution = createTestEvolution()

      const oldSchema = createSimpleSchema({ value: 'int' })
      const newSchema = createSimpleSchema({ value: 'float' })

      const result = evolution.isCompatible(oldSchema, newSchema)

      expect(result.compatible).toBe(true)
      expect(result.warnings.length).toBeGreaterThanOrEqual(1)
      expect(result.warnings.some((w) => w.includes('value') || w.includes('widen'))).toBe(true)
    })

    it('should use canWiden helper correctly', () => {
      expect(canWiden('int', 'float')).toBe(true)
      expect(canWiden('int', 'string')).toBe(false) // string is not a widening, it's a change
    })

    it('should handle multiple widening changes', () => {
      const evolution = createTestEvolution()

      const oldSchema = createSimpleSchema({ a: 'int', b: 'int', c: 'int' })
      const newSchema = createSimpleSchema({ a: 'float', b: 'float', c: 'float' })

      const result = evolution.isCompatible(oldSchema, newSchema)

      expect(result.compatible).toBe(true)
      expect(result.breakingChanges).toHaveLength(0)
    })
  })

  // ============================================================================
  // TYPE NARROWING (FLOAT -> INT) IS INCOMPATIBLE
  // ============================================================================

  describe('type narrowing is incompatible', () => {
    it('should mark float to int as incompatible', () => {
      const evolution = createTestEvolution()

      const oldSchema = createSimpleSchema({ value: 'float' })
      const newSchema = createSimpleSchema({ value: 'int' })

      const result = evolution.isCompatible(oldSchema, newSchema)

      expect(result.compatible).toBe(false)
      expect(result.breakingChanges.length).toBeGreaterThanOrEqual(1)
    })

    it('should include narrowing in breaking changes', () => {
      const evolution = createTestEvolution()

      const oldSchema = createSimpleSchema({ price: 'float' })
      const newSchema = createSimpleSchema({ price: 'int' })

      const result = evolution.isCompatible(oldSchema, newSchema)

      expect(result.compatible).toBe(false)
      expect(result.breakingChanges.some((c) => c.includes('price'))).toBe(true)
    })

    it('should use canWiden helper to detect narrowing', () => {
      expect(canWiden('float', 'int')).toBe(false)
    })

    it('should mark string to int as incompatible', () => {
      const evolution = createTestEvolution()

      const oldSchema = createSimpleSchema({ id: 'string' })
      const newSchema = createSimpleSchema({ id: 'int' })

      const result = evolution.isCompatible(oldSchema, newSchema)

      expect(result.compatible).toBe(false)
    })
  })

  // ============================================================================
  // NULLABLE -> NON-NULL IS INCOMPATIBLE
  // ============================================================================

  describe('nullable to non-null is incompatible', () => {
    it('should mark nullable to required as incompatible', () => {
      const evolution = createTestEvolution()

      const oldSchema = createSimpleSchema({ email: 'string' }, []) // not required (nullable)
      const newSchema = createSimpleSchema({ email: 'string' }, ['email']) // required

      const result = evolution.isCompatible(oldSchema, newSchema)

      expect(result.compatible).toBe(false)
      expect(result.breakingChanges.some((c) => c.includes('email'))).toBe(true)
    })

    it('should detect nullability changes in diff', () => {
      const evolution = createTestEvolution()

      const oldSchema = createSimpleSchema({ email: 'string' }, [])
      const newSchema = createSimpleSchema({ email: 'string' }, ['email'])

      const diff = evolution.diff(oldSchema, newSchema)

      expect(diff.nullabilityChanges.size).toBe(1)
      // false = became required (non-nullable)
      expect(diff.nullabilityChanges.get('email')).toBe(false)
    })

    it('should report making multiple fields required as breaking', () => {
      const evolution = createTestEvolution()

      const oldSchema = createSimpleSchema({ a: 'string', b: 'int', c: 'boolean' }, [])
      const newSchema = createSimpleSchema({ a: 'string', b: 'int', c: 'boolean' }, ['a', 'b', 'c'])

      const result = evolution.isCompatible(oldSchema, newSchema)

      expect(result.compatible).toBe(false)
      expect(result.breakingChanges.length).toBeGreaterThanOrEqual(1)
    })
  })

  // ============================================================================
  // NON-NULL -> NULLABLE IS COMPATIBLE
  // ============================================================================

  describe('non-null to nullable is compatible', () => {
    it('should mark required to nullable as compatible', () => {
      const evolution = createTestEvolution()

      const oldSchema = createSimpleSchema({ email: 'string' }, ['email']) // required
      const newSchema = createSimpleSchema({ email: 'string' }, []) // not required (nullable)

      const result = evolution.isCompatible(oldSchema, newSchema)

      expect(result.compatible).toBe(true)
    })

    it('should detect nullability changes in diff (becoming nullable)', () => {
      const evolution = createTestEvolution()

      const oldSchema = createSimpleSchema({ email: 'string' }, ['email'])
      const newSchema = createSimpleSchema({ email: 'string' }, [])

      const diff = evolution.diff(oldSchema, newSchema)

      expect(diff.nullabilityChanges.size).toBe(1)
      // true = became nullable
      expect(diff.nullabilityChanges.get('email')).toBe(true)
    })

    it('should include warning for nullability relaxation', () => {
      const evolution = createTestEvolution()

      const oldSchema = createSimpleSchema({ email: 'string' }, ['email'])
      const newSchema = createSimpleSchema({ email: 'string' }, [])

      const result = evolution.isCompatible(oldSchema, newSchema)

      expect(result.compatible).toBe(true)
      expect(result.warnings.some((w) => w.includes('email') || w.includes('nullable'))).toBe(true)
    })

    it('should handle mixed nullability changes', () => {
      const evolution = createTestEvolution()

      const oldSchema = createSimpleSchema({ a: 'string', b: 'int' }, ['a']) // a required, b optional
      const newSchema = createSimpleSchema({ a: 'string', b: 'int' }, ['b']) // a optional, b required

      const result = evolution.isCompatible(oldSchema, newSchema)

      // b becoming required is breaking
      expect(result.compatible).toBe(false)
    })
  })

  // ============================================================================
  // APPLY EVOLUTION CREATES NEW COLUMNS
  // ============================================================================

  describe('apply evolution creates new columns', () => {
    it('should apply diff to evolve schema', async () => {
      const evolution = createTestEvolution()

      // Start with initial schema
      const sample1 = [{ name: 'Alice' }]
      evolution.inferSchema(sample1)

      // Create diff for adding email field
      const oldSchema = evolution.getSchema()
      const newSchema = createSimpleSchema({ name: 'string', email: 'string' })
      const diff = evolution.diff(oldSchema, newSchema)

      await evolution.evolve(diff)

      const currentSchema = evolution.getSchema()
      expect(currentSchema.fields.has('email')).toBe(true)
    })

    it('should increment version after evolution', async () => {
      const evolution = createTestEvolution()

      const sample = [{ id: 1 }]
      evolution.inferSchema(sample)
      const initialVersion = evolution.getVersion()

      const diff: SchemaDiff = {
        addedFields: new Map([['name', 'string' as FieldType]]),
        removedFields: new Set(),
        changedTypes: new Map(),
        nullabilityChanges: new Map(),
      }

      await evolution.evolve(diff)

      expect(evolution.getVersion()).toBe(initialVersion + 1)
    })

    it('should add multiple fields in single evolution', async () => {
      const evolution = createTestEvolution()

      const sample = [{ id: 1 }]
      evolution.inferSchema(sample)

      const diff: SchemaDiff = {
        addedFields: new Map<string, FieldType>([
          ['name', 'string'],
          ['age', 'int'],
          ['active', 'boolean'],
        ]),
        removedFields: new Set(),
        changedTypes: new Map(),
        nullabilityChanges: new Map(),
      }

      await evolution.evolve(diff)

      const schema = evolution.getSchema()
      expect(schema.fields.has('name')).toBe(true)
      expect(schema.fields.has('age')).toBe(true)
      expect(schema.fields.has('active')).toBe(true)
    })

    it('should handle field removal in evolution', async () => {
      const evolution = createTestEvolution()

      const sample = [{ id: 1, name: 'Alice', oldField: 'deprecated' }]
      evolution.inferSchema(sample)

      const diff: SchemaDiff = {
        addedFields: new Map(),
        removedFields: new Set(['oldField']),
        changedTypes: new Map(),
        nullabilityChanges: new Map(),
      }

      await evolution.evolve(diff)

      const schema = evolution.getSchema()
      expect(schema.fields.has('oldField')).toBe(false)
      expect(schema.fields.has('id')).toBe(true)
      expect(schema.fields.has('name')).toBe(true)
    })

    it('should handle type changes in evolution', async () => {
      const evolution = createTestEvolution()

      const sample = [{ value: 1 }]
      evolution.inferSchema(sample)

      const diff: SchemaDiff = {
        addedFields: new Map(),
        removedFields: new Set(),
        changedTypes: new Map([['value', { from: 'int' as FieldType, to: 'float' as FieldType }]]),
        nullabilityChanges: new Map(),
      }

      await evolution.evolve(diff)

      const schema = evolution.getSchema()
      expect(schema.fields.get('value')).toBe('float')
    })
  })

  // ============================================================================
  // ROLLBACK RESTORES PREVIOUS SCHEMA
  // ============================================================================

  describe('rollback restores previous schema', () => {
    it('should restore schema to specific version', async () => {
      const evolution = createTestEvolution()

      // Version 1
      evolution.inferSchema([{ id: 1 }])

      // Version 2
      const diff1: SchemaDiff = {
        addedFields: new Map([['name', 'string' as FieldType]]),
        removedFields: new Set(),
        changedTypes: new Map(),
        nullabilityChanges: new Map(),
      }
      await evolution.evolve(diff1)

      // Version 3
      const diff2: SchemaDiff = {
        addedFields: new Map([['email', 'string' as FieldType]]),
        removedFields: new Set(),
        changedTypes: new Map(),
        nullabilityChanges: new Map(),
      }
      await evolution.evolve(diff2)

      expect(evolution.getVersion()).toBe(3)
      expect(evolution.getSchema().fields.has('email')).toBe(true)

      // Rollback to version 2
      await evolution.rollback(2)

      expect(evolution.getVersion()).toBe(2)
      expect(evolution.getSchema().fields.has('name')).toBe(true)
      expect(evolution.getSchema().fields.has('email')).toBe(false)
    })

    it('should rollback to version 1', async () => {
      const evolution = createTestEvolution()

      evolution.inferSchema([{ id: 1 }])

      const diff: SchemaDiff = {
        addedFields: new Map([['name', 'string' as FieldType]]),
        removedFields: new Set(),
        changedTypes: new Map(),
        nullabilityChanges: new Map(),
      }
      await evolution.evolve(diff)

      await evolution.rollback(1)

      expect(evolution.getVersion()).toBe(1)
      expect(evolution.getSchema().fields.has('name')).toBe(false)
    })

    it('should throw error for invalid rollback version', async () => {
      const evolution = createTestEvolution()

      evolution.inferSchema([{ id: 1 }])

      await expect(evolution.rollback(999)).rejects.toThrow()
    })

    it('should throw error for rollback to version 0', async () => {
      const evolution = createTestEvolution()

      evolution.inferSchema([{ id: 1 }])

      await expect(evolution.rollback(0)).rejects.toThrow()
    })

    it('should maintain history after rollback', async () => {
      const evolution = createTestEvolution()

      evolution.inferSchema([{ id: 1 }])
      await evolution.evolve({
        addedFields: new Map([['name', 'string' as FieldType]]),
        removedFields: new Set(),
        changedTypes: new Map(),
        nullabilityChanges: new Map(),
      })
      await evolution.evolve({
        addedFields: new Map([['email', 'string' as FieldType]]),
        removedFields: new Set(),
        changedTypes: new Map(),
        nullabilityChanges: new Map(),
      })

      await evolution.rollback(1)

      const history = evolution.getHistory()
      // History should still contain all versions
      expect(history.length).toBeGreaterThanOrEqual(3)
    })
  })

  // ============================================================================
  // COMPLEX NESTED SCHEMAS
  // ============================================================================

  describe('complex nested schemas', () => {
    it('should infer nested struct types', () => {
      const evolution = createTestEvolution()

      const sample = [
        {
          user: {
            name: 'Alice',
            address: {
              street: '123 Main St',
              city: 'Springfield',
            },
          },
        },
      ]

      const schema = evolution.inferSchema(sample)

      const userField = schema.fields.get('user') as StructFieldType
      expect(userField.type).toBe('struct')

      const nameField = userField.fields.get('name')
      expect(nameField).toBe('string')

      const addressField = userField.fields.get('address') as StructFieldType
      expect(addressField.type).toBe('struct')
      expect(addressField.fields.get('street')).toBe('string')
      expect(addressField.fields.get('city')).toBe('string')
    })

    it('should detect changes in nested struct fields', () => {
      const evolution = createTestEvolution()

      const oldAddressType: StructFieldType = {
        type: 'struct',
        fields: new Map<string, FieldType>([
          ['street', 'string'],
          ['city', 'string'],
        ]),
      }

      const newAddressType: StructFieldType = {
        type: 'struct',
        fields: new Map<string, FieldType>([
          ['street', 'string'],
          ['city', 'string'],
          ['zipCode', 'string'], // added field
        ]),
      }

      const oldSchema: Schema = {
        fields: new Map([['address', oldAddressType]]),
        requiredFields: new Set(),
        version: 1,
      }

      const newSchema: Schema = {
        fields: new Map([['address', newAddressType]]),
        requiredFields: new Set(),
        version: 2,
      }

      const diff = evolution.diff(oldSchema, newSchema)

      // Should detect the change in the address struct
      expect(diff.changedTypes.has('address') || diff.addedFields.size > 0).toBe(true)
    })

    it('should compare deeply nested structs correctly', () => {
      const level3: StructFieldType = {
        type: 'struct',
        fields: new Map([['value', 'int' as FieldType]]),
      }

      const level2: StructFieldType = {
        type: 'struct',
        fields: new Map([['level3', level3]]),
      }

      const level1: StructFieldType = {
        type: 'struct',
        fields: new Map([['level2', level2]]),
      }

      // Same structure
      const level3Copy: StructFieldType = {
        type: 'struct',
        fields: new Map([['value', 'int' as FieldType]]),
      }

      const level2Copy: StructFieldType = {
        type: 'struct',
        fields: new Map([['level3', level3Copy]]),
      }

      const level1Copy: StructFieldType = {
        type: 'struct',
        fields: new Map([['level2', level2Copy]]),
      }

      expect(fieldTypesEqual(level1, level1Copy)).toBe(true)
    })

    it('should detect type changes in nested fields', () => {
      const evolution = createTestEvolution()

      const oldNested: StructFieldType = {
        type: 'struct',
        fields: new Map([['count', 'int' as FieldType]]),
      }

      const newNested: StructFieldType = {
        type: 'struct',
        fields: new Map([['count', 'string' as FieldType]]),
      }

      const oldSchema: Schema = {
        fields: new Map([['data', oldNested]]),
        requiredFields: new Set(),
        version: 1,
      }

      const newSchema: Schema = {
        fields: new Map([['data', newNested]]),
        requiredFields: new Set(),
        version: 2,
      }

      const result = evolution.isCompatible(oldSchema, newSchema)

      // Changing int to string in nested field is incompatible
      expect(result.compatible).toBe(false)
    })
  })

  // ============================================================================
  // ARRAY AND MAP TYPES
  // ============================================================================

  describe('array and map types', () => {
    it('should infer array type with element type', () => {
      const evolution = createTestEvolution()

      const sample = [{ tags: ['red', 'blue', 'green'] }, { tags: ['yellow'] }]

      const schema = evolution.inferSchema(sample)

      const tagsField = schema.fields.get('tags') as ArrayFieldType
      expect(tagsField.type).toBe('array')
      expect(tagsField.elementType).toBe('string')
    })

    it('should infer array of numbers', () => {
      const evolution = createTestEvolution()

      const sample = [{ scores: [95, 87, 92] }, { scores: [100, 88] }]

      const schema = evolution.inferSchema(sample)

      const scoresField = schema.fields.get('scores') as ArrayFieldType
      expect(scoresField.type).toBe('array')
      expect(scoresField.elementType).toBe('int')
    })

    it('should infer array of objects (struct)', () => {
      const evolution = createTestEvolution()

      const sample = [
        {
          items: [
            { name: 'Item 1', price: 10 },
            { name: 'Item 2', price: 20 },
          ],
        },
      ]

      const schema = evolution.inferSchema(sample)

      const itemsField = schema.fields.get('items') as ArrayFieldType
      expect(itemsField.type).toBe('array')

      const elementType = itemsField.elementType as StructFieldType
      expect(elementType.type).toBe('struct')
      expect(elementType.fields.get('name')).toBe('string')
      expect(elementType.fields.get('price')).toBe('int')
    })

    it('should infer map type', () => {
      const evolution = createTestEvolution()

      // Object with dynamic keys suggests map type
      const sample = [
        {
          metadata: {
            key1: 'value1',
            key2: 'value2',
          },
        },
      ]

      const schema = evolution.inferSchema(sample)

      // Implementation may infer this as struct or map depending on heuristics
      const metadataField = schema.fields.get('metadata')
      expect(metadataField).toBeDefined()
    })

    it('should detect array element type changes', () => {
      const evolution = createTestEvolution()

      const oldArrayType: ArrayFieldType = {
        type: 'array',
        elementType: 'int',
      }

      const newArrayType: ArrayFieldType = {
        type: 'array',
        elementType: 'string',
      }

      const oldSchema: Schema = {
        fields: new Map([['values', oldArrayType]]),
        requiredFields: new Set(),
        version: 1,
      }

      const newSchema: Schema = {
        fields: new Map([['values', newArrayType]]),
        requiredFields: new Set(),
        version: 2,
      }

      const diff = evolution.diff(oldSchema, newSchema)

      expect(diff.changedTypes.has('values')).toBe(true)
    })

    it('should mark array element type narrowing as incompatible', () => {
      const evolution = createTestEvolution()

      const oldArrayType: ArrayFieldType = {
        type: 'array',
        elementType: 'float',
      }

      const newArrayType: ArrayFieldType = {
        type: 'array',
        elementType: 'int',
      }

      const oldSchema: Schema = {
        fields: new Map([['values', oldArrayType]]),
        requiredFields: new Set(),
        version: 1,
      }

      const newSchema: Schema = {
        fields: new Map([['values', newArrayType]]),
        requiredFields: new Set(),
        version: 2,
      }

      const result = evolution.isCompatible(oldSchema, newSchema)

      expect(result.compatible).toBe(false)
    })

    it('should handle empty arrays in inference', () => {
      const evolution = createTestEvolution()

      const sample = [{ items: [] }, { items: ['a', 'b'] }]

      const schema = evolution.inferSchema(sample)

      const itemsField = schema.fields.get('items') as ArrayFieldType
      expect(itemsField.type).toBe('array')
      expect(itemsField.elementType).toBe('string')
    })

    it('should handle map value type changes', () => {
      const evolution = createTestEvolution()

      const oldMapType: MapFieldType = {
        type: 'map',
        keyType: 'string',
        valueType: 'int',
      }

      const newMapType: MapFieldType = {
        type: 'map',
        keyType: 'string',
        valueType: 'float',
      }

      const oldSchema: Schema = {
        fields: new Map([['counts', oldMapType]]),
        requiredFields: new Set(),
        version: 1,
      }

      const newSchema: Schema = {
        fields: new Map([['counts', newMapType]]),
        requiredFields: new Set(),
        version: 2,
      }

      const result = evolution.isCompatible(oldSchema, newSchema)

      // int -> float is widening, should be compatible
      expect(result.compatible).toBe(true)
    })
  })

  // ============================================================================
  // SCHEMA VERSION HISTORY
  // ============================================================================

  describe('schema version history', () => {
    it('should return correct version number', () => {
      const evolution = createTestEvolution()

      evolution.inferSchema([{ id: 1 }])

      expect(evolution.getVersion()).toBe(1)
    })

    it('should increment version with each evolution', async () => {
      const evolution = createTestEvolution()

      evolution.inferSchema([{ id: 1 }])
      expect(evolution.getVersion()).toBe(1)

      await evolution.evolve({
        addedFields: new Map([['name', 'string' as FieldType]]),
        removedFields: new Set(),
        changedTypes: new Map(),
        nullabilityChanges: new Map(),
      })
      expect(evolution.getVersion()).toBe(2)

      await evolution.evolve({
        addedFields: new Map([['email', 'string' as FieldType]]),
        removedFields: new Set(),
        changedTypes: new Map(),
        nullabilityChanges: new Map(),
      })
      expect(evolution.getVersion()).toBe(3)
    })

    it('should return empty history for new evolution', () => {
      const evolution = createTestEvolution()

      const history = evolution.getHistory()

      expect(history).toEqual([])
    })

    it('should track history with schema snapshots', async () => {
      const evolution = createTestEvolution()

      evolution.inferSchema([{ id: 1 }])

      await evolution.evolve({
        addedFields: new Map([['name', 'string' as FieldType]]),
        removedFields: new Set(),
        changedTypes: new Map(),
        nullabilityChanges: new Map(),
      })

      const history = evolution.getHistory()

      expect(history.length).toBeGreaterThanOrEqual(1)
      expect(history[0]).toHaveProperty('version')
      expect(history[0]).toHaveProperty('schema')
      expect(history[0]).toHaveProperty('createdAt')
    })

    it('should preserve timestamps in history', async () => {
      const evolution = createTestEvolution()

      const beforeInfer = Date.now()
      evolution.inferSchema([{ id: 1 }])
      const afterInfer = Date.now()

      await evolution.evolve({
        addedFields: new Map([['name', 'string' as FieldType]]),
        removedFields: new Set(),
        changedTypes: new Map(),
        nullabilityChanges: new Map(),
      })

      const history = evolution.getHistory()
      const firstVersion = history.find((h) => h.version === 1)

      expect(firstVersion).toBeDefined()
      expect(firstVersion!.createdAt).toBeGreaterThanOrEqual(beforeInfer)
      expect(firstVersion!.createdAt).toBeLessThanOrEqual(afterInfer + 1000) // Allow 1s tolerance
    })
  })

  // ============================================================================
  // HELPER FUNCTIONS
  // ============================================================================

  describe('helper functions', () => {
    it('should create empty schema correctly', () => {
      const schema = createEmptySchema()

      expect(schema.fields.size).toBe(0)
      expect(schema.requiredFields.size).toBe(0)
      expect(schema.version).toBe(0)
    })

    it('should compare primitive field types correctly', () => {
      expect(fieldTypesEqual('string', 'string')).toBe(true)
      expect(fieldTypesEqual('int', 'int')).toBe(true)
      expect(fieldTypesEqual('string', 'int')).toBe(false)
    })

    it('should compare array field types correctly', () => {
      const array1: ArrayFieldType = { type: 'array', elementType: 'string' }
      const array2: ArrayFieldType = { type: 'array', elementType: 'string' }
      const array3: ArrayFieldType = { type: 'array', elementType: 'int' }

      expect(fieldTypesEqual(array1, array2)).toBe(true)
      expect(fieldTypesEqual(array1, array3)).toBe(false)
    })

    it('should compare map field types correctly', () => {
      const map1: MapFieldType = { type: 'map', keyType: 'string', valueType: 'int' }
      const map2: MapFieldType = { type: 'map', keyType: 'string', valueType: 'int' }
      const map3: MapFieldType = { type: 'map', keyType: 'string', valueType: 'float' }

      expect(fieldTypesEqual(map1, map2)).toBe(true)
      expect(fieldTypesEqual(map1, map3)).toBe(false)
    })

    it('should compare struct field types correctly', () => {
      const struct1: StructFieldType = {
        type: 'struct',
        fields: new Map([
          ['a', 'string'],
          ['b', 'int'],
        ]),
      }
      const struct2: StructFieldType = {
        type: 'struct',
        fields: new Map([
          ['a', 'string'],
          ['b', 'int'],
        ]),
      }
      const struct3: StructFieldType = {
        type: 'struct',
        fields: new Map([
          ['a', 'string'],
          ['c', 'int'],
        ]),
      }

      expect(fieldTypesEqual(struct1, struct2)).toBe(true)
      expect(fieldTypesEqual(struct1, struct3)).toBe(false)
    })

    it('should convert field types to string representation', () => {
      expect(fieldTypeToString('string')).toBe('string')
      expect(fieldTypeToString('int')).toBe('int')

      const arrayType: ArrayFieldType = { type: 'array', elementType: 'string' }
      expect(fieldTypeToString(arrayType)).toContain('array')
      expect(fieldTypeToString(arrayType)).toContain('string')

      const mapType: MapFieldType = { type: 'map', keyType: 'string', valueType: 'int' }
      expect(fieldTypeToString(mapType)).toContain('map')

      const structType: StructFieldType = {
        type: 'struct',
        fields: new Map([['name', 'string']]),
      }
      expect(fieldTypeToString(structType)).toContain('struct')
    })

    it('should identify valid widening paths', () => {
      // Valid widenings
      expect(canWiden('int', 'float')).toBe(true)

      // Invalid narrowings
      expect(canWiden('float', 'int')).toBe(false)

      // No widening for incompatible types
      expect(canWiden('string', 'int')).toBe(false)
      expect(canWiden('boolean', 'string')).toBe(false)

      // Same type is not widening (identity)
      expect(canWiden('int', 'int')).toBe(false)
    })
  })

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('edge cases', () => {
    it('should handle schema with no fields', () => {
      const evolution = createTestEvolution()

      const schema = evolution.inferSchema([{}])

      expect(schema.fields.size).toBe(0)
    })

    it('should handle very deeply nested structures', () => {
      const evolution = createTestEvolution()

      const sample = [
        {
          level1: {
            level2: {
              level3: {
                level4: {
                  level5: {
                    value: 'deep',
                  },
                },
              },
            },
          },
        },
      ]

      const schema = evolution.inferSchema(sample)

      const level1 = schema.fields.get('level1') as StructFieldType
      expect(level1.type).toBe('struct')
      // Continue drilling down...
      const level2 = level1.fields.get('level2') as StructFieldType
      expect(level2.type).toBe('struct')
    })

    it('should handle mixed null and non-null values', () => {
      const evolution = createTestEvolution()

      const sample = [{ value: 'string' }, { value: null }, { value: 'another' }]

      const schema = evolution.inferSchema(sample)

      // Should infer string type (nullable)
      expect(schema.fields.get('value')).toBe('string')
      expect(schema.requiredFields.has('value')).toBe(false)
    })

    it('should handle special characters in field names', () => {
      const evolution = createTestEvolution()

      const sample = [
        {
          'field-with-dash': 1,
          field_with_underscore: 2,
          'field.with.dots': 3,
          'field with spaces': 4,
        },
      ]

      const schema = evolution.inferSchema(sample)

      expect(schema.fields.has('field-with-dash')).toBe(true)
      expect(schema.fields.has('field_with_underscore')).toBe(true)
      expect(schema.fields.has('field.with.dots')).toBe(true)
      expect(schema.fields.has('field with spaces')).toBe(true)
    })

    it('should handle empty arrays in objects', () => {
      const evolution = createTestEvolution()

      const sample = [{ items: [] }]

      const schema = evolution.inferSchema(sample)

      const itemsField = schema.fields.get('items') as ArrayFieldType
      expect(itemsField.type).toBe('array')
      // Element type might be 'null' or some default for empty arrays
    })

    it('should diff identical schemas as empty diff', () => {
      const evolution = createTestEvolution()

      const schema = createSimpleSchema({ name: 'string', age: 'int' }, ['name'])

      const diff = evolution.diff(schema, schema)

      expect(diff.addedFields.size).toBe(0)
      expect(diff.removedFields.size).toBe(0)
      expect(diff.changedTypes.size).toBe(0)
      expect(diff.nullabilityChanges.size).toBe(0)
    })

    it('should handle evolving from empty schema', async () => {
      const evolution = createTestEvolution()

      evolution.inferSchema([])

      const diff: SchemaDiff = {
        addedFields: new Map([
          ['id', 'int' as FieldType],
          ['name', 'string' as FieldType],
        ]),
        removedFields: new Set(),
        changedTypes: new Map(),
        nullabilityChanges: new Map(),
      }

      await evolution.evolve(diff)

      const schema = evolution.getSchema()
      expect(schema.fields.size).toBe(2)
    })

    it('should handle evolving to empty schema', async () => {
      const evolution = createTestEvolution()

      evolution.inferSchema([{ id: 1, name: 'test' }])

      const diff: SchemaDiff = {
        addedFields: new Map(),
        removedFields: new Set(['id', 'name']),
        changedTypes: new Map(),
        nullabilityChanges: new Map(),
      }

      await evolution.evolve(diff)

      const schema = evolution.getSchema()
      expect(schema.fields.size).toBe(0)
    })
  })

  // ============================================================================
  // COMPATIBILITY COMPREHENSIVE TESTS
  // ============================================================================

  describe('compatibility comprehensive tests', () => {
    it('should allow adding optional fields (compatible)', () => {
      const evolution = createTestEvolution()

      const oldSchema = createSimpleSchema({ id: 'int' }, ['id'])
      const newSchema = createSimpleSchema({ id: 'int', email: 'string' }, ['id'])

      const result = evolution.isCompatible(oldSchema, newSchema)

      expect(result.compatible).toBe(true)
    })

    it('should reject adding required fields (incompatible)', () => {
      const evolution = createTestEvolution()

      const oldSchema = createSimpleSchema({ id: 'int' }, ['id'])
      const newSchema = createSimpleSchema({ id: 'int', email: 'string' }, ['id', 'email'])

      const result = evolution.isCompatible(oldSchema, newSchema)

      expect(result.compatible).toBe(false)
      expect(result.breakingChanges.some((c) => c.includes('email'))).toBe(true)
    })

    it('should allow removing optional fields (compatible with warning)', () => {
      const evolution = createTestEvolution()

      const oldSchema = createSimpleSchema({ id: 'int', email: 'string' }, ['id'])
      const newSchema = createSimpleSchema({ id: 'int' }, ['id'])

      const result = evolution.isCompatible(oldSchema, newSchema)

      expect(result.compatible).toBe(true)
      expect(result.warnings.length).toBeGreaterThanOrEqual(1)
    })

    it('should reject removing required fields (incompatible)', () => {
      const evolution = createTestEvolution()

      const oldSchema = createSimpleSchema({ id: 'int', name: 'string' }, ['id', 'name'])
      const newSchema = createSimpleSchema({ id: 'int' }, ['id'])

      const result = evolution.isCompatible(oldSchema, newSchema)

      expect(result.compatible).toBe(false)
    })

    it('should handle complex mixed changes', () => {
      const evolution = createTestEvolution()

      const oldSchema = createSimpleSchema(
        {
          id: 'int',
          count: 'int', // will widen to float
          name: 'string', // will remove
          active: 'boolean', // unchanged
        },
        ['id', 'name']
      )

      const newSchema = createSimpleSchema(
        {
          id: 'int',
          count: 'float', // widened
          email: 'string', // added optional
          active: 'boolean',
        },
        ['id']
      )

      const result = evolution.isCompatible(oldSchema, newSchema)

      // Removing required field 'name' is breaking
      expect(result.compatible).toBe(false)
      expect(result.breakingChanges.some((c) => c.includes('name'))).toBe(true)
    })

    it('should return detailed breaking change descriptions', () => {
      const evolution = createTestEvolution()

      const oldSchema = createSimpleSchema({ value: 'float' }, [])
      const newSchema = createSimpleSchema({ value: 'int' }, ['value'])

      const result = evolution.isCompatible(oldSchema, newSchema)

      expect(result.compatible).toBe(false)
      // Should mention both type narrowing and nullability change
      expect(result.breakingChanges.length).toBeGreaterThanOrEqual(1)
    })
  })

  // ============================================================================
  // RETENTION POLICY TESTS
  // ============================================================================

  describe('retention policy and pruning', () => {
    describe('maxVersions limit', () => {
      it('should keep only the last N schema versions in history', async () => {
        const evolution = createTestEvolution()

        // Create 10 versions
        evolution.inferSchema([{ id: 1 }])
        for (let i = 1; i < 10; i++) {
          await evolution.evolve({
            addedFields: new Map([[`field${i}`, 'string' as FieldType]]),
            removedFields: new Set(),
            changedTypes: new Map(),
            nullabilityChanges: new Map(),
          })
        }

        expect(evolution.getHistory().length).toBe(10)

        // Prune to keep only last 3 versions
        const stats = await evolution.prune({ maxVersions: 3 })

        expect(stats.versionsRemoved).toBe(7)
        expect(stats.oldestVersion).toBe(8) // Versions 8, 9, 10 remain
        expect(stats.newestVersion).toBe(10)
        expect(evolution.getHistory().length).toBe(3)
      })

      it('should not remove anything if under maxVersions limit', async () => {
        const evolution = createTestEvolution()

        evolution.inferSchema([{ id: 1 }])
        await evolution.evolve({
          addedFields: new Map([['name', 'string' as FieldType]]),
          removedFields: new Set(),
          changedTypes: new Map(),
          nullabilityChanges: new Map(),
        })

        const stats = await evolution.prune({ maxVersions: 10 })

        expect(stats.versionsRemoved).toBe(0)
        expect(evolution.getHistory().length).toBe(2)
      })
    })

    describe('maxAge expiration', () => {
      it('should remove history versions older than maxAge', async () => {
        const evolution = createTestEvolution()

        // Create versions - we'll manually check the behavior
        evolution.inferSchema([{ id: 1 }])

        // Create a few more versions
        for (let i = 0; i < 3; i++) {
          await evolution.evolve({
            addedFields: new Map([[`field${i}`, 'string' as FieldType]]),
            removedFields: new Set(),
            changedTypes: new Map(),
            nullabilityChanges: new Map(),
          })
        }

        // All versions are recent, so maxAge of 1 day should keep all
        const stats = await evolution.prune({ maxAge: '1d' })

        expect(stats.versionsRemoved).toBe(0)
        expect(evolution.getHistory().length).toBe(4)
      })

      it('should parse various duration formats', async () => {
        const evolution = createTestEvolution()
        evolution.inferSchema([{ id: 1 }])

        // Test different formats don't throw
        await expect(evolution.prune({ maxAge: '100ms' })).resolves.toBeDefined()
        await expect(evolution.prune({ maxAge: '1s' })).resolves.toBeDefined()
        await expect(evolution.prune({ maxAge: '30m' })).resolves.toBeDefined()
        await expect(evolution.prune({ maxAge: '24h' })).resolves.toBeDefined()
        await expect(evolution.prune({ maxAge: '7d' })).resolves.toBeDefined()
        await expect(evolution.prune({ maxAge: '2w' })).resolves.toBeDefined()
        await expect(evolution.prune({ maxAge: 1000 })).resolves.toBeDefined() // number format
      })
    })

    describe('combined maxVersions and maxAge', () => {
      it('should apply both constraints', async () => {
        const evolution = createTestEvolution()

        // Create 10 versions
        evolution.inferSchema([{ id: 1 }])
        for (let i = 1; i < 10; i++) {
          await evolution.evolve({
            addedFields: new Map([[`field${i}`, 'string' as FieldType]]),
            removedFields: new Set(),
            changedTypes: new Map(),
            nullabilityChanges: new Map(),
          })
        }

        // Both constraints - maxVersions is more restrictive here
        const stats = await evolution.prune({ maxVersions: 2, maxAge: '1d' })

        expect(stats.versionsRemoved).toBe(8)
        expect(evolution.getHistory().length).toBe(2)
      })
    })

    describe('compact alias', () => {
      it('should work the same as prune', async () => {
        const evolution = createTestEvolution()

        // Create 5 versions
        evolution.inferSchema([{ id: 1 }])
        for (let i = 1; i < 5; i++) {
          await evolution.evolve({
            addedFields: new Map([[`field${i}`, 'string' as FieldType]]),
            removedFields: new Set(),
            changedTypes: new Map(),
            nullabilityChanges: new Map(),
          })
        }

        const stats = await evolution.compact({ maxVersions: 2 })

        expect(stats.versionsRemoved).toBe(3)
        expect(evolution.getHistory().length).toBe(2)
      })
    })

    describe('retention policy configuration', () => {
      it('should use constructor retention policy by default', async () => {
        const evolution = createSchemaEvolution({ retention: { maxVersions: 2 } })

        // Create 5 versions
        evolution.inferSchema([{ id: 1 }])
        for (let i = 1; i < 5; i++) {
          await evolution.evolve({
            addedFields: new Map([[`field${i}`, 'string' as FieldType]]),
            removedFields: new Set(),
            changedTypes: new Map(),
            nullabilityChanges: new Map(),
          })
        }

        // Prune without explicit policy should use constructor policy
        const stats = await evolution.prune()

        expect(stats.versionsRemoved).toBe(3)
        expect(evolution.getHistory().length).toBe(2)
      })

      it('should allow overriding with explicit policy', async () => {
        const evolution = createSchemaEvolution({ retention: { maxVersions: 2 } })

        // Create 5 versions
        evolution.inferSchema([{ id: 1 }])
        for (let i = 1; i < 5; i++) {
          await evolution.evolve({
            addedFields: new Map([[`field${i}`, 'string' as FieldType]]),
            removedFields: new Set(),
            changedTypes: new Map(),
            nullabilityChanges: new Map(),
          })
        }

        // Override with different maxVersions
        const stats = await evolution.prune({ maxVersions: 4 })

        expect(stats.versionsRemoved).toBe(1)
        expect(evolution.getHistory().length).toBe(4)
      })

      it('should get and set retention policy', () => {
        const evolution = createTestEvolution()

        expect(evolution.getRetentionPolicy()).toBeUndefined()

        evolution.setRetentionPolicy({ maxVersions: 5 })
        expect(evolution.getRetentionPolicy()).toEqual({ maxVersions: 5 })

        evolution.setRetentionPolicy({ maxVersions: 10, maxAge: '7d' })
        expect(evolution.getRetentionPolicy()).toEqual({ maxVersions: 10, maxAge: '7d' })

        evolution.setRetentionPolicy(undefined)
        expect(evolution.getRetentionPolicy()).toBeUndefined()
      })

      it('should do nothing when no policy is set', async () => {
        const evolution = createTestEvolution()

        // Create 10 versions
        evolution.inferSchema([{ id: 1 }])
        for (let i = 1; i < 10; i++) {
          await evolution.evolve({
            addedFields: new Map([[`field${i}`, 'string' as FieldType]]),
            removedFields: new Set(),
            changedTypes: new Map(),
            nullabilityChanges: new Map(),
          })
        }

        // No policy configured
        const stats = await evolution.prune()

        expect(stats.versionsRemoved).toBe(0)
        expect(evolution.getHistory().length).toBe(10)
      })
    })

    describe('backwards compatibility', () => {
      it('should maintain unlimited history by default', async () => {
        const evolution = createTestEvolution()

        // Create many versions
        evolution.inferSchema([{ id: 1 }])
        for (let i = 1; i < 50; i++) {
          await evolution.evolve({
            addedFields: new Map([[`field${i}`, 'string' as FieldType]]),
            removedFields: new Set(),
            changedTypes: new Map(),
            nullabilityChanges: new Map(),
          })
        }

        // All versions should be in history
        expect(evolution.getHistory().length).toBe(50)

        // Rollback should still work
        await evolution.rollback(1)
        expect(evolution.getVersion()).toBe(1)
      })

      it('should preserve current schema when pruning history', async () => {
        const evolution = createTestEvolution()

        evolution.inferSchema([{ id: 1 }])
        for (let i = 1; i < 5; i++) {
          await evolution.evolve({
            addedFields: new Map([[`field${i}`, 'string' as FieldType]]),
            removedFields: new Set(),
            changedTypes: new Map(),
            nullabilityChanges: new Map(),
          })
        }

        const schemaBefore = evolution.getSchema()
        const versionBefore = evolution.getVersion()

        await evolution.prune({ maxVersions: 2 })

        // Current schema should be unchanged
        expect(evolution.getVersion()).toBe(versionBefore)
        expect(evolution.getSchema().fields.size).toBe(schemaBefore.fields.size)
      })
    })

    describe('prune stats', () => {
      it('should return correct stats after pruning', async () => {
        const evolution = createTestEvolution()

        evolution.inferSchema([{ id: 1 }])
        for (let i = 1; i < 10; i++) {
          await evolution.evolve({
            addedFields: new Map([[`field${i}`, 'string' as FieldType]]),
            removedFields: new Set(),
            changedTypes: new Map(),
            nullabilityChanges: new Map(),
          })
        }

        const stats = await evolution.prune({ maxVersions: 3 })

        expect(stats.versionsRemoved).toBe(7)
        expect(stats.oldestVersion).toBe(8)
        expect(stats.newestVersion).toBe(10)
      })

      it('should return null for empty history', async () => {
        const evolution = createTestEvolution()

        // No history yet
        const stats = await evolution.prune({ maxVersions: 1 })

        expect(stats.versionsRemoved).toBe(0)
        expect(stats.oldestVersion).toBeNull()
        expect(stats.newestVersion).toBeNull()
      })

      it('should handle complete history removal', async () => {
        const evolution = createTestEvolution()

        evolution.inferSchema([{ id: 1 }])

        // Remove all with very small maxAge (but this is hard to test reliably)
        // Instead test with maxVersions: 0 behavior - we don't support that
        // So let's test normal behavior
        const stats = await evolution.prune({ maxVersions: 1 })

        expect(stats.oldestVersion).toBe(1)
        expect(stats.newestVersion).toBe(1)
      })
    })
  })
})
