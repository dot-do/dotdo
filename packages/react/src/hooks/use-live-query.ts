/**
 * useLiveQuery - Reactive queries over collection data
 *
 * Filters, joins, and transforms collection data reactively.
 * Updates automatically when the source data changes.
 *
 * @example
 * ```tsx
 * import { useDotdoCollection, useLiveQuery } from '@dotdo/react'
 *
 * function TaskBoard() {
 *   const { data: tasks } = useDotdoCollection<Task>({ collection: 'Task' })
 *   const { data: users } = useDotdoCollection<User>({ collection: 'User' })
 *
 *   // Simple filter
 *   const todoTasks = useLiveQuery(tasks, {
 *     from: 'Task',
 *     where: { status: 'todo' },
 *     orderBy: 'createdAt',
 *     order: 'desc',
 *   })
 *
 *   // With joins
 *   const tasksWithAssignees = useLiveQuery(tasks, {
 *     from: 'Task',
 *     join: {
 *       assignee: {
 *         from: users,
 *         on: (task, user) => task.assigneeId === user.$id,
 *         type: 'left',
 *       },
 *     },
 *   })
 * }
 * ```
 */

import * as React from 'react'
import type { BaseItem, LiveQueryConfig } from '../types'

/**
 * Hook for creating live queries over collection data.
 *
 * Filters, joins, and transforms collection data reactively.
 * Updates automatically when the source data changes.
 */
export function useLiveQuery<T extends BaseItem, R = T>(
  data: T[],
  config: LiveQueryConfig<T, unknown>
): R[] {
  return React.useMemo(() => {
    let result = [...data]

    // Apply where filter
    if (config.where) {
      if (typeof config.where === 'function') {
        result = result.filter(config.where as (item: T) => boolean)
      } else {
        const whereObj = config.where as Partial<T>
        result = result.filter(item => {
          for (const [key, value] of Object.entries(whereObj)) {
            if (item[key] !== value) return false
          }
          return true
        })
      }
    }

    // Apply joins
    if (config.join) {
      const joinedResults: R[] = []

      for (const item of result) {
        const joinedItem: Record<string, unknown> = { ...item }
        let includeItem = true

        for (const [joinKey, joinConfig] of Object.entries(config.join)) {
          const { from: joinData, on, type = 'left' } = joinConfig as {
            from: BaseItem[]
            on: (item: T, joinItem: BaseItem) => boolean
            type?: 'left' | 'inner'
          }

          const matchedJoin = joinData.find(joinItem => on(item, joinItem))

          if (type === 'inner' && !matchedJoin) {
            // Skip this item for inner joins with no match
            includeItem = false
            break
          }

          joinedItem[joinKey] = matchedJoin ?? null
        }

        if (!includeItem) continue

        // For joins, restructure to { task: {...}, assignee: {...}, project: {...} }
        const structured: Record<string, unknown> = {}
        const itemKey = config.from.toLowerCase()
        structured[itemKey] = item

        for (const [joinKey] of Object.entries(config.join)) {
          structured[joinKey] = joinedItem[joinKey]
        }

        joinedResults.push(structured as R)
      }

      return joinedResults
    }

    // Apply ordering
    if (config.orderBy) {
      if (typeof config.orderBy === 'function') {
        result.sort(config.orderBy as (a: T, b: T) => number)
      } else {
        const orderKey = config.orderBy as keyof T
        const direction = config.order === 'desc' ? -1 : 1
        result.sort((a, b) => {
          const aVal = a[orderKey]
          const bVal = b[orderKey]
          if (aVal < bVal) return -1 * direction
          if (aVal > bVal) return 1 * direction
          return 0
        })
      }
    }

    // Apply offset
    if (config.offset) {
      result = result.slice(config.offset)
    }

    // Apply limit (check for undefined, not falsy, since 0 is valid)
    if (config.limit !== undefined) {
      result = result.slice(0, config.limit)
    }

    return result as unknown as R[]
  }, [data, config.where, config.join, config.orderBy, config.order, config.limit, config.offset, config.from])
}
