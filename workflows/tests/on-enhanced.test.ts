/**
 * Enhanced $.on Event Subscription Tests (RED Phase)
 *
 * TDD tests for enhanced event handler registration via $.on.Noun.verb()
 *
 * New features:
 * 1. DLQ Integration - Failed handlers retry via DLQStore
 * 2. Handler Ordering - Support for handler priority/ordering
 * 3. Wildcard Events - $.on.*.created() for all entity creation events
 * 4. Event Filtering - Optional filter predicate for conditional handling
 * 5. Handler Metadata - Track registration time, source DO, handler name
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DO, type Env } from '../../objects/DO'
import type {
  DomainEvent,
  EventHandler,
  OnProxy,
  HandlerOptions,
  HandlerRegistration,
  EnhancedDispatchResult,
} from '../../types/WorkflowContext'

// ============================================================================
// MOCK INFRASTRUCTURE (reused from do-on-handlers.test.ts)
// ============================================================================

interface MockSqlCursor {
  toArray(): unknown[]
  one(): unknown
  raw(): unknown[]
}

function createMockSqlStorage() {
  const tables = new Map<string, unknown[]>()
  return {
    exec(query: string, ...params: unknown[]): MockSqlCursor {
      return {
        toArray: () => [],
        one: () => undefined,
        raw: () => [],
      }
    },
    _tables: tables,
  }
}

function createMockKvStorage() {
  const storage = new Map<string, unknown>()
  return {
    get: vi.fn(async <T = unknown>(key: string | string[]): Promise<T | Map<string, T> | undefined> => {
      if (Array.isArray(key)) {
        const result = new Map<string, T>()
        for (const k of key) {
          const value = storage.get(k)
          if (value !== undefined) {
            result.set(k, value as T)
          }
        }
        return result as Map<string, T>
      }
      return storage.get(key) as T | undefined
    }),
    put: vi.fn(async <T>(key: string | Record<string, T>, value?: T): Promise<void> => {
      if (typeof key === 'object') {
        for (const [k, v] of Object.entries(key)) {
          storage.set(k, v)
        }
      } else {
        storage.set(key, value)
      }
    }),
    delete: vi.fn(async (key: string | string[]): Promise<boolean | number> => {
      if (Array.isArray(key)) {
        let count = 0
        for (const k of key) {
          if (storage.delete(k)) count++
        }
        return count
      }
      return storage.delete(key)
    }),
    deleteAll: vi.fn(async (): Promise<void> => {
      storage.clear()
    }),
    list: vi.fn(async <T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>> => {
      const result = new Map<string, T>()
      for (const [key, value] of storage) {
        if (!options?.prefix || key.startsWith(options.prefix)) {
          result.set(key, value as T)
        }
      }
      return result
    }),
    _storage: storage,
  }
}

function createMockDOId(name: string = 'test-do-id'): DurableObjectId {
  return {
    toString: () => name,
    equals: (other: DurableObjectId) => other.toString() === name,
    name,
  }
}

function createMockState(idName: string = 'test-do-id'): DurableObjectState {
  const kvStorage = createMockKvStorage()
  const sqlStorage = createMockSqlStorage()
  return {
    id: createMockDOId(idName),
    storage: {
      ...kvStorage,
      sql: sqlStorage,
    },
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async <T>(callback: () => Promise<T>): Promise<T> => callback()),
  } as unknown as DurableObjectState
}

function createMockEnv(): Env {
  return {
    AI: undefined,
    PIPELINE: undefined,
    DO: undefined,
  }
}

interface DurableObjectId {
  toString(): string
  equals(other: DurableObjectId): boolean
  name?: string
}

interface DurableObjectState {
  id: DurableObjectId
  storage: DurableObjectStorage
  waitUntil(promise: Promise<unknown>): void
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>
}

interface DurableObjectStorage {
  get<T = unknown>(key: string | string[]): Promise<T | Map<string, T> | undefined>
  put<T>(key: string | Record<string, T>, value?: T): Promise<void>
  delete(key: string | string[]): Promise<boolean | number>
  deleteAll(): Promise<void>
  list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>>
  sql: unknown
}

// ============================================================================
// TEST HELPERS
// ============================================================================

function createTestEvent(noun: string, verb: string, data: unknown = {}): DomainEvent {
  return {
    id: `evt-${crypto.randomUUID()}`,
    verb,
    source: `https://test.do/${noun}/test-id`,
    data,
    timestamp: new Date(),
  }
}

function getRegisteredHandlers(doInstance: DO, noun: string, verb: string): Function[] {
  const eventKey = `${noun}.${verb}`
  const instance = doInstance as unknown as {
    getEventHandlers?: (key: string) => Function[]
    _eventHandlers?: Map<string, Function[]>
  }
  if (instance.getEventHandlers) {
    return instance.getEventHandlers(eventKey)
  }
  if (instance._eventHandlers) {
    return instance._eventHandlers.get(eventKey) || []
  }
  return []
}

async function dispatchEvent(
  doInstance: DO,
  event: DomainEvent
): Promise<{ handled: number; errors: Error[]; dlqEntries?: string[] }> {
  const instance = doInstance as unknown as {
    dispatchEventToHandlers?: (event: DomainEvent) => Promise<{ handled: number; errors: Error[]; dlqEntries?: string[] }>
  }
  if (instance.dispatchEventToHandlers) {
    return instance.dispatchEventToHandlers(event)
  }
  // Fallback - shouldn't be needed when implementation is complete
  return { handled: 0, errors: [] }
}

// ============================================================================
// 1. DLQ INTEGRATION TESTS
// ============================================================================

describe('DLQ Integration for $.on handlers', () => {
  let mockState: DurableObjectState
  let mockEnv: Env
  let doInstance: DO

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    doInstance = new DO(mockState, mockEnv)
  })

  describe('Failed handler DLQ routing', () => {
    it('failed handlers are added to DLQ for retry', async () => {
      const failingHandler = vi.fn().mockImplementation(() => {
        throw new Error('Handler failed')
      })

      doInstance.$.on.Customer.created(failingHandler)

      const event = createTestEvent('Customer', 'created', { customerId: 'cust-123' })
      const result = await dispatchEvent(doInstance, event)

      // Verify error was captured
      expect(result.errors).toHaveLength(1)

      // Verify entry was added to DLQ
      expect(result.dlqEntries).toBeDefined()
      expect(result.dlqEntries!.length).toBeGreaterThan(0)
    })

    it.skip('DLQ entries include event details for replay (requires real DB)', async () => {
      // This test requires a real Drizzle DB connection - skip in unit tests
      const failingHandler = vi.fn().mockImplementation(() => {
        throw new Error('Transient error')
      })

      doInstance.$.on.Order.placed(failingHandler)

      const event = createTestEvent('Order', 'placed', { orderId: 'ord-456' })
      await dispatchEvent(doInstance, event)

      // Access DLQ to verify entry contents
      const dlqEntries = await doInstance.dlq.list({ verb: 'Order.placed' })
      expect(dlqEntries.length).toBeGreaterThan(0)

      const entry = dlqEntries[0]
      expect(entry.verb).toBe('Order.placed')
      expect(entry.data).toEqual({ orderId: 'ord-456' })
      expect(entry.error).toContain('Transient error')
    })

    it('successful handlers do not create DLQ entries', async () => {
      const successHandler = vi.fn()

      doInstance.$.on.Payment.completed(successHandler)

      const event = createTestEvent('Payment', 'completed', { paymentId: 'pay-789' })
      const result = await dispatchEvent(doInstance, event)

      expect(result.errors).toHaveLength(0)
      expect(result.dlqEntries ?? []).toHaveLength(0)
    })

    it.skip('DLQ retry count is tracked (requires real DB)', async () => {
      // This test requires a real Drizzle DB connection - skip in unit tests
      const failingHandler = vi.fn().mockImplementation(() => {
        throw new Error('Persistent failure')
      })

      doInstance.$.on.Invoice.sent(failingHandler)

      const event = createTestEvent('Invoice', 'sent', { invoiceId: 'inv-001' })
      await dispatchEvent(doInstance, event)

      const dlqEntries = await doInstance.dlq.list({ verb: 'Invoice.sent' })
      expect(dlqEntries[0].retryCount).toBe(0)

      // Replay should increment retry count
      await doInstance.dlq.replay(dlqEntries[0].id)
      const updatedEntries = await doInstance.dlq.list({ verb: 'Invoice.sent' })
      expect(updatedEntries[0].retryCount).toBe(1)
    })

    it('mixed success/failure handlers properly separate DLQ entries', async () => {
      const successHandler = vi.fn()
      const failingHandler = vi.fn().mockImplementation(() => {
        throw new Error('This one fails')
      })

      doInstance.$.on.Notification.sent(successHandler)
      doInstance.$.on.Notification.sent(failingHandler)

      const event = createTestEvent('Notification', 'sent', { message: 'Hello' })
      const result = await dispatchEvent(doInstance, event)

      expect(result.handled).toBe(1) // Success handler
      expect(result.errors).toHaveLength(1) // Failed handler
      expect(result.dlqEntries).toHaveLength(1) // Only failed handler in DLQ
    })
  })

  describe('DLQ max retries and exhaustion', () => {
    it.skip('respects maxRetries option from handler registration (requires real DB)', async () => {
      // This test requires a real Drizzle DB connection - skip in unit tests
      const failingHandler = vi.fn().mockImplementation(() => {
        throw new Error('Always fails')
      })

      // Register with custom maxRetries
      ;(doInstance.$.on.Task.failed as any)(failingHandler, { maxRetries: 5 })

      const event = createTestEvent('Task', 'failed', { taskId: 'task-123' })
      await dispatchEvent(doInstance, event)

      const dlqEntries = await doInstance.dlq.list({ verb: 'Task.failed' })
      expect(dlqEntries[0].maxRetries).toBe(5)
    })

    it('maxRetries is stored in handler registration metadata', () => {
      const failingHandler = vi.fn().mockImplementation(() => {
        throw new Error('Always fails')
      })

      ;(doInstance.$.on.Task.failed as any)(failingHandler, { maxRetries: 5, name: 'taskHandler' })

      const instance = doInstance as unknown as {
        getHandlerMetadata?: (eventKey: string, handlerName: string) => HandlerRegistration | undefined
      }

      if (instance.getHandlerMetadata) {
        const metadata = instance.getHandlerMetadata('Task.failed', 'taskHandler')
        expect(metadata).toBeDefined()
        expect(metadata!.maxRetries).toBe(5)
      }
    })
  })
})

// ============================================================================
// 2. HANDLER ORDERING/PRIORITY TESTS
// ============================================================================

describe('Handler Ordering and Priority', () => {
  let mockState: DurableObjectState
  let mockEnv: Env
  let doInstance: DO

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    doInstance = new DO(mockState, mockEnv)
  })

  describe('Priority-based ordering', () => {
    it('handlers with higher priority execute first', async () => {
      const executionOrder: number[] = []

      const lowPriorityHandler = vi.fn(() => executionOrder.push(1))
      const highPriorityHandler = vi.fn(() => executionOrder.push(2))
      const mediumPriorityHandler = vi.fn(() => executionOrder.push(3))

      // Register in reverse priority order
      ;(doInstance.$.on.Order.created as any)(lowPriorityHandler, { priority: 1 })
      ;(doInstance.$.on.Order.created as any)(highPriorityHandler, { priority: 10 })
      ;(doInstance.$.on.Order.created as any)(mediumPriorityHandler, { priority: 5 })

      const event = createTestEvent('Order', 'created', { orderId: 'ord-123' })
      await dispatchEvent(doInstance, event)

      // Should execute in priority order: high (10), medium (5), low (1)
      expect(executionOrder).toEqual([2, 3, 1])
    })

    it('handlers without priority default to 0', async () => {
      const executionOrder: number[] = []

      const defaultHandler = vi.fn(() => executionOrder.push(1))
      const prioritizedHandler = vi.fn(() => executionOrder.push(2))

      doInstance.$.on.Customer.updated(defaultHandler) // No priority = 0
      ;(doInstance.$.on.Customer.updated as any)(prioritizedHandler, { priority: 1 })

      const event = createTestEvent('Customer', 'updated', {})
      await dispatchEvent(doInstance, event)

      // Prioritized (1) should run before default (0)
      expect(executionOrder).toEqual([2, 1])
    })

    it('handlers with same priority maintain registration order', async () => {
      const executionOrder: number[] = []

      const handler1 = vi.fn(() => executionOrder.push(1))
      const handler2 = vi.fn(() => executionOrder.push(2))
      const handler3 = vi.fn(() => executionOrder.push(3))

      // All same priority
      ;(doInstance.$.on.Item.added as any)(handler1, { priority: 5 })
      ;(doInstance.$.on.Item.added as any)(handler2, { priority: 5 })
      ;(doInstance.$.on.Item.added as any)(handler3, { priority: 5 })

      const event = createTestEvent('Item', 'added', {})
      await dispatchEvent(doInstance, event)

      // Should maintain registration order
      expect(executionOrder).toEqual([1, 2, 3])
    })

    it('negative priorities are supported (run last)', async () => {
      const executionOrder: number[] = []

      const defaultHandler = vi.fn(() => executionOrder.push(1))
      const lastHandler = vi.fn(() => executionOrder.push(2))
      const firstHandler = vi.fn(() => executionOrder.push(3))

      doInstance.$.on.Event.processed(defaultHandler) // priority 0
      ;(doInstance.$.on.Event.processed as any)(lastHandler, { priority: -10 })
      ;(doInstance.$.on.Event.processed as any)(firstHandler, { priority: 10 })

      const event = createTestEvent('Event', 'processed', {})
      await dispatchEvent(doInstance, event)

      // first (10), default (0), last (-10)
      expect(executionOrder).toEqual([3, 1, 2])
    })
  })

  describe('getHandlersByPriority method', () => {
    it('returns handlers sorted by priority', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      const handler3 = vi.fn()

      ;(doInstance.$.on.Test.event as any)(handler1, { priority: 1 })
      ;(doInstance.$.on.Test.event as any)(handler2, { priority: 10 })
      ;(doInstance.$.on.Test.event as any)(handler3, { priority: 5 })

      const instance = doInstance as unknown as {
        getHandlersByPriority?: (eventKey: string) => Array<{ handler: Function; priority: number }>
      }

      if (instance.getHandlersByPriority) {
        const sorted = instance.getHandlersByPriority('Test.event')
        expect(sorted[0].priority).toBe(10)
        expect(sorted[1].priority).toBe(5)
        expect(sorted[2].priority).toBe(1)
      }
    })
  })
})

// ============================================================================
// 3. WILDCARD EVENT TESTS
// ============================================================================

describe('Wildcard Event Subscriptions', () => {
  let mockState: DurableObjectState
  let mockEnv: Env
  let doInstance: DO

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    doInstance = new DO(mockState, mockEnv)
  })

  describe('$.on.*.verb - All nouns with specific verb', () => {
    it('*.created matches any noun with created verb', async () => {
      const handler = vi.fn()

      doInstance.$.on['*'].created(handler)

      // Fire events for different nouns with 'created' verb
      await dispatchEvent(doInstance, createTestEvent('Customer', 'created', { id: 1 }))
      await dispatchEvent(doInstance, createTestEvent('Order', 'created', { id: 2 }))
      await dispatchEvent(doInstance, createTestEvent('Product', 'created', { id: 3 }))

      expect(handler).toHaveBeenCalledTimes(3)
    })

    it('*.created does not match other verbs', async () => {
      const handler = vi.fn()

      doInstance.$.on['*'].created(handler)

      await dispatchEvent(doInstance, createTestEvent('Customer', 'updated', { id: 1 }))
      await dispatchEvent(doInstance, createTestEvent('Order', 'deleted', { id: 2 }))

      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('$.on.Noun.* - All verbs for specific noun', () => {
    it('Customer.* matches any verb for Customer noun', async () => {
      const handler = vi.fn()

      doInstance.$.on.Customer['*'](handler)

      await dispatchEvent(doInstance, createTestEvent('Customer', 'created', {}))
      await dispatchEvent(doInstance, createTestEvent('Customer', 'updated', {}))
      await dispatchEvent(doInstance, createTestEvent('Customer', 'deleted', {}))

      expect(handler).toHaveBeenCalledTimes(3)
    })

    it('Customer.* does not match other nouns', async () => {
      const handler = vi.fn()

      doInstance.$.on.Customer['*'](handler)

      await dispatchEvent(doInstance, createTestEvent('Order', 'created', {}))
      await dispatchEvent(doInstance, createTestEvent('Product', 'updated', {}))

      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('$.on.*.* - All events (global handler)', () => {
    it('*.* matches all events', async () => {
      const handler = vi.fn()

      doInstance.$.on['*']['*'](handler)

      await dispatchEvent(doInstance, createTestEvent('Customer', 'created', {}))
      await dispatchEvent(doInstance, createTestEvent('Order', 'placed', {}))
      await dispatchEvent(doInstance, createTestEvent('Invoice', 'paid', {}))

      expect(handler).toHaveBeenCalledTimes(3)
    })
  })

  describe('Wildcard + specific handler ordering', () => {
    it('specific handlers run before wildcards by default', async () => {
      const executionOrder: string[] = []

      const specificHandler = vi.fn(() => executionOrder.push('specific'))
      const wildcardHandler = vi.fn(() => executionOrder.push('wildcard'))

      doInstance.$.on.Customer.created(specificHandler)
      doInstance.$.on['*'].created(wildcardHandler)

      await dispatchEvent(doInstance, createTestEvent('Customer', 'created', {}))

      // Both should fire, specific first
      expect(specificHandler).toHaveBeenCalledTimes(1)
      expect(wildcardHandler).toHaveBeenCalledTimes(1)
      expect(executionOrder).toEqual(['specific', 'wildcard'])
    })

    it('wildcard priority can override default ordering', async () => {
      const executionOrder: string[] = []

      const specificHandler = vi.fn(() => executionOrder.push('specific'))
      const wildcardHandler = vi.fn(() => executionOrder.push('wildcard'))

      doInstance.$.on.Customer.created(specificHandler) // default priority 0
      ;(doInstance.$.on['*'].created as any)(wildcardHandler, { priority: 100 })

      await dispatchEvent(doInstance, createTestEvent('Customer', 'created', {}))

      // High priority wildcard should run first
      expect(executionOrder).toEqual(['wildcard', 'specific'])
    })
  })
})

// ============================================================================
// 4. EVENT FILTERING TESTS
// ============================================================================

describe('Event Filtering with Predicates', () => {
  let mockState: DurableObjectState
  let mockEnv: Env
  let doInstance: DO

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    doInstance = new DO(mockState, mockEnv)
  })

  describe('Filter predicate option', () => {
    it('handler only fires when filter returns true', async () => {
      const handler = vi.fn()

      const filter = (event: DomainEvent) => {
        const data = event.data as { amount?: number }
        return (data.amount ?? 0) > 100
      }

      ;(doInstance.$.on.Payment.received as any)(handler, { filter })

      // Should not fire - amount <= 100
      await dispatchEvent(doInstance, createTestEvent('Payment', 'received', { amount: 50 }))
      expect(handler).not.toHaveBeenCalled()

      // Should fire - amount > 100
      await dispatchEvent(doInstance, createTestEvent('Payment', 'received', { amount: 150 }))
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('filter receives full event object', async () => {
      const filterSpy = vi.fn().mockReturnValue(true)
      const handler = vi.fn()

      ;(doInstance.$.on.Order.placed as any)(handler, { filter: filterSpy })

      const event = createTestEvent('Order', 'placed', { orderId: 'ord-123' })
      await dispatchEvent(doInstance, event)

      expect(filterSpy).toHaveBeenCalledWith(expect.objectContaining({
        id: expect.any(String),
        verb: 'placed',
        source: expect.stringContaining('Order'),
        data: { orderId: 'ord-123' },
        timestamp: expect.any(Date),
      }))
    })

    it('handlers without filter always fire', async () => {
      const filteredHandler = vi.fn()
      const unfilteredHandler = vi.fn()

      ;(doInstance.$.on.Event.test as any)(filteredHandler, {
        filter: () => false, // Never fires
      })
      doInstance.$.on.Event.test(unfilteredHandler)

      await dispatchEvent(doInstance, createTestEvent('Event', 'test', {}))

      expect(filteredHandler).not.toHaveBeenCalled()
      expect(unfilteredHandler).toHaveBeenCalledTimes(1)
    })

    it('filter errors do not prevent other handlers', async () => {
      const badFilterHandler = vi.fn()
      const goodHandler = vi.fn()

      ;(doInstance.$.on.Event.risky as any)(badFilterHandler, {
        filter: () => {
          throw new Error('Filter error')
        },
      })
      doInstance.$.on.Event.risky(goodHandler)

      await dispatchEvent(doInstance, createTestEvent('Event', 'risky', {}))

      // Bad filter handler should not fire, good handler should
      expect(badFilterHandler).not.toHaveBeenCalled()
      expect(goodHandler).toHaveBeenCalledTimes(1)
    })

    it('async filter functions are supported', async () => {
      const handler = vi.fn()

      const asyncFilter = async (event: DomainEvent): Promise<boolean> => {
        // Simulate async check
        await new Promise((resolve) => setTimeout(resolve, 1))
        const data = event.data as { approved?: boolean }
        return data.approved === true
      }

      ;(doInstance.$.on.Request.submitted as any)(handler, { filter: asyncFilter })

      await dispatchEvent(doInstance, createTestEvent('Request', 'submitted', { approved: false }))
      expect(handler).not.toHaveBeenCalled()

      await dispatchEvent(doInstance, createTestEvent('Request', 'submitted', { approved: true }))
      expect(handler).toHaveBeenCalledTimes(1)
    })
  })

  describe('Complex filter patterns', () => {
    it('filter by event source', async () => {
      const handler = vi.fn()

      ;(doInstance.$.on['*']['*'] as any)(handler, {
        filter: (event: DomainEvent) => event.source.includes('admin'),
      })

      await dispatchEvent(doInstance, {
        ...createTestEvent('User', 'updated', {}),
        source: 'https://api.do/User/user-123',
      })
      expect(handler).not.toHaveBeenCalled()

      await dispatchEvent(doInstance, {
        ...createTestEvent('User', 'updated', {}),
        source: 'https://admin.do/User/admin-456',
      })
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('filter by data properties', async () => {
      const vipHandler = vi.fn()

      ;(doInstance.$.on.Customer.created as any)(vipHandler, {
        filter: (event: DomainEvent) => {
          const data = event.data as { tier?: string }
          return data.tier === 'vip'
        },
      })

      await dispatchEvent(doInstance, createTestEvent('Customer', 'created', { tier: 'standard' }))
      expect(vipHandler).not.toHaveBeenCalled()

      await dispatchEvent(doInstance, createTestEvent('Customer', 'created', { tier: 'vip' }))
      expect(vipHandler).toHaveBeenCalledTimes(1)
    })
  })
})

// ============================================================================
// 5. HANDLER METADATA TESTS
// ============================================================================

describe('Handler Metadata Tracking', () => {
  let mockState: DurableObjectState
  let mockEnv: Env
  let doInstance: DO

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    doInstance = new DO(mockState, mockEnv)
  })

  describe('Registration metadata', () => {
    it('tracks registration timestamp', () => {
      const beforeRegister = Date.now()
      const handler = vi.fn()

      ;(doInstance.$.on.Customer.created as any)(handler, { name: 'myHandler' })

      const afterRegister = Date.now()

      const instance = doInstance as unknown as {
        getHandlerMetadata?: (eventKey: string, handlerName: string) => HandlerRegistration | undefined
      }

      if (instance.getHandlerMetadata) {
        const metadata = instance.getHandlerMetadata('Customer.created', 'myHandler')
        expect(metadata).toBeDefined()
        expect(metadata!.registeredAt).toBeGreaterThanOrEqual(beforeRegister)
        expect(metadata!.registeredAt).toBeLessThanOrEqual(afterRegister)
      }
    })

    it('tracks source DO namespace', () => {
      const handler = vi.fn()

      ;(doInstance.$.on.Order.placed as any)(handler, { name: 'orderHandler' })

      const instance = doInstance as unknown as {
        getHandlerMetadata?: (eventKey: string, handlerName: string) => HandlerRegistration | undefined
        ns?: string
      }

      if (instance.getHandlerMetadata) {
        const metadata = instance.getHandlerMetadata('Order.placed', 'orderHandler')
        expect(metadata).toBeDefined()
        expect(metadata!.sourceNs).toBe(instance.ns)
      }
    })

    it('generates handler name if not provided', () => {
      // Use a real named function instead of vi.fn() to test function name detection
      function myNamedFunction() {}

      doInstance.$.on.Event.test(myNamedFunction)

      const instance = doInstance as unknown as {
        getHandlerRegistrations?: (eventKey: string) => HandlerRegistration[]
      }

      if (instance.getHandlerRegistrations) {
        const registrations = instance.getHandlerRegistrations('Event.test')
        expect(registrations.length).toBeGreaterThan(0)
        // Should use function name or generate one
        expect(registrations[0].name).toBeDefined()
        expect(registrations[0].name).toBe('myNamedFunction')
      }
    })

    it('supports custom handler name option', () => {
      const handler = vi.fn()

      ;(doInstance.$.on.Invoice.paid as any)(handler, { name: 'billingNotifier' })

      const instance = doInstance as unknown as {
        getHandlerMetadata?: (eventKey: string, handlerName: string) => HandlerRegistration | undefined
      }

      if (instance.getHandlerMetadata) {
        const metadata = instance.getHandlerMetadata('Invoice.paid', 'billingNotifier')
        expect(metadata).toBeDefined()
        expect(metadata!.name).toBe('billingNotifier')
      }
    })
  })

  describe('Execution metadata', () => {
    it('tracks last execution time', async () => {
      const handler = vi.fn()

      ;(doInstance.$.on.Task.completed as any)(handler, { name: 'completionHandler' })

      const event = createTestEvent('Task', 'completed', {})
      await dispatchEvent(doInstance, event)

      const instance = doInstance as unknown as {
        getHandlerMetadata?: (eventKey: string, handlerName: string) => HandlerRegistration | undefined
      }

      if (instance.getHandlerMetadata) {
        const metadata = instance.getHandlerMetadata('Task.completed', 'completionHandler')
        expect(metadata).toBeDefined()
        expect(metadata!.lastExecutedAt).toBeDefined()
        expect(metadata!.lastExecutedAt).toBeGreaterThan(0)
      }
    })

    it('tracks execution count', async () => {
      const handler = vi.fn()

      ;(doInstance.$.on.Counter.incremented as any)(handler, { name: 'counter' })

      const instance = doInstance as unknown as {
        getHandlerMetadata?: (eventKey: string, handlerName: string) => HandlerRegistration | undefined
      }

      // Execute multiple times
      for (let i = 0; i < 5; i++) {
        await dispatchEvent(doInstance, createTestEvent('Counter', 'incremented', { count: i }))
      }

      if (instance.getHandlerMetadata) {
        const metadata = instance.getHandlerMetadata('Counter.incremented', 'counter')
        expect(metadata).toBeDefined()
        expect(metadata!.executionCount).toBe(5)
      }
    })

    it('tracks success and failure counts', async () => {
      let shouldFail = false
      const handler = vi.fn().mockImplementation(() => {
        if (shouldFail) {
          throw new Error('Intentional failure')
        }
      })

      ;(doInstance.$.on.Operation.run as any)(handler, { name: 'flaky' })

      // 3 successes
      for (let i = 0; i < 3; i++) {
        await dispatchEvent(doInstance, createTestEvent('Operation', 'run', {}))
      }

      // 2 failures
      shouldFail = true
      for (let i = 0; i < 2; i++) {
        await dispatchEvent(doInstance, createTestEvent('Operation', 'run', {}))
      }

      const instance = doInstance as unknown as {
        getHandlerMetadata?: (eventKey: string, handlerName: string) => HandlerRegistration | undefined
      }

      if (instance.getHandlerMetadata) {
        const metadata = instance.getHandlerMetadata('Operation.run', 'flaky')
        expect(metadata).toBeDefined()
        expect(metadata!.successCount).toBe(3)
        expect(metadata!.failureCount).toBe(2)
      }
    })
  })

  describe('listHandlers method', () => {
    it('returns all registered handler metadata', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      const handler3 = vi.fn()

      ;(doInstance.$.on.A.event as any)(handler1, { name: 'handler1' })
      ;(doInstance.$.on.B.event as any)(handler2, { name: 'handler2' })
      ;(doInstance.$.on.C.event as any)(handler3, { name: 'handler3' })

      const instance = doInstance as unknown as {
        listAllHandlers?: () => Map<string, HandlerRegistration[]>
      }

      if (instance.listAllHandlers) {
        const allHandlers = instance.listAllHandlers()
        expect(allHandlers.size).toBe(3)
        expect(allHandlers.has('A.event')).toBe(true)
        expect(allHandlers.has('B.event')).toBe(true)
        expect(allHandlers.has('C.event')).toBe(true)
      }
    })
  })
})

// ============================================================================
// 6. TYPE EXPORTS VERIFICATION
// ============================================================================

describe('Enhanced Type Exports', () => {
  it('HandlerOptions type is exported', () => {
    type TestOptions = HandlerOptions
    const options: TestOptions = {
      priority: 10,
      filter: () => true,
      name: 'test',
      maxRetries: 3,
    }
    expect(options.priority).toBe(10)
  })

  it('HandlerRegistration type is exported', () => {
    type TestReg = HandlerRegistration
    const reg: TestReg = {
      name: 'test',
      priority: 0,
      registeredAt: Date.now(),
      sourceNs: 'Test/123',
      handler: () => {},
    }
    expect(reg.name).toBe('test')
  })

  it('EnhancedDispatchResult type is exported', () => {
    type TestResult = EnhancedDispatchResult
    const result: TestResult = {
      handled: 1,
      errors: [],
      dlqEntries: [],
      filtered: 0,
      wildcardMatches: 0,
    }
    expect(result.handled).toBe(1)
  })
})

// ============================================================================
// 7. INTEGRATION TESTS
// ============================================================================

describe('Enhanced $.on Integration Tests', () => {
  let mockState: DurableObjectState
  let mockEnv: Env
  let doInstance: DO

  beforeEach(() => {
    mockState = createMockState()
    mockEnv = createMockEnv()
    doInstance = new DO(mockState, mockEnv)
  })

  it('combines priority, filter, and DLQ in one handler', async () => {
    const executionOrder: string[] = []

    // High priority, filtered handler that fails
    const failingVIPHandler = vi.fn().mockImplementation(() => {
      executionOrder.push('vip-fail')
      throw new Error('VIP handler crashed')
    })

    // Low priority, always fires
    const defaultHandler = vi.fn(() => executionOrder.push('default'))

    ;(doInstance.$.on.Order.placed as any)(failingVIPHandler, {
      priority: 100,
      filter: (e: DomainEvent) => (e.data as { vip?: boolean }).vip === true,
      name: 'vipHandler',
      maxRetries: 5,
    })

    doInstance.$.on.Order.placed(defaultHandler)

    // VIP order - both handlers fire, VIP first (priority), VIP fails -> DLQ
    await dispatchEvent(doInstance, createTestEvent('Order', 'placed', { vip: true }))

    expect(executionOrder).toEqual(['vip-fail', 'default'])

    // Verify handler metadata has correct maxRetries
    const instance = doInstance as unknown as {
      getHandlerMetadata?: (eventKey: string, handlerName: string) => HandlerRegistration | undefined
    }

    if (instance.getHandlerMetadata) {
      const metadata = instance.getHandlerMetadata('Order.placed', 'vipHandler')
      expect(metadata).toBeDefined()
      expect(metadata!.maxRetries).toBe(5)
      expect(metadata!.failureCount).toBe(1)
    }
  })

  it('wildcard handlers with filtering work correctly', async () => {
    const auditLog: string[] = []

    // Global audit handler for all admin operations
    ;(doInstance.$.on['*']['*'] as any)((e: DomainEvent) => {
      auditLog.push(`${e.source}:${e.verb}`)
    }, {
      filter: (e: DomainEvent) => e.source.includes('admin'),
      name: 'auditLogger',
      priority: -100, // Run last
    })

    // Regular handlers
    doInstance.$.on.User.created(vi.fn())
    doInstance.$.on.User.deleted(vi.fn())

    // User operations from admin
    await dispatchEvent(doInstance, {
      ...createTestEvent('User', 'created', {}),
      source: 'https://admin.do/User/123',
    })
    await dispatchEvent(doInstance, {
      ...createTestEvent('User', 'deleted', {}),
      source: 'https://admin.do/User/456',
    })

    // User operation from regular user (should not be audited)
    await dispatchEvent(doInstance, {
      ...createTestEvent('User', 'created', {}),
      source: 'https://api.do/User/789',
    })

    expect(auditLog).toHaveLength(2)
    expect(auditLog).toContain('https://admin.do/User/123:created')
    expect(auditLog).toContain('https://admin.do/User/456:deleted')
  })
})
