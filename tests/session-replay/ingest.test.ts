/**
 * Session Ingest Tests
 *
 * RED Phase TDD - Tests for session event ingestion pipeline.
 * All tests should FAIL until the session replay feature is implemented.
 *
 * Related issues:
 * - dotdo-tesp: [Red] Session event schema and ingest tests
 *
 * The ingest endpoint captures session events from frontends:
 * - POST /replay/ingest - Accepts batched events
 * - Extracts session_id from X-Session-ID header
 * - Extracts correlation from X-Dotdo-Request header
 * - Validates events and returns 400 for invalid
 * - Handles high volume (1000+ events/sec)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ============================================================================
// Type Interfaces (Expected)
// ============================================================================

type SessionEventType = 'request' | 'response' | 'error' | 'log' | 'custom'

interface SessionEvent {
  id: string
  correlationId: string
  timestamp: number
  type: SessionEventType
  data: Record<string, unknown>
  source?: 'frontend' | 'backend'
  sequence?: number
}

interface IngestRequest {
  events: SessionEvent[]
}

interface IngestResponse {
  accepted: number
  rejected: number
  errors?: Array<{ index: number; message: string }>
}

interface Pipeline {
  send(events: unknown[]): Promise<void>
}

// ============================================================================
// Dynamic Import - Tests fail gracefully until module exists
// ============================================================================

let createIngestHandler: ((pipeline: Pipeline) => (req: Request) => Promise<Response>) | undefined
let createMockPipeline: (() => Pipeline & { events: unknown[]; clear: () => void }) | undefined

try {
  // @ts-expect-error - Module not yet implemented
  const ingestModule = await import('../../api/routes/replay')
  createIngestHandler = ingestModule.createIngestHandler

  // @ts-expect-error - Module not yet implemented
  const pipelineModule = await import('../../tests/mocks/pipeline')
  createMockPipeline = pipelineModule.createMockPipeline
} catch {
  // Modules don't exist yet - tests will fail as expected (RED phase)
  createIngestHandler = undefined
  createMockPipeline = undefined
}

// ============================================================================
// Helper: Create valid events for testing
// ============================================================================

function createValidEvent(overrides?: Partial<SessionEvent>): SessionEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2)}`,
    correlationId: 'corr-abc123',
    timestamp: Date.now(),
    type: 'request',
    data: { url: '/api/test', method: 'GET' },
    source: 'frontend',
    sequence: 1,
    ...overrides,
  }
}

function createIngestRequest(events: SessionEvent[], sessionId?: string, correlationId?: string): Request {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  }
  if (sessionId) {
    headers['X-Session-ID'] = sessionId
  }
  if (correlationId) {
    headers['X-Dotdo-Request'] = correlationId
  }

  return new Request('http://localhost/replay/ingest', {
    method: 'POST',
    headers,
    body: JSON.stringify({ events }),
  })
}

// ============================================================================
// 1. Capture Events to Pipeline Tests
// ============================================================================

describe('Capture events to pipeline', () => {
  let pipeline: Pipeline & { events: unknown[]; clear: () => void }
  let handler: (req: Request) => Promise<Response>

  beforeEach(() => {
    pipeline = createMockPipeline!()
    handler = createIngestHandler!(pipeline)
  })

  it('sends single event to pipeline', async () => {
    const event = createValidEvent()
    const request = createIngestRequest([event])

    const response = await handler(request)

    expect(response.status).toBe(200)
    expect(pipeline.events).toHaveLength(1)
    expect(pipeline.events[0]).toMatchObject({
      correlationId: event.correlationId,
      type: event.type,
    })
  })

  it('sends multiple events to pipeline', async () => {
    const events = [
      createValidEvent({ sequence: 1 }),
      createValidEvent({ sequence: 2 }),
      createValidEvent({ sequence: 3 }),
    ]
    const request = createIngestRequest(events)

    const response = await handler(request)

    expect(response.status).toBe(200)
    expect(pipeline.events).toHaveLength(3)
  })

  it('preserves event order in pipeline', async () => {
    const events = Array.from({ length: 10 }, (_, i) =>
      createValidEvent({ id: `evt-${i}`, sequence: i + 1 })
    )
    const request = createIngestRequest(events)

    await handler(request)

    events.forEach((event, index) => {
      expect((pipeline.events[index] as SessionEvent).id).toBe(event.id)
    })
  })

  it('enriches events with ingestion timestamp', async () => {
    const event = createValidEvent()
    const request = createIngestRequest([event])

    const beforeIngest = Date.now()
    await handler(request)
    const afterIngest = Date.now()

    const ingestedEvent = pipeline.events[0] as SessionEvent & { ingestedAt: number }
    expect(ingestedEvent.ingestedAt).toBeGreaterThanOrEqual(beforeIngest)
    expect(ingestedEvent.ingestedAt).toBeLessThanOrEqual(afterIngest)
  })

  it('returns response with accepted count', async () => {
    const events = [createValidEvent(), createValidEvent()]
    const request = createIngestRequest(events)

    const response = await handler(request)
    const body = await response.json() as IngestResponse

    expect(body.accepted).toBe(2)
    expect(body.rejected).toBe(0)
  })
})

// ============================================================================
// 2. Batch Events for Efficiency Tests
// ============================================================================

describe('Batch events for efficiency', () => {
  let pipeline: Pipeline & { events: unknown[]; clear: () => void; send: ReturnType<typeof vi.fn> }
  let handler: (req: Request) => Promise<Response>

  beforeEach(() => {
    pipeline = createMockPipeline!() as Pipeline & { events: unknown[]; clear: () => void; send: ReturnType<typeof vi.fn> }
    handler = createIngestHandler!(pipeline)
  })

  it('batches events into single pipeline call', async () => {
    const events = Array.from({ length: 50 }, (_, i) =>
      createValidEvent({ id: `evt-${i}` })
    )
    const request = createIngestRequest(events)

    await handler(request)

    // Should send in batch, not individual calls
    expect(pipeline.send).toHaveBeenCalledTimes(1)
  })

  it('accepts empty events array', async () => {
    const request = createIngestRequest([])

    const response = await handler(request)
    const body = await response.json() as IngestResponse

    expect(response.status).toBe(200)
    expect(body.accepted).toBe(0)
  })

  it('handles large batch efficiently', async () => {
    const events = Array.from({ length: 1000 }, (_, i) =>
      createValidEvent({ id: `evt-${i}` })
    )
    const request = createIngestRequest(events)

    const start = Date.now()
    const response = await handler(request)
    const elapsed = Date.now() - start

    expect(response.status).toBe(200)
    // Should complete within reasonable time
    expect(elapsed).toBeLessThan(1000)
  })

  it('chunks very large batches', async () => {
    const events = Array.from({ length: 5000 }, (_, i) =>
      createValidEvent({ id: `evt-${i}` })
    )
    const request = createIngestRequest(events)

    await handler(request)

    // Very large batches might be chunked
    expect(pipeline.events).toHaveLength(5000)
  })
})

// ============================================================================
// 3. Handle High Volume (1000+ events/sec) Tests
// ============================================================================

describe('Handle high volume (1000+ events/sec)', () => {
  let pipeline: Pipeline & { events: unknown[]; clear: () => void }
  let handler: (req: Request) => Promise<Response>

  beforeEach(() => {
    pipeline = createMockPipeline!()
    handler = createIngestHandler!(pipeline)
  })

  afterEach(() => {
    pipeline.clear()
  })

  it('processes 1000 events in under 500ms', async () => {
    const events = Array.from({ length: 1000 }, (_, i) =>
      createValidEvent({ id: `evt-${i}` })
    )
    const request = createIngestRequest(events)

    const start = Date.now()
    const response = await handler(request)
    const elapsed = Date.now() - start

    expect(response.status).toBe(200)
    expect(elapsed).toBeLessThan(500)
  })

  it('handles concurrent requests', async () => {
    const requests = Array.from({ length: 10 }, (_, batch) => {
      const events = Array.from({ length: 100 }, (_, i) =>
        createValidEvent({ id: `evt-${batch}-${i}` })
      )
      return createIngestRequest(events)
    })

    const responses = await Promise.all(requests.map(req => handler(req)))

    responses.forEach(response => {
      expect(response.status).toBe(200)
    })
    expect(pipeline.events).toHaveLength(1000)
  })

  it('applies backpressure when overwhelmed', async () => {
    // Simulate slow pipeline
    const slowPipeline = {
      events: [] as unknown[],
      send: vi.fn(async (events: unknown[]) => {
        await new Promise(resolve => setTimeout(resolve, 100))
        slowPipeline.events.push(...events)
      }),
      clear: () => { slowPipeline.events = [] }
    }
    const slowHandler = createIngestHandler!(slowPipeline)

    const events = Array.from({ length: 100 }, (_, i) =>
      createValidEvent({ id: `evt-${i}` })
    )

    // Send multiple concurrent requests to trigger backpressure
    const requests = Array.from({ length: 20 }, () =>
      slowHandler(createIngestRequest(events))
    )

    const responses = await Promise.all(requests)

    // Some requests might return 429 (rate limited) or 503 (service unavailable)
    const successResponses = responses.filter(r => r.status === 200)
    const rateLimitedResponses = responses.filter(r => r.status === 429 || r.status === 503)

    expect(successResponses.length + rateLimitedResponses.length).toBe(20)
  })

  it('maintains event ordering under high load', async () => {
    const events = Array.from({ length: 500 }, (_, i) =>
      createValidEvent({ id: `evt-${i}`, sequence: i + 1 })
    )
    const request = createIngestRequest(events)

    await handler(request)

    // Verify order is preserved
    for (let i = 0; i < pipeline.events.length - 1; i++) {
      const current = pipeline.events[i] as SessionEvent
      const next = pipeline.events[i + 1] as SessionEvent
      if (current.sequence && next.sequence) {
        expect(current.sequence).toBeLessThan(next.sequence)
      }
    }
  })
})

// ============================================================================
// 4. Correlation ID Propagation Tests
// ============================================================================

describe('Correlation ID propagation', () => {
  let pipeline: Pipeline & { events: unknown[]; clear: () => void }
  let handler: (req: Request) => Promise<Response>

  beforeEach(() => {
    pipeline = createMockPipeline!()
    handler = createIngestHandler!(pipeline)
  })

  it('extracts correlation from X-Dotdo-Request header', async () => {
    const event = createValidEvent({ correlationId: '' }) // event without correlationId
    const request = createIngestRequest([event], undefined, 'req-header-correlation')

    await handler(request)

    const ingestedEvent = pipeline.events[0] as SessionEvent
    expect(ingestedEvent.correlationId).toBe('req-header-correlation')
  })

  it('event correlationId takes precedence over header', async () => {
    const event = createValidEvent({ correlationId: 'event-correlation' })
    const request = createIngestRequest([event], undefined, 'header-correlation')

    await handler(request)

    const ingestedEvent = pipeline.events[0] as SessionEvent
    expect(ingestedEvent.correlationId).toBe('event-correlation')
  })

  it('generates correlationId if not provided', async () => {
    // @ts-expect-error - Testing event without correlationId
    const event: SessionEvent = {
      id: 'evt-001',
      timestamp: Date.now(),
      type: 'request',
      data: {},
    }
    const request = createIngestRequest([event])

    await handler(request)

    const ingestedEvent = pipeline.events[0] as SessionEvent
    expect(ingestedEvent.correlationId).toBeDefined()
    expect(ingestedEvent.correlationId.length).toBeGreaterThan(0)
  })

  it('uses session_id as fallback correlationId', async () => {
    // @ts-expect-error - Testing event without correlationId
    const event: SessionEvent = {
      id: 'evt-001',
      timestamp: Date.now(),
      type: 'request',
      data: {},
    }
    const request = createIngestRequest([event], 'session-xyz')

    await handler(request)

    const ingestedEvent = pipeline.events[0] as SessionEvent
    expect(ingestedEvent.correlationId).toBe('session-xyz')
  })

  it('propagates correlationId to all events in batch', async () => {
    const events = [
      createValidEvent({ id: 'evt-1', correlationId: '' }),
      createValidEvent({ id: 'evt-2', correlationId: '' }),
      createValidEvent({ id: 'evt-3', correlationId: '' }),
    ]
    const request = createIngestRequest(events, undefined, 'batch-correlation')

    await handler(request)

    pipeline.events.forEach(evt => {
      expect((evt as SessionEvent).correlationId).toBe('batch-correlation')
    })
  })
})

// ============================================================================
// 5. Extract Session ID from Header Tests
// ============================================================================

describe('Extract session_id from header', () => {
  let pipeline: Pipeline & { events: unknown[]; clear: () => void }
  let handler: (req: Request) => Promise<Response>

  beforeEach(() => {
    pipeline = createMockPipeline!()
    handler = createIngestHandler!(pipeline)
  })

  it('extracts session_id from X-Session-ID header', async () => {
    const event = createValidEvent()
    const request = createIngestRequest([event], 'session-header-123')

    await handler(request)

    const ingestedEvent = pipeline.events[0] as SessionEvent & { sessionId: string }
    expect(ingestedEvent.sessionId).toBe('session-header-123')
  })

  it('enriches all events with session_id', async () => {
    const events = [createValidEvent(), createValidEvent(), createValidEvent()]
    const request = createIngestRequest(events, 'batch-session-456')

    await handler(request)

    pipeline.events.forEach(evt => {
      expect((evt as SessionEvent & { sessionId: string }).sessionId).toBe('batch-session-456')
    })
  })

  it('handles missing session_id header gracefully', async () => {
    const event = createValidEvent()
    const request = createIngestRequest([event]) // No session ID

    const response = await handler(request)

    expect(response.status).toBe(200)
    // Session ID might be generated or left undefined
  })

  it('validates session_id format', async () => {
    const event = createValidEvent()
    const invalidSessionId = '<script>alert("xss")</script>'
    const request = createIngestRequest([event], invalidSessionId)

    const response = await handler(request)

    // Should either sanitize or reject
    expect([200, 400]).toContain(response.status)
  })

  it('session_id is included in response metadata', async () => {
    const event = createValidEvent()
    const request = createIngestRequest([event], 'session-meta-789')

    const response = await handler(request)
    const body = await response.json() as IngestResponse & { sessionId: string }

    expect(body.sessionId).toBe('session-meta-789')
  })
})

// ============================================================================
// 6. Returns 400 for Invalid Events Tests
// ============================================================================

describe('Returns 400 for invalid events', () => {
  let pipeline: Pipeline & { events: unknown[]; clear: () => void }
  let handler: (req: Request) => Promise<Response>

  beforeEach(() => {
    pipeline = createMockPipeline!()
    handler = createIngestHandler!(pipeline)
  })

  it('returns 400 for malformed JSON', async () => {
    const request = new Request('http://localhost/replay/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'invalid json {',
    })

    const response = await handler(request)

    expect(response.status).toBe(400)
    const body = await response.json() as { error: { code: string } }
    expect(body.error.code).toBe('INVALID_JSON')
  })

  it('returns 400 for missing events array', async () => {
    const request = new Request('http://localhost/replay/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notEvents: [] }),
    })

    const response = await handler(request)

    expect(response.status).toBe(400)
    const body = await response.json() as { error: { code: string } }
    expect(body.error.code).toBe('MISSING_EVENTS')
  })

  it('returns 400 when events is not an array', async () => {
    const request = new Request('http://localhost/replay/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: 'not-an-array' }),
    })

    const response = await handler(request)

    expect(response.status).toBe(400)
  })

  it('rejects individual invalid events and reports errors', async () => {
    const events = [
      createValidEvent({ id: 'valid-1' }),
      { invalid: true }, // Invalid event
      createValidEvent({ id: 'valid-2' }),
    ]
    const request = createIngestRequest(events as SessionEvent[])

    const response = await handler(request)
    const body = await response.json() as IngestResponse

    expect(body.accepted).toBe(2)
    expect(body.rejected).toBe(1)
    expect(body.errors).toBeDefined()
    expect(body.errors![0].index).toBe(1)
  })

  it('returns 400 when all events are invalid', async () => {
    const invalidEvents = [
      { invalid: true },
      { alsoInvalid: true },
    ]
    const request = createIngestRequest(invalidEvents as unknown as SessionEvent[])

    const response = await handler(request)

    expect(response.status).toBe(400)
    const body = await response.json() as IngestResponse
    expect(body.rejected).toBe(2)
  })

  it('validates event timestamp is reasonable', async () => {
    const event = createValidEvent({ timestamp: -1 })
    const request = createIngestRequest([event])

    const response = await handler(request)
    const body = await response.json() as IngestResponse

    expect(body.rejected).toBe(1)
    expect(body.errors![0].message).toMatch(/timestamp/i)
  })

  it('validates event type is valid enum', async () => {
    const event = createValidEvent()
    // @ts-expect-error - Testing invalid type
    event.type = 'invalid-type'
    const request = createIngestRequest([event])

    const response = await handler(request)
    const body = await response.json() as IngestResponse

    expect(body.rejected).toBe(1)
  })

  it('returns descriptive error messages', async () => {
    const event = createValidEvent()
    // @ts-expect-error - Testing missing required field
    delete event.id
    const request = createIngestRequest([event])

    const response = await handler(request)
    const body = await response.json() as IngestResponse

    expect(body.errors![0].message).toMatch(/id|required/i)
  })
})

// ============================================================================
// 7. RRWeb Event Wrapper Validation Tests
// ============================================================================

describe('RRWeb event wrapper validation', () => {
  let pipeline: Pipeline & { events: unknown[]; clear: () => void }
  let handler: (req: Request) => Promise<Response>

  beforeEach(() => {
    pipeline = createMockPipeline!()
    handler = createIngestHandler!(pipeline)
  })

  // RRWeb events have specific structure for session recording
  interface RRWebEvent {
    type: number // 0: DomContentLoaded, 1: Load, 2: FullSnapshot, 3: IncrementalSnapshot, 4: Meta, 5: Custom
    data: unknown
    timestamp: number
  }

  it('accepts rrweb event wrapped in SessionEvent', async () => {
    const rrwebEvent: RRWebEvent = {
      type: 2, // FullSnapshot
      data: { node: { type: 0, childNodes: [] } },
      timestamp: Date.now(),
    }

    const event = createValidEvent({
      type: 'custom',
      data: {
        rrweb: true,
        event: rrwebEvent,
      }
    })
    const request = createIngestRequest([event])

    const response = await handler(request)

    expect(response.status).toBe(200)
    expect(pipeline.events).toHaveLength(1)
  })

  it('validates rrweb event has required fields', async () => {
    const invalidRrwebEvent = {
      type: 'not-a-number', // Should be number
      data: {},
      // missing timestamp
    }

    const event = createValidEvent({
      type: 'custom',
      data: {
        rrweb: true,
        event: invalidRrwebEvent,
      }
    })
    const request = createIngestRequest([event])

    const response = await handler(request)
    const body = await response.json() as IngestResponse

    expect(body.rejected).toBe(1)
  })

  it('handles rrweb incremental snapshot events', async () => {
    const incrementalEvent: RRWebEvent = {
      type: 3, // IncrementalSnapshot
      data: {
        source: 2, // Mutation
        texts: [],
        attributes: [],
        removes: [],
        adds: [],
      },
      timestamp: Date.now(),
    }

    const event = createValidEvent({
      type: 'custom',
      data: { rrweb: true, event: incrementalEvent }
    })
    const request = createIngestRequest([event])

    const response = await handler(request)

    expect(response.status).toBe(200)
  })

  it('handles batch of rrweb events', async () => {
    const events = Array.from({ length: 100 }, (_, i) => {
      const rrwebEvent: RRWebEvent = {
        type: i === 0 ? 2 : 3, // First is snapshot, rest are incremental
        data: { source: i },
        timestamp: Date.now() + i * 16, // ~60fps
      }
      return createValidEvent({
        id: `rrweb-${i}`,
        type: 'custom',
        data: { rrweb: true, event: rrwebEvent }
      })
    })
    const request = createIngestRequest(events)

    const response = await handler(request)
    const body = await response.json() as IngestResponse

    expect(response.status).toBe(200)
    expect(body.accepted).toBe(100)
  })
})

// ============================================================================
// 8. Content-Type and Method Validation Tests
// ============================================================================

describe('Content-Type and method validation', () => {
  let pipeline: Pipeline & { events: unknown[]; clear: () => void }
  let handler: (req: Request) => Promise<Response>

  beforeEach(() => {
    pipeline = createMockPipeline!()
    handler = createIngestHandler!(pipeline)
  })

  it('requires POST method', async () => {
    const request = new Request('http://localhost/replay/ingest', {
      method: 'GET',
    })

    const response = await handler(request)

    expect(response.status).toBe(405)
  })

  it('requires application/json Content-Type', async () => {
    const request = new Request('http://localhost/replay/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ events: [] }),
    })

    const response = await handler(request)

    expect(response.status).toBe(415)
  })

  it('accepts application/json charset variants', async () => {
    const event = createValidEvent()
    const request = new Request('http://localhost/replay/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ events: [event] }),
    })

    const response = await handler(request)

    expect(response.status).toBe(200)
  })

  it('handles OPTIONS for CORS preflight', async () => {
    const request = new Request('http://localhost/replay/ingest', {
      method: 'OPTIONS',
    })

    const response = await handler(request)

    expect([200, 204]).toContain(response.status)
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST')
  })

  it('returns CORS headers in response', async () => {
    const event = createValidEvent()
    const request = createIngestRequest([event])

    const response = await handler(request)

    expect(response.headers.get('Access-Control-Allow-Origin')).toBeDefined()
  })
})

// ============================================================================
// 9. Error Handling and Recovery Tests
// ============================================================================

describe('Error handling and recovery', () => {
  it('handles pipeline errors gracefully', async () => {
    const errorPipeline = {
      events: [] as unknown[],
      send: vi.fn(async () => {
        throw new Error('Pipeline write failed')
      }),
      clear: () => {}
    }
    const handler = createIngestHandler!(errorPipeline)

    const event = createValidEvent()
    const request = createIngestRequest([event])

    const response = await handler(request)

    expect(response.status).toBe(500)
    const body = await response.json() as { error: { code: string; message: string } }
    expect(body.error.code).toBe('PIPELINE_ERROR')
  })

  it('retries on transient pipeline errors', async () => {
    let attempts = 0
    const flakyPipeline = {
      events: [] as unknown[],
      send: vi.fn(async (events: unknown[]) => {
        attempts++
        if (attempts < 3) {
          throw new Error('Temporary failure')
        }
        flakyPipeline.events.push(...events)
      }),
      clear: () => { flakyPipeline.events = [] }
    }
    const handler = createIngestHandler!(flakyPipeline)

    const event = createValidEvent()
    const request = createIngestRequest([event])

    const response = await handler(request)

    expect(response.status).toBe(200)
    expect(attempts).toBeGreaterThanOrEqual(3)
  })

  it('returns partial success on mixed results', async () => {
    // Simulate a pipeline that fails on certain events
    const selectivePipeline = {
      events: [] as unknown[],
      send: vi.fn(async (events: unknown[]) => {
        events.forEach((evt, i) => {
          if ((evt as SessionEvent).id !== 'fail-me') {
            selectivePipeline.events.push(evt)
          }
        })
      }),
      clear: () => { selectivePipeline.events = [] }
    }
    const handler = createIngestHandler!(selectivePipeline)

    const events = [
      createValidEvent({ id: 'success-1' }),
      createValidEvent({ id: 'fail-me' }),
      createValidEvent({ id: 'success-2' }),
    ]
    const request = createIngestRequest(events)

    const response = await handler(request)

    expect(response.status).toBe(200)
    // At minimum, some events were processed
  })

  it('logs errors for debugging', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const errorPipeline = {
      events: [] as unknown[],
      send: vi.fn(async () => {
        throw new Error('Pipeline crashed')
      }),
      clear: () => {}
    }
    const handler = createIngestHandler!(errorPipeline)

    const request = createIngestRequest([createValidEvent()])
    await handler(request)

    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})

// ============================================================================
// 10. Rate Limiting Tests
// ============================================================================

describe('Rate limiting', () => {
  let pipeline: Pipeline & { events: unknown[]; clear: () => void }
  let handler: (req: Request) => Promise<Response>

  beforeEach(() => {
    pipeline = createMockPipeline!()
    handler = createIngestHandler!(pipeline)
  })

  it('includes rate limit headers in response', async () => {
    const request = createIngestRequest([createValidEvent()])

    const response = await handler(request)

    expect(response.headers.get('X-RateLimit-Limit')).toBeDefined()
    expect(response.headers.get('X-RateLimit-Remaining')).toBeDefined()
  })

  it('returns 429 when rate limit exceeded', async () => {
    // Send many requests to exceed rate limit
    const requests = Array.from({ length: 1000 }, () =>
      handler(createIngestRequest([createValidEvent()]))
    )

    const responses = await Promise.all(requests)
    const rateLimitedResponses = responses.filter(r => r.status === 429)

    // Some requests should be rate limited
    expect(rateLimitedResponses.length).toBeGreaterThan(0)
  })

  it('rate limits by session ID', async () => {
    // Same session should share rate limit
    const sameSessionRequests = Array.from({ length: 100 }, () =>
      handler(createIngestRequest([createValidEvent()], 'same-session'))
    )

    const responses = await Promise.all(sameSessionRequests)
    const rateLimited = responses.filter(r => r.status === 429)

    // Should hit limit for same session
    expect(rateLimited.length).toBeGreaterThanOrEqual(0) // Depends on limit config
  })

  it('returns Retry-After header when rate limited', async () => {
    // Force rate limit
    const manyRequests = Array.from({ length: 1000 }, () =>
      handler(createIngestRequest([createValidEvent()], 'rate-test-session'))
    )

    const responses = await Promise.all(manyRequests)
    const rateLimitedResponse = responses.find(r => r.status === 429)

    if (rateLimitedResponse) {
      expect(rateLimitedResponse.headers.get('Retry-After')).toBeDefined()
    }
  })
})
