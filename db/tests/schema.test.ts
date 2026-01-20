import { describe, it, expect, beforeEach } from 'vitest'
import {
  defineSchema,
  createSchemaRegistry,
  createValidatedStore,
  SchemaValidationError,
  type InferSchema,
  type Schema
} from '../schema'
import { createThingsStore, type ThingsStore } from '../things'

describe('Schema Validation', () => {
  describe('defineSchema', () => {
    it('should create a schema with required string field', () => {
      const CustomerSchema = defineSchema({
        $type: 'Customer',
        fields: {
          name: { type: 'string', required: true }
        }
      })

      expect(CustomerSchema.$type).toBe('Customer')
      expect(CustomerSchema.fields.name.type).toBe('string')
      expect(CustomerSchema.fields.name.required).toBe(true)
    })

    it('should validate required fields', () => {
      const schema = defineSchema({
        $type: 'Test',
        fields: {
          name: { type: 'string', required: true }
        }
      })

      const result = schema.validate({})
      expect(result.valid).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].field).toBe('name')
      expect(result.errors[0].message).toBe('Field is required')
    })

    it('should allow optional fields to be missing', () => {
      const schema = defineSchema({
        $type: 'Test',
        fields: {
          name: { type: 'string' } // not required
        }
      })

      const result = schema.validate({})
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should validate string type', () => {
      const schema = defineSchema({
        $type: 'Test',
        fields: {
          name: { type: 'string', required: true }
        }
      })

      // Valid string
      expect(schema.validate({ name: 'Alice' }).valid).toBe(true)

      // Invalid type
      const result = schema.validate({ name: 123 })
      expect(result.valid).toBe(false)
      expect(result.errors[0].message).toBe('Expected string, got number')
    })

    it('should validate string minLength', () => {
      const schema = defineSchema({
        $type: 'Test',
        fields: {
          name: { type: 'string', minLength: 3 }
        }
      })

      expect(schema.validate({ name: 'Al' }).valid).toBe(false)
      expect(schema.validate({ name: 'Ali' }).valid).toBe(true)
      expect(schema.validate({ name: 'Alice' }).valid).toBe(true)
    })

    it('should validate string maxLength', () => {
      const schema = defineSchema({
        $type: 'Test',
        fields: {
          name: { type: 'string', maxLength: 5 }
        }
      })

      expect(schema.validate({ name: 'Alice' }).valid).toBe(true)
      expect(schema.validate({ name: 'Alicia' }).valid).toBe(false)
    })

    it('should validate string pattern', () => {
      const schema = defineSchema({
        $type: 'Test',
        fields: {
          code: { type: 'string', pattern: '^[A-Z]{3}$' }
        }
      })

      expect(schema.validate({ code: 'ABC' }).valid).toBe(true)
      expect(schema.validate({ code: 'abc' }).valid).toBe(false)
      expect(schema.validate({ code: 'ABCD' }).valid).toBe(false)
    })

    it('should validate string enum', () => {
      const schema = defineSchema({
        $type: 'Test',
        fields: {
          status: { type: 'string', enum: ['active', 'inactive', 'pending'] }
        }
      })

      expect(schema.validate({ status: 'active' }).valid).toBe(true)
      expect(schema.validate({ status: 'inactive' }).valid).toBe(true)
      expect(schema.validate({ status: 'unknown' }).valid).toBe(false)
    })

    it('should validate email format', () => {
      const schema = defineSchema({
        $type: 'Test',
        fields: {
          email: { type: 'string', format: 'email' }
        }
      })

      expect(schema.validate({ email: 'alice@example.com' }).valid).toBe(true)
      expect(schema.validate({ email: 'alice@subdomain.example.com' }).valid).toBe(true)
      expect(schema.validate({ email: 'invalid-email' }).valid).toBe(false)
      expect(schema.validate({ email: '@example.com' }).valid).toBe(false)
    })

    it('should validate url format', () => {
      const schema = defineSchema({
        $type: 'Test',
        fields: {
          website: { type: 'string', format: 'url' }
        }
      })

      expect(schema.validate({ website: 'https://example.com' }).valid).toBe(true)
      expect(schema.validate({ website: 'http://localhost:3000' }).valid).toBe(true)
      expect(schema.validate({ website: 'not-a-url' }).valid).toBe(false)
    })

    it('should validate uuid format', () => {
      const schema = defineSchema({
        $type: 'Test',
        fields: {
          id: { type: 'string', format: 'uuid' }
        }
      })

      expect(schema.validate({ id: '550e8400-e29b-41d4-a716-446655440000' }).valid).toBe(true)
      expect(schema.validate({ id: 'not-a-uuid' }).valid).toBe(false)
    })

    it('should validate date format', () => {
      const schema = defineSchema({
        $type: 'Test',
        fields: {
          date: { type: 'string', format: 'date' }
        }
      })

      expect(schema.validate({ date: '2024-01-15' }).valid).toBe(true)
      expect(schema.validate({ date: '2024-1-15' }).valid).toBe(false)
      expect(schema.validate({ date: 'January 15, 2024' }).valid).toBe(false)
    })

    it('should validate datetime format', () => {
      const schema = defineSchema({
        $type: 'Test',
        fields: {
          timestamp: { type: 'string', format: 'datetime' }
        }
      })

      expect(schema.validate({ timestamp: '2024-01-15T10:30:00Z' }).valid).toBe(true)
      expect(schema.validate({ timestamp: '2024-01-15' }).valid).toBe(true)
      expect(schema.validate({ timestamp: 'not-a-datetime' }).valid).toBe(false)
    })

    it('should validate number type', () => {
      const schema = defineSchema({
        $type: 'Test',
        fields: {
          age: { type: 'number', required: true }
        }
      })

      expect(schema.validate({ age: 25 }).valid).toBe(true)
      expect(schema.validate({ age: 25.5 }).valid).toBe(true)
      expect(schema.validate({ age: '25' }).valid).toBe(false)
    })

    it('should validate number min', () => {
      const schema = defineSchema({
        $type: 'Test',
        fields: {
          age: { type: 'number', min: 0 }
        }
      })

      expect(schema.validate({ age: 0 }).valid).toBe(true)
      expect(schema.validate({ age: 25 }).valid).toBe(true)
      expect(schema.validate({ age: -1 }).valid).toBe(false)
    })

    it('should validate number max', () => {
      const schema = defineSchema({
        $type: 'Test',
        fields: {
          age: { type: 'number', max: 120 }
        }
      })

      expect(schema.validate({ age: 120 }).valid).toBe(true)
      expect(schema.validate({ age: 121 }).valid).toBe(false)
    })

    it('should validate number integer', () => {
      const schema = defineSchema({
        $type: 'Test',
        fields: {
          count: { type: 'number', integer: true }
        }
      })

      expect(schema.validate({ count: 5 }).valid).toBe(true)
      expect(schema.validate({ count: 5.5 }).valid).toBe(false)
    })

    it('should validate boolean type', () => {
      const schema = defineSchema({
        $type: 'Test',
        fields: {
          active: { type: 'boolean', required: true }
        }
      })

      expect(schema.validate({ active: true }).valid).toBe(true)
      expect(schema.validate({ active: false }).valid).toBe(true)
      expect(schema.validate({ active: 'true' }).valid).toBe(false)
      expect(schema.validate({ active: 1 }).valid).toBe(false)
    })

    it('should validate array type', () => {
      const schema = defineSchema({
        $type: 'Test',
        fields: {
          tags: { type: 'array', required: true }
        }
      })

      expect(schema.validate({ tags: [] }).valid).toBe(true)
      expect(schema.validate({ tags: ['a', 'b'] }).valid).toBe(true)
      expect(schema.validate({ tags: 'not-an-array' }).valid).toBe(false)
    })

    it('should validate array minItems', () => {
      const schema = defineSchema({
        $type: 'Test',
        fields: {
          tags: { type: 'array', minItems: 1 }
        }
      })

      expect(schema.validate({ tags: [] }).valid).toBe(false)
      expect(schema.validate({ tags: ['a'] }).valid).toBe(true)
    })

    it('should validate array maxItems', () => {
      const schema = defineSchema({
        $type: 'Test',
        fields: {
          tags: { type: 'array', maxItems: 3 }
        }
      })

      expect(schema.validate({ tags: ['a', 'b', 'c'] }).valid).toBe(true)
      expect(schema.validate({ tags: ['a', 'b', 'c', 'd'] }).valid).toBe(false)
    })

    it('should validate array items', () => {
      const schema = defineSchema({
        $type: 'Test',
        fields: {
          tags: {
            type: 'array',
            items: { type: 'string' }
          }
        }
      })

      expect(schema.validate({ tags: ['a', 'b', 'c'] }).valid).toBe(true)

      const result = schema.validate({ tags: ['a', 123, 'c'] })
      expect(result.valid).toBe(false)
      expect(result.errors[0].field).toBe('tags[1]')
    })

    it('should validate object type', () => {
      const schema = defineSchema({
        $type: 'Test',
        fields: {
          metadata: { type: 'object', required: true }
        }
      })

      expect(schema.validate({ metadata: {} }).valid).toBe(true)
      expect(schema.validate({ metadata: { key: 'value' } }).valid).toBe(true)
      expect(schema.validate({ metadata: 'not-an-object' }).valid).toBe(false)
      expect(schema.validate({ metadata: [] }).valid).toBe(false)
      expect(schema.validate({ metadata: null }).valid).toBe(false)
    })

    it('should validate nested object properties', () => {
      const schema = defineSchema({
        $type: 'Test',
        fields: {
          address: {
            type: 'object',
            properties: {
              street: { type: 'string', required: true },
              city: { type: 'string', required: true },
              zip: { type: 'string', pattern: '^\\d{5}$' }
            }
          }
        }
      })

      expect(schema.validate({
        address: { street: '123 Main St', city: 'Springfield', zip: '12345' }
      }).valid).toBe(true)

      // Missing required nested field
      const result = schema.validate({
        address: { street: '123 Main St' }
      })
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.field === 'address.city')).toBe(true)

      // Invalid nested field format
      const result2 = schema.validate({
        address: { street: '123 Main St', city: 'Springfield', zip: 'invalid' }
      })
      expect(result2.valid).toBe(false)
      expect(result2.errors.some(e => e.field === 'address.zip')).toBe(true)
    })

    it('should reject unknown fields in strict mode', () => {
      const schema = defineSchema({
        $type: 'Test',
        fields: {
          name: { type: 'string' }
        },
        strict: true
      })

      expect(schema.validate({ name: 'Alice' }).valid).toBe(true)

      const result = schema.validate({ name: 'Alice', unknown: 'value' })
      expect(result.valid).toBe(false)
      expect(result.errors[0].field).toBe('unknown')
      expect(result.errors[0].message).toBe('Unknown field (strict mode)')
    })

    it('should allow system fields ($id, $type, etc) in strict mode', () => {
      const schema = defineSchema({
        $type: 'Test',
        fields: {
          name: { type: 'string' }
        },
        strict: true
      })

      const result = schema.validate({
        $id: '123',
        $type: 'Test',
        $createdAt: Date.now(),
        name: 'Alice'
      })
      expect(result.valid).toBe(true)
    })
  })

  describe('parse and safeParse', () => {
    it('should parse valid data', () => {
      const schema = defineSchema({
        $type: 'Customer',
        fields: {
          name: { type: 'string', required: true }
        }
      })

      const data = schema.parse({ name: 'Alice' })
      expect(data.name).toBe('Alice')
    })

    it('should throw SchemaValidationError on parse failure', () => {
      const schema = defineSchema({
        $type: 'Customer',
        fields: {
          name: { type: 'string', required: true }
        }
      })

      expect(() => schema.parse({})).toThrow(SchemaValidationError)
      expect(() => schema.parse({})).toThrow('Validation failed')
    })

    it('should return success result from safeParse on valid data', () => {
      const schema = defineSchema({
        $type: 'Customer',
        fields: {
          name: { type: 'string', required: true }
        }
      })

      const result = schema.safeParse({ name: 'Alice' })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.name).toBe('Alice')
      }
    })

    it('should return failure result from safeParse on invalid data', () => {
      const schema = defineSchema({
        $type: 'Customer',
        fields: {
          name: { type: 'string', required: true }
        }
      })

      const result = schema.safeParse({})
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors).toHaveLength(1)
      }
    })
  })

  describe('Type Inference', () => {
    it('should infer correct types from schema', () => {
      const CustomerSchema = defineSchema({
        $type: 'Customer',
        fields: {
          name: { type: 'string', required: true },
          email: { type: 'string', format: 'email' },
          age: { type: 'number', min: 0 },
          active: { type: 'boolean' },
          tags: { type: 'array', items: { type: 'string' } }
        }
      })

      // Type inference test - this is compile-time only
      type Customer = InferSchema<typeof CustomerSchema>

      // Runtime test that validates the inferred type works
      const validCustomer: Customer = {
        name: 'Alice', // required
        email: 'alice@example.com',
        age: 25,
        active: true,
        tags: ['vip']
      }

      expect(CustomerSchema.validate(validCustomer).valid).toBe(true)
    })
  })

  describe('SchemaRegistry', () => {
    let registry: ReturnType<typeof createSchemaRegistry>

    beforeEach(() => {
      registry = createSchemaRegistry()
    })

    it('should register and retrieve schemas', () => {
      const CustomerSchema = defineSchema({
        $type: 'Customer',
        fields: {
          name: { type: 'string', required: true }
        }
      })

      registry.register(CustomerSchema)

      const retrieved = registry.get('Customer')
      expect(retrieved).toBeDefined()
      expect(retrieved?.$type).toBe('Customer')
    })

    it('should check if schema exists', () => {
      const CustomerSchema = defineSchema({
        $type: 'Customer',
        fields: {}
      })

      expect(registry.has('Customer')).toBe(false)
      registry.register(CustomerSchema)
      expect(registry.has('Customer')).toBe(true)
    })

    it('should unregister schemas', () => {
      const CustomerSchema = defineSchema({
        $type: 'Customer',
        fields: {}
      })

      registry.register(CustomerSchema)
      expect(registry.has('Customer')).toBe(true)

      registry.unregister('Customer')
      expect(registry.has('Customer')).toBe(false)
    })

    it('should list all registered types', () => {
      registry.register(defineSchema({ $type: 'Customer', fields: {} }))
      registry.register(defineSchema({ $type: 'Order', fields: {} }))
      registry.register(defineSchema({ $type: 'Product', fields: {} }))

      const types = registry.types()
      expect(types).toContain('Customer')
      expect(types).toContain('Order')
      expect(types).toContain('Product')
    })

    it('should validate data against registered schema', () => {
      const CustomerSchema = defineSchema({
        $type: 'Customer',
        fields: {
          name: { type: 'string', required: true }
        }
      })

      registry.register(CustomerSchema)

      const validResult = registry.validate({ $type: 'Customer', name: 'Alice' })
      expect(validResult?.valid).toBe(true)

      const invalidResult = registry.validate({ $type: 'Customer' })
      expect(invalidResult?.valid).toBe(false)
    })

    it('should return undefined for unregistered types', () => {
      const result = registry.validate({ $type: 'Unknown', name: 'Alice' })
      expect(result).toBeUndefined()
    })

    it('should clear all schemas', () => {
      registry.register(defineSchema({ $type: 'Customer', fields: {} }))
      registry.register(defineSchema({ $type: 'Order', fields: {} }))

      registry.clear()

      expect(registry.types()).toHaveLength(0)
    })
  })

  describe('createValidatedStore', () => {
    let store: ThingsStore
    let registry: ReturnType<typeof createSchemaRegistry>
    let validatedStore: ThingsStore

    beforeEach(() => {
      store = createThingsStore()
      registry = createSchemaRegistry()

      const CustomerSchema = defineSchema({
        $type: 'Customer',
        fields: {
          name: { type: 'string', required: true },
          email: { type: 'string', format: 'email' },
          age: { type: 'number', min: 0 }
        }
      })

      registry.register(CustomerSchema)
      validatedStore = createValidatedStore(store, registry)
    })

    it('should create valid things', async () => {
      const customer = await validatedStore.create({
        $type: 'Customer',
        name: 'Alice',
        email: 'alice@example.com',
        age: 25
      })

      expect(customer.$id).toBeDefined()
      expect(customer.name).toBe('Alice')
    })

    it('should reject invalid things on create', async () => {
      await expect(
        validatedStore.create({
          $type: 'Customer',
          // name is missing (required)
          email: 'alice@example.com'
        })
      ).rejects.toThrow(SchemaValidationError)
    })

    it('should reject invalid field types on create', async () => {
      await expect(
        validatedStore.create({
          $type: 'Customer',
          name: 'Alice',
          email: 'invalid-email'
        })
      ).rejects.toThrow('Invalid email format')
    })

    it('should reject invalid number constraints on create', async () => {
      await expect(
        validatedStore.create({
          $type: 'Customer',
          name: 'Alice',
          age: -5
        })
      ).rejects.toThrow('Number must be at least 0')
    })

    it('should allow unregistered types by default', async () => {
      const order = await validatedStore.create({
        $type: 'Order', // No schema registered
        total: 100
      })

      expect(order.$id).toBeDefined()
      expect(order.total).toBe(100)
    })

    it('should reject unregistered types when configured', async () => {
      const strictStore = createValidatedStore(store, registry, {
        allowUnregistered: false
      })

      await expect(
        strictStore.create({
          $type: 'Order', // No schema registered
          total: 100
        })
      ).rejects.toThrow('No schema registered for type: Order')
    })

    it('should validate on update', async () => {
      const customer = await validatedStore.create({
        $type: 'Customer',
        name: 'Alice',
        email: 'alice@example.com'
      })

      // Valid update
      const updated = await validatedStore.update(customer.$id, {
        name: 'Alicia'
      })
      expect(updated.name).toBe('Alicia')

      // Invalid update (empty name would fail minLength if set)
      // For this test, we'll try invalid email format
      await expect(
        validatedStore.update(customer.$id, {
          email: 'invalid-email'
        })
      ).rejects.toThrow('Invalid email format')
    })

    it('should validate bulk create', async () => {
      // All valid
      const customers = await validatedStore.bulkCreate([
        { $type: 'Customer', name: 'Alice' },
        { $type: 'Customer', name: 'Bob' }
      ])
      expect(customers).toHaveLength(2)

      // One invalid - should fail atomically
      await expect(
        validatedStore.bulkCreate([
          { $type: 'Customer', name: 'Charlie' },
          { $type: 'Customer' } // Missing name
        ])
      ).rejects.toThrow(SchemaValidationError)

      // Charlie should not have been created
      const all = await validatedStore.list({ type: 'Customer' })
      expect(all.find(c => c.name === 'Charlie')).toBeUndefined()
    })

    it('should validate bulk update', async () => {
      const customers = await validatedStore.bulkCreate([
        { $type: 'Customer', name: 'Alice', email: 'alice@example.com' },
        { $type: 'Customer', name: 'Bob', email: 'bob@example.com' }
      ])

      // All valid updates
      const updated = await validatedStore.bulkUpdate([
        { id: customers[0].$id, data: { name: 'Alicia' } },
        { id: customers[1].$id, data: { name: 'Robert' } }
      ])
      expect(updated[0].name).toBe('Alicia')
      expect(updated[1].name).toBe('Robert')

      // One invalid update - should fail atomically
      await expect(
        validatedStore.bulkUpdate([
          { id: customers[0].$id, data: { name: 'Alice2' } },
          { id: customers[1].$id, data: { email: 'invalid-email' } }
        ])
      ).rejects.toThrow(SchemaValidationError)

      // Names should not have changed
      const alice = await validatedStore.get(customers[0].$id)
      expect(alice?.name).toBe('Alicia') // Still from previous update
    })

    it('should pass through get, delete, and list without validation', async () => {
      const customer = await validatedStore.create({
        $type: 'Customer',
        name: 'Alice'
      })

      // Get
      const retrieved = await validatedStore.get(customer.$id)
      expect(retrieved?.name).toBe('Alice')

      // List
      const list = await validatedStore.list({ type: 'Customer' })
      expect(list).toHaveLength(1)

      // Delete
      await validatedStore.delete(customer.$id)
      expect(await validatedStore.get(customer.$id)).toBeNull()
    })
  })

  describe('Complex Schema', () => {
    it('should validate a comprehensive schema', () => {
      const ProductSchema = defineSchema({
        $type: 'Product',
        fields: {
          name: { type: 'string', required: true, minLength: 1, maxLength: 100 },
          sku: { type: 'string', required: true, pattern: '^[A-Z]{3}-\\d{4}$' },
          price: { type: 'number', required: true, min: 0 },
          quantity: { type: 'number', integer: true, min: 0 },
          status: { type: 'string', enum: ['draft', 'active', 'archived'] },
          tags: {
            type: 'array',
            items: { type: 'string' },
            maxItems: 10
          },
          metadata: {
            type: 'object',
            properties: {
              brand: { type: 'string' },
              weight: { type: 'number', min: 0 }
            }
          }
        }
      })

      // Valid product
      const validResult = ProductSchema.validate({
        name: 'Widget',
        sku: 'ABC-1234',
        price: 19.99,
        quantity: 100,
        status: 'active',
        tags: ['popular', 'sale'],
        metadata: { brand: 'Acme', weight: 0.5 }
      })
      expect(validResult.valid).toBe(true)

      // Invalid product - multiple errors
      const invalidResult = ProductSchema.validate({
        name: '', // Too short
        sku: 'invalid', // Wrong pattern
        price: -10, // Negative
        quantity: 5.5, // Not integer
        status: 'unknown', // Not in enum
        tags: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'], // Too many
        metadata: { weight: -1 } // Negative weight
      })
      expect(invalidResult.valid).toBe(false)
      expect(invalidResult.errors.length).toBeGreaterThan(5)
    })
  })
})
