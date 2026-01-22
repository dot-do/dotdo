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
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  NotFoundError,
} from '@dotdo/rpc'
import type { CircuitBreakerRPCConfig } from '@dotdo/rpc'
import type { ThingsStore } from '@dotdo/db'
import { createEntityAccessor, isEntityName, isReservedProperty } from './entity'
import type { EntitySchema, EntityProxy } from './entity'
import type { EntitySchema as UnifiedEntitySchema } from '../schema/types'
import type { StubCache } from './stub-cache'

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
  /** Cache for storing created stubs with TTL and LRU eviction (do-o16uz) */
  stubCache: StubCache<DOStubProxy>
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

    // Return cached stub if exists and not expired (do-o16uz)
    // StubCache.get() handles TTL expiration automatically
    const cached = stubCache.get(cacheKey)
    if (cached) {
      return cached
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

    // Store in cache with TTL (do-o16uz)
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
  /** DO stub cache with TTL and LRU eviction (do-o16uz) */
  _stubCache: StubCache<DOStubProxy>
  /** Optional circuit breaker configuration for cross-DO RPC (do-fcxj) */
  _circuitBreakerConfig?: CircuitBreakerRPCConfig
  /** Things store for entity operations (do-lekf.8) */
  _things?: ThingsStore
  /** Legacy entity schemas for entity accessor (do-lekf.8) */
  _legacyEntitySchemas?: Map<string, EntitySchema>
  /** Unified entity schemas with relation definitions (do-lekf.5) and AI field support (do-lekf.4) */
  _entitySchemas?: Map<string, UnifiedEntitySchema>
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
): T & Record<string, DOStubFactory | EntityProxy> {
  // Extract env, stubCache, and circuitBreaker config from baseContext - single source of truth (do-1e3z)
  const config: CrossDORPCConfig = {
    env: baseContext._env,
    stubCache: baseContext._stubCache,
    circuitBreaker: baseContext._circuitBreakerConfig,
  }

  // Cache for entity accessors (do-lekf.8)
  const entityAccessorCache = new Map<string, EntityProxy>()

  return new Proxy(baseContext as T & Record<string, DOStubFactory | EntityProxy>, {
    get(target, prop: string | symbol) {
      // Bypass symbols and internal properties
      if (typeof prop === 'symbol') {
        return Reflect.get(target, prop)
      }

      // Return existing properties (send, try, do, on, every, etc.)
      if (prop in target) {
        return Reflect.get(target, prop)
      }

      // Skip reserved properties (do-lekf.8)
      if (isReservedProperty(prop)) {
        return Reflect.get(target, prop)
      }

      // For PascalCase names with a things store, return entity accessor (do-lekf.2)
      // This enables $.Product.create(), $.Product.list(), $.Product(id).get(), etc.
      const things = baseContext._things
      const entitySchemas = baseContext._legacyEntitySchemas ?? new Map()

      if (things && isEntityName(prop)) {
        // Return cached entity accessor or create new one
        if (!entityAccessorCache.has(prop)) {
          // Get unified schemas for relation expansion (do-lekf.5) and AI field generation (do-lekf.4)
          const unifiedSchemas = baseContext._entitySchemas

          entityAccessorCache.set(
            prop,
            createEntityAccessor({ things, schemas: entitySchemas, unifiedSchemas }, prop)
          )
        }
        return entityAccessorCache.get(prop)
      }

      // For unknown properties, assume it's a DO binding name
      // Return a function that creates a cached DO stub with circuit breaker protection (do-fcxj)
      return createDOAccessor(config, prop)
    }
  })
}

/**
 * Check if a stub exists in the cache (and is not expired)
 *
 * @param stubCache - The stub cache with TTL support
 * @param bindingName - The DO binding name
 * @param id - The DO instance ID
 * @returns True if stub is cached and valid
 */
export function hasStub(
  stubCache: StubCache<DOStubProxy>,
  bindingName: string,
  id: string | DurableObjectId
): boolean {
  const cacheKey = `${bindingName}:${typeof id === 'string' ? id : id.toString()}`
  return stubCache.has(cacheKey)
}

/**
 * Clear a specific stub from the cache
 *
 * @param stubCache - The stub cache with TTL support
 * @param bindingName - The DO binding name
 * @param id - The DO instance ID
 * @returns True if stub was removed
 */
export function clearStub(
  stubCache: StubCache<DOStubProxy>,
  bindingName: string,
  id: string | DurableObjectId
): boolean {
  const cacheKey = `${bindingName}:${typeof id === 'string' ? id : id.toString()}`
  return stubCache.delete(cacheKey)
}

/**
 * Clear all stubs from the cache
 *
 * @param stubCache - The stub cache with TTL support
 */
export function clearAllStubs(
  stubCache: StubCache<DOStubProxy>
): void {
  stubCache.clear()
}

/**
 * Get the number of cached stubs
 *
 * @param stubCache - The stub cache with TTL support
 * @returns Number of cached stubs (including potentially expired entries)
 */
export function getStubCount(
  stubCache: StubCache<DOStubProxy>
): number {
  return stubCache.size
}

/**
 * Get cache statistics (do-o16uz)
 *
 * @param stubCache - The stub cache with TTL support
 * @returns Cache statistics including hits, misses, evictions, and expirations
 */
export function getStubCacheStats(
  stubCache: StubCache<DOStubProxy>
) {
  return stubCache.getStats()
}

/**
 * Manually cleanup expired stubs (do-o16uz)
 *
 * @param stubCache - The stub cache with TTL support
 * @returns Number of expired entries removed
 */
export function cleanupExpiredStubs(
  stubCache: StubCache<DOStubProxy>
): number {
  return stubCache.cleanup()
}
