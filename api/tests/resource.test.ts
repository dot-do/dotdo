import { describe, it, expect } from 'vitest'
import {
  defineResource,
  getResource,
  getAllResources,
  clearRegistry,
  type NumberFieldDef,
  type EnumFieldDef,
} from '../resource'
import { z } from 'zod'
import type { Context } from 'hono'

describe('Resource Definition DSL', () => {
  describe('Basic Resource Definition', () => {
    it('should define a resource with name and fields', () => {
      const Customer = defineResource('Customer')
        .fields({
          name: { type: 'string', required: true },
          email: { type: 'string', required: true },
        })
        .build()

      expect(Customer.name).toBe('Customer')
      expect(Customer.fields).toHaveProperty('name')
      expect(Customer.fields).toHaveProperty('email')
    })

    it('should generate validation schema from fields', () => {
      const Customer = defineResource('Customer')
        .fields({
          name: { type: 'string', required: true },
          age: { type: 'number', required: false },
          email: { type: 'string', format: 'email' },
        })
        .build()

      expect(Customer.schema).toBeDefined()

      // Valid data should pass
      const validData = { name: 'Alice', age: 30, email: 'alice@example.com' }
      const result = Customer.schema.safeParse(validData)
      expect(result.success).toBe(true)

      // Missing required field should fail
      const invalidData = { age: 30 }
      const invalidResult = Customer.schema.safeParse(invalidData)
      expect(invalidResult.success).toBe(false)
    })

    it('should support different field types', () => {
      const Product = defineResource('Product')
        .fields({
          name: { type: 'string', required: true },
          price: { type: 'number', required: true, min: 0 },
          quantity: { type: 'integer', required: true },
          inStock: { type: 'boolean', required: true },
          tags: { type: 'array', items: 'string' },
          metadata: { type: 'object' },
          status: { type: 'enum', values: ['draft', 'published', 'archived'] },
        })
        .build()

      expect((Product.fields.price as NumberFieldDef).min).toBe(0)
      expect((Product.fields.status as EnumFieldDef).values).toEqual(['draft', 'published', 'archived'])
    })
  })

  describe('Validation Rules', () => {
    it('should support string validation rules', () => {
      const User = defineResource('User')
        .fields({
          username: {
            type: 'string',
            required: true,
            minLength: 3,
            maxLength: 20,
            pattern: /^[a-zA-Z0-9_]+$/
          },
          bio: {
            type: 'string',
            maxLength: 500
          }
        })
        .build()

      // Valid username
      expect(User.schema.safeParse({ username: 'john_doe', bio: 'Hello' }).success).toBe(true)

      // Too short
      expect(User.schema.safeParse({ username: 'ab' }).success).toBe(false)

      // Invalid pattern
      expect(User.schema.safeParse({ username: 'john doe' }).success).toBe(false)
    })

    it('should support number validation rules', () => {
      const Product = defineResource('Product')
        .fields({
          price: { type: 'number', required: true, min: 0, max: 999999 },
          rating: { type: 'number', min: 0, max: 5 },
        })
        .build()

      expect(Product.schema.safeParse({ price: 100, rating: 4.5 }).success).toBe(true)
      expect(Product.schema.safeParse({ price: -10 }).success).toBe(false)
      expect(Product.schema.safeParse({ price: 100, rating: 6 }).success).toBe(false)
    })
  })

  describe('Relations', () => {
    it('should define hasMany relations', () => {
      const Customer = defineResource('Customer')
        .fields({
          name: { type: 'string', required: true },
        })
        .relations({
          orders: { type: 'hasMany', resource: 'Order' },
          addresses: { type: 'hasMany', resource: 'Address' },
        })
        .build()

      expect(Customer.relations).toHaveProperty('orders')
      expect(Customer.relations?.orders.type).toBe('hasMany')
      expect(Customer.relations?.orders.resource).toBe('Order')
    })

    it('should define belongsTo relations', () => {
      const Order = defineResource('Order')
        .fields({
          total: { type: 'number', required: true },
        })
        .relations({
          customer: { type: 'belongsTo', resource: 'Customer' },
        })
        .build()

      expect(Order.relations?.customer.type).toBe('belongsTo')
    })

    it('should define hasOne relations', () => {
      const User = defineResource('User')
        .fields({
          email: { type: 'string', required: true },
        })
        .relations({
          profile: { type: 'hasOne', resource: 'Profile' },
        })
        .build()

      expect(User.relations?.profile.type).toBe('hasOne')
    })
  })

  describe('Custom Actions', () => {
    it('should define custom actions with handlers', () => {
      const Customer = defineResource('Customer')
        .fields({
          name: { type: 'string', required: true },
          plan: { type: 'string', required: true },
        })
        .actions({
          upgrade: {
            method: 'POST',
            handler: async (ctx: Context) => {
              return { upgraded: true }
            }
          },
          downgrade: {
            method: 'POST',
            handler: async (ctx: Context) => {
              return { downgraded: true }
            }
          }
        })
        .build()

      expect(Customer.actions).toHaveProperty('upgrade')
      expect(Customer.actions?.upgrade.method).toBe('POST')
      expect(Customer.actions?.upgrade.handler).toBeDefined()
    })
  })

  describe('Hooks', () => {
    it('should support lifecycle hooks', () => {
      let beforeCreateCalled = false
      let afterCreateCalled = false
      let beforeUpdateCalled = false
      let afterUpdateCalled = false

      interface CustomerData {
        name: string
        createdAt?: string
        updatedAt?: string
      }

      const Customer = defineResource<CustomerData>('Customer')
        .fields({
          name: { type: 'string', required: true },
        })
        .hooks({
          beforeCreate: async (data) => {
            beforeCreateCalled = true
            return { ...data, createdAt: new Date().toISOString() }
          },
          afterCreate: async (data) => {
            afterCreateCalled = true
            return data
          },
          beforeUpdate: async (id, data) => {
            beforeUpdateCalled = true
            return { ...data, updatedAt: new Date().toISOString() }
          },
          afterUpdate: async (id, data) => {
            afterUpdateCalled = true
            return data
          },
        })
        .build()

      expect(Customer.hooks).toBeDefined()
      expect(Customer.hooks?.beforeCreate).toBeDefined()
      expect(Customer.hooks?.afterCreate).toBeDefined()
    })

    it('should support validation hooks', () => {
      interface CustomerData {
        email: string
      }

      const Customer = defineResource<CustomerData>('Customer')
        .fields({
          email: { type: 'string', required: true },
        })
        .hooks({
          beforeValidate: async (data) => {
            return { ...data, email: data.email?.toLowerCase() }
          },
        })
        .build()

      expect(Customer.hooks?.beforeValidate).toBeDefined()
    })
  })

  describe('Computed Fields', () => {
    it('should define computed fields', () => {
      interface CustomerData {
        firstName: string
        lastName: string
      }

      const Customer = defineResource<CustomerData>('Customer')
        .fields({
          firstName: { type: 'string', required: true },
          lastName: { type: 'string', required: true },
        })
        .computed({
          fullName: (data) => `${data.firstName} ${data.lastName}`,
          displayName: (data) => data.firstName,
        })
        .build()

      expect(Customer.computed).toHaveProperty('fullName')
      expect(Customer.computed?.fullName({ firstName: 'John', lastName: 'Doe' })).toBe('John Doe')
    })
  })

  describe('Route Generation', () => {
    it('should generate CRUD routes definition', () => {
      const Customer = defineResource('Customer')
        .fields({
          name: { type: 'string', required: true },
        })
        .build()

      const routes = Customer.routes
      expect(routes).toBeDefined()
      expect(routes.list).toBeDefined()
      expect(routes.create).toBeDefined()
      expect(routes.get).toBeDefined()
      expect(routes.update).toBeDefined()
      expect(routes.delete).toBeDefined()
    })

    it('should include custom actions in routes', () => {
      const Customer = defineResource('Customer')
        .fields({
          name: { type: 'string', required: true },
        })
        .actions({
          upgrade: {
            method: 'POST',
            handler: async (ctx) => ({ upgraded: true })
          }
        })
        .build()

      expect(Customer.routes.actions).toHaveProperty('upgrade')
    })

    it('should include relation routes', () => {
      const Customer = defineResource('Customer')
        .fields({
          name: { type: 'string', required: true },
        })
        .relations({
          orders: { type: 'hasMany', resource: 'Order' },
        })
        .build()

      expect(Customer.routes.relations).toHaveProperty('orders')
    })
  })

  describe('Resource Registry', () => {
    it('should register resources globally', () => {
      clearRegistry()

      defineResource('Customer')
        .fields({ name: { type: 'string' } })
        .build()

      defineResource('Order')
        .fields({ total: { type: 'number' } })
        .build()

      expect(getResource('Customer')).toBeDefined()
      expect(getResource('Order')).toBeDefined()

      const allResources = getAllResources()
      expect(Object.keys(allResources)).toHaveLength(2)

      clearRegistry()
    })
  })

  describe('Fluent API', () => {
    it('should support method chaining', () => {
      interface CustomerData {
        name: string
      }

      const resource = defineResource<CustomerData>('Customer')
        .fields({ name: { type: 'string', required: true } })
        .relations({ orders: { type: 'hasMany', resource: 'Order' } })
        .actions({ upgrade: { method: 'POST', handler: async (ctx) => ({}) } })
        .hooks({ beforeCreate: async (data) => data })
        .computed({ displayName: (data) => data.name })
        .build()

      expect(resource.name).toBe('Customer')
      expect(resource.fields).toBeDefined()
      expect(resource.relations).toBeDefined()
      expect(resource.actions).toBeDefined()
      expect(resource.hooks).toBeDefined()
      expect(resource.computed).toBeDefined()
    })
  })
})
