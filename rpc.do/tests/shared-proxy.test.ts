/**
 * Shared Proxy Utilities Tests - TDD for rpc.do
 *
 * Tests for the shared proxy utilities from @dotdo/do/utils/proxy
 * These utilities are used by both rpc.do (client-side) and @dotdo/rpc (server-side)
 * for consistent proxy behavior across the codebase.
 *
 * @module rpc.do/tests/shared-proxy
 */

import { describe, it, expect, vi } from 'vitest'

// Import shared proxy utilities from @dotdo/do/utils/proxy
import {
  PROMISE_PROPS,
  createNestedProxy,
  createMethodProxy,
  createCallableNestedProxy,
  createDeepRPCProxy,
  createEventProxy,
  createScheduleProxy,
  createEntityAccessProxy,
  type DeepRPCProxyOptions,
  type EventProxyOptions,
  type ScheduleProxyOptions,
  type EntityProxyOptions,
} from '../../do/utils/proxy'

// ============================================================================
// PROMISE_PROPS Tests
// ============================================================================

describe('PROMISE_PROPS', () => {
  it('contains "then", "catch", and "finally"', () => {
    expect(PROMISE_PROPS.has('then')).toBe(true)
    expect(PROMISE_PROPS.has('catch')).toBe(true)
    expect(PROMISE_PROPS.has('finally')).toBe(true)
  })

  it('does not contain other properties', () => {
    expect(PROMISE_PROPS.has('resolve')).toBe(false)
    expect(PROMISE_PROPS.has('reject')).toBe(false)
    expect(PROMISE_PROPS.has('all')).toBe(false)
    expect(PROMISE_PROPS.has('race')).toBe(false)
  })

  it('has exactly 3 entries', () => {
    expect(PROMISE_PROPS.size).toBe(3)
  })
})

// ============================================================================
// createNestedProxy Tests
// ============================================================================

describe('createNestedProxy', () => {
  it('creates two-level proxy for $.on.Noun.verb() pattern', () => {
    const handler = vi.fn().mockReturnValue('handler-result')
    const proxy = createNestedProxy((noun, verb) => handler(noun, verb))

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (proxy as any).Customer.signup

    expect(result).toBe('handler-result')
    expect(handler).toHaveBeenCalledWith('Customer', 'signup')
  })

  it('supports multiple different noun-verb combinations', () => {
    const calls: Array<[string, string]> = []
    const proxy = createNestedProxy((noun, verb) => {
      calls.push([noun, verb])
      return `${noun}.${verb}`
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = proxy as any

    expect(p.Order.placed).toBe('Order.placed')
    expect(p.User.created).toBe('User.created')
    expect(p.Payment.processed).toBe('Payment.processed')

    expect(calls).toEqual([
      ['Order', 'placed'],
      ['User', 'created'],
      ['Payment', 'processed'],
    ])
  })

  it('returns handler result which can be a function', () => {
    const callbackFn = vi.fn()
    const proxy = createNestedProxy((_noun, _verb) => callbackFn)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (proxy as any).Entity.action
    expect(result).toBe(callbackFn)
  })
})

// ============================================================================
// createMethodProxy Tests
// ============================================================================

describe('createMethodProxy', () => {
  it('intercepts method calls and forwards to handler', async () => {
    const invoke = vi.fn().mockResolvedValue({ result: 'success' })
    const proxy = createMethodProxy(invoke)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (proxy as any).greet('World')

    expect(result).toEqual({ result: 'success' })
    expect(invoke).toHaveBeenCalledWith('greet', ['World'])
  })

  it('handles methods with multiple arguments', async () => {
    const invoke = vi.fn().mockResolvedValue({ sum: 6 })
    const proxy = createMethodProxy(invoke)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (proxy as any).add(1, 2, 3)

    expect(invoke).toHaveBeenCalledWith('add', [1, 2, 3])
  })

  it('handles methods with no arguments', async () => {
    const invoke = vi.fn().mockResolvedValue({ status: 'ok' })
    const proxy = createMethodProxy(invoke)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (proxy as any).getStatus()

    expect(invoke).toHaveBeenCalledWith('getStatus', [])
  })

  it('returns undefined for promise properties (not thenable)', () => {
    const invoke = vi.fn()
    const proxy = createMethodProxy(invoke)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = proxy as any

    expect(p.then).toBeUndefined()
    expect(p.catch).toBeUndefined()
    expect(p.finally).toBeUndefined()
  })

  it('returns undefined for symbol properties', () => {
    const invoke = vi.fn()
    const proxy = createMethodProxy(invoke)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = proxy as any

    expect(p[Symbol.iterator]).toBeUndefined()
    expect(p[Symbol.toStringTag]).toBeUndefined()
  })
})

// ============================================================================
// createCallableNestedProxy Tests
// ============================================================================

describe('createCallableNestedProxy', () => {
  it('supports property access building state', () => {
    interface State {
      path: string[]
    }

    const onGetCalls: Array<{ prop: string; state: State }> = []
    const proxy = createCallableNestedProxy<unknown, State>(
      {
        onGet: (prop, state) => {
          onGetCalls.push({ prop, state })
          return { path: [...state.path, prop] }
        },
        onApply: () => undefined,
      },
      { path: [] }
    )

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const _ = (proxy as any).a.b.c

    // Each property access should call onGet with accumulated state
    expect(onGetCalls[0]).toEqual({ prop: 'a', state: { path: [] } })
    expect(onGetCalls[1]).toEqual({ prop: 'b', state: { path: ['a'] } })
    expect(onGetCalls[2]).toEqual({ prop: 'c', state: { path: ['a', 'b'] } })
  })

  it('supports function invocation at any depth', () => {
    interface State {
      path: string[]
    }

    const applyCalls: Array<{ args: unknown[]; state: State }> = []
    const proxy = createCallableNestedProxy<unknown, State>(
      {
        onGet: (prop, state) => ({ path: [...state.path, prop] }),
        onApply: (args, state) => {
          applyCalls.push({ args, state })
          return `called at ${state.path.join('.')}`
        },
      },
      { path: [] }
    )

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = proxy as any

    // Call at different depths
    p('arg1')
    p.level1('arg2')
    p.level1.level2('arg3', 'arg4')

    expect(applyCalls[0]).toEqual({ args: ['arg1'], state: { path: [] } })
    expect(applyCalls[1]).toEqual({ args: ['arg2'], state: { path: ['level1'] } })
    expect(applyCalls[2]).toEqual({
      args: ['arg3', 'arg4'],
      state: { path: ['level1', 'level2'] },
    })
  })

  it('returns undefined for symbol properties', () => {
    const proxy = createCallableNestedProxy(
      {
        onGet: (_prop, state) => state,
        onApply: () => undefined,
      },
      {}
    )

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = proxy as any

    expect(p[Symbol.iterator]).toBeUndefined()
    expect(p[Symbol.toStringTag]).toBeUndefined()
  })
})

// ============================================================================
// createDeepRPCProxy Tests (Core RPC Proxy)
// ============================================================================

describe('createDeepRPCProxy', () => {
  describe('nested property access', () => {
    it('creates correct paths for nested access', async () => {
      const invoke = vi.fn().mockResolvedValue({ result: 'ok' })
      const proxy = createDeepRPCProxy({ invoke })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (proxy as any).users.create({ name: 'Alice' })

      expect(invoke).toHaveBeenCalledWith(['users', 'create'], [{ name: 'Alice' }])
    })

    it('handles deeply nested paths', async () => {
      const invoke = vi.fn().mockResolvedValue([])
      const proxy = createDeepRPCProxy({ invoke })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (proxy as any).api.v1.users.profiles.list()

      expect(invoke).toHaveBeenCalledWith(['api', 'v1', 'users', 'profiles', 'list'], [])
    })

    it('handles flat method calls', async () => {
      const invoke = vi.fn().mockResolvedValue('Hello, World!')
      const proxy = createDeepRPCProxy({ invoke })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (proxy as any).greet('World')

      expect(invoke).toHaveBeenCalledWith(['greet'], ['World'])
    })
  })

  describe('promise property interception (not thenable)', () => {
    it('returns undefined for "then"', () => {
      const invoke = vi.fn()
      const proxy = createDeepRPCProxy({ invoke })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((proxy as any).then).toBeUndefined()
    })

    it('returns undefined for "catch"', () => {
      const invoke = vi.fn()
      const proxy = createDeepRPCProxy({ invoke })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((proxy as any).catch).toBeUndefined()
    })

    it('returns undefined for "finally"', () => {
      const invoke = vi.fn()
      const proxy = createDeepRPCProxy({ invoke })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((proxy as any).finally).toBeUndefined()
    })

    it('nested proxies are also not thenable', () => {
      const invoke = vi.fn()
      const proxy = createDeepRPCProxy({ invoke })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nested = (proxy as any).users.profiles

      expect(nested.then).toBeUndefined()
      expect(nested.catch).toBeUndefined()
      expect(nested.finally).toBeUndefined()
    })
  })

  describe('proxy caching', () => {
    it('caches proxies when cache is provided', () => {
      const invoke = vi.fn()
      const cache = new Map<string, unknown>()
      const proxy = createDeepRPCProxy({ invoke, cache })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const users1 = (proxy as any).users
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const users2 = (proxy as any).users

      expect(users1).toBe(users2) // Same instance due to caching
      expect(cache.has('proxy:users')).toBe(true)
    })

    it('caches nested paths', () => {
      const invoke = vi.fn()
      const cache = new Map<string, unknown>()
      const proxy = createDeepRPCProxy({ invoke, cache })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const create1 = (proxy as any).users.create
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const create2 = (proxy as any).users.create

      expect(create1).toBe(create2)
      expect(cache.has('proxy:users.create')).toBe(true)
    })

    it('works without cache (no caching)', () => {
      const invoke = vi.fn()
      const proxy = createDeepRPCProxy({ invoke }) // No cache

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const users1 = (proxy as any).users
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const users2 = (proxy as any).users

      // Without cache, each access creates a new proxy
      // But they should still behave the same
      expect(typeof users1).toBe('function')
      expect(typeof users2).toBe('function')
    })
  })

  describe('special properties', () => {
    it('supports getSpecialProperty for custom root properties', () => {
      const invoke = vi.fn()
      const specialValue = { special: true }
      const proxy = createDeepRPCProxy({
        invoke,
        getSpecialProperty: (prop) => {
          if (prop === '$special') return specialValue
          return undefined
        },
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((proxy as any).$special).toBe(specialValue)
    })

    it('special properties only work at root level', async () => {
      const invoke = vi.fn().mockResolvedValue('from-invoke')
      const proxy = createDeepRPCProxy({
        invoke,
        getSpecialProperty: (prop) => {
          if (prop === '$special') return 'special-value'
          return undefined
        },
      })

      // At root level - special property
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((proxy as any).$special).toBe('special-value')

      // Nested - not special (becomes RPC call)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (proxy as any).nested.$special()

      expect(invoke).toHaveBeenCalledWith(['nested', '$special'], [])
    })
  })

  describe('method invocation', () => {
    it('builds correct RPC message for flat method', async () => {
      const invoke = vi.fn().mockResolvedValue({ id: '123' })
      const proxy = createDeepRPCProxy({ invoke })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (proxy as any).createUser({ name: 'Alice', email: 'alice@example.com' })

      expect(invoke).toHaveBeenCalledWith(['createUser'], [{ name: 'Alice', email: 'alice@example.com' }])
    })

    it('builds correct RPC message for nested method', async () => {
      const invoke = vi.fn().mockResolvedValue({ items: [] })
      const proxy = createDeepRPCProxy({ invoke })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (proxy as any).orders.items.list({ limit: 10 })

      expect(invoke).toHaveBeenCalledWith(['orders', 'items', 'list'], [{ limit: 10 }])
    })

    it('handles multiple arguments', async () => {
      const invoke = vi.fn().mockResolvedValue(15)
      const proxy = createDeepRPCProxy({ invoke })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (proxy as any).math.add(5, 10)

      expect(invoke).toHaveBeenCalledWith(['math', 'add'], [5, 10])
    })

    it('handles no arguments', async () => {
      const invoke = vi.fn().mockResolvedValue({ version: '1.0.0' })
      const proxy = createDeepRPCProxy({ invoke })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (proxy as any).system.getVersion()

      expect(invoke).toHaveBeenCalledWith(['system', 'getVersion'], [])
    })
  })

  describe('symbol properties', () => {
    it('returns undefined for Symbol.iterator', () => {
      const invoke = vi.fn()
      const proxy = createDeepRPCProxy({ invoke })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((proxy as any)[Symbol.iterator]).toBeUndefined()
    })

    it('returns undefined for Symbol.toStringTag', () => {
      const invoke = vi.fn()
      const proxy = createDeepRPCProxy({ invoke })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((proxy as any)[Symbol.toStringTag]).toBeUndefined()
    })
  })
})

// ============================================================================
// createEventProxy Tests ($.on.Entity.action pattern)
// ============================================================================

describe('createEventProxy', () => {
  it('registers handler for event path', () => {
    const registrations: Array<{ path: string[]; handler: unknown }> = []
    const proxy = createEventProxy({
      onRegister: (path, handler) => {
        registrations.push({ path, handler })
      },
    })

    const handler = vi.fn()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(proxy as any).Customer.signup(handler)

    expect(registrations).toHaveLength(1)
    expect(registrations[0]).toEqual({
      path: ['Customer', 'signup'],
      handler,
    })
  })

  it('supports deeply nested event paths', () => {
    const registrations: Array<{ path: string[] }> = []
    const proxy = createEventProxy({
      onRegister: (path, _handler) => {
        registrations.push({ path })
      },
    })

    const handler = vi.fn()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(proxy as any).Order.item.quantity.changed(handler)

    expect(registrations[0]?.path).toEqual(['Order', 'item', 'quantity', 'changed'])
  })

  it('caches proxies when cache is provided', () => {
    const cache = new Map<string, unknown>()
    const proxy = createEventProxy({
      onRegister: () => {},
      cache,
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const customer1 = (proxy as any).Customer
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const customer2 = (proxy as any).Customer

    expect(customer1).toBe(customer2)
    expect(cache.has('on:Customer')).toBe(true)
  })

  it('returns undefined for promise properties', () => {
    const proxy = createEventProxy({
      onRegister: () => {},
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = proxy as any

    expect(p.then).toBeUndefined()
    expect(p.catch).toBeUndefined()
    expect(p.finally).toBeUndefined()
  })

  it('returns undefined for symbol properties', () => {
    const proxy = createEventProxy({
      onRegister: () => {},
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = proxy as any

    expect(p[Symbol.iterator]).toBeUndefined()
  })
})

// ============================================================================
// createScheduleProxy Tests ($.every.Monday.at('9am') pattern)
// ============================================================================

describe('createScheduleProxy', () => {
  it('registers handler for simple schedule', () => {
    const registrations: Array<{ parts: string[] }> = []
    const proxy = createScheduleProxy({
      onRegister: (parts, _handler) => {
        registrations.push({ parts })
      },
    })

    const handler = vi.fn()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(proxy as any).day(handler)

    expect(registrations[0]?.parts).toEqual(['day'])
  })

  it('registers handler for chained schedule', () => {
    const registrations: Array<{ parts: string[] }> = []
    const proxy = createScheduleProxy({
      onRegister: (parts, _handler) => {
        registrations.push({ parts })
      },
    })

    const handler = vi.fn()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(proxy as any).Monday(handler)

    expect(registrations[0]?.parts).toEqual(['Monday'])
  })

  it('supports .at() for time specification', () => {
    const registrations: Array<{ parts: string[] }> = []
    const proxy = createScheduleProxy({
      onRegister: (parts, _handler) => {
        registrations.push({ parts })
      },
    })

    const handler = vi.fn()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(proxy as any).Monday.at('9am')(handler)

    expect(registrations[0]?.parts).toEqual(['Monday', 'at:9am'])
  })

  it('supports complex schedule patterns', () => {
    const registrations: Array<{ parts: string[] }> = []
    const proxy = createScheduleProxy({
      onRegister: (parts, _handler) => {
        registrations.push({ parts })
      },
    })

    const handler = vi.fn()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(proxy as any).every.first.monday.of.month(handler)

    expect(registrations[0]?.parts).toEqual(['every', 'first', 'monday', 'of', 'month'])
  })

  it('caches proxies when cache is provided', () => {
    const cache = new Map<string, unknown>()
    const proxy = createScheduleProxy({
      onRegister: () => {},
      cache,
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const day1 = (proxy as any).day
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const day2 = (proxy as any).day

    expect(day1).toBe(day2)
    expect(cache.has('every:day')).toBe(true)
  })

  it('returns undefined for promise properties', () => {
    const proxy = createScheduleProxy({
      onRegister: () => {},
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = proxy as any

    expect(p.then).toBeUndefined()
    expect(p.catch).toBeUndefined()
    expect(p.finally).toBeUndefined()
  })

  it('schedule is callable at any depth', () => {
    const registrations: Array<{ parts: string[] }> = []
    const proxy = createScheduleProxy({
      onRegister: (parts, _handler) => {
        registrations.push({ parts })
      },
    })

    const handler = vi.fn()

    // Call at different depths
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = proxy as any

    p.hour(handler)
    p.every.day(handler)
    p.every.week.on.monday(handler)

    expect(registrations).toHaveLength(3)
    expect(registrations[0]?.parts).toEqual(['hour'])
    expect(registrations[1]?.parts).toEqual(['every', 'day'])
    expect(registrations[2]?.parts).toEqual(['every', 'week', 'on', 'monday'])
  })
})

// ============================================================================
// createEntityAccessProxy Tests ($.Customer('id').method() pattern)
// ============================================================================

describe('createEntityAccessProxy', () => {
  it('binds entity ID for subsequent method calls', async () => {
    const invocations: Array<{
      entityType: string
      id: string
      methodPath: string[]
      args: unknown[]
    }> = []

    const proxy = createEntityAccessProxy({
      invoke: async (entityType, id, methodPath, args) => {
        invocations.push({ entityType, id, methodPath, args })
        return { result: 'ok' }
      },
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (proxy as any).Customer('cust-123').getProfile()

    expect(invocations[0]).toEqual({
      entityType: 'Customer',
      id: 'cust-123',
      methodPath: ['getProfile'],
      args: [],
    })
  })

  it('supports nested method paths on bound entity', async () => {
    const invocations: Array<{
      entityType: string
      id: string
      methodPath: string[]
    }> = []

    const proxy = createEntityAccessProxy({
      invoke: async (entityType, id, methodPath, _args) => {
        invocations.push({ entityType, id, methodPath })
        return { items: [] }
      },
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (proxy as any).Order('order-456').items.list()

    expect(invocations[0]).toEqual({
      entityType: 'Order',
      id: 'order-456',
      methodPath: ['items', 'list'],
    })
  })

  it('passes method arguments correctly', async () => {
    const invocations: Array<{ args: unknown[] }> = []

    const proxy = createEntityAccessProxy({
      invoke: async (_entityType, _id, _methodPath, args) => {
        invocations.push({ args })
        return { success: true }
      },
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (proxy as any).User('user-1').updateProfile({ name: 'Alice', age: 30 })

    expect(invocations[0]?.args).toEqual([{ name: 'Alice', age: 30 }])
  })

  it('multiple entity accesses are independent', async () => {
    const invocations: Array<{ entityType: string; id: string }> = []

    const proxy = createEntityAccessProxy({
      invoke: async (entityType, id, _methodPath, _args) => {
        invocations.push({ entityType, id })
        return {}
      },
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = proxy as any

    await p.User('user-1').get()
    await p.User('user-2').get()
    await p.Order('order-1').get()

    expect(invocations).toEqual([
      { entityType: 'User', id: 'user-1' },
      { entityType: 'User', id: 'user-2' },
      { entityType: 'Order', id: 'order-1' },
    ])
  })

  it('entity accessors are cached when cache is provided', () => {
    const cache = new Map<string, unknown>()
    const proxy = createEntityAccessProxy({
      invoke: async () => ({}),
      cache,
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Customer1 = (proxy as any).Customer
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Customer2 = (proxy as any).Customer

    expect(Customer1).toBe(Customer2)
    expect(cache.has('entity:Customer')).toBe(true)
  })

  it('entity-bound proxies are NOT cached (IDs are dynamic)', async () => {
    const cache = new Map<string, unknown>()
    const proxy = createEntityAccessProxy({
      invoke: async () => ({}),
      cache,
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = proxy as any

    const bound1 = p.User('user-1')
    const bound2 = p.User('user-1')

    // Even with the same ID, bound proxies should be different instances
    // (because IDs could be dynamic/computed)
    expect(bound1).not.toBe(bound2)
  })

  it('returns undefined for promise properties on entity accessor', () => {
    const proxy = createEntityAccessProxy({
      invoke: async () => ({}),
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = proxy as any

    expect(p.then).toBeUndefined()
    expect(p.catch).toBeUndefined()
    expect(p.finally).toBeUndefined()
  })

  it('returns undefined for promise properties on bound entity', () => {
    const proxy = createEntityAccessProxy({
      invoke: async () => ({}),
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bound = (proxy as any).User('user-1')

    expect(bound.then).toBeUndefined()
    expect(bound.catch).toBeUndefined()
    expect(bound.finally).toBeUndefined()
  })
})

// ============================================================================
// Integration Tests: Client-Side Usage Pattern
// ============================================================================

describe('client-side usage patterns', () => {
  it('works for rpc.do createClient pattern', async () => {
    // Simulate how rpc.do/src/client.ts uses createDeepRPCProxy
    const sendCalls: Array<{ method: string; args: unknown[] }> = []

    const transport = {
      send: async (message: { method: string; args: unknown[] }) => {
        sendCalls.push(message)
        return { result: { $id: 'created-123' } }
      },
    }

    // Create proxy similar to createClient
    const $ = createDeepRPCProxy({
      invoke: async (path, args) => {
        const response = await transport.send({
          method: path.join('.'),
          args,
        })
        return response.result
      },
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await ($ as any).things.create({ $type: 'Customer', name: 'Alice' })

    expect(result).toEqual({ $id: 'created-123' })
    expect(sendCalls[0]).toEqual({
      method: 'things.create',
      args: [{ $type: 'Customer', name: 'Alice' }],
    })
  })

  it('works for @dotdo/rpc createClient pattern', async () => {
    // Simulate how rpc/client.ts uses createDeepRPCProxy
    const fetchCalls: Array<{ method: string; args: unknown[] }> = []

    // Create proxy similar to createNestedProxyForFetch
    const client = createDeepRPCProxy({
      invoke: async (path, args) => {
        const method = path.join('.')
        fetchCalls.push({ method, args })
        return { greeting: `Hello, ${args[0]}!` }
      },
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (client as any).greet('World')

    expect(result).toEqual({ greeting: 'Hello, World!' })
    expect(fetchCalls[0]).toEqual({
      method: 'greet',
      args: ['World'],
    })
  })
})

// ============================================================================
// Integration Tests: Combined Proxy Patterns
// ============================================================================

describe('combined proxy patterns', () => {
  it('supports full $ context DSL', async () => {
    // Simulate the complete $ context with all proxy types
    const handlers = new Map<string, Function[]>()
    const schedules: Array<{ parts: string[]; handler: Function }> = []
    const rpcCalls: Array<{ path: string[]; args: unknown[] }> = []

    const cache = new Map<string, unknown>()

    // Create event proxy for $.on
    const onProxy = createEventProxy({
      onRegister: (path, handler) => {
        const key = path.join('.')
        const existing = handlers.get(key) || []
        handlers.set(key, [...existing, handler])
      },
      cache,
    })

    // Create schedule proxy for $.every
    const everyProxy = createScheduleProxy({
      onRegister: (parts, handler) => {
        schedules.push({ parts, handler })
      },
      cache,
    })

    // Create RPC proxy for method calls
    const rpcProxy = createDeepRPCProxy({
      invoke: async (path, args) => {
        rpcCalls.push({ path, args })
        return { result: 'ok' }
      },
      cache,
      getSpecialProperty: (prop) => {
        if (prop === 'on') return onProxy
        if (prop === 'every') return everyProxy
        return undefined
      },
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const $ = rpcProxy as any

    // Test $.on.Customer.signup
    const signupHandler = vi.fn()
    $.on.Customer.signup(signupHandler)
    expect(handlers.get('Customer.signup')).toContain(signupHandler)

    // Test $.every.day
    const dailyHandler = vi.fn()
    $.every.day(dailyHandler)
    expect(schedules[0]?.parts).toEqual(['day'])

    // Test $.things.create
    await $.things.create({ $type: 'Order' })
    expect(rpcCalls[0]).toEqual({
      path: ['things', 'create'],
      args: [{ $type: 'Order' }],
    })
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('edge cases', () => {
  it('handles empty arguments in method calls', async () => {
    const invoke = vi.fn().mockResolvedValue({ status: 'ok' })
    const proxy = createDeepRPCProxy({ invoke })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (proxy as any).getStatus()

    expect(invoke).toHaveBeenCalledWith(['getStatus'], [])
  })

  it('handles null and undefined arguments', async () => {
    const invoke = vi.fn().mockResolvedValue({})
    const proxy = createDeepRPCProxy({ invoke })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (proxy as any).process(null, undefined, 'valid')

    expect(invoke).toHaveBeenCalledWith(['process'], [null, undefined, 'valid'])
  })

  it('handles numeric property names', async () => {
    const invoke = vi.fn().mockResolvedValue({})
    const proxy = createDeepRPCProxy({ invoke })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (proxy as any).items[0].get()

    expect(invoke).toHaveBeenCalledWith(['items', '0', 'get'], [])
  })

  it('handles properties that look like methods but are accessed as values', () => {
    const invoke = vi.fn()
    const proxy = createDeepRPCProxy({ invoke })

    // Accessing without calling returns a proxy
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const method = (proxy as any).someMethod

    expect(typeof method).toBe('function') // It's a callable proxy
    expect(invoke).not.toHaveBeenCalled() // Not invoked yet
  })
})
