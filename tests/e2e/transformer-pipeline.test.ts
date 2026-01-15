/**
 * Transformer Pipeline E2E Tests (RED Phase)
 *
 * End-to-end tests for the full transformer pipeline:
 * 1. Raw OTEL span input
 * 2. Transform via registry
 * 3. Store in hot tier (EventStreamDO SQLite)
 * 4. Query back and verify
 *
 * Uses REAL Miniflare runtime with actual SQLite storage.
 * NO MOCKS - tests complete flow from ingestion to query.
 *
 * @see do-qm44 - RED phase transformer pipeline E2E tests
 * @see do-gj4k - GREEN phase implementation
 * @module tests/e2e/transformer-pipeline.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import {
  transformOtelSpan,
  transformOtelLog,
  transformOtelMetric,
  registry,
  SpanKind,
  StatusCode,
  type OtlpSpan,
  type OtlpResource,
  type OtlpLogRecord,
  type OtlpMetric,
} from '../../db/streams/transformers'
import type { StoredUnifiedEvent } from '../../streaming/event-stream-do'
import type { UnifiedEvent } from '../../types/unified-event'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Generate a unique ID for test isolation
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

/**
 * Get a fresh EventStreamDO stub with isolated storage
 */
function getStub(namespace = `transformer-pipeline-${generateId()}`) {
  const id = env.EVENT_STREAM_DO.idFromName(namespace)
  return env.EVENT_STREAM_DO.get(id)
}

/**
 * JSON replacer that handles BigInt serialization
 */
function bigIntReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString()
  }
  return value
}

/**
 * Broadcast an event to the hot tier via HTTP
 * Handles BigInt serialization (timestamp_ns field)
 */
async function broadcastEvent(
  stub: DurableObjectStub,
  event: Partial<UnifiedEvent>
): Promise<Response> {
  const request = new Request('https://stream.example.com/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event, bigIntReplacer),
  })
  return stub.fetch(request)
}

/**
 * Query unified events from the hot tier
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
 * Query trace events by trace_id
 */
async function queryTraceEvents(
  stub: DurableObjectStub,
  traceId: string
): Promise<{ trace_id: string; events: StoredUnifiedEvent[]; count: number }> {
  const request = new Request(
    `https://stream.example.com/query/trace?trace_id=${traceId}`,
    { method: 'GET' }
  )
  const response = await stub.fetch(request)
  return response.json() as Promise<{
    trace_id: string
    events: StoredUnifiedEvent[]
    count: number
  }>
}

// ============================================================================
// OTEL SPAN FIXTURES
// ============================================================================

/**
 * Create a minimal OTLP span for testing
 */
function createOtlpSpan(overrides: Partial<OtlpSpan> = {}): OtlpSpan {
  const now = Date.now()
  const startNano = BigInt(now) * BigInt(1_000_000)
  const endNano = startNano + BigInt(100_000_000) // 100ms later

  return {
    traceId: 'abcd1234abcd1234abcd1234abcd1234',
    spanId: generateId().replace(/-/g, '').slice(0, 16),
    name: 'test-operation',
    kind: SpanKind.SERVER,
    startTimeUnixNano: startNano.toString(),
    endTimeUnixNano: endNano.toString(),
    status: { code: StatusCode.OK },
    ...overrides,
  }
}

/**
 * Create an OTLP resource with service metadata
 */
function createOtlpResource(serviceName = 'test-service'): OtlpResource {
  return {
    attributes: [
      { key: 'service.name', value: { stringValue: serviceName } },
      { key: 'service.version', value: { stringValue: '1.0.0' } },
      { key: 'host.name', value: { stringValue: 'test-host' } },
    ],
  }
}

/**
 * Create an HTTP span with semantic conventions
 */
function createHttpSpan(
  traceId: string,
  method = 'GET',
  status = 200
): OtlpSpan {
  return createOtlpSpan({
    traceId,
    name: `HTTP ${method} /api/users`,
    kind: SpanKind.SERVER,
    attributes: [
      { key: 'http.method', value: { stringValue: method } },
      { key: 'http.url', value: { stringValue: 'https://api.example.com/api/users' } },
      { key: 'http.status_code', value: { intValue: status.toString() } },
      { key: 'http.host', value: { stringValue: 'api.example.com' } },
    ],
    status: {
      code: status >= 400 ? StatusCode.ERROR : StatusCode.OK,
      message: status >= 400 ? 'HTTP error' : undefined,
    },
  })
}

/**
 * Create a distributed trace with parent-child spans
 */
function createDistributedTrace(traceId: string, spanCount = 3): OtlpSpan[] {
  const spans: OtlpSpan[] = []
  let parentSpanId: string | undefined

  for (let i = 0; i < spanCount; i++) {
    const spanId = `span${i.toString().padStart(14, '0')}`
    spans.push(
      createOtlpSpan({
        traceId,
        spanId,
        parentSpanId,
        name: i === 0 ? 'root-operation' : `child-operation-${i}`,
        kind: i === 0 ? SpanKind.SERVER : SpanKind.INTERNAL,
      })
    )
    parentSpanId = spanId
  }

  return spans
}

// ============================================================================
// OTEL LOG FIXTURES
// ============================================================================

/**
 * Create an OTLP log record
 */
function createOtlpLog(
  overrides: Partial<OtlpLogRecord> = {}
): OtlpLogRecord {
  const now = Date.now()
  const timeNano = BigInt(now) * BigInt(1_000_000)

  return {
    timeUnixNano: timeNano.toString(),
    severityNumber: 17, // ERROR
    severityText: 'ERROR',
    body: { stringValue: 'Test error message' },
    ...overrides,
  } as OtlpLogRecord
}

// ============================================================================
// OTEL METRIC FIXTURES
// ============================================================================

/**
 * Create an OTLP gauge metric
 */
function createOtlpMetric(
  overrides: Partial<OtlpMetric> = {}
): OtlpMetric {
  const now = Date.now()
  const timeNano = BigInt(now) * BigInt(1_000_000)

  return {
    name: 'test.metric',
    description: 'A test metric',
    unit: 'count',
    gauge: {
      dataPoints: [
        {
          timeUnixNano: timeNano.toString(),
          asDouble: 42.0,
          attributes: [],
        },
      ],
    },
    ...overrides,
  } as OtlpMetric
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('Transformer Pipeline E2E', () => {
  describe('OTEL Span Transform → Store → Query', () => {
    it('transforms and stores a single OTEL span', async () => {
      const stub = getStub()
      const traceId = `trace-${generateId()}`

      // 1. Create raw OTEL span
      const span = createHttpSpan(traceId)
      const resource = createOtlpResource('api-service')

      // 2. Transform via registry
      const transformed = registry.transform('otel-span', span, resource)
      expect(transformed).toBeDefined()
      expect(Array.isArray(transformed)).toBe(false) // Single event

      const event = transformed as UnifiedEvent
      expect(event.trace_id).toBe(traceId.toLowerCase())

      // 3. Store in hot tier
      const response = await broadcastEvent(stub, event)
      expect(response.status).toBe(200)

      // 4. Query back by trace_id and verify
      const result = await queryTraceEvents(stub, traceId.toLowerCase())
      expect(result.count).toBe(1)

      const stored = result.events[0]
      expect(stored.event_type).toBe('trace')
      expect(stored.trace_id).toBe(traceId.toLowerCase())
      expect(stored.http_method).toBe('GET')
      expect(stored.http_status).toBe(200)
      expect(stored.service_name).toBe('api-service')
    })

    it('transforms and stores a distributed trace with multiple spans', async () => {
      const stub = getStub()
      const traceId = `trace-${generateId()}`
      const resource = createOtlpResource('distributed-service')

      // 1. Create distributed trace
      const spans = createDistributedTrace(traceId, 5)

      // 2. Transform each span via registry
      const events = spans.map((span) =>
        registry.transform('otel-span', span, resource)
      ) as UnifiedEvent[]

      // 3. Store all events in hot tier
      for (const event of events) {
        const response = await broadcastEvent(stub, event)
        expect(response.status).toBe(200)
      }

      // 4. Query back and verify
      const result = await queryTraceEvents(stub, traceId.toLowerCase())
      expect(result.count).toBe(5)

      // Verify parent-child relationships preserved
      const rootSpan = result.events.find((e) => e.parent_id === null)
      expect(rootSpan).toBeDefined()

      const childSpans = result.events.filter((e) => e.parent_id !== null)
      expect(childSpans.length).toBe(4)
    })

    it('preserves HTTP semantic conventions through the pipeline', async () => {
      const stub = getStub()
      const traceId = `trace-${generateId()}`

      const span = createOtlpSpan({
        traceId,
        name: 'HTTP POST /api/orders',
        kind: SpanKind.SERVER,
        attributes: [
          { key: 'http.method', value: { stringValue: 'POST' } },
          {
            key: 'http.url',
            value: { stringValue: 'https://api.example.com/api/orders' },
          },
          { key: 'http.status_code', value: { intValue: '201' } },
          { key: 'http.host', value: { stringValue: 'api.example.com' } },
          { key: 'http.request_content_length', value: { intValue: '256' } },
        ],
        status: { code: StatusCode.OK },
      })

      const event = transformOtelSpan(span, createOtlpResource('order-service'))
      await broadcastEvent(stub, event)

      const result = await queryUnifiedEvents(stub, { event_type: 'trace' })
      const stored = result.events.find((e) => e.trace_id === traceId.toLowerCase())

      expect(stored).toBeDefined()
      expect(stored?.http_method).toBe('POST')
      expect(stored?.http_url).toBe('https://api.example.com/api/orders')
      expect(stored?.http_status).toBe(201)
      expect(stored?.http_host).toBe('api.example.com')
    })

    it('maps span status to outcome field correctly', async () => {
      const stub = getStub()
      const traceId = `trace-${generateId()}`

      // Create an error span
      const errorSpan = createOtlpSpan({
        traceId,
        name: 'failed-operation',
        status: {
          code: StatusCode.ERROR,
          message: 'Connection timeout',
        },
      })

      const event = transformOtelSpan(errorSpan, createOtlpResource())
      await broadcastEvent(stub, event)

      const result = await queryTraceEvents(stub, traceId.toLowerCase())
      expect(result.count).toBe(1)
      expect(result.events[0].outcome).toBe('error')
      expect(result.events[0].error_message).toBe('Connection timeout')
    })

    it('calculates duration from nanosecond timestamps', async () => {
      const stub = getStub()
      const traceId = `trace-${generateId()}`

      // Create span with 250ms duration
      const now = Date.now()
      const startNano = BigInt(now) * BigInt(1_000_000)
      const endNano = startNano + BigInt(250_000_000) // 250ms

      const span = createOtlpSpan({
        traceId,
        startTimeUnixNano: startNano.toString(),
        endTimeUnixNano: endNano.toString(),
      })

      const event = transformOtelSpan(span, createOtlpResource())
      await broadcastEvent(stub, event)

      const result = await queryTraceEvents(stub, traceId.toLowerCase())
      expect(result.count).toBe(1)
      expect(result.events[0].duration_ms).toBeCloseTo(250, 0)
    })
  })

  describe('Transformer Registry Pipeline', () => {
    it('routes OTEL spans through the registry correctly', async () => {
      const stub = getStub()
      const traceId = `trace-${generateId()}`
      const span = createHttpSpan(traceId)
      const resource = createOtlpResource()

      // Use registry.transform
      const event = registry.transform('otel-span', span, resource) as UnifiedEvent

      expect(event.event_type).toBe('trace')
      expect(event.trace_id).toBe(traceId.toLowerCase())

      await broadcastEvent(stub, event)

      const result = await queryTraceEvents(stub, traceId.toLowerCase())
      expect(result.count).toBe(1)
    })

    it('routes OTEL logs through the registry correctly', async () => {
      const stub = getStub()
      const log = createOtlpLog({
        severityNumber: 17, // ERROR
        severityText: 'ERROR',
        body: { stringValue: 'Database connection failed' },
      })
      const resource = createOtlpResource('db-service')

      // Use registry.transform
      const event = registry.transform('otel-log', log, resource) as UnifiedEvent

      expect(event.event_type).toBe('log')
      expect(event.log_level).toBe('error')

      const response = await broadcastEvent(stub, event)
      expect(response.status).toBe(200)

      const result = await queryUnifiedEvents(stub, { event_type: 'log' })
      const stored = result.events.find((e) => e.log_message === 'Database connection failed')

      expect(stored).toBeDefined()
      expect(stored?.log_level).toBe('error')
      expect(stored?.service_name).toBe('db-service')
    })

    it('routes OTEL metrics through the registry correctly', async () => {
      const stub = getStub()
      const metric = createOtlpMetric({
        name: 'http.request.count',
        description: 'HTTP request counter',
        unit: '1',
        gauge: {
          dataPoints: [
            {
              timeUnixNano: (BigInt(Date.now()) * BigInt(1_000_000)).toString(),
              asDouble: 100.0,
              attributes: [
                { key: 'http.method', value: { stringValue: 'GET' } },
              ],
            },
          ],
        },
      })
      const resource = createOtlpResource('metrics-service')

      // Use registry.transform (metrics can return multiple events)
      const events = registry.transformToArray('otel-metric', metric, resource)

      expect(events.length).toBeGreaterThanOrEqual(1)
      expect(events[0].event_type).toBe('metric')

      for (const event of events) {
        await broadcastEvent(stub, event)
      }

      const result = await queryUnifiedEvents(stub, { event_type: 'metric' })
      expect(result.count).toBeGreaterThanOrEqual(1)
    })

    it('throws error for unknown transformer', () => {
      expect(() => registry.transform('unknown-transformer', {})).toThrow(
        'Unknown transformer: unknown-transformer'
      )
    })
  })

  describe('Transformer Composition', () => {
    it('handles batch transformation of multiple event types', async () => {
      const stub = getStub()
      const traceId = `trace-${generateId()}`

      // Create a mix of spans, logs, and metrics
      const resource = createOtlpResource('composite-service')

      const span = createHttpSpan(traceId)
      const log = createOtlpLog({
        traceId: traceId.toLowerCase(),
        body: { stringValue: 'Processing request' },
      })
      const metric = createOtlpMetric({ name: 'request.latency' })

      // Transform all
      const spanEvent = registry.transform('otel-span', span, resource) as UnifiedEvent
      const logEvent = registry.transform('otel-log', log, resource) as UnifiedEvent
      const metricEvents = registry.transformToArray('otel-metric', metric, resource)

      // Store all
      await broadcastEvent(stub, spanEvent)
      await broadcastEvent(stub, logEvent)
      for (const me of metricEvents) {
        await broadcastEvent(stub, me)
      }

      // Query and verify all types are stored
      const result = await queryUnifiedEvents(stub, {})
      expect(result.count).toBeGreaterThanOrEqual(3)

      const types = result.events.map((e) => e.event_type)
      expect(types).toContain('trace')
      expect(types).toContain('log')
      expect(types).toContain('metric')
    })

    it('preserves trace correlation across different event types', async () => {
      const stub = getStub()
      const traceId = `trace-${generateId()}`
      const resource = createOtlpResource('correlated-service')

      // Create span and log with same trace_id
      const span = createHttpSpan(traceId)
      const log = createOtlpLog({
        traceId: traceId.toLowerCase(),
        spanId: span.spanId.toLowerCase(),
        body: { stringValue: 'Request handled' },
      })

      const spanEvent = transformOtelSpan(span, resource)
      const logEvent = registry.transform('otel-log', log, resource) as UnifiedEvent

      await broadcastEvent(stub, spanEvent)
      await broadcastEvent(stub, logEvent)

      // Query by trace_id should return both
      const result = await queryTraceEvents(stub, traceId.toLowerCase())
      expect(result.count).toBe(2)

      const eventTypes = result.events.map((e) => e.event_type)
      expect(eventTypes).toContain('trace')
      expect(eventTypes).toContain('log')
    })

    it('chains transformers for enrichment', async () => {
      const stub = getStub()
      const traceId = `trace-${generateId()}`

      // Transform OTEL span
      const span = createHttpSpan(traceId)
      const resource = createOtlpResource('enriched-service')

      let event = transformOtelSpan(span, resource)

      // Apply additional enrichment (simulate a second transformer pass)
      // In production, this would be a custom enrichment transformer
      event = {
        ...event,
        attributes: {
          ...(event.attributes || {}),
          enriched: true,
          enrichment_version: '1.0',
        },
      }

      await broadcastEvent(stub, event)

      const result = await queryTraceEvents(stub, traceId.toLowerCase())
      expect(result.count).toBe(1)

      // Verify enrichment is preserved
      const stored = result.events[0]
      expect(stored.attributes).toBeDefined()
      const attrs = JSON.parse(stored.attributes || '{}')
      expect(attrs.enriched).toBe(true)
    })
  })

  describe('Query Filtering on Transformed Events', () => {
    it('filters transformed events by event_type', async () => {
      const stub = getStub()
      const resource = createOtlpResource('filter-test-service')

      // Store multiple event types
      const span = createHttpSpan(`trace-${generateId()}`)
      const log = createOtlpLog()

      await broadcastEvent(stub, transformOtelSpan(span, resource))
      await broadcastEvent(
        stub,
        registry.transform('otel-log', log, resource) as UnifiedEvent
      )

      // Filter by type
      const traceResult = await queryUnifiedEvents(stub, { event_type: 'trace' })
      const logResult = await queryUnifiedEvents(stub, { event_type: 'log' })

      expect(traceResult.events.every((e) => e.event_type === 'trace')).toBe(true)
      expect(logResult.events.every((e) => e.event_type === 'log')).toBe(true)
    })

    it('filters transformed events by service_name', async () => {
      const stub = getStub()

      const serviceA = createOtlpResource('service-alpha')
      const serviceB = createOtlpResource('service-beta')

      const spanA = createHttpSpan(`trace-${generateId()}`)
      const spanB = createHttpSpan(`trace-${generateId()}`)

      await broadcastEvent(stub, transformOtelSpan(spanA, serviceA))
      await broadcastEvent(stub, transformOtelSpan(spanB, serviceB))

      const alphaResult = await queryUnifiedEvents(stub, {
        service_name: 'service-alpha',
      })
      const betaResult = await queryUnifiedEvents(stub, {
        service_name: 'service-beta',
      })

      expect(alphaResult.events.every((e) => e.service_name === 'service-alpha')).toBe(
        true
      )
      expect(betaResult.events.every((e) => e.service_name === 'service-beta')).toBe(true)
    })

    it('supports combined filters on transformed events', async () => {
      const stub = getStub()
      const resource = createOtlpResource('combined-filter-service')

      // Store various events
      const traceId = `trace-${generateId()}`
      const span = createHttpSpan(traceId)
      const log = createOtlpLog({ traceId: traceId.toLowerCase() })

      await broadcastEvent(stub, transformOtelSpan(span, resource))
      await broadcastEvent(
        stub,
        registry.transform('otel-log', log, resource) as UnifiedEvent
      )

      // Combined filter: event_type + service_name
      const result = await queryUnifiedEvents(stub, {
        event_type: 'trace',
        service_name: 'combined-filter-service',
      })

      expect(result.events.every((e) => e.event_type === 'trace')).toBe(true)
      expect(
        result.events.every((e) => e.service_name === 'combined-filter-service')
      ).toBe(true)
    })

    it('returns empty results for non-matching filters', async () => {
      const stub = getStub()

      const span = createHttpSpan(`trace-${generateId()}`)
      await broadcastEvent(stub, transformOtelSpan(span, createOtlpResource('test')))

      const result = await queryUnifiedEvents(stub, {
        service_name: 'non-existent-service',
      })

      expect(result.count).toBe(0)
      expect(result.events).toEqual([])
    })
  })

  describe('Edge Cases', () => {
    it('handles spans with missing optional fields', async () => {
      const stub = getStub()
      const traceId = `trace-${generateId()}`

      // Minimal span with no optional fields
      const span: OtlpSpan = {
        traceId,
        spanId: generateId().replace(/-/g, '').slice(0, 16),
        name: 'minimal-span',
        kind: SpanKind.UNSPECIFIED,
        startTimeUnixNano: (BigInt(Date.now()) * BigInt(1_000_000)).toString(),
        endTimeUnixNano: (BigInt(Date.now()) * BigInt(1_000_000) + BigInt(1_000_000)).toString(),
        // No attributes, no status, no parent
      }

      const event = transformOtelSpan(span)
      await broadcastEvent(stub, event)

      const result = await queryTraceEvents(stub, traceId.toLowerCase())
      expect(result.count).toBe(1)
      expect(result.events[0].parent_id).toBeNull()
    })

    it('handles spans with large attribute payloads', async () => {
      const stub = getStub()
      const traceId = `trace-${generateId()}`

      // Create span with many attributes
      const attributes = []
      for (let i = 0; i < 50; i++) {
        attributes.push({
          key: `custom.attr.${i}`,
          value: { stringValue: `value-${i}-${'x'.repeat(100)}` },
        })
      }

      const span = createOtlpSpan({
        traceId,
        attributes,
      })

      const event = transformOtelSpan(span, createOtlpResource())
      await broadcastEvent(stub, event)

      const result = await queryTraceEvents(stub, traceId.toLowerCase())
      expect(result.count).toBe(1)
      expect(result.events[0].attributes).toBeDefined()
    })

    it('handles very small durations (sub-millisecond)', async () => {
      const stub = getStub()
      const traceId = `trace-${generateId()}`

      const startNano = BigInt(Date.now()) * BigInt(1_000_000)
      const endNano = startNano + BigInt(500_000) // 0.5ms

      const span = createOtlpSpan({
        traceId,
        startTimeUnixNano: startNano.toString(),
        endTimeUnixNano: endNano.toString(),
      })

      const event = transformOtelSpan(span, createOtlpResource())
      await broadcastEvent(stub, event)

      const result = await queryTraceEvents(stub, traceId.toLowerCase())
      expect(result.count).toBe(1)
      expect(result.events[0].duration_ms).toBeCloseTo(0.5, 1)
    })

    it('preserves trace_id case normalization', async () => {
      const stub = getStub()
      const upperCaseTraceId = 'ABCD1234ABCD1234ABCD1234ABCD1234'

      const span = createOtlpSpan({ traceId: upperCaseTraceId })
      const event = transformOtelSpan(span, createOtlpResource())

      await broadcastEvent(stub, event)

      // Query with lowercase
      const result = await queryTraceEvents(stub, upperCaseTraceId.toLowerCase())
      expect(result.count).toBe(1)
      expect(result.events[0].trace_id).toBe(upperCaseTraceId.toLowerCase())
    })
  })
})

describe('Transformer Registry Metadata', () => {
  it('has otel-span transformer registered', () => {
    expect(registry.has('otel-span')).toBe(true)
    const meta = registry.get('otel-span')?.meta
    expect(meta?.source).toBe('otel')
    expect(meta?.eventType).toBe('trace')
  })

  it('has otel-log transformer registered', () => {
    expect(registry.has('otel-log')).toBe(true)
    const meta = registry.get('otel-log')?.meta
    expect(meta?.source).toBe('otel')
    expect(meta?.eventType).toBe('log')
  })

  it('has otel-metric transformer registered', () => {
    expect(registry.has('otel-metric')).toBe(true)
    const meta = registry.get('otel-metric')?.meta
    expect(meta?.source).toBe('otel')
    expect(meta?.eventType).toBe('metric')
    expect(meta?.multipleOutputs).toBe(true)
  })

  it('lists all OTEL transformers by source', () => {
    const otelTransformers = registry.listBySource('otel')
    expect(otelTransformers).toContain('otel-span')
    expect(otelTransformers).toContain('otel-log')
    expect(otelTransformers).toContain('otel-metric')
  })

  it('lists transformers by event type', () => {
    const traceTransformers = registry.listByEventType('trace')
    expect(traceTransformers).toContain('otel-span')

    const logTransformers = registry.listByEventType('log')
    expect(logTransformers).toContain('otel-log')
  })
})
