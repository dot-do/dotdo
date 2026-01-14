/**
 * Type definitions for @dotdo/tanstack React integration
 *
 * @module @dotdo/tanstack/react
 */

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
 * Configuration for useCollection hook
 */
export interface CollectionConfig<T> {
  /** Collection name (Noun type) */
  collection: string
  /** Zod schema for validation */
  schema: z.ZodSchema<T>
  /** Optional branch for branched data */
  branch?: string
}

/**
 * Result from useCollection hook
 */
export interface UseCollectionResult<T extends BaseItem> {
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

/** @deprecated Use CollectionConfig instead */
export type DotdoCollectionConfig<T> = CollectionConfig<T>

/** @deprecated Use UseCollectionResult instead */
export type UseDotdoCollectionResult<T extends BaseItem> = UseCollectionResult<T>

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
  | { type: 'initial'; collection: string; data: T[]; txid: number }
  | { type: 'insert'; collection: string; key: string; data: T; txid: number }
  | { type: 'update'; collection: string; key: string; data: T; txid: number }
  | { type: 'delete'; collection: string; key: string; txid: number }
