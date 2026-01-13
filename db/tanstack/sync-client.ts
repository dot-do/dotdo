/**
 * SyncClient - WebSocket subscription manager for TanStack DB sync
 *
 * Manages WebSocket connections for real-time data synchronization:
 * - Connect to DO /sync endpoint
 * - Subscribe/unsubscribe to collections
 * - Handle initial data and change streams
 * - Automatic reconnection with exponential backoff
 * - Error reporting via callbacks
 *
 * @module db/tanstack/sync-client
 */

import type {
  SyncItem,
  SubscribeMessage,
  UnsubscribeMessage,
  InitialMessage,
  ChangeMessage,
  ServerMessage,
} from './protocol'

// =============================================================================
// Constants
// =============================================================================

/** Base delay for reconnection in milliseconds */
const RECONNECT_BASE_DELAY_MS = 1000

/** Maximum delay for reconnection in milliseconds */
const RECONNECT_MAX_DELAY_MS = 30000

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for SyncClient
 */
export interface SyncClientConfig {
  /** WebSocket URL for the Durable Object (will append /sync if not already present) */
  url: string
  /** Optional branch for branched data */
  branch?: string | null
}

/**
 * Connection status for SyncClient
 */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

/**
 * SyncClient interface for type-safe client operations
 */
export interface SyncClientInterface<T = SyncItem> {
  /**
   * Connect to the sync endpoint
   */
  connect(): Promise<void>

  /**
   * Disconnect from the sync endpoint
   */
  disconnect(): void

  /**
   * Get current connection status
   */
  getStatus(): ConnectionStatus

  /**
   * Subscribe to a collection
   */
  subscribe(collection: string, branch?: string | null): void

  /**
   * Unsubscribe from a collection
   */
  unsubscribe(collection: string): void

  /**
   * Register callback for initial state
   */
  onInitial(collection: string, callback: (items: T[], txid: number) => void): () => void

  /**
   * Register callback for changes
   */
  onChange(collection: string, callback: (change: ChangeMessage<T>) => void): () => void

  /**
   * Register callback for all sync events
   */
  onSync(callback: (change: ChangeMessage<T>) => void): () => void

  /**
   * Register callback for disconnection
   */
  onDisconnect(callback: () => void): () => void

  /**
   * Register callback for errors
   */
  onError(callback: (error: Error) => void): () => void

  /**
   * Register callback for status changes
   */
  onStatusChange(callback: (status: ConnectionStatus) => void): () => void
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Create a new SyncClient instance
 *
 * @example
 * ```typescript
 * const client = createSyncClient({ url: 'wss://my-do.workers.dev/sync' })
 *
 * client.onInitial('Task', (items, txid) => {
 *   console.log('Got initial tasks:', items.length)
 * })
 *
 * client.onChange('Task', (change) => {
 *   console.log('Task changed:', change.type, change.key)
 * })
 *
 * await client.connect()
 * client.subscribe('Task')
 * ```
 */
export function createSyncClient<T = SyncItem>(config: SyncClientConfig): SyncClientInterface<T> {
  let socket: WebSocket | null = null
  let status: ConnectionStatus = 'disconnected'
  let intentionalDisconnect = false
  let reconnectAttempts = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  // Callback registrations
  const initialCallbacks = new Map<string, Set<(items: T[], txid: number) => void>>()
  const changeCallbacks = new Map<string, Set<(change: ChangeMessage<T>) => void>>()
  const syncCallbacks = new Set<(change: ChangeMessage<T>) => void>()
  const disconnectCallbacks = new Set<() => void>()
  const errorCallbacks = new Set<(error: Error) => void>()
  const statusChangeCallbacks = new Set<(status: ConnectionStatus) => void>()

  // Connection promise tracking
  let connectResolve: (() => void) | null = null
  let connectReject: ((error: Error) => void) | null = null

  // Pending subscriptions to send on reconnect
  const pendingSubscriptions = new Set<{ collection: string; branch: string | null }>()

  function setStatus(newStatus: ConnectionStatus): void {
    if (status !== newStatus) {
      status = newStatus
      for (const callback of statusChangeCallbacks) {
        callback(newStatus)
      }
    }
  }

  function emitError(error: Error): void {
    for (const callback of errorCallbacks) {
      callback(error)
    }
  }

  function handleMessage(event: MessageEvent): void {
    try {
      const data = typeof event.data === 'string' ? event.data : ''
      const message = JSON.parse(data) as ServerMessage<T>

      if (message.type === 'initial') {
        const callbacks = initialCallbacks.get(message.collection)
        if (callbacks) {
          for (const cb of callbacks) {
            cb(message.data, message.txid)
          }
        }
      } else {
        // Change message (insert, update, delete)
        const change = message as ChangeMessage<T>
        const callbacks = changeCallbacks.get(change.collection)
        if (callbacks) {
          for (const cb of callbacks) {
            cb(change)
          }
        }
        // Also notify sync callbacks
        for (const cb of syncCallbacks) {
          cb(change)
        }
      }
    } catch {
      // Invalid JSON - silently ignore
    }
  }

  function scheduleReconnect(): void {
    if (intentionalDisconnect) return

    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttempts),
      RECONNECT_MAX_DELAY_MS
    )
    reconnectAttempts++

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      // Don't await - fire and forget
      client.connect().catch(() => {
        // Will trigger another reconnect via close handler
      })
    }, delay)
  }

  function resubscribeAll(): void {
    for (const sub of pendingSubscriptions) {
      const message: SubscribeMessage = {
        type: 'subscribe',
        collection: sub.collection,
        branch: sub.branch,
      }
      socket?.send(JSON.stringify(message))
    }
  }

  const client: SyncClientInterface<T> = {
    connect(): Promise<void> {
      return new Promise((resolve, reject) => {
        if (socket && socket.readyState === WebSocket.OPEN) {
          resolve()
          return
        }

        connectResolve = resolve
        connectReject = reject
        intentionalDisconnect = false
        setStatus('connecting')

        // Build WebSocket URL
        let wsUrl = config.url
        if (!wsUrl.endsWith('/sync')) {
          wsUrl = wsUrl.replace(/\/$/, '') + '/sync'
        }

        try {
          socket = new WebSocket(wsUrl)
        } catch (error) {
          const err = error instanceof Error ? error : new Error('Failed to create WebSocket')
          emitError(err)
          setStatus('disconnected')
          connectReject?.(err)
          connectResolve = null
          connectReject = null
          return
        }

        socket.addEventListener('open', () => {
          reconnectAttempts = 0
          setStatus('connected')
          connectResolve?.()
          connectResolve = null
          connectReject = null

          // Re-subscribe to all pending subscriptions
          resubscribeAll()
        })

        socket.addEventListener('error', () => {
          const error = new Error('WebSocket connection error')
          emitError(error)
          // connectReject is handled in close handler
        })

        socket.addEventListener('close', () => {
          socket = null

          // Notify disconnect callbacks
          for (const cb of disconnectCallbacks) {
            cb()
          }

          // Reject pending connect promise if any
          if (connectReject) {
            connectReject(new Error('WebSocket connection closed'))
            connectResolve = null
            connectReject = null
          }

          if (!intentionalDisconnect) {
            setStatus('reconnecting')
            scheduleReconnect()
          } else {
            setStatus('disconnected')
          }
        })

        socket.addEventListener('message', handleMessage)
      })
    },

    disconnect(): void {
      intentionalDisconnect = true

      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }

      if (socket) {
        // Send unsubscribe for all pending subscriptions
        for (const sub of pendingSubscriptions) {
          if (socket.readyState === WebSocket.OPEN) {
            const message: UnsubscribeMessage = {
              type: 'unsubscribe',
              collection: sub.collection,
            }
            socket.send(JSON.stringify(message))
          }
        }

        socket.close()
        socket = null
      }

      setStatus('disconnected')
    },

    getStatus(): ConnectionStatus {
      return status
    },

    subscribe(collection: string, branch?: string | null): void {
      const effectiveBranch = branch ?? config.branch ?? null
      pendingSubscriptions.add({ collection, branch: effectiveBranch })

      if (socket && socket.readyState === WebSocket.OPEN) {
        const message: SubscribeMessage = {
          type: 'subscribe',
          collection,
          branch: effectiveBranch,
        }
        socket.send(JSON.stringify(message))
      }
    },

    unsubscribe(collection: string): void {
      // Remove from pending subscriptions
      for (const sub of pendingSubscriptions) {
        if (sub.collection === collection) {
          pendingSubscriptions.delete(sub)
        }
      }

      if (socket && socket.readyState === WebSocket.OPEN) {
        const message: UnsubscribeMessage = {
          type: 'unsubscribe',
          collection,
        }
        socket.send(JSON.stringify(message))
      }
    },

    onInitial(collection: string, callback: (items: T[], txid: number) => void): () => void {
      if (!initialCallbacks.has(collection)) {
        initialCallbacks.set(collection, new Set())
      }
      initialCallbacks.get(collection)!.add(callback)

      return () => {
        const callbacks = initialCallbacks.get(collection)
        if (callbacks) {
          callbacks.delete(callback)
        }
      }
    },

    onChange(collection: string, callback: (change: ChangeMessage<T>) => void): () => void {
      if (!changeCallbacks.has(collection)) {
        changeCallbacks.set(collection, new Set())
      }
      changeCallbacks.get(collection)!.add(callback)

      return () => {
        const callbacks = changeCallbacks.get(collection)
        if (callbacks) {
          callbacks.delete(callback)
        }
      }
    },

    onSync(callback: (change: ChangeMessage<T>) => void): () => void {
      syncCallbacks.add(callback)
      return () => {
        syncCallbacks.delete(callback)
      }
    },

    onDisconnect(callback: () => void): () => void {
      disconnectCallbacks.add(callback)
      return () => {
        disconnectCallbacks.delete(callback)
      }
    },

    onError(callback: (error: Error) => void): () => void {
      errorCallbacks.add(callback)
      return () => {
        errorCallbacks.delete(callback)
      }
    },

    onStatusChange(callback: (status: ConnectionStatus) => void): () => void {
      statusChangeCallbacks.add(callback)
      return () => {
        statusChangeCallbacks.delete(callback)
      }
    },
  }

  return client
}

// =============================================================================
// Class-based API (for compatibility with packages/react)
// =============================================================================

/**
 * SyncClient class for OOP-style usage
 *
 * @example
 * ```typescript
 * const client = new SyncClient<Task>({
 *   doUrl: 'wss://example.com.ai/do/123',
 *   collection: 'Task',
 * })
 *
 * client.onInitial = (items, txid) => {
 *   console.log('Initial data:', items)
 * }
 *
 * client.connect()
 * ```
 */
export class SyncClient<T = SyncItem> {
  private config: {
    doUrl: string
    collection: string
    branch?: string
  }
  private client: SyncClientInterface<T>

  /**
   * Called when initial data is received after subscribing
   */
  onInitial: (items: T[], txid: number) => void = () => {}

  /**
   * Called when a change is received (insert, update, or delete)
   */
  onChange: (op: 'insert' | 'update' | 'delete', item: T, txid: number) => void = () => {}

  /**
   * Called when the WebSocket connection is closed
   */
  onDisconnect: () => void = () => {}

  /**
   * Called when connection state changes
   */
  onStateChange: (state: ConnectionStatus) => void = () => {}

  /**
   * Called when a WebSocket error occurs
   */
  onError: (error: Error) => void = () => {}

  constructor(config: { doUrl: string; collection: string; branch?: string }) {
    this.config = config
    this.client = createSyncClient<T>({
      url: config.doUrl,
      branch: config.branch,
    })

    // Wire up callbacks
    this.client.onInitial(config.collection, (items, txid) => {
      this.onInitial(items, txid)
    })

    this.client.onChange(config.collection, (change) => {
      if (change.type === 'delete') {
        // For delete, create a minimal item with key
        const item = { key: change.key } as unknown as T
        this.onChange('delete', item, change.txid)
      } else {
        this.onChange(change.type, change.data, change.txid)
      }
    })

    this.client.onDisconnect(() => {
      this.onDisconnect()
    })

    this.client.onStatusChange((status) => {
      this.onStateChange(status)
    })

    this.client.onError((error) => {
      this.onError(error)
    })
  }

  /**
   * Get the current connection state
   */
  get connectionState(): ConnectionStatus {
    return this.client.getStatus()
  }

  /**
   * Check if the client is currently connected
   */
  get isConnected(): boolean {
    return this.client.getStatus() === 'connected'
  }

  /**
   * Connect to the WebSocket server
   */
  connect(): void {
    this.client.connect().then(() => {
      this.client.subscribe(this.config.collection, this.config.branch)
    }).catch(() => {
      // Error is emitted via onError callback
    })
  }

  /**
   * Disconnect from the WebSocket server
   */
  disconnect(): void {
    this.client.disconnect()
  }
}
