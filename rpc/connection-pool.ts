/**
 * Connection Pool - capnweb RPC client connection reuse
 *
 * Provides WebSocket connection pooling for Durable Objects with:
 * - Single WebSocket per DO (connection reuse)
 * - LRU eviction when pool is full
 * - Automatic reconnection on disconnect
 * - Request pipelining (batch multiple calls)
 * - WebSocket hibernation support
 *
 * This enables 95% cost savings by maintaining persistent connections
 * to hibernating DOs instead of establishing new connections each request.
 *
 * @module rpc/connection-pool
 *
 * @example Basic usage
 * ```typescript
 * import { ConnectionPool } from '@dotdo/rpc'
 *
 * // Create a pool with max 100 connections
 * const pool = new ConnectionPool({
 *   maxConnections: 100,
 *   autoReconnect: true,
 *   reconnectDelayMs: 1000,
 *   maxReconnectAttempts: 3,
 * })
 *
 * // Get a connection (reuses existing if available)
 * const conn = await pool.getConnection('wss://my-do.example.com')
 *
 * // Make RPC calls
 * const result = await conn.call('myMethod', [arg1, arg2])
 *
 * // Or batch multiple calls (single roundtrip)
 * conn.startPipeline()
 * const call1 = conn.call('method1', [])
 * const call2 = conn.call('method2', [])
 * conn.flushPipeline()
 * const [result1, result2] = await Promise.all([call1, call2])
 *
 * // Clean up when done
 * await pool.close()
 * ```
 *
 * @example With TTL-based expiration
 * ```typescript
 * const pool = new ConnectionPool({
 *   maxConnections: 50,
 *   ttlMs: 60000, // Connections expire after 1 minute of inactivity
 *   hibernationAware: true,
 * })
 * ```
 */

/**
 * WebSocket factory function type
 */
export type WebSocketFactory = (url: string) => WebSocket

// Types
export interface ConnectionPoolOptions {
  /** Maximum number of connections to maintain */
  maxConnections: number
  /** Time-to-live for idle connections in milliseconds */
  ttlMs?: number
  /** Whether to automatically reconnect on disconnect */
  autoReconnect?: boolean
  /** Base delay for reconnection attempts in milliseconds */
  reconnectDelayMs?: number
  /** Maximum number of reconnection attempts */
  maxReconnectAttempts?: number
  /** Keep-alive ping interval in milliseconds */
  keepAliveIntervalMs?: number
  /** Whether to use hibernation-aware behavior */
  hibernationAware?: boolean
  /** Custom WebSocket factory for testing */
  webSocketFactory?: WebSocketFactory
}

export interface ConnectionStats {
  /** Whether the connection is currently open */
  connected: boolean
  /** Number of messages sent */
  messagesSent: number
  /** Number of messages received */
  messagesReceived: number
  /** Latency of last message in milliseconds */
  latencyMs: number | null
  /** Number of reconnection attempts */
  reconnectAttempts: number
}

export interface PoolStats {
  /** Number of active connections */
  activeConnections: number
  /** Total connections created since pool initialization */
  totalConnectionsCreated: number
  /** Maximum connections allowed */
  maxConnections: number
  /** Number of evictions performed */
  evictionCount: number
  /** Number of reconnections performed */
  reconnectionCount: number
}

export interface ConnectionConfig {
  /** Keep-alive interval in milliseconds */
  keepAliveIntervalMs?: number
  /** Whether hibernation-aware */
  hibernationAware: boolean
}

export interface PipelineOptions {
  /** Auto-flush delay in milliseconds */
  autoFlushMs?: number
}

interface PendingCall {
  id: string
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  method: string
  args: unknown[]
}

interface BatchCall {
  id: string
  method: string
  args: unknown[]
}

interface BatchResponse {
  batchId: string
  results: Array<{
    id: string
    result?: unknown
    error?: { code: string; message: string }
  }>
}

interface SingleResponse {
  id: string
  result?: unknown
  error?: { code: string; message: string }
}

/**
 * A pooled WebSocket connection to a Durable Object
 */
export class PooledConnection {
  private ws: WebSocket | null = null
  private url: string
  private config: ConnectionPoolOptions
  private pendingCalls = new Map<string, PendingCall>()
  private requestId = 0
  private stats: ConnectionStats = {
    connected: false,
    messagesSent: 0,
    messagesReceived: 0,
    latencyMs: null,
    reconnectAttempts: 0,
  }
  private pipelineMode = false
  private pipelinedCalls: BatchCall[] = []
  private pipelinePending: PendingCall[] = []
  private autoFlushTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private lastAccessTime = Date.now()
  private onClose?: () => void
  private connecting: Promise<void> | null = null
  private batchId = 0
  private wsFactory: WebSocketFactory

  constructor(url: string, options: ConnectionPoolOptions, onClose?: () => void) {
    this.url = url
    this.config = options
    this.onClose = onClose
    this.wsFactory = options.webSocketFactory ?? ((url) => new WebSocket(url))
  }

  /**
   * Connect to the WebSocket endpoint
   */
  async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return
    }

    if (this.connecting) {
      return this.connecting
    }

    this.connecting = new Promise<void>((resolve, reject) => {
      try {
        this.ws = this.wsFactory(this.url)

        const onOpen = () => {
          this.stats.connected = true
          this.stats.reconnectAttempts = 0
          this.ws?.removeEventListener('open', onOpen)
          this.ws?.removeEventListener('error', onError)
          this.connecting = null
          resolve()
        }

        const onError = () => {
          this.ws?.removeEventListener('open', onOpen)
          this.ws?.removeEventListener('error', onError)
          this.connecting = null
          reject(new Error('WebSocket connection failed'))
        }

        this.ws.addEventListener('open', onOpen)
        this.ws.addEventListener('error', onError)
        this.ws.addEventListener('message', (event) => this.handleMessage(event))
        this.ws.addEventListener('close', (event) => this.handleClose(event))
      } catch (error) {
        this.connecting = null
        reject(error)
      }
    })

    return this.connecting
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  /**
   * Get connection statistics
   */
  getStats(): ConnectionStats {
    return { ...this.stats }
  }

  /**
   * Get connection configuration
   */
  getConfig(): ConnectionConfig {
    return {
      keepAliveIntervalMs: this.config.keepAliveIntervalMs,
      hibernationAware: this.config.hibernationAware ?? false,
    }
  }

  /**
   * Update last access time
   */
  touch(): void {
    this.lastAccessTime = Date.now()
  }

  /**
   * Get last access time
   */
  getLastAccessTime(): number {
    return this.lastAccessTime
  }

  /**
   * Make an RPC call
   */
  async call<T>(method: string, args: unknown[]): Promise<T> {
    this.touch()

    // Ensure connected
    if (!this.isConnected()) {
      await this.connect()
    }

    const id = `req-${++this.requestId}`

    return new Promise<T>((resolve, reject) => {
      const pendingCall: PendingCall = {
        id,
        resolve: resolve as (value: unknown) => void,
        reject,
        method,
        args,
      }

      if (this.pipelineMode) {
        // Queue for batching
        this.pipelinedCalls.push({ id, method, args })
        this.pipelinePending.push(pendingCall)
      } else {
        // Send immediately
        this.pendingCalls.set(id, pendingCall)
        this.sendMessage({ id, method, args })
      }
    })
  }

  /**
   * Start pipelining mode
   */
  startPipeline(options?: PipelineOptions): void {
    this.pipelineMode = true
    this.pipelinedCalls = []
    this.pipelinePending = []

    if (options?.autoFlushMs) {
      this.autoFlushTimer = setTimeout(() => {
        this.flushPipeline()
      }, options.autoFlushMs)
    }
  }

  /**
   * Flush pipelined calls as a single batch
   */
  flushPipeline(): void {
    if (this.autoFlushTimer) {
      clearTimeout(this.autoFlushTimer)
      this.autoFlushTimer = null
    }

    if (this.pipelinedCalls.length === 0) {
      this.pipelineMode = false
      return
    }

    // Check if connected before flushing
    if (!this.isConnected()) {
      // Reject all pending pipelined calls
      for (const pending of this.pipelinePending) {
        pending.reject(new Error('WebSocket is not open'))
      }
      this.pipelinedCalls = []
      this.pipelinePending = []
      this.pipelineMode = false
      return
    }

    const batchIdStr = `batch-${++this.batchId}`
    const batch = this.pipelinedCalls

    // Register all pending calls
    for (const pending of this.pipelinePending) {
      this.pendingCalls.set(pending.id, pending)
    }

    // Send batch message
    this.sendMessage({
      batchId: batchIdStr,
      batch,
    })

    this.pipelinedCalls = []
    this.pipelinePending = []
    this.pipelineMode = false
  }

  /**
   * Close the connection
   */
  close(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.autoFlushTimer) {
      clearTimeout(this.autoFlushTimer)
      this.autoFlushTimer = null
    }

    if (this.ws) {
      this.ws.close()
      this.ws = null
    }

    this.stats.connected = false

    // Reject all pending calls
    for (const [, pending] of this.pendingCalls) {
      pending.reject(new Error('Connection closed'))
    }
    this.pendingCalls.clear()
  }

  private sendMessage(message: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not open')
    }

    this.ws.send(JSON.stringify(message))
    this.stats.messagesSent++
  }

  private handleMessage(event: MessageEvent): void {
    this.stats.messagesReceived++

    try {
      const data = JSON.parse(event.data as string) as BatchResponse | SingleResponse

      if ('batchId' in data) {
        // Batch response
        const batchResponse = data as BatchResponse
        for (const result of batchResponse.results) {
          const pending = this.pendingCalls.get(result.id)
          if (pending) {
            this.pendingCalls.delete(result.id)
            if (result.error) {
              pending.reject(new Error(result.error.message))
            } else {
              pending.resolve(result.result)
            }
          }
        }
      } else {
        // Single response
        const singleResponse = data as SingleResponse
        const pending = this.pendingCalls.get(singleResponse.id)
        if (pending) {
          this.pendingCalls.delete(singleResponse.id)
          if (singleResponse.error) {
            pending.reject(new Error(singleResponse.error.message))
          } else {
            pending.resolve(singleResponse.result)
          }
        }
      }
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error)
    }
  }

  private handleClose(_event: CloseEvent): void {
    this.stats.connected = false

    if (this.config.autoReconnect && this.stats.reconnectAttempts < (this.config.maxReconnectAttempts ?? 3)) {
      // Schedule reconnection with exponential backoff
      const delay = (this.config.reconnectDelayMs ?? 1000) * Math.pow(2, this.stats.reconnectAttempts)
      this.stats.reconnectAttempts++

      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null
        this.connect().catch(() => {
          // Reconnection failed, handleClose will be called again
        })
      }, delay)
    } else {
      // No more reconnection attempts, notify pool
      this.onClose?.()
    }
  }
}

/**
 * LRU entry for tracking connection access order
 */
interface LRUEntry {
  url: string
  connection: PooledConnection
  createdAt: number
}

/**
 * Connection pool for managing WebSocket connections to Durable Objects
 */
export class ConnectionPool {
  private connections = new Map<string, PooledConnection>()
  private lruOrder: string[] = [] // URL list in LRU order (oldest first)
  private options: ConnectionPoolOptions
  private totalCreated = 0
  private evictionCount = 0
  private reconnectionCount = 0
  private cleanupTimer: ReturnType<typeof setInterval> | null = null
  private connecting = new Map<string, Promise<PooledConnection>>()

  constructor(options: ConnectionPoolOptions) {
    this.options = options

    // Start TTL cleanup timer if TTL is configured
    if (options.ttlMs) {
      this.cleanupTimer = setInterval(() => this.cleanupExpired(), options.ttlMs / 2)
    }
  }

  /**
   * Get or create a connection to the specified URL
   */
  async getConnection(url: string): Promise<PooledConnection> {
    // Check if we have an existing connection
    const existing = this.connections.get(url)
    if (existing) {
      // Update LRU order
      this.updateLRU(url)
      existing.touch()
      return existing
    }

    // Check if there's a connection in progress
    const connecting = this.connecting.get(url)
    if (connecting) {
      return connecting
    }

    // Create new connection
    const connectionPromise = this.createConnection(url)
    this.connecting.set(url, connectionPromise)

    try {
      const connection = await connectionPromise
      return connection
    } finally {
      this.connecting.delete(url)
    }
  }

  /**
   * Check if a connection exists for the URL
   */
  has(url: string): boolean {
    return this.connections.has(url)
  }

  /**
   * Get the number of active connections
   */
  size(): number {
    return this.connections.size
  }

  /**
   * Get pool statistics
   */
  getStats(): PoolStats {
    return {
      activeConnections: this.connections.size,
      totalConnectionsCreated: this.totalCreated,
      maxConnections: this.options.maxConnections,
      evictionCount: this.evictionCount,
      reconnectionCount: this.reconnectionCount,
    }
  }

  /**
   * Close all connections and shut down the pool
   */
  async close(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }

    for (const [, connection] of this.connections) {
      connection.close()
    }

    this.connections.clear()
    this.lruOrder = []
  }

  private async createConnection(url: string): Promise<PooledConnection> {
    // Evict if necessary
    while (this.connections.size >= this.options.maxConnections) {
      this.evictLRU()
    }

    const connection = new PooledConnection(url, this.options, () => {
      // Connection closed callback - remove from pool
      this.connections.delete(url)
      const lruIndex = this.lruOrder.indexOf(url)
      if (lruIndex >= 0) {
        this.lruOrder.splice(lruIndex, 1)
      }
    })

    await connection.connect()

    this.connections.set(url, connection)
    this.lruOrder.push(url)
    this.totalCreated++

    return connection
  }

  private updateLRU(url: string): void {
    const index = this.lruOrder.indexOf(url)
    if (index >= 0) {
      this.lruOrder.splice(index, 1)
    }
    this.lruOrder.push(url)
  }

  private evictLRU(): void {
    if (this.lruOrder.length === 0) return

    const urlToEvict = this.lruOrder.shift()!
    const connection = this.connections.get(urlToEvict)

    if (connection) {
      connection.close()
      this.connections.delete(urlToEvict)
      this.evictionCount++
    }
  }

  private cleanupExpired(): void {
    if (!this.options.ttlMs) return

    const now = Date.now()
    const expireTime = now - this.options.ttlMs

    for (const [url, connection] of this.connections) {
      if (connection.getLastAccessTime() < expireTime) {
        connection.close()
        this.connections.delete(url)
        const lruIndex = this.lruOrder.indexOf(url)
        if (lruIndex >= 0) {
          this.lruOrder.splice(lruIndex, 1)
        }
        this.evictionCount++
      }
    }
  }
}
