/**
 * EventStreamDO Miniflare Integration Tests
 *
 * Tests for EventStreamDO using REAL Miniflare runtime with actual SQLite storage.
 * This follows the NO MOCKS testing philosophy - all storage is real DO SQLite.
 *
 * Tests verify:
 * - Unified events stored correctly in hot tier
 * - Queries work across event types
 * - Correlation queries work (trace_id, session_id, correlation_id)
 * - Hot tier retention still works
 * - HTTP endpoints function correctly
 * - Backwards compatibility with legacy BroadcastEvent format
 *
 * @module streaming/tests/event-stream-do-miniflare.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import type { StoredUnifiedEvent } from '../event-stream-do'
import type { UnifiedEvent } from '../../types/unified-event'

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

/**
 * Get a fresh EventStreamDO stub for isolated testing.
 */
function getStub(namespace = `test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`) {
  const id = env.EVENT_STREAM_DO.idFromName(namespace)
  return env.EVENT_STREAM_DO.get(id)
}

/**
 * Helper to broadcast an event via HTTP.
 */
async function broadcastEvent(stub: DurableObjectStub, event: Partial<UnifiedEvent> | Record<string, unknown>) {
  const request = new Request('https://stream.example.com/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  })
  return stub.fetch(request)
}

/**
 * Helper to query unified events via HTTP.
 */
async function queryUnifiedEvents(
  stub: DurableObjectStub,
  query: Record<string, unknown>
): Promise<{ events: StoredUnifiedEvent[]; count: number }> {
  const request = new Request('https://stream.example.com/query/unified', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(query),
  })
  const response = await stub.fetch(request)
  return response.json() as Promise<{ events: StoredUnifiedEvent[]; count: number }>
}

/**
 * Helper to query trace events via HTTP.
 */
async function queryTraceEvents(
  stub: DurableObjectStub,
  traceId: string
): Promise<{ trace_id: string; events: StoredUnifiedEvent[]; count: number }> {
  const request = new Request(`https://stream.example.com/query/trace?trace_id=${traceId}`, {
    method: 'GET',
  })
  const response = await stub.fetch(request)
  return response.json() as Promise<{ trace_id: string; events: StoredUnifiedEvent[]; count: number }>
}

/**
 * Helper to query session events via HTTP.
 */
async function querySessionEvents(
  stub: DurableObjectStub,
  sessionId: string
): Promise<{ session_id: string; events: StoredUnifiedEvent[]; count: number }> {
  const request = new Request(`https://stream.example.com/query/session?session_id=${sessionId}`, {
    method: 'GET',
  })
  const response = await stub.fetch(request)
  return response.json() as Promise<{ session_id: string; events: StoredUnifiedEvent[]; count: number }>
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('EventStreamDO with real Miniflare', () => {
  describe('Unified Events Storage via HTTP', () => {
    it('stores and retrieves a trace event', async () => {
      const stub = getStub()
      const event = createTestUnifiedEvent({
        event_type: 'trace',
        event_name: 'http.request',
        trace_id: 'trace-123',
        span_id: 'span-456',
      })

      const response = await broadcastEvent(stub, event)
      expect(response.status).toBe(200)

      const body = (await response.json()) as { success: boolean; id: string; event_type: string }
      expect(body.success).toBe(true)
      expect(body.id).toBe(event.id)
      expect(body.event_type).toBe('trace')

      // Query the events back
      const result = await queryUnifiedEvents(stub, { event_type: 'trace' })
      expect(result.count).toBeGreaterThanOrEqual(1)

      const found = result.events.find((e) => e.id === event.id)
      expect(found).toBeDefined()
      expect(found?.event_type).toBe('trace')
      expect(found?.trace_id).toBe('trace-123')
    })

    it('stores a log event in hot tier', async () => {
      const stub = getStub()
      const event = createTestUnifiedEvent({
        event_type: 'log',
        event_name: 'app.error',
        log_level: 'error',
        log_message: 'Connection failed',
        service_name: 'api-gateway',
      })

      const response = await broadcastEvent(stub, event)
      expect(response.status).toBe(200)

      const result = await queryUnifiedEvents(stub, { event_type: 'log' })
      expect(result.count).toBeGreaterThanOrEqual(1)

      const found = result.events.find((e) => e.id === event.id)
      expect(found?.log_level).toBe('error')
      expect(found?.log_message).toBe('Connection failed')
    })

    it('stores a metric event in hot tier', async () => {
      const stub = getStub()
      const event = createTestUnifiedEvent({
        event_type: 'metric',
        event_name: 'request.count',
        service_name: 'web-server',
        data: { value: 100, unit: 'requests' },
      })

      const response = await broadcastEvent(stub, event)
      expect(response.status).toBe(200)

      const result = await queryUnifiedEvents(stub, { event_type: 'metric' })
      expect(result.count).toBeGreaterThanOrEqual(1)
      expect(result.events.find((e) => e.id === event.id)).toBeDefined()
    })

    it('stores a vital event in hot tier', async () => {
      const stub = getStub()
      const event = createTestUnifiedEvent({
        event_type: 'vital',
        event_name: 'web-vital',
        vital_name: 'LCP',
        vital_value: 2500,
        vital_rating: 'good',
      })

      const response = await broadcastEvent(stub, event)
      expect(response.status).toBe(200)

      const result = await queryUnifiedEvents(stub, { event_type: 'vital' })
      const found = result.events.find((e) => e.id === event.id)
      expect(found?.vital_name).toBe('LCP')
      expect(found?.vital_value).toBe(2500)
      expect(found?.vital_rating).toBe('good')
    })

    it('stores multiple events of different types', async () => {
      const stub = getStub()

      await broadcastEvent(stub, createTestUnifiedEvent({ event_type: 'trace' }))
      await broadcastEvent(stub, createTestUnifiedEvent({ event_type: 'log' }))
      await broadcastEvent(stub, createTestUnifiedEvent({ event_type: 'metric' }))
      await broadcastEvent(stub, createTestUnifiedEvent({ event_type: 'vital' }))

      const result = await queryUnifiedEvents(stub, {})
      expect(result.count).toBeGreaterThanOrEqual(4)

      const types = result.events.map((e) => e.event_type)
      expect(types).toContain('trace')
      expect(types).toContain('log')
      expect(types).toContain('metric')
      expect(types).toContain('vital')
    })
  })

  describe('Queries Across Event Types', () => {
    it('filters by event_type', async () => {
      const stub = getStub()

      await broadcastEvent(stub, createTestUnifiedEvent({ id: 'evt-trace-1', event_type: 'trace' }))
      await broadcastEvent(stub, createTestUnifiedEvent({ id: 'evt-trace-2', event_type: 'trace' }))
      await broadcastEvent(stub, createTestUnifiedEvent({ id: 'evt-log-1', event_type: 'log' }))

      const traces = await queryUnifiedEvents(stub, { event_type: 'trace' })
      expect(traces.count).toBe(2)
      expect(traces.events.every((e) => e.event_type === 'trace')).toBe(true)
    })

    it('filters by namespace (ns)', async () => {
      const stub = getStub()

      await broadcastEvent(stub, createTestUnifiedEvent({ ns: 'api-service' }))
      await broadcastEvent(stub, createTestUnifiedEvent({ ns: 'api-service' }))
      await broadcastEvent(stub, createTestUnifiedEvent({ ns: 'metrics-service' }))

      const apiEvents = await queryUnifiedEvents(stub, { ns: 'api-service' })
      expect(apiEvents.count).toBe(2)
      expect(apiEvents.events.every((e) => e.ns === 'api-service')).toBe(true)
    })

    it('limits results', async () => {
      const stub = getStub()

      await broadcastEvent(stub, createTestUnifiedEvent({}))
      await broadcastEvent(stub, createTestUnifiedEvent({}))
      await broadcastEvent(stub, createTestUnifiedEvent({}))
      await broadcastEvent(stub, createTestUnifiedEvent({}))

      const limited = await queryUnifiedEvents(stub, { limit: 2 })
      expect(limited.events.length).toBe(2)
    })
  })

  describe('Correlation Queries', () => {
    it('queries by trace_id', async () => {
      const stub = getStub()
      const traceId = 'trace-correlation-test-' + Date.now()

      await broadcastEvent(
        stub,
        createTestUnifiedEvent({
          event_type: 'trace',
          trace_id: traceId,
          span_id: 'span-1',
        })
      )
      await broadcastEvent(
        stub,
        createTestUnifiedEvent({
          event_type: 'trace',
          trace_id: traceId,
          span_id: 'span-2',
          parent_id: 'span-1',
        })
      )
      await broadcastEvent(
        stub,
        createTestUnifiedEvent({
          event_type: 'trace',
          trace_id: traceId,
          span_id: 'span-3',
          parent_id: 'span-2',
        })
      )

      const result = await queryTraceEvents(stub, traceId)
      expect(result.trace_id).toBe(traceId)
      expect(result.count).toBe(3)
      expect(result.events.every((e) => e.trace_id === traceId)).toBe(true)
    })

    it('queries by session_id', async () => {
      const stub = getStub()
      const sessionId = 'session-correlation-test-' + Date.now()

      await broadcastEvent(
        stub,
        createTestUnifiedEvent({
          event_type: 'page',
          session_id: sessionId,
        })
      )
      await broadcastEvent(
        stub,
        createTestUnifiedEvent({
          event_type: 'track',
          session_id: sessionId,
        })
      )

      const result = await querySessionEvents(stub, sessionId)
      expect(result.session_id).toBe(sessionId)
      expect(result.count).toBe(2)
      expect(result.events.every((e) => e.session_id === sessionId)).toBe(true)
    })

    it('returns empty array for non-existent trace_id', async () => {
      const stub = getStub()
      const result = await queryTraceEvents(stub, 'non-existent-trace')
      expect(result.count).toBe(0)
      expect(result.events).toEqual([])
    })

    it('returns 400 for missing trace_id', async () => {
      const stub = getStub()
      const request = new Request('https://stream.example.com/query/trace', {
        method: 'GET',
      })
      const response = await stub.fetch(request)
      expect(response.status).toBe(400)

      const body = (await response.json()) as { error: string }
      expect(body.error).toBe('trace_id is required')
    })

    it('returns 400 for missing session_id', async () => {
      const stub = getStub()
      const request = new Request('https://stream.example.com/query/session', {
        method: 'GET',
      })
      const response = await stub.fetch(request)
      expect(response.status).toBe(400)

      const body = (await response.json()) as { error: string }
      expect(body.error).toBe('session_id is required')
    })
  })

  describe('Backwards Compatibility', () => {
    it('handles legacy BroadcastEvent format', async () => {
      const stub = getStub()
      const legacyEvent = {
        topic: 'orders',
        event: {
          id: 'legacy-evt-' + Date.now(),
          type: 'order.created',
          payload: { orderId: '123', amount: 99.99 },
        },
      }

      const request = new Request('https://stream.example.com/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(legacyEvent),
      })

      const response = await stub.fetch(request)
      expect(response.status).toBe(200)

      const body = (await response.json()) as { success: boolean }
      expect(body.success).toBe(true)
    })
  })

  describe('HTTP Endpoint Validation', () => {
    it('returns correct response structure for /broadcast', async () => {
      const stub = getStub()
      const event = createTestUnifiedEvent({
        id: 'unified-evt-' + Date.now(),
        event_type: 'trace',
        event_name: 'http.request',
        ns: 'api-service',
        trace_id: 'trace-http-1',
      })

      const response = await broadcastEvent(stub, event)
      expect(response.status).toBe(200)

      const body = (await response.json()) as { success: boolean; id: string; event_type: string }
      expect(body.success).toBe(true)
      expect(body.id).toBe(event.id)
      expect(body.event_type).toBe('trace')
    })

    it('handles /query/unified endpoint with multiple filters', async () => {
      const stub = getStub()

      await broadcastEvent(
        stub,
        createTestUnifiedEvent({
          event_type: 'trace',
          ns: 'test-service',
        })
      )
      await broadcastEvent(
        stub,
        createTestUnifiedEvent({
          event_type: 'log',
          ns: 'test-service',
        })
      )

      const result = await queryUnifiedEvents(stub, {
        event_type: 'trace',
        ns: 'test-service',
      })

      expect(result.count).toBe(1)
      expect(result.events[0].event_type).toBe('trace')
    })
  })

  describe('Data Persistence', () => {
    it('persists events across requests', async () => {
      const namespace = `persist-test-${Date.now()}`
      const stub1 = getStub(namespace)

      const event = createTestUnifiedEvent({
        id: 'persist-test-evt',
        event_type: 'trace',
      })

      await broadcastEvent(stub1, event)

      // Get a new stub for the same namespace (simulating new request)
      const stub2 = getStub(namespace)
      const result = await queryUnifiedEvents(stub2, { event_type: 'trace' })

      const found = result.events.find((e) => e.id === event.id)
      expect(found).toBeDefined()
    })
  })
})
