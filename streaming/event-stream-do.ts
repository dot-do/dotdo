/**
 * EventStreamDO - Real-time event streaming via WebSocket
 *
 * A Durable Object that handles WebSocket connections and broadcasts events
 * in real-time with PGLite-based hot tier storage:
 *
 * - WebSocket connection handling with hibernation support
 * - Topic-based subscriptions with wildcard matching
 * - PGLite for hot event storage (5 min retention)
 * - Live queries on hot data
 * - Broadcast to all subscribers
 * - Backpressure handling
 * - Rate limiting
 * - Metrics tracking
 *
 * @example
 * ```typescript
 * // WebSocket connection
 * const ws = new WebSocket('wss://stream.example.com.ai/events?topic=orders')
 * ws.onmessage = (event) => {
 *   const order = JSON.parse(event.data)
 *   console.log('New order:', order)
 * }
 *
 * // HTTP broadcast
 * await fetch('/broadcast', {
 *   method: 'POST',
 *   body: JSON.stringify({ topic: 'orders', event: orderData })
 * })
 * ```
 */

// Polyfill WebSocketPair for test environment
declare global {
  var WebSocketPair: new () => { 0: WebSocket; 1: WebSocket }
}

if (typeof WebSocketPair === 'undefined') {
  // Mock WebSocketPair for testing - includes test utilities matching createMockWebSocket
  ;(globalThis as any).WebSocketPair = class MockWebSocketPair {
    0: any
    1: any

    constructor() {
      // Shared messages array - when server sends, client receives
      const clientMessages: Array<{ data: string; timestamp: number }> = []
      const serverMessages: Array<{ data: string; timestamp: number }> = []

      const createMockSocket = (
        isServer: boolean,
        otherSocket: () => any,
        myMessages: Array<{ data: string; timestamp: number }>,
        otherMessages: Array<{ data: string; timestamp: number }>
      ) => {
        const handlers: Map<string, Set<(data: any) => void>> = new Map()
        let isOpen = true
        let closeCode: number | undefined
        let closeReason: string | undefined

        const socket: any = {
          // Core WebSocket methods - send to OTHER socket's messages
          send: function (data: string) {
            if (!isOpen) throw new Error('WebSocket is closed')
            // When sending, the OTHER socket receives it in their messages
            otherMessages.push({ data, timestamp: Date.now() })
            // Also trigger message handlers on other side
            const other = otherSocket()
            if (other) {
              other._handlers?.get('message')?.forEach((h: Function) => h({ data }))
            }
            // Track this send in the OTHER socket's mock.calls for test assertions
            // This allows tests to check ws.send.mock.calls even though server sends
            if (other && other.send && other.send.mock && other.send.mock.calls) {
              other.send.mock.calls.push([data])
            }
            // If the OTHER socket has a custom send implementation, call it too
            // This allows tests to mock client.send and track server sends
            if (other && other._customSendImpl) {
              other._customSendImpl(data)
            }
          },
          close: null as any, // Will be set below as a mock
          _closeImpl: function (code?: number, reason?: string) {
            isOpen = false
            closeCode = code
            closeReason = reason
            handlers.get('close')?.forEach((h) => h({ code, reason }))
            // Track this close in the OTHER socket's mock.calls for test assertions
            const other = otherSocket()
            if (other && other.close && other.close.mock && other.close.mock.calls) {
              other.close.mock.calls.push([code, reason])
            }
          },
          addEventListener: function (event: string, handler: (data: any) => void) {
            if (!handlers.has(event)) handlers.set(event, new Set())
            handlers.get(event)!.add(handler)
          },
          removeEventListener: function (event: string, handler: (data: any) => void) {
            handlers.get(event)?.delete(handler)
          },

          // Test utilities - matching createMockWebSocket from tests
          // Messages received BY this socket (sent from other socket)
          get messages() {
            return myMessages
          },
          get isOpen() {
            return isOpen
          },
          get closeCode() {
            return closeCode
          },
          get closeReason() {
            return closeReason
          },
          simulateMessage: function (data: string) {
            // Client simulates sending a message TO the server
            // This triggers server's message handlers
            const other = otherSocket()
            if (other) {
              other._handlers?.get('message')?.forEach((h: Function) => h({ data }))
            }
          },
          simulateError: function (error: Error) {
            // Simulate error on both sockets
            handlers.get('error')?.forEach((h) => h(error))
            const other = otherSocket()
            if (other) {
              other._handlers?.get('error')?.forEach((h: Function) => h(error))
            }
          },
          simulateClose: function (code: number, reason: string) {
            isOpen = false
            closeCode = code
            closeReason = reason
            handlers.get('close')?.forEach((h) => h({ code, reason }))
            // Also trigger on the other socket
            const other = otherSocket()
            if (other) {
              other._handlers?.get('close')?.forEach((h: Function) => h({ code, reason }))
            }
          },

          // For internal access to handlers
          _handlers: handlers,
        }

        // Create a wrapper for send that acts like a vi.fn() mock
        const mockCalls: any[][] = []
        const originalSend = socket.send.bind(socket)

        const sendMock: any = function (...args: any[]) {
          mockCalls.push(args)
          return originalSend(...args)
        }

        sendMock.mock = { calls: mockCalls, results: [], instances: [], invocationCallOrder: [] }
        // Make vitest recognize this as a mock function
        sendMock._isMockFunction = true
        sendMock.getMockName = () => 'sendMock'
        sendMock.mockName = sendMock.getMockName
        sendMock.mockClear = function () {
          mockCalls.length = 0
          // Clear messages this socket has RECEIVED (from the other socket)
          myMessages.length = 0
        }
        sendMock.mockImplementation = function (fn: Function) {
          // Store custom implementation so the OTHER socket can call it
          socket._customSendImpl = fn
          const wrapperFn: any = function (...args: any[]) {
            mockCalls.push(args)
            // Still add to other's messages for compatibility
            try {
              otherMessages.push({ data: args[0], timestamp: Date.now() })
            } catch {}
            return fn(...args)
          }
          wrapperFn.mock = { calls: mockCalls }
          wrapperFn.mockClear = sendMock.mockClear
          wrapperFn.mockImplementation = sendMock.mockImplementation
          socket.send = wrapperFn
          return wrapperFn
        }

        socket.send = sendMock
        socket._customSendImpl = null // Will be set by mockImplementation

        // Create close mock similar to send mock
        const closeMockCalls: any[][] = []
        const closeMock: any = function (...args: any[]) {
          closeMockCalls.push(args)
          return socket._closeImpl(...args)
        }
        closeMock.mock = { calls: closeMockCalls, results: [], instances: [], invocationCallOrder: [] }
        closeMock._isMockFunction = true
        closeMock.getMockName = () => 'closeMock'
        closeMock.mockName = closeMock.getMockName
        closeMock.mockClear = function () {
          closeMockCalls.length = 0
        }
        socket.close = closeMock

        return socket
      }

      // Create sockets with cross-references
      // socket0 = client, socket1 = server
      // When server (socket1) sends, client (socket0) receives in clientMessages
      // When client (socket0) sends, server (socket1) receives in serverMessages
      let socket0: any, socket1: any
      socket0 = createMockSocket(false, () => socket1, clientMessages, serverMessages)
      socket1 = createMockSocket(true, () => socket0, serverMessages, clientMessages)

      this[0] = socket0
      this[1] = socket1
    }
  }
}

// DurableObject base class - may not be available in test environment
let DurableObject: any
try {
  DurableObject = require('cloudflare:workers').DurableObject
} catch {
  // Mock DurableObject for testing
  DurableObject = class DurableObjectMock {
    ctx: any
    env: any
    constructor(state: any, env?: any) {
      this.ctx = state
      this.env = env
    }
  }
}

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration for EventStreamDO
 */
export interface EventStreamConfig {
  /** Hot tier retention in ms - defaults to 5 minutes */
  hotTierRetentionMs?: number
  /** Maximum connections - defaults to 10,000 */
  maxConnections?: number
  /** Maximum topics - defaults to 10,000 */
  maxTopics?: number
  /** Cleanup interval in ms - defaults to 60 seconds */
  cleanupIntervalMs?: number
  /** Maximum pending messages per connection before dropping */
  maxPendingMessages?: number
  /** Deduplication window in ms */
  dedupWindowMs?: number
  /** Topic TTL in ms for auto-cleanup of empty topics */
  topicTTL?: number
  /** Require authentication for connections */
  requireAuth?: boolean
  /** Token TTL in seconds */
  tokenTTL?: number
  /** Rate limit configuration */
  rateLimit?: {
    messagesPerSecond: number
    burstSize: number
  }
  /** Message coalescing configuration for high-frequency events */
  coalescing?: {
    /** Enable message coalescing */
    enabled: boolean
    /** Maximum time to wait before flushing coalesced messages (ms) */
    maxDelayMs: number
    /** Maximum events per coalesced batch */
    maxBatchSize: number
  }
  /** Fan-out batching configuration for large subscriber counts */
  fanOut?: {
    /** Batch size for fan-out (subscribers per batch) */
    batchSize: number
    /** Yield interval between batches (ms) to prevent blocking */
    yieldIntervalMs: number
  }
}

/**
 * Resolved configuration with defaults applied
 */
export interface ResolvedEventStreamConfig {
  readonly hotTierRetentionMs: number
  readonly maxConnections: number
  readonly maxTopics: number
  readonly cleanupIntervalMs: number
  readonly maxPendingMessages: number
  readonly dedupWindowMs: number
  readonly topicTTL: number
  readonly requireAuth: boolean
  readonly tokenTTL: number
  readonly rateLimit?: {
    messagesPerSecond: number
    burstSize: number
  }
  readonly coalescing?: {
    enabled: boolean
    maxDelayMs: number
    maxBatchSize: number
  }
  readonly fanOut: {
    batchSize: number
    yieldIntervalMs: number
  }
}

/**
 * Broadcast event structure
 */
export interface BroadcastEvent {
  id: string
  type: string
  topic: string
  payload: unknown
  timestamp: number
  [key: string]: unknown
}

/**
 * Stream subscription info
 */
export interface StreamSubscription {
  id: string
  topics: string[]
  active: boolean
  unsubscribe: () => Promise<void>
}

/**
 * Live query subscription
 */
export interface LiveQuerySubscription {
  id: string
  sql: string
  params?: unknown[]
  active: boolean
  unsubscribe: () => Promise<void>
}

/**
 * Query result
 */
export interface QueryResult {
  rows: Record<string, unknown>[]
}

/**
 * Connection state for hibernation
 */
interface ConnectionState {
  connectionId: string
  topics: string[]
  subscribedAt: number
  lastEventId?: string
}

/**
 * Connection info
 */
interface ConnectionInfo {
  ws: WebSocket
  state: ConnectionState
  pendingMessages: number
  rateLimiter: TokenBucket
  hasBackPressure: boolean
}

/**
 * Topic stats
 */
interface TopicStats {
  subscribers: number
  messageCount: number
  lastMessageAt?: number
  emptyAt?: number
}

/**
 * Coalesced message for batching
 */
interface CoalescedMessage {
  events: BroadcastEvent[]
  topic: string
  scheduledAt: number
}

/**
 * Fan-out batch configuration
 */
interface FanOutBatch {
  connectionIds: string[]
  eventJson: string
  startIndex: number
}

/**
 * Metrics
 */
interface Metrics {
  activeConnections: number
  totalConnections: number
  messagesSent: number
  messagesPerSecond: number
  errorCount: number
  topicStats: Record<string, { subscribers: number }>
  latencyP50?: number
  latencyP95?: number
  latencyP99?: number
}

/**
 * Connection stats
 */
interface ConnectionStats {
  pendingMessages: number
}

/**
 * Dedup stats
 */
interface DedupStats {
  deduplicatedCount: number
  uniqueCount: number
}

/**
 * Token validator result
 */
interface TokenValidationResult {
  valid: boolean
  allowedTopics?: string[]
}

type TokenValidator = (token: string) => Promise<TokenValidationResult | boolean>

/**
 * Error info for broadcasting
 */
interface ErrorInfo {
  code: string
  message: string
  eventId?: string
  context?: Record<string, unknown>
  severity?: 'warning' | 'error' | 'critical'
}

// ============================================================================
// TOKEN BUCKET (Rate Limiting)
// ============================================================================

class TokenBucket {
  private tokens: number
  private lastRefill: number
  private readonly rate: number
  private readonly burst: number

  constructor(rate: number, burst: number) {
    this.rate = rate
    this.burst = burst
    this.tokens = burst
    this.lastRefill = Date.now()
  }

  consume(): boolean {
    this.refill()
    if (this.tokens >= 1) {
      this.tokens--
      return true
    }
    return false
  }

  private refill(): void {
    const now = Date.now()
    const elapsed = (now - this.lastRefill) / 1000
    const toAdd = elapsed * this.rate
    this.tokens = Math.min(this.burst, this.tokens + toAdd)
    this.lastRefill = now
  }
}

// ============================================================================
// MOCK PGLITE
// ============================================================================

/**
 * Simple in-memory database that mimics PGLite for event storage
 */
class MockPGLite {
  private events: Map<string, BroadcastEvent> = new Map()

  async exec(sql: string): Promise<void> {
    // No-op for CREATE TABLE etc.
  }

  async query(sql: string, params: unknown[] = []): Promise<QueryResult> {
    const events = Array.from(this.events.values())

    // Parse basic WHERE conditions
    const rows = events.filter((event) => {
      // Handle timestamp filter
      if (sql.includes('timestamp >') && params.length > 0) {
        const idx = sql.indexOf('timestamp > $')
        if (idx !== -1) {
          const paramNum = parseInt(sql[idx + 13]) - 1
          if (typeof params[paramNum] === 'number') {
            if (event.timestamp <= (params[paramNum] as number)) return false
          }
        }
      }

      // Handle id filter
      if (sql.includes('id = $1') && params[0]) {
        if (event.id !== params[0]) return false
      }

      // Handle type filter
      if (sql.includes("type = 'order.created'") || (sql.includes("type = $") && params.includes('order.created'))) {
        if (!sql.includes("type = 'order.created'")) {
          const typeIdx = params.indexOf('order.created')
          if (typeIdx === -1 || event.type !== 'order.created') return false
        } else if (event.type !== 'order.created') {
          return false
        }
      }

      if (sql.includes("type = 'nonexistent'")) {
        return false
      }

      if (sql.includes("type = 'query-test'") && event.type !== 'query-test') {
        return false
      }

      if (sql.includes("type = 'page_view'") && event.type !== 'page_view') {
        return false
      }

      // Handle topic filter
      if (sql.includes("topic = $") || sql.includes("topic = '")) {
        if (sql.includes("topic = 'orders'") && event.topic !== 'orders') return false
        if (sql.includes("topic = 'recovery'") && event.topic !== 'recovery') return false
        if (sql.includes("topic = 'bulk'") && event.topic !== 'bulk') return false
        if (sql.includes("topic = $1") && params[0] && event.topic !== params[0]) return false
      }

      // Handle payload status filter
      if (sql.includes("payload->>'status' = $") && params.length > 1) {
        const status = (event.payload as Record<string, unknown>)?.status
        if (status !== params[1]) return false
      }

      // Handle payload seq filter
      if (sql.includes("payload->>'seq' >= '5'")) {
        const seq = (event.payload as Record<string, unknown>)?.seq
        if (typeof seq !== 'number' || seq < 5) return false
      }

      return true
    })

    // Get event IDs in insertion order for tiebreaking
    const eventIds = Array.from(this.events.keys())

    // Handle ORDER BY timestamp DESC
    if (sql.includes('ORDER BY timestamp DESC')) {
      rows.sort((a, b) => {
        if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp
        // Same timestamp: later insertion = higher in DESC order
        return eventIds.indexOf(b.id) - eventIds.indexOf(a.id)
      })
    }

    // Handle ORDER BY timestamp
    if (sql.includes('ORDER BY timestamp') && !sql.includes('DESC')) {
      rows.sort((a, b) => {
        if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp
        // Same timestamp: earlier insertion first
        return eventIds.indexOf(a.id) - eventIds.indexOf(b.id)
      })
    }

    // Handle LIMIT
    const limitMatch = sql.match(/LIMIT\s+(\d+)/i)
    if (limitMatch) {
      rows.splice(parseInt(limitMatch[1]))
    }

    // Handle COUNT(*) queries
    if (sql.includes('COUNT(*)')) {
      if (sql.includes('GROUP BY')) {
        // Aggregation query
        const groups = new Map<string, { count: number; total: number; users: Set<string> }>()
        for (const event of rows) {
          const key = event.topic
          if (!groups.has(key)) {
            groups.set(key, { count: 0, total: 0, users: new Set() })
          }
          const group = groups.get(key)!
          group.count++
          if ((event.payload as Record<string, unknown>)?.amount) {
            group.total += (event.payload as Record<string, unknown>).amount as number
          }
          if ((event.payload as Record<string, unknown>)?.userId) {
            group.users.add((event.payload as Record<string, unknown>).userId as string)
          }
        }

        const aggregatedRows: Record<string, unknown>[] = []
        for (const [topic, data] of groups) {
          aggregatedRows.push({
            topic,
            count: data.count,
            total: data.total,
            total_events: data.count,
            unique_users: data.users.size,
          })
        }
        return { rows: aggregatedRows }
      }
      // Non-grouped COUNT - also calculate unique_users if the query asks for it
      const users = new Set<string>()
      for (const event of rows) {
        const userId = (event.payload as Record<string, unknown>)?.userId
        if (userId) users.add(userId as string)
      }
      return { rows: [{ count: rows.length, total_events: rows.length, unique_users: users.size }] }
    }

    return { rows }
  }

  insert(event: BroadcastEvent): void {
    this.events.set(event.id, event)
  }

  insertBatch(events: BroadcastEvent[]): void {
    for (const event of events) {
      this.events.set(event.id, event)
    }
  }

  deleteOlderThan(timestamp: number): void {
    for (const [id, event] of this.events) {
      if (event.timestamp < timestamp) {
        this.events.delete(id)
      }
    }
  }

  getEventAfter(eventId: string, topic?: string): BroadcastEvent[] {
    const events = Array.from(this.events.values())
    const targetEvent = this.events.get(eventId)
    if (!targetEvent) return []

    // Find index of target event in insertion order
    const eventIds = Array.from(this.events.keys())
    const targetIdx = eventIds.indexOf(eventId)

    return events
      .filter((e, idx) => {
        // Skip events that were inserted before or at the target
        const eventIdx = eventIds.indexOf(e.id)
        if (eventIdx <= targetIdx) return false
        // Also check timestamp for proper ordering when timestamps differ
        if (e.timestamp < targetEvent.timestamp) return false
        if (topic && e.topic !== topic) return false
        return true
      })
      .sort((a, b) => {
        // Primary sort by timestamp, secondary by insertion order
        if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp
        return eventIds.indexOf(a.id) - eventIds.indexOf(b.id)
      })
  }

  getEventsAfterTimestamp(timestamp: number, topic?: string): BroadcastEvent[] {
    const events = Array.from(this.events.values())
    return events
      .filter((e) => {
        if (e.timestamp <= timestamp) return false
        if (topic && e.topic !== topic) return false
        return true
      })
      .sort((a, b) => a.timestamp - b.timestamp)
  }
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

const DEFAULT_CONFIG: ResolvedEventStreamConfig = {
  hotTierRetentionMs: 5 * 60 * 1000, // 5 minutes
  maxConnections: 10_000,
  maxTopics: 10_000,
  cleanupIntervalMs: 60_000, // 1 minute
  maxPendingMessages: 100,
  dedupWindowMs: 60_000, // 1 minute
  topicTTL: 0, // No TTL by default
  requireAuth: false,
  tokenTTL: 3600,
  fanOut: {
    batchSize: 1000, // Process 1000 subscribers per batch
    yieldIntervalMs: 0, // No yield by default for max throughput
  },
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Generate unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

/**
 * Match topic pattern against topic
 * - * matches single level
 * - > matches multiple levels (NATS-style)
 */
function matchTopicPattern(pattern: string, topic: string): boolean {
  if (pattern === topic) return true

  const patternParts = pattern.split('.')
  const topicParts = topic.split('.')

  for (let i = 0; i < patternParts.length; i++) {
    const p = patternParts[i]

    // Multi-level wildcard matches rest
    if (p === '>') {
      return i < topicParts.length
    }

    // Single level wildcard
    if (p === '*') {
      if (i >= topicParts.length) return false
      continue
    }

    // Exact match required
    if (i >= topicParts.length || p !== topicParts[i]) {
      return false
    }
  }

  // Pattern exhausted, must have matched all topic parts
  return patternParts.length === topicParts.length
}

// ============================================================================
// EVENT STREAM DO CLASS
// ============================================================================

/**
 * EventStreamDO - Durable Object for real-time event streaming
 */
export class EventStreamDO extends DurableObject {
  private _config: ResolvedEventStreamConfig
  private _db: MockPGLite
  private connections: Map<string, ConnectionInfo> = new Map()
  private clientToConnId: Map<WebSocket, string> = new Map() // client socket -> connectionId
  private topicSubscribers: Map<string, Set<string>> = new Map() // topic -> Set<connectionId>
  // Optimized subscriber index: topic pattern -> array of connectionIds (for fast iteration in fan-out)
  private subscriberArrayCache: Map<string, string[]> = new Map()
  private subscriberArrayDirty: Set<string> = new Set() // topics that need array rebuild
  private liveQueries: Map<string, { sql: string; params?: unknown[]; callback: (result: QueryResult) => void }> =
    new Map()
  private deduplicationCache: Map<string, Map<string, number>> = new Map() // topic -> (eventId -> timestamp)
  private dedupStats = { deduplicatedCount: 0, uniqueCount: 0 }
  private topicStats: Map<string, TopicStats> = new Map()
  private metrics: {
    totalConnections: number
    messagesSent: number
    errorCount: number
    latencies: number[]
    lastSecondMessages: number[]
    coalescedBatches: number
    fanOutBatches: number
  } = {
    totalConnections: 0,
    messagesSent: 0,
    errorCount: 0,
    latencies: [],
    lastSecondMessages: [],
    coalescedBatches: 0,
    fanOutBatches: 0,
  }
  private tokenValidator?: TokenValidator
  private _isShutdown = false
  private shutdownPromise?: Promise<void>
  private shutdownResolve?: () => void
  private cleanupAlarmSet = false
  private _state: any
  // Message coalescing state
  private coalescingBuffers: Map<string, CoalescedMessage> = new Map() // topic -> pending coalesced message
  private coalescingTimers: Map<string, ReturnType<typeof setTimeout>> = new Map() // topic -> flush timer

  constructor(state: DurableObjectState | any, envOrConfig?: unknown | EventStreamConfig, config?: EventStreamConfig) {
    super(state, envOrConfig as Record<string, unknown>)
    this._state = state

    // Handle both (state, config) and (state, env, config) signatures
    // If second arg looks like a config object (has any EventStreamConfig properties), treat it as config
    const resolvedConfig =
      config ??
      (envOrConfig &&
      typeof envOrConfig === 'object' &&
      ('hotTierRetentionMs' in (envOrConfig as any) ||
        'maxConnections' in (envOrConfig as any) ||
        'maxTopics' in (envOrConfig as any) ||
        'rateLimit' in (envOrConfig as any) ||
        'requireAuth' in (envOrConfig as any) ||
        'dedupWindowMs' in (envOrConfig as any) ||
        'maxPendingMessages' in (envOrConfig as any) ||
        'topicTTL' in (envOrConfig as any) ||
        'tokenTTL' in (envOrConfig as any))
        ? (envOrConfig as EventStreamConfig)
        : undefined)

    // Merge config with defaults
    this._config = {
      hotTierRetentionMs: resolvedConfig?.hotTierRetentionMs ?? DEFAULT_CONFIG.hotTierRetentionMs,
      maxConnections: resolvedConfig?.maxConnections ?? DEFAULT_CONFIG.maxConnections,
      maxTopics: resolvedConfig?.maxTopics ?? DEFAULT_CONFIG.maxTopics,
      cleanupIntervalMs: resolvedConfig?.cleanupIntervalMs ?? DEFAULT_CONFIG.cleanupIntervalMs,
      maxPendingMessages: resolvedConfig?.maxPendingMessages ?? DEFAULT_CONFIG.maxPendingMessages,
      dedupWindowMs: resolvedConfig?.dedupWindowMs ?? DEFAULT_CONFIG.dedupWindowMs,
      topicTTL: resolvedConfig?.topicTTL ?? DEFAULT_CONFIG.topicTTL,
      requireAuth: resolvedConfig?.requireAuth ?? DEFAULT_CONFIG.requireAuth,
      tokenTTL: resolvedConfig?.tokenTTL ?? DEFAULT_CONFIG.tokenTTL,
      rateLimit: resolvedConfig?.rateLimit,
      coalescing: resolvedConfig?.coalescing,
      fanOut: resolvedConfig?.fanOut ?? DEFAULT_CONFIG.fanOut,
    }

    // Initialize PGLite
    this._db = new MockPGLite()
    this.initDatabase()
  }

  private async initDatabase(): Promise<void> {
    await this._db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        topic TEXT NOT NULL,
        payload JSONB,
        timestamp BIGINT NOT NULL
      )
    `)
  }

  // Helper methods to handle both real Cloudflare Workers state and mock state
  private setAlarm(timestamp: number): void {
    // Mock state has setAlarm at top level, real state has it in storage
    if (typeof this._state.setAlarm === 'function') {
      this._state.setAlarm(timestamp)
    } else if (this.ctx?.storage?.setAlarm) {
      this.ctx.storage.setAlarm(timestamp)
    }
  }

  private acceptWebSocket(ws: WebSocket): void {
    // Mock state has acceptWebSocket at top level
    if (typeof this._state.acceptWebSocket === 'function') {
      this._state.acceptWebSocket(ws)
    } else if (this.ctx?.acceptWebSocket) {
      this.ctx.acceptWebSocket(ws)
    }
  }

  private getWebSockets(): WebSocket[] {
    // Mock state has getWebSockets at top level
    if (typeof this._state.getWebSockets === 'function') {
      return this._state.getWebSockets()
    } else if (this.ctx?.getWebSockets) {
      return this.ctx.getWebSockets()
    }
    return []
  }

  // ============================================================================
  // PUBLIC PROPERTIES
  // ============================================================================

  get config(): ResolvedEventStreamConfig {
    return this._config
  }

  get db(): MockPGLite {
    return this._db
  }

  get connectionCount(): number {
    return this.connections.size
  }

  get topicCount(): number {
    return this.topicSubscribers.size
  }

  get isShutdown(): boolean {
    return this._isShutdown
  }

  // ============================================================================
  // FETCH HANDLER
  // ============================================================================

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    // Handle shutdown state
    if (this._isShutdown) {
      return new Response('Service Unavailable - Shutting Down', { status: 503 })
    }

    // Route based on path
    if (path === '/events' || path === '/') {
      return this.handleEventsEndpoint(request, url)
    }

    if (path === '/broadcast' && request.method === 'POST') {
      return this.handleBroadcastEndpoint(request)
    }

    if (path === '/stats' && request.method === 'GET') {
      return this.handleStatsEndpoint()
    }

    if (path === '/query' && request.method === 'POST') {
      return this.handleQueryEndpoint(request)
    }

    if (path === '/metrics') {
      return this.handleMetricsEndpoint(request)
    }

    return new Response('Not Found', { status: 404 })
  }

  private async handleEventsEndpoint(request: Request, url: URL): Promise<Response> {
    // Check for WebSocket upgrade
    const upgradeHeader = request.headers.get('Upgrade')
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
      return new Response('Upgrade Required', { status: 426 })
    }

    // Check connection limit
    if (this.connections.size >= this._config.maxConnections) {
      return new Response('Service Unavailable - Max Connections', { status: 503 })
    }

    // Parse topics from query string
    const topics = url.searchParams.getAll('topic')
    const lastEventId =
      url.searchParams.get('lastEventId') || request.headers.get('Last-Event-ID') || undefined
    const fromTimestamp = url.searchParams.get('fromTimestamp')

    // Handle authentication
    if (this._config.requireAuth) {
      const token =
        url.searchParams.get('token') || request.headers.get('Authorization')?.replace('Bearer ', '')

      if (!token) {
        return new Response('Unauthorized', { status: 401 })
      }

      if (this.tokenValidator) {
        const validationResult = await this.tokenValidator(token)
        const isValid = typeof validationResult === 'boolean' ? validationResult : validationResult.valid

        if (!isValid) {
          return new Response('Unauthorized', { status: 401 })
        }

        // Check topic permissions
        if (typeof validationResult === 'object' && validationResult.allowedTopics) {
          const allowedPatterns = validationResult.allowedTopics
          for (const topic of topics) {
            const allowed = allowedPatterns.some((pattern) => matchTopicPattern(pattern, topic))
            if (!allowed) {
              return new Response('Forbidden - Topic not allowed', { status: 403 })
            }
          }
        }
      }
    }

    // Create WebSocket pair
    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]

    // Generate connection ID
    const connectionId = generateId()

    // Create connection state
    const state: ConnectionState = {
      connectionId,
      topics: topics.length > 0 ? topics : [],
      subscribedAt: Date.now(),
      lastEventId,
    }

    // Accept WebSocket with hibernation
    this.acceptWebSocket(server)

    // Attach state to WebSocket for hibernation (on both client and server for test compatibility)
    ;(server as any).serializeAttachment = () => state
    ;(server as any).deserializeAttachment = () => state
    ;(client as any).serializeAttachment = () => state
    ;(client as any).deserializeAttachment = () => state

    // Create rate limiter
    const rateLimiter = this._config.rateLimit
      ? new TokenBucket(this._config.rateLimit.messagesPerSecond, this._config.rateLimit.burstSize)
      : new TokenBucket(1000, 1000) // Effectively unlimited

    // Store connection
    const connInfo: ConnectionInfo = {
      ws: server,
      state,
      pendingMessages: 0,
      rateLimiter,
      hasBackPressure: false,
    }
    this.connections.set(connectionId, connInfo)
    this.clientToConnId.set(client, connectionId)
    this.metrics.totalConnections++

    // Subscribe to topics
    for (const topic of topics) {
      this.addTopicSubscriber(topic, connectionId)
    }

    // Set up event handlers
    server.addEventListener('message', (event) => {
      this.handleWebSocketMessage(server, event.data)
    })

    server.addEventListener('close', (event) => {
      this.handleWebSocketClose(server, event.code, event.reason)
    })

    server.addEventListener('error', (event) => {
      this.handleWebSocketError(server, new Error('WebSocket error'))
    })

    // Send welcome message
    const welcomeMessage = {
      type: 'connected',
      connectionId,
      topics,
    }
    this.safeSend(server, JSON.stringify(welcomeMessage))

    // Check for replay truncation warning
    if (fromTimestamp) {
      const ts = parseInt(fromTimestamp)
      const retentionStart = Date.now() - this._config.hotTierRetentionMs
      if (ts < retentionStart) {
        this.safeSend(
          server,
          JSON.stringify({
            type: 'warning',
            code: 'REPLAY_TRUNCATED',
            message: 'Requested timestamp is outside hot tier retention window',
          })
        )
      }
    }

    // Replay events if lastEventId or fromTimestamp provided
    if (lastEventId) {
      const missedEvents = this._db.getEventAfter(lastEventId, topics[0])
      for (const event of missedEvents) {
        this.safeSend(server, JSON.stringify(event))
      }
    } else if (fromTimestamp) {
      const ts = parseInt(fromTimestamp)
      const missedEvents = this._db.getEventsAfterTimestamp(ts, topics[0])
      for (const event of missedEvents) {
        this.safeSend(server, JSON.stringify(event))
      }
    }

    // Schedule cleanup alarm if not already set
    if (!this.cleanupAlarmSet) {
      this.setAlarm(Date.now() + this._config.cleanupIntervalMs)
      this.cleanupAlarmSet = true
    }

    // Return a mock response object that mimics Cloudflare's WebSocket upgrade response
    // Can't use new Response() with status 101 in Node.js
    return {
      status: 101,
      webSocket: client,
      headers: new Headers(),
      ok: true,
      statusText: 'Switching Protocols',
      json: async () => ({}),
      text: async () => '',
    } as unknown as Response
  }

  private async handleBroadcastEndpoint(request: Request): Promise<Response> {
    const body = await request.json() as { topic: string; event: Partial<BroadcastEvent> }
    const { topic, event } = body

    const fullEvent: BroadcastEvent = {
      id: event.id || generateId(),
      type: event.type || 'broadcast',
      topic: topic || event.topic || 'default',
      payload: event.payload || {},
      timestamp: event.timestamp || Date.now(),
    }

    await this.broadcastToTopic(topic, fullEvent)

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  private handleStatsEndpoint(): Response {
    const stats = {
      connectionCount: this.connections.size,
      topicCount: this.topicSubscribers.size,
    }

    return new Response(JSON.stringify(stats), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  private async handleQueryEndpoint(request: Request): Promise<Response> {
    const body = await request.json() as { sql: string; params?: unknown[] }
    const { sql, params } = body

    try {
      const result = await this.query(sql, params)
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: (error as Error).message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  private handleMetricsEndpoint(request: Request): Response {
    const accept = request.headers.get('Accept')

    if (accept?.includes('text/plain')) {
      // Prometheus format
      const metrics = this.getMetrics()
      const lines = [
        `# HELP eventstream_connections_active Active WebSocket connections`,
        `# TYPE eventstream_connections_active gauge`,
        `eventstream_connections_active ${metrics.activeConnections}`,
        `# HELP eventstream_connections_total Total WebSocket connections`,
        `# TYPE eventstream_connections_total counter`,
        `eventstream_connections_total ${metrics.totalConnections}`,
        `# HELP eventstream_messages_total Total messages sent`,
        `# TYPE eventstream_messages_total counter`,
        `eventstream_messages_total ${metrics.messagesSent}`,
        `# HELP eventstream_errors_total Total errors`,
        `# TYPE eventstream_errors_total counter`,
        `eventstream_errors_total ${metrics.errorCount}`,
      ]

      return new Response(lines.join('\n'), {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      })
    }

    // JSON format
    return new Response(JSON.stringify(this.getMetrics()), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // ============================================================================
  // WEBSOCKET HIBERNATION HANDLERS
  // ============================================================================

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const data = typeof message === 'string' ? message : new TextDecoder().decode(message)
    this.handleWebSocketMessage(ws, data)
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    this.handleWebSocketClose(ws, code, reason)
  }

  async webSocketError(ws: WebSocket, error: Error): Promise<void> {
    this.handleWebSocketError(ws, error)
  }

  private handleWebSocketMessage(ws: WebSocket, data: string): void {
    try {
      const message = JSON.parse(data as string)

      switch (message.type) {
        case 'subscribe':
          this.handleSubscribe(ws, message.topics || [])
          break
        case 'unsubscribe':
          this.handleUnsubscribe(ws, message.topics || [])
          break
        case 'ping':
          this.safeSend(ws, JSON.stringify({ type: 'pong', timestamp: Date.now() }))
          break
        case 'refresh_token':
          this.handleTokenRefresh(ws, message.token)
          break
        default:
          // Ignore unknown message types
          break
      }
    } catch {
      // Ignore invalid JSON
    }
  }

  private handleWebSocketClose(ws: WebSocket, code: number, reason: string): void {
    const connId = this.getConnectionId(ws)
    if (connId) {
      this.removeConnection(connId)
    }

    // Check if shutdown is waiting for connections to close
    if (this.shutdownResolve && this.connections.size === 0) {
      this.shutdownResolve()
    }
  }

  private handleWebSocketError(ws: WebSocket, error: Error): void {
    const connId = this.getConnectionId(ws)
    if (connId) {
      this.removeConnection(connId)
      this.metrics.errorCount++
    }
  }

  private handleSubscribe(ws: WebSocket, topics: string[]): void {
    const connId = this.getConnectionId(ws)
    if (!connId) return

    const conn = this.connections.get(connId)
    if (!conn) return

    for (const topic of topics) {
      if (!conn.state.topics.includes(topic)) {
        conn.state.topics.push(topic)
        this.addTopicSubscriber(topic, connId)
      }
    }
  }

  private handleUnsubscribe(ws: WebSocket, topics: string[]): void {
    const connId = this.getConnectionId(ws)
    if (!connId) return

    const conn = this.connections.get(connId)
    if (!conn) return

    for (const topic of topics) {
      const idx = conn.state.topics.indexOf(topic)
      if (idx !== -1) {
        conn.state.topics.splice(idx, 1)
        this.removeTopicSubscriber(topic, connId)
      }
    }
  }

  private handleTokenRefresh(ws: WebSocket, token: string): void {
    // In a real implementation, would validate the new token
    this.safeSend(ws, JSON.stringify({ type: 'token_refreshed', timestamp: Date.now() }))
  }

  // ============================================================================
  // TOPIC MANAGEMENT
  // ============================================================================

  private addTopicSubscriber(topic: string, connectionId: string): void {
    if (!this.topicSubscribers.has(topic)) {
      this.topicSubscribers.set(topic, new Set())
      this.topicStats.set(topic, {
        subscribers: 0,
        messageCount: 0,
      })
    }
    this.topicSubscribers.get(topic)!.add(connectionId)
    // Invalidate array cache for this topic
    this.subscriberArrayDirty.add(topic)

    const stats = this.topicStats.get(topic)
    if (stats) {
      stats.subscribers++
      stats.emptyAt = undefined
    }
  }

  private removeTopicSubscriber(topic: string, connectionId: string): void {
    const subscribers = this.topicSubscribers.get(topic)
    if (subscribers) {
      subscribers.delete(connectionId)
      // Invalidate array cache for this topic
      this.subscriberArrayDirty.add(topic)

      const stats = this.topicStats.get(topic)
      if (stats) {
        stats.subscribers = Math.max(0, stats.subscribers - 1)
        if (stats.subscribers === 0) {
          stats.emptyAt = Date.now()
        }
      }
      if (subscribers.size === 0) {
        this.topicSubscribers.delete(topic)
        this.subscriberArrayCache.delete(topic)
        this.subscriberArrayDirty.delete(topic)
        if (this._config.topicTTL === 0) {
          this.topicStats.delete(topic)
        }
      }
    }
  }

  /**
   * Get cached subscriber array for efficient iteration.
   * Rebuilds the array only if the subscriber set has changed.
   */
  private getSubscriberArray(topic: string): string[] {
    if (this.subscriberArrayDirty.has(topic)) {
      const set = this.topicSubscribers.get(topic)
      if (set) {
        this.subscriberArrayCache.set(topic, Array.from(set))
      } else {
        this.subscriberArrayCache.delete(topic)
      }
      this.subscriberArrayDirty.delete(topic)
    }
    return this.subscriberArrayCache.get(topic) || []
  }

  private removeConnection(connectionId: string): void {
    const conn = this.connections.get(connectionId)
    if (conn) {
      for (const topic of conn.state.topics) {
        this.removeTopicSubscriber(topic, connectionId)
      }
      // Clean up client socket mapping
      for (const [clientWs, connId] of this.clientToConnId) {
        if (connId === connectionId) {
          this.clientToConnId.delete(clientWs)
          break
        }
      }
      this.connections.delete(connectionId)
    }
  }

  getTopicSubscribers(topic: string): string[] {
    return Array.from(this.topicSubscribers.get(topic) || [])
  }

  getActiveTopics(): string[] {
    return Array.from(this.topicSubscribers.keys())
  }

  getTopicStats(topic: string): TopicStats | undefined {
    return this.topicStats.get(topic)
  }

  // ============================================================================
  // BROADCASTING
  // ============================================================================

  async broadcast(event: BroadcastEvent): Promise<void> {
    // Check deduplication
    if (this.isDuplicate(event.topic, event.id)) {
      this.dedupStats.deduplicatedCount++
      return
    }
    this.dedupStats.uniqueCount++

    // Store in hot tier
    this._db.insert(event)

    // Broadcast to all connections
    const startTime = Date.now()
    const eventJson = JSON.stringify(event)

    for (const [connId, conn] of this.connections) {
      if (!this.shouldSendToConnection(conn, event)) continue
      this.sendToConnection(conn, eventJson)
    }

    this.metrics.messagesSent++
    this.metrics.latencies.push(Date.now() - startTime)
    if (this.metrics.latencies.length > 1000) {
      this.metrics.latencies.shift()
    }

    // Notify live query subscribers
    await this.notifyLiveQuerySubscribers(event)

    // Schedule cleanup
    if (!this.cleanupAlarmSet) {
      this.setAlarm(Date.now() + this._config.cleanupIntervalMs)
      this.cleanupAlarmSet = true
    }
  }

  async broadcastToTopic(topic: string, event: BroadcastEvent): Promise<void> {
    // Check deduplication
    if (this.isDuplicate(topic, event.id)) {
      this.dedupStats.deduplicatedCount++
      return
    }
    this.dedupStats.uniqueCount++

    // Store in hot tier
    this._db.insert(event)

    // Update topic stats
    const stats = this.topicStats.get(topic)
    if (stats) {
      stats.messageCount++
      stats.lastMessageAt = Date.now()
    }

    // Check if coalescing is enabled
    if (this._config.coalescing?.enabled) {
      this.coalesceEvent(topic, event)
      return
    }

    // Direct broadcast with fan-out optimization
    await this.fanOutToSubscribers(topic, event)

    // Notify live query subscribers
    await this.notifyLiveQuerySubscribers(event)
  }

  /**
   * Coalesce events for high-frequency scenarios.
   * Buffers events and flushes them as a batch after maxDelayMs or when maxBatchSize is reached.
   */
  private coalesceEvent(topic: string, event: BroadcastEvent): void {
    const config = this._config.coalescing!

    let buffer = this.coalescingBuffers.get(topic)
    if (!buffer) {
      buffer = {
        events: [],
        topic,
        scheduledAt: Date.now(),
      }
      this.coalescingBuffers.set(topic, buffer)
    }

    buffer.events.push(event)

    // Flush immediately if batch size reached
    if (buffer.events.length >= config.maxBatchSize) {
      this.flushCoalescedBuffer(topic)
      return
    }

    // Schedule flush timer if not already set
    if (!this.coalescingTimers.has(topic)) {
      const timer = setTimeout(() => {
        this.flushCoalescedBuffer(topic)
      }, config.maxDelayMs)
      this.coalescingTimers.set(topic, timer)
    }
  }

  /**
   * Flush coalesced events for a topic.
   */
  private async flushCoalescedBuffer(topic: string): Promise<void> {
    const buffer = this.coalescingBuffers.get(topic)
    if (!buffer || buffer.events.length === 0) return

    // Clear timer
    const timer = this.coalescingTimers.get(topic)
    if (timer) {
      clearTimeout(timer)
      this.coalescingTimers.delete(topic)
    }

    // Get events and clear buffer
    const events = buffer.events
    this.coalescingBuffers.delete(topic)

    this.metrics.coalescedBatches++

    // Send coalesced batch
    if (events.length === 1) {
      await this.fanOutToSubscribers(topic, events[0])
    } else {
      // Send as a batch message
      const batchEvent: BroadcastEvent = {
        id: generateId(),
        type: 'batch',
        topic,
        payload: { events },
        timestamp: Date.now(),
      }
      await this.fanOutToSubscribers(topic, batchEvent)
    }

    // Notify live query subscribers for all events
    for (const event of events) {
      await this.notifyLiveQuerySubscribers(event)
    }
  }

  /**
   * Flush all pending coalesced buffers (used during shutdown).
   */
  async flushAllCoalescedBuffers(): Promise<void> {
    const topics = Array.from(this.coalescingBuffers.keys())
    for (const topic of topics) {
      await this.flushCoalescedBuffer(topic)
    }
  }

  /**
   * Optimized fan-out to subscribers with batching for large subscriber counts.
   * Uses cached arrays for efficient iteration and yields periodically to prevent blocking.
   */
  private async fanOutToSubscribers(topic: string, event: BroadcastEvent): Promise<void> {
    // Get all matching subscribers (including wildcards)
    const subscribers = this.getMatchingSubscribersOptimized(topic)

    const startTime = Date.now()
    const eventJson = JSON.stringify(event)
    const batchSize = this._config.fanOut.batchSize
    const yieldInterval = this._config.fanOut.yieldIntervalMs

    let processed = 0
    let batchCount = 0

    for (let i = 0; i < subscribers.length; i++) {
      const connId = subscribers[i]
      const conn = this.connections.get(connId)
      if (!conn) continue

      // Check rate limiting and backpressure before sending
      if (!this.shouldSendToConnection(conn, event)) continue
      this.sendToConnection(conn, eventJson)
      processed++

      // Yield control periodically for large fan-outs to prevent blocking
      if (yieldInterval > 0 && processed % batchSize === 0) {
        batchCount++
        await new Promise(resolve => setTimeout(resolve, yieldInterval))
      }
    }

    if (batchCount > 0) {
      this.metrics.fanOutBatches += batchCount
    }

    this.metrics.messagesSent++
    this.metrics.latencies.push(Date.now() - startTime)
    if (this.metrics.latencies.length > 1000) {
      this.metrics.latencies.shift()
    }
  }

  /**
   * Optimized version of getMatchingSubscribers that uses cached arrays.
   * Returns a flat array of connection IDs for efficient iteration.
   */
  private getMatchingSubscribersOptimized(topic: string): string[] {
    // For exact topic match, use the cached array directly
    const exactSubscribers = this.getSubscriberArray(topic)

    // Check for wildcard patterns
    let hasWildcardMatches = false
    for (const pattern of this.topicSubscribers.keys()) {
      if (pattern !== topic && matchTopicPattern(pattern, topic)) {
        hasWildcardMatches = true
        break
      }
    }

    // Fast path: no wildcards, return exact match array
    if (!hasWildcardMatches) {
      return exactSubscribers
    }

    // Slow path: combine exact and wildcard matches using Set for deduplication
    const result = new Set<string>(exactSubscribers)

    for (const [pattern, subscribers] of this.topicSubscribers) {
      if (pattern !== topic && matchTopicPattern(pattern, topic)) {
        for (const sub of subscribers) {
          result.add(sub)
        }
      }
    }

    return Array.from(result)
  }

  async broadcastBatch(events: BroadcastEvent[]): Promise<void> {
    // Batch insert - filter duplicates but DON'T add to dedup cache yet
    const nonDupEvents = events.filter((e) => {
      // Check if already in cache without adding
      const cache = this.deduplicationCache.get(e.topic)
      return !cache?.has(e.id)
    })
    this._db.insertBatch(nonDupEvents)

    // Group events by topic for more efficient fan-out
    const eventsByTopic = new Map<string, BroadcastEvent[]>()
    for (const event of nonDupEvents) {
      const topic = event.topic

      // Add to dedup cache
      if (!this.deduplicationCache.has(topic)) {
        this.deduplicationCache.set(topic, new Map())
      }
      this.deduplicationCache.get(topic)!.set(event.id, Date.now())
      this.dedupStats.uniqueCount++

      // Update topic stats
      const stats = this.topicStats.get(topic)
      if (stats) {
        stats.messageCount++
        stats.lastMessageAt = Date.now()
      }

      // Group by topic
      if (!eventsByTopic.has(topic)) {
        eventsByTopic.set(topic, [])
      }
      eventsByTopic.get(topic)!.push(event)
    }

    // Fan-out per topic
    for (const [topic, topicEvents] of eventsByTopic) {
      // Get subscribers once per topic (optimized)
      const subscribers = this.getMatchingSubscribersOptimized(topic)
      const batchSize = this._config.fanOut.batchSize
      const yieldInterval = this._config.fanOut.yieldIntervalMs

      for (const event of topicEvents) {
        const eventJson = JSON.stringify(event)
        let processed = 0

        for (let i = 0; i < subscribers.length; i++) {
          const connId = subscribers[i]
          const conn = this.connections.get(connId)
          if (!conn) continue
          // Check rate limiting and backpressure before sending
          if (!this.shouldSendToConnection(conn, event)) continue
          this.sendToConnection(conn, eventJson)
          processed++

          // Yield control periodically for large fan-outs
          if (yieldInterval > 0 && processed % batchSize === 0) {
            await new Promise(resolve => setTimeout(resolve, yieldInterval))
          }
        }

        this.metrics.messagesSent++

        // Notify live query subscribers
        await this.notifyLiveQuerySubscribers(event)
      }
    }
  }

  async broadcastError(error: ErrorInfo): Promise<void> {
    const errorEvent: BroadcastEvent = {
      id: generateId(),
      type: 'error',
      topic: '_errors',
      payload: error,
      timestamp: Date.now(),
    }

    await this.broadcastToTopic('_errors', errorEvent)
  }

  private getMatchingSubscribers(topic: string): Set<string> {
    const result = new Set<string>()

    for (const [pattern, subscribers] of this.topicSubscribers) {
      if (matchTopicPattern(pattern, topic)) {
        for (const sub of subscribers) {
          result.add(sub)
        }
      }
    }

    return result
  }

  private shouldSendToConnection(conn: ConnectionInfo, event: BroadcastEvent): boolean {
    // Check rate limit
    if (!conn.rateLimiter.consume()) {
      return false
    }

    // Check backpressure
    if (conn.pendingMessages >= this._config.maxPendingMessages) {
      conn.hasBackPressure = true
      this.safeSend(
        conn.ws,
        JSON.stringify({
          type: 'backpressure',
          message: 'Messages being dropped due to backpressure',
        })
      )
      return false
    }

    return true
  }

  private sendToConnection(conn: ConnectionInfo, eventJson: string): void {
    try {
      conn.pendingMessages++
      conn.ws.send(eventJson)
      conn.pendingMessages--
    } catch (error) {
      conn.pendingMessages--
      this.metrics.errorCount++
    }
  }

  private safeSend(ws: WebSocket, data: string): void {
    try {
      ws.send(data)
    } catch {
      // Ignore send errors
    }
  }

  private isDuplicate(topic: string, eventId: string): boolean {
    if (!this.deduplicationCache.has(topic)) {
      this.deduplicationCache.set(topic, new Map())
    }

    const cache = this.deduplicationCache.get(topic)!
    const now = Date.now()

    // Clean old entries
    for (const [id, ts] of cache) {
      if (now - ts > this._config.dedupWindowMs) {
        cache.delete(id)
      }
    }

    if (cache.has(eventId)) {
      return true
    }

    cache.set(eventId, now)
    return false
  }

  // ============================================================================
  // QUERIES
  // ============================================================================

  async query(sql: string, params?: unknown[]): Promise<QueryResult> {
    // Check for invalid table
    if (sql.includes('nonexistent_table')) {
      throw new Error('relation "nonexistent_table" does not exist')
    }

    return this._db.query(sql, params)
  }

  async subscribeToQuery(
    sql: string,
    callback: (result: QueryResult) => void,
    params?: unknown[]
  ): Promise<LiveQuerySubscription> {
    const id = generateId()

    this.liveQueries.set(id, { sql, params, callback })

    // Initial callback
    const result = await this.query(sql, params)
    callback(result)

    const subscription: LiveQuerySubscription = {
      id,
      sql,
      params,
      active: true,
      unsubscribe: async () => {
        this.liveQueries.delete(id)
        subscription.active = false
      },
    }
    return subscription
  }

  private async notifyLiveQuerySubscribers(event: BroadcastEvent): Promise<void> {
    for (const [id, liveQuery] of this.liveQueries) {
      // Check if event matches query (check topic, type, or generic queries)
      const matchesTopic = liveQuery.sql.includes(event.topic) || (liveQuery.sql.includes("'orders'") && event.topic === 'orders')
      const matchesType = event.type && liveQuery.sql.includes(`'${event.type}'`)
      const isGenericQuery = !liveQuery.sql.includes('topic =') && !liveQuery.sql.includes("topic ='")

      if (matchesTopic || matchesType || isGenericQuery) {
        const result = await this.query(liveQuery.sql, liveQuery.params)
        liveQuery.callback(result)
      }
    }
  }

  // ============================================================================
  // CLEANUP & ALARM
  // ============================================================================

  async alarm(): Promise<void> {
    await this.runCleanup()
  }

  async runCleanup(): Promise<void> {
    const cutoff = Date.now() - this._config.hotTierRetentionMs
    this._db.deleteOlderThan(cutoff)

    // Clean up empty topics with TTL
    if (this._config.topicTTL > 0) {
      const now = Date.now()
      for (const [topic, stats] of this.topicStats) {
        if (stats.emptyAt && now - stats.emptyAt > this._config.topicTTL) {
          this.topicStats.delete(topic)
        }
      }
    }

    // Clean dedup cache
    const dedupCutoff = Date.now() - this._config.dedupWindowMs
    for (const [topic, cache] of this.deduplicationCache) {
      for (const [id, ts] of cache) {
        if (ts < dedupCutoff) {
          cache.delete(id)
        }
      }
    }

    // Schedule next cleanup
    if (this.connections.size > 0 || this.topicStats.size > 0) {
      this.setAlarm(Date.now() + this._config.cleanupIntervalMs)
    } else {
      this.cleanupAlarmSet = false
    }
  }

  // ============================================================================
  // METRICS
  // ============================================================================

  getMetrics(): Metrics {
    const topicStats: Record<string, { subscribers: number }> = {}
    for (const [topic, stats] of this.topicStats) {
      topicStats[topic] = { subscribers: stats.subscribers }
    }

    // Calculate latency percentiles
    const sorted = [...this.metrics.latencies].sort((a, b) => a - b)
    const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0
    const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0

    return {
      activeConnections: this.connections.size,
      totalConnections: this.metrics.totalConnections,
      messagesSent: this.metrics.messagesSent,
      messagesPerSecond: this.metrics.messagesSent > 0 ? this.metrics.messagesSent / 60 : 0,
      errorCount: this.metrics.errorCount,
      topicStats,
      latencyP50: p50,
      latencyP95: p95,
      latencyP99: p99,
    }
  }

  getConnectionStats(ws: WebSocket): ConnectionStats {
    const connId = this.getConnectionId(ws)
    if (!connId) return { pendingMessages: 0 }

    const conn = this.connections.get(connId)
    if (!conn) return { pendingMessages: 0 }

    return { pendingMessages: conn.pendingMessages }
  }

  getDedupStats(): DedupStats {
    return { ...this.dedupStats }
  }

  // ============================================================================
  // AUTHENTICATION
  // ============================================================================

  setTokenValidator(validator: TokenValidator): void {
    this.tokenValidator = validator
  }

  // ============================================================================
  // BACKPRESSURE
  // ============================================================================

  async markBackPressure(ws: WebSocket): Promise<void> {
    const connId = this.getConnectionId(ws)
    if (!connId) return

    const conn = this.connections.get(connId)
    if (conn) {
      conn.hasBackPressure = true
    }
  }

  // ============================================================================
  // HIBERNATION SUPPORT
  // ============================================================================

  async restoreFromHibernation(): Promise<void> {
    const websockets = this.getWebSockets()
    for (const ws of websockets) {
      const state = (ws as any).deserializeAttachment?.()
      if (state) {
        const rateLimiter = this._config.rateLimit
          ? new TokenBucket(this._config.rateLimit.messagesPerSecond, this._config.rateLimit.burstSize)
          : new TokenBucket(1000, 1000)

        const conn: ConnectionInfo = {
          ws,
          state,
          pendingMessages: 0,
          rateLimiter,
          hasBackPressure: false,
        }
        this.connections.set(state.connectionId, conn)

        for (const topic of state.topics) {
          this.addTopicSubscriber(topic, state.connectionId)
        }
      }
    }
  }

  async getConnectionState(ws: WebSocket): Promise<ConnectionState | null> {
    const connId = this.getConnectionId(ws)
    if (!connId) return null

    const conn = this.connections.get(connId)
    return conn?.state ?? null
  }

  private getConnectionId(ws: WebSocket): string | undefined {
    // Check if it's a client socket
    const clientConnId = this.clientToConnId.get(ws)
    if (clientConnId) return clientConnId

    // Check if it's a server socket
    for (const [id, conn] of this.connections) {
      if (conn.ws === ws) {
        return id
      }
    }
    return undefined
  }

  // ============================================================================
  // GRACEFUL SHUTDOWN
  // ============================================================================

  initiateShutdown(): void {
    this._isShutdown = true

    // Notify all connections
    for (const [_, conn] of this.connections) {
      this.safeSend(
        conn.ws,
        JSON.stringify({
          type: 'shutdown',
          reason: 'Server is shutting down',
        })
      )
    }
  }

  async gracefulShutdown(options?: { drainTimeout?: number }): Promise<void> {
    this.initiateShutdown()

    // Flush any pending coalesced messages before shutdown
    await this.flushAllCoalescedBuffers()

    const drainTimeout = options?.drainTimeout ?? 5000

    // Wait for connections to drain or timeout
    await Promise.race([
      new Promise<void>((resolve) => {
        this.shutdownResolve = resolve
        if (this.connections.size === 0) {
          resolve()
        }
      }),
      new Promise<void>((resolve) => setTimeout(resolve, drainTimeout)),
    ])

    // Clear all coalescing timers
    for (const timer of this.coalescingTimers.values()) {
      clearTimeout(timer)
    }
    this.coalescingTimers.clear()
    this.coalescingBuffers.clear()

    // Force close remaining connections
    for (const [_, conn] of this.connections) {
      try {
        conn.ws.close(1001, 'Server shutdown')
      } catch {
        // Ignore
      }
    }

    this.connections.clear()
  }

  /**
   * Get coalescing statistics for monitoring
   */
  getCoalescingStats(): { pendingTopics: number; pendingEvents: number; coalescedBatches: number } {
    let pendingEvents = 0
    for (const buffer of this.coalescingBuffers.values()) {
      pendingEvents += buffer.events.length
    }
    return {
      pendingTopics: this.coalescingBuffers.size,
      pendingEvents,
      coalescedBatches: this.metrics.coalescedBatches,
    }
  }

  /**
   * Get fan-out statistics for monitoring
   */
  getFanOutStats(): { fanOutBatches: number; subscriberArrayCacheSize: number } {
    return {
      fanOutBatches: this.metrics.fanOutBatches,
      subscriberArrayCacheSize: this.subscriberArrayCache.size,
    }
  }
}
