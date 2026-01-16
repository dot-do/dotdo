/**
 * @dotdo/workers - RED Phase Tests
 *
 * These tests verify the package exports and basic API contracts.
 * All tests should FAIL initially (RED phase) since the implementations
 * are stubs that throw "not implemented" errors.
 *
 * Test Categories:
 * 1. Package exports exist
 * 2. DOBase class functionality
 * 3. WorkflowContext ($) methods
 * 4. evaluate function
 * 5. PipelinedStub functionality
 * 6. Unified storage
 */

import { describe, it, expect } from 'vitest'

// Import from main entry point
import {
  DOBase,
  createWorkflowContext,
  evaluate,
  createPipelinedStub,
  serializePipeline,
  deserializePipeline,
  createRPCClient,
  createUnifiedStore,
  PIPELINE_SYMBOL,
  TARGET_SYMBOL,
} from '../src/index'

// Import types to verify they exist
import type {
  WorkflowContext,
  Event,
  EventHandler,
  ScheduleHandler,
  CreateContextOptions,
  EvaluateOptions,
  EvaluateResult,
  PipelinedStub,
  PipelineStep,
  SerializedPipeline,
  RPCRequest,
  RPCResponse,
  RPCClientOptions,
  ThingData,
  StorageTier,
  UnifiedStoreConfig,
  UnifiedStoreStats,
} from '../src/index'

// =============================================================================
// 1. Package Exports
// =============================================================================

describe('Package exports', () => {
  it('exports DOBase class', () => {
    expect(DOBase).toBeDefined()
    expect(typeof DOBase).toBe('function')
  })

  it('exports createWorkflowContext function', () => {
    expect(createWorkflowContext).toBeDefined()
    expect(typeof createWorkflowContext).toBe('function')
  })

  it('exports evaluate function', () => {
    expect(evaluate).toBeDefined()
    expect(typeof evaluate).toBe('function')
  })

  it('exports PipelinedStub utilities', () => {
    expect(createPipelinedStub).toBeDefined()
    expect(serializePipeline).toBeDefined()
    expect(deserializePipeline).toBeDefined()
    expect(PIPELINE_SYMBOL).toBeDefined()
    expect(TARGET_SYMBOL).toBeDefined()
  })

  it('exports createRPCClient function', () => {
    expect(createRPCClient).toBeDefined()
    expect(typeof createRPCClient).toBe('function')
  })

  it('exports createUnifiedStore function', () => {
    expect(createUnifiedStore).toBeDefined()
    expect(typeof createUnifiedStore).toBe('function')
  })
})

// =============================================================================
// 2. DOBase Class
// =============================================================================

describe('DOBase', () => {
  it('can be extended', () => {
    class MyDO extends DOBase {
      constructor(ctx: unknown, env: unknown) {
        super(ctx, env)
      }
    }

    expect(MyDO).toBeDefined()
    expect(MyDO.prototype).toBeInstanceOf(DOBase)
  })

  it('can be instantiated with ctx and env', () => {
    const mockCtx = { storage: { sql: {} } }
    const mockEnv = {}

    // This should work once implemented (currently throws)
    const instance = new DOBase(mockCtx, mockEnv)
    expect(instance).toBeInstanceOf(DOBase)
  })

  it('provides state management methods', async () => {
    const mockCtx = { storage: { sql: {} } }
    const mockEnv = {}
    const instance = new DOBase(mockCtx, mockEnv)

    // These should work once implemented
    await instance.set('key', 'value')
    const value = await instance.get('key')
    expect(value).toBe('value')

    await instance.delete('key')
    const deleted = await instance.get('key')
    expect(deleted).toBeUndefined()
  })

  it('provides alarm scheduling methods', async () => {
    const mockCtx = { storage: { sql: {} } }
    const mockEnv = {}
    const instance = new DOBase(mockCtx, mockEnv)

    const futureTime = new Date(Date.now() + 60000)
    await instance.setAlarm(futureTime)

    const alarm = await instance.getAlarm()
    expect(alarm).toEqual(futureTime)

    await instance.deleteAlarm()
    const deleted = await instance.getAlarm()
    expect(deleted).toBeNull()
  })
})

// =============================================================================
// 3. WorkflowContext ($)
// =============================================================================

describe('WorkflowContext ($)', () => {
  it('provides send method for fire-and-forget events', () => {
    const $ = createWorkflowContext()

    const eventId = $.send('Customer.signup', { name: 'Alice' })
    expect(typeof eventId).toBe('string')
    expect(eventId).toMatch(/^evt_/)
  })

  it('provides try method for single-attempt execution', async () => {
    const $ = createWorkflowContext()

    const result = await $.try(() => 'success')
    expect(result).toBe('success')
  })

  it('provides try method with timeout', async () => {
    const $ = createWorkflowContext()

    await expect(
      $.try(
        () => new Promise((resolve) => setTimeout(resolve, 1000)),
        { timeout: 10 }
      )
    ).rejects.toThrow('Timeout')
  })

  it('provides do method for durable execution with retries', async () => {
    const $ = createWorkflowContext()

    let attempts = 0
    const result = await $.do(() => {
      attempts++
      if (attempts < 2) throw new Error('Fail')
      return 'success'
    }, { maxRetries: 3 })

    expect(result).toBe('success')
    expect(attempts).toBe(2)
  })

  it('provides on proxy for event handlers', () => {
    const $ = createWorkflowContext()

    const events: Event[] = []
    const unsubscribe = $.on.Customer.signup((event) => {
      events.push(event)
    })

    expect(typeof unsubscribe).toBe('function')

    // Trigger the event
    $.send('Customer.signup', { name: 'Bob' })

    // Allow async handler to run
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(events.length).toBe(1)
        expect(events[0].data).toEqual({ name: 'Bob' })
        unsubscribe()
        resolve()
      }, 10)
    })
  })

  it('supports wildcard event handlers', () => {
    const $ = createWorkflowContext()

    const events: Event[] = []
    $.on['*'].created((event) => {
      events.push(event)
    })

    $.send('Customer.created', { id: '1' })
    $.send('Order.created', { id: '2' })

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(events.length).toBe(2)
        resolve()
      }, 10)
    })
  })

  it('provides every for scheduling DSL', () => {
    const $ = createWorkflowContext()

    let called = false
    const unsubscribe = $.every.day.at('9am')(() => {
      called = true
    })

    expect(typeof unsubscribe).toBe('function')
    expect($.getSchedule('0 9 * * *')).toBeDefined()

    unsubscribe()
    expect($.getSchedule('0 9 * * *')).toBeUndefined()
  })

  it('provides every(n).minutes for interval scheduling', () => {
    const $ = createWorkflowContext()

    let called = false
    const unsubscribe = $.every(5).minutes(() => {
      called = true
    })

    expect(typeof unsubscribe).toBe('function')
    expect($.getSchedule('*/5 * * * *')).toBeDefined()

    unsubscribe()
  })

  it('provides at for one-time scheduling', () => {
    const $ = createWorkflowContext()

    const futureDate = new Date(Date.now() + 60000).toISOString()
    let called = false
    const unsubscribe = $.at(futureDate)(() => {
      called = true
    })

    expect(typeof unsubscribe).toBe('function')
    unsubscribe()
  })
})

// =============================================================================
// 4. evaluate Function
// =============================================================================

describe('evaluate', () => {
  it('runs code with $ context', async () => {
    const $ = createWorkflowContext()

    const result = await evaluate<string>(`
      return 'hello'
    `, { context: $ })

    expect(result.value).toBe('hello')
    expect(typeof result.duration).toBe('number')
  })

  it('provides access to $ in code', async () => {
    const $ = createWorkflowContext()

    const result = await evaluate<string>(`
      const eventId = $.send('Test.event', { foo: 'bar' })
      return eventId
    `, { context: $ })

    expect(result.value).toMatch(/^evt_/)
  })

  it('supports additional globals', async () => {
    const $ = createWorkflowContext()

    const result = await evaluate<number>(`
      return myValue + 10
    `, {
      context: $,
      globals: { myValue: 5 }
    })

    expect(result.value).toBe(15)
  })

  it('respects timeout option', async () => {
    const $ = createWorkflowContext()

    // Use an async delay that can be interrupted by timeout
    await expect(
      evaluate(`
        await new Promise(resolve => setTimeout(resolve, 5000))
        return 'should not reach here'
      `, { context: $, timeout: 10 })
    ).rejects.toThrow()
  })
})

// =============================================================================
// 5. PipelinedStub
// =============================================================================

describe('PipelinedStub', () => {
  it('creates a stub with target', () => {
    const stub = createPipelinedStub(['Customer', 'cust_123'])

    expect(stub[TARGET_SYMBOL]).toEqual(['Customer', 'cust_123'])
    expect(stub[PIPELINE_SYMBOL]).toEqual([])
  })

  it('records property access', () => {
    const stub = createPipelinedStub(['Customer', 'cust_123'])
    const chain = stub.profile.email

    expect(chain[PIPELINE_SYMBOL]).toEqual([
      { type: 'property', name: 'profile' },
      { type: 'property', name: 'email' },
    ])
  })

  it('records method calls', () => {
    const stub = createPipelinedStub(['Customer', 'cust_123'])
    const chain = (stub.getOrders as Function)({ status: 'active' })

    expect(chain[PIPELINE_SYMBOL]).toEqual([
      { type: 'method', name: 'getOrders', args: [{ status: 'active' }] },
    ])
  })

  it('chains property and method access', () => {
    const stub = createPipelinedStub(['Customer', 'cust_123'])
    const chain = (stub.profile.update as Function)({ name: 'Alice' })

    expect(chain[PIPELINE_SYMBOL]).toEqual([
      { type: 'property', name: 'profile' },
      { type: 'method', name: 'update', args: [{ name: 'Alice' }] },
    ])
  })

  it('serializes to wire format', () => {
    const stub = createPipelinedStub(['Customer', 'cust_123'])
    const chain = stub.profile.email

    const wire = serializePipeline(chain as PipelinedStub)

    expect(wire).toEqual({
      target: ['Customer', 'cust_123'],
      pipeline: [
        { type: 'property', name: 'profile' },
        { type: 'property', name: 'email' },
      ],
    })
  })

  it('deserializes from wire format', () => {
    const wire: SerializedPipeline = {
      target: ['Order', 'ord_456'],
      pipeline: [
        { type: 'property', name: 'items' },
        { type: 'method', name: 'filter', args: [{ active: true }] },
      ],
    }

    const stub = deserializePipeline(wire)

    expect(stub[TARGET_SYMBOL]).toEqual(['Order', 'ord_456'])
    expect(stub[PIPELINE_SYMBOL]).toEqual(wire.pipeline)
  })

  it('is thenable for await compatibility', async () => {
    const stub = createPipelinedStub(['Customer', 'cust_123'])
    const chain = stub.profile

    // Should resolve to another PipelinedStub
    const awaited = await chain
    expect(awaited[TARGET_SYMBOL]).toEqual(['Customer', 'cust_123'])
  })
})

// =============================================================================
// 6. Unified Storage
// =============================================================================

describe('Unified Storage', () => {
  it('creates a store with config', () => {
    const mockState = { storage: { sql: {} } }
    const mockEnv = {}

    const store = createUnifiedStore(mockState, mockEnv, {
      namespace: 'test',
      checkpointInterval: 5000,
      dirtyCountThreshold: 100,
    })

    expect(store).toBeDefined()
    expect(typeof store.get).toBe('function')
    expect(typeof store.put).toBe('function')
    expect(typeof store.delete).toBe('function')
    expect(typeof store.list).toBe('function')
  })

  it('provides stats method', () => {
    const mockState = { storage: { sql: {} } }
    const mockEnv = {}

    const store = createUnifiedStore(mockState, mockEnv, {
      namespace: 'test',
    })

    const stats = store.getStats()
    expect(stats).toHaveProperty('inMemoryCount')
    expect(stats).toHaveProperty('dirtyCount')
    expect(stats).toHaveProperty('lastCheckpoint')
  })

  it('stores and retrieves things', async () => {
    const mockState = { storage: { sql: {} } }
    const mockEnv = {}

    const store = createUnifiedStore(mockState, mockEnv, {
      namespace: 'test',
    })

    const thing: ThingData = {
      $id: 'thing_1',
      $type: 'Customer',
      $createdAt: new Date().toISOString(),
      $updatedAt: new Date().toISOString(),
      $version: 1,
      name: 'Alice',
    }

    await store.put('thing_1', thing)
    const retrieved = await store.get('thing_1')

    expect(retrieved).toEqual(thing)
  })

  it('deletes things', async () => {
    const mockState = { storage: { sql: {} } }
    const mockEnv = {}

    const store = createUnifiedStore(mockState, mockEnv, {
      namespace: 'test',
    })

    const thing: ThingData = {
      $id: 'thing_2',
      $type: 'Customer',
      $createdAt: new Date().toISOString(),
      $updatedAt: new Date().toISOString(),
      $version: 1,
      name: 'Bob',
    }

    await store.put('thing_2', thing)
    const deleted = await store.delete('thing_2')
    expect(deleted).toBe(true)

    const retrieved = await store.get('thing_2')
    expect(retrieved).toBeNull()
  })

  it('lists things with prefix filter', async () => {
    const mockState = { storage: { sql: {} } }
    const mockEnv = {}

    const store = createUnifiedStore(mockState, mockEnv, {
      namespace: 'test',
    })

    const customer1: ThingData = {
      $id: 'customer_1',
      $type: 'Customer',
      $createdAt: new Date().toISOString(),
      $updatedAt: new Date().toISOString(),
      $version: 1,
    }

    const customer2: ThingData = {
      $id: 'customer_2',
      $type: 'Customer',
      $createdAt: new Date().toISOString(),
      $updatedAt: new Date().toISOString(),
      $version: 1,
    }

    const order1: ThingData = {
      $id: 'order_1',
      $type: 'Order',
      $createdAt: new Date().toISOString(),
      $updatedAt: new Date().toISOString(),
      $version: 1,
    }

    await store.put('customer_1', customer1)
    await store.put('customer_2', customer2)
    await store.put('order_1', order1)

    const customers = await store.list({ prefix: 'customer' })
    expect(customers.length).toBe(2)

    const orders = await store.list({ prefix: 'order' })
    expect(orders.length).toBe(1)
  })
})

// =============================================================================
// Type Tests (compile-time only)
// =============================================================================

describe('Type definitions', () => {
  it('exports all required types', () => {
    // These are compile-time checks - if TypeScript compiles, types exist
    const _eventType: Event = {} as Event
    const _handlerType: EventHandler = {} as EventHandler
    const _scheduleHandlerType: ScheduleHandler = {} as ScheduleHandler
    const _contextOptionsType: CreateContextOptions = {} as CreateContextOptions
    const _evaluateOptionsType: EvaluateOptions = {} as EvaluateOptions
    const _evaluateResultType: EvaluateResult = {} as EvaluateResult
    const _stubType: PipelinedStub = {} as PipelinedStub
    const _stepType: PipelineStep = {} as PipelineStep
    const _serializedType: SerializedPipeline = {} as SerializedPipeline
    const _rpcRequestType: RPCRequest = {} as RPCRequest
    const _rpcResponseType: RPCResponse = {} as RPCResponse
    const _rpcOptionsType: RPCClientOptions = {} as RPCClientOptions
    const _thingDataType: ThingData = {} as ThingData
    const _storageTierType: StorageTier = {} as StorageTier
    const _storeConfigType: UnifiedStoreConfig = {} as UnifiedStoreConfig
    const _storeStatsType: UnifiedStoreStats = {} as UnifiedStoreStats

    // If we get here, all types compile
    expect(true).toBe(true)
  })
})
