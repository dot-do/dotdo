// RPC Client - creates typed proxy clients for remote method invocation
// Supports pluggable transports for different communication backends

import type { RPCClientOptions, RPCResponse, SerializedError } from './types'
import type { Transport } from './transport/types'
import { FetchTransport, generateCorrelationId, CORRELATION_ID_HEADER } from './transport/fetch'

/**
 * Extended options for createClient with transport support
 * When transport is provided, url becomes optional
 */
export interface CreateClientOptions {
  /** Base URL of the RPC endpoint (optional when transport is provided) */
  url?: string
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number
  /** Optional correlation ID to use for all requests */
  correlationId?: string
  /** Custom transport for RPC communication */
  transport?: Transport
}

/**
 * Context for managing event handlers, schedules, and proxy caching
 */
interface ClientContext {
  handlers: Map<string, ((...args: unknown[]) => unknown)[]>
  schedules: Map<string, { cron: string; handler: (...args: unknown[]) => unknown }>
  /** Cache for nested proxies keyed by path string */
  proxyCache: Map<string, unknown>
  /** Cache for reflection results (_types, _schema, md) */
  reflectionCache: Map<string, unknown>
}

/**
 * Symbol for Node.js custom inspect (console.log)
 */
const INSPECT_SYMBOL = Symbol.for('nodejs.util.inspect.custom')

/**
 * Well-known top-level resources exposed by the $ proxy
 */
const TOP_LEVEL_KEYS = ['on', 'every', '_types', '_schema', 'md', 'send', 'try', 'do']

/**
 * Methods that should have their results cached
 */
const CACHEABLE_METHODS = new Set(['_types', '_schema', 'md'])

/**
 * Promise-like properties to exclude from proxy handling
 */
const PROMISE_PROPS = new Set(['then', 'catch', 'finally'])

/**
 * Internal helper to create a method invoker function using transport
 */
function createTransportInvoker(
  transport: Transport,
  methodPath: string[],
  boundId?: string
): (...args: unknown[]) => Promise<unknown> {
  return async (...args: unknown[]) => {
    const method = methodPath.join('.')
    // If we have a bound ID, prepend it to params
    const params = boundId !== undefined ? [boundId, ...args] : args

    const response = await transport.send({
      method,
      args: params,
    })

    // Handle error responses
    if (response.error) {
      throw new Error(response.error.message)
    }

    return response.result
  }
}

/**
 * Internal helper to create a method invoker function (legacy fetch-based)
 */
function createMethodInvoker(
  url: string,
  timeout: number,
  methodPath: string[],
  baseCorrelationId?: string
): (...args: unknown[]) => Promise<unknown> {
  return async (...args: unknown[]) => {
    const method = methodPath.join('.')
    const correlationId = baseCorrelationId || generateCorrelationId()

    const response = await fetch(`${url}/rpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [CORRELATION_ID_HEADER]: correlationId,
      },
      body: JSON.stringify({ method, args }),
      signal: AbortSignal.timeout(timeout),
    })

    if (!response.ok) {
      throw new Error(`RPC error: ${response.status}`)
    }

    return response.json()
  }
}

/**
 * Generate cache key for proxy lookup
 */
function getCacheKey(path: string[], boundId?: string): string {
  const pathKey = path.join('.')
  return boundId !== undefined ? `${pathKey}:${boundId}` : pathKey
}

/**
 * Create a nested proxy for event handlers ($.on.Entity.action)
 * Uses caching to avoid creating duplicate proxies for the same path
 */
function createOnProxy(context: ClientContext, path: string[] = []): unknown {
  const cacheKey = `on:${path.join('.')}`
  const cached = context.proxyCache.get(cacheKey)
  if (cached !== undefined) return cached

  const proxy = new Proxy(() => {}, {
    get(_, prop: string | symbol) {
      if (typeof prop === 'symbol') return undefined
      if (PROMISE_PROPS.has(prop as string)) return undefined
      return createOnProxy(context, [...path, prop])
    },
    apply(_, __, args: unknown[]) {
      // Register the handler
      const eventPath = path.join('.')
      const handler = args[0] as (...args: unknown[]) => unknown
      const handlers = context.handlers.get(eventPath)
      if (handlers) {
        handlers.push(handler)
      } else {
        context.handlers.set(eventPath, [handler])
      }
      return undefined
    },
  })

  context.proxyCache.set(cacheKey, proxy)
  return proxy
}

/**
 * Create a schedule builder for $.every DSL
 * Supports fluent chaining like $.every.Monday.at('9am')(handler)
 */
function createScheduleBuilder(
  context: ClientContext,
  parts: string[] = []
): unknown {
  const cacheKey = `every:${parts.join('.')}`
  const cached = context.proxyCache.get(cacheKey)
  if (cached !== undefined) return cached

  // The schedule builder is both a callable (for $.every.day(handler)) and
  // has properties (for $.every.Monday.at('9am'))
  const builder = function(handlerOrTime: unknown) {
    if (typeof handlerOrTime === 'function') {
      // Direct call like $.every.day(handler)
      const cron = buildCron(parts)
      const id = `schedule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      context.schedules.set(id, { cron, handler: handlerOrTime as (...args: unknown[]) => unknown })
      return undefined
    }
    // Otherwise it's a time string for .at()
    return undefined
  }

  const proxy = new Proxy(builder, {
    get(target, prop: string | symbol) {
      if (typeof prop === 'symbol') return undefined
      if (PROMISE_PROPS.has(prop as string)) return undefined

      if (prop === 'at') {
        // Return a function that takes time and returns a callable
        return (time: string) => {
          const newParts = [...parts, `at:${time}`]
          // Return a callable that registers the handler
          return (handler: (...args: unknown[]) => unknown) => {
            const cron = buildCron(newParts)
            const id = `schedule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
            context.schedules.set(id, { cron, handler })
            return undefined
          }
        }
      }

      // Continue building the schedule ($.every.Monday, $.every.day)
      return createScheduleBuilder(context, [...parts, prop as string])
    },
    apply(target, thisArg, args) {
      return target(args[0])
    },
  })

  context.proxyCache.set(cacheKey, proxy)
  return proxy
}

/**
 * Build a cron expression from schedule parts (placeholder implementation)
 */
function buildCron(parts: string[]): string {
  // This is a placeholder - real implementation would convert
  // ['Monday', 'at:9am'] to '0 9 * * 1'
  return parts.join(' ')
}

/**
 * Create an inspect function for a given path
 */
function createInspectFunction(path: string[]): () => string {
  return () => {
    if (path.length === 0) {
      return `$ { on, every, _types, _schema, md, send, try, do }`
    }
    return `$.${path.join('.')}`
  }
}

/**
 * Create a cached method invoker that caches results for reflection methods
 */
function createCachedInvoker(
  transport: Transport,
  context: ClientContext,
  methodPath: string[],
  boundId?: string
): (...args: unknown[]) => Promise<unknown> {
  const method = methodPath.join('.')
  const isCacheable = methodPath.length === 1 && CACHEABLE_METHODS.has(method)

  return async (...args: unknown[]) => {
    // Check cache for reflection methods
    if (isCacheable && args.length === 0) {
      const cached = context.reflectionCache.get(method)
      if (cached !== undefined) {
        return cached
      }
    }

    // If we have a bound ID, prepend it to params
    const params = boundId !== undefined ? [boundId, ...args] : args

    const response = await transport.send({
      method,
      args: params,
    })

    // Handle error responses
    if (response.error) {
      throw new Error(response.error.message)
    }

    const result = response.result

    // Cache reflection results
    if (isCacheable && args.length === 0) {
      context.reflectionCache.set(method, result)
    }

    return result
  }
}

/**
 * Create a nested proxy that tracks the property path and supports ID binding
 * This supports:
 * - Flat APIs (client.greet())
 * - Nested APIs (client.users.create())
 * - ID-based entity access ($.Customer('id').method())
 *
 * Uses caching to avoid creating duplicate proxies for the same path
 */
function createNestedProxyWithTransport(
  transport: Transport,
  context: ClientContext,
  path: string[] = [],
  boundId?: string
): unknown {
  // Generate cache key - but only cache proxies without bound IDs
  // Entity-bound proxies ($.Customer('id')) should not be cached as IDs are dynamic
  const cacheKey = boundId === undefined ? `proxy:${path.join('.')}` : null
  if (cacheKey) {
    const cached = context.proxyCache.get(cacheKey)
    if (cached !== undefined) return cached
  }

  // Create inspect function for this path
  const inspectFn = createInspectFunction(path)

  // Target object with the inspect symbol pre-defined
  // This is needed because Proxy get trap can't return functions for symbols in some cases
  const target = Object.assign(() => {}, {
    [INSPECT_SYMBOL]: inspectFn,
  })

  const proxy = new Proxy(target, {
    get(_, prop: string | symbol) {
      // Handle the custom inspect symbol for console.log($)
      if (prop === INSPECT_SYMBOL) {
        return inspectFn
      }

      // Don't intercept other symbols or promise methods (client should not be thenable)
      if (typeof prop === 'symbol') {
        return undefined
      }

      if (PROMISE_PROPS.has(prop as string)) {
        return undefined // Not a promise
      }

      // Special namespace: $.on for event handlers
      if (path.length === 0 && prop === 'on') {
        return createOnProxy(context)
      }

      // Special namespace: $.every for scheduling
      if (path.length === 0 && prop === 'every') {
        return createScheduleBuilder(context)
      }

      // Return a nested proxy for property access
      return createNestedProxyWithTransport(transport, context, [...path, prop as string], boundId)
    },

    // Handle Object.keys($) and for...in enumeration
    ownKeys(_) {
      if (path.length === 0) {
        return TOP_LEVEL_KEYS
      }
      // Nested proxies don't enumerate
      return []
    },

    // Required for ownKeys to work correctly
    getOwnPropertyDescriptor(_, prop) {
      if (path.length === 0 && typeof prop === 'string' && TOP_LEVEL_KEYS.includes(prop)) {
        return {
          configurable: true,
          enumerable: true,
          value: undefined,
        }
      }
      return undefined
    },

    apply(_, __, args: unknown[]) {
      // Check if this is an ID-binding call ($.EntityType('id'))
      // This happens when path has one element (the entity type name) and
      // the first arg looks like an ID (string)
      const firstPathElement = path[0]
      if (
        path.length === 1 &&
        args.length === 1 &&
        typeof args[0] === 'string' &&
        firstPathElement !== undefined &&
        !firstPathElement.startsWith('$') && // Not a special method
        !firstPathElement.startsWith('_') // Not a reflection method
      ) {
        const entityId = args[0] as string
        // Return a proxy bound to this entity ID (not cached - IDs are dynamic)
        return createNestedProxyWithTransport(transport, context, [firstPathElement], entityId)
      }

      // When called as a function, invoke the RPC method using cached invoker
      return createCachedInvoker(transport, context, path, boundId)(...args)
    },
  })

  // Cache the proxy if we have a cache key
  if (cacheKey) {
    context.proxyCache.set(cacheKey, proxy)
  }

  return proxy
}

/**
 * Create a nested proxy that tracks the property path (legacy version)
 * This supports both flat APIs (client.greet()) and nested APIs (client.users.create())
 */
function createNestedProxy(
  url: string,
  timeout: number,
  path: string[] = [],
  correlationId?: string
): unknown {
  return new Proxy(() => {}, {
    get(_, prop: string | symbol) {
      // Don't intercept symbols or promise methods (client should not be thenable)
      if (typeof prop === 'symbol') {
        return undefined
      }

      if (PROMISE_PROPS.has(prop as string)) {
        return undefined // Not a promise
      }

      // Return a nested proxy for property access
      return createNestedProxy(url, timeout, [...path, prop as string], correlationId)
    },

    apply(_, __, args: unknown[]) {
      // When called as a function, invoke the RPC method
      return createMethodInvoker(url, timeout, path, correlationId)(...args)
    },
  })
}

/**
 * Creates a typed proxy client that forwards method calls via RPC.
 *
 * The client intercepts method calls and sends them as JSON-RPC requests to the
 * specified URL. It supports:
 * - Flat APIs: `client.greet('World')`
 * - Nested APIs: `client.users.create({ name: 'Alice' })`
 * - ID-based entity access: `$.Customer('id').method()`
 * - Event handlers: `$.on.Customer.signup(handler)`
 * - Scheduling DSL: `$.every.Monday.at('9am')(handler)`
 * - Configurable timeout via AbortSignal
 *
 * @example
 * ```typescript
 * interface MyAPI {
 *   greet(name: string): Promise<string>
 *   users: {
 *     create(user: User): Promise<{ id: string }>
 *   }
 * }
 *
 * const client = createClient<MyAPI>({ url: 'https://api.example.com' })
 * const greeting = await client.greet('World')
 * const user = await client.users.create({ name: 'Alice' })
 * ```
 *
 * @param urlOrOptions - URL string or configuration options
 * @param options - Additional options when first arg is URL string
 * @returns A typed proxy that forwards method calls via RPC
 */
export function createClient<T extends object>(
  urlOrOptions: string | RPCClientOptions,
  options?: CreateClientOptions
): T {
  // Handle overloaded signatures
  if (typeof urlOrOptions === 'string') {
    // createClient('http://test', { transport: ... })
    const url = urlOrOptions
    const opts = options ?? {}
    const transport = opts.transport

    if (transport) {
      const context: ClientContext = {
        handlers: new Map(),
        schedules: new Map(),
        proxyCache: new Map(),
        reflectionCache: new Map(),
      }
      return createNestedProxyWithTransport(transport, context) as T
    }

    // Fall back to legacy fetch-based client
    const timeout = opts.timeout ?? 30000
    const correlationId = opts.correlationId
    return createNestedProxy(url, timeout, [], correlationId) as T
  }

  // createClient({ url: 'http://test', ... })
  const { url, timeout = 30000, correlationId } = urlOrOptions
  return createNestedProxy(url, timeout, [], correlationId) as T
}

/**
 * Creates a generic proxy that wraps a handler function.
 *
 * This is a low-level utility for creating RPC-like proxies where each
 * property access and method call is handled by the provided handler.
 *
 * @example
 * ```typescript
 * const proxy = createProxy((path, args) => {
 *   console.log(`Called ${path.join('.')} with`, args)
 *   return Promise.resolve({ success: true })
 * })
 *
 * await proxy.users.create({ name: 'Alice' })
 * // Logs: Called users.create with [{ name: 'Alice' }]
 * ```
 *
 * @param handler - Function to handle method calls
 * @returns A proxy object
 */
export function createProxy(
  handler: (path: string[], args: unknown[]) => Promise<unknown>
): object {
  function createNestedHandler(path: string[] = []): unknown {
    return new Proxy(() => {}, {
      get(_, prop: string | symbol) {
        if (typeof prop === 'symbol') {
          return undefined
        }

        if (PROMISE_PROPS.has(prop as string)) {
          return undefined
        }

        return createNestedHandler([...path, prop as string])
      },

      apply(_, __, args: unknown[]) {
        return handler(path, args)
      },
    })
  }

  return createNestedHandler() as object
}
