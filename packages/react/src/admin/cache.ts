/**
 * Cache Utilities
 *
 * Smart cache invalidation and optimistic update utilities
 * for the admin data layer.
 *
 * @module @dotdo/react/admin
 */

import * as React from 'react'
import type { BaseRecord } from './types'
import { getRecordId } from './types'

// =============================================================================
// Types
// =============================================================================

/**
 * Cache configuration
 */
export interface CacheConfig {
  /** Time-to-live in milliseconds (default: 5 minutes) */
  ttl?: number
  /** Enable stale-while-revalidate pattern */
  staleWhileRevalidate?: boolean
  /** Maximum stale time in milliseconds */
  maxStale?: number
  /** Resources that invalidate this cache */
  invalidatedBy?: string[]
}

/**
 * Optimistic update configuration
 */
export interface OptimisticConfig<T extends BaseRecord> {
  /** Resource name */
  resource: string
  /** The operation type */
  type: 'create' | 'update' | 'delete'
  /** Record ID (for update/delete) */
  id?: string
  /** New/updated data */
  data?: Partial<T>
  /** Original data for rollback */
  previousData?: T
  /** Callback when mutation succeeds */
  onSuccess?: (data: T) => void
  /** Callback when mutation fails */
  onError?: (error: Error, previousData?: T) => void
  /** Callback to rollback optimistic update */
  onRollback?: (previousData?: T) => void
}

/**
 * Cache entry with metadata
 */
interface CacheEntry<T> {
  data: T
  fetchedAt: number
  staleAt: number
  expiresAt: number
}

// =============================================================================
// Cache Key Generation
// =============================================================================

/**
 * Create a cache key from parameters.
 *
 * Generates a consistent, serializable key for caching query results.
 *
 * @example
 * ```ts
 * const key = createCacheKey('User', {
 *   pagination: { page: 1, perPage: 25 },
 *   sort: { field: 'name', order: 'asc' },
 *   filter: { role: 'admin' },
 * })
 * // 'User:{"filter":{"role":"admin"},"pagination":{"page":1,"perPage":25},"sort":{"field":"name","order":"asc"}}'
 * ```
 */
export function createCacheKey(
  resource: string,
  params?: Record<string, unknown>
): string {
  if (!params || Object.keys(params).length === 0) {
    return resource
  }

  // Sort keys for consistent ordering
  const sortedParams = sortObjectKeys(params)
  return `${resource}:${JSON.stringify(sortedParams)}`
}

/**
 * Create a cache key for a single record
 */
export function createRecordCacheKey(resource: string, id: string): string {
  return `${resource}:${id}`
}

// =============================================================================
// Cache Invalidation
// =============================================================================

/**
 * Cache invalidation manager.
 *
 * Tracks cache entries and handles invalidation based on mutations.
 */
class CacheManager {
  private cache = new Map<string, CacheEntry<unknown>>()
  private subscribers = new Map<string, Set<() => void>>()
  private resourceDependencies = new Map<string, Set<string>>()

  /**
   * Get a cached value if still valid
   */
  get<T>(key: string, config: CacheConfig = {}): T | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined
    if (!entry) return null

    const now = Date.now()

    // Expired - remove and return null
    if (now > entry.expiresAt) {
      this.cache.delete(key)
      return null
    }

    // Stale but usable with stale-while-revalidate
    if (now > entry.staleAt && config.staleWhileRevalidate) {
      // Trigger background revalidation
      this.notifySubscribers(key)
    }

    return entry.data
  }

  /**
   * Set a cached value
   */
  set<T>(key: string, data: T, config: CacheConfig = {}): void {
    const now = Date.now()
    const ttl = config.ttl ?? 5 * 60 * 1000 // 5 minutes default
    const maxStale = config.maxStale ?? ttl

    const entry: CacheEntry<T> = {
      data,
      fetchedAt: now,
      staleAt: now + ttl,
      expiresAt: now + ttl + maxStale,
    }

    this.cache.set(key, entry)

    // Track resource dependencies
    if (config.invalidatedBy) {
      for (const dep of config.invalidatedBy) {
        if (!this.resourceDependencies.has(dep)) {
          this.resourceDependencies.set(dep, new Set())
        }
        this.resourceDependencies.get(dep)!.add(key)
      }
    }
  }

  /**
   * Invalidate cache entries for a resource
   */
  invalidate(resource: string): void {
    // Invalidate direct resource entries
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${resource}:`)) {
        this.cache.delete(key)
        this.notifySubscribers(key)
      }
    }

    // Invalidate dependent caches
    const dependencies = this.resourceDependencies.get(resource)
    if (dependencies) {
      for (const key of dependencies) {
        this.cache.delete(key)
        this.notifySubscribers(key)
      }
    }

    // Notify resource-level subscribers
    this.notifySubscribers(resource)
  }

  /**
   * Subscribe to cache invalidations
   */
  subscribe(key: string, callback: () => void): () => void {
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set())
    }
    this.subscribers.get(key)!.add(callback)

    return () => {
      this.subscribers.get(key)?.delete(callback)
    }
  }

  /**
   * Clear all cached data
   */
  clear(): void {
    this.cache.clear()
    for (const key of this.subscribers.keys()) {
      this.notifySubscribers(key)
    }
  }

  private notifySubscribers(key: string): void {
    const callbacks = this.subscribers.get(key)
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback()
        } catch (err) {
          console.error('Cache subscriber error:', err)
        }
      }
    }
  }
}

// Global cache manager instance
const cacheManager = new CacheManager()

/**
 * Invalidate cache for a resource.
 *
 * Call this after mutations to ensure fresh data is fetched.
 *
 * @example
 * ```ts
 * await dataProvider.create({ resource: 'User', data })
 * invalidateCache('User')
 * ```
 */
export function invalidateCache(resource: string): void {
  cacheManager.invalidate(resource)
}

/**
 * Clear all cached data
 */
export function clearCache(): void {
  cacheManager.clear()
}

/**
 * Get cached data
 */
export function getCachedData<T>(key: string, config?: CacheConfig): T | null {
  return cacheManager.get<T>(key, config)
}

/**
 * Set cached data
 */
export function setCachedData<T>(
  key: string,
  data: T,
  config?: CacheConfig
): void {
  cacheManager.set(key, data, config)
}

/**
 * Subscribe to cache invalidations
 */
export function subscribeToCache(key: string, callback: () => void): () => void {
  return cacheManager.subscribe(key, callback)
}

// =============================================================================
// Optimistic Update Hook
// =============================================================================

/**
 * Hook for managing optimistic updates with automatic rollback.
 *
 * @example
 * ```tsx
 * function TodoItem({ todo }) {
 *   const { applyUpdate, isPending } = useOptimisticUpdate<Todo>()
 *
 *   const handleToggle = async () => {
 *     await applyUpdate({
 *       resource: 'Todo',
 *       type: 'update',
 *       id: todo.id,
 *       data: { completed: !todo.completed },
 *       previousData: todo,
 *       onSuccess: () => console.log('Saved!'),
 *       onError: (err) => console.error('Failed:', err),
 *     })
 *   }
 *
 *   return (
 *     <button onClick={handleToggle} disabled={isPending}>
 *       {todo.completed ? 'Completed' : 'Mark Done'}
 *     </button>
 *   )
 * }
 * ```
 */
export function useOptimisticUpdate<T extends BaseRecord>() {
  const [pending, setPending] = React.useState<Map<string, OptimisticConfig<T>>>(
    new Map()
  )

  const applyUpdate = React.useCallback(
    async (
      config: OptimisticConfig<T>,
      mutationFn: () => Promise<T>
    ): Promise<T> => {
      const updateKey =
        config.id ?? `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`

      // Track pending mutation
      setPending((prev) => new Map(prev).set(updateKey, config))

      try {
        const result = await mutationFn()

        // Success - notify and clean up
        config.onSuccess?.(result)
        setPending((prev) => {
          const next = new Map(prev)
          next.delete(updateKey)
          return next
        })

        // Invalidate cache
        invalidateCache(config.resource)

        return result
      } catch (err) {
        // Failure - rollback and notify
        config.onRollback?.(config.previousData)
        config.onError?.(err as Error, config.previousData)

        setPending((prev) => {
          const next = new Map(prev)
          next.delete(updateKey)
          return next
        })

        throw err
      }
    },
    []
  )

  const isPending = pending.size > 0
  const pendingUpdates = Array.from(pending.values())

  return React.useMemo(
    () => ({
      applyUpdate,
      isPending,
      pendingUpdates,
      pendingCount: pending.size,
    }),
    [applyUpdate, isPending, pendingUpdates, pending.size]
  )
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Sort object keys recursively for consistent serialization
 */
function sortObjectKeys(obj: Record<string, unknown>): Record<string, unknown> {
  if (Array.isArray(obj)) {
    return obj.map((item) =>
      typeof item === 'object' && item !== null
        ? sortObjectKeys(item as Record<string, unknown>)
        : item
    ) as unknown as Record<string, unknown>
  }

  if (typeof obj !== 'object' || obj === null) {
    return obj
  }

  const sorted: Record<string, unknown> = {}
  const keys = Object.keys(obj).sort()

  for (const key of keys) {
    const value = obj[key]
    sorted[key] =
      typeof value === 'object' && value !== null
        ? sortObjectKeys(value as Record<string, unknown>)
        : value
  }

  return sorted
}
