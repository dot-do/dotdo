/**
 * EventStreamDO Unified Event Integration Tests
 *
 * Tests for EventStreamDO hot tier integration with the unified event schema.
 * Verifies:
 * - Unified events stored correctly in hot tier
 * - Queries work across event types
 * - Correlation queries work (trace_id, session_id, correlation_id)
 * - Hot tier retention still works
 * - Indexes are used for queries
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import {
  EventStreamDO,
  HOT_TIER_SCHEMA,
  type StoredUnifiedEvent,
} from '../event-stream-do'
import type { UnifiedEvent, EventType } from '../../types/unified-event'
import { createUnifiedEvent } from '../../types/unified-event'

// ============================================================================
// MOCK DURABLE OBJECT STATE
// ============================================================================

const createMockState = () => {
  const storage = new Map<string, unknown>()
  const alarms: number[] = []

  return {
    storage: {
      get: vi.fn(async (key: string) => storage.get(key)),
      put: vi.fn(async (key: string, value: unknown) => {
        storage.set(key, value)
      }),
      delete: vi.fn(async (key: string) => storage.delete(key)),
      deleteAll: vi.fn(async () => storage.clear()),
      list: vi.fn(async () => storage),
    },
    waitUntil: vi.fn(),
    setAlarm: vi.fn((timestamp: number) => alarms.push(timestamp)),
    getAlarm: vi.fn(async () => alarms[0]),
    deleteAlarm: vi.fn(async () => {
      alarms.length = 0
    }),
    getWebSockets: vi.fn(() => []),
    acceptWebSocket: vi.fn(),
    _storage: storage,
    _alarms: alarms,
  }
}

type MockState = ReturnType<typeof createMockState>

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

function createTestUnifiedEvent(overrides: Partial<UnifiedEvent> = {}): Partial<UnifiedEvent> {
  return {
    id: generateId(),
    event_type: 'trace',
    event_name: 'http.request',
    ns: 'https://api.example.com',
    timestamp: new Date().toISOString(),
    trace_id: null,
    span_id: null,
    parent_id: null,
    session_id: null,
    correlation_id: null,
    ...overrides,
  }
}

async function tick(ms = 0): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('EventStreamDO Unified Event Integration', () => {
  let mockState: MockState
  let eventStream: EventStreamDO

  beforeEach(() => {
    vi.useFakeTimers()
    mockState = createMockState()
    eventStream = new EventStreamDO(mockState)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('Hot Tier Schema', () => {
    it('should export the HOT_TIER_SCHEMA constant', () => {
      expect(HOT_TIER_SCHEMA).toBeDefined()
      expect(typeof HOT_TIER_SCHEMA).toBe('string')
    })

    it('should include core identity columns', () => {
      expect(HOT_TIER_SCHEMA).toContain('id TEXT PRIMARY KEY')
      expect(HOT_TIER_SCHEMA).toContain('event_type TEXT NOT NULL')
      expect(HOT_TIER_SCHEMA).toContain('event_name TEXT NOT NULL')
      expect(HOT_TIER_SCHEMA).toContain('ns TEXT NOT NULL')
    })

    it('should include causality columns', () => {
      expect(HOT_TIER_SCHEMA).toContain('trace_id TEXT')
      expect(HOT_TIER_SCHEMA).toContain('span_id TEXT')
      expect(HOT_TIER_SCHEMA).toContain('parent_id TEXT')
      expect(HOT_TIER_SCHEMA).toContain('session_id TEXT')
      expect(HOT_TIER_SCHEMA).toContain('correlation_id TEXT')
    })

    it('should include key queryable columns', () => {
      expect(HOT_TIER_SCHEMA).toContain('timestamp TEXT NOT NULL')
      expect(HOT_TIER_SCHEMA).toContain('outcome TEXT')
      expect(HOT_TIER_SCHEMA).toContain('http_url TEXT')
      expect(HOT_TIER_SCHEMA).toContain('http_status INTEGER')
      expect(HOT_TIER_SCHEMA).toContain('duration_ms REAL')
    })

    it('should include service columns', () => {
      expect(HOT_TIER_SCHEMA).toContain('service_name TEXT')
    })

    it('should include vitals columns', () => {
      expect(HOT_TIER_SCHEMA).toContain('vital_name TEXT')
      expect(HOT_TIER_SCHEMA).toContain('vital_value REAL')
      expect(HOT_TIER_SCHEMA).toContain('vital_rating TEXT')
    })

    it('should include logging columns', () => {
      expect(HOT_TIER_SCHEMA).toContain('log_level TEXT')
      expect(HOT_TIER_SCHEMA).toContain('log_message TEXT')
    })

    it('should include actor column', () => {
      expect(HOT_TIER_SCHEMA).toContain('actor_id TEXT')
    })

    it('should include JSON payload columns', () => {
      expect(HOT_TIER_SCHEMA).toContain('data TEXT')
      expect(HOT_TIER_SCHEMA).toContain('attributes TEXT')
      expect(HOT_TIER_SCHEMA).toContain('properties TEXT')
    })

    it('should include indexes for correlation queries', () => {
      expect(HOT_TIER_SCHEMA).toContain('CREATE INDEX IF NOT EXISTS idx_trace ON events(trace_id)')
      expect(HOT_TIER_SCHEMA).toContain('CREATE INDEX IF NOT EXISTS idx_session ON events(session_id)')
      expect(HOT_TIER_SCHEMA).toContain('CREATE INDEX IF NOT EXISTS idx_correlation ON events(correlation_id)')
    })

    it('should include indexes for type/time queries', () => {
      expect(HOT_TIER_SCHEMA).toContain('CREATE INDEX IF NOT EXISTS idx_type_time ON events(event_type, timestamp)')
      expect(HOT_TIER_SCHEMA).toContain('CREATE INDEX IF NOT EXISTS idx_ns_time ON events(ns, timestamp)')
    })
  })

  describe('Unified Events Storage', () => {
    it('should store a trace event in hot tier', async () => {
      const event = createTestUnifiedEvent({
        event_type: 'trace',
        event_name: 'http.request',
        trace_id: 'trace-123',
        span_id: 'span-456',
        http_method: 'GET',
        http_url: '/api/users',
        http_status: 200,
        duration_ms: 45,
      })

      await eventStream.broadcastUnifiedEvent(event)

      const events = eventStream.getAllUnifiedEvents()
      expect(events.length).toBe(1)
      expect(events[0].event_type).toBe('trace')
      expect(events[0].event_name).toBe('http.request')
      expect(events[0].trace_id).toBe('trace-123')
    })

    it('should store a log event in hot tier', async () => {
      const event = createTestUnifiedEvent({
        event_type: 'log',
        event_name: 'app.error',
        log_level: 'error',
        log_message: 'Connection failed',
        service_name: 'api-gateway',
      })

      await eventStream.broadcastUnifiedEvent(event)

      const events = eventStream.getAllUnifiedEvents()
      expect(events.length).toBe(1)
      expect(events[0].event_type).toBe('log')
      expect(events[0].log_level).toBe('error')
      expect(events[0].log_message).toBe('Connection failed')
    })

    it('should store a metric event in hot tier', async () => {
      const event = createTestUnifiedEvent({
        event_type: 'metric',
        event_name: 'request.count',
        service_name: 'web-server',
        data: { value: 100, unit: 'requests' },
      })

      await eventStream.broadcastUnifiedEvent(event)

      const events = eventStream.getAllUnifiedEvents()
      expect(events.length).toBe(1)
      expect(events[0].event_type).toBe('metric')
      expect(events[0].service_name).toBe('web-server')
    })

    it('should store a vital event in hot tier', async () => {
      const event = createTestUnifiedEvent({
        event_type: 'vital',
        event_name: 'web-vital',
        vital_name: 'LCP',
        vital_value: 2500,
        vital_rating: 'good',
      })

      await eventStream.broadcastUnifiedEvent(event)

      const events = eventStream.getAllUnifiedEvents()
      expect(events.length).toBe(1)
      expect(events[0].event_type).toBe('vital')
      expect(events[0].vital_name).toBe('LCP')
      expect(events[0].vital_value).toBe(2500)
      expect(events[0].vital_rating).toBe('good')
    })

    it('should store multiple events of different types', async () => {
      await eventStream.broadcastUnifiedEvent(createTestUnifiedEvent({ event_type: 'trace' }))
      await eventStream.broadcastUnifiedEvent(createTestUnifiedEvent({ event_type: 'log' }))
      await eventStream.broadcastUnifiedEvent(createTestUnifiedEvent({ event_type: 'metric' }))
      await eventStream.broadcastUnifiedEvent(createTestUnifiedEvent({ event_type: 'vital' }))

      const events = eventStream.getAllUnifiedEvents()
      expect(events.length).toBe(4)

      const types = events.map((e) => e.event_type)
      expect(types).toContain('trace')
      expect(types).toContain('log')
      expect(types).toContain('metric')
      expect(types).toContain('vital')
    })

    it('should store JSON data correctly', async () => {
      const event = createTestUnifiedEvent({
        event_type: 'track',
        event_name: 'user.signup',
        data: { userId: 'user-123', plan: 'premium' },
        attributes: { source: 'web', campaign: 'summer2024' },
        properties: { referrer: 'google.com' },
      })

      await eventStream.broadcastUnifiedEvent(event)

      const events = eventStream.getAllUnifiedEvents()
      expect(events.length).toBe(1)
      expect(events[0].data).toBeDefined()

      // Data should be stored as JSON string
      const data = JSON.parse(events[0].data!)
      expect(data.userId).toBe('user-123')
      expect(data.plan).toBe('premium')
    })
  })

  describe('Queries Across Event Types', () => {
    beforeEach(async () => {
      // Insert mixed events
      await eventStream.broadcastUnifiedEvent(createTestUnifiedEvent({
        id: 'evt-1',
        event_type: 'trace',
        ns: 'api-service',
        trace_id: 'trace-abc',
      }))
      await eventStream.broadcastUnifiedEvent(createTestUnifiedEvent({
        id: 'evt-2',
        event_type: 'log',
        ns: 'api-service',
        log_level: 'error',
      }))
      await eventStream.broadcastUnifiedEvent(createTestUnifiedEvent({
        id: 'evt-3',
        event_type: 'metric',
        ns: 'metrics-service',
      }))
      await eventStream.broadcastUnifiedEvent(createTestUnifiedEvent({
        id: 'evt-4',
        event_type: 'trace',
        ns: 'api-service',
        trace_id: 'trace-xyz',
      }))
    })

    it('should filter by event_type', () => {
      const traces = eventStream.queryUnifiedEvents({ event_type: 'trace' })
      expect(traces.length).toBe(2)
      expect(traces.every((e) => e.event_type === 'trace')).toBe(true)
    })

    it('should filter by namespace (ns)', () => {
      const apiEvents = eventStream.queryUnifiedEvents({ ns: 'api-service' })
      expect(apiEvents.length).toBe(3)
      expect(apiEvents.every((e) => e.ns === 'api-service')).toBe(true)
    })

    it('should filter by log_level', () => {
      const errors = eventStream.queryUnifiedEvents({ log_level: 'error' })
      expect(errors.length).toBe(1)
      expect(errors[0].event_type).toBe('log')
    })

    it('should limit results', () => {
      const limited = eventStream.queryUnifiedEvents({ limit: 2 })
      expect(limited.length).toBe(2)
    })

    it('should combine multiple filters', () => {
      const filtered = eventStream.queryUnifiedEvents({
        event_type: 'trace',
        ns: 'api-service',
      })
      expect(filtered.length).toBe(2)
    })
  })

  describe('Correlation Queries', () => {
    const traceId = 'trace-correlation-test'
    const sessionId = 'session-correlation-test'
    const correlationId = 'correlation-id-test'

    beforeEach(async () => {
      // Insert events with correlation IDs
      await eventStream.broadcastUnifiedEvent(createTestUnifiedEvent({
        id: 'evt-trace-1',
        event_type: 'trace',
        trace_id: traceId,
        span_id: 'span-1',
      }))
      await eventStream.broadcastUnifiedEvent(createTestUnifiedEvent({
        id: 'evt-trace-2',
        event_type: 'trace',
        trace_id: traceId,
        span_id: 'span-2',
        parent_id: 'span-1',
      }))
      await eventStream.broadcastUnifiedEvent(createTestUnifiedEvent({
        id: 'evt-trace-3',
        event_type: 'trace',
        trace_id: traceId,
        span_id: 'span-3',
        parent_id: 'span-2',
      }))

      // Session events
      await eventStream.broadcastUnifiedEvent(createTestUnifiedEvent({
        id: 'evt-session-1',
        event_type: 'page',
        session_id: sessionId,
      }))
      await eventStream.broadcastUnifiedEvent(createTestUnifiedEvent({
        id: 'evt-session-2',
        event_type: 'track',
        session_id: sessionId,
      }))

      // Correlation ID events
      await eventStream.broadcastUnifiedEvent(createTestUnifiedEvent({
        id: 'evt-corr-1',
        event_type: 'log',
        correlation_id: correlationId,
      }))
      await eventStream.broadcastUnifiedEvent(createTestUnifiedEvent({
        id: 'evt-corr-2',
        event_type: 'trace',
        correlation_id: correlationId,
      }))
    })

    it('should query by trace_id', () => {
      const traceEvents = eventStream.getTraceEvents(traceId)
      expect(traceEvents.length).toBe(3)
      expect(traceEvents.every((e) => e.trace_id === traceId)).toBe(true)
    })

    it('should query by session_id', () => {
      const sessionEvents = eventStream.getSessionEvents(sessionId)
      expect(sessionEvents.length).toBe(2)
      expect(sessionEvents.every((e) => e.session_id === sessionId)).toBe(true)
    })

    it('should query by correlation_id', () => {
      const correlatedEvents = eventStream.getCorrelatedEvents(correlationId)
      expect(correlatedEvents.length).toBe(2)
      expect(correlatedEvents.every((e) => e.correlation_id === correlationId)).toBe(true)
    })

    it('should return empty array for non-existent trace_id', () => {
      const events = eventStream.getTraceEvents('non-existent-trace')
      expect(events).toEqual([])
    })

    it('should return empty array for non-existent session_id', () => {
      const events = eventStream.getSessionEvents('non-existent-session')
      expect(events).toEqual([])
    })

    it('should return empty array for non-existent correlation_id', () => {
      const events = eventStream.getCorrelatedEvents('non-existent-correlation')
      expect(events).toEqual([])
    })
  })

  describe('Hot Tier Retention', () => {
    it('should delete events older than retention period', async () => {
      // Create EventStreamDO with short retention (1 second for testing)
      const shortRetentionStream = new EventStreamDO(mockState, {
        hotTierRetentionMs: 1000, // 1 second
        cleanupIntervalMs: 500,
      })

      // Insert an event
      await shortRetentionStream.broadcastUnifiedEvent(createTestUnifiedEvent({
        id: 'old-event',
        timestamp: new Date(Date.now() - 2000).toISOString(), // 2 seconds ago
      }))

      await shortRetentionStream.broadcastUnifiedEvent(createTestUnifiedEvent({
        id: 'new-event',
        timestamp: new Date().toISOString(),
      }))

      // Run cleanup
      await shortRetentionStream.runCleanup()

      const events = shortRetentionStream.getAllUnifiedEvents()
      expect(events.length).toBe(1)
      expect(events[0].id).toBe('new-event')
    })

    it('should preserve events within retention period', async () => {
      const shortRetentionStream = new EventStreamDO(mockState, {
        hotTierRetentionMs: 60000, // 1 minute
      })

      await shortRetentionStream.broadcastUnifiedEvent(createTestUnifiedEvent({
        id: 'recent-event',
        timestamp: new Date().toISOString(),
      }))

      await shortRetentionStream.runCleanup()

      const events = shortRetentionStream.getAllUnifiedEvents()
      expect(events.length).toBe(1)
    })

    it('should track event count correctly', async () => {
      expect(eventStream.getHotTierEventCount()).toBe(0)

      await eventStream.broadcastUnifiedEvent(createTestUnifiedEvent())
      expect(eventStream.getHotTierEventCount()).toBe(1)

      await eventStream.broadcastUnifiedEvent(createTestUnifiedEvent())
      expect(eventStream.getHotTierEventCount()).toBe(2)

      await eventStream.broadcastUnifiedEvent(createTestUnifiedEvent())
      expect(eventStream.getHotTierEventCount()).toBe(3)
    })
  })

  describe('HTTP Endpoints', () => {
    it('should handle /broadcast with UnifiedEvent format', async () => {
      const request = new Request('https://stream.example.com/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'unified-evt-1',
          event_type: 'trace',
          event_name: 'http.request',
          ns: 'api-service',
          trace_id: 'trace-http-1',
        }),
      })

      const response = await eventStream.fetch(request)
      expect(response.status).toBe(200)

      const body = await response.json() as { success: boolean; id: string; event_type: string }
      expect(body.success).toBe(true)
      expect(body.id).toBe('unified-evt-1')
      expect(body.event_type).toBe('trace')
    })

    it('should handle /broadcast with legacy BroadcastEvent format', async () => {
      const request = new Request('https://stream.example.com/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: 'orders',
          event: {
            id: 'legacy-evt-1',
            type: 'order.created',
            payload: { orderId: '123' },
          },
        }),
      })

      const response = await eventStream.fetch(request)
      expect(response.status).toBe(200)

      const body = await response.json() as { success: boolean }
      expect(body.success).toBe(true)
    })

    it('should handle /query/unified endpoint', async () => {
      // First, add some events
      await eventStream.broadcastUnifiedEvent(createTestUnifiedEvent({
        event_type: 'trace',
        ns: 'test-service',
      }))
      await eventStream.broadcastUnifiedEvent(createTestUnifiedEvent({
        event_type: 'log',
        ns: 'test-service',
      }))

      const request = new Request('https://stream.example.com/query/unified', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_type: 'trace',
        }),
      })

      const response = await eventStream.fetch(request)
      expect(response.status).toBe(200)

      const body = await response.json() as { events: StoredUnifiedEvent[]; count: number }
      expect(body.count).toBe(1)
      expect(body.events[0].event_type).toBe('trace')
    })

    it('should handle /query/trace endpoint', async () => {
      const traceId = 'trace-endpoint-test'

      await eventStream.broadcastUnifiedEvent(createTestUnifiedEvent({
        event_type: 'trace',
        trace_id: traceId,
      }))
      await eventStream.broadcastUnifiedEvent(createTestUnifiedEvent({
        event_type: 'trace',
        trace_id: traceId,
      }))

      const request = new Request(`https://stream.example.com/query/trace?trace_id=${traceId}`, {
        method: 'GET',
      })

      const response = await eventStream.fetch(request)
      expect(response.status).toBe(200)

      const body = await response.json() as { trace_id: string; events: StoredUnifiedEvent[]; count: number }
      expect(body.trace_id).toBe(traceId)
      expect(body.count).toBe(2)
    })

    it('should handle /query/trace endpoint with missing trace_id', async () => {
      const request = new Request('https://stream.example.com/query/trace', {
        method: 'GET',
      })

      const response = await eventStream.fetch(request)
      expect(response.status).toBe(400)

      const body = await response.json() as { error: string }
      expect(body.error).toBe('trace_id is required')
    })

    it('should handle /query/session endpoint', async () => {
      const sessionId = 'session-endpoint-test'

      await eventStream.broadcastUnifiedEvent(createTestUnifiedEvent({
        event_type: 'page',
        session_id: sessionId,
      }))

      const request = new Request(`https://stream.example.com/query/session?session_id=${sessionId}`, {
        method: 'GET',
      })

      const response = await eventStream.fetch(request)
      expect(response.status).toBe(200)

      const body = await response.json() as { session_id: string; events: StoredUnifiedEvent[]; count: number }
      expect(body.session_id).toBe(sessionId)
      expect(body.count).toBe(1)
    })

    it('should handle /query/session endpoint with missing session_id', async () => {
      const request = new Request('https://stream.example.com/query/session', {
        method: 'GET',
      })

      const response = await eventStream.fetch(request)
      expect(response.status).toBe(400)

      const body = await response.json() as { error: string }
      expect(body.error).toBe('session_id is required')
    })
  })

  describe('Backwards Compatibility', () => {
    it('should still work with legacy BroadcastEvent', async () => {
      const legacyEvent = {
        id: 'legacy-1',
        type: 'order.created',
        topic: 'orders',
        payload: { orderId: '123', amount: 99.99 },
        timestamp: Date.now(),
      }

      await eventStream.broadcast(legacyEvent)

      const events = eventStream.getAllUnifiedEvents()
      expect(events.length).toBe(1)
      // Legacy event should be converted to unified format
      expect(events[0].id).toBe('legacy-1')
      expect(events[0].event_type).toBe('order.created')
      expect(events[0].ns).toBe('orders')
    })

    it('should preserve legacy payload as data', async () => {
      const legacyEvent = {
        id: 'legacy-2',
        type: 'test',
        topic: 'test-topic',
        payload: { key: 'value', nested: { a: 1 } },
        timestamp: Date.now(),
      }

      await eventStream.broadcast(legacyEvent)

      const events = eventStream.getAllUnifiedEvents()
      expect(events[0].data).toBeDefined()
      const data = JSON.parse(events[0].data!)
      expect(data.key).toBe('value')
      expect(data.nested.a).toBe(1)
    })
  })
})
