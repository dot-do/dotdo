/**
 * Pipeline Batching Tests (TDD RED Phase)
 *
 * Tests for PipelineBatcher - accumulates multiple pipelined calls and
 * batches them into a single network request.
 *
 * Key insight: Multiple pipelined calls should batch into one request:
 * ```typescript
 * const user = api.User(id)           // Not sent yet
 * const orders = user.orders()        // Not sent yet
 * const profile = user.profile        // Not sent yet
 * const [o, p] = await Promise.all([orders, profile])  // ONE request
 * ```
 *
 * This enables efficient network usage by:
 * 1. Accumulating pending pipelines during synchronous code execution
 * 2. Flushing at the end of the microtask queue
 * 3. Combining multiple pipelines into a single batch request
 *
 * @see do-bcm - RED: Pipeline transport batching tests
 * @see do-8nd - GREEN: Implement pipeline transport batching
 * @see do-aby - True Cap'n Web Pipelining epic
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Import from the module that doesn't exist yet - tests should FAIL
import {
  PipelineBatcher,
  createPipelineBatcher,
  type BatchConfig,
  type BatchRequest,
  type BatchResponse,
  type TransportFunction,
} from '../pipeline-batcher'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Creates a mock transport function that tracks calls and returns mock responses
 */
function createMockTransport(): {
  transport: TransportFunction
  calls: BatchRequest[][]
  mockResponses: Map<string, unknown>
} {
  const calls: BatchRequest[][] = []
  const mockResponses = new Map<string, unknown>()

  const transport: TransportFunction = async (batch: BatchRequest[]): Promise<BatchResponse[]> => {
    calls.push(batch)

    return batch.map((req, index) => {
      const mockResponse = mockResponses.get(req.id)
      if (mockResponse instanceof Error) {
        return { id: req.id, index, error: mockResponse.message }
      }
      return { id: req.id, index, result: mockResponse ?? { $id: req.id } }
    })
  }

  return { transport, calls, mockResponses }
}

/**
 * Helper to flush microtasks
 */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

// ============================================================================
// 1. CREATING STUBS DOESN'T TRIGGER NETWORK CALL
// ============================================================================

describe('Creating Stubs Does Not Trigger Network', () => {
  it('creating a stub returns immediately without network call', () => {
    const { transport, calls } = createMockTransport()
    const batcher = createPipelineBatcher({ transport })

    // Create stub - should NOT trigger transport
    const stub = batcher.createStub(['User', 'user_123'])

    // No network calls yet
    expect(calls).toHaveLength(0)
    expect(stub).toBeDefined()
  })

  it('accessing properties on stub does not trigger network call', () => {
    const { transport, calls } = createMockTransport()
    const batcher = createPipelineBatcher({ transport })

    const user = batcher.createStub(['User', 'user_123'])
    const _email = user.email
    const _profile = user.profile
    const _nested = user.profile.settings.theme

    // Still no network calls
    expect(calls).toHaveLength(0)
  })

  it('calling methods on stub does not trigger network call', () => {
    const { transport, calls } = createMockTransport()
    const batcher = createPipelineBatcher({ transport })

    const user = batcher.createStub(['User', 'user_123'])
    const _orders = user.getOrders()
    const _profile = user.getProfile()
    const _notify = user.notify('Hello')

    // Still no network calls
    expect(calls).toHaveLength(0)
  })

  it('chaining properties and methods does not trigger network call', () => {
    const { transport, calls } = createMockTransport()
    const batcher = createPipelineBatcher({ transport })

    const user = batcher.createStub(['User', 'user_123'])
    const _bio = user.getProfile().settings.theme
    const _orders = user.orders.first().items

    // Still no network calls
    expect(calls).toHaveLength(0)
  })
})

// ============================================================================
// 2. MULTIPLE STUBS ACCUMULATE IN BATCH
// ============================================================================

describe('Multiple Stubs Accumulate in Batch', () => {
  it('multiple stub operations are accumulated', () => {
    const { transport, calls } = createMockTransport()
    const batcher = createPipelineBatcher({ transport })

    const user = batcher.createStub(['User', 'user_123'])
    const _email = user.email
    const _profile = user.profile
    const _orders = user.getOrders()

    // Check internal pending count
    expect(batcher.pendingCount).toBe(3)
    expect(calls).toHaveLength(0)
  })

  it('stubs from different targets accumulate together', () => {
    const { transport, calls } = createMockTransport()
    const batcher = createPipelineBatcher({ transport })

    const user = batcher.createStub(['User', 'user_123'])
    const order = batcher.createStub(['Order', 'order_456'])
    const product = batcher.createStub(['Product', 'prod_789'])

    const _userEmail = user.email
    const _orderTotal = order.total
    const _productName = product.name

    expect(batcher.pendingCount).toBe(3)
    expect(calls).toHaveLength(0)
  })

  it('deeply nested chains are each separate pending operations', () => {
    const { transport, calls } = createMockTransport()
    const batcher = createPipelineBatcher({ transport })

    const user = batcher.createStub(['User', 'user_123'])
    const _theme = user.profile.settings.theme
    const _notifications = user.profile.settings.notifications
    const _avatar = user.profile.avatar

    // Each chain creates a separate pending operation
    expect(batcher.pendingCount).toBe(3)
    expect(calls).toHaveLength(0)
  })
})

// ============================================================================
// 3. AWAIT TRIGGERS BATCH FLUSH
// ============================================================================

describe('Await Triggers Batch Flush', () => {
  it('awaiting a stub triggers the batch flush', async () => {
    const { transport, calls, mockResponses } = createMockTransport()
    const batcher = createPipelineBatcher({ transport })

    mockResponses.set('req-0', 'alice@example.com')

    const user = batcher.createStub(['User', 'user_123'])
    const emailPromise = user.email

    expect(calls).toHaveLength(0)

    const email = await emailPromise

    expect(calls).toHaveLength(1)
    expect(email).toBe('alice@example.com')
  })

  it('batch flush happens after await completes', async () => {
    const { transport, calls, mockResponses } = createMockTransport()
    const batcher = createPipelineBatcher({ transport })

    mockResponses.set('req-0', { bio: 'Engineer' })

    const user = batcher.createStub(['User', 'user_123'])
    const profile = user.getProfile()

    // Not flushed yet
    expect(calls).toHaveLength(0)

    await profile

    // Now flushed
    expect(calls).toHaveLength(1)
  })

  it('pending count is zero after flush', async () => {
    const { transport, mockResponses } = createMockTransport()
    const batcher = createPipelineBatcher({ transport })

    mockResponses.set('req-0', 'result')

    const stub = batcher.createStub(['Test', 'test_1'])
    const _p = stub.value

    expect(batcher.pendingCount).toBe(1)

    await _p

    expect(batcher.pendingCount).toBe(0)
  })
})

// ============================================================================
// 4. PROMISE.ALL BATCHES MULTIPLE PIPELINES INTO SINGLE REQUEST
// ============================================================================

describe('Promise.all Batches Into Single Request', () => {
  it('Promise.all with multiple stubs results in single network call', async () => {
    const { transport, calls, mockResponses } = createMockTransport()
    const batcher = createPipelineBatcher({ transport })

    mockResponses.set('req-0', [{ id: 'order-1' }])
    mockResponses.set('req-1', { bio: 'Engineer' })

    const user = batcher.createStub(['User', 'user_123'])
    const orders = user.orders()
    const profile = user.profile

    // Both promises in a single Promise.all
    const [ordersResult, profileResult] = await Promise.all([orders, profile])

    // Should have made exactly ONE network call with both requests
    expect(calls).toHaveLength(1)
    expect(calls[0]).toHaveLength(2)
    expect(ordersResult).toEqual([{ id: 'order-1' }])
    expect(profileResult).toEqual({ bio: 'Engineer' })
  })

  it('Promise.all with multiple different targets batches correctly', async () => {
    const { transport, calls, mockResponses } = createMockTransport()
    const batcher = createPipelineBatcher({ transport })

    mockResponses.set('req-0', 'alice@example.com')
    mockResponses.set('req-1', 99.99)
    mockResponses.set('req-2', 'Widget')

    const user = batcher.createStub(['User', 'user_123'])
    const order = batcher.createStub(['Order', 'order_456'])
    const product = batcher.createStub(['Product', 'prod_789'])

    const [email, total, name] = await Promise.all([
      user.email,
      order.total,
      product.name,
    ])

    // Single batch with all three requests
    expect(calls).toHaveLength(1)
    expect(calls[0]).toHaveLength(3)
    expect(email).toBe('alice@example.com')
    expect(total).toBe(99.99)
    expect(name).toBe('Widget')
  })

  it('Promise.all preserves order of results', async () => {
    const { transport, calls, mockResponses } = createMockTransport()
    const batcher = createPipelineBatcher({ transport })

    mockResponses.set('req-0', 'first')
    mockResponses.set('req-1', 'second')
    mockResponses.set('req-2', 'third')

    const stub = batcher.createStub(['Test', 'test_1'])

    const [a, b, c] = await Promise.all([stub.a, stub.b, stub.c])

    expect(calls).toHaveLength(1)
    expect(a).toBe('first')
    expect(b).toBe('second')
    expect(c).toBe('third')
  })

  it('deeply nested Promise.all batches correctly', async () => {
    const { transport, calls, mockResponses } = createMockTransport()
    const batcher = createPipelineBatcher({ transport })

    mockResponses.set('req-0', 'dark')
    mockResponses.set('req-1', true)
    mockResponses.set('req-2', 'avatar.png')

    const user = batcher.createStub(['User', 'user_123'])

    const [theme, notifications, avatar] = await Promise.all([
      user.profile.settings.theme,
      user.profile.settings.notifications,
      user.profile.avatar,
    ])

    expect(calls).toHaveLength(1)
    expect(calls[0]).toHaveLength(3)
    expect(theme).toBe('dark')
    expect(notifications).toBe(true)
    expect(avatar).toBe('avatar.png')
  })
})

// ============================================================================
// 5. SEQUENTIAL AWAITS WORK CORRECTLY
// ============================================================================

describe('Sequential Awaits Work Correctly', () => {
  it('sequential awaits create separate batch calls', async () => {
    const { transport, calls, mockResponses } = createMockTransport()
    const batcher = createPipelineBatcher({ transport })

    mockResponses.set('req-0', 'alice@example.com')
    mockResponses.set('req-1', { bio: 'Engineer' })

    const user = batcher.createStub(['User', 'user_123'])

    // First await
    const email = await user.email
    expect(calls).toHaveLength(1)
    expect(email).toBe('alice@example.com')

    // Second await - new batch
    const profile = await user.profile
    expect(calls).toHaveLength(2)
    expect(profile).toEqual({ bio: 'Engineer' })
  })

  it('sequential awaits from same stub work independently', async () => {
    const { transport, calls, mockResponses } = createMockTransport()
    const batcher = createPipelineBatcher({ transport })

    mockResponses.set('req-0', 'Alice')
    mockResponses.set('req-1', 25)
    mockResponses.set('req-2', 'active')

    const user = batcher.createStub(['User', 'user_123'])

    const name = await user.name
    const age = await user.age
    const status = await user.status

    // Three separate batches
    expect(calls).toHaveLength(3)
    expect(name).toBe('Alice')
    expect(age).toBe(25)
    expect(status).toBe('active')
  })

  it('mixing sequential and parallel awaits', async () => {
    const { transport, calls, mockResponses } = createMockTransport()
    const batcher = createPipelineBatcher({ transport })

    mockResponses.set('req-0', 'first')
    mockResponses.set('req-1', 'second')
    mockResponses.set('req-2', 'third')
    mockResponses.set('req-3', 'fourth')

    const stub = batcher.createStub(['Test', 'test_1'])

    // Sequential await
    const first = await stub.first
    expect(calls).toHaveLength(1)

    // Parallel await
    const [second, third] = await Promise.all([stub.second, stub.third])
    expect(calls).toHaveLength(2)

    // Another sequential
    const fourth = await stub.fourth
    expect(calls).toHaveLength(3)

    expect(first).toBe('first')
    expect(second).toBe('second')
    expect(third).toBe('third')
    expect(fourth).toBe('fourth')
  })
})

// ============================================================================
// 6. BATCH IS CLEARED AFTER FLUSH
// ============================================================================

describe('Batch Cleared After Flush', () => {
  it('batch is empty after flush', async () => {
    const { transport, mockResponses } = createMockTransport()
    const batcher = createPipelineBatcher({ transport })

    mockResponses.set('req-0', 'result')

    const stub = batcher.createStub(['Test', 'test_1'])
    const _p = stub.value

    expect(batcher.pendingCount).toBe(1)

    await _p

    expect(batcher.pendingCount).toBe(0)
  })

  it('new operations after flush start a new batch', async () => {
    const { transport, calls, mockResponses } = createMockTransport()
    const batcher = createPipelineBatcher({ transport })

    mockResponses.set('req-0', 'batch1')
    mockResponses.set('req-1', 'batch2')

    const stub = batcher.createStub(['Test', 'test_1'])

    // First batch
    await stub.first

    expect(calls).toHaveLength(1)
    expect(calls[0]).toHaveLength(1)

    // Second batch (new operations)
    await stub.second

    expect(calls).toHaveLength(2)
    expect(calls[1]).toHaveLength(1)
  })

  it('concurrent batches do not interfere', async () => {
    const { transport, calls, mockResponses } = createMockTransport()
    const batcher = createPipelineBatcher({ transport })

    mockResponses.set('req-0', 'a')
    mockResponses.set('req-1', 'b')
    mockResponses.set('req-2', 'c')
    mockResponses.set('req-3', 'd')

    const stub = batcher.createStub(['Test', 'test_1'])

    // Start first batch
    const p1 = Promise.all([stub.a, stub.b])

    // Start second batch (after first is scheduled but not resolved)
    await flushMicrotasks()
    const p2 = Promise.all([stub.c, stub.d])

    await p1
    await p2

    // Should have 2 separate batch calls
    expect(calls).toHaveLength(2)
  })
})

// ============================================================================
// 7. ERROR IN ONE PIPELINE DOESN'T AFFECT OTHERS
// ============================================================================

describe('Error Isolation Between Pipelines', () => {
  it('error in one pipeline does not affect sibling pipelines', async () => {
    const { transport, calls, mockResponses } = createMockTransport()
    const batcher = createPipelineBatcher({ transport })

    mockResponses.set('req-0', 'success-value')
    mockResponses.set('req-1', new Error('Pipeline failed'))
    mockResponses.set('req-2', 'another-success')

    const stub = batcher.createStub(['Test', 'test_1'])

    const results = await Promise.allSettled([
      stub.success,
      stub.failure,
      stub.anotherSuccess,
    ])

    // All went through in same batch
    expect(calls).toHaveLength(1)
    expect(calls[0]).toHaveLength(3)

    // Check individual results
    expect(results[0]).toEqual({ status: 'fulfilled', value: 'success-value' })
    expect(results[1]).toEqual({
      status: 'rejected',
      reason: expect.objectContaining({ message: 'Pipeline failed' }),
    })
    expect(results[2]).toEqual({ status: 'fulfilled', value: 'another-success' })
  })

  it('transport error rejects all pipelines in batch', async () => {
    const transportError = new Error('Network failure')
    const batcher = createPipelineBatcher({
      transport: async () => {
        throw transportError
      },
    })

    const stub = batcher.createStub(['Test', 'test_1'])

    const results = await Promise.allSettled([stub.a, stub.b, stub.c])

    // All should be rejected
    expect(results[0]).toEqual({ status: 'rejected', reason: transportError })
    expect(results[1]).toEqual({ status: 'rejected', reason: transportError })
    expect(results[2]).toEqual({ status: 'rejected', reason: transportError })
  })

  it('partial transport error only affects failing requests', async () => {
    const batcher = createPipelineBatcher({
      transport: async (batch) => {
        return batch.map((req, index) => {
          if (req.id === 'req-1') {
            return { id: req.id, index, error: 'Specific failure' }
          }
          return { id: req.id, index, result: `result-${index}` }
        })
      },
    })

    const stub = batcher.createStub(['Test', 'test_1'])

    const results = await Promise.allSettled([stub.a, stub.b, stub.c])

    expect(results[0]).toEqual({ status: 'fulfilled', value: 'result-0' })
    expect(results[1]).toEqual({
      status: 'rejected',
      reason: expect.objectContaining({ message: 'Specific failure' }),
    })
    expect(results[2]).toEqual({ status: 'fulfilled', value: 'result-2' })
  })

  it('rejected promise does not prevent subsequent batches', async () => {
    const { transport, calls, mockResponses } = createMockTransport()
    const batcher = createPipelineBatcher({ transport })

    mockResponses.set('req-0', new Error('First batch error'))
    mockResponses.set('req-1', 'success')

    const stub = batcher.createStub(['Test', 'test_1'])

    // First batch - will fail
    await expect(stub.failing).rejects.toThrow('First batch error')
    expect(calls).toHaveLength(1)

    // Second batch - should still work
    const success = await stub.succeeding
    expect(calls).toHaveLength(2)
    expect(success).toBe('success')
  })
})

// ============================================================================
// 8. MICROTASK TIMING - BATCH FLUSHES AT END OF MICROTASK QUEUE
// ============================================================================

describe('Microtask Queue Timing', () => {
  it('batch flush is scheduled via queueMicrotask', async () => {
    const { transport, calls, mockResponses } = createMockTransport()
    const batcher = createPipelineBatcher({ transport })

    mockResponses.set('req-0', 'a')
    mockResponses.set('req-1', 'b')

    const stub = batcher.createStub(['Test', 'test_1'])

    // Create pipelines
    const p1 = stub.a
    const p2 = stub.b

    // Not flushed yet (sync)
    expect(calls).toHaveLength(0)

    // Flush microtasks
    await flushMicrotasks()

    // Still not flushed until await
    expect(batcher.pendingCount).toBe(2)

    // Actually await
    const [a, b] = await Promise.all([p1, p2])

    expect(calls).toHaveLength(1)
    expect(a).toBe('a')
    expect(b).toBe('b')
  })

  it('operations added synchronously are batched together', async () => {
    const { transport, calls, mockResponses } = createMockTransport()
    const batcher = createPipelineBatcher({ transport })

    mockResponses.set('req-0', '1')
    mockResponses.set('req-1', '2')
    mockResponses.set('req-2', '3')
    mockResponses.set('req-3', '4')
    mockResponses.set('req-4', '5')

    const stub = batcher.createStub(['Test', 'test_1'])

    // All synchronous
    const promises = [stub.a, stub.b, stub.c, stub.d, stub.e]

    expect(calls).toHaveLength(0)

    const results = await Promise.all(promises)

    // All in one batch
    expect(calls).toHaveLength(1)
    expect(calls[0]).toHaveLength(5)
    expect(results).toEqual(['1', '2', '3', '4', '5'])
  })

  it('operations separated by await create separate batches', async () => {
    const { transport, calls, mockResponses } = createMockTransport()
    const batcher = createPipelineBatcher({ transport })

    mockResponses.set('req-0', 'first')
    mockResponses.set('req-1', 'second')

    const stub = batcher.createStub(['Test', 'test_1'])

    // First operation
    const first = await stub.first
    expect(calls).toHaveLength(1)

    // After await, new microtask queue
    const second = await stub.second
    expect(calls).toHaveLength(2)

    expect(first).toBe('first')
    expect(second).toBe('second')
  })

  it('setTimeout creates separate batch from sync operations', async () => {
    const { transport, calls, mockResponses } = createMockTransport()
    const batcher = createPipelineBatcher({ transport })

    mockResponses.set('req-0', 'sync1')
    mockResponses.set('req-1', 'sync2')
    mockResponses.set('req-2', 'timeout')

    const stub = batcher.createStub(['Test', 'test_1'])

    // Sync operations
    const p1 = stub.sync1
    const p2 = stub.sync2

    // Schedule timeout operation
    const p3Promise = new Promise((resolve) => {
      setTimeout(async () => {
        const result = await stub.timeout
        resolve(result)
      }, 10)
    })

    // Sync batch
    const [r1, r2] = await Promise.all([p1, p2])
    expect(calls).toHaveLength(1)
    expect(calls[0]).toHaveLength(2)

    // Timeout batch (separate)
    const r3 = await p3Promise
    expect(calls).toHaveLength(2)
    expect(calls[1]).toHaveLength(1)

    expect(r1).toBe('sync1')
    expect(r2).toBe('sync2')
    expect(r3).toBe('timeout')
  })
})

// ============================================================================
// 9. CONFIGURABLE BATCH SIZE LIMIT
// ============================================================================

describe('Configurable Batch Size Limit', () => {
  it('respects maxBatchSize configuration', async () => {
    const { transport, calls, mockResponses } = createMockTransport()
    const batcher = createPipelineBatcher({
      transport,
      maxBatchSize: 3,
    })

    // Set up responses for 5 requests
    for (let i = 0; i < 5; i++) {
      mockResponses.set(`req-${i}`, `result-${i}`)
    }

    const stub = batcher.createStub(['Test', 'test_1'])

    // Create 5 operations
    const results = await Promise.all([
      stub.a,
      stub.b,
      stub.c,
      stub.d,
      stub.e,
    ])

    // Should create 2 batches (3 + 2)
    expect(calls).toHaveLength(2)
    expect(calls[0]).toHaveLength(3)
    expect(calls[1]).toHaveLength(2)
    expect(results).toEqual(['result-0', 'result-1', 'result-2', 'result-3', 'result-4'])
  })

  it('batch size of 1 sends each request individually', async () => {
    const { transport, calls, mockResponses } = createMockTransport()
    const batcher = createPipelineBatcher({
      transport,
      maxBatchSize: 1,
    })

    mockResponses.set('req-0', 'a')
    mockResponses.set('req-1', 'b')
    mockResponses.set('req-2', 'c')

    const stub = batcher.createStub(['Test', 'test_1'])

    const results = await Promise.all([stub.a, stub.b, stub.c])

    // Each request in its own batch
    expect(calls).toHaveLength(3)
    expect(results).toEqual(['a', 'b', 'c'])
  })

  it('large batch size allows all requests in one batch', async () => {
    const { transport, calls, mockResponses } = createMockTransport()
    const batcher = createPipelineBatcher({
      transport,
      maxBatchSize: 1000,
    })

    // Many requests
    for (let i = 0; i < 100; i++) {
      mockResponses.set(`req-${i}`, i)
    }

    const stub = batcher.createStub(['Test', 'test_1'])

    const promises: Promise<unknown>[] = []
    for (let i = 0; i < 100; i++) {
      promises.push(stub[`prop${i}`])
    }

    const results = await Promise.all(promises)

    // All in one batch
    expect(calls).toHaveLength(1)
    expect(calls[0]).toHaveLength(100)
    expect(results).toHaveLength(100)
  })

  it('default batch size is unlimited (Infinity)', async () => {
    const { transport, calls, mockResponses } = createMockTransport()
    const batcher = createPipelineBatcher({ transport })

    // Check default config
    expect(batcher.config.maxBatchSize).toBe(Infinity)

    for (let i = 0; i < 50; i++) {
      mockResponses.set(`req-${i}`, i)
    }

    const stub = batcher.createStub(['Test', 'test_1'])

    const promises: Promise<unknown>[] = []
    for (let i = 0; i < 50; i++) {
      promises.push(stub[`prop${i}`])
    }

    await Promise.all(promises)

    // All in one batch
    expect(calls).toHaveLength(1)
    expect(calls[0]).toHaveLength(50)
  })
})

// ============================================================================
// 10. CONFIGURABLE FLUSH INTERVAL
// ============================================================================

describe('Configurable Flush Interval', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('respects flushInterval configuration', async () => {
    const { transport, calls, mockResponses } = createMockTransport()
    const batcher = createPipelineBatcher({
      transport,
      flushInterval: 100, // 100ms
    })

    mockResponses.set('req-0', 'result')

    const stub = batcher.createStub(['Test', 'test_1'])
    const _p = stub.value

    // Not flushed yet
    expect(calls).toHaveLength(0)

    // Advance time past flush interval
    await vi.advanceTimersByTimeAsync(100)

    // Should have flushed due to interval
    expect(calls).toHaveLength(1)
  })

  it('flush interval accumulates requests until timer fires', async () => {
    const { transport, calls, mockResponses } = createMockTransport()
    const batcher = createPipelineBatcher({
      transport,
      flushInterval: 50,
    })

    for (let i = 0; i < 5; i++) {
      mockResponses.set(`req-${i}`, i)
    }

    const stub = batcher.createStub(['Test', 'test_1'])

    // Add requests over time
    const _p1 = stub.a
    await vi.advanceTimersByTimeAsync(10)

    const _p2 = stub.b
    await vi.advanceTimersByTimeAsync(10)

    const _p3 = stub.c
    await vi.advanceTimersByTimeAsync(10)

    // Not yet flushed (30ms elapsed)
    expect(calls).toHaveLength(0)

    // Wait for flush
    await vi.advanceTimersByTimeAsync(50)

    // All accumulated in one batch
    expect(calls).toHaveLength(1)
    expect(calls[0]).toHaveLength(3)
  })

  it('await triggers immediate flush regardless of interval', async () => {
    const { transport, calls, mockResponses } = createMockTransport()
    const batcher = createPipelineBatcher({
      transport,
      flushInterval: 10000, // Very long interval
    })

    mockResponses.set('req-0', 'immediate')

    const stub = batcher.createStub(['Test', 'test_1'])
    const p = stub.value

    expect(calls).toHaveLength(0)

    // Await triggers immediate flush
    vi.useRealTimers() // Need real timers for await
    const result = await p

    expect(calls).toHaveLength(1)
    expect(result).toBe('immediate')
  })

  it('flush interval of 0 means immediate microtask flush', async () => {
    const { transport, calls, mockResponses } = createMockTransport()
    const batcher = createPipelineBatcher({
      transport,
      flushInterval: 0,
    })

    mockResponses.set('req-0', 'immediate')
    mockResponses.set('req-1', 'also-immediate')

    const stub = batcher.createStub(['Test', 'test_1'])

    // Even with 0 interval, sync operations batch together
    const results = await Promise.all([stub.a, stub.b])

    expect(calls).toHaveLength(1)
    expect(calls[0]).toHaveLength(2)
    expect(results).toEqual(['immediate', 'also-immediate'])
  })

  it('default flush interval is 0 (microtask timing)', () => {
    const { transport } = createMockTransport()
    const batcher = createPipelineBatcher({ transport })

    expect(batcher.config.flushInterval).toBe(0)
  })

  it('cancels pending flush timer when manually flushed', async () => {
    const { transport, calls, mockResponses } = createMockTransport()
    const batcher = createPipelineBatcher({
      transport,
      flushInterval: 100,
    })

    mockResponses.set('req-0', 'result')

    const stub = batcher.createStub(['Test', 'test_1'])
    const p = stub.value

    // Manual flush
    vi.useRealTimers()
    await batcher.flush()

    expect(calls).toHaveLength(1)

    // Timer should be cancelled, no duplicate flush
    vi.useFakeTimers()
    await vi.advanceTimersByTimeAsync(200)

    // Still just 1 call
    expect(calls).toHaveLength(1)
  })
})

// ============================================================================
// ADDITIONAL EDGE CASES AND INTEGRATION TESTS
// ============================================================================

describe('Edge Cases', () => {
  it('empty batch does nothing', async () => {
    const { transport, calls } = createMockTransport()
    const batcher = createPipelineBatcher({ transport })

    // Manual flush with nothing pending
    await batcher.flush()

    expect(calls).toHaveLength(0)
  })

  it('handles very deep pipelines', async () => {
    const { transport, calls, mockResponses } = createMockTransport()
    const batcher = createPipelineBatcher({ transport })

    mockResponses.set('req-0', 'deep-value')

    const stub = batcher.createStub(['Test', 'test_1'])

    // Very deep chain
    let chain = stub
    for (let i = 0; i < 50; i++) {
      chain = chain[`level${i}`]
    }

    const result = await chain

    expect(calls).toHaveLength(1)
    expect(calls[0][0].pipeline).toHaveLength(50)
    expect(result).toBe('deep-value')
  })

  it('handles mixed method and property chains', async () => {
    const { transport, calls, mockResponses } = createMockTransport()
    const batcher = createPipelineBatcher({ transport })

    mockResponses.set('req-0', 'final')

    const stub = batcher.createStub(['User', 'user_123'])

    const result = await stub.getProfile().settings.get('theme')

    expect(calls).toHaveLength(1)
    const pipeline = calls[0][0].pipeline
    expect(pipeline[0]).toEqual({ type: 'method', name: 'getProfile', args: [] })
    expect(pipeline[1]).toEqual({ type: 'property', name: 'settings' })
    expect(pipeline[2]).toEqual({ type: 'method', name: 'get', args: ['theme'] })
    expect(result).toBe('final')
  })

  it('batch request includes target and pipeline information', async () => {
    const { transport, calls, mockResponses } = createMockTransport()
    const batcher = createPipelineBatcher({ transport })

    mockResponses.set('req-0', 'result')

    const stub = batcher.createStub(['Customer', 'cust_456'])
    await stub.profile.email

    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toMatchObject({
      target: ['Customer', 'cust_456'],
      pipeline: [
        { type: 'property', name: 'profile' },
        { type: 'property', name: 'email' },
      ],
    })
  })

  it('supports custom request ID generation', async () => {
    const { transport, calls, mockResponses } = createMockTransport()
    let idCounter = 0
    const batcher = createPipelineBatcher({
      transport,
      generateId: () => `custom-${idCounter++}`,
    })

    mockResponses.set('custom-0', 'a')
    mockResponses.set('custom-1', 'b')

    const stub = batcher.createStub(['Test', 'test_1'])
    await Promise.all([stub.a, stub.b])

    expect(calls[0][0].id).toBe('custom-0')
    expect(calls[0][1].id).toBe('custom-1')
  })
})

describe('Integration with PipelinedStub', () => {
  it('createStub returns a PipelinedStub-compatible object', () => {
    const { transport } = createMockTransport()
    const batcher = createPipelineBatcher({ transport })

    const stub = batcher.createStub(['User', 'user_123'])

    // Should have pipeline symbol access
    expect(stub[Symbol.for('target')]).toEqual(['User', 'user_123'])
  })

  it('pipeline operations are correctly serialized in batch request', async () => {
    const { transport, calls, mockResponses } = createMockTransport()
    const batcher = createPipelineBatcher({ transport })

    mockResponses.set('req-0', { type: 'email', value: 'alice@example.com' })

    const user = batcher.createStub(['User', 'user_123'])
    await user.notify({ type: 'email', value: 'Hello!' })

    expect(calls).toHaveLength(1)
    expect(calls[0][0].pipeline).toEqual([
      { type: 'method', name: 'notify', args: [{ type: 'email', value: 'Hello!' }] },
    ])
  })
})
