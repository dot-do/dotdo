/**
 * Batch Message Execution Tests (TDD)
 *
 * Tests for RpcBatcher (client-side batching) and executeBatch (broker-side execution).
 * These tests define the expected behavior for batch RPC message handling.
 *
 * Key capabilities:
 * - Client collects calls into batches before sending
 * - Auto-flush after configurable timeout
 * - Broker executes batch calls in parallel
 * - Groups calls by target for efficiency
 * - Returns partial results on failures
 *
 * @see do-tpv6 - Batch Message Execution task
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  RpcBatcher,
  executeBatch,
  type RpcTarget,
} from '../batch'
import {
  CallMessage,
  ReturnMessage,
  ErrorMessage,
  BatchMessage,
  BatchReturnMessage,
  generateBrokerMessageId,
} from '../broker-protocol'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Creates a mock send function that tracks calls and returns mock responses
 */
function createMockSend(): {
  send: (batch: BatchMessage) => Promise<BatchReturnMessage>
  calls: BatchMessage[]
  setResponses: (responses: Map<string, unknown | Error>) => void
} {
  const calls: BatchMessage[] = []
  let responseMap = new Map<string, unknown | Error>()

  const send = async (batch: BatchMessage): Promise<BatchReturnMessage> => {
    calls.push(batch)

    const results: (ReturnMessage | ErrorMessage)[] = batch.calls.map((call) => {
      const response = responseMap.get(call.id)
      if (response instanceof Error) {
        return {
          id: call.id,
          type: 'error' as const,
          error: response.message,
        }
      }
      return {
        id: call.id,
        type: 'return' as const,
        value: response ?? { success: true },
      }
    })

    return {
      id: batch.id,
      type: 'batch_return' as const,
      results,
    }
  }

  return {
    send,
    calls,
    setResponses: (responses: Map<string, unknown | Error>) => {
      responseMap = responses
    },
  }
}

/**
 * Creates a mock RPC target for testing executeBatch
 */
function createMockTarget(
  id: string,
  results: Map<string, unknown | Error>
): RpcTarget {
  return {
    async rpcCall(method: string, args: unknown[], capability?: string): Promise<unknown> {
      const key = `${method}:${JSON.stringify(args)}`
      const result = results.get(key)
      if (result instanceof Error) {
        throw result
      }
      return result ?? { method, args, capability }
    },
  }
}

// ============================================================================
// 1. CLIENT API - COLLECT CALLS INTO BATCH
// ============================================================================

describe('Batch Messages', () => {
  describe('Client API', () => {
    it('should collect calls into batch', async () => {
      const { send, calls } = createMockSend()
      const batcher = new RpcBatcher(send)

      // Add multiple calls
      const p1 = batcher.add('target-1', 'getUser', ['user_123'])
      const p2 = batcher.add('target-1', 'getOrders', ['user_123'])
      const p3 = batcher.add('target-2', 'getProduct', ['prod_456'])

      // Calls not sent yet
      expect(calls).toHaveLength(0)

      // Manually flush
      await batcher.flush()

      // Now calls are sent as a batch
      expect(calls).toHaveLength(1)
      expect(calls[0].calls).toHaveLength(3)
      expect(calls[0].calls[0].target).toBe('target-1')
      expect(calls[0].calls[0].method).toBe('getUser')
      expect(calls[0].calls[1].method).toBe('getOrders')
      expect(calls[0].calls[2].target).toBe('target-2')
    })

    it('should send batch on flush()', async () => {
      const { send, calls } = createMockSend()
      const batcher = new RpcBatcher(send)

      batcher.add('target', 'method1', [])
      batcher.add('target', 'method2', [])

      expect(calls).toHaveLength(0)

      await batcher.flush()

      expect(calls).toHaveLength(1)
      expect(calls[0].type).toBe('batch')
      expect(calls[0].calls).toHaveLength(2)
    })

    it('should auto-flush after timeout', async () => {
      vi.useFakeTimers()

      const { send, calls } = createMockSend()
      const batcher = new RpcBatcher(send, { autoFlushMs: 50 })

      batcher.add('target', 'method', [])

      expect(calls).toHaveLength(0)

      // Advance timer past auto-flush threshold
      await vi.advanceTimersByTimeAsync(60)

      expect(calls).toHaveLength(1)

      vi.useRealTimers()
    })

    it('should resolve individual call promises', async () => {
      const { send, calls } = createMockSend()
      const batcher = new RpcBatcher(send)

      const p1 = batcher.add('target', 'getUser', ['alice'])
      const p2 = batcher.add('target', 'getUser', ['bob'])

      // Set up the response map before flush
      // The actual IDs are generated internally, so we need to access them after flush
      const flushPromise = batcher.flush()
      await flushPromise

      // Get the generated IDs from the sent batch
      const sentBatch = calls[0]
      const id1 = sentBatch.calls[0].id
      const id2 = sentBatch.calls[1].id

      // Await both promises - they should resolve with the mock values
      const [result1, result2] = await Promise.all([p1, p2])

      expect(result1).toEqual({ success: true })
      expect(result2).toEqual({ success: true })
    })

    it('should pass capability to call message', async () => {
      const { send, calls } = createMockSend()
      const batcher = new RpcBatcher(send)

      batcher.add('target', 'secureMethod', [], 'cap_token_xyz')

      await batcher.flush()

      expect(calls[0].calls[0].capability).toBe('cap_token_xyz')
    })

    it('should not send if no pending calls', async () => {
      const { send, calls } = createMockSend()
      const batcher = new RpcBatcher(send)

      await batcher.flush()
      await batcher.flush()
      await batcher.flush()

      expect(calls).toHaveLength(0)
    })

    it('should clear pending after flush', async () => {
      const { send, calls } = createMockSend()
      const batcher = new RpcBatcher(send)

      batcher.add('target', 'method', [])
      await batcher.flush()

      expect(calls).toHaveLength(1)

      // Second flush should not send anything
      await batcher.flush()

      expect(calls).toHaveLength(1)
    })

    it('should reject all promises on network error', async () => {
      const networkError = new Error('Network failure')
      const send = async (): Promise<BatchReturnMessage> => {
        throw networkError
      }
      const batcher = new RpcBatcher(send)

      const p1 = batcher.add('target', 'method1', [])
      const p2 = batcher.add('target', 'method2', [])

      const flushPromise = batcher.flush()

      const results = await Promise.allSettled([p1, p2])

      expect(results[0]).toEqual({ status: 'rejected', reason: networkError })
      expect(results[1]).toEqual({ status: 'rejected', reason: networkError })
    })

    it('should handle mixed success and error responses', async () => {
      // Custom send that returns mixed results
      const send = async (batch: BatchMessage): Promise<BatchReturnMessage> => {
        return {
          id: batch.id,
          type: 'batch_return',
          results: batch.calls.map((call, i) => {
            if (i === 1) {
              return { id: call.id, type: 'error', error: 'Method failed' }
            }
            return { id: call.id, type: 'return', value: `result-${i}` }
          }),
        }
      }
      const batcher = new RpcBatcher(send)

      const p1 = batcher.add('target', 'method1', [])
      const p2 = batcher.add('target', 'method2', [])
      const p3 = batcher.add('target', 'method3', [])

      await batcher.flush()

      const results = await Promise.allSettled([p1, p2, p3])

      expect(results[0]).toEqual({ status: 'fulfilled', value: 'result-0' })
      expect(results[1].status).toBe('rejected')
      expect(results[2]).toEqual({ status: 'fulfilled', value: 'result-2' })
    })

    it('should cancel auto-flush timer on manual flush', async () => {
      vi.useFakeTimers()

      const { send, calls } = createMockSend()
      const batcher = new RpcBatcher(send, { autoFlushMs: 100 })

      batcher.add('target', 'method', [])

      // Manual flush before timer
      await batcher.flush()

      expect(calls).toHaveLength(1)

      // Advance timer - should not trigger another flush
      await vi.advanceTimersByTimeAsync(200)

      expect(calls).toHaveLength(1)

      vi.useRealTimers()
    })
  })

  // ============================================================================
  // 2. BROKER EXECUTION
  // ============================================================================

  describe('Broker Execution', () => {
    it('should execute batch calls in parallel', async () => {
      const executionOrder: string[] = []
      const targets = new Map<string, RpcTarget>()

      targets.set('target-1', {
        async rpcCall(method: string, args: unknown[]): Promise<unknown> {
          executionOrder.push(`start:${method}`)
          await new Promise((r) => setTimeout(r, 10))
          executionOrder.push(`end:${method}`)
          return { method }
        },
      })

      const calls: CallMessage[] = [
        { id: '1', type: 'call', target: 'target-1', method: 'a', args: [] },
        { id: '2', type: 'call', target: 'target-1', method: 'b', args: [] },
        { id: '3', type: 'call', target: 'target-1', method: 'c', args: [] },
      ]

      const results = await executeBatch(calls, (target) => targets.get(target) ?? null)

      // All should start before any ends (parallel execution)
      const startIndices = executionOrder
        .map((e, i) => (e.startsWith('start:') ? i : -1))
        .filter((i) => i >= 0)
      const endIndices = executionOrder
        .map((e, i) => (e.startsWith('end:') ? i : -1))
        .filter((i) => i >= 0)

      // All starts should come before all ends
      expect(Math.max(...startIndices)).toBeLessThan(Math.min(...endIndices))

      expect(results).toHaveLength(3)
      expect(results.every((r) => r.type === 'return')).toBe(true)
    })

    it('should group calls by target for efficiency', async () => {
      const targetCalls = new Map<string, number>()

      const createTarget = (id: string): RpcTarget => ({
        async rpcCall(): Promise<unknown> {
          targetCalls.set(id, (targetCalls.get(id) ?? 0) + 1)
          return { target: id }
        },
      })

      const targets = new Map<string, RpcTarget>([
        ['target-1', createTarget('target-1')],
        ['target-2', createTarget('target-2')],
      ])

      const calls: CallMessage[] = [
        { id: '1', type: 'call', target: 'target-1', method: 'a', args: [] },
        { id: '2', type: 'call', target: 'target-2', method: 'b', args: [] },
        { id: '3', type: 'call', target: 'target-1', method: 'c', args: [] },
        { id: '4', type: 'call', target: 'target-2', method: 'd', args: [] },
        { id: '5', type: 'call', target: 'target-1', method: 'e', args: [] },
      ]

      await executeBatch(calls, (target) => targets.get(target) ?? null)

      expect(targetCalls.get('target-1')).toBe(3)
      expect(targetCalls.get('target-2')).toBe(2)
    })

    it('should return all results in order', async () => {
      const targets = new Map<string, RpcTarget>()
      targets.set('target', {
        async rpcCall(method: string): Promise<unknown> {
          return { method }
        },
      })

      const calls: CallMessage[] = [
        { id: '1', type: 'call', target: 'target', method: 'first', args: [] },
        { id: '2', type: 'call', target: 'target', method: 'second', args: [] },
        { id: '3', type: 'call', target: 'target', method: 'third', args: [] },
      ]

      const results = await executeBatch(calls, (target) => targets.get(target) ?? null)

      expect(results).toHaveLength(3)
      expect(results[0].id).toBe('1')
      expect(results[1].id).toBe('2')
      expect(results[2].id).toBe('3')
      expect((results[0] as ReturnMessage).value).toEqual({ method: 'first' })
      expect((results[1] as ReturnMessage).value).toEqual({ method: 'second' })
      expect((results[2] as ReturnMessage).value).toEqual({ method: 'third' })
    })

    it('should include partial results on some failures', async () => {
      const targets = new Map<string, RpcTarget>()
      targets.set('target', {
        async rpcCall(method: string): Promise<unknown> {
          if (method === 'fail') {
            throw new Error('Method failed')
          }
          return { method }
        },
      })

      const calls: CallMessage[] = [
        { id: '1', type: 'call', target: 'target', method: 'success1', args: [] },
        { id: '2', type: 'call', target: 'target', method: 'fail', args: [] },
        { id: '3', type: 'call', target: 'target', method: 'success2', args: [] },
      ]

      const results = await executeBatch(calls, (target) => targets.get(target) ?? null)

      expect(results).toHaveLength(3)
      expect(results[0].type).toBe('return')
      expect((results[0] as ReturnMessage).value).toEqual({ method: 'success1' })
      expect(results[1].type).toBe('error')
      expect((results[1] as ErrorMessage).error).toBe('Method failed')
      expect(results[2].type).toBe('return')
      expect((results[2] as ReturnMessage).value).toEqual({ method: 'success2' })
    })

    it('should return error for unknown target', async () => {
      const targets = new Map<string, RpcTarget>()

      const calls: CallMessage[] = [
        { id: '1', type: 'call', target: 'unknown-target', method: 'method', args: [] },
      ]

      const results = await executeBatch(calls, (target) => targets.get(target) ?? null)

      expect(results).toHaveLength(1)
      expect(results[0].type).toBe('error')
      expect((results[0] as ErrorMessage).error).toContain('Target not found')
      expect((results[0] as ErrorMessage).code).toBe('TARGET_NOT_FOUND')
    })

    it('should pass args and capability to target', async () => {
      let receivedArgs: unknown[] = []
      let receivedCapability: string | undefined

      const targets = new Map<string, RpcTarget>()
      targets.set('target', {
        async rpcCall(method: string, args: unknown[], capability?: string): Promise<unknown> {
          receivedArgs = args
          receivedCapability = capability
          return { success: true }
        },
      })

      const calls: CallMessage[] = [
        {
          id: '1',
          type: 'call',
          target: 'target',
          method: 'method',
          args: ['arg1', { nested: 'value' }],
          capability: 'cap_xyz',
        },
      ]

      await executeBatch(calls, (target) => targets.get(target) ?? null)

      expect(receivedArgs).toEqual(['arg1', { nested: 'value' }])
      expect(receivedCapability).toBe('cap_xyz')
    })

    it('should handle empty batch', async () => {
      const results = await executeBatch([], () => null)

      expect(results).toEqual([])
    })

    it('should convert non-Error throws to string', async () => {
      const targets = new Map<string, RpcTarget>()
      targets.set('target', {
        async rpcCall(): Promise<unknown> {
          throw 'string error'
        },
      })

      const calls: CallMessage[] = [
        { id: '1', type: 'call', target: 'target', method: 'method', args: [] },
      ]

      const results = await executeBatch(calls, (target) => targets.get(target) ?? null)

      expect(results[0].type).toBe('error')
      expect((results[0] as ErrorMessage).error).toBe('string error')
    })
  })

  // ============================================================================
  // 3. PERFORMANCE
  // ============================================================================

  describe('Performance', () => {
    it('should be faster than sequential calls', async () => {
      const DELAY = 10
      const NUM_CALLS = 5

      const targets = new Map<string, RpcTarget>()
      targets.set('target', {
        async rpcCall(method: string): Promise<unknown> {
          await new Promise((r) => setTimeout(r, DELAY))
          return { method }
        },
      })

      const calls: CallMessage[] = Array.from({ length: NUM_CALLS }, (_, i) => ({
        id: `${i}`,
        type: 'call' as const,
        target: 'target',
        method: `method${i}`,
        args: [],
      }))

      const startTime = Date.now()
      await executeBatch(calls, (target) => targets.get(target) ?? null)
      const parallelTime = Date.now() - startTime

      // Sequential would take NUM_CALLS * DELAY = 50ms
      // Parallel should take approximately DELAY = 10ms (plus overhead)
      // We'll be generous and say it should be less than half sequential time
      const sequentialTime = NUM_CALLS * DELAY
      expect(parallelTime).toBeLessThan(sequentialTime / 2)
    })

    it('should handle 100 calls in batch', async () => {
      const NUM_CALLS = 100

      const targets = new Map<string, RpcTarget>()
      targets.set('target', {
        async rpcCall(method: string, args: unknown[]): Promise<unknown> {
          return { method, args }
        },
      })

      const calls: CallMessage[] = Array.from({ length: NUM_CALLS }, (_, i) => ({
        id: `call-${i}`,
        type: 'call' as const,
        target: 'target',
        method: `method${i}`,
        args: [i],
      }))

      const startTime = Date.now()
      const results = await executeBatch(calls, (target) => targets.get(target) ?? null)
      const elapsed = Date.now() - startTime

      expect(results).toHaveLength(NUM_CALLS)
      expect(results.every((r) => r.type === 'return')).toBe(true)

      // Should complete quickly (under 100ms for 100 sync calls)
      expect(elapsed).toBeLessThan(100)
    })

    it('should handle calls across multiple targets efficiently', async () => {
      const NUM_TARGETS = 10
      const CALLS_PER_TARGET = 10
      const DELAY = 5

      const targets = new Map<string, RpcTarget>()
      for (let i = 0; i < NUM_TARGETS; i++) {
        targets.set(`target-${i}`, {
          async rpcCall(): Promise<unknown> {
            await new Promise((r) => setTimeout(r, DELAY))
            return { target: i }
          },
        })
      }

      const calls: CallMessage[] = []
      for (let t = 0; t < NUM_TARGETS; t++) {
        for (let c = 0; c < CALLS_PER_TARGET; c++) {
          calls.push({
            id: `${t}-${c}`,
            type: 'call',
            target: `target-${t}`,
            method: `method${c}`,
            args: [],
          })
        }
      }

      const startTime = Date.now()
      const results = await executeBatch(calls, (target) => targets.get(target) ?? null)
      const elapsed = Date.now() - startTime

      expect(results).toHaveLength(NUM_TARGETS * CALLS_PER_TARGET)

      // With parallel execution across targets, should be much faster than sequential
      // Sequential: NUM_TARGETS * CALLS_PER_TARGET * DELAY = 500ms
      // Parallel per target: CALLS_PER_TARGET * DELAY = 50ms (all targets in parallel)
      // With some overhead, should be under 100ms
      expect(elapsed).toBeLessThan(NUM_TARGETS * CALLS_PER_TARGET * DELAY / 2)
    })
  })

  // ============================================================================
  // 4. INTEGRATION
  // ============================================================================

  describe('Integration', () => {
    it('should work end-to-end with RpcBatcher and executeBatch', async () => {
      // Set up targets
      const targets = new Map<string, RpcTarget>()
      targets.set('users', {
        async rpcCall(method: string, args: unknown[]): Promise<unknown> {
          if (method === 'getUser') {
            return { id: args[0], name: `User ${args[0]}` }
          }
          return null
        },
      })
      targets.set('orders', {
        async rpcCall(method: string, args: unknown[]): Promise<unknown> {
          if (method === 'getOrders') {
            return [{ id: 'order-1', userId: args[0] }]
          }
          return null
        },
      })

      // Create batcher with a send function that uses executeBatch
      const send = async (batch: BatchMessage): Promise<BatchReturnMessage> => {
        const results = await executeBatch(
          batch.calls,
          (target) => targets.get(target) ?? null
        )
        return {
          id: batch.id,
          type: 'batch_return',
          results,
        }
      }

      const batcher = new RpcBatcher(send)

      // Add calls
      const userPromise = batcher.add('users', 'getUser', ['user_123'])
      const ordersPromise = batcher.add('orders', 'getOrders', ['user_123'])

      // Flush and get results
      await batcher.flush()

      const [user, orders] = await Promise.all([userPromise, ordersPromise])

      expect(user).toEqual({ id: 'user_123', name: 'User user_123' })
      expect(orders).toEqual([{ id: 'order-1', userId: 'user_123' }])
    })
  })
})
