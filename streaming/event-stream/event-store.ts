/**
 * EventStore - Persistent event storage for EventStreamDO
 *
 * Implements IEventStore interface for storing and retrieving UnifiedEvents.
 * Extracted from EventStreamDO as part of Wave 3 decomposition.
 *
 * @issue do-ygxr - EventStore Implementation
 * @wave Wave 3: EventStreamDO Decomposition
 */

import type { UnifiedEvent, EventType } from '../../types/unified-event'

// ============================================================================
// INTERFACE DEFINITION
// ============================================================================

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
 * IEventStore - Interface for persistent event storage
 *
 * Responsibilities:
 * - Store and retrieve UnifiedEvents
 * - Query by trace_id, session_id, correlation_id
 * - Cleanup old events (hot tier retention)
 * - Batch operations for efficiency
 */
export interface IEventStore {
  /**
   * Store a single event
   */
  store(event: Partial<UnifiedEvent>): Promise<void>

  /**
   * Store multiple events efficiently (batch insert)
   */
  storeBatch(events: Partial<UnifiedEvent>[]): Promise<void>

  /**
   * Query events by SQL-like filter
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
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Converts a UnifiedEvent to StoredUnifiedEvent format.
 */
function toStoredUnifiedEvent(event: Partial<UnifiedEvent>): StoredUnifiedEvent {
  // Validate required fields
  if (!event.id || typeof event.id !== 'string') {
    throw new Error('id field is required and must be a string')
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

  return {
    id: event.id,
    event_type: event.event_type,
    event_name: event.event_name,
    ns: event.ns,
    trace_id: event.trace_id || null,
    span_id: event.span_id || null,
    parent_id: event.parent_id || null,
    session_id: event.session_id || null,
    correlation_id: event.correlation_id || null,
    timestamp: event.timestamp || new Date().toISOString(),
    outcome: event.outcome || null,
    http_url: event.http_url || null,
    http_status: event.http_status || null,
    duration_ms: event.duration_ms || null,
    service_name: event.service_name || null,
    vital_name: event.vital_name || null,
    vital_value: event.vital_value || null,
    vital_rating: event.vital_rating || null,
    log_level: event.log_level || null,
    log_message: event.log_message || null,
    actor_id: event.actor_id || null,
    data: event.data ? JSON.stringify(event.data) : null,
    attributes: event.attributes ? JSON.stringify(event.attributes) : null,
    properties: event.properties ? JSON.stringify(event.properties) : null,
    // Map ns to topic for backwards compatibility
    topic: event.ns,
    type: event.event_type,
  }
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * EventStore - In-memory event storage implementation
 *
 * This is a simplified in-memory implementation that can be used
 * for testing or replaced with a SQL-backed implementation.
 *
 * Features:
 * - Store and retrieve UnifiedEvents
 * - Query by trace_id, session_id, correlation_id
 * - Cleanup old events based on timestamp
 * - Batch operations for efficiency
 */
export class EventStore implements IEventStore {
  private events: Map<string, StoredUnifiedEvent> = new Map()

  /**
   * Store a single event
   */
  async store(event: Partial<UnifiedEvent>): Promise<void> {
    const stored = toStoredUnifiedEvent(event)
    this.events.set(stored.id, stored)
  }

  /**
   * Store multiple events efficiently (batch insert)
   */
  async storeBatch(events: Partial<UnifiedEvent>[]): Promise<void> {
    for (const event of events) {
      const stored = toStoredUnifiedEvent(event)
      this.events.set(stored.id, stored)
    }
  }

  /**
   * Query events by SQL-like filter
   * Supports basic WHERE conditions for event_type, ns, trace_id, etc.
   */
  async query(sql: string): Promise<StoredUnifiedEvent[]> {
    const allEvents = Array.from(this.events.values())

    // Parse basic WHERE conditions
    return allEvents.filter((event) => {
      // Handle event_type filter
      const eventTypeMatch = sql.match(/event_type\s*=\s*['"]([^'"]+)['"]/)
      if (eventTypeMatch && event.event_type !== eventTypeMatch[1]) {
        return false
      }

      // Handle ns filter
      const nsMatch = sql.match(/ns\s*=\s*['"]([^'"]+)['"]/)
      if (nsMatch && event.ns !== nsMatch[1]) {
        return false
      }

      // Handle trace_id filter
      const traceMatch = sql.match(/trace_id\s*=\s*['"]([^'"]+)['"]/)
      if (traceMatch && event.trace_id !== traceMatch[1]) {
        return false
      }

      // Handle session_id filter
      const sessionMatch = sql.match(/session_id\s*=\s*['"]([^'"]+)['"]/)
      if (sessionMatch && event.session_id !== sessionMatch[1]) {
        return false
      }

      // Handle correlation_id filter
      const corrMatch = sql.match(/correlation_id\s*=\s*['"]([^'"]+)['"]/)
      if (corrMatch && event.correlation_id !== corrMatch[1]) {
        return false
      }

      // Handle log_level filter
      const logLevelMatch = sql.match(/log_level\s*=\s*['"]([^'"]+)['"]/)
      if (logLevelMatch && event.log_level !== logLevelMatch[1]) {
        return false
      }

      // Handle service_name filter
      const serviceMatch = sql.match(/service_name\s*=\s*['"]([^'"]+)['"]/)
      if (serviceMatch && event.service_name !== serviceMatch[1]) {
        return false
      }

      // Handle outcome filter
      const outcomeMatch = sql.match(/outcome\s*=\s*['"]([^'"]+)['"]/)
      if (outcomeMatch && event.outcome !== outcomeMatch[1]) {
        return false
      }

      // Handle http_status filter
      const statusMatch = sql.match(/http_status\s*=\s*(\d+)/)
      if (statusMatch && event.http_status !== parseInt(statusMatch[1])) {
        return false
      }

      return true
    })
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
   * Get event by ID
   */
  async getById(id: string): Promise<StoredUnifiedEvent | null> {
    return this.events.get(id) || null
  }

  /**
   * Get event count (for metrics)
   */
  async count(): Promise<number> {
    return this.events.size
  }
}
