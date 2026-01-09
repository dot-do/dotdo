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
}
