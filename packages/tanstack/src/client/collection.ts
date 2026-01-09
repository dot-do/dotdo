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
  SyncThing,
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
            // Handle initial data load
            callbacks.onData(msg.items as T[])
            callbacks.commit({ txid: msg.txid })
          } else if (msg.type === 'change') {
            // Handle change stream
            switch (msg.operation) {
              case 'insert':
                callbacks.onInsert(msg.thing as T)
                break
              case 'update':
                callbacks.onUpdate(msg.thing as T)
                break
              case 'delete':
                callbacks.onDelete({ id: msg.id! })
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
        if (ws && ws.readyState === WebSocket.OPEN) {
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

    // Mutation handlers will be added in the next task
    onInsert: undefined,
    onUpdate: undefined,
    onDelete: undefined,
  }
}
