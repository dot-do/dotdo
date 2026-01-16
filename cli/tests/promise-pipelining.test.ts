/**
 * Promise Pipelining Tests (TDD RED Phase)
 *
 * Vision: "Every `.` builds a pipeline - no round trips until `await`"
 *
 * These tests verify that chained property accesses and method calls
 * are batched into a single RPC message, not sent as individual calls.
 *
 * Example that should be ONE RPC call:
 * ```typescript
 * const result = await Customer.get("c-123").orders.list()
 * ```
 *
 * Currently: Each `.` creates a separate RPC call (3 round trips)
 * Vision: Build pipeline during chaining, send single batch on await (1 round trip)
 *
 * These tests should FAIL because true pipelining isn't implemented yet.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ============================================================================
// Mock WebSocket Setup
// ============================================================================

const { wsInstances, getMockWs, resetWs } = vi.hoisted(() => {
  const instances: MockedWebSocket[] = []
  return {
    wsInstances: instances,
    getMockWs: () => instances[instances.length - 1],
    resetWs: () => {
      instances.length = 0
    },
  }
})

interface MockedWebSocket {
  url: string
  options?: { headers?: Record<string, string> }
  readyState: number
  send: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  on(event: string, handler: (...args: unknown[]) => void): MockedWebSocket
  _triggerEvent(event: string, ...args: unknown[]): boolean
}

vi.mock('ws', () => {
  class MockWebSocket implements MockedWebSocket {
    readyState: number = 0
    url: string
    options?: { headers?: Record<string, string> }
    private eventHandlers: Map<string, ((...args: unknown[]) => void)[]> = new Map()

    send = vi.fn()
    close = vi.fn(function (this: MockedWebSocket, code?: number, reason?: string) {
      this.readyState = 3
      setImmediate(() => {
        const handlers = (this as unknown as MockWebSocket).eventHandlers.get('close')
        if (handlers) {
          handlers.forEach((h) => h(code ?? 1000, Buffer.from(reason ?? 'closed')))
        }
      })
    })

    constructor(url: string, options?: { headers?: Record<string, string> }) {
      this.url = url
      this.options = options
      wsInstances.push(this)
    }

    on(event: string, handler: (...args: unknown[]) => void): MockedWebSocket {
      if (!this.eventHandlers.has(event)) {
        this.eventHandlers.set(event, [])
      }
      this.eventHandlers.get(event)!.push(handler)
      return this
    }

    _triggerEvent(event: string, ...args: unknown[]): boolean {
      const handlers = this.eventHandlers.get(event)
      if (handlers) {
        handlers.forEach((h) => h(...args))
        return true
      }
      return false
    }
  }

  return { default: MockWebSocket }
})

import { RpcClient } from '../src/rpc-client.js'

// ============================================================================
// Helper Functions
// ============================================================================

function simulateOpen(ws: MockedWebSocket) {
  ws.readyState = 1
  ws._triggerEvent('open')
}

function simulateResponse(ws: MockedWebSocket, id: string, result: unknown) {
  ws._triggerEvent(
    'message',
    JSON.stringify({
      id,
      type: 'response',
      result,
    })
  )
}

function simulatePipelineResponse(
  ws: MockedWebSocket,
  id: string,
  results: { step: number; value: unknown }[],
  finalResult: unknown
) {
  ws._triggerEvent(
    'message',
    JSON.stringify({
      id,
      type: 'response',
      result: {
        steps: results,
        final: finalResult,
      },
    })
  )
}

function simulateErrorResponse(ws: MockedWebSocket, id: string, error: { message: string; code?: string; step?: number }) {
  ws._triggerEvent(
    'message',
    JSON.stringify({
      id,
      type: 'response',
      error,
    })
  )
}

/**
 * Connect client and return mock WebSocket
 */
async function connectClient(
  client: RpcClient,
  schema = { name: 'Test', fields: [], methods: [] }
): Promise<MockedWebSocket> {
  const connectPromise = client.connect()
  await vi.advanceTimersByTimeAsync(0)

  const mockWs = getMockWs()
  simulateOpen(mockWs)

  await vi.advanceTimersByTimeAsync(0)
  const introspectCall = JSON.parse(mockWs.send.mock.calls[0][0])
  simulateResponse(mockWs, introspectCall.id, schema)

  await connectPromise
  return mockWs
}

// ============================================================================
// Tests
// ============================================================================

describe('Promise Pipelining - RED Phase', () => {
  let client: RpcClient
  let mockWs: MockedWebSocket

  beforeEach(() => {
    vi.useFakeTimers()
    resetWs()

    client = new RpcClient({
      url: 'wss://test.api.dotdo.dev/ws/rpc',
      timeout: 5000,
      autoReconnect: false,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  // ==========================================================================
  // 1. Chained property accesses don't trigger immediate RPC calls
  // ==========================================================================
  describe('1. Deferred execution - no RPC until await', () => {
    it('should NOT send RPC when accessing properties without await', async () => {
      mockWs = await connectClient(client)
      const initialCallCount = mockWs.send.mock.calls.length

      const proxy = client.createProxy<{
        Customer: {
          get: (id: string) => {
            orders: {
              list: () => Promise<unknown[]>
            }
          }
        }
      }>()

      // Access properties without awaiting - should NOT trigger RPC
      const pipeline = proxy.Customer.get('c-123').orders.list

      // Advance timers to ensure any async operations would have fired
      await vi.advanceTimersByTimeAsync(100)

      // Should NOT have sent any new RPC calls (only the introspect call from connect)
      expect(mockWs.send.mock.calls.length).toBe(initialCallCount)
    })

    it('should only send RPC when the chain is awaited', async () => {
      mockWs = await connectClient(client)
      const initialCallCount = mockWs.send.mock.calls.length

      const proxy = client.createProxy<{
        Customer: {
          get: (id: string) => {
            orders: {
              list: () => Promise<unknown[]>
            }
          }
        }
      }>()

      // Build pipeline without await
      const pipeline = proxy.Customer.get('c-123').orders.list()

      // Still no new calls yet (before await resolves)
      await vi.advanceTimersByTimeAsync(0)

      // Now the call should have been sent
      expect(mockWs.send.mock.calls.length).toBe(initialCallCount + 1)

      // Complete the call
      const callMsg = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])
      simulateResponse(mockWs, callMsg.id, [])
      await pipeline
    })

    it('should collect path segments during chaining', async () => {
      mockWs = await connectClient(client)

      const proxy = client.createProxy<{
        Namespace: {
          Entity: {
            method: (arg: string) => {
              subMethod: () => Promise<unknown>
            }
          }
        }
      }>()

      // Build a deep chain
      const resultPromise = proxy.Namespace.Entity.method('arg1').subMethod()
      await vi.advanceTimersByTimeAsync(0)

      const callMsg = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])

      // The path should include ALL segments collected during chaining
      // Currently this likely sends each segment separately or only the final one
      // With pipelining, it should send the full path
      expect(callMsg.path).toEqual(['Namespace', 'Entity', 'method', 'subMethod'])

      simulateResponse(mockWs, callMsg.id, { result: 'ok' })
      await resultPromise
    })
  })

  // ==========================================================================
  // 2. RPC call deferred until await/then
  // ==========================================================================
  describe('2. Pipeline message on await/then', () => {
    it('should trigger RPC when .then() is called', async () => {
      mockWs = await connectClient(client)
      const initialCallCount = mockWs.send.mock.calls.length

      const proxy = client.createProxy<{
        User: {
          find: (id: string) => Promise<{ name: string }>
        }
      }>()

      // Using .then() instead of await
      let resolved = false
      proxy.User.find('u-1').then(() => {
        resolved = true
      })

      await vi.advanceTimersByTimeAsync(0)

      // Should have sent the call
      expect(mockWs.send.mock.calls.length).toBe(initialCallCount + 1)

      const callMsg = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])
      simulateResponse(mockWs, callMsg.id, { name: 'Alice' })

      await vi.advanceTimersByTimeAsync(0)
      expect(resolved).toBe(true)
    })

    it('should trigger RPC when Promise.all is used', async () => {
      mockWs = await connectClient(client)
      const initialCallCount = mockWs.send.mock.calls.length

      const proxy = client.createProxy<{
        User: {
          find: (id: string) => Promise<{ name: string }>
        }
      }>()

      // Multiple pipelines in Promise.all
      const promise = Promise.all([proxy.User.find('u-1'), proxy.User.find('u-2')])

      await vi.advanceTimersByTimeAsync(0)

      // Should have sent both calls
      expect(mockWs.send.mock.calls.length).toBe(initialCallCount + 2)

      // Complete both
      const calls = mockWs.send.mock.calls.slice(initialCallCount)
      calls.forEach((call: [string], i: number) => {
        const msg = JSON.parse(call[0])
        simulateResponse(mockWs, msg.id, { name: `User${i + 1}` })
      })

      const results = await promise
      expect(results).toHaveLength(2)
    })
  })

  // ==========================================================================
  // 3. Single 'pipeline' message with array of operations
  // ==========================================================================
  describe('3. Pipeline message format', () => {
    it('should send a single "pipeline" type message for chained calls', async () => {
      mockWs = await connectClient(client)
      const initialCallCount = mockWs.send.mock.calls.length

      const proxy = client.createProxy<{
        Customer: {
          get: (id: string) => {
            orders: {
              list: () => Promise<unknown[]>
            }
          }
        }
      }>()

      // This chain should result in ONE RPC message
      const resultPromise = proxy.Customer.get('c-123').orders.list()
      await vi.advanceTimersByTimeAsync(0)

      // Should be exactly 1 new call (not 3)
      expect(mockWs.send.mock.calls.length).toBe(initialCallCount + 1)

      const callMsg = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])

      // Message should be type 'pipeline'
      expect(callMsg.type).toBe('pipeline')

      simulateResponse(mockWs, callMsg.id, [])
      await resultPromise
    })

    it('should include operations array with path and args for each step', async () => {
      mockWs = await connectClient(client)

      const proxy = client.createProxy<{
        Customer: {
          get: (id: string) => {
            orders: {
              filter: (status: string) => {
                limit: (n: number) => Promise<unknown[]>
              }
            }
          }
        }
      }>()

      const resultPromise = proxy.Customer.get('c-123').orders.filter('active').limit(10)
      await vi.advanceTimersByTimeAsync(0)

      const callMsg = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])

      // Should have pipeline message format
      expect(callMsg.type).toBe('pipeline')
      expect(callMsg.operations).toBeInstanceOf(Array)

      // Operations should capture each step with its arguments
      // Property access has type: 'get', method calls have type: 'call'
      expect(callMsg.operations).toEqual([
        { path: 'Customer', args: [], type: 'get' },
        { path: 'get', args: ['c-123'], type: 'call' },
        { path: 'orders', args: [], type: 'get' },
        { path: 'filter', args: ['active'], type: 'call' },
        { path: 'limit', args: [10], type: 'call' },
      ])

      simulateResponse(mockWs, callMsg.id, [])
      await resultPromise
    })

    it('should distinguish between property access and method call in operations', async () => {
      mockWs = await connectClient(client)

      const proxy = client.createProxy<{
        db: {
          users: {
            where: (condition: object) => Promise<unknown[]>
          }
        }
      }>()

      const resultPromise = proxy.db.users.where({ active: true })
      await vi.advanceTimersByTimeAsync(0)

      const callMsg = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])

      expect(callMsg.type).toBe('pipeline')
      expect(callMsg.operations).toEqual([
        { path: 'db', args: [], type: 'get' }, // property access
        { path: 'users', args: [], type: 'get' }, // property access
        { path: 'where', args: [{ active: true }], type: 'call' }, // method call
      ])

      simulateResponse(mockWs, callMsg.id, [])
      await resultPromise
    })
  })

  // ==========================================================================
  // 4. Pipeline message format validation
  // ==========================================================================
  describe('4. Pipeline message structure', () => {
    it('should have unique correlation ID for pipeline message', async () => {
      mockWs = await connectClient(client)

      const proxy = client.createProxy<{
        Entity: {
          method: () => Promise<unknown>
        }
      }>()

      const p1 = proxy.Entity.method()
      const p2 = proxy.Entity.method()
      await vi.advanceTimersByTimeAsync(0)

      const calls = mockWs.send.mock.calls.slice(-2)
      const msg1 = JSON.parse(calls[0][0])
      const msg2 = JSON.parse(calls[1][0])

      expect(msg1.id).toBeDefined()
      expect(msg2.id).toBeDefined()
      expect(msg1.id).not.toBe(msg2.id)

      simulateResponse(mockWs, msg1.id, {})
      simulateResponse(mockWs, msg2.id, {})
      await Promise.all([p1, p2])
    })

    it('should serialize complex arguments in pipeline operations', async () => {
      mockWs = await connectClient(client)

      const proxy = client.createProxy<{
        orders: {
          create: (data: {
            items: { sku: string; qty: number }[]
            metadata: { date: Date }
          }) => Promise<{ id: string }>
        }
      }>()

      const date = new Date('2024-06-15T10:30:00Z')
      const resultPromise = proxy.orders.create({
        items: [{ sku: 'ABC-123', qty: 2 }],
        metadata: { date },
      })
      await vi.advanceTimersByTimeAsync(0)

      const callMsg = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])

      // Date should be serialized
      const createOp = callMsg.operations.find((op: { path: string }) => op.path === 'create')
      expect(createOp.args[0].metadata.date).toEqual({ __rpc_date: '2024-06-15T10:30:00.000Z' })

      simulateResponse(mockWs, callMsg.id, { id: 'ord-1' })
      await resultPromise
    })
  })

  // ==========================================================================
  // 5. Server response with intermediate and final results
  // ==========================================================================
  describe('5. Pipeline response handling', () => {
    it('should resolve with final result from pipeline response', async () => {
      mockWs = await connectClient(client)

      const proxy = client.createProxy<{
        Customer: {
          get: (id: string) => {
            orders: {
              list: () => Promise<{ items: unknown[] }>
            }
          }
        }
      }>()

      const resultPromise = proxy.Customer.get('c-123').orders.list()
      await vi.advanceTimersByTimeAsync(0)

      const callMsg = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])

      // Server responds with pipeline result containing intermediate steps
      simulatePipelineResponse(
        mockWs,
        callMsg.id,
        [
          { step: 0, value: { $type: 'Customer', $id: 'c-123' } },
          { step: 1, value: { count: 5 } },
        ],
        { items: [{ id: 'ord-1' }, { id: 'ord-2' }] }
      )

      const result = await resultPromise
      // Result includes pipeline metadata, use toMatchObject to check core data
      expect(result).toMatchObject({ items: [{ id: 'ord-1' }, { id: 'ord-2' }] })
    })

    it('should make intermediate results available through pipeline metadata', async () => {
      mockWs = await connectClient(client)

      const proxy = client.createProxy<{
        Customer: {
          get: (id: string) => {
            profile: {
              avatar: () => Promise<{ url: string }>
            }
          }
        }
      }>()

      const resultPromise = proxy.Customer.get('c-123').profile.avatar()
      await vi.advanceTimersByTimeAsync(0)

      const callMsg = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])

      simulatePipelineResponse(
        mockWs,
        callMsg.id,
        [
          { step: 0, value: { $type: 'Customer', $id: 'c-123', name: 'Alice' } },
          { step: 1, value: { bio: 'Hello!', avatarId: 'av-1' } },
        ],
        { url: 'https://example.com/avatar.png' }
      )

      const result = (await resultPromise) as { url: string; $pipeline?: { steps: unknown[] } }

      // Final result should have pipeline metadata for debugging/inspection
      expect(result.$pipeline).toBeDefined()
      expect(result.$pipeline?.steps).toHaveLength(2)
    })

    it('should handle null intermediate results in pipeline', async () => {
      mockWs = await connectClient(client)

      const proxy = client.createProxy<{
        User: {
          findByEmail: (email: string) => {
            preferences: () => Promise<unknown>
          }
        }
      }>()

      const resultPromise = proxy.User.findByEmail('unknown@test.com').preferences()
      await vi.advanceTimersByTimeAsync(0)

      const callMsg = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])

      // User not found - intermediate result is null
      simulatePipelineResponse(mockWs, callMsg.id, [{ step: 0, value: null }], null)

      const result = await resultPromise
      expect(result).toBeNull()
    })
  })

  // ==========================================================================
  // 6. Error propagation in pipeline
  // ==========================================================================
  describe('6. Pipeline error handling', () => {
    it('should reject with error when pipeline step fails', async () => {
      mockWs = await connectClient(client)

      const proxy = client.createProxy<{
        Customer: {
          get: (id: string) => {
            orders: {
              list: () => Promise<unknown[]>
            }
          }
        }
      }>()

      const resultPromise = proxy.Customer.get('invalid-id').orders.list()
      await vi.advanceTimersByTimeAsync(0)

      const callMsg = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])

      simulateErrorResponse(mockWs, callMsg.id, {
        message: 'Customer not found',
        code: 'NOT_FOUND',
        step: 0, // Error occurred at step 0 (Customer.get)
      })

      // Use try/catch instead of expect().rejects for custom thenables
      try {
        await resultPromise
        expect.fail('Should have thrown')
      } catch (err) {
        expect((err as Error).message).toBe('Customer not found')
      }
    })

    it('should include step information in pipeline error', async () => {
      mockWs = await connectClient(client)

      const proxy = client.createProxy<{
        Order: {
          get: (id: string) => {
            invoice: {
              download: () => Promise<Blob>
            }
          }
        }
      }>()

      const resultPromise = proxy.Order.get('ord-1').invoice.download()
      await vi.advanceTimersByTimeAsync(0)

      const callMsg = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])

      simulateErrorResponse(mockWs, callMsg.id, {
        message: 'Invoice generation failed',
        code: 'INTERNAL_ERROR',
        step: 2, // Error at step 2 (invoice.download)
      })

      try {
        await resultPromise
        expect.fail('Should have thrown')
      } catch (err) {
        const error = err as Error & { pipelineStep?: number }
        expect(error.message).toBe('Invoice generation failed')
        expect(error.pipelineStep).toBe(2)
      }
    })

    it('should stop pipeline execution on first error', async () => {
      mockWs = await connectClient(client)

      const proxy = client.createProxy<{
        db: {
          transaction: () => {
            execute: (sql: string) => {
              commit: () => Promise<void>
            }
          }
        }
      }>()

      const resultPromise = proxy.db.transaction().execute('SELECT *').commit()
      await vi.advanceTimersByTimeAsync(0)

      const callMsg = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])

      // Error at transaction step - execute and commit should not run
      simulateErrorResponse(mockWs, callMsg.id, {
        message: 'Failed to start transaction',
        code: 'TX_ERROR',
        step: 0,
      })

      // Use try/catch instead of expect().rejects for custom thenables
      try {
        await resultPromise
        expect.fail('Should have thrown')
      } catch (err) {
        expect((err as Error).message).toBe('Failed to start transaction')
      }
    })

    it('should support partial results before error', async () => {
      mockWs = await connectClient(client)

      const proxy = client.createProxy<{
        workflow: {
          start: () => {
            step1: () => {
              step2: () => Promise<unknown>
            }
          }
        }
      }>()

      const resultPromise = proxy.workflow.start().step1().step2()
      await vi.advanceTimersByTimeAsync(0)

      const callMsg = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])

      // Server sends error with partial results
      mockWs._triggerEvent(
        'message',
        JSON.stringify({
          id: callMsg.id,
          type: 'response',
          error: {
            message: 'Step 2 failed',
            code: 'STEP_ERROR',
            step: 2,
          },
          partialResults: [
            { step: 0, value: { workflowId: 'wf-1' } },
            { step: 1, value: { step1Complete: true } },
          ],
        })
      )

      try {
        await resultPromise
        expect.fail('Should have thrown')
      } catch (err) {
        const error = err as Error & { partialResults?: unknown[] }
        expect(error.message).toBe('Step 2 failed')
        // Partial results should be accessible for debugging
        expect(error.partialResults).toHaveLength(2)
      }
    })
  })

  // ==========================================================================
  // 7. Performance: 10 chained calls = 1 RPC
  // ==========================================================================
  describe('7. Performance - single RPC for chains', () => {
    it('should send exactly 1 RPC for 10 chained operations', async () => {
      mockWs = await connectClient(client)
      const initialCallCount = mockWs.send.mock.calls.length

      const proxy = client.createProxy<{
        a: {
          b: {
            c: {
              d: {
                e: {
                  f: {
                    g: {
                      h: {
                        i: {
                          j: () => Promise<string>
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }>()

      // 10 chained operations
      const resultPromise = proxy.a.b.c.d.e.f.g.h.i.j()
      await vi.advanceTimersByTimeAsync(0)

      // Should be exactly 1 new RPC call, not 10
      const newCallCount = mockWs.send.mock.calls.length - initialCallCount
      expect(newCallCount).toBe(1)

      const callMsg = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])
      expect(callMsg.type).toBe('pipeline')
      expect(callMsg.operations).toHaveLength(10)

      simulateResponse(mockWs, callMsg.id, 'result')
      await resultPromise
    })

    it('should track operations count for performance monitoring', async () => {
      mockWs = await connectClient(client)

      const proxy = client.createProxy<{
        store: {
          products: {
            category: (cat: string) => {
              sort: (field: string) => {
                limit: (n: number) => {
                  offset: (n: number) => {
                    select: (fields: string[]) => Promise<unknown[]>
                  }
                }
              }
            }
          }
        }
      }>()

      const resultPromise = proxy.store.products.category('electronics').sort('price').limit(10).offset(20).select(['id', 'name'])

      await vi.advanceTimersByTimeAsync(0)

      const callMsg = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])

      // Pipeline message should include metadata for monitoring
      expect(callMsg.type).toBe('pipeline')
      expect(callMsg.operationCount).toBe(7) // store, products, category, sort, limit, offset, select

      simulateResponse(mockWs, callMsg.id, [])
      await resultPromise
    })

    it('should batch multiple independent chains efficiently', async () => {
      mockWs = await connectClient(client)
      const initialCallCount = mockWs.send.mock.calls.length

      const proxy = client.createProxy<{
        users: { list: () => Promise<unknown[]> }
        orders: { list: () => Promise<unknown[]> }
        products: { list: () => Promise<unknown[]> }
      }>()

      // Three independent chains
      const promises = Promise.all([proxy.users.list(), proxy.orders.list(), proxy.products.list()])

      await vi.advanceTimersByTimeAsync(0)

      // Should be 3 separate pipeline calls (independent chains can't be batched)
      const newCallCount = mockWs.send.mock.calls.length - initialCallCount
      expect(newCallCount).toBe(3)

      // Each should be type 'pipeline'
      const calls = mockWs.send.mock.calls.slice(initialCallCount)
      calls.forEach((call: [string]) => {
        const msg = JSON.parse(call[0])
        expect(msg.type).toBe('pipeline')
      })

      // Complete all
      calls.forEach((call: [string]) => {
        const msg = JSON.parse(call[0])
        simulateResponse(mockWs, msg.id, [])
      })

      await promises
    })
  })

  // ==========================================================================
  // Additional Edge Cases
  // ==========================================================================
  describe('Edge cases', () => {
    it('should handle empty pipeline (direct property access that returns value)', async () => {
      mockWs = await connectClient(client)

      const proxy = client.createProxy<{
        version: Promise<string>
      }>()

      const resultPromise = proxy.version
      await vi.advanceTimersByTimeAsync(0)

      const callMsg = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])

      expect(callMsg.type).toBe('pipeline')
      expect(callMsg.operations).toEqual([{ path: 'version', args: [], type: 'get' }])

      simulateResponse(mockWs, callMsg.id, '1.0.0')
      const result = await resultPromise
      expect(result).toBe('1.0.0')
    })

    it('should preserve "this" context across pipeline', async () => {
      mockWs = await connectClient(client)

      const proxy = client.createProxy<{
        counter: {
          increment: () => {
            increment: () => {
              value: () => Promise<number>
            }
          }
        }
      }>()

      const resultPromise = proxy.counter.increment().increment().value()
      await vi.advanceTimersByTimeAsync(0)

      const callMsg = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])

      // Each increment should operate on the result of the previous
      expect(callMsg.type).toBe('pipeline')
      expect(callMsg.operations).toEqual([
        { path: 'counter', args: [], type: 'get' },
        { path: 'increment', args: [], type: 'call' },
        { path: 'increment', args: [], type: 'call' },
        { path: 'value', args: [], type: 'call' },
      ])

      simulatePipelineResponse(
        mockWs,
        callMsg.id,
        [
          { step: 0, value: { count: 0 } },
          { step: 1, value: { count: 1 } },
          { step: 2, value: { count: 2 } },
        ],
        2
      )

      const result = await resultPromise
      expect(result).toBe(2)
    })

    it('should handle array indexing in pipeline', async () => {
      mockWs = await connectClient(client)

      const proxy = client.createProxy<{
        items: {
          [index: number]: {
            name: Promise<string>
          }
        }
      }>()

      // Accessing array index in chain
      const resultPromise = (proxy.items as Record<number, { name: Promise<string> }>)[0].name
      await vi.advanceTimersByTimeAsync(0)

      const callMsg = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])

      expect(callMsg.type).toBe('pipeline')
      expect(callMsg.operations).toContainEqual(
        expect.objectContaining({ path: '0', type: 'get' })
      )

      simulateResponse(mockWs, callMsg.id, 'First Item')
      const result = await resultPromise
      expect(result).toBe('First Item')
    })

    it('should handle callbacks within pipeline operations', async () => {
      mockWs = await connectClient(client)

      const onProgress = vi.fn()

      const proxy = client.createProxy<{
        task: {
          run: (options: { onProgress: (p: number) => void }) => Promise<{ result: string }>
        }
      }>()

      const resultPromise = proxy.task.run({ onProgress })
      await vi.advanceTimersByTimeAsync(0)

      const callMsg = JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0])

      // Callback should be serialized within pipeline operation
      expect(callMsg.type).toBe('pipeline')
      const runOp = callMsg.operations.find((op: { path: string }) => op.path === 'run')
      expect(runOp.args[0].onProgress).toHaveProperty('__rpc_callback_id')

      simulateResponse(mockWs, callMsg.id, { result: 'done' })
      await resultPromise
    })
  })
})
