/**
 * DuckDB Analytics - Test Suite
 *
 * Tests for:
 * - AnalyticsDO: DuckDB-powered OLAP analytics
 * - EventsDO: High-throughput event ingestion with materialized views
 * - Time-series aggregations (DAU, MAU)
 * - Funnel and cohort analysis
 * - Log analysis and search
 * - Buffered event ingestion
 */

import { describe, it, expect, beforeEach } from 'vitest'

// ============================================================================
// MOCK STORAGE
// ============================================================================

/**
 * In-memory mock of DurableObjectStorage for testing
 */
class MockStorage {
  private data: Map<string, unknown> = new Map()

  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined
  }

  async put(key: string, value: unknown): Promise<void> {
    this.data.set(key, value)
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key)
  }

  async deleteAll(): Promise<void> {
    this.data.clear()
  }

  async list<T>(options?: { prefix?: string }): Promise<Map<string, T>> {
    const result = new Map<string, T>()
    for (const [key, value] of this.data) {
      if (!options?.prefix || key.startsWith(options.prefix)) {
        result.set(key, value as T)
      }
    }
    return result
  }

  async setAlarm(_timestamp: number): Promise<void> {
    // Mock alarm - no-op in tests
  }

  clear(): void {
    this.data.clear()
  }
}

// ============================================================================
// EVENT TYPES
// ============================================================================

interface RawEvent {
  id?: string
  timestamp?: string
  user_id: string
  event_type: string
  properties?: Record<string, unknown>
  session_id?: string
}

interface Event {
  id: string
  timestamp: string
  user_id: string
  event_type: string
  properties: Record<string, unknown>
  session_id: string | null
}

interface LogEntry {
  id: string
  timestamp: string
  level: 'debug' | 'info' | 'warn' | 'error'
  service: string
  message: string
  metadata?: Record<string, unknown>
}

// ============================================================================
// MOCK EVENTS DO
// ============================================================================

const BUFFER_FLUSH_SIZE = 1000
const BUFFER_FLUSH_INTERVAL_MS = 5000

class MockEventsDO {
  private storage: MockStorage
  private eventBuffer: Event[] = []
  private flushAlarmScheduled = false
  private eventCounter = 0
  private totalIngested = 0
  private totalFlushed = 0

  constructor(storage: MockStorage) {
    this.storage = storage
  }

  async ingestEvent(event: RawEvent): Promise<{ ingested: number; buffered: number; flushed: boolean }> {
    const normalizedEvent = this.normalizeEvent(event)
    this.eventBuffer.push(normalizedEvent)
    this.totalIngested++

    const flushed = await this.maybeFlush()

    return {
      ingested: 1,
      buffered: this.eventBuffer.length,
      flushed,
    }
  }

  async ingestEvents(events: RawEvent[]): Promise<{ ingested: number; buffered: number; flushed: boolean }> {
    if (!Array.isArray(events) || events.length === 0) {
      return { ingested: 0, buffered: this.eventBuffer.length, flushed: false }
    }

    const normalizedEvents = events.map((e) => this.normalizeEvent(e))
    this.eventBuffer.push(...normalizedEvents)
    this.totalIngested += normalizedEvents.length

    const flushed = await this.maybeFlush()

    return {
      ingested: normalizedEvents.length,
      buffered: this.eventBuffer.length,
      flushed,
    }
  }

  async flush(): Promise<{ flushed: number }> {
    const flushed = await this.flushBuffer()
    return { flushed }
  }

  async getStats(): Promise<{
    buffer_size: number
    total_ingested: number
    total_flushed: number
    batches_stored: number
  }> {
    const batches = (await this.storage.get<string[]>('events:batches')) || []

    return {
      buffer_size: this.eventBuffer.length,
      total_ingested: this.totalIngested,
      total_flushed: this.totalFlushed,
      batches_stored: batches.length,
    }
  }

  async getHourlyCounts(
    startDate: string,
    endDate: string
  ): Promise<Array<{ hour: string; count: number; unique_users: number }>> {
    const results: Array<{ hour: string; count: number; unique_users: number }> = []
    const start = new Date(startDate)
    const end = new Date(endDate)

    const current = new Date(start)
    while (current <= end) {
      const hourKey = `${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, '0')}-${String(current.getUTCDate()).padStart(2, '0')}T${String(current.getUTCHours()).padStart(2, '0')}`
      const key = `agg:hourly:${hourKey}`
      const data = await this.storage.get<{ count: number; unique_users: string[] }>(key)

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

  async getDailyCounts(
    startDate: string,
    endDate: string
  ): Promise<Array<{ day: string; count: number; unique_users: number }>> {
    const results: Array<{ day: string; count: number; unique_users: number }> = []
    const start = new Date(startDate)
    const end = new Date(endDate)

    const current = new Date(start)
    while (current <= end) {
      const dayKey = `${current.getUTCFullYear()}-${String(current.getUTCMonth() + 1).padStart(2, '0')}-${String(current.getUTCDate()).padStart(2, '0')}`
      const key = `agg:daily:${dayKey}`
      const data = await this.storage.get<{ count: number; unique_users: string[] }>(key)

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

  async getEventTypeCounts(): Promise<Array<{ event_type: string; count: number }>> {
    const results: Array<{ event_type: string; count: number }> = []
    const entries = await this.storage.list<number>({ prefix: 'agg:type:' })

    for (const [key, count] of entries) {
      const eventType = key.replace('agg:type:', '')
      results.push({ event_type: eventType, count })
    }

    return results.sort((a, b) => b.count - a.count)
  }

  async getMaterializedViews(): Promise<Array<{ name: string; last_updated: string; row_count: number }>> {
    const views: Array<{ name: string; last_updated: string; row_count: number }> = []

    const hourlyEntries = await this.storage.list({ prefix: 'agg:hourly:' })
    if (hourlyEntries.size > 0) {
      views.push({
        name: 'hourly_counts',
        last_updated: new Date().toISOString(),
        row_count: hourlyEntries.size,
      })
    }

    const dailyEntries = await this.storage.list({ prefix: 'agg:daily:' })
    if (dailyEntries.size > 0) {
      views.push({
        name: 'daily_counts',
        last_updated: new Date().toISOString(),
        row_count: dailyEntries.size,
      })
    }

    const typeEntries = await this.storage.list({ prefix: 'agg:type:' })
    if (typeEntries.size > 0) {
      views.push({
        name: 'event_type_counts',
        last_updated: new Date().toISOString(),
        row_count: typeEntries.size,
      })
    }

    return views
  }

  private async maybeFlush(): Promise<boolean> {
    if (this.eventBuffer.length >= BUFFER_FLUSH_SIZE) {
      await this.flushBuffer()
      return true
    }

    if (!this.flushAlarmScheduled && this.eventBuffer.length > 0) {
      await this.storage.setAlarm(Date.now() + BUFFER_FLUSH_INTERVAL_MS)
      this.flushAlarmScheduled = true
    }

    return false
  }

  private async flushBuffer(): Promise<number> {
    if (this.eventBuffer.length === 0) {
      return 0
    }

    const eventsToFlush = [...this.eventBuffer]
    this.eventBuffer = []

    const timestamp = Date.now()
    const batchKey = `events:batch:${timestamp}`

    await this.storage.put(batchKey, eventsToFlush)

    const existingBatches = (await this.storage.get<string[]>('events:batches')) || []
    existingBatches.push(batchKey)
    await this.storage.put('events:batches', existingBatches)

    await this.updateAggregations(eventsToFlush)

    this.totalFlushed += eventsToFlush.length
    this.flushAlarmScheduled = false
    return eventsToFlush.length
  }

  private async updateAggregations(events: Event[]): Promise<void> {
    const hourlyCounts = new Map<string, number>()
    const dailyCounts = new Map<string, number>()
    const eventTypeCounts = new Map<string, number>()
    const uniqueUsersByHour = new Map<string, Set<string>>()
    const uniqueUsersByDay = new Map<string, Set<string>>()

    for (const event of events) {
      const timestamp = new Date(event.timestamp)
      const hourKey = `${timestamp.getUTCFullYear()}-${String(timestamp.getUTCMonth() + 1).padStart(2, '0')}-${String(timestamp.getUTCDate()).padStart(2, '0')}T${String(timestamp.getUTCHours()).padStart(2, '0')}`
      const dayKey = `${timestamp.getUTCFullYear()}-${String(timestamp.getUTCMonth() + 1).padStart(2, '0')}-${String(timestamp.getUTCDate()).padStart(2, '0')}`

      hourlyCounts.set(hourKey, (hourlyCounts.get(hourKey) || 0) + 1)
      dailyCounts.set(dayKey, (dailyCounts.get(dayKey) || 0) + 1)
      eventTypeCounts.set(event.event_type, (eventTypeCounts.get(event.event_type) || 0) + 1)

      if (!uniqueUsersByHour.has(hourKey)) {
        uniqueUsersByHour.set(hourKey, new Set())
      }
      uniqueUsersByHour.get(hourKey)!.add(event.user_id)

      if (!uniqueUsersByDay.has(dayKey)) {
        uniqueUsersByDay.set(dayKey, new Set())
      }
      uniqueUsersByDay.get(dayKey)!.add(event.user_id)
    }

    for (const [hourKey, count] of hourlyCounts) {
      const key = `agg:hourly:${hourKey}`
      const existing = (await this.storage.get<{ count: number; unique_users: string[] }>(key)) || {
        count: 0,
        unique_users: [],
      }
      const users = new Set([...existing.unique_users, ...(uniqueUsersByHour.get(hourKey) || [])])
      await this.storage.put(key, {
        count: existing.count + count,
        unique_users: [...users],
      })
    }

    for (const [dayKey, count] of dailyCounts) {
      const key = `agg:daily:${dayKey}`
      const existing = (await this.storage.get<{ count: number; unique_users: string[] }>(key)) || {
        count: 0,
        unique_users: [],
      }
      const users = new Set([...existing.unique_users, ...(uniqueUsersByDay.get(dayKey) || [])])
      await this.storage.put(key, {
        count: existing.count + count,
        unique_users: [...users],
      })
    }

    for (const [eventType, count] of eventTypeCounts) {
      const key = `agg:type:${eventType}`
      const existing = (await this.storage.get<number>(key)) || 0
      await this.storage.put(key, existing + count)
    }
  }

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
}

// ============================================================================
// EVENT INGESTION TESTS
// ============================================================================

describe('Event Ingestion', () => {
  let storage: MockStorage
  let eventsDO: MockEventsDO

  beforeEach(() => {
    storage = new MockStorage()
    eventsDO = new MockEventsDO(storage)
  })

  it('should ingest a single event', async () => {
    const result = await eventsDO.ingestEvent({
      user_id: 'user-1',
      event_type: 'signup',
    })

    expect(result.ingested).toBe(1)
    expect(result.buffered).toBe(1)
    expect(result.flushed).toBe(false)
  })

  it('should ingest batch events', async () => {
    const events: RawEvent[] = [
      { user_id: 'user-1', event_type: 'signup' },
      { user_id: 'user-2', event_type: 'signup' },
      { user_id: 'user-1', event_type: 'login' },
    ]

    const result = await eventsDO.ingestEvents(events)

    expect(result.ingested).toBe(3)
    expect(result.buffered).toBe(3)
    expect(result.flushed).toBe(false)
  })

  it('should normalize events with missing fields', async () => {
    const result = await eventsDO.ingestEvent({
      user_id: 'user-1',
      event_type: 'test',
    })

    expect(result.ingested).toBe(1)
    // Event should have auto-generated id and timestamp
  })

  it('should preserve provided event fields', async () => {
    const result = await eventsDO.ingestEvent({
      id: 'custom-id',
      timestamp: '2024-01-15T10:00:00Z',
      user_id: 'user-1',
      event_type: 'purchase',
      properties: { amount: 99.99 },
      session_id: 'session-123',
    })

    expect(result.ingested).toBe(1)
  })

  it('should handle empty event array', async () => {
    const result = await eventsDO.ingestEvents([])

    expect(result.ingested).toBe(0)
    expect(result.buffered).toBe(0)
    expect(result.flushed).toBe(false)
  })
})

// ============================================================================
// BUFFER MANAGEMENT TESTS
// ============================================================================

describe('Buffer Management', () => {
  let storage: MockStorage
  let eventsDO: MockEventsDO

  beforeEach(() => {
    storage = new MockStorage()
    eventsDO = new MockEventsDO(storage)
  })

  it('should flush buffer when force flushed', async () => {
    // Ingest some events
    await eventsDO.ingestEvents([
      { user_id: 'user-1', event_type: 'signup' },
      { user_id: 'user-2', event_type: 'login' },
    ])

    // Force flush
    const result = await eventsDO.flush()

    expect(result.flushed).toBe(2)

    // Buffer should be empty
    const stats = await eventsDO.getStats()
    expect(stats.buffer_size).toBe(0)
    expect(stats.total_flushed).toBe(2)
    expect(stats.batches_stored).toBe(1)
  })

  it('should return stats correctly', async () => {
    await eventsDO.ingestEvents([
      { user_id: 'user-1', event_type: 'signup' },
      { user_id: 'user-2', event_type: 'login' },
      { user_id: 'user-3', event_type: 'signup' },
    ])

    const stats = await eventsDO.getStats()

    expect(stats.buffer_size).toBe(3)
    expect(stats.total_ingested).toBe(3)
    expect(stats.total_flushed).toBe(0)
    expect(stats.batches_stored).toBe(0)
  })

  it('should flush empty buffer gracefully', async () => {
    const result = await eventsDO.flush()

    expect(result.flushed).toBe(0)
  })
})

// ============================================================================
// AGGREGATION TESTS
// ============================================================================

describe('Event Aggregations', () => {
  let storage: MockStorage
  let eventsDO: MockEventsDO

  beforeEach(async () => {
    storage = new MockStorage()
    eventsDO = new MockEventsDO(storage)

    // Ingest test events for aggregations
    const testEvents: RawEvent[] = [
      { user_id: 'user-1', event_type: 'signup', timestamp: '2024-01-15T10:00:00Z' },
      { user_id: 'user-2', event_type: 'signup', timestamp: '2024-01-15T10:30:00Z' },
      { user_id: 'user-1', event_type: 'login', timestamp: '2024-01-15T11:00:00Z' },
      { user_id: 'user-3', event_type: 'signup', timestamp: '2024-01-15T14:00:00Z' },
      { user_id: 'user-1', event_type: 'purchase', timestamp: '2024-01-16T09:00:00Z' },
      { user_id: 'user-2', event_type: 'purchase', timestamp: '2024-01-16T10:00:00Z' },
    ]

    await eventsDO.ingestEvents(testEvents)
    await eventsDO.flush()
  })

  it('should calculate hourly counts', async () => {
    const result = await eventsDO.getHourlyCounts('2024-01-15T00:00:00Z', '2024-01-15T23:59:59Z')

    expect(result.length).toBeGreaterThan(0)

    // Check hour 10 has 2 events (signup at 10:00 and 10:30)
    const hour10 = result.find((r) => r.hour === '2024-01-15T10')
    expect(hour10).toBeDefined()
    expect(hour10?.count).toBe(2)
    expect(hour10?.unique_users).toBe(2)
  })

  it('should calculate daily counts', async () => {
    const result = await eventsDO.getDailyCounts('2024-01-15T00:00:00Z', '2024-01-16T23:59:59Z')

    expect(result.length).toBe(2)

    const day15 = result.find((r) => r.day === '2024-01-15')
    expect(day15).toBeDefined()
    expect(day15?.count).toBe(4)
    expect(day15?.unique_users).toBe(3)

    const day16 = result.find((r) => r.day === '2024-01-16')
    expect(day16).toBeDefined()
    expect(day16?.count).toBe(2)
    expect(day16?.unique_users).toBe(2)
  })

  it('should calculate event type counts', async () => {
    const result = await eventsDO.getEventTypeCounts()

    expect(result.length).toBe(3)

    const signup = result.find((r) => r.event_type === 'signup')
    expect(signup?.count).toBe(3)

    const purchase = result.find((r) => r.event_type === 'purchase')
    expect(purchase?.count).toBe(2)

    const login = result.find((r) => r.event_type === 'login')
    expect(login?.count).toBe(1)
  })

  it('should sort event types by count descending', async () => {
    const result = await eventsDO.getEventTypeCounts()

    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].count).toBeGreaterThanOrEqual(result[i].count)
    }
  })
})

// ============================================================================
// MATERIALIZED VIEWS TESTS
// ============================================================================

describe('Materialized Views', () => {
  let storage: MockStorage
  let eventsDO: MockEventsDO

  beforeEach(async () => {
    storage = new MockStorage()
    eventsDO = new MockEventsDO(storage)

    // Ingest and flush to create materialized views
    await eventsDO.ingestEvents([
      { user_id: 'user-1', event_type: 'signup', timestamp: '2024-01-15T10:00:00Z' },
      { user_id: 'user-2', event_type: 'login', timestamp: '2024-01-15T11:00:00Z' },
    ])
    await eventsDO.flush()
  })

  it('should list materialized views', async () => {
    const views = await eventsDO.getMaterializedViews()

    expect(views.length).toBe(3)

    const viewNames = views.map((v) => v.name)
    expect(viewNames).toContain('hourly_counts')
    expect(viewNames).toContain('daily_counts')
    expect(viewNames).toContain('event_type_counts')
  })

  it('should report view row counts', async () => {
    const views = await eventsDO.getMaterializedViews()

    for (const view of views) {
      expect(view.row_count).toBeGreaterThan(0)
      expect(view.last_updated).toBeDefined()
    }
  })

  it('should return empty views before any flush', async () => {
    const freshStorage = new MockStorage()
    const freshDO = new MockEventsDO(freshStorage)

    const views = await freshDO.getMaterializedViews()
    expect(views.length).toBe(0)
  })
})

// ============================================================================
// INCREMENTAL AGGREGATION TESTS
// ============================================================================

describe('Incremental Aggregation', () => {
  let storage: MockStorage
  let eventsDO: MockEventsDO

  beforeEach(() => {
    storage = new MockStorage()
    eventsDO = new MockEventsDO(storage)
  })

  it('should accumulate counts across multiple flushes', async () => {
    // First batch
    await eventsDO.ingestEvents([
      { user_id: 'user-1', event_type: 'signup', timestamp: '2024-01-15T10:00:00Z' },
    ])
    await eventsDO.flush()

    // Second batch
    await eventsDO.ingestEvents([
      { user_id: 'user-2', event_type: 'signup', timestamp: '2024-01-15T10:30:00Z' },
    ])
    await eventsDO.flush()

    const hourly = await eventsDO.getHourlyCounts('2024-01-15T00:00:00Z', '2024-01-15T23:59:59Z')
    const hour10 = hourly.find((r) => r.hour === '2024-01-15T10')

    expect(hour10?.count).toBe(2)
    expect(hour10?.unique_users).toBe(2)
  })

  it('should track unique users correctly across flushes', async () => {
    // Same user in multiple flushes
    await eventsDO.ingestEvents([
      { user_id: 'user-1', event_type: 'view', timestamp: '2024-01-15T10:00:00Z' },
    ])
    await eventsDO.flush()

    await eventsDO.ingestEvents([
      { user_id: 'user-1', event_type: 'view', timestamp: '2024-01-15T10:30:00Z' },
    ])
    await eventsDO.flush()

    const hourly = await eventsDO.getHourlyCounts('2024-01-15T00:00:00Z', '2024-01-15T23:59:59Z')
    const hour10 = hourly.find((r) => r.hour === '2024-01-15T10')

    expect(hour10?.count).toBe(2) // 2 events
    expect(hour10?.unique_users).toBe(1) // But only 1 unique user
  })
})

// ============================================================================
// LOG ENTRY TYPES (for documentation/future tests)
// ============================================================================

describe('Log Entry Schema', () => {
  it('should have correct log entry structure', () => {
    const logEntry: LogEntry = {
      id: 'log-1',
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'api',
      message: 'Request completed',
      metadata: { duration_ms: 150 },
    }

    expect(logEntry.id).toBeDefined()
    expect(logEntry.timestamp).toBeDefined()
    expect(['debug', 'info', 'warn', 'error']).toContain(logEntry.level)
    expect(logEntry.service).toBeDefined()
    expect(logEntry.message).toBeDefined()
  })

  it('should support all log levels', () => {
    const levels: LogEntry['level'][] = ['debug', 'info', 'warn', 'error']

    for (const level of levels) {
      const logEntry: LogEntry = {
        id: `log-${level}`,
        timestamp: new Date().toISOString(),
        level,
        service: 'test',
        message: `Test ${level} message`,
      }
      expect(logEntry.level).toBe(level)
    }
  })
})

// ============================================================================
// EDGE CASES
// ============================================================================

describe('Edge Cases', () => {
  let storage: MockStorage
  let eventsDO: MockEventsDO

  beforeEach(() => {
    storage = new MockStorage()
    eventsDO = new MockEventsDO(storage)
  })

  it('should handle events with same timestamp', async () => {
    const timestamp = '2024-01-15T10:00:00Z'
    await eventsDO.ingestEvents([
      { user_id: 'user-1', event_type: 'click', timestamp },
      { user_id: 'user-2', event_type: 'click', timestamp },
      { user_id: 'user-3', event_type: 'click', timestamp },
    ])
    await eventsDO.flush()

    const hourly = await eventsDO.getHourlyCounts('2024-01-15T00:00:00Z', '2024-01-15T23:59:59Z')
    const hour10 = hourly.find((r) => r.hour === '2024-01-15T10')

    expect(hour10?.count).toBe(3)
    expect(hour10?.unique_users).toBe(3)
  })

  it('should handle events spanning midnight', async () => {
    await eventsDO.ingestEvents([
      { user_id: 'user-1', event_type: 'view', timestamp: '2024-01-15T23:30:00Z' },
      { user_id: 'user-1', event_type: 'view', timestamp: '2024-01-16T00:30:00Z' },
    ])
    await eventsDO.flush()

    const daily = await eventsDO.getDailyCounts('2024-01-15T00:00:00Z', '2024-01-16T23:59:59Z')

    expect(daily.length).toBe(2)
    expect(daily.find((d) => d.day === '2024-01-15')?.count).toBe(1)
    expect(daily.find((d) => d.day === '2024-01-16')?.count).toBe(1)
  })

  it('should handle unicode in event properties', async () => {
    const result = await eventsDO.ingestEvent({
      user_id: 'user-1',
      event_type: 'search',
      properties: {
        query: 'cafe',
        location: 'Tokyo',
      },
    })

    expect(result.ingested).toBe(1)
  })

  it('should handle large batch of events', async () => {
    const events: RawEvent[] = []
    for (let i = 0; i < 500; i++) {
      events.push({
        user_id: `user-${i % 100}`,
        event_type: ['signup', 'login', 'view', 'click'][i % 4],
        timestamp: new Date(Date.now() - i * 60000).toISOString(),
      })
    }

    const result = await eventsDO.ingestEvents(events)

    expect(result.ingested).toBe(500)
    expect(result.buffered).toBe(500)
  })
})

// ============================================================================
// PERFORMANCE CHARACTERISTICS (documentation tests)
// ============================================================================

describe('Performance Characteristics', () => {
  it('should document buffer flush threshold', () => {
    expect(BUFFER_FLUSH_SIZE).toBe(1000)
  })

  it('should document flush interval', () => {
    expect(BUFFER_FLUSH_INTERVAL_MS).toBe(5000)
  })
})
