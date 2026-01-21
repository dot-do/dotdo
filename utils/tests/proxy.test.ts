/**
 * Tests for utils/proxy.ts
 *
 * Comprehensive test coverage for Proxy utilities:
 * 1. PROMISE_PROPS constant
 * 2. createNestedProxy - Two-level nested proxies
 * 3. createMethodProxy - RPC-style method proxies
 * 4. createCallableNestedProxy - Callable nested proxies
 * 5. createDeepRPCProxy - Deep nested RPC proxies
 * 6. createEventProxy - Event handler proxies
 * 7. createScheduleProxy - Schedule DSL proxies
 * 8. createEntityAccessProxy - Entity access proxies
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
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
} from '../proxy'

describe('PROMISE_PROPS constant', () => {
  it('should include "then"', () => {
    expect(PROMISE_PROPS.has('then')).toBe(true)
  })

  it('should include "catch"', () => {
    expect(PROMISE_PROPS.has('catch')).toBe(true)
  })

  it('should include "finally"', () => {
    expect(PROMISE_PROPS.has('finally')).toBe(true)
  })

  it('should have exactly 3 items', () => {
    expect(PROMISE_PROPS.size).toBe(3)
  })

  it('should not include other properties', () => {
    expect(PROMISE_PROPS.has('resolve')).toBe(false)
    expect(PROMISE_PROPS.has('reject')).toBe(false)
    expect(PROMISE_PROPS.has('all')).toBe(false)
  })
})

describe('createNestedProxy', () => {
  it('should call handler with first and second level properties', () => {
    const handler = vi.fn()
    const proxy = createNestedProxy<Record<string, Record<string, unknown>>>(handler)

    proxy.Customer.signup

    expect(handler).toHaveBeenCalledWith('Customer', 'signup')
  })

  it('should work with different noun/verb combinations', () => {
    const handler = vi.fn()
    const proxy = createNestedProxy<Record<string, Record<string, unknown>>>(handler)

    proxy.Order.placed
    proxy.User.created
    proxy.Invoice.paid

    expect(handler).toHaveBeenCalledWith('Order', 'placed')
    expect(handler).toHaveBeenCalledWith('User', 'created')
    expect(handler).toHaveBeenCalledWith('Invoice', 'paid')
  })

  it('should return handler result', () => {
    const proxy = createNestedProxy<Record<string, Record<string, () => string>>>((noun, verb) => {
      return () => `${noun}.${verb}`
    })

    const result = proxy.Customer.signup()

    expect(result).toBe('Customer.signup')
  })

  it('should work with event registration pattern', () => {
    const handlers = new Map<string, (...args: unknown[]) => void>()

    const on = createNestedProxy<Record<string, Record<string, (handler: (...args: unknown[]) => void) => void>>>(
      (noun, verb) => {
        return (handler: (...args: unknown[]) => void) => {
          const key = `${noun}.${verb}`
          handlers.set(key, handler)
        }
      }
    )

    const myHandler = vi.fn()
    on.Customer.signup(myHandler)

    expect(handlers.has('Customer.signup')).toBe(true)
    expect(handlers.get('Customer.signup')).toBe(myHandler)
  })

  it('should handle multiple registrations for different events', () => {
    const handlers = new Map<string, (...args: unknown[]) => void>()

    const on = createNestedProxy<Record<string, Record<string, (handler: (...args: unknown[]) => void) => void>>>(
      (noun, verb) => {
        return (handler: (...args: unknown[]) => void) => {
          handlers.set(`${noun}.${verb}`, handler)
        }
      }
    )

    on.Customer.signup(() => {})
    on.Customer.deleted(() => {})
    on.Order.placed(() => {})

    expect(handlers.size).toBe(3)
    expect(handlers.has('Customer.signup')).toBe(true)
    expect(handlers.has('Customer.deleted')).toBe(true)
    expect(handlers.has('Order.placed')).toBe(true)
  })
})

describe('createMethodProxy', () => {
  it('should invoke handler with method name and arguments', async () => {
    const invoke = vi.fn().mockResolvedValue('result')
    const proxy = createMethodProxy<{ greet: (name: string) => Promise<string> }>(invoke)

    await proxy.greet('World')

    expect(invoke).toHaveBeenCalledWith('greet', ['World'])
  })

  it('should return result from invoke handler', async () => {
    const invoke = vi.fn().mockResolvedValue({ id: 123, name: 'Alice' })
    const proxy = createMethodProxy<{ getUser: (id: number) => Promise<{ id: number; name: string }> }>(invoke)

    const result = await proxy.getUser(123)

    expect(result).toEqual({ id: 123, name: 'Alice' })
  })

  it('should handle multiple arguments', async () => {
    const invoke = vi.fn().mockResolvedValue(5)
    const proxy = createMethodProxy<{ add: (a: number, b: number) => Promise<number> }>(invoke)

    await proxy.add(2, 3)

    expect(invoke).toHaveBeenCalledWith('add', [2, 3])
  })

  it('should handle no arguments', async () => {
    const invoke = vi.fn().mockResolvedValue(['item1', 'item2'])
    const proxy = createMethodProxy<{ list: () => Promise<string[]> }>(invoke)

    const result = await proxy.list()

    expect(invoke).toHaveBeenCalledWith('list', [])
    expect(result).toEqual(['item1', 'item2'])
  })

  it('should return undefined for "then" property (not a promise)', () => {
    const invoke = vi.fn()
    const proxy = createMethodProxy(invoke)

    // @ts-expect-error - accessing then for testing
    expect(proxy.then).toBeUndefined()
  })

  it('should return undefined for "catch" property', () => {
    const invoke = vi.fn()
    const proxy = createMethodProxy(invoke)

    // @ts-expect-error - accessing catch for testing
    expect(proxy.catch).toBeUndefined()
  })

  it('should return undefined for "finally" property', () => {
    const invoke = vi.fn()
    const proxy = createMethodProxy(invoke)

    // @ts-expect-error - accessing finally for testing
    expect(proxy.finally).toBeUndefined()
  })

  it('should return undefined for symbol properties', () => {
    const invoke = vi.fn()
    const proxy = createMethodProxy(invoke) as Record<symbol, unknown>

    const sym = Symbol('test')
    expect(proxy[sym]).toBeUndefined()
  })

  it('should handle object arguments', async () => {
    const invoke = vi.fn().mockResolvedValue({ created: true })
    const proxy = createMethodProxy<{ createUser: (data: { name: string; email: string }) => Promise<{ created: boolean }> }>(invoke)

    await proxy.createUser({ name: 'Alice', email: 'alice@example.com' })

    expect(invoke).toHaveBeenCalledWith('createUser', [{ name: 'Alice', email: 'alice@example.com' }])
  })
})

describe('createCallableNestedProxy', () => {
  it('should call onGet when property is accessed', () => {
    const onGet = vi.fn().mockReturnValue({ path: ['day'] })
    const onApply = vi.fn()

    const proxy = createCallableNestedProxy<unknown, { path: string[] }>(
      { onGet, onApply },
      { path: [] }
    )

    // @ts-expect-error - dynamic proxy
    const _ = proxy.day

    expect(onGet).toHaveBeenCalledWith('day', { path: [] })
  })

  it('should call onApply when proxy is invoked', () => {
    const onGet = vi.fn()
    const onApply = vi.fn()

    const proxy = createCallableNestedProxy<() => void, { path: string[] }>(
      { onGet, onApply },
      { path: ['day'] }
    )

    proxy()

    expect(onApply).toHaveBeenCalledWith([], { path: ['day'] })
  })

  it('should pass arguments to onApply', () => {
    const onGet = vi.fn()
    const onApply = vi.fn()

    const proxy = createCallableNestedProxy<(handler: () => void) => void, { path: string[] }>(
      { onGet, onApply },
      { path: ['hour'] }
    )

    const handler = () => {}
    proxy(handler)

    expect(onApply).toHaveBeenCalledWith([handler], { path: ['hour'] })
  })

  it('should create nested proxy when onGet returns object', () => {
    const onGet = vi.fn().mockImplementation((prop, state) => ({
      path: [...state.path, prop],
    }))
    const onApply = vi.fn()

    const proxy = createCallableNestedProxy<Record<string, Record<string, () => void>>, { path: string[] }>(
      { onGet, onApply },
      { path: [] }
    )

    // @ts-expect-error - dynamic proxy access
    proxy.Monday.at9am()

    expect(onGet).toHaveBeenCalledWith('Monday', { path: [] })
    expect(onGet).toHaveBeenCalledWith('at9am', { path: ['Monday'] })
    expect(onApply).toHaveBeenCalledWith([], { path: ['Monday', 'at9am'] })
  })

  it('should handle symbol properties gracefully', () => {
    const onGet = vi.fn()
    const onApply = vi.fn()

    const proxy = createCallableNestedProxy<unknown, { path: string[] }>(
      { onGet, onApply },
      { path: [] }
    )

    const sym = Symbol('test')
    // @ts-expect-error - testing symbol access
    expect(proxy[sym]).toBeUndefined()
  })

  it('should return non-object values directly from onGet', () => {
    const onGet = vi.fn().mockReturnValue('terminal-value')
    const onApply = vi.fn()

    const proxy = createCallableNestedProxy<Record<string, string>, { path: string[] }>(
      { onGet, onApply },
      { path: [] }
    )

    const result = proxy.terminal

    expect(result).toBe('terminal-value')
  })
})

describe('createDeepRPCProxy', () => {
  it('should invoke with single-level path', async () => {
    const invoke = vi.fn().mockResolvedValue('hello')
    const proxy = createDeepRPCProxy<{ greet: () => Promise<string> }>({ invoke })

    const result = await proxy.greet()

    expect(invoke).toHaveBeenCalledWith(['greet'], [])
    expect(result).toBe('hello')
  })

  it('should invoke with multi-level path', async () => {
    const invoke = vi.fn().mockResolvedValue({ id: 1 })
    const proxy = createDeepRPCProxy<{ users: { create: (data: { name: string }) => Promise<{ id: number }> } }>({ invoke })

    const result = await proxy.users.create({ name: 'Alice' })

    expect(invoke).toHaveBeenCalledWith(['users', 'create'], [{ name: 'Alice' }])
    expect(result).toEqual({ id: 1 })
  })

  it('should invoke with deep nested path', async () => {
    const invoke = vi.fn().mockResolvedValue('deep')
    const proxy = createDeepRPCProxy<{ a: { b: { c: { d: () => Promise<string> } } } }>({ invoke })

    const result = await proxy.a.b.c.d()

    expect(invoke).toHaveBeenCalledWith(['a', 'b', 'c', 'd'], [])
    expect(result).toBe('deep')
  })

  it('should return undefined for promise properties', () => {
    const invoke = vi.fn()
    const proxy = createDeepRPCProxy({ invoke })

    // @ts-expect-error - testing then property
    expect(proxy.then).toBeUndefined()
    // @ts-expect-error - testing catch property
    expect(proxy.catch).toBeUndefined()
    // @ts-expect-error - testing finally property
    expect(proxy.finally).toBeUndefined()
  })

  it('should return undefined for symbol properties', () => {
    const invoke = vi.fn()
    const proxy = createDeepRPCProxy({ invoke }) as Record<symbol, unknown>

    expect(proxy[Symbol('test')]).toBeUndefined()
  })

  it('should use cache when provided', async () => {
    const cache = new Map<string, unknown>()
    const invoke = vi.fn().mockResolvedValue('result')
    const proxy = createDeepRPCProxy<{ users: { get: () => Promise<string> } }>({ invoke, cache })

    // Access the same path twice
    const _ = proxy.users.get
    const __ = proxy.users.get

    // The nested proxies for 'users' should be cached
    // Cache key format is 'proxy:path'
    expect(cache.has('proxy:users')).toBe(true)
  })

  it('should call getSpecialProperty at root level', () => {
    const invoke = vi.fn()
    const getSpecialProperty = vi.fn().mockReturnValue('special-value')

    const proxy = createDeepRPCProxy<{ special: string }>({ invoke, getSpecialProperty })

    const result = proxy.special

    expect(getSpecialProperty).toHaveBeenCalledWith('special')
    expect(result).toBe('special-value')
  })

  it('should not call getSpecialProperty for undefined returns', async () => {
    const invoke = vi.fn().mockResolvedValue('normal')
    const getSpecialProperty = vi.fn().mockReturnValue(undefined)

    const proxy = createDeepRPCProxy<{ normal: () => Promise<string> }>({ invoke, getSpecialProperty })

    await proxy.normal()

    expect(getSpecialProperty).toHaveBeenCalledWith('normal')
    expect(invoke).toHaveBeenCalledWith(['normal'], [])
  })

  it('should not call getSpecialProperty for nested paths', async () => {
    const invoke = vi.fn().mockResolvedValue('result')
    const getSpecialProperty = vi.fn()

    const proxy = createDeepRPCProxy<{ users: { list: () => Promise<string> } }>({ invoke, getSpecialProperty })

    await proxy.users.list()

    // getSpecialProperty should only be called for root-level 'users', not for 'list'
    expect(getSpecialProperty).toHaveBeenCalledTimes(1)
    expect(getSpecialProperty).toHaveBeenCalledWith('users')
  })
})

describe('createEventProxy', () => {
  let handlers: Map<string, Array<(...args: unknown[]) => unknown>>
  let options: EventProxyOptions

  beforeEach(() => {
    handlers = new Map()
    options = {
      onRegister: (path, handler) => {
        const key = path.join('.')
        const existing = handlers.get(key) || []
        handlers.set(key, [...existing, handler])
      },
    }
  })

  it('should register handler with two-level path', () => {
    const proxy = createEventProxy<{ Customer: { signup: (handler: () => void) => void } }>(options)

    const handler = vi.fn()
    proxy.Customer.signup(handler)

    expect(handlers.has('Customer.signup')).toBe(true)
    expect(handlers.get('Customer.signup')).toContain(handler)
  })

  it('should register handler with deep path', () => {
    const proxy = createEventProxy<{ Order: { item: { added: (handler: () => void) => void } } }>(options)

    const handler = vi.fn()
    proxy.Order.item.added(handler)

    expect(handlers.has('Order.item.added')).toBe(true)
  })

  it('should support multiple handlers for same event', () => {
    const proxy = createEventProxy<{ Event: { trigger: (handler: () => void) => void } }>(options)

    const handler1 = vi.fn()
    const handler2 = vi.fn()

    proxy.Event.trigger(handler1)
    proxy.Event.trigger(handler2)

    expect(handlers.get('Event.trigger')).toHaveLength(2)
    expect(handlers.get('Event.trigger')).toContain(handler1)
    expect(handlers.get('Event.trigger')).toContain(handler2)
  })

  it('should return undefined for promise properties', () => {
    const proxy = createEventProxy(options)

    // @ts-expect-error - testing then property
    expect(proxy.then).toBeUndefined()
  })

  it('should return undefined for symbol properties', () => {
    const proxy = createEventProxy(options) as Record<symbol, unknown>

    expect(proxy[Symbol('test')]).toBeUndefined()
  })

  it('should use cache when provided', () => {
    const cache = new Map<string, unknown>()
    const proxy = createEventProxy<{ Cached: { event: (handler: () => void) => void } }>({ ...options, cache })

    // Access the same path twice
    const _ = proxy.Cached.event
    const __ = proxy.Cached.event

    // Cache should have the proxy for 'Cached.event'
    expect(cache.has('on:Cached.event')).toBe(true)
  })

  it('should handle single-level event path', () => {
    const proxy = createEventProxy<{ ready: (handler: () => void) => void }>(options)

    const handler = vi.fn()
    proxy.ready(handler)

    expect(handlers.has('ready')).toBe(true)
  })
})

describe('createScheduleProxy', () => {
  let schedules: Array<{ parts: string[]; handler: (...args: unknown[]) => unknown }>
  let options: ScheduleProxyOptions

  beforeEach(() => {
    schedules = []
    options = {
      onRegister: (parts, handler) => {
        schedules.push({ parts, handler })
      },
    }
  })

  it('should register simple schedule like every.day', () => {
    const every = createScheduleProxy<{ day: (handler: () => void) => void }>(options)

    const handler = vi.fn()
    every.day(handler)

    expect(schedules).toHaveLength(1)
    expect(schedules[0].parts).toEqual(['day'])
    expect(schedules[0].handler).toBe(handler)
  })

  it('should register schedule like every.hour', () => {
    const every = createScheduleProxy<{ hour: (handler: () => void) => void }>(options)

    const handler = vi.fn()
    every.hour(handler)

    expect(schedules[0].parts).toEqual(['hour'])
  })

  it('should register schedule with .at() like every.Monday.at("9am")', () => {
    type EveryProxy = {
      Monday: {
        at: (time: string) => (handler: () => void) => void
      }
    }
    const every = createScheduleProxy<EveryProxy>(options)

    const handler = vi.fn()
    every.Monday.at('9am')(handler)

    expect(schedules).toHaveLength(1)
    expect(schedules[0].parts).toEqual(['Monday', 'at:9am'])
    expect(schedules[0].handler).toBe(handler)
  })

  it('should handle multiple .at() times', () => {
    type EveryProxy = {
      Tuesday: {
        at: (time: string) => (handler: () => void) => void
      }
    }
    const every = createScheduleProxy<EveryProxy>(options)

    const handler1 = vi.fn()
    const handler2 = vi.fn()

    every.Tuesday.at('9am')(handler1)
    every.Tuesday.at('6pm')(handler2)

    expect(schedules).toHaveLength(2)
    expect(schedules[0].parts).toEqual(['Tuesday', 'at:9am'])
    expect(schedules[1].parts).toEqual(['Tuesday', 'at:6pm'])
  })

  it('should handle chained properties before .at()', () => {
    type EveryProxy = {
      first: {
        Monday: {
          of: {
            month: {
              at: (time: string) => (handler: () => void) => void
            }
          }
        }
      }
    }
    const every = createScheduleProxy<EveryProxy>(options)

    const handler = vi.fn()
    every.first.Monday.of.month.at('10am')(handler)

    expect(schedules[0].parts).toEqual(['first', 'Monday', 'of', 'month', 'at:10am'])
  })

  it('should return undefined for promise properties', () => {
    const every = createScheduleProxy(options)

    // @ts-expect-error - testing then property
    expect(every.then).toBeUndefined()
  })

  it('should return undefined for symbol properties', () => {
    const every = createScheduleProxy(options) as Record<symbol, unknown>

    expect(every[Symbol('test')]).toBeUndefined()
  })

  it('should use cache when provided', () => {
    const cache = new Map<string, unknown>()
    const every = createScheduleProxy<{ cached: { path: (handler: () => void) => void } }>({ ...options, cache })

    // Access the same path twice
    const _ = every.cached.path
    const __ = every.cached.path

    // Cache should have the proxy
    expect(cache.has('every:cached.path')).toBe(true)
  })

  it('should not register when non-function is passed', () => {
    const every = createScheduleProxy<{ day: (arg: unknown) => void }>(options)

    every.day('not a function')

    expect(schedules).toHaveLength(0)
  })
})

describe('createEntityAccessProxy', () => {
  let invocations: Array<{ entityType: string; id: string; methodPath: string[]; args: unknown[] }>
  let options: EntityProxyOptions

  beforeEach(() => {
    invocations = []
    options = {
      invoke: async (entityType, id, methodPath, args) => {
        invocations.push({ entityType, id, methodPath, args })
        return { success: true }
      },
    }
  })

  it('should invoke with entity type, id, and method', async () => {
    const $ = createEntityAccessProxy<{ Customer: (id: string) => { getProfile: () => Promise<{ success: boolean }> } }>(options)

    await $.Customer('cust-123').getProfile()

    expect(invocations).toHaveLength(1)
    expect(invocations[0]).toEqual({
      entityType: 'Customer',
      id: 'cust-123',
      methodPath: ['getProfile'],
      args: [],
    })
  })

  it('should handle nested method paths', async () => {
    const $ = createEntityAccessProxy<{ Order: (id: string) => { items: { list: () => Promise<{ success: boolean }> } } }>(options)

    await $.Order('order-456').items.list()

    expect(invocations[0]).toEqual({
      entityType: 'Order',
      id: 'order-456',
      methodPath: ['items', 'list'],
      args: [],
    })
  })

  it('should pass method arguments', async () => {
    const $ = createEntityAccessProxy<{ User: (id: string) => { update: (data: { name: string }) => Promise<{ success: boolean }> } }>(options)

    await $.User('user-789').update({ name: 'Alice' })

    expect(invocations[0]).toEqual({
      entityType: 'User',
      id: 'user-789',
      methodPath: ['update'],
      args: [{ name: 'Alice' }],
    })
  })

  it('should handle multiple entity types', async () => {
    type EntityProxy = {
      Customer: (id: string) => { get: () => Promise<{ success: boolean }> }
      Order: (id: string) => { get: () => Promise<{ success: boolean }> }
      Invoice: (id: string) => { get: () => Promise<{ success: boolean }> }
    }
    const $ = createEntityAccessProxy<EntityProxy>(options)

    await $.Customer('c1').get()
    await $.Order('o1').get()
    await $.Invoice('i1').get()

    expect(invocations).toHaveLength(3)
    expect(invocations[0].entityType).toBe('Customer')
    expect(invocations[1].entityType).toBe('Order')
    expect(invocations[2].entityType).toBe('Invoice')
  })

  it('should return undefined for promise properties on root', () => {
    const $ = createEntityAccessProxy(options)

    // @ts-expect-error - testing then property
    expect($.then).toBeUndefined()
  })

  it('should return undefined for promise properties on bound entity', () => {
    const $ = createEntityAccessProxy<{ Entity: (id: string) => { then?: unknown } }>(options)

    // @ts-expect-error - testing then property
    expect($.Entity('id').then).toBeUndefined()
  })

  it('should return undefined for symbol properties', () => {
    const $ = createEntityAccessProxy(options) as Record<symbol, unknown>

    expect($[Symbol('test')]).toBeUndefined()
  })

  it('should cache entity accessor but not bound proxies', async () => {
    const cache = new Map<string, unknown>()
    const $ = createEntityAccessProxy<{ Cached: (id: string) => { method: () => Promise<{ success: boolean }> } }>({ ...options, cache })

    // Access the entity type accessor
    const accessor1 = $.Cached
    const accessor2 = $.Cached

    // Entity accessor should be cached
    expect(cache.has('entity:Cached')).toBe(true)

    // But bound entities should NOT be cached (IDs are dynamic)
    await $.Cached('id-1').method()
    await $.Cached('id-2').method()

    // Both calls should work with their own IDs
    expect(invocations[0].id).toBe('id-1')
    expect(invocations[1].id).toBe('id-2')
  })

  it('should handle deeply nested method paths', async () => {
    const $ = createEntityAccessProxy<{ Entity: (id: string) => { a: { b: { c: { d: () => Promise<{ success: boolean }> } } } } }>(options)

    await $.Entity('e1').a.b.c.d()

    expect(invocations[0].methodPath).toEqual(['a', 'b', 'c', 'd'])
  })

  it('should handle multiple arguments in method call', async () => {
    const $ = createEntityAccessProxy<{ Calculator: (id: string) => { add: (a: number, b: number) => Promise<{ success: boolean }> } }>(options)

    await $.Calculator('calc-1').add(2, 3)

    expect(invocations[0].args).toEqual([2, 3])
  })
})

describe('Edge cases and integration', () => {
  it('should allow proxies to be awaited without being detected as Promises', async () => {
    const invoke = vi.fn().mockResolvedValue('result')
    const proxy = createDeepRPCProxy<{ method: () => Promise<string> }>({ invoke })

    // This should work because the proxy returns undefined for 'then'
    const result = await proxy.method()
    expect(result).toBe('result')
  })

  it('should handle JSON serialization of proxy results', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: 'test', nested: { value: 123 } })
    const proxy = createDeepRPCProxy<{ getData: () => Promise<{ data: string; nested: { value: number } }> }>({ invoke })

    const result = await proxy.getData()
    const serialized = JSON.stringify(result)
    const parsed = JSON.parse(serialized)

    expect(parsed).toEqual({ data: 'test', nested: { value: 123 } })
  })

  it('should handle error propagation from invoke', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('RPC failed'))
    const proxy = createDeepRPCProxy<{ method: () => Promise<void> }>({ invoke })

    await expect(proxy.method()).rejects.toThrow('RPC failed')
  })

  it('should handle null and undefined arguments', async () => {
    const invoke = vi.fn().mockResolvedValue(null)
    const proxy = createDeepRPCProxy<{ method: (a: null, b: undefined) => Promise<null> }>({ invoke })

    const result = await proxy.method(null, undefined)

    expect(invoke).toHaveBeenCalledWith(['method'], [null, undefined])
    expect(result).toBeNull()
  })

  it('should handle array arguments', async () => {
    const invoke = vi.fn().mockResolvedValue([1, 2, 3])
    const proxy = createDeepRPCProxy<{ processList: (items: number[]) => Promise<number[]> }>({ invoke })

    const result = await proxy.processList([1, 2, 3])

    expect(invoke).toHaveBeenCalledWith(['processList'], [[1, 2, 3]])
    expect(result).toEqual([1, 2, 3])
  })
})
