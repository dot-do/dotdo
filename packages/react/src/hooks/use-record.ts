/**
 * useRecord - Single record hook with real-time updates
 *
 * Convenience hook for working with a single record from a collection.
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
 */

import * as React from 'react'
import { useCollection } from './use-collection'
import type { BaseItem, CollectionConfig, UseRecordResult } from '../types'

export interface UseRecordConfig<T> extends CollectionConfig<T> {
  /** The record ID to fetch */
  id: string
}

/**
 * Hook for working with a single record from a collection.
 *
 * Provides real-time updates and convenient mutation methods.
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

  // Find the specific record
  const data = React.useMemo(() => {
    return allData.find(item => item.$id === id) ?? null
  }, [allData, id])

  // Bound update function
  const update = React.useCallback(async (changes: Partial<T>): Promise<void> => {
    await collectionUpdate(id, changes)
  }, [collectionUpdate, id])

  // Bound delete function
  const deleteRecord = React.useCallback(async (): Promise<void> => {
    await collectionDelete(id)
  }, [collectionDelete, id])

  return {
    data,
    isLoading,
    error,
    update,
    delete: deleteRecord,
    refetch,
  }
}
