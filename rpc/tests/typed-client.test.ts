import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createTypedClient,
  createTypedClientFromUrl,
  createTypedClientFromBinding,
  batchCalls,
  type ExtractMethodNames,
  type ExtractMethodParams,
  type ExtractMethodReturn,
  type MethodSignature,
  type PartialClient,
} from '../typed-client'

// Test interfaces
interface Profile {
  id: string
  name: string
  email: string
}

interface Order {
  id: string
  total: number
  items: string[]
}

// Sample DO class for type inference tests
class CustomerDO {
  async getProfile(id: string): Promise<Profile> {
    return { id, name: 'Test', email: 'test@example.com' }
  }

  async updateEmail(id: string, email: string): Promise<void> {}

  async listOrders(customerId: string, limit?: number): Promise<Order[]> {
    return []
  }

  async charge(amount: number, currency: string): Promise<{ receiptId: string }> {
    return { receiptId: 'receipt-123' }
  }

  // Non-async property (should be excluded from RPC client)
  name = 'CustomerDO'

  // Sync method (should be excluded from RPC client)
  syncMethod(): string {
    return 'sync'
  }
}

// Nested API interface
interface NestedAPI {
  users: {
    create(data: { name: string; email: string }): Promise<{ id: string }>
    get(id: string): Promise<Profile>
    delete(id: string): Promise<void>
  }
  posts: {
    list(limit?: number): Promise<{ posts: string[] }>
  }
}

describe('Typed RPC Client', () => {
  describe('createTypedClient', () => {
    let mockStub: { fetch: ReturnType<typeof vi.fn> }

    beforeEach(() => {
      mockStub = {
        fetch: vi.fn(),
      }
    })

    it('should create a typed proxy client from stub', () => {
      const client = createTypedClient<CustomerDO>(mockStub as unknown as DurableObjectStub)

      expect(client).toBeDefined()
      expect(typeof client.getProfile).toBe('function')
      expect(typeof client.updateEmail).toBe('function')
      expect(typeof client.listOrders).toBe('function')
      expect(typeof client.charge).toBe('function')
    })

    it('should expose $call method for options', () => {
      const client = createTypedClient<CustomerDO>(mockStub as unknown as DurableObjectStub)

      expect(client.$call).toBeDefined()
      expect(typeof client.$call).toBe('function')
    })

    it('should expose $stub property', () => {
      const client = createTypedClient<CustomerDO>(mockStub as unknown as DurableObjectStub)

      expect(client.$stub).toBe(mockStub)
    })

    it('should not be thenable', () => {
      const client = createTypedClient<CustomerDO>(mockStub as unknown as DurableObjectStub)

      // @ts-expect-error - testing that then is undefined
      expect(client.then).toBeUndefined()
      // @ts-expect-error - testing that catch is undefined
      expect(client.catch).toBeUndefined()
      // @ts-expect-error - testing that finally is undefined
      expect(client.finally).toBeUndefined()
    })

    it('should call DO method via stub.fetch', async () => {
      mockStub.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: '123', name: 'Alice', email: 'alice@example.com' }),
      })

      const client = createTypedClient<CustomerDO>(mockStub as unknown as DurableObjectStub)
      const profile = await client.getProfile('123')

      // Verify fetch was called correctly
      expect(mockStub.fetch).toHaveBeenCalledTimes(1)
      const [url, init] = mockStub.fetch.mock.calls[0]
      expect(url).toBe('https://do/rpc')
      expect(init.method).toBe('POST')
      expect(init.headers['Content-Type']).toBe('application/json')
      expect(init.headers['X-Correlation-ID']).toBeTruthy()
      expect(JSON.parse(init.body)).toEqual({ method: 'getProfile', args: ['123'] })

      // Verify return type
      expect(profile).toEqual({ id: '123', name: 'Alice', email: 'alice@example.com' })
    })

    it('should pass multiple arguments correctly', async () => {
      mockStub.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ receiptId: 'receipt-456' }),
      })

      const client = createTypedClient<CustomerDO>(mockStub as unknown as DurableObjectStub)
      const result = await client.charge(100, 'USD')

      const [, init] = mockStub.fetch.mock.calls[0]
      expect(JSON.parse(init.body)).toEqual({ method: 'charge', args: [100, 'USD'] })
      expect(result).toEqual({ receiptId: 'receipt-456' })
    })

    it('should handle optional parameters', async () => {
      mockStub.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      })

      const client = createTypedClient<CustomerDO>(mockStub as unknown as DurableObjectStub)

      // Call with optional param
      await client.listOrders('cust-123', 10)
      expect(JSON.parse(mockStub.fetch.mock.calls[0][1].body)).toEqual({
        method: 'listOrders',
        args: ['cust-123', 10],
      })

      // Call without optional param
      mockStub.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      })
      await client.listOrders('cust-123')
      expect(JSON.parse(mockStub.fetch.mock.calls[1][1].body)).toEqual({
        method: 'listOrders',
        args: ['cust-123'],
      })
    })

    it('should support $call with custom options', async () => {
      mockStub.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: '123', name: 'Bob', email: 'bob@example.com' }),
      })

      const client = createTypedClient<CustomerDO>(mockStub as unknown as DurableObjectStub)

      // Use $call with custom options
      const profile = await client.$call('getProfile', ['123'], {
        timeout: 5000,
        correlationId: 'custom-correlation-id',
        headers: { 'X-Custom-Header': 'custom-value' },
      })

      const [, init] = mockStub.fetch.mock.calls[0]
      expect(init.headers['X-Correlation-ID']).toBe('custom-correlation-id')
      expect(init.headers['X-Custom-Header']).toBe('custom-value')
      expect(profile).toEqual({ id: '123', name: 'Bob', email: 'bob@example.com' })
    })

    it('should use default timeout of 30000ms', async () => {
      mockStub.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      })

      const client = createTypedClient<CustomerDO>(mockStub as unknown as DurableObjectStub)
      await client.updateEmail('123', 'new@example.com')

      // The signal should be attached (we can't easily test the timeout value)
      const [, init] = mockStub.fetch.mock.calls[0]
      expect(init.signal).toBeDefined()
    })

    it('should use custom timeout from options', async () => {
      mockStub.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      })

      const client = createTypedClient<CustomerDO>(mockStub as unknown as DurableObjectStub, {
        timeout: 5000,
      })
      await client.updateEmail('123', 'new@example.com')

      // Verify signal is attached
      const [, init] = mockStub.fetch.mock.calls[0]
      expect(init.signal).toBeDefined()
    })

    it('should use base correlation ID when provided', async () => {
      mockStub.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      })

      const client = createTypedClient<CustomerDO>(mockStub as unknown as DurableObjectStub, {
        correlationId: 'base-correlation-123',
      })
      await client.updateEmail('123', 'new@example.com')

      const [, init] = mockStub.fetch.mock.calls[0]
      expect(init.headers['X-Correlation-ID']).toBe('base-correlation-123')
    })

    it('should throw on RPC error', async () => {
      mockStub.fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers({ 'X-Correlation-ID': 'error-correlation-id' }),
        json: () => Promise.resolve({}),
      })

      const client = createTypedClient<CustomerDO>(mockStub as unknown as DurableObjectStub)

      await expect(client.getProfile('123')).rejects.toThrow('DO RPC error: 500')
    })

    it('should deserialize structured RPC errors', async () => {
      mockStub.fetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers({ 'X-Correlation-ID': 'error-correlation-id' }),
        json: () =>
          Promise.resolve({
            type: 'NotFoundError',
            code: 'NOT_FOUND',
            message: 'Customer not found',
            httpStatus: 404,
          }),
      })

      const client = createTypedClient<CustomerDO>(mockStub as unknown as DurableObjectStub)

      await expect(client.getProfile('123')).rejects.toThrow('Customer not found')
    })
  })

  describe('createTypedClientFromUrl', () => {
    const originalFetch = global.fetch
    let mockFetch: ReturnType<typeof vi.fn>

    beforeEach(() => {
      mockFetch = vi.fn()
      global.fetch = mockFetch as unknown as typeof fetch
    })

    afterEach(() => {
      global.fetch = originalFetch
    })

    it('should create a typed client from URL', () => {
      interface SimpleAPI {
        ping(): Promise<{ pong: boolean }>
      }

      const client = createTypedClientFromUrl<SimpleAPI>('https://api.example.com')
      expect(client).toBeDefined()
      expect(typeof client.ping).toBe('function')
    })

    it('should support nested APIs', () => {
      const client = createTypedClientFromUrl<NestedAPI>('https://api.example.com')

      expect(client.users).toBeDefined()
      expect(client.posts).toBeDefined()
      expect(typeof client.users.create).toBe('function')
      expect(typeof client.users.get).toBe('function')
      expect(typeof client.posts.list).toBe('function')
    })

    it('should make fetch calls with correct method path', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'user-123' }),
      })

      const client = createTypedClientFromUrl<NestedAPI>('https://api.example.com')
      const result = await client.users.create({ name: 'Alice', email: 'alice@example.com' })

      const [url, init] = mockFetch.mock.calls[0]
      expect(url).toBe('https://api.example.com/rpc')
      expect(JSON.parse(init.body)).toEqual({
        method: 'users.create',
        args: [{ name: 'Alice', email: 'alice@example.com' }],
      })
      expect(result).toEqual({ id: 'user-123' })
    })
  })

  describe('createTypedClientFromBinding', () => {
    it('should create a typed client from DO binding with string id', () => {
      const mockStub = { fetch: vi.fn() }
      const mockBinding = {
        idFromName: vi.fn().mockReturnValue({ toString: () => 'mock-id' }),
        get: vi.fn().mockReturnValue(mockStub),
      } as unknown as DurableObjectNamespace

      const client = createTypedClientFromBinding<CustomerDO>(mockBinding, 'customer-123')

      expect(mockBinding.idFromName).toHaveBeenCalledWith('customer-123')
      expect(mockBinding.get).toHaveBeenCalled()
      expect(client).toBeDefined()
      expect(typeof client.getProfile).toBe('function')
    })

    it('should create a typed client from DO binding with DurableObjectId', () => {
      // Mock DurableObjectId must have: equals, toString (returning non-empty string), and name property
      const mockDoId = {
        toString: () => '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        equals: () => false,
        name: undefined,
      } as unknown as DurableObjectId
      const mockStub = { fetch: vi.fn() }
      const mockBinding = {
        idFromName: vi.fn(),
        get: vi.fn().mockReturnValue(mockStub),
      } as unknown as DurableObjectNamespace

      const client = createTypedClientFromBinding<CustomerDO>(mockBinding, mockDoId)

      expect(mockBinding.idFromName).not.toHaveBeenCalled()
      expect(mockBinding.get).toHaveBeenCalledWith(mockDoId)
      expect(client).toBeDefined()
    })
  })

  describe('batchCalls', () => {
    it('should execute multiple calls in parallel', async () => {
      const results = await batchCalls(
        Promise.resolve({ name: 'Alice' }),
        Promise.resolve([1, 2, 3]),
        Promise.resolve(42)
      )

      expect(results).toEqual([{ name: 'Alice' }, [1, 2, 3], 42])
    })

    it('should work with typed client calls', async () => {
      const mockStub = {
        fetch: vi
          .fn()
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ id: '123', name: 'Alice', email: 'alice@example.com' }),
          })
          .mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve([{ id: 'order-1', total: 100, items: ['item1'] }]),
          }),
      }

      const client = createTypedClient<CustomerDO>(mockStub as unknown as DurableObjectStub)

      const [profile, orders] = await batchCalls(
        client.getProfile('123'),
        client.listOrders('123', 10)
      )

      expect(profile).toEqual({ id: '123', name: 'Alice', email: 'alice@example.com' })
      expect(orders).toEqual([{ id: 'order-1', total: 100, items: ['item1'] }])
      expect(mockStub.fetch).toHaveBeenCalledTimes(2)
    })
  })

  describe('Type Utilities', () => {
    it('ExtractMethodNames should extract async method names', () => {
      // This is a compile-time test - if it compiles, the types are correct
      type Methods = ExtractMethodNames<CustomerDO>
      const _methods: Methods = 'getProfile' // or 'updateEmail', 'listOrders', 'charge'

      // TypeScript should allow these
      const validMethods: Methods[] = ['getProfile', 'updateEmail', 'listOrders', 'charge']
      expect(validMethods).toHaveLength(4)
    })

    it('ExtractMethodParams should extract parameter types', () => {
      // Compile-time test
      type Params = ExtractMethodParams<CustomerDO, 'charge'>
      const _params: Params = [100, 'USD']
      expect(_params).toEqual([100, 'USD'])
    })

    it('ExtractMethodReturn should extract return types', () => {
      // Compile-time test
      type Return = ExtractMethodReturn<CustomerDO, 'getProfile'>
      const _return: Return = { id: '123', name: 'Test', email: 'test@example.com' }
      expect(_return.id).toBe('123')
    })

    it('MethodSignature should create correct function type', () => {
      // Compile-time test
      type Sig = MethodSignature<CustomerDO, 'charge'>
      const fn: Sig = async (amount: number, currency: string) => ({ receiptId: 'test' })
      expect(typeof fn).toBe('function')
    })

    it('PartialClient should allow partial implementations', () => {
      // Compile-time test - useful for mocking
      const mockClient: PartialClient<CustomerDO> = {
        getProfile: vi.fn().mockResolvedValue({ id: '1', name: 'Mock', email: 'mock@test.com' }),
        // Other methods are optional
      }

      expect(mockClient.getProfile).toBeDefined()
      expect(mockClient.updateEmail).toBeUndefined()
    })
  })

  describe('Type Safety (compile-time)', () => {
    // These tests verify that TypeScript correctly infers types
    // They should all compile without errors

    it('should infer return types correctly', async () => {
      const mockStub = {
        fetch: vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ id: '1', name: 'Test', email: 'test@test.com' }),
        }),
      }

      const client = createTypedClient<CustomerDO>(mockStub as unknown as DurableObjectStub)

      // TypeScript should infer the return type as Profile
      const profile = await client.getProfile('123')

      // These should compile - profile is typed as Profile
      const _id: string = profile.id
      const _name: string = profile.name
      const _email: string = profile.email

      expect(_id).toBeDefined()
    })

    it('should enforce parameter types', async () => {
      const mockStub = {
        fetch: vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ receiptId: 'test' }),
        }),
      }

      const client = createTypedClient<CustomerDO>(mockStub as unknown as DurableObjectStub)

      // This should compile - correct parameter types
      await client.charge(100, 'USD')

      // The following would cause TypeScript errors if uncommented:
      // await client.charge('invalid', 'USD')  // Error: string is not number
      // await client.charge(100)               // Error: missing required argument
      // await client.nonExistent()             // Error: method doesn't exist

      expect(true).toBe(true)
    })
  })
})
