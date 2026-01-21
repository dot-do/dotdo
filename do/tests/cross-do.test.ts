import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createContext, type WorkflowContext } from '../context'

// Mock DurableObjectState
const mockState = {
  id: { toString: () => 'test-id' },
  storage: {
    get: vi.fn(),
    put: vi.fn(),
    list: vi.fn(() => Promise.resolve(new Map())),
  },
} as unknown as DurableObjectState

// Mock environment with DO bindings
interface MockEnv {
  Customer?: DurableObjectNamespace
  Worker?: DurableObjectNamespace
  Order?: DurableObjectNamespace
}

describe('Cross-DO RPC via $', () => {
  let $: WorkflowContext
  let env: MockEnv
  let mockStubs: Map<string, any>

  beforeEach(() => {
    mockStubs = new Map()

    // Create mock DO namespace bindings
    const createMockNamespace = (name: string): DurableObjectNamespace => {
      return {
        idFromName: vi.fn((id: string) => ({
          toString: () => id,
          name
        })),
        get: vi.fn((doId: unknown) => {
          // The key should match what createDOStub uses
          const key = `${name}-${doId.toString()}`
          if (!mockStubs.has(key)) {
            mockStubs.set(key, {
              fetch: vi.fn()
            })
          }
          return mockStubs.get(key)
        })
      } as unknown as DurableObjectNamespace
    }

    env = {
      Customer: createMockNamespace('Customer'),
      Worker: createMockNamespace('Worker'),
      Order: createMockNamespace('Order'),
    }

    $ = createContext(mockState, env)
  })

  describe('DO stub access', () => {
    it('should create typed DO stub via $.Customer(id)', () => {
      const customer = $.Customer('user-123')

      expect(customer).toBeDefined()
      expect(env.Customer?.idFromName).toHaveBeenCalledWith('user-123')
    })

    it('should support multiple DO types', () => {
      const customer = $.Customer('user-123')
      const worker = $.Worker('worker-1')
      const order = $.Order('order-456')

      expect(customer).toBeDefined()
      expect(worker).toBeDefined()
      expect(order).toBeDefined()
      expect(env.Customer?.idFromName).toHaveBeenCalledWith('user-123')
      expect(env.Worker?.idFromName).toHaveBeenCalledWith('worker-1')
      expect(env.Order?.idFromName).toHaveBeenCalledWith('order-456')
    })

    it('should cache stub instances for same ID', () => {
      const customer1 = $.Customer('user-123')
      const customer2 = $.Customer('user-123')

      // Should be the same cached instance
      expect(customer1).toBe(customer2)
      // idFromName should only be called once
      expect(env.Customer?.idFromName).toHaveBeenCalledTimes(1)
    })

    it('should create different stubs for different IDs', () => {
      const customer1 = $.Customer('user-123')
      const customer2 = $.Customer('user-456')

      expect(customer1).not.toBe(customer2)
      expect(env.Customer?.idFromName).toHaveBeenCalledTimes(2)
    })

    it('should throw if DO binding does not exist', () => {
      const $ = createContext(mockState, {}) // No DO bindings

      expect(() => $.Customer('user-123')).toThrow(/Customer.*not found/i)
    })
  })

  describe('Remote method calls', () => {
    it('should call remote method via RPC', async () => {
      const mockResponse = { id: 'user-123', name: 'Alice', notified: true }

      // Get the stub by calling $.Customer first (which creates the stub in the map)
      const customer = $.Customer('user-123')

      // Now retrieve it from mockStubs to configure mock
      const stub = mockStubs.get('Customer-user-123')!
      stub.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      })

      const result = await customer.notify({ message: 'Hello' })

      expect(stub.fetch).toHaveBeenCalledWith(
        'https://do/rpc',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: 'notify',
            args: [{ message: 'Hello' }]
          })
        })
      )
      expect(result).toEqual(mockResponse)
    })

    it('should handle methods with multiple arguments', async () => {
      const worker = $.Worker('worker-1')
      const stub = mockStubs.get('Worker-worker-1')!
      stub.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ jobId: 'job-123' })
      })

      const result = await worker.run('process-data', { batchSize: 100 }, { priority: 'high' })

      expect(stub.fetch).toHaveBeenCalledWith(
        'https://do/rpc',
        expect.objectContaining({
          body: JSON.stringify({
            method: 'run',
            args: ['process-data', { batchSize: 100 }, { priority: 'high' }]
          })
        })
      )
      expect(result).toEqual({ jobId: 'job-123' })
    })

    it('should handle methods with no arguments', async () => {
      const customer = $.Customer('user-123')
      const stub = mockStubs.get('Customer-user-123')!
      stub.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ balance: 1000 })
      })

      const result = await customer.getBalance()

      expect(stub.fetch).toHaveBeenCalledWith(
        'https://do/rpc',
        expect.objectContaining({
          body: JSON.stringify({ method: 'getBalance', args: [] })
        })
      )
      expect(result).toEqual({ balance: 1000 })
    })

    it('should propagate errors from remote DO', async () => {
      const customer = $.Customer('user-123')
      const stub = mockStubs.get('Customer-user-123')!
      stub.fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Internal error' })
      })

      await expect(customer.notify({ message: 'Test' }))
        .rejects.toThrow(/DO RPC error: 500/i)
    })

    it('should handle JSON serialization errors gracefully', async () => {
      const customer = $.Customer('user-123')
      const stub = mockStubs.get('Customer-user-123')!
      stub.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.reject(new Error('Invalid JSON'))
      })

      await expect(customer.getData())
        .rejects.toThrow('Invalid JSON')
    })
  })

  describe('Type safety', () => {
    it('should support typed DO interfaces', async () => {
      interface CustomerDO {
        notify(params: { message: string }): Promise<{ notified: boolean }>
        getBalance(): Promise<{ balance: number }>
      }

      const customer = $.Customer('user-123') as CustomerDO
      const stub = mockStubs.get('Customer-user-123')!
      stub.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ notified: true })
      })

      const result = await customer.notify({ message: 'Hello' })

      expect(result.notified).toBe(true)
    })
  })

  describe('Concurrent calls', () => {
    it('should handle multiple concurrent calls to same DO', async () => {
      const customer = $.Customer('user-123')
      const stub = mockStubs.get('Customer-user-123')!

      stub.fetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ result: 'call1' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ result: 'call2' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ result: 'call3' })
        })

      const [r1, r2, r3] = await Promise.all([
        customer.method1(),
        customer.method2(),
        customer.method3(),
      ])

      expect(r1).toEqual({ result: 'call1' })
      expect(r2).toEqual({ result: 'call2' })
      expect(r3).toEqual({ result: 'call3' })
      expect(stub.fetch).toHaveBeenCalledTimes(3)
    })

    it('should handle concurrent calls to different DOs', async () => {
      const customer = $.Customer('user-123')
      const worker = $.Worker('worker-1')
      const order = $.Order('order-456')

      const customerStub = mockStubs.get('Customer-user-123')!
      const workerStub = mockStubs.get('Worker-worker-1')!
      const orderStub = mockStubs.get('Order-order-456')!

      customerStub.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ type: 'customer' })
      })
      workerStub.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ type: 'worker' })
      })
      orderStub.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ type: 'order' })
      })

      const [c, w, o] = await Promise.all([
        customer.getData(),
        worker.getData(),
        order.getData(),
      ])

      expect(c).toEqual({ type: 'customer' })
      expect(w).toEqual({ type: 'worker' })
      expect(o).toEqual({ type: 'order' })
    })
  })

  describe('Integration with workflow context', () => {
    it('should work alongside event handlers', async () => {
      // Register event handler
      const handler = vi.fn()
      $.on.Customer.created(handler)

      // Make cross-DO call
      const customer = $.Customer('user-123')
      const stub = mockStubs.get('Customer-user-123')!
      stub.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ created: true })
      })

      await customer.create({ name: 'Alice' })

      // Emit event
      $.send({ type: 'Customer.created', payload: { id: 'user-123' } })

      await new Promise(r => setTimeout(r, 50))
      expect(handler).toHaveBeenCalled()
      expect(stub.fetch).toHaveBeenCalled()
    })

    it('should work within $.do() for retries', async () => {
      const customer = $.Customer('user-123')
      const stub = mockStubs.get('Customer-user-123')!
      let attempts = 0

      stub.fetch.mockImplementation(() => {
        attempts++
        if (attempts < 2) {
          return Promise.resolve({
            ok: false,
            status: 500
          })
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true })
        })
      })

      const result = await $.do(async () => {
        const res = await customer.process()
        if (!res.success) throw new Error('Failed')
        return res
      }, { retries: 3 })

      expect(result).toEqual({ success: true })
      expect(attempts).toBeGreaterThanOrEqual(2)
    })
  })

  describe('Stub caching behavior', () => {
    it('should maintain separate caches for different DO types', () => {
      const customer = $.Customer('123')
      const worker = $.Worker('123')

      expect(customer).not.toBe(worker)
      expect(env.Customer?.idFromName).toHaveBeenCalledWith('123')
      expect(env.Worker?.idFromName).toHaveBeenCalledWith('123')
    })

    it('should not interfere with other $ methods', () => {
      // Ensure Customer() doesn't interfere with on, send, do, try, every
      expect($.on).toBeDefined()
      expect(typeof $.send).toBe('function')
      expect(typeof $.do).toBe('function')
      expect(typeof $.try).toBe('function')
      expect($.every).toBeDefined()

      const customer = $.Customer('123')

      // These should still work
      expect($.on).toBeDefined()
      expect(typeof $.send).toBe('function')
      expect(customer).toBeDefined()
    })
  })

  describe('Error handling', () => {
    it('should provide clear error for missing DO binding', () => {
      const $ = createContext(mockState, {})

      expect(() => $.NonExistent('id-123')).toThrow(/NonExistent/)
    })

    it('should handle network errors gracefully', async () => {
      const customer = $.Customer('user-123')
      const stub = mockStubs.get('Customer-user-123')!
      stub.fetch.mockRejectedValueOnce(new Error('Network error'))

      await expect(customer.getData())
        .rejects.toThrow('Network error')
    })

    it('should preserve error stack traces', async () => {
      const customer = $.Customer('user-123')
      const stub = mockStubs.get('Customer-user-123')!
      const originalError = new Error('Remote error')

      stub.fetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: originalError.message })
      })

      try {
        await customer.failingMethod()
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).stack).toBeDefined()
      }
    })
  })
})
