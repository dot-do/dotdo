// WebSocket Transport - Real-time bidirectional RPC transport
// Used for long-lived connections with push capabilities
// Supports event subscriptions for remote $.on handlers (do-9zknf)

import { generateCorrelationId } from '../headers'
import { type SerializedError, ErrorCode } from '../errors'
import type {
  Transport,
  TransportOptions,
  RPCMessage,
  RPCResponse,
  TransportState,
  TransportEvent,
  TransportEventListener,
  ErrorInterceptor,
} from './types'
import {
  createNetworkError,
  createTimeoutError,
  createErrorContext,
  applyErrorInterceptor,
  createNormalizedError,
} from './error-utils'
import {
  DEFAULT_RPC_TIMEOUT_MS,
  DEFAULT_RECONNECT_DELAY_MS,
  DEFAULT_MAX_RECONNECT_DELAY_MS,
  DEFAULT_MAX_RECONNECT_ATTEMPTS,
} from '@dotdo/utils'

/**
 * Event handler type for remote event subscriptions
 * Receives the event type and payload from the server
 */
export type RemoteEventHandler<T = unknown> = (event: { type: string; payload: T; $id: string; $timestamp: number }) => void | Promise<void>

/**
 * Event subscription message from client to server
 */
export interface EventSubscriptionMessage {
  type: 'subscribe' | 'unsubscribe'
  /** Event pattern to subscribe to (e.g., 'Customer.signup', 'Order.*', '*.created') */
  event: string
  /** Unique subscription ID for tracking */
  subscriptionId: string
}

/**
 * Event push message from server to client
 */
export interface EventPushMessage {
  type: 'event'
  /** Event type (e.g., 'Customer.signup') */
  event: string
  /** Event payload */
  payload: unknown
  /** Unique event ID */
  $id: string
  /** Event timestamp */
  $timestamp: number
}

/**
 * Subscription acknowledgment from server
 */
export interface SubscriptionAckMessage {
  type: 'subscribed' | 'unsubscribed'
  /** Subscription ID being acknowledged */
  subscriptionId: string
  /** Event pattern that was subscribed/unsubscribed */
  event: string
  /** Error if subscription failed */
  error?: SerializedError
}

/**
 * Options for the WebSocket transport
 */
export interface WebSocketTransportOptions extends TransportOptions {
  /** WebSocket URL (ws:// or wss://) */
  url: string
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean
  /** Maximum reconnection attempts (default: DEFAULT_MAX_RECONNECT_ATTEMPTS = 5) */
  maxReconnectAttempts?: number
  /** Initial reconnection delay in ms (default: DEFAULT_RECONNECT_DELAY_MS = 1000) */
  reconnectDelay?: number
  /** Maximum reconnection delay in ms (default: DEFAULT_MAX_RECONNECT_DELAY_MS = 30000) */
  maxReconnectDelay?: number
  /** Custom WebSocket implementation (for testing) */
  WebSocket?: typeof WebSocket
  /** Heartbeat ping interval in ms (0 or undefined to disable, default: disabled) */
  heartbeatInterval?: number
  /** Heartbeat timeout in ms - close connection if no pong received (default: 2x heartbeatInterval) */
  heartbeatTimeout?: number
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
 * WebSocket message format for RPC
 */
interface WebSocketMessage {
  id: string
  method?: string
  args?: unknown[]
  result?: unknown
  error?: SerializedError
}

/**
 * Combined message type for all WebSocket messages
 */
type WebSocketIncomingMessage = WebSocketMessage | EventPushMessage | SubscriptionAckMessage

/**
 * Tracked subscription for reconnection
 */
interface TrackedSubscription {
  event: string
  handler: RemoteEventHandler
  subscriptionId: string
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
 * - Heartbeat/keepalive support for connection health monitoring
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
  private readonly heartbeatInterval: number
  private readonly heartbeatTimeout: number
  private readonly onError?: ErrorInterceptor

  private ws: WebSocket | null = null
  private state: TransportState = 'DISCONNECTED' as TransportState
  private pendingRequests = new Map<string, PendingRequest>()
  private eventListeners = new Set<TransportEventListener>()
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private connectPromise: Promise<void> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private heartbeatTimeoutTimer: ReturnType<typeof setTimeout> | null = null
  private lastPongTime: number = 0

  // Event subscription tracking (do-9zknf)
  private subscriptions = new Map<string, TrackedSubscription>()
  private eventHandlers = new Map<string, Set<RemoteEventHandler>>()
  private pendingSubscriptions = new Map<string, { resolve: () => void; reject: (error: Error) => void }>()

  constructor(options: WebSocketTransportOptions) {
    this.url = options.url
    this.timeout = options.timeout ?? DEFAULT_RPC_TIMEOUT_MS
    if (options.correlationId !== undefined) {
      this.baseCorrelationId = options.correlationId
    }
    this.autoReconnect = options.autoReconnect ?? true
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS
    this.reconnectDelay = options.reconnectDelay ?? DEFAULT_RECONNECT_DELAY_MS
    this.maxReconnectDelay = options.maxReconnectDelay ?? DEFAULT_MAX_RECONNECT_DELAY_MS
    this.WebSocketImpl = options.WebSocket ?? globalThis.WebSocket
    this.heartbeatInterval = options.heartbeatInterval ?? 0
    this.heartbeatTimeout = options.heartbeatTimeout ?? (this.heartbeatInterval * 2)
    this.onError = options.onError
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
        cleanupConnectListeners()
        this.state = 'CONNECTED' as TransportState
        this.reconnectAttempts = 0
        this.connectPromise = null
        this.startHeartbeat()
        this.emit({ type: 'connect' })

        // Resubscribe to events after reconnection (do-9zknf)
        if (this.subscriptions.size > 0) {
          this.resubscribeAll().catch((err) => {
            this.emit({ type: 'error', error: err instanceof Error ? err : new Error(String(err)) })
          })
        }

        resolve()
      }

      const onError = (_event: Event) => {
        cleanupConnectListeners()
        this.state = 'DISCONNECTED' as TransportState
        this.connectPromise = null
        const error = new Error('WebSocket connection failed')
        this.emit({ type: 'error', error })
        reject(error)
      }

      const onClose = () => {
        // Only clean up if we haven't connected yet (connection failed)
        if (this.state !== ('CONNECTED' as TransportState)) {
          cleanupConnectListeners()
        }
        this.handleDisconnect()
      }

      const onMessage = (event: MessageEvent) => {
        this.handleMessage(event.data)
      }

      // Clean up only the connection establishment listeners (open/error)
      // Keep close and message listeners for the lifetime of the connection
      const cleanupConnectListeners = () => {
        if (this.ws) {
          this.ws.removeEventListener('open', onOpen)
          this.ws.removeEventListener('error', onError)
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
    // Skip if we're already closed (explicit close was called)
    if (this.state === ('CLOSED' as TransportState)) {
      return
    }

    const wasConnected = this.state === ('CONNECTED' as TransportState)
    this.state = 'DISCONNECTED' as TransportState
    this.connectPromise = null

    // Stop heartbeat
    this.stopHeartbeat()

    // Resolve pending requests with error response (not reject, to match send() signature)
    for (const [id, request] of this.pendingRequests) {
      clearTimeout(request.timeout)
      // Use resolve with error response to be consistent with timeout behavior
      const error = createNetworkError('WebSocket disconnected', 'websocket', {
        endpoint: this.url,
        reason: 'disconnected',
      })
      request.resolve({
        error,
        correlationId: id,
      })
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
   * Start heartbeat timer
   */
  private startHeartbeat(): void {
    if (this.heartbeatInterval <= 0) {
      return
    }

    this.stopHeartbeat()
    this.lastPongTime = Date.now()

    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat()
    }, this.heartbeatInterval)
  }

  /**
   * Stop heartbeat timer
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer)
      this.heartbeatTimeoutTimer = null
    }
  }

  /**
   * Send heartbeat ping and set up timeout
   */
  private sendHeartbeat(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return
    }

    const pingId = generateCorrelationId()

    // Set up timeout for heartbeat response
    this.heartbeatTimeoutTimer = setTimeout(() => {
      // Heartbeat timeout - close connection
      this.emit({ type: 'error', error: new Error('Heartbeat timeout') })
      if (this.ws) {
        this.ws.close()
      }
      this.handleDisconnect()
    }, this.heartbeatTimeout)

    // Send ping message
    const pingMessage: WebSocketMessage = {
      id: pingId,
      method: '$ping',
      args: [{ timestamp: Date.now() }],
    }

    // Track the ping request to clear timeout on response
    this.pendingRequests.set(pingId, {
      resolve: (_response) => {
        // Clear heartbeat timeout on successful pong
        if (this.heartbeatTimeoutTimer) {
          clearTimeout(this.heartbeatTimeoutTimer)
          this.heartbeatTimeoutTimer = null
        }
        this.lastPongTime = Date.now()
      },
      reject: () => {
        // Timeout handled separately
      },
      timeout: setTimeout(() => {
        this.pendingRequests.delete(pingId)
      }, this.heartbeatTimeout),
    })

    try {
      this.ws.send(JSON.stringify(pingMessage))
    } catch {
      // Send failed, connection is likely dead
      if (this.heartbeatTimeoutTimer) {
        clearTimeout(this.heartbeatTimeoutTimer)
        this.heartbeatTimeoutTimer = null
      }
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
    let message: WebSocketIncomingMessage
    try {
      message = JSON.parse(data)
    } catch {
      // Invalid JSON, ignore
      return
    }

    // Handle event push messages (do-9zknf)
    if ('type' in message && message.type === 'event') {
      this.handleEventPush(message as EventPushMessage)
      return
    }

    // Handle subscription acknowledgments (do-9zknf)
    if ('type' in message && (message.type === 'subscribed' || message.type === 'unsubscribed')) {
      this.handleSubscriptionAck(message as SubscriptionAckMessage)
      return
    }

    // Handle response to pending request
    const rpcMessage = message as WebSocketMessage
    const pending = this.pendingRequests.get(rpcMessage.id)
    if (pending) {
      clearTimeout(pending.timeout)
      this.pendingRequests.delete(rpcMessage.id)

      if (rpcMessage.error) {
        pending.resolve({
          error: rpcMessage.error,
          correlationId: rpcMessage.id,
        })
      } else {
        pending.resolve({
          result: rpcMessage.result,
          correlationId: rpcMessage.id,
        })
      }
    }
  }

  /**
   * Handle incoming event push from server (do-9zknf)
   */
  private handleEventPush(message: EventPushMessage): void {
    const eventType = message.event
    const eventData = {
      type: eventType,
      payload: message.payload,
      $id: message.$id,
      $timestamp: message.$timestamp,
    }

    // Find all matching handlers (exact match and wildcards)
    const handlersToInvoke: RemoteEventHandler[] = []

    // Check exact match
    const exactHandlers = this.eventHandlers.get(eventType)
    if (exactHandlers) {
      handlersToInvoke.push(...exactHandlers)
    }

    // Check noun wildcard (e.g., 'Customer.*' matches 'Customer.signup')
    const [noun, verb] = eventType.split('.')
    if (noun && verb) {
      const nounWildHandlers = this.eventHandlers.get(`${noun}.*`)
      if (nounWildHandlers) {
        handlersToInvoke.push(...nounWildHandlers)
      }

      // Check verb wildcard (e.g., '*.signup' matches 'Customer.signup')
      const verbWildHandlers = this.eventHandlers.get(`*.${verb}`)
      if (verbWildHandlers) {
        handlersToInvoke.push(...verbWildHandlers)
      }
    }

    // Check global wildcard
    const globalWildHandlers = this.eventHandlers.get('*.*')
    if (globalWildHandlers) {
      handlersToInvoke.push(...globalWildHandlers)
    }

    // Invoke all handlers
    for (const handler of handlersToInvoke) {
      try {
        const result = handler(eventData)
        // Handle async handlers - errors are logged but don't propagate
        if (result instanceof Promise) {
          result.catch((err) => {
            // Silently handle handler errors - emit error event for debugging
            this.emit({ type: 'error', error: err instanceof Error ? err : new Error(String(err)) })
          })
        }
      } catch (err) {
        // Silently handle handler errors - emit error event for debugging
        this.emit({ type: 'error', error: err instanceof Error ? err : new Error(String(err)) })
      }
    }
  }

  /**
   * Handle subscription acknowledgment from server (do-9zknf)
   */
  private handleSubscriptionAck(message: SubscriptionAckMessage): void {
    const pending = this.pendingSubscriptions.get(message.subscriptionId)
    if (pending) {
      this.pendingSubscriptions.delete(message.subscriptionId)
      if (message.error) {
        pending.reject(new Error(message.error.message))
      } else {
        pending.resolve()
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
    const startTime = Date.now()

    // Ensure connected
    await this.connect()

    const correlationId = message.correlationId ?? this.baseCorrelationId ?? generateCorrelationId()

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      const error = createNetworkError('WebSocket not connected', 'websocket', {
        endpoint: this.url,
        reason: 'not_connected',
      })

      // Apply error interceptor
      const context = createErrorContext({
        transportType: 'websocket',
        message,
        correlationId,
        error,
        endpoint: this.url,
        startTime,
      })
      const finalError = applyErrorInterceptor(error, context, this.onError)

      return {
        error: finalError,
        correlationId,
      }
    }

    const id = correlationId

    return new Promise<RPCResponse<T>>((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id)

        const error = createTimeoutError(this.timeout, 'websocket')

        // Apply error interceptor
        const context = createErrorContext({
          transportType: 'websocket',
          message,
          correlationId: id,
          error,
          endpoint: this.url,
          startTime,
        })
        const finalError = applyErrorInterceptor(error, context, this.onError)

        resolve({
          error: finalError,
          correlationId: id,
        })
      }, this.timeout)

      // Store pending request - wrap resolve to apply error interceptor
      this.pendingRequests.set(id, {
        resolve: (response: RPCResponse<unknown>) => {
          // Apply error interceptor for server errors
          if (response.error && this.onError) {
            const context = createErrorContext({
              transportType: 'websocket',
              message,
              correlationId: id,
              error: response.error,
              endpoint: this.url,
              startTime,
            })
            response.error = applyErrorInterceptor(response.error, context, this.onError)
          }
          resolve(response as RPCResponse<T>)
        },
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
        // ws is guaranteed to be non-null here because we checked above
        // and the connect() call would have failed if ws was null
        if (this.ws) {
          this.ws.send(JSON.stringify(wsMessage))
        }
      } catch (error) {
        clearTimeout(timeout)
        this.pendingRequests.delete(id)

        const networkError = createNetworkError('Failed to send WebSocket message', 'websocket', {
          endpoint: this.url,
          reason: 'send_failed',
          originalError: error instanceof Error ? error.name : 'Unknown',
        })

        // Apply error interceptor
        const context = createErrorContext({
          transportType: 'websocket',
          message,
          correlationId: id,
          error: networkError,
          endpoint: this.url,
          startTime,
        })
        const finalError = applyErrorInterceptor(networkError, context, this.onError)

        resolve({
          error: finalError,
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

    // Stop heartbeat
    this.stopHeartbeat()

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

    // Clear subscriptions (do-9zknf)
    this.subscriptions.clear()
    this.eventHandlers.clear()
    for (const pending of this.pendingSubscriptions.values()) {
      pending.reject(new Error('Transport closed'))
    }
    this.pendingSubscriptions.clear()

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

  /**
   * Subscribe to remote events (do-9zknf)
   *
   * Subscribes to events matching the given pattern. The handler will be called
   * whenever a matching event is pushed from the server.
   *
   * @param eventPattern - Event pattern to subscribe to (e.g., 'Customer.signup', 'Order.*')
   * @param handler - Handler function to call when matching events are received
   * @returns Promise that resolves when subscription is acknowledged, with an unsubscribe function
   *
   * @example
   * ```typescript
   * const transport = new WebSocketTransport({ url: 'wss://api.example.com/ws' })
   *
   * // Subscribe to specific events
   * const unsubscribe = await transport.subscribe('Customer.signup', (event) => {
   *   console.log('Customer signed up:', event.payload)
   * })
   *
   * // Subscribe to all Order events
   * await transport.subscribe('Order.*', (event) => {
   *   console.log('Order event:', event.type, event.payload)
   * })
   *
   * // Later, unsubscribe
   * await unsubscribe()
   * ```
   */
  async subscribe<T = unknown>(
    eventPattern: string,
    handler: RemoteEventHandler<T>
  ): Promise<() => Promise<void>> {
    // Ensure connected
    await this.connect()

    const subscriptionId = generateCorrelationId()

    // Track the subscription for reconnection
    this.subscriptions.set(subscriptionId, {
      event: eventPattern,
      handler: handler as RemoteEventHandler,
      subscriptionId,
    })

    // Track the handler for event dispatch
    let handlers = this.eventHandlers.get(eventPattern)
    if (!handlers) {
      handlers = new Set()
      this.eventHandlers.set(eventPattern, handlers)
    }
    handlers.add(handler as RemoteEventHandler)

    // Send subscription message
    const subscribeMessage: EventSubscriptionMessage = {
      type: 'subscribe',
      event: eventPattern,
      subscriptionId,
    }

    // Wait for acknowledgment
    await this.sendSubscriptionMessage(subscribeMessage, subscriptionId)

    // Return unsubscribe function
    return async () => {
      await this.unsubscribe(subscriptionId)
    }
  }

  /**
   * Unsubscribe from remote events (do-9zknf)
   *
   * @param subscriptionId - The subscription ID to unsubscribe
   */
  private async unsubscribe(subscriptionId: string): Promise<void> {
    const subscription = this.subscriptions.get(subscriptionId)
    if (!subscription) {
      return
    }

    // Remove from tracking
    this.subscriptions.delete(subscriptionId)

    // Remove handler
    const handlers = this.eventHandlers.get(subscription.event)
    if (handlers) {
      handlers.delete(subscription.handler)
      if (handlers.size === 0) {
        this.eventHandlers.delete(subscription.event)
      }
    }

    // Only send unsubscribe if still connected
    if (!this.isConnected()) {
      return
    }

    // Send unsubscribe message
    const unsubscribeMessage: EventSubscriptionMessage = {
      type: 'unsubscribe',
      event: subscription.event,
      subscriptionId,
    }

    try {
      await this.sendSubscriptionMessage(unsubscribeMessage, subscriptionId)
    } catch {
      // Ignore errors during unsubscribe - connection may have closed
    }
  }

  /**
   * Send a subscription message and wait for acknowledgment (do-9zknf)
   */
  private sendSubscriptionMessage(
    message: EventSubscriptionMessage,
    subscriptionId: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'))
        return
      }

      // Set up timeout
      const timeout = setTimeout(() => {
        this.pendingSubscriptions.delete(subscriptionId)
        reject(new Error(`Subscription request timed out after ${this.timeout}ms`))
      }, this.timeout)

      // Track pending subscription
      this.pendingSubscriptions.set(subscriptionId, {
        resolve: () => {
          clearTimeout(timeout)
          resolve()
        },
        reject: (error) => {
          clearTimeout(timeout)
          reject(error)
        },
      })

      // Send message
      try {
        this.ws.send(JSON.stringify(message))
      } catch (error) {
        clearTimeout(timeout)
        this.pendingSubscriptions.delete(subscriptionId)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  /**
   * Resubscribe to all tracked subscriptions after reconnection (do-9zknf)
   */
  private async resubscribeAll(): Promise<void> {
    const subscriptionsToRestore = Array.from(this.subscriptions.values())

    for (const subscription of subscriptionsToRestore) {
      const subscribeMessage: EventSubscriptionMessage = {
        type: 'subscribe',
        event: subscription.event,
        subscriptionId: subscription.subscriptionId,
      }

      try {
        await this.sendSubscriptionMessage(subscribeMessage, subscription.subscriptionId)
      } catch (err) {
        // Log but don't fail - subscription may succeed on next reconnect
        this.emit({ type: 'error', error: err instanceof Error ? err : new Error(String(err)) })
      }
    }
  }

  /**
   * Get all active subscriptions (do-9zknf)
   *
   * @returns Array of active subscription event patterns
   */
  getSubscriptions(): string[] {
    return Array.from(this.subscriptions.values()).map((s) => s.event)
  }

  /**
   * Check if subscribed to a specific event pattern (do-9zknf)
   *
   * @param eventPattern - Event pattern to check
   * @returns True if subscribed to this pattern
   */
  isSubscribed(eventPattern: string): boolean {
    return Array.from(this.subscriptions.values()).some((s) => s.event === eventPattern)
  }
}

/**
 * Create a WebSocket transport (convenience function)
 */
export function createWebSocketTransport(options: WebSocketTransportOptions): WebSocketTransport {
  return new WebSocketTransport(options)
}
