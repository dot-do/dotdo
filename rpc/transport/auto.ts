// Auto Transport - Automatic transport detection and upgrade
// Starts with FetchTransport and upgrades to WebSocketTransport if available

import { generateCorrelationId } from '../headers'
import type {
  Transport,
  TransportOptions,
  RPCMessage,
  RPCResponse,
  TransportState,
  TransportEvent,
  TransportEventListener,
} from './types'
import { FetchTransport, type FetchTransportOptions } from './fetch'
import { WebSocketTransport, type WebSocketTransportOptions } from './websocket'

/**
 * Strategy for transport selection
 */
export type TransportStrategy = 'fetch-only' | 'websocket-only' | 'auto-upgrade'

/**
 * Options for the auto transport
 */
export interface AutoTransportOptions extends TransportOptions {
  /** Base URL of the RPC endpoint (HTTP/HTTPS) */
  url: string
  /**
   * Transport selection strategy
   * - 'fetch-only': Only use FetchTransport (no upgrade)
   * - 'websocket-only': Only use WebSocketTransport
   * - 'auto-upgrade': Start with Fetch, upgrade to WebSocket if available
   * @default 'auto-upgrade'
   */
  strategy?: TransportStrategy
  /**
   * Enable automatic upgrade from Fetch to WebSocket.
   * Shorthand for strategy: 'auto-upgrade'
   * @default true
   */
  autoUpgrade?: boolean
  /**
   * WebSocket endpoint path (appended to base URL)
   * @default '/ws'
   */
  wsPath?: string
  /**
   * Timeout in ms for WebSocket capability check
   * @default 3000
   */
  upgradeTimeout?: number
  /**
   * Retry upgrade after failure interval in ms (0 to disable)
   * @default 30000
   */
  upgradeRetryInterval?: number
  /**
   * Maximum upgrade retry attempts (0 for unlimited)
   * @default 3
   */
  maxUpgradeRetries?: number
  /** Custom fetch implementation (for testing or polyfills) */
  fetch?: typeof globalThis.fetch
  /** Custom WebSocket implementation (for testing) */
  WebSocket?: typeof WebSocket
  /** FetchTransport-specific options */
  fetchOptions?: Partial<Omit<FetchTransportOptions, 'url' | 'timeout' | 'correlationId' | 'headers' | 'fetch'>>
  /** WebSocketTransport-specific options */
  wsOptions?: Partial<Omit<WebSocketTransportOptions, 'url' | 'timeout' | 'correlationId' | 'WebSocket'>>
}

/**
 * Transport type currently in use
 */
export type ActiveTransportType = 'fetch' | 'websocket'

/**
 * Auto Transport event types (extends standard transport events)
 */
export interface AutoTransportEvent extends TransportEvent {
  /** For upgrade events, the transport type we're upgrading to/from */
  transport?: ActiveTransportType
  /** For upgrade-failed events, the reason */
  reason?: string
}

/**
 * Auto Transport event listener
 */
export type AutoTransportEventListener = (event: AutoTransportEvent) => void

/**
 * Auto Transport - automatically selects and upgrades transport
 *
 * This transport starts with FetchTransport for immediate availability,
 * then attempts to upgrade to WebSocketTransport if the endpoint supports it.
 *
 * Features:
 * - Transparent fallback to Fetch if WebSocket unavailable
 * - Automatic upgrade detection via WebSocket handshake
 * - Configurable upgrade strategy
 * - Event notifications for transport changes
 * - Retry logic for upgrade failures
 *
 * @example
 * ```typescript
 * // Basic usage with auto-upgrade (default)
 * const transport = new AutoTransport({
 *   url: 'https://api.example.com',
 * })
 *
 * // Send immediately (uses fetch)
 * const response = await transport.send({ method: 'test', args: [] })
 *
 * // Listen for upgrade events
 * transport.addEventListener((event) => {
 *   if (event.type === 'upgrade') {
 *     console.log(`Upgraded to ${event.transport}`)
 *   }
 * })
 *
 * // Disable auto-upgrade
 * const fetchOnly = new AutoTransport({
 *   url: 'https://api.example.com',
 *   autoUpgrade: false,  // or strategy: 'fetch-only'
 * })
 *
 * // Force WebSocket only
 * const wsOnly = new AutoTransport({
 *   url: 'https://api.example.com',
 *   strategy: 'websocket-only',
 * })
 * ```
 */
export class AutoTransport implements Transport {
  private readonly url: string
  private readonly wsUrl: string
  private readonly timeout: number
  private readonly baseCorrelationId?: string
  private readonly headers: Record<string, string>
  private readonly strategy: TransportStrategy
  private readonly upgradeTimeout: number
  private readonly upgradeRetryInterval: number
  private readonly maxUpgradeRetries: number
  private readonly fetchImpl: typeof globalThis.fetch
  private readonly WebSocketImpl: typeof WebSocket
  private readonly fetchOptions: Partial<FetchTransportOptions>
  private readonly wsOptions: Partial<WebSocketTransportOptions>

  private fetchTransport: FetchTransport | null = null
  private wsTransport: WebSocketTransport | null = null
  private activeTransport: Transport | null = null
  private activeTransportType: ActiveTransportType = 'fetch'
  private state: TransportState = 'DISCONNECTED' as TransportState
  private eventListeners = new Set<AutoTransportEventListener>()
  private upgradeAttempts = 0
  private upgradeTimer: ReturnType<typeof setTimeout> | null = null
  private upgradeInProgress = false
  private upgradePromise: Promise<boolean> | null = null
  private closed = false

  constructor(options: AutoTransportOptions) {
    this.url = options.url
    this.timeout = options.timeout ?? 30000
    if (options.correlationId !== undefined) {
      this.baseCorrelationId = options.correlationId
    }
    this.headers = options.headers ?? {}
    this.fetchImpl = options.fetch ?? globalThis.fetch
    this.WebSocketImpl = options.WebSocket ?? globalThis.WebSocket
    this.fetchOptions = options.fetchOptions ?? {}
    this.wsOptions = options.wsOptions ?? {}

    // Determine strategy
    if (options.strategy) {
      this.strategy = options.strategy
    } else if (options.autoUpgrade === false) {
      this.strategy = 'fetch-only'
    } else {
      this.strategy = 'auto-upgrade'
    }

    this.upgradeTimeout = options.upgradeTimeout ?? 3000
    this.upgradeRetryInterval = options.upgradeRetryInterval ?? 30000
    this.maxUpgradeRetries = options.maxUpgradeRetries ?? 3

    // Build WebSocket URL
    const wsPath = options.wsPath ?? '/ws'
    this.wsUrl = this.buildWsUrl(this.url, wsPath)

    // Initialize transport based on strategy
    this.initializeTransport()
  }

  /**
   * Build WebSocket URL from HTTP URL
   */
  private buildWsUrl(httpUrl: string, wsPath: string): string {
    const url = new URL(httpUrl)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.pathname = wsPath.startsWith('/') ? wsPath : `/${wsPath}`
    return url.toString()
  }

  /**
   * Initialize the appropriate transport based on strategy
   */
  private initializeTransport(): void {
    if (this.strategy === 'websocket-only') {
      // Start with WebSocket only
      this.initWebSocket()
    } else {
      // Start with Fetch (default for auto-upgrade and fetch-only)
      this.initFetch()

      // Schedule upgrade check for auto-upgrade strategy
      if (this.strategy === 'auto-upgrade') {
        // Use setImmediate equivalent to not block constructor
        setTimeout(() => this.attemptUpgrade(), 0)
      }
    }
  }

  /**
   * Initialize FetchTransport
   */
  private initFetch(): void {
    this.fetchTransport = new FetchTransport({
      url: this.url,
      timeout: this.timeout,
      correlationId: this.baseCorrelationId,
      headers: this.headers,
      fetch: this.fetchImpl,
      ...this.fetchOptions,
    })
    this.activeTransport = this.fetchTransport
    this.activeTransportType = 'fetch'
    this.state = 'CONNECTED' as TransportState
  }

  /**
   * Initialize WebSocketTransport
   */
  private initWebSocket(): void {
    this.wsTransport = new WebSocketTransport({
      url: this.wsUrl,
      timeout: this.timeout,
      correlationId: this.baseCorrelationId,
      WebSocket: this.WebSocketImpl,
      ...this.wsOptions,
    })

    // Forward WebSocket events
    this.wsTransport.addEventListener((event) => {
      this.handleWsEvent(event)
    })

    this.activeTransport = this.wsTransport
    this.activeTransportType = 'websocket'
    this.state = this.wsTransport.getState()
  }

  /**
   * Handle WebSocket transport events
   */
  private handleWsEvent(event: TransportEvent): void {
    // Update our state based on WebSocket state
    if (event.type === 'connect') {
      this.state = 'CONNECTED' as TransportState
    } else if (event.type === 'disconnect') {
      this.state = 'DISCONNECTED' as TransportState

      // If we're in auto-upgrade mode and WebSocket disconnects,
      // fall back to Fetch and schedule reconnect
      if (this.strategy === 'auto-upgrade' && !this.closed) {
        this.fallbackToFetch()
      }
    }

    // Forward event to our listeners
    this.emit(event)
  }

  /**
   * Fall back to Fetch transport
   */
  private fallbackToFetch(): void {
    if (this.fetchTransport) {
      this.activeTransport = this.fetchTransport
      this.activeTransportType = 'fetch'
      this.state = 'CONNECTED' as TransportState
      this.emit({ type: 'disconnect' })
      this.emit({ type: 'connect' })

      // Schedule upgrade retry
      if (this.upgradeRetryInterval > 0 && !this.closed) {
        this.scheduleUpgradeRetry()
      }
    }
  }

  /**
   * Attempt to upgrade to WebSocket
   */
  private async attemptUpgrade(): Promise<boolean> {
    // Prevent concurrent upgrade attempts
    if (this.upgradeInProgress) {
      return this.upgradePromise ?? Promise.resolve(false)
    }

    // Check if already on WebSocket
    if (this.activeTransportType === 'websocket' && this.wsTransport?.isConnected()) {
      return true
    }

    // Check max retries
    if (this.maxUpgradeRetries > 0 && this.upgradeAttempts >= this.maxUpgradeRetries) {
      return false
    }

    this.upgradeInProgress = true
    this.upgradeAttempts++

    this.upgradePromise = this.doUpgrade()
    const result = await this.upgradePromise

    this.upgradeInProgress = false
    this.upgradePromise = null

    return result
  }

  /**
   * Perform the actual upgrade
   */
  private async doUpgrade(): Promise<boolean> {
    if (this.closed) {
      return false
    }

    try {
      // Check if WebSocket is available
      const available = await this.checkWebSocketAvailability()

      if (!available) {
        this.emit({
          type: 'error',
          error: new Error('WebSocket not available at endpoint'),
          reason: 'not-available',
        } as AutoTransportEvent)
        return false
      }

      // Initialize WebSocket if not already done
      if (!this.wsTransport) {
        this.initWebSocket()
      }

      // Try to connect
      const connectSuccess = await this.tryWebSocketConnect()

      if (connectSuccess) {
        // Successfully upgraded
        this.activeTransport = this.wsTransport
        this.activeTransportType = 'websocket'
        this.state = 'CONNECTED' as TransportState
        this.upgradeAttempts = 0 // Reset attempts on success

        this.emit({
          type: 'connect',
          transport: 'websocket',
        } as AutoTransportEvent)

        // Emit custom upgrade event
        this.emit({
          type: 'reconnect',
          attempt: this.upgradeAttempts,
          transport: 'websocket',
        } as AutoTransportEvent)

        return true
      }

      this.emit({
        type: 'error',
        error: new Error('WebSocket connection failed'),
        reason: 'connect-failed',
      } as AutoTransportEvent)

      return false
    } catch (error) {
      this.emit({
        type: 'error',
        error: error instanceof Error ? error : new Error(String(error)),
        reason: 'upgrade-error',
      } as AutoTransportEvent)

      return false
    }
  }

  /**
   * Check if WebSocket is available at the endpoint
   */
  private async checkWebSocketAvailability(): Promise<boolean> {
    try {
      // Try to establish a WebSocket connection with a timeout
      return new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          ws.close()
          resolve(false)
        }, this.upgradeTimeout)

        let ws: WebSocket
        try {
          ws = new this.WebSocketImpl(this.wsUrl)
        } catch {
          clearTimeout(timeout)
          resolve(false)
          return
        }

        ws.addEventListener('open', () => {
          clearTimeout(timeout)
          ws.close()
          resolve(true)
        })

        ws.addEventListener('error', () => {
          clearTimeout(timeout)
          resolve(false)
        })

        ws.addEventListener('close', () => {
          clearTimeout(timeout)
          // If it closed without opening, it's not available
          // resolve(false) is already called by error handler typically
        })
      })
    } catch {
      return false
    }
  }

  /**
   * Try to connect WebSocket transport
   */
  private async tryWebSocketConnect(): Promise<boolean> {
    if (!this.wsTransport) {
      return false
    }

    try {
      // Send a ping to establish connection
      const response = await this.wsTransport.send({
        method: '$ping',
        args: [{ timestamp: Date.now() }],
        correlationId: generateCorrelationId(),
      })

      return !response.error
    } catch {
      return false
    }
  }

  /**
   * Schedule an upgrade retry
   */
  private scheduleUpgradeRetry(): void {
    if (this.upgradeTimer) {
      clearTimeout(this.upgradeTimer)
    }

    if (this.closed || this.upgradeRetryInterval <= 0) {
      return
    }

    this.upgradeTimer = setTimeout(() => {
      this.upgradeTimer = null
      this.attemptUpgrade()
    }, this.upgradeRetryInterval)
  }

  /**
   * Emit event to all listeners
   */
  private emit(event: AutoTransportEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event)
      } catch {
        // Ignore listener errors
      }
    }
  }

  /**
   * Send an RPC message via the active transport
   */
  async send<T = unknown>(message: RPCMessage): Promise<RPCResponse<T>> {
    if (this.closed) {
      const correlationId = message.correlationId ?? this.baseCorrelationId ?? generateCorrelationId()
      return {
        error: {
          type: 'TransportError',
          code: 'TRANSPORT_CLOSED',
          message: 'Transport has been closed',
        },
        correlationId,
      }
    }

    if (!this.activeTransport) {
      const correlationId = message.correlationId ?? this.baseCorrelationId ?? generateCorrelationId()
      return {
        error: {
          type: 'TransportError',
          code: 'NO_TRANSPORT',
          message: 'No transport available',
        },
        correlationId,
      }
    }

    return this.activeTransport.send<T>(message)
  }

  /**
   * Close all transports
   */
  async close(): Promise<void> {
    this.closed = true
    this.state = 'CLOSED' as TransportState

    // Cancel upgrade timer
    if (this.upgradeTimer) {
      clearTimeout(this.upgradeTimer)
      this.upgradeTimer = null
    }

    // Close all transports
    const closePromises: Promise<void>[] = []

    if (this.fetchTransport?.close) {
      closePromises.push(this.fetchTransport.close())
    }

    if (this.wsTransport?.close) {
      closePromises.push(this.wsTransport.close())
    }

    await Promise.all(closePromises)

    this.fetchTransport = null
    this.wsTransport = null
    this.activeTransport = null
    this.eventListeners.clear()
  }

  /**
   * Get current transport state
   */
  getState(): TransportState {
    return this.state
  }

  /**
   * Add event listener
   */
  addEventListener(listener: AutoTransportEventListener): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  /**
   * Get the currently active transport type
   */
  getActiveTransportType(): ActiveTransportType {
    return this.activeTransportType
  }

  /**
   * Check if currently using WebSocket
   */
  isUsingWebSocket(): boolean {
    return this.activeTransportType === 'websocket'
  }

  /**
   * Check if currently connected
   */
  isConnected(): boolean {
    if (this.activeTransportType === 'websocket' && this.wsTransport) {
      return this.wsTransport.isConnected()
    }
    // FetchTransport is always "connected"
    return this.state === ('CONNECTED' as TransportState)
  }

  /**
   * Manually trigger an upgrade attempt
   * Useful for testing or when you know WebSocket became available
   */
  async tryUpgrade(): Promise<boolean> {
    if (this.strategy === 'fetch-only') {
      return false
    }
    return this.attemptUpgrade()
  }

  /**
   * Get the underlying fetch transport (if available)
   */
  getFetchTransport(): FetchTransport | null {
    return this.fetchTransport
  }

  /**
   * Get the underlying WebSocket transport (if available)
   */
  getWebSocketTransport(): WebSocketTransport | null {
    return this.wsTransport
  }
}

/**
 * Create an auto transport (convenience function)
 *
 * @example
 * ```typescript
 * const transport = createAutoTransport({
 *   url: 'https://api.example.com',
 *   autoUpgrade: true,
 * })
 * ```
 */
export function createAutoTransport(options: AutoTransportOptions): AutoTransport {
  return new AutoTransport(options)
}
