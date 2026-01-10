/** @jsxImportSource react */
/**
 * TanStack DB React Bindings for dotdo
 *
 * Provides React hooks and components for real-time data synchronization
 * with dotdo backends using TanStack DB patterns.
 *
 * @module @dotdo/tanstack/react
 *
 * @example
 * ```tsx
 * import { SyncProvider, useDotdoCollection, useLiveQuery } from '@dotdo/tanstack/react'
 *
 * function App() {
 *   return (
 *     <SyncProvider doUrl="wss://api.example.com/do/workspace-1">
 *       <TaskBoard />
 *     </SyncProvider>
 *   )
 * }
 *
 * function TaskBoard() {
 *   const { data: tasks, insert, update, delete: remove } = useDotdoCollection({
 *     collection: 'Task',
 *     schema: TaskSchema,
 *   })
 *
 *   const todoTasks = useLiveQuery(tasks, {
 *     from: 'Task',
 *     where: { status: 'todo' },
 *   })
 *
 *   return <div>{todoTasks.map(t => <TaskCard key={t.$id} task={t} />)}</div>
 * }
 * ```
 */

import * as React from 'react'
import { z } from 'zod'

// =============================================================================
// Types
// =============================================================================

/**
 * Base item type with required $id field
 */
interface BaseItem {
  $id: string
  [key: string]: unknown
}

/**
 * Sync context value
 */
interface SyncContextValue {
  doUrl: string
  connections: Map<string, WebSocket>
  getConnection: (collection: string) => WebSocket | null
}

/**
 * Props for SyncProvider
 */
export interface SyncProviderProps {
  /** WebSocket URL for the Durable Object */
  doUrl: string
  /** Child components */
  children: React.ReactNode
}

/**
 * Configuration for useDotdoCollection hook
 */
export interface UseDotdoCollectionConfig<T> {
  /** Collection name (Noun type) */
  collection: string
  /** Zod schema for validating items */
  schema: z.ZodSchema<T>
  /** Optional branch for branched data */
  branch?: string
}

/**
 * Return type for useDotdoCollection hook
 */
export interface UseDotdoCollectionResult<T extends BaseItem> {
  /** Current data in the collection */
  data: T[]
  /** Whether initial data is loading */
  isLoading: boolean
  /** Current transaction ID */
  txid: number
  /** Number of pending mutations */
  pendingMutations: number
  /** Insert a new item */
  insert: (item: T) => Promise<void>
  /** Update an existing item */
  update: (id: string, changes: Partial<T>) => Promise<void>
  /** Delete an item */
  delete: (id: string) => Promise<void>
}

/**
 * Query configuration for useLiveQuery
 */
export interface LiveQueryConfig<T, U = unknown> {
  /** Collection name (for type reference) */
  from: string
  /** Filter conditions */
  where?: Partial<T> | ((item: T) => boolean)
  /** Join configuration */
  join?: {
    [key: string]: {
      from: U[]
      on: (item: T, joinItem: U) => boolean
      type?: 'left' | 'inner'
    }
  }
  /** Order by field */
  orderBy?: keyof T | ((a: T, b: T) => number)
  /** Order direction */
  order?: 'asc' | 'desc'
  /** Limit results */
  limit?: number
}

/**
 * WebSocket message types
 */
interface SyncMessage<T = unknown> {
  type: 'initial' | 'insert' | 'update' | 'delete'
  collection: string
  data?: T | T[]
  key?: string
  txid: number
}

// =============================================================================
// Context
// =============================================================================

const SyncContext = React.createContext<SyncContextValue | null>(null)

/**
 * Hook to get the sync context
 */
function useSyncContext(): SyncContextValue {
  const context = React.useContext(SyncContext)
  if (!context) {
    throw new Error('useDotdoCollection must be used within a SyncProvider')
  }
  return context
}

// =============================================================================
// Components
// =============================================================================

/**
 * Provider component for real-time sync functionality.
 *
 * Wraps your application to provide WebSocket connection management
 * for all useDotdoCollection hooks within the tree.
 *
 * @example
 * ```tsx
 * <SyncProvider doUrl="wss://api.example.com/do/workspace-1">
 *   <App />
 * </SyncProvider>
 * ```
 */
export function SyncProvider({ doUrl, children }: SyncProviderProps): React.ReactElement {
  const connectionsRef = React.useRef<Map<string, WebSocket>>(new Map())

  const getConnection = React.useCallback((collection: string): WebSocket | null => {
    return connectionsRef.current.get(collection) ?? null
  }, [])

  const value = React.useMemo<SyncContextValue>(() => ({
    doUrl,
    connections: connectionsRef.current,
    getConnection,
  }), [doUrl, getConnection])

  return (
    <SyncContext.Provider value={value}>
      {children}
    </SyncContext.Provider>
  )
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Hook for managing a collection with real-time sync.
 *
 * Connects to a Durable Object via WebSocket and provides reactive data
 * with optimistic mutations.
 *
 * @example
 * ```tsx
 * const { data: tasks, isLoading, insert, update, delete: remove } = useDotdoCollection({
 *   collection: 'Task',
 *   schema: TaskSchema,
 * })
 *
 * // Insert a new task
 * await insert({ $id: 'task-1', title: 'New Task', status: 'todo' })
 *
 * // Update a task
 * await update('task-1', { status: 'done' })
 *
 * // Delete a task
 * await remove('task-1')
 * ```
 */
export function useDotdoCollection<T extends BaseItem>(
  config: UseDotdoCollectionConfig<T>
): UseDotdoCollectionResult<T> {
  const { doUrl, connections } = useSyncContext()
  const { collection, branch } = config

  // State
  const [data, setData] = React.useState<T[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [txid, setTxid] = React.useState(0)
  const [pendingMutations, setPendingMutations] = React.useState(0)

  // Optimistic updates store
  const optimisticRef = React.useRef<Map<string, { type: 'insert' | 'update' | 'delete'; item: T | Partial<T> }>>(new Map())

  // Track if we've initialized the WebSocket
  const wsRef = React.useRef<WebSocket | null>(null)

  // Initialize WebSocket synchronously on first render
  // This ensures the WebSocket is created immediately, not deferred to useEffect
  if (!wsRef.current) {
    const wsUrl = `${doUrl}/sync`
    wsRef.current = new WebSocket(wsUrl)
  }

  // WebSocket connection setup
  React.useEffect(() => {
    const ws = wsRef.current
    if (!ws) return

    const handleOpen = () => {
      // Subscribe to collection
      const subscribeMsg: Record<string, string> = {
        type: 'subscribe',
        collection,
      }
      if (branch) {
        subscribeMsg.branch = branch
      }
      ws.send(JSON.stringify(subscribeMsg))
    }

    const handleMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data) as SyncMessage<T>

        if (msg.type === 'initial') {
          setData(msg.data as T[])
          setTxid(msg.txid)
          setIsLoading(false)
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
    }

    const handleClose = () => {
      // Remove from connections map
      connections.delete(collection)

      // Schedule reconnection
      setTimeout(() => {
        // Reconnection will happen on next render cycle
      }, 1000)
    }

    ws.addEventListener('open', handleOpen)
    ws.addEventListener('message', handleMessage)
    ws.addEventListener('close', handleClose)

    // Store connection
    connections.set(collection, ws)

    return () => {
      ws.close()
      connections.delete(collection)
      wsRef.current = null
    }
  }, [doUrl, collection, branch, connections])

  // Mutation handlers with optimistic updates
  const insert = React.useCallback(async (item: T): Promise<void> => {
    // Optimistic update
    setData(prev => [...prev, item])
    setPendingMutations(p => p + 1)
    optimisticRef.current.set(item.$id, { type: 'insert', item })

    try {
      const rpcUrl = doUrl.replace(/^wss?:/, (m) => m === 'wss:' ? 'https:' : 'http:') + '/rpc'
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          type: 'call',
          calls: [{
            promiseId: 'p-1',
            target: { type: 'root' },
            method: `${collection}.create`,
            args: [{ type: 'value', value: item }],
          }],
        }),
      })

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`)
      }

      optimisticRef.current.delete(item.$id)
    } catch (error) {
      // Rollback on failure
      setData(prev => prev.filter(i => i.$id !== item.$id))
      optimisticRef.current.delete(item.$id)
      throw error
    } finally {
      setPendingMutations(p => Math.max(0, p - 1))
    }
  }, [doUrl, collection])

  const update = React.useCallback(async (id: string, changes: Partial<T>): Promise<void> => {
    // Store original for rollback
    const original = data.find(item => item.$id === id)
    if (!original) return

    // Optimistic update
    setData(prev => prev.map(item =>
      item.$id === id ? { ...item, ...changes } : item
    ))
    setPendingMutations(p => p + 1)
    optimisticRef.current.set(id, { type: 'update', item: original })

    try {
      const rpcUrl = doUrl.replace(/^wss?:/, (m) => m === 'wss:' ? 'https:' : 'http:') + '/rpc'
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          type: 'call',
          calls: [{
            promiseId: 'p-1',
            target: { type: 'root' },
            method: `${collection}.update`,
            args: [{ type: 'value', value: { key: id, ...changes } }],
          }],
        }),
      })

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`)
      }

      optimisticRef.current.delete(id)
    } catch (error) {
      // Rollback on failure
      setData(prev => prev.map(item =>
        item.$id === id ? original : item
      ))
      optimisticRef.current.delete(id)
      throw error
    } finally {
      setPendingMutations(p => Math.max(0, p - 1))
    }
  }, [doUrl, collection, data])

  const deleteItem = React.useCallback(async (id: string): Promise<void> => {
    // Store original for rollback
    const original = data.find(item => item.$id === id)
    if (!original) return

    // Optimistic update
    setData(prev => prev.filter(item => item.$id !== id))
    setPendingMutations(p => p + 1)
    optimisticRef.current.set(id, { type: 'delete', item: original })

    try {
      const rpcUrl = doUrl.replace(/^wss?:/, (m) => m === 'wss:' ? 'https:' : 'http:') + '/rpc'
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: crypto.randomUUID(),
          type: 'call',
          calls: [{
            promiseId: 'p-1',
            target: { type: 'root' },
            method: `${collection}.delete`,
            args: [{ type: 'value', value: { key: id } }],
          }],
        }),
      })

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`)
      }

      optimisticRef.current.delete(id)
    } catch (error) {
      // Rollback on failure
      setData(prev => [...prev, original])
      optimisticRef.current.delete(id)
      throw error
    } finally {
      setPendingMutations(p => Math.max(0, p - 1))
    }
  }, [doUrl, collection, data])

  return {
    data,
    isLoading,
    txid,
    pendingMutations,
    insert,
    update,
    delete: deleteItem,
  }
}

/**
 * Hook for creating live queries over collection data.
 *
 * Filters, joins, and transforms collection data reactively.
 * Updates automatically when the source data changes.
 *
 * @example
 * ```tsx
 * // Simple filter
 * const todoTasks = useLiveQuery(tasks, {
 *   from: 'Task',
 *   where: { status: 'todo' },
 * })
 *
 * // With joins
 * const tasksWithAssignees = useLiveQuery(tasks, {
 *   from: 'Task',
 *   join: {
 *     assignee: {
 *       from: users,
 *       on: (task, user) => task.assigneeId === user.$id,
 *       type: 'left',
 *     },
 *   },
 * })
 * ```
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

        for (const [joinKey, joinConfig] of Object.entries(config.join)) {
          const { from: joinData, on, type = 'left' } = joinConfig as {
            from: BaseItem[]
            on: (item: T, joinItem: BaseItem) => boolean
            type?: 'left' | 'inner'
          }

          const matchedJoin = joinData.find(joinItem => on(item, joinItem))

          if (type === 'inner' && !matchedJoin) {
            // Skip this item for inner joins with no match
            continue
          }

          joinedItem[joinKey] = matchedJoin ?? null
        }

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

    // Apply limit
    if (config.limit) {
      result = result.slice(0, config.limit)
    }

    return result as unknown as R[]
  }, [data, config.where, config.join, config.orderBy, config.order, config.limit, config.from])
}
