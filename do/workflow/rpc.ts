/**
 * Cross-DO RPC for WorkflowContext
 *
 * Provides typed proxy access to other Durable Objects:
 *   $.Customer(id).getProfile()
 *   $.Order(id).ship()
 *   $.Worker(id).process(data)
 *
 * Features:
 * - Automatic DO stub caching
 * - Type-safe method invocation via Proxy
 * - Correlation ID propagation
 * - Error handling with proper types
 * - Circuit breaker protection for cascade failure prevention (do-fcxj)
 *
 * @module do/workflow/rpc
 */

import {
  createDOStub,
  createDOStubWithCircuitBreaker,
  type CircuitBreakerRPCConfig,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  NotFoundError,
} from '@dotdo/rpc'

/**
 * A proxy type representing a DO stub that intercepts method calls
 * and forwards them via RPC. Methods can have any arguments and return
 * Promise<unknown> since the actual return type depends on the remote DO.
 */
export type DOStubProxy = {
  [method: string]: (...args: unknown[]) => Promise<unknown>
}

/**
 * Function type for creating DO stubs from an ID.
 * Used by the index signature for dynamic DO access like $.Customer(id)
 */
export type DOStubFactory = (id: string | DurableObjectId) => DOStubProxy

/**
 * Configuration for cross-DO RPC
 */
export interface CrossDORPCConfig {
  /** The environment containing DO namespace bindings */
  env: unknown
  /** Cache for storing created stubs */
  stubCache: Map<string, DOStubProxy>
  /** Circuit breaker configuration (optional, enabled by default) */
  circuitBreaker?: CircuitBreakerRPCConfig
}

// Re-export circuit breaker types for convenience
export type { CircuitBreakerRPCConfig }
export { DEFAULT_CIRCUIT_BREAKER_CONFIG }

/**
 * Create a cross-DO RPC accessor for a specific binding name
 *
 * This function creates a factory that can create DO stubs for a given binding.
 * The stubs are cached to avoid creating multiple stubs for the same DO instance.
 *
 * @param config - RPC configuration including env and stub cache
 * @param bindingName - Name of the DO binding (e.g., 'Customer', 'Order')
 * @returns A factory function that creates cached DO stubs
 *
 * @example
 * ```ts
 * const env = { Customer: CustomerNamespace }
 * const stubCache = new Map()
 * const customerFactory = createDOAccessor({ env, stubCache }, 'Customer')
 *
 * // Create a stub for customer 'user-123'
 * const customer = customerFactory('user-123')
 * const profile = await customer.getProfile()
 * ```
 */
export function createDOAccessor(
  config: CrossDORPCConfig,
  bindingName: string
): DOStubFactory {
  const { env, stubCache, circuitBreaker } = config

  return (id: string | DurableObjectId): DOStubProxy => {
    const cacheKey = `${bindingName}:${typeof id === 'string' ? id : id.toString()}`

    // Return cached stub if exists
    if (stubCache.has(cacheKey)) {
      return stubCache.get(cacheKey)!
    }

    // Get DO namespace binding from env
    const envObj = env as Record<string, unknown>
    const binding = envObj?.[bindingName] as DurableObjectNamespace | undefined

    if (!binding) {
      throw new NotFoundError(
        `Durable Object binding "${bindingName}" not found in environment`,
        { binding: bindingName }
      )
    }

    // Create stub with circuit breaker protection (do-fcxj)
    // Circuit breaker is enabled by default unless explicitly disabled
    const useCircuitBreaker = circuitBreaker?.enabled !== false
    const stub = useCircuitBreaker
      ? createDOStubWithCircuitBreaker<DOStubProxy>(binding, id, {
          circuitBreaker: {
            ...circuitBreaker,
            // Prefix circuit name with binding for better isolation
            namePrefix: circuitBreaker?.namePrefix ?? `do-rpc:${bindingName}`,
          },
        })
      : createDOStub<DOStubProxy>(binding, id)

    stubCache.set(cacheKey, stub)

    return stub
  }
}

/**
 * Base context shape with _env and _stubCache fields.
 * Used by createDORPCProxy to extract env and stubCache from the context,
 * avoiding duplicate references. (do-1e3z)
 */
interface BaseContextWithInternals {
  _env: unknown
  _stubCache: Map<string, DOStubProxy>
  /** Optional circuit breaker configuration for cross-DO RPC (do-fcxj) */
  _circuitBreakerConfig?: CircuitBreakerRPCConfig
}

/**
 * Create a proxy that dynamically provides DO accessors
 *
 * This creates the proxy that enables the $.Customer(id), $.Order(id), etc. syntax.
 * Unknown property accesses are treated as DO binding names.
 *
 * The function extracts _env and _stubCache from baseContext directly,
 * avoiding duplicate references to these values. (do-1e3z)
 *
 * @param baseContext - The base context object with known properties (must include _env and _stubCache)
 * @returns A proxy wrapping the base context with dynamic DO accessors
 *
 * @example
 * ```ts
 * const baseContext = {
 *   send: (event) => { ... },
 *   on: onProxy,
 *   every: everyProxy,
 *   _env: env,
 *   _stubCache: stubCache,
 *   // ... other known properties
 * }
 *
 * const context = createDORPCProxy(baseContext)
 *
 * // Dynamic DO access
 * const customer = context.Customer('user-123')
 * await customer.notify({ message: 'Hello' })
 * ```
 */
export function createDORPCProxy<T extends BaseContextWithInternals>(
  baseContext: T
): T & Record<string, DOStubFactory> {
  // Extract env, stubCache, and circuitBreaker config from baseContext - single source of truth (do-1e3z)
  const config: CrossDORPCConfig = {
    env: baseContext._env,
    stubCache: baseContext._stubCache,
    circuitBreaker: baseContext._circuitBreakerConfig,
  }

  return new Proxy(baseContext as T & Record<string, DOStubFactory>, {
    get(target, prop: string | symbol) {
      // Bypass symbols and internal properties
      if (typeof prop === 'symbol') {
        return Reflect.get(target, prop)
      }

      // Return existing properties (send, try, do, on, every, etc.)
      if (prop in target) {
        return Reflect.get(target, prop)
      }

      // For unknown properties, assume it's a DO binding name
      // Return a function that creates a cached DO stub with circuit breaker protection (do-fcxj)
      return createDOAccessor(config, prop)
    }
  })
}

/**
 * Check if a stub exists in the cache
 *
 * @param stubCache - The stub cache map
 * @param bindingName - The DO binding name
 * @param id - The DO instance ID
 * @returns True if stub is cached
 */
export function hasStub(
  stubCache: Map<string, DOStubProxy>,
  bindingName: string,
  id: string | DurableObjectId
): boolean {
  const cacheKey = `${bindingName}:${typeof id === 'string' ? id : id.toString()}`
  return stubCache.has(cacheKey)
}

/**
 * Clear a specific stub from the cache
 *
 * @param stubCache - The stub cache map
 * @param bindingName - The DO binding name
 * @param id - The DO instance ID
 * @returns True if stub was removed
 */
export function clearStub(
  stubCache: Map<string, DOStubProxy>,
  bindingName: string,
  id: string | DurableObjectId
): boolean {
  const cacheKey = `${bindingName}:${typeof id === 'string' ? id : id.toString()}`
  return stubCache.delete(cacheKey)
}

/**
 * Clear all stubs from the cache
 *
 * @param stubCache - The stub cache map
 */
export function clearAllStubs(
  stubCache: Map<string, DOStubProxy>
): void {
  stubCache.clear()
}

/**
 * Get the number of cached stubs
 *
 * @param stubCache - The stub cache map
 * @returns Number of cached stubs
 */
export function getStubCount(
  stubCache: Map<string, DOStubProxy>
): number {
  return stubCache.size
}
