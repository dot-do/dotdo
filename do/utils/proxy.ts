/**
 * Shared Proxy utilities for @dotdo/do package
 *
 * Common patterns for creating Proxy-based APIs:
 * - Two-level nested proxies for $.on.Noun.verb() patterns
 * - Method proxies for RPC-style calls
 *
 * @module do/utils/proxy
 */

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
