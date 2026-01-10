/**
 * useCollection Hook
 *
 * A React hook for managing collections with CRUD operations, optimistic mutations,
 * real-time sync, Zod validation, and cursor-based pagination.
 *
 * Built on top of the $ RPC proxy for Durable Object interaction.
 *
 * @module app/lib/hooks/use-collection
 *
 * @example Basic CRUD usage
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
 *
 * @example Optimistic mutations
 * ```typescript
 * const { insert, update, delete: remove } = useCollection({
 *   name: 'todos',
 *   schema: TodoSchema,
 * })
 *
 * // All mutations are optimistic - UI updates immediately
 * await insert({ title: 'New todo', completed: false })
 * await update(id, { completed: true })
 * await remove(id)
 * ```
 *
 * @example Pagination
 * ```typescript
 * const { data, hasMore, loadMore } = useCollection({
 *   name: 'products',
 *   schema: ProductSchema,
 * })
 *
 * return (
 *   <>
 *     {data.map(p => <ProductCard key={p.$id} product={p} />)}
 *     {hasMore && <button onClick={loadMore}>Load More</button>}
 *   </>
 * )
 * ```
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { z, ZodObject, ZodRawShape } from 'zod'

// =============================================================================
// Error Types
// =============================================================================

/**
 * Error codes for collection operations
 */
export type CollectionErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'RPC_ERROR'
  | 'NETWORK_ERROR'

/**
 * Structured error class for collection operations
 */
export class CollectionError extends Error {
  readonly code: CollectionErrorCode
  readonly fieldErrors?: Record<string, string[]>

  constructor(code: CollectionErrorCode, message: string, fieldErrors?: Record<string, string[]>) {
    super(message)
    this.name = 'CollectionError'
    this.code = code
    this.fieldErrors = fieldErrors
    Object.setPrototypeOf(this, CollectionError.prototype)
  }
}

// =============================================================================
// Types
// =============================================================================

/**
 * Base interface for items with an ID.
 * All collection items must have a unique $id field.
 */
interface WithId {
  /** Unique identifier for the item */
  readonly $id: string
}

/**
 * Branded type for item IDs to prevent mixing with other strings
 */
export type ItemId = string & { readonly __brand: 'ItemId' }

/**
 * Collection RPC methods available on the $ proxy
 * @typeParam T - The item type
 * @internal
 */
interface CollectionRPC<T = unknown> {
  findAll: () => Promise<T[]>
  findById: (id: string) => Promise<T | null>
  insert: (data: Omit<T, '$id'>) => Promise<T>
  update: (id: string, data: Partial<Omit<T, '$id'>>) => Promise<T>
  delete: (id: string) => Promise<void>
  insertMany: (items: Omit<T, '$id'>[]) => Promise<T[]>
  deleteMany: (ids: string[]) => Promise<void>
  findWhere: (predicate: Partial<T>) => Promise<T[]>
  loadMore: (cursor?: string | null) => Promise<{
    items: T[]
    cursor: string | null
    hasMore?: boolean
  }>
}

/**
 * The $ proxy interface for RPC calls
 * @internal
 */
interface $Proxy {
  collection: (name: string) => CollectionRPC
  on: Record<string, Record<string, (handler: (data: unknown) => void) => () => void>>
}

/**
 * Options for the useCollection hook
 * @typeParam TSchema - The Zod schema type for the collection items
 */
export interface UseCollectionOptions<TSchema extends ZodObject<ZodRawShape>> {
  /**
   * Collection name (e.g., 'users', 'orders')
   * Used for RPC calls and event subscriptions
   */
  name: string
  /**
   * Zod schema for client-side validation
   * Items are validated before being sent to the server
   */
  schema: TSchema
  /**
   * Existing $ proxy from a parent component
   * When provided, reuses the existing WebSocket connection
   */
  $?: $Proxy
  /**
   * WebSocket URL for the Durable Object
   * Required when $ is not provided
   */
  doUrl?: string
  /**
   * Branch name for branched data (multi-tenancy support)
   */
  branch?: string
  /**
   * Whether to auto-connect on mount
   * @default true
   */
  autoConnect?: boolean
}

/**
 * Return type for the useCollection hook
 * @typeParam T - The item type, must extend WithId
 */
export interface UseCollectionReturn<T extends WithId> {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /**
   * Current collection data as a readonly array
   * Updates reactively on mutations and real-time sync
   */
  readonly data: readonly T[]

  /**
   * True while initial data is loading
   * False once initial fetch completes (success or error)
   */
  readonly isLoading: boolean

  /**
   * Error from the most recent failed operation
   * Null when all operations succeed
   */
  readonly error: CollectionError | Error | null

  // ---------------------------------------------------------------------------
  // Queries (synchronous, operate on local data)
  // ---------------------------------------------------------------------------

  /**
   * Find an item by its unique ID
   * @param id - The item's $id
   * @returns The item if found, null otherwise
   */
  findById: (id: string) => T | null

  /**
   * Get all items in the collection
   * @returns Array of all items
   */
  findAll: () => readonly T[]

  /**
   * Filter items by partial property match
   * All specified properties must match exactly
   * @param predicate - Object with properties to match
   * @returns Array of matching items
   *
   * @example
   * ```ts
   * // Find all completed todos
   * const completed = findWhere({ completed: true })
   *
   * // Find users with specific role
   * const admins = findWhere({ role: 'admin' })
   * ```
   */
  findWhere: (predicate: Partial<T>) => readonly T[]

  // ---------------------------------------------------------------------------
  // Mutations (async, optimistic updates with rollback on error)
  // ---------------------------------------------------------------------------

  /**
   * Insert a new item into the collection
   * Optimistically adds to local data before server confirms
   * @param data - Item data without $id (generated by server)
   * @returns Promise resolving to the inserted item with $id
   * @throws CollectionError on validation or server error
   */
  insert: (data: Omit<T, '$id'>) => Promise<T>

  /**
   * Update an existing item
   * Optimistically updates local data before server confirms
   * @param id - The item's $id
   * @param data - Partial update data
   * @returns Promise resolving to the updated item
   * @throws CollectionError if item not found or validation fails
   */
  update: (id: string, data: Partial<Omit<T, '$id'>>) => Promise<T>

  /**
   * Delete an item by ID
   * Optimistically removes from local data before server confirms
   * @param id - The item's $id
   * @throws CollectionError if item not found
   */
  delete: (id: string) => Promise<void>

  /**
   * Bulk insert multiple items
   * @param data - Array of item data without $id
   * @returns Promise resolving to array of inserted items with $id
   */
  insertMany: (data: Omit<T, '$id'>[]) => Promise<T[]>

  /**
   * Bulk delete multiple items by their IDs
   * @param ids - Array of $id values to delete
   */
  deleteMany: (ids: string[]) => Promise<void>

  // ---------------------------------------------------------------------------
  // Pagination
  // ---------------------------------------------------------------------------

  /**
   * True if more items are available beyond what's currently loaded
   */
  readonly hasMore: boolean

  /**
   * Load the next page of items
   * Appends to existing data rather than replacing
   * @throws Error on network failure
   */
  loadMore: () => Promise<void>

  // ---------------------------------------------------------------------------
  // Refresh
  // ---------------------------------------------------------------------------

  /**
   * Refetch all data from the server
   * Replaces local data with fresh server data
   * Resets pagination cursor
   */
  refetch: () => Promise<void>
}

/**
 * Change event types for real-time sync
 * @internal
 */
type ChangeEventType = 'insert' | 'update' | 'delete'

/**
 * Change event from real-time sync subscription
 * @typeParam T - The item type
 * @internal
 */
interface ChangeEvent<T> {
  /** The type of change that occurred */
  type: ChangeEventType
  /** The changed item data (for insert/update) */
  data?: T
  /** The item ID (for delete) */
  id?: string
}

/**
 * Tracks a pending optimistic mutation for potential rollback
 * @typeParam T - The item type
 * @internal
 */
interface PendingMutation<T> {
  /** The item ID */
  id: string
  /** The type of mutation */
  type: ChangeEventType
  /** The optimistic data applied locally */
  optimisticData?: T
  /** The original data before mutation (for rollback) */
  originalData?: T
  /** When the mutation was initiated */
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
   * Validate data against schema, throwing CollectionError if invalid
   * @param inputData - The data to validate
   * @param isPartial - True for partial validation (updates), false for full (inserts)
   * @throws CollectionError with field-level error details
   * @internal
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

          // Build field-level error map
          const fieldErrors: Record<string, string[]> = {}
          for (const e of zodError.errors) {
            const path = e.path.join('.')
            if (!fieldErrors[path]) {
              fieldErrors[path] = []
            }
            fieldErrors[path].push(e.message)
          }

          // Build human-readable message
          const fieldMessages = Object.entries(fieldErrors)
            .map(([field, messages]) => `${field}: ${messages.join(', ')}`)
            .join('; ')

          throw new CollectionError(
            'VALIDATION_ERROR',
            `Validation failed - ${fieldMessages}`,
            fieldErrors
          )
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
