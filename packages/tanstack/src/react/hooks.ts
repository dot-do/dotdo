/**
 * React hooks for TanStack DB integration with dotdo
 *
 * Provides hooks for:
 * - useDotdoCollection: Real-time collection sync with optimistic updates
 * - useConnectionState: Monitor WebSocket connection state
 * - useDotdoQuery: TanStack Query wrapper for DO data
 * - useDotdoMutation: Mutations with optimistic updates and rollback
 *
 * @module @dotdo/tanstack/react
 */

import * as React from 'react'
import { useSyncContext } from './provider'
import type {
  BaseItem,
  DotdoCollectionConfig,
  UseDotdoCollectionResult,
  UseConnectionStateResult,
  SyncMessage,
  ConnectionState,
} from './types'

// =============================================================================
// useConnectionState - Monitor connection state
// =============================================================================

/**
 * Hook to monitor WebSocket connection state.
 *
 * @returns Connection state including status, reconnect attempts, and last sync time
 *
 * @example
 * ```tsx
 * function ConnectionIndicator() {
 *   const { status, reconnectAttempts } = useConnectionState()
 *
 *   if (status === 'connected') {
 *     return <span className="status-connected">Connected</span>
 *   }
 *
 *   if (status === 'reconnecting') {
 *     return <span className="status-reconnecting">Reconnecting ({reconnectAttempts})...</span>
 *   }
 *
 *   return <span className="status-error">Disconnected</span>
 * }
 * ```
 */
export function useConnectionState(): UseConnectionStateResult {
  const context = useSyncContext()

  return {
    status: context.connectionState,
    reconnectAttempts: context.reconnectAttempts,
    lastSyncAt: context.lastSyncAt,
  }
}

// =============================================================================
// useDotdoCollection - Real-time collection with optimistic updates
// =============================================================================

/**
 * Internal state for optimistic updates
 */
interface OptimisticUpdate<T> {
  type: 'insert' | 'update' | 'delete'
  key: string
  data?: T
  previousData?: T
  timestamp: number
}

/**
 * Hook for real-time collection synchronization with optimistic updates.
 *
 * Features:
 * - WebSocket-based real-time sync
 * - Optimistic updates with automatic rollback on failure
 * - Zod schema validation
 * - Transaction ID tracking for consistency
 *
 * @param config - Collection configuration
 * @returns Collection data and CRUD operations
 *
 * @example
 * ```tsx
 * import { z } from 'zod'
 * import { useDotdoCollection } from '@dotdo/tanstack/react'
 *
 * const CustomerSchema = z.object({
 *   $id: z.string(),
 *   name: z.string(),
 *   email: z.string().email(),
 * })
 *
 * type Customer = z.infer<typeof CustomerSchema>
 *
 * function CustomerList() {
 *   const { data, isLoading, insert, update, delete: remove } = useDotdoCollection<Customer>({
 *     collection: 'Customer',
 *     schema: CustomerSchema,
 *   })
 *
 *   if (isLoading) return <div>Loading...</div>
 *
 *   return (
 *     <ul>
 *       {data.map(customer => (
 *         <li key={customer.$id}>
 *           {customer.name}
 *           <button onClick={() => remove(customer.$id)}>Delete</button>
 *         </li>
 *       ))}
 *     </ul>
 *   )
 * }
 * ```
 */
export function useDotdoCollection<T extends BaseItem>(
  config: DotdoCollectionConfig<T>
): UseDotdoCollectionResult<T> {
  const { collection, schema, branch } = config
  const context = useSyncContext()
  const { doUrl, getAuthToken, _ws } = context

  // Server-confirmed data
  const [serverData, setServerData] = React.useState<T[]>([])
  // Optimistic updates pending confirmation
  const [optimisticUpdates, setOptimisticUpdates] = React.useState<OptimisticUpdate<T>[]>([])
  // Loading state
  const [isLoading, setIsLoading] = React.useState(true)
  // Current transaction ID
  const txidRef = React.useRef(0)

  // Compute merged data (server + optimistic)
  const data = React.useMemo(() => {
    let result = [...serverData]

    for (const update of optimisticUpdates) {
      switch (update.type) {
        case 'insert':
          if (update.data && !result.find((item) => item.$id === update.key)) {
            result.push(update.data)
          }
          break
        case 'update':
          result = result.map((item) =>
            item.$id === update.key && update.data ? { ...item, ...update.data } : item
          )
          break
        case 'delete':
          result = result.filter((item) => item.$id !== update.key)
          break
      }
    }

    return result
  }, [serverData, optimisticUpdates])

  // Subscribe to WebSocket messages
  React.useEffect(() => {
    if (!_ws) return

    const handleMessage = (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data) as SyncMessage<T>

        // Only process messages for our collection
        if (message.collection !== collection) return

        // Update txid
        txidRef.current = Math.max(txidRef.current, message.txid)

        switch (message.type) {
          case 'initial':
            // Validate and set initial data
            const validatedData = message.data.filter((item) => {
              const result = schema.safeParse(item)
              if (!result.success) {
                console.warn(`Invalid item in ${collection}:`, result.error)
                return false
              }
              return true
            })
            setServerData(validatedData)
            setIsLoading(false)
            // Clear optimistic updates that are now confirmed
            setOptimisticUpdates([])
            context._setLastSyncAt(new Date())
            break

          case 'insert':
            const insertResult = schema.safeParse(message.data)
            if (insertResult.success) {
              setServerData((prev) => {
                if (prev.find((item) => item.$id === message.key)) {
                  return prev
                }
                return [...prev, insertResult.data]
              })
              // Remove matching optimistic update
              setOptimisticUpdates((prev) =>
                prev.filter((u) => !(u.type === 'insert' && u.key === message.key))
              )
              context._setLastSyncAt(new Date())
            }
            break

          case 'update':
            const updateResult = schema.safeParse(message.data)
            if (updateResult.success) {
              setServerData((prev) =>
                prev.map((item) => (item.$id === message.key ? updateResult.data : item))
              )
              // Remove matching optimistic update
              setOptimisticUpdates((prev) =>
                prev.filter((u) => !(u.type === 'update' && u.key === message.key))
              )
              context._setLastSyncAt(new Date())
            }
            break

          case 'delete':
            setServerData((prev) => prev.filter((item) => item.$id !== message.key))
            // Remove matching optimistic update
            setOptimisticUpdates((prev) =>
              prev.filter((u) => !(u.type === 'delete' && u.key === message.key))
            )
            context._setLastSyncAt(new Date())
            break
        }
      } catch (error) {
        console.error('Error processing sync message:', error)
      }
    }

    _ws.addEventListener('message', handleMessage)

    // Subscribe to collection
    const subscribeMessage = JSON.stringify({
      type: 'subscribe',
      collection,
      branch,
    })
    if (_ws.readyState === WebSocket.OPEN) {
      _ws.send(subscribeMessage)
    }

    return () => {
      _ws.removeEventListener('message', handleMessage)
    }
  }, [_ws, collection, branch, schema, context])

  // Build HTTP URL for mutations
  const buildUrl = React.useCallback(
    (path: string): string => {
      const base = doUrl.replace(/\/$/, '')
      const branchPath = branch ? `/branches/${branch}` : ''
      return `${base}${branchPath}/things/${collection}${path}`
    },
    [doUrl, branch, collection]
  )

  // Get auth headers
  const getHeaders = React.useCallback((): HeadersInit => {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    }
    const token = getAuthToken?.()
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
    return headers
  }, [getAuthToken])

  // Insert operation with optimistic update
  const insert = React.useCallback(
    async (item: T): Promise<void> => {
      const key = item.$id || crypto.randomUUID()
      const itemWithId = { ...item, $id: key }

      // Add optimistic update
      const optimisticUpdate: OptimisticUpdate<T> = {
        type: 'insert',
        key,
        data: itemWithId,
        timestamp: Date.now(),
      }
      setOptimisticUpdates((prev) => [...prev, optimisticUpdate])

      try {
        const response = await fetch(buildUrl(''), {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify(itemWithId),
        })

        if (!response.ok) {
          throw new Error(`Insert failed: ${response.statusText}`)
        }
      } catch (error) {
        // Rollback optimistic update
        setOptimisticUpdates((prev) =>
          prev.filter((u) => !(u.type === 'insert' && u.key === key))
        )
        throw error
      }
    },
    [buildUrl, getHeaders]
  )

  // Update operation with optimistic update
  const update = React.useCallback(
    async (id: string, changes: Partial<T>): Promise<void> => {
      // Find current item for rollback
      const currentItem = data.find((item) => item.$id === id)

      // Add optimistic update
      const optimisticUpdate: OptimisticUpdate<T> = {
        type: 'update',
        key: id,
        data: { ...currentItem, ...changes } as T,
        previousData: currentItem,
        timestamp: Date.now(),
      }
      setOptimisticUpdates((prev) => [...prev, optimisticUpdate])

      try {
        const response = await fetch(buildUrl(`/${id}`), {
          method: 'PATCH',
          headers: getHeaders(),
          body: JSON.stringify(changes),
        })

        if (!response.ok) {
          throw new Error(`Update failed: ${response.statusText}`)
        }
      } catch (error) {
        // Rollback optimistic update
        setOptimisticUpdates((prev) =>
          prev.filter((u) => !(u.type === 'update' && u.key === id))
        )
        throw error
      }
    },
    [buildUrl, getHeaders, data]
  )

  // Delete operation with optimistic update
  const deleteItem = React.useCallback(
    async (id: string): Promise<void> => {
      // Find current item for rollback
      const currentItem = data.find((item) => item.$id === id)

      // Add optimistic update
      const optimisticUpdate: OptimisticUpdate<T> = {
        type: 'delete',
        key: id,
        previousData: currentItem,
        timestamp: Date.now(),
      }
      setOptimisticUpdates((prev) => [...prev, optimisticUpdate])

      try {
        const response = await fetch(buildUrl(`/${id}`), {
          method: 'DELETE',
          headers: getHeaders(),
        })

        if (!response.ok) {
          throw new Error(`Delete failed: ${response.statusText}`)
        }
      } catch (error) {
        // Rollback optimistic update
        setOptimisticUpdates((prev) =>
          prev.filter((u) => !(u.type === 'delete' && u.key === id))
        )
        throw error
      }
    },
    [buildUrl, getHeaders, data]
  )

  // Find by ID
  const findById = React.useCallback(
    (id: string): T | undefined => {
      return data.find((item) => item.$id === id)
    },
    [data]
  )

  return {
    data,
    isLoading,
    insert,
    update,
    delete: deleteItem,
    findById,
  }
}

// =============================================================================
// Query Key Factory
// =============================================================================

/**
 * Factory for creating consistent query keys.
 * Use this with TanStack Query for cache management.
 *
 * @example
 * ```tsx
 * import { queryClient } from './queryClient'
 * import { dotdoQueryKeys } from '@dotdo/tanstack/react'
 *
 * // Invalidate all customer queries
 * queryClient.invalidateQueries({ queryKey: dotdoQueryKeys.collection('Customer') })
 *
 * // Invalidate a specific customer
 * queryClient.invalidateQueries({ queryKey: dotdoQueryKeys.item('Customer', 'alice') })
 * ```
 */
export const dotdoQueryKeys = {
  all: ['dotdo'] as const,
  collections: () => [...dotdoQueryKeys.all, 'collection'] as const,
  collection: (name: string) => [...dotdoQueryKeys.collections(), name] as const,
  collectionBranch: (name: string, branch: string) =>
    [...dotdoQueryKeys.collection(name), 'branch', branch] as const,
  items: (collection: string) => [...dotdoQueryKeys.collection(collection), 'items'] as const,
  item: (collection: string, id: string) =>
    [...dotdoQueryKeys.items(collection), id] as const,
  search: (collection: string, query: string) =>
    [...dotdoQueryKeys.collection(collection), 'search', query] as const,
}

// =============================================================================
// Types for Query/Mutation hooks
// =============================================================================

/**
 * Options for useDotdoQuery hook
 */
export interface UseDotdoQueryOptions<T> {
  /** Collection name */
  collection: string
  /** Optional item ID for single-item queries */
  id?: string
  /** Optional branch */
  branch?: string
  /** Enable/disable the query */
  enabled?: boolean
  /** Stale time in milliseconds */
  staleTime?: number
  /** Cache time in milliseconds */
  cacheTime?: number
  /** Zod schema for validation */
  schema?: import('zod').ZodSchema<T>
}

/**
 * Result from useDotdoQuery hook
 */
export interface UseDotdoQueryResult<T> {
  data: T | T[] | undefined
  isLoading: boolean
  isError: boolean
  error: Error | null
  refetch: () => Promise<void>
  isFetching: boolean
}

/**
 * Options for useDotdoMutation hook
 */
export interface UseDotdoMutationOptions<T extends BaseItem, TVariables> {
  /** Collection name */
  collection: string
  /** Mutation type */
  mutationType: 'insert' | 'update' | 'delete'
  /** Optional branch */
  branch?: string
  /** Optimistic update function */
  onMutate?: (variables: TVariables) => T | void
  /** Success callback */
  onSuccess?: (data: T, variables: TVariables) => void
  /** Error callback with rollback data */
  onError?: (error: Error, variables: TVariables, rollbackData?: T) => void
  /** Settlement callback */
  onSettled?: (data: T | undefined, error: Error | null, variables: TVariables) => void
}

/**
 * Result from useDotdoMutation hook
 */
export interface UseDotdoMutationResult<T, TVariables> {
  mutate: (variables: TVariables) => void
  mutateAsync: (variables: TVariables) => Promise<T>
  isLoading: boolean
  isError: boolean
  isSuccess: boolean
  error: Error | null
  data: T | undefined
  reset: () => void
}

// =============================================================================
// useDotdoQuery - TanStack Query-style data fetching
// =============================================================================

/**
 * Hook for fetching DO data with TanStack Query-style API.
 *
 * Provides caching, refetching, and loading states similar to useQuery.
 *
 * @example
 * ```tsx
 * function CustomerProfile({ id }: { id: string }) {
 *   const { data, isLoading, error } = useDotdoQuery<Customer>({
 *     collection: 'Customer',
 *     id,
 *     schema: CustomerSchema,
 *   })
 *
 *   if (isLoading) return <Loading />
 *   if (error) return <Error message={error.message} />
 *
 *   return <div>{data?.name}</div>
 * }
 * ```
 */
export function useDotdoQuery<T>(options: UseDotdoQueryOptions<T>): UseDotdoQueryResult<T> {
  const { collection, id, branch, enabled = true, staleTime = 0, schema } = options
  const context = useSyncContext()
  const { doUrl, getAuthToken } = context

  const [data, setData] = React.useState<T | T[] | undefined>(undefined)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isFetching, setIsFetching] = React.useState(false)
  const [error, setError] = React.useState<Error | null>(null)
  const lastFetchRef = React.useRef<number>(0)

  const buildUrl = React.useCallback((): string => {
    const base = doUrl.replace(/\/$/, '')
    const branchPath = branch ? `/branches/${branch}` : ''
    const itemPath = id ? `/${id}` : ''
    return `${base}${branchPath}/things/${collection}${itemPath}`
  }, [doUrl, branch, collection, id])

  const getHeaders = React.useCallback((): HeadersInit => {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    }
    const token = getAuthToken?.()
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
    return headers
  }, [getAuthToken])

  const fetchData = React.useCallback(async (): Promise<void> => {
    const now = Date.now()

    // Check stale time
    if (staleTime > 0 && now - lastFetchRef.current < staleTime && data !== undefined) {
      return
    }

    setIsFetching(true)
    setError(null)

    try {
      const response = await fetch(buildUrl(), {
        method: 'GET',
        headers: getHeaders(),
      })

      if (!response.ok) {
        throw new Error(`Fetch failed: ${response.statusText}`)
      }

      let result = await response.json()

      // Validate with schema if provided
      if (schema) {
        if (Array.isArray(result)) {
          result = result.filter((item) => {
            const parseResult = schema.safeParse(item)
            return parseResult.success
          })
        } else {
          const parseResult = schema.safeParse(result)
          if (!parseResult.success) {
            throw new Error(`Schema validation failed: ${parseResult.error.message}`)
          }
          result = parseResult.data
        }
      }

      setData(result)
      lastFetchRef.current = now
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      setIsLoading(false)
      setIsFetching(false)
    }
  }, [buildUrl, getHeaders, staleTime, data, schema])

  // Initial fetch
  React.useEffect(() => {
    if (enabled) {
      fetchData()
    } else {
      setIsLoading(false)
    }
  }, [enabled, fetchData])

  const refetch = React.useCallback(async (): Promise<void> => {
    lastFetchRef.current = 0 // Force refetch by clearing stale time
    await fetchData()
  }, [fetchData])

  return {
    data,
    isLoading,
    isError: error !== null,
    error,
    refetch,
    isFetching,
  }
}

// =============================================================================
// useDotdoMutation - Mutations with optimistic updates
// =============================================================================

/**
 * Hook for mutations with optimistic updates and rollback.
 *
 * Similar to useMutation from TanStack Query but integrated with DO sync.
 *
 * @example
 * ```tsx
 * function CreateCustomerForm() {
 *   const mutation = useDotdoMutation<Customer, Omit<Customer, '$id'>>({
 *     collection: 'Customer',
 *     mutationType: 'insert',
 *     onSuccess: () => toast.success('Customer created!'),
 *     onError: (error) => toast.error(error.message),
 *   })
 *
 *   return (
 *     <form onSubmit={(e) => {
 *       e.preventDefault()
 *       mutation.mutate({ name: 'Alice', email: 'alice@example.com' })
 *     }}>
 *       <button disabled={mutation.isLoading}>
 *         {mutation.isLoading ? 'Creating...' : 'Create Customer'}
 *       </button>
 *     </form>
 *   )
 * }
 * ```
 */
export function useDotdoMutation<T extends BaseItem, TVariables = Partial<T>>(
  options: UseDotdoMutationOptions<T, TVariables>
): UseDotdoMutationResult<T, TVariables> {
  const { collection, mutationType, branch, onMutate, onSuccess, onError, onSettled } = options
  const context = useSyncContext()
  const { doUrl, getAuthToken } = context

  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<Error | null>(null)
  const [isSuccess, setIsSuccess] = React.useState(false)
  const [data, setData] = React.useState<T | undefined>(undefined)

  const buildUrl = React.useCallback(
    (id?: string): string => {
      const base = doUrl.replace(/\/$/, '')
      const branchPath = branch ? `/branches/${branch}` : ''
      const itemPath = id ? `/${id}` : ''
      return `${base}${branchPath}/things/${collection}${itemPath}`
    },
    [doUrl, branch, collection]
  )

  const getHeaders = React.useCallback((): HeadersInit => {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    }
    const token = getAuthToken?.()
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
    return headers
  }, [getAuthToken])

  const mutateAsync = React.useCallback(
    async (variables: TVariables): Promise<T> => {
      setIsLoading(true)
      setError(null)
      setIsSuccess(false)

      // Call onMutate for optimistic update data
      const rollbackData = onMutate?.(variables)

      try {
        let response: Response
        let result: T

        switch (mutationType) {
          case 'insert':
            response = await fetch(buildUrl(), {
              method: 'POST',
              headers: getHeaders(),
              body: JSON.stringify(variables),
            })
            break

          case 'update':
            const updateVars = variables as unknown as { id: string; data: Partial<T> }
            response = await fetch(buildUrl(updateVars.id), {
              method: 'PATCH',
              headers: getHeaders(),
              body: JSON.stringify(updateVars.data),
            })
            break

          case 'delete':
            const deleteVars = variables as unknown as { id: string }
            response = await fetch(buildUrl(deleteVars.id), {
              method: 'DELETE',
              headers: getHeaders(),
            })
            break

          default:
            throw new Error(`Unknown mutation type: ${mutationType}`)
        }

        if (!response.ok) {
          throw new Error(`Mutation failed: ${response.statusText}`)
        }

        result = mutationType === 'delete' ? ({} as T) : await response.json()

        setData(result)
        setIsSuccess(true)
        onSuccess?.(result, variables)
        onSettled?.(result, null, variables)

        return result
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        setError(error)
        onError?.(error, variables, rollbackData as T | undefined)
        onSettled?.(undefined, error, variables)
        throw error
      } finally {
        setIsLoading(false)
      }
    },
    [buildUrl, getHeaders, mutationType, onMutate, onSuccess, onError, onSettled]
  )

  const mutate = React.useCallback(
    (variables: TVariables): void => {
      mutateAsync(variables).catch(() => {
        // Error is already handled in mutateAsync
      })
    },
    [mutateAsync]
  )

  const reset = React.useCallback((): void => {
    setIsLoading(false)
    setError(null)
    setIsSuccess(false)
    setData(undefined)
  }, [])

  return {
    mutate,
    mutateAsync,
    isLoading,
    isError: error !== null,
    isSuccess,
    error,
    data,
    reset,
  }
}
