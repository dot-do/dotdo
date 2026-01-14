/**
 * Schema Mapping/Transformation Tests
 *
 * TDD RED phase: These tests define the expected behavior for:
 * - Field renaming and aliasing (bidirectional)
 * - Type coercion rules with edge cases
 * - Nested field flattening and unflattening
 * - Computed/derived fields with dependencies
 * - Schema evolution handling (versioned migrations)
 *
 * @module db/primitives/connector-framework/schema-mapper
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  // Schema mapper types
  type SchemaMapping,
  type FieldAlias,
  type CoercionRule,
  type ComputedFieldDef,
  type SchemaVersion,
  type SchemaEvolution,
  type FlattenOptions,
  type UnflattenOptions,
  // Schema mapper functions
  createSchemaMapper,
  type SchemaMapper,
  // Type coercion utilities
  coerceValue,
  registerCoercionRule,
  getCoercionRules,
  // Evolution utilities
  createSchemaEvolution,
  migrateRecord,
  detectSchemaChanges,
  // Flattening utilities
  flattenRecord,
  unflattenRecord,
} from './schema-mapper'

// =============================================================================
// Field Renaming and Aliasing Tests
// =============================================================================

describe('SchemaMapper - Field Renaming and Aliasing', () => {
  describe('basic field renaming', () => {
    it('should rename fields from source to destination schema', () => {
      const mapper = createSchemaMapper({
        mappings: [
          { source: 'id', target: 'user_id' },
          { source: 'email', target: 'email_address' },
        ],
      })

      const input = { id: 1, email: 'test@example.com', name: 'Test' }
      const output = mapper.mapToTarget(input)

      expect(output).toEqual({
        user_id: 1,
        email_address: 'test@example.com',
        name: 'Test',
      })
    })

    it('should rename fields from destination back to source schema', () => {
      const mapper = createSchemaMapper({
        mappings: [
          { source: 'id', target: 'user_id' },
          { source: 'email', target: 'email_address' },
        ],
      })

      const input = { user_id: 1, email_address: 'test@example.com', name: 'Test' }
      const output = mapper.mapToSource(input)

      expect(output).toEqual({
        id: 1,
        email: 'test@example.com',
        name: 'Test',
      })
    })
  })

  describe('field aliases (multiple names for same field)', () => {
    it('should support field aliases for reading', () => {
      const mapper = createSchemaMapper({
        aliases: [
          { canonical: 'email', aliases: ['email_address', 'e-mail', 'emailAddress'] },
          { canonical: 'phone', aliases: ['telephone', 'phone_number', 'phoneNumber'] },
        ],
      })

      // Any alias should map to canonical name
      expect(mapper.mapToTarget({ 'e-mail': 'test@test.com' })).toEqual({ email: 'test@test.com' })
      expect(mapper.mapToTarget({ emailAddress: 'test@test.com' })).toEqual({ email: 'test@test.com' })
      expect(mapper.mapToTarget({ telephone: '555-1234' })).toEqual({ phone: '555-1234' })
    })

    it('should use preferred alias for writing', () => {
      const mapper = createSchemaMapper({
        aliases: [
          { canonical: 'email', aliases: ['email_address', 'e-mail'], preferredAlias: 'email_address' },
        ],
      })

      const output = mapper.mapToSource({ email: 'test@test.com' })
      expect(output).toEqual({ email_address: 'test@test.com' })
    })
  })

  describe('nested field mapping', () => {
    it('should map nested fields using dot notation', () => {
      const mapper = createSchemaMapper({
        mappings: [
          { source: 'user.name', target: 'userName' },
          { source: 'user.profile.avatar', target: 'userAvatar' },
        ],
      })

      const input = {
        user: {
          name: 'John',
          profile: {
            avatar: 'http://example.com/avatar.png',
            bio: 'Developer',
          },
        },
      }

      const output = mapper.mapToTarget(input)

      expect(output.userName).toBe('John')
      expect(output.userAvatar).toBe('http://example.com/avatar.png')
    })

    it('should create nested structure from flat fields', () => {
      const mapper = createSchemaMapper({
        mappings: [
          { source: 'userName', target: 'user.name' },
          { source: 'userEmail', target: 'user.email' },
          { source: 'userCity', target: 'user.address.city' },
        ],
      })

      const input = { userName: 'John', userEmail: 'john@test.com', userCity: 'NYC' }
      const output = mapper.mapToTarget(input)

      expect(output).toEqual({
        user: {
          name: 'John',
          email: 'john@test.com',
          address: {
            city: 'NYC',
          },
        },
      })
    })
  })

  describe('wildcard mappings', () => {
    it('should support wildcard field mappings', () => {
      const mapper = createSchemaMapper({
        mappings: [
          { source: 'metadata.*', target: 'meta.*' },
        ],
      })

      const input = {
        id: 1,
        metadata: {
          created: '2024-01-01',
          updated: '2024-01-02',
          version: 1,
        },
      }

      const output = mapper.mapToTarget(input)

      expect(output).toEqual({
        id: 1,
        meta: {
          created: '2024-01-01',
          updated: '2024-01-02',
          version: 1,
        },
      })
    })
  })

  describe('conditional mappings', () => {
    it('should apply mappings conditionally', () => {
      const mapper = createSchemaMapper({
        mappings: [
          {
            source: 'type',
            target: 'entity_type',
            condition: (record) => record.type !== 'internal',
          },
          {
            source: 'internal_type',
            target: 'entity_type',
            condition: (record) => record.type === 'internal',
          },
        ],
      })

      const publicRecord = { type: 'user', internal_type: null }
      const internalRecord = { type: 'internal', internal_type: 'admin' }

      expect(mapper.mapToTarget(publicRecord).entity_type).toBe('user')
      expect(mapper.mapToTarget(internalRecord).entity_type).toBe('admin')
    })
  })
})

// =============================================================================
// Type Coercion Tests
// =============================================================================

describe('SchemaMapper - Type Coercion', () => {
  describe('basic type coercion', () => {
    it('should coerce string to number', () => {
      expect(coerceValue('42', 'number')).toBe(42)
      expect(coerceValue('3.14', 'number')).toBe(3.14)
      expect(coerceValue('-100', 'number')).toBe(-100)
    })

    it('should coerce string to integer', () => {
      expect(coerceValue('42', 'integer')).toBe(42)
      expect(coerceValue('3.7', 'integer')).toBe(3)
      expect(coerceValue('-100.9', 'integer')).toBe(-100)
    })

    it('should coerce to boolean', () => {
      // Truthy values
      expect(coerceValue('true', 'boolean')).toBe(true)
      expect(coerceValue('TRUE', 'boolean')).toBe(true)
      expect(coerceValue('yes', 'boolean')).toBe(true)
      expect(coerceValue('1', 'boolean')).toBe(true)
      expect(coerceValue(1, 'boolean')).toBe(true)

      // Falsy values
      expect(coerceValue('false', 'boolean')).toBe(false)
      expect(coerceValue('FALSE', 'boolean')).toBe(false)
      expect(coerceValue('no', 'boolean')).toBe(false)
      expect(coerceValue('0', 'boolean')).toBe(false)
      expect(coerceValue(0, 'boolean')).toBe(false)
      expect(coerceValue('', 'boolean')).toBe(false)
      expect(coerceValue(null, 'boolean')).toBe(false)
    })

    it('should coerce to date', () => {
      const result = coerceValue('2024-01-15T10:30:00Z', 'date')
      expect(result).toBeInstanceOf(Date)
      expect((result as Date).toISOString()).toBe('2024-01-15T10:30:00.000Z')
    })

    it('should coerce timestamp to date', () => {
      const timestamp = 1705315800000 // 2024-01-15T10:30:00Z
      const result = coerceValue(timestamp, 'date')
      expect(result).toBeInstanceOf(Date)
      expect((result as Date).getTime()).toBe(timestamp)
    })

    it('should coerce to ISO date string', () => {
      const date = new Date('2024-01-15T10:30:00Z')
      expect(coerceValue(date, 'iso-date')).toBe('2024-01-15')
    })

    it('should coerce to ISO datetime string', () => {
      const date = new Date('2024-01-15T10:30:00Z')
      expect(coerceValue(date, 'iso-datetime')).toBe('2024-01-15T10:30:00.000Z')
    })

    it('should coerce number to string', () => {
      expect(coerceValue(42, 'string')).toBe('42')
      expect(coerceValue(3.14, 'string')).toBe('3.14')
    })

    it('should handle null and undefined', () => {
      expect(coerceValue(null, 'string')).toBe(null)
      expect(coerceValue(undefined, 'string')).toBe(undefined)
      expect(coerceValue(null, 'number')).toBe(null)
      expect(coerceValue(undefined, 'number')).toBe(undefined)
    })
  })

  describe('edge case handling', () => {
    it('should handle NaN when coercing to number', () => {
      const result = coerceValue('not-a-number', 'number')
      expect(result).toBeNaN()
    })

    it('should handle invalid dates', () => {
      const result = coerceValue('invalid-date', 'date')
      expect(result).toBeInstanceOf(Date)
      expect(Number.isNaN((result as Date).getTime())).toBe(true)
    })

    it('should handle array coercion', () => {
      // String to array (split by comma)
      expect(coerceValue('a,b,c', 'array')).toEqual(['a', 'b', 'c'])
      expect(coerceValue('single', 'array')).toEqual(['single'])

      // Already an array
      expect(coerceValue([1, 2, 3], 'array')).toEqual([1, 2, 3])
    })

    it('should handle JSON string coercion', () => {
      expect(coerceValue('{"foo":"bar"}', 'json')).toEqual({ foo: 'bar' })
      expect(coerceValue('[1,2,3]', 'json')).toEqual([1, 2, 3])
    })

    it('should handle invalid JSON gracefully', () => {
      expect(coerceValue('not-json', 'json')).toBe('not-json')
    })
  })

  describe('custom coercion rules', () => {
    it('should register and use custom coercion rules', () => {
      registerCoercionRule('currency', (value) => {
        if (typeof value === 'string') {
          // Remove currency symbols and parse
          const cleaned = value.replace(/[$,]/g, '')
          return parseFloat(cleaned)
        }
        return value
      })

      expect(coerceValue('$1,234.56', 'currency')).toBe(1234.56)
      expect(coerceValue('$99.99', 'currency')).toBe(99.99)
    })

    it('should list available coercion rules', () => {
      const rules = getCoercionRules()
      expect(rules).toContain('string')
      expect(rules).toContain('number')
      expect(rules).toContain('boolean')
      expect(rules).toContain('date')
    })
  })

  describe('schema mapper with coercion', () => {
    it('should apply type coercion during mapping', () => {
      const mapper = createSchemaMapper({
        mappings: [
          { source: 'amount', target: 'amount', coerce: 'number' },
          { source: 'is_active', target: 'isActive', coerce: 'boolean' },
          { source: 'created', target: 'createdAt', coerce: 'date' },
        ],
      })

      const input = {
        amount: '99.99',
        is_active: 'true',
        created: '2024-01-15T10:30:00Z',
      }

      const output = mapper.mapToTarget(input)

      expect(output.amount).toBe(99.99)
      expect(output.isActive).toBe(true)
      expect(output.createdAt).toBeInstanceOf(Date)
    })
  })
})

// =============================================================================
// Nested Field Flattening Tests
// =============================================================================

describe('SchemaMapper - Flattening and Unflattening', () => {
  describe('flattenRecord', () => {
    it('should flatten nested objects with default separator', () => {
      const input = {
        id: 1,
        user: {
          name: 'John',
          address: {
            city: 'NYC',
            zip: '10001',
          },
        },
      }

      const output = flattenRecord(input)

      expect(output).toEqual({
        id: 1,
        user_name: 'John',
        user_address_city: 'NYC',
        user_address_zip: '10001',
      })
    })

    it('should flatten with custom separator', () => {
      const input = {
        user: { name: 'John', email: 'john@test.com' },
      }

      const output = flattenRecord(input, { separator: '.' })

      expect(output).toEqual({
        'user.name': 'John',
        'user.email': 'john@test.com',
      })
    })

    it('should flatten with custom depth limit', () => {
      const input = {
        a: {
          b: {
            c: {
              d: 'deep',
            },
          },
        },
      }

      const output = flattenRecord(input, { maxDepth: 2 })

      expect(output).toEqual({
        a_b: { c: { d: 'deep' } },
      })
    })

    it('should preserve arrays by default', () => {
      const input = {
        tags: ['a', 'b', 'c'],
        nested: { items: [1, 2, 3] },
      }

      const output = flattenRecord(input)

      expect(output).toEqual({
        tags: ['a', 'b', 'c'],
        nested_items: [1, 2, 3],
      })
    })

    it('should optionally flatten arrays', () => {
      const input = {
        tags: ['a', 'b', 'c'],
      }

      const output = flattenRecord(input, { flattenArrays: true })

      expect(output).toEqual({
        'tags_0': 'a',
        'tags_1': 'b',
        'tags_2': 'c',
      })
    })

    it('should handle null and undefined values', () => {
      const input = {
        a: null,
        b: undefined,
        c: { d: null },
      }

      const output = flattenRecord(input)

      expect(output).toEqual({
        a: null,
        b: undefined,
        c_d: null,
      })
    })

    it('should use prefix for all keys', () => {
      const input = { name: 'John', age: 30 }

      const output = flattenRecord(input, { prefix: 'user' })

      expect(output).toEqual({
        user_name: 'John',
        user_age: 30,
      })
    })
  })

  describe('unflattenRecord', () => {
    it('should unflatten with default separator', () => {
      const input = {
        id: 1,
        user_name: 'John',
        user_address_city: 'NYC',
        user_address_zip: '10001',
      }

      const output = unflattenRecord(input)

      expect(output).toEqual({
        id: 1,
        user: {
          name: 'John',
          address: {
            city: 'NYC',
            zip: '10001',
          },
        },
      })
    })

    it('should unflatten with custom separator', () => {
      const input = {
        'user.name': 'John',
        'user.email': 'john@test.com',
      }

      const output = unflattenRecord(input, { separator: '.' })

      expect(output).toEqual({
        user: {
          name: 'John',
          email: 'john@test.com',
        },
      })
    })

    it('should handle array indices in keys', () => {
      const input = {
        'tags_0': 'a',
        'tags_1': 'b',
        'tags_2': 'c',
      }

      const output = unflattenRecord(input, { detectArrays: true })

      expect(output).toEqual({
        tags: ['a', 'b', 'c'],
      })
    })

    it('should roundtrip flatten/unflatten', () => {
      const original = {
        id: 1,
        user: {
          name: 'John',
          address: {
            city: 'NYC',
            zip: '10001',
          },
        },
        metadata: {
          version: 1,
        },
      }

      const flattened = flattenRecord(original)
      const restored = unflattenRecord(flattened)

      expect(restored).toEqual(original)
    })
  })

  describe('schema mapper with flattening', () => {
    it('should flatten nested fields during mapping', () => {
      const mapper = createSchemaMapper({
        flatten: {
          enabled: true,
          separator: '_',
        },
      })

      const input = {
        user: { name: 'John', email: 'john@test.com' },
      }

      expect(mapper.mapToTarget(input)).toEqual({
        user_name: 'John',
        user_email: 'john@test.com',
      })
    })

    it('should unflatten fields during reverse mapping', () => {
      const mapper = createSchemaMapper({
        flatten: {
          enabled: true,
          separator: '_',
        },
      })

      const input = {
        user_name: 'John',
        user_email: 'john@test.com',
      }

      expect(mapper.mapToSource(input)).toEqual({
        user: {
          name: 'John',
          email: 'john@test.com',
        },
      })
    })
  })
})

// =============================================================================
// Computed/Derived Fields Tests
// =============================================================================

describe('SchemaMapper - Computed Fields', () => {
  describe('basic computed fields', () => {
    it('should compute derived fields from source data', () => {
      const mapper = createSchemaMapper({
        computed: [
          {
            name: 'fullName',
            compute: (record) => `${record.firstName} ${record.lastName}`,
          },
        ],
      })

      const input = { firstName: 'John', lastName: 'Doe' }
      const output = mapper.mapToTarget(input)

      expect(output.fullName).toBe('John Doe')
      expect(output.firstName).toBe('John')
      expect(output.lastName).toBe('Doe')
    })

    it('should compute multiple derived fields', () => {
      const mapper = createSchemaMapper({
        computed: [
          {
            name: 'total',
            compute: (r) => (r.price as number) * (r.quantity as number),
          },
          {
            name: 'taxAmount',
            compute: (r) => (r.price as number) * (r.quantity as number) * 0.1,
          },
        ],
      })

      const input = { price: 100, quantity: 2 }
      const output = mapper.mapToTarget(input)

      expect(output.total).toBe(200)
      expect(output.taxAmount).toBe(20)
    })
  })

  describe('computed fields with dependencies', () => {
    it('should compute fields in dependency order', () => {
      const mapper = createSchemaMapper({
        computed: [
          {
            name: 'total',
            compute: (r) => (r.price as number) * (r.quantity as number),
          },
          {
            name: 'totalWithTax',
            compute: (r) => (r.total as number) * 1.1,
            dependsOn: ['total'],
          },
        ],
      })

      const input = { price: 100, quantity: 2 }
      const output = mapper.mapToTarget(input)

      expect(output.total).toBe(200)
      expect(output.totalWithTax).toBeCloseTo(220, 10)
    })

    it('should detect circular dependencies', () => {
      expect(() => createSchemaMapper({
        computed: [
          { name: 'a', compute: (r) => r.b, dependsOn: ['b'] },
          { name: 'b', compute: (r) => r.a, dependsOn: ['a'] },
        ],
      })).toThrow(/circular dependency/i)
    })
  })

  describe('conditional computed fields', () => {
    it('should compute fields conditionally', () => {
      const mapper = createSchemaMapper({
        computed: [
          {
            name: 'discount',
            compute: (r) => (r.total as number) * 0.1,
            condition: (r) => (r.total as number) > 100,
          },
        ],
      })

      expect(mapper.mapToTarget({ total: 50 }).discount).toBeUndefined()
      expect(mapper.mapToTarget({ total: 150 }).discount).toBe(15)
    })
  })

  describe('async computed fields', () => {
    it('should support async computation', async () => {
      const mapper = createSchemaMapper({
        computed: [
          {
            name: 'enrichedData',
            compute: async (record) => {
              // Simulate async lookup
              await new Promise((resolve) => setTimeout(resolve, 1))
              return `enriched_${record.id}`
            },
            async: true,
          },
        ],
      })

      const input = { id: 123 }
      const output = await mapper.mapToTargetAsync(input)

      expect(output.enrichedData).toBe('enriched_123')
    })
  })

  describe('removing computed fields on reverse mapping', () => {
    it('should optionally remove computed fields when mapping back to source', () => {
      const mapper = createSchemaMapper({
        computed: [
          {
            name: 'fullName',
            compute: (r) => `${r.firstName} ${r.lastName}`,
            removeOnReverse: true,
          },
        ],
      })

      const input = { firstName: 'John', lastName: 'Doe', fullName: 'John Doe' }
      const output = mapper.mapToSource(input)

      expect(output.fullName).toBeUndefined()
      expect(output.firstName).toBe('John')
    })
  })
})

// =============================================================================
// Schema Evolution Tests
// =============================================================================

describe('SchemaMapper - Schema Evolution', () => {
  describe('version tracking', () => {
    it('should create schema evolution with versions', () => {
      const evolution = createSchemaEvolution({
        versions: [
          { version: 1, changes: [] },
          {
            version: 2,
            changes: [
              { type: 'rename', from: 'name', to: 'fullName' },
            ],
          },
          {
            version: 3,
            changes: [
              { type: 'add', field: 'email', defaultValue: '' },
              { type: 'remove', field: 'legacyField' },
            ],
          },
        ],
      })

      expect(evolution.currentVersion).toBe(3)
      expect(evolution.versions).toHaveLength(3)
    })
  })

  describe('detecting schema changes', () => {
    it('should detect added fields', () => {
      const oldSchema = { id: 'number', name: 'string' }
      const newSchema = { id: 'number', name: 'string', email: 'string' }

      const changes = detectSchemaChanges(oldSchema, newSchema)

      expect(changes).toContainEqual({ type: 'add', field: 'email' })
    })

    it('should detect removed fields', () => {
      const oldSchema = { id: 'number', name: 'string', legacy: 'string' }
      const newSchema = { id: 'number', name: 'string' }

      const changes = detectSchemaChanges(oldSchema, newSchema)

      expect(changes).toContainEqual({ type: 'remove', field: 'legacy' })
    })

    it('should detect type changes', () => {
      const oldSchema = { id: 'string', name: 'string' }
      const newSchema = { id: 'number', name: 'string' }

      const changes = detectSchemaChanges(oldSchema, newSchema)

      expect(changes).toContainEqual({ type: 'typeChange', field: 'id', from: 'string', to: 'number' })
    })
  })

  describe('migrating records', () => {
    it('should migrate record from old version to new', () => {
      const evolution = createSchemaEvolution({
        versions: [
          { version: 1, changes: [] },
          {
            version: 2,
            changes: [
              { type: 'rename', from: 'name', to: 'fullName' },
            ],
          },
        ],
      })

      const oldRecord = { id: 1, name: 'John Doe', _schemaVersion: 1 }
      const newRecord = migrateRecord(oldRecord, evolution)

      expect(newRecord).toEqual({
        id: 1,
        fullName: 'John Doe',
        _schemaVersion: 2,
      })
    })

    it('should apply default values for added fields', () => {
      const evolution = createSchemaEvolution({
        versions: [
          { version: 1, changes: [] },
          {
            version: 2,
            changes: [
              { type: 'add', field: 'status', defaultValue: 'active' },
            ],
          },
        ],
      })

      const oldRecord = { id: 1, name: 'John', _schemaVersion: 1 }
      const newRecord = migrateRecord(oldRecord, evolution)

      expect(newRecord.status).toBe('active')
    })

    it('should remove deprecated fields', () => {
      const evolution = createSchemaEvolution({
        versions: [
          { version: 1, changes: [] },
          {
            version: 2,
            changes: [
              { type: 'remove', field: 'legacyField' },
            ],
          },
        ],
      })

      const oldRecord = { id: 1, legacyField: 'old', _schemaVersion: 1 }
      const newRecord = migrateRecord(oldRecord, evolution)

      expect(newRecord.legacyField).toBeUndefined()
    })

    it('should apply type coercion during migration', () => {
      const evolution = createSchemaEvolution({
        versions: [
          { version: 1, changes: [] },
          {
            version: 2,
            changes: [
              { type: 'typeChange', field: 'count', from: 'string', to: 'number' },
            ],
          },
        ],
      })

      const oldRecord = { id: 1, count: '42', _schemaVersion: 1 }
      const newRecord = migrateRecord(oldRecord, evolution)

      expect(newRecord.count).toBe(42)
    })

    it('should migrate through multiple versions', () => {
      const evolution = createSchemaEvolution({
        versions: [
          { version: 1, changes: [] },
          {
            version: 2,
            changes: [
              { type: 'rename', from: 'name', to: 'fullName' },
            ],
          },
          {
            version: 3,
            changes: [
              { type: 'add', field: 'email', defaultValue: '' },
            ],
          },
          {
            version: 4,
            changes: [
              { type: 'rename', from: 'fullName', to: 'displayName' },
            ],
          },
        ],
      })

      const oldRecord = { id: 1, name: 'John', _schemaVersion: 1 }
      const newRecord = migrateRecord(oldRecord, evolution)

      expect(newRecord).toEqual({
        id: 1,
        displayName: 'John',
        email: '',
        _schemaVersion: 4,
      })
    })
  })

  describe('schema mapper with evolution', () => {
    it('should auto-migrate records when mapping', () => {
      const mapper = createSchemaMapper({
        evolution: {
          versions: [
            { version: 1, changes: [] },
            {
              version: 2,
              changes: [
                { type: 'rename', from: 'name', to: 'fullName' },
              ],
            },
          ],
        },
      })

      const input = { id: 1, name: 'John', _schemaVersion: 1 }
      const output = mapper.mapToTarget(input)

      expect(output.fullName).toBe('John')
      expect(output.name).toBeUndefined()
    })
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('SchemaMapper - Integration', () => {
  it('should combine all features together', () => {
    const mapper = createSchemaMapper({
      // Field mappings
      mappings: [
        { source: 'firstName', target: 'user.firstName' },
        { source: 'lastName', target: 'user.lastName' },
        { source: 'birthDate', target: 'user.dob', coerce: 'date' },
      ],
      // Aliases
      aliases: [
        { canonical: 'email', aliases: ['emailAddress', 'e-mail'] },
      ],
      // Computed fields
      computed: [
        {
          name: 'user.fullName',
          compute: (r) => `${r.firstName} ${r.lastName}`,
          dependsOn: ['firstName', 'lastName'],
        },
      ],
      // Evolution
      evolution: {
        versions: [
          { version: 1, changes: [] },
          {
            version: 2,
            changes: [
              { type: 'add', field: 'status', defaultValue: 'active' },
            ],
          },
        ],
      },
    })

    const input = {
      firstName: 'John',
      lastName: 'Doe',
      'e-mail': 'john@test.com',
      birthDate: '1990-01-15',
      _schemaVersion: 1,
    }

    const output = mapper.mapToTarget(input)

    expect(output).toMatchObject({
      user: {
        firstName: 'John',
        lastName: 'Doe',
        fullName: 'John Doe',
        dob: expect.any(Date),
      },
      email: 'john@test.com',
      status: 'active',
    })
  })

  it('should handle real-world ETL scenario', () => {
    // Source: Legacy CRM system
    // Target: Modern data warehouse schema
    const mapper = createSchemaMapper({
      mappings: [
        { source: 'CUST_ID', target: 'customer_id' },
        { source: 'CUST_NAME', target: 'customer.name' },
        { source: 'CUST_EMAIL', target: 'customer.email' },
        { source: 'CREATED_DT', target: 'created_at', coerce: 'date' },
        { source: 'IS_ACTIVE', target: 'is_active', coerce: 'boolean' },
        { source: 'TOTAL_ORDERS', target: 'metrics.total_orders', coerce: 'integer' },
        { source: 'TOTAL_SPENT', target: 'metrics.total_spent', coerce: 'number' },
      ],
      computed: [
        {
          name: 'metrics.avg_order_value',
          compute: (r) => {
            const orders = r.TOTAL_ORDERS as number
            const spent = r.TOTAL_SPENT as number
            return orders > 0 ? spent / orders : 0
          },
        },
        {
          name: 'customer.tier',
          compute: (r) => {
            const spent = parseFloat(r.TOTAL_SPENT as string)
            if (spent >= 10000) return 'platinum'
            if (spent >= 5000) return 'gold'
            if (spent >= 1000) return 'silver'
            return 'bronze'
          },
        },
      ],
    })

    const legacyRecord = {
      CUST_ID: 'C123',
      CUST_NAME: 'Acme Corp',
      CUST_EMAIL: 'contact@acme.com',
      CREATED_DT: '2020-01-15',
      IS_ACTIVE: 'Y',
      TOTAL_ORDERS: '150',
      TOTAL_SPENT: '12500.00',
    }

    const warehouseRecord = mapper.mapToTarget(legacyRecord)

    expect(warehouseRecord).toEqual({
      customer_id: 'C123',
      customer: {
        name: 'Acme Corp',
        email: 'contact@acme.com',
        tier: 'platinum',
      },
      created_at: expect.any(Date),
      is_active: true,
      metrics: {
        total_orders: 150,
        total_spent: 12500,
        avg_order_value: expect.closeTo(83.33, 1),
      },
    })
  })
})
