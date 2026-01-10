/**
 * useRecord - Single record hook with real-time updates
 *
 * Optimized hook for working with a single record from a collection.
 * Uses direct RPC call to fetch only the specific record (O(1) instead of O(n)),
 * and subscribes to updates only for that record.
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
import { useDotdoContext } from '../context'
import type { BaseItem, CollectionConfig, SyncMessage, UseRecordResult } from '../types'

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
 * This implementation uses direct RPC calls to fetch only the specific record,
 * providing O(1) performance instead of O(n) when using useCollection.
 * It also subscribes only to updates for the specific record ID.
 *
 * @param config - Record configuration including collection name and ID
 * @returns Record state and mutation methods
 */
export function useRecord<T extends BaseItem>(
  config: UseRecordConfig<T>
): UseRecordResult<T> {
  const { id, collection, branch } = config
  const { ns, connections } = useDotdoContext()

  // State
  const [data, setData] = React.useState<T | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<Error | null>(null)

  // Refs for stable callbacks
  const dataRef = React.useRef<T | null>(data)
  dataRef.current = data

  // Optimistic update store
  const optimisticRef = React.useRef<{ type: 'update' | 'delete'; original: T } | null>(null)

  // WebSocket ref
  const wsRef = React.useRef<WebSocket | null>(null)

  // Connection key - unique for collection+branch (not per-record, to allow reusing connection)
  const connectionKey = branch ? `${collection}:${branch}` : collection

  // Current id ref - to track id in message handlers
  const idRef = React.useRef(id)
  idRef.current = id

  // Derive URLs - memoized to prevent re-computation
  const wsUrl = React.useMemo(() => {
    return ns.replace(/^https?:/, (m) => m === 'https:' ? 'wss:' : 'ws:') + '/sync'
  }, [ns])

  const rpcUrl = React.useMemo(() => {
    return ns + '/rpc'
  }, [ns])

  // RPC helper - stable reference
  const rpc = React.useCallback(async (method: string, args: unknown): Promise<unknown> => {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: crypto.randomUUID(),
        type: 'call',
        calls: [{
          promiseId: 'p-1',
          target: { type: 'root' },
          method: `${collection}.${method}`,
          args: [{ type: 'value', value: args }],
        }],
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
  }, [rpcUrl, collection])

  // Send subscription message for current id
  const subscribe = React.useCallback((ws: WebSocket) => {
    const subscribeMsg: Record<string, string> = {
      type: 'subscribe',
      collection,
      key: idRef.current, // Subscribe only to this record
    }
    if (branch) {
      subscribeMsg.branch = branch
    }
    ws.send(JSON.stringify(subscribeMsg))
  }, [collection, branch])

  // Connect to WebSocket and subscribe to this specific record
  const connect = React.useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      // Already connected, just re-subscribe with new id
      subscribe(wsRef.current)
      return
    }

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws
    connections.set(connectionKey, ws)

    ws.addEventListener('open', () => {
      subscribe(ws)
    })

    ws.addEventListener('message', (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data) as SyncMessage<T>
        const currentId = idRef.current

        // Handle messages for our specific record
        if (msg.type === 'initial') {
          // Initial data: could be single record or array with one item
          const initialData = msg.data
          if (Array.isArray(initialData)) {
            // Find our record in the array
            const record = initialData.find(item => item.$id === currentId) ?? null
            setData(record)
          } else if (initialData && (initialData as T).$id === currentId) {
            setData(initialData as T)
          } else {
            setData(null)
          }
          setIsLoading(false)
          setError(null)
        } else if (msg.type === 'update') {
          // Update: only apply if it's our record
          const updatedItem = msg.data as T
          const keyToUpdate = msg.key ?? updatedItem?.$id
          if (keyToUpdate === currentId) {
            setData(updatedItem)
          }
        } else if (msg.type === 'delete') {
          // Delete: only apply if it's our record
          if (msg.key === currentId) {
            setData(null)
          }
        } else if (msg.type === 'insert') {
          // Insert: only apply if it's our record (e.g., after rollback restoration)
          const insertedItem = msg.data as T
          if (insertedItem?.$id === currentId) {
            setData(insertedItem)
          }
        }
      } catch {
        // Silently ignore malformed messages
      }
    })

    ws.addEventListener('close', () => {
      connections.delete(connectionKey)
      // Schedule reconnection
      setTimeout(() => {
        if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
          connect()
        }
      }, 1000)
    })

    ws.addEventListener('error', () => {
      setError(new Error('WebSocket connection error'))
    })
  }, [wsUrl, collection, branch, connectionKey, connections, subscribe])

  // Initialize connection
  React.useEffect(() => {
    connect()

    return () => {
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      connections.delete(connectionKey)
    }
  }, [connect, connectionKey, connections])

  // Handle id changes - re-subscribe without reconnecting
  React.useEffect(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      // Reset state for new record
      setData(null)
      setIsLoading(true)
      // Send new subscription
      subscribe(wsRef.current)
    }
  }, [id, subscribe])

  // Update mutation with optimistic update
  const update = React.useCallback(async (changes: Partial<T>): Promise<void> => {
    const original = dataRef.current
    if (!original) return

    // Optimistic update
    setData(prev => prev ? { ...prev, ...changes } : null)
    optimisticRef.current = { type: 'update', original }

    try {
      await rpc('update', { key: id, ...changes })
      optimisticRef.current = null
    } catch (err) {
      // Rollback on failure
      setData(original)
      optimisticRef.current = null
      throw err
    }
  }, [rpc, id])

  // Delete mutation with optimistic update
  const deleteRecord = React.useCallback(async (): Promise<void> => {
    const original = dataRef.current
    if (!original) return

    // Optimistic update
    setData(null)
    optimisticRef.current = { type: 'delete', original }

    try {
      await rpc('delete', { key: id })
      optimisticRef.current = null
    } catch (err) {
      // Rollback on failure
      setData(original)
      optimisticRef.current = null
      throw err
    }
  }, [rpc, id])

  // Refetch - reconnect to get fresh data
  const refetch = React.useCallback(() => {
    setIsLoading(true)
    if (wsRef.current) {
      wsRef.current.close()
    }
    connect()
  }, [connect])

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
