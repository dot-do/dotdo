// WebSocket Transport - Real-time bidirectional RPC transport
// Used for long-lived connections with push capabilities

import { generateCorrelationId } from '../client'
import { type SerializedError } from '../errors'
import type {
  Transport,
  TransportOptions,
  RPCMessage,
  RPCResponse,
  TransportState,
  TransportEvent,
  TransportEventListener,
} from './types'

/**
 * Options for the WebSocket transport
 */
export interface WebSocketTransportOptions extends TransportOptions {
  /** WebSocket URL (ws:// or wss://) */
  url: string
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean
  /** Maximum reconnection attempts (default: 5) */
  maxReconnectAttempts?: number
  /** Initial reconnection delay in ms (default: 1000) */
  reconnectDelay?: number
  /** Maximum reconnection delay in ms (default: 30000) */
  maxReconnectDelay?: number
  /** Custom WebSocket implementation (for testing) */
  WebSocket?: typeof WebSocket
}

/**
 * Pending request waiting for response
 */
interface PendingRequest {
  resolve: (response: RPCResponse<unknown>) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

/**
 * WebSocket message format
 */
interface WebSocketMessage {
  id: string
  method?: string
  args?: unknown[]
  result?: unknown
  error?: SerializedError
}

/**
 * WebSocket Transport - maintains persistent connection for RPC
 *
 * This transport is ideal for:
 * - Real-time applications
 * - High-frequency RPC calls
 * - Server push notifications
 *
 * Features:
 * - Automatic reconnection with exponential backoff
 * - Request/response correlation
 * - Connection state tracking
 * - Event-based notification of state changes
 *
 * @example
 * ```typescript
 * const transport = new WebSocketTransport({
 *   url: 'wss://api.example.com/ws',
 *   autoReconnect: true,
 * })
 *
 * // Listen for connection events
 * transport.addEventListener((event) => {
 *   if (event.type === 'disconnect') {
 *     console.log('Disconnected, will reconnect...')
 *   }
 * })
 *
 * // Send RPC message
 * const response = await transport.send({
 *   method: 'subscribe',
 *   args: ['events:user-123'],
 * })
 *
 * // Clean up when done
 * await transport.close()
 * ```
 */
export class WebSocketTransport implements Transport {
  private readonly url: string
  private readonly timeout: number
  private readonly baseCorrelationId?: string
  private readonly autoReconnect: boolean
  private readonly maxReconnectAttempts: number
  private readonly reconnectDelay: number
  private readonly maxReconnectDelay: number
  private readonly WebSocketImpl: typeof WebSocket

  private ws: WebSocket | null = null
  private state: TransportState = 'DISCONNECTED' as TransportState
  private pendingRequests = new Map<string, PendingRequest>()
  private eventListeners = new Set<TransportEventListener>()
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private connectPromise: Promise<void> | null = null

  constructor(options: WebSocketTransportOptions) {
    this.url = options.url
    this.timeout = options.timeout ?? 30000
    if (options.correlationId !== undefined) {
      this.baseCorrelationId = options.correlationId
    }
    this.autoReconnect = options.autoReconnect ?? true
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 5
    this.reconnectDelay = options.reconnectDelay ?? 1000
    this.maxReconnectDelay = options.maxReconnectDelay ?? 30000
    this.WebSocketImpl = options.WebSocket ?? globalThis.WebSocket
  }

  /**
   * Connect to WebSocket server
   */
  private connect(): Promise<void> {
    // Return existing connection promise if connecting
    if (this.connectPromise) {
      return this.connectPromise
    }

    // Already connected
    if (this.state === ('CONNECTED' as TransportState) && this.ws?.readyState === WebSocket.OPEN) {
      return Promise.resolve()
    }

    this.state = 'CONNECTING' as TransportState

    this.connectPromise = new Promise<void>((resolve, reject) => {
      try {
        this.ws = new this.WebSocketImpl(this.url)
      } catch (error) {
        this.state = 'DISCONNECTED' as TransportState
        this.connectPromise = null
        reject(error)
        return
      }

      const onOpen = () => {
        cleanup()
        this.state = 'CONNECTED' as TransportState
        this.reconnectAttempts = 0
        this.connectPromise = null
        this.emit({ type: 'connect' })
        resolve()
      }

      const onError = (_event: Event) => {
        cleanup()
        this.state = 'DISCONNECTED' as TransportState
        this.connectPromise = null
        const error = new Error('WebSocket connection failed')
        this.emit({ type: 'error', error })
        reject(error)
      }

      const onClose = () => {
        cleanup()
        this.handleDisconnect()
      }

      const onMessage = (event: MessageEvent) => {
        this.handleMessage(event.data)
      }

      const cleanup = () => {
        if (this.ws) {
          this.ws.removeEventListener('open', onOpen)
          this.ws.removeEventListener('error', onError)
          this.ws.removeEventListener('close', onClose)
        }
      }

      this.ws.addEventListener('open', onOpen)
      this.ws.addEventListener('error', onError)
      this.ws.addEventListener('close', onClose)
      this.ws.addEventListener('message', onMessage)
    })

    return this.connectPromise
  }

  /**
   * Handle WebSocket disconnection
   */
  private handleDisconnect(): void {
    const wasConnected = this.state === ('CONNECTED' as TransportState)
    this.state = 'DISCONNECTED' as TransportState
    this.connectPromise = null

    // Reject all pending requests
    for (const [_id, request] of this.pendingRequests) {
      clearTimeout(request.timeout)
      request.reject(new Error('WebSocket disconnected'))
    }
    this.pendingRequests.clear()

    if (wasConnected) {
      this.emit({ type: 'disconnect' })
    }

    // Auto-reconnect if enabled
    if (this.autoReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
      this.scheduleReconnect()
    }
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
    }

    // Calculate delay with exponential backoff
    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay
    )

    this.reconnectAttempts++

    this.reconnectTimer = setTimeout(async () => {
      this.emit({ type: 'reconnect', attempt: this.reconnectAttempts })
      try {
        await this.connect()
      } catch {
        // Error already handled in connect()
      }
    }, delay)
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(data: string): void {
    let message: WebSocketMessage
    try {
      message = JSON.parse(data)
    } catch {
      // Invalid JSON, ignore
      return
    }

    // Handle response to pending request
    const pending = this.pendingRequests.get(message.id)
    if (pending) {
      clearTimeout(pending.timeout)
      this.pendingRequests.delete(message.id)

      if (message.error) {
        pending.resolve({
          error: message.error,
          correlationId: message.id,
        })
      } else {
        pending.resolve({
          result: message.result,
          correlationId: message.id,
        })
      }
    }
  }

  /**
   * Emit event to all listeners
   */
  private emit(event: TransportEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event)
      } catch {
        // Ignore listener errors
      }
    }
  }

  /**
   * Send an RPC message via WebSocket
   */
  async send<T = unknown>(message: RPCMessage): Promise<RPCResponse<T>> {
    // Ensure connected
    await this.connect()

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      const correlationId = message.correlationId ?? this.baseCorrelationId ?? generateCorrelationId()
      return {
        error: {
          type: 'NetworkError',
          code: 'NETWORK_ERROR',
          message: 'WebSocket not connected',
        },
        correlationId,
      }
    }

    const id = message.correlationId ?? this.baseCorrelationId ?? generateCorrelationId()

    return new Promise<RPCResponse<T>>((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
        resolve({
          error: {
            type: 'TimeoutError',
            code: 'TIMEOUT',
            message: `Request timed out after ${this.timeout}ms`,
            details: { timeout: this.timeout },
          },
          correlationId: id,
        })
      }, this.timeout)

      // Store pending request - cast resolve to handle generic type covariance
      this.pendingRequests.set(id, {
        resolve: resolve as (response: RPCResponse<unknown>) => void,
        reject,
        timeout,
      })

      // Send message
      const wsMessage: WebSocketMessage = {
        id,
        method: message.method,
        args: message.args,
      }

      try {
        this.ws!.send(JSON.stringify(wsMessage))
      } catch (error) {
        clearTimeout(timeout)
        this.pendingRequests.delete(id)
        resolve({
          error: {
            type: 'NetworkError',
            code: 'NETWORK_ERROR',
            message: 'Failed to send WebSocket message',
          },
          correlationId: id,
        })
      }
    })
  }

  /**
   * Close the WebSocket connection
   */
  async close(): Promise<void> {
    this.state = 'CLOSED' as TransportState

    // Cancel reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    // Reject all pending requests
    for (const [_id, request] of this.pendingRequests) {
      clearTimeout(request.timeout)
      request.reject(new Error('Transport closed'))
    }
    this.pendingRequests.clear()

    // Close WebSocket
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }

    this.connectPromise = null
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
   * Check if connected
   */
  isConnected(): boolean {
    return this.state === ('CONNECTED' as TransportState) && this.ws?.readyState === WebSocket.OPEN
  }
}

/**
 * Create a WebSocket transport (convenience function)
 */
export function createWebSocketTransport(options: WebSocketTransportOptions): WebSocketTransport {
  return new WebSocketTransport(options)
}
