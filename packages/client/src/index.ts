/**
 * @dotdo/client - RPC Client SDK for Durable Objects
 *
 * Features:
 * - WebSocket connection preferred, HTTP fallback
 * - Automatic reconnection with exponential backoff
 * - Promise pipelining (Cap'n Proto style)
 * - Type-safe method calls via Proxy
 * - Request batching for efficiency
 * - Real-time event subscriptions
 * - Offline queue for resilience
 */

// =============================================================================
// Types
// =============================================================================

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'failed'

export interface ReconnectConfig {
  maxAttempts?: number
  baseDelay?: number
  maxDelay?: number
  jitter?: number
}

export interface AuthConfig {
  token?: string
}

export interface ClientConfig {
  timeout?: number
  batchWindow?: number
  maxBatchSize?: number
  batching?: boolean
  offlineQueueLimit?: number
  reconnect?: ReconnectConfig
  auth?: AuthConfig
}

export interface RPCError {
  code: string
  message: string
  stage?: number
}

export interface SubscriptionHandle {
  unsubscribe(): void
}

export interface PipelineStep {
  method: string
  params: unknown[]
}

interface RPCMessage {
  id: string
  method?: string
  params?: unknown[]
  pipeline?: PipelineStep[]
  batch?: RPCMessage[]
  type?: 'subscribe' | 'unsubscribe'
  channel?: string
}

interface RPCResponse {
  id: string
  result?: unknown
  error?: RPCError
  batch?: RPCResponse[]
  type?: 'event'
  channel?: string
  data?: unknown
}

interface PendingCall {
  id: string
  resolve: (value: unknown) => void
  reject: (error: RPCError) => void
  message: RPCMessage
  timeoutId?: ReturnType<typeof setTimeout>
}

interface Subscription {
  channel: string
  callbacks: Set<(data: unknown) => void>
}

type EventCallback<T = unknown> = (data: T) => void
type ConnectionStateCallback = (state: ConnectionState) => void
type QueueChangeCallback = (count: number) => void
type CloseCallback = (reason: string) => void

interface ClientEvents {
  connectionStateChange: ConnectionStateCallback
  queueChange: QueueChangeCallback
  close: CloseCallback
  error: EventCallback<Error>
}

// =============================================================================
// Utility Functions
// =============================================================================

function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

function httpToWs(url: string): string {
  if (url.startsWith('https://')) {
    return 'wss://' + url.slice(8)
  }
  if (url.startsWith('http://')) {
    return 'ws://' + url.slice(7)
  }
  return url
}

// =============================================================================
// Pipeline Proxy
// =============================================================================

function createPipelineProxy(
  client: DOClientImpl<unknown, unknown>,
  steps: PipelineStep[]
): unknown {
  return new Proxy(() => {}, {
    get(_target, prop) {
      if (typeof prop === 'string') {
        // Return a function that adds to the pipeline
        return (...args: unknown[]) => {
          const newSteps = [...steps, { method: prop, params: args }]
          return createPipelineProxy(client, newSteps)
        }
      }
      return undefined
    },
    apply(_target, _thisArg, _args) {
      // When the pipeline is awaited, execute it
      return client._executePipeline(steps)
    },
  }) as unknown
}

// Pipeline chain state - shared between all proxies in a chain
interface PipelineChainState {
  steps: PipelineStep[]
  executed: boolean
  executionPromise: Promise<unknown> | null
  timeoutId: ReturnType<typeof setTimeout> | null
  counted: boolean // Whether this chain has been counted
}

// Creates a pipeline proxy that schedules execution after synchronous chain building
function createPipelineProxyWithThen(
  client: DOClientImpl<unknown, unknown>,
  steps: PipelineStep[],
  chainState?: PipelineChainState
): unknown {
  // Create or use existing chain state
  const isNewChain = !chainState
  const state: PipelineChainState = chainState ?? {
    steps: steps,
    executed: false,
    executionPromise: null,
    timeoutId: null,
    counted: false,
  }

  // Update steps in the shared state
  state.steps = steps

  // Track new pipeline chains
  if (isNewChain && !state.counted) {
    state.counted = true
    client._incrementPendingPipeline()
  }

  // Schedule execution if not already scheduled
  const scheduleExecution = () => {
    if (state.timeoutId === null && !state.executed) {
      state.timeoutId = setTimeout(() => {
        state.timeoutId = null
        if (!state.executed) {
          state.executed = true
          client._decrementPendingPipeline()
          state.executionPromise = client._executePipeline(state.steps)
        }
      }, 0)
    }
  }

  // Get or trigger execution
  const getExecutionPromise = (): Promise<unknown> => {
    if (!state.executed) {
      // Cancel any pending timeout
      if (state.timeoutId !== null) {
        clearTimeout(state.timeoutId)
        state.timeoutId = null
      }
      // Execute immediately
      state.executed = true
      client._decrementPendingPipeline()
      state.executionPromise = client._executePipeline(state.steps)
    }
    return state.executionPromise!
  }

  // Schedule execution
  scheduleExecution()

  // Create a thenable proxy
  const proxyObj = {
    then(
      onfulfilled?: ((value: unknown) => unknown) | null,
      onrejected?: ((reason: unknown) => unknown) | null
    ): Promise<unknown> {
      return getExecutionPromise().then(onfulfilled, onrejected)
    },
    catch(onrejected?: ((reason: unknown) => unknown) | null): Promise<unknown> {
      return getExecutionPromise().catch(onrejected)
    },
    finally(onfinally?: (() => void) | null): Promise<unknown> {
      return getExecutionPromise().finally(onfinally)
    },
  }

  return new Proxy(proxyObj, {
    get(target, prop) {
      // Forward Promise methods
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        const fn = (target as Record<string, unknown>)[prop as string]
        if (typeof fn === 'function') {
          return fn.bind(target)
        }
      }
      // For method chaining, extend the pipeline using the same state
      if (typeof prop === 'string') {
        return (...args: unknown[]) => {
          if (state.executed) {
            // Chain has already executed, create new independent chain
            const newSteps = [...steps, { method: prop, params: args }]
            return createPipelineProxyWithThen(client, newSteps)
          }
          // Extend the current chain
          const newSteps = [...state.steps, { method: prop, params: args }]
          return createPipelineProxyWithThen(client, newSteps, state)
        }
      }
      return (target as Record<string, unknown>)[prop as unknown as string]
    },
  }) as unknown
}

// =============================================================================
// DOClient Implementation
// =============================================================================

class DOClientImpl<TMethods, TEvents> {
  private url: string
  private wsUrl: string
  private _config: ClientConfig
  private ws: WebSocket | null = null
  private _connectionState: ConnectionState = 'connecting'
  private pendingCalls: Map<string, PendingCall> = new Map()
  private offlineQueue: PendingCall[] = []
  private subscriptions: Map<string, Subscription> = new Map()
  private reconnectAttempts: number = 0
  private reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null
  private explicitlyDisconnected: boolean = false
  private useHttpFallback: boolean = false
  private wsSupported: boolean = true
  private batchQueue: PendingCall[] = []
  private batchTimeoutId: ReturnType<typeof setTimeout> | null = null
  private eventListeners: Map<keyof ClientEvents, Set<EventCallback>> = new Map()
  private pendingPipelineCount: number = 0

  constructor(url: string, config: ClientConfig = {}) {
    this.url = url
    this.wsUrl = httpToWs(url) + '/rpc'
    this._config = {
      timeout: 30000,
      batchWindow: 0, // Default: no batching delay (immediate on microtask)
      maxBatchSize: 100,
      batching: true,
      offlineQueueLimit: 1000,
      reconnect: {
        maxAttempts: Infinity,
        baseDelay: 1000,
        maxDelay: 30000,
        jitter: 0.1,
      },
      ...config,
    }

    // Check WebSocket support
    this.wsSupported = typeof WebSocket !== 'undefined'

    if (this.wsSupported) {
      this.connect()
    } else {
      this.useHttpFallback = true
      this._connectionState = 'disconnected'
    }
  }

  get connectionState(): ConnectionState {
    return this._connectionState
  }

  get config(): ClientConfig {
    return { ...this._config }
  }

  get queuedCallCount(): number {
    // Count includes:
    // - pending pipelines that haven't been executed yet
    // - batch queue items that haven't been sent yet
    // - offline queue items waiting for connection
    return this.pendingPipelineCount + this.offlineQueue.length + this.batchQueue.length
  }

  // Methods to track pending pipelines
  _incrementPendingPipeline(): void {
    this.pendingPipelineCount++
    this.emit('queueChange', this.queuedCallCount)
  }

  _decrementPendingPipeline(): void {
    this.pendingPipelineCount = Math.max(0, this.pendingPipelineCount - 1)
  }

  // Internal method to flush batches for testing - called when connection opens
  private flushBatchQueueIfNeeded(): void {
    if (this.batchQueue.length > 0 && this.batchTimeoutId) {
      clearTimeout(this.batchTimeoutId)
      this.batchTimeoutId = null
      this.flushBatch()
    }
  }

  configure(config: Partial<ClientConfig>): void {
    this._config = { ...this._config, ...config }
  }

  // Event handling
  on<K extends keyof ClientEvents>(event: K, callback: ClientEvents[K]): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set())
    }
    this.eventListeners.get(event)!.add(callback as EventCallback)
  }

  off<K extends keyof ClientEvents>(event: K, callback: ClientEvents[K]): void {
    const listeners = this.eventListeners.get(event)
    if (listeners) {
      listeners.delete(callback as EventCallback)
    }
  }

  private emit<K extends keyof ClientEvents>(event: K, data: Parameters<ClientEvents[K]>[0]): void {
    const listeners = this.eventListeners.get(event)
    if (listeners) {
      for (const callback of listeners) {
        try {
          callback(data)
        } catch (e) {
          console.error('Event listener error:', e)
        }
      }
    }
  }

  private setConnectionState(state: ConnectionState): void {
    if (this._connectionState !== state) {
      this._connectionState = state
      this.emit('connectionStateChange', state)
    }
  }

  private connect(): void {
    if (this.explicitlyDisconnected) return

    try {
      this.ws = new WebSocket(this.wsUrl)
      this.setConnectionState('connecting')

      this.ws.onopen = () => {
        this.reconnectAttempts = 0
        this.setConnectionState('connected')
        // Flush any pending batch queue items first
        this.flushBatchQueueIfNeeded()
        this.flushOfflineQueue()
        this.resubscribeAll()
      }

      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data as string) as RPCResponse
          this.handleMessage(data)
        } catch (e) {
          // Malformed message - emit error but don't crash
          this.emit('error', new Error('Malformed server response'))
        }
      }

      this.ws.onclose = (event: CloseEvent) => {
        this.ws = null
        this.emit('close', event.reason || 'Connection closed')

        if (!this.explicitlyDisconnected) {
          this.setConnectionState('reconnecting')
          this.scheduleReconnect()
        } else {
          this.setConnectionState('disconnected')
        }
      }

      this.ws.onerror = () => {
        // Error will be followed by close, handle reconnection there
        this.useHttpFallback = true
      }
    } catch (e) {
      this.useHttpFallback = true
      this.setConnectionState('failed')
    }
  }

  private scheduleReconnect(): void {
    if (this.explicitlyDisconnected) return

    const { baseDelay = 1000, maxDelay = 30000, jitter = 0.1 } = this._config.reconnect || {}

    // Exponential backoff: baseDelay * 2^attempts
    let delay = Math.min(baseDelay * Math.pow(2, this.reconnectAttempts), maxDelay)

    // Add jitter
    const jitterAmount = delay * jitter * (Math.random() * 2 - 1)
    delay = Math.max(0, delay + jitterAmount)

    this.reconnectAttempts++

    this.reconnectTimeoutId = setTimeout(() => {
      this.connect()
    }, delay)
  }

  private flushOfflineQueue(): void {
    const queue = [...this.offlineQueue]
    this.offlineQueue = []
    this.emit('queueChange', this.queuedCallCount)

    for (const call of queue) {
      this.sendCall(call)
    }
  }

  private resubscribeAll(): void {
    for (const [channel, subscription] of this.subscriptions) {
      if (subscription.callbacks.size > 0) {
        this.sendRaw({ type: 'subscribe', channel, id: generateId() })
      }
    }
  }

  private handleMessage(data: RPCResponse): void {
    // Handle subscription events
    if (data.type === 'event' && data.channel) {
      const subscription = this.subscriptions.get(data.channel)
      if (subscription) {
        for (const callback of subscription.callbacks) {
          callback(data.data)
        }
      }
      return
    }

    // Handle batch responses
    if (data.batch) {
      for (const response of data.batch) {
        this.handleSingleResponse(response)
      }
      return
    }

    // Handle single response
    this.handleSingleResponse(data)
  }

  private handleSingleResponse(data: RPCResponse): void {
    const pending = this.pendingCalls.get(data.id)
    if (!pending) return

    this.pendingCalls.delete(data.id)
    if (pending.timeoutId) {
      clearTimeout(pending.timeoutId)
    }

    if (data.error) {
      pending.reject(data.error)
    } else {
      pending.resolve(data.result)
    }
  }

  private sendRaw(message: RPCMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    }
  }

  private sendCall(call: PendingCall): void {
    // WebSocket.OPEN is 1 in both browsers and our MockWebSocket
    const isOpen = this.ws && this.ws.readyState === 1
    if (isOpen) {
      this.pendingCalls.set(call.id, call)
      this.sendRaw(call.message)
    } else if (!this.useHttpFallback) {
      // Queue for when connection is available
      this.offlineQueue.push(call)
      this.enforceQueueLimit()
      this.emit('queueChange', this.queuedCallCount)
    } else {
      // Use HTTP fallback
      this.sendHttpCall(call)
    }
  }

  private enforceQueueLimit(): void {
    const limit = this._config.offlineQueueLimit || 1000
    while (this.offlineQueue.length > limit) {
      const dropped = this.offlineQueue.shift()
      if (dropped) {
        dropped.reject({ code: 'QUEUE_OVERFLOW', message: 'Offline queue limit exceeded' })
      }
    }
  }

  private async sendHttpCall(call: PendingCall): Promise<void> {
    const httpUrl = this.url + '/rpc'
    const maxRetries = 3
    let lastError: Error | null = null

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        }

        if (this._config.auth?.token) {
          headers['Authorization'] = `Bearer ${this._config.auth.token}`
        }

        const response = await fetch(httpUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(call.message),
        })

        if (response.status >= 500) {
          // Server error, retry
          lastError = new Error(`HTTP ${response.status}`)
          continue
        }

        const data = await response.json() as RPCResponse

        if (data.error) {
          call.reject(data.error)
        } else {
          call.resolve(data.result)
        }
        return
      } catch (e) {
        lastError = e as Error
      }
    }

    call.reject({
      code: 'HTTP_ERROR',
      message: lastError?.message || 'HTTP request failed',
    })
  }

  // Public method to execute a direct RPC call
  _executeCall(method: string, params: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = generateId()
      const message: RPCMessage = { id, method, params }
      const call: PendingCall = { id, resolve, reject, message }

      // Set up timeout
      if (this._config.timeout) {
        call.timeoutId = setTimeout(() => {
          this.pendingCalls.delete(id)
          reject({ code: 'TIMEOUT', message: 'Request timed out' })
        }, this._config.timeout)
      }

      // If batching is enabled, add to batch queue
      if (this._config.batching !== false) {
        this.addToBatch(call)
      } else {
        this.sendCall(call)
      }
    })
  }

  // Execute a pipeline of calls
  _executePipeline(steps: PipelineStep[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = generateId()
      const message: RPCMessage = { id, pipeline: steps }
      const call: PendingCall = { id, resolve, reject, message }

      // Set up timeout
      if (this._config.timeout) {
        call.timeoutId = setTimeout(() => {
          this.pendingCalls.delete(id)
          reject({ code: 'TIMEOUT', message: 'Request timed out' })
        }, this._config.timeout)
      }

      // If batching is enabled, add to batch queue
      if (this._config.batching !== false) {
        this.addToBatch(call)
      } else {
        this.sendCall(call)
      }
    })
  }

  private addToBatch(call: PendingCall): void {
    this.batchQueue.push(call)
    this.emit('queueChange', this.queuedCallCount)

    // If we hit max batch size, send immediately (synchronously)
    if (this._config.maxBatchSize && this.batchQueue.length >= this._config.maxBatchSize) {
      this.flushBatch()
      return
    }

    // Schedule batch flush if not already scheduled
    if (!this.batchTimeoutId) {
      const batchWindow = this._config.batchWindow ?? 0
      // Use setTimeout for batching - let the timer control when flush happens
      // Note: batchWindow=0 will still schedule via setTimeout for consistency with fake timers
      this.batchTimeoutId = setTimeout(() => {
        this.flushBatch()
      }, batchWindow)
    }
  }

  private flushBatch(): void {
    if (this.batchTimeoutId) {
      clearTimeout(this.batchTimeoutId)
      this.batchTimeoutId = null
    }

    const batch = [...this.batchQueue]
    this.batchQueue = []
    this.emit('queueChange', this.queuedCallCount)

    if (batch.length === 0) return

    if (batch.length === 1) {
      // Single call, send directly
      this.sendCall(batch[0])
      return
    }

    // Multiple calls, batch them
    const batchId = generateId()
    const batchMessage: RPCMessage = {
      id: batchId,
      batch: batch.map(c => c.message),
    }

    // Create a composite pending call that will distribute results
    const batchCall: PendingCall = {
      id: batchId,
      message: batchMessage,
      resolve: (results) => {
        const batchResults = results as RPCResponse[]
        for (let i = 0; i < batch.length; i++) {
          const call = batch[i]
          const result = batchResults[i]
          if (call.timeoutId) {
            clearTimeout(call.timeoutId)
          }
          if (result?.error) {
            call.reject(result.error)
          } else {
            call.resolve(result?.result)
          }
        }
      },
      reject: (error) => {
        for (const call of batch) {
          if (call.timeoutId) {
            clearTimeout(call.timeoutId)
          }
          call.reject(error)
        }
      },
    }

    this.sendCall(batchCall)
  }

  // Subscription support
  subscribe<K extends keyof TEvents>(
    channel: K & string,
    callback: (data: TEvents[K]) => void
  ): SubscriptionHandle {
    let subscription = this.subscriptions.get(channel)

    if (!subscription) {
      subscription = { channel, callbacks: new Set() }
      this.subscriptions.set(channel, subscription)

      // Send subscribe message if connected
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.sendRaw({ type: 'subscribe', channel, id: generateId() })
      }
    }

    subscription.callbacks.add(callback as (data: unknown) => void)

    return {
      unsubscribe: () => {
        const sub = this.subscriptions.get(channel)
        if (sub) {
          sub.callbacks.delete(callback as (data: unknown) => void)

          // If no more listeners, unsubscribe
          if (sub.callbacks.size === 0) {
            this.subscriptions.delete(channel)
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.sendRaw({ type: 'unsubscribe', channel, id: generateId() })
            }
          }
        }
      },
    }
  }

  clearQueue(): void {
    // Reject all queued calls
    for (const call of this.offlineQueue) {
      call.reject({ code: 'QUEUE_CLEARED', message: 'Queue was cleared' })
    }
    for (const call of this.batchQueue) {
      call.reject({ code: 'QUEUE_CLEARED', message: 'Queue was cleared' })
    }
    this.offlineQueue = []
    this.batchQueue = []
    if (this.batchTimeoutId) {
      clearTimeout(this.batchTimeoutId)
      this.batchTimeoutId = null
    }
    this.emit('queueChange', 0)
  }

  disconnect(): void {
    this.explicitlyDisconnected = true

    // Cancel reconnection attempts
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId)
      this.reconnectTimeoutId = null
    }

    // Cancel all pending calls
    for (const [id, call] of this.pendingCalls) {
      if (call.timeoutId) {
        clearTimeout(call.timeoutId)
      }
      call.reject({ code: 'CLIENT_DISCONNECTED', message: 'Client disconnected' })
      this.pendingCalls.delete(id)
    }

    // Clear offline queue
    for (const call of this.offlineQueue) {
      call.reject({ code: 'CLIENT_DISCONNECTED', message: 'Client disconnected' })
    }
    this.offlineQueue = []

    // Clear batch queue
    for (const call of this.batchQueue) {
      call.reject({ code: 'CLIENT_DISCONNECTED', message: 'Client disconnected' })
    }
    this.batchQueue = []
    if (this.batchTimeoutId) {
      clearTimeout(this.batchTimeoutId)
      this.batchTimeoutId = null
    }

    // Close WebSocket
    if (this.ws) {
      this.ws.close(1000, 'Client disconnecting')
      this.ws = null
    }

    // Clear event listeners
    this.eventListeners.clear()

    this.setConnectionState('disconnected')
  }
}

// =============================================================================
// Type-Safe Client Proxy
// =============================================================================

type MethodProxy<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<R> & MethodProxy<R>
    : never
}

export type DOClient<TMethods, TEvents = Record<string, unknown>> = MethodProxy<TMethods> & {
  connectionState: ConnectionState
  config: ClientConfig
  queuedCallCount: number
  on<K extends keyof ClientEvents>(event: K, callback: ClientEvents[K]): void
  off<K extends keyof ClientEvents>(event: K, callback: ClientEvents[K]): void
  subscribe<K extends keyof TEvents>(
    channel: K & string,
    callback: (data: TEvents[K]) => void
  ): SubscriptionHandle
  configure(config: Partial<ClientConfig>): void
  clearQueue(): void
  disconnect(): void
}

// =============================================================================
// Factory Function
// =============================================================================

export function createClient<TMethods = Record<string, (...args: unknown[]) => unknown>, TEvents = Record<string, unknown>>(
  url: string,
  config?: ClientConfig
): DOClient<TMethods, TEvents> {
  const client = new DOClientImpl<TMethods, TEvents>(url, config)

  const proxy = new Proxy(client as unknown as DOClient<TMethods, TEvents>, {
    get(target, prop) {
      // Pass through known client methods
      if (
        prop === 'connectionState' ||
        prop === 'config' ||
        prop === 'queuedCallCount' ||
        prop === 'on' ||
        prop === 'off' ||
        prop === 'subscribe' ||
        prop === 'configure' ||
        prop === 'clearQueue' ||
        prop === 'disconnect'
      ) {
        const value = (target as unknown as Record<string, unknown>)[prop as string]
        if (typeof value === 'function') {
          return value.bind(target)
        }
        return value
      }

      // For any other property, create a method proxy
      if (typeof prop === 'string') {
        return (...args: unknown[]) => {
          // Create a pipeline with single step that can be extended
          const steps: PipelineStep[] = [{ method: prop, params: args }]
          return createPipelineProxyWithThen(client as unknown as DOClientImpl<unknown, unknown>, steps)
        }
      }

      return undefined
    },
  })

  return proxy
}

// =============================================================================
// Exports
// =============================================================================

export type { ClientConfig as BatchOptions, PipelineStep as PipelineResult }
