/**
 * useRecord - Single record hook with real-time updates
 *
 * Convenience hook for working with a single record from a collection.
 * Wraps useCollection and filters to a specific record ID.
 *
 * @example
 * ```tsx
 * import { useRecord } from '@dotdo/react'
 *
 * function TaskDetail({ taskId }: { taskId: string }) {
 *   const { data: task, isLoading, update, delete: remove } = useRecord<Task>({
 *     collection: 'Task',
 *     id: taskId,
 *   })
 *
 *   if (isLoading) return <Loading />
 *   if (!task) return <NotFound />
 *
 *   return (
 *     <div>
 *       <h1>{task.title}</h1>
 *       <button onClick={() => update({ status: 'done' })}>Mark Done</button>
 *       <button onClick={() => remove()}>Delete</button>
 *     </div>
 *   )
 * }
 * ```
 *
 * @module @dotdo/react
 */

import * as React from 'react'
import { useCollection } from './use-collection'
import type { BaseItem, CollectionConfig, UseRecordResult } from '../types'

/**
 * Configuration for useRecord hook.
 *
 * @typeParam T - The item type for the record
 */
export interface UseRecordConfig<T> extends CollectionConfig<T> {
  /** The record ID to fetch and watch */
  id: string
}

/**
 * Hook for working with a single record from a collection.
 *
 * Provides real-time updates and convenient mutation methods bound
 * to the specific record ID.
 *
 * @param config - Record configuration including collection name and ID
 * @returns Record state and mutation methods
 *
 * @remarks
 * This hook uses useCollection internally and filters to the specific ID.
 * For better performance with large collections, consider using useDO
 * with a direct RPC call instead.
 */
export function useRecord<T extends BaseItem>(
  config: UseRecordConfig<T>
): UseRecordResult<T> {
  const { id, ...collectionConfig } = config

  // Use the collection hook
  const {
    data: allData,
    isLoading,
    error,
    update: collectionUpdate,
    delete: collectionDelete,
    refetch,
  } = useCollection<T>(collectionConfig)

  // Find the specific record - memoized
  const data = React.useMemo(() => {
    return allData.find(item => item.$id === id) ?? null
  }, [allData, id])

  // Bound update function - stable reference
  const update = React.useCallback(async (changes: Partial<T>): Promise<void> => {
    await collectionUpdate(id, changes)
  }, [collectionUpdate, id])

  // Bound delete function - stable reference
  const deleteRecord = React.useCallback(async (): Promise<void> => {
    await collectionDelete(id)
  }, [collectionDelete, id])

  // Memoize return value
  return React.useMemo(() => ({
    data,
    isLoading,
    error,
    update,
    delete: deleteRecord,
    refetch,
  }), [data, isLoading, error, update, deleteRecord, refetch])
}
