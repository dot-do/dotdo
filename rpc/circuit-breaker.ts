/**
 * Circuit Breaker Integration for Cross-DO RPC
 *
 * Wraps cross-DO RPC calls with circuit breaker protection to prevent
 * cascading failures when DOs become unavailable or slow.
 *
 * This module provides:
 * - createDOStubWithCircuitBreaker: Wraps createDOStub with circuit breaker
 * - createCrossDOClientWithCircuitBreaker: Wraps createCrossDOClient with circuit breaker
 * - CircuitBreakerRPCConfig: Configuration for circuit breaker in RPC context
 *
 * @module @dotdo/rpc/circuit-breaker
 */

import { createDOStub, type DOStubOptions } from './client'
import { createCrossDOClient, CrossDOStubCache, type CrossDORPCOptions } from './cross-do'
import {
  CircuitBreaker,
  CircuitBreakerRegistry,
  createCircuitBreakerRegistry,
  getCircuitBreaker,
  runWithCircuitBreakerRegistry,
  type CircuitBreakerConfig,
  type CircuitState as DOCircuitState,
  type CircuitStats,
} from '@dotdo/utils'
import { TransportError } from './errors'

// Re-export circuit breaker types for convenience
// Note: DOCircuitState uses lowercase values ('closed', 'open', 'half_open')
// while the deprecated CircuitState enum in rpc/errors/circuit-breaker uses uppercase (CLOSED, OPEN, HALF_OPEN)
export type { CircuitBreakerConfig, CircuitStats }
export type { DOCircuitState }
export { getCircuitBreaker, runWithCircuitBreakerRegistry }

/**
 * Default circuit breaker configuration for cross-DO RPC
 */
export const DEFAULT_CIRCUIT_BREAKER_CONFIG: Partial<CircuitBreakerConfig> = {
  /** Open circuit after 5 consecutive failures */
  failureThreshold: 5,
  /** Wait 30 seconds before attempting half-open */
  resetTimeoutMs: 30000,
  /** Need 3 successes in half-open to close circuit */
  successThreshold: 3,
  /** Individual request timeout of 10 seconds */
  timeoutMs: 10000,
  /** Allow 10% of requests through in half-open state */
  halfOpenRequestRatio: 0.1,
}

/**
 * Configuration for circuit breaker in RPC context
 */
export interface CircuitBreakerRPCConfig extends Partial<CircuitBreakerConfig> {
  /** Whether to enable circuit breaker (default: true) */
  enabled?: boolean
  /** Custom circuit name prefix (default: 'do-rpc') */
  namePrefix?: string
  /** Fallback response when circuit is open */
  fallback?: () => unknown | Promise<unknown>
}

/**
 * Options for creating a DO stub with circuit breaker
 */
export interface DOStubWithCircuitBreakerOptions extends DOStubOptions {
  /** Circuit breaker configuration */
  circuitBreaker?: CircuitBreakerRPCConfig
}

/**
 * Options for creating a cross-DO client with circuit breaker
 */
export interface CrossDOClientWithCircuitBreakerOptions extends CrossDORPCOptions {
  /** Circuit breaker configuration */
  circuitBreaker?: CircuitBreakerRPCConfig
}

/**
 * Get the circuit name for a DO stub
 */
function getCircuitName(
  binding: DurableObjectNamespace,
  id: string | DurableObjectId,
  prefix: string = 'do-rpc'
): string {
  const idStr = typeof id === 'string' ? id : id.toString()
  // Use a hash or truncate for very long IDs
  const shortId = idStr.length > 32 ? idStr.slice(0, 32) : idStr
  return `${prefix}:${shortId}`
}

/**
 * Creates a typed proxy for a Durable Object stub with circuit breaker protection.
 *
 * This wrapper adds circuit breaker protection around DO method calls to prevent
 * cascading failures when the target DO is unavailable or slow.
 *
 * @example
 * ```typescript
 * interface CounterDO {
 *   increment(): Promise<number>
 *   getValue(): Promise<number>
 * }
 *
 * // With circuit breaker (enabled by default)
 * const counter = createDOStubWithCircuitBreaker<CounterDO>(env.COUNTER, 'my-counter')
 *
 * // With custom circuit breaker config
 * const counter = createDOStubWithCircuitBreaker<CounterDO>(env.COUNTER, 'my-counter', {
 *   circuitBreaker: {
 *     failureThreshold: 3,
 *     resetTimeoutMs: 10000,
 *     fallback: () => ({ error: 'Service unavailable' })
 *   }
 * })
 *
 * // Disable circuit breaker
 * const counter = createDOStubWithCircuitBreaker<CounterDO>(env.COUNTER, 'my-counter', {
 *   circuitBreaker: { enabled: false }
 * })
 * ```
 *
 * @param binding - The DurableObjectNamespace binding
 * @param id - Either a string name or a DurableObjectId
 * @param options - Optional configuration including circuit breaker settings
 * @returns A typed proxy with circuit breaker protection
 */
export function createDOStubWithCircuitBreaker<T extends object>(
  binding: DurableObjectNamespace,
  id: string | DurableObjectId,
  options?: DOStubWithCircuitBreakerOptions
): ReturnType<typeof createDOStub<T>> {
  const cbConfig = options?.circuitBreaker
  const enabled = cbConfig?.enabled !== false // Default to enabled

  // If circuit breaker is disabled, use regular createDOStub
  if (!enabled) {
    return createDOStub<T>(binding, id, options)
  }

  // Get the circuit breaker for this DO
  const circuitName = getCircuitName(binding, id, cbConfig?.namePrefix)
  const circuit = getCircuitBreaker(circuitName, {
    ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
    ...cbConfig,
  })

  // Create the underlying stub
  const stub = createDOStub<T>(binding, id, options)

  // Wrap with circuit breaker proxy
  // Cast needed because TypeScript can't infer that the proxy preserves the stub's type
  return new Proxy(stub, {
    get(_, prop: string | symbol) {
      if (typeof prop === 'symbol') {
        return undefined
      }

      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        return undefined
      }

      // Special property to access circuit breaker stats
      if (prop === '$circuit') {
        return {
          getState: () => circuit.getState(),
          getStats: () => circuit.getStats(),
          forceOpen: () => circuit.forceOpen(),
          forceClose: () => circuit.forceClose(),
          reset: () => circuit.reset(),
        }
      }

      // Wrap method call with circuit breaker
      return async (...args: unknown[]) => {
        const result = await circuit.execute(
          async () => {
            const method = (stub as Record<string, unknown>)[prop]
            if (typeof method !== 'function') {
              throw new Error(`Method ${prop} is not a function`)
            }
            return (method as (...args: unknown[]) => Promise<unknown>)(...args)
          },
          cbConfig?.fallback
        )

        if (result.success) {
          return result.value
        }

        if (result.rejected) {
          // Circuit is open - throw a transport error
          throw TransportError.circuitOpen(circuitName)
        }

        // Operation failed
        throw result.error
      }
    },
  })
}

/**
 * Creates a typed proxy for cross-DO RPC with circuit breaker protection.
 *
 * This wrapper adds circuit breaker protection around cross-DO method calls
 * to prevent cascading failures when target DOs are unavailable.
 *
 * @example
 * ```typescript
 * interface CustomerDO {
 *   getBalance(): Promise<number>
 *   charge(amount: number): Promise<boolean>
 * }
 *
 * // With circuit breaker
 * const customer = createCrossDOClientWithCircuitBreaker<CustomerDO>(
 *   env.Customer,
 *   'customer-123',
 *   undefined, // no cache
 *   {
 *     circuitBreaker: {
 *       failureThreshold: 3,
 *       resetTimeoutMs: 15000
 *     }
 *   }
 * )
 *
 * const balance = await customer.getBalance()
 * ```
 *
 * @param binding - The DurableObjectNamespace binding
 * @param id - Either a string name or a DurableObjectId
 * @param cache - Optional stub cache for connection pooling
 * @param options - Optional RPC and circuit breaker options
 * @returns A typed proxy with circuit breaker protection
 */
export function createCrossDOClientWithCircuitBreaker<T extends object>(
  binding: DurableObjectNamespace,
  id: string | DurableObjectId,
  cache?: CrossDOStubCache,
  options?: CrossDOClientWithCircuitBreakerOptions
): T {
  const cbConfig = options?.circuitBreaker
  const enabled = cbConfig?.enabled !== false // Default to enabled

  // If circuit breaker is disabled, use regular createCrossDOClient
  if (!enabled) {
    return createCrossDOClient<T>(binding, id, cache, options)
  }

  // Get the circuit breaker for this DO
  const circuitName = getCircuitName(binding, id, cbConfig?.namePrefix)
  const circuit = getCircuitBreaker(circuitName, {
    ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
    ...cbConfig,
  })

  // Create the underlying client
  const client = createCrossDOClient<T>(binding, id, cache, options)

  // Wrap with circuit breaker proxy
  return new Proxy({} as T, {
    get(_, prop: string | symbol) {
      if (typeof prop === 'symbol') {
        return undefined
      }

      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        return undefined
      }

      // Special property to access circuit breaker stats
      if (prop === '$circuit') {
        return {
          getState: () => circuit.getState(),
          getStats: () => circuit.getStats(),
          forceOpen: () => circuit.forceOpen(),
          forceClose: () => circuit.forceClose(),
          reset: () => circuit.reset(),
        }
      }

      // Special handling for fetch method
      if (prop === 'fetch') {
        const fetchFn = (client as unknown as { fetch: (url: string, init?: RequestInit) => Promise<unknown> }).fetch
        return async (url: string, init?: RequestInit) => {
          const result = await circuit.execute(
            async () => fetchFn(url, init),
            cbConfig?.fallback
          )

          if (result.success) {
            return result.value
          }

          if (result.rejected) {
            throw TransportError.circuitOpen(circuitName)
          }

          throw result.error
        }
      }

      // Wrap method call with circuit breaker
      return async (...args: unknown[]) => {
        const result = await circuit.execute(
          async () => {
            const method = client[prop as keyof T]
            if (typeof method !== 'function') {
              throw new Error(`Method ${prop} is not a function`)
            }
            return (method as (...args: unknown[]) => Promise<unknown>)(...args)
          },
          cbConfig?.fallback
        )

        if (result.success) {
          return result.value
        }

        if (result.rejected) {
          throw TransportError.circuitOpen(circuitName)
        }

        throw result.error
      }
    },
  })
}

/**
 * Type with $circuit property for accessing circuit breaker controls
 */
export type WithCircuitBreaker<T> = T & {
  $circuit: {
    getState(): DOCircuitState
    getStats(): CircuitStats
    forceOpen(): void
    forceClose(): void
    reset(): void
  }
}

/**
 * Circuit breaker-aware Cross-DO Context factory
 *
 * Creates a Cross-DO context that automatically wraps all DO calls
 * with circuit breaker protection.
 *
 * @example
 * ```typescript
 * import { createCircuitBreakerContext } from '@dotdo/rpc/circuit-breaker'
 *
 * const $ = createCircuitBreakerContext(env, {
 *   failureThreshold: 3,
 *   resetTimeoutMs: 15000
 * })
 *
 * // All calls are protected by circuit breaker
 * const customer = $<CustomerDO>('Customer', 'customer-123')
 * const balance = await customer.getBalance()
 *
 * // Check circuit state
 * const state = customer.$circuit.getState()
 * ```
 */
export function createCircuitBreakerDOAccessor(
  env: Record<string, DurableObjectNamespace>,
  config?: Partial<CircuitBreakerConfig>
): <T extends object>(namespace: string, id: string | DurableObjectId) => WithCircuitBreaker<T> {
  const cache = new CrossDOStubCache()

  return <T extends object>(namespace: string, id: string | DurableObjectId): WithCircuitBreaker<T> => {
    const binding = env[namespace]
    if (!binding) {
      throw new Error(`DO namespace not found: ${namespace}`)
    }

    const options: CrossDOClientWithCircuitBreakerOptions = config
      ? { circuitBreaker: config }
      : {}

    return createCrossDOClientWithCircuitBreaker<T>(binding, id, cache, options) as WithCircuitBreaker<T>
  }
}
