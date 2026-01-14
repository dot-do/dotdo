/**
 * Type definitions for @dotdo/tanstack React integration
 *
 * @module @dotdo/tanstack/react
 */

import type * as React from 'react'
import type { z } from 'zod'

/**
 * Connection state for the sync provider
 */
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'error'

/**
 * Context value provided by SyncProvider
 */
export interface SyncContextValue {
  /** The Durable Object URL */
  doUrl: string
  /** Optional function to get auth token */
  getAuthToken?: () => string | null
  /** Current connection state */
  connectionState: ConnectionState
  /** Number of reconnection attempts */
  reconnectAttempts: number
  /** Timestamp of last successful sync */
  lastSyncAt: Date | null
  /** Internal: WebSocket instance for sharing across hooks */
  _ws: WebSocket | null
  /** Internal: Set connection state */
  _setConnectionState: (state: ConnectionState) => void
  /** Internal: Set reconnect attempts */
  _setReconnectAttempts: (attempts: number) => void
  /** Internal: Set last sync timestamp */
  _setLastSyncAt: (date: Date | null) => void
}

/**
 * Props for SyncProvider component
 */
export interface SyncProviderProps {
  /** WebSocket URL for the Durable Object */
  doUrl: string
  /** Optional function to get auth token for authenticated requests */
  getAuthToken?: () => string | null
  /** Child components */
  children: React.ReactNode
}

/**
 * Base interface for items with $id
 */
export interface BaseItem {
  $id: string
}

/**
 * Configuration for useDotdoCollection hook
 */
export interface DotdoCollectionConfig<T> {
  /** Collection name (Noun type) */
  collection: string
  /** Zod schema for validation */
  schema: z.ZodSchema<T>
  /** Optional branch for branched data */
  branch?: string
}

/**
 * Result from useDotdoCollection hook
 */
export interface UseDotdoCollectionResult<T extends BaseItem> {
  /** Current data array */
  data: T[]
  /** Whether initial data is loading */
  isLoading: boolean
  /** Insert a new item (optimistic) */
  insert: (item: T) => Promise<void>
  /** Update an existing item (optimistic) */
  update: (id: string, changes: Partial<T>) => Promise<void>
  /** Delete an item (optimistic) */
  delete: (id: string) => Promise<void>
  /** Find an item by $id */
  findById: (id: string) => T | undefined
}

/**
 * Result from useConnectionState hook
 */
export interface UseConnectionStateResult {
  /** Current connection status */
  status: ConnectionState
  /** Number of reconnection attempts */
  reconnectAttempts: number
  /** Timestamp of last successful sync */
  lastSyncAt: Date | null
}

/**
 * Sync message types from server
 */
export type SyncMessage<T> =
  | {
      type: 'initial'
      collection: string
      data: T[]
      txid: number
    }
  | {
      type: 'insert'
      collection: string
      key: string
      data: T
      txid: number
    }
  | {
      type: 'update'
      collection: string
      key: string
      data: T
      txid: number
    }
  | {
      type: 'delete'
      collection: string
      key: string
      txid: number
    }

/**
 * Options for useDotdoQuery hook
 */
export interface UseDotdoQueryOptions<T> {
  /** Collection name */
  collection: string
  /** Optional item ID for single-item queries */
  id?: string
  /** Optional branch */
  branch?: string
  /** Enable/disable the query */
  enabled?: boolean
  /** Stale time in milliseconds */
  staleTime?: number
  /** Cache time in milliseconds */
  cacheTime?: number
  /** Zod schema for validation */
  schema?: import('zod').ZodSchema<T>
}

/**
 * Result from useDotdoQuery hook
 */
export interface UseDotdoQueryResult<T> {
  data: T | T[] | undefined
  isLoading: boolean
  isError: boolean
  error: Error | null
  refetch: () => Promise<void>
  isFetching: boolean
}

/**
 * Options for useDotdoMutation hook
 */
export interface UseDotdoMutationOptions<T extends BaseItem, TVariables> {
  /** Collection name */
  collection: string
  /** Mutation type */
  mutationType: 'insert' | 'update' | 'delete'
  /** Optional branch */
  branch?: string
  /** Optimistic update function */
  onMutate?: (variables: TVariables) => T | void
  /** Success callback */
  onSuccess?: (data: T, variables: TVariables) => void
  /** Error callback with rollback data */
  onError?: (error: Error, variables: TVariables, rollbackData?: T) => void
  /** Settlement callback */
  onSettled?: (data: T | undefined, error: Error | null, variables: TVariables) => void
}

/**
 * Result from useDotdoMutation hook
 */
export interface UseDotdoMutationResult<T, TVariables> {
  mutate: (variables: TVariables) => void
  mutateAsync: (variables: TVariables) => Promise<T>
  isLoading: boolean
  isError: boolean
  isSuccess: boolean
  error: Error | null
  data: T | undefined
  reset: () => void
}
