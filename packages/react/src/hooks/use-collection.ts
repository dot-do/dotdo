/**
 * useCollection - Real-time collection sync hook
 *
 * Connects to a Durable Object via WebSocket and provides reactive data
 * with optimistic mutations.
 *
 * @example
 * ```tsx
 * import { useCollection } from '@dotdo/react'
 *
 * function TaskList() {
 *   const { data: tasks, isLoading, insert, update, delete: remove } = useCollection<Task>({
 *     collection: 'Task',
 *   })
 *
 *   if (isLoading) return <Loading />
 *
 *   return (
 *     <ul>
 *       {tasks.map(task => (
 *         <li key={task.$id}>
 *           {task.title}
 *           <button onClick={() => update(task.$id, { done: true })}>Done</button>
 *           <button onClick={() => remove(task.$id)}>Delete</button>
 *         </li>
 *       ))}
 *     </ul>
 *   )
 * }
 * ```
 *
 * @module @dotdo/react
 */

import * as React from 'react'
import { useDotdoContext } from '../context'
import type { BaseItem, CollectionConfig, SyncMessage, UseDotdoCollectionResult } from '../types'

/**
 * Hook for managing a collection with real-time sync.
 *
 * Connects to a Durable Object via WebSocket and provides reactive data
 * with optimistic mutations.
 *
 * @param config - Collection configuration
 * @returns Collection state and mutation methods
 */
export function useCollection<T extends BaseItem>(
  config: CollectionConfig<T>
): UseDotdoCollectionResult<T> {
  const { ns, connections } = useDotdoContext()
  const { collection, branch } = config

  // State
  const [data, setData] = React.useState<T[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<Error | null>(null)
  const [txid, setTxid] = React.useState(0)
  const [pendingMutations, setPendingMutations] = React.useState(0)

  // Refs for stable callbacks - avoids re-render dependencies
  const dataRef = React.useRef<T[]>(data)
  dataRef.current = data

  // Optimistic updates store
  const optimisticRef = React.useRef<Map<string, { type: 'insert' | 'update' | 'delete'; item: T | Partial<T> }>>(new Map())

  // WebSocket ref
  const wsRef = React.useRef<WebSocket | null>(null)

  // Connection key
  const connectionKey = branch ? `${collection}:${branch}` : collection

  // Derive URLs - memoized to prevent re-computation
  const wsUrl = React.useMemo(() => {
    return ns.replace(/^https?:/, (m) => m === 'https:' ? 'wss:' : 'ws:') + '/sync'
  }, [ns])

  const rpcUrl = React.useMemo(() => {
    return ns + '/rpc'
  }, [ns])

  // Connect to WebSocket
  const connect = React.useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws
    connections.set(connectionKey, ws)

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
          setData(msg.data as T[])
          setTxid(msg.txid)
          setIsLoading(false)
          setError(null)
        } else if (msg.type === 'insert') {
          const newItem = msg.data as T
          setData(prev => [...prev, newItem])
          setTxid(msg.txid)
        } else if (msg.type === 'update') {
          const updatedItem = msg.data as T
          setData(prev => prev.map(item =>
            item.$id === (msg.key ?? updatedItem.$id) ? updatedItem : item
          ))
          setTxid(msg.txid)
        } else if (msg.type === 'delete') {
          const keyToDelete = msg.key
          setData(prev => prev.filter(item => item.$id !== keyToDelete))
          setTxid(msg.txid)
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
  }, [wsUrl, collection, branch, connectionKey, connections])

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

  // RPC helper - stable reference, doesn't depend on changing state
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

  // Insert mutation with optimistic update - stable reference
  const insert = React.useCallback(async (item: T): Promise<void> => {
    // Optimistic update
    setData(prev => [...prev, item])
    setPendingMutations(p => p + 1)
    optimisticRef.current.set(item.$id, { type: 'insert', item })

    try {
      await rpc('create', item)
      optimisticRef.current.delete(item.$id)
    } catch (err) {
      // Rollback on failure
      setData(prev => prev.filter(i => i.$id !== item.$id))
      optimisticRef.current.delete(item.$id)
      throw err
    } finally {
      setPendingMutations(p => Math.max(0, p - 1))
    }
  }, [rpc])

  // Update mutation with optimistic update - uses ref to avoid data dependency
  const update = React.useCallback(async (id: string, changes: Partial<T>): Promise<void> => {
    // Use ref to get current data without causing re-renders
    const original = dataRef.current.find(item => item.$id === id)
    if (!original) return

    // Optimistic update
    setData(prev => prev.map(item =>
      item.$id === id ? { ...item, ...changes } : item
    ))
    setPendingMutations(p => p + 1)
    optimisticRef.current.set(id, { type: 'update', item: original })

    try {
      await rpc('update', { key: id, ...changes })
      optimisticRef.current.delete(id)
    } catch (err) {
      // Rollback on failure
      setData(prev => prev.map(item =>
        item.$id === id ? original : item
      ))
      optimisticRef.current.delete(id)
      throw err
    } finally {
      setPendingMutations(p => Math.max(0, p - 1))
    }
  }, [rpc])

  // Delete mutation with optimistic update - uses ref to avoid data dependency
  const deleteItem = React.useCallback(async (id: string): Promise<void> => {
    // Use ref to get current data without causing re-renders
    const original = dataRef.current.find(item => item.$id === id)
    if (!original) return

    // Optimistic update
    setData(prev => prev.filter(item => item.$id !== id))
    setPendingMutations(p => p + 1)
    optimisticRef.current.set(id, { type: 'delete', item: original })

    try {
      await rpc('delete', { key: id })
      optimisticRef.current.delete(id)
    } catch (err) {
      // Rollback on failure
      setData(prev => [...prev, original])
      optimisticRef.current.delete(id)
      throw err
    } finally {
      setPendingMutations(p => Math.max(0, p - 1))
    }
  }, [rpc])

  // Refetch - reconnect to get fresh data
  const refetch = React.useCallback(() => {
    setIsLoading(true)
    if (wsRef.current) {
      wsRef.current.close()
    }
    connect()
  }, [connect])

  // Memoize the return value to prevent unnecessary re-renders in consumers
  return React.useMemo(() => ({
    data,
    isLoading,
    error,
    txid,
    pendingMutations,
    insert,
    update,
    delete: deleteItem,
    refetch,
  }), [data, isLoading, error, txid, pendingMutations, insert, update, deleteItem, refetch])
}
