/**
 * useCollection - React hook for real-time collection sync
 *
 * Provides reactive data with optimistic mutations for TanStack DB integration.
 *
 * @example
 * ```tsx
 * import { useCollection } from '@dotdo/tanstack/react'
 * import { z } from 'zod'
 *
 * const TaskSchema = z.object({
 *   $id: z.string(),
 *   title: z.string(),
 *   status: z.enum(['todo', 'done']),
 * })
 *
 * function TaskList() {
 *   const { data: tasks, isLoading, insert, update, delete: remove } = useCollection({
 *     collection: 'Task',
 *     schema: TaskSchema,
 *   })
 *
 *   if (isLoading) return <Loading />
 *
 *   return (
 *     <ul>
 *       {tasks.map(task => (
 *         <li key={task.$id}>{task.title}</li>
 *       ))}
 *     </ul>
 *   )
 * }
 * ```
 *
 * @module @dotdo/tanstack/react
 */

import * as React from 'react'
import { useSyncContext } from './provider'
import type { BaseItem, CollectionConfig, SyncMessage, UseCollectionResult } from './types'

/**
 * Hook for managing a collection with real-time sync and optimistic updates.
 *
 * @param config - Collection configuration
 * @returns Collection state and mutation methods
 */
export function useCollection<T extends BaseItem>(
  config: CollectionConfig<T>
): UseCollectionResult<T> {
  const { doUrl, getAuthToken } = useSyncContext()
  const { collection, branch } = config

  // State
  const [data, setData] = React.useState<T[]>([])
  const [isLoading, setIsLoading] = React.useState(true)

  // Refs for stable callbacks
  const dataRef = React.useRef<T[]>(data)
  dataRef.current = data

  // Optimistic updates store
  const optimisticRef = React.useRef<Map<string, { type: 'insert' | 'update' | 'delete'; item: T }>>(
    new Map()
  )

  // WebSocket ref
  const wsRef = React.useRef<WebSocket | null>(null)

  // Derive URLs
  const wsUrl = React.useMemo(() => {
    return doUrl.replace(/^https?:/, (m) => (m === 'https:' ? 'wss:' : 'ws:')) + '/sync'
  }, [doUrl])

  const rpcUrl = React.useMemo(() => {
    return doUrl + '/rpc'
  }, [doUrl])

  // Connect to WebSocket
  const connect = React.useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.addEventListener('open', () => {
      // Subscribe to collection
      const subscribeMsg: Record<string, string> = {
        type: 'subscribe',
        collection,
      }
      if (branch) {
        subscribeMsg.branch = branch
      }
      ws.send(JSON.stringify(subscribeMsg))
    })

    ws.addEventListener('message', (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data) as SyncMessage<T>

        if (msg.type === 'initial') {
          setData(msg.data)
          setIsLoading(false)
        } else if (msg.type === 'insert') {
          setData((prev) => [...prev, msg.data])
        } else if (msg.type === 'update') {
          setData((prev) =>
            prev.map((item) => (item.$id === (msg.key ?? msg.data.$id) ? msg.data : item))
          )
        } else if (msg.type === 'delete') {
          setData((prev) => prev.filter((item) => item.$id !== msg.key))
        }
      } catch {
        // Silently ignore malformed messages
      }
    })

    ws.addEventListener('close', () => {
      // Schedule reconnection
      setTimeout(() => {
        if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
          connect()
        }
      }, 1000)
    })

    ws.addEventListener('error', () => {
      // Error will be followed by close
    })
  }, [wsUrl, collection, branch])

  // Initialize connection
  React.useEffect(() => {
    connect()

    return () => {
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [connect])

  // RPC helper
  const rpc = React.useCallback(
    async (method: string, args: unknown): Promise<unknown> => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }

      if (getAuthToken) {
        const token = getAuthToken()
        if (token) {
          headers['Authorization'] = `Bearer ${token}`
        }
      }

      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          id: crypto.randomUUID(),
          type: 'call',
          calls: [
            {
              promiseId: 'p-1',
              target: { type: 'root' },
              method: `${collection}.${method}`,
              args: [{ type: 'value', value: args }],
            },
          ],
        }),
      })

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`)
      }

      const result = await response.json()
      if (result.error) {
        throw new Error(result.error.message)
      }

      return result.results?.[0]?.value
    },
    [rpcUrl, collection, getAuthToken]
  )

  // Insert mutation with optimistic update
  const insert = React.useCallback(
    async (item: T): Promise<void> => {
      // Optimistic update
      setData((prev) => [...prev, item])
      optimisticRef.current.set(item.$id, { type: 'insert', item })

      try {
        await rpc('create', item)
        optimisticRef.current.delete(item.$id)
      } catch (err) {
        // Rollback on failure
        setData((prev) => prev.filter((i) => i.$id !== item.$id))
        optimisticRef.current.delete(item.$id)
        throw err
      }
    },
    [rpc]
  )

  // Update mutation with optimistic update
  const update = React.useCallback(
    async (id: string, changes: Partial<T>): Promise<void> => {
      const original = dataRef.current.find((item) => item.$id === id)
      if (!original) return

      // Optimistic update
      setData((prev) => prev.map((item) => (item.$id === id ? { ...item, ...changes } : item)))
      optimisticRef.current.set(id, { type: 'update', item: original })

      try {
        await rpc('update', { key: id, ...changes })
        optimisticRef.current.delete(id)
      } catch (err) {
        // Rollback on failure
        setData((prev) => prev.map((item) => (item.$id === id ? original : item)))
        optimisticRef.current.delete(id)
        throw err
      }
    },
    [rpc]
  )

  // Delete mutation with optimistic update
  const deleteItem = React.useCallback(
    async (id: string): Promise<void> => {
      const original = dataRef.current.find((item) => item.$id === id)
      if (!original) return

      // Optimistic update
      setData((prev) => prev.filter((item) => item.$id !== id))
      optimisticRef.current.set(id, { type: 'delete', item: original })

      try {
        await rpc('delete', { key: id })
        optimisticRef.current.delete(id)
      } catch (err) {
        // Rollback on failure
        setData((prev) => [...prev, original])
        optimisticRef.current.delete(id)
        throw err
      }
    },
    [rpc]
  )

  // Find by ID
  const findById = React.useCallback(
    (id: string): T | undefined => {
      return dataRef.current.find((item) => item.$id === id)
    },
    []
  )

  // Memoize return value
  return React.useMemo(
    () => ({
      data,
      isLoading,
      insert,
      update,
      delete: deleteItem,
      findById,
    }),
    [data, isLoading, insert, update, deleteItem, findById]
  )
}

// Backwards compatibility alias
export const useDotdoCollection = useCollection
