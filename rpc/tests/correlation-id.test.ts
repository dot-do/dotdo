import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createClient, createDOStub, RPCClientOptions } from '../client'
import { createServer } from '../server'
import { createCrossDOClient, CrossDOContext } from '../cross-do'

// We'll test these after implementation
// For now, tests specify the expected behavior

describe('Correlation ID', () => {
  describe('ID Generation', () => {
    it('should generate unique IDs for each request', async () => {
      const capturedHeaders: Headers[] = []

      const mockFetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
        capturedHeaders.push(new Headers(init.headers))
        return new Response(JSON.stringify({ result: 'ok' }), { status: 200 })
      })

      const originalFetch = global.fetch
      global.fetch = mockFetch as unknown as typeof fetch

      try {
        interface TestAPI {
          method(): Promise<{ result: string }>
        }

        const client = createClient<TestAPI>({ url: 'http://localhost:8787' })

        await client.method()
        await client.method()
        await client.method()

        // Each request should have a correlation ID header
        expect(capturedHeaders).toHaveLength(3)

        const correlationIds = capturedHeaders.map(h => h.get('X-Correlation-ID'))

        // All should have correlation IDs
        expect(correlationIds.every(id => id !== null)).toBe(true)

        // All IDs should be unique
        const uniqueIds = new Set(correlationIds)
        expect(uniqueIds.size).toBe(3)
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should generate UUIDs or similar format', async () => {
      let capturedHeader: string | null = null

      const mockFetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
        const headers = new Headers(init.headers)
        capturedHeader = headers.get('X-Correlation-ID')
        return new Response(JSON.stringify({ result: 'ok' }), { status: 200 })
      })

      const originalFetch = global.fetch
      global.fetch = mockFetch as unknown as typeof fetch

      try {
        interface TestAPI {
          method(): Promise<{ result: string }>
        }

        const client = createClient<TestAPI>({ url: 'http://localhost:8787' })
        await client.method()

        // Should be a valid ID format (UUID-like or similar)
        expect(capturedHeader).toBeTruthy()
        expect(typeof capturedHeader).toBe('string')
        expect(capturedHeader!.length).toBeGreaterThan(8)
      } finally {
        global.fetch = originalFetch
      }
    })
  })

  describe('Header Propagation', () => {
    it('should pass correlation ID through X-Correlation-ID header in createClient', async () => {
      let receivedHeaders: Headers | null = null

      const mockFetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
        receivedHeaders = new Headers(init.headers)
        return new Response(JSON.stringify({ result: 'ok' }), { status: 200 })
      })

      const originalFetch = global.fetch
      global.fetch = mockFetch as unknown as typeof fetch

      try {
        interface TestAPI {
          method(): Promise<{ result: string }>
        }

        const client = createClient<TestAPI>({ url: 'http://localhost:8787' })
        await client.method()

        expect(receivedHeaders).not.toBeNull()
        expect(receivedHeaders!.get('X-Correlation-ID')).toBeTruthy()
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should pass correlation ID through X-Correlation-ID header in createDOStub', async () => {
      let receivedHeaders: Headers | null = null

      const mockStub = {
        fetch: vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
          receivedHeaders = new Headers(init.headers)
          return new Response(JSON.stringify({ result: 'ok' }), { status: 200 })
        })
      }

      const mockBinding = {
        idFromName: vi.fn().mockReturnValue({ toString: () => 'mock-id' }),
        get: vi.fn().mockReturnValue(mockStub)
      } as unknown as DurableObjectNamespace

      interface DOAPI {
        method(): Promise<{ result: string }>
      }

      const stub = createDOStub<DOAPI>(mockBinding, 'test-id')
      await stub.method()

      expect(receivedHeaders).not.toBeNull()
      expect(receivedHeaders!.get('X-Correlation-ID')).toBeTruthy()
    })

    it('should pass correlation ID through X-Correlation-ID header in createCrossDOClient', async () => {
      let receivedHeaders: Headers | null = null

      const mockBinding = {
        idFromName: () => ({ toString: () => 'test-id' }),
        get: () => ({
          fetch: async (url: string, options: RequestInit) => {
            receivedHeaders = new Headers(options.headers)
            return new Response(JSON.stringify(1000), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            })
          }
        })
      } as unknown as DurableObjectNamespace

      interface TestDO {
        getBalance(): Promise<number>
      }

      const client = createCrossDOClient<TestDO>(mockBinding, 'customer-123')
      await client.getBalance()

      expect(receivedHeaders).not.toBeNull()
      expect(receivedHeaders!.get('X-Correlation-ID')).toBeTruthy()
    })
  })

  describe('Server-side Extraction', () => {
    it('should extract correlation ID from request headers in server', async () => {
      const testCorrelationId = 'test-correlation-id-123'
      let extractedCorrelationId: string | null = null

      const testTarget = {
        method: function(this: { correlationId?: string }) {
          extractedCorrelationId = this?.correlationId ?? null
          return 'result'
        }
      }

      const app = createServer({ target: testTarget })

      const res = await app.request('/rpc', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Correlation-ID': testCorrelationId
        },
        body: JSON.stringify({ method: 'method', args: [] })
      })

      expect(res.status).toBe(200)
      // The server should have access to the correlation ID
      // This will be available via context after implementation
    })

    it('should include correlation ID in error responses', async () => {
      const testCorrelationId = 'error-correlation-id-456'

      const testTarget = {
        throws: () => { throw new Error('Test error') }
      }

      const app = createServer({ target: testTarget })

      const res = await app.request('/rpc', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Correlation-ID': testCorrelationId
        },
        body: JSON.stringify({ method: 'throws', args: [] })
      })

      expect(res.status).toBe(500)

      // Response should include the correlation ID for debugging
      expect(res.headers.get('X-Correlation-ID')).toBe(testCorrelationId)
    })

    it('should generate correlation ID if not provided', async () => {
      const testTarget = {
        method: () => 'result'
      }

      const app = createServer({ target: testTarget })

      const res = await app.request('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'method', args: [] })
      })

      expect(res.status).toBe(200)
      // Server should generate a correlation ID if none provided
      expect(res.headers.get('X-Correlation-ID')).toBeTruthy()
    })
  })

  describe('Cross-DO Propagation', () => {
    it('should propagate correlation ID through DO-to-DO calls', async () => {
      const capturedCorrelationIds: string[] = []

      const mockBinding = {
        idFromName: (name: string) => ({ toString: () => name }),
        get: () => ({
          fetch: async (url: string, options: RequestInit) => {
            const headers = new Headers(options.headers)
            const correlationId = headers.get('X-Correlation-ID')
            if (correlationId) {
              capturedCorrelationIds.push(correlationId)
            }
            return new Response(JSON.stringify({ success: true }))
          }
        })
      } as unknown as DurableObjectNamespace

      const mockEnv = { Test: mockBinding }
      const $ = new CrossDOContext(mockEnv)

      interface TestDO {
        method(): Promise<{ success: boolean }>
      }

      // Call multiple DOs in parallel (simulating a chain)
      await Promise.all([
        $.Test<TestDO>('do-1').method(),
        $.Test<TestDO>('do-2').method(),
        $.Test<TestDO>('do-3').method()
      ])

      // All calls should have correlation IDs
      expect(capturedCorrelationIds).toHaveLength(3)
      expect(capturedCorrelationIds.every(id => typeof id === 'string' && id.length > 0)).toBe(true)
    })

    it('should allow custom correlation ID for request tracing', async () => {
      let capturedCorrelationId: string | null = null
      const customCorrelationId = 'custom-trace-id-789'

      const mockBinding = {
        idFromName: () => ({ toString: () => 'test-id' }),
        get: () => ({
          fetch: async (url: string, options: RequestInit) => {
            const headers = new Headers(options.headers)
            capturedCorrelationId = headers.get('X-Correlation-ID')
            return new Response(JSON.stringify(42))
          }
        })
      } as unknown as DurableObjectNamespace

      interface TestDO {
        getValue(): Promise<number>
      }

      // Create client with custom correlation ID
      const client = createCrossDOClient<TestDO>(
        mockBinding,
        'test-do',
        undefined,  // no cache
        { correlationId: customCorrelationId }
      )
      await client.getValue()

      expect(capturedCorrelationId).toBe(customCorrelationId)
    })
  })

  describe('Logging Context', () => {
    it('should include correlation ID in RPC error messages', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers({ 'X-Correlation-ID': 'error-trace-123' })
      })

      const originalFetch = global.fetch
      global.fetch = mockFetch as unknown as typeof fetch

      try {
        interface TestAPI {
          fail(): Promise<void>
        }

        const client = createClient<TestAPI>({ url: 'http://localhost:8787' })

        await expect(client.fail()).rejects.toThrow(/error-trace-123|500/)
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should include correlation ID in DO RPC error messages', async () => {
      const mockStub = {
        fetch: vi.fn().mockResolvedValueOnce({
          ok: false,
          status: 500,
          headers: new Headers({ 'X-Correlation-ID': 'do-error-trace-456' })
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

      await expect(stub.fail()).rejects.toThrow(/do-error-trace-456|500/)
    })
  })

  describe('Request Context', () => {
    it('should allow inheriting correlation ID from incoming request', async () => {
      const incomingCorrelationId = 'incoming-request-correlation-id'
      let outgoingCorrelationId: string | null = null

      const mockBinding = {
        idFromName: () => ({ toString: () => 'test-id' }),
        get: () => ({
          fetch: async (url: string, options: RequestInit) => {
            const headers = new Headers(options.headers)
            outgoingCorrelationId = headers.get('X-Correlation-ID')
            return new Response(JSON.stringify(42))
          }
        })
      } as unknown as DurableObjectNamespace

      interface TestDO {
        getValue(): Promise<number>
      }

      // Create context with inherited correlation ID
      const context = new CrossDOContext(
        { Test: mockBinding },
        { correlationId: incomingCorrelationId }
      )

      await context.Test<TestDO>('test-1').getValue()

      // The outgoing call should use the same correlation ID
      expect(outgoingCorrelationId).toBe(incomingCorrelationId)
    })
  })
})
