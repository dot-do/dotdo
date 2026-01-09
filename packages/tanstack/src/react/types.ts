/**
 * Type definitions for the SyncProvider React integration
 */

/**
 * Connection state enum representing WebSocket connection lifecycle
 */
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'error'

/**
 * Context value exposed by SyncProvider
 */
export interface SyncContextValue {
  /** Current connection state */
  connectionState: ConnectionState
  /** The Durable Object WebSocket URL */
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
 * WebSocket factory type for dependency injection (testing)
 */
export type WebSocketFactory = (url: string) => WebSocket

/**
 * Options for useDotdoCollection hook
 */
export interface UseDotdoCollectionOptions<T> {
  /** Collection name (e.g., 'Task', 'User') */
  collection: string
  /** Zod schema for validation */
  schema: import('zod').ZodType<T>
  /** Optional filter function */
  filter?: (item: T) => boolean
  /** Whether the hook is enabled (default: true) */
  enabled?: boolean
}

/**
 * Result returned by useDotdoCollection hook
 */
export interface UseDotdoCollectionResult<T extends { $id: string }> {
  /** Array of items in the collection */
  data: T[]
  /** Whether initial load is in progress */
  isLoading: boolean
  /** Error from sync or mutations */
  error: Error | null
  /** Current transaction ID */
  txid: number
  /** Insert a new item (optimistic) */
  insert: (item: T) => Promise<void>
  /** Update an existing item (optimistic) */
  update: (id: string, data: Partial<T>) => Promise<void>
  /** Delete an item (optimistic) */
  delete: (id: string) => Promise<void>
  /** Find a single item by ID */
  findOne: (id: string) => T | undefined
  /** Find multiple items by IDs */
  findByIds: (ids: string[]) => T[]
  /** Trigger a refetch */
  refetch: () => void
}

/**
 * Props for the SyncProvider component
 */
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
  /** @internal WebSocket factory for testing */
  _wsFactory?: WebSocketFactory
}
