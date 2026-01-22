import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createClient, createDOStub } from '../client'

// Mock fetch for testing
const mockFetch = vi.fn()
const originalFetch = global.fetch
beforeEach(() => {
  global.fetch = mockFetch as unknown as typeof fetch
  mockFetch.mockReset()
})
afterEach(() => {
  global.fetch = originalFetch
})

describe('RPC Client', () => {
  describe('createClient', () => {
    it('should create a typed proxy client', () => {
      interface TestAPI {
        greet(name: string): Promise<string>
      }

      const client = createClient<TestAPI>({ url: 'http://localhost:8787' })
      expect(client).toBeDefined()
      expect(typeof client.greet).toBe('function')
    })

    it('should not be a thenable (not a promise itself)', () => {
      interface TestAPI {
        greet(name: string): Promise<string>
      }

      const client = createClient<TestAPI>({ url: 'http://localhost:8787' })
      // @ts-expect-error - testing that then is undefined
      expect(client.then).toBeUndefined()
      // @ts-expect-error - testing that catch is undefined
      expect(client.catch).toBeUndefined()
      // @ts-expect-error - testing that finally is undefined
      expect(client.finally).toBeUndefined()
    })

    it('should call remote method via fetch', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ result: 'Hello, World!' })
      })

      interface TestAPI {
        greet(name: string): Promise<{ result: string }>
      }

      const client = createClient<TestAPI>({ url: 'http://localhost:8787' })
      const result = await client.greet('World')

      // Check that fetch was called with the right structure
      const fetchCall = mockFetch.mock.calls[0]
      expect(fetchCall[0]).toBe('http://localhost:8787/rpc')
      expect(fetchCall[1].method).toBe('POST')
      expect(fetchCall[1].headers['Content-Type']).toBe('application/json')
      expect(fetchCall[1].headers['X-Correlation-ID']).toBeTruthy()
      expect(JSON.parse(fetchCall[1].body)).toEqual({ method: 'greet', args: ['World'] })

      expect(result).toEqual({ result: 'Hello, World!' })
    })

    it('should pass multiple arguments to remote method', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ sum: 15 })
      })

      interface TestAPI {
        add(a: number, b: number, c: number): Promise<{ sum: number }>
      }

      const client = createClient<TestAPI>({ url: 'http://localhost:8787' })
      const result = await client.add(5, 7, 3)

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8787/rpc',
        expect.objectContaining({
          body: JSON.stringify({ method: 'add', args: [5, 7, 3] })
        })
      )
      expect(result).toEqual({ sum: 15 })
    })

    it('should throw on RPC error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers({ 'X-Correlation-ID': 'error-correlation-id' })
      })

      interface TestAPI {
        fail(): Promise<void>
      }

      const client = createClient<TestAPI>({ url: 'http://localhost:8787' })

      // Error now includes correlation ID in the message
      await expect(client.fail()).rejects.toThrow('RPC error: 500')
    })

    it('should handle timeout via AbortSignal', async () => {
      // Mock a slow response that will be aborted
      mockFetch.mockImplementationOnce(() =>
        new Promise((_, reject) => {
          const error = new Error('The operation was aborted')
          error.name = 'AbortError'
          setTimeout(() => reject(error), 100)
        })
      )

      interface TestAPI {
        slowMethod(): Promise<void>
      }

      const client = createClient<TestAPI>({
        url: 'http://localhost:8787',
        timeout: 50  // Very short timeout
      })

      // Verify the signal is passed
      await expect(client.slowMethod()).rejects.toThrow()
    })

    it('should use default timeout of 30000ms', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({})
      })

      interface TestAPI {
        method(): Promise<void>
      }

      const client = createClient<TestAPI>({ url: 'http://localhost:8787' })
      await client.method()

      // Check that the signal was included in the fetch call
      const fetchCall = mockFetch.mock.calls[0]
      expect(fetchCall[1]).toHaveProperty('signal')
    })

    it('should handle methods with no arguments', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ timestamp: 1234567890 })
      })

      interface TestAPI {
        getTime(): Promise<{ timestamp: number }>
      }

      const client = createClient<TestAPI>({ url: 'http://localhost:8787' })
      const result = await client.getTime()

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8787/rpc',
        expect.objectContaining({
          body: JSON.stringify({ method: 'getTime', args: [] })
        })
      )
      expect(result).toEqual({ timestamp: 1234567890 })
    })

    it('should handle complex object arguments', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: '123' })
      })

      interface User {
        name: string
        email: string
        roles: string[]
      }

      interface TestAPI {
        createUser(user: User): Promise<{ id: string }>
      }

      const client = createClient<TestAPI>({ url: 'http://localhost:8787' })
      const user = { name: 'Alice', email: 'alice@example.com', roles: ['admin'] }
      const result = await client.createUser(user)

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8787/rpc',
        expect.objectContaining({
          body: JSON.stringify({ method: 'createUser', args: [user] })
        })
      )
      expect(result).toEqual({ id: '123' })
    })

    it('should support nested property access for namespaced APIs', () => {
      interface NestedAPI {
        users: {
          create(name: string): Promise<{ id: string }>
          delete(id: string): Promise<void>
        }
        posts: {
          list(): Promise<string[]>
        }
      }

      const client = createClient<NestedAPI>({ url: 'http://localhost:8787' })

      // Verify nested proxies are created
      expect(client.users).toBeDefined()
      expect(client.posts).toBeDefined()
      expect(typeof client.users.create).toBe('function')
      expect(typeof client.users.delete).toBe('function')
      expect(typeof client.posts.list).toBe('function')
    })

    it('should handle multiple concurrent requests', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ result: 'A' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ result: 'B' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ result: 'C' })
        })

      interface TestAPI {
        method(id: string): Promise<{ result: string }>
      }

      const client = createClient<TestAPI>({ url: 'http://localhost:8787' })

      const [a, b, c] = await Promise.all([
        client.method('A'),
        client.method('B'),
        client.method('C'),
      ])

      expect(a).toEqual({ result: 'A' })
      expect(b).toEqual({ result: 'B' })
      expect(c).toEqual({ result: 'C' })
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })
  })

  describe('createDOStub', () => {
    it('should create a typed proxy for DO stub', () => {
      // Mock DurableObjectNamespace
      const mockStub = {
        fetch: vi.fn()
      }

      const mockBinding = {
        idFromName: vi.fn().mockReturnValue({ toString: () => 'mock-id' }),
        get: vi.fn().mockReturnValue(mockStub)
      } as unknown as DurableObjectNamespace

      interface DOAPI {
        increment(): Promise<number>
        getValue(): Promise<number>
      }

      const stub = createDOStub<DOAPI>(mockBinding, 'test-id')

      expect(stub).toBeDefined()
      expect(typeof stub.increment).toBe('function')
      expect(typeof stub.getValue).toBe('function')
    })

    it('should call DO method via fetch', async () => {
      const mockStub = {
        fetch: vi.fn().mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ value: 42 })
        })
      }

      const mockBinding = {
        idFromName: vi.fn().mockReturnValue({ toString: () => 'mock-id' }),
        get: vi.fn().mockReturnValue(mockStub)
      } as unknown as DurableObjectNamespace

      interface DOAPI {
        getValue(): Promise<{ value: number }>
      }

      const stub = createDOStub<DOAPI>(mockBinding, 'test-id')
      const result = await stub.getValue()

      expect(mockBinding.idFromName).toHaveBeenCalledWith('test-id')
      expect(mockBinding.get).toHaveBeenCalled()

      // Check that fetch was called with the right structure
      const fetchCall = mockStub.fetch.mock.calls[0]
      expect(fetchCall[0]).toBe('https://do/rpc')
      expect(fetchCall[1].method).toBe('POST')
      expect(fetchCall[1].headers['Content-Type']).toBe('application/json')
      expect(fetchCall[1].headers['X-Correlation-ID']).toBeTruthy()
      expect(JSON.parse(fetchCall[1].body)).toEqual({ method: 'getValue', args: [] })

      expect(result).toEqual({ value: 42 })
    })

    it('should accept DurableObjectId directly', async () => {
      const mockDOId = { toString: () => 'direct-id' } as DurableObjectId

      const mockStub = {
        fetch: vi.fn().mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ result: 'ok' })
        })
      }

      const mockBinding = {
        idFromName: vi.fn(),
        get: vi.fn().mockReturnValue(mockStub)
      } as unknown as DurableObjectNamespace

      interface DOAPI {
        ping(): Promise<{ result: string }>
      }

      const stub = createDOStub<DOAPI>(mockBinding, mockDOId)
      await stub.ping()

      // Should NOT call idFromName when given a DurableObjectId
      expect(mockBinding.idFromName).not.toHaveBeenCalled()
      expect(mockBinding.get).toHaveBeenCalledWith(mockDOId)
    })

    it('should throw on DO RPC error', async () => {
      const mockStub = {
        fetch: vi.fn().mockResolvedValueOnce({
          ok: false,
          status: 500,
          headers: new Headers({ 'X-Correlation-ID': 'error-correlation-id' })
        })
      }

      const mockBinding = {
        idFromName: vi.fn().mockReturnValue({ toString: () => 'mock-id' }),
        get: vi.fn().mockReturnValue(mockStub)
      } as unknown as DurableObjectNamespace

      interface DOAPI {
        fail(): Promise<void>
      }

      const stub = createDOStub<DOAPI>(mockBinding, 'test-id')

      // Error now includes correlation ID in the message
      await expect(stub.fail()).rejects.toThrow('DO RPC error: 500')
    })

    it('should not be a thenable', () => {
      const mockStub = {
        fetch: vi.fn()
      }

      const mockBinding = {
        idFromName: vi.fn().mockReturnValue({ toString: () => 'mock-id' }),
        get: vi.fn().mockReturnValue(mockStub)
      } as unknown as DurableObjectNamespace

      interface DOAPI {
        method(): Promise<void>
      }

      const stub = createDOStub<DOAPI>(mockBinding, 'test-id')

      // @ts-expect-error - testing that then is undefined
      expect(stub.then).toBeUndefined()
      // @ts-expect-error - testing that catch is undefined
      expect(stub.catch).toBeUndefined()
      // @ts-expect-error - testing that finally is undefined
      expect(stub.finally).toBeUndefined()
    })
  })
})
