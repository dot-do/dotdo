/**
 * @module rpc.do/transport/auto
 *
 * Auto Transport - Automatic transport detection and selection.
 *
 * This module provides an auto-selecting transport that can:
 * - Try WebSocket first and fall back to HTTP (websocket-first)
 * - Start with HTTP and upgrade to WebSocket (auto-upgrade)
 * - Use only HTTP or only WebSocket
 *
 * @example Basic usage (WebSocket-first, optimal for REPL)
 * ```typescript
 * import { AutoTransport } from 'rpc.do'
 *
 * const transport = new AutoTransport({
 *   url: 'https://api.example.com',
 *   strategy: 'websocket-first', // default
 * })
 *
 * // Tries wss://api.example.com/ws first
 * // Falls back to https://api.example.com/rpc if WS unavailable
 * const response = await transport.send({ method: 'test', args: [] })
 * ```
 */

import type { Transport, TransportEventListener, TransportEvent } from './types'
import type { RPCMessage, RPCResponse } from '../types'
import { TransportState } from './types'
import { FetchTransport, generateCorrelationId } from './fetch'
import { WebSocketTransport } from './websocket'

/**
 * Strategy for transport selection
 *
 * - 'fetch-only': Only use FetchTransport (no WebSocket)
 * - 'websocket-only': Only use WebSocketTransport (fail if unavailable)
 * - 'auto-upgrade': Start with Fetch, upgrade to WebSocket if available (lazy upgrade)
 * - 'websocket-first': Try WebSocket first, fall back to Fetch if unavailable (eager WS)
 */
export type TransportStrategy = 'fetch-only' | 'websocket-only' | 'auto-upgrade' | 'websocket-first'

/**
 * Options for the auto transport
 */
export interface AutoTransportOptions {
  /** Base URL of the RPC endpoint (HTTP/HTTPS) */
  url: string
  /**
   * Transport selection strategy
   * - 'fetch-only': Only use FetchTransport (no upgrade)
   * - 'websocket-only': Only use WebSocketTransport
   * - 'auto-upgrade': Start with Fetch, upgrade to WebSocket if available
   * - 'websocket-first': Try WebSocket first, fall back to Fetch if unavailable
   * @default 'websocket-first'
   */
  strategy?: TransportStrategy
  /**
   * WebSocket endpoint path (appended to base URL)
   * @default '/ws'
   */
  wsPath?: string
  /**
   * Request timeout in milliseconds
   * @default 30000
   */
  timeout?: number
  /**
   * Timeout in ms for WebSocket capability check
   * @default 3000
   */
  upgradeTimeout?: number
  /**
   * Custom WebSocket implementation (for testing)
   */
  WebSocket?: typeof WebSocket
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
}

/**
 * Auto Transport - automatically selects and upgrades transport
 *
 * This transport tries WebSocket first for optimal real-time experience,
 * then falls back to HTTP/fetch if WebSocket is unavailable.
 *
 * Features:
 * - WebSocket-first strategy for REPL and real-time use cases
 * - Transparent fallback to Fetch if WebSocket unavailable
 * - Event notifications for transport changes
 *
 * @example
 * ```typescript
 * // WebSocket-first (default, optimal for REPL)
 * const transport = new AutoTransport({
 *   url: 'https://api.example.com',
 * })
 *
 * // Listen for transport events
 * transport.addEventListener((event) => {
 *   if (event.type === 'connect') {
 *     console.log(`Connected via ${event.transport}`)
 *   }
 * })
 *
 * // Force HTTP only
 * const httpOnly = new AutoTransport({
 *   url: 'https://api.example.com',
 *   strategy: 'fetch-only',
 * })
 * ```
 */
export class AutoTransport implements Transport {
  private readonly url: string
  private readonly wsUrl: string
  private readonly timeout: number
  private readonly upgradeTimeout: number
  private readonly strategy: TransportStrategy
  private readonly WebSocketImpl: typeof WebSocket

  private fetchTransport: FetchTransport | null = null
  private wsTransport: WebSocketTransport | null = null
  private activeTransport: Transport | null = null
  private activeTransportType: ActiveTransportType = 'fetch'
  private state: TransportState = TransportState.DISCONNECTED
  private eventListeners = new Set<TransportEventListener>()
  private closed = false
  private initPromise: Promise<void> | null = null

  constructor(options: AutoTransportOptions) {
    this.url = options.url
    this.timeout = options.timeout ?? 30000
    this.upgradeTimeout = options.upgradeTimeout ?? 3000
    this.strategy = options.strategy ?? 'websocket-first'
    this.WebSocketImpl = options.WebSocket ?? globalThis.WebSocket

    // Build WebSocket URL
    const wsPath = options.wsPath ?? '/ws'
    this.wsUrl = this.buildWsUrl(this.url, wsPath)

    // Initialize transport based on strategy
    this.initPromise = this.initializeTransport()
  }

  /**
   * Build WebSocket URL from HTTP or WebSocket URL
   *
   * Handles:
   * - https:// -> wss://
   * - http:// -> ws://
   * - wss:// -> wss:// (pass through)
   * - ws:// -> ws:// (pass through)
   */
  private buildWsUrl(baseUrl: string, wsPath: string): string {
    const url = new URL(baseUrl)

    // If already a WebSocket URL, just update the path
    if (url.protocol === 'wss:' || url.protocol === 'ws:') {
      // Only update path if it's the root path (user didn't specify one)
      if (url.pathname === '/' || url.pathname === '') {
        url.pathname = wsPath.startsWith('/') ? wsPath : `/${wsPath}`
      }
      return url.toString()
    }

    // Convert HTTP(S) to WS(S)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.pathname = wsPath.startsWith('/') ? wsPath : `/${wsPath}`
    return url.toString()
  }

  /**
   * Initialize the appropriate transport based on strategy
   */
  private async initializeTransport(): Promise<void> {
    if (this.strategy === 'websocket-only') {
      // Start with WebSocket only (fail if unavailable)
      await this.initWebSocket()
    } else if (this.strategy === 'websocket-first') {
      // Try WebSocket first, fall back to Fetch if unavailable
      await this.attemptWebSocketFirst()
    } else if (this.strategy === 'auto-upgrade') {
      // Start with Fetch, try to upgrade later
      this.initFetch()
      // Schedule upgrade attempt
      setTimeout(() => this.attemptUpgrade(), 0)
    } else {
      // fetch-only
      this.initFetch()
    }
  }

  /**
   * Initialize FetchTransport
   */
  private initFetch(): void {
    this.fetchTransport = new FetchTransport({
      url: this.url,
      timeout: this.timeout,
    })
    this.activeTransport = this.fetchTransport
    this.activeTransportType = 'fetch'
    this.state = TransportState.CONNECTED

    this.emit({
      type: 'connect',
      transport: 'fetch',
    } as AutoTransportEvent)
  }

  /**
   * Initialize WebSocketTransport
   */
  private async initWebSocket(): Promise<void> {
    this.wsTransport = new WebSocketTransport({
      url: this.wsUrl,
      timeout: this.timeout,
      WebSocket: this.WebSocketImpl,
      reconnect: true,
    })

    // Forward WebSocket events
    this.wsTransport.addEventListener((event) => {
      this.handleWsEvent(event)
    })

    try {
      await this.wsTransport.connect()
      this.activeTransport = this.wsTransport
      this.activeTransportType = 'websocket'
      this.state = TransportState.CONNECTED
    } catch (error) {
      if (this.strategy === 'websocket-only') {
        throw error
      }
      // For other strategies, WebSocket failure is handled elsewhere
    }
  }

  /**
   * Handle WebSocket transport events
   */
  private handleWsEvent(event: TransportEvent): void {
    // Update our state based on WebSocket state
    if (event.type === 'connect') {
      this.state = TransportState.CONNECTED
    } else if (event.type === 'disconnect') {
      this.state = TransportState.DISCONNECTED

      // If we're in auto strategies and WebSocket disconnects,
      // fall back to Fetch
      if ((this.strategy === 'auto-upgrade' || this.strategy === 'websocket-first') && !this.closed) {
        this.fallbackToFetch()
      }
    }

    // Forward event to our listeners with transport info
    this.emit({
      ...event,
      transport: 'websocket',
    } as AutoTransportEvent)
  }

  /**
   * Fall back to Fetch transport
   */
  private fallbackToFetch(): void {
    if (!this.fetchTransport) {
      this.fetchTransport = new FetchTransport({
        url: this.url,
        timeout: this.timeout,
      })
    }

    this.activeTransport = this.fetchTransport
    this.activeTransportType = 'fetch'
    this.state = TransportState.CONNECTED

    this.emit({
      type: 'connect',
      transport: 'fetch',
    } as AutoTransportEvent)
  }

  /**
   * Attempt WebSocket connection first, fall back to Fetch if unavailable
   * Used by websocket-first strategy
   */
  private async attemptWebSocketFirst(): Promise<void> {
    if (this.closed) {
      return
    }

    this.state = TransportState.CONNECTING

    try {
      // Check if WebSocket is available
      const available = await this.checkWebSocketAvailability()

      if (available && !this.closed) {
        await this.initWebSocket()

        if (this.wsTransport && this.activeTransportType === 'websocket') {
          // Successfully connected via WebSocket
          return
        }
      }
    } catch {
      // WebSocket failed, fall back to Fetch
    }

    // WebSocket unavailable or failed, fall back to Fetch
    if (!this.closed) {
      this.initFetch()
    }
  }

  /**
   * Check if WebSocket is available at the endpoint
   */
  private checkWebSocketAvailability(): Promise<boolean> {
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
    })
  }

  /**
   * Attempt to upgrade from Fetch to WebSocket
   * Used by auto-upgrade strategy
   */
  private async attemptUpgrade(): Promise<boolean> {
    if (this.closed || this.activeTransportType === 'websocket') {
      return false
    }

    try {
      const available = await this.checkWebSocketAvailability()

      if (!available || this.closed) {
        return false
      }

      await this.initWebSocket()
      // Re-check after async operation - activeTransportType may have changed
      return (this.activeTransportType as ActiveTransportType) === 'websocket'
    } catch {
      return false
    }
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
    // Wait for initialization to complete
    if (this.initPromise) {
      await this.initPromise
      this.initPromise = null
    }

    if (this.closed) {
      return {
        error: {
          type: 'TransportError',
          code: 'TRANSPORT_CLOSED',
          message: 'Transport has been closed',
        },
        correlationId: message.correlationId ?? generateCorrelationId(),
      }
    }

    if (!this.activeTransport) {
      return {
        error: {
          type: 'TransportError',
          code: 'NO_TRANSPORT',
          message: 'No transport available',
        },
        correlationId: message.correlationId ?? generateCorrelationId(),
      }
    }

    return this.activeTransport.send<T>(message)
  }

  /**
   * Close all transports
   */
  async close(): Promise<void> {
    this.closed = true
    this.state = TransportState.CLOSED

    // Close all transports
    const closePromises: Promise<void>[] = []

    if (this.wsTransport?.close) {
      closePromises.push(this.wsTransport.close())
    }

    // FetchTransport doesn't need explicit closing

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
  addEventListener(listener: TransportEventListener): () => void {
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
    return this.state === TransportState.CONNECTED
  }
}

/**
 * Create an auto transport (convenience function)
 *
 * @example
 * ```typescript
 * const transport = createAutoTransport({
 *   url: 'https://api.example.com',
 *   strategy: 'websocket-first',
 * })
 * ```
 */
export function createAutoTransport(options: AutoTransportOptions): AutoTransport {
  return new AutoTransport(options)
}
