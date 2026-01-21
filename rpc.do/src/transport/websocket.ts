/**
 * @module rpc.do/transport/websocket
 *
 * WebSocket-based RPC transport for real-time bidirectional communication.
 *
 * This module provides a stateful WebSocket transport that maintains persistent
 * connections for low-latency RPC calls. It supports automatic reconnection,
 * message queuing during disconnection, heartbeat/ping-pong, and request timeouts.
 *
 * @example Basic usage
 * ```typescript
 * import { WebSocketTransport, createWebSocketTransport } from 'rpc.do'
 *
 * // Using the class
 * const transport = new WebSocketTransport({
 *   url: 'wss://api.example.com/rpc',
 *   reconnect: true,
 *   timeout: 5000,
 * })
 *
 * // Or using the factory function
 * const transport = createWebSocketTransport({ url: 'wss://api.example.com/rpc' })
 *
 * await transport.connect()
 *
 * const response = await transport.send({
 *   method: 'users.create',
 *   args: [{ name: 'Alice' }],
 * })
 * ```
 *
 * @example With event handling
 * ```typescript
 * const transport = new WebSocketTransport({
 *   url: 'wss://api.example.com/rpc',
 *   reconnect: true,
 * })
 *
 * transport.addEventListener((event) => {
 *   switch (event.type) {
 *     case 'connect':
 *       console.log('Connected!')
 *       break
 *     case 'disconnect':
 *       console.log('Disconnected!')
 *       break
 *     case 'error':
 *       console.error('Error:', event.error)
 *       break
 *     case 'reconnect':
 *       console.log(`Reconnect attempt ${event.attempt}`)
 *       break
 *   }
 * })
 * ```
 */

import type { RPCMessage, RPCResponse, SerializedError } from '../types'
import type { Transport, TransportEventListener, TransportEvent } from './types'
import { TransportState } from './types'
import { generateCorrelationId } from './fetch'

/**
 * Default timeout for RPC requests in milliseconds.
 */
export const DEFAULT_TIMEOUT = 30000

/**
 * Default reconnect interval in milliseconds.
 */
export const DEFAULT_RECONNECT_INTERVAL = 1000

/**
 * Default maximum reconnect attempts.
 */
export const DEFAULT_MAX_RECONNECT_ATTEMPTS = 10

/**
 * Options for the WebSocket transport.
 */
export interface WebSocketTransportOptions {
  /**
   * WebSocket URL to connect to.
   * Should use wss:// for secure connections.
   */
  url: string

  /**
   * Whether to automatically reconnect on disconnect.
   * @default true
   */
  reconnect?: boolean

  /**
   * Interval between reconnect attempts in milliseconds.
   * @default 1000
   */
  reconnectInterval?: number

  /**
   * Maximum number of reconnect attempts before giving up.
   * @default 10
   */
  maxReconnectAttempts?: number

  /**
   * Request timeout in milliseconds.
   * @default 30000
   */
  timeout?: number

  /**
   * Heartbeat/ping interval in milliseconds.
   * Set to 0 to disable heartbeat.
   * @default 0 (disabled)
   */
  heartbeatInterval?: number

  /**
   * Timeout for pong response after ping in milliseconds.
   * @default 5000
   */
  heartbeatTimeout?: number

  /**
   * Custom WebSocket constructor (for testing or polyfills).
   */
  WebSocket?: typeof globalThis.WebSocket
}

/**
 * Internal message format for WebSocket RPC.
 */
interface WebSocketRPCMessage {
  id: string
  method: string
  args: unknown[]
  correlationId?: string
  type?: 'ping' | 'pong'
}

/**
 * Internal response format for WebSocket RPC.
 */
interface WebSocketRPCResponse {
  id: string
  result?: unknown
  error?: SerializedError
  correlationId?: string
  type?: 'ping' | 'pong'
}

/**
 * Pending request with resolve/reject callbacks.
 */
interface PendingRequest {
  resolve: (response: RPCResponse) => void
  reject: (error: Error) => void
  timeoutId?: ReturnType<typeof setTimeout>
  correlationId?: string
}

/**
 * Queued message waiting to be sent.
 */
interface QueuedMessage {
  message: WebSocketRPCMessage
  resolve: (response: RPCResponse) => void
  reject: (error: Error) => void
  correlationId?: string
}

/**
 * WebSocket Transport - sends RPC messages over WebSocket.
 *
 * This transport is ideal for:
 * - Real-time bidirectional communication
 * - Low-latency RPC calls
 * - Applications requiring push notifications
 *
 * Features:
 * - Automatic reconnection with configurable backoff
 * - Message queuing during disconnection
 * - Heartbeat/ping-pong for connection health
 * - Request timeouts
 * - Event-based connection state notifications
 */
export class WebSocketTransport implements Transport {
  private readonly url: string
  private readonly shouldReconnect: boolean
  private readonly reconnectInterval: number
  private readonly maxReconnectAttempts: number
  private readonly timeout: number
  private readonly heartbeatInterval: number
  private readonly heartbeatTimeout: number
  private readonly WebSocketImpl: typeof globalThis.WebSocket

  private ws: WebSocket | null = null
  private state: TransportState = TransportState.DISCONNECTED
  private pendingRequests: Map<string, PendingRequest> = new Map()
  private messageQueue: QueuedMessage[] = []
  private eventListeners: Set<TransportEventListener> = new Set()
  private reconnectAttempts = 0
  private reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null
  private connectPromise: Promise<void> | null = null
  private connectResolve: (() => void) | null = null
  private connectReject: ((error: Error) => void) | null = null
  private heartbeatIntervalId: ReturnType<typeof setInterval> | null = null
  private heartbeatTimeoutId: ReturnType<typeof setTimeout> | null = null
  private explicitClose = false

  constructor(options: WebSocketTransportOptions) {
    this.url = options.url
    this.shouldReconnect = options.reconnect ?? true
    this.reconnectInterval = options.reconnectInterval ?? DEFAULT_RECONNECT_INTERVAL
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT
    this.heartbeatInterval = options.heartbeatInterval ?? 0
    this.heartbeatTimeout = options.heartbeatTimeout ?? 5000
    this.WebSocketImpl = options.WebSocket ?? globalThis.WebSocket
  }

  /**
   * Connect to the WebSocket server.
   *
   * @returns Promise that resolves when connected
   * @throws Error if connection fails
   */
  async connect(): Promise<void> {
    // Already connected
    if (this.state === TransportState.CONNECTED) {
      return
    }

    // Connection in progress
    if (this.state === TransportState.CONNECTING && this.connectPromise) {
      return this.connectPromise
    }

    // Cannot reconnect after explicit close
    if (this.state === TransportState.CLOSED) {
      throw new Error('Transport has been closed')
    }

    this.state = TransportState.CONNECTING
    this.connectPromise = new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve
      this.connectReject = reject
    })

    this.setupWebSocket()

    return this.connectPromise
  }

  /**
   * Set up WebSocket connection and event handlers.
   */
  private setupWebSocket(): void {
    this.ws = new this.WebSocketImpl(this.url)

    this.ws.onopen = () => {
      this.state = TransportState.CONNECTED
      this.reconnectAttempts = 0

      // Emit connect event
      this.emitEvent({ type: 'connect' })

      // Start heartbeat if configured
      this.startHeartbeat()

      // Resolve connect promise
      if (this.connectResolve) {
        this.connectResolve()
        this.connectResolve = null
        this.connectReject = null
        this.connectPromise = null
      }

      // Flush queued messages
      this.flushQueue()
    }

    this.ws.onclose = (event) => {
      this.stopHeartbeat()

      // If we explicitly closed, set state to CLOSED
      if (this.explicitClose) {
        this.state = TransportState.CLOSED
        this.rejectPendingRequests('CONNECTION_CLOSED', 'Connection closed')
        this.emitEvent({ type: 'disconnect' })
        return
      }

      this.state = TransportState.DISCONNECTED
      this.emitEvent({ type: 'disconnect' })

      // Reject connect promise if still pending
      if (this.connectReject) {
        this.connectReject(new Error(`WebSocket closed: ${event.code} ${event.reason}`))
        this.connectResolve = null
        this.connectReject = null
        this.connectPromise = null
      }

      // Attempt reconnection
      if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.scheduleReconnect()
      }
    }

    this.ws.onerror = () => {
      this.emitEvent({ type: 'error', error: new Error('WebSocket error') })
    }

    this.ws.onmessage = (event) => {
      this.handleMessage(event.data as string)
    }
  }

  /**
   * Handle incoming WebSocket message.
   */
  private handleMessage(data: string): void {
    let response: WebSocketRPCResponse
    try {
      response = JSON.parse(data) as WebSocketRPCResponse
    } catch {
      // Invalid JSON, ignore
      return
    }

    // Handle pong response
    if (response.type === 'pong') {
      this.handlePong()
      return
    }

    // Find pending request
    const pending = this.pendingRequests.get(response.id)
    if (!pending) {
      // No matching request, ignore
      return
    }

    // Clear timeout
    if (pending.timeoutId) {
      clearTimeout(pending.timeoutId)
    }

    // Remove from pending
    this.pendingRequests.delete(response.id)

    // Resolve with response
    if (response.error) {
      pending.resolve({
        error: response.error,
        correlationId: response.correlationId ?? pending.correlationId,
      })
    } else {
      pending.resolve({
        result: response.result,
        correlationId: response.correlationId ?? pending.correlationId,
      })
    }
  }

  /**
   * Send an RPC message over WebSocket.
   *
   * @param message - The RPC message to send
   * @returns Promise resolving to the RPC response
   */
  async send<T = unknown>(message: RPCMessage): Promise<RPCResponse<T>> {
    const id = generateCorrelationId()
    const correlationId = message.correlationId ?? generateCorrelationId()

    const wsMessage: WebSocketRPCMessage = {
      id,
      method: message.method,
      args: message.args,
      correlationId,
    }

    return new Promise<RPCResponse<T>>((resolve, reject) => {
      // If not connected, queue the message and start connecting
      if (this.state !== TransportState.CONNECTED) {
        this.messageQueue.push({
          message: wsMessage,
          resolve: resolve as (response: RPCResponse) => void,
          reject,
          correlationId,
        })

        // Start connecting if not already and not waiting to reconnect
        if (this.state === TransportState.DISCONNECTED && !this.reconnectTimeoutId) {
          this.connect().catch(() => {
            // Connection failure will be handled by queue flush
          })
        }
        return
      }

      // Set up pending request with timeout
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(id)
        resolve({
          error: {
            type: 'TimeoutError',
            code: 'TIMEOUT',
            message: `Request timed out after ${this.timeout}ms`,
          },
          correlationId,
        })
      }, this.timeout)

      this.pendingRequests.set(id, {
        resolve: resolve as (response: RPCResponse) => void,
        reject,
        timeoutId,
        correlationId,
      })

      // Send the message
      this.ws!.send(JSON.stringify(wsMessage))
    })
  }

  /**
   * Close the WebSocket connection.
   *
   * @returns Promise that resolves when closed
   */
  async close(): Promise<void> {
    // Already closed
    if (this.state === TransportState.CLOSED) {
      return
    }

    this.explicitClose = true
    this.stopHeartbeat()
    this.cancelReconnect()

    // Reject pending requests
    this.rejectPendingRequests('CONNECTION_CLOSED', 'Connection closed by client')

    // Clear queue
    for (const queued of this.messageQueue) {
      queued.resolve({
        error: {
          type: 'TransportError',
          code: 'CONNECTION_CLOSED',
          message: 'Connection closed by client',
        },
        correlationId: queued.correlationId,
      })
    }
    this.messageQueue = []

    // Close WebSocket
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
      this.ws.close(1000, 'Client closing')
    }

    this.state = TransportState.CLOSED
  }

  /**
   * Get the current state of the transport.
   */
  getState(): TransportState {
    return this.state
  }

  /**
   * Add an event listener for transport events.
   *
   * @param listener - Function to call when events occur
   * @returns Function to remove the listener
   */
  addEventListener(listener: TransportEventListener): () => void {
    this.eventListeners.add(listener)
    return () => {
      this.eventListeners.delete(listener)
    }
  }

  /**
   * Emit an event to all listeners.
   */
  private emitEvent(event: TransportEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event)
      } catch {
        // Ignore listener errors
      }
    }
  }

  /**
   * Reject all pending requests with an error.
   */
  private rejectPendingRequests(code: string, message: string): void {
    for (const [id, pending] of this.pendingRequests) {
      if (pending.timeoutId) {
        clearTimeout(pending.timeoutId)
      }
      pending.resolve({
        error: {
          type: 'TransportError',
          code,
          message,
        },
        correlationId: pending.correlationId,
      })
    }
    this.pendingRequests.clear()
  }

  /**
   * Schedule a reconnection attempt.
   */
  private scheduleReconnect(): void {
    this.reconnectTimeoutId = setTimeout(() => {
      this.reconnectAttempts++
      this.emitEvent({ type: 'reconnect', attempt: this.reconnectAttempts })

      this.state = TransportState.CONNECTING
      this.connectPromise = new Promise<void>((resolve, reject) => {
        this.connectResolve = resolve
        this.connectReject = reject
      })

      // Silently catch reconnect failures - they're handled via onclose
      this.connectPromise.catch(() => {
        // Reconnect failure is expected during reconnect attempts
      })

      this.setupWebSocket()
    }, this.reconnectInterval)
  }

  /**
   * Cancel scheduled reconnection.
   */
  private cancelReconnect(): void {
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId)
      this.reconnectTimeoutId = null
    }
  }

  /**
   * Flush queued messages.
   */
  private flushQueue(): void {
    // Verify WebSocket is open before flushing
    // WebSocket.OPEN = 1
    if (!this.ws || this.ws.readyState !== 1) {
      return
    }

    const queue = this.messageQueue
    this.messageQueue = []

    for (const queued of queue) {
      // Set up pending request with timeout
      const id = queued.message.id
      const correlationId = queued.correlationId

      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(id)
        queued.resolve({
          error: {
            type: 'TimeoutError',
            code: 'TIMEOUT',
            message: `Request timed out after ${this.timeout}ms`,
          },
          correlationId,
        })
      }, this.timeout)

      this.pendingRequests.set(id, {
        resolve: queued.resolve,
        reject: queued.reject,
        timeoutId,
        correlationId,
      })

      // Send the message
      this.ws.send(JSON.stringify(queued.message))
    }
  }

  /**
   * Start heartbeat/ping-pong.
   */
  private startHeartbeat(): void {
    if (this.heartbeatInterval <= 0) {
      return
    }

    this.heartbeatIntervalId = setInterval(() => {
      this.sendPing()
    }, this.heartbeatInterval)
  }

  /**
   * Stop heartbeat.
   */
  private stopHeartbeat(): void {
    if (this.heartbeatIntervalId) {
      clearInterval(this.heartbeatIntervalId)
      this.heartbeatIntervalId = null
    }
    if (this.heartbeatTimeoutId) {
      clearTimeout(this.heartbeatTimeoutId)
      this.heartbeatTimeoutId = null
    }
  }

  /**
   * Send a ping message.
   */
  private sendPing(): void {
    if (this.state !== TransportState.CONNECTED || !this.ws) {
      return
    }

    const pingMessage: WebSocketRPCMessage = {
      id: generateCorrelationId(),
      method: '',
      args: [],
      type: 'ping',
    }

    this.ws.send(JSON.stringify(pingMessage))

    // Set up pong timeout
    this.heartbeatTimeoutId = setTimeout(() => {
      // No pong received, disconnect
      this.ws?.close(4000, 'Heartbeat timeout')
    }, this.heartbeatTimeout)
  }

  /**
   * Handle pong response.
   */
  private handlePong(): void {
    if (this.heartbeatTimeoutId) {
      clearTimeout(this.heartbeatTimeoutId)
      this.heartbeatTimeoutId = null
    }
  }
}

/**
 * Create a WebSocket transport (convenience factory function).
 *
 * This is a convenience wrapper around `new WebSocketTransport(options)` for
 * functional programming styles or dependency injection.
 *
 * @param options - Configuration options for the transport
 * @returns A new WebSocketTransport instance
 *
 * @example
 * ```typescript
 * import { createWebSocketTransport, createClient } from 'rpc.do'
 *
 * const transport = createWebSocketTransport({
 *   url: 'wss://api.example.com/rpc',
 *   reconnect: true,
 *   timeout: 10000,
 * })
 *
 * await transport.connect()
 * const client = createClient<MyAPI>('wss://api.example.com', { transport })
 * ```
 */
export function createWebSocketTransport(options: WebSocketTransportOptions): WebSocketTransport {
  return new WebSocketTransport(options)
}
