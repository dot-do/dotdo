import { describe, it, expect } from 'vitest'
import { generateSDK, SDKGenerator } from '../codegen/sdk'
import type { ResourceDefinition } from '../resource'
import { z } from 'zod'

describe('SDK Generation', () => {
  const customerSchema = z.object({
    $id: z.string(),
    name: z.string(),
    email: z.string(),
    plan: z.string().optional()
  })

  const orderSchema = z.object({
    $id: z.string(),
    customerId: z.string(),
    total: z.number(),
    status: z.string()
  })

  const customerResource: ResourceDefinition<z.infer<typeof customerSchema>> = {
    name: 'customers',
    schema: customerSchema,
    fields: {
      name: { type: 'string', required: true },
      email: { type: 'string', required: true },
      plan: { type: 'string', required: false }
    },
    relations: {
      orders: { type: 'hasMany', resource: 'orders' }
    },
    actions: {
      upgrade: {
        method: 'POST',
        handler: async () => ({})
      },
      downgrade: {
        method: 'POST',
        handler: async () => ({})
      }
    }
  }

  const orderResource: ResourceDefinition<z.infer<typeof orderSchema>> = {
    name: 'orders',
    schema: orderSchema,
    fields: {
      customerId: { type: 'string', required: true },
      total: { type: 'number', required: true },
      status: { type: 'string', required: true }
    },
    relations: {
      customer: { type: 'belongsTo', resource: 'customers' }
    }
  }

  describe('generateSDK', () => {
    it('should generate TypeScript SDK code from resources', () => {
      const sdkCode = generateSDK([customerResource, orderResource])

      expect(sdkCode).toContain('interface Customer')
      expect(sdkCode).toContain('interface Order')
      expect(sdkCode).toContain('export function createClient')
    })

    it('should include CRUD methods for each resource', () => {
      const sdkCode = generateSDK([customerResource])

      expect(sdkCode).toContain('.list(')
      expect(sdkCode).toContain('.get(')
      expect(sdkCode).toContain('.create(')
      expect(sdkCode).toContain('.update(')
      expect(sdkCode).toContain('.delete(')
    })

    it('should include relation traversal methods', () => {
      const sdkCode = generateSDK([customerResource])

      // Should support customers(id).orders.list()
      expect(sdkCode).toContain('orders')
    })

    it('should include custom action methods', () => {
      const sdkCode = generateSDK([customerResource])

      expect(sdkCode).toContain('upgrade')
      expect(sdkCode).toContain('downgrade')
    })

    it('should generate type-safe interfaces matching schemas', () => {
      const sdkCode = generateSDK([customerResource])

      expect(sdkCode).toContain('$id: string')
      expect(sdkCode).toContain('name: string')
      expect(sdkCode).toContain('email: string')
      expect(sdkCode).toContain('plan?: string')
    })

    it('should include error handling types', () => {
      const sdkCode = generateSDK([customerResource])

      expect(sdkCode).toContain('APIError')
    })

    it('should support both output to string and file', () => {
      const sdkCode = generateSDK([customerResource], { output: 'string' })
      expect(typeof sdkCode).toBe('string')
    })
  })

  describe('SDKGenerator class', () => {
    it('should generate types from resource definitions', () => {
      const generator = new SDKGenerator([customerResource])
      const types = generator.generateTypes()

      expect(types).toContain('interface Customer')
      expect(types).toContain('$id: string')
      expect(types).toContain('name: string')
      expect(types).toContain('email: string')
    })

    it('should generate client factory function', () => {
      const generator = new SDKGenerator([customerResource])
      const client = generator.generateClient()

      expect(client).toContain('createClient')
      expect(client).toContain('baseUrl')
      expect(client).toContain('apiKey')
    })

    it('should generate CRUD methods for a resource', () => {
      const generator = new SDKGenerator([customerResource])
      const methods = generator.generateMethods(customerResource)

      expect(methods).toContain('list(')
      expect(methods).toContain('get(id: string)')
      expect(methods).toContain('create(data:')
      expect(methods).toContain('update(id: string, data:')
      expect(methods).toContain('delete(id: string)')
    })

    it('should generate relation methods', () => {
      const generator = new SDKGenerator([customerResource])
      const methods = generator.generateMethods(customerResource)

      expect(methods).toContain('orders')
    })

    it('should generate action methods', () => {
      const generator = new SDKGenerator([customerResource])
      const methods = generator.generateMethods(customerResource)

      expect(methods).toContain('upgrade')
      expect(methods).toContain('downgrade')
    })

    it('should generate JSDoc comments', () => {
      const generator = new SDKGenerator([customerResource])
      const code = generator.generate()

      expect(code).toContain('/**')
      expect(code).toContain('*/')
      expect(code).toContain('@param')
    })

    it('should handle optional fields correctly', () => {
      const generator = new SDKGenerator([customerResource])
      const types = generator.generateTypes()

      expect(types).toContain('plan?: string')
    })

    it('should generate proper TypeScript types from Zod schema', () => {
      const generator = new SDKGenerator([orderResource])
      const types = generator.generateTypes()

      expect(types).toContain('interface Order')
      expect(types).toContain('customerId: string')
      expect(types).toContain('total: number')
      expect(types).toContain('status: string')
    })
  })

  describe('Generated SDK structure', () => {
    it('should export createClient function', () => {
      const sdkCode = generateSDK([customerResource])

      expect(sdkCode).toContain('export function createClient')
      expect(sdkCode).toContain('baseUrl: string')
    })

    it('should return resource methods from createClient', () => {
      const sdkCode = generateSDK([customerResource])

      expect(sdkCode).toContain('customers:')
      expect(sdkCode).toMatch(/return\s*{[\s\S]*customers:/)
    })

    it('should include headers configuration', () => {
      const sdkCode = generateSDK([customerResource])

      expect(sdkCode).toContain('apiKey')
      expect(sdkCode).toContain('headers')
      expect(sdkCode).toContain('Authorization')
    })

    it('should include request helper function', () => {
      const sdkCode = generateSDK([customerResource])

      expect(sdkCode).toContain('async function request')
      expect(sdkCode).toContain('fetch')
    })

    it('should handle API errors properly', () => {
      const sdkCode = generateSDK([customerResource])

      expect(sdkCode).toContain('throw new APIError')
      expect(sdkCode).toContain('class APIError extends Error')
    })
  })

  describe('Type safety', () => {
    it('should generate input types for create operations', () => {
      const sdkCode = generateSDK([customerResource])

      // Create should accept partial data without $id
      expect(sdkCode).toMatch(/create.*Omit<Customer.*\$id/)
    })

    it('should generate input types for update operations', () => {
      const sdkCode = generateSDK([customerResource])

      // Update should accept partial data
      expect(sdkCode).toMatch(/update.*Partial</)
    })

    it('should generate return types for all methods', () => {
      const sdkCode = generateSDK([customerResource])

      expect(sdkCode).toContain('Promise<Customer>')
      expect(sdkCode).toContain('Promise<Customer[]>')
      expect(sdkCode).toContain('Promise<void>')
    })
  })

  describe('Relation handling', () => {
    it('should generate nested resource access for hasMany relations', () => {
      const sdkCode = generateSDK([customerResource, orderResource])

      // Should support: customers(id).orders.list()
      expect(sdkCode).toContain('orders:')
    })

    it('should generate nested resource access for belongsTo relations', () => {
      const sdkCode = generateSDK([customerResource, orderResource])

      // Should support: orders(id).customer.get()
      expect(sdkCode).toContain('customer:')
    })
  })

  describe('Action handling', () => {
    it('should generate action methods with correct HTTP method', () => {
      const sdkCode = generateSDK([customerResource])

      // Actions should POST to the action endpoint
      expect(sdkCode).toContain('upgrade')
      expect(sdkCode).toContain('POST')
    })

    it('should accept parameters for actions', () => {
      const resourceWithParams: ResourceDefinition<any> = {
        ...customerResource,
        actions: {
          upgrade: {
            method: 'POST',
            handler: async () => ({})
          }
        }
      }

      const sdkCode = generateSDK([resourceWithParams])

      expect(sdkCode).toContain('upgrade')
    })
  })

  describe('Output options', () => {
    it('should support string output', () => {
      const result = generateSDK([customerResource], { output: 'string' })
      expect(typeof result).toBe('string')
    })

    it('should support tree-shaking with named exports', () => {
      const sdkCode = generateSDK([customerResource])

      // Each resource should be independently importable
      expect(sdkCode).toContain('export')
    })
  })
})
