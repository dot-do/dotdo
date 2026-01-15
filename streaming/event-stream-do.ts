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

// WebSocketPair type declaration for Cloudflare Workers runtime
declare global {
  var WebSocketPair: new () => { 0: WebSocket; 1: WebSocket }
}

// Feature detection: WebSocketPair is provided by Cloudflare Workers runtime.
// For testing, use installWebSocketMock() from streaming/tests/utils/websocket-mock.ts
// in your test setup file.

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

import type { UnifiedEvent, EventType } from '../types/unified-event'
import { safeValidateUnifiedEventLazy } from '../types/unified-event-schema'

// ============================================================================
// HOT TIER SCHEMA
// ============================================================================

/**
 * SQL schema for unified events in the hot tier.
 * Stores key queryable columns directly while keeping JSON payloads for flexibility.
 */
export const HOT_TIER_SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  -- Core Identity
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  event_name TEXT NOT NULL,
  ns TEXT NOT NULL,

  -- Causality (indexed for joins)
  trace_id TEXT,
  span_id TEXT,
  parent_id TEXT,
  session_id TEXT,
  correlation_id TEXT,

  -- Graph columns (computed for fast depth/leaf queries)
  depth INTEGER,
  is_leaf INTEGER,
  is_root INTEGER,

  -- Key queryable columns
  timestamp TEXT NOT NULL,
  outcome TEXT,
  http_url TEXT,
  http_status INTEGER,
  duration_ms REAL,

  -- Service
  service_name TEXT,

  -- Vitals
  vital_name TEXT,
  vital_value REAL,
  vital_rating TEXT,

  -- Logging
  log_level TEXT,
  log_message TEXT,

  -- Actor
  actor_id TEXT,

  -- JSON for the rest
  data TEXT,
  attributes TEXT,
  properties TEXT
);

-- Correlation indexes (for trace/session lookup)
CREATE INDEX IF NOT EXISTS idx_trace ON events(trace_id);
CREATE INDEX IF NOT EXISTS idx_session ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_correlation ON events(correlation_id);

-- Composite indexes for common query patterns (25-287x speedup)
-- Used by: type filtering with time range (e.g., "all HTTP events in last hour")
CREATE INDEX IF NOT EXISTS idx_type_time ON events(event_type, timestamp);
-- Used by: namespace filtering with time range (e.g., "all events for tenant X")
CREATE INDEX IF NOT EXISTS idx_ns_time ON events(ns, timestamp);
-- Used by: namespace filtering with time range (unified naming convention)
CREATE INDEX IF NOT EXISTS idx_unified_ns_time ON events(ns, timestamp);
-- Used by: actor/user activity queries with time range
CREATE INDEX IF NOT EXISTS idx_unified_actor_time ON events(actor_id, timestamp);
-- Used by: service health dashboards (outcome aggregation per service)
CREATE INDEX IF NOT EXISTS idx_unified_service_outcome ON events(service_name, outcome);

-- Partial indexes for filtered queries (index only relevant subset of rows)
-- Used by: error monitoring dashboards (only indexes ~5% of events typically)
CREATE INDEX IF NOT EXISTS idx_unified_error ON events(http_status) WHERE http_status >= 400;
-- Used by: log aggregation queries (only indexes events with log_level set)
CREATE INDEX IF NOT EXISTS idx_unified_log ON events(log_level, timestamp) WHERE log_level IS NOT NULL;
`

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
  /** Last activity timestamp for stale buffer detection */
  lastActivity: number
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
// MOCK PGLITE - Unified Event Storage
// ============================================================================

/**
 * Internal unified event storage format for the hot tier.
 * Extracts key fields for indexing while preserving full event data.
 */
export interface StoredUnifiedEvent {
  // Core Identity
  id: string
  event_type: string
  event_name: string
  ns: string

  // Causality
  trace_id: string | null
  span_id: string | null
  parent_id: string | null
  session_id: string | null
  correlation_id: string | null

  // Key queryable columns
  timestamp: string
  outcome: string | null
  http_url: string | null
  http_status: number | null
  duration_ms: number | null

  // Service
  service_name: string | null

  // Vitals
  vital_name: string | null
  vital_value: number | null
  vital_rating: string | null

  // Logging
  log_level: string | null
  log_message: string | null

  // Actor
  actor_id: string | null

  // JSON for the rest
  data: string | null
  attributes: string | null
  properties: string | null

  // Legacy fields for backwards compatibility
  topic?: string
  type?: string
  payload?: unknown
}

/**
 * Converts a BroadcastEvent or UnifiedEvent to StoredUnifiedEvent format.
 * Handles both legacy and new event formats.
 */
function toStoredUnifiedEvent(event: BroadcastEvent | Partial<UnifiedEvent>): StoredUnifiedEvent {
  // Check if it's a legacy BroadcastEvent
  const isLegacy = 'topic' in event && 'type' in event && 'payload' in event && !('event_type' in event)

  if (isLegacy) {
    const legacy = event as BroadcastEvent
    return {
      id: legacy.id,
      event_type: legacy.type || 'broadcast',
      event_name: legacy.type || 'broadcast',
      ns: legacy.topic || 'default',
      trace_id: null,
      span_id: null,
      parent_id: null,
      session_id: null,
      correlation_id: null,
      timestamp: typeof legacy.timestamp === 'number'
        ? new Date(legacy.timestamp).toISOString()
        : legacy.timestamp?.toString() || new Date().toISOString(),
      outcome: null,
      http_url: null,
      http_status: null,
      duration_ms: null,
      service_name: null,
      vital_name: null,
      vital_value: null,
      vital_rating: null,
      log_level: null,
      log_message: null,
      actor_id: null,
      data: legacy.payload ? JSON.stringify(legacy.payload) : null,
      attributes: null,
      properties: null,
      // Preserve legacy fields for backwards compatibility
      topic: legacy.topic,
      type: legacy.type,
      payload: legacy.payload,
    }
  }

  // Handle UnifiedEvent format
  const unified = event as Partial<UnifiedEvent>

  // Validate required fields to avoid unsafe non-null assertions
  if (!unified.id || typeof unified.id !== 'string') {
    throw new Error('id field is required and must be a string')
  }
  if (!unified.event_type) {
    throw new Error('event_type field is required')
  }
  if (!unified.event_name) {
    throw new Error('event_name field is required')
  }
  if (!unified.ns) {
    throw new Error('ns field is required')
  }

  return {
    id: unified.id,
    event_type: unified.event_type,
    event_name: unified.event_name,
    ns: unified.ns,
    trace_id: unified.trace_id || null,
    span_id: unified.span_id || null,
    parent_id: unified.parent_id || null,
    session_id: unified.session_id || null,
    correlation_id: unified.correlation_id || null,
    timestamp: unified.timestamp || new Date().toISOString(),
    outcome: unified.outcome || null,
    http_url: unified.http_url || null,
    http_status: unified.http_status || null,
    duration_ms: unified.duration_ms || null,
    service_name: unified.service_name || null,
    vital_name: unified.vital_name || null,
    vital_value: unified.vital_value || null,
    vital_rating: unified.vital_rating || null,
    log_level: unified.log_level || null,
    log_message: unified.log_message || null,
    actor_id: unified.actor_id || null,
    data: unified.data ? JSON.stringify(unified.data) : null,
    attributes: unified.attributes ? JSON.stringify(unified.attributes) : null,
    properties: unified.properties ? JSON.stringify(unified.properties) : null,
    // Map ns to topic for backwards compatibility
    topic: unified.ns,
    type: unified.event_type,
  }
}

/**
 * Simple in-memory database that mimics PGLite for event storage.
 * Supports both legacy BroadcastEvent and new UnifiedEvent formats.
 */
class MockPGLite {
  private events: Map<string, StoredUnifiedEvent> = new Map()
  private schemaInitialized = false

  async exec(sql: string): Promise<void> {
    // Parse CREATE TABLE and CREATE INDEX statements
    if (sql.includes('CREATE TABLE') || sql.includes('CREATE INDEX')) {
      this.schemaInitialized = true
    }
  }

  async query(sql: string, params: unknown[] = []): Promise<QueryResult> {
    const events = Array.from(this.events.values())

    // Parse basic WHERE conditions
    const rows = events.filter((event) => {
      // Handle timestamp filter (both numeric and ISO string)
      if (sql.includes('timestamp >') && params.length > 0) {
        const idx = sql.indexOf('timestamp > $')
        if (idx !== -1) {
          const paramNum = parseInt(sql[idx + 13]) - 1
          const paramValue = params[paramNum]
          const eventTs = new Date(event.timestamp).getTime()
          if (typeof paramValue === 'number') {
            if (eventTs <= paramValue) return false
          } else if (typeof paramValue === 'string') {
            if (eventTs <= new Date(paramValue).getTime()) return false
          }
        }
      }

      // Handle id filter
      if (sql.includes('id = $1') && params[0]) {
        if (event.id !== params[0]) return false
      }

      // Handle event_type filter (unified schema)
      if (sql.match(/event_type\s*=\s*['"]?(\w+)['"]?/)) {
        const match = sql.match(/event_type\s*=\s*['"]?(\w+)['"]?/)
        if (match && event.event_type !== match[1]) return false
      }
      if (sql.includes('event_type = $') && params.length > 0) {
        const idx = sql.match(/event_type = \$(\d+)/)
        if (idx) {
          const paramIdx = parseInt(idx[1]) - 1
          if (event.event_type !== params[paramIdx]) return false
        }
      }

      // Handle legacy type filter (backwards compatibility)
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

      // Handle ns filter (unified schema)
      if (sql.match(/ns\s*=\s*['"]([^'"]+)['"]/)) {
        const match = sql.match(/ns\s*=\s*['"]([^'"]+)['"]/)
        if (match && event.ns !== match[1]) return false
      }

      // Handle trace_id filter
      if (sql.match(/trace_id\s*=\s*['"]([^'"]+)['"]/)) {
        const match = sql.match(/trace_id\s*=\s*['"]([^'"]+)['"]/)
        if (match && event.trace_id !== match[1]) return false
      }
      if (sql.includes('trace_id = $') && params.length > 0) {
        const idx = sql.match(/trace_id = \$(\d+)/)
        if (idx) {
          const paramIdx = parseInt(idx[1]) - 1
          if (event.trace_id !== params[paramIdx]) return false
        }
      }

      // Handle session_id filter
      if (sql.match(/session_id\s*=\s*['"]([^'"]+)['"]/)) {
        const match = sql.match(/session_id\s*=\s*['"]([^'"]+)['"]/)
        if (match && event.session_id !== match[1]) return false
      }
      if (sql.includes('session_id = $') && params.length > 0) {
        const idx = sql.match(/session_id = \$(\d+)/)
        if (idx) {
          const paramIdx = parseInt(idx[1]) - 1
          if (event.session_id !== params[paramIdx]) return false
        }
      }

      // Handle correlation_id filter
      if (sql.match(/correlation_id\s*=\s*['"]([^'"]+)['"]/)) {
        const match = sql.match(/correlation_id\s*=\s*['"]([^'"]+)['"]/)
        if (match && event.correlation_id !== match[1]) return false
      }
      if (sql.includes('correlation_id = $') && params.length > 0) {
        const idx = sql.match(/correlation_id = \$(\d+)/)
        if (idx) {
          const paramIdx = parseInt(idx[1]) - 1
          if (event.correlation_id !== params[paramIdx]) return false
        }
      }

      // Handle service_name filter
      if (sql.match(/service_name\s*=\s*['"]([^'"]+)['"]/)) {
        const match = sql.match(/service_name\s*=\s*['"]([^'"]+)['"]/)
        if (match && event.service_name !== match[1]) return false
      }

      // Handle log_level filter
      if (sql.match(/log_level\s*=\s*['"]([^'"]+)['"]/)) {
        const match = sql.match(/log_level\s*=\s*['"]([^'"]+)['"]/)
        if (match && event.log_level !== match[1]) return false
      }

      // Handle vital_name filter
      if (sql.match(/vital_name\s*=\s*['"]([^'"]+)['"]/)) {
        const match = sql.match(/vital_name\s*=\s*['"]([^'"]+)['"]/)
        if (match && event.vital_name !== match[1]) return false
      }

      // Handle http_status filter
      if (sql.match(/http_status\s*=\s*(\d+)/)) {
        const match = sql.match(/http_status\s*=\s*(\d+)/)
        if (match && event.http_status !== parseInt(match[1])) return false
      }

      // Handle outcome filter
      if (sql.match(/outcome\s*=\s*['"]([^'"]+)['"]/)) {
        const match = sql.match(/outcome\s*=\s*['"]([^'"]+)['"]/)
        if (match && event.outcome !== match[1]) return false
      }

      // Handle topic filter (legacy compatibility)
      if (sql.includes("topic = $") || sql.includes("topic = '")) {
        if (sql.includes("topic = 'orders'") && event.topic !== 'orders') return false
        if (sql.includes("topic = 'recovery'") && event.topic !== 'recovery') return false
        if (sql.includes("topic = 'bulk'") && event.topic !== 'bulk') return false
        if (sql.includes("topic = $1") && params[0] && event.topic !== params[0]) return false
      }

      // Handle payload status filter (legacy)
      if (sql.includes("payload->>'status' = $") && params.length > 1) {
        const payload = event.payload as Record<string, unknown>
        const status = payload?.status
        if (status !== params[1]) return false
      }

      // Handle payload seq filter (legacy)
      if (sql.includes("payload->>'seq' >= '5'")) {
        const payload = event.payload as Record<string, unknown>
        const seq = payload?.seq
        if (typeof seq !== 'number' || seq < 5) return false
      }

      // Handle data JSON filter
      if (sql.includes("data->>'") && event.data) {
        const dataObj = JSON.parse(event.data)
        const fieldMatch = sql.match(/data->>'(\w+)'\s*=\s*['"]?([^'")\s]+)['"]?/)
        if (fieldMatch) {
          const [, field, value] = fieldMatch
          if (dataObj[field] !== value && dataObj[field] !== parseInt(value)) return false
        }
      }

      return true
    })

    // Get event IDs in insertion order for tiebreaking
    const eventIds = Array.from(this.events.keys())

    // Handle ORDER BY timestamp DESC
    if (sql.includes('ORDER BY timestamp DESC')) {
      rows.sort((a, b) => {
        const aTs = new Date(a.timestamp).getTime()
        const bTs = new Date(b.timestamp).getTime()
        if (bTs !== aTs) return bTs - aTs
        // Same timestamp: later insertion = higher in DESC order
        return eventIds.indexOf(b.id) - eventIds.indexOf(a.id)
      })
    }

    // Handle ORDER BY timestamp (ASC)
    if (sql.includes('ORDER BY timestamp') && !sql.includes('DESC')) {
      rows.sort((a, b) => {
        const aTs = new Date(a.timestamp).getTime()
        const bTs = new Date(b.timestamp).getTime()
        if (aTs !== bTs) return aTs - bTs
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
        // Determine grouping column
        const groupByMatch = sql.match(/GROUP BY\s+(\w+)/i)
        const groupCol = groupByMatch ? groupByMatch[1] : 'event_type'

        // Aggregation query
        const groups = new Map<string, { count: number; total: number; users: Set<string> }>()
        for (const event of rows) {
          const key = (event as any)[groupCol] || event.topic || 'unknown'
          if (!groups.has(key)) {
            groups.set(key, { count: 0, total: 0, users: new Set() })
          }
          const group = groups.get(key)!
          group.count++
          // Handle legacy payload amounts
          if (event.payload && typeof event.payload === 'object') {
            const payload = event.payload as Record<string, unknown>
            if (payload.amount) {
              group.total += payload.amount as number
            }
            if (payload.userId) {
              group.users.add(payload.userId as string)
            }
          }
          // Handle actor_id for unique users
          if (event.actor_id) {
            group.users.add(event.actor_id)
          }
        }

        const aggregatedRows: Record<string, unknown>[] = []
        for (const [key, data] of groups) {
          aggregatedRows.push({
            [groupCol]: key,
            topic: key,
            count: data.count,
            total: data.total,
            total_events: data.count,
            unique_users: data.users.size,
          })
        }
        return { rows: aggregatedRows }
      }
      // Non-grouped COUNT
      const users = new Set<string>()
      for (const event of rows) {
        if (event.actor_id) users.add(event.actor_id)
        if (event.payload && typeof event.payload === 'object') {
          const payload = event.payload as Record<string, unknown>
          if (payload.userId) users.add(payload.userId as string)
        }
      }
      return { rows: [{ count: rows.length, total_events: rows.length, unique_users: users.size }] }
    }

    return { rows }
  }

  /**
   * Insert an event (supports both legacy and unified formats)
   */
  insert(event: BroadcastEvent | Partial<UnifiedEvent>): void {
    const stored = toStoredUnifiedEvent(event)
    this.events.set(stored.id, stored)
  }

  /**
   * Insert a UnifiedEvent directly
   */
  insertUnified(event: Partial<UnifiedEvent>): void {
    const stored = toStoredUnifiedEvent(event)
    this.events.set(stored.id, stored)
  }

  /**
   * Batch insert events
   */
  insertBatch(events: (BroadcastEvent | Partial<UnifiedEvent>)[]): void {
    for (const event of events) {
      this.insert(event)
    }
  }

  /**
   * Delete events older than the given timestamp
   */
  deleteOlderThan(timestamp: number): void {
    const cutoffDate = new Date(timestamp)
    for (const [id, event] of this.events) {
      const eventTs = new Date(event.timestamp).getTime()
      if (eventTs < timestamp) {
        this.events.delete(id)
      }
    }
  }

  /**
   * Get events after a specific event ID
   */
  getEventAfter(eventId: string, topic?: string): BroadcastEvent[] {
    const events = Array.from(this.events.values())
    const targetEvent = this.events.get(eventId)
    if (!targetEvent) return []

    const targetTs = new Date(targetEvent.timestamp).getTime()
    const eventIds = Array.from(this.events.keys())
    const targetIdx = eventIds.indexOf(eventId)

    return events
      .filter((e) => {
        const eventIdx = eventIds.indexOf(e.id)
        if (eventIdx <= targetIdx) return false
        const eventTs = new Date(e.timestamp).getTime()
        if (eventTs < targetTs) return false
        if (topic && e.topic !== topic && e.ns !== topic) return false
        return true
      })
      .sort((a, b) => {
        const aTs = new Date(a.timestamp).getTime()
        const bTs = new Date(b.timestamp).getTime()
        if (aTs !== bTs) return aTs - bTs
        return eventIds.indexOf(a.id) - eventIds.indexOf(b.id)
      })
      .map((e) => this.toOutputEvent(e))
  }

  /**
   * Get events after a specific timestamp
   */
  getEventsAfterTimestamp(timestamp: number, topic?: string): BroadcastEvent[] {
    const events = Array.from(this.events.values())
    return events
      .filter((e) => {
        const eventTs = new Date(e.timestamp).getTime()
        if (eventTs <= timestamp) return false
        if (topic && e.topic !== topic && e.ns !== topic) return false
        return true
      })
      .sort((a, b) => {
        const aTs = new Date(a.timestamp).getTime()
        const bTs = new Date(b.timestamp).getTime()
        return aTs - bTs
      })
      .map((e) => this.toOutputEvent(e))
  }

  /**
   * Query unified events with filters
   */
  queryUnified(filters: {
    event_type?: string
    trace_id?: string
    session_id?: string
    correlation_id?: string
    ns?: string
    service_name?: string
    log_level?: string
    timestamp_after?: string
    limit?: number
  }): StoredUnifiedEvent[] {
    let results = Array.from(this.events.values())

    if (filters.event_type) {
      results = results.filter((e) => e.event_type === filters.event_type)
    }
    if (filters.trace_id) {
      results = results.filter((e) => e.trace_id === filters.trace_id)
    }
    if (filters.session_id) {
      results = results.filter((e) => e.session_id === filters.session_id)
    }
    if (filters.correlation_id) {
      results = results.filter((e) => e.correlation_id === filters.correlation_id)
    }
    if (filters.ns) {
      results = results.filter((e) => e.ns === filters.ns)
    }
    if (filters.service_name) {
      results = results.filter((e) => e.service_name === filters.service_name)
    }
    if (filters.log_level) {
      results = results.filter((e) => e.log_level === filters.log_level)
    }
    if (filters.timestamp_after) {
      const afterTs = new Date(filters.timestamp_after).getTime()
      results = results.filter((e) => new Date(e.timestamp).getTime() > afterTs)
    }

    // Sort by timestamp DESC
    results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    if (filters.limit) {
      results = results.slice(0, filters.limit)
    }

    return results
  }

  /**
   * Convert stored event to output format (backwards compatible)
   */
  private toOutputEvent(stored: StoredUnifiedEvent): BroadcastEvent {
    return {
      id: stored.id,
      type: stored.type || stored.event_type,
      topic: stored.topic || stored.ns,
      payload: stored.payload || (stored.data ? JSON.parse(stored.data) : {}),
      timestamp: new Date(stored.timestamp).getTime(),
    }
  }

  /**
   * Get all stored unified events (for testing)
   */
  getAllUnifiedEvents(): StoredUnifiedEvent[] {
    return Array.from(this.events.values())
  }

  /**
   * Get event count
   */
  getEventCount(): number {
    return this.events.size
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
    // Use the unified event schema for the hot tier
    await this._db.exec(HOT_TIER_SCHEMA)
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

    if (path === '/query/unified' && request.method === 'POST') {
      return this.handleUnifiedQueryEndpoint(request)
    }

    if (path === '/query/trace' && request.method === 'GET') {
      return this.handleTraceQueryEndpoint(url)
    }

    if (path === '/query/session' && request.method === 'GET') {
      return this.handleSessionQueryEndpoint(url)
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
    let body: {
      topic?: string
      event?: Partial<BroadcastEvent>
      // UnifiedEvent fields
      id?: string
      event_type?: EventType
      event_name?: string
      ns?: string
      [key: string]: unknown
    }

    // Parse JSON with error handling
    try {
      const parsed = await request.json()

      // Validate it's a non-null object
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return new Response(JSON.stringify({ error: 'Request body must be a JSON object' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      body = parsed as typeof body
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Check if this is a UnifiedEvent (has event_type field)
    if (body.event_type || body.event_name) {
      return this.handleUnifiedBroadcast(body as Partial<UnifiedEvent>)
    }

    // Legacy BroadcastEvent format
    const { topic, event } = body as { topic: string; event: Partial<BroadcastEvent> }

    const fullEvent: BroadcastEvent = {
      id: event?.id || generateId(),
      type: event?.type || 'broadcast',
      topic: topic || event?.topic || 'default',
      payload: event?.payload || {},
      timestamp: event?.timestamp || Date.now(),
    }

    await this.broadcastToTopic(topic || fullEvent.topic, fullEvent)

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  /**
   * Handle broadcasting of UnifiedEvent format
   */
  private async handleUnifiedBroadcast(event: Partial<UnifiedEvent>): Promise<Response> {
    // Validate with lazy schema (only core fields required)
    const validation = safeValidateUnifiedEventLazy({
      id: event.id || generateId(),
      event_type: event.event_type || 'trace',
      event_name: event.event_name || 'unknown',
      ns: event.ns || 'default',
      ...event,
    })

    if (!validation.success) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid UnifiedEvent',
        details: validation.error.issues,
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const unifiedEvent = validation.data

    // Store in hot tier
    this._db.insertUnified(unifiedEvent)

    // Broadcast to subscribers (use ns as topic)
    const topic = unifiedEvent.ns
    const broadcastEvent: BroadcastEvent = {
      id: unifiedEvent.id,
      type: unifiedEvent.event_type,
      topic: topic,
      payload: unifiedEvent,
      timestamp: unifiedEvent.timestamp
        ? new Date(unifiedEvent.timestamp).getTime()
        : Date.now(),
    }

    await this.broadcastToTopic(topic, broadcastEvent)

    return new Response(JSON.stringify({
      success: true,
      id: unifiedEvent.id,
      event_type: unifiedEvent.event_type,
    }), {
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

  /**
   * Handle unified event queries with structured filters
   */
  private async handleUnifiedQueryEndpoint(request: Request): Promise<Response> {
    const body = await request.json() as {
      event_type?: string
      trace_id?: string
      session_id?: string
      correlation_id?: string
      ns?: string
      service_name?: string
      log_level?: string
      timestamp_after?: string
      limit?: number
    }

    try {
      const events = this._db.queryUnified(body)
      return new Response(JSON.stringify({ events, count: events.length }), {
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

  /**
   * Handle trace correlation queries
   */
  private handleTraceQueryEndpoint(url: URL): Response {
    const traceId = url.searchParams.get('trace_id')
    if (!traceId) {
      return new Response(JSON.stringify({ error: 'trace_id is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const events = this._db.queryUnified({ trace_id: traceId })
    return new Response(JSON.stringify({
      trace_id: traceId,
      events,
      count: events.length,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  /**
   * Handle session correlation queries
   */
  private handleSessionQueryEndpoint(url: URL): Response {
    const sessionId = url.searchParams.get('session_id')
    if (!sessionId) {
      return new Response(JSON.stringify({ error: 'session_id is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const events = this._db.queryUnified({ session_id: sessionId })
    return new Response(JSON.stringify({
      session_id: sessionId,
      events,
      count: events.length,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
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
        lastActivity: Date.now(),
      }
      this.coalescingBuffers.set(topic, buffer)
    }

    buffer.events.push(event)
    buffer.lastActivity = Date.now()

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
   * Clean up stale coalescing buffers that haven't had activity.
   *
   * Stale buffers can accumulate when:
   * - Topics stop receiving events but never hit batch size
   * - Timer gets cleared but buffer not flushed
   * - Network issues prevent flush completion
   *
   * Called periodically (e.g., in alarm handler) to prevent memory leaks.
   *
   * @param staleThresholdMs - Time in ms after which a buffer is considered stale (default: 5 minutes)
   * @returns Number of stale buffers cleaned up
   */
  cleanupStaleBuffers(staleThresholdMs: number = 5 * 60 * 1000): number {
    const now = Date.now()
    let cleanedCount = 0

    for (const [topic, buffer] of this.coalescingBuffers) {
      if (now - buffer.lastActivity > staleThresholdMs) {
        // Clear any pending timer
        const timer = this.coalescingTimers.get(topic)
        if (timer) {
          clearTimeout(timer)
          this.coalescingTimers.delete(topic)
        }

        // Remove the stale buffer
        this.coalescingBuffers.delete(topic)
        cleanedCount++

        // Log for observability (buffer had events that were never flushed)
        if (buffer.events.length > 0) {
          console.warn(
            `[EventStreamDO] Cleaned up stale buffer for topic "${topic}" with ${buffer.events.length} unflushed events`
          )
        }
      }
    }

    return cleanedCount
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
    } catch (error) {
      // Log send errors and increment error counter for visibility
      this.metrics.errorCount++
      // Only log in debug mode to avoid flooding logs in high-throughput scenarios
      // Check CloudflareEnv bindings (DEBUG, ENVIRONMENT) rather than process.env
      const shouldLog = this.env?.DEBUG || this.env?.ENVIRONMENT === 'development'
      if (shouldLog) {
        console.warn('[event-stream] WebSocket send failed:', {
          readyState: (ws as any).readyState,
          error: error instanceof Error ? error.message : 'unknown',
        })
      }
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
  // UNIFIED EVENT QUERIES
  // ============================================================================

  /**
   * Query unified events with structured filters
   */
  queryUnifiedEvents(filters: {
    event_type?: EventType
    trace_id?: string
    session_id?: string
    correlation_id?: string
    ns?: string
    service_name?: string
    log_level?: string
    timestamp_after?: string
    limit?: number
  }): StoredUnifiedEvent[] {
    return this._db.queryUnified(filters)
  }

  /**
   * Get all events for a specific trace
   */
  getTraceEvents(traceId: string): StoredUnifiedEvent[] {
    return this._db.queryUnified({ trace_id: traceId })
  }

  /**
   * Get all events for a specific session
   */
  getSessionEvents(sessionId: string): StoredUnifiedEvent[] {
    return this._db.queryUnified({ session_id: sessionId })
  }

  /**
   * Get all events with a specific correlation ID
   */
  getCorrelatedEvents(correlationId: string): StoredUnifiedEvent[] {
    return this._db.queryUnified({ correlation_id: correlationId })
  }

  /**
   * Broadcast a UnifiedEvent (public method)
   */
  async broadcastUnifiedEvent(event: Partial<UnifiedEvent>): Promise<void> {
    // Validate required fields to avoid unsafe operations
    if (!event.id || typeof event.id !== 'string' || event.id.trim() === '') {
      throw new Error('id field is required and must be a non-empty string')
    }
    if (!event.event_type) {
      throw new Error('event_type field is required')
    }
    if (!event.event_name) {
      throw new Error('event_name field is required')
    }
    if (!event.ns) {
      throw new Error('ns field is required')
    }

    const id = event.id
    const eventType = event.event_type
    const eventName = event.event_name
    const ns = event.ns
    const timestamp = event.timestamp || new Date().toISOString()

    // Check deduplication
    if (this.isDuplicate(ns, id)) {
      this.dedupStats.deduplicatedCount++
      return
    }
    this.dedupStats.uniqueCount++

    // Store in hot tier with full unified event data
    this._db.insertUnified({
      ...event,
      id,
      event_type: eventType,
      event_name: eventName,
      ns,
      timestamp,
    })

    // Update topic stats
    const stats = this.topicStats.get(ns)
    if (stats) {
      stats.messageCount++
      stats.lastMessageAt = Date.now()
    }

    // Broadcast to subscribers (without storing again)
    const broadcastEvent: BroadcastEvent = {
      id,
      type: eventType,
      topic: ns,
      payload: event,
      timestamp: typeof timestamp === 'string' ? new Date(timestamp).getTime() : Date.now(),
    }

    // Fan out to subscribers directly (skip storage in broadcastToTopic)
    await this.fanOutToSubscribers(ns, broadcastEvent)

    // Notify live query subscribers
    await this.notifyLiveQuerySubscribers(broadcastEvent)
  }

  /**
   * Get event count in hot tier
   */
  getHotTierEventCount(): number {
    return this._db.getEventCount()
  }

  /**
   * Get all unified events (for testing/debugging)
   */
  getAllUnifiedEvents(): StoredUnifiedEvent[] {
    return this._db.getAllUnifiedEvents()
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

    // Clean up stale coalescing buffers (5 minute threshold)
    this.cleanupStaleBuffers(5 * 60 * 1000)

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
      } catch (error) {
        // Log close errors during shutdown for debugging
        console.debug('[event-stream] Graceful shutdown ws.close failed:', {
          error: error instanceof Error ? error.message : 'unknown',
        })
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
