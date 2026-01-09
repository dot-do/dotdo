/**
 * Collection Client
 *
 * Client-side collection management for TanStack DB.
 * Provides WebSocket subscription and mutation handlers.
 */

import { z } from 'zod'
import type {
  SubscribeMessage,
  UnsubscribeMessage,
  InitialMessage,
  ChangeMessage,
} from '../protocol'

// =============================================================================
// Types
// =============================================================================

/**
 * Callbacks used by TanStack DB collection for sync operations
 */
export interface CollectionCallbacks<T = unknown> {
  begin: () => void
  onData: (items: T[]) => void
  onInsert: (item: T) => void
  onUpdate: (item: T) => void
  onDelete: (item: { id: string }) => void
  commit: (info: { txid: number }) => void
}

/**
 * Configuration for dotdo collection
 */
export interface DotdoCollectionConfig<T> {
  /** WebSocket URL for the Durable Object (will append /sync) */
  doUrl: string
  /** Collection name (Noun type) */
  collection: string
  /** Optional branch for branched data */
  branch?: string
  /** Zod schema for validating items */
  schema: z.ZodSchema<T>
  /** Optional fetch options for RPC calls */
  fetchOptions?: RequestInit
  /** Optional transaction timeout in ms (default: 30000) */
  transactionTimeout?: number
}

/**
 * Options returned by dotdoCollectionOptions for TanStack DB
 */
export interface DotdoCollectionOptions<T> {
  id: string
  schema: z.ZodSchema<T>
  getKey: (item: T) => string
  subscribe: (callbacks: CollectionCallbacks<T>) => () => void
  onInsert?: (params: { transaction: { changes: T } }) => Promise<{ txid: number }>
  onUpdate?: (params: { id: string; data: Partial<T> }) => Promise<{ txid: number }>
  onDelete?: (params: { id: string }) => Promise<{ txid: number }>
}

// =============================================================================
// Constants
// =============================================================================

const MAX_RECONNECT_DELAY = 30000 // 30 seconds
const INITIAL_RECONNECT_DELAY = 1000 // 1 second

// =============================================================================
// Implementation
// =============================================================================

/**
 * Create collection options for TanStack DB with dotdo sync
 *
 * @example
 * ```typescript
 * const taskOptions = dotdoCollectionOptions({
 *   doUrl: 'wss://my-do.workers.dev/do/123',
 *   collection: 'Task',
 *   schema: TaskSchema,
 * })
 *
 * // Use with TanStack DB
 * const collection = useCollection(taskOptions)
 * ```
 */
export function dotdoCollectionOptions<T extends { $id: string }>(
  config: DotdoCollectionConfig<T>
): DotdoCollectionOptions<T> {
  // Helper to make RPC calls
  const rpcCall = async (method: string, body: unknown): Promise<{ rowid: number }> => {
    // Normalize URL - remove trailing slash if present
    const baseUrl = config.doUrl.endsWith('/')
      ? config.doUrl.slice(0, -1)
      : config.doUrl

    // Extract headers from fetchOptions to merge properly
    const { headers: customHeaders, ...restFetchOptions } = config.fetchOptions || {}

    const response = await fetch(
      `${baseUrl}/rpc/${config.collection}.${method}`,
      {
        method: 'POST',
        body: JSON.stringify(body),
        ...restFetchOptions,
        // Headers must be merged after spread to preserve both custom and required headers
        headers: {
          'Content-Type': 'application/json',
          ...(customHeaders as Record<string, string> || {}),
        },
      }
    )

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`RPC ${method} failed: ${error}`)
    }

    return response.json()
  }

  return {
    id: `dotdo:${config.collection}`,
    schema: config.schema,
    getKey: (item: T) => item.$id,

    subscribe: (callbacks: CollectionCallbacks<T>) => {
      let ws: WebSocket | null = null
      let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
      let reconnectAttempts = 0
      let isUnsubscribed = false

      const connect = () => {
        if (isUnsubscribed) return

        ws = new WebSocket(`${config.doUrl}/sync`)

        ws.onopen = () => {
          // Reset reconnect attempts on successful connection
          reconnectAttempts = 0

          // Send subscribe message
          const subscribeMsg: SubscribeMessage = {
            type: 'subscribe',
            collection: config.collection,
          }

          // Only include branch if specified
          if (config.branch !== undefined) {
            subscribeMsg.branch = config.branch
          }

          ws!.send(JSON.stringify(subscribeMsg))
        }

        ws.onmessage = (event) => {
          const msg = JSON.parse(event.data) as InitialMessage | ChangeMessage

          callbacks.begin()

          if (msg.type === 'initial') {
            // Handle initial data load - use 'data' field per new protocol
            callbacks.onData(msg.data as T[])
            callbacks.commit({ txid: msg.txid })
          } else {
            // Handle change messages - type is 'insert' | 'update' | 'delete'
            switch (msg.type) {
              case 'insert':
                callbacks.onInsert(msg.data as T)
                break
              case 'update':
                callbacks.onUpdate(msg.data as T)
                break
              case 'delete':
                // Delete uses 'key' field per new protocol
                callbacks.onDelete({ id: msg.key })
                break
            }
            callbacks.commit({ txid: msg.txid })
          }
        }

        ws.onclose = () => {
          if (isUnsubscribed) return

          // Calculate delay with exponential backoff, capped at MAX_RECONNECT_DELAY
          const delay = Math.min(
            INITIAL_RECONNECT_DELAY * Math.pow(2, reconnectAttempts),
            MAX_RECONNECT_DELAY
          )
          reconnectAttempts++

          reconnectTimeout = setTimeout(connect, delay)
        }

        ws.onerror = () => {
          // Error handling - connection will close and trigger reconnect
        }
      }

      // Start initial connection
      connect()

      // Return unsubscribe function
      return () => {
        if (isUnsubscribed) return
        isUnsubscribed = true

        // Cancel any pending reconnection
        if (reconnectTimeout) {
          clearTimeout(reconnectTimeout)
          reconnectTimeout = null
        }

        // Send unsubscribe message and close socket
        // Use numeric value 1 for OPEN to support both browser and mock WebSocket
        if (ws && ws.readyState === 1) {
          const unsubscribeMsg: UnsubscribeMessage = {
            type: 'unsubscribe',
            collection: config.collection,
          }
          ws.send(JSON.stringify(unsubscribeMsg))
          ws.close()
        }

        ws = null
      }
    },

    // Mutation handlers
    onInsert: async ({ transaction }: { transaction: { changes: T } }) => {
      const result = await rpcCall('create', transaction.changes)
      return { txid: result.rowid }
    },

    onUpdate: async ({ id, data }: { id: string; data: Partial<T> }) => {
      const result = await rpcCall('update', { id, data })
      return { txid: result.rowid }
    },

    onDelete: async ({ id }: { id: string }) => {
      const result = await rpcCall('delete', { id })
      return { txid: result.rowid }
    },
  }
}
