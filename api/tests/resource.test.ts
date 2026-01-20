import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  defineResource,
  getResource,
  getAllResources,
  clearRegistry,
  clearGlobalRegistry,
  createResourceContext,
  runWithResourceContext,
  getCurrentResourceContext,
  getOrCreateResourceContext,
  type NumberFieldDef,
  type EnumFieldDef,
  type ResourceContext,
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
        createdAt: string | null
        updatedAt: string | null
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
        [key: string]: string // Index signature for StorableData compatibility
      }

      const Customer = defineResource<CustomerData>('Customer')
        .fields({
          email: { type: 'string', required: true },
        })
        .hooks({
          beforeValidate: async (data): Promise<Partial<CustomerData>> => {
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
        [key: string]: string // Index signature for StorableData compatibility
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
        [key: string]: string // Index signature for StorableData compatibility
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

  // ============================================================================
  // Request-Scoped Context Tests (do-9jh4 fix)
  // ============================================================================
  describe('Request-Scoped Resource Context', () => {
    beforeEach(() => {
      // Clear global registry before each test
      clearGlobalRegistry()
    })

    afterEach(() => {
      // Cleanup global registry after each test
      clearGlobalRegistry()
    })

    describe('createResourceContext', () => {
      it('should create isolated resource contexts', () => {
        const ctx1 = createResourceContext()
        const ctx2 = createResourceContext()

        // Register a resource in context 1
        ctx1.registerResource('TenantAResource', {
          name: 'TenantAResource',
          fields: { data: { type: 'string' } },
          schema: z.object({ data: z.string() }),
          routes: {
            list: { method: 'GET', path: '/tenantaresource' },
            create: { method: 'POST', path: '/tenantaresource' },
            get: { method: 'GET', path: '/tenantaresource/:id' },
            update: { method: 'PUT', path: '/tenantaresource/:id' },
            delete: { method: 'DELETE', path: '/tenantaresource/:id' },
          },
        })

        // Context 1 should have the resource
        expect(ctx1.getResource('TenantAResource')).toBeDefined()
        expect(ctx1.getResource('TenantAResource')?.name).toBe('TenantAResource')

        // Context 2 should NOT have the resource (isolation)
        expect(ctx2.getResource('TenantAResource')).toBeUndefined()

        // Global registry should NOT have the resource
        expect(getResource('TenantAResource')).toBeUndefined()
      })

      it('should support getAllResources per context', () => {
        const ctx = createResourceContext()

        ctx.registerResource('Resource1', {
          name: 'Resource1',
          fields: {},
          schema: z.object({}),
          routes: {
            list: { method: 'GET', path: '/resource1' },
            create: { method: 'POST', path: '/resource1' },
            get: { method: 'GET', path: '/resource1/:id' },
            update: { method: 'PUT', path: '/resource1/:id' },
            delete: { method: 'DELETE', path: '/resource1/:id' },
          },
        })

        ctx.registerResource('Resource2', {
          name: 'Resource2',
          fields: {},
          schema: z.object({}),
          routes: {
            list: { method: 'GET', path: '/resource2' },
            create: { method: 'POST', path: '/resource2' },
            get: { method: 'GET', path: '/resource2/:id' },
            update: { method: 'PUT', path: '/resource2/:id' },
            delete: { method: 'DELETE', path: '/resource2/:id' },
          },
        })

        const all = ctx.getAllResources()
        expect(Object.keys(all)).toHaveLength(2)
        expect(all.Resource1).toBeDefined()
        expect(all.Resource2).toBeDefined()
      })

      it('should support clearRegistry per context', () => {
        const ctx = createResourceContext()

        ctx.registerResource('TestResource', {
          name: 'TestResource',
          fields: {},
          schema: z.object({}),
          routes: {
            list: { method: 'GET', path: '/testresource' },
            create: { method: 'POST', path: '/testresource' },
            get: { method: 'GET', path: '/testresource/:id' },
            update: { method: 'PUT', path: '/testresource/:id' },
            delete: { method: 'DELETE', path: '/testresource/:id' },
          },
        })

        expect(ctx.getResource('TestResource')).toBeDefined()

        ctx.clearRegistry()

        expect(ctx.getResource('TestResource')).toBeUndefined()
      })

      it('should support cleanup method', () => {
        const ctx = createResourceContext()

        ctx.registerResource('CleanupTest', {
          name: 'CleanupTest',
          fields: {},
          schema: z.object({}),
          routes: {
            list: { method: 'GET', path: '/cleanuptest' },
            create: { method: 'POST', path: '/cleanuptest' },
            get: { method: 'GET', path: '/cleanuptest/:id' },
            update: { method: 'PUT', path: '/cleanuptest/:id' },
            delete: { method: 'DELETE', path: '/cleanuptest/:id' },
          },
        })

        expect(ctx.getResource('CleanupTest')).toBeDefined()

        ctx.cleanup()

        expect(ctx.getResource('CleanupTest')).toBeUndefined()
      })
    })

    describe('runWithResourceContext', () => {
      it('should provide isolated context via getCurrentResourceContext', async () => {
        // Define a resource in the global registry first
        defineResource('GlobalResource')
          .fields({ name: { type: 'string' } })
          .build()

        let innerContext: ResourceContext | undefined

        await runWithResourceContext(async () => {
          innerContext = getCurrentResourceContext()

          // Register a tenant-specific resource
          innerContext?.registerResource('TenantResource', {
            name: 'TenantResource',
            fields: { tenantData: { type: 'string' } },
            schema: z.object({ tenantData: z.string() }),
            routes: {
              list: { method: 'GET', path: '/tenantresource' },
              create: { method: 'POST', path: '/tenantresource' },
              get: { method: 'GET', path: '/tenantresource/:id' },
              update: { method: 'PUT', path: '/tenantresource/:id' },
              delete: { method: 'DELETE', path: '/tenantresource/:id' },
            },
          })

          // Inside the context, both should be accessible
          expect(innerContext?.getResource('TenantResource')).toBeDefined()
        })

        // After runWithResourceContext completes, context is cleaned up
        expect(innerContext?.getResource('TenantResource')).toBeUndefined()

        // Global resource should still exist
        expect(getResource('GlobalResource')).toBeDefined()
      })

      it('should NOT leak state between concurrent requests', async () => {
        const results: { tenant: string; resources: string[] }[] = []

        // Simulate concurrent requests from different tenants
        await Promise.all([
          runWithResourceContext(async () => {
            const ctx = getCurrentResourceContext()!

            ctx.registerResource('TenantA_CustomResource', {
              name: 'TenantA_CustomResource',
              fields: {},
              schema: z.object({}),
              routes: {
                list: { method: 'GET', path: '/a' },
                create: { method: 'POST', path: '/a' },
                get: { method: 'GET', path: '/a/:id' },
                update: { method: 'PUT', path: '/a/:id' },
                delete: { method: 'DELETE', path: '/a/:id' },
              },
            })

            // Simulate some async work
            await new Promise((resolve) => setTimeout(resolve, 10))

            // Collect what resources are visible
            results.push({
              tenant: 'A',
              resources: Object.keys(ctx.getAllResources()),
            })
          }),

          runWithResourceContext(async () => {
            const ctx = getCurrentResourceContext()!

            ctx.registerResource('TenantB_CustomResource', {
              name: 'TenantB_CustomResource',
              fields: {},
              schema: z.object({}),
              routes: {
                list: { method: 'GET', path: '/b' },
                create: { method: 'POST', path: '/b' },
                get: { method: 'GET', path: '/b/:id' },
                update: { method: 'PUT', path: '/b/:id' },
                delete: { method: 'DELETE', path: '/b/:id' },
              },
            })

            ctx.registerResource('TenantB_AnotherResource', {
              name: 'TenantB_AnotherResource',
              fields: {},
              schema: z.object({}),
              routes: {
                list: { method: 'GET', path: '/b2' },
                create: { method: 'POST', path: '/b2' },
                get: { method: 'GET', path: '/b2/:id' },
                update: { method: 'PUT', path: '/b2/:id' },
                delete: { method: 'DELETE', path: '/b2/:id' },
              },
            })

            // Simulate some async work
            await new Promise((resolve) => setTimeout(resolve, 5))

            results.push({
              tenant: 'B',
              resources: Object.keys(ctx.getAllResources()),
            })
          }),
        ])

        // Verify no state leakage
        const tenantA = results.find((r) => r.tenant === 'A')!
        const tenantB = results.find((r) => r.tenant === 'B')!

        // Tenant A should only see its own resource
        expect(tenantA.resources).toContain('TenantA_CustomResource')
        expect(tenantA.resources).not.toContain('TenantB_CustomResource')
        expect(tenantA.resources).not.toContain('TenantB_AnotherResource')

        // Tenant B should only see its own resources
        expect(tenantB.resources).toContain('TenantB_CustomResource')
        expect(tenantB.resources).toContain('TenantB_AnotherResource')
        expect(tenantB.resources).not.toContain('TenantA_CustomResource')
      })
    })

    describe('getOrCreateResourceContext', () => {
      it('should return existing context when inside runWithResourceContext', async () => {
        await runWithResourceContext(async () => {
          const ctx1 = getCurrentResourceContext()
          const ctx2 = getOrCreateResourceContext()

          // Should be the same context
          expect(ctx1).toBe(ctx2)
        })
      })

      it('should return global context when not inside runWithResourceContext', () => {
        // Not inside runWithResourceContext
        const ctx = getOrCreateResourceContext()

        // Register via returned context
        ctx.registerResource('ViaGetOrCreate', {
          name: 'ViaGetOrCreate',
          fields: {},
          schema: z.object({}),
          routes: {
            list: { method: 'GET', path: '/via' },
            create: { method: 'POST', path: '/via' },
            get: { method: 'GET', path: '/via/:id' },
            update: { method: 'PUT', path: '/via/:id' },
            delete: { method: 'DELETE', path: '/via/:id' },
          },
        })

        // Should be accessible via global getResource
        expect(getResource('ViaGetOrCreate')).toBeDefined()
      })
    })

    describe('defineResource with context', () => {
      it('should register to context when inside runWithResourceContext', async () => {
        await runWithResourceContext(async () => {
          // Define resource while inside a context
          defineResource('ContextResource')
            .fields({ name: { type: 'string' } })
            .build()

          // Should be accessible via context
          const ctx = getCurrentResourceContext()!
          expect(ctx.getResource('ContextResource')).toBeDefined()
        })

        // After context cleanup, should NOT be in global registry
        expect(getResource('ContextResource')).toBeUndefined()
      })

      it('should register to global when not inside runWithResourceContext', () => {
        // Define resource outside any context
        defineResource('GlobalOnlyResource')
          .fields({ name: { type: 'string' } })
          .build()

        // Should be in global registry
        expect(getResource('GlobalOnlyResource')).toBeDefined()
      })
    })

    describe('State Leakage Prevention (do-9jh4)', () => {
      it('should prevent tenant A from seeing tenant B resources', async () => {
        // This is the critical test that demonstrates the fix for do-9jh4
        // Before the fix, the global resourceRegistry would leak state between tenants

        // Tenant A's request
        let tenantASeesCustomResource = false
        let tenantASeesOtherTenantResource = false

        await runWithResourceContext(async () => {
          defineResource('TenantA_Product')
            .fields({ sku: { type: 'string' } })
            .build()

          tenantASeesCustomResource = getResource('TenantA_Product') !== undefined
          tenantASeesOtherTenantResource = getResource('TenantB_Product') !== undefined
        })

        // Tenant B's request (after tenant A)
        let tenantBSeesCustomResource = false
        let tenantBSeesOtherTenantResource = false

        await runWithResourceContext(async () => {
          defineResource('TenantB_Product')
            .fields({ sku: { type: 'string' } })
            .build()

          tenantBSeesCustomResource = getResource('TenantB_Product') !== undefined
          tenantBSeesOtherTenantResource = getResource('TenantA_Product') !== undefined
        })

        // Verify isolation
        expect(tenantASeesCustomResource).toBe(true) // Tenant A sees their own resource
        expect(tenantASeesOtherTenantResource).toBe(false) // Tenant A does NOT see B's resource

        expect(tenantBSeesCustomResource).toBe(true) // Tenant B sees their own resource
        expect(tenantBSeesOtherTenantResource).toBe(false) // Tenant B does NOT see A's resource

        // Global registry should be clean after both contexts
        expect(getResource('TenantA_Product')).toBeUndefined()
        expect(getResource('TenantB_Product')).toBeUndefined()
      })
    })
  })
})
