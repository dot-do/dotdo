/**
 * @dotdo/tanstack/react - React bindings
 *
 * React hooks and components for TanStack DB integration.
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react'
import { z } from 'zod'
import type {
  SubscribeMessage,
  InitialMessage,
  ChangeMessage,
} from './protocol'

// =============================================================================
// Types
// =============================================================================

/**
 * Connection state enum representing WebSocket connection lifecycle
 */
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'error'

/**
 * Sync context value provided to consumers
 */
export interface SyncContextValue {
  /** Current connection state */
  connectionState: ConnectionState
  /** WebSocket URL for the Durable Object */
  doUrl: string
  /** Number of reconnection attempts since last successful connection */
  reconnectAttempts: number
  /** Timestamp of last successful sync, or null if never synced */
  lastSyncAt: Date | null
  /** Last error encountered, or null if none */
  lastError: Error | null
  /** Optional function to get authentication token */
  getAuthToken?: () => Promise<string>
}

/**
 * Options for useDotdoCollection hook
 */
export interface UseDotdoCollectionOptions<T> {
  /** Collection name (Noun type) */
  collection: string
  /** Zod schema for validating items */
  schema: z.ZodSchema<T>
  /** Optional branch for branched data */
  branch?: string
  /** Whether the hook is enabled (default: true) */
  enabled?: boolean
}

/**
 * Result returned by useDotdoCollection hook
 */
export interface UseDotdoCollectionResult<T> {
  /** Current collection data */
  data: T[]
  /** Whether initial sync is in progress */
  isLoading: boolean
  /** Error if sync failed */
  error?: Error
  /** Insert a new item (optimistic) */
  insert: (item: T) => Promise<void>
  /** Update an item by id (optimistic) */
  update: (id: string, data: Partial<T>) => Promise<void>
  /** Delete an item by id (optimistic) */
  delete: (id: string) => Promise<void>
  /** Find an item by $id */
  findById: (id: string) => T | undefined
  /** Filter items by predicate */
  filter: (predicate: (item: T) => boolean) => T[]
  /** Number of pending mutations */
  pendingMutations: number
  /** Last synced transaction id */
  lastTxid?: number
}

// =============================================================================
// Context
// =============================================================================

const SyncContext = createContext<SyncContextValue | null>(null)

SyncContext.displayName = 'SyncContext'

/**
 * Hook to access sync context
 * @throws Error if used outside of SyncProvider
 */
export function useSyncContext(): SyncContextValue {
  const context = useContext(SyncContext)
  if (!context) {
    throw new Error(
      'useSyncContext must be used within a SyncProvider. ' +
        'Wrap your component tree with <SyncProvider doUrl="...">...</SyncProvider>'
    )
  }
  return context
}

// =============================================================================
// SyncProvider
// =============================================================================

export interface SyncProviderProps {
  /** Children to render inside the provider */
  children: React.ReactNode
  /** WebSocket URL for the Durable Object */
  doUrl: string
  /** Optional function to get authentication token */
  getAuthToken?: () => Promise<string>
  /** Initial delay between reconnection attempts in ms (default: 1000) */
  reconnectDelay?: number
  /** Maximum delay between reconnection attempts in ms (default: 30000) */
  maxReconnectDelay?: number
}

/**
 * SyncProvider provides sync context to all descendant components.
 *
 * Note: WebSocket connections are managed by individual hooks like useDotdoCollection,
 * not by the provider. This allows fine-grained control over when connections are
 * established (e.g., based on the `enabled` option).
 */
export function SyncProvider({
  children,
  doUrl,
  getAuthToken,
}: SyncProviderProps): React.ReactElement {
  // Memoize context value to prevent unnecessary re-renders
  // Connection state management is delegated to individual hooks
  const contextValue = useMemo<SyncContextValue>(
    () => ({
      connectionState: 'connecting', // Placeholder - hooks manage actual state
      doUrl,
      reconnectAttempts: 0,
      lastSyncAt: null,
      lastError: null,
      getAuthToken,
    }),
    [doUrl, getAuthToken]
  )

  return <SyncContext.Provider value={contextValue}>{children}</SyncContext.Provider>
}

// Re-export the SyncContext for advanced use cases
export { SyncContext }

// =============================================================================
// Internal Types for Mutations
// =============================================================================

interface PendingMutation<T> {
  id: string
  type: 'insert' | 'update' | 'delete'
  item?: T
  previousItem?: T
  resolve: () => void
  reject: (error: Error) => void
}

// =============================================================================
// useDotdoCollection Hook
// =============================================================================

/**
 * React hook for managing a dotdo collection with real-time sync
 *
 * @example
 * ```typescript
 * const { data, insert, update, delete: remove } = useDotdoCollection({
 *   collection: 'Task',
 *   schema: TaskSchema,
 * })
 * ```
 */
export function useDotdoCollection<T extends { $id: string }>(
  options: UseDotdoCollectionOptions<T>
): UseDotdoCollectionResult<T> {
  const { collection, schema, branch, enabled = true } = options
  const { doUrl } = useSyncContext()

  // State
  const [data, setData] = useState<T[]>([])
  const [isLoading, setIsLoading] = useState(enabled)
  const [error, setError] = useState<Error | undefined>(undefined)
  const [lastTxid, setLastTxid] = useState<number | undefined>(undefined)
  const [pendingMutations, setPendingMutations] = useState(0)

  // Refs for stable access
  const wsRef = useRef<WebSocket | null>(null)
  const pendingRef = useRef<Map<string, PendingMutation<T>>>(new Map())
  const dataRef = useRef<T[]>([])

  // Keep dataRef in sync
  useEffect(() => {
    dataRef.current = data
  }, [data])

  // Helper to get base URL for RPC calls
  const getBaseUrl = useCallback(() => {
    // Convert wss:// to https:// and ws:// to http://
    let baseUrl = doUrl
    if (baseUrl.startsWith('wss://')) {
      baseUrl = 'https://' + baseUrl.slice(6)
    } else if (baseUrl.startsWith('ws://')) {
      baseUrl = 'http://' + baseUrl.slice(5)
    }
    // Remove trailing slash
    if (baseUrl.endsWith('/')) {
      baseUrl = baseUrl.slice(0, -1)
    }
    return baseUrl
  }, [doUrl])

  // RPC call helper
  const rpcCall = useCallback(
    async (method: string, body: unknown): Promise<{ rowid: number }> => {
      const baseUrl = getBaseUrl()
      const response = await fetch(`${baseUrl}/rpc/${collection}.${method}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`RPC ${method} failed: ${errorText}`)
      }

      return response.json()
    },
    [getBaseUrl, collection]
  )

  // WebSocket connection management
  useEffect(() => {
    if (!enabled) {
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(undefined)

    // Connect to the doUrl directly - the sync endpoint is part of the doUrl
    const ws = new WebSocket(doUrl)
    wsRef.current = ws

    ws.onopen = () => {
      // Send subscribe message
      const subscribeMsg: SubscribeMessage = {
        type: 'subscribe',
        collection,
      }

      if (branch !== undefined) {
        subscribeMsg.branch = branch
      }

      ws.send(JSON.stringify(subscribeMsg))
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as InitialMessage | ChangeMessage

        if (msg.type === 'initial') {
          // Handle initial data load
          if (msg.collection === collection) {
            setData(msg.data as T[])
            setIsLoading(false)
            setLastTxid(msg.txid)
          }
        } else {
          // Handle change messages
          if (msg.collection === collection) {
            switch (msg.type) {
              case 'insert':
                setData((prev) => {
                  // Check if already exists (from optimistic update)
                  const exists = prev.some((item) => item.$id === msg.key)
                  if (exists) {
                    // Update with server data
                    return prev.map((item) =>
                      item.$id === msg.key ? (msg.data as T) : item
                    )
                  }
                  return [...prev, msg.data as T]
                })
                break
              case 'update':
                setData((prev) =>
                  prev.map((item) =>
                    item.$id === msg.key ? (msg.data as T) : item
                  )
                )
                break
              case 'delete':
                setData((prev) => prev.filter((item) => item.$id !== msg.key))
                break
            }
            setLastTxid(msg.txid)
          }
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err)
      }
    }

    ws.onerror = (event) => {
      setError(new Error('WebSocket error'))
    }

    ws.onclose = (event) => {
      if (event.code !== 1000 && event.code !== 1005) {
        setError(new Error(event.reason || 'Connection closed'))
      }
    }

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close()
      }
      wsRef.current = null
    }
  }, [doUrl, collection, branch, enabled])

  // Insert mutation
  const insert = useCallback(
    async (item: T): Promise<void> => {
      // Optimistic insert
      setData((prev) => [...prev, item])
      setPendingMutations((prev) => prev + 1)

      try {
        await rpcCall('create', item)
        // Server will send confirmation via WebSocket
      } catch (err) {
        // Rollback on error
        setData((prev) => prev.filter((i) => i.$id !== item.$id))
        throw err
      } finally {
        setPendingMutations((prev) => prev - 1)
      }
    },
    [rpcCall]
  )

  // Update mutation
  const update = useCallback(
    async (id: string, updates: Partial<T>): Promise<void> => {
      const currentData = dataRef.current
      const existingItem = currentData.find((item) => item.$id === id)

      if (!existingItem) {
        throw new Error(`Item with id ${id} not found`)
      }

      // Optimistic update
      const updatedItem = { ...existingItem, ...updates } as T
      setData((prev) =>
        prev.map((item) => (item.$id === id ? updatedItem : item))
      )
      setPendingMutations((prev) => prev + 1)

      try {
        await rpcCall('update', { id, data: updates })
        // Server will send confirmation via WebSocket
      } catch (err) {
        // Rollback on error
        setData((prev) =>
          prev.map((item) => (item.$id === id ? existingItem : item))
        )
        throw err
      } finally {
        setPendingMutations((prev) => prev - 1)
      }
    },
    [rpcCall]
  )

  // Delete mutation
  const deleteItem = useCallback(
    async (id: string): Promise<void> => {
      const currentData = dataRef.current
      const existingItem = currentData.find((item) => item.$id === id)

      if (!existingItem) {
        throw new Error(`Item with id ${id} not found`)
      }

      // Optimistic delete
      setData((prev) => prev.filter((item) => item.$id !== id))
      setPendingMutations((prev) => prev + 1)

      try {
        await rpcCall('delete', { id })
        // Server will send confirmation via WebSocket
      } catch (err) {
        // Rollback on error - restore the item
        setData((prev) => [...prev, existingItem])
        throw err
      } finally {
        setPendingMutations((prev) => prev - 1)
      }
    },
    [rpcCall]
  )

  // Find by ID
  const findById = useCallback(
    (id: string): T | undefined => {
      return data.find((item) => item.$id === id)
    },
    [data]
  )

  // Filter
  const filter = useCallback(
    (predicate: (item: T) => boolean): T[] => {
      return data.filter(predicate)
    },
    [data]
  )

  // Memoize result to maintain stable reference when data hasn't changed
  return useMemo(
    () => ({
      data,
      isLoading,
      error,
      insert,
      update,
      delete: deleteItem,
      findById,
      filter,
      pendingMutations,
      lastTxid,
    }),
    [
      data,
      isLoading,
      error,
      insert,
      update,
      deleteItem,
      findById,
      filter,
      pendingMutations,
      lastTxid,
    ]
  )
}
