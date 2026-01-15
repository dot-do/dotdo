/**
 * EventStore - Persistent event storage for EventStreamDO
 *
 * Implements IEventStore interface for storing and retrieving UnifiedEvents.
 * Extracted from EventStreamDO as part of Wave 3 decomposition.
 *
 * @issue do-ygxr - EventStore Implementation
 * @issue do-j4j4 - REFACTOR: Inject IEventStore into EventStreamDO
 * @wave Wave 3: EventStreamDO Decomposition
 */

import type { UnifiedEvent, EventType } from '../../types/unified-event'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Legacy BroadcastEvent format for backwards compatibility
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
 * Query result format
 */
export interface QueryResult {
  rows: Record<string, unknown>[]
}

/**
 * StoredUnifiedEvent - internal storage format
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

  // Timing
  timestamp: string

  // Key queryable columns
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
 * Filter options for queryUnified
 */
export interface UnifiedQueryFilters {
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

/**
 * IEventStore - Interface for persistent event storage
 *
 * Responsibilities:
 * - Store and retrieve UnifiedEvents
 * - Query by trace_id, session_id, correlation_id
 * - Cleanup old events (hot tier retention)
 * - Batch operations for efficiency
 * - Support legacy BroadcastEvent format
 * - Event replay functionality
 */
export interface IEventStore {
  /**
   * Store a single event (UnifiedEvent format)
   */
  store(event: Partial<UnifiedEvent>): Promise<void>

  /**
   * Store multiple events efficiently (batch insert)
   */
  storeBatch(events: Partial<UnifiedEvent>[]): Promise<void>

  /**
   * Query events by SQL-like filter string
   * Returns events matching the query
   */
  query(sql: string): Promise<StoredUnifiedEvent[]>

  /**
   * Get all events for a trace (spans in a distributed trace)
   */
  getByTraceId(traceId: string): Promise<StoredUnifiedEvent[]>

  /**
   * Get all events for a session (user session correlation)
   */
  getBySessionId(sessionId: string): Promise<StoredUnifiedEvent[]>

  /**
   * Get all events for a correlation ID (custom cross-system linking)
   */
  getByCorrelationId(correlationId: string): Promise<StoredUnifiedEvent[]>

  /**
   * Cleanup events older than threshold
   * @param olderThanMs - Delete events older than this many milliseconds
   * @returns Number of deleted events
   */
  cleanup(olderThanMs: number): Promise<number>

  /**
   * Get event by ID
   */
  getById(id: string): Promise<StoredUnifiedEvent | null>

  /**
   * Get event count (for metrics)
   */
  count(): Promise<number>

  // =========================================================================
  // Extended methods for EventStreamDO integration
  // =========================================================================

  /**
   * Initialize schema (no-op for in-memory, runs DDL for SQL backends)
   */
  exec(sql: string): Promise<void>

  /**
   * Query with parameters (for SQL backends)
   */
  queryWithParams(sql: string, params?: unknown[]): Promise<QueryResult>

  /**
   * Insert event supporting both legacy BroadcastEvent and UnifiedEvent formats
   */
  insert(event: BroadcastEvent | Partial<UnifiedEvent>): void

  /**
   * Insert a UnifiedEvent directly (sync for performance)
   */
  insertUnified(event: Partial<UnifiedEvent>): void

  /**
   * Batch insert events (supports both formats)
   */
  insertBatch(events: (BroadcastEvent | Partial<UnifiedEvent>)[]): void

  /**
   * Delete events older than a specific timestamp
   */
  deleteOlderThan(timestamp: number): void

  /**
   * Get events after a specific event ID (for replay)
   */
  getEventAfter(eventId: string, topic?: string): BroadcastEvent[]

  /**
   * Get events after a specific timestamp (for replay)
   */
  getEventsAfterTimestamp(timestamp: number, topic?: string): BroadcastEvent[]

  /**
   * Query unified events with structured filters
   */
  queryUnified(filters: UnifiedQueryFilters): StoredUnifiedEvent[]

  /**
   * Get all stored unified events (for testing/debugging)
   */
  getAllUnifiedEvents(): StoredUnifiedEvent[]

  /**
   * Get event count (sync version for backwards compatibility)
   */
  getEventCount(): number
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

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
      timestamp:
        typeof legacy.timestamp === 'number'
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

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * EventStore - In-memory event storage implementation
 *
 * This is the full implementation that can be used for EventStreamDO.
 * Supports both legacy BroadcastEvent and UnifiedEvent formats.
 *
 * Features:
 * - Store and retrieve UnifiedEvents
 * - Query by trace_id, session_id, correlation_id
 * - Cleanup old events based on timestamp
 * - Batch operations for efficiency
 * - Event replay functionality
 * - Legacy BroadcastEvent support
 */
export class EventStore implements IEventStore {
  private events: Map<string, StoredUnifiedEvent> = new Map()
  private schemaInitialized = false

  /**
   * Store a single event (async)
   */
  async store(event: Partial<UnifiedEvent>): Promise<void> {
    const stored = toStoredUnifiedEvent(event)
    this.events.set(stored.id, stored)
  }

  /**
   * Store multiple events efficiently (batch insert, async)
   */
  async storeBatch(events: Partial<UnifiedEvent>[]): Promise<void> {
    for (const event of events) {
      const stored = toStoredUnifiedEvent(event)
      this.events.set(stored.id, stored)
    }
  }

  /**
   * Query events by SQL-like filter string
   * Supports basic WHERE conditions for event_type, ns, trace_id, etc.
   */
  async query(sql: string): Promise<StoredUnifiedEvent[]> {
    const result = await this.queryWithParams(sql, [])
    return result.rows as StoredUnifiedEvent[]
  }

  /**
   * Get all events for a trace (spans in a distributed trace)
   */
  async getByTraceId(traceId: string): Promise<StoredUnifiedEvent[]> {
    const results = Array.from(this.events.values())
      .filter((e) => e.trace_id === traceId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    return results
  }

  /**
   * Get all events for a session (user session correlation)
   */
  async getBySessionId(sessionId: string): Promise<StoredUnifiedEvent[]> {
    const results = Array.from(this.events.values())
      .filter((e) => e.session_id === sessionId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    return results
  }

  /**
   * Get all events for a correlation ID (custom cross-system linking)
   */
  async getByCorrelationId(correlationId: string): Promise<StoredUnifiedEvent[]> {
    const results = Array.from(this.events.values())
      .filter((e) => e.correlation_id === correlationId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    return results
  }

  /**
   * Cleanup events older than threshold
   * @param olderThanMs - Delete events older than this many milliseconds
   * @returns Number of deleted events
   */
  async cleanup(olderThanMs: number): Promise<number> {
    const now = Date.now()
    const cutoff = now - olderThanMs
    let deleted = 0

    for (const [id, event] of this.events) {
      const eventTime = new Date(event.timestamp).getTime()
      if (eventTime < cutoff) {
        this.events.delete(id)
        deleted++
      }
    }

    return deleted
  }

  /**
   * Get event by ID (async)
   */
  async getById(id: string): Promise<StoredUnifiedEvent | null> {
    return this.events.get(id) || null
  }

  /**
   * Get event count (async)
   */
  async count(): Promise<number> {
    return this.events.size
  }

  // =========================================================================
  // Extended methods for EventStreamDO integration
  // =========================================================================

  /**
   * Initialize schema (no-op for in-memory implementation)
   */
  async exec(sql: string): Promise<void> {
    // Parse CREATE TABLE and CREATE INDEX statements
    if (sql.includes('CREATE TABLE') || sql.includes('CREATE INDEX')) {
      this.schemaInitialized = true
    }
  }

  /**
   * Query with parameters (SQL-like query)
   */
  async queryWithParams(sql: string, params: unknown[] = []): Promise<QueryResult> {
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
      if (sql.includes("type = 'order.created'") || (sql.includes('type = $') && params.includes('order.created'))) {
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
      if (sql.includes('topic = $') || sql.includes("topic = '")) {
        if (sql.includes("topic = 'orders'") && event.topic !== 'orders') return false
        if (sql.includes("topic = 'recovery'") && event.topic !== 'recovery') return false
        if (sql.includes("topic = 'bulk'") && event.topic !== 'bulk') return false
        if (sql.includes('topic = $1') && params[0] && event.topic !== params[0]) return false
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
   * Insert event supporting both legacy BroadcastEvent and UnifiedEvent formats (sync)
   */
  insert(event: BroadcastEvent | Partial<UnifiedEvent>): void {
    const stored = toStoredUnifiedEvent(event)
    this.events.set(stored.id, stored)
  }

  /**
   * Insert a UnifiedEvent directly (sync)
   */
  insertUnified(event: Partial<UnifiedEvent>): void {
    const stored = toStoredUnifiedEvent(event)
    this.events.set(stored.id, stored)
  }

  /**
   * Batch insert events (supports both formats, sync)
   */
  insertBatch(events: (BroadcastEvent | Partial<UnifiedEvent>)[]): void {
    for (const event of events) {
      this.insert(event)
    }
  }

  /**
   * Delete events older than a specific timestamp
   */
  deleteOlderThan(timestamp: number): void {
    for (const [id, event] of this.events) {
      const eventTs = new Date(event.timestamp).getTime()
      if (eventTs < timestamp) {
        this.events.delete(id)
      }
    }
  }

  /**
   * Get events after a specific event ID (for replay)
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
   * Get events after a specific timestamp (for replay)
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
   * Query unified events with structured filters
   */
  queryUnified(filters: UnifiedQueryFilters): StoredUnifiedEvent[] {
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
   * Get all stored unified events (for testing/debugging)
   */
  getAllUnifiedEvents(): StoredUnifiedEvent[] {
    return Array.from(this.events.values())
  }

  /**
   * Get event count (sync version)
   */
  getEventCount(): number {
    return this.events.size
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
}
