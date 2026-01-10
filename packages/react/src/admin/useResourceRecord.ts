/**
 * useResourceRecord Hook
 *
 * React hook for working with a single record from a resource.
 * Provides loading, updating, deleting, and real-time updates for one item.
 *
 * @module @dotdo/react/admin
 */

import * as React from 'react'
import { useAdminContext } from './AdminProvider'
import type { BaseRecord } from './types'
import { getRecordId } from './types'
import { AdminError, formatAdminError } from './errors'

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for useResourceRecord hook
 */
export interface UseResourceRecordConfig {
  /** Resource name (e.g., 'User', 'Task') */
  resource: string
  /** Record ID to fetch */
  id: string
  /** Enable real-time updates (default: true) */
  realtime?: boolean
  /** Enable optimistic updates (default: true) */
  optimistic?: boolean
}

/**
 * Return type for useResourceRecord hook
 */
export interface UseResourceRecordResult<T extends BaseRecord> {
  /** The record data, or null if not found/loading */
  data: T | null
  /** Loading state */
  isLoading: boolean
  /** Saving state for mutations */
  isSaving: boolean
  /** Error from last operation */
  error: AdminError | null
  /** Whether the record was not found */
  notFound: boolean

  /** Update the record */
  update: (data: Partial<Omit<T, '$id' | 'id'>>) => Promise<T>
  /** Delete the record */
  remove: () => Promise<void>
  /** Refetch the record from server */
  refetch: () => Promise<void>
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * React hook for working with a single resource record.
 *
 * Provides CRUD operations and real-time updates for one item.
 *
 * @example
 * ```tsx
 * function UserDetail({ userId }: { userId: string }) {
 *   const {
 *     data: user,
 *     isLoading,
 *     error,
 *     notFound,
 *     update,
 *     remove,
 *   } = useResourceRecord<User>({
 *     resource: 'User',
 *     id: userId,
 *   })
 *
 *   if (isLoading) return <Loading />
 *   if (notFound) return <NotFound />
 *   if (error) return <Error message={error.message} />
 *
 *   return (
 *     <form onSubmit={e => {
 *       e.preventDefault()
 *       update({ name: formData.name })
 *     }}>
 *       <input defaultValue={user.name} name="name" />
 *       <button type="submit">Save</button>
 *       <button type="button" onClick={remove}>Delete</button>
 *     </form>
 *   )
 * }
 * ```
 */
export function useResourceRecord<T extends BaseRecord = BaseRecord>(
  config: UseResourceRecordConfig
): UseResourceRecordResult<T> {
  const { resource, id, realtime = true, optimistic = true } = config

  const { dataProvider } = useAdminContext()

  // State
  const [data, setData] = React.useState<T | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isSaving, setIsSaving] = React.useState(false)
  const [error, setError] = React.useState<AdminError | null>(null)
  const [notFound, setNotFound] = React.useState(false)

  // Fetch version for triggering refetches
  const [fetchVersion, setFetchVersion] = React.useState(0)

  // ==========================================================================
  // Data Fetching
  // ==========================================================================

  React.useEffect(() => {
    let mounted = true

    const fetchData = async () => {
      if (!id) {
        setData(null)
        setIsLoading(false)
        setNotFound(true)
        return
      }

      setIsLoading(true)
      setError(null)
      setNotFound(false)

      try {
        const result = await dataProvider.getOne<T>({
          resource,
          id,
        })

        if (mounted) {
          setData(result.data)
          setIsLoading(false)
        }
      } catch (err) {
        if (mounted) {
          const adminError = formatAdminError(err, resource)
          if (adminError.code === 'NOT_FOUND') {
            setNotFound(true)
            setData(null)
          } else {
            setError(adminError)
          }
          setIsLoading(false)
        }
      }
    }

    fetchData()

    return () => {
      mounted = false
    }
  }, [dataProvider, resource, id, fetchVersion])

  // ==========================================================================
  // Real-time Subscription
  // ==========================================================================

  React.useEffect(() => {
    if (!realtime || !dataProvider.subscribe || !id) {
      return
    }

    const unsubscribe = dataProvider.subscribe<T>(resource, (event) => {
      // Only handle events for this specific record
      const eventId = event.id ?? (event.data ? getRecordId(event.data) : null)
      if (eventId !== id) return

      if (event.type === 'updated' && event.data) {
        setData(event.data as T)
      } else if (event.type === 'deleted') {
        setData(null)
        setNotFound(true)
      }
    })

    return unsubscribe
  }, [dataProvider, resource, id, realtime])

  // ==========================================================================
  // Mutations
  // ==========================================================================

  const update = React.useCallback(
    async (updateData: Partial<Omit<T, '$id' | 'id'>>): Promise<T> => {
      if (!id) {
        throw new AdminError({
          code: 'NOT_FOUND',
          message: 'Cannot update: no record ID',
          resource,
        })
      }

      setIsSaving(true)
      setError(null)

      // Store original for rollback
      const original = data

      // Optimistic update
      if (optimistic && original) {
        setData({ ...original, ...updateData } as T)
      }

      try {
        const result = await dataProvider.update<T>({
          resource,
          id,
          data: updateData,
          previousData: original ?? undefined,
        })

        setData(result.data)
        setIsSaving(false)
        return result.data
      } catch (err) {
        // Rollback optimistic update
        if (optimistic && original) {
          setData(original)
        }

        const adminError = formatAdminError(err, resource)
        setError(adminError)
        setIsSaving(false)
        throw adminError
      }
    },
    [dataProvider, resource, id, data, optimistic]
  )

  const remove = React.useCallback(async (): Promise<void> => {
    if (!id) {
      throw new AdminError({
        code: 'NOT_FOUND',
        message: 'Cannot delete: no record ID',
        resource,
      })
    }

    setIsSaving(true)
    setError(null)

    // Store original for rollback
    const original = data

    // Optimistic update
    if (optimistic) {
      setData(null)
    }

    try {
      await dataProvider.delete<T>({
        resource,
        id,
        previousData: original ?? undefined,
      })

      setNotFound(true)
      setIsSaving(false)
    } catch (err) {
      // Rollback optimistic update
      if (optimistic && original) {
        setData(original)
      }

      const adminError = formatAdminError(err, resource)
      setError(adminError)
      setIsSaving(false)
      throw adminError
    }
  }, [dataProvider, resource, id, data, optimistic])

  // ==========================================================================
  // Utility Actions
  // ==========================================================================

  const refetch = React.useCallback(async () => {
    setFetchVersion((v) => v + 1)
  }, [])

  // ==========================================================================
  // Return
  // ==========================================================================

  return React.useMemo(
    () => ({
      data,
      isLoading,
      isSaving,
      error,
      notFound,
      update,
      remove,
      refetch,
    }),
    [data, isLoading, isSaving, error, notFound, update, remove, refetch]
  )
}
