/**
 * Streaming Infrastructure Module
 *
 * Exports for:
 * - WebSocketHub: Connection management and broadcasting
 * - SSEStream: Server-Sent Events streaming
 * - BackpressureController: Flow control
 * - RateLimiter: Token bucket rate limiting
 * - SubscriptionManager: Topic-based pub/sub
 */

// ============================================================================
// Rate Limit Constants
// ============================================================================

const DEFAULT_BUFFER_LIMIT_MULTIPLIER = 10
const DEFAULT_WARNING_THRESHOLD = 0.8

// ============================================================================
// WebSocketHub - Connection management and broadcasting
// ============================================================================

/**
 * WebSocketHub manages WebSocket connections, rooms, and broadcasting.
 *
 * Features:
 * - Connection tracking with optional metadata
 * - Room management for grouping connections
 * - Broadcast to all or filtered connections
 * - Cleanup of stale/closed connections
 * - Resource disposal
 */
export class WebSocketHub {
  private _connections = new Map<WebSocket, Record<string, unknown> | undefined>()
  private _rooms = new Map<string, Set<WebSocket>>()
  private _wsRooms = new Map<WebSocket, Set<string>>()

  get connections(): Set<WebSocket> {
    return new Set(this._connections.keys())
  }

  get connectionCount(): number {
    return this._connections.size
  }

  connect(ws: WebSocket, metadata?: Record<string, unknown>): void {
    this._connections.set(ws, metadata)
    this._wsRooms.set(ws, new Set())
  }

  disconnect(ws: WebSocket): void {
    if (!this._connections.has(ws)) {
      return
    }

    // Clean up room memberships
    this._cleanupWSRooms(ws)

    this._wsRooms.delete(ws)
    this._connections.delete(ws)
  }

  /**
   * Clean up all room memberships for a WebSocket.
   * Removes the WebSocket from rooms and deletes empty rooms.
   */
  private _cleanupWSRooms(ws: WebSocket): void {
    const rooms = this._wsRooms.get(ws)
    if (rooms) {
      for (const roomId of rooms) {
        const roomMembers = this._rooms.get(roomId)
        if (roomMembers) {
          roomMembers.delete(ws)
          if (roomMembers.size === 0) {
            this._rooms.delete(roomId)
          }
        }
      }
    }
  }

  getMetadata(ws: WebSocket): Record<string, unknown> | undefined {
    return this._connections.get(ws)
  }

  /**
   * Broadcast a message to all connected WebSockets.
   * Optionally filters connections before sending.
   */
  broadcast(message: unknown, filter?: (ws: WebSocket, meta?: Record<string, unknown>) => boolean): number {
    let count = 0
    const serialized = this._serializeMessage(message)

    for (const [ws, meta] of this._connections) {
      if (ws.readyState !== WebSocket.OPEN) {
        continue
      }
      if (filter && !filter(ws, meta)) {
        continue
      }
      ws.send(serialized)
      count++
    }

    return count
  }

  /**
   * Serialize a message to a string.
   */
  private _serializeMessage(message: unknown): string {
    return typeof message === 'string' ? message : JSON.stringify(message)
  }

  /**
   * Room management methods: join, leave, broadcast, members, rooms, count.
   */
  room = {
    /**
     * Add a WebSocket to a room.
     * Throws if the WebSocket is not connected to the hub.
     */
    join: (ws: WebSocket, roomId: string): void => {
      if (!this._connections.has(ws)) {
        throw new Error('WebSocket not connected to hub')
      }

      let roomMembers = this._rooms.get(roomId)
      if (!roomMembers) {
        roomMembers = new Set()
        this._rooms.set(roomId, roomMembers)
      }
      roomMembers.add(ws)

      const wsRooms = this._wsRooms.get(ws)!
      wsRooms.add(roomId)
    },

    /**
     * Remove a WebSocket from a room.
     * Deletes the room if no members remain.
     */
    leave: (ws: WebSocket, roomId: string): void => {
      const roomMembers = this._rooms.get(roomId)
      if (roomMembers) {
        roomMembers.delete(ws)
        if (roomMembers.size === 0) {
          this._rooms.delete(roomId)
        }
      }

      const wsRooms = this._wsRooms.get(ws)
      if (wsRooms) {
        wsRooms.delete(roomId)
      }
    },

    /**
     * Broadcast a message to all members of a room.
     * Returns count of messages sent.
     */
    broadcast: (roomId: string, message: unknown): number => {
      const roomMembers = this._rooms.get(roomId)
      if (!roomMembers) {
        return 0
      }

      let count = 0
      const serialized = this._serializeMessage(message)

      for (const ws of roomMembers) {
        if (ws.readyState !== WebSocket.OPEN) {
          continue
        }
        ws.send(serialized)
        count++
      }

      return count
    },

    /**
     * Get all members of a room.
     */
    members: (roomId: string): WebSocket[] => {
      const roomMembers = this._rooms.get(roomId)
      return roomMembers ? Array.from(roomMembers) : []
    },

    /**
     * Get all rooms a WebSocket is a member of.
     */
    rooms: (ws: WebSocket): string[] => {
      const wsRooms = this._wsRooms.get(ws)
      return wsRooms ? Array.from(wsRooms) : []
    },

    /**
     * Get the number of members in a room.
     */
    count: (roomId: string): number => {
      const roomMembers = this._rooms.get(roomId)
      return roomMembers ? roomMembers.size : 0
    },
  }

  /**
   * Close a WebSocket connection and clean up all associated resources.
   * Disconnects from hub and calls ws.close().
   */
  close(ws: WebSocket): void {
    if (!this._connections.has(ws)) {
      return
    }
    this.disconnect(ws)
    ws.close()
  }

  /**
   * Close all WebSocket connections and clean up resources.
   */
  closeAll(): void {
    for (const ws of this._connections.keys()) {
      this.close(ws)
    }
  }

  /**
   * Dispose of the hub, closing all connections and clearing all state.
   * After calling this, the hub should not be used further.
   */
  dispose(): void {
    this.closeAll()
    this._connections.clear()
    this._rooms.clear()
    this._wsRooms.clear()
  }

  /**
   * Clean up stale/closed WebSocket connections.
   * Removes connections that are in CLOSED or CLOSING state.
   * Returns the number of connections removed.
   */
  cleanupStale(): number {
    let removed = 0
    for (const ws of this._connections.keys()) {
      if (ws.readyState !== WebSocket.OPEN && ws.readyState !== WebSocket.CONNECTING) {
        this.disconnect(ws)
        removed++
      }
    }
    return removed
  }
}

// ============================================================================
// SSE Streaming - Server-Sent Events
// ============================================================================

/**
 * SSE event to be sent to the client.
 */
export interface SSEEvent {
  /** Event type identifier */
  event?: string
  /** Event data (string or object) */
  data: unknown
  /** Event ID for client reconnection */
  id?: string
  /** Client reconnection interval in milliseconds */
  retry?: number
}

/**
 * SSEStream interface for sending Server-Sent Events.
 *
 * Usage:
 * ```typescript
 * const { response, stream } = createSSEStream()
 * stream.send({ event: 'message', data: 'hello' })
 * stream.close()
 * ```
 */
export interface SSEStream {
  /** Send an SSE event to the client */
  send(event: SSEEvent): void
  /** Close the stream */
  close(): void
  /** Send a comment (for keep-alive pings) */
  comment(text: string): void
}

/**
 * Create a Server-Sent Events stream.
 *
 * Returns both the Response to send to the client and the stream object
 * for sending events.
 *
 * Usage:
 * ```typescript
 * const { response, stream } = createSSEStream()
 * // Send the response to client
 * return response
 * // Then send events
 * stream.send({ data: 'hello' })
 * ```
 */
export function createSSEStream(): { response: Response; stream: SSEStream } {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  let closed = false
  const encoder = new TextEncoder()

  const readableStream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl
    },
  })

  const response = new Response(readableStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })

  const stream: SSEStream = {
    send(event: SSEEvent): void {
      if (closed) {
        throw new Error('Stream is closed')
      }

      let output = ''

      if (event.event) {
        output += `event: ${event.event}\n`
      }

      if (event.id !== undefined) {
        output += `id: ${event.id}\n`
      }

      if (event.retry !== undefined) {
        output += `retry: ${event.retry}\n`
      }

      // Handle data: serialize to string and split multiline
      const dataStr = typeof event.data === 'object'
        ? JSON.stringify(event.data)
        : String(event.data)

      const lines = dataStr.split('\n')
      for (const line of lines) {
        output += `data: ${line}\n`
      }

      output += '\n'

      controller?.enqueue(encoder.encode(output))
    },

    close(): void {
      if (!closed) {
        closed = true
        controller?.close()
      }
    },

    comment(text: string): void {
      if (closed) {
        throw new Error('Stream is closed')
      }
      controller?.enqueue(encoder.encode(`: ${text}\n\n`))
    },
  }

  return { response, stream }
}

// ============================================================================
// BackpressureController - Flow control
// ============================================================================

/**
 * Options for BackpressureController.
 *
 * Modes:
 * - 'pause': Pauses ingestion when highWaterMark is reached, resumes at lowWaterMark
 * - 'drop': Drops oldest messages when highWaterMark is reached
 * - 'buffer': Buffers messages up to bufferLimit, rejects when full
 */
export interface BackpressureOptions {
  /** 'pause', 'drop', or 'buffer' */
  mode: 'pause' | 'drop' | 'buffer'
  /** Threshold to trigger backpressure action */
  highWaterMark: number
  /** Threshold to resume (pause mode only) */
  lowWaterMark?: number
  /** Maximum buffer size (buffer mode only) */
  bufferLimit?: number
  /** Utilization threshold for warning (buffer mode only, 0-1) */
  warningThreshold?: number
  /** Called when entering paused state */
  onPause?: () => void
  /** Called when exiting paused state */
  onResume?: () => void
  /** Called when buffer utilization exceeds threshold */
  onWarning?: (info: { bufferSize: number; bufferLimit: number; utilizationPercent: number }) => void
}

/**
 * Result of pushing a message to the backpressure controller.
 */
export interface PushResult {
  /** Whether the message was accepted */
  accepted: boolean
  /** Reason for rejection, if any */
  reason?: 'paused' | 'buffer_full'
  /** Whether a message was dropped (drop mode) */
  dropped?: boolean
  /** The dropped message, if any */
  droppedMessage?: { data: unknown }
}

/**
 * BackpressureController manages flow control for streaming data.
 *
 * Supports three modes:
 * - Pause: Pauses writes when buffer exceeds highWaterMark
 * - Drop: Drops oldest messages when buffer is full
 * - Buffer: Buffers up to a limit, rejects when full
 */
export class BackpressureController {
  private _buffer: Array<{ data: unknown }> = []
  private _isPaused = false
  private _mode: 'pause' | 'drop' | 'buffer'
  private _highWaterMark: number
  private _lowWaterMark: number
  private _bufferLimit: number
  private _warningThreshold: number
  private _warningEmitted = false
  private _onPause?: () => void
  private _onResume?: () => void
  private _onWarning?: (info: { bufferSize: number; bufferLimit: number; utilizationPercent: number }) => void

  constructor(options: BackpressureOptions) {
    this._mode = options.mode
    this._highWaterMark = options.highWaterMark
    this._lowWaterMark = options.lowWaterMark ?? Math.floor(options.highWaterMark / 2)
    this._bufferLimit = options.bufferLimit ?? options.highWaterMark * DEFAULT_BUFFER_LIMIT_MULTIPLIER
    this._warningThreshold = options.warningThreshold ?? DEFAULT_WARNING_THRESHOLD
    this._onPause = options.onPause
    this._onResume = options.onResume
    this._onWarning = options.onWarning
  }

  /**
   * Whether the controller is currently paused.
   */
  get isPaused(): boolean {
    return this._isPaused
  }

  /**
   * Current buffer size.
   */
  get bufferSize(): number {
    return this._buffer.length
  }

  /**
   * Push a message to the buffer.
   * Behavior depends on the mode and buffer state.
   */
  push(message: { data: unknown }): PushResult {
    if (this._mode === 'pause') {
      return this._pushPauseMode(message)
    } else if (this._mode === 'drop') {
      return this._pushDropMode(message)
    } else {
      return this._pushBufferMode(message)
    }
  }

  private _pushPauseMode(message: { data: unknown }): PushResult {
    if (this._isPaused) {
      return { accepted: false, reason: 'paused' }
    }

    this._buffer.push(message)

    if (this._buffer.length >= this._highWaterMark) {
      this._isPaused = true
      this._onPause?.()
    }

    return { accepted: true }
  }

  private _pushDropMode(message: { data: unknown }): PushResult {
    if (this._buffer.length >= this._highWaterMark) {
      // Drop the oldest message
      const dropped = this._buffer.shift()!
      this._buffer.push(message)
      return { accepted: true, dropped: true, droppedMessage: dropped }
    }

    this._buffer.push(message)
    return { accepted: true }
  }

  private _pushBufferMode(message: { data: unknown }): PushResult {
    if (this._buffer.length >= this._bufferLimit) {
      return { accepted: false, reason: 'buffer_full' }
    }

    this._buffer.push(message)

    // Check warning threshold
    const utilization = this._buffer.length / this._bufferLimit
    const utilizationPercent = Math.floor(utilization * 100)

    if (utilization > this._warningThreshold && !this._warningEmitted) {
      this._warningEmitted = true
      this._onWarning?.({
        bufferSize: this._buffer.length,
        bufferLimit: this._bufferLimit,
        utilizationPercent,
      })
    }

    return { accepted: true }
  }

  /**
   * Drain (remove and return) the oldest message from the buffer.
   * Updates pause/resume state in pause mode.
   */
  drain(): { data: unknown } | undefined {
    const message = this._buffer.shift()

    // Check if we should resume in pause mode
    if (this._mode === 'pause' && this._isPaused && this._buffer.length <= this._lowWaterMark) {
      this._isPaused = false
      this._onResume?.()
    }

    // Reset warning emitted flag if we drained below threshold
    if (this._mode === 'buffer' && this._buffer.length / this._bufferLimit < this._warningThreshold) {
      this._warningEmitted = false
    }

    return message
  }

  /**
   * Clear all buffered messages and reset state.
   */
  clear(): void {
    this._buffer = []
    if (this._isPaused) {
      this._isPaused = false
      this._onResume?.()
    }
    this._warningEmitted = false
  }
}

// ============================================================================
// RateLimiter - Token Bucket Algorithm
// ============================================================================

/**
 * Options for RateLimiter (Token Bucket).
 */
export interface RateLimiterOptions {
  /** Maximum tokens in the bucket */
  bucketSize: number
  /** Tokens to add per second */
  refillRate: number
  /** Whether to maintain separate buckets per client */
  perClient?: boolean
}

/**
 * Current status of a rate limiter bucket.
 */
export interface RateLimiterStatus {
  /** Currently available tokens */
  availableTokens: number
  /** Maximum bucket capacity */
  bucketSize: number
  /** Token refill rate (per second) */
  refillRate: number
}

interface TokenBucket {
  tokens: number
  lastRefill: number
}

class RateLimiterImpl {
  _bucketSize: number
  _refillRate: number
  _perClient: boolean
  _globalBucket: TokenBucket
  _clientBuckets = new Map<string, TokenBucket>()

  constructor(options: RateLimiterOptions) {
    this._bucketSize = options.bucketSize
    this._refillRate = options.refillRate
    this._perClient = options.perClient ?? false
    this._globalBucket = {
      tokens: this._bucketSize,
      lastRefill: Date.now(),
    }
  }

  _getBucket(clientId?: string): TokenBucket {
    if (!this._perClient || !clientId) {
      return this._globalBucket
    }

    let bucket = this._clientBuckets.get(clientId)
    if (!bucket) {
      bucket = {
        tokens: this._bucketSize,
        lastRefill: Date.now(),
      }
      this._clientBuckets.set(clientId, bucket)
    }
    return bucket
  }

  _refillBucket(bucket: TokenBucket): void {
    const now = Date.now()
    const elapsed = (now - bucket.lastRefill) / 1000 // seconds
    const tokensToAdd = elapsed * this._refillRate
    bucket.tokens = Math.min(this._bucketSize, bucket.tokens + tokensToAdd)
    bucket.lastRefill = now
  }

  _getAvailableTokens(clientId?: string): number {
    const bucket = this._getBucket(clientId)
    this._refillBucket(bucket)
    return Math.floor(bucket.tokens)
  }

  tryAcquire(tokens: number = 1, clientId?: string): boolean {
    const bucket = this._getBucket(clientId)
    this._refillBucket(bucket)

    if (bucket.tokens >= tokens) {
      bucket.tokens -= tokens
      return true
    }

    return false
  }

  /**
   * Wait for a token to become available.
   * Respects the timeout option and throws if timeout is exceeded.
   */
  async waitForToken(options?: { timeout?: number }): Promise<void> {
    // Check if we can acquire immediately
    if (this.tryAcquire()) {
      return
    }

    const timeout = options?.timeout
    const startTime = Date.now()

    // Calculate when tokens would be available based on refill rate
    if (timeout !== undefined && this._refillRate > 0) {
      // Calculate time needed to refill 1 token
      const currentTokens = this._globalBucket.tokens
      const tokensNeeded = 1 - currentTokens
      const timeToRefill = (tokensNeeded / this._refillRate) * 1000 // ms

      // If it would take longer than timeout to get a token, reject immediately
      if (timeToRefill > timeout) {
        throw new Error('Timeout waiting for token')
      }
    }

    return new Promise<void>((resolve, reject) => {
      let cancelled = false

      const check = () => {
        if (cancelled) return

        // Check timeout using Date.now() which is affected by vi.advanceTimersByTime
        if (timeout !== undefined) {
          const elapsed = Date.now() - startTime
          if (elapsed >= timeout) {
            reject(new Error('Timeout waiting for token'))
            return
          }
        }

        this._refillBucket(this._globalBucket)
        if (this._globalBucket.tokens >= 1) {
          this._globalBucket.tokens -= 1
          resolve()
          return
        }

        // Schedule next check with setTimeout (works with fake timers when time is advanced)
        setTimeout(check, 10)
      }

      // Set up timeout rejection
      if (timeout !== undefined) {
        setTimeout(() => {
          cancelled = true
          reject(new Error('Timeout waiting for token'))
        }, timeout)
      }

      // Start checking
      setTimeout(check, 10)
    })
  }

  getStatus(clientId?: string): RateLimiterStatus {
    const bucket = this._getBucket(clientId)
    this._refillBucket(bucket)

    return {
      availableTokens: Math.floor(bucket.tokens),
      bucketSize: this._bucketSize,
      refillRate: this._refillRate,
    }
  }

  reset(clientId?: string): void {
    if (this._perClient && clientId) {
      const bucket = this._getBucket(clientId)
      bucket.tokens = this._bucketSize
      bucket.lastRefill = Date.now()
    } else if (!clientId) {
      this._globalBucket.tokens = this._bucketSize
      this._globalBucket.lastRefill = Date.now()
    }
  }
}

// Proxy-based RateLimiter that makes availableTokens work as both property and method
export interface RateLimiter extends RateLimiterImpl {
  availableTokens: number & ((clientId?: string) => number)
}

export const RateLimiter = function(this: RateLimiterImpl, options: RateLimiterOptions) {
  const impl = new RateLimiterImpl(options)

  return new Proxy(impl, {
    get(target, prop, receiver) {
      if (prop === 'availableTokens') {
        // For perClient mode, return a callable function
        // For non-perClient mode, return the number directly
        if (target._perClient) {
          return (clientId?: string) => target._getAvailableTokens(clientId)
        } else {
          return target._getAvailableTokens()
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  })
} as unknown as new (options: RateLimiterOptions) => RateLimiter

// ============================================================================
// SubscriptionManager - Topic-based pub/sub
// ============================================================================

/**
 * SubscriptionManager provides topic-based pub/sub with pattern matching.
 *
 * Features:
 * - Subscribe/unsubscribe from topics
 * - Publish to topic with pattern matching (* and ** wildcards)
 * - Topic statistics and monitoring
 * - Cleanup of stale connections
 *
 * Pattern matching:
 * - Exact match: 'orders.created'
 * - Single wildcard: 'orders.*' (matches orders.created, orders.updated, etc.)
 * - Double wildcard: 'orders.**' (matches orders.created, orders.items.added, etc.)
 */
export class SubscriptionManager {
  private _subscriptions = new Map<WebSocket, Set<string>>()
  private _topics = new Map<string, Set<WebSocket>>()

  /**
   * Subscribe a WebSocket to a topic.
   * Topic can be an exact match or a pattern (*, **).
   */
  subscribe(ws: WebSocket, topic: string): void {
    // Add to ws -> topics mapping
    let wsTopics = this._subscriptions.get(ws)
    if (!wsTopics) {
      wsTopics = new Set()
      this._subscriptions.set(ws, wsTopics)
    }
    wsTopics.add(topic)

    // Add to topic -> ws mapping
    let topicSubs = this._topics.get(topic)
    if (!topicSubs) {
      topicSubs = new Set()
      this._topics.set(topic, topicSubs)
    }
    topicSubs.add(ws)
  }

  /**
   * Unsubscribe a WebSocket from a specific topic.
   * Removes the topic if no subscribers remain.
   */
  unsubscribe(ws: WebSocket, topic: string): void {
    // Remove from ws -> topics
    const wsTopics = this._subscriptions.get(ws)
    if (wsTopics) {
      wsTopics.delete(topic)
    }

    // Remove from topic -> ws
    const topicSubs = this._topics.get(topic)
    if (topicSubs) {
      topicSubs.delete(ws)
      if (topicSubs.size === 0) {
        this._topics.delete(topic)
      }
    }
  }

  /**
   * Unsubscribe a WebSocket from all topics.
   * Removes topics that have no subscribers left.
   */
  unsubscribeAll(ws: WebSocket): void {
    const wsTopics = this._subscriptions.get(ws)
    if (wsTopics) {
      for (const topic of wsTopics) {
        const topicSubs = this._topics.get(topic)
        if (topicSubs) {
          topicSubs.delete(ws)
          if (topicSubs.size === 0) {
            this._topics.delete(topic)
          }
        }
      }
      this._subscriptions.delete(ws)
    }
  }

  /**
   * Check if a WebSocket is subscribed to a topic.
   */
  isSubscribed(ws: WebSocket, topic: string): boolean {
    const wsTopics = this._subscriptions.get(ws)
    return wsTopics?.has(topic) ?? false
  }

  /**
   * Get all topics a WebSocket is subscribed to.
   */
  getSubscriptions(ws: WebSocket): string[] {
    const wsTopics = this._subscriptions.get(ws)
    return wsTopics ? Array.from(wsTopics) : []
  }

  /**
   * Get all WebSockets subscribed to a topic.
   */
  getSubscribers(topic: string): WebSocket[] {
    const topicSubs = this._topics.get(topic)
    return topicSubs ? Array.from(topicSubs) : []
  }

  /**
   * Publish a message to all subscribers of a topic.
   * Supports pattern matching for subscriptions.
   * Returns the count of WebSockets that received the message.
   */
  publish(topic: string, message: unknown): number {
    const serialized = JSON.stringify(message)
    const notified = new Set<WebSocket>()

    // First, notify exact subscribers
    const exactSubs = this._topics.get(topic)
    if (exactSubs) {
      for (const ws of exactSubs) {
        if (ws.readyState === WebSocket.OPEN && !notified.has(ws)) {
          ws.send(serialized)
          notified.add(ws)
        }
      }
    }

    // Then, check pattern subscribers
    for (const [pattern, subscribers] of this._topics) {
      if (pattern === topic) continue // Already handled exact match
      if (matchesTopic(topic, pattern)) {
        for (const ws of subscribers) {
          if (ws.readyState === WebSocket.OPEN && !notified.has(ws)) {
            ws.send(serialized)
            notified.add(ws)
          }
        }
      }
    }

    return notified.size
  }

  /**
   * Get subscriber count per topic.
   */
  getTopicStats(): Map<string, number> {
    const stats = new Map<string, number>()
    for (const [topic, subs] of this._topics) {
      stats.set(topic, subs.size)
    }
    return stats
  }

  /**
   * Clean up stale/closed WebSocket connections from all subscriptions.
   * Removes connections that are in CLOSED or CLOSING state.
   * Returns the number of connections removed.
   */
  cleanupStale(): number {
    let removed = 0
    for (const ws of this._subscriptions.keys()) {
      if (ws.readyState !== WebSocket.OPEN && ws.readyState !== WebSocket.CONNECTING) {
        this.unsubscribeAll(ws)
        removed++
      }
    }
    return removed
  }

  /**
   * Dispose of the manager, clearing all subscriptions and topics.
   * After calling this, the manager should not be used further.
   */
  dispose(): void {
    this._subscriptions.clear()
    this._topics.clear()
  }
}

// ============================================================================
// matchesTopic - Topic pattern matching
// ============================================================================

/**
 * Check if a topic matches a pattern.
 *
 * Pattern syntax:
 * - Exact match: 'orders.created'
 * - Single wildcard: 'orders.*' (matches orders.created, orders.updated, NOT orders.items.added)
 * - Double wildcard: 'orders.**' (matches orders.created, orders.items.added, orders.items.quantity.updated)
 *
 * Examples:
 * - matchesTopic('orders.created', 'orders.created') => true
 * - matchesTopic('orders.created', 'orders.*') => true
 * - matchesTopic('orders.items.added', 'orders.*') => false
 * - matchesTopic('orders.items.added', 'orders.**') => true
 */
export function matchesTopic(topic: string, pattern: string): boolean {
  if (!topic || !pattern) {
    return false
  }

  if (topic === pattern) {
    return true
  }

  const topicParts = topic.split('.')
  const patternParts = pattern.split('.')

  let ti = 0
  let pi = 0

  while (ti < topicParts.length && pi < patternParts.length) {
    const patternPart = patternParts[pi]

    if (patternPart === '**') {
      // ** matches zero or more segments
      // If this is the last pattern part, it matches everything remaining
      if (pi === patternParts.length - 1) {
        return true
      }

      // Otherwise, try to find the next pattern part in the remaining topic parts
      const nextPattern = patternParts[pi + 1]
      while (ti < topicParts.length) {
        if (topicParts[ti] === nextPattern || nextPattern === '*') {
          break
        }
        ti++
      }
      pi++
    } else if (patternPart === '*') {
      // * matches exactly one segment
      ti++
      pi++
    } else {
      // Exact match required
      if (topicParts[ti] !== patternPart) {
        return false
      }
      ti++
      pi++
    }
  }

  // Check if we've consumed all parts
  if (pi < patternParts.length) {
    // Remaining pattern parts - only ok if they're all **
    for (let i = pi; i < patternParts.length; i++) {
      if (patternParts[i] !== '**') {
        return false
      }
    }
    return true
  }

  return ti === topicParts.length
}
