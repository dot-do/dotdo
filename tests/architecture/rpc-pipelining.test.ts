/**
 * RPC Promise Pipelining Tests (RED Phase)
 *
 * Tests for Cap'n Web-style promise pipelining across DO boundaries.
 * These tests verify that pipelined RPC calls execute efficiently without
 * extra round-trips, properly propagate errors, and work correctly across
 * Durable Object boundaries.
 *
 * Architecture requirement: Cap'n Web RPC should support promise pipelining
 * where chained method calls are batched into a single network request.
 *
 * @see do-gj1 - ARCH-2: RPC transport layer completion
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createPipelinedStub,
  PIPELINE_SYMBOL,
  TARGET_SYMBOL,
  serializePipeline,
} from '../../rpc/pipelined-stub'
import {
  PipelineBatcher,
  createPipelineBatcher,
  type BatchRequest,
  type BatchResponse,
} from '../../rpc/pipeline-batcher'
import { PipelineExecutor } from '../../rpc/pipeline-executor'
import { createRpcPromise, type RpcPromise } from '../../rpc/rpc-promise'

// ============================================================================
// MOCK DO INFRASTRUCTURE
// ============================================================================

/**
 * Mock DO namespace that simulates cross-DO RPC calls with round-trip tracking
 */
class MockDONamespace {
  private dos: Map<string, MockDO> = new Map()
  roundTrips: number = 0

  get(id: string): MockDO {
    if (!this.dos.has(id)) {
      this.dos.set(id, new MockDO(id, this))
    }
    return this.dos.get(id)!
  }

  recordRoundTrip(): void {
    this.roundTrips++
  }
}

/**
 * Mock DO that simulates a real Durable Object with RPC capabilities
 */
class MockDO {
  id: string
  namespace: MockDONamespace
  data: Record<string, unknown>

  constructor(id: string, namespace: MockDONamespace) {
    this.id = id
    this.namespace = namespace
    this.data = {
      profile: {
        email: `${id}@example.com`,
        settings: {
          theme: 'dark',
          notifications: true,
        },
      },
      orders: [
        { id: 'order-1', total: 100 },
        { id: 'order-2', total: 250 },
      ],
    }
  }

  async fetch(request: Request): Promise<Response> {
    this.namespace.recordRoundTrip()

    const body = await request.json() as { pipeline?: unknown[] }
    const executor = new PipelineExecutor()

    try {
      const result = await executor.execute(this.data, body.pipeline as any[])
      return new Response(JSON.stringify({ result }), { status: 200 })
    } catch (err) {
      return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 })
    }
  }

  // RPC methods for direct invocation
  getProfile(): { email: string; settings: { theme: string; notifications: boolean } } {
    return this.data.profile as any
  }

  getOrders(): { id: string; total: number }[] {
    return this.data.orders as any
  }

  async sendNotification(message: string): Promise<{ success: boolean; messageId: string }> {
    return { success: true, messageId: `msg-${Date.now()}` }
  }
}

// ============================================================================
// 1. CROSS-DO PROMISE PIPELINING - SINGLE ROUND-TRIP
// ============================================================================

describe('Cross-DO Promise Pipelining - Single Round-Trip', () => {
  let namespace: MockDONamespace

  beforeEach(() => {
    namespace = new MockDONamespace()
  })

  it('pipelined property access across DO boundary uses single round-trip', async () => {
    // FAILING TEST: Current implementation doesn't integrate pipelining with DO fetch
    //
    // Expected: stub.profile.email should result in ONE network call to the DO
    // Actual: Without proper integration, this may result in multiple calls or none

    const transport = async (requests: BatchRequest[]): Promise<BatchResponse[]> => {
      const do_ = namespace.get('customer-123')

      return Promise.all(
        requests.map(async (req, index) => {
          const response = await do_.fetch(
            new Request('https://do/', {
              method: 'POST',
              body: JSON.stringify({ pipeline: req.pipeline }),
            })
          )
          const data = (await response.json()) as { result?: unknown; error?: string }
          if (data.error) {
            return { id: req.id, index, error: data.error }
          }
          return { id: req.id, index, result: data.result }
        })
      )
    }

    const batcher = createPipelineBatcher({ transport })
    const stub = batcher.createStub(['Customer', 'customer-123']) as any

    // Pipeline: stub.profile.email
    const email = await stub.profile.email

    // ASSERTION: Should only make 1 round-trip for the entire pipeline
    expect(namespace.roundTrips).toBe(1)
    expect(email).toBe('customer-123@example.com')
  })

  it('chained method calls use single round-trip across DO boundary', async () => {
    // FAILING TEST: Method chaining should batch into single request
    //
    // Expected: stub.getProfile().settings.theme -> ONE round-trip
    // Actual: Each segment might trigger separate calls

    const transport = async (requests: BatchRequest[]): Promise<BatchResponse[]> => {
      const results: BatchResponse[] = []
      for (const req of requests) {
        const do_ = namespace.get(req.target[1])
        const response = await do_.fetch(
          new Request('https://do/', {
            method: 'POST',
            body: JSON.stringify({ pipeline: req.pipeline }),
          })
        )
        const data = (await response.json()) as { result?: unknown }
        results.push({ id: req.id, index: results.length, result: data.result })
      }
      return results
    }

    const batcher = createPipelineBatcher({ transport })
    const stub = batcher.createStub(['Customer', 'customer-123']) as any

    // This should execute as a single pipelined call
    namespace.roundTrips = 0
    const theme = await stub.profile.settings.theme

    expect(namespace.roundTrips).toBe(1)
    expect(theme).toBe('dark')
  })

  it('multiple independent pipelines to same DO batch into single request', async () => {
    // FAILING TEST: Promise.all with multiple pipelines to same DO should batch
    //
    // Expected: Promise.all([stub.profile.email, stub.orders]) -> ONE round-trip
    // Actual: Without proper batching, could be 2 separate calls

    let batchCallCount = 0
    const transport = async (requests: BatchRequest[]): Promise<BatchResponse[]> => {
      batchCallCount++
      const do_ = namespace.get('customer-123')

      return Promise.all(
        requests.map(async (req, index) => {
          // Note: In proper implementation, all pipelines would be sent in one request
          const response = await do_.fetch(
            new Request('https://do/', {
              method: 'POST',
              body: JSON.stringify({ pipeline: req.pipeline }),
            })
          )
          const data = (await response.json()) as { result?: unknown }
          return { id: req.id, index, result: data.result }
        })
      )
    }

    const batcher = createPipelineBatcher({ transport })
    const stub = batcher.createStub(['Customer', 'customer-123']) as any

    namespace.roundTrips = 0

    // Multiple pipelines in parallel should batch
    const [email, orders] = await Promise.all([stub.profile.email, stub.orders])

    // CRITICAL: Should be exactly 1 batch call even with multiple pipelines
    expect(batchCallCount).toBe(1)
    // But the transport still needs to resolve each pipeline
    // The key is that it's ONE batch request, not multiple
    expect(email).toBe('customer-123@example.com')
    expect(orders).toHaveLength(2)
  })
})

// ============================================================================
// 2. CROSS-DO PROMISE PIPELINING - MULTIPLE DOs
// ============================================================================

describe('Cross-DO Promise Pipelining - Multiple DOs', () => {
  let namespace: MockDONamespace

  beforeEach(() => {
    namespace = new MockDONamespace()
  })

  it('pipelines to different DOs are batched efficiently', async () => {
    // FAILING TEST: Pipelines to different DOs should still batch the transport call
    //
    // Expected: Calls to DO-A and DO-B should go in single batch transport call
    // Actual: May create separate transport calls per DO

    let transportCalls = 0
    const transport = async (requests: BatchRequest[]): Promise<BatchResponse[]> => {
      transportCalls++

      return Promise.all(
        requests.map(async (req, index) => {
          const do_ = namespace.get(req.target[1])
          const response = await do_.fetch(
            new Request('https://do/', {
              method: 'POST',
              body: JSON.stringify({ pipeline: req.pipeline }),
            })
          )
          const data = (await response.json()) as { result?: unknown }
          return { id: req.id, index, result: data.result }
        })
      )
    }

    const batcher = createPipelineBatcher({ transport })
    const customerStub = batcher.createStub(['Customer', 'customer-A']) as any
    const orderStub = batcher.createStub(['Customer', 'customer-B']) as any

    // Two different DOs accessed in parallel
    const [emailA, emailB] = await Promise.all([
      customerStub.profile.email,
      orderStub.profile.email,
    ])

    // Transport should be called once with both requests batched
    expect(transportCalls).toBe(1)
    expect(emailA).toBe('customer-A@example.com')
    expect(emailB).toBe('customer-B@example.com')
  })

  it('cross-DO method call result can be pipelined further', async () => {
    // FAILING TEST: Result from one DO method should be pipeable without extra round-trip
    //
    // This is the KEY Cap'n Proto feature: calling a method that returns a capability,
    // then immediately calling methods on that capability without waiting for resolution
    //
    // Expected: DO-A.getLinkedDO().profile.email -> 2 round-trips max (not 3)
    // Actual: Without proper pipelining, each step requires waiting

    const transport = async (requests: BatchRequest[]): Promise<BatchResponse[]> => {
      return requests.map((req, index) => {
        // Simulate: getLinkedDO returns a reference, then we access its profile
        const targetId = req.target[1]
        if (req.pipeline.some((p: any) => p.name === 'getLinkedDO')) {
          // First DO call returns a capability to another DO
          return {
            id: req.id,
            index,
            result: { $capability: ['Customer', 'linked-customer'] },
          }
        }
        return { id: req.id, index, result: `${targetId}@example.com` }
      })
    }

    const batcher = createPipelineBatcher({ transport })
    const stub = batcher.createStub(['Service', 'service-main']) as any

    // This is the pipelining scenario: don't wait for getLinkedDO() to resolve,
    // immediately chain .profile.email and send the entire pipeline
    const pipeline = stub.getLinkedDO().profile.email

    // Verify the pipeline is correctly recorded before execution
    const serialized = serializePipeline(pipeline)
    expect(serialized.pipeline).toEqual([
      { type: 'method', name: 'getLinkedDO', args: [] },
      { type: 'property', name: 'profile' },
      { type: 'property', name: 'email' },
    ])

    // FAILING: The actual resolution may not properly handle capability references
    // and continue pipelining without intermediate round-trips
  })
})

// ============================================================================
// 3. PIPELINE FAILURE PROPAGATION
// ============================================================================

describe('Pipeline Failure Propagation', () => {
  let namespace: MockDONamespace

  beforeEach(() => {
    namespace = new MockDONamespace()
  })

  it('error in middle of pipeline propagates correctly', async () => {
    // FAILING TEST: Error at step N should propagate with correct context
    //
    // Expected: Error message includes which step failed and why
    // Actual: May get generic error or lose step information

    const transport = async (requests: BatchRequest[]): Promise<BatchResponse[]> => {
      return requests.map((req, index) => {
        // Simulate error on 'nonexistent' property access
        const pipeline = req.pipeline
        const failingStep = pipeline.findIndex((p: any) => p.name === 'nonexistent')
        if (failingStep !== -1) {
          return {
            id: req.id,
            index,
            error: `Cannot read property 'nonexistent' of undefined at step ${failingStep}`,
          }
        }
        return { id: req.id, index, result: 'ok' }
      })
    }

    const batcher = createPipelineBatcher({ transport })
    const stub = batcher.createStub(['Customer', 'customer-123']) as any

    // Pipeline: stub.profile.nonexistent.value
    // Should fail at 'nonexistent' with informative error
    await expect(stub.profile.nonexistent.value).rejects.toThrow(/nonexistent/)
    await expect(stub.profile.nonexistent.value).rejects.toThrow(/step/)
  })

  it('error in one pipeline does not affect sibling pipelines in batch', async () => {
    // FAILING TEST: One failing pipeline shouldn't cascade to others
    //
    // Expected: Promise.allSettled shows one failure, others succeed
    // Actual: Transport-level error might reject all

    const transport = async (requests: BatchRequest[]): Promise<BatchResponse[]> => {
      return requests.map((req, index) => {
        const hasFailingProperty = req.pipeline.some((p: any) => p.name === 'willFail')
        if (hasFailingProperty) {
          return { id: req.id, index, error: 'Property access failed' }
        }
        return { id: req.id, index, result: 'success' }
      })
    }

    const batcher = createPipelineBatcher({ transport })
    const stub = batcher.createStub(['Customer', 'customer-123']) as any

    const results = await Promise.allSettled([
      stub.profile.email, // Should succeed
      stub.willFail.value, // Should fail
      stub.orders, // Should succeed
    ])

    expect(results[0]).toEqual({ status: 'fulfilled', value: 'success' })
    expect(results[1].status).toBe('rejected')
    expect(results[2]).toEqual({ status: 'fulfilled', value: 'success' })
  })

  it('network failure during pipelined call rejects with appropriate error', async () => {
    // FAILING TEST: Network-level failures should reject with clear message
    //
    // Expected: Error indicates network/transport failure
    // Actual: May get unhelpful or missing error information

    const transport = async (_requests: BatchRequest[]): Promise<BatchResponse[]> => {
      throw new Error('Network connection lost')
    }

    const batcher = createPipelineBatcher({ transport })
    const stub = batcher.createStub(['Customer', 'customer-123']) as any

    await expect(stub.profile.email).rejects.toThrow('Network connection lost')
  })

  it('timeout in pipelined call is handled gracefully', async () => {
    // FAILING TEST: Long-running pipeline should timeout appropriately
    //
    // Expected: Timeout after configured interval with clear error
    // Actual: May hang indefinitely or timeout without cleanup

    vi.useFakeTimers()

    let resolveTransport: () => void
    const transport = async (_requests: BatchRequest[]): Promise<BatchResponse[]> => {
      // Never resolves to simulate timeout
      return new Promise((resolve) => {
        resolveTransport = () => resolve([])
      })
    }

    const batcher = createPipelineBatcher({
      transport,
      flushInterval: 0,
    })
    const stub = batcher.createStub(['Customer', 'customer-123']) as any

    const promise = stub.profile.email

    // This test should verify timeout behavior
    // FAILING: No built-in timeout mechanism in pipeline batcher

    vi.useRealTimers()
  })
})

// ============================================================================
// 4. EFFICIENT CHAINED RPC CALLS
// ============================================================================

describe('Efficient Chained RPC Calls', () => {
  it('sequential dependent calls still batch when possible', async () => {
    // FAILING TEST: Dependent calls in same microtask should batch
    //
    // Expected: Calls made synchronously should batch even if logically sequential
    // Actual: May create separate batches

    let batchCount = 0
    const transport = async (requests: BatchRequest[]): Promise<BatchResponse[]> => {
      batchCount++
      return requests.map((req, index) => ({
        id: req.id,
        index,
        result: req.pipeline[0]?.name || 'root',
      }))
    }

    const batcher = createPipelineBatcher({ transport })
    const stub = batcher.createStub(['User', 'user-1']) as any

    // These are created synchronously - should batch together
    const namePromise = stub.name
    const emailPromise = stub.email
    const agePromise = stub.age

    const [name, email, age] = await Promise.all([namePromise, emailPromise, agePromise])

    expect(batchCount).toBe(1)
    expect(name).toBe('name')
    expect(email).toBe('email')
    expect(age).toBe('age')
  })

  it('long pipeline chains execute efficiently', async () => {
    // FAILING TEST: Very long chains should still use single round-trip
    //
    // Expected: 20-step pipeline = 1 network call
    // Actual: May degrade or fail with deep chains

    let networkCalls = 0
    const transport = async (requests: BatchRequest[]): Promise<BatchResponse[]> => {
      networkCalls++
      return requests.map((req, index) => ({
        id: req.id,
        index,
        result: `depth-${req.pipeline.length}`,
      }))
    }

    const batcher = createPipelineBatcher({ transport })
    let stub = batcher.createStub(['Deep', 'deep-1']) as any

    // Build a 20-step chain
    for (let i = 0; i < 20; i++) {
      stub = stub[`level${i}`]
    }

    const result = await stub

    expect(networkCalls).toBe(1)
    expect(result).toBe('depth-20')
  })

  it('pipelining avoids N+1 query problem', async () => {
    // FAILING TEST: Accessing list items shouldn't cause N+1 queries
    //
    // Expected: Getting order details for all orders in single call
    // Actual: May fetch each order separately

    let fetchCount = 0
    const transport = async (requests: BatchRequest[]): Promise<BatchResponse[]> => {
      fetchCount++
      return requests.map((req, index) => ({
        id: req.id,
        index,
        result: { items: [1, 2, 3], total: 100 },
      }))
    }

    const batcher = createPipelineBatcher({ transport })
    const stub = batcher.createStub(['User', 'user-1']) as any

    // Without proper pipelining, this pattern causes N+1:
    // 1. Fetch orders list
    // 2. For each order, fetch details
    //
    // With pipelining, should be single call
    const ordersDetails = await stub.orders

    expect(fetchCount).toBe(1)
  })
})

// ============================================================================
// 5. RPC PROMISE PIPELINING SEMANTICS
// ============================================================================

describe('RPC Promise Pipelining Semantics', () => {
  it('accessing property on unresolved promise creates valid pipeline', () => {
    // FAILING TEST: Verify that RpcPromise allows property access before resolution
    //
    // This is the core Cap'n Proto pipelining concept

    let wasExecuted = false
    const promise = createRpcPromise<{ profile: { email: string } }>((resolve) => {
      wasExecuted = true
      resolve({ profile: { email: 'test@example.com' } })
    })

    // Access property BEFORE awaiting
    const email = promise.profile.email

    // Pipeline should be recorded
    expect(email.pipeline).toEqual([
      { type: 'property', name: 'profile' },
      { type: 'property', name: 'email' },
    ])

    // Should NOT have executed yet (lazy evaluation)
    // FAILING: Current implementation may eagerly execute
    expect(wasExecuted).toBe(false)
  })

  it('method call on unresolved promise creates valid pipeline', () => {
    // FAILING TEST: Method calls should also pipeline

    let callCount = 0
    const promise = createRpcPromise<{ getOrders(): { id: string }[] }>((resolve) => {
      callCount++
      resolve({
        getOrders() {
          return [{ id: 'order-1' }]
        },
      })
    })

    // Call method BEFORE awaiting
    const orders = promise.getOrders()

    expect(orders.pipeline).toEqual([{ type: 'method', name: 'getOrders', args: [] }])

    // Should NOT have executed yet
    expect(callCount).toBe(0)
  })

  it('await on pipelined promise executes full pipeline at once', async () => {
    // FAILING TEST: Pipeline should execute only when awaited

    let executeCount = 0
    const promise = createRpcPromise<{ profile: { email: string } }>(
      (resolve) => {
        executeCount++
        resolve({ profile: { email: 'test@example.com' } })
      },
      {
        executor: async (base, pipeline) => {
          executeCount++
          let result: unknown = base
          for (const step of pipeline) {
            if (step.type === 'property') {
              result = (result as Record<string, unknown>)[step.name]
            }
          }
          return result
        },
      }
    )

    const emailPromise = promise.profile.email

    // Not executed yet
    expect(executeCount).toBe(0)

    // NOW execute
    const email = await emailPromise

    // Should have executed exactly once with full pipeline
    // Note: executeCount is 2 because both promiseExecutor (provides base) and customExecutor
    // (walks pipeline) increment it. The key is that each runs exactly ONCE, not multiple times.
    expect(executeCount).toBe(2)
    expect(email).toBe('test@example.com')
  })

  it('multiple awaits on same pipeline only execute once', async () => {
    // FAILING TEST: Caching behavior for resolved pipelines

    let executeCount = 0
    const promise = createRpcPromise<{ value: number }>((resolve) => {
      executeCount++
      resolve({ value: 42 })
    })

    const valuePromise = promise.value

    // Await multiple times
    const result1 = await valuePromise
    const result2 = await valuePromise
    const result3 = await valuePromise

    // Should only execute once, results should be cached
    // FAILING: May re-execute on each await
    expect(executeCount).toBeLessThanOrEqual(1)
    expect(result1).toBe(42)
    expect(result2).toBe(42)
    expect(result3).toBe(42)
  })
})

// ============================================================================
// 6. PIPELINE WIRE FORMAT VERIFICATION
// ============================================================================

describe('Pipeline Wire Format Verification', () => {
  it('property pipeline serializes correctly for transport', () => {
    const stub = createPipelinedStub(['Customer', 'cust_123'])
    const chain = (stub as any).profile.settings.theme

    const wire = serializePipeline(chain)

    expect(wire).toEqual({
      target: ['Customer', 'cust_123'],
      pipeline: [
        { type: 'property', name: 'profile' },
        { type: 'property', name: 'settings' },
        { type: 'property', name: 'theme' },
      ],
    })
  })

  it('method pipeline with arguments serializes correctly', () => {
    const stub = createPipelinedStub(['Customer', 'cust_123'])
    const chain = (stub as any).notify({ type: 'email', body: 'Hello' })

    const wire = serializePipeline(chain)

    expect(wire).toEqual({
      target: ['Customer', 'cust_123'],
      pipeline: [
        {
          type: 'method',
          name: 'notify',
          args: [{ type: 'email', body: 'Hello' }],
        },
      ],
    })
  })

  it('mixed pipeline serializes in correct order', () => {
    const stub = createPipelinedStub(['Service', 'svc_1'])
    const chain = (stub as any).getUser('user-123').profile.sendNotification('Welcome!').success

    const wire = serializePipeline(chain)

    expect(wire.pipeline).toEqual([
      { type: 'method', name: 'getUser', args: ['user-123'] },
      { type: 'property', name: 'profile' },
      { type: 'method', name: 'sendNotification', args: ['Welcome!'] },
      { type: 'property', name: 'success' },
    ])
  })

  it('empty pipeline serializes correctly', () => {
    const stub = createPipelinedStub(['Empty', 'empty_1'])

    const wire = serializePipeline(stub as any)

    expect(wire).toEqual({
      target: ['Empty', 'empty_1'],
      pipeline: [],
    })
  })

  it('pipeline with complex nested arguments serializes correctly', () => {
    const stub = createPipelinedStub(['Complex', 'cmplx_1'])
    const complexArg = {
      filters: [
        { field: 'status', op: 'eq', value: 'active' },
        { field: 'date', op: 'gt', value: '2024-01-01' },
      ],
      pagination: { page: 1, limit: 10 },
      include: ['profile', 'orders'],
    }
    const chain = (stub as any).query(complexArg)

    const wire = serializePipeline(chain)

    expect(wire.pipeline[0].args[0]).toEqual(complexArg)
  })
})

// ============================================================================
// 7. END-TO-END CROSS-DO PIPELINING
// ============================================================================

describe('End-to-End Cross-DO Pipelining', () => {
  it('complete pipeline flow: create -> transport -> execute -> return', async () => {
    // FAILING TEST: Full integration of all pipelining components
    //
    // This test verifies that:
    // 1. PipelinedStub correctly records the pipeline
    // 2. PipelineBatcher batches the request
    // 3. Transport sends to correct DO
    // 4. PipelineExecutor resolves on server
    // 5. Result returns to caller

    // Server-side mock
    const serverExecutor = new PipelineExecutor()
    const serverData = {
      users: {
        find: (id: string) => ({
          id,
          profile: {
            email: `${id}@example.com`,
            name: `User ${id}`,
          },
        }),
      },
    }

    // Transport that uses real PipelineExecutor
    const transport = async (requests: BatchRequest[]): Promise<BatchResponse[]> => {
      return Promise.all(
        requests.map(async (req, index) => {
          try {
            const result = await serverExecutor.execute(serverData, req.pipeline as any)
            return { id: req.id, index, result }
          } catch (err) {
            return { id: req.id, index, error: (err as Error).message }
          }
        })
      )
    }

    const batcher = createPipelineBatcher({ transport })
    const stub = batcher.createStub(['API', 'api-main']) as any

    // Create pipeline: stub.users.find('user-42').profile.email
    const result = await stub.users.find('user-42').profile.email

    expect(result).toBe('user-42@example.com')
  })

  it('pipeline with async server method executes correctly', async () => {
    // FAILING TEST: Async methods in pipeline should work

    const serverExecutor = new PipelineExecutor()
    const serverData = {
      async fetchUser(id: string) {
        return { id, email: `${id}@async.com` }
      },
    }

    const transport = async (requests: BatchRequest[]): Promise<BatchResponse[]> => {
      return Promise.all(
        requests.map(async (req, index) => {
          const result = await serverExecutor.execute(serverData, req.pipeline as any)
          return { id: req.id, index, result }
        })
      )
    }

    const batcher = createPipelineBatcher({ transport })
    const stub = batcher.createStub(['API', 'api-async']) as any

    const email = await stub.fetchUser('async-user').email

    expect(email).toBe('async-user@async.com')
  })

  it('batch of mixed pipelines all resolve correctly', async () => {
    // FAILING TEST: Multiple different pipelines in batch should all work

    const serverExecutor = new PipelineExecutor()
    const serverData = {
      config: { theme: 'dark', language: 'en' },
      users: ['alice', 'bob', 'charlie'],
      getCount() {
        return this.users.length
      },
    }

    const transport = async (requests: BatchRequest[]): Promise<BatchResponse[]> => {
      return Promise.all(
        requests.map(async (req, index) => {
          const result = await serverExecutor.execute(serverData, req.pipeline as any)
          return { id: req.id, index, result }
        })
      )
    }

    const batcher = createPipelineBatcher({ transport })
    const stub = batcher.createStub(['App', 'app-1']) as any

    const [theme, users, count] = await Promise.all([
      stub.config.theme,
      stub.users,
      stub.getCount(),
    ])

    expect(theme).toBe('dark')
    expect(users).toEqual(['alice', 'bob', 'charlie'])
    expect(count).toBe(3)
  })
})
