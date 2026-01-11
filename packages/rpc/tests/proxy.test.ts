/**
 * @dotdo/rpc - Core RPC Proxy Tests
 *
 * TDD RED phase: Write failing tests first, then implement.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createRpcProxy,
  InMemoryExecutor,
  HTTPExecutor,
  serialize,
  deserialize,
  resetCallIdCounter,
  type MethodCall,
  type Executor,
  type ProxyConfig,
} from '../src/index.js'

describe('@dotdo/rpc - Core RPC Proxy', () => {
  // Reset call ID counter before each test for predictable IDs
  beforeEach(() => {
    resetCallIdCounter()
  })

  // ==========================================================================
  // Simple Method Calls
  // ==========================================================================
  describe('simple method calls', () => {
    it('should capture a simple method call', async () => {
      const calls: MethodCall[] = []
      const executor: Executor = {
        async execute(call) {
          calls.push(call)
          return { result: 'success' }
        },
      }

      const proxy = createRpcProxy<{ greet(name: string): string }>(executor)
      await proxy.greet('world')

      expect(calls).toHaveLength(1)
      expect(calls[0].path).toEqual(['greet'])
      expect(calls[0].args).toEqual(['world'])
    })

    it('should return the executor result', async () => {
      const executor: Executor = {
        async execute() {
          return { result: 42 }
        },
      }

      const proxy = createRpcProxy<{ getValue(): number }>(executor)
      const result = await proxy.getValue()

      expect(result).toBe(42)
    })

    it('should handle multiple arguments', async () => {
      const calls: MethodCall[] = []
      const executor: Executor = {
        async execute(call) {
          calls.push(call)
          return { result: call.args![0] + call.args![1] }
        },
      }

      const proxy = createRpcProxy<{ add(a: number, b: number): number }>(executor)
      const result = await proxy.add(2, 3)

      expect(result).toBe(5)
      expect(calls[0].args).toEqual([2, 3])
    })
  })

  // ==========================================================================
  // Nested Property Access
  // ==========================================================================
  describe('nested property access', () => {
    it('should track nested property access path', async () => {
      const calls: MethodCall[] = []
      const executor: Executor = {
        async execute(call) {
          calls.push(call)
          return { result: 'user-data' }
        },
      }

      const proxy = createRpcProxy<{
        users: { get(id: string): unknown }
      }>(executor)
      await proxy.users.get('123')

      expect(calls).toHaveLength(1)
      expect(calls[0].path).toEqual(['users', 'get'])
      expect(calls[0].args).toEqual(['123'])
    })

    it('should handle deeply nested paths', async () => {
      const calls: MethodCall[] = []
      const executor: Executor = {
        async execute(call) {
          calls.push(call)
          return { result: null }
        },
      }

      const proxy = createRpcProxy<{
        api: { v1: { users: { profile: { update(data: unknown): void } } } }
      }>(executor)
      await proxy.api.v1.users.profile.update({ name: 'Alice' })

      expect(calls[0].path).toEqual(['api', 'v1', 'users', 'profile', 'update'])
      expect(calls[0].args).toEqual([{ name: 'Alice' }])
    })

    it('should support indexer syntax with bracket notation', async () => {
      const calls: MethodCall[] = []
      const executor: Executor = {
        async execute(call) {
          calls.push(call)
          return { result: { name: 'Item' } }
        },
      }

      const proxy = createRpcProxy<{
        items: { [key: string]: { get(): unknown } }
      }>(executor)
      await proxy.items['item-123'].get()

      expect(calls[0].path).toEqual(['items', 'item-123', 'get'])
    })
  })

  // ==========================================================================
  // Method Batching
  // ==========================================================================
  describe('method batching', () => {
    it('should batch multiple calls with InMemoryExecutor', async () => {
      const target = {
        async getUser(id: string) {
          return { id, name: `User ${id}` }
        },
        async getOrder(id: string) {
          return { id, total: 100 }
        },
      }

      const executor = new InMemoryExecutor(target)
      const proxy = createRpcProxy<typeof target>(executor)

      // Both calls should execute
      const [user, order] = await Promise.all([
        proxy.getUser('u1'),
        proxy.getOrder('o1'),
      ])

      expect(user).toEqual({ id: 'u1', name: 'User u1' })
      expect(order).toEqual({ id: 'o1', total: 100 })
    })

    it('should batch calls when batching is enabled', async () => {
      const executedBatches: MethodCall[][] = []
      const executor: Executor = {
        async execute(call) {
          return { result: `result-${call.id}` }
        },
        async executeBatch(calls) {
          executedBatches.push(calls)
          return calls.map((call) => ({ result: `batch-result-${call.id}` }))
        },
      }

      const proxy = createRpcProxy<{
        a(): string
        b(): string
      }>(executor, { batching: { enabled: true, windowMs: 10 } })

      const results = await Promise.all([proxy.a(), proxy.b()])

      expect(executedBatches).toHaveLength(1)
      expect(executedBatches[0]).toHaveLength(2)
      expect(results[0]).toBe('batch-result-1')
      expect(results[1]).toBe('batch-result-2')
    })
  })

  // ==========================================================================
  // Error Propagation
  // ==========================================================================
  describe('error propagation', () => {
    it('should propagate errors from executor', async () => {
      const executor: Executor = {
        async execute() {
          return { error: { code: 'NOT_FOUND', message: 'User not found' } }
        },
      }

      const proxy = createRpcProxy<{ getUser(id: string): unknown }>(executor)

      await expect(proxy.getUser('unknown')).rejects.toThrow('User not found')
    })

    it('should propagate thrown errors', async () => {
      const executor: Executor = {
        async execute() {
          throw new Error('Connection failed')
        },
      }

      const proxy = createRpcProxy<{ connect(): void }>(executor)

      await expect(proxy.connect()).rejects.toThrow('Connection failed')
    })

    it('should include error code in thrown error', async () => {
      const executor: Executor = {
        async execute() {
          return {
            error: { code: 'RATE_LIMITED', message: 'Too many requests' },
          }
        },
      }

      const proxy = createRpcProxy<{ fetch(): unknown }>(executor)

      try {
        await proxy.fetch()
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as Error & { code: string }).code).toBe('RATE_LIMITED')
      }
    })
  })

  // ==========================================================================
  // InMemoryExecutor
  // ==========================================================================
  describe('InMemoryExecutor', () => {
    it('should execute methods on target object', async () => {
      const target = {
        async greet(name: string) {
          return `Hello, ${name}!`
        },
      }

      const executor = new InMemoryExecutor(target)
      const result = await executor.execute({
        id: '1',
        path: ['greet'],
        args: ['World'],
      })

      expect(result.result).toBe('Hello, World!')
    })

    it('should handle nested object methods', async () => {
      const target = {
        users: {
          async find(id: string) {
            return { id, name: 'Alice' }
          },
        },
      }

      const executor = new InMemoryExecutor(target)
      const result = await executor.execute({
        id: '1',
        path: ['users', 'find'],
        args: ['123'],
      })

      expect(result.result).toEqual({ id: '123', name: 'Alice' })
    })

    it('should return error for non-existent methods', async () => {
      const target = {}
      const executor = new InMemoryExecutor(target)
      const result = await executor.execute({
        id: '1',
        path: ['nonexistent'],
        args: [],
      })

      expect(result.error).toBeDefined()
      expect(result.error?.code).toBe('METHOD_NOT_FOUND')
    })

    it('should catch and return errors from target methods', async () => {
      const target = {
        async fail() {
          throw new Error('Something went wrong')
        },
      }

      const executor = new InMemoryExecutor(target)
      const result = await executor.execute({
        id: '1',
        path: ['fail'],
        args: [],
      })

      expect(result.error).toBeDefined()
      expect(result.error?.message).toBe('Something went wrong')
    })
  })

  // ==========================================================================
  // HTTPExecutor
  // ==========================================================================
  describe('HTTPExecutor', () => {
    it('should send POST request with method call', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: '1', result: 'success' }),
      })

      const executor = new HTTPExecutor('https://api.example.com/rpc', {
        fetch: fetchMock,
      })

      const result = await executor.execute({
        id: '1',
        path: ['users', 'get'],
        args: ['123'],
      })

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.com/rpc',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      )
      expect(result.result).toBe('success')
    })

    it('should batch multiple requests', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            { id: '1', result: 'result1' },
            { id: '2', result: 'result2' },
          ]),
      })

      const executor = new HTTPExecutor('https://api.example.com/rpc', {
        fetch: fetchMock,
      })

      const results = await executor.executeBatch([
        { id: '1', path: ['method1'], args: [] },
        { id: '2', path: ['method2'], args: [] },
      ])

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(results).toHaveLength(2)
      expect(results[0].result).toBe('result1')
      expect(results[1].result).toBe('result2')
    })

    it('should handle HTTP errors', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      })

      const executor = new HTTPExecutor('https://api.example.com/rpc', {
        fetch: fetchMock,
      })

      const result = await executor.execute({
        id: '1',
        path: ['test'],
        args: [],
      })

      expect(result.error).toBeDefined()
      expect(result.error?.code).toBe('HTTP_ERROR')
    })
  })

  // ==========================================================================
  // Serialization
  // ==========================================================================
  describe('serialization', () => {
    it('should serialize and deserialize primitives', () => {
      const values = [42, 'hello', true, null]

      for (const value of values) {
        const serialized = serialize(value)
        const deserialized = deserialize(serialized)
        expect(deserialized).toEqual(value)
      }
    })

    it('should serialize and deserialize Date objects', () => {
      const date = new Date('2024-01-15T10:30:00Z')
      const serialized = serialize(date)
      const deserialized = deserialize(serialized)

      expect(deserialized).toBeInstanceOf(Date)
      expect((deserialized as Date).getTime()).toBe(date.getTime())
    })

    it('should serialize and deserialize Uint8Array', () => {
      const data = new Uint8Array([1, 2, 3, 4, 5])
      const serialized = serialize(data)
      const deserialized = deserialize(serialized)

      expect(deserialized).toBeInstanceOf(Uint8Array)
      expect(deserialized).toEqual(data)
    })

    it('should serialize and deserialize Error objects', () => {
      const error = new Error('Test error')
      error.name = 'CustomError'
      const serialized = serialize(error)
      const deserialized = deserialize(serialized)

      expect(deserialized).toBeInstanceOf(Error)
      expect((deserialized as Error).message).toBe('Test error')
      expect((deserialized as Error).name).toBe('CustomError')
    })

    it('should handle nested objects and arrays', () => {
      const data = {
        users: [
          { id: 1, name: 'Alice', createdAt: new Date('2024-01-01') },
          { id: 2, name: 'Bob', createdAt: new Date('2024-01-02') },
        ],
        metadata: {
          count: 2,
          binary: new Uint8Array([255, 128, 0]),
        },
      }

      const serialized = serialize(data)
      const deserialized = deserialize(serialized) as typeof data

      expect(deserialized.users[0].createdAt).toBeInstanceOf(Date)
      expect(deserialized.metadata.binary).toBeInstanceOf(Uint8Array)
      expect(deserialized.metadata.binary).toEqual(data.metadata.binary)
    })

    it('should serialize function references as placeholders', () => {
      const data = {
        callback: () => console.log('test'),
        name: 'test',
      }

      const serialized = serialize(data)
      const deserialized = deserialize(serialized) as { callback: unknown; name: string }

      expect(deserialized.name).toBe('test')
      // Function should be serialized as a reference marker
      expect(deserialized.callback).toBeDefined()
      expect(typeof deserialized.callback).toBe('object')
      expect((deserialized.callback as { __rpc_fn__: boolean }).__rpc_fn__).toBe(true)
    })
  })

  // ==========================================================================
  // Type Safety
  // ==========================================================================
  describe('type safety', () => {
    interface UserService {
      getUser(id: string): Promise<{ id: string; name: string }>
      createUser(data: { name: string; email: string }): Promise<{ id: string }>
      users: {
        list(): Promise<Array<{ id: string; name: string }>>
        byId(id: string): {
          profile: { get(): Promise<{ bio: string }> }
          delete(): Promise<void>
        }
      }
    }

    it('should provide proper type inference', async () => {
      const executor = new InMemoryExecutor({
        async getUser(id: string) {
          return { id, name: 'Test User' }
        },
        async createUser(data: { name: string; email: string }) {
          return { id: 'new-id' }
        },
        users: {
          async list() {
            return [{ id: '1', name: 'Alice' }]
          },
          byId(id: string) {
            return {
              profile: {
                async get() {
                  return { bio: 'Hello' }
                },
              },
              async delete() {},
            }
          },
        },
      })

      const proxy = createRpcProxy<UserService>(executor)

      // These should all type-check correctly
      const user = await proxy.getUser('123')
      expect(user.name).toBe('Test User')

      const newUser = await proxy.createUser({ name: 'Bob', email: 'bob@test.com' })
      expect(newUser.id).toBe('new-id')
    })
  })
})
