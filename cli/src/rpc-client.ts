/**
 * Cap'n Web RPC Client for CLI
 *
 * WebSocket-based RPC client that:
 * 1. Connects to dotdo DOs via WebSocket
 * 2. Introspects schema on connect
 * 3. Generates TypeScript definitions from schema
 * 4. Supports streaming responses
 */

import WebSocket from 'ws'
import { EventEmitter } from 'events'

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
}

/**
 * Connection state
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

/**
 * Result from code evaluation via RPC
 */
export interface EvaluateResult {
  /** Whether evaluation succeeded */
  success: boolean
  /** Return value on success */
  value?: unknown
  /** Error message on failure */
  error?: string
  /** Log entries captured during evaluation */
  logs: Array<{ level: string; message: string }>
}

/**
 * Log entry received during streaming
 */
export interface LogEntry {
  level: string
  message: string
  index?: number
}

/**
 * Streaming evaluation handle
 */
export interface StreamingEvaluation {
  /** Subscribe to logs as they arrive */
  onLog: (callback: (log: LogEntry) => void) => void
  /** Promise for the final result */
  result: Promise<EvaluateResult>
}

/**
 * CLI RPC Client
 *
 * Provides a WebSocket connection to dotdo DOs with:
 * - Promise-based RPC calls
 * - Event subscriptions
 * - Schema introspection
 */
export class RpcClient extends EventEmitter {
  private ws: WebSocket | null = null
  private messageId = 0
  private pendingCalls = new Map<string, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timeout: NodeJS.Timeout
  }>()
  private callbacks = new Map<string, (...args: unknown[]) => void>()
  private schema: Schema | null = null
  private options: Required<RpcClientOptions>
  private state: ConnectionState = 'disconnected'
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 1000
  /** Tracks streaming state for pending evaluations */
  private streamingState = new Map<string, {
    logs: LogEntry[]
    onLog?: (log: LogEntry) => void
  }>()

  constructor(options: RpcClientOptions) {
    super()
    this.options = {
      url: options.url,
      token: options.token ?? '',
      timeout: options.timeout ?? 30000,
      autoReconnect: options.autoReconnect ?? true,
      debug: options.debug ?? false,
    }
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.state
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
    if (this.state === 'connected' && this.ws) {
      return this.schema!
    }

    this.state = 'connecting'
    this.emit('connecting')

    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {}
      if (this.options.token) {
        headers['Authorization'] = `Bearer ${this.options.token}`
      }

      this.ws = new WebSocket(this.options.url, { headers })

      const timeout = setTimeout(() => {
        this.ws?.close()
        this.state = 'error'
        reject(new Error('Connection timeout'))
      }, this.options.timeout)

      this.ws.on('open', async () => {
        clearTimeout(timeout)
        this.state = 'connected'
        this.reconnectAttempts = 0
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
        this.state = 'error'
        this.emit('error', err)
      })

      this.ws.on('close', (code, reason) => {
        const reasonStr = reason.toString()
        this.log('WebSocket closed:', code, reasonStr)
        this.state = 'disconnected'
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
    this.state = 'disconnected'
  }

  /**
   * Introspect the remote DO's schema
   */
  private async introspect(): Promise<Schema> {
    const result = await this.call(['$meta', 'schema'], [])
    return result as Schema
  }

  /**
   * Evaluate code via RPC
   *
   * Sends code to the DO for evaluation using ai-evaluate.
   * The DO runs the code in a sandboxed environment with $ context.
   *
   * @param code - JavaScript/TypeScript code to evaluate
   * @returns Evaluation result with success/value/error/logs
   */
  async evaluate(code: string): Promise<EvaluateResult> {
    // Use the standard call method for RPC
    // This ensures consistent behavior and allows proper mocking in tests
    const result = (await this.call(['evaluate'], [code])) as EvaluateResult
    return result
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
    if (this.state !== 'connected' || !this.ws) {
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
      if (this.state !== 'connected' || !this.ws) {
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
    if (this.state !== 'connected' || !this.ws) {
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
   */
  async call(path: string[], args: unknown[]): Promise<unknown> {
    if (this.state !== 'connected' || !this.ws) {
      throw new Error('Not connected')
    }

    // Capture ws reference after null check to avoid non-null assertion
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

      this.log('Sending:', message)
      ws.send(JSON.stringify(message))
    })
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
      if (this.ws && this.state === 'connected') {
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
    if (this.state !== 'connected' || !this.ws) {
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
    } else {
      // Handle pipeline response format
      const result = message.result as {
        steps?: Array<{ step: number; value: unknown }>
        final?: unknown
      } | null

      if (result && typeof result === 'object' && 'final' in result) {
        // Pipeline response with steps and final result
        let finalResult = this.deserializeResult(result.final)

        // Attach pipeline metadata to the result if it's an object
        if (finalResult && typeof finalResult === 'object') {
          (finalResult as Record<string, unknown>).$pipeline = {
            steps: result.steps || [],
          }
        }

        pending.resolve(finalResult)
      } else {
        // Regular response
        pending.resolve(this.deserializeResult(message.result))
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

      setTimeout(() => {
        this.connect().catch((err) => {
          this.log('Reconnect failed:', err)
        })
      }, delay)
    }
  }

  /**
   * Clean up pending calls
   */
  private cleanup(reason?: string): void {
    // Emit streaming:interrupted for any calls with streaming state
    for (const [id, state] of this.streamingState) {
      this.emit('streaming:interrupted', {
        correlationId: id,
        reason: reason ?? 'Connection closed',
        logsReceived: state.logs.length,
      })
    }
    this.streamingState.clear()

    for (const [id, pending] of this.pendingCalls) {
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
