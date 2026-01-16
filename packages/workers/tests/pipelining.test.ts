/**
 * Promise Pipelining Tests
 *
 * These tests verify that chained calls accumulate into a pipeline
 * and execute as a single RPC message when awaited.
 *
 * Key invariants:
 * 1. Chained calls accumulate in pipeline (no execution until await)
 * 2. Single RPC message for entire chain
 * 3. await triggers pipeline execution
 * 4. Intermediate results are pipelined
 * 5. Errors propagate correctly
 * 6. Performance: measure single vs multiple RTT
 *
 * @module @dotdo/workers/tests/pipelining
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createPipelinedStub,
  createPipelineExecutor,
  createPipelinedProxy,
  executePipeline,
  PIPELINE_SYMBOL,
  TARGET_SYMBOL,
  type PipelinedStub,
  type SerializedPipeline,
  type PipelineExecutor,
} from '../src/index'

// =============================================================================
// Mock DO Stub for Testing
// =============================================================================

/**
 * Creates a mock DO stub that tracks RPC calls and simulates responses
 */
function createMockStub(handlers: Record<string, (...args: unknown[]) => unknown> = {}) {
  const calls: { pipeline: SerializedPipeline; timestamp: number }[] = []

  const stub = {
    calls,
    /**
     * Execute a pipeline RPC call
     */
    async executePipeline(pipeline: SerializedPipeline): Promise<unknown> {
      calls.push({ pipeline, timestamp: Date.now() })

      // Simulate server-side pipeline resolution
      return resolvePipelineOnServer(pipeline, handlers)
    },
  }

  return stub
}

/**
 * Simulates server-side pipeline resolution
 * This represents what the DO would do when receiving a pipeline
 */
function resolvePipelineOnServer(
  pipeline: SerializedPipeline,
  handlers: Record<string, (...args: unknown[]) => unknown>
): unknown {
  // Start with the target resolution
  const targetKey = pipeline.target.join('.')
  let current: unknown = handlers[targetKey] ?? handlers

  // Walk the pipeline
  for (const step of pipeline.pipeline) {
    if (current === null || current === undefined) {
      throw new Error(`Cannot access ${step.type === 'property' ? step.name : step.name} on ${current}`)
    }

    if (step.type === 'property') {
      current = (current as Record<string, unknown>)[step.name]
    } else if (step.type === 'method') {
      const fn = (current as Record<string, unknown>)[step.name]
      if (typeof fn !== 'function') {
        throw new Error(`${step.name} is not a function`)
      }
      current = fn.apply(current, step.args)
    }
  }

  return current
}

// =============================================================================
// 1. Pipeline Accumulation
// =============================================================================

describe('Pipeline Accumulation', () => {
  it('accumulates chained property access without execution', () => {
    // Create stub without executor - just records
    const stub = createPipelinedStub(['Customer', 'c-123'])

    // Chain should accumulate without any RPC
    const chain = stub.orders.list

    expect(chain[PIPELINE_SYMBOL]).toEqual([
      { type: 'property', name: 'orders' },
      { type: 'property', name: 'list' },
    ])
    expect(chain[TARGET_SYMBOL]).toEqual(['Customer', 'c-123'])
  })

  it('accumulates chained method calls without execution', () => {
    const stub = createPipelinedStub(['Customer', 'c-123'])

    // Method chain should accumulate
    const chain = stub.get('c-123').orders.list()

    expect(chain[PIPELINE_SYMBOL]).toEqual([
      { type: 'method', name: 'get', args: ['c-123'] },
      { type: 'property', name: 'orders' },
      { type: 'method', name: 'list', args: [] },
    ])
  })

  it('preserves method arguments in pipeline', () => {
    const stub = createPipelinedStub(['Order'])

    const chain = stub.find({ status: 'active', limit: 10 }).first()

    expect(chain[PIPELINE_SYMBOL]).toEqual([
      { type: 'method', name: 'find', args: [{ status: 'active', limit: 10 }] },
      { type: 'method', name: 'first', args: [] },
    ])
  })

  it('handles deeply nested chains', () => {
    const stub = createPipelinedStub(['API'])

    const chain = stub.customers.byId('c-123').profile.address.city

    expect(chain[PIPELINE_SYMBOL]).toHaveLength(5)
    expect(chain[PIPELINE_SYMBOL]).toEqual([
      { type: 'property', name: 'customers' },
      { type: 'method', name: 'byId', args: ['c-123'] },
      { type: 'property', name: 'profile' },
      { type: 'property', name: 'address' },
      { type: 'property', name: 'city' },
    ])
  })
})

// =============================================================================
// 2. Single RPC Message
// =============================================================================

describe('Single RPC Message', () => {
  it('sends single RPC message for entire chain on await', async () => {
    const mockStub = createMockStub({
      Customer: {
        orders: {
          list: () => [{ id: 'order-1' }, { id: 'order-2' }],
        },
      },
    })

    const executor = createPipelineExecutor(mockStub)
    const proxy = createPipelinedProxy(['Customer'], executor)

    // This chain should result in ONE RPC call
    const result = await proxy.orders.list()

    // Only one RPC call was made
    expect(mockStub.calls).toHaveLength(1)

    // The call contained the entire pipeline
    expect(mockStub.calls[0].pipeline).toEqual({
      target: ['Customer'],
      pipeline: [
        { type: 'property', name: 'orders' },
        { type: 'method', name: 'list', args: [] },
      ],
    })

    // Result is the resolved value
    expect(result).toEqual([{ id: 'order-1' }, { id: 'order-2' }])
  })

  it('batches multiple chained calls into one RPC', async () => {
    const mockStub = createMockStub({
      Customer: {
        profile: {
          settings: {
            notifications: {
              email: true,
            },
          },
        },
      },
    })

    const executor = createPipelineExecutor(mockStub)
    const proxy = createPipelinedProxy(['Customer'], executor)

    // Deep chain = still one RPC
    const result = await proxy.profile.settings.notifications.email

    expect(mockStub.calls).toHaveLength(1)
    expect(result).toBe(true)
  })

  it('does not send RPC until await', async () => {
    const mockStub = createMockStub({
      Customer: {
        getData: () => 'data',
      },
    })

    const executor = createPipelineExecutor(mockStub)
    const proxy = createPipelinedProxy(['Customer'], executor)

    // Build chain - no RPC yet
    const chain = proxy.getData()
    expect(mockStub.calls).toHaveLength(0)

    // Await triggers RPC
    await chain
    expect(mockStub.calls).toHaveLength(1)
  })
})

// =============================================================================
// 3. await Triggers Execution
// =============================================================================

describe('await Triggers Execution', () => {
  it('executes pipeline when awaited', async () => {
    const mockStub = createMockStub({
      Customer: { name: 'Alice' },
    })

    const executor = createPipelineExecutor(mockStub)
    const proxy = createPipelinedProxy(['Customer'], executor)

    const name = await proxy.name
    expect(name).toBe('Alice')
    expect(mockStub.calls).toHaveLength(1)
  })

  it('returns Promise from .then()', async () => {
    const mockStub = createMockStub({
      Customer: { count: 42 },
    })

    const executor = createPipelineExecutor(mockStub)
    const proxy = createPipelinedProxy(['Customer'], executor)

    // Direct .then() usage
    const result = await proxy.count.then((val) => val * 2)
    expect(result).toBe(84)
  })

  it('supports Promise.all with multiple chains', async () => {
    const mockStub = createMockStub({
      Customer: { name: 'Alice' },
      Order: { total: 100 },
    })

    const customerExecutor = createPipelineExecutor(mockStub)
    const orderExecutor = createPipelineExecutor(mockStub)

    const customerProxy = createPipelinedProxy(['Customer'], customerExecutor)
    const orderProxy = createPipelinedProxy(['Order'], orderExecutor)

    const [name, total] = await Promise.all([
      customerProxy.name,
      orderProxy.total,
    ])

    expect(name).toBe('Alice')
    expect(total).toBe(100)
    expect(mockStub.calls).toHaveLength(2)
  })

  it('supports async/await syntax naturally', async () => {
    const mockStub = createMockStub({
      API: {
        users: {
          list: () => ['user1', 'user2'],
        },
      },
    })

    const executor = createPipelineExecutor(mockStub)
    const proxy = createPipelinedProxy(['API'], executor)

    // Natural async/await
    async function getUsers() {
      const users = await proxy.users.list()
      return users
    }

    const result = await getUsers()
    expect(result).toEqual(['user1', 'user2'])
  })
})

// =============================================================================
// 4. Intermediate Results Pipelining
// =============================================================================

describe('Intermediate Results Pipelining', () => {
  it('pipelines through method return values', async () => {
    const mockStub = createMockStub({
      Customer: {
        get: (id: string) => ({
          orders: {
            list: () => [`order-for-${id}`],
          },
        }),
      },
    })

    const executor = createPipelineExecutor(mockStub)
    const proxy = createPipelinedProxy(['Customer'], executor)

    // get() returns an object, orders is accessed on it, list() is called
    const result = await proxy.get('c-123').orders.list()

    expect(result).toEqual(['order-for-c-123'])
    // Still single RPC - server resolves entire chain
    expect(mockStub.calls).toHaveLength(1)
  })

  it('pipelines through nested object access', async () => {
    const mockStub = createMockStub({
      Database: {
        collection: (name: string) => ({
          doc: (id: string) => ({
            data: () => ({ collection: name, id, value: 'test' }),
          }),
        }),
      },
    })

    const executor = createPipelineExecutor(mockStub)
    const proxy = createPipelinedProxy(['Database'], executor)

    const result = await proxy.collection('users').doc('user-1').data()

    expect(result).toEqual({
      collection: 'users',
      id: 'user-1',
      value: 'test',
    })
    expect(mockStub.calls).toHaveLength(1)
  })

  it('handles mixed property and method chains', async () => {
    const mockStub = createMockStub({
      Store: {
        products: {
          featured: {
            first: () => ({ name: 'Product A', price: 99 }),
          },
        },
      },
    })

    const executor = createPipelineExecutor(mockStub)
    const proxy = createPipelinedProxy(['Store'], executor)

    const product = await proxy.products.featured.first()

    expect(product).toEqual({ name: 'Product A', price: 99 })
    expect(mockStub.calls).toHaveLength(1)
  })
})

// =============================================================================
// 5. Error Propagation
// =============================================================================

describe('Error Propagation', () => {
  it('propagates errors from pipeline execution', async () => {
    const mockStub = createMockStub({
      Customer: {
        get: () => {
          throw new Error('Customer not found')
        },
      },
    })

    const executor = createPipelineExecutor(mockStub)
    const proxy = createPipelinedProxy(['Customer'], executor)

    await expect(proxy.get('invalid')).rejects.toThrow('Customer not found')
  })

  it('propagates errors from intermediate steps', async () => {
    const mockStub = createMockStub({
      API: {
        users: null, // Will fail when accessing .list on null
      },
    })

    const executor = createPipelineExecutor(mockStub)
    const proxy = createPipelinedProxy(['API'], executor)

    await expect(proxy.users.list()).rejects.toThrow()
  })

  it('propagates method not found errors', async () => {
    const mockStub = createMockStub({
      Customer: {
        name: 'Alice', // Not a function
      },
    })

    const executor = createPipelineExecutor(mockStub)
    const proxy = createPipelinedProxy(['Customer'], executor)

    await expect(proxy.name()).rejects.toThrow('is not a function')
  })

  it('supports try/catch with pipeline errors', async () => {
    const mockStub = createMockStub({
      Customer: {
        validate: () => {
          throw new Error('Validation failed')
        },
      },
    })

    const executor = createPipelineExecutor(mockStub)
    const proxy = createPipelinedProxy(['Customer'], executor)

    let caught = false
    try {
      await proxy.validate()
    } catch (e) {
      caught = true
      expect(e).toBeInstanceOf(Error)
      expect((e as Error).message).toBe('Validation failed')
    }

    expect(caught).toBe(true)
  })

  it('rejects with error on network failure', async () => {
    const mockStub = {
      executePipeline: vi.fn().mockRejectedValue(new Error('Network error')),
      calls: [],
    }

    const executor = createPipelineExecutor(mockStub)
    const proxy = createPipelinedProxy(['Customer'], executor)

    await expect(proxy.getData()).rejects.toThrow('Network error')
  })
})

// =============================================================================
// 6. Performance Measurement
// =============================================================================

describe('Performance: Single vs Multiple RTT', () => {
  it('pipelined call is faster than sequential calls', async () => {
    // Simulate network latency
    const LATENCY = 10 // ms

    const mockStub = {
      calls: [] as { pipeline: SerializedPipeline; timestamp: number }[],
      async executePipeline(pipeline: SerializedPipeline) {
        await new Promise((r) => setTimeout(r, LATENCY))
        this.calls.push({ pipeline, timestamp: Date.now() })
        return { data: 'result' }
      },
    }

    const executor = createPipelineExecutor(mockStub)
    const proxy = createPipelinedProxy(['API'], executor)

    // Measure pipelined call
    const pipelinedStart = Date.now()
    await proxy.data.nested.value
    const pipelinedDuration = Date.now() - pipelinedStart

    // Only one RPC call was made
    expect(mockStub.calls).toHaveLength(1)

    // Measure what sequential would take (3 separate calls)
    // This would be 3 * LATENCY if not pipelined
    const sequentialEstimate = 3 * LATENCY

    // Pipelined should be close to single RTT
    expect(pipelinedDuration).toBeLessThan(sequentialEstimate)
  })

  it('tracks single RPC even for complex chains', async () => {
    const mockStub = createMockStub({
      Service: {
        db: {
          collection: () => ({
            find: () => ({
              filter: () => ({
                sort: () => ({
                  limit: () => ['result1', 'result2'],
                }),
              }),
            }),
          }),
        },
      },
    })

    const executor = createPipelineExecutor(mockStub)
    const proxy = createPipelinedProxy(['Service'], executor)

    // Complex chain
    const result = await proxy.db
      .collection('users')
      .find({ active: true })
      .filter({ role: 'admin' })
      .sort({ createdAt: -1 })
      .limit(10)

    expect(result).toEqual(['result1', 'result2'])
    // Still just ONE RPC call
    expect(mockStub.calls).toHaveLength(1)
  })
})

// =============================================================================
// 7. executePipeline Direct Function
// =============================================================================

describe('executePipeline Function', () => {
  it('executes a serialized pipeline directly', async () => {
    const mockStub = createMockStub({
      Customer: { name: 'Bob' },
    })

    const pipeline: SerializedPipeline = {
      target: ['Customer'],
      pipeline: [{ type: 'property', name: 'name' }],
    }

    const result = await executePipeline(mockStub, pipeline)
    expect(result).toBe('Bob')
  })

  it('executes complex pipeline with methods', async () => {
    const mockStub = createMockStub({
      Math: {
        add: (a: number, b: number) => a + b,
      },
    })

    const pipeline: SerializedPipeline = {
      target: ['Math'],
      pipeline: [{ type: 'method', name: 'add', args: [5, 3] }],
    }

    const result = await executePipeline(mockStub, pipeline)
    expect(result).toBe(8)
  })
})

// =============================================================================
// 8. Proxy Creation Variants
// =============================================================================

describe('Proxy Creation', () => {
  it('createPipelinedProxy creates an executable proxy', async () => {
    const mockStub = createMockStub({
      Root: { value: 123 },
    })

    const executor = createPipelineExecutor(mockStub)
    const proxy = createPipelinedProxy(['Root'], executor)

    const result = await proxy.value
    expect(result).toBe(123)
  })

  it('supports custom executor functions', async () => {
    const customExecutor: PipelineExecutor = async (pipeline) => {
      // Custom execution logic
      return `executed: ${pipeline.target.join('.')}.${pipeline.pipeline.map((s) => s.name).join('.')}`
    }

    const proxy = createPipelinedProxy(['Custom'], customExecutor)

    const result = await proxy.path.to.value
    expect(result).toBe('executed: Custom.path.to.value')
  })
})

// =============================================================================
// Type Safety Tests (compile-time)
// =============================================================================

describe('Type Safety', () => {
  it('maintains type information through chain', async () => {
    // This is mainly a compile-time check
    interface Customer {
      name: string
      orders: {
        list(): Order[]
      }
    }

    interface Order {
      id: string
      total: number
    }

    const mockStub = createMockStub({
      Customer: {
        name: 'Alice',
        orders: {
          list: () => [{ id: 'o-1', total: 100 }],
        },
      },
    })

    const executor = createPipelineExecutor(mockStub)
    const proxy = createPipelinedProxy<Customer>(['Customer'], executor)

    // These should type-check (at compile time)
    const name: unknown = await proxy.name
    const orders: unknown = await proxy.orders.list()

    expect(name).toBe('Alice')
    expect(orders).toEqual([{ id: 'o-1', total: 100 }])
  })
})
