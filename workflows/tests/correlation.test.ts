/**
 * Correlation Tracking Tests (TDD - RED Phase)
 *
 * Tests for $.correlation - distributed tracing across DO boundaries.
 *
 * API Design:
 * - $.correlation.id - Get current correlation ID
 * - $.correlation.span(name) - Create a child span for sub-operations
 * - $.correlation.context - Get full correlation context
 * - Auto-propagation through cross-DO RPC calls
 * - Integration with $.do() for durable operation tracing
 *
 * @module workflows/tests/correlation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  type CorrelationContext,
  generateCorrelationId,
  generateRequestId,
  createChildSpan,
  createDotdoRequestHeader,
  parseDotdoRequestHeader,
} from '../context/correlation'

// ============================================================================
// TYPE DEFINITIONS - What the $.correlation API should look like
// ============================================================================

/**
 * Span represents a unit of work within a trace
 */
export interface Span {
  /** Unique span identifier */
  id: string
  /** Name of the operation */
  name: string
  /** Parent span ID (if nested) */
  parentId?: string
  /** Correlation ID (trace ID) */
  correlationId: string
  /** Start time */
  startedAt: Date
  /** End time (set when span ends) */
  endedAt?: Date
  /** Duration in milliseconds (computed when ended) */
  durationMs?: number
  /** Status of the span */
  status: 'active' | 'completed' | 'failed'
  /** Attributes/tags for the span */
  attributes: Record<string, string | number | boolean>
  /** Events within the span */
  events: SpanEvent[]
}

/**
 * Event within a span (for logging key moments)
 */
export interface SpanEvent {
  /** Event name */
  name: string
  /** Timestamp */
  timestamp: Date
  /** Event attributes */
  attributes?: Record<string, string | number | boolean>
}

/**
 * Correlation capability interface on WorkflowContext
 */
export interface CorrelationCapability {
  /** Get the current correlation ID */
  readonly id: string

  /** Get the current span ID */
  readonly spanId: string | undefined

  /** Get the full correlation context */
  readonly context: CorrelationContext

  /**
   * Create a child span for tracing a sub-operation
   * @param name - Name of the operation being traced
   * @returns A Span object with methods to manage the span
   */
  span(name: string): SpanBuilder

  /**
   * Add an attribute to the current span
   * @param key - Attribute key
   * @param value - Attribute value
   */
  setAttribute(key: string, value: string | number | boolean): void

  /**
   * Add an event to the current span
   * @param name - Event name
   * @param attributes - Optional event attributes
   */
  addEvent(name: string, attributes?: Record<string, string | number | boolean>): void

  /**
   * Create a new correlation context (for root requests)
   */
  create(): CorrelationContext

  /**
   * Set the correlation context (for incoming requests)
   * @param ctx - The correlation context to use
   */
  setContext(ctx: CorrelationContext): void
}

/**
 * Span builder for fluent span creation
 */
export interface SpanBuilder {
  /** Set an attribute on the span */
  setAttribute(key: string, value: string | number | boolean): SpanBuilder
  /** Add an event to the span */
  addEvent(name: string, attributes?: Record<string, string | number | boolean>): SpanBuilder
  /** Execute a function within the span context */
  run<T>(fn: () => T | Promise<T>): Promise<T>
  /** End the span manually */
  end(status?: 'completed' | 'failed'): void
  /** Get the span object */
  getSpan(): Span
}

// ============================================================================
// MOCK IMPLEMENTATION IMPORTS
// ============================================================================

// Import the implementation (will fail initially)
import {
  createCorrelationCapability,
  type CorrelationStore,
} from '../context/correlation-capability'

// ============================================================================
// 1. BASIC CORRELATION ID TESTS
// ============================================================================

describe('$.correlation.id - Correlation ID Access', () => {
  describe('basic ID access', () => {
    it('should provide access to current correlation ID', () => {
      const store: CorrelationStore = {
        context: null,
        spans: new Map(),
        currentSpanId: undefined,
      }

      const correlation = createCorrelationCapability(store)

      // Create a new context first
      const ctx = correlation.create()
      correlation.setContext(ctx)

      expect(correlation.id).toBeDefined()
      expect(typeof correlation.id).toBe('string')
      expect(correlation.id.startsWith('corr-')).toBe(true)
    })

    it('should return the same ID across multiple accesses', () => {
      const store: CorrelationStore = {
        context: null,
        spans: new Map(),
        currentSpanId: undefined,
      }

      const correlation = createCorrelationCapability(store)
      const ctx = correlation.create()
      correlation.setContext(ctx)

      const id1 = correlation.id
      const id2 = correlation.id

      expect(id1).toBe(id2)
    })

    it('should throw when no correlation context is set', () => {
      const store: CorrelationStore = {
        context: null,
        spans: new Map(),
        currentSpanId: undefined,
      }

      const correlation = createCorrelationCapability(store)

      expect(() => correlation.id).toThrow('No correlation context set')
    })
  })

  describe('context management', () => {
    it('should create a new correlation context', () => {
      const store: CorrelationStore = {
        context: null,
        spans: new Map(),
        currentSpanId: undefined,
      }

      const correlation = createCorrelationCapability(store)
      const ctx = correlation.create()

      expect(ctx.correlationId).toBeDefined()
      expect(ctx.requestId).toBeDefined()
      expect(ctx.timestamp).toBeDefined()
      expect(ctx.sequence).toBe(1)
    })

    it('should set an existing correlation context', () => {
      const store: CorrelationStore = {
        context: null,
        spans: new Map(),
        currentSpanId: undefined,
      }

      const correlation = createCorrelationCapability(store)

      const existingCtx: CorrelationContext = {
        correlationId: 'corr-existing123',
        requestId: 'req-existing456',
        timestamp: Date.now(),
        sequence: 5,
        spanId: 'span-existing789',
      }

      correlation.setContext(existingCtx)

      expect(correlation.id).toBe('corr-existing123')
      expect(correlation.spanId).toBe('span-existing789')
    })

    it('should provide full context access', () => {
      const store: CorrelationStore = {
        context: null,
        spans: new Map(),
        currentSpanId: undefined,
      }

      const correlation = createCorrelationCapability(store)
      const ctx = correlation.create()
      correlation.setContext(ctx)

      expect(correlation.context).toEqual(ctx)
    })
  })
})

// ============================================================================
// 2. SPAN CREATION TESTS
// ============================================================================

describe('$.correlation.span() - Span Management', () => {
  describe('basic span creation', () => {
    it('should create a child span with a name', async () => {
      const store: CorrelationStore = {
        context: null,
        spans: new Map(),
        currentSpanId: undefined,
      }

      const correlation = createCorrelationCapability(store)
      const ctx = correlation.create()
      correlation.setContext(ctx)

      const spanBuilder = correlation.span('database-query')
      const span = spanBuilder.getSpan()

      expect(span.name).toBe('database-query')
      expect(span.correlationId).toBe(ctx.correlationId)
      expect(span.status).toBe('active')
      expect(span.startedAt).toBeInstanceOf(Date)
    })

    it('should create nested spans with parent references', async () => {
      const store: CorrelationStore = {
        context: null,
        spans: new Map(),
        currentSpanId: undefined,
      }

      const correlation = createCorrelationCapability(store)
      const ctx = correlation.create()
      correlation.setContext(ctx)

      // Parent span
      const parentSpan = correlation.span('process-order')
      const parent = parentSpan.getSpan()

      // Simulate being inside the parent span
      store.currentSpanId = parent.id

      // Child span
      const childSpan = correlation.span('validate-payment')
      const child = childSpan.getSpan()

      expect(child.parentId).toBe(parent.id)
      expect(child.correlationId).toBe(parent.correlationId)
    })

    it('should generate unique span IDs', () => {
      const store: CorrelationStore = {
        context: null,
        spans: new Map(),
        currentSpanId: undefined,
      }

      const correlation = createCorrelationCapability(store)
      const ctx = correlation.create()
      correlation.setContext(ctx)

      const span1 = correlation.span('operation-1').getSpan()
      const span2 = correlation.span('operation-2').getSpan()

      expect(span1.id).not.toBe(span2.id)
    })
  })

  describe('span lifecycle', () => {
    it('should execute function within span context using run()', async () => {
      const store: CorrelationStore = {
        context: null,
        spans: new Map(),
        currentSpanId: undefined,
      }

      const correlation = createCorrelationCapability(store)
      const ctx = correlation.create()
      correlation.setContext(ctx)

      let insideSpanId: string | undefined

      const result = await correlation.span('compute-value').run(async () => {
        insideSpanId = store.currentSpanId
        return 42
      })

      expect(result).toBe(42)
      expect(insideSpanId).toBeDefined()
    })

    it('should mark span as completed after successful run()', async () => {
      const store: CorrelationStore = {
        context: null,
        spans: new Map(),
        currentSpanId: undefined,
      }

      const correlation = createCorrelationCapability(store)
      const ctx = correlation.create()
      correlation.setContext(ctx)

      const spanBuilder = correlation.span('successful-operation')

      await spanBuilder.run(async () => {
        return 'success'
      })

      const span = spanBuilder.getSpan()
      expect(span.status).toBe('completed')
      expect(span.endedAt).toBeInstanceOf(Date)
      expect(span.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('should mark span as failed when run() throws', async () => {
      const store: CorrelationStore = {
        context: null,
        spans: new Map(),
        currentSpanId: undefined,
      }

      const correlation = createCorrelationCapability(store)
      const ctx = correlation.create()
      correlation.setContext(ctx)

      const spanBuilder = correlation.span('failing-operation')

      await expect(spanBuilder.run(async () => {
        throw new Error('Operation failed')
      })).rejects.toThrow('Operation failed')

      const span = spanBuilder.getSpan()
      expect(span.status).toBe('failed')
      expect(span.endedAt).toBeInstanceOf(Date)
    })

    it('should allow manual span ending', () => {
      const store: CorrelationStore = {
        context: null,
        spans: new Map(),
        currentSpanId: undefined,
      }

      const correlation = createCorrelationCapability(store)
      const ctx = correlation.create()
      correlation.setContext(ctx)

      const spanBuilder = correlation.span('manual-span')
      spanBuilder.end('completed')

      const span = spanBuilder.getSpan()
      expect(span.status).toBe('completed')
      expect(span.endedAt).toBeInstanceOf(Date)
    })

    it('should restore parent span after child span completes', async () => {
      const store: CorrelationStore = {
        context: null,
        spans: new Map(),
        currentSpanId: undefined,
      }

      const correlation = createCorrelationCapability(store)
      const ctx = correlation.create()
      correlation.setContext(ctx)

      const parentBuilder = correlation.span('parent-operation')
      const parentSpan = parentBuilder.getSpan()

      await parentBuilder.run(async () => {
        // Inside parent span
        expect(store.currentSpanId).toBe(parentSpan.id)

        await correlation.span('child-operation').run(async () => {
          // Inside child span - different from parent
          expect(store.currentSpanId).not.toBe(parentSpan.id)
        })

        // Should be back to parent span
        expect(store.currentSpanId).toBe(parentSpan.id)
      })
    })
  })

  describe('span attributes and events', () => {
    it('should allow setting attributes on spans', () => {
      const store: CorrelationStore = {
        context: null,
        spans: new Map(),
        currentSpanId: undefined,
      }

      const correlation = createCorrelationCapability(store)
      const ctx = correlation.create()
      correlation.setContext(ctx)

      const spanBuilder = correlation.span('database-query')
        .setAttribute('db.system', 'sqlite')
        .setAttribute('db.operation', 'SELECT')
        .setAttribute('db.rowCount', 42)

      const span = spanBuilder.getSpan()
      expect(span.attributes['db.system']).toBe('sqlite')
      expect(span.attributes['db.operation']).toBe('SELECT')
      expect(span.attributes['db.rowCount']).toBe(42)
    })

    it('should allow adding events to spans', () => {
      const store: CorrelationStore = {
        context: null,
        spans: new Map(),
        currentSpanId: undefined,
      }

      const correlation = createCorrelationCapability(store)
      const ctx = correlation.create()
      correlation.setContext(ctx)

      const spanBuilder = correlation.span('process-order')
        .addEvent('order.validated')
        .addEvent('payment.initiated', { amount: 100, currency: 'USD' })

      const span = spanBuilder.getSpan()
      expect(span.events).toHaveLength(2)
      expect(span.events[0].name).toBe('order.validated')
      expect(span.events[1].name).toBe('payment.initiated')
      expect(span.events[1].attributes).toEqual({ amount: 100, currency: 'USD' })
    })

    it('should allow setting attributes on current span via correlation.setAttribute()', () => {
      const store: CorrelationStore = {
        context: null,
        spans: new Map(),
        currentSpanId: undefined,
      }

      const correlation = createCorrelationCapability(store)
      const ctx = correlation.create()
      correlation.setContext(ctx)

      const spanBuilder = correlation.span('some-operation')
      const span = spanBuilder.getSpan()
      store.currentSpanId = span.id
      store.spans.set(span.id, span)

      correlation.setAttribute('custom.attribute', 'value')

      expect(span.attributes['custom.attribute']).toBe('value')
    })

    it('should allow adding events to current span via correlation.addEvent()', () => {
      const store: CorrelationStore = {
        context: null,
        spans: new Map(),
        currentSpanId: undefined,
      }

      const correlation = createCorrelationCapability(store)
      const ctx = correlation.create()
      correlation.setContext(ctx)

      const spanBuilder = correlation.span('some-operation')
      const span = spanBuilder.getSpan()
      store.currentSpanId = span.id
      store.spans.set(span.id, span)

      correlation.addEvent('checkpoint', { step: 1 })

      expect(span.events).toHaveLength(1)
      expect(span.events[0].name).toBe('checkpoint')
    })
  })
})

// ============================================================================
// 3. CROSS-DO PROPAGATION TESTS
// ============================================================================

describe('Correlation Propagation in Cross-DO RPC', () => {
  describe('header injection', () => {
    it('should inject correlation headers into outgoing requests', () => {
      const ctx: CorrelationContext = {
        correlationId: 'corr-test123',
        requestId: 'req-test456',
        timestamp: Date.now(),
        sequence: 1,
        spanId: 'span-test789',
      }

      const header = createDotdoRequestHeader(ctx)

      expect(header).toContain('corr-test123')
      expect(header).toContain('req-test456')
      expect(header).toContain('span-test789')
    })

    it('should increment sequence when propagating', () => {
      const ctx: CorrelationContext = {
        correlationId: 'corr-test123',
        requestId: 'req-test456',
        timestamp: Date.now(),
        sequence: 5,
      }

      const header = createDotdoRequestHeader({
        ...ctx,
        sequence: ctx.sequence + 1,
      })

      const parsed = parseDotdoRequestHeader(header)
      expect(parsed.sequence).toBe(6)
    })

    it('should create child span for cross-DO calls', () => {
      const parentCtx: CorrelationContext = {
        correlationId: 'corr-parent',
        requestId: 'req-parent',
        timestamp: Date.now(),
        sequence: 1,
        spanId: 'span-parent',
      }

      const childCtx = createChildSpan(parentCtx)

      expect(childCtx.correlationId).toBe(parentCtx.correlationId)
      expect(childCtx.requestId).not.toBe(parentCtx.requestId)
      expect(childCtx.spanId).not.toBe(parentCtx.spanId)
      expect(childCtx.parentSpanId).toBe(parentCtx.spanId)
      expect(childCtx.sequence).toBe(2)
    })
  })

  describe('header extraction', () => {
    it('should extract correlation from incoming request headers', () => {
      const header = 'corr-incoming.req-incoming.1704067200000.3.span-incoming.span-parent'

      const ctx = parseDotdoRequestHeader(header)

      expect(ctx.correlationId).toBe('corr-incoming')
      expect(ctx.requestId).toBe('req-incoming')
      expect(ctx.sequence).toBe(3)
      expect(ctx.spanId).toBe('span-incoming')
      expect(ctx.parentSpanId).toBe('span-parent')
    })

    it('should handle missing optional fields gracefully', () => {
      const header = 'corr-minimal.req-minimal.1704067200000.1'

      const ctx = parseDotdoRequestHeader(header)

      expect(ctx.correlationId).toBe('corr-minimal')
      expect(ctx.requestId).toBe('req-minimal')
      expect(ctx.sequence).toBe(1)
      expect(ctx.spanId).toBeUndefined()
      expect(ctx.parentSpanId).toBeUndefined()
    })
  })
})

// ============================================================================
// 4. INTEGRATION WITH $.do() TESTS
// ============================================================================

describe('$.do() Integration with Correlation', () => {
  it('should automatically create span for $.do() operations', async () => {
    const store: CorrelationStore = {
      context: null,
      spans: new Map(),
      currentSpanId: undefined,
    }

    const correlation = createCorrelationCapability(store)
    const ctx = correlation.create()
    correlation.setContext(ctx)

    // Simulate what $.do() would do internally
    const actionName = 'process.payment'
    const spanBuilder = correlation.span(`do:${actionName}`)
      .setAttribute('action.name', actionName)
      .setAttribute('action.durability', 'durable')

    await spanBuilder.run(async () => {
      // Action execution
      return { success: true }
    })

    const span = spanBuilder.getSpan()
    expect(span.name).toBe('do:process.payment')
    expect(span.attributes['action.name']).toBe('process.payment')
    expect(span.attributes['action.durability']).toBe('durable')
    expect(span.status).toBe('completed')
  })

  it('should track retry attempts in span attributes', async () => {
    const store: CorrelationStore = {
      context: null,
      spans: new Map(),
      currentSpanId: undefined,
    }

    const correlation = createCorrelationCapability(store)
    const ctx = correlation.create()
    correlation.setContext(ctx)

    // Simulate $.do() with retries
    const spanBuilder = correlation.span('do:flaky.operation')
      .setAttribute('action.retries', 2)
      .setAttribute('action.maxAttempts', 3)

    await spanBuilder.run(async () => {
      // Simulated action after retries
      return { success: true }
    })

    const span = spanBuilder.getSpan()
    expect(span.attributes['action.retries']).toBe(2)
    expect(span.attributes['action.maxAttempts']).toBe(3)
  })

  it('should record step ID in span for replay', async () => {
    const store: CorrelationStore = {
      context: null,
      spans: new Map(),
      currentSpanId: undefined,
    }

    const correlation = createCorrelationCapability(store)
    const ctx = correlation.create()
    correlation.setContext(ctx)

    const stepId = 'send.email:abc123'
    const spanBuilder = correlation.span('do:send.email')
      .setAttribute('action.stepId', stepId)

    await spanBuilder.run(async () => {
      return { sent: true }
    })

    const span = spanBuilder.getSpan()
    expect(span.attributes['action.stepId']).toBe(stepId)
  })
})

// ============================================================================
// 5. CROSS-DO RPC INTEGRATION TESTS
// ============================================================================

describe('Cross-DO RPC Correlation Integration', () => {
  it('should preserve correlation ID across DO boundaries', () => {
    // Simulate DO A creating a request
    const doACtx: CorrelationContext = {
      correlationId: 'corr-trace1',
      requestId: 'req-doA',
      timestamp: Date.now(),
      sequence: 1,
      spanId: 'span-doA',
    }

    // Create child span for cross-DO call
    const doBCtx = createChildSpan(doACtx)

    // DO B receives and uses the same correlation ID
    expect(doBCtx.correlationId).toBe('corr-trace1')
    // But has its own request and span IDs
    expect(doBCtx.requestId).not.toBe('req-doA')
    expect(doBCtx.spanId).not.toBe('span-doA')
    // References parent span
    expect(doBCtx.parentSpanId).toBe('span-doA')
  })

  it('should increment sequence for each hop', () => {
    // Original request
    const ctx1: CorrelationContext = {
      correlationId: 'corr-multi',
      requestId: 'req-1',
      timestamp: Date.now(),
      sequence: 1,
    }

    // DO A -> DO B
    const ctx2 = createChildSpan(ctx1)
    expect(ctx2.sequence).toBe(2)

    // DO B -> DO C
    const ctx3 = createChildSpan(ctx2)
    expect(ctx3.sequence).toBe(3)

    // DO C -> DO D
    const ctx4 = createChildSpan(ctx3)
    expect(ctx4.sequence).toBe(4)
  })

  it('should maintain parent-child span relationships across DOs', () => {
    // Root span in DO A
    const doASpan: CorrelationContext = {
      correlationId: 'corr-hierarchy',
      requestId: 'req-A',
      timestamp: Date.now(),
      sequence: 1,
      spanId: 'span-A',
    }

    // Child in DO B
    const doBSpan = createChildSpan(doASpan)
    expect(doBSpan.parentSpanId).toBe('span-A')

    // Grandchild in DO C
    const doCSpan = createChildSpan(doBSpan)
    expect(doCSpan.parentSpanId).toBe(doBSpan.spanId)

    // All share the same correlation ID
    expect(doBSpan.correlationId).toBe('corr-hierarchy')
    expect(doCSpan.correlationId).toBe('corr-hierarchy')
  })
})

// ============================================================================
// 6. ERROR HANDLING TESTS
// ============================================================================

describe('Correlation Error Handling', () => {
  it('should handle missing context gracefully', () => {
    const store: CorrelationStore = {
      context: null,
      spans: new Map(),
      currentSpanId: undefined,
    }

    const correlation = createCorrelationCapability(store)

    expect(() => correlation.id).toThrow('No correlation context set')
    expect(() => correlation.context).toThrow('No correlation context set')
  })

  it('should silently ignore setAttribute when no current span', () => {
    const store: CorrelationStore = {
      context: null,
      spans: new Map(),
      currentSpanId: undefined,
    }

    const correlation = createCorrelationCapability(store)
    const ctx = correlation.create()
    correlation.setContext(ctx)

    // Should not throw even without a current span
    expect(() => correlation.setAttribute('key', 'value')).not.toThrow()
  })

  it('should silently ignore addEvent when no current span', () => {
    const store: CorrelationStore = {
      context: null,
      spans: new Map(),
      currentSpanId: undefined,
    }

    const correlation = createCorrelationCapability(store)
    const ctx = correlation.create()
    correlation.setContext(ctx)

    // Should not throw even without a current span
    expect(() => correlation.addEvent('event')).not.toThrow()
  })

  it('should not allow ending a span twice', () => {
    const store: CorrelationStore = {
      context: null,
      spans: new Map(),
      currentSpanId: undefined,
    }

    const correlation = createCorrelationCapability(store)
    const ctx = correlation.create()
    correlation.setContext(ctx)

    const spanBuilder = correlation.span('double-end')
    spanBuilder.end('completed')

    // Second end should be a no-op
    spanBuilder.end('failed')

    const span = spanBuilder.getSpan()
    expect(span.status).toBe('completed') // First status sticks
  })
})

// ============================================================================
// 7. TIMING AND DURATION TESTS
// ============================================================================

describe('Span Timing and Duration', () => {
  it('should calculate duration correctly', async () => {
    const store: CorrelationStore = {
      context: null,
      spans: new Map(),
      currentSpanId: undefined,
    }

    const correlation = createCorrelationCapability(store)
    const ctx = correlation.create()
    correlation.setContext(ctx)

    const spanBuilder = correlation.span('timed-operation')

    await spanBuilder.run(async () => {
      // Simulate some work
      await new Promise(resolve => setTimeout(resolve, 50))
    })

    const span = spanBuilder.getSpan()
    expect(span.durationMs).toBeGreaterThanOrEqual(40) // Allow some variance
    expect(span.durationMs).toBeLessThan(200)
  })

  it('should record accurate start time', () => {
    const store: CorrelationStore = {
      context: null,
      spans: new Map(),
      currentSpanId: undefined,
    }

    const correlation = createCorrelationCapability(store)
    const ctx = correlation.create()
    correlation.setContext(ctx)

    const before = new Date()
    const spanBuilder = correlation.span('start-time-test')
    const after = new Date()

    const span = spanBuilder.getSpan()
    expect(span.startedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(span.startedAt.getTime()).toBeLessThanOrEqual(after.getTime())
  })
})

// ============================================================================
// 8. EXISTING UTILITY FUNCTION TESTS
// ============================================================================

describe('Existing Correlation Utilities', () => {
  it('should generate valid correlation IDs', () => {
    const id = generateCorrelationId()

    expect(id.startsWith('corr-')).toBe(true)
    expect(id.length).toBeLessThanOrEqual(25)
  })

  it('should generate unique correlation IDs', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 100; i++) {
      ids.add(generateCorrelationId())
    }
    expect(ids.size).toBe(100)
  })

  it('should generate valid request IDs', () => {
    const id = generateRequestId()

    expect(id.startsWith('req-')).toBe(true)
    expect(id.length).toBeLessThanOrEqual(15)
  })

  it('should create valid Dotdo request headers', () => {
    const ctx: CorrelationContext = {
      correlationId: 'corr-abc',
      requestId: 'req-xyz',
      timestamp: 1704067200000,
      sequence: 1,
    }

    const header = createDotdoRequestHeader(ctx)

    expect(header).toBe('corr-abc.req-xyz.1704067200000.1')
  })

  it('should parse valid Dotdo request headers', () => {
    const header = 'corr-abc.req-xyz.1704067200000.1.span-123.span-parent'

    const ctx = parseDotdoRequestHeader(header)

    expect(ctx.correlationId).toBe('corr-abc')
    expect(ctx.requestId).toBe('req-xyz')
    expect(ctx.timestamp).toBe(1704067200000)
    expect(ctx.sequence).toBe(1)
    expect(ctx.spanId).toBe('span-123')
    expect(ctx.parentSpanId).toBe('span-parent')
  })
})
