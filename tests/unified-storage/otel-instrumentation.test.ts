/**
 * OpenTelemetry Instrumentation Tests - RED Phase
 *
 * Tests for OpenTelemetry (OTEL) tracing integration with unified storage.
 * These tests verify that storage operations produce proper OTEL spans.
 *
 * Test Coverage:
 * 1. Spans created for write operations (create, update, delete)
 * 2. Spans created for read operations (get, list, query)
 * 3. Spans propagate across DO boundaries via context
 * 4. Span attributes include entity_type, operation, namespace
 * 5. Error spans include error.type, error.message
 * 6. Trace context passed through Pipeline events
 * 7. Parent-child span relationships correct for nested operations
 * 8. Span naming follows semantic conventions (e.g., "unified-storage write")
 *
 * NOTE: These tests are designed to FAIL because OpenTelemetry instrumentation
 * does not exist yet. This is the TDD RED phase.
 *
 * @see /objects/unified-storage/otel-tracer.ts (to be created in GREEN phase)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Import from non-existent module - this will cause tests to fail
import {
  OtelTracer,
  createUnifiedStorageTracer,
  type TraceContext,
  type Span,
  type SpanOptions,
  type TracerConfig,
  type SpanExporter,
} from '../../objects/unified-storage/otel-tracer'

// Import existing types for integration
import type { Thing, DomainEvent } from '../../objects/unified-storage/cold-start-recovery'
import type { EmittedEvent } from '../../objects/unified-storage/pipeline-emitter'

// ============================================================================
// MOCK SPAN EXPORTER
// ============================================================================

interface CollectedSpan {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  kind: 'internal' | 'client' | 'server' | 'producer' | 'consumer'
  startTimeMs: number
  endTimeMs?: number
  status: 'ok' | 'error' | 'unset'
  attributes: Record<string, string | number | boolean>
  events: Array<{ name: string; timestamp: number; attributes?: Record<string, unknown> }>
}

function createMockExporter() {
  const spans: CollectedSpan[] = []

  const exporter: SpanExporter = {
    export: vi.fn(async (batch: CollectedSpan[]) => {
      spans.push(...batch)
    }),
    shutdown: vi.fn(async () => {}),
  }

  return {
    exporter,
    spans,
    clear: () => {
      spans.length = 0
      ;(exporter.export as ReturnType<typeof vi.fn>).mockClear()
    },
    getSpan: (name: string) => spans.find((s) => s.name === name),
    getSpansByTraceId: (traceId: string) => spans.filter((s) => s.traceId === traceId),
    getChildSpans: (parentSpanId: string) => spans.filter((s) => s.parentSpanId === parentSpanId),
  }
}

type MockExporter = ReturnType<typeof createMockExporter>

// ============================================================================
// MOCK UNIFIED STORE WITH TRACING
// ============================================================================

function createMockTracedStore(tracer: OtelTracer) {
  const things = new Map<string, Thing>()

  return {
    tracer,
    things,

    async create(data: Partial<Thing>): Promise<Thing> {
      return tracer.traced('unified-storage create', async (span) => {
        const id = `thing_${crypto.randomUUID()}`
        const now = Date.now()

        const thing: Thing = {
          $id: id,
          $type: data.$type ?? 'Unknown',
          $version: 1,
          $createdAt: now,
          $updatedAt: now,
          ...data,
        }

        span.setAttribute('entity_type', thing.$type)
        span.setAttribute('entity_id', id)
        span.setAttribute('operation', 'create')

        things.set(id, thing)
        return thing
      })
    },

    async get(id: string): Promise<Thing | null> {
      return tracer.traced('unified-storage get', async (span) => {
        span.setAttribute('entity_id', id)
        span.setAttribute('operation', 'get')

        const thing = things.get(id) ?? null
        if (thing) {
          span.setAttribute('entity_type', thing.$type)
        }
        return thing
      })
    },

    async update(id: string, data: Partial<Thing>): Promise<Thing> {
      return tracer.traced('unified-storage update', async (span) => {
        span.setAttribute('entity_id', id)
        span.setAttribute('operation', 'update')

        const existing = things.get(id)
        if (!existing) {
          span.setStatus('error')
          span.setAttribute('error.type', 'NotFoundError')
          span.setAttribute('error.message', `Thing ${id} not found`)
          throw new Error(`Thing ${id} not found`)
        }

        const updated: Thing = {
          ...existing,
          ...data,
          $version: (existing.$version ?? 0) + 1,
          $updatedAt: Date.now(),
        }

        span.setAttribute('entity_type', updated.$type)

        things.set(id, updated)
        return updated
      })
    },

    async delete(id: string): Promise<boolean> {
      return tracer.traced('unified-storage delete', async (span) => {
        span.setAttribute('entity_id', id)
        span.setAttribute('operation', 'delete')

        const existing = things.get(id)
        if (existing) {
          span.setAttribute('entity_type', existing.$type)
        }

        return things.delete(id)
      })
    },

    async list(type?: string): Promise<Thing[]> {
      return tracer.traced('unified-storage list', async (span) => {
        span.setAttribute('operation', 'list')
        if (type) {
          span.setAttribute('filter.type', type)
        }

        const results = Array.from(things.values()).filter((t) => !type || t.$type === type)
        span.setAttribute('result_count', results.length)
        return results
      })
    },

    async query(predicate: (t: Thing) => boolean): Promise<Thing[]> {
      return tracer.traced('unified-storage query', async (span) => {
        span.setAttribute('operation', 'query')

        const results = Array.from(things.values()).filter(predicate)
        span.setAttribute('result_count', results.length)
        return results
      })
    },
  }
}

// ============================================================================
// SPAN CREATION TESTS - WRITE OPERATIONS
// ============================================================================

describe('OTEL Instrumentation - Write Operation Spans', () => {
  let mockExporter: MockExporter
  let tracer: OtelTracer

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))
    mockExporter = createMockExporter()
    tracer = createUnifiedStorageTracer({
      serviceName: 'unified-storage',
      namespace: 'test-ns',
      exporter: mockExporter.exporter,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('create operations', () => {
    it('should create span for create operation', async () => {
      const store = createMockTracedStore(tracer)

      await store.create({ $type: 'Customer', name: 'Alice' })

      // Flush spans
      await tracer.flush()

      expect(mockExporter.spans.length).toBe(1)
      expect(mockExporter.spans[0].name).toBe('unified-storage create')
    })

    it('should include entity_type attribute in create span', async () => {
      const store = createMockTracedStore(tracer)

      await store.create({ $type: 'Customer', name: 'Alice' })
      await tracer.flush()

      const span = mockExporter.getSpan('unified-storage create')
      expect(span?.attributes['entity_type']).toBe('Customer')
    })

    it('should include operation attribute in create span', async () => {
      const store = createMockTracedStore(tracer)

      await store.create({ $type: 'Customer', name: 'Alice' })
      await tracer.flush()

      const span = mockExporter.getSpan('unified-storage create')
      expect(span?.attributes['operation']).toBe('create')
    })

    it('should include namespace attribute in create span', async () => {
      const store = createMockTracedStore(tracer)

      await store.create({ $type: 'Customer', name: 'Alice' })
      await tracer.flush()

      const span = mockExporter.getSpan('unified-storage create')
      expect(span?.attributes['namespace']).toBe('test-ns')
    })

    it('should include entity_id attribute in create span', async () => {
      const store = createMockTracedStore(tracer)

      const thing = await store.create({ $type: 'Customer', name: 'Alice' })
      await tracer.flush()

      const span = mockExporter.getSpan('unified-storage create')
      expect(span?.attributes['entity_id']).toBe(thing.$id)
    })

    it('should mark create span as successful', async () => {
      const store = createMockTracedStore(tracer)

      await store.create({ $type: 'Customer', name: 'Alice' })
      await tracer.flush()

      const span = mockExporter.getSpan('unified-storage create')
      expect(span?.status).toBe('ok')
    })
  })

  describe('update operations', () => {
    it('should create span for update operation', async () => {
      const store = createMockTracedStore(tracer)

      const thing = await store.create({ $type: 'Customer', name: 'Alice' })
      mockExporter.clear()

      await store.update(thing.$id, { name: 'Alice Updated' })
      await tracer.flush()

      expect(mockExporter.spans.length).toBe(1)
      expect(mockExporter.spans[0].name).toBe('unified-storage update')
    })

    it('should include entity_type attribute in update span', async () => {
      const store = createMockTracedStore(tracer)

      const thing = await store.create({ $type: 'Customer', name: 'Alice' })
      mockExporter.clear()

      await store.update(thing.$id, { name: 'Alice Updated' })
      await tracer.flush()

      const span = mockExporter.getSpan('unified-storage update')
      expect(span?.attributes['entity_type']).toBe('Customer')
    })

    it('should include operation attribute in update span', async () => {
      const store = createMockTracedStore(tracer)

      const thing = await store.create({ $type: 'Customer', name: 'Alice' })
      mockExporter.clear()

      await store.update(thing.$id, { name: 'Alice Updated' })
      await tracer.flush()

      const span = mockExporter.getSpan('unified-storage update')
      expect(span?.attributes['operation']).toBe('update')
    })
  })

  describe('delete operations', () => {
    it('should create span for delete operation', async () => {
      const store = createMockTracedStore(tracer)

      const thing = await store.create({ $type: 'Customer', name: 'Alice' })
      mockExporter.clear()

      await store.delete(thing.$id)
      await tracer.flush()

      expect(mockExporter.spans.length).toBe(1)
      expect(mockExporter.spans[0].name).toBe('unified-storage delete')
    })

    it('should include entity_type attribute in delete span', async () => {
      const store = createMockTracedStore(tracer)

      const thing = await store.create({ $type: 'Customer', name: 'Alice' })
      mockExporter.clear()

      await store.delete(thing.$id)
      await tracer.flush()

      const span = mockExporter.getSpan('unified-storage delete')
      expect(span?.attributes['entity_type']).toBe('Customer')
    })

    it('should include operation attribute in delete span', async () => {
      const store = createMockTracedStore(tracer)

      const thing = await store.create({ $type: 'Customer', name: 'Alice' })
      mockExporter.clear()

      await store.delete(thing.$id)
      await tracer.flush()

      const span = mockExporter.getSpan('unified-storage delete')
      expect(span?.attributes['operation']).toBe('delete')
    })
  })
})

// ============================================================================
// SPAN CREATION TESTS - READ OPERATIONS
// ============================================================================

describe('OTEL Instrumentation - Read Operation Spans', () => {
  let mockExporter: MockExporter
  let tracer: OtelTracer

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))
    mockExporter = createMockExporter()
    tracer = createUnifiedStorageTracer({
      serviceName: 'unified-storage',
      namespace: 'test-ns',
      exporter: mockExporter.exporter,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('get operations', () => {
    it('should create span for get operation', async () => {
      const store = createMockTracedStore(tracer)

      const thing = await store.create({ $type: 'Customer', name: 'Alice' })
      mockExporter.clear()

      await store.get(thing.$id)
      await tracer.flush()

      expect(mockExporter.spans.length).toBe(1)
      expect(mockExporter.spans[0].name).toBe('unified-storage get')
    })

    it('should include entity_id attribute in get span', async () => {
      const store = createMockTracedStore(tracer)

      const thing = await store.create({ $type: 'Customer', name: 'Alice' })
      mockExporter.clear()

      await store.get(thing.$id)
      await tracer.flush()

      const span = mockExporter.getSpan('unified-storage get')
      expect(span?.attributes['entity_id']).toBe(thing.$id)
    })

    it('should include operation attribute in get span', async () => {
      const store = createMockTracedStore(tracer)

      const thing = await store.create({ $type: 'Customer', name: 'Alice' })
      mockExporter.clear()

      await store.get(thing.$id)
      await tracer.flush()

      const span = mockExporter.getSpan('unified-storage get')
      expect(span?.attributes['operation']).toBe('get')
    })

    it('should include entity_type attribute when thing exists', async () => {
      const store = createMockTracedStore(tracer)

      const thing = await store.create({ $type: 'Customer', name: 'Alice' })
      mockExporter.clear()

      await store.get(thing.$id)
      await tracer.flush()

      const span = mockExporter.getSpan('unified-storage get')
      expect(span?.attributes['entity_type']).toBe('Customer')
    })
  })

  describe('list operations', () => {
    it('should create span for list operation', async () => {
      const store = createMockTracedStore(tracer)
      mockExporter.clear()

      await store.list()
      await tracer.flush()

      expect(mockExporter.spans.length).toBe(1)
      expect(mockExporter.spans[0].name).toBe('unified-storage list')
    })

    it('should include operation attribute in list span', async () => {
      const store = createMockTracedStore(tracer)
      mockExporter.clear()

      await store.list()
      await tracer.flush()

      const span = mockExporter.getSpan('unified-storage list')
      expect(span?.attributes['operation']).toBe('list')
    })

    it('should include result_count attribute in list span', async () => {
      const store = createMockTracedStore(tracer)

      await store.create({ $type: 'Customer', name: 'Alice' })
      await store.create({ $type: 'Customer', name: 'Bob' })
      mockExporter.clear()

      await store.list()
      await tracer.flush()

      const span = mockExporter.getSpan('unified-storage list')
      expect(span?.attributes['result_count']).toBe(2)
    })

    it('should include filter.type attribute when filtering by type', async () => {
      const store = createMockTracedStore(tracer)

      await store.create({ $type: 'Customer', name: 'Alice' })
      mockExporter.clear()

      await store.list('Customer')
      await tracer.flush()

      const span = mockExporter.getSpan('unified-storage list')
      expect(span?.attributes['filter.type']).toBe('Customer')
    })
  })

  describe('query operations', () => {
    it('should create span for query operation', async () => {
      const store = createMockTracedStore(tracer)
      mockExporter.clear()

      await store.query(() => true)
      await tracer.flush()

      expect(mockExporter.spans.length).toBe(1)
      expect(mockExporter.spans[0].name).toBe('unified-storage query')
    })

    it('should include operation attribute in query span', async () => {
      const store = createMockTracedStore(tracer)
      mockExporter.clear()

      await store.query(() => true)
      await tracer.flush()

      const span = mockExporter.getSpan('unified-storage query')
      expect(span?.attributes['operation']).toBe('query')
    })

    it('should include result_count attribute in query span', async () => {
      const store = createMockTracedStore(tracer)

      await store.create({ $type: 'Customer', name: 'Alice' })
      await store.create({ $type: 'Order', name: 'Order 1' })
      mockExporter.clear()

      await store.query((t) => t.$type === 'Customer')
      await tracer.flush()

      const span = mockExporter.getSpan('unified-storage query')
      expect(span?.attributes['result_count']).toBe(1)
    })
  })
})

// ============================================================================
// ERROR SPAN TESTS
// ============================================================================

describe('OTEL Instrumentation - Error Spans', () => {
  let mockExporter: MockExporter
  let tracer: OtelTracer

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))
    mockExporter = createMockExporter()
    tracer = createUnifiedStorageTracer({
      serviceName: 'unified-storage',
      namespace: 'test-ns',
      exporter: mockExporter.exporter,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should include error.type attribute on error', async () => {
    const store = createMockTracedStore(tracer)

    try {
      await store.update('non-existent-id', { name: 'Updated' })
    } catch {
      // Expected error
    }

    await tracer.flush()

    const span = mockExporter.getSpan('unified-storage update')
    expect(span?.attributes['error.type']).toBe('NotFoundError')
  })

  it('should include error.message attribute on error', async () => {
    const store = createMockTracedStore(tracer)

    try {
      await store.update('non-existent-id', { name: 'Updated' })
    } catch {
      // Expected error
    }

    await tracer.flush()

    const span = mockExporter.getSpan('unified-storage update')
    expect(span?.attributes['error.message']).toContain('non-existent-id')
  })

  it('should set span status to error on failure', async () => {
    const store = createMockTracedStore(tracer)

    try {
      await store.update('non-existent-id', { name: 'Updated' })
    } catch {
      // Expected error
    }

    await tracer.flush()

    const span = mockExporter.getSpan('unified-storage update')
    expect(span?.status).toBe('error')
  })

  it('should record exception event on error', async () => {
    const store = createMockTracedStore(tracer)

    try {
      await store.update('non-existent-id', { name: 'Updated' })
    } catch {
      // Expected error
    }

    await tracer.flush()

    const span = mockExporter.getSpan('unified-storage update')
    const exceptionEvent = span?.events.find((e) => e.name === 'exception')
    expect(exceptionEvent).toBeDefined()
  })
})

// ============================================================================
// TRACE CONTEXT PROPAGATION TESTS
// ============================================================================

describe('OTEL Instrumentation - Trace Context Propagation', () => {
  let mockExporter: MockExporter
  let tracer: OtelTracer

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))
    mockExporter = createMockExporter()
    tracer = createUnifiedStorageTracer({
      serviceName: 'unified-storage',
      namespace: 'test-ns',
      exporter: mockExporter.exporter,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should propagate trace context to Pipeline events', async () => {
    // Create a span with explicit trace context
    const traceContext: TraceContext = {
      traceId: 'trace-12345',
      spanId: 'span-12345',
    }

    const span = tracer.startSpan('test-operation', { context: traceContext })

    // The span should use the provided trace context
    expect(span.traceId).toBe('trace-12345')

    span.end()
    await tracer.flush()

    const exportedSpan = mockExporter.spans[0]
    expect(exportedSpan.traceId).toBe('trace-12345')
  })

  it('should include trace context in Pipeline event metadata', async () => {
    // This tests that when emitting to Pipeline, trace context is included
    const events: EmittedEvent[] = []

    const tracedPipelineEmit = async (event: Partial<EmittedEvent>) => {
      const span = tracer.startSpan('pipeline-emit')

      const enrichedEvent: EmittedEvent = {
        ...event,
        _meta: {
          ...(event._meta ?? {}),
          traceId: span.traceId,
          spanId: span.spanId,
        },
      } as EmittedEvent

      events.push(enrichedEvent)
      span.end()
    }

    await tracedPipelineEmit({
      verb: 'thing.created',
      payload: { $id: 'test-123', $type: 'Customer' },
    })

    await tracer.flush()

    expect(events[0]._meta?.traceId).toBeDefined()
    expect(events[0]._meta?.spanId).toBeDefined()
  })

  it('should extract trace context from incoming requests', async () => {
    // Simulate incoming request with W3C traceparent header
    const traceparent = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'

    const extractedContext = tracer.extractContext({
      traceparent,
    })

    expect(extractedContext?.traceId).toBe('0af7651916cd43dd8448eb211c80319c')
    expect(extractedContext?.spanId).toBe('b7ad6b7169203331')
  })

  it('should generate W3C traceparent header for propagation', async () => {
    const span = tracer.startSpan('test-operation')
    const headers = tracer.injectContext(span)

    span.end()

    expect(headers.traceparent).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/
    )
  })
})

// ============================================================================
// CROSS-DO TRACING TESTS
// ============================================================================

describe('OTEL Instrumentation - Cross-DO Tracing', () => {
  let mockExporter: MockExporter
  let tracer: OtelTracer

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))
    mockExporter = createMockExporter()
    tracer = createUnifiedStorageTracer({
      serviceName: 'unified-storage',
      namespace: 'test-ns',
      exporter: mockExporter.exporter,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should maintain trace context across DO boundaries', async () => {
    // Simulate primary DO operation
    const primarySpan = tracer.startSpan('process-order')

    // Extract context for cross-DO call
    const propagationContext = tracer.injectContext(primarySpan)

    // Simulate secondary DO receiving the context
    const extractedContext = tracer.extractContext(propagationContext)

    // Secondary DO creates child span
    const secondarySpan = tracer.startSpan('validate-customer', {
      context: extractedContext,
    })

    secondarySpan.end()
    primarySpan.end()

    await tracer.flush()

    // Both spans should have same trace ID
    const primary = mockExporter.getSpan('process-order')
    const secondary = mockExporter.getSpan('validate-customer')

    expect(primary?.traceId).toBe(secondary?.traceId)
  })

  it('should create proper parent-child relationship', async () => {
    // Parent span
    const parentSpan = tracer.startSpan('parent-operation')

    // Child span created with parent context
    const childSpan = tracer.startSpan('child-operation', {
      parent: parentSpan,
    })

    childSpan.end()
    parentSpan.end()

    await tracer.flush()

    const parent = mockExporter.getSpan('parent-operation')
    const child = mockExporter.getSpan('child-operation')

    // Child should reference parent
    expect(child?.parentSpanId).toBe(parent?.spanId)
  })

  it('should support nested operation spans', async () => {
    // Outer operation
    const outerSpan = tracer.startSpan('outer')

    // Middle operation (child of outer)
    const middleSpan = tracer.startSpan('middle', { parent: outerSpan })

    // Inner operation (child of middle)
    const innerSpan = tracer.startSpan('inner', { parent: middleSpan })

    innerSpan.end()
    middleSpan.end()
    outerSpan.end()

    await tracer.flush()

    const outer = mockExporter.getSpan('outer')
    const middle = mockExporter.getSpan('middle')
    const inner = mockExporter.getSpan('inner')

    // Verify hierarchy
    expect(middle?.parentSpanId).toBe(outer?.spanId)
    expect(inner?.parentSpanId).toBe(middle?.spanId)

    // All should share trace ID
    expect(outer?.traceId).toBe(middle?.traceId)
    expect(middle?.traceId).toBe(inner?.traceId)
  })
})

// ============================================================================
// SPAN NAMING CONVENTION TESTS
// ============================================================================

describe('OTEL Instrumentation - Span Naming Conventions', () => {
  let mockExporter: MockExporter
  let tracer: OtelTracer

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))
    mockExporter = createMockExporter()
    tracer = createUnifiedStorageTracer({
      serviceName: 'unified-storage',
      namespace: 'test-ns',
      exporter: mockExporter.exporter,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should follow semantic conventions for write spans', async () => {
    const store = createMockTracedStore(tracer)

    await store.create({ $type: 'Customer', name: 'Alice' })
    await tracer.flush()

    const span = mockExporter.spans[0]
    // Semantic convention: "<service> <operation>"
    expect(span.name).toMatch(/^unified-storage\s+(create|write)$/)
  })

  it('should follow semantic conventions for read spans', async () => {
    const store = createMockTracedStore(tracer)

    await store.create({ $type: 'Customer', name: 'Alice' })
    mockExporter.clear()

    await store.list()
    await tracer.flush()

    const span = mockExporter.spans[0]
    // Semantic convention: "<service> <operation>"
    expect(span.name).toMatch(/^unified-storage\s+(list|read|query)$/)
  })

  it('should use lowercase span names', async () => {
    const store = createMockTracedStore(tracer)

    await store.create({ $type: 'Customer', name: 'Alice' })
    await tracer.flush()

    const span = mockExporter.spans[0]
    expect(span.name).toBe(span.name.toLowerCase())
  })

  it('should use hyphens for multi-word span names', async () => {
    const store = createMockTracedStore(tracer)

    await store.create({ $type: 'Customer', name: 'Alice' })
    await tracer.flush()

    const span = mockExporter.spans[0]
    // Should use hyphens, not underscores or spaces (except service separator)
    expect(span.name.split(' ')[0]).not.toContain('_')
  })
})

// ============================================================================
// TIMING AND DURATION TESTS
// ============================================================================

describe('OTEL Instrumentation - Span Timing', () => {
  let mockExporter: MockExporter
  let tracer: OtelTracer

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))
    mockExporter = createMockExporter()
    tracer = createUnifiedStorageTracer({
      serviceName: 'unified-storage',
      namespace: 'test-ns',
      exporter: mockExporter.exporter,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should record start time on span creation', async () => {
    const startTime = Date.now()
    const span = tracer.startSpan('test-operation')
    span.end()

    await tracer.flush()

    const exportedSpan = mockExporter.spans[0]
    expect(exportedSpan.startTimeMs).toBe(startTime)
  })

  it('should record end time on span completion', async () => {
    const span = tracer.startSpan('test-operation')

    // Advance time
    vi.advanceTimersByTime(100)

    const endTime = Date.now()
    span.end()

    await tracer.flush()

    const exportedSpan = mockExporter.spans[0]
    expect(exportedSpan.endTimeMs).toBe(endTime)
  })

  it('should calculate correct duration', async () => {
    const span = tracer.startSpan('test-operation')

    // Advance time by 50ms
    vi.advanceTimersByTime(50)

    span.end()
    await tracer.flush()

    const exportedSpan = mockExporter.spans[0]
    const duration = (exportedSpan.endTimeMs ?? 0) - exportedSpan.startTimeMs
    expect(duration).toBe(50)
  })
})

// ============================================================================
// TRACER CONFIGURATION TESTS
// ============================================================================

describe('OTEL Instrumentation - Tracer Configuration', () => {
  let mockExporter: MockExporter

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))
    mockExporter = createMockExporter()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should create tracer with service name', () => {
    const tracer = createUnifiedStorageTracer({
      serviceName: 'my-service',
      namespace: 'test-ns',
      exporter: mockExporter.exporter,
    })

    expect(tracer.serviceName).toBe('my-service')
  })

  it('should create tracer with namespace', () => {
    const tracer = createUnifiedStorageTracer({
      serviceName: 'unified-storage',
      namespace: 'custom-namespace',
      exporter: mockExporter.exporter,
    })

    expect(tracer.namespace).toBe('custom-namespace')
  })

  it('should include namespace in all spans', async () => {
    const tracer = createUnifiedStorageTracer({
      serviceName: 'unified-storage',
      namespace: 'tenant-123',
      exporter: mockExporter.exporter,
    })

    const span = tracer.startSpan('test-operation')
    span.end()

    await tracer.flush()

    expect(mockExporter.spans[0].attributes['namespace']).toBe('tenant-123')
  })

  it('should support custom span attributes via config', async () => {
    const tracer = createUnifiedStorageTracer({
      serviceName: 'unified-storage',
      namespace: 'test-ns',
      exporter: mockExporter.exporter,
      defaultAttributes: {
        'deployment.environment': 'production',
        'service.version': '1.0.0',
      },
    })

    const span = tracer.startSpan('test-operation')
    span.end()

    await tracer.flush()

    expect(mockExporter.spans[0].attributes['deployment.environment']).toBe('production')
    expect(mockExporter.spans[0].attributes['service.version']).toBe('1.0.0')
  })

  it('should support sampling configuration', () => {
    const tracer = createUnifiedStorageTracer({
      serviceName: 'unified-storage',
      namespace: 'test-ns',
      exporter: mockExporter.exporter,
      samplingRate: 0.5, // 50% sampling
    })

    expect(tracer.samplingRate).toBe(0.5)
  })
})

// ============================================================================
// BATCH EXPORT TESTS
// ============================================================================

describe('OTEL Instrumentation - Batch Export', () => {
  let mockExporter: MockExporter
  let tracer: OtelTracer

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))
    mockExporter = createMockExporter()
    tracer = createUnifiedStorageTracer({
      serviceName: 'unified-storage',
      namespace: 'test-ns',
      exporter: mockExporter.exporter,
      batchSize: 5,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should batch spans before export', async () => {
    // Create multiple spans
    for (let i = 0; i < 3; i++) {
      const span = tracer.startSpan(`operation-${i}`)
      span.end()
    }

    // Should not have exported yet (below batch size)
    expect(mockExporter.exporter.export).not.toHaveBeenCalled()

    // Force flush
    await tracer.flush()

    // Now should have exported
    expect(mockExporter.exporter.export).toHaveBeenCalled()
    expect(mockExporter.spans.length).toBe(3)
  })

  it('should auto-export when batch size reached', async () => {
    // Create spans up to batch size
    for (let i = 0; i < 5; i++) {
      const span = tracer.startSpan(`operation-${i}`)
      span.end()
    }

    // Allow async export
    await vi.advanceTimersByTimeAsync(10)

    // Should have auto-exported
    expect(mockExporter.exporter.export).toHaveBeenCalled()
    expect(mockExporter.spans.length).toBe(5)
  })

  it('should export on shutdown', async () => {
    // Create some spans (below batch size)
    for (let i = 0; i < 2; i++) {
      const span = tracer.startSpan(`operation-${i}`)
      span.end()
    }

    // Shutdown tracer
    await tracer.shutdown()

    // Should have exported remaining spans
    expect(mockExporter.exporter.export).toHaveBeenCalled()
    expect(mockExporter.spans.length).toBe(2)
  })
})

// ============================================================================
// SPAN EVENTS TESTS
// ============================================================================

describe('OTEL Instrumentation - Span Events', () => {
  let mockExporter: MockExporter
  let tracer: OtelTracer

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))
    mockExporter = createMockExporter()
    tracer = createUnifiedStorageTracer({
      serviceName: 'unified-storage',
      namespace: 'test-ns',
      exporter: mockExporter.exporter,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should support adding events to spans', async () => {
    const span = tracer.startSpan('test-operation')

    span.addEvent('checkpoint-reached', { checkpoint: 1 })
    span.addEvent('validation-complete')

    span.end()
    await tracer.flush()

    const exportedSpan = mockExporter.spans[0]
    expect(exportedSpan.events.length).toBe(2)
    expect(exportedSpan.events[0].name).toBe('checkpoint-reached')
    expect(exportedSpan.events[1].name).toBe('validation-complete')
  })

  it('should record event timestamps', async () => {
    const span = tracer.startSpan('test-operation')

    const eventTime = Date.now()
    span.addEvent('event-1')

    vi.advanceTimersByTime(50)
    const eventTime2 = Date.now()
    span.addEvent('event-2')

    span.end()
    await tracer.flush()

    const exportedSpan = mockExporter.spans[0]
    expect(exportedSpan.events[0].timestamp).toBe(eventTime)
    expect(exportedSpan.events[1].timestamp).toBe(eventTime2)
  })

  it('should support event attributes', async () => {
    const span = tracer.startSpan('test-operation')

    span.addEvent('data-processed', {
      itemCount: 100,
      duration: 50,
      success: true,
    })

    span.end()
    await tracer.flush()

    const exportedSpan = mockExporter.spans[0]
    expect(exportedSpan.events[0].attributes).toEqual({
      itemCount: 100,
      duration: 50,
      success: true,
    })
  })
})

// ============================================================================
// INTEGRATION WITH PIPELINE TESTS
// ============================================================================

describe('OTEL Instrumentation - Pipeline Integration', () => {
  let mockExporter: MockExporter
  let tracer: OtelTracer

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))
    mockExporter = createMockExporter()
    tracer = createUnifiedStorageTracer({
      serviceName: 'unified-storage',
      namespace: 'test-ns',
      exporter: mockExporter.exporter,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should enrich Pipeline events with trace context', async () => {
    const span = tracer.startSpan('create-customer')

    // Simulate creating a Pipeline event with trace context
    const pipelineEvent: Partial<DomainEvent> = {
      type: 'thing.created',
      entityId: 'customer-123',
      entityType: 'Customer',
      payload: { name: 'Alice' },
      ts: Date.now(),
    }

    // Enrich with trace context
    const enrichedEvent = tracer.enrichPipelineEvent(pipelineEvent, span)

    span.end()

    expect(enrichedEvent.traceId).toBe(span.traceId)
    expect(enrichedEvent.spanId).toBe(span.spanId)
  })

  it('should extract trace context from Pipeline events', async () => {
    // Simulate receiving a Pipeline event with trace context
    const incomingEvent: DomainEvent & { traceId?: string; spanId?: string } = {
      type: 'thing.created',
      collection: 'Thing',
      operation: 'create',
      entityId: 'customer-123',
      entityType: 'Customer',
      payload: { name: 'Alice' },
      ts: Date.now(),
      version: 1,
      actorId: 'system',
      idempotencyKey: 'key-123',
      traceId: 'incoming-trace-id',
      spanId: 'incoming-span-id',
    }

    const extractedContext = tracer.extractFromPipelineEvent(incomingEvent)

    expect(extractedContext?.traceId).toBe('incoming-trace-id')
    expect(extractedContext?.spanId).toBe('incoming-span-id')
  })

  it('should create child span when processing Pipeline event', async () => {
    // Simulate receiving a Pipeline event with trace context
    const incomingEvent = {
      type: 'thing.created',
      traceId: 'parent-trace-id',
      spanId: 'parent-span-id',
    }

    const extractedContext = tracer.extractFromPipelineEvent(incomingEvent as DomainEvent & { traceId?: string; spanId?: string })

    // Create child span for processing
    const processingSpan = tracer.startSpan('process-event', {
      context: extractedContext,
    })

    processingSpan.end()
    await tracer.flush()

    const span = mockExporter.spans[0]
    expect(span.traceId).toBe('parent-trace-id')
    expect(span.parentSpanId).toBe('parent-span-id')
  })
})
