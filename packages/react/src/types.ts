/**
 * Shared types for @dotdo/react
 */

import type { DOClient, ClientConfig } from '@dotdo/client'

/**
 * Base item type with required $id field
 */
export interface BaseItem {
  $id: string
  [key: string]: unknown
}

/**
 * Sync message types from server
 */
export interface SyncMessage<T = unknown> {
  type: 'initial' | 'insert' | 'update' | 'delete'
  collection: string
  data?: T | T[]
  key?: string
  txid: number
}

/**
 * Context value provided by DO provider
 */
export interface DotdoContextValue {
  /** Namespace URL for the Durable Object */
  ns: string
  /** The underlying client instance */
  client: DOClient<unknown, unknown> | null
  /** WebSocket connections by collection */
  connections: Map<string, WebSocket>
  /** Get or create a connection for a collection */
  getConnection: (collection: string, branch?: string) => WebSocket | null
}

/**
 * Collection configuration
 */
export interface CollectionConfig<T> {
  /** Collection name (Noun type) */
  collection: string
  /** Optional branch for branched data */
  branch?: string
  /** Optional Zod schema for validation (requires zod peer dep) */
  schema?: unknown
}

/**
 * Return type for useDotdoCollection hook
 */
export interface UseDotdoCollectionResult<T extends BaseItem> {
  /** Current data in the collection */
  data: T[]
  /** Whether initial data is loading */
  isLoading: boolean
  /** Error if any */
  error: Error | null
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
  /** Refetch data */
  refetch: () => void
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
  /** Skip first N results */
  offset?: number
}

/**
 * Return type for useRecord hook
 */
export interface UseRecordResult<T extends BaseItem> {
  /** The record data */
  data: T | null
  /** Whether the record is loading */
  isLoading: boolean
  /** Error if any */
  error: Error | null
  /** Update the record */
  update: (changes: Partial<T>) => Promise<void>
  /** Delete the record */
  delete: () => Promise<void>
  /** Refetch the record */
  refetch: () => void
}
