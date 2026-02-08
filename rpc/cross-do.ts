// Cross-DO RPC - Durable Object to Durable Object communication
// Provides typed RPC between DOs with stub caching and connection pooling
// Integrates with observability context for automatic correlation ID propagation
// Includes exponential backoff retry for transient errors (do-bkkfj)

import { RPCError, RPCErrorCode, isSerializedError, deserializeError, TransportError, NotFoundError, ValidationError } from './errors'
import { generateCorrelationId, CORRELATION_ID_HEADER, DO_SOURCE_HEADER, DO_SOURCE_ID_HEADER } from './headers'
import { getCircuitBreaker } from '@dotdo/utils'
import { contextToHeaders, type $Context } from './context'

// Re-export for convenience
export { generateCorrelationId, CORRELATION_ID_HEADER }
export { DO_SOURCE_HEADER, DO_SOURCE_ID_HEADER }

// Note: Correlation ID propagation is handled via explicit options.correlationId parameter.
// Callers with access to @dotdo/observability can pass getCorrelationId() directly:
//
//   import { getCorrelationId } from '@dotdo/observability'
//   const client = createCrossDOClient<T>(binding, id, cache, {
//     correlationId: getCorrelationId()
//   })
//
// This design avoids:
// 1. Dynamic require() in ESM modules (fragile at runtime)
// 2. Implicit coupling between @dotdo/rpc and @dotdo/observability
// 3. Silent failures that are hard to debug
// 4. Tree-shaking issues with dynamic imports

/**
 * Retry configuration for cross-DO RPC calls (do-bkkfj)
 */
export interface CrossDORetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number
  /** Base delay in milliseconds for exponential backoff (default: 100) */
  baseDelay?: number
  /** Maximum delay in milliseconds (default: 5000) */
  maxDelay?: number
}

/**
 * Default retry configuration for cross-DO RPC (do-bkkfj)
 */
export const DEFAULT_CROSS_DO_RETRY: Required<CrossDORetryOptions> = {
  maxRetries: 3,
  baseDelay: 100,
  maxDelay: 5000,
}

/**
 * Check if an error is transient and should be retried.
 * Transport/network errors and 5xx responses are transient.
 * 4xx errors (validation, auth, not found, etc.) are permanent.
 */
function isTransientError(error: unknown): boolean {
  // Transport errors (network failures, DNS, etc.) are always transient
  if (error instanceof TransportError) {
    return true
  }

  // RPCError with status info — check HTTP status
  if (error instanceof RPCError) {
    // 4xx errors are permanent — do not retry
    if (error.httpStatus >= 400 && error.httpStatus < 500) {
      return false
    }
    // 5xx errors are transient
    if (error.httpStatus >= 500) {
      return true
    }
  }

  // Unknown errors are treated as transient (safe default)
  return true
}

/**
 * Execute a function with exponential backoff retry for transient errors (do-bkkfj).
 * Only retries on transient errors (5xx, network). Permanent errors (4xx) are thrown immediately.
 *
 * @param fn - The async function to execute
 * @param retryConfig - Retry configuration
 * @returns The result of the function
 */
async function executeWithRetry<T>(
  fn: () => Promise<T>,
  retryConfig: Required<CrossDORetryOptions>
): Promise<T> {
  const { maxRetries, baseDelay, maxDelay } = retryConfig
  let lastError: unknown

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      // Don't retry permanent errors or if we've exhausted retries
      if (!isTransientError(error) || attempt >= maxRetries) {
        throw error
      }

      // Exponential backoff with full jitter: random[0, min(maxDelay, baseDelay * 2^attempt)]
      const exponentialDelay = Math.min(maxDelay, baseDelay * Math.pow(2, attempt))
      const jitteredDelay = Math.random() * exponentialDelay
      await new Promise((resolve) => setTimeout(resolve, jitteredDelay))
    }
  }

  throw lastError
}

/**
 * Options for cross-DO RPC calls
 */
export interface CrossDORPCOptions {
  /** Optional correlation ID to use for request tracing */
  correlationId?: string | undefined
  /** Source DO ID for trust chain (do-nuwe) */
  sourceDoId?: string | undefined
  /** Retry configuration for transient errors (do-bkkfj). Set to false to disable. Default: enabled with DEFAULT_CROSS_DO_RETRY. */
  retry?: CrossDORetryOptions | false
  /** $Context to propagate through the call chain (do-99vxp) */
  $context?: $Context | undefined
}

/**
 * Type guard to check if a value is a DurableObjectId.
 *
 * Uses multiple checks to ensure the value is a real DurableObjectId:
 * 1. Must be a non-null object
 * 2. Must have an `equals` method (unique to DurableObjectId)
 * 3. Must have a `toString` method
 * 4. Must have a `name` property (present on all DurableObjectIds)
 * 5. The `toString()` result must be a non-empty string (real IDs return hex strings)
 *
 * This is more robust than just checking for method existence, which could be
 * spoofed by any object with matching method signatures.
 */
function isDurableObjectId(id: unknown): id is DurableObjectId {
  if (typeof id !== 'object' || id === null) {
    return false
  }

  const candidate = id as DurableObjectId

  // Check required methods exist
  if (typeof candidate.equals !== 'function' || typeof candidate.toString !== 'function') {
    return false
  }

  // Real DurableObjectIds have a 'name' property (may be undefined but property exists)
  if (!('name' in candidate)) {
    return false
  }

  // Additional validation: toString() should return a non-empty string
  // Real DurableObjectIds return 64-character hex strings
  try {
    const str = candidate.toString()
    if (typeof str !== 'string' || str.length === 0) {
      return false
    }
  } catch {
    // If toString() throws, it's not a valid DurableObjectId
    return false
  }

  return true
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
   * Get or create a DO stub.
   *
   * Uses a compute-if-absent pattern to prevent race conditions where multiple
   * concurrent calls might create duplicate stubs for the same ID.
   *
   * In JavaScript's single-threaded execution model, the synchronous portion
   * of this method (check + set) is atomic. However, since `binding.get()` is
   * synchronous and the cache operations are synchronous, we can safely use
   * a simple check-then-set pattern.
   *
   * The key insight is that even if multiple async operations call getStub()
   * concurrently, each synchronous execution block completes atomically.
   * The first call to complete will populate the cache, and subsequent calls
   * will find the cached value.
   */
  getStub(binding: DurableObjectNamespace, id: string | DurableObjectId): DurableObjectStub {
    const cache = this.getNamespaceCache(binding)
    const idKey = this.getIdKey(id)

    // Check cache first - this is the fast path
    let existingStub = cache.get(idKey)
    if (existingStub !== undefined) {
      return existingStub
    }

    // Create new stub - binding.get() is synchronous
    const doId = isDurableObjectId(id) ? id : binding.idFromName(id)
    const newStub = binding.get(doId)

    // Use Map's native set which is atomic in single-threaded JS
    // If another call raced and set a value between our get and set,
    // we'll overwrite it with our stub. This is safe because all stubs
    // pointing to the same DO ID are functionally equivalent.
    //
    // However, for consistency (returning the same stub instance for the
    // same ID within a cache lifetime), we do a final check and prefer
    // any existing stub that may have been set by a racing call.
    existingStub = cache.get(idKey)
    if (existingStub !== undefined) {
      // Another call won the race - return their stub for consistency
      // Note: newStub will be garbage collected since it's not referenced
      return existingStub
    }

    // We won the race - store and return our stub
    cache.set(idKey, newStub)
    return newStub
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
  const $ctx = options?.$context

  // Pre-compute $Context headers if a context is provided (do-99vxp)
  const contextHeaders: Record<string, string> | null = $ctx ? contextToHeaders($ctx) : null

  // Resolve retry configuration (do-bkkfj)
  // Default: enabled with DEFAULT_CROSS_DO_RETRY
  const retryConfig: Required<CrossDORetryOptions> | null =
    options?.retry === false
      ? null
      : { ...DEFAULT_CROSS_DO_RETRY, ...(options?.retry ?? {}) }

  /**
   * Execute an async operation, optionally wrapping with retry logic.
   */
  const maybeRetry = <R>(fn: () => Promise<R>): Promise<R> => {
    if (!retryConfig) return fn()
    return executeWithRetry(fn, retryConfig)
  }

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
          return maybeRetry(async () => {
            // Use provided correlation ID or generate new one
            const correlationId = baseCorrelationId || generateCorrelationId()
            const headers = new Headers(init?.headers)
            headers.set(CORRELATION_ID_HEADER, correlationId)

            // Add $Context headers for context propagation (do-99vxp)
            if (contextHeaders) {
              for (const [key, value] of Object.entries(contextHeaders)) {
                headers.set(key, value)
              }
            }

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
          })
        }
      }

      // Return method invoker
      return async (...args: unknown[]) => {
        return maybeRetry(async () => {
          // Use provided correlation ID or generate new one
          const correlationId = baseCorrelationId || generateCorrelationId()

          // Build headers with DO source info for trust chain (do-nuwe)
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            [CORRELATION_ID_HEADER]: correlationId,
          }

          // Add $Context headers for context propagation (do-99vxp)
          if (contextHeaders) {
            Object.assign(headers, contextHeaders)
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
        })
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
  /** Retry configuration for transient errors (do-bkkfj). Set to false to disable. Default: enabled. */
  retry?: CrossDORetryOptions | false
  /**
   * Whether to enable circuit breaker for all calls through this context (do-bkkfj).
   * Default: true. Set to false to disable circuit breaker protection.
   */
  circuitBreaker?: boolean
  /** $Context to propagate through all calls (do-99vxp) */
  $context?: $Context
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
  private retryConfig?: CrossDORetryOptions | false
  /** Circuit breaker enabled by default (do-bkkfj) */
  private useCircuitBreaker: boolean
  /** $Context for propagation through all calls (do-99vxp) */
  private $context?: $Context

  constructor(env: Record<string, DurableObjectNamespace>, options?: CrossDOContextOptions) {
    this.env = env
    this.cache = new CrossDOStubCache()
    // Circuit breaker is default-on (do-bkkfj)
    this.useCircuitBreaker = options?.circuitBreaker !== false
    if (options?.correlationId !== undefined) {
      this.correlationId = options.correlationId
    }
    if (options?.sourceDoId !== undefined) {
      this.sourceDoId = options.sourceDoId
    }
    if (options?.retry !== undefined) {
      this.retryConfig = options.retry
    }
    if (options?.$context !== undefined) {
      this.$context = options.$context
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
   * Build CrossDORPCOptions from context state
   */
  private buildOptions(): CrossDORPCOptions {
    const options: CrossDORPCOptions = {}
    if (this.correlationId) {
      options.correlationId = this.correlationId
    }
    if (this.sourceDoId) {
      options.sourceDoId = this.sourceDoId
    }
    if (this.retryConfig !== undefined) {
      options.retry = this.retryConfig
    }
    if (this.$context) {
      options.$context = this.$context
    }
    return options
  }

  /**
   * Wrap a client proxy with circuit breaker protection (do-bkkfj).
   * If circuit breaker is disabled, returns the client as-is.
   */
  private wrapWithCircuitBreaker<T extends object>(
    client: T,
    namespace: string,
    id: string | DurableObjectId
  ): T {
    if (!this.useCircuitBreaker) {
      return client
    }

    const idStr = typeof id === 'string' ? id : id.toString()
    const shortId = idStr.length > 32 ? idStr.slice(0, 32) : idStr
    const circuitName = `do-rpc:${namespace}:${shortId}`
    const circuit = getCircuitBreaker(circuitName, {
      failureThreshold: 5,
      resetTimeoutMs: 30000,
      successThreshold: 3,
      timeoutMs: 10000,
      halfOpenRequestRatio: 0.1,
    })

    return new Proxy({} as T, {
      get(_, prop: string | symbol) {
        if (typeof prop === 'symbol') return undefined
        if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined

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
          const result = await circuit.execute(async () => {
            const method = client[prop as keyof T]
            if (typeof method !== 'function') {
              throw new Error(`Method ${String(prop)} is not a function`)
            }
            return (method as (...a: unknown[]) => Promise<unknown>)(...args)
          })

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
   * Get accessor for a specific DO namespace
   */
  private getNamespaceAccessor(namespace: string) {
    const binding = this.env[namespace]

    if (!binding) {
      throw NotFoundError.forResource('DONamespace', namespace)
    }

    const cache = this.cache
    const self = this

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
            const correlationId = self.correlationId || generateCorrelationId()
            const options = self.buildOptions()
            options.correlationId = correlationId

            const promises = ids.map(async (doId) => {
              const rawClient = createCrossDOClient<T>(binding, doId, cache, options)
              const client = self.wrapWithCircuitBreaker(rawClient, namespace, doId)
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

      const options = self.buildOptions()
      const rawClient = createCrossDOClient<T>(binding, id, cache, Object.keys(options).length > 0 ? options : undefined)
      return self.wrapWithCircuitBreaker(rawClient, namespace, id)
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
