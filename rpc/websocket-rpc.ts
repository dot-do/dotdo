/**
 * WebSocket RPC Transport for Cap'n Web Style Pipelining
 *
 * This module implements bidirectional RPC over WebSocket, enabling:
 * 1. Promise pipelining - call methods on unresolved promises
 * 2. Bidirectional callbacks - callbacks work because they're invoked via WebSocket
 * 3. Hibernation support - uses Cloudflare's hibernatable WebSocket API
 *
 * The key insight: when a callback is passed over RPC, we don't try to serialize it.
 * Instead, we:
 * 1. Register the callback locally with a unique ID
 * 2. Send the callback ID over the wire
 * 3. When the DO wants to invoke the callback, it sends a message back
 * 4. The client's message handler looks up and invokes the callback by ID
 */

// =============================================================================
// Types
// =============================================================================

export interface RpcMessage {
  /** Unique message ID for request/response correlation */
  id: string
  /** Message type */
  type: 'call' | 'response' | 'callback' | 'subscribe' | 'unsubscribe' | 'event' | 'error'
  /** Method/property path for calls */
  path?: string[]
  /** Arguments (with callback IDs substituted for functions) */
  args?: unknown[]
  /** Result for responses */
  result?: unknown
  /** Error for error responses */
  error?: { message: string; code?: string }
  /** Callback ID for callback invocations */
  callbackId?: string
  /** Event type for event messages */
  eventType?: string
  /** Event data */
  data?: unknown
}

export interface CallbackStub {
  __rpc_callback_id: string
}

export interface WebSocketRpcOptions {
  /** Timeout for RPC calls in milliseconds */
  timeout?: number
  /** Enable debug logging */
  debug?: boolean
}

/**
 * EventSubscriptionHandler - Typed handler for WebSocket event subscriptions
 */
export type EventSubscriptionHandler = (data: unknown) => void

// =============================================================================
// Utilities
// =============================================================================

let messageIdCounter = 0

export function generateMessageId(): string {
  return `msg_${Date.now()}_${++messageIdCounter}_${Math.random().toString(36).substr(2, 6)}`
}

export function generateCallbackId(): string {
  return `cb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

export function isCallbackStub(value: unknown): value is CallbackStub {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__rpc_callback_id' in value &&
    typeof (value as CallbackStub).__rpc_callback_id === 'string'
  )
}

// =============================================================================
// Client-Side WebSocket RPC
// =============================================================================

/**
 * Client-side WebSocket RPC connection.
 * Maintains a WebSocket connection to a DO and handles bidirectional RPC.
 */
export class WebSocketRpcClient {
  private ws: WebSocket | null = null
  private callbacks = new Map<string, (...args: unknown[]) => unknown>()
  private pendingCalls = new Map<string, {
    resolve: (result: unknown) => void
    reject: (error: Error) => void
    timeout: ReturnType<typeof setTimeout>
  }>()
  private eventSubscriptions = new Map<string, Set<EventSubscriptionHandler>>()
  private options: Required<WebSocketRpcOptions>
  private connectionPromise: Promise<void> | null = null

  constructor(options: WebSocketRpcOptions = {}) {
    this.options = {
      timeout: options.timeout ?? 30000,
      debug: options.debug ?? false,
    }
  }

  /**
   * Connect to a Durable Object via WebSocket
   */
  async connect(doStub: DurableObjectStub, endpoint = '/ws/rpc'): Promise<void> {
    if (this.connectionPromise) {
      return this.connectionPromise
    }

    this.connectionPromise = this.doConnect(doStub, endpoint)
    return this.connectionPromise
  }

  private async doConnect(doStub: DurableObjectStub, endpoint: string): Promise<void> {
    const response = await doStub.fetch(`https://rpc.dotdo.dev${endpoint}`, {
      headers: { Upgrade: 'websocket' },
    })

    if (response.status !== 101) {
      throw new Error(`WebSocket upgrade failed: ${response.status}`)
    }

    const webSocket = response.webSocket
    if (!webSocket) {
      throw new Error('WebSocket upgrade succeeded but no WebSocket returned')
    }

    this.ws = webSocket
    this.ws.accept()

    // Capture ws reference for event listeners to avoid non-null assertions
    const ws = this.ws

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('WebSocket connection timeout'))
      }, this.options.timeout)

      ws.addEventListener('open', () => {
        clearTimeout(timeout)
        resolve()
      })

      ws.addEventListener('message', (event) => {
        this.handleMessage(event.data as string)
      })

      ws.addEventListener('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })

      ws.addEventListener('close', () => {
        this.cleanup()
      })
    })
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: string): void {
    try {
      const message: RpcMessage = JSON.parse(data)

      if (this.options.debug) {
        console.log('[WebSocketRpcClient] Received:', message)
      }

      switch (message.type) {
        case 'response':
          this.handleResponse(message)
          break
        case 'callback':
          this.handleCallback(message)
          break
        case 'event':
          this.handleEvent(message)
          break
        case 'error':
          this.handleError(message)
          break
      }
    } catch (err) {
      console.error('[WebSocketRpcClient] Failed to parse message:', err)
    }
  }

  private handleResponse(message: RpcMessage): void {
    const pending = this.pendingCalls.get(message.id)
    if (!pending) return

    clearTimeout(pending.timeout)
    this.pendingCalls.delete(message.id)

    if (message.error) {
      pending.reject(new Error(message.error.message))
    } else {
      pending.resolve(message.result)
    }
  }

  private handleCallback(message: RpcMessage): void {
    const callback = this.callbacks.get(message.callbackId!)
    if (!callback) {
      console.warn(`[WebSocketRpcClient] Unknown callback ID: ${message.callbackId}`)
      return
    }

    try {
      // Deserialize callback arguments (may contain nested callback stubs)
      const args = this.deserializeArgs(message.args ?? [])
      callback(...args)
    } catch (err) {
      console.error(`[WebSocketRpcClient] Callback error:`, err)
    }
  }

  private handleEvent(message: RpcMessage): void {
    const handlers = this.eventSubscriptions.get(message.eventType!)
    if (!handlers) return

    for (const handler of handlers) {
      try {
        handler(message.data)
      } catch (err) {
        console.error(`[WebSocketRpcClient] Event handler error:`, err)
      }
    }
  }

  private handleError(message: RpcMessage): void {
    console.error(`[WebSocketRpcClient] Server error:`, message.error)
  }

  /**
   * Make an RPC call over WebSocket
   */
  async call(path: string[], args: unknown[]): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected')
    }

    // Capture ws reference after null check to avoid non-null assertion
    const ws = this.ws

    const messageId = generateMessageId()
    const serializedArgs = this.serializeArgs(args)

    const message: RpcMessage = {
      id: messageId,
      type: 'call',
      path,
      args: serializedArgs,
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCalls.delete(messageId)
        reject(new Error(`RPC call timeout: ${path.join('.')}`))
      }, this.options.timeout)

      this.pendingCalls.set(messageId, { resolve, reject, timeout })

      if (this.options.debug) {
        console.log('[WebSocketRpcClient] Sending:', message)
      }

      ws.send(JSON.stringify(message))
    })
  }

  /**
   * Subscribe to events from the DO
   */
  subscribe(eventType: string, handler: EventSubscriptionHandler): () => void {
    // Register handler locally
    let existingHandlers = this.eventSubscriptions.get(eventType)
    if (!existingHandlers) {
      existingHandlers = new Set()
      this.eventSubscriptions.set(eventType, existingHandlers)
    }
    existingHandlers.add(handler)

    // Capture reference for closure to avoid non-null assertion
    const handlers = existingHandlers

    // Send subscription message to DO
    const message: RpcMessage = {
      id: generateMessageId(),
      type: 'subscribe',
      eventType,
    }
    this.ws?.send(JSON.stringify(message))

    // Return unsubscribe function
    return () => {
      handlers.delete(handler)
      if (handlers.size === 0) {
        this.eventSubscriptions.delete(eventType)
        // Send unsubscribe message
        const unsubMsg: RpcMessage = {
          id: generateMessageId(),
          type: 'unsubscribe',
          eventType,
        }
        this.ws?.send(JSON.stringify(unsubMsg))
      }
    }
  }

  /**
   * Serialize arguments, replacing functions with callback stubs
   */
  private serializeArgs(args: unknown[]): unknown[] {
    return args.map((arg) => this.serializeValue(arg))
  }

  private serializeValue(value: unknown): unknown {
    if (typeof value === 'function') {
      // Register callback and return stub
      const callbackId = generateCallbackId()
      this.callbacks.set(callbackId, value as (...args: unknown[]) => unknown)
      return { __rpc_callback_id: callbackId } as CallbackStub
    }

    if (Array.isArray(value)) {
      return value.map((v) => this.serializeValue(v))
    }

    if (typeof value === 'object' && value !== null) {
      if (value instanceof Date) {
        return { __rpc_date: value.toISOString() }
      }
      const serialized: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value)) {
        serialized[k] = this.serializeValue(v)
      }
      return serialized
    }

    return value
  }

  /**
   * Deserialize arguments, restoring callback stubs as proxy functions
   */
  private deserializeArgs(args: unknown[]): unknown[] {
    return args.map((arg) => this.deserializeValue(arg))
  }

  private deserializeValue(value: unknown): unknown {
    if (isCallbackStub(value)) {
      // Return a proxy function that invokes the callback on the server
      return (...args: unknown[]) => {
        this.invokeRemoteCallback(value.__rpc_callback_id, args)
      }
    }

    if (Array.isArray(value)) {
      return value.map((v) => this.deserializeValue(v))
    }

    if (typeof value === 'object' && value !== null) {
      if ('__rpc_date' in value) {
        return new Date((value as { __rpc_date: string }).__rpc_date)
      }
      const deserialized: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value)) {
        deserialized[k] = this.deserializeValue(v)
      }
      return deserialized
    }

    return value
  }

  /**
   * Invoke a callback that lives on the server
   */
  private invokeRemoteCallback(callbackId: string, args: unknown[]): void {
    const message: RpcMessage = {
      id: generateMessageId(),
      type: 'callback',
      callbackId,
      args: this.serializeArgs(args),
    }
    this.ws?.send(JSON.stringify(message))
  }

  /**
   * Create a proxy stub for the remote DO
   */
  createStub<T>(): T {
    return createRpcProxy(this, []) as T
  }

  /**
   * Disconnect and cleanup
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect')
    }
    this.cleanup()
  }

  private cleanup(): void {
    // Reject all pending calls
    for (const [id, pending] of this.pendingCalls) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('Connection closed'))
    }
    this.pendingCalls.clear()
    this.callbacks.clear()
    this.eventSubscriptions.clear()
    this.ws = null
    this.connectionPromise = null
  }
}

/**
 * Create a proxy that records method/property access and makes RPC calls
 */
function createRpcProxy(client: WebSocketRpcClient, path: string[]): unknown {
  return new Proxy(() => {}, {
    get(_target, prop) {
      if (typeof prop === 'symbol') return undefined
      if (prop === 'then') return undefined // Don't be thenable until called

      const newPath = [...path, prop as string]
      return createRpcProxy(client, newPath)
    },

    apply(_target, _thisArg, args) {
      // When called, make the RPC call
      return client.call(path, args)
    },
  })
}

// =============================================================================
// Server-Side WebSocket RPC Handler
// =============================================================================

/**
 * Server-side WebSocket RPC handler mixin.
 * Extend your DO with this to handle incoming RPC calls over WebSocket.
 */
export class WebSocketRpcHandler {
  private wsCallbacks = new Map<string, (...args: unknown[]) => unknown>()
  private wsSubscriptions = new Map<WebSocket, Set<string>>()
  // Track which callbacks belong to which WebSocket for cleanup on disconnect
  private wsCallbackIds = new Map<WebSocket, Set<string>>()
  private debug = false

  /**
   * Handle incoming WebSocket RPC message
   * Call this from your webSocketMessage handler
   */
  handleRpcMessage(ws: WebSocket, message: string | ArrayBuffer, target: unknown): void {
    try {
      const msg: RpcMessage = JSON.parse(message as string)

      if (this.debug) {
        console.log('[WebSocketRpcHandler] Received:', msg)
      }

      switch (msg.type) {
        case 'call':
          this.handleCall(ws, msg, target)
          break
        case 'callback':
          this.handleCallback(ws, msg)
          break
        case 'subscribe':
          this.handleSubscribe(ws, msg)
          break
        case 'unsubscribe':
          this.handleUnsubscribe(ws, msg)
          break
      }
    } catch (err) {
      console.error('[WebSocketRpcHandler] Failed to handle message:', err)
      this.sendError(ws, 'parse_error', 'Failed to parse message')
    }
  }

  private async handleCall(ws: WebSocket, msg: RpcMessage, target: unknown): Promise<void> {
    try {
      const path = msg.path ?? []
      const args = this.deserializeArgs(msg.args ?? [], ws)

      // Navigate to the target method/property
      let current: unknown = target
      for (let i = 0; i < path.length - 1; i++) {
        current = (current as Record<string, unknown>)[path[i]]
        if (current === undefined) {
          throw new Error(`Property not found: ${path.slice(0, i + 1).join('.')}`)
        }
      }

      const methodName = path[path.length - 1]
      const method = (current as Record<string, unknown>)[methodName]

      // Check if method exists
      if (method === undefined) {
        throw new Error(`Method not found: ${path.join('.')}`)
      }

      let result: unknown
      if (typeof method === 'function') {
        result = await method.apply(current, args)
      } else {
        result = method
      }

      // Send response
      const response: RpcMessage = {
        id: msg.id,
        type: 'response',
        result: this.serializeResult(result, ws),
      }
      ws.send(JSON.stringify(response))
    } catch (err) {
      const response: RpcMessage = {
        id: msg.id,
        type: 'response',
        error: {
          message: err instanceof Error ? err.message : String(err),
        },
      }
      ws.send(JSON.stringify(response))
    }
  }

  private handleCallback(ws: WebSocket, msg: RpcMessage): void {
    const callback = this.wsCallbacks.get(msg.callbackId!)
    if (!callback) {
      console.warn(`[WebSocketRpcHandler] Unknown callback ID: ${msg.callbackId}`)
      return
    }

    try {
      const args = this.deserializeArgs(msg.args ?? [], ws)
      callback(...args)
    } catch (err) {
      console.error(`[WebSocketRpcHandler] Callback error:`, err)
    }
  }

  private handleSubscribe(ws: WebSocket, msg: RpcMessage): void {
    let subs = this.wsSubscriptions.get(ws)
    if (!subs) {
      subs = new Set()
      this.wsSubscriptions.set(ws, subs)
    }
    subs.add(msg.eventType!)

    // Also store in WebSocket attachment for hibernation support
    const attachment = ws.deserializeAttachment() as { subscriptions?: string[] } | null
    const existingSubs = attachment?.subscriptions ?? []
    if (!existingSubs.includes(msg.eventType!)) {
      existingSubs.push(msg.eventType!)
      ws.serializeAttachment({ subscriptions: existingSubs })
    }
  }

  private handleUnsubscribe(ws: WebSocket, msg: RpcMessage): void {
    const subs = this.wsSubscriptions.get(ws)
    if (subs) {
      subs.delete(msg.eventType!)
    }

    // Update attachment
    const attachment = ws.deserializeAttachment() as { subscriptions?: string[] } | null
    const existingSubs = attachment?.subscriptions ?? []
    const idx = existingSubs.indexOf(msg.eventType!)
    if (idx >= 0) {
      existingSubs.splice(idx, 1)
      ws.serializeAttachment({ subscriptions: existingSubs })
    }
  }

  /**
   * Broadcast an event to all subscribed WebSockets
   */
  broadcastEvent(
    ctx: DurableObjectState,
    eventType: string,
    data: unknown
  ): void {
    const sockets = ctx.getWebSockets()

    for (const ws of sockets) {
      // Check memory subscriptions first
      const memSubs = this.wsSubscriptions.get(ws)
      if (memSubs?.has(eventType) || this.matchesWildcard(eventType, memSubs)) {
        this.sendEvent(ws, eventType, data)
        continue
      }

      // Check hibernation attachment (for after wake)
      const attachment = ws.deserializeAttachment() as { subscriptions?: string[] } | null
      const subs = attachment?.subscriptions ?? []
      if (subs.includes(eventType) || this.matchesWildcardList(eventType, subs)) {
        this.sendEvent(ws, eventType, data)
      }
    }
  }

  private matchesWildcard(eventType: string, subs?: Set<string>): boolean {
    if (!subs) return false
    const [noun, verb] = eventType.split('.')

    return (
      subs.has(`*.${verb}`) ||      // Wildcard noun
      subs.has(`${noun}.*`) ||      // Wildcard verb
      subs.has('*.*')               // Global wildcard
    )
  }

  private matchesWildcardList(eventType: string, subs: string[]): boolean {
    const [noun, verb] = eventType.split('.')

    return (
      subs.includes(`*.${verb}`) ||
      subs.includes(`${noun}.*`) ||
      subs.includes('*.*')
    )
  }

  private sendEvent(ws: WebSocket, eventType: string, data: unknown): void {
    try {
      const message: RpcMessage = {
        id: generateMessageId(),
        type: 'event',
        eventType,
        data: this.serializeResult(data, ws),
      }
      ws.send(JSON.stringify(message))
    } catch (err) {
      console.error('[WebSocketRpcHandler] Failed to send event:', err)
    }
  }

  private sendError(ws: WebSocket, code: string, message: string): void {
    const response: RpcMessage = {
      id: generateMessageId(),
      type: 'error',
      error: { code, message },
    }
    ws.send(JSON.stringify(response))
  }

  /**
   * Deserialize arguments, converting callback stubs to real functions
   * that invoke back to the client
   */
  private deserializeArgs(args: unknown[], ws: WebSocket): unknown[] {
    return args.map((arg) => this.deserializeValue(arg, ws))
  }

  private deserializeValue(value: unknown, ws: WebSocket): unknown {
    if (isCallbackStub(value)) {
      // Create a function that sends callback invocation back to client
      const callbackId = value.__rpc_callback_id
      return (...args: unknown[]) => {
        const message: RpcMessage = {
          id: generateMessageId(),
          type: 'callback',
          callbackId,
          args: args.map((a) => this.serializeResult(a, ws)),
        }
        ws.send(JSON.stringify(message))
      }
    }

    if (Array.isArray(value)) {
      return value.map((v) => this.deserializeValue(v, ws))
    }

    if (typeof value === 'object' && value !== null) {
      if ('__rpc_date' in value) {
        return new Date((value as { __rpc_date: string }).__rpc_date)
      }
      const deserialized: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value)) {
        deserialized[k] = this.deserializeValue(v, ws)
      }
      return deserialized
    }

    return value
  }

  /**
   * Serialize result, converting functions to callback stubs
   */
  private serializeResult(value: unknown, ws: WebSocket): unknown {
    if (typeof value === 'function') {
      // Register callback and return stub
      const callbackId = generateCallbackId()
      this.wsCallbacks.set(callbackId, value as (...args: unknown[]) => unknown)

      // Track callback ownership for cleanup on WebSocket close
      let callbackIds = this.wsCallbackIds.get(ws)
      if (!callbackIds) {
        callbackIds = new Set()
        this.wsCallbackIds.set(ws, callbackIds)
      }
      callbackIds.add(callbackId)

      return { __rpc_callback_id: callbackId } as CallbackStub
    }

    if (Array.isArray(value)) {
      return value.map((v) => this.serializeResult(v, ws))
    }

    if (typeof value === 'object' && value !== null) {
      if (value instanceof Date) {
        return { __rpc_date: value.toISOString() }
      }
      const serialized: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value)) {
        serialized[k] = this.serializeResult(v, ws)
      }
      return serialized
    }

    return value
  }

  /**
   * Clean up when WebSocket closes
   * Removes subscriptions and any registered callbacks for this WebSocket
   */
  cleanupWebSocketRpc(ws: WebSocket): void {
    // Clean up subscriptions
    this.wsSubscriptions.delete(ws)

    // Clean up callbacks associated with this WebSocket
    const callbackIds = this.wsCallbackIds.get(ws)
    if (callbackIds) {
      for (const callbackId of callbackIds) {
        this.wsCallbacks.delete(callbackId)
      }
      this.wsCallbackIds.delete(ws)
    }
  }

  /**
   * Restore subscriptions from attachment after hibernation wake
   */
  restoreSubscriptionsFromAttachment(ws: WebSocket): void {
    const attachment = ws.deserializeAttachment() as { subscriptions?: string[] } | null
    const subs = attachment?.subscriptions ?? []

    if (subs.length > 0) {
      let memSubs = this.wsSubscriptions.get(ws)
      if (!memSubs) {
        memSubs = new Set()
        this.wsSubscriptions.set(ws, memSubs)
      }
      for (const sub of subs) {
        memSubs.add(sub)
      }
    }
  }
}

// =============================================================================
// Type Declarations for Cloudflare
// =============================================================================

declare global {
  interface WebSocket {
    accept(): void
    serializeAttachment(value: unknown): void
    deserializeAttachment(): unknown
  }

  interface DurableObjectState {
    getWebSockets(tag?: string): WebSocket[]
    acceptWebSocket(ws: WebSocket, tags?: string[]): void
  }
}
