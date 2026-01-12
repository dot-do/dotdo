/**
 * Shared types for @dotdo/react
 *
 * @module @dotdo/react
 */

import type { RpcClient, ConnectionState } from '@dotdo/client'

/**
 * Connection state features that may be available on some client implementations.
 * These methods allow monitoring and managing the connection lifecycle.
 */
export interface ConnectionStateFeatures {
  /** Current connection state (optional - may not be available on all implementations) */
  connectionState?: ConnectionState
  /** Register a connection state change listener */
  on?(event: 'connectionStateChange', handler: (state: ConnectionState) => void): void
  /** Remove a connection state change listener */
  off?(event: 'connectionStateChange', handler: (state: ConnectionState) => void): void
  /** Disconnect the client */
  disconnect?(): void
}

/**
 * Extended client interface for React bindings.
 *
 * This combines RpcClient with optional connection state management methods
 * that may be available on some client implementations.
 */
export type ReactDotdoClient = RpcClient & ConnectionStateFeatures

// Re-export for backwards compatibility
export type { ConnectionState } from '@dotdo/client'

/**
 * Base item type with required $id field.
 *
 * All items in a dotdo collection must have a unique $id field.
 *
 * @example
 * ```typescript
 * interface Task extends BaseItem {
 *   $id: string
 *   title: string
 *   status: 'todo' | 'done'
 * }
 * ```
 */
export interface BaseItem {
  /** Unique identifier for the item */
  $id: string
  /** Additional properties */
  [key: string]: unknown
}

/**
 * Sync message types from server.
 *
 * These messages are sent over WebSocket to synchronize collection state.
 */
export interface SyncMessage<T = unknown> {
  /** Message type */
  type: 'initial' | 'insert' | 'update' | 'delete'
  /** Collection name */
  collection: string
  /** Item data (single item or array for initial) */
  data?: T | T[]
  /** Item key (for update/delete) */
  key?: string
  /** Transaction ID for ordering */
  txid: number
}

/**
 * Context value provided by DO provider.
 *
 * Contains the client instance and connection management.
 */
export interface DotdoContextValue {
  /** Namespace URL for the Durable Object */
  ns: string
  /** The underlying client instance */
  client: ReactDotdoClient | null
  /** WebSocket connections by collection key */
  connections: Map<string, WebSocket>
  /** Get an existing connection for a collection */
  getConnection: (collection: string, branch?: string) => WebSocket | null
}

/**
 * Collection configuration for hooks.
 *
 * @typeParam T - The item type for the collection
 */
export interface CollectionConfig<T> {
  /** Collection name (Noun type, e.g., 'Task', 'User') */
  collection: string
  /** Optional branch for branched data */
  branch?: string
  /** Optional Zod schema for validation (requires zod peer dep) */
  schema?: unknown
}

/**
 * Return type for useCollection hook.
 *
 * Provides reactive data and mutation methods for a collection.
 *
 * @typeParam T - The item type extending BaseItem
 */
export interface UseDotdoCollectionResult<T extends BaseItem> {
  /** Current data in the collection */
  data: T[]
  /** Whether initial data is loading */
  isLoading: boolean
  /** Error if connection or mutation failed */
  error: Error | null
  /** Current transaction ID (increases with each change) */
  txid: number
  /** Number of pending optimistic mutations */
  pendingMutations: number
  /** Insert a new item with optimistic update */
  insert: (item: T) => Promise<void>
  /** Update an existing item with optimistic update */
  update: (id: string, changes: Partial<T>) => Promise<void>
  /** Delete an item with optimistic update */
  delete: (id: string) => Promise<void>
  /** Force refetch by reconnecting */
  refetch: () => void
}

/**
 * Query configuration for useLiveQuery.
 *
 * Defines filtering, joining, ordering, and pagination for live queries.
 *
 * @typeParam T - The source item type
 * @typeParam U - The join item type (defaults to unknown)
 *
 * @remarks
 * For optimal performance, memoize this config object with useMemo
 * to prevent unnecessary re-computations.
 */
export interface LiveQueryConfig<T, U = unknown> {
  /** Collection name (for type reference in joins) */
  from: string
  /** Filter conditions - object for equality, function for custom */
  where?: Partial<T> | ((item: T) => boolean)
  /** Join configuration for related data */
  join?: {
    [key: string]: {
      /** Source data for the join */
      from: U[]
      /** Join condition function */
      on: (item: T, joinItem: U) => boolean
      /** Join type: 'left' (default) or 'inner' */
      type?: 'left' | 'inner'
    }
  }
  /** Field to order by, or custom comparator */
  orderBy?: keyof T | ((a: T, b: T) => number)
  /** Order direction (default: 'asc') */
  order?: 'asc' | 'desc'
  /** Maximum number of results */
  limit?: number
  /** Skip first N results */
  offset?: number
}

/**
 * Return type for useRecord hook.
 *
 * Provides a single record with mutation methods.
 *
 * @typeParam T - The item type extending BaseItem
 */
export interface UseRecordResult<T extends BaseItem> {
  /** The record data, or null if not found/loading */
  data: T | null
  /** Whether the record is loading */
  isLoading: boolean
  /** Error if connection or mutation failed */
  error: Error | null
  /** Update the record with optimistic update */
  update: (changes: Partial<T>) => Promise<void>
  /** Delete the record with optimistic update */
  delete: () => Promise<void>
  /** Force refetch by reconnecting */
  refetch: () => void
}
