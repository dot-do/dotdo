// $ Proxy Core Implementation Tests - TDD for rpc.do
// Tests nested proxy behavior, method path construction, and special namespaces

import { describe, it, expect, vi } from 'vitest'
import type { Transport } from '../transport/types'
import type { RPCMessage, RPCResponse } from '../types'

// ============================================================================
// Helper: Create a mock transport for testing
// ============================================================================

interface MockTransport extends Transport {
  send: ReturnType<typeof vi.fn>
}

function createMockTransport(
  sendImpl?: (message: RPCMessage) => Promise<RPCResponse>
): MockTransport {
  return {
    send: vi.fn(sendImpl ?? (() => Promise.resolve({ result: {} }))),
  }
}

// RPC client returns a dynamic Proxy with arbitrary property access; `any` is unavoidable
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DynamicProxy = any

// ============================================================================
// Basic Proxy Method Invocation Tests
// ============================================================================

describe('$ Proxy core', () => {
  it('$.things.create() returns promise', async () => {
    const mockTransport = createMockTransport(() =>
      Promise.resolve({ result: { $id: '123' } })
    )
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    const result = await $.things.create({ $type: 'Customer' })
    expect(result.$id).toBe('123')
    expect(mockTransport.send).toHaveBeenCalledWith({
      method: 'things.create',
      args: [{ $type: 'Customer' }],
    })
  })

  it('$.Customer("id").getProfile() chains correctly', async () => {
    const mockTransport = createMockTransport(() =>
      Promise.resolve({ result: { name: 'Alice' } })
    )
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    const result = await $.Customer('cust-123').getProfile()
    expect(result.name).toBe('Alice')
    expect(mockTransport.send).toHaveBeenCalledWith({
      method: 'Customer.getProfile',
      args: ['cust-123'],
    })
  })

  it('$.on.Customer.signup() registers handler', async () => {
    const mockTransport = createMockTransport()
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })
    const handler = vi.fn()

    $.on.Customer.signup(handler)
    // Handler should be registered (implementation detail)
    // For now, just verify no errors are thrown and handler is captured
  })

  it('$.every.Monday.at("9am") creates schedule', async () => {
    const mockTransport = createMockTransport()
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })
    const handler = vi.fn()

    const schedule = $.every.Monday.at('9am')
    expect(typeof schedule).toBe('function')
  })

  it('nested property access builds method paths', async () => {
    const mockTransport = createMockTransport(() => Promise.resolve({ result: [] }))
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    await $.deeply.nested.namespace.method()
    expect(mockTransport.send).toHaveBeenCalledWith({
      method: 'deeply.nested.namespace.method',
      args: [],
    })
  })
})

// ============================================================================
// ID-Based Entity Access Tests
// ============================================================================

describe('$ Proxy entity access', () => {
  it('$.EntityType("id") binds ID for subsequent calls', async () => {
    const mockTransport = createMockTransport(() =>
      Promise.resolve({ result: { status: 'shipped' } })
    )
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    const result = await $.Order('order-456').getStatus()
    expect(result.status).toBe('shipped')
    expect(mockTransport.send).toHaveBeenCalledWith({
      method: 'Order.getStatus',
      args: ['order-456'],
    })
  })

  it('$.EntityType("id").nested.method() chains deeply', async () => {
    const mockTransport = createMockTransport(() =>
      Promise.resolve({ result: { items: [] } })
    )
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    await $.Cart('cart-789').items.list()
    expect(mockTransport.send).toHaveBeenCalledWith({
      method: 'Cart.items.list',
      args: ['cart-789'],
    })
  })

  it('multiple entity accesses are independent', async () => {
    const mockTransport = createMockTransport(() => Promise.resolve({ result: {} }))
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    await $.User('user-1').get()
    await $.User('user-2').get()

    expect(mockTransport.send).toHaveBeenCalledTimes(2)
    expect(mockTransport.send).toHaveBeenNthCalledWith(1, {
      method: 'User.get',
      args: ['user-1'],
    })
    expect(mockTransport.send).toHaveBeenNthCalledWith(2, {
      method: 'User.get',
      args: ['user-2'],
    })
  })
})

// ============================================================================
// Event Handler Tests ($.on namespace)
// ============================================================================

describe('$.on event handlers', () => {
  it('$.on.Entity.action() stores handler', async () => {
    const mockTransport = createMockTransport()
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })
    const handler = vi.fn()

    // Register handler - should not throw
    $.on.User.created(handler)

    // Verify handler is accessible (implementation will track these)
    expect(true).toBe(true) // Placeholder - actual verification TBD
  })

  it('$.on supports deeply nested event paths', async () => {
    const mockTransport = createMockTransport()
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })
    const handler = vi.fn()

    // Should support arbitrary nesting
    $.on.Order.item.added(handler)
    $.on.Payment.status.changed(handler)
  })
})

// ============================================================================
// Schedule DSL Tests ($.every namespace)
// ============================================================================

describe('$.every scheduling DSL', () => {
  it('$.every.day returns callable', async () => {
    const mockTransport = createMockTransport()
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    const schedule = $.every.day
    expect(typeof schedule).toBe('function')
  })

  it('$.every.hour returns callable', async () => {
    const mockTransport = createMockTransport()
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    const schedule = $.every.hour
    expect(typeof schedule).toBe('function')
  })

  it('$.every.Monday.at("9am") chains correctly', async () => {
    const mockTransport = createMockTransport()
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    const schedule = $.every.Monday.at('9am')
    expect(typeof schedule).toBe('function')

    // Calling the schedule should register the handler
    const handler = vi.fn()
    schedule(handler)
  })

  it('$.every.day.at("6pm") returns callable', async () => {
    const mockTransport = createMockTransport()
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    const schedule = $.every.day.at('6pm')
    expect(typeof schedule).toBe('function')
  })
})

// ============================================================================
// Action DSL Tests ($.send, $.try, $.do)
// ============================================================================

describe('$ action durability levels', () => {
  it('$.send(event) fires event (fire-and-forget)', async () => {
    const mockTransport = createMockTransport(() => Promise.resolve({ result: { sent: true } }))
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    await $.send({ type: 'notification', to: 'user@example.com' })
    expect(mockTransport.send).toHaveBeenCalledWith({
      method: 'send',
      args: [{ type: 'notification', to: 'user@example.com' }],
    })
  })

  it('$.try(action) attempts action once', async () => {
    const mockTransport = createMockTransport(() => Promise.resolve({ result: { tried: true } }))
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    await $.try({ action: 'process-payment' })
    expect(mockTransport.send).toHaveBeenCalledWith({
      method: 'try',
      args: [{ action: 'process-payment' }],
    })
  })

  it('$.do(action) executes durably with retries', async () => {
    const mockTransport = createMockTransport(() => Promise.resolve({ result: { done: true } }))
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    await $.do({ action: 'send-email', to: 'user@example.com' })
    expect(mockTransport.send).toHaveBeenCalledWith({
      method: 'do',
      args: [{ action: 'send-email', to: 'user@example.com' }],
    })
  })
})

// ============================================================================
// Proxy Edge Cases Tests
// ============================================================================

describe('$ Proxy edge cases', () => {
  it('proxy is not thenable (prevents auto-await issues)', async () => {
    const mockTransport = createMockTransport()
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    // then/catch/finally should be undefined to prevent Promise detection
    expect(($ as Record<string, unknown>)['then']).toBeUndefined()
    expect(($ as Record<string, unknown>)['catch']).toBeUndefined()
    expect(($ as Record<string, unknown>)['finally']).toBeUndefined()
  })

  it('nested proxies are also not thenable', async () => {
    const mockTransport = createMockTransport()
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    const nested = $.some.nested.path
    expect((nested as Record<string, unknown>)['then']).toBeUndefined()
  })

  it('symbol properties return undefined', async () => {
    const mockTransport = createMockTransport()
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    expect(($ as Record<symbol, unknown>)[Symbol.iterator]).toBeUndefined()
    expect(($ as Record<symbol, unknown>)[Symbol.toStringTag]).toBeUndefined()
  })

  it('empty method call sends empty params', async () => {
    const mockTransport = createMockTransport(() => Promise.resolve({ result: 'ok' }))
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    await $.noArgs()
    expect(mockTransport.send).toHaveBeenCalledWith({
      method: 'noArgs',
      args: [],
    })
  })

  it('multiple arguments are passed correctly', async () => {
    const mockTransport = createMockTransport(() => Promise.resolve({ result: {} }))
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    await $.math.add(1, 2, 3)
    expect(mockTransport.send).toHaveBeenCalledWith({
      method: 'math.add',
      args: [1, 2, 3],
    })
  })
})

// ============================================================================
// Proxy Caching Tests
// ============================================================================

describe('$ Proxy caching', () => {
  it('returns same proxy instance for same path', async () => {
    const mockTransport = createMockTransport()
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    // Same path should return same proxy (cached)
    const users1 = $.users
    const users2 = $.users
    expect(users1).toBe(users2)

    // Nested paths should also be cached
    const create1 = $.users.create
    const create2 = $.users.create
    expect(create1).toBe(create2)
  })

  it('entity-bound proxies are NOT cached (IDs are dynamic)', async () => {
    const mockTransport = createMockTransport(() => Promise.resolve({ result: {} }))
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    // Different IDs should return different proxy instances
    const user1 = $.User('user-1')
    const user2 = $.User('user-2')
    expect(user1).not.toBe(user2)
  })

  it('$.on namespace is cached', async () => {
    const mockTransport = createMockTransport()
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    const on1 = $.on
    const on2 = $.on
    expect(on1).toBe(on2)

    const customerOn1 = $.on.Customer
    const customerOn2 = $.on.Customer
    expect(customerOn1).toBe(customerOn2)
  })

  it('$.every namespace is cached', async () => {
    const mockTransport = createMockTransport()
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    const every1 = $.every
    const every2 = $.every
    expect(every1).toBe(every2)

    const everyDay1 = $.every.day
    const everyDay2 = $.every.day
    expect(everyDay1).toBe(everyDay2)
  })
})

// ============================================================================
// Transport Integration Tests
// ============================================================================

describe('$ Proxy with transport', () => {
  it('unwraps result from RPCResponse', async () => {
    const mockTransport = createMockTransport(() =>
      Promise.resolve({ result: { unwrapped: 'value' } })
    )
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    const result = await $.test()
    expect(result).toEqual({ unwrapped: 'value' })
  })

  it('throws on error response', async () => {
    const mockTransport = createMockTransport(() =>
      Promise.resolve({
        error: {
          type: 'NotFoundError',
          code: 'NOT_FOUND',
          message: 'Resource not found',
        },
      })
    )
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    await expect($.notFound()).rejects.toThrow('Resource not found')
  })

  it('supports multiple requests in sequence', async () => {
    let callCount = 0
    const mockTransport = createMockTransport(() => {
      callCount++
      return Promise.resolve({ result: { call: callCount } })
    })
    const { createClient } = await import('../src')

    const $: DynamicProxy = createClient('http://test', { transport: mockTransport })

    const result1 = await $.first()
    const result2 = await $.second()

    expect(result1).toEqual({ call: 1 })
    expect(result2).toEqual({ call: 2 })
  })
})
