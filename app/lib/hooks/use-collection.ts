/**
 * useCollection Hook
 *
 * A React hook for managing collections with CRUD operations, optimistic mutations,
 * real-time sync, Zod validation, and cursor-based pagination.
 *
 * Built on top of the $ RPC proxy for Durable Object interaction.
 *
 * @example
 * ```typescript
 * const UserSchema = z.object({
 *   $id: z.string(),
 *   name: z.string().min(1),
 *   email: z.string().email(),
 * })
 *
 * function UserList() {
 *   const users = useCollection({
 *     name: 'users',
 *     schema: UserSchema,
 *   })
 *
 *   if (users.isLoading) return <Loading />
 *
 *   return (
 *     <ul>
 *       {users.data.map(user => (
 *         <li key={user.$id}>{user.name}</li>
 *       ))}
 *     </ul>
 *   )
 * }
 * ```
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { z, ZodObject, ZodRawShape } from 'zod'

// =============================================================================
// Types
// =============================================================================

/**
 * Base interface for items with an ID
 */
interface WithId {
  $id: string
}

/**
 * Collection RPC methods available on the $ proxy
 */
interface CollectionRPC {
  findAll: () => Promise<unknown[]>
  findById: (id: string) => Promise<unknown>
  insert: (data: unknown) => Promise<unknown>
  update: (id: string, data: unknown) => Promise<unknown>
  delete: (id: string) => Promise<void>
  insertMany: (items: unknown[]) => Promise<unknown[]>
  deleteMany: (ids: string[]) => Promise<void>
  findWhere: (predicate: Record<string, unknown>) => Promise<unknown[]>
  loadMore: (cursor?: string | null) => Promise<{
    items: unknown[]
    cursor: string | null
    hasMore?: boolean
  }>
}

/**
 * The $ proxy interface for RPC calls
 */
interface $Proxy {
  collection: (name: string) => CollectionRPC
  on: Record<string, Record<string, (handler: (data: unknown) => void) => () => void>>
}

/**
 * Options for useCollection hook
 */
export interface UseCollectionOptions<TSchema extends ZodObject<ZodRawShape>> {
  /** Collection name (e.g., 'users', 'orders') */
  name: string
  /** Zod schema for validation */
  schema: TSchema
  /** Optional: use existing $ proxy from parent */
  $?: $Proxy
  /** Optional WebSocket URL (used when $ is not provided) */
  doUrl?: string
  /** Optional branch for branched data */
  branch?: string
  /** Whether to auto-connect on mount (default: true) */
  autoConnect?: boolean
}

/**
 * Return type for useCollection hook
 */
export interface UseCollectionReturn<T extends WithId> {
  /** Current collection data */
  data: T[]
  /** True while initial data is loading */
  isLoading: boolean
  /** Error if any occurred */
  error: Error | null

  // Queries
  /** Find item by ID, returns null if not found */
  findById: (id: string) => T | null
  /** Get all items */
  findAll: () => T[]
  /** Filter items by partial match */
  findWhere: (predicate: Partial<T>) => T[]

  // Mutations (optimistic)
  /** Insert new item, returns item with $id */
  insert: (data: Omit<T, '$id'>) => Promise<T>
  /** Update existing item */
  update: (id: string, data: Partial<T>) => Promise<T>
  /** Delete item by ID */
  delete: (id: string) => Promise<void>
  /** Bulk insert items */
  insertMany: (data: Omit<T, '$id'>[]) => Promise<T[]>
  /** Bulk delete items by IDs */
  deleteMany: (ids: string[]) => Promise<void>

  // Pagination
  /** True if more items available */
  hasMore: boolean
  /** Load next page of items */
  loadMore: () => Promise<void>

  // Refresh
  /** Refetch all data from server */
  refetch: () => Promise<void>
}

/**
 * Change event from real-time sync
 */
interface ChangeEvent<T> {
  type: 'insert' | 'update' | 'delete'
  data?: T
  id?: string
}

/**
 * Pending mutation for optimistic updates
 */
interface PendingMutation<T> {
  id: string
  type: 'insert' | 'update' | 'delete'
  optimisticData?: T
  originalData?: T
  timestamp: number
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * React hook for managing collections with CRUD, optimistic mutations,
 * real-time sync, Zod validation, and pagination.
 */
export function useCollection<TSchema extends ZodObject<ZodRawShape>>(
  options: UseCollectionOptions<TSchema>
): UseCollectionReturn<z.infer<TSchema> & WithId> {
  type T = z.infer<TSchema> & WithId

  const { name, schema, $ } = options

  // State
  const [data, setData] = useState<T[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(true)

  // Track pending mutations for rollback
  const pendingMutationsRef = useRef<Map<string, PendingMutation<T>>>(new Map())

  // Get collection RPC
  const getCollectionRPC = useCallback((): CollectionRPC | null => {
    if (!$) return null
    return $.collection(name)
  }, [$, name])

  // ==========================================================================
  // Validation
  // ==========================================================================

  /**
   * Validate data against schema, throwing descriptive error if invalid
   */
  const validate = useCallback(
    (inputData: unknown, isPartial = false): void => {
      try {
        if (isPartial) {
          // For updates, validate only provided fields
          schema.partial().parse(inputData)
        } else {
          // For inserts, validate full schema (without $id which is added by server)
          const schemaWithoutId = schema.omit({ $id: true } as Record<string, true>)
          schemaWithoutId.parse(inputData)
        }
      } catch (err) {
        if (err && typeof err === 'object' && 'errors' in err) {
          const zodError = err as { errors: Array<{ path: string[]; message: string }> }
          const fieldErrors = zodError.errors
            .map((e) => `${e.path.join('.')}: ${e.message}`)
            .join(', ')
          throw new Error(`Validation failed - ${fieldErrors}`)
        }
        throw err
      }
    },
    [schema]
  )

  // ==========================================================================
  // Initial Load
  // ==========================================================================

  useEffect(() => {
    const collectionRPC = getCollectionRPC()
    if (!collectionRPC) {
      setIsLoading(false)
      return
    }

    let mounted = true

    const loadData = async () => {
      try {
        setIsLoading(true)
        setError(null)
        const items = (await collectionRPC.findAll()) as T[]
        if (mounted) {
          setData(items)
          setIsLoading(false)
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err : new Error(String(err)))
          setIsLoading(false)
        }
      }
    }

    loadData()

    return () => {
      mounted = false
    }
  }, [getCollectionRPC])

  // ==========================================================================
  // Real-time Sync Subscription
  // ==========================================================================

  useEffect(() => {
    if (!$) return

    // Subscribe to collection changes
    const unsubscribe = $.on[name]?.change?.((event: unknown) => {
      const changeEvent = event as ChangeEvent<T>

      switch (changeEvent.type) {
        case 'insert':
          if (changeEvent.data) {
            setData((prev) => {
              // Check if already exists (from our own optimistic update)
              if (prev.some((item) => item.$id === changeEvent.data!.$id)) {
                return prev
              }
              return [...prev, changeEvent.data!]
            })
          }
          break

        case 'update':
          if (changeEvent.data) {
            setData((prev) =>
              prev.map((item) =>
                item.$id === changeEvent.data!.$id ? changeEvent.data! : item
              )
            )
          }
          break

        case 'delete':
          if (changeEvent.id) {
            setData((prev) => prev.filter((item) => item.$id !== changeEvent.id))
          }
          break
      }
    })

    return () => {
      unsubscribe?.()
    }
  }, [$, name])

  // ==========================================================================
  // Query Functions
  // ==========================================================================

  const findById = useCallback(
    (id: string): T | null => {
      return data.find((item) => item.$id === id) ?? null
    },
    [data]
  )

  const findAll = useCallback((): T[] => {
    return data
  }, [data])

  const findWhere = useCallback(
    (predicate: Partial<T>): T[] => {
      return data.filter((item) => {
        return Object.entries(predicate).every(
          ([key, value]) => item[key as keyof T] === value
        )
      })
    },
    [data]
  )

  // ==========================================================================
  // Mutation Functions (Optimistic)
  // ==========================================================================

  const insert = useCallback(
    async (insertData: Omit<T, '$id'>): Promise<T> => {
      // Validate before sending
      validate(insertData)

      const collectionRPC = getCollectionRPC()
      if (!collectionRPC) {
        throw new Error('Collection RPC not available')
      }

      // Create optimistic item with temporary ID
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const optimisticItem = { ...insertData, $id: tempId } as T

      // Store pending mutation for potential rollback
      pendingMutationsRef.current.set(tempId, {
        id: tempId,
        type: 'insert',
        optimisticData: optimisticItem,
        timestamp: Date.now(),
      })

      // Optimistically add to state
      setData((prev) => [...prev, optimisticItem])

      try {
        // Send to server
        const serverItem = (await collectionRPC.insert(insertData)) as T

        // Replace optimistic item with server response
        setData((prev) =>
          prev.map((item) => (item.$id === tempId ? serverItem : item))
        )

        // Clear pending mutation
        pendingMutationsRef.current.delete(tempId)

        return serverItem
      } catch (err) {
        // Rollback on error
        setData((prev) => prev.filter((item) => item.$id !== tempId))
        pendingMutationsRef.current.delete(tempId)
        throw err
      }
    },
    [validate, getCollectionRPC]
  )

  const update = useCallback(
    async (id: string, updateData: Partial<T>): Promise<T> => {
      // Validate partial update
      validate(updateData, true)

      const collectionRPC = getCollectionRPC()
      if (!collectionRPC) {
        throw new Error('Collection RPC not available')
      }

      // Get original item for potential rollback
      const originalItem = data.find((item) => item.$id === id)
      if (!originalItem) {
        throw new Error(`Item with id ${id} not found`)
      }

      // Create optimistic update
      const optimisticItem = { ...originalItem, ...updateData } as T

      // Store pending mutation
      pendingMutationsRef.current.set(id, {
        id,
        type: 'update',
        optimisticData: optimisticItem,
        originalData: originalItem,
        timestamp: Date.now(),
      })

      // Optimistically update state
      setData((prev) =>
        prev.map((item) => (item.$id === id ? optimisticItem : item))
      )

      try {
        // Send to server
        const serverItem = (await collectionRPC.update(id, updateData)) as T

        // Update with server response
        setData((prev) =>
          prev.map((item) => (item.$id === id ? serverItem : item))
        )

        // Clear pending mutation
        pendingMutationsRef.current.delete(id)

        return serverItem
      } catch (err) {
        // Rollback on error
        setData((prev) =>
          prev.map((item) => (item.$id === id ? originalItem : item))
        )
        pendingMutationsRef.current.delete(id)
        throw err
      }
    },
    [validate, getCollectionRPC, data]
  )

  const deleteItem = useCallback(
    async (id: string): Promise<void> => {
      const collectionRPC = getCollectionRPC()
      if (!collectionRPC) {
        throw new Error('Collection RPC not available')
      }

      // Get original item for potential rollback
      const originalItem = data.find((item) => item.$id === id)
      if (!originalItem) {
        throw new Error(`Item with id ${id} not found`)
      }

      // Store pending mutation
      pendingMutationsRef.current.set(id, {
        id,
        type: 'delete',
        originalData: originalItem,
        timestamp: Date.now(),
      })

      // Optimistically remove from state
      setData((prev) => prev.filter((item) => item.$id !== id))

      try {
        // Send to server
        await collectionRPC.delete(id)

        // Clear pending mutation
        pendingMutationsRef.current.delete(id)
      } catch (err) {
        // Rollback on error
        setData((prev) => [...prev, originalItem])
        pendingMutationsRef.current.delete(id)
        throw err
      }
    },
    [getCollectionRPC, data]
  )

  const insertMany = useCallback(
    async (items: Omit<T, '$id'>[]): Promise<T[]> => {
      // Validate all items
      items.forEach((item) => validate(item))

      const collectionRPC = getCollectionRPC()
      if (!collectionRPC) {
        throw new Error('Collection RPC not available')
      }

      // Create optimistic items with temporary IDs
      const tempItems = items.map((item, i) => ({
        ...item,
        $id: `temp-${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`,
      })) as T[]

      // Store pending mutations
      tempItems.forEach((item) => {
        pendingMutationsRef.current.set(item.$id, {
          id: item.$id,
          type: 'insert',
          optimisticData: item,
          timestamp: Date.now(),
        })
      })

      // Optimistically add to state
      setData((prev) => [...prev, ...tempItems])

      try {
        // Send to server
        const serverItems = (await collectionRPC.insertMany(items)) as T[]

        // Replace optimistic items with server responses
        const tempIds = new Set(tempItems.map((t) => t.$id))
        setData((prev) => [
          ...prev.filter((item) => !tempIds.has(item.$id)),
          ...serverItems,
        ])

        // Clear pending mutations
        tempItems.forEach((item) => {
          pendingMutationsRef.current.delete(item.$id)
        })

        return serverItems
      } catch (err) {
        // Rollback on error
        const tempIds = new Set(tempItems.map((t) => t.$id))
        setData((prev) => prev.filter((item) => !tempIds.has(item.$id)))
        tempItems.forEach((item) => {
          pendingMutationsRef.current.delete(item.$id)
        })
        throw err
      }
    },
    [validate, getCollectionRPC]
  )

  const deleteMany = useCallback(
    async (ids: string[]): Promise<void> => {
      const collectionRPC = getCollectionRPC()
      if (!collectionRPC) {
        throw new Error('Collection RPC not available')
      }

      // Get original items for potential rollback
      const originalItems = data.filter((item) => ids.includes(item.$id))

      // Store pending mutations
      originalItems.forEach((item) => {
        pendingMutationsRef.current.set(item.$id, {
          id: item.$id,
          type: 'delete',
          originalData: item,
          timestamp: Date.now(),
        })
      })

      // Optimistically remove from state
      const idsSet = new Set(ids)
      setData((prev) => prev.filter((item) => !idsSet.has(item.$id)))

      try {
        // Send to server
        await collectionRPC.deleteMany(ids)

        // Clear pending mutations
        originalItems.forEach((item) => {
          pendingMutationsRef.current.delete(item.$id)
        })
      } catch (err) {
        // Rollback on error
        setData((prev) => [...prev, ...originalItems])
        originalItems.forEach((item) => {
          pendingMutationsRef.current.delete(item.$id)
        })
        throw err
      }
    },
    [getCollectionRPC, data]
  )

  // ==========================================================================
  // Pagination
  // ==========================================================================

  const loadMore = useCallback(async (): Promise<void> => {
    const collectionRPC = getCollectionRPC()
    if (!collectionRPC) {
      throw new Error('Collection RPC not available')
    }

    try {
      const result = await collectionRPC.loadMore(cursor)
      const newItems = result.items as T[]

      setData((prev) => [...prev, ...newItems])
      setCursor(result.cursor)
      setHasMore(result.hasMore ?? result.cursor !== null)
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
      throw err
    }
  }, [getCollectionRPC, cursor])

  // ==========================================================================
  // Refresh
  // ==========================================================================

  const refetch = useCallback(async (): Promise<void> => {
    const collectionRPC = getCollectionRPC()
    if (!collectionRPC) {
      throw new Error('Collection RPC not available')
    }

    try {
      setIsLoading(true)
      setError(null)
      const items = (await collectionRPC.findAll()) as T[]
      setData(items)
      setCursor(null)
      setHasMore(true)
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [getCollectionRPC])

  // ==========================================================================
  // Return Value
  // ==========================================================================

  return useMemo(
    () => ({
      data,
      isLoading,
      error,
      findById,
      findAll,
      findWhere,
      insert,
      update,
      delete: deleteItem,
      insertMany,
      deleteMany,
      hasMore,
      loadMore,
      refetch,
    }),
    [
      data,
      isLoading,
      error,
      findById,
      findAll,
      findWhere,
      insert,
      update,
      deleteItem,
      insertMany,
      deleteMany,
      hasMore,
      loadMore,
      refetch,
    ]
  )
}

export default useCollection
