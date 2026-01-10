/**
 * useResource Hook
 *
 * React hook for working with a resource collection through the DataProvider.
 * Provides data fetching, mutations, and real-time updates.
 *
 * @module @dotdo/react/admin
 */

import * as React from 'react'
import { useAdminContext } from './AdminProvider'
import type {
  BaseRecord,
  GetListParams,
  SortOrder,
  QueryFilter,
} from './types'
import { getRecordId } from './types'
import { AdminError, formatAdminError } from './errors'

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for useResource hook
 */
export interface UseResourceConfig<T extends BaseRecord = BaseRecord> {
  /** Resource name (e.g., 'User', 'Task') */
  resource: string
  /** Initial sort settings */
  sort?: {
    field: keyof T & string
    order: SortOrder
  }
  /** Initial filters */
  filter?: Record<string, unknown> | QueryFilter[]
  /** Items per page (default: 25) */
  perPage?: number
  /** Enable real-time updates (default: true) */
  realtime?: boolean
  /** Enable optimistic updates (default: true) */
  optimistic?: boolean
}

/**
 * Return type for useResource hook
 */
export interface UseResourceResult<T extends BaseRecord> {
  // State
  /** Current data array */
  data: T[]
  /** Total count of items (for pagination) */
  total: number
  /** Loading state for initial load */
  isLoading: boolean
  /** Loading state for mutations */
  isMutating: boolean
  /** Error from last operation */
  error: AdminError | null

  // Pagination
  /** Current page (1-indexed) */
  page: number
  /** Items per page */
  perPage: number
  /** Whether more pages exist */
  hasMore: boolean
  /** Go to a specific page */
  setPage: (page: number) => void
  /** Change items per page */
  setPerPage: (perPage: number) => void

  // Sorting
  /** Current sort settings */
  sort: { field: string; order: SortOrder } | null
  /** Change sort settings */
  setSort: (field: string, order?: SortOrder) => void

  // Filtering
  /** Current filters */
  filter: Record<string, unknown>
  /** Update filters (merge with existing) */
  setFilter: (filter: Record<string, unknown>) => void
  /** Clear all filters */
  clearFilter: () => void

  // Mutations
  /** Create a new record */
  create: (data: Omit<T, '$id' | 'id'>) => Promise<T>
  /** Update an existing record */
  update: (id: string, data: Partial<Omit<T, '$id' | 'id'>>) => Promise<T>
  /** Delete a record */
  remove: (id: string) => Promise<void>
  /** Delete multiple records */
  removeMany: (ids: string[]) => Promise<void>

  // Actions
  /** Refetch data from server */
  refetch: () => Promise<void>
  /** Find an item by ID from current data */
  findById: (id: string) => T | undefined
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * React hook for working with a resource collection.
 *
 * Provides CRUD operations, pagination, sorting, filtering, and real-time updates.
 *
 * @example
 * ```tsx
 * function UserList() {
 *   const {
 *     data: users,
 *     isLoading,
 *     error,
 *     create,
 *     update,
 *     remove,
 *     setSort,
 *     setFilter,
 *   } = useResource<User>({ resource: 'User' })
 *
 *   if (isLoading) return <Loading />
 *   if (error) return <Error message={error.message} />
 *
 *   return (
 *     <div>
 *       <button onClick={() => setSort('name')}>Sort by Name</button>
 *       <input onChange={e => setFilter({ search: e.target.value })} />
 *       {users.map(user => (
 *         <UserCard
 *           key={user.$id || user.id}
 *           user={user}
 *           onUpdate={update}
 *           onDelete={() => remove(user.$id || user.id)}
 *         />
 *       ))}
 *     </div>
 *   )
 * }
 * ```
 */
export function useResource<T extends BaseRecord = BaseRecord>(
  config: UseResourceConfig<T>
): UseResourceResult<T> {
  const {
    resource,
    sort: initialSort,
    filter: initialFilter,
    perPage: initialPerPage = 25,
    realtime = true,
    optimistic = true,
  } = config

  const { dataProvider } = useAdminContext()

  // State
  const [data, setData] = React.useState<T[]>([])
  const [total, setTotal] = React.useState(0)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isMutating, setIsMutating] = React.useState(false)
  const [error, setError] = React.useState<AdminError | null>(null)

  // Pagination state
  const [page, setPageState] = React.useState(1)
  const [perPage, setPerPageState] = React.useState(initialPerPage)

  // Sort state
  const [sort, setSort] = React.useState<{ field: string; order: SortOrder } | null>(
    initialSort ? { field: initialSort.field, order: initialSort.order } : null
  )

  // Filter state
  const [filter, setFilterState] = React.useState<Record<string, unknown>>(
    Array.isArray(initialFilter)
      ? {}
      : initialFilter ?? {}
  )

  // Fetch version for triggering refetches
  const [fetchVersion, setFetchVersion] = React.useState(0)

  // ==========================================================================
  // Data Fetching
  // ==========================================================================

  React.useEffect(() => {
    let mounted = true

    const fetchData = async () => {
      setIsLoading(true)
      setError(null)

      const params: GetListParams = {
        resource,
        pagination: { page, perPage },
      }

      if (sort) {
        params.sort = sort
      }

      if (Object.keys(filter).length > 0) {
        params.filter = filter
      }

      try {
        const result = await dataProvider.getList<T>(params)

        if (mounted) {
          setData(result.data)
          setTotal(result.total)
          setIsLoading(false)
        }
      } catch (err) {
        if (mounted) {
          setError(formatAdminError(err, resource))
          setIsLoading(false)
        }
      }
    }

    fetchData()

    return () => {
      mounted = false
    }
  }, [dataProvider, resource, page, perPage, sort, filter, fetchVersion])

  // ==========================================================================
  // Real-time Subscription
  // ==========================================================================

  React.useEffect(() => {
    if (!realtime || !dataProvider.subscribe) {
      return
    }

    const unsubscribe = dataProvider.subscribe<T>(resource, (event) => {
      if (event.type === 'created' && event.data) {
        setData((prev) => {
          // Add to beginning of list
          const newData = [event.data as T, ...prev]
          // Trim to perPage to maintain pagination
          return newData.slice(0, perPage)
        })
        setTotal((prev) => prev + 1)
      } else if (event.type === 'updated' && event.data) {
        const updatedItem = event.data as T
        setData((prev) =>
          prev.map((item) =>
            getRecordId(item) === getRecordId(updatedItem) ? updatedItem : item
          )
        )
      } else if (event.type === 'deleted' && event.id) {
        setData((prev) =>
          prev.filter((item) => getRecordId(item) !== event.id)
        )
        setTotal((prev) => Math.max(0, prev - 1))
      }
    })

    return unsubscribe
  }, [dataProvider, resource, realtime, perPage])

  // ==========================================================================
  // Pagination Actions
  // ==========================================================================

  const setPage = React.useCallback((newPage: number) => {
    setPageState(Math.max(1, newPage))
  }, [])

  const setPerPage = React.useCallback((newPerPage: number) => {
    setPerPageState(Math.max(1, Math.min(100, newPerPage)))
    setPageState(1) // Reset to first page
  }, [])

  const hasMore = page * perPage < total

  // ==========================================================================
  // Sort Actions
  // ==========================================================================

  const handleSetSort = React.useCallback(
    (field: string, order?: SortOrder) => {
      setSort((prev) => {
        // Toggle order if clicking same field
        if (prev?.field === field && !order) {
          return {
            field,
            order: prev.order === 'asc' ? 'desc' : 'asc',
          }
        }
        return { field, order: order ?? 'asc' }
      })
      setPageState(1) // Reset to first page
    },
    []
  )

  // ==========================================================================
  // Filter Actions
  // ==========================================================================

  const setFilter = React.useCallback((newFilter: Record<string, unknown>) => {
    setFilterState((prev) => ({ ...prev, ...newFilter }))
    setPageState(1) // Reset to first page
  }, [])

  const clearFilter = React.useCallback(() => {
    setFilterState({})
    setPageState(1)
  }, [])

  // ==========================================================================
  // Mutations
  // ==========================================================================

  const create = React.useCallback(
    async (createData: Omit<T, '$id' | 'id'>): Promise<T> => {
      setIsMutating(true)
      setError(null)

      // Generate temp ID for optimistic update
      const tempId = `temp-${Date.now()}`
      const optimisticItem = { ...createData, $id: tempId, id: tempId } as T

      // Optimistic update
      if (optimistic) {
        setData((prev) => [optimisticItem, ...prev.slice(0, perPage - 1)])
        setTotal((prev) => prev + 1)
      }

      try {
        const result = await dataProvider.create<T>({
          resource,
          data: createData,
        })

        // Replace optimistic item with real data
        setData((prev) =>
          prev.map((item) =>
            getRecordId(item) === tempId ? result.data : item
          )
        )

        setIsMutating(false)
        return result.data
      } catch (err) {
        // Rollback optimistic update
        if (optimistic) {
          setData((prev) =>
            prev.filter((item) => getRecordId(item) !== tempId)
          )
          setTotal((prev) => Math.max(0, prev - 1))
        }

        const adminError = formatAdminError(err, resource)
        setError(adminError)
        setIsMutating(false)
        throw adminError
      }
    },
    [dataProvider, resource, optimistic, perPage]
  )

  const update = React.useCallback(
    async (id: string, updateData: Partial<Omit<T, '$id' | 'id'>>): Promise<T> => {
      setIsMutating(true)
      setError(null)

      // Store original for rollback
      const original = data.find((item) => getRecordId(item) === id)

      // Optimistic update
      if (optimistic && original) {
        setData((prev) =>
          prev.map((item) =>
            getRecordId(item) === id ? { ...item, ...updateData } : item
          )
        )
      }

      try {
        const result = await dataProvider.update<T>({
          resource,
          id,
          data: updateData,
          previousData: original,
        })

        // Update with server response
        setData((prev) =>
          prev.map((item) =>
            getRecordId(item) === id ? result.data : item
          )
        )

        setIsMutating(false)
        return result.data
      } catch (err) {
        // Rollback optimistic update
        if (optimistic && original) {
          setData((prev) =>
            prev.map((item) =>
              getRecordId(item) === id ? original : item
            )
          )
        }

        const adminError = formatAdminError(err, resource)
        setError(adminError)
        setIsMutating(false)
        throw adminError
      }
    },
    [dataProvider, resource, data, optimistic]
  )

  const remove = React.useCallback(
    async (id: string): Promise<void> => {
      setIsMutating(true)
      setError(null)

      // Store original for rollback
      const original = data.find((item) => getRecordId(item) === id)
      const originalIndex = data.findIndex((item) => getRecordId(item) === id)

      // Optimistic update
      if (optimistic) {
        setData((prev) =>
          prev.filter((item) => getRecordId(item) !== id)
        )
        setTotal((prev) => Math.max(0, prev - 1))
      }

      try {
        await dataProvider.delete<T>({
          resource,
          id,
          previousData: original,
        })

        setIsMutating(false)
      } catch (err) {
        // Rollback optimistic update
        if (optimistic && original) {
          setData((prev) => {
            const newData = [...prev]
            newData.splice(originalIndex, 0, original)
            return newData
          })
          setTotal((prev) => prev + 1)
        }

        const adminError = formatAdminError(err, resource)
        setError(adminError)
        setIsMutating(false)
        throw adminError
      }
    },
    [dataProvider, resource, data, optimistic]
  )

  const removeMany = React.useCallback(
    async (ids: string[]): Promise<void> => {
      setIsMutating(true)
      setError(null)

      // Store originals for rollback
      const originals = data.filter((item) =>
        ids.includes(getRecordId(item))
      )

      // Optimistic update
      if (optimistic) {
        setData((prev) =>
          prev.filter((item) => !ids.includes(getRecordId(item)))
        )
        setTotal((prev) => Math.max(0, prev - ids.length))
      }

      try {
        await dataProvider.deleteMany({
          resource,
          ids,
        })

        setIsMutating(false)
      } catch (err) {
        // Rollback optimistic update
        if (optimistic) {
          setData((prev) => [...originals, ...prev])
          setTotal((prev) => prev + originals.length)
        }

        const adminError = formatAdminError(err, resource)
        setError(adminError)
        setIsMutating(false)
        throw adminError
      }
    },
    [dataProvider, resource, data, optimistic]
  )

  // ==========================================================================
  // Utility Actions
  // ==========================================================================

  const refetch = React.useCallback(async () => {
    setFetchVersion((v) => v + 1)
  }, [])

  const findById = React.useCallback(
    (id: string): T | undefined => {
      return data.find((item) => getRecordId(item) === id)
    },
    [data]
  )

  // ==========================================================================
  // Return
  // ==========================================================================

  return React.useMemo(
    () => ({
      // State
      data,
      total,
      isLoading,
      isMutating,
      error,

      // Pagination
      page,
      perPage,
      hasMore,
      setPage,
      setPerPage,

      // Sorting
      sort,
      setSort: handleSetSort,

      // Filtering
      filter,
      setFilter,
      clearFilter,

      // Mutations
      create,
      update,
      remove,
      removeMany,

      // Actions
      refetch,
      findById,
    }),
    [
      data,
      total,
      isLoading,
      isMutating,
      error,
      page,
      perPage,
      hasMore,
      setPage,
      setPerPage,
      sort,
      handleSetSort,
      filter,
      setFilter,
      clearFilter,
      create,
      update,
      remove,
      removeMany,
      refetch,
      findById,
    ]
  )
}
