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
// WebSocketHub - Connection management and broadcasting
// ============================================================================

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

    this._wsRooms.delete(ws)
    this._connections.delete(ws)
  }

  getMetadata(ws: WebSocket): Record<string, unknown> | undefined {
    return this._connections.get(ws)
  }

  broadcast(message: unknown, filter?: (ws: WebSocket, meta?: Record<string, unknown>) => boolean): number {
    let count = 0
    const serialized = typeof message === 'string' ? message : JSON.stringify(message)

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

  room = {
    join: (ws: WebSocket, roomId: string): void => {
      if (!this._connections.has(ws)) {
        throw new Error('WebSocket not connected')
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

    broadcast: (roomId: string, message: unknown): number => {
      const roomMembers = this._rooms.get(roomId)
      if (!roomMembers) {
        return 0
      }

      let count = 0
      const serialized = typeof message === 'string' ? message : JSON.stringify(message)

      for (const ws of roomMembers) {
        if (ws.readyState !== WebSocket.OPEN) {
          continue
        }
        ws.send(serialized)
        count++
      }

      return count
    },

    members: (roomId: string): WebSocket[] => {
      const roomMembers = this._rooms.get(roomId)
      return roomMembers ? Array.from(roomMembers) : []
    },

    rooms: (ws: WebSocket): string[] => {
      const wsRooms = this._wsRooms.get(ws)
      return wsRooms ? Array.from(wsRooms) : []
    },

    count: (roomId: string): number => {
      const roomMembers = this._rooms.get(roomId)
      return roomMembers ? roomMembers.size : 0
    },
  }
}

// ============================================================================
// SSE Streaming - Server-Sent Events
// ============================================================================

export interface SSEEvent {
  event?: string
  data: unknown
  id?: string
  retry?: number
}

export interface SSEStream {
  send(event: SSEEvent): void
  close(): void
  comment(text: string): void
}

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

      // Handle data
      const dataStr = typeof event.data === 'object'
        ? JSON.stringify(event.data)
        : String(event.data)

      // Split multiline data
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

export interface BackpressureOptions {
  mode: 'pause' | 'drop' | 'buffer'
  highWaterMark: number
  lowWaterMark?: number
  bufferLimit?: number
  warningThreshold?: number
  onPause?: () => void
  onResume?: () => void
  onWarning?: (info: { bufferSize: number; bufferLimit: number; utilizationPercent: number }) => void
}

export interface PushResult {
  accepted: boolean
  reason?: 'paused' | 'buffer_full'
  dropped?: boolean
  droppedMessage?: { data: unknown }
}

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
    this._bufferLimit = options.bufferLimit ?? options.highWaterMark * 10
    this._warningThreshold = options.warningThreshold ?? 0.8
    this._onPause = options.onPause
    this._onResume = options.onResume
    this._onWarning = options.onWarning
  }

  get isPaused(): boolean {
    return this._isPaused
  }

  get bufferSize(): number {
    return this._buffer.length
  }

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

export interface RateLimiterOptions {
  bucketSize: number
  refillRate: number
  perClient?: boolean
}

export interface RateLimiterStatus {
  availableTokens: number
  bucketSize: number
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

export class SubscriptionManager {
  private _subscriptions = new Map<WebSocket, Set<string>>()
  private _topics = new Map<string, Set<WebSocket>>()

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

  isSubscribed(ws: WebSocket, topic: string): boolean {
    const wsTopics = this._subscriptions.get(ws)
    return wsTopics?.has(topic) ?? false
  }

  getSubscriptions(ws: WebSocket): string[] {
    const wsTopics = this._subscriptions.get(ws)
    return wsTopics ? Array.from(wsTopics) : []
  }

  getSubscribers(topic: string): WebSocket[] {
    const topicSubs = this._topics.get(topic)
    return topicSubs ? Array.from(topicSubs) : []
  }

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

  getTopicStats(): Map<string, number> {
    const stats = new Map<string, number>()
    for (const [topic, subs] of this._topics) {
      stats.set(topic, subs.size)
    }
    return stats
  }
}

// ============================================================================
// matchesTopic - Topic pattern matching
// ============================================================================

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
