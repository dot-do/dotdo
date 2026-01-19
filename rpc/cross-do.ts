// Cross-DO RPC - Durable Object to Durable Object communication
// Provides typed RPC between DOs with stub caching and connection pooling

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
 * @returns A typed proxy that forwards method calls to the remote DO
 */
export function createCrossDOClient<T extends object>(
  binding: DurableObjectNamespace,
  id: string | DurableObjectId,
  cache?: CrossDOStubCache
): T {
  // Get or create stub (with optional caching)
  const stub = cache ? cache.getStub(binding, id) : (() => {
    const doId = isDurableObjectId(id) ? id : binding.idFromName(id)
    return binding.get(doId)
  })()

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
          const response = await stub.fetch(url, init)
          if (!response.ok) {
            throw new Error(`Cross-DO fetch error: ${response.status}`)
          }
          return response.json()
        }
      }

      // Return method invoker
      return async (...args: unknown[]) => {
        const response = await stub.fetch('https://do/rpc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: prop, args }),
        })

        if (!response.ok) {
          throw new Error(`Cross-DO RPC error: ${response.status}`)
        }

        return response.json()
      }
    }
  })
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
 * ```
 */
export class CrossDOContext {
  private cache: CrossDOStubCache
  private env: Record<string, DurableObjectNamespace>

  constructor(env: Record<string, DurableObjectNamespace>) {
    this.env = env
    this.cache = new CrossDOStubCache()

    // Return proxy for namespace access
    return new Proxy(this, {
      get(target, namespace: string | symbol) {
        if (typeof namespace === 'symbol') {
          return undefined
        }

        // Pass through internal properties
        if (namespace in target) {
          return (target as any)[namespace]
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
      throw new Error(`DO namespace not found: ${namespace}`)
    }

    const cache = this.cache

    // Return a function that creates typed DO clients
    return <T extends object>(id?: string | DurableObjectId) => {
      if (!id) {
        // No id provided - return broadcast helper
        return {
          broadcast: async <K extends keyof T>(
            ids: string[],
            method: K,
            ...args: T[K] extends (...args: infer A) => any ? A : never[]
          ): Promise<Awaited<ReturnType<T[K] extends (...args: any[]) => infer R ? () => R : never>>[]> => {
            const promises = ids.map(async (doId) => {
              const client = createCrossDOClient<T>(binding, doId, cache)
              const fn = client[method as string]
              if (typeof fn !== 'function') {
                throw new Error(`Method ${String(method)} is not a function`)
              }
              return (fn as Function).apply(client, args)
            })

            return Promise.all(promises)
          }
        }
      }

      return createCrossDOClient<T>(binding, id, cache)
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
        ...args: D[M] extends (...args: infer A) => any ? A : never[]
      ) => Promise<Awaited<ReturnType<D[M] extends (...args: any[]) => infer R ? () => R : never>>[]>
    }
}
