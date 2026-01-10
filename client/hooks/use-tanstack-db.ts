/**
 * useTanStackDb Hook
 *
 * React hook for TanStack DB with dotdo sync integration.
 *
 * Features:
 * - TanStack DB initialization with dotdo sync
 * - Database instance for queries
 * - Sync status (syncing, synced, offline)
 * - Connection state management
 * - Automatic reconnection handling
 * - Manual sync trigger
 * - Cleanup on unmount
 * - Singleton connection sharing across multiple hook instances
 * - SSR compatibility (no errors on server)
 *
 * @see client/tests/hooks/use-tanstack-db.test.tsx for tests
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createDb } from '@tanstack/db'
import { createSyncEngine } from '@dotdo/tanstack/sync'

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration options for useTanStackDb
 */
export interface UseTanStackDbConfig {
  /** The endpoint URL for the dotdo sync server */
  endpoint?: string
  /** Authentication token for sync */
  token?: string
  /** Whether to auto-connect on mount (default: true) */
  autoConnect?: boolean
  /** Reconnection delay in ms (default: 1000) */
  reconnectDelay?: number
  /** Maximum reconnection attempts (default: 5) */
  maxReconnectAttempts?: number
}

/**
 * Sync status values
 */
export type SyncStatus = 'syncing' | 'synced' | 'offline'

/**
 * Connection state values
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

/**
 * Database instance type
 */
export interface DbInstance {
  query: (...args: unknown[]) => unknown
  exec: (...args: unknown[]) => unknown
  transaction: (...args: unknown[]) => unknown
  close: () => void
}

/**
 * Sync engine instance type
 */
interface SyncEngine {
  connect: () => Promise<void>
  disconnect: () => void
  sync: () => Promise<void>
  onStatusChange: (callback: (status: SyncStatus) => void) => () => void
  getStatus: () => SyncStatus
}

/**
 * Return value of useTanStackDb
 */
export interface UseTanStackDbResult {
  /** Database instance for queries, null on server */
  db: DbInstance | null
  /** Current sync status */
  syncStatus: SyncStatus
  /** Current connection state */
  connectionState: ConnectionState
  /** Whether connected */
  isConnected: boolean
  /** Whether syncing */
  isSyncing: boolean
  /** Error if any */
  error: Error | null
  /** Trigger manual sync */
  sync: () => Promise<void>
}

// =============================================================================
// Singleton Connection Manager
// =============================================================================

interface ConnectionInstance {
  db: DbInstance
  syncEngine: SyncEngine
  refCount: number
  isConnected: boolean
  isConnecting: boolean
  connectionPromise: Promise<void> | null
  reconnectAttempts: number
  maxReconnectAttempts: number
  reconnectDelay: number
  listeners: Set<(state: { syncStatus: SyncStatus; connectionState: ConnectionState }) => void>
  statusUnsubscribe: (() => void) | null
  reconnectTimeout: ReturnType<typeof setTimeout> | null
}

// Global connection cache keyed by endpoint
const connectionCache = new Map<string, ConnectionInstance>()

// Export for testing purposes - allows clearing between tests
export function __clearConnectionCache(): void {
  connectionCache.forEach((instance) => {
    if (instance.reconnectTimeout) {
      clearTimeout(instance.reconnectTimeout)
    }
    if (instance.statusUnsubscribe) {
      instance.statusUnsubscribe()
    }
  })
  connectionCache.clear()
}

function getConnectionKey(config: UseTanStackDbConfig): string {
  return config.endpoint || 'default'
}

function getOrCreateConnection(config: UseTanStackDbConfig): ConnectionInstance {
  const key = getConnectionKey(config)

  let instance = connectionCache.get(key)
  if (instance) {
    instance.refCount++
    return instance
  }

  // Create new connection
  const db = createDb() as DbInstance
  const syncEngine = createSyncEngine() as SyncEngine

  instance = {
    db,
    syncEngine,
    refCount: 1,
    isConnected: false,
    isConnecting: false,
    connectionPromise: null,
    reconnectAttempts: 0,
    maxReconnectAttempts: config.maxReconnectAttempts ?? 5,
    reconnectDelay: config.reconnectDelay ?? 1000,
    listeners: new Set(),
    statusUnsubscribe: null,
    reconnectTimeout: null,
  }

  // Set up status change listener immediately
  instance.statusUnsubscribe = syncEngine.onStatusChange((status: SyncStatus) => {
    instance!.listeners.forEach((listener) => {
      listener({
        syncStatus: status,
        connectionState: instance!.isConnected ? 'connected' : 'disconnected',
      })
    })
  })

  connectionCache.set(key, instance)
  return instance
}

function releaseConnection(key: string): void {
  const instance = connectionCache.get(key)

  if (instance) {
    instance.refCount--
    if (instance.refCount === 0) {
      // Last reference, cleanup
      if (instance.reconnectTimeout) {
        clearTimeout(instance.reconnectTimeout)
      }
      if (instance.statusUnsubscribe) {
        instance.statusUnsubscribe()
      }
      instance.syncEngine.disconnect()
      instance.db.close()
      connectionCache.delete(key)
    }
  }
}

// =============================================================================
// SSR Detection
// =============================================================================

/**
 * Check if running in browser environment
 * Evaluated at runtime to handle dynamic window deletion in tests
 */
function isBrowser(): boolean {
  return typeof window !== 'undefined'
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * React hook for TanStack DB with dotdo sync
 */
export function useTanStackDb(config: UseTanStackDbConfig = {}): UseTanStackDbResult {
  const {
    autoConnect = true,
    reconnectDelay = 1000,
    maxReconnectAttempts = 5,
  } = config

  // Memoize the connection key for stable dependencies
  const connectionKey = useMemo(() => getConnectionKey(config), [config.endpoint])

  // Check browser at render time (not module load time) for SSR test compatibility
  const browserCheck = isBrowser()

  // State
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('offline')
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected')
  const [error, setError] = useState<Error | null>(null)
  const [dbInstance, setDbInstance] = useState<DbInstance | null>(null)

  // Refs for connection management
  const connectionRef = useRef<ConnectionInstance | null>(null)
  const mountedRef = useRef(true)

  // Connect function - shared across all hook instances for this connection
  const performConnect = useCallback(async (instance: ConnectionInstance, isReconnect: boolean = false): Promise<void> => {
    // Don't connect if already connected
    if (instance.isConnected) return

    // If already connecting, wait for it
    if (instance.connectionPromise) {
      await instance.connectionPromise
      return
    }

    instance.isConnecting = true

    // Notify all listeners of state change
    const notifyState = (state: ConnectionState) => {
      instance.listeners.forEach((listener) => {
        listener({ syncStatus: instance.syncEngine.getStatus(), connectionState: state })
      })
    }

    notifyState(isReconnect ? 'reconnecting' : 'connecting')

    const connectionPromise = (async () => {
      try {
        await instance.syncEngine.connect()

        instance.isConnected = true
        instance.isConnecting = false
        instance.reconnectAttempts = 0
        instance.connectionPromise = null

        notifyState('connected')
      } catch (err) {
        instance.isConnecting = false
        instance.connectionPromise = null
        instance.reconnectAttempts++

        const shouldRetry = instance.reconnectAttempts < instance.maxReconnectAttempts

        // Notify about state change
        instance.listeners.forEach((listener) => {
          listener({
            syncStatus: 'offline',
            connectionState: shouldRetry ? 'reconnecting' : 'disconnected',
          })
        })

        if (shouldRetry && instance.refCount > 0) {
          // Schedule reconnection - but don't throw here
          instance.reconnectTimeout = setTimeout(() => {
            if (instance.refCount > 0) {
              performConnect(instance, true).catch(() => {
                // Errors handled inside performConnect
              })
            }
          }, instance.reconnectDelay)
        }

        throw err
      }
    })()

    instance.connectionPromise = connectionPromise
    await connectionPromise
  }, [])

  // Manual sync function
  const sync = useCallback(async () => {
    if (!browserCheck) return
    if (!connectionRef.current) return

    const instance = connectionRef.current
    await instance.syncEngine.sync()
  }, [browserCheck])

  // Memoize config values for stable dependencies
  const configEndpoint = config.endpoint
  const configToken = config.token

  // Initialize connection
  useEffect(() => {
    if (!browserCheck) return

    mountedRef.current = true

    // Get or create shared connection
    const instance = getOrCreateConnection({
      endpoint: configEndpoint,
      token: configToken,
      reconnectDelay,
      maxReconnectAttempts,
    })
    connectionRef.current = instance
    setDbInstance(instance.db)

    // Register listener for state changes
    const listener = (state: { syncStatus: SyncStatus; connectionState: ConnectionState }) => {
      if (mountedRef.current) {
        setSyncStatus(state.syncStatus)
        setConnectionState(state.connectionState)
      }
    }
    instance.listeners.add(listener)

    // Set initial states from instance
    setSyncStatus(instance.syncEngine.getStatus())
    if (instance.isConnected) {
      setConnectionState('connected')
    } else if (instance.isConnecting) {
      setConnectionState(instance.reconnectAttempts > 0 ? 'reconnecting' : 'connecting')
    } else {
      setConnectionState('disconnected')
    }

    // Auto-connect if enabled and not already connected/connecting
    if (autoConnect && !instance.isConnected && !instance.connectionPromise) {
      performConnect(instance, false).catch((err) => {
        if (mountedRef.current) {
          setError(err instanceof Error ? err : new Error(String(err)))
        }
      })
    } else if (autoConnect && instance.connectionPromise) {
      // Wait for existing connection
      instance.connectionPromise.catch((err) => {
        if (mountedRef.current) {
          setError(err instanceof Error ? err : new Error(String(err)))
        }
      })
    }

    // Cleanup on unmount
    return () => {
      mountedRef.current = false

      // Remove listener
      instance.listeners.delete(listener)

      // Release the connection reference
      releaseConnection(connectionKey)
      connectionRef.current = null
    }
  }, [connectionKey, autoConnect, performConnect, browserCheck, reconnectDelay, maxReconnectAttempts, configEndpoint, configToken])

  // For SSR, return safe defaults
  if (!browserCheck) {
    return {
      db: null,
      syncStatus: 'offline',
      connectionState: 'disconnected',
      isConnected: false,
      isSyncing: false,
      error: null,
      sync: async () => {},
    }
  }

  return {
    db: dbInstance,
    syncStatus,
    connectionState,
    isConnected: connectionState === 'connected',
    isSyncing: syncStatus === 'syncing',
    error,
    sync,
  }
}
