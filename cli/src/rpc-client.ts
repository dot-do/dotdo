/**
 * Cap'n Web RPC Client for CLI
 *
 * WebSocket-based RPC client that:
 * 1. Connects to dotdo DOs via WebSocket
 * 2. Introspects schema on connect
 * 3. Generates TypeScript definitions from schema
 * 4. Supports streaming responses
 *
 * @module rpc-client
 */

import WebSocket from 'ws'
import { EventEmitter } from 'events'
import type {
  EvaluateResult,
  LogEntry,
  StreamingEvaluation,
} from './types/evaluate.js'

// Re-export evaluation types for convenience
export type { EvaluateResult, LogEntry, StreamingEvaluation } from './types/evaluate.js'

/**
 * RPC message types matching the server protocol
 */
export interface RpcMessage {
  id: string
  type: 'call' | 'response' | 'callback' | 'subscribe' | 'unsubscribe' | 'event' | 'error' | 'introspect' | 'pipeline' | 'log'
  path?: string[]
  args?: unknown[]
  result?: unknown
  error?: { message: string; code?: string; step?: number }
  callbackId?: string
  eventType?: string
  data?: unknown
  /** Pipeline operations for batched RPC */
  operations?: PipelineOperation[]
  /** Count of operations in pipeline */
  operationCount?: number
  /** Partial results before error */
  partialResults?: Array<{ step: number; value: unknown }>
  /** Correlation ID linking log messages to their originating call */
  correlationId?: string
}

/**
 * Pipeline operation representing a single step in a chained call
 */
export interface PipelineOperation {
  /** Property or method name */
  path: string
  /** Arguments (empty array for property access) */
  args: unknown[]
  /** Type of operation */
  type?: 'get' | 'call'
}

/**
 * Schema types from introspection
 */
export interface FieldSchema {
  name: string
  type: string
  required?: boolean
  description?: string
}

export interface ParamSchema {
  name: string
  type: string
  required?: boolean
}

export interface MethodSchema {
  name: string
  params: ParamSchema[]
  returns: string
  description?: string
}

export interface Schema {
  name: string
  fields: FieldSchema[]
  methods: MethodSchema[]
}

/**
 * Connection options
 */
export interface RpcClientOptions {
  /** WebSocket URL (e.g., wss://api.dotdo.dev/ws/rpc) */
  url: string
  /** Authentication token */
  token?: string
  /** Connection timeout in ms */
  timeout?: number
  /** Auto-reconnect on disconnect */
  autoReconnect?: boolean
  /** Debug logging */
  debug?: boolean
  /**
   * Batch window in ms for coalescing multiple RPC calls.
   * Calls within this window will be batched into a single WebSocket message.
   * Set to 0 to disable batching. Default: 5ms
   */
  batchWindow?: number
  /**
   * Enable request deduplication for identical calls.
   * When enabled, concurrent identical calls will share a single RPC request.
   * Default: true
   */
  deduplicateRequests?: boolean
  /**
   * TTL for deduplication cache in ms.
   * Cached results are reused for identical requests within this window.
   * Default: 100ms
   */
  deduplicationTtl?: number
}

/**
 * Connection state - discriminated union for type-safe state management
 *
 * Each state variant contains appropriate context:
 * - disconnected: No additional properties
 * - connecting: Includes attempt number
 * - connected: Includes WebSocket reference
 * - reconnecting: Includes attempt number and last error message
 * - error: Includes Error object
 */
export type ConnectionState =
  | { status: 'disconnected' }
  | { status: 'connecting'; attempt: number }
  | { status: 'connected'; socket: WebSocket }
  | { status: 'reconnecting'; attempt: number; lastError: string }
  | { status: 'error'; error: Error }

// Note: EvaluateResult, LogEntry, and StreamingEvaluation types are imported
// from ./types/evaluate.js and re-exported above. See that module for full
// documentation of evaluation-related types.

/**
 * CLI RPC Client
 *
 * Provides a WebSocket connection to dotdo DOs with:
 * - Promise-based RPC calls
 * - Event subscriptions
 * - Schema introspection
 */
/**
 * Request key for deduplication - represents a unique RPC call signature
 */
type RequestKey = string

/**
 * Pending call entry with metadata for batching
 */
interface PendingCallEntry {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
  /** Timestamp when request was queued for batching */
  queuedAt?: number
  /** Request key for deduplication */
  requestKey?: RequestKey
}

/**
 * Batched request awaiting dispatch
 */
interface BatchedRequest {
  id: string
  message: RpcMessage
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  requestKey?: RequestKey
}

/**
 * Deduplication cache entry
 */
interface DeduplicationEntry {
  /** Promise resolving to the result */
  promise: Promise<unknown>
  /** Expiration timestamp */
  expiresAt: number
}

export class RpcClient extends EventEmitter {
  private ws: WebSocket | null = null
  private messageId = 0
  private pendingCalls = new Map<string, PendingCallEntry>()
  private callbacks = new Map<string, (...args: unknown[]) => void>()
  private schema: Schema | null = null
  private options: Required<RpcClientOptions> & {
    batchWindow: number
    deduplicateRequests: boolean
    deduplicationTtl: number
  }
  private state: ConnectionState = { status: 'disconnected' }
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 1000
  /** Tracks streaming state for pending evaluations */
  private streamingState = new Map<string, {
    logs: LogEntry[]
    onLog?: (log: LogEntry) => void
  }>()

  // ========================================================================
  // Batching & Deduplication State
  // ========================================================================

  /** Queue of requests awaiting batch dispatch */
  private batchQueue: BatchedRequest[] = []
  /** Timer for batch window */
  private batchTimer: ReturnType<typeof setTimeout> | null = null
  /** Deduplication cache: requestKey -> cached promise */
  private deduplicationCache = new Map<RequestKey, DeduplicationEntry>()
  /** Map from message ID to all subscribers (for dedup) */
  private deduplicationSubscribers = new Map<string, Array<{
    resolve: (value: unknown) => void
    reject: (error: Error) => void
  }>>()

  constructor(options: RpcClientOptions) {
    super()
    this.options = {
      url: options.url,
      token: options.token ?? '',
      timeout: options.timeout ?? 30000,
      autoReconnect: options.autoReconnect ?? true,
      debug: options.debug ?? false,
      batchWindow: options.batchWindow ?? 5,
      deduplicateRequests: options.deduplicateRequests ?? true,
      deduplicationTtl: options.deduplicationTtl ?? 100,
    }
  }

  /**
   * Get current connection state
   *
   * Returns a copy of the state object to prevent external mutation.
   */
  getState(): ConnectionState {
    return { ...this.state } as ConnectionState
  }

  /**
   * Get cached schema (null if not connected)
   */
  getSchema(): Schema | null {
    return this.schema
  }

  /**
   * Connect to the RPC endpoint
   */
  async connect(): Promise<Schema> {
    if (this.state.status === 'connected' && this.ws) {
      return this.schema!
    }

    this.state = { status: 'connecting', attempt: this.reconnectAttempts + 1 }
    this.emit('stateChange', this.getState())
    this.emit('connecting')

    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {}
      if (this.options.token) {
        headers['Authorization'] = `Bearer ${this.options.token}`
      }

      this.ws = new WebSocket(this.options.url, { headers })

      const timeout = setTimeout(() => {
        this.ws?.close()
        const error = new Error('Connection timeout')
        this.state = { status: 'error', error }
        this.emit('stateChange', this.getState())
        reject(error)
      }, this.options.timeout)

      this.ws.on('open', async () => {
        clearTimeout(timeout)
        this.state = { status: 'connected', socket: this.ws! }
        this.reconnectAttempts = 0
        this.emit('stateChange', this.getState())
        this.emit('connected')

        try {
          // Introspect schema on connect
          this.schema = await this.introspect()
          resolve(this.schema)
        } catch (err) {
          reject(err)
        }
      })

      this.ws.on('message', (data) => {
        this.handleMessage(data.toString())
      })

      this.ws.on('error', (err) => {
        this.log('WebSocket error:', err)
        const error = err instanceof Error ? err : new Error(String(err))
        this.state = { status: 'error', error }
        this.emit('stateChange', this.getState())
        this.emit('error', err)
      })

      this.ws.on('close', (code, reason) => {
        const reasonStr = reason.toString()
        this.log('WebSocket closed:', code, reasonStr)
        this.state = { status: 'disconnected' }
        this.emit('stateChange', this.getState())
        this.emit('disconnected', { code, reason: reasonStr })
        this.handleDisconnect(reasonStr)
      })
    })
  }

  /**
   * Disconnect from the RPC endpoint
   */
  disconnect(): void {
    this.options.autoReconnect = false
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect')
      this.ws = null
    }
    this.cleanup()
    this.state = { status: 'disconnected' }
    this.emit('stateChange', this.getState())
  }

  /**
   * Introspect the remote DO's schema
   *
   * This call bypasses batching to ensure immediate execution during connection setup.
   */
  private async introspect(): Promise<Schema> {
    const result = await this.callImmediate(['$meta', 'schema'], [])
    return result as Schema
  }

  /**
   * Make an RPC call immediately, bypassing batching.
   * Used for critical path operations like introspection.
   */
  private async callImmediate(path: string[], args: unknown[]): Promise<unknown> {
    if (this.state.status !== 'connected' || !this.ws) {
      throw new Error('Not connected')
    }

    const ws = this.ws
    const id = this.generateId()
    const serializedArgs = this.serializeArgs(args)

    const message: RpcMessage = {
      id,
      type: 'call',
      path,
      args: serializedArgs,
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCalls.delete(id)
        reject(new Error(`RPC call timeout: ${path.join('.')}`))
      }, this.options.timeout)

      this.pendingCalls.set(id, { resolve, reject, timeout })

      this.log('Sending (immediate):', message)
      ws.send(JSON.stringify(message))
    })
  }

  /**
   * Evaluate code via RPC
   *
   * Sends code to the DO for evaluation using ai-evaluate.
   * The DO runs the code in a sandboxed environment with $ context.
   *
   * This method delegates to `call()` for the actual RPC, ensuring consistent
   * behavior for batching, deduplication, and mocking in tests.
   *
   * @param code - JavaScript/TypeScript code to evaluate
   * @returns Evaluation result with success/value/error/logs
   */
  async evaluate(code: string): Promise<EvaluateResult> {
    if (this.state.status !== 'connected' || !this.ws) {
      throw new Error('Not connected')
    }

    const ws = this.ws
    const id = this.generateId()

    const message: RpcMessage = {
      id,
      type: 'call',
      path: ['evaluate'],
      args: [code],
    }

    // Initialize streaming state for this call (enables event emission and log tracking)
    this.streamingState.set(id, { logs: [] })

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.streamingState.delete(id)
        this.pendingCalls.delete(id)
        reject(new Error('RPC call timeout: evaluate'))
      }, this.options.timeout)

      this.pendingCalls.set(id, {
        resolve: (value) => {
          const streamedLogs = this.streamingState.get(id)?.logs ?? []
          this.streamingState.delete(id)

          // Emit evaluate:complete event
          this.emit('evaluate:complete', {
            correlationId: id,
            streamedLogs,
            result: value as EvaluateResult,
          })

          resolve(value as EvaluateResult)
        },
        reject: (error) => {
          this.streamingState.delete(id)
          reject(error)
        },
        timeout,
      })

      this.log('Sending (evaluate):', message)
      ws.send(JSON.stringify(message))
    }) as Promise<EvaluateResult>
  }

  /**
   * Evaluate code with streaming log callback
   *
   * @param code - JavaScript/TypeScript code to evaluate
   * @param onLog - Callback invoked for each log message during evaluation
   * @returns Evaluation result with success/value/error/logs
   */
  async evaluateWithStreaming(
    code: string,
    onLog: (log: { level: string; message: string }) => void
  ): Promise<EvaluateResult> {
    if (this.state.status !== 'connected' || !this.ws) {
      throw new Error('Not connected')
    }

    const ws = this.ws
    const id = this.generateId()

    const message: RpcMessage = {
      id,
      type: 'call',
      path: ['evaluate'],
      args: [code],
    }

    // Initialize streaming state for this call
    this.streamingState.set(id, { logs: [], onLog })

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.streamingState.delete(id)
        this.pendingCalls.delete(id)
        reject(new Error('RPC call timeout: evaluate'))
      }, this.options.timeout)

      this.pendingCalls.set(id, {
        resolve: (value) => {
          const streamedLogs = this.streamingState.get(id)?.logs ?? []
          this.streamingState.delete(id)

          // Emit evaluate:complete event
          this.emit('evaluate:complete', {
            correlationId: id,
            streamedLogs,
            result: value as EvaluateResult,
          })

          resolve(value as EvaluateResult)
        },
        reject: (error) => {
          this.streamingState.delete(id)
          reject(error)
        },
        timeout,
      })

      this.log('Sending (streaming):', message)
      ws.send(JSON.stringify(message))
    }) as Promise<EvaluateResult>
  }

  /**
   * Evaluate code with streaming, returning a handle for log subscription
   *
   * @param code - JavaScript/TypeScript code to evaluate
   * @returns StreamingEvaluation handle with onLog subscriber and result promise
   */
  evaluateStreaming(code: string): StreamingEvaluation {
    let logCallback: ((log: LogEntry) => void) | undefined

    const resultPromise = new Promise<EvaluateResult>((resolve, reject) => {
      if (this.state.status !== 'connected' || !this.ws) {
        reject(new Error('Not connected'))
        return
      }

      const ws = this.ws
      const id = this.generateId()

      const message: RpcMessage = {
        id,
        type: 'call',
        path: ['evaluate'],
        args: [code],
      }

      // Initialize streaming state - onLog will be set by caller
      const state = {
        logs: [] as LogEntry[],
        get onLog() {
          return logCallback
        },
      }
      this.streamingState.set(id, state)

      const timeout = setTimeout(() => {
        this.streamingState.delete(id)
        this.pendingCalls.delete(id)
        reject(new Error('RPC call timeout: evaluate'))
      }, this.options.timeout)

      this.pendingCalls.set(id, {
        resolve: (value) => {
          const streamedLogs = this.streamingState.get(id)?.logs ?? []
          this.streamingState.delete(id)

          // Emit evaluate:complete event
          this.emit('evaluate:complete', {
            correlationId: id,
            streamedLogs,
            result: value as EvaluateResult,
          })

          resolve(value as EvaluateResult)
        },
        reject: (error) => {
          this.streamingState.delete(id)
          reject(error)
        },
        timeout,
      })

      this.log('Sending (streaming handle):', message)
      ws.send(JSON.stringify(message))
    })

    return {
      onLog: (callback: (log: LogEntry) => void) => {
        logCallback = callback
      },
      result: resultPromise,
    }
  }

  /**
   * Evaluate code with batched log delivery for high-frequency logs
   *
   * @param code - JavaScript/TypeScript code to evaluate
   * @param options - Batching options
   * @returns Object with result promise
   */
  evaluateWithBatching(
    code: string,
    options: {
      batchInterval: number
      onBatch: (batch: Array<{ level: string; message: string }>) => void
    }
  ): { result: Promise<EvaluateResult> } {
    if (this.state.status !== 'connected' || !this.ws) {
      throw new Error('Not connected')
    }

    const ws = this.ws
    const id = this.generateId()

    const message: RpcMessage = {
      id,
      type: 'call',
      path: ['evaluate'],
      args: [code],
    }

    // Batch buffer and timer
    let batch: Array<{ level: string; message: string }> = []
    let batchTimer: NodeJS.Timeout | null = null

    const flushBatch = () => {
      if (batch.length > 0) {
        options.onBatch([...batch])
        batch = []
      }
    }

    const startBatchTimer = () => {
      if (!batchTimer) {
        batchTimer = setTimeout(() => {
          flushBatch()
          batchTimer = null
        }, options.batchInterval)
      }
    }

    // Initialize streaming state with batching callback
    this.streamingState.set(id, {
      logs: [],
      onLog: (log) => {
        batch.push({ level: log.level, message: log.message })
        startBatchTimer()
      },
    })

    const resultPromise = new Promise<EvaluateResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (batchTimer) clearTimeout(batchTimer)
        flushBatch()
        this.streamingState.delete(id)
        this.pendingCalls.delete(id)
        reject(new Error('RPC call timeout: evaluate'))
      }, this.options.timeout)

      this.pendingCalls.set(id, {
        resolve: (value) => {
          if (batchTimer) clearTimeout(batchTimer)
          flushBatch()
          const streamedLogs = this.streamingState.get(id)?.logs ?? []
          this.streamingState.delete(id)

          this.emit('evaluate:complete', {
            correlationId: id,
            streamedLogs,
            result: value as EvaluateResult,
          })

          resolve(value as EvaluateResult)
        },
        reject: (error) => {
          if (batchTimer) clearTimeout(batchTimer)
          flushBatch()
          this.streamingState.delete(id)
          reject(error)
        },
        timeout,
      })

      this.log('Sending (batched):', message)
      ws.send(JSON.stringify(message))
    })

    return { result: resultPromise }
  }

  /**
   * Make an RPC call
   *
   * With batching enabled (default), calls made within the batch window
   * will be coalesced into a single WebSocket message. With deduplication
   * enabled (default), identical concurrent calls will share a single request.
   */
  async call(path: string[], args: unknown[]): Promise<unknown> {
    if (this.state.status !== 'connected' || !this.ws) {
      throw new Error('Not connected')
    }

    const serializedArgs = this.serializeArgs(args)

    // Generate request key for deduplication
    const requestKey = this.options.deduplicateRequests
      ? this.generateRequestKey('call', path, serializedArgs)
      : undefined

    // Check deduplication cache
    if (requestKey) {
      const cached = this.checkDeduplicationCache(requestKey)
      if (cached) {
        this.log('Dedup cache hit:', path.join('.'))
        return cached
      }
    }

    const id = this.generateId()

    const message: RpcMessage = {
      id,
      type: 'call',
      path,
      args: serializedArgs,
    }

    // Create the promise that will be returned
    const resultPromise = new Promise<unknown>((resolve, reject) => {
      // If batching is disabled, send immediately
      if (this.options.batchWindow <= 0) {
        this.sendImmediately(id, message, resolve, reject)
        return
      }

      // Queue for batching
      this.queueForBatch({
        id,
        message,
        resolve,
        reject,
        requestKey,
      })
    })

    // Cache for deduplication
    if (requestKey) {
      this.cacheForDeduplication(requestKey, resultPromise)
    }

    return resultPromise
  }

  // ==========================================================================
  // Batching Implementation
  // ==========================================================================

  /**
   * Queue a request for batch dispatch
   */
  private queueForBatch(request: BatchedRequest): void {
    this.batchQueue.push(request)

    // Start batch timer if not already running
    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => {
        this.flushBatchQueue()
      }, this.options.batchWindow)
    }
  }

  /**
   * Flush the batch queue, sending all queued requests
   */
  private flushBatchQueue(): void {
    this.batchTimer = null

    if (this.batchQueue.length === 0) return

    const queue = this.batchQueue
    this.batchQueue = []

    // If only one request, send normally
    if (queue.length === 1) {
      const req = queue[0]
      this.sendImmediately(req.id, req.message, req.resolve, req.reject, req.requestKey)
      return
    }

    // Multiple requests - check for duplicates and send batch
    this.sendBatch(queue)
  }

  /**
   * Send multiple requests, deduplicating identical ones
   */
  private sendBatch(requests: BatchedRequest[]): void {
    if (!this.ws) return

    // Group by request key for deduplication within batch
    const uniqueRequests = new Map<string, BatchedRequest>()
    const duplicates = new Map<string, BatchedRequest[]>()

    for (const req of requests) {
      const key = req.requestKey ?? req.id // Use id if no requestKey

      if (uniqueRequests.has(key)) {
        // This is a duplicate - add to duplicates list
        if (!duplicates.has(key)) {
          duplicates.set(key, [])
        }
        duplicates.get(key)!.push(req)
      } else {
        uniqueRequests.set(key, req)
      }
    }

    // Send unique requests
    for (const [key, req] of uniqueRequests) {
      const dups = duplicates.get(key) ?? []

      // Set up dedup subscribers if there are duplicates
      if (dups.length > 0) {
        this.deduplicationSubscribers.set(req.id, dups.map((d) => ({
          resolve: d.resolve,
          reject: d.reject,
        })))
      }

      this.sendImmediately(req.id, req.message, req.resolve, req.reject, req.requestKey)
    }

    this.log(`Batch: sent ${uniqueRequests.size} unique requests (${requests.length - uniqueRequests.size} deduped)`)
  }

  /**
   * Send a request immediately (bypassing batch queue)
   */
  private sendImmediately(
    id: string,
    message: RpcMessage,
    resolve: (value: unknown) => void,
    reject: (error: Error) => void,
    requestKey?: RequestKey
  ): void {
    if (!this.ws) {
      reject(new Error('Not connected'))
      return
    }

    const timeout = setTimeout(() => {
      this.pendingCalls.delete(id)
      this.deduplicationSubscribers.delete(id)
      reject(new Error(`RPC call timeout: ${message.path?.join('.') ?? 'unknown'}`))
    }, this.options.timeout)

    this.pendingCalls.set(id, {
      resolve,
      reject,
      timeout,
      queuedAt: Date.now(),
      requestKey,
    })

    this.log('Sending:', message)
    this.ws.send(JSON.stringify(message))
  }

  // ==========================================================================
  // Deduplication Implementation
  // ==========================================================================

  /**
   * Generate a unique key for a request based on its content
   */
  private generateRequestKey(
    type: string,
    path: string[] | undefined,
    args: unknown[]
  ): RequestKey {
    // Create a deterministic key from request content
    // Note: We exclude callbacks from the key since they're unique per call
    const normalizedArgs = args.map((arg) => {
      if (typeof arg === 'object' && arg !== null && '__rpc_callback_id' in arg) {
        return '__callback__'
      }
      return arg
    })

    return JSON.stringify({
      type,
      path,
      args: normalizedArgs,
    })
  }

  /**
   * Check deduplication cache for a cached result
   */
  private checkDeduplicationCache(requestKey: RequestKey): Promise<unknown> | null {
    const entry = this.deduplicationCache.get(requestKey)
    if (!entry) return null

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.deduplicationCache.delete(requestKey)
      return null
    }

    return entry.promise
  }

  /**
   * Cache a request's promise for deduplication
   */
  private cacheForDeduplication(requestKey: RequestKey, promise: Promise<unknown>): void {
    this.deduplicationCache.set(requestKey, {
      promise,
      expiresAt: Date.now() + this.options.deduplicationTtl,
    })

    // Clean up cache entry after TTL
    setTimeout(() => {
      const entry = this.deduplicationCache.get(requestKey)
      if (entry && Date.now() >= entry.expiresAt) {
        this.deduplicationCache.delete(requestKey)
      }
    }, this.options.deduplicationTtl + 10)
  }

  /**
   * Clear the deduplication cache
   */
  clearDeduplicationCache(): void {
    this.deduplicationCache.clear()
  }

  /**
   * Get batching statistics for monitoring
   */
  getBatchingStats(): {
    pendingCalls: number
    batchQueueSize: number
    deduplicationCacheSize: number
  } {
    return {
      pendingCalls: this.pendingCalls.size,
      batchQueueSize: this.batchQueue.length,
      deduplicationCacheSize: this.deduplicationCache.size,
    }
  }

  /**
   * Subscribe to events
   */
  subscribe(eventType: string, handler: (data: unknown) => void): () => void {
    if (!this.ws) {
      throw new Error('Not connected')
    }

    const callbackId = this.generateId()
    this.callbacks.set(callbackId, handler)

    const message: RpcMessage = {
      id: this.generateId(),
      type: 'subscribe',
      eventType,
      callbackId,
    }

    this.ws.send(JSON.stringify(message))

    // Return unsubscribe function
    return () => {
      this.callbacks.delete(callbackId)
      if (this.ws && this.state.status === 'connected') {
        const unsubMsg: RpcMessage = {
          id: this.generateId(),
          type: 'unsubscribe',
          eventType,
        }
        this.ws.send(JSON.stringify(unsubMsg))
      }
    }
  }

  /**
   * Create a proxy for fluent method calls with promise pipelining
   */
  createProxy<T = Record<string, (...args: unknown[]) => Promise<unknown>>>(): T {
    return this.createPipelineProxy([], null) as T
  }

  /**
   * Create a pipeline proxy that accumulates operations until await/then
   *
   * When a method is called (apply), we schedule the RPC to be sent using setTimeout(0).
   * The promise is cached so that .then() returns the same result.
   */
  private createPipelineProxy(
    operations: PipelineOperation[],
    scheduled: {
      timerId: ReturnType<typeof setTimeout>
      promise: Promise<unknown> | null
      executed: boolean
    } | null
  ): unknown {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const client = this

    const target = function () {}

    // Shared mutable state for the scheduled execution
    const executionState = scheduled

    return new Proxy(target, {
      get(_target, prop) {
        if (typeof prop === 'symbol') return undefined

        // Make the proxy thenable - this is where we actually send the RPC
        if (prop === 'then') {
          // If no operations, return undefined to prevent treating as promise
          if (operations.length === 0) return undefined

          return function (
            resolve?: (value: unknown) => unknown,
            reject?: (reason: unknown) => void
          ) {
            // If we have a scheduled execution, use its promise
            if (executionState) {
              // If the promise exists, reuse it
              if (executionState.promise) {
                return executionState.promise.then(resolve, reject)
              }
              // If not executed yet, cancel the timer and execute now
              if (!executionState.executed) {
                clearTimeout(executionState.timerId)
                executionState.executed = true
                executionState.promise = client.executePipeline(operations)
                return executionState.promise.then(resolve, reject)
              }
            }
            // No scheduled execution, execute now
            return client.executePipeline(operations).then(resolve, reject)
          }
        }

        // For catch/finally, also delegate to the promise
        if (prop === 'catch' && operations.length > 0) {
          return function (reject: (reason: unknown) => void) {
            if (executionState) {
              if (executionState.promise) {
                return executionState.promise.catch(reject)
              }
              if (!executionState.executed) {
                clearTimeout(executionState.timerId)
                executionState.executed = true
                executionState.promise = client.executePipeline(operations)
                return executionState.promise.catch(reject)
              }
            }
            return client.executePipeline(operations).catch(reject)
          }
        }

        if (prop === 'finally' && operations.length > 0) {
          return function (onFinally: () => void) {
            if (executionState) {
              if (executionState.promise) {
                return executionState.promise.finally(onFinally)
              }
              if (!executionState.executed) {
                clearTimeout(executionState.timerId)
                executionState.executed = true
                executionState.promise = client.executePipeline(operations)
                return executionState.promise.finally(onFinally)
              }
            }
            return client.executePipeline(operations).finally(onFinally)
          }
        }

        // Cancel any scheduled execution - we're extending the chain
        if (executionState && !executionState.executed) {
          clearTimeout(executionState.timerId)
          executionState.executed = true
        }

        // Accumulate property access operation
        const newOperations: PipelineOperation[] = [
          ...operations,
          { path: prop as string, args: [], type: 'get' },
        ]
        // Property access alone doesn't schedule execution - only method calls do
        // This ensures proxy.a.b.c doesn't trigger RPC, but proxy.a.b.c() does
        return client.createPipelineProxy(newOperations, null)
      },

      apply(_target, _thisArg, args) {
        // Cancel any scheduled execution - we're extending the chain
        if (executionState && !executionState.executed) {
          clearTimeout(executionState.timerId)
          executionState.executed = true
        }

        // Get the last operation and convert it to a method call
        if (operations.length === 0) {
          // Called directly on root - shouldn't happen but handle it
          return client.createPipelineProxy([{ path: '', args, type: 'call' }], null)
        }

        // Clone operations and update last one to be a call with args
        const newOperations = operations.slice(0, -1)
        const lastOp = operations[operations.length - 1]
        newOperations.push({
          path: lastOp.path,
          args,
          type: 'call',
        })

        // Create shared state for scheduled execution
        const newExecutionState = {
          timerId: undefined as unknown as ReturnType<typeof setTimeout>,
          promise: null as Promise<unknown> | null,
          executed: false,
        }

        // Schedule execution using setTimeout(0) - works with fake timers
        newExecutionState.timerId = setTimeout(() => {
          if (!newExecutionState.executed) {
            newExecutionState.executed = true
            newExecutionState.promise = client.executePipeline(newOperations)
          }
        }, 0)

        // Return a new proxy that can continue chaining or be awaited
        return client.createPipelineProxy(newOperations, newExecutionState)
      },
    })
  }

  /**
   * Execute a pipeline of operations as a single RPC call
   */
  private async executePipeline(operations: PipelineOperation[]): Promise<unknown> {
    if (this.state.status !== 'connected' || !this.ws) {
      throw new Error('Not connected')
    }

    const ws = this.ws
    const id = this.generateId()

    // Serialize args in each operation
    const serializedOperations = operations.map((op) => ({
      ...op,
      args: this.serializeArgs(op.args),
    }))

    // Also include a path array for backward compatibility / convenience
    const path = operations.map((op) => op.path)

    const message: RpcMessage = {
      id,
      type: 'pipeline',
      path, // Array of path segments
      operations: serializedOperations,
      operationCount: operations.length,
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCalls.delete(id)
        reject(new Error(`RPC pipeline timeout`))
      }, this.options.timeout)

      this.pendingCalls.set(id, { resolve, reject, timeout })

      this.log('Sending pipeline:', message)
      ws.send(JSON.stringify(message))
    })
  }

  // Legacy method for backward compatibility
  private createProxyAtPath(path: string[]): unknown {
    return new Proxy(() => {}, {
      get: (_target, prop) => {
        if (typeof prop === 'symbol') return undefined
        if (prop === 'then') return undefined

        const newPath = [...path, prop as string]
        return this.createProxyAtPath(newPath)
      },
      apply: (_target, _thisArg, args) => {
        return this.call(path, args)
      },
    })
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(data: string): void {
    try {
      const message: RpcMessage = JSON.parse(data)
      this.log('Received:', message)

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
        case 'log':
          this.handleLog(message)
          break
      }
    } catch (err) {
      this.log('Failed to parse message:', err)
    }
  }

  private handleResponse(message: RpcMessage): void {
    const pending = this.pendingCalls.get(message.id)
    if (!pending) return

    clearTimeout(pending.timeout)
    this.pendingCalls.delete(message.id)

    // Get any dedup subscribers waiting for this response
    const dedupSubscribers = this.deduplicationSubscribers.get(message.id)
    this.deduplicationSubscribers.delete(message.id)

    if (message.error) {
      const error = new Error(message.error.message) as Error & {
        pipelineStep?: number
        partialResults?: unknown[]
      }
      // Add pipeline step information if present
      if (typeof message.error.step === 'number') {
        error.pipelineStep = message.error.step
      }
      // Add partial results if present
      if (message.partialResults) {
        error.partialResults = message.partialResults
      }
      pending.reject(error)
      // Also reject all dedup subscribers
      if (dedupSubscribers) {
        for (const sub of dedupSubscribers) {
          sub.reject(error)
        }
      }
    } else {
      // Handle pipeline response format
      const result = message.result as {
        steps?: Array<{ step: number; value: unknown }>
        final?: unknown
      } | null

      let finalValue: unknown

      if (result && typeof result === 'object' && 'final' in result) {
        // Pipeline response with steps and final result
        finalValue = this.deserializeResult(result.final)

        // Attach pipeline metadata to the result if it's an object
        if (finalValue && typeof finalValue === 'object') {
          (finalValue as Record<string, unknown>).$pipeline = {
            steps: result.steps || [],
          }
        }
      } else {
        // Regular response
        finalValue = this.deserializeResult(message.result)
      }

      pending.resolve(finalValue)
      // Also resolve all dedup subscribers with the same value
      if (dedupSubscribers) {
        for (const sub of dedupSubscribers) {
          sub.resolve(finalValue)
        }
      }
    }
  }

  private handleCallback(message: RpcMessage): void {
    const callback = this.callbacks.get(message.callbackId!)
    if (callback) {
      callback(...(message.args ?? []))
    }
  }

  private handleEvent(message: RpcMessage): void {
    this.emit('event', {
      type: message.eventType,
      data: message.data,
    })
  }

  private handleError(message: RpcMessage): void {
    this.emit('rpcError', message.error)
  }

  /**
   * Handle streaming log message
   */
  private handleLog(message: RpcMessage): void {
    const correlationId = message.correlationId
    if (!correlationId) return

    // Only emit for pending calls (ignore orphan logs)
    if (!this.pendingCalls.has(correlationId)) return

    const data = message.data as { level?: string; message?: string; index?: number } | undefined
    const logEntry: LogEntry = {
      level: data?.level ?? 'info',
      message: data?.message ?? '',
      index: data?.index,
    }

    // Track in streaming state
    const state = this.streamingState.get(correlationId)
    if (state) {
      state.logs.push(logEntry)
      // Call streaming callback if set
      if (state.onLog) {
        state.onLog({ level: logEntry.level, message: logEntry.message })
      }
    }

    // Emit 'log' event for global listeners
    this.emit('log', {
      correlationId,
      level: logEntry.level,
      message: logEntry.message,
      index: logEntry.index,
    })
  }

  /**
   * Handle disconnection with optional reconnect
   */
  private handleDisconnect(reason?: string): void {
    this.cleanup(reason)

    if (this.options.autoReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1)
      this.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`)

      // Set state to reconnecting
      this.state = {
        status: 'reconnecting',
        attempt: this.reconnectAttempts,
        lastError: reason ?? 'Connection closed',
      }
      this.emit('stateChange', this.getState())

      setTimeout(() => {
        this.connect().catch((err) => {
          this.log('Reconnect failed:', err)
        })
      }, delay)
    }
  }

  /**
   * Clean up pending calls and batching state
   */
  private cleanup(reason?: string): void {
    // Clear batch timer and queue
    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }

    // Reject any batched requests that haven't been sent
    for (const req of this.batchQueue) {
      req.reject(new Error('Connection closed'))
    }
    this.batchQueue = []

    // Clear deduplication state
    this.deduplicationCache.clear()

    // Reject any dedup subscribers
    for (const [, subscribers] of this.deduplicationSubscribers) {
      for (const sub of subscribers) {
        sub.reject(new Error('Connection closed'))
      }
    }
    this.deduplicationSubscribers.clear()

    // Emit streaming:interrupted for any calls with streaming state
    for (const [id, state] of this.streamingState) {
      this.emit('streaming:interrupted', {
        correlationId: id,
        reason: reason ?? 'Connection closed',
        logsReceived: state.logs.length,
      })
    }
    this.streamingState.clear()

    for (const [, pending] of this.pendingCalls) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('Connection closed'))
    }
    this.pendingCalls.clear()
  }

  /**
   * Serialize arguments, handling functions as callbacks
   */
  private serializeArgs(args: unknown[]): unknown[] {
    return args.map((arg) => this.serializeValue(arg))
  }

  private serializeValue(value: unknown): unknown {
    if (typeof value === 'function') {
      const callbackId = this.generateId()
      this.callbacks.set(callbackId, value as (...args: unknown[]) => void)
      return { __rpc_callback_id: callbackId }
    }

    if (Array.isArray(value)) {
      return value.map((v) => this.serializeValue(v))
    }

    if (value instanceof Date) {
      return { __rpc_date: value.toISOString() }
    }

    if (typeof value === 'object' && value !== null) {
      const serialized: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value)) {
        serialized[k] = this.serializeValue(v)
      }
      return serialized
    }

    return value
  }

  /**
   * Deserialize result, restoring dates
   */
  private deserializeResult(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((v) => this.deserializeResult(v))
    }

    if (typeof value === 'object' && value !== null) {
      if ('__rpc_date' in value) {
        return new Date((value as { __rpc_date: string }).__rpc_date)
      }

      const deserialized: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value)) {
        deserialized[k] = this.deserializeResult(v)
      }
      return deserialized
    }

    return value
  }

  /**
   * Generate unique message ID
   */
  private generateId(): string {
    return `msg_${Date.now()}_${++this.messageId}_${Math.random().toString(36).slice(2, 8)}`
  }

  /**
   * Debug logging
   */
  private log(...args: unknown[]): void {
    if (this.options.debug) {
      console.log('[RpcClient]', ...args)
    }
  }
}

/**
 * Generate TypeScript definitions from schema
 */
export function generateTypeDefinitions(schema: Schema): string {
  const lines: string[] = []

  lines.push(`// Auto-generated from ${schema.name} schema`)
  lines.push('')

  // Generate interface for the DO
  lines.push(`interface ${schema.name} {`)

  // Add fields
  for (const field of schema.fields) {
    const optional = field.required === false ? '?' : ''
    const doc = field.description ? `  /** ${field.description} */\n` : ''
    lines.push(`${doc}  ${field.name}${optional}: ${mapType(field.type)};`)
  }

  lines.push('')

  // Add methods
  for (const method of schema.methods) {
    const params = method.params
      .map((p) => `${p.name}${p.required === false ? '?' : ''}: ${mapType(p.type)}`)
      .join(', ')
    const returnType = mapType(method.returns)
    const doc = method.description ? `  /** ${method.description} */\n` : ''
    lines.push(`${doc}  ${method.name}(${params}): ${returnType};`)
  }

  lines.push('}')
  lines.push('')

  // Declare the DO as available in REPL
  lines.push(`declare const ${schema.name.toLowerCase()}: ${schema.name};`)

  return lines.join('\n')
}

/**
 * Map schema types to TypeScript types
 */
function mapType(schemaType: string): string {
  // Handle Promise types
  if (schemaType.startsWith('Promise<')) {
    return schemaType
  }

  // Handle array types
  if (schemaType.endsWith('[]')) {
    const baseType = schemaType.slice(0, -2)
    return `${mapType(baseType)}[]`
  }

  // Map common types
  const typeMap: Record<string, string> = {
    string: 'string',
    number: 'number',
    boolean: 'boolean',
    Date: 'Date',
    unknown: 'unknown',
    void: 'void',
    null: 'null',
    undefined: 'undefined',
    object: 'Record<string, unknown>',
  }

  return typeMap[schemaType] ?? schemaType
}

/**
 * Create a connected RPC client
 */
export async function createRpcClient(options: RpcClientOptions): Promise<RpcClient> {
  const client = new RpcClient(options)
  await client.connect()
  return client
}
