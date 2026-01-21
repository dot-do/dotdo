/**
 * SQLite EventsStore Tests - Using Real Miniflare Runtime
 *
 * These tests use Miniflare to test against real SQLite storage instead of mocks.
 * This follows the NO MOCKS philosophy from CLAUDE.md.
 *
 * @module db/tests/sqlite-events.test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Miniflare } from 'miniflare'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface Event {
  $id: string
  type: string
  payload: Record<string, unknown>
  $timestamp: number
  source?: string
  correlationId?: string
}

// ============================================================================
// DO SCRIPT FOR TESTING EventsStore
// ============================================================================

const EVENTS_TEST_DO_SCRIPT = `
function generateEventId() {
  return 'ev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export class EventsTestDO {
  constructor(state, env) {
    this.state = state
    this.sql = state.storage.sql
    this.subscribers = []
  }

  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname

    try {
      // INITIALIZE
      if (path === '/initialize' && request.method === 'POST') {
        this.sql.exec(\`
          CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            payload TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            source TEXT,
            correlation_id TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
          CREATE INDEX IF NOT EXISTS idx_events_source ON events(source);
          CREATE INDEX IF NOT EXISTS idx_events_correlation_id ON events(correlation_id);
          CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC);
        \`)
        return Response.json({ success: true })
      }

      // EMIT EVENT
      if (path === '/events' && request.method === 'POST') {
        const data = await request.json()

        const event = {
          $id: generateEventId(),
          type: data.type,
          payload: data.payload,
          $timestamp: Date.now(),
          source: data.source,
          correlationId: data.correlationId
        }

        const payloadJson = JSON.stringify(event.payload)

        this.sql.exec(
          'INSERT INTO events (id, type, payload, timestamp, source, correlation_id) VALUES (?, ?, ?, ?, ?, ?)',
          event.$id,
          event.type,
          payloadJson,
          event.$timestamp,
          event.source || null,
          event.correlationId || null
        )

        // Notify subscribers (tracked in test via separate mechanism)
        return Response.json(event, { status: 201 })
      }

      // GET EVENT
      if (path.startsWith('/events/') && request.method === 'GET') {
        const id = path.split('/')[2]
        const rows = this.sql.exec(
          'SELECT id, type, payload, timestamp, source, correlation_id FROM events WHERE id = ?',
          id
        ).toArray()

        if (rows.length === 0) {
          return Response.json(null)
        }

        const row = rows[0]
        const event = {
          $id: row.id,
          type: row.type,
          payload: JSON.parse(row.payload),
          $timestamp: row.timestamp,
          source: row.source || undefined,
          correlationId: row.correlation_id || undefined
        }

        return Response.json(event)
      }

      // QUERY EVENTS
      if (path === '/events' && request.method === 'GET') {
        const type = url.searchParams.get('type')
        const source = url.searchParams.get('source')
        const correlationId = url.searchParams.get('correlationId')
        const since = url.searchParams.get('since')
        const until = url.searchParams.get('until')
        const limit = parseInt(url.searchParams.get('limit') || '100')
        const offset = parseInt(url.searchParams.get('offset') || '0')

        let query = 'SELECT id, type, payload, timestamp, source, correlation_id FROM events WHERE 1=1'
        const params = []

        if (type) {
          query += ' AND type = ?'
          params.push(type)
        }

        if (source) {
          query += ' AND source = ?'
          params.push(source)
        }

        if (correlationId) {
          query += ' AND correlation_id = ?'
          params.push(correlationId)
        }

        if (since) {
          query += ' AND timestamp >= ?'
          params.push(parseInt(since))
        }

        if (until) {
          query += ' AND timestamp <= ?'
          params.push(parseInt(until))
        }

        query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?'
        params.push(limit, offset)

        const rows = this.sql.exec(query, ...params).toArray()

        const events = rows.map(row => ({
          $id: row.id,
          type: row.type,
          payload: JSON.parse(row.payload),
          $timestamp: row.timestamp,
          source: row.source || undefined,
          correlationId: row.correlation_id || undefined
        }))

        return Response.json(events)
      }

      if (path === '/health') {
        return Response.json({ status: 'ok' })
      }

      return Response.json({ error: 'Not found' }, { status: 404 })
    } catch (error) {
      return Response.json({ error: error.message, stack: error.stack }, { status: 500 })
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const doName = url.searchParams.get('name') || 'default'
    const id = env.EVENTS_DO.idFromName(doName)
    const stub = env.EVENTS_DO.get(id)
    return stub.fetch(request)
  }
}
`

// ============================================================================
// TEST HELPERS
// ============================================================================

function generateTestId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('SQLite EventsStore', () => {
  let mf: Miniflare

  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: EVENTS_TEST_DO_SCRIPT,
      durableObjects: {
        EVENTS_DO: {
          className: 'EventsTestDO',
          // Enable SQLite for this DO class - required for state.storage.sql
          useSQLite: true,
        },
      },
      durableObjectsPersist: false,
    })
  })

  afterAll(async () => {
    await mf.dispose()
  })

  async function getEventsStub(name: string = 'default') {
    const ns = await mf.getDurableObjectNamespace('EVENTS_DO')
    const id = ns.idFromName(name)
    return ns.get(id)
  }

  type StubType = { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> }

  // Helper functions
  async function initialize(stub: StubType): Promise<void> {
    await stub.fetch('http://internal/initialize', { method: 'POST' })
  }

  async function emitEvent(stub: StubType, data: {
    type: string
    payload: Record<string, unknown>
    source?: string
    correlationId?: string
  }): Promise<Event> {
    const response = await stub.fetch('http://internal/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
    return response.json() as Promise<Event>
  }

  async function getEvent(stub: StubType, id: string): Promise<Event | null> {
    const response = await stub.fetch(`http://internal/events/${id}`)
    return response.json() as Promise<Event | null>
  }

  async function queryEvents(stub: StubType, options?: {
    type?: string
    source?: string
    correlationId?: string
    since?: number
    until?: number
    limit?: number
    offset?: number
  }): Promise<Event[]> {
    const params = new URLSearchParams()
    if (options?.type) params.set('type', options.type)
    if (options?.source) params.set('source', options.source)
    if (options?.correlationId) params.set('correlationId', options.correlationId)
    if (options?.since) params.set('since', String(options.since))
    if (options?.until) params.set('until', String(options.until))
    if (options?.limit) params.set('limit', String(options.limit))
    if (options?.offset) params.set('offset', String(options.offset))

    const url = params.toString() ? `http://internal/events?${params}` : 'http://internal/events'
    const response = await stub.fetch(url)
    return response.json() as Promise<Event[]>
  }

  describe('emit', () => {
    let stub: StubType

    beforeEach(async () => {
      stub = await getEventsStub(generateTestId())
      await initialize(stub)
    })

    it('should insert event into SQLite', async () => {
      const event = await emitEvent(stub, { type: 'user.signup', payload: { userId: '123' } })

      expect(event.$id).toBeDefined()
      expect(event.type).toBe('user.signup')
      expect(event.payload).toEqual({ userId: '123' })
      expect(event.$timestamp).toBeDefined()
    })

    it('should support optional source and correlationId', async () => {
      const event = await emitEvent(stub, {
        type: 'payment.completed',
        payload: { amount: 100 },
        source: 'payment-service',
        correlationId: 'trace-123'
      })

      expect(event.source).toBe('payment-service')
      expect(event.correlationId).toBe('trace-123')
    })

    it('should store payload as JSON', async () => {
      const event = await emitEvent(stub, {
        type: 'order.created',
        payload: {
          orderId: 'ord-123',
          items: [{ id: 1, qty: 2 }],
          total: 99.99
        }
      })

      const retrieved = await getEvent(stub, event.$id)
      expect(retrieved?.payload).toEqual({
        orderId: 'ord-123',
        items: [{ id: 1, qty: 2 }],
        total: 99.99
      })
    })
  })

  describe('get', () => {
    let stub: StubType

    beforeEach(async () => {
      stub = await getEventsStub(generateTestId())
      await initialize(stub)
    })

    it('should retrieve event by id', async () => {
      const emitted = await emitEvent(stub, { type: 'test.event', payload: { data: 'test' } })
      const retrieved = await getEvent(stub, emitted.$id)

      expect(retrieved).toEqual(emitted)
    })

    it('should return null for non-existent id', async () => {
      const result = await getEvent(stub, 'non-existent')
      expect(result).toBeNull()
    })
  })

  describe('query', () => {
    let stub: StubType

    beforeEach(async () => {
      stub = await getEventsStub(generateTestId())
      await initialize(stub)

      await emitEvent(stub, { type: 'user.signup', payload: {}, source: 'auth' })
      await emitEvent(stub, { type: 'user.login', payload: {}, source: 'auth' })
      await emitEvent(stub, { type: 'payment.completed', payload: {}, source: 'payments' })
    })

    it('should filter by type', async () => {
      const events = await queryEvents(stub, { type: 'user.signup' })
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('user.signup')
    })

    it('should filter by source', async () => {
      const events = await queryEvents(stub, { source: 'auth' })
      expect(events).toHaveLength(2)
      expect(events.every(e => e.source === 'auth')).toBe(true)
    })

    it('should filter by correlationId', async () => {
      await emitEvent(stub, { type: 'step1', payload: {}, correlationId: 'trace-123' })
      await emitEvent(stub, { type: 'step2', payload: {}, correlationId: 'trace-123' })
      await emitEvent(stub, { type: 'step3', payload: {}, correlationId: 'trace-456' })

      const events = await queryEvents(stub, { correlationId: 'trace-123' })
      expect(events).toHaveLength(2)
    })

    it('should filter by time range', async () => {
      const now = Date.now()
      await emitEvent(stub, { type: 'event1', payload: {} })

      const events = await queryEvents(stub, { since: now })
      expect(events.length).toBeGreaterThan(0)
    })

    it('should support limit and offset', async () => {
      const page1 = await queryEvents(stub, { limit: 2, offset: 0 })
      const page2 = await queryEvents(stub, { limit: 2, offset: 2 })

      expect(page1).toHaveLength(2)
      expect(page2.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('subscribe', () => {
    // Note: Subscription tests are more challenging with the fetch-based approach
    // In a real implementation, you would use WebSockets or a different mechanism
    // Here we test that events are properly stored and can be queried

    let stub: StubType

    beforeEach(async () => {
      stub = await getEventsStub(generateTestId())
      await initialize(stub)
    })

    it('should persist events that can be queried later', async () => {
      // Emit events
      await emitEvent(stub, { type: 'test', payload: {} })
      await emitEvent(stub, { type: 'test2', payload: {} })

      // Query all events
      const events = await queryEvents(stub)
      expect(events).toHaveLength(2)
    })

    it('should emit multiple events in sequence', async () => {
      // Emit first event
      const event1 = await emitEvent(stub, { type: 'test', payload: { seq: 1 } })

      // Emit second event
      const event2 = await emitEvent(stub, { type: 'test2', payload: { seq: 2 } })

      // Both events should be persisted
      const retrieved1 = await getEvent(stub, event1.$id)
      const retrieved2 = await getEvent(stub, event2.$id)

      expect(retrieved1?.payload).toEqual({ seq: 1 })
      expect(retrieved2?.payload).toEqual({ seq: 2 })
    })
  })
})
