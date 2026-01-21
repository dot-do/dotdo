// Tests for @dotdo/db storage.ts abstract storage primitives
// Tests the interfaces, types, and createTypedStorage utility
import { describe, it, expect, beforeEach } from 'vitest'
import { createTypedStorage } from '../storage'
import type {
  StorageAdapter,
  TypedStorageAdapter,
  ListOptions,
  ListResult,
  StorageAdapterOptions,
  SqlStorageAdapterOptions,
  StorageAdapterFactory
} from '../storage'
import { createMemoryStorageAdapter } from '../adapters/memory'
import type { StorableData, JsonValue } from '../types'

// Test types that extend StorableData
interface Customer extends StorableData {
  name: string
  email: string
  age: number
  active: boolean
  tags: string[]
  metadata: { tier: string; since: number }
}

interface Order extends StorableData {
  customerId: string
  items: Array<{ sku: string; qty: number; price: number }>
  total: number
  status: string
}

describe('storage.ts - Abstract Storage Primitives', () => {
  describe('createTypedStorage', () => {
    let adapter: StorageAdapter
    let typedCustomerStorage: TypedStorageAdapter<Customer>

    beforeEach(() => {
      adapter = createMemoryStorageAdapter()
      typedCustomerStorage = createTypedStorage<Customer>(adapter)
    })

    describe('get/put operations', () => {
      it('should store and retrieve typed values', async () => {
        const customer: Customer = {
          name: 'Alice',
          email: 'alice@example.com',
          age: 30,
          active: true,
          tags: ['vip', 'early-adopter'],
          metadata: { tier: 'gold', since: 2020 }
        }

        await typedCustomerStorage.put('customer:1', customer)
        const retrieved = await typedCustomerStorage.get('customer:1')

        expect(retrieved).toEqual(customer)
      })

      it('should return undefined for non-existent key', async () => {
        const result = await typedCustomerStorage.get('nonexistent')
        expect(result).toBeUndefined()
      })

      it('should preserve complex nested structures', async () => {
        const customer: Customer = {
          name: 'Bob',
          email: 'bob@example.com',
          age: 25,
          active: false,
          tags: [],
          metadata: { tier: 'bronze', since: 2023 }
        }

        await typedCustomerStorage.put('customer:2', customer)
        const retrieved = await typedCustomerStorage.get('customer:2')

        expect(retrieved?.metadata.tier).toBe('bronze')
        expect(retrieved?.tags).toEqual([])
      })
    })

    describe('getMany/putMany operations', () => {
      it('should store and retrieve multiple typed values', async () => {
        const customers = new Map<string, Customer>([
          [
            'customer:1',
            {
              name: 'Alice',
              email: 'alice@example.com',
              age: 30,
              active: true,
              tags: ['vip'],
              metadata: { tier: 'gold', since: 2020 }
            }
          ],
          [
            'customer:2',
            {
              name: 'Bob',
              email: 'bob@example.com',
              age: 25,
              active: true,
              tags: [],
              metadata: { tier: 'silver', since: 2022 }
            }
          ]
        ])

        await typedCustomerStorage.putMany(customers)
        const retrieved = await typedCustomerStorage.getMany([
          'customer:1',
          'customer:2',
          'customer:3'
        ])

        expect(retrieved.size).toBe(2)
        expect(retrieved.get('customer:1')?.name).toBe('Alice')
        expect(retrieved.get('customer:2')?.name).toBe('Bob')
        expect(retrieved.has('customer:3')).toBe(false)
      })

      it('should handle empty key array', async () => {
        const result = await typedCustomerStorage.getMany([])
        expect(result.size).toBe(0)
      })
    })

    describe('delete/deleteMany operations', () => {
      it('should delete a typed entry', async () => {
        const customer: Customer = {
          name: 'Alice',
          email: 'alice@example.com',
          age: 30,
          active: true,
          tags: [],
          metadata: { tier: 'gold', since: 2020 }
        }

        await typedCustomerStorage.put('customer:1', customer)
        await typedCustomerStorage.delete('customer:1')

        const result = await typedCustomerStorage.get('customer:1')
        expect(result).toBeUndefined()
      })

      it('should delete multiple typed entries', async () => {
        const customers = new Map<string, Customer>([
          [
            'customer:1',
            {
              name: 'Alice',
              email: 'a@example.com',
              age: 30,
              active: true,
              tags: [],
              metadata: { tier: 'gold', since: 2020 }
            }
          ],
          [
            'customer:2',
            {
              name: 'Bob',
              email: 'b@example.com',
              age: 25,
              active: true,
              tags: [],
              metadata: { tier: 'silver', since: 2022 }
            }
          ],
          [
            'customer:3',
            {
              name: 'Charlie',
              email: 'c@example.com',
              age: 35,
              active: false,
              tags: [],
              metadata: { tier: 'bronze', since: 2023 }
            }
          ]
        ])

        await typedCustomerStorage.putMany(customers)
        await typedCustomerStorage.deleteMany(['customer:1', 'customer:3'])

        expect(await typedCustomerStorage.has('customer:1')).toBe(false)
        expect(await typedCustomerStorage.has('customer:2')).toBe(true)
        expect(await typedCustomerStorage.has('customer:3')).toBe(false)
      })
    })

    describe('list operation', () => {
      it('should list typed entries', async () => {
        const customers = new Map<string, Customer>([
          [
            'customer:1',
            {
              name: 'Alice',
              email: 'a@example.com',
              age: 30,
              active: true,
              tags: [],
              metadata: { tier: 'gold', since: 2020 }
            }
          ],
          [
            'customer:2',
            {
              name: 'Bob',
              email: 'b@example.com',
              age: 25,
              active: true,
              tags: [],
              metadata: { tier: 'silver', since: 2022 }
            }
          ]
        ])

        await typedCustomerStorage.putMany(customers)
        const result = await typedCustomerStorage.list()

        expect(result.entries.size).toBe(2)
        expect(result.hasMore).toBe(false)
      })

      it('should support prefix filtering with typed results', async () => {
        // Mix customer and order storage in same adapter
        await adapter.put('customer:1', { name: 'Alice', email: 'a@e.com', age: 30, active: true, tags: [], metadata: { tier: 'gold', since: 2020 } })
        await adapter.put('customer:2', { name: 'Bob', email: 'b@e.com', age: 25, active: true, tags: [], metadata: { tier: 'silver', since: 2022 } })
        await adapter.put('order:1', { customerId: 'customer:1', items: [], total: 100, status: 'pending' })

        const result = await typedCustomerStorage.list({ prefix: 'customer:' })

        expect(result.entries.size).toBe(2)
        // Values should be typed as Customer
        const alice = result.entries.get('customer:1')
        expect(alice?.name).toBe('Alice')
      })

      it('should support pagination with typed results', async () => {
        const customers = new Map<string, Customer>()
        for (let i = 1; i <= 5; i++) {
          customers.set(`customer:${i}`, {
            name: `Customer ${i}`,
            email: `c${i}@example.com`,
            age: 20 + i,
            active: true,
            tags: [],
            metadata: { tier: 'basic', since: 2020 + i }
          })
        }

        await typedCustomerStorage.putMany(customers)

        const page1 = await typedCustomerStorage.list({ limit: 2 })
        expect(page1.entries.size).toBe(2)
        expect(page1.hasMore).toBe(true)
        expect(page1.cursor).toBeDefined()

        const page2 = await typedCustomerStorage.list({ limit: 2, cursor: page1.cursor })
        expect(page2.entries.size).toBe(2)
        expect(page2.hasMore).toBe(true)

        const page3 = await typedCustomerStorage.list({ limit: 2, cursor: page2.cursor })
        expect(page3.entries.size).toBe(1)
        expect(page3.hasMore).toBe(false)
      })
    })

    describe('transaction operation', () => {
      it('should commit on successful transaction', async () => {
        const customer: Customer = {
          name: 'Alice',
          email: 'alice@example.com',
          age: 30,
          active: true,
          tags: [],
          metadata: { tier: 'gold', since: 2020 }
        }

        await typedCustomerStorage.transaction(async () => {
          await typedCustomerStorage.put('customer:1', customer)
          await typedCustomerStorage.put('customer:2', { ...customer, name: 'Bob' })
        })

        expect(await typedCustomerStorage.get('customer:1')).toBeDefined()
        expect(await typedCustomerStorage.get('customer:2')).toBeDefined()
      })

      it('should rollback on transaction error', async () => {
        const customer: Customer = {
          name: 'Original',
          email: 'original@example.com',
          age: 30,
          active: true,
          tags: [],
          metadata: { tier: 'gold', since: 2020 }
        }

        await typedCustomerStorage.put('customer:1', customer)

        try {
          await typedCustomerStorage.transaction(async () => {
            await typedCustomerStorage.put('customer:1', { ...customer, name: 'Modified' })
            await typedCustomerStorage.put('customer:2', { ...customer, name: 'New' })
            throw new Error('Simulated failure')
          })
        } catch {
          // Expected
        }

        // Should be rolled back
        const retrieved = await typedCustomerStorage.get('customer:1')
        expect(retrieved?.name).toBe('Original')
        expect(await typedCustomerStorage.has('customer:2')).toBe(false)
      })

      it('should return transaction result', async () => {
        const result = await typedCustomerStorage.transaction(async () => {
          await typedCustomerStorage.put('customer:1', {
            name: 'Alice',
            email: 'alice@example.com',
            age: 30,
            active: true,
            tags: [],
            metadata: { tier: 'gold', since: 2020 }
          })
          return 'success'
        })

        expect(result).toBe('success')
      })
    })

    describe('has operation', () => {
      it('should check existence of typed entries', async () => {
        const customer: Customer = {
          name: 'Alice',
          email: 'alice@example.com',
          age: 30,
          active: true,
          tags: [],
          metadata: { tier: 'gold', since: 2020 }
        }

        await typedCustomerStorage.put('customer:1', customer)

        expect(await typedCustomerStorage.has('customer:1')).toBe(true)
        expect(await typedCustomerStorage.has('customer:2')).toBe(false)
      })
    })

    describe('clear operation', () => {
      it('should clear all typed entries', async () => {
        const customers = new Map<string, Customer>([
          [
            'customer:1',
            {
              name: 'Alice',
              email: 'a@example.com',
              age: 30,
              active: true,
              tags: [],
              metadata: { tier: 'gold', since: 2020 }
            }
          ],
          [
            'customer:2',
            {
              name: 'Bob',
              email: 'b@example.com',
              age: 25,
              active: true,
              tags: [],
              metadata: { tier: 'silver', since: 2022 }
            }
          ]
        ])

        await typedCustomerStorage.putMany(customers)
        await typedCustomerStorage.clear()

        expect(await typedCustomerStorage.count()).toBe(0)
      })
    })

    describe('count operation', () => {
      it('should count typed entries', async () => {
        const customers = new Map<string, Customer>([
          [
            'customer:1',
            {
              name: 'Alice',
              email: 'a@example.com',
              age: 30,
              active: true,
              tags: [],
              metadata: { tier: 'gold', since: 2020 }
            }
          ],
          [
            'customer:2',
            {
              name: 'Bob',
              email: 'b@example.com',
              age: 25,
              active: true,
              tags: [],
              metadata: { tier: 'silver', since: 2022 }
            }
          ]
        ])

        await typedCustomerStorage.putMany(customers)
        expect(await typedCustomerStorage.count()).toBe(2)
      })

      it('should count with prefix', async () => {
        await adapter.put('customer:1', { name: 'Alice', email: 'a@e.com', age: 30, active: true, tags: [], metadata: { tier: 'gold', since: 2020 } })
        await adapter.put('customer:2', { name: 'Bob', email: 'b@e.com', age: 25, active: true, tags: [], metadata: { tier: 'silver', since: 2022 } })
        await adapter.put('order:1', { customerId: '1', items: [], total: 100, status: 'pending' })

        expect(await typedCustomerStorage.count('customer:')).toBe(2)
        expect(await typedCustomerStorage.count('order:')).toBe(1)
      })
    })
  })

  describe('TypedStorageAdapter - Multiple Types', () => {
    let adapter: StorageAdapter
    let customerStorage: TypedStorageAdapter<Customer>
    let orderStorage: TypedStorageAdapter<Order>

    beforeEach(() => {
      adapter = createMemoryStorageAdapter()
      customerStorage = createTypedStorage<Customer>(adapter)
      orderStorage = createTypedStorage<Order>(adapter)
    })

    it('should allow different typed wrappers over same adapter', async () => {
      const customer: Customer = {
        name: 'Alice',
        email: 'alice@example.com',
        age: 30,
        active: true,
        tags: ['vip'],
        metadata: { tier: 'gold', since: 2020 }
      }

      const order: Order = {
        customerId: 'customer:1',
        items: [{ sku: 'PROD-001', qty: 2, price: 50 }],
        total: 100,
        status: 'pending'
      }

      await customerStorage.put('customer:1', customer)
      await orderStorage.put('order:1', order)

      const retrievedCustomer = await customerStorage.get('customer:1')
      const retrievedOrder = await orderStorage.get('order:1')

      expect(retrievedCustomer?.name).toBe('Alice')
      expect(retrievedOrder?.total).toBe(100)

      // Both share the same underlying storage
      expect(await adapter.count()).toBe(2)
    })

    it('should maintain type safety across operations', async () => {
      const customer: Customer = {
        name: 'Alice',
        email: 'alice@example.com',
        age: 30,
        active: true,
        tags: [],
        metadata: { tier: 'gold', since: 2020 }
      }

      await customerStorage.put('customer:1', customer)

      // This would be a type error if uncommented (order.items is required)
      // await orderStorage.put('order:1', customer)

      // Cross-retrieve still works (it's the same adapter) but type is different
      const asOrder = await orderStorage.get('customer:1')
      // Runtime: asOrder would have customer data, but TypeScript thinks it's Order
      // This demonstrates that typed storage provides compile-time safety, not runtime validation
      expect(asOrder).toBeDefined()
    })
  })

  describe('ListOptions interface', () => {
    let adapter: StorageAdapter

    beforeEach(() => {
      adapter = createMemoryStorageAdapter()
    })

    it('should accept all optional ListOptions fields', async () => {
      await adapter.putMany(
        new Map([
          ['a', 1],
          ['b', 2],
          ['c', 3]
        ])
      )

      const options: ListOptions = {
        prefix: undefined,
        limit: 10,
        cursor: undefined,
        includeValues: true
      }

      const result = await adapter.list(options)
      expect(result.entries.size).toBe(3)
    })

    it('should work with minimal options', async () => {
      await adapter.put('key', 'value')

      const result = await adapter.list({})
      expect(result.entries.size).toBe(1)
    })

    it('should work with no options', async () => {
      await adapter.put('key', 'value')

      const result = await adapter.list()
      expect(result.entries.size).toBe(1)
    })
  })

  describe('ListResult interface', () => {
    let adapter: StorageAdapter

    beforeEach(() => {
      adapter = createMemoryStorageAdapter()
    })

    it('should have correct structure for single page', async () => {
      await adapter.put('key', 'value')

      const result: ListResult<string> = await adapter.list()

      expect(result.entries).toBeInstanceOf(Map)
      expect(typeof result.hasMore).toBe('boolean')
      expect(result.hasMore).toBe(false)
      expect(result.cursor).toBeUndefined()
    })

    it('should have correct structure for paginated results', async () => {
      await adapter.putMany(
        new Map([
          ['a', 1],
          ['b', 2],
          ['c', 3]
        ])
      )

      const result: ListResult<number> = await adapter.list({ limit: 2 })

      expect(result.entries.size).toBe(2)
      expect(result.hasMore).toBe(true)
      expect(result.cursor).toBeDefined()
      expect(typeof result.cursor).toBe('string')
    })
  })

  describe('StorageAdapterOptions interface', () => {
    it('should support namespace option', async () => {
      const options: StorageAdapterOptions = {
        namespace: 'test-ns'
      }

      const adapter = createMemoryStorageAdapter(options)
      await adapter.put('key', 'value')

      expect(await adapter.get('key')).toBe('value')
    })

    it('should support empty options', async () => {
      const options: StorageAdapterOptions = {}
      const adapter = createMemoryStorageAdapter(options)

      await adapter.put('key', 'value')
      expect(await adapter.get('key')).toBe('value')
    })
  })

  describe('SqlStorageAdapterOptions interface', () => {
    it('should extend StorageAdapterOptions with tableName', () => {
      const options: SqlStorageAdapterOptions = {
        namespace: 'test-ns',
        tableName: 'custom_kv_table'
      }

      expect(options.namespace).toBe('test-ns')
      expect(options.tableName).toBe('custom_kv_table')
    })
  })

  describe('StorageAdapterFactory type', () => {
    it('should type-check factory functions', () => {
      const factory: StorageAdapterFactory = (options) => {
        return createMemoryStorageAdapter(options)
      }

      const adapter = factory({ namespace: 'test' })
      expect(adapter).toBeDefined()
    })

    it('should type-check factory with extended options', () => {
      const factory: StorageAdapterFactory<SqlStorageAdapterOptions> = (options) => {
        // In real usage, this would create a SQLite adapter
        return createMemoryStorageAdapter(options)
      }

      const adapter = factory({ namespace: 'test', tableName: 'custom' })
      expect(adapter).toBeDefined()
    })
  })

  describe('StorageAdapter interface compliance', () => {
    let adapter: StorageAdapter

    beforeEach(() => {
      adapter = createMemoryStorageAdapter()
    })

    it('should implement all required methods', () => {
      expect(typeof adapter.get).toBe('function')
      expect(typeof adapter.getMany).toBe('function')
      expect(typeof adapter.put).toBe('function')
      expect(typeof adapter.putMany).toBe('function')
      expect(typeof adapter.delete).toBe('function')
      expect(typeof adapter.deleteMany).toBe('function')
      expect(typeof adapter.list).toBe('function')
      expect(typeof adapter.transaction).toBe('function')
      expect(typeof adapter.has).toBe('function')
      expect(typeof adapter.clear).toBe('function')
      expect(typeof adapter.count).toBe('function')
    })

    it('should return Promise from all async methods', async () => {
      expect(adapter.get('key')).toBeInstanceOf(Promise)
      expect(adapter.getMany(['key'])).toBeInstanceOf(Promise)
      expect(adapter.put('key', 'value')).toBeInstanceOf(Promise)
      expect(adapter.putMany(new Map())).toBeInstanceOf(Promise)
      expect(adapter.delete('key')).toBeInstanceOf(Promise)
      expect(adapter.deleteMany(['key'])).toBeInstanceOf(Promise)
      expect(adapter.list()).toBeInstanceOf(Promise)
      expect(adapter.transaction(async () => {})).toBeInstanceOf(Promise)
      expect(adapter.has('key')).toBeInstanceOf(Promise)
      expect(adapter.clear()).toBeInstanceOf(Promise)
      expect(adapter.count()).toBeInstanceOf(Promise)
    })
  })

  describe('JsonValue compatibility', () => {
    let adapter: StorageAdapter

    beforeEach(() => {
      adapter = createMemoryStorageAdapter()
    })

    it('should store and retrieve primitive JsonValues', async () => {
      await adapter.put('string', 'hello')
      await adapter.put('number', 42)
      await adapter.put('boolean', true)
      await adapter.put('null', null)

      expect(await adapter.get('string')).toBe('hello')
      expect(await adapter.get('number')).toBe(42)
      expect(await adapter.get('boolean')).toBe(true)
      expect(await adapter.get('null')).toBe(null)
    })

    it('should store and retrieve array JsonValues', async () => {
      const arr: JsonValue[] = [1, 'two', true, null, [1, 2, 3]]
      await adapter.put('array', arr)

      const result = await adapter.get<JsonValue[]>('array')
      expect(result).toEqual(arr)
    })

    it('should store and retrieve nested object JsonValues', async () => {
      const obj: JsonValue = {
        level1: {
          level2: {
            level3: {
              value: 'deep'
            }
          }
        }
      }

      await adapter.put('nested', obj)
      const result = await adapter.get<typeof obj>('nested')
      expect(result).toEqual(obj)
    })
  })

  describe('Edge cases', () => {
    let adapter: StorageAdapter

    beforeEach(() => {
      adapter = createMemoryStorageAdapter()
    })

    it('should handle empty string keys', async () => {
      await adapter.put('', 'empty key')
      expect(await adapter.get('')).toBe('empty key')
    })

    it('should handle keys with special characters', async () => {
      const specialKeys = [
        'key:with:colons',
        'key/with/slashes',
        'key.with.dots',
        'key-with-dashes',
        'key_with_underscores',
        'key with spaces',
        'key@with#special$chars'
      ]

      for (const key of specialKeys) {
        await adapter.put(key, `value for ${key}`)
      }

      for (const key of specialKeys) {
        expect(await adapter.get(key)).toBe(`value for ${key}`)
      }
    })

    it('should handle very long keys', async () => {
      const longKey = 'k'.repeat(10000)
      await adapter.put(longKey, 'value')

      expect(await adapter.get(longKey)).toBe('value')
    })

    it('should handle very large values', async () => {
      const largeValue = { data: 'x'.repeat(100000) }
      await adapter.put('large', largeValue)

      const result = await adapter.get<typeof largeValue>('large')
      expect(result?.data.length).toBe(100000)
    })

    it('should handle unicode in keys and values', async () => {
      await adapter.put('emoji:key', 'value')
      await adapter.put('key', 'emoji value')
      await adapter.put('', { message: '' })

      expect(await adapter.get('emoji:key')).toBe('value')
      expect(await adapter.get('key')).toBe('emoji value')
      expect(await adapter.get<{ message: string }>('')).toEqual({ message: '' })
    })

    it('should handle rapid put/get cycles', async () => {
      for (let i = 0; i < 100; i++) {
        await adapter.put(`key:${i}`, i)
      }

      for (let i = 0; i < 100; i++) {
        expect(await adapter.get(`key:${i}`)).toBe(i)
      }
    })

    it('should handle concurrent operations', async () => {
      const operations = []
      for (let i = 0; i < 50; i++) {
        operations.push(adapter.put(`concurrent:${i}`, i))
      }

      await Promise.all(operations)

      const getOperations = []
      for (let i = 0; i < 50; i++) {
        getOperations.push(adapter.get(`concurrent:${i}`))
      }

      const results = await Promise.all(getOperations)
      for (let i = 0; i < 50; i++) {
        expect(results[i]).toBe(i)
      }
    })
  })
})
