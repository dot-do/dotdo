/**
 * Shared Proxy utilities for @dotdo/do, @dotdo/rpc, and rpc.do packages
 *
 * Common patterns for creating Proxy-based APIs:
 * - Two-level nested proxies for $.on.Noun.verb() patterns
 * - Method proxies for RPC-style calls
 * - Deep nested RPC proxies for client.users.create() patterns
 * - Event handler proxies for $.on.Entity.action() patterns
 * - Schedule DSL proxies for $.every.Monday.at('9am') patterns
 *
 * @module do/utils/proxy
 */

/**
 * Promise-like properties that should be excluded from proxy handling.
 * This prevents proxies from being detected as Promises by async/await.
 */
export const PROMISE_PROPS = new Set(['then', 'catch', 'finally'])

/**
 * Creates a two-level proxy for patterns like $.on.Noun.verb()
 *
 * This is useful for creating fluent APIs where:
 * - First level captures a category (e.g., 'Customer', 'Order')
 * - Second level captures an action (e.g., 'created', 'signup')
 * - The result can be called as a function or accessed as a value
 *
 * @param getHandler - Function that receives (firstLevel, secondLevel) and returns the handler
 * @returns A Proxy that intercepts two levels of property access
 *
 * @example
 * ```ts
 * // Create a simple event registration proxy
 * const handlers = new Map()
 * const on = createNestedProxy<OnProxy>((noun, verb) => {
 *   return (handler) => {
 *     const key = `${noun}.${verb}`
 *     handlers.set(key, handler)
 *   }
 * })
 *
 * // Usage
 * on.Customer.signup((event) => console.log(event))
 * on.Order.placed((event) => console.log(event))
 * ```
 */
export function createNestedProxy<T extends object>(
  getHandler: (firstLevel: string, secondLevel: string) => unknown
): T {
  return new Proxy({} as T, {
    get(_target, noun: string) {
      return new Proxy({}, {
        get(_target, verb: string) {
          return getHandler(noun, verb)
        }
      })
    }
  })
}

/**
 * Creates a method proxy for RPC-style calls
 *
 * This is useful for creating typed proxies where method calls
 * are forwarded to a custom invoke function.
 *
 * @param invoke - Function that receives (method, args) and returns a Promise
 * @returns A Proxy that intercepts method calls
 *
 * @example
 * ```ts
 * // Create an RPC client proxy
 * const client = createMethodProxy<MyAPI>(async (method, args) => {
 *   const response = await fetch('/rpc', {
 *     method: 'POST',
 *     body: JSON.stringify({ method, args })
 *   })
 *   return response.json()
 * })
 *
 * // Usage
 * const result = await client.greet('World')
 * const user = await client.createUser({ name: 'Alice' })
 * ```
 */
export function createMethodProxy<T extends object>(
  invoke: (method: string, args: unknown[]) => Promise<unknown>
): T {
  return new Proxy({} as T, {
    get(_target, method: string) {
      // Don't intercept symbols or promise methods
      if (typeof method === 'symbol') {
        return undefined
      }

      if (method === 'then' || method === 'catch' || method === 'finally') {
        return undefined // Not a promise
      }

      return (...args: unknown[]) => invoke(method, args)
    }
  })
}

/**
 * Creates a callable nested proxy that can be invoked at any level
 *
 * This extends createNestedProxy to support patterns where the proxy
 * can be called as a function at any depth in the chain.
 *
 * @param options - Configuration for the proxy behavior
 * @param options.onGet - Called when a property is accessed, returns the next proxy or value
 * @param options.onApply - Called when the proxy is invoked as a function
 * @param state - Initial state passed through the chain
 * @returns A Proxy that can be both accessed and called
 *
 * @example
 * ```ts
 * // Create a scheduling DSL proxy
 * const every = createCallableNestedProxy({
 *   onGet: (prop, state) => ({
 *     ...state,
 *     path: [...state.path, prop]
 *   }),
 *   onApply: (args, state) => {
 *     if (typeof args[0] === 'function') {
 *       registerSchedule(state.path.join('.'), args[0])
 *     }
 *   }
 * }, { path: [] })
 *
 * // Usage
 * every.Monday.at9am(handler)
 * every(5).minutes(handler)
 * ```
 */
export function createCallableNestedProxy<T, S>(
  options: {
    onGet: (prop: string, state: S) => S | unknown
    onApply: (args: unknown[], state: S) => unknown
  },
  state: S
): T {
  const handler = function() {} // Make it callable

  return new Proxy(handler, {
    get(_target, prop: string | symbol) {
      if (typeof prop === 'symbol') {
        return undefined
      }

      const result = options.onGet(prop, state)

      // If result is same type as state, create another proxy
      if (result && typeof result === 'object' && !('then' in result)) {
        return createCallableNestedProxy(options, result as S)
      }

      return result
    },

    apply(_target, _thisArg, args: unknown[]) {
      return options.onApply(args, state)
    }
  }) as T
}

// ============================================================================
// Deep Nested RPC Proxy
// ============================================================================

/**
 * Options for creating a deep RPC proxy
 */
export interface DeepRPCProxyOptions {
  /**
   * Function to invoke when the proxy is called as a function.
   * Receives the accumulated path and call arguments.
   */
  invoke: (path: string[], args: unknown[]) => Promise<unknown>

  /**
   * Optional cache for proxy instances to avoid recreation.
   * When provided, proxies for the same path will be reused.
   */
  cache?: Map<string, unknown>

  /**
   * Optional function to handle special properties at the root level.
   * Return a value to override the default nested proxy behavior.
   */
  getSpecialProperty?: (prop: string) => unknown | undefined
}

/**
 * Creates a deep nested proxy for RPC-style calls with arbitrary depth.
 *
 * This supports both flat APIs (client.greet()) and nested APIs (client.users.create()).
 * Unlike createMethodProxy which only handles single-level methods, this handles
 * arbitrary nesting depths.
 *
 * @param options - Configuration for the proxy behavior
 * @param path - Current accumulated path (used internally for recursion)
 * @returns A Proxy that tracks property access and invokes the handler when called
 *
 * @example
 * ```ts
 * // Create a simple RPC client
 * const client = createDeepRPCProxy({
 *   invoke: async (path, args) => {
 *     const response = await fetch('/rpc', {
 *       method: 'POST',
 *       body: JSON.stringify({ method: path.join('.'), args })
 *     })
 *     return response.json()
 *   }
 * })
 *
 * // Usage
 * await client.greet('World')          // invoke(['greet'], ['World'])
 * await client.users.create({ name })  // invoke(['users', 'create'], [{ name }])
 * await client.a.b.c.d()               // invoke(['a', 'b', 'c', 'd'], [])
 * ```
 */
export function createDeepRPCProxy<T = unknown>(
  options: DeepRPCProxyOptions,
  path: string[] = []
): T {
  const { invoke, cache, getSpecialProperty } = options

  // Check cache first (only for non-empty paths, root is always created fresh)
  if (cache && path.length > 0) {
    const cacheKey = `proxy:${path.join('.')}`
    const cached = cache.get(cacheKey)
    if (cached !== undefined) return cached as T
  }

  const proxy = new Proxy(() => {}, {
    get(_target, prop: string | symbol): unknown {
      // Don't intercept symbols
      if (typeof prop === 'symbol') {
        return undefined
      }

      // Don't intercept promise properties (prevents thenable detection)
      if (PROMISE_PROPS.has(prop)) {
        return undefined
      }

      // Check for special properties at root level
      if (path.length === 0 && getSpecialProperty) {
        const special = getSpecialProperty(prop)
        if (special !== undefined) return special
      }

      // Return a nested proxy for property access
      return createDeepRPCProxy(options, [...path, prop])
    },

    apply(_target, _thisArg, args: unknown[]): Promise<unknown> {
      // When called as a function, invoke the RPC handler
      return invoke(path, args)
    }
  })

  // Cache the proxy if caching is enabled
  if (cache && path.length > 0) {
    const cacheKey = `proxy:${path.join('.')}`
    cache.set(cacheKey, proxy)
  }

  return proxy as T
}

// ============================================================================
// Event Handler Proxy ($.on.Entity.action pattern)
// ============================================================================

/**
 * Options for creating an event handler proxy
 */
export interface EventProxyOptions {
  /**
   * Function called when a handler is registered.
   * Receives the event path and the handler function.
   */
  onRegister: (path: string[], handler: (...args: unknown[]) => unknown) => void

  /**
   * Optional cache for proxy instances
   */
  cache?: Map<string, unknown>
}

/**
 * Creates a proxy for event handler registration patterns like $.on.Entity.action(handler).
 *
 * This supports arbitrary depth event paths and can register multiple handlers
 * for the same event.
 *
 * @param options - Configuration for the proxy behavior
 * @param path - Current accumulated path (used internally for recursion)
 * @returns A Proxy that captures event paths and registers handlers
 *
 * @example
 * ```ts
 * const handlers = new Map<string, Function[]>()
 *
 * const on = createEventProxy({
 *   onRegister: (path, handler) => {
 *     const key = path.join('.')
 *     const existing = handlers.get(key) || []
 *     handlers.set(key, [...existing, handler])
 *   }
 * })
 *
 * // Usage
 * on.Customer.signup(handler)      // registers 'Customer.signup'
 * on.Order.item.added(handler)     // registers 'Order.item.added'
 * ```
 */
export function createEventProxy<T = unknown>(
  options: EventProxyOptions,
  path: string[] = []
): T {
  const { onRegister, cache } = options

  // Check cache
  if (cache) {
    const cacheKey = `on:${path.join('.')}`
    const cached = cache.get(cacheKey)
    if (cached !== undefined) return cached as T
  }

  const proxy = new Proxy(() => {}, {
    get(_target, prop: string | symbol): unknown {
      if (typeof prop === 'symbol') return undefined
      if (PROMISE_PROPS.has(prop)) return undefined

      return createEventProxy(options, [...path, prop])
    },

    apply(_target, _thisArg, args: unknown[]): void {
      const handler = args[0] as (...args: unknown[]) => unknown
      onRegister(path, handler)
    }
  })

  // Cache the proxy
  if (cache) {
    const cacheKey = `on:${path.join('.')}`
    cache.set(cacheKey, proxy)
  }

  return proxy as T
}

// ============================================================================
// Schedule DSL Proxy ($.every.Monday.at('9am') pattern)
// ============================================================================

/**
 * Options for creating a schedule builder proxy
 */
export interface ScheduleProxyOptions {
  /**
   * Function called when a schedule is registered.
   * Receives the schedule parts and the handler function.
   */
  onRegister: (parts: string[], handler: (...args: unknown[]) => unknown) => void

  /**
   * Optional cache for proxy instances
   */
  cache?: Map<string, unknown>
}

/**
 * Creates a proxy for schedule DSL patterns like $.every.Monday.at('9am')(handler).
 *
 * Supports:
 * - Direct invocation: $.every.day(handler)
 * - Chained .at(): $.every.Monday.at('9am')(handler)
 * - Arbitrary chaining: $.every.first.monday.of.month(handler)
 *
 * @param options - Configuration for the proxy behavior
 * @param parts - Current accumulated schedule parts (used internally for recursion)
 * @returns A Proxy that captures schedule DSL and registers handlers
 *
 * @example
 * ```ts
 * const schedules: Array<{ parts: string[], handler: Function }> = []
 *
 * const every = createScheduleProxy({
 *   onRegister: (parts, handler) => {
 *     schedules.push({ parts, handler })
 *   }
 * })
 *
 * // Usage
 * every.day(handler)                // parts: ['day']
 * every.Monday.at('9am')(handler)   // parts: ['Monday', 'at:9am']
 * every.hour(handler)               // parts: ['hour']
 * ```
 */
export function createScheduleProxy<T = unknown>(
  options: ScheduleProxyOptions,
  parts: string[] = []
): T {
  const { onRegister, cache } = options

  // Check cache
  if (cache) {
    const cacheKey = `every:${parts.join('.')}`
    const cached = cache.get(cacheKey)
    if (cached !== undefined) return cached as T
  }

  // The schedule builder is callable (for direct handler registration)
  const builder = function(arg: unknown) {
    if (typeof arg === 'function') {
      onRegister(parts, arg as (...args: unknown[]) => unknown)
    }
  }

  const proxy = new Proxy(builder, {
    get(_target, prop: string | symbol): unknown {
      if (typeof prop === 'symbol') return undefined
      if (PROMISE_PROPS.has(prop)) return undefined

      // Special handling for .at() which takes a time argument
      if (prop === 'at') {
        return (time: string) => {
          const newParts = [...parts, `at:${time}`]
          // Return a callable that registers the handler
          return (handler: (...args: unknown[]) => unknown) => {
            onRegister(newParts, handler)
          }
        }
      }

      // Continue building the schedule
      return createScheduleProxy(options, [...parts, prop as string])
    },

    apply(target, _thisArg, args: unknown[]) {
      return (target as (arg: unknown) => void)(args[0])
    }
  })

  // Cache the proxy
  if (cache) {
    const cacheKey = `every:${parts.join('.')}`
    cache.set(cacheKey, proxy)
  }

  return proxy as T
}

// ============================================================================
// Entity Access Proxy ($.Customer('id').method() pattern)
// ============================================================================

/**
 * Options for creating an entity access proxy
 */
export interface EntityProxyOptions {
  /**
   * Function to invoke when an entity method is called.
   * Receives the entity type, bound ID, method path, and call arguments.
   */
  invoke: (entityType: string, id: string, methodPath: string[], args: unknown[]) => Promise<unknown>

  /**
   * Optional cache for proxy instances (only caches unbound proxies, not entity-bound ones)
   */
  cache?: Map<string, unknown>
}

/**
 * Creates a proxy for ID-based entity access patterns like $.Customer('id').method().
 *
 * The pattern is:
 * 1. Access an entity type: $.Customer
 * 2. Call with an ID to bind: $.Customer('cust-123')
 * 3. Access methods on the bound entity: $.Customer('cust-123').getProfile()
 *
 * @param options - Configuration for the proxy behavior
 * @returns A Proxy that supports entity binding and method invocation
 *
 * @example
 * ```ts
 * const $ = createEntityAccessProxy({
 *   invoke: async (entityType, id, methodPath, args) => {
 *     const method = [entityType, ...methodPath].join('.')
 *     return fetch('/rpc', {
 *       method: 'POST',
 *       body: JSON.stringify({ method, args: [id, ...args] })
 *     }).then(r => r.json())
 *   }
 * })
 *
 * // Usage
 * await $.Customer('cust-123').getProfile()        // entityType: 'Customer', id: 'cust-123', methodPath: ['getProfile']
 * await $.Order('order-456').items.list()          // entityType: 'Order', id: 'order-456', methodPath: ['items', 'list']
 * ```
 */
export function createEntityAccessProxy<T = unknown>(
  options: EntityProxyOptions
): T {
  const { invoke, cache } = options

  // Create a method proxy for bound entities
  const createBoundEntityProxy = (
    entityType: string,
    id: string,
    methodPath: string[] = []
  ): unknown => {
    return new Proxy(() => {}, {
      get(_target, prop: string | symbol): unknown {
        if (typeof prop === 'symbol') return undefined
        if (PROMISE_PROPS.has(prop)) return undefined

        return createBoundEntityProxy(entityType, id, [...methodPath, prop])
      },

      apply(_target, _thisArg, args: unknown[]): Promise<unknown> {
        return invoke(entityType, id, methodPath, args)
      }
    })
  }

  // Create the root proxy that handles entity type access
  return new Proxy(() => {}, {
    get(_target, entityType: string | symbol): unknown {
      if (typeof entityType === 'symbol') return undefined
      if (PROMISE_PROPS.has(entityType)) return undefined

      // Check cache for the entity type accessor
      if (cache) {
        const cacheKey = `entity:${entityType}`
        const cached = cache.get(cacheKey)
        if (cached !== undefined) return cached
      }

      // Return a function that takes an ID and returns a bound proxy
      const entityAccessor = (id: string) => {
        // Entity-bound proxies are NOT cached (IDs are dynamic)
        return createBoundEntityProxy(entityType as string, id)
      }

      // Cache the entity accessor (not the bound proxy)
      if (cache) {
        cache.set(`entity:${entityType}`, entityAccessor)
      }

      return entityAccessor
    }
  }) as T
}
