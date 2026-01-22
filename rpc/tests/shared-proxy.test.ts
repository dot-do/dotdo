/**
 * Tests for shared proxy utilities across @dotdo/rpc and rpc.do
 *
 * TDD: RED phase - Write tests verifying shared proxy utilities work for both
 * client and server patterns used in:
 * - @dotdo/rpc/client.ts (nested RPC proxies with transport)
 * - rpc.do/src/client.ts ($ proxy with event handlers, scheduling, entity access)
 *
 * These tests define the interface that the shared proxy module should support.
 */

import { describe, it, expect, vi } from 'vitest'

// Test types for proxies
type DynamicProxy = any

// ============================================================================
// Core Nested Proxy Tests (used by both packages)
// ============================================================================

describe('Shared Proxy: Core nested proxy pattern', () => {
  it('should support arbitrary depth property access with method invocation', async () => {
    const invocations: Array<{ path: string[]; args: unknown[] }> = []

    // This is the pattern both packages need: create a proxy that tracks
    // property access path and invokes a handler when called as a function
    const createRPCProxy = (
      invoke: (path: string[], args: unknown[]) => Promise<unknown>,
      path: string[] = []
    ): DynamicProxy => {
      return new Proxy(() => {}, {
        get(_, prop: string | symbol) {
          if (typeof prop === 'symbol') return undefined
          if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined
          return createRPCProxy(invoke, [...path, prop])
        },
        apply(_, __, args: unknown[]) {
          return invoke(path, args)
        }
      })
    }

    const proxy = createRPCProxy(async (path, args) => {
      invocations.push({ path, args })
      return { success: true }
    })

    await proxy.users.create({ name: 'Alice' })
    await proxy.deeply.nested.namespace.method('arg1', 'arg2')
    await proxy.simple()

    expect(invocations).toEqual([
      { path: ['users', 'create'], args: [{ name: 'Alice' }] },
      { path: ['deeply', 'nested', 'namespace', 'method'], args: ['arg1', 'arg2'] },
      { path: ['simple'], args: [] }
    ])
  })

  it('should not be thenable (prevents async/await detection issues)', () => {
    const createRPCProxy = (path: string[] = []): DynamicProxy => {
      return new Proxy(() => {}, {
        get(_, prop: string | symbol) {
          if (typeof prop === 'symbol') return undefined
          if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined
          return createRPCProxy([...path, prop as string])
        },
        apply() {
          return Promise.resolve({})
        }
      })
    }

    const proxy = createRPCProxy()
    expect(proxy.then).toBeUndefined()
    expect(proxy.catch).toBeUndefined()
    expect(proxy.finally).toBeUndefined()

    // Nested proxies should also not be thenable
    expect(proxy.nested.path.then).toBeUndefined()
  })

  it('should return undefined for symbol properties', () => {
    const createRPCProxy = (): DynamicProxy => {
      return new Proxy(() => {}, {
        get(_, prop: string | symbol) {
          if (typeof prop === 'symbol') return undefined
          return createRPCProxy()
        },
        apply() {
          return Promise.resolve({})
        }
      })
    }

    const proxy = createRPCProxy()
    expect(proxy[Symbol.iterator]).toBeUndefined()
    expect(proxy[Symbol.toStringTag]).toBeUndefined()
  })
})

// ============================================================================
// ID-Based Entity Access Pattern (rpc.do pattern)
// ============================================================================

describe('Shared Proxy: ID-based entity access', () => {
  it('should support $.EntityType("id").method() pattern', async () => {
    const invocations: Array<{ entity: string; id: string; method: string; args: unknown[] }> = []

    // Pattern: $.Customer('id').getProfile() -> Customer.getProfile with ['id'] prepended
    const createEntityProxy = (
      invoke: (entity: string, id: string, method: string, args: unknown[]) => Promise<unknown>
    ): DynamicProxy => {
      return new Proxy(() => {}, {
        get(_, entityType: string | symbol) {
          if (typeof entityType === 'symbol') return undefined
          if (entityType === 'then' || entityType === 'catch' || entityType === 'finally') return undefined

          // Return a function that takes an ID and returns a method proxy
          return (id: string) => {
            return new Proxy(() => {}, {
              get(_, method: string | symbol) {
                if (typeof method === 'symbol') return undefined
                if (method === 'then' || method === 'catch' || method === 'finally') return undefined

                return (...args: unknown[]) => invoke(entityType, id, method, args)
              }
            })
          }
        }
      })
    }

    const $ = createEntityProxy(async (entity, id, method, args) => {
      invocations.push({ entity, id, method, args })
      return { success: true }
    })

    await $.Customer('cust-123').getProfile()
    await $.Order('order-456').ship({ carrier: 'FedEx' })

    expect(invocations).toEqual([
      { entity: 'Customer', id: 'cust-123', method: 'getProfile', args: [] },
      { entity: 'Order', id: 'order-456', method: 'ship', args: [{ carrier: 'FedEx' }] }
    ])
  })

  it('should support multiple independent entity accesses', async () => {
    const calls: string[] = []

    const createEntityProxy = (
      invoke: (entity: string, id: string, method: string, args: unknown[]) => Promise<unknown>
    ): DynamicProxy => {
      return new Proxy(() => {}, {
        get(_, entityType: string | symbol) {
          if (typeof entityType === 'symbol') return undefined
          if (entityType === 'then' || entityType === 'catch' || entityType === 'finally') return undefined

          return (id: string) => {
            return new Proxy(() => {}, {
              get(_, method: string | symbol) {
                if (typeof method === 'symbol') return undefined
                if (method === 'then' || method === 'catch' || method === 'finally') return undefined

                return (...args: unknown[]) => invoke(entityType, id, method, args)
              }
            })
          }
        }
      })
    }

    const $ = createEntityProxy(async (entity, id, method) => {
      calls.push(`${entity}(${id}).${method}`)
      return {}
    })

    await $.User('user-1').get()
    await $.User('user-2').get()
    await $.Order('order-1').status()

    expect(calls).toEqual([
      'User(user-1).get',
      'User(user-2).get',
      'Order(order-1).status'
    ])
  })
})

// ============================================================================
// Event Handler Pattern ($.on.Entity.action)
// ============================================================================

describe('Shared Proxy: Event handler pattern ($.on)', () => {
  it('should support $.on.Entity.action(handler) registration', () => {
    const handlers = new Map<string, ((...args: unknown[]) => void)[]>()

    const createOnProxy = (path: string[] = []): DynamicProxy => {
      return new Proxy(() => {}, {
        get(_, prop: string | symbol) {
          if (typeof prop === 'symbol') return undefined
          if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined
          return createOnProxy([...path, prop])
        },
        apply(_, __, args: unknown[]) {
          const eventPath = path.join('.')
          const handler = args[0] as (...args: unknown[]) => void
          const existing = handlers.get(eventPath)
          if (existing) {
            existing.push(handler)
          } else {
            handlers.set(eventPath, [handler])
          }
        }
      })
    }

    const on = createOnProxy()

    const customerHandler = vi.fn()
    const orderHandler = vi.fn()

    on.Customer.signup(customerHandler)
    on.Order.placed(orderHandler)
    on.Customer.signup(vi.fn()) // Multiple handlers for same event

    expect(handlers.get('Customer.signup')).toHaveLength(2)
    expect(handlers.get('Order.placed')).toHaveLength(1)
  })

  it('should support deeply nested event paths', () => {
    const handlers = new Map<string, unknown>()

    const createOnProxy = (path: string[] = []): DynamicProxy => {
      return new Proxy(() => {}, {
        get(_, prop: string | symbol) {
          if (typeof prop === 'symbol') return undefined
          if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined
          return createOnProxy([...path, prop])
        },
        apply(_, __, args: unknown[]) {
          handlers.set(path.join('.'), args[0])
        }
      })
    }

    const on = createOnProxy()

    on.Order.item.added(vi.fn())
    on.Payment.status.changed(vi.fn())

    expect(handlers.has('Order.item.added')).toBe(true)
    expect(handlers.has('Payment.status.changed')).toBe(true)
  })
})

// ============================================================================
// Schedule DSL Pattern ($.every)
// ============================================================================

describe('Shared Proxy: Schedule DSL pattern ($.every)', () => {
  it('should support $.every.day(handler) pattern', () => {
    const schedules: Array<{ parts: string[]; handler: () => void }> = []

    const createScheduleProxy = (parts: string[] = []): DynamicProxy => {
      const builder = function(arg: unknown) {
        if (typeof arg === 'function') {
          schedules.push({ parts, handler: arg as () => void })
        }
      }

      return new Proxy(builder, {
        get(_, prop: string | symbol) {
          if (typeof prop === 'symbol') return undefined
          if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined
          return createScheduleProxy([...parts, prop as string])
        },
        apply(target, _, args) {
          return target(args[0])
        }
      })
    }

    const every = createScheduleProxy()

    const handler1 = vi.fn()
    const handler2 = vi.fn()

    every.day(handler1)
    every.hour(handler2)

    expect(schedules).toHaveLength(2)
    expect(schedules[0].parts).toEqual(['day'])
    expect(schedules[1].parts).toEqual(['hour'])
  })

  it('should support $.every.Monday.at("9am")(handler) chained pattern', () => {
    const schedules: Array<{ parts: string[]; handler: () => void }> = []

    const createScheduleProxy = (parts: string[] = []): DynamicProxy => {
      const builder = function(arg: unknown) {
        if (typeof arg === 'function') {
          schedules.push({ parts, handler: arg as () => void })
        }
      }

      return new Proxy(builder, {
        get(_, prop: string | symbol) {
          if (typeof prop === 'symbol') return undefined
          if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined

          if (prop === 'at') {
            return (time: string) => {
              const newParts = [...parts, `at:${time}`]
              // Return a callable that registers the handler
              return (handler: () => void) => {
                schedules.push({ parts: newParts, handler })
              }
            }
          }

          return createScheduleProxy([...parts, prop as string])
        },
        apply(target, _, args) {
          return target(args[0])
        }
      })
    }

    const every = createScheduleProxy()

    const handler = vi.fn()
    every.Monday.at('9am')(handler)

    expect(schedules).toHaveLength(1)
    expect(schedules[0].parts).toEqual(['Monday', 'at:9am'])
  })
})

// ============================================================================
// Proxy Caching Pattern
// ============================================================================

describe('Shared Proxy: Caching behavior', () => {
  it('should return same proxy instance for same path when caching enabled', () => {
    const cache = new Map<string, unknown>()

    const createCachedProxy = (path: string[] = []): DynamicProxy => {
      const cacheKey = `proxy:${path.join('.')}`
      const cached = cache.get(cacheKey)
      if (cached !== undefined) return cached

      const proxy = new Proxy(() => {}, {
        get(_, prop: string | symbol) {
          if (typeof prop === 'symbol') return undefined
          if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined
          return createCachedProxy([...path, prop as string])
        },
        apply() {
          return Promise.resolve({})
        }
      })

      cache.set(cacheKey, proxy)
      return proxy
    }

    const root = createCachedProxy()

    // Same path should return same instance
    const users1 = root.users
    const users2 = root.users
    expect(users1).toBe(users2)

    // Nested paths should also be cached
    const create1 = root.users.create
    const create2 = root.users.create
    expect(create1).toBe(create2)
  })

  it('should NOT cache entity-bound proxies (IDs are dynamic)', () => {
    // Entity-bound proxies like $.User('id') should NOT be cached
    // because the same entity type can be called with different IDs

    const createEntityProxy = (): DynamicProxy => {
      return new Proxy(() => {}, {
        get(_, entityType: string | symbol) {
          if (typeof entityType === 'symbol') return undefined

          // Each call to EntityType(id) returns a NEW proxy
          return (id: string) => {
            return new Proxy({}, {
              get(_, method) {
                return () => Promise.resolve({ id, method })
              }
            })
          }
        }
      })
    }

    const $ = createEntityProxy()

    const user1 = $.User('user-1')
    const user2 = $.User('user-2')

    // These should be different instances
    expect(user1).not.toBe(user2)
  })
})

// ============================================================================
// Transport Integration Pattern
// ============================================================================

describe('Shared Proxy: Transport integration', () => {
  interface MockTransport {
    send: ReturnType<typeof vi.fn>
  }

  function createMockTransport(
    sendImpl?: (message: { method: string; args: unknown[] }) => Promise<{ result?: unknown; error?: { message: string } }>
  ): MockTransport {
    return {
      send: vi.fn(sendImpl ?? (() => Promise.resolve({ result: {} })))
    }
  }

  it('should forward method calls through transport', async () => {
    const transport = createMockTransport((msg) =>
      Promise.resolve({ result: { greeting: `Hello, ${msg.args[0]}!` } })
    )

    const createTransportProxy = (
      transport: MockTransport,
      path: string[] = []
    ): DynamicProxy => {
      return new Proxy(() => {}, {
        get(_, prop: string | symbol) {
          if (typeof prop === 'symbol') return undefined
          if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined
          return createTransportProxy(transport, [...path, prop as string])
        },
        async apply(_, __, args: unknown[]) {
          const response = await transport.send({
            method: path.join('.'),
            args
          })
          if (response.error) {
            throw new Error(response.error.message)
          }
          return response.result
        }
      })
    }

    const client = createTransportProxy(transport)

    const result = await client.greet('World')
    expect(result).toEqual({ greeting: 'Hello, World!' })
    expect(transport.send).toHaveBeenCalledWith({
      method: 'greet',
      args: ['World']
    })
  })

  it('should throw on error response', async () => {
    const transport = createMockTransport(() =>
      Promise.resolve({ error: { message: 'Not found' } })
    )

    const createTransportProxy = (
      transport: MockTransport,
      path: string[] = []
    ): DynamicProxy => {
      return new Proxy(() => {}, {
        get(_, prop: string | symbol) {
          if (typeof prop === 'symbol') return undefined
          if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined
          return createTransportProxy(transport, [...path, prop as string])
        },
        async apply(_, __, args: unknown[]) {
          const response = await transport.send({
            method: path.join('.'),
            args
          })
          if (response.error) {
            throw new Error(response.error.message)
          }
          return response.result
        }
      })
    }

    const client = createTransportProxy(transport)

    await expect(client.notFound()).rejects.toThrow('Not found')
  })
})

// ============================================================================
// Combined $ Proxy Pattern (full rpc.do client interface)
// ============================================================================

describe('Shared Proxy: Combined $ interface', () => {
  it('should support full $ proxy interface with on, every, and entity access', async () => {
    const handlers = new Map<string, unknown>()
    const schedules: Array<{ parts: string[]; handler: () => void }> = []
    const rpcCalls: Array<{ method: string; args: unknown[] }> = []

    // Create the full $ proxy combining all patterns
    const createFullProxy = (): DynamicProxy => {
      const createOnProxy = (path: string[] = []): DynamicProxy => {
        return new Proxy(() => {}, {
          get(_, prop: string | symbol) {
            if (typeof prop === 'symbol') return undefined
            if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined
            return createOnProxy([...path, prop as string])
          },
          apply(_, __, args) {
            handlers.set(path.join('.'), args[0])
          }
        })
      }

      const createEveryProxy = (parts: string[] = []): DynamicProxy => {
        const builder = function(arg: unknown) {
          if (typeof arg === 'function') {
            schedules.push({ parts, handler: arg as () => void })
          }
        }

        return new Proxy(builder, {
          get(_, prop: string | symbol) {
            if (typeof prop === 'symbol') return undefined
            if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined

            if (prop === 'at') {
              return (time: string) => (handler: () => void) => {
                schedules.push({ parts: [...parts, `at:${time}`], handler })
              }
            }
            return createEveryProxy([...parts, prop as string])
          },
          apply(target, _, args) {
            return target(args[0])
          }
        })
      }

      const createRPCProxy = (path: string[] = [], boundId?: string): DynamicProxy => {
        return new Proxy(() => {}, {
          get(_, prop: string | symbol) {
            if (typeof prop === 'symbol') return undefined
            if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined
            if (prop === 'on') return createOnProxy()
            if (prop === 'every') return createEveryProxy()
            return createRPCProxy([...path, prop as string], boundId)
          },
          apply(_, __, args) {
            // Check if this is an ID-binding call
            if (path.length === 1 && args.length === 1 && typeof args[0] === 'string') {
              return createRPCProxy(path, args[0])
            }

            // Otherwise, invoke RPC
            const method = path.join('.')
            const params = boundId !== undefined ? [boundId, ...args] : args
            rpcCalls.push({ method, args: params })
            return Promise.resolve({ success: true })
          }
        })
      }

      return createRPCProxy()
    }

    const $ = createFullProxy()

    // Test event handler
    $.on.Customer.signup(vi.fn())
    expect(handlers.has('Customer.signup')).toBe(true)

    // Test scheduling
    $.every.Monday.at('9am')(vi.fn())
    expect(schedules[0].parts).toEqual(['Monday', 'at:9am'])

    // Test entity access
    await $.User('user-123').getProfile()
    expect(rpcCalls).toContainEqual({ method: 'User.getProfile', args: ['user-123'] })

    // Test regular RPC
    await $.things.create({ $type: 'Widget' })
    expect(rpcCalls).toContainEqual({ method: 'things.create', args: [{ $type: 'Widget' }] })
  })
})
