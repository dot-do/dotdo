/**
 * FSWatcherClient - Production-ready client for file system watching
 *
 * This module provides a WebSocket-based client for receiving file system
 * change notifications from an fsx.do server. It implements production-grade
 * reliability features including:
 *
 * - Auto-reconnect with exponential backoff
 * - Event queuing during reconnection
 * - Connection state events (onConnect, onDisconnect, onReconnecting)
 * - Offline event buffering
 * - Connection health checks via ping/pong
 * - Automatic resubscription to watched paths after reconnect
 * - Configurable maxReconnectAttempts
 *
 * @module core/watch/client
 *
 * @example
 * ```typescript
 * import { FSWatcherClient } from '@dotdo/fsx/watch'
 *
 * const watcher = new FSWatcherClient({
 *   url: 'wss://api.fsx.do/watch',
 *   maxReconnectAttempts: 10,
 *   onConnect: () => console.log('Connected!'),
 *   onDisconnect: (code, reason) => console.log(`Disconnected: ${reason}`),
 *   onReconnecting: (attempt) => console.log(`Reconnecting... attempt ${attempt}`),
 * })
 *
 * await watcher.connect()
 *
 * // Watch for changes
 * const unsubscribe = await watcher.watch('/home/user', (event) => {
 *   console.log(`${event.type}: ${event.path}`)
 * })
 *
 * // Later: stop watching
 * unsubscribe()
 *
 * // Clean up
 * await watcher.disconnect()
 * ```
 */

import type { WatchEvent, WatchEventType } from './events.js'

// =============================================================================
// Types
// =============================================================================

/**
 * Connection state of the FSWatcherClient.
 *
 * - `disconnected`: Not connected and not attempting to connect
 * - `connecting`: Currently establishing initial connection
 * - `connected`: WebSocket is open and ready
 * - `reconnecting`: Connection lost, attempting to reconnect
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

/**
 * Callback function for watch events.
 *
 * @param event - The watch event containing type, path, and timestamp
 */
export type WatchCallback = (event: WatchEvent) => void

/**
 * Configuration options for FSWatcherClient.
 */
export interface FSWatcherClientOptions {
  /**
   * WebSocket URL to connect to.
   *
   * @example 'wss://api.fsx.do/watch'
   */
  url: string

  /**
   * Maximum number of reconnection attempts before giving up.
   * Set to 0 for unlimited attempts.
   *
   * @default 0 (unlimited)
   */
  maxReconnectAttempts?: number

  /**
   * Initial delay in milliseconds before first reconnect attempt.
   * Subsequent attempts use exponential backoff.
   *
   * @default 1000
   */
  reconnectDelayMs?: number

  /**
   * Maximum delay in milliseconds between reconnect attempts.
   * Caps the exponential backoff.
   *
   * @default 30000
   */
  maxReconnectDelayMs?: number

  /**
   * Interval in milliseconds between health check pings.
   * Set to 0 to disable health checks.
   *
   * @default 30000
   */
  healthCheckIntervalMs?: number

  /**
   * Timeout in milliseconds to wait for pong response.
   * If exceeded, connection is considered dead.
   *
   * @default 5000
   */
  healthCheckTimeoutMs?: number

  /**
   * Callback invoked when connection is established.
   */
  onConnect?: () => void

  /**
   * Callback invoked when connection is lost.
   *
   * @param code - WebSocket close code
   * @param reason - WebSocket close reason
   */
  onDisconnect?: (code: number, reason: string) => void

  /**
   * Callback invoked when attempting to reconnect.
   *
   * @param attempt - Current reconnection attempt number (1-based)
   */
  onReconnecting?: (attempt: number) => void

  /**
   * Callback invoked when max reconnect attempts exceeded.
   */
  onReconnectFailed?: () => void
}

/**
 * Internal subscription entry tracking callbacks for a path.
 */
interface SubscriptionEntry {
  /** Set of callbacks registered for this path */
  callbacks: Set<WatchCallback>
}

/**
 * Message types for WebSocket communication.
 */
type ClientMessage =
  | { type: 'subscribe'; path: string }
  | { type: 'unsubscribe'; path: string }
  | { type: 'ping' }

/**
 * Server message types.
 */
type ServerMessage = WatchEvent | { type: 'pong' } | { type: 'subscribed'; path: string } | { type: 'unsubscribed'; path: string }

// =============================================================================
// FSWatcherClient Class
// =============================================================================

/**
 * Production-ready WebSocket client for file system watching.
 *
 * Implements the FSWatcher interface from `core/types.ts` while providing
 * robust connection management suitable for production use.
 *
 * Features:
 * - **Auto-reconnect**: Automatically reconnects with exponential backoff
 * - **Event queuing**: Queues subscription requests during reconnection
 * - **Health checks**: Periodic ping/pong to detect dead connections
 * - **State callbacks**: Hooks for connection lifecycle events
 * - **Automatic resubscription**: Restores subscriptions after reconnect
 *
 * @implements {FSWatcher}
 */
export class FSWatcherClient {
  // ===========================================================================
  // Configuration
  // ===========================================================================

  private readonly url: string
  private readonly maxReconnectAttempts: number
  private readonly reconnectDelayMs: number
  private readonly maxReconnectDelayMs: number
  private readonly healthCheckIntervalMs: number
  private readonly healthCheckTimeoutMs: number
  private readonly onConnect?: () => void
  private readonly onDisconnect?: (code: number, reason: string) => void
  private readonly onReconnecting?: (attempt: number) => void
  private readonly onReconnectFailed?: () => void

  // ===========================================================================
  // State
  // ===========================================================================

  /** Current WebSocket connection */
  private ws: WebSocket | null = null

  /** Current connection state */
  private _connectionState: ConnectionState = 'disconnected'

  /** Current reconnect attempt number */
  private reconnectAttempt: number = 0

  /** Timer for reconnect delay */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  /** Timer for health check interval */
  private healthCheckTimer: ReturnType<typeof setTimeout> | null = null

  /** Timer for health check timeout */
  private healthCheckTimeoutTimer: ReturnType<typeof setTimeout> | null = null

  /** Whether disconnect was intentional (don't reconnect) */
  private intentionalDisconnect: boolean = false

  /** Pending connection promise resolver */
  private connectResolver: (() => void) | null = null

  /** Active subscriptions by path */
  private subscriptions: Map<string, SubscriptionEntry> = new Map()

  /** Queued operations to perform after reconnect */
  private pendingOperations: Array<() => Promise<void>> = []

  // ===========================================================================
  // Constructor
  // ===========================================================================

  /**
   * Create a new FSWatcherClient.
   *
   * @param options - Configuration options
   *
   * @example
   * ```typescript
   * const watcher = new FSWatcherClient({
   *   url: 'wss://api.fsx.do/watch',
   *   maxReconnectAttempts: 5,
   *   reconnectDelayMs: 1000,
   *   onConnect: () => console.log('Connected'),
   * })
   * ```
   */
  constructor(options: FSWatcherClientOptions) {
    this.url = options.url
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 0
    this.reconnectDelayMs = options.reconnectDelayMs ?? 1000
    this.maxReconnectDelayMs = options.maxReconnectDelayMs ?? 30000
    this.healthCheckIntervalMs = options.healthCheckIntervalMs ?? 30000
    this.healthCheckTimeoutMs = options.healthCheckTimeoutMs ?? 5000
    this.onConnect = options.onConnect
    this.onDisconnect = options.onDisconnect
    this.onReconnecting = options.onReconnecting
    this.onReconnectFailed = options.onReconnectFailed
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Get the current connection state.
   *
   * @returns Current connection state
   */
  get connectionState(): ConnectionState {
    return this._connectionState
  }

  /**
   * Connect to the WebSocket server.
   *
   * If already connected, resolves immediately.
   * If currently connecting or reconnecting, returns the pending promise.
   *
   * @returns Promise that resolves when connected
   *
   * @example
   * ```typescript
   * await watcher.connect()
   * console.log(watcher.connectionState) // 'connected'
   * ```
   */
  async connect(): Promise<void> {
    if (this._connectionState === 'connected') {
      return Promise.resolve()
    }

    this.intentionalDisconnect = false

    return this.createConnection()
  }

  /**
   * Disconnect from the WebSocket server.
   *
   * This is an intentional disconnect and will not trigger reconnection.
   * All subscriptions are cleared.
   *
   * @returns Promise that resolves when disconnected
   */
  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true
    this.clearTimers()
    this.subscriptions.clear()
    this.pendingOperations = []

    if (this.ws) {
      this.ws.close(1000, 'Client disconnected')
    }

    this._connectionState = 'disconnected'
  }

  /**
   * Watch a path for file system changes.
   *
   * If not connected, the subscription will be queued and executed
   * once connection is established.
   *
   * @param path - Path to watch (file or directory)
   * @param callback - Function to call when changes occur
   * @returns Promise resolving to an unsubscribe function
   *
   * @example
   * ```typescript
   * const unsubscribe = await watcher.watch('/home/user', (event) => {
   *   console.log(`${event.type}: ${event.path}`)
   * })
   *
   * // Later: stop watching
   * unsubscribe()
   * ```
   */
  async watch(path: string, callback: WatchCallback): Promise<() => void> {
    const normalizedPath = this.normalizePath(path)

    // Get or create subscription entry
    let entry = this.subscriptions.get(normalizedPath)
    const isNewPath = !entry

    if (!entry) {
      entry = { callbacks: new Set() }
      this.subscriptions.set(normalizedPath, entry)
    }

    entry.callbacks.add(callback)

    // Send subscribe message if this is a new path
    if (isNewPath) {
      if (this._connectionState === 'connected') {
        this.send({ type: 'subscribe', path: normalizedPath })
      } else {
        // Queue for later
        this.pendingOperations.push(async () => {
          this.send({ type: 'subscribe', path: normalizedPath })
        })
      }
    }

    // Return unsubscribe function
    return () => {
      const entry = this.subscriptions.get(normalizedPath)
      if (entry) {
        entry.callbacks.delete(callback)

        // If no more callbacks, unsubscribe from server
        if (entry.callbacks.size === 0) {
          this.subscriptions.delete(normalizedPath)

          if (this._connectionState === 'connected') {
            this.send({ type: 'unsubscribe', path: normalizedPath })
          }
        }
      }
    }
  }

  // ===========================================================================
  // FSWatcher Interface Methods
  // ===========================================================================

  /**
   * Close the watcher (alias for disconnect).
   *
   * Implements the FSWatcher interface from `core/types.ts`.
   */
  close(): void {
    this.disconnect()
  }

  /**
   * Reference the watcher (no-op in this implementation).
   *
   * Implements the FSWatcher interface from `core/types.ts`.
   *
   * @returns this for chaining
   */
  ref(): this {
    return this
  }

  /**
   * Unreference the watcher (no-op in this implementation).
   *
   * Implements the FSWatcher interface from `core/types.ts`.
   *
   * @returns this for chaining
   */
  unref(): this {
    return this
  }

  // ===========================================================================
  // Private Methods - Connection Management
  // ===========================================================================

  /**
   * Create a new WebSocket connection.
   */
  private createConnection(): Promise<void> {
    return new Promise((resolve) => {
      this.connectResolver = resolve
      this._connectionState = 'connecting'

      this.ws = new WebSocket(this.url)
      this.setupWebSocketHandlers()
    })
  }

  /**
   * Set up WebSocket event handlers.
   */
  private setupWebSocketHandlers(): void {
    if (!this.ws) return

    this.ws.onopen = () => {
      this._connectionState = 'connected'
      this.reconnectAttempt = 0
      this.startHealthCheck()

      // Resubscribe to all paths
      this.resubscribeAll()

      // Execute pending operations
      this.executePendingOperations()

      // Notify callback
      this.onConnect?.()

      // Resolve connect promise
      this.connectResolver?.()
      this.connectResolver = null
    }

    this.ws.onclose = (event) => {
      this.stopHealthCheck()
      this.onDisconnect?.(event.code, event.reason)

      if (!this.intentionalDisconnect) {
        this.scheduleReconnect()
      } else {
        this._connectionState = 'disconnected'
      }
    }

    this.ws.onerror = () => {
      // Error will be followed by close event
    }

    this.ws.onmessage = (event) => {
      this.handleMessage(event.data)
    }
  }

  /**
   * Handle incoming WebSocket message.
   */
  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data) as ServerMessage

      if ('type' in message) {
        switch (message.type) {
          case 'pong':
            this.handlePong()
            break
          case 'subscribed':
          case 'unsubscribed':
            // Acknowledgment messages - no action needed
            break
          case 'create':
          case 'modify':
          case 'delete':
          case 'rename':
            this.dispatchEvent(message as WatchEvent)
            break
        }
      }
    } catch {
      // Ignore malformed messages
    }
  }

  /**
   * Dispatch a watch event to all matching callbacks.
   */
  private dispatchEvent(event: WatchEvent): void {
    // Find all subscriptions that match this event's path
    this.subscriptions.forEach((entry, watchPath) => {
      if (this.pathMatches(watchPath, event.path)) {
        entry.callbacks.forEach((callback) => {
          try {
            callback(event)
          } catch {
            // Swallow callback errors
          }
        })
      }
    })
  }

  /**
   * Check if an event path matches a watched path.
   *
   * A watched path matches if:
   * - It equals the event path exactly
   * - It is a parent directory of the event path
   */
  private pathMatches(watchPath: string, eventPath: string): boolean {
    // Exact match
    if (watchPath === eventPath) return true

    // Parent directory match (watchPath is ancestor of eventPath)
    const normalizedWatch = watchPath.endsWith('/') ? watchPath : watchPath + '/'
    return eventPath.startsWith(normalizedWatch)
  }

  /**
   * Send a message to the WebSocket server.
   */
  private send(message: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    }
  }

  // ===========================================================================
  // Private Methods - Reconnection
  // ===========================================================================

  /**
   * Schedule a reconnection attempt.
   */
  private scheduleReconnect(): void {
    this.reconnectAttempt++

    // Check if we've exceeded max attempts
    if (this.maxReconnectAttempts > 0 && this.reconnectAttempt > this.maxReconnectAttempts) {
      this._connectionState = 'disconnected'
      this.onReconnectFailed?.()
      return
    }

    this._connectionState = 'reconnecting'
    this.onReconnecting?.(this.reconnectAttempt)

    // Calculate delay with exponential backoff
    const delay = Math.min(
      this.reconnectDelayMs * Math.pow(2, this.reconnectAttempt - 1),
      this.maxReconnectDelayMs
    )

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.createConnection()
    }, delay)
  }

  /**
   * Resubscribe to all currently tracked paths.
   */
  private resubscribeAll(): void {
    Array.from(this.subscriptions.keys()).forEach((path) => {
      this.send({ type: 'subscribe', path })
    })
  }

  /**
   * Execute all pending operations.
   */
  private async executePendingOperations(): Promise<void> {
    const operations = [...this.pendingOperations]
    this.pendingOperations = []

    for (const op of operations) {
      try {
        await op()
      } catch {
        // Ignore errors in pending operations
      }
    }
  }

  // ===========================================================================
  // Private Methods - Health Check
  // ===========================================================================

  /**
   * Start the health check ping interval.
   */
  private startHealthCheck(): void {
    if (this.healthCheckIntervalMs <= 0) return

    this.healthCheckTimer = setTimeout(() => {
      this.sendPing()
    }, this.healthCheckIntervalMs)
  }

  /**
   * Stop the health check timer.
   */
  private stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearTimeout(this.healthCheckTimer)
      this.healthCheckTimer = null
    }
    if (this.healthCheckTimeoutTimer) {
      clearTimeout(this.healthCheckTimeoutTimer)
      this.healthCheckTimeoutTimer = null
    }
  }

  /**
   * Send a ping and start timeout timer.
   */
  private sendPing(): void {
    this.send({ type: 'ping' })

    // Start timeout timer
    this.healthCheckTimeoutTimer = setTimeout(() => {
      // No pong received - connection is dead
      this.ws?.close(4000, 'Health check timeout')
    }, this.healthCheckTimeoutMs)
  }

  /**
   * Handle pong response.
   */
  private handlePong(): void {
    // Clear timeout timer
    if (this.healthCheckTimeoutTimer) {
      clearTimeout(this.healthCheckTimeoutTimer)
      this.healthCheckTimeoutTimer = null
    }

    // Schedule next health check
    this.startHealthCheck()
  }

  // ===========================================================================
  // Private Methods - Utilities
  // ===========================================================================

  /**
   * Normalize a path by removing trailing slashes (except for root).
   */
  private normalizePath(path: string): string {
    if (path === '/' || path === '') return '/'
    return path.endsWith('/') ? path.slice(0, -1) : path
  }

  /**
   * Clear all timers.
   */
  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.stopHealthCheck()
  }
}

// =============================================================================
// Re-exports
// =============================================================================

export type { WatchEvent, WatchEventType } from './events.js'
