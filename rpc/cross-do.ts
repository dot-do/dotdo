// Cross-DO RPC - Durable Object to Durable Object communication
// Provides typed RPC between DOs with stub caching and connection pooling
// Integrates with observability context for automatic correlation ID propagation

import { RPCError, RPCErrorCode, isSerializedError, deserializeError, TransportError, NotFoundError, ValidationError } from './errors'
import { generateCorrelationId, CORRELATION_ID_HEADER, DO_SOURCE_HEADER, DO_SOURCE_ID_HEADER } from './headers'

// Re-export for convenience
export { generateCorrelationId, CORRELATION_ID_HEADER }
export { DO_SOURCE_HEADER, DO_SOURCE_ID_HEADER }

/**
 * Try to get correlation ID from observability context if available.
 * Falls back to generating a new one if context is not available.
 * This avoids a hard dependency on the observability package while enabling
 * automatic context propagation when it's being used.
 */
function getCorrelationIdFromContext(): string | undefined {
  try {
    // Dynamic require avoids hard dependency on observability package
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const obs = require('../observability/context')
    if (typeof obs.getCorrelationId === 'function') {
      return obs.getCorrelationId() || undefined
    }
  } catch {
    // observability module not available, that's fine
  }
  return undefined
}

/**
 * Options for cross-DO RPC calls
 */
export interface CrossDORPCOptions {
  /** Optional correlation ID to use for request tracing */
  correlationId?: string | undefined
  /** Source DO ID for trust chain (do-nuwe) */
  sourceDoId?: string | undefined
}

/**
 * Type guard to check if a value is a DurableObjectId
 */
function isDurableObjectId(id: unknown): id is DurableObjectId {
  return typeof id === 'object' && id !== null && 'toString' in id && typeof id !== 'string'
}

/**
 * Stub cache for connection pooling
 * Caches DO stubs to avoid repeated binding.get() calls
 */
export class CrossDOStubCache {
  // Use WeakMap to track per-namespace caches
  private namespaceCache = new WeakMap<DurableObjectNamespace, Map<string, DurableObjectStub>>()

  /**
   * Get the cache for a specific namespace
   */
  private getNamespaceCache(binding: DurableObjectNamespace): Map<string, DurableObjectStub> {
    let cache = this.namespaceCache.get(binding)
    if (!cache) {
      cache = new Map()
      this.namespaceCache.set(binding, cache)
    }
    return cache
  }

  /**
   * Get cache key from id
   */
  private getIdKey(id: string | DurableObjectId): string {
    return typeof id === 'string' ? id : id.toString()
  }

  /**
   * Get or create a DO stub
   */
  getStub(binding: DurableObjectNamespace, id: string | DurableObjectId): DurableObjectStub {
    const cache = this.getNamespaceCache(binding)
    const idKey = this.getIdKey(id)

    let stub = cache.get(idKey)
    if (!stub) {
      const doId = isDurableObjectId(id) ? id : binding.idFromName(id)
      stub = binding.get(doId)
      cache.set(idKey, stub)
    }

    return stub
  }

  /**
   * Clear all cached stubs across all namespaces
   */
  clear(): void {
    // WeakMap doesn't have a clear method, so we need to track namespaces
    // For now, just create a new WeakMap
    this.namespaceCache = new WeakMap()
  }

  /**
   * Evict all stubs for a specific namespace
   */
  evictNamespace(binding: DurableObjectNamespace): void {
    const cache = this.namespaceCache.get(binding)
    if (cache) {
      cache.clear()
    }
  }

  /**
   * Evict a specific DO stub
   */
  evict(binding: DurableObjectNamespace, id: string | DurableObjectId): void {
    const cache = this.namespaceCache.get(binding)
    if (cache) {
      const idKey = this.getIdKey(id)
      cache.delete(idKey)
    }
  }
}

/**
 * Creates a typed proxy client for cross-DO RPC calls.
 *
 * This function wraps a DurableObject binding and provides a typed interface
 * for calling methods on another DO via fetch-based RPC.
 *
 * @example
 * ```typescript
 * interface CustomerDO {
 *   getBalance(): Promise<number>
 *   charge(amount: number): Promise<boolean>
 * }
 *
 * const customer = createCrossDOClient<CustomerDO>(env.Customer, 'customer-123')
 * const balance = await customer.getBalance()
 * const charged = await customer.charge(100)
 * ```
 *
 * @param binding - The DurableObjectNamespace binding
 * @param id - Either a string name or a DurableObjectId
 * @param cache - Optional stub cache for connection pooling
 * @param options - Optional RPC options including correlation ID
 * @returns A typed proxy that forwards method calls to the remote DO
 */
export function createCrossDOClient<T extends object>(
  binding: DurableObjectNamespace,
  id: string | DurableObjectId,
  cache?: CrossDOStubCache,
  options?: CrossDORPCOptions
): T {
  // Get or create stub (with optional caching)
  const stub = cache ? cache.getStub(binding, id) : (() => {
    const doId = isDurableObjectId(id) ? id : binding.idFromName(id)
    return binding.get(doId)
  })()

  const baseCorrelationId = options?.correlationId
  const sourceDoId = options?.sourceDoId

  return new Proxy({} as T, {
    get(_, prop: string | symbol) {
      // Don't intercept symbols or promise methods
      if (typeof prop === 'symbol') {
        return undefined
      }

      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        return undefined
      }

      // Special method for raw fetch access
      if (prop === 'fetch') {
        return async (url: string, init?: RequestInit) => {
          // Use provided correlation ID, or try to get from context, or generate new one
          const correlationId = baseCorrelationId || getCorrelationIdFromContext() || generateCorrelationId()
          const headers = new Headers(init?.headers)
          headers.set(CORRELATION_ID_HEADER, correlationId)

          // Add DO source headers for trust chain (do-nuwe)
          if (sourceDoId) {
            headers.set(DO_SOURCE_HEADER, 'true')
            headers.set(DO_SOURCE_ID_HEADER, sourceDoId)
          }

          let response: Response
          try {
            response = await stub.fetch(url, { ...init, headers })
          } catch (error) {
            // Handle transport-level errors (DO stub failures, network issues, etc.)
            throw TransportError.stubFailed(error instanceof Error ? error : new Error(String(error)))
          }

          if (!response.ok) {
            const responseCorrelationId = response.headers.get(CORRELATION_ID_HEADER) || correlationId
            const errorBody = await response.json().catch(() => null) as { message?: string } | null

            // If the response is a structured error, deserialize it
            if (errorBody && isSerializedError(errorBody)) {
              const deserializedError = deserializeError(errorBody)
              // Add correlation ID to error details if it's an RPCError
              if (deserializedError instanceof RPCError) {
                throw new RPCError(
                  deserializedError.code,
                  deserializedError.message,
                  { ...deserializedError.details, correlationId: responseCorrelationId }
                )
              }
              throw deserializedError
            }

            // Fallback: create an RPCError with the HTTP status
            throw new RPCError(
              RPCErrorCode.INTERNAL_ERROR,
              errorBody?.message || `Cross-DO fetch error: ${response.status}`,
              { status: response.status, correlationId: responseCorrelationId, ...errorBody }
            )
          }
          return response.json()
        }
      }

      // Return method invoker
      return async (...args: unknown[]) => {
        // Use provided correlation ID, or try to get from context, or generate new one
        const correlationId = baseCorrelationId || getCorrelationIdFromContext() || generateCorrelationId()

        // Build headers with DO source info for trust chain (do-nuwe)
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          [CORRELATION_ID_HEADER]: correlationId,
        }

        if (sourceDoId) {
          headers[DO_SOURCE_HEADER] = 'true'
          headers[DO_SOURCE_ID_HEADER] = sourceDoId
        }

        let response: Response
        try {
          response = await stub.fetch('https://do/rpc', {
            method: 'POST',
            headers,
            body: JSON.stringify({ method: prop, args }),
          })
        } catch (error) {
          // Handle transport-level errors (DO stub failures, network issues, etc.)
          throw TransportError.stubFailed(error instanceof Error ? error : new Error(String(error)))
        }

        if (!response.ok) {
          const responseCorrelationId = response.headers.get(CORRELATION_ID_HEADER) || correlationId
          const errorBody = await response.json().catch(() => null) as { message?: string } | null

          // If the response is a structured error, deserialize it
          if (errorBody && isSerializedError(errorBody)) {
            const deserializedError = deserializeError(errorBody)
            // Add correlation ID to error details if it's an RPCError
            if (deserializedError instanceof RPCError) {
              throw new RPCError(
                deserializedError.code,
                deserializedError.message,
                { ...deserializedError.details, correlationId: responseCorrelationId }
              )
            }
            throw deserializedError
          }

          // Fallback: create an RPCError with the HTTP status
          throw new RPCError(
            RPCErrorCode.INTERNAL_ERROR,
            errorBody?.message || `Cross-DO RPC error: ${response.status}`,
            { status: response.status, correlationId: responseCorrelationId, method: prop, ...errorBody }
          )
        }

        return response.json()
      }
    }
  })
}

/**
 * Options for CrossDOContext
 */
export interface CrossDOContextOptions {
  /** Optional correlation ID to propagate through all DO-to-DO calls */
  correlationId?: string
  /** Source DO ID for trust chain (do-nuwe) - identifies the calling DO */
  sourceDoId?: string
}

/**
 * Cross-DO Context - provides $ style syntax for DO-to-DO calls
 *
 * This class provides a proxy-based API for calling methods on other DOs
 * using the familiar $.Namespace(id).method() syntax.
 *
 * @example
 * ```typescript
 * const $ = new CrossDOContext(env)
 *
 * // Call methods on other DOs
 * const balance = await $.Customer<CustomerDO>('customer-123').getBalance()
 * const status = await $.Order<OrderDO>('order-456').getStatus()
 *
 * // Broadcast to multiple DOs
 * const results = await $.Customer<CustomerDO>().broadcast(
 *   ['c1', 'c2', 'c3'],
 *   'notify',
 *   'Your order shipped!'
 * )
 *
 * // With correlation ID for request tracing
 * const $traced = new CrossDOContext(env, { correlationId: 'request-123' })
 * await $traced.Customer<CustomerDO>('customer-456').getBalance()
 * ```
 */
export class CrossDOContext {
  private cache: CrossDOStubCache
  private env: Record<string, DurableObjectNamespace>
  private correlationId?: string
  private sourceDoId?: string

  constructor(env: Record<string, DurableObjectNamespace>, options?: CrossDOContextOptions) {
    this.env = env
    this.cache = new CrossDOStubCache()
    if (options?.correlationId !== undefined) {
      this.correlationId = options.correlationId
    }
    if (options?.sourceDoId !== undefined) {
      this.sourceDoId = options.sourceDoId
    }

    // Return proxy for namespace access
    return new Proxy(this, {
      get(target, namespace: string | symbol) {
        if (typeof namespace === 'symbol') {
          return undefined
        }

        // Pass through internal properties
        if (namespace in target) {
          return (target as Record<string, unknown>)[namespace]
        }

        // Return namespace accessor
        return target.getNamespaceAccessor(namespace)
      }
    }) as CrossDOContext
  }

  /**
   * Get accessor for a specific DO namespace
   */
  private getNamespaceAccessor(namespace: string) {
    const binding = this.env[namespace]

    if (!binding) {
      throw NotFoundError.forResource('DONamespace', namespace)
    }

    const cache = this.cache
    const contextCorrelationId = this.correlationId
    const contextSourceDoId = this.sourceDoId

    // Return a function that creates typed DO clients
    return <T extends object>(id?: string | DurableObjectId) => {
      if (!id) {
        // No id provided - return broadcast helper
        return {
          broadcast: async <K extends keyof T>(
            ids: string[],
            method: K,
            ...args: T[K] extends (...args: infer A) => unknown ? A : never[]
          ): Promise<Awaited<ReturnType<T[K] extends (...args: unknown[]) => infer R ? () => R : never>>[]> => {
            // Use context correlation ID or generate a shared one for the broadcast
            const correlationId = contextCorrelationId || generateCorrelationId()
            const options: CrossDORPCOptions = {
              correlationId,
              sourceDoId: contextSourceDoId,
            }

            const promises = ids.map(async (doId) => {
              const client = createCrossDOClient<T>(binding, doId, cache, options)
              // Access the method using keyof T - client is typed as T
              const methodFn = client[method]
              if (typeof methodFn !== 'function') {
                throw ValidationError.forField('method', `${String(method)} is not a function`)
              }
              // Cast to callable function type for proper invocation
              return (methodFn as (...args: unknown[]) => Promise<unknown>)(...args)
            })

            // Cast Promise.all result to match the declared return type
            return Promise.all(promises) as Promise<Awaited<ReturnType<T[K] extends (...args: unknown[]) => infer R ? () => R : never>>[]>
          }
        }
      }

      // Create options with correlation ID and source DO ID if available
      const options: CrossDORPCOptions = {}
      if (contextCorrelationId) {
        options.correlationId = contextCorrelationId
      }
      if (contextSourceDoId) {
        options.sourceDoId = contextSourceDoId
      }

      return createCrossDOClient<T>(binding, id, cache, Object.keys(options).length > 0 ? options : undefined)
    }
  }

  /**
   * Clear all cached stubs
   */
  clearCache(): void {
    this.cache.clear()
  }

  /**
   * Evict cached stubs for a namespace
   */
  evictNamespace(namespace: string): void {
    const binding = this.env[namespace]
    if (binding) {
      this.cache.evictNamespace(binding)
    }
  }
}

/**
 * Type helper for DO context - enables autocomplete for namespace methods
 */
export type DOContext<T extends Record<string, DurableObjectNamespace>> = {
  [K in keyof T]: <D extends object>(id?: string | DurableObjectId) =>
    D & {
      broadcast: <M extends keyof D>(
        ids: string[],
        method: M,
        ...args: D[M] extends (...args: infer A) => unknown ? A : never[]
      ) => Promise<Awaited<ReturnType<D[M] extends (...args: unknown[]) => infer R ? () => R : never>>[]>
    }
}
