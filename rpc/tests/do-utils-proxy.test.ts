/**
 * Tests for the extended shared proxy utilities in do/utils/proxy.ts
 *
 * These tests verify the new shared utilities work correctly:
 * - createDeepRPCProxy - Deep nested RPC proxy for client.users.create() patterns
 * - createEventProxy - Event handler proxy for $.on.Entity.action() patterns
 * - createScheduleProxy - Schedule DSL proxy for $.every.Monday.at('9am') patterns
 * - createEntityAccessProxy - Entity access proxy for $.Customer('id').method() patterns
 */

import { describe, it, expect, vi } from 'vitest'
import {
  createDeepRPCProxy,
  createEventProxy,
  createScheduleProxy,
  createEntityAccessProxy,
  createNestedProxy,
  createMethodProxy,
  PROMISE_PROPS,
} from '@dotdo/utils'

// ============================================================================
// createDeepRPCProxy Tests
// ============================================================================

describe('createDeepRPCProxy', () => {
  it('should support arbitrary depth property access with method invocation', async () => {
    const invocations: Array<{ path: string[]; args: unknown[] }> = []

    const client = createDeepRPCProxy({
      invoke: async (path, args) => {
        invocations.push({ path, args })
        return { success: true }
      }
    })

    await (client as any).users.create({ name: 'Alice' })
    await (client as any).deeply.nested.namespace.method('arg1', 'arg2')
    await (client as any).simple()

    expect(invocations).toEqual([
      { path: ['users', 'create'], args: [{ name: 'Alice' }] },
      { path: ['deeply', 'nested', 'namespace', 'method'], args: ['arg1', 'arg2'] },
      { path: ['simple'], args: [] }
    ])
  })

  it('should not be thenable (prevents async/await detection issues)', () => {
    const client = createDeepRPCProxy({
      invoke: async () => ({})
    })

    expect((client as any).then).toBeUndefined()
    expect((client as any).catch).toBeUndefined()
    expect((client as any).finally).toBeUndefined()
    expect((client as any).nested.path.then).toBeUndefined()
  })

  it('should return undefined for symbol properties', () => {
    const client = createDeepRPCProxy({
      invoke: async () => ({})
    })

    expect((client as any)[Symbol.iterator]).toBeUndefined()
    expect((client as any)[Symbol.toStringTag]).toBeUndefined()
  })

  it('should cache proxies when cache is provided', () => {
    const cache = new Map<string, unknown>()

    const client = createDeepRPCProxy({
      invoke: async () => ({}),
      cache
    })

    const users1 = (client as any).users
    const users2 = (client as any).users
    expect(users1).toBe(users2)

    const create1 = (client as any).users.create
    const create2 = (client as any).users.create
    expect(create1).toBe(create2)
  })

  it('should support special properties via getSpecialProperty', () => {
    const specialValue = { special: true }

    const client = createDeepRPCProxy({
      invoke: async () => ({}),
      getSpecialProperty: (prop) => {
        if (prop === 'special') return specialValue
        return undefined
      }
    })

    expect((client as any).special).toBe(specialValue)
    expect((client as any).other).not.toBe(specialValue)
  })
})

// ============================================================================
// createEventProxy Tests
// ============================================================================

describe('createEventProxy', () => {
  it('should register handlers for event paths', () => {
    const handlers = new Map<string, unknown[]>()

    const on = createEventProxy({
      onRegister: (path, handler) => {
        const key = path.join('.')
        const existing = handlers.get(key) || []
        handlers.set(key, [...existing, handler])
      }
    })

    const handler1 = vi.fn()
    const handler2 = vi.fn()
    const handler3 = vi.fn()

    ;(on as any).Customer.signup(handler1)
    ;(on as any).Order.placed(handler2)
    ;(on as any).Customer.signup(handler3) // Multiple handlers for same event

    expect(handlers.get('Customer.signup')).toHaveLength(2)
    expect(handlers.get('Order.placed')).toHaveLength(1)
  })

  it('should support deeply nested event paths', () => {
    const registered: string[] = []

    const on = createEventProxy({
      onRegister: (path) => {
        registered.push(path.join('.'))
      }
    })

    ;(on as any).Order.item.added(vi.fn())
    ;(on as any).Payment.status.changed(vi.fn())

    expect(registered).toContain('Order.item.added')
    expect(registered).toContain('Payment.status.changed')
  })

  it('should cache proxies when cache is provided', () => {
    const cache = new Map<string, unknown>()

    const on = createEventProxy({
      onRegister: () => {},
      cache
    })

    const customer1 = (on as any).Customer
    const customer2 = (on as any).Customer
    expect(customer1).toBe(customer2)
  })
})

// ============================================================================
// createScheduleProxy Tests
// ============================================================================

describe('createScheduleProxy', () => {
  it('should support $.every.day(handler) pattern', () => {
    const schedules: Array<{ parts: string[]; handler: () => void }> = []

    const every = createScheduleProxy({
      onRegister: (parts, handler) => {
        schedules.push({ parts, handler: handler as () => void })
      }
    })

    const handler1 = vi.fn()
    const handler2 = vi.fn()

    ;(every as any).day(handler1)
    ;(every as any).hour(handler2)

    expect(schedules).toHaveLength(2)
    expect(schedules[0].parts).toEqual(['day'])
    expect(schedules[1].parts).toEqual(['hour'])
  })

  it('should support $.every.Monday.at("9am")(handler) pattern', () => {
    const schedules: Array<{ parts: string[] }> = []

    const every = createScheduleProxy({
      onRegister: (parts) => {
        schedules.push({ parts })
      }
    })

    ;(every as any).Monday.at('9am')(vi.fn())

    expect(schedules).toHaveLength(1)
    expect(schedules[0].parts).toEqual(['Monday', 'at:9am'])
  })

  it('should cache proxies when cache is provided', () => {
    const cache = new Map<string, unknown>()

    const every = createScheduleProxy({
      onRegister: () => {},
      cache
    })

    const day1 = (every as any).day
    const day2 = (every as any).day
    expect(day1).toBe(day2)
  })
})

// ============================================================================
// createEntityAccessProxy Tests
// ============================================================================

describe('createEntityAccessProxy', () => {
  it('should support $.EntityType("id").method() pattern', async () => {
    const invocations: Array<{ entity: string; id: string; method: string[]; args: unknown[] }> = []

    const $ = createEntityAccessProxy({
      invoke: async (entityType, id, methodPath, args) => {
        invocations.push({ entity: entityType, id, method: methodPath, args })
        return { success: true }
      }
    })

    await ($ as any).Customer('cust-123').getProfile()
    await ($ as any).Order('order-456').ship({ carrier: 'FedEx' })

    expect(invocations).toEqual([
      { entity: 'Customer', id: 'cust-123', method: ['getProfile'], args: [] },
      { entity: 'Order', id: 'order-456', method: ['ship'], args: [{ carrier: 'FedEx' }] }
    ])
  })

  it('should support nested method paths', async () => {
    const invocations: Array<{ entity: string; id: string; method: string[] }> = []

    const $ = createEntityAccessProxy({
      invoke: async (entityType, id, methodPath) => {
        invocations.push({ entity: entityType, id, method: methodPath })
        return {}
      }
    })

    await ($ as any).Cart('cart-789').items.list()

    expect(invocations[0]).toEqual({
      entity: 'Cart',
      id: 'cart-789',
      method: ['items', 'list']
    })
  })

  it('should NOT cache entity-bound proxies (IDs are dynamic)', () => {
    const $ = createEntityAccessProxy({
      invoke: async () => ({})
    })

    const user1 = ($ as any).User('user-1')
    const user2 = ($ as any).User('user-2')

    // These should be different instances
    expect(user1).not.toBe(user2)
  })

  it('should cache entity accessors when cache is provided', () => {
    const cache = new Map<string, unknown>()

    const $ = createEntityAccessProxy({
      invoke: async () => ({}),
      cache
    })

    // The accessor function should be cached
    const userAccessor1 = ($ as any).User
    const userAccessor2 = ($ as any).User
    expect(userAccessor1).toBe(userAccessor2)
  })
})

// ============================================================================
// Existing utilities tests (ensure no regressions)
// ============================================================================

describe('createNestedProxy (existing utility)', () => {
  it('should create a two-level proxy', () => {
    const results: string[] = []

    const proxy = createNestedProxy<{
      [noun: string]: { [verb: string]: () => void }
    }>((noun, verb) => {
      return () => results.push(`${noun}.${verb}`)
    })

    ;(proxy as any).Customer.signup()
    ;(proxy as any).Order.placed()

    expect(results).toEqual(['Customer.signup', 'Order.placed'])
  })
})

describe('createMethodProxy (existing utility)', () => {
  it('should forward method calls to invoke function', async () => {
    const invocations: Array<{ method: string; args: unknown[] }> = []

    const proxy = createMethodProxy<{
      greet(name: string): Promise<string>
    }>(async (method, args) => {
      invocations.push({ method, args })
      if (method === 'greet') return `Hello, ${args[0]}!`
      return null
    })

    const greeting = await proxy.greet('World')

    expect(greeting).toBe('Hello, World!')
    expect(invocations).toEqual([{ method: 'greet', args: ['World'] }])
  })

  it('should not be thenable', () => {
    const proxy = createMethodProxy(async () => 'result')

    expect((proxy as any).then).toBeUndefined()
    expect((proxy as any).catch).toBeUndefined()
    expect((proxy as any).finally).toBeUndefined()
  })
})

describe('PROMISE_PROPS constant', () => {
  it('should contain then, catch, finally', () => {
    expect(PROMISE_PROPS.has('then')).toBe(true)
    expect(PROMISE_PROPS.has('catch')).toBe(true)
    expect(PROMISE_PROPS.has('finally')).toBe(true)
    expect(PROMISE_PROPS.has('other')).toBe(false)
  })
})
