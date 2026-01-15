/**
 * Schema Validation Tests - TDD RED Phase
 *
 * Tests for JSON Schema validation in unified storage, providing:
 * - Schema registration for entity types
 * - Write rejection on validation failure
 * - Schema versioning and migration
 * - Strict vs permissive validation modes
 * - Default values from schema
 * - Schema introspection API
 * - Type coercion
 * - Nested object and array validation
 *
 * These tests WILL FAIL because the SchemaValidator implementation doesn't exist yet.
 * This is the TDD RED phase.
 *
 * Issue: do-z1qe
 * Phase: 5 (Developer Experience)
 *
 * @module tests/unified-storage/schema-validation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================================
// IMPORTS - These MUST FAIL because the implementation doesn't exist yet
// ============================================================================

// This import will fail - the file doesn't exist
import {
  SchemaValidator,
  createSchemaValidator,
  type JSONSchema,
  type SchemaVersion,
  type MigrationPath,
  type ValidationMode,
  type ValidationResult,
  type SchemaIntrospection,
} from '../../objects/unified-storage/schema-validator'

// ============================================================================
// TYPE DEFINITIONS (Expected Interface)
// ============================================================================

/**
 * Thing stored in unified storage
 */
interface Thing {
  $id: string
  $type: string
  $version: number
  $createdAt: number
  $updatedAt: number
  [key: string]: unknown
}

/**
 * Customer entity for schema tests
 */
interface Customer extends Thing {
  $type: 'Customer'
  name: string
  email: string
  age?: number
  tier: 'free' | 'pro' | 'enterprise'
  metadata?: {
    source: string
    tags: string[]
  }
}

/**
 * Order entity for nested object tests
 */
interface Order extends Thing {
  $type: 'Order'
  items: Array<{
    productId: string
    quantity: number
    price: number
  }>
  shippingAddress: {
    street: string
    city: string
    country: string
    postalCode: string
  }
  status: 'pending' | 'processing' | 'shipped' | 'delivered'
}

// ============================================================================
// MOCK STORE
// ============================================================================

interface MockStore {
  things: Map<string, Thing>
  schemas: Map<string, JSONSchema>
  schemaVersions: Map<string, SchemaVersion[]>
  create(thing: Partial<Thing>): Promise<Thing>
  update(id: string, data: Partial<Thing>): Promise<Thing>
}

function createMockStore(): MockStore {
  const things = new Map<string, Thing>()
  const schemas = new Map<string, JSONSchema>()
  const schemaVersions = new Map<string, SchemaVersion[]>()

  return {
    things,
    schemas,
    schemaVersions,
    create: vi.fn(async (thing: Partial<Thing>): Promise<Thing> => {
      const now = Date.now()
      const created: Thing = {
        $id: `${thing.$type?.toLowerCase()}_${crypto.randomUUID()}`,
        $type: thing.$type ?? 'Thing',
        $version: 1,
        $createdAt: now,
        $updatedAt: now,
        ...thing,
      }
      things.set(created.$id, created)
      return created
    }),
    update: vi.fn(async (id: string, data: Partial<Thing>): Promise<Thing> => {
      const existing = things.get(id)
      if (!existing) throw new Error(`Thing not found: ${id}`)
      const updated = {
        ...existing,
        ...data,
        $version: existing.$version + 1,
        $updatedAt: Date.now(),
      }
      things.set(id, updated)
      return updated
    }),
  }
}

// ============================================================================
// TEST DATA
// ============================================================================

const customerSchema: JSONSchema = {
  $id: 'Customer',
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1 },
    email: { type: 'string', format: 'email' },
    age: { type: 'integer', minimum: 0, maximum: 150 },
    tier: { type: 'string', enum: ['free', 'pro', 'enterprise'], default: 'free' },
    metadata: {
      type: 'object',
      properties: {
        source: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  required: ['name', 'email'],
}

const orderSchema: JSONSchema = {
  $id: 'Order',
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    items: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          productId: { type: 'string' },
          quantity: { type: 'integer', minimum: 1 },
          price: { type: 'number', minimum: 0 },
        },
        required: ['productId', 'quantity', 'price'],
      },
    },
    shippingAddress: {
      type: 'object',
      properties: {
        street: { type: 'string' },
        city: { type: 'string' },
        country: { type: 'string', minLength: 2, maxLength: 2 },
        postalCode: { type: 'string' },
      },
      required: ['street', 'city', 'country'],
    },
    status: {
      type: 'string',
      enum: ['pending', 'processing', 'shipped', 'delivered'],
      default: 'pending',
    },
  },
  required: ['items', 'shippingAddress'],
}

// ============================================================================
// 1. SCHEMA REGISTRATION TESTS
// ============================================================================

describe('Schema Registration', () => {
  let store: MockStore
  let validator: SchemaValidator

  beforeEach(() => {
    store = createMockStore()
    validator = createSchemaValidator(store)
  })

  describe('register schema for entity type', () => {
    it('should register a JSON Schema for an entity type', () => {
      validator.register('Customer', customerSchema)

      expect(validator.hasSchema('Customer')).toBe(true)
    })

    it('should return the registered schema', () => {
      validator.register('Customer', customerSchema)

      const schema = validator.getSchema('Customer')

      expect(schema).toBeDefined()
      expect(schema?.$id).toBe('Customer')
    })

    it('should support multiple entity types', () => {
      validator.register('Customer', customerSchema)
      validator.register('Order', orderSchema)

      expect(validator.hasSchema('Customer')).toBe(true)
      expect(validator.hasSchema('Order')).toBe(true)
    })

    it('should throw on registering invalid schema', () => {
      const invalidSchema = {
        type: 'invalid-type', // Invalid JSON Schema type
      } as unknown as JSONSchema

      expect(() => validator.register('Bad', invalidSchema)).toThrow()
    })

    it('should throw on duplicate registration without version', () => {
      validator.register('Customer', customerSchema)

      expect(() => validator.register('Customer', customerSchema)).toThrow()
    })

    it('should list all registered entity types', () => {
      validator.register('Customer', customerSchema)
      validator.register('Order', orderSchema)

      const types = validator.listTypes()

      expect(types).toContain('Customer')
      expect(types).toContain('Order')
      expect(types.length).toBe(2)
    })

    it('should unregister a schema', () => {
      validator.register('Customer', customerSchema)
      expect(validator.hasSchema('Customer')).toBe(true)

      validator.unregister('Customer')

      expect(validator.hasSchema('Customer')).toBe(false)
    })
  })
})

// ============================================================================
// 2. WRITE REJECTION TESTS
// ============================================================================

describe('Write Rejection on Validation Failure', () => {
  let store: MockStore
  let validator: SchemaValidator

  beforeEach(() => {
    store = createMockStore()
    validator = createSchemaValidator(store)
    validator.register('Customer', customerSchema)
    validator.register('Order', orderSchema)
  })

  describe('validate before write', () => {
    it('should reject write with missing required field', async () => {
      const invalidCustomer = {
        $type: 'Customer',
        // missing 'name' and 'email' which are required
        tier: 'pro',
      }

      const result = await validator.validate('Customer', invalidCustomer)

      expect(result.valid).toBe(false)
      expect(result.errors).toBeDefined()
      expect(result.errors?.length).toBeGreaterThan(0)
      expect(result.errors?.some(e => e.path.includes('name'))).toBe(true)
    })

    it('should reject write with invalid field type', async () => {
      const invalidCustomer = {
        $type: 'Customer',
        name: 'Alice',
        email: 'alice@example.com',
        age: 'not-a-number', // should be integer
      }

      const result = await validator.validate('Customer', invalidCustomer)

      expect(result.valid).toBe(false)
      expect(result.errors?.some(e => e.path.includes('age'))).toBe(true)
    })

    it('should reject write with invalid enum value', async () => {
      const invalidCustomer = {
        $type: 'Customer',
        name: 'Alice',
        email: 'alice@example.com',
        tier: 'premium', // invalid enum value
      }

      const result = await validator.validate('Customer', invalidCustomer)

      expect(result.valid).toBe(false)
      expect(result.errors?.some(e => e.message.includes('enum') || e.message.includes('tier'))).toBe(true)
    })

    it('should reject write with invalid email format', async () => {
      const invalidCustomer = {
        $type: 'Customer',
        name: 'Alice',
        email: 'not-an-email',
      }

      const result = await validator.validate('Customer', invalidCustomer)

      expect(result.valid).toBe(false)
      expect(result.errors?.some(e => e.path.includes('email'))).toBe(true)
    })

    it('should reject write with value below minimum', async () => {
      const invalidCustomer = {
        $type: 'Customer',
        name: 'Alice',
        email: 'alice@example.com',
        age: -5, // minimum is 0
      }

      const result = await validator.validate('Customer', invalidCustomer)

      expect(result.valid).toBe(false)
      expect(result.errors?.some(e => e.path.includes('age'))).toBe(true)
    })

    it('should reject write with value above maximum', async () => {
      const invalidCustomer = {
        $type: 'Customer',
        name: 'Alice',
        email: 'alice@example.com',
        age: 200, // maximum is 150
      }

      const result = await validator.validate('Customer', invalidCustomer)

      expect(result.valid).toBe(false)
      expect(result.errors?.some(e => e.path.includes('age'))).toBe(true)
    })

    it('should accept valid data', async () => {
      const validCustomer = {
        $type: 'Customer',
        name: 'Alice',
        email: 'alice@example.com',
        age: 30,
        tier: 'pro',
      }

      const result = await validator.validate('Customer', validCustomer)

      expect(result.valid).toBe(true)
      expect(result.errors).toBeUndefined()
    })

    it('should provide detailed error messages', async () => {
      const invalidCustomer = {
        $type: 'Customer',
        name: '',
        email: 'not-an-email',
        age: -1,
        tier: 'invalid',
      }

      const result = await validator.validate('Customer', invalidCustomer)

      expect(result.valid).toBe(false)
      expect(result.errors?.length).toBeGreaterThanOrEqual(4)

      // Each error should have path, message, and schema location
      for (const error of result.errors ?? []) {
        expect(error.path).toBeDefined()
        expect(error.message).toBeDefined()
        expect(error.message.length).toBeGreaterThan(0)
      }
    })
  })

  describe('validateOrThrow', () => {
    it('should throw SchemaValidationError on invalid data', async () => {
      const invalidCustomer = {
        $type: 'Customer',
        name: 'Alice',
        // missing email
      }

      await expect(validator.validateOrThrow('Customer', invalidCustomer)).rejects.toThrow()
    })

    it('should return validated data on success', async () => {
      const validCustomer = {
        $type: 'Customer',
        name: 'Alice',
        email: 'alice@example.com',
      }

      const validated = await validator.validateOrThrow('Customer', validCustomer)

      expect(validated.name).toBe('Alice')
      expect(validated.email).toBe('alice@example.com')
    })
  })
})

// ============================================================================
// 3. SCHEMA VERSIONING TESTS
// ============================================================================

describe('Schema Versioning', () => {
  let store: MockStore
  let validator: SchemaValidator

  beforeEach(() => {
    store = createMockStore()
    validator = createSchemaValidator(store)
  })

  describe('version tracking', () => {
    it('should track schema version on registration', () => {
      validator.register('Customer', customerSchema, { version: '1.0.0' })

      const version = validator.getVersion('Customer')

      expect(version).toBe('1.0.0')
    })

    it('should auto-generate version if not provided', () => {
      validator.register('Customer', customerSchema)

      const version = validator.getVersion('Customer')

      expect(version).toBeDefined()
      expect(typeof version).toBe('string')
    })

    it('should support semantic versioning', () => {
      validator.register('Customer', customerSchema, { version: '1.0.0' })

      const updatedSchema = {
        ...customerSchema,
        properties: {
          ...customerSchema.properties,
          phone: { type: 'string' }, // new optional field
        },
      }

      validator.register('Customer', updatedSchema, { version: '1.1.0' })

      const version = validator.getVersion('Customer')

      expect(version).toBe('1.1.0')
    })

    it('should list all versions for an entity type', () => {
      validator.register('Customer', customerSchema, { version: '1.0.0' })

      const schemaV2 = {
        ...customerSchema,
        properties: {
          ...customerSchema.properties,
          phone: { type: 'string' },
        },
      }
      validator.register('Customer', schemaV2, { version: '1.1.0' })

      const versions = validator.getVersionHistory('Customer')

      expect(versions).toHaveLength(2)
      expect(versions).toContain('1.0.0')
      expect(versions).toContain('1.1.0')
    })

    it('should get schema for specific version', () => {
      validator.register('Customer', customerSchema, { version: '1.0.0' })

      const schemaV2 = {
        ...customerSchema,
        properties: {
          ...customerSchema.properties,
          phone: { type: 'string' },
        },
      }
      validator.register('Customer', schemaV2, { version: '1.1.0' })

      const oldSchema = validator.getSchema('Customer', '1.0.0')
      const newSchema = validator.getSchema('Customer', '1.1.0')

      expect(oldSchema?.properties?.phone).toBeUndefined()
      expect(newSchema?.properties?.phone).toBeDefined()
    })

    it('should validate against specific schema version', async () => {
      validator.register('Customer', customerSchema, { version: '1.0.0' })

      const schemaV2: JSONSchema = {
        ...customerSchema,
        properties: {
          ...customerSchema.properties,
          phone: { type: 'string' },
        },
        required: [...(customerSchema.required ?? []), 'phone'],
      }
      validator.register('Customer', schemaV2, { version: '2.0.0' })

      const data = {
        $type: 'Customer',
        name: 'Alice',
        email: 'alice@example.com',
        // no phone field
      }

      // Should pass v1.0.0 validation
      const resultV1 = await validator.validate('Customer', data, { version: '1.0.0' })
      expect(resultV1.valid).toBe(true)

      // Should fail v2.0.0 validation (phone required)
      const resultV2 = await validator.validate('Customer', data, { version: '2.0.0' })
      expect(resultV2.valid).toBe(false)
    })
  })
})

// ============================================================================
// 4. MIGRATION PATH TESTS
// ============================================================================

describe('Migration Path Between Schema Versions', () => {
  let store: MockStore
  let validator: SchemaValidator

  beforeEach(() => {
    store = createMockStore()
    validator = createSchemaValidator(store)
  })

  describe('migration registration', () => {
    it('should register migration between versions', () => {
      validator.register('Customer', customerSchema, { version: '1.0.0' })

      const schemaV2 = {
        ...customerSchema,
        properties: {
          ...customerSchema.properties,
          fullName: { type: 'string' }, // renamed from 'name'
        },
        required: ['fullName', 'email'],
      }
      validator.register('Customer', schemaV2, { version: '2.0.0' })

      validator.registerMigration('Customer', '1.0.0', '2.0.0', (data) => ({
        ...data,
        fullName: data.name,
        name: undefined,
      }))

      const migrations = validator.getMigrations('Customer')

      expect(migrations).toHaveLength(1)
      expect(migrations[0].from).toBe('1.0.0')
      expect(migrations[0].to).toBe('2.0.0')
    })

    it('should migrate data from old version to new', async () => {
      validator.register('Customer', customerSchema, { version: '1.0.0' })

      const schemaV2 = {
        ...customerSchema,
        properties: {
          ...customerSchema.properties,
          fullName: { type: 'string' },
        },
      }
      delete (schemaV2.properties as Record<string, unknown>).name
      schemaV2.required = ['fullName', 'email']

      validator.register('Customer', schemaV2, { version: '2.0.0' })

      validator.registerMigration('Customer', '1.0.0', '2.0.0', (data) => ({
        ...data,
        fullName: data.name,
      }))

      const oldData = {
        $type: 'Customer',
        name: 'Alice Smith',
        email: 'alice@example.com',
      }

      const migrated = await validator.migrate('Customer', oldData, '1.0.0', '2.0.0')

      expect(migrated.fullName).toBe('Alice Smith')
    })

    it('should chain migrations for multi-version jumps', async () => {
      // V1: name, email
      validator.register('Customer', customerSchema, { version: '1.0.0' })

      // V2: firstName, lastName, email (split name)
      const schemaV2 = {
        ...customerSchema,
        properties: {
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          email: { type: 'string', format: 'email' },
        },
        required: ['firstName', 'lastName', 'email'],
      }
      validator.register('Customer', schemaV2, { version: '2.0.0' })

      // V3: firstName, lastName, email, displayName (computed)
      const schemaV3 = {
        ...schemaV2,
        properties: {
          ...schemaV2.properties,
          displayName: { type: 'string' },
        },
      }
      validator.register('Customer', schemaV3, { version: '3.0.0' })

      // Register migrations
      validator.registerMigration('Customer', '1.0.0', '2.0.0', (data) => {
        const [firstName, ...rest] = (data.name as string).split(' ')
        return {
          ...data,
          firstName,
          lastName: rest.join(' ') || firstName,
        }
      })

      validator.registerMigration('Customer', '2.0.0', '3.0.0', (data) => ({
        ...data,
        displayName: `${data.firstName} ${data.lastName}`,
      }))

      const v1Data = {
        $type: 'Customer',
        name: 'Alice Smith',
        email: 'alice@example.com',
      }

      const migrated = await validator.migrate('Customer', v1Data, '1.0.0', '3.0.0')

      expect(migrated.firstName).toBe('Alice')
      expect(migrated.lastName).toBe('Smith')
      expect(migrated.displayName).toBe('Alice Smith')
    })

    it('should throw if no migration path exists', async () => {
      validator.register('Customer', customerSchema, { version: '1.0.0' })

      const schemaV3 = { ...customerSchema }
      validator.register('Customer', schemaV3, { version: '3.0.0' })

      // No migration registered for 1.0.0 -> 3.0.0

      const data = {
        $type: 'Customer',
        name: 'Alice',
        email: 'alice@example.com',
      }

      await expect(validator.migrate('Customer', data, '1.0.0', '3.0.0')).rejects.toThrow()
    })

    it('should validate data after migration', async () => {
      validator.register('Customer', customerSchema, { version: '1.0.0' })

      const schemaV2 = {
        ...customerSchema,
        properties: {
          fullName: { type: 'string', minLength: 2 },
          email: { type: 'string', format: 'email' },
        },
        required: ['fullName', 'email'],
      }
      validator.register('Customer', schemaV2, { version: '2.0.0' })

      validator.registerMigration('Customer', '1.0.0', '2.0.0', (data) => ({
        ...data,
        fullName: data.name,
      }))

      const data = {
        $type: 'Customer',
        name: 'A', // Too short for v2 minLength
        email: 'a@example.com',
      }

      // Migration should work, but validation against v2 should fail
      await expect(
        validator.migrateAndValidate('Customer', data, '1.0.0', '2.0.0')
      ).rejects.toThrow()
    })
  })
})

// ============================================================================
// 5. STRICT VS PERMISSIVE MODE TESTS
// ============================================================================

describe('Strict Mode vs Permissive Mode', () => {
  let store: MockStore
  let validator: SchemaValidator

  beforeEach(() => {
    store = createMockStore()
    validator = createSchemaValidator(store)
    validator.register('Customer', customerSchema)
  })

  describe('strict mode', () => {
    it('should reject unknown properties in strict mode', async () => {
      const dataWithExtra = {
        $type: 'Customer',
        name: 'Alice',
        email: 'alice@example.com',
        unknownField: 'should be rejected',
      }

      const result = await validator.validate('Customer', dataWithExtra, { mode: 'strict' })

      expect(result.valid).toBe(false)
      expect(result.errors?.some(e => e.message.includes('additional') || e.message.includes('unknown'))).toBe(true)
    })

    it('should enforce exact type matching in strict mode', async () => {
      const dataWithCoercibleValue = {
        $type: 'Customer',
        name: 'Alice',
        email: 'alice@example.com',
        age: '30', // string instead of integer - should fail strict
      }

      const result = await validator.validate('Customer', dataWithCoercibleValue, { mode: 'strict' })

      expect(result.valid).toBe(false)
    })

    it('should require all optional fields have correct types in strict mode', async () => {
      const dataWithNullOptional = {
        $type: 'Customer',
        name: 'Alice',
        email: 'alice@example.com',
        age: null, // null instead of integer or undefined
      }

      const result = await validator.validate('Customer', dataWithNullOptional, { mode: 'strict' })

      expect(result.valid).toBe(false)
    })
  })

  describe('permissive mode', () => {
    it('should allow unknown properties in permissive mode', async () => {
      const dataWithExtra = {
        $type: 'Customer',
        name: 'Alice',
        email: 'alice@example.com',
        unknownField: 'allowed in permissive',
      }

      const result = await validator.validate('Customer', dataWithExtra, { mode: 'permissive' })

      expect(result.valid).toBe(true)
    })

    it('should strip unknown properties in permissive mode with strip option', async () => {
      const dataWithExtra = {
        $type: 'Customer',
        name: 'Alice',
        email: 'alice@example.com',
        unknownField: 'should be removed',
      }

      const result = await validator.validate('Customer', dataWithExtra, {
        mode: 'permissive',
        stripUnknown: true,
      })

      expect(result.valid).toBe(true)
      expect(result.data?.unknownField).toBeUndefined()
      expect(result.data?.name).toBe('Alice')
    })

    it('should allow coercible types in permissive mode', async () => {
      const dataWithCoercibleValue = {
        $type: 'Customer',
        name: 'Alice',
        email: 'alice@example.com',
        age: '30', // string that can be coerced to integer
      }

      const result = await validator.validate('Customer', dataWithCoercibleValue, {
        mode: 'permissive',
        coerce: true,
      })

      expect(result.valid).toBe(true)
      expect(result.data?.age).toBe(30) // coerced to number
    })
  })

  describe('default mode', () => {
    it('should use permissive mode by default', async () => {
      const dataWithExtra = {
        $type: 'Customer',
        name: 'Alice',
        email: 'alice@example.com',
        extraField: 'value',
      }

      const result = await validator.validate('Customer', dataWithExtra)

      // Default behavior should be permissive
      expect(result.valid).toBe(true)
    })

    it('should support configuring default mode on validator creation', () => {
      const strictValidator = createSchemaValidator(store, { defaultMode: 'strict' })
      strictValidator.register('Customer', customerSchema)

      const dataWithExtra = {
        $type: 'Customer',
        name: 'Alice',
        email: 'alice@example.com',
        extraField: 'value',
      }

      // With strict default, this should fail
      expect(strictValidator.validate('Customer', dataWithExtra)).resolves.toMatchObject({
        valid: false,
      })
    })
  })
})

// ============================================================================
// 6. DEFAULT VALUES TESTS
// ============================================================================

describe('Default Values Applied from Schema', () => {
  let store: MockStore
  let validator: SchemaValidator

  beforeEach(() => {
    store = createMockStore()
    validator = createSchemaValidator(store)
    validator.register('Customer', customerSchema)
    validator.register('Order', orderSchema)
  })

  describe('apply defaults', () => {
    it('should apply default value for missing optional field', async () => {
      const data = {
        $type: 'Customer',
        name: 'Alice',
        email: 'alice@example.com',
        // tier is missing, should default to 'free'
      }

      const result = await validator.validate('Customer', data, { applyDefaults: true })

      expect(result.valid).toBe(true)
      expect(result.data?.tier).toBe('free')
    })

    it('should not override explicitly provided values', async () => {
      const data = {
        $type: 'Customer',
        name: 'Alice',
        email: 'alice@example.com',
        tier: 'pro', // explicitly provided
      }

      const result = await validator.validate('Customer', data, { applyDefaults: true })

      expect(result.valid).toBe(true)
      expect(result.data?.tier).toBe('pro')
    })

    it('should apply nested defaults', async () => {
      const schemaWithNestedDefaults: JSONSchema = {
        $id: 'Config',
        type: 'object',
        properties: {
          settings: {
            type: 'object',
            default: {},
            properties: {
              theme: { type: 'string', default: 'light' },
              notifications: { type: 'boolean', default: true },
            },
          },
        },
      }

      validator.register('Config', schemaWithNestedDefaults)

      const data = { $type: 'Config' }

      const result = await validator.validate('Config', data, { applyDefaults: true })

      expect(result.valid).toBe(true)
      expect(result.data?.settings?.theme).toBe('light')
      expect(result.data?.settings?.notifications).toBe(true)
    })

    it('should apply defaults to array items', async () => {
      const data = {
        $type: 'Order',
        items: [
          { productId: 'p1', quantity: 1, price: 10 },
        ],
        shippingAddress: {
          street: '123 Main St',
          city: 'NYC',
          country: 'US',
        },
        // status missing, should default to 'pending'
      }

      const result = await validator.validate('Order', data, { applyDefaults: true })

      expect(result.valid).toBe(true)
      expect(result.data?.status).toBe('pending')
    })

    it('should not apply defaults when option is false', async () => {
      const data = {
        $type: 'Customer',
        name: 'Alice',
        email: 'alice@example.com',
        // tier missing
      }

      const result = await validator.validate('Customer', data, { applyDefaults: false })

      expect(result.valid).toBe(true)
      expect(result.data?.tier).toBeUndefined()
    })
  })
})

// ============================================================================
// 7. SCHEMA INTROSPECTION API TESTS
// ============================================================================

describe('Schema Introspection API', () => {
  let store: MockStore
  let validator: SchemaValidator

  beforeEach(() => {
    store = createMockStore()
    validator = createSchemaValidator(store)
    validator.register('Customer', customerSchema)
    validator.register('Order', orderSchema)
  })

  describe('introspect schema', () => {
    it('should return field names for entity type', () => {
      const introspection = validator.introspect('Customer')

      expect(introspection.fields).toContain('name')
      expect(introspection.fields).toContain('email')
      expect(introspection.fields).toContain('age')
      expect(introspection.fields).toContain('tier')
    })

    it('should return required fields', () => {
      const introspection = validator.introspect('Customer')

      expect(introspection.requiredFields).toContain('name')
      expect(introspection.requiredFields).toContain('email')
      expect(introspection.requiredFields).not.toContain('age')
    })

    it('should return field types', () => {
      const introspection = validator.introspect('Customer')

      expect(introspection.fieldTypes.name).toBe('string')
      expect(introspection.fieldTypes.email).toBe('string')
      expect(introspection.fieldTypes.age).toBe('integer')
      expect(introspection.fieldTypes.tier).toBe('string')
    })

    it('should return field constraints', () => {
      const introspection = validator.introspect('Customer')

      expect(introspection.constraints.name?.minLength).toBe(1)
      expect(introspection.constraints.email?.format).toBe('email')
      expect(introspection.constraints.age?.minimum).toBe(0)
      expect(introspection.constraints.age?.maximum).toBe(150)
      expect(introspection.constraints.tier?.enum).toEqual(['free', 'pro', 'enterprise'])
    })

    it('should return default values', () => {
      const introspection = validator.introspect('Customer')

      expect(introspection.defaults.tier).toBe('free')
    })

    it('should introspect nested object structures', () => {
      const introspection = validator.introspect('Customer')

      expect(introspection.nestedSchemas?.metadata).toBeDefined()
      expect(introspection.nestedSchemas?.metadata?.fields).toContain('source')
      expect(introspection.nestedSchemas?.metadata?.fields).toContain('tags')
    })

    it('should introspect array item schemas', () => {
      const introspection = validator.introspect('Order')

      expect(introspection.arrayItemSchemas?.items).toBeDefined()
      expect(introspection.arrayItemSchemas?.items?.fields).toContain('productId')
      expect(introspection.arrayItemSchemas?.items?.fields).toContain('quantity')
      expect(introspection.arrayItemSchemas?.items?.fields).toContain('price')
    })

    it('should return JSON Schema representation', () => {
      const introspection = validator.introspect('Customer')

      expect(introspection.jsonSchema).toBeDefined()
      expect(introspection.jsonSchema.$id).toBe('Customer')
    })
  })

  describe('compare schemas', () => {
    it('should detect added fields between versions', () => {
      validator.register('Customer', customerSchema, { version: '1.0.0' })

      const schemaV2 = {
        ...customerSchema,
        properties: {
          ...customerSchema.properties,
          phone: { type: 'string' },
        },
      }
      validator.register('Customer', schemaV2, { version: '2.0.0' })

      const diff = validator.compareVersions('Customer', '1.0.0', '2.0.0')

      expect(diff.addedFields).toContain('phone')
    })

    it('should detect removed fields between versions', () => {
      validator.register('Customer', customerSchema, { version: '1.0.0' })

      const schemaV2 = { ...customerSchema }
      const props = { ...customerSchema.properties }
      delete props.age
      schemaV2.properties = props as JSONSchema['properties']
      validator.register('Customer', schemaV2, { version: '2.0.0' })

      const diff = validator.compareVersions('Customer', '1.0.0', '2.0.0')

      expect(diff.removedFields).toContain('age')
    })

    it('should detect changed field types', () => {
      validator.register('Customer', customerSchema, { version: '1.0.0' })

      const schemaV2 = {
        ...customerSchema,
        properties: {
          ...customerSchema.properties,
          age: { type: 'string' }, // changed from integer to string
        },
      }
      validator.register('Customer', schemaV2, { version: '2.0.0' })

      const diff = validator.compareVersions('Customer', '1.0.0', '2.0.0')

      expect(diff.changedFields).toContainEqual(
        expect.objectContaining({
          field: 'age',
          from: 'integer',
          to: 'string',
        })
      )
    })

    it('should identify breaking changes', () => {
      validator.register('Customer', customerSchema, { version: '1.0.0' })

      const schemaV2 = {
        ...customerSchema,
        required: [...(customerSchema.required ?? []), 'age'], // age now required
      }
      validator.register('Customer', schemaV2, { version: '2.0.0' })

      const diff = validator.compareVersions('Customer', '1.0.0', '2.0.0')

      expect(diff.breaking).toBe(true)
      expect(diff.breakingChanges).toContainEqual(
        expect.objectContaining({
          type: 'required_field_added',
          field: 'age',
        })
      )
    })
  })
})

// ============================================================================
// 8. TYPE COERCION TESTS
// ============================================================================

describe('Type Coercion Based on Schema', () => {
  let store: MockStore
  let validator: SchemaValidator

  beforeEach(() => {
    store = createMockStore()
    validator = createSchemaValidator(store)
    validator.register('Customer', customerSchema)
  })

  describe('coerce types', () => {
    it('should coerce string to integer', async () => {
      const data = {
        $type: 'Customer',
        name: 'Alice',
        email: 'alice@example.com',
        age: '30',
      }

      const result = await validator.validate('Customer', data, { coerce: true })

      expect(result.valid).toBe(true)
      expect(result.data?.age).toBe(30)
      expect(typeof result.data?.age).toBe('number')
    })

    it('should coerce string to number', async () => {
      const schemaWithNumber: JSONSchema = {
        $id: 'Product',
        type: 'object',
        properties: {
          price: { type: 'number' },
        },
      }
      validator.register('Product', schemaWithNumber)

      const data = {
        $type: 'Product',
        price: '19.99',
      }

      const result = await validator.validate('Product', data, { coerce: true })

      expect(result.valid).toBe(true)
      expect(result.data?.price).toBe(19.99)
    })

    it('should coerce string to boolean', async () => {
      const schemaWithBoolean: JSONSchema = {
        $id: 'Setting',
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
        },
      }
      validator.register('Setting', schemaWithBoolean)

      const data1 = { $type: 'Setting', enabled: 'true' }
      const data2 = { $type: 'Setting', enabled: 'false' }
      const data3 = { $type: 'Setting', enabled: '1' }
      const data4 = { $type: 'Setting', enabled: '0' }

      const result1 = await validator.validate('Setting', data1, { coerce: true })
      const result2 = await validator.validate('Setting', data2, { coerce: true })
      const result3 = await validator.validate('Setting', data3, { coerce: true })
      const result4 = await validator.validate('Setting', data4, { coerce: true })

      expect(result1.data?.enabled).toBe(true)
      expect(result2.data?.enabled).toBe(false)
      expect(result3.data?.enabled).toBe(true)
      expect(result4.data?.enabled).toBe(false)
    })

    it('should coerce number to string', async () => {
      const data = {
        $type: 'Customer',
        name: 12345, // should be coerced to string '12345'
        email: 'alice@example.com',
      }

      const result = await validator.validate('Customer', data, { coerce: true })

      expect(result.valid).toBe(true)
      expect(result.data?.name).toBe('12345')
      expect(typeof result.data?.name).toBe('string')
    })

    it('should coerce ISO date string to Date object when format is date-time', async () => {
      const schemaWithDate: JSONSchema = {
        $id: 'Event',
        type: 'object',
        properties: {
          startTime: { type: 'string', format: 'date-time' },
        },
      }
      validator.register('Event', schemaWithDate)

      const data = {
        $type: 'Event',
        startTime: '2024-01-15T10:30:00Z',
      }

      const result = await validator.validate('Event', data, { coerce: true, coerceDates: true })

      expect(result.valid).toBe(true)
      expect(result.data?.startTime).toBeInstanceOf(Date)
    })

    it('should not coerce incompatible types', async () => {
      const data = {
        $type: 'Customer',
        name: 'Alice',
        email: 'alice@example.com',
        age: 'not-a-number',
      }

      const result = await validator.validate('Customer', data, { coerce: true })

      expect(result.valid).toBe(false)
    })

    it('should coerce array item types', async () => {
      const schemaWithTypedArray: JSONSchema = {
        $id: 'Numbers',
        type: 'object',
        properties: {
          values: {
            type: 'array',
            items: { type: 'integer' },
          },
        },
      }
      validator.register('Numbers', schemaWithTypedArray)

      const data = {
        $type: 'Numbers',
        values: ['1', '2', '3'],
      }

      const result = await validator.validate('Numbers', data, { coerce: true })

      expect(result.valid).toBe(true)
      expect(result.data?.values).toEqual([1, 2, 3])
    })
  })
})

// ============================================================================
// 9. NESTED OBJECT VALIDATION TESTS
// ============================================================================

describe('Nested Object Validation', () => {
  let store: MockStore
  let validator: SchemaValidator

  beforeEach(() => {
    store = createMockStore()
    validator = createSchemaValidator(store)
    validator.register('Order', orderSchema)
    validator.register('Customer', customerSchema)
  })

  describe('validate nested objects', () => {
    it('should validate nested object structure', async () => {
      const data = {
        $type: 'Order',
        items: [{ productId: 'p1', quantity: 1, price: 10 }],
        shippingAddress: {
          street: '123 Main St',
          city: 'New York',
          country: 'US',
          postalCode: '10001',
        },
      }

      const result = await validator.validate('Order', data)

      expect(result.valid).toBe(true)
    })

    it('should reject invalid nested object', async () => {
      const data = {
        $type: 'Order',
        items: [{ productId: 'p1', quantity: 1, price: 10 }],
        shippingAddress: {
          street: '123 Main St',
          // missing required 'city' and 'country'
        },
      }

      const result = await validator.validate('Order', data)

      expect(result.valid).toBe(false)
      expect(result.errors?.some(e => e.path.includes('shippingAddress'))).toBe(true)
    })

    it('should report correct path for nested validation errors', async () => {
      const data = {
        $type: 'Order',
        items: [{ productId: 'p1', quantity: 1, price: 10 }],
        shippingAddress: {
          street: '123 Main St',
          city: 'New York',
          country: 'USA', // too long (maxLength: 2)
        },
      }

      const result = await validator.validate('Order', data)

      expect(result.valid).toBe(false)
      const countryError = result.errors?.find(e => e.path.includes('country'))
      expect(countryError).toBeDefined()
      expect(countryError?.path).toContain('shippingAddress')
    })

    it('should validate deeply nested objects', async () => {
      const deepSchema: JSONSchema = {
        $id: 'DeepNested',
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
                      value: { type: 'string', minLength: 1 },
                    },
                    required: ['value'],
                  },
                },
              },
            },
          },
        },
      }
      validator.register('DeepNested', deepSchema)

      const validData = {
        $type: 'DeepNested',
        level1: {
          level2: {
            level3: {
              value: 'deep value',
            },
          },
        },
      }

      const invalidData = {
        $type: 'DeepNested',
        level1: {
          level2: {
            level3: {
              value: '', // empty string fails minLength
            },
          },
        },
      }

      const validResult = await validator.validate('DeepNested', validData)
      const invalidResult = await validator.validate('DeepNested', invalidData)

      expect(validResult.valid).toBe(true)
      expect(invalidResult.valid).toBe(false)
      expect(invalidResult.errors?.[0]?.path).toContain('level3')
    })

    it('should validate nested optional objects', async () => {
      const data = {
        $type: 'Customer',
        name: 'Alice',
        email: 'alice@example.com',
        metadata: {
          source: 'web',
          tags: ['vip', 'early-adopter'],
        },
      }

      const result = await validator.validate('Customer', data)

      expect(result.valid).toBe(true)
    })

    it('should accept missing optional nested objects', async () => {
      const data = {
        $type: 'Customer',
        name: 'Alice',
        email: 'alice@example.com',
        // metadata is optional
      }

      const result = await validator.validate('Customer', data)

      expect(result.valid).toBe(true)
    })
  })
})

// ============================================================================
// 10. ARRAY ITEM VALIDATION TESTS
// ============================================================================

describe('Array Item Validation', () => {
  let store: MockStore
  let validator: SchemaValidator

  beforeEach(() => {
    store = createMockStore()
    validator = createSchemaValidator(store)
    validator.register('Order', orderSchema)
    validator.register('Customer', customerSchema)
  })

  describe('validate array items', () => {
    it('should validate array with valid items', async () => {
      const data = {
        $type: 'Order',
        items: [
          { productId: 'p1', quantity: 1, price: 10 },
          { productId: 'p2', quantity: 2, price: 20 },
        ],
        shippingAddress: { street: '123 Main', city: 'NYC', country: 'US' },
      }

      const result = await validator.validate('Order', data)

      expect(result.valid).toBe(true)
    })

    it('should reject array with invalid items', async () => {
      const data = {
        $type: 'Order',
        items: [
          { productId: 'p1', quantity: 1, price: 10 },
          { productId: 'p2', quantity: -1, price: 20 }, // invalid: quantity < 1
        ],
        shippingAddress: { street: '123 Main', city: 'NYC', country: 'US' },
      }

      const result = await validator.validate('Order', data)

      expect(result.valid).toBe(false)
      expect(result.errors?.some(e => e.path.includes('items') && e.path.includes('quantity'))).toBe(true)
    })

    it('should enforce minItems constraint', async () => {
      const data = {
        $type: 'Order',
        items: [], // minItems is 1
        shippingAddress: { street: '123 Main', city: 'NYC', country: 'US' },
      }

      const result = await validator.validate('Order', data)

      expect(result.valid).toBe(false)
      expect(result.errors?.some(e => e.path.includes('items'))).toBe(true)
    })

    it('should enforce maxItems constraint', async () => {
      const schemaWithMaxItems: JSONSchema = {
        $id: 'LimitedArray',
        type: 'object',
        properties: {
          tags: {
            type: 'array',
            items: { type: 'string' },
            maxItems: 3,
          },
        },
      }
      validator.register('LimitedArray', schemaWithMaxItems)

      const data = {
        $type: 'LimitedArray',
        tags: ['a', 'b', 'c', 'd', 'e'], // exceeds maxItems
      }

      const result = await validator.validate('LimitedArray', data)

      expect(result.valid).toBe(false)
    })

    it('should enforce uniqueItems constraint', async () => {
      const schemaWithUniqueItems: JSONSchema = {
        $id: 'UniqueTags',
        type: 'object',
        properties: {
          tags: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
          },
        },
      }
      validator.register('UniqueTags', schemaWithUniqueItems)

      const data = {
        $type: 'UniqueTags',
        tags: ['a', 'b', 'a'], // duplicate 'a'
      }

      const result = await validator.validate('UniqueTags', data)

      expect(result.valid).toBe(false)
    })

    it('should validate array of nested objects', async () => {
      const data = {
        $type: 'Order',
        items: [
          { productId: 'p1', quantity: 1, price: 10 },
          { productId: 'p2' }, // missing required quantity and price
        ],
        shippingAddress: { street: '123 Main', city: 'NYC', country: 'US' },
      }

      const result = await validator.validate('Order', data)

      expect(result.valid).toBe(false)
      const errors = result.errors ?? []
      expect(errors.some(e => e.path.includes('items[1]') || e.path.includes('items.1'))).toBe(true)
    })

    it('should report correct index for array validation errors', async () => {
      const data = {
        $type: 'Order',
        items: [
          { productId: 'p1', quantity: 1, price: 10 },
          { productId: 'p2', quantity: 2, price: 20 },
          { productId: 'p3', quantity: 0, price: 30 }, // invalid: quantity minimum is 1
        ],
        shippingAddress: { street: '123 Main', city: 'NYC', country: 'US' },
      }

      const result = await validator.validate('Order', data)

      expect(result.valid).toBe(false)
      const error = result.errors?.find(e => e.path.includes('quantity'))
      expect(error?.path).toMatch(/items\[2\]|items\.2/)
    })

    it('should validate nested arrays', async () => {
      const schemaWithNestedArrays: JSONSchema = {
        $id: 'Matrix',
        type: 'object',
        properties: {
          grid: {
            type: 'array',
            items: {
              type: 'array',
              items: { type: 'integer' },
            },
          },
        },
      }
      validator.register('Matrix', schemaWithNestedArrays)

      const validData = {
        $type: 'Matrix',
        grid: [[1, 2], [3, 4], [5, 6]],
      }

      const invalidData = {
        $type: 'Matrix',
        grid: [[1, 2], [3, 'not-a-number'], [5, 6]],
      }

      const validResult = await validator.validate('Matrix', validData)
      const invalidResult = await validator.validate('Matrix', invalidData)

      expect(validResult.valid).toBe(true)
      expect(invalidResult.valid).toBe(false)
    })

    it('should validate array of strings with pattern', async () => {
      const schemaWithPattern: JSONSchema = {
        $id: 'Emails',
        type: 'object',
        properties: {
          addresses: {
            type: 'array',
            items: {
              type: 'string',
              format: 'email',
            },
          },
        },
      }
      validator.register('Emails', schemaWithPattern)

      const validData = {
        $type: 'Emails',
        addresses: ['a@b.com', 'c@d.org'],
      }

      const invalidData = {
        $type: 'Emails',
        addresses: ['a@b.com', 'not-an-email'],
      }

      const validResult = await validator.validate('Emails', validData)
      const invalidResult = await validator.validate('Emails', invalidData)

      expect(validResult.valid).toBe(true)
      expect(invalidResult.valid).toBe(false)
    })

    it('should validate customer metadata tags array', async () => {
      const dataWithValidTags = {
        $type: 'Customer',
        name: 'Alice',
        email: 'alice@example.com',
        metadata: {
          source: 'web',
          tags: ['vip', 'returning'],
        },
      }

      const dataWithInvalidTags = {
        $type: 'Customer',
        name: 'Alice',
        email: 'alice@example.com',
        metadata: {
          source: 'web',
          tags: ['vip', 123], // 123 is not a string
        },
      }

      const validResult = await validator.validate('Customer', dataWithValidTags)
      const invalidResult = await validator.validate('Customer', dataWithInvalidTags)

      expect(validResult.valid).toBe(true)
      expect(invalidResult.valid).toBe(false)
    })
  })
})

// ============================================================================
// EDGE CASES AND ERROR HANDLING
// ============================================================================

describe('Edge Cases and Error Handling', () => {
  let store: MockStore
  let validator: SchemaValidator

  beforeEach(() => {
    store = createMockStore()
    validator = createSchemaValidator(store)
    validator.register('Customer', customerSchema)
  })

  it('should handle null input gracefully', async () => {
    const result = await validator.validate('Customer', null)

    expect(result.valid).toBe(false)
  })

  it('should handle undefined input gracefully', async () => {
    const result = await validator.validate('Customer', undefined)

    expect(result.valid).toBe(false)
  })

  it('should handle validation for unregistered schema', async () => {
    const result = await validator.validate('UnknownType', { name: 'test' })

    expect(result.valid).toBe(false)
    expect(result.errors?.some(e => e.message.includes('not found') || e.message.includes('not registered'))).toBe(true)
  })

  it('should handle circular references in data', async () => {
    const circularData: Record<string, unknown> = {
      $type: 'Customer',
      name: 'Alice',
      email: 'alice@example.com',
    }
    circularData.self = circularData // circular reference

    // Should handle without stack overflow
    await expect(validator.validate('Customer', circularData)).resolves.toBeDefined()
  })

  it('should handle very large objects', async () => {
    const largeObject = {
      $type: 'Customer',
      name: 'Alice',
      email: 'alice@example.com',
      metadata: {
        source: 'web',
        tags: Array(10000).fill('tag'),
      },
    }

    const result = await validator.validate('Customer', largeObject)

    expect(result).toBeDefined()
  })

  it('should handle schema with $ref references', async () => {
    const schemaWithRef: JSONSchema = {
      $id: 'WithRef',
      type: 'object',
      properties: {
        address: { $ref: '#/$defs/Address' },
      },
      $defs: {
        Address: {
          type: 'object',
          properties: {
            street: { type: 'string' },
            city: { type: 'string' },
          },
          required: ['street', 'city'],
        },
      },
    }

    validator.register('WithRef', schemaWithRef)

    const validData = {
      $type: 'WithRef',
      address: { street: '123 Main', city: 'NYC' },
    }

    const result = await validator.validate('WithRef', validData)

    expect(result.valid).toBe(true)
  })
})
