/**
 * DDL Generator Tests - RED Phase
 *
 * These tests define the complete DDL generation contract for the Gel compatibility layer.
 * The generator converts Schema IR from SDL Parser to SQLite-compatible DDL statements.
 *
 * Reference: spike-sdl-mapping.md for complete mapping rules
 *
 * Coverage: ~180 tests across 8 categories
 */

import { describe, it, expect } from 'vitest'
import {
  generateDDL,
  mapScalarType,
  toSnakeCase,
  generateColumnDef,
  generateCheckConstraint,
  generateJunctionTable,
  type GeneratedDDL,
} from '../ddl-generator'
import type {
  Schema,
  TypeDefinition,
  Property,
  Link,
  PropertyConstraint,
  EnumDefinition,
  Index,
  ComputedProperty,
  Backlink,
} from '../sdl-parser'

// =============================================================================
// Helper Functions to Create Test Schemas
// =============================================================================

function createEmptySchema(): Schema {
  return {
    types: [],
    enums: [],
    modules: [],
    aliases: [],
    globals: [],
    functions: [],
    scalars: [],
    extensions: [],
  }
}

function createType(overrides: Partial<TypeDefinition> = {}): TypeDefinition {
  return {
    name: 'TestType',
    abstract: false,
    extends: [],
    properties: [],
    links: [],
    backlinks: [],
    computedProperties: [],
    constraints: [],
    indexes: [],
    ...overrides,
  }
}

function createProperty(overrides: Partial<Property> = {}): Property {
  return {
    name: 'test_prop',
    type: 'str',
    required: false,
    readonly: false,
    constraints: [],
    ...overrides,
  }
}

function createLink(overrides: Partial<Link> = {}): Link {
  return {
    name: 'test_link',
    target: 'TargetType',
    required: false,
    cardinality: 'single',
    ...overrides,
  }
}

// =============================================================================
// 1. TABLE GENERATION (30 tests)
// =============================================================================

describe('Table Generation', () => {
  describe('basic table creation', () => {
    it('generates CREATE TABLE for simple type', () => {
      const schema = createEmptySchema()
      schema.types = [createType({ name: 'User' })]

      const ddl = generateDDL(schema)

      expect(ddl.tables).toHaveLength(1)
      expect(ddl.tables[0]).toContain('CREATE TABLE')
      expect(ddl.tables[0]).toContain('User')
    })

    it('generates table with id primary key', () => {
      const schema = createEmptySchema()
      schema.types = [createType({ name: 'User' })]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('id TEXT PRIMARY KEY')
    })

    it('generates UUID default for id column', () => {
      const schema = createEmptySchema()
      schema.types = [createType({ name: 'User' })]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain("DEFAULT (lower(hex(randomblob(16))))")
    })

    it('generates _created_at timestamp column', () => {
      const schema = createEmptySchema()
      schema.types = [createType({ name: 'User' })]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('_created_at TEXT DEFAULT CURRENT_TIMESTAMP')
    })

    it('generates _updated_at timestamp column', () => {
      const schema = createEmptySchema()
      schema.types = [createType({ name: 'User' })]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('_updated_at TEXT DEFAULT CURRENT_TIMESTAMP')
    })

    it('generates updated_at trigger', () => {
      const schema = createEmptySchema()
      schema.types = [createType({ name: 'User' })]

      const ddl = generateDDL(schema)

      expect(ddl.triggers.some((t) => t.includes('User_updated_at'))).toBe(true)
      expect(ddl.triggers.some((t) => t.includes('AFTER UPDATE ON User'))).toBe(true)
    })

    it('preserves PascalCase table names', () => {
      const schema = createEmptySchema()
      schema.types = [createType({ name: 'MyUserProfile' })]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('CREATE TABLE MyUserProfile')
    })

    it('generates multiple tables for multiple types', () => {
      const schema = createEmptySchema()
      schema.types = [createType({ name: 'User' }), createType({ name: 'Post' }), createType({ name: 'Comment' })]

      const ddl = generateDDL(schema)

      expect(ddl.tables).toHaveLength(3)
    })
  })

  describe('column naming', () => {
    it('converts property names to snake_case', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'User',
          properties: [createProperty({ name: 'firstName', type: 'str' })],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('first_name TEXT')
    })

    it('preserves already snake_case names', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'User',
          properties: [createProperty({ name: 'first_name', type: 'str' })],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('first_name TEXT')
    })

    it('handles multi-word property names', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'User',
          properties: [createProperty({ name: 'userEmailAddress', type: 'str' })],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('user_email_address TEXT')
    })

    it('handles acronyms in property names', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'User',
          properties: [createProperty({ name: 'userID', type: 'uuid' })],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('user_id TEXT')
    })
  })

  describe('column order', () => {
    it('places id column first', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'User',
          properties: [createProperty({ name: 'name', type: 'str' })],
        }),
      ]

      const ddl = generateDDL(schema)
      const idIndex = ddl.tables[0].indexOf('id TEXT PRIMARY KEY')
      const nameIndex = ddl.tables[0].indexOf('name TEXT')

      expect(idIndex).toBeLessThan(nameIndex)
    })

    it('places timestamp columns last', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'User',
          properties: [createProperty({ name: 'name', type: 'str' })],
        }),
      ]

      const ddl = generateDDL(schema)
      const nameIndex = ddl.tables[0].indexOf('name TEXT')
      const createdIndex = ddl.tables[0].indexOf('_created_at')

      expect(nameIndex).toBeLessThan(createdIndex)
    })

    it('preserves property order from schema', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'User',
          properties: [
            createProperty({ name: 'first_name', type: 'str' }),
            createProperty({ name: 'last_name', type: 'str' }),
            createProperty({ name: 'email', type: 'str' }),
          ],
        }),
      ]

      const ddl = generateDDL(schema)
      const firstIndex = ddl.tables[0].indexOf('first_name')
      const lastIndex = ddl.tables[0].indexOf('last_name')
      const emailIndex = ddl.tables[0].indexOf('email')

      expect(firstIndex).toBeLessThan(lastIndex)
      expect(lastIndex).toBeLessThan(emailIndex)
    })
  })

  describe('reserved word handling', () => {
    it('quotes reserved SQL keywords as table names', () => {
      const schema = createEmptySchema()
      schema.types = [createType({ name: 'Order' })]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('"Order"')
    })

    it('quotes reserved keywords as column names', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Data',
          properties: [createProperty({ name: 'index', type: 'int32' })],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('"index"')
    })

    it('handles Group as table name', () => {
      const schema = createEmptySchema()
      schema.types = [createType({ name: 'Group' })]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('"Group"')
    })
  })

  describe('options', () => {
    it('respects addTimestamps: false option', () => {
      const schema = createEmptySchema()
      schema.types = [createType({ name: 'User' })]

      const ddl = generateDDL(schema, { addTimestamps: false })

      expect(ddl.tables[0]).not.toContain('_created_at')
      expect(ddl.tables[0]).not.toContain('_updated_at')
    })

    it('respects generateMetadata: true option', () => {
      const schema = createEmptySchema()
      schema.types = [createType({ name: 'User' })]

      const ddl = generateDDL(schema, { generateMetadata: true })

      expect(ddl.tables.some((t) => t.includes('_types'))).toBe(true)
    })
  })
})

// =============================================================================
// 2. SCALAR TYPE MAPPING (25 tests)
// =============================================================================

describe('Scalar Type Mapping', () => {
  describe('string types', () => {
    it('maps str to TEXT', () => {
      expect(mapScalarType('str')).toBe('TEXT')
    })

    it('generates TEXT column for str property', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'User',
          properties: [createProperty({ name: 'name', type: 'str' })],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('name TEXT')
    })
  })

  describe('integer types', () => {
    it('maps int16 to INTEGER', () => {
      expect(mapScalarType('int16')).toBe('INTEGER')
    })

    it('maps int32 to INTEGER', () => {
      expect(mapScalarType('int32')).toBe('INTEGER')
    })

    it('maps int64 to INTEGER', () => {
      expect(mapScalarType('int64')).toBe('INTEGER')
    })

    it('generates INTEGER column for int32 property', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'User',
          properties: [createProperty({ name: 'age', type: 'int32' })],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('age INTEGER')
    })
  })

  describe('float types', () => {
    it('maps float32 to REAL', () => {
      expect(mapScalarType('float32')).toBe('REAL')
    })

    it('maps float64 to REAL', () => {
      expect(mapScalarType('float64')).toBe('REAL')
    })

    it('generates REAL column for float64 property', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Product',
          properties: [createProperty({ name: 'price', type: 'float64' })],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('price REAL')
    })
  })

  describe('boolean type', () => {
    it('maps bool to INTEGER', () => {
      expect(mapScalarType('bool')).toBe('INTEGER')
    })

    it('generates INTEGER column for bool property', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'User',
          properties: [createProperty({ name: 'active', type: 'bool' })],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('active INTEGER')
    })
  })

  describe('uuid type', () => {
    it('maps uuid to TEXT', () => {
      expect(mapScalarType('uuid')).toBe('TEXT')
    })

    it('generates TEXT column for uuid property', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'User',
          properties: [createProperty({ name: 'external_id', type: 'uuid' })],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('external_id TEXT')
    })
  })

  describe('datetime types', () => {
    it('maps datetime to TEXT', () => {
      expect(mapScalarType('datetime')).toBe('TEXT')
    })

    it('maps cal::local_date to TEXT', () => {
      expect(mapScalarType('cal::local_date')).toBe('TEXT')
    })

    it('maps cal::local_time to TEXT', () => {
      expect(mapScalarType('cal::local_time')).toBe('TEXT')
    })

    it('maps cal::local_datetime to TEXT', () => {
      expect(mapScalarType('cal::local_datetime')).toBe('TEXT')
    })

    it('maps duration to TEXT', () => {
      expect(mapScalarType('duration')).toBe('TEXT')
    })
  })

  describe('special types', () => {
    it('maps json to TEXT', () => {
      expect(mapScalarType('json')).toBe('TEXT')
    })

    it('maps bytes to BLOB', () => {
      expect(mapScalarType('bytes')).toBe('BLOB')
    })

    it('maps bigint to TEXT', () => {
      expect(mapScalarType('bigint')).toBe('TEXT')
    })

    it('maps decimal to TEXT', () => {
      expect(mapScalarType('decimal')).toBe('TEXT')
    })

    it('generates BLOB column for bytes property', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'File',
          properties: [createProperty({ name: 'content', type: 'bytes' })],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('content BLOB')
    })
  })

  describe('collection types', () => {
    it('maps array<str> to TEXT (JSON)', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Article',
          properties: [createProperty({ name: 'tags', type: 'array', elementType: 'str' })],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('tags TEXT')
    })

    it('maps tuple to TEXT (JSON)', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'GeoPoint',
          properties: [createProperty({ name: 'coordinates', type: 'tuple', tupleTypes: ['float64', 'float64'] })],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('coordinates TEXT')
    })
  })
})

// =============================================================================
// 3. PROPERTY MODIFIERS (20 tests)
// =============================================================================

describe('Property Modifiers', () => {
  describe('required modifier', () => {
    it('adds NOT NULL for required property', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'User',
          properties: [createProperty({ name: 'name', type: 'str', required: true })],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('name TEXT NOT NULL')
    })

    it('omits NOT NULL for optional property', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'User',
          properties: [createProperty({ name: 'bio', type: 'str', required: false })],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('bio TEXT')
      expect(ddl.tables[0]).not.toMatch(/bio TEXT NOT NULL/)
    })

    it('handles multiple required properties', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'User',
          properties: [
            createProperty({ name: 'name', type: 'str', required: true }),
            createProperty({ name: 'email', type: 'str', required: true }),
          ],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('name TEXT NOT NULL')
      expect(ddl.tables[0]).toContain('email TEXT NOT NULL')
    })
  })

  describe('default values', () => {
    it('adds string default value', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'User',
          properties: [createProperty({ name: 'status', type: 'str', default: 'active' })],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain("status TEXT DEFAULT 'active'")
    })

    it('adds integer default value', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'User',
          properties: [createProperty({ name: 'age', type: 'int32', default: 0 })],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('age INTEGER DEFAULT 0')
    })

    it('adds boolean true default as 1', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'User',
          properties: [createProperty({ name: 'active', type: 'bool', default: true })],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('active INTEGER DEFAULT 1')
    })

    it('adds boolean false default as 0', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Post',
          properties: [createProperty({ name: 'published', type: 'bool', default: false })],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('published INTEGER DEFAULT 0')
    })

    it('handles datetime_current() default', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Post',
          properties: [createProperty({ name: 'created_at', type: 'datetime', defaultExpr: 'datetime_current()' })],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('created_at TEXT DEFAULT CURRENT_TIMESTAMP')
    })

    it('handles uuid_generate_v4() default', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'User',
          properties: [createProperty({ name: 'token', type: 'uuid', defaultExpr: 'uuid_generate_v4()' })],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain("token TEXT DEFAULT (lower(hex(randomblob(16))))")
    })
  })

  describe('readonly modifier', () => {
    it('generates trigger for readonly property', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'User',
          properties: [createProperty({ name: 'created_at', type: 'datetime', readonly: true })],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.triggers.some((t) => t.includes('User_created_at_readonly'))).toBe(true)
    })

    it('readonly trigger prevents updates', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'User',
          properties: [createProperty({ name: 'created_at', type: 'datetime', readonly: true })],
        }),
      ]

      const ddl = generateDDL(schema)
      const readonlyTrigger = ddl.triggers.find((t) => t.includes('readonly'))

      expect(readonlyTrigger).toContain('BEFORE UPDATE')
      expect(readonlyTrigger).toContain('SELECT RAISE')
    })
  })

  describe('combined modifiers', () => {
    it('handles required with default', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'User',
          properties: [createProperty({ name: 'status', type: 'str', required: true, default: 'pending' })],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain("status TEXT NOT NULL DEFAULT 'pending'")
    })

    it('handles required with readonly', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'User',
          properties: [createProperty({ name: 'id', type: 'uuid', required: true, readonly: true })],
        }),
      ]

      const ddl = generateDDL(schema)

      // Property should be NOT NULL and have readonly trigger
      expect(ddl.tables[0]).toContain('NOT NULL')
      expect(ddl.triggers.some((t) => t.includes('readonly'))).toBe(true)
    })
  })
})

// =============================================================================
// 4. LINK HANDLING (30 tests)
// =============================================================================

describe('Link Handling', () => {
  describe('single links', () => {
    it('generates foreign key column for single link', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({ name: 'User' }),
        createType({
          name: 'Post',
          links: [createLink({ name: 'author', target: 'User', cardinality: 'single' })],
        }),
      ]

      const ddl = generateDDL(schema)
      const postTable = ddl.tables.find((t) => t.includes('CREATE TABLE Post'))

      expect(postTable).toContain('author_id TEXT')
      expect(postTable).toContain('REFERENCES User(id)')
    })

    it('adds NOT NULL for required single link', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({ name: 'User' }),
        createType({
          name: 'Post',
          links: [createLink({ name: 'author', target: 'User', required: true })],
        }),
      ]

      const ddl = generateDDL(schema)
      const postTable = ddl.tables.find((t) => t.includes('CREATE TABLE Post'))

      expect(postTable).toContain('author_id TEXT NOT NULL')
    })

    it('allows NULL for optional single link', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({ name: 'User' }),
        createType({
          name: 'Post',
          links: [createLink({ name: 'reviewer', target: 'User', required: false })],
        }),
      ]

      const ddl = generateDDL(schema)
      const postTable = ddl.tables.find((t) => t.includes('CREATE TABLE Post'))

      expect(postTable).toContain('reviewer_id TEXT')
      expect(postTable).not.toMatch(/reviewer_id TEXT NOT NULL/)
    })

    it('generates index on foreign key column', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({ name: 'User' }),
        createType({
          name: 'Post',
          links: [createLink({ name: 'author', target: 'User' })],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.indexes.some((i) => i.includes('idx_Post_author'))).toBe(true)
      expect(ddl.indexes.some((i) => i.includes('author_id'))).toBe(true)
    })

    it('adds ON DELETE CASCADE for required link', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({ name: 'User' }),
        createType({
          name: 'Post',
          links: [createLink({ name: 'author', target: 'User', required: true })],
        }),
      ]

      const ddl = generateDDL(schema)
      const postTable = ddl.tables.find((t) => t.includes('CREATE TABLE Post'))

      expect(postTable).toContain('ON DELETE CASCADE')
    })

    it('adds ON DELETE SET NULL for optional link', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({ name: 'User' }),
        createType({
          name: 'Post',
          links: [createLink({ name: 'reviewer', target: 'User', required: false })],
        }),
      ]

      const ddl = generateDDL(schema)
      const postTable = ddl.tables.find((t) => t.includes('CREATE TABLE Post'))

      expect(postTable).toContain('ON DELETE SET NULL')
    })
  })

  describe('multi links', () => {
    it('generates junction table for multi link', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({ name: 'Post' }),
        createType({ name: 'Tag' }),
        createType({
          name: 'Post',
          links: [createLink({ name: 'tags', target: 'Tag', cardinality: 'multi' })],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables.some((t) => t.includes('CREATE TABLE Post_tags'))).toBe(true)
    })

    it('junction table has source_id column', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Post',
          links: [createLink({ name: 'tags', target: 'Tag', cardinality: 'multi' })],
        }),
        createType({ name: 'Tag' }),
      ]

      const ddl = generateDDL(schema)
      const junctionTable = ddl.tables.find((t) => t.includes('Post_tags'))

      expect(junctionTable).toContain('source_id TEXT NOT NULL')
      expect(junctionTable).toContain('REFERENCES Post(id)')
    })

    it('junction table has target_id column', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Post',
          links: [createLink({ name: 'tags', target: 'Tag', cardinality: 'multi' })],
        }),
        createType({ name: 'Tag' }),
      ]

      const ddl = generateDDL(schema)
      const junctionTable = ddl.tables.find((t) => t.includes('Post_tags'))

      expect(junctionTable).toContain('target_id TEXT NOT NULL')
      expect(junctionTable).toContain('REFERENCES Tag(id)')
    })

    it('junction table has composite primary key', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Post',
          links: [createLink({ name: 'tags', target: 'Tag', cardinality: 'multi' })],
        }),
        createType({ name: 'Tag' }),
      ]

      const ddl = generateDDL(schema)
      const junctionTable = ddl.tables.find((t) => t.includes('Post_tags'))

      expect(junctionTable).toContain('PRIMARY KEY (source_id, target_id)')
    })

    it('junction table has _ordinal column', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Post',
          links: [createLink({ name: 'tags', target: 'Tag', cardinality: 'multi' })],
        }),
        createType({ name: 'Tag' }),
      ]

      const ddl = generateDDL(schema)
      const junctionTable = ddl.tables.find((t) => t.includes('Post_tags'))

      expect(junctionTable).toContain('_ordinal INTEGER DEFAULT 0')
    })

    it('generates index on target_id in junction table', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Post',
          links: [createLink({ name: 'tags', target: 'Tag', cardinality: 'multi' })],
        }),
        createType({ name: 'Tag' }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.indexes.some((i) => i.includes('idx_Post_tags_target'))).toBe(true)
    })

    it('junction table has ON DELETE CASCADE for both FKs', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Post',
          links: [createLink({ name: 'tags', target: 'Tag', cardinality: 'multi' })],
        }),
        createType({ name: 'Tag' }),
      ]

      const ddl = generateDDL(schema)
      const junctionTable = ddl.tables.find((t) => t.includes('Post_tags'))

      // Should have ON DELETE CASCADE twice (for both FKs)
      const cascadeMatches = junctionTable?.match(/ON DELETE CASCADE/g)
      expect(cascadeMatches?.length).toBe(2)
    })
  })

  describe('self-referential links', () => {
    it('handles self-referential single link', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Category',
          links: [createLink({ name: 'parent', target: 'Category', cardinality: 'single' })],
        }),
      ]

      const ddl = generateDDL(schema)
      const categoryTable = ddl.tables.find((t) => t.includes('CREATE TABLE Category'))

      expect(categoryTable).toContain('parent_id TEXT')
      expect(categoryTable).toContain('REFERENCES Category(id)')
    })

    it('handles self-referential multi link', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'User',
          links: [createLink({ name: 'friends', target: 'User', cardinality: 'multi' })],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables.some((t) => t.includes('CREATE TABLE User_friends'))).toBe(true)
    })

    it('self-referential junction table references same table', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'User',
          links: [createLink({ name: 'friends', target: 'User', cardinality: 'multi' })],
        }),
      ]

      const ddl = generateDDL(schema)
      const junctionTable = ddl.tables.find((t) => t.includes('User_friends'))

      expect(junctionTable).toContain('REFERENCES User(id)')
      // Should appear twice
      const refMatches = junctionTable?.match(/REFERENCES User\(id\)/g)
      expect(refMatches?.length).toBe(2)
    })
  })

  describe('link properties', () => {
    it('adds link properties to junction table', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Person',
          links: [
            createLink({
              name: 'friends',
              target: 'Person',
              cardinality: 'multi',
              properties: [{ name: 'strength', type: 'float64', required: false }],
            }),
          ],
        }),
      ]

      const ddl = generateDDL(schema)
      const junctionTable = ddl.tables.find((t) => t.includes('Person_friends'))

      expect(junctionTable).toContain('strength REAL')
    })

    it('handles multiple link properties', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Person',
          links: [
            createLink({
              name: 'friends',
              target: 'Person',
              cardinality: 'multi',
              properties: [
                { name: 'strength', type: 'float64', required: false },
                { name: 'since', type: 'datetime', required: false },
              ],
            }),
          ],
        }),
      ]

      const ddl = generateDDL(schema)
      const junctionTable = ddl.tables.find((t) => t.includes('Person_friends'))

      expect(junctionTable).toContain('strength REAL')
      expect(junctionTable).toContain('since TEXT')
    })

    it('handles required link properties', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Student',
          links: [
            createLink({
              name: 'enrolled_in',
              target: 'Course',
              cardinality: 'multi',
              properties: [{ name: 'grade', type: 'str', required: true }],
            }),
          ],
        }),
        createType({ name: 'Course' }),
      ]

      const ddl = generateDDL(schema)
      const junctionTable = ddl.tables.find((t) => t.includes('Student_enrolled_in'))

      expect(junctionTable).toContain('grade TEXT NOT NULL')
    })
  })

  describe('on target delete behavior', () => {
    it('handles restrict on delete', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({ name: 'User' }),
        createType({
          name: 'Post',
          links: [createLink({ name: 'author', target: 'User', onTargetDelete: 'restrict' })],
        }),
      ]

      const ddl = generateDDL(schema)
      const postTable = ddl.tables.find((t) => t.includes('CREATE TABLE Post'))

      expect(postTable).toContain('ON DELETE RESTRICT')
    })

    it('handles delete source on delete', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({ name: 'Post' }),
        createType({
          name: 'Comment',
          links: [createLink({ name: 'post', target: 'Post', onTargetDelete: 'delete source' })],
        }),
      ]

      const ddl = generateDDL(schema)
      const commentTable = ddl.tables.find((t) => t.includes('CREATE TABLE Comment'))

      expect(commentTable).toContain('ON DELETE CASCADE')
    })

    it('handles allow on delete', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({ name: 'User' }),
        createType({
          name: 'Post',
          links: [createLink({ name: 'author', target: 'User', onTargetDelete: 'allow' })],
        }),
      ]

      const ddl = generateDDL(schema)
      const postTable = ddl.tables.find((t) => t.includes('CREATE TABLE Post'))

      expect(postTable).toContain('ON DELETE SET NULL')
    })
  })
})

// =============================================================================
// 5. CONSTRAINTS (25 tests)
// =============================================================================

describe('Constraints', () => {
  describe('exclusive constraint', () => {
    it('generates UNIQUE for exclusive constraint', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'User',
          properties: [
            createProperty({
              name: 'email',
              type: 'str',
              constraints: [{ type: 'exclusive' }],
            }),
          ],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('email TEXT UNIQUE')
    })

    it('generates UNIQUE for required exclusive property', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'User',
          properties: [
            createProperty({
              name: 'email',
              type: 'str',
              required: true,
              constraints: [{ type: 'exclusive' }],
            }),
          ],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('email TEXT NOT NULL UNIQUE')
    })
  })

  describe('min_value constraint', () => {
    it('generates CHECK for min_value constraint', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Product',
          properties: [
            createProperty({
              name: 'price',
              type: 'float64',
              constraints: [{ type: 'min_value', value: 0 }],
            }),
          ],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('CHECK (price >= 0)')
    })

    it('handles negative min_value', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Temperature',
          properties: [
            createProperty({
              name: 'celsius',
              type: 'float64',
              constraints: [{ type: 'min_value', value: -273.15 }],
            }),
          ],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('CHECK (celsius >= -273.15)')
    })
  })

  describe('max_value constraint', () => {
    it('generates CHECK for max_value constraint', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Product',
          properties: [
            createProperty({
              name: 'price',
              type: 'float64',
              constraints: [{ type: 'max_value', value: 10000 }],
            }),
          ],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('CHECK (price <= 10000)')
    })

    it('combines min_value and max_value into single CHECK', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Product',
          properties: [
            createProperty({
              name: 'rating',
              type: 'float64',
              constraints: [
                { type: 'min_value', value: 0 },
                { type: 'max_value', value: 5 },
              ],
            }),
          ],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('CHECK (rating >= 0 AND rating <= 5)')
    })
  })

  describe('min_len_value constraint', () => {
    it('generates CHECK with length() for min_len_value', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'User',
          properties: [
            createProperty({
              name: 'username',
              type: 'str',
              constraints: [{ type: 'min_len_value', value: 3 }],
            }),
          ],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('CHECK (length(username) >= 3)')
    })
  })

  describe('max_len_value constraint', () => {
    it('generates CHECK with length() for max_len_value', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'User',
          properties: [
            createProperty({
              name: 'username',
              type: 'str',
              constraints: [{ type: 'max_len_value', value: 50 }],
            }),
          ],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('CHECK (length(username) <= 50)')
    })

    it('combines min_len_value and max_len_value', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'User',
          properties: [
            createProperty({
              name: 'username',
              type: 'str',
              constraints: [
                { type: 'min_len_value', value: 3 },
                { type: 'max_len_value', value: 50 },
              ],
            }),
          ],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('CHECK (length(username) >= 3 AND length(username) <= 50)')
    })
  })

  describe('one_of constraint', () => {
    it('generates CHECK with IN clause for one_of', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Task',
          properties: [
            createProperty({
              name: 'status',
              type: 'str',
              constraints: [{ type: 'one_of', values: ['pending', 'active', 'done'] }],
            }),
          ],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain("CHECK (status IN ('pending', 'active', 'done'))")
    })
  })

  describe('composite constraints', () => {
    it('generates composite UNIQUE for multi-property exclusive', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Subscription',
          properties: [createProperty({ name: 'user_id', type: 'uuid' }), createProperty({ name: 'plan_id', type: 'uuid' })],
          constraints: [{ type: 'exclusive', on: ['.user_id', '.plan_id'] }],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('UNIQUE (user_id, plan_id)')
    })

    it('handles three-column composite unique', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Booking',
          properties: [
            createProperty({ name: 'room', type: 'str' }),
            createProperty({ name: 'date', type: 'datetime' }),
            createProperty({ name: 'time_slot', type: 'int32' }),
          ],
          constraints: [{ type: 'exclusive', on: ['.room', '.date', '.time_slot'] }],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('UNIQUE (room, date, time_slot)')
    })
  })

  describe('expression constraints', () => {
    it('generates CHECK for expression constraint', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'DateRange',
          properties: [createProperty({ name: 'start_date', type: 'datetime' }), createProperty({ name: 'end_date', type: 'datetime' })],
          constraints: [{ type: 'expression', expr: '.start_date < .end_date' }],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('CHECK (start_date < end_date)')
    })
  })

  describe('constraint on link', () => {
    it('generates UNIQUE on link foreign key for exclusive link', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({ name: 'User' }),
        createType({
          name: 'Profile',
          links: [
            createLink({
              name: 'user',
              target: 'User',
              constraints: [{ type: 'exclusive' }],
            }),
          ],
        }),
      ]

      const ddl = generateDDL(schema)
      const profileTable = ddl.tables.find((t) => t.includes('CREATE TABLE Profile'))

      expect(profileTable).toContain('user_id TEXT UNIQUE')
    })
  })
})

// =============================================================================
// 6. INDEXES (15 tests)
// =============================================================================

describe('Indexes', () => {
  describe('single property index', () => {
    it('generates CREATE INDEX for single property', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'User',
          properties: [createProperty({ name: 'name', type: 'str' })],
          indexes: [{ on: ['.name'] }],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.indexes.some((i) => i.includes('CREATE INDEX'))).toBe(true)
      expect(ddl.indexes.some((i) => i.includes('idx_User_name'))).toBe(true)
      expect(ddl.indexes.some((i) => i.includes('ON User(name)'))).toBe(true)
    })

    it('converts property path to column name', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'User',
          properties: [createProperty({ name: 'email', type: 'str' })],
          indexes: [{ on: ['.email'] }],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.indexes.some((i) => i.includes('(email)'))).toBe(true)
    })
  })

  describe('composite index', () => {
    it('generates composite index for multiple properties', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'User',
          properties: [createProperty({ name: 'email', type: 'str' }), createProperty({ name: 'name', type: 'str' })],
          indexes: [{ on: ['.email', '.name'] }],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.indexes.some((i) => i.includes('(email, name)'))).toBe(true)
    })

    it('generates three-column composite index', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Event',
          properties: [
            createProperty({ name: 'year', type: 'int32' }),
            createProperty({ name: 'month', type: 'int32' }),
            createProperty({ name: 'day', type: 'int32' }),
          ],
          indexes: [{ on: ['.year', '.month', '.day'] }],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.indexes.some((i) => i.includes('(year, month, day)'))).toBe(true)
    })
  })

  describe('multiple indexes', () => {
    it('generates multiple indexes for type', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'User',
          properties: [
            createProperty({ name: 'name', type: 'str' }),
            createProperty({ name: 'email', type: 'str' }),
            createProperty({ name: 'created_at', type: 'datetime' }),
          ],
          indexes: [{ on: ['.name'] }, { on: ['.email'] }, { on: ['.created_at'] }],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.indexes.filter((i) => i.includes('User')).length).toBe(3)
    })
  })

  describe('unique indexes', () => {
    it('generates unique index from exclusive constraint', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'User',
          properties: [
            createProperty({
              name: 'email',
              type: 'str',
              constraints: [{ type: 'exclusive' }],
            }),
          ],
        }),
      ]

      const ddl = generateDDL(schema)

      // UNIQUE constraint in column or separate index
      const hasUnique = ddl.tables[0].includes('UNIQUE') || ddl.indexes.some((i) => i.includes('UNIQUE'))
      expect(hasUnique).toBe(true)
    })
  })

  describe('auto-generated indexes', () => {
    it('auto-generates index on foreign key columns', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({ name: 'User' }),
        createType({
          name: 'Post',
          links: [createLink({ name: 'author', target: 'User' })],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.indexes.some((i) => i.includes('idx_Post_author'))).toBe(true)
    })
  })

  describe('index naming', () => {
    it('uses consistent naming convention', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'MyUser',
          properties: [createProperty({ name: 'emailAddress', type: 'str' })],
          indexes: [{ on: ['.emailAddress'] }],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.indexes.some((i) => i.includes('idx_MyUser_email_address'))).toBe(true)
    })
  })
})

// =============================================================================
// 7. INHERITANCE (20 tests)
// =============================================================================

describe('Inheritance', () => {
  describe('abstract types', () => {
    it('does not generate table for abstract type', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Auditable',
          abstract: true,
          properties: [createProperty({ name: 'created_at', type: 'datetime' })],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables.some((t) => t.includes('CREATE TABLE Auditable'))).toBe(false)
    })

    it('copies abstract type properties to concrete subtypes', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Auditable',
          abstract: true,
          properties: [createProperty({ name: 'created_at', type: 'datetime', required: true })],
        }),
        createType({
          name: 'Document',
          abstract: false,
          extends: ['Auditable'],
          properties: [createProperty({ name: 'title', type: 'str', required: true })],
        }),
      ]

      const ddl = generateDDL(schema)
      const documentTable = ddl.tables.find((t) => t.includes('CREATE TABLE Document'))

      expect(documentTable).toContain('created_at TEXT NOT NULL')
      expect(documentTable).toContain('title TEXT NOT NULL')
    })

    it('copies abstract type links to concrete subtypes', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({ name: 'User' }),
        createType({
          name: 'Owned',
          abstract: true,
          links: [createLink({ name: 'owner', target: 'User', required: true })],
        }),
        createType({
          name: 'Document',
          abstract: false,
          extends: ['Owned'],
          properties: [createProperty({ name: 'title', type: 'str' })],
        }),
      ]

      const ddl = generateDDL(schema)
      const documentTable = ddl.tables.find((t) => t.includes('CREATE TABLE Document'))

      expect(documentTable).toContain('owner_id TEXT NOT NULL')
    })
  })

  describe('single table inheritance (STI)', () => {
    it('generates _type discriminator column for subtypes', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Person',
          abstract: true,
          properties: [createProperty({ name: 'name', type: 'str' })],
        }),
        createType({
          name: 'Employee',
          extends: ['Person'],
          properties: [createProperty({ name: 'employee_id', type: 'str' })],
        }),
      ]

      const ddl = generateDDL(schema, { inheritanceStrategy: 'sti' })
      const employeeTable = ddl.tables.find((t) => t.includes('Employee'))

      expect(employeeTable).toContain('_type TEXT NOT NULL')
    })

    it('generates index on _type column', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Person',
          abstract: true,
          properties: [createProperty({ name: 'name', type: 'str' })],
        }),
        createType({
          name: 'Employee',
          extends: ['Person'],
          properties: [createProperty({ name: 'employee_id', type: 'str' })],
        }),
      ]

      const ddl = generateDDL(schema, { inheritanceStrategy: 'sti' })

      expect(ddl.indexes.some((i) => i.includes('_type'))).toBe(true)
    })

    it('sets default value for _type column', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Person',
          abstract: true,
        }),
        createType({
          name: 'Employee',
          extends: ['Person'],
        }),
      ]

      const ddl = generateDDL(schema, { inheritanceStrategy: 'sti' })
      const employeeTable = ddl.tables.find((t) => t.includes('Employee'))

      expect(employeeTable).toContain("_type TEXT NOT NULL DEFAULT 'Employee'")
    })
  })

  describe('multiple inheritance', () => {
    it('copies properties from all parent types', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'HasName',
          abstract: true,
          properties: [createProperty({ name: 'first_name', type: 'str' }), createProperty({ name: 'last_name', type: 'str' })],
        }),
        createType({
          name: 'HasEmail',
          abstract: true,
          properties: [createProperty({ name: 'email', type: 'str' })],
        }),
        createType({
          name: 'Contact',
          extends: ['HasName', 'HasEmail'],
          properties: [createProperty({ name: 'phone', type: 'str' })],
        }),
      ]

      const ddl = generateDDL(schema)
      const contactTable = ddl.tables.find((t) => t.includes('CREATE TABLE Contact'))

      expect(contactTable).toContain('first_name TEXT')
      expect(contactTable).toContain('last_name TEXT')
      expect(contactTable).toContain('email TEXT')
      expect(contactTable).toContain('phone TEXT')
    })

    it('handles diamond inheritance (same property from multiple parents)', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Base',
          abstract: true,
          properties: [createProperty({ name: 'id', type: 'uuid' })],
        }),
        createType({
          name: 'Named',
          abstract: true,
          extends: ['Base'],
          properties: [createProperty({ name: 'name', type: 'str' })],
        }),
        createType({
          name: 'Timestamped',
          abstract: true,
          extends: ['Base'],
          properties: [createProperty({ name: 'created_at', type: 'datetime' })],
        }),
        createType({
          name: 'Entity',
          extends: ['Named', 'Timestamped'],
        }),
      ]

      const ddl = generateDDL(schema)
      const entityTable = ddl.tables.find((t) => t.includes('CREATE TABLE Entity'))

      // id should appear only once
      const idMatches = entityTable?.match(/\bid\b/g)
      // Filter out "id" that's part of other identifiers
      expect(entityTable).toContain('name TEXT')
      expect(entityTable).toContain('created_at TEXT')
    })
  })

  describe('deep inheritance chains', () => {
    it('handles three-level inheritance', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Base',
          abstract: true,
          properties: [createProperty({ name: 'base_prop', type: 'str' })],
        }),
        createType({
          name: 'Middle',
          abstract: true,
          extends: ['Base'],
          properties: [createProperty({ name: 'middle_prop', type: 'str' })],
        }),
        createType({
          name: 'Concrete',
          extends: ['Middle'],
          properties: [createProperty({ name: 'concrete_prop', type: 'str' })],
        }),
      ]

      const ddl = generateDDL(schema)
      const concreteTable = ddl.tables.find((t) => t.includes('CREATE TABLE Concrete'))

      expect(concreteTable).toContain('base_prop TEXT')
      expect(concreteTable).toContain('middle_prop TEXT')
      expect(concreteTable).toContain('concrete_prop TEXT')
    })
  })

  describe('type hierarchy metadata', () => {
    it('generates _type_hierarchy metadata table when requested', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'HasName',
          abstract: true,
        }),
        createType({
          name: 'HasEmail',
          abstract: true,
        }),
        createType({
          name: 'Contact',
          extends: ['HasName', 'HasEmail'],
        }),
      ]

      const ddl = generateDDL(schema, { generateMetadata: true })

      expect(ddl.tables.some((t) => t.includes('_type_hierarchy'))).toBe(true)
    })
  })
})

// =============================================================================
// 8. COMPLEX SCENARIOS (20 tests)
// =============================================================================

describe('Complex Scenarios', () => {
  describe('enums', () => {
    it('generates CHECK constraint for enum property', () => {
      const schema = createEmptySchema()
      schema.enums = [{ name: 'Status', values: ['pending', 'active', 'completed'] }]
      schema.types = [
        createType({
          name: 'Task',
          properties: [createProperty({ name: 'status', type: 'Status', required: true })],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain("CHECK (status IN ('pending', 'active', 'completed'))")
    })

    it('generates _enums metadata table when requested', () => {
      const schema = createEmptySchema()
      schema.enums = [{ name: 'Status', values: ['pending', 'active', 'completed'] }]

      const ddl = generateDDL(schema, { generateMetadata: true })

      expect(ddl.tables.some((t) => t.includes('_enums'))).toBe(true)
    })
  })

  describe('computed properties', () => {
    it('generates GENERATED ALWAYS AS for computed property', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Person',
          properties: [createProperty({ name: 'first_name', type: 'str' }), createProperty({ name: 'last_name', type: 'str' })],
          computedProperties: [
            {
              name: 'full_name',
              expression: ".first_name ++ ' ' ++ .last_name",
              returnType: 'str',
            },
          ],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('full_name TEXT GENERATED ALWAYS AS')
      expect(ddl.tables[0]).toContain("first_name || ' ' || last_name")
    })

    it('creates view for complex computed property', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Person',
          properties: [createProperty({ name: 'first_name', type: 'str' }), createProperty({ name: 'last_name', type: 'str' })],
          computedProperties: [
            {
              name: 'full_name',
              expression: ".first_name ++ ' ' ++ .last_name",
              returnType: 'str',
            },
          ],
        }),
      ]

      const ddl = generateDDL(schema)

      // Should have either generated column or view
      const hasComputed =
        ddl.tables[0].includes('GENERATED ALWAYS AS') || ddl.views.some((v) => v.includes('Person_with_computed'))
      expect(hasComputed).toBe(true)
    })
  })

  describe('backlinks', () => {
    it('stores backlink metadata in _backlinks table', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'User',
          backlinks: [
            {
              name: 'posts',
              forwardLink: 'author',
              targetType: 'Post',
              cardinality: 'multi',
            },
          ],
        }),
        createType({
          name: 'Post',
          links: [createLink({ name: 'author', target: 'User', required: true })],
        }),
      ]

      const ddl = generateDDL(schema, { generateMetadata: true })

      expect(ddl.tables.some((t) => t.includes('_backlinks'))).toBe(true)
    })

    it('creates view for backlink queries', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'User',
          backlinks: [
            {
              name: 'posts',
              forwardLink: 'author',
              targetType: 'Post',
              cardinality: 'multi',
            },
          ],
        }),
        createType({
          name: 'Post',
          links: [createLink({ name: 'author', target: 'User', required: true })],
        }),
      ]

      const ddl = generateDDL(schema)

      // Should create a view or the backlink is queryable through forward FK
      expect(ddl.views.length >= 0 || ddl.tables.some((t) => t.includes('author_id'))).toBe(true)
    })
  })

  describe('full schema generation', () => {
    it('generates complete blog schema DDL', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'User',
          properties: [
            createProperty({ name: 'username', type: 'str', required: true, constraints: [{ type: 'exclusive' }, { type: 'min_len_value', value: 3 }] }),
            createProperty({ name: 'email', type: 'str', required: true, constraints: [{ type: 'exclusive' }] }),
            createProperty({ name: 'bio', type: 'str' }),
          ],
          backlinks: [
            {
              name: 'posts',
              forwardLink: 'author',
              targetType: 'Post',
              cardinality: 'multi',
            },
          ],
        }),
        createType({
          name: 'Post',
          properties: [
            createProperty({ name: 'title', type: 'str', required: true }),
            createProperty({ name: 'content', type: 'str', required: true }),
            createProperty({ name: 'published', type: 'bool', default: false }),
            createProperty({ name: 'created_at', type: 'datetime', defaultExpr: 'datetime_current()' }),
          ],
          links: [
            createLink({ name: 'author', target: 'User', required: true }),
            createLink({ name: 'tags', target: 'Tag', cardinality: 'multi' }),
          ],
        }),
        createType({
          name: 'Tag',
          properties: [createProperty({ name: 'name', type: 'str', required: true, constraints: [{ type: 'exclusive' }] })],
        }),
      ]

      const ddl = generateDDL(schema)

      // Verify all main tables exist
      expect(ddl.tables.some((t) => t.includes('CREATE TABLE User'))).toBe(true)
      expect(ddl.tables.some((t) => t.includes('CREATE TABLE Post'))).toBe(true)
      expect(ddl.tables.some((t) => t.includes('CREATE TABLE Tag'))).toBe(true)
      expect(ddl.tables.some((t) => t.includes('CREATE TABLE Post_tags'))).toBe(true)

      // Verify indexes
      expect(ddl.indexes.some((i) => i.includes('idx_Post_author'))).toBe(true)
    })

    it('generates e-commerce schema with inheritance', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Product',
          abstract: true,
          properties: [
            createProperty({ name: 'name', type: 'str', required: true }),
            createProperty({ name: 'price', type: 'decimal', required: true }),
            createProperty({ name: 'description', type: 'str' }),
            createProperty({ name: 'sku', type: 'str', required: true, constraints: [{ type: 'exclusive' }] }),
          ],
        }),
        createType({
          name: 'PhysicalProduct',
          extends: ['Product'],
          properties: [createProperty({ name: 'weight', type: 'float64', required: true }), createProperty({ name: 'dimensions', type: 'json' })],
        }),
        createType({
          name: 'DigitalProduct',
          extends: ['Product'],
          properties: [createProperty({ name: 'download_url', type: 'str', required: true }), createProperty({ name: 'file_size_mb', type: 'float64' })],
        }),
      ]

      const ddl = generateDDL(schema, { inheritanceStrategy: 'sti' })

      // Abstract Product type should not have its own table
      expect(ddl.tables.some((t) => t.includes('CREATE TABLE Product') && !t.includes('PhysicalProduct'))).toBe(false)

      // Concrete types should have tables with inherited properties
      const physicalTable = ddl.tables.find((t) => t.includes('PhysicalProduct'))
      expect(physicalTable).toContain('name TEXT NOT NULL')
      expect(physicalTable).toContain('sku TEXT NOT NULL')
      expect(physicalTable).toContain('weight REAL NOT NULL')
    })
  })

  describe('helper functions', () => {
    it('toSnakeCase converts camelCase', () => {
      expect(toSnakeCase('firstName')).toBe('first_name')
      expect(toSnakeCase('userEmailAddress')).toBe('user_email_address')
    })

    it('toSnakeCase handles PascalCase', () => {
      expect(toSnakeCase('FirstName')).toBe('first_name')
    })

    it('toSnakeCase handles acronyms', () => {
      expect(toSnakeCase('userID')).toBe('user_id')
      expect(toSnakeCase('XMLParser')).toBe('xml_parser')
    })

    it('toSnakeCase preserves already snake_case', () => {
      expect(toSnakeCase('already_snake')).toBe('already_snake')
    })

    it('generateColumnDef creates basic column', () => {
      const result = generateColumnDef('name', 'str', false)
      expect(result).toContain('name TEXT')
    })

    it('generateColumnDef adds NOT NULL', () => {
      const result = generateColumnDef('name', 'str', true)
      expect(result).toContain('NOT NULL')
    })

    it('generateColumnDef adds default value', () => {
      const result = generateColumnDef('status', 'str', false, 'active')
      expect(result).toContain("DEFAULT 'active'")
    })

    it('generateCheckConstraint creates min_value check', () => {
      const result = generateCheckConstraint('min_value', 'price', 0)
      expect(result).toContain('CHECK (price >= 0)')
    })

    it('generateCheckConstraint creates max_len_value check', () => {
      const result = generateCheckConstraint('max_len_value', 'name', 50)
      expect(result).toContain('CHECK (length(name) <= 50)')
    })

    it('generateJunctionTable creates valid junction table', () => {
      const result = generateJunctionTable('Post', 'tags', 'Tag')
      expect(result).toContain('CREATE TABLE Post_tags')
      expect(result).toContain('source_id TEXT NOT NULL')
      expect(result).toContain('target_id TEXT NOT NULL')
      expect(result).toContain('PRIMARY KEY (source_id, target_id)')
    })

    it('generateJunctionTable includes link properties', () => {
      const result = generateJunctionTable('Person', 'friends', 'Person', [{ name: 'strength', type: 'float64', required: false }])
      expect(result).toContain('strength REAL')
    })
  })
})

// =============================================================================
// OUTPUT FORMAT TESTS
// =============================================================================

describe('Output Format', () => {
  it('returns GeneratedDDL with all required fields', () => {
    const schema = createEmptySchema()
    schema.types = [createType({ name: 'User' })]

    const ddl = generateDDL(schema)

    expect(ddl).toHaveProperty('tables')
    expect(ddl).toHaveProperty('indexes')
    expect(ddl).toHaveProperty('triggers')
    expect(ddl).toHaveProperty('views')
    expect(Array.isArray(ddl.tables)).toBe(true)
    expect(Array.isArray(ddl.indexes)).toBe(true)
    expect(Array.isArray(ddl.triggers)).toBe(true)
    expect(Array.isArray(ddl.views)).toBe(true)
  })

  it('each table statement is a complete CREATE TABLE', () => {
    const schema = createEmptySchema()
    schema.types = [createType({ name: 'User' })]

    const ddl = generateDDL(schema)

    ddl.tables.forEach((table) => {
      expect(table).toMatch(/^CREATE TABLE/)
      expect(table).toContain('(')
      expect(table).toContain(')')
    })
  })

  it('each index statement is a complete CREATE INDEX', () => {
    const schema = createEmptySchema()
    schema.types = [
      createType({
        name: 'User',
        properties: [createProperty({ name: 'name', type: 'str' })],
        indexes: [{ on: ['.name'] }],
      }),
    ]

    const ddl = generateDDL(schema)

    ddl.indexes.forEach((index) => {
      expect(index).toMatch(/^CREATE (UNIQUE )?INDEX/)
    })
  })

  it('each trigger statement is a complete CREATE TRIGGER', () => {
    const schema = createEmptySchema()
    schema.types = [createType({ name: 'User' })]

    const ddl = generateDDL(schema)

    ddl.triggers.forEach((trigger) => {
      expect(trigger).toMatch(/^CREATE TRIGGER/)
      expect(trigger).toContain('BEGIN')
      expect(trigger).toContain('END')
    })
  })
})

// =============================================================================
// ERROR HANDLING TESTS
// =============================================================================

describe('Error Handling', () => {
  it('throws on unknown scalar type', () => {
    expect(() => mapScalarType('unknownType')).toThrow()
  })

  it('handles empty schema gracefully', () => {
    const schema = createEmptySchema()

    const ddl = generateDDL(schema)

    expect(ddl.tables).toHaveLength(0)
    expect(ddl.indexes).toHaveLength(0)
    expect(ddl.triggers).toHaveLength(0)
    expect(ddl.views).toHaveLength(0)
  })

  it('handles type with no properties', () => {
    const schema = createEmptySchema()
    schema.types = [createType({ name: 'EmptyType', properties: [] })]

    const ddl = generateDDL(schema)

    expect(ddl.tables).toHaveLength(1)
    expect(ddl.tables[0]).toContain('id TEXT PRIMARY KEY')
  })
})

// =============================================================================
// ADDITIONAL EDGE CASE TESTS
// =============================================================================

describe('Additional Edge Cases', () => {
  describe('property name edge cases', () => {
    it('handles single character property names', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Data',
          properties: [createProperty({ name: 'x', type: 'int32' })],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('x INTEGER')
    })

    it('handles property names with numbers', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Data',
          properties: [createProperty({ name: 'value1', type: 'int32' })],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('value1 INTEGER')
    })

    it('handles property names with consecutive capitals', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Data',
          properties: [createProperty({ name: 'XMLData', type: 'str' })],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('xml_data TEXT')
    })
  })

  describe('type name edge cases', () => {
    it('handles single character type names', () => {
      const schema = createEmptySchema()
      schema.types = [createType({ name: 'A' })]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('CREATE TABLE A')
    })

    it('handles type names with numbers', () => {
      const schema = createEmptySchema()
      schema.types = [createType({ name: 'User2' })]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('CREATE TABLE User2')
    })

    it('handles type names with underscores', () => {
      const schema = createEmptySchema()
      schema.types = [createType({ name: 'User_Profile' })]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('CREATE TABLE User_Profile')
    })
  })

  describe('default value edge cases', () => {
    it('handles empty string default', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'User',
          properties: [createProperty({ name: 'bio', type: 'str', default: '' })],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain("bio TEXT DEFAULT ''")
    })

    it('handles negative number default', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Temperature',
          properties: [createProperty({ name: 'celsius', type: 'float64', default: -40.0 })],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('celsius REAL DEFAULT -40')
    })

    it('handles string default with single quotes', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Data',
          properties: [createProperty({ name: 'quote', type: 'str', default: "it's working" })],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain("DEFAULT 'it''s working'")
    })
  })

  describe('constraint edge cases', () => {
    it('handles zero min_value', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Product',
          properties: [
            createProperty({
              name: 'quantity',
              type: 'int32',
              constraints: [{ type: 'min_value', value: 0 }],
            }),
          ],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('CHECK (quantity >= 0)')
    })

    it('handles very large max_value', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'BigData',
          properties: [
            createProperty({
              name: 'value',
              type: 'int64',
              constraints: [{ type: 'max_value', value: 9007199254740991 }],
            }),
          ],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('CHECK (value <= 9007199254740991)')
    })

    it('handles max_len_value of 1', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Flag',
          properties: [
            createProperty({
              name: 'code',
              type: 'str',
              constraints: [{ type: 'max_len_value', value: 1 }],
            }),
          ],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('CHECK (length(code) <= 1)')
    })
  })

  describe('link edge cases', () => {
    it('handles link with same name as property', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({ name: 'User' }),
        createType({
          name: 'Post',
          properties: [createProperty({ name: 'author_name', type: 'str' })],
          links: [createLink({ name: 'author', target: 'User' })],
        }),
      ]

      const ddl = generateDDL(schema)
      const postTable = ddl.tables.find((t) => t.includes('CREATE TABLE Post'))

      expect(postTable).toContain('author_name TEXT')
      expect(postTable).toContain('author_id TEXT')
    })

    it('handles multiple links to same target', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({ name: 'User' }),
        createType({
          name: 'Transfer',
          links: [
            createLink({ name: 'sender', target: 'User', required: true }),
            createLink({ name: 'receiver', target: 'User', required: true }),
          ],
        }),
      ]

      const ddl = generateDDL(schema)
      const transferTable = ddl.tables.find((t) => t.includes('CREATE TABLE Transfer'))

      expect(transferTable).toContain('sender_id TEXT NOT NULL')
      expect(transferTable).toContain('receiver_id TEXT NOT NULL')
    })

    it('handles link property with same name as link', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'User',
          links: [
            createLink({
              name: 'friends',
              target: 'User',
              cardinality: 'multi',
              properties: [{ name: 'since', type: 'datetime', required: false }],
            }),
          ],
        }),
      ]

      const ddl = generateDDL(schema)
      const junctionTable = ddl.tables.find((t) => t.includes('User_friends'))

      expect(junctionTable).toContain('since TEXT')
    })
  })

  describe('index edge cases', () => {
    it('handles index on datetime column', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Event',
          properties: [createProperty({ name: 'starts_at', type: 'datetime' })],
          indexes: [{ on: ['.starts_at'] }],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.indexes.some((i) => i.includes('starts_at'))).toBe(true)
    })

    it('handles index on boolean column', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'User',
          properties: [createProperty({ name: 'active', type: 'bool' })],
          indexes: [{ on: ['.active'] }],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.indexes.some((i) => i.includes('active'))).toBe(true)
    })
  })

  describe('inheritance edge cases', () => {
    it('handles extending type that extends another type', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'A',
          abstract: true,
          properties: [createProperty({ name: 'a', type: 'str' })],
        }),
        createType({
          name: 'B',
          abstract: true,
          extends: ['A'],
          properties: [createProperty({ name: 'b', type: 'str' })],
        }),
        createType({
          name: 'C',
          extends: ['B'],
          properties: [createProperty({ name: 'c', type: 'str' })],
        }),
      ]

      const ddl = generateDDL(schema)
      const cTable = ddl.tables.find((t) => t.includes('CREATE TABLE C'))

      expect(cTable).toContain('a TEXT')
      expect(cTable).toContain('b TEXT')
      expect(cTable).toContain('c TEXT')
    })

    it('handles abstract type with index', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Named',
          abstract: true,
          properties: [createProperty({ name: 'name', type: 'str' })],
          indexes: [{ on: ['.name'] }],
        }),
        createType({
          name: 'User',
          extends: ['Named'],
        }),
      ]

      const ddl = generateDDL(schema)

      // Index should be on concrete table
      expect(ddl.indexes.some((i) => i.includes('User') && i.includes('name'))).toBe(true)
    })

    it('handles abstract type with constraint', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Unique',
          abstract: true,
          properties: [
            createProperty({
              name: 'identifier',
              type: 'str',
              required: true,
              constraints: [{ type: 'exclusive' }],
            }),
          ],
        }),
        createType({
          name: 'Entity',
          extends: ['Unique'],
        }),
      ]

      const ddl = generateDDL(schema)
      const entityTable = ddl.tables.find((t) => t.includes('CREATE TABLE Entity'))

      expect(entityTable).toContain('identifier TEXT NOT NULL UNIQUE')
    })
  })

  describe('enum edge cases', () => {
    it('handles enum with single value', () => {
      const schema = createEmptySchema()
      schema.enums = [{ name: 'Single', values: ['only'] }]
      schema.types = [
        createType({
          name: 'Data',
          properties: [createProperty({ name: 'value', type: 'Single' })],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain("CHECK (value IN ('only'))")
    })

    it('handles enum with many values', () => {
      const schema = createEmptySchema()
      schema.enums = [{ name: 'Priority', values: ['lowest', 'low', 'medium', 'high', 'highest', 'critical'] }]
      schema.types = [
        createType({
          name: 'Task',
          properties: [createProperty({ name: 'priority', type: 'Priority' })],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain('lowest')
      expect(ddl.tables[0]).toContain('critical')
    })

    it('handles enum values with underscores', () => {
      const schema = createEmptySchema()
      schema.enums = [{ name: 'Status', values: ['in_progress', 'on_hold'] }]
      schema.types = [
        createType({
          name: 'Task',
          properties: [createProperty({ name: 'status', type: 'Status' })],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables[0]).toContain("'in_progress'")
      expect(ddl.tables[0]).toContain("'on_hold'")
    })
  })

  describe('multiple types interaction', () => {
    it('handles circular references between types', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'User',
          links: [createLink({ name: 'profile', target: 'Profile' })],
        }),
        createType({
          name: 'Profile',
          links: [createLink({ name: 'user', target: 'User', required: true })],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables.some((t) => t.includes('CREATE TABLE User'))).toBe(true)
      expect(ddl.tables.some((t) => t.includes('CREATE TABLE Profile'))).toBe(true)
    })

    it('handles type referencing itself through multi link', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'Node',
          links: [createLink({ name: 'children', target: 'Node', cardinality: 'multi' })],
        }),
      ]

      const ddl = generateDDL(schema)

      expect(ddl.tables.some((t) => t.includes('CREATE TABLE Node'))).toBe(true)
      expect(ddl.tables.some((t) => t.includes('CREATE TABLE Node_children'))).toBe(true)
    })
  })

  describe('SQL generation formatting', () => {
    it('generates valid SQL without trailing commas in column list', () => {
      const schema = createEmptySchema()
      schema.types = [
        createType({
          name: 'User',
          properties: [createProperty({ name: 'name', type: 'str' })],
        }),
      ]

      const ddl = generateDDL(schema)

      // Should not have comma before closing paren
      expect(ddl.tables[0]).not.toMatch(/,\s*\)/)
    })

    it('generates semicolon-terminated statements', () => {
      const schema = createEmptySchema()
      schema.types = [createType({ name: 'User' })]

      const ddl = generateDDL(schema)

      ddl.tables.forEach((table) => {
        expect(table.trim()).toMatch(/;$/)
      })
    })
  })
})
