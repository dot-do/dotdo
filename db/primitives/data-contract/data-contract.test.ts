/**
 * DataContract tests - Schema validation, versioning, and evolution
 *
 * RED phase: These tests define the expected behavior of DataContract.
 * All tests should FAIL until implementation is complete.
 *
 * DataContract provides:
 * - Schema Definition - JSON Schema, TypeScript types, validation
 * - Versioning - semantic versioning, breaking change detection
 * - Evolution - migrations, backwards compatibility checks
 * - Registry - schema catalog, discovery, documentation
 * - Validation - runtime validation with detailed errors
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  DataContract,
  Schema,
  SchemaRegistry,
  createSchema,
  createRegistry,
  ValidationResult,
  CompatibilityCheck,
  SchemaVersion,
  type JSONSchema,
} from './index'

// ============================================================================
// SCHEMA DEFINITION
// ============================================================================

describe('DataContract', () => {
  describe('schema definition', () => {
    it('should create schema from JSON Schema definition', () => {
      const schema = createSchema({
        name: 'user',
        version: '1.0.0',
        schema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string', format: 'email' },
            name: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
          },
          required: ['id', 'email'],
        },
      })

      expect(schema.name).toBe('user')
      expect(schema.version).toBe('1.0.0')
      expect(schema.schema.type).toBe('object')
      expect(schema.schema.properties?.id).toBeDefined()
    })

    it('should create schema with metadata', () => {
      const schema = createSchema({
        name: 'order',
        version: '1.0.0',
        schema: {
          type: 'object',
          properties: {
            orderId: { type: 'string' },
          },
        },
        metadata: {
          description: 'Order schema for e-commerce',
          owner: 'commerce-team',
          namespace: 'core',
          tags: ['commerce', 'orders'],
        },
      })

      expect(schema.metadata?.description).toBe('Order schema for e-commerce')
      expect(schema.metadata?.owner).toBe('commerce-team')
      expect(schema.metadata?.namespace).toBe('core')
      expect(schema.metadata?.tags).toContain('commerce')
    })

    it('should support nested object schemas', () => {
      const schema = createSchema({
        name: 'customer',
        version: '1.0.0',
        schema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            address: {
              type: 'object',
              properties: {
                street: { type: 'string' },
                city: { type: 'string' },
                country: { type: 'string' },
                zipCode: { type: 'string' },
              },
              required: ['city', 'country'],
            },
          },
          required: ['id'],
        },
      })

      expect(schema.schema.properties?.address?.type).toBe('object')
      expect(schema.schema.properties?.address?.properties?.city).toBeDefined()
    })

    it('should support array types', () => {
      const schema = createSchema({
        name: 'product',
        version: '1.0.0',
        schema: {
          type: 'object',
          properties: {
            tags: {
              type: 'array',
              items: { type: 'string' },
            },
            variants: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  sku: { type: 'string' },
                  price: { type: 'number' },
                },
              },
            },
          },
        },
      })

      expect(schema.schema.properties?.tags?.type).toBe('array')
      expect(schema.schema.properties?.tags?.items?.type).toBe('string')
    })

    it('should support enum types', () => {
      const schema = createSchema({
        name: 'order-status',
        version: '1.0.0',
        schema: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled'],
            },
          },
        },
      })

      expect(schema.schema.properties?.status?.enum).toContain('pending')
      expect(schema.schema.properties?.status?.enum?.length).toBe(5)
    })

    it('should support format constraints', () => {
      const schema = createSchema({
        name: 'contact',
        version: '1.0.0',
        schema: {
          type: 'object',
          properties: {
            email: { type: 'string', format: 'email' },
            website: { type: 'string', format: 'uri' },
            birthDate: { type: 'string', format: 'date' },
            lastLogin: { type: 'string', format: 'date-time' },
            uuid: { type: 'string', format: 'uuid' },
          },
        },
      })

      expect(schema.schema.properties?.email?.format).toBe('email')
      expect(schema.schema.properties?.website?.format).toBe('uri')
    })

    it('should support numeric constraints', () => {
      const schema = createSchema({
        name: 'product-price',
        version: '1.0.0',
        schema: {
          type: 'object',
          properties: {
            price: {
              type: 'number',
              minimum: 0,
              maximum: 1000000,
            },
            quantity: {
              type: 'integer',
              minimum: 1,
              maximum: 10000,
            },
            discount: {
              type: 'number',
              minimum: 0,
              maximum: 100,
              exclusiveMaximum: true,
            },
          },
        },
      })

      expect(schema.schema.properties?.price?.minimum).toBe(0)
      expect(schema.schema.properties?.quantity?.type).toBe('integer')
    })

    it('should support string constraints', () => {
      const schema = createSchema({
        name: 'validation-test',
        version: '1.0.0',
        schema: {
          type: 'object',
          properties: {
            username: {
              type: 'string',
              minLength: 3,
              maxLength: 50,
              pattern: '^[a-zA-Z0-9_]+$',
            },
          },
        },
      })

      expect(schema.schema.properties?.username?.minLength).toBe(3)
      expect(schema.schema.properties?.username?.pattern).toBe('^[a-zA-Z0-9_]+$')
    })
  })

  // ============================================================================
  // VALIDATION
  // ============================================================================

  describe('validation', () => {
    let registry: SchemaRegistry

    beforeEach(async () => {
      registry = createRegistry()
      await registry.register({
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
    })

    it('should validate valid data successfully', async () => {
      const result = await registry.validate('user', {
        id: 'user-123',
        email: 'alice@example.com',
        name: 'Alice',
        age: 30,
      })

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should fail validation for missing required fields', async () => {
      const result = await registry.validate('user', {
        id: 'user-123',
        // missing email
        name: 'Alice',
      })

      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors.some((e) => e.path === 'email' || e.message.includes('email'))).toBe(true)
    })

    it('should fail validation for wrong type', async () => {
      const result = await registry.validate('user', {
        id: 'user-123',
        email: 'alice@example.com',
        age: 'thirty', // should be integer
      })

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.path?.includes('age') || e.message.includes('age'))).toBe(true)
    })

    it('should fail validation for invalid format', async () => {
      const result = await registry.validate('user', {
        id: 'user-123',
        email: 'not-an-email', // invalid email format
      })

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.message.includes('email') || e.message.includes('format'))).toBe(true)
    })

    it('should fail validation for out of range numbers', async () => {
      const result = await registry.validate('user', {
        id: 'user-123',
        email: 'alice@example.com',
        age: 200, // exceeds maximum of 150
      })

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.message.includes('maximum') || e.message.includes('150'))).toBe(true)
    })

    it('should provide detailed error information', async () => {
      const result = await registry.validate('user', {
        id: 123, // wrong type
        email: 'invalid', // invalid format
        age: -5, // below minimum
      })

      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThanOrEqual(3)

      // Check error structure
      for (const error of result.errors) {
        expect(error).toHaveProperty('message')
        expect(error).toHaveProperty('path')
      }
    })

    it('should validate against specific version', async () => {
      // Register v2 with additional field
      await registry.register({
        name: 'user',
        version: '2.0.0',
        schema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string', format: 'email' },
            phone: { type: 'string' }, // new required field
          },
          required: ['id', 'email', 'phone'],
        },
      })

      // Valid for v1 but not v2
      const data = { id: 'user-123', email: 'alice@example.com' }

      const v1Result = await registry.validate('user', data, '1.0.0')
      expect(v1Result.valid).toBe(true)

      const v2Result = await registry.validate('user', data, '2.0.0')
      expect(v2Result.valid).toBe(false)
    })

    it('should validate nested objects', async () => {
      await registry.register({
        name: 'customer',
        version: '1.0.0',
        schema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            address: {
              type: 'object',
              properties: {
                city: { type: 'string' },
                zipCode: { type: 'string', pattern: '^[0-9]{5}$' },
              },
              required: ['city'],
            },
          },
          required: ['id'],
        },
      })

      const validResult = await registry.validate('customer', {
        id: 'cust-1',
        address: { city: 'New York', zipCode: '10001' },
      })
      expect(validResult.valid).toBe(true)

      const invalidResult = await registry.validate('customer', {
        id: 'cust-1',
        address: { zipCode: 'invalid' }, // missing city, invalid zipCode
      })
      expect(invalidResult.valid).toBe(false)
    })

    it('should validate arrays', async () => {
      await registry.register({
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
                  productId: { type: 'string' },
                  quantity: { type: 'integer', minimum: 1 },
                },
                required: ['productId', 'quantity'],
              },
              minItems: 1,
            },
          },
          required: ['items'],
        },
      })

      const validResult = await registry.validate('order', {
        items: [
          { productId: 'prod-1', quantity: 2 },
          { productId: 'prod-2', quantity: 1 },
        ],
      })
      expect(validResult.valid).toBe(true)

      const invalidResult = await registry.validate('order', {
        items: [], // minItems is 1
      })
      expect(invalidResult.valid).toBe(false)
    })
  })

  // ============================================================================
  // VERSIONING
  // ============================================================================

  describe('versioning', () => {
    let registry: SchemaRegistry

    beforeEach(() => {
      registry = createRegistry()
    })

    it('should register schema with semantic version', async () => {
      await registry.register({
        name: 'user',
        version: '1.0.0',
        schema: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
      })

      const schema = await registry.get('user', '1.0.0')
      expect(schema.version).toBe('1.0.0')
    })

    it('should register multiple versions of same schema', async () => {
      await registry.register({
        name: 'user',
        version: '1.0.0',
        schema: { type: 'object', properties: { id: { type: 'string' } } },
      })

      await registry.register({
        name: 'user',
        version: '1.1.0',
        schema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
          },
        },
      })

      const v1 = await registry.get('user', '1.0.0')
      const v11 = await registry.get('user', '1.1.0')

      expect(v1.schema.properties?.email).toBeUndefined()
      expect(v11.schema.properties?.email).toBeDefined()
    })

    it('should get latest version by default', async () => {
      await registry.register({
        name: 'user',
        version: '1.0.0',
        schema: { type: 'object', properties: { id: { type: 'string' } } },
      })

      await registry.register({
        name: 'user',
        version: '2.0.0',
        schema: {
          type: 'object',
          properties: { userId: { type: 'string' } },
        },
      })

      const latest = await registry.get('user')
      expect(latest.version).toBe('2.0.0')
    })

    it('should get version history', async () => {
      await registry.register({
        name: 'user',
        version: '1.0.0',
        schema: { type: 'object', properties: { id: { type: 'string' } } },
      })

      await registry.register({
        name: 'user',
        version: '1.1.0',
        schema: {
          type: 'object',
          properties: { id: { type: 'string' }, name: { type: 'string' } },
        },
      })

      await registry.register({
        name: 'user',
        version: '2.0.0',
        schema: {
          type: 'object',
          properties: { userId: { type: 'string' } },
        },
      })

      const history = await registry.getVersionHistory('user')

      expect(history.length).toBe(3)
      expect(history.map((h) => h.version)).toContain('1.0.0')
      expect(history.map((h) => h.version)).toContain('1.1.0')
      expect(history.map((h) => h.version)).toContain('2.0.0')
    })

    it('should compare versions correctly', () => {
      expect(SchemaVersion.compare('1.0.0', '1.0.0')).toBe(0)
      expect(SchemaVersion.compare('1.0.0', '2.0.0')).toBeLessThan(0)
      expect(SchemaVersion.compare('2.0.0', '1.0.0')).toBeGreaterThan(0)
      expect(SchemaVersion.compare('1.1.0', '1.0.0')).toBeGreaterThan(0)
      expect(SchemaVersion.compare('1.0.1', '1.0.0')).toBeGreaterThan(0)
    })

    it('should parse version components', () => {
      const parsed = SchemaVersion.parse('2.3.4')
      expect(parsed.major).toBe(2)
      expect(parsed.minor).toBe(3)
      expect(parsed.patch).toBe(4)
    })

    it('should reject invalid version format', () => {
      expect(() => SchemaVersion.parse('invalid')).toThrow()
      expect(() => SchemaVersion.parse('1.2')).toThrow()
      expect(() => SchemaVersion.parse('1.2.3.4')).toThrow()
    })
  })

  // ============================================================================
  // COMPATIBILITY CHECKING
  // ============================================================================

  describe('compatibility checking', () => {
    let registry: SchemaRegistry

    beforeEach(async () => {
      registry = createRegistry()
      await registry.register({
        name: 'user',
        version: '1.0.0',
        schema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            name: { type: 'string' },
          },
          required: ['id', 'email'],
        },
      })
    })

    it('should detect backwards compatible changes (added optional field)', async () => {
      const newSchema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'string' },
          email: { type: 'string' },
          name: { type: 'string' },
          phone: { type: 'string' }, // new optional field
        },
        required: ['id', 'email'],
      }

      const result = await registry.checkCompatibility('user', '1.1.0', newSchema)

      expect(result.compatible).toBe(true)
      expect(result.breakingChanges).toHaveLength(0)
    })

    it('should detect breaking change: removed required field', async () => {
      const newSchema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'string' },
          // email removed
          name: { type: 'string' },
        },
        required: ['id'],
      }

      const result = await registry.checkCompatibility('user', '2.0.0', newSchema)

      expect(result.compatible).toBe(false)
      expect(result.breakingChanges.some((c) => c.includes('email') && c.includes('removed'))).toBe(true)
    })

    it('should detect breaking change: added required field', async () => {
      const newSchema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'string' },
          email: { type: 'string' },
          name: { type: 'string' },
          phone: { type: 'string' }, // new required field
        },
        required: ['id', 'email', 'phone'],
      }

      const result = await registry.checkCompatibility('user', '2.0.0', newSchema)

      expect(result.compatible).toBe(false)
      expect(result.breakingChanges.some((c) => c.includes('phone') && c.includes('required'))).toBe(true)
    })

    it('should detect breaking change: type change', async () => {
      const newSchema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'integer' }, // changed from string to integer
          email: { type: 'string' },
        },
        required: ['id', 'email'],
      }

      const result = await registry.checkCompatibility('user', '2.0.0', newSchema)

      expect(result.compatible).toBe(false)
      expect(result.breakingChanges.some((c) => c.includes('id') && c.includes('type'))).toBe(true)
    })

    it('should detect breaking change: made field required', async () => {
      const newSchema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'string' },
          email: { type: 'string' },
          name: { type: 'string' }, // now required
        },
        required: ['id', 'email', 'name'],
      }

      const result = await registry.checkCompatibility('user', '2.0.0', newSchema)

      expect(result.compatible).toBe(false)
      expect(result.breakingChanges.some((c) => c.includes('name') && c.includes('required'))).toBe(true)
    })

    it('should allow making field optional (non-breaking)', async () => {
      // First register schema with name required
      await registry.register({
        name: 'profile',
        version: '1.0.0',
        schema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
          },
          required: ['id', 'name'],
        },
      })

      const newSchema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' }, // now optional
        },
        required: ['id'],
      }

      const result = await registry.checkCompatibility('profile', '1.1.0', newSchema)

      expect(result.compatible).toBe(true)
    })

    it('should detect multiple breaking changes', async () => {
      const newSchema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'integer' }, // type change
          // email removed
          phone: { type: 'string' }, // new required
        },
        required: ['id', 'phone'],
      }

      const result = await registry.checkCompatibility('user', '2.0.0', newSchema)

      expect(result.compatible).toBe(false)
      expect(result.breakingChanges.length).toBeGreaterThanOrEqual(2)
    })

    it('should suggest appropriate version bump', async () => {
      // Compatible change -> minor version
      const compatibleSchema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'string' },
          email: { type: 'string' },
          name: { type: 'string' },
          nickname: { type: 'string' }, // optional addition
        },
        required: ['id', 'email'],
      }

      const compatResult = await registry.checkCompatibility('user', '1.1.0', compatibleSchema)
      expect(compatResult.suggestedVersionBump).toBe('minor')

      // Breaking change -> major version
      const breakingSchema: JSONSchema = {
        type: 'object',
        properties: {
          userId: { type: 'string' }, // renamed from id
          email: { type: 'string' },
        },
        required: ['userId', 'email'],
      }

      const breakResult = await registry.checkCompatibility('user', '2.0.0', breakingSchema)
      expect(breakResult.suggestedVersionBump).toBe('major')
    })
  })

  // ============================================================================
  // SCHEMA REGISTRY
  // ============================================================================

  describe('schema registry', () => {
    let registry: SchemaRegistry

    beforeEach(() => {
      registry = createRegistry()
    })

    it('should register and retrieve schemas', async () => {
      await registry.register({
        name: 'user',
        version: '1.0.0',
        schema: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
      })

      const schema = await registry.get('user')
      expect(schema.name).toBe('user')
    })

    it('should list all registered schemas', async () => {
      await registry.register({
        name: 'user',
        version: '1.0.0',
        schema: { type: 'object', properties: { id: { type: 'string' } } },
      })

      await registry.register({
        name: 'order',
        version: '1.0.0',
        schema: { type: 'object', properties: { orderId: { type: 'string' } } },
      })

      await registry.register({
        name: 'product',
        version: '1.0.0',
        schema: { type: 'object', properties: { sku: { type: 'string' } } },
        metadata: { namespace: 'commerce' },
      })

      const allSchemas = await registry.list()
      expect(allSchemas.length).toBe(3)
    })

    it('should filter schemas by namespace', async () => {
      await registry.register({
        name: 'user',
        version: '1.0.0',
        schema: { type: 'object', properties: { id: { type: 'string' } } },
        metadata: { namespace: 'identity' },
      })

      await registry.register({
        name: 'product',
        version: '1.0.0',
        schema: { type: 'object', properties: { sku: { type: 'string' } } },
        metadata: { namespace: 'commerce' },
      })

      await registry.register({
        name: 'order',
        version: '1.0.0',
        schema: { type: 'object', properties: { orderId: { type: 'string' } } },
        metadata: { namespace: 'commerce' },
      })

      const commerceSchemas = await registry.list({ namespace: 'commerce' })
      expect(commerceSchemas.length).toBe(2)
      expect(commerceSchemas.every((s) => s.metadata?.namespace === 'commerce')).toBe(true)
    })

    it('should search schemas by name', async () => {
      await registry.register({
        name: 'user-profile',
        version: '1.0.0',
        schema: { type: 'object', properties: { id: { type: 'string' } } },
      })

      await registry.register({
        name: 'user-settings',
        version: '1.0.0',
        schema: { type: 'object', properties: { theme: { type: 'string' } } },
      })

      await registry.register({
        name: 'product',
        version: '1.0.0',
        schema: { type: 'object', properties: { sku: { type: 'string' } } },
      })

      const userSchemas = await registry.list({ search: 'user' })
      expect(userSchemas.length).toBe(2)
    })

    it('should throw error for non-existent schema', async () => {
      await expect(registry.get('non-existent')).rejects.toThrow()
    })

    it('should throw error for non-existent version', async () => {
      await registry.register({
        name: 'user',
        version: '1.0.0',
        schema: { type: 'object', properties: { id: { type: 'string' } } },
      })

      await expect(registry.get('user', '9.9.9')).rejects.toThrow()
    })

    it('should delete schema version', async () => {
      await registry.register({
        name: 'user',
        version: '1.0.0',
        schema: { type: 'object', properties: { id: { type: 'string' } } },
      })

      await registry.register({
        name: 'user',
        version: '2.0.0',
        schema: { type: 'object', properties: { userId: { type: 'string' } } },
      })

      await registry.delete('user', '1.0.0')

      const history = await registry.getVersionHistory('user')
      expect(history.length).toBe(1)
      expect(history[0].version).toBe('2.0.0')
    })

    it('should check if schema exists', async () => {
      await registry.register({
        name: 'user',
        version: '1.0.0',
        schema: { type: 'object', properties: { id: { type: 'string' } } },
      })

      expect(await registry.exists('user')).toBe(true)
      expect(await registry.exists('non-existent')).toBe(false)
      expect(await registry.exists('user', '1.0.0')).toBe(true)
      expect(await registry.exists('user', '9.9.9')).toBe(false)
    })
  })

  // ============================================================================
  // TYPESCRIPT TYPE GENERATION
  // ============================================================================

  describe('TypeScript type generation', () => {
    let registry: SchemaRegistry

    beforeEach(() => {
      registry = createRegistry()
    })

    it('should generate TypeScript interface from schema', async () => {
      await registry.register({
        name: 'user',
        version: '1.0.0',
        schema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            age: { type: 'integer' },
            active: { type: 'boolean' },
          },
          required: ['id', 'email'],
        },
      })

      const types = await registry.generateTypes('user')

      expect(types).toContain('interface User')
      expect(types).toContain('id: string')
      expect(types).toContain('email: string')
      expect(types).toContain('age?: number')
      expect(types).toContain('active?: boolean')
    })

    it('should generate types for nested objects', async () => {
      await registry.register({
        name: 'customer',
        version: '1.0.0',
        schema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            address: {
              type: 'object',
              properties: {
                street: { type: 'string' },
                city: { type: 'string' },
              },
            },
          },
        },
      })

      const types = await registry.generateTypes('customer')

      expect(types).toContain('interface Customer')
      expect(types).toContain('address?:')
      expect(types).toContain('street?: string')
      expect(types).toContain('city?: string')
    })

    it('should generate types for arrays', async () => {
      await registry.register({
        name: 'order',
        version: '1.0.0',
        schema: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: { type: 'string' },
            },
            quantities: {
              type: 'array',
              items: { type: 'number' },
            },
          },
        },
      })

      const types = await registry.generateTypes('order')

      expect(types).toContain('items?: string[]')
      expect(types).toContain('quantities?: number[]')
    })

    it('should generate types for enums', async () => {
      await registry.register({
        name: 'status',
        version: '1.0.0',
        schema: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['pending', 'active', 'closed'],
            },
          },
        },
      })

      const types = await registry.generateTypes('status')

      expect(types).toMatch(/status\?:\s*['"]pending['"]\s*\|\s*['"]active['"]\s*\|\s*['"]closed['"]/)
    })

    it('should handle nullable types', async () => {
      await registry.register({
        name: 'profile',
        version: '1.0.0',
        schema: {
          type: 'object',
          properties: {
            nickname: {
              type: ['string', 'null'],
            },
          },
        },
      })

      const types = await registry.generateTypes('profile')

      expect(types).toContain('nickname?: string | null')
    })
  })

  // ============================================================================
  // EVOLUTION AND MIGRATIONS
  // ============================================================================

  describe('evolution and migrations', () => {
    let registry: SchemaRegistry

    beforeEach(async () => {
      registry = createRegistry()
      await registry.register({
        name: 'user',
        version: '1.0.0',
        schema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            name: { type: 'string' },
          },
          required: ['id', 'email'],
        },
      })
    })

    it('should evolve schema with backwards compatible change', async () => {
      const newSchema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'string' },
          email: { type: 'string' },
          name: { type: 'string' },
          phone: { type: 'string' }, // added optional field
        },
        required: ['id', 'email'],
      }

      await registry.register({
        name: 'user',
        version: '1.1.0',
        schema: newSchema,
      })

      const latest = await registry.get('user')
      expect(latest.version).toBe('1.1.0')
      expect(latest.schema.properties?.phone).toBeDefined()
    })

    it('should detect schema differences', async () => {
      const oldSchema = await registry.get('user', '1.0.0')

      const newSchemaDefinition: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'string' },
          email: { type: 'string' },
          name: { type: 'string' },
          phone: { type: 'string' }, // added
          // removed: nothing
        },
        required: ['id', 'email'],
      }

      const diff = registry.diff(oldSchema.schema, newSchemaDefinition)

      expect(diff.addedFields).toContain('phone')
      expect(diff.removedFields).toHaveLength(0)
      expect(diff.changedTypes).toHaveLength(0)
    })

    it('should generate migration for schema changes', async () => {
      const newSchema: JSONSchema = {
        type: 'object',
        properties: {
          id: { type: 'string' },
          email: { type: 'string' },
          // name removed
          fullName: { type: 'string' }, // renamed from name
          phone: { type: 'string' }, // added
        },
        required: ['id', 'email'],
      }

      const migration = await registry.generateMigration('user', '1.0.0', newSchema)

      expect(migration.changes).toContainEqual(
        expect.objectContaining({
          type: 'remove',
          field: 'name',
        })
      )
      expect(migration.changes).toContainEqual(
        expect.objectContaining({
          type: 'add',
          field: 'fullName',
        })
      )
      expect(migration.changes).toContainEqual(
        expect.objectContaining({
          type: 'add',
          field: 'phone',
        })
      )
    })

    it('should apply migration to data', async () => {
      // Define migration with field rename
      const migration = {
        fromVersion: '1.0.0',
        toVersion: '2.0.0',
        changes: [
          { type: 'rename' as const, from: 'name', to: 'fullName' },
          { type: 'add' as const, field: 'phone', defaultValue: '' },
        ],
      }

      const oldData = {
        id: 'user-123',
        email: 'alice@example.com',
        name: 'Alice Smith',
      }

      const newData = registry.applyMigration(oldData, migration)

      expect(newData.fullName).toBe('Alice Smith')
      expect(newData.name).toBeUndefined()
      expect(newData.phone).toBe('')
    })
  })

  // ============================================================================
  // EDGE CASES AND ERROR HANDLING
  // ============================================================================

  describe('edge cases and error handling', () => {
    let registry: SchemaRegistry

    beforeEach(() => {
      registry = createRegistry()
    })

    it('should handle empty schema', async () => {
      await registry.register({
        name: 'empty',
        version: '1.0.0',
        schema: { type: 'object' },
      })

      const result = await registry.validate('empty', {})
      expect(result.valid).toBe(true)
    })

    it('should handle schema with no properties', async () => {
      await registry.register({
        name: 'any-object',
        version: '1.0.0',
        schema: {
          type: 'object',
          additionalProperties: true,
        },
      })

      const result = await registry.validate('any-object', {
        anything: 'goes',
        nested: { object: true },
      })
      expect(result.valid).toBe(true)
    })

    it('should reject additionalProperties when false', async () => {
      await registry.register({
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

      const result = await registry.validate('strict', {
        id: 'test',
        extraField: 'not allowed',
      })
      expect(result.valid).toBe(false)
    })

    it('should handle deeply nested structures', async () => {
      await registry.register({
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

      const result = await registry.validate('nested', {
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

    it('should handle circular references gracefully', async () => {
      // JSON Schema doesn't support true circular references,
      // but we should handle $ref patterns
      await registry.register({
        name: 'tree-node',
        version: '1.0.0',
        schema: {
          type: 'object',
          properties: {
            value: { type: 'string' },
            children: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  value: { type: 'string' },
                },
              },
            },
          },
        },
      })

      const result = await registry.validate('tree-node', {
        value: 'root',
        children: [{ value: 'child1' }, { value: 'child2' }],
      })
      expect(result.valid).toBe(true)
    })

    it('should validate null values correctly', async () => {
      await registry.register({
        name: 'nullable-fields',
        version: '1.0.0',
        schema: {
          type: 'object',
          properties: {
            required: { type: 'string' },
            nullable: { type: ['string', 'null'] },
          },
          required: ['required'],
        },
      })

      const validWithNull = await registry.validate('nullable-fields', {
        required: 'value',
        nullable: null,
      })
      expect(validWithNull.valid).toBe(true)

      const invalidNull = await registry.validate('nullable-fields', {
        required: null, // not nullable
      })
      expect(invalidNull.valid).toBe(false)
    })

    it('should handle large schemas efficiently', async () => {
      // Create a schema with many properties
      const properties: Record<string, { type: string }> = {}
      for (let i = 0; i < 100; i++) {
        properties[`field${i}`] = { type: 'string' }
      }

      await registry.register({
        name: 'large-schema',
        version: '1.0.0',
        schema: {
          type: 'object',
          properties,
        },
      })

      const data: Record<string, string> = {}
      for (let i = 0; i < 100; i++) {
        data[`field${i}`] = `value${i}`
      }

      const start = performance.now()
      const result = await registry.validate('large-schema', data)
      const duration = performance.now() - start

      expect(result.valid).toBe(true)
      expect(duration).toBeLessThan(100) // Should validate in under 100ms
    })
  })
})
