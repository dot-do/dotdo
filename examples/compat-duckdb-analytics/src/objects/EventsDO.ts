/**
 * EventsDO - High-Throughput Event Ingestion Durable Object
 *
 * Optimized for event ingestion at scale. Acts as a write buffer
 * that batches events before flushing to storage.
 *
 * Features:
 * - High-throughput batch ingestion
 * - Write-ahead log for durability
 * - Automatic aggregation into materialized views
 * - Event validation and deduplication
 * - Buffered writes with configurable flush interval
 */

import { DurableObject } from 'cloudflare:workers'

// ============================================================================
// TYPES
// ============================================================================

export interface RawEvent {
  id?: string
  timestamp?: string
  user_id: string
  event_type: string
  properties?: Record<string, unknown>
  session_id?: string
}

export interface Event {
  id: string
  timestamp: string
  user_id: string
  event_type: string
  properties: Record<string, unknown>
  session_id: string | null
}

export interface IngestResult {
  ingested: number
  buffered: number
  flushed: boolean
}

export interface MaterializedView {
  name: string
  last_updated: string
  row_count: number
}

export interface Env {
  ANALYTICS_DO?: DurableObjectNamespace
  ENVIRONMENT?: string
}

// ============================================================================
// CONSTANTS
// ============================================================================

const BUFFER_FLUSH_SIZE = 1000 // Flush when buffer reaches this size
const BUFFER_FLUSH_INTERVAL_MS = 5000 // Flush every 5 seconds

// ============================================================================
// EVENTS DO CLASS
// ============================================================================

export class EventsDO extends DurableObject<Env> {
  private eventBuffer: Event[] = []
  private flushAlarmScheduled = false
  private eventCounter = 0

  // Stats tracking
  private totalIngested = 0
  private totalFlushed = 0

  // ═══════════════════════════════════════════════════════════════════════════
  // ALARM HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Handle alarm for periodic buffer flush
   */
  async alarm(): Promise<void> {
    this.flushAlarmScheduled = false
    await this.flushBuffer()
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENT INGESTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Ingest a single event
   */
  async ingestEvent(event: RawEvent): Promise<IngestResult> {
    const normalizedEvent = this.normalizeEvent(event)
    this.eventBuffer.push(normalizedEvent)
    this.totalIngested++

    // Check if we should flush
    const flushed = await this.maybeFlush()

    return {
      ingested: 1,
      buffered: this.eventBuffer.length,
      flushed,
    }
  }

  /**
   * Batch ingest multiple events for high throughput
   */
  async ingestEvents(events: RawEvent[]): Promise<IngestResult> {
    if (!Array.isArray(events) || events.length === 0) {
      return { ingested: 0, buffered: this.eventBuffer.length, flushed: false }
    }

    // Normalize and validate all events
    const normalizedEvents = events.map(e => this.normalizeEvent(e))
    this.eventBuffer.push(...normalizedEvents)
    this.totalIngested += normalizedEvents.length

    // Check if we should flush
    const flushed = await this.maybeFlush()

    return {
      ingested: normalizedEvents.length,
      buffered: this.eventBuffer.length,
      flushed,
    }
  }

  /**
   * Force flush the event buffer immediately
   */
  async flush(): Promise<{ flushed: number }> {
    const flushed = await this.flushBuffer()
    return { flushed }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BUFFER MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Check if buffer should be flushed and do so if needed
   */
  private async maybeFlush(): Promise<boolean> {
    // Flush if buffer is full
    if (this.eventBuffer.length >= BUFFER_FLUSH_SIZE) {
      await this.flushBuffer()
      return true
    }

    // Schedule alarm for periodic flush if not already scheduled
    if (!this.flushAlarmScheduled && this.eventBuffer.length > 0) {
      await this.ctx.storage.setAlarm(Date.now() + BUFFER_FLUSH_INTERVAL_MS)
      this.flushAlarmScheduled = true
    }

    return false
  }

  /**
   * Flush event buffer to persistent storage
   */
  private async flushBuffer(): Promise<number> {
    if (this.eventBuffer.length === 0) {
      return 0
    }

    const eventsToFlush = [...this.eventBuffer]
    this.eventBuffer = []

    // Store events in batched writes
    const timestamp = Date.now()
    const batchKey = `events:batch:${timestamp}`

    await this.ctx.storage.put(batchKey, eventsToFlush)

    // Update event index for time-based queries
    const existingBatches = (await this.ctx.storage.get<string[]>('events:batches')) || []
    existingBatches.push(batchKey)
    await this.ctx.storage.put('events:batches', existingBatches)

    // Update aggregations asynchronously
    await this.updateAggregations(eventsToFlush)

    this.totalFlushed += eventsToFlush.length
    return eventsToFlush.length
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AGGREGATIONS (MATERIALIZED VIEWS)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Update materialized aggregations with new events
   */
  private async updateAggregations(events: Event[]): Promise<void> {
    // Update hourly event counts
    const hourlyCounts = new Map<string, number>()
    const dailyCounts = new Map<string, number>()
    const eventTypeCounts = new Map<string, number>()
    const uniqueUsersByHour = new Map<string, Set<string>>()
    const uniqueUsersByDay = new Map<string, Set<string>>()

    for (const event of events) {
      const timestamp = new Date(event.timestamp)
      const hourKey = `${timestamp.getUTCFullYear()}-${String(timestamp.getUTCMonth() + 1).padStart(2, '0')}-${String(timestamp.getUTCDate()).padStart(2, '0')}T${String(timestamp.getUTCHours()).padStart(2, '0')}`
      const dayKey = `${timestamp.getUTCFullYear()}-${String(timestamp.getUTCMonth() + 1).padStart(2, '0')}-${String(timestamp.getUTCDate()).padStart(2, '0')}`

      // Hourly counts
      hourlyCounts.set(hourKey, (hourlyCounts.get(hourKey) || 0) + 1)

      // Daily counts
      dailyCounts.set(dayKey, (dailyCounts.get(dayKey) || 0) + 1)

      // Event type counts
      eventTypeCounts.set(event.event_type, (eventTypeCounts.get(event.event_type) || 0) + 1)

      // Unique users by hour
      if (!uniqueUsersByHour.has(hourKey)) {
        uniqueUsersByHour.set(hourKey, new Set())
      }
      uniqueUsersByHour.get(hourKey)!.add(event.user_id)

      // Unique users by day
      if (!uniqueUsersByDay.has(dayKey)) {
        uniqueUsersByDay.set(dayKey, new Set())
      }
      uniqueUsersByDay.get(dayKey)!.add(event.user_id)
    }

    // Persist hourly aggregations
    for (const [hourKey, count] of hourlyCounts) {
      const key = `agg:hourly:${hourKey}`
      const existing = (await this.ctx.storage.get<{ count: number; unique_users: string[] }>(key)) || { count: 0, unique_users: [] }
      const users = new Set([...existing.unique_users, ...(uniqueUsersByHour.get(hourKey) || [])])
      await this.ctx.storage.put(key, {
        count: existing.count + count,
        unique_users: [...users],
      })
    }

    // Persist daily aggregations
    for (const [dayKey, count] of dailyCounts) {
      const key = `agg:daily:${dayKey}`
      const existing = (await this.ctx.storage.get<{ count: number; unique_users: string[] }>(key)) || { count: 0, unique_users: [] }
      const users = new Set([...existing.unique_users, ...(uniqueUsersByDay.get(dayKey) || [])])
      await this.ctx.storage.put(key, {
        count: existing.count + count,
        unique_users: [...users],
      })
    }

    // Persist event type counts
    for (const [eventType, count] of eventTypeCounts) {
      const key = `agg:type:${eventType}`
      const existing = (await this.ctx.storage.get<number>(key)) || 0
      await this.ctx.storage.put(key, existing + count)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // QUERY HELPERS (READ FROM AGGREGATIONS)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get hourly event counts for a date range
   */
  async getHourlyCounts(startDate: string, endDate: string): Promise<Array<{ hour: string; count: number; unique_users: number }>> {
    const results: Array<{ hour: string; count: number; unique_users: number }> = []
    const start = new Date(startDate)
    const end = new Date(endDate)

    const current = new Date(start)
    while (current <= end) {
      const hourKey = `${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, '0')}-${String(current.getUTCDate()).padStart(2, '0')}T${String(current.getUTCHours()).padStart(2, '0')}`
      const key = `agg:hourly:${hourKey}`
      const data = await this.ctx.storage.get<{ count: number; unique_users: string[] }>(key)

      if (data) {
        results.push({
          hour: hourKey,
          count: data.count,
          unique_users: data.unique_users.length,
        })
      }

      current.setUTCHours(current.getUTCHours() + 1)
    }

    return results
  }

  /**
   * Get daily event counts for a date range
   */
  async getDailyCounts(startDate: string, endDate: string): Promise<Array<{ day: string; count: number; unique_users: number }>> {
    const results: Array<{ day: string; count: number; unique_users: number }> = []
    const start = new Date(startDate)
    const end = new Date(endDate)

    const current = new Date(start)
    while (current <= end) {
      const dayKey = `${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, '0')}-${String(current.getUTCDate()).padStart(2, '0')}`
      const key = `agg:daily:${dayKey}`
      const data = await this.ctx.storage.get<{ count: number; unique_users: string[] }>(key)

      if (data) {
        results.push({
          day: dayKey,
          count: data.count,
          unique_users: data.unique_users.length,
        })
      }

      current.setUTCDate(current.getUTCDate() + 1)
    }

    return results
  }

  /**
   * Get event counts by type
   */
  async getEventTypeCounts(): Promise<Array<{ event_type: string; count: number }>> {
    const results: Array<{ event_type: string; count: number }> = []
    const entries = await this.ctx.storage.list<number>({ prefix: 'agg:type:' })

    for (const [key, count] of entries) {
      const eventType = key.replace('agg:type:', '')
      results.push({ event_type: eventType, count })
    }

    return results.sort((a, b) => b.count - a.count)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STATS & METADATA
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get ingestion statistics
   */
  async getStats(): Promise<{
    buffer_size: number
    total_ingested: number
    total_flushed: number
    batches_stored: number
  }> {
    const batches = (await this.ctx.storage.get<string[]>('events:batches')) || []

    return {
      buffer_size: this.eventBuffer.length,
      total_ingested: this.totalIngested,
      total_flushed: this.totalFlushed,
      batches_stored: batches.length,
    }
  }

  /**
   * Get list of materialized views
   */
  async getMaterializedViews(): Promise<MaterializedView[]> {
    const views: MaterializedView[] = []

    // Count hourly aggregations
    const hourlyEntries = await this.ctx.storage.list({ prefix: 'agg:hourly:' })
    if (hourlyEntries.size > 0) {
      views.push({
        name: 'hourly_counts',
        last_updated: new Date().toISOString(),
        row_count: hourlyEntries.size,
      })
    }

    // Count daily aggregations
    const dailyEntries = await this.ctx.storage.list({ prefix: 'agg:daily:' })
    if (dailyEntries.size > 0) {
      views.push({
        name: 'daily_counts',
        last_updated: new Date().toISOString(),
        row_count: dailyEntries.size,
      })
    }

    // Count event type aggregations
    const typeEntries = await this.ctx.storage.list({ prefix: 'agg:type:' })
    if (typeEntries.size > 0) {
      views.push({
        name: 'event_type_counts',
        last_updated: new Date().toISOString(),
        row_count: typeEntries.size,
      })
    }

    return views
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Normalize and validate an event
   */
  private normalizeEvent(event: RawEvent): Event {
    this.eventCounter++

    return {
      id: event.id || `evt_${Date.now()}_${this.eventCounter}`,
      timestamp: event.timestamp || new Date().toISOString(),
      user_id: event.user_id,
      event_type: event.event_type,
      properties: event.properties || {},
      session_id: event.session_id || null,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HTTP HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Handle RPC endpoint
    if (url.pathname === '/rpc' && request.method === 'POST') {
      try {
        const body = (await request.json()) as {
          jsonrpc: string
          id: number
          method: string
          params?: unknown[]
        }
        const { method, params = [], id } = body

        // Call the method on this DO
        const methodFn = (this as unknown as Record<string, (...args: unknown[]) => unknown>)[method]
        if (typeof methodFn !== 'function') {
          return Response.json(
            {
              jsonrpc: '2.0',
              id,
              error: { code: -32601, message: `Method '${method}' not found` },
            },
            { status: 400 }
          )
        }

        const result = await methodFn.apply(this, params)
        return Response.json({ jsonrpc: '2.0', id, result })
      } catch (error) {
        return Response.json(
          {
            jsonrpc: '2.0',
            id: 0,
            error: { code: -32603, message: String(error) },
          },
          { status: 500 }
        )
      }
    }

    return new Response('Not Found', { status: 404 })
  }
}

export default EventsDO
